//! L'administration d'une instance PostgreSQL (`API-32`) : les sept lectures, et le SQL des gestes.
//!
//! # Une seule composition du SQL, employée deux fois
//!
//! `sql_de` compose les ordres d'un geste ; `planifier` les rend à la confirmation, `executer` les
//! envoie. **Ce que l'encart sombre affiche est donc, littéralement, ce qui part** — pas une
//! reconstruction plausible. C'est la règle que `preview_updates` a posée en `11c` : « s'il n'est pas
//! exactement celui qui partira, il est pire qu'absent », et c'est ici qu'elle compte le plus, cet
//! écran étant le seul du produit qui supprime des rôles et des bases.
//!
//! # Aucun identifiant n'est interpolé nu
//!
//! Tout nom passe par `identifiant`, la même fonction qui cite les tables et les colonnes de toutes
//! les écritures de lignes, et toute valeur par `litteral`. Un rôle nommé `o"brien` n'est pas une
//! hypothèse d'école : c'est le cas que la citation existe pour traiter, et le seul écran où s'en
//! passer coûterait un `DROP` mal placé.

use tokio_postgres::Client;

use super::error;
use super::rows::identifiant;
use crate::engine::EngineError;
use crate::instances::{
    Capability, InstanceAction, InstanceDatabase, InstanceExtension, InstanceGesture,
    InstanceIdentity, InstanceOutcome, InstanceOverview, InstancePlan, InstancePrivilege,
    InstanceRole, InstanceSession, InstanceSetting, RoleAttributes,
};

/// Un littéral de chaîne SQL : `'…'`, apostrophes doublées.
///
/// **Pas de `$1`, et c'est une contrainte du serveur, pas un raccourci.** `ALTER SYSTEM SET` et
/// `CREATE DATABASE` sont des ordres utilitaires : PostgreSQL refuse d'y préparer un paramètre
/// (« cannot insert multiple commands » / « syntax error at or near "$1" »). Et surtout, la
/// confirmation doit **montrer** l'ordre complet : un `$1` affiché à côté d'une valeur invisible ne
/// dirait pas ce qui part.
fn litteral(valeur: &str) -> String {
    format!("'{}'", valeur.replace('\'', "''"))
}

/// Ce que la vue d'ensemble affiche, en un seul relevé.
pub async fn overview(
    client: &Client,
    version: String,
    host: &str,
    port: u16,
    secret_location: Option<String>,
) -> Result<InstanceOverview, EngineError> {
    // **Une requête et non six.** Les six tuiles décrivent le même instant, et la barre annonce
    // « relevé il y a 12 s » : six lectures successives rendraient six instants voisins, et cette
    // phrase deviendrait fausse d'une manière que personne ne pourrait voir.
    //
    // `pg_postmaster_start_time()` et `pg_database_size()` sont enveloppés : le premier est refusé à
    // un rôle sans `pg_read_all_stats` sur certaines configurations, le second à un rôle sans
    // `CONNECT`. Les laisser lever ferait échouer **toute** la vue d'ensemble pour une tuile.
    let ligne = client
        .query_one(
            "select
                 current_user::text                                              as role,
                 current_database()::text                                        as db,
                 (select count(*) from pg_stat_activity)                         as connections,
                 (select setting::bigint from pg_settings
                   where name = 'max_connections')                               as max_connections,
                 (select count(*) from pg_database where not datistemplate)      as databases,
                 (select count(*) from pg_roles)                                 as roles,
                 extract(epoch from (now() - pg_postmaster_start_time()))::bigint as uptime,
                 (select ssl from pg_stat_ssl where pid = pg_backend_pid())      as ssl,
                 (select version from pg_stat_ssl where pid = pg_backend_pid())  as ssl_version,
                 (select cipher from pg_stat_ssl where pid = pg_backend_pid())   as ssl_cipher,
                 (select bool_and(has_database_privilege(d.datname, 'CONNECT'))
                    from pg_database d where not d.datistemplate)                as mesurable,
                 (select sum(pg_database_size(d.datname))::bigint
                    from pg_database d
                   where not d.datistemplate
                     and has_database_privilege(d.datname, 'CONNECT'))           as taille,
                 (select rolsuper from pg_roles where rolname = current_user)    as super,
                 (select rolcreatedb from pg_roles where rolname = current_user) as createdb,
                 (select rolcreaterole from pg_roles where rolname = current_user) as createrole",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    let chiffre: Option<String> = match (
        ligne
            .try_get::<_, Option<String>>("ssl_version")
            .ok()
            .flatten(),
        ligne
            .try_get::<_, Option<String>>("ssl_cipher")
            .ok()
            .flatten(),
    ) {
        (Some(version), Some(chiffre)) => Some(format!("{version} / {chiffre}")),
        (Some(version), None) => Some(version),
        (None, chiffre) => chiffre,
    };

    // **`bool_and` décide de la somme.** Une taille partielle s'afficherait comme la taille de
    // l'instance en taisant les bases qu'on n'a pas pu mesurer : c'est le mensonge silencieux que
    // `RowCount::Unknown` a déjà coûté une fois, ici sur un nombre que personne ne pourrait
    // recouper.
    let mesurable: bool = ligne.try_get("mesurable").unwrap_or(false);
    let total_size_bytes = if mesurable {
        ligne.try_get::<_, Option<i64>>("taille").unwrap_or(None)
    } else {
        None
    };

    let superutilisateur: bool = ligne.try_get("super").unwrap_or(false);
    let createdb: bool = ligne.try_get("createdb").unwrap_or(false);
    let createrole: bool = ligne.try_get("createrole").unwrap_or(false);

    Ok(InstanceOverview {
        server_version: version,
        uptime_seconds: ligne.try_get::<_, Option<i64>>("uptime").unwrap_or(None),
        connections: ligne.try_get("connections").unwrap_or(0),
        max_connections: ligne.try_get("max_connections").unwrap_or(0),
        databases: ligne.try_get("databases").unwrap_or(0),
        roles: ligne.try_get("roles").unwrap_or(0),
        total_size_bytes,
        identity: InstanceIdentity {
            host: host.to_owned(),
            port,
            role: ligne
                .try_get::<_, String>("role")
                .map_err(|erreur| error::traduire(&erreur))?,
            database: ligne
                .try_get::<_, String>("db")
                .map_err(|erreur| error::traduire(&erreur))?,
            tls: ligne
                .try_get::<_, Option<bool>>("ssl")
                .unwrap_or(None)
                .unwrap_or(false),
            tls_cipher: chiffre,
            secret_location,
        },
        capabilities: capacites(superutilisateur, createdb, createrole),
    })
}

