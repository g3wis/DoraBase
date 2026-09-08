//! L'introspection MySQL (`16b`).
//!
//! **Le niveau « schéma » porte les bases du serveur** : MySQL n'a qu'un niveau, et
//! `information_schema.schemata` appelle « schéma » ce que `CREATE DATABASE` crée.

use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Row};

use crate::engine::{
    ColumnInfo, ConstraintInfo, EngineError, Identity, IndexInfo, KeyKind, ObjectCounts,
    ObjectKind, Relation, RelationCardinality, RelationDirection, RowCount, SchemaInfo,
    TableDetail, TableSummary, TriggerInfo, TypeCategory,
};

use super::error::traduire;

/// Les schémas de service du serveur.
///
/// Les afficher mettrait quatre entrées de plomberie en tête de l'arbre — la décision de `06c` pour
/// `pg_catalog`, et de `18c` pour `admin`/`config`/`local`.
const DE_SERVICE: [&str; 4] = ["information_schema", "performance_schema", "mysql", "sys"];

/// Les bases du serveur, avec leurs compteurs.
pub async fn bases(connexion: &mut Conn) -> Result<Vec<SchemaInfo>, EngineError> {
    // **Un seul aller-retour pour les quatre compteurs.** Un `count` par genre et par base ferait
    // quatre requêtes par base ; sur un serveur à vingt bases, quatre-vingts allers-retours au
    // dépliage. C'est le coût que `18c` a nommé sans pouvoir l'éviter, et que le SQL évite ici.
    let lignes: Vec<Row> = connexion
        .query(
            "select t.table_schema,
                    sum(t.table_type = 'BASE TABLE') as tables,
                    sum(t.table_type = 'VIEW')       as vues,
                    (select count(*) from information_schema.statistics s
                      where s.table_schema = t.table_schema)  as index_,
                    (select count(*) from information_schema.routines r
                      where r.routine_schema = t.table_schema) as routines
               from information_schema.tables t
              group by t.table_schema
              order by t.table_schema",
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(0)?;
            if DE_SERVICE.contains(&nom.as_str()) {
                return None;
            }
            Some(SchemaInfo {
                name: nom,
                // MySQL n'attache pas de propriétaire à une base : ses rôles vivent au niveau du
                // serveur, et `DE_SERVICE` écarte ses bases de catalogue quelques lignes plus haut.
                owner: None,
                system: false,
                counts: ObjectCounts {
                    tables: compteur(&ligne, 1),
                    views: compteur(&ligne, 2),
                    // `information_schema.statistics` compte une ligne **par colonne d'index** : un
                    // index composé y apparaît deux fois. Le distinct se fait donc côté SQL — voir la
                    // requête ci-dessus, où il est volontairement absent : le compteur du contrôle
                    // segmenté de `A4` est un ordre de grandeur, et `06c` le compte de même.
                    indexes: compteur(&ligne, 3),
                    // **Les procédures stockées sont comptées, pas listées** : `16b` les met hors
                    // périmètre pour l'affichage, et le compteur existe dans `ObjectCounts`.
                    functions: compteur(&ligne, 4),
                },
            })
        })
        .collect())
}

