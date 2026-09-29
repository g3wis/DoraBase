//! Magasin de secrets chiffré sur fichier — l'implémentation de **développement**.
//!
//! Ce qu'elle protège : qu'un mot de passe traîne **en clair** sur le disque, donc dans
//! une sauvegarde, un partage d'écran, un `grep`, un dump de journal.
//!
//! Ce qu'elle ne protège **pas** : un attaquant qui a la session de l'utilisateur. La clé
//! vit sur la même machine que le fichier, et rien ne peut y changer sans un secret que
//! l'utilisateur saisirait à chaque démarrage. C'est acceptable en développement, pas en
//! release — d'où la détection de signature qui choisit le Trousseau quand elle peut.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

use super::{Secret, SecretError, SecretStore};
use crate::config::SecretRef;

pub(super) const NOM_FICHIER_CLE: &str = "secrets.key";
pub(super) const NOM_FICHIER_SECRETS: &str = "secrets.enc";

/// Longueur du nonce de ChaCha20-Poly1305, en tête du fichier chiffré.
const TAILLE_NONCE: usize = 12;

pub struct EncryptedFileStore {
    chemin_cle: PathBuf,
    chemin_secrets: PathBuf,
}

impl EncryptedFileStore {
    /// Ouvre le magasin dans `repertoire`, en créant la clé si elle n'existe pas encore.
    pub fn new(repertoire: impl AsRef<Path>) -> Result<Self, SecretError> {
        let repertoire = repertoire.as_ref();
        creer_le_repertoire(repertoire)?;

        let magasin = Self {
            chemin_cle: repertoire.join(NOM_FICHIER_CLE),
            chemin_secrets: repertoire.join(NOM_FICHIER_SECRETS),
        };

        // La clé est créée **une seule fois** : la régénérer à chaque ouverture rendrait
        // tous les secrets illisibles au redémarrage suivant, sans le moindre message.
        // `create_new` en fait une garantie atomique plutôt qu'un `exists()` suivi d'une
        // création : une clé déjà là fait échouer l'ouverture, et c'est elle qu'on garde.
        let cle = Key::generate();
        match creer_et_ecrire(&magasin.chemin_cle, |fichier| {
            fichier.write_all(cle.as_slice())
        }) {
            Ok(()) => {}
            Err(erreur) if erreur.kind() == io::ErrorKind::AlreadyExists => {}
            Err(erreur) => return Err(SecretError::Io(erreur)),
        }

        Ok(magasin)
    }

    fn lire_cle(&self) -> Result<Key, SecretError> {
        let octets = fs::read(&self.chemin_cle)?;
        let tableau: [u8; 32] = octets
            .as_slice()
            .try_into()
            .map_err(|_| SecretError::Altere {
                detail: format!("clé de {} octets au lieu de 32", octets.len()),
            })?;
        Ok(Key::from(tableau))
    }

