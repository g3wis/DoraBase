//! Le registre des connexions ouvertes.
//!
//! **Pourquoi un registre.** `PostgresAdapter` détient un client et, éventuellement, un tunnel
//! SSH : il ne peut pas traverser l'IPC, et le recréer à chaque commande rouvrirait un tunnel
//! par requête — donc une session SSH et un port lié pour lire une liste de tables.

use std::collections::HashMap;

use tokio::sync::Mutex;

use crate::config::ConnectionSettings;
use crate::engine::AnyEngine;
use crate::engine::EngineError;
use crate::engine::{
    OrdreDeTransaction, QueryResult, RowLimit, TransactionMode, TransactionState,
    TransactionStatement,
};
use crate::secrets::Secret;

/// L'identité d'une connexion : projet / base / environnement.
///
/// **La même clé que la référence de secret de `08e`**, et ce n'est pas un hasard : c'est
/// l'identité d'une connexion. La réemployer évite deux conventions à garder cohérentes, et
/// permet de retrouver le mot de passe d'une connexion depuis sa seule clé.
pub fn cle(project: &str, database: &str, environment: &str) -> String {
    format!("{project}/{database}/{environment}")
}

/// L'état d'une base, tel que l'arbre de `09d` l'affiche.
///
/// **Quatre états, pas deux.** « Jamais tentée » n'est pas « hors ligne » : les confondre
/// afficherait en rouge une base qu'on n'a simplement pas ouverte. Et l'arbre se lit sans
/// réseau — décision du 7 août 2026 — donc l'état par défaut d'une base est `Jamais`, pas un
/// échec.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "engine.ts")]
pub enum ConnectionState {
    /// Aucune tentative. L'état de départ de toute base au lancement.
    Never,
    Connecting,
    Connected {
        server_version: String,
        /// Le port local du tunnel, quand la variante en déclare un.
        tunnel_local_port: Option<u16>,
    },
    /// La dernière tentative a échoué. Le message vient du moteur (`06b`–`06e`), qui dit déjà
    /// la manœuvre — le réécrire créerait deux vérités.
    Offline {
        reason: String,
    },
}

/// Une opération peut-elle être **rejouée telle quelle** sur une connexion rouverte ?
///
/// **Chaque appelant d'`avec` doit répondre**, et c'est délibérément un paramètre plutôt qu'une
/// seconde méthode : une méthode « avec reprise » s'oublie, et le silence prendrait alors la
/// réponse la moins vraie sans que personne l'ait choisie. C'est la leçon du bras attrape-tout de
/// `connect_via` (règle n° 16), appliquée à une décision qui peut, elle, écrire deux fois.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reprise {
    /// **L'opération ne fait que lire**, ou ne compose que du texte : la rejouer sur une connexion
    /// neuve rend la même chose, ou la rend enfin.
    Rejouable,
    /// **Non.** Une écriture peut avoir été validée par le serveur *avant* que la coupure
    /// n'empêche l'accusé de réception d'arriver : la rejouer insérerait deux fois les lignes
    /// ajoutées. Vaut aussi pour le SQL **écrit par l'utilisateur** (`run_sql`), dont rien ici ne
    /// sait s'il lit ou s'il écrit — la console accepte les DML.
    ///
    /// La connexion est tout de même rouverte pour la **prochaine** opération ; c'est le rejeu de
    /// celle-ci qui est refusé, pas la reconnexion.
    Unique,
}

/// De quoi rouvrir une connexion que le registre a déjà ouverte une fois.
///
/// **Le secret est gardé en mémoire**, et cela mérite d'être dit plutôt que découvert. Ce n'est pas
/// une exposition d'une nature nouvelle — le client du pilote détient déjà la configuration qui le
/// porte, et c'est la raison pour laquelle un adaptateur a un `Debug` écrit à la main —, mais c'est
/// un exemplaire de plus. `Secret` masque sa valeur au `Debug`, n'a ni `Display` ni `Serialize` :
/// une recette ne peut donc pas se glisser dans un journal ni traverser l'IPC.
///
/// **Elle n'est posée qu'après une ouverture réussie**, et la règle qui en découle est celle qui
/// gouverne toute la reconnexion : *le registre sait rouvrir ce qu'il a déjà ouvert*. Une base
/// jamais jointe n'a pas de recette, donc `avec` lui répond toujours qu'elle doit être ouverte
/// d'abord.
#[derive(Clone)]
struct Recette {
    moteur: crate::config::Engine,
    variante: ConnectionSettings,
    mot_de_passe: Option<Secret>,
    known_hosts: std::path::PathBuf,
}

/// L'issue d'un essai, du point de vue de `avec`.
///
/// **Deux issues et non un `Result` de plus** : « l'opération a échoué » et « la connexion n'existe
/// plus » sont deux faits différents, et les confondre était exactement le défaut du 8 septembre.
enum Issue<T> {
    /// L'opération a répondu — bien ou mal, mais la connexion tient toujours.
    Rendue(Result<T, EngineError>),
    /// L'opération a échoué **et** la connexion s'est révélée perdue. L'adaptateur est déjà fermé
    /// et retiré ; l'état, lui, n'a pas été touché.
    ConnexionPerdue(EngineError),
}

/// Le registre, rangé dans l'état Tauri.
///
/// `tokio::sync::Mutex` et non `std::sync::Mutex` : les commandes sont `async` et gardent le
/// verrou à travers un `await` — ouvrir une connexion prend du temps. Un verrou de la
/// bibliothèque standard tenu à travers un point d'attente bloque le fil de l'exécuteur.
#[derive(Default)]
pub struct ConnectionRegistry {
    ouvertes: Mutex<HashMap<String, AnyEngine>>,
    etats: Mutex<HashMap<String, ConnectionState>>,
    /// **Survit à la connexion**, contrairement aux deux autres tables : c'est tout son intérêt.
    /// Seul `fermer` la vide — un changement de configuration périme la recette par construction,
    /// et rouvrir sur l'ancien hôte serait pire que ne rien rouvrir.
    recettes: Mutex<HashMap<String, Recette>>,
    /// Les sessions des consoles qui tiennent une transaction manuelle (`API-38`).
    ///
    /// **Une session par console, et c'est ce qui fait qu'une transaction n'est pas partagée.** Une
    /// transaction est un état de session : tant que deux consoles se partageaient celle de la
    /// connexion, un `BEGIN` posé par l'une englobait ce que l'autre exécutait, et aucun choix
    /// d'écran ne pouvait le défaire. Chacune a donc la sienne, ouverte à la première exécution en
    /// mode manuel et refermée par sa validation ou son annulation.
    ///
    /// **L'absence d'entrée est l'absence de transaction**, et une entrée au journal vide est une
    /// transaction ouverte qui n'a encore rien joué — les deux existent, puisque le journal s'écrit
    /// après l'ouverture. C'est « jamais tentée n'est pas hors ligne » (`09d`) sur une autre
    /// question.
    ///
    /// **Le journal est ici et non dans l'adaptateur** : il survit à chaque appel et doit pouvoir
    /// être lu alors que rien n'est en cours. L'adaptateur, lui, ne sait que poser les trois ordres.
    ///
    /// **Elles vivent et meurent avec la connexion** (`API-37`) : leur session passe par le proxy de
    /// la connexion partagée, et une transaction ne survit pas à sa session — donc les trois
    /// endroits qui retirent l'entrée d'une connexion les ferment. `fermer`, `tenter` quand la
    /// connexion s'est révélée perdue, et `achever` pour la sienne. C'est la règle de l'arbre
    /// appliquée ici : ce que le registre ne tient plus ne doit plus être affiché, et un « Valider »
    /// sur une transaction dont la session est partie serait le pire des boutons.
    transactions: Mutex<HashMap<CleDeConsole, SessionDeConsole>>,
}

/// L'adresse d'une session de console : sa connexion, et le jeton de l'onglet.
///
/// **Le jeton est opaque pour le cœur** : il ne le compare qu'à lui-même. Il vient de l'écran et
/// survit à un renommage d'onglet, dont l'identité, elle, change — voir `useTransaction`, qui le
/// mint. C'est ce qui permet à une console de retrouver **sa** session après avoir été renommée.
type CleDeConsole = (String, String);

/// La session d'une console, et la transaction qu'elle tient.
///
/// **Son propre adaptateur**, ouvert depuis la recette de la connexion et redirigé vers le port
/// local de son proxy : ce n'est pas une copie de la connexion, c'est une seconde session sur le
/// même serveur, par le même tunnel.
struct SessionDeConsole {
    adaptateur: AnyEngine,
    journal: Journal,
}

/// Une instruction du journal : ce que l'écran en lit, et la réponse que le cœur en garde.
///
/// # Pourquoi les deux sont séparés
///
/// Le journal est **relu à chaque exécution**, pour que le panneau suive. Si les lignes y étaient,
/// chaque exécution ferait traverser l'IPC à toutes les réponses de la transaction — la contrainte
/// transverse du projet interdit exactement cela. `TransactionStatement` est donc ce qui voyage
/// (des comptes, un SQL, un drapeau), et `reponse` reste ici jusqu'à ce que l'écran en désigne
/// une : c'est la règle générale du projet, « le cœur détient les résultats ; la webview ne reçoit
/// que ce qu'elle montre ».
///
/// # Ce que garder coûte, et pourquoi c'est borné
///
/// Une réponse de console est déjà bornée par `RowLimit` — mille lignes pour la console (`12c`) —
/// donc le journal pèse au plus ce plafond par instruction qui rend des lignes. Une écriture n'en
/// garde aucune. La transaction, elle, vit le temps qu'on met à la relire : ce n'est pas un cache
/// qui grandit, c'est un état qu'un `commit` ou un `rollback` efface.
///
/// **Ce qui n'a pas été retenu** : jeter les réponses les plus anciennes au-delà d'un plafond
/// global. Cela rendrait une instruction non consultable pour une raison que l'utilisateur n'a pas
/// provoquée, et qu'il faudrait alors lui dire — beaucoup de mécanique pour un cas que le plafond
/// de lignes rend déjà improbable.
struct Instruction {
    rendue: TransactionStatement,
    /// La réponse, quand elle porte des lignes. `None` pour une écriture ou un refus.
    reponse: Option<QueryResult>,
}

/// La transaction d'une console : ce qu'elle a joué, et si le moteur l'a abandonnée.
///
/// **`abandonnee` est figée au moment de l'échec**, non recalculée à la lecture : c'est cette
/// instruction-là qui a abandonné la transaction, et le moteur est le seul à savoir si un refus le
/// fait — PostgreSQL oui, SQLite et MySQL non. Une reconnexion survenue depuis ne doit pas changer
/// la réponse, et `etat_de_transaction` n'a ainsi pas à consulter l'adaptateur pour la rendre.
#[derive(Default)]
struct Journal {
    instructions: Vec<Instruction>,
    abandonnee: bool,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// L'état d'une base. `Never` quand elle n'est pas au registre — l'état de départ, pas une
    /// absence d'information.
    pub async fn etat(&self, cle: &str) -> ConnectionState {
        self.etats
            .lock()
            .await
            .get(cle)
            .cloned()
            .unwrap_or(ConnectionState::Never)
    }

    /// Tous les états connus, pour peupler l'arbre en une fois.
    pub async fn etats(&self) -> HashMap<String, ConnectionState> {
        self.etats.lock().await.clone()
    }

