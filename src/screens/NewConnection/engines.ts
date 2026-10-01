import type { IconName } from '../../design/icons/names'
import type { Engine, SslMode } from '../../domain/config'
import { authentifie, SSL_MODE_ORDER } from './environments'

/**
 * Le sélecteur de moteur de `A2` : libellé, monogramme, couleur.
 *
 * **Typé `Record<Engine, …>` volontairement.** Le jour où `05a` ajoute un moteur en Rust,
 * `ts-rs` régénère l'union `Engine` et **TypeScript refuse de compiler** ce fichier tant
 * qu'il n'est pas complété. C'est plus fort qu'un test d'exécution, qui ne pourrait que
 * comparer deux listes recopiées : la contrainte est portée par le type, donc impossible à
 * oublier. Vérifié par sabotage — voir le commit.
 *
 * **Snowflake et BigQuery n'ont pas de monogramme.** Les cinq premiers en ont un, coloré ;
 * les deux derniers portent leur seul libellé. Relevé sur le mockup, où le `<span>` du
 * monogramme est absent de ces deux boutons — ce n'est pas un oubli à combler.
 *
 * **`icon` remplace le monogramme des quatre moteurs adaptés** (27 août 2026) : un éléphant pour
 * PostgreSQL, une feuille pour MongoDB, un dauphin pour MySQL, un fichier pour SQLite — le seul
 * moteur sans serveur. Redis garde son monogramme texte, faute d'icône dessinée ; Snowflake et
 * BigQuery gardent l'absence des deux.
 */
export const ENGINES: Record<
  Engine,
  { label: string; monogram?: string; icon?: IconName; color?: string }
> = {
  postgresql: { label: 'PostgreSQL', icon: 'pg', color: 'var(--engine-pg)' },
  mysql: { label: 'MySQL', icon: 'mysql', color: 'var(--engine-my)' },
  sqlite: { label: 'SQLite', icon: 'sqlite', color: 'var(--engine-sq)' },
  mongodb: { label: 'MongoDB', icon: 'mongo', color: 'var(--engine-mg)' },
  redis: { label: 'Redis', monogram: 'Rd', color: 'var(--engine-rd)' },
  snowflake: { label: 'Snowflake' },
  bigquery: { label: 'BigQuery' },
}

/**
 * Le nom qu'une base prend quand son champ « Nom » est laissé vide (27 août 2026).
 *
 * **Abrégé, pas le libellé complet** : « psql », pas « PostgreSQL ». C'est ce que `A2` substitue
 * au moment d'enregistrer — voir `draftToSaveRequest` — jamais ce que le champ affiche pendant la
 * saisie, qui reste un `placeholder`.
 *
 * `Record<Engine, …>` pour la raison d'`ENGINES` : un moteur ajouté fait échouer ce fichier tant
 * que son abréviation n'est pas écrite.
 */
export const NOM_PAR_DEFAUT: Record<Engine, string> = {
  postgresql: 'psql',
  mysql: 'mysql',
  sqlite: 'sqlite',
  mongodb: 'mongo',
  redis: 'redis',
  snowflake: 'snowflake',
  bigquery: 'bigquery',
}

/**
 * L'ordre du handoff, qui n'est pas alphabétique et n'est pas celui du type Rust : il va du
 * plus au moins courant. Le figer ici plutôt que de dépendre de l'ordre des clés d'un objet
 * — que rien ne garantit à la lecture d'un fichier généré.
 */
export const ENGINE_ORDER: readonly Engine[] = [
  'postgresql',
  'mysql',
  'sqlite',
  'mongodb',
  'redis',
  'snowflake',
  'bigquery',
]

/**
 * Les moteurs dont un adaptateur existe. Les autres restent **sélectionnables et le disent**.
 *
 * PostgreSQL (`06`), MongoDB (`18`), SQLite (`17`), MySQL (`16`), BigQuery (`21`). Les deux restants
 * sont refusés par le moteur avec une raison qui nomme ce qui manque — voir `raison_du_refus` côté
 * Rust : Redis n'entre pas dans le contrat (`19a`), Snowflake n'a aucun décor de test (`20`).
 *
 * **BigQuery est livré sans qu'aucun décor ne l'ait jamais exercé** — voir le commentaire de tête
 * de `src-tauri/src/engine/bigquery/mod.rs`. Il figure ici parce que le pilote est joint, pas parce
 * que le chemin heureux a été observé contre un vrai projet.
 */
