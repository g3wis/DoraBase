import { useState } from 'react'
import type { ManagedInstance } from '../../domain/config'
import type {
  DatabasePrivilege,
  InstanceAction,
  InstanceDatabase,
  InstanceRole,
  InstanceSession,
  InstanceSetting,
  RoleAttributes,
} from '../../domain/instances'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Field, SANS_CORRECTION } from '../../ui/Field/Field'
import { Modal } from '../../ui/Modal/Modal'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './GestureDialogs.module.css'
import type { PasserelleInstances } from './instanceCommands'
import { destinataireParDefaut } from './instances'
import { SqlConfirm } from './SqlConfirm'

/**
 * Ce que l'écran demande, avant que le geste soit composé.
 *
 * **Deux familles, et la distinction est le cœur de ce fichier.** Cinq demandes portent déjà tout ce
 * qu'il faut — supprimer une base, terminer une session, retirer une extension — et vont droit à la
 * confirmation. Les autres ont besoin d'une saisie : un nom, un propriétaire, une valeur. Le
 * formulaire les recueille, **puis** la confirmation montre le SQL.
 *
 * Un seul écran aurait mêlé « que voulez-vous faire ? » et « voici ce qui va partir » : le second
 * n'est vrai qu'une fois le premier rempli, et un encart de SQL qui se réécrirait à chaque frappe
 * cesserait d'être ce qu'on relit avant d'agir.
 */
export type Demande =
  | { kind: 'newDatabase' }
  | { kind: 'editDatabase'; database: InstanceDatabase }
  | { kind: 'dropDatabase'; database: InstanceDatabase }
  | { kind: 'newRole' }
  | { kind: 'editRole'; role: InstanceRole }
  | { kind: 'dropRole'; role: InstanceRole }
  | {
      kind: 'privilege'
      role: string
      database: string
      privilege: DatabasePrivilege
      accorder: boolean
    }
  | { kind: 'terminateSession'; session: InstanceSession }
  | { kind: 'installExtension' }
  | { kind: 'createExtension'; name: string }
  | { kind: 'dropExtension'; name: string }
  | { kind: 'setParameter'; setting: InstanceSetting }
  | { kind: 'resetParameter'; name: string }

export type GestureDialogsProps = {
  demande: Demande
  instance: ManagedInstance
  /** Les rôles lus, pour le sélecteur de destinataire d'un `REASSIGN OWNED`. */
  roles: readonly InstanceRole[]
  /** Le rôle de la session, destinataire par défaut d'une réattribution. */
  roleCourant: string | undefined
  passerelle: PasserelleInstances
  onClose: () => void
  /** Appelé après une exécution réussie : l'écran relit sa section. */
  onFait: () => void | Promise<void>
}

/**
 * Les formulaires de geste, et la confirmation qui les suit (`API-32`).
 *
 * L'enchaînement est toujours le même : une demande → éventuellement une saisie → **le SQL exact** →
 * l'exécution. Aucun geste n'échappe à la confirmation, y compris ceux qui ne retirent rien : voir
 * un `CREATE DATABASE` avant qu'il parte coûte un clic et apprend ce que DoraBase envoie — et le
 * jour où l'on hésite sur un `DROP`, l'habitude de lire l'encart est déjà prise.
 */