    /// Ouvre une connexion, ou rend celle qui existe déjà.
    ///
    /// **Réemployer plutôt que rouvrir** est le point du registre : `09d` déplie un schéma puis
    /// une table, ce qui fait plusieurs commandes sur la même base. Chacune rouvrant un tunnel
    /// épuiserait les ports et ajouterait une poignée de main SSH par clic.
    pub async fn ouvrir(
        &self,
        cle: &str,
        moteur: crate::config::Engine,
        variante: &ConnectionSettings,
        mot_de_passe: Option<&Secret>,
        known_hosts: &std::path::Path,
    ) -> Result<(), EngineError> {
        if self.ouvertes.lock().await.contains_key(cle) {
            return Ok(());
        }

        self.etats
            .lock()
            .await
            .insert(cle.to_owned(), ConnectionState::Connecting);

        match AnyEngine::connect_via(moteur, variante, mot_de_passe, known_hosts).await {
            Ok(adaptateur) => {
                let sonde = adaptateur.probe().await;
                let (version, port) = match sonde {
                    Ok(sonde) => (sonde.server_version, adaptateur.port_local_tunnel()),
                    Err(erreur) => {
                        // Connectée mais muette : c'est un échec, et le garder ouvert
                        // laisserait un tunnel vivant pour rien.
                        adaptateur.close().await;
                        self.marquer_hors_ligne(cle, erreur.message.clone()).await;
                        return Err(erreur);
                    }
                };

                // **La garde d'entrée ne suffit pas : elle est relâchée pendant la connexion.**
                // Deux ouvertures concurrentes de la même base la franchissaient donc toutes les
                // deux, et la seconde `insert` **remplaçait** la première sans la fermer — un
                // tunnel SSH et son port perdus, sans la moindre erreur. Le défaut est antérieur ;
                // la reconnexion en crée simplement une nouvelle occasion, deux lectures d'écran
                // pouvant retomber ensemble sur une connexion morte. Sous le verrou, c'est donc
                // **la nôtre** qu'on referme quand l'autre a gagné.
                let mut ouvertes = self.ouvertes.lock().await;
                if ouvertes.contains_key(cle) {
                    drop(ouvertes);
                    adaptateur.close().await;
                    return Ok(());
                }
                ouvertes.insert(cle.to_owned(), adaptateur);
                drop(ouvertes);

                self.etats.lock().await.insert(
                    cle.to_owned(),
                    ConnectionState::Connected {
                        server_version: version,
                        tunnel_local_port: port,
                    },
                );
                // **Après le succès seulement** : voir `Recette`. Le registre sait rouvrir ce
                // qu'il a déjà ouvert, et rien d'autre.
                self.recettes.lock().await.insert(
                    cle.to_owned(),
                    Recette {
                        moteur,
                        variante: variante.clone(),
                        mot_de_passe: mot_de_passe.cloned(),
                        known_hosts: known_hosts.to_path_buf(),
                    },
                );
                Ok(())
            }
            Err(erreur) => {
                self.marquer_hors_ligne(cle, erreur.message.clone()).await;
                Err(erreur)
            }
        }
    }

    async fn marquer_hors_ligne(&self, cle: &str, raison: String) {
        self.etats
            .lock()
            .await
            .insert(cle.to_owned(), ConnectionState::Offline { reason: raison });
    }

    /// Exécute une opération sur une connexion ouverte, **en la rouvrant si besoin**.
    ///
    /// Le verrou est tenu pendant l'opération : deux requêtes concurrentes sur la même base se
    /// sérialisent. C'est voulu — `tokio_postgres::Client` ne pipeline pas les requêtes d'une
    /// même connexion, et laisser croire le contraire produirait des résultats entrelacés.
    ///
    /// **Le `Future` boxé doit être `Send`**, sans quoi les commandes Tauri le refusent : elles
    /// s'exécutent sur un exécuteur multi-fils. C'est la même contrainte que `06a` a rencontrée
    /// sur `EngineAdapter`, et pour la même raison.
    ///
    /// # Une connexion morte est retirée, et l'état le dit (8 septembre 2026)
    ///
    /// **Une entrée du registre pouvait survivre à son socket.** `tokio-postgres` laisse le
    /// `Client` debout quand sa boucle d'entrées-sorties s'arrête — session inactive coupée par le
    /// serveur, veille, changement de réseau, tunnel tombé —, et la seule trace était un
    /// `log::debug!` dans `postgres/connect.rs`. L'entrée restait donc là, l'état restait
    /// `Connected`, et **toute** lecture suivante échouait en « connection closed » : la grille
    /// affichait « lecture impossible » pendant que l'arbre affichait « OK » sur la même base.
    ///
    /// **La question n'est posée qu'après un échec**, et c'est ce qui la rend sûre : une requête
    /// qui a rendu ses lignes a prouvé sa connexion, et interroger le pilote à chaque succès
    /// ferait payer un verdict à tout le chemin heureux. Un échec ordinaire — SQL fautif, droits
    /// refusés — laisse la connexion en place : chaque moteur répond pour lui-même, et aucun ne
    /// conclut d'une erreur de requête que son transport est mort.
    ///
    /// # La reconnexion, et ses deux étages
    ///
    /// **Rouvrir avant d'exécuter est sûr pour tout le monde** : l'opération n'a pas encore
    /// tourné. C'est l'étage du bas, celui qu'aucun appelant n'a à demander — une entrée absente
    /// mais dont la recette est là se rouvre, et le geste suivant marche sans que personne ait
    /// rien cliqué.
    ///
    /// **Rejouer après un échec ne l'est pas**, et c'est l'étage du haut, celui que `Reprise`
    /// gouverne. Une écriture peut avoir été **validée par le serveur avant** que la coupure
    /// n'empêche l'accusé de réception d'arriver : la rejouer insérerait deux fois les lignes
    /// ajoutées. Seules les opérations qui lisent, ou qui ne composent que du texte, portent
    /// `Rejouable` — pas `apply_changes`, et pas `run_sql`, dont rien ici ne sait s'il lit ou s'il
    /// écrit.
    ///
    /// **Une seule reprise, jamais une boucle.** Un serveur qui coupe chaque session — un
    /// répartiteur mal réglé, un `idle_session_timeout` à zéro — ferait sinon tourner le registre
    /// indéfiniment sur une base qui ne répondra jamais.
    ///
    /// **Et quand la réouverture échoue, c'est *son* message qui est rendu**, pas celui de la
    /// perte. C'est la vérité actuelle et la seule qui porte une manœuvre — « hôte injoignable »
    /// dit quoi faire, « connection closed » ne dit plus rien une fois la connexion retirée. Les
    /// deux vérités s'accordent alors : `ouvrir` a posé le même message en `Offline`.
    pub async fn avec<T, F>(
        &self,
        cle: &str,
        reprise: Reprise,
        operation: F,
    ) -> Result<T, EngineError>
    where
        F: for<'a> Fn(
            &'a AnyEngine,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, EngineError>> + Send + 'a>,
        >,
    {
        self.assurer_l_ouverture(cle).await?;

        let perte = match self.tenter(cle, &operation).await {
            Issue::Rendue(resultat) => return resultat,
            Issue::ConnexionPerdue(perte) => perte,
        };

        if reprise == Reprise::Unique {
            // **La connexion est rendue à l'état hors ligne, et l'opération n'est pas rejouée.**
            // La prochaine, elle, rouvrira : c'est l'étage du bas, qui n'est refusé à personne.
            log::info!("connexion perdue ← {cle} (sans rejeu) : {}", perte.message);
            self.marquer_hors_ligne(cle, perte.message.clone()).await;
            return Err(perte);
        }

        log::info!("connexion perdue ← {cle}, reconnexion : {}", perte.message);
        self.assurer_l_ouverture(cle).await?;
        match self.tenter(cle, &operation).await {
            Issue::Rendue(resultat) => resultat,
            // Perdue **deux fois de suite**, sur une connexion qui venait de s'ouvrir : ce n'est
            // plus une coupure, c'est un serveur qui refuse de tenir. Une seconde reprise ne
            // ferait que retarder le même message.
            Issue::ConnexionPerdue(perte) => {
                self.marquer_hors_ligne(cle, perte.message.clone()).await;
                Err(perte)
            }
        }
    }

    /// Ouvre la connexion si le registre ne la tient plus mais sait la rouvrir.
    ///
    /// **Sans recette, le message d'avant est rendu tel quel** : une base jamais ouverte doit
    /// s'entendre dire de l'être, et non voir le registre deviner des coordonnées qu'il n'a pas.
    async fn assurer_l_ouverture(&self, cle: &str) -> Result<(), EngineError> {
        if self.ouvertes.lock().await.contains_key(cle) {
            return Ok(());
        }
        let recette = self.recettes.lock().await.get(cle).cloned();
        match recette {
            Some(recette) => {
                self.ouvrir(
                    cle,
                    recette.moteur,
                    &recette.variante,
                    recette.mot_de_passe.as_ref(),
                    &recette.known_hosts,
                )
                .await
            }
            None => Err(aucune_connexion(cle)),
        }
    }

    /// Un essai, et rien de plus : ni état posé, ni recette touchée.
    ///
    /// **L'adaptateur mort est fermé et retiré ici**, parce que c'est le seul endroit qui le tient
    /// — fermer et pas seulement retirer, l'adaptateur détenant le proxy dont le port local ne
    /// serait rendu par personne. Mais **l'état ne bouge pas** : c'est `avec` qui décide s'il
    /// annonce une panne ou s'il rouvre, et marquer « hors ligne » avant une reconnexion réussie
    /// ouvrirait une fenêtre où l'arbre lirait le rouge d'une base redevenue vivante.
    async fn tenter<T, F>(&self, cle: &str, operation: F) -> Issue<T>
    where
        F: for<'a> FnOnce(
            &'a AnyEngine,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, EngineError>> + Send + 'a>,
        >,
    {
        let (resultat, morte) = {
            let mut garde = self.ouvertes.lock().await;
            let Some(adaptateur) = garde.get(cle) else {
                // La connexion vient d'être fermée par ailleurs — une commande de configuration,
                // par exemple. Rien à retirer, rien à rouvrir de notre fait.
                return Issue::Rendue(Err(aucune_connexion(cle)));
            };
            let resultat = operation(adaptateur).await;
            let perdue = resultat.is_err() && adaptateur.connexion_perdue();

            // **Retirée sous le verrou qui a porté l'opération, et pas un instant plus tard.**
            // Le relâcher d'abord ouvrait une fenêtre où une seconde lecture, tombée sur la même
            // connexion morte, la retire, la ferme et en **rouvre une neuve** — que nous
            // fermerions ensuite en croyant fermer la nôtre. La reconnexion crée cette fenêtre :
            // avant elle, deux lectures concurrentes ne pouvaient que retirer deux fois la même
            // entrée, ce qui est sans effet.
            let morte = if perdue { garde.remove(cle) } else { None };
            (resultat, morte)
        };

        match morte {
            // La fermeture, elle, se fait verrou rendu : elle attend que le port du proxy soit
            // rendu, et le tenir pendant ce temps bloquerait toute autre base.
            Some(adaptateur) => {
                // **Les sessions de console partent avec l'entrée** (`API-38`) : la leur passe
                // par le proxy de celle-ci, donc elle ne lui survit pas — et laisser leurs
                // instructions au panneau offrirait un « Valider » qui n'a plus rien à valider,
                // sur une session qui n'existe plus. C'est ce que `fermer` fait déjà pour une
                // fermeture demandée.
                self.fermer_les_sessions_de_console(cle).await;
                adaptateur.close().await;
                match resultat {
                    Err(perte) => Issue::ConnexionPerdue(perte),
                    // Inatteignable : `perdue` exige un échec. Rendu plutôt que paniqué — un
                    // registre n'a pas à faire tomber l'application pour une branche morte.
                    Ok(valeur) => Issue::Rendue(Ok(valeur)),
                }
            }
            None => Issue::Rendue(resultat),
        }
    }

