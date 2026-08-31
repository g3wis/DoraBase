//! L'adaptateur BigQuery — spec `21`.
//!
//! # Ce que ce moteur ne partage avec aucun autre
//!
//! 1. **Il n'a pas de serveur au sens des six autres.** Ni hôte, ni port, ni utilisateur, ni mot de
//!    passe, ni TLS : tout passe par HTTPS vers l'API REST de Google, authentifié par les
//!    identifiants par défaut de l'application (`connect::client`, même conclusion que Cloud SQL en
//!    `06j`). Le champ « base par défaut » porte l'identifiant du **projet** GCP.
//! 2. **Le niveau « schéma » du contrat porte les jeux de données du projet** — la lecture de
//!    MongoDB, où ce sont les bases du serveur.
//! 3. **L'édition de lignes n'est pas offerte depuis DoraBase.** `preview_updates` et
//!    `apply_updates` refusent, avec leur raison : BigQuery facture les DML au volume de données
//!    parcouru, et rien ici ne relit une clé primaire déclarée (voir `introspect.rs`) pour garantir
//!    le même contrôle de conflit que les autres moteurs (`11d`). La console SQL, elle, exécute ce
//!    que l'utilisateur y écrit — DML compris.
//! 4. **Aucun décor de test ne l'exerce.** BigQuery ne s'auto-héberge pas ; ce module n'a jamais
//!    parlé à un vrai projet avant que quelqu'un ne le teste avec le sien. Ce qui peut l'être sans
//!    réseau — la composition du SQL, la conversion des types, le DDL reconstruit — l'est dans
//!    `rows.rs`, `valeurs.rs` et `introspect.rs`. L'ouverture de la connexion et les appels à l'API
//!    ne le sont pas.

mod connect;
mod erreur;
mod introspect;
mod rows;
mod valeurs;

use std::time::Instant;

use gcp_bigquery_client::model::query_request::QueryRequest;
use gcp_bigquery_client::Client;

use crate::config::ConnectionSettings;
use crate::engine::proxy::EtatProxy;
use crate::engine::{
    ApplyOutcome, ConnectionProbe, EngineAdapter, EngineError, QueryResult, RowCount, RowLimit,
    RowQuery, RowWindow, SchemaInfo, TableDetail, TableSummary, UpdatePlan, Value,
};
use crate::secrets::Secret;

/// L'adaptateur BigQuery.
pub struct BigQueryAdapter {
    client: Client,
    projet: String,
}

/// `Debug` à la main : même raison qu'en `06b`, `17a` et `18b` — un dérivé exposerait l'état
/// interne du client (jeton d'accès compris).
impl std::fmt::Debug for BigQueryAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "BigQueryAdapter {{ projet: {} }}", self.projet)
    }
}

/// Refusé, avec la raison — voir le point 3 du commentaire de tête.
const REFUS_ECRITURE: &str =
    "BigQuery ne prend pas en charge la modification ou l'ajout de lignes \
    depuis la grille de DoraBase : les DML sont facturés au volume de données parcouru, et ce \
    moteur ne connaît pas de clé primaire déclarée pour garantir le même contrôle de conflit que \
    les autres moteurs. Utilisez la console SQL pour un UPDATE, un INSERT ou un DELETE explicite.";

impl BigQueryAdapter {
    pub async fn connect_via(
        variante: &ConnectionSettings,
        mot_de_passe: Option<&Secret>,
        _known_hosts: &std::path::Path,
    ) -> Result<Self, EngineError> {
        // `known_hosts` est ignoré : un appel HTTPS vers l'API Google n'a pas de clé d'hôte SSH à
        // vérifier. Le paramètre reste dans la signature parce que `AnyEngine` appelle les sept
        // moteurs de la même façon (`06a`).
        let projet = connect::projet_de(variante)?;
        let client = connect::client(mot_de_passe).await?;
        Ok(Self { client, projet })
    }

    /// Un appel HTTPS n'a pas de tunnel. Les deux méthodes existent pour `AnyEngine`.
    pub fn etat_tunnel(&self) -> Option<EtatProxy> {
        None
    }

    pub fn port_local_tunnel(&self) -> Option<u16> {
        None
    }

    pub async fn close(self) {
        // Rien à attendre : pas de port local à rendre, pas de socket à fermer.
    }

