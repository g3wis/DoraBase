import { useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { Engine, SslMode } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { Field } from '../../ui/Field/Field'
import { Select } from '../../ui/Select/Select'
import type { ConnectionDraft } from './ConnectionDraft'
import { authentifieParBase, estUnFichier, estUnProjet, modesSslDisponibles } from './engines'
import { authentifie, SSL_MODES } from './environments'
import styles from './NewConnection.module.css'
import { ToggleWithLabel } from './ToggleWithLabel'

type ConnectionFormProps = {
  draft: ConnectionDraft
  onChange: (patch: Partial<ConnectionDraft>) => void
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
 * Le formulaire principal de `A2`.
 *
 * La structure est une **grille**, pas une pile de rangées flex : le mockup impose deux
 * colonnes `1fr 1fr` avec des rangées pleine largeur et des sous-grilles. Reproduire cela en
 * flex imbriqué donnerait des colonnes qui ne s'alignent pas d'une rangée à l'autre — écart
 * que Vitest ne peut pas voir, d'où les mesures dans `e2e/`.
 */
export function ConnectionForm({ draft, onChange }: ConnectionFormProps) {
  const t = useT()
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
  /*
   * **Ce que le transfert Kubernetes décide à la place de l'utilisateur** (31 août 2026).
   *
   * Un seul champ, et ce n'est pas le même que pour Cloud SQL : l'**hôte**. Une base qui vit dans
   * un cluster n'a pas d'adresse joignable depuis le poste — c'est la ressource déclarée dans le
   * panneau qui la désigne —, et la connexion se fait sur le bout local du transfert, donc sur
   * `127.0.0.1`. C'est cette valeur qui s'affiche, comme `auto` s'affiche dans le port derrière
   * Cloud SQL : dire ce qui *sera employé* plutôt que laisser un champ vide, qui se lirait comme un
   * champ oublié.
   *
   * **Le port et le mot de passe restent saisissables, à l'inverse de Cloud SQL**, et les deux
   * comptent : le port est celui de la base *dans le pod* — le membre droit du `local:distant` que
   * `kubectl` reçoit —, et un PostgreSQL dans un pod s'authentifie comme n'importe quel autre. Il
   * n'y a pas d'équivalent de l'IAM d'`06k` ici.
   *
   * **L'hôte n'est pas grisé derrière Cloud SQL**, où il est tout aussi inemployé. C'est une
   * incohérence connue et laissée en place : le visage Cloud SQL n'a jamais été conçu et attend un
   * passage de design (voir AGENTS.md), et le corriger au passage serait décider seul de ce qu'il
   * doit montrer.
   *
   * Lu sur le tunnel **réellement déclaré**, et non sur la sorte affichée dans le panneau : tant
   * qu'aucune ressource n'est saisie, il n'y a pas de proxy, et griser d'avance serait mentir.
   */
  const parKubernetes = draft.tunnel?.proxy.kind === 'kubernetes'

  return (
    <div className={styles.form}>
      {/* **Le groupe « Environnement » est parti** (#166) : l'environnement était un palier du
          modèle, et la connexion se range désormais dans le **dossier** d'où part le geste, que la
          bande d'en-tête annonce. C'est le cadre de la modale, pas un de ses champs — la leçon du
          projet, appliquée à son dernier palier. Le formulaire commence donc par l'hôte.

          `name` n'est pas saisi non plus : c'est un nom technique, calculé par
          `draftToSaveRequest` à partir de l'abréviation du moteur, et `label` — en fin de
          formulaire — le remplace à l'affichage dès qu'il est renseigné. */}
      {/* **Un moteur de fichier n'a ni hôte ni port** (`17a`). Les afficher ferait remplir cinq
          champs pour rien, et laisserait croire qu'ils comptent — c'est la raison qui a fait
          préférer masquer plutôt qu'ajouter un champ `path` vide pour six moteurs sur sept. */}
      {!fichier && (
        // Le port est **collé** à l'hôte : sous-grille `1fr 84px` avec un gap de 8px, contre
        // les 18px de la grille principale.
        <div className={styles.rowHost}>
          <Field
            label={t('newConnection.form.hostLabel')}
            mono
            disabled={parKubernetes}
            title={parKubernetes ? t('newConnection.form.reasons.hostKubernetes') : undefined}
            value={parKubernetes ? '127.0.0.1' : draft.host}
            onChange={(event) => onChange({ host: event.target.value })}
          />
          <Field
            label={t('newConnection.form.portLabel')}
            mono
            inputMode="numeric"
            disabled={parCloudSql}
            title={parCloudSql ? t('newConnection.form.reasons.portCloudSql') : undefined}
            value={parCloudSql ? 'auto' : draft.port}
            onChange={(event) => onChange({ port: event.target.value })}
          />
        </div>
      )}

      {/* **Le même champ, trois rôles.** Pour un moteur de fichier, `defaultDatabase` porte le
          chemin — le champ est déjà « la base à ouvrir », et pour SQLite la base *est* un fichier.
          Pour BigQuery (`21`), il porte l'identifiant du **projet** GCP — même raison, autre
          nature : aucun des deux n'a de serveur à qui demander « quelle base ? ». Le libellé
          change, la donnée non. */}
      <Field
        label={
          estUnProjet(draft.engine)
            ? t('newConnection.form.defaultDatabaseLabel.project')
            : fichier
              ? t('newConnection.form.defaultDatabaseLabel.file')
              : t('newConnection.form.defaultDatabaseLabel.server')
        }
        mono
        value={draft.defaultDatabase}
        placeholder={
          estUnProjet(draft.engine)
            ? t('newConnection.form.projectPlaceholder')
            : fichier
              ? t('newConnection.form.filePlaceholder')
              : undefined
        }
        onChange={(event) => onChange({ defaultDatabase: event.target.value })}
      />

      {!fichier && (
        <Field
          label={t('newConnection.form.usernameLabel')}
          mono
          value={draft.username}
          onChange={(event) => onChange({ username: event.target.value })}
        />
      )}

      {/* Un fichier local n'a pas de mot de passe (`17a`). Le champ resterait vide, et le badge
          « Trousseau » promettrait de ranger un secret qui n'existe pas. */}
      {!fichier && (
        <Field
          label={t('newConnection.form.passwordLabel')}
          mono
          type={passwordVisible ? 'text' : 'password'}
          className={styles.passwordField}
          disabled={parCloudSql}
          title={parCloudSql ? t('newConnection.form.reasons.passwordCloudSql') : undefined}
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
                    passwordVisible
                      ? t('newConnection.form.hidePassword')
                      : t('newConnection.form.showPassword')
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
                  {t('newConnection.form.keychainBadge')}
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
          label={t('newConnection.form.authDatabaseLabel')}
          mono
          value={draft.authDatabase}
          placeholder={t('newConnection.form.authDatabasePlaceholder')}
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
          label={t('newConnection.form.caCertificateLabel')}
          mono
          value={draft.caCertificate}
          placeholder={t('newConnection.form.caCertificatePlaceholder')}
          onChange={(event) => onChange({ caCertificate: event.target.value })}
        />
      )}

      <div className={styles.rowSsl}>
        {!fichier && (
          <Select
            label={t('newConnection.form.sslModeLabel')}
            options={optionsSsl(draft.engine)}
            value={draft.sslMode}
            onValueChange={(sslMode) => onChange({ sslMode: sslMode as SslMode })}
          />
        )}
        <div className={styles.toggles}>
          <ToggleWithLabel
            checked={draft.readOnly}
            onCheckedChange={(readOnly) => onChange({ readOnly })}
            label={t('newConnection.form.readOnlyLabel')}
          />
          <ToggleWithLabel
            checked={draft.reconnectOnStartup}
            onCheckedChange={(reconnectOnStartup) => onChange({ reconnectOnStartup })}
            label={t('newConnection.form.reconnectLabel')}
          />
        </div>
      </div>

      {/* **Le libellé, en dernier** (27 août 2026) : un affichage, pas une identité. Il ne fait
          jamais partie de la clé du registre ni de la référence du secret — `name`, au tout début
          du formulaire, seul verrouillé par `verrouille`, garde ce rôle. Renseigné, il remplace
          `name` (ou son défaut) partout où l'arbre, le fil d'Ariane et la barre de titre
          affichent cette base ; vide, `name` fait foi comme avant ce champ. */}
      <Field
        label={t('newConnection.form.labelLabel')}
        value={draft.label}
        placeholder={t('newConnection.form.labelPlaceholder')}
        onChange={(event) => onChange({ label: event.target.value })}
      />
    </div>
  )
}
