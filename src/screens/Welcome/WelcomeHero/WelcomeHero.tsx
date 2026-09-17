import { Icon } from '../../../design/icons/Icon'
import { useT } from '../../../i18n/LanguageContext'
import { raccourci } from '../../../shell/plateforme'
import { Button } from '../../../ui/Button/Button'
import styles from './WelcomeHero.module.css'

type WelcomeHeroProps = {
  onNewProject: () => void
  /**
   * Ouvre l'import de projets (`API-30`, 17 septembre 2026, à la demande).
   *
   * **C'est ici que l'import manquait le plus**, et c'est ce qui a décidé de l'ajouter à deux
   * endroits plutôt qu'un : la bande de l'arbre n'existe pas sur cet écran — il n'y a pas d'arbre —,
   * donc quelqu'un qui installe DoraBase sur un second poste, ouvre l'application et cherche à
   * reprendre ses projets ne voyait **rien**. Recevoir un fichier est une façon de commencer, au
   * même titre que déclarer un projet ; l'écran des débuts doit donc les offrir tous les deux.
   *
   * **En bouton secondaire**, à côté de l'accent : les deux mènent quelque part, mais « Nouveau
   * projet » reste ce que la page propose — elle porte son raccourci, et le hiérarchie de couleur
   * dit lequel est le geste attendu. Deux accents côte à côte ne désigneraient plus rien.
   *
   * Absent, aucun second bouton n'est rendu — la galerie, qui monte cet écran sans application
   * autour de lui.
   */
  onImportProjects?: () => void
}

export function WelcomeHero({ onNewProject, onImportProjects }: WelcomeHeroProps) {
  const t = useT()
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <svg className={styles.logo} viewBox="0 0 512 512" aria-hidden="true">
          <use href="#logo" />
        </svg>
        {/* Espace insécable avant le point d'interrogation, porté par le dictionnaire lui-même. */}
        <h1 className={styles.title}>{t('welcome.hero.title')}</h1>
        <p className={styles.subtitle}>{t('welcome.hero.subtitle')}</p>
        <div className={styles.actions}>
          <Button variant="dark" size="xl" shortcut={raccourci('N')} onClick={onNewProject}>
            <Icon name="plus" size={15} strokeWidth={2.2} />
            {t('welcome.hero.newProject')}
          </Button>
          {onImportProjects && (
            <Button variant="secondary" size="xl" onClick={onImportProjects}>
              {/* Le glyphe de la modale d'import, comme dans la bande de l'arbre : un geste, un
                  dessin. */}
              <Icon name="save" size={15} strokeWidth={2.2} />
              {t('transfer.import.menu')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
