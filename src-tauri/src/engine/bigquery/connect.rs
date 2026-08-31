//! L'ouverture d'une connexion BigQuery (`21`).
//!
//! **Une seule voie d'authentification, comme Cloud SQL (`06j`)** : les identifiants par défaut de
//! l'application. Aucun champ de compte de service dans `A2` — la même conclusion que `06j`, pour la
//! même raison : `GOOGLE_APPLICATION_CREDENTIALS` reste une échappatoire pour qui en a besoin, sans
//! coûter un champ persisté à tout le monde.

use gcp_bigquery_client::Client;

use crate::config::ConnectionSettings;
use crate::engine::cloudsql::identifiants;
use crate::engine::EngineError;
use crate::secrets::Secret;

use super::erreur::traduire;

/// Le champ « base par défaut » du formulaire porte l'identifiant du **projet** GCP — BigQuery n'a
/// ni hôte ni port, exactement comme SQLite (`17a`) y porte un chemin de fichier à sa place. Le
/// niveau « schéma » du contrat, lui, reste les **jeux de données** du projet (`objects`/`schemas`) :
/// c'est la même lecture que MongoDB, où ce sont les bases du serveur.
pub fn projet_de(variante: &ConnectionSettings) -> Result<String, EngineError> {
    let projet = variante.default_database.trim();
    if projet.is_empty() {
        return Err(EngineError::local(
            "BigQuery a besoin d'un identifiant de projet GCP dans le champ « base par défaut »",
        ));
    }
    Ok(projet.to_owned())
}

/// Ouvre le client, après le seul contrôle qu'on peut faire **avant** d'essayer : y a-t-il seulement
/// des identifiants à trouver ? Réutilise `cloudsql::identifiants`, qui est déjà générique aux
/// bibliothèques clientes de Google — rien dans son message n'est propre au proxy Cloud SQL.
pub async fn client(_mot_de_passe: Option<&Secret>) -> Result<Client, EngineError> {
    // Le mot de passe n'existe pas pour ce moteur — il reste dans la signature parce que
    // `AnyEngine` appelle les sept moteurs de la même façon (`06a`).
    identifiants::controler()?;
    Client::from_application_default_credentials()
        .await
        .map_err(traduire)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SslMode;

    fn variante(default_database: &str) -> ConnectionSettings {
        ConnectionSettings {
            host: String::new(),
            port: 0,
            default_database: default_database.into(),
            username: String::new(),
            password: None,
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    #[test]
    fn le_projet_vient_de_la_base_par_defaut() {
        assert_eq!(
            projet_de(&variante("mon-projet-gcp")).unwrap(),
            "mon-projet-gcp"
        );
    }

    #[test]
    fn un_projet_vide_ou_blanc_est_refuse() {
        assert!(projet_de(&variante("")).is_err());
        assert!(projet_de(&variante("   ")).is_err());
    }

    #[test]
    fn le_projet_est_debarrasse_de_ses_espaces() {
        assert_eq!(
            projet_de(&variante("  mon-projet  ")).unwrap(),
            "mon-projet"
        );
    }
}
