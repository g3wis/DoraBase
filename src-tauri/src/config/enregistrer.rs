//! Les écritures de la configuration : déclarer, modifier, ranger, retirer (#165).
//!
//! **Deux écritures sur deux supports distincts**, dont l'une peut réussir quand l'autre échoue —
//! le magasin de secrets et le fichier de configuration. C'est tout le sujet de ce module, et la
//! raison pour laquelle il est séparé de `commands.rs` : l'ordonnancement et le rattrapage se
//! testent sans Tauri.
//!
//! # Ce que la bascule vers les dossiers a retiré
//!
//! Tant que le triplet `projet/base/environnement` désignait une connexion, renommer un projet ou
//! une connexion était une **migration** : déplacer des secrets, fermer des connexions, rattraper
//! un magasin en panne au milieu. Une connexion est désormais désignée par son identifiant stable
//! (`ConnectionId`), dont dérivent la clé du registre et la référence du secret : **renommer ne
//! touche plus ni au magasin ni au registre**, et ces fonctions-là sont devenues pures. L'algorithme
//! de déplacement n'a survécu qu'à un endroit, la migration v7 (`migration::secrets`).

use std::collections::BTreeMap;

use crate::config::arbre::{
    reference_de_connexion, ArbreError, ConnectionId, Folder, FolderColor, FolderId, FolderTree,
};
use crate::config::model::{ConnectionSettings, Console, Database, Engine};
use crate::secrets::{Secret, SecretError, SecretStore};

/// Ce qui peut faire refuser un enregistrement.
///
/// Les cas sont **distincts pour l'utilisateur** : un invariant violé se corrige dans le
/// formulaire, une panne de magasin est un problème de machine, et un échec d'écriture peut venir
/// d'un disque plein. Les fondre en une chaîne obligerait l'écran à deviner.
#[derive(Debug)]
pub enum SaveError {
    /// Un invariant de l'arbre n'est pas tenu.
    Arbre(ArbreError),
    /// Le magasin de secrets a refusé.
    Secret(SecretError),
    /// La configuration n'a pas pu être écrite.
    Config { reason: String, secret_repris: bool },
    /// Le dossier désigné n'existe pas : un désaccord entre l'écran et le disque, pas une faute
    /// de saisie.
    DossierInconnu { folder: FolderId },
    /// La connexion désignée n'existe pas — `mettre_a_jour` ne crée rien.
    ConnexionInconnue { connection: ConnectionId },
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Arbre(erreur) => write!(f, "{erreur}"),
            Self::Secret(erreur) => write!(f, "le mot de passe n'a pas pu être rangé : {erreur}"),
            Self::Config {
                reason,
                secret_repris,
            } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")?;
                if *secret_repris {
                    // Le dire : sans cela, l'utilisateur qui réessaie ne sait pas si son mot de
                    // passe est resté quelque part.
                    write!(f, " (le mot de passe rangé a été retiré)")
                } else {
                    write!(
                        f,
                        " (attention : le mot de passe rangé n'a pas pu être retiré)"
                    )
                }
            }
            Self::DossierInconnu { folder } => write!(f, "le dossier « {folder} » n'existe pas"),
            Self::ConnexionInconnue { connection } => {
                write!(f, "la connexion « {connection} » n'existe pas")
            }
        }
    }
}

/// Ce qu'il y a à enregistrer.
///
/// **L'identifiant est tiré par la commande et passé ici**, pour que les tests posent des
/// identifiants fixes : ce module ne tire aucun hasard.
pub struct NouvelleBase<'a> {
    pub id: ConnectionId,
    /// Le dossier qui la range ; `None` : à la racine.
    pub dossier: Option<&'a FolderId>,
    /// Le nom technique. Vide, l'abréviation du moteur ([`Engine::nom_par_defaut`]).
    pub name: &'a str,
    pub engine: Engine,
    pub variant: ConnectionSettings,
    pub password: Option<&'a Secret>,
    /// Le libellé d'affichage. `None` et une chaîne vide sont la même chose ici.
    pub label: Option<&'a str>,
}

/// Ce qu'il y a à modifier sur une connexion existante.
pub struct Modification<'a> {
    pub connection: &'a ConnectionId,
    /// Les réglages saisis. Leur `password` est **ignoré** : la connexion garde sa référence.
    pub reglages: &'a ConnectionSettings,
    /// `None` laisse le secret en place.
    pub password: Option<&'a Secret>,
    /// La valeur définitive du libellé, vide y compris pour l'effacer.
    pub label: Option<&'a str>,
}

/// Le vide et l'absence sont la même chose, comme pour le certificat d'autorité de `06f` : une
/// chaîne blanche dans la configuration se lirait comme un libellé véritable.
fn libelle_net(label: Option<&str>) -> Option<String> {
    label
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(str::to_owned)
}

/// Ajoute une connexion à l'arbre, et range son mot de passe.
///
/// # L'ordre, et pourquoi
///
/// **Secret d'abord, configuration ensuite.** Si la configuration échoue après que le secret est
/// rangé, le secret est repris : un orphelin est invisible, mais une référence morte — l'ordre
/// inverse — casserait une connexion sans que rien l'explique.
///
/// `ecrire` est un paramètre plutôt qu'un `&ConfigStore` : c'est ce qui permet de **provoquer**
/// l'échec d'écriture dans un test.
pub fn enregistrer(
    arbre: &mut FolderTree,
    nouvelle: NouvelleBase<'_>,
    store: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&FolderTree) -> Result<(), String>,
) -> Result<(), SaveError> {
    let NouvelleBase {
        id,
        dossier,
        name,
        engine,
        mut variant,
        password,
        label,
    } = nouvelle;

    // La référence est posée **avant** toute écriture, et elle dérive de l'identifiant : c'est la
    // seule que `FolderTree::valider` accepte.
    let reference = password.map(|_| reference_de_connexion(&id));
    variant.password = reference.clone();

    let name = match name.trim() {
        "" => engine.nom_par_defaut().to_owned(),
        nom => nom.to_owned(),
    };
    let base = Database {
        id,
        name,
        label: libelle_net(label),
        // Une connexion neuve porte le logo et les couleurs de son moteur (#179) : l'apparence se
        // règle ensuite, depuis l'arbre, comme celle d'un dossier.
        color: None,
        icon: None,
        engine,
        connection: variant,
        // Une connexion neuve n'a aucune console : elles se créent depuis son menu « … ».
        consoles: Vec::new(),
        // **`None`, jamais `Some(vec![])`** : les schémas ne sont pas réglés, donc l'arbre montre
        // tous les non-système (`API-33`).
        visible_schemas: None,
    };

    // Un arbre candidat, validé à part : muter d'abord puis valider obligerait à défaire la
    // mutation en cas de refus.
    let mut candidat = arbre.clone();
    match dossier {
        None => candidat.connections.push(base),
        Some(dossier) => candidat
            .dossier_mut(dossier)
            .ok_or_else(|| SaveError::DossierInconnu {
                folder: dossier.clone(),
            })?
            .connections
            .push(base),
    }
    candidat.valider().map_err(SaveError::Arbre)?;

    if let (Some(reference), Some(secret)) = (reference.as_ref(), password) {
        store.store(reference, secret).map_err(SaveError::Secret)?;
    }

    if let Err(reason) = ecrire(&candidat) {
        let secret_repris = match reference.as_ref() {
            Some(reference) => store.delete(reference).is_ok(),
            // Aucun secret rangé : rien à reprendre, donc « repris » est vrai par vacuité.
            None => true,
        };
        return Err(SaveError::Config {
            reason,
            secret_repris,
        });
    }
    *arbre = candidat;
    Ok(())
}

