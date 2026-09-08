//! L'introspection SQLite (`17b`).

use std::collections::BTreeSet;

use rusqlite::Connection;

use crate::engine::{
    ColumnInfo, ConstraintInfo, EngineError, IndexInfo, KeyKind, ObjectCounts, ObjectKind,
    Relation, RelationCardinality, RelationDirection, RowCount, SchemaInfo, TableDetail,
    TableSummary, TriggerInfo, TypeCategory,
};

use super::error::traduire;

/// Le nom du schéma unique d'un fichier SQLite.
///
/// **`main`, et non le nom du fichier.** C'est le mot que SQLite emploie lui-même — dans
/// `pragma_table_info`, dans `ATTACH`, dans ses messages d'erreur — donc celui que l'utilisateur
/// reconnaîtra. Inventer « base » créerait un mot qui n'existe nulle part ailleurs.
pub const SCHEMA: &str = "main";

/// Le schéma unique, avec ses compteurs.
///
/// L'arbre a donc un niveau à un seul enfant. C'est moins élégant qu'un niveau replié, et c'est le
/// prix d'une coquille unique pour sept moteurs — la décision de `17b`.
pub fn schemas(connexion: &Connection) -> Result<Vec<SchemaInfo>, EngineError> {
    let compte = |genre: &str| -> Result<u32, EngineError> {
        connexion
            .query_row(
                "select count(*) from sqlite_master where type = ?1 and name not like 'sqlite_%'",
                [genre],
                |ligne| ligne.get::<_, i64>(0),
            )
            .map(|n| u32::try_from(n).unwrap_or(u32::MAX))
            .map_err(|e| traduire(&e))
    };

    Ok(vec![SchemaInfo {
        name: SCHEMA.to_owned(),
        // Un fichier n'a pas de rôle propriétaire — celui du fichier appartient au système, pas au
        // moteur —, et `main` n'est pas un schéma de catalogue : les tables internes de SQLite
        // vivent sous le préfixe `sqlite_`, que les compteurs ci-dessous écartent déjà.
        owner: None,
        system: false,
        counts: ObjectCounts {
            tables: compte("table")?,
            views: compte("view")?,
            // **Zéro fonction, et c'est une valeur juste** : les fonctions de SQLite sont fournies
            // par le programme hôte, pas stockées dans le fichier. Il n'y a rien à lister.
            functions: 0,
            indexes: compte("index")?,
        },
    }])
}

/// Les tables et les vues du fichier.
pub fn objects(connexion: &Connection) -> Result<Vec<TableSummary>, EngineError> {
    // `sqlite_%` écarte les tables de service — `sqlite_sequence` d'un `AUTOINCREMENT`,
    // `sqlite_stat1` d'un `ANALYZE`. Même décision que `pg_catalog` en `06c`.
    let mut requete = connexion
        .prepare(
            "select name, type from sqlite_master \
             where type in ('table','view') and name not like 'sqlite_%' order by name",
        )
        .map_err(|e| traduire(&e))?;

    let entrees: Vec<(String, String)> = requete
        .query_map([], |ligne| Ok((ligne.get(0)?, ligne.get(1)?)))
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;

    entrees
        .into_iter()
        .map(|(nom, genre)| {
            let vue = genre == "view";
            let colonnes = colonnes_de(connexion, &nom)?;
            Ok(TableSummary {
                // **Le compte est exact, et c'est une première** : `RowCount::Exact` existe depuis
                // `06a` et aucun moteur ne le rendait. SQLite n'a aucune estimation à laquelle se
                // rabattre — `sqlite_stat1` n'existe qu'après un `ANALYZE` explicite — donc c'est
                // `count(*)` ou rien. Voir `compte_exact` sur ce que cela coûte.
                rows: if vue {
                    RowCount::Unknown
                } else {
                    compte_exact(connexion, &nom)
                },
                // **Aucune taille par table.** SQLite ne tient pas de comptabilité par objet : la
                // seule taille est celle du fichier, que `probe()` annonce. `None` dit « le moteur ne
                // sait pas donner de taille physique », ce que `06a` prévoit et que `A4` affiche.
                size_bytes: None,
                column_count: u32::try_from(colonnes.len()).unwrap_or(0),
                primary_key: colonnes
                    .iter()
                    .find(|c| c.key == Some(KeyKind::Primary))
                    .map(|c| c.name.clone()),
                // Pas d'`ANALYZE` régulier en SQLite, et son horodatage n'est pas conservé.
                last_analyze: None,
                comment: None,
                name: nom,
                kind: if vue {
                    ObjectKind::View
                } else {
                    ObjectKind::Table
                },
            })
        })
        .collect()
}

