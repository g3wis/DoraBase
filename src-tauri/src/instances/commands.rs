//! Les commandes IPC du gestionnaire d'instances (`API-32`).
//!
//! # Ce que le front n'envoie jamais
//!
//! **Ni réglages de connexion, ni SQL.** Une commande reçoit un `InstanceId` et, quand il y a un
//! geste, l'`InstanceAction` nommée qui le décrit ; tout le reste — hôte, port, mot de passe, et
//! l'ordre SQL lui-même — est relu du disque ou composé par le cœur. C'est l'arbitrage de
//! `load_projects` étendu à un écran qui écrit sur un serveur : une déclaration envoyée par l'écran
//! pourrait être périmée, et sur cet écran-là « périmée » veut dire « le bon ordre, sur la mauvaise
//! machine ».

use tauri::{AppHandle, Manager, State};

use crate::config::{
    cle_de_registre, declarer, moteur_manage, retirer, ConfigState, ConnectionSettings,
    DeclarationInstance, Engine, InstanceId, ManagedInstance,
};
use crate::engine::registry::{ConnectionRegistry, ConnectionState, Reprise};
use crate::engine::EngineError;
use crate::instances::{
    InstanceAction, InstanceDatabase, InstanceExtension, InstanceOutcome, InstanceOverview,
    InstancePlan, InstancePrivilege, InstanceRole, InstanceSession, InstanceSetting,
};
use crate::secrets::Secret;

/// Ce que la modale de déclaration envoie.
///
/// **Le mot de passe est en clair et séparé**, comme dans `SaveDatabaseRequest` : aucune `SecretRef`
/// n'existe avant que le secret soit rangé, et c'est le travail de `config::declarer`.
#[derive(Debug, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct SaveInstanceRequest {
    /// `None` déclare une instance neuve ; `Some` modifie celle-là.
    pub id: Option<InstanceId>,
    pub label: String,
    pub engine: Engine,
    pub connection: ConnectionSettings,
    pub production: bool,
    pub confirm_writes: bool,
    /// `None` laisse le mot de passe en place — un champ vide veut dire « inchangé ».
    pub password: Option<String>,
}

/// Ce qu'un retrait rend.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct DeleteInstanceResult {
    pub instances: Vec<ManagedInstance>,
    /// Vrai quand un mot de passe n'a **pas** pu être retiré du magasin. L'écran le dit ; le retrait,
    /// lui, a bien eu lieu.
    pub secret_residuel: bool,
}

/// Déclare une instance, ou met à jour celle qu'on désigne. Rend la liste entière.
///
/// **La liste entière et non la seule instance touchée** : c'est ce que font déjà les cinq gestes de
/// `23c`, et ce qui permet à l'écran de la reposer sans second aller-retour — donc sans fenêtre
/// pendant laquelle la sidebar montrerait l'état d'avant.
#[tauri::command]
pub async fn save_instance(
    app: AppHandle,
    request: SaveInstanceRequest,
    state: State<'_, ConfigState>,
) -> Result<Vec<ManagedInstance>, String> {
    let repertoire = repertoire_de_configuration(&app)?;
    let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;
    let secret = request.password.as_deref().map(Secret::new);

    ecrire_les_instances(&state, |instances, ecrire| {
        declarer(
            instances,
            DeclarationInstance {
                id: request.id.clone(),
                label: request.label.clone(),
                engine: request.engine,
                connection: request.connection.clone(),
                production: request.production,
                confirm_writes: request.confirm_writes,
                password: secret.as_ref(),
            },
            magasin.store.as_ref(),
            ecrire,
        )
        .map_err(|erreur| erreur.to_string())
    })
}