/// Met à jour les réglages d'une connexion **existante**.
///
/// **Distincte d'`enregistrer`, qui ajoute** : celle-ci exige que la connexion existe, et ne change
/// ni son identifiant, ni son dossier, ni son moteur. **Un mot de passe absent laisse le secret en
/// place** — sinon corriger un port obligerait à retaper le mot de passe.
pub fn mettre_a_jour(
    arbre: &mut FolderTree,
    modification: Modification<'_>,
    store: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&FolderTree) -> Result<(), String>,
) -> Result<(), SaveError> {
    let Modification {
        connection,
        reglages,
        password,
        label,
    } = modification;

    let mut candidat = arbre.clone();
    let base = candidat
        .connexion_mut(connection)
        .ok_or_else(|| SaveError::ConnexionInconnue {
            connection: connection.clone(),
        })?;

    let mut reglages = reglages.clone();
    reglages.password = base.connection.password.clone();
    // Un mot de passe fourni remplace le secret, et pose la référence si elle manquait — une
    // connexion déclarée sans mot de passe à laquelle on en ajoute un.
    if let Some(secret) = password {
        let reference = reference_de_connexion(connection);
        store.store(&reference, secret).map_err(SaveError::Secret)?;
        reglages.password = Some(reference);
    }
    base.connection = reglages;
    base.label = libelle_net(label);
    candidat.valider().map_err(SaveError::Arbre)?;

    ecrire(&candidat).map_err(|reason| SaveError::Config {
        reason,
        // Le secret, s'il a été fourni, est déjà remplacé : dit explicitement.
        secret_repris: password.is_none(),
    })?;
    *arbre = candidat;
    Ok(())
}

/// Les refus des écritures pures — dossiers, renommages, consoles, réglages d'affichage.
#[derive(Debug, PartialEq, Eq)]
pub enum EditError {
    /// Un nom vide, ou seulement des espaces.
    NomVide,
    /// Une console de ce nom existe déjà sous cette connexion.
    ConsoleDeja {
        nom: String,
    },
    ConsoleInconnue {
        nom: String,
    },
    DossierInconnu {
        folder: FolderId,
    },
    ConnexionInconnue {
        connection: ConnectionId,
    },
    /// Les libellés de valeurs vivent sur un dossier : une connexion rangée à la racine n'a nulle
    /// part où les poser.
    ConnexionALaRacine {
        connection: ConnectionId,
    },
    /// Un nom d'icône qui ne peut pas être celui d'un symbole du sprite (#171).
    IconeInvalide {
        icon: String,
    },
    /// L'arbre d'après ne tiendrait pas ses invariants — deux dossiers frères homonymes, le plus
    /// souvent. Le message vient de l'arbre, qui nomme le fautif.
    Arbre(ArbreError),
}

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NomVide => write!(f, "un nom ne peut pas être vide"),
            Self::ConsoleDeja { nom } => write!(f, "une console nommée « {nom} » existe déjà"),
            Self::ConsoleInconnue { nom } => write!(f, "aucune console nommée « {nom} »"),
            Self::DossierInconnu { folder } => write!(f, "le dossier « {folder} » n'existe pas"),
            Self::ConnexionInconnue { connection } => {
                write!(f, "la connexion « {connection} » n'existe pas")
            }
            Self::ConnexionALaRacine { .. } => write!(
                f,
                "cette connexion n'est rangée dans aucun dossier : rangez-la dans un dossier pour \
                 lui déclarer des libellés de valeurs"
            ),
            Self::IconeInvalide { icon } => {
                write!(f, "« {icon} » n'est pas un nom d'icône")
            }
            Self::Arbre(erreur) => write!(f, "{erreur}"),
        }
    }
}

fn nom_net(nom: &str) -> Result<&str, EditError> {
    match nom.trim() {
        "" => Err(EditError::NomVide),
        nom => Ok(nom),
    }
}

/// Le candidat validé, ou le refus de l'arbre.
fn valide(candidat: FolderTree) -> Result<FolderTree, EditError> {
    candidat.valider().map_err(EditError::Arbre)?;
    Ok(candidat)
}

fn dossier_mut<'a>(arbre: &'a mut FolderTree, id: &FolderId) -> Result<&'a mut Folder, EditError> {
    arbre
        .dossier_mut(id)
        .ok_or_else(|| EditError::DossierInconnu { folder: id.clone() })
}

fn connexion_mut<'a>(
    arbre: &'a mut FolderTree,
    id: &ConnectionId,
) -> Result<&'a mut Database, EditError> {
    arbre
        .connexion_mut(id)
        .ok_or_else(|| EditError::ConnexionInconnue {
            connection: id.clone(),
        })
}

/// « dossier N », avec le plus petit N libre parmi `freres` — la règle de « console N ».
///
/// **Aucune modale ne nomme un objet à sa création** : on le crée, puis on le renomme sur place.
pub fn nom_de_dossier_libre(freres: &[Folder]) -> String {
    (1u32..)
        .map(|rang| format!("dossier {rang}"))
        .find(|candidat| !freres.iter().any(|frere| frere.name.trim() == candidat))
        .expect("la suite des rangs est infinie")
}

/// Crée un dossier vide, nommé « dossier N », sous `parent` ou à la racine.
///
/// L'identifiant est tiré par la commande et passé ici, comme pour [`enregistrer`].
pub fn creer_dossier(
    arbre: &FolderTree,
    parent: Option<&FolderId>,
    id: FolderId,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    let freres = match parent {
        None => &mut candidat.folders,
        Some(parent) => &mut dossier_mut(&mut candidat, parent)?.folders,
    };
    let name = nom_de_dossier_libre(freres);
    freres.push(Folder {
        id,
        name,
        color: None,
        icon: None,
        read_only: false,
        folders: Vec::new(),
        connections: Vec::new(),
        value_labels: BTreeMap::new(),
        queries: Vec::new(),
    });
    valide(candidat)
}

/// Renomme un dossier. **Ne ferme rien et ne touche à aucun secret** : le nom d'un dossier n'entre
/// ni dans la clé du registre ni dans la référence d'un mot de passe.
///
/// Un frère homonyme est refusé par l'arbre (`DossierHomonyme`) : la fusion de #169 apparie les
/// dossiers par leur nom. Renommer en son propre nom ne fait rien.
pub fn renommer_dossier(
    arbre: &FolderTree,
    id: &FolderId,
    nom: &str,
) -> Result<FolderTree, EditError> {
    let nom = nom_net(nom)?;
    let mut candidat = arbre.clone();
    dossier_mut(&mut candidat, id)?.name = nom.to_owned();
    valide(candidat)
}

