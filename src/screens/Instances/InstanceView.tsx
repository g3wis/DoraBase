import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { ManagedInstance } from '../../domain/config'
import type { ConnectionState } from '../../domain/engine'
import type {
  InstanceAction,
  InstanceDatabase,
  InstanceExtension,
  InstanceOverview,
  InstancePrivilege,
  InstanceRole,
  InstanceSession,
  InstanceSetting,
} from '../../domain/instances'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { SegmentedControl } from '../../ui/SegmentedControl/SegmentedControl'
import { SidebarFilterBar } from '../../ui/SidebarFilterBar/SidebarFilterBar'
import { type Demande, GestureDialogs } from './GestureDialogs'
import styles from './InstanceView.module.css'
import type { PasserelleInstances } from './instanceCommands'
import {
  ageLisible,
  nomAffiche,
  permis,
  raisonDuRefus,
  SECTIONS,
  type SectionInstance,
} from './instances'
import { DatabasesSection } from './sections/DatabasesSection'
import { ExtensionsSection } from './sections/ExtensionsSection'
import { OverviewSection } from './sections/OverviewSection'
import { PrivilegesSection } from './sections/PrivilegesSection'
import { RolesSection } from './sections/RolesSection'
import { SessionsSection } from './sections/SessionsSection'
import { SettingsSection } from './sections/SettingsSection'

/** Ce qu'une lecture de section a rendu. Trois phases, comme le gestionnaire de schémas. */
export type Lecture<T> =
  | { phase: 'chargement' }
  | { phase: 'prete'; donnees: T; releve: number }
  | { phase: 'echouee'; message: string }

type Lectures = {
  overview?: Lecture<InstanceOverview>
  databases?: Lecture<InstanceDatabase[]>
  roles?: Lecture<InstanceRole[]>
  privileges?: Lecture<InstancePrivilege[]>
  sessions?: Lecture<InstanceSession[]>
  extensions?: Lecture<InstanceExtension[]>
  settings?: Lecture<InstanceSetting[]>
}

export type InstanceViewProps = {
  instance: ManagedInstance
  /** L'état de la connexion d'administration. `never` : l'onglet propose de l'ouvrir. */
  etat: ConnectionState
  passerelle: PasserelleInstances
  /** Ouvre la connexion. L'écran l'appelle au montage, et le bouton de reprise le rappelle. */
  onOuvrir: () => void
  /** `Date.now`, injectable : l'âge du relevé est ce que le décor doit pouvoir figer. */
  maintenant?: () => number
}

/**
 * L'écran d'une instance managée (`API-32`) : sept sections sur une connexion d'administration.
 *
 * # Un onglet du workbench, pas une modale
 *
 * Ce qu'on vient y faire dure : on regarde les rôles, on va voir les privilèges, on revient. Une
 * modale aurait fermé l'écran de travail derrière elle, et empêché de comparer ce qu'une instance
 * dit avec ce qu'une base montre. C'est un contenu du centre, qui se ferme et se réordonne comme les
 * autres — la même raison qui a fait du diagramme un onglet.
 *
 * # Le rafraîchissement est à la demande, et l'âge du relevé est dit
 *
 * Aucun minuteur. Un relevé périodique ferait bouger un tableau sous les yeux de qui le lit,
 * interrogerait un serveur de production que personne ne regarde, et rendrait toute capture de
 * fidélité instable. Ce qui remplace le mouvement est la **phrase** : « relevé il y a 12 s » dit
 * l'âge de ce qu'on voit, et le bouton dit comment en avoir un neuf. C'est l'arbitrage de « pas
 * encore cherché n'est pas à jour », appliqué à une lecture.
 *
 * # Chaque section se lit à sa première visite
 *
 * Sept lectures au montage feraient sept allers-retours pour une section regardée. La vue d'ensemble
 * fait exception : elle est chargée dès l'ouverture, parce qu'elle porte les **capacités** — ce que
 * ce compte a le droit de faire — dont toutes les autres sections ont besoin pour désactiver leurs
 * gestes avec leur raison.
 */
