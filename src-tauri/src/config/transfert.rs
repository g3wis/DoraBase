//! L'export et l'import de projets, en un fichier JSON (`API-30`).
//!
//! # Ce qui voyage, et ce qui ne voyage pas
//!
//! Un fichier de transfert porte des **projets** : leurs environnements, leurs connexions et les
//! consoles de chacune. Pas les préférences — un thème n'appartient pas à un projet, et
//! `save_preferences` les relit déjà plutôt que de les recevoir, pour la même raison. Pas non plus
//! `Project::queries`, le champ en transit de `12f` : l'export le vide, et l'import le reverse en
//! consoles par la fonction qui le fait déjà à la lecture de la configuration.
//!
//! # Le fichier ne traverse jamais l'IPC
//!
//! Ni dans un sens, ni dans l'autre. À l'export, la webview envoie un chemin et une case cochée ; à
//! l'import, elle envoie un chemin et reçoit un **rapport**. C'est la contrainte transverse du
//! projet — « le cœur détient les résultats ; la webview ne reçoit que ce qu'elle montre » — et elle
//! a ici une seconde raison, qui suffirait seule : le fichier peut porter des mots de passe en
//! clair. Une forme qui ne peut pas atteindre la webview ne peut pas finir dans une console de
//! développement ni dans un journal. C'est pourquoi [`FichierDeProjets`] ne dérive pas `TS`, là où
//! [`ExportReport`] et [`ImportReport`] le font.
//!
//! # Pourquoi les types du modèle sont réemployés tels quels
//!
//! `projects` est **exactement** ce que le fichier de configuration porte sous la même clé : le même
//! `Vec<Project>`, sérialisé par le même `serde`. Une seconde description — un « ProjectExport » à
//! douze champs — aurait divergé au premier champ ajouté à `ConnectionSettings`, sans qu'aucun test
//! le voie (règle n° 17). C'est aussi ce qui permet à l'import de réemployer la chaîne de migrations
//! du magasin plutôt que d'en tenir une seconde : voir `store::projets_du_document`.
//!
//! # Ce que le fichier fait des mots de passe
//!
//! Trois états, non deux, et c'est la structure qui les distingue plutôt qu'un drapeau :
//!
//! - `password: None` — cette connexion n'en a pas, et n'en veut pas (un fichier SQLite) ;
//! - `password: Some(ref)`, `ref` **absente** de `passwords` — elle en a un, qui n'a pas voyagé.
//!   L'import le dit, connexion par connexion ;
//! - `password: Some(ref)`, `ref` **présente** dans `passwords` — il voyage en clair dans le
//!   fichier, parce que quelqu'un a coché la case.
//!
//! La référence reste donc écrite même quand la valeur ne suit pas : c'est elle qui distingue les
//! deux premiers cas, et aucun champ n'a eu à être inventé pour cela.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::enregistrer::reference_de;
use super::model::{
    Console, Database, EnvironmentId, KubeconfigDeclaration, KubeconfigId, Kubeconfigs, Project,
    Proxy, SecretRef,
};
use super::store::VERSION_COURANTE;
use crate::secrets::Secret;

/// Le marqueur de sorte, en tête du fichier.
///
/// **Il existe pour refuser, pas pour décorer.** Sans lui, un `config.json` ou un JSON quelconque
/// tombé sous le sélecteur de fichiers se lirait comme un fichier de transfert vide — donc un import
/// qui ne fait rien, sans rien à dire. Avec lui, le refus nomme ce qu'on attendait.
pub const SORTE: &str = "dorabase.projects";

/// Ce que le fichier porte des mots de passe, tel que son en-tête l'annonce.
///
/// **Recalculé à la lecture, jamais cru sur parole** — voir [`lire`]. Un en-tête faux est pire qu'un
/// en-tête absent : c'est celui-là qu'on croit, et un fichier édité à la main pourrait annoncer
/// « aucun » en portant des mots de passe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export_to = "transfert.ts")]
pub enum CarriedSecrets {
    /// Aucun mot de passe dans le fichier. Le défaut, y compris pour un en-tête muet.
    #[default]
    #[serde(rename = "none")]
    NotCarried,
    /// Des mots de passe **en clair**. Le fichier est alors écrit en `0600` là où le système le
    /// permet — voir [`ecrire`].
    #[serde(rename = "embedded")]
    Embedded,
}

/// Le fichier de transfert, tel qu'il s'écrit et se relit.
///
/// **Ne dérive pas `TS`** : voir la note de tête. Ne dérive pas `Debug` non plus — il est écrit à la
/// main, plus bas, pour la raison qui a fait écrire ceux des adaptateurs : le risque n'est pas
/// d'écrire `{mot_de_passe:?}`, c'est d'écrire `{fichier:?}`.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FichierDeProjets {
    /// [`SORTE`].
    pub kind: String,
    /// La version du format que `projects` porte — **celle du fichier de configuration**, et le
    /// champ porte donc le même nom que là-bas.
    ///
    /// **Et non une version de transfert distincte**, qui aurait été une seconde échelle à tenir en
    /// phase avec celle du magasin : les projets d'un fichier de transfert ont exactement la forme
    /// qu'ils ont dans `config.json`, donc c'est la même version qui les décrit et la même chaîne
    /// qui les migre.
    ///
    /// **Le nom compte, et il est structurel** : `version` à la racine, à côté de `projects`, fait de
    /// cette enveloppe un document que la chaîne de migrations lit **sans adaptateur** — les crans
    /// v1 → v2 et suivants désérialisent un `{ version, projects, … }`, et un `configVersion` les
    /// aurait fait échouer sur un champ manquant. Une enveloppe qui se lit comme un document de
    /// configuration est ce qui rend le partage de la chaîne réel plutôt qu'annoncé.
    ///
    /// L'enveloppe, elle, vieillit comme le reste du dépôt : un champ ajouté prend un
    /// `serde(default)` et ne demande aucun cran (la règle des champs de `27a`), un champ retiré se
    /// garde et se vide, comme `queries`.
    pub version: u32,
    pub secrets: CarriedSecrets,
    pub projects: Vec<Project>,
    /// Les mots de passe en clair, par référence. Vide quand `secrets` vaut `NotCarried`.
    ///
    /// `BTreeMap` et non `HashMap` : l'ordre est celui des références, donc **deux exports de la
    /// même configuration donnent le même fichier octet pour octet**. C'est ce qui rend deux
    /// exports comparables par un `diff`, et c'est la table de `EncryptedFileStore`, pour la même
    /// raison.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub passwords: BTreeMap<String, String>,
    /// Les kubeconfigs que les projets exportés **référencent** (`API-70`).
    ///
    /// **Sans eux, l'import serait cassé en silence.** Une connexion Kubernetes ne porte plus le
    /// chemin de son fichier mais une référence, et les déclarations vivent hors des projets — donc
    /// hors de la portée de cet export. Un fichier qui ne les porterait pas donnerait, sur l'autre
    /// machine, des connexions désignant une déclaration que personne n'y a jamais faite.
    ///
    /// **Seulement celles qui sont référencées**, comme `passwords` ne porte que les références
    /// employées : exporter un projet ne doit pas divulguer la liste des clusters de son auteur.
    ///
    /// **Ce n'est pas une préférence qui voyage.** Le chemin d'un kubeconfig décrit ce dont la
    /// connexion a besoin pour s'ouvrir, au même titre que le chemin d'une clé privée de bastion —
    /// que ce fichier fait voyager depuis toujours, et que l'import **nomme**. Le défaut, lui, ne
    /// voyage pas : c'est un choix de poste.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kubeconfigs: Vec<KubeconfigDeclaration>,
}

impl std::fmt::Debug for FichierDeProjets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FichierDeProjets")
            .field("kind", &self.kind)
            .field("version", &self.version)
            .field("secrets", &self.secrets)
            .field("projects", &self.projects.len())
            // Le **compte**, jamais les valeurs, et jamais les références non plus : celles-ci
            // nomment un projet, une base et un environnement, ce qui n'a rien à faire dans un
            // journal écrit sur disque en développement.
            .field("passwords", &self.passwords.len())
            .finish()
    }
}

/// Ce qui peut faire refuser un export ou un import.
#[derive(Debug)]
pub enum TransfertError {
    /// L'export ne trouve pas le projet nommé — désaccord entre l'écran et le disque.
    ProjetInconnu {
        project: String,
    },
    /// Aucun projet à écrire. Un fichier vide de projets ressemblerait pourtant à un export réussi.
    RienAExporter,
    Io(std::io::Error),
    Serialisation(serde_json::Error),
    /// Le fichier n'est pas un export de projets : `kind` absent ou autre.
    SorteInattendue {
        trouve: String,
    },
    /// Écrit par une version postérieure du format de configuration. Rien n'est importé : lire
    /// une forme qu'on ne connaît pas produirait des connexions plausibles et fausses.
    TropRecent {
        found: u32,
        supported: u32,
    },
    /// Le fichier est de la bonne sorte, mais sa forme n'est pas lisible.
    Illisible {
        raison: String,
    },
    /// Le magasin de secrets a refusé — distinct d'un mot de passe absent.
    Secret {
        detail: String,
    },
    /// La configuration n'a pas pu être écrite après un import. Les mots de passe rangés ont été
    /// **repris**, ou n'ont pas pu l'être — et cela se dit, comme dans `SaveError::Config`.
    Ecriture {
        raison: String,
        secrets_repris: bool,
    },
}

impl std::fmt::Display for TransfertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProjetInconnu { project } => write!(f, "le projet « {project} » n'existe pas"),
            Self::RienAExporter => write!(f, "il n'y a aucun projet à exporter"),
            Self::Io(erreur) => write!(f, "erreur d'entrée-sortie : {erreur}"),
            Self::Serialisation(erreur) => write!(f, "erreur de sérialisation : {erreur}"),
            Self::SorteInattendue { trouve } if trouve.is_empty() => write!(
                f,
                "ce fichier n'est pas un export de projets DoraBase : son en-tête ne porte pas de \
                 champ « kind »"
            ),
            Self::SorteInattendue { trouve } => write!(
                f,
                "ce fichier annonce « {trouve} » ; un export de projets DoraBase annonce \
                 « {SORTE} »"
            ),
            Self::TropRecent { found, supported } => write!(
                f,
                "ce fichier a été écrit par une version plus récente de DoraBase (format {found}, \
                 cette version lit jusqu'au {supported}) : mettez l'application à jour avant de \
                 l'importer"
            ),
            Self::Illisible { raison } => {
                write!(f, "ce fichier n'a pas pu être lu : {raison}")
            }
            Self::Secret { detail } => {
                write!(f, "le magasin de mots de passe a refusé : {detail}")
            }
            Self::Ecriture {
                raison,
                secrets_repris,
            } => {
                write!(f, "la configuration n'a pas pu être écrite : {raison}")?;
                if *secrets_repris {
                    write!(f, " (les mots de passe rangés ont été retirés)")
                } else {
                    write!(
                        f,
                        " (attention : les mots de passe rangés n'ont pas pu être retirés)"
                    )
                }
            }
        }
    }
}

impl std::error::Error for TransfertError {}

impl From<std::io::Error> for TransfertError {
    fn from(erreur: std::io::Error) -> Self {
        Self::Io(erreur)
    }
}

impl From<serde_json::Error> for TransfertError {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Serialisation(erreur)
    }
}

/// Ce qu'un export a écrit, tel que la modale le rend.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "transfert.ts")]
pub struct ExportReport {
    pub projects: usize,
    pub connections: usize,
    pub consoles: usize,
    /// Les mots de passe effectivement écrits. `0` quand la case n'était pas cochée.
    pub passwords_carried: usize,
    /// Les connexions qui déclarent un mot de passe dont le magasin n'a **rien** à rendre —
    /// `base (env)`. Vide quand la case n'était pas cochée : rien n'était demandé, rien ne manque.
    ///
    /// **Une absence, jamais une panne.** Un magasin qui *refuse* fait échouer l'export entier :
    /// confondre les deux ferait ressaisir un mot de passe déjà rangé, et c'est la distinction que
    /// `SecretStore::retrieve` porte depuis `05c`.
    pub passwords_missing: Vec<String>,
}

/// Le sort d'un projet du fichier.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "transfert.ts")]
pub enum ProjectVerdict {
    /// Aucun projet de ce nom ici : il arrive entier.
    Created,
    /// Un projet de ce nom existe : ce qui lui manque y est versé, le reste est gardé.
    Merged,
    /// Écarté par l'utilisateur, qui a décoché sa ligne.
    Skipped,
    /// Refusé : versé, le projet ne tiendrait pas les invariants du modèle. Rien n'est écrit pour
    /// lui, et les autres projets du fichier ne sont pas concernés.
    Rejected { reason: String },
}