export const IMPLEMENTED_ENGINES: readonly Engine[] = [
  'postgresql',
  'mongodb',
  'sqlite',
  'mysql',
  'bigquery',
]

/**
 * Les moteurs **sans serveur** : ni hôte, ni port, ni utilisateur, ni mot de passe, ni TLS.
 *
 * SQLite (`17a`) et BigQuery (`21`), pour deux raisons différentes. SQLite s'ouvre depuis un
 * fichier : son chemin vit dans `defaultDatabase`, la base *est* le fichier. BigQuery parle HTTPS à
 * l'API Google, authentifié par les identifiants par défaut de l'application — comme Cloud SQL
 * (`06j`), aucun champ de la connexion ne porte de secret ; `defaultDatabase` y porte l'identifiant
 * du **projet** GCP. Afficher un port ou un mot de passe à qui n'en a ni l'un ni l'autre ferait
 * remplir des champs pour rien, et laisserait croire qu'ils comptent.
 */
export const FILE_ENGINES: readonly Engine[] = ['sqlite', 'bigquery']

/** Vrai quand ce moteur s'ouvre depuis un fichier ou un projet plutôt que depuis un hôte. */
export function estUnFichier(engine: Engine): boolean {
  return FILE_ENGINES.includes(engine)
}

/**
 * Les moteurs dont `estUnFichier` masque les champs, mais dont le champ « base par défaut » ne
 * porte pas un chemin — BigQuery seul. `A2` en tire le libellé et le repère de son unique champ
 * restant : « ID de projet », pas « Chemin du fichier ».
 */
export const PROJECT_ENGINES: readonly Engine[] = ['bigquery']

/** Vrai quand le champ « base par défaut » de ce moteur porte un identifiant de projet GCP. */
export function estUnProjet(engine: Engine): boolean {
  return PROJECT_ENGINES.includes(engine)
}

/**
 * Le port d'écoute par défaut de chaque moteur.
 *
 * **Typé `Record<Engine, …>` pour la même raison que `ENGINES`** : un moteur ajouté en Rust fait
 * refuser ce fichier tant que sa valeur n'est pas écrite, et le compilateur pose la question à notre
 * place — « celui-là, sur quel port écoute-t-il ? »
 *
 * `null` veut dire **« ce moteur n'a pas de port »**, et non « on ne sait pas » : SQLite s'ouvre depuis
 * un fichier (`FILE_ENGINES`), Snowflake et BigQuery depuis une URL de service. Préremplir 443 pour
 * ces deux-là afficherait un port que personne ne saisit et que rien ne lit.
 *
 * Une chaîne et non un nombre : c'est la valeur d'un champ de saisie, et le brouillon garde le port en
 * texte jusqu'à sa conversion par `draftToRequest`.
 */
export const PORT_PAR_DEFAUT: Record<Engine, string | null> = {
  postgresql: '5432',
  mysql: '3306',
  sqlite: null,
  mongodb: '27017',
  redis: '6379',
  snowflake: null,
  bigquery: null,
}

/**
 * Le port à afficher après un changement de moteur.
 *
 * **Une valeur saisie à la main survit au changement, le défaut de l'autre moteur non.** Remplacer
 * systématiquement jetterait le port d'un serveur qui n'écoute pas sur le port usuel — la raison même
 * pour laquelle le champ est saisissable. Ne jamais remplacer laisserait `5432` devant une connexion
 * MySQL, ce qui échoue à l'ouverture sans dire pourquoi.
 *
 * Le partage se fait sur un seul critère : le port affiché **est-il encore celui du moteur qu'on
 * quitte** ? Si oui, personne ne l'a choisi, et il suit. Un champ vide suit aussi — c'est ce que laisse
 * un passage par SQLite.
 */
