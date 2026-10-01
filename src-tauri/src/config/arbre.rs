//! L'arbre de dossiers (#164) : ce que la configuration décrira en v7, à la place des projets et de
//! leurs environnements.
//!
//! # Ce qui change, et pourquoi
//!
//! Un projet portait des environnements, et un environnement des connexions : deux paliers, figés,
//! dont le second était une propriété de la connexion déguisée en conteneur. Un dossier est un
//! contenant **sans limite de profondeur** : il a un nom qu'on renomme, une pastille facultative, et
//! un réglage de lecture seule qui **s'impose à tous ses descendants** — c'est ce réglage qui
//! remplace le drapeau `production` (#108).
//!
//! # L'identité ne vient plus des noms
//!
//! Le triplet `projet/base/environnement` était à la fois la clé du registre et la référence du
//! secret : renommer un projet obligeait donc à déplacer des secrets et à fermer des connexions. Une
//! connexion reçoit désormais un [`ConnectionId`] **figé à sa création**, qui ne dit rien de son
//! nom ni de son dossier — déplacer une connexion ou renommer un dossier ne touche plus au Trousseau.
//! La clé du registre et la référence du secret en dérivent par **une seule convention**
//! ([`cle_de_connexion`], [`reference_de_connexion`]).
//!
//! # Ce module est pur
//!
//! Ni lecture, ni écriture, ni horloge, ni hasard caché : la génération d'un identifiant aléatoire
//! prend son tirage en paramètre ([`ConnectionId::aleatoire`]), pour que les commandes génèrent et
//! que les tests posent des identifiants fixes.
//!
//! **Branché par #165** : `VERSION_COURANTE` vaut 7, et c'est ce modèle que le chargement rend.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use super::model::{Database, SavedQuery, SecretRef};

/// La longueur d'un identifiant engendré : seize chiffres hexadécimaux, soit 64 bits.
///
/// **Assez pour ne jamais se rencontrer, assez court pour se lire** dans un fichier de configuration
/// ou dans un journal. La collision n'est pas exclue pour autant : [`ConnectionId::aleatoire`] retire
/// un candidat déjà pris, et la dérivation de la migration ajoute un rang.
const LONGUEUR: usize = 16;

/// La longueur maximale d'un identifiant **relu** — écrit à la main, ou par une version future.
const LONGUEUR_MAXIMALE: usize = 64;

/// Vrai si `valeur` peut servir d'identifiant : `[0-9a-z-]{1,64}`.
///
/// **Le jeu de caractères est une garantie, pas une préférence.** Un identifiant entre tel quel
/// dans la clé du registre et dans la référence du secret, `connexion/<id>` : un `/` y fabriquerait
/// une clé à trois segments, qui pourrait se confondre avec autre chose. C'est l'argument de
/// `reference_de_instance`, porté par le jeu de caractères plutôt que par la discipline des appelants.
pub(crate) fn identifiant_valable(valeur: &str) -> bool {
    !valeur.is_empty()
        && valeur.len() <= LONGUEUR_MAXIMALE
        && valeur
            .bytes()
            .all(|octet| octet.is_ascii_digit() || octet.is_ascii_lowercase() || octet == b'-')
}

/// Seize chiffres hexadécimaux tirés de huit octets.
fn en_hexadecimal(octets: &[u8]) -> String {
    octets.iter().map(|octet| format!("{octet:02x}")).collect()
}

/// La dérivation **déterministe** de la migration : `hex(sha256(parties jointes par U+001F))[..16]`.
///
/// # Pourquoi déterministe, et pourquoi pas un tirage
///
/// La configuration est relue — donc migrée — à **chaque** commande tant que rien ne l'a réécrite.
/// Un tirage donnerait deux identifiants à la même connexion d'une lecture à l'autre, et la migration
/// des secrets ne serait plus rejouable. Dériver des données v6 rend la même réponse à chaque fois,
/// et fait retomber un export v6 importé sur l'identifiant que la machine d'arrivée a déjà dérivé du
/// même triplet — l'appariement par triplet de l'import d'aujourd'hui, reproduit exactement.
///
/// **U+001F** (séparateur d'unité) et non `/` : un nom de projet peut contenir un `/`, jamais ce
/// caractère de contrôle, donc `["a/b", "c"]` et `["a", "b/c"]` ne se confondent pas.
fn deriver(parties: &[&str]) -> String {
    let mut empreinte = Sha256::new();
    for (rang, partie) in parties.iter().enumerate() {
        if rang > 0 {
            empreinte.update("\u{1f}".as_bytes());
        }
        empreinte.update(partie.as_bytes());
    }
    let condense = empreinte.finalize();
    en_hexadecimal(&condense[..LONGUEUR / 2])
}

/// Dérive, puis ajoute un rang aux parties tant que le candidat est pris.
///
/// Une collision ne peut venir que d'un fichier écrit à la main — deux projets homonymes, deux bases
/// de même nom dans le même environnement —, et le rang la résout sans rien dire de plus : c'est
/// l'ordre du fichier qui décide lequel garde la dérivation nue, donc c'est encore déterministe.
fn deriver_libre(parties: &[&str], pris: impl Fn(&str) -> bool) -> String {
    let nue = deriver(parties);
    if !pris(&nue) {
        return nue;
    }
    (2u32..)
        .map(|rang| {
            let rang = rang.to_string();
            let mut avec_rang: Vec<&str> = parties.to_vec();
            avec_rang.push(&rang);
            deriver(&avec_rang)
        })
        .find(|candidat| !pris(candidat))
        .expect("la suite des rangs est infinie")
}

/// Tire un identifiant de huit octets, et recommence tant qu'il est pris.
fn tirer_libre(mut tirage: impl FnMut() -> [u8; 8], pris: impl Fn(&str) -> bool) -> String {
    loop {
        let candidat = en_hexadecimal(&tirage());
        if !pris(&candidat) {
            return candidat;
        }
    }
}

/// Le tirage de production : le générateur du fil, réamorcé depuis le système.
///
/// **Rien ne dépend de son imprévisibilité** — un identifiant n'est pas un secret —, mais c'est la
/// source que le dépôt emploie déjà (`engine/postgres/scram.rs`), et une seconde n'apporterait rien.
pub fn tirage_du_systeme() -> [u8; 8] {
    use rand::Rng as _;
    let mut octets = [0u8; 8];
    rand::rng().fill_bytes(&mut octets);
    octets
}

/// L'identifiant stable d'une connexion (#164).
///
/// **Figé à la création, jamais dérivé du nom ni du dossier** : c'est ce qui fait qu'un renommage ou
/// un déplacement ne le périme pas. Il n'a aucun sens lisible, et c'est voulu — un identifiant
/// lisible dérivé du libellé, comme `InstanceId`, ferait que deux postes créant chacun une « psql »
/// produisent le même, et l'import les prendrait pour la même connexion.
///
/// `#[ts(type = "string")]`, comme `EnvironmentId` : `ts-rs` projetterait sinon la structure et non
/// la chaîne qu'elle transporte.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[ts(type = "string")]
pub struct ConnectionId(String);

impl ConnectionId {
    /// Reprend un identifiant déjà écrit — configuration lue, décor de test. **Ne valide rien** :
    /// c'est [`FolderTree::valider`] qui refuse un identifiant hors de `[0-9a-z-]{1,64}`.
    pub fn brut(valeur: impl Into<String>) -> Self {
        Self(valeur.into())
    }

    /// Un identifiant neuf, pour une connexion qu'on crée.
    ///
    /// `tirage` rend huit octets ; les commandes passent [`tirage_du_systeme`], les tests un tirage
    /// fixe. `pris` dit si un candidat est déjà employé dans l'arbre : un candidat pris est retiré.
    pub fn aleatoire(tirage: impl FnMut() -> [u8; 8], pris: impl Fn(&str) -> bool) -> Self {
        Self(tirer_libre(tirage, pris))
    }