export function GestureDialogs({
  demande,
  instance,
  roles,
  roleCourant,
  passerelle,
  onClose,
  onFait,
}: GestureDialogsProps) {
  const t = useT()
  /** L'action composée, une fois la saisie faite. `null` tant que le formulaire est ouvert. */
  const [action, setAction] = useState<InstanceAction | null>(() => actionDirecte(demande))

  if (action !== null) {
    return (
      <SqlConfirm
        action={action}
        production={instance.production}
        onPlan={passerelle.planInstanceAction}
        onRun={async (aExecuter) => {
          await passerelle.runInstanceAction(instance.id, aExecuter)
          await onFait()
        }}
        onClose={onClose}
      />
    )
  }

  switch (demande.kind) {
    case 'newDatabase':
      return (
        <FormulaireBase
          titre={t('instances.newDatabase.title')}
          onClose={onClose}
          onValider={(name, owner) => setAction({ kind: 'createDatabase', name, owner })}
        />
      )
    case 'editDatabase':
      return (
        <FormulaireProprietaire
          base={demande.database}
          onClose={onClose}
          onValider={(owner) =>
            setAction({ kind: 'alterDatabaseOwner', name: demande.database.name, owner })
          }
        />
      )
    case 'newRole':
      return (
        <FormulaireRole
          titre={t('instances.newRole.title')}
          onVerifier={passerelle.scramVerifier}
          onClose={onClose}
          onValider={(name, attributes, verifier) =>
            setAction({ kind: 'createRole', name, attributes, verifier })
          }
        />
      )
    case 'editRole':
      return (
        <FormulaireRole
          titre={t('instances.editRole.title')}
          role={demande.role}
          onVerifier={passerelle.scramVerifier}
          onClose={onClose}
          onValider={(name, attributes, verifier) =>
            setAction({ kind: 'alterRole', name, attributes, verifier })
          }
        />
      )
    case 'dropRole':
      return (
        <FormulaireSuppressionDeRole
          role={demande.role}
          roles={roles}
          roleCourant={roleCourant}
          onClose={onClose}
          onValider={(reassignTo) =>
            setAction({ kind: 'dropRole', name: demande.role.name, reassignTo })
          }
        />
      )
    case 'installExtension':
      return (
        <FormulaireExtension
          onClose={onClose}
          onValider={(name) => setAction({ kind: 'createExtension', name })}
        />
      )
    case 'setParameter':
      return (
        <FormulaireParametre
          setting={demande.setting}
          onClose={onClose}
          onValider={(value) =>
            setAction({ kind: 'setParameter', name: demande.setting.name, value })
          }
        />
      )
    default:
      // Les demandes directes ont déjà rempli `action` : ce bras n'est atteint par aucune d'elles.
      return null
  }
}

/**
 * Les demandes qui n'ont rien à saisir vont droit à la confirmation.
 *
 * **Le calcul est fait à l'initialisation de l'état, non dans un effet** : un effet aurait rendu une
 * fois `null` — donc un formulaire vide, le temps d'un cadre — avant de poser l'action.
 */
function actionDirecte(demande: Demande): InstanceAction | null {
  switch (demande.kind) {
    case 'dropDatabase':
      return { kind: 'dropDatabase', name: demande.database.name }
    case 'privilege':
      return demande.accorder
        ? {
            kind: 'grantDatabase',
            role: demande.role,
            database: demande.database,
            privilege: demande.privilege,
          }
        : {
            kind: 'revokeDatabase',
            role: demande.role,
            database: demande.database,
            privilege: demande.privilege,
          }
    case 'terminateSession':
      return { kind: 'terminateSession', pid: demande.session.pid }
    case 'createExtension':
      return { kind: 'createExtension', name: demande.name }
    case 'dropExtension':
      return { kind: 'dropExtension', name: demande.name }
    case 'resetParameter':
      return { kind: 'resetParameter', name: demande.name }
    default:
      return null
  }
}

function FormulaireBase({
  titre,
  onClose,
  onValider,
}: {
  titre: string
  onClose: () => void
  onValider: (name: string, owner: string | null) => void
}) {
  const t = useT()
  const [nom, setNom] = useState('')
  const [proprietaire, setProprietaire] = useState('')

  return (
    <Cadre
      titre={titre}
      onClose={onClose}
      valider={nom.trim() === '' ? undefined : () => onValider(nom.trim(), vide(proprietaire))}
    >
      <Field
        label={t('instances.newDatabase.name')}
        value={nom}
        onChange={(evenement) => setNom(evenement.target.value)}
        {...SANS_CORRECTION}
      />
      {/* Le champ vide vaut « le rôle courant », ce que le `placeholder` dit : le SQL n'écrira alors
          aucun `OWNER`, et c'est le serveur qui choisit — mentir ici afficherait un propriétaire
          qu'on n'a pas demandé. */}
      <Field
        label={t('instances.newDatabase.owner')}
        value={proprietaire}
        placeholder={t('instances.newDatabase.ownerDefault')}
        onChange={(evenement) => setProprietaire(evenement.target.value)}
        {...SANS_CORRECTION}
      />
    </Cadre>
  )
}

