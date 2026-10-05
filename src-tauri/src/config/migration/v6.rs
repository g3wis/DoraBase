//! La forme v6 d'un fichier de configuration, **figée** (#164) : des projets, leurs environnements,
//! leurs connexions.
//!
//! # Pourquoi des types dédiés
//!
//! Les crans v0 à v5 produisaient le modèle courant, `Project`. `Project` a disparu avec la bascule
//! de #165 : sans cette forme figée, ils ne compileraient plus. Décrire la v6 à part la laisse vivre aussi longtemps
//! qu'un fichier v6 peut traîner quelque part, et mourir avec le dernier cran qui la lit : c'est la
//! raison de `mod v1`, appliquée à la forme suivante.
//!
//! **En `serde` pur, sans `TS`** : cette forme ne traverse jamais l'IPC.
//!
//! **Ce qui n'est pas recopié** : `ConnectionSettings`, `Console`, `SavedQuery`, `Engine`,
//! `Preferences`, `ManagedInstance` et `Kubeconfigs` ne changent pas de forme en v7 — les recopier
//! ferait deux descriptions du même JSON. Le jour où l'un d'eux change, son cran s'écrira sur le
//! JSON, avant la relecture typée, comme les trois crans qui précèdent.
//!
//! # Le cran v6 → v7, sur des types et non sur du JSON
//!
//! Les trois crans précédents descendent le JSON en cherchant ce qu'ils changent, sans connaître ce
//! qui l'entoure. Celui-ci est l'inverse : il **est** le changement de ce qui entoure — les projets
//! deviennent des dossiers racines, les environnements des sous-dossiers, les connexions des
//! feuilles. L'écrire sur `Value` aurait voulu dire décrire la v6 en chaînes de caractères.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::config::arbre::{
    reference_de_connexion, ConnectionId, Folder, FolderColor, FolderId, FolderTree, ValueLabels,
};
use crate::config::model::{
    ConnectionSettings, Console, Database, Engine, Kubeconfigs, ManagedInstance, Preferences,
    SavedQuery, SecretRef,
};

/// Un fichier v6 — les champs qui entourent les projets passent tels quels en v7.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fichier {
    pub projects: Vec<Projet>,
    #[serde(default)]
    pub preferences: Preferences,
    #[serde(default)]
    pub instances: Vec<ManagedInstance>,
    #[serde(default)]
    pub kubeconfigs: Kubeconfigs,
}

/// Un projet v6.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projet {
    pub name: String,
    pub environments: Vec<Environnement>,
    pub databases: Vec<Base>,
    #[serde(default)]
    pub queries: Vec<SavedQuery>,
    #[serde(default)]
    pub value_labels: ValueLabels,
}

/// Un environnement déclaré par un projet v6.
///
/// **L'identifiant en chaîne, la couleur en `FolderColor`** : ni `EnvironmentId` ni
/// `EnvironmentColor` n'ont survécu à #165, et `FolderColor` porte les mêmes cinq valeurs
/// `kebab-case`, donc le même JSON.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environnement {
    pub id: String,
    pub label: String,
    pub color: FolderColor,
    pub production: bool,
}

/// Une connexion v6 : **sans identifiant**, rangée par son environnement.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Base {
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    pub engine: Engine,
    pub environment: String,
    pub connection: ConnectionSettings,
    #[serde(default)]
    pub consoles: Vec<Console>,
    #[serde(default)]
    pub visible_schemas: Option<Vec<String>>,
}

/// La référence qu'une connexion v6 recevait à sa création : `projet/base/environnement`.
///
/// **Figée ici avec la forme qu'elle décrivait**, et plus employée nulle part pour écrire : la
/// migration part de la référence que le fichier **porte**, jamais de celle-ci (voir
/// [`PlanDeSecrets`]). Elle ne sert qu'aux décors qui fabriquent un fichier v6 tel qu'une version
/// antérieure l'aurait écrit.
#[cfg(test)]
pub(crate) fn reference_v6(projet: &str, base: &str, environnement: &str) -> SecretRef {
    SecretRef::new(format!("{projet}/{base}/{environnement}"))
}

