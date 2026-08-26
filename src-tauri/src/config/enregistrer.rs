//! L'enregistrement d'une base dans un projet.
//!
//! **Deux écritures sur deux supports distincts**, dont l'une peut réussir quand l'autre
//! échoue. C'est tout le sujet de ce module, et la raison pour laquelle il est séparé de
//! `commands.rs` : la logique d'ordonnancement et de rattrapage se teste sans Tauri.

use crate::config::model::{
    ConnectionSettings, Console, Database, Engine, EnvironmentId, ModelError, Project, SecretRef,
};
use crate::config::query::validate;
use crate::secrets::{Secret, SecretError, SecretStore};

/// Ce qui peut faire refuser un enregistrement.
///
/// Les trois cas sont **distincts pour l'utilisateur** : un invariant violé se corrige dans le
/// formulaire, une panne de magasin est un problème de machine, et un échec d'écriture peut
/// venir d'un disque plein. Les fondre en une chaîne obligerait l'écran à deviner.
#[derive(Debug)]
pub enum SaveError {
    /// Un invariant de `05a` n'est pas tenu.
    Model(ModelError),
    /// Le magasin de secrets a refusé.
    Secret(SecretError),
    /// La configuration n'a pas pu être écrite. Le secret a été **repris**.
    Config { reason: String, secret_repris: bool },
    /// Le projet nommé n'existe pas. `A2` choisit parmi les projets existants, donc ce cas
    /// signale un désaccord entre l'écran et le disque — pas une faute de saisie.
    ProjetInconnu { project: String },
    /// La base n'existe pas dans ce projet — `mettre_a_jour` ne crée rien.
    BaseInconnue { project: String, database: String },
    /// La base existe, mais pas pour cet environnement.
    VarianteInconnue {
        database: String,
        environment: String,
    },
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Model(erreur) => write!(f, "{erreur}"),
            Self::Secret(erreur) => write!(f, "le mot de passe n'a pas pu être rangé : {erreur}"),
            Self::Config {
                reason,
                secret_repris,
            } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")?;
                if *secret_repris {
                    // Le dire : sans cela, l'utilisateur qui réessaie ne sait pas si son mot
                    // de passe est resté quelque part.
                    write!(f, " (le mot de passe rangé a été retiré)")
                } else {
                    write!(
                        f,
                        " (attention : le mot de passe rangé n'a pas pu être retiré)"
                    )
                }
            }
            Self::ProjetInconnu { project } => {
                write!(f, "le projet « {project} » n'existe pas")
            }
            Self::BaseInconnue { project, database } => {
                write!(
                    f,
                    "la base « {database} » n'existe pas dans le projet « {project} »"
                )
            }
            Self::VarianteInconnue {
                database,
                environment,
            } => {
                write!(
                    f,
                    "la base « {database} » n'a pas de variante « {environment} »"
                )
            }
        }
    }
}

/// La référence sous laquelle ranger le mot de passe d'une variante.
///
/// Dérivée du triplet projet / base / environnement, donc **stable et prévisible** : rouvrir
/// la même base retrouve son secret sans qu'aucune table de correspondance soit persistée. Un
/// identifiant aléatoire aurait exigé de le stocker, donc d'ajouter un état à garder cohérent
/// avec le magasin — précisément ce que ce module s'efforce d'éviter.
///
/// Les composants sont séparés par `/`, qui ne peut pas apparaître dans un nom de base ou de
/// projet du handoff… ce qui n'est pas garanti. La collision reste donc possible entre
/// « a/b » + « c » et « a » + « b/c ». Assumée : elle exigerait deux projets délibérément
/// nommés pour, et la conséquence serait de partager un mot de passe, non de le divulguer.
pub fn reference_de(project: &str, database: &str, environment: &str) -> SecretRef {
    SecretRef::new(format!("{project}/{database}/{environment}"))
}

/// Met à jour la variante d'une base **existante**.
///
/// **Distincte d'`enregistrer`, qui ajoute.** Celle-là refuse une base déjà là, et c'est ce qui
/// protège d'un écrasement par mégarde ; lui faire aussi la mise à jour effacerait cette garde.
/// Celle-ci fait l'inverse : elle **exige** que la base et la variante existent.
///
/// **Le nom, l'environnement et le moteur ne changent pas.** Le triplet
/// `projet/base/environnement` est à la fois la clé du registre (`09b`) et la référence du secret
/// (`08e`) : en changer un élément demanderait de déplacer le secret, de fermer la connexion
/// ouverte sous l'ancienne clé, et de traiter la collision avec une identité existante. Trois
/// effets de bord pour un renommage — une autre spec.
///
/// **Un mot de passe absent laisse le secret en place.** Sinon corriger un port obligerait à
/// retaper le mot de passe, et l'oublier l'effacerait.
pub fn mettre_a_jour(
    projects: &mut [Project],
    modification: Modification<'_>,
    store: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<(), SaveError> {
    let Modification {
        project: project_name,
        database: database_name,
        environment,
        reglages,
        password,
    } = modification;

    let index = projects
        .iter()
        .position(|projet| projet.name == project_name)
        .ok_or_else(|| SaveError::ProjetInconnu {
            project: project_name.to_owned(),
        })?;

    // **La connexion est identifiée par son nom *et* son environnement** (`23b`) : deux connexions
    // homonymes coexistent dans un projet, et n'en chercher qu'une par le nom modifierait la
    // première venue — celle de dev alors qu'on éditait celle de prod.
    let base = projects[index]
        .databases
        .iter()
        .position(|base| base.name == database_name && base.environment == environment)
        .ok_or_else(|| SaveError::BaseInconnue {
            project: project_name.to_owned(),
            database: database_name.to_owned(),
        })?;

    // Les réglages candidats gardent la **référence de secret** des anciens, que l'écran n'a pas à
    // connaître. L'environnement, lui, n'est plus dans les réglages : il appartient à la connexion, et
    // ne se change pas ici — le déplacer d'un environnement à l'autre déplacerait son mot de passe,
    // ce qui est un autre geste (`23d`, hors périmètre).
    let ancienne = projects[index].databases[base].connection.clone();
    let mut candidate = reglages.clone();
    candidate.password = ancienne.password.clone();

    // Un mot de passe fourni remplace le secret, et pose la référence si elle manquait — le cas
    // d'une base déclarée sans mot de passe à laquelle on en ajoute un.
    if let Some(secret) = password {
        let reference = ancienne
            .password
            .clone()
            .unwrap_or_else(|| reference_de(project_name, database_name, environment.as_str()));
        store.store(&reference, secret).map_err(SaveError::Secret)?;
        candidate.password = Some(reference);
    }

    let mut candidat = projects[index].clone();
    candidat.databases[base].connection = candidate;
    validate(&candidat).map_err(SaveError::Model)?;

    let ancien = std::mem::replace(&mut projects[index], candidat);
    if let Err(reason) = ecrire(projects) {
        // La configuration a échoué : on remet l'état d'avant. Le secret, lui, est déjà remplacé —
        // dit explicitement, comme `enregistrer` le fait pour son propre cas.
        projects[index] = ancien;
        return Err(SaveError::Config {
            reason,
            secret_repris: false,
        });
    }

    Ok(())
}

/// Ce qu'il y a à modifier.
/// L'échec d'un renommage de projet (`08i`).
#[derive(Debug)]
pub enum RenameError {
    /// Le projet nommé n'existe pas.
    Inconnu { project: String },
    /// Un nom vide, ou seulement des espaces.
    NomVide,
    /// Un autre projet porte déjà ce nom : les clés d'identité deviendraient ambiguës.
    DejaPris { project: String },
    /// La connexion nommée n'existe pas **dans cet environnement** (`26`). L'environnement est dans
    /// le message : « analytics n'existe pas » serait faux sous les yeux de quelqu'un qui la voit
    /// déclarée en dev.
    ConnexionInconnue {
        project: String,
        database: String,
        environment: String,
    },
    /// Une autre connexion du **même environnement** porte déjà ce nom (`23b`). Le même nom dans un
    /// autre environnement est, lui, le modèle même — d'où l'environnement dans le message.
    ConnexionPrise {
        database: String,
        environment: String,
    },
    /// Le magasin de secrets a refusé. **Les secrets déjà déplacés ont été remis en place.**
    Secret {
        source: SecretError,
        secrets_repris: bool,
    },
    /// La configuration n'a pas pu être écrite, après que les secrets ont été déplacés — donc
    /// remis en place, faute de quoi le projet garderait son nom sans ses mots de passe.
    Config {
        reason: String,
        secrets_repris: bool,
    },
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Inconnu { project } => write!(f, "le projet « {project} » n'existe pas"),
            // **Neutre depuis `26`** : le même enum sert au renommage d'un projet et à celui d'une
            // connexion, et le refus s'affiche là où l'utilisateur vient de taper — le contexte est
            // sous ses yeux, le mot « projet » ne l'était plus dans un cas sur deux.
            Self::NomVide => write!(f, "un nom ne peut pas être vide"),
            Self::DejaPris { project } => {
                write!(f, "un projet nommé « {project} » existe déjà")
            }
            Self::ConnexionInconnue {
                project,
                database,
                environment,
            } => write!(
                f,
                "le projet « {project} » ne déclare pas de connexion « {database} » en « {environment} »"
            ),
            Self::ConnexionPrise {
                database,
                environment,
            } => write!(
                f,
                "une connexion « {database} » est déjà déclarée en « {environment} »"
            ),
            Self::Secret {
                source,
                secrets_repris,
            } => {
                write!(f, "les mots de passe n'ont pas pu être déplacés : {source}")?;
                // **Le dire, toujours.** Sans cette phrase, l'utilisateur qui réessaie ne sait pas
                // si ses mots de passe sont restés lisibles — la même exigence que `SaveError`.
                if *secrets_repris {
                    write!(
                        f,
                        " (le renommage est annulé, les mots de passe sont intacts)"
                    )?;
                }
                Ok(())
            }
            Self::Config {
                reason,
                secrets_repris,
            } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")?;
                if *secrets_repris {
                    write!(
                        f,
                        " (le renommage est annulé, les mots de passe sont intacts)"
                    )?;
                }
                Ok(())
            }
        }
    }
}

/// Ce qu'un renommage réussi laisse à faire à l'appelant.
#[derive(Debug)]
pub struct Renommage {
    /// Les clés de registre à fermer : elles n'existent plus sous l'ancien nom.
    pub cles_a_fermer: Vec<String>,
    /// Les références dont le secret était **introuvable** — déclaré mais absent du magasin.
    ///
    /// Ce n'est pas un échec : voir `renommer_projet`.
    pub secrets_absents: Vec<String>,
    /// Les anciennes références que le magasin n'a pas su supprimer après coup : le renommage a
    /// bien eu lieu, il reste un doublon. Bénin, mais dit.
    pub residus: Vec<String>,
}

