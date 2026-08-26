//! Fonctions pures sur le modèle de configuration : résoudre, filtrer, valider.
//! Aucune I/O, aucun état — tout est testable sans système de fichiers.

use super::model::{Database, EnvironmentId, ModelError, Project};

/// Les connexions du projet déclarées dans `environment` — ce que l'arbre liste (`23g`).
///
/// **Le mot « available » a changé de sens avec le modèle.** Il désignait les bases qui *avaient une
/// variante* dans cet environnement, une même base pouvant en avoir plusieurs. Depuis `23b`, une
/// connexion appartient à un environnement : la liste est un filtre, non une recherche.
pub fn databases_available<'a>(
    project: &'a Project,
    environment: &'a EnvironmentId,
) -> Vec<&'a Database> {
    project.connexions_de(environment).collect()
}

/// Vérifie la cohérence d'un projet entier.
///
/// **Délègue à `Project::valider`** (`23a`) : les invariants portent tous sur des relations entre
/// champs — chaque connexion doit viser un environnement
/// déclaré, deux connexions ne peuvent pas partager nom **et** environnement. Les tenir à deux
/// endroits les ferait diverger ; cette fonction reste comme point d'entrée nommé côté `query`.
pub fn validate(project: &Project) -> Result<(), ModelError> {
    project.valider()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::model::{ConnectionSettings, Engine, EnvironmentDeclaration, SslMode};

    fn reglages() -> ConnectionSettings {
        ConnectionSettings {
            host: "db.internal".into(),
            port: 5432,
            default_database: "analytics".into(),
            username: "dora_ro".into(),
            password: None,
            ssl_mode: SslMode::Require,
            ca_certificate: None,
            auth_database: None,
            read_only: true,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn connexion(nom: &str, env: &str) -> Database {
        Database {
            name: nom.to_owned(),
            engine: Engine::PostgreSql,
            environment: EnvironmentId::brut(env),
            connection: reglages(),
            consoles: Vec::new(),
        }
    }

    /// `analytics` en dev **et** en prod — deux connexions depuis `23b`, non deux variantes —
    /// et `shop` en dev seulement.
    fn projet_de_test() -> Project {
        Project {
            name: "Atelier Nord".into(),
            environments: EnvironmentDeclaration::trio_par_defaut(),
            queries: Vec::new(),
            databases: vec![
                connexion("analytics", "dev"),
                connexion("analytics", "prod"),
                connexion("shop", "dev"),
            ],
        }
    }

    #[test]
    fn les_connexions_disponibles_sont_celles_de_l_environnement() {
        let projet = projet_de_test();
        assert_eq!(
            databases_available(&projet, &EnvironmentId::brut("prod")).len(),
            1
        );
        assert_eq!(
            databases_available(&projet, &EnvironmentId::brut("dev")).len(),
            2
        );
        // Un environnement déclaré mais sans connexion rend une liste vide — ce que `23g` affiche
        // comme « aucune connexion déclarée en staging », plutôt qu'un projet muet.
        assert_eq!(
            databases_available(&projet, &EnvironmentId::brut("staging")).len(),
            0
        );
    }

    #[test]
    fn un_projet_sans_connexion_est_valide() {
        // C'est l'état créé par « Nouveau projet » en `A1`, avant toute connexion déclarée.
        let projet = Project {
            name: "Neuf".into(),
            environments: EnvironmentDeclaration::trio_par_defaut(),
            queries: Vec::new(),
            databases: vec![],
        };
        assert!(validate(&projet).is_ok());
    }

    #[test]
    fn un_projet_coherent_est_valide() {
        assert!(validate(&projet_de_test()).is_ok());
    }

    #[test]
    fn deux_connexions_de_meme_nom_et_meme_environnement_sont_refusees() {
        let mut projet = projet_de_test();
        projet.databases.push(connexion("analytics", "prod"));
        assert!(matches!(
            validate(&projet),
            Err(ModelError::ConnexionEnDouble { .. })
        ));
    }

    #[test]
    fn deux_connexions_de_meme_nom_dans_deux_environnements_sont_le_modele_meme() {
        // **Le test qui dit le changement de `23b`.** Cette configuration était refusée par
        // l'ancienne règle « deux bases de même nom dans un projet » ; elle est désormais
        // exactement ce que le modèle permet — `analytics` en dev et en prod.
        let projet = projet_de_test();
        assert!(validate(&projet).is_ok());
        assert_eq!(
            projet
                .databases
                .iter()
                .filter(|base| base.name == "analytics")
                .count(),
            2
        );
    }

    #[test]
    fn une_connexion_visant_un_environnement_non_declare_est_refusee() {
        let mut projet = projet_de_test();
        projet.databases.push(connexion("journal", "preprod"));
        // Elle serait invisible dans l'arbre, qui liste les connexions sous le nœud de leur
        // environnement.
        assert!(matches!(
            validate(&projet),
            Err(ModelError::EnvironnementInconnu { .. })
        ));
    }

    #[test]
    fn un_projet_sans_environnement_est_refuse() {
        let mut projet = projet_de_test();
        projet.environments.clear();
        projet.databases.clear();
        assert!(matches!(
            validate(&projet),
            Err(ModelError::AucunEnvironnement { .. })
        ));
    }
}
