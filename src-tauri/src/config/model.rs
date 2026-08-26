use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Les sept moteurs du handoff, et rien d'autre : un moteur inconnu ne compile pas.
// Noms sérialisés **explicites**, et non dérivés : `rename_all = "kebab-case"` produisait
// « postgre-sql », « my-sql », « mongo-db », « big-query » — valeurs qui auraient fini
// telles quelles dans le fichier de configuration de `05b`, où l'utilisateur peut les
// lire. Les changer après coup serait une migration. Constaté en relisant la projection
// TypeScript générée, pas en lisant le code Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    #[serde(rename = "postgresql")]
    PostgreSql,
    #[serde(rename = "mysql")]
    MySql,
    Sqlite,
    #[serde(rename = "mongodb")]
    MongoDb,
    Redis,
    Snowflake,
    #[serde(rename = "bigquery")]
    BigQuery,
}

/// L'identifiant **stable** d'un environnement, dans la portée d'un projet (`23a`).
///
/// # Pourquoi un identifiant distinct du libellé
///
/// La référence d'un mot de passe dans le trousseau vaut `dorabase/<projet>/<base>/<environnement>`
/// (`08e`), et c'est cet identifiant qui y figure. S'il suivait le libellé, renommer « prod » en
/// « production » rendrait introuvables **tous les mots de passe du projet** — sans erreur, sans
/// message : des connexions qui redemanderaient leur mot de passe sans raison visible.
///
/// Il est donc dérivé du libellé **une fois**, à la création, puis figé. C'est exactement le rôle que
/// tenait `EnvironmentId::slug()` quand les environnements étaient une énumération de trois valeurs.
///
/// # Pourquoi un type nommé et non un `String`
///
/// Une signature `fn variant(&self, environment: &str)` accepterait un nom de base par erreur. Le type
/// coûte une ligne et rend la confusion impossible — même raison que `SecretRef`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
// `#[ts(type = "string")]` : `ts-rs` projetterait la structure au lieu de la chaîne qu'elle
// transporte, et le front recevrait un `{ 0: string }` là où le JSON porte `"dev"` — une dérive que
// seul l'écran verrait.
//
// **Pas de `#[serde(transparent)]`, et c'est une correction.** Il y était, et il était superflu :
// `serde` traite déjà un newtype comme sa valeur interne. Son seul effet observable était un
// avertissement à chaque compilation — « ts-rs failed to parse this attribute » — imprimé jusque dans
// la sortie de `tauri dev`. Un attribut sans effet qui fait du bruit est un attribut à retirer.
#[ts(type = "string")]
pub struct EnvironmentId(String);

impl EnvironmentId {
    /// Dérive un identifiant d'un libellé : minuscules, et tout ce qui n'est ni lettre ni chiffre
    /// devient un tiret.
    ///
    /// **Le résultat n'est pas garanti unique**, et ce n'est pas son rôle : c'est le projet qui refuse
    /// un doublon (voir `Project::new`). Un libellé vide, ou fait de seuls séparateurs, rend `env` —
    /// un identifiant valable, que le projet dédoublonnera si besoin.
    pub fn depuis_le_libelle(libelle: &str) -> Self {
        let mut brut = String::new();
        for caractere in libelle.chars() {
            if caractere.is_ascii_alphanumeric() {
                brut.extend(caractere.to_lowercase());
            } else if !brut.ends_with('-') {
                brut.push('-');
            }
        }
        let taille = brut.trim_matches('-');
        Self(if taille.is_empty() {
            "env".to_owned()
        } else {
            taille.to_owned()
        })
    }

