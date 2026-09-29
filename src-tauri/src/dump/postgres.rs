//! L'implémentation PostgreSQL de `DumpTool`. La seule pour l'instant — les six autres
//! arrivent avec les specs `16`–`21`, et chacune ajoute son fichier sans toucher au reste.

use std::ffi::OsString;
use std::path::Path;

use super::{Cible, DumpTool};
use crate::config::SslMode;
use crate::engine::tls::{self, Exigences};

/// `pg_dump` pour l'export, `psql` pour l'import.
pub struct PostgresDumpTool;

impl DumpTool for PostgresDumpTool {
    fn binaire_export(&self) -> &'static str {
        "pg_dump"
    }

    /// **`psql`, et non `pg_restore`** : le format produit est `plain`, donc un script SQL
    /// que seul `psql` rejoue. C'est aussi ce qui rend le fichier lisible et rejouable hors
    /// de DoraBase, ce qui est le point du format `plain`.
    fn binaire_import(&self) -> &'static str {
        "psql"
    }

    /// L'argv de l'export.
    ///
    /// **`--format=plain`** : le fichier doit rester lisible et rejouable par `psql` hors
    /// DoraBase. **`--no-password`** : sans lui, un mot de passe manquant fait attendre un
    /// terminal qui n'existe pas, et le dump semble figé au lieu d'échouer.
    ///
    /// **Aucun mot de passe ici**, jamais : `ps` l'exposerait à tout utilisateur de la
    /// machine. Il passe par `child_env`.
    fn export_argv(&self, cible: &Cible, fichier: &Path) -> Vec<OsString> {
        let mut argv = self.connexion_argv(cible);
        argv.push("--format=plain".into());
        // `--file` plutôt qu'une redirection du `stdout` : `pg_dump` écrit alors lui-même,
        // et la progression se lit sur la taille du fichier. Rien du dump ne traverse
        // l'IPC dans les deux cas — la webview ne reçoit que des octets comptés.
        argv.push("--file".into());
        argv.push(fichier.into());
        argv
    }

    /// L'argv de l'import : **tout ou rien**.
    ///
    /// `ON_ERROR_STOP=on` n'est pas redondant avec `--single-transaction` : sans lui, `psql`
    /// continuerait après l'erreur dans une transaction déjà avortée, et le rapport
    /// désignerait la mauvaise instruction.
    fn import_argv(&self, cible: &Cible, fichier: &Path) -> Vec<OsString> {
        let mut argv = self.connexion_argv(cible);
        argv.push("--single-transaction".into());
        argv.push("--set".into());
        argv.push("ON_ERROR_STOP=on".into());
        argv.push("--file".into());
        argv.push(fichier.into());
        argv
    }

    /// Le secret ne passe **que** par l'environnement du fils, et le transport aussi.
    ///
    /// Et jamais journalisé : le plugin de log cible `Webview` en développement, donc une
    /// trace égarée imprimerait le mot de passe dans la sortie de `pnpm tauri dev`.
    ///
    /// **La base passe par `PGDATABASE`, jamais par `--dbname`** (#84). `pg_dump` et `psql`
    /// remettent `--dbname` à libpq avec `expand_dbname` : une valeur qui contient un `=` ou
    /// commence par `postgresql://` y est relue comme une **chaîne de connexion**, dont le
    /// `host` et le `port` écrasent ceux posés avant elle. `default_database` venant d'un
    /// formulaire ou d'un fichier de projet importé, un nom de base suffisait à envoyer le
    /// dump — et `PGPASSWORD` avec lui — vers un serveur que personne n'a déclaré, pendant
    /// que la modale nommait le bon. Une variable d'environnement n'est jamais relue ainsi :
    /// la valeur y reste un nom de base, quel qu'il soit. Refuser `=` à la saisie n'aurait
    /// pas suffi, et aurait refusé des noms que PostgreSQL accepte.
    ///
    /// **`PGSSLMODE` est toujours posé**, y compris à `disable` : c'est ce qui écarte à la fois le
    /// défaut de libpq (`prefer`, #82) et un `PGSSLMODE` hérité du shell de qui a lancé
    /// l'application. **`PGSSLROOTCERT` ne l'est que si le mode vérifie** — voir `racine_libpq`.
    fn child_env(&self, cible: &Cible, mot_de_passe: Option<&str>) -> Vec<(String, String)> {
        // **Sans `..`, délibérément** : un champ ajouté à `Cible` fait échouer la compilation ici,
        // là où son auteur doit décider s'il concerne le transport. C'est ainsi que le mode SSL
        // avait été oublié — rien ne forçait qui que ce soit à y penser.
        let Cible {
            hote: _,
            port: _,
            base,
            utilisateur: _,
            ssl_mode,
            ca_certificate,
        } = cible;

        let mut env = vec![("PGDATABASE".to_string(), base.clone())];
        if let Some(mot_de_passe) = mot_de_passe {
            env.push(("PGPASSWORD".to_string(), mot_de_passe.to_string()));
        }
        // **Le même calcul que celui que la modale affiche** : `transport_de` est la seule source,
        // et l'environnement se dérive de sa réponse plutôt que de refaire la décision. Un
        // affichage calculé à côté serait une seconde vérité, fausse le jour où l'une bouge.
        let transport = transport_de(*ssl_mode, ca_certificate.as_deref());
        env.push((
            "PGSSLMODE".to_string(),
            mode_libpq(transport.mode).to_string(),
        ));
        match transport.root {
            RootCert::File { path } => env.push(("PGSSLROOTCERT".to_string(), path)),
            RootCert::System => env.push(("PGSSLROOTCERT".to_string(), "system".to_string())),
            RootCert::Unused | RootCert::LibpqDefault => {}
        }
        env
    }
}

