//! Requêtes de catalogue et leur mise en correspondance avec le modèle de `06a`.
//!
//! Les catalogues `pg_*` plutôt qu'`information_schema` : ce dernier est portable mais
//! ignore les index, les commentaires d'objet, les tailles physiques et le `TOAST` — or
//! `A4` affiche des tailles et `A9` des index. La portabilité se gagne par le contrat de
//! `06a`, pas par une vue commune qui ne suffit à personne.
//!
//! **Une requête par nature d'objet, jamais une par objet** : ouvrir un schéma de deux
//! cents tables ne doit pas produire deux cents allers-retours.

use std::collections::HashMap;

use tokio_postgres::Client;

use crate::engine::{
    ColumnInfo, ConstraintInfo, EngineError, Identity, IndexInfo, KeyKind, ObjectCounts,
    ObjectKind, Relation, RelationCardinality, RelationDirection, SchemaInfo, TableDetail,
    TableSummary, TriggerInfo,
};

use super::error::traduire;
use super::types::{categoriser, estimation_de};

/// Les schémas du serveur, leurs compteurs d'objets, leur propriétaire et leur nature.
///
/// **Les trois schémas de catalogue sont rendus, marqués `system`, et non exclus** (`API-33`).
/// Ils l'étaient jusqu'au 8 septembre 2026 par une clause `not in`, avec le commentaire « c'est un
/// choix d'affichage, donc réversible, et il doit se lire » : le gestionnaire de schémas est
/// exactement le geste qui le renverse — il les liste, repliés, et rien n'interdit de les afficher.
/// Le choix d'affichage vit donc là où il se prend : **dans l'écran**, où `schemasAffiches` en
/// décide une fois pour l'arbre, le gestionnaire et le préchauffage à la fois. Une seconde lecture
/// « avec le catalogue » aurait fait vivre deux listes que rien n'aurait tenues en phase
/// (règle n° 17).
///
/// Les schémas **temporaires**, eux, restent exclus : `pg_temp_3` appartient à une session, la
/// nôtre ou celle d'un voisin, et n'a rien à faire dans une liste qu'on règle une fois pour toutes.
///
/// `pg_get_userbyid(n.nspowner)` plutôt qu'une jointure sur `pg_roles` : celle-ci demande le droit
/// de lire le catalogue des rôles, que la fonction n'exige pas — et un propriétaire absent aurait
/// vidé la colonne pour un utilisateur sans privilège.
const REQUETE_SCHEMAS: &str = "
select n.nspname                                          as name,
       pg_get_userbyid(n.nspowner)                        as owner,
       n.nspname in ('pg_catalog', 'information_schema', 'pg_toast')
                                                          as system,
       count(*) filter (where c.relkind in ('r','p'))     as tables,
       count(*) filter (where c.relkind in ('v','m'))     as views,
       count(*) filter (where c.relkind = 'i')            as indexes,
       (select count(*) from pg_proc p
         where p.pronamespace = n.oid)                    as functions
  from pg_namespace n
  left join pg_class c on c.relnamespace = n.oid
 where n.nspname not like 'pg\\_temp%'
   and n.nspname not like 'pg\\_toast\\_temp%'
 group by n.nspname, n.oid, n.nspowner
 order by n.nspname";

