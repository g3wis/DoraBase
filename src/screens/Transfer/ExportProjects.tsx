import { useState } from 'react'
import type { ExportReport } from '../../domain/transfert'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './Transfer.module.css'
import { messageDe } from './transferCommands'

/** L'avancement de l'export, tel que la modale l'affiche. */
type Avancement =
  | { phase: 'choix' }
  | { phase: 'fini'; report: ExportReport; fichier: string }
  | { phase: 'echoue'; message: string }

type ExportProjectsProps = {
  /**
   * Le projet à exporter seul, ou `null` pour tous.
   *
   * **Le nom, pas un objet** : c'est l'identité, la même qui voyage vers la commande, et un projet
   * complet ici ferait croire que la modale lit son contenu — or les projets sont relus au disque
   * par le cœur, comme partout ailleurs.
   */
  projet: string | null
  /** Combien de projets la configuration porte, pour l'annonce d'un export complet. */
  total: number
  onClose: () => void
  /** Ouvre le sélecteur de destination **natif** et rend le chemin choisi, ou `null`. */
  onChoisirFichier: (projet: string | null) => Promise<string | null>
  onExporter: (fichier: string, avecLesMotsDePasse: boolean) => Promise<ExportReport>
}

/**
 * La modale d'export de projets (`API-30`).
 *
 * **Aucun pixel inventé** : le handoff ne maquette pas cet écran — c'est pourquoi le point d'entrée
 * est le menu natif et le menu d'une ligne de projet. La modale réemploie la primitive `Modal` et
 * les blocs des modales de dump.
 *
 * # L'interrupteur des mots de passe
 *
 * **Éteint par défaut, et son avertissement est à côté de lui, pas dans une confirmation.** Un
 * export ordinaire ne doit pas produire un fichier de secrets, et une modale de confirmation
 * arriverait *après* le choix — donc après le geste, là où l'avertissement doit être *avant*. Ce
 * qu'il dit est le seul fait qui compte : le fichier ne peut pas être « dé-partagé ».
 */
export function ExportProjects({
  projet,
  total,
  onClose,
  onChoisirFichier,
  onExporter,
}: ExportProjectsProps) {
  const t = useT()
  const [avecLesMotsDePasse, setAvecLesMotsDePasse] = useState(false)
  const [avancement, setAvancement] = useState<Avancement>({ phase: 'choix' })

  async function exporter() {
    const fichier = await onChoisirFichier(projet)
    // Annulation dans le sélecteur natif : rien à dire, la modale reste au choix.
    if (!fichier) return
    try {
      const report = await onExporter(fichier, avecLesMotsDePasse)
      setAvancement({ phase: 'fini', report, fichier })
    } catch (cause) {
      setAvancement({ phase: 'echoue', message: messageDe(cause) })
    }
  }

  const fini = avancement.phase === 'fini'

  return (
    <Modal
      title={t('transfer.export.title')}
      icon="dl"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            {t('transfer.close')}
          </Button>
          {!fini && <Button onClick={exporter}>{t('transfer.export.choose')}</Button>}
        </div>
      }
    >
      <div className={styles.body}>
        {/* La portée est **nommée**, comme la cible d'un dump : c'est la seule chose qui distingue
            l'export d'un projet de celui de toute la configuration. */}
        <p className={styles.portee}>
          {projet ?? t('transfer.export.allProjects', { count: total })}
        </p>
        <p className={styles.explication}>{t('transfer.export.what')}</p>

        {!fini && (
          <div className={styles.reglage}>
            <div className={styles.reglageLigne}>
              <Toggle
                checked={avecLesMotsDePasse}
                onCheckedChange={setAvecLesMotsDePasse}
                label={t('transfer.export.withPasswords')}
              />
              <span className={styles.reglageLibelle}>{t('transfer.export.withPasswords')}</span>
            </div>
            <p className={avecLesMotsDePasse ? styles.avertissement : styles.explication}>
              {avecLesMotsDePasse
                ? t('transfer.export.withPasswordsWarning')
                : t('transfer.export.withoutPasswords')}
            </p>
          </div>
        )}

        {fini && (
          <>
            <p className={styles.explication}>
              {t('transfer.export.done', {
                projects: avancement.report.projects,
                connections: avancement.report.connections,
                consoles: avancement.report.consoles,
              })}
            </p>
            {avancement.report.passwordsCarried > 0 && (
              <p className={styles.avertissement}>
                {t('transfer.export.carried', { count: avancement.report.passwordsCarried })}
              </p>
            )}
            {/* **Dit, jamais tu** : une connexion qui déclare un mot de passe que le Trousseau n'a
                pas laisse un fichier incomplet, et c'est à l'import qu'on le découvrirait sinon. */}
            {avancement.report.passwordsMissing.length > 0 && (
              <p className={styles.reserve}>
                {t('transfer.export.missing', {
                  count: avancement.report.passwordsMissing.length,
                  list: avancement.report.passwordsMissing.join(', '),
                })}
              </p>
            )}
            <p className={styles.chemin}>{avancement.fichier}</p>
          </>
        )}

        {avancement.phase === 'echoue' && <p className={styles.echec}>{avancement.message}</p>}
      </div>
    </Modal>
  )
}
