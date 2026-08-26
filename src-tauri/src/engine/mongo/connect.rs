//! Construction de l'URI et ouverture de la connexion MongoDB (`18b`).

use std::time::Duration;

use mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};
use mongodb::Client;

use crate::config::ConnectionSettings;
use crate::engine::tls::{Chiffrement, Exigences};
use crate::engine::EngineError;
use crate::secrets::Secret;

use super::error::traduire;

/// Le genre de déploiement, constaté à la connexion.
///
/// **`18f` en dépend** : sans jeu de réplicas, MongoDB ne sait pas ouvrir de transaction, donc la
/// promesse « tout ou rien » de `06a` est intenable. Le constater à l'ouverture permet de le dire
/// avant qu'on édite une cellule, plutôt qu'au moment d'appliquer — la logique de « lecture seule »
/// de `05a`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Deploiement {
    /// Un `mongod` seul. **Pas de transaction.**
    Isole,
    /// Un jeu de réplicas, ou un cluster fragmenté : les transactions sont disponibles.
    Transactionnel,
}

impl Deploiement {
    pub fn transactions_possibles(self) -> bool {
        matches!(self, Self::Transactionnel)
    }
}

/// Les options de connexion, depuis une variante d'environnement.
///
/// `redirection` porte le point d'entrée du tunnel, comme en `06b`, et le refus d'une variante
/// déclarant un tunnel sans redirection est **le même** : se connecter en direct contournerait la
/// consigne de sécurité de l'utilisateur.
pub fn preparer(
    variante: &ConnectionSettings,
    mot_de_passe: Option<&Secret>,
    redirection: Option<(&str, u16)>,
) -> Result<ClientOptions, EngineError> {
    let (hote, port) = match (&variante.tunnel, redirection) {
        (Some(_), Some(local)) => local,
        (Some(_), None) => {
            return Err(EngineError::local(
                "cette base est configurée derrière un tunnel SSH, mais aucun tunnel n'a été \
                 ouvert — se connecter en direct contournerait la consigne",
            ));
        }
        (None, _) => (variante.host.as_str(), variante.port),
    };

    let mut options = ClientOptions::default();
    options.hosts = vec![ServerAddress::Tcp {
        host: hote.to_owned(),
        port: Some(port),
    }];

    // **`direct_connection` est vrai, et ce n'est pas un détail de confort.**
    //
    // Un pilote qui découvre un jeu de réplicas reçoit la liste de ses membres avec leurs noms
    // d'hôte *tels que le cluster les connaît*. Derrière un tunnel SSH, ces noms ne résolvent pas
    // depuis la machine de l'utilisateur : la connexion s'ouvre, puis se perd. Désactiver la
    // découverte coûte le basculement automatique, ce qui est sans conséquence pour un outil de
    // lecture — et c'est le prix d'une connexion qui tient. Voir `18b`.
    options.direct_connection = Some(true);

    if let Some(secret) = mot_de_passe {
        options.credential = Some(
            Credential::builder()
                .username(variante.username.clone())
                // **La base déclarée par défaut, et jamais `admin` d'office.** Un utilisateur
                // MongoDB appartient à une base ; supposer `admin` ferait échouer tous ceux qui
                // sont déclarés dans la leur, avec un message d'authentification refusée qui
                // n'aiderait personne. C'est la décision de `18b`, et elle tient.
                //
                // **Ce qui manquait était le cas inverse, et il n'avait aucune issue.** L'utilisateur
                // racine que l'image Docker officielle crée vit dans `admin` ; ouvrir la base `test`
                // le rendait injoignable — « SCRAM failure: Authentication failed », sans rien à
                // corriger dans le formulaire. `auth_database` le rend atteignable **sans** changer
                // le défaut : renseigné, il fait foi ; vide, rien ne bouge.
                .source(
                    variante
                        .auth_database
                        .clone()
                        .filter(|base| !base.trim().is_empty())
                        .unwrap_or_else(|| variante.default_database.clone()),
                )
                .password(secret.expose().to_owned())
                .build(),
        );
    } else if !variante.username.is_empty() {
        // Un utilisateur sans mot de passe : le pilote n'enverrait aucun mécanisme
        // d'authentification, et le serveur refuserait avec « command requires authentication ».
        // Le dire ici est plus utile.
        return Err(EngineError::local(
            "un utilisateur est déclaré mais aucun mot de passe n'a été trouvé au Trousseau — la \
             connexion serait refusée par le serveur",
        ));
    }

    // **Cinq secondes, pas les trente par défaut.** Le pilote attend trente secondes avant de
    // conclure qu'aucun serveur ne répond ; le test de connexion de `A2` est un geste interactif,
    // et une modale qui ne répond pas pendant une demi-minute se lit comme un blocage.
    options.server_selection_timeout = Some(Duration::from_secs(5));
    options.connect_timeout = Some(Duration::from_secs(5));

    // **Le TLS de `06f`.** Comme `mysql_async`, le pilote MongoDB n'accepte pas de `ClientConfig` :
    // sa surface est un chemin de CA et deux drapeaux. C'est le second des deux faits qui ont décidé
    // du choix de `rustls` — voir `06f`.
    let exigences = Exigences::de(variante.ssl_mode);
    // **`allow` et `prefer` ne sont pas exprimables ici, et le refus remplace une promotion
    // silencieuse.** Ces deux modes veulent dire « TLS si le serveur l'offre, clair en repli » —
    // une négociation *dans le protocole*, que seul PostgreSQL a (`PgSslMode::Prefer`, qui replie
    // vraiment). Le pilote MongoDB ne reçoit qu'un drapeau : TLS ou rien. Le code ne
    // testait que `chiffre()`, donc les deux modes devenaient `require` sans que personne le
    // sache — et contre un serveur sans TLS, l'échec arrivait après cinq secondes sous la forme
    // « aucun serveur n'a répondu : vérifiez l'hôte, le port », qui accuse ce qui va bien.
    // Mesuré le 26 août 2026.
    //
    // C'est le même refus que pour `verify-ca` juste en dessous, pour la même raison : un réglage
    // remplacé en silence fait croire à un comportement qui n'a pas lieu. L'écran n'offre plus ces
    // deux modes pour ce moteur (`SSL_MODES_PAR_MOTEUR`) ; ce refus est ce qui tient quand la
    // configuration ne vient **pas** de l'écran — un fichier écrit à la main, ou enregistré par une
    // version antérieure.
    if matches!(exigences.chiffrement, Chiffrement::SiPossible) {
        return Err(EngineError::local(
            "le pilote MongoDB ne sait pas négocier le TLS : « allow » et « prefer » — chiffrer si \
             le serveur l'offre, en clair sinon — n'y sont pas disponibles. Employez « disable » \
             pour une connexion en clair, ou « require » pour exiger le chiffrement",
        ));
    }

    if exigences.chiffre() {
        let mut tls = TlsOptions::default();
        if let Some(ca) = variante.ca_certificate.as_deref() {
            tls.ca_file_path = Some(std::path::PathBuf::from(crate::engine::tls::chemin_absolu(
                ca,
            )));
        }
        // `require` : chiffre sans authentifier — un mode que `05a` propose, et que `A2` **dit** en
        // gardant la mention « TLS non vérifié ».
        if !exigences.verifie_la_chaine {
            tls.allow_invalid_certificates = Some(true);
        }
        // **`verify-ca` n'est pas exprimable ici, et c'est un coût du choix de `rustls`.**
        //
        // Le champ `allow_invalid_hostnames` du pilote n'existe **qu'avec la feature `openssl-tls`** :
        // en `rustls`, vérifier la chaîne implique de vérifier le nom. Il y avait trois réponses
        // possibles, et deux étaient mauvaises :
        //
        // - traiter `verify-ca` comme `verify-full` — plus strict que demandé, donc « sûr », mais
        //   **silencieusement différent** : l'utilisateur a choisi `verify-ca` précisément parce que le
        //   nom de son certificat ne correspond pas, et il lirait un échec de nom d'hôte sans
        //   comprendre pourquoi son réglage est ignoré ;
        // - traiter `verify-ca` comme `require` — moins strict que demandé, donc un cadenas qui ne
        //   protège rien. Inacceptable.
        //
        // Reste le refus, qui **nomme les deux voies** : c'est la règle du projet — un refus qui dit la
        // manœuvre vaut mieux qu'une différence tue.
        if exigences.verifie_la_chaine && !exigences.verifie_le_nom {
            return Err(EngineError::local(
                "le pilote MongoDB ne sait pas vérifier une chaîne de certificats sans vérifier le \
                 nom d'hôte : « verify-ca » n'est pas disponible pour ce moteur. Employez \
                 « verify-full » si le certificat porte le nom du serveur, ou « require » pour \
                 chiffrer sans authentifier",
            ));
        }
        options.tls = Some(Tls::Enabled(tls));
    }

    // `app_name` apparaît dans `db.currentOp()` et les journaux du serveur : c'est ce qui permet à
    // un administrateur de reconnaître les connexions de l'outil. Même raison qu'`application_name`
    // en `06b`.
    options.app_name = Some("DoraBase".to_owned());

    Ok(options)
}

