//! La structure d'un projet BigQuery : ses jeux de données, ses tables, leurs colonnes (`21`).
//!
//! **Le niveau « schéma » porte les jeux de données du projet** — la même lecture que MongoDB, où ce
//! sont les bases du serveur (voir le tableau des moteurs d'`AGENTS.md`).
//!
//! **Le DDL est reconstruit**, comme PostgreSQL (`14c`) : ce module n'interroge pas
//! `INFORMATION_SCHEMA.TABLES.ddl` — une requête de plus, dont la disponibilité et la forme exacte
//! n'ont pu être vérifiées contre un vrai projet (`21` : aucun décor de test). Le reconstruire depuis
//! le schéma déjà lu est une fonction pure, testable sans réseau, et honnête sur ce qu'elle rend :
//! une déclaration équivalente, pas le texte tapé par quelqu'un.
//!
//! **Index, contraintes, déclencheurs et relations restent vides.** BigQuery a des clés primaires et
//! étrangères *déclarées* depuis 2023, mais `gcp_bigquery_client` 0.24 ne les modélise pas encore —
//! aucun champ `tableConstraints` sur `Table`. Les rendre vides est la même conclusion que pour les
//! fonctions de SQLite (`17a`) : une absence réelle se dit, elle ne s'invente pas.

use gcp_bigquery_client::model::table::Table;
use gcp_bigquery_client::model::table_field_schema::TableFieldSchema;
use gcp_bigquery_client::Client;

use crate::engine::{
    ColumnInfo, EngineError, ObjectCounts, ObjectKind, RowCount, SchemaInfo, TableDetail,
    TableSummary,
};

use super::erreur::traduire;
use super::valeurs;

