import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { SchemaInfo } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { modificateurActif, raccourci } from '../../shell/plateforme'
import { Button } from '../../ui/Button/Button'
import type { Column } from '../../ui/DataTable/DataTable'
import { DataTable } from '../../ui/DataTable/DataTable'
import { Field } from '../../ui/Field/Field'
import { Modal } from '../../ui/Modal/Modal'
import { SidebarFilterBar } from '../../ui/SidebarFilterBar/SidebarFilterBar'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './SchemaManager.module.css'

/** Le cadre de la modale : ce que la bande d'en-tête annonce, et ce que le pied nomme. */
export type CibleDeSchemas = {
  projet: string
  /** Le **libellé** de l'environnement, pas son identifiant : c'est ce qui s'affiche. */
  environnement: string
  /** Le libellé de la connexion, tel que l'arbre le montre. */
  base: string
}

type SchemaManagerProps = {
  cible: CibleDeSchemas
  /**
   * Les schémas affichés **tels qu'ils sont enregistrés**, ou `null` : jamais réglé.
   *
   * `null` coche tous les non-système — ce que l'arbre montre déjà —, et non `public` seul : la
   * seconde option viderait l'arbre des bases où `public` est justement le schéma vide, et
   * changerait le comportement de toutes les connexions déjà déclarées.
   */
  affiches: readonly string[] | null
  /**
   * L'environnement est-il marqué production ? Le drapeau, **jamais le libellé** (`23g`).
   *
   * Il n'ajoute pas de confirmation : il ajoute un rappel dans la bande de création, la seule part
   * de cet écran qui écrive sur la base.
   */
  production?: boolean
  onClose: () => void
  /** Lit les schémas de la connexion — `list_schemas`, catalogue compris et marqué. */
  onLire: () => Promise<SchemaInfo[]>
  /** Exécute `create schema`. Rejette avec ce que le moteur a dit. */
  onCreer: (nom: string) => Promise<void>
  /** Enregistre la préférence. Rejette avec le refus du cœur. */
  onEnregistrer: (schemas: readonly string[]) => Promise<void>
}

/** Ce que la lecture des schémas a rendu. */
type Lecture =
  | { phase: 'chargement' }
  | { phase: 'prete'; schemas: readonly SchemaInfo[] }
  | { phase: 'echouee'; message: string }

/**
 * Le gestionnaire de schémas d'une connexion (`API-33`). **PostgreSQL seulement.**
 *
 * # Les deux temps, et c'est la décision à retenir
 *
 * **Les cases sont différées, la création est immédiate.** Les schémas affichés sont une
 * préférence : elle vit dans le registre, à côté de la connexion, et attend « Enregistrer » comme
 * tout formulaire de connexion. `create schema`, lui, s'exécute **sur la base** et DoraBase ne peut
 * pas le défaire — le mettre derrière le même bouton ferait qu'« Annuler » ne défasse qu'une moitié
 * de ce qu'on a fait. Il a donc son propre bouton, dans un bloc séparé, et le schéma créé arrive
 * coché.
 *
 * # Les schémas système sont listés, repliés
 *
 * Ils existent, donc ils ne sont pas masqués — masquer est le bon choix pour ce qu'un moteur n'a
 * réellement pas. Et rien n'interdit de les afficher : l'interrupteur y fonctionne comme ailleurs,
 * parce que la lecture les rend et que `schemasAffiches` obéit à la préférence sans les traiter à
 * part. Un interrupteur qui n'aurait pas eu d'effet aurait été pire que son absence.
 *
 * # Ce que la modale ne nomme pas
 *
 * Le triplet `projet · environnement · connexion` s'annonce **dans la bande d'en-tête**, par le prop
 * `contexte` : c'est le cadre de cet écran, pas un de ses champs — la leçon du projet dans `A2`.
 */