/// Ouvre le client, et constate le genre de déploiement.
///
/// Le client du pilote est **paresseux** : `with_options` n'ouvre aucun socket. La première commande
/// est ce qui connecte, donc c'est `hello` — qui sert de toute façon à lire le déploiement — qui
/// vérifie que la connexion tient.
pub async fn ouvrir(options: ClientOptions) -> Result<(Client, Deploiement), EngineError> {
    // **Retenu avant de céder les options**, pour qualifier l'échec plus bas.
    let tls_exige = options.tls.is_some();
    let client = Client::with_options(options).map_err(|e| traduire(&e))?;
    let deploiement = lire_le_deploiement(&client)
        .await
        .map_err(|erreur| qualifier_le_tls(erreur, tls_exige))?;
    Ok((client, deploiement))
}

/// Nomme le TLS quand c'est lui, le plus probablement, qui a fait taire le serveur.
///
/// **Le message du pilote accuse ce qui va bien.** Un `mongod` sans TLS à qui l'on parle en TLS ne
/// répond rien d'exploitable : le pilote épuise sa sélection de serveur — cinq secondes — et rend
/// « aucun serveur n'a répondu : vérifiez l'hôte, le port, et que le service écoute ». L'hôte, le
/// port et le service sont pourtant exacts, et on part vérifier un pare-feu.
///
/// La qualification reste **prudente** : un hôte réellement injoignable produit la même erreur, donc
/// la phrase ajoute une piste sans retirer la première. C'est la règle de `06e` appliquée au TLS
/// plutôt qu'au tunnel — un message qui distingue deux causes vaut mieux qu'un message qui en
/// affirme une.
fn qualifier_le_tls(erreur: EngineError, tls_exige: bool) -> EngineError {
    if !tls_exige || !erreur.message.contains("aucun serveur MongoDB n'a répondu") {
        return erreur;
    }
    EngineError::local(format!(
        "{} — ou que le serveur accepte bien le TLS, que le mode SSL choisi exige (un serveur sans \
         TLS ne répond pas à une poignée de main chiffrée, et le pilote conclut à un serveur muet)",
        erreur.message
    ))
}