/// Change la pastille d'un dossier ; `None` la retire.
pub fn recolorier_dossier(
    arbre: &FolderTree,
    id: &FolderId,
    couleur: Option<FolderColor>,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    dossier_mut(&mut candidat, id)?.color = couleur;
    valide(candidat)
}

/// Change l'icône d'un dossier (#171) ; `None` la rend à `pin`.
///
/// **Le cœur vérifie la forme, pas l'appartenance à la liste offerte.** La liste vit à l'écran
/// (`iconesDeDossier.ts`) : la recopier ici ferait deux sources qui divergeraient à la première icône
/// ajoutée, et une version plus ancienne refuserait alors ce qu'une plus récente a écrit. Ce que la
/// forme refuse est ce qui ne peut être le nom d'**aucun** symbole — `[a-z0-9-]`, 1 à 40 caractères,
/// la grammaire des identifiants `i-…` du sprite —, c'est-à-dire ce qu'un appelant autre que l'écran
/// pourrait glisser dans le fichier. **Une chaîne vide vaut `None`** : c'est « aucune icône choisie »,
/// pas un nom.
///
/// La lecture, elle, ne vérifie rien : un nom mal formé écrit à la main se relit et retombe sur `pin`
/// à l'affichage — voir `Folder::icon`.
pub fn regler_l_icone(
    arbre: &FolderTree,
    id: &FolderId,
    icone: Option<&str>,
) -> Result<FolderTree, EditError> {
    let icone = icone_nette(icone)?;
    let mut candidat = arbre.clone();
    dossier_mut(&mut candidat, id)?.icon = icone;
    valide(candidat)
}

/// Change la pastille d'une connexion (#179) ; `None` rend les couleurs de son moteur.
///
/// **Ne ferme rien** : la couleur n'entre ni dans la recette d'ouverture ni dans aucune identité —
/// c'est un réglage d'affichage, comme celle d'un dossier.
pub fn recolorier_connexion(
    arbre: &FolderTree,
    id: &ConnectionId,
    couleur: Option<FolderColor>,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    connexion_mut(&mut candidat, id)?.color = couleur;
    valide(candidat)
}

/// Change l'icône d'une connexion (#179) ; `None` rend le logo de son moteur.
///
/// **La règle de [`regler_l_icone`], par la même fonction** : la forme seule est vérifiée, la liste
/// offerte vit à l'écran (`iconesDeConnexion.ts`), et une chaîne vide vaut `None`. Deux vérifications
/// de forme finiraient par accepter des noms différents pour un dossier et pour une connexion.
pub fn regler_l_icone_de_la_connexion(
    arbre: &FolderTree,
    id: &ConnectionId,
    icone: Option<&str>,
) -> Result<FolderTree, EditError> {
    let icone = icone_nette(icone)?;
    let mut candidat = arbre.clone();
    connexion_mut(&mut candidat, id)?.icon = icone;
    valide(candidat)
}

/// Le nom d'icône à écrire : `None` pour le vide, refusé s'il ne peut être celui d'aucun symbole.
fn icone_nette(icone: Option<&str>) -> Result<Option<String>, EditError> {
    match icone.map(str::trim) {
        None | Some("") => Ok(None),
        Some(nom) if forme_d_icone(nom) => Ok(Some(nom.to_owned())),
        Some(nom) => Err(EditError::IconeInvalide {
            icon: nom.to_owned(),
        }),
    }
}

fn forme_d_icone(nom: &str) -> bool {
    (1..=40).contains(&nom.len())
        && nom
            .bytes()
            .all(|octet| octet.is_ascii_lowercase() || octet.is_ascii_digit() || octet == b'-')
}

/// Pose ou lève la lecture seule d'un dossier — **la seule écriture de ce drapeau**. Ce qu'elle
/// impose aux écrans et au moteur est l'affaire de #168.
pub fn regler_la_lecture_seule(
    arbre: &FolderTree,
    id: &FolderId,
    lecture_seule: bool,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    dossier_mut(&mut candidat, id)?.read_only = lecture_seule;
    valide(candidat)
}

/// Renomme une connexion : change `Database::name`, jamais `label`.
///
/// **Pure depuis #165** : `name` n'est plus une identité, donc ni le magasin ni le registre n'ont
/// à le savoir — rien ne se ferme, rien ne se déplace. Et il n'est plus unique : deux « psql »
/// peuvent vivre dans le même dossier.
pub fn renommer_connexion(
    arbre: &FolderTree,
    id: &ConnectionId,
    nom: &str,
) -> Result<FolderTree, EditError> {
    let nom = nom_net(nom)?;
    let mut candidat = arbre.clone();
    connexion_mut(&mut candidat, id)?.name = nom.to_owned();
    valide(candidat)
}

/// Crée une console vide sur une connexion. Le nom est unique **dans la connexion**.
pub fn ajouter_console(
    arbre: &FolderTree,
    id: &ConnectionId,
    nom: &str,
) -> Result<FolderTree, EditError> {
    let nom = nom_net(nom)?;
    let mut candidat = arbre.clone();
    let base = connexion_mut(&mut candidat, id)?;
    if base.consoles.iter().any(|console| console.name == nom) {
        return Err(EditError::ConsoleDeja {
            nom: nom.to_owned(),
        });
    }
    base.consoles.push(Console {
        name: nom.to_owned(),
        sql: String::new(),
    });
    Ok(candidat)
}

/// Écrit le texte d'une console. **La console doit exister** : on écrit dans une console déjà
/// créée et visible dans l'arbre.
pub fn enregistrer_sql_de_console(
    arbre: &FolderTree,
    id: &ConnectionId,
    nom: &str,
    sql: &str,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    let console = connexion_mut(&mut candidat, id)?
        .consoles
        .iter_mut()
        .find(|console| console.name == nom)
        .ok_or_else(|| EditError::ConsoleInconnue {
            nom: nom.to_owned(),
        })?;
    console.sql = sql.to_owned();
    Ok(candidat)
}

/// Renomme une console. Vers son propre nom : accepté sans rien faire.
pub fn renommer_console(
    arbre: &FolderTree,
    id: &ConnectionId,
    ancien: &str,
    nouveau: &str,
) -> Result<FolderTree, EditError> {
    let nouveau = nom_net(nouveau)?;
    let mut candidat = arbre.clone();
    let base = connexion_mut(&mut candidat, id)?;
    if nouveau != ancien && base.consoles.iter().any(|console| console.name == nouveau) {
        return Err(EditError::ConsoleDeja {
            nom: nouveau.to_owned(),
        });
    }
    base.consoles
        .iter_mut()
        .find(|console| console.name == ancien)
        .ok_or_else(|| EditError::ConsoleInconnue {
            nom: ancien.to_owned(),
        })?
        .name = nouveau.to_owned();
    Ok(candidat)
}