export function portSuivant(precedent: Engine, portAffiche: string, suivant: Engine): string {
  const saisiALaMain = portAffiche !== '' && portAffiche !== PORT_PAR_DEFAUT[precedent]
  return saisiALaMain ? portAffiche : (PORT_PAR_DEFAUT[suivant] ?? '')
}

/**
 * Les modes SSL que **chaque moteur sait réellement exprimer**.
 *
 * **Pourquoi cette table existe : il n'y a plus de promotion silencieuse.** Les six modes étaient
 * offerts pour les sept moteurs, et le code des adaptateurs ne testait que « le chiffrement est-il
 * demandé ». Conséquence mesurée le 26 août 2026 : un test MongoDB en `prefer` — la valeur *par
 * défaut* du formulaire — exigeait le TLS, échouait après cinq secondes contre un `mongod` sans
 * TLS, et rendait « vérifiez l'hôte, le port », qui accuse ce qui va bien. L'écran promettait
 * « TLS si possible, clair en repli » ; le pilote faisait « TLS obligatoire ».
 *
 * Deux réponses étaient possibles, et une seule est honnête : offrir le mode et le trahir, ou ne
 * pas l'offrir. Un mode absent de la liste se voit ; un mode remplacé en silence ne se voit
 * jamais.
 *
 * **Ce que chaque exclusion coûte**, pour qu'on ne les « corrige » pas :
 *
 * - `allow` et `prefer` demandent une **négociation dans le protocole** : le client propose, le
 *   serveur accepte ou non, et le clair reste possible. Seul PostgreSQL l'a — `tokio-postgres`
 *   porte un `PgSslMode::Prefer` qui replie vraiment. Les pilotes MongoDB et MySQL ne reçoivent
 *   qu'un drapeau : TLS ou rien, sans repli. Le mode n'y est donc pas exprimable, pas « pas encore
 *   branché ».
 * - `verify-ca` — vérifier la chaîne sans vérifier le nom — n'existe que pour PostgreSQL, seul
 *   pilote des trois à accepter une `ClientConfig` de `rustls`. Les deux autres refusaient déjà ce
 *   mode avec leur raison ; le refuser *et* le proposer était l'incohérence restante.
 * - SQLite et BigQuery n'ont aucun transport à chiffrer que ce champ puisse régler : le premier
 *   parce que c'est un fichier local, le second parce que HTTPS n'est ni optionnel ni négociable à
 *   ce niveau. Les deux listes sont vides, et le champ disparaît déjà pour un moteur sans serveur
 *   (`estUnFichier`).
 *
 * **Typé `Record<Engine, …>` pour la raison d'`ENGINES`** : un huitième moteur en Rust fait échouer
 * la compilation ici. Et le côté Rust **refuse** un mode qu'il ne sait pas exprimer, au lieu de le
 * remplacer : une configuration enregistrée par une version antérieure, ou écrite à la main, ne
 * peut donc pas rétablir la promotion en passant derrière l'écran.
 */
export const SSL_MODES_PAR_MOTEUR: Record<Engine, readonly SslMode[]> = {
  postgresql: SSL_MODE_ORDER,
  mysql: ['disable', 'require', 'verify-full'],
  // Aucun transport : la liste est vide, et l'écran ne montre pas le champ.
  sqlite: [],
  mongodb: ['disable', 'require', 'verify-full'],
  // Aucun réglage : HTTPS vers l'API Google, sans négociation possible depuis ce champ (`21`).
  bigquery: [],
  // **Les deux moteurs sans adaptateur gardent les six modes.** Ce n'est pas un oubli : rien ne
  // *sait* encore ce que leurs pilotes expriment, et restreindre au hasard inventerait une limite.
  // Leur connexion est refusée bien avant le TLS — voir `raison_du_refus` côté Rust.
  redis: SSL_MODE_ORDER,
  snowflake: SSL_MODE_ORDER,
}

/**
 * Les modes SSL offerts pour ce moteur, **dans l'ordre croissant d'exigence**.
 *
 * L'ordre vient de `SSL_MODE_ORDER` et n'est pas recopié dans la table : une seconde liste
 * ordonnée divergerait au premier mode ajouté, et l'ordre — de « aucun chiffrement » à « identité
 * vérifiée » — est ce qui rend la liste déroulante lisible.
 */
