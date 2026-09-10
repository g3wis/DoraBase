//! La déclaration d'une instance managée (`API-32`).
//!
//! **Le pendant d'`enregistrer.rs` pour un objet qui n'appartient à aucun projet.** Les deux
//! écritures y sont les mêmes — le secret dans le magasin, la déclaration dans le fichier — et le
//! même ordonnancement les gouverne : ranger le secret d'abord, écrire ensuite, et **reprendre le
//! secret** si l'écriture échoue. Ce module est séparé pour la raison qui a séparé `enregistrer.rs`
//! de `commands.rs` : cette logique se teste sans Tauri.

use crate::config::model::{ConnectionSettings, Engine, InstanceId, ManagedInstance, SecretRef};
use crate::secrets::{Secret, SecretError, SecretStore};

/// La référence sous laquelle ranger le mot de passe admin d'une instance.
///
/// **Deux segments là où une connexion en a trois** (`projet/base/environnement`), et c'est ce qui
/// rend les deux espaces disjoints sans convention de plus : un identifiant d'instance ne contient
/// ni `/` ni espace — `InstanceId` le dérive comme `EnvironmentId`, en n'y laissant que des lettres,
/// des chiffres et des tirets —, donc `instance/<id>` ne peut pas s'écrire comme un triplet.
///
/// Dérivée de l'identifiant, donc **stable et prévisible** : rouvrir la même instance retrouve son
/// secret sans qu'aucune table de correspondance soit persistée. C'est l'arbitrage de `reference_de`,
/// pour la même raison.
pub fn reference_de_instance(id: &InstanceId) -> SecretRef {
    SecretRef::new(format!("instance/{id}"))
}

/// Ce que la modale de déclaration envoie.
///
/// **Le mot de passe est en clair et séparé des réglages**, comme dans `SaveDatabaseRequest` : aucune
/// `SecretRef` n'existe avant que le secret soit rangé, et c'est le travail de ce module.
#[derive(Debug, Clone)]
pub struct DeclarationInstance<'a> {
    /// `None` déclare une instance neuve, `Some` modifie celle qui porte cet identifiant.
    ///
    /// **Un seul chemin pour les deux, contrairement à `enregistrer` / `mettre_a_jour`.** La
    /// séparation vaut là-bas parce que `enregistrer` doit *refuser* une base déjà déclarée, ce qui
    /// protège d'un écrasement par mégarde : l'identité d'une connexion est son nom, que
    /// l'utilisateur saisit, donc deux saisies peuvent se heurter. Ici l'identité est **dérivée et
    /// dédoublonnée** — deux instances homonymes donnent `pg-prod` et `pg-prod-2` —, donc il n'y a
    /// aucune collision à refuser, et deux fonctions n'auraient différé que par leur préambule.
    pub id: Option<InstanceId>,
    pub label: String,
    pub engine: Engine,
    pub connection: ConnectionSettings,
    pub production: bool,
    pub confirm_writes: bool,
    /// `None` laisse le mot de passe en place — un champ vide veut dire « inchangé », la règle de
    /// `mettre_a_jour`.
    pub password: Option<&'a Secret>,
}

/// Ce qui peut faire refuser la déclaration d'une instance.
#[derive(Debug)]
pub enum InstanceError {
    /// Un libellé vide, ou fait de seuls séparateurs : il n'y aurait rien à afficher dans la
    /// sidebar, et l'identifiant dérivé serait `env` pour tout le monde.
    LibelleVide,
    /// Le moteur n'est pas managé. **Nommé plutôt que générique** : « pas encore » et « jamais »
    /// sont deux choses, et c'est la modale qui le dit déjà en désactivant les trois autres.
    MoteurNonManage {
        engine: Engine,
    },
    /// L'identifiant visé n'existe pas — un désaccord entre l'écran et le disque, pas une saisie.
    Inconnue {
        id: InstanceId,
    },
    Secret(SecretError),
    /// Le fichier n'a pas pu être écrit. Le secret a été **repris** quand `secret_repris` le dit.
    Config {
        reason: String,
        secret_repris: bool,
    },
}