    /// L'identifiant que la migration v6 → v7 dérive de `parties` — voir [`deriver`].
    pub fn derive(parties: &[&str], pris: impl Fn(&str) -> bool) -> Self {
        Self(deriver_libre(parties, pris))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ConnectionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// L'identifiant stable d'un dossier (#164). Mêmes règles que [`ConnectionId`].
///
/// **Un dossier a une identité, bien qu'il s'apparie par son nom à l'import** (#169) : le déplacer,
/// le renommer ou le recolorier doit le désigner sans ambiguïté, et deux dossiers homonymes peuvent
/// vivre sous deux parents différents.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[ts(type = "string")]
pub struct FolderId(String);

impl FolderId {
    /// Reprend un identifiant déjà écrit. Ne valide rien, comme [`ConnectionId::brut`].
    pub fn brut(valeur: impl Into<String>) -> Self {
        Self(valeur.into())
    }

    /// Un identifiant neuf — voir [`ConnectionId::aleatoire`].
    pub fn aleatoire(tirage: impl FnMut() -> [u8; 8], pris: impl Fn(&str) -> bool) -> Self {
        Self(tirer_libre(tirage, pris))
    }

    /// L'identifiant que la migration v6 → v7 dérive de `parties` — voir [`deriver`].
    pub fn derive(parties: &[&str], pris: impl Fn(&str) -> bool) -> Self {
        Self(deriver_libre(parties, pris))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for FolderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// La pastille d'un dossier : les cinq jetons existants, et rien de plus.
///
/// **Anciennement `EnvironmentColor`, aux mêmes valeurs `kebab-case`** : le JSON d'une couleur
/// d'environnement v6 se relit donc tel quel en couleur de dossier, ce dont la migration dépend.
/// La raison des cinq jetons n'a pas changé — une couleur libre finirait par produire des pastilles
/// indistinguables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[serde(rename_all = "kebab-case")]
pub enum FolderColor {
    Green,
    Amber,
    Red,
    Slate,
    Violet,
}

/// Ce que les entiers d'une colonne veulent dire (`API-75`) : table, colonne, valeur, libellé.
///
/// Les trois `BTreeMap` et les clés en texte gardent les raisons écrites sur `Project::value_labels`.
pub type ValueLabels = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

/// Un dossier de l'arbre (#164).
///
/// # Les libellés de valeurs vivent ici
///
/// La migration les pose sur le dossier racine issu du projet, ce qui reproduit la sémantique
/// d'`API-75` : partagés entre dev, staging et prod. La résolution se fait **table par table**, et le
/// dossier le plus proche qui déclare la table l'emporte **entièrement** — voir
/// [`FolderTree::libelles_de`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct Folder {
    pub id: FolderId,
    /// Renommable, et **jamais une identité**.
    pub name: String,
    /// `None` : aucune pastille — la teinte par défaut de l'arbre.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<FolderColor>,
    /// La lecture seule, qui s'impose à **tous** les descendants (#108) : un sous-dossier ou une
    /// connexion ne peut pas la lever pour lui-même.
    ///
    /// **Toujours écrit**, même faux : c'est un garde-fou, et un fichier qui le tairait ne se
    /// relirait pas d'un coup d'œil.
    #[serde(default)]
    pub read_only: bool,
    /// Les sous-dossiers, **dans l'ordre déclaré** — l'ordre dev/staging/prod voulu par l'utilisateur
    /// survit à la migration, et aucun tri alphabétique ne le défait.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<Folder>,
    /// Les connexions rangées directement ici, dans l'ordre déclaré.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<Database>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub value_labels: ValueLabels,
    /// Les requêtes de `12f` encore en transit : un projet v6 sans connexion n'avait nulle part où
    /// les verser. Même règle que `Project::queries` — elles attendent la première connexion du
    /// sous-arbre.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub queries: Vec<SavedQuery>,
}

/// La racine de l'arbre : **pas un dossier**, donc ni nom, ni couleur, ni lecture seule.
///
/// **Imbriqué plutôt qu'à plat** (une liste de dossiers portant un `parent`) : un cycle ou un parent
/// mort deviennent inexprimables, l'export d'un sous-arbre est un clonage, et le fichier se lit à la
/// main. Le prix — une recherche par identifiant est un parcours — ne pèse rien à cette taille.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct FolderTree {
    #[serde(default)]
    pub folders: Vec<Folder>,
    /// Les connexions rangées à la racine, hors de tout dossier.
    #[serde(default)]
    pub connections: Vec<Database>,
}

/// La clé d'une connexion au registre : `connexion/<id>`.
///
/// **Une seule convention avec [`reference_de_connexion`]**, comme le triplet l'était : deux
/// conventions divergeraient. Deux segments, disjoints de `instance/<id>` pour la raison écrite sur
/// `reference_de_instance`.
pub fn cle_de_connexion(id: &ConnectionId) -> String {
    format!("connexion/{id}")
}

/// La référence du mot de passe d'une connexion : `connexion/<id>`.
///
/// **Dérivée de l'identifiant, donc stable** : déplacer ou renommer ne la change pas, et plus aucun
/// secret ne bouge pour cela.
pub fn reference_de_connexion(id: &ConnectionId) -> SecretRef {
    SecretRef::new(cle_de_connexion(id))
}

/// La lecture seule effective d'une connexion (#164, lue par #168).
///
/// Projetée en `EffectiveReadOnly` : c'est la forme que la fixture partagée
/// `tests/fixtures/lecture-seule.json` écrit, et que le miroir TypeScript de #168 doit rendre.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
#[ts(export_to = "config.ts", rename = "EffectiveReadOnly")]
pub enum LectureSeule {
    /// Un ou plusieurs dossiers ancêtres l'imposent, **du plus extérieur au plus proche**. Le
    /// réglage local de la connexion ne compte plus : il est figé, avec pour raison le premier.
    #[serde(rename = "imposed")]
    Imposee {
        #[serde(rename = "folders")]
        dossiers: Vec<FolderId>,
    },
    /// Aucun ancêtre ne l'impose : le réglage local de la connexion décide seul.
    #[serde(rename = "local")]
    Reglee {
        #[serde(rename = "readOnly")]
        lecture_seule: bool,
    },
}

impl LectureSeule {
    /// Vrai si la connexion est en lecture seule, quelle qu'en soit la cause.
    pub fn est_active(&self) -> bool {
        match self {
            Self::Imposee { .. } => true,
            Self::Reglee { lecture_seule } => *lecture_seule,
        }
    }
}

/// Ce qu'un dossier contient, à toute profondeur, **lui exclu**.
#[derive(Debug, Default)]
pub struct Descendance<'a> {
    pub dossiers: Vec<&'a Folder>,
    pub connexions: Vec<&'a Database>,
}

/// Les refus de [`FolderTree::valider`] — ils remplacent `ModelError` pour l'arbre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArbreError {
    /// Un identifiant vide ou hors de `[0-9a-z-]{1,64}` : il pourrait fabriquer une clé
    /// `connexion/a/b`.
    IdentifiantInvalide { id: String },
    /// Deux dossiers sous le même identifiant, **où qu'ils soient dans l'arbre**.
    DossierEnDouble { id: FolderId },
    /// Deux connexions sous le même identifiant, où qu'elles soient : la clé du registre et la
    /// référence du secret seraient partagées.
    ConnexionEnDouble { id: ConnectionId },
    /// Un dossier sans nom — ou fait de seuls espaces — ne se désigne pas dans l'arbre.
    NomDeDossierVide { id: FolderId },
    /// Deux dossiers **frères** de même nom, après `trim`. C'est la base de la fusion de #169, qui
    /// apparie les dossiers par leur nom : deux frères homonymes la rendraient ambiguë. `parent` vaut
    /// `None` à la racine.
    DossierHomonyme {
        parent: Option<FolderId>,
        name: String,
    },
    /// Une connexion déclare un mot de passe rangé ailleurs que sous `connexion/<id>`.
    ///
    /// **Le garde-fou d'une migration oubliée ou partielle** : une référence laissée sur l'ancien
    /// triplet serait lue à l'ouverture, et la connexion redemanderait son mot de passe — ou, pire,
    /// lirait celui d'une autre.
    ReferenceDeSecretIncoherente { id: ConnectionId },
}

impl std::fmt::Display for ArbreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IdentifiantInvalide { id } => write!(
                f,
                "l'identifiant « {id} » n'est pas valable : lettres minuscules, chiffres et tirets \
                 seulement"
            ),
            Self::DossierEnDouble { id } => {
                write!(f, "deux dossiers sont déclarés sous l'identifiant « {id} »")
            }
            Self::ConnexionEnDouble { id } => {
                write!(
                    f,
                    "deux connexions sont déclarées sous l'identifiant « {id} »"
                )
            }
            Self::NomDeDossierVide { id } => write!(f, "le dossier « {id} » n'a pas de nom"),
            Self::DossierHomonyme { parent: None, name } => {
                write!(f, "deux dossiers nommés « {name} » à la racine")
            }
            Self::DossierHomonyme {
                parent: Some(parent),
                name,
            } => write!(
                f,
                "deux dossiers nommés « {name} » dans le dossier « {parent} »"
            ),
            Self::ReferenceDeSecretIncoherente { id } => write!(
                f,
                "le mot de passe de la connexion « {id} » n'est pas rangé sous sa référence"
            ),
        }
    }
}

impl std::error::Error for ArbreError {}