function FormulaireProprietaire({
  base,
  onClose,
  onValider,
}: {
  base: InstanceDatabase
  onClose: () => void
  onValider: (owner: string) => void
}) {
  const t = useT()
  const [proprietaire, setProprietaire] = useState(base.owner)

  return (
    <Cadre
      titre={t('instances.editDatabase.title')}
      onClose={onClose}
      valider={
        proprietaire.trim() === '' || proprietaire.trim() === base.owner
          ? undefined
          : () => onValider(proprietaire.trim())
      }
    >
      <Field
        label={t('instances.editDatabase.owner')}
        value={proprietaire}
        onChange={(evenement) => setProprietaire(evenement.target.value)}
        {...SANS_CORRECTION}
      />
    </Cadre>
  )
}

/**
 * Un rôle : son nom, ses attributs, et **son mot de passe** (10 septembre 2026).
 *
 * # Le mot de passe est un champ d'ici, non un geste à part
 *
 * Il a d'abord été une troisième action de ligne, avec sa propre modale. Rapporté à l'usage : c'est
 * une propriété du rôle, on la change en même temps qu'on lui retire `SUPERUSER`, et deux entrées
 * pour « modifier ce rôle » demandaient de savoir laquelle porte quoi avant de cliquer.
 *
 * **L'objection qui l'avait séparé tombe avec le champ vide.** Elle valait « la création prendrait un
 * aller-retour de hachage pour un champ que la moitié des rôles n'ont pas » : vide, il n'y a ni
 * hachage ni `PASSWORD` dans l'ordre. Ce n'est donc payé que par ceux qui s'en servent.
 *
 * # Un seul ordre, et c'est ce qui décide de la fusion
 *
 * `ALTER ROLE x LOGIN … PASSWORD '…'` est une seule instruction. Deux ordres — les attributs, puis
 * le mot de passe — pourraient s'appliquer à moitié, et ce geste n'a aucune transaction pour l'en
 * empêcher : `mots_du_mot_de_passe` les compose donc ensemble.
 *
 * # Deux champs, et le second n'est pas une formalité
 *
 * Un mot de passe posé ne se relit nulle part. Une faute de frappe verrouille le rôle sans que rien
 * le dise, et le seul remède est d'en poser un autre. C'est le seul champ du produit qui demande une
 * confirmation de saisie.
 *
 * **Aucune règle de robustesse** en revanche : ce que le serveur exige est décidé par son
 * administrateur, éventuellement par `passwordcheck`, et en inventer une refuserait des mots de
 * passe que la base accepte.
 */