/// Les objets d'un schéma — les sept colonnes du tableau de `A4`, en une seule requête.
///
/// `pg_stat_all_tables` donne le dernier `ANALYZE`, manuel **ou** automatique : c'est lui
/// qui dit à quel point se fier à l'estimation de `reltuples`, et c'est pourquoi `A4` en
/// fait une colonne.
///
/// # Le filtre `$2`, et ce qu'il a coûté de ne pas l'avoir (3 septembre 2026)
///
/// `table_detail` lisait le résumé d'**une** table en appelant cette requête sur tout le schéma
/// puis en cherchant sa ligne en Rust. Le travail par objet est en sous-requêtes, donc côté
/// serveur — c'est ce que garde le test structurel de `mod.rs` — mais il se fait alors pour
/// *toutes* les tables du schéma, à chaque table décrite. Mesuré sur un schéma synthétique de
/// deux cents relations **vides** — donc le plancher, `pg_total_relation_size` n'ayant rien à
/// parcourir : rejouer la séquence de soixante `table_detail` coûtait 183 ms de requêtes, contre
/// 7,4 ms avec ce filtre. Vingt-cinq fois moins, et l'écart se creuse avec des tables qui portent
/// des données.
///
/// **C'était un défaut, pas un arbitrage** : MySQL lit son résumé par un `exec_first` et SQLite
/// par un `query_row`, une ligne chacun. PostgreSQL était le seul à balayer son schéma pour une
/// table.
///
/// `NULL` rend tout le schéma — ce dont `list_objects` a besoin. Une liste de noms rend ces
/// lignes-là, et le filtre étant dans le `where`, les sous-requêtes de la projection ne
/// s'exécutent que pour elles.
const REQUETE_OBJETS: &str = "
select c.oid                                              as relid,
       c.relname                                          as name,
       c.relkind::text                                    as kind,
       c.reltuples                                        as row_estimate,
       pg_total_relation_size(c.oid)                      as size_bytes,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0
           and not a.attisdropped)                        as column_count,
       (select string_agg(a.attname, ', ' order by k.ord)
          from pg_constraint pk
          cross join unnest(pk.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
         where pk.conrelid = c.oid and pk.contype = 'p')  as primary_key,
       to_char(s.last_analyze, 'YYYY-MM-DD HH24:MI:SS')    as last_analyze,
       obj_description(c.oid, 'pg_class')                  as comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join (select relid, greatest(last_analyze, last_autoanalyze) as last_analyze
               from pg_stat_all_tables) s on s.relid = c.oid
 where n.nspname = $1
   and ($2::text[] is null or c.relname = any($2::text[]))
   and c.relkind in ('r','p','v','m')
 order by c.relname";

/// Expose la requête des objets pour le test structurel de `mod.rs` — il vérifie que le
/// travail par objet se fait en sous-requêtes, donc en un seul aller-retour.
#[cfg(test)]
pub(super) fn requete_objets_pour_test() -> &'static str {
    REQUETE_OBJETS
}

/// Expose les cinq requêtes de détail pour le test structurel de `mod.rs`.
///
/// **Ce qu'aucun test de comportement ne peut garder.** Ces requêtes filtrent sur un *ensemble* ;
/// les réécrire pour une seule table rendrait **exactement les mêmes** structures, en soixante fois
/// plus d'allers-retours. Le sabotage l'a montré : neutraliser le filtre de noms de `REQUETE_OBJETS`
/// laissait les soixante-et-un tests de base verts. C'est donc le **réglage** qu'on garde, et non
/// une durée — la leçon de la règle n° 3, et celle du `nodelay` de `russh`.
#[cfg(test)]
pub(super) fn requetes_de_detail_pour_test() -> [(&'static str, &'static str); 5] {
    [
        ("colonnes", REQUETE_COLONNES),
        ("index", REQUETE_INDEX),
        ("contraintes", REQUETE_CONTRAINTES),
        ("triggers", REQUETE_TRIGGERS),
        ("relations", REQUETE_RELATIONS),
    ]
}

pub async fn schemas(client: &Client) -> Result<Vec<SchemaInfo>, EngineError> {
    let lignes = client
        .query(REQUETE_SCHEMAS, &[])
        .await
        .map_err(|erreur| traduire(&erreur))?;

    lignes
        .iter()
        .map(|ligne| {
            Ok(SchemaInfo {
                name: ligne.try_get("name").map_err(|e| traduire(&e))?,
                owner: ligne.try_get("owner").map_err(|e| traduire(&e))?,
                system: ligne.try_get("system").map_err(|e| traduire(&e))?,
                counts: ObjectCounts {
                    tables: compteur(ligne, "tables")?,
                    views: compteur(ligne, "views")?,
                    functions: compteur(ligne, "functions")?,
                    indexes: compteur(ligne, "indexes")?,
                },
            })
        })
        .collect()
}

pub async fn objects(client: &Client, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
    Ok(resumes(client, schema, None)
        .await?
        .into_iter()
        .map(|(_, resume)| resume)
        .collect())
}