impl PostgresDumpTool {
    /// La partie commune aux deux argv : où se connecter, et sous quel nom. **La base n'y
    /// est pas** : voir `child_env`.
    fn connexion_argv(&self, cible: &Cible) -> Vec<OsString> {
        vec![
            "--host".into(),
            cible.hote.clone().into(),
            "--port".into(),
            cible.port.to_string().into(),
            "--username".into(),
            cible.utilisateur.clone().into(),
            // Sans lui, un mot de passe manquant fait attendre un terminal absent : le
            // processus reste bloqué et l'export paraît figé au lieu d'échouer.
            "--no-password".into(),
        ]
    }
}

/// Le transport **réellement employé** par `pg_dump` et `psql`, tel que la modale l'affiche (#82).
///
/// C'est une donnée et non un texte : l'écran compose la phrase, et `child_env` en dérive les
/// deux variables. Le mode est celui qui part — `allow` y est donc déjà devenu `prefer`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "dump.ts")]
pub struct DumpTransport {
    pub mode: SslMode,
    pub root: RootCert,
}

/// Où libpq cherche l'autorité qui vérifie le certificat du serveur.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export_to = "dump.ts")]
pub enum RootCert {
    /// Le mode ne vérifie rien : aucune autorité n'est consultée.
    Unused,
    /// `verify-ca` sans autorité déclarée : libpq lit son `~/.postgresql/root.crt`, et refuse
    /// s'il manque. Le dire est ce qui évite de croire que la vérification s'appuie sur le système.
    LibpqDefault,
    /// `verify-full` sans autorité déclarée : les racines du système (`PGSSLROOTCERT=system`).
    System,
    /// L'autorité déclarée dans `A2`, `~` expansé.
    File { path: String },
}

/// Le transport d'une cible — **la seule décision**, que `child_env` et la modale lisent.
pub fn transport_de(mode: SslMode, ca: Option<&str>) -> DumpTransport {
    DumpTransport {
        mode: mode_effectif(mode),
        root: racine_libpq(mode, ca),
    }
}

/// Le mode qui rend **la même décision** que le pilote Rust (`engine/postgres/connect.rs`) :
/// **`allow` part en `prefer`**, comme dans `traduire_mode_ssl`. libpq tente le clair d'abord en
/// `allow`, le pilote tente TLS d'abord ; la connexion que l'utilisateur a testée dans `A2` s'est
/// donc comportée en `prefer`, et le dump ne doit pas en tenter une plus faible.
fn mode_effectif(mode: SslMode) -> SslMode {
    match mode {
        SslMode::Allow => SslMode::Prefer,
        autre => autre,
    }
}