/// Vérifie les invariants d'un niveau — la racine ou un dossier — puis descend.
fn valider_le_niveau<'a>(
    parent: Option<&FolderId>,
    dossiers: &'a [Folder],
    connexions: &'a [Database],
    dossiers_vus: &mut Vec<&'a FolderId>,
    connexions_vues: &mut Vec<&'a ConnectionId>,
) -> Result<(), ArbreError> {
    let mut noms: Vec<&str> = Vec::new();
    for dossier in dossiers {
        if !identifiant_valable(dossier.id.as_str()) {
            return Err(ArbreError::IdentifiantInvalide {
                id: dossier.id.to_string(),
            });
        }
        if dossiers_vus.contains(&&dossier.id) {
            return Err(ArbreError::DossierEnDouble {
                id: dossier.id.clone(),
            });
        }
        dossiers_vus.push(&dossier.id);

        let nom = dossier.name.trim();
        if nom.is_empty() {
            return Err(ArbreError::NomDeDossierVide {
                id: dossier.id.clone(),
            });
        }
        if noms.contains(&nom) {
            return Err(ArbreError::DossierHomonyme {
                parent: parent.cloned(),
                name: nom.to_owned(),
            });
        }
        noms.push(nom);
    }

    for connexion in connexions {
        if !identifiant_valable(connexion.id.as_str()) {
            return Err(ArbreError::IdentifiantInvalide {
                id: connexion.id.to_string(),
            });
        }
        if connexions_vues.contains(&&connexion.id) {
            return Err(ArbreError::ConnexionEnDouble {
                id: connexion.id.clone(),
            });
        }
        connexions_vues.push(&connexion.id);

        if let Some(reference) = &connexion.connection.password {
            if reference != &reference_de_connexion(&connexion.id) {
                return Err(ArbreError::ReferenceDeSecretIncoherente {
                    id: connexion.id.clone(),
                });
            }
        }
    }

    for dossier in dossiers {
        valider_le_niveau(
            Some(&dossier.id),
            &dossier.folders,
            &dossier.connections,
            dossiers_vus,
            connexions_vues,
        )?;
    }
    Ok(())
}

/// Cherche un dossier à toute profondeur, en rendant ses ancêtres (du plus extérieur au plus proche).
fn trouver_dossier<'a>(
    dossiers: &'a [Folder],
    id: &FolderId,
    ancetres: &mut Vec<&'a Folder>,
) -> Option<&'a Folder> {
    for dossier in dossiers {
        if &dossier.id == id {
            return Some(dossier);
        }
        ancetres.push(dossier);
        if let Some(trouve) = trouver_dossier(&dossier.folders, id, ancetres) {
            return Some(trouve);
        }
        ancetres.pop();
    }
    None
}

fn trouver_dossier_mut<'a>(dossiers: &'a mut [Folder], id: &FolderId) -> Option<&'a mut Folder> {
    for dossier in dossiers {
        if &dossier.id == id {
            return Some(dossier);
        }
        if let Some(trouve) = trouver_dossier_mut(&mut dossier.folders, id) {
            return Some(trouve);
        }
    }
    None
}

/// Cherche une connexion sous une liste de dossiers, en rendant ses ancêtres.
fn trouver_connexion<'a>(
    dossiers: &'a [Folder],
    id: &ConnectionId,
    ancetres: &mut Vec<&'a Folder>,
) -> Option<&'a Database> {
    for dossier in dossiers {
        ancetres.push(dossier);
        if let Some(base) = dossier.connections.iter().find(|base| &base.id == id) {
            return Some(base);
        }
        if let Some(base) = trouver_connexion(&dossier.folders, id, ancetres) {
            return Some(base);
        }
        ancetres.pop();
    }
    None
}

fn trouver_connexion_mut<'a>(
    dossiers: &'a mut [Folder],
    id: &ConnectionId,
) -> Option<&'a mut Database> {
    for dossier in dossiers {
        if let Some(base) = dossier.connections.iter_mut().find(|base| &base.id == id) {
            return Some(base);
        }
        if let Some(base) = trouver_connexion_mut(&mut dossier.folders, id) {
            return Some(base);
        }
    }
    None
}

/// Toutes les connexions sous `dossiers`, chacune avec ses ancêtres — sous-dossiers d'abord, puis
/// connexions, dans l'ordre déclaré, comme l'arbre les montre.
fn collecter<'a>(
    dossiers: &'a [Folder],
    ancetres: &mut Vec<&'a Folder>,
    sortie: &mut Vec<(&'a Database, Vec<&'a Folder>)>,
) {
    for dossier in dossiers {
        ancetres.push(dossier);
        collecter(&dossier.folders, ancetres, sortie);
        for base in &dossier.connections {
            sortie.push((base, ancetres.clone()));
        }
        ancetres.pop();
    }
}

fn descendre<'a>(dossier: &'a Folder, sortie: &mut Descendance<'a>) {
    for enfant in &dossier.folders {
        sortie.dossiers.push(enfant);
        descendre(enfant, sortie);
    }
    sortie.connexions.extend(dossier.connections.iter());
}

/// Le nom qu'une connexion affiche : son libellé s'il en a un, son nom sinon.
///
/// La même règle que l'arbre du front (`base.label?.trim() || base.name`).
pub(crate) fn nom_affiche(base: &Database) -> &str {
    base.label
        .as_deref()
        .map(str::trim)
        .filter(|libelle| !libelle.is_empty())
        .unwrap_or(&base.name)
}

impl FolderTree {
    /// Vérifie les invariants de l'arbre (#164) — ils remplacent `Project::valider`.
    ///
    /// **Le nom d'une connexion n'est pas unique dans un dossier**, et c'est un revirement de « une
    /// collision reste un refus » : il n'est plus une identité, et avec les noms par défaut (« psql »)
    /// déplacer une connexion vers un dossier qui en porte déjà une serait refusé à tout propos.
    pub fn valider(&self) -> Result<(), ArbreError> {
        let mut dossiers_vus = Vec::new();
        let mut connexions_vues = Vec::new();
        valider_le_niveau(
            None,
            &self.folders,
            &self.connections,
            &mut dossiers_vus,
            &mut connexions_vues,
        )
    }

    /// Vrai si aucun dossier ni aucune connexion n'est déclaré — l'écran `A1` s'applique alors.
    pub fn est_vide(&self) -> bool {
        self.folders.is_empty() && self.connections.is_empty()
    }

    pub fn dossier(&self, id: &FolderId) -> Option<&Folder> {
        trouver_dossier(&self.folders, id, &mut Vec::new())
    }

    pub fn dossier_mut(&mut self, id: &FolderId) -> Option<&mut Folder> {
        trouver_dossier_mut(&mut self.folders, id)
    }

    /// Les ancêtres d'un dossier, du plus extérieur au plus proche, **lui exclu**. `None` s'il n'est
    /// pas dans l'arbre ; la liste vide pour un dossier racine.
    pub fn ancetres_du_dossier(&self, id: &FolderId) -> Option<Vec<&Folder>> {
        let mut ancetres = Vec::new();
        trouver_dossier(&self.folders, id, &mut ancetres).map(|_| ancetres)
    }

    /// Une connexion et ses ancêtres, du plus extérieur au plus proche. Une connexion rangée à la
    /// racine n'en a aucun.
    pub fn connexion(&self, id: &ConnectionId) -> Option<(&Database, Vec<&Folder>)> {
        if let Some(base) = self.connections.iter().find(|base| &base.id == id) {
            return Some((base, Vec::new()));
        }
        let mut ancetres = Vec::new();
        trouver_connexion(&self.folders, id, &mut ancetres).map(|base| (base, ancetres))
    }

    pub fn connexion_mut(&mut self, id: &ConnectionId) -> Option<&mut Database> {
        if let Some(base) = self.connections.iter_mut().find(|base| &base.id == id) {
            return Some(base);
        }
        trouver_connexion_mut(&mut self.folders, id)
    }

    /// Toutes les connexions de l'arbre, chacune avec ses ancêtres : celles des dossiers d'abord,
    /// dans l'ordre où l'arbre les montre, puis celles de la racine.
    pub fn connexions(&self) -> impl Iterator<Item = (&Database, Vec<&Folder>)> {
        let mut sortie = Vec::new();
        collecter(&self.folders, &mut Vec::new(), &mut sortie);
        sortie.extend(self.connections.iter().map(|base| (base, Vec::new())));
        sortie.into_iter()
    }