/// Les tables et les vues d'une base.
pub async fn objets(connexion: &mut Conn, base: &str) -> Result<Vec<TableSummary>, EngineError> {
    let lignes: Vec<Row> = connexion
        .exec(
            "select t.table_name, t.table_type, t.table_rows, t.data_length + t.index_length,
                    t.engine, t.update_time, t.table_comment,
                    (select count(*) from information_schema.columns c
                      where c.table_schema = t.table_schema and c.table_name = t.table_name),
                    (select group_concat(k.column_name order by k.ordinal_position)
                       from information_schema.key_column_usage k
                      where k.table_schema = t.table_schema and k.table_name = t.table_name
                        and k.constraint_name = 'PRIMARY')
               from information_schema.tables t
              where t.table_schema = ?
              order by t.table_name",
            (base,),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(0)?;
            let genre: String = ligne.get(1)?;
            let vue = genre == "VIEW";
            let lignes_estimees: Option<i64> = ligne.get(2).flatten();
            let moteur: Option<String> = ligne.get(4).flatten();

            Some(TableSummary {
                // **L'estimation d'InnoDB peut être très fausse** — des écarts de l'ordre de 50 %,
                // pas de quelques pourcents. `RowCount::Estimated` le dit, et `A4` affiche le `≈` ;
                // ce qu'il faut éviter est de la croire assez bonne pour s'y fier.
                //
                // Pour MyISAM, `table_rows` est **exact** : le moteur tient le compte. Le distinguer
                // n'est pas de la coquetterie — c'est la différence entre une valeur sur laquelle on
                // décide et une valeur qu'on regarde.
                rows: match (vue, lignes_estimees) {
                    (true, _) => RowCount::Unknown,
                    (false, Some(value)) if moteur.as_deref() == Some("MyISAM") => {
                        RowCount::Exact { value }
                    }
                    (false, Some(value)) => RowCount::Estimated { value },
                    (false, None) => RowCount::Unknown,
                },
                size_bytes: ligne.get::<Option<u64>, _>(3).flatten(),
                column_count: compteur(&ligne, 7),
                primary_key: ligne.get::<Option<String>, _>(8).flatten(),
                // `update_time` n'est pas un `ANALYZE` : c'est la dernière écriture. C'est pourtant
                // ce que la colonne de `A4` cherche à dire — « à quel point s'y fier » — et MySQL ne
                // conserve pas la date du dernier `ANALYZE`.
                //
                // **Lu comme une valeur, pas comme une chaîne** : le pilote rend un `DATETIME` en
                // `Value::Date`, et demander un `String` **panique** au lieu d'échouer proprement.
                // Trouvé par le test de la liste d'objets, qui s'est arrêté net dans le pilote.
                last_analyze: horodatage(&ligne, 5),
                comment: ligne
                    .get::<Option<String>, _>(6)
                    .flatten()
                    .filter(|c| !c.is_empty()),
                name: nom,
                kind: if vue {
                    ObjectKind::View
                } else {
                    ObjectKind::Table
                },
            })
        })
        .collect())
}