/// Les onze gestes, et le droit qu'a ce compte de les faire.
///
/// # Trois attributs, onze réponses — et ce que cette fonction ne prétend pas
///
/// Elle lit `rolsuper`, `rolcreatedb` et `rolcreaterole`, qui décident de la **majorité** des refus.
/// Elle ne peut pas prédire ceux qui dépendent de l'objet visé : supprimer une base demande d'en
/// être propriétaire, terminer la session d'un autre rôle demande `pg_signal_backend`. Un geste
/// annoncé permis peut donc encore être refusé par le serveur.
///
/// **C'est assumé, et c'est le bon partage.** Ce que cette liste évite est le cas courant — un
/// compte de lecture qui verrait onze boutons vifs et les découvrirait un par un —, non toute erreur
/// possible. Prétendre l'exhaustivité demanderait un `has_*_privilege` par ligne de chaque section,
/// donc de refaire la lecture entière à chaque relevé, pour transformer un refus rare en grisé.
fn capacites(superutilisateur: bool, createdb: bool, createrole: bool) -> Vec<Capability> {
    let refus = |permis: bool, raison: &str| Capability {
        // Rempli par la boucle ci-dessous : ce lambda ne sert qu'à composer le couple.
        gesture: InstanceGesture::CreateDatabase,
        allowed: permis,
        reason: if permis {
            None
        } else {
            Some(raison.to_owned())
        },
    };

    InstanceGesture::TOUS
        .into_iter()
        .map(|gesture| {
            let (permis, raison) = match gesture {
                InstanceGesture::CreateDatabase => (
                    superutilisateur || createdb,
                    "le rôle n'a pas l'attribut CREATEDB",
                ),
                // Changer le propriétaire d'une base demande d'être membre du nouveau propriétaire
                // et propriétaire de la base — ce qu'un `CREATEDB` seul ne donne pas. La condition
                // est donc plus stricte, et la raison le dit.
                InstanceGesture::AlterDatabase | InstanceGesture::DropDatabase => (
                    superutilisateur || createdb,
                    "le rôle n'a pas l'attribut CREATEDB, et n'est pas superutilisateur",
                ),
                InstanceGesture::CreateRole
                | InstanceGesture::AlterRole
                | InstanceGesture::DropRole => (
                    superutilisateur || createrole,
                    "le rôle n'a pas l'attribut CREATEROLE",
                ),
                // Un `grant` sur une base demande d'en être propriétaire, ou d'avoir reçu le droit
                // avec `WITH GRANT OPTION`. Aucun attribut de rôle ne le donne : la seule réponse
                // sûre est « superutilisateur », et le refus dit franchement qu'il peut se tromper
                // dans le sens permissif.
                InstanceGesture::GrantPrivilege => (
                    superutilisateur || createdb,
                    "accorder un privilège demande d'être propriétaire de la base, ou \
                     superutilisateur",
                ),
                // `pg_signal_backend` est un rôle prédéfini, non un attribut : on ne peut pas le
                // lire dans les trois booléens. Terminer **sa propre** session est en revanche
                // toujours permis, et c'est ce qui empêche de désactiver la section entière.
                InstanceGesture::TerminateSession => (true, ""),
                InstanceGesture::CreateExtension | InstanceGesture::DropExtension => (
                    superutilisateur,
                    "installer une extension demande d'être superutilisateur (sauf pour les \
                     extensions marquées « trusted », que le serveur accepte d'un propriétaire de \
                     base)",
                ),
                InstanceGesture::SetParameter => (
                    superutilisateur,
                    "ALTER SYSTEM demande d'être superutilisateur, ou membre de pg_write_all_data \
                     selon la version",
                ),
            };
            Capability {
                gesture,
                ..refus(permis, raison)
            }
        })
        .collect()
}