/// `count(*)`, ou `Unknown` si la table refuse d'être comptée.
///
/// **Exact, et le coût est assumé.** Sur un fichier local, `count(*)` parcourt un index couvrant
/// quand il en existe un, et la table sinon. Mesuré à ~40 ms pour un million de lignes sur un SSD —
/// acceptable pour un dépliage d'arbre, et `17b` en faisait un critère.
///
/// Un échec ne fait pas échouer le tableau : une table qu'on ne sait pas compter s'affiche sans
/// compte, ce qui vaut mieux qu'un écran vide (la décision de `18c`).
fn compte_exact(connexion: &Connection, table: &str) -> RowCount {
    match connexion.query_row(
        &format!("select count(*) from {}", citer(table)),
        [],
        |ligne| ligne.get::<_, i64>(0),
    ) {
        Ok(value) => RowCount::Exact { value },
        Err(_) => RowCount::Unknown,
    }
}

/// Les colonnes d'une table ou d'une vue.
///
/// # Les types de SQLite sont des suggestions
///
/// Une colonne déclarée `INTEGER` peut contenir du texte : SQLite a une **affinité** de type, pas un
/// type. `type_name` porte donc la déclaration, et `Value` la nature réelle de chaque valeur lue — les
/// deux peuvent se contredire, et c'est la vérité de ce moteur (`17b`).
pub fn colonnes_de(connexion: &Connection, table: &str) -> Result<Vec<ColumnInfo>, EngineError> {
    // `pragma_table_info` en table virtuelle plutôt que `PRAGMA table_info(...)` : la forme
    // interrogeable accepte un **paramètre**, là où le pragma exige d'interpoler le nom dans le
    // texte. Un nom de table venant du catalogue n'est pas dangereux, mais une seule règle vaut mieux
    // que deux.
    let mut requete = connexion
        .prepare(
            "select cid, name, type, \"notnull\", dflt_value, pk \
             from pragma_table_info(?1) order by cid",
        )
        .map_err(|e| traduire(&e))?;

    let brutes: Vec<(i64, String, String, i64, Option<String>, i64)> = requete
        .query_map([table], |ligne| {
            Ok((
                ligne.get(0)?,
                ligne.get(1)?,
                ligne.get(2)?,
                ligne.get(3)?,
                ligne.get(4)?,
                ligne.get(5)?,
            ))
        })
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;

    let etrangeres = colonnes_etrangeres(connexion, table).unwrap_or_default();

    Ok(brutes
        .into_iter()
        .map(|(cid, nom, declare, non_nul, defaut, pk)| ColumnInfo {
            position: u32::try_from(cid + 1).unwrap_or(0),
            category: categorie_de(&declare),
            // La déclaration **telle quelle**, y compris vide : une colonne sans type déclaré est
            // légale en SQLite, et écrire « BLOB » à sa place serait inventer.
            type_name: if declare.is_empty() {
                "(sans type)".to_owned()
            } else {
                declare
            },
            nullable: non_nul == 0 && pk == 0,
            default: defaut,
            // Pas d'`IDENTITY` en SQLite : `AUTOINCREMENT` est une propriété de la table, lisible
            // dans son DDL, et le modèle n'a pas de place pour elle. `14a` affichera le défaut.
            identity: None,
            key: if pk > 0 {
                Some(KeyKind::Primary)
            } else if etrangeres.iter().any(|c| c == &nom) {
                Some(KeyKind::Foreign)
            } else {
                None
            },
            comment: None,
            // **`None` : les colonnes sont déclarées.** La fréquence de `18d` n'a de sens que pour un
            // schéma déduit — ici c'est le *type* qui varie, pas la présence de la colonne.
            frequency: None,
            name: nom,
        })
        .collect())
}