/// Le détail d'une table — ce que `A9` affiche, DDL compris.
pub async fn detail(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<TableDetail, EngineError> {
    let entete: Option<Row> = connexion
        .exec_first(
            "select table_type, table_rows, data_length + index_length, engine, table_comment
               from information_schema.tables where table_schema = ? and table_name = ?",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;
    let Some(entete) = entete else {
        return Err(EngineError::local(format!(
            "la table « {table} » n'existe pas dans « {base} »"
        )));
    };
    let vue = entete.get::<String, _>(0).as_deref() == Some("VIEW");
    let moteur: Option<String> = entete.get(3).flatten();

    let colonnes = colonnes(connexion, base, table).await?;
    let index = index(connexion, base, table).await?;

    Ok(TableDetail {
        schema: base.to_owned(),
        name: table.to_owned(),
        rows: match (vue, entete.get::<Option<i64>, _>(1).flatten()) {
            (true, _) => RowCount::Unknown,
            (false, Some(value)) if moteur.as_deref() == Some("MyISAM") => {
                RowCount::Exact { value }
            }
            (false, Some(value)) => RowCount::Estimated { value },
            (false, None) => RowCount::Unknown,
        },
        size_bytes: entete.get::<Option<u64>, _>(2).flatten(),
        comment: entete
            .get::<Option<String>, _>(4)
            .flatten()
            .filter(|c| !c.is_empty()),
        columns: colonnes,
        indexes: index,
        constraints: contraintes(connexion, base, table).await?,
        triggers: declencheurs(connexion, base, table).await?,
        relations: relations(connexion, base, table).await?,
        // **Rendu par le serveur, pas reconstruit.** C'est l'avantage que `06c` n'avait pas :
        // PostgreSQL oblige à réassembler, avec les défauts que `14c` a documentés — identité perdue,
        // index oubliés. MySQL le rend tel qu'il le tient.
        ddl: ddl(connexion, base, table, vue).await?,
    })
}

/// Le DDL, tel que le serveur le rend.
///
/// La mention « reconstruit » de `A9` reste **vraie** : MySQL normalise aussi — il ajoute `ENGINE`,
/// `CHARSET`, réordonne les clauses. Le texte est équivalent, pas identique à ce qui a été tapé. Seul
/// SQLite garde l'original (`17b`), et c'est le mot « presque » qui l'y distingue.
async fn ddl(
    connexion: &mut Conn,
    base: &str,
    table: &str,
    vue: bool,
) -> Result<String, EngineError> {
    let commande = format!(
        "show create {} {}.{}",
        if vue { "view" } else { "table" },
        citer(base),
        citer(table)
    );
    let ligne: Option<Row> = connexion
        .query_first(&commande)
        .await
        .map_err(|e| traduire(&e))?;
    // La deuxième colonne porte le DDL pour une table, la deuxième aussi pour une vue — mais une vue
    // rend quatre colonnes, et la position reste la même.
    Ok(ligne
        .and_then(|ligne| ligne.get::<Option<String>, _>(1).flatten())
        .map(|texte| format!("{texte};"))
        .unwrap_or_else(|| format!("-- aucun DDL rendu pour {base}.{table}")))
}

async fn colonnes(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, EngineError> {
    let lignes: Vec<Row> = connexion
        .exec(
            "select ordinal_position, column_name, column_type, is_nullable, column_default,
                    column_key, extra, column_comment
               from information_schema.columns
              where table_schema = ? and table_name = ?
              order by ordinal_position",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    // Les colonnes portant une clé étrangère, pour distinguer `MUL` — que MySQL emploie aussi bien
    // pour un index ordinaire que pour une clé étrangère.
    let etrangeres: Vec<String> = connexion
        .exec(
            "select column_name from information_schema.key_column_usage
              where table_schema = ? and table_name = ? and referenced_table_name is not null",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(1)?;
            let type_natif: String = ligne.get(2)?;
            let cle: Option<String> = ligne.get(5).flatten();
            let extra: Option<String> = ligne.get(6).flatten();

            Some(ColumnInfo {
                position: compteur(&ligne, 0),
                category: categorie(&type_natif),
                nullable: ligne.get::<String, _>(3).as_deref() == Some("YES"),
                default: ligne.get::<Option<String>, _>(4).flatten(),
                // **`auto_increment` est l'identité de MySQL.** Elle vit dans `extra`, pas dans
                // `column_default` — exactement le piège de `GENERATED … AS IDENTITY` en PostgreSQL,
                // qui a fait perdre l'auto-incrément au DDL de `14c` (défaut n° 49).
                identity: extra
                    .as_deref()
                    .filter(|e| e.contains("auto_increment"))
                    .map(|_| Identity::ByDefault),
                key: match cle.as_deref() {
                    Some("PRI") => Some(KeyKind::Primary),
                    // **`MUL` ne suffit pas** : MySQL l'emploie pour la première colonne de tout
                    // index non unique, clé étrangère ou pas. Sans la seconde requête, un index
                    // ordinaire s'afficherait comme une clé étrangère — une relation inventée.
                    _ if etrangeres.contains(&nom) => Some(KeyKind::Foreign),
                    _ => None,
                },
                comment: ligne
                    .get::<Option<String>, _>(7)
                    .flatten()
                    .filter(|c| !c.is_empty()),
                // Les colonnes sont **déclarées** : la fréquence de `18d` n'a pas de sens ici.
                frequency: None,
                type_name: type_natif,
                name: nom,
            })
        })
        .collect())
}

async fn index(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, EngineError> {
    let lignes: Vec<Row> = connexion
        .exec(
            "select index_name, max(non_unique) as non_unique, max(index_type) as methode,
                    group_concat(column_name order by seq_in_index) as colonnes
               from information_schema.statistics
              where table_schema = ? and table_name = ?
              group by index_name
              order by index_name",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(0)?;
            let non_unique: i64 = ligne.get(1).unwrap_or(1);
            let methode: String = ligne.get(2).unwrap_or_else(|| "BTREE".to_owned());
            let colonnes: String = ligne.get(3).unwrap_or_default();
            Some(IndexInfo {
                // **La forme d'un `CREATE INDEX`**, pour que `resumeDIndex` (`14b`) la résume sans
                // une seconde grammaire côté écran — la décision de `18c` et `17b`.
                definition: format!(
                    "CREATE {}INDEX {nom} ON {base}.{table} USING {} ({colonnes})",
                    if non_unique == 0 { "UNIQUE " } else { "" },
                    methode.to_lowercase()
                ),
                name: nom,
            })
        })
        .collect())
}

async fn contraintes(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<Vec<ConstraintInfo>, EngineError> {
    // `check_constraints` n'existe qu'à partir de MySQL 8.0.16 et de MariaDB 10.2 : une base plus
    // ancienne rendrait une erreur, pas un ensemble vide. Le `union` séparé le rendrait fragile —
    // les clés étrangères et les uniques suffisent, et le DDL affiché à côté porte les `CHECK`.
    let lignes: Vec<Row> = connexion
        .exec(
            "select tc.constraint_name, tc.constraint_type,
                    group_concat(k.column_name order by k.ordinal_position),
                    max(k.referenced_table_name),
                    group_concat(k.referenced_column_name order by k.ordinal_position)
               from information_schema.table_constraints tc
               left join information_schema.key_column_usage k
                 on k.constraint_schema = tc.constraint_schema
                and k.constraint_name = tc.constraint_name
                and k.table_name = tc.table_name
              where tc.table_schema = ? and tc.table_name = ?
              group by tc.constraint_name, tc.constraint_type
              order by tc.constraint_name",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(0)?;
            let genre: String = ligne.get(1)?;
            let colonnes: String = ligne.get(2).flatten().unwrap_or_default();
            let cible: Option<String> = ligne.get(3).flatten();
            let colonnes_cibles: Option<String> = ligne.get(4).flatten();
            let definition = match (genre.as_str(), cible) {
                ("FOREIGN KEY", Some(cible)) => format!(
                    "FOREIGN KEY ({colonnes}) REFERENCES {cible}({})",
                    colonnes_cibles.unwrap_or_default()
                ),
                ("PRIMARY KEY", _) => format!("PRIMARY KEY ({colonnes})"),
                ("UNIQUE", _) => format!("UNIQUE ({colonnes})"),
                (autre, _) => format!("{autre} ({colonnes})"),
            };
            Some(ConstraintInfo {
                name: nom,
                definition,
            })
        })
        .collect())
}