/// Les bases de l'instance.
pub async fn databases(client: &Client) -> Result<Vec<InstanceDatabase>, EngineError> {
    let lignes = client
        .query(
            "select d.datname::text                              as name,
                    pg_get_userbyid(d.datdba)::text               as owner,
                    pg_encoding_to_char(d.encoding)::text         as encoding,
                    d.datcollate::text                            as collation,
                    case when has_database_privilege(d.datname, 'CONNECT')
                         then pg_database_size(d.datname)::bigint end as size,
                    (select count(*) from pg_stat_activity a
                      where a.datname = d.datname)                as connections,
                    d.datistemplate                               as is_template,
                    d.datallowconn                                as allow_connections
               from pg_database d
              order by d.datname",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstanceDatabase {
            name: ligne.get("name"),
            owner: ligne.get("owner"),
            encoding: ligne.get("encoding"),
            collation: ligne.get("collation"),
            size_bytes: ligne.get("size"),
            connections: ligne.get("connections"),
            is_template: ligne.get("is_template"),
            allow_connections: ligne.get("allow_connections"),
        })
        .collect())
}

/// Les rôles du serveur.
pub async fn roles(client: &Client) -> Result<Vec<InstanceRole>, EngineError> {
    // `pg_auth_members` est joint en agrégat plutôt qu'en boucle : un serveur porte facilement
    // cinquante rôles, et une requête par rôle en ferait cinquante allers-retours pour une colonne.
    // C'est la lecture ensembliste de `table_details`, appliquée ici.
    let lignes = client
        .query(
            "select r.rolname::text     as name,
                    r.rolcanlogin       as can_login,
                    r.rolsuper          as superuser,
                    r.rolcreatedb       as create_db,
                    r.rolcreaterole     as create_role,
                    r.rolreplication    as replication,
                    r.rolbypassrls      as bypass_rls,
                    r.rolvaliduntil::text as valid_until,
                    coalesce((select array_agg(g.rolname::text order by g.rolname)
                                from pg_auth_members m
                                join pg_roles g on g.oid = m.roleid
                               where m.member = r.oid), '{}')  as member_of,
                    (select count(*) from pg_database d where d.datdba = r.oid) as owned,
                    -- Les rôles prédéfinis du serveur commencent tous par `pg_`, et le catalogue
                    -- n'a pas d'autre marque : `oid < 16384` daterait les rôles créés à
                    -- l'initialisation, ce qui inclut le superutilisateur de l'installation — un
                    -- rôle bien réel, que l'on veut voir et pouvoir modifier.
                    r.rolname like 'pg\\_%' as system
               from pg_roles r
              order by r.rolname",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstanceRole {
            name: ligne.get("name"),
            can_login: ligne.get("can_login"),
            superuser: ligne.get("superuser"),
            create_db: ligne.get("create_db"),
            create_role: ligne.get("create_role"),
            replication: ligne.get("replication"),
            bypass_rls: ligne.get("bypass_rls"),
            valid_until: ligne.get("valid_until"),
            member_of: ligne.get("member_of"),
            owned_databases: ligne.get("owned"),
            system: ligne.get("system"),
        })
        .collect())
}

/// La matrice rôle × base.
///
/// **Un produit cartésien fait par le serveur**, et non deux listes recroisées à l'écran :
/// `has_database_privilege` est la seule réponse juste — elle tient compte de l'appartenance à un
/// rôle, de `PUBLIC`, et du propriétaire, trois chemins qu'un croisement d'ACL brutes manquerait.
///
/// Les rôles prédéfinis (`pg_*`) en sont **écartés** : ils n'ont pas `LOGIN`, ne se connectent donc à
/// aucune base, et rempliraient la matrice d'une dizaine de lignes identiques. Ils restent dans la
/// section « Utilisateurs », où leur existence compte.
pub async fn privileges(client: &Client) -> Result<Vec<InstancePrivilege>, EngineError> {
    let lignes = client
        .query(
            "select r.rolname::text as role,
                    d.datname::text as database,
                    has_database_privilege(r.rolname, d.datname, 'CREATE')    as c,
                    has_database_privilege(r.rolname, d.datname, 'TEMPORARY') as t,
                    has_database_privilege(r.rolname, d.datname, 'CONNECT')   as x
               from pg_roles r
               cross join pg_database d
              where r.rolname not like 'pg\\_%'
                and not d.datistemplate
              order by r.rolname, d.datname",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstancePrivilege {
            role: ligne.get("role"),
            database: ligne.get("database"),
            create: ligne.get("c"),
            temporary: ligne.get("t"),
            connect: ligne.get("x"),
        })
        .collect())
}