/// Retire une console. **Une console absente n'est pas un échec** : le geste a déjà eu son effet.
pub fn retirer_console(
    arbre: &FolderTree,
    id: &ConnectionId,
    nom: &str,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    connexion_mut(&mut candidat, id)?
        .consoles
        .retain(|console| console.name != nom);
    Ok(candidat)
}

/// Règle les schémas que l'arbre montre sous une connexion (`API-33`).
///
/// **La liste est prise telle quelle, y compris vide** : `Some(vec![])` est un réglage — tout a
/// été décoché —, distinct de `None`, « jamais réglé ».
pub fn regler_les_schemas_affiches(
    arbre: &FolderTree,
    id: &ConnectionId,
    schemas: Vec<String>,
) -> Result<FolderTree, EditError> {
    let mut candidat = arbre.clone();
    connexion_mut(&mut candidat, id)?.visible_schemas = Some(schemas);
    Ok(candidat)
}

/// Règle ce que les entiers d'une colonne veulent dire (`API-75`), **vu depuis une connexion**.
///
/// # Le dossier qui les reçoit
///
/// Celui qui fournit **actuellement** la table à cette connexion — le plus proche ancêtre qui la
/// déclare, la règle de `FolderTree::libelles_de` —, sinon son dossier **racine**, qui reproduit la
/// sémantique v6 (les libellés d'un projet, partagés entre dev, staging et prod). Écrire ailleurs
/// que là où la lecture les prend ferait un réglage qui ne se voit pas.
///
/// **Une liste vide retire la déclaration**, et la table part avec sa dernière colonne.
pub fn regler_les_libelles_de_valeurs(
    arbre: &FolderTree,
    id: &ConnectionId,
    table: &str,
    column: &str,
    libelles: BTreeMap<String, String>,
) -> Result<FolderTree, EditError> {
    let (_, ancetres) = arbre
        .connexion(id)
        .ok_or_else(|| EditError::ConnexionInconnue {
            connection: id.clone(),
        })?;
    let hote = ancetres
        .iter()
        .rev()
        .find(|dossier| dossier.value_labels.contains_key(table))
        .or_else(|| ancetres.first())
        .map(|dossier| dossier.id.clone())
        .ok_or_else(|| EditError::ConnexionALaRacine {
            connection: id.clone(),
        })?;

    let mut candidat = arbre.clone();
    let dossier = dossier_mut(&mut candidat, &hote)?;
    if libelles.is_empty() {
        if let Some(colonnes) = dossier.value_labels.get_mut(table) {
            colonnes.remove(column);
            if colonnes.is_empty() {
                dossier.value_labels.remove(table);
            }
        }
    } else {
        dossier
            .value_labels
            .entry(table.to_owned())
            .or_default()
            .insert(column.to_owned(), libelles);
    }
    Ok(candidat)
}

/// La première connexion du sous-arbre d'un dossier, dans l'ordre où l'arbre les montre —
/// sous-dossiers d'abord, puis les connexions du dossier.
fn premiere_connexion_mut(dossier: &mut Folder) -> Option<&mut Database> {
    for enfant in &mut dossier.folders {
        if let Some(base) = premiere_connexion_mut(enfant) {
            return Some(base);
        }
    }
    dossier.connections.first_mut()
}

fn verser_les_requetes(dossiers: &mut [Folder]) {
    for dossier in dossiers.iter_mut() {
        verser_les_requetes(&mut dossier.folders);
        if dossier.queries.is_empty() {
            continue;
        }
        let requetes = std::mem::take(&mut dossier.queries);
        let Some(base) = premiere_connexion_mut(dossier) else {
            dossier.queries = requetes;
            continue;
        };
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

/// Verse les requêtes enregistrées de `12f` qui attendent sur un dossier dans les consoles de la
/// première connexion de son sous-arbre.
///
/// **Appelée à chaque chargement** : un dossier sans aucune connexion n'a nulle part où verser ses
/// requêtes, et elles attendent alors la première — la règle de `Project::queries`, portée sur
/// l'arbre. **Un nom déjà pris est suffixé** plutôt que refusé : cette reprise ne doit jamais
/// échouer, sans quoi un homonyme bloquerait le chargement de toute la configuration.
pub fn migrer_requetes_en_consoles(arbre: &mut FolderTree) {
    verser_les_requetes(&mut arbre.folders);
}

/// Ce qu'une suppression a fait, et ce qu'elle laisse à faire à l'appelant (`08j`).
#[derive(Debug)]
pub struct Suppression {
    /// L'arbre après suppression.
    pub arbre: FolderTree,
    /// Les connexions retirées — ce que l'appelant ferme au registre, et que l'écran ferme de son
    /// côté (onglets, états, cache).
    pub connexions: Vec<ConnectionId>,
    /// Les mots de passe que le magasin n'a pas su effacer. **Dits, jamais tus.**
    pub secrets_residuels: Vec<String>,
}

/// L'échec d'une suppression.
#[derive(Debug)]
pub enum DeleteError {
    DossierInconnu { folder: FolderId },
    ConnexionInconnue { connection: ConnectionId },
    Config { reason: String },
}

impl std::fmt::Display for DeleteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DossierInconnu { folder } => write!(f, "le dossier « {folder} » n'existe pas"),
            Self::ConnexionInconnue { connection } => {
                write!(f, "la connexion « {connection} » n'existe pas")
            }
            Self::Config { reason } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")
            }
        }
    }
}

/// Retire une connexion d'une liste, à toute profondeur.
fn retirer_connexion(dossiers: &mut [Folder], id: &ConnectionId) -> Option<Database> {
    for dossier in dossiers {
        if let Some(rang) = dossier.connections.iter().position(|base| &base.id == id) {
            return Some(dossier.connections.remove(rang));
        }
        if let Some(base) = retirer_connexion(&mut dossier.folders, id) {
            return Some(base);
        }
    }
    None
}

/// Retire un dossier d'une liste, à toute profondeur.
fn retirer_dossier(dossiers: &mut Vec<Folder>, id: &FolderId) -> Option<Folder> {
    if let Some(rang) = dossiers.iter().position(|dossier| &dossier.id == id) {
        return Some(dossiers.remove(rang));
    }
    dossiers
        .iter_mut()
        .find_map(|dossier| retirer_dossier(&mut dossier.folders, id))
}

/// Toutes les connexions d'un dossier retiré, lui compris, à toute profondeur.
fn toutes_les_connexions(dossier: Folder, sortie: &mut Vec<Database>) {
    for enfant in dossier.folders {
        toutes_les_connexions(enfant, sortie);
    }
    sortie.extend(dossier.connections);
}

/// Efface le secret d'une connexion retirée. Rend la référence qui a résisté, s'il y en a une :
/// elle **ne fait pas échouer** la suppression — la déclaration est partie, la refuser laisserait
/// l'entrée indélébile.
fn oublier(base: &Database, magasin: &dyn SecretStore) -> Option<String> {
    // La référence **déclarée**, pas une recalculée : c'est celle qu'`open_database` lirait.
    let reference = base.connection.password.as_ref()?;
    magasin
        .delete(reference)
        .is_err()
        .then(|| reference.as_str().to_owned())
}