/// `hello`, dont trois champs suffisent à distinguer les trois déploiements.
///
/// - `setName` : présent sur un membre de jeu de réplicas.
/// - `msg: "isdbgrid"` : la réponse d'un `mongos`, donc d'un cluster fragmenté.
/// - ni l'un ni l'autre : un `mongod` isolé.
///
/// **Lire `hello` plutôt que d'essayer une transaction** : la seconde approche écrirait pour savoir
/// si elle peut écrire.
async fn lire_le_deploiement(client: &Client) -> Result<Deploiement, EngineError> {
    let reponse = client
        .database("admin")
        .run_command(mongodb::bson::doc! { "hello": 1 })
        .await
        .map_err(|e| traduire(&e))?;

    let jeu_de_replicas = reponse.contains_key("setName");
    let fragmente = reponse
        .get_str("msg")
        .map(|m| m == "isdbgrid")
        .unwrap_or(false);

    Ok(if jeu_de_replicas || fragmente {
        Deploiement::Transactionnel
    } else {
        Deploiement::Isole
    })
}

/// La version du serveur, pour le test de connexion de `A2` : « Connecté en 240 ms · MongoDB 8.0 ».
pub async fn version_du_serveur(client: &Client) -> Result<String, EngineError> {
    let reponse = client
        .database("admin")
        .run_command(mongodb::bson::doc! { "buildInfo": 1 })
        .await
        .map_err(|e| traduire(&e))?;
    let version = reponse.get_str("version").unwrap_or("version inconnue");
    Ok(format!("MongoDB {version}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Proxy, ProxySsh, SslMode, Tunnel};

    fn variante() -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".into(),
            port: 27017,
            default_database: "atelier_ventes".into(),
            username: String::new(),
            password: None,
            // **`disable`, et non `prefer`.** Ces variantes servent à mesurer l'hôte, le port et
            // les identifiants, pas le TLS — et `prefer` n'est plus exprimable par ce pilote, donc
            // le décor refusait avant d'avoir rien préparé. Que le fixture ait porté `prefer` est
            // ce qui montrait la promotion silencieuse : le mode ne changeait rien, donc rien ne
            // disait qu'il n'était pas honoré.
            ssl_mode: SslMode::Disable,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    #[test]
    fn une_variante_sans_authentification_se_prepare() {
        let options = preparer(&variante(), None, None).expect("préparable");
        assert_eq!(
            options.hosts,
            vec![ServerAddress::Tcp {
                host: "localhost".into(),
                port: Some(27017)
            }]
        );
        assert_eq!(options.direct_connection, Some(true));
    }

    /// **`allow` et `prefer` sont refusés, non promus.**
    ///
    /// Le contrôle qui manquait : le pilote ne sait pas négocier le TLS, et le code se contentait
    /// de `chiffre()` — donc les deux modes devenaient `require` sans rien dire. Aucun test ne
    /// pouvait tomber, puisque rien n'observait le mode : les préparations réussissaient et les
    /// tests sur base réelle employaient `disable`.
    ///
    /// Le message doit **nommer les deux voies** : sans elles, un utilisateur lit « pas
    /// disponible » et n'a aucun geste à faire.
    /// **Le TLS est nommé quand le serveur se tait.** Contrôle du piège de `qualifier_le_tls` : sans
    /// lui, le message envoie vérifier l'hôte et le port d'un serveur qui écoute très bien.
    #[test]
    fn un_serveur_muet_en_tls_voit_le_tls_nomme() {
        let brut = EngineError::local(
            "aucun serveur MongoDB n'a répondu : Server selection timeout. Vérifiez l'hôte, le \
             port, et que le service écoute",
        );
        let qualifie = qualifier_le_tls(brut, true);
        assert!(qualifie.message.contains("accepte bien le TLS"), "{}", qualifie.message);
        // La première piste reste : un hôte réellement injoignable donne la même erreur.
        assert!(qualifie.message.contains("Vérifiez l'hôte"), "{}", qualifie.message);
    }

    #[test]
    fn sans_tls_le_message_du_pilote_passe_intact() {
        // Contrôle négatif : sinon la phrase s'ajouterait à un échec en clair, où elle serait fausse.
        let brut = EngineError::local("aucun serveur MongoDB n'a répondu : Server selection timeout");
        assert_eq!(qualifier_le_tls(brut.clone(), false).message, brut.message);
    }

    #[test]
    fn une_autre_erreur_n_est_pas_qualifiee() {
        // Une authentification refusée en TLS n'a rien à voir avec le TLS : le serveur a répondu.
        let brut = EngineError::local("authentification refusée : SCRAM failure");
        assert_eq!(qualifier_le_tls(brut.clone(), true).message, brut.message);
    }

    /// **La base d'authentification renseignée fait foi, sans toucher au défaut.**
    ///
    /// Le cas qui n'avait aucune issue : l'utilisateur racine d'un conteneur `mongo` officiel vit
    /// dans `admin`, et ouvrir la base `test` le rendait injoignable. Mesuré le 26 août 2026 —
    /// « SCRAM failure: Authentication failed », sur un formulaire où rien n'était faux.
    #[test]
    fn la_base_d_authentification_renseignee_remplace_la_base_declaree() {
        let mut v = variante();
        v.default_database = "atelier_ventes".into();
        v.auth_database = Some("admin".into());
        let options = preparer(&v, Some(&Secret::new("mdp")), None).expect("préparable");
        let credential = options.credential.expect("un secret, donc un credential");
        assert_eq!(credential.source.as_deref(), Some("admin"));
    }

    /// Contrôle négatif : sans valeur, la décision de `18b` s'applique toujours.
    #[test]
    fn sans_base_d_authentification_la_base_declaree_fait_foi() {
        let mut v = variante();
        v.default_database = "atelier_ventes".into();
        assert_eq!(v.auth_database, None);
        let options = preparer(&v, Some(&Secret::new("mdp")), None).expect("préparable");
        let credential = options.credential.expect("un secret, donc un credential");
        assert_eq!(credential.source.as_deref(), Some("atelier_ventes"));
    }

    /// Un champ **laissé vide** n'est pas une base nommée « ».
    ///
    /// L'écran envoie `null` pour un champ vide, mais un fichier écrit à la main peut porter `""` —
    /// et `.source("")` ferait échouer l'authentification sur une base qui n'existe pas, avec le
    /// message le moins utile possible.
    #[test]
    fn une_base_d_authentification_vide_vaut_absente() {
        let mut v = variante();
        v.default_database = "atelier_ventes".into();
        v.auth_database = Some("   ".into());
        let options = preparer(&v, Some(&Secret::new("mdp")), None).expect("préparable");
        let credential = options.credential.expect("un secret, donc un credential");
        assert_eq!(credential.source.as_deref(), Some("atelier_ventes"));
    }

    #[test]
    fn allow_et_prefer_sont_refuses_avec_la_manoeuvre() {
        for mode in [SslMode::Allow, SslMode::Prefer] {
            let mut v = variante();
            v.ssl_mode = mode;
            let erreur = preparer(&v, None, None).expect_err("ce mode n'est pas exprimable");
            assert!(erreur.message.contains("négocier le TLS"), "{}", erreur.message);
            assert!(erreur.message.contains("disable"), "{}", erreur.message);
            assert!(erreur.message.contains("require"), "{}", erreur.message);
        }
    }

    /// Contrôle négatif du précédent : les trois modes que ce pilote **sait** exprimer passent.
    ///
    /// Sans lui, on satisfait le test ci-dessus en refusant tout mode chiffré, ce qui serait une
    /// régression bien pire que la promotion qu'on retire.
    #[test]
    fn les_trois_modes_offerts_se_preparent() {
        for mode in [SslMode::Disable, SslMode::Require, SslMode::VerifyFull] {
            let mut v = variante();
            v.ssl_mode = mode;
            preparer(&v, None, None).unwrap_or_else(|e| panic!("{mode:?} doit passer : {e}"));
        }
    }

    #[test]
    fn un_tunnel_declare_sans_redirection_est_refuse() {
        let mut avec_tunnel = variante();
        avec_tunnel.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.exemple.test".into(),
                bastion_port: 22,
                username: "clement".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        // **Le même refus qu'en `06b`**, pour la même raison : un `None` oublié à l'appel ne doit
        // pas se traduire par une connexion directe silencieuse.
        let erreur = preparer(&avec_tunnel, None, None).expect_err("doit refuser");
        assert!(erreur.message.contains("tunnel"), "{}", erreur.message);
    }

    #[test]
    fn la_redirection_du_tunnel_remplace_l_hote_declare() {
        let mut avec_tunnel = variante();
        avec_tunnel.host = "db.interne.test".into();
        avec_tunnel.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.exemple.test".into(),
                bastion_port: 22,
                username: "clement".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        let options = preparer(&avec_tunnel, None, Some(("127.0.0.1", 63342))).expect("préparable");
        assert_eq!(
            options.hosts,
            vec![ServerAddress::Tcp {
                host: "127.0.0.1".into(),
                port: Some(63342)
            }],
            "l'hôte déclaré ne doit pas être visé quand un tunnel est ouvert"
        );
    }

    #[test]
    fn un_utilisateur_sans_mot_de_passe_est_refuse_avant_la_connexion() {
        let mut avec_utilisateur = variante();
        avec_utilisateur.username = "philomene".into();
        let erreur = preparer(&avec_utilisateur, None, None).expect_err("doit refuser");
        assert!(erreur.message.contains("Trousseau"), "{}", erreur.message);
    }

    #[test]
    fn la_base_d_authentification_est_celle_declaree_pas_admin() {
        let mut avec_utilisateur = variante();
        avec_utilisateur.username = "philomene".into();
        let secret = Secret::new("tr3s-secret");
        let options = preparer(&avec_utilisateur, Some(&secret), None).expect("préparable");
        let credential = options.credential.expect("un identifiant");
        assert_eq!(credential.source.as_deref(), Some("atelier_ventes"));
        assert_eq!(credential.username.as_deref(), Some("philomene"));
    }

    #[test]
    fn le_delai_de_selection_est_court_car_a2_est_interactif() {
        let options = preparer(&variante(), None, None).expect("préparable");
        // Trente secondes par défaut : une modale qui ne répond pas pendant une demi-minute se lit
        // comme un blocage, pas comme une attente.
        assert_eq!(
            options.server_selection_timeout,
            Some(Duration::from_secs(5))
        );
    }

    #[test]
    fn les_transactions_ne_sont_possibles_que_hors_deploiement_isole() {
        assert!(!Deploiement::Isole.transactions_possibles());
        assert!(Deploiement::Transactionnel.transactions_possibles());
    }
}
