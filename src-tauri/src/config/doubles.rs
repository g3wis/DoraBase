//! Les doubles de magasin de secrets que les tests de la configuration partagent (#165).
//!
//! **Trois doubles, trois défauts qu'aucun autre ne produit** : un magasin qui compte ses appels
//! (pour prouver qu'un geste n'y touche pas), un magasin qui refuse la k-ième écriture (le seul
//! décor qui produit un échec *au milieu*, donc quelque chose à défaire), et un magasin qui accepte
//! une écriture sans la garder (le seul que la relecture de vérification attrape).

use std::collections::HashMap;
use std::sync::Mutex;

use crate::config::model::SecretRef;
use crate::secrets::{Secret, SecretError, SecretStore};

fn panne(detail: &str) -> SecretError {
    SecretError::Magasin {
        detail: detail.to_owned(),
    }
}

/// Un magasin en mémoire qui **compte** ses appels, et peut refuser d'écrire ou de supprimer.
///
/// Un `Mutex` et non une `RefCell` : `SecretStore` exige `Send + Sync`.
#[derive(Default)]
pub(crate) struct MagasinSync {
    pub(crate) contenu: Mutex<HashMap<String, String>>,
    pub refuse_d_ecrire: bool,
    pub refuse_de_supprimer: bool,
    pub(crate) appels: Mutex<usize>,
}

impl MagasinSync {
    /// Pose un secret **sans compter l'appel ni passer par les drapeaux de panne** : c'est le décor.
    pub(crate) fn poser(&self, reference: &str, valeur: &str) {
        self.contenu
            .lock()
            .expect("magasin")
            .insert(reference.to_owned(), valeur.to_owned());
    }

    pub(crate) fn valeur(&self, reference: &str) -> Option<String> {
        self.contenu
            .lock()
            .expect("magasin")
            .get(reference)
            .cloned()
    }

    pub(crate) fn references(&self) -> Vec<String> {
        let mut toutes: Vec<_> = self
            .contenu
            .lock()
            .expect("magasin")
            .keys()
            .cloned()
            .collect();
        toutes.sort();
        toutes
    }

    /// Le nombre d'appels à `store`, `retrieve` et `delete` reçus.
    pub(crate) fn appels(&self) -> usize {
        *self.appels.lock().expect("compteur")
    }

    fn compter(&self) {
        *self.appels.lock().expect("compteur") += 1;
    }
}

impl SecretStore for MagasinSync {
    fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        self.compter();
        if self.refuse_d_ecrire {
            return Err(panne("magasin en panne"));
        }
        self.poser(reference.as_str(), secret.expose());
        Ok(())
    }

    fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
        self.compter();
        Ok(self.valeur(reference.as_str()).map(Secret::new))
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        self.compter();
        if self.refuse_de_supprimer {
            return Err(panne("suppression impossible"));
        }
        self.contenu
            .lock()
            .expect("magasin")
            .remove(reference.as_str());
        Ok(())
    }
}

/// Enveloppe un vrai magasin et **refuse la k-ième écriture** (la première vaut 1).
pub(crate) struct MagasinCapricieux<'a> {
    pub interieur: &'a dyn SecretStore,
    pub ecriture_refusee: usize,
    ecritures: Mutex<usize>,
}

impl<'a> MagasinCapricieux<'a> {
    pub(crate) fn nouveau(interieur: &'a dyn SecretStore, ecriture_refusee: usize) -> Self {
        Self {
            interieur,
            ecriture_refusee,
            ecritures: Mutex::new(0),
        }
    }
}

impl SecretStore for MagasinCapricieux<'_> {
    fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        let mut ecritures = self.ecritures.lock().expect("compteur");
        *ecritures += 1;
        if *ecritures == self.ecriture_refusee {
            return Err(panne("écriture refusée par le décor"));
        }
        self.interieur.store(reference, secret)
    }

    fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
        self.interieur.retrieve(reference)
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        self.interieur.delete(reference)
    }
}

/// Un magasin qui **accepte** l'écriture sous `oubliee` sans la garder — un profil verrouillé, un
/// disque plein. Tout le reste passe au magasin enveloppé.
pub(crate) struct MagasinOublieux<'a> {
    pub interieur: &'a dyn SecretStore,
    pub oubliee: String,
}

impl SecretStore for MagasinOublieux<'_> {
    fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        if reference.as_str() == self.oubliee {
            return Ok(());
        }
        self.interieur.store(reference, secret)
    }

    fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
        self.interieur.retrieve(reference)
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        self.interieur.delete(reference)
    }
}