/// Les références de mots de passe que la migration change : `(ancienne, nouvelle)`.
///
/// **L'ancienne est celle que le fichier porte, jamais une référence recalculée depuis le triplet.**
/// C'est elle qu'`open_database` lisait, et elle n'est pas toujours le triplet : un renommage de
/// projet interrompu, un fichier écrit à la main, peuvent en avoir laissé une autre. La recalculer
/// perdrait le mot de passe de ces connexions-là — le défaut que le décor « trop régulier » de la
/// règle n° 5 aurait laissé passer, et que la fixture de #164 garde.
///
/// Deux couples peuvent porter la **même** ancienne référence (le triplet de `a/b` › `c` est celui de
/// `a` › `b/c`) : chacun copie alors la même valeur, et c'est le déplacement de #165 qui dédoublonne
/// les effacements.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlanDeSecrets(pub Vec<(SecretRef, SecretRef)>);

impl PlanDeSecrets {
    pub fn est_vide(&self) -> bool {
        self.0.is_empty()
    }

    pub fn couples(&self) -> &[(SecretRef, SecretRef)] {
        &self.0
    }
}

/// Verse les requêtes de `12f` dans la première connexion de chaque projet — la même règle, mot pour
/// mot, que `enregistrer::migrer_requetes_en_consoles`, sur la forme v6.
///
/// **Avant la conversion en arbre, et non après** : « la première connexion déclarée du projet » est
/// une notion v6 — l'ordre de `databases`, qui mêle les environnements. Après la conversion, la
/// première connexion du sous-arbre serait celle du premier sous-dossier, et une requête écrite pour
/// la base de prod pourrait atterrir sous dev.
fn verser_les_requetes(projets: &mut [Projet]) {
    for projet in projets.iter_mut() {
        if projet.queries.is_empty() || projet.databases.is_empty() {
            continue;
        }
        let requetes = std::mem::take(&mut projet.queries);
        let base = &mut projet.databases[0];
        for requete in requetes {
            let mut nom = requete.name;
            while base.consoles.iter().any(|console| console.name == nom) {
                nom.push_str(" (reprise)");
            }
            base.consoles.push(Console {
                name: nom,
                sql: requete.sql,
            });
        }
    }
}

/// Un nom qui n'est ni vide ni déjà porté par un frère — à `trim` près, comme `valider` le compare.
///
/// **Ce n'est pas une génération de suffixe à la saisie** : personne ne tape ici. Deux libellés
/// d'environnement égaux sont permis en v6 ; deux dossiers frères homonymes ne le sont plus en v7,
/// parce que la fusion de #169 apparie les dossiers par leur nom. Le second prend donc
/// `« {nom} ({discriminant}) »`, où le discriminant est l'identifiant d'environnement — ce qui dit
/// d'où il vient —, puis un rang dans le cas, construit à la main, où même cela est pris.
fn nom_libre(souhaite: &str, repli: &str, discriminant: &str, freres: &[Folder]) -> String {
    let pris = |candidat: &str| {
        freres
            .iter()
            .any(|frere| frere.name.trim() == candidat.trim())
    };
    let souhaite = match souhaite.trim() {
        "" => repli,
        nom => nom,
    };
    if !pris(souhaite) {
        return souhaite.to_owned();
    }
    let avec_discriminant = format!("{souhaite} ({discriminant})");
    if !pris(&avec_discriminant) {
        return avec_discriminant;
    }
    (2u32..)
        .map(|rang| format!("{avec_discriminant} ({rang})"))
        .find(|candidat| !pris(candidat))
        .expect("la suite des rangs est infinie")
}

