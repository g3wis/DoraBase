//! L'export et l'import de dossiers, en un fichier JSON (`API-30`, porté sur l'arbre par #169).
//!
//! # Ce qui voyage, et ce qui ne voyage pas
//!
//! Un fichier de transfert porte des **dossiers** — un dossier et son sous-arbre, ou tout l'arbre —,
//! leurs connexions et les consoles de chacune. Pas les préférences — un thème n'appartient pas à un
//! dossier, et `save_preferences` les relit déjà plutôt que de les recevoir, pour la même raison.
//! Pas les instances managées non plus : elles vivent à côté de l'arbre. Pas `Folder::queries`,
//! le champ en transit de `12f` : l'export le vide, la lecture d'une configuration le verse.
//!
//! # Le fichier ne traverse jamais l'IPC
//!
//! Ni dans un sens, ni dans l'autre. À l'export, la webview envoie un chemin et une case cochée ; à
//! l'import, elle envoie un chemin et reçoit un **rapport**. C'est la contrainte transverse du
//! projet — « le cœur détient les résultats ; la webview ne reçoit que ce qu'elle montre » — et elle
//! a ici une seconde raison, qui suffirait seule : le fichier peut porter des mots de passe en
//! clair. C'est pourquoi [`FichierDeDossiers`] ne dérive pas `TS`, là où `ExportReport` et
//! `ImportReport` le font (`requetes.rs`).
//!
//! # Pourquoi les types du modèle sont réemployés tels quels
//!
//! `folders` et `connections` sont **exactement** ce que le fichier de configuration porte sous les
//! mêmes clés : les mêmes `Folder` et `Database`, sérialisés par le même `serde`. Une seconde
//! description aurait divergé au premier champ ajouté à `ConnectionSettings`, sans qu'aucun test le
//! voie (règle n° 17). C'est aussi ce qui permet à l'import de réemployer la chaîne de migrations du
//! magasin plutôt que d'en tenir une seconde : voir `migration::arbre_du_document`.
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
//! `passwords` est indexé par `connexion/<id>`, la référence que la connexion porte.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::arbre::{
    identifiant_valable, nom_affiche, reference_de_connexion, ConnectionId, Folder, FolderId,
    FolderTree,
};
use super::model::{
    Console, Database, KubeconfigDeclaration, KubeconfigId, Kubeconfigs, Proxy, SecretRef,
};
use super::requetes::{
    CarriedSecrets, ExportReport, FolderOutcome, FolderVerdict, ImportReport, ImportSelection,
};
use super::store::VERSION_COURANTE;
use crate::secrets::Secret;

/// Le marqueur de sorte, en tête du fichier.
///
/// **Il existe pour refuser, pas pour décorer.** Sans lui, un `config.json` ou un JSON quelconque
/// tombé sous le sélecteur de fichiers se lirait comme un fichier de transfert vide — donc un import
/// qui ne fait rien, sans rien à dire. Avec lui, le refus nomme ce qu'on attendait.
///
/// **La valeur n'a pas changé avec les dossiers** (#169) : en changer obligerait à en accepter deux
/// pour relire les exports v6, et c'est la version, non la sorte, qui dit quelle forme le fichier a.
pub const SORTE: &str = "dorabase.projects";

/// Le séparateur des chemins que le rapport écrit — « Atelier Nord › prod › analytics ».
const SEPARATEUR: &str = " › ";

/// Le fichier de transfert, tel qu'il s'écrit et se relit — en **v7**.
///
/// **Ne dérive pas `TS`** : voir la note de tête. Ne dérive pas `Debug` non plus — il est écrit à la
/// main, plus bas, pour la raison qui a fait écrire ceux des adaptateurs : le risque n'est pas
/// d'écrire `{mot_de_passe:?}`, c'est d'écrire `{fichier:?}`.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FichierDeDossiers {
    /// [`SORTE`].
    pub kind: String,
    /// La version du format que l'arbre porte — **celle du fichier de configuration**, et le champ
    /// porte donc le même nom que là-bas.
    ///
    /// **Le nom compte, et il est structurel** : `version` à la racine, à côté de `folders`, fait de
    /// cette enveloppe un document que la chaîne de migrations lit **sans adaptateur**. Un export v6
    /// — `{ version: 6, projects, … }` — se relit ainsi par le cran de #164, et c'est ce qui laisse
    /// un fichier vieux de six mois s'importer encore.
    pub version: u32,
    pub secrets: CarriedSecrets,
    /// Les dossiers de premier niveau du fichier. Un export « du dossier » en porte un seul.
    #[serde(default)]
    pub folders: Vec<Folder>,
    /// Les connexions rangées à la racine — seul « Tout exporter » peut en porter.
    #[serde(default)]
    pub connections: Vec<Database>,
    /// Les mots de passe en clair, par référence `connexion/<id>`. Vide quand `secrets` vaut
    /// `NotCarried`.
    ///
    /// `BTreeMap` et non `HashMap` : l'ordre est celui des références, donc **deux exports de la
    /// même configuration donnent le même fichier octet pour octet**.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub passwords: BTreeMap<String, String>,
    /// Les kubeconfigs que les connexions exportées **référencent** (`API-70`) — seulement
    /// celles-là : exporter un dossier ne doit pas divulguer la liste des clusters de son auteur.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kubeconfigs: Vec<KubeconfigDeclaration>,
}

impl std::fmt::Debug for FichierDeDossiers {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FichierDeDossiers")
            .field("kind", &self.kind)
            .field("version", &self.version)
            .field("secrets", &self.secrets)
            .field("folders", &self.folders.len())
            .field("connections", &self.connections.len())
            // Le **compte**, jamais les valeurs, et jamais les références non plus.
            .field("passwords", &self.passwords.len())
            .finish()
    }
}

/// Ce qui peut faire refuser un export ou un import.
#[derive(Debug)]
pub enum TransfertError {
    /// L'export ne trouve pas le dossier désigné — désaccord entre l'écran et le disque.
    DossierInconnu {
        folder: FolderId,
    },
    /// Rien à écrire. Un fichier vide ressemblerait pourtant à un export réussi.
    RienAExporter,
    Io(std::io::Error),
    Serialisation(serde_json::Error),
    /// Le fichier n'est pas un export DoraBase : `kind` absent ou autre.
    SorteInattendue {
        trouve: String,
    },
    /// Écrit par une version postérieure du format de configuration. Rien n'est importé.
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
    /// **repris**, ou n'ont pas pu l'être — et cela se dit.
    Ecriture {
        raison: String,
        secrets_repris: bool,
    },
}

impl std::fmt::Display for TransfertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DossierInconnu { folder } => {
                write!(f, "le dossier « {folder} » n'existe pas")
            }
            Self::RienAExporter => write!(f, "il n'y a rien à exporter"),
            Self::Io(erreur) => write!(f, "erreur d'entrée-sortie : {erreur}"),
            Self::Serialisation(erreur) => write!(f, "erreur de sérialisation : {erreur}"),
            Self::SorteInattendue { trouve } if trouve.is_empty() => write!(
                f,
                "ce fichier n'est pas un export DoraBase : son en-tête ne porte pas de champ « kind »"
            ),
            Self::SorteInattendue { trouve } => write!(
                f,
                "ce fichier annonce « {trouve} » ; un export DoraBase annonce « {SORTE} »"
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

impl FolderOutcome {
    fn neuf(folder: Option<String>, verdict: FolderVerdict) -> Self {
        Self {
            folder,
            verdict,
            folders_added: Vec::new(),
            folders_kept: Vec::new(),
            folders_omitted: Vec::new(),
            read_only_from_file: Vec::new(),
            connections_added: Vec::new(),
            connections_kept: Vec::new(),
            connections_rejected: Vec::new(),
            consoles_added: Vec::new(),
            consoles_kept: Vec::new(),
            passwords_stored: Vec::new(),
            passwords_missing: Vec::new(),
            local_paths: Vec::new(),
            value_labels_added: Vec::new(),
            value_labels_kept: Vec::new(),
            kubeconfigs_missing: Vec::new(),
        }
    }
}

/// L'issue d'un versement : l'arbre d'après, ce qui s'est passé, et ce qu'il reste à ranger dans le
/// magasin de secrets.
///
/// **Ne dérive pas `Serialize`** : seul `report` traverse l'IPC.
#[derive(Debug)]
pub struct Fusion {
    pub arbre: FolderTree,
    /// Les kubeconfigs déclarés **après** versement (`API-70`) : ceux de cette machine, plus ceux
    /// que les connexions ajoutées ont fait déclarer. **Rendus plutôt qu'écrits ici** : `fusionner`
    /// sert l'aperçu autant que l'écriture, et un aperçu qui déclarerait serait un aperçu qui écrit.
    pub kubeconfigs: Kubeconfigs,
    pub report: ImportReport,
    /// Les mots de passe à ranger, sous leur référence **locale**. `Secret` et non `String` : la
    /// valeur ne s'imprime pas au `Debug` de cette structure, et ne peut pas se sérialiser.
    pub secrets_a_ranger: Vec<(SecretRef, Secret)>,
}

/// Joint un chemin et un dernier segment.
fn joindre(chemin: &[String], dernier: &str) -> String {
    let mut morceaux: Vec<&str> = chemin.iter().map(String::as_str).collect();
    morceaux.push(dernier);
    morceaux.join(SEPARATEUR)
}

/// Les chemins d'une connexion qui décrivent **cette machine-ci**.
///
/// Le `match` sur [`Proxy`] est exhaustif, sans bras attrape-tout : une quatrième sorte de proxy
/// fera échouer la compilation ici, là où son auteur doit décider si elle porte un chemin (règle
/// n° 16).
///
/// `declarations` est la liste **telle qu'elle est après versement** (`API-70`) : la référence de la
/// connexion a déjà été remise sur la déclaration locale quand on arrive ici.
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
            // Un nom d'instance Cloud SQL n'est pas un chemin (`06i`).
            Proxy::CloudSql(_) => {}
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

/// Vide le champ en transit de `12f`, à toute profondeur.
///
/// **Il ne voyage pas** : la lecture d'une configuration le verse dans la première connexion du
/// sous-arbre ; l'écrire ici le verserait une seconde fois, dans une connexion qui n'est peut-être
/// pas la même.
fn sans_requetes_en_transit(dossiers: &mut [Folder]) {
    for dossier in dossiers {
        dossier.queries = Vec::new();
        sans_requetes_en_transit(&mut dossier.folders);
    }
}

/// Prépare l'arbre d'un export : ce qu'on garde, nettoyé de ce qui ne voyage pas.
///
/// `seul` désigne un dossier, ou `None` pour tout l'arbre — les deux portées de la demande.
///
/// # Matérialiser l'hérité (#169)
///
/// Un dossier exporté seul devient un dossier **racine** du fichier, donc il perd ses ancêtres. Ce
/// qu'il leur devait doit voyager avec lui, sinon « prod » rangé sous un dossier en lecture seule
/// arriverait **inscriptible** sur l'autre machine — le pire sens possible pour cette erreur :
///
/// - sa `read_only` vaut sa lecture seule **effective** — la sienne, ou celle d'un ancêtre ;
/// - ses `value_labels` reçoivent, **table par table**, ce que ses ancêtres fournissaient et qu'il
///   ne déclarait pas, le plus proche l'emportant — la règle de `FolderTree::libelles_de`, figée
///   dans le fichier.
///
/// Rien n'est matérialisé pour « Tout exporter » : l'arbre entier n'a pas d'ancêtre à perdre.
pub fn composer(arbre: &FolderTree, seul: Option<&FolderId>) -> Result<FolderTree, TransfertError> {
    let mut retenu = match seul {
        None => arbre.clone(),
        Some(id) => {
            let dossier = arbre
                .dossier(id)
                .ok_or_else(|| TransfertError::DossierInconnu { folder: id.clone() })?;
            let ancetres = arbre
                .ancetres_du_dossier(id)
                .expect("un dossier trouvé a des ancêtres, fût-ce aucun");
            let mut exporte = dossier.clone();
            exporte.read_only =
                exporte.read_only || ancetres.iter().any(|ancetre| ancetre.read_only);
            // Du plus proche au plus extérieur : le premier qui déclare une table l'emporte.
            for ancetre in ancetres.iter().rev() {
                for (table, colonnes) in &ancetre.value_labels {
                    exporte
                        .value_labels
                        .entry(table.clone())
                        .or_insert_with(|| colonnes.clone());
                }
            }
            FolderTree {
                folders: vec![exporte],
                connections: Vec::new(),
            }
        }
    };

    if retenu.est_vide() {
        return Err(TransfertError::RienAExporter);
    }
    sans_requetes_en_transit(&mut retenu.folders);
    Ok(retenu)
}

/// Compte les dossiers d'un arbre, à toute profondeur.
fn compter_les_dossiers(dossiers: &[Folder]) -> usize {
    dossiers
        .iter()
        .map(|dossier| 1 + compter_les_dossiers(&dossier.folders))
        .sum()
}

/// Assemble le fichier, et lit les mots de passe si on les lui demande.
///
/// **Le magasin n'est consulté que si `avec_les_mots_de_passe`.** Un export ordinaire ne touche donc
/// pas au Trousseau, ce qui compte sur macOS où chaque lecture peut poser une question à
/// l'utilisateur selon les ACL de l'entrée.
pub fn preparer(
    arbre: FolderTree,
    avec_les_mots_de_passe: bool,
    magasin: &dyn crate::secrets::SecretStore,
    kubeconfigs: &Kubeconfigs,
) -> Result<(FichierDeDossiers, ExportReport), TransfertError> {
    let mut passwords = BTreeMap::new();
    let mut manquants = Vec::new();
    let mut connexions = 0usize;
    let mut consoles = 0usize;

    for (base, ancetres) in arbre.connexions() {
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
            // **nommée**, et l'export continue.
            Ok(None) => {
                let chemin: Vec<String> = ancetres.iter().map(|d| d.name.clone()).collect();
                manquants.push(joindre(&chemin, nom_affiche(base)));
            }
            // Une panne : elle arrête l'export. Un fichier qui tairait la moitié des mots de passe
            // demandés serait exactement l'artefact dangereux de ce geste.
            Err(erreur) => {
                return Err(TransfertError::Secret {
                    detail: erreur.to_string(),
                });
            }
        }
    }

    let declarations = declarations_referencees(&arbre, kubeconfigs);

    let report = ExportReport {
        folders: compter_les_dossiers(&arbre.folders),
        connections: connexions,
        consoles,
        passwords_carried: passwords.len(),
        passwords_missing: manquants,
    };

    let fichier = FichierDeDossiers {
        kind: SORTE.to_owned(),
        version: VERSION_COURANTE,
        secrets: if passwords.is_empty() {
            CarriedSecrets::NotCarried
        } else {
            CarriedSecrets::Embedded
        },
        folders: arbre.folders,
        connections: arbre.connections,
        passwords,
        kubeconfigs: declarations,
    };

    Ok((fichier, report))
}

