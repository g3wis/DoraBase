import { type Tab, TabStrip } from '../../ui/TabStrip/TabStrip'
import { type EtatOnglets, idOnglet, libelleDeConsole } from './onglets'
import styles from './WorkbenchTabs.module.css'

/** Les deux vues d'une table : ses lignes, ou sa structure (`14a`). */
export type VueObjet = 'donnees' | 'structure'

type WorkbenchTabsProps = {
  etat: EtatOnglets
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onReorder: (ids: string[]) => void
  /**
   * Renomme la console ouverte dans cet onglet — reçoit l'identité de l'onglet et le nouveau nom.
   *
   * Absent, le double-clic sur un onglet ne fait rien : l'écran n'est pas relié à l'écriture.
   */
  onRename?: (id: string, nouveau: string) => void
}

/**
 * La bande d'onglets de l'écran de travail.
 *
 * `TabStrip` (`03`) est purement présentationnelle : elle ne sait rien des tables. La traduction
 * du modèle d'onglets en `Tab` vit donc ici, comme `arbre.ts` traduit les projets en `Noeud`.
 *
 * **Le couple « Données / Structure » n'est plus ici.** Il occupait la droite de la bande, et `22`
 * l'a déplacé dans l'en-tête de la colonne de droite — là où se regarde le détail de ce que le
 * centre affiche. Les propriétés `vue` et `onVueChange` sont parties avec lui : un composant ne
 * garde pas une entrée devenue sans objet.
 */
export function WorkbenchTabs({
  etat,
  onSelect,
  onClose,
  onReorder,
  onRename,
}: WorkbenchTabsProps) {
  const tabs: Tab[] = etat.onglets.map((onglet) => {
    // **Une console n'est pas une table**, et le mockup lui donne son icône et son libellé
    // « console 1 ». C'est le seul endroit où l'union de `12a` se traduit en interface.
    if (onglet.sorte === 'console') {
      return {
        id: idOnglet(onglet),
        icon: 'term' as const,
        iconColor: 'var(--info)',
        accentColor: 'var(--accent)',
        // Une console persistée porte **son nom** ; un brouillon garde « console 1 ».
        label: libelleDeConsole(onglet),
        // **Seule une console persistée se renomme depuis son onglet.** Un brouillon n'a pas de
        // nom sur le disque : le renommer ne voudrait rien dire tant qu'il n'existe pas.
        renommable: onglet.nom !== undefined,
      }
    }
    if (onglet.sorte === 'diagramme') {
      return {
        id: idOnglet(onglet),
        // `plan` était la seule icône du sprite que rien n'employait, et c'est un graphe de boîtes
        // reliées par des traits : le dessin dit déjà ce que l'onglet ouvre, sans qu'il faille en
        // ajouter une — et une icône du sprite est un décor partagé qu'on ne touche pas sans raison.
        icon: 'plan' as const,
        // **Une encre neutre, et non une cinquième couleur.** Les quatre teintes de la bande
        // nomment des *natures d'objet* — table, vue, console — et un diagramme n'en est pas une :
        // c'est une façon de regarder un schéma. C'est déjà pour cette raison que la ligne d'une
        // console porte `--ink-3` dans l'arbre.
        iconColor: 'var(--ink-2)',
        accentColor: 'var(--accent)',
        // Le nom du schéma : c'est de lui que le diagramme parle. L'icône le distingue d'un onglet
        // de table, comme elle distingue une console.
        label: onglet.schema,
      }
    }
    return {
      id: idOnglet(onglet),
      icon: onglet.kind === 'view' ? ('view' as const) : ('table' as const),
      // L'icône suit le **type d'objet**, le filet suit la **famille** d'onglet : deux valeurs
      // distinctes, relevées sur les cinq onglets actifs du mockup (voir `TabStrip`).
      iconColor: onglet.kind === 'view' ? 'var(--violet)' : 'var(--success)',
      accentColor: 'var(--accent)',
      label: onglet.table,
    }
  })

  return (
    <div className={styles.root}>
      <div className={styles.strip}>
        <TabStrip
          tabs={tabs}
          activeId={etat.actif ?? ''}
          onSelect={onSelect}
          onClose={onClose}
          onReorder={(suivants) => onReorder(suivants.map((tab) => tab.id))}
          onRename={onRename}
        />
      </div>
    </div>
  )
}