    /// Ce qu'un dossier contient à toute profondeur, lui exclu — ce que le retrait d'un dossier doit
    /// fermer et effacer.
    pub fn descendants(&self, id: &FolderId) -> Option<Descendance<'_>> {
        self.dossier(id).map(|dossier| {
            let mut sortie = Descendance::default();
            descendre(dossier, &mut sortie);
            sortie
        })
    }

    /// Le chemin d'une connexion, pour les étiquettes des rapports : les noms de ses dossiers, puis
    /// le nom qu'elle affiche — « Atelier Nord › prod › analytics ».
    ///
    /// Rendu en morceaux et non joint : le séparateur est une décision d'écran.
    pub fn chemin_de(&self, id: &ConnectionId) -> Option<Vec<&str>> {
        self.connexion(id).map(|(base, ancetres)| {
            let mut chemin: Vec<&str> = ancetres.iter().map(|d| d.name.as_str()).collect();
            chemin.push(nom_affiche(base));
            chemin
        })
    }

    /// La lecture seule effective d'une connexion : **imposée** si un ancêtre au moins la déclare,
    /// **réglée** par la connexion sinon. `None` pour une connexion inconnue.
    ///
    /// **Tous les ancêtres, et non le seul parent** : la lecture seule s'impose à tous les
    /// descendants, sans exception (#108). Le sabotage qui n'en lirait que le parent est gardé par
    /// la fixture partagée.
    pub fn lecture_seule_effective(&self, id: &ConnectionId) -> Option<LectureSeule> {
        self.connexion(id).map(|(base, ancetres)| {
            let dossiers: Vec<FolderId> = ancetres
                .iter()
                .filter(|dossier| dossier.read_only)
                .map(|dossier| dossier.id.clone())
                .collect();
            if dossiers.is_empty() {
                LectureSeule::Reglee {
                    lecture_seule: base.connection.read_only,
                }
            } else {
                LectureSeule::Imposee { dossiers }
            }
        })
    }

    /// Les connexions dont la lecture seule **effective** diffère entre cet arbre et `suivant` (#168).
    ///
    /// Ce sont celles qu'un changement d'arbre doit **fermer** : leur session a été ouverte avec
    /// l'ancien réglage côté moteur, et elle ne le perdrait pas d'elle-même. Les autres gardent leur
    /// session — lever la lecture seule d'un dossier dont un sous-dossier la déclare aussi ne change
    /// rien pour les connexions de ce dernier, et les fermer coûterait une poignée de main pour rien.
    ///
    /// Une connexion absente de l'un des deux arbres n'y figure pas : un retrait ferme déjà la sienne.
    pub fn lecture_seule_changee(&self, suivant: &FolderTree) -> Vec<ConnectionId> {
        self.connexions()
            .filter_map(|(base, _)| {
                let avant = self.lecture_seule_effective(&base.id)?.est_active();
                let apres = suivant.lecture_seule_effective(&base.id)?.est_active();
                (avant != apres).then(|| base.id.clone())
            })
            .collect()
    }

    /// Le refus d'**écrire** sur une connexion, avec sa raison ; `None` quand elle est inscriptible
    /// (#168).
    ///
    /// **La lecture seule effective, jamais la `variant` envoyée par l'écran** : c'est ce que les
    /// commandes qui écrivent consultent — `apply_changes`, `create_schema`, `run_sql`, l'import de
    /// dump. Le défaut que cette fonction remplace est celui du dump d'avant #168, qui croyait le
    /// drapeau que la webview lui passait.
    ///
    /// **Le dossier nommé est le plus extérieur** qui l'impose, comme la raison que l'écran affiche
    /// sur la case figée d'`A2` et sur l'entrée « Passer en lecture seule » : c'est celui qu'il faut
    /// aller lever, et un dossier plus proche en lecture seule ne changerait rien tant qu'il l'est.
    ///
    /// Une connexion **inconnue** est refusée aussi : une écriture sur une connexion que la
    /// configuration ne déclare plus n'a aucune règle à qui obéir, et la laisser passer ferait de
    /// l'absence une permission.
    pub fn refus_d_ecrire(&self, id: &ConnectionId, geste: &str) -> Option<String> {
        match self.lecture_seule_effective(id) {
            None => Some(format!(
                "cette connexion n'est plus déclarée dans la configuration : impossible de {geste}."
            )),
            Some(LectureSeule::Imposee { dossiers }) => {
                let nom = dossiers
                    .first()
                    .and_then(|dossier| self.dossier(dossier))
                    .map(|dossier| dossier.name.as_str())
                    .unwrap_or("?");
                Some(format!(
                    "cette connexion est en lecture seule, imposée par le dossier « {nom} » : \
                     impossible de {geste}. Levez la lecture seule de ce dossier pour écrire."
                ))
            }
            Some(LectureSeule::Reglee {
                lecture_seule: true,
            }) => Some(format!(
                "cette connexion est en lecture seule : impossible de {geste}. Décochez « Lecture \
                 seule » dans ses réglages pour écrire."
            )),
            Some(LectureSeule::Reglee {
                lecture_seule: false,
            }) => None,
        }
    }

    /// Les libellés de valeurs d'une table, **tels qu'une connexion les lit**.
    ///
    /// **Table par table, et le dossier le plus proche l'emporte entièrement** : on ne fusionne pas
    /// colonne par colonne. D'abord parce qu'on rend ainsi toujours un objet existant, jamais un
    /// objet neuf — l'identité d'`AUCUN_LIBELLE` côté écran en dépend (le piège `10d`) ; ensuite
    /// parce qu'il n'y a alors aucune règle de fusion à expliquer.
    ///
    /// `None` quand aucun ancêtre ne déclare la table, et pour une connexion inconnue ou rangée à la
    /// racine — celle-là n'a nulle part où les lire.
    pub fn libelles_de(
        &self,
        id: &ConnectionId,
        table: &str,
    ) -> Option<&BTreeMap<String, BTreeMap<String, String>>> {
        let (_, ancetres) = self.connexion(id)?;
        ancetres
            .into_iter()
            .rev()
            .find_map(|dossier| dossier.value_labels.get(table))
    }

    /// Vrai si `candidat` est déjà l'identifiant d'une connexion de l'arbre.
    pub fn connexion_prise(&self, candidat: &str) -> bool {
        self.connexions()
            .any(|(base, _)| base.id.as_str() == candidat)
    }

    /// Vrai si `candidat` est déjà l'identifiant d'un dossier de l'arbre.
    pub fn dossier_pris(&self, candidat: &str) -> bool {
        fn dans(dossiers: &[Folder], candidat: &str) -> bool {
            dossiers
                .iter()
                .any(|d| d.id.as_str() == candidat || dans(&d.folders, candidat))
        }
        dans(&self.folders, candidat)
    }
}

// ---------------------------------------------------------------------------------------------------
// Déplacer (#167)
// ---------------------------------------------------------------------------------------------------

/// Les refus d'un déplacement (#167).
///
/// **Un seul d'entre eux n'est pas une faute** : [`DeplacementError::ConfirmationRequise`] est une
/// question, que la commande rend en `MoveResult::ConfirmationRequired` plutôt qu'en erreur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeplacementError {
    /// Le dossier à déplacer n'est pas dans l'arbre — un désaccord entre l'écran et le disque.
    DossierInconnu { folder: FolderId },
    /// La connexion à déplacer n'est pas dans l'arbre.
    ConnexionInconnue { connection: ConnectionId },
    /// Le dossier d'arrivée n'est pas dans l'arbre.
    DestinationInconnue { folder: FolderId },
    /// Un dossier rangé dans lui-même ou dans l'un de ses descendants : l'arbre deviendrait un cycle,
    /// que la forme imbriquée ne sait d'ailleurs pas écrire.
    DansSonPropreDescendant { folder: FolderId },
    /// Un frère d'arrivée porte déjà ce nom. **Pas de renommage automatique** : un suffixe masquerait
    /// la collision plutôt que de la dire, et la fusion de #169 apparie les dossiers par leur nom.
    DossierHomonyme {
        parent: Option<FolderId>,
        name: String,
    },
    /// Le déplacement changerait la lecture seule **effective** d'au moins une connexion, et il n'a
    /// pas été confirmé. **Dans les deux sens** : entrer sous un dossier en lecture seule comme en
    /// sortir — sortir est permis, mais confirmé et nommé (#108).
    ConfirmationRequise {
        devient_lecture_seule: Vec<ConnectionId>,
        quitte_lecture_seule: Vec<ConnectionId>,
        /// Les dossiers qui imposent ou imposaient la lecture seule, sans doublon, dans l'ordre où
        /// ils sont rencontrés — pour que l'écran les nomme.
        dossiers: Vec<FolderId>,
    },
    /// Le filet : un invariant que les refus nommés n'ont pas prévu.
    Arbre(ArbreError),
}

impl std::fmt::Display for DeplacementError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DossierInconnu { folder } => write!(f, "le dossier « {folder} » n'existe pas"),
            Self::ConnexionInconnue { connection } => {
                write!(f, "la connexion « {connection} » n'existe pas")
            }
            Self::DestinationInconnue { folder } => {
                write!(f, "le dossier d'arrivée « {folder} » n'existe pas")
            }
            Self::DansSonPropreDescendant { .. } => {
                write!(f, "un dossier ne se range pas dans lui-même ni dans ses sous-dossiers")
            }
            Self::DossierHomonyme { parent: None, name } => write!(
                f,
                "un dossier nommé « {name} » existe déjà à la racine : renommez l'un des deux avant \
                 de déplacer"
            ),
            Self::DossierHomonyme {
                parent: Some(_),
                name,
            } => write!(
                f,
                "un dossier nommé « {name} » existe déjà à cet endroit : renommez l'un des deux \
                 avant de déplacer"
            ),
            Self::ConfirmationRequise { .. } => write!(
                f,
                "ce déplacement change la lecture seule d'au moins une connexion : il doit être \
                 confirmé"
            ),
            Self::Arbre(erreur) => write!(f, "{erreur}"),
        }
    }
}

impl std::error::Error for DeplacementError {}

