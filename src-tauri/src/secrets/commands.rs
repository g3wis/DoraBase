//! Sélection du magasin de secrets, et exposition honnête du mécanisme actif.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::signature::{signature_courante, SignatureKind};
use super::{EncryptedFileStore, KeychainStore, SecretError, SecretStore};

/// Le mécanisme réellement employé, tel que le front l'apprend.
///
/// Le badge vert « Trousseau » de `A2` serait un mensonge en développement : l'écran doit
/// pouvoir dire la vérité, donc il a besoin de cette information.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub enum SecretMechanism {
    /// Trousseau du système — build à signature stable.
    Keychain,
    /// Fichier chiffré local — développement. Protège de l'exposition accidentelle, pas
    /// d'un attaquant qui a la session de l'utilisateur.
    EncryptedFile,
}

/// Le magasin actif et le mécanisme qui le décrit.
pub struct ActiveSecretStore {
    pub mechanism: SecretMechanism,
    pub store: Box<dyn SecretStore>,
}

/// Choisit le magasin de secrets, d'après ce qui décide sur cette plateforme.
///
/// **Aucun réglage** : le mécanisme se déduit, il ne se configure pas. Un réglage exposé
/// serait un moyen de dégrader la sécurité en silence, et une question que l'utilisateur
/// n'a pas les moyens de trancher.
///
/// # Trois plateformes, trois questions — et une seule est celle de la signature
///
/// **Ce n'est pas le code qui diffère, c'est la prémisse.** Tout `secrets/signature.rs` existe
/// parce que les ACL du Trousseau macOS sont liées à la **signature de code** : une signature
/// ad-hoc change à chaque build, donc les entrées écrites par le build précédent deviennent
/// illisibles, en silence. Cette liaison n'existe nulle part ailleurs.
///
/// - **macOS** : la signature décide, et c'est le seul endroit où elle a un sens.
/// - **Windows** (31 août 2026) : les entrées du Gestionnaire d'identifiants sont protégées par
///   DPAPI et rattachées au **compte de l'utilisateur**, qui ne change pas d'une reconstruction
///   à l'autre. Il n'y a rien à détecter, et rien contre quoi se prémunir.
/// - **Linux** (4 septembre 2026) : le Secret Service (gnome-keyring, KWallet) est lui aussi
///   rattaché à la session de l'utilisateur, donc la signature n'y décide de rien non plus —
///   **mais il peut ne pas être là**. C'est la seule différence de fond avec Windows, et elle
///   demande une sonde ; voir `selectionner_selon_le_systeme`.
///
/// Laisser tourner la détection hors macOS serait le pire des deux mondes : `codesign` n'y
/// existe pas, `signature_courante` rend `AdHoc` par prudence en cas d'échec — la bonne réponse
/// pour la question qu'elle pose —, et le résultat serait un **fichier chiffré à vie**, y compris
/// dans un build installé. Le magasin du système ne serait jamais atteint, et le badge d'`A2`
/// l'annoncerait fidèlement sans que personne ne se demande pourquoi.
///
/// `cfg!` plutôt que `#[cfg]` : les trois branches restent **compilées** partout, donc aucune ne
/// peut pourrir sans que la CI des deux autres le voie.
pub fn selectionner(repertoire: &Path) -> Result<ActiveSecretStore, SecretError> {
    if cfg!(target_os = "macos") {
        return selectionner_pour(signature_courante(), repertoire);
    }
    if cfg!(windows) {
        return Ok(magasin_du_systeme());
    }
    selectionner_selon_le_systeme(magasin_du_systeme_repond(), repertoire)
}

/// Le magasin du système, sans question posée.
fn magasin_du_systeme() -> ActiveSecretStore {
    ActiveSecretStore {
        mechanism: SecretMechanism::Keychain,
        store: Box::new(KeychainStore::new()),
    }
}

/// Variante testable : la signature est un paramètre plutôt qu'une mesure.
pub fn selectionner_pour(
    signature: SignatureKind,
    repertoire: &Path,
) -> Result<ActiveSecretStore, SecretError> {
    match signature {
        SignatureKind::Stable => Ok(magasin_du_systeme()),
        SignatureKind::AdHoc => Ok(ActiveSecretStore {
            mechanism: SecretMechanism::EncryptedFile,
            store: Box::new(EncryptedFileStore::new(repertoire)?),
        }),
    }
}

