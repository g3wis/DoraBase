import { useState } from 'react'
import {
  type ArriveeDuDeplacement,
  arbreApresDeplacement,
  dossier,
  dossiers,
  type EffetSurLaLectureSeule,
  effetSurLaLectureSeule,
  libelleDeConnexion,
  luiEtSesDescendants,
  parentDu,
  type SujetDuDeplacement,
} from '../../data/dossiers'
import type { MoveResult } from '../../domain/arbre'
import type { FolderId, FolderTree } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { indentation, TreeRow } from '../../ui/TreeRow/TreeRow'
import { COULEURS_DE_DOSSIER } from '../NewConnection/environments'
import styles from './DeplacerVers.module.css'

type DeplacerVersProps = {
  arbre: FolderTree
  sujet: SujetDuDeplacement
  /** Le nom affiché du sujet, pour le titre et la phrase de lecture seule. */
  nom: string
  /**
   * L'arrivée **préremplie** par un glisser-déposer dont le cœur a posé une question (#167) : la
   * modale est alors la confirmation du dépôt. Absente, rien n'est choisi.
   */
  arrivee?: ArriveeDuDeplacement
  /** La question du cœur, pour l'arrivée préremplie. */
  question?: EffetSurLaLectureSeule | null
  /** Envoie le déplacement ; rejette avec le refus du cœur. */
  onDeplacer: (arrivee: ArriveeDuDeplacement, confirmed: boolean) => Promise<MoveResult>
  onClose: () => void
}

/** La destination choisie : un dossier, la racine (`null`), ou rien encore (`undefined`). */
type Choix = FolderId | null | undefined

/**
 * « Déplacer vers… » (#167) : le chemin **clavier** du déplacement, et la confirmation du chemin
 * souris.
 *
 * **Un seul chemin porte la règle de la lecture seule** (règle n° 17). Un dépôt qui la change ouvre
 * cette même modale, préremplie : c'est ici, et nulle part ailleurs, que l'écran dit ce qui change
 * avant de laisser déplacer. Le cœur, lui, exige le drapeau `confirmed` — et c'est la phrase affichée
 * qui le lève : on ne confirme que ce qu'on a lu.
 *
 * **Les lignes sont celles de l'arbre** (`TreeRow`), tous les dossiers dépliés, « Racine » en tête. Une
 * destination impossible reste listée, **désactivée avec sa raison** — `aria-disabled` et un `title`,
 * jamais `disabled`, qui rendrait la raison inatteignable (piège n° 3) : le dossier lui-même et ses
 * descendants, le parent actuel.
 */
