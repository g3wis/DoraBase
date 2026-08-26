//! La connexion MySQL / MariaDB (`16a`).

use std::time::Duration;

use mysql_async::{Opts, OptsBuilder, Pool, SslOpts};

use crate::config::ConnectionSettings;
use crate::engine::tls::{Chiffrement, Exigences};
use crate::engine::EngineError;
use crate::secrets::Secret;

use super::error::traduire;

/// Les options de connexion, depuis une variante d'environnement.
///
/// `redirection` porte le point d'entrée du tunnel, comme en `06b` et `18b`, et le refus d'une
/// variante déclarant un tunnel sans redirection est **le même** : se connecter en direct
/// contournerait la consigne de sécurité de l'utilisateur.
pub fn preparer(
    variante: &ConnectionSettings,
    mot_de_passe: Option<&Secret>,
    redirection: Option<(&str, u16)>,
) -> Result<Opts, EngineError> {
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

    let mut options = OptsBuilder::default()
        .ip_or_hostname(hote.to_owned())
        .tcp_port(port)
        .user(Some(variante.username.clone()))
        .db_name(Some(variante.default_database.clone()))
        // **Le fuseau de session est forcé à UTC**, et ce n'est pas un détail.
        //
        // MySQL rend un `DATETIME` sans fuseau et un `TIMESTAMP` **converti dans le fuseau de la
        // session** : deux clients réglés différemment lisent des valeurs différentes de la même
        // ligne. Un explorateur de bases ne peut pas afficher une valeur qui dépend de qui regarde.
        //
        // `sql_mode` est fixé au passage : `ANSI_QUOTES` change la règle de citation, et `16c` cite
        // au backtick. Le laisser au réglage du serveur ferait dépendre notre SQL d'une variable
        // qu'un administrateur peut changer.
        .init(vec![
            "SET time_zone = '+00:00'".to_owned(),
            "SET SESSION sql_mode = 'STRICT_ALL_TABLES'".to_owned(),
        ])
        // `program_name` apparaît dans `performance_schema.session_connect_attrs` : c'est ce qui
        // permet à un administrateur de reconnaître les connexions de l'outil. Même raison
        // qu'`application_name` en `06b`.
        .conn_ttl(Some(Duration::from_secs(600)));

    if let Some(secret) = mot_de_passe {
        options = options.pass(Some(secret.expose().to_owned()));
    }

    // **Le TLS de `06f`.** `mysql_async` n'accepte pas de `ClientConfig` : sa surface est un chemin de
    // CA et des drapeaux, et c'est précisément ce qui a décidé du choix de `rustls` — voir `06f`. Les
    // exigences sont donc traduites en drapeaux, un par un.
    let exigences = Exigences::de(variante.ssl_mode);
    // **`allow` et `prefer` ne sont pas exprimables ici, et le refus remplace une promotion
    // silencieuse.** Ces deux modes veulent dire « TLS si le serveur l'offre, clair en repli » —
    // une négociation *dans le protocole*, que seul PostgreSQL a (`PgSslMode::Prefer`, qui replie
    // vraiment). `mysql_async` ne reçoit qu'un `SslOpts` : TLS ou rien — le serveur qui n'annonce
    // pas `CLIENT_SSL` fait échouer la connexion, il ne la laisse pas passer en clair. Le code ne
    // testait que `chiffre()`, donc les deux modes devenaient `require` sans que personne le
    // sache. **Le symptôme n'a été mesuré que pour MongoDB** (le 26 août 2026 : cinq secondes
    // d'attente puis « vérifiez l'hôte, le port », qui accuse ce qui va bien) ; ici le pilote est
    // seulement lu, pas observé contre un serveur sans TLS. Ce qui est certain est la substitution,
    // qui se lit dans le code ; ce qui reste à voir est le message qu'elle produit.
    //
    // C'est le même refus que pour `verify-ca` juste en dessous, pour la même raison : un réglage
    // remplacé en silence fait croire à un comportement qui n'a pas lieu. L'écran n'offre plus ces
    // deux modes pour ce moteur (`SSL_MODES_PAR_MOTEUR`) ; ce refus est ce qui tient quand la
    // configuration ne vient **pas** de l'écran — un fichier écrit à la main, ou enregistré par une
    // version antérieure.
    if matches!(exigences.chiffrement, Chiffrement::SiPossible) {
        return Err(EngineError::local(
            "le pilote MySQL ne sait pas négocier le TLS : « allow » et « prefer » — chiffrer si \
             le serveur l'offre, en clair sinon — n'y sont pas disponibles. Employez « disable » \
             pour une connexion en clair, ou « require » pour exiger le chiffrement",
        ));
    }

    if exigences.chiffre() {
        let mut ssl = SslOpts::default();
        if let Some(ca) = variante.ca_certificate.as_deref() {
            // **Le fichier est validé ici, avant de se connecter.** Le pilote le lit à
            // l'établissement de la connexion et rend une erreur d'entrée-sortie qui ne cite pas le
            // chemin : on chercherait du côté du serveur. `racines` échoue en nommant le fichier et en
            // distinguant « absent » de « pas un certificat » — voir `tls.rs`.
            crate::engine::tls::racines(Some(ca))?;
            // `PathOrBuf` n'est pas réexporté par la crate : le type se déduit de la signature, et
            // `.into()` suffit. Le nommer demanderait un chemin de module privé.
            ssl = ssl.with_root_certs(vec![std::path::PathBuf::from(
                crate::engine::tls::chemin_absolu(ca),
            )
            .into()]);
        }
        // `require` : chiffre sans authentifier. Ce n'est pas un défaut mais un mode que `05a`
        // propose, et que des serveurs internes imposent faute d'autorité déclarable. `A2` le **dit**
        // — la mention « TLS non vérifié » reste affichée pour ce mode, parce qu'elle est vraie.
        if !exigences.verifie_la_chaine {
            ssl = ssl.with_danger_accept_invalid_certs(true);
        }
        // **`verify-ca` n'est pas exprimable ici — et c'est un défaut du pilote, pas une limite du
        // protocole.**
        //
        // `SslOpts::with_danger_skip_domain_validation` existe, et il est **silencieusement sans
        // effet** avec `rustls` 0.23. Le vérificateur du pilote écrit :
        //
        // ```rust
        // Err(ref e) if e.to_string().contains("NotValidForName") && self.skip_domain_validation
        // ```
        //
        // Il compare l'**affichage** de l'erreur au mot `NotValidForName`, qui est la forme `Debug` de
        // la variante. L'affichage de `rustls` 0.23 dit « certificate not valid for name "localhost" » :
        // le mot n'y est pas, le bras ne se déclenche jamais, et le drapeau ne fait rien. Constaté en
        // lisant `io/tls/rustls_io.rs` après qu'un test l'a montré.
        //
        // C'est exactement l'erreur que le vérificateur de `tls.rs` évite en filtrant sur la
        // **variante** et non sur la chaîne — et c'est pourquoi `verify-ca` fonctionne pour PostgreSQL,
        // seul pilote des trois à accepter une `ClientConfig`.
        //
        // Le refus **nomme les deux voies**, comme pour MongoDB : un réglage silencieusement ignoré
        // aurait fait croire à une vérification qui n'aurait pas eu lieu.
        if exigences.verifie_la_chaine && !exigences.verifie_le_nom {
            return Err(EngineError::local(
                "le pilote MySQL ne sait pas vérifier une chaîne de certificats sans vérifier le nom \
                 d'hôte : « verify-ca » n'est pas disponible pour ce moteur. Employez « verify-full » \
                 si le certificat porte le nom du serveur, ou « require » pour chiffrer sans \
                 authentifier",
            ));
        }
        options = options.ssl_opts(Some(ssl));
    }

    Ok(Opts::from(options))
}