/// Le magasin quand la question n'est pas la signature mais la **présence** du magasin du
/// système (4 septembre 2026).
///
/// # Pourquoi Linux a besoin de cette question, et pas Windows
///
/// Le Trousseau de macOS et le Gestionnaire d'identifiants de Windows font partie du système :
/// ils sont là. Le Secret Service de freedesktop, non — c'est un **démon** (gnome-keyring,
/// KWallet, ou aucun) qu'aucune session n'est obligée de faire tourner. Un bureau minimal — i3,
/// sway, un serveur avec X11 déporté — n'en a souvent pas.
///
/// Sans cette sonde, y enregistrer un mot de passe échouerait sur « écriture dans le Trousseau
/// impossible : … », c'est-à-dire sur un message qui accuse une installation parfaitement
/// correcte. Le repli est le fichier chiffré, et il **se dit** : c'est tout l'intérêt de
/// `SecretMechanism`, que le badge d'`A2` affiche. Ce n'est donc pas une dégradation silencieuse
/// — la seule sorte que ce module refuse.
///
/// # En paramètre, parce qu'une sonde ne se teste pas sur la machine qui la lance
///
/// La forme est celle de `selectionner_pour` : la mesure est un argument, donc les deux verdicts
/// sont exercés sur n'importe quelle plateforme. La sonde elle-même n'est appelée que sous Linux
/// et n'a pas de test — interroger un magasin réel demanderait qu'il soit là, ce qui est
/// exactement la question posée, et sur macOS cela ouvrirait une invite de Trousseau qui
/// bloquerait la CI (la raison des tests `#[ignore]` de `keychain.rs`).
pub fn selectionner_selon_le_systeme(
    systeme_repond: bool,
    repertoire: &Path,
) -> Result<ActiveSecretStore, SecretError> {
    if systeme_repond {
        return Ok(magasin_du_systeme());
    }
    Ok(ActiveSecretStore {
        mechanism: SecretMechanism::EncryptedFile,
        store: Box::new(EncryptedFileStore::new(repertoire)?),
    })
}