/// La référence de kubeconfig d'une connexion, s'il y en a une.
fn reference_de_kubeconfig(base: &Database) -> Option<KubeconfigId> {
    let tunnel = base.connection.tunnel.as_ref()?;
    match &tunnel.proxy {
        Proxy::Kubernetes(kube) => kube.kubeconfig.clone(),
        Proxy::Ssh(_) | Proxy::CloudSql(_) => None,
    }
}

/// Les déclarations de kubeconfig que cet arbre référence (`API-70`).
///
/// **Déterministe et sans doublon** : l'ordre est celui de la liste déclarée, non celui des
/// connexions rencontrées.
fn declarations_referencees(
    arbre: &FolderTree,
    kubeconfigs: &Kubeconfigs,
) -> Vec<KubeconfigDeclaration> {
    let references: Vec<KubeconfigId> = arbre
        .connexions()
        .filter_map(|(base, _)| reference_de_kubeconfig(base))
        .collect();
    kubeconfigs
        .declarations
        .iter()
        .filter(|declaration| references.contains(&declaration.id))
        .cloned()
        .collect()
}

/// Écrit le fichier.
///
/// **Sérialisé en entier avant d'ouvrir quoi que ce soit**, et **`0600` quand le fichier porte des
/// mots de passe**, posé sur un fichier encore vide — voir [`restreindre_au_proprietaire`].
pub fn ecrire(chemin: &Path, fichier: &FichierDeDossiers) -> Result<(), TransfertError> {
    // `to_string_pretty` : ce fichier est fait pour être lu, envoyé par message, versionné.
    let mut contenu = serde_json::to_string_pretty(fichier)?;
    contenu.push('\n');

    if fichier.secrets == CarriedSecrets::Embedded {
        restreindre_au_proprietaire(chemin)?;
    }

    // **L'écriture appartient à `engine::export`** (`API-29`) : à l'échec **d'écriture**, le fichier
    // partiel est supprimé, et seulement à celui-là — supprimer sur un échec d'ouverture effacerait
    // un fichier auquel on n'a jamais touché.
    crate::engine::export::ecrire(chemin, &contenu)
        .map(|_| ())
        .map_err(|raison| TransfertError::Illisible { raison })
}

/// Restreint le fichier à son propriétaire **avant** qu'un octet sensible y entre.
///
/// `set_permissions` après l'écriture laisserait les mots de passe lisibles par tout compte de la
/// machine le temps d'un appel. Le fichier est donc créé restreint d'abord — **sans le tronquer** :
/// vider un fichier que l'écriture pourrait ensuite refuser d'ouvrir détruirait l'export précédent
/// pour un export qui n'a pas eu lieu. `truncate(false)` n'est exercé par aucun test, et cela se
/// dit plutôt que de se supposer gardé.
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

/// L'enveloppe telle qu'elle se lit : le reste reste du JSON, parce qu'il peut être d'une forme
/// antérieure qu'il faut migrer avant de la désérialiser.
///
/// **Tous les champs ont un défaut** : un JSON quelconque doit s'analyser sans erreur pour que le
/// refus porte sur `kind` et non sur un champ manquant.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Enveloppe {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    version: u32,
    #[serde(default)]
    passwords: BTreeMap<String, String>,
    /// **Lues telles quelles, sans migration** (`API-70`) : ce sont des déclarations, et leur forme
    /// n'a pas de version antérieure — un fichier d'avant la v6 n'en porte aucune, et ce sont celles
    /// que la chaîne de migration vient de créer qui comptent alors.
    #[serde(default)]
    kubeconfigs: Vec<KubeconfigDeclaration>,
}

/// L'arbre d'une enveloppe déjà en v7.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArbreV7 {
    #[serde(default)]
    folders: Vec<Folder>,
    #[serde(default)]
    connections: Vec<Database>,
}

/// Lit un fichier de transfert, en migrant son contenu si sa version est antérieure.
///
/// # Un export v6 se relit, mots de passe compris
///
/// Le cran v6 → v7 range chaque connexion sous un identifiant **dérivé** et fait passer son mot de
/// passe de `projet/base/environnement` à `connexion/<id>`. **`passwords` est réindexé par le même
/// plan** : sans cela, la connexion arriverait avec sa nouvelle référence et la valeur resterait
/// sous l'ancienne, donc aucun mot de passe du fichier ne serait retrouvé — en silence, puisque
/// l'import le dirait « manquant » comme s'il n'avait jamais voyagé.
///
/// Le déterminisme de la dérivation fait le reste : une connexion déclarée sur ce poste depuis le
/// même triplet v6 retombe sur **le même identifiant**, donc l'import la reconnaît.
pub fn lire(chemin: &Path) -> Result<FichierDeDossiers, TransfertError> {
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

    // **Recalculée, jamais reprise de l'en-tête** : un en-tête à « none » sur un fichier plein de
    // mots de passe tairait exactement ce qu'il fallait dire.
    let secrets = if enveloppe.passwords.is_empty() {
        CarriedSecrets::NotCarried
    } else {
        CarriedSecrets::Embedded
    };

    let (arbre, passwords, kubeconfigs) = if enveloppe.version < VERSION_COURANTE {
        let migre = super::migration::arbre_du_document(valeur, enveloppe.version)
            .map_err(|raison| TransfertError::Illisible { raison })?;
        let mut reindexes = BTreeMap::new();
        for (ancienne, nouvelle) in migre.secrets.couples() {
            if let Some(valeur) = enveloppe.passwords.get(ancienne.as_str()) {
                reindexes.insert(nouvelle.as_str().to_owned(), valeur.clone());
            }
        }
        // Un fichier d'avant la v6 n'a pas de déclarations : ce sont celles du cran v5 → v6.
        let kubeconfigs = if enveloppe.version < 6 {
            migre.kubeconfigs.declarations
        } else {
            enveloppe.kubeconfigs
        };
        (migre.arbre, reindexes, kubeconfigs)
    } else {
        let arbre: ArbreV7 =
            serde_json::from_value(valeur).map_err(|erreur| TransfertError::Illisible {
                raison: erreur.to_string(),
            })?;
        (
            FolderTree {
                folders: arbre.folders,
                connections: arbre.connections,
            },
            enveloppe.passwords,
            enveloppe.kubeconfigs,
        )
    };

    Ok(FichierDeDossiers {
        kind: enveloppe.kind,
        version: enveloppe.version,
        secrets,
        folders: arbre.folders,
        connections: arbre.connections,
        passwords,
        kubeconfigs,
    })
}

/// Ce que le versement d'une entrée du fichier consulte et accumule.
///
/// # Deux instantanés, et c'est nécessaire
///
/// - `origine` est l'arbre **avant tout versement** : les listes « déjà déclaré ici » se mesurent
///   sur lui. Les mesurer sur un arbre qui grandit ferait passer un doublon *du fichier* pour une
///   déclaration locale — un rapport qui accuse la machine de ce que le fichier porte ;
/// - `courant` est l'arbre **avant cette entrée** : l'existence d'une connexion et la liberté d'un
///   identifiant de dossier se mesurent sur lui, puisque les entrées précédentes y ont déjà versé.
struct Versement<'a> {
    fichier: &'a FichierDeDossiers,
    origine: &'a FolderTree,
    courant: &'a FolderTree,
    kubeconfigs: &'a mut Kubeconfigs,
    secrets: &'a mut Vec<(SecretRef, Secret)>,
    sort: &'a mut FolderOutcome,
    /// Les identifiants de dossier posés par cette entrée — `courant` ne les connaît pas encore.
    dossiers_poses: Vec<FolderId>,
    /// Les connexions ajoutées par cette entrée, pour le même motif.
    connexions_ajoutees: Vec<ConnectionId>,
    /// Les consoles à verser dans une connexion qui existe déjà, **où qu'elle soit** dans l'arbre :
    /// elle peut vivre loin du dossier qu'on descend, donc le versement attend la fin de la descente.
    consoles_differees: Vec<(ConnectionId, Vec<Console>, String)>,
}