/// Retire une instance, son secret, et **ferme sa connexion**.
///
/// La fermeture n'est pas un détail de ménage : le registre tient l'adaptateur *et* le proxy, donc
/// une instance retirée sans fermeture laisserait un tunnel SSH vivant et un port lié, pour une
/// ligne qui n'existe plus. C'est la même raison qui fait fermer les connexions d'un projet retiré.
#[tauri::command]
pub async fn delete_instance(
    app: AppHandle,
    id: InstanceId,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<DeleteInstanceResult, String> {
    let repertoire = repertoire_de_configuration(&app)?;
    let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| e.to_string())?;

    let mut residuel = false;
    let instances = ecrire_les_instances(&state, |instances, ecrire| {
        let issue = retirer(instances, &id, magasin.store.as_ref(), ecrire)
            .map_err(|erreur| erreur.to_string())?;
        residuel = issue.secret_residuel;
        Ok(issue.instances)
    })?;

    registry.fermer(&cle_de_registre(&id)).await;

    Ok(DeleteInstanceResult {
        instances,
        secret_residuel: residuel,
    })
}

/// Ouvre la connexion d'administration d'une instance.
///
/// **Le moteur est refusé ici aussi, et ce n'est pas une redondance avec la modale.** L'écran cache
/// les trois autres moteurs ; ce refus garde le chemin qui ne passe pas par l'écran — un fichier de
/// configuration écrit à la main, ou une déclaration faite par une version future. C'est le partage
/// des modes SSL : l'écran qui cache et le moteur qui refuse gardent deux chemins différents.
#[tauri::command]
pub async fn open_instance(
    app: AppHandle,
    id: InstanceId,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ConnectionState, EngineError> {
    let instance = lire_instance(&state, &id)?;
    if !moteur_manage(instance.engine) {
        return Err(EngineError::local(format!(
            "DoraBase ne sait pas encore gérer une instance {}. PostgreSQL est le seul moteur \
             managé pour l'instant.",
            instance.engine.nom()
        )));
    }

    let cle = cle_de_registre(&id);
    log::info!("open_instance ← {cle}");

    let secret = match &instance.connection.password {
        Some(reference) => {
            let repertoire = repertoire_de_configuration(&app).map_err(EngineError::local)?;
            let magasin = crate::secrets::selectionner(&repertoire).map_err(|e| {
                EngineError::local(format!("magasin de secrets indisponible : {e}"))
            })?;
            magasin.store.retrieve(reference).map_err(|e| {
                EngineError::local(format!("le mot de passe n'a pas pu être relu : {e}"))
            })?
        }
        None => None,
    };

    registry
        .ouvrir(
            &cle,
            instance.engine,
            &instance.connection,
            secret.as_ref(),
            &crate::engine::commands::known_hosts_utilisateur(),
        )
        .await?;

    let etat = registry.etat(&cle).await;
    log::info!("open_instance → {cle} : {etat:?}");
    Ok(etat)
}

#[tauri::command]
pub async fn close_instance(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<(), EngineError> {
    registry.fermer(&cle_de_registre(&id)).await;
    Ok(())
}

/// L'état d'une instance, tel que la ligne de la sidebar l'affiche.
///
/// **Une commande à part de `connection_states`**, bien que le registre soit le même : celle-là rend
/// des triplets `projet/base/environnement`, et une instance n'en est pas un. Les faire cohabiter
/// dans une seule liste obligerait l'écran à démêler deux sortes de clés — la convention dupliquée
/// que `connection_states` a justement écartée.
#[tauri::command]
pub async fn instance_state(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<ConnectionState, EngineError> {
    Ok(registry.etat(&cle_de_registre(&id)).await)
}

/// La vue d'ensemble : les six tuiles, l'identité de la connexion, et les gestes permis.
#[tauri::command]
pub async fn instance_overview(
    app: AppHandle,
    id: InstanceId,
    state: State<'_, ConfigState>,
    registry: State<'_, ConnectionRegistry>,
) -> Result<InstanceOverview, EngineError> {
    let instance = lire_instance(&state, &id)?;
    // **L'emplacement du secret est le mécanisme, jamais la référence.** C'est le badge d'`A2`, et
    // la question à laquelle il répond est « puis-je me fier à ce rangement ? ».
    let emplacement = instance.connection.password.as_ref().and_then(|_| {
        repertoire_de_configuration(&app)
            .ok()
            .and_then(|repertoire| crate::secrets::selectionner(&repertoire).ok())
            .map(|magasin| match magasin.mechanism {
                crate::secrets::SecretMechanism::Keychain => "Trousseau".to_owned(),
                crate::secrets::SecretMechanism::EncryptedFile => "fichier chiffré".to_owned(),
            })
    });

    // **L'hôte affiché est celui qui est joint**, `127.0.0.1` et le port local quand un proxy
    // s'interpose : c'est ce que le dump fait déjà, et mentir ici enverrait chercher une panne
    // réseau là où c'est le tunnel qui parle.
    let cle = cle_de_registre(&id);
    registry
        .avec(&cle, Reprise::Rejouable, move |adaptateur| {
            // **Cloné dans le corps, non capturé par valeur** : la fermeture est `Fn`, puisque le
            // registre peut la rejouer sur une connexion rouverte.
            let declaration = instance.connection.clone();
            let emplacement = emplacement.clone();
            Box::pin(async move {
                let (hote, port) = match adaptateur.port_local_tunnel() {
                    Some(local) => ("127.0.0.1".to_owned(), local),
                    None => (declaration.host.clone(), declaration.port),
                };
                adaptateur
                    .administration()?
                    .admin_overview(&hote, port, emplacement)
                    .await
            })
        })
        .await
}

/// Les six lectures de section. **Une commande par section, et non une qui prendrait un nom** :
/// leurs retours n'ont pas le même type, et une union sérialisée obligerait l'écran à démêler ce que
/// le typage lui donne gratuitement.
#[tauri::command]
pub async fn instance_databases(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstanceDatabase>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_databases().await })
        })
        .await
}