/// Renomme un projet, en **déplaçant ses secrets d'abord**.
///
/// Le nom d'un projet n'est pas une étiquette : `projet/base/environnement` identifie une connexion
/// dans le registre (`09b`) **et** un secret dans le Trousseau (`05c`). Renommer est donc une
/// migration, et l'ordre des trois effets est ce que cette fonction garantit :
///
/// 1. **Les secrets d'abord** — écrire le nouveau, vérifier qu'il se relit, supprimer l'ancien.
///    L'inverse laisserait une base sans mot de passe si l'écriture échouait.
/// 2. **La configuration en dernier** : c'est elle qui rend le renommage visible, et elle ne doit
///    devenir vraie qu'une fois les secrets en place.
/// 3. La fermeture des connexions appartient à l'appelant — elle attend le réseau, et cette
///    fonction reste synchrone et testable. Les clés sont rendues dans `Renommage`.
///
/// **Un échec remet en place ce qui a déjà bougé.** Un projet dont trois bases sur cinq ont migré
/// serait pire qu'un refus : deux bases inutilisables, et rien pour le dire.
///
/// **Un secret absent n'est pas un secret illisible**, et la distinction décide du sort du
/// renommage. Un magasin qui *refuse* (`Err`) annule tout : quelque chose ne fonctionne pas, et
/// continuer produirait un état inconnu. Un secret simplement *introuvable* (`Ok(None)`) — effacé à
/// la main, ou jamais écrit — laisse le renommage se poursuivre : l'interrompre rendrait le projet
/// **irrenommable**, exactement le piège qui rendrait une déclaration indélébile en `08j`. La
/// référence suit le nouveau nom, la base redemandera son mot de passe, et l'appelant reçoit la
/// liste dans `secrets_absents` pour pouvoir le dire.
pub fn renommer_projet(
    projects: &mut [Project],
    ancien: &str,
    nouveau: &str,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Renommage, RenameError> {
    let nouveau = nouveau.trim();
    if nouveau.is_empty() {
        return Err(RenameError::NomVide);
    }

    let index = projects
        .iter()
        .position(|projet| projet.name == ancien)
        .ok_or_else(|| RenameError::Inconnu {
            project: ancien.to_owned(),
        })?;

    // **Renommer en son propre nom est accepté sans rien faire.** Le refuser comme doublon serait
    // exact et inutile : l'utilisateur a validé sans changer le champ, et l'état voulu est atteint.
    if nouveau == ancien {
        return Ok(Renommage {
            cles_a_fermer: Vec::new(),
            secrets_absents: Vec::new(),
            residus: Vec::new(),
        });
    }

    if projects.iter().any(|projet| projet.name == nouveau) {
        return Err(RenameError::DejaPris {
            project: nouveau.to_owned(),
        });
    }

    // Ce qu'il faut déplacer, relevé avant de toucher à quoi que ce soit : une base, un
    // environnement, et la référence que la variante **déclare**. Prendre la référence déclarée
    // plutôt que de la recalculer respecte les variantes dont la référence a été posée autrement.
    // Une connexion, un secret au plus (`23b`) : la liste est un `filter_map` là où elle était un
    // `flat_map` sur les variantes.
    let a_deplacer: Vec<(String, String, SecretRef)> = projects[index]
        .databases
        .iter()
        .filter_map(|base| {
            base.connection.password.as_ref().map(|reference| {
                (
                    base.name.clone(),
                    base.environment.as_str().to_owned(),
                    reference.clone(),
                )
            })
        })
        .collect();

    // **Rien n'est supprimé pendant la migration.** Une première version effaçait chaque ancien
    // secret sitôt le nouveau écrit ; un magasin qui tombe en panne d'écriture à mi-parcours rendait
    // alors la restauration impossible — les anciens étaient déjà partis, et on ne pouvait plus les
    // réécrire. Deux mots de passe perdus dans le pire cas. La phase destructive est donc repoussée
    // **après** l'écriture de la configuration : jusque-là, tout échec se défait en retirant ce qui
    // a été posé, et les originaux n'ont jamais bougé.
    let mut ecrits: Vec<SecretRef> = Vec::new();
    let mut a_supprimer: Vec<SecretRef> = Vec::new();
    let mut secrets_absents = Vec::new();

    for (base, environnement, ancienne) in &a_deplacer {
        let nouvelle = reference_de(nouveau, base, environnement);
        let secret = match magasin.retrieve(ancienne) {
            Ok(Some(secret)) => secret,
            // Un secret simplement introuvable laisse passer — voir la documentation ci-dessus.
            Ok(None) => {
                secrets_absents.push(ancienne.as_str().to_owned());
                continue;
            }
            Err(source) => {
                return Err(RenameError::Secret {
                    source,
                    secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                });
            }
        };

        if let Err(source) = magasin.store(&nouvelle, &secret) {
            return Err(RenameError::Secret {
                source,
                secrets_repris: retirer_les_ecrits(magasin, &ecrits),
            });
        }
        // Consigné **immédiatement** : à partir d'ici, un échec doit défaire cette écriture.
        ecrits.push(nouvelle.clone());

        // **Vérifier qu'il se relit avant de compter dessus.** Un magasin qui accepte l'écriture
        // sans la conserver — un profil verrouillé, un disque plein — ferait perdre le mot de passe
        // au moment où l'on efface l'original.
        match magasin.retrieve(&nouvelle) {
            Ok(Some(_)) => {}
            Ok(None) => {
                return Err(RenameError::Secret {
                    source: SecretError::Magasin {
                        detail: "le mot de passe déplacé ne se relit pas".to_owned(),
                    },
                    secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                });
            }
            Err(source) => {
                return Err(RenameError::Secret {
                    source,
                    secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                });
            }
        }
        a_supprimer.push(ancienne.clone());
    }

    // Les clés de registre relevées **avant** l'écriture : elles portent l'ancien nom, qui va
    // disparaître du modèle.
    let cles_a_fermer = projects[index]
        .databases
        .iter()
        .map(|base| crate::engine::registry::cle(ancien, &base.name, base.environment.as_str()))
        .collect();

    // Le projet est reconstruit à côté, validé, puis substitué — le pattern de `mettre_a_jour` :
    // un modèle à moitié muté n'existe jamais, même le temps d'une ligne.
    let mut candidat = projects[index].clone();
    candidat.name = nouveau.to_owned();
    for base in &mut candidat.databases {
        if base.connection.password.is_some() {
            base.connection.password =
                Some(reference_de(nouveau, &base.name, base.environment.as_str()));
        }
    }
    validate(&candidat).map_err(|erreur| RenameError::Config {
        reason: erreur.to_string(),
        secrets_repris: retirer_les_ecrits(magasin, &ecrits),
    })?;

    let precedent = std::mem::replace(&mut projects[index], candidat);
    if let Err(reason) = ecrire(projects) {
        // Le modèle en mémoire est rendu à son état d'origine : le laisser renommé alors que le
        // disque ne l'est pas ferait divorcer l'écran du fichier jusqu'au prochain démarrage.
        projects[index] = precedent;
        return Err(RenameError::Config {
            reason,
            secrets_repris: retirer_les_ecrits(magasin, &ecrits),
        });
    }

    // **La phase destructive, en dernier.** Un échec ici ne compromet rien : le renommage a eu lieu,
    // et il reste un doublon sous l'ancienne référence — bénin, et bien préférable à un secret
    // perdu. Il est rendu pour que l'appelant puisse le dire plutôt que de le taire.
    let residus = a_supprimer
        .into_iter()
        .filter(|ancienne| magasin.delete(ancienne).is_err())
        .map(|ancienne| ancienne.as_str().to_owned())
        .collect();

    Ok(Renommage {
        cles_a_fermer,
        secrets_absents,
        residus,
    })
}

/// Retire les références posées sous le nouveau nom. Rend `true` si tout a pu être retiré.
///
/// **Il n'y a rien d'autre à défaire** : la migration ne supprime aucun original avant que la
/// configuration soit écrite, donc les anciens secrets sont toujours là. C'est ce qui rend le
/// rollback possible même quand le magasin refuse d'écrire — le cas où une restauration serait,
/// elle, impossible.
///
/// **Sans valeur de retour, l'appelant ne pourrait pas le dire à l'utilisateur** — et « vos mots de
/// passe sont intacts » est précisément ce qu'il a besoin d'entendre après un échec.
fn retirer_les_ecrits(magasin: &dyn SecretStore, ecrits: &[SecretRef]) -> bool {
    ecrits
        .iter()
        .all(|nouvelle| magasin.delete(nouvelle).is_ok())
}

/// Renomme **une connexion** dans un projet, en déplaçant son mot de passe (`26`).
///
/// # Pourquoi le même travail que `renommer_projet`, en plus petit
///
/// `projet/base/environnement` est la clé du registre (`09b`) et la référence du secret (`05c`) :
/// le nom d'une connexion en est le deuxième tiers. Le changer est donc une migration, et l'ordre
/// est celui que `renommer_projet` documente — écrire le nouveau secret, **vérifier qu'il se
/// relit**, écrire la configuration, supprimer l'original **en dernier**.
///
/// **Ce qui change par rapport au projet** : il n'y a qu'un secret. Un renommage de projet pouvait
/// échouer à mi-parcours, avec trois bases migrées sur cinq ; ici, ou le secret a bougé, ou rien
/// n'a bougé. Le rollback reste appelé — non pour couvrir un cas partiel, mais parce que le
/// nouveau secret est déjà posé quand la configuration refuse de s'écrire, et le laisser ferait un
/// doublon que rien ne nettoierait jamais.
///
/// **Rien ne change côté serveur.** `name` n'entre dans aucune chaîne de connexion — seul
/// `connection.default_database` y va. Renommer une connexion ne peut donc pas viser une autre base
/// distante par accident ; c'est l'étiquette et la clé locale qui bougent, rien d'autre.
///
/// L'unicité est celle du couple `(environnement, nom)` (`23b`) : `analytics` en dev et `analytics`
/// en prod sont deux connexions légitimes, et c'est pourquoi le doublon est cherché **dans
/// l'environnement de la connexion visée**, pas dans le projet entier.
pub fn renommer_connexion(
    projects: &mut [Project],
    project: &str,
    environment: &EnvironmentId,
    ancien: &str,
    nouveau: &str,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Renommage, RenameError> {
    let nouveau = nouveau.trim();
    if nouveau.is_empty() {
        return Err(RenameError::NomVide);
    }

    let index = projects
        .iter()
        .position(|projet| projet.name == project)
        .ok_or_else(|| RenameError::Inconnu {
            project: project.to_owned(),
        })?;

    // La connexion est désignée par le **couple** : chercher sur le seul nom viserait la première
    // venue, et renommerait `analytics` de dev en croyant tenir celle de prod.
    let cible = projects[index]
        .databases
        .iter()
        .position(|base| base.name == ancien && &base.environment == environment)
        .ok_or_else(|| RenameError::ConnexionInconnue {
            project: project.to_owned(),
            database: ancien.to_owned(),
            environment: environment.as_str().to_owned(),
        })?;

    // **Renommer en son propre nom est accepté sans rien faire**, comme en `08i` : l'état voulu est
    // déjà atteint, et appeler le magasin demanderait une autorisation du système pour rien.
    if nouveau == ancien {
        return Ok(Renommage {
            cles_a_fermer: Vec::new(),
            secrets_absents: Vec::new(),
            residus: Vec::new(),
        });
    }

    if projects[index]
        .databases
        .iter()
        .any(|base| base.name == nouveau && &base.environment == environment)
    {
        return Err(RenameError::ConnexionPrise {
            database: nouveau.to_owned(),
            environment: environment.as_str().to_owned(),
        });
    }

    // La référence **déclarée**, jamais recalculée : une connexion dont la référence a été posée
    // autrement — un fichier écrit à la main, une convention passée — doit être suivie, pas devinée.
    let ancienne = projects[index].databases[cible].connection.password.clone();
    let nouvelle = ancienne
        .as_ref()
        .map(|_| reference_de(project, nouveau, environment.as_str()));

    let mut ecrits: Vec<SecretRef> = Vec::new();
    let mut secrets_absents = Vec::new();
    // `Some` seulement si un secret a été retrouvé, déplacé, **et relu** : c'est ce qui autorise à
    // effacer l'original, et l'effacer sans cette relecture est ce qui perd un mot de passe.
    let mut a_supprimer: Option<SecretRef> = None;

    if let (Some(ancienne), Some(nouvelle)) = (ancienne.as_ref(), nouvelle.as_ref()) {
        match magasin.retrieve(ancienne) {
            Ok(Some(secret)) => {
                if let Err(source) = magasin.store(nouvelle, &secret) {
                    return Err(RenameError::Secret {
                        source,
                        secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                    });
                }
                ecrits.push(nouvelle.clone());

                // **Vérifier qu'il se relit avant de compter dessus** : un magasin qui accepte
                // l'écriture sans la conserver ferait perdre le mot de passe à la suppression de
                // l'original.
                match magasin.retrieve(nouvelle) {
                    Ok(Some(_)) => a_supprimer = Some(ancienne.clone()),
                    Ok(None) => {
                        return Err(RenameError::Secret {
                            source: SecretError::Magasin {
                                detail: "le mot de passe déplacé ne se relit pas".to_owned(),
                            },
                            secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                        })
                    }
                    Err(source) => {
                        return Err(RenameError::Secret {
                            source,
                            secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                        })
                    }
                }
            }
            // **Introuvable n'est pas illisible**, et la distinction décide du sort du renommage
            // (`08i`) : interrompre ici rendrait *irrenommable* la connexion dont le mot de passe a
            // été effacé à la main. La référence suit, la connexion le redemandera, et l'appelant
            // reçoit de quoi le dire.
            Ok(None) => secrets_absents.push(ancienne.as_str().to_owned()),
            Err(source) => {
                return Err(RenameError::Secret {
                    source,
                    secrets_repris: retirer_les_ecrits(magasin, &ecrits),
                })
            }
        }
    }

    // Relevée **avant** l'écriture : elle porte l'ancien nom, qui va disparaître du modèle.
    let cles_a_fermer = vec![crate::engine::registry::cle(
        project,
        ancien,
        environment.as_str(),
    )];

    // Le projet est reconstruit à côté, validé, puis substitué — le pattern de `mettre_a_jour` :
    // un modèle à moitié muté n'existe jamais, même le temps d'une ligne.
    let mut candidat = projects[index].clone();
    candidat.databases[cible].name = nouveau.to_owned();
    if nouvelle.is_some() {
        candidat.databases[cible].connection.password = nouvelle.clone();
    }
    validate(&candidat).map_err(|erreur| RenameError::Config {
        reason: erreur.to_string(),
        secrets_repris: retirer_les_ecrits(magasin, &ecrits),
    })?;

    let precedent = std::mem::replace(&mut projects[index], candidat);
    if let Err(reason) = ecrire(projects) {
        // Le modèle en mémoire est rendu à son état d'origine : le laisser renommé alors que le
        // disque ne l'est pas ferait divorcer l'écran du fichier jusqu'au prochain démarrage.
        projects[index] = precedent;
        return Err(RenameError::Config {
            reason,
            secrets_repris: retirer_les_ecrits(magasin, &ecrits),
        });
    }

    // **La phase destructive, en dernier.** Un échec ici ne compromet rien : le renommage a eu lieu,
    // il reste un doublon sous l'ancienne référence — bénin, et bien préférable à un secret perdu.
    let residus = a_supprimer
        .into_iter()
        .filter(|ancienne| magasin.delete(ancienne).is_err())
        .map(|ancienne| ancienne.as_str().to_owned())
        .collect();

    Ok(Renommage {
        cles_a_fermer,
        secrets_absents,
        residus,
    })
}

pub struct Modification<'a> {
    pub project: &'a str,
    pub database: &'a str,
    pub environment: EnvironmentId,
    /// Les réglages saisis. Son `environment` et son `password` sont **ignorés** : la variante
    /// garde les siens.
    pub reglages: &'a ConnectionSettings,
    /// `None` laisse le secret en place.
    pub password: Option<&'a Secret>,
}

/// Ce qu'il y a à enregistrer.
///
/// Regroupé en structure plutôt qu'en huit paramètres — clippy le signalait, et il avait raison :
/// un appel à huit arguments positionnels dont quatre chaînes se relit mal, et rien n'empêcherait
/// d'échanger le nom du projet et celui de la base.
pub struct NouvelleBase<'a> {
    pub project: &'a str,
    pub database: &'a str,
    pub engine: Engine,
    /// L'environnement de la connexion (`23b`). Il était dans `variant` ; il est monté d'un cran avec
    /// le modèle, et l'écran le choisit parmi ceux du projet (`23d`).
    pub environment: EnvironmentId,
    pub variant: ConnectionSettings,
    pub password: Option<&'a Secret>,
}

/// Ajoute un projet vide à la liste, ou dit pourquoi il ne peut pas l'être.
///
/// **Pure, et séparée de la commande** : les deux refus — nom vide, nom déjà pris — sont la
/// substance de `08f`, et une fonction qui prend `State<ConfigState>` ne se teste pas sans
/// application Tauri. Même découpage qu'`enregistrer`.
///
/// Le nom est **rogné** : « Halle » et « Halle  » désigneraient sinon deux projets, dont un
/// invisiblement différent dans la sidebar.
pub fn creer_projet(
    projects: &[Project],
    nom: &str,
    environments: Vec<crate::config::model::EnvironmentDeclaration>,
) -> Result<Vec<Project>, CreateError> {
    let nom = nom.trim();
    if nom.is_empty() {
        return Err(CreateError::NomVide);
    }
    if projects.iter().any(|projet| projet.name == nom) {
        return Err(CreateError::NomDeja {
            project: nom.to_owned(),
        });
    }

    // **Les environnements viennent de l'écran, et le trio n'est que leur défaut** (`24a`). La création
    // les recevait figés ; or `23a` fige l'identifiant au libellé donné **à la création**, et jamais
    // après : c'est le seul moment où renommer est sans dette. Les imposer ici aurait rendu la seule
    // version propre du geste inatteignable.
    let environments = if environments.is_empty() {
        crate::config::model::EnvironmentDeclaration::trio_par_defaut()
    } else {
        // **L'identifiant est dérivé ici, du libellé** (`23a`), et il ne l'était pas — c'est le défaut
        // n° 100. L'écran de `24a` envoie `id: ""` pour chaque ligne, avec un commentaire disant que la
        // dérivation vit côté Rust ; le cœur les prenait telles quelles. Un projet à deux
        // environnements partait donc avec deux identifiants vides, que `valider` refusait pour doublon
        // — c'est-à-dire que **créer un projet était impossible depuis l'écran prévu pour ça**.
        //
        // Dériver *toujours*, plutôt que seulement quand l'identifiant est vide : un appelant qui pose
        // un identifiant à la main choisirait la façon dont son projet est écrit sur le disque, et deux
        // règles de nommage pour la même donnée finiraient par diverger. À la création, le libellé
        // décide ; après, plus rien ne le change (`rename_environment`).
        environments
            .into_iter()
            .map(|declaration| crate::config::model::EnvironmentDeclaration {
                id: EnvironmentId::depuis_le_libelle(&declaration.label),
                ..declaration
            })
            .collect()
    };

    let candidat = Project {
        name: nom.to_owned(),
        environments,
        databases: Vec::new(),
        queries: Vec::new(),
    };

    // **Validé avant d'être poussé** : deux libellés identiques donnent deux identifiants identiques,
    // ce que `23a` refuse — et l'écran doit l'apprendre par un refus nommé, non par une configuration
    // invalide écrite sur disque.
    candidat
        .valider()
        .map_err(|erreur| CreateError::Modele(erreur.to_string()))?;

    let mut suivants = projects.to_vec();
    suivants.push(candidat);
    Ok(suivants)
}