/// Les sessions ouvertes.
pub async fn sessions(client: &Client) -> Result<Vec<InstanceSession>, EngineError> {
    let lignes = client
        .query(
            // **`application_name` puis `backend_type`, dans cet ordre.** Le premier est ce que le
            // client déclare de lui-même — la seule chose que le serveur sache de qui s'est
            // connecté ; le second nomme les processus internes, qui n'ont pas de client. Un
            // `application_name` vide est la valeur par défaut du protocole, pas un nom : `nullif`
            // le ramène à `NULL` pour que le repli joue. Voir `InstanceSession::process`.
            "select a.pid,
                    a.usename::text  as usr,
                    a.datname::text  as db,
                    coalesce(host(a.client_addr), 'local') as client,
                    coalesce(
                      nullif(trim(a.application_name), ''),
                      nullif(trim(a.backend_type), '')
                    )::text          as process,
                    a.state::text    as state,
                    extract(epoch from (now() - a.state_change))::bigint as duree,
                    a.pid = pg_backend_pid() as self
               from pg_stat_activity a
              order by a.pid",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstanceSession {
            pid: ligne.get("pid"),
            user: ligne.get("usr"),
            database: ligne.get("db"),
            client: ligne.get("client"),
            process: ligne.get("process"),
            state: ligne.get("state"),
            duration_seconds: ligne.get("duree"),
            is_self: ligne.get("self"),
        })
        .collect())
}

/// Les extensions **de la base de service**. Voir `InstanceExtension::database` pour la portée.
pub async fn extensions(client: &Client) -> Result<Vec<InstanceExtension>, EngineError> {
    // Les disponibles **et** les installées, en une jointure externe : une section qui ne montrerait
    // que les installées ne dirait pas ce qu'on peut ajouter, et l'action principale de la barre
    // n'aurait rien à proposer.
    let lignes = client
        .query(
            "select a.name::text            as name,
                    e.extversion::text      as installed,
                    a.default_version::text as available,
                    current_database()::text as db,
                    n.nspname::text         as schema
               from pg_available_extensions a
               left join pg_extension e on e.extname = a.name
               left join pg_namespace n on n.oid = e.extnamespace
              order by (e.extversion is null), a.name",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstanceExtension {
            name: ligne.get("name"),
            installed_version: ligne.get("installed"),
            default_version: ligne.get("available"),
            database: ligne.get("db"),
            schema: ligne.get("schema"),
        })
        .collect())
}

/// Les paramètres de configuration.
pub async fn settings(client: &Client) -> Result<Vec<InstanceSetting>, EngineError> {
    let lignes = client
        .query(
            "select name::text,
                    setting::text as value,
                    unit::text,
                    context::text,
                    source::text,
                    pending_restart,
                    context not in ('internal') as settable
               from pg_settings
              order by name",
            &[],
        )
        .await
        .map_err(|erreur| error::traduire(&erreur))?;

    Ok(lignes
        .iter()
        .map(|ligne| InstanceSetting {
            name: ligne.get("name"),
            value: ligne.get("value"),
            unit: ligne.get("unit"),
            context: ligne.get("context"),
            source: ligne.get("source"),
            pending_restart: ligne.get("pending_restart"),
            settable: ligne.get("settable"),
        })
        .collect())
}