/// Ce qu'un import ferait, ou a fait — **le même calcul dans les deux cas** (voir [`fusionner`]).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "transfert.ts")]
pub struct ImportReport {
    /// La version de format que le fichier déclare. Une antérieure a été **migrée** à la lecture ;
    /// la modale l'affiche pour que « ce fichier vient d'une vieille version » ne soit pas à devenir.
    pub version: u32,
    pub secrets: CarriedSecrets,
    /// Un sort par projet du fichier, dans l'ordre du fichier.
    pub projects: Vec<ProjectOutcome>,
}

/// Le détail de ce qu'un projet apporte, et de ce qu'il n'apporte pas.
///
/// **Douze listes plutôt qu'un compte**, et c'est délibéré : un import amputé en silence se lirait
/// comme un import complet, ce qui est le pire défaut que ce geste puisse avoir. Chacune répond à une
/// question qu'on se pose vraiment devant le fichier de quelqu'un d'autre — qu'est-ce qui arrive,
/// qu'est-ce que je garde, qu'est-ce qu'il me reste à faire.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "transfert.ts")]
pub struct ProjectOutcome {
    pub name: String,
    pub verdict: ProjectVerdict,
    /// Les identifiants d'environnement que la fusion déclare en plus.
    pub environments_added: Vec<String>,
    /// Les identifiants déjà déclarés ici : **la déclaration locale est gardée**, libellé, couleur
    /// et drapeau de production compris.
    ///
    /// **Garder plutôt qu'écraser, et la raison n'est pas la simplicité** : `production` gouverne
    /// les garde-fous d'écriture. Reprendre la valeur du fichier pourrait *lever* un garde-fou que
    /// quelqu'un avait posé sur cette machine, en silence et sans qu'il l'ait demandé. Dans ce sens,
    /// l'import ne peut jamais affaiblir ce qui est déjà là.
    pub environments_kept: Vec<String>,
    /// Les connexions ajoutées — `base (env)`.
    pub connections_added: Vec<String>,
    /// Les connexions déjà déclarées ici : leurs réglages sont **gardés**, jamais écrasés.
    ///
    /// Leurs consoles, elles, sont versées quand même : c'est tout l'intérêt du geste — recevoir
    /// les requêtes de quelqu'un sur une base qu'on a déjà. Ce qu'on refuse d'écraser, ce sont les
    /// réglages, parce qu'ils décrivent *comment joindre un serveur* : les reprendre pourrait
    /// repointer en silence une connexion vers un autre hôte.
    pub connections_kept: Vec<String>,
    /// Les connexions que rien ne peut accueillir : leur environnement n'est déclaré ni par le
    /// fichier ni ici. Elles seraient invisibles dans l'arbre, qui liste les connexions sous le
    /// nœud de leur environnement.
    pub connections_rejected: Vec<String>,
    /// Les consoles ajoutées — `base (env) › console`.
    pub consoles_added: Vec<String>,
    /// Les consoles homonymes dans leur connexion : **refusées**, le texte local est gardé.
    pub consoles_kept: Vec<String>,
    /// Les connexions dont le mot de passe arrive avec le fichier.
    pub passwords_stored: Vec<String>,
    /// Les connexions ajoutées qui **attendent** leur mot de passe.
    ///
    /// À dire, faute de quoi la première ouverture échouerait sur le message du serveur — « password
    /// authentication failed » —, qui accuse un mot de passe faux là où il n'y en a aucun.
    pub passwords_missing: Vec<String>,
    /// Les chemins locaux que les connexions ajoutées portent — fichier SQLite, certificat
    /// d'autorité, clé privée d'un bastion, kubeconfig. `base (env) : chemin`.
    ///
    /// Ils voyagent **tels quels** : ce sont des réglages, donc l'intention de quelqu'un, et les
    /// réécrire ou les vider serait pire. Mais ils décrivent une autre machine, donc l'import le
    /// **dit** plutôt que de laisser le découvrir sur un « fichier introuvable ».
    pub local_paths: Vec<String>,
    /// Les colonnes dont les libellés de valeurs arrivent avec le fichier (`API-75`) —
    /// `table.colonne`.
    pub value_labels_added: Vec<String>,
    /// Les colonnes déjà étiquetées **ici** : la déclaration locale est gardée.
    ///
    /// C'est la règle de toute la fusion — on complète, on n'écrase pas. Reprendre le fichier ferait
    /// dire à une colonne autre chose que ce que quelqu'un avait déclaré sur cette machine, et un
    /// libellé faux est pire qu'un libellé absent : c'est celui-là qu'on croit.
    pub value_labels_kept: Vec<String>,
    /// Les connexions dont le kubeconfig référencé **n'est déclaré nulle part dans le fichier**
    /// (`API-70`).
    ///
    /// Un export écrit par DoraBase porte toujours les déclarations qu'il référence ; ce cas vient
    /// d'un fichier édité à la main. La référence est alors **gardée telle quelle**, et non vidée :
    /// la vider ferait ouvrir le kubeconfig par défaut de `kubectl`, c'est-à-dire un autre cluster,
    /// **avec succès**. Gardée, elle est refusée à l'ouverture par un message qui la nomme — et le
    /// rapport le dit ici plutôt que de laisser le découvrir à ce moment-là.
    pub kubeconfigs_missing: Vec<String>,
}

impl ProjectOutcome {
    fn neuf(name: String, verdict: ProjectVerdict) -> Self {
        Self {
            name,
            verdict,
            environments_added: Vec::new(),
            environments_kept: Vec::new(),
            connections_added: Vec::new(),
            connections_kept: Vec::new(),
            connections_rejected: Vec::new(),
            kubeconfigs_missing: Vec::new(),
            value_labels_added: Vec::new(),
            value_labels_kept: Vec::new(),
            consoles_added: Vec::new(),
            consoles_kept: Vec::new(),
            passwords_stored: Vec::new(),
            passwords_missing: Vec::new(),
            local_paths: Vec::new(),
        }
    }
}

/// L'issue d'un versement : la configuration d'après, ce qui s'est passé, et ce qu'il reste à ranger
/// dans le magasin de secrets.
///
/// **Ne dérive pas `Serialize`** : seul `report` traverse l'IPC.
#[derive(Debug)]
pub struct Fusion {
    pub projects: Vec<Project>,
    /// Les kubeconfigs déclarés **après** versement (`API-70`) : ceux de cette machine, plus ceux
    /// que les connexions ajoutées ont fait déclarer.
    ///
    /// **Rendus plutôt qu'écrits ici**, comme les projets et pour la même raison : `fusionner` sert
    /// l'aperçu autant que l'écriture, et un aperçu qui déclarerait des kubeconfigs serait un aperçu
    /// qui écrit.
    pub kubeconfigs: Kubeconfigs,
    pub report: ImportReport,
    /// Les mots de passe à ranger, sous leur référence **locale**. Vide quand le fichier n'en porte
    /// pas.
    ///
    /// `Secret` et non `String` : la valeur ne s'imprime pas au `Debug` de cette structure, et ne
    /// peut pas se sérialiser par mégarde.
    pub secrets_a_ranger: Vec<(SecretRef, Secret)>,
}

/// L'étiquette d'une connexion dans un rapport : `base (env)`.
///
/// **`name` et non `label`** : c'est l'identité, la même que la clé du registre et la référence du
/// secret. Un libellé d'affichage divergerait de ce que les autres listes du rapport nomment.
fn etiquette(base: &Database) -> String {
    format!("{} ({})", base.name, base.environment)
}

/// Les chemins d'une connexion qui décrivent **cette machine-ci**.
///
/// Le `match` sur [`Proxy`] est exhaustif, sans bras attrape-tout : une quatrième sorte de proxy
/// fera échouer la compilation ici, là où son auteur doit décider si elle porte un chemin (règle
/// n° 16).
///
/// `declarations` est la liste **telle qu'elle est après versement** (`API-70`), et l'ordre compte :
/// la référence de la connexion a déjà été remise sur la déclaration locale quand on arrive ici, donc
/// la chercher dans celle du fichier ne trouverait rien — et le rapport tairait un chemin qu'il
/// existe précisément pour nommer. Le chemin, lui, est le même des deux côtés : c'est par lui que la
/// déclaration a été reprise ou posée.
fn chemins_locaux(base: &Database, declarations: &[KubeconfigDeclaration]) -> Vec<String> {
    let mut chemins = Vec::new();
    let reglages = &base.connection;

    // Un moteur de fichier range le chemin de sa base dans `default_database` (`17a`) : pour lui, et
    // pour lui seul, ce champ est un chemin.
    if matches!(base.engine, super::model::Engine::Sqlite)
        && !reglages.default_database.trim().is_empty()
    {
        chemins.push(reglages.default_database.clone());
    }
    if let Some(certificat) = reglages
        .ca_certificate
        .as_deref()
        .filter(|chemin| !chemin.trim().is_empty())
    {
        chemins.push(certificat.to_owned());
    }
    if let Some(tunnel) = &reglages.tunnel {
        match &tunnel.proxy {
            Proxy::Ssh(ssh) if !ssh.private_key_path.trim().is_empty() => {
                chemins.push(ssh.private_key_path.clone());
            }
            Proxy::Ssh(_) => {}
            // Un nom d'instance Cloud SQL n'est pas un chemin, et l'authentification passe par les
            // identifiants par défaut de l'application, qui n'en déclarent aucun ici (`06i`).
            Proxy::CloudSql(_) => {}
            // La référence est résolue dans les déclarations du fichier : c'est le **chemin** qui
            // décrit une machine, pas l'identifiant qui le désigne. Une référence que le fichier ne
            // déclare pas ne nomme rien — elle est signalée ailleurs, par la fusion.
            Proxy::Kubernetes(kube) => {
                if let Some(chemin) = kube.kubeconfig.as_ref().and_then(|reference| {
                    declarations
                        .iter()
                        .find(|declaration| &declaration.id == reference)
                        .map(|declaration| declaration.path.trim())
                        .filter(|chemin| !chemin.is_empty())
                }) {
                    chemins.push(chemin.to_owned());
                }
            }
        }
    }

    chemins
}

/// Prépare les projets d'un export : ceux qu'on garde, nettoyés de ce qui ne voyage pas.
///
/// `seul` nomme un projet, ou `None` pour tous — les deux portées que la demande décrit.
pub fn composer(projects: &[Project], seul: Option<&str>) -> Result<Vec<Project>, TransfertError> {
    let retenus: Vec<Project> = match seul {
        Some(nom) => {
            let projet = projects
                .iter()
                .find(|projet| projet.name == nom)
                .ok_or_else(|| TransfertError::ProjetInconnu {
                    project: nom.to_owned(),
                })?;
            vec![projet.clone()]
        }
        None => projects.to_vec(),
    };

    if retenus.is_empty() {
        return Err(TransfertError::RienAExporter);
    }

    Ok(retenus
        .into_iter()
        .map(|mut projet| {
            // **Le champ en transit de `12f` ne voyage pas.** À la lecture d'une configuration, les
            // requêtes enregistrées se versent dans la première connexion du projet ; les écrire ici
            // les ferait verser une seconde fois, dans une connexion qui n'est peut-être pas la
            // même. `skip_serializing_if` fait qu'un vecteur vide n'apparaît même pas dans le
            // fichier.
            projet.queries = Vec::new();
            projet
        })
        .collect())
}

/// Assemble le fichier, et lit les mots de passe si on les lui demande.
///
/// **Le magasin n'est consulté que si `avec_les_mots_de_passe`.** Un export ordinaire ne touche donc
/// pas au Trousseau, ce qui compte sur macOS où chaque lecture peut poser une question à
/// l'utilisateur selon les ACL de l'entrée.
pub fn preparer(
    projects: Vec<Project>,
    avec_les_mots_de_passe: bool,
    magasin: &dyn crate::secrets::SecretStore,
    kubeconfigs: &Kubeconfigs,
) -> Result<(FichierDeProjets, ExportReport), TransfertError> {
    let mut passwords = BTreeMap::new();
    let mut manquants = Vec::new();
    let mut connexions = 0usize;
    let mut consoles = 0usize;

    for projet in &projects {
        for base in &projet.databases {
            connexions += 1;
            consoles += base.consoles.len();

            let Some(reference) = base.connection.password.as_ref() else {
                continue;
            };
            if !avec_les_mots_de_passe {
                continue;
            }
            match magasin.retrieve(reference) {
                Ok(Some(secret)) => {
                    passwords.insert(reference.as_str().to_owned(), secret.expose().to_owned());
                }
                // Une absence : la connexion déclare un mot de passe que le magasin n'a pas. Elle est
                // **nommée**, et l'export continue — refuser tout pour une entrée effacée à la main
                // rendrait le geste impossible sans qu'on sache pourquoi.
                Ok(None) => manquants.push(etiquette(base)),
                // Une panne : elle arrête l'export. Quelqu'un a demandé les mots de passe, et un
                // fichier qui en tairait la moitié serait exactement l'artefact dangereux de ce
                // geste.
                Err(erreur) => {
                    return Err(TransfertError::Secret {
                        detail: erreur.to_string(),
                    });
                }
            }
        }
    }

    let declarations = declarations_referencees(&projects, kubeconfigs);

    let report = ExportReport {
        projects: projects.len(),
        connections: connexions,
        consoles,
        passwords_carried: passwords.len(),
        passwords_missing: manquants,
    };

    let fichier = FichierDeProjets {
        kind: SORTE.to_owned(),
        version: VERSION_COURANTE,
        secrets: if passwords.is_empty() {
            CarriedSecrets::NotCarried
        } else {
            CarriedSecrets::Embedded
        },
        projects,
        passwords,
        kubeconfigs: declarations,
    };

    Ok((fichier, report))
}

