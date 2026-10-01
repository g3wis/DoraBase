//! Le déplacement des mots de passe vers leur nouvelle référence, **une fois**, à la migration v7
//! (#165).
//!
//! # Pourquoi c'est ici, et pourquoi un seul algorithme
//!
//! En v6, un mot de passe vivait sous `projet/base/environnement` ; en v7 il vit sous
//! `connexion/<id>`. La migration de la configuration est pure (`v6::vers_v7`) et rend le plan des
//! couples `(ancienne, nouvelle)` ; ce module est l'autre moitié, celle qui touche au magasin.
//!
//! **L'algorithme est celui de `renommer_projet`, extrait** — le seul endroit du dépôt qui déplaçait
//! déjà des secrets correctement, après avoir appris l'ordre à ses dépens. Il est parti avec les
//! renommages (un renommage ne déplace plus rien), et il ne reste qu'ici : deux algorithmes pour le
//! même déplacement auraient divergé (règle n° 17).
//!
//! # L'ordre, et ce qu'il garantit
//!
//! 1. **Copier** : pour chaque couple, relire l'ancienne, écrire la nouvelle, et **relire** la
//!    nouvelle — un magasin qui accepte une écriture sans la garder ferait perdre le mot de passe à
//!    l'effacement de l'original.
//! 2. **Écrire la configuration**, en dernier des étapes réversibles : c'est elle qui rend la
//!    migration vraie, et elle ne doit l'être qu'une fois les copies en place.
//! 3. **Effacer** les anciennes, ensuite seulement. Un échec n'y est plus qu'un résidu, dit.
//!
//! **Rien n'est effacé avant l'étape 3**, et c'est la leçon de `renommer_projet` : une première
//! version effaçait chaque original sitôt la copie faite, et un magasin en panne à mi-parcours
//! rendait la reprise impossible. Ici, tout échec des étapes 1 et 2 se défait en retirant les
//! copies ; les originaux n'ont jamais bougé, et le fichier est resté en v6.

use crate::config::model::SecretRef;
use crate::secrets::SecretStore;

use super::v6::PlanDeSecrets;

/// Ce qu'un déplacement réussi rapporte — ni l'un ni l'autre n'est un échec.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RapportDeDeplacement {
    /// Les anciennes références dont le magasin n'avait **rien** à rendre : la connexion redemandera
    /// son mot de passe. Effacé à la main, ou jamais écrit — introuvable n'est pas illisible, et
    /// interrompre ici rendrait la configuration **inchargeable**.
    pub absents: Vec<String>,
    /// Les anciennes références que le magasin n'a pas su effacer après coup : des orphelins,
    /// bénins, et dits.
    pub residus: Vec<String>,
}

/// Un déplacement abandonné. **Aucun original n'a bougé**, et la configuration n'a pas été écrite.
#[derive(Debug)]
pub struct ErreurDeDeplacement {
    /// Ce qui a fait abandonner — le magasin, ou l'écriture de la configuration.
    pub raison: String,
    /// Vrai si les copies déjà posées ont toutes pu être retirées.
    pub repris: bool,
}

impl std::fmt::Display for ErreurDeDeplacement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.raison)?;
        if self.repris {
            write!(f, " (les mots de passe d'origine sont intacts)")
        } else {
            // Les originaux sont intacts dans les deux cas ; une copie sous une référence
            // `connexion/…` reste, et elle sera réécrasée par la même valeur au lancement suivant —
            // c'est ce qui rend ce cas bénin, et le dire évite de le croire grave.
            write!(
                f,
                " (les mots de passe d'origine sont intacts ; une copie n'a pas pu être retirée)"
            )
        }
    }
}

/// Retire les références posées. Rend `true` si tout a pu être retiré.
///
/// **Il n'y a rien d'autre à défaire** : aucun original n'est supprimé avant que la configuration
/// soit écrite. C'est ce qui rend la reprise possible même quand le magasin refuse d'écrire.
pub(crate) fn retirer_les_ecrits(magasin: &dyn SecretStore, ecrits: &[SecretRef]) -> bool {
    ecrits
        .iter()
        .all(|nouvelle| magasin.delete(nouvelle).is_ok())
}