/// Les résumés d'un schéma, **avec l'identifiant interne de chaque relation**.
///
/// L'oid est ce qui permet aux cinq lectures de `table_details` d'être ensemblistes : elles
/// filtrent sur `= any($1::oid[])` et rendent leur `relid`, qu'on regroupe ensuite. Le passer par
/// le nom aurait demandé de le requalifier et de l'échapper dans chaque requête, et un nom n'est
/// pas une identité — deux schémas peuvent porter la même table.
///
/// `noms` à `None` rend tout le schéma ; une liste rend ces relations-là, dans l'ordre du
/// catalogue. Ce qui n'existe pas est simplement **absent** — voir `table_details`.
async fn resumes(
    client: &Client,
    schema: &str,
    noms: Option<&[String]>,
) -> Result<Vec<(u32, TableSummary)>, EngineError> {
    let filtre: Option<Vec<String>> = noms.map(<[String]>::to_vec);
    let lignes = client
        .query(REQUETE_OBJETS, &[&schema, &filtre])
        .await
        .map_err(|erreur| traduire(&erreur))?;

    lignes
        .iter()
        .map(|ligne| {
            let relkind: String = ligne.try_get("kind").map_err(|e| traduire(&e))?;
            let reltuples: f32 = ligne.try_get("row_estimate").map_err(|e| traduire(&e))?;
            let taille: i64 = ligne.try_get("size_bytes").map_err(|e| traduire(&e))?;
            let colonnes: i64 = ligne.try_get("column_count").map_err(|e| traduire(&e))?;
            let relid: u32 = ligne.try_get("relid").map_err(|e| traduire(&e))?;

            Ok((
                relid,
                TableSummary {
                    name: ligne.try_get("name").map_err(|e| traduire(&e))?,
                    kind: nature_de(&relkind),
                    // **Une estimation, jamais un compte exact** : `A4` ouvre un arbre, et
                    // compter exactement coûterait un parcours complet par table. Et `Unknown`
                    // quand le planificateur n'a rien — `reltuples = -1`.
                    rows: estimation_de(reltuples),
                    size_bytes: u64::try_from(taille).ok(),
                    column_count: u32::try_from(colonnes).unwrap_or(0),
                    primary_key: ligne.try_get("primary_key").map_err(|e| traduire(&e))?,
                    last_analyze: ligne.try_get("last_analyze").map_err(|e| traduire(&e))?,
                    comment: ligne.try_get("comment").map_err(|e| traduire(&e))?,
                },
            ))
        })
        .collect()
}

/// `pg_class.relkind` vers la nature d'objet de `06a`.
///
/// `r`/`p` sont des tables (ordinaire, partitionnée), `v`/`m` des vues (simple,
/// matérialisée). La requête ne rend que ces quatre-là ; le repli sur `Table` couvre un
/// `relkind` qu'une version future de PostgreSQL ajouterait.
fn nature_de(relkind: &str) -> ObjectKind {
    match relkind {
        "v" | "m" => ObjectKind::View,
        "i" => ObjectKind::Index,
        _ => ObjectKind::Table,
    }
}

/// Les `count(*)` de PostgreSQL sont des `bigint` ; le modèle porte des `u32`, largement
/// suffisants pour un nombre d'objets dans un schéma.
fn compteur(ligne: &tokio_postgres::Row, colonne: &str) -> Result<u32, EngineError> {
    let valeur: i64 = ligne.try_get(colonne).map_err(|e| traduire(&e))?;
    Ok(u32::try_from(valeur).unwrap_or(u32::MAX))
}

/*
 * # Cinq lectures **ensemblistes**, et pourquoi (3 septembre 2026)
 *
 * Ces requêtes portaient sur une table, désignée par son nom qualifié. Décrire soixante tables
 * coûtait donc soixante fois cinq allers-retours, tous sérialisés — le registre tient son verrou
 * pendant toute l'opération, délibérément (voir `ConnectionRegistry::avec`), donc rien ne se
 * chevauche. Sur une base joignable à travers un tunnel, c'est ce compte qui décide du temps
 * d'attente, pas le coût des requêtes : trois cent soixante allers-retours à cent millisecondes
 * font une demi-minute, à quatre cents une poignée de minutes. C'est le défaut rapporté sur le
 * diagramme d'un grand schéma.
 *
 * Elles filtrent donc sur un **ensemble d'oid** et rendent leur `relid`, que `table_details`
 * regroupe. Cinq allers-retours pour tout un schéma, plus un pour les résumés.
 *
 * **Il n'y a pas deux versions de ces requêtes.** `table_detail` passe par `table_details` avec un
 * seul nom : c'est la même SQL pour une table et pour soixante, donc les tests qui existaient
 * l'exercent toujours, et il n'y a pas une forme « pour une table » qui vieillirait à part.
 */

/// Les colonnes des tables demandées, avec leur catégorie de type et leur rôle de clé.
///
/// Les deux `left join` de clés sont **groupés par `conrelid`** : sans lui, la clé primaire d'une
/// table marquerait les colonnes de même rang de toutes les autres.
const REQUETE_COLONNES: &str = "
select a.attrelid                                          as relid,
       a.attnum                                           as position,
       a.attname                                          as name,
       format_type(a.atttypid, a.atttypmod)               as type_name,
       t.typcategory::text                                as pg_category,
       t.typname                                          as pg_type_name,
       not a.attnotnull                                   as nullable,
       pg_get_expr(d.adbin, d.adrelid)                    as default_value,
       nullif(a.attidentity::text, '')                    as identity,
       case when pk.attnum is not null then 'primary'
            when fk.attnum is not null then 'foreign' end as key_kind,
       col_description(a.attrelid, a.attnum)              as comment
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  left join (select conrelid, unnest(conkey) as attnum from pg_constraint
              where conrelid = any($1::oid[]) and contype = 'p') pk
         on pk.conrelid = a.attrelid and pk.attnum = a.attnum
  left join (select conrelid, unnest(conkey) as attnum from pg_constraint
              where conrelid = any($1::oid[]) and contype = 'f') fk
         on fk.conrelid = a.attrelid and fk.attnum = a.attnum
 where a.attrelid = any($1::oid[]) and a.attnum > 0 and not a.attisdropped
 order by a.attrelid, a.attnum";

