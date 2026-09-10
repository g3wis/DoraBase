import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { ChampDeRenommage } from '../ChampDeRenommage/ChampDeRenommage'
import { cx } from '../cx'
import styles from './TreeRow.module.css'

/**
 * Indentation par palier, relevée dans le mockup A5 : 8, 22, 36, 52 — écarts 14, 14 puis **16**.
 *
 * `8 + depth * 14` ne la reproduit pas, et cette table a longtemps porté la mention « aucune
 * formule ne les reproduit ». C'était vrai de cette formule-là. Mais le mockup obéit bien à une
 * règle, lisible sur l'**abscisse des icônes** plutôt que sur le padding : 24, 38, 52, 52 — écarts
 * 14, 14, **0**. Le « +16 » du dernier palier vaut exactement `chevron (11) + gap (5)` : ce n'est pas
 * un supplément d'indentation, c'est la reprise de la gouttière qu'une feuille sans chevron
 * n'occupe pas. D'où deux cadences : **+14** d'un nœud dépliable au suivant, **+16** vers une feuille.
 *
 * Le cinquième palier de `25a` va d'un schéma (qui a un chevron) à un objet (qui n'en a pas) : c'est
 * un pas de **+16**, soit 68. Les quatre premières valeurs ne bougent pas — elles sont mesurées
 * contre le mockup, et `e2e/a4-sidebar.spec.ts` les vérifie.
 *
 * **Exportée**, parce que les lignes de message de l'arbre doivent s'aligner sur les mêmes paliers.
 * `ExplorerSidebar.module.css` en tenait une copie en CSS, et un palier de retard entre les deux
 * tables se lit comme un message mal aligné — ce que personne ne pense à vérifier en ajoutant un
 * palier.
 */
export const INDENT = ['8px', '22px', '36px', '52px', '68px'] as const

export type TreeDepth = 0 | 1 | 2 | 3 | 4

