import { useState } from 'react'
import type { DumpAvailability, Inspection } from '../../domain/dump'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import type { CibleDeDump } from './cible'
import styles from './Dump.module.css'
import { messageDe } from './ExportDump'
import { explicationDuVerdict, titreDuVerdict, versionLisible } from './verdict'

/**
 * Le titre — donc le **nom accessible** — pour chaque issue d'inspection.
 *
 * Un message par issue, parce que les remèdes n'ont rien à voir : un fichier incomplet se
 * réexporte, un dump trop récent demande une mise à jour du serveur cible, un fichier
 * étranger s'importe quand même, et un fichier vide n'est probablement pas celui qu'on
 * croyait choisir.
 */
export function titreDeLInspection(
  inspection: Inspection,
  t: (cle: string, parametres?: Record<string, string | number>) => string,
): string {
  switch (inspection.kind) {
    case 'pgDump':
      return t('dump.import.inspection.pgDumpTitle')
    case 'tronque':
      return t('dump.import.inspection.truncatedTitle')
    case 'tropRecent':
      return t('dump.import.inspection.tooRecentTitle')
    case 'etranger':
      return t('dump.import.inspection.foreignTitle')
    case 'vide':
      return t('dump.import.inspection.emptyTitle')
    case 'illisible':
      return t('dump.import.inspection.unreadableTitle')
  }
}

/** Ce que la modale explique sous le titre. */
function explicationDeLInspection(
  inspection: Inspection,
  t: (cle: string, parametres?: Record<string, string | number>) => string,
): string {
  switch (inspection.kind) {
    case 'pgDump':
      return t('dump.import.inspection.pgDump', { origin: versionLisible(inspection.origine) })
    case 'tronque':
      // Le défaut mesuré, dit en clair dans le dictionnaire : c'est ce qui justifie de
      // refuser avant psql, et l'utilisateur a le droit de savoir pourquoi on refuse.
      return t('dump.import.inspection.truncated')
    case 'tropRecent':
      return t('dump.import.inspection.tooRecent', {
        origin: versionLisible(inspection.origine),
        target: versionLisible(inspection.cible),
      })
    case 'etranger':
      return t('dump.import.inspection.foreign')
    case 'vide':
      return t('dump.import.inspection.empty')
    case 'illisible':
      return t('dump.import.inspection.unreadable', { cause: inspection.cause })
  }
}

/** Une issue d'inspection qui laisse l'import possible. `etranger` en fait partie. */
function importable(inspection: Inspection): boolean {
  return inspection.kind === 'pgDump' || inspection.kind === 'etranger'
}

type Etat =
  | { phase: 'choix' }
  | { phase: 'en-cours' }
  | { phase: 'fini' }
  | { phase: 'echoue'; message: string }

type ImportDumpProps = {
  availability: DumpAvailability | null
  /** Le résultat d'`inspect_dump`, ou `null` tant qu'aucun fichier n'est choisi. */
  inspection?: Inspection | null
  cible: CibleDeDump
  /** Le chemin du fichier choisi. La modale le **nomme** : c'est la moitié du garde-fou. */
  fichier?: string
  onClose: () => void
  onChoisirFichier: () => Promise<string | null>
  onImporter: (fichier: string) => Promise<void>
}

/**
 * La modale de confirmation d'un import.
 *
 * **Le garde-fou, c'est la modale qui nomme la cible.** Pas une case à cocher, pas un
 * compte à rebours, pas un nom à recopier : l'erreur que cela empêche est de se tromper de
 * cible, pas de se tromper d'intention — et nommer projet, base, environnement et chemin
 * est ce qui l'empêche réellement.
 *
 * `readOnly` ne se voit pas ici : il est refusé côté Rust **avant** toute autre étape, donc
 * la modale n'a même pas la question à poser.
 */
export function ImportDump({
  availability,
  inspection = null,
  cible,
  fichier,
  onClose,
  onChoisirFichier,
  onImporter,
}: ImportDumpProps) {
  const t = useT()
  const [etat, setEtat] = useState<Etat>({ phase: 'choix' })

  // L'inspection décide du titre dès qu'un fichier est choisi ; avant, c'est le verdict de
  // disponibilité de l'outil — et il n'y a rien à confirmer sans `psql`.
  const titre = inspection
    ? titreDeLInspection(inspection, t)
    : availability
      ? titreDuVerdict(availability, 'import', t)
      : t('dump.checking.import')

  const pret = availability?.kind === 'ready'
  const confirmable = pret && inspection !== null && importable(inspection) && Boolean(fichier)

  async function choisir() {
    await onChoisirFichier()
  }

  async function importer() {
    if (!fichier) return
    setEtat({ phase: 'en-cours' })
    try {
      await onImporter(fichier)
      setEtat({ phase: 'fini' })
    } catch (cause) {
      setEtat({ phase: 'echoue', message: messageDe(cause) })
    }
  }

  return (
    <Modal
      title={titre}
      /* **`ul`, pas `save`** (17 septembre 2026) : une disquette dit « enregistrer ». C'est d'ici
         que l'import de projets avait repris le glyphe, donc c'est ici aussi qu'il fallait le
         corriger — un geste ne se dessine pas de deux façons dans un même produit, et « importer »
         ne s'en dessine plus d'une fausse. Il fait couple avec le `dl` d'`ExportDump`. */
      icon="ul"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            {t('dump.import.close')}
          </Button>
          {pret && etat.phase === 'choix' && (
            <Button variant="secondary" onClick={choisir} shortcut={raccourci('I', { maj: true })}>
              {t('dump.import.choose')}
            </Button>
          )}
          {confirmable && etat.phase === 'choix' && (
            // Le libellé nomme la base : un bouton « Confirmer » ne dirait pas sur quoi.
            <Button onClick={importer}>{t('dump.import.confirm', { database: cible.base })}</Button>
          )}
        </div>
      }
    >
      <div className={styles.body}>
        {/* L'erreur que la modale empêche est de se tromper de cible. */}
        <p className={styles.cible}>
          {cible.projet} <span aria-hidden="true">·</span> {cible.base}{' '}
          <span aria-hidden="true">·</span> {cible.environnement}
        </p>
        {fichier && <p className={styles.chemin}>{fichier}</p>}

        {inspection ? (
          <p className={styles.explication}>{explicationDeLInspection(inspection, t)}</p>
        ) : (
          availability && (
            <p className={styles.explication}>{explicationDuVerdict(availability, 'import', t)}</p>
          )
        )}

        {etat.phase === 'en-cours' && (
          // Aucune progression n'est disponible : `psql` n'en émet pas, et en inventer une
          // serait présenter une estimation comme un fait.
          <p className={styles.progression}>{t('dump.import.running')}</p>
        )}
        {etat.phase === 'fini' && <p className={styles.progression}>{t('dump.import.done')}</p>}
        {etat.phase === 'echoue' && <p className={styles.echec}>{etat.message}</p>}
      </div>
    </Modal>
  )
}
