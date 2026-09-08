//! Le modèle de structure introspectée.
//!
//! Chaque champ correspond à une colonne qu'un écran du handoff affiche. Tout champ dont
//! aucun écran n'a besoin est absent, délibérément.
//!
//! **Les horodatages sont des chaînes.** Rien ne calcule sur eux : `A4` affiche un
//! « dernier ANALYZE », `A5` une valeur de cellule, et le formatage appartient à l'écran,
//! qui seul connaît la locale. Ajouter une dépendance de dates pour reformater ce que la
//! base rend déjà serait sans emploi.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Les entiers larges sont projetés en `number`, pas en `bigint`.
//
// `ts-rs` choisit `bigint` pour `i64`/`u64`, ce qui est juste sur le papier : la plage
// dépasse l'entier sûr de JavaScript. Mais l'IPC de Tauri sérialise en **JSON**, et
// `JSON.parse` rend un `number` — jamais un `bigint`. Le type annoncé serait donc faux au
// moment de l'exécution, et le front planterait sur une comparaison de types.
//
// Les valeurs concernées — comptages de lignes, tailles d'objets, décalages de pagination —
// restent très en dessous de 2^53 (neuf millions de milliards). `number` est donc exact
// pour ce domaine, et honnête sur ce que le runtime livre réellement.

/// Un comptage de lignes, avec sa fiabilité.
///
/// `A4` affiche « 1.9 M » — une estimation que le planificateur maintient à coût nul.
/// `A9` affiche « 1 904 220 » — un compte exact, qui exige un parcours complet. Sans la
/// distinction, l'écran ne saurait pas s'il montre une valeur sûre, et la colonne
/// « Dernier ANALYZE » de `A4` n'aurait aucun sens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "engine.ts")]
pub enum RowCount {
    Estimated {
        #[ts(type = "number")]
        value: i64,
    },
    Exact {
        #[ts(type = "number")]
        value: i64,
    },
    /// **Le planificateur ne sait pas**, et ce n'est pas zéro.
    ///
    /// `pg_class.reltuples` vaut `-1` pour une relation jamais analysée — une table fraîchement
    /// créée, une vue, une base restaurée sans `ANALYZE`. Le traduire en `0` faisait afficher
    /// « 0 ligne » sur des tables pleines : constaté à l'usage le 10 août 2026, sur une base
    /// réelle dont **toutes** les tables paraissaient vides.
    ///
    /// Une troisième variante et non un `Option<i64>` dans `Estimated` : « estimé à rien » et
    /// « pas d'estimation » sont deux faits distincts, et c'est précisément leur confusion qui a
    /// produit le défaut.
    Unknown,
}

impl RowCount {
    /// La valeur, ou `None` quand il n'y en a pas.
    ///
    /// **`Option` et non `0`** : rendre zéro pour « inconnu » ramènerait le mensonge que
    /// `Unknown` existe pour éviter, un cran plus loin.
    pub fn value(self) -> Option<i64> {
        match self {
            Self::Estimated { value } | Self::Exact { value } => Some(value),
            Self::Unknown => None,
        }
    }

    pub fn is_exact(self) -> bool {
        matches!(self, Self::Exact { .. })
    }
}

/// La catégorie d'un type de colonne, indépendante du moteur.
///
/// `A5` affiche un glyphe par catégorie (`T`, `#`, `⏱`, `{}`, `ID`) et aligne les nombres
/// et les dates différemment. Dériver la catégorie dans l'écran obligerait chaque écran à
/// connaître les types de sept moteurs ; c'est donc l'adaptateur qui la détermine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum TypeCategory {
    Text,
    Number,
    Timestamp,
    Json,
    Uuid,
    Boolean,
    Binary,
    /// Tout ce qui n'entre dans aucune catégorie : le glyphe retombe sur le texte.
    Other,
}