/// La phase commune aux deux retraits : écrire, **puis** effacer les secrets.
///
/// **La configuration d'abord, les secrets ensuite** — la phase destructive en dernier. L'ordre
/// inverse laissait une connexion **déclarée sans son mot de passe** quand l'écriture échouait
/// après l'effacement.
fn achever_le_retrait(
    arbre: FolderTree,
    retirees: Vec<Database>,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&FolderTree) -> Result<(), String>,
) -> Result<Suppression, DeleteError> {
    ecrire(&arbre).map_err(|reason| DeleteError::Config { reason })?;
    let secrets_residuels = retirees
        .iter()
        .filter_map(|base| oublier(base, magasin))
        .collect();
    Ok(Suppression {
        arbre,
        connexions: retirees.into_iter().map(|base| base.id).collect(),
        secrets_residuels,
    })
}

/// Retire la **déclaration** d'une connexion, et son mot de passe.
///
/// **Rien n'est supprimé sur le serveur, et cette fonction ne peut pas l'être** : elle ne reçoit
/// aucun moteur, n'ouvre aucune connexion et n'émet aucun SQL. **Un secret introuvable n'est pas un
/// échec**, pour la même raison que ci-dessus.
pub fn supprimer_base(
    arbre: &FolderTree,
    id: &ConnectionId,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&FolderTree) -> Result<(), String>,
) -> Result<Suppression, DeleteError> {
    let mut candidat = arbre.clone();
    let retiree = match candidat.connections.iter().position(|base| &base.id == id) {
        Some(rang) => Some(candidat.connections.remove(rang)),
        None => retirer_connexion(&mut candidat.folders, id),
    }
    .ok_or_else(|| DeleteError::ConnexionInconnue {
        connection: id.clone(),
    })?;
    achever_le_retrait(candidat, vec![retiree], magasin, ecrire)
}

