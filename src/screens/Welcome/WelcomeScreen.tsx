import { StatusBar } from '../../shell/StatusBar/StatusBar'
import { TitleBar } from '../../shell/TitleBar/TitleBar'
import { ProjectSidebar } from './ProjectSidebar/ProjectSidebar'
import { WelcomeHero } from './WelcomeHero/WelcomeHero'
import styles from './WelcomeScreen.module.css'

type WelcomeScreenProps = {
  onNewProject: () => void
  /**
   * Ouvre les préférences (26 août 2026).
   *
   * **Il manquait, et l'engrenage de `A1` ne faisait rien.** La modale est montée au niveau de
   * l'application précisément pour être atteignable ici — un commentaire de `App` l'affirmait déjà —
   * mais la propriété n'était pas passée : le bouton retombait sur le `disabled` de `TitleBar`, avec
   * une infobulle qui renvoyait vers l'écran de travail, lequel n'existe pas tant qu'aucun projet
   * n'est déclaré. Le premier écran du produit avait donc un réglage inatteignable, et le clic
   * n'engendrait aucune action.
   */
  onOpenPreferences: () => void
  /** Ouvre l'import de projets (`API-30`) — voir `WelcomeHero`, qui porte la raison. */
  onImportProjects?: () => void
  projectCount: number
  /** Vrai quand une modale bloque la fenêtre : la barre de titre se ternit (`08b`). */
  dimmed?: boolean
}

/**
 * `A1`, l'écran des débuts.
 *
 * **`⌘N` n'est plus monté ici** (`24d`) : il vivait dans cet écran, donc il ne répondait que sur `A1`.
 * `useRaccourcisDeCreation` le tient une fois pour l'application entière — et lui seul depuis que
 * `⇧⌘N` a été retiré (26 août 2026).
 */
export function WelcomeScreen({
  onNewProject,
  onOpenPreferences,
  onImportProjects,
  projectCount,
  dimmed = false,
}: WelcomeScreenProps) {
  return (
    <div className={styles.root}>
      <TitleBar dimmed={dimmed} onOpenPreferences={onOpenPreferences} />
      <div className={styles.body}>
        <ProjectSidebar onNewProject={onNewProject} />
        <WelcomeHero onNewProject={onNewProject} onImportProjects={onImportProjects} />
      </div>
      <StatusBar projectCount={projectCount} />
    </div>
  )
}
