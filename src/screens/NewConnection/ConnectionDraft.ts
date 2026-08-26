import type {
  ConnectionSettings,
  Database,
  Engine,
  EnvironmentId,
  SslMode,
  Tunnel,
} from '../../domain/config'
import { modeSslPourLeMoteur, PORT_PAR_DEFAUT } from './engines'

/**
 * L'état saisi dans `A2`, avant tout enregistrement.
 *
 * **Distinct de `Database` et `ConnectionSettings`** de `05a`, et pas par paresse : le
 * brouillon porte un mot de passe *en clair* là où la configuration porte une `SecretRef`,
 * son port est une chaîne (un champ de saisie peut être vide ou invalide, un `u16` non), et
 * il mêle des données de deux niveaux du modèle — la base et sa variante. Le convertir est le
 * travail de `08e`, qui pourra refuser ; ici on ne fait que saisir.
 */
export type ConnectionDraft = {
  engine: Engine
  /** Nom de la base, tel que `A4` l'affichera dans l'arbre. */
  name: string
  /** Identifiant du projet d'accueil. `A2` choisit parmi les projets existants (`08e`). */
  project: string
  /**
   * Le nom saisi sous « + Nouveau projet… » (`08f`).
   *
   * Séparé de `project`, qui porte alors la sentinelle : les fusionner ferait du nom en cours de
   * frappe une valeur de `Select`, et le champ perdrait sa saisie à chaque rendu.
   */
  newProjectName: string
  environment: EnvironmentId
  host: string
  /** Chaîne et non nombre : un champ de saisie passe par des états qu'un `u16` interdit. */
  port: string
  defaultDatabase: string
  username: string
  /** En clair, le temps de la saisie. `08e` le range dans le magasin et n'en garde qu'une
   * référence : le mot de passe est un secret dès la saisie. */
  password: string
  sslMode: SslMode
  /**
   * Le chemin d'un certificat d'autorité, pour `verify-ca` et `verify-full` (`06f`).
   *
   * **Une chaîne, jamais `null`, comme les autres champs du brouillon** : un formulaire porte du
   * texte, et `draftToRequest` traduit le vide en `null`. Mélanger les deux conventions dans le même
   * type obligerait chaque champ à dire laquelle il suit.
   */
  caCertificate: string
  /**
   * La base contre laquelle **s'authentifier**, quand elle diffère de celle qu'on ouvre.
   *
   * MongoDB seul : un utilisateur y appartient à une base, et le pilote s'authentifie contre
   * celle-là. Vide — le cas de presque tout le monde — la base par défaut fait foi.
   */
  authDatabase: string
  readOnly: boolean
  reconnectOnStartup: boolean
  /**
   * Le tunnel SSH, quand la connexion passe par un bastion. `null` sinon.
   *
   * **`null` et non un objet à champs vides** : `ConnectionSettings.tunnel` de `05a` est
   * `Option<Tunnel>`, et `06b` refuse une variante déclarant un tunnel qu'on n'a pas ouvert.
   * Un objet vide se convertirait en `Some(Tunnel { host: "" })`, donc en tentative de
   * connexion vers un bastion sans nom. L'absence doit rester représentable.
   */
  tunnel: TunnelDraft | null
}

/**
 * Le bastion SSH, tel qu'il est saisi.
 *
 * `bastionPort` est une **chaîne**, même raison que `port` : un champ de saisie passe par des
 * états qu'un `u16` interdit.
 */
export type ProxySshDraft = {
  kind: 'ssh'
  bastionHost: string
  bastionPort: string
  username: string
  privateKeyPath: string
}

/**
 * Le proxy Cloud SQL, tel qu'il est saisi.
 *
 * **Un seul champ** (`06j`). Un `credentialsFilePath` a existé ici : il est parti avec le champ
 * de `A2`, l'authentification passant par les identifiants par défaut de l'application. Il n'y a
 * donc plus rien à traduire entre saisie et modèle pour cette sorte — et c'est pour cela que
 * `tunnelDraftToTunnel` n'a plus de cas particulier ici.
 */
export type ProxyCloudSqlDraft = {
  kind: 'cloud-sql'
  /** `projet:région:instance`. Non validé ici : `06g` refuse à l'ouverture, avec le message du
   * proxy lui-même — un nom peut devenir valable entre la saisie et la connexion. */
  instanceConnectionName: string
}