    /// Reprend un identifiant déjà écrit — configuration lue, migration, décor de test.
    pub fn brut(valeur: impl Into<String>) -> Self {
        Self(valeur.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EnvironmentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// La couleur d'un environnement : la pastille du sélecteur, et rien de plus.
///
/// **Cinq jetons existants, pas un sélecteur de teinte.** Un client de bases n'est pas un éditeur de
/// thème, et une couleur libre finirait par produire des pastilles indistinguables — ce qui coûterait
/// précisément l'information qu'elles portent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentColor {
    Green,
    Amber,
    Red,
    Slate,
    Violet,
}

/// Un environnement **déclaré par un projet** (`23a`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct EnvironmentDeclaration {
    pub id: EnvironmentId,
    pub label: String,
    pub color: EnvironmentColor,
    /// Ce qui déclenche les garde-fous d'écriture (`11d`) et l'encart rouge.
    ///
    /// **Un drapeau, jamais le libellé.** Un environnement nommé « live » et marqué production doit
    /// être protégé ; un environnement nommé « prod » que l'utilisateur n'a pas marqué ne l'est pas.
    /// Accrocher une garantie à une chaîne de caractères la rendrait fausse au premier renommage.
    pub production: bool,
}

impl EnvironmentDeclaration {
    /// Le trio du handoff, que reçoit tout projet neuf (`23a`).
    pub fn trio_par_defaut() -> Vec<Self> {
        vec![
            Self {
                id: EnvironmentId::brut("dev"),
                label: "dev".to_owned(),
                color: EnvironmentColor::Green,
                production: false,
            },
            Self {
                id: EnvironmentId::brut("staging"),
                label: "staging".to_owned(),
                color: EnvironmentColor::Amber,
                production: false,
            },
            Self {
                id: EnvironmentId::brut("prod"),
                label: "prod".to_owned(),
                color: EnvironmentColor::Red,
                production: true,
            },
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "config.ts")]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    Allow,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

/// Référence vers un secret rangé par `05c` — **jamais sa valeur**.
///
/// Type distinct plutôt qu'un alias de `String` : une valeur de secret ne peut pas y
/// être affectée par erreur, puisqu'aucune conversion implicite n'existe. Rien à
/// divulguer ici de toute façon, une référence n'est pas un secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(
    export_to = "../../src/domain/config.ts",
    type = "string & { readonly __secretRef: unique symbol }"
)]
pub struct SecretRef(String);

impl SecretRef {
    pub fn new(reference: impl Into<String>) -> Self {
        Self(reference.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Un bastion SSH. Le **chemin** de la clé privée est de la configuration, pas un
/// secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ProxySsh {
    pub bastion_host: String,
    pub bastion_port: u16,
    pub username: String,
    pub private_key_path: String,
}

/// Le Cloud SQL Auth Proxy de Google. Ouvert par `06g`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ProxyCloudSql {
    /// `projet:région:instance`, la forme exigée par le proxy. **Non validée ici** :
    /// `06g` refuse à l'ouverture, avec le message du proxy lui-même.
    ///
    /// **Un seul champ, et c'est délibéré** (`06j`, 24 août 2026). Un `credentials_file_path`
    /// a existé ici jusqu'à la v3 du fichier de configuration. Il a été retiré parce que
    /// l'authentification passe désormais par les identifiants par défaut de l'application
    /// (`06i`) : un chemin de compte de service reste possible par la variable
    /// `GOOGLE_APPLICATION_CREDENTIALS`, que le proxy lit tout seul, et qui ne coûte ni un
    /// champ dans `A2`, ni une valeur à persister. Le cran de migration v3 → v4 retire la
    /// clé des fichiers existants.
    ///
    /// **Et toujours un seul** (`06k`, 24 août 2026). L'authentification IAM de base de
    /// données a d'abord été un booléen ici, puis une bascule dans `A2` ; les deux sont
    /// partis le jour même, sur décision : le mode est **toujours** actif. Un booléen dont
    /// la seule valeur possible est celle que le code applique de toute façon ne décrit rien
    /// — il donne seulement l'occasion de diverger.
    pub instance_connection_name: String,
}

/// Ce qui **diffère** entre les deux sortes de proxy.
///
/// **Une énumération et non des champs optionnels.** Un `Tunnel` plat portant les champs
/// des deux autoriserait `kind: "cloud-sql"` avec un bastion renseigné et aucune instance.
/// `05a` pose que les invariants sont portés par le typage plutôt qu'en commentaire ; c'en
/// est un. Le coût — un `match` là où il y avait un accès de champ — est le bénéfice :
/// l'ajout d'une troisième sorte fera échouer la compilation aux endroits à traiter.
///
/// Vérifié : un `match` omettant `CloudSql` échoue en `E0004` (relevé le 19 août 2026).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export_to = "config.ts")]
pub enum Proxy {
    Ssh(ProxySsh),
    CloudSql(ProxyCloudSql),
}

/// Le panneau « Proxy / tunnel » de `A2`, tel qu'il est configuré.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct Tunnel {
    /// `None` signifie « auto » — le port local est choisi à l'ouverture par `06`.
    ///
    /// **Hors de `Proxy`, et c'est le point** : il est vrai des deux sortes. Le dupliquer
    /// dans chaque variante obligerait chaque lecteur à faire un `match` pour lire une
    /// donnée qui ne varie pas.
    pub local_port: Option<u16>,
    pub proxy: Proxy,
}

