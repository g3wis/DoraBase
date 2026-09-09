//! Le mode de transaction d'une console, et ce que sa transaction contient (`API-38`).
//!
//! # Le mode appartient à la connexion, pas à la console
//!
//! Le registre ne tient **qu'un** adaptateur par connexion, donc une seule session : deux consoles
//! ouvertes sur la même base écrivent dans la même. Un `BEGIN` posé depuis l'une englobe donc ce
//! que l'autre exécute, qu'elle l'ait demandé ou non — et une console réglée « auto » participerait
//! **en silence** à la transaction de sa voisine, jusqu'à ce qu'un `commit` qu'elle n'a pas demandé
//! valide ce qu'elle a écrit. Le mode est donc une propriété de la connexion, et l'écran ne propose
//! pas de le régler console par console.
//!
//! # Le journal aussi
//!
//! Pour la même raison, le panneau qui liste les instructions doit lister celles de la
//! **transaction**, pas celles d'un onglet : c'est le seul contenu qu'un `commit` emporte. Le
//! journal vit donc ici, à côté du registre, et l'écran le lit. Le tenir côté écran aurait donné à
//! chaque console une liste partielle — chacune juste sur elle-même, fausse sur ce qu'elle allait
//! valider.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Ce que la console demande à l'exécution : validation immédiate, ou transaction tenue ouverte.
///
/// **Deux valeurs, pas un booléen**, parce que les deux ont un nom que l'écran affiche et que
/// `manual` n'est pas « `auto` désactivé » : c'est un autre régime, avec son panneau et ses deux
/// issues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum TransactionMode {
    /// Chaque requête part telle quelle : c'est l'autocommit du serveur qui décide.
    Auto,
    /// La première requête ouvre une transaction, et rien n'est écrit avant sa validation.
    Manual,
}

/// Une instruction jouée dans la transaction en cours, et ce que le serveur en a dit.
///
/// **Les échecs y figurent aussi.** Une instruction refusée fait partie de ce qui s'est passé — et
/// c'est même elle qu'on cherche : PostgreSQL abandonne la transaction après une erreur, donc la
/// suite sera refusée jusqu'à l'annulation. Un journal qui ne garderait que les succès laisserait
/// chercher pourquoi plus rien ne répond.
// **`PartialEq` sans `Eq`**, comme `QueryResult` et pour la même raison : une réponse peut porter
// un flottant, et `f64` n'a pas d'égalité réflexive. Les tests comparent donc avec `assert_eq!`,
// qui n'exige que `PartialEq`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TransactionStatement {
    /// Le rang de cette instruction dans le journal de la transaction.
    ///
    /// **L'adresse que `transaction_result` attend**, et elle est **explicite** parce que l'écran
    /// n'en reçoit qu'une partie : chaque console ne voit que ses propres instructions, donc la
    /// position dans la liste reçue n'est plus le rang dans le journal. Sans ce champ, désigner la
    /// deuxième instruction de sa liste demanderait la deuxième du journal — celle d'à côté.
    #[ts(type = "number")]
    pub index: u32,
    /// Le SQL **réellement exécuté**, limite comprise — celui de `QueryResult::sql`.
    ///
    /// À l'échec, celui qui a été soumis : le moteur n'a rien rendu qui dise ce qu'il avait compris,
    /// et fabriquer la forme bornée pour l'occasion afficherait une requête qui n'a pas tourné.
    pub sql: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Les lignes rendues.
    #[ts(type = "number")]
    pub returned: u64,
    /// Les lignes touchées, quand l'instruction n'en rend pas — voir `QueryResult::affected`.
    #[ts(type = "number | null")]
    pub affected: Option<u64>,
    /// Vrai quand le cœur a **gardé** la réponse de cette instruction, donc quand l'écran peut la
    /// remettre dans sa grille.
    ///
    /// # Pourquoi un drapeau, et pas les lignes
    ///
    /// **Le journal est lu à chaque exécution** : y mettre les lignes ferait traverser l'IPC à
    /// toutes les réponses de la transaction chaque fois qu'on en ajoute une, ce qui est
    /// exactement ce que la contrainte transverse du projet interdit. Les lignes restent donc au
    /// cœur — c'est lui qui détient les résultats, depuis toujours — et l'écran en demande **une**
    /// quand on la lui désigne (`transaction_result`).
    ///
    /// Faux pour une instruction qui n'a rendu aucune ligne : un `update` n'a rien à remettre dans
    /// une grille, et son compte de lignes touchées est déjà sa réponse. C'est ce drapeau qui rend
    /// son entrée non cliquable, plutôt qu'un clic qui viderait la grille.
    pub displayable: bool,
    /// Le refus du serveur, quand l'instruction a échoué.
    #[ts(type = "string | null")]
    pub error: Option<String>,
}