/// Les déclarations de kubeconfig que ces projets référencent (`API-70`).
///
/// **Déterministe et sans doublon** : l'ordre est celui de la liste déclarée, non celui des
/// connexions rencontrées, de sorte que deux exports de la même configuration rendent le même
/// fichier octet pour octet — la propriété que `passwords` obtient de sa `BTreeMap`.
///
/// Une référence que la configuration ne déclare plus est simplement absente : elle ne désigne rien
/// ici non plus, et l'export n'a rien à en dire que l'import puisse employer.
fn declarations_referencees(
    projects: &[Project],
    kubeconfigs: &Kubeconfigs,
) -> Vec<KubeconfigDeclaration> {
    let mut references: Vec<&KubeconfigId> = Vec::new();
    for projet in projects {
        for base in &projet.databases {
            let Some(tunnel) = &base.connection.tunnel else {
                continue;
            };
            if let Proxy::Kubernetes(kube) = &tunnel.proxy {
                if let Some(reference) = &kube.kubeconfig {
                    if !references.contains(&reference) {
                        references.push(reference);
                    }
                }
            }
        }
    }
    kubeconfigs
        .declarations
        .iter()
        .filter(|declaration| references.contains(&&declaration.id))
        .cloned()
        .collect()
}

/// Écrit le fichier.
///
/// **Sérialisé en entier avant d'ouvrir quoi que ce soit.** Un fichier tronqué qui ressemble à un
/// export est l'artefact dangereux de ce geste, comme un dump tronqué l'est du sien ; sérialiser
/// d'abord met l'échec le plus probable — une forme inattendue — avant la création du fichier.
///
/// **`0600` quand le fichier porte des mots de passe**, et posé sur un fichier encore **vide** :
/// `set_permissions` après l'écriture laisserait les octets sensibles lisibles par tout compte de la
/// machine le temps d'un appel. Un fichier sans mot de passe garde les droits ordinaires — il est
/// fait pour être partagé, et le restreindre serait une gêne que personne n'a demandée. Windows n'a
/// pas d'équivalent bon marché : ses ACL s'héritent du répertoire, et le dire vaut mieux que de
/// laisser croire à une protection.
pub fn ecrire(chemin: &Path, fichier: &FichierDeProjets) -> Result<(), TransfertError> {
    // `to_string_pretty` : ce fichier est fait pour être lu, envoyé par message, versionné. Le coût
    // en octets d'une configuration est sans commune mesure avec celui d'un dump.
    //
    // **Sérialisé en entier avant qu'on touche au fichier** : l'échec le plus probable — une forme
    // inattendue — se produit alors sans qu'aucun octet soit parti.
    let mut contenu = serde_json::to_string_pretty(fichier)?;
    contenu.push('\n');

    if fichier.secrets == CarriedSecrets::Embedded {
        restreindre_au_proprietaire(chemin)?;
    }

    // **L'écriture appartient à `engine::export`**, et non à une seconde copie ici (`API-29`).
    // Celle-là porte une garantie que la version d'origine de cette fonction n'avait pas : à
    // l'échec **d'écriture**, le fichier partiel est supprimé — un export tronqué qui ressemble à
    // un export complet est l'artefact dangereux de ce geste, comme un dump tronqué l'est du sien.
    // Et seulement à l'échec d'écriture : supprimer sur un échec **d'ouverture** effacerait un
    // fichier auquel on n'a jamais touché. Deux écritures de fichier d'export dans le dépôt
    // auraient divergé sur ce détail-là précisément (règle n° 17), et c'est celle qui a raison qui
    // a été gardée.
    crate::engine::export::ecrire(chemin, &contenu)
        .map(|_| ())
        .map_err(|raison| TransfertError::Illisible { raison })
}

/// Restreint le fichier à son propriétaire **avant** qu'un octet sensible y entre.
///
/// # Pourquoi avant, et pourquoi sans troncature
///
/// `set_permissions` après l'écriture laisserait les mots de passe lisibles par tout compte de la
/// machine le temps d'un appel. Il faut donc que le fichier existe et soit restreint d'abord — mais
/// **sans le tronquer** : `File::create` viderait un fichier que l'écriture pourrait ensuite refuser
/// d'ouvrir, et détruire l'export précédent pour un export qui n'a pas eu lieu serait pire que le
/// défaut qu'on évite. D'où `create(true).truncate(false)`, et un `set_permissions` explicite qui
/// rattrape le cas d'un fichier **déjà là** avec des droits plus larges — `mode()` ne s'applique
/// qu'à la création.
///
/// **Et `truncate(false)` est une précaution qu'aucun test d'ici n'exerce**, ce qui se dit plutôt
/// que de se supposer gardé (règle n° 1) : pour l'atteindre il faudrait que cette ouverture
/// réussisse et que celle de l'écriture échoue juste après, sur le même chemin — un fichier
/// inscriptible l'est pour les deux. Ce que les tests gardent est ce qui est observable : les droits
/// obtenus, sur un fichier neuf comme sur un fichier déjà là. L'ordre, lui, ne coûte qu'un mot, et
/// c'est la différence entre « on pourrait détruire l'export précédent » et « on ne le fait pas ».
///
/// Un fichier **sans** mot de passe n'appelle pas cette fonction : il est fait pour être partagé, et
/// le restreindre serait une gêne que personne n'a demandée.
///
/// Windows n'a pas d'équivalent bon marché — ses ACL s'héritent du répertoire —, et le dire vaut
/// mieux que de laisser croire à une protection.
#[cfg(unix)]
fn restreindre_au_proprietaire(chemin: &Path) -> Result<(), TransfertError> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(chemin)?;
    std::fs::set_permissions(chemin, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restreindre_au_proprietaire(_chemin: &Path) -> Result<(), TransfertError> {
    Ok(())
}

/// L'enveloppe telle qu'elle se lit : `projects` reste du JSON, parce qu'il peut être d'une forme
/// antérieure qu'il faut migrer avant de la désérialiser.
///
/// **Tous les champs ont un défaut** : un JSON quelconque doit s'analyser sans erreur pour que le
/// refus porte sur `kind` — « ce fichier n'est pas un export de projets » — et non sur un champ
/// manquant, qui accuserait la forme là où c'est la sorte qui est en cause.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Enveloppe {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    version: u32,
    #[serde(default)]
    passwords: BTreeMap<String, String>,
    /// **Lues telles quelles, sans migration** (`API-70`) : ce sont des déclarations, pas des
    /// projets, et leur forme n'a pas de version antérieure — un fichier d'avant la v6 n'en porte
    /// aucune, et ce sont celles que la chaîne de migration vient de créer qui comptent alors.
    #[serde(default)]
    kubeconfigs: Vec<KubeconfigDeclaration>,
}

/// Lit un fichier de transfert, en migrant ses projets si sa version est antérieure.
pub fn lire(chemin: &Path) -> Result<FichierDeProjets, TransfertError> {
    let brut = std::fs::read_to_string(chemin)?;
    let valeur: serde_json::Value =
        serde_json::from_str(&brut).map_err(|erreur| TransfertError::Illisible {
            raison: format!("JSON invalide : {erreur}"),
        })?;

    let enveloppe: Enveloppe =
        serde_json::from_value(valeur.clone()).map_err(|erreur| TransfertError::Illisible {
            raison: format!("en-tête inattendu : {erreur}"),
        })?;

    // **La sorte d'abord.** C'est le seul refus qui puisse être formulé sans rien supposer du reste,
    // et c'est celui qui répond au geste le plus probable — avoir désigné le mauvais fichier.
    if enveloppe.kind != SORTE {
        return Err(TransfertError::SorteInattendue {
            trouve: enveloppe.kind,
        });
    }

    if enveloppe.version > VERSION_COURANTE {
        return Err(TransfertError::TropRecent {
            found: enveloppe.version,
            supported: VERSION_COURANTE,
        });
    }

    // **Les déclarations d'un fichier antérieur à la v6 sont celles que la migration vient de
    // créer** : là-bas, les chemins sont encore écrits dans les connexions, et c'est le cran qui les
    // relève. Un fichier déjà en v6 les porte, et la migration ne tourne pas — d'où le `if`, et non
    // un `unwrap_or` qui aurait laissé croire à un repli.
    let (projects, declarees) = super::store::projets_du_document(valeur, enveloppe.version)
        .map_err(|raison| TransfertError::Illisible { raison })?;
    let kubeconfigs = if enveloppe.version < VERSION_COURANTE {
        declarees.declarations
    } else {
        enveloppe.kubeconfigs
    };

    Ok(FichierDeProjets {
        kind: enveloppe.kind,
        version: enveloppe.version,
        // **Recalculée, jamais reprise de l'en-tête.** Ce que la modale annonce doit décrire ce que
        // le fichier porte vraiment : un en-tête à « none » sur un fichier plein de mots de passe
        // tairait exactement ce qu'il fallait dire.
        secrets: if enveloppe.passwords.is_empty() {
            CarriedSecrets::NotCarried
        } else {
            CarriedSecrets::Embedded
        },
        projects,
        passwords: enveloppe.passwords,
        kubeconfigs,
    })
}

