//! Le gestionnaire d'instances (`API-32`) : ce qu'une instance managée sait dire d'elle-même, et
//! ce qu'on peut lui demander de faire.
//!
//! # Ce que ce module n'est pas
//!
//! Ce n'est pas un huitième moteur. Une instance se joint par le **même** adaptateur qu'une base —
//! `AnyEngine::connect_via`, le même registre, le même proxy — et ce qui change est la *question*
//! qu'on pose : non plus « quelles tables y a-t-il dans ce schéma », mais « quels rôles existent sur
//! ce serveur, et qui a le droit de se connecter à quoi ». Les types ci-dessous décrivent ces
//! réponses-là.
//!
//! # Sept lectures et douze gestes, et pourquoi ils ne sont pas au contrat de moteur
//!
//! `EngineAdapter` décrit ce que **tout** moteur doit savoir faire. L'administration n'en est pas :
//! le niveau « rôle du serveur » n'existe pas chez SQLite, qui est un fichier, ni chez BigQuery, dont
//! les autorisations sont celles d'IAM. L'inscrire au contrat obligerait cinq adaptateurs à déclarer
//! des méthodes qui refusent — et le jour où un sixième moteur arrive, son auteur devrait écrire
//! douze refus avant de compiler.
//!
//! C'est donc une capacité **inhérente à `PostgresAdapter`**, choisie par un `match` exhaustif dans
//! `AnyEngine` où les quatre autres moteurs sont **nommés un par un** : la leçon du défaut n° 16, où
//! un bras attrape-tout avait absorbé deux moteurs livrés.

pub mod commands;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Les six tuiles de la vue d'ensemble, plus l'identité de la connexion.
///
/// **Un seul aller-retour pour toute la section**, et non une commande par tuile : elles décrivent
/// le même instant, et six lectures successives afficheraient six instants voisins — un compte de
/// connexions relevé avant les bases, une taille relevée après. La barre annonce « relevé il y a
/// 12 s » ; cette phrase n'est vraie que si tout vient du même relevé.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceOverview {
    /// « PostgreSQL 17.6 », abrégée comme partout ailleurs dans le produit.
    pub server_version: String,
    /// Depuis combien de temps le serveur tourne.
    ///
    /// `None` quand le serveur ne le dit pas : `pg_postmaster_start_time()` demande un droit que
    /// tous les rôles n'ont pas. Un zéro y serait un mensonge — « démarré à l'instant » — là où un
    /// tiret dit « nous ne savons pas », la distinction que `RowCount::Unknown` a déjà coûtée une
    /// fois.
    #[ts(type = "number | null")]
    pub uptime_seconds: Option<i64>,
    /// Les connexions ouvertes **sur tout le serveur**, et le plafond de `max_connections`.
    #[ts(type = "number")]
    pub connections: i64,
    #[ts(type = "number")]
    pub max_connections: i64,
    #[ts(type = "number")]
    pub databases: i64,
    #[ts(type = "number")]
    pub roles: i64,
    /// La somme des tailles des bases, quand elles sont toutes mesurables.
    ///
    /// `None` dès qu'une base refuse `pg_database_size` — ce qui arrive à un rôle non
    /// superutilisateur sur une base dont il n'a pas `CONNECT`. **Une somme partielle serait pire
    /// qu'aucune** : elle s'afficherait comme la taille de l'instance en en taisant une part.
    #[ts(type = "number | null")]
    pub total_size_bytes: Option<i64>,
    /// L'identité de la connexion, telle que la vue d'ensemble l'affiche.
    pub identity: InstanceIdentity,
    /// Ce que ce compte a le droit de faire, geste par geste.
    pub capabilities: Vec<Capability>,
}