/// Le SQL d'un geste, et ce que la confirmation dit en plus.
///
/// **Pure** : elle ne touche à rien et ne demande rien au serveur. C'est ce qui la rend testable
/// sans base — et c'est là que se vérifient la citation des identifiants, l'ordre des trois ordres
/// d'un `DROP ROLE`, et le `RESTRICT` qu'on ne veut jamais voir devenir `CASCADE`.
pub fn planifier(action: &InstanceAction) -> InstancePlan {
    match action {
        InstanceAction::CreateDatabase { name, owner } => {
            let mut ordre = format!("CREATE DATABASE {}", identifiant(name));
            if let Some(owner) = owner.as_deref().map(str::trim).filter(|o| !o.is_empty()) {
                ordre.push_str(&format!(" OWNER {}", identifiant(owner)));
            }
            InstancePlan {
                statements: vec![format!("{ordre};")],
                note: String::new(),
                destructive: false,
            }
        }
        InstanceAction::AlterDatabaseOwner { name, owner } => InstancePlan {
            statements: vec![format!(
                "ALTER DATABASE {} OWNER TO {};",
                identifiant(name),
                identifiant(owner)
            )],
            note: "Le propriétaire d'une base n'est pas celui de ses objets : les tables déjà \
                   créées gardent le leur. Les réattribuer demande un REASSIGN OWNED, exécuté dans \
                   cette base."
                .to_owned(),
            destructive: false,
        },
        InstanceAction::DropDatabase { name } => InstancePlan {
            statements: vec![format!("DROP DATABASE {};", identifiant(name))],
            note: "Sans IF EXISTS et sans FORCE : une base absente doit se dire, et FORCE couperait \
                   les sessions des autres sans les nommer. Une base encore connectée fait échouer \
                   l'ordre — terminez ses sessions depuis l'onglet Sessions."
                .to_owned(),
            destructive: true,
        },
        InstanceAction::CreateRole {
            name,
            attributes,
            verifier,
        } => InstancePlan {
            statements: vec![format!(
                "CREATE ROLE {} {}{};",
                identifiant(name),
                mots_des_attributs(*attributes),
                mots_du_mot_de_passe(verifier.as_deref())
            )],
            note: note_du_mot_de_passe(verifier.as_deref(), ""),
            destructive: false,
        },
        InstanceAction::AlterRole {
            name,
            attributes,
            verifier,
        } => InstancePlan {
            statements: vec![format!(
                "ALTER ROLE {} {}{};",
                identifiant(name),
                mots_des_attributs(*attributes),
                mots_du_mot_de_passe(verifier.as_deref())
            )],
            note: note_du_mot_de_passe(
                verifier.as_deref(),
                "Les quatre attributs sont posés ensemble, y compris ceux qui n'ont pas changé : \
                 ALTER ROLE n'a pas de « laisser tel quel », et n'envoyer que la différence \
                 demanderait de relire l'état d'avant — donc d'écraser ce qu'un autre aurait changé \
                 entre-temps.",
            ),
            // **Poser un mot de passe ne retire rien, mais il remplace ce que rien ne rend** : ni la
            // base ni DoraBase ne gardent l'ancien en clair. Le rouge le dit, et seulement dans ce
            // cas — un changement d'attributs seul se défait en décochant.
            destructive: verifier.is_some(),
        },
        InstanceAction::DropRole { name, reassign_to } => InstancePlan {
            statements: vec![
                format!(
                    "REASSIGN OWNED BY {} TO {};",
                    identifiant(name),
                    identifiant(reassign_to)
                ),
                format!("DROP OWNED BY {};", identifiant(name)),
                format!("DROP ROLE {};", identifiant(name)),
            ],
            note: "Trois ordres, parce qu'un DROP ROLE seul échoue dès que le rôle possède quoi que \
                   ce soit. REASSIGN OWNED transfère ce qu'il possède ; DROP OWNED retire ce qui \
                   reste, c'est-à-dire ses privilèges. Les deux premiers ne portent que sur la base \
                   courante — un rôle propriétaire d'objets dans une autre base fera échouer le \
                   DROP ROLE, et il faudra les y rejouer."
                .to_owned(),
            destructive: true,
        },
        InstanceAction::GrantDatabase {
            role,
            database,
            privilege,
        } => InstancePlan {
            statements: vec![format!(
                "GRANT {} ON DATABASE {} TO {};",
                privilege.mot_sql(),
                identifiant(database),
                identifiant(role)
            )],
            note: String::new(),
            destructive: false,
        },
        InstanceAction::RevokeDatabase {
            role,
            database,
            privilege,
        } => InstancePlan {
            statements: vec![format!(
                "REVOKE {} ON DATABASE {} FROM {};",
                privilege.mot_sql(),
                identifiant(database),
                identifiant(role)
            )],
            note: "Un privilège reçu par appartenance à un autre rôle, ou accordé à PUBLIC, ne se \
                   révoque pas ici : la cellule restera cochée, et c'est le catalogue qui a raison."
                .to_owned(),
            destructive: true,
        },
        InstanceAction::TerminateSession { pid } => InstancePlan {
            statements: vec![format!("SELECT pg_terminate_backend({pid});")],
            note: "pg_terminate_backend annule la transaction en cours et ferme la session. Le \
                   client, lui, n'en sait rien avant sa prochaine requête."
                .to_owned(),
            destructive: true,
        },
        InstanceAction::CreateExtension { name } => InstancePlan {
            statements: vec![format!("CREATE EXTENSION {};", identifiant(name))],
            note: "L'extension est installée dans la base de service de cette instance, non sur \
                   tout le serveur : pg_extension est un catalogue par base."
                .to_owned(),
            destructive: false,
        },
        InstanceAction::DropExtension { name } => InstancePlan {
            statements: vec![format!("DROP EXTENSION {} RESTRICT;", identifiant(name))],
            note: "RESTRICT et non CASCADE : l'ordre échoue si quelque chose dépend de \
                   l'extension, plutôt que d'emporter en silence les tables, index et types qui s'y \
                   rattachent. Le message du serveur nommera ce qui dépend d'elle."
                .to_owned(),
            destructive: true,
        },
        InstanceAction::SetParameter { name, value } => InstancePlan {
            statements: vec![format!(
                "ALTER SYSTEM SET {} = {};",
                identifiant(name),
                litteral(value)
            )],
            note: "ALTER SYSTEM écrit dans postgresql.auto.conf. La valeur ne s'applique qu'après \
                   un rechargement de la configuration, et pour un paramètre de contexte \
                   « postmaster », après un redémarrage du serveur — que DoraBase ne fait pas."
                .to_owned(),
            destructive: false,
        },
        InstanceAction::ResetParameter { name } => InstancePlan {
            statements: vec![format!("ALTER SYSTEM RESET {};", identifiant(name))],
            note: "Le paramètre revient à ce que postgresql.conf dit, ou au défaut de compilation. \
                   Même réserve de rechargement que pour ALTER SYSTEM SET."
                .to_owned(),
            destructive: true,
        },
    }
}