/// Les réglages de connexion d'une connexion déclarée. Tout le formulaire de `A2` vit ici, à
/// l'exception du nom, du moteur et de l'environnement, qui appartiennent à la connexion elle-même.
///
/// **Anciennement `ConnectionSettings`, et le renommage dit le changement de modèle** (`23b`) : ces
/// réglages ne sont plus *une variante parmi plusieurs* d'une même base, mais les réglages d'**une**
/// connexion. Le champ `environment` est monté d'un cran, dans `Database`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct ConnectionSettings {
    pub host: String,
    pub port: u16,
    pub default_database: String,
    pub username: String,
    /// Référence vers le mot de passe, jamais le mot de passe. `None` pour un moteur
    /// qui n'en demande pas — SQLite sur fichier, par exemple.
    pub password: Option<SecretRef>,
    pub ssl_mode: SslMode,
    /// Le chemin d'un certificat d'autorité, pour `verify-ca` et `verify-full` (`06f`).
    ///
    /// **Un chemin de fichier, et c'est le seul mécanisme commun aux trois pilotes.** Ni
    /// `mysql_async` ni le pilote MongoDB n'acceptent un `ClientConfig` arbitraire : leur surface est
    /// un chemin de CA et des drapeaux. Le trousseau du système n'est donc pas atteignable partout,
    /// ce qui a décidé du choix de `rustls` — voir `06f`.
    ///
    /// `None` signifie « les racines publiques », qui suffisent à un serveur dont le certificat vient
    /// d'une autorité connue. Une autorité interne d'entreprise se déclare ici.
    ///
    /// **`serde(default)` plutôt qu'une migration** : une configuration écrite avant `06f` n'a pas ce
    /// champ, et `None` est exactement l'état correct. Même arbitrage qu'en `12f` et `15a`.
    #[serde(default)]
    pub ca_certificate: Option<String>,
    /// La base contre laquelle **s'authentifier**, quand elle diffère de celle qu'on ouvre.
    ///
    /// **MongoDB seul en a besoin, et c'est une propriété du serveur, pas du produit.** Un
    /// utilisateur MongoDB appartient à une base, et le pilote s'authentifie contre celle-là. `18b`
    /// avait tranché « la base déclarée, jamais `admin` » — supposer `admin` ferait échouer tous ceux
    /// qui sont déclarés dans la leur. La décision tient ; ce qui manquait, c'est le cas inverse :
    /// l'utilisateur racine que l'image Docker officielle crée (`MONGO_INITDB_ROOT_USERNAME`) vit
    /// dans `admin` et n'a **aucun** moyen d'être joint, puisque la base qu'on veut ouvrir n'est pas
    /// celle où il est déclaré. Constaté le 26 août 2026 sur un conteneur `mongo:8` : « SCRAM
    /// failure: Authentication failed », sans rien à corriger dans le formulaire.
    ///
    /// `None` garde le comportement de `18b` — la base déclarée fait foi. Le champ n'est donc pas
    /// un réglage de plus à comprendre : il ne sert qu'à ceux dont l'utilisateur habite ailleurs.
    ///
    /// **`serde(default)` plutôt qu'un cran de migration** : un champ *ajouté* n'en demande pas, et
    /// `None` est exactement l'état d'une configuration écrite avant. Même arbitrage que
    /// `ca_certificate` ci-dessus.
    #[serde(default)]
    pub auth_database: Option<String>,
    /// Réglage **saisi** dans `A2`. L'état effectif d'une base ouverte compose ce
    /// réglage, la préférence globale de `A10` et l'environnement courant : c'est une
    /// règle, pas une donnée, et elle appartient à l'édition inline.
    pub read_only: bool,
    pub reconnect_on_startup: bool,
    pub tunnel: Option<Tunnel>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelError {
    /// Deux connexions de même nom **dans le même environnement** : « la base analytics de prod »
    /// serait ambigu. Deux connexions homonymes dans deux environnements sont, elles, le modèle
    /// même (`23b`).
    ConnexionEnDouble {
        project: String,
        database: String,
        environment: EnvironmentId,
    },
    /// Une connexion déclare un environnement que son projet ne déclare pas : elle serait invisible
    /// dans l'arbre, qui liste les connexions sous le nœud de leur environnement.
    EnvironnementInconnu {
        project: String,
        database: String,
        environment: EnvironmentId,
    },
    /// Deux environnements de même identifiant rendraient la référence d'un secret ambiguë (`08e`).
    IdentifiantEnDouble {
        project: String,
        environment: EnvironmentId,
    },
    /// Un projet sans environnement ne peut plus rien déclarer : une connexion appartient à un
    /// environnement (`23b`).
    AucunEnvironnement { project: String },
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnexionEnDouble {
                project,
                database,
                environment,
            } => write!(
                f,
                "le projet « {project} » déclare deux fois la base « {database} » en {environment}"
            ),
            Self::EnvironnementInconnu {
                project,
                database,
                environment,
            } => write!(
                f,
                "la base « {database} » du projet « {project} » déclare l'environnement inconnu \
                 « {environment} »"
            ),
            Self::IdentifiantEnDouble {
                project,
                environment,
            } => write!(
                f,
                "le projet « {project} » déclare deux environnements nommés « {environment} »"
            ),
            Self::AucunEnvironnement { project } => write!(
                f,
                "le projet « {project} » doit déclarer au moins un environnement"
            ),
        }
    }
}