/// L'état de la transaction d'une connexion, tel que le panneau l'affiche.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TransactionState {
    /// Vrai quand une transaction est ouverte sur cette connexion.
    ///
    /// **Distinct d'un journal non vide**, et les deux cas existent : une transaction s'ouvre avant
    /// sa première instruction, et une instruction refusée la laisse ouverte — donc à annuler.
    pub open: bool,
    /// Les instructions **de la console qui lit**, dans l'ordre où elles ont été jouées.
    ///
    /// # Pourquoi elles sont filtrées
    ///
    /// Une console montre ce qu'elle a fait : les requêtes d'une voisine dans son propre panneau se
    /// lisaient comme les siennes, alors qu'elle ne les a ni écrites ni vues passer. Le journal, lui,
    /// reste entier — c'est la transaction, et un `commit` l'emporte en entier.
    ///
    /// **Ce que le filtre oblige à dire ailleurs** : `foreign`, ci-dessous. Un panneau qui listerait
    /// deux instructions et un `commit` qui en emporterait quatre serait un mensonge sur ce qu'on
    /// valide, et c'est la confirmation qui le porte.
    pub statements: Vec<TransactionStatement>,
    /// Combien d'instructions **d'autres consoles** la transaction porte en plus.
    ///
    /// Zéro dans le cas ordinaire — une seule console sur la connexion. Au-delà, la confirmation de
    /// validation le dit : ce que le panneau ne montre pas, le `commit` l'emporte quand même.
    #[ts(type = "number")]
    pub foreign: u32,
    /// Vrai quand une instruction a échoué **sur un moteur qui abandonne** la transaction.
    ///
    /// # Ce que l'écran en fait, et pourquoi ce n'est pas lui qui conclut
    ///
    /// Le panneau retire alors « Valider » et ne laisse que « Annuler » : sur PostgreSQL, un
    /// `commit` après une erreur se comporte comme un `rollback` — le bouton promettrait l'inverse
    /// de ce qu'il fait, ce qui est pire qu'un bouton absent. Mais **SQLite et MySQL n'abandonnent
    /// pas** : leurs instructions précédentes restent validables, et le déduire d'un simple échec
    /// aurait retiré à ces deux-là une capacité qu'ils ont. C'est donc le moteur qui répond —
    /// `AnyEngine::transaction_abandonnee_par_une_erreur`.
    ///
    /// **Figé au moment de l'échec**, non recalculé à la lecture : c'est cette instruction-là qui a
    /// abandonné la transaction, et une reconnexion survenue depuis ne doit pas changer la réponse.
    pub aborted: bool,
}

/// Ce qu'on demande à la transaction d'une connexion.
///
/// **Un ordre plutôt que trois méthodes de contrat** : les deux moteurs qui refusent le font alors
/// en un seul endroit, et un moteur ajouté n'a qu'une méthode à écrire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrdreDeTransaction {
    Ouvrir,
    Valider,
    Annuler,
}

impl OrdreDeTransaction {
    /// L'instruction SQL correspondante, pour les trois moteurs qui la comprennent telle quelle.
    ///
    /// `begin` seul, et non `begin immediate` : celui-là est propre à SQLite, qui le pose lui-même
    /// (voir `SqliteAdapter::transaction`).
    pub fn sql(self) -> &'static str {
        match self {
            Self::Ouvrir => "BEGIN",
            Self::Valider => "COMMIT",
            Self::Annuler => "ROLLBACK",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_mode_se_serialise_dans_les_termes_de_l_ecran() {
        // L'écran garde le mode par connexion et le renvoie à chaque exécution : les deux
        // vocabulaires doivent coïncider, sans traduction intermédiaire.
        assert_eq!(
            serde_json::to_value(TransactionMode::Manual).expect("sérialisation"),
            serde_json::Value::String("manual".into())
        );
        assert_eq!(
            serde_json::to_value(TransactionMode::Auto).expect("sérialisation"),
            serde_json::Value::String("auto".into())
        );
    }

    #[test]
    fn une_transaction_au_repos_n_est_pas_ouverte() {
        // `Default` sert le cas d'une connexion fermée, ou jamais interrogée : « pas de transaction »
        // n'est pas « transaction vide », comme « jamais tentée » n'est pas « hors ligne » (`09d`).
        let etat = TransactionState::default();
        assert!(!etat.open);
        assert!(etat.statements.is_empty());
    }
}