/// Retire un dossier, **tout son sous-arbre**, et les mots de passe de ses connexions.
///
/// **Le même chemin que `supprimer_base`**, et c'est voulu : deux chemins de suppression différents
/// finiraient par diverger. Comme lui, il ne touche aucune base distante.
pub fn supprimer_dossier(
    arbre: &FolderTree,
    id: &FolderId,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&FolderTree) -> Result<(), String>,
) -> Result<Suppression, DeleteError> {
    let mut candidat = arbre.clone();
    let dossier = retirer_dossier(&mut candidat.folders, id)
        .ok_or_else(|| DeleteError::DossierInconnu { folder: id.clone() })?;
    let mut retirees = Vec::new();
    toutes_les_connexions(dossier, &mut retirees);
    achever_le_retrait(candidat, retirees, magasin, ecrire)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::arbre::tests::{base, dossier};

    /// `nord` › `prod` (lecture seule), une connexion `a` dans `prod` avec son mot de passe, une
    /// connexion `b` à la racine sans mot de passe.
    pub(super) fn arbre() -> FolderTree {
        let mut prod = dossier("prod", "prod", true);
        let mut a = base("a", false);
        a.connection.password = Some(reference_de_connexion(&a.id));
        a.consoles.push(Console {
            name: "console 1".into(),
            sql: "select 1".into(),
        });
        prod.connections.push(a);
        let mut nord = dossier("nord", "Atelier Nord", false);
        nord.folders.push(prod);
        FolderTree {
            folders: vec![nord],
            connections: vec![base("b", false)],
        }
    }

    fn id(valeur: &str) -> ConnectionId {
        ConnectionId::brut(valeur)
    }

    fn dossier_id(valeur: &str) -> FolderId {
        FolderId::brut(valeur)
    }

    // --- Renommer ne touche à rien d'autre que le nom (#165) ---

    #[test]
    fn renommer_une_connexion_garde_son_identite() {
        // **La propriété qui rend le renommage sûr sans magasin ni registre** : l'identifiant, donc la
        // clé du registre et la référence du secret, ne bougent pas. Sabotage vérifié : tirer un
        // nouvel identifiant au renommage fait tomber ce test.
        let avant = arbre();
        let apres = renommer_connexion(&avant, &id("a"), "  entrepôt  ").expect("renommage");
        let (renommee, _) = apres.connexion(&id("a")).expect("toujours là");
        assert_eq!(renommee.name, "entrepôt");
        assert_eq!(
            renommee.connection.password,
            Some(reference_de_connexion(&id("a")))
        );
        assert_eq!(renommee.label, None, "le libellé n'est pas le nom");
    }

    #[test]
    fn deux_connexions_homonymes_dans_un_dossier_sont_permises() {
        // Le revirement de « une collision reste un refus » : `name` n'est plus une identité.
        let apres = renommer_connexion(&arbre(), &id("b"), "base-a").expect("renommage");
        let apres = renommer_connexion(&apres, &id("a"), "base-a").expect("homonyme permis");
        assert!(apres.valider().is_ok());
    }

    #[test]
    fn un_nom_vide_est_refuse() {
        assert_eq!(
            renommer_connexion(&arbre(), &id("a"), "   ").unwrap_err(),
            EditError::NomVide
        );
        assert_eq!(
            renommer_dossier(&arbre(), &dossier_id("nord"), "").unwrap_err(),
            EditError::NomVide
        );
    }

    #[test]
    fn renommer_un_dossier_ne_change_que_son_nom() {
        let avant = arbre();
        let apres = renommer_dossier(&avant, &dossier_id("prod"), "production").expect("renommage");
        assert_eq!(
            apres.dossier(&dossier_id("prod")).expect("là").name,
            "production"
        );
        // Tout le reste est identique : les connexions, leurs références, la lecture seule.
        let mut attendu = avant.clone();
        attendu.dossier_mut(&dossier_id("prod")).expect("là").name = "production".into();
        assert_eq!(apres, attendu);
    }

    #[test]
    fn un_frere_homonyme_est_refuse_au_renommage() {
        let mut avant = arbre();
        avant.folders.push(dossier("sud", "Sud", false));
        let erreur = renommer_dossier(&avant, &dossier_id("sud"), "Atelier Nord").unwrap_err();
        assert!(matches!(
            erreur,
            EditError::Arbre(ArbreError::DossierHomonyme { .. })
        ));
    }

    // --- Créer un dossier (#165) ---

    #[test]
    fn un_dossier_cree_prend_le_plus_petit_numero_libre() {
        let mut avant = arbre();
        avant.folders.push(dossier("d2", "dossier 2", false));
        let apres = creer_dossier(&avant, None, dossier_id("neuf")).expect("création");
        let neuf = apres.dossier(&dossier_id("neuf")).expect("créé");
        assert_eq!(neuf.name, "dossier 1");
        assert!(!neuf.read_only);
        let encore = creer_dossier(&apres, None, dossier_id("autre")).expect("création");
        assert_eq!(
            encore.dossier(&dossier_id("autre")).expect("créé").name,
            "dossier 3"
        );
    }

    #[test]
    fn un_dossier_se_cree_sous_son_parent() {
        let apres = creer_dossier(&arbre(), Some(&dossier_id("prod")), dossier_id("neuf"))
            .expect("création");
        let ancetres = apres
            .ancetres_du_dossier(&dossier_id("neuf"))
            .expect("créé");
        assert_eq!(ancetres.last().map(|d| d.id.as_str()), Some("prod"));
        assert_eq!(
            creer_dossier(&arbre(), Some(&dossier_id("absent")), dossier_id("n")).unwrap_err(),
            EditError::DossierInconnu {
                folder: dossier_id("absent")
            }
        );
    }

    #[test]
    fn la_couleur_et_la_lecture_seule_se_reglent() {
        let apres =
            recolorier_dossier(&arbre(), &dossier_id("prod"), Some(FolderColor::Amber)).unwrap();
        assert_eq!(
            apres.dossier(&dossier_id("prod")).unwrap().color,
            Some(FolderColor::Amber)
        );
        let apres = regler_la_lecture_seule(&apres, &dossier_id("prod"), false).unwrap();
        assert!(!apres.dossier(&dossier_id("prod")).unwrap().read_only);
        let apres = recolorier_dossier(&apres, &dossier_id("prod"), None).unwrap();
        assert_eq!(apres.dossier(&dossier_id("prod")).unwrap().color, None);
    }

    #[test]
    fn l_icone_se_regle_et_se_retire_sans_toucher_a_la_couleur() {
        let avant =
            recolorier_dossier(&arbre(), &dossier_id("prod"), Some(FolderColor::Amber)).unwrap();
        let apres = regler_l_icone(&avant, &dossier_id("prod"), Some("rocket")).unwrap();
        let prod = apres.dossier(&dossier_id("prod")).unwrap();
        assert_eq!(prod.icon.as_deref(), Some("rocket"));
        assert_eq!(
            prod.color,
            Some(FolderColor::Amber),
            "deux gestes, deux champs"
        );

        // Un nom que cette version ne connaît pas est **accepté** : la liste vit à l'écran.
        let apres = regler_l_icone(&apres, &dossier_id("prod"), Some("chart-column-2")).unwrap();
        assert_eq!(
            apres.dossier(&dossier_id("prod")).unwrap().icon.as_deref(),
            Some("chart-column-2")
        );

        for vide in [None, Some(""), Some("  ")] {
            let apres = regler_l_icone(&apres, &dossier_id("prod"), vide).unwrap();
            assert_eq!(
                apres.dossier(&dossier_id("prod")).unwrap().icon,
                None,
                "{vide:?}"
            );
        }
    }

    #[test]
    fn une_icone_mal_formee_est_refusee_a_l_ecriture() {
        let long = "a".repeat(41);
        for fautive in ["Rocket", "i-rocket\"", "../pin", "fusée", long.as_str()] {
            assert_eq!(
                regler_l_icone(&arbre(), &dossier_id("prod"), Some(fautive)).unwrap_err(),
                EditError::IconeInvalide {
                    icon: fautive.to_owned()
                },
                "{fautive}"
            );
        }
        // Contrôle positif : la borne haute est incluse.
        assert!(regler_l_icone(&arbre(), &dossier_id("prod"), Some(&"a".repeat(40))).is_ok());
    }

    /// Une connexion de `arbre()`, désignée par son identifiant — celle que les tests d'apparence
    /// règlent (#179).
    fn une_connexion(arbre: &FolderTree) -> ConnectionId {
        arbre
            .connexions()
            .next()
            .map(|(base, _)| base.id.clone())
            .expect("le décor porte au moins une connexion")
    }

    #[test]
    fn la_couleur_et_l_icone_d_une_connexion_se_reglent_chacune_sans_toucher_a_l_autre() {
        let depart = arbre();
        let id = une_connexion(&depart);

        let apres = recolorier_connexion(&depart, &id, Some(FolderColor::Red)).unwrap();
        let apres = regler_l_icone_de_la_connexion(&apres, &id, Some("rocket")).unwrap();
        let base = apres.connexion(&id).unwrap().0;
        assert_eq!(
            base.color,
            Some(FolderColor::Red),
            "deux gestes, deux champs"
        );
        assert_eq!(base.icon.as_deref(), Some("rocket"));

        // Rien d'autre ne bouge : ni le nom, ni les réglages, ni la place dans l'arbre.
        let avant = depart.connexion(&id).unwrap().0;
        assert_eq!(base.name, avant.name);
        assert_eq!(base.connection, avant.connection);

        // Un nom que cette version ne connaît pas est **accepté** : la liste vit à l'écran.
        let apres = regler_l_icone_de_la_connexion(&apres, &id, Some("chart-column-2")).unwrap();
        assert_eq!(
            apres.connexion(&id).unwrap().0.icon.as_deref(),
            Some("chart-column-2")
        );

        let apres = recolorier_connexion(&apres, &id, None).unwrap();
        for vide in [None, Some(""), Some("  ")] {
            let apres = regler_l_icone_de_la_connexion(&apres, &id, vide).unwrap();
            let base = apres.connexion(&id).unwrap().0;
            assert_eq!(base.icon, None, "{vide:?}");
            assert_eq!(base.color, None);
        }
    }

    #[test]
    fn l_icone_d_une_connexion_suit_la_forme_de_celle_d_un_dossier() {
        let depart = arbre();
        let id = une_connexion(&depart);
        let long = "a".repeat(41);
        for fautive in ["Rocket", "i-rocket\"", "../pin", "fusée", long.as_str()] {
            assert_eq!(
                regler_l_icone_de_la_connexion(&depart, &id, Some(fautive)).unwrap_err(),
                EditError::IconeInvalide {
                    icon: fautive.to_owned()
                },
                "{fautive}"
            );
        }
        assert!(regler_l_icone_de_la_connexion(&depart, &id, Some(&"a".repeat(40))).is_ok());
    }

    #[test]
    fn une_connexion_inconnue_est_refusee_par_les_deux_gestes() {
        let inconnue = ConnectionId::brut("absente");
        assert_eq!(
            recolorier_connexion(&arbre(), &inconnue, Some(FolderColor::Green)).unwrap_err(),
            EditError::ConnexionInconnue {
                connection: inconnue.clone()
            }
        );
        assert_eq!(
            regler_l_icone_de_la_connexion(&arbre(), &inconnue, Some("rocket")).unwrap_err(),
            EditError::ConnexionInconnue {
                connection: inconnue.clone()
            }
        );
    }
}

#[cfg(test)]
mod tests_ecritures {
    use super::tests::arbre;
    use super::*;
    use crate::config::arbre::tests::reglages;
    use crate::config::doubles::MagasinSync;

    fn id(valeur: &str) -> ConnectionId {
        ConnectionId::brut(valeur)
    }

    fn nouvelle<'a>(dossier: Option<&'a FolderId>, secret: Option<&'a Secret>) -> NouvelleBase<'a> {
        NouvelleBase {
            id: id("neuve"),
            dossier,
            name: "  ",
            engine: Engine::MongoDb,
            variant: reglages(false),
            password: secret,
            label: Some("  "),
        }
    }

    // --- Déclarer ---