export function InstanceView({
  instance,
  etat,
  passerelle,
  onOuvrir,
  maintenant = Date.now,
}: InstanceViewProps) {
  const t = useT()
  const [section, setSection] = useState<SectionInstance>('overview')
  const [lectures, setLectures] = useState<Lectures>({})
  const [filtre, setFiltre] = useState('')
  const [demande, setDemande] = useState<Demande | null>(null)

  const ouverte = etat.kind === 'connected'

  /**
   * Les sections déjà demandées, **dans une ref et non dans `lectures`**.
   *
   * La garde « déjà lu, on ne relit pas » doit être lisible par `lire` sans que `lire` en dépende :
   * une fonction qui lirait `lectures` changerait d'identité à chaque réponse, donc les effets qui
   * l'appellent repartiraient — une lecture en boucle, et sur un serveur de production. La ref porte
   * l'intention (« j'ai demandé »), l'état porte le résultat.
   *
   * Elle n'a pas à être vidée : l'onglet est monté avec l'identifiant de l'instance en `key`, donc
   * changer d'instance remonte le composant et la ref avec lui.
   */
  const demandees = useRef(new Set<SectionInstance>())

  /**
   * Lit une section, ou la relit.
   *
   * **`forcer` distingue « la première visite » de « le bouton Rafraîchir ».** Sans lui, revenir sur
   * une section relirait ce qu'on vient de lire — donc un aller-retour par clic de bande —, et le
   * bouton ne pourrait rien relire du tout.
   */
  const lire = useCallback(
    async (cible: SectionInstance, forcer = false) => {
      if (!ouverte) return
      if (!forcer && demandees.current.has(cible)) return
      demandees.current.add(cible)
      setLectures((precedent) => ({ ...precedent, [cible]: { phase: 'chargement' } }))
      try {
        const donnees = await lecteurDe(cible, passerelle)(instance.id)
        setLectures((precedent) => ({
          ...precedent,
          [cible]: { phase: 'prete', donnees, releve: maintenant() },
        }))
      } catch (cause) {
        setLectures((precedent) => ({
          ...precedent,
          [cible]: { phase: 'echouee', message: messageDe(cause) },
        }))
      }
    },
    [instance.id, maintenant, ouverte, passerelle],
  )

  // **L'ouverture est demandée au montage**, comme un onglet de console ouvre sa connexion : arriver
  // sur un écran qui affiche « l'instance n'est pas ouverte » et un bouton, alors qu'on vient de
  // cliquer sur sa ligne, serait un geste de plus pour rien. Le bouton reste pour la reprise après
  // un échec.
  // **Une reconnexion oublie ce qui a été demandé.** Sans cela, une section dont la lecture a
  // échoué pendant la coupure resterait sur son message d'erreur : elle serait « déjà demandée »,
  // et rien ne la relirait.
  useEffect(() => {
    if (!ouverte) demandees.current.clear()
  }, [ouverte])

  useEffect(() => {
    if (etat.kind === 'never') onOuvrir()
    // `etat.kind` seul : l'objet est recomposé à chaque rendu du parent, et le suivre relancerait
    // l'ouverture en boucle. C'est le défaut du `rowId` de `A5`, par le même bout.
  }, [etat.kind, onOuvrir])

  // La vue d'ensemble dès l'ouverture — elle porte les capacités, dont les six autres sections ont
  // besoin. Les six autres attendent leur première visite.
  useEffect(() => {
    void lire('overview')
  }, [lire])

  useEffect(() => {
    void lire(section)
  }, [lire, section])

  const overview = lectures.overview?.phase === 'prete' ? lectures.overview.donnees : undefined
  const capacites = overview?.capabilities
  const lecture = lectures[section]

  /** Le relevé de la section affichée, pour la phrase de la barre. */
  const age = useMemo(() => {
    if (lecture?.phase !== 'prete') return null
    return ageLisible(lecture.releve, maintenant())
    // `maintenant` est lu à chaque rendu : la phrase se rafraîchit quand l'écran bouge pour une
    // autre raison, et **ne bouge pas toute seule**. C'est voulu — un compteur qui s'incrémente
    // serait le minuteur que cette section n'a pas.
  }, [lecture, maintenant])

  /** Rejoue le geste, puis relit la section — et la vue d'ensemble, dont les comptes ont bougé. */
  const apresLeGeste = useCallback(async () => {
    await lire(section, true)
    if (section !== 'overview') await lire('overview', true)
  }, [lire, section])

  return (
    <div className={styles.root}>
      <div className={styles.filDAriane}>
        {/* Un `<nav>` nommé, comme le fil d'Ariane de l'explorateur : c'est un chemin, et c'est ce
            qui le rend désignable — à la voix comme dans un test. */}
        <nav className={styles.chemin} aria-label={t('instances.breadcrumb.path')}>
          <Icon name="srv" size={13} strokeWidth={1.8} className={styles.icone} />
          {/* **Une seule chaîne, non deux nœuds séparés par un `:`.** JSX en ferait trois nœuds de
              texte, que le calcul du nom accessible concatène sans espace — juste ici, mais c'est
              par ce chemin que « Tables8 » est arrivé cinq fois. Une chaîne composée ne peut pas se
              tromper. */}
          <span
            className={styles.hote}
          >{`${instance.connection.host}:${instance.connection.port}`}</span>
          <Icon name="chevr" size={11} strokeWidth={2.4} className={styles.separateur} />
          <span className={styles.sectionCourante}>{t(`instances.sections.${section}`)}</span>
        </nav>
        {/* **Le rôle est visible en permanence**, et c'est l'information qui décide de ce que cet
            écran autorise. La lire dans une infobulle, ou seulement dans la vue d'ensemble,
            obligerait à changer de section pour savoir avec quoi on agit. */}
        <span className={styles.role}>
          {t('instances.breadcrumb.connectedAs', {
            role: overview?.identity.role ?? instance.connection.username,
          })}
          {overview !== undefined &&
            ` · ${
              permis(capacites, 'setParameter')
                ? t('instances.breadcrumb.superuser')
                : t('instances.breadcrumb.limited')
            }`}
        </span>
      </div>

      <div className={styles.bande}>
        <SegmentedControl
          label={t('instances.sections.label')}
          segments={SECTIONS.map((valeur) => ({
            value: valeur,
            label: t(`instances.sections.${valeur}`),
            ...(compteDe(valeur, lectures) === undefined
              ? {}
              : { count: compteDe(valeur, lectures) }),
          }))}
          value={section}
          onValueChange={(suivante) => {
            setSection(suivante)
            // Le filtre appartient à la section : le garder ferait arriver sur un tableau vide, avec
            // un champ rempli qu'on n'a pas rempli pour lui.
            setFiltre('')
          }}
        />
      </div>

      <div className={styles.barre}>
        {actionPrincipale(section) !== null && (
          <Button
            size="sm"
            variant="accent"
            disabled={
              !ouverte || !permis(capacites, actionPrincipale(section)?.geste ?? 'createDatabase')
            }
            title={raisonDuRefus(capacites, actionPrincipale(section)?.geste ?? 'createDatabase')}
            onClick={() => setDemande(actionPrincipale(section)?.demande ?? null)}
          >
            {t(`instances.toolbar.${actionPrincipale(section)?.libelle}`)}
          </Button>
        )}
        <button
          type="button"
          className={styles.rafraichir}
          onClick={() => void lire(section, true)}
          disabled={!ouverte}
          aria-label={t('instances.toolbar.refresh')}
          title={t('instances.toolbar.refresh')}
        >
          <Icon name="refresh" size={13} strokeWidth={1.8} />
        </button>
        {/* **L'âge du relevé, en toutes lettres.** C'est ce qui remplace le mouvement d'un
            rafraîchissement périodique : on sait ce qu'on regarde, et le bouton dit comment en avoir
            un neuf. « Pas encore relevé » n'est pas « à jour » — quatre états, pas deux. */}
        <span className={styles.releve}>
          {age === null
            ? t('instances.toolbar.neverMeasured')
            : t('instances.toolbar.measured', { age })}
        </span>
        {section === 'privileges' && (
          <span className={styles.legende}>{t('instances.toolbar.legend')}</span>
        )}
        {section !== 'overview' && (
          <span className={styles.filtre}>
            <SidebarFilterBar
              value={filtre}
              onChange={setFiltre}
              placeholder={t('instances.toolbar.filter')}
            />
          </span>
        )}
      </div>

      <div className={styles.contenu}>
        {!ouverte ? (
          <div className={styles.etat}>
            <p className={styles.message}>
              {etat.kind === 'connecting'
                ? t('instances.state.connecting')
                : etat.kind === 'offline'
                  ? t('instances.state.offline', { reason: etat.reason })
                  : t('instances.state.never')}
            </p>
            {etat.kind !== 'connecting' && (
              <Button size="sm" variant="secondary" onClick={onOuvrir}>
                {t('instances.state.open')}
              </Button>
            )}
          </div>
        ) : lecture === undefined || lecture.phase === 'chargement' ? (
          <p className={styles.message}>{t('instances.state.loading')}</p>
        ) : lecture.phase === 'echouee' ? (
          <p className={styles.message} role="alert">
            {t('instances.state.failed', { reason: lecture.message })}
          </p>
        ) : (
          <Sections
            section={section}
            lecture={lecture}
            filtre={filtre}
            instance={instance}
            capacites={capacites}
            roleCourant={overview?.identity.role}
            onDemander={setDemande}
          />
        )}
      </div>

      {demande !== null && (
        <GestureDialogs
          demande={demande}
          instance={instance}
          roles={lectures.roles?.phase === 'prete' ? lectures.roles.donnees : []}
          roleCourant={overview?.identity.role}
          passerelle={passerelle}
          onClose={() => setDemande(null)}
          onFait={apresLeGeste}
        />
      )}
    </div>
  )
}