export function modesSslDisponibles(engine: Engine): readonly SslMode[] {
  const offerts = SSL_MODES_PAR_MOTEUR[engine]
  return SSL_MODE_ORDER.filter((mode) => offerts.includes(mode))
}

/**
 * Le mode à retenir quand on change de moteur : celui en place s'il est offert, sinon le
 * **plus proche vers le haut**.
 *
 * **Vers le haut, jamais vers le bas.** Passer de `prefer` à `require` resserre une exigence et se
 * *voit* dans la liste déroulante, qui affiche alors `require` — donc rien n'est promu en silence,
 * c'est le point de tout ce changement. Descendre à `disable` retirerait le chiffrement d'une
 * connexion pour laquelle on l'avait demandé, et un réglage de sécurité ne doit pas se relâcher
 * parce qu'on a cliqué sur un autre moteur.
 *
 * Le repli final est le mode le plus exigeant offert : pour un moteur sans aucun mode (SQLite), le
 * mode en place est **gardé tel quel**, puisque le champ n'est pas affiché et que rien ne le lira.
 */
export function modeSslPourLeMoteur(engine: Engine, actuel: SslMode): SslMode {
  const offerts = modesSslDisponibles(engine)
  if (offerts.length === 0 || offerts.includes(actuel)) return actuel

  const rang = SSL_MODE_ORDER.indexOf(actuel)
  return offerts.find((mode) => SSL_MODE_ORDER.indexOf(mode) > rang) ?? offerts.at(-1) ?? actuel
}

/**
 * L'enregistrement doit-il demander de confirmer un mode SSL **non authentifiant** (#87) ?
 *
 * Oui quand trois choses tiennent ensemble : la cible est sensible, le moteur a un
 * transport à chiffrer, et le mode retenu ne vérifie pas l'identité du serveur — `disable`,
 * `allow`, `prefer` et `require`. `require` en est, et c'est le point : il chiffre sans
 * authentifier, donc il n'empêche pas plus un intermédiaire que le clair.
 *
 * **La cible est sensible** quand un dossier du cadre **impose** la lecture seule (#168) — le seul
 * marqueur qui ait survécu au drapeau `production` des environnements, et jamais le réglage local de
 * la connexion, qu'un brouillon neuf a à vrai. Pour une instance managée, c'est son propre drapeau
 * `production`, qu'elle garde. Un drapeau, jamais un libellé (`23g`). Et **un moteur sans mode offert
 * n'est jamais concerné** : SQLite et
 * BigQuery n'ont pas de champ SSL, donc rien à confirmer qu'on puisse changer.
 *
 * Ce n'est pas un refus : descendre peut être juste — un serveur interne sans autorité publique, une
 * base derrière un tunnel. C'est un geste qu'on fait **en le nommant**, au lieu de le laisser passer
 * au détour d'un formulaire.
 */
export function confirmationTlsRequise(
  engine: Engine,
  mode: SslMode,
  cibleSensible: boolean,
): boolean {
  return cibleSensible && modesSslDisponibles(engine).length > 0 && !authentifie(mode)
}

/**
 * Les moteurs dont l'utilisateur peut habiter une **autre base** que celle qu'on ouvre.
 *
 * MongoDB seul. Un utilisateur y appartient à une base, et le pilote s'authentifie contre celle-là
 * — donc l'utilisateur racine d'un conteneur officiel, qui vit dans `admin`, était **injoignable**
 * dès qu'on voulait ouvrir une autre base. Constaté le 26 août 2026.
 *
 * PostgreSQL et MySQL n'ont rien de tel : leurs rôles sont globaux au serveur. Afficher le champ
 * pour eux ferait chercher à quoi il sert, et la réponse serait « à rien » — c'est la règle des
 * cinq champs masqués pour un moteur de fichier, prise par l'autre bout.
 */
export const ENGINES_A_BASE_D_AUTHENTIFICATION: readonly Engine[] = ['mongodb']

/** Vrai quand ce moteur déclare ses utilisateurs dans une base, et non au niveau du serveur. */
export function authentifieParBase(engine: Engine): boolean {
  return ENGINES_A_BASE_D_AUTHENTIFICATION.includes(engine)
}