    /// Ferme une connexion et **attend** que le port de son tunnel soit rendu.
    ///
    /// Sans l'attente, `JoinHandle::abort` n'étant pas synchrone (`06e`), le port resterait pris
    /// quelques instants — invisible une fois, épuisant après cinquante ouvertures.
    pub async fn fermer(&self, cle: &str) {
        // **La recette part avec.** C'est ce qui distingue une fermeture *demandée* de la perte
        // d'une connexion : les six commandes de configuration qui appellent `fermer` ont
        // justement changé ce que la recette décrit, et rouvrir sur l'ancien hôte — ou avec
        // l'ancien secret — serait pire que ne rien rouvrir.
        self.recettes.lock().await.remove(cle);
        let adaptateur = self.ouvertes.lock().await.remove(cle);
        if let Some(adaptateur) = adaptateur {
            adaptateur.close().await;
        }
        self.etats.lock().await.remove(cle);
        // **Les transactions des consoles partent avec la connexion** (`API-38`). Leur session
        // emprunte son proxy, et fermer annule ce qu'elles retenaient — c'est le serveur qui le
        // fait, aucune des trois sortes de moteur ne validant une transaction inachevée — donc
        // garder leurs instructions afficherait un `commit` qui n'a plus rien à valider. C'est la
        // règle de l'arbre : ce que le registre ne tient plus ne doit plus être caché.
        self.fermer_les_sessions_de_console(cle).await;
    }

    /// Exécute le SQL d'une console — dans **sa** transaction quand elle en tient une (`API-38`).
    ///
    /// # Deux chemins, et c'est le mode qui choisit
    ///
    /// - **manuel** : la session de cette console, ouverte à la première exécution. Tout y passe
    ///   ensuite : le `begin`, les requêtes, et le `commit` de `achever` ;
    /// - **auto** : la session de la connexion, par `avec`, comme n'importe quelle lecture du
    ///   produit. Elle n'a pas de transaction, et **la transaction d'une voisine ne l'atteint
    ///   pas** — c'est tout l'objet d'une session par console.
    ///
    /// Une console qui tient une transaction et qu'on repasserait en `auto` continue d'exécuter
    /// dans la sienne : la session existe, et son journal attend une issue. C'est l'écran qui
    /// interdit de sortir du mode avec des instructions en attente, et qui annule la transaction
    /// quand il n'y en a aucune.
    ///
    /// # Ce que cette méthode fait que `avec` ne peut pas faire
    ///
    /// **Elle n'a pas de reprise à offrir.** `avec` rouvre une connexion perdue parce que la
    /// suivante repartira du même endroit ; ici, la session *est* la transaction — la rouvrir
    /// donnerait une session neuve où le `commit` ne validerait rien, et le journal annoncerait des
    /// instructions que le serveur a annulées. Une session perdue est donc **retirée**, avec sa
    /// transaction, et le refus le dit.
    pub async fn executer_une_requete(
        &self,
        cle: &str,
        sql: &str,
        limite: RowLimit,
        mode: TransactionMode,
        console: &str,
    ) -> Result<QueryResult, EngineError> {
        let adresse = (cle.to_owned(), console.to_owned());
        if mode == TransactionMode::Manual {
            // **L'ouverture avant la requête, et son échec avant elle aussi** : un moteur qui
            // refuse la transaction manuelle — MongoDB, BigQuery — doit le dire au lieu d'exécuter
            // hors transaction ce que l'écran annonce comme retenu.
            self.assurer_la_session(cle, console).await?;
        } else if !self.transactions.lock().await.contains_key(&adresse) {
            let a_executer = sql.to_owned();
            return self
                .avec(cle, Reprise::Unique, move |adaptateur| {
                    // Le clone par essai, comme les six autres appelants d'`avec` : c'est le prix
                    // de `Fn`, et il ne pèse rien contre un aller-retour réseau.
                    let sql = a_executer.clone();
                    Box::pin(async move { adaptateur.run_sql(&sql, limite).await })
                })
                .await;
        }

        let depart = std::time::Instant::now();
        let (issue, perdue) = {
            let mut sessions = self.transactions.lock().await;
            // Fermée entre-temps — une commande de configuration, une connexion perdue. Le refus
            // d'`achever` dit la même chose, et pour la même raison.
            let Some(session) = sessions.get_mut(&adresse) else {
                return Err(transaction_absente());
            };
            let issue = session.adaptateur.run_sql(sql, limite).await;
            let perdue = issue.is_err() && session.adaptateur.connexion_perdue();
            if !perdue {
                session.journal.abandonnee = session.journal.abandonnee
                    || (issue.is_err()
                        && session.adaptateur.transaction_abandonnee_par_une_erreur());
                session.journal.instructions.push(match &issue {
                    Ok(resultat) => Instruction {
                        rendue: TransactionStatement {
                            sql: resultat.sql.clone(),
                            duration_ms: resultat.duration_ms,
                            returned: resultat.rows.len() as u64,
                            affected: resultat.affected,
                            // **Consultable seulement s'il y a des lignes.** Une écriture n'a rien
                            // à remettre dans une grille, et son compte de lignes touchées est déjà
                            // sa réponse : son entrée ne se clique pas, plutôt qu'un clic qui
                            // viderait la grille.
                            displayable: !resultat.rows.is_empty(),
                            error: None,
                        },
                        // Gardée pour que l'écran puisse la redemander : la grille du centre n'en
                        // tient qu'une, celle de la dernière exécution, et c'est le seul endroit où
                        // les autres existent encore.
                        reponse: (!resultat.rows.is_empty()).then(|| resultat.clone()),
                    },
                    // **L'échec est inscrit, et la transaction reste ouverte.** C'est l'état réel :
                    // `begin` a réussi, donc il y a quelque chose à annuler — et sur PostgreSQL la
                    // transaction est désormais abandonnée, donc la suite sera refusée jusque-là.
                    // Un journal qui n'aurait que les succès laisserait chercher pourquoi plus rien
                    // ne répond.
                    Err(erreur) => Instruction {
                        rendue: TransactionStatement {
                            sql: sql.to_owned(),
                            duration_ms: u64::try_from(depart.elapsed().as_millis())
                                .unwrap_or(u64::MAX),
                            returned: 0,
                            affected: None,
                            displayable: false,
                            error: Some(erreur.message.clone()),
                        },
                        // Un refus n'a **rien** rendu. Le message du serveur est sa réponse, et il
                        // est dans l'entrée juste au-dessus.
                        reponse: None,
                    },
                });
            }
            (issue, perdue.then(|| sessions.remove(&adresse)).flatten())
        };

        match perdue {
            // **La session perdue est fermée verrou rendu**, comme dans `tenter` : elle n'a pas de
            // proxy à elle — c'est celui de la connexion qu'elle emprunte —, mais tenir le journal
            // pendant une fermeture bloquerait la lecture du panneau des autres consoles.
            Some(session) => {
                session.adaptateur.close().await;
                Err(EngineError::local(format!(
                    "{} La session de cette transaction est perdue : ce qu'elle retenait a été \
                     annulé par le serveur, et il faut la rejouer.",
                    issue.err().map(|e| e.message).unwrap_or_default()
                )))
            }
            None => issue,
        }
    }

    /// Ouvre la session de cette console, si elle n'en a pas déjà une (`API-38`).
    ///
    /// # Une seconde session, par le même tunnel
    ///
    /// Elle est ouverte depuis la **recette** de la connexion — celle qui sait déjà la rouvrir —, à
    /// ceci près que l'hôte et le port sont ceux du proxy **déjà monté** par la connexion partagée.
    /// Sans cette redirection, `connect_via` monterait un second tunnel SSH par console : une
    /// session SSH et un port de plus pour chaque transaction.
    ///
    /// **Et sans le proxy vivant, elle refuse plutôt que de joindre le serveur en direct.** C'est
    /// `postgres::connect::preparer` qui le garantit : une variante qui déclare un tunnel sans
    /// redirection est un refus, jamais une connexion claire. Contourner le tunnel serait
    /// contourner la consigne de sécurité de la connexion.
    ///
    /// # La course, traitée comme celle d'`ouvrir`
    ///
    /// La connexion prend du temps, et le verrou du journal n'est pas tenu pendant : deux
    /// exécutions concurrentes de la même console franchiraient donc toutes les deux la garde
    /// d'entrée. Sous le verrou, c'est **la nôtre** qu'on referme quand l'autre a gagné — son
    /// `begin` étant annulé par le serveur à la fermeture.
    async fn assurer_la_session(&self, cle: &str, console: &str) -> Result<(), EngineError> {
        let adresse = (cle.to_owned(), console.to_owned());
        if self.transactions.lock().await.contains_key(&adresse) {
            return Ok(());
        }

        // La connexion partagée d'abord : c'est elle qui porte le proxy, et sa recette qui dit
        // comment joindre le serveur.
        self.assurer_l_ouverture(cle).await?;
        let recette = self
            .recettes
            .lock()
            .await
            .get(cle)
            .cloned()
            .ok_or_else(|| aucune_connexion(cle))?;
        // **Deux verrous pris l'un après l'autre, jamais imbriqués** : c'est la seule paire que ce
        // fichier n'ordonne pas, et l'imbriquer créerait un ordre de plus à tenir.
        let port_du_proxy = self
            .ouvertes
            .lock()
            .await
            .get(cle)
            .and_then(AnyEngine::port_local_tunnel);

        let variante = variante_de_session(&recette.variante, port_du_proxy);
        let adaptateur = AnyEngine::connect_via(
            recette.moteur,
            &variante,
            recette.mot_de_passe.as_ref(),
            &recette.known_hosts,
        )
        .await?;

        // Le `begin` avant l'inscription : une session sans transaction n'est pas une transaction
        // ouverte, et l'inscrire d'abord ferait paraître un panneau que le moteur vient de refuser.
        if let Err(erreur) = adaptateur.transaction(OrdreDeTransaction::Ouvrir).await {
            adaptateur.close().await;
            return Err(self.qualifier_le_refus_d_ouvrir(cle, erreur).await);
        }

        let mut sessions = self.transactions.lock().await;
        if sessions.contains_key(&adresse) {
            drop(sessions);
            adaptateur.close().await;
            return Ok(());
        }
        sessions.insert(
            adresse,
            SessionDeConsole {
                adaptateur,
                journal: Journal::default(),
            },
        );
        Ok(())
    }

    /// Dit ce qu'une voisine y est pour quelque chose, quand une ouverture échoue (`API-38`).
    ///
    /// **Le cas est celui de SQLite, et il n'a rien d'exotique** : un fichier n'a qu'un verrou
    /// d'écriture, donc la seconde console qui ouvre une transaction reçoit « database is locked »
    /// — un message vrai, et qui laisse chercher un autre programme alors que c'est l'onglet d'à
    /// côté. PostgreSQL et MySQL, eux, tiennent autant de transactions que de sessions : la
    /// qualification ne les atteint jamais.
    ///
    /// Le message du moteur est **gardé** et complété, jamais remplacé : c'est la règle des états
    /// hors ligne, et lui seul dit ce que le serveur a refusé.
    async fn qualifier_le_refus_d_ouvrir(&self, cle: &str, erreur: EngineError) -> EngineError {
        let voisines = self
            .transactions
            .lock()
            .await
            .keys()
            .filter(|(connexion, _)| connexion == cle)
            .count();
        if voisines == 0 {
            return erreur;
        }
        // **La cause d'abord, le mot du moteur ensuite**, et non l'inverse : sur un fichier
        // verrouillé, la phrase de `sqlite` parle d'« un autre programme » — vrai au sens du
        // moteur, et trompeur ici, puisque ce programme est nous. Ce qu'on sait passe donc devant ;
        // ce que le serveur a dit reste, parce qu'un refus peut toujours avoir une autre cause.
        EngineError::local(format!(
            "Une autre console de cette base tient déjà une transaction, et ce moteur n'en accepte \
             qu'une à la fois : validez-la ou annulez-la d'abord. Le moteur a répondu : {}",
            erreur.message
        ))
    }