/// Le nom `libpq` d'un mode. Les noms de `SslMode` sont exactement ceux de libpq.
fn mode_libpq(mode: SslMode) -> &'static str {
    match mode {
        SslMode::Disable => "disable",
        SslMode::Allow => "allow",
        SslMode::Prefer => "prefer",
        SslMode::Require => "require",
        SslMode::VerifyCa => "verify-ca",
        SslMode::VerifyFull => "verify-full",
    }
}

/// Où libpq cherchera l'autorité — donc ce que `PGSSLROOTCERT` doit valoir, s'il est posé.
///
/// Trois cas, et chacun a sa raison :
///
/// - **le mode ne vérifie pas** (`disable`, `prefer`, `require`) : `Unused`, même si une autorité est
///   déclarée. Le pilote Rust l'ignore dans ces modes, et libpq, lui, **passe `require` en
///   `verify-ca` dès qu'il trouve une racine** : la transmettre ferait refuser au dump un serveur
///   que la connexion accepte ;
/// - **une autorité est déclarée** : `File`, son chemin, `~` expansé comme le fait `tls::racines`. libpq
///   ne fait confiance qu'à elle, là où le pilote y ajoute les racines publiques : l'écart est du
///   côté strict, donc un refus possible et jamais une acceptation de plus ;
/// - **aucune autorité, et `verify-full`** : `System`, les racines du système (libpq ≥ 16). C'est
///   l'équivalent le plus proche des racines publiques de `webpki-roots` qu'emploie le pilote, et
///   sans lui une base gérée (RDS, Cloud SQL public) que la connexion joint en `verify-full` serait
///   refusée par le dump faute de `~/.postgresql/root.crt`. libpq n'accepte `system` qu'avec
///   `verify-full`, d'où `LibpqDefault` en `verify-ca` : libpq cherche alors `~/.postgresql/root.crt` et
///   refuse s'il manque — un refus, là encore, jamais un repli. Un libpq antérieur à la 16 lirait
///   `system` comme un nom de fichier et refuserait de même.
fn racine_libpq(mode: SslMode, ca: Option<&str>) -> RootCert {
    if !Exigences::de(mode).authentifie() {
        return RootCert::Unused;
    }
    match ca {
        Some(chemin) => RootCert::File {
            path: tls::chemin_absolu(chemin),
        },
        None if mode == SslMode::VerifyFull => RootCert::System,
        None => RootCert::LibpqDefault,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cible(ssl_mode: SslMode, ca_certificate: Option<&str>) -> Cible {
        Cible {
            hote: "db.interne".into(),
            port: 5432,
            base: "commandes".into(),
            utilisateur: "dorabase".into(),
            ssl_mode,
            ca_certificate: ca_certificate.map(str::to_owned),
        }
    }

    fn valeur<'a>(env: &'a [(String, String)], cle: &str) -> Option<&'a str> {
        env.iter()
            .find(|(nom, _)| nom == cle)
            .map(|(_, valeur)| valeur.as_str())
    }

    /// Ce que la modale affiche est ce que `child_env` pose : les deux lisent `transport_de`. Le
    /// test le vérifie sur toutes les combinaisons, pour qu'un jour où l'environnement
    /// recalculerait sa décision à côté, la divergence se voie ici plutôt que dans une capture.
    #[test]
    fn le_transport_affiche_est_celui_qui_part() {
        for mode in [
            SslMode::Disable,
            SslMode::Allow,
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyCa,
            SslMode::VerifyFull,
        ] {
            for ca in [None, Some("/certs/ca.pem")] {
                let transport = transport_de(mode, ca);
                let env = PostgresDumpTool.child_env(&cible(mode, ca), None);
                assert_eq!(
                    valeur(&env, "PGSSLMODE"),
                    Some(mode_libpq(transport.mode)),
                    "{mode:?} {ca:?}"
                );
                let racine = match &transport.root {
                    RootCert::File { path } => Some(path.as_str()),
                    RootCert::System => Some("system"),
                    RootCert::Unused | RootCert::LibpqDefault => None,
                };
                assert_eq!(valeur(&env, "PGSSLROOTCERT"), racine, "{mode:?} {ca:?}");
            }
        }
        // Et `allow` est affiché sous le nom qui part : la modale ne doit pas dire `allow`.
        assert_eq!(transport_de(SslMode::Allow, None).mode, SslMode::Prefer);
    }

    #[test]
    fn chaque_mode_part_sous_le_nom_que_libpq_attend() {
        for (mode, attendu) in [
            (SslMode::Disable, "disable"),
            // Comme le pilote Rust : TLS d'abord, jamais le clair d'abord.
            (SslMode::Allow, "prefer"),
            (SslMode::Prefer, "prefer"),
            (SslMode::Require, "require"),
            (SslMode::VerifyCa, "verify-ca"),
            (SslMode::VerifyFull, "verify-full"),
        ] {
            let env = PostgresDumpTool.child_env(&cible(mode, None), Some("x"));
            assert_eq!(valeur(&env, "PGSSLMODE"), Some(attendu), "{mode:?}");
        }
    }

    /// Le second défaut de #82 : l'environnement n'était posé **que** s'il y avait un mot de
    /// passe. Une connexion sans secret serait retombée sur le `prefer` de libpq.
    #[test]
    fn le_transport_est_pose_meme_sans_mot_de_passe() {
        let env = PostgresDumpTool.child_env(&cible(SslMode::VerifyFull, None), None);
        assert_eq!(valeur(&env, "PGSSLMODE"), Some("verify-full"));
        // Contrôle : sans secret, aucun `PGPASSWORD` fantôme.
        assert_eq!(valeur(&env, "PGPASSWORD"), None);
    }

    #[test]
    fn l_autorite_declaree_n_est_transmise_que_si_le_mode_verifie() {
        // En `require`, libpq passerait en `verify-ca` en trouvant une racine : ce serait refuser
        // un serveur que la connexion accepte.
        for mode in [SslMode::Disable, SslMode::Prefer, SslMode::Require] {
            let env = PostgresDumpTool.child_env(&cible(mode, Some("/certs/ca.pem")), None);
            assert_eq!(valeur(&env, "PGSSLROOTCERT"), None, "{mode:?}");
        }
        // Contrôle positif : dès que le mode vérifie, le chemin part.
        for mode in [SslMode::VerifyCa, SslMode::VerifyFull] {
            let env = PostgresDumpTool.child_env(&cible(mode, Some("/certs/ca.pem")), None);
            assert_eq!(
                valeur(&env, "PGSSLROOTCERT"),
                Some("/certs/ca.pem"),
                "{mode:?}"
            );
        }
    }

    #[test]
    fn le_tilde_de_l_autorite_est_expanse_comme_pour_le_pilote() {
        let env = PostgresDumpTool.child_env(
            &cible(SslMode::VerifyFull, Some("~/certs/interne.pem")),
            None,
        );
        let racine = valeur(&env, "PGSSLROOTCERT").expect("une racine");
        assert_eq!(racine, tls::chemin_absolu("~/certs/interne.pem"));
        assert!(!racine.starts_with('~'), "{racine}");
    }

    #[test]
    fn sans_autorite_verify_full_s_appuie_sur_les_racines_du_systeme() {
        let env = PostgresDumpTool.child_env(&cible(SslMode::VerifyFull, None), None);
        assert_eq!(valeur(&env, "PGSSLROOTCERT"), Some("system"));
        // libpq refuse `system` sous `verify-full` : rien, et libpq cherchera son `root.crt`.
        let env = PostgresDumpTool.child_env(&cible(SslMode::VerifyCa, None), None);
        assert_eq!(valeur(&env, "PGSSLROOTCERT"), None);
    }

    #[test]
    fn aucun_reglage_de_transport_ne_passe_par_l_argv() {
        // Le transport vit dans l'environnement, où il ne peut pas se confondre avec une chaîne de
        // connexion — et l'argv reste celui que les tests de `run.rs` gardent.
        let argv = PostgresDumpTool.export_argv(
            &cible(SslMode::VerifyFull, Some("/certs/ca.pem")),
            Path::new("/tmp/x"),
        );
        let rendu = argv.join(std::ffi::OsStr::new(" "));
        let rendu = rendu.to_string_lossy();
        assert!(!rendu.contains("ssl"), "{rendu}");
        assert!(!rendu.contains("/certs/ca.pem"), "{rendu}");
    }
}
