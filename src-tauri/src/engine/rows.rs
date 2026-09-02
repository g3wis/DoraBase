//! Requête de lignes et fenêtre de résultat.
//!
//! C'est ici que la contrainte transverse du projet devient un **type** plutôt qu'une
//! recommandation : `AGENTS.md` pose qu'aucun jeu de résultats complet ne traverse
//! l'IPC. Une recommandation se contourne ; `RowLimit` étant une énumération fermée,
//! « demander tout » n'est pas exprimable.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::introspection::RowCount;

/// Les paliers de `LIMIT` du stepper de `A5` : 100 / 500 / 1000 / 5000.
///
/// Une énumération, **pas un `u32`** : c'est ce qui empêche un appelant de demander cinq
/// millions de lignes, et donc ce qui rend la contrainte IPC vérifiable par le compilateur
/// au lieu de reposer sur la discipline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum RowLimit {
    OneHundred,
    FiveHundred,
    OneThousand,
    FiveThousand,
}

impl RowLimit {
    pub fn value(self) -> u32 {
        match self {
            Self::OneHundred => 100,
            Self::FiveHundred => 500,
            Self::OneThousand => 1000,
            Self::FiveThousand => 5000,
        }
    }

    pub fn tous() -> [Self; 4] {
        [
            Self::OneHundred,
            Self::FiveHundred,
            Self::OneThousand,
            Self::FiveThousand,
        ]
    }
}

/// Les neuf opérateurs du popover de `A5` : `=`, `≠`, `in`, `~`, `is null`, et les quatre
/// comparaisons `>`, `>=`, `<=`, `<` — réservées aux colonnes numériques (`TypeCategory::Number`),
/// l'écran ne les proposant que là.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum FilterOperator {
    Eq,
    Ne,
    In,
    /// Correspondance de motif — le `~` du mockup.
    Matches,
    IsNull,
    Gt,
    Gte,
    Lte,
    Lt,
}

impl FilterOperator {
    /// `is null` est le seul à ne pas prendre de valeur. Le savoir ici évite à chaque
    /// écran et à chaque adaptateur de le redécouvrir.
    pub fn prend_une_valeur(self) -> bool {
        !matches!(self, Self::IsNull)
    }

    /// Les quatre comparaisons n'ont de sens que pour une colonne numérique — `>` sur du texte
    /// trierait lexicographiquement (`"9" > "10"`), ce qui contredirait le signe affiché.
    pub fn est_une_comparaison_numerique(self) -> bool {
        matches!(self, Self::Gt | Self::Gte | Self::Lte | Self::Lt)
    }

    pub fn tous() -> [Self; 9] {
        [
            Self::Eq,
            Self::Ne,
            Self::In,
            Self::Matches,
            Self::IsNull,
            Self::Gt,
            Self::Gte,
            Self::Lte,
            Self::Lt,
        ]
    }
}

/// Un filtre par en-tête de colonne, tel que `A5` le saisit.
///
/// La valeur reste une **chaîne** : c'est ce que l'utilisateur a tapé, et c'est
/// l'adaptateur qui la lie en paramètre selon le type de la colonne. La convertir ici
/// exigerait de connaître les types de sept moteurs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct Filter {
    pub column: String,
    pub operator: FilterOperator,
    /// `None` pour `is null`.
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// Un critère de tri. `A5` en accepte plusieurs, numérotés — leur ordre dans le vecteur
/// **est** leur rang.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct SortKey {
    pub column: String,
    pub direction: SortDirection,
}

/// Une modification en attente, telle que `A6` la retient (`11a`).
///
/// **La valeur est du texte, ou `None` pour `NULL`.** C'est exactement ce que l'utilisateur a tapé :
/// inventer un type à partir de la chaîne — « 0012 est un nombre » — changerait la valeur avant même
/// de l'écrire. Le littéral produit est cité, et le moteur le convertit vers le type de la colonne.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct PendingUpdate {
    /// La valeur de la **clé primaire** de la ligne, en texte — le `WHERE` de l'`UPDATE`.
    ///
    /// Pas un rang : un rang change au moindre tri, et l'`UPDATE` frapperait une autre ligne
    /// (`11a`).
    pub key: String,
    pub column: String,
    /// La nouvelle valeur, ou `None` pour `NULL`. La distinction est l'une des rares qu'un client de
    /// bases ne doit pas brouiller : une chaîne vide n'est pas `NULL`.
    pub value: Option<String>,
    /// La valeur **attendue** dans la base — celle qui était affichée quand on a saisi.
    ///
    /// Elle entre dans le `WHERE` : entre la lecture et l'écriture, quelqu'un d'autre a pu modifier
    /// la ligne, et écrire quand même écraserait son travail en silence. Zéro ligne affectée signifie
    /// « la valeur a changé sous vos pieds », et toute la transaction est annulée.
    ///
    /// Plus faible qu'un numéro de version, et c'est ce que le schéma permet : toutes les tables n'en
    /// ont pas, et en exiger un réduirait l'édition à celles qui en ont. **Limite connue** : deux
    /// modifications successives ramenant la même valeur passeraient inaperçues.
    pub expected: Option<String>,
}