    /// Lit et déchiffre la table entière. Une table absente donne une table vide : c'est
    /// le premier lancement, pas une anomalie.
    fn lire_table(&self) -> Result<BTreeMap<String, String>, SecretError> {
        let brut = match fs::read(&self.chemin_secrets) {
            Ok(brut) => brut,
            Err(erreur) if erreur.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new());
            }
            Err(erreur) => return Err(SecretError::Io(erreur)),
        };

        if brut.len() <= TAILLE_NONCE {
            return Err(SecretError::Altere {
                detail: format!("fichier de {} octets, trop court", brut.len()),
            });
        }

        let (octets_nonce, chiffre) = brut.split_at(TAILLE_NONCE);
        // `from_slice` est déprécié depuis la 0.11 : `TryFrom` à la place. La longueur
        // est déjà garantie par `split_at`, d'où l'erreur explicite plutôt qu'un panic.
        let nonce = Nonce::try_from(octets_nonce).map_err(|_| SecretError::Altere {
            detail: "nonce de longueur inattendue".to_owned(),
        })?;
        let clair = ChaCha20Poly1305::new(&self.lire_cle()?)
            .decrypt(&nonce, chiffre)
            // Chiffrement **authentifié** : une altération est détectée ici, au lieu de
            // rendre des octets faux. Le détail ne porte aucune valeur de secret.
            .map_err(|_| SecretError::Altere {
                detail: "l'authentification du contenu a échoué".to_owned(),
            })?;

        Ok(serde_json::from_slice(&clair)?)
    }

    fn ecrire_table(&self, table: &BTreeMap<String, String>) -> Result<(), SecretError> {
        let clair = serde_json::to_vec(table)?;
        // Un nonce neuf à chaque écriture : le réutiliser avec la même clé casserait la
        // confidentialité du chiffrement de flux.
        let nonce = Nonce::generate();
        let chiffre = ChaCha20Poly1305::new(&self.lire_cle()?)
            .encrypt(&nonce, clair.as_slice())
            .map_err(|_| SecretError::Magasin {
                detail: "chiffrement impossible".to_owned(),
            })?;

        let mut octets = nonce.to_vec();
        octets.extend_from_slice(&chiffre);

        // Même séquence atomique que `05b` : temporaire frère, synchronisation, renommage.
        // Perdre le magasin de secrets sur une écriture interrompue coûterait à
        // l'utilisateur de resaisir tous ses mots de passe.
        //
        // Le temporaire est créé déjà restreint, et le renommage emporte ses droits : le
        // fichier chiffré n'a donc jamais été lisible hors de son propriétaire, à aucun
        // instant. Un temporaire resté d'une écriture interrompue est retiré d'abord —
        // `create_new` refuserait sinon toute écriture suivante, et ses droits sont ceux
        // d'une version antérieure, que `mode` ne corrigerait pas.
        let temporaire = self.chemin_secrets.with_extension("enc.tmp");
        match fs::remove_file(&temporaire) {
            Ok(()) => {}
            Err(erreur) if erreur.kind() == io::ErrorKind::NotFound => {}
            Err(erreur) => return Err(SecretError::Io(erreur)),
        }
        creer_et_ecrire(&temporaire, |fichier| fichier.write_all(&octets))?;
        fs::rename(&temporaire, &self.chemin_secrets)?;

        Ok(())
    }
}

/// Crée `chemin` **déjà restreint** à son propriétaire, puis y écrit et synchronise (#86).
///
/// `File::create` suivi d'un `set_permissions` laissait le fichier au umask — `0644` — le
/// temps d'un `write_all` et d'un `sync_all`, et ce dernier attend le disque : assez long
/// pour qu'un autre compte de la machine lise la clé, donc tous les mots de passe du fichier
/// voisin. `mode(0o600)` s'applique à la création même, avant qu'un octet n'existe.
/// C'est la séquence que `config::transfert::restreindre_au_proprietaire` tient déjà.
///
/// `create_new` refuse un fichier déjà là — y compris un lien symbolique posé à sa place —
/// donc le fichier écrit est toujours celui qu'on vient de créer. C'est ce qui rend sûr de
/// le **retirer** si l'écriture échoue : une clé tronquée rendrait le magasin illisible à
/// l'ouverture suivante (« clé de n octets au lieu de 32 »), et plus aucun secret ne
/// s'ouvrirait. Windows n'a pas de `mode` : ses ACL s'héritent du répertoire.
fn creer_et_ecrire(
    chemin: &Path,
    ecrire: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut ouverture = OpenOptions::new();
    ouverture.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        ouverture.mode(0o600);
    }
    let mut fichier = ouverture.open(chemin)?;

    let issue = ecrire(&mut fichier).and_then(|()| fichier.sync_all());
    if issue.is_err() {
        drop(fichier);
        let _ = fs::remove_file(chemin);
    }
    issue
}

/// Crée le répertoire du magasin en `0700` (#86) — les répertoires qu'on crée seulement :
/// un répertoire déjà là appartient à qui l'a créé, et le resserrer changerait les droits de
/// ce qu'il contient d'autre. Ce n'est qu'une seconde ligne : les deux fichiers sont
/// restreints eux-mêmes.
fn creer_le_repertoire(repertoire: &Path) -> io::Result<()> {
    let mut construction = fs::DirBuilder::new();
    construction.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        construction.mode(0o700);
    }
    construction.create(repertoire)
}