impl TypeCategory {
    /// Les glyphes relevés dans la sidebar de `A5`.
    pub fn glyphe(self) -> &'static str {
        match self {
            Self::Text | Self::Other => "T",
            Self::Number => "#",
            Self::Timestamp => "⏱",
            Self::Json => "{}",
            Self::Uuid => "ID",
            Self::Boolean => "?",
            Self::Binary => "▤",
        }
    }

    pub fn toutes() -> [Self; 8] {
        [
            Self::Text,
            Self::Number,
            Self::Timestamp,
            Self::Json,
            Self::Uuid,
            Self::Boolean,
            Self::Binary,
            Self::Other,
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum KeyKind {
    Primary,
    Foreign,
}

/// La nature d'un objet de schéma. Les quatre que `A4` compte dans son contrôle segmenté.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum ObjectKind {
    Table,
    View,
    Function,
    Index,
}

/// Les compteurs du contrôle segmenté de `A4` : « Tables 8 · Vues 2 · Fonctions 6 ·
/// Index 31 ».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ObjectCounts {
    pub tables: u32,
    pub views: u32,
    pub functions: u32,
    pub indexes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct SchemaInfo {
    pub name: String,
    pub counts: ObjectCounts,
    /// Le rôle propriétaire du schéma, quand le catalogue le dit (`API-33`).
    ///
    /// **Demandé au moteur plutôt que déduit** — le pendant de `RelationCardinality`, ajouté pour
    /// le diagramme : ce que le catalogue sait, on le lui demande. Rien dans un nom de schéma ne
    /// permettrait de le deviner, et le gestionnaire de schémas en fait une colonne.
    ///
    /// `None` là où la notion n'existe pas : une base MongoDB, un fichier SQLite et un jeu de
    /// données BigQuery n'ont pas de propriétaire au sens d'un rôle SQL, et MySQL n'en attache pas
    /// à une base. Un nom inventé y serait pire qu'une colonne vide.
    pub owner: Option<String>,
    /// Vrai pour un schéma du **catalogue** du moteur, que l'arbre ne montre pas de lui-même.
    ///
    /// Ils existent, donc ils ne sont pas tus : `list_schemas` les rend, **marqués**, pour que le
    /// gestionnaire de schémas les liste — repliés — et que rien n'interdise de les afficher. C'est
    /// l'écran qui les écarte, en un seul endroit (`schemasAffiches`) : l'arbre, le catalogue
    /// d'autocomplétion et le préchauffage des structures y lisent donc la même liste, et cocher un
    /// schéma de catalogue le fait paraître partout plutôt que nulle part.
    ///
    /// Faux partout ailleurs que sous PostgreSQL : les autres adaptateurs filtrent leurs bases de
    /// service à la source (`DE_SERVICE` chez MySQL, `18c` chez MongoDB), donc aucun schéma marqué
    /// ne leur parvient — et le gestionnaire ne s'ouvre que sur PostgreSQL.
    pub system: bool,
}

/// Une ligne du tableau d'objets de `A4` : « Nom, Lignes, Taille, Col., Clé primaire,
/// Dernier ANALYZE, Commentaire ».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TableSummary {
    pub name: String,
    pub kind: ObjectKind,
    pub rows: RowCount,
    /// `None` quand le moteur ne sait pas donner de taille physique.
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    pub column_count: u32,
    pub primary_key: Option<String>,
    /// Quand l'estimation de `rows` a été rafraîchie — c'est ce qui dit à quel point s'y
    /// fier. `A4` en fait une colonne.
    pub last_analyze: Option<String>,
    pub comment: Option<String>,
}

/// Une colonne, telle que `A9` la tabule et `A5` la liste.
///
/// **Pas `Eq`** depuis que `frequency` existe : un flottant ne l'est pas — `NaN` n'est égal à rien,
/// pas même à lui-même. `PartialEq` suffit à tout ce que le projet en fait (des `assert_eq!`), et
/// prétendre le contraire serait faux.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ColumnInfo {
    /// Rang, la colonne « # » de `A9`.
    pub position: u32,
    pub name: String,
    /// Le type tel que le moteur le nomme — `int8`, `bpchar`, `tstz`. `A5` l'affiche tel quel.
    pub type_name: String,
    pub category: TypeCategory,
    pub nullable: bool,
    pub default: Option<String>,
    /// `Some` quand la colonne est une identité — `GENERATED ... AS IDENTITY`.
    ///
    /// **Distinct de `default`**, qui est `NULL` pour ces colonnes : PostgreSQL ne range pas
    /// l'identité dans `pg_attrdef`. Sans ce champ, `A9` afficherait « — » dans la colonne
    /// « défaut » d'une clé primaire auto-incrémentée, ce qui la ferait lire comme une colonne
    /// à remplir soi-même.
    pub identity: Option<Identity>,
    pub key: Option<KeyKind>,
    pub comment: Option<String>,
    /// La part des documents qui portent ce champ, entre 0 et 1 — **`18d`**.
    ///
    /// `None` pour un moteur relationnel, et ce n'est pas « inconnu » : une colonne y est
    /// **déclarée**, donc elle existe pour toutes les lignes et la question ne se pose pas. `Some`
    /// n'a de sens que là où le schéma est déduit d'un échantillon.
    ///
    /// **Un champ du modèle, pas une décoration de `A8`** : `A9` peut l'afficher pour une
    /// collection sans une ligne de code propre à MongoDB, et un champ à moins de 100 % se
    /// distingue partout où les colonnes s'affichent.
    pub frequency: Option<f32>,
}