/// Une valeur saisie dans une ligne à insérer.
///
/// **Une colonne absente de la liste n'est pas une colonne nulle** : elle est laissée au défaut de
/// la base — une séquence, un `now()`, une valeur par défaut déclarée. Poser `NULL` partout ferait
/// échouer l'insertion sur la première colonne obligatoire, et volerait à la table ses défauts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct PendingInsertValue {
    pub column: String,
    /// La valeur saisie, ou `None` pour un `NULL` **demandé** — distinct d'une colonne absente.
    pub value: Option<String>,
}

/// Une ligne à insérer, telle que le bouton « + » de la barre d'outils la retient.
///
/// **Aucune clé attendue, et c'est la différence avec `PendingUpdate`** : une insertion ne vise pas
/// une ligne existante, elle n'a donc ni `WHERE` ni détection de conflit. La table peut d'ailleurs
/// n'avoir aucune clé primaire — ce qui interdit la modification mais pas l'ajout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct PendingInsert {
    /// Les colonnes saisies, dans l'ordre de la table. Vide : la ligne est faite de défauts seuls.
    pub values: Vec<PendingInsertValue>,
}

/// Une ligne **existante à supprimer**, telle que `Suppr` ou la croix au survol du numéro de ligne
/// la retiennent — un `DELETE`.
///
/// **Pas d'`expected`**, contrairement à `PendingUpdate` : une ligne n'a qu'une seule colonne qui
/// l'identifie. Zéro ligne affectée par le `DELETE` porte déjà toute la détection de conflit dont on
/// a besoin — la ligne a changé, ou disparu, depuis la lecture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct PendingDelete {
    pub key: String,
}

/// Ce qu'il faut pour prévisualiser — ou plus tard exécuter — une suite de modifications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct UpdatePlan {
    pub schema: String,
    pub table: String,
    /// La colonne qui identifie une ligne. **Fournie par l'écran**, qui la connaît par
    /// l'introspection : la redemander à la base à chaque prévisualisation coûterait un
    /// aller-retour pour une information déjà affichée.
    ///
    /// Vide quand la table n'en a pas : un plan qui ne porte que des insertions reste valide, seules
    /// les modifications et les suppressions en exigent une.
    pub key_column: String,
    pub changes: Vec<PendingUpdate>,
    /// Les lignes à ajouter. **`#[serde(default)]`** : un champ ajouté ne demande pas de cran de
    /// migration, et un plan écrit par une version antérieure reste lisible.
    #[serde(default)]
    pub inserts: Vec<PendingInsert>,
    /// Les lignes à supprimer. `#[serde(default)]`, même raison que `inserts`.
    #[serde(default)]
    pub deletes: Vec<PendingDelete>,
}

/// Le résultat d'une requête libre de la console (`12c`).
///
/// **Distinct de `RowWindow`**, qui décrit une fenêtre de lecture d'une table connue : ici les
/// colonnes ne viennent pas du catalogue mais du résultat, et il n'y a ni décalage ni total — une
/// requête arbitraire n'a pas de « page suivante » définissable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct QueryResult {
    /// Les noms des colonnes rendues, dans l'ordre.
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    /// Le SQL **réellement exécuté**, limite comprise s'il y en a une.
    ///
    /// Montré à l'écran : une requête affichée différente de celle qui a tourné serait un piège pour
    /// qui débogue — le même arbitrage que `RowWindow.sql` en `10c`.
    pub sql: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// La limite que **DoraBase** a ajoutée, quand la requête n'en portait pas.
    ///
    /// **Annoncée, jamais silencieuse.** Une limite tue ferait croire à une table de mille lignes —
    /// un mensonge sur les données, la pire catégorie de défaut pour cet outil.
    #[ts(type = "number | null")]
    pub applied_limit: Option<u32>,
}

/// Ce qu'une application de modifications a produit (`11d`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct ApplyOutcome {
    /// Le nombre de lignes effectivement écrites — une par modification quand tout va bien.
    #[ts(type = "number")]
    pub applied: u64,
    /// Le SQL qui **défait** ce qui vient d'être fait, à montrer et à copier.
    ///
    /// Disponible dans la session, pas persisté : `A10` en fait une préférence à 24 h, ce qui
    /// suppose de décider où le garder, sous quelle forme, et ce qu'il advient d'un patch dont la
    /// base a changé entre-temps. Trois questions qui appartiennent à `15`.
    pub inverse_sql: String,
}