export function DeplacerVers({
  arbre,
  sujet,
  nom,
  arrivee,
  question = null,
  onDeplacer,
  onClose,
}: DeplacerVersProps) {
  const t = useT()
  const [choix, setChoix] = useState<Choix>(arrivee?.destination)
  /** La question que le cœur a posée à l'envoi, quand l'aperçu n'avait rien vu (l'arbre a bougé). */
  const [questionDuCoeur, setQuestionDuCoeur] = useState<{
    destination: FolderId | null
    effet: EffetSurLaLectureSeule
  } | null>(
    arrivee !== undefined && question !== null
      ? { destination: arrivee.destination, effet: question }
      : null,
  )
  const [refus, setRefus] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const parent = parentDu(arbre, sujet)
  const interdits =
    sujet.kind === 'folder' ? luiEtSesDescendants(arbre, sujet.folder) : new Set<FolderId>()

  /** La raison pour laquelle une destination est impossible, ou `null`. */
  const raisonDe = (destination: FolderId | null): string | null => {
    if (destination !== null && interdits.has(destination)) return t('explorer.moveDialog.inItself')
    if (destination === parent) return t('explorer.moveDialog.alreadyHere')
    return null
  }

  /** L'arrivée pour ce choix : la place du dépôt s'il vise ce dossier, « en dernier » sinon. */
  const arriveeDe = (destination: FolderId | null): ArriveeDuDeplacement => ({
    destination,
    index: arrivee !== undefined && arrivee.destination === destination ? arrivee.index : null,
  })

  const effet: EffetSurLaLectureSeule | null = (() => {
    if (choix === undefined) return null
    if (questionDuCoeur !== null && questionDuCoeur.destination === choix) {
      return questionDuCoeur.effet
    }
    const apres = arbreApresDeplacement(arbre, sujet, arriveeDe(choix))
    return apres === null ? null : effetSurLaLectureSeule(arbre, apres)
  })()

  const choixPossible = choix !== undefined && raisonDe(choix) === null

  const deplacer = async () => {
    if (!choixPossible || choix === undefined) return
    setEnCours(true)
    setRefus(null)
    try {
      // **Confirmé si, et seulement si, la phrase est à l'écran** : c'est elle qu'on confirme.
      const issue = await onDeplacer(arriveeDe(choix), effet !== null)
      if (issue.kind === 'moved') {
        onClose()
        return
      }
      // L'arbre a bougé entre l'aperçu et l'envoi : la question du cœur prend la place de l'aperçu,
      // et un second clic la confirme.
      setQuestionDuCoeur({
        destination: choix,
        effet: {
          becomesReadOnly: issue.becomesReadOnly,
          leavesReadOnly: issue.leavesReadOnly,
          folders: issue.folders,
        },
      })
    } catch (erreur) {
      setRefus(String(erreur))
    } finally {
      setEnCours(false)
    }
  }

  const ligne = (destination: FolderId | null, props: Parameters<typeof TreeRow>[0]) => {
    const raison = raisonDe(destination)
    return (
      <TreeRow
        key={destination ?? ':racine'}
        {...props}
        selected={choix === destination}
        aria-pressed={choix === destination}
        aria-disabled={raison !== null || undefined}
        title={raison ?? undefined}
        onClick={() => {
          if (raison === null) setChoix(destination)
        }}
      />
    )
  }

  return (
    <Modal
      title={t('explorer.moveDialog.title', { nom })}
      icon="goto"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('explorer.moveDialog.cancel')}
          </Button>
          <Button
            variant="dark"
            size="md"
            onClick={() => void deplacer()}
            aria-disabled={!choixPossible || enCours || undefined}
            title={choix === undefined ? t('explorer.moveDialog.chooseFirst') : undefined}
          >
            {enCours ? t('explorer.moveDialog.moving') : t('explorer.moveDialog.move')}
          </Button>
        </>
      }
    >
      <div className={styles.corps}>
        <fieldset aria-label={t('explorer.moveDialog.destinations')} className={styles.liste}>
          {ligne(null, {
            depth: 0,
            label: t('explorer.moveDialog.root'),
            icon: 'bag',
            iconColor: 'var(--accent-deep)',
            strong: true,
          })}
          {dossiers(arbre).map(({ dossier: d, ancetres }) =>
            ligne(d.id, {
              depth: ancetres.length + 1,
              indent: indentation(ancetres.length + 1),
              label: d.name,
              icon: 'pin',
              iconColor: d.color ? COULEURS_DE_DOSSIER[d.color] : 'var(--accent-deep)',
            }),
          )}
        </fieldset>
        {effet !== null && (
          <p className={styles.lectureSeule} role="status">
            {phraseDeLEffet(t, arbre, effet)}
          </p>
        )}
        {refus !== null && (
          <p className={styles.refus} role="alert">
            {refus}
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * La phrase qui dit ce que le déplacement fait à la lecture seule — « « analytics » passera en lecture
 * seule, imposée par « prod » », ou « quittera la lecture seule imposée par « prod » ».
 *
 * **Les connexions sont nommées**, et c'est ce que le cœur a demandé en les rendant une à une : un
 * compte dirait qu'il se passe quelque chose, une liste dit à quoi.
 */
function phraseDeLEffet(
  t: ReturnType<typeof useT>,
  arbre: FolderTree,
  effet: EffetSurLaLectureSeule,
): string {
  const noms = (ids: readonly string[]) =>
    ids.map((id) => `« ${libelleDeConnexion(arbre, id) ?? id} »`).join(', ')
  const dossiersNommes = effet.folders
    .map((id) => `« ${dossier(arbre, id)?.dossier.name ?? id} »`)
    .join(', ')
  const phrases: string[] = []
  if (effet.becomesReadOnly.length > 0) {
    phrases.push(
      t('explorer.moveDialog.becomesReadOnly', {
        connexions: noms(effet.becomesReadOnly),
        count: effet.becomesReadOnly.length,
        dossiers: dossiersNommes,
      }),
    )
  }
  if (effet.leavesReadOnly.length > 0) {
    phrases.push(
      t('explorer.moveDialog.leavesReadOnly', {
        connexions: noms(effet.leavesReadOnly),
        count: effet.leavesReadOnly.length,
        dossiers: dossiersNommes,
      }),
    )
  }
  return phrases.join(' ')
}