/// Ouvre un pool, et vérifie **tout de suite** qu'il répond.
///
/// `Pool::new` n'ouvre aucune connexion : le pilote est paresseux. Sans cette sonde, un hôte
/// injoignable ne se verrait qu'au premier dépliage de l'arbre, où il se lirait comme un problème
/// d'introspection — le piège que `18b` a rencontré avec le client MongoDB.
pub async fn ouvrir(options: Opts) -> Result<(Pool, String), EngineError> {
    let pool = Pool::new(options);
    let version = version_du_serveur(&pool).await.inspect_err(|_| {
        // Le pool n'est pas rendu : le lâcher ferme ce qu'il a pu ouvrir.
    })?;
    Ok((pool, version))
}

/// La chaîne de version du serveur, telle qu'il la donne.
///
/// **Complète, pas un numéro nu** : `10.11.6-MariaDB` doit rester reconnaissable comme MariaDB
/// (`16a`). C'est `nom_du_serveur` qui en tire le libellé de `A2`.
pub async fn version_du_serveur(pool: &Pool) -> Result<String, EngineError> {
    use mysql_async::prelude::Queryable;
    let mut connexion = pool.get_conn().await.map_err(|e| traduire(&e))?;
    let version: Option<String> = connexion
        .query_first("select version()")
        .await
        .map_err(|e| traduire(&e))?;
    Ok(version.unwrap_or_else(|| "version inconnue".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Proxy, ProxySsh, SslMode, Tunnel};

    fn variante() -> ConnectionSettings {
        ConnectionSettings {
            host: "localhost".into(),
            port: 3306,
            default_database: "dorabase_test".into(),
            username: "dorabase".into(),
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

    fn avec_tunnel() -> ConnectionSettings {
        let mut variante = variante();
        variante.host = "db.interne.test".into();
        variante.tunnel = Some(Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.exemple.test".into(),
                bastion_port: 22,
                username: "clement".into(),
                private_key_path: "~/.ssh/id_ed25519".into(),
            }),
        });
        variante
    }

    #[test]
    fn une_variante_simple_se_prepare() {
        let options = preparer(&variante(), None, None).expect("préparable");
        assert_eq!(options.ip_or_hostname(), "localhost");
        assert_eq!(options.tcp_port(), 3306);
        assert_eq!(options.db_name(), Some("dorabase_test"));
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
        // **Le même refus qu'en `06b` et `18b`**, pour la même raison : un `None` oublié à l'appel ne
        // doit pas se traduire par une connexion directe silencieuse.
        let erreur = preparer(&avec_tunnel(), None, None).expect_err("doit refuser");
        assert!(erreur.message.contains("tunnel"), "{}", erreur.message);
    }

    #[test]
    fn la_redirection_du_tunnel_remplace_l_hote_declare() {
        let options =
            preparer(&avec_tunnel(), None, Some(("127.0.0.1", 63342))).expect("préparable");
        assert_eq!(options.ip_or_hostname(), "127.0.0.1");
        assert_eq!(options.tcp_port(), 63342);
    }

    #[test]
    fn le_fuseau_de_session_est_force_a_utc() {
        // **Sans cela, un `TIMESTAMP` se lit différemment selon la machine.** Un explorateur de bases
        // ne peut pas afficher une valeur qui dépend de qui regarde.
        let options = preparer(&variante(), None, None).expect("préparable");
        let init = options.init().join(" | ");
        assert!(init.contains("time_zone = '+00:00'"), "{init}");
    }

    #[test]
    fn le_mode_sql_est_fixe_plutot_que_subi() {
        // `ANSI_QUOTES` changerait la règle de citation sous nos pieds : `16c` cite au backtick, et
        // le laisser au réglage du serveur ferait dépendre notre SQL d'une variable d'administration.
        let options = preparer(&variante(), None, None).expect("préparable");
        assert!(options.init().iter().any(|i| i.contains("sql_mode")));
    }
}