/// L'intention d'une lecture, que l'adaptateur traduit en SQL paramétré.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct RowQuery {
    pub schema: String,
    pub table: String,
    pub filters: Vec<Filter>,
    pub sort: Vec<SortKey>,
    #[ts(type = "number")]
    pub offset: u64,
    /// Toujours présente, et prise dans un ensemble fermé.
    pub limit: RowLimit,
}

impl RowQuery {
    /// Le seul constructeur : il **exige** une limite. Il n'existe aucune façon de
    /// construire une requête sans en donner une.
    pub fn new(schema: impl Into<String>, table: impl Into<String>, limit: RowLimit) -> Self {
        Self {
            schema: schema.into(),
            table: table.into(),
            filters: Vec::new(),
            sort: Vec::new(),
            offset: 0,
            limit,
        }
    }
}

/// Une valeur de cellule, **typée** et non préformatée.
///
/// `A5` rend `NULL` distinctement, aligne nombres et dates en mono, et met certaines
/// colonnes en pastille. C'est donc l'écran qui formate — lui seul connaît la densité et
/// la locale. Rendre une chaîne déjà formatée lui retirerait cette décision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "engine.ts")]
pub enum Value {
    Null,
    Bool {
        value: bool,
    },
    Int {
        #[ts(type = "number")]
        value: i64,
    },
    Float {
        value: f64,
    },
    /// Un décimal **exact**, gardé en texte.
    ///
    /// `numeric` de PostgreSQL est un décimal de précision arbitraire, et `tokio-postgres` ne le
    /// lit ni en `i64` ni en `f64` : la lecture retombait sur le repli texte, que le `select` ne
    /// transtypait pas — la valeur arrivait donc en `Null`. Une colonne de montants s'affichait
    /// vide. Constaté le 10 août 2026 sur `numeric(10,2)`.
    ///
    /// **Pas un `f64`** : convertir `12345678.91` en flottant binaire perd de la précision, et
    /// c'est inacceptable pour de l'argent — le premier usage de `numeric`. Le texte exact que
    /// rend la base est ce qu'il faut afficher.
    ///
    /// Distinct de `Text` : l'écran l'aligne à **droite**, comme un nombre.
    Decimal {
        value: String,
    },
    Text {
        value: String,
    },
    /// Horodatage tel que la base le rend — voir `introspection.rs` sur l'absence de type
    /// de date.
    Timestamp {
        value: String,
    },
    Json {
        value: String,
    },
    /// Contenu binaire, rendu en base64 : l'IPC transporte du JSON.
    Binary {
        base64: String,
    },
}

/// Une fenêtre de lignes — jamais un jeu complet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct RowWindow {
    #[ts(type = "number")]
    pub offset: u64,
    pub rows: Vec<Vec<Value>>,
    /// Le total, **quand il est connu**. Optionnel délibérément : le compter exactement
    /// sur une grande table coûte un parcours complet, et `A5` affiche de toute façon le
    /// compte de la fenêtre.
    pub total: Option<RowCount>,
    /// Le SQL réellement exécuté, que `A5` montre derrière « Voir le SQL ».
    pub sql: String,
    /// Durée de la requête, pour la barre d'état de `A5` (« 41 ms »).
    pub duration_ms: u32,
}

/// Ce que le patch inverse dit des insertions — **le même texte pour les quatre moteurs**.
///
/// **Une insertion ne se défait pas automatiquement, et c'est une conclusion.** La clé de la ligne
/// écrite est décidée par la base — une séquence, un `uuid` par défaut, un `_id` — et DoraBase ne la
/// relit pas : la relire supposerait une clé primaire, que la table peut ne pas avoir. Reste le
/// `DELETE` sur les valeurs saisies, écarté parce qu'il emporterait aussi les lignes voisines
/// identiques — un patch censé défaire trois ajouts en supprimerait trente.
///
/// Alors le patch le **dit**, en tête, plutôt que d'être silencieusement incomplet : c'est le même
/// arbitrage que partout ailleurs — un refus qui se nomme vaut mieux qu'une garantie qui n'en est
/// pas une. `None` quand il n'y a rien à annoncer.
pub fn avertissement_insertions(compte: usize) -> Option<String> {
    if compte == 0 {
        return None;
    }
    Some(format!(
        "-- {compte} ligne{s} ajoutée{s} : ce patch ne les défait pas. DoraBase ne connaît pas la clé\n\
         -- que la base leur a donnée, et supprimer sur les valeurs saisies emporterait les lignes\n\
         -- voisines identiques.",
        s = if compte > 1 { "s" } else { "" }
    ))
}