impl std::error::Error for ModelError {}

/// Une connexion déclarée : une base, dans **un** environnement (`23b`).
///
/// # Ce que ce type était, et pourquoi il a changé
///
/// Il portait `variants: Vec<ConnectionSettings>` — la même base logique déclinée en dev, staging et
/// prod, sous un seul nœud de l'arbre. Décidé le 19 août 2026 : une connexion appartient à un
/// environnement et un seul. `analytics` en dev et `analytics` en prod sont deux connexions, ce qui
/// rend leur nom non unique dans un projet — il l'est dans le couple `(environnement, nom)`.
///
/// Le nom reste celui de la base distante : il n'y a pas d'étiquette libre. Deux connexions homonymes
/// se distinguent par leur environnement, qui est affiché.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct Database {
    pub name: String,
    pub engine: Engine,
    pub environment: EnvironmentId,
    pub connection: ConnectionSettings,
    /// Les consoles SQL de cette connexion, telles que l'arbre les montre sous elle.
    ///
    /// **Sous la connexion, et non sous le projet** — c'est le changement du 20 août 2026, et il
    /// renverse l'arbitrage de `12f`. Celui-ci rattachait les requêtes au projet, en faisant valoir
    /// qu'un SQL écrit pour `analytics` en prod vaut le plus souvent pour la même base en dev. Mais
    /// une console n'est pas un texte réutilisable : c'est un **espace de travail ouvert sur une
    /// connexion**, avec son dialecte et son autocomplétion, et le dialecte vient du moteur de cette
    /// connexion-là. Une console flottant au-dessus du projet n'aurait pas su lequel employer.
    ///
    /// Le prix est assumé : le même SQL sur deux environnements demande deux consoles. En échange,
    /// chacune sait sur quoi elle s'exécute — ce que « Mes requêtes » ne savait jamais.
    ///
    /// **`default` plutôt qu'une migration de version**, comme en `12f` et `15a` : une configuration
    /// écrite avant ce jour n'a pas ce champ, et le vecteur vide est l'état correct.
    #[serde(default)]
    pub consoles: Vec<Console>,
}

/// Un projet : ce que la sidebar liste. Pas des connexions — le handoff insiste.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct Project {
    pub name: String,
    /// Les environnements que **ce projet** déclare (`23a`).
    ///
    /// Non vide, et sans identifiant en double : les deux invariants sont vérifiés par `valider`.
    /// Un projet neuf reçoit `EnvironmentDeclaration::trio_par_defaut`.
    ///
    /// **Le projet ne porte plus d'environnement actif** (`25c`) : depuis que l'arbre fait de chaque
    /// environnement un nœud dépliable (`25a`), aucun écran ne lit plus de choix persisté. Ce qui en
    /// tient lieu aujourd'hui — l'ensemble des nœuds dépliés — vit en mémoire.
    pub environments: Vec<EnvironmentDeclaration>,
    pub databases: Vec<Database>,
    /// Les requêtes enregistrées de `12f`, **en transit** : elles deviennent des consoles.
    ///
    /// Ce champ n'est plus alimenté depuis le 20 août 2026 ; il n'existe que pour ne rien perdre des
    /// configurations déjà écrites. `migrer_requetes_en_consoles` le vide au chargement en versant
    /// chaque requête dans la première connexion déclarée du projet.
    ///
    /// **Pourquoi ne pas simplement retirer le champ** : `serde` ignore silencieusement ce qu'il ne
    /// connaît pas. Supprimer `queries` du modèle ferait donc disparaître les requêtes de
    /// l'utilisateur à la première réécriture du fichier, sans un mot. Un champ conservé et vidé
    /// après transfert est ce qui rend la reprise observable.
    ///
    /// **`skip_serializing_if`** : une fois la migration faite, le champ cesse d'être écrit, et le
    /// fichier ne porte plus la trace d'un concept qui n'existe plus. Tant qu'un projet n'a aucune
    /// connexion où les verser, en revanche, elles restent dans le fichier et attendent la première.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub queries: Vec<SavedQuery>,
}

