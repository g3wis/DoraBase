//! Export et import d'un dump de base, en déléguant à l'outil natif du moteur.
//!
//! **Déléguer plutôt que réimplémenter.** Le dump est produit par `pg_dump`, pas par du Rust
//! qui écrit du SQL : la fidélité — extensions, séquences, types personnalisés, triggers,
//! ordre des dépendances, `COPY`, contraintes différées — est alors acquise au lieu d'être
//! promise. Un dump maison incomplet **présenté comme une sauvegarde** serait le pire défaut
//! que cette feature puisse avoir. Contrepartie assumée : une dépendance externe, qui est
//! **découverte** et non empaquetée.
//!
//! **Pourquoi `dump/` à côté de `engine/` et non dedans.** Un dump ne traverse pas la
//! connexion du moteur : il lance un processus tiers (`pg_dump`, `psql`) dont le `stdout`
//! va directement dans un fichier. Le mêler à `engine/` brouillerait la frontière posée
//! par `06a`, où tout passe par un `EngineAdapter`.
//!
//! **Ce module ne porte que ce qui varie par moteur** — noms de binaires, argv,
//! environnement du fils, règle de version. Le lancement, l'écriture, la progression et
//! l'annulation sont communs et vivent dans `run.rs`.

pub mod commands;
pub mod discover;
pub mod inspect;
pub mod postgres;
pub mod run;

/// Les tests sur base réelle, et les auxiliaires qu'ils partagent. Derrière la feature
/// `db-tests` : une feature les rend **absents** du job macOS au lieu de silencieux.
#[cfg(all(test, feature = "db-tests"))]
mod tests_reels;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::config::{Engine, SslMode};

/// Où le dump doit se connecter, et sous quel nom. **Jamais le mot de passe.**
///
/// Distinct d'`EnvironmentVariant` : sur une connexion tunnelée, l'hôte et le port ne sont
/// pas ceux de la variante mais `127.0.0.1` et le port local du tunnel rendu par
/// `connection_states`. Les confondre ferait sortir `pg_dump` du tunnel, c'est-à-dire
/// échouer, ou pire, atteindre une autre base.
///
/// **Le transport voyage avec l'adresse** (#82). Le mode SSL et l'autorité déclarés dans `A2`
/// étaient restés dans la variante : `pg_dump` et `psql` tombaient donc sur le défaut de libpq,
/// `prefer` — TLS tenté, repli en clair accepté, certificat jamais vérifié —, et une connexion
/// réglée en `verify-full` exportait toute sa base, mot de passe compris, en clair devant le
/// premier intermédiaire qui refusait TLS. Les porter ici fait de leur oubli une erreur de
/// compilation chez qui construit une `Cible`, et `PostgresDumpTool::child_env` les lit par une
/// déstructuration **sans `..`** : un champ ajouté ici ne compile pas tant qu'elle ne l'a pas nommé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cible {
    pub hote: String,
    pub port: u16,
    pub base: String,
    pub utilisateur: String,
    pub ssl_mode: SslMode,
    /// Le chemin tel que saisi dans `A2`, `~` compris : c'est `child_env` qui l'expanse.
    pub ca_certificate: Option<String>,
}

/// **Le seul point de variation par moteur.**
///
/// `Send + Sync` est exigé du trait : les commandes Tauri s'exécutent sur un exécuteur
/// multi-fils, donc le futur qui tient une référence à l'outil doit pouvoir traverser un
/// fil. C'est la même contrainte que `06a` a rencontrée sur `EngineAdapter`.
///
/// Noms de binaires, argv, environnement du fils. Le lancement, l'écriture, la
/// progression et l'annulation sont communs (`run.rs`) — c'est ce qui fait qu'un
/// `DumpTool` de MySQL tiendra en une soixantaine de lignes.
pub trait DumpTool: Send + Sync {
    /// Le binaire d'export — `pg_dump`.
    fn binaire_export(&self) -> &'static str;

    /// Le binaire d'import — `psql`, **et non** celui d'export : `22c` a son propre
    /// `ToolMissing`.
    fn binaire_import(&self) -> &'static str;

    fn export_argv(&self, cible: &Cible, fichier: &Path) -> Vec<OsString>;

    fn import_argv(&self, cible: &Cible, fichier: &Path) -> Vec<OsString>;

    /// Les variables d'environnement du fils : le secret — **jamais l'argv** —, ce que l'outil ne
    /// doit pas recevoir en argument, et le transport (voir `PostgresDumpTool::child_env`).
    ///
    /// **Appelée avec ou sans mot de passe.** Ni la base ni le transport ne dépendent d'un
    /// secret : un environnement posé seulement quand il y a un mot de passe laisserait une
    /// connexion sans mot de passe retomber sur les défauts de l'outil (#82, #84).
    fn child_env(&self, cible: &Cible, mot_de_passe: Option<&str>) -> Vec<(String, String)>;
}

/// Une version de moteur ou d'outil, réduite à ce dont les règles ont besoin.
///
/// **La mineure est portée mais ne décide de rien** : elle est affichée dans les messages
/// (« pg_dump 13.14 face à un serveur 17.6 » se lit mieux que « 13 face à 17 »), et
/// mesuré le 19 août 2026, `pg_dump` 17.4 dumpe un serveur 17.6 sans se plaindre. Une
/// règle sur la version complète refuserait donc un cas qui marche.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "dump.ts")]
pub struct Version {
    pub majeure: u32,
    pub mineure: u32,
}