impl std::fmt::Display for InstanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LibelleVide => f.write_str("une instance a besoin d'un nom pour être déclarée."),
            Self::MoteurNonManage { engine } => write!(
                f,
                "DoraBase ne sait pas encore gérer une instance {}. PostgreSQL est le seul moteur \
                 managé pour l'instant.",
                engine.nom()
            ),
            Self::Inconnue { id } => write!(f, "l'instance « {id} » n'existe pas"),
            Self::Secret(erreur) => {
                write!(f, "le mot de passe n'a pas pu être rangé : {erreur}")
            }
            Self::Config {
                reason,
                secret_repris,
            } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")?;
                if *secret_repris {
                    write!(f, " (le mot de passe rangé a été retiré)")
                } else {
                    write!(
                        f,
                        " (attention : le mot de passe rangé n'a pas pu être retiré)"
                    )
                }
            }
        }
    }
}

impl std::error::Error for InstanceError {}

/// Déclare une instance, ou met à jour celle qu'on désigne.
///
/// # L'ordre des deux écritures, et pourquoi il ne change pas
///
/// Le secret part **avant** la configuration, et l'échec de la seconde le reprend. L'inverse
/// laisserait une déclaration qui référence un mot de passe absent : l'instance paraîtrait dans la
/// sidebar et refuserait de s'ouvrir, ce qui est le pire des deux états possibles. C'est
/// exactement l'ordonnancement d'`enregistrer`, et il n'y a pas de raison qu'il diffère ici.
pub fn declarer(
    instances: &[ManagedInstance],
    declaration: DeclarationInstance<'_>,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[ManagedInstance]) -> Result<(), String>,
) -> Result<Vec<ManagedInstance>, InstanceError> {
    let libelle = declaration.label.trim();
    if libelle.is_empty() {
        return Err(InstanceError::LibelleVide);
    }
    if !moteur_manage(declaration.engine) {
        return Err(InstanceError::MoteurNonManage {
            engine: declaration.engine,
        });
    }

    let mut suivantes = instances.to_vec();
    let (index, id) = match &declaration.id {
        Some(id) => {
            let index = suivantes
                .iter()
                .position(|instance| &instance.id == id)
                .ok_or_else(|| InstanceError::Inconnue { id: id.clone() })?;
            (Some(index), id.clone())
        }
        None => (None, identifiant_libre(instances, libelle)),
    };

    let reference = reference_de_instance(&id);
    // **Le secret n'est rangé que s'il est fourni.** Un formulaire d'édition rouvert et enregistré
    // sans retaper le mot de passe doit garder celui du Trousseau — la règle de `mettre_a_jour`.
    let secret_ecrit = match declaration.password {
        Some(secret) => {
            magasin
                .store(&reference, secret)
                .map_err(InstanceError::Secret)?;
            true
        }
        None => false,
    };

    let mut connection = declaration.connection;
    // La référence est posée par nous, jamais par l'écran : lui laisser composer la chaîne
    // dupliquerait la convention, et une convention dupliquée diverge (`08e`).
    connection.password = match (secret_ecrit, index.and_then(|i| instances.get(i))) {
        (true, _) => Some(reference.clone()),
        // Rien de neuf : on garde la référence de la déclaration précédente, s'il y en avait une.
        (false, Some(ancienne)) => ancienne.connection.password.clone(),
        // Une instance neuve sans mot de passe : `None`, et l'ouverture s'authentifiera sans.
        (false, None) => None,
    };

    let instance = ManagedInstance {
        id,
        label: libelle.to_owned(),
        engine: declaration.engine,
        connection,
        production: declaration.production,
        confirm_writes: declaration.confirm_writes,
    };

    match index {
        Some(index) => suivantes[index] = instance,
        None => suivantes.push(instance),
    }

    if let Err(reason) = ecrire(&suivantes) {
        // **Le secret est repris**, et l'échec de la reprise est dit : sans cela, l'utilisateur qui
        // réessaie ne sait pas si son mot de passe est resté quelque part.
        let secret_repris = !secret_ecrit || magasin.delete(&reference).is_ok();
        return Err(InstanceError::Config {
            reason,
            secret_repris,
        });
    }

    Ok(suivantes)
}