/// Avec quoi on est connecté — le bloc que la vue d'ensemble affiche sous les tuiles.
///
/// **Rendu par le cœur et non recomposé par l'écran**, bien que l'écran connaisse la déclaration :
/// `role` est ce que `current_user` répond, qui n'est pas forcément l'utilisateur déclaré — `SET
/// ROLE`, un `pg_hba` en `map=`, une authentification IAM. Et `tls` dit ce que la session **est**,
/// non ce que le formulaire a demandé : un `prefer` qui a replié en clair afficherait « chiffré »
/// si on lisait le réglage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceIdentity {
    /// L'hôte et le port **effectivement joints** : `127.0.0.1` et le port local quand un proxy
    /// s'interpose, comme le dump le fait déjà. Mentir ici enverrait chercher une panne réseau là
    /// où c'est le tunnel qui parle.
    pub host: String,
    pub port: u16,
    /// Le rôle de la session — `current_user`.
    pub role: String,
    /// La base de service à laquelle on est connecté.
    pub database: String,
    /// Vrai quand la session est chiffrée, lu dans `pg_stat_ssl` pour notre propre backend.
    pub tls: bool,
    /// Le chiffre de la session, quand il y en a un — « TLSv1.3 / TLS_AES_256_GCM_SHA384 ».
    pub tls_cipher: Option<String>,
    /// Où le mot de passe est rangé : « Trousseau » ou « fichier chiffré ».
    ///
    /// **Le mécanisme, jamais le secret ni sa référence.** C'est le badge que `A2` affiche déjà, et
    /// la question à laquelle il répond est « puis-je me fier à ce rangement ? ».
    pub secret_location: Option<String>,
}

/// Les gestes que le gestionnaire propose. Une énumération **fermée** : un geste qui n'y est pas
/// n'est pas exprimable, donc pas exécutable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub enum InstanceGesture {
    CreateDatabase,
    AlterDatabase,
    DropDatabase,
    CreateRole,
    AlterRole,
    DropRole,
    GrantPrivilege,
    TerminateSession,
    CreateExtension,
    DropExtension,
    SetParameter,
}

impl InstanceGesture {
    /// Les onze gestes, dans l'ordre où la vue d'ensemble les liste.
    ///
    /// Même patron qu'`Engine::tous`, et le même garde-fou : le test `chaque_geste_est_liste` porte
    /// un `match` exhaustif, qui casse la compilation à l'ajout d'un douzième, et son assertion
    /// tombe ensuite s'il n'est pas entré ici. Un tableau littéral seul ne peut pas être vérifié.
    pub const TOUS: [InstanceGesture; 11] = [
        Self::CreateDatabase,
        Self::AlterDatabase,
        Self::DropDatabase,
        Self::CreateRole,
        Self::AlterRole,
        Self::DropRole,
        Self::GrantPrivilege,
        Self::TerminateSession,
        Self::CreateExtension,
        Self::DropExtension,
        Self::SetParameter,
    ];
}

/// Un geste, et le droit qu'a ce compte de le faire.
///
/// # Pourquoi le cœur répond à cette question, plutôt que l'écran ne devine
///
/// Le ticket le pose en toutes lettres : DoraBase lit `pg_roles` à l'ouverture et **nomme les gestes
/// que ce compte n'a pas le droit de faire**, plutôt que de laisser les boutons échouer. Un bouton
/// qui part et revient avec « permission denied for database » est le défaut n° 36 avec un aller-
/// retour en plus : on apprend l'interdit *après* avoir agi, et sur un serveur de production.
///
/// **`reason` est portée, jamais reconstruite à l'écran.** C'est elle qui remplit le `title` d'un
/// contrôle désactivé, et elle nomme l'attribut qui manque — « le rôle n'a pas CREATEDB » — non un
/// « action indisponible » qui n'apprend rien.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct Capability {
    pub gesture: InstanceGesture,
    pub allowed: bool,
    /// Pourquoi ce geste est refusé. `None` quand il est permis.
    pub reason: Option<String>,
}