/// Ce qu'une suppression a fait, et ce qu'elle laisse à faire à l'appelant (`08j`).
#[derive(Debug)]
pub struct Suppression {
    /// La configuration après suppression.
    pub projects: Vec<Project>,
    /// Les clés de registre des connexions à fermer.
    pub cles_a_fermer: Vec<String>,
    /// Les mots de passe que le magasin n'a pas su effacer. **Dits, jamais tus.**
    pub secrets_residuels: Vec<String>,
}

/// L'échec d'une suppression.
#[derive(Debug)]
pub enum DeleteError {
    Inconnu { project: String },
    BaseInconnue { project: String, database: String },
    Config { reason: String },
}

impl std::fmt::Display for DeleteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Inconnu { project } => write!(f, "le projet « {project} » n'existe pas"),
            Self::BaseInconnue { project, database } => {
                write!(f, "« {database} » n'existe pas dans « {project} »")
            }
            Self::Config { reason } => {
                write!(f, "la configuration n'a pas pu être écrite : {reason}")
            }
        }
    }
}

/// Retire d'une configuration la **déclaration de connexion** d'une base, et son mot de passe.
///
/// **Rien n'est supprimé dans la base distante, et cette fonction ne peut pas l'être** : elle ne
/// reçoit aucun moteur, n'ouvre aucune connexion et n'émet aucun SQL. C'est l'ambiguïté qui peut
/// coûter des données à quelqu'un, et la signature elle-même y répond — un test le vérifie plutôt
/// que de s'en remettre à la relecture.
///
/// **Un secret introuvable n'est pas un échec.** Il peut avoir été effacé à la main, ou n'avoir
/// jamais existé pour un moteur qui n'en demande pas. Refuser de retirer une déclaration parce que
/// son mot de passe manque déjà rendrait certaines entrées **indélébiles** — le même arbitrage qu'en
/// `08i` pour un secret absent.
///
/// **La configuration est écrite d'abord, les secrets effacés ensuite** — la phase destructive en
/// dernier, comme en `08i`. L'ordre inverse a été écrit puis corrigé : si l'écriture échouait après
/// l'effacement, la base restait **déclarée sans son mot de passe**, et le redemandait à la
/// prochaine connexion sans que rien l'explique. Dans cet ordre, une écriture qui échoue ne laisse
/// rien derrière, et un secret qui résiste après coup est un orphelin *signalé*.
pub fn supprimer_base(
    projects: &[Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Suppression, DeleteError> {
    let index = projects
        .iter()
        .position(|projet| projet.name == project)
        .ok_or_else(|| DeleteError::Inconnu {
            project: project.to_owned(),
        })?;
    // **L'environnement fait partie de l'identité d'une connexion** (`23b`), et cette signature est
    // ce qui l'impose. Sans lui, supprimer « analytics » d'un projet où elle existe en dev et en prod
    // aurait retiré la première venue — et son mot de passe avec. Trouvé par un test de suppression
    // qui passait sur un décor à une seule connexion homonyme.
    let rang = projects[index]
        .databases
        .iter()
        .position(|base| base.name == database && &base.environment == environment)
        .ok_or_else(|| DeleteError::BaseInconnue {
            project: project.to_owned(),
            database: database.to_owned(),
        })?;

    let mut suivants = projects.to_vec();
    let base = suivants[index].databases.remove(rang);

    ecrire(&suivants).map_err(|reason| DeleteError::Config { reason })?;

    let (cles_a_fermer, secrets_residuels) = oublier(&base, project, magasin);

    Ok(Suppression {
        projects: suivants,
        cles_a_fermer,
        secrets_residuels,
    })
}

/// Retire un projet entier : chaque base, chaque secret, puis le projet.
///
/// **Rien de spécifique**, sinon la répétition — et c'est voulu : deux chemins de suppression
/// différents finiraient par diverger. Comme `supprimer_base`, elle ne touche aucune base distante.
pub fn supprimer_projet(
    projects: &[Project],
    project: &str,
    magasin: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<Suppression, DeleteError> {
    let index = projects
        .iter()
        .position(|projet| projet.name == project)
        .ok_or_else(|| DeleteError::Inconnu {
            project: project.to_owned(),
        })?;

    let mut suivants = projects.to_vec();
    let projet = suivants.remove(index);

    ecrire(&suivants).map_err(|reason| DeleteError::Config { reason })?;

    let mut cles_a_fermer = Vec::new();
    let mut secrets_residuels = Vec::new();
    for base in &projet.databases {
        let (cles, residus) = oublier(base, project, magasin);
        cles_a_fermer.extend(cles);
        secrets_residuels.extend(residus);
    }

    Ok(Suppression {
        projects: suivants,
        cles_a_fermer,
        secrets_residuels,
    })
}

/// Efface les secrets d'une base et relève les clés de ses connexions.
///
/// Rend `(clés à fermer, secrets non effacés)`. Un secret qui résiste **ne fait pas échouer** la
/// suppression : la déclaration est partie, la refuser laisserait l'entrée indélébile.
fn oublier(
    base: &Database,
    project: &str,
    magasin: &dyn SecretStore,
) -> (Vec<String>, Vec<String>) {
    let mut residus = Vec::new();
    let cles = vec![crate::engine::registry::cle(
        project,
        &base.name,
        base.environment.as_str(),
    )];
    // La référence **déclarée**, pas une recalculée : une connexion dont la référence a été posée
    // autrement garderait sinon son secret.
    if let Some(reference) = &base.connection.password {
        if magasin.delete(reference).is_err() {
            residus.push(reference.as_str().to_owned());
        }
    }
    (cles, residus)
}

/// Localise une connexion par son identité complète — projet, nom, environnement.
///
/// **Les trois composantes, jamais deux.** Depuis `23b`, `analytics` en dev et `analytics` en prod
/// sont deux connexions : chercher par le seul nom en désignerait une au hasard, et une console
/// créée sur l'une apparaîtrait sous l'autre.
fn connexion_mut<'a>(
    projects: &'a mut [Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
) -> Result<&'a mut Database, ConsoleError> {
    let projet = projects
        .iter_mut()
        .find(|projet| projet.name == project)
        .ok_or_else(|| ConsoleError::ProjetInconnu {
            project: project.to_owned(),
        })?;
    projet
        .databases
        .iter_mut()
        .find(|base| base.name == database && &base.environment == environment)
        .ok_or_else(|| ConsoleError::ConnexionInconnue {
            database: database.to_owned(),
            environment: environment.as_str().to_owned(),
        })
}

/// Crée une console vide sur une connexion.
///
/// **Le nom est unique dans la connexion**, et un homonyme est refusé : deux consoles de même nom
/// sous la même connexion seraient indiscernables dans l'arbre, et le renommage ne saurait plus
/// laquelle viser. Sous deux connexions différentes, en revanche, le même nom est légitime.
pub fn ajouter_console(
    projects: &[Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
    nom: &str,
) -> Result<Vec<Project>, ConsoleError> {
    let nom = nom.trim();
    if nom.is_empty() {
        return Err(ConsoleError::NomVide);
    }

    let mut suivants = projects.to_vec();
    let base = connexion_mut(&mut suivants, project, database, environment)?;
    if base.consoles.iter().any(|console| console.name == nom) {
        return Err(ConsoleError::NomDeja {
            nom: nom.to_owned(),
        });
    }
    base.consoles.push(Console {
        name: nom.to_owned(),
        sql: String::new(),
    });
    Ok(suivants)
}

/// Écrit le texte d'une console.
///
/// **La console doit exister** — contrairement à `enregistrer_requete` de `12f`, qui créait l'entrée
/// au besoin. Le geste a changé de nature : on n'enregistre plus un texte sous un nom choisi à cet
/// instant, on écrit dans une console déjà créée et déjà visible dans l'arbre. Une écriture dans une
/// console absente est donc une incohérence, pas un raccourci.
pub fn enregistrer_sql_de_console(
    projects: &[Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
    nom: &str,
    sql: &str,
) -> Result<Vec<Project>, ConsoleError> {
    let mut suivants = projects.to_vec();
    let base = connexion_mut(&mut suivants, project, database, environment)?;
    let console = base
        .consoles
        .iter_mut()
        .find(|console| console.name == nom)
        .ok_or_else(|| ConsoleError::Inconnue {
            nom: nom.to_owned(),
        })?;
    console.sql = sql.to_owned();
    Ok(suivants)
}

/// Renomme une console.
///
/// Renommer vers son propre nom est accepté sans rien faire : l'utilisateur qui valide une modale
/// sans avoir touché au champ a obtenu ce qu'il demandait.
pub fn renommer_console(
    projects: &[Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
    ancien: &str,
    nouveau: &str,
) -> Result<Vec<Project>, ConsoleError> {
    let nouveau = nouveau.trim();
    if nouveau.is_empty() {
        return Err(ConsoleError::NomVide);
    }

    let mut suivants = projects.to_vec();
    let base = connexion_mut(&mut suivants, project, database, environment)?;
    if nouveau != ancien && base.consoles.iter().any(|console| console.name == nouveau) {
        return Err(ConsoleError::NomDeja {
            nom: nouveau.to_owned(),
        });
    }
    let cible = base
        .consoles
        .iter_mut()
        .find(|console| console.name == ancien)
        .ok_or_else(|| ConsoleError::Inconnue {
            nom: ancien.to_owned(),
        })?;
    cible.name = nouveau.to_owned();
    Ok(suivants)
}

/// Retire une console.
///
/// **Une console absente n'est pas un échec** : le geste a déjà eu son effet — même arbitrage qu'en
/// `08j` pour un secret déjà effacé, et qu'en `12f` pour une requête déjà retirée.
pub fn retirer_console(
    projects: &[Project],
    project: &str,
    database: &str,
    environment: &EnvironmentId,
    nom: &str,
) -> Result<Vec<Project>, ConsoleError> {
    let mut suivants = projects.to_vec();
    let base = connexion_mut(&mut suivants, project, database, environment)?;
    base.consoles.retain(|console| console.name != nom);
    Ok(suivants)
}

/// Verse les requêtes enregistrées de `12f` dans les consoles de la première connexion du projet.
///
/// **Appelée à chaque chargement**, et non une fois pour toutes : un projet sans aucune connexion n'a
/// nulle part où verser ses requêtes, et les abandonner serait une perte silencieuse. Elles restent
/// alors dans le fichier et attendent qu'une connexion soit déclarée — la migration se rejoue au
/// chargement suivant. C'est ce qui rend l'opération sûre sans monter la version du format.
///
/// **La première connexion déclarée**, faute de mieux : une requête de `12f` ne dit pas sur quelle
/// base elle s'exécutait, l'information n'a jamais été enregistrée. Deviner d'après son SQL serait
/// deviner. L'utilisateur retrouve ses textes, nommés, sous une connexion du bon projet, et les
/// déplace s'il le souhaite — ce qu'aucune perte ne permettrait.
///
/// **Un nom déjà pris est suffixé** plutôt que refusé : la migration ne doit jamais échouer, sans
/// quoi un homonyme bloquerait le chargement de toute la configuration.
pub fn migrer_requetes_en_consoles(projects: &mut [Project]) {
    for projet in projects.iter_mut() {
        if projet.queries.is_empty() || projet.databases.is_empty() {
            continue;
        }
        let requetes = std::mem::take(&mut projet.queries);
        let base = &mut projet.databases[0];
        for requete in requetes {
            let mut nom = requete.name;
            while base.consoles.iter().any(|console| console.name == nom) {
                nom.push_str(" (reprise)");
            }
            base.consoles.push(Console {
                name: nom,
                sql: requete.sql,
            });
        }
    }
}

/// Les refus des opérations sur les consoles.
#[derive(Debug, PartialEq, Eq)]
pub enum ConsoleError {
    NomVide,
    NomDeja {
        nom: String,
    },
    Inconnue {
        nom: String,
    },
    ProjetInconnu {
        project: String,
    },
    ConnexionInconnue {
        database: String,
        environment: String,
    },
}

impl std::fmt::Display for ConsoleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NomVide => write!(f, "une console doit avoir un nom"),
            Self::NomDeja { nom } => write!(f, "une console nommée « {nom} » existe déjà"),
            Self::Inconnue { nom } => write!(f, "aucune console nommée « {nom} »"),
            Self::ProjetInconnu { project } => write!(f, "le projet « {project} » n'existe pas"),
            Self::ConnexionInconnue {
                database,
                environment,
            } => write!(f, "aucune connexion « {database} » en « {environment} »"),
        }
    }
}

/// Les trois refus de `creer_projet`.
#[derive(Debug, PartialEq, Eq)]
pub enum CreateError {
    NomVide,
    NomDeja {
        project: String,
    },
    /// Le projet candidat viole un invariant de `23a` — deux environnements de même identifiant, ou
    /// aucun environnement. Le message vient du modèle, qui nomme le fautif.
    Modele(String),
}

impl std::fmt::Display for CreateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NomVide => write!(f, "le nom du projet ne peut pas être vide"),
            Self::NomDeja { project } => write!(f, "un projet « {project} » existe déjà"),
            Self::Modele(raison) => write!(f, "{raison}"),
        }
    }
}