/// Les quatre attributs, écrits dans les deux sens.
///
/// **Toujours les huit mots, jamais quatre.** `CREATE ROLE x LOGIN` laisse les trois autres au
/// défaut, ce qui est correct à la création ; mais `ALTER ROLE x LOGIN` **ne retire pas**
/// `SUPERUSER`. Une fonction qui n'écrirait que les attributs cochés ferait donc un `ALTER` qui
/// n'enlève rien — décocher « superutilisateur » n'aurait aucun effet, en silence. Écrire les huit
/// mots rend les deux ordres exacts avec une seule composition.
fn mots_des_attributs(attributs: RoleAttributes) -> String {
    [
        if attributs.can_login {
            "LOGIN"
        } else {
            "NOLOGIN"
        },
        if attributs.superuser {
            "SUPERUSER"
        } else {
            "NOSUPERUSER"
        },
        if attributs.create_db {
            "CREATEDB"
        } else {
            "NOCREATEDB"
        },
        if attributs.create_role {
            "CREATEROLE"
        } else {
            "NOCREATEROLE"
        },
    ]
    .join(" ")
}

/// La part `PASSWORD` d'un `CREATE`/`ALTER ROLE`, ou rien.
///
/// **Un seul ordre, non deux.** La syntaxe de PostgreSQL accepte les attributs et le mot de passe
/// dans le même `ALTER ROLE`, et c'est ce qu'il faut : deux ordres pourraient s'appliquer à moitié —
/// les attributs posés, le mot de passe non —, et le geste n'a aucune transaction pour l'en
/// empêcher. Un ordre unique n'a pas d'état intermédiaire.
///
/// **Et rien du tout quand il n'y a pas de mot de passe** : un `PASSWORD NULL` le *retirerait*, là
/// où le champ vide veut dire « laisser en place ».
fn mots_du_mot_de_passe(verifier: Option<&str>) -> String {
    match verifier {
        Some(verifier) => format!(" PASSWORD {}", litteral(verifier)),
        None => String::new(),
    }
}

/// Ce que la confirmation dit en plus, selon qu'un mot de passe accompagne le geste.
///
/// La phrase du vérificateur passe **en premier** quand elle est là : c'est la ligne la plus longue
/// de l'ordre affiché, et celle dont on se demande ce qu'elle est.
fn note_du_mot_de_passe(verifier: Option<&str>, sinon: &str) -> String {
    let sur_le_mot_de_passe = "Ce que l'ordre porte n'est pas le mot de passe mais son          **vérificateur** SCRAM-SHA-256, calculé par DoraBase : c'est exactement la valeur que          pg_authid stockera. Le mot de passe lui-même ne traverse ni le réseau, ni les journaux du          serveur — c'est ce que fait \\password de psql, et c'est ce qui permet de vous montrer          l'ordre sans rien divulguer. Il n'est pas réversible.";
    match (verifier, sinon) {
        (None, sinon) => sinon.to_owned(),
        (Some(_), "") => sur_le_mot_de_passe.to_owned(),
        (Some(_), sinon) => format!("{sur_le_mot_de_passe} {sinon}"),
    }
}

/// Exécute un geste, **ordre par ordre, dans l'ordre du plan**.
///
/// # Pourquoi pas une transaction
///
/// Trois des ordres composés ici ne peuvent pas en faire partie : `CREATE DATABASE`, `DROP DATABASE`
/// et `ALTER SYSTEM` sont refusés dans un bloc transactionnel par le serveur lui-même (« cannot run
/// inside a transaction block »). Envelopper le reste ferait donc coexister deux régimes — un geste
/// atomique, un autre non — dont la différence ne se lirait nulle part.
///
/// Le seul geste à plusieurs ordres est `DROP ROLE`, et son échec au deuxième ou au troisième laisse
/// un état **nommable** : le rôle existe encore, dépossédé. C'est ce que le message rend, plutôt
/// qu'un « la transaction a été annulée » qui serait faux.
pub async fn executer(
    client: &Client,
    action: &InstanceAction,
) -> Result<InstanceOutcome, EngineError> {
    let plan = planifier(action);

    for (rang, ordre) in plan.statements.iter().enumerate() {
        if let Err(erreur) = client.batch_execute(ordre).await {
            let traduite = error::traduire(&erreur);
            // **Le rang est dit quand il y a plusieurs ordres.** « DROP ROLE a échoué » et « le
            // deuxième des trois ordres a échoué, les deux premiers sont passés » ne décrivent pas
            // le même état du serveur, et c'est le second qu'il faut pour savoir quoi faire.
            return Err(if plan.statements.len() > 1 {
                EngineError {
                    message: format!(
                        "l'ordre {} sur {} a échoué ({}) : {}",
                        rang + 1,
                        plan.statements.len(),
                        ordre.trim_end_matches(';'),
                        traduite.message
                    ),
                    ..traduite
                }
            } else {
                traduite
            });
        }
    }

    Ok(InstanceOutcome {
        message: message_de(action),
        statements: plan.statements,
    })
}