/// Une base de l'instance — la section « Bases ».
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceDatabase {
    pub name: String,
    pub owner: String,
    pub encoding: String,
    pub collation: String,
    /// `None` quand le rôle ne peut pas la mesurer — voir `InstanceOverview::total_size_bytes`.
    #[ts(type = "number | null")]
    pub size_bytes: Option<i64>,
    /// Les sessions ouvertes sur cette base.
    #[ts(type = "number")]
    pub connections: i64,
    /// Un modèle (`template0`, `template1`) : il se liste, mais ne se supprime pas.
    pub is_template: bool,
    /// `datallowconn` : une base qui refuse les connexions.
    pub allow_connections: bool,
}

/// Un rôle du serveur — la section « Utilisateurs ».
///
/// **« Rôle » et non « utilisateur », dans le modèle.** PostgreSQL n'a que des rôles depuis la 8.1 ;
/// un « utilisateur » y est exactement un rôle avec `LOGIN`. Le nommer autrement dans le code aurait
/// fait chercher une notion qui n'existe pas dans le catalogue. L'écran, lui, garde le mot de la
/// maquette pour son titre de section — c'est celui qu'on cherche.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceRole {
    pub name: String,
    /// `rolcanlogin` : ce qui décide de l'icône `key` plutôt que `lock`.
    pub can_login: bool,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    /// `rolvaliduntil`, en texte : rien ne calcule dessus, et le formatage appartient à l'écran, qui
    /// seul connaît la locale. C'est la règle des horodatages de l'introspection.
    pub valid_until: Option<String>,
    /// Les rôles dont celui-ci est membre — la colonne « membre de ».
    pub member_of: Vec<String>,
    /// Le nombre de bases dont ce rôle est **propriétaire**.
    ///
    /// C'est ce que la colonne « bases » dit, et c'est le nombre qui compte avant de supprimer :
    /// un rôle qui possède des bases ne se supprime pas sans les réattribuer, et c'est exactement ce
    /// que le `REASSIGN OWNED` de la confirmation fait.
    #[ts(type = "number")]
    pub owned_databases: i64,
    /// Un rôle du système (`pg_read_all_data`, `pg_monitor`…), que le catalogue livre avec le
    /// serveur.
    ///
    /// **Listé et marqué, jamais tu** : c'est l'arbitrage des schémas de catalogue d'`API-33`. Ils
    /// existent, ils apparaissent dans les privilèges, et ne pas les montrer ferait chercher d'où
    /// vient un droit. Ce sont eux, en revanche, que la suppression refuse.
    pub system: bool,
}

/// Une cellule de la matrice rôle × base — la section « Privilèges ».
///
/// **Trois booléens et non une chaîne « CTc »**, bien que ce soit ce que la cellule affiche : la
/// composition du sigle appartient à l'écran, et un `grant` porte sur **un** privilège. Rendre la
/// chaîne obligerait le front à la défaire pour savoir quoi révoquer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstancePrivilege {
    pub role: String,
    pub database: String,
    /// `CREATE` — créer un schéma dans cette base.
    pub create: bool,
    /// `TEMPORARY` — y créer des tables temporaires.
    pub temporary: bool,
    /// `CONNECT` — s'y connecter, sans quoi les deux autres ne servent à rien.
    pub connect: bool,
}

/// Les trois privilèges de niveau base. Fermés : `has_database_privilege` n'en connaît pas d'autres.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub enum DatabasePrivilege {
    Create,
    Temporary,
    Connect,
}

impl DatabasePrivilege {
    /// Le mot que le SQL emploie. **Le sigle affiché n'est pas ce mot** : la maquette écrit `C`,
    /// `T`, `c`, et confondre les deux ferait partir un `grant C`.
    pub fn mot_sql(self) -> &'static str {
        match self {
            Self::Create => "CREATE",
            Self::Temporary => "TEMPORARY",
            Self::Connect => "CONNECT",
        }
    }
}