async fn declencheurs(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<Vec<TriggerInfo>, EngineError> {
    let lignes: Vec<Row> = connexion
        .exec(
            "select trigger_name, action_timing, event_manipulation
               from information_schema.triggers
              where event_object_schema = ? and event_object_table = ?
              order by trigger_name",
            (base, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let nom: String = ligne.get(0)?;
            let moment: String = ligne.get(1).unwrap_or_default();
            let evenement: String = ligne.get(2).unwrap_or_default();
            Some(TriggerInfo {
                // La forme que `momentDuDeclencheur` (`14b`) résume, pour la même raison que les index.
                definition: format!(
                    "CREATE TRIGGER {nom} {} {} ON {base}.{table}",
                    moment.to_uppercase(),
                    evenement.to_uppercase()
                ),
                name: nom,
            })
        })
        .collect())
}

/// Les clés étrangères **dans les deux sens**, comme `06c` les rend.
///
/// # `unique_source` : ce qui sépare un `1:1` d'un `1:n`
///
/// La cardinalité est une propriété de la **contrainte**, pas du sens sous lequel on la rencontre :
/// elle se lit donc toujours sur la table qui référence — `k.table_name` —, et les deux moitiés
/// d'une même clé s'accordent forcément.
///
/// La jointure compare deux **ensembles** de colonnes : celles de la clé étrangère, et celles d'un
/// index dont `non_unique = 0`. Trois points qui décident de la justesse :
///
/// - **`order by column_name` des deux côtés**, et non `seq_in_index` : un index sur `(b, a)`
///   garantit exactement ce que garantit une clé sur `(a, b)`, donc c'est une comparaison
///   d'ensembles. C'est aussi pourquoi la clé se regroupe ici une seconde fois, par nom trié, plutôt
///   que de réemployer le `group_concat` ordonné par position que la ligne rend déjà ;
/// - **les deux `sum(…) = 0` écartent l'index entier**, et c'est ce qui compte : un `where` les aurait
///   écartées **ligne à ligne**, ce qui est un faux `1:1` et non une précaution. `unique (a(10), b)`
///   y aurait perdu la ligne de `a`, laissant le groupe `{b}` — qui répond « oui » pour une clé
///   étrangère sur `b` seule, alors que rien n'y garantit l'unicité de `b`. Ce qu'elles écartent :
///   un index sur un **préfixe** (`sub_part`), qui n'assure l'unicité que des n premiers caractères,
///   et une **part fonctionnelle** (`unique ((lower(a)))`), dont `column_name` est nul — testée par
///   la nullité plutôt que par la colonne `expression`, que MariaDB n'a pas ;
/// - **`s.nullable`** est ignoré à dessein : une colonne nullable dans un index unique laisse
///   plusieurs `NULL` coexister, mais un `NULL` ne référence **rien** — la ligne n'a pas de flèche,
///   donc elle ne fait pas de cette flèche un `1:n` ;
/// - **`k.table_schema` est dans le `group by`**, sans quoi `only_full_group_by` refuse la requête :
///   la sous-requête corrélée le lit, donc il doit être groupé même s'il vaut le paramètre. Mesuré —
///   erreur 1055, et cinq tests MySQL rouges qui ne parlaient pas de relations.
///
/// Une clé primaire est un index `non_unique = 0` nommé `PRIMARY` : elle répond ici sans être
/// nommée, et c'est le cas le plus courant du `1:1`.
async fn relations(
    connexion: &mut Conn,
    base: &str,
    table: &str,
) -> Result<Vec<Relation>, EngineError> {
    let lignes: Vec<Row> = connexion
        .exec(
            "select k.constraint_name, k.table_name, k.referenced_table_name,
                    group_concat(k.column_name order by k.ordinal_position),
                    group_concat(k.referenced_column_name order by k.ordinal_position),
                    exists (
                      select 1
                        from information_schema.statistics s
                       where s.table_schema = k.table_schema
                         and s.table_name = k.table_name
                         and s.non_unique = 0
                       group by s.index_name
                      having sum(s.sub_part is not null) = 0
                         and sum(s.column_name is null) = 0
                         and group_concat(s.column_name order by s.column_name)
                           = (select group_concat(k2.column_name order by k2.column_name)
                                from information_schema.key_column_usage k2
                               where k2.table_schema = k.table_schema
                                 and k2.table_name = k.table_name
                                 and k2.constraint_name = k.constraint_name)
                    )
               from information_schema.key_column_usage k
              where k.table_schema = ?
                and k.referenced_table_name is not null
                and (k.table_name = ? or k.referenced_table_name = ?)
              group by k.table_schema, k.constraint_name, k.table_name,
                       k.referenced_table_name",
            (base, table, table),
        )
        .await
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .into_iter()
        .filter_map(|ligne| {
            let contrainte: String = ligne.get(0)?;
            let depuis: String = ligne.get(1)?;
            let vers: String = ligne.get(2)?;
            let colonnes: String = ligne.get(3).flatten().unwrap_or_default();
            let colonnes_cibles: String = ligne.get(4).flatten().unwrap_or_default();
            let sortante = depuis == table;
            // **Le sens s'inverse, pas les tables** — la leçon du défaut du 10 août 2026 en `06c` :
            // vue depuis la table pointée, la relation part de *sa* colonne.
            Some(Relation {
                constraint_name: contrainte,
                direction: if sortante {
                    RelationDirection::Outgoing
                } else {
                    RelationDirection::Incoming
                },
                columns: decouper(if sortante {
                    &colonnes
                } else {
                    &colonnes_cibles
                }),
                target_schema: base.to_owned(),
                target_table: if sortante { vers } else { depuis },
                target_columns: decouper(if sortante {
                    &colonnes_cibles
                } else {
                    &colonnes
                }),
                // **Le repli est `Many`, et c'est le bon sens du doute** : c'est ce qu'une clé
                // étrangère est presque toujours, et un `1:1` annoncé à tort ferait écrire une
                // jointure qui rend plus de lignes qu'annoncé.
                cardinality: if ligne.get::<Option<i64>, _>(5).flatten().unwrap_or(0) == 1 {
                    RelationCardinality::One
                } else {
                    RelationCardinality::Many
                },
            })
        })
        .collect())
}

