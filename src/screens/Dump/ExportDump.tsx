import { useState } from 'react'
import type { DumpAvailability, DumpTransport } from '../../domain/dump'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { Button } from '../../ui/Button/Button'
import { formatBytes } from '../../ui/format'
import { Modal } from '../../ui/Modal/Modal'
import type { CibleDeDump } from './cible'
import styles from './Dump.module.css'
import { explicationDuVerdict, phraseDuTransport, titreDuVerdict } from './verdict'

/** L'avancement de l'export, tel que la modale l'affiche. */
type Avancement =
  | { phase: 'choix' }
  | { phase: 'en-cours'; octets: number }
  | { phase: 'fini'; octets: number; fichier: string }
  | { phase: 'echoue'; message: string }

type ExportDumpProps = {
  /** Le verdict, ou `null` tant qu'il est en cours de calcul. */
  availability: DumpAvailability | null
  /**
   * Le transport **réellement employé** par l'outil, tel que le cœur l'a calculé (#82) — `null`
   * tant qu'il n'est pas connu, ou quand le moteur n'a rien à lancer.
   */
  transport?: DumpTransport | null
  cible: CibleDeDump
  onClose: () => void
  /**
   * Ouvre le sélecteur de destination **natif** et rend le chemin choisi, ou `null`.
   *
   * Injecté comme `onBrowseKey` de `A2` : le plugin `dialog` ne répond pas hors de la
   * webview de Tauri, donc sous Vitest l'appel réel rejetterait.
   */
  onChoisirFichier: () => Promise<string | null>
  /** Lance `start_export` et rend le nombre d'octets écrits. */
  onExporter: (fichier: string) => Promise<number>
  /** Demande l'annulation (`cancel_export`). */
  onAnnuler: () => void
  /** Progression en octets, poussée par l'événement `dump://progression`. */
  octetsEcrits?: number
}

/**
 * La modale d'export d'un dump.
 *
 * **Aucun pixel inventé** : le handoff ne maquette pas cet écran — c'est pourquoi `22a` a
 * placé le point d'entrée dans le menu natif. La modale réutilise la primitive `Modal` de
 * `08a` et les blocs de `A2`.
 *
 * **La progression est un nombre d'octets, jamais un pourcentage.**
 * `pg_dump --format=plain` n'émet aucune progression et la taille finale est
 * inconnaissable avant la fin : un pourcentage présenterait une estimation comme un fait.
 */
export function ExportDump({
  availability,
  transport = null,
  cible,
  onClose,
  onChoisirFichier,
  onExporter,
  onAnnuler,
  octetsEcrits,
}: ExportDumpProps) {
  const t = useT()
  const [avancement, setAvancement] = useState<Avancement>({ phase: 'choix' })

  // Le verdict n'est pas encore là : le titre le dit plutôt que d'annoncer « Exporter »
  // pour se corriger une seconde plus tard.
  const titre = availability ? titreDuVerdict(availability, 'export', t) : t('dump.checking.export')
  const pret = availability?.kind === 'ready'

  async function exporter() {
    const fichier = await onChoisirFichier()
    // Annulation dans le sélecteur natif : rien à dire, la modale reste au choix.
    if (!fichier) return

    setAvancement({ phase: 'en-cours', octets: 0 })
    try {
      const octets = await onExporter(fichier)
      setAvancement({ phase: 'fini', octets, fichier })
    } catch (cause) {
      setAvancement({ phase: 'echoue', message: messageDe(cause) })
    }
  }

  const enCours = avancement.phase === 'en-cours'
  const octets = enCours ? (octetsEcrits ?? avancement.octets) : 0

  return (
    <Modal
      title={titre}
      icon="dl"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          {enCours ? (
            <Button variant="secondary" onClick={onAnnuler}>
              {t('dump.export.cancel')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t('dump.export.close')}
              </Button>
              {pret && avancement.phase !== 'fini' && (
                <Button onClick={exporter} shortcut={raccourci('E', { maj: true })}>
                  {t('dump.export.choose')}
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      <div className={styles.body}>
        {/* La cible est **nommée** dans l'export comme dans l'import : c'est la seule
            chose qui distingue un dump de staging d'un dump de prod. */}
        <p className={styles.cible}>
          {cible.chemin !== '' && (
            <>
              {cible.chemin} <span aria-hidden="true">·</span>{' '}
            </>
          )}
          {cible.base}
        </p>

        {availability && (
          <p className={styles.explication}>{explicationDuVerdict(availability, 'export', t)}</p>
        )}
        {/* Le transport est dit avant qu'on s'engage (#82) : un dump parti en clair ne se
            voyait nulle part. Seulement quand l'outil est prêt — sans lui, rien ne partira. */}
        {pret && transport && (
          <p className={styles.explication}>{phraseDuTransport(transport, t)}</p>
        )}

        {enCours && (
          // Des octets, sans total ni pourcentage. Voir la note de tête.
          <p className={styles.progression}>
            {t('dump.export.written', { bytes: formatBytes(octets) })}
          </p>
        )}
        {avancement.phase === 'fini' && (
          <p className={styles.progression}>
            {t('dump.export.done', {
              bytes: formatBytes(avancement.octets),
              file: avancement.fichier,
            })}
          </p>
        )}
        {avancement.phase === 'echoue' && <p className={styles.echec}>{avancement.message}</p>}
      </div>
    </Modal>
  )
}

/**
 * Le message d'une erreur remontée par l'IPC.
 *
 * Tauri sérialise un `Err(DumpFailure)` en l'objet lui-même, mais une panique de commande
 * ou un pont cassé rendent une **chaîne** — et un `catch` qui suppose la forme structurée
 * afficherait « undefined » là où la cause était lisible. Même piège que `08d`.
 */
export function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