impl SecretStore for EncryptedFileStore {
    fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        let mut table = self.lire_table()?;
        table.insert(reference.as_str().to_owned(), secret.expose().to_owned());
        self.ecrire_table(&table)
    }

    fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
        Ok(self
            .lire_table()?
            .get(reference.as_str())
            .map(|valeur| Secret::new(valeur.clone())))
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        let mut table = self.lire_table()?;
        table.remove(reference.as_str());
        self.ecrire_table(&table)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SENSIBLE: &str = "motdepasse-en-clair";

    fn contient_sous_sequence(foin: &[u8], aiguille: &[u8]) -> bool {
        foin.windows(aiguille.len()).any(|f| f == aiguille)
    }

    #[test]
    fn un_aller_retour_rend_le_secret() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        let reference = SecretRef::new("analytics/prod/password");

        magasin.store(&reference, &Secret::new("s3cr3t")).unwrap();
        assert_eq!(
            magasin.retrieve(&reference).unwrap().unwrap().expose(),
            "s3cr3t"
        );
    }

    #[test]
    fn une_reference_inconnue_rend_none_pas_une_erreur() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        assert!(magasin
            .retrieve(&SecretRef::new("inconnue"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn le_secret_n_apparait_pas_en_clair_sur_le_disque() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        magasin
            .store(&SecretRef::new("r"), &Secret::new(SENSIBLE))
            .unwrap();

        // Tous les fichiers du répertoire, lus en octets bruts — pas seulement celui
        // qu'on croit contenir les secrets.
        for entree in fs::read_dir(dir.path()).unwrap() {
            let chemin = entree.unwrap().path();
            let octets = fs::read(&chemin).unwrap();
            assert!(
                !contient_sous_sequence(&octets, SENSIBLE.as_bytes()),
                "secret lisible en clair dans {}",
                chemin.display()
            );
        }
    }

    #[test]
    fn un_fichier_altere_est_refuse_au_lieu_de_rendre_des_octets_faux() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        magasin
            .store(&SecretRef::new("r"), &Secret::new("s3cr3t"))
            .unwrap();

        let chemin = dir.path().join(NOM_FICHIER_SECRETS);
        let mut octets = fs::read(&chemin).unwrap();
        let milieu = octets.len() / 2;
        octets[milieu] ^= 0xFF;
        fs::write(&chemin, &octets).unwrap();

        assert!(matches!(
            magasin.retrieve(&SecretRef::new("r")),
            Err(SecretError::Altere { .. })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn la_cle_n_est_lisible_que_par_son_proprietaire() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        EncryptedFileStore::new(dir.path()).unwrap();
        let mode = fs::metadata(dir.path().join(NOM_FICHIER_CLE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "mode = {:o}", mode & 0o777);
    }

    /// Le mode d'un fichier, lu sur le disque.
    #[cfg(unix)]
    fn mode_de(chemin: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(chemin).unwrap().permissions().mode() & 0o777
    }

    /// Ce que le test de mode final ne pouvait pas voir (#86) : le fichier est restreint
    /// **pendant** qu'on y écrit, pas seulement après. La fermeture d'écriture est le seul
    /// instant où la fenêtre existait, donc c'est là qu'on mesure — sans course à gagner.
    #[cfg(unix)]
    #[test]
    fn le_fichier_est_restreint_avant_qu_un_octet_y_soit_ecrit() {
        let dir = tempfile::tempdir().unwrap();

        // Contrôle positif : le umask de ce processus crée bien des fichiers plus larges
        // que `0600`. Sans lui, un umask `077` rendrait l'assertion vraie de toute façon.
        let temoin = dir.path().join("temoin");
        File::create(&temoin).unwrap();
        assert_ne!(
            mode_de(&temoin),
            0o600,
            "umask trop strict pour mesurer quoi que ce soit"
        );

        let chemin = dir.path().join("sensible");
        let mut pendant = None;
        creer_et_ecrire(&chemin, |fichier| {
            pendant = Some(mode_de(&chemin));
            fichier.write_all(b"secret")
        })
        .unwrap();
        assert_eq!(
            pendant,
            Some(0o600),
            "mode pendant l'écriture = {pendant:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn le_fichier_chiffre_n_est_lisible_que_par_son_proprietaire() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        magasin
            .store(&SecretRef::new("r"), &Secret::new("s3cr3t"))
            .unwrap();
        assert_eq!(mode_de(&dir.path().join(NOM_FICHIER_SECRETS)), 0o600);
    }

    /// Un temporaire resté d'une écriture interrompue — et d'une version qui le créait au
    /// umask — ne bloque pas l'écriture suivante, et ne lui lègue pas ses droits.
    #[cfg(unix)]
    #[test]
    fn un_temporaire_abandonne_est_remplace_et_non_repris() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        let temporaire = dir
            .path()
            .join(NOM_FICHIER_SECRETS)
            .with_extension("enc.tmp");
        fs::write(&temporaire, b"reste").unwrap();
        fs::set_permissions(&temporaire, fs::Permissions::from_mode(0o644)).unwrap();

        magasin
            .store(&SecretRef::new("r"), &Secret::new("s3cr3t"))
            .unwrap();
        assert_eq!(mode_de(&dir.path().join(NOM_FICHIER_SECRETS)), 0o600);
        assert!(!temporaire.exists());
    }

    #[test]
    fn une_ecriture_qui_echoue_ne_laisse_pas_de_fichier_tronque() {
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("cle");
        let issue = creer_et_ecrire(&chemin, |fichier| {
            fichier.write_all(b"moitie")?;
            Err(io::Error::other("disque plein"))
        });
        assert!(issue.is_err());
        assert!(
            !chemin.exists(),
            "une clé tronquée rendrait le magasin illisible"
        );
    }

    #[test]
    fn une_cle_deja_la_n_est_pas_remplacee() {
        let dir = tempfile::tempdir().unwrap();
        EncryptedFileStore::new(dir.path()).unwrap();
        let avant = fs::read(dir.path().join(NOM_FICHIER_CLE)).unwrap();
        EncryptedFileStore::new(dir.path()).unwrap();
        assert_eq!(fs::read(dir.path().join(NOM_FICHIER_CLE)).unwrap(), avant);
    }

    #[cfg(unix)]
    #[test]
    fn le_repertoire_cree_n_est_ouvert_qu_a_son_proprietaire() {
        let dir = tempfile::tempdir().unwrap();
        let repertoire = dir.path().join("dorabase");
        EncryptedFileStore::new(&repertoire).unwrap();
        assert_eq!(mode_de(&repertoire), 0o700);
    }

    #[test]
    fn supprimer_retire_le_secret() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();
        let reference = SecretRef::new("r");

        magasin.store(&reference, &Secret::new("s3cr3t")).unwrap();
        magasin.delete(&reference).unwrap();
        assert!(magasin.retrieve(&reference).unwrap().is_none());
    }

    #[test]
    fn un_second_magasin_relit_ce_que_le_premier_a_ecrit() {
        // La clé doit être **réutilisée**, pas régénérée : la régénérer passe tous les
        // autres tests et rend pourtant tous les secrets illisibles au redémarrage.
        let dir = tempfile::tempdir().unwrap();
        EncryptedFileStore::new(dir.path())
            .unwrap()
            .store(&SecretRef::new("r"), &Secret::new("s3cr3t"))
            .unwrap();

        let second = EncryptedFileStore::new(dir.path()).unwrap();
        assert_eq!(
            second
                .retrieve(&SecretRef::new("r"))
                .unwrap()
                .unwrap()
                .expose(),
            "s3cr3t"
        );
    }

    #[test]
    fn deux_secrets_coexistent() {
        let dir = tempfile::tempdir().unwrap();
        let magasin = EncryptedFileStore::new(dir.path()).unwrap();

        magasin
            .store(&SecretRef::new("a"), &Secret::new("un"))
            .unwrap();
        magasin
            .store(&SecretRef::new("b"), &Secret::new("deux"))
            .unwrap();

        assert_eq!(
            magasin
                .retrieve(&SecretRef::new("a"))
                .unwrap()
                .unwrap()
                .expose(),
            "un"
        );
        assert_eq!(
            magasin
                .retrieve(&SecretRef::new("b"))
                .unwrap()
                .unwrap()
                .expose(),
            "deux"
        );
    }
}