/// Les deux listes d'un niveau d'accueil : la racine, ou un dossier.
fn accueil_mut<'a>(
    arbre: &'a mut FolderTree,
    parent: Option<&FolderId>,
) -> Option<(&'a mut Vec<Folder>, &'a mut Vec<Database>)> {
    match parent {
        None => Some((&mut arbre.folders, &mut arbre.connections)),
        Some(id) => arbre
            .dossier_mut(id)
            .map(|dossier| (&mut dossier.folders, &mut dossier.connections)),
    }
}

/// Retire un dossier où qu'il soit, et le rend.
fn extraire_dossier(dossiers: &mut Vec<Folder>, id: &FolderId) -> Option<Folder> {
    if let Some(rang) = dossiers.iter().position(|dossier| &dossier.id == id) {
        return Some(dossiers.remove(rang));
    }
    dossiers
        .iter_mut()
        .find_map(|dossier| extraire_dossier(&mut dossier.folders, id))
}

/// Retire une connexion d'une liste de dossiers, où qu'elle soit, et la rend.
fn extraire_connexion(dossiers: &mut [Folder], id: &ConnectionId) -> Option<Database> {
    dossiers.iter_mut().find_map(|dossier| {
        if let Some(rang) = dossier.connections.iter().position(|base| &base.id == id) {
            return Some(dossier.connections.remove(rang));
        }
        extraire_connexion(&mut dossier.folders, id)
    })
}

/// Insère à `index`, **borné** à la fin : un rang trop grand veut dire « en dernier », et le refuser
/// ferait échouer un glisser-déposer sous la dernière ligne pour un compte à un près.
fn inserer<T>(liste: &mut Vec<T>, index: Option<usize>, element: T) {
    let rang = index.unwrap_or(liste.len()).min(liste.len());
    liste.insert(rang, element);
}

/// Ce qu'un changement d'arbre fait à la lecture seule effective : la question à poser, ou rien.
///
/// **La lecture seule effective, pas le drapeau des dossiers** : un dossier en lecture seule qui
/// quitte un parent en lecture seule ne change rien pour ses connexions, et une connexion réglée en
/// lecture seule pour elle-même le reste où qu'elle aille. Ce sont les connexions que
/// `lecture_seule_changee` rend — celles que la commande fermera.
fn question_de_lecture_seule(avant: &FolderTree, apres: &FolderTree) -> Option<DeplacementError> {
    let changees = avant.lecture_seule_changee(apres);
    if changees.is_empty() {
        return None;
    }
    let mut devient_lecture_seule = Vec::new();
    let mut quitte_lecture_seule = Vec::new();
    let mut dossiers: Vec<FolderId> = Vec::new();
    for id in changees {
        let devient = apres
            .lecture_seule_effective(&id)
            .is_some_and(|lecture| lecture.est_active());
        // Le dossier qui l'impose **après** pour une entrée, **avant** pour une sortie : c'est celui
        // que la phrase nomme — « imposée par « prod » », « quittera celle de « prod » ».
        let source = if devient { apres } else { avant };
        if let Some(LectureSeule::Imposee {
            dossiers: imposants,
        }) = source.lecture_seule_effective(&id)
        {
            for dossier in imposants {
                if !dossiers.contains(&dossier) {
                    dossiers.push(dossier);
                }
            }
        }
        if devient {
            devient_lecture_seule.push(id);
        } else {
            quitte_lecture_seule.push(id);
        }
    }
    Some(DeplacementError::ConfirmationRequise {
        devient_lecture_seule,
        quitte_lecture_seule,
        dossiers,
    })
}

/// Le tronc commun des deux déplacements, une fois l'arbre d'arrivée composé.
fn conclure(
    avant: &FolderTree,
    apres: FolderTree,
    confirme: bool,
) -> Result<FolderTree, DeplacementError> {
    if !confirme {
        if let Some(question) = question_de_lecture_seule(avant, &apres) {
            return Err(question);
        }
    }
    // Le filet : les refus nommés couvrent ce qu'on sait nommer.
    apres.valider().map_err(DeplacementError::Arbre)?;
    Ok(apres)
}

/// Range un dossier sous `parent` (`None` : à la racine), à la place `index` parmi ses frères
/// d'arrivée (`None` : en dernier) — ou le réordonne parmi les siens (#167).
///
/// **`index` compte les frères d'arrivée sans le dossier déplacé** : c'est la place qu'il aura, donc
/// ce qu'un dépôt entre deux lignes désigne, que le dossier vienne d'ailleurs ou de la même liste.
///
/// **Rien d'autre ne bouge** : ni l'identifiant du dossier, ni ceux de ses connexions, donc ni la clé
/// du registre, ni la référence d'un secret, ni une console. C'est ce que #165 a acheté.
pub fn deplacer_dossier(
    arbre: &FolderTree,
    dossier: &FolderId,
    parent: Option<&FolderId>,
    index: Option<usize>,
    confirme: bool,
) -> Result<FolderTree, DeplacementError> {
    let deplace = arbre
        .dossier(dossier)
        .ok_or_else(|| DeplacementError::DossierInconnu {
            folder: dossier.clone(),
        })?;
    if let Some(parent) = parent {
        // Lui-même ou un descendant : le cycle est vérifié **avant** l'existence de la destination,
        // puisqu'un descendant existe forcément.
        let dans_lui_meme = parent == dossier
            || arbre
                .descendants(dossier)
                .is_some_and(|descendance| descendance.dossiers.iter().any(|d| &d.id == parent));
        if dans_lui_meme {
            return Err(DeplacementError::DansSonPropreDescendant {
                folder: dossier.clone(),
            });
        }
        if arbre.dossier(parent).is_none() {
            return Err(DeplacementError::DestinationInconnue {
                folder: parent.clone(),
            });
        }
    }

    let nom = deplace.name.trim().to_owned();
    let mut suivant = arbre.clone();
    let extrait = extraire_dossier(&mut suivant.folders, dossier).ok_or_else(|| {
        DeplacementError::DossierInconnu {
            folder: dossier.clone(),
        }
    })?;
    let (freres, _) =
        accueil_mut(&mut suivant, parent).ok_or_else(|| DeplacementError::DestinationInconnue {
            folder: parent.cloned().unwrap_or_else(|| dossier.clone()),
        })?;
    // Le dossier déplacé est déjà sorti de la liste : réordonner parmi les siens n'est pas une
    // collision avec lui-même.
    if freres.iter().any(|frere| frere.name.trim() == nom) {
        return Err(DeplacementError::DossierHomonyme {
            parent: parent.cloned(),
            name: nom,
        });
    }
    inserer(freres, index, extrait);
    conclure(arbre, suivant, confirme)
}