/// Les jeux de données du projet, avec leurs compteurs.
///
/// **Un aller-retour par jeu de données** pour compter tables et vues : l'API de liste ne rend pas
/// de compteur agrégé, et `dataset.list` ne donne que les identifiants. Coûteux si le projet porte
/// des centaines de jeux de données ; acceptable pour l'explorateur d'un projet de travail.
pub async fn schemas(client: &Client, projet: &str) -> Result<Vec<SchemaInfo>, EngineError> {
    let reponse = client
        .dataset()
        .list(projet, Default::default())
        .await
        .map_err(traduire)?;

    let mut resultat = Vec::new();
    for jeu in reponse.datasets {
        let id = jeu.dataset_reference.dataset_id;
        let tables = client
            .table()
            .list(projet, &id, Default::default())
            .await
            .map_err(traduire)?;
        let liste = tables.tables.unwrap_or_default();
        let counts = ObjectCounts {
            tables: liste.iter().filter(|t| !est_une_vue(&t.r#type)).count() as u32,
            views: liste.iter().filter(|t| est_une_vue(&t.r#type)).count() as u32,
            // Les routines (fonctions, procédures) existent côté BigQuery mais ne font pas partie
            // du tableau d'objets de `A4`, qui liste des tables — voir `objects` ci-dessous.
            functions: 0,
            indexes: 0,
        };
        resultat.push(SchemaInfo { name: id, counts });
    }
    Ok(resultat)
}

fn est_une_vue(genre: &Option<String>) -> bool {
    matches!(genre.as_deref(), Some("VIEW") | Some("MATERIALIZED_VIEW"))
}

/// Les tables et vues d'un jeu de données — le tableau de `A4`.
///
/// **Un `table.get` par table** pour le compte de lignes et la taille : `table.list` ne les rend pas
/// (`TableListTables` est une réponse allégée). Même arbitrage que `schemas` ci-dessus.
pub async fn objects(
    client: &Client,
    projet: &str,
    jeu: &str,
) -> Result<Vec<TableSummary>, EngineError> {
    let liste = client
        .table()
        .list(projet, jeu, Default::default())
        .await
        .map_err(traduire)?
        .tables
        .unwrap_or_default();

    let mut resultat = Vec::with_capacity(liste.len());
    for entree in liste {
        let table = client
            .table()
            .get(projet, jeu, &entree.table_reference.table_id, None)
            .await
            .map_err(traduire)?;
        resultat.push(resume_de(&table));
    }
    Ok(resultat)
}

fn resume_de(table: &Table) -> TableSummary {
    let colonnes = table.schema.fields.clone().unwrap_or_default();
    TableSummary {
        name: table.table_reference.table_id.clone(),
        kind: if est_une_vue(&table.r#type) {
            ObjectKind::View
        } else {
            ObjectKind::Table
        },
        // **Estimé, jamais exact** : `numRows` exclut le tampon de diffusion (streaming buffer) —
        // une table qui reçoit des écritures en continu aurait un compte légèrement en retard.
        rows: table
            .num_rows
            .as_deref()
            .and_then(|n| n.parse::<i64>().ok())
            .map(|value| RowCount::Estimated { value })
            .unwrap_or(RowCount::Unknown),
        size_bytes: table
            .num_bytes
            .as_deref()
            .and_then(|n| n.parse::<u64>().ok()),
        column_count: colonnes.len() as u32,
        // Voir le commentaire de tête : aucune clé primaire déclarée n'est modélisée par la crate.
        primary_key: None,
        last_analyze: table.last_modified_time.clone(),
        comment: table
            .description
            .clone()
            .or_else(|| table.friendly_name.clone()),
    }
}

/// Le détail d'une table, DDL compris — ce que `A9` affiche.
pub async fn detail(
    client: &Client,
    projet: &str,
    jeu: &str,
    table: &str,
) -> Result<TableDetail, EngineError> {
    let table_bq = client
        .table()
        .get(projet, jeu, table, None)
        .await
        .map_err(traduire)?;

    let champs = table_bq.schema.fields.clone().unwrap_or_default();
    let colonnes: Vec<ColumnInfo> = champs
        .iter()
        .enumerate()
        .map(|(rang, champ)| colonne_de(rang as u32, champ))
        .collect();

    Ok(TableDetail {
        schema: jeu.to_owned(),
        name: table.to_owned(),
        rows: table_bq
            .num_rows
            .as_deref()
            .and_then(|n| n.parse::<i64>().ok())
            .map(|value| RowCount::Estimated { value })
            .unwrap_or(RowCount::Unknown),
        size_bytes: table_bq
            .num_bytes
            .as_deref()
            .and_then(|n| n.parse::<u64>().ok()),
        comment: table_bq.description.clone(),
        ddl: ddl_reconstruit(projet, jeu, table, &champs),
        columns: colonnes,
        indexes: Vec::new(),
        constraints: Vec::new(),
        triggers: Vec::new(),
        relations: Vec::new(),
    })
}

fn colonne_de(rang: u32, champ: &TableFieldSchema) -> ColumnInfo {
    ColumnInfo {
        position: rang + 1,
        name: champ.name.clone(),
        type_name: valeurs::nom_du_type(champ),
        category: valeurs::categorie(champ),
        // `REQUIRED` est le seul mode qui interdit `NULL` ; `NULLABLE` (le défaut, `mode` absent) et
        // `REPEATED` l'acceptent tous deux — un tableau vide `[]` n'est pas la même chose qu'un
        // `NULL`, mais BigQuery ne distingue pas les deux au niveau du champ.
        nullable: champ.mode.as_deref() != Some("REQUIRED"),
        default: None,
        identity: None,
        // Voir le commentaire de tête du module.
        key: None,
        comment: champ.description.clone(),
        // Les colonnes sont **déclarées** ici, contrairement à MongoDB (`18d`) : la fréquence n'a
        // pas de sens pour un schéma qui existe pour toutes les lignes.
        frequency: None,
    }
}

/// Le `CREATE TABLE` reconstruit — voir le commentaire de tête sur pourquoi ce n'est pas une lecture
/// de `INFORMATION_SCHEMA.TABLES.ddl`.
fn ddl_reconstruit(projet: &str, jeu: &str, table: &str, champs: &[TableFieldSchema]) -> String {
    let mut lignes: Vec<String> = champs
        .iter()
        .map(|champ| {
            let mut ligne = format!(
                "  {} {}",
                super::rows::citer(&champ.name),
                valeurs::nom_du_type(champ)
            );
            if champ.mode.as_deref() == Some("REQUIRED") {
                ligne.push_str(" NOT NULL");
            }
            ligne
        })
        .collect();
    if lignes.is_empty() {
        return format!(
            "CREATE TABLE {} ()",
            super::rows::citer_table(projet, jeu, table)
        );
    }
    let derniere = lignes.len() - 1;
    for (rang, ligne) in lignes.iter_mut().enumerate() {
        if rang != derniere {
            ligne.push(',');
        }
    }
    format!(
        "CREATE TABLE {} (\n{}\n)",
        super::rows::citer_table(projet, jeu, table),
        lignes.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use gcp_bigquery_client::model::field_type::FieldType;

    fn champ(nom: &str, r#type: FieldType, requis: bool) -> TableFieldSchema {
        TableFieldSchema {
            categories: None,
            description: None,
            fields: None,
            mode: requis.then(|| "REQUIRED".to_owned()),
            name: nom.into(),
            policy_tags: None,
            r#type,
        }
    }

    #[test]
    fn le_ddl_cite_la_table_en_un_seul_jeton_et_ses_colonnes_separement() {
        let ddl = ddl_reconstruit(
            "mon-projet",
            "jeu",
            "commandes",
            &[
                champ("id", FieldType::Int64, true),
                champ("statut", FieldType::String, false),
            ],
        );
        assert!(
            ddl.starts_with("CREATE TABLE `mon-projet.jeu.commandes` ("),
            "{ddl}"
        );
        assert!(ddl.contains("`id` INT64 NOT NULL,"), "{ddl}");
        assert!(ddl.contains("`statut` STRING"), "{ddl}");
        assert!(!ddl.contains("`statut` STRING NOT NULL"), "{ddl}");
    }

    #[test]
    fn une_table_sans_colonne_connue_rend_un_ddl_vide_plutot_que_de_planter() {
        let ddl = ddl_reconstruit("p", "jeu", "vide", &[]);
        assert_eq!(ddl, "CREATE TABLE `p.jeu.vide` ()");
    }

    #[test]
    fn une_colonne_requise_n_est_pas_nullable() {
        let colonne = colonne_de(0, &champ("id", FieldType::Int64, true));
        assert!(!colonne.nullable);
        assert_eq!(colonne.position, 1);
    }

    #[test]
    fn une_colonne_sans_mode_est_nullable() {
        let colonne = colonne_de(0, &champ("note", FieldType::String, false));
        assert!(colonne.nullable);
    }

    #[test]
    fn vue_et_table_se_distinguent_par_leur_type() {
        assert!(est_une_vue(&Some("VIEW".to_owned())));
        assert!(est_une_vue(&Some("MATERIALIZED_VIEW".to_owned())));
        assert!(!est_une_vue(&Some("TABLE".to_owned())));
        assert!(!est_une_vue(&None));
    }
}