/// Verse les projets d'un fichier dans une configuration, et dit ce qui s'est passé.
///
/// # Une seule fonction pour l'aperçu et pour l'écriture
///
/// La modale d'import montre ce qui *va* se passer, puis écrit. Les deux réponses viennent d'**ici**,
/// et il n'y a pas de « planifier » distinct d'un « appliquer » : deux calculs pour le même acte en
/// laissent un en arrière (règle n° 17), et c'est celui qui décide qu'on aurait cessé d'exercer. La
/// commande d'aperçu jette `projects` et `secrets_a_ranger` ; celle qui écrit les emploie.
///
/// Le versement est donc **recalculé** au moment d'écrire, sur la configuration telle qu'elle est
/// alors : un aperçu resservi tel quel écraserait une connexion créée entre-temps dans un autre
/// écran.
///
/// # `retenus`
///
/// `None` retient tout — c'est la forme que l'aperçu emploie, pour décrire chaque projet du fichier.
/// Un projet écarté reçoit le verdict `Skipped` et des listes vides, de sorte que la modale rend ses
/// lignes depuis le rapport seul.
///
/// **Le sort d'un projet ne dépend pas de la sélection**, les projets étant indépendants par leur
/// nom : l'aperçu tout-retenu décrit donc exactement ce que n'importe quel sous-ensemble fera.
pub fn fusionner(
    locaux: &[Project],
    kubeconfigs_locaux: &Kubeconfigs,
    fichier: &FichierDeProjets,
    retenus: Option<&[String]>,
) -> Fusion {
    let mut projects = locaux.to_vec();
    let mut kubeconfigs = kubeconfigs_locaux.clone();
    let mut sorts = Vec::with_capacity(fichier.projects.len());
    let mut secrets_a_ranger = Vec::new();

    for entrant in &fichier.projects {
        if retenus.is_some_and(|noms| !noms.iter().any(|nom| nom == &entrant.name)) {
            sorts.push(ProjectOutcome::neuf(
                entrant.name.clone(),
                ProjectVerdict::Skipped,
            ));
            continue;
        }

        let place = projects
            .iter()
            .position(|projet| projet.name == entrant.name);
        let verdict = if place.is_some() {
            ProjectVerdict::Merged
        } else {
            ProjectVerdict::Created
        };
        let mut sort = ProjectOutcome::neuf(entrant.name.clone(), verdict);
        /*
         * Combien de secrets étaient en attente **avant** ce projet.
         *
         * C'est ce qui permet de défaire exactement ce que celui-ci a mis en attente, si sa
         * validation le refuse : `secrets_a_ranger` ne fait que s'allonger, donc une troncature à
         * cette longueur rend l'état d'avant, sans rien supposer de ce qu'il contient.
         *
         * **Un filtre par préfixe de référence a été écrit d'abord, et il était faux** : une
         * référence vaut `projet/base/environnement`, donc écarter tout ce qui commence par
         * « A/ » emportait aussi les secrets d'un projet nommé « A/B », traité plus tôt. Le `/`
         * dans un nom de projet est déjà une collision assumée pour les références elles-mêmes
         * (voir `reference_de`) ; en faire dépendre un *retrait* aurait été une aggravation
         * silencieuse, et sur les secrets de quelqu'un d'autre que le projet refusé.
         */
        let secrets_avant = secrets_a_ranger.len();

        // **Un candidat validé à part**, plutôt qu'une mutation à défaire : c'est l'idiome
        // d'`enregistrer`, et une mutation défaite est une mutation qu'on peut oublier.
        let mut candidat = match place {
            Some(index) => projects[index].clone(),
            None => Project {
                name: entrant.name.clone(),
                environments: Vec::new(),
                databases: Vec::new(),
                queries: Vec::new(),
                value_labels: BTreeMap::new(),
            },
        };

        // **Ce qui était là *avant* la fusion**, capturé une fois. Les deux listes du rapport disent
        // « déjà déclaré **ici** », et les mesurer sur le candidat qui grandit ferait passer un
        // doublon *du fichier* pour une déclaration locale — un rapport qui accuse la machine de ce
        // que le fichier porte. Un fichier qui déclare deux fois le même identifiant n'entre donc
        // dans aucune des deux listes : rien n'est ajouté deux fois, et rien de local n'a été gardé.
        let environnements_locaux: Vec<EnvironmentId> = candidat
            .environments
            .iter()
            .map(|declaration| declaration.id.clone())
            .collect();
        let connexions_locales: Vec<(String, EnvironmentId)> = candidat
            .databases
            .iter()
            .map(|base| (base.name.clone(), base.environment.clone()))
            .collect();

        for declaration in &entrant.environments {
            if environnements_locaux.contains(&declaration.id) {
                sort.environments_kept.push(declaration.id.to_string());
            } else if !candidat.declare(&declaration.id) {
                sort.environments_added.push(declaration.id.to_string());
                candidat.environments.push(declaration.clone());
            }
        }

        for base in &entrant.databases {
            let nom = etiquette(base);

            if !candidat.declare(&base.environment) {
                sort.connections_rejected.push(nom);
                continue;
            }

            let existante = candidat.databases.iter().position(|locale| {
                locale.name == base.name && locale.environment == base.environment
            });

            match existante {
                Some(index) => {
                    // Même distinction que pour les environnements : « gardée » veut dire « déjà
                    // déclarée ici », non « le fichier la porte deux fois ».
                    if connexions_locales
                        .iter()
                        .any(|(nom, env)| nom == &base.name && env == &base.environment)
                    {
                        sort.connections_kept.push(nom.clone());
                    }
                    verser_les_consoles(
                        &mut candidat.databases[index],
                        &base.consoles,
                        &nom,
                        &mut sort,
                    );
                }
                None => {
                    sort.connections_added.push(nom.clone());
                    let mut arrivante = base.clone();

                    // La référence est **recalculée** sur le triplet d'arrivée, jamais reprise du
                    // fichier : c'est une coordonnée locale, dérivée du projet, de la base et de
                    // l'environnement (`08e`), et un fichier édité à la main pourrait en porter
                    // n'importe laquelle. La valeur, elle, se cherche sous la référence **du
                    // fichier**, qui est la clé sous laquelle l'export l'a rangée.
                    if let Some(ancienne) = base.connection.password.clone() {
                        let locale =
                            reference_de(&candidat.name, &base.name, base.environment.as_str());
                        match fichier.passwords.get(ancienne.as_str()) {
                            Some(valeur) => {
                                sort.passwords_stored.push(nom.clone());
                                secrets_a_ranger
                                    .push((locale.clone(), Secret::new(valeur.clone())));
                            }
                            None => sort.passwords_missing.push(nom.clone()),
                        }
                        arrivante.connection.password = Some(locale);
                    }

                    // La référence de kubeconfig est **remise sur la déclaration locale**, pour la
                    // raison exacte de la référence de secret ci-dessus : celle du fichier est une
                    // coordonnée de l'autre machine. `declarer` dédoublonne par le **chemin**, donc
                    // un fichier déjà déclaré ici est repris plutôt que doublé, et deux connexions
                    // importées qui nommaient le même fichier le partagent encore après le voyage.
                    if let Some(reference) = reference_de_kubeconfig(&arrivante) {
                        match chemin_declare(&fichier.kubeconfigs, &reference) {
                            Some(chemin) => {
                                let locale = kubeconfigs.declarer(chemin);
                                poser_la_reference_de_kubeconfig(&mut arrivante, locale);
                            }
                            // Gardée telle quelle : voir `ImportReport::kubeconfigs_missing`.
                            None => sort.kubeconfigs_missing.push(nom.clone()),
                        }
                    }

                    for chemin in chemins_locaux(&arrivante, &kubeconfigs.declarations) {
                        sort.local_paths.push(format!("{nom} : {chemin}"));
                    }
                    for console in &arrivante.consoles {
                        sort.consoles_added
                            .push(format!("{nom} › {}", console.name));
                    }

                    candidat.databases.push(arrivante);
                }
            }
        }

        /*
         * Les libellés de valeurs (`API-75`).
         *
         * **Ils voyagent parce qu'ils vivent sur le `Project`**, dont le fichier de transfert porte
         * exactement le type. Sans ce versement, un projet **déjà déclaré ici** recevrait ses
         * connexions et ses consoles mais laisserait ses libellés dans le fichier, en silence — le
         * défaut que ce geste ne doit jamais avoir.
         *
         * **Colonne par colonne, et non table par table** : deux machines peuvent avoir étiqueté
         * deux colonnes différentes de la même table, et remplacer la table entière en perdrait une.
         *
         * **Aucun instantané des clés locales n'est nécessaire ici**, contrairement aux
         * environnements et aux connexions : les clés d'une `BTreeMap` sont uniques, donc le fichier
         * ne peut pas déclarer deux fois la même colonne et se faire passer pour une déclaration
         * locale.
         */
        for (table, colonnes) in &entrant.value_labels {
            for (colonne, libelles) in colonnes {
                let etiquette = format!("{table}.{colonne}");
                if candidat
                    .value_labels
                    .get(table)
                    .is_some_and(|locales| locales.contains_key(colonne))
                {
                    sort.value_labels_kept.push(etiquette);
                } else {
                    sort.value_labels_added.push(etiquette);
                    candidat
                        .value_labels
                        .entry(table.clone())
                        .or_default()
                        .insert(colonne.clone(), libelles.clone());
                }
            }
        }

        match candidat.valider() {
            Ok(()) => match place {
                Some(index) => projects[index] = candidat,
                None => projects.push(candidat),
            },
            // **Le filet de sécurité, et il doit rester.** Les refus ci-dessus couvrent ce qu'on sait
            // nommer ; celui-ci couvre ce qu'on ne sait pas encore — un invariant ajouté au modèle
            // après ce fichier. Une configuration invalide écrite sur disque coûterait la mise en
            // quarantaine de tout, au prochain démarrage.
            Err(erreur) => {
                // **Le sort est remis à neuf**, et non amendé champ par champ : un projet refusé
                // n'apporte rien, donc aucune de ses douze listes ne veut plus rien dire. Les vider
                // une par une laissait « n connexions attendent leur mot de passe » sur un projet
                // dont aucune connexion n'arrive — une réserve à propos de rien, et le genre
                // d'oubli qui revient à chaque liste ajoutée.
                sort = ProjectOutcome::neuf(
                    entrant.name.clone(),
                    ProjectVerdict::Rejected {
                        reason: erreur.to_string(),
                    },
                );
                secrets_a_ranger.truncate(secrets_avant);
            }
        }

        sorts.push(sort);
    }

    Fusion {
        projects,
        report: ImportReport {
            version: fichier.version,
            secrets: fichier.secrets,
            projects: sorts,
        },
        kubeconfigs,
        secrets_a_ranger,
    }
}

/// La référence de kubeconfig d'une connexion, s'il y en a une.
fn reference_de_kubeconfig(base: &Database) -> Option<KubeconfigId> {
    let tunnel = base.connection.tunnel.as_ref()?;
    match &tunnel.proxy {
        Proxy::Kubernetes(kube) => kube.kubeconfig.clone(),
        Proxy::Ssh(_) | Proxy::CloudSql(_) => None,
    }
}

/// Repose la référence de kubeconfig d'une connexion.
fn poser_la_reference_de_kubeconfig(base: &mut Database, reference: KubeconfigId) {
    if let Some(tunnel) = base.connection.tunnel.as_mut() {
        if let Proxy::Kubernetes(kube) = &mut tunnel.proxy {
            kube.kubeconfig = Some(reference);
        }
    }
}

/// Le chemin qu'une déclaration du **fichier** donne à cette référence.
fn chemin_declare<'a>(
    declarations: &'a [KubeconfigDeclaration],
    reference: &KubeconfigId,
) -> Option<&'a str> {
    declarations
        .iter()
        .find(|declaration| &declaration.id == reference)
        .map(|declaration| declaration.path.trim())
        .filter(|chemin| !chemin.is_empty())
}

/// Verse les consoles d'une connexion entrante dans une connexion **déjà déclarée**.
///
/// **Une console homonyme est refusée, le texte local gardé.** Un SQL est un travail : le remplacer
/// par celui du fichier perdrait ce que quelqu'un a écrit, sans un mot. Le refus, lui, se dit.
fn verser_les_consoles(
    locale: &mut Database,
    entrantes: &[Console],
    nom: &str,
    sort: &mut ProjectOutcome,
) {
    for console in entrantes {
        let etiquette = format!("{nom} › {}", console.name);
        if locale
            .consoles
            .iter()
            .any(|autre| autre.name == console.name)
        {
            sort.consoles_kept.push(etiquette);
        } else {
            sort.consoles_added.push(etiquette);
            locale.consoles.push(console.clone());
        }
    }
}

/// Applique un versement : range les mots de passe, puis écrit la configuration.
///
/// # L'ordre, et pourquoi c'est celui-là
///
/// C'est celui d'`enregistrer` : **le secret d'abord, la configuration ensuite**, et le secret repris
/// si l'écriture refuse. L'ordre inverse laisserait une connexion déclarée sans son mot de passe, qui
/// le redemanderait sans que rien l'explique.
///
/// **Aucun mot de passe existant n'est écrasé, et ce n'est pas une précaution mais une conséquence.**
/// Une référence est dérivée du triplet `projet/base/environnement` (`08e`), et [`fusionner`] ne
/// range un mot de passe que pour une connexion qu'elle **ajoute** — dont le triplet n'était donc
/// déclaré nulle part. Ce qui peut se trouver sous cette référence est un orphelin, resté d'une
/// connexion retirée dont le magasin n'avait pas su effacer le secret : l'écraser est exactement ce
/// qu'il faut faire.
/// Ce qu'[`appliquer`] appelle pour écrire : les projets versés **et** les kubeconfigs déclarés.
///
/// **Les deux ensemble, en une écriture** (`API-70`) : le versement fait grandir la liste des
/// déclarations, donc les écrire séparément laisserait une fenêtre où les connexions importées
/// désignent une déclaration qui n'est pas encore sur le disque.
type EcrireLaConfiguration<'a> = dyn FnMut(&[Project], &Kubeconfigs) -> Result<(), String> + 'a;

