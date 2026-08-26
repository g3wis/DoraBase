//! Construction de la configuration de connexion et ouverture.

use tokio_postgres::config::SslMode as PgSslMode;
use tokio_postgres::{Client, Config, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::config::{ConnectionSettings, SslMode};
use crate::engine::tls::Exigences;
use crate::engine::EngineError;
use crate::secrets::Secret;

use super::error::traduire;

/// Construit la configuration de connexion depuis une variante d'environnement.
///
/// `redirection` porte le point d'entrée du tunnel quand il y en a un : `06e` ouvre le tunnel
/// puis passe ici l'adresse locale sur laquelle il écoute. **Une variante déclarant un tunnel
/// mais sans redirection est refusée**, pas connectée en direct — se connecter sans le bastion
/// que l'utilisateur a demandé contournerait sa consigne de sécurité, et un `None` oublié à
/// l'appel ne doit pas se traduire par une connexion directe silencieuse.
/// La connexion s'authentifie-t-elle par IAM plutôt que par mot de passe ?
///
/// **C'est-à-dire : passe-t-elle par un proxy Cloud SQL ?** `06k` a d'abord porté un booléen,
/// puis l'a retiré le jour même : le mode est toujours actif, donc la question se réduit à la
/// sorte du proxy. La fonction reste, parce que c'est *elle* qui porte le nom du concept —
/// `preparer` demande « est-on en IAM ? », pas « est-ce du Cloud SQL ? », et le jour où les
/// deux cesseront de coïncider, il n'y aura qu'ici à toucher.
fn authentification_iam(variante: &ConnectionSettings) -> bool {
    matches!(
        variante.tunnel.as_ref().map(|tunnel| &tunnel.proxy),
        Some(crate::config::Proxy::CloudSql(_))
    )
}

pub fn preparer(
    variante: &ConnectionSettings,
    mot_de_passe: Option<&Secret>,
    redirection: Option<(&str, u16)>,
) -> Result<Config, EngineError> {
    let (hote, port) = match (&variante.tunnel, redirection) {
        (Some(_), Some(local)) => local,
        (Some(_), None) => {
            return Err(EngineError::local(
                "cette base est configurée derrière un tunnel SSH, mais aucun tunnel n'a été \
                 ouvert — se connecter en direct contournerait la consigne",
            ));
        }
        // Une redirection fournie sans tunnel configuré est ignorée plutôt que d'être une
        // erreur : c'est le cas d'un appelant qui passe la même valeur partout.
        (None, _) => (variante.host.as_str(), variante.port),
    };

    let mut config = Config::new();
    config
        .host(hote)
        .port(port)
        .dbname(&variante.default_database)
        .user(&variante.username)
        .ssl_mode(traduire_mode_ssl(variante.ssl_mode));

    match mot_de_passe {
        Some(secret) => {
            config.password(secret.expose());
        }
        // **Un mot de passe vide, et non pas d'appel du tout** (`06k`). En authentification
        // IAM, c'est le proxy qui présente le jeton ; le client n'a rien à donner. Mais
        // `tokio-postgres` refuse **côté client**, avant tout échange, quand le serveur
        // réclame un mot de passe et qu'aucun n'a été configuré : l'erreur serait « password
        // authentication required », qui accuse le mot de passe manquant là où c'est
        // exactement le fonctionnement attendu. Une chaîne vide traverse et laisse le serveur
        // trancher — c'est ce que fait `psql`, où l'on valide l'invite sans rien saisir.
        None if authentification_iam(variante) => {
            config.password("");
        }
        None => {}
    }

    // `application_name` apparaît dans `pg_stat_activity` : c'est ce qui permet à un
    // administrateur de reconnaître les connexions de l'outil.
    config.application_name("DoraBase");

    Ok(config)
}

/// Correspondance entre les six modes de `05a` et ceux de `tokio-postgres`.
///
/// **`PgSslMode` ne connaît que trois valeurs** — `Disable`, `Prefer`, `Require` — parce qu'il ne
/// décide que du *transport* : demander TLS ou non. La **vérification**, elle, vit dans la
/// `ClientConfig` de `rustls`, et c'est `06f` qui l'a branchée. Les trois modes du bas donnent donc
/// le même `PgSslMode` et trois configurations différentes.
///
/// **La distinction qui compte** : `Require` chiffre sans authentifier le serveur, donc n'empêche pas
/// un intermédiaire ; `VerifyCa` et `VerifyFull` vérifient le certificat. Les confondre est l'erreur
/// classique, et c'est pourquoi un test de `06b` distingue explicitement une famille de l'autre.
fn traduire_mode_ssl(mode: SslMode) -> PgSslMode {
    match mode {
        SslMode::Disable => PgSslMode::Disable,
        // `tokio-postgres` ne distingue pas `allow` de `prefer` : les deux tentent TLS et
        // acceptent le clair en repli. L'écart avec `libpq`, qui essaie le clair d'abord en
        // `allow`, est sans conséquence observable pour cet outil.
        SslMode::Allow | SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => PgSslMode::Require,
    }
}

/// Ouvre une connexion, **TLS compris** (`06f`).
///
/// La réserve de `06b` — « le TLS n'est pas encore branché », `NoTls` en dur — est levée. Le choix de
/// `rustls` est tranché dans `06f`, sur deux faits vérifiés dans les pilotes : celui de MongoDB
/// n'offre pas `native-tls`, et ni lui ni `mysql_async` n'acceptent de `ClientConfig`. Le trousseau du
/// système n'étant atteignable nulle part uniformément, l'argument qui militait pour `native-tls`
/// tombait — et `rustls` donne en échange un seul comportement sur macOS et en CI Linux.
pub async fn ouvrir(
    config: &Config,
    exigences: Exigences,
    ca: Option<&str>,
) -> Result<Client, EngineError> {
    // **Le seul pilote des trois qui accepte une `ClientConfig`** : c'est donc le seul où les trois
    // modes de vérification s'expriment exactement, sans passer par des drapeaux (`06f`).
    //
    // `Disable` court-circuite : construire une configuration TLS pour ne pas s'en servir chargerait
    // les racines publiques pour rien, et échouerait sur un fichier CA mal déclaré alors que personne
    // n'a demandé de chiffrement.
    if !exigences.chiffre() {
        return ouvrir_avec(config, NoTls).await;
    }
    let configuration = crate::engine::tls::configuration(exigences, ca)?;
    ouvrir_avec(config, MakeRustlsConnect::new(configuration)).await
}

async fn ouvrir_avec<T>(config: &Config, tls: T) -> Result<Client, EngineError>
where
    T: tokio_postgres::tls::MakeTlsConnect<tokio_postgres::Socket> + Send + 'static,
    T::Stream: Send + 'static,
    T::TlsConnect: Send,
    <T::TlsConnect as tokio_postgres::tls::TlsConnect<tokio_postgres::Socket>>::Future: Send,
{
    let (client, connexion) = config.connect(tls).await.map_err(|e| traduire(&e))?;

    // `tokio-postgres` sépare le client de la boucle d'entrées-sorties : sans cette tâche,
    // aucune requête n'avancerait. Elle s'arrête quand le client est libéré.
    tokio::spawn(async move {
        if let Err(erreur) = connexion.await {
            log::debug!("connexion PostgreSQL terminée : {erreur}");
        }
    });

    Ok(client)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Proxy, ProxySsh, Tunnel};

    fn variante() -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".into(),
            port: 5432,
            default_database: "dorabase_test".into(),
            username: "dorabase".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
            ca_certificate: None,
            auth_database: None,
            read_only: false,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    /// Une connexion derrière un proxy Cloud SQL en authentification IAM.
    fn avec_iam() -> ConnectionSettings {
        let mut variante = variante();
        // L'utilisateur **est** un principal IAM : une adresse, pas un rôle à mot de passe.
        variante.username = "analytics@exemple-invente.test".into();
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::CloudSql(crate::config::ProxyCloudSql {
                instance_connection_name: "acme-prod:europe-west1:analytics".into(),
            }),
        });
        variante
    }

    #[test]
    fn en_authentification_iam_un_mot_de_passe_vide_est_configure() {
        // **Le défaut évité** (`06k`) : sans mot de passe du tout, `tokio-postgres` refuse
        // côté client dès que le serveur en réclame un — « password authentication required »
        // —, alors que ne rien avoir à donner est précisément le fonctionnement attendu.
        let config = preparer(&avec_iam(), None, Some(("127.0.0.1", 6543))).expect("préparation");
        assert_eq!(config.get_password(), Some(&b""[..]));
    }

    #[test]
    fn sans_authentification_iam_aucun_mot_de_passe_n_est_invente() {
        // L'autre moitié : une connexion ordinaire sans secret ne doit pas se voir attribuer
        // un mot de passe vide, qui transformerait « aucun secret enregistré » en « secret
        // vide refusé par le serveur ».
        let config = preparer(&variante(), None, None).expect("préparation");
        assert_eq!(config.get_password(), None);

        // Un tunnel SSH n'est pas de l'IAM : la cible derrière le bastion est une base
        // ordinaire, avec son rôle et son mot de passe.
        let config =
            preparer(&avec_tunnel(), None, Some(("127.0.0.1", 6543))).expect("préparation");
        assert_eq!(config.get_password(), None);
    }

    #[test]
    fn un_secret_enregistre_gagne_meme_en_authentification_iam() {
        // Le mot de passe vide est un **repli**, pas une règle : un utilisateur qui a
        // enregistré un secret l'a fait pour une raison, et l'écraser serait décider à sa
        // place.
        let secret = Secret::new("garde-moi".to_owned());
        let config =
            preparer(&avec_iam(), Some(&secret), Some(("127.0.0.1", 6543))).expect("préparation");
        assert_eq!(config.get_password(), Some(&b"garde-moi"[..]));
    }

    fn avec_tunnel() -> ConnectionSettings {
        let mut variante = variante();
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.exemple.net".into(),
                bastion_port: 22,
                username: "clement".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        variante
    }

    #[test]
    fn une_variante_simple_se_prepare() {
        assert!(preparer(&variante(), None, None).is_ok());
    }

    /// Le garde-fou de `06e` : un tunnel configuré sans tunnel ouvert ne se rabat **pas** sur
    /// une connexion directe. C'est le défaut le plus tentant de ce branchement — il
    /// « marcherait » sur un réseau où la base est joignable en direct, et contournerait
    /// silencieusement la consigne partout ailleurs.
    #[test]
    fn un_tunnel_configure_sans_tunnel_ouvert_est_refuse() {
        let erreur =
            preparer(&avec_tunnel(), None, None).expect_err("l'absence de tunnel doit être vue");
        assert!(erreur.message.contains("tunnel"), "{erreur}");
        assert!(erreur.code.is_none(), "échec local, donc sans SQLSTATE");
    }

    /// Et quand le tunnel est ouvert, c'est **son** point d'entrée qui est visé, pas l'hôte
    /// de la base — sinon le tunnel serait ouvert pour rien.
    #[test]
    fn un_tunnel_ouvert_redirige_la_connexion_vers_le_port_local() {
        let config = preparer(&avec_tunnel(), None, Some(("127.0.0.1", 63342)))
            .expect("la redirection doit être acceptée");

        assert_eq!(
            config.get_ports(),
            [63342],
            "le port doit être celui du tunnel"
        );
        assert!(
            !format!("{:?}", config.get_hosts()).contains("localhost"),
            "l'hôte de la base ne doit plus apparaître : {:?}",
            config.get_hosts()
        );
    }

    /// La base visée reste celle de la configuration : le tunnel change l'adresse, pas la
    /// cible logique.
    #[test]
    fn une_redirection_ne_change_ni_la_base_ni_l_utilisateur() {
        let config =
            preparer(&avec_tunnel(), None, Some(("127.0.0.1", 63342))).expect("préparation");
        assert_eq!(config.get_dbname(), Some("dorabase_test"));
        assert_eq!(config.get_user(), Some("dorabase"));
    }

    /// Une redirection passée alors qu'aucun tunnel n'est configuré ne doit pas détourner la
    /// connexion : sinon un appelant qui transmet la même valeur partout casserait les
    /// variantes directes.
    #[test]
    fn une_redirection_sans_tunnel_configure_est_ignoree() {
        let config = preparer(&variante(), None, Some(("127.0.0.1", 63342))).expect("préparation");
        assert_eq!(config.get_ports(), [5432]);
    }

    #[test]
    fn les_six_modes_ssl_sont_acceptes() {
        for mode in [
            SslMode::Disable,
            SslMode::Allow,
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyCa,
            SslMode::VerifyFull,
        ] {
            let mut v = variante();
            v.ssl_mode = mode;
            assert!(preparer(&v, None, None).is_ok(), "{mode:?} refusé");
        }
    }

    #[test]
    fn les_modes_verifiants_et_require_exigent_tous_le_chiffrement() {
        // Ils partagent `Require` côté `tokio-postgres` ; la *vérification* du certificat
        // se règle ailleurs, par le fournisseur TLS. C'est précisément pourquoi la tâche
        // SSL du plan reste à faire : sans elle, `verify-full` ne vérifie rien.
        assert_eq!(traduire_mode_ssl(SslMode::Require), PgSslMode::Require);
        assert_eq!(traduire_mode_ssl(SslMode::VerifyCa), PgSslMode::Require);
        assert_eq!(traduire_mode_ssl(SslMode::VerifyFull), PgSslMode::Require);
    }

    #[test]
    fn desactiver_le_chiffrement_se_traduit_fidelement() {
        assert_eq!(traduire_mode_ssl(SslMode::Disable), PgSslMode::Disable);
    }

    #[test]
    fn le_mot_de_passe_n_est_pas_requis() {
        // Une base sans mot de passe existe — SQLite sur fichier, ou une confiance locale.
        assert!(preparer(&variante(), None, None).is_ok());
        assert!(preparer(&variante(), Some(&Secret::new("s3cr3t")), None).is_ok());
    }
}