/// Ce qu'une suppression laisse derrière elle.
#[derive(Debug)]
pub struct SuppressionInstance {
    pub instances: Vec<ManagedInstance>,
    /// La clé du registre à fermer : le retrait doit couper la connexion ouverte, et son tunnel.
    pub cle_a_fermer: String,
    /// Vrai quand un secret n'a **pas** pu être retiré du magasin.
    ///
    /// **Rendu plutôt que tu** : un mot de passe qui survit à la déclaration qui le référençait est
    /// invisible et non nettoyable depuis l'application. La suppression réussit quand même — refuser
    /// de retirer une instance parce que le Trousseau a bronché laisserait une ligne qu'on ne peut
    /// plus enlever.
    pub secret_residuel: bool,
}

/// Retire une instance : sa déclaration, puis son secret.
///
/// **La configuration d'abord.** L'ordre est l'inverse de la déclaration, et pour la même raison :
/// ce qu'on ne veut jamais, c'est une déclaration qui référence un secret absent. Si le fichier
/// n'est pas écrit, l'instance reste entière, mot de passe compris.
pub fn retirer(
    instances: &[ManagedInstance],
    id: &InstanceId,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[ManagedInstance]) -> Result<(), String>,
) -> Result<SuppressionInstance, InstanceError> {
    let index = instances
        .iter()
        .position(|instance| &instance.id == id)
        .ok_or_else(|| InstanceError::Inconnue { id: id.clone() })?;

    let mut suivantes = instances.to_vec();
    let retiree = suivantes.remove(index);

    ecrire(&suivantes).map_err(|reason| InstanceError::Config {
        reason,
        secret_repris: false,
    })?;

    let secret_residuel = match &retiree.connection.password {
        Some(reference) => magasin.delete(reference).is_err(),
        None => false,
    };

    Ok(SuppressionInstance {
        instances: suivantes,
        cle_a_fermer: cle_de_registre(id),
        secret_residuel,
    })
}

/// La clé sous laquelle une instance vit au registre de connexions.
///
/// **Le même registre que les bases, et non un second.** Ce qu'il détient est un adaptateur ouvert
/// et le proxy qui va avec ; rien de cela ne dépend de ce que la connexion *désigne*. Un second
/// registre aurait dupliqué l'ouverture, la fermeture avec attente de port, les quatre états et leur
/// sérialisation — pour ranger le même objet ailleurs.
///
/// Deux segments, donc jamais confondue avec le triplet d'une base : voir `reference_de_instance`.
pub fn cle_de_registre(id: &InstanceId) -> String {
    format!("instance/{id}")
}

/// Les moteurs dont une instance se gère.
///
/// **Une fonction et non un `match` recopié** : le refus vit à trois endroits — ici, la commande
/// d'ouverture, et le répartiteur d'`AnyEngine` — et trois listes finiraient par diverger. Le
/// `match` reste exhaustif, sans bras attrape-tout : c'est la leçon du défaut n° 16, et un huitième
/// moteur fera échouer la compilation là où son auteur doit choisir.
pub fn moteur_manage(engine: Engine) -> bool {
    match engine {
        Engine::PostgreSql => true,
        // Les trois que la modale montre désactivés : leur gestion viendra, elle n'est pas écrite.
        Engine::MySql | Engine::MongoDb | Engine::Sqlite => false,
        // Les trois qui n'ont pas d'écran du tout — et pour SQLite ci-dessus, la notion de « rôles
        // du serveur » n'existe même pas : un fichier n'a pas d'utilisateurs.
        Engine::Redis | Engine::Snowflake | Engine::BigQuery => false,
    }
}