    async fn executer(
        &self,
        sql: &str,
        parametres: Vec<gcp_bigquery_client::model::query_parameter::QueryParameter>,
    ) -> Result<(Vec<String>, Vec<Vec<Value>>), EngineError> {
        let requete = QueryRequest {
            query: sql.to_owned(),
            use_legacy_sql: false,
            parameter_mode: (!parametres.is_empty()).then(|| "NAMED".to_owned()),
            query_parameters: (!parametres.is_empty()).then_some(parametres),
            // Un délai généreux plutôt qu'un défaut de 10 s (`21` : pas de décor pour mesurer une
            // requête réelle). Une requête encore incomplète à ce terme est traduite en erreur
            // plutôt que de rendre une fenêtre vide qui se lirait comme « la table est vide ».
            timeout_ms: Some(60_000),
            ..Default::default()
        };
        let reponse = self
            .client
            .job()
            .query(&self.projet, requete)
            .await
            .map_err(erreur::traduire)?;

        if !reponse.job_complete.unwrap_or(false) {
            return Err(EngineError::local(
                "la requête BigQuery n'a pas terminé dans le délai imparti",
            ));
        }

        let champs = reponse
            .schema
            .as_ref()
            .and_then(|schema| schema.fields.clone())
            .unwrap_or_default();
        let colonnes: Vec<String> = champs.iter().map(|c| c.name.clone()).collect();

        let mut lignes = Vec::new();
        for ligne in reponse.rows.unwrap_or_default() {
            let cellules = ligne.columns.unwrap_or_default();
            let mut valeurs = Vec::with_capacity(champs.len());
            for (rang, champ) in champs.iter().enumerate() {
                let brute = cellules.get(rang).and_then(|c| c.value.clone());
                valeurs.push(valeurs::valeur(brute, champ));
            }
            lignes.push(valeurs);
        }
        Ok((colonnes, lignes))
    }
}

impl EngineAdapter for BigQueryAdapter {
    async fn probe(&self) -> Result<ConnectionProbe, EngineError> {
        let debut = Instant::now();
        // `select 1` est le test le moins coûteux qui exerce vraiment l'aller-retour — pas de
        // version de serveur à demander, BigQuery n'en expose aucune (`21`, voir le commentaire de
        // tête).
        self.executer("select 1", Vec::new()).await?;
        Ok(ConnectionProbe {
            latency_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
            server_version: format!("BigQuery — projet {}", self.projet),
        })
    }

    async fn schemas(&self) -> Result<Vec<SchemaInfo>, EngineError> {
        introspect::schemas(&self.client, &self.projet).await
    }

    async fn objects(&self, schema: &str) -> Result<Vec<TableSummary>, EngineError> {
        introspect::objects(&self.client, &self.projet, schema).await
    }

    async fn table_detail(&self, schema: &str, table: &str) -> Result<TableDetail, EngineError> {
        introspect::detail(&self.client, &self.projet, schema, table).await
    }

    async fn rows(&self, query: &RowQuery) -> Result<RowWindow, EngineError> {
        let debut = Instant::now();
        let (sql, parametres) = rows::requete_de(&self.projet, &query.schema, query);
        let (_, lignes) = self.executer(&sql, parametres).await?;

        // Le total ignore les filtres de `query`, comme les autres moteurs (`06a`) : c'est le
        // compte de la table entière qui donne le contexte de la pagination, pas celui de la
        // fenêtre filtrée.
        let table = self
            .client
            .table()
            .get(&self.projet, &query.schema, &query.table, None)
            .await
            .map_err(erreur::traduire)?;
        let total = table
            .num_rows
            .as_deref()
            .and_then(|n| n.parse::<i64>().ok())
            .map(|value| RowCount::Estimated { value });

        Ok(RowWindow {
            offset: query.offset,
            rows: lignes,
            total,
            sql,
            duration_ms: u32::try_from(debut.elapsed().as_millis()).unwrap_or(u32::MAX),
        })
    }

    async fn row_as_insert(
        &self,
        schema: &str,
        table: &str,
        values: &[Value],
    ) -> Result<String, EngineError> {
        let detail = introspect::detail(&self.client, &self.projet, schema, table).await?;
        let colonnes: Vec<String> = detail.columns.into_iter().map(|c| c.name).collect();
        Ok(rows::insert_de(
            &self.projet,
            schema,
            table,
            &colonnes,
            values,
        ))
    }

    async fn preview_updates(&self, _plan: &UpdatePlan) -> Result<String, EngineError> {
        Err(EngineError::local(REFUS_ECRITURE))
    }

    async fn apply_updates(&self, _plan: &UpdatePlan) -> Result<ApplyOutcome, EngineError> {
        Err(EngineError::local(REFUS_ECRITURE))
    }

    async fn run_sql(&self, sql: &str, limite: RowLimit) -> Result<QueryResult, EngineError> {
        let debut = Instant::now();
        let (borne, ajoutee) = rows::avec_limite(sql, limite);
        let (colonnes, lignes) = self.executer(&borne, Vec::new()).await?;

        Ok(QueryResult {
            columns: colonnes,
            rows: lignes,
            sql: borne,
            duration_ms: u64::try_from(debut.elapsed().as_millis()).unwrap_or(u64::MAX),
            applied_limit: ajoutee,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le refus d'écriture est **identique en aperçu et à l'exécution** — sans quoi `A6`
    /// afficherait un aperçu qui promet ce qu'`apply_updates` refuserait ensuite (`11c`).
    #[test]
    fn le_refus_d_ecriture_nomme_l_alternative() {
        assert!(REFUS_ECRITURE.contains("console SQL"), "{REFUS_ECRITURE}");
        assert!(REFUS_ECRITURE.contains("clé primaire"), "{REFUS_ECRITURE}");
    }
}