impl Project {
    /// Vérifie les invariants d'un projet, tels que `23a` et `23b` les posent.
    ///
    /// # Pourquoi une fonction et non un constructeur
    ///
    /// `Database` employait un `new` privatisant son champ, ce qui rendait l'invariant inviolable.
    /// Cela ne marche que pour un invariant **local**. Ici ils portent sur des relations entre
    /// champs — chaque connexion doit viser un environnement déclaré — et
    /// un constructeur ne les protégerait qu'à la construction : les commandes de `23c` modifient un
    /// projet existant, et c'est après leur passage qu'il faut vérifier. La validation est donc
    /// explicite, appelée par les commandes avant d'écrire.
    pub fn valider(&self) -> Result<(), ModelError> {
        if self.environments.is_empty() {
            return Err(ModelError::AucunEnvironnement {
                project: self.name.clone(),
            });
        }

        for (index, declaration) in self.environments.iter().enumerate() {
            if self.environments[..index]
                .iter()
                .any(|precedente| precedente.id == declaration.id)
            {
                return Err(ModelError::IdentifiantEnDouble {
                    project: self.name.clone(),
                    environment: declaration.id.clone(),
                });
            }
        }

        for (index, base) in self.databases.iter().enumerate() {
            if !self.declare(&base.environment) {
                return Err(ModelError::EnvironnementInconnu {
                    project: self.name.clone(),
                    database: base.name.clone(),
                    environment: base.environment.clone(),
                });
            }
            if self.databases[..index]
                .iter()
                .any(|autre| autre.name == base.name && autre.environment == base.environment)
            {
                return Err(ModelError::ConnexionEnDouble {
                    project: self.name.clone(),
                    database: base.name.clone(),
                    environment: base.environment.clone(),
                });
            }
        }

        Ok(())
    }

    pub fn declare(&self, environnement: &EnvironmentId) -> bool {
        self.environments
            .iter()
            .any(|declaration| &declaration.id == environnement)
    }

    pub fn environnement(&self, id: &EnvironmentId) -> Option<&EnvironmentDeclaration> {
        self.environments
            .iter()
            .find(|declaration| &declaration.id == id)
    }

    /// Les connexions d'un environnement — ce que l'arbre liste (`23g`).
    pub fn connexions_de<'a>(
        &'a self,
        environnement: &'a EnvironmentId,
    ) -> impl Iterator<Item = &'a Database> + 'a {
        self.databases
            .iter()
            .filter(move |base| &base.environment == environnement)
    }
}

/// Une console SQL persistée, rattachée à une connexion.
///
/// Son nom est unique **dans sa connexion**, non dans le projet : deux connexions peuvent chacune
/// porter une console « Exploration », et c'est le cas courant d'une même base déclarée en dev et en
/// prod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct Console {
    pub name: String,
    /// Le texte de la console, persisté à chaque frappe utile.
    ///
    /// Une console vide est **normale** — c'est l'état d'une console qu'on vient de créer — là où une
    /// requête enregistrée vide n'aurait rien voulu dire.
    pub sql: String,
}

/// Une requête enregistrée (`12f`), **en transit** — voir `Project::queries`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub struct SavedQuery {
    pub name: String,
    pub sql: String,
}

/// Les préférences de l'application (`15a`).
///
/// **Pas des propriétés de projet.** `05b` persiste `{ version, projects }` ; celles-ci s'ajoutent à
/// côté — un thème n'appartient pas à une base. Le champ porte `serde(default)`, comme les requêtes
/// enregistrées de `12f` : une configuration écrite avant `15a` se lit sans préférences, ce qui donne
/// les valeurs par défaut. Pas de migration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export_to = "config.ts")]
pub struct Preferences {
    pub theme: Theme,
    /// L'accent, pris dans la palette **fermée** du handoff.
    ///
    /// Un sélecteur de couleur libre permettrait un accent illisible sur le fond du produit ; le
    /// mockup montre six pastilles, et la palette vit dans `tokens.json`.
    pub accent: Accent,
    /// La hauteur d'une ligne de grille, en pixels. `10a` annonçait « `15` la fera varier de 20 à 36 ».
    pub row_height: u8,
    /// Le corps de la police du code, en dixièmes de point — `125` pour 12,5 pt.
    ///
    /// **En dixièmes et non en flottant** : un `f32` dans un fichier de configuration écrit
    /// `12.5` parfois, `12.499999` ailleurs selon le sérialiseur, et la valeur relue ne serait plus
    /// celle qu'on a choisie. Un entier n'a pas ce défaut.
    pub code_font_tenths: u16,
    /// Les quatre garde-fous d'écriture (`15d`), **actifs par défaut**.
    pub guards: Guards,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: Theme::Cahier,
            accent: Accent::Terracotta,
            // 26 px : la valeur du handoff, et celle que `10a` a codée en dur.
            row_height: 26,
            code_font_tenths: 125,
            guards: Guards::default(),
        }
    }
}