    /// L'état de la transaction d'une console — ce que son panneau affiche.
    ///
    /// **Ne prend pas `ouvertes`** : une console sans session n'a pas de transaction, et répondre
    /// « aucune » sans consulter l'adaptateur est à la fois juste et sans latence.
    ///
    /// Le journal rendu est **entier** : il est celui de cette console, la session l'étant.
    pub async fn etat_de_transaction(&self, cle: &str, console: &str) -> TransactionState {
        match self
            .transactions
            .lock()
            .await
            .get(&(cle.to_owned(), console.to_owned()))
        {
            Some(session) => TransactionState {
                open: true,
                // Les réponses restent ici : seul ce que l'écran affiche traverse l'IPC, et ce
                // journal est relu à chaque exécution.
                statements: session
                    .journal
                    .instructions
                    .iter()
                    .map(|entree| entree.rendue.clone())
                    .collect(),
                aborted: session.journal.abandonnee,
            },
            None => TransactionState::default(),
        }
    }

    /// La réponse d'**une** instruction de la transaction, désignée par son rang (`API-38`).
    ///
    /// # Pourquoi un rang, et pas un identifiant
    ///
    /// Le journal d'une transaction ne fait que s'allonger : aucune entrée ne se retire, aucune ne
    /// se déplace, et un `commit` ou un `rollback` le remplace en entier. Un rang y désigne donc
    /// toujours la même instruction, sans qu'on ait à distribuer des identifiants ni à les faire
    /// voyager avec chaque exécution — et comme le journal est celui d'une console, ce rang est la
    /// place que le panneau affiche.
    ///
    /// Les trois refus disent lequel des trois cas s'est présenté : aucune transaction, un rang qui
    /// n'existe pas, ou une instruction qui n'a rendu aucune ligne. L'écran ne propose le geste que
    /// sur `displayable`, donc ces messages ne se lisent que par un chemin qui le contourne — un
    /// panneau en retard d'une validation, par exemple.
    pub async fn reponse_de_transaction(
        &self,
        cle: &str,
        console: &str,
        rang: usize,
    ) -> Result<QueryResult, EngineError> {
        let sessions = self.transactions.lock().await;
        let session = sessions
            .get(&(cle.to_owned(), console.to_owned()))
            .ok_or_else(transaction_absente)?;
        let entree = session.journal.instructions.get(rang).ok_or_else(|| {
            EngineError::local(format!(
                "cette transaction ne porte pas d'instruction n° {} : elle en compte {}.",
                rang + 1,
                session.journal.instructions.len()
            ))
        })?;
        entree.reponse.clone().ok_or_else(|| {
            EngineError::local(
                "cette instruction n'a rendu aucune ligne : il n'y a pas de résultat à afficher.",
            )
        })
    }

    /// Vrai quand **une** console de cette connexion tient une transaction manuelle.
    ///
    /// Le prédicat de `refuser_pendant_une_transaction`, séparé pour ce qu'il dit de lui-même. Il
    /// porte sur la connexion et non sur une console : ce que l'écriture de la grille risque ne
    /// dépend pas de savoir laquelle des consoles tient le verrou.
    pub async fn transaction_ouverte(&self, cle: &str) -> bool {
        self.transactions
            .lock()
            .await
            .keys()
            .any(|(connexion, _)| connexion == cle)
    }

    /// Refuse une écriture de la grille pendant qu'une console tient une transaction (`API-38`).
    ///
    /// # Ce que le refus évite depuis qu'une console a sa propre session
    ///
    /// Il ne s'agit plus d'un `begin` imbriqué : `apply_updates` et `create_schema` posent les
    /// leurs sur la session de la **connexion**, que plus aucune transaction de console n'occupe.
    /// Ce qui reste, et qui est pire, c'est le **verrou** : les lignes qu'une transaction ouverte a
    /// touchées sont verrouillées jusqu'à son issue, donc l'écriture de la grille **attendrait** —
    /// indéfiniment sur PostgreSQL, cinquante secondes sur MySQL, et tout de suite en échec sur le
    /// fichier de SQLite.
    ///
    /// **Et l'attente ne serait pas la sienne seule** : le registre tient le verrou de la connexion
    /// pendant l'opération, donc une écriture bloquée sur un verrou de base gèlerait *toute* lecture
    /// de cette connexion — l'arbre, les autres consoles, la grille. Un refus qui nomme les deux
    /// gestes possibles est la seule issue qui ne surprenne personne.
    pub async fn refuser_pendant_une_transaction(
        &self,
        cle: &str,
        geste: &str,
    ) -> Result<(), EngineError> {
        if self.transaction_ouverte(cle).await {
            return Err(EngineError::local(format!(
                "une transaction manuelle est ouverte dans une console de cette connexion : \
                 validez-la ou annulez-la avant de {geste}. Sans cela, cette écriture attendrait \
                 les verrous qu'elle tient."
            )));
        }
        Ok(())
    }

    /// Valide la transaction d'une console.
    ///
    /// **Après cet appel, la transaction est terminée quoi qu'il arrive** — et c'est une décision,
    /// pas une observation. Un `commit` refusé ne laisse pas le même état d'un moteur à l'autre :
    /// PostgreSQL a déjà tout annulé, SQLite peut rendre `SQLITE_BUSY` en **laissant la transaction
    /// ouverte**. Plutôt que d'afficher un état qui dépend du moteur, l'échec est suivi d'une
    /// annulation : le panneau peut alors dire une seule chose, vraie partout.
    pub async fn valider_la_transaction(
        &self,
        cle: &str,
        console: &str,
    ) -> Result<(), EngineError> {
        self.achever(cle, console, OrdreDeTransaction::Valider)
            .await
    }

    /// Annule la transaction d'une console.
    pub async fn annuler_la_transaction(
        &self,
        cle: &str,
        console: &str,
    ) -> Result<(), EngineError> {
        self.achever(cle, console, OrdreDeTransaction::Annuler)
            .await
    }

    /// # Elle ne rouvre pas, contrairement à toutes les autres (`API-37`)
    ///
    /// Une transaction ne survit pas à sa session : rouvrir donnerait une session **neuve**, où un
    /// `commit` réussirait sans rien valider — PostgreSQL n'y voit qu'un avertissement. L'écran
    /// lirait « validée » sur une transaction que le serveur avait annulée, ce qui est le pire
    /// mensonge que ce chemin puisse porter. Une session absente est donc un refus.
    ///
    /// **La session est retirée avant l'ordre, et fermée après** : c'est elle qui portait la
    /// transaction, et la garder ouverte laisserait une seconde session par console sur le serveur
    /// pour rien. Le journal part avec elle, dans les deux issues — le garder après un échec
    /// offrirait un bouton qui ne peut plus rien faire, et le vider est ce qui rend l'état
    /// déterministe.
    async fn achever(
        &self,
        cle: &str,
        console: &str,
        ordre: OrdreDeTransaction,
    ) -> Result<(), EngineError> {
        let session = self
            .transactions
            .lock()
            .await
            .remove(&(cle.to_owned(), console.to_owned()))
            .ok_or_else(|| {
                EngineError::local(
                    "aucune transaction n'est ouverte dans cette console : il n'y a rien à valider \
                     ni à annuler.",
                )
            })?;

        let issue = session.adaptateur.transaction(ordre).await;
        let seconde_chance = match issue {
            Ok(()) => Ok(()),
            // Une annulation qui échoue n'a rien à réessayer : c'est déjà le geste de repli.
            Err(erreur) if ordre == OrdreDeTransaction::Annuler => Err(erreur),
            Err(erreur) => {
                // Le `commit` a échoué : on annule, pour que « la transaction est terminée » soit
                // vrai sur les trois moteurs. Si l'annulation échoue aussi, la session tient des
                // verrous côté serveur — mais elle est fermée juste après, ce qui les rend : c'est
                // la seule chose que la fermeture d'une session par console ait changée ici.
                match session
                    .adaptateur
                    .transaction(OrdreDeTransaction::Annuler)
                    .await
                {
                    Ok(()) => Err(EngineError::local(format!(
                        "{} — la transaction a été annulée.",
                        erreur.message
                    ))),
                    Err(_) => Err(EngineError::local(format!(
                        "{} — et la transaction n'a pas pu être annulée ; sa session est fermée, \
                         ce qui l'annule côté serveur.",
                        erreur.message
                    ))),
                }
            }
        };
        session.adaptateur.close().await;
        seconde_chance
    }

    /// Ferme et retire les sessions de console d'une connexion (`API-38`).
    ///
    /// Appelée par `fermer` et par `tenter` : la session d'une console passe par le proxy de la
    /// connexion partagée, donc elle ne survit pas à sa fermeture — et une transaction sans session
    /// n'est plus qu'un panneau qui promet un « Valider » sans objet.
    async fn fermer_les_sessions_de_console(&self, cle: &str) {
        // **Retirées sous le verrou, fermées après** : c'est l'ordre de `tenter`, et pour la même
        // raison — une fermeture attend, et le journal des autres connexions doit rester lisible
        // pendant ce temps.
        let siennes = {
            let mut sessions = self.transactions.lock().await;
            let adresses: Vec<CleDeConsole> = sessions
                .keys()
                .filter(|(connexion, _)| connexion == cle)
                .cloned()
                .collect();
            adresses
                .into_iter()
                .filter_map(|adresse| sessions.remove(&adresse))
                .collect::<Vec<_>>()
        };
        for session in siennes {
            session.adaptateur.close().await;
        }
    }

    /// Le nombre de connexions ouvertes. Employé par les tests, et par rien d'autre.
    pub async fn ouvertes(&self) -> usize {
        self.ouvertes.lock().await.len()
    }

    /// Le nombre de sessions de console vivantes (`API-38`). Employé par les tests, et par rien
    /// d'autre — mais c'est la **seule** façon de constater qu'aucune ne fuit : une session oubliée
    /// tient une transaction et ses verrous côté serveur, et rien à l'écran ne le dirait.
    pub async fn sessions_de_console(&self) -> usize {
        self.transactions.lock().await.len()
    }
}

/// Le refus d'une connexion absente du registre, **écrit une fois**.
///
/// Trois méthodes le rendent maintenant, et le message dit la manœuvre plutôt que l'échec : c'est
/// lui que l'écran affiche quand un onglet est arrivé sur une connexion fermée.
fn transaction_absente() -> EngineError {
    EngineError::local("aucune transaction n'est ouverte dans cette console.")
}

/// La variante d'une **session de console**, redirigée vers le proxy déjà monté (`API-38`).
///
/// **Le tunnel est retiré de la variante, et remplacé par son bout local.** Le laisser ferait
/// monter un second tunnel SSH par console ; le retirer sans rediriger ferait joindre le serveur en
/// direct, ce qui contournerait la consigne de la connexion. Sans port — le proxy n'est plus là —,
/// la variante garde son tunnel : c'est alors `preparer` qui refuse, et son refus est le bon.
fn variante_de_session(
    variante: &ConnectionSettings,
    port_du_proxy: Option<u16>,
) -> ConnectionSettings {
    let mut variante = variante.clone();
    if let (Some(_), Some(port)) = (&variante.tunnel, port_du_proxy) {
        variante.host = "127.0.0.1".to_owned();
        variante.port = port;
        variante.tunnel = None;
    }
    variante
}