/**
 * Ce qui **diffère** entre les deux sortes, en saisie.
 *
 * **Une union discriminée, comme `Proxy` de `05d`**, et pas seulement par symétrie : Cloud SQL
 * n'est pas dans le handoff, donc aucune maquette ne rattrapera un panneau qui lirait
 * `bastionHost` sur un proxy Cloud SQL. Le compilateur le rattrape ; c'est ce qui remplace la
 * maquette comme garde-fou.
 */
export type ProxyDraft = ProxySshDraft | ProxyCloudSqlDraft

/** La sorte de proxy, telle que le sélecteur « Type » la nomme. */
export type ProxyKind = ProxyDraft['kind']

/**
 * Le panneau « Proxy / tunnel » de `A2`, tel qu'il est saisi.
 *
 * `localPort` est **hors de `proxy`** parce qu'il est vrai des deux sortes — c'est ce que `05d`
 * exprime en le sortant de l'énumération, et le panneau le rend visible : la seule partie qui
 * ne bouge pas d'un visage à l'autre est la seule qui est commune.
 */
export type TunnelDraft = {
  /**
   * Le port local **choisi par l'app**, pas saisi. `null` tant qu'aucun proxy n'est ouvert.
   *
   * `A2` affiche « auto (63342) » : le nombre est le port réellement retenu, que
   * `SshTunnel::port_local` (`06e`) et `CloudSqlProxy::port_local` (`06g`) rendent déjà.
   * Inventer un numéro avant l'ouverture serait un mensonge, et « auto (0) » serait pire —
   * d'où `null`, qui n'affiche que « auto ».
   */
  localPort: number | null
  proxy: ProxyDraft
}

/** Un proxy neuf de la sorte demandée. */
export function emptyProxy(kind: ProxyKind): ProxyDraft {
  switch (kind) {
    case 'ssh':
      // 22 est le port de SSH : le seul champ préremplissable de cette sorte, parce qu'il est
      // vrai pour la quasi-totalité des bastions.
      return { kind: 'ssh', bastionHost: '', bastionPort: '22', username: '', privateKeyPath: '' }
    case 'cloud-sql':
      return { kind: 'cloud-sql', instanceConnectionName: '' }
  }
}

/** Un tunnel neuf de la sorte demandée. */
export function emptyTunnel(kind: ProxyKind): TunnelDraft {
  return { localPort: null, proxy: emptyProxy(kind) }
}

/**
 * Le brouillon d'une connexion neuve.
 *
 * Les valeurs par défaut ne sont **pas** celles du mockup : celui-ci montre un formulaire
 * rempli (« analytics », « db-analytics.internal », « dora_ro »), qui est une illustration,
 * pas un état initial. Y coller ces valeurs mettrait une fausse connexion sous les yeux de
 * l'utilisateur à chaque ouverture.
 *
 * Ce qui est prérempli, en revanche, l'est parce que c'est vrai pour la quasi-totalité des
 * cas : `postgresql` est le premier moteur de l'ordre du handoff, `dev` est l'environnement le moins
 * risqué, le port est celui du moteur choisi — lu dans `PORT_PAR_DEFAUT`, jamais recopié ici — et
 * `prefer` est le mode SSL par défaut de `libpq`. Ouvrir sur `prod` serait une invitation à
 * l'accident.
 */
export function emptyDraft(): ConnectionDraft {
  return {
    engine: 'postgresql',
    name: '',
    project: '',
    newProjectName: '',
    environment: 'dev',
    host: '',
    // `?? ''` par nécessité du type : PostgreSQL a un port, mais la table en admet l'absence.
    port: PORT_PAR_DEFAUT.postgresql ?? '',
    defaultDatabase: '',
    username: '',
    password: '',
    sslMode: 'prefer',
    caCertificate: '',
    // **`admin` d'emblée, et c'est le seul champ préremplié avec le port SSH du bastion.** Le
    // critère du projet pour préremplir est « vrai pour la quasi-totalité des cas » : l'utilisateur
    // d'un serveur MongoDB vit dans `admin` presque toujours — c'est là que l'image Docker
    // officielle crée le sien, et là que les administrateurs déclarent les leurs.
    //
    // **Ce n'est pas une supposition silencieuse**, et c'est ce qui distingue ce préremplissage du
    // défaut que `18b` a refusé : la valeur est **dans le champ**, visible et effaçable. Vidé, le
    // comportement de `18b` revient — la base déclarée fait foi (voir `auth_database` côté Rust).
    //
    // Il n'est posé que sur un brouillon **neuf**. Reprendre une connexion enregistrée sans base
    // d'authentification laisse le champ vide : y écrire `admin` changerait le comportement d'une
    // connexion qui marche, au premier enregistrement.
    authDatabase: 'admin',
    readOnly: true,
    reconnectOnStartup: false,
    // Pas de tunnel par défaut : le panneau de `A2` s'ouvre replié et sans badge.
    tunnel: null,
  }
}