type TreeRowProps = {
  depth: TreeDepth
  /**
   * L'indentation, quand elle ne suit pas le palier (`API-32`).
   *
   * **Une exception, pas un second système.** `INDENT` reste la règle : elle est mesurée sur le
   * mockup, et un écran qui poserait ses propres valeurs ferait diverger deux tables comme la CSS
   * l'avait déjà fait. Le cas qui l'a fait naître est la liste d'instances, une liste **de feuilles**
   * posée sous l'arbre : sans chevron, ses icônes tombent 16 px à gauche de celles des projets, dans
   * la même colonne visuelle et à un palier apparent d'écart. La valeur qu'elle passe est
   * `INDENT[0] + 16` — c'est-à-dire exactement la cadence « vers une feuille » que cette table
   * décrit, appliquée depuis le palier 0.
   */
  indent?: string
  label: string
  icon?: IconName
  iconColor?: string
  chevron?: 'open' | 'closed'
  /** Métadonnée de fin de ligne : taille, comptage, nombre de bases. */
  meta?: string
  /** `mono` pour les tailles et comptages, `caps` pour le « n bases » des projets repliés. */
  metaVariant?: 'mono' | 'caps'
  /**
   * Rend la métadonnée en **pastille d'accent** — le compte de modifications de `A6` (`11b`).
   *
   * Le mockup la dessine à la place du compte de lignes : ce qui attend d'être écrit importe plus
   * que la taille de la table, et les deux au même endroit se liraient mal.
   */
  metaBadge?: boolean
  /** Contenu libre de fin de ligne, un `Badge` d'environnement par exemple. */
  trailing?: ReactNode
  /**
   * Le menu d'actions de la ligne — le « … » de `08h`.
   *
   * **Rendu en frère du bouton, pas dedans** : un bouton dans un bouton est invalide, et le clic y
   * déclencherait les deux. La ligne s'enveloppe donc d'un conteneur, qui n'existe que dans ce cas
   * — voir le corps du composant pour ce que cette enveloppe coûte à l'arbre ARIA.
   */
  actions?: ReactNode
  /** Cible courante : aplat d'accent atténué, filet gauche, encre pleine et graisse 700. */
  selected?: boolean
  /** Encre pleine et graisse 700 sans aplat — le projet actif déplié du mockup. */
  strong?: boolean
  /** Projet voisin replié : icônes ramenées à la teinte de métadonnée. */
  muted?: boolean
  /**
   * Rend le libellé **éditable sur place**, et non dans une modale (20 août 2026).
   *
   * Renommer une ligne d'arbre est un geste léger et fréquent ; une modale l'interrompt, demande deux
   * clics de plus, et cache la ligne qu'on est en train de nommer. Le champ prend la place exacte du
   * libellé, à la même taille, pour que le nom se lise pendant qu'on le change.
   *
   * **La ligne cesse d'être un bouton pendant l'édition.** Un `<input>` dans un `<button>` est
   * invalide, et le clic y déclencherait les deux — même raison que pour le menu « … ».
   */
  edition?: {
    onValider: (nom: string) => void
    onAnnuler: () => void
  }
  onClick?: () => void
  /**
   * Le dépliage, **détaché du clic sur la ligne**.
   *
   * Un clic sur la ligne sélectionne, et rien de plus ; déplier demande la flèche ou un double-clic.
   * Le clic simple faisait les deux, et c'est ce qui n'allait pas : regarder une connexion refermait
   * le sous-arbre qu'on venait d'ouvrir, et le rouvrir le refermait encore.
   *
   * **Pas un `<button>` imbriqué**, qui serait invalide et déclencherait les deux gestes : la flèche
   * est une zone *dans* le bouton de la ligne, et c'est la cible du clic qui départage. Sa zone
   * attrapable déborde de 5 px sans rien occuper — la même parade que la poignée du `SplitPane`,
   * pour la même raison : onze pixels de flèche ne se visent pas.
   */
  onChevron?: () => void
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'className' | 'style' | 'type' | 'children'
>

// Les attributs HTML restants sont transmis à la racine. C'est ce qui permet à `A4` (`09d`) de
// poser `role="treeitem"`, `aria-level` et `aria-expanded` **sur l'élément interactif** : une
// enveloppe portant le rôle mettrait le `<button>` *à l'intérieur* du nœud d'arbre, où ni le clic
// ni le focus ne le désignent. `04` avait différé la forme d'arbre « tant qu'aucun écran n'en
// impose la forme » ; A4 l'impose.
//
// Ligne d'arbre purement présentationnelle : elle ne connaît ni ses enfants, ni son état
// d'ouverture, ni le modèle de données. L'écran consommateur aplatit son arbre et fournit
// une liste de `TreeRow` déjà positionnées — le menu latéral
// écarte volontairement toute récursion tant qu'aucun écran n'en impose la forme.
export function TreeRow({
  depth,
  indent,
  label,
  icon,
  iconColor,
  chevron,
  meta,
  metaVariant = 'mono',
  metaBadge = false,
  trailing,
  actions,
  selected,
  strong,
  muted,
  edition,
  onClick,
  onChevron,
  ...rest
}: TreeRowProps) {
  const contenu = (
    <>
      {chevron !== undefined && (
        // L'enveloppe porte la zone attrapable, et c'est elle que `closest` reconnaît. Le
        // `data-chevron` reste sur l'icône : `e2e/a4-sidebar.spec.ts` mesure la flèche elle-même —
        // sa taille et sa rotation — et non ce qui l'entoure.
        <span className={styles.chevronZone} data-chevron-zone="">
          <Icon
            name="chevr"
            size={11}
            strokeWidth={2.4}
            data-chevron={chevron}
            className={cx(styles.chevron, chevron === 'open' && styles.chevronOpen)}
          />
        </span>
      )}
      {icon !== undefined && (
        <Icon
          name={icon}
          size={selected === true ? 12 : 13}
          // Trait plus épais sur la ligne sélectionnée : 2 contre 1,8 dans le mockup.
          strokeWidth={selected === true ? 2 : 1.8}
          className={styles.icon}
          style={{ color: muted === true ? 'var(--ink-meta)' : iconColor }}
        />
      )}
      {edition === undefined ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <ChampDeRenommage valeurInitiale={label} {...edition} />
      )}
      {/* **Les espaces sont explicites, et c'est structurel.** JSX supprime l'espace entre deux
          éléments, et le calcul du nom accessible concatène les nœuds de texte sans rien ajouter :
          sans eux, une ligne d'arbre s'annonce « orders1.9 M » ou « Atelier NordPROD ».
          Le piège s'est présenté quatre fois — `08a` (monogramme), `09a` (compte de segment),
          `09c` (état de connexion), et ici — d'où la correction dans la primitive plutôt que chez
          chaque appelant. */}
      {meta !== undefined && ' '}
      {meta !== undefined && (
        <span
          data-meta={metaVariant}
          className={cx(
            styles.meta,
            metaVariant === 'caps' && styles.metaCaps,
            metaBadge && styles.metaBadge,
          )}
        >
          {meta}
        </span>
      )}
      {trailing !== undefined && ' '}
      {trailing}
    </>
  )

  const className = cx(
    styles.root,
    selected === true && styles.selected,
    strong === true && styles.strong,
  )

  // Une ligne cliquable est un vrai `<button>` : focus et activation clavier natifs, sans
  // `role` ni gestion de touches écrite à la main. Une ligne sans `onClick` reste un
  // `<div>` — c'est du contenu, elle n'a pas à entrer dans le parcours clavier.
  // Pendant l'édition, la branche non interactive : voir la note sur `edition`.
  if (onClick === undefined || edition !== undefined) {
    return (
      // Les attributs restants sont typés pour un `<button>` ; sur cette branche ils sont
      // rétrécis à ce qu'un `<div>` accepte. Les seuls employés par `A4` — `role` et les
      // `aria-*` — sont communs aux deux, et cette branche n'est pas interactive de toute façon.
      <div
        className={className}
        style={{ paddingLeft: indent ?? INDENT[depth] }}
        data-depth={depth}
        {...(rest as HTMLAttributes<HTMLDivElement>)}
      >
        {contenu}
      </div>
    )
  }

  const bouton = (
    <button
      type="button"
      className={className}
      style={{ paddingLeft: indent ?? INDENT[depth] }}
      data-depth={depth}
      {...rest}
      // **La cible du clic départage les deux gestes.** Un `<button>` dans un `<button>` serait
      // invalide et déclencherait les deux ; `closest` sur la cible réelle donne le même résultat
      // sans imbriquer d'élément interactif — et laisse l'activation clavier, dont la cible est le
      // bouton lui-même, tomber sur la sélection.
      onClick={(evenement) => {
        const cible = evenement.target as Element
        if (onChevron !== undefined && cible.closest?.('[data-chevron-zone]')) onChevron()
        else onClick()
      }}
      // **Les flèches horizontales déplient, comme le veut le motif ARIA de l'arbre.** Sans elles,
      // détacher le dépliage du clic le rendrait inatteignable au clavier : `Entrée` sélectionne, et
      // plus rien n'ouvrirait. `ArrowRight` sur un nœud ouvert et `ArrowLeft` sur un nœud fermé ne
      // font rien — le motif y descend ou remonte d'un cran, ce que cet arbre ne sait pas encore
      // faire, et basculer à leur place serait pire que le silence.
      //
      // **Après `{...rest}`, et le `onKeyDown` de l'appelant est rappelé à la main** : le laisser
      // écraser celui-ci retirerait les flèches de l'arbre, et l'inverse retirerait les touches de
      // l'appelant. Le premier qui appelle `preventDefault` gagne.
      onKeyDown={(evenement) => {
        rest.onKeyDown?.(evenement)
        if (onChevron === undefined || evenement.defaultPrevented) return
        const ouvre = evenement.key === 'ArrowRight' && chevron === 'closed'
        const ferme = evenement.key === 'ArrowLeft' && chevron === 'open'
        if (!ouvre && !ferme) return
        evenement.preventDefault()
        onChevron()
      }}
    >
      {contenu}
    </button>
  )

  if (actions === undefined) return bouton

  // **L'enveloppe n'apparaît que pour les lignes qui ont un menu**, et elle a un coût qu'il vaut
  // mieux nommer : le `role="treeitem"` que l'écran pose via `rest` reste sur le `<button>`, donc le
  // « … » est un élément interactif *frère* du nœud d'arbre, à l'intérieur d'une enveloppe
  // `presentation`. L'alternative — faire porter `treeitem` à l'enveloppe — retirerait le rôle au
  // seul élément que le clic et le focus désignent, ce que le commentaire d'en-tête écarte depuis
  // `A4`. Le compromis retenu garde l'arbre navigable au clavier et rend le menu atteignable par
  // `Tab`, avec son propre nom accessible.
  return (
    <span role="presentation" className={styles.wrap}>
      {bouton}
      {/* `presentation` aussi : cette boîte ne fait que positionner, et un `<span>` nu ajouterait
          un nœud générique dans l'arbre annoncé. */}
      <span role="presentation" className={styles.actions}>
        {actions}
      </span>
    </span>
  )
}
