//! Le mode de transaction d'une console, et ce que sa transaction contient (`API-38`).
//!
//! # Chaque console a sa transaction, donc sa session
//!
//! Une transaction est un état de **session** : deux consoles qui partagent une session partagent
//! sa transaction, quoi qu'en dise l'écran. Un `BEGIN` posé depuis l'une engloberait ce que l'autre
//! exécute — et une console réglée « auto » participerait **en silence** à la transaction de sa
//! voisine, jusqu'à ce qu'un `commit` qu'elle n'a pas demandé valide ce qu'elle a écrit.
//!
//! C'est pourquoi une console qui passe en mode manuel reçoit **sa propre session** : le registre
//! en ouvre une pour elle, à côté de celle de la connexion, et sa transaction y vit seule. Voir
//! `ConnectionRegistry::assurer_la_session` — c'est là que tient tout ce qui suit.
//!
//! # Ce qu'une session par console rend vrai
//!
//! - le journal ci-dessous est **celui d'une console**, entier : la place d'une instruction dans la
//!   liste est son rang dans la transaction, et il n'y a rien de plus à dire sur ce qu'un `commit`
//!   emporte ;
//! - une console en `auto` n'entre dans aucune transaction, même si sa voisine en tient une : ses
//!   requêtes partent sur la session de la connexion, qui n'a pas de `BEGIN` ;
//! - et ce qu'une transaction retient n'est visible que d'elle. La grille de `A5`, l'arbre et les
//!   autres consoles lisent la session de la connexion : ils ne voient pas les lignes qu'une
//!   transaction ouverte a écrites. C'est l'isolation que le serveur promet, et c'est le prix — la
//!   contrepartie de « les transactions ne sont pas partagées ».

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

/// L'état de la transaction **d'une console**, tel que son panneau l'affiche.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub struct TransactionState {
    /// Vrai quand cette console tient une transaction ouverte.
    ///
    /// **Distinct d'un journal non vide**, et les deux cas existent : une transaction s'ouvre avant
    /// sa première instruction, et une instruction refusée la laisse ouverte — donc à annuler.
    ///
    /// Il ne dit **rien des autres consoles** : chacune a sa session, donc sa réponse. C'est ce qui
    /// a fait disparaître la notion de « transaction étrangère » qu'une session partagée imposait.
    pub open: bool,
    /// Les instructions de cette transaction, dans l'ordre où elles ont été jouées.
    ///
    /// **Entier, et non filtré** : le journal est celui d'une console, puisque la session l'est.
    /// La place d'une instruction dans cette liste est donc son rang dans la transaction — c'est
    /// l'adresse que `transaction_result` attend, et elle n'a pas à voyager à part.
    pub statements: Vec<TransactionStatement>,
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