pub fn appliquer(
    fusion: Fusion,
    magasin: &dyn crate::secrets::SecretStore,
    ecrire: &mut EcrireLaConfiguration<'_>,
) -> Result<(Vec<Project>, ImportReport), TransfertError> {
    let Fusion {
        projects,
        kubeconfigs,
        report,
        secrets_a_ranger,
    } = fusion;

    let mut ecrits: Vec<SecretRef> = Vec::with_capacity(secrets_a_ranger.len());
    for (reference, secret) in &secrets_a_ranger {
        if let Err(erreur) = magasin.store(reference, secret) {
            // **Ce qui est déjà rangé est reprise avant de rendre l'erreur** : sans cela, un import
            // refusé à mi-parcours laisserait dans le Trousseau des entrées que rien ne nettoierait
            // jamais — invisibles, puisqu'aucune connexion ne les déclare.
            super::enregistrer::retirer_les_ecrits(magasin, &ecrits);
            return Err(TransfertError::Secret {
                detail: erreur.to_string(),
            });
        }
        ecrits.push(reference.clone());
    }

    match ecrire(&projects, &kubeconfigs) {
        Ok(()) => Ok((projects, report)),
        Err(raison) => Err(TransfertError::Ecriture {
            raison,
            secrets_repris: super::enregistrer::retirer_les_ecrits(magasin, &ecrits),
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;
    use crate::config::model::{
        ConnectionSettings, Engine, EnvironmentColor, EnvironmentDeclaration, EnvironmentId,
        ProxyKubernetes, ProxySsh, SavedQuery, SslMode, Tunnel,
    };
    use crate::secrets::{SecretError, SecretStore};

    /// Un magasin en mémoire qui **compte ses lectures**.
    ///
    /// Le compte n'est pas décoratif : c'est la seule façon de garder « un export sans la case
    /// cochée ne consulte pas le magasin ». Un test qui vérifierait seulement que le fichier ne porte
    /// pas de mot de passe resterait vert si l'export lisait le Trousseau pour rien — et sur macOS,
    /// une lecture peut poser une question à l'utilisateur.
    pub(super) struct Magasin {
        table: Mutex<HashMap<String, String>>,
        lectures: Mutex<usize>,
        panne_en_lecture: bool,
        /// Le rang de l'écriture qui échoue, en comptant depuis 1. `None` : aucune.
        ///
        /// **Un rang et non un booléen**, et c'est ce qui rend la reprise mesurable : un magasin qui
        /// refuse *toutes* les écritures ne range jamais rien, donc il n'y a rien à reprendre et le
        /// test resterait vert sans la reprise. C'est la règle n° 5 — un décor qui rend le défaut
        /// indiscernable ne mesure que le décor.
        panne_a_l_ecriture: Option<usize>,
        ecritures: Mutex<usize>,
    }

    impl Magasin {
        pub(super) fn neuf() -> Self {
            Self {
                table: Mutex::new(HashMap::new()),
                lectures: Mutex::new(0),
                panne_en_lecture: false,
                panne_a_l_ecriture: None,
                ecritures: Mutex::new(0),
            }
        }

        fn avec(entrees: &[(&str, &str)]) -> Self {
            let magasin = Self::neuf();
            for (reference, valeur) in entrees {
                magasin
                    .table
                    .lock()
                    .expect("table")
                    .insert((*reference).to_owned(), (*valeur).to_owned());
            }
            magasin
        }

        fn lectures(&self) -> usize {
            *self.lectures.lock().expect("compte")
        }

        fn lu(&self, reference: &str) -> Option<String> {
            self.table.lock().expect("table").get(reference).cloned()
        }
    }

    impl SecretStore for Magasin {
        fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
            let rang = {
                let mut compte = self.ecritures.lock().expect("compte");
                *compte += 1;
                *compte
            };
            if self.panne_a_l_ecriture == Some(rang) {
                return Err(SecretError::Magasin {
                    detail: "magasin en panne".into(),
                });
            }
            self.table
                .lock()
                .expect("table")
                .insert(reference.as_str().to_owned(), secret.expose().to_owned());
            Ok(())
        }

        fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
            *self.lectures.lock().expect("compte") += 1;
            if self.panne_en_lecture {
                return Err(SecretError::Magasin {
                    detail: "magasin en panne".into(),
                });
            }
            Ok(self
                .table
                .lock()
                .expect("table")
                .get(reference.as_str())
                .map(|valeur| Secret::new(valeur.clone())))
        }

        fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
            self.table.lock().expect("table").remove(reference.as_str());
            Ok(())
        }
    }

    fn reglages() -> ConnectionSettings {
        ConnectionSettings {
            host: "db.interne".into(),
            port: 5432,
            default_database: "catalogue".into(),
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

    fn declaration(id: &str, production: bool) -> EnvironmentDeclaration {
        EnvironmentDeclaration {
            id: EnvironmentId::brut(id),
            label: id.to_owned(),
            color: EnvironmentColor::Green,
            production,
        }
    }

    pub(super) fn connexion(nom: &str, env: &str) -> Database {
        Database {
            name: nom.to_owned(),
            label: None,
            engine: Engine::PostgreSql,
            environment: EnvironmentId::brut(env),
            connection: reglages(),
            consoles: Vec::new(),
            visible_schemas: None,
        }
    }

    pub(super) fn projet(nom: &str, envs: &[&str], bases: Vec<Database>) -> Project {
        Project {
            name: nom.to_owned(),
            environments: envs.iter().map(|id| declaration(id, false)).collect(),
            databases: bases,
            queries: Vec::new(),
            value_labels: BTreeMap::new(),
        }
    }

    fn fichier_de(projects: Vec<Project>) -> FichierDeProjets {
        fichier_de_avec(projects, Vec::new())
    }

    /// Un fichier qui porte aussi des déclarations de kubeconfig (`API-70`).
    fn fichier_de_avec(
        projects: Vec<Project>,
        kubeconfigs: Vec<KubeconfigDeclaration>,
    ) -> FichierDeProjets {
        FichierDeProjets {
            kind: SORTE.to_owned(),
            version: VERSION_COURANTE,
            secrets: CarriedSecrets::NotCarried,
            projects,
            passwords: BTreeMap::new(),
            kubeconfigs,
        }
    }

    // ----- l'export -----

    #[test]
    fn un_export_ne_porte_pas_les_requetes_en_transit() {
        let mut source = projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]);
        source.queries = vec![SavedQuery {
            name: "ancienne".into(),
            sql: "select 1".into(),
        }];

        let retenus = composer(&[source], None).expect("export");

        assert!(
            retenus[0].queries.is_empty(),
            "le champ en transit de `12f` ne doit pas voyager : il se verse en console à la lecture \
             d'une configuration, et l'écrire ici le verserait une seconde fois"
        );
    }

    #[test]
    fn un_export_d_un_seul_projet_ne_porte_que_lui() {
        let projets = vec![
            projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]),
            projet("Quai", &["dev"], vec![connexion("stocks", "dev")]),
        ];

        let retenus = composer(&projets, Some("Quai")).expect("export");

        assert_eq!(retenus.len(), 1);
        assert_eq!(retenus[0].name, "Quai");
    }

    #[test]
    fn un_export_d_un_projet_inconnu_est_refuse() {
        let projets = vec![projet("Halle", &["dev"], Vec::new())];

        let erreur = composer(&projets, Some("Absent")).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::ProjetInconnu { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn un_export_sans_aucun_projet_est_refuse() {
        // Un fichier portant zéro projet ressemblerait à un export réussi, et se réimporterait sans
        // rien faire ni rien dire.
        let erreur = composer(&[], None).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::RienAExporter),
            "{erreur:?}"
        );
    }

    #[test]
    fn sans_la_case_cochee_le_magasin_n_est_pas_consulte() {
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let magasin = Magasin::avec(&[("Halle/catalogue/prod", "s3cr3t")]);

        let (fichier, report) = preparer(
            vec![projet("Halle", &["prod"], vec![base])],
            false,
            &magasin,
            &Kubeconfigs::default(),
        )
        .expect("préparation");

        assert_eq!(
            magasin.lectures(),
            0,
            "un export ordinaire ne doit rien demander au Trousseau"
        );
        assert!(fichier.passwords.is_empty());
        assert_eq!(fichier.secrets, CarriedSecrets::NotCarried);
        assert_eq!(report.passwords_carried, 0);
        assert!(
            report.passwords_missing.is_empty(),
            "rien n'était demandé, donc rien ne manque"
        );
    }

    #[test]
    fn avec_la_case_cochee_les_mots_de_passe_voyagent() {
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let magasin = Magasin::avec(&[("Halle/catalogue/prod", "s3cr3t")]);

        let (fichier, report) = preparer(
            vec![projet("Halle", &["prod"], vec![base])],
            true,
            &magasin,
            &Kubeconfigs::default(),
        )
        .expect("préparation");

        assert_eq!(
            fichier
                .passwords
                .get("Halle/catalogue/prod")
                .map(String::as_str),
            Some("s3cr3t")
        );
        assert_eq!(fichier.secrets, CarriedSecrets::Embedded);
        assert_eq!(report.passwords_carried, 1);
    }

    #[test]
    fn un_mot_de_passe_absent_est_nomme_et_l_export_continue() {
        // Deux connexions, dont une seule a son secret : l'export doit rendre le fichier **et** dire
        // ce qui manque. Refuser tout pour une entrée effacée à la main rendrait le geste impossible.
        let mut avec = connexion("catalogue", "prod");
        avec.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let mut sans = connexion("stocks", "prod");
        sans.connection.password = Some(SecretRef::new("Halle/stocks/prod"));
        let magasin = Magasin::avec(&[("Halle/catalogue/prod", "s3cr3t")]);

        let (fichier, report) = preparer(
            vec![projet("Halle", &["prod"], vec![avec, sans])],
            true,
            &magasin,
            &Kubeconfigs::default(),
        )
        .expect("préparation");

        assert_eq!(report.passwords_carried, 1);
        assert_eq!(report.passwords_missing, vec!["stocks (prod)".to_owned()]);
        assert_eq!(fichier.passwords.len(), 1);
    }

    #[test]
    fn une_panne_du_magasin_arrete_l_export() {
        // **L'autre moitié du test précédent** : une absence est nommée, une panne arrête. Les
        // confondre ferait ressaisir un mot de passe déjà rangé, ou écrirait un fichier qui en tait
        // la moitié.
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let mut magasin = Magasin::neuf();
        magasin.panne_en_lecture = true;

        let erreur = preparer(
            vec![projet("Halle", &["prod"], vec![base])],
            true,
            &magasin,
            &Kubeconfigs::default(),
        )
        .expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::Secret { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn deux_exports_de_la_meme_configuration_donnent_le_meme_fichier() {
        // La propriété que le `BTreeMap` promet : aucun horodatage, aucun ordre de table de hachage,
        // donc deux fichiers comparables par un `diff`. Un `HashMap` la ferait tomber au hasard des
        // exécutions — d'où deux mots de passe, sans quoi un seul élément ne distingue rien.
        let mut une = connexion("catalogue", "prod");
        une.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let mut autre = connexion("stocks", "prod");
        autre.connection.password = Some(SecretRef::new("Halle/stocks/prod"));
        let magasin = Magasin::avec(&[
            ("Halle/catalogue/prod", "un"),
            ("Halle/stocks/prod", "deux"),
        ]);
        let source = vec![projet("Halle", &["prod"], vec![une, autre])];

        let (premier, _) =
            preparer(source.clone(), true, &magasin, &Kubeconfigs::default()).expect("premier");
        let (second, _) =
            preparer(source, true, &magasin, &Kubeconfigs::default()).expect("second");

        assert_eq!(
            serde_json::to_string_pretty(&premier).expect("json"),
            serde_json::to_string_pretty(&second).expect("json")
        );
    }

    #[test]
    fn le_debug_du_fichier_ne_montre_aucun_mot_de_passe() {
        let fichier = FichierDeProjets {
            passwords: BTreeMap::from([(
                "Halle/catalogue/prod".to_owned(),
                "motdepasse-tres-sensible".to_owned(),
            )]),
            ..fichier_de(Vec::new())
        };

        let rendu = format!("{fichier:?}");

        assert!(
            !rendu.contains("motdepasse-tres-sensible"),
            "rendu = {rendu}"
        );
        // Ni la référence : elle nomme un projet, une base et un environnement, ce qui n'a rien à
        // faire dans un journal écrit sur disque en développement.
        assert!(!rendu.contains("Halle/catalogue/prod"), "rendu = {rendu}");
        assert!(rendu.contains("FichierDeProjets"), "le type reste lisible");
    }

    // ----- l'écriture et la lecture -----

    fn temporaire(nom: &str) -> std::path::PathBuf {
        let repertoire =
            std::env::temp_dir().join(format!("dorabase-transfert-{}-{nom}", std::process::id()));
        std::fs::create_dir_all(&repertoire).expect("répertoire");
        repertoire.join("projets.json")
    }

    #[test]
    fn un_aller_retour_rend_les_memes_projets() {
        let chemin = temporaire("aller-retour");
        let source = vec![projet(
            "Halle",
            &["dev", "prod"],
            vec![connexion("catalogue", "dev")],
        )];
        let fichier = fichier_de(source.clone());

        ecrire(&chemin, &fichier).expect("écriture");
        let relu = lire(&chemin).expect("lecture");

        assert_eq!(relu.projects, source);
        assert_eq!(relu.version, VERSION_COURANTE);
        assert_eq!(relu.secrets, CarriedSecrets::NotCarried);
    }

    #[cfg(unix)]
    #[test]
    fn un_fichier_qui_porte_des_mots_de_passe_est_restreint_a_son_proprietaire() {
        use std::os::unix::fs::PermissionsExt;

        let avec = temporaire("droits-avec");
        let sans = temporaire("droits-sans").with_file_name("sans.json");
        let porteur = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([("Halle/catalogue/prod".to_owned(), "s3cr3t".to_owned())]),
            ..fichier_de(vec![projet("Halle", &["prod"], Vec::new())])
        };

        ecrire(&avec, &porteur).expect("écriture");
        ecrire(
            &sans,
            &fichier_de(vec![projet("Halle", &["prod"], Vec::new())]),
        )
        .expect("écriture");

        let droits = |chemin: &std::path::Path| {
            std::fs::metadata(chemin)
                .expect("métadonnées")
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(droits(&avec), 0o600, "un fichier de secrets se restreint");
        // **Le contrôle négatif** : sans lui, un `chmod` inconditionnel passerait aussi — et un
        // fichier fait pour être partagé serait restreint sans que personne l'ait demandé.
        assert_ne!(
            droits(&sans),
            0o600,
            "un fichier sans mot de passe garde les droits ordinaires"
        );
    }

    #[cfg(unix)]
    #[test]
    fn un_fichier_deja_la_est_restreint_avant_de_recevoir_les_mots_de_passe() {
        use std::os::unix::fs::PermissionsExt;

        // **Le cas que `mode()` seul ne couvre pas** : les droits posés à l'ouverture ne
        // s'appliquent qu'à la *création*, donc un export qui écrase un fichier déjà lisible par
        // tout le monde y aurait versé des mots de passe sans le restreindre. Et le contenu doit
        // bien être remplacé — restreindre sans écrire laisserait l'export précédent en place.
        let chemin = temporaire("droits-deja-la");
        std::fs::write(&chemin, "un export précédent").expect("écriture");
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o644)).expect("droits");

        let porteur = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([("Halle/catalogue/prod".to_owned(), "s3cr3t".to_owned())]),
            ..fichier_de(vec![projet("Halle", &["prod"], Vec::new())])
        };
        ecrire(&chemin, &porteur).expect("écriture");

        let mode = std::fs::metadata(&chemin)
            .expect("métadonnées")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let relu = std::fs::read_to_string(&chemin).expect("relecture");
        assert!(!relu.contains("un export précédent"), "relu = {relu}");
        assert!(relu.contains("Halle"));
    }

    #[test]
    fn un_fichier_d_une_autre_sorte_est_refuse() {
        let chemin = temporaire("autre-sorte");
        // La forme d'un `config.json` : c'est le fichier qu'on désignera par erreur.
        std::fs::write(
            &chemin,
            serde_json::json!({ "version": 5, "projects": [], "preferences": {} }).to_string(),
        )
        .expect("écriture");

        let erreur = lire(&chemin).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::SorteInattendue { ref trouve } if trouve.is_empty()),
            "{erreur:?}"
        );
        assert!(
            erreur
                .to_string()
                .contains("n'est pas un export de projets"),
            "le refus doit nommer ce qu'on attendait : {erreur}"
        );
    }

    #[test]
    fn un_fichier_trop_recent_est_refuse_sans_rien_lire() {
        let chemin = temporaire("trop-recent");
        std::fs::write(
            &chemin,
            serde_json::json!({
                "kind": SORTE,
                "version": VERSION_COURANTE + 1,
                // Une forme que cette version ne saurait pas lire : le refus doit venir de la
                // version, avant toute tentative de désérialisation.
                "projects": [{ "inconnu": true }],
            })
            .to_string(),
        )
        .expect("écriture");

        let erreur = lire(&chemin).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::TropRecent { found, supported }
                if found == VERSION_COURANTE + 1 && supported == VERSION_COURANTE),
            "{erreur:?}"
        );
    }

    #[test]
    fn un_fichier_d_une_version_anterieure_est_migre_a_la_lecture() {
        // **Un tunnel plat**, la forme d'avant la v3 : sans la chaîne de migrations, `Tunnel` ne se
        // désérialise pas du tout — il exige un champ `proxy`. C'est ce qui rend ce test sensible au
        // partage de la chaîne, là où un cran qui ne fait que *retirer* une clé passerait de toute
        // façon, `serde` ignorant ce qu'il ne connaît pas.
        let chemin = temporaire("v2");
        std::fs::write(
            &chemin,
            serde_json::json!({
                "kind": SORTE,
                "version": 2,
                "projects": [{
                    "name": "Halle",
                    "environments": [{
                        "id": "prod", "label": "prod", "color": "red", "production": true
                    }],
                    "databases": [{
                        "name": "catalogue",
                        "engine": "postgresql",
                        "environment": "prod",
                        "connection": {
                            "host": "db.interne", "port": 5432,
                            "defaultDatabase": "catalogue", "username": "dora_ro",
                            "password": null, "sslMode": "require",
                            "readOnly": true, "reconnectOnStartup": false,
                            "tunnel": {
                                "localPort": 15432,
                                "bastionHost": "bastion.interne",
                                "bastionPort": 22,
                                "username": "dora",
                                "privateKeyPath": "~/.ssh/id_ed25519"
                            }
                        }
                    }]
                }]
            })
            .to_string(),
        )
        .expect("écriture");

        let relu = lire(&chemin).expect("lecture");

        let tunnel = relu.projects[0].databases[0]
            .connection
            .tunnel
            .as_ref()
            .expect("le tunnel doit avoir survécu à la migration");
        assert_eq!(tunnel.local_port, Some(15432));
        assert!(matches!(&tunnel.proxy, Proxy::Ssh(ssh) if ssh.bastion_host == "bastion.interne"));
    }

    #[test]
    fn l_en_tete_des_secrets_est_recalcule_et_non_cru() {
        // Un fichier édité à la main qui annonce « aucun » en portant un mot de passe : la modale
        // doit dire la vérité, faute de quoi elle tairait exactement ce qu'il fallait dire.
        let chemin = temporaire("en-tete-menteur");
        std::fs::write(
            &chemin,
            serde_json::json!({
                "kind": SORTE,
                "version": VERSION_COURANTE,
                "secrets": "none",
                "projects": [],
                "passwords": { "Halle/catalogue/prod": "s3cr3t" },
            })
            .to_string(),
        )
        .expect("écriture");

        let relu = lire(&chemin).expect("lecture");

        assert_eq!(relu.secrets, CarriedSecrets::Embedded);
    }

    // ----- la fusion -----

    #[test]
    fn un_projet_absent_arrive_entier() {
        let mut base = connexion("catalogue", "dev");
        base.consoles = vec![Console {
            name: "exploration".into(),
            sql: "select 1".into(),
        }];
        let fichier = fichier_de(vec![projet("Quai", &["dev"], vec![base])]);

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert!(matches!(
            fusion.report.projects[0].verdict,
            ProjectVerdict::Created
        ));
        assert_eq!(fusion.projects.len(), 1);
        assert_eq!(fusion.projects[0].databases[0].consoles.len(), 1);
        assert_eq!(
            fusion.report.projects[0].consoles_added,
            vec!["catalogue (dev) › exploration".to_owned()]
        );
    }

    #[test]
    fn une_connexion_deja_declaree_garde_ses_reglages_et_recoit_les_consoles() {
        // **La décision centrale de la fusion.** Les réglages décrivent *comment joindre un
        // serveur* : les reprendre pourrait repointer une connexion en silence. Les consoles, elles,
        // sont tout l'intérêt du geste — recevoir les requêtes de quelqu'un sur une base qu'on a.
        let mut locale = connexion("catalogue", "dev");
        locale.connection.host = "db.local".into();
        locale.consoles = vec![Console {
            name: "à moi".into(),
            sql: "select local".into(),
        }];
        let locaux = vec![projet("Halle", &["dev"], vec![locale])];

        let mut entrante = connexion("catalogue", "dev");
        entrante.connection.host = "db.ailleurs".into();
        entrante.consoles = vec![Console {
            name: "de l'autre".into(),
            sql: "select ailleurs".into(),
        }];
        let fichier = fichier_de(vec![projet("Halle", &["dev"], vec![entrante])]);

        let fusion = fusionner(&locaux, &Kubeconfigs::default(), &fichier, None);

        let base = &fusion.projects[0].databases[0];
        assert_eq!(
            base.connection.host, "db.local",
            "les réglages locaux sont gardés"
        );
        let noms: Vec<&str> = base.consoles.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(noms, vec!["à moi", "de l'autre"]);

        let sort = &fusion.report.projects[0];
        assert!(matches!(sort.verdict, ProjectVerdict::Merged));
        assert_eq!(sort.connections_kept, vec!["catalogue (dev)".to_owned()]);
        assert!(sort.connections_added.is_empty());
        assert_eq!(
            sort.consoles_added,
            vec!["catalogue (dev) › de l'autre".to_owned()]
        );
    }

    /// **Les libellés de valeurs voyagent** (`API-75`), et vers un projet déjà déclaré aussi.
    ///
    /// C'est le cas qui casserait en silence si le versement manquait : le projet existe ici, donc
    /// il reçoit ses connexions et ses consoles — et laisserait ses libellés dans le fichier sans
    /// qu'un mot le dise.
    #[test]
    fn les_libelles_de_valeurs_arrivent_sur_un_projet_deja_declare() {
        let locaux = vec![projet(
            "Halle",
            &["dev"],
            vec![connexion("catalogue", "dev")],
        )];

        let mut entrant = projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]);
        entrant.value_labels = BTreeMap::from([(
            "orders".to_owned(),
            BTreeMap::from([(
                "status".to_owned(),
                BTreeMap::from([("3".to_owned(), "expédiée".to_owned())]),
            )]),
        )]);
        let fichier = fichier_de(vec![entrant]);

        let fusion = fusionner(&locaux, &Kubeconfigs::default(), &fichier, None);

        assert_eq!(
            fusion.projects[0].value_labels["orders"]["status"]["3"],
            "expédiée"
        );
        assert_eq!(
            fusion.report.projects[0].value_labels_added,
            vec!["orders.status".to_owned()]
        );
        assert!(fusion.report.projects[0].value_labels_kept.is_empty());
    }

    /// **Une colonne déjà étiquetée ici garde ses libellés**, et le rapport le dit.
    ///
    /// C'est la règle de toute la fusion : on complète, on n'écrase pas. Un libellé faux est pire
    /// qu'un libellé absent — c'est celui-là qu'on croit.
    #[test]
    fn une_colonne_deja_etiquetee_garde_ses_libelles() {
        let mut local = projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]);
        local.value_labels = BTreeMap::from([(
            "orders".to_owned(),
            BTreeMap::from([(
                "status".to_owned(),
                BTreeMap::from([("3".to_owned(), "à moi".to_owned())]),
            )]),
        )]);

        let mut entrant = projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]);
        entrant.value_labels = BTreeMap::from([(
            "orders".to_owned(),
            BTreeMap::from([
                (
                    "status".to_owned(),
                    BTreeMap::from([("3".to_owned(), "de l'autre".to_owned())]),
                ),
                (
                    "kind".to_owned(),
                    BTreeMap::from([("1".to_owned(), "web".to_owned())]),
                ),
            ]),
        )]);
        let fichier = fichier_de(vec![entrant]);

        let fusion = fusionner(&[local], &Kubeconfigs::default(), &fichier, None);

        let libelles = &fusion.projects[0].value_labels["orders"];
        assert_eq!(libelles["status"]["3"], "à moi", "le local est gardé");
        // **Colonne par colonne, et non table par table** : la voisine que seul le fichier déclare
        // arrive quand même. Remplacer la table entière l'aurait perdue ; la refuser en entier
        // aurait fait d'un libellé local un veto sur toute la table.
        assert_eq!(libelles["kind"]["1"], "web");

        let sort = &fusion.report.projects[0];
        assert_eq!(sort.value_labels_kept, vec!["orders.status".to_owned()]);
        assert_eq!(sort.value_labels_added, vec!["orders.kind".to_owned()]);
    }

    #[test]
    fn une_console_homonyme_est_refusee_et_le_texte_local_garde() {
        let mut locale = connexion("catalogue", "dev");
        locale.consoles = vec![Console {
            name: "exploration".into(),
            sql: "select local".into(),
        }];
        let locaux = vec![projet("Halle", &["dev"], vec![locale])];

        let mut entrante = connexion("catalogue", "dev");
        entrante.consoles = vec![Console {
            name: "exploration".into(),
            sql: "select ailleurs".into(),
        }];
        let fichier = fichier_de(vec![projet("Halle", &["dev"], vec![entrante])]);

        let fusion = fusionner(&locaux, &Kubeconfigs::default(), &fichier, None);

        let consoles = &fusion.projects[0].databases[0].consoles;
        assert_eq!(consoles.len(), 1);
        assert_eq!(consoles[0].sql, "select local", "un SQL est un travail");
        assert_eq!(
            fusion.report.projects[0].consoles_kept,
            vec!["catalogue (dev) › exploration".to_owned()]
        );
    }

    #[test]
    fn un_environnement_deja_declare_garde_son_drapeau_de_production() {
        // **L'import ne peut jamais affaiblir ce qui est déjà là.** `production` gouverne les
        // garde-fous d'écriture : reprendre la valeur du fichier lèverait en silence un garde-fou
        // que quelqu'un avait posé sur cette machine.
        let mut local = projet("Halle", &[], Vec::new());
        local.environments = vec![declaration("prod", true)];
        let locaux = vec![local];

        let mut entrant = projet("Halle", &[], Vec::new());
        entrant.environments = vec![declaration("prod", false), declaration("dev", false)];
        let fichier = fichier_de(vec![entrant]);

        let fusion = fusionner(&locaux, &Kubeconfigs::default(), &fichier, None);

        let prod = fusion.projects[0]
            .environnement(&EnvironmentId::brut("prod"))
            .expect("prod");
        assert!(prod.production, "le drapeau local l'emporte");
        let sort = &fusion.report.projects[0];
        assert_eq!(sort.environments_kept, vec!["prod".to_owned()]);
        assert_eq!(sort.environments_added, vec!["dev".to_owned()]);
    }

    #[test]
    fn une_connexion_dont_l_environnement_n_est_declare_nulle_part_est_refusee() {
        // Elle serait invisible dans l'arbre, qui liste les connexions sous le nœud de leur
        // environnement — et le projet ne passerait pas `valider`.
        let mut entrant = projet("Quai", &["dev"], vec![connexion("catalogue", "dev")]);
        entrant.databases.push(connexion("stocks", "fantome"));
        let fichier = fichier_de(vec![entrant]);

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        let sort = &fusion.report.projects[0];
        assert_eq!(
            sort.connections_rejected,
            vec!["stocks (fantome)".to_owned()]
        );
        assert_eq!(sort.connections_added, vec!["catalogue (dev)".to_owned()]);
        assert!(
            matches!(sort.verdict, ProjectVerdict::Created),
            "une connexion refusée ne coûte pas le projet : {:?}",
            sort.verdict
        );
        assert_eq!(fusion.projects[0].databases.len(), 1);
        fusion.projects[0]
            .valider()
            .expect("la fusion écrit du valide");
    }

    #[test]
    fn un_projet_ecarte_ne_touche_a_rien() {
        let fichier = fichier_de(vec![
            projet("Quai", &["dev"], vec![connexion("catalogue", "dev")]),
            projet("Rive", &["dev"], vec![connexion("stocks", "dev")]),
        ]);

        let fusion = fusionner(
            &[],
            &Kubeconfigs::default(),
            &fichier,
            Some(&["Rive".to_owned()]),
        );

        assert_eq!(fusion.projects.len(), 1);
        assert_eq!(fusion.projects[0].name, "Rive");
        assert!(matches!(
            fusion.report.projects[0].verdict,
            ProjectVerdict::Skipped
        ));
        assert!(
            fusion.report.projects[0].connections_added.is_empty(),
            "un projet écarté ne rapporte rien : ses listes doivent être vides"
        );
        assert!(matches!(
            fusion.report.projects[1].verdict,
            ProjectVerdict::Created
        ));
    }

    #[test]
    fn le_sort_d_un_projet_ne_depend_pas_de_la_selection() {
        // **La propriété qui autorise l'aperçu.** La modale calcule un rapport tout-retenu, puis
        // laisse décocher : si le sort d'un projet dépendait de la sélection, ce qu'elle montre
        // serait faux dès la première case décochée.
        let fichier = fichier_de(vec![
            projet("Halle", &["dev"], vec![connexion("catalogue", "dev")]),
            projet("Quai", &["dev"], vec![connexion("stocks", "dev")]),
        ]);
        let locaux = vec![projet("Halle", &["dev"], Vec::new())];

        let tout = fusionner(&locaux, &Kubeconfigs::default(), &fichier, None).report;
        let seul = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier,
            Some(&["Quai".to_owned()]),
        )
        .report;

        assert_eq!(tout.projects[1], seul.projects[1]);
    }

    #[test]
    fn les_chemins_locaux_d_une_connexion_ajoutee_sont_nommes() {
        // Les quatre champs qui décrivent *cette machine-ci*. Ils voyagent tels quels — ce sont des
        // réglages —, mais l'import le dit plutôt que de laisser le découvrir sur un « fichier
        // introuvable ».
        let mut fichier_sqlite = connexion("journal", "dev");
        fichier_sqlite.engine = Engine::Sqlite;
        fichier_sqlite.connection.default_database = "/Users/alice/journal.db".into();

        let mut certificat = connexion("catalogue", "dev");
        certificat.connection.ca_certificate = Some("~/certs/interne.pem".into());

        let mut bastion = connexion("stocks", "dev");
        bastion.connection.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.interne".into(),
                bastion_port: 22,
                username: "dora".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });

        // Le kubeconfig voyage **par référence** depuis `API-70` : le chemin nommé dans le rapport
        // est celui que la déclaration *du fichier* porte, non l'identifiant qui la désigne.
        let mut declarees = Kubeconfigs::default();
        let reference = declarees.declarer("~/.kube/prod");
        let mut cluster = connexion("commandes", "dev");
        cluster.connection.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Kubernetes(ProxyKubernetes {
                kubeconfig: Some(reference),
                namespace: None,
                resource: "svc/postgres".into(),
            }),
        });

        let entrant = projet(
            "Quai",
            &["dev"],
            vec![fichier_sqlite, certificat, bastion, cluster],
        );
        let fusion = fusionner(
            &[],
            &Kubeconfigs::default(),
            &fichier_de_avec(vec![entrant], declarees.declarations),
            None,
        );

        assert_eq!(
            fusion.report.projects[0].local_paths,
            vec![
                "journal (dev) : /Users/alice/journal.db".to_owned(),
                "catalogue (dev) : ~/certs/interne.pem".to_owned(),
                "stocks (dev) : ~/.ssh/id_ed25519".to_owned(),
                "commandes (dev) : ~/.kube/prod".to_owned(),
            ]
        );
    }

    #[test]
    fn un_chemin_local_n_est_nomme_que_pour_le_moteur_qui_en_a_un() {
        // **Le contrôle négatif du test précédent** : `default_database` n'est un chemin que pour un
        // moteur de fichier (`17a`). Le nommer partout ferait passer « catalogue » pour un chemin à
        // vérifier sur chaque connexion PostgreSQL du fichier.
        let fusion = fusionner(
            &[],
            &Kubeconfigs::default(),
            &fichier_de(vec![projet(
                "Quai",
                &["dev"],
                vec![connexion("catalogue", "dev")],
            )]),
            None,
        );

        assert!(
            fusion.report.projects[0].local_paths.is_empty(),
            "{:?}",
            fusion.report.projects[0].local_paths
        );
    }

    #[test]
    fn un_mot_de_passe_qui_ne_voyage_pas_est_nomme_et_sa_reference_reste() {
        // Les trois états du fichier, mesurés sur deux connexions : celle qui n'en veut pas, et
        // celle qui en veut un que le fichier ne porte pas.
        let mut avec = connexion("catalogue", "prod");
        // **Une référence qui ne ressemble pas à la locale**, et c'est nécessaire : avec
        // « Halle/catalogue/prod », « recalculée sur le triplet d'arrivée » et « reprise du
        // fichier » rendraient la même valeur, donc le décor ne les distinguerait pas (règle n° 5).
        avec.connection.password = Some(SecretRef::new("venue-d-ailleurs"));
        let sans = connexion("journal", "prod");
        let fichier = fichier_de(vec![projet("Halle", &["prod"], vec![avec, sans])]);

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        let sort = &fusion.report.projects[0];
        assert_eq!(sort.passwords_missing, vec!["catalogue (prod)".to_owned()]);
        assert!(sort.passwords_stored.is_empty());
        assert!(fusion.secrets_a_ranger.is_empty());
        // La référence **reste**, et c'est la *locale* : elle distingue « pas de mot de passe » de
        // « un mot de passe qui manque », et c'est aussi l'endroit où la valeur se rangera quand
        // quelqu'un la ressaisira dans `A2`. Se contenter d'un `is_some()` laisserait passer la
        // référence du fichier, qui peut désigner n'importe quoi — une valeur qui ne veut rien dire
        // écrite dans la configuration.
        assert_eq!(
            fusion.projects[0].databases[0].connection.password.as_ref(),
            Some(&reference_de("Halle", "catalogue", "prod"))
        );
        assert!(fusion.projects[0].databases[1]
            .connection
            .password
            .is_none());
    }

    #[test]
    fn un_mot_de_passe_qui_voyage_est_range_sous_la_reference_locale() {
        // La référence du fichier peut être n'importe quoi — il est éditable à la main —, et la
        // valeur s'y cherche ; la référence **écrite** est recalculée sur le triplet d'arrivée.
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("une-reference-quelconque"));
        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(
                "une-reference-quelconque".to_owned(),
                "s3cr3t".to_owned(),
            )]),
            ..fichier_de(vec![projet("Halle", &["prod"], vec![base])])
        };

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        let attendue = reference_de("Halle", "catalogue", "prod");
        assert_eq!(
            fusion.projects[0].databases[0].connection.password.as_ref(),
            Some(&attendue)
        );
        assert_eq!(fusion.secrets_a_ranger.len(), 1);
        assert_eq!(fusion.secrets_a_ranger[0].0, attendue);
        assert_eq!(fusion.secrets_a_ranger[0].1.expose(), "s3cr3t");
        assert_eq!(
            fusion.report.projects[0].passwords_stored,
            vec!["catalogue (prod)".to_owned()]
        );
    }

    #[test]
    fn un_projet_du_fichier_qui_ne_tiendrait_pas_les_invariants_est_refuse_seul() {
        // **Le filet de sécurité, sur le seul cas qui l'atteigne aujourd'hui** : un projet que le
        // fichier déclare **sans aucun environnement**. Les refus nommés couvrent le reste — un
        // identifiant en double est dédoublonné, une connexion sans environnement déclaré est
        // écartée une par une —, et c'est pourquoi ce test a d'abord été **faux** : écrit sur un
        // environnement en double, il attendait un refus que la fusion n'avait aucune raison de
        // prononcer. Le filet reste, pour l'invariant qui s'ajoutera au modèle après ce fichier.
        let mut fautif = projet("Halle", &[], Vec::new());
        fautif.environments = Vec::new();
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        fautif.databases = vec![base];

        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([("Halle/catalogue/prod".to_owned(), "s3cr3t".to_owned())]),
            ..fichier_de(vec![
                fautif,
                projet("Quai", &["dev"], vec![connexion("stocks", "dev")]),
            ])
        };

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert!(
            matches!(
                &fusion.report.projects[0].verdict,
                ProjectVerdict::Rejected { reason }
                    if reason.contains("au moins un environnement")
            ),
            "{:?}",
            fusion.report.projects[0].verdict
        );
        assert!(
            fusion.report.projects[0].connections_added.is_empty(),
            "un projet refusé ne doit rien annoncer d'ajouté"
        );
        assert!(
            fusion.secrets_a_ranger.is_empty(),
            "ni ranger le mot de passe d'une connexion qui n'arrive pas"
        );
        // **Les autres projets du fichier ne sont pas concernés.**
        assert_eq!(fusion.projects.len(), 1);
        assert_eq!(fusion.projects[0].name, "Quai");
    }

    #[test]
    fn le_refus_d_un_projet_ne_touche_pas_aux_secrets_d_un_autre() {
        // **Le décor est fait pour le défaut qu'il garde** : un projet nommé « Halle/Est » traité
        // *avant* un projet refusé nommé « Halle ». Un retrait par préfixe de référence — la
        // première version — emportait les secrets du premier, dont la référence commence bel et
        // bien par « Halle/ ». Sans ces deux noms-là, aucune assertion ne peut le voir (règle n° 5).
        let mut voisine = connexion("catalogue", "prod");
        voisine.connection.password = Some(SecretRef::new("Halle/Est/catalogue/prod"));
        let voisin = projet("Halle/Est", &["prod"], vec![voisine]);

        let mut fautif = projet("Halle", &[], Vec::new());
        fautif.environments = Vec::new();
        let mut refusee = connexion("stocks", "prod");
        refusee.connection.password = Some(SecretRef::new("Halle/stocks/prod"));
        fautif.databases = vec![refusee];

        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([
                ("Halle/Est/catalogue/prod".to_owned(), "voisin".to_owned()),
                ("Halle/stocks/prod".to_owned(), "refuse".to_owned()),
            ]),
            ..fichier_de(vec![voisin, fautif])
        };

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert!(matches!(
            fusion.report.projects[1].verdict,
            ProjectVerdict::Rejected { .. }
        ));
        // Le voisin garde son mot de passe en attente, et lui seul.
        assert_eq!(
            fusion
                .secrets_a_ranger
                .iter()
                .map(|(reference, _)| reference.as_str())
                .collect::<Vec<_>>(),
            vec![reference_de("Halle/Est", "catalogue", "prod").as_str()]
        );
    }

    #[test]
    fn un_projet_refuse_ne_rapporte_rien_du_tout() {
        // Le sort d'un projet refusé est **remis à neuf**, non amendé champ par champ : aucune de ses
        // douze listes ne veut plus rien dire, et « n connexions attendent leur mot de passe » sur un
        // projet dont aucune connexion n'arrive serait une réserve à propos de rien.
        let mut fautif = projet("Halle", &[], Vec::new());
        fautif.environments = Vec::new();
        let mut sqlite = connexion("journal", "prod");
        sqlite.engine = Engine::Sqlite;
        sqlite.connection.default_database = "/Users/alice/journal.db".into();
        sqlite.connection.password = Some(SecretRef::new("Halle/journal/prod"));
        sqlite.consoles = vec![Console {
            name: "exploration".into(),
            sql: "select 1".into(),
        }];
        fautif.databases = vec![sqlite];

        let fusion = fusionner(
            &[],
            &Kubeconfigs::default(),
            &fichier_de(vec![fautif]),
            None,
        );

        let sort = &fusion.report.projects[0];
        assert_eq!(
            *sort,
            ProjectOutcome {
                name: "Halle".to_owned(),
                verdict: ProjectVerdict::Rejected {
                    reason: "le projet « Halle » doit déclarer au moins un environnement"
                        .to_owned(),
                },
                environments_added: Vec::new(),
                environments_kept: Vec::new(),
                connections_added: Vec::new(),
                connections_kept: Vec::new(),
                connections_rejected: Vec::new(),
                kubeconfigs_missing: Vec::new(),
                value_labels_added: Vec::new(),
                value_labels_kept: Vec::new(),
                consoles_added: Vec::new(),
                consoles_kept: Vec::new(),
                passwords_stored: Vec::new(),
                passwords_missing: Vec::new(),
                local_paths: Vec::new(),
            }
        );
    }

    // ----- l'application -----

    #[test]
    fn un_import_range_les_mots_de_passe_puis_ecrit() {
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([("Halle/catalogue/prod".to_owned(), "s3cr3t".to_owned())]),
            ..fichier_de(vec![projet("Halle", &["prod"], vec![base])])
        };
        let magasin = Magasin::neuf();
        let mut ecrits: Vec<usize> = Vec::new();

        let (projects, _) = appliquer(
            fusionner(&[], &Kubeconfigs::default(), &fichier, None),
            &magasin,
            &mut |projets, _kubeconfigs| {
                ecrits.push(projets.len());
                Ok(())
            },
        )
        .expect("import");

        assert_eq!(projects.len(), 1);
        assert_eq!(ecrits, vec![1]);
        assert_eq!(
            magasin.lu("Halle/catalogue/prod").as_deref(),
            Some("s3cr3t")
        );
    }

    #[test]
    fn un_echec_d_ecriture_reprend_les_mots_de_passe_ranges() {
        // Sans la reprise, un import refusé laisserait dans le Trousseau une entrée qu'aucune
        // connexion ne déclare — donc invisible, et que rien ne nettoierait jamais.
        let mut base = connexion("catalogue", "prod");
        base.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([("Halle/catalogue/prod".to_owned(), "s3cr3t".to_owned())]),
            ..fichier_de(vec![projet("Halle", &["prod"], vec![base])])
        };
        let magasin = Magasin::neuf();

        let erreur = appliquer(
            fusionner(&[], &Kubeconfigs::default(), &fichier, None),
            &magasin,
            &mut |_, _| Err("disque plein".to_owned()),
        )
        .expect_err("refus");

        assert!(
            matches!(
                erreur,
                TransfertError::Ecriture {
                    secrets_repris: true,
                    ..
                }
            ),
            "{erreur:?}"
        );
        assert_eq!(magasin.lu("Halle/catalogue/prod"), None);
    }

    #[test]
    fn un_refus_du_magasin_reprend_ce_qui_etait_deja_range() {
        // Deux connexions et un magasin qui refuse : la première est rangée, la seconde échoue, et
        // la première doit repartir.
        let mut une = connexion("catalogue", "prod");
        une.connection.password = Some(SecretRef::new("Halle/catalogue/prod"));
        let mut autre = connexion("stocks", "prod");
        autre.connection.password = Some(SecretRef::new("Halle/stocks/prod"));
        let fichier = FichierDeProjets {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([
                ("Halle/catalogue/prod".to_owned(), "un".to_owned()),
                ("Halle/stocks/prod".to_owned(), "deux".to_owned()),
            ]),
            ..fichier_de(vec![projet("Halle", &["prod"], vec![une, autre])])
        };
        let mut magasin = Magasin::neuf();
        // La **seconde** écriture refuse : la première est donc rangée, et c'est elle qui doit
        // repartir.
        magasin.panne_a_l_ecriture = Some(2);
        let mut ecrit = false;

        let erreur = appliquer(
            fusionner(&[], &Kubeconfigs::default(), &fichier, None),
            &magasin,
            &mut |_, _| {
                ecrit = true;
                Ok(())
            },
        )
        .expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::Secret { .. }),
            "{erreur:?}"
        );
        assert!(!ecrit, "la configuration ne doit pas être écrite");
        assert_eq!(
            magasin.lu("Halle/catalogue/prod"),
            None,
            "le mot de passe rangé avant le refus doit repartir : rien ne le déclarerait, donc \
             rien ne le nettoierait jamais"
        );
    }
}