/// Un identifiant qui n'est pris par aucune instance : `pg-prod`, puis `pg-prod-2`, `pg-prod-3`…
///
/// **Ici la génération d'un suffixe est le bon geste, contrairement au refus d'une connexion en
/// double.** Ce que refuser protège, là-bas, c'est une *saisie* : le nom d'une base est ce que
/// l'utilisateur a tapé, et deux bases homonymes dans un même environnement sont très probablement
/// une erreur qu'il faut lui dire. Ici l'identifiant n'est jamais saisi — il est dérivé du libellé,
/// qui, lui, a parfaitement le droit d'être le même deux fois : deux instances peuvent s'appeler
/// « postgres local » sans que ce soit une faute.
fn identifiant_libre(instances: &[ManagedInstance], libelle: &str) -> InstanceId {
    let base = InstanceId::depuis_le_libelle(libelle);
    if instances.iter().all(|instance| instance.id != base) {
        return base;
    }
    for suffixe in 2u32.. {
        let candidat = InstanceId::brut(format!("{base}-{suffixe}"));
        if instances.iter().all(|instance| instance.id != candidat) {
            return candidat;
        }
    }
    unreachable!("la boucle rend un identifiant libre avant d'épuiser u32")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;
    use crate::config::model::SslMode;
    use crate::secrets::SecretStore;

    /// Un magasin en mémoire, qui peut refuser. Le patron de celui d'`enregistrer.rs`, et pour la
    /// même raison : provoquer les issues plutôt que d'en espérer deux.
    struct Magasin(Mutex<HashMap<String, String>>, bool, bool);

    impl SecretStore for Magasin {
        fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
            if self.1 {
                return Err(SecretError::Magasin {
                    detail: "magasin en panne".into(),
                });
            }
            self.0
                .lock()
                .expect("magasin")
                .insert(reference.as_str().to_owned(), secret.expose().to_owned());
            Ok(())
        }

        fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
            Ok(self
                .0
                .lock()
                .expect("magasin")
                .get(reference.as_str())
                .map(Secret::new))
        }

        fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
            if self.2 {
                return Err(SecretError::Magasin {
                    detail: "suppression impossible".into(),
                });
            }
            self.0.lock().expect("magasin").remove(reference.as_str());
            Ok(())
        }
    }

    fn magasin() -> Magasin {
        Magasin(Mutex::new(HashMap::new()), false, false)
    }

    fn reglages() -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".into(),
            port: 5432,
            default_database: "postgres".into(),
            username: "postgres".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn declaration(libelle: &str) -> DeclarationInstance<'static> {
        DeclarationInstance {
            id: None,
            label: libelle.to_owned(),
            engine: Engine::PostgreSql,
            connection: reglages(),
            production: false,
            confirm_writes: true,
            password: None,
        }
    }

    /// Écrit sans broncher.
    fn ecrit_bien() -> impl FnMut(&[ManagedInstance]) -> Result<(), String> {
        |_| Ok(())
    }

    #[test]
    fn declarer_derive_un_identifiant_du_libelle_et_le_fige() {
        let suivantes = declarer(&[], declaration("PG prod"), &magasin(), &mut ecrit_bien())
            .expect("déclaration");

        assert_eq!(suivantes[0].id.as_str(), "pg-prod");
        assert_eq!(suivantes[0].label, "PG prod");
    }

    #[test]
    fn deux_instances_de_meme_libelle_recoivent_deux_identifiants() {
        // **Un suffixe, et non un refus.** L'identifiant n'est jamais saisi : deux instances peuvent
        // légitimement s'appeler « postgres local ». C'est le nom d'une *connexion* qui est refusé
        // en double, parce que c'est une saisie et que le doublon y est presque toujours une erreur.
        let premiere =
            declarer(&[], declaration("PG"), &magasin(), &mut ecrit_bien()).expect("première");
        let deux =
            declarer(&premiere, declaration("PG"), &magasin(), &mut ecrit_bien()).expect("seconde");

        assert_eq!(
            deux.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["pg", "pg-2"]
        );
    }

    #[test]
    fn un_libelle_vide_est_refuse() {
        for vide in ["", "   ", "\t"] {
            let erreur = declarer(&[], declaration(vide), &magasin(), &mut ecrit_bien())
                .expect_err("un libellé vide doit être refusé");
            assert!(matches!(erreur, InstanceError::LibelleVide), "{erreur}");
        }
    }

    #[test]
    fn les_quatre_autres_moteurs_sont_refuses_nommement() {
        // **Le refus côté cœur n'est pas une redondance avec l'écran** : celui-ci cache ce qu'on ne
        // peut pas choisir, celui-là garde le chemin qui ne passe pas par l'écran — un fichier écrit
        // à la main, ou une déclaration faite par une version future.
        for moteur in [
            Engine::MySql,
            Engine::MongoDb,
            Engine::Sqlite,
            Engine::BigQuery,
        ] {
            let mut demande = declaration("x");
            demande.engine = moteur;
            let erreur = declarer(&[], demande, &magasin(), &mut ecrit_bien())
                .expect_err("un moteur non managé doit être refusé");
            // Le message **nomme le moteur** : « moteur non géré » n'apprendrait rien à qui vient de
            // cliquer sur MySQL.
            assert!(erreur.to_string().contains(moteur.nom()), "{erreur}");
        }
    }

    #[test]
    fn le_mot_de_passe_est_range_sous_la_reference_de_l_instance() {
        let magasin = magasin();
        let secret = Secret::new("s3cr3t");
        let mut demande = declaration("PG prod");
        demande.password = Some(&secret);

        let suivantes = declarer(&[], demande, &magasin, &mut ecrit_bien()).expect("déclaration");

        let reference = reference_de_instance(&InstanceId::brut("pg-prod"));
        assert_eq!(suivantes[0].connection.password.as_ref(), Some(&reference));
        assert_eq!(
            magasin
                .retrieve(&reference)
                .expect("relecture")
                .map(|s| s.expose().to_owned()),
            Some("s3cr3t".to_owned())
        );
    }

    #[test]
    fn la_reference_d_une_instance_ne_peut_pas_se_confondre_avec_celle_d_une_connexion() {
        // Deux segments contre trois. Un identifiant d'instance ne contient ni `/` ni espace — c'est
        // ce que la dérivation garantit —, donc les deux espaces sont disjoints sans convention de
        // plus.
        let reference = reference_de_instance(&InstanceId::brut("pg-prod"));
        assert_eq!(reference.as_str(), "instance/pg-prod");
        assert_eq!(reference.as_str().matches('/').count(), 1);
        assert_eq!(
            crate::config::reference_de("Halle", "analytics", "prod")
                .as_str()
                .matches('/')
                .count(),
            2
        );
    }

    #[test]
    fn modifier_sans_mot_de_passe_garde_celui_qui_est_range() {
        // La règle de `mettre_a_jour` : un champ vide veut dire « inchangé ». Sans elle, corriger un
        // port obligerait à retaper le mot de passe — et l'oublier l'effacerait.
        let magasin = magasin();
        let secret = Secret::new("s3cr3t");
        let mut premiere = declaration("PG");
        premiere.password = Some(&secret);
        let instances = declarer(&[], premiere, &magasin, &mut ecrit_bien()).expect("déclaration");

        let mut modification = declaration("PG");
        modification.id = Some(InstanceId::brut("pg"));
        modification.connection.port = 6543;
        let suivantes =
            declarer(&instances, modification, &magasin, &mut ecrit_bien()).expect("modification");

        assert_eq!(suivantes.len(), 1);
        assert_eq!(suivantes[0].connection.port, 6543);
        assert_eq!(
            suivantes[0]
                .connection
                .password
                .as_ref()
                .map(SecretRef::as_str),
            Some("instance/pg")
        );
    }

    #[test]
    fn une_ecriture_ratee_reprend_le_secret_qui_venait_d_etre_range() {
        // L'ordonnancement d'`enregistrer` : le secret part avant la configuration, et l'échec de
        // celle-ci le reprend. L'inverse laisserait une déclaration qui référence un mot de passe
        // absent — une instance visible qui refuse de s'ouvrir, le pire des deux états.
        let magasin = magasin();
        let secret = Secret::new("s3cr3t");
        let mut demande = declaration("PG");
        demande.password = Some(&secret);

        let erreur = declarer(&[], demande, &magasin, &mut |_| {
            Err("disque plein".to_owned())
        })
        .expect_err("l'écriture rate");

        match erreur {
            InstanceError::Config {
                secret_repris,
                reason,
            } => {
                assert!(secret_repris, "{reason}");
            }
            autre => panic!("issue inattendue : {autre}"),
        }
        assert_eq!(
            magasin
                .retrieve(&reference_de_instance(&InstanceId::brut("pg")))
                .expect("relecture"),
            None
        );
    }

    #[test]
    fn une_reprise_impossible_est_dite_plutot_que_tue() {
        // Sans cette phrase, l'utilisateur qui réessaie ne sait pas si son mot de passe est resté
        // quelque part.
        let magasin = Magasin(Mutex::new(HashMap::new()), false, true);
        let secret = Secret::new("s3cr3t");
        let mut demande = declaration("PG");
        demande.password = Some(&secret);

        let erreur = declarer(&[], demande, &magasin, &mut |_| {
            Err("disque plein".to_owned())
        })
        .expect_err("l'écriture rate");

        assert!(
            erreur.to_string().contains("n'a pas pu être retiré"),
            "{erreur}"
        );
    }

    #[test]
    fn retirer_rend_la_cle_de_registre_a_fermer() {
        // Une instance retirée sans fermeture laisserait un tunnel SSH vivant et un port lié, pour
        // une ligne qui n'existe plus.
        let magasin = magasin();
        let instances = declarer(&[], declaration("PG prod"), &magasin, &mut ecrit_bien())
            .expect("déclaration");

        let issue = retirer(
            &instances,
            &InstanceId::brut("pg-prod"),
            &magasin,
            &mut ecrit_bien(),
        )
        .expect("retrait");

        assert!(issue.instances.is_empty());
        assert_eq!(issue.cle_a_fermer, "instance/pg-prod");
        assert!(!issue.secret_residuel);
    }

    #[test]
    fn un_retrait_dont_le_secret_resiste_reussit_quand_meme_et_le_dit() {
        // Refuser de retirer parce que le Trousseau a bronché laisserait une ligne qu'on ne peut
        // plus enlever.
        let magasin = Magasin(Mutex::new(HashMap::new()), false, true);
        let secret = Secret::new("s3cr3t");
        let mut demande = declaration("PG");
        demande.password = Some(&secret);
        let instances = declarer(&[], demande, &magasin, &mut ecrit_bien()).expect("déclaration");

        let issue = retirer(
            &instances,
            &InstanceId::brut("pg"),
            &magasin,
            &mut ecrit_bien(),
        )
        .expect("le retrait aboutit malgré le secret");

        assert!(issue.instances.is_empty());
        assert!(issue.secret_residuel);
    }

    #[test]
    fn un_retrait_dont_l_ecriture_rate_ne_touche_pas_au_secret() {
        // L'ordre inverse de la déclaration, et pour la même raison : ce qu'on ne veut jamais est une
        // déclaration qui référence un secret absent.
        let magasin = magasin();
        let secret = Secret::new("s3cr3t");
        let mut demande = declaration("PG");
        demande.password = Some(&secret);
        let instances = declarer(&[], demande, &magasin, &mut ecrit_bien()).expect("déclaration");

        let erreur = retirer(&instances, &InstanceId::brut("pg"), &magasin, &mut |_| {
            Err("disque plein".to_owned())
        })
        .expect_err("l'écriture rate");
        assert!(matches!(erreur, InstanceError::Config { .. }), "{erreur}");

        assert!(
            magasin
                .retrieve(&reference_de_instance(&InstanceId::brut("pg")))
                .expect("relecture")
                .is_some(),
            "le secret doit survivre à une configuration non écrite"
        );
    }

    #[test]
    fn une_instance_inconnue_est_refusee_a_la_modification_comme_au_retrait() {
        let magasin = magasin();
        let mut demande = declaration("PG");
        demande.id = Some(InstanceId::brut("absente"));
        assert!(matches!(
            declarer(&[], demande, &magasin, &mut ecrit_bien()),
            Err(InstanceError::Inconnue { .. })
        ));
        assert!(matches!(
            retirer(
                &[],
                &InstanceId::brut("absente"),
                &magasin,
                &mut ecrit_bien()
            ),
            Err(InstanceError::Inconnue { .. })
        ));
    }

    #[test]
    fn seul_postgresql_est_manage() {
        // Le `match` de `moteur_manage` est exhaustif : ce test tombe si un huitième moteur y entre
        // sans que son auteur ait choisi. Les sept sont énumérés par `Engine::tous`, dont le propre
        // garde-fou casse la compilation à l'ajout.
        let manages: Vec<_> = Engine::tous()
            .into_iter()
            .filter(|moteur| moteur_manage(*moteur))
            .collect();
        assert_eq!(manages, vec![Engine::PostgreSql]);
    }
}