impl Version {
    pub fn new(majeure: u32, mineure: u32) -> Self {
        Self { majeure, mineure }
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}", self.majeure, self.mineure)
    }
}

/// Le verdict de la règle de version, pour un outil face à un serveur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionVerdict {
    Compatible,
    /// L'outil est d'une majeure antérieure à celle du serveur. `pg_dump` refuse alors
    /// lui-même de dumper, avec un message que personne ne lit — autant le dire avant.
    TropVieux {
        outil: Version,
        serveur: Version,
    },
}

/// La règle de version : **la majeure seule**.
///
/// Mesuré le 19 août 2026 : `pg_dump` 17.4 dumpe un serveur 17.6 sans se plaindre. Un
/// outil plus **récent** que le serveur est le sens supporté par PostgreSQL, donc accepté.
pub fn regle_de_version(outil: Version, serveur: Version) -> VersionVerdict {
    if outil.majeure < serveur.majeure {
        VersionVerdict::TropVieux { outil, serveur }
    } else {
        VersionVerdict::Compatible
    }
}

/// Ce que la modale d'export a le droit de dire, et rien d'autre.
///
/// **Cinq verdicts, pas un booléen.** « Indisponible » recouvre cinq situations, dont deux
/// se ressemblent sans être la même chose : `NotYetSupported` est une promesse à tenir
/// (`16`–`21`), `NoLocalDump` une impossibilité de construction — Snowflake et BigQuery
/// n'ont pas d'outil local, leur export sort vers un stockage cloud, ce qui heurte
/// « aucune ressource réseau ». Les fondre dirait « pas encore » d'un cas qui ne viendra
/// jamais.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "dump.ts")]
pub enum DumpAvailability {
    Ready {
        tool: PathBuf,
        version: Version,
    },
    ToolMissing {
        binary: &'static str,
    },
    ToolTooOld {
        tool: Version,
        server: Version,
    },
    /// « Pas encore disponible » — une promesse, tenue par les specs `16`–`21`.
    NotYetSupported {
        engine: Engine,
    },
    /// Une impossibilité assumée, pas un TODO.
    NoLocalDump {
        engine: Engine,
    },
}

impl DumpAvailability {
    /// Le verdict qui ne dépend **que** du moteur.
    ///
    /// `None` quand le moteur a un outil local : la disponibilité dépend alors de la
    /// découverte du binaire et de la version du serveur, que ce niveau ne connaît pas.
    /// C'est le seul point du plan `22b` qui a bougé à l'écriture — il attendait un
    /// `DumpAvailability` sec, ce qui obligeait à inventer un verdict pour PostgreSQL
    /// avant même d'avoir cherché `pg_dump`.
    ///
    /// Le `match` est **exhaustif, sans bras `_`** : ajouter un moteur au domaine doit
    /// faire échouer la compilation ici, pas produire un verdict par défaut.
    pub fn pour_moteur(engine: Engine) -> Option<DumpAvailability> {
        match engine {
            // Le seul moteur qui a son outil ici. `22b` § Hors périmètre.
            Engine::PostgreSql => None,
            Engine::MySql | Engine::Sqlite | Engine::MongoDb | Engine::Redis => {
                Some(DumpAvailability::NotYetSupported { engine })
            }
            // Aucun outil local : leur export sort vers un stockage cloud.
            Engine::Snowflake | Engine::BigQuery => Some(DumpAvailability::NoLocalDump { engine }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_regle_de_version_porte_sur_la_majeure_seule() {
        // Mesuré : pg_dump 17.4 dumpe un serveur 17.6 sans se plaindre.
        assert!(matches!(
            regle_de_version(Version::new(17, 4), Version::new(17, 6)),
            VersionVerdict::Compatible
        ));
        // Un pg_dump plus vieux d'une majeure refuse le serveur.
        assert!(matches!(
            regle_de_version(Version::new(16, 9), Version::new(17, 6)),
            VersionVerdict::TropVieux { .. }
        ));
        // Plus récent que le serveur : accepté, c'est le sens supporté.
        assert!(matches!(
            regle_de_version(Version::new(18, 0), Version::new(17, 6)),
            VersionVerdict::Compatible
        ));
    }

    #[test]
    fn les_moteurs_sans_dump_local_se_distinguent_de_ceux_pas_encore_faits() {
        // Deux verdicts, jamais fondus : l'un est une promesse, l'autre une impossibilité.
        assert!(matches!(
            DumpAvailability::pour_moteur(Engine::MySql),
            Some(DumpAvailability::NotYetSupported { .. })
        ));
        assert!(matches!(
            DumpAvailability::pour_moteur(Engine::BigQuery),
            Some(DumpAvailability::NoLocalDump { .. })
        ));
        assert!(matches!(
            DumpAvailability::pour_moteur(Engine::Snowflake),
            Some(DumpAvailability::NoLocalDump { .. })
        ));
    }

    #[test]
    fn postgresql_n_a_aucun_verdict_au_niveau_du_moteur() {
        // Contrôle positif du `None` : sans lui, `pour_moteur` pourrait rendre `None`
        // partout et les deux assertions ci-dessus resteraient vertes.
        assert_eq!(DumpAvailability::pour_moteur(Engine::PostgreSql), None);
    }

    #[test]
    fn les_sept_moteurs_sont_couverts() {
        // Un moteur oublié tomberait dans un `_ =>` et mentirait sur sa disponibilité.
        for moteur in Engine::tous() {
            let _ = DumpAvailability::pour_moteur(moteur); // ne doit pas paniquer
        }
    }
}