#[cfg(test)]
mod tests_kubeconfigs {
    use super::tests::{connexion, projet, Magasin};
    use super::*;

    /// Une connexion qui vise un cluster par la référence donnée.
    fn cluster(nom: &str, env: &str, reference: &KubeconfigId) -> Database {
        let mut base = connexion(nom, env);
        base.connection.tunnel = Some(crate::config::Tunnel {
            local_port: None,
            proxy: Proxy::Kubernetes(crate::config::ProxyKubernetes {
                kubeconfig: Some(reference.clone()),
                namespace: None,
                resource: "svc/postgres".into(),
            }),
        });
        base
    }

    /// L'identifiant que le **fichier** porte pour son kubeconfig.
    ///
    /// **Volontairement différent de celui que cette machine dériverait** du même chemin
    /// (`~/.kube/prod/config` donne `prod` ici). Sans cet écart, « la référence a été remappée sur la
    /// déclaration locale » et « la référence du fichier a été reprise telle quelle » rendent la
    /// **même valeur** — et le sabotage du remappage reste vert. C'est la règle n° 5, et c'est la
    /// même leçon que la référence de secret d'`API-30`, qu'un décor `Halle/catalogue/prod` des deux
    /// côtés ne distinguait pas.
    const ID_DU_FICHIER: &str = "venu-d-ailleurs";