fn aucune_connexion(cle: &str) -> EngineError {
    EngineError::local(format!(
        "aucune connexion ouverte pour « {cle} » — la base doit être ouverte avant d'être          interrogée"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_cle_est_celle_de_la_reference_de_secret() {
        // `08e` dérive la référence d'un secret du même triplet. Deux conventions divergentes
        // obligeraient à traduire de l'une à l'autre, et une traduction se désynchronise.
        assert_eq!(
            cle("Halle", "analytics", "prod"),
            crate::config::reference_de("Halle", "analytics", "prod").as_str()
        );
    }

    #[tokio::test]
    async fn une_base_inconnue_du_registre_est_jamais_tentee() {
        let registre = ConnectionRegistry::new();
        // Et non `Offline` : afficher en rouge une base qu'on n'a pas ouverte serait faux.
        assert_eq!(
            registre.etat("Halle/analytics/dev").await,
            ConnectionState::Never
        );
    }

    #[tokio::test]
    async fn interroger_une_base_non_ouverte_est_refuse_clairement() {
        let registre = ConnectionRegistry::new();
        let erreur = registre
            .avec::<(), _>("Halle/analytics/dev", Reprise::Rejouable, |_| {
                Box::pin(async { Ok(()) })
            })
            .await
            .expect_err("une base non ouverte doit être refusée");

        assert!(
            erreur.message.contains("aucune connexion ouverte"),
            "{erreur}"
        );
        assert!(erreur.code.is_none(), "échec local, donc sans SQLSTATE");
    }

    #[tokio::test]
    async fn fermer_une_base_inconnue_ne_panique_pas() {
        // Fermer deux fois, ou fermer ce qui n'a jamais été ouvert, arrive quand l'écran et le
        // registre se désynchronisent. Ce doit être sans effet, pas une panique.
        ConnectionRegistry::new()
            .fermer("Halle/analytics/dev")
            .await;
    }

    #[test]
    fn les_quatre_etats_se_serialisent_avec_leur_nature() {
        let cas = [
            (ConnectionState::Never, "never"),
            (ConnectionState::Connecting, "connecting"),
            (
                ConnectionState::Connected {
                    server_version: "PostgreSQL 17.6".into(),
                    tunnel_local_port: None,
                },
                "connected",
            ),
            (
                ConnectionState::Offline {
                    reason: "hôte injoignable".into(),
                },
                "offline",
            ),
        ];

        for (etat, attendu) in cas {
            let json = serde_json::to_value(&etat).expect("sérialisation");
            assert_eq!(json["kind"], attendu, "{json}");
        }
    }
}

/// La transaction manuelle d'une console (`API-38`), **contre un vrai fichier SQLite**.
///
/// # Pourquoi SQLite, et sans `db-tests`
///
/// Le décor est un fichier temporaire que le test crée lui-même : ces tests tournent donc partout,
/// y compris sur une machine sans Docker, et exercent le chemin **complet** — le registre, un
/// adaptateur réel, un `BEGIN` réel et une base qui garde ou rend ce qu'on lui a écrit. Le mode
/// manuel serait resté sans test si on l'avait réservé aux décors à conteneur, alors que c'est
/// exactement la fonction dont un test doit dire si elle écrit ou non.
///
/// Ce que ces tests **ne** disent pas : le comportement des trois autres moteurs. MySQL tient sa
/// transaction sur une connexion prise au pool, ce que rien ici n'exerce — voir `MysqlAdapter` et la
/// réserve d'`AGENTS.md`.
#[cfg(test)]
mod tests_transaction {
    use super::*;
    use crate::config::{Engine, SslMode};

    /// La console qui exécute, dans les tests qui n'en ont qu'une.
    ///
    /// Le cœur ne compare ce jeton qu'à lui-même : sa forme est celle que l'écran mint, et **aucun
    /// test ne doit dépendre de cette forme** — c'est ce qui laisse `useTransaction` la changer.
    const CONSOLE: &str = "console-1";

    /// Une seconde console sur la **même** connexion, donc dans la même transaction.
    const AUTRE_CONSOLE: &str = "console-2";

    /// Un fichier neuf, une table d'une colonne, et une connexion au registre.
    async fn registre_sqlite() -> (tempfile::TempDir, ConnectionRegistry, String) {
        let dossier = tempfile::tempdir().expect("répertoire temporaire");
        let chemin = dossier.path().join("atelier.db");
        rusqlite::Connection::open(&chemin)
            .expect("fichier")
            .execute_batch("create table jetons (valeur integer)")
            .expect("décor");

        let variante = ConnectionSettings {
            // Un moteur de fichier n'a ni hôte, ni port, ni utilisateur : le chemin vit dans
            // `default_database` (`17a`).
            host: String::new(),
            port: 0,
            default_database: chemin.to_string_lossy().into_owned(),
            username: String::new(),
            password: None,
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        };

        let registre = ConnectionRegistry::new();
        let cle = cle("Atelier", "jetons", "dev");
        registre
            .ouvrir(
                &cle,
                Engine::Sqlite,
                &variante,
                None,
                std::path::Path::new("/aucun/known_hosts"),
            )
            .await
            .expect("un fichier SQLite doit s'ouvrir");
        (dossier, registre, cle)
    }

    /// Le compte des lignes de la table, tel que la **console qui lit** le voit.
    ///
    /// **En mode `auto`**, ce qui ne veut pas dire « hors de la transaction » : une console qui
    /// tient la sienne y reste, et voit donc ce qu'elle a écrit. C'est exactement ce qu'il faut
    /// pour distinguer « retenu » de « jamais écrit » — et, lu depuis une **autre** console, pour
    /// constater qu'une transaction est invisible du dehors.
    async fn compte_vu_par(registre: &ConnectionRegistry, cle: &str, console: &str) -> i64 {
        let resultat = registre
            .executer_une_requete(
                cle,
                "select count(*) as n from jetons",
                RowLimit::OneHundred,
                TransactionMode::Auto,
                console,
            )
            .await
            .expect("lecture");
        match &resultat.rows[0][0] {
            crate::engine::Value::Int { value } => *value,
            autre => panic!("un compte doit être un entier : {autre:?}"),
        }
    }

    /// Le compte tel que la console qui a joué la transaction le voit.
    async fn compte(registre: &ConnectionRegistry, cle: &str) -> i64 {
        compte_vu_par(registre, cle, CONSOLE).await
    }

    #[tokio::test]
    async fn en_mode_auto_rien_n_est_retenu_et_rien_n_est_journalise() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Auto,
                CONSOLE,
            )
            .await
            .expect("écriture");

        // Aucune transaction n'a été ouverte : il n'y a rien à valider, et le panneau ne doit pas
        // paraître.
        assert_eq!(
            registre.etat_de_transaction(&cle, CONSOLE).await,
            TransactionState::default()
        );
        assert!(!registre.transaction_ouverte(&cle).await);
        assert_eq!(compte(&registre, &cle).await, 1);
    }

    #[tokio::test]
    async fn en_mode_manuel_l_annulation_rend_la_base_a_son_etat() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");

        // **Dans la transaction, la ligne est là** : c'est ce qui distingue « retenue » de « jamais
        // écrite », et c'est ce que la console montre à qui relit avant de valider.
        assert_eq!(compte(&registre, &cle).await, 1);

        registre
            .annuler_la_transaction(&cle, CONSOLE)
            .await
            .expect("annulation");
        assert_eq!(compte(&registre, &cle).await, 0);
        assert!(!registre.transaction_ouverte(&cle).await);
    }

    #[tokio::test]
    async fn en_mode_manuel_la_validation_ecrit_pour_de_bon() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (7)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre
            .valider_la_transaction(&cle, CONSOLE)
            .await
            .expect("validation");

        assert_eq!(compte(&registre, &cle).await, 1);
        assert_eq!(
            registre.etat_de_transaction(&cle, CONSOLE).await,
            TransactionState::default(),
            "une transaction validée n'est plus ouverte, et son journal est vide"
        );
    }

    #[tokio::test]
    async fn le_journal_porte_ce_que_le_serveur_a_dit() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1), (2), (3)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");

        let etat = registre.etat_de_transaction(&cle, CONSOLE).await;
        assert!(etat.open);
        assert_eq!(etat.statements.len(), 1);
        let instruction = &etat.statements[0];
        assert!(
            instruction.sql.contains("insert into jetons"),
            "{instruction:?}"
        );
        // **Trois lignes touchées, zéro rendue** : c'est la réponse que le panneau affiche, et sans
        // `affected` elle aurait dit « 0 ligne » d'une écriture qui en a fait trois.
        assert_eq!(instruction.affected, Some(3), "{instruction:?}");
        assert_eq!(instruction.returned, 0, "{instruction:?}");
        assert_eq!(instruction.error, None, "{instruction:?}");
    }

    #[tokio::test]
    async fn une_lecture_rend_ses_lignes_et_ne_touche_rien() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1), (2)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre
            .executer_une_requete(
                &cle,
                "select valeur from jetons",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("lecture");

        let etat = registre.etat_de_transaction(&cle, CONSOLE).await;
        let lecture = etat.statements.last().expect("deux instructions");
        assert_eq!(lecture.returned, 2, "{lecture:?}");
        // `None`, et non `Some(0)` : une lecture ne touche rien, et le compte de lignes touchées de
        // l'écriture d'avant ne doit pas lui être attribué.
        assert_eq!(lecture.affected, None, "{lecture:?}");
    }

    #[tokio::test]
    async fn la_reponse_d_une_instruction_se_redemande_par_son_rang() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1), (2), (3)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre
            .executer_une_requete(
                &cle,
                "select valeur from jetons order by valeur",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("première lecture");
        // Une seconde lecture, **différente** : sans elle, le rang demandé ne prouverait rien —
        // rendre « la dernière réponse » suffirait à faire passer le test (règle n° 5).
        registre
            .executer_une_requete(
                &cle,
                "select valeur from jetons where valeur > 2",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("seconde lecture");

        let etat = registre.etat_de_transaction(&cle, CONSOLE).await;
        // **Ce que l'écran lit du journal** : des comptes et un drapeau, jamais les lignes — le
        // journal est relu à chaque exécution, et y mettre les réponses les ferait toutes traverser
        // l'IPC à chaque fois.
        assert_eq!(etat.statements.len(), 3);
        assert!(
            !etat.statements[0].displayable,
            "une écriture n'a rien à afficher"
        );
        assert_eq!(etat.statements[0].affected, Some(3));
        assert!(etat.statements[1].displayable);

        // **La réponse de la première lecture, pas de la dernière.** C'est tout l'intérêt du rang :
        // la grille du centre ne tient qu'une réponse, et c'est ici que les autres existent encore.
        let premiere = registre
            .reponse_de_transaction(&cle, CONSOLE, 1)
            .await
            .expect("la réponse de l'instruction 2");
        assert_eq!(premiere.rows.len(), 3);
        assert_eq!(premiere.columns, vec!["valeur".to_owned()]);
        let seconde = registre
            .reponse_de_transaction(&cle, CONSOLE, 2)
            .await
            .expect("la réponse de l'instruction 3");
        assert_eq!(seconde.rows.len(), 1);
    }

    #[tokio::test]
    async fn la_transaction_d_une_console_est_invisible_des_autres() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");

        // **Le nerf de tout ce chantier.** Tant que les deux consoles partageaient la session de
        // la connexion, cette lecture-là voyait la ligne retenue : la transaction de l'une était
        // celle de l'autre, et aucun choix d'écran ne pouvait le défaire. La console 2 lit sur la
        // session de la connexion, qui n'a pas de transaction — elle ne voit donc rien.
        assert_eq!(compte_vu_par(&registre, &cle, AUTRE_CONSOLE).await, 0);
        // Et la console 1, elle, voit ce qu'elle retient : la lecture reste dans sa transaction.
        assert_eq!(compte(&registre, &cle).await, 1);

        // Le panneau de la console 2 est vide, et pas « vide parce qu'on l'a filtré » : elle n'a
        // aucune transaction, celle de sa voisine n'étant pas la sienne.
        assert_eq!(
            registre.etat_de_transaction(&cle, AUTRE_CONSOLE).await,
            TransactionState::default()
        );
        assert!(registre.etat_de_transaction(&cle, CONSOLE).await.open);

        // Deux sessions vivent : celle de la connexion et celle de la console 1.
        assert_eq!(registre.sessions_de_console().await, 1);

        registre
            .valider_la_transaction(&cle, CONSOLE)
            .await
            .expect("validation");
        // Validée, la ligne devient visible de partout — et la session de la console est rendue.
        assert_eq!(compte_vu_par(&registre, &cle, AUTRE_CONSOLE).await, 1);
        assert_eq!(registre.sessions_de_console().await, 0);
    }

    #[tokio::test]
    async fn sur_un_fichier_une_seule_console_tient_une_transaction_a_la_fois() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("la première console prend le verrou d'écriture du fichier");

        // **La limite du moteur, dite plutôt que subie.** Un fichier SQLite n'a qu'un verrou
        // d'écriture : la seconde console reçoit « database is locked », qui est vrai et qui laisse
        // chercher un autre programme alors que c'est l'onglet d'à côté.
        let refus = registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (2)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                AUTRE_CONSOLE,
            )
            .await
            .expect_err("un fichier ne tient pas deux transactions");
        // La cause, en premier : c'est elle qui dit quoi faire.
        assert!(
            refus.message.starts_with("Une autre console"),
            "le refus nomme la voisine : {refus}"
        );
        // Et le mot du moteur, gardé : un refus peut toujours avoir une autre cause que celle-là.
        assert!(
            refus.message.contains("verrou d'écriture"),
            "le message du moteur est gardé : {refus}"
        );

        // Rien n'est resté en travers : la session refusée est fermée, et la première transaction
        // n'a pas bougé.
        assert_eq!(registre.sessions_de_console().await, 1);
        assert_eq!(
            registre.etat_de_transaction(&cle, AUTRE_CONSOLE).await,
            TransactionState::default()
        );
        assert_eq!(compte(&registre, &cle).await, 1);
    }

    #[tokio::test]
    async fn fermer_la_connexion_ferme_les_sessions_de_ses_consoles() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        assert_eq!(registre.sessions_de_console().await, 1);

        registre.fermer(&cle).await;

        // **La session d'une console emprunte le proxy de la connexion**, donc elle ne lui survit
        // pas — et une session oubliée tiendrait le verrou d'écriture du fichier pour toujours,
        // sans que rien à l'écran puisse le dire.
        assert_eq!(registre.sessions_de_console().await, 0);
        assert_eq!(registre.ouvertes().await, 0);
    }

    #[tokio::test]
    async fn les_trois_refus_de_reponse_ne_se_confondent_pas() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        // Aucune transaction ouverte.
        let sans = registre
            .reponse_de_transaction(&cle, CONSOLE, 0)
            .await
            .expect_err("aucune transaction");
        assert!(sans.message.contains("aucune transaction"), "{sans}");

        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");

        // Un rang qui n'existe pas : le message dit **combien** il y en a, plutôt que « invalide ».
        let hors = registre
            .reponse_de_transaction(&cle, CONSOLE, 7)
            .await
            .expect_err("rang hors de la liste");
        assert!(hors.message.contains("elle en compte 1"), "{hors}");

        // Une instruction qui n'a rien rendu : ce n'est ni une absence de transaction ni un mauvais
        // rang, et l'écran ne propose d'ailleurs pas le geste — `displayable` est faux.
        let vide = registre
            .reponse_de_transaction(&cle, CONSOLE, 0)
            .await
            .expect_err("une écriture n'a pas de résultat");
        assert!(vide.message.contains("aucune ligne"), "{vide}");
    }

    #[tokio::test]
    async fn une_instruction_refusee_est_inscrite_et_laisse_la_transaction_ouverte() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        let erreur = registre
            .executer_une_requete(
                &cle,
                "insert into jetons_absents (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect_err("une table inconnue doit être refusée");

        let etat = registre.etat_de_transaction(&cle, CONSOLE).await;
        assert!(
            etat.open,
            "le `begin` a réussi : il y a quelque chose à annuler"
        );
        let instruction = &etat.statements[0];
        assert_eq!(
            instruction.error.as_deref(),
            Some(erreur.message.as_str()),
            "l'échec est ce qu'on vient lire dans le panneau : {instruction:?}"
        );
    }

    #[tokio::test]
    async fn sqlite_n_abandonne_pas_sa_transaction_sur_un_refus() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons_absents (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect_err("une table inconnue doit être refusée");

        // **La réponse vient du moteur, et ce moteur-ci n'abandonne pas** : l'instruction échoue
        // seule, l'écriture d'avant reste bonne, et le panneau doit continuer d'offrir « Valider ».
        // Le déduire d'un simple échec aurait retiré à SQLite et MySQL une capacité qu'ils ont —
        // c'est PostgreSQL qui abandonne, et lui seul.
        let etat = registre.etat_de_transaction(&cle, CONSOLE).await;
        assert!(etat.open);
        assert!(!etat.aborted, "{etat:?}");

        // Et la validation écrit vraiment ce qui avait réussi.
        registre
            .valider_la_transaction(&cle, CONSOLE)
            .await
            .expect("validation");
        assert_eq!(compte(&registre, &cle).await, 1);
    }

    #[tokio::test]
    async fn une_seconde_execution_reste_dans_la_meme_transaction() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        for _ in 0..2 {
            registre
                .executer_une_requete(
                    &cle,
                    "insert into jetons (valeur) values (1)",
                    RowLimit::OneHundred,
                    TransactionMode::Manual,
                    CONSOLE,
                )
                .await
                .expect("écriture");
        }

        // Deux instructions dans **une** transaction, et non deux transactions : un second `begin`
        // aurait été refusé par SQLite, et une transaction par requête ne retiendrait rien.
        assert_eq!(
            registre
                .etat_de_transaction(&cle, CONSOLE)
                .await
                .statements
                .len(),
            2
        );
        registre
            .annuler_la_transaction(&cle, CONSOLE)
            .await
            .expect("annulation");
        assert_eq!(compte(&registre, &cle).await, 0);
    }

    #[tokio::test]
    async fn une_execution_en_auto_pendant_une_transaction_y_entre_quand_meme() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (2)",
                RowLimit::OneHundred,
                TransactionMode::Auto,
                CONSOLE,
            )
            .await
            .expect("écriture");

        // **Le journal dit ce que la transaction contient, pas ce que le mode demandait.** La
        // seconde ligne est dedans — la session la porte — donc l'annulation l'emporte aussi, et le
        // panneau doit l'avoir annoncée.
        assert_eq!(
            registre
                .etat_de_transaction(&cle, CONSOLE)
                .await
                .statements
                .len(),
            2
        );
        registre
            .annuler_la_transaction(&cle, CONSOLE)
            .await
            .expect("annulation");
        assert_eq!(compte(&registre, &cle).await, 0);
    }

    #[tokio::test]
    async fn fermer_la_connexion_emporte_la_transaction() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");
        registre.fermer(&cle).await;

        // Le serveur annule ce qui n'est pas validé ; garder le journal offrirait un « Valider » qui
        // n'a plus rien à valider.
        assert!(!registre.transaction_ouverte(&cle).await);
        assert_eq!(
            registre.etat_de_transaction(&cle, CONSOLE).await,
            TransactionState::default()
        );
    }

    #[tokio::test]
    async fn une_ecriture_de_la_grille_est_refusee_pendant_une_transaction_de_console() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        // Sans transaction, rien ne gêne : le refus ne doit pas mordre hors de son cas.
        registre
            .refuser_pendant_une_transaction(&cle, "écrire")
            .await
            .expect("aucune transaction ouverte");

        registre
            .executer_une_requete(
                &cle,
                "insert into jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("écriture");

        let erreur = registre
            .refuser_pendant_une_transaction(&cle, "écrire les modifications de la grille")
            .await
            .expect_err("une écriture qui conduit sa propre transaction doit être refusée");
        // Le message nomme les **deux** issues : un refus qui dirait seulement « impossible »
        // laisserait chercher où déverrouiller.
        assert!(
            erreur.message.contains("validez-la ou annulez-la"),
            "{erreur}"
        );
        assert!(
            erreur
                .message
                .contains("écrire les modifications de la grille"),
            "le geste refusé est nommé : {erreur}"
        );
    }

    #[tokio::test]
    async fn achever_ce_qui_n_est_pas_ouvert_est_refuse_avec_sa_raison() {
        let (_dossier, registre, cle) = registre_sqlite().await;
        let erreur = registre
            .valider_la_transaction(&cle, CONSOLE)
            .await
            .expect_err("il n'y a rien à valider");
        assert!(erreur.message.contains("aucune transaction"), "{erreur}");
    }

    #[tokio::test]
    async fn sur_une_connexion_fermee_tout_est_refuse_clairement() {
        let registre = ConnectionRegistry::new();
        let cle = cle("Atelier", "jetons", "dev");
        // L'exécution parle de la **connexion** : c'est elle qui manque, et le message dit la
        // manœuvre — ouvrir la base.
        let sans_connexion = registre
            .executer_une_requete(
                "x",
                "select 1",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect_err("aucune connexion");
        assert!(
            sans_connexion.message.contains("aucune connexion ouverte"),
            "{sans_connexion}"
        );

        // **Les deux issues, elles, parlent de la transaction**, et c'est ce qu'une session par
        // console a changé : elles ne consultent plus la connexion du tout — la session *est* la
        // transaction, donc son absence est la seule chose à dire. Un « aucune connexion ouverte »
        // enverrait rouvrir une base pour valider une transaction qui n'existe pas.
        for erreur in [
            registre
                .valider_la_transaction(&cle, CONSOLE)
                .await
                .expect_err("aucune transaction"),
            registre
                .annuler_la_transaction(&cle, CONSOLE)
                .await
                .expect_err("aucune transaction"),
        ] {
            assert!(
                erreur.message.contains("aucune transaction n'est ouverte"),
                "{erreur}"
            );
        }
        // Et la lecture d'état, elle, répond sans se plaindre : une connexion fermée n'a pas de
        // transaction, et l'écran doit pouvoir le demander à tout moment.
        assert_eq!(
            registre.etat_de_transaction(&cle, CONSOLE).await,
            TransactionState::default()
        );
    }
}