/// Les deux formes d'identité de la norme SQL, que PostgreSQL distingue.
///
/// `Always` refuse une valeur fournie par l'insertion, `ByDefault` l'accepte. La différence est
/// visible à l'écriture, donc elle est dite plutôt que fondue en un booléen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum Identity {
    Always,
    ByDefault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct IndexInfo {
    pub name: String,
    /// La définition rendue par le moteur, affichée en mono par `A9`. Jamais reconstruite
    /// à la main.
    pub definition: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ConstraintInfo {
    pub name: String,
    pub definition: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TriggerInfo {
    pub name: String,
    pub definition: String,
}

/// Une clé étrangère, dans un sens ou dans l'autre.
///
/// `A4` montre un bloc « Relations » ; `A5` un aperçu de « ligne liée ». Les deux sens
/// sont nécessaires : sortant pour suivre une référence, entrant pour savoir qui référence
/// cette table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct Relation {
    pub constraint_name: String,
    pub direction: RelationDirection,
    pub columns: Vec<String>,
    pub target_schema: String,
    pub target_table: String,
    pub target_columns: Vec<String>,
    pub cardinality: RelationCardinality,
}

/// Combien de lignes de la table qui **référence** peuvent viser une même ligne référencée.
///
/// # Pourquoi le catalogue, et pas l'écran
///
/// Le côté référencé est toujours *un* — une clé étrangère ne peut viser que des colonnes uniques.
/// Le côté qui référence est *plusieurs*, **sauf** si ses propres colonnes portent une garantie
/// d'unicité : une clé primaire, une contrainte `unique`, ou un index unique total. C'est ce seul
/// fait qui sépare un `1:1` d'un `1:n`, et il ne se lit nulle part ailleurs que dans le catalogue.
///
/// L'écran ne pouvait donc pas le déduire de ce qu'il recevait : `KeyKind` ne connaît que `primary`
/// et `foreign`, et `IndexInfo` ne porte qu'une `definition` — le texte que le moteur rend. La
/// relire en TypeScript aurait voulu dire analyser la sortie de quatre catalogues, qui ne
/// l'écrivent pas de la même façon et n'ont aucune raison de continuer à l'écrire ainsi. C'est le
/// pendant exact de la règle du DDL : ce que le moteur sait, on le lui demande.
///
/// # Deux valeurs et pas trois
///
/// Pas d'`Unknown` : les trois moteurs relationnels savent tous répondre, et un diagramme n'a rien à
/// gagner à une troisième marque que le produit ne saurait jamais produire. MongoDB ne rend aucune
/// relation, donc la question ne s'y pose pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum RelationCardinality {
    /// Les colonnes qui référencent sont uniques : **une** ligne au plus de part et d'autre.
    One,
    /// Le cas ordinaire : plusieurs lignes peuvent viser la même.
    Many,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum RelationDirection {
    /// Cette table référence une autre.
    Outgoing,
    /// Une autre table référence celle-ci.
    Incoming,
}

/// Tout ce que `A9` affiche d'une table, DDL compris.
///
/// **Pas `Eq`**, parce qu'il contient des `ColumnInfo` — voir leur documentation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TableDetail {
    pub schema: String,
    pub name: String,
    pub rows: RowCount,
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    pub comment: Option<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub triggers: Vec<TriggerInfo>,
    pub relations: Vec<Relation>,
    /// Le `CREATE TABLE` de `A9`, assemblé depuis ce que le catalogue rend déjà formaté.
    pub ddl: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_comptage_distingue_l_estimation_de_l_exact() {
        assert!(!RowCount::Estimated { value: 1_900_000 }.is_exact());
        assert!(RowCount::Exact { value: 1_904_220 }.is_exact());
        assert_eq!(
            RowCount::Exact { value: 1_904_220 }.value(),
            Some(1_904_220)
        );
        assert_eq!(
            RowCount::Estimated { value: 1_900_000 }.value(),
            Some(1_900_000)
        );
        // **« Inconnu » n'a pas de valeur, et surtout pas zéro** : rendre `0` ici ramènerait le
        // mensonge que cette variante existe pour éviter.
        assert_eq!(RowCount::Unknown.value(), None);
        assert!(!RowCount::Unknown.is_exact());
    }

    #[test]
    fn chaque_categorie_de_type_a_un_glyphe() {
        for categorie in TypeCategory::toutes() {
            assert!(
                !categorie.glyphe().is_empty(),
                "{categorie:?} sans glyphe — `A5` afficherait un vide"
            );
        }
    }

    #[test]
    fn les_glyphes_de_a5_sont_ceux_du_mockup() {
        assert_eq!(TypeCategory::Text.glyphe(), "T");
        assert_eq!(TypeCategory::Number.glyphe(), "#");
        assert_eq!(TypeCategory::Timestamp.glyphe(), "⏱");
        assert_eq!(TypeCategory::Json.glyphe(), "{}");
        assert_eq!(TypeCategory::Uuid.glyphe(), "ID");
    }

    #[test]
    fn un_type_inconnu_retombe_sur_le_glyphe_texte() {
        // Plutôt qu'un glyphe « inconnu » qu'aucun mockup ne montre.
        assert_eq!(TypeCategory::Other.glyphe(), TypeCategory::Text.glyphe());
    }
}