impl Versement<'_> {
    /// Un identifiant pour un dossier créé : **celui du fichier s'il est libre**, un dérivé sinon.
    ///
    /// Dérivé et non tiré : `fusionner` sert l'aperçu autant que l'écriture, et deux appels doivent
    /// rendre le même arbre.
    fn identifiant_de_dossier(&self, entrant: &Folder) -> FolderId {
        let pris = |candidat: &str| {
            self.courant.dossier_pris(candidat)
                || self
                    .dossiers_poses
                    .iter()
                    .any(|pose| pose.as_str() == candidat)
        };
        if identifiant_valable(entrant.id.as_str()) && !pris(entrant.id.as_str()) {
            return entrant.id.clone();
        }
        FolderId::derive(&["import", entrant.id.as_str(), &entrant.name], pris)
    }

    /// Verse un dossier du fichier parmi `freres`.
    ///
    /// # La règle de fusion (#169)
    ///
    /// Les dossiers sont des **contenants appariés par nom**, comme les projets l'étaient : un
    /// dossier du fichier face à un frère homonyme **au même endroit** s'y fond, récursivement. Nom
    /// et couleur locaux sont gardés ; la lecture seule vaut **locale OU fichier**, jamais
    /// affaiblie : ni ce qui est déjà là — un garde-fou posé sur cette machine ne se lève pas par un
    /// import —, ni ce qui arrive — une connexion « prod » importée n'arrive pas inscriptible parce
    /// qu'un dossier local du même nom l'est.
    ///
    /// # Un dossier créé qui n'apporte rien n'est pas créé (#108)
    ///
    /// Les connexions s'apparient par identifiant, **où qu'elles soient** : réimporter un sous-dossier
    /// sur son poste d'origine trouve toutes ses connexions déjà déclarées, à leur place d'origine.
    /// Sans cette règle, l'import posait à la racine un dossier de ce nom **vide** — le seul effet
    /// visible d'un geste qui n'avait rien à apporter. Le dossier est donc retiré après la descente
    /// si son sous-arbre n'a rien reçu, et le rapport le **nomme** (`folders_omitted`).
    ///
    /// **Seulement s'il portait au moins une connexion.** Un dossier vide *dans le fichier* est une
    /// intention — une arborescence préparée sur une autre machine —, et il arrive vide comme il est
    /// parti. Rend vrai quand ce dossier-ci a été omis.
    fn verser_le_dossier(
        &mut self,
        entrant: &Folder,
        freres: &mut Vec<Folder>,
        chemin: &[String],
    ) -> bool {
        let nom = entrant.name.trim();
        let etiquette = joindre(chemin, nom);

        let place = if nom.is_empty() {
            None
        } else {
            freres.iter().position(|frere| frere.name.trim() == nom)
        };
        let cree = place.is_none();
        let index = match place {
            Some(index) => {
                let local = &mut freres[index];
                // « Gardé » veut dire « déjà déclaré *ici* » : un homonyme que cette entrée vient de
                // créer n'en est pas un.
                let deja_la = self.origine.dossier(&local.id).is_some();
                if deja_la {
                    self.sort.folders_kept.push(etiquette.clone());
                }
                if entrant.read_only && !local.read_only {
                    local.read_only = true;
                    if deja_la {
                        self.sort.read_only_from_file.push(etiquette.clone());
                    }
                }
                index
            }
            None => {
                let id = self.identifiant_de_dossier(entrant);
                self.dossiers_poses.push(id.clone());
                self.sort.folders_added.push(etiquette.clone());
                freres.push(Folder {
                    id,
                    name: entrant.name.clone(),
                    color: entrant.color,
                    icon: entrant.icon.clone(),
                    read_only: entrant.read_only,
                    folders: Vec::new(),
                    connections: Vec::new(),
                    value_labels: BTreeMap::new(),
                    // Un fichier écrit par DoraBase n'en porte pas ; un export v6 migré peut en
                    // porter pour un projet sans connexion. Ils attendent, comme à la lecture d'une
                    // configuration, la première connexion du sous-arbre.
                    queries: entrant.queries.clone(),
                });
                freres.len() - 1
            }
        };

        let local = &mut freres[index];
        self.verser_les_libelles(entrant, local, &etiquette);

        let chemin_ici: Vec<String> = chemin
            .iter()
            .cloned()
            .chain(std::iter::once(local.name.trim().to_owned()))
            .collect();
        for sous_dossier in &entrant.folders {
            self.verser_le_dossier(sous_dossier, &mut local.folders, &chemin_ici);
        }
        for base in &entrant.connections {
            self.verser_la_connexion(base, &mut local.connections, &chemin_ici);
        }

        if !cree {
            return false;
        }
        let local = &freres[index];
        let apporte = !local.connections.is_empty()
            || !local.folders.is_empty()
            || !local.value_labels.is_empty()
            || !local.queries.is_empty();
        if apporte || !porte_une_connexion(entrant) {
            return false;
        }
        // Le dossier a été poussé en dernier, et la descente n'écrit que dans ses propres enfants :
        // il est toujours au bout de `freres`.
        let omis = freres.remove(index);
        self.dossiers_poses.retain(|pose| pose != &omis.id);
        self.sort
            .folders_added
            .retain(|ajoute| ajoute != &etiquette);
        self.sort.folders_omitted.push(etiquette);
        true
    }

    /// Les libellés de valeurs (`API-75`), **colonne par colonne** : deux machines peuvent avoir
    /// étiqueté deux colonnes différentes de la même table, et remplacer la table entière en
    /// perdrait une. Une colonne déjà étiquetée ici garde ses libellés — un libellé faux est pire
    /// qu'un libellé absent, c'est celui-là qu'on croit.
    fn verser_les_libelles(&mut self, entrant: &Folder, local: &mut Folder, chemin: &str) {
        for (table, colonnes) in &entrant.value_labels {
            for (colonne, libelles) in colonnes {
                let etiquette = format!("{chemin}{SEPARATEUR}{table}.{colonne}");
                if local
                    .value_labels
                    .get(table)
                    .is_some_and(|locales| locales.contains_key(colonne))
                {
                    self.sort.value_labels_kept.push(etiquette);
                } else {
                    self.sort.value_labels_added.push(etiquette);
                    local
                        .value_labels
                        .entry(table.clone())
                        .or_default()
                        .insert(colonne.clone(), libelles.clone());
                }
            }
        }
    }

    /// Verse une connexion du fichier dans `destination`.
    ///
    /// Les connexions sont des **identités appariées par identifiant**, comme le triplet l'était :
    /// une connexion dont l'identifiant existe ici, **où que ce soit**, est « déjà déclarée ». Ses
    /// réglages et son emplacement locaux sont gardés — les reprendre pourrait repointer en silence
    /// une connexion vers un autre hôte —, ses consoles versées. Une connexion inconnue arrive
    /// **avec son identifiant**, ce qui rend le réimport idempotent.
    fn verser_la_connexion(
        &mut self,
        base: &Database,
        destination: &mut Vec<Database>,
        chemin: &[String],
    ) {
        let etiquette = joindre(chemin, nom_affiche(base));

        // **Refusée seule**, non l'entrée entière : un identifiant hors du jeu pourrait fabriquer
        // une clé `connexion/a/b`, et une connexion refusée ne coûte pas le dossier.
        if !identifiant_valable(base.id.as_str()) {
            self.sort.connections_rejected.push(etiquette);
            return;
        }

        if self.courant.connexion(&base.id).is_some() || self.connexions_ajoutees.contains(&base.id)
        {
            // Écrite par son chemin **local** : c'est là qu'on la trouvera.
            let locale = self
                .courant
                .chemin_de(&base.id)
                .map(|morceaux| morceaux.join(SEPARATEUR))
                .unwrap_or_else(|| etiquette.clone());
            if self.origine.connexion(&base.id).is_some() {
                self.sort.connections_kept.push(locale.clone());
            }
            self.consoles_differees
                .push((base.id.clone(), base.consoles.clone(), locale));
            return;
        }

        self.sort.connections_added.push(etiquette.clone());
        let mut arrivante = base.clone();

        // La référence est **recalculée** sur l'identifiant, jamais reprise du fichier : c'est une
        // coordonnée locale, et un fichier édité à la main pourrait en porter n'importe laquelle. La
        // valeur, elle, se cherche sous la référence **du fichier**, clé sous laquelle l'export
        // l'a rangée.
        if let Some(ancienne) = base.connection.password.clone() {
            let locale = reference_de_connexion(&base.id);
            match self.fichier.passwords.get(ancienne.as_str()) {
                Some(valeur) => {
                    self.sort.passwords_stored.push(etiquette.clone());
                    self.secrets
                        .push((locale.clone(), Secret::new(valeur.clone())));
                }
                None => self.sort.passwords_missing.push(etiquette.clone()),
            }
            arrivante.connection.password = Some(locale);
        }

        // La référence de kubeconfig est **remise sur la déclaration locale** (`API-70`), pour la
        // raison de la référence de secret : celle du fichier est une coordonnée de l'autre
        // machine. `declarer` dédoublonne par le **chemin**.
        if let Some(reference) = reference_de_kubeconfig(&arrivante) {
            match chemin_declare(&self.fichier.kubeconfigs, &reference) {
                Some(chemin_kube) => {
                    let locale = self.kubeconfigs.declarer(chemin_kube);
                    poser_la_reference_de_kubeconfig(&mut arrivante, locale);
                }
                // Gardée telle quelle : la vider ferait ouvrir le kubeconfig par défaut de
                // `kubectl`, donc un autre cluster, avec succès.
                None => self.sort.kubeconfigs_missing.push(etiquette.clone()),
            }
        }

        for chemin_local in chemins_locaux(&arrivante, &self.kubeconfigs.declarations) {
            self.sort
                .local_paths
                .push(format!("{etiquette} : {chemin_local}"));
        }
        for console in &arrivante.consoles {
            self.sort
                .consoles_added
                .push(format!("{etiquette}{SEPARATEUR}{}", console.name));
        }

        self.connexions_ajoutees.push(arrivante.id.clone());
        destination.push(arrivante);
    }
}