/// Tests exigeant une vraie base. Lancés par le job Linux de la CI, et en local contre le
/// conteneur dédié — voir `postgres/mod.rs` pour la commande.
#[cfg(all(test, feature = "db-tests"))]
mod tests_db {
    use super::*;
    use crate::config::SslMode;

    /// Voir la constante du même nom dans `tests_transaction`.
    const CONSOLE: &str = "console-1";

    fn variante() -> ConnectionSettings {
        let url = std::env::var("DORABASE_TEST_PG")
            .expect("DORABASE_TEST_PG doit être défini pour les tests de base");
        let analysee: tokio_postgres::Config = url.parse().expect("URL de test analysable");
        let hote = analysee
            .get_hosts()
            .first()
            .map(|h| match h {
                tokio_postgres::config::Host::Tcp(nom) => nom.clone(),
                _ => panic!("l'adresse de test doit être TCP"),
            })
            .expect("un hôte");

        ConnectionSettings {
            host: hote,
            port: *analysee.get_ports().first().expect("un port"),
            default_database: analysee.get_dbname().expect("une base").to_owned(),
            username: analysee.get_user().expect("un utilisateur").to_owned(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn secret() -> Option<Secret> {
        let url = std::env::var("DORABASE_TEST_PG").expect("DORABASE_TEST_PG");
        let analysee: tokio_postgres::Config = url.parse().expect("URL");
        analysee
            .get_password()
            .map(|octets| Secret::new(String::from_utf8_lossy(octets).into_owned()))
    }

    fn known_hosts() -> std::path::PathBuf {
        // Aucun tunnel dans ces tests : le chemin n'est jamais lu, mais le passer explicitement
        // évite de toucher le `~/.ssh/known_hosts` de la machine.
        std::path::PathBuf::from("/aucun/known_hosts")
    }

    /// **Le point du registre.** `09d` déplie un schéma puis une table : chaque commande
    /// rouvrant une connexion épuiserait les ports et ajouterait une poignée de main par clic.
    ///
    /// **Ce test a d'abord été écrit trop faible.** Il comptait les entrées du registre après
    /// deux ouvertures et attendait 1 — mais sans la garde de réemploi, la seconde ouverture
    /// *remplace* l'entrée, et le compte reste 1 de toute façon. Retirer la garde laissait donc
    /// le test vert, alors que la première connexion était lâchée sans `close` et fuyait son
    /// tunnel.
    ///
    /// La version qui mord : la seconde ouverture emploie une variante **cassée**. Avec la
    /// garde, elle rend sans rien tenter et la connexion reste vivante ; sans elle, la tentative
    /// échoue et l'état bascule en `Offline`.
    /// **Le chemin exact que prend `read_rows` (`10c`)** : ouvrir, puis lire une fenêtre par
    /// `avec`. `06d` a testé l'adaptateur ; ce test-ci vérifie que la commande a bien un chemin
    /// jusqu'à lui, ce qu'aucun test ne faisait — la couche était complète et personne ne la
    /// franchissait.
    #[tokio::test]
    async fn lire_une_fenetre_par_le_registre_rend_la_limite_demandee() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let requete = crate::engine::RowQuery::new(
            "introspection",
            "grande",
            crate::engine::RowLimit::FiveHundred,
        );
        let fenetre = registre
            .avec(cle, Reprise::Rejouable, move |adaptateur| {
                let requete = requete.clone();
                Box::pin(async move { adaptateur.rows(&requete).await })
            })
            .await
            .expect("lecture");

        assert_eq!(fenetre.rows.len(), 500, "la table porte cent mille lignes");
        assert!(fenetre.sql.contains("limit 500"), "{}", fenetre.sql);

        registre.fermer(cle).await;
    }

    /// Lire une base **non ouverte** doit dire pourquoi, et non rendre une fenêtre vide.
    ///
    /// Une fenêtre vide se confondrait avec une table sans ligne, et `A5` afficherait « aucune
    /// ligne » sur une base parfaitement peuplée mais fermée.
    /// **Le verdict que le panneau lit**, contre un vrai PostgreSQL (`API-38`).
    ///
    /// C'est le pendant de `sqlite_n_abandonne_pas_sa_transaction_sur_un_refus`, et les deux
    /// ensemble sont ce qui rend la question digne d'être posée au moteur : la même suite de gestes
    /// donne deux réponses, et un écran qui aurait conclu de l'échec seul se serait trompé pour l'un
    /// des deux.
    #[tokio::test]
    async fn une_instruction_refusee_abandonne_la_transaction_sur_postgresql() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("la base de test doit s'ouvrir");

        registre
            .executer_une_requete(
                cle,
                "select 1",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("lecture");
        registre
            .executer_une_requete(
                cle,
                "select depuis_nulle_part",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect_err("une colonne inconnue doit être refusée");

        // **La transaction est abandonnée, et l'écran doit le savoir** : un « Valider » offert là
        // se comporterait comme un « Annuler ». Elle reste **ouverte** — il y a bien quelque chose à
        // annuler.
        let etat = registre.etat_de_transaction(cle, CONSOLE).await;
        assert!(etat.open, "{etat:?}");
        assert!(etat.aborted, "{etat:?}");
        assert_eq!(etat.statements.len(), 2, "{etat:?}");

        registre
            .annuler_la_transaction(cle, CONSOLE)
            .await
            .expect("annulation");
        assert!(!registre.etat_de_transaction(cle, CONSOLE).await.open);
        registre.fermer(cle).await;
    }

    /// **Deux transactions à la fois, sur la même base, et chacune la sienne** (`API-38`).
    ///
    /// C'est le test que SQLite ne peut pas porter : un fichier n'a qu'un verrou d'écriture, donc
    /// la seconde console y est refusée (voir `sur_un_fichier_une_seule_console_tient_une_transaction_a_la_fois`).
    /// PostgreSQL tient autant de transactions que de sessions, ce qui est exactement ce qu'une
    /// session par console achète.
    ///
    /// Ce qu'il mesure, et qu'aucun test unitaire ne peut mesurer : l'**isolation** que le serveur
    /// promet. Ce qu'une console retient n'est visible ni de sa voisine, ni de la session de la
    /// connexion — celle que la grille et l'arbre emploient.
    #[tokio::test]
    async fn deux_consoles_tiennent_deux_transactions_independantes() {
        const AUTRE_CONSOLE: &str = "console-2";
        /// Une troisième console, qui n'entre dans aucune transaction : elle lit donc sur la
        /// session de la connexion, celle de la grille et de l'arbre.
        const DEHORS: &str = "console-3";

        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("la base de test doit s'ouvrir");

        // **Un schéma à soi, et non une table dans `introspection`.** Le décor est partagé et les
        // tests sont parallèles : une table de plus y ferait échouer
        // `une_base_ouverte_repond_a_l_introspection`, qui compte les objets du schéma. C'est le
        // défaut du 3 septembre 2026 par l'autre bout — celui-là voyait apparaître une clé
        // étrangère venue d'un schéma jetable dont il n'avait jamais entendu parler.
        for ddl in [
            "drop schema if exists deux_consoles cascade",
            "create schema deux_consoles",
            "create table deux_consoles.jetons (valeur int)",
        ] {
            executer(&registre, cle, ddl, DEHORS).await.expect("décor");
        }

        registre
            .executer_une_requete(
                cle,
                "insert into deux_consoles.jetons (valeur) values (1)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                CONSOLE,
            )
            .await
            .expect("l'écriture de la première console");
        // **Et la seconde ouvre la sienne**, là où une session partagée aurait vu son `begin`
        // avalé en avertissement puis tout validé d'un seul `commit`.
        registre
            .executer_une_requete(
                cle,
                "insert into deux_consoles.jetons (valeur) values (2)",
                RowLimit::OneHundred,
                TransactionMode::Manual,
                AUTRE_CONSOLE,
            )
            .await
            .expect("l'écriture de la seconde console");

        assert_eq!(registre.sessions_de_console().await, 2);
        // Chacune voit **la sienne**, et rien de l'autre.
        assert_eq!(compte(&registre, cle, CONSOLE).await, 1);
        assert_eq!(compte(&registre, cle, AUTRE_CONSOLE).await, 1);
        // Et du dehors, la table est encore vide : c'est l'isolation, et c'est le prix aussi — la
        // grille de `A5` ne montre pas ce qu'une transaction de console retient.
        assert_eq!(compte(&registre, cle, DEHORS).await, 0);

        registre
            .valider_la_transaction(cle, CONSOLE)
            .await
            .expect("validation de la première");
        // Validée, sa ligne paraît dehors — et la seconde transaction la voit aussi, PostgreSQL
        // lisant en `read committed` : chaque instruction voit ce qui est validé à son instant.
        assert_eq!(compte(&registre, cle, DEHORS).await, 1);
        assert_eq!(compte(&registre, cle, AUTRE_CONSOLE).await, 2);
        assert_eq!(registre.sessions_de_console().await, 1);

        registre
            .annuler_la_transaction(cle, AUTRE_CONSOLE)
            .await
            .expect("annulation de la seconde");
        // Annulée, la sienne n'a jamais existé pour personne.
        assert_eq!(compte(&registre, cle, DEHORS).await, 1);
        assert_eq!(registre.sessions_de_console().await, 0);

        executer(&registre, cle, "drop table deux_consoles.jetons", DEHORS)
            .await
            .expect("décor rendu");
        registre.fermer(cle).await;
    }

    /// Exécute sans transaction, depuis la console nommée.
    async fn executer(
        registre: &ConnectionRegistry,
        cle: &str,
        sql: &str,
        console: &str,
    ) -> Result<QueryResult, EngineError> {
        registre
            .executer_une_requete(
                cle,
                sql,
                RowLimit::OneHundred,
                TransactionMode::Auto,
                console,
            )
            .await
    }

    /// Le compte des lignes du décor, tel que la console nommée le voit.
    async fn compte(registre: &ConnectionRegistry, cle: &str, console: &str) -> i64 {
        let resultat = executer(
            registre,
            cle,
            "select count(*) as n from deux_consoles.jetons",
            console,
        )
        .await
        .expect("lecture");
        match &resultat.rows[0][0] {
            crate::engine::Value::Int { value } => *value,
            autre => panic!("un compte doit être un entier : {autre:?}"),
        }
    }

    #[tokio::test]
    async fn lire_une_base_non_ouverte_echoue_avec_un_message_qui_le_dit() {
        let registre = ConnectionRegistry::new();
        let requete = crate::engine::RowQuery::new(
            "introspection",
            "petite",
            crate::engine::RowLimit::OneHundred,
        );
        let erreur = registre
            .avec("Halle/jamais/dev", Reprise::Rejouable, move |adaptateur| {
                let requete = requete.clone();
                Box::pin(async move { adaptateur.rows(&requete).await })
            })
            .await
            .expect_err("une base fermée ne peut pas être lue");

        assert!(erreur.message.contains("ouverte"), "{}", erreur.message);
    }

    /// **Une lecture survit à une session coupée** (8 septembre 2026).
    ///
    /// Le défaut d'origine : une entrée du registre survivait à son socket, l'état restait
    /// `Connected`, et toute lecture suivante échouait en « connection closed » — l'arbre affichait
    /// « OK » sur une base morte, et il fallait relancer l'application. Le registre retire
    /// désormais l'entrée morte **et sait la rouvrir** : la lecture ne voit rien passer.
    ///
    /// **Le numéro de session est ce qui prouve la reconnexion.** Sans lui le test passerait sur un
    /// serveur qui n'aurait rien coupé du tout : `pg_backend_pid` nomme le processus serveur, et
    /// deux valeurs différentes ne s'obtiennent qu'en ayant vraiment rouvert.
    #[tokio::test]
    async fn une_lecture_rejouable_survit_a_une_session_coupee() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let avant = session(&registre, cle).await.expect("une première session");

        // Le serveur coupe notre propre session : la seule façon de reproduire une coupure sans
        // dormir (règle n° 3).
        let limite = crate::engine::RowLimit::OneHundred;
        let _ = registre
            .avec(cle, Reprise::Unique, move |adaptateur| {
                Box::pin(async move {
                    adaptateur
                        .run_sql("select pg_terminate_backend(pg_backend_pid())", limite)
                        .await
                })
            })
            .await;

        // **Et la lecture d'après réussit**, sans que personne ait rien rouvert à la main.
        let apres = session(&registre, cle)
            .await
            .expect("la lecture doit aboutir sur une connexion rouverte");

        assert_ne!(
            avant, apres,
            "la session doit être une autre : c'est la preuve que le registre a rouvert"
        );
        assert_eq!(
            registre.ouvertes().await,
            1,
            "la connexion est de nouveau là"
        );
        assert!(
            matches!(registre.etat(cle).await, ConnectionState::Connected { .. }),
            "et l'état le dit"
        );

        registre.fermer(cle).await;
    }

    /// **Une opération `Unique` n'est jamais rejouée** — la garde qui empêche d'écrire deux fois.
    ///
    /// Une écriture peut avoir été validée par le serveur *avant* que la coupure n'empêche l'accusé
    /// de réception d'arriver : un second passage insérerait une deuxième fois les lignes ajoutées.
    /// C'est pourquoi `apply_changes` et `run_sql` portent `Unique`.
    ///
    /// **La fermeture se coupe elle-même, puis reparle** : c'est ce qui rend l'échec déterministe.
    /// La première requête reçoit un `FATAL` du serveur, donc une erreur *de base* — la boucle
    /// d'entrées-sorties peut n'avoir pas encore vu la fin du flux. La seconde est fermée dans les
    /// deux ordres possibles.
    #[tokio::test]
    async fn une_operation_unique_n_est_jamais_rejouee() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let appels = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let erreur = registre
            .avec(cle, Reprise::Unique, qui_se_coupe(&appels))
            .await
            .expect_err("la connexion est morte pendant l'opération");

        assert_eq!(
            appels.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "une opération unique part une fois, et une seule"
        );
        assert!(!erreur.message.is_empty(), "l'échec porte sa raison");
        // L'entrée morte est tout de même retirée : c'est la **prochaine** opération qui rouvrira,
        // l'étage du bas n'étant refusé à personne.
        assert_eq!(registre.ouvertes().await, 0, "l'entrée morte est retirée");
        match registre.etat(cle).await {
            ConnectionState::Offline { reason } => assert!(!reason.is_empty(), "une raison"),
            autre => panic!("attendu hors ligne, obtenu {autre:?}"),
        }
    }

    /// **Une reprise, et une seule** : deux essais, jamais trois.
    ///
    /// Sans cette borne, un serveur qui coupe chaque session — un répartiteur mal réglé, un
    /// `idle_session_timeout` à zéro — ferait tourner le registre indéfiniment sur une base qui ne
    /// répondra jamais. La fermeture de ce test est précisément ce serveur-là : elle se coupe à
    /// chaque passage.
    #[tokio::test]
    async fn une_reprise_ne_boucle_pas() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let appels = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let _ = registre
            .avec(cle, Reprise::Rejouable, qui_se_coupe(&appels))
            .await
            .expect_err("la connexion meurt à chaque passage");

        assert_eq!(
            appels.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "un essai, une reprise, et on s'arrête"
        );
    }

