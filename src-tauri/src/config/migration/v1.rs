//! La forme v1 d'un fichier : ce qu'on doit encore savoir lire (`23a`, `23b`).
//!
//! **Des types dédiés, et non le modèle courant.** Faire lire l'ancienne forme par les structures
//! d'aujourd'hui obligerait à garder dans le modèle des champs qui n'existent plus — un
//! `#[serde(alias)]` ici, un `Option<Vec<_>>` là — et ces béquilles survivraient à la migration.
//! Décrire l'ancien format à part le laisse mourir avec elle.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::v6;
use crate::config::arbre::FolderColor;
use crate::config::model::{Kubeconfigs, ManagedInstance};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Fichier {
    pub projects: Vec<Projet>,
    #[serde(default)]
    pub preferences: crate::config::model::Preferences,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Projet {
    pub name: String,
    /// **Lu, jamais réécrit** — et c'est pour cela qu'il est encore ici alors que le modèle ne
    /// le porte plus (`25c`). Il sert à *déduire les environnements déclarés* : un projet dont la
    /// seule trace d'un environnement était d'y être actif perdrait cette déclaration si on
    /// cessait de le lire.
    pub active_environment: String,
    pub databases: Vec<Base>,
    #[serde(default)]
    pub queries: Vec<crate::config::model::SavedQuery>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Base {
    pub name: String,
    pub engine: crate::config::model::Engine,
    pub variants: Vec<Variante>,
}

/// L'ancienne `EnvironmentVariant` : les réglages **plus** leur environnement.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Variante {
    pub environment: String,
    #[serde(flatten)]
    pub reglages: crate::config::model::ConnectionSettings,
}

/// v1 → v2 : les environnements montent au projet, et chaque variante devient une connexion.
///
/// **Elle rend la forme v6** (`v6::Fichier`), figée à côté, et non plus le modèle courant (#164) :
/// la suite de la chaîne est la même que pour un fichier lu en v2 à v6, jusqu'au cran v6 → v7.
///
/// # Ce que cette migration garantit, et pourquoi
///
/// **Elle duplique, elle ne choisit pas.** Une base à trois variantes devient trois connexions. Ne
/// garder que celle de l'environnement actif serait plus court, mais perdrait deux déclarations que
/// l'utilisateur avait faites — et leurs mots de passe deviendraient orphelins dans le trousseau,
/// invisibles et non nettoyables. C'est la règle de `08j` : on ne supprime jamais ce qu'on n'a pas
/// demandé à supprimer.
///
/// **Aucun secret ne bouge.** La référence d'un mot de passe contient déjà l'identifiant
/// d'environnement (`08e`), et les identifiants sont conservés tels quels — `dev`, `staging`, `prod`.
/// C'est précisément ce qui rend cette migration sûre, et c'est pour cela que `23a` fige les
/// identifiants au lieu de les dériver des libellés.
///
/// **Les environnements déclarés sont ceux qui servaient.** Ils sont déduits des variantes présentes,
/// plus l'environnement actif, dans l'ordre du trio. Déclarer les trois d'office ajouterait des
/// environnements vides que l'utilisateur n'a jamais demandés ; n'en déclarer aucun rendrait le
/// projet invalide.
/// **Aucune instance n'en sort, et le vecteur vide est la bonne réponse** : `API-32` est postérieur
/// de plus de deux crans à cette forme, donc un fichier v1 ne peut en porter aucune.
pub(super) fn vers_v2(brut: &str) -> Result<v6::Fichier, serde_json::Error> {
    let ancien: Fichier = serde_json::from_str(brut)?;

    let projects = ancien
        .projects
        .into_iter()
        .map(|projet| {
            let mut identifiants: Vec<String> = Vec::new();
            for base in &projet.databases {
                for variante in &base.variants {
                    if !identifiants.contains(&variante.environment) {
                        identifiants.push(variante.environment.clone());
                    }
                }
            }
            if !identifiants.contains(&projet.active_environment) {
                identifiants.push(projet.active_environment.clone());
            }

            // L'ordre du trio d'abord, puis le reste : un fichier écrit à la main pourrait porter
            // autre chose, et l'ordre du sélecteur ne doit pas dépendre de l'ordre des bases.
            let rang = |id: &str| match id {
                "dev" => 0,
                "staging" => 1,
                "prod" => 2,
                _ => 3,
            };
            identifiants.sort_by_key(|id| (rang(id), id.clone()));

            let environments = identifiants
                .iter()
                .map(|id| {
                    let (color, production) = match id.as_str() {
                        "prod" => (FolderColor::Red, true),
                        "staging" => (FolderColor::Amber, false),
                        "dev" => (FolderColor::Green, false),
                        // Un identifiant inconnu garde une couleur neutre : inventer « rouge » le
                        // ferait passer pour une production, donc protégé alors qu'il ne l'est pas.
                        _ => (FolderColor::Slate, false),
                    };
                    v6::Environnement {
                        id: id.clone(),
                        label: id.clone(),
                        color,
                        production,
                    }
                })
                .collect();

            let databases = projet
                .databases
                .into_iter()
                .flat_map(|base| {
                    base.variants
                        .into_iter()
                        .map(|variante| v6::Base {
                            name: base.name.clone(),
                            label: None,
                            engine: base.engine,
                            environment: variante.environment,
                            connection: variante.reglages,
                            consoles: Vec::new(),
                            // Une configuration d'avant `API-33` n'a réglé aucun schéma : `None`
                            // rend l'arbre qu'elle avait, tous les non-système.
                            visible_schemas: None,
                        })
                        .collect::<Vec<_>>()
                })
                .collect();

            v6::Projet {
                name: projet.name,
                environments,
                databases,
                queries: projet.queries,
                // Un fichier v1 n'a aucun libellé de valeur à reprendre (`API-75`).
                value_labels: BTreeMap::new(),
            }
        })
        .collect();

    Ok(v6::Fichier {
        projects,
        preferences: ancien.preferences,
        instances: Vec::<ManagedInstance>::new(),
        kubeconfigs: Kubeconfigs::default(),
    })
}