export function SchemaManager({
  cible,
  affiches,
  production = false,
  onClose,
  onLire,
  onCreer,
  onEnregistrer,
}: SchemaManagerProps) {
  const t = useT()
  const [lecture, setLecture] = useState<Lecture>({ phase: 'chargement' })
  /**
   * Les schémas cochés, **par nom**.
   *
   * `null` tant que la lecture n'a pas répondu : la préférence seule ne suffit pas à composer cet
   * état quand elle est absente — il faut savoir quels schémas ne sont pas du catalogue.
   */
  const [coches, setCoches] = useState<ReadonlySet<string> | null>(null)
  const [filtre, setFiltre] = useState('')
  const [systemeDeplie, setSystemeDeplie] = useState(false)
  const [nouveau, setNouveau] = useState('')
  const [creation, setCreation] = useState<{ enCours: boolean; erreur?: string; fait?: string }>({
    enCours: false,
  })
  const [enregistrement, setEnregistrement] = useState<{ enCours: boolean; erreur?: string }>({
    enCours: false,
  })

  /**
   * Lit — ou relit — les schémas.
   *
   * **Les cases sont recomposées à chaque lecture**, et c'est ce qui fait arriver un schéma créé
   * déjà coché : `aCocher` reçoit alors la sélection courante augmentée de son nom. Repartir de la
   * préférence enregistrée aurait défait les cases touchées depuis l'ouverture.
   */
  const lire = useCallback(
    async (aCocher?: ReadonlySet<string>) => {
      setLecture({ phase: 'chargement' })
      try {
        const schemas = await onLire()
        setLecture({ phase: 'prete', schemas })
        setCoches(
          aCocher ??
            new Set(
              affiches ?? schemas.filter((schema) => !schema.system).map((schema) => schema.name),
            ),
        )
      } catch (cause) {
        setLecture({ phase: 'echouee', message: messageDe(cause) })
      }
    },
    [onLire, affiches],
  )

  // La lecture est faite **une fois**, à l'ouverture : la relancer à chaque changement de `lire` —
  // donc de la préférence, qui remonte par `projects` après un enregistrement — rechargerait la
  // modale sous les doigts de qui vient d'enregistrer, et rendrait les cases à leur état d'avant.
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    void lire()
  }, [])

  const schemas = lecture.phase === 'prete' ? lecture.schemas : []
  const terme = filtre.trim().toLowerCase()
  const correspond = useCallback(
    (schema: SchemaInfo) => terme === '' || schema.name.toLowerCase().includes(terme),
    [terme],
  )

  const ordinaires = useMemo(
    () => schemas.filter((schema) => !schema.system && correspond(schema)),
    [schemas, correspond],
  )
  const systeme = useMemo(
    () => schemas.filter((schema) => schema.system && correspond(schema)),
    [schemas, correspond],
  )

  const cochesEffectives = coches ?? new Set<string>()
  const affichesCount = schemas.filter((schema) => cochesEffectives.has(schema.name)).length

  function basculer(nom: string, coche: boolean) {
    setCoches((precedent) => {
      const suivant = new Set(precedent ?? [])
      if (coche) suivant.add(nom)
      else suivant.delete(nom)
      return suivant
    })
  }

  /**
   * Enregistre, dans l'ordre du **catalogue** et non celui des clics.
   *
   * Un `Set` retient son ordre d'insertion : enregistrer `[...coches]` aurait écrit une liste dont
   * l'ordre dépend de la suite des cases cochées, donc une préférence différente pour un même
   * choix. Rien n'en dépend à l'affichage — l'arbre trie —, mais une valeur persistée qui varie
   * sans que rien n'ait changé se compare mal d'une version à l'autre.
   */
  const enregistrer = useCallback(async () => {
    if (coches === null || enregistrement.enCours) return
    setEnregistrement({ enCours: true })
    try {
      await onEnregistrer(schemas.filter((schema) => coches.has(schema.name)).map((s) => s.name))
      onClose()
    } catch (cause) {
      setEnregistrement({ enCours: false, erreur: messageDe(cause) })
    }
  }, [coches, enregistrement.enCours, onEnregistrer, onClose, schemas])

  // `⌘↩`, tel que le pied l'affiche. Inopérant tant que la lecture n'a pas répondu : un raccourci
  // qui contourne l'état d'un bouton est un piège (`A2`).
  useEffect(() => {
    function auClavier(evenement: KeyboardEvent) {
      if (modificateurActif(evenement) && evenement.key === 'Enter') {
        evenement.preventDefault()
        void enregistrer()
      }
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [enregistrer])

  async function creer() {
    const nom = nouveau.trim()
    if (nom === '' || creation.enCours) return
    setCreation({ enCours: true })
    try {
      await onCreer(nom)
      setNouveau('')
      setCreation({ enCours: false, fait: nom })
      // **Relu, et non ajouté à la main** : le schéma créé porte des compteurs et un propriétaire
      // que seul le catalogue connaît, et les inventer à zéro afficherait une ligne fausse le temps
      // d'une session.
      await lire(new Set([...cochesEffectives, nom]))
    } catch (cause) {
      setCreation({ enCours: false, erreur: messageDe(cause) })
    }
  }

  const colonnes: readonly Column<SchemaInfo>[] = [
    {
      key: 'name',
      header: t('schemas.columns.name'),
      // La colonne du nom est l'exception Nunito de `DataTable` — voir son prop `ui`.
      ui: true,
      width: '250px',
      cell: (schema) => schema.name,
    },
    {
      key: 'objects',
      header: t('schemas.columns.objects'),
      numeric: true,
      width: '90px',
      cell: (schema) => (
        // Le total, et le détail des quatre compteurs en infobulle : quatre nombres dans une
        // colonne de 90 px seraient illisibles, et le total est ce qui dit si un schéma est vide.
        <span title={t('schemas.objectsBreakdown', { ...schema.counts })}>{total(schema)}</span>
      ),
    },
    {
      key: 'owner',
      header: t('schemas.columns.owner'),
      width: '160px',
      cell: (schema) =>
        schema.owner ?? (
          /* Un tiret **avec sa raison en infobulle**, pas une cellule vide : celle-ci se lirait
             comme une lecture manquée. Et un `title`, non un `aria-label` : celui-ci est ignoré sur
             un élément sans rôle (piège n° 2), et le tiret est ici la donnée — une phrase répétée
             dans le nom de chaque cellule vide serait du bruit à la voix. Le cas ne se présente
             d'ailleurs que si PostgreSQL cesse de nommer un propriétaire. */
          <span title={t('schemas.noOwner')}>—</span>
        ),
    },
    {
      key: 'shown',
      header: t('schemas.columns.shown'),
      width: '90px',
      cell: (schema) => (
        <Toggle
          checked={cochesEffectives.has(schema.name)}
          onCheckedChange={(coche) => basculer(schema.name, coche)}
          // Le nom du schéma **dans** le nom du contrôle : sans lui, chaque ligne porterait un
          // interrupteur nommé « affiché », indiscernable de ses voisins à la voix.
          label={t('schemas.show', { schema: schema.name })}
        />
      ),
    },
  ]

  return (
    <Modal
      title={t('schemas.title')}
      icon="schema"
      onClose={onClose}
      contexte={
        <span className={styles.contexte}>
          {cible.projet} <span aria-hidden="true">·</span> {cible.environnement}{' '}
          <span aria-hidden="true">·</span> {cible.base}
        </span>
      }
      footer={
        <div className={styles.pied}>
          {/* Le pied **dit l'état**, il ne propose pas d'action : c'est le compte que l'arbre
              montrera, et il change à chaque case cochée. */}
          <span className={styles.compte}>
            {t('schemas.footer.count', {
              shown: affichesCount,
              total: schemas.length,
              database: cible.base,
            })}
          </span>
          <span className={styles.espace} />
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('schemas.footer.cancel')}
          </Button>
          <Button
            size="lg"
            shortcut={raccourci('↩')}
            disabled={coches === null || enregistrement.enCours}
            onClick={() => void enregistrer()}
          >
            <Icon name="save" size={14} strokeWidth={2.2} />
            {t('schemas.footer.save')}
          </Button>
          {enregistrement.erreur !== undefined && (
            <span className={styles.echec}>{enregistrement.erreur}</span>
          )}
        </div>
      }
    >
      <div className={styles.filtre}>
        <SidebarFilterBar
          value={filtre}
          onChange={setFiltre}
          placeholder={t('schemas.filterPlaceholder')}
          matchCount={ordinaires.length + systeme.length}
          totalCount={schemas.length}
        />
      </div>

      <div className={styles.corps}>
        {lecture.phase === 'chargement' && <p className={styles.message}>{t('schemas.loading')}</p>}
        {lecture.phase === 'echouee' && <p className={styles.echec}>{lecture.message}</p>}

        {lecture.phase === 'prete' && (
          <>
            <DataTable
              label={t('schemas.table')}
              columns={colonnes}
              rows={ordinaires}
              rowId={(schema) => schema.name}
              empty={
                <span className={styles.message}>
                  {terme === '' ? t('schemas.empty') : t('schemas.noMatch')}
                </span>
              }
            />

            {systeme.length > 0 && (
              <>
                {/* **Une section repliée, non une ligne de tableau.** Un bouton hors du tableau
                    garde les deux listes en vrais `<table>`, chacune avec son nom accessible et ses
                    en-têtes de colonne — ce qu'une ligne `colspan` portant un bouton aurait
                    perdu. */}
                <button
                  type="button"
                  className={styles.section}
                  aria-expanded={systemeDeplie}
                  onClick={() => setSystemeDeplie((precedent) => !precedent)}
                >
                  <Icon name={systemeDeplie ? 'chevd' : 'chevr'} size={12} strokeWidth={2.4} />
                  {t('schemas.system', { count: systeme.length })}
                </button>
                {systemeDeplie && (
                  <DataTable
                    label={t('schemas.systemTable')}
                    columns={colonnes}
                    rows={systeme}
                    rowId={(schema) => schema.name}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className={styles.creation}>
        {production && (
          // Sur un environnement marqué production seulement : ailleurs, la phrase se lirait comme
          // une mise en garde permanente, et une mise en garde permanente ne se lit plus.
          <p className={styles.rappel}>{t('schemas.create.warning')}</p>
        )}
        <div className={styles.rangeeDeCreation}>
          <Field
            label={t('schemas.create.label')}
            mono
            value={nouveau}
            placeholder={t('schemas.create.placeholder')}
            onChange={(evenement) => {
              setNouveau(evenement.target.value)
              // Le message de la création précédente s'effface dès qu'on écrit le nom suivant : le
              // garder ferait annoncer un schéma créé pendant qu'on en nomme un autre.
              setCreation({ enCours: false })
            }}
            onKeyDown={(evenement) => {
              // `Entrée` dans le champ crée, comme le bouton : c'est le geste qu'on fait après avoir
              // tapé un nom, et l'exiger à la souris seule serait un chemin unique.
              if (evenement.key === 'Enter') void creer()
            }}
          />
          <Button
            size="lg"
            variant="secondary"
            disabled={nouveau.trim() === '' || creation.enCours}
            onClick={() => void creer()}
          >
            {t('schemas.create.button')}
          </Button>
        </div>
        {creation.fait !== undefined && (
          <p className={styles.fait}>{t('schemas.create.done', { name: creation.fait })}</p>
        )}
        {creation.erreur !== undefined && <p className={styles.echec}>{creation.erreur}</p>}
      </div>
    </Modal>
  )
}

/** Les quatre compteurs en un nombre — ce que la colonne « objets » montre. */
function total(schema: SchemaInfo): number {
  const { tables, views, functions, indexes } = schema.counts
  return tables + views + functions + indexes
}

/**
 * Le message d'une erreur remontée par l'IPC.
 *
 * Tauri sérialise un `Err(EngineError)` en objet, mais une panique de commande ou un pont cassé
 * rendent une **chaîne** — et un `catch` qui suppose la forme structurée afficherait « undefined »
 * là où la cause était lisible. Même piège que `08d` et que `22c`.
 */
export function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
