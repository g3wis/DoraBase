//! Les cinq gestes qui modifient les environnements d'un projet (`23c`).
//!
//! # Pourquoi cinq fonctions, et non un `mettre_a_jour_projet`
//!
//! Une fonction qui recevrait la liste entière ne peut pas distinguer un **renommage** d'une
//! suppression suivie d'une création — et les deux ne font pas la même chose au trousseau : le
//! premier ne touche à aucun secret, la seconde en efface autant qu'il y avait de connexions. C'est
//! la leçon de `08i`, où renommer un projet *déplace* ses mots de passe : la garantie appartenait au
//! geste, pas à l'état d'arrivée.
//!
//! # Ce qu'aucune de ces fonctions ne fait
//!
//! **Aucune ne revérifie ce que le modèle vérifie déjà.** Un identifiant en doublon, un actif
//! inconnu, un projet sans environnement : `Project::valider` les refuse (`23a`), et chaque geste
//! valide un **candidat** avant de le substituer — le motif de `mettre_a_jour`, pour qu'un modèle à
//! moitié muté n'existe jamais, même le temps d'une ligne.
//!
//! **Aucune ne touche à une base distante**, et la signature le dit : pas de moteur, pas de
//! connexion, pas de SQL. Seule `supprimer` reçoit le magasin de secrets, parce qu'elle seule en
//! efface.

use super::model::{
    Database, EnvironmentColor, EnvironmentDeclaration, EnvironmentId, ModelError, Project,
};
use crate::secrets::SecretStore;

/// L'échec d'un geste sur les environnements.
#[derive(Debug)]
pub enum EnvError {
    ProjetInconnu {
        project: String,
    },
    EnvironnementInconnu {
        project: String,
        environment: String,
    },
    LibelleVide,
    /// Le dernier environnement d'un projet ne se retire pas (`23c`).
    DernierEnvironnement {
        project: String,
    },
    /// L'ordre demandé n'est pas une permutation des environnements déclarés.
    OrdreIncomplet,
    /// Ce que le modèle a refusé — doublon d'identifiant, actif inconnu (`23a`).
    Modele {
        reason: String,
    },
    Config {
        reason: String,
    },
}

impl std::fmt::Display for EnvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProjetInconnu { project } => write!(f, "le projet « {project} » n'existe pas"),
            Self::EnvironnementInconnu {
                project,
                environment,
            } => write!(
                f,
                "« {project} » ne déclare aucun environnement « {environment} »"
            ),
            Self::LibelleVide => write!(f, "un environnement a besoin d'un libellé"),
            Self::DernierEnvironnement { project } => write!(
                f,
                "« {project} » n'aurait plus aucun environnement : une connexion appartient à un environnement, \
                 donc un projet sans environnement ne peut plus rien déclarer"
            ),
            Self::OrdreIncomplet => write!(
                f,
                "l'ordre demandé ne reprend pas exactement les environnements déclarés"
            ),
            Self::Modele { reason } | Self::Config { reason } => f.write_str(reason),
        }
    }
}

impl From<ModelError> for EnvError {
    fn from(erreur: ModelError) -> Self {
        Self::Modele {
            reason: erreur.to_string(),
        }
    }
}

/// Ce qu'une suppression d'environnement emporte (`23f`).
pub struct SuppressionEnv {
    pub projects: Vec<Project>,
    /// Les connexions supprimées, **nommées** : c'est ce que la confirmation de `23f` affiche, et ce
    /// que le retour permet de redire après coup.
    pub connexions_supprimees: Vec<String>,
    /// Les clés de registre à fermer — leurs déclarations n'existent plus.
    pub cles_a_fermer: Vec<String>,
    /// Les mots de passe que le magasin n'a pas su effacer. **Dits, jamais tus** (`23f`).
    pub secrets_residuels: Vec<String>,
}

/// Localise un projet, ou dit lequel manque.
fn index_du_projet(projects: &[Project], project: &str) -> Result<usize, EnvError> {
    projects
        .iter()
        .position(|projet| projet.name == project)
        .ok_or_else(|| EnvError::ProjetInconnu {
            project: project.to_owned(),
        })
}

/// Localise une déclaration dans un projet.
fn rang_de_l_environnement(
    projet: &Project,
    environnement: &EnvironmentId,
) -> Result<usize, EnvError> {
    projet
        .environments
        .iter()
        .position(|declaration| &declaration.id == environnement)
        .ok_or_else(|| EnvError::EnvironnementInconnu {
            project: projet.name.clone(),
            environment: environnement.as_str().to_owned(),
        })
}