/**
 * Le contenu d'une section.
 *
 * **Un composant par section, et non un `switch` de tableaux dans ce fichier** : chacune a ses
 * colonnes, ses gestes de ligne et ses règles de désactivation, et les mêler ferait un fichier où
 * l'on ne trouverait plus laquelle refuse de supprimer une base modèle.
 */
function Sections({
  section,
  lecture,
  filtre,
  instance,
  capacites,
  roleCourant,
  onDemander,
}: {
  section: SectionInstance
  lecture: Extract<Lecture<unknown>, { phase: 'prete' }>
  filtre: string
  instance: ManagedInstance
  capacites: InstanceOverview['capabilities'] | undefined
  roleCourant: string | undefined
  onDemander: (demande: Demande) => void
}) {
  const commun = { filtre, capacites, onDemander }
  switch (section) {
    case 'overview':
      return <OverviewSection overview={lecture.donnees as InstanceOverview} instance={instance} />
    case 'databases':
      return <DatabasesSection databases={lecture.donnees as InstanceDatabase[]} {...commun} />
    case 'roles':
      return (
        <RolesSection
          roles={lecture.donnees as InstanceRole[]}
          roleCourant={roleCourant}
          {...commun}
        />
      )
    case 'privileges':
      return <PrivilegesSection privileges={lecture.donnees as InstancePrivilege[]} {...commun} />
    case 'sessions':
      return <SessionsSection sessions={lecture.donnees as InstanceSession[]} {...commun} />
    case 'extensions':
      return <ExtensionsSection extensions={lecture.donnees as InstanceExtension[]} {...commun} />
    case 'settings':
      return <SettingsSection settings={lecture.donnees as InstanceSetting[]} {...commun} />
  }
}