/// Ajoute une base et sa variante à un projet, et range son mot de passe.
///
/// # L'ordre, et pourquoi
///
/// **Secret d'abord, configuration ensuite.** Trois issues, dont une piège :
///
/// 1. les deux réussissent — cas normal ;
/// 2. le secret échoue — rien n'est écrit, on refuse. Simple ;
/// 3. **la configuration échoue après que le secret est rangé** — un secret orphelin reste
///    dans le magasin, référencé par rien.
///
/// Le troisième cas est celui qu'on découvre six mois plus tard. D'où la reprise du secret
/// quand l'écriture échoue. Un secret orphelin n'est pas dangereux, mais il est sale, et le
/// magasin fournit `delete`.
///
/// L'ordre inverse — configuration d'abord — serait pire : la configuration référencerait un
/// secret absent, et l'utilisateur verrait une base qui ne se connecte pas sans savoir
/// pourquoi. Un secret orphelin est invisible ; une référence morte, elle, casse une base.
///
/// `ecrire` est un paramètre plutôt qu'un `&ConfigStore` : c'est ce qui permet de **provoquer**
/// l'échec du cas 3 dans un test, sans dépendre d'un répertoire en lecture seule — dont le
/// comportement varie avec l'utilisateur et le système de fichiers.
pub fn enregistrer(
    projects: &mut [Project],
    nouvelle: NouvelleBase<'_>,
    store: &dyn SecretStore,
    ecrire: &mut dyn FnMut(&[Project]) -> Result<(), String>,
) -> Result<(), SaveError> {
    let NouvelleBase {
        project: project_name,
        database: database_name,
        engine,
        environment: environnement,
        mut variant,
        password,
    } = nouvelle;
    let index = projects
        .iter()
        .position(|projet| projet.name == project_name)
        .ok_or_else(|| SaveError::ProjetInconnu {
            project: project_name.to_owned(),
        })?;

    // La référence est posée dans la variante **avant** toute écriture : c'est elle qui
    // remplace le mot de passe dans la configuration, et l'oublier laisserait une base sans
    // moyen de retrouver son secret.
    let reference =
        password.map(|_| reference_de(project_name, database_name, environnement.as_str()));
    variant.password = reference.clone();

    // **La validation a changé de place, et non de nature.** `Database::new` refusait une base sans
    // variante ou avec deux fois le même environnement ; ces deux cas n'existent plus (`23b`), et ce
    // qui reste à refuser — une connexion en doublon, un environnement non déclaré — porte sur le
    // projet entier. C'est donc `validate` du projet candidat, quelques lignes plus bas, qui refuse,
    // toujours avant d'avoir touché au magasin.
    let base = Database {
        name: database_name.to_owned(),
        engine,
        environment: environnement.clone(),
        connection: variant,
        // Une connexion neuve n'a aucune console : elles se créent depuis son menu « … ».
        consoles: Vec::new(),
    };

    // Un projet candidat, validé à part : muter d'abord puis valider obligerait à défaire la
    // mutation en cas de refus, et une mutation défaite est une mutation qu'on peut oublier.
    let mut candidat = projects[index].clone();
    candidat.databases.push(base);
    validate(&candidat).map_err(SaveError::Model)?;

    // --- Effet de bord 1 : le secret ---
    if let (Some(reference), Some(secret)) = (reference.as_ref(), password) {
        store.store(reference, secret).map_err(SaveError::Secret)?;
    }

    // --- Effet de bord 2 : la configuration ---
    let ancien = std::mem::replace(&mut projects[index], candidat);

    match ecrire(projects) {
        Ok(()) => Ok(()),
        Err(reason) => {
            // L'état en mémoire revient à ce qu'il était : sans cela, l'écran afficherait une
            // base que le disque ne contient pas.
            projects[index] = ancien;

            let secret_repris = match reference.as_ref() {
                Some(reference) => store.delete(reference).is_ok(),
                // Aucun secret rangé : rien à reprendre, donc « repris » est vrai par vacuité.
                None => true,
            };

            Err(SaveError::Config {
                reason,
                secret_repris,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::config::model::{EnvironmentId, SslMode};

    /// Un magasin en mémoire, qui peut être rendu défaillant.
    ///
    /// Un `Mutex` et non une `RefCell` : `SecretStore` exige `Send + Sync`, et prétendre le
    /// contraire par un `unsafe impl` serait mentir au compilateur pour la commodité d'un test.
    /// Les deux booléens font échouer l'écriture et la suppression — c'est ce qui permet de
    /// **provoquer** les trois issues d'`enregistrer` plutôt que d'en espérer deux.
    pub(super) struct MagasinSync(std::sync::Mutex<HashMap<String, String>>, bool, bool);

    impl SecretStore for MagasinSync {
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

    pub(super) fn magasin() -> MagasinSync {
        MagasinSync(std::sync::Mutex::new(HashMap::new()), false, false)
    }

    /// Un magasin qui refuse ce qu'on lui demande de refuser — les champs du tuple étant privés
    /// hors de ce module, les tests voisins passent par ici.
    pub(super) fn magasin_defaillant(ecriture: bool, suppression: bool) -> MagasinSync {
        MagasinSync(std::sync::Mutex::new(HashMap::new()), ecriture, suppression)
    }

    impl MagasinSync {
        /// Pose un secret **sans passer par les drapeaux de panne** : garnir un magasin qui refuse
        /// d'écrire est impossible autrement, et un magasin vide ne prouverait qu'une chose — que
        /// des secrets absents ne se déplacent pas.
        pub(super) fn poser(&self, reference: &SecretRef, valeur: &str) {
            self.0
                .lock()
                .expect("magasin")
                .insert(reference.as_str().to_owned(), valeur.to_owned());
        }
    }

    fn variante() -> ConnectionSettings {
        ConnectionSettings {
            host: "db.internal".into(),
            port: 5432,
            default_database: "analytics".into(),
            username: "dora_ro".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: true,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn projets() -> Vec<Project> {
        vec![Project {
            name: "Atelier Nord".into(),
            environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
            queries: Vec::new(),
            databases: Vec::new(),
        }]
    }

    // --- Création de projet (08f) ---

    /// Trois environnements aux libellés choisis, comme `24a` les envoie.
    fn declares(libelles: [&str; 3]) -> Vec<crate::config::model::EnvironmentDeclaration> {
        libelles
            .iter()
            .map(|libelle| crate::config::model::EnvironmentDeclaration {
                id: EnvironmentId::depuis_le_libelle(libelle),
                label: (*libelle).to_owned(),
                color: crate::config::model::EnvironmentColor::Slate,
                production: false,
            })
            .collect()
    }

    /// **Le geste tel que l'écran l'envoie** : des identifiants vides, à dériver des libellés.
    ///
    /// C'est le défaut n° 100, constaté à l'usage le 19 août 2026 — « je saisis un projet avec deux
    /// environnements, je clique sur Continuer, rien ne se passe ». Deux identifiants vides sont un
    /// doublon, `valider` refusait, et la création était **impossible depuis l'écran prévu pour elle**.
    ///
    /// Aucun test ne l'avait vu : ceux de l'écran injectent leur propre création, et ceux d'ici
    /// fabriquaient des déclarations **déjà dérivées** par leur fabrique. Chaque côté testait sa moitié
    /// du contrat, et personne le joint.
    fn declares_sans_identifiant(
        libelles: &[&str],
    ) -> Vec<crate::config::model::EnvironmentDeclaration> {
        libelles
            .iter()
            .map(|libelle| crate::config::model::EnvironmentDeclaration {
                id: EnvironmentId::brut(""),
                label: (*libelle).to_owned(),
                color: crate::config::model::EnvironmentColor::Slate,
                production: false,
            })
            .collect()
    }

    #[test]
    fn deux_environnements_aux_identifiants_vides_sont_derives_des_libelles() {
        let suivants = creer_projet(
            &[],
            "Atelier Nord",
            declares_sans_identifiant(&["atelier", "vitrine"]),
        )
        .expect("la création doit aboutir");

        let identifiants: Vec<_> = suivants[0]
            .environments
            .iter()
            .map(|declaration| declaration.id.as_str())
            .collect();
        assert_eq!(identifiants, vec!["atelier", "vitrine"]);
    }

    #[test]
    fn un_seul_environnement_sans_identifiant_passe_aussi() {
        // Le cas à un seul environnement **passait** avant le correctif — un identifiant vide n'est pas
        // un doublon de lui-même. C'est pourquoi le défaut ne se voyait qu'à partir de deux, et c'est
        // exactement le genre de frontière qu'un test doit tenir des deux côtés.
        let suivants = creer_projet(&[], "Atelier Nord", declares_sans_identifiant(&["atelier"]))
            .expect("création");
        assert_eq!(suivants[0].environments[0].id.as_str(), "atelier");
    }

    #[test]
    fn deux_libelles_qui_derivent_pareil_restent_refuses() {
        // La dérivation ne masque pas le doublon **réel** : « Atelier » et « atelier » donnent le même
        // identifiant, et c'est un refus nommé, non un `atelier-2` fabriqué en douce.
        let erreur = creer_projet(
            &[],
            "Atelier Nord",
            declares_sans_identifiant(&["Atelier", "atelier"]),
        );
        assert!(matches!(erreur, Err(CreateError::Modele(_))));
    }

    #[test]
    fn un_projet_cree_est_vide_et_porte_les_environnements_declares() {
        let suivants = creer_projet(&[], "Atelier Nord", declares(["recette", "live", "bac"]))
            .expect("création");

        assert_eq!(suivants.len(), 1);
        assert_eq!(suivants[0].name, "Atelier Nord");
        // **Les libellés de l'écran, non le trio.** C'est tout l'objet de `24a` : `23a` fige
        // l'identifiant au libellé de la création, donc un utilisateur dont les environnements
        // s'appellent « recette » et « live » doit pouvoir le dire à ce moment-là, et à ce moment-là
        // seulement.
        let libelles: Vec<_> = suivants[0]
            .environments
            .iter()
            .map(|declaration| declaration.label.as_str())
            .collect();
        assert_eq!(libelles, vec!["recette", "live", "bac"]);
        assert!(suivants[0].databases.is_empty());
    }

    #[test]
    fn sans_environnement_declare_le_coeur_reprend_le_trio() {
        // Ce qui garde `08f` vrai pour un appelant qui n'a rien à en dire — et ce que fait la
        // migration d'une configuration ancienne.
        let suivants = creer_projet(&[], "Neuf", Vec::new()).expect("création");
        let ids: Vec<_> = suivants[0]
            .environments
            .iter()
            .map(|declaration| declaration.id.as_str().to_owned())
            .collect();
        assert_eq!(ids, vec!["dev", "staging", "prod"]);
    }

    #[test]
    fn deux_libelles_identiques_sont_refuses_par_le_modele() {
        // Deux libellés identiques donnent deux identifiants identiques, ce que `23a` refuse. L'écran
        // doit l'apprendre par un refus nommé, non par une configuration invalide écrite sur disque.
        let erreur = creer_projet(&[], "Halle", declares(["prod", "prod", "dev"]))
            .expect_err("deux identifiants identiques");
        assert!(matches!(erreur, CreateError::Modele(_)), "{erreur:?}");
    }

    #[test]
    fn un_nom_vide_ou_en_blancs_est_refuse() {
        assert_eq!(creer_projet(&[], "", Vec::new()), Err(CreateError::NomVide));
        assert_eq!(
            creer_projet(&[], "   ", Vec::new()),
            Err(CreateError::NomVide)
        );
    }

    #[test]
    fn un_nom_deja_pris_est_refuse_et_le_dit() {
        let erreur =
            creer_projet(&projets(), "Atelier Nord", Vec::new()).expect_err("le nom est déjà pris");
        assert_eq!(
            erreur,
            CreateError::NomDeja {
                project: "Atelier Nord".into()
            }
        );
        assert!(erreur.to_string().contains("Atelier Nord"));
    }

    /// **Le nom est rogné**, donc « Halle » et « Halle  » sont le même projet.
    ///
    /// Sans cela, deux projets coexisteraient dans la sidebar sous un libellé identique à l'œil —
    /// et le second serait injoignable puisque la clé de base emploie le nom.
    #[test]
    fn les_blancs_de_bord_ne_creent_pas_un_second_projet() {
        let erreur = creer_projet(&projets(), "  Atelier Nord  ", Vec::new())
            .expect_err("c'est le même projet");
        assert_eq!(
            erreur,
            CreateError::NomDeja {
                project: "Atelier Nord".into()
            }
        );

        let suivants = creer_projet(&[], "  Outils internes  ", Vec::new()).expect("création");
        assert_eq!(suivants[0].name, "Outils internes");
    }

    #[test]
    fn creer_un_projet_ne_touche_pas_aux_projets_existants() {
        let avant = projets();
        let suivants = creer_projet(&avant, "Data science", Vec::new()).expect("création");

        // Une fonction pure : la liste d'entrée n'est pas mutée, et l'appelant décide d'écrire.
        assert_eq!(avant.len(), 1);
        assert_eq!(suivants.len(), 2);
        assert_eq!(suivants[0], avant[0]);
    }

    // --- Modification d'une variante (08g) ---

    /// Le décor : un projet avec une base `analytics` en `dev`, mot de passe rangé.
    ///
    /// Le magasin est **passé**, pas créé ici : `magasin()` en fabrique un neuf à chaque appel, et
    /// le décor rangerait alors son secret dans un magasin que le test ne relit pas — le test
    /// échouait sur un `None` trompeur.
    fn projets_avec_base(m: &MagasinSync) -> Vec<Project> {
        let mut p = projets();
        let mut ecrit = 0;
        enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new("s3cr3t")),
            },
            m,
            &mut |_| {
                ecrit += 1;
                Ok(())
            },
        )
        .expect("enregistrement du décor");
        p
    }

    #[test]
    fn une_modification_change_les_reglages_sans_toucher_a_l_identite() {
        let m = magasin();
        let mut p = projets_avec_base(&m);
        let avant = p[0].databases[0].connection.clone();

        let mut reglages = variante();
        reglages.host = "db.nouveau".into();
        reglages.port = 5433;

        mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "analytics",
                environment: EnvironmentId::brut("dev"),
                reglages: &reglages,
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect("modification");

        let apres = &p[0].databases[0].connection;
        assert_eq!(apres.host, "db.nouveau");
        assert_eq!(apres.port, 5433);
        // **L'environnement ne bouge pas**, même si les réglages envoyés en portaient un autre :
        // il désigne la variante, et fait partie de la clé de connexion comme de la référence du
        // secret. Le laisser passer laisserait un secret orphelin.
        assert_eq!(p[0].databases[0].environment, EnvironmentId::brut("dev"));
        assert_eq!(apres.password, avant.password);
    }

    #[test]
    fn un_mot_de_passe_absent_laisse_le_secret_en_place() {
        let m = magasin();
        let mut p = projets_avec_base(&m);
        let reference = p[0].databases[0]
            .connection
            .password
            .clone()
            .expect("le décor a rangé un secret");

        mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "analytics",
                environment: EnvironmentId::brut("dev"),
                reglages: &variante(),
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect("modification");

        // Corriger un port ne doit pas obliger à retaper le mot de passe, et l'oublier ne doit pas
        // l'effacer.
        assert_eq!(
            m.retrieve(&reference)
                .expect("relecture")
                .map(|s| s.expose().to_owned()),
            Some("s3cr3t".to_owned())
        );
    }

    #[test]
    fn un_mot_de_passe_fourni_remplace_le_secret() {
        let m = magasin();
        let mut p = projets_avec_base(&m);
        let reference = p[0].databases[0]
            .connection
            .password
            .clone()
            .expect("le décor a rangé un secret");

        mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "analytics",
                environment: EnvironmentId::brut("dev"),
                reglages: &variante(),
                password: Some(&Secret::new("nouveau")),
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect("modification");

        assert_eq!(
            m.retrieve(&reference)
                .expect("relecture")
                .map(|s| s.expose().to_owned()),
            Some("nouveau".to_owned())
        );
        // La référence n'a pas changé : elle dérive du triplet, qui n'a pas bougé.
        assert_eq!(p[0].databases[0].connection.password, Some(reference));
    }

    #[test]
    fn modifier_ne_cree_jamais_rien() {
        let m = magasin();
        let mut p = projets_avec_base(&m);
        let reglages = variante();

        // Une base inconnue est refusée, et non ajoutée : c'est ce qui distingue cette commande de
        // `enregistrer`.
        let erreur = mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "inconnue",
                environment: EnvironmentId::brut("dev"),
                reglages: &reglages,
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect_err("la base n'existe pas");
        assert!(erreur.to_string().contains("inconnue"), "{erreur}");
        assert_eq!(p[0].databases.len(), 1);

        // Une variante inconnue aussi : la base existe en `dev`, pas en `prod`.
        let erreur = mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "analytics",
                environment: EnvironmentId::brut("prod"),
                reglages: &reglages,
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect_err("aucune connexion « analytics » en prod dans ce décor");
        // **Le nom de la base, non l'environnement.** L'erreur est désormais « base inconnue » : une
        // connexion est identifiée par son nom *et* son environnement (`23b`), et n'en trouver aucune
        // ne distingue pas « mauvais nom » de « mauvais environnement ». Le message nomme donc ce que
        // l'utilisateur a demandé.
        assert!(erreur.to_string().contains("analytics"), "{erreur}");
        // Une connexion, un seul jeu de réglages (`23b`) : il n'y a plus de variantes à compter.
        assert_eq!(p[0].databases.len(), 1);
    }

    #[test]
    fn une_configuration_qui_echoue_laisse_les_reglages_intacts() {
        let m = magasin();
        let mut p = projets_avec_base(&m);
        let mut reglages = variante();
        reglages.host = "db.nouveau".into();

        mettre_a_jour(
            &mut p,
            Modification {
                project: "Atelier Nord",
                database: "analytics",
                environment: EnvironmentId::brut("dev"),
                reglages: &reglages,
                password: None,
            },
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("l'écriture a échoué");

        // L'ancien hôte est repris : une écriture ratée ne doit pas laisser la mémoire en avance
        // sur le disque.
        assert_eq!(p[0].databases[0].connection.host, "db.internal");
    }

    #[test]
    fn un_enregistrement_reussi_ajoute_la_base_et_range_le_secret() {
        let mut p = projets();
        let m = magasin();
        let mut ecrit = 0;

        enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new("s3cr3t")),
            },
            &m,
            &mut |_| {
                ecrit += 1;
                Ok(())
            },
        )
        .expect("l'enregistrement doit réussir");

        assert_eq!(ecrit, 1, "la configuration doit être écrite une fois");
        assert_eq!(p[0].databases.len(), 1);
        assert_eq!(p[0].databases[0].name, "analytics");

        let reference = reference_de("Atelier Nord", "analytics", "dev");
        assert_eq!(
            m.retrieve(&reference)
                .expect("lecture")
                .map(|s| s.expose().to_owned()),
            Some("s3cr3t".to_owned())
        );
    }

    /// **La configuration ne porte qu'une référence, jamais le mot de passe.**
    ///
    /// Contrôle **positif** compris : la sentinelle est bien celle qu'on a rangée, donc un test
    /// qui la cherche dans le JSON a de quoi la trouver si le code l'y mettait.
    #[test]
    fn le_mot_de_passe_n_entre_pas_dans_la_configuration() {
        let sentinelle = "SENTINELLE-motdepasse";
        let mut p = projets();
        let m = magasin();
        let mut json = String::new();

        enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new(sentinelle)),
            },
            &m,
            &mut |projets| {
                json = serde_json::to_string(projets).expect("sérialisation");
                Ok(())
            },
        )
        .expect("enregistrement");

        // Contrôle positif : la sentinelle est réellement dans le magasin.
        let reference = reference_de("Atelier Nord", "analytics", "dev");
        assert_eq!(
            m.retrieve(&reference)
                .unwrap()
                .map(|s| s.expose().to_owned()),
            Some(sentinelle.to_owned()),
            "le contrôle positif est cassé : le secret n'a pas été rangé"
        );

        assert!(
            !json.contains(sentinelle),
            "la configuration contient le mot de passe : {json}"
        );
        assert!(
            json.contains("Atelier Nord/analytics/dev"),
            "la configuration doit porter la référence : {json}"
        );
    }

    /// **Le cas piège que `08e` demande de provoquer.**
    ///
    /// Sans reprise, un secret orphelin resterait dans le magasin, référencé par rien. C'est le
    /// genre de défaut qu'on découvre six mois plus tard, et la branche de nettoyage ne serait
    /// jamais exécutée sans ce test.
    #[test]
    fn une_configuration_qui_echoue_laisse_le_magasin_intact() {
        let mut p = projets();
        let m = magasin();

        let erreur = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new("s3cr3t")),
            },
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("l'échec d'écriture doit être remonté");

        assert!(matches!(
            erreur,
            SaveError::Config {
                secret_repris: true,
                ..
            }
        ));

        let reference = reference_de("Atelier Nord", "analytics", "dev");
        assert_eq!(
            m.retrieve(&reference)
                .expect("lecture")
                .map(|s| s.expose().to_owned()),
            None,
            "le secret orphelin n'a pas été repris"
        );
    }

    /// Et l'état en mémoire aussi : sinon l'écran montrerait une base absente du disque.
    #[test]
    fn une_configuration_qui_echoue_laisse_les_projets_intacts() {
        let mut p = projets();
        let m = magasin();

        let _ = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: None,
            },
            &m,
            &mut |_| Err("disque plein".to_owned()),
        );

        assert!(
            p[0].databases.is_empty(),
            "la base a été ajoutée en mémoire malgré l'échec d'écriture"
        );
    }

    /// Quand la reprise elle-même échoue, l'erreur le **dit** plutôt que de prétendre au
    /// nettoyage.
    #[test]
    fn une_reprise_impossible_est_annoncee() {
        let mut p = projets();
        let m = MagasinSync(std::sync::Mutex::new(HashMap::new()), false, true);

        let erreur = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new("s3cr3t")),
            },
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("échec attendu");

        assert!(matches!(
            erreur,
            SaveError::Config {
                secret_repris: false,
                ..
            }
        ));
        assert!(
            erreur.to_string().contains("n'a pas pu être retiré"),
            "{erreur}"
        );
    }

    #[test]
    fn un_magasin_en_panne_n_ecrit_pas_la_configuration() {
        let mut p = projets();
        let m = MagasinSync(std::sync::Mutex::new(HashMap::new()), true, false);
        let mut ecrit = 0;

        let erreur = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: Some(&Secret::new("s3cr3t")),
            },
            &m,
            &mut |_| {
                ecrit += 1;
                Ok(())
            },
        )
        .expect_err("le magasin en panne doit faire refuser");

        assert!(matches!(erreur, SaveError::Secret(_)));
        assert_eq!(ecrit, 0, "rien ne doit être écrit si le secret a échoué");
        assert!(p[0].databases.is_empty());
    }

    #[test]
    fn un_nom_de_base_en_double_est_refuse_sans_rien_ecrire() {
        let mut p = projets();
        let m = magasin();

        enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect("premier enregistrement");

        let erreur = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: None,
            },
            &m,
            &mut |_| panic!("rien ne doit être écrit"),
        )
        .expect_err("le doublon doit être refusé");

        assert!(matches!(
            erreur,
            SaveError::Model(ModelError::ConnexionEnDouble { .. })
        ));
        assert_eq!(p[0].databases.len(), 1);
    }

    #[test]
    fn un_projet_inconnu_est_refuse() {
        let mut p = projets();
        let m = magasin();

        let erreur = enregistrer(
            &mut p,
            NouvelleBase {
                project: "Projet Fantôme",
                database: "analytics",
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: None,
            },
            &m,
            &mut |_| panic!("rien ne doit être écrit"),
        )
        .expect_err("un projet inconnu doit être refusé");

        assert!(matches!(erreur, SaveError::ProjetInconnu { .. }));
    }

    /// Sans mot de passe — SQLite sur fichier, par exemple — la variante ne porte **aucune**
    /// référence. Une référence vers un secret absent casserait la connexion.
    #[test]
    fn sans_mot_de_passe_aucune_reference_n_est_posee() {
        let mut p = projets();
        let m = magasin();

        enregistrer(
            &mut p,
            NouvelleBase {
                project: "Atelier Nord",
                database: "analytics",
                engine: Engine::Sqlite,
                environment: EnvironmentId::brut("dev"),
                variant: variante(),
                password: None,
            },
            &m,
            &mut |_| Ok(()),
        )
        .expect("enregistrement");

        assert_eq!(p[0].databases[0].connection.password, None);
    }

    /// La référence est **prévisible**, donc rouvrir la même base retrouve son secret sans
    /// qu'aucune table de correspondance soit persistée.
    #[test]
    fn la_reference_est_derivee_du_triplet_et_stable() {
        assert_eq!(
            reference_de("Halle", "analytics", "prod").as_str(),
            "Halle/analytics/prod"
        );
        assert_ne!(
            reference_de("Halle", "analytics", "dev"),
            reference_de("Halle", "analytics", "prod"),
            "deux environnements de la même base ont deux mots de passe distincts"
        );
    }
}