fn abandon(raison: String, magasin: &dyn SecretStore, ecrits: &[SecretRef]) -> ErreurDeDeplacement {
    ErreurDeDeplacement {
        raison,
        repris: retirer_les_ecrits(magasin, ecrits),
    }
}

/// Déplace les mots de passe du plan, appelle `ecrire` — la configuration v7 —, puis efface les
/// originaux. Voir la documentation du module pour l'ordre.
///
/// **Rejouable** : les identifiants de la migration sont dérivés, donc les nouvelles références
/// d'un second passage sont les mêmes, et une copie déjà faite est réécrasée par la même valeur.
/// C'est ce qui rend sûr un processus tué entre la copie et l'écriture : le fichier est resté en
/// v6, le lancement suivant refait tout.
pub fn deplacer_les_secrets(
    plan: &PlanDeSecrets,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut() -> Result<(), String>,
) -> Result<RapportDeDeplacement, ErreurDeDeplacement> {
    let mut ecrits: Vec<SecretRef> = Vec::new();
    let mut a_effacer: Vec<SecretRef> = Vec::new();
    let mut rapport = RapportDeDeplacement::default();

    for (ancienne, nouvelle) in plan.couples() {
        let secret = match magasin.retrieve(ancienne) {
            Ok(Some(secret)) => secret,
            Ok(None) => {
                if !rapport.absents.iter().any(|a| a == ancienne.as_str()) {
                    rapport.absents.push(ancienne.as_str().to_owned());
                }
                continue;
            }
            Err(source) => {
                return Err(abandon(
                    format!(
                        "le mot de passe « {} » n'a pas pu être relu : {source}",
                        ancienne.as_str()
                    ),
                    magasin,
                    &ecrits,
                ));
            }
        };

        if let Err(source) = magasin.store(nouvelle, &secret) {
            return Err(abandon(
                format!(
                    "le mot de passe n'a pas pu être rangé sous « {} » : {source}",
                    nouvelle.as_str()
                ),
                magasin,
                &ecrits,
            ));
        }
        // Consigné **immédiatement** : à partir d'ici, un échec doit défaire cette écriture.
        ecrits.push(nouvelle.clone());

        // **Relire avant de compter dessus**, et comparer : un magasin qui accepte l'écriture sans la
        // garder — un profil verrouillé, un disque plein — ferait perdre le mot de passe au moment où
        // l'on efface l'original.
        match magasin.retrieve(nouvelle) {
            Ok(Some(relu)) if relu == secret => {}
            Ok(_) => {
                return Err(abandon(
                    format!(
                        "le mot de passe rangé sous « {} » ne se relit pas",
                        nouvelle.as_str()
                    ),
                    magasin,
                    &ecrits,
                ));
            }
            Err(source) => {
                return Err(abandon(
                    format!(
                        "le mot de passe rangé sous « {} » ne se relit pas : {source}",
                        nouvelle.as_str()
                    ),
                    magasin,
                    &ecrits,
                ));
            }
        }

        // **Dédoublonnées** : deux couples peuvent porter la même ancienne référence (le triplet de
        // `a/b` › `c` est celui de `a` › `b/c`). Chacun a copié la même valeur ; l'original ne
        // s'efface qu'une fois.
        if !a_effacer.contains(ancienne) {
            a_effacer.push(ancienne.clone());
        }
    }

    if let Err(raison) = ecrire() {
        return Err(abandon(
            format!("la configuration migrée n'a pas pu être écrite : {raison}"),
            magasin,
            &ecrits,
        ));
    }

    // **La phase destructive, en dernier.** Un échec ici ne compromet rien : la migration a eu lieu,
    // il reste un orphelin sous l'ancienne référence.
    for ancienne in a_effacer {
        if let Err(erreur) = magasin.delete(&ancienne) {
            log::warn!(
                "migration des mots de passe : l'ancienne référence « {} » n'a pas pu être \
                 effacée ({erreur})",
                ancienne.as_str()
            );
            rapport.residus.push(ancienne.as_str().to_owned());
        }
    }

    Ok(rapport)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::config::doubles::{MagasinCapricieux, MagasinOublieux, MagasinSync};
    use crate::config::migration::migrer_vers_la_v7;
    use crate::config::store::{ConfigStore, LoadOutcome, StoreError, VERSION_COURANTE};
    use crate::secrets::{EncryptedFileStore, Secret};

    /// Un fichier v6 à trois mots de passe — deux environnements d'un projet, et un second projet —,
    /// sous les références triplets qu'une version antérieure écrivait.
    const V6: &str = r#"{
      "version": 6,
      "projects": [
        { "name": "Halle",
          "environments": [
            { "id": "dev", "label": "dev", "color": "green", "production": false },
            { "id": "prod", "label": "prod", "color": "red", "production": true } ],
          "databases": [
            { "name": "analytics", "engine": "postgresql", "environment": "dev",
              "connection": { "host": "dev.interne", "port": 5432, "defaultDatabase": "a",
                "username": "dora", "password": "Halle/analytics/dev", "sslMode": "require",
                "readOnly": false, "reconnectOnStartup": false, "tunnel": null } },
            { "name": "analytics", "engine": "postgresql", "environment": "prod",
              "connection": { "host": "prod.interne", "port": 5432, "defaultDatabase": "a",
                "username": "dora", "password": "Halle/analytics/prod", "sslMode": "require",
                "readOnly": false, "reconnectOnStartup": false, "tunnel": null } } ] },
        { "name": "Atelier",
          "environments": [ { "id": "dev", "label": "dev", "color": "green", "production": false } ],
          "databases": [
            { "name": "jetons", "engine": "postgresql", "environment": "dev",
              "connection": { "host": "localhost", "port": 5432, "defaultDatabase": "j",
                "username": "dora", "password": "Atelier/jetons/dev", "sslMode": "require",
                "readOnly": false, "reconnectOnStartup": false, "tunnel": null } } ] }
      ]
    }"#;

    const ANCIENNES: [(&str, &str); 3] = [
        ("Halle/analytics/dev", "mdp-dev"),
        ("Halle/analytics/prod", "mdp-prod"),
        ("Atelier/jetons/dev", "mdp-jetons"),
    ];

    struct Decor {
        _dossier: tempfile::TempDir,
        config: PathBuf,
        magasin: EncryptedFileStore,
    }

    /// Le fichier v6 sur disque, et un **vrai** magasin chiffré garni sous les anciennes références.
    fn decor() -> Decor {
        let dossier = tempfile::tempdir().expect("dossier temporaire");
        let config = dossier.path().join("config.json");
        std::fs::write(&config, V6).expect("écriture du fichier v6");
        let magasin = EncryptedFileStore::new(dossier.path().join("secrets")).expect("magasin");
        for (reference, valeur) in ANCIENNES {
            magasin
                .store(&SecretRef::new(reference), &Secret::new(valeur))
                .expect("garnissage");
        }
        Decor {
            _dossier: dossier,
            config,
            magasin,
        }
    }

    /// Le plan que la migration rend pour ce fichier — les nouvelles références sont déterministes.
    fn plan() -> PlanDeSecrets {
        let valeur: serde_json::Value = serde_json::from_str(V6).expect("JSON");
        migrer_vers_la_v7(valeur, 6)
            .expect("migration")
            .secrets_a_deplacer
    }

    fn lire(magasin: &dyn SecretStore, reference: &str) -> Option<String> {
        magasin
            .retrieve(&SecretRef::new(reference))
            .expect("relecture")
            .map(|secret| secret.expose().to_owned())
    }

    fn ouvrir(chemin: &Path, magasin: &dyn SecretStore) -> (ConfigStore, LoadOutcome) {
        ConfigStore::ouvrir(chemin, || {
            Ok(Box::new(Relais(magasin)) as Box<dyn SecretStore + '_>)
        })
    }

    /// Un emprunt de magasin présenté comme un magasin, pour `ConfigStore::ouvrir`.
    struct Relais<'a>(&'a dyn SecretStore);

    impl SecretStore for Relais<'_> {
        fn store(&self, r: &SecretRef, s: &Secret) -> Result<(), crate::secrets::SecretError> {
            self.0.store(r, s)
        }
        fn retrieve(&self, r: &SecretRef) -> Result<Option<Secret>, crate::secrets::SecretError> {
            self.0.retrieve(r)
        }
        fn delete(&self, r: &SecretRef) -> Result<(), crate::secrets::SecretError> {
            self.0.delete(r)
        }
    }

    fn version_sur_disque(chemin: &Path) -> u64 {
        let valeur: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(chemin).expect("lecture")).expect("JSON");
        valeur["version"].as_u64().expect("version")
    }

    #[test]
    fn une_migration_reussie_deplace_les_mots_de_passe_et_ecrit_la_v7() {
        let decor = decor();
        let (_, issue) = ouvrir(&decor.config, &decor.magasin);

        let LoadOutcome::Loaded {
            tree,
            migration: None,
            ..
        } = issue
        else {
            panic!("la migration devait aboutir : {issue:?}");
        };
        assert_eq!(
            version_sur_disque(&decor.config),
            u64::from(VERSION_COURANTE)
        );
        // Chaque connexion lit son mot de passe **sous sa nouvelle référence**, la même valeur.
        for ((ancienne, valeur), (_, nouvelle)) in ANCIENNES.iter().zip(plan().couples()) {
            assert_eq!(
                lire(&decor.magasin, nouvelle.as_str()).as_deref(),
                Some(*valeur)
            );
            assert_eq!(
                lire(&decor.magasin, ancienne),
                None,
                "{ancienne} doit être effacée"
            );
        }
        for (base, _) in tree.connexions() {
            assert_eq!(
                base.connection.password,
                Some(crate::config::reference_de_connexion(&base.id))
            );
        }
    }

    /// **Le test du cadrage** : un vrai magasin chiffré, la deuxième écriture refusée.
    ///
    /// Sabotage vérifié : effacer l'original sitôt la copie faite — l'erreur que `renommer_projet` a
    /// commise autrefois — fait tomber la première assertion.
    #[test]
    fn un_echec_au_milieu_laisse_les_originaux_et_le_fichier_intacts() {
        let decor = decor();
        let capricieux = MagasinCapricieux::nouveau(&decor.magasin, 2);
        let (store, issue) = ouvrir(&decor.config, &capricieux);

        for (reference, valeur) in ANCIENNES {
            assert_eq!(
                lire(&decor.magasin, reference).as_deref(),
                Some(valeur),
                "l'original {reference} doit rester lisible"
            );
        }
        for (_, nouvelle) in plan().couples() {
            assert_eq!(
                lire(&decor.magasin, nouvelle.as_str()),
                None,
                "la copie {} doit avoir été retirée",
                nouvelle.as_str()
            );
        }
        assert_eq!(
            std::fs::read_to_string(&decor.config).expect("lecture"),
            V6,
            "le fichier doit être resté la v6, octet pour octet"
        );
        let LoadOutcome::SecretsMigrationFailed { reason } = issue else {
            panic!("l'issue doit dire l'échec : {issue:?}");
        };
        assert!(reason.contains("relancez DoraBase"), "{reason}");
        assert!(matches!(
            store.save(
                &crate::config::FolderTree::default(),
                &crate::config::Preferences::default(),
                &[],
                &crate::config::Kubeconfigs::default()
            ),
            Err(StoreError::EcritureRefusee { .. })
        ));
        assert!(store.load_tree().is_err(), "la lecture aussi est refusée");
    }

    #[test]
    fn rejouer_apres_un_crash_entre_la_copie_et_l_ecriture_rend_le_meme_etat() {
        // Le « crash » : toutes les copies sont faites, la configuration n'a pas été écrite, et
        // personne n'a rien retiré. Le fichier est resté en v6.
        let decor = decor();
        for ((_, valeur), (_, nouvelle)) in ANCIENNES.iter().zip(plan().couples()) {
            decor
                .magasin
                .store(nouvelle, &Secret::new(*valeur))
                .expect("copie");
        }

        let (_, issue) = ouvrir(&decor.config, &decor.magasin);
        assert!(
            matches!(
                issue,
                LoadOutcome::Loaded {
                    migration: None,
                    ..
                }
            ),
            "{issue:?}"
        );
        for ((ancienne, valeur), (_, nouvelle)) in ANCIENNES.iter().zip(plan().couples()) {
            assert_eq!(
                lire(&decor.magasin, nouvelle.as_str()).as_deref(),
                Some(*valeur)
            );
            assert_eq!(lire(&decor.magasin, ancienne), None);
        }
    }

    #[test]
    fn un_magasin_qui_n_a_pas_garde_la_copie_fait_abandonner() {
        let decor = decor();
        let oublieux = MagasinOublieux {
            interieur: &decor.magasin,
            oubliee: plan().couples()[1].1.as_str().to_owned(),
        };
        let (_, issue) = ouvrir(&decor.config, &oublieux);

        assert!(
            matches!(issue, LoadOutcome::SecretsMigrationFailed { .. }),
            "{issue:?}"
        );
        for (reference, valeur) in ANCIENNES {
            assert_eq!(lire(&decor.magasin, reference).as_deref(), Some(valeur));
        }
        assert_eq!(std::fs::read_to_string(&decor.config).expect("lecture"), V6);
    }

    #[test]
    fn un_mot_de_passe_absent_ne_bloque_pas_la_migration() {
        let decor = decor();
        decor
            .magasin
            .delete(&SecretRef::new("Halle/analytics/prod"))
            .expect("retrait");
        let (_, issue) = ouvrir(&decor.config, &decor.magasin);
        assert!(
            matches!(
                issue,
                LoadOutcome::Loaded {
                    migration: None,
                    ..
                }
            ),
            "un secret introuvable n'est pas illisible : {issue:?}"
        );
        assert_eq!(
            version_sur_disque(&decor.config),
            u64::from(VERSION_COURANTE)
        );
    }

    #[test]
    fn un_lancement_apres_migration_ne_touche_pas_au_magasin() {
        let decor = decor();
        let _ = ouvrir(&decor.config, &decor.magasin);
        let (_, issue) = ConfigStore::ouvrir(&decor.config, || {
            panic!("aucun mot de passe à déplacer : le magasin ne doit pas être demandé")
        });
        assert!(matches!(
            issue,
            LoadOutcome::Loaded {
                migration: None,
                ..
            }
        ));
    }

    #[test]
    fn deux_couples_sur_la_meme_ancienne_reference_n_effacent_qu_une_fois() {
        // La collision `a/b` › `c` et `a` › `b/c` : deux copies de la même valeur, un seul
        // effacement — un second échouerait sur une entrée déjà partie, et se dirait résidu.
        let magasin = MagasinSync::default();
        magasin.poser("a/b/c", "partage");
        let plan = PlanDeSecrets(vec![
            (SecretRef::new("a/b/c"), SecretRef::new("connexion/un")),
            (SecretRef::new("a/b/c"), SecretRef::new("connexion/deux")),
        ]);
        let rapport = deplacer_les_secrets(&plan, &magasin, &mut || Ok(())).expect("déplacement");

        assert_eq!(rapport, RapportDeDeplacement::default());
        assert_eq!(magasin.references(), vec!["connexion/deux", "connexion/un"]);
        assert_eq!(magasin.valeur("connexion/deux").as_deref(), Some("partage"));
    }

    #[test]
    fn une_ecriture_de_configuration_refusee_retire_les_copies() {
        let magasin = MagasinSync::default();
        magasin.poser("a/b/c", "valeur");
        let plan = PlanDeSecrets(vec![(
            SecretRef::new("a/b/c"),
            SecretRef::new("connexion/un"),
        )]);
        let erreur = deplacer_les_secrets(&plan, &magasin, &mut || Err("disque plein".to_owned()))
            .expect_err("l'écriture refusée doit faire abandonner");
        assert!(erreur.repris);
        assert_eq!(magasin.references(), vec!["a/b/c"]);
    }
}