/// Applique une mutation à un projet : candidat validé, substitué, écrit.
///
/// **Le seul chemin d'écriture des quatre gestes non destructeurs.** Les répéter quatre fois aurait
/// laissé quatre occasions d'oublier la validation — et c'est la validation qui porte les invariants
/// de `23a`.
fn muter(
    projects: &[Project],
    project: &str,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
    mutation: impl FnOnce(&mut Project) -> Result<(), EnvError>,
) -> Result<Vec<Project>, EnvError> {
    let index = index_du_projet(projects, project)?;
    let mut suivants = projects.to_vec();
    let mut candidat = suivants[index].clone();
    mutation(&mut candidat)?;
    candidat.valider()?;
    suivants[index] = candidat;
    ecrire(&suivants).map_err(|reason| EnvError::Config { reason })?;
    Ok(suivants)
}

/// Déclare un environnement de plus.
///
/// **L'identifiant est dérivé du libellé, et un doublon est refusé** — non suffixé. Un `prod-2`
/// fabriqué en douce donnerait deux lignes appelées « prod » dans le sélecteur, distinguables par
/// rien de visible, et deux références de trousseau que seul un humain saurait rattacher.
pub fn creer(
    projects: &[Project],
    project: &str,
    libelle: &str,
    couleur: EnvironmentColor,
    production: bool,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Vec<Project>, EnvError> {
    let libelle = libelle.trim();
    if libelle.is_empty() {
        return Err(EnvError::LibelleVide);
    }
    muter(projects, project, ecrire, |candidat| {
        candidat.environments.push(EnvironmentDeclaration {
            id: EnvironmentId::depuis_le_libelle(libelle),
            label: libelle.to_owned(),
            color: couleur,
            production,
        });
        Ok(())
    })
}

/// Change le libellé d'un environnement — **jamais son identifiant** (`23a`).
///
/// La référence d'un mot de passe dans le trousseau est
/// `dorabase/<projet>/<base>/<environnement>` : dériver un nouvel identifiant du nouveau libellé
/// rendrait introuvables tous les secrets de cet environnement. Le libellé est ce qui s'affiche,
/// l'identifiant ce qui désigne ; c'est le renommage qui les fait diverger, et c'est assumé.
pub fn renommer(
    projects: &[Project],
    project: &str,
    environnement: &EnvironmentId,
    libelle: &str,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Vec<Project>, EnvError> {
    let libelle = libelle.trim();
    if libelle.is_empty() {
        return Err(EnvError::LibelleVide);
    }
    muter(projects, project, ecrire, |candidat| {
        let rang = rang_de_l_environnement(candidat, environnement)?;
        candidat.environments[rang].label = libelle.to_owned();
        Ok(())
    })
}

/// Change la couleur et le drapeau de production.
///
/// **Les deux ensemble, et non deux gestes** : ce sont les deux réglages d'apparence d'une ligne, et
/// aucun des deux n'a de conséquence différée — à la différence du libellé, dont l'identifiant
/// dépend, et de la suppression, qui emporte des connexions.
pub fn recolorier(
    projects: &[Project],
    project: &str,
    environnement: &EnvironmentId,
    couleur: EnvironmentColor,
    production: bool,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Vec<Project>, EnvError> {
    muter(projects, project, ecrire, |candidat| {
        let rang = rang_de_l_environnement(candidat, environnement)?;
        candidat.environments[rang].color = couleur;
        candidat.environments[rang].production = production;
        Ok(())
    })
}

/// Réordonne les environnements : c'est l'ordre du sélecteur de la barre de titre.
///
/// **L'ordre demandé doit être une permutation exacte des identifiants déclarés.** Un ordre partiel
/// serait interprétable de plusieurs façons — les absents devant, derrière, ou supprimés ? — et la
/// troisième lecture ferait d'un glissement une suppression silencieuse.
pub fn reordonner(
    projects: &[Project],
    project: &str,
    ordre: &[EnvironmentId],
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Vec<Project>, EnvError> {
    muter(projects, project, ecrire, |candidat| {
        if ordre.len() != candidat.environments.len() {
            return Err(EnvError::OrdreIncomplet);
        }
        let mut reordonnes = Vec::with_capacity(ordre.len());
        for identifiant in ordre {
            let rang = rang_de_l_environnement(candidat, identifiant)?;
            let declaration = candidat.environments[rang].clone();
            // Un identifiant répété dans la demande passerait deux fois par ce chemin et rendrait
            // une liste de la bonne longueur mais amputée d'un environnement — donc de ses
            // connexions. `reordonnes` sert de témoin.
            if reordonnes
                .iter()
                .any(|deja: &EnvironmentDeclaration| deja.id == declaration.id)
            {
                return Err(EnvError::OrdreIncomplet);
            }
            reordonnes.push(declaration);
        }
        candidat.environments = reordonnes;
        Ok(())
    })
}

/// Retire un environnement, **et les connexions qui lui appartiennent** (`23f`).
///
/// # L'ordre des deux phases
///
/// La configuration est écrite d'abord, les secrets effacés ensuite — comme `08i` et `08j`, et pour
/// la raison qui leur a été apprise : dans l'ordre inverse, une écriture qui échoue laisse des bases
/// **déclarées sans leur mot de passe**, qui le redemandent à la prochaine connexion sans que rien
/// l'explique. Dans cet ordre, une écriture qui échoue ne laisse rien derrière.
///
/// # Ce qu'un secret récalcitrant ne fait pas
///
/// Il **n'annule pas** la suppression. L'inverse laisserait l'utilisateur devant un environnement
/// qu'il ne peut pas retirer parce qu'une entrée du trousseau résiste — indélébile pour une raison
/// qui ne le concerne pas. Les résidus sont rendus, et l'écran les dit.
pub fn supprimer(
    projects: &[Project],
    project: &str,
    environnement: &EnvironmentId,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<SuppressionEnv, EnvError> {
    let index = index_du_projet(projects, project)?;
    let rang = rang_de_l_environnement(&projects[index], environnement)?;
    if projects[index].environments.len() == 1 {
        return Err(EnvError::DernierEnvironnement {
            project: project.to_owned(),
        });
    }

    let mut suivants = projects.to_vec();
    let mut candidat = suivants[index].clone();
    candidat.environments.remove(rang);

    // Les connexions partent **avec** la déclaration : sans cela, `valider` refuserait la
    // configuration (une connexion dans un environnement non déclaré), et le geste serait
    // impossible sans que l'écran sache pourquoi.
    let emportees: Vec<Database> = candidat
        .databases
        .iter()
        .filter(|base| &base.environment == environnement)
        .cloned()
        .collect();
    candidat
        .databases
        .retain(|base| &base.environment != environnement);

    candidat.valider()?;
    suivants[index] = candidat;

    ecrire(&suivants).map_err(|reason| EnvError::Config { reason })?;

    let mut connexions_supprimees = Vec::new();
    let mut cles_a_fermer = Vec::new();
    let mut secrets_residuels = Vec::new();
    for base in &emportees {
        connexions_supprimees.push(base.name.clone());
        cles_a_fermer.push(crate::engine::registry::cle(
            project,
            &base.name,
            base.environment.as_str(),
        ));
        // La référence **déclarée**, pas une recalculée : une connexion dont la référence a été
        // posée autrement garderait sinon son secret. Même raison qu'en `08j`.
        if let Some(reference) = &base.connection.password {
            if magasin.delete(reference).is_err() {
                secrets_residuels.push(reference.as_str().to_owned());
            }
        }
    }

    Ok(SuppressionEnv {
        projects: suivants,
        connexions_supprimees,
        cles_a_fermer,
        secrets_residuels,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;
    use crate::config::model::{Engine, SecretRef, SslMode};
    use crate::secrets::{Secret, SecretError};

    /// Un magasin en mémoire, dont la suppression peut être rendue défaillante.
    ///
    /// Le magasin de `enregistrer` est privé à ses propres tests ; le redire ici en huit lignes coûte
    /// moins que de rendre l'autre public pour un module voisin.
    struct Magasin(Mutex<HashMap<String, String>>, bool);

    impl SecretStore for Magasin {
        fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
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
            if self.1 {
                return Err(SecretError::Magasin {
                    detail: "suppression impossible".into(),
                });
            }
            self.0.lock().expect("magasin").remove(reference.as_str());
            Ok(())
        }
    }

    fn magasin(defaillant: bool) -> Magasin {
        Magasin(Mutex::new(HashMap::new()), defaillant)
    }

    fn declaration(
        libelle: &str,
        couleur: EnvironmentColor,
        production: bool,
    ) -> EnvironmentDeclaration {
        EnvironmentDeclaration {
            id: EnvironmentId::depuis_le_libelle(libelle),
            label: libelle.to_owned(),
            color: couleur,
            production,
        }
    }

    /// Une connexion du décor. **Aucun nom réel** : les noms sont inventés, l'hôte est `localhost`.
    fn connexion(nom: &str, environnement: &str, secret: Option<&str>) -> Database {
        Database {
            name: nom.to_owned(),
            engine: Engine::PostgreSql,
            environment: EnvironmentId::brut(environnement),
            connection: crate::config::model::ConnectionSettings {
                host: "localhost".into(),
                port: 5432,
                default_database: nom.to_owned(),
                username: "lecteur".into(),
                password: secret.map(SecretRef::new),
                ssl_mode: SslMode::Prefer,
                ca_certificate: None,
                auth_database: None,
                read_only: true,
                reconnect_on_startup: false,
                tunnel: None,
            },
            consoles: Vec::new(),
        }
    }

    /// Trois environnements inventés, deux connexions dans « vitrine », une dans « atelier ».
    fn projets() -> Vec<Project> {
        vec![Project {
            name: "Atelier Nord".into(),
            environments: vec![
                declaration("atelier", EnvironmentColor::Green, false),
                declaration("vitrine", EnvironmentColor::Red, true),
                declaration("coulisses", EnvironmentColor::Slate, false),
            ],
            databases: vec![
                connexion("catalogue", "atelier", None),
                connexion(
                    "catalogue",
                    "vitrine",
                    Some("dorabase/Atelier Nord/catalogue/vitrine"),
                ),
                connexion(
                    "reservations",
                    "vitrine",
                    Some("dorabase/Atelier Nord/reservations/vitrine"),
                ),
            ],
            queries: Vec::new(),
        }]
    }

    /// Une écriture qui réussit, et qui **retient** ce qu'on lui a donné.
    fn ecriture(
        recu: &mut Option<Vec<Project>>,
    ) -> impl FnMut(&[Project]) -> Result<(), String> + '_ {
        move |projets| {
            *recu = Some(projets.to_vec());
            Ok(())
        }
    }

    // --- Créer ---

    #[test]
    fn creer_ajoute_un_environnement_et_derive_son_identifiant() {
        let mut ecrit = None;
        let suivants = creer(
            &projets(),
            "Atelier Nord",
            "Bac à sable",
            EnvironmentColor::Violet,
            false,
            &mut ecriture(&mut ecrit),
        )
        .expect("création");

        assert_eq!(suivants[0].environments.len(), 4);
        let ajoute = &suivants[0].environments[3];
        assert_eq!(ajoute.label, "Bac à sable");
        // **`bac-sable`, non `bac-a-sable`** : `depuis_le_libelle` (`23a`) ne garde que l'ASCII
        // alphanumérique, donc le « à » disparaît au lieu d'être translittéré, et les deux séparateurs
        // qui l'entourent se fondent en un. Le libellé affiché garde son accent ; c'est l'identifiant,
        // invisible, qui le perd. Deux libellés qui ne diffèrent que par un accent dériveraient donc
        // sur le même identifiant — et le modèle les refuse, avec sa raison.
        assert_eq!(ajoute.id.as_str(), "bac-sable");
        // Écrit, et non seulement calculé : une commande qui rendrait la liste sans la persister
        // afficherait un environnement qui disparaît au redémarrage.
        assert!(ecrit.is_some());
    }

    #[test]
    fn creer_refuse_un_libelle_qui_derive_sur_un_identifiant_deja_pris() {
        let mut ecrit = None;
        let erreur = creer(
            &projets(),
            "Atelier Nord",
            "Vitrine",
            EnvironmentColor::Amber,
            false,
            &mut ecriture(&mut ecrit),
        );

        // **Refusé par le modèle**, pas par cette fonction : `23c` le veut ainsi, et c'est ce qui
        // garantit qu'aucun autre chemin d'écriture ne peut installer le doublon.
        assert!(matches!(erreur, Err(EnvError::Modele { .. })));
        // Et rien n'a été écrit : la validation précède l'écriture.
        assert!(ecrit.is_none());
    }

    #[test]
    fn creer_refuse_un_libelle_vide() {
        let mut ecrit = None;
        let erreur = creer(
            &projets(),
            "Atelier Nord",
            "   ",
            EnvironmentColor::Amber,
            false,
            &mut ecriture(&mut ecrit),
        );
        assert!(matches!(erreur, Err(EnvError::LibelleVide)));
    }

    // --- Renommer ---

    #[test]
    fn renommer_change_le_libelle_et_garde_l_identifiant_et_les_secrets() {
        let magasin = magasin(false);
        let reference = SecretRef::new("dorabase/Atelier Nord/catalogue/vitrine");
        magasin
            .store(&reference, &Secret::new("mot de passe"))
            .expect("pose");

        let mut ecrit = None;
        let suivants = renommer(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("vitrine"),
            "Boutique",
            &mut ecriture(&mut ecrit),
        )
        .expect("renommage");

        let vitrine = &suivants[0].environments[1];
        assert_eq!(vitrine.label, "Boutique");
        // **L'identifiant ne bouge pas** — c'est l'invariant de `23a`, et ce qui suit en est la
        // conséquence : la référence du trousseau le contient.
        assert_eq!(vitrine.id.as_str(), "vitrine");
        assert_eq!(
            suivants[0].databases[1].connection.password,
            Some(reference.clone())
        );
        assert!(magasin.retrieve(&reference).expect("lecture").is_some());
    }

    #[test]
    fn renommer_refuse_un_environnement_inconnu() {
        let mut ecrit = None;
        let erreur = renommer(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("entrepot"),
            "Entrepôt",
            &mut ecriture(&mut ecrit),
        );
        assert!(matches!(erreur, Err(EnvError::EnvironnementInconnu { .. })));
    }

    // --- Recolorier ---

    #[test]
    fn recolorier_change_la_couleur_et_le_drapeau_ensemble() {
        let mut ecrit = None;
        let suivants = recolorier(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("coulisses"),
            EnvironmentColor::Red,
            true,
            &mut ecriture(&mut ecrit),
        )
        .expect("recoloriage");

        assert_eq!(suivants[0].environments[2].color, EnvironmentColor::Red);
        assert!(suivants[0].environments[2].production);
    }

    // --- Réordonner ---

    #[test]
    fn reordonner_permute_les_declarations() {
        let mut ecrit = None;
        let suivants = reordonner(
            &projets(),
            "Atelier Nord",
            &[
                EnvironmentId::brut("vitrine"),
                EnvironmentId::brut("coulisses"),
                EnvironmentId::brut("atelier"),
            ],
            &mut ecriture(&mut ecrit),
        )
        .expect("réordonnancement");

        let ordre: Vec<&str> = suivants[0]
            .environments
            .iter()
            .map(|declaration| declaration.id.as_str())
            .collect();
        assert_eq!(ordre, ["vitrine", "coulisses", "atelier"]);
        // Les connexions n'ont pas bougé : réordonner est un réglage d'affichage.
        assert_eq!(suivants[0].databases.len(), 3);
    }

    #[test]
    fn reordonner_refuse_un_ordre_partiel() {
        let mut ecrit = None;
        let erreur = reordonner(
            &projets(),
            "Atelier Nord",
            &[EnvironmentId::brut("vitrine")],
            &mut ecriture(&mut ecrit),
        );
        assert!(matches!(erreur, Err(EnvError::OrdreIncomplet)));
    }

    #[test]
    fn reordonner_refuse_un_identifiant_repete() {
        let mut ecrit = None;
        // **De la bonne longueur, et pourtant amputé** : sans le témoin, cet ordre rendrait deux fois
        // « vitrine » et perdrait « coulisses » — donc un environnement, et ses connexions, par un
        // simple glissement.
        let erreur = reordonner(
            &projets(),
            "Atelier Nord",
            &[
                EnvironmentId::brut("vitrine"),
                EnvironmentId::brut("vitrine"),
                EnvironmentId::brut("atelier"),
            ],
            &mut ecriture(&mut ecrit),
        );
        assert!(matches!(erreur, Err(EnvError::OrdreIncomplet)));
        assert!(ecrit.is_none());
    }

    // --- Supprimer ---

    #[test]
    fn supprimer_emporte_les_connexions_les_nomme_et_efface_leurs_secrets() {
        let magasin = magasin(false);
        let garde = SecretRef::new("dorabase/Atelier Nord/catalogue/vitrine");
        let autre = SecretRef::new("dorabase/Atelier Nord/reservations/vitrine");
        magasin.store(&garde, &Secret::new("un")).expect("pose");
        magasin.store(&autre, &Secret::new("deux")).expect("pose");

        let mut ecrit = None;
        let issue = supprimer(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("vitrine"),
            &magasin,
            &mut ecriture(&mut ecrit),
        )
        .expect("suppression");

        assert_eq!(issue.connexions_supprimees, ["catalogue", "reservations"]);
        assert_eq!(issue.projects[0].environments.len(), 2);
        // La connexion homonyme de l'autre environnement **reste** : c'est tout l'objet de `23b`.
        assert_eq!(issue.projects[0].databases.len(), 1);
        assert_eq!(
            issue.projects[0].databases[0].environment.as_str(),
            "atelier"
        );
        assert!(magasin.retrieve(&garde).expect("lecture").is_none());
        assert!(magasin.retrieve(&autre).expect("lecture").is_none());
        assert!(issue.secrets_residuels.is_empty());
        assert_eq!(issue.cles_a_fermer.len(), 2);
    }

    #[test]
    fn supprimer_le_dernier_environnement_est_refuse_avec_sa_raison() {
        let mut projets = projets();
        projets[0].environments = vec![declaration("atelier", EnvironmentColor::Green, false)];
        projets[0].databases.clear();

        let mut ecrit = None;
        let erreur = supprimer(
            &projets,
            "Atelier Nord",
            &EnvironmentId::brut("atelier"),
            &magasin(false),
            &mut ecriture(&mut ecrit),
        );

        let Err(erreur) = erreur else {
            panic!("le dernier environnement ne doit pas se retirer");
        };
        assert!(matches!(erreur, EnvError::DernierEnvironnement { .. }));
        // La raison est dite, non seulement le refus : c'est ce que l'écran affiche.
        assert!(erreur.to_string().contains("plus aucun environnement"));
        assert!(ecrit.is_none());
    }

    #[test]
    fn un_secret_recalcitrant_n_annule_pas_la_suppression_et_se_dit() {
        let magasin = magasin(true);
        let mut ecrit = None;
        let issue = supprimer(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("vitrine"),
            &magasin,
            &mut ecriture(&mut ecrit),
        )
        .expect("suppression");

        // La déclaration est partie…
        assert_eq!(issue.projects[0].environments.len(), 2);
        // …et les deux secrets restés en place sont **nommés**.
        assert_eq!(issue.secrets_residuels.len(), 2);
    }

    #[test]
    fn une_ecriture_qui_echoue_n_efface_aucun_secret() {
        let magasin = magasin(false);
        let reference = SecretRef::new("dorabase/Atelier Nord/catalogue/vitrine");
        magasin.store(&reference, &Secret::new("un")).expect("pose");

        let erreur = supprimer(
            &projets(),
            "Atelier Nord",
            &EnvironmentId::brut("vitrine"),
            &magasin,
            &mut |_| Err("disque plein".to_owned()),
        );

        assert!(matches!(erreur, Err(EnvError::Config { .. })));
        // **L'ordre des deux phases est la garantie** : dans l'ordre inverse, la base resterait
        // déclarée sans son mot de passe et le redemanderait sans que rien l'explique.
        assert!(magasin.retrieve(&reference).expect("lecture").is_some());
    }

    #[test]
    fn les_cinq_gestes_refusent_un_projet_inconnu() {
        let mut ecrit = None;
        assert!(matches!(
            creer(
                &projets(),
                "Autre",
                "x",
                EnvironmentColor::Green,
                false,
                &mut ecriture(&mut ecrit)
            ),
            Err(EnvError::ProjetInconnu { .. })
        ));
        assert!(matches!(
            renommer(
                &projets(),
                "Autre",
                &EnvironmentId::brut("atelier"),
                "x",
                &mut ecriture(&mut ecrit)
            ),
            Err(EnvError::ProjetInconnu { .. })
        ));
        assert!(matches!(
            recolorier(
                &projets(),
                "Autre",
                &EnvironmentId::brut("atelier"),
                EnvironmentColor::Green,
                false,
                &mut ecriture(&mut ecrit)
            ),
            Err(EnvError::ProjetInconnu { .. })
        ));
        assert!(matches!(
            reordonner(&projets(), "Autre", &[], &mut ecriture(&mut ecrit)),
            Err(EnvError::ProjetInconnu { .. })
        ));
        assert!(matches!(
            supprimer(
                &projets(),
                "Autre",
                &EnvironmentId::brut("atelier"),
                &magasin(false),
                &mut ecriture(&mut ecrit)
            ),
            Err(EnvError::ProjetInconnu { .. })
        ));
    }
}