/// Le cran v6 → v7 : projet → dossier racine, environnement → sous-dossier, connexion → feuille.
///
/// 1. Les requêtes de `12f` sont d'abord versées dans la première connexion de chaque projet ; celles
///    d'un projet sans connexion vont dans `Folder::queries` du dossier racine, où elles attendent.
/// 2. Chaque projet devient un dossier racine : sans couleur, **inscriptible**, et porteur de ses
///    libellés de valeurs (`API-75` : partagés entre dev, staging et prod, comme avant).
/// 3. Chaque environnement devient un sous-dossier, dans l'ordre déclaré : sa couleur est reprise, et
///    **`production` devient la lecture seule** (#108).
/// 4. Chaque connexion va dans le sous-dossier de son environnement. Son mot de passe passe sous
///    `connexion/<id>`, et le couple `(référence stockée, nouvelle)` entre dans le plan. Son réglage
///    local de lecture seule n'est **pas** touché : le dossier l'impose déjà, et lever la lecture
///    seule du dossier doit rendre à la connexion le choix que l'utilisateur y avait fait.
///
/// **Les identifiants sont dérivés, jamais tirés** — voir `arbre::deriver` : la configuration est
/// relue, donc migrée, à chaque commande tant que rien ne l'a réécrite.
///
/// **Une connexion dont l'environnement n'est pas déclaré** — `Project::valider` le refusait, seul un
/// fichier écrit à la main peut la porter — est rangée **dans le dossier racine** de son projet plutôt
/// que perdue : rien de ce qu'un fichier déclare ne disparaît en silence.
pub fn vers_v7(mut projets: Vec<Projet>) -> (FolderTree, PlanDeSecrets) {
    verser_les_requetes(&mut projets);

    let mut dossiers_pris: Vec<String> = Vec::new();
    let mut connexions_prises: Vec<String> = Vec::new();
    let mut plan = Vec::new();
    let mut arbre = FolderTree::default();

    for projet in projets {
        let id_racine = FolderId::derive(&["dossier", &projet.name], |candidat| {
            dossiers_pris.iter().any(|pris| pris == candidat)
        });
        dossiers_pris.push(id_racine.as_str().to_owned());
        let nom_racine = nom_libre(&projet.name, "projet", id_racine.as_str(), &arbre.folders);

        let mut sous_dossiers: Vec<(String, Folder)> = Vec::new();
        for environnement in &projet.environments {
            let id = FolderId::derive(&["dossier", &projet.name, &environnement.id], |candidat| {
                dossiers_pris.iter().any(|pris| pris == candidat)
            });
            dossiers_pris.push(id.as_str().to_owned());
            let freres: Vec<Folder> = sous_dossiers.iter().map(|(_, d)| d.clone()).collect();
            let nom = nom_libre(
                &environnement.label,
                &environnement.id,
                &environnement.id,
                &freres,
            );
            sous_dossiers.push((
                environnement.id.clone(),
                Folder {
                    id,
                    name: nom,
                    color: Some(environnement.color),
                    icon: None,
                    read_only: environnement.production,
                    folders: Vec::new(),
                    connections: Vec::new(),
                    value_labels: BTreeMap::new(),
                    queries: Vec::new(),
                },
            ));
        }

        let mut orphelines = Vec::new();
        for base in projet.databases {
            let id = ConnectionId::derive(
                &["connexion", &projet.name, &base.environment, &base.name],
                |candidat| connexions_prises.iter().any(|prise| prise == candidat),
            );
            connexions_prises.push(id.as_str().to_owned());

            let mut connection = base.connection;
            if let Some(ancienne) = connection.password.take() {
                let nouvelle = reference_de_connexion(&id);
                plan.push((ancienne, nouvelle.clone()));
                connection.password = Some(nouvelle);
            }

            let environnement = base.environment;
            let connexion = Database {
                id,
                name: base.name,
                label: base.label,
                // Une connexion v6 n'avait ni pastille ni icône (#179) : les couleurs du moteur.
                color: None,
                icon: None,
                engine: base.engine,
                connection,
                consoles: base.consoles,
                visible_schemas: base.visible_schemas,
            };
            match sous_dossiers
                .iter_mut()
                .find(|(id_env, _)| *id_env == environnement)
            {
                Some((_, dossier)) => dossier.connections.push(connexion),
                None => orphelines.push(connexion),
            }
        }

        arbre.folders.push(Folder {
            id: id_racine,
            name: nom_racine,
            color: None,
            icon: None,
            read_only: false,
            folders: sous_dossiers
                .into_iter()
                .map(|(_, dossier)| dossier)
                .collect(),
            connections: orphelines,
            value_labels: projet.value_labels,
            queries: projet.queries,
        });
    }

    (arbre, PlanDeSecrets(plan))
}