    #[test]
    fn une_connexion_declaree_range_son_secret_sous_son_identifiant() {
        let mut courant = arbre();
        let magasin = MagasinSync::default();
        let prod = FolderId::brut("prod");
        let secret = Secret::new("s3cret");
        enregistrer(
            &mut courant,
            nouvelle(Some(&prod), Some(&secret)),
            &magasin,
            &mut |_| Ok(()),
        )
        .expect("enregistrement");

        let (neuve, ancetres) = courant.connexion(&id("neuve")).expect("déclarée");
        assert_eq!(ancetres.last().map(|d| d.id.as_str()), Some("prod"));
        // Un nom vide prend l'abréviation du moteur ; un libellé blanc vaut absent.
        assert_eq!(neuve.name, "mongo");
        assert_eq!(neuve.label, None);
        assert_eq!(neuve.visible_schemas, None);
        assert_eq!(
            neuve.connection.password,
            Some(reference_de_connexion(&id("neuve")))
        );
        assert_eq!(magasin.valeur("connexion/neuve").as_deref(), Some("s3cret"));
    }

    #[test]
    fn une_configuration_qui_echoue_reprend_le_secret_et_laisse_l_arbre() {
        let mut courant = arbre();
        let avant = courant.clone();
        let magasin = MagasinSync::default();
        let secret = Secret::new("s3cret");
        let erreur = enregistrer(
            &mut courant,
            nouvelle(None, Some(&secret)),
            &magasin,
            &mut |_| Err("disque plein".into()),
        )
        .unwrap_err();
        assert!(matches!(
            erreur,
            SaveError::Config {
                secret_repris: true,
                ..
            }
        ));
        assert_eq!(courant, avant);
        assert!(magasin.references().is_empty());
    }

    #[test]
    fn un_magasin_en_panne_n_ecrit_pas_la_configuration() {
        let mut courant = arbre();
        let magasin = MagasinSync {
            refuse_d_ecrire: true,
            ..MagasinSync::default()
        };
        let secret = Secret::new("s3cret");
        let mut ecrit = false;
        let erreur = enregistrer(
            &mut courant,
            nouvelle(None, Some(&secret)),
            &magasin,
            &mut |_| {
                ecrit = true;
                Ok(())
            },
        )
        .unwrap_err();
        assert!(matches!(erreur, SaveError::Secret(_)));
        assert!(!ecrit);
    }

    #[test]
    fn un_identifiant_deja_pris_ou_un_dossier_inconnu_est_refuse_sans_rien_toucher() {
        let magasin = MagasinSync::default();
        let secret = Secret::new("s3cret");
        let mut courant = arbre();
        let mut doublon = nouvelle(None, Some(&secret));
        doublon.id = id("a");
        assert!(matches!(
            enregistrer(&mut courant, doublon, &magasin, &mut |_| Ok(())),
            Err(SaveError::Arbre(ArbreError::ConnexionEnDouble { .. }))
        ));
        let absent = FolderId::brut("absent");
        assert!(matches!(
            enregistrer(
                &mut courant,
                nouvelle(Some(&absent), Some(&secret)),
                &magasin,
                &mut |_| Ok(())
            ),
            Err(SaveError::DossierInconnu { .. })
        ));
        assert_eq!(magasin.appels(), 0, "refusé avant de toucher au magasin");
    }

    // --- Modifier ---

    #[test]
    fn modifier_sans_mot_de_passe_laisse_le_secret_et_la_reference() {
        let mut courant = arbre();
        let magasin = MagasinSync::default();
        let mut reglages = reglages(true);
        reglages.port = 6543;
        mettre_a_jour(
            &mut courant,
            Modification {
                connection: &id("a"),
                reglages: &reglages,
                password: None,
                label: Some("Catalogue"),
            },
            &magasin,
            &mut |_| Ok(()),
        )
        .expect("modification");
        let (a, _) = courant.connexion(&id("a")).unwrap();
        assert_eq!(a.connection.port, 6543);
        assert_eq!(
            a.connection.password,
            Some(reference_de_connexion(&id("a")))
        );
        assert_eq!(a.label.as_deref(), Some("Catalogue"));
        assert_eq!(magasin.appels(), 0);
    }

    #[test]
    fn modifier_les_reglages_garde_la_couleur_et_l_icone() {
        // #179 : `A2` ne porte ni la couleur ni l'icône. Un « Enregistrer » qui reconstruirait la
        // connexion depuis le formulaire les effacerait — la modification mute en place, et ce test
        // le garde.
        let mut courant = recolorier_connexion(&arbre(), &id("a"), Some(FolderColor::Violet))
            .and_then(|apres| regler_l_icone_de_la_connexion(&apres, &id("a"), Some("rocket")))
            .expect("apparence");
        let mut reglages = reglages(true);
        reglages.port = 6543;
        mettre_a_jour(
            &mut courant,
            Modification {
                connection: &id("a"),
                reglages: &reglages,
                password: None,
                label: None,
            },
            &MagasinSync::default(),
            &mut |_| Ok(()),
        )
        .expect("modification");
        let (a, _) = courant.connexion(&id("a")).unwrap();
        assert_eq!(a.connection.port, 6543, "la modification a bien eu lieu");
        assert_eq!(a.color, Some(FolderColor::Violet));
        assert_eq!(a.icon.as_deref(), Some("rocket"));
    }

    #[test]
    fn un_mot_de_passe_ajoute_pose_la_reference_de_l_identifiant() {
        let mut courant = arbre();
        let magasin = MagasinSync::default();
        let secret = Secret::new("neuf");
        mettre_a_jour(
            &mut courant,
            Modification {
                connection: &id("b"),
                reglages: &reglages(false),
                password: Some(&secret),
                label: None,
            },
            &magasin,
            &mut |_| Ok(()),
        )
        .expect("modification");
        let (b, _) = courant.connexion(&id("b")).unwrap();
        assert_eq!(
            b.connection.password,
            Some(reference_de_connexion(&id("b")))
        );
        assert_eq!(magasin.valeur("connexion/b").as_deref(), Some("neuf"));
    }

    #[test]
    fn modifier_une_connexion_inconnue_ne_cree_rien() {
        let mut courant = arbre();
        assert!(matches!(
            mettre_a_jour(
                &mut courant,
                Modification {
                    connection: &id("absente"),
                    reglages: &reglages(false),
                    password: None,
                    label: None,
                },
                &MagasinSync::default(),
                &mut |_| Ok(()),
            ),
            Err(SaveError::ConnexionInconnue { .. })
        ));
        assert_eq!(courant, arbre());
    }

    // --- Retirer ---

    #[test]
    fn retirer_un_dossier_retire_son_sous_arbre_et_les_secrets() {
        let magasin = MagasinSync::default();
        magasin.poser("connexion/a", "mdp");
        let suppression =
            supprimer_dossier(&arbre(), &FolderId::brut("nord"), &magasin, &mut |_| Ok(()))
                .expect("retrait");
        assert!(suppression.arbre.folders.is_empty());
        assert_eq!(suppression.connexions, vec![id("a")]);
        assert!(suppression.secrets_residuels.is_empty());
        assert!(magasin.references().is_empty());
        // La racine n'est pas touchée.
        assert_eq!(suppression.arbre.connections.len(), 1);
    }