/// Vrai si ce dossier du fichier porte une connexion, à n'importe quelle profondeur.
fn porte_une_connexion(dossier: &Folder) -> bool {
    !dossier.connections.is_empty() || dossier.folders.iter().any(porte_une_connexion)
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
    sort: &mut FolderOutcome,
) {
    for console in entrantes {
        let etiquette = format!("{nom}{SEPARATEUR}{}", console.name);
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

/// Ce qu'une entrée du fichier verse : un dossier de premier niveau, ou les connexions de la racine.
enum Entree<'a> {
    Dossier(&'a Folder),
    Racine(&'a [Database]),
}

/// Verse les dossiers d'un fichier dans un arbre, et dit ce qui s'est passé.
///
/// # Une seule fonction pour l'aperçu et pour l'écriture
///
/// La modale d'import montre ce qui *va* se passer, puis écrit. Les deux réponses viennent d'**ici**,
/// et il n'y a pas de « planifier » distinct d'un « appliquer » : deux calculs pour le même acte en
/// laissent un en arrière (règle n° 17). La commande d'aperçu jette `arbre` et `secrets_a_ranger` ;
/// celle qui écrit les emploie, **recalculés** au moment d'écrire.
///
/// # `retenus`
///
/// `None` retient tout — la forme que l'aperçu emploie. Une entrée écartée reçoit `Skipped` et des
/// listes vides. **Le sort d'une entrée ne dépend pas de la sélection** tant que les dossiers de
/// premier niveau sont indépendants par leur nom, ce qu'ils sont : l'aperçu tout-retenu décrit ce
/// que n'importe quel sous-ensemble fera. La seule exception est une connexion que **deux** entrées
/// du fichier portent : la seconde la trouve alors déjà versée — un fichier écrit à la main.
///
/// # Chaque entrée est validée à part
///
/// L'arbre candidat est validé après chaque entrée, en filet (`FolderTree::valider`) : ce que les
/// refus nommés ne couvrent pas — un invariant ajouté au modèle après ce fichier — fait refuser
/// l'entrée, et elle seule. Une configuration invalide écrite sur disque coûterait la mise en
/// quarantaine de tout au prochain démarrage.
pub fn fusionner(
    locaux: &FolderTree,
    kubeconfigs_locaux: &Kubeconfigs,
    fichier: &FichierDeDossiers,
    retenus: Option<&ImportSelection>,
) -> Fusion {
    let mut arbre = locaux.clone();
    let mut kubeconfigs = kubeconfigs_locaux.clone();
    let mut sorts = Vec::with_capacity(fichier.folders.len() + 1);
    let mut secrets_a_ranger = Vec::new();

    let mut entrees: Vec<Entree<'_>> = fichier.folders.iter().map(Entree::Dossier).collect();
    if !fichier.connections.is_empty() {
        entrees.push(Entree::Racine(&fichier.connections));
    }

    for entree in entrees {
        let (nom, retenue) = match &entree {
            Entree::Dossier(dossier) => (
                Some(dossier.name.clone()),
                retenus.map_or(true, |selection| {
                    selection.folders.iter().any(|nom| nom == &dossier.name)
                }),
            ),
            Entree::Racine(_) => (
                None,
                retenus.map_or(true, |selection| selection.root_connections),
            ),
        };
        if !retenue {
            sorts.push(FolderOutcome::neuf(nom, FolderVerdict::Skipped));
            continue;
        }

        let verdict = match &entree {
            Entree::Dossier(dossier) => {
                let homonyme = arbre
                    .folders
                    .iter()
                    .any(|local| local.name.trim() == dossier.name.trim());
                if homonyme {
                    FolderVerdict::Merged
                } else {
                    FolderVerdict::Created
                }
            }
            // La racine existe toujours : ses connexions la **complètent**.
            Entree::Racine(_) => FolderVerdict::Merged,
        };
        let mut sort = FolderOutcome::neuf(nom.clone(), verdict);

        /*
         * Combien de secrets étaient en attente **avant** cette entrée : c'est ce qui permet de
         * défaire exactement ce qu'elle a mis en attente, si sa validation la refuse. **Un refus se
         * défait par un compte, pas par un filtre** : `secrets_a_ranger` ne fait que s'allonger, donc
         * une troncature rend l'état d'avant sans rien supposer de ce qu'il contient.
         */
        let secrets_avant = secrets_a_ranger.len();
        let courant = arbre.clone();
        let mut candidat = arbre.clone();
        let mut kubeconfigs_candidats = kubeconfigs.clone();

        let differees = {
            let mut versement = Versement {
                fichier,
                origine: locaux,
                courant: &courant,
                kubeconfigs: &mut kubeconfigs_candidats,
                secrets: &mut secrets_a_ranger,
                sort: &mut sort,
                dossiers_poses: Vec::new(),
                connexions_ajoutees: Vec::new(),
                consoles_differees: Vec::new(),
            };
            match entree {
                Entree::Dossier(dossier) => {
                    if versement.verser_le_dossier(dossier, &mut candidat.folders, &[]) {
                        versement.sort.verdict = FolderVerdict::Omitted;
                    }
                }
                Entree::Racine(connexions) => {
                    for base in connexions {
                        versement.verser_la_connexion(base, &mut candidat.connections, &[]);
                    }
                }
            }
            versement.consoles_differees
        };
        for (id, consoles, etiquette) in differees {
            if let Some(locale) = candidat.connexion_mut(&id) {
                verser_les_consoles(locale, &consoles, &etiquette, &mut sort);
            }
        }

        match candidat.valider() {
            Ok(()) => {
                arbre = candidat;
                kubeconfigs = kubeconfigs_candidats;
            }
            Err(erreur) => {
                // **Le sort est remis à neuf**, et non amendé champ par champ : une entrée refusée
                // n'apporte rien, donc aucune de ses listes ne veut plus rien dire.
                sort = FolderOutcome::neuf(
                    nom,
                    FolderVerdict::Rejected {
                        reason: erreur.to_string(),
                    },
                );
                secrets_a_ranger.truncate(secrets_avant);
            }
        }
        sorts.push(sort);
    }

    Fusion {
        arbre,
        kubeconfigs,
        report: ImportReport {
            version: fichier.version,
            secrets: fichier.secrets,
            folders: sorts,
        },
        secrets_a_ranger,
    }
}

/// Retire du magasin les secrets qu'un import venait de ranger. Vrai si tous ont pu l'être.
fn retirer_les_ecrits(magasin: &dyn crate::secrets::SecretStore, ecrits: &[SecretRef]) -> bool {
    // **Tous sont tentés**, même après un premier refus : un `all` s'arrêterait au premier, et
    // laisserait les suivants dans le magasin sans que personne le sache.
    let mut tous = true;
    for reference in ecrits {
        tous &= magasin.delete(reference).is_ok();
    }
    tous
}

/// Ce qu'[`appliquer`] appelle pour écrire : l'arbre versé **et** les kubeconfigs déclarés.
///
/// **Les deux ensemble, en une écriture** (`API-70`) : le versement fait grandir la liste des
/// déclarations, donc les écrire séparément laisserait une fenêtre où les connexions importées
/// désignent une déclaration qui n'est pas encore sur le disque.
type EcrireLaConfiguration<'a> = dyn FnMut(&FolderTree, &Kubeconfigs) -> Result<(), String> + 'a;

/// Applique un versement : range les mots de passe, puis écrit la configuration.
///
/// C'est l'ordre d'`enregistrer` : **le secret d'abord, la configuration ensuite**, et le secret
/// repris si l'écriture refuse.
///
/// **Aucun mot de passe existant n'est écrasé, et c'est une conséquence, pas une précaution** :
/// [`fusionner`] ne range un mot de passe que pour une connexion qu'elle **ajoute**, dont
/// l'identifiant n'était donc déclaré nulle part ici. Ce qui peut se trouver sous `connexion/<id>`
/// est un orphelin, qu'il faut écraser.
pub fn appliquer(
    fusion: Fusion,
    magasin: &dyn crate::secrets::SecretStore,
    ecrire: &mut EcrireLaConfiguration<'_>,
) -> Result<(FolderTree, ImportReport), TransfertError> {
    let Fusion {
        arbre,
        kubeconfigs,
        report,
        secrets_a_ranger,
    } = fusion;

    let mut ecrits: Vec<SecretRef> = Vec::with_capacity(secrets_a_ranger.len());
    for (reference, secret) in &secrets_a_ranger {
        if let Err(erreur) = magasin.store(reference, secret) {
            // **Ce qui est déjà rangé est repris avant de rendre l'erreur** : sans cela, un import
            // refusé à mi-parcours laisserait dans le Trousseau des entrées que rien ne nettoierait.
            retirer_les_ecrits(magasin, &ecrits);
            return Err(TransfertError::Secret {
                detail: erreur.to_string(),
            });
        }
        ecrits.push(reference.clone());
    }

    match ecrire(&arbre, &kubeconfigs) {
        Ok(()) => Ok((arbre, report)),
        Err(raison) => Err(TransfertError::Ecriture {
            raison,
            secrets_repris: retirer_les_ecrits(magasin, &ecrits),
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;
    use crate::config::arbre_de_test::{base, dossier};
    use crate::config::model::{Engine, ProxyKubernetes, ProxySsh, SavedQuery, Tunnel};
    use crate::secrets::{SecretError, SecretStore};

    /// Un magasin en mémoire qui **compte ses lectures**, et peut refuser la k-ième écriture.
    ///
    /// Le compte n'est pas décoratif : c'est la seule façon de garder « un export sans la case
    /// cochée ne consulte pas le magasin ». Le **rang** de l'écriture qui échoue rend la reprise
    /// mesurable : un magasin qui refuserait tout ne rangerait jamais rien à reprendre.
    pub(super) struct Magasin {
        table: Mutex<HashMap<String, String>>,
        lectures: Mutex<usize>,
        panne_en_lecture: bool,
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

        pub(super) fn avec(entrees: &[(&str, &str)]) -> Self {
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

        pub(super) fn lu(&self, reference: &str) -> Option<String> {
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

    /// Une connexion d'identifiant `id`, avec un mot de passe rangé sous sa référence.
    pub(super) fn avec_mot_de_passe(id: &str) -> Database {
        let mut connexion = base(id, false);
        connexion.connection.password = Some(reference_de_connexion(&connexion.id));
        connexion
    }

    fn cle(id: &str) -> String {
        format!("connexion/{id}")
    }

    /// `Halle` (libellés sur `orders`) › `prod` (lecture seule) › la connexion `c-prod`, plus `dev`
    /// › `c-dev`. C'est la forme qu'une migration v6 donne à un projet.
    pub(super) fn halle() -> FolderTree {
        let mut prod = dossier("prod", "prod", true);
        prod.connections.push(avec_mot_de_passe("c-prod"));
        let mut dev = dossier("dev", "dev", false);
        dev.connections.push(base("c-dev", false));
        let mut racine = dossier("halle", "Halle", false);
        racine.value_labels = BTreeMap::from([(
            "orders".to_owned(),
            BTreeMap::from([(
                "status".to_owned(),
                BTreeMap::from([("3".to_owned(), "expédiée".to_owned())]),
            )]),
        )]);
        racine.folders = vec![dev, prod];
        FolderTree {
            folders: vec![racine],
            connections: Vec::new(),
        }
    }

    pub(super) fn fichier_de(
        folders: Vec<Folder>,
        connections: Vec<Database>,
    ) -> FichierDeDossiers {
        FichierDeDossiers {
            kind: SORTE.to_owned(),
            version: VERSION_COURANTE,
            secrets: CarriedSecrets::NotCarried,
            folders,
            connections,
            passwords: BTreeMap::new(),
            kubeconfigs: Vec::new(),
        }
    }

    fn vide() -> FolderTree {
        FolderTree::default()
    }

    // ----- l'export -----

    #[test]
    fn un_export_ne_porte_pas_les_requetes_en_transit() {
        let mut arbre = halle();
        arbre.folders[0].folders[0].queries = vec![SavedQuery {
            name: "ancienne".into(),
            sql: "select 1".into(),
        }];

        let retenu = composer(&arbre, None).expect("export");

        assert!(
            retenu.folders[0].folders[0].queries.is_empty(),
            "le champ en transit de `12f` ne doit pas voyager, à aucune profondeur"
        );
    }

    #[test]
    fn un_export_de_dossier_ne_porte_que_lui_en_dossier_racine() {
        let mut arbre = halle();
        arbre.folders.push(dossier("quai", "Quai", false));
        arbre.connections.push(base("c-racine", false));

        let retenu = composer(&arbre, Some(&FolderId::brut("dev"))).expect("export");

        assert_eq!(retenu.folders.len(), 1);
        assert_eq!(retenu.folders[0].name, "dev");
        assert!(
            retenu.connections.is_empty(),
            "les connexions de la racine ne sont pas dans la portée d'un dossier"
        );
    }

    #[test]
    fn l_icone_d_un_dossier_voyage_avec_son_export() {
        // #171 : l'icône est un champ du dossier comme sa couleur, donc elle part avec le clonage de
        // `composer` et traverse le fichier — et **seulement la sienne** : contrairement à la
        // lecture seule et aux libellés, elle ne s'hérite pas, donc rien n'est matérialisé.
        let mut arbre = halle();
        arbre.folders[0].icon = Some("factory".into());
        arbre.folders[0].folders[0].icon = Some("bug".into());

        let retenu = composer(&arbre, Some(&FolderId::brut("dev"))).expect("export");
        let fichier = fichier_de(retenu.folders, retenu.connections);
        let texte = serde_json::to_string(&fichier).expect("écriture");
        let relu: FichierDeDossiers = serde_json::from_str(&texte).expect("relecture");

        assert_eq!(relu.folders[0].icon.as_deref(), Some("bug"));
        assert!(
            !texte.contains("factory"),
            "l'icône d'un ancêtre ne se matérialise pas dans l'export d'un sous-dossier"
        );
    }

    #[test]
    fn la_couleur_et_l_icone_d_une_connexion_voyagent_avec_son_export() {
        // #179 : deux champs de la connexion, donc clonés par `composer` comme ses réglages — et
        // **aucune clé** pour une connexion qui n'a rien réglé, sans quoi chaque export écrirait des
        // `null` qu'une version plus ancienne relirait sans rien en faire.
        let mut arbre = halle();
        let dev = &mut arbre.folders[0].folders[0].connections[0];
        dev.color = Some(crate::config::FolderColor::Violet);
        dev.icon = Some("rocket".into());

        let retenu = composer(&arbre, None).expect("export");
        let fichier = fichier_de(retenu.folders, retenu.connections);
        let texte = serde_json::to_string(&fichier).expect("écriture");
        let relu: FichierDeDossiers = serde_json::from_str(&texte).expect("relecture");

        let dev = &relu.folders[0].folders[0].connections[0];
        assert_eq!(dev.color, Some(crate::config::FolderColor::Violet));
        assert_eq!(dev.icon.as_deref(), Some("rocket"));

        let brut: serde_json::Value = serde_json::from_str(&texte).expect("relecture brute");
        let prod = &brut["folders"][0]["folders"][1]["connections"][0];
        assert_eq!(
            prod["id"], "c-prod",
            "le décor désigne bien la connexion sans apparence"
        );
        assert!(
            prod.get("color").is_none() && prod.get("icon").is_none(),
            "{prod}"
        );
    }

    #[test]
    fn tout_exporter_porte_les_connexions_a_la_racine() {
        let mut arbre = halle();
        arbre.connections.push(base("c-racine", false));

        let retenu = composer(&arbre, None).expect("export");

        assert_eq!(retenu, arbre);
    }

    #[test]
    fn un_export_d_un_dossier_inconnu_est_refuse() {
        let erreur = composer(&halle(), Some(&FolderId::brut("absent"))).expect_err("refus");
        assert!(
            matches!(erreur, TransfertError::DossierInconnu { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn un_export_d_un_arbre_vide_est_refuse() {
        // Un fichier sans rien ressemblerait à un export réussi, et se réimporterait sans rien dire.
        let erreur = composer(&vide(), None).expect_err("refus");
        assert!(
            matches!(erreur, TransfertError::RienAExporter),
            "{erreur:?}"
        );
    }

    #[test]
    fn un_sous_dossier_exporte_seul_emporte_ce_qu_il_heritait() {
        // **Le constat 0.8 du cadrage** : exporté seul, un sous-dossier perd ses ancêtres. Sa lecture
        // seule **effective** et les libellés que ses ancêtres lui fournissaient voyagent avec lui.
        let mut arbre = halle();
        // `prod` n'est pas en lecture seule lui-même : c'est `Halle` qui l'impose.
        arbre.folders[0].read_only = true;
        arbre.folders[0].folders[1].read_only = false;
        // Et `prod` déclare sa propre table `users`, que l'ancêtre déclare aussi : le plus proche
        // l'emporte **entièrement**, comme `libelles_de` le lit.
        let a_lui = BTreeMap::from([(
            "role".to_owned(),
            BTreeMap::from([("1".to_owned(), "admin".to_owned())]),
        )]);
        arbre.folders[0].folders[1]
            .value_labels
            .insert("users".to_owned(), a_lui.clone());
        arbre.folders[0].value_labels.insert(
            "users".to_owned(),
            BTreeMap::from([(
                "kind".to_owned(),
                BTreeMap::from([("2".to_owned(), "robot".to_owned())]),
            )]),
        );

        let retenu = composer(&arbre, Some(&FolderId::brut("prod"))).expect("export");

        let exporte = &retenu.folders[0];
        assert!(exporte.read_only, "la lecture seule héritée doit voyager");
        assert_eq!(
            exporte.value_labels.get("orders"),
            arbre.folders[0].value_labels.get("orders"),
            "les libellés de l'ancêtre doivent voyager"
        );
        assert_eq!(exporte.value_labels.get("users"), Some(&a_lui));
    }

    #[test]
    fn sans_la_case_cochee_le_magasin_n_est_pas_consulte() {
        let magasin = Magasin::avec(&[(&cle("c-prod"), "s3cr3t")]);

        let (fichier, report) =
            preparer(halle(), false, &magasin, &Kubeconfigs::default()).expect("préparation");

        assert_eq!(
            magasin.lectures(),
            0,
            "un export ordinaire ne doit rien demander au Trousseau"
        );
        assert!(fichier.passwords.is_empty());
        assert_eq!(fichier.secrets, CarriedSecrets::NotCarried);
        assert_eq!(report.passwords_carried, 0);
        assert!(report.passwords_missing.is_empty());
    }

    #[test]
    fn avec_la_case_cochee_les_mots_de_passe_voyagent_sous_connexion_id() {
        let magasin = Magasin::avec(&[(&cle("c-prod"), "s3cr3t")]);

        let (fichier, report) =
            preparer(halle(), true, &magasin, &Kubeconfigs::default()).expect("préparation");

        assert_eq!(
            fichier.passwords.get(&cle("c-prod")).map(String::as_str),
            Some("s3cr3t")
        );
        assert_eq!(fichier.secrets, CarriedSecrets::Embedded);
        assert_eq!(report.passwords_carried, 1);
        // Trois dossiers, à toute profondeur : `Halle`, `dev`, `prod`.
        assert_eq!(report.folders, 3);
        assert_eq!(report.connections, 2);
    }

    #[test]
    fn un_mot_de_passe_absent_est_nomme_par_son_chemin_et_l_export_continue() {
        let mut arbre = halle();
        arbre.folders[0].folders[0].connections[0] = avec_mot_de_passe("c-dev");
        let magasin = Magasin::avec(&[(&cle("c-prod"), "s3cr3t")]);

        let (fichier, report) =
            preparer(arbre, true, &magasin, &Kubeconfigs::default()).expect("préparation");

        assert_eq!(report.passwords_carried, 1);
        assert_eq!(
            report.passwords_missing,
            vec!["Halle › dev › base-c-dev".to_owned()]
        );
        assert_eq!(fichier.passwords.len(), 1);
    }

    #[test]
    fn une_panne_du_magasin_arrete_l_export() {
        let mut magasin = Magasin::neuf();
        magasin.panne_en_lecture = true;

        let erreur = preparer(halle(), true, &magasin, &Kubeconfigs::default()).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::Secret { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn deux_exports_de_la_meme_configuration_donnent_le_meme_fichier_octet_pour_octet() {
        // Aucun horodatage, aucun ordre de table de hachage : deux fichiers comparables par un
        // `diff`. **Deux** mots de passe, sans quoi un seul élément ne distingue aucun ordre.
        let mut arbre = halle();
        arbre.folders[0].folders[0].connections[0] = avec_mot_de_passe("c-dev");
        let magasin = Magasin::avec(&[(&cle("c-prod"), "un"), (&cle("c-dev"), "deux")]);
        let premier_chemin = temporaire("deterministe-1");
        let second_chemin = temporaire("deterministe-2");

        let (premier, _) =
            preparer(arbre.clone(), true, &magasin, &Kubeconfigs::default()).expect("premier");
        let (second, _) = preparer(arbre, true, &magasin, &Kubeconfigs::default()).expect("second");
        ecrire(&premier_chemin, &premier).expect("écriture");
        ecrire(&second_chemin, &second).expect("écriture");

        assert_eq!(premier.passwords.len(), 2);
        assert_eq!(
            std::fs::read(&premier_chemin).expect("lecture"),
            std::fs::read(&second_chemin).expect("lecture")
        );
    }

    #[test]
    fn le_debug_du_fichier_ne_montre_aucun_mot_de_passe() {
        let fichier = FichierDeDossiers {
            passwords: BTreeMap::from([(cle("c-prod"), "motdepasse-tres-sensible".to_owned())]),
            ..fichier_de(Vec::new(), Vec::new())
        };

        let rendu = format!("{fichier:?}");

        assert!(!rendu.contains("motdepasse-tres-sensible"), "{rendu}");
        assert!(!rendu.contains("c-prod"), "{rendu}");
        assert!(rendu.contains("FichierDeDossiers"));
    }

    // ----- l'écriture et la lecture -----

    fn temporaire(nom: &str) -> std::path::PathBuf {
        let repertoire =
            std::env::temp_dir().join(format!("dorabase-transfert-{}-{nom}", std::process::id()));
        std::fs::create_dir_all(&repertoire).expect("répertoire");
        repertoire.join("dossiers.json")
    }

    #[test]
    fn un_aller_retour_rend_le_meme_arbre() {
        let chemin = temporaire("aller-retour");
        let source = halle();
        let fichier = fichier_de(source.folders.clone(), vec![base("c-racine", false)]);

        ecrire(&chemin, &fichier).expect("écriture");
        let relu = lire(&chemin).expect("lecture");

        assert_eq!(relu.folders, source.folders);
        assert_eq!(relu.connections, vec![base("c-racine", false)]);
        assert_eq!(relu.version, VERSION_COURANTE);
        assert_eq!(relu.secrets, CarriedSecrets::NotCarried);
        // Les clés sont celles de `config.json` : c'est ce qui laisse la chaîne de migration lire
        // l'enveloppe sans adaptateur.
        let brut: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&chemin).expect("brut")).expect("json");
        assert!(brut.get("folders").is_some() && brut.get("connections").is_some());
        assert_eq!(brut["kind"], SORTE);
    }

    #[cfg(unix)]
    #[test]
    fn un_fichier_qui_porte_des_mots_de_passe_est_restreint_a_son_proprietaire() {
        use std::os::unix::fs::PermissionsExt;

        let avec = temporaire("droits-avec");
        let sans = temporaire("droits-sans").with_file_name("sans.json");
        let porteur = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(cle("c-prod"), "s3cr3t".to_owned())]),
            ..fichier_de(halle().folders, Vec::new())
        };

        ecrire(&avec, &porteur).expect("écriture");
        ecrire(&sans, &fichier_de(halle().folders, Vec::new())).expect("écriture");

        let droits = |chemin: &Path| {
            std::fs::metadata(chemin)
                .expect("métadonnées")
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(droits(&avec), 0o600, "un fichier de secrets se restreint");
        // **Le contrôle négatif** : sans lui, un `chmod` inconditionnel passerait aussi.
        assert_ne!(droits(&sans), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn un_fichier_deja_la_est_restreint_avant_de_recevoir_les_mots_de_passe() {
        use std::os::unix::fs::PermissionsExt;

        let chemin = temporaire("droits-deja-la");
        std::fs::write(&chemin, "un export précédent").expect("écriture");
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o644)).expect("droits");

        let porteur = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(cle("c-prod"), "s3cr3t".to_owned())]),
            ..fichier_de(halle().folders, Vec::new())
        };
        ecrire(&chemin, &porteur).expect("écriture");

        let mode = std::fs::metadata(&chemin)
            .expect("métadonnées")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let relu = std::fs::read_to_string(&chemin).expect("relecture");
        assert!(!relu.contains("un export précédent"), "{relu}");
        assert!(relu.contains("Halle"));
    }

    #[test]
    fn un_fichier_d_une_autre_sorte_est_refuse() {
        let chemin = temporaire("autre-sorte");
        // La forme d'un `config.json` : c'est le fichier qu'on désignera par erreur.
        std::fs::write(
            &chemin,
            serde_json::json!({ "version": 7, "folders": [], "connections": [] }).to_string(),
        )
        .expect("écriture");

        let erreur = lire(&chemin).expect_err("refus");

        assert!(
            matches!(erreur, TransfertError::SorteInattendue { ref trouve } if trouve.is_empty()),
            "{erreur:?}"
        );
        assert!(
            erreur.to_string().contains("n'est pas un export"),
            "{erreur}"
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
                "folders": [{ "inconnu": true }],
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
        // désérialise pas du tout — il exige un champ `proxy`.
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

        // Projet → dossier racine, environnement → sous-dossier, `production` → lecture seule.
        let prod = &relu.folders[0].folders[0];
        assert!(prod.read_only);
        let tunnel = prod.connections[0]
            .connection
            .tunnel
            .as_ref()
            .expect("le tunnel doit avoir survécu à la migration");
        assert_eq!(tunnel.local_port, Some(15432));
        assert!(matches!(&tunnel.proxy, Proxy::Ssh(ssh) if ssh.bastion_host == "bastion.interne"));
    }

    #[test]
    fn l_en_tete_des_secrets_est_recalcule_et_non_cru() {
        let chemin = temporaire("en-tete-menteur");
        std::fs::write(
            &chemin,
            serde_json::json!({
                "kind": SORTE,
                "version": VERSION_COURANTE,
                "secrets": "none",
                "folders": [],
                "passwords": { "connexion/c-prod": "s3cr3t" },
            })
            .to_string(),
        )
        .expect("écriture");

        assert_eq!(
            lire(&chemin).expect("lecture").secrets,
            CarriedSecrets::Embedded
        );
    }

    // ----- l'import d'un export v6 -----

    /// Un export v6 tel qu'`API-30` l'écrivait : un projet `Halle`, un environnement `prod`, une
    /// connexion `catalogue` dont le mot de passe voyage sous `Halle/catalogue/prod`.
    fn export_v6(chemin: &Path) {
        std::fs::write(
            chemin,
            serde_json::json!({
                "kind": SORTE,
                "version": 6,
                "secrets": "embedded",
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
                            "password": "Halle/catalogue/prod", "sslMode": "require",
                            "readOnly": false, "reconnectOnStartup": false, "tunnel": null
                        }
                    }]
                }],
                "passwords": { "Halle/catalogue/prod": "s3cr3t" },
                "kubeconfigs": [{ "id": "prod", "label": "prod", "path": "~/.kube/prod" }],
            })
            .to_string(),
        )
        .expect("écriture");
    }

    /// L'identifiant que le cran v6 → v7 dérive pour `Halle` › `prod` › `catalogue`.
    fn id_derive() -> ConnectionId {
        ConnectionId::derive(&["connexion", "Halle", "prod", "catalogue"], |_| false)
    }

    #[test]
    fn un_export_v6_se_relit_avec_ses_mots_de_passe_sous_la_reference_nouvelle() {
        let chemin = temporaire("export-v6");
        export_v6(&chemin);

        let relu = lire(&chemin).expect("lecture");

        let connexion = &relu.folders[0].folders[0].connections[0];
        assert_eq!(connexion.id, id_derive());
        let reference = reference_de_connexion(&id_derive());
        assert_eq!(connexion.connection.password.as_ref(), Some(&reference));
        // **Le piège du cadrage** : sans réindexation, la valeur resterait sous l'ancienne clé, et
        // aucune connexion ne la trouverait.
        assert_eq!(
            relu.passwords.get(reference.as_str()).map(String::as_str),
            Some("s3cr3t")
        );
        assert!(!relu.passwords.contains_key("Halle/catalogue/prod"));
        // Les déclarations d'un fichier v6 sont celles de son enveloppe, **en liste** — la clé
        // retirée avant la relecture v6 revient par là.
        assert_eq!(relu.kubeconfigs.len(), 1);
        assert_eq!(relu.kubeconfigs[0].path, "~/.kube/prod");

        // Importé sur une configuration vide, le mot de passe est **rangé**, non annoncé manquant.
        let fusion = fusionner(&vide(), &Kubeconfigs::default(), &relu, None);
        let sort = &fusion.report.folders[0];
        assert_eq!(
            sort.passwords_stored,
            vec!["Halle › prod › catalogue".to_owned()]
        );
        assert!(
            sort.passwords_missing.is_empty(),
            "{:?}",
            sort.passwords_missing
        );
        assert_eq!(fusion.secrets_a_ranger.len(), 1);
        assert_eq!(fusion.secrets_a_ranger[0].0, reference);
        assert_eq!(fusion.secrets_a_ranger[0].1.expose(), "s3cr3t");
    }

    #[test]
    fn un_export_v6_reconnait_la_connexion_que_la_migration_locale_a_deja_derivee() {
        // **Le déterminisme de la dérivation** : ce poste a migré le même triplet, donc tient la
        // connexion sous le même identifiant — l'import la dit « déjà déclarée », comme l'appariement
        // par triplet d'avant.
        let chemin = temporaire("export-v6-deja");
        export_v6(&chemin);
        let relu = lire(&chemin).expect("lecture");
        let mut ici = dossier("ailleurs", "Rangée ailleurs", false);
        let mut locale = base(id_derive().as_str(), false);
        locale.label = Some("ma copie".into());
        ici.connections.push(locale);
        let locaux = FolderTree {
            folders: vec![ici],
            connections: Vec::new(),
        };

        let fusion = fusionner(&locaux, &Kubeconfigs::default(), &relu, None);

        let sort = &fusion.report.folders[0];
        assert_eq!(
            sort.connections_kept,
            vec!["Rangée ailleurs › ma copie".to_owned()]
        );
        assert!(sort.connections_added.is_empty());
        assert!(
            fusion.secrets_a_ranger.is_empty(),
            "le mot de passe local n'est pas écrasé"
        );
    }

    // ----- la fusion -----

    /// **Un sous-dossier réimporté sur son poste d'origine ne crée rien** (#108). Ses connexions sont
    /// reconnues par identifiant et restent où elles sont ; sans la règle, un dossier « prod » vide
    /// arrivait à la racine, à côté de « Halle ». Les consoles, elles, sont bien versées : l'entrée
    /// n'est pas inutile, seul son contenant l'est.
    #[test]
    fn un_sous_dossier_reimporte_chez_lui_n_est_pas_cree_a_la_racine() {
        let locaux = halle();
        let mut prod = locaux.folders[0].folders[1].clone();
        prod.connections[0].consoles.push(Console {
            name: "venue du fichier".into(),
            sql: "select 1".into(),
        });

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![prod], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.verdict, FolderVerdict::Omitted);
        assert_eq!(sort.folders_omitted, vec!["prod".to_owned()]);
        assert!(sort.folders_added.is_empty(), "{:?}", sort.folders_added);
        assert_eq!(
            fusion.arbre.folders.len(),
            1,
            "aucun dossier racine de plus"
        );
        assert_eq!(
            fusion.arbre.folders[0].folders[1].connections[0]
                .consoles
                .len(),
            1,
            "la console est versée dans la connexion, à sa place locale"
        );
    }

    /// **Seul le contenant vide est omis, à la profondeur où il l'est.** Un dossier du fichier qui
    /// apporte une connexion est créé ; son sous-dossier dont la connexion est déjà ici ne l'est pas.
    /// Et un dossier vide **dans le fichier** arrive vide : c'est une intention, pas un résidu.
    #[test]
    fn seuls_les_dossiers_crees_sans_rien_apporter_sont_omis() {
        let locaux = halle();
        let mut nouveau = dossier("nouveau", "Nouveau", false);
        nouveau.folders.push(locaux.folders[0].folders[1].clone());
        nouveau.folders.push(dossier("prepare", "Préparé", false));
        nouveau.connections.push(base("c-neuve", false));

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![nouveau], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.verdict, FolderVerdict::Created);
        assert_eq!(sort.folders_omitted, vec!["Nouveau › prod".to_owned()]);
        assert_eq!(
            sort.folders_added,
            vec!["Nouveau".to_owned(), "Nouveau › Préparé".to_owned()]
        );
        let cree = &fusion.arbre.folders[1];
        assert_eq!(cree.name, "Nouveau");
        assert_eq!(
            cree.folders
                .iter()
                .map(|d| d.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Préparé"]
        );
    }

    #[test]
    fn un_dossier_absent_arrive_entier_avec_ses_identifiants() {
        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(halle().folders, Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.folder.as_deref(), Some("Halle"));
        assert_eq!(sort.verdict, FolderVerdict::Created);
        assert_eq!(
            sort.folders_added,
            vec![
                "Halle".to_owned(),
                "Halle › dev".to_owned(),
                "Halle › prod".to_owned()
            ]
        );
        assert_eq!(
            sort.connections_added,
            vec![
                "Halle › dev › base-c-dev".to_owned(),
                "Halle › prod › base-c-prod".to_owned()
            ]
        );
        // Les identifiants du fichier sont **gardés** quand ils sont libres : le réimport est alors
        // idempotent.
        assert_eq!(fusion.arbre, halle());
    }

    #[test]
    fn un_reimport_ne_change_rien() {
        let fichier = fichier_de(halle().folders, Vec::new());

        let fusion = fusionner(&halle(), &Kubeconfigs::default(), &fichier, None);

        assert_eq!(fusion.arbre, halle());
        let sort = &fusion.report.folders[0];
        assert_eq!(sort.verdict, FolderVerdict::Merged);
        assert!(sort.folders_added.is_empty() && sort.connections_added.is_empty());
        assert_eq!(sort.folders_kept.len(), 3);
        assert_eq!(sort.connections_kept.len(), 2);
    }

    #[test]
    fn un_dossier_homonyme_se_fond_recursivement_en_gardant_nom_couleur_et_icone_locaux() {
        let mut locaux = halle();
        // Le `prod` local est retiré : il arrivera du fichier. Le `dev` local a sa couleur.
        locaux.folders[0].folders.truncate(1);
        locaux.folders[0].folders[0].color = Some(crate::config::FolderColor::Green);
        locaux.folders[0].folders[0].icon = Some("rocket".into());
        locaux.folders[0].name = "  Halle ".into();
        let mut entrant = halle().folders.remove(0);
        entrant.id = FolderId::brut("autre-id");
        entrant.folders[0].color = Some(crate::config::FolderColor::Red);
        // #171 : l'icône suit la règle de la couleur — gardée chez un homonyme, apportée par un
        // dossier créé. Le `Halle` local n'en a pas, et doit **rester** sans : « locale gardée »
        // vaut aussi pour l'absence, sans quoi un import compléterait ce qu'on a laissé vide.
        entrant.icon = Some("factory".into());
        entrant.folders[0].icon = Some("bug".into());
        entrant.folders[1].icon = Some("un-nom-venu-d-ailleurs".into());

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.verdict, FolderVerdict::Merged);
        assert_eq!(
            sort.folders_kept,
            vec!["Halle".to_owned(), "Halle › dev".to_owned()]
        );
        assert_eq!(sort.folders_added, vec!["Halle › prod".to_owned()]);
        let racine = &fusion.arbre.folders[0];
        assert_eq!(
            racine.id,
            FolderId::brut("halle"),
            "l'identifiant local est gardé"
        );
        assert_eq!(racine.name, "  Halle ", "le nom local est gardé");
        assert_eq!(
            racine.folders[0].color,
            Some(crate::config::FolderColor::Green),
            "la couleur locale est gardée"
        );
        assert_eq!(racine.icon, None, "l'absence locale d'icône est gardée");
        assert_eq!(
            racine.folders[0].icon.as_deref(),
            Some("rocket"),
            "l'icône locale est gardée"
        );
        assert_eq!(racine.folders[1].name, "prod");
        assert_eq!(
            racine.folders[1].icon.as_deref(),
            Some("un-nom-venu-d-ailleurs"),
            "un dossier créé apporte son icône, même inconnue d'ici : elle retombera sur `pin` à \
             l'affichage, et se retrouvera si le fichier revient vers la version qui la connaît"
        );
        assert!(racine.folders[1].read_only);
    }

    #[test]
    fn un_homonyme_en_lecture_seule_fait_passer_le_local_en_lecture_seule() {
        // **Jamais affaiblie, dans ce sens-là** : une connexion « prod » importée n'arrive pas
        // inscriptible parce qu'un dossier local du même nom l'est.
        let mut locaux = halle();
        locaux.folders[0].folders[1].read_only = false;

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(halle().folders, Vec::new()),
            None,
        );

        assert!(fusion.arbre.folders[0].folders[1].read_only);
        assert_eq!(
            fusion.report.folders[0].read_only_from_file,
            vec!["Halle › prod".to_owned()],
            "le rapport doit nommer la lecture seule reprise du fichier"
        );
    }

    #[test]
    fn un_homonyme_inscriptible_ne_leve_pas_la_lecture_seule_locale() {
        // **Le contrôle négatif** : ni dans l'autre sens — un garde-fou posé sur cette machine ne se
        // lève pas par un import.
        let mut entrant = halle().folders.remove(0);
        entrant.folders[1].read_only = false;

        let fusion = fusionner(
            &halle(),
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        assert!(fusion.arbre.folders[0].folders[1].read_only);
        assert!(fusion.report.folders[0].read_only_from_file.is_empty());
    }

    #[test]
    fn une_connexion_deja_declaree_ailleurs_garde_ses_reglages_et_recoit_les_consoles() {
        // L'identifiant apparie, **où que ce soit** : la connexion locale vit à la racine, celle du
        // fichier sous `Halle › prod`. Emplacement, réglages et nom locaux sont gardés.
        let mut locale = base("c-prod", false);
        locale.connection.host = "hote-local".into();
        let locaux = FolderTree {
            folders: Vec::new(),
            connections: vec![locale],
        };
        let mut entrant = halle().folders.remove(0);
        entrant.folders[1].connections[0].connection.host = "hote-du-fichier".into();
        entrant.folders[1].connections[0].consoles = vec![Console {
            name: "revue".into(),
            sql: "select 1".into(),
        }];

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.connections_kept, vec!["base-c-prod".to_owned()]);
        assert_eq!(sort.consoles_added, vec!["base-c-prod › revue".to_owned()]);
        let (gardee, ancetres) = fusion
            .arbre
            .connexion(&ConnectionId::brut("c-prod"))
            .expect("toujours là");
        assert!(ancetres.is_empty(), "l'emplacement local est gardé");
        assert_eq!(gardee.connection.host, "hote-local");
        assert_eq!(gardee.consoles.len(), 1);
        assert!(
            fusion.secrets_a_ranger.is_empty(),
            "aucun mot de passe local n'est écrasé"
        );
    }

    #[test]
    fn une_connexion_deja_declaree_garde_son_apparence_et_une_neuve_apporte_la_sienne() {
        // #179, la règle de la couleur d'un dossier homonyme : ce qui est déclaré ici garde ce qu'il
        // a, **absence comprise** — un import ne complète pas ce qu'on a laissé vide —, et ce que
        // l'import crée arrive avec ce que le fichier porte, même une icône inconnue d'ici.
        let locaux = FolderTree {
            folders: Vec::new(),
            connections: vec![base("c-prod", false)],
        };
        let mut entrant = halle().folders.remove(0);
        let prod = &mut entrant.folders[1].connections[0];
        prod.color = Some(crate::config::FolderColor::Red);
        prod.icon = Some("flame".into());
        let dev = &mut entrant.folders[0].connections[0];
        dev.color = Some(crate::config::FolderColor::Green);
        dev.icon = Some("un-nom-venu-d-ailleurs".into());

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        let (gardee, _) = fusion
            .arbre
            .connexion(&ConnectionId::brut("c-prod"))
            .expect("toujours là");
        assert_eq!(gardee.color, None, "l'absence locale de couleur est gardée");
        assert_eq!(gardee.icon, None, "l'absence locale d'icône est gardée");
        let (neuve, _) = fusion
            .arbre
            .connexion(&ConnectionId::brut("c-dev"))
            .expect("versée par l'import");
        assert_eq!(neuve.color, Some(crate::config::FolderColor::Green));
        assert_eq!(neuve.icon.as_deref(), Some("un-nom-venu-d-ailleurs"));
    }

    #[test]
    fn une_connexion_que_le_fichier_porte_deux_fois_n_est_pas_dite_deja_declaree_ici() {
        // **« Déjà déclarée ici » se mesure avant tout versement** : la seconde entrée du fichier
        // trouve la connexion que la première vient de verser, et la dire « gardée » accuserait
        // cette machine de ce que le fichier porte. Ses consoles sont versées quand même.
        let mut premiere = dossier("quai", "Quai", false);
        premiere.connections.push(base("c-double", false));
        let mut seconde = dossier("gare", "Gare", false);
        let mut doublon = base("c-double", false);
        doublon.consoles = vec![Console {
            name: "revue".into(),
            sql: "select 1".into(),
        }];
        seconde.connections.push(doublon);

        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(vec![premiere, seconde], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[1];
        assert!(
            sort.connections_kept.is_empty(),
            "{:?}",
            sort.connections_kept
        );
        assert_eq!(
            sort.consoles_added,
            vec!["Quai › base-c-double › revue".to_owned()]
        );
        assert!(fusion.arbre.valider().is_ok());
    }

    #[test]
    fn une_console_homonyme_est_refusee_et_le_texte_local_garde() {
        let mut locaux = halle();
        locaux.folders[0].folders[0].connections[0].consoles = vec![Console {
            name: "revue".into(),
            sql: "le texte local".into(),
        }];
        let mut entrant = halle().folders.remove(0);
        entrant.folders[0].connections[0].consoles = vec![Console {
            name: "revue".into(),
            sql: "le texte du fichier".into(),
        }];

        let fusion = fusionner(
            &locaux,
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        assert_eq!(
            fusion.report.folders[0].consoles_kept,
            vec!["Halle › dev › base-c-dev › revue".to_owned()]
        );
        assert_eq!(
            fusion.arbre.folders[0].folders[0].connections[0].consoles[0].sql,
            "le texte local"
        );
    }

    #[test]
    fn les_libelles_se_versent_colonne_par_colonne() {
        let mut entrant = halle().folders.remove(0);
        let orders = entrant.value_labels.get_mut("orders").expect("orders");
        orders.insert(
            "kind".to_owned(),
            BTreeMap::from([("1".to_owned(), "retour".to_owned())]),
        );
        orders
            .get_mut("status")
            .expect("status")
            .insert("3".to_owned(), "celle du fichier".to_owned());

        let fusion = fusionner(
            &halle(),
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(
            sort.value_labels_added,
            vec!["Halle › orders.kind".to_owned()]
        );
        assert_eq!(
            sort.value_labels_kept,
            vec!["Halle › orders.status".to_owned()]
        );
        let orders = &fusion.arbre.folders[0].value_labels["orders"];
        assert_eq!(
            orders["status"]["3"], "expédiée",
            "le libellé local est gardé"
        );
        assert_eq!(orders["kind"]["1"], "retour");
    }

    #[test]
    fn un_dossier_cree_dont_l_identifiant_est_pris_en_recoit_un_autre() {
        // `prod` est l'identifiant d'un dossier local qui ne s'appelle pas « Quai » : le dossier
        // créé ne peut pas le reprendre, deux dossiers sous le même identifiant étant refusés.
        let mut entrant = dossier("prod", "Quai", false);
        entrant.connections.push(base("c-quai", false));

        let fusion = fusionner(
            &halle(),
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        assert_eq!(fusion.report.folders[0].verdict, FolderVerdict::Created);
        let quai = fusion
            .arbre
            .folders
            .iter()
            .find(|d| d.name == "Quai")
            .expect("créé");
        assert_ne!(quai.id, FolderId::brut("prod"));
        assert!(fusion.arbre.valider().is_ok());
    }

    #[test]
    fn une_connexion_a_l_identifiant_invalide_est_refusee_seule() {
        let mut entrant = dossier("quai", "Quai", false);
        entrant.connections.push(base("a/b", false));
        entrant.connections.push(base("c-quai", false));

        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        assert_eq!(sort.verdict, FolderVerdict::Created);
        assert_eq!(
            sort.connections_rejected,
            vec!["Quai › base-a/b".to_owned()]
        );
        assert_eq!(
            sort.connections_added,
            vec!["Quai › base-c-quai".to_owned()]
        );
    }

    #[test]
    fn les_connexions_de_la_racine_ont_leur_ligne_et_se_retiennent_a_part() {
        let fichier = fichier_de(halle().folders, vec![base("c-racine", false)]);

        let tout = fusionner(&vide(), &Kubeconfigs::default(), &fichier, None);
        assert_eq!(tout.report.folders.len(), 2);
        assert_eq!(tout.report.folders[1].folder, None);
        assert_eq!(
            tout.report.folders[1].connections_added,
            vec!["base-c-racine".to_owned()]
        );
        assert_eq!(tout.arbre.connections.len(), 1);

        let sans = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier,
            Some(&ImportSelection {
                folders: vec!["Halle".into()],
                root_connections: false,
            }),
        );
        assert_eq!(sans.report.folders[1].verdict, FolderVerdict::Skipped);
        assert!(sans.arbre.connections.is_empty());
        assert_eq!(sans.arbre.folders.len(), 1);
    }

    #[test]
    fn un_dossier_ecarte_ne_touche_a_rien_et_le_sort_ne_depend_pas_de_la_selection() {
        let mut quai = dossier("quai", "Quai", false);
        quai.connections.push(base("c-quai", false));
        let fichier = fichier_de(vec![halle().folders.remove(0), quai], Vec::new());

        let apercu = fusionner(&vide(), &Kubeconfigs::default(), &fichier, None);
        let choisi = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier,
            Some(&ImportSelection {
                folders: vec!["Quai".into()],
                root_connections: true,
            }),
        );

        assert_eq!(choisi.report.folders[0].verdict, FolderVerdict::Skipped);
        assert!(choisi.report.folders[0].connections_added.is_empty());
        assert_eq!(choisi.arbre.folders.len(), 1);
        assert_eq!(choisi.report.folders[1], apercu.report.folders[1]);
    }

    #[test]
    fn les_chemins_locaux_d_une_connexion_ajoutee_sont_nommes() {
        let mut fichier_sqlite = base("c-journal", false);
        fichier_sqlite.engine = Engine::Sqlite;
        fichier_sqlite.connection.default_database = "/Users/alice/journal.db".into();
        let mut certificat = base("c-catalogue", false);
        certificat.connection.ca_certificate = Some("~/certs/interne.pem".into());
        let mut bastion = base("c-stocks", false);
        bastion.connection.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.interne".into(),
                bastion_port: 22,
                username: "dora".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        let mut declarees = Kubeconfigs::default();
        let reference = declarees.declarer("~/.kube/prod");
        let mut cluster = base("c-commandes", false);
        cluster.connection.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Kubernetes(ProxyKubernetes {
                kubeconfig: Some(reference),
                namespace: None,
                resource: "svc/postgres".into(),
            }),
        });
        let mut entrant = dossier("quai", "Quai", false);
        entrant.connections = vec![fichier_sqlite, certificat, bastion, cluster];
        let fichier = FichierDeDossiers {
            kubeconfigs: declarees.declarations,
            ..fichier_de(vec![entrant], Vec::new())
        };

        let fusion = fusionner(&vide(), &Kubeconfigs::default(), &fichier, None);

        assert_eq!(
            fusion.report.folders[0].local_paths,
            vec![
                "Quai › base-c-journal : /Users/alice/journal.db".to_owned(),
                "Quai › base-c-catalogue : ~/certs/interne.pem".to_owned(),
                "Quai › base-c-stocks : ~/.ssh/id_ed25519".to_owned(),
                "Quai › base-c-commandes : ~/.kube/prod".to_owned(),
            ]
        );
    }

    #[test]
    fn un_chemin_local_n_est_nomme_que_pour_le_moteur_qui_en_a_un() {
        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(halle().folders, Vec::new()),
            None,
        );
        assert!(fusion.report.folders[0].local_paths.is_empty());
    }

    #[test]
    fn un_mot_de_passe_qui_ne_voyage_pas_est_nomme_et_la_reference_locale_reste() {
        // **Une référence de fichier qui ne ressemble pas à la locale** : sans cet écart,
        // « recalculée » et « reprise du fichier » rendraient la même valeur (règle n° 5).
        let mut entrante = base("c-quai", false);
        entrante.connection.password = Some(SecretRef::new("venue-d-ailleurs"));
        let mut entrant = dossier("quai", "Quai", false);
        entrant.connections.push(entrante);

        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(vec![entrant], Vec::new()),
            None,
        );

        assert_eq!(
            fusion.report.folders[0].passwords_missing,
            vec!["Quai › base-c-quai".to_owned()]
        );
        assert!(fusion.secrets_a_ranger.is_empty());
        assert_eq!(
            fusion.arbre.folders[0].connections[0]
                .connection
                .password
                .as_ref(),
            Some(&reference_de_connexion(&ConnectionId::brut("c-quai")))
        );
    }

    #[test]
    fn un_mot_de_passe_qui_voyage_est_range_sous_la_reference_locale() {
        let mut entrante = base("c-quai", false);
        entrante.connection.password = Some(SecretRef::new("une-reference-quelconque"));
        let mut entrant = dossier("quai", "Quai", false);
        entrant.connections.push(entrante);
        let fichier = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(
                "une-reference-quelconque".to_owned(),
                "s3cr3t".to_owned(),
            )]),
            ..fichier_de(vec![entrant], Vec::new())
        };

        let fusion = fusionner(&vide(), &Kubeconfigs::default(), &fichier, None);

        let attendue = reference_de_connexion(&ConnectionId::brut("c-quai"));
        assert_eq!(fusion.secrets_a_ranger.len(), 1);
        assert_eq!(fusion.secrets_a_ranger[0].0, attendue);
        assert_eq!(fusion.secrets_a_ranger[0].1.expose(), "s3cr3t");
        assert!(fusion.arbre.valider().is_ok());
    }

    /// Un dossier que la validation refuse : sans nom. C'est le filet de `valider`.
    fn fautif() -> Folder {
        let mut fautif = dossier("fautif", "   ", false);
        fautif.connections.push(avec_mot_de_passe("c-refusee"));
        fautif
    }

    #[test]
    fn une_entree_qui_ne_tiendrait_pas_les_invariants_est_refusee_seule() {
        // **Le décor garde « un refus se défait par un compte, pas par un filtre »** : l'entrée
        // valide passe **avant** la refusée, donc ses secrets sont en attente quand le refus
        // arrive, et c'est une troncature qui doit les laisser.
        let mut voisin = dossier("quai", "Quai", false);
        voisin.connections.push(avec_mot_de_passe("c-voisine"));
        let fichier = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([
                (cle("c-voisine"), "voisin".to_owned()),
                (cle("c-refusee"), "refuse".to_owned()),
            ]),
            ..fichier_de(vec![voisin, fautif()], Vec::new())
        };

        let fusion = fusionner(&vide(), &Kubeconfigs::default(), &fichier, None);

        assert!(
            matches!(
                &fusion.report.folders[1].verdict,
                FolderVerdict::Rejected { reason } if reason.contains("n'a pas de nom")
            ),
            "{:?}",
            fusion.report.folders[1].verdict
        );
        assert_eq!(fusion.arbre.folders.len(), 1);
        assert_eq!(fusion.arbre.folders[0].name, "Quai");
        assert_eq!(
            fusion
                .secrets_a_ranger
                .iter()
                .map(|(reference, _)| reference.as_str().to_owned())
                .collect::<Vec<_>>(),
            vec![cle("c-voisine")]
        );
    }

    #[test]
    fn une_entree_refusee_ne_rapporte_rien_du_tout() {
        let fusion = fusionner(
            &vide(),
            &Kubeconfigs::default(),
            &fichier_de(vec![fautif()], Vec::new()),
            None,
        );

        let sort = &fusion.report.folders[0];
        let raison = match &sort.verdict {
            FolderVerdict::Rejected { reason } => reason.clone(),
            autre => panic!("un refus était attendu : {autre:?}"),
        };
        assert_eq!(
            *sort,
            FolderOutcome::neuf(
                Some("   ".into()),
                FolderVerdict::Rejected { reason: raison }
            )
        );
    }

    // ----- l'aller-retour de bout en bout (#169) -----

    #[test]
    fn un_sous_dossier_en_lecture_seule_heritee_arrive_en_lecture_seule_avec_ses_libelles() {
        // **Le test du cadrage** : exporter `prod`, dont la lecture seule vient de `Halle`, puis le
        // réimporter dans une configuration vide. Le dossier arrive en lecture seule, avec les
        // libellés de sa racine. Sans matérialisation, il arriverait **inscriptible**.
        let mut arbre = halle();
        arbre.folders[0].read_only = true;
        arbre.folders[0].folders[1].read_only = false;
        let chemin = temporaire("aller-retour-prod");
        let magasin = Magasin::avec(&[(&cle("c-prod"), "s3cr3t")]);

        let retenu = composer(&arbre, Some(&FolderId::brut("prod"))).expect("composition");
        let (fichier, _) =
            preparer(retenu, true, &magasin, &Kubeconfigs::default()).expect("préparation");
        ecrire(&chemin, &fichier).expect("écriture");
        let relu = lire(&chemin).expect("lecture");
        let fusion = fusionner(&vide(), &Kubeconfigs::default(), &relu, None);

        let arrive = &fusion.arbre.folders[0];
        assert_eq!(arrive.name, "prod");
        assert!(arrive.read_only, "la lecture seule héritée doit arriver");
        assert_eq!(
            fusion
                .arbre
                .lecture_seule_effective(&ConnectionId::brut("c-prod"))
                .map(|lecture| lecture.est_active()),
            Some(true)
        );
        assert_eq!(
            fusion
                .arbre
                .libelles_de(&ConnectionId::brut("c-prod"), "orders")
                .and_then(|colonnes| colonnes.get("status"))
                .and_then(|valeurs| valeurs.get("3"))
                .map(String::as_str),
            Some("expédiée")
        );
        assert_eq!(fusion.secrets_a_ranger.len(), 1);
    }

    // ----- l'application -----

    #[test]
    fn un_import_range_les_mots_de_passe_puis_ecrit() {
        let fichier = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(cle("c-prod"), "s3cr3t".to_owned())]),
            ..fichier_de(halle().folders, Vec::new())
        };
        let magasin = Magasin::neuf();
        let mut ecrits: Vec<usize> = Vec::new();

        let (arbre, _) = appliquer(
            fusionner(&vide(), &Kubeconfigs::default(), &fichier, None),
            &magasin,
            &mut |arbre, _kubeconfigs| {
                ecrits.push(arbre.folders.len());
                Ok(())
            },
        )
        .expect("import");

        assert_eq!(arbre.folders.len(), 1);
        assert_eq!(ecrits, vec![1]);
        assert_eq!(magasin.lu(&cle("c-prod")).as_deref(), Some("s3cr3t"));
    }

    #[test]
    fn un_echec_d_ecriture_reprend_les_mots_de_passe_ranges() {
        let fichier = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([(cle("c-prod"), "s3cr3t".to_owned())]),
            ..fichier_de(halle().folders, Vec::new())
        };
        let magasin = Magasin::neuf();

        let erreur = appliquer(
            fusionner(&vide(), &Kubeconfigs::default(), &fichier, None),
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
        assert_eq!(magasin.lu(&cle("c-prod")), None);
    }

    #[test]
    fn un_refus_du_magasin_reprend_ce_qui_etait_deja_range() {
        let mut arbre = halle();
        arbre.folders[0].folders[0].connections[0] = avec_mot_de_passe("c-dev");
        let fichier = FichierDeDossiers {
            secrets: CarriedSecrets::Embedded,
            passwords: BTreeMap::from([
                (cle("c-dev"), "un".to_owned()),
                (cle("c-prod"), "deux".to_owned()),
            ]),
            ..fichier_de(arbre.folders, Vec::new())
        };
        let mut magasin = Magasin::neuf();
        magasin.panne_a_l_ecriture = Some(2);
        let mut ecrit = false;

        let erreur = appliquer(
            fusionner(&vide(), &Kubeconfigs::default(), &fichier, None),
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
        assert_eq!(magasin.lu(&cle("c-dev")), None);
    }
}