    /// Un export dont les projets référencent `ID_DU_FICHIER`, et la configuration qui le porte.
    fn exporte() -> (FichierDeProjets, Kubeconfigs) {
        let mut declarees = Kubeconfigs {
            declarations: vec![KubeconfigDeclaration {
                id: KubeconfigId::brut(ID_DU_FICHIER),
                label: "prod de l'autre poste".into(),
                path: "~/.kube/prod/config".into(),
            }],
            default: None,
        };
        let prod = KubeconfigId::brut(ID_DU_FICHIER);
        declarees.declarer("~/.kube/jamais-employe.yaml");

        let entrant = projet(
            "Quai",
            &["dev"],
            vec![
                cluster("commandes", "dev", &prod),
                cluster("stocks", "dev", &prod),
            ],
        );
        let (fichier, _) =
            preparer(vec![entrant], false, &Magasin::neuf(), &declarees).expect("export");
        (fichier, declarees)
    }

    #[test]
    fn l_export_ne_porte_que_les_declarations_referencees() {
        // **Comme `passwords` ne porte que les références employées** : exporter un projet ne doit
        // pas divulguer la liste des clusters de son auteur.
        let (fichier, _) = exporte();

        assert_eq!(fichier.kubeconfigs.len(), 1);
        assert_eq!(fichier.kubeconfigs[0].path, "~/.kube/prod/config");
    }