#[cfg(all(test, feature = "db-tests"))]
mod tests_parcours {
    use super::*;
    use crate::config::model::{Engine, SslMode};

    /// **Le parcours complet de `08g`** : une base déclarée sur le mauvais port devient joignable
    /// après correction.
    ///
    /// C'est le cas réel du 10 août 2026 — deux serveurs PostgreSQL sur la machine, la connexion
    /// enregistrée visant le mauvais, et aucun écran pour la corriger. Le décor du projet suffit à
    /// le rejouer : le port 1 n'écoute rien, celui de `DORABASE_TEST_PG` écoute.
    #[tokio::test]
    async fn corriger_le_port_rend_la_base_joignable() {
        let Ok(url) = std::env::var("DORABASE_TEST_PG") else {
            eprintln!("décor absent : DORABASE_TEST_PG non défini, test sauté");
            return;
        };
        let analysee: tokio_postgres::Config = url.parse().expect("URL de test analysable");
        let hote = match analysee.get_hosts().first() {
            Some(tokio_postgres::config::Host::Tcp(nom)) => nom.clone(),
            _ => panic!("l'adresse de test doit être TCP"),
        };
        let bon = *analysee.get_ports().first().expect("un port");
        let secret = analysee
            .get_password()
            .map(|octets| Secret::new(String::from_utf8_lossy(octets).into_owned()));

        let variante_de = |port: u16| ConnectionSettings {
            host: hote.clone(),
            port,
            default_database: analysee.get_dbname().expect("une base").to_owned(),
            username: analysee.get_user().expect("un utilisateur").to_owned(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        };

        // **Le port 1 n'écoute rien** : la connexion doit échouer avant la correction, sans quoi le
        // test ne prouverait pas que c'est elle qui change quelque chose.
        assert!(
            crate::engine::postgres::PostgresAdapter::connect(&variante_de(1), secret.as_ref())
                .await
                .is_err(),
            "le port 1 doit échouer"
        );

        let mut projects = vec![Project {
            name: "Atelier".into(),
            environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
            queries: Vec::new(),
            databases: vec![crate::config::model::Database {
                name: "analytics".to_owned(),
                engine: Engine::PostgreSql,
                environment: EnvironmentId::brut("dev"),
                connection: variante_de(1),
                consoles: Vec::new(),
            }],
        }];

        mettre_a_jour(
            &mut projects,
            Modification {
                project: "Atelier",
                database: "analytics",
                environment: EnvironmentId::brut("dev"),
                reglages: &variante_de(bon),
                password: secret.as_ref(),
            },
            &tests::magasin(),
            &mut |_| Ok(()),
        )
        .expect("modification");

        let corrigee = projects[0].databases[0].connection.clone();
        assert_eq!(corrigee.port, bon);
        // Le mot de passe fourni a été rangé et **référencé** : sans cela, la connexion échouerait
        // ici alors que le port est bon — et l'utilisateur croirait le port encore faux.
        assert!(corrigee.password.is_some());
        crate::engine::postgres::PostgresAdapter::connect(&corrigee, secret.as_ref())
            .await
            .expect("le port corrigé doit joindre la base");
    }
}

// --- Renommer un projet (`08i`) ---

#[cfg(test)]
mod tests_renommage {
    use super::tests::{magasin, magasin_defaillant, MagasinSync};
    use super::*;
    use crate::config::model::{EnvironmentId, SslMode};
    use std::collections::HashMap;

    fn variante(reference: Option<SecretRef>) -> ConnectionSettings {
        ConnectionSettings {
            host: "db.internal".into(),
            port: 5432,
            default_database: "analytics".into(),
            username: "dora_ro".into(),
            password: reference,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: true,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    /// Le décor, partagé avec les tests de suppression (`08j`) : les deux specs ont besoin du même
    /// projet à deux bases et trois secrets, et deux copies divergeraient.
    pub(super) fn decor_partage() -> Vec<Project> {
        decor()
    }

    /// Un projet à **deux bases et trois secrets** : le décor décide de ce que le test peut voir.
    /// Avec une seule base et un seul secret, une migration qui s'arrête à mi-parcours serait
    /// indiscernable d'une migration complète — un décor trop régulier ne mesure que lui-même.
    fn decor() -> Vec<Project> {
        vec![
            Project {
                name: "Halle".into(),
                environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
                queries: Vec::new(),
                // **Trois connexions et trois secrets** depuis `23b` : `analytics` en dev et en prod
                // sont deux connexions, là où c'était une base à deux variantes. Le décor porte
                // toujours plus d'un secret, pour qu'une migration arrêtée à mi-parcours se distingue
                // d'une migration complète : le décor doit rendre les deux distinguables.
                databases: vec![
                    Database {
                        name: "analytics".to_owned(),
                        engine: crate::config::model::Engine::PostgreSql,
                        environment: EnvironmentId::brut("dev"),
                        connection: variante(Some(reference_de("Halle", "analytics", "dev"))),
                        consoles: Vec::new(),
                    },
                    Database {
                        name: "analytics".to_owned(),
                        engine: crate::config::model::Engine::PostgreSql,
                        environment: EnvironmentId::brut("prod"),
                        connection: variante(Some(reference_de("Halle", "analytics", "prod"))),
                        consoles: Vec::new(),
                    },
                    Database {
                        name: "shop".to_owned(),
                        engine: crate::config::model::Engine::MySql,
                        environment: EnvironmentId::brut("prod"),
                        connection: variante(Some(reference_de("Halle", "shop", "prod"))),
                        consoles: Vec::new(),
                    },
                ],
            },
            // Un **voisin**, pour que « le projet renommé » se distingue de « le premier projet ».
            Project {
                name: "Outils".into(),
                environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
                queries: Vec::new(),
                databases: Vec::new(),
            },
        ]
    }

    /// Garnit le magasin des trois secrets du décor. `pub(super)` depuis `26`, dont les tests
    /// partent du même décor : deux fonctions de garnissage divergeraient au premier secret ajouté.
    pub(super) fn garnir(magasin: &MagasinSync) {
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            magasin.poser(
                &reference_de("Halle", base, env),
                &format!("mdp-{base}-{env}"),
            );
        }
    }

    #[test]
    fn renommer_deplace_les_secrets_et_ecrit_la_configuration() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);
        let mut ecrits = 0;