#[cfg(test)]
mod tests_kubeconfigs {
    use super::tests::{fichier_de, Magasin};
    use super::*;
    use crate::config::arbre_de_test::{base, dossier};

    /// Une connexion qui vise un cluster par la référence donnée.
    fn cluster(id: &str, reference: &KubeconfigId) -> Database {
        let mut connexion = base(id, false);
        connexion.connection.tunnel = Some(crate::config::Tunnel {
            local_port: None,
            proxy: Proxy::Kubernetes(crate::config::ProxyKubernetes {
                kubeconfig: Some(reference.clone()),
                namespace: None,
                resource: "svc/postgres".into(),
            }),
        });
        connexion
    }

    /// L'identifiant que le **fichier** porte pour son kubeconfig — **volontairement différent** de
    /// celui que cette machine dériverait du même chemin, sans quoi « remappée » et « reprise telle
    /// quelle » rendraient la même valeur (règle n° 5).
    const ID_DU_FICHIER: &str = "venu-d-ailleurs";

    fn exporte() -> FichierDeDossiers {
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
        let mut quai = dossier("quai", "Quai", false);
        quai.connections = vec![cluster("c-commandes", &prod), cluster("c-stocks", &prod)];
        let arbre = FolderTree {
            folders: vec![quai],
            connections: Vec::new(),
        };
        preparer(arbre, false, &Magasin::neuf(), &declarees)
            .expect("export")
            .0
    }