function FormulaireRole({
  titre,
  role,
  onVerifier,
  onClose,
  onValider,
}: {
  titre: string
  role?: InstanceRole
  /** Hache le mot de passe. Voir `scramVerifier` : ce qui part est le vérificateur, jamais la saisie. */
  onVerifier: (motDePasse: string) => Promise<string>
  onClose: () => void
  onValider: (name: string, attributes: RoleAttributes, verifier: string | null) => void
}) {
  const t = useT()
  const [nom, setNom] = useState(role?.name ?? '')
  const [attributs, setAttributs] = useState<RoleAttributes>({
    canLogin: role?.canLogin ?? true,
    superuser: role?.superuser ?? false,
    createDb: role?.createDb ?? false,
    createRole: role?.createRole ?? false,
  })
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const discordent = motDePasse !== '' && confirmation !== motDePasse
  const pret = nom.trim() !== '' && !discordent && !enCours

  async function valider() {
    // **Vide, rien n'est haché et rien n'est écrit** : c'est ce qui rend le champ gratuit pour ceux
    // qui ne s'en servent pas, et c'est la règle du mot de passe de `mettre_a_jour` — le champ vide
    // laisse en place, il n'efface pas.
    if (motDePasse === '') {
      onValider(nom.trim(), attributs, null)
      return
    }
    setEnCours(true)
    setErreur(null)
    try {
      onValider(nom.trim(), attributs, await onVerifier(motDePasse))
    } catch (cause) {
      // **Le refus de SASLprep arrive ici**, et c'est le seul que ce chemin puisse rendre : une
      // chaîne que le serveur et le pilote normaliseraient différemment verrouillerait le rôle.
      setErreur(messageDe(cause))
      setEnCours(false)
    }
  }

  return (
    <Cadre
      titre={titre}
      onClose={onClose}
      valider={pret ? valider : undefined}
      {...(enCours ? { libelleValider: t('instances.setPassword.hashing') } : {})}
    >
      <Field
        label={t('instances.newRole.name')}
        value={nom}
        /* **Le nom d'un rôle existant ne se change pas ici.** Un `ALTER ROLE … RENAME TO` est un
           autre geste : il invalide le mot de passe stocké côté serveur pour les rôles à `md5`, et
           il traverse tous les `GRANT` qui nomment le rôle. Le champ reste visible — c'est
           l'identité de ce qu'on modifie — mais en lecture. */
        readOnly={role !== undefined}
        onChange={(evenement) => setNom(evenement.target.value)}
        {...SANS_CORRECTION}
      />
      <Interrupteur
        coche={attributs.canLogin}
        onChange={(coche) => setAttributs({ ...attributs, canLogin: coche })}
        libelle={t('instances.newRole.canLogin')}
      />
      <Interrupteur
        coche={attributs.superuser}
        onChange={(coche) => setAttributs({ ...attributs, superuser: coche })}
        libelle={t('instances.newRole.superuser')}
      />
      <Interrupteur
        coche={attributs.createDb}
        onChange={(coche) => setAttributs({ ...attributs, createDb: coche })}
        libelle={t('instances.newRole.createDb')}
      />
      <Interrupteur
        coche={attributs.createRole}
        onChange={(coche) => setAttributs({ ...attributs, createRole: coche })}
        libelle={t('instances.newRole.createRole')}
      />
      {/* **Le mot de passe n'a de sens que pour un rôle qui se connecte.** Désactivé sinon, avec sa
          raison : PostgreSQL l'accepterait, mais rien ne s'en servirait jamais. Le champ reste
          visible — le masquer ferait chercher où il est passé en décochant `LOGIN`. */}
      <Field
        label={
          role === undefined
            ? t('instances.setPassword.password')
            : t('instances.setPassword.newPassword')
        }
        type={visible ? 'text' : 'password'}
        value={motDePasse}
        disabled={!attributs.canLogin}
        title={attributs.canLogin ? undefined : t('instances.setPassword.noLogin')}
        placeholder={role === undefined ? undefined : t('instances.setPassword.unchanged')}
        onChange={(evenement) => setMotDePasse(evenement.target.value)}
        {...SANS_CORRECTION}
        suffix={
          <button
            type="button"
            className={styles.oeil}
            aria-label={t('instances.setPassword.reveal')}
            aria-pressed={visible}
            onClick={() => setVisible((precedent) => !precedent)}
          >
            ◉
          </button>
        }
      />
      {/* La confirmation ne paraît qu'une fois quelque chose saisi : sur un formulaire d'attributs
          où le mot de passe reste vide, deux champs de plus seraient deux champs pour rien. */}
      {motDePasse !== '' && (
        <Field
          label={t('instances.setPassword.confirm')}
          type={visible ? 'text' : 'password'}
          value={confirmation}
          onChange={(evenement) => setConfirmation(evenement.target.value)}
          {...SANS_CORRECTION}
        />
      )}
      {discordent && (
        <p className={styles.desaccord} role="alert">
          {t('instances.setPassword.mismatch')}
        </p>
      )}
      {motDePasse !== '' && <p className={styles.note}>{t('instances.setPassword.hashed')}</p>}
      {erreur !== null && (
        <p className={styles.desaccord} role="alert">
          {erreur}
        </p>
      )}
    </Cadre>
  )
}

function FormulaireSuppressionDeRole({
  role,
  roles,
  roleCourant,
  onClose,
  onValider,
}: {
  role: InstanceRole
  roles: readonly InstanceRole[]
  roleCourant: string | undefined
  onClose: () => void
  onValider: (reassignTo: string) => void
}) {
  const t = useT()
  const [destinataire, setDestinataire] = useState(
    () => destinataireParDefaut(roleCourant, role.name) ?? '',
  )

  return (
    <Cadre
      titre={t('instances.dropRole.title')}
      onClose={onClose}
      valider={destinataire.trim() === '' ? undefined : () => onValider(destinataire.trim())}
    >
      <Field
        label={t('instances.dropRole.reassign')}
        value={destinataire}
        list="instances-roles"
        onChange={(evenement) => setDestinataire(evenement.target.value)}
        {...SANS_CORRECTION}
      />
      {/* Une liste de suggestions native plutôt qu'une liste déroulante : ce champ **accepte** un
          nom qui n'est pas dans la liste — un rôle créé depuis un autre client, entre deux relevés —
          et une liste fermée le refuserait. La prohibition porte sur les listes déroulantes, dont le
          maison remplace l'apparence ; un `datalist` n'en est pas une, il complète une saisie. */}
      <datalist id="instances-roles">
        {roles
          .filter((autre) => autre.name !== role.name && !autre.system)
          .map((autre) => (
            <option key={autre.name} value={autre.name} />
          ))}
      </datalist>
      <p className={styles.note}>{t('instances.dropRole.reassignHint')}</p>
    </Cadre>
  )
}