/**
 * Le brouillon d'une base **existante**, pour le mode édition de `08g`.
 *
 * Le mot de passe part **vide**, et ce n'est pas un oubli : la variante ne porte qu'une `SecretRef`,
 * jamais la valeur — le front ne l'a donc pas, et ne doit pas l'avoir. Un champ vide veut dire
 * « inchangé », ce que `update_variant` applique.
 */
/**
 * Le tunnel enregistré, retraduit en brouillon (`08g`).
 *
 * **Un `switch` sur la sorte, et non une lecture de champs** : depuis `05d`, `Proxy` est une union
 * discriminée, donc lire `bastionHost` sans discriminer ne compile pas. C'est exactement le
 * garde-fou que `08k` cherchait — Cloud SQL n'ayant pas de maquette, aucune relecture visuelle
 * n'aurait rattrapé un panneau qui lit les champs de l'autre sorte.
 */
function brouillonDeProxy(tunnel: Tunnel): TunnelDraft {
  // Le port local est **attribué à l'ouverture**, jamais saisi : `06e` et `06g` le choisissent
  // libre sur la machine. Le reprendre de la configuration afficherait un port d'une session
  // précédente, qui n'a plus cours.
  const localPort = null

  switch (tunnel.proxy.kind) {
    case 'ssh':
      return {
        localPort,
        proxy: {
          kind: 'ssh',
          bastionHost: tunnel.proxy.bastionHost,
          bastionPort: String(tunnel.proxy.bastionPort),
          username: tunnel.proxy.username,
          privateKeyPath: tunnel.proxy.privateKeyPath,
        },
      }
    case 'cloud-sql':
      return {
        localPort,
        proxy: {
          kind: 'cloud-sql',
          instanceConnectionName: tunnel.proxy.instanceConnectionName,
        },
      }
  }
}

export function draftDepuisLaVariante(
  project: string,
  database: Database,
  variant: ConnectionSettings,
): ConnectionDraft {
  // L'environnement appartient à la connexion (`23b`), non à ses réglages.
  const environnement = database.environment
  return {
    engine: database.engine,
    name: database.name,
    project,
    newProjectName: '',
    // L'environnement vient de la **connexion**, non de ses réglages (`23b`).
    environment: environnement,
    host: variant.host,
    port: String(variant.port),
    defaultDatabase: variant.defaultDatabase,
    username: variant.username,
    password: '',
    // **Ramené dans ce que le moteur exprime.** Une connexion MongoDB ou MySQL enregistrée avant le
    // 26 août 2026 peut porter `allow` ou `prefer` : ces modes lui étaient offerts, et son pilote les
    // remplaçait par `require` sans le dire. Ils ne sont plus dans la liste, et une liste déroulante
    // dont la valeur n'est aucune de ses options affiche un champ **vide** — le piège du sélecteur
    // contrôlé, déjà rencontré sur le projet. Afficher `require` dit ce qui s'appliquera, ce que le
    // fichier disait déjà sans qu'on puisse le lire ; rien n'est réécrit sur le disque tant que
    // l'utilisateur n'enregistre pas.
    sslMode: modeSslPourLeMoteur(database.engine, variant.sslMode),
    caCertificate: variant.caCertificate ?? '',
    // Le vide de l'écran et l'absence du modèle sont la même chose, dans les deux sens : c'est la
    // convention que ce fichier applique déjà au certificat d'autorité juste au-dessus.
    authDatabase: variant.authDatabase ?? '',
    readOnly: variant.readOnly,
    reconnectOnStartup: variant.reconnectOnStartup,
    tunnel: variant.tunnel === null ? null : brouillonDeProxy(variant.tunnel),
  }
}