    fn reference_de(arbre: &FolderTree, id: &str) -> Option<KubeconfigId> {
        let (connexion, _) = arbre.connexion(&ConnectionId::brut(id))?;
        reference_de_kubeconfig(connexion)
    }

    #[test]
    fn l_export_ne_porte_que_les_declarations_referencees() {
        let fichier = exporte();
        assert_eq!(fichier.kubeconfigs.len(), 1);
        assert_eq!(fichier.kubeconfigs[0].path, "~/.kube/prod/config");
    }

    #[test]
    fn un_import_sur_une_machine_vierge_declare_le_fichier_et_remappe() {
        let fusion = fusionner(
            &FolderTree::default(),
            &Kubeconfigs::default(),
            &exporte(),
            None,
        );

        assert_eq!(fusion.kubeconfigs.declarations.len(), 1);
        let reference = reference_de(&fusion.arbre, "c-commandes").expect("une référence");
        assert_ne!(reference.as_str(), ID_DU_FICHIER);
        assert_eq!(
            fusion.kubeconfigs.resoudre(&reference),
            Some("~/.kube/prod/config")
        );
        assert_eq!(reference_de(&fusion.arbre, "c-stocks"), Some(reference));
    }

    #[test]
    fn un_import_reprend_la_declaration_locale_qui_porte_deja_ce_chemin() {
        let mut locaux = Kubeconfigs {
            declarations: vec![KubeconfigDeclaration {
                id: KubeconfigId::brut("mon-cluster"),
                label: "mon cluster".into(),
                path: "~/.kube/prod/config".into(),
            }],
            default: None,
        };
        locaux.declarer("~/.kube/autre.yaml");

        let fusion = fusionner(&FolderTree::default(), &locaux, &exporte(), None);

        assert_eq!(fusion.kubeconfigs.declarations.len(), 2);
        assert_eq!(
            reference_de(&fusion.arbre, "c-commandes"),
            Some(KubeconfigId::brut("mon-cluster"))
        );
    }