/// Une session ouverte — la section « Sessions ».
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceSession {
    #[ts(type = "number")]
    pub pid: i32,
    /// `None` pour un processus interne du serveur — l'autovacuum, le writer — qui n'a pas de rôle.
    pub user: Option<String>,
    pub database: Option<String>,
    /// L'adresse du client, ou « local » pour une connexion par socket unix.
    pub client: String,
    /// **Qui a ouvert cette session**, autant que le serveur puisse le dire (9 septembre 2026, à la
    /// demande).
    ///
    /// # Ce que ce champ est, et ce qu'il ne peut pas être
    ///
    /// Le PID de `pg_stat_activity` est celui du **backend serveur** — le processus que PostgreSQL a
    /// forké pour servir la connexion —, jamais celui du client. Il n'existe donc **aucun moyen**,
    /// depuis le serveur, de remonter au processus qui s'est connecté : il tourne le plus souvent
    /// sur une autre machine, et rien dans le protocole ne transporte son identité système.
    ///
    /// Ce que le serveur sait est ce que le client **déclare** de lui-même : `application_name`,
    /// posé par `psql`, `pgAdmin`, un pilote JDBC, ou DoraBase. C'est la réponse pratique à « qui a
    /// ouvert cette connexion », et c'est la seule qui ne soit pas une invention.
    ///
    /// Pour un processus **interne** du serveur — l'autovacuum, le writer, le checkpointer — il n'y
    /// a pas de client à nommer : `backend_type` prend alors le relais et dit lequel c'est. Sans
    /// lui, la ligne d'un `autovacuum launcher` n'aurait ni utilisateur, ni base, ni nom : trois
    /// tirets et un PID.
    ///
    /// `None` quand ni l'un ni l'autre ne dit rien — un client qui n'a pas posé de nom sur un
    /// serveur antérieur à la 10. La colonne y met le tiret cadratin : « nous ne savons pas » n'est
    /// pas « personne ».
    pub process: Option<String>,
    /// `active`, `idle`, `idle in transaction`… tel que `pg_stat_activity` le dit.
    pub state: Option<String>,
    /// Depuis combien de temps la session est dans cet état.
    #[ts(type = "number | null")]
    pub duration_seconds: Option<i64>,
    /// Vrai pour **notre propre** session.
    ///
    /// **Le cœur le dit, l'écran ne le devine pas.** Comparer des PID côté front demanderait de lui
    /// envoyer le nôtre, donc une seconde vérité ; et c'est cette ligne-là qu'il ne faut pas
    /// proposer de terminer — se couper la branche à laquelle on est assis fermerait l'écran qui
    /// vient d'exécuter l'ordre.
    pub is_self: bool,
}

/// Une extension — la section « Extensions ».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceExtension {
    pub name: String,
    /// La version en place, ou `None` : l'extension est **disponible** mais pas installée.
    pub installed_version: Option<String>,
    /// La version que le serveur installerait.
    pub default_version: Option<String>,
    /// La base où la lecture a eu lieu.
    ///
    /// # Pourquoi une seule base, et pourquoi la colonne existe quand même
    ///
    /// `pg_extension` est un catalogue **par base** : une extension installée dans `analytics` ne
    /// paraît pas dans `postgres`. Les lire toutes demanderait une connexion par base — donc une
    /// poignée de main, un tunnel, et un refus pour chaque base où le rôle n'a pas `CONNECT`, sur
    /// une section qu'on ouvre en passant.
    ///
    /// La lecture porte donc sur la **base de service** de l'instance, celle du formulaire, et cette
    /// colonne la nomme. C'est l'honnêteté des deux nombres de la barre d'état du diagramme, sur une
    /// autre affirmation : une section « Extensions » qui tairait sa portée se lirait comme la liste
    /// des extensions du serveur, ce qu'elle n'est pas.
    pub database: String,
    pub schema: Option<String>,
}