/** La lecture de chaque section. Une table plutôt qu'un `switch` : sept lignes, sept commandes. */
function lecteurDe(section: SectionInstance, passerelle: PasserelleInstances) {
  switch (section) {
    case 'overview':
      return passerelle.instanceOverview
    case 'databases':
      return passerelle.instanceDatabases
    case 'roles':
      return passerelle.instanceRoles
    case 'privileges':
      return passerelle.instancePrivileges
    case 'sessions':
      return passerelle.instanceSessions
    case 'extensions':
      return passerelle.instanceExtensions
    case 'settings':
      return passerelle.instanceSettings
  }
}

/**
 * Le compte accolé au libellé d'un segment.
 *
 * **Seulement ce qui a été lu.** Un zéro sur une section jamais ouverte dirait « cette instance n'a
 * aucun rôle », ce qui est faux et se lit comme une réponse. Le segment reste alors sans nombre.
 *
 * La vue d'ensemble n'en a jamais : elle ne compte rien, elle décrit.
 *
 * **Et « Utilisateurs » compte les utilisateurs, non les rôles** (9 septembre 2026) : depuis que la
 * section sépare ceux qui se connectent des rôles de groupe, un compte de quatre au-dessus d'un
 * tableau de deux lignes se lit comme un tableau amputé. Le nombre du segment doit être celui de ce
 * que le segment montre — les groupes ont le leur, sur la ligne qui les déplie.
 */
function compteDe(section: SectionInstance, lectures: Lectures): number | undefined {
  if (section === 'overview') return undefined
  const lecture = lectures[section]
  if (lecture?.phase !== 'prete') return undefined
  const donnees = lecture.donnees
  if (!Array.isArray(donnees)) return undefined
  if (section === 'roles') {
    return (donnees as InstanceRole[]).filter((role) => role.canLogin).length
  }
  return donnees.length
}

/**
 * L'action principale d'une section — ce que la barre propose à gauche.
 *
 * `null` pour les quatre sections qui n'ont rien à créer : la vue d'ensemble décrit, les privilèges
 * se donnent depuis la matrice, une session ne se crée pas, et un paramètre n'existe pas à ajouter —
 * il se règle sur sa ligne.
 */
function actionPrincipale(
  section: SectionInstance,
): { libelle: string; geste: Parameters<typeof permis>[1]; demande: Demande } | null {
  switch (section) {
    case 'databases':
      return { libelle: 'newDatabase', geste: 'createDatabase', demande: { kind: 'newDatabase' } }
    case 'roles':
      return { libelle: 'newRole', geste: 'createRole', demande: { kind: 'newRole' } }
    case 'extensions':
      return {
        libelle: 'newExtension',
        geste: 'createExtension',
        demande: { kind: 'installExtension' },
      }
    default:
      return null
  }
}

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}

/** Réexporté pour les sections : leur props communes en dépendent. */
export type { InstanceAction }
export { nomAffiche }
