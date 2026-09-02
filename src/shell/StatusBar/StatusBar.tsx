import { appVersion } from '../../app/version'
import { useT } from '../../i18n/LanguageContext'
import styles from './StatusBar.module.css'

type StatusBarProps = {
  projectCount: number
}

export function StatusBar({ projectCount }: StatusBarProps) {
  const t = useT()
  return (
    <div className={styles.root}>
      <span>{t('shell.statusBar.projectCount', { count: projectCount })}</span>
      <span>·</span>
      <span>{t('shell.statusBar.paletteHint')}</span>
      <span className={styles.spacer} />
      {/* **Cette barre n'annonce plus les mises à jour** (2 septembre 2026) : elle disait qu'une
          version existait au seul écran d'accueil, donc précisément quand personne ne travaille, et
          le texte se lisait comme une invitation glissée sous le compte de projets. L'annonce est
          devenue une notification en bas à droite, montée au niveau de l'application — voir
          `shell/AnnonceMiseAJour`. Ce qui reste ici est ce que la barre a toujours dit : la version
          qui tourne. */}
      <span>{t('shell.statusBar.version', { version: appVersion })}</span>
    </div>
  )
}