#[tauri::command]
pub async fn instance_roles(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstanceRole>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_roles().await })
        })
        .await
}

#[tauri::command]
pub async fn instance_privileges(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstancePrivilege>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_privileges().await })
        })
        .await
}

#[tauri::command]
pub async fn instance_sessions(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstanceSession>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_sessions().await })
        })
        .await
}

#[tauri::command]
pub async fn instance_extensions(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstanceExtension>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_extensions().await })
        })
        .await
}

#[tauri::command]
pub async fn instance_settings(
    id: InstanceId,
    registry: State<'_, ConnectionRegistry>,
) -> Result<Vec<InstanceSetting>, EngineError> {
    registry
        .avec(&cle_de_registre(&id), Reprise::Rejouable, |adaptateur| {
            Box::pin(async move { adaptateur.administration()?.admin_settings().await })
        })
        .await
}

/// Le vérificateur SCRAM d'un mot de passe, à poser par `SetRolePassword` (9 septembre 2026).
///
/// # Pourquoi une commande à part, et non un champ de l'action
///
/// Le sel est **aléatoire**. Si le vérificateur était calculé à la composition du plan *et* à
/// l'exécution, les deux tireraient deux sels : l'encart montrerait un ordre qui n'est pas celui qui
/// part — la promesse de cet écran retournée contre elle-même. L'écran demande donc le vérificateur
/// **une fois**, puis le porte dans l'action ; le plan et l'exécution partagent alors la même chaîne.
///
/// # Ce qui traverse l'IPC, et ce qui n'en sort pas
///
/// Le mot de passe en clair franchit le pont **une fois**, comme celui d'une connexion en
/// `test_connection` ou en `save_instance` — un canal local à ce processus. Ce qui en revient est le
/// vérificateur, qui n'est pas réversible, et c'est lui seul qui atteint le serveur et l'écran.
///
/// **Il n'est pas journalisé**, ni lui ni sa longueur : la règle de `run_sql`, appliquée à la seule
/// commande du produit dont l'argument est un secret.
#[tauri::command]
pub fn scram_verifier(password: String) -> Result<String, EngineError> {
    crate::engine::postgres::scram::verificateur(&password)
}

