//! La mise à jour en place : chercher, installer, redémarrer.
//!
//! # Pourquoi tout est ici et rien dans les capacités
//!
//! Le plugin `updater` expose ses propres commandes IPC, et les brancher demanderait
//! `updater:default` — donc `allow-check`, `allow-download`, `allow-install` et
//! `allow-download-and-install` — plus `process:allow-restart` dans
//! `capabilities/default.json`. Or **les capacités ne gouvernent que les appels venant de la
//! webview** : le Rust n'en a pas besoin. Deux commandes maison rendent donc le même service
//! sans élargir la surface, et `tests/permissions.rs` reste vert sans qu'on y ait touché.
//!
//! Corollaire à ne pas perdre : le front ne sait ni télécharger ni redémarrer. Il sait
//! qu'une version existe, et il sait la demander.
//!
//! # Pourquoi `install_update` recherche à nouveau
//!
//! `check()` rend un `Update` qui porte l'URL et la signature, et c'est lui qui installe.
//! Le garder entre les deux commandes demanderait un `State` — donc un objet vivant dont la
//! durée de vie n'est bornée par rien, et qui peut désigner une release retirée depuis. Une
//! seconde recherche coûte un JSON de trois cents octets et supprime cet état ; c'est le
//! même arbitrage que le registre de connexions, en sens inverse, et pour la même raison :
//! ce qui est cher se garde, ce qui est gratuit se refait.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use ts_rs::TS;

/// Ce que la barre d'état affiche quand une version plus récente existe.
///
/// **La version courante n'y est pas** : le front la connaît déjà (`__APP_VERSION__`), et la
/// rendre ici installerait deux vérités pour une seule valeur — dont la visible pourrait être
/// la fausse le jour où le binaire et le bundle divergent.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "maj.ts")]
pub struct AvailableUpdate {
    pub version: String,
    /// Les notes de la release GitHub, telles que le manifeste les porte. `None` quand la
    /// release n'en a pas — l'écran doit tenir sans, et le dit.
    pub notes: Option<String>,
}

/// L'interrogation du manifeste, commune aux deux commandes.
///
/// Les erreurs sont **remises en chaîne** plutôt que projetées en type : aucune n'est
/// actionnable côté écran. Hors ligne, manifeste absent, signature invalide — dans les trois
/// cas la seule réponse possible est « plus tard », et un type à trois variantes ferait croire
/// à trois traitements.
///
/// **Une seule fait exception, et elle a coûté un ticket** (`API-58`). Quand le manifeste ne
/// porte pas de clef pour la plateforme courante, le plugin rend « the platform `windows-x86_64`
/// was not found in the response `platforms` object » : le nom d'une clef d'un objet JSON que
/// l'utilisateur ne verra jamais, en anglais, dans une interface qui n'en parle pas. Elle ne dit
/// ni la cause — cette version n'a rien publié pour ce système —, ni la manœuvre.
///
/// Le cas reste atteignable après `API-58`, et c'est pourquoi la phrase existe plutôt qu'un
/// commentaire : **chaque plateforme entre au manifeste par sa propre construction** (voir le
/// job `manifeste` de `publication.yml`), donc une construction qui échoue d'un côté laisse
/// l'autre publier seul. C'est voulu — un échec Windows ne doit pas coûter la release macOS —
/// et cela veut dire qu'une version peut réellement n'exister que pour un des deux systèmes.
async fn interroger(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater()
        .map_err(|erreur| format!("le mécanisme de mise à jour n'est pas configuré : {erreur}"))?
        .check()
        .await
        .map_err(traduire)
}

/// Le message rendu à l'écran pour un refus de recherche.
///
/// Le bras attrape-tout n'est pas celui de la règle n° 16 : `tauri_plugin_updater::Error` est
/// `#[non_exhaustive]`, donc il est **obligatoire** — et les vingt variantes qu'il couvre disent
/// toutes la même chose à qui regarde, « plus tard ».
fn traduire(erreur: Error) -> String {
    match erreur {
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "cette version n'a pas été \
             publiée pour votre système. Téléchargez-la depuis la page des releases de DoraBase."
            .to_string(),
        autre => format!("la recherche de mise à jour a échoué : {autre}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ce que l'utilisateur lisait avant `API-58`, et qu'il ne doit plus lire : la clef d'un
    /// objet JSON. L'assertion porte sur les deux bouts — la phrase qui remplace, et le jargon
    /// qui doit avoir disparu —, sans quoi ajouter la phrase **à côté** du message du plugin
    /// laisserait le test vert.
    #[test]
    fn une_plateforme_absente_du_manifeste_se_dit_en_francais() {
        let message = traduire(Error::TargetNotFound("windows-x86_64".into()));
        assert!(
            message.contains("n'a pas été publiée pour votre système"),
            "{message}"
        );
        assert!(message.contains("page des releases"), "{message}");
        assert!(!message.contains("platforms"), "{message}");
        assert!(!message.contains("windows-x86_64"), "{message}");
    }

    /// Et le reste garde le message du plugin : c'est le seul qui dise quelque chose d'un
    /// réseau coupé ou d'une signature refusée, et le remplacer par une phrase à nous
    /// reviendrait à réécrire un message dont on ne connaît pas la cause.
    #[test]
    fn les_autres_refus_gardent_le_mot_du_plugin() {
        let message = traduire(Error::ReleaseNotFound);
        assert!(
            message.starts_with("la recherche de mise à jour a échoué : "),
            "{message}"
        );
        assert!(message.contains("valid release JSON"), "{message}");
    }
}

/// Cherche une version plus récente. `None` quand il n'y en a pas.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    Ok(interroger(&app).await?.map(|maj| AvailableUpdate {
        version: maj.version.clone(),
        notes: maj.body.clone(),
    }))
}

/// Télécharge, installe, et redémarre.
///
/// **Ne rend jamais `Ok`** : au succès, `restart()` remplace le processus. Le type de retour
/// existe pour l'échec, et il n'y a donc rien à afficher « après » — un écran qui attendrait
/// une réponse heureuse attendrait indéfiniment.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let Some(maj) = interroger(&app).await? else {
        // Arrive si une release est retirée entre les deux commandes. Le message est pour le
        // journal : l'écran, lui, se contente de retirer son bouton.
        return Err("la mise à jour annoncée n'est plus proposée".to_string());
    };

    // Les deux fermetures sont la progression et la fin du téléchargement. Aucune des deux
    // n'est câblée : une barre de progression exige un canal d'événements, donc
    // `core:event:default` en écoute côté webview et un état de plus dans la barre d'état,
    // pour une attente qui se compte en secondes sur une image de trente mégaoctets. À
    // rebrancher le jour où un utilisateur la réclame — pas avant.
    maj.download_and_install(|_recus, _total| {}, || {})
        .await
        .map_err(|erreur| format!("l'installation a échoué : {erreur}"))?;

    // **`restart` et non `exit`** : quitter laisserait l'utilisateur devant un Dock et un
    // doute. Le processus est remplacé par le nouveau bundle, déjà en place à cet instant.
    app.restart();
}