    #[test]
    fn le_chemin_importe_est_nomme_dans_le_rapport() {
        let fusion = fusionner(
            &FolderTree::default(),
            &Kubeconfigs::default(),
            &exporte(),
            None,
        );
        assert!(
            fusion.report.folders[0]
                .local_paths
                .iter()
                .any(|ligne| ligne.contains("~/.kube/prod/config")),
            "{:?}",
            fusion.report.folders[0].local_paths
        );
    }

    #[test]
    fn une_reference_que_le_fichier_ne_declare_pas_est_gardee_et_nommee() {
        let mut fichier = exporte();
        fichier.kubeconfigs.clear();

        let fusion = fusionner(
            &FolderTree::default(),
            &Kubeconfigs::default(),
            &fichier,
            None,
        );

        assert_eq!(fusion.report.folders[0].kubeconfigs_missing.len(), 2);
        assert!(fusion.kubeconfigs.declarations.is_empty());
        assert!(reference_de(&fusion.arbre, "c-commandes").is_some());
    }

    #[test]
    fn un_fichier_sans_connexion_kubernetes_ne_porte_aucune_declaration() {
        let mut declarees = Kubeconfigs::default();
        declarees.declarer("~/.kube/prod/config");
        let mut quai = dossier("quai", "Quai", false);
        quai.connections.push(base("c-quai", false));

        let (fichier, _) = preparer(
            FolderTree {
                folders: vec![quai],
                connections: Vec::new(),
            },
            false,
            &Magasin::neuf(),
            &declarees,
        )
        .expect("export");

        assert!(fichier.kubeconfigs.is_empty());
        let _ = fichier_de(Vec::new(), Vec::new());
    }
}