/// Le magasin du système répond-il ?
///
/// **`keyring` porte exactement cette question, et il ne faut pas la lui poser autrement.**
/// `Entry::store_status()` rend le résultat de l'initialisation — faite une seule fois, à la
/// demande — du magasin de la plateforme : sur Linux, `zbus_secret_service_keyring_store::Store
/// ::new()`, qui échoue précisément quand aucun démon ne répond sur le bus. La documentation de
/// la fonction le dit en propres termes : « si vous voulez vérifier l'initialisation du magasin
/// sans créer d'entrée, appelez ceci avant `Entry::new` ».
///
/// **Ce qu'elle évite, et qui était la première version de cette sonde** : lire une entrée
/// factice. Cela répondait juste — `Entry::new` rend `NoDefaultStore` quand l'initialisation a
/// échoué — mais au prix d'un aller-retour sur le bus, et en touchant un trousseau réel pour
/// poser une question sur le trousseau lui-même. Une sonde n'a pas à laisser de trace, et
/// celle-ci n'en laisse aucune.
fn magasin_du_systeme_repond() -> bool {
    keyring::Entry::store_status().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SecretRef;
    use crate::secrets::Secret;

    #[test]
    fn une_signature_stable_choisit_le_trousseau() {
        let dir = tempfile::tempdir().unwrap();
        let actif = selectionner_pour(SignatureKind::Stable, dir.path()).unwrap();
        assert_eq!(actif.mechanism, SecretMechanism::Keychain);
    }

    #[test]
    fn une_signature_adhoc_choisit_le_fichier_chiffre() {
        let dir = tempfile::tempdir().unwrap();
        let actif = selectionner_pour(SignatureKind::AdHoc, dir.path()).unwrap();
        assert_eq!(actif.mechanism, SecretMechanism::EncryptedFile);
    }

    #[test]
    fn le_code_appelant_ignore_quelle_implementation_est_active() {
        // Tout l'intérêt de l'interface : ce test manipule un `dyn SecretStore` sans
        // savoir lequel, et c'est ce que fera le reste de l'app.
        let dir = tempfile::tempdir().unwrap();
        let actif = selectionner_pour(SignatureKind::AdHoc, dir.path()).unwrap();
        let reference = SecretRef::new("r");

        actif
            .store
            .store(&reference, &Secret::new("s3cr3t"))
            .unwrap();
        assert_eq!(
            actif.store.retrieve(&reference).unwrap().unwrap().expose(),
            "s3cr3t"
        );
    }

    /// Sur pièce, sans paramètre : c'est le vrai binaire — et la vraie machine — qui décide.
    ///
    /// **Le verdict attendu dépend de la plateforme, et c'est le fait à garder.** Sur un poste
    /// de développement macOS, la signature est ad-hoc, donc le fichier chiffré — c'est ce qui
    /// protège le Trousseau réel des builds successifs. Sous Windows il n'y a pas de signature à
    /// interroger, donc le Gestionnaire d'identifiants. Voir la doc de `selectionner`.
    ///
    /// **Linux n'est pas dans ce test, et c'est délibéré** : le verdict y dépend de la présence
    /// d'un démon Secret Service, donc de la machine — ce qui est précisément le genre
    /// d'assertion que ce dépôt refuse (règle 5 : un test qui mesure la machine ne mesure rien).
    /// Les deux verdicts possibles sont exercés juste en dessous, à travers
    /// `selectionner_selon_le_systeme`, dont la mesure est un paramètre.
    ///
    /// Écrit en un seul test plutôt qu'en deux `#[cfg]` : la propriété est « le mécanisme suit
    /// la plateforme », et deux tests dont un seul se compile ne la disent pas.
    #[test]
    fn le_mecanisme_choisi_sans_parametre_suit_la_plateforme() {
        if cfg!(target_os = "linux") {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let attendu = if cfg!(windows) {
            SecretMechanism::Keychain
        } else {
            SecretMechanism::EncryptedFile
        };
        assert_eq!(selectionner(dir.path()).unwrap().mechanism, attendu);
    }

    /// **Un Secret Service qui répond donne le magasin du système** (4 septembre 2026).
    ///
    /// C'est la branche que le portage Linux devait obtenir : sans elle, un build installé
    /// aurait gardé le fichier chiffré à vie, faute de signature à interroger — le pire des deux
    /// mondes, décrit dans la doc de `selectionner`.
    #[test]
    fn un_magasin_de_systeme_qui_repond_est_choisi() {
        let dir = tempfile::tempdir().unwrap();
        let actif = selectionner_selon_le_systeme(true, dir.path()).unwrap();
        assert_eq!(actif.mechanism, SecretMechanism::Keychain);
    }

    /// **Et son absence est un repli qui se dit, pas un échec.**
    ///
    /// Un bureau Linux minimal peut n'avoir aucun démon de trousseau. Sans ce repli,
    /// l'enregistrement d'un mot de passe échouerait sur « écriture dans le Trousseau
    /// impossible » — un message qui accuse une installation correcte. Le mécanisme rendu est
    /// celui que le badge d'`A2` affiche, donc le repli est **visible** : ce n'est pas la
    /// dégradation silencieuse que ce module refuse.
    #[test]
    fn sans_magasin_de_systeme_le_repli_est_le_fichier_chiffre() {
        let dir = tempfile::tempdir().unwrap();
        let actif = selectionner_selon_le_systeme(false, dir.path()).unwrap();
        assert_eq!(actif.mechanism, SecretMechanism::EncryptedFile);
        // Et il fonctionne : un repli qui rendrait un magasin inutilisable ne serait pas un
        // repli. C'est le contrôle positif du test précédent.
        let reference = SecretRef::new("r");
        actif
            .store
            .store(&reference, &Secret::new("s3cr3t"))
            .unwrap();
        assert_eq!(
            actif.store.retrieve(&reference).unwrap().unwrap().expose(),
            "s3cr3t"
        );
    }
}