    #[test]
    fn un_import_sur_une_machine_vierge_declare_le_fichier_et_remappe() {
        // **Sans cela, `API-70` casserait `API-30` en silence** : la connexion arriverait en
        // désignant une déclaration que cette machine n'a jamais eue, et n'ouvrirait plus.
        let (fichier, _) = exporte();
        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert_eq!(fusion.kubeconfigs.declarations.len(), 1);
        let arrivee = &fusion.projects[0].databases[0];
        let reference = match &arrivee.connection.tunnel.as_ref().unwrap().proxy {
            Proxy::Kubernetes(kube) => kube.kubeconfig.clone().expect("une référence"),
            autre => panic!("un transfert Kubernetes : {autre:?}"),
        };
        // **La référence est locale, pas celle du fichier** — l'assertion qui distingue le
        // remappage de la reprise, et sans laquelle le sabotage reste vert.
        assert_ne!(reference.as_str(), ID_DU_FICHIER);
        assert_eq!(
            fusion.kubeconfigs.resoudre(&reference),
            Some("~/.kube/prod/config")
        );
        // Et les deux connexions partagent encore la même déclaration après le voyage.
        assert_eq!(
            fusion.projects[0].databases[1]
                .connection
                .tunnel
                .as_ref()
                .map(|tunnel| {
                    match &tunnel.proxy {
                        Proxy::Kubernetes(kube) => kube.kubeconfig.clone(),
                        _ => None,
                    }
                }),
            Some(Some(reference))
        );
    }

    #[test]
    fn un_import_reprend_la_declaration_locale_qui_porte_deja_ce_chemin() {
        // **La dédup se fait par le chemin**, non par l'identifiant : celui du fichier est une
        // coordonnée de l'autre machine. Sans cela, importer deux fois poserait deux déclarations
        // sur le même fichier, et la liste des préférences se remplirait de doublons.
        let (fichier, _) = exporte();
        let mut locaux = Kubeconfigs {
            declarations: vec![KubeconfigDeclaration {
                id: KubeconfigId::brut("mon-cluster"),
                label: "mon cluster".into(),
                path: "~/.kube/prod/config".into(),
            }],
            default: None,
        };
        let deja = KubeconfigId::brut("mon-cluster");
        locaux.declarer("~/.kube/autre.yaml");

        let fusion = fusionner(&[], &locaux, &fichier, None);

        assert_eq!(fusion.kubeconfigs.declarations.len(), 2);
        let arrivee = match &fusion.projects[0].databases[0]
            .connection
            .tunnel
            .as_ref()
            .unwrap()
            .proxy
        {
            Proxy::Kubernetes(kube) => kube.kubeconfig.clone().expect("une référence"),
            autre => panic!("un transfert Kubernetes : {autre:?}"),
        };
        assert_eq!(arrivee, deja);
    }

    #[test]
    fn le_chemin_importe_est_nomme_dans_le_rapport() {
        // Il décrit **une autre machine** : l'import le dit plutôt que de laisser le découvrir sur
        // un « fichier introuvable » à la première ouverture.
        let (fichier, _) = exporte();
        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert!(
            fusion.report.projects[0]
                .local_paths
                .iter()
                .any(|ligne| ligne.contains("~/.kube/prod/config")),
            "{:?}",
            fusion.report.projects[0].local_paths
        );
    }

    #[test]
    fn une_reference_que_le_fichier_ne_declare_pas_est_gardee_et_nommee() {
        // Le cas du fichier **édité à la main**. La référence est gardée telle quelle : la vider
        // ferait ouvrir le kubeconfig par défaut de `kubectl`, donc un autre cluster, avec succès.
        let (mut fichier, _) = exporte();
        fichier.kubeconfigs.clear();

        let fusion = fusionner(&[], &Kubeconfigs::default(), &fichier, None);

        assert_eq!(fusion.report.projects[0].kubeconfigs_missing.len(), 2);
        assert!(fusion.kubeconfigs.declarations.is_empty());
        match &fusion.projects[0].databases[0]
            .connection
            .tunnel
            .as_ref()
            .unwrap()
            .proxy
        {
            Proxy::Kubernetes(kube) => assert!(kube.kubeconfig.is_some()),
            autre => panic!("un transfert Kubernetes : {autre:?}"),
        }
    }

    #[test]
    fn un_fichier_sans_connexion_kubernetes_ne_porte_aucune_declaration() {
        // **Le contrôle négatif** : sans lui, un export qui embarquerait *toutes* les déclarations
        // passerait les tests ci-dessus, en divulguant la liste des clusters de son auteur.
        let mut declarees = Kubeconfigs::default();
        declarees.declarer("~/.kube/prod/config");

        let (fichier, _) = preparer(
            vec![projet(
                "Quai",
                &["dev"],
                vec![connexion("catalogue", "dev")],
            )],
            false,
            &Magasin::neuf(),
            &declarees,
        )
        .expect("export");

        assert!(fichier.kubeconfigs.is_empty());
    }
}
