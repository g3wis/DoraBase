import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useRef,
} from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { ChampDeRenommage } from '../ChampDeRenommage/ChampDeRenommage'
import { cx } from '../cx'
import styles from './TreeRow.module.css'

/**
 * L'indentation d'une ligne d'arbre, **par une règle** et non plus par une table (#166).
 *
 * ```
 * indentation = 8 + 14 × (niveau du dossier ou de la connexion) + 16 × (paliers sous la connexion)
 * ```
 *
 * Une table de cinq valeurs relevées dans le mockup A5 a longtemps vécu ici — 8, 22, 36, 52, 68 —,
 * avec la consigne de ne jamais la remplacer par un calcul : `8 + depth * 14` donnait 50 au quatrième
 * palier, pas 52. **Cette règle-ci est la loi que la table mettait au jour**, et elle la reproduit au
 * pixel. Le mockup obéit à deux cadences, lisibles sur l'abscisse des icônes plutôt que sur le
 * padding : **+14** d'un nœud dépliable au suivant, et **+16** vers ce qui est sous la connexion — le
 * « +16 » vaut `chevron (11) + gap (5)`, la reprise de la gouttière qu'une feuille n'occupe pas.
 *
 * - forme migrée (dossier racine, sous-dossier, connexion) : 8, 22, 36, puis 52 pour une console ou
 *   un schéma et 68 pour un objet — **exactement la table d'avant**, que `e2e/a4-sidebar.spec.ts`
 *   mesure contre le mockup ;
 * - trois dossiers : 8, 22, 36, puis 50 pour la connexion, 66 et 82 dessous.
 *
 * La table ne pouvait pas survivre aux dossiers : elle avait cinq cases, et un arbre de dossiers n'a
 * pas de profondeur maximale.
 *
 * **Exportée**, parce que les lignes de message de l'arbre et la liste d'instances doivent s'aligner
 * sur les mêmes paliers : une copie en CSS avait déjà pris un palier de retard.
 */
export function indentation(niveau: number, sousLaConnexion = 0): string {
  return `${8 + 14 * niveau + 16 * sousLaConnexion}px`
}

type TreeRowProps = {
  /**
   * Le **niveau logique** de la ligne, sans limite (#166) — celui qu'`aria-level` annonce et que
   * `data-depth` expose. Ce n'est pas l'indentation : une console et un schéma sont au même niveau
   * logique qu'une connexion enfant, mais indentés de +16.
   */
  depth: number
  /**
   * L'indentation, toujours calculée par `indentation()` chez l'appelant qui connaît la forme de
   * son arbre. Absente, la ligne suit la cadence des nœuds dépliables : `indentation(depth)`.
   *
   * Le premier appelant qui l'a demandée est la liste d'instances (`API-32`), une liste **de
   * feuilles** posée sous l'arbre : sans chevron, ses icônes tomberaient 16 px à gauche de celles
   * des dossiers. Elle passe `indentation(0, 1)` — la cadence « vers une feuille » appliquée depuis
   * le niveau 0.
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
  /**
   * Fait de l'icône **un contrôle à part entière** (#171) : le clic sur elle n'est plus un clic sur la
   * ligne — il ne sélectionne ni ne déplie —, il ouvre le panneau que l'appelant fournit.
   *
   * **Un frère posé par-dessus, jamais un bouton dans le bouton** : c'est la parade du « … » et du
   * bouton de saut d'une clé étrangère (`API-55`). La ligne garde à la place de l'icône une case vide
   * de la même taille, pour que rien ne bouge d'un pixel, et le contrôle se pose exactement sur elle
   * — son abscisse vient de la même indentation, plus la gouttière du chevron.
   *
   * Conséquence voulue : le `pointerdown` qui arme le glisser-déposer (#167) est écouté sur la ligne,
   * dont le contrôle n'est pas un descendant. Presser l'icône ne saisit donc jamais la ligne.
   */
  iconControl?: {
    /** Le nom accessible — « Changer la couleur et l'icône de « X » ». */
    label: string
    onClick: () => void
    /**
     * Le panneau ouvert, **rendu à côté du contrôle** et non en fin de document : `Tab` en ressort
     * vers le « … » de la même ligne, l'ordre de `Popover` sans portail. Il reçoit le
     * contrôle pour s'y ancrer et y rendre le focus. Absent : fermé.
     */
    panneau?: (ancre: RefObject<HTMLButtonElement | null>) => ReactNode
  }
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
  iconControl,
  selected,
  strong,
  muted,
  edition,
  onClick,
  onChevron,
  ...rest
}: TreeRowProps) {
  const controleDIcone = useRef<HTMLButtonElement>(null)
  // Le contrôle n'existe que sur la branche interactive : pendant un renommage, la ligne n'est plus
  // un bouton et l'icône redevient un dessin, comme le « … » disparaît.
  const avecControle =
    iconControl !== undefined &&
    icon !== undefined &&
    onClick !== undefined &&
    edition === undefined
  const tailleDIcone = selected === true ? 12 : 13
  const dessin =
    icon === undefined ? null : (
      <Icon
        name={icon}
        size={tailleDIcone}
        // Trait plus épais sur la ligne sélectionnée : 2 contre 1,8 dans le mockup.
        strokeWidth={selected === true ? 2 : 1.8}
        className={styles.icon}
        style={{ color: muted === true ? 'var(--ink-meta)' : iconColor }}
      />
    )
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
      {avecControle ? (
        // La place de l'icône, gardée vide : le contrôle posé par-dessus la dessine.
        <span
          className={styles.icon}
          style={{ width: tailleDIcone, height: tailleDIcone }}
          data-icon-slot=""
        />
      ) : (
        dessin
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
        style={{ paddingLeft: indent ?? indentation(depth) }}
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
      style={{ paddingLeft: indent ?? indentation(depth) }}
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

  if (actions === undefined && !avecControle) return bouton

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
      {avecControle && iconControl !== undefined && (
        <>
          <button
            ref={controleDIcone}
            type="button"
            className={styles.iconControl}
            // Centré sur la case vide : l'indentation, la gouttière du chevron (11 + 5), puis la
            // moitié de l'icône, moins la moitié du contrôle de 18 px.
            style={{
              left: `calc(${indent ?? indentation(depth)} + ${
                (chevron === undefined ? 0 : 16) + tailleDIcone / 2 - 9
              }px)`,
            }}
            aria-label={iconControl.label}
            // **Hors du parcours de tabulation**, comme le bouton de saut d'une clé étrangère
            // (`API-55`) : le chemin clavier est l'entrée « Couleur et icône… » du menu, qui ouvre le
            // même panneau. Un arrêt de plus par dossier entre la ligne et son « … » allongerait tout
            // parcours de l'arbre pour un geste rare. Il reste focalisable par le code : c'est là que
            // `Échap` rend le focus.
            tabIndex={-1}
            aria-haspopup="dialog"
            aria-expanded={iconControl.panneau !== undefined}
            onClick={iconControl.onClick}
          >
            {dessin}
          </button>
          {iconControl.panneau?.(controleDIcone)}
        </>
      )}
      {actions !== undefined && (
        // `presentation` aussi : cette boîte ne fait que positionner, et un `<span>` nu ajouterait
        // un nœud générique dans l'arbre annoncé.
        <span role="presentation" className={styles.actions}>
          {actions}
        </span>
      )}
    </span>
  )
}