    #[test]
    fn une_ecriture_impossible_laisse_le_mot_de_passe() {
        // La configuration d'abord, les secrets ensuite : un échec d'écriture ne laisse pas une
        // connexion déclarée sans son mot de passe.
        let magasin = MagasinSync::default();
        magasin.poser("connexion/a", "mdp");
        assert!(matches!(
            supprimer_base(&arbre(), &id("a"), &magasin, &mut |_| Err(
                "disque plein".into()
            )),
            Err(DeleteError::Config { .. })
        ));
        assert_eq!(magasin.valeur("connexion/a").as_deref(), Some("mdp"));
    }

    #[test]
    fn un_secret_qui_resiste_est_dit_sans_empecher_le_retrait() {
        let magasin = MagasinSync {
            refuse_de_supprimer: true,
            ..MagasinSync::default()
        };
        let suppression =
            supprimer_base(&arbre(), &id("a"), &magasin, &mut |_| Ok(())).expect("retrait");
        assert_eq!(
            suppression.secrets_residuels,
            vec!["connexion/a".to_owned()]
        );
        assert!(suppression.arbre.connexion(&id("a")).is_none());
        // Une connexion à la racine se retire aussi, et sans mot de passe rien n'est à effacer.
        let racine =
            supprimer_base(&arbre(), &id("b"), &magasin, &mut |_| Ok(())).expect("retrait");
        assert!(racine.arbre.connections.is_empty());
        assert!(racine.secrets_residuels.is_empty());
    }

    // --- Consoles, schémas, libellés ---

    #[test]
    fn les_consoles_se_creent_s_ecrivent_se_renomment_et_se_retirent() {
        let courant = ajouter_console(&arbre(), &id("a"), "console 2").expect("création");
        assert_eq!(
            ajouter_console(&courant, &id("a"), "console 2").unwrap_err(),
            EditError::ConsoleDeja {
                nom: "console 2".into()
            }
        );
        let courant =
            enregistrer_sql_de_console(&courant, &id("a"), "console 2", "select 2").expect("sql");
        let courant =
            renommer_console(&courant, &id("a"), "console 2", "revue").expect("renommage");
        let (a, _) = courant.connexion(&id("a")).unwrap();
        assert_eq!(a.consoles[1].name, "revue");
        assert_eq!(a.consoles[1].sql, "select 2");
        let courant = retirer_console(&courant, &id("a"), "revue").expect("retrait");
        assert_eq!(courant.connexion(&id("a")).unwrap().0.consoles.len(), 1);
        assert!(matches!(
            ajouter_console(&courant, &id("absente"), "x"),
            Err(EditError::ConnexionInconnue { .. })
        ));
    }

    #[test]
    fn tout_decocher_s_ecrit_et_ne_vaut_pas_jamais_regle() {
        let courant = regler_les_schemas_affiches(&arbre(), &id("a"), Vec::new()).expect("réglage");
        assert_eq!(
            courant.connexion(&id("a")).unwrap().0.visible_schemas,
            Some(Vec::new())
        );
    }

    fn libelles(paires: &[(&str, &str)]) -> BTreeMap<String, String> {
        paires
            .iter()
            .map(|(cle, valeur)| ((*cle).to_owned(), (*valeur).to_owned()))
            .collect()
    }

    #[test]
    fn les_libelles_vont_au_dossier_racine_sans_declaration_existante() {
        let courant = regler_les_libelles_de_valeurs(
            &arbre(),
            &id("a"),
            "orders",
            "status",
            libelles(&[("1", "payée")]),
        )
        .expect("réglage");
        assert!(courant
            .dossier(&FolderId::brut("nord"))
            .unwrap()
            .value_labels
            .contains_key("orders"));
        assert_eq!(
            courant
                .libelles_de(&id("a"), "orders")
                .and_then(|c| c.get("status"))
                .and_then(|l| l.get("1"))
                .map(String::as_str),
            Some("payée"),
            "écrit là où la lecture le prend"
        );
    }

    #[test]
    fn les_libelles_vont_au_dossier_qui_fournit_deja_la_table() {
        // `prod` redéclare `orders` : c'est lui qui la fournit à `a`, donc lui qui reçoit — écrire à
        // la racine ferait un réglage qui ne se voit pas. Sabotage vérifié : écrire toujours à la
        // racine fait tomber ce test.
        let mut avant = arbre();
        avant
            .dossier_mut(&FolderId::brut("prod"))
            .unwrap()
            .value_labels
            .insert("orders".into(), BTreeMap::new());
        let courant = regler_les_libelles_de_valeurs(
            &avant,
            &id("a"),
            "orders",
            "kind",
            libelles(&[("2", "retour")]),
        )
        .expect("réglage");
        assert!(courant
            .dossier(&FolderId::brut("nord"))
            .unwrap()
            .value_labels
            .is_empty());
        assert!(courant
            .dossier(&FolderId::brut("prod"))
            .unwrap()
            .value_labels["orders"]
            .contains_key("kind"));
    }

    #[test]
    fn vider_retire_la_declaration_et_une_connexion_a_la_racine_est_refusee() {
        let courant = regler_les_libelles_de_valeurs(
            &arbre(),
            &id("a"),
            "orders",
            "status",
            libelles(&[("1", "payée")]),
        )
        .unwrap();
        let courant =
            regler_les_libelles_de_valeurs(&courant, &id("a"), "orders", "status", BTreeMap::new())
                .unwrap();
        assert!(courant
            .dossier(&FolderId::brut("nord"))
            .unwrap()
            .value_labels
            .is_empty());
        assert_eq!(
            regler_les_libelles_de_valeurs(&arbre(), &id("b"), "t", "c", libelles(&[("1", "x")]))
                .unwrap_err(),
            EditError::ConnexionALaRacine {
                connection: id("b")
            }
        );
    }

    #[test]
    fn les_requetes_en_transit_rejoignent_la_premiere_connexion_du_sous_arbre() {
        let mut courant = arbre();
        courant.folders[0].queries = vec![crate::config::SavedQuery {
            name: "console 1".into(),
            sql: "select 42".into(),
        }];
        migrer_requetes_en_consoles(&mut courant);
        assert!(courant.folders[0].queries.is_empty());
        let consoles = &courant.connexion(&id("a")).unwrap().0.consoles;
        assert_eq!(consoles[1].name, "console 1 (reprise)");
        assert_eq!(consoles[1].sql, "select 42");

        // Sans connexion dans le sous-arbre, elles attendent.
        let mut vide = FolderTree {
            folders: vec![crate::config::arbre::tests::dossier("seul", "Seul", false)],
            connections: Vec::new(),
        };
        vide.folders[0].queries = courant.folders[0].queries.clone();
        vide.folders[0].queries.push(crate::config::SavedQuery {
            name: "q".into(),
            sql: "select 1".into(),
        });
        migrer_requetes_en_consoles(&mut vide);
        assert_eq!(vide.folders[0].queries.len(), 1);
    }
}