        let issue = renommer_projet(&mut projets, "Halle", "Atelier Nord", &m, &mut |_| {
            ecrits += 1;
            Ok(())
        })
        .expect("renommage");

        assert_eq!(projets[0].name, "Atelier Nord");
        assert_eq!(projets[1].name, "Outils", "le voisin n'a pas bougé");
        assert_eq!(ecrits, 1);

        // **Les trois secrets**, pas seulement le premier : c'est ce qu'un décor à une seule base
        // n'aurait pas pu montrer.
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            let nouvelle = reference_de("Atelier Nord", base, env);
            assert_eq!(
                m.retrieve(&nouvelle).expect("relecture"),
                Some(Secret::new(format!("mdp-{base}-{env}"))),
                "{base}/{env} doit être lisible sous le nouveau nom"
            );
            assert!(
                m.retrieve(&reference_de("Halle", base, env))
                    .expect("relecture")
                    .is_none(),
                "{base}/{env} ne doit plus exister sous l'ancien"
            );
        }

        // Les références du modèle suivent, sinon la configuration désignerait des secrets partis.
        assert_eq!(
            projets[0].databases[0].connection.password,
            Some(reference_de("Atelier Nord", "analytics", "dev"))
        );

        // Les clés de registre rendues portent l'**ancien** nom : ce sont celles à fermer.
        assert_eq!(issue.cles_a_fermer.len(), 3);
        assert!(issue.cles_a_fermer.iter().all(|cle| cle.contains("Halle")));
        assert!(issue.secrets_absents.is_empty());
    }

    #[test]
    fn la_configuration_n_est_ecrite_qu_une_fois_les_secrets_en_place() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);
        let mut vu_au_moment_de_l_ecriture = None;

        renommer_projet(&mut projets, "Halle", "Nouveau", &m, &mut |_| {
            // **L'ordre est la garantie de cette spec**, et il ne se vérifie pas après coup : au
            // moment où la configuration s'écrit, les secrets doivent déjà avoir bougé. L'inverse
            // laisserait une base sans mot de passe si l'écriture échouait.
            vu_au_moment_de_l_ecriture = Some(
                m.retrieve(&reference_de("Nouveau", "shop", "prod"))
                    .expect("relecture")
                    .is_some(),
            );
            Ok(())
        })
        .expect("renommage");

        assert_eq!(vu_au_moment_de_l_ecriture, Some(true));
    }

    #[test]
    fn un_magasin_en_panne_annule_tout_et_remet_les_secrets() {
        let mut projets = decor();
        // Le magasin **contient** les trois secrets mais refuse d'écrire : la panne survient au
        // premier déplacement. Sans le garnissage, il aurait rendu trois absences et le renommage
        // aurait réussi — le test n'aurait mesuré que le vide.
        let m = magasin_defaillant(true, false);
        garnir(&m);
        let mut ecrits = 0;

        let erreur = renommer_projet(&mut projets, "Halle", "Nouveau", &m, &mut |_| {
            ecrits += 1;
            Ok(())
        })
        .expect_err("le renommage doit échouer");

        assert!(matches!(erreur, RenameError::Secret { .. }));
        // **La configuration n'a pas été écrite du tout** : un projet à moitié renommé serait pire
        // qu'un refus.
        assert_eq!(ecrits, 0);
        assert_eq!(projets[0].name, "Halle");
        assert_eq!(
            projets[0].databases[0].connection.password,
            Some(reference_de("Halle", "analytics", "dev"))
        );
    }

    #[test]
    fn un_magasin_qui_ne_sait_pas_supprimer_laisse_un_doublon_mais_le_dit() {
        let mut projets = decor();
        let defaillant = magasin_defaillant(false, true);
        garnir(&defaillant);

        let issue = renommer_projet(&mut projets, "Halle", "Nouveau", &defaillant, &mut |_| {
            Ok(())
        })
        .expect("un magasin qui refuse de supprimer ne doit pas empêcher un renommage");

        // **La suppression est la dernière étape, et son échec ne compromet rien** : le renommage a
        // eu lieu, les secrets sont lisibles sous le nouveau nom, et il reste un doublon sous
        // l'ancien. Refuser le renommage pour cela serait absurde — et dans l'ordre précédent, où
        // les originaux partaient au fur et à mesure, la même panne rendait la restauration
        // impossible et pouvait faire perdre des mots de passe.
        assert_eq!(projets[0].name, "Nouveau");
        assert_eq!(issue.residus.len(), 3);
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            assert!(
                defaillant
                    .retrieve(&reference_de("Nouveau", base, env))
                    .expect("relecture")
                    .is_some(),
                "{base}/{env} doit être lisible sous le nouveau nom"
            );
        }
    }

    /// Un magasin qui accepte les `n` premières écritures puis refuse.
    ///
    /// **C'est le seul décor qui produit le défaut du rollback** : une référence posée sous le
    /// nouveau nom, puis un échec plus loin. Les deux drapeaux « tout ou rien » de `MagasinSync` ne
    /// peuvent pas le produire — ils échouent à la première écriture ou à aucune, et dans les deux
    /// cas il n'y a rien à défaire.
    struct MagasinCapricieux {
        contenu: std::sync::Mutex<HashMap<String, String>>,
        ecritures_avant_panne: std::sync::Mutex<usize>,
    }

    impl SecretStore for MagasinCapricieux {
        fn store(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
            let mut restantes = self.ecritures_avant_panne.lock().expect("compteur");
            if *restantes == 0 {
                return Err(SecretError::Magasin {
                    detail: "magasin en panne".into(),
                });
            }
            *restantes -= 1;
            self.contenu
                .lock()
                .expect("magasin")
                .insert(reference.as_str().to_owned(), secret.expose().to_owned());
            Ok(())
        }

        fn retrieve(&self, reference: &SecretRef) -> Result<Option<Secret>, SecretError> {
            Ok(self
                .contenu
                .lock()
                .expect("magasin")
                .get(reference.as_str())
                .map(Secret::new))
        }

        fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
            self.contenu
                .lock()
                .expect("magasin")
                .remove(reference.as_str());
            Ok(())
        }
    }

    #[test]
    fn une_reference_ecrite_juste_avant_l_echec_est_retiree() {
        let mut projets = decor();
        let contenu = HashMap::from([
            ("Halle/analytics/dev".to_owned(), "un".to_owned()),
            ("Halle/analytics/prod".to_owned(), "deux".to_owned()),
            ("Halle/shop/prod".to_owned(), "trois".to_owned()),
        ]);
        // Deux déplacements passent, le troisième échoue à l'écriture.
        let m = MagasinCapricieux {
            contenu: std::sync::Mutex::new(contenu),
            ecritures_avant_panne: std::sync::Mutex::new(2),
        };

        let erreur = renommer_projet(&mut projets, "Halle", "Nouveau", &m, &mut |_| Ok(()))
            .expect_err("le renommage doit échouer");
        assert!(matches!(
            erreur,
            RenameError::Secret {
                secrets_repris: true,
                ..
            }
        ));

        // **Rien ne subsiste sous le nouveau nom.** Une première version du rollback ne suivait que
        // les déplacements *complets* : les deux références déjà posées restaient là, et le prochain
        // démarrage aurait trouvé des secrets d'un projet qui n'existe pas.
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            assert!(
                m.retrieve(&reference_de("Nouveau", base, env))
                    .expect("relecture")
                    .is_none(),
                "{base}/{env} ne doit rien laisser sous le nouveau nom"
            );
            assert!(
                m.retrieve(&reference_de("Halle", base, env))
                    .expect("relecture")
                    .is_some(),
                "{base}/{env} doit être repris sous l'ancien"
            );
        }
        assert_eq!(projets[0].name, "Halle");
    }

    #[test]
    fn une_ecriture_impossible_remet_les_secrets_et_le_modele() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);

        let erreur = renommer_projet(&mut projets, "Halle", "Nouveau", &m, &mut |_| {
            Err("disque plein".to_owned())
        })
        .expect_err("le renommage doit échouer");

        match erreur {
            RenameError::Config {
                secrets_repris,
                reason,
            } => {
                assert!(secrets_repris);
                assert!(reason.contains("disque plein"));
            }
            autre => panic!("issue inattendue : {autre:?}"),
        }
        // Le modèle en mémoire est rendu : le laisser renommé ferait divorcer l'écran du fichier.
        assert_eq!(projets[0].name, "Halle");
        // **Désigné par nom et environnement, non par index.** Le décor porte trois connexions
        // depuis `23b`, et `databases[1]` est devenu `analytics` en prod : un index dans un décor qui
        // grandit désigne autre chose sans le dire.
        let shop = projets[0]
            .databases
            .iter()
            .find(|base| base.name == "shop" && base.environment == EnvironmentId::brut("prod"))
            .expect("le décor déclare shop en prod");
        assert_eq!(
            shop.connection.password,
            Some(reference_de("Halle", "shop", "prod"))
        );
        assert!(m
            .retrieve(&reference_de("Halle", "shop", "prod"))
            .expect("relecture")
            .is_some());
    }

    #[test]
    fn un_secret_absent_ne_bloque_pas_le_renommage() {
        let mut projets = decor();
        let m = magasin();
        // Deux secrets sur trois : le troisième a été effacé à la main dans le Trousseau.
        m.store(
            &reference_de("Halle", "analytics", "dev"),
            &Secret::new("mdp"),
        )
        .expect("garnissage");

        let issue = renommer_projet(&mut projets, "Halle", "Nouveau", &m, &mut |_| Ok(()))
            .expect("un secret absent ne doit pas rendre le projet irrenommable");

        assert_eq!(projets[0].name, "Nouveau");
        // Les deux absents sont **dits**, pour que l'écran puisse en avertir.
        assert_eq!(issue.secrets_absents.len(), 2);
        assert!(issue
            .secrets_absents
            .iter()
            .any(|reference| reference.contains("shop")));
    }

    #[test]
    fn le_secret_reste_lisible_dans_le_vrai_magasin_apres_renommage() {
        // **Le magasin réellement utilisé**, pas une simulation. Un renommage qui passe sur une
        // `HashMap` et échoue sur le magasin chiffré serait un renommage qui ne marche pas — et
        // c'est le magasin de tout développement, la signature ad hoc n'ouvrant pas le Trousseau.
        let repertoire = tempfile::tempdir().expect("répertoire temporaire");
        let magasin = crate::secrets::selectionner_pour(
            crate::secrets::SignatureKind::AdHoc,
            repertoire.path(),
        )
        .expect("magasin chiffré");
        let magasin = magasin.store.as_ref();

        let mut projets = decor();
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            magasin
                .store(
                    &reference_de("Halle", base, env),
                    &Secret::new(format!("mdp-{base}-{env}")),
                )
                .expect("garnissage");
        }

        renommer_projet(&mut projets, "Halle", "Atelier", magasin, &mut |_| Ok(()))
            .expect("renommage");

        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            assert_eq!(
                magasin
                    .retrieve(&reference_de("Atelier", base, env))
                    .expect("relecture"),
                Some(Secret::new(format!("mdp-{base}-{env}"))),
                "{base}/{env} doit rester lisible — sinon la base redemanderait son mot de passe"
            );
            assert!(magasin
                .retrieve(&reference_de("Halle", base, env))
                .expect("relecture")
                .is_none());
        }
    }

    #[test]
    fn un_nom_deja_pris_est_refuse_sans_rien_toucher() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);

        let erreur = renommer_projet(&mut projets, "Halle", "Outils", &m, &mut |_| Ok(()))
            .expect_err("deux projets homonymes rendraient les clés ambiguës");

        assert!(matches!(erreur, RenameError::DejaPris { .. }));
        assert_eq!(projets[0].name, "Halle");
        assert!(
            m.retrieve(&reference_de("Outils", "analytics", "dev"))
                .expect("relecture")
                .is_none(),
            "le refus doit précéder toute écriture de secret"
        );
    }

    #[test]
    fn renommer_en_son_propre_nom_ne_fait_rien() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);
        let mut ecrits = 0;

        let issue = renommer_projet(&mut projets, "Halle", "Halle", &m, &mut |_| {
            ecrits += 1;
            Ok(())
        })
        .expect("le même nom est l'état voulu, pas un doublon");

        // Ni écriture ni fermeture de connexion : l'utilisateur a validé sans changer le champ.
        assert_eq!(ecrits, 0);
        assert!(issue.cles_a_fermer.is_empty());
        assert_eq!(projets[0].name, "Halle");
    }

    #[test]
    fn un_nom_vide_ou_blanc_est_refuse() {
        let mut projets = decor();
        let m = magasin();
        assert!(matches!(
            renommer_projet(&mut projets, "Halle", "   ", &m, &mut |_| Ok(())),
            Err(RenameError::NomVide)
        ));
    }

    #[test]
    fn un_projet_inconnu_est_refuse() {
        let mut projets = decor();
        let m = magasin();
        assert!(matches!(
            renommer_projet(&mut projets, "Absent", "Nouveau", &m, &mut |_| Ok(())),
            Err(RenameError::Inconnu { .. })
        ));
    }

    #[test]
    fn le_nouveau_nom_est_debarrasse_de_ses_espaces() {
        let mut projets = decor();
        let m = magasin();
        garnir(&m);
        renommer_projet(&mut projets, "Halle", "  Atelier  ", &m, &mut |_| Ok(()))
            .expect("renommage");
        // Sinon la référence du secret porterait les espaces, et le nom affiché aussi.
        assert_eq!(projets[0].name, "Atelier");
        assert!(m
            .retrieve(&reference_de("Atelier", "shop", "prod"))
            .expect("relecture")
            .is_some());
    }
}

