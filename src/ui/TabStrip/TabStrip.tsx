import { type DragEvent, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { useApercuTronque } from '../ApercuTronque/useApercuTronque'
import { ChampDeRenommage } from '../ChampDeRenommage/ChampDeRenommage'
import { cx } from '../cx'
import styles from './TabStrip.module.css'

export type Tab = {
  id: string
  icon: IconName
  /** Couleur du trait de l'icône — suit le **type d'objet** (schéma, table, console). */
  iconColor: string
  /** Couleur du filet supérieur quand l'onglet est actif — suit la **famille** d'onglet. */
  accentColor: string
  label: string
  /** Suffixe technique optionnel, ex. « ·psql ». */
  meta?: string
  /**
   * L'onglet se renomme **au double-clic sur son libellé**.
   *
   * Vrai pour une console persistée seulement : le nom d'un onglet de table est celui de la table,
   * et il vient du serveur.
   */
  renommable?: boolean
  /**
   * Le texte entier que le survol prolongé montre quand le libellé est coupé à l'ellipse (#156).
   *
   * Absent, c'est le libellé lui-même. Un onglet de résultat de console le porte à part : son
   * libellé est la requête **sur une ligne**, l'aperçu la rend avec ses retours à la ligne.
   */
  titre?: string
}

type TabStripProps = {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  /** Absent, les onglets ne se ferment pas : aucune croix n'est rendue (#156). */
  onClose?: (id: string) => void
  /** Absent, les onglets ne se déplacent pas : rien n'est glissable. */
  onReorder?: (tabs: Tab[]) => void
  /**
   * Renomme l'onglet — appelé avec le nouveau nom, déjà nettoyé.
   *
   * **Le même geste qu'au double-clic sur la ligne d'arbre** : une console se rencontre aux deux
   * endroits, et n'être renommable qu'à l'un des deux obligerait à se souvenir lequel.
   */
  onRename?: (id: string, nouveau: string) => void
  /**
   * La largeur au-delà de laquelle un onglet coupe son libellé à l'ellipse (#156).
   *
   * Absente, un onglet prend la largeur de son libellé, comme les onglets de table et de console :
   * leurs noms sont courts. Un onglet qui porte une requête entière en a besoin.
   */
  largeurMax?: number
}

// `iconColor` et `accentColor` sont deux valeurs distinctes, relevées sur les cinq onglets
// actifs du mockup : un onglet de table a un trait en accent mais une icône verte, une
// console a un trait violet et une icône `--violet-ink`. Les fusionner produirait deux
// combinaisons qui n'existent nulle part dans le handoff.
//
// Chaque onglet est un `<div>` inerte portant **deux boutons frères** — sélection et
// fermeture. Un bouton dans un bouton étant interdit en HTML, c'est ce qui évite la dette
// du `Chip` (racine `div[role=button]` avec clavier géré à la main) : ici les deux restent
// des `<button>` natifs, focalisables et activables sans code ajouté.
export function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onRename,
  largeurMax,
}: TabStripProps) {
  // Le libellé coupé se lit au survol prolongé — la mécanique du panneau de ligne (#156).
  const { armer, desarmer, apercu } = useApercuTronque()
  /**
   * L'onglet en cours de renommage.
   *
   * **Local, contrairement à celui de `TreeRow`** : là-bas, l'entrée « Renommer… » du menu « … »
   * doit pouvoir l'ouvrir, donc l'état vit chez l'appelant. Ici rien d'extérieur ne le déclenche —
   * le double-clic est le seul chemin, et il part de ce composant.
   */
  const [enRenommage, setEnRenommage] = useState<string | null>(null)

  function handleDrop(targetId: string, draggedId: string) {
    if (draggedId === targetId) return
    const from = tabs.findIndex((tab) => tab.id === draggedId)
    const to = tabs.findIndex((tab) => tab.id === targetId)
    if (from === -1 || to === -1 || onReorder === undefined) return

    const next = [...tabs]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    onReorder(next)
  }

  return (
    <div className={styles.root} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          // `role="presentation"` rend l'enveloppe transparente pour les technologies
          // d'assistance : un `role="tablist"` attend des `role="tab"` pour enfants, et un
          // `<div>` nu au milieu casserait cette relation. Elle n'existe que pour porter le
          // filet supérieur coloré et grouper les deux boutons.
          <div
            key={tab.id}
            className={cx(styles.tab, active && styles.active)}
            style={{
              ...(active ? { borderTopColor: tab.accentColor } : {}),
              ...(largeurMax !== undefined ? { maxWidth: largeurMax } : {}),
            }}
            data-active={active}
            role="presentation"
          >
            {/* Le glisser-déposer vit sur le bouton, pas sur l'enveloppe : c'est l'élément
                réellement interactif, et le corps de l'onglet est ce que l'utilisateur
                saisit. Conséquence assumée — sur l'onglet actif, la zone de dépôt exclut la
                largeur de la croix. Sans effet en pratique : on dépose sur les onglets
                voisins, pas sur celui qu'on est en train de déplacer. */}
            {enRenommage === tab.id && onRename !== undefined ? (
              // **Pendant l'édition, l'onglet n'est plus un bouton** : un `<input>` dans un
              // `<button>` est invalide, et le clic y déclencherait les deux. Même arbitrage que
              // pour la croix de fermeture et pour le menu « … » d'une ligne d'arbre.
              // Un `<div>` nu : il n'a pas besoin de `role`, l'enveloppe portant déjà
              // `role="presentation"`, et deux rôles imbriqués n'ajoutent rien.
              <div className={styles.select}>
                <Icon
                  name={tab.icon}
                  size={13}
                  strokeWidth={active ? 2 : 1.9}
                  style={{ color: tab.iconColor }}
                />
                <ChampDeRenommage
                  valeurInitiale={tab.label}
                  onValider={(nouveau) => {
                    setEnRenommage(null)
                    onRename(tab.id, nouveau)
                  }}
                  onAnnuler={() => setEnRenommage(null)}
                />
              </div>
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={styles.select}
                onClick={() => onSelect(tab.id)}
                // **Le survol est écouté sur le bouton, la coupure mesurée sur son libellé** : c'est
                // le libellé qui porte l'ellipse, et le bouton l'élément interactif (#156).
                onMouseEnter={(event) => {
                  const libelle = event.currentTarget.querySelector<HTMLElement>('[data-libelle]')
                  if (libelle !== null) armer(libelle, tab.titre ?? tab.label)
                }}
                onMouseLeave={desarmer}
                onDoubleClick={
                  tab.renommable === true && onRename !== undefined
                    ? () => setEnRenommage(tab.id)
                    : undefined
                }
                {...(onReorder !== undefined && {
                  draggable: true,
                  onDragStart: (event: DragEvent) =>
                    event.dataTransfer.setData('text/plain', tab.id),
                  onDragOver: (event: DragEvent) => event.preventDefault(),
                  onDrop: (event: DragEvent) =>
                    handleDrop(tab.id, event.dataTransfer.getData('text/plain')),
                })}
              >
                <Icon
                  name={tab.icon}
                  size={13}
                  strokeWidth={active ? 2 : 1.9}
                  style={{ color: tab.iconColor }}
                />
                <span className={styles.libelle} data-libelle>
                  {tab.label}
                </span>
                {/* L'espace est **explicite** : sans elle, le nom accessible colle le libellé et
                    son suffixe — « select 1échec » (piège n° 1). */}
                {tab.meta !== undefined && ' '}
                {tab.meta !== undefined && <span className={styles.meta}>{tab.meta}</span>}
              </button>
            )}
            {active && onClose !== undefined && (
              <button
                type="button"
                aria-label={`Fermer ${tab.label}`}
                className={styles.close}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="x" size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>
        )
      })}
      {apercu}
    </div>
  )
}