/// Range une connexion dans `dossier` (`None` : à la racine), à la place `index` parmi les
/// connexions d'arrivée (`None` : en dernière) — ou la réordonne (#167).
///
/// **Pas de refus d'homonymie** : le nom d'une connexion n'est pas unique dans un dossier (voir
/// [`FolderTree::valider`]), et « psql » rejoignant un dossier qui en porte déjà une serait refusé à
/// tout propos.
pub fn deplacer_connexion(
    arbre: &FolderTree,
    connexion: &ConnectionId,
    dossier: Option<&FolderId>,
    index: Option<usize>,
    confirme: bool,
) -> Result<FolderTree, DeplacementError> {
    if arbre.connexion(connexion).is_none() {
        return Err(DeplacementError::ConnexionInconnue {
            connection: connexion.clone(),
        });
    }
    if let Some(dossier) = dossier {
        if arbre.dossier(dossier).is_none() {
            return Err(DeplacementError::DestinationInconnue {
                folder: dossier.clone(),
            });
        }
    }

    let mut suivant = arbre.clone();
    let extraite = match suivant
        .connections
        .iter()
        .position(|base| &base.id == connexion)
    {
        Some(rang) => suivant.connections.remove(rang),
        None => extraire_connexion(&mut suivant.folders, connexion).ok_or_else(|| {
            DeplacementError::ConnexionInconnue {
                connection: connexion.clone(),
            }
        })?,
    };
    let (_, bases) = accueil_mut(&mut suivant, dossier).ok_or_else(|| {
        DeplacementError::DestinationInconnue {
            folder: dossier.cloned().unwrap_or_else(|| FolderId::brut("")),
        }
    })?;
    inserer(bases, index, extraite);
    conclure(arbre, suivant, confirme)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::config::model::{ConnectionSettings, Engine, SslMode};

    pub(crate) fn reglages(lecture_seule: bool) -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".to_owned(),
            port: 5432,
            default_database: "catalogue".to_owned(),
            username: "dora".to_owned(),
            password: None,
            ssl_mode: SslMode::VerifyFull,
            ca_certificate: None,
            auth_database: None,
            read_only: lecture_seule,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    pub(crate) fn base(id: &str, lecture_seule: bool) -> Database {
        Database {
            id: ConnectionId::brut(id),
            name: format!("base-{id}"),
            label: None,
            engine: Engine::PostgreSql,
            connection: reglages(lecture_seule),
            consoles: Vec::new(),
            visible_schemas: None,
        }
    }

    pub(crate) fn dossier(id: &str, nom: &str, lecture_seule: bool) -> Folder {
        Folder {
            id: FolderId::brut(id),
            name: nom.to_owned(),
            color: None,
            read_only: lecture_seule,
            folders: Vec::new(),
            connections: Vec::new(),
            value_labels: BTreeMap::new(),
            queries: Vec::new(),
        }
    }

    /// Trois paliers : `nord` › `prod` (lecture seule) › `profond`, avec une connexion à chaque
    /// palier, une à la racine, et un dossier voisin.
    fn decor() -> FolderTree {
        let mut profond = dossier("profond", "profond", false);
        profond.connections.push(base("c-profonde", false));
        let mut prod = dossier("prod", "prod", true);
        prod.connections.push(base("c-prod", false));
        prod.folders.push(profond);
        let mut nord = dossier("nord", "Atelier Nord", false);
        nord.folders.push(prod);
        nord.connections.push(base("c-nord", true));
        let voisin = dossier("voisin", "Outils", false);
        FolderTree {
            folders: vec![nord, voisin],
            connections: vec![base("c-racine", false)],
        }
    }

    #[test]
    fn la_cle_et_la_reference_sont_une_seule_convention() {
        let id = ConnectionId::brut("8c1e4f0a9b27d315");
        assert_eq!(cle_de_connexion(&id), "connexion/8c1e4f0a9b27d315");
        assert_eq!(reference_de_connexion(&id).as_str(), cle_de_connexion(&id));
        // Disjointe de l'espace des instances, qui a lui aussi deux segments.
        assert!(!cle_de_connexion(&id).starts_with("instance/"));
    }

    #[test]
    fn la_derivation_est_deterministe_et_a_la_forme_attendue() {
        let a = deriver(&["connexion", "Atelier Nord", "prod", "analytics"]);
        let b = deriver(&["connexion", "Atelier Nord", "prod", "analytics"]);
        assert_eq!(a, b);
        assert_eq!(a.len(), LONGUEUR);
        assert!(identifiant_valable(&a));
        // Le séparateur empêche deux découpages de se confondre.
        assert_ne!(deriver(&["a/b", "c"]), deriver(&["a", "b/c"]));
        assert_ne!(deriver(&["ab", "c"]), deriver(&["a", "bc"]));
    }

    #[test]
    fn une_derivation_prise_prend_un_rang() {
        let nue = deriver(&["dossier", "Halle"]);
        let libre = deriver_libre(&["dossier", "Halle"], |candidat| candidat == nue);
        assert_ne!(libre, nue);
        assert_eq!(libre, deriver(&["dossier", "Halle", "2"]));
    }

    #[test]
    fn un_tirage_pris_est_retire() {
        let mut tirages = vec![[0u8; 8], [1u8; 8]].into_iter();
        let id = ConnectionId::aleatoire(
            || tirages.next().expect("deux tirages suffisent"),
            |candidat| candidat == "0000000000000000",
        );
        assert_eq!(id.as_str(), "0101010101010101");
    }

    #[test]
    fn le_tirage_du_systeme_rend_un_identifiant_valable() {
        let id = ConnectionId::aleatoire(tirage_du_systeme, |_| false);
        assert!(identifiant_valable(id.as_str()));
        assert_eq!(id.as_str().len(), LONGUEUR);
    }

    #[test]
    fn le_decor_est_valide() {
        assert_eq!(decor().valider(), Ok(()));
    }

    #[test]
    fn valider_refuse_un_identifiant_vide_ou_hors_du_jeu() {
        for fautif in ["", "a/b", "Majuscule", "é", &"x".repeat(65)] {
            let mut arbre = decor();
            arbre.connections[0].id = ConnectionId::brut(fautif);
            assert_eq!(
                arbre.valider(),
                Err(ArbreError::IdentifiantInvalide {
                    id: fautif.to_owned()
                }),
                "{fautif:?}"
            );
        }
        let mut arbre = decor();
        arbre.folders[1].id = FolderId::brut("a b");
        assert!(matches!(
            arbre.valider(),
            Err(ArbreError::IdentifiantInvalide { .. })
        ));
        // La borne haute est incluse.
        let mut arbre = decor();
        arbre.connections[0].id = ConnectionId::brut("x".repeat(64));
        assert_eq!(arbre.valider(), Ok(()));
    }

    #[test]
    fn valider_refuse_deux_dossiers_de_meme_identifiant_a_toute_profondeur() {
        let mut arbre = decor();
        // Le voisin reprend l'identifiant d'un dossier enfoui à deux paliers : l'unicité vaut sur
        // tout l'arbre, pas entre frères.
        arbre.folders[1].id = FolderId::brut("profond");
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::DossierEnDouble {
                id: FolderId::brut("profond")
            })
        );
    }

    #[test]
    fn valider_refuse_deux_connexions_de_meme_identifiant_a_toute_profondeur() {
        let mut arbre = decor();
        arbre.connections[0].id = ConnectionId::brut("c-profonde");
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::ConnexionEnDouble {
                id: ConnectionId::brut("c-profonde")
            })
        );
    }

    #[test]
    fn valider_refuse_un_dossier_sans_nom() {
        let mut arbre = decor();
        arbre.folders[0].folders[0].name = "   ".to_owned();
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::NomDeDossierVide {
                id: FolderId::brut("prod")
            })
        );
    }

    #[test]
    fn valider_refuse_deux_freres_homonymes_apres_trim() {
        let mut arbre = decor();
        arbre.folders[1].name = " Atelier Nord ".to_owned();
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::DossierHomonyme {
                parent: None,
                name: "Atelier Nord".to_owned()
            })
        );

        let mut arbre = decor();
        arbre.folders[0]
            .folders
            .push(dossier("prod-bis", "prod", false));
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::DossierHomonyme {
                parent: Some(FolderId::brut("nord")),
                name: "prod".to_owned()
            })
        );
    }

    #[test]
    fn deux_cousins_homonymes_sont_permis() {
        let mut arbre = decor();
        arbre.folders[1]
            .folders
            .push(dossier("prod-2", "prod", false));
        assert_eq!(arbre.valider(), Ok(()));
    }

    #[test]
    fn deux_connexions_homonymes_dans_un_dossier_sont_permises() {
        let mut arbre = decor();
        let mut seconde = base("c-nord-2", false);
        seconde.name = arbre.folders[0].connections[0].name.clone();
        arbre.folders[0].connections.push(seconde);
        assert_eq!(arbre.valider(), Ok(()));
    }

    #[test]
    fn valider_refuse_une_reference_de_secret_qui_n_est_pas_la_sienne() {
        let mut arbre = decor();
        let base = &mut arbre.folders[0].folders[0].connections[0];
        base.connection.password = Some(SecretRef::new("Atelier Nord/base-c-prod/prod"));
        assert_eq!(
            arbre.valider(),
            Err(ArbreError::ReferenceDeSecretIncoherente {
                id: ConnectionId::brut("c-prod")
            })
        );
        // Contrôle positif : la bonne référence passe.
        let mut arbre = decor();
        let base = &mut arbre.folders[0].folders[0].connections[0];
        base.connection.password = Some(reference_de_connexion(&ConnectionId::brut("c-prod")));
        assert_eq!(arbre.valider(), Ok(()));
    }

    #[test]
    fn une_connexion_se_trouve_avec_ses_ancetres() {
        let arbre = decor();
        let (base, ancetres) = arbre
            .connexion(&ConnectionId::brut("c-profonde"))
            .expect("connue");
        assert_eq!(base.id.as_str(), "c-profonde");
        let ids: Vec<&str> = ancetres.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["nord", "prod", "profond"]);

        let (_, ancetres) = arbre
            .connexion(&ConnectionId::brut("c-racine"))
            .expect("connue");
        assert!(ancetres.is_empty());
        assert!(arbre.connexion(&ConnectionId::brut("inconnue")).is_none());
    }

    #[test]
    fn connexion_mut_atteint_toute_profondeur() {
        let mut arbre = decor();
        arbre
            .connexion_mut(&ConnectionId::brut("c-profonde"))
            .expect("connue")
            .name = "renommee".to_owned();
        arbre
            .connexion_mut(&ConnectionId::brut("c-racine"))
            .expect("connue")
            .name = "aussi".to_owned();
        assert_eq!(
            arbre.chemin_de(&ConnectionId::brut("c-profonde")),
            Some(vec!["Atelier Nord", "prod", "profond", "renommee"])
        );
        assert_eq!(
            arbre.chemin_de(&ConnectionId::brut("c-racine")),
            Some(vec!["aussi"])
        );
    }

    #[test]
    fn le_chemin_prefere_le_libelle_au_nom() {
        let mut arbre = decor();
        let base = arbre
            .connexion_mut(&ConnectionId::brut("c-prod"))
            .expect("connue");
        base.label = Some("Catalogue".to_owned());
        assert_eq!(
            arbre.chemin_de(&ConnectionId::brut("c-prod")),
            Some(vec!["Atelier Nord", "prod", "Catalogue"])
        );
        let base = arbre
            .connexion_mut(&ConnectionId::brut("c-prod"))
            .expect("connue");
        base.label = Some("  ".to_owned());
        assert_eq!(
            arbre.chemin_de(&ConnectionId::brut("c-prod")),
            Some(vec!["Atelier Nord", "prod", "base-c-prod"])
        );
    }

    #[test]
    fn les_connexions_se_listent_dans_l_ordre_de_l_arbre() {
        let arbre = decor();
        let ids: Vec<&str> = arbre.connexions().map(|(b, _)| b.id.as_str()).collect();
        assert_eq!(ids, ["c-profonde", "c-prod", "c-nord", "c-racine"]);
    }

    #[test]
    fn un_dossier_se_trouve_et_se_modifie_a_toute_profondeur() {
        let mut arbre = decor();
        assert_eq!(
            arbre
                .dossier(&FolderId::brut("profond"))
                .map(|d| d.name.as_str()),
            Some("profond")
        );
        arbre
            .dossier_mut(&FolderId::brut("profond"))
            .expect("connu")
            .read_only = true;
        assert!(
            arbre
                .dossier(&FolderId::brut("profond"))
                .expect("connu")
                .read_only
        );
        assert!(arbre.dossier(&FolderId::brut("inconnu")).is_none());
        let ancetres: Vec<&str> = arbre
            .ancetres_du_dossier(&FolderId::brut("profond"))
            .expect("connu")
            .iter()
            .map(|d| d.id.as_str())
            .collect();
        assert_eq!(ancetres, ["nord", "prod"]);
    }

    #[test]
    fn les_descendants_comptent_toute_la_profondeur_sans_le_dossier() {
        let arbre = decor();
        let descendance = arbre.descendants(&FolderId::brut("nord")).expect("connu");
        let dossiers: Vec<&str> = descendance.dossiers.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(dossiers, ["prod", "profond"]);
        let mut connexions: Vec<&str> = descendance
            .connexions
            .iter()
            .map(|b| b.id.as_str())
            .collect();
        connexions.sort_unstable();
        assert_eq!(connexions, ["c-nord", "c-prod", "c-profonde"]);
        assert!(arbre.descendants(&FolderId::brut("inconnu")).is_none());
    }

    #[test]
    fn la_lecture_seule_d_un_ancetre_s_impose_meme_deux_paliers_plus_haut() {
        let arbre = decor();
        // `profond` ne la déclare pas, son parent `prod` si : elle s'impose.
        assert_eq!(
            arbre.lecture_seule_effective(&ConnectionId::brut("c-profonde")),
            Some(LectureSeule::Imposee {
                dossiers: vec![FolderId::brut("prod")]
            })
        );
    }

    #[test]
    fn sans_ancetre_en_lecture_seule_le_reglage_local_decide() {
        let arbre = decor();
        assert_eq!(
            arbre.lecture_seule_effective(&ConnectionId::brut("c-nord")),
            Some(LectureSeule::Reglee {
                lecture_seule: true
            })
        );
        assert_eq!(
            arbre.lecture_seule_effective(&ConnectionId::brut("c-racine")),
            Some(LectureSeule::Reglee {
                lecture_seule: false
            })
        );
        assert_eq!(
            arbre.lecture_seule_effective(&ConnectionId::brut("inconnue")),
            None
        );
    }

    #[test]
    fn seules_les_connexions_dont_la_lecture_seule_effective_change_sont_rendues() {
        let avant = decor();
        // Lever `prod` : `c-prod` et `c-profonde` (inscriptibles localement) redeviennent
        // inscriptibles ; `c-nord` et la racine ne bougent pas.
        let mut leve = avant.clone();
        leve.dossier_mut(&FolderId::brut("prod"))
            .expect("là")
            .read_only = false;
        let mut changees: Vec<String> = avant
            .lecture_seule_changee(&leve)
            .into_iter()
            .map(|id| id.as_str().to_owned())
            .collect();
        changees.sort_unstable();
        assert_eq!(changees, ["c-prod", "c-profonde"]);

        // Poser `nord` : `c-nord` l'était déjà localement, `c-prod`/`c-profonde` par `prod` — seule
        // la racine y échappe, et rien ne change pour personne.
        let mut pose = avant.clone();
        pose.dossier_mut(&FolderId::brut("nord"))
            .expect("là")
            .read_only = true;
        assert!(avant.lecture_seule_changee(&pose).is_empty());
    }

    #[test]
    fn le_refus_d_ecrire_nomme_le_dossier_le_plus_exterieur_ou_le_reglage() {
        let mut arbre = decor();
        // `c-prod` est **inscriptible localement** : c'est le dossier qui décide (#168).
        let imposee = arbre
            .refus_d_ecrire(&ConnectionId::brut("c-prod"), "écrire")
            .expect("refusée");
        assert!(
            imposee.contains("imposée par le dossier « prod »"),
            "{imposee}"
        );
        // Deux ancêtres l'imposent : c'est le plus extérieur qu'il faut aller lever.
        arbre.folders[0].read_only = true;
        let deux = arbre
            .refus_d_ecrire(&ConnectionId::brut("c-profonde"), "écrire")
            .expect("refusée");
        assert!(deux.contains("« Atelier Nord »"), "{deux}");

        let locale = arbre
            .refus_d_ecrire(&ConnectionId::brut("c-racine"), "écrire")
            .is_none();
        assert!(locale, "la racine inscriptible écrit");
        let mut reglee = decor();
        reglee.connections[0].connection.read_only = true;
        let message = reglee
            .refus_d_ecrire(&ConnectionId::brut("c-racine"), "écrire")
            .expect("refusée par son réglage");
        assert!(message.contains("Décochez"), "{message}");
        assert!(reglee
            .refus_d_ecrire(&ConnectionId::brut("inconnue"), "écrire")
            .is_some());
    }

    #[test]
    fn les_dossiers_qui_imposent_vont_du_plus_exterieur_au_plus_proche() {
        let mut arbre = decor();
        arbre.folders[0].read_only = true;
        arbre.folders[0].folders[0].folders[0].read_only = true;
        let lecture = arbre
            .lecture_seule_effective(&ConnectionId::brut("c-profonde"))
            .expect("connue");
        assert_eq!(
            lecture,
            LectureSeule::Imposee {
                dossiers: vec![
                    FolderId::brut("nord"),
                    FolderId::brut("prod"),
                    FolderId::brut("profond")
                ]
            }
        );
        assert!(lecture.est_active());
    }

    #[test]
    fn les_libelles_viennent_du_dossier_le_plus_proche_qui_declare_la_table() {
        let mut arbre = decor();
        let libelles = |valeur: &str, libelle: &str| {
            BTreeMap::from([(
                "status".to_owned(),
                BTreeMap::from([(valeur.to_owned(), libelle.to_owned())]),
            )])
        };
        arbre.folders[0]
            .value_labels
            .insert("orders".to_owned(), libelles("1", "payée"));
        arbre.folders[0]
            .value_labels
            .insert("users".to_owned(), libelles("0", "inactif"));
        arbre.folders[0].folders[0]
            .value_labels
            .insert("orders".to_owned(), libelles("3", "expédiée"));

        let profonde = ConnectionId::brut("c-profonde");
        // `orders` : le plus proche l'emporte **entièrement** — la valeur « 1 » de la racine n'est
        // pas fusionnée.
        let orders = arbre.libelles_de(&profonde, "orders").expect("déclarée");
        assert_eq!(
            orders["status"].get("3").map(String::as_str),
            Some("expédiée")
        );
        assert!(!orders["status"].contains_key("1"));
        // Et c'est l'objet même du dossier, pas une copie.
        assert!(std::ptr::eq(
            orders,
            &arbre.folders[0].folders[0].value_labels["orders"]
        ));
        // `users` n'est déclarée qu'à la racine : elle est lue à travers deux paliers.
        assert!(arbre.libelles_de(&profonde, "users").is_some());
        assert!(arbre.libelles_de(&profonde, "absente").is_none());
        assert!(arbre
            .libelles_de(&ConnectionId::brut("c-racine"), "orders")
            .is_none());
    }

    #[test]
    fn l_arbre_se_relit_tel_qu_il_s_ecrit() {
        let arbre = decor();
        let json = serde_json::to_string(&arbre).expect("sérialisable");
        let relu: FolderTree = serde_json::from_str(&json).expect("relisible");
        assert_eq!(relu, arbre);
        // `readOnly` est toujours écrit, même faux : c'est un garde-fou.
        assert!(json.contains("\"readOnly\":false"));
    }

    #[test]
    fn la_lecture_seule_se_serialise_sous_la_forme_de_la_fixture() {
        let imposee = LectureSeule::Imposee {
            dossiers: vec![FolderId::brut("prod")],
        };
        assert_eq!(
            serde_json::to_value(&imposee).expect("sérialisable"),
            serde_json::json!({ "kind": "imposed", "folders": ["prod"] })
        );
        let reglee = LectureSeule::Reglee {
            lecture_seule: false,
        };
        assert_eq!(
            serde_json::to_value(&reglee).expect("sérialisable"),
            serde_json::json!({ "kind": "local", "readOnly": false })
        );
    }

    /// **La fixture partagée avec le miroir TypeScript de #168** : les deux implémentations de la
    /// règle doivent rendre exactement `expected`, sans quoi l'écran et le cœur divergent sur ce
    /// qu'une connexion peut écrire (règle n° 20).
    #[test]
    fn la_fixture_partagee_de_la_lecture_seule_est_tenue() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/lecture-seule.json"))
                .expect("fixture lisible");
        let arbre: FolderTree =
            serde_json::from_value(fixture["tree"].clone()).expect("arbre de la fixture");
        assert_eq!(arbre.valider(), Ok(()));

        let attendus = fixture["expected"].as_object().expect("table des attendus");
        // Contrôle positif : la fixture couvre chaque connexion de son arbre, et au moins un cas de
        // chaque sorte — sans quoi une comparaison vide passerait.
        assert_eq!(attendus.len(), arbre.connexions().count() + 1);
        let mut sortes = std::collections::BTreeSet::new();
        for (id, attendu) in attendus {
            let rendu = arbre.lecture_seule_effective(&ConnectionId::brut(id.as_str()));
            assert_eq!(
                serde_json::to_value(&rendu).expect("sérialisable"),
                *attendu,
                "connexion « {id} »"
            );
            sortes.insert(
                attendu
                    .get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("inconnue"),
            );
        }
        assert_eq!(
            sortes.into_iter().collect::<Vec<_>>(),
            ["imposed", "inconnue", "local"]
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Déplacer (#167)
    // ---------------------------------------------------------------------------------------------

    fn f(id: &str) -> FolderId {
        FolderId::brut(id)
    }

    fn c(id: &str) -> ConnectionId {
        ConnectionId::brut(id)
    }

    #[test]
    fn un_dossier_ne_se_range_ni_dans_lui_meme_ni_dans_un_descendant() {
        let arbre = decor();
        assert_eq!(
            deplacer_dossier(&arbre, &f("prod"), Some(&f("prod")), None, true),
            Err(DeplacementError::DansSonPropreDescendant { folder: f("prod") })
        );
        // Deux paliers plus bas : un parent direct ne suffirait pas à le voir.
        assert_eq!(
            deplacer_dossier(&arbre, &f("nord"), Some(&f("profond")), None, true),
            Err(DeplacementError::DansSonPropreDescendant { folder: f("nord") })
        );
        // Le contrôle positif : un voisin n'est pas un descendant.
        assert!(deplacer_dossier(&arbre, &f("nord"), Some(&f("voisin")), None, true).is_ok());
    }

    #[test]
    fn un_identifiant_inconnu_est_refuse_des_deux_bouts() {
        let arbre = decor();
        assert_eq!(
            deplacer_dossier(&arbre, &f("absent"), None, None, true),
            Err(DeplacementError::DossierInconnu {
                folder: f("absent")
            })
        );
        assert_eq!(
            deplacer_dossier(&arbre, &f("voisin"), Some(&f("absent")), None, true),
            Err(DeplacementError::DestinationInconnue {
                folder: f("absent")
            })
        );
        assert_eq!(
            deplacer_connexion(&arbre, &c("absente"), None, None, true),
            Err(DeplacementError::ConnexionInconnue {
                connection: c("absente")
            })
        );
        assert_eq!(
            deplacer_connexion(&arbre, &c("c-racine"), Some(&f("absent")), None, true),
            Err(DeplacementError::DestinationInconnue {
                folder: f("absent")
            })
        );
    }

    #[test]
    fn un_frere_homonyme_a_l_arrivee_est_refuse_sans_renommage() {
        let mut arbre = decor();
        // « profond  » avec une espace : l'homonymie se juge après `trim`, comme `valider`.
        arbre.folders[1].name = "profond  ".into();
        assert_eq!(
            deplacer_dossier(&arbre, &f("profond"), None, None, true),
            Err(DeplacementError::DossierHomonyme {
                parent: None,
                name: "profond".into()
            })
        );
        // Deux connexions homonymes, elles, sont permises : le nom n'est plus une identité.
        let mut arbre = decor();
        arbre.connections[0].name = "base-c-nord".into();
        assert!(deplacer_connexion(&arbre, &c("c-racine"), Some(&f("nord")), None, true).is_ok());
    }

    #[test]
    fn reordonner_parmi_ses_freres_n_est_pas_une_collision_avec_soi_meme() {
        let arbre = decor();
        let suivant =
            deplacer_dossier(&arbre, &f("voisin"), None, Some(0), false).expect("réordonné");
        let ordre: Vec<&str> = suivant.folders.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ordre, ["voisin", "nord"]);
        // Un rang trop grand veut dire « en dernier ».
        let suivant = deplacer_dossier(&arbre, &f("nord"), None, Some(99), false).expect("déplacé");
        let ordre: Vec<&str> = suivant.folders.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ordre, ["voisin", "nord"]);
    }

    #[test]
    fn entrer_sous_un_dossier_en_lecture_seule_demande_confirmation() {
        let arbre = decor();
        assert_eq!(
            deplacer_connexion(&arbre, &c("c-racine"), Some(&f("profond")), None, false),
            Err(DeplacementError::ConfirmationRequise {
                devient_lecture_seule: vec![c("c-racine")],
                quitte_lecture_seule: Vec::new(),
                dossiers: vec![f("prod")],
            })
        );
        let suivant =
            deplacer_connexion(&arbre, &c("c-racine"), Some(&f("profond")), Some(0), true)
                .expect("confirmé");
        let (_, ancetres) = suivant.connexion(&c("c-racine")).expect("déplacée");
        let chemin: Vec<&str> = ancetres.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(chemin, ["nord", "prod", "profond"]);
        assert!(suivant.connections.is_empty());
    }

    /// **Le test du sabotage** : ignorer `confirme` le fait tomber. Sortir est permis, mais confirmé
    /// et nommé (#108) — et c'est le dossier qu'on quitte qui est nommé.
    #[test]
    fn quitter_la_lecture_seule_sans_confirmation_est_une_question() {
        let arbre = decor();
        assert_eq!(
            deplacer_connexion(&arbre, &c("c-prod"), None, None, false),
            Err(DeplacementError::ConfirmationRequise {
                devient_lecture_seule: Vec::new(),
                quitte_lecture_seule: vec![c("c-prod")],
                dossiers: vec![f("prod")],
            })
        );
        let suivant = deplacer_connexion(&arbre, &c("c-prod"), None, None, true).expect("confirmé");
        assert_eq!(
            suivant.lecture_seule_effective(&c("c-prod")),
            Some(LectureSeule::Reglee {
                lecture_seule: false
            })
        );
    }

    #[test]
    fn un_dossier_qui_sort_de_la_lecture_seule_nomme_toutes_ses_connexions() {
        let arbre = decor();
        assert_eq!(
            deplacer_dossier(&arbre, &f("profond"), Some(&f("voisin")), None, false),
            Err(DeplacementError::ConfirmationRequise {
                devient_lecture_seule: Vec::new(),
                quitte_lecture_seule: vec![c("c-profonde")],
                dossiers: vec![f("prod")],
            })
        );
    }

    #[test]
    fn un_deplacement_qui_ne_change_aucune_lecture_seule_ne_demande_rien() {
        let arbre = decor();
        // « prod » déclare lui-même sa lecture seule : elle voyage avec lui.
        assert!(deplacer_dossier(&arbre, &f("prod"), Some(&f("voisin")), None, false).is_ok());
        // Une connexion réglée en lecture seule pour elle-même le reste sous « prod ».
        assert!(deplacer_connexion(&arbre, &c("c-nord"), Some(&f("prod")), None, false).is_ok());
    }

    #[test]
    fn deplacer_ne_touche_ni_a_l_identite_ni_au_secret_ni_aux_consoles() {
        let mut arbre = decor();
        let base = arbre.connexion_mut(&c("c-prod")).expect("connexion");
        base.connection.password = Some(reference_de_connexion(&c("c-prod")));
        base.consoles.push(crate::config::model::Console {
            name: "console 1".into(),
            sql: "select 1".into(),
        });
        let avant = arbre.connexion(&c("c-prod")).expect("connexion").0.clone();

        let suivant = deplacer_connexion(&arbre, &c("c-prod"), Some(&f("voisin")), None, true)
            .expect("déplacée");
        let (apres, ancetres) = suivant.connexion(&c("c-prod")).expect("toujours là");
        assert_eq!(apres, &avant);
        assert_eq!(ancetres.last().map(|d| d.id.as_str()), Some("voisin"));
        assert_eq!(suivant.valider(), Ok(()));
    }
}