/// `pg_indexes` ne porte pas d'oid : c'est le seul des cinq à se grouper par **nom de table**.
const REQUETE_INDEX: &str = "
select tablename as table_name, indexname as name, indexdef as definition
  from pg_indexes where schemaname = $1 and tablename = any($2::text[])
 order by tablename, indexname";

const REQUETE_CONTRAINTES: &str = "
select conrelid as relid, conname as name, pg_get_constraintdef(oid) as definition
  from pg_constraint where conrelid = any($1::oid[]) order by conrelid, conname";

/// `not tgisinternal` : `pg_trigger` contient ceux que les clés étrangères créent, et `A9`
/// n'a pas à montrer des triggers que l'utilisateur n'a pas écrits.
const REQUETE_TRIGGERS: &str = "
select tgrelid as relid, tgname as name, pg_get_triggerdef(oid) as definition
  from pg_trigger where tgrelid = any($1::oid[]) and not tgisinternal
 order by tgrelid, tgname";

/// Les clés étrangères des tables demandées, **dans les deux sens** : sortante pour suivre une
/// référence, entrante pour savoir qui référence cette table. `A4` montre un bloc « Relations »,
/// `A5` un aperçu de « ligne liée », et le diagramme en fait ses flèches.
///
/// # Le défaut du 10 août 2026, et pourquoi il était invisible
///
/// La version d'alors joignait les colonnes sur `con.conrelid` dans les deux sens. Pour une
/// relation **entrante**, elle prenait donc `confkey` — des numéros d'attribut de *notre* table —
/// et les cherchait dans la table *étrangère*. Deux conséquences : des noms de colonnes **faux**
/// quand les numéros existaient de part et d'autre — et le test passait, `users.id` et `orders.id`
/// étant tous deux en position 1 — ou un `array_agg` à `NULL` qui **empêchait d'ouvrir la table**.
///
/// La version correcte tient en une phrase : les colonnes du **sujet** se cherchent dans le sujet,
/// celles de la cible dans la cible.
///
/// # `unique_source` : ce qui sépare un `1:1` d'un `1:n`
///
/// La cardinalité ne dépend **pas du sens sous lequel on rencontre la relation** — c'est une
/// propriété de la contrainte, pas du regard : elle se lit donc toujours sur `con.conrelid`, la
/// table qui référence, et les deux moitiés d'une même clé s'accordent forcément. C'est ce que
/// l'écran attend : il les déduplique par `(source, contrainte)` et garde la première vue.
///
/// Trois précautions, chacune un faux `1:1` qu'elle écarte :
///
/// - **`indpred is null`** — un index unique **partiel** ne garantit l'unicité que sur les lignes
///   qu'il couvre. `unique (a) where actif` laisse dix lignes inactives viser la même cible ;
/// - **`indkey` tronqué à `indnkeyatts`** — les colonnes d'un `include` suivent les colonnes de
///   clé dans `indkey` et **ne participent pas** à l'unicité. Les compter ferait rater l'index
///   unique qui répondait, donc rendrait `1:n` un vrai `1:1` ;
/// - **`array_agg(distinct …)`, des deux côtés** — c'est une comparaison d'**ensembles**, non de
///   listes : un index sur `(b, a)` garantit exactement ce que garantit une clé sur `(a, b)`, et
///   comparer dans l'ordre déclaré aurait fait dépendre la réponse de la façon dont l'index a été
///   écrit. Un `array_agg` sans `distinct` aurait de plus fait diverger `(a, a)` de `(a)`, que
///   Postgres n'autorise pas mais qui ne coûte rien à écarter.
///
/// Une clé primaire est portée par un index unique, donc elle répond ici sans être nommée : c'est
/// le cas le plus courant du `1:1`, `profil.utilisateur_id` à la fois primaire et étrangère.
///
/// # Le sujet vient d'un `unnest`, et c'est ce qui rend la requête ensembliste
///
/// Une même contrainte peut concerner **deux** sujets demandés — l'un la déclare en sortie, l'autre
/// en entrée. Le `join` sur la liste des sujets rend donc une ligne par couple, là où un filtre sur
/// `conrelid in (…)` en aurait perdu une.
const REQUETE_RELATIONS: &str = "
select sujet.oid                                          as relid,
       con.conname                                        as constraint_name,
       (con.conrelid = sujet.oid)                         as outgoing,
       cn.nspname                                         as target_schema,
       ct.relname                                         as target_table,
       (select array_agg(a.attname order by k.ord)
          from unnest(case when con.conrelid = sujet.oid
                           then con.conkey else con.confkey end)
               with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = sujet.oid
                             and a.attnum = k.attnum)     as columns,
       (select array_agg(a.attname order by k.ord)
          from unnest(case when con.conrelid = sujet.oid
                           then con.confkey else con.conkey end)
               with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = ct.oid
                             and a.attnum = k.attnum)     as target_columns,
       exists (select 1 from pg_index i
                where i.indrelid = con.conrelid
                  and i.indisunique
                  and i.indpred is null
                  and (select array_agg(distinct k)
                         from unnest((i.indkey::int2[])[0:i.indnkeyatts - 1]) k)
                    = (select array_agg(distinct k)
                         from unnest(con.conkey) k))      as unique_source
  from unnest($1::oid[]) as sujet(oid)
  join pg_constraint con on con.contype = 'f'
                        and (con.conrelid = sujet.oid or con.confrelid = sujet.oid)
  join pg_class ct on ct.oid = case when con.conrelid = sujet.oid
                                    then con.confrelid else con.conrelid end
  join pg_namespace cn on cn.oid = ct.relnamespace
 order by sujet.oid, con.conname";