function FormulaireExtension({
  onClose,
  onValider,
}: {
  onClose: () => void
  onValider: (name: string) => void
}) {
  const t = useT()
  const [nom, setNom] = useState('')

  return (
    <Cadre
      titre={t('instances.installExtension.title')}
      onClose={onClose}
      valider={nom.trim() === '' ? undefined : () => onValider(nom.trim())}
    >
      <Field
        label={t('instances.installExtension.name')}
        value={nom}
        onChange={(evenement) => setNom(evenement.target.value)}
        {...SANS_CORRECTION}
      />
    </Cadre>
  )
}

function FormulaireParametre({
  setting,
  onClose,
  onValider,
}: {
  setting: InstanceSetting
  onClose: () => void
  onValider: (value: string) => void
}) {
  const t = useT()
  const [valeur, setValeur] = useState(setting.value)

  return (
    <Cadre
      titre={t('instances.setParameter.title')}
      onClose={onClose}
      valider={valeur === setting.value ? undefined : () => onValider(valeur)}
    >
      <Field
        label={setting.name}
        value={valeur}
        mono
        onChange={(evenement) => setValeur(evenement.target.value)}
        {...SANS_CORRECTION}
      />
    </Cadre>
  )
}

/**
 * La coquille commune des formulaires de geste.
 *
 * **`valider` absent désactive le bouton**, plutôt qu'un booléen à côté : la condition et l'action
 * sont la même chose — « il y a de quoi composer un geste » —, et deux props laisseraient la
 * possibilité d'un bouton actif qui n'appelle rien.
 */
function Cadre({
  titre,
  onClose,
  valider,
  libelleValider,
  children,
}: {
  titre: string
  onClose: () => void
  valider?: () => void
  /** Remplace « Exécuter » le temps d'un calcul — le hachage d'un mot de passe, seul cas. */
  libelleValider?: string
  children: React.ReactNode
}) {
  const t = useT()
  return (
    <Modal
      title={titre}
      icon="srv"
      nested
      compact
      onClose={onClose}
      footer={
        <div className={styles.pied}>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('instances.confirm.cancel')}
          </Button>
          <Button variant="accent" size="md" onClick={valider} disabled={valider === undefined}>
            {libelleValider ?? t('instances.confirm.run')}
          </Button>
        </div>
      }
    >
      <form
        className={styles.formulaire}
        onSubmit={(evenement) => {
          evenement.preventDefault()
          valider?.()
        }}
      >
        {children}
        {/* Un bouton de soumission masqué : sans lui, `Entrée` dans un champ ne validerait pas — le
            bouton du pied vit hors du `<form>`, dans la bande de `Modal`. */}
        <button type="submit" className={styles.soumission} tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  )
}

/**
 * Un interrupteur avec son libellé.
 *
 * **Le `Toggle` de `ui/`, habillé ici** — et non le `ToggleWithLabel` d'`A2`, qui l'habille avec la
 * feuille de style de son écran. C'est le partage que le diagramme a déjà établi : la primitive
 * porte le contrôle, l'écran porte sa mise en page.
 *
 * Le libellé est **cliquable** parce qu'il est dans le `<label>` du contrôle : un interrupteur de
 * 26 px se rate, un libellé de deux mots non.
 */
function Interrupteur({
  coche,
  onChange,
  libelle,
}: {
  coche: boolean
  onChange: (coche: boolean) => void
  libelle: string
}) {
  return (
    /* **Un `<span>` et non un `<label>`** : le nom accessible vient déjà de l'`aria-label` du
       bouton, et un `<label for>` sur un `role="switch"` le doublerait dans l'annonce. C'est la
       raison de `ToggleWithLabel`, et elle vaut ici. Le texte reste cliquable — il est dans la
       zone du contrôle, dont le `onClick` remonte. */
    <span className={styles.interrupteur}>
      <Toggle checked={coche} onCheckedChange={onChange} label={libelle} />
      <span>{libelle}</span>
    </span>
  )
}

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}

function vide(valeur: string): string | null {
  const propre = valeur.trim()
  return propre === '' ? null : propre
}