// --- Supprimer une déclaration de connexion (`08j`) ---

#[cfg(test)]
mod tests_suppression {
    use super::tests::{magasin, magasin_defaillant};
    use super::tests_renommage::decor_partage;
    use super::*;

    #[test]
    fn supprimer_une_base_retire_sa_declaration_et_son_secret() {
        let projets = decor_partage();
        let m = magasin();
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            m.poser(&reference_de("Halle", base, env), "mdp");
        }
        let mut ecrits = 0;

        let issue = supprimer_base(
            &projets,
            "Halle",
            "analytics",
            &EnvironmentId::brut("dev"),
            &m,
            &mut |_| {
                ecrits += 1;
                Ok(())
            },
        )
        .expect("suppression");

        assert_eq!(ecrits, 1);
        // **Une connexion retirée, deux restantes** — et c'est le changement de `23b`. Ce test
        // affirmait l'inverse : supprimer « analytics » emportait ses deux variantes et leurs deux
        // secrets. Une connexion appartient désormais à un environnement, donc `analytics` en prod
        // n'est pas concernée par la suppression de `analytics` en dev.
        assert_eq!(issue.projects[0].databases.len(), 2);
        assert!(
            m.retrieve(&reference_de("Halle", "analytics", "dev"))
                .expect("relecture")
                .is_none(),
            "le secret de la connexion retirée doit être effacé"
        );
        // **L'homonyme survit, secret compris.** C'est la garantie la plus facile à casser du nouveau
        // modèle : une suppression qui filtrerait sur le seul nom emporterait les deux.
        assert!(
            m.retrieve(&reference_de("Halle", "analytics", "prod"))
                .expect("relecture")
                .is_some(),
            "analytics/prod est une autre connexion, elle reste"
        );
        // Et le voisin d'un autre nom aussi : sans lui, « supprimer la bonne » serait indiscernable
        // de « tout supprimer ».
        assert!(m
            .retrieve(&reference_de("Halle", "shop", "prod"))
            .expect("relecture")
            .is_some());
        // Une seule connexion fermée : celle qu'on a retirée.
        assert_eq!(issue.cles_a_fermer.len(), 1);
        assert!(issue.secrets_residuels.is_empty());
    }

    #[test]
    fn supprimer_un_projet_retire_toutes_ses_bases_et_leurs_secrets() {
        let projets = decor_partage();
        let m = magasin();
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            m.poser(&reference_de("Halle", base, env), "mdp");
        }

        let issue = supprimer_projet(&projets, "Halle", &m, &mut |_| Ok(())).expect("suppression");

        assert_eq!(issue.projects.len(), 1);
        assert_eq!(issue.projects[0].name, "Outils", "le voisin reste");
        assert_eq!(issue.cles_a_fermer.len(), 3);
        for (base, env) in [
            ("analytics", "dev"),
            ("analytics", "prod"),
            ("shop", "prod"),
        ] {
            assert!(m
                .retrieve(&reference_de("Halle", base, env))
                .expect("relecture")
                .is_none());
        }
    }

    #[test]
    fn un_secret_deja_absent_ne_fait_pas_echouer_la_suppression() {
        let projets = decor_partage();
        // Magasin vide : les mots de passe ont été effacés à la main dans le Trousseau.
        let m = magasin();

        let issue = supprimer_base(
            &projets,
            "Halle",
            "analytics",
            &EnvironmentId::brut("dev"),
            &m,
            &mut |_| Ok(()),
        )
        .expect("un mot de passe déjà absent ne doit pas rendre l'entrée indélébile");

        // Deux connexions restantes : `analytics` en prod et `shop` en prod (`23b`).
        assert_eq!(issue.projects[0].databases.len(), 2);
        // `delete` d'une référence absente réussit : rien à signaler.
        assert!(issue.secrets_residuels.is_empty());
    }

    #[test]
    fn un_secret_qui_resiste_est_dit_mais_n_empeche_pas_la_suppression() {
        let projets = decor_partage();
        let m = magasin_defaillant(false, true);
        for env in ["dev", "prod"] {
            m.poser(&reference_de("Halle", "analytics", env), "mdp");
        }

        let issue = supprimer_base(
            &projets,
            "Halle",
            "analytics",
            &EnvironmentId::brut("dev"),
            &m,
            &mut |_| Ok(()),
        )
        .expect("un magasin qui refuse d'effacer ne doit pas rendre l'entrée indélébile");

        assert_eq!(issue.projects[0].databases.len(), 2);
        // **Dit, jamais tu** : le mot de passe reste dans le Trousseau, et l'écran doit pouvoir
        // l'annoncer plutôt que de laisser croire à un nettoyage complet.
        //
        // **Un seul, et non deux.** Ce test en attendait deux, du temps où une base emportait ses
        // variantes ; une connexion n'a qu'un secret (`23b`). Ce qui compte n'a pas changé : un résidu
        // se signale.
        assert_eq!(issue.secrets_residuels.len(), 1);
    }

    #[test]
    fn une_ecriture_impossible_fait_echouer_la_suppression() {
        let projets = decor_partage();
        let m = magasin();
        m.poser(&reference_de("Halle", "shop", "prod"), "mdp");

        let erreur = supprimer_base(
            &projets,
            "Halle",
            "shop",
            &EnvironmentId::brut("prod"),
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("la suppression doit échouer");

        assert!(matches!(erreur, DeleteError::Config { .. }));
        // Le modèle reçu n'est pas modifié — la fonction travaille sur une copie.
        // Trois connexions dans le décor depuis `23b` : rien n'a été retiré.
        assert_eq!(projets[0].databases.len(), 3);
    }

    #[test]
    fn une_ecriture_impossible_laisse_le_mot_de_passe_intact() {
        let projets = decor_partage();
        let m = magasin();
        m.poser(&reference_de("Halle", "shop", "prod"), "mdp");

        supprimer_base(
            &projets,
            "Halle",
            "shop",
            &EnvironmentId::brut("prod"),
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("la suppression doit échouer");

        // **La phase destructive vient en dernier, et c'est ce test qui l'exige.** Dans l'ordre
        // inverse — secrets d'abord — la base restait déclarée sans son mot de passe, et le
        // redemandait à la prochaine connexion sans que rien l'explique.
        assert!(
            m.retrieve(&reference_de("Halle", "shop", "prod"))
                .expect("relecture")
                .is_some(),
            "une configuration non écrite ne doit rien avoir effacé"
        );
    }

    #[test]
    fn une_base_ou_un_projet_inconnu_est_refuse() {
        let projets = decor_partage();
        let m = magasin();
        assert!(matches!(
            supprimer_base(
                &projets,
                "Halle",
                "absente",
                &EnvironmentId::brut("dev"),
                &m,
                &mut |_| Ok(())
            ),
            Err(DeleteError::BaseInconnue { .. })
        ));
        assert!(matches!(
            supprimer_projet(&projets, "Absent", &m, &mut |_| Ok(())),
            Err(DeleteError::Inconnu { .. })
        ));
    }

    /// **La garantie centrale de `08j`, vérifiée et non supposée.**
    ///
    /// Un magasin qui *panique* si on lui demande autre chose qu'une suppression, et l'absence de
    /// tout moteur dans la signature : si une future version de ces fonctions ouvrait une connexion
    /// ou émettait un `DROP`, elle ne compilerait pas — il n'y a rien pour le faire. Ce test fixe
    /// l'autre moitié : aucune lecture de secret, aucune écriture, seulement des suppressions.
    #[test]
    fn supprimer_n_emet_aucun_sql_et_ne_lit_aucun_secret() {
        struct Vigile(std::sync::Mutex<Vec<String>>);
        impl SecretStore for Vigile {
            fn store(&self, _: &SecretRef, _: &Secret) -> Result<(), SecretError> {
                panic!("supprimer une déclaration ne doit rien écrire dans le magasin")
            }
            fn retrieve(&self, _: &SecretRef) -> Result<Option<Secret>, SecretError> {
                panic!("supprimer une déclaration ne doit lire aucun mot de passe")
            }
            fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
                self.0
                    .lock()
                    .expect("vigile")
                    .push(reference.as_str().to_owned());
                Ok(())
            }
        }

        let projets = decor_partage();
        let vigile = Vigile(std::sync::Mutex::new(Vec::new()));
        supprimer_projet(&projets, "Halle", &vigile, &mut |_| Ok(())).expect("suppression");

        let vus = vigile.0.lock().expect("vigile").clone();
        assert_eq!(vus.len(), 3, "trois secrets déclarés, trois suppressions");
    }
}

// --- Les consoles (20 août 2026) ---

#[cfg(test)]
mod tests_consoles {
    use super::*;

    fn connexion(nom: &str, env: &str) -> Database {
        Database {
            name: nom.to_owned(),
            engine: crate::config::model::Engine::PostgreSql,
            environment: EnvironmentId::brut(env),
            connection: crate::config::model::ConnectionSettings {
                host: "localhost".into(),
                port: 5432,
                default_database: nom.to_owned(),
                username: "lecteur".into(),
                password: None,
                ssl_mode: crate::config::model::SslMode::Prefer,
                ca_certificate: None,
                auth_database: None,
                read_only: true,
                reconnect_on_startup: false,
                tunnel: None,
            },
            consoles: Vec::new(),
        }
    }

    /// `analytics` déclarée **en dev et en prod** : le décor qui rend visible la confusion que
    /// l'environnement évite dans l'identité d'une console.
    fn projets() -> Vec<Project> {
        vec![Project {
            name: "Halle".into(),
            environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
            databases: vec![
                connexion("analytics", "dev"),
                connexion("analytics", "prod"),
            ],
            queries: Vec::new(),
        }]
    }

    fn prod() -> EnvironmentId {
        EnvironmentId::brut("prod")
    }

    #[test]
    fn une_console_creee_est_vide_et_porte_son_nom() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "Exploration")
            .expect("création");
        assert_eq!(p[0].databases[1].consoles.len(), 1);
        assert_eq!(p[0].databases[1].consoles[0].name, "Exploration");
        assert_eq!(p[0].databases[1].consoles[0].sql, "");
        // La connexion de dev, elle, n'a rien reçu.
        assert!(p[0].databases[0].consoles.is_empty());
    }

    /// **Le test qui dit pourquoi l'environnement est dans l'identité.** Sans lui, la seconde
    /// création verrait un homonyme et refuserait — ou pire, écrirait dans la mauvaise connexion.
    #[test]
    fn deux_connexions_homonymes_portent_chacune_leur_console_de_meme_nom() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "Exploration")
            .expect("prod");
        let p = ajouter_console(
            &p,
            "Halle",
            "analytics",
            &EnvironmentId::brut("dev"),
            "Exploration",
        )
        .expect("dev");
        assert_eq!(p[0].databases[0].consoles[0].name, "Exploration");
        assert_eq!(p[0].databases[1].consoles[0].name, "Exploration");
    }

    #[test]
    fn deux_consoles_de_meme_nom_sous_une_connexion_sont_refusees() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "Exploration")
            .expect("création");
        assert!(matches!(
            ajouter_console(&p, "Halle", "analytics", &prod(), "Exploration"),
            Err(ConsoleError::NomDeja { .. })
        ));
    }

    #[test]
    fn un_nom_vide_ou_blanc_est_refuse() {
        assert!(matches!(
            ajouter_console(&projets(), "Halle", "analytics", &prod(), "   "),
            Err(ConsoleError::NomVide)
        ));
    }

    #[test]
    fn ecrire_dans_une_console_absente_est_un_refus() {
        // Le geste a changé de nature depuis `12f` : on écrit dans une console qui existe déjà.
        assert!(matches!(
            enregistrer_sql_de_console(&projets(), "Halle", "analytics", &prod(), "X", "select 1"),
            Err(ConsoleError::Inconnue { .. })
        ));
    }

    #[test]
    fn le_texte_dune_console_se_persiste_et_se_remplace() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "Exploration")
            .expect("créée");
        let p = enregistrer_sql_de_console(
            &p,
            "Halle",
            "analytics",
            &prod(),
            "Exploration",
            "select 1",
        )
        .expect("écriture");
        assert_eq!(p[0].databases[1].consoles[0].sql, "select 1");
        let p = enregistrer_sql_de_console(
            &p,
            "Halle",
            "analytics",
            &prod(),
            "Exploration",
            "select 2",
        )
        .expect("réécriture");
        assert_eq!(p[0].databases[1].consoles.len(), 1);
        assert_eq!(p[0].databases[1].consoles[0].sql, "select 2");
    }

    #[test]
    fn renommer_garde_le_texte() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "Exploration")
            .expect("créée");
        let p = enregistrer_sql_de_console(
            &p,
            "Halle",
            "analytics",
            &prod(),
            "Exploration",
            "select 1",
        )
        .expect("écriture");
        let p = renommer_console(&p, "Halle", "analytics", &prod(), "Exploration", "Audit")
            .expect("renommage");
        assert_eq!(p[0].databases[1].consoles[0].name, "Audit");
        assert_eq!(p[0].databases[1].consoles[0].sql, "select 1");
    }

    #[test]
    fn renommer_vers_un_nom_pris_est_refuse_mais_vers_soi_meme_est_accepte() {
        let p = ajouter_console(&projets(), "Halle", "analytics", &prod(), "A").expect("A");
        let p = ajouter_console(&p, "Halle", "analytics", &prod(), "B").expect("B");
        assert!(matches!(
            renommer_console(&p, "Halle", "analytics", &prod(), "A", "B"),
            Err(ConsoleError::NomDeja { .. })
        ));
        assert!(renommer_console(&p, "Halle", "analytics", &prod(), "A", "A").is_ok());
    }

    #[test]
    fn retirer_une_console_absente_nest_pas_un_echec() {
        assert!(retirer_console(&projets(), "Halle", "analytics", &prod(), "Fantôme").is_ok());
    }

    #[test]
    fn une_connexion_inconnue_est_un_refus_nomme() {
        assert!(matches!(
            ajouter_console(&projets(), "Halle", "absente", &prod(), "X"),
            Err(ConsoleError::ConnexionInconnue { .. })
        ));
        assert!(matches!(
            ajouter_console(&projets(), "Ailleurs", "analytics", &prod(), "X"),
            Err(ConsoleError::ProjetInconnu { .. })
        ));
    }

    // --- La reprise des requêtes de `12f` ---

    #[test]
    fn les_requetes_deviennent_des_consoles_de_la_premiere_connexion() {
        let mut projets = projets();
        projets[0].queries = vec![
            crate::config::model::SavedQuery {
                name: "CA par jour".into(),
                sql: "select 1".into(),
            },
            crate::config::model::SavedQuery {
                name: "Top clients".into(),
                sql: "select 2".into(),
            },
        ];
        migrer_requetes_en_consoles(&mut projets);
        assert!(projets[0].queries.is_empty());
        let consoles = &projets[0].databases[0].consoles;
        assert_eq!(consoles.len(), 2);
        assert_eq!(consoles[0].name, "CA par jour");
        assert_eq!(consoles[0].sql, "select 1");
        assert_eq!(consoles[1].sql, "select 2");
    }

    /// **Rien n'est perdu quand il n'y a nulle part où verser.** Les requêtes restent dans le
    /// projet, donc dans le fichier, et la migration se rejouera au prochain chargement — une fois
    /// qu'une connexion aura été déclarée.
    #[test]
    fn sans_connexion_les_requetes_attendent() {
        let mut projets = vec![Project {
            name: "Neuf".into(),
            environments: crate::config::model::EnvironmentDeclaration::trio_par_defaut(),
            databases: Vec::new(),
            queries: vec![crate::config::model::SavedQuery {
                name: "CA".into(),
                sql: "select 1".into(),
            }],
        }];
        migrer_requetes_en_consoles(&mut projets);
        assert_eq!(projets[0].queries.len(), 1);
    }

    /// La migration ne doit **jamais** échouer : un homonyme bloquerait tout le chargement.
    #[test]
    fn un_homonyme_est_suffixe_plutot_que_refuse() {
        let mut projets = projets();
        projets[0].databases[0].consoles.push(Console {
            name: "CA".into(),
            sql: "déjà là".into(),
        });
        projets[0].queries = vec![crate::config::model::SavedQuery {
            name: "CA".into(),
            sql: "select 1".into(),
        }];
        migrer_requetes_en_consoles(&mut projets);
        let consoles = &projets[0].databases[0].consoles;
        assert_eq!(consoles.len(), 2);
        assert_eq!(consoles[0].sql, "déjà là");
        assert_eq!(consoles[1].name, "CA (reprise)");
        assert_eq!(consoles[1].sql, "select 1");
    }

    /// Une migration déjà faite ne se rejoue pas : le champ est vide, la boucle passe son chemin.
    #[test]
    fn la_migration_est_idempotente() {
        let mut projets = projets();
        projets[0].queries = vec![crate::config::model::SavedQuery {
            name: "CA".into(),
            sql: "select 1".into(),
        }];
        migrer_requetes_en_consoles(&mut projets);
        migrer_requetes_en_consoles(&mut projets);
        assert_eq!(projets[0].databases[0].consoles.len(), 1);
    }
}