impl Preferences {
    /// Les bornes de `10a`, appliquées **au modèle** et non à l'écran.
    ///
    /// Une valeur hors bornes peut venir d'un fichier édité à la main : la corriger ici évite qu'une
    /// grille se retrouve à trois pixels de haut, et évite surtout de faire confiance à l'écran pour
    /// une invariante de donnée.
    pub const HAUTEUR_MIN: u8 = 20;
    pub const HAUTEUR_MAX: u8 = 36;
    /// Bornes du corps de police, en dixièmes de point.
    pub const CORPS_MIN: u16 = 100;
    pub const CORPS_MAX: u16 = 160;

    /// Ramène les valeurs numériques dans leurs bornes.
    pub fn borner(mut self) -> Self {
        self.row_height = self.row_height.clamp(Self::HAUTEUR_MIN, Self::HAUTEUR_MAX);
        self.code_font_tenths = self
            .code_font_tenths
            .clamp(Self::CORPS_MIN, Self::CORPS_MAX);
        // **Un corps élevé contraint la densité** (`15c`) : du code en 14 pt dans une grille de
        // 20 px serait rogné. La règle vit ici, avec la donnée, plutôt que dans le curseur.
        let plancher = Self::hauteur_minimale_pour(self.code_font_tenths);
        if self.row_height < plancher {
            self.row_height = plancher;
        }
        self
    }

    /// La densité la plus compacte que ce corps de police autorise.
    ///
    /// Une ligne doit tenir le texte plus deux pixels de respiration, d'où un plancher qui suit le
    /// corps : `1,3 × corps + 2`.
    ///
    /// **Le facteur est calibré sur le handoff, pas choisi.** Il donne exactement 20 px — la borne
    /// `--rowh-min` du handoff — au corps par défaut de 12,5. Un facteur de 1,45, essayé d'abord,
    /// rendait 21 px et **interdisait la densité la plus compacte que le design annonce** : le
    /// mockup montre le curseur allant jusqu'à « compact », donc 20 px doit être atteignable tel
    /// que le produit est livré. C'est le test qui l'a montré, pas la relecture du calcul.
    pub fn hauteur_minimale_pour(corps_dixiemes: u16) -> u8 {
        let hauteur = (f32::from(corps_dixiemes) / 10.0 * 1.3).ceil() as u16 + 2;
        u8::try_from(hauteur)
            .unwrap_or(Self::HAUTEUR_MAX)
            .clamp(Self::HAUTEUR_MIN, Self::HAUTEUR_MAX)
    }
}

/// Les trois thèmes du mockup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub enum Theme {
    /// Le thème clair, celui du handoff. Son nom est celui du mockup.
    #[default]
    Cahier,
    /// Le thème sombre. **Incomplet tant que `tokens.json` n'a qu'une valeur par jeton** — la spec
    /// `15b` livre le mécanisme et le dit à l'écran plutôt que de cacher le réglage.
    Nuit,
    /// Suit `prefers-color-scheme`.
    Systeme,
}

/// La palette d'accent, **fermée** — les six pastilles du mockup.
///
/// Les valeurs viennent des propriétés déclarées par le handoff lui-même
/// (`accent.options` de son script de démonstration), et non d'un choix fait ici.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "config.ts")]
pub enum Accent {
    /// `#F2653A`, l'accent du handoff.
    #[default]
    Terracotta,
    /// `#DB3753`
    Framboise,
    /// `#E4573F`
    Brique,
    /// `#2E9E6B`
    Sauge,
    /// `#3B82C4`
    Ardoise,
    /// `#7C5CD6`
    Violette,
}

/// Les quatre garde-fous d'écriture (`15d`).
///
/// **Tous à `true` par défaut, y compris pour une installation existante.** `serde(default)` rend
/// `Default::default()`, et un défaut à `false` transformerait une mise à jour de DoraBase en levée
/// silencieuse des garde-fous — exactement ce que `11d` refusait en les livrant non réglables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export_to = "config.ts")]
pub struct Guards {
    /// Le mode de `A6` : toute édition passe par un diff à valider.
    pub pending_before_write: bool,
    /// Les bases déclarées `prod` s'ouvrent en lecture seule.
    pub prod_read_only: bool,
    /// `DELETE`/`UPDATE` sans `WHERE` sont **refusés**, et non simplement confirmés.
    pub refuse_unrestricted_writes: bool,
    /// Le patch inverse est conservé 24 h.
    pub keep_inverse_patch: bool,
}