/// Un paramètre de configuration — la section « Paramètres ».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceSetting {
    pub name: String,
    pub value: String,
    pub unit: Option<String>,
    /// `internal`, `postmaster`, `sighup`, `superuser`, `user`… : ce qui décide si un changement
    /// demande un redémarrage, et si ce rôle peut le faire.
    pub context: String,
    /// D'où vient la valeur : `default`, `configuration file`, `override`…
    pub source: String,
    /// `pending_restart` : la valeur a été changée et n'aura d'effet qu'au redémarrage.
    pub pending_restart: bool,
    /// Vrai quand `ALTER SYSTEM SET` a un sens pour ce paramètre.
    ///
    /// **Faux pour un `internal`**, que le serveur calcule à la compilation (`block_size`,
    /// `segment_size`) : le proposer donnerait un champ qui échoue toujours.
    pub settable: bool,
}

/// Ce qu'on demande à une instance de faire.
///
/// # Une énumération portée par l'IPC, et non une chaîne de SQL
///
/// L'écran n'envoie **jamais** de SQL. C'est le cœur qui le compose, à partir d'un geste nommé et de
/// ses paramètres, et qui le rend pour que la confirmation le montre. L'inverse — le front compose,
/// le cœur exécute — mettrait la citation des identifiants et le choix entre `RESTRICT` et `CASCADE`
/// dans l'écran, c'est-à-dire hors de portée des tests du cœur et à la merci d'un nom de rôle
/// contenant un guillemet.
///
/// C'est la règle que `row_as_insert` et `preview_updates` posent déjà : ce qui demande de connaître
/// les règles du moteur appartient à l'adaptateur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "instances.ts")]
pub enum InstanceAction {
    CreateDatabase {
        name: String,
        /// `None` laisse le propriétaire par défaut, qui est le rôle courant.
        owner: Option<String>,
    },
    /// Change le propriétaire d'une base. Le renommage n'y est **pas** : il casserait toute
    /// connexion déclarée qui la vise, et DoraBase n'a aucun moyen de les suivre.
    AlterDatabaseOwner {
        name: String,
        owner: String,
    },
    DropDatabase {
        name: String,
    },
    CreateRole {
        name: String,
        attributes: RoleAttributes,
        /// Le mot de passe, quand le formulaire en porte un — **le vérificateur SCRAM, jamais la
        /// saisie**. Voir `RoleAttributes` et `postgres::scram`.
        verifier: Option<String>,
    },
    AlterRole {
        name: String,
        attributes: RoleAttributes,
        /// Idem, et `None` **laisse le mot de passe en place**.
        ///
        /// C'est la règle du champ vide de `mettre_a_jour`, appliquée ici : corriger un attribut ne
        /// doit pas obliger à retaper un mot de passe, et l'oublier ne doit pas l'effacer. Rien dans
        /// le SQL composé ne le mentionne alors — un `PASSWORD NULL` retirerait le mot de passe.
        verifier: Option<String>,
    },
    /// Supprime un rôle, en trois ordres.
    ///
    /// `reassign_to` reçoit ce que le rôle possède. **Obligatoire, non optionnel** : un `DROP ROLE`
    /// seul échoue dès que le rôle possède quoi que ce soit, avec un message qui énumère les objets ;
    /// laisser le choix « avec ou sans réattribution » offrirait une option dont l'une des deux
    /// valeurs ne marche presque jamais.
    DropRole {
        name: String,
        reassign_to: String,
    },
    GrantDatabase {
        role: String,
        database: String,
        privilege: DatabasePrivilege,
    },
    RevokeDatabase {
        role: String,
        database: String,
        privilege: DatabasePrivilege,
    },
    TerminateSession {
        #[ts(type = "number")]
        pid: i32,
    },
    CreateExtension {
        name: String,
    },
    DropExtension {
        name: String,
    },
    /// `ALTER SYSTEM SET`. La valeur est passée en **littéral cité**, jamais interpolée nue.
    SetParameter {
        name: String,
        value: String,
    },
    /// `ALTER SYSTEM RESET` : rend le paramètre à ce que le fichier de configuration dit.
    ResetParameter {
        name: String,
    },
}