/// Les tests du renommage d'une **connexion** (`26`).
///
/// Séparés de `tests_renommage`, qui teste celui d'un projet : les deux fonctions partagent l'ordre
/// des effets, pas ce qui les fait échouer — l'unicité par environnement et la désignation par le
/// couple n'ont pas d'équivalent côté projet.
#[cfg(test)]
mod tests_renommage_connexion {
    use super::tests::{magasin, magasin_defaillant};
    use super::tests_renommage::{decor_partage, garnir};
    use super::*;
    use crate::config::model::{Console, EnvironmentId};

    fn dev() -> EnvironmentId {
        EnvironmentId::brut("dev")
    }

    fn prod() -> EnvironmentId {
        EnvironmentId::brut("prod")
    }

    #[test]
    fn renommer_deplace_le_secret_et_ecrit_la_configuration() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);
        let mut ecrits = 0;

        let issue = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| {
                ecrits += 1;
                Ok(())
            },
        )
        .expect("renommage");

        assert_eq!(projets[0].databases[0].name, "entrepot");
        assert_eq!(ecrits, 1);
        assert_eq!(
            projets[0].databases[0].connection.password,
            Some(reference_de("Halle", "entrepot", "dev")),
            "la référence du modèle suit, sinon la configuration désignerait un secret parti"
        );
        assert_eq!(
            m.retrieve(&reference_de("Halle", "entrepot", "dev"))
                .expect("relecture"),
            Some(Secret::new("mdp-analytics-dev")),
        );
        assert!(
            m.retrieve(&reference_de("Halle", "analytics", "dev"))
                .expect("relecture")
                .is_none(),
            "l'original est effacé, en dernier"
        );

        // **L'homonyme de prod n'a pas bougé** : c'est ce qu'un décor à une seule `analytics`
        // n'aurait pas pu montrer, et c'est le défaut le plus probable de cette fonction.
        assert_eq!(projets[0].databases[1].name, "analytics");
        assert_eq!(projets[0].databases[1].environment, prod());
        assert!(m
            .retrieve(&reference_de("Halle", "analytics", "prod"))
            .expect("relecture")
            .is_some());

        // La clé rendue porte l'**ancien** nom : c'est celle à fermer.
        assert_eq!(
            issue.cles_a_fermer,
            vec![crate::engine::registry::cle("Halle", "analytics", "dev")]
        );
        assert!(issue.secrets_absents.is_empty());
        assert!(issue.residus.is_empty());
    }

    #[test]
    fn la_configuration_n_est_ecrite_qu_une_fois_le_secret_en_place() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);
        let mut vu_au_moment_de_l_ecriture = None;

        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| {
                // L'ordre est la garantie de cette fonction : si la configuration était écrite
                // d'abord, elle désignerait un secret qui n'existe pas encore.
                vu_au_moment_de_l_ecriture = Some(
                    m.retrieve(&reference_de("Halle", "entrepot", "dev"))
                        .expect("relecture")
                        .is_some(),
                );
                Ok(())
            },
        )
        .expect("renommage");

        assert_eq!(vu_au_moment_de_l_ecriture, Some(true));
    }

    #[test]
    fn l_original_n_est_efface_qu_apres_l_ecriture() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);
        let mut ancien_encore_la = None;

        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| {
                // Tant que la configuration n'est pas écrite, l'original doit être là : c'est ce qui
                // rend l'échec réversible.
                ancien_encore_la = Some(
                    m.retrieve(&reference_de("Halle", "analytics", "dev"))
                        .expect("relecture")
                        .is_some(),
                );
                Ok(())
            },
        )
        .expect("renommage");

        assert_eq!(ancien_encore_la, Some(true));
    }

    #[test]
    fn un_magasin_qui_refuse_d_ecrire_annule_tout() {
        let mut projets = decor_partage();
        let defaillant = magasin_defaillant(true, false);
        garnir(&defaillant);
        let mut ecrits = 0;

        let erreur = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &defaillant,
            &mut |_| {
                ecrits += 1;
                Ok(())
            },
        )
        .expect_err("le magasin refuse");

        assert!(matches!(
            erreur,
            RenameError::Secret {
                secrets_repris: true,
                ..
            }
        ));
        assert_eq!(ecrits, 0, "la configuration ne doit pas avoir été écrite");
        assert_eq!(projets[0].databases[0].name, "analytics");
        assert!(
            defaillant
                .retrieve(&reference_de("Halle", "analytics", "dev"))
                .expect("relecture")
                .is_some(),
            "le mot de passe d'origine est intact"
        );
    }

    #[test]
    fn un_echec_d_ecriture_retire_le_secret_pose_et_rend_le_modele() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);

        let erreur = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| Err("disque plein".to_owned()),
        )
        .expect_err("l'écriture échoue");

        assert!(matches!(
            erreur,
            RenameError::Config {
                secrets_repris: true,
                ..
            }
        ));
        assert_eq!(
            projets[0].databases[0].name, "analytics",
            "le modèle en mémoire ne doit pas rester renommé alors que le disque ne l'est pas"
        );
        assert!(
            m.retrieve(&reference_de("Halle", "entrepot", "dev"))
                .expect("relecture")
                .is_none(),
            "le secret posé sous le nouveau nom est retiré : sinon un doublon que rien ne nettoie"
        );
        assert!(m
            .retrieve(&reference_de("Halle", "analytics", "dev"))
            .expect("relecture")
            .is_some());
    }

    #[test]
    fn un_secret_introuvable_ne_bloque_pas_et_est_rapporte() {
        let mut projets = decor_partage();
        // Le magasin est **vide** : la connexion déclare une référence dont le secret a disparu.
        let m = magasin();

        let issue = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| Ok(()),
        )
        .expect("un secret absent ne bloque pas");

        assert_eq!(projets[0].databases[0].name, "entrepot");
        assert_eq!(
            issue.secrets_absents,
            vec!["Halle/analytics/dev".to_owned()],
            "l'écran doit pouvoir le dire plutôt que le taire"
        );
    }

    #[test]
    fn un_residu_de_suppression_est_rapporte_sans_annuler() {
        let mut projets = decor_partage();
        let m = magasin_defaillant(false, true);
        garnir(&m);

        let issue = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| Ok(()),
        )
        .expect("un échec de suppression ne compromet rien");

        assert_eq!(projets[0].databases[0].name, "entrepot");
        assert_eq!(issue.residus, vec!["Halle/analytics/dev".to_owned()]);
    }

    #[test]
    fn un_nom_deja_pris_dans_le_meme_environnement_est_refuse() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);

        // `shop` est déclarée en prod, comme la connexion visée.
        let erreur = renommer_connexion(
            &mut projets,
            "Halle",
            &prod(),
            "analytics",
            "shop",
            &m,
            &mut |_| Ok(()),
        )
        .expect_err("doublon");

        assert!(matches!(erreur, RenameError::ConnexionPrise { .. }));
        assert_eq!(projets[0].databases[1].name, "analytics");
    }

    #[test]
    fn le_meme_nom_dans_un_autre_environnement_est_accepte() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);

        // `shop` existe en prod ; la renommer ainsi **en dev** est le modèle même de `23b`.
        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "shop",
            &m,
            &mut |_| Ok(()),
        )
        .expect("deux homonymes dans deux environnements sont légitimes");

        assert_eq!(projets[0].databases[0].name, "shop");
        assert_eq!(projets[0].databases[0].environment, dev());
    }

    #[test]
    fn renommer_en_son_propre_nom_ne_fait_rien() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);
        let mut ecrits = 0;

        let issue = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "analytics",
            &m,
            &mut |_| {
                ecrits += 1;
                Ok(())
            },
        )
        .expect("un non-geste n'est pas une erreur");

        assert_eq!(ecrits, 0);
        assert!(issue.cles_a_fermer.is_empty(), "rien à fermer");
    }

    #[test]
    fn un_nom_vide_est_refuse() {
        let mut projets = decor_partage();
        let m = magasin();
        assert!(matches!(
            renommer_connexion(
                &mut projets,
                "Halle",
                &dev(),
                "analytics",
                "   ",
                &m,
                &mut |_| Ok(())
            ),
            Err(RenameError::NomVide)
        ));
    }

    #[test]
    fn le_nouveau_nom_est_debarrasse_de_ses_espaces() {
        let mut projets = decor_partage();
        let m = magasin();
        garnir(&m);

        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "  entrepot  ",
            &m,
            &mut |_| Ok(()),
        )
        .expect("renommage");

        // Sinon la référence du secret porterait les espaces, et le nom affiché aussi.
        assert_eq!(projets[0].databases[0].name, "entrepot");
        assert!(m
            .retrieve(&reference_de("Halle", "entrepot", "dev"))
            .expect("relecture")
            .is_some());
    }

    #[test]
    fn une_connexion_absente_de_cet_environnement_est_refusee() {
        let mut projets = decor_partage();
        let m = magasin();

        // `shop` n'existe qu'en prod : la viser en dev doit être refusé plutôt que de renommer la
        // première connexion de ce nom, quel que soit son environnement.
        assert!(matches!(
            renommer_connexion(
                &mut projets,
                "Halle",
                &dev(),
                "shop",
                "boutique",
                &m,
                &mut |_| { Ok(()) }
            ),
            Err(RenameError::ConnexionInconnue { .. })
        ));
        assert!(matches!(
            renommer_connexion(
                &mut projets,
                "Absent",
                &dev(),
                "analytics",
                "entrepot",
                &m,
                &mut |_| Ok(())
            ),
            Err(RenameError::Inconnu { .. })
        ));
    }

    #[test]
    fn les_consoles_suivent_la_connexion_renommee() {
        let mut projets = decor_partage();
        projets[0].databases[0].consoles = vec![Console {
            name: "console 1".to_owned(),
            sql: "select 1".to_owned(),
        }];
        let m = magasin();
        garnir(&m);

        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| Ok(()),
        )
        .expect("renommage");

        // Les consoles vivent **dans** la connexion : elles suivent sans code, et ce test fige la
        // propriété plutôt que de la supposer.
        assert_eq!(projets[0].databases[0].consoles.len(), 1);
        assert_eq!(projets[0].databases[0].consoles[0].sql, "select 1");
    }

    #[test]
    fn le_secret_reste_lisible_dans_le_vrai_magasin_apres_renommage() {
        // **Le magasin réellement utilisé**, pas une simulation — la leçon de `08i` : un renommage
        // qui passe sur une `HashMap` et échoue sur le magasin chiffré est un renommage qui ne
        // marche pas. La signature ad hoc n'ouvrant pas le Trousseau, c'est ce magasin-là qui sert
        // en développement.
        let repertoire = tempfile::tempdir().expect("répertoire temporaire");
        let magasin = crate::secrets::selectionner_pour(
            crate::secrets::SignatureKind::AdHoc,
            repertoire.path(),
        )
        .expect("magasin chiffré");
        let magasin = magasin.store.as_ref();

        let mut projets = decor_partage();
        magasin
            .store(
                &reference_de("Halle", "analytics", "dev"),
                &Secret::new("mdp-analytics-dev"),
            )
            .expect("garnissage");

        renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            magasin,
            &mut |_| Ok(()),
        )
        .expect("renommage");

        assert_eq!(
            magasin
                .retrieve(&reference_de("Halle", "entrepot", "dev"))
                .expect("relecture"),
            Some(Secret::new("mdp-analytics-dev"))
        );
        assert!(magasin
            .retrieve(&reference_de("Halle", "analytics", "dev"))
            .expect("relecture")
            .is_none());
    }

    #[test]
    fn une_connexion_sans_mot_de_passe_se_renomme_quand_meme() {
        let mut projets = decor_partage();
        projets[0].databases[0].connection.password = None;
        let m = magasin();

        let issue = renommer_connexion(
            &mut projets,
            "Halle",
            &dev(),
            "analytics",
            "entrepot",
            &m,
            &mut |_| Ok(()),
        )
        .expect("SQLite sur fichier n'a pas de secret, et se renomme comme les autres");

        assert_eq!(projets[0].databases[0].name, "entrepot");
        assert_eq!(projets[0].databases[0].connection.password, None);
        assert!(issue.secrets_absents.is_empty(), "aucun secret n'était dû");
    }
}