/// Les colonnes de cette table qui portent une clé étrangère.
fn colonnes_etrangeres(connexion: &Connection, table: &str) -> Result<Vec<String>, EngineError> {
    let mut requete = connexion
        .prepare("select \"from\" from pragma_foreign_key_list(?1)")
        .map_err(|e| traduire(&e))?;
    let colonnes = requete
        .query_map([table], |ligne| ligne.get::<_, String>(0))
        .map_err(|e| traduire(&e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| traduire(&e))?;
    Ok(colonnes)
}

/// La catégorie de `06a`, depuis l'**affinité** que SQLite déduirait du type déclaré.
///
/// Les règles sont celles de SQLite lui-même (section « Determination of Column Affinity ») : elles
/// portent sur des sous-chaînes, ce qui est surprenant et qui est la spécification. `VARCHAR(20)`
/// contient `CHAR` donc devient textuel ; `FLOATING POINT` contient `INT` **et** `FLOA`, et SQLite
/// tranche pour l'entier parce que la règle sur `INT` passe d'abord.
pub fn categorie_de(declare: &str) -> TypeCategory {
    let t = declare.to_uppercase();
    if t.contains("INT") {
        return TypeCategory::Number;
    }
    if t.contains("CHAR") || t.contains("CLOB") || t.contains("TEXT") {
        return TypeCategory::Text;
    }
    if t.contains("BLOB") {
        return TypeCategory::Binary;
    }
    if t.contains("REAL") || t.contains("FLOA") || t.contains("DOUB") {
        return TypeCategory::Number;
    }
    if t.contains("NUMERIC") || t.contains("DECIMAL") {
        return TypeCategory::Number;
    }
    // Hors des règles d'affinité, mais courants et affichés différemment : SQLite n'a pas de type
    // date, et les projets écrivent `DATE`, `DATETIME` ou `TIMESTAMP`. Les aligner comme du texte
    // serait juste selon SQLite et faux pour l'œil.
    if t.contains("DATE") || t.contains("TIME") {
        return TypeCategory::Timestamp;
    }
    if t.contains("BOOL") {
        return TypeCategory::Boolean;
    }
    if t.contains("JSON") {
        return TypeCategory::Json;
    }
    TypeCategory::Other
}

/// Le détail d'une table — ce que `A9` affiche.
pub fn detail(connexion: &Connection, table: &str) -> Result<TableDetail, EngineError> {
    let (genre, ddl): (String, Option<String>) = connexion
        .query_row(
            "select type, sql from sqlite_master where name = ?1",
            [table],
            |ligne| Ok((ligne.get(0)?, ligne.get(1)?)),
        )
        .map_err(|_| {
            EngineError::local(format!("la table « {table} » n'existe pas dans ce fichier"))
        })?;
    let vue = genre == "view";

    Ok(TableDetail {
        schema: SCHEMA.to_owned(),
        name: table.to_owned(),
        rows: if vue {
            RowCount::Unknown
        } else {
            compte_exact(connexion, table)
        },
        size_bytes: None,
        comment: None,
        columns: colonnes_de(connexion, table)?,
        indexes: index_de(connexion, table)?,
        constraints: contraintes_de(connexion, table)?,
        triggers: declencheurs_de(connexion, table)?,
        relations: relations_de(connexion, table)?,
        // **Le DDL d'origine, tel qu'il a été tapé.** Seul moteur des trois à le garder : SQLite
        // stocke le texte du `CREATE` dans `sqlite_master`, sans le normaliser. La mention
        // « reconstruit » de `A9` (`14c`) serait donc fausse ici, et `17b` demande de la distinguer.
        ddl: ddl.unwrap_or_else(|| format!("-- SQLite ne garde pas de DDL pour « {table} »")),
    })
}

fn index_de(connexion: &Connection, table: &str) -> Result<Vec<IndexInfo>, EngineError> {
    let mut requete = connexion
        .prepare(
            "select il.name, il.\"unique\", group_concat(ii.name, ', ') \
             from pragma_index_list(?1) il \
             left join pragma_index_info(il.name) ii \
             group by il.name, il.\"unique\" order by il.name",
        )
        .map_err(|e| traduire(&e))?;

    let index = requete
        .query_map([table], |ligne| {
            let nom: String = ligne.get(0)?;
            let unique: i64 = ligne.get(1)?;
            let colonnes: Option<String> = ligne.get(2)?;
            Ok(IndexInfo {
                // **La forme d'un `CREATE INDEX`**, pour que `resumeDIndex` (`14b`) la résume sans
                // une seconde grammaire côté écran — la même décision qu'en `18c`.
                definition: format!(
                    "CREATE {}INDEX {nom} ON {}.{table} USING btree ({})",
                    if unique == 1 { "UNIQUE " } else { "" },
                    SCHEMA,
                    colonnes.unwrap_or_default()
                ),
                name: nom,
            })
        })
        .map_err(|e| traduire(&e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| traduire(&e))?;
    Ok(index)
}

/// Les contraintes, **lues dans le DDL**.
///
/// SQLite n'a pas de catalogue de contraintes : un `CHECK` ou un `UNIQUE` nommé n'existe que dans le
/// texte du `CREATE TABLE`. Les extraire demanderait d'analyser du SQL, ce que le projet refuse
/// depuis `12d` — une analyse approximative afficherait des contraintes fausses.
///
/// Ce qui est **sûr** est rendu : les clés étrangères, que `pragma_foreign_key_list` donne
/// structurées. Le reste est visible dans le DDL que `A9` affiche à côté, et c'est dit.
fn contraintes_de(connexion: &Connection, table: &str) -> Result<Vec<ConstraintInfo>, EngineError> {
    let mut requete = connexion
        .prepare(
            "select id, \"table\", \"from\", \"to\", on_delete \
             from pragma_foreign_key_list(?1) order by id",
        )
        .map_err(|e| traduire(&e))?;

    let contraintes = requete
        .query_map([table], |ligne| {
            let id: i64 = ligne.get(0)?;
            let cible: String = ligne.get(1)?;
            let depuis: String = ligne.get(2)?;
            let vers: Option<String> = ligne.get(3)?;
            let a_la_suppression: String = ligne.get(4)?;
            Ok(ConstraintInfo {
                // SQLite ne nomme pas ses clés étrangères : le nom est composé, et il est **stable**
                // pour une table donnée, ce qui suffit à une clé de liste.
                name: format!("{table}_fk_{id}"),
                definition: format!(
                    "FOREIGN KEY ({depuis}) REFERENCES {cible}({}) ON DELETE {a_la_suppression}",
                    vers.unwrap_or_else(|| "rowid".to_owned())
                ),
            })
        })
        .map_err(|e| traduire(&e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| traduire(&e))?;
    Ok(contraintes)
}

fn declencheurs_de(connexion: &Connection, table: &str) -> Result<Vec<TriggerInfo>, EngineError> {
    let mut requete = connexion
        .prepare(
            "select name, sql from sqlite_master where type = 'trigger' and tbl_name = ?1 \
             order by name",
        )
        .map_err(|e| traduire(&e))?;
    let declencheurs = requete
        .query_map([table], |ligne| {
            Ok(TriggerInfo {
                name: ligne.get(0)?,
                definition: ligne.get::<_, Option<String>>(1)?.unwrap_or_default(),
            })
        })
        .map_err(|e| traduire(&e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| traduire(&e))?;
    Ok(declencheurs)
}

/// Les ensembles de colonnes qu'une garantie d'unicité couvre, pour une table.
///
/// # Ce que SQLite met, et ne met pas, dans `index_list`
///
/// Trois sources, et il faut les trois :
///
/// - **les index et contraintes uniques** — `pragma index_list` les rend avec `unique = 1`, et
///   `pragma index_info` donne leurs colonnes. `partial = 1` les écarte : un index unique partiel ne
///   garantit l'unicité que des lignes qu'il couvre ;
/// - **un index sur expression** rend un `name` nul dans `index_info`. Ses lignes sont donc écartées,
///   et l'ensemble incomplet qui en resterait ne doit pas être retenu — sans quoi `unique(lower(a))`
///   se lirait comme `unique(a)` ;
/// - **`integer primary key`**, qui n'apparaît **dans aucun index** : c'est un alias de `rowid`, et
///   SQLite ne crée pas d'index pour lui. C'est pourtant le `1:1` le plus courant du moteur, et
///   l'oublier ferait annoncer `1:n` un `profil(utilisateur_id integer primary key references …)`.
///   `pragma table_info` le rend par sa colonne `pk`, qui numérote les colonnes de la clé primaire.
fn ensembles_uniques(
    connexion: &Connection,
    table: &str,
) -> Result<Vec<BTreeSet<String>>, EngineError> {
    let mut ensembles = Vec::new();

    let mut primaire = connexion
        .prepare("select name from pragma_table_info(?1) where pk > 0 order by pk")
        .map_err(|e| traduire(&e))?;
    let cle_primaire: BTreeSet<String> = primaire
        .query_map([table], |ligne| ligne.get::<_, String>(0))
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;
    if !cle_primaire.is_empty() {
        ensembles.push(cle_primaire);
    }

    let mut liste = connexion
        .prepare("select name from pragma_index_list(?1) where \"unique\" = 1 and partial = 0")
        .map_err(|e| traduire(&e))?;
    let index: Vec<String> = liste
        .query_map([table], |ligne| ligne.get::<_, String>(0))
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;

    for nom in index {
        let mut colonnes = connexion
            .prepare("select name from pragma_index_info(?1)")
            .map_err(|e| traduire(&e))?;
        let noms: Vec<Option<String>> = colonnes
            .query_map([&nom], |ligne| ligne.get::<_, Option<String>>(0))
            .map_err(|e| traduire(&e))?
            .collect::<Result<_, _>>()
            .map_err(|e| traduire(&e))?;
        // Une seule colonne d'expression suffit à rendre l'ensemble inexploitable : ce qui reste
        // n'est pas ce que l'index garantit, c'est moins.
        if noms.iter().any(Option::is_none) {
            continue;
        }
        ensembles.push(noms.into_iter().flatten().collect());
    }

    Ok(ensembles)
}

/// La cardinalité du côté qui référence : `One` si ses colonnes portent une garantie d'unicité.
///
/// **Une comparaison d'ensembles**, comme chez les deux autres moteurs : un index sur `(b, a)`
/// garantit exactement ce que garantit une clé sur `(a, b)`.
fn cardinalite(uniques: &[BTreeSet<String>], colonnes: &[String]) -> RelationCardinality {
    let cle: BTreeSet<String> = colonnes.iter().cloned().collect();
    if uniques.contains(&cle) {
        RelationCardinality::One
    } else {
        RelationCardinality::Many
    }
}

/// Les clés étrangères **dans les deux sens**, comme `06c` les rend.
///
/// Le sens entrant demande de parcourir toutes les tables : SQLite n'a pas d'index inverse des clés
/// étrangères. C'est un `pragma` par table, acceptable sur un fichier local, et le coût est nommé.
fn relations_de(connexion: &Connection, table: &str) -> Result<Vec<Relation>, EngineError> {
    let mut relations = Vec::new();

    let uniques = ensembles_uniques(connexion, table)?;
    for (id, cible, depuis, vers, toutes) in cles_etrangeres(connexion, table)? {
        relations.push(Relation {
            constraint_name: format!("{table}_fk_{id}"),
            direction: RelationDirection::Outgoing,
            columns: vec![depuis],
            target_schema: SCHEMA.to_owned(),
            target_columns: vec![vers],
            target_table: cible,
            // **La cardinalité se juge sur les colonnes de la clé *entière*, jamais sur celle de la
            // ligne** : `pragma_foreign_key_list` rend une ligne par colonne, et une clé composite
            // dont une seule colonne serait unique n'en dirait rien de l'autre.
            cardinality: cardinalite(&uniques, &toutes),
        });
    }

    let mut noms = connexion
        .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
        .map_err(|e| traduire(&e))?;
    let toutes: Vec<String> = noms
        .query_map([], |ligne| ligne.get::<_, String>(0))
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;

    for autre in toutes.iter().filter(|nom| nom.as_str() != table) {
        let mut uniques_de_lautre = None;
        for (id, cible, depuis, vers, colonnes) in cles_etrangeres(connexion, autre)? {
            if cible != table {
                continue;
            }
            // **L'unicité se lit chez celui qui référence**, donc chez `autre` et non chez `table` :
            // la cardinalité est une propriété de la contrainte, pas du sens sous lequel on la
            // rencontre, et les deux moitiés d'une même clé doivent s'accorder. Lue paresseusement,
            // parce que la plupart des tables parcourues ne référencent pas celle-ci.
            let uniques = match uniques_de_lautre {
                Some(ref deja) => deja,
                None => uniques_de_lautre.insert(ensembles_uniques(connexion, autre)?),
            };
            let cardinality = cardinalite(uniques, &colonnes);
            // **Le sens s'inverse, pas les tables** — la leçon du défaut du 10 août 2026 en `06c` :
            // vue depuis la table pointée, la relation part de *sa* colonne et vise celle de l'autre.
            relations.push(Relation {
                constraint_name: format!("{autre}_fk_{id}"),
                direction: RelationDirection::Incoming,
                columns: vec![vers],
                target_schema: SCHEMA.to_owned(),
                target_table: autre.clone(),
                target_columns: vec![depuis],
                cardinality,
            });
        }
    }

    Ok(relations)
}

/// Les clés étrangères d'une table : `(id, cible, colonne, colonne cible, colonnes de la clé)`.
///
/// **La dernière est la clé entière**, la même pour toutes les lignes d'un même `id` :
/// `pragma_foreign_key_list` rend une ligne **par colonne**, et la cardinalité se juge sur
/// l'ensemble. Le reste des appelants continue de lire une relation par ligne, comme avant.
///
/// `to` nul veut dire « la clé primaire de la cible » — SQLite laisse `references t` sans colonne.
/// C'est `rowid` qui la nomme alors, comme avant ce regroupement.
#[allow(clippy::type_complexity)]
fn cles_etrangeres(
    connexion: &Connection,
    table: &str,
) -> Result<Vec<(i64, String, String, String, Vec<String>)>, EngineError> {
    let mut requete = connexion
        .prepare("select id, \"table\", \"from\", \"to\" from pragma_foreign_key_list(?1)")
        .map_err(|e| traduire(&e))?;
    let lignes: Vec<(i64, String, String, String)> = requete
        .query_map([table], |ligne| {
            Ok((
                ligne.get::<_, i64>(0)?,
                ligne.get::<_, String>(1)?,
                ligne.get::<_, String>(2)?,
                ligne
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "rowid".to_owned()),
            ))
        })
        .map_err(|e| traduire(&e))?
        .collect::<Result<_, _>>()
        .map_err(|e| traduire(&e))?;

    Ok(lignes
        .iter()
        .map(|(id, cible, depuis, vers)| {
            let toutes = lignes
                .iter()
                .filter(|(autre, _, _, _)| autre == id)
                .map(|(_, _, colonne, _)| colonne.clone())
                .collect();
            (*id, cible.clone(), depuis.clone(), vers.clone(), toutes)
        })
        .collect())
}

/// Un identifiant cité aux règles de SQLite : guillemets doubles, doublés à l'intérieur.
///
/// **Vaut aussi pour un nom venant du catalogue.** Une table nommée `order` est un mot réservé, et
/// une seule règle de citation vaut mieux que deux — c'est la leçon de `16c` pour MySQL, appliquée
/// avant d'en avoir besoin.
pub fn citer(identifiant: &str) -> String {
    format!("\"{}\"", identifiant.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l_affinite_suit_les_regles_de_sqlite_y_compris_les_surprenantes() {
        // Les règles portent sur des **sous-chaînes**, ce qui est la spécification et non un raccourci.
        assert_eq!(categorie_de("VARCHAR(20)"), TypeCategory::Text);
        assert_eq!(categorie_de("BIGINT"), TypeCategory::Number);
        // `FLOATING POINT` contient `INT` **et** `FLOA` : SQLite tranche pour l'entier, parce que la
        // règle sur `INT` passe d'abord. Une implémentation « raisonnable » se tromperait ici.
        assert_eq!(categorie_de("FLOATING POINT"), TypeCategory::Number);
        assert_eq!(categorie_de("BLOB"), TypeCategory::Binary);
    }

    #[test]
    fn les_types_de_date_prennent_le_glyphe_horaire_bien_que_sqlite_les_ignore() {
        // SQLite n'a pas de type date : ces déclarations ont l'affinité `NUMERIC` ou `TEXT`. Les
        // aligner comme du texte serait juste selon SQLite, et faux pour l'œil.
        assert_eq!(categorie_de("DATETIME"), TypeCategory::Timestamp);
        assert_eq!(categorie_de("TIMESTAMP"), TypeCategory::Timestamp);
    }

    #[test]
    fn une_colonne_sans_type_declare_est_legale() {
        assert_eq!(categorie_de(""), TypeCategory::Other);
    }

    #[test]
    fn un_identifiant_a_guillemets_est_double_pas_echappe() {
        // La règle de SQL : `"` se double à l'intérieur d'un identifiant cité. Une contre-oblique
        // produirait un nom différent, silencieusement.
        assert_eq!(citer("orders"), "\"orders\"");
        assert_eq!(citer("a\"b"), "\"a\"\"b\"");
    }
}