/// Le détail d'une table — tout ce que `A9` affiche, DDL compris.
///
/// **Un cas particulier de `table_details`**, et non une seconde implémentation : la SQL est la
/// même pour une table et pour soixante. Ce qui lui appartient en propre est le **refus** — une
/// table absente est une erreur ici, alors que la lecture d'un schéma se contente de l'omettre.
pub async fn table_detail(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<TableDetail, EngineError> {
    table_details(client, schema, std::slice::from_ref(&table.to_owned()))
        .await?
        .pop()
        .ok_or_else(|| {
            EngineError::local(format!(
                "la table « {table} » est absente du schéma « {schema} »"
            ))
        })
}

/// Le détail de **plusieurs** tables, en six allers-retours quel qu'en soit le nombre.
///
/// # Ce que ça remplace
///
/// Décrire soixante tables coûtait soixante fois six allers-retours, tous sérialisés par le verrou
/// du registre, dont soixante balayages du schéma entier pour lire soixante lignes de résumé. Ici :
/// un aller-retour pour les résumés, cinq pour les colonnes, index, contraintes, triggers et
/// relations de **toutes** les tables demandées. Trois cent soixante allers-retours deviennent six.
///
/// # Ce qui n'existe pas se tait, il n'échoue pas
///
/// Une table demandée que le catalogue ne connaît pas est **absente du résultat**. C'est
/// délibéré, et c'est la différence assumée avec `table_detail` : une lecture de schéma part d'une
/// liste que quelqu'un a établie un instant plus tôt, et une table retirée entre-temps ne doit pas
/// emporter les cinquante-neuf autres. C'est aussi ce qui garde le `::regclass` hors de la SQL :
/// les oid viennent du catalogue, donc aucune requête ne peut échouer sur un nom inconnu.
///
/// # L'ordre rendu est celui demandé
///
/// Le catalogue trie par nom ; l'appelant, lui, a ses raisons — le diagramme lit dans l'ordre où il
/// dessine. Rendre son ordre lui évite de reconstruire une table de correspondance.
pub async fn table_details(
    client: &Client,
    schema: &str,
    tables: &[String],
) -> Result<Vec<TableDetail>, EngineError> {
    if tables.is_empty() {
        return Ok(vec![]);
    }

    let resumes = resumes(client, schema, Some(tables)).await?;
    if resumes.is_empty() {
        return Ok(vec![]);
    }
    let oids: Vec<u32> = resumes.iter().map(|(oid, _)| *oid).collect();
    let noms: Vec<String> = resumes
        .iter()
        .map(|(_, resume)| resume.name.clone())
        .collect();

    let mut colonnes: HashMap<u32, Vec<ColumnInfo>> = HashMap::new();
    for ligne in client
        .query(REQUETE_COLONNES, &[&oids])
        .await
        .map_err(|e| traduire(&e))?
        .iter()
    {
        let relid: u32 = ligne.try_get("relid").map_err(|e| traduire(&e))?;
        colonnes
            .entry(relid)
            .or_default()
            .push(colonne_depuis(ligne)?);
    }

    // L'index est le seul des cinq à se grouper par **nom** : `pg_indexes` ne porte pas d'oid.
    let mut index: HashMap<String, Vec<IndexInfo>> = HashMap::new();
    for ligne in client
        .query(REQUETE_INDEX, &[&schema, &noms])
        .await
        .map_err(|e| traduire(&e))?
        .iter()
    {
        let table: String = ligne.try_get("table_name").map_err(|e| traduire(&e))?;
        index.entry(table).or_default().push(IndexInfo {
            name: ligne.try_get("name").map_err(|e| traduire(&e))?,
            definition: ligne.try_get("definition").map_err(|e| traduire(&e))?,
        });
    }

    let mut contraintes: HashMap<u32, Vec<ConstraintInfo>> = HashMap::new();
    for ligne in client
        .query(REQUETE_CONTRAINTES, &[&oids])
        .await
        .map_err(|e| traduire(&e))?
        .iter()
    {
        let relid: u32 = ligne.try_get("relid").map_err(|e| traduire(&e))?;
        contraintes.entry(relid).or_default().push(ConstraintInfo {
            name: ligne.try_get("name").map_err(|e| traduire(&e))?,
            definition: ligne.try_get("definition").map_err(|e| traduire(&e))?,
        });
    }

    let mut triggers: HashMap<u32, Vec<TriggerInfo>> = HashMap::new();
    for ligne in client
        .query(REQUETE_TRIGGERS, &[&oids])
        .await
        .map_err(|e| traduire(&e))?
        .iter()
    {
        let relid: u32 = ligne.try_get("relid").map_err(|e| traduire(&e))?;
        triggers.entry(relid).or_default().push(TriggerInfo {
            name: ligne.try_get("name").map_err(|e| traduire(&e))?,
            definition: ligne.try_get("definition").map_err(|e| traduire(&e))?,
        });
    }

    let mut relations: HashMap<u32, Vec<Relation>> = HashMap::new();
    for ligne in client
        .query(REQUETE_RELATIONS, &[&oids])
        .await
        .map_err(|e| traduire(&e))?
        .iter()
    {
        let relid: u32 = ligne.try_get("relid").map_err(|e| traduire(&e))?;
        // `relation_depuis` omet **et journalise** une relation dont le catalogue n'a pas rendu les
        // colonnes : une ligne manquante dans le bloc « Relations » plutôt qu'une table
        // inouvrable. Voir sa documentation.
        if let Some(relation) = relation_depuis(ligne) {
            relations.entry(relid).or_default().push(relation);
        }
    }

    let mut par_nom: HashMap<String, TableDetail> = HashMap::with_capacity(resumes.len());
    for (oid, resume) in resumes {
        let colonnes = colonnes.remove(&oid).unwrap_or_default();
        let contraintes = contraintes.remove(&oid).unwrap_or_default();
        let index = index.remove(&resume.name).unwrap_or_default();
        let ddl = assembler_ddl(schema, &resume.name, &colonnes, &contraintes, &index);
        par_nom.insert(
            resume.name.clone(),
            TableDetail {
                schema: schema.to_owned(),
                name: resume.name,
                rows: resume.rows,
                size_bytes: resume.size_bytes,
                comment: resume.comment,
                columns: colonnes,
                indexes: index,
                constraints: contraintes,
                triggers: triggers.remove(&oid).unwrap_or_default(),
                relations: relations.remove(&oid).unwrap_or_default(),
                ddl,
            },
        );
    }

    // L'ordre demandé, et un nom demandé deux fois ne rend qu'une entrée : `remove` la sort de la
    // table, donc la seconde demande ne trouve plus rien.
    Ok(tables
        .iter()
        .filter_map(|nom| par_nom.remove(nom))
        .collect())
}

fn colonne_depuis(ligne: &tokio_postgres::Row) -> Result<ColumnInfo, EngineError> {
    let position: i16 = ligne.try_get("position").map_err(|e| traduire(&e))?;
    let categorie: String = ligne.try_get("pg_category").map_err(|e| traduire(&e))?;
    let nom_pg: String = ligne.try_get("pg_type_name").map_err(|e| traduire(&e))?;
    let role: Option<String> = ligne.try_get("key_kind").map_err(|e| traduire(&e))?;

    Ok(ColumnInfo {
        position: u32::try_from(position).unwrap_or(0),
        name: ligne.try_get("name").map_err(|e| traduire(&e))?,
        type_name: ligne.try_get("type_name").map_err(|e| traduire(&e))?,
        category: categoriser(categorie.chars().next().unwrap_or('?'), &nom_pg),
        nullable: ligne.try_get("nullable").map_err(|e| traduire(&e))?,
        default: ligne.try_get("default_value").map_err(|e| traduire(&e))?,
        // `attidentity` vaut `a`, `d`, ou la chaîne vide — que la requête a déjà changée en
        // `NULL`. Un caractère inconnu se lit comme « pas d'identité » plutôt que de faire
        // échouer la lecture de la table pour une lettre qu'une version future ajouterait.
        identity: match ligne
            .try_get::<_, Option<String>>("identity")
            .map_err(|e| traduire(&e))?
            .as_deref()
        {
            Some("a") => Some(Identity::Always),
            Some("d") => Some(Identity::ByDefault),
            _ => None,
        },
        key: match role.as_deref() {
            Some("primary") => Some(KeyKind::Primary),
            Some("foreign") => Some(KeyKind::Foreign),
            _ => None,
        },
        comment: ligne.try_get("comment").map_err(|e| traduire(&e))?,
        // **`None`, et ce n'est pas « inconnu »** : une colonne SQL est déclarée, donc elle
        // existe pour toutes les lignes. La fréquence n'a de sens que pour un schéma déduit.
        frequency: None,
    })
}

/// Une relation, **ou rien** quand elle est illisible.
///
/// `Option` et non `Result` : une relation dont on ne sait pas nommer les colonnes doit être
/// **omise**, pas faire échouer tout `table_detail`. C'est la leçon du défaut du 10 août 2026 —
/// un `array_agg` à `NULL` empêchait d'ouvrir la table, alors que le pire qu'il pouvait coûter
/// était une ligne manquante dans le bloc « Relations ».
///
/// L'omission est **journalisée** : une relation qui disparaît sans un mot serait un mensonge par
/// omission, et c'est précisément ce que le bloc « Relations » ne doit pas faire.
fn relation_depuis(ligne: &tokio_postgres::Row) -> Option<Relation> {
    let sortante: bool = ligne.try_get("outgoing").ok()?;
    let nom: String = ligne.try_get("constraint_name").ok()?;

    let colonnes: Option<Vec<String>> = ligne.try_get("columns").ok().flatten();
    let colonnes_cibles: Option<Vec<String>> = ligne.try_get("target_columns").ok().flatten();

    let (Some(columns), Some(target_columns)) = (colonnes, colonnes_cibles) else {
        log::warn!(
            "relation « {nom} » omise : le catalogue n'a pas rendu ses colonnes — la table reste \
             lisible, son bloc « Relations » est incomplet"
        );
        return None;
    };

    Some(Relation {
        constraint_name: nom,
        direction: if sortante {
            RelationDirection::Outgoing
        } else {
            RelationDirection::Incoming
        },
        columns,
        target_schema: ligne.try_get("target_schema").ok()?,
        target_table: ligne.try_get("target_table").ok()?,
        target_columns,
        // **Le repli est `Many`, et c'est le bon sens du doute** : c'est ce qu'une clé étrangère est
        // dans l'immense majorité des cas, et une flèche `1:n` là où le schéma dit `1:1` se corrige
        // d'un coup d'œil à la table, tandis qu'un `1:1` annoncé à tort ferait écrire une jointure
        // qui rend plus de lignes qu'annoncé.
        cardinality: if ligne.try_get("unique_source").unwrap_or(false) {
            RelationCardinality::One
        } else {
            RelationCardinality::Many
        },
    })
}

/// Assemble le `CREATE TABLE` de `A9`.
///
/// Les morceaux viennent **déjà formatés** du catalogue : `format_type` pour les types,
/// `pg_get_expr` pour les défauts, `pg_get_constraintdef` pour les contraintes. Rien n'est
/// reconstruit à la main — la spec `06c` le justifie : types de tableaux, défauts avec
/// appels de fonction et contraintes d'exclusion rendent la reconstruction manuelle sans
/// fin. La seule chose assemblée ici est la **ponctuation**.
///
/// Vérifié en le **rejouant** sur une base vierge : un DDL qui ne se réexécute pas est faux.
fn assembler_ddl(
    schema: &str,
    table: &str,
    colonnes: &[ColumnInfo],
    contraintes: &[ConstraintInfo],
    index: &[IndexInfo],
) -> String {
    let mut lignes: Vec<String> = colonnes
        .iter()
        .map(|colonne| {
            // Une colonne `serial` rend, dans le catalogue, un type entier plus un défaut
            // `nextval('…_seq')` — donc un DDL qui référence une séquence **qu'il ne crée
            // pas**. Rejoué dans un schéma vierge, il échoue. Trouvé par le test de rejeu,
            // et c'est précisément ce qu'il est là pour trouver.
            //
            // Le type pseudo `serial` recrée la séquence, ce qui rend le DDL autonome.
            if let Some(pseudo) = pseudo_type_serial(colonne) {
                let mut ligne = format!("    {} {pseudo}", colonne.name);
                if !colonne.nullable {
                    ligne.push_str(" NOT NULL");
                }
                return ligne;
            }

            let mut ligne = format!("    {} {}", colonne.name, colonne.type_name);
            // Une identité n'est **pas** dans `pg_attrdef` : sans cette clause, le DDL rendait
            // `id bigint NOT NULL` — rejouable, et pourtant faux : la copie perdait son
            // auto-incrément. Le test de rejeu ne le voyait pas, parce qu'il ne comparait que
            // position, nom, type et nullité. Trouvé en branchant `A9` (`14c`), qui affiche ce
            // DDL à l'écran.
            if let Some(identite) = colonne.identity {
                ligne.push_str(match identite {
                    Identity::Always => " GENERATED ALWAYS AS IDENTITY",
                    Identity::ByDefault => " GENERATED BY DEFAULT AS IDENTITY",
                });
            } else if let Some(defaut) = &colonne.default {
                ligne.push_str(&format!(" DEFAULT {defaut}"));
            }
            if !colonne.nullable {
                ligne.push_str(" NOT NULL");
            }
            ligne
        })
        .collect();

    lignes.extend(
        contraintes
            .iter()
            .map(|c| format!("    CONSTRAINT {} {}", c.name, c.definition)),
    );

    let creation = format!(
        "CREATE TABLE {schema}.{table} (\n{}\n);",
        lignes.join(",\n")
    );

    // **Les index qui ne portent pas de contrainte sont ajoutés après le `CREATE TABLE`.** Le
    // mockup d'`A9` les montre ainsi, et sans eux le DDL copié recrée une table *sans ses index* :
    // rejouable, et pourtant pas la même table — le même genre de perte silencieuse que l'identité
    // manquante.
    //
    // Ceux d'une clé primaire ou d'une unicité sont **omis** : PostgreSQL les crée lui-même avec
    // la contrainte, et les répéter ferait échouer le rejeu sur un nom déjà pris. Ils portent le
    // nom de leur contrainte, ce qui suffit à les reconnaître.
    let portes_par_une_contrainte: Vec<&str> =
        contraintes.iter().map(|c| c.name.as_str()).collect();
    let supplementaires: Vec<String> = index
        .iter()
        .filter(|i| !portes_par_une_contrainte.contains(&i.name.as_str()))
        .map(|i| format!("{};", i.definition.trim_end_matches(';')))
        .collect();

    if supplementaires.is_empty() {
        creation
    } else {
        format!("{creation}\n\n{}", supplementaires.join("\n"))
    }
}

/// Le type pseudo `serial` correspondant, si cette colonne en est une.
///
/// Reconnue à son défaut `nextval(…)` sur un type entier. Rendre `bigserial` plutôt que
/// `bigint DEFAULT nextval('…')` fait créer la séquence par le DDL lui-même, donc le rend
/// rejouable — la spec `06c` en fait un critère.
fn pseudo_type_serial(colonne: &ColumnInfo) -> Option<&'static str> {
    let defaut = colonne.default.as_deref()?;
    if !defaut.starts_with("nextval(") {
        return None;
    }
    match colonne.type_name.as_str() {
        "smallint" => Some("smallserial"),
        "integer" => Some("serial"),
        "bigint" => Some("bigserial"),
        // Un `nextval` sur un type non entier existe (une colonne `numeric` avec un défaut
        // de séquence) : là, garder la forme explicite est juste.
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_natures_d_objet_se_traduisent() {
        assert_eq!(nature_de("r"), ObjectKind::Table);
        assert_eq!(nature_de("p"), ObjectKind::Table);
        assert_eq!(nature_de("v"), ObjectKind::View);
        assert_eq!(nature_de("m"), ObjectKind::View);
        assert_eq!(nature_de("i"), ObjectKind::Index);
    }

    #[test]
    fn un_relkind_inconnu_retombe_sur_table() {
        // Plutôt qu'une panique : une version future de PostgreSQL pourrait en ajouter.
        assert_eq!(nature_de("z"), ObjectKind::Table);
    }

    #[test]
    fn les_schemas_systeme_sont_exclus_explicitement() {
        // Le test lit la requête : l'exclusion doit se **voir**, pas résulter d'un effet
        // de bord. Si quelqu'un la retire, ce test le dit.
        for systeme in ["pg_catalog", "information_schema", "pg_toast"] {
            assert!(
                REQUETE_SCHEMAS.contains(systeme),
                "{systeme} doit être exclu explicitement"
            );
        }
    }

    #[test]
    fn la_requete_des_objets_est_parametree() {
        // Le nom de schéma passe en paramètre lié, jamais par interpolation : cet outil
        // exécute du SQL, une injection y passerait inaperçue.
        assert!(REQUETE_OBJETS.contains("$1"));
        assert!(!REQUETE_OBJETS.contains("format!"));
    }
}
