import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ICONE_PAR_DEFAUT, ICONES_DE_DOSSIER } from '../../data/iconesDeDossier'
import type { IconName } from '../../design/icons/names'
import type { FolderColor } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { GrilleDIcones } from './GrilleDIcones'
import { Nuancier } from './Nuancier'
import styles from './PanneauDApparence.module.css'

type PanneauDApparenceProps = {
  /** Le nom du dossier ou de la connexion, pour nommer le panneau et ses deux groupes. */
  nom: string
  couleur: FolderColor | null
  /** L'icône **enregistrée**, telle que le fichier la porte — un nom inconnu compris. */
  icone: string | null
  /** L'icône de la ligne, sous laquelle le panneau s'ouvre et à laquelle il rend le focus. */
  ancre: RefObject<HTMLElement | null>
  /** Applique la couleur ; rejette avec le refus du cœur. */
  onRecolorer: (couleur: FolderColor | null) => Promise<void>
  /** Applique l'icône ; `null` la rend à celle par défaut. Rejette avec le refus du cœur. */
  onChangerDIcone: (icone: IconName | null) => Promise<void>
  onFermer: () => void
  /**
   * Les icônes offertes, **celle par défaut en tête** — celles d'un dossier à défaut, `pin` en tête.
   * Une connexion passe les siennes, le logo de son moteur en tête (#179). La première est celle
   * qu'un nom inconnu dessine, et la choisir écrit `null`.
   */
  icones?: readonly IconName[]
  /** Les noms d'icônes propres à cet objet — le logo d'un moteur (voir `GrilleDIcones`). */
  nomsDIcones?: Partial<Record<IconName, string>>
  /** L'anneau de « Aucune », la teinte d'une ligne sans couleur (voir `Nuancier`). */
  teinteAucune?: string
}

/** L'écart entre l'icône et le panneau — celui de `Popover`, `--space-1`. */
const ECART = 3
/** Marge minimale au bord de la fenêtre, celle de `MenuContextuel`. */
const MARGE = 8

/**
 * La couleur et l'icône d'un dossier (#171) — et d'une connexion depuis #179, avec ses propres
 * icônes —, **dans un petit panneau ancré sous l'icône** de la
 * ligne — et non plus dans une modale (rapporté à l'usage le 30 septembre 2026 : « pas de grosse
 * fenêtre, juste une petite modale sous l'icône lorsqu'on clique dessus »). Une modale de 780 px pour
 * deux rangées de choix cachait l'arbre même dont on réglait une ligne : on choisissait une icône sans
 * la voir sur sa ligne.
 *
 * **Une seule mécanique pour les deux chemins** (règle n° 17) : le clic sur l'icône et l'entrée
 * « Couleur et icône… » du menu ouvrent ce même panneau, sous la même icône. Le menu reste le chemin
 * clavier.
 *
 * **`position: fixed`, la géométrie posée ici** : l'arbre défile dans une zone en `overflow: auto`,
 * qui rognerait un panneau ancré dans le flux sans qu'aucune assertion de visibilité s'en aperçoive —
 * le défaut n° 35, et la réponse de `ListeDeroulante` et `MenuContextuel`. Le panneau est pourtant
 * **rendu à côté de l'icône**, pas en fin de document, pour que `Tab` en ressorte dans l'ordre de
 * l'arbre (l'argument de `Popover` contre le portail). Et il **suit** l'icône quand l'arbre
 * défile, au lieu de se fermer comme le menu au pointeur : on y travaille, et une molette qui échappe
 * ne doit pas coûter le panneau.
 *
 * **Chaque choix s'applique au clic**, et le panneau reste ouvert : on essaie une icône, on la
 * regarde sur la ligne, on en essaie une autre. Aucun « Terminé » — `Échap`, un clic ailleurs ou un
 * second clic sur l'icône referment. Chaque geste n'écrit **que ce qu'il règle**, deux commandes,
 * sans quoi un clic d'icône renverrait la couleur affichée et écraserait une couleur encore en vol.
 *
 * **Choisir l'icône par défaut écrit `null`**, et non « pin » ni « pg » : c'est l'absence de choix.
 */