/// Ce que l'écran dit après coup, **dans les termes du geste**.
fn message_de(action: &InstanceAction) -> String {
    match action {
        InstanceAction::CreateDatabase { name, .. } => format!("La base « {name} » est créée."),
        InstanceAction::AlterDatabaseOwner { name, owner } => {
            format!("La base « {name} » appartient désormais à « {owner} ».")
        }
        InstanceAction::DropDatabase { name } => format!("La base « {name} » est supprimée."),
        InstanceAction::CreateRole { name, verifier, .. } => match verifier {
            Some(_) => format!("Le rôle « {name} » est créé, avec son mot de passe."),
            None => format!("Le rôle « {name} » est créé."),
        },
        InstanceAction::AlterRole { name, verifier, .. } => match verifier {
            Some(_) => format!("Le rôle « {name} » est modifié, et son mot de passe posé."),
            None => format!("Le rôle « {name} » est modifié."),
        },
        InstanceAction::DropRole { name, reassign_to } => format!(
            "Le rôle « {name} » est supprimé ; ce qu'il possédait appartient à « {reassign_to} »."
        ),
        InstanceAction::GrantDatabase {
            role,
            database,
            privilege,
        } => format!(
            "« {role} » a désormais {} sur « {database} ».",
            privilege.mot_sql()
        ),
        InstanceAction::RevokeDatabase {
            role,
            database,
            privilege,
        } => format!(
            "« {role} » n'a plus {} sur « {database} ».",
            privilege.mot_sql()
        ),
        InstanceAction::TerminateSession { pid } => format!("La session {pid} est terminée."),
        InstanceAction::CreateExtension { name } => {
            format!("L'extension « {name} » est installée.")
        }
        InstanceAction::DropExtension { name } => format!("L'extension « {name} » est retirée."),
        InstanceAction::SetParameter { name, value } => {
            format!("« {name} » vaut désormais « {value} » — après rechargement.")
        }
        InstanceAction::ResetParameter { name } => {
            format!("« {name} » est rendu à sa valeur de configuration.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instances::DatabasePrivilege;

    fn attributs() -> RoleAttributes {
        RoleAttributes {
            can_login: true,
            superuser: false,
            create_db: false,
            create_role: false,
        }
    }

    #[test]
    fn un_nom_a_guillemet_est_cite_et_double() {
        // Le cas que la citation existe pour traiter. Sans elle, `DROP ROLE "o"brien"` est un ordre
        // tronqué suivi d'une syntaxe invalide — et sur un autre nom, un ordre valide qui ne vise
        // pas ce qu'on croit.
        let plan = planifier(&InstanceAction::DropDatabase {
            name: r#"o"brien"#.to_owned(),
        });
        assert_eq!(plan.statements, vec![r#"DROP DATABASE "o""brien";"#]);
    }

    #[test]
    fn supprimer_un_role_part_en_trois_ordres_dans_cet_ordre() {
        let plan = planifier(&InstanceAction::DropRole {
            name: "analytics_bi".to_owned(),
            reassign_to: "postgres".to_owned(),
        });
        assert_eq!(
            plan.statements,
            vec![
                r#"REASSIGN OWNED BY "analytics_bi" TO "postgres";"#,
                r#"DROP OWNED BY "analytics_bi";"#,
                r#"DROP ROLE "analytics_bi";"#,
            ]
        );
        assert!(plan.destructive);
        // La note dit ce que le SQL ne dit pas : pourquoi trois ordres, et leur portée.
        assert!(plan.note.contains("base courante"), "{}", plan.note);
    }

    #[test]
    fn retirer_une_extension_reste_en_restrict() {
        // **En négatif, délibérément.** `CASCADE` est le mot qu'on ajoute « pour que ça marche »
        // quand l'ordre échoue, et il emporterait en silence les tables et les types qui dépendent
        // de l'extension. Le test existe pour que ce changement-là soit visible en revue.
        let plan = planifier(&InstanceAction::DropExtension {
            name: "postgis".to_owned(),
        });
        assert_eq!(
            plan.statements,
            vec![r#"DROP EXTENSION "postgis" RESTRICT;"#]
        );
        assert!(!plan.statements[0].contains("CASCADE"));
    }

    #[test]
    fn un_mot_de_passe_absent_n_ecrit_pas_password() {
        // **Et surtout pas `PASSWORD NULL`**, qui le *retirerait* : le champ vide veut dire « laisser
        // en place », la règle du mot de passe de `mettre_a_jour`. C'est le genre d'écart qu'un test
        // en positif ne verrait pas — l'ordre serait valide, et le rôle deviendrait injoignable.
        let plan = planifier(&InstanceAction::AlterRole {
            name: "bi".to_owned(),
            attributes: attributs(),
            verifier: None,
        });
        assert!(
            !plan.statements[0].contains("PASSWORD"),
            "{:?}",
            plan.statements
        );
        // Et le geste n'est alors pas destructeur : un attribut se défait en décochant.
        assert!(!plan.destructive);
    }

    #[test]
    fn un_mot_de_passe_present_tient_dans_le_meme_ordre_que_les_attributs() {
        // **Un seul ordre, non deux.** Deux ordres pourraient s'appliquer à moitié — les attributs
        // posés, le mot de passe non — et ce geste n'a aucune transaction pour l'en empêcher.
        let plan = planifier(&InstanceAction::AlterRole {
            name: "bi".to_owned(),
            attributes: attributs(),
            verifier: Some("SCRAM-SHA-256$4096:c2Vs$c3Rv:c2Vy".to_owned()),
        });
        assert_eq!(
            plan.statements,
            vec![
                r#"ALTER ROLE "bi" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'SCRAM-SHA-256$4096:c2Vs$c3Rv:c2Vy';"#
            ]
        );
        // Il remplace ce que rien ne rend : ni la base ni DoraBase ne gardent l'ancien en clair.
        assert!(plan.destructive);
        assert!(plan.note.contains("vérificateur"), "{}", plan.note);
    }

    #[test]
    fn alter_role_ecrit_les_quatre_attributs_dans_les_deux_sens() {
        // Le point : décocher « superutilisateur » doit produire `NOSUPERUSER`. Une composition qui
        // n'écrirait que les attributs cochés ferait un ALTER qui n'enlève rien — sans erreur.
        let plan = planifier(&InstanceAction::AlterRole {
            name: "bi".to_owned(),
            attributes: attributs(),
            verifier: None,
        });
        assert_eq!(
            plan.statements,
            vec![r#"ALTER ROLE "bi" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;"#]
        );
    }

    #[test]
    fn une_valeur_de_parametre_est_un_litteral_cite() {
        // `ALTER SYSTEM SET` n'accepte pas de paramètre préparé : la valeur traverse le SQL, donc
        // elle est citée. L'apostrophe est le caractère qui le prouve.
        let plan = planifier(&InstanceAction::SetParameter {
            name: "log_line_prefix".to_owned(),
            value: "%m [%p] l'appli ".to_owned(),
        });
        assert_eq!(
            plan.statements,
            vec![r#"ALTER SYSTEM SET "log_line_prefix" = '%m [%p] l''appli ';"#]
        );
    }

    #[test]
    fn creer_une_base_sans_proprietaire_n_ecrit_pas_owner() {
        // Un `OWNER ""` serait refusé par le serveur, et un `OWNER` collé à rien serait une syntaxe
        // invalide : le champ vide de la modale doit donc disparaître de l'ordre, pas s'y écrire.
        for vide in [None, Some(String::new()), Some("   ".to_owned())] {
            let plan = planifier(&InstanceAction::CreateDatabase {
                name: "analytics".to_owned(),
                owner: vide.clone(),
            });
            assert_eq!(
                plan.statements,
                vec![r#"CREATE DATABASE "analytics";"#],
                "{vide:?}"
            );
        }
    }

    #[test]
    fn chaque_geste_destructeur_est_marque_comme_tel() {
        // Le drapeau décide de la couleur du bouton d'exécution. Un `DROP` en `--accent` se
        // cliquerait comme un enregistrement.
        let destructeurs = [
            InstanceAction::DropDatabase {
                name: "x".to_owned(),
            },
            InstanceAction::DropRole {
                name: "x".to_owned(),
                reassign_to: "y".to_owned(),
            },
            InstanceAction::TerminateSession { pid: 42 },
            InstanceAction::DropExtension {
                name: "x".to_owned(),
            },
            InstanceAction::ResetParameter {
                name: "x".to_owned(),
            },
            InstanceAction::RevokeDatabase {
                role: "r".to_owned(),
                database: "d".to_owned(),
                privilege: DatabasePrivilege::Connect,
            },
        ];
        for action in destructeurs {
            assert!(planifier(&action).destructive, "{action:?}");
        }

        let sans_danger = [
            InstanceAction::CreateDatabase {
                name: "x".to_owned(),
                owner: None,
            },
            InstanceAction::CreateRole {
                name: "x".to_owned(),
                attributes: attributs(),
                verifier: None,
            },
            InstanceAction::GrantDatabase {
                role: "r".to_owned(),
                database: "d".to_owned(),
                privilege: DatabasePrivilege::Connect,
            },
        ];
        for action in sans_danger {
            assert!(!planifier(&action).destructive, "{action:?}");
        }
    }

    #[test]
    fn un_compte_de_lecture_seule_voit_ses_refus_nommes() {
        let capacites = capacites(false, false, false);
        let refuses: Vec<_> = capacites.iter().filter(|c| !c.allowed).collect();
        assert!(!refuses.is_empty());
        for capacite in refuses {
            let raison = capacite.reason.as_deref().unwrap_or_default();
            // La raison **nomme ce qui manque** : « action indisponible » n'apprendrait rien, et
            // c'est elle qui remplit le `title` d'un contrôle désactivé.
            assert!(!raison.is_empty(), "{:?}", capacite.gesture);
        }
        // Terminer sa propre session reste permis quel que soit le compte : sans cela, la section
        // Sessions serait entièrement grisée pour un rôle qui peut parfaitement se déconnecter.
        assert!(capacites
            .iter()
            .any(|c| c.gesture == InstanceGesture::TerminateSession && c.allowed));
    }

    #[test]
    fn un_superutilisateur_a_les_onze_gestes() {
        let capacites = capacites(true, false, false);
        assert_eq!(capacites.len(), InstanceGesture::TOUS.len());
        assert!(capacites.iter().all(|c| c.allowed), "{capacites:?}");
        // Et aucune raison ne traîne sur un geste permis : elle s'afficherait en infobulle d'un
        // contrôle actif, comme une limite qui n'existe pas.
        assert!(capacites.iter().all(|c| c.reason.is_none()));
    }
}