impl Default for Guards {
    fn default() -> Self {
        Self {
            pending_before_write: true,
            prod_read_only: true,
            refuse_unrestricted_writes: true,
            keep_inverse_patch: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reglages() -> ConnectionSettings {
        ConnectionSettings {
            host: "db.internal".into(),
            port: 5432,
            default_database: "analytics".into(),
            username: "dora_ro".into(),
            password: None,
            ssl_mode: SslMode::Require,
            ca_certificate: None,
            auth_database: None,
            read_only: true,
            reconnect_on_startup: false,
            tunnel: None,
        }
    }

    fn connexion(nom: &str, env: &str) -> Database {
        Database {
            name: nom.to_owned(),
            engine: Engine::PostgreSql,
            environment: EnvironmentId::brut(env),
            connection: reglages(),
            consoles: Vec::new(),
        }
    }

    fn projet(environnements: Vec<EnvironmentDeclaration>, bases: Vec<Database>) -> Project {
        Project {
            name: "Atelier Nord".into(),
            environments: environnements,
            databases: bases,
            queries: Vec::new(),
        }
    }

    // --- L'identifiant, dérivé une fois puis figé (`23a`) ---

    #[test]
    fn l_identifiant_se_derive_du_libelle() {
        assert_eq!(EnvironmentId::depuis_le_libelle("prod").as_str(), "prod");
        assert_eq!(
            EnvironmentId::depuis_le_libelle("Pré-production").as_str(),
            "pr-production"
        );
        assert_eq!(
            EnvironmentId::depuis_le_libelle("Bac à sable").as_str(),
            "bac-sable"
        );
    }

    #[test]
    fn un_libelle_sans_caractere_utilisable_donne_un_identifiant_valable() {
        // Un identifiant vide se retrouverait dans une référence de secret
        // `dorabase/projet/base/` — introuvable, et sans erreur pour le dire.
        assert_eq!(EnvironmentId::depuis_le_libelle("…").as_str(), "env");
        assert_eq!(EnvironmentId::depuis_le_libelle("").as_str(), "env");
    }

    #[test]
    fn renommer_un_environnement_ne_change_pas_son_identifiant() {
        // **La garantie centrale de `23a`.** La référence d'un mot de passe contient l'identifiant
        // (`08e`) : si le renommage le changeait, tous les mots de passe du projet deviendraient
        // introuvables — sans erreur, sans message.
        let mut declaration = EnvironmentDeclaration {
            id: EnvironmentId::depuis_le_libelle("prod"),
            label: "prod".to_owned(),
            color: EnvironmentColor::Red,
            production: true,
        };
        let avant = declaration.id.clone();
        declaration.label = "production".to_owned();
        assert_eq!(declaration.id, avant);
        assert_eq!(declaration.id.as_str(), "prod");
    }

    #[test]
    fn le_trio_par_defaut_est_celui_du_handoff_et_marque_la_production() {
        let trio = EnvironmentDeclaration::trio_par_defaut();
        let ids: Vec<_> = trio.iter().map(|d| d.id.as_str().to_owned()).collect();
        assert_eq!(ids, vec!["dev", "staging", "prod"]);
        assert_eq!(
            trio.iter().filter(|d| d.production).count(),
            1,
            "seule la production est marquée : c'est ce qui accroche les garde-fous de `11d`"
        );
    }

    // --- Les invariants du projet (`23a`, `23b`) ---

    #[test]
    fn un_projet_sans_environnement_est_refuse() {
        let erreur = projet(Vec::new(), Vec::new()).valider();
        assert!(matches!(erreur, Err(ModelError::AucunEnvironnement { .. })));
    }

    #[test]
    fn deux_environnements_de_meme_identifiant_sont_refuses() {
        let mut trio = EnvironmentDeclaration::trio_par_defaut();
        trio.push(trio[0].clone());
        assert!(matches!(
            projet(trio, Vec::new()).valider(),
            Err(ModelError::IdentifiantEnDouble { .. })
        ));
    }

    #[test]
    fn deux_connexions_homonymes_dans_deux_environnements_sont_valides() {
        // Le modèle même de `23b` : `analytics` en dev et en prod sont deux connexions.
        let candidat = projet(
            EnvironmentDeclaration::trio_par_defaut(),
            vec![
                connexion("analytics", "dev"),
                connexion("analytics", "prod"),
            ],
        );
        assert!(candidat.valider().is_ok());
    }

    #[test]
    fn deux_connexions_homonymes_dans_le_meme_environnement_sont_refusees() {
        let candidat = projet(
            EnvironmentDeclaration::trio_par_defaut(),
            vec![connexion("analytics", "dev"), connexion("analytics", "dev")],
        );
        assert!(matches!(
            candidat.valider(),
            Err(ModelError::ConnexionEnDouble { .. })
        ));
    }

    #[test]
    fn une_connexion_visant_un_environnement_non_declare_est_refusee() {
        let candidat = projet(
            EnvironmentDeclaration::trio_par_defaut(),
            vec![connexion("analytics", "preprod")],
        );
        assert!(matches!(
            candidat.valider(),
            Err(ModelError::EnvironnementInconnu { .. })
        ));
    }

    #[test]
    fn les_connexions_d_un_environnement_sont_celles_que_l_arbre_liste() {
        let candidat = projet(
            EnvironmentDeclaration::trio_par_defaut(),
            vec![
                connexion("analytics", "dev"),
                connexion("shop", "dev"),
                connexion("analytics", "prod"),
            ],
        );
        let dev = EnvironmentId::brut("dev");
        let en_dev: Vec<_> = candidat
            .connexions_de(&dev)
            .map(|base| base.name.as_str())
            .collect();
        assert_eq!(en_dev, vec!["analytics", "shop"]);
        let staging = EnvironmentId::brut("staging");
        assert_eq!(candidat.connexions_de(&staging).count(), 0);
    }

    #[test]
    fn un_environnement_se_lit_par_son_identifiant() {
        let candidat = projet(EnvironmentDeclaration::trio_par_defaut(), Vec::new());
        let prod = candidat
            .environnement(&EnvironmentId::brut("prod"))
            .expect("le trio déclare prod");
        assert!(prod.production);
        assert!(candidat
            .environnement(&EnvironmentId::brut("preprod"))
            .is_none());
    }

    #[test]
    fn un_proxy_ssh_se_serialise_avec_son_etiquette() {
        let tunnel = Tunnel {
            local_port: None,
            proxy: Proxy::Ssh(ProxySsh {
                bastion_host: "bastion.internal".into(),
                bastion_port: 22,
                username: "dora".into(),
                private_key_path: "/home/dora/.ssh/id_ed25519".into(),
            }),
        };

        let json = serde_json::to_value(&tunnel).expect("sérialisation");
        // L'étiquette est **dans** l'objet du proxy, et vaut la forme kebab attendue par
        // le front. La vérifier ici plutôt qu'en `08f` : c'est le contrat de l'IPC.
        assert_eq!(json["proxy"]["kind"], "ssh");
        assert_eq!(json["proxy"]["bastionHost"], "bastion.internal");
        assert!(json["localPort"].is_null());
    }

    #[test]
    fn un_proxy_cloud_sql_se_serialise_avec_son_etiquette() {
        let tunnel = Tunnel {
            local_port: Some(5433),
            proxy: Proxy::CloudSql(ProxyCloudSql {
                instance_connection_name: "acme-prod:europe-west1:analytics".into(),
            }),
        };

        let json = serde_json::to_value(&tunnel).expect("sérialisation");
        assert_eq!(json["proxy"]["kind"], "cloud-sql");
        assert_eq!(
            json["proxy"]["instanceConnectionName"],
            "acme-prod:europe-west1:analytics"
        );
        // Et **rien d'autre** : l'instance et l'étiquette. Un champ de compte de service a
        // existé ici jusqu'à la v3 (`06j`) ; le voir réapparaître voudrait dire qu'on a
        // rouvert une voie d'authentification que `06i` a fermée.
        assert_eq!(
            json["proxy"].as_object().expect("objet").len(),
            2,
            "{}",
            json["proxy"]
        );
        assert_eq!(json["localPort"], 5433);
    }

    #[test]
    fn un_proxy_relu_est_celui_ecrit() {
        // Aller-retour, parce que la sérialisation seule ne prouve pas que `serde` sait
        // retrouver la variante depuis son étiquette.
        for proxy in [
            Proxy::Ssh(ProxySsh {
                bastion_host: "b".into(),
                bastion_port: 2222,
                username: "u".into(),
                private_key_path: "/k".into(),
            }),
            Proxy::CloudSql(ProxyCloudSql {
                instance_connection_name: "p:r:i".into(),
            }),
        ] {
            let tunnel = Tunnel {
                local_port: None,
                proxy,
            };
            let brut = serde_json::to_string(&tunnel).expect("écriture");
            let relu: Tunnel = serde_json::from_str(&brut).expect("relecture");
            assert_eq!(relu, tunnel);
        }
    }

    #[test]
    fn une_etiquette_inconnue_est_refusee() {
        // Un fichier écrit par une version future, ou trafiqué à la main, ne doit pas
        // produire un proxy par défaut : `05b` met en quarantaine ce qu'il ne sait pas lire.
        let brut = r#"{"localPort":null,"proxy":{"kind":"socks5","host":"h"}}"#;
        assert!(serde_json::from_str::<Tunnel>(brut).is_err());
    }
}