/// Les attributs d'un rôle qu'un `CREATE`/`ALTER ROLE` pose.
///
/// **Une structure et non six paramètres**, parce que `AlterRole` les pose *tous* à chaque fois :
/// PostgreSQL n'a pas de « laisser inchangé » dans `ALTER ROLE`, et un formulaire qui n'enverrait
/// que ce qui a changé demanderait de savoir ce qui était là — donc de relire, donc d'écraser ce
/// qu'un autre aurait changé entre-temps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct RoleAttributes {
    pub can_login: bool,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
}

impl RoleAttributes {
    /// Le geste dont ce jeu d'attributs relève.
    ///
    /// **`SUPERUSER` ne se donne que par un superutilisateur**, et `CREATEROLE` ne suffit pas —
    /// PostgreSQL le refuse avec « must be superuser to create superusers ». Le savoir ici plutôt
    /// qu'à l'écran évite qu'un formulaire propose une case qui fera échouer tout l'ordre.
    pub fn exige_le_superutilisateur(self) -> bool {
        self.superuser
    }
}

/// Le SQL d'un geste, **avant** de partir.
///
/// # Ce que porte `note`, et pourquoi ce n'est pas dans le SQL
///
/// La confirmation montre les ordres dans l'ordre où ils partent, et une ligne sous l'encart dit ce
/// que le SQL **ne dit pas** : pourquoi trois ordres pour supprimer un rôle, pourquoi `RESTRICT` et
/// non `CASCADE`, que `REASSIGN OWNED` se rejoue base par base. Un commentaire SQL l'aurait dit
/// *dans* l'encart, donc dans ce qui part — et le premier lecteur à copier le bloc pour le rejouer
/// dans `psql` aurait emporté nos explications avec.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstancePlan {
    /// Les ordres, dans l'ordre d'exécution. Ce qui est affiché **est** ce qui part.
    pub statements: Vec<String>,
    /// Ce que le SQL ne dit pas. Vide quand il n'y a rien à ajouter.
    pub note: String,
    /// Vrai quand le geste retire quelque chose : le bouton d'exécution passe en `--danger`.
    pub destructive: bool,
}

/// Ce qu'une exécution rend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "instances.ts")]
pub struct InstanceOutcome {
    /// Les ordres réellement exécutés — **les mêmes** que ceux du plan.
    pub statements: Vec<String>,
    /// Une phrase qui dit ce qui s'est passé, dans les termes du geste.
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chaque_geste_est_liste() {
        // Le `match` casse la compilation à l'ajout d'un douzième geste ; l'assertion tombe ensuite
        // s'il n'entre pas dans `TOUS`. Les deux étapes sont nécessaires — c'est le garde-fou
        // d'`Engine::tous`, et il a été écrit parce qu'un tableau littéral ne se vérifie pas.
        for geste in InstanceGesture::TOUS {
            match geste {
                InstanceGesture::CreateDatabase
                | InstanceGesture::AlterDatabase
                | InstanceGesture::DropDatabase
                | InstanceGesture::CreateRole
                | InstanceGesture::AlterRole
                | InstanceGesture::DropRole
                | InstanceGesture::GrantPrivilege
                | InstanceGesture::TerminateSession
                | InstanceGesture::CreateExtension
                | InstanceGesture::DropExtension
                | InstanceGesture::SetParameter => {}
            }
        }
        assert_eq!(
            InstanceGesture::TOUS.len(),
            InstanceGesture::TOUS
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            "un geste est listé deux fois"
        );
    }

    #[test]
    fn les_sigles_de_la_matrice_ne_sont_pas_les_mots_du_sql() {
        // La maquette écrit `C`, `T`, `c` ; le SQL veut `CREATE`, `TEMPORARY`, `CONNECT`. Le test
        // existe parce que la tentation de faire porter le sigle par le modèle est réelle — et
        // qu'un `grant C on database` échoue avec un message de syntaxe qui n'accuse rien.
        assert_eq!(DatabasePrivilege::Create.mot_sql(), "CREATE");
        assert_eq!(DatabasePrivilege::Temporary.mot_sql(), "TEMPORARY");
        assert_eq!(DatabasePrivilege::Connect.mot_sql(), "CONNECT");
    }
}
