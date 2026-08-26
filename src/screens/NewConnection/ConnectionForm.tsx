import { useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { Engine, EnvironmentDeclaration, EnvironmentId, SslMode } from '../../domain/config'
import { Badge } from '../../ui/Badge/Badge'
import { cx } from '../../ui/cx'
import { Field } from '../../ui/Field/Field'
import { RadioGroup } from '../../ui/RadioGroup/RadioGroup'
import { Select } from '../../ui/Select/Select'
import type { ConnectionDraft } from './ConnectionDraft'
import { authentifieParBase, estUnFichier, modesSslDisponibles } from './engines'
import { authentifie, SSL_MODES } from './environments'
import styles from './NewConnection.module.css'
import { ToggleWithLabel } from './ToggleWithLabel'

/**
 * La valeur sentinelle du `Select` qui demande la création d'un projet.
 *
 * Une sentinelle et non un booléen à part : le `Select` a **une** valeur, et un état parallèle
 * (« projet choisi » + « ou bien nouveau ») divergerait — c'est exactement le piège du select
 * contrôlé que `08e` a déjà payé une fois. Le préfixe la rend impossible à confondre avec un nom
 * de projet, que `05a` n'autorise pas à commencer par un caractère de contrôle.
 */

/** Pourquoi le port est grisé derrière un proxy Cloud SQL. Dit, jamais deviné. */
const RAISON_PORT_CLOUD_SQL =
  "Le port est choisi par l'application à l'ouverture du proxy Cloud SQL, et lu sur ce que le proxy annonce. Une valeur saisie ici ne serait pas employée."

/** Pourquoi le mot de passe est grisé derrière un proxy Cloud SQL. */
const RAISON_MOT_DE_PASSE_CLOUD_SQL =
  "L'authentification est celle de Cloud SQL IAM : le proxy présente un jeton à la place d'un mot de passe. L'utilisateur est un principal IAM — une adresse."

/** Pourquoi les trois champs d'identité sont verrouillés en édition. Dit, jamais deviné. */
const RAISON_VERROU =
  'Ces champs identifient la connexion : les changer déplacerait son mot de passe et fermerait sa connexion.'

/**
 * La raison du verrou **du nom**, distincte depuis `26` : le geste existe désormais.
 *
 * Le champ reste verrouillé — cette modale a un bouton « Enregistrer », et un champ qui déplacerait
 * un mot de passe dans le Trousseau au milieu d'un formulaire tampon serait le seul contrôle de
 * l'écran à s'appliquer sans lui. Mais dire « supprimez et redéclarez » serait maintenant **faux** :
 * l'infobulle nomme le geste au lieu d'un contournement qui n'a plus lieu d'être.
 */
const RAISON_VERROU_NOM =
  'Le nom identifie la connexion. Pour le changer : menu « … » de sa ligne dans l’arbre, puis « Renommer… ».'

type ConnectionFormProps = {
  draft: ConnectionDraft
  onChange: (patch: Partial<ConnectionDraft>) => void
  /**
   * Les environnements **déclarés par le projet** dans lequel cette connexion se déclare (`23d`).
   *
   * La liste elle-même, et non la liste des projets d'où la tirer : le formulaire ne choisit plus de
   * projet, donc il n'a plus à en chercher un. Un projet à cinq environnements en montre cinq.
   *
   * **L'ancienne recherche était un défaut connu** : elle lisait `projetImpose ?? draft.project`, et
   * l'oubli du premier terme avait rendu le groupe d'environnements vide à l'étape 2 — on ne pouvait
   * plus déclarer de connexion. Recevoir la liste toute faite supprime la recherche, donc l'oubli.
   */
  environnements: readonly EnvironmentDeclaration[]
  /**
   * Verrouille les champs qui **désignent** la base : son nom et son environnement.
   *
   * Le triplet `projet/base/environnement` est la clé du registre (`09b`) et la référence du secret
   * (`08e`) : en changer un élément demanderait de déplacer le secret et de fermer la connexion
   * ouverte. Voir `08g`.
   */
  verrouille?: boolean
}

/**
 * Les options de la liste « Mode SSL », **pour le moteur choisi**.
 *
 * Ce n'est plus une constante de module : la liste des six modes était offerte à tous les moteurs,
 * dont deux n'en savent exprimer que trois — voir `SSL_MODES_PAR_MOTEUR`. Un mode qu'un pilote
 * remplace en silence est pire qu'un mode absent : l'écran affirmait « clair en repli » là où la
 * connexion exigeait le TLS.
 */
function optionsSsl(engine: Engine) {
  return modesSslDisponibles(engine).map((mode) => ({ value: mode, label: SSL_MODES[mode].label }))
}

/**
 * Les entrées du groupe d'environnements, **construites depuis les déclarations du projet** (`23d`).
 *
 * C'était une constante de module, dérivée du trio en dur : elle ne pouvait pas dépendre du projet
 * choisi. Depuis `23a`, chaque projet déclare les siens — un projet à cinq environnements en montre
 * cinq, et changer de projet change la liste.
 *
 * **L'habillage d'alerte suit le drapeau `production`, jamais le libellé.** Un environnement nommé
 * « live » et marqué production porte le fond rouge pâle et l'icône d'avertissement ; un environnement
 * nommé « prod » que l'utilisateur n'a pas marqué ne les porte pas.
 */
function optionsDEnvironnement(declarations: readonly EnvironmentDeclaration[]) {
  return declarations.map((declaration) => ({
    value: declaration.id,
    label: declaration.label,
    // L'icône d'avertissement : décorative, `RadioGroup` la masque à l'accessibilité puisqu'elle
    // redouble un mot déjà écrit.
    prefix: declaration.production ? <Icon name="warn" size={13} strokeWidth={2} /> : undefined,
    className: cx(styles.envOption, declaration.production && styles.envDanger),
  }))
}

/**
 * Le formulaire principal de `A2`.
 *
 * La structure est une **grille**, pas une pile de rangées flex : le mockup impose deux
 * colonnes `1fr 1fr` avec des rangées pleine largeur et des sous-grilles. Reproduire cela en
 * flex imbriqué donnerait des colonnes qui ne s'alignent pas d'une rangée à l'autre — écart
 * que Vitest ne peut pas voir, d'où les mesures dans `e2e/`.
 */
export function ConnectionForm({
  draft,
  onChange,
  environnements,
  verrouille = false,
}: ConnectionFormProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  // **Un moteur de fichier n'a pas de serveur** (`17a`) : cinq champs du formulaire ne veulent rien
  // dire pour lui, et les afficher laisserait croire qu'ils comptent.
  const fichier = estUnFichier(draft.engine)
  /*
   * **Ce que le proxy Cloud SQL décide à la place de l'utilisateur** (24 août 2026).
   *
   * Deux champs cessent d'avoir un sens quand la connexion passe par lui :
   * - le **port**, choisi par l'application à l'ouverture du proxy et lu sur ce qu'il annonce
   *   (`06g`) — la valeur saisie ne serait jamais employée ;
   * - le **mot de passe**, l'authentification étant IAM (`06k`) : le proxy présente un jeton.
   *
   * Grisés plutôt que masqués : leur disparition ferait croire que la connexion n'a ni port ni
   * mot de passe, alors qu'elle en a — simplement, ce n'est plus l'utilisateur qui les donne.
   * Chacun porte un `title` qui dit **pourquoi**, la leçon de `09f` valant ici : un champ
   * désactivé sans explication se lit comme un bug.
   *
   * Lu sur le tunnel **réellement déclaré**, et non sur la sorte affichée dans le panneau : tant
   * qu'aucune instance n'est saisie, il n'y a pas de proxy, et griser d'avance serait mentir.
   */
  const parCloudSql = draft.tunnel?.proxy.kind === 'cloud-sql'

  return (
    <div className={styles.form}>
      {/* Rangée pleine largeur : `1fr auto`, alignée en bas — les étiquettes n'ont pas
          toutes la même hauteur, et sans `align-items: end` les champs se décaleraient.

          **La piste de 196px a disparu avec le projet** (26 août 2026) : il vivait ici, entre le nom
          de la base et les environnements, et il est monté dans l'en-tête de la modale. Il n'était pas
          un champ du formulaire mais son **cadre** — et un sélecteur à côté proposait d'en changer,
          c'est-à-dire de déplacer une connexion d'un projet à l'autre, geste qui n'existe pas. */}
      <div className={styles.rowIdentity}>
        {/* **Verrouillé en édition, et la raison est dite.** Un champ désactivé sans explication
            fait croire à un bug — la leçon de `09f`. Le `title` porte l'explication : `Field` n'a
            pas d'infobulle, et lui en ajouter une pour trois champs serait disproportionné. */}
        <Field
          label="Nom de la base"
          className={styles.nameField}
          value={draft.name}
          disabled={verrouille}
          title={verrouille ? RAISON_VERROU_NOM : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <div>
          {/* « Environnement », et non plus « Variante d'environnement » : le mot décrivait le modèle
              à variantes, que `23b` a retiré. */}
          <div className={styles.label}>Environnement</div>
          <RadioGroup
            label="Environnement"
            options={optionsDEnvironnement(environnements)}
            value={draft.environment}
            disabled={verrouille}
            title={verrouille ? RAISON_VERROU : undefined}
            onValueChange={(environment) => onChange({ environment: environment as EnvironmentId })}
          />
        </div>
      </div>

      {/* **Un moteur de fichier n'a ni hôte ni port** (`17a`). Les afficher ferait remplir cinq
          champs pour rien, et laisserait croire qu'ils comptent — c'est la raison qui a fait
          préférer masquer plutôt qu'ajouter un champ `path` vide pour six moteurs sur sept. */}
      {!fichier && (
        // Le port est **collé** à l'hôte : sous-grille `1fr 84px` avec un gap de 8px, contre
        // les 18px de la grille principale.
        <div className={styles.rowHost}>
          <Field
            label="Hôte"
            mono
            value={draft.host}
            onChange={(event) => onChange({ host: event.target.value })}
          />
          <Field
            label="Port"
            mono
            inputMode="numeric"
            disabled={parCloudSql}
            title={parCloudSql ? RAISON_PORT_CLOUD_SQL : undefined}
            value={parCloudSql ? 'auto' : draft.port}
            onChange={(event) => onChange({ port: event.target.value })}
          />
        </div>
      )}

      {/* **Le même champ, deux rôles.** Pour un moteur de fichier, `defaultDatabase` porte le chemin
          — le champ est déjà « la base à ouvrir », et pour SQLite la base *est* un fichier. Le
          libellé change, la donnée non. */}
      <Field
        label={fichier ? 'Fichier de la base' : 'Base par défaut'}
        mono
        value={draft.defaultDatabase}
        placeholder={fichier ? '~/bases/atelier.db' : undefined}
        onChange={(event) => onChange({ defaultDatabase: event.target.value })}
      />

      {!fichier && (
        <Field
          label="Utilisateur"
          mono
          value={draft.username}
          onChange={(event) => onChange({ username: event.target.value })}
        />
      )}

      {/* Un fichier local n'a pas de mot de passe (`17a`). Le champ resterait vide, et le badge
          « Trousseau » promettrait de ranger un secret qui n'existe pas. */}
      {!fichier && (
        <Field
          label="Mot de passe"
          mono
          type={passwordVisible ? 'text' : 'password'}
          className={styles.passwordField}
          disabled={parCloudSql}
          title={parCloudSql ? RAISON_MOT_DE_PASSE_CLOUD_SQL : undefined}
          value={parCloudSql ? '' : draft.password}
          onChange={(event) => onChange({ password: event.target.value })}
          suffix={
            // **Ni l'œil ni le badge derrière un proxy Cloud SQL.** C'est le raisonnement de
            // `17a` sur le moteur de fichier, appliqué ici : « le badge Trousseau promettrait
            // de ranger un secret qui n'existe pas ». Il n'y en aura pas — le proxy présente un
            // jeton —, et un œil qui dévoile un champ vide et grisé ne dévoile rien.
            parCloudSql ? undefined : (
              <>
                <button
                  type="button"
                  className={styles.eye}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={
                    passwordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                  }
                  aria-pressed={passwordVisible}
                >
                  <Icon name="eye" size={14} strokeWidth={1.8} />
                </button>
                {/* Le badge annonce **où** le secret sera rangé. `05c` choisit le mécanisme selon
                la signature du binaire : en développement c'est un fichier chiffré, pas le
                Trousseau. Le libellé exact viendra de `08e`, qui interrogera le magasin —
                ici il reflète le cas signé, comme le mockup. */}
                <Badge tone="success" icon={<Icon name="lock" size={12} strokeWidth={2} />}>
                  Trousseau
                </Badge>
              </>
            )
          }
        />
      )}

      {/* **La base d'authentification, pour MongoDB seul.** Un utilisateur MongoDB appartient à une
          base, et le pilote s'authentifie contre celle-là : sans ce champ, l'utilisateur racine d'un
          conteneur officiel — qui vit dans `admin` — était injoignable dès qu'on ouvrait une autre
          base, avec un « authentification refusée » qui n'accusait rien de faux dans le formulaire.

          **Placé après le mot de passe et avant le TLS** : il appartient à l'authentification, et
          c'est là qu'on le cherche. Le laisser vide garde le comportement d'avant — la base par
          défaut fait foi —, ce que le texte de substitution dit plutôt qu'une infobulle. */}
      {!fichier && authentifieParBase(draft.engine) && (
        <Field
          label="Base d’authentification"
          mono
          value={draft.authDatabase}
          placeholder="vide : la base par défaut — « admin » pour un utilisateur racine"
          onChange={(event) => onChange({ authDatabase: event.target.value })}
        />
      )}

      {/* Rangée pleine largeur : mode SSL à gauche, les deux bascules à droite, alignées en
          bas avec un décalage de 5px pour tomber sur la ligne de base des champs.

          **Le mode SSL disparaît pour un fichier** : il n'y a pas de transport à chiffrer. Les deux
          bascules restent — « lecture seule » et « se reconnecter au démarrage » ont un sens pour
          un fichier comme pour un serveur. */}
      {/* **Le certificat d'autorité, visible seulement quand le mode l'emploie** (`06f`).
          `require` chiffre sans authentifier : le champ n'y servirait à rien, et l'afficher ferait
          croire qu'il change quelque chose. C'est la même règle que les cinq champs masqués pour un
          moteur de fichier (`17a`) — ne montrer que ce qui compte. */}
      {!fichier && authentifie(draft.sslMode) && (
        <Field
          label="Certificat d’autorité"
          mono
          value={draft.caCertificate}
          placeholder="~/certs/interne.pem — vide : autorités publiques"
          onChange={(event) => onChange({ caCertificate: event.target.value })}
        />
      )}

      <div className={styles.rowSsl}>
        {!fichier && (
          <Select
            label="Mode SSL"
            options={optionsSsl(draft.engine)}
            value={draft.sslMode}
            onValueChange={(sslMode) => onChange({ sslMode: sslMode as SslMode })}
          />
        )}
        <div className={styles.toggles}>
          <ToggleWithLabel
            checked={draft.readOnly}
            onCheckedChange={(readOnly) => onChange({ readOnly })}
            label="Ouvrir en lecture seule"
          />
          <ToggleWithLabel
            checked={draft.reconnectOnStartup}
            onCheckedChange={(reconnectOnStartup) => onChange({ reconnectOnStartup })}
            label="Se reconnecter au démarrage"
          />
        </div>
      </div>
    </div>
  )
}