/// Ce que le patch inverse dit des suppressions — le même arbitrage que pour les insertions
/// (`avertissement_insertions`), à l'envers : DoraBase n'a gardé que la **clé** de la ligne
/// supprimée, jamais le reste de ses colonnes, donc rien à réinsérer pour la restaurer.
pub fn avertissement_suppressions(compte: usize) -> Option<String> {
    if compte == 0 {
        return None;
    }
    Some(format!(
        "-- {compte} ligne{s} supprimée{s} : ce patch ne les restaure pas. DoraBase n'a gardé que\n\
         -- leur clé, pas le reste de la ligne.",
        s = if compte > 1 { "s" } else { "" }
    ))
}

/// Les deux avertissements du patch inverse, combinés — le point unique que les quatre moteurs
/// appellent, pour ne pas répéter quatre fois la logique de jonction.
pub fn avertissements(inserts: usize, deletes: usize) -> Option<String> {
    match (
        avertissement_insertions(inserts),
        avertissement_suppressions(deletes),
    ) {
        (None, None) => None,
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (Some(a), Some(b)) => Some(format!("{a}\n{b}")),
    }
}

/// Le patch inverse complet : l'avertissement des insertions, puis les instructions qui défont.
///
/// **Assemblé ici et pas dans chaque adaptateur** : le texte des instructions est propre au moteur,
/// sa mise en page ne l'est pas. Quatre copies divergeraient à la première retouche.
pub fn patch_inverse(avertissement: Option<String>, instructions: Option<String>) -> String {
    match (avertissement, instructions) {
        (None, None) => String::new(),
        (Some(texte), None) => texte,
        (None, Some(sql)) => sql,
        (Some(texte), Some(sql)) => format!("{texte}\n{sql}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_requete_de_lignes_porte_toujours_une_limite() {
        let requete = RowQuery::new("public", "orders", RowLimit::FiveHundred);
        assert_eq!(requete.limit.value(), 500);
    }

    #[test]
    fn les_paliers_de_limite_sont_ceux_du_handoff() {
        let paliers: Vec<u32> = RowLimit::tous().iter().map(|p| p.value()).collect();
        assert_eq!(paliers, vec![100, 500, 1000, 5000]);
    }

    #[test]
    fn les_neuf_operateurs_de_a5_existent() {
        assert_eq!(FilterOperator::tous().len(), 9);
    }

    #[test]
    fn seul_is_null_ne_prend_pas_de_valeur() {
        assert!(!FilterOperator::IsNull.prend_une_valeur());
        for operateur in FilterOperator::tous() {
            if operateur != FilterOperator::IsNull {
                assert!(
                    operateur.prend_une_valeur(),
                    "{operateur:?} devrait prendre une valeur"
                );
            }
        }
    }

    #[test]
    fn seules_les_quatre_comparaisons_sont_numeriques() {
        for operateur in FilterOperator::tous() {
            let attendu = matches!(
                operateur,
                FilterOperator::Gt | FilterOperator::Gte | FilterOperator::Lte | FilterOperator::Lt
            );
            assert_eq!(
                operateur.est_une_comparaison_numerique(),
                attendu,
                "{operateur:?}"
            );
        }
    }

    #[test]
    fn une_fenetre_a_un_total_optionnel() {
        let fenetre = RowWindow {
            offset: 0,
            rows: vec![],
            total: None,
            sql: "select 1".into(),
            duration_ms: 3,
        };
        assert!(fenetre.total.is_none());
    }

    #[test]
    fn une_requete_neuve_n_a_ni_filtre_ni_tri_ni_decalage() {
        let requete = RowQuery::new("public", "orders", RowLimit::OneHundred);
        assert!(requete.filters.is_empty());
        assert!(requete.sort.is_empty());
        assert_eq!(requete.offset, 0);
    }

    #[test]
    fn avertissements_rend_none_quand_les_deux_comptes_sont_nuls() {
        assert_eq!(avertissements(0, 0), None);
    }

    #[test]
    fn avertissements_combine_les_deux_textes() {
        let combine = avertissements(2, 3).expect("un avertissement attendu");
        assert!(combine.contains("2 lignes ajoutées"));
        assert!(combine.contains("3 lignes supprimées"));
    }

    #[test]
    fn avertissements_ne_rend_que_celui_qui_s_applique() {
        assert!(avertissements(1, 0).unwrap().contains("ajoutée"));
        assert!(!avertissements(1, 0).unwrap().contains("supprimée"));
        assert!(avertissements(0, 1).unwrap().contains("supprimée"));
        assert!(!avertissements(0, 1).unwrap().contains("ajoutée"));
    }
}