fn decouper(concat: &str) -> Vec<String> {
    concat
        .split(',')
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Un horodatage du catalogue, rendu en texte.
///
/// **Le pilote rend un `DATETIME` en `Value::Date`**, pas en chaîne : demander un `String` panique
/// dans `mysql_common` au lieu d'échouer proprement. La conversion passe donc par `rows::valeur_de`,
/// qui connaît déjà la forme — une seule façon de rendre un horodatage dans tout le moteur.
fn horodatage(ligne: &Row, index: usize) -> Option<String> {
    let brute = ligne.as_ref(index)?;
    match super::rows::valeur_de(brute, TypeCategory::Timestamp) {
        crate::engine::Value::Timestamp { value } => Some(value),
        crate::engine::Value::Text { value } => Some(value),
        _ => None,
    }
}

fn compteur(ligne: &Row, index: usize) -> u32 {
    ligne
        .get::<Option<i64>, _>(index)
        .flatten()
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

/// La catégorie de `06a`, depuis le type que MySQL déclare.
///
/// `column_type` porte la déclaration entière — `varchar(120)`, `int unsigned`, `decimal(10,2)` — donc
/// les règles portent sur des préfixes.
pub fn categorie(type_natif: &str) -> TypeCategory {
    let t = type_natif.to_lowercase();
    // **`tinyint(1)` avant `int`** : c'est le booléen de MySQL, qui n'a pas de type dédié. Le laisser
    // en nombre l'alignerait à droite et afficherait `0`/`1` là où l'on attend une valeur logique.
    if t.starts_with("tinyint(1)") || t.starts_with("bool") {
        return TypeCategory::Boolean;
    }
    if t.starts_with("json") {
        return TypeCategory::Json;
    }
    if t.starts_with("date") || t.starts_with("time") || t.starts_with("year") {
        return TypeCategory::Timestamp;
    }
    if t.starts_with("blob")
        || t.starts_with("binary")
        || t.starts_with("varbinary")
        || t.contains("blob")
    {
        return TypeCategory::Binary;
    }
    if t.starts_with("char")
        || t.starts_with("varchar")
        || t.contains("text")
        || t.starts_with("enum")
        || t.starts_with("set")
    {
        return TypeCategory::Text;
    }
    if t.starts_with("int")
        || t.starts_with("bigint")
        || t.starts_with("smallint")
        || t.starts_with("mediumint")
        || t.starts_with("tinyint")
        || t.starts_with("decimal")
        || t.starts_with("numeric")
        || t.starts_with("float")
        || t.starts_with("double")
        || t.starts_with("bit")
    {
        return TypeCategory::Number;
    }
    TypeCategory::Other
}

/// Un identifiant cité **au backtick**, doublé à l'intérieur.
///
/// **La règle de MySQL, et le premier piège de `16c`** : PostgreSQL cite au guillemet double, MySQL au
/// backtick. Le mode `ANSI_QUOTES` inverserait la règle en cours de session — c'est pourquoi `16a`
/// fixe `sql_mode` à l'ouverture plutôt que de le subir.
pub fn citer(identifiant: &str) -> String {
    format!("`{}`", identifiant.replace('`', "``"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_identifiant_est_cite_au_backtick_pas_au_guillemet() {
        // Le premier piège de `16c` : PostgreSQL cite au guillemet double, MySQL au backtick. Une
        // requête citée à la mode PostgreSQL échoue — sauf si `ANSI_QUOTES` est actif, ce qui
        // rendrait le comportement dépendant d'un réglage d'administration.
        assert_eq!(citer("order"), "`order`");
        assert!(!citer("order").contains('"'));
    }

    #[test]
    fn un_backtick_dans_un_nom_est_double() {
        assert_eq!(citer("a`b"), "`a``b`");
    }

    #[test]
    fn tinyint_1_est_un_booleen_pas_un_nombre() {
        // **MySQL n'a pas de type booléen** : `tinyint(1)` en tient lieu. Le laisser en nombre
        // l'alignerait à droite et afficherait `0`/`1` là où l'on attend une valeur logique.
        assert_eq!(categorie("tinyint(1)"), TypeCategory::Boolean);
        // Et un `tinyint` plus large reste un nombre.
        assert_eq!(categorie("tinyint(4)"), TypeCategory::Number);
    }

    #[test]
    fn les_familles_de_types_sont_reconnues() {
        assert_eq!(categorie("varchar(120)"), TypeCategory::Text);
        assert_eq!(categorie("bigint unsigned"), TypeCategory::Number);
        assert_eq!(categorie("decimal(10,2)"), TypeCategory::Number);
        assert_eq!(categorie("json"), TypeCategory::Json);
        assert_eq!(categorie("datetime"), TypeCategory::Timestamp);
        assert_eq!(categorie("timestamp"), TypeCategory::Timestamp);
        assert_eq!(categorie("blob"), TypeCategory::Binary);
        assert_eq!(categorie("mediumblob"), TypeCategory::Binary);
        // `enum` et `set` sont des chaînes contraintes : le glyphe du texte est le bon.
        assert_eq!(categorie("enum('a','b')"), TypeCategory::Text);
    }

    #[test]
    fn un_group_concat_se_decoupe_sans_laisser_de_vide() {
        assert_eq!(decouper("a,b"), vec!["a".to_owned(), "b".to_owned()]);
        assert_eq!(decouper(" a , b "), vec!["a".to_owned(), "b".to_owned()]);
        assert!(decouper("").is_empty());
    }

    #[test]
    fn les_quatre_schemas_de_service_sont_nommes() {
        // Les afficher mettrait quatre entrées de plomberie en tête de l'arbre.
        assert!(DE_SERVICE.contains(&"information_schema"));
        assert!(DE_SERVICE.contains(&"performance_schema"));
        assert!(DE_SERVICE.contains(&"mysql"));
        assert!(DE_SERVICE.contains(&"sys"));
    }
}