export function PanneauDApparence({
  nom,
  couleur,
  icone,
  ancre,
  onRecolorer,
  onChangerDIcone,
  onFermer,
  icones = ICONES_DE_DOSSIER,
  nomsDIcones,
  teinteAucune,
}: PanneauDApparenceProps) {
  const t = useT()
  const panneau = useRef<HTMLDivElement>(null)
  const [choisie, setChoisie] = useState<FolderColor | null>(couleur)
  // La première icône offerte est celle par défaut : un nom inconnu — ou absent — la dessine.
  const parDefaut = icones[0] ?? ICONE_PAR_DEFAUT
  const [dessinee, setDessinee] = useState<IconName>(
    icone !== null && icones.includes(icone as IconName) ? (icone as IconName) : parDefaut,
  )
  const [refus, setRefus] = useState<string | null>(null)
  // Les fermetures sont écoutées sur le document : la dernière version de `onFermer` sans relancer
  // les écouteurs à chaque rendu de l'hôte (le piège de `10d`).
  const fermer = useRef(onFermer)
  fermer.current = onFermer

  // **Placé depuis l'ancre, jamais depuis la position courante** — la leçon de `Popover` : une
  // condition portant sur le panneau lui-même oscillerait. Sous l'icône, aligné sur son bord gauche ;
  // replié contre le bord droit s'il déborderait, **au-dessus** de l'icône si le bas de la fenêtre
  // manque et que le haut a la place, et ramené dans la fenêtre si aucun des deux ne l'a.
  useLayoutEffect(() => {
    function placer() {
      const boite = panneau.current
      const a = ancre.current?.getBoundingClientRect()
      if (!boite || !a) return
      const largeur = boite.offsetWidth
      const hauteur = boite.offsetHeight
      const gauche = Math.max(MARGE, Math.min(a.left, window.innerWidth - largeur - MARGE))
      const dessous = a.bottom + ECART
      const auDessus = a.top - ECART - hauteur
      const versLeHaut = dessous + hauteur > window.innerHeight - MARGE && auDessus >= MARGE
      // Ni dessous ni dessus : ramené dans la fenêtre, quitte à couvrir la ligne — un panneau coupé par
      // le bord ne laisserait plus atteindre ses dernières rangées, et rien ne défile pour les rendre.
      const haut = versLeHaut
        ? auDessus
        : Math.max(MARGE, Math.min(dessous, window.innerHeight - hauteur - MARGE))
      // **Au pixel entier** : l'icône tombe souvent sur une demi-coordonnée (une ligne de 22 px sous
      // un en-tête de hauteur impaire), et un panneau posé à `x,5` se peint flou, filet compris.
      boite.style.left = `${Math.round(gauche)}px`
      boite.style.top = `${Math.round(haut)}px`
      boite.dataset.ouverture = versLeHaut ? 'haut' : 'bas'
    }
    placer()
    window.addEventListener('resize', placer)
    // En capture : c'est la zone de l'arbre qui défile, pas la fenêtre.
    document.addEventListener('scroll', placer, true)
    return () => {
      window.removeEventListener('resize', placer)
      document.removeEventListener('scroll', placer, true)
    }
  }, [ancre])

  // Le focus entre dans le panneau, sur la couleur choisie : sans cela `Échap` et les flèches
  // n'auraient rien à y faire au clavier. Le premier groupe de cases radio a un seul arrêt de
  // tabulation, celui de la case cochée.
  useEffect(() => {
    const cochee = panneau.current?.querySelector<HTMLInputElement>('input:checked')
    cochee?.focus()
  }, [])

  useEffect(() => {
    function auClavier(evenement: KeyboardEvent) {
      if (evenement.key !== 'Escape') return
      // En capture, et arrêté : `Échap` ferme ce panneau et rien d'autre derrière lui.
      evenement.stopPropagation()
      fermer.current()
      ancre.current?.focus()
    }
    function ailleurs(evenement: PointerEvent) {
      const cible = evenement.target as Node
      // L'icône elle-même est exclue : son clic referme déjà le panneau, et le fermer ici le
      // rouvrirait aussitôt.
      if (panneau.current?.contains(cible) || ancre.current?.contains(cible)) return
      fermer.current()
    }
    document.addEventListener('keydown', auClavier, true)
    document.addEventListener('pointerdown', ailleurs, true)
    return () => {
      document.removeEventListener('keydown', auClavier, true)
      document.removeEventListener('pointerdown', ailleurs, true)
    }
  }, [ancre])

  const choisirLaCouleur = async (suivante: FolderColor | null) => {
    const avant = choisie
    setChoisie(suivante)
    setRefus(null)
    try {
      await onRecolorer(suivante)
    } catch (erreur) {
      // Un refus défait le geste à l'écran : garder la pastille choisie montrerait une couleur que
      // le disque ne porte pas.
      setChoisie(avant)
      setRefus(String(erreur))
    }
  }

  const choisirLIcone = async (suivante: IconName) => {
    const avant = dessinee
    setDessinee(suivante)
    setRefus(null)
    try {
      await onChangerDIcone(suivante === parDefaut ? null : suivante)
    } catch (erreur) {
      setDessinee(avant)
      setRefus(String(erreur))
    }
  }

  return (
    <div
      ref={panneau}
      role="dialog"
      aria-label={t('explorer.appearancePanel.label', { nom })}
      className={styles.panneau}
      onBlur={(evenement) => {
        // Le focus quitte le panneau — `Tab` au-delà de la grille : il ne concerne plus rien. `null`
        // quand la fenêtre perd le focus, auquel cas on ne ferme pas (l'arbitrage de `Popover`).
        const suivant = evenement.relatedTarget as Node | null
        if (suivant && !panneau.current?.contains(suivant) && !ancre.current?.contains(suivant))
          fermer.current()
      }}
    >
      <Nuancier
        name="couleur-du-dossier"
        valeur={choisie}
        onChange={(suivante) => void choisirLaCouleur(suivante)}
        label={t('explorer.appearancePanel.colorLabel', { nom })}
        labelAucune={t('explorer.appearancePanel.none')}
        teinteAucune={teinteAucune}
      />
      <GrilleDIcones
        name="icone-du-dossier"
        valeur={dessinee}
        onChange={(suivante) => void choisirLIcone(suivante)}
        label={t('explorer.appearancePanel.iconLabel', { nom })}
        icones={icones}
        noms={nomsDIcones}
      />
      {refus !== null && (
        <p className={styles.refus} role="alert">
          {refus}
        </p>
      )}
    </div>
  )
}