    /// **Une connexion fermée à la main ne se rouvre pas** — la garde de la recette.
    ///
    /// `fermer` est appelé par les six commandes de configuration, et ce sont exactement celles qui
    /// **périment** la recette : renommer, changer la variante, retirer. Rouvrir sur l'ancien hôte,
    /// ou avec l'ancien secret, serait pire que ne rien rouvrir.
    #[tokio::test]
    async fn une_connexion_fermee_a_la_main_n_est_pas_rouverte() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");
        registre.fermer(cle).await;

        let erreur = session(&registre, cle)
            .await
            .expect_err("la recette est partie avec la fermeture");

        assert!(
            erreur.message.contains("aucune connexion ouverte"),
            "{erreur}"
        );
        assert_eq!(registre.ouvertes().await, 0, "et rien n'a été rouvert");
    }

    /// Le numéro de session du serveur, lu par une opération **rejouable**.
    ///
    /// Deux valeurs différentes prouvent qu'une nouvelle connexion a été faite : c'est le seul
    /// témoin d'une reconnexion qui ne dépende ni d'une durée ni d'un journal.
    async fn session(registre: &ConnectionRegistry, cle: &str) -> Result<String, EngineError> {
        let limite = crate::engine::RowLimit::OneHundred;
        let resultat = registre
            .avec(cle, Reprise::Rejouable, move |adaptateur| {
                Box::pin(async move { adaptateur.run_sql("select pg_backend_pid()", limite).await })
            })
            .await?;
        Ok(format!(
            "{:?}",
            resultat.rows.first().and_then(|l| l.first())
        ))
    }

    /// Une opération qui **coupe sa propre session**, puis reparle au serveur qui n'est plus là.
    ///
    /// Elle compte ses passages : c'est ce compte, et non le message rendu, qui dit si le registre a
    /// rejoué. Mesurer le rejeu par un effet de bord en base aurait demandé une table d'appoint et
    /// n'aurait rien dit de plus.
    fn qui_se_coupe(
        appels: &std::sync::Arc<std::sync::atomic::AtomicUsize>,
    ) -> impl for<'a> Fn(
        &'a AnyEngine,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<crate::engine::QueryResult, EngineError>>
                + Send
                + 'a,
        >,
    > {
        let appels = std::sync::Arc::clone(appels);
        move |adaptateur| {
            appels.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let limite = crate::engine::RowLimit::OneHundred;
            Box::pin(async move {
                let _ = adaptateur
                    .run_sql("select pg_terminate_backend(pg_backend_pid())", limite)
                    .await;
                adaptateur.run_sql("select 1", limite).await
            })
        }
    }

    /// **Le contrôle négatif** : un échec ordinaire ne ferme rien.
    ///
    /// Sans lui, un registre qui fermerait à *toute* erreur passerait le test précédent — et
    /// perdrait la connexion, tunnel compris, à la première faute de frappe dans la console.
    #[tokio::test]
    async fn une_requete_fautive_laisse_la_connexion_au_registre() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let limite = crate::engine::RowLimit::OneHundred;
        let _ = registre
            .avec(cle, Reprise::Rejouable, move |adaptateur| {
                Box::pin(async move {
                    adaptateur
                        .run_sql("select * from table_qui_n_existe_pas", limite)
                        .await
                })
            })
            .await
            .expect_err("la table n'existe pas");

        assert_eq!(registre.ouvertes().await, 1, "la connexion reste ouverte");
        assert!(
            matches!(registre.etat(cle).await, ConnectionState::Connected { .. }),
            "l'état reste connecté"
        );

        registre.fermer(cle).await;
    }

    #[tokio::test]
    async fn ouvrir_deux_fois_la_meme_base_ne_retente_rien() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("première ouverture");

        let mut cassee = variante();
        cassee.port = 1; // rien n'écoute
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &cassee,
                None,
                &known_hosts(),
            )
            .await
            .expect("la seconde ouverture doit rendre sans rien tenter");

        assert_eq!(registre.ouvertes().await, 1);
        assert!(
            matches!(registre.etat(cle).await, ConnectionState::Connected { .. }),
            "la connexion vivante a été remplacée : {:?}",
            registre.etat(cle).await
        );

        registre.fermer(cle).await;
    }

    #[tokio::test]
    async fn une_base_ouverte_passe_a_connectee_avec_sa_version() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        assert_eq!(registre.etat(cle).await, ConnectionState::Never);
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        match registre.etat(cle).await {
            ConnectionState::Connected { server_version, .. } => {
                assert!(server_version.starts_with("PostgreSQL"), "{server_version}");
            }
            autre => panic!("attendu Connected, obtenu {autre:?}"),
        }

        registre.fermer(cle).await;
    }

    /// **Une base injoignable n'empêche pas les autres de s'ouvrir.** C'est ce qui rend l'arbre
    /// lisible sans réseau : un hôte muet marque sa propre ligne, il ne bloque pas l'écran.
    #[tokio::test]
    async fn une_base_injoignable_n_empeche_pas_les_autres() {
        let registre = ConnectionRegistry::new();

        let mut muette = variante();
        muette.port = 1; // rien n'écoute
        registre
            .ouvrir(
                "Halle/muette/dev",
                crate::config::Engine::PostgreSql,
                &muette,
                None,
                &known_hosts(),
            )
            .await
            .expect_err("un port fermé doit échouer");

        registre
            .ouvrir(
                "Halle/analytics/dev",
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("la base joignable doit s'ouvrir malgré l'échec de l'autre");

        assert!(matches!(
            registre.etat("Halle/muette/dev").await,
            ConnectionState::Offline { .. }
        ));
        assert!(matches!(
            registre.etat("Halle/analytics/dev").await,
            ConnectionState::Connected { .. }
        ));

        registre.fermer("Halle/analytics/dev").await;
    }

    #[tokio::test]
    async fn fermer_retire_la_connexion_et_son_etat() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";

        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");
        registre.fermer(cle).await;

        assert_eq!(registre.ouvertes().await, 0);
        // Et non `Offline` : refermer volontairement n'est pas un échec.
        assert_eq!(registre.etat(cle).await, ConnectionState::Never);
    }

    #[tokio::test]
    async fn une_base_ouverte_repond_a_l_introspection() {
        let registre = ConnectionRegistry::new();
        let cle = "Halle/analytics/dev";
        registre
            .ouvrir(
                cle,
                crate::config::Engine::PostgreSql,
                &variante(),
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect("ouverture");

        let objets = registre
            .avec(cle, Reprise::Rejouable, |adaptateur| {
                Box::pin(async move { adaptateur.objects("introspection").await })
            })
            .await
            .expect("introspection");

        // 4 tables et 1 vue dans le schéma de test, dont la composition est connue.
        // Cinq tables et une vue depuis le 10 août 2026 : `montants` couvre le cas `numeric`.
        // Six tables depuis le 12 août 2026 : `identites` couvre les deux formes d'identité.
        assert_eq!(objets.len(), 7);

        registre.fermer(cle).await;
    }

    /// L'échec d'ouverture porte le message du moteur, qui dit déjà la manœuvre.
    #[tokio::test]
    async fn un_echec_d_ouverture_garde_le_message_du_moteur() {
        let registre = ConnectionRegistry::new();
        let mut inconnue = variante();
        inconnue.default_database = "base_qui_n_existe_pas".into();

        registre
            .ouvrir(
                "Halle/inconnue/dev",
                crate::config::Engine::PostgreSql,
                &inconnue,
                secret().as_ref(),
                &known_hosts(),
            )
            .await
            .expect_err("une base inconnue doit échouer");

        match registre.etat("Halle/inconnue/dev").await {
            ConnectionState::Offline { reason } => {
                assert!(reason.contains("base_qui_n_existe_pas"), "{reason}");
            }
            autre => panic!("attendu Offline, obtenu {autre:?}"),
        }
    }

    /// Qu'aucun mot de passe ne se retrouve dans un état exposé au front.
    ///
    /// Contrôle **positif** compris : la sentinelle traverse bien l'ouverture.
    #[tokio::test]
    async fn aucun_mot_de_passe_dans_les_etats() {
        let sentinelle = "SENTINELLE-registre-42";
        let registre = ConnectionRegistry::new();
        let mut mauvaise = variante();
        mauvaise.username = "utilisateur_inexistant".into();

        registre
            .ouvrir(
                "Halle/mauvaise/dev",
                crate::config::Engine::PostgreSql,
                &mauvaise,
                Some(&Secret::new(sentinelle)),
                &known_hosts(),
            )
            .await
            .expect_err("un utilisateur inexistant doit échouer");

        // Contrôle positif : la sentinelle est bien celle qu'on a passée.
        assert_eq!(Secret::new(sentinelle).expose(), sentinelle);

        let etats = registre.etats().await;
        let rendu = serde_json::to_string(&etats).expect("sérialisation");
        assert!(
            !rendu.contains(sentinelle),
            "un état exposé au front contient le mot de passe : {rendu}"
        );
    }
}