/// Le SQL d'un geste, **avant** de partir.
///
/// # Pourquoi une commande, alors que la composition est pure
///
/// Elle ne touche à rien, et pourrait donc vivre à l'écran — c'est exactement ce qu'il ne faut pas.
/// La confirmation promet de montrer **ce qui part** ; si l'écran composait sa propre version, la
/// promesse tiendrait tant que les deux compositions s'accordent, et cesserait le jour où l'une
/// change. C'est la leçon de `preview_updates`, et de la règle n° 17 : deux voies pour un même acte
/// en laissent une en arrière.
///
/// Elle **n'a pas besoin de la connexion**, délibérément : montrer le SQL d'un geste sur une instance
/// dont la connexion vient de tomber est utile, et échouer là-dessus donnerait une confirmation vide
/// devant un bouton actif.
#[tauri::command]
pub fn plan_instance_action(action: InstanceAction) -> Result<InstancePlan, EngineError> {
    Ok(crate::engine::postgres::planifier_administration(&action))
}

/// Exécute un geste.
///
/// **Le SQL est recomposé ici, à partir de la même fonction que le plan.** L'écran ne renvoie pas
/// les ordres qu'on vient de lui montrer : il renvoie le *geste*. Lui faire renvoyer le SQL ferait
/// exécuter une chaîne venue de la webview, et la promesse « ce que vous voyez est ce qui part »
/// deviendrait « ce que vous nous renvoyez est ce qui part » — deux choses très différentes le jour
/// où quelque chose s'interpose.
#[tauri::command]
pub async fn run_instance_action(
    id: InstanceId,
    action: InstanceAction,
    registry: State<'_, ConnectionRegistry>,
) -> Result<InstanceOutcome, EngineError> {
    // Le geste est journalisé, **ses valeurs non** : un nom de base ou de rôle n'est pas une donnée
    // de l'utilisateur, mais une valeur de paramètre peut l'être. Même règle que `run_sql`.
    log::info!("run_instance_action ← {}", id);
    // **`Unique`, et c'est le geste du produit où le rejeu coûterait le plus cher.** Un
    // `CREATE DATABASE` peut avoir été validé par le serveur *avant* que la coupure n'empêche
    // l'accusé d'arriver ; le rejouer rendrait « la base existe déjà » sur une base que nous
    // venons de créer. Et ce lot n'a aucune transaction pour l'en empêcher — trois de ses ordres
    // sont refusés dans un bloc transactionnel par le serveur lui-même.
    let resultat = registry
        .avec(&cle_de_registre(&id), Reprise::Unique, move |adaptateur| {
            let action = action.clone();
            Box::pin(async move { adaptateur.administration()?.admin_executer(&action).await })
        })
        .await;
    match &resultat {
        Ok(issue) => log::info!("run_instance_action → {} ordre(s)", issue.statements.len()),
        Err(erreur) => log::warn!("run_instance_action → refusé : {erreur}"),
    }
    resultat
}

/// Relit une instance **du disque**, jamais de l'écran.
fn lire_instance(
    state: &State<'_, ConfigState>,
    id: &InstanceId,
) -> Result<ManagedInstance, EngineError> {
    let instances =
        crate::config::commands::instances_declarees(state).map_err(EngineError::local)?;
    instances
        .into_iter()
        .find(|instance| &instance.id == id)
        .ok_or_else(|| EngineError::local(format!("l'instance « {id} » n'est pas déclarée")))
}

/// Le patron d'écriture des instances : relire le disque, appliquer, écrire.
///
/// Le pendant d'`ecrire_les_projets`, et pour les trois mêmes raisons : la liste vient du disque, le
/// magasin se souvient d'un refus de lecture, et **ce qu'on n'écrit pas est préservé**.
fn ecrire_les_instances(
    state: &State<'_, ConfigState>,
    geste: impl FnOnce(
        &[ManagedInstance],
        &mut dyn FnMut(&[ManagedInstance]) -> Result<(), String>,
    ) -> Result<Vec<ManagedInstance>, String>,
) -> Result<Vec<ManagedInstance>, String> {
    crate::config::commands::avec_le_magasin(state, |store| {
        let instances = store.load_instances()?;
        geste(&instances, &mut |suivantes| {
            let projects = store.load_projects()?;
            let preferences = store.load_preferences().unwrap_or_default();
            store
                .save(&projects, &preferences, suivantes)
                .map_err(|erreur| erreur.to_string())
        })
    })
}

fn repertoire_de_configuration(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|erreur| format!("répertoire de configuration introuvable : {erreur}"))
}
