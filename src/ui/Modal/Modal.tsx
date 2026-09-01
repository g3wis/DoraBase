import { type ReactNode, useEffect, useRef } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../cx'
import styles from './Modal.module.css'

type ModalProps = {
  /** Titre de l'en-tête, et **nom accessible** de la boîte de dialogue. */
  title: string
  /** Icône de la pastille de l'en-tête. */
  icon: IconName
  onClose: () => void
  /**
   * Ce que la modale porte **à droite de son titre**, dans la bande d'en-tête (26 août 2026).
   *
   * Le cas qui l'a fait naître : le projet dans lequel une connexion se déclare. Il vivait dans le
   * formulaire, sous une étiquette « Projet », à côté d'un sélecteur qui proposait de le changer —
   * alors qu'il est **le cadre** du formulaire, pas un de ses champs. Un cadre s'annonce en tête.
   *
   * Un `ReactNode` et non une chaîne : c'est à l'appelant de décider s'il y met un glyphe, et lequel.
   */
  contexte?: ReactNode
  /** Contenu du pied. Absent, aucune bande de pied n'est rendue. */
  footer?: ReactNode
  /**
   * Superpose un second voile, plus opaque, pour une sous-modale par-dessus une modale.
   * `A3` en a besoin ; `A2` non.
   */
  nested?: boolean
  /**
   * Resserre le remplissage vertical de l'en-tête et du pied (28 août 2026, `A10`).
   *
   * `A2` et `A3` gardent leurs 44/57px : c'est `A10` qui en a demandé moins, une modale à
   * onglets où l'en-tête et le pied sont du chrome pur, sans rien à lire. Un prop plutôt qu'une
   * classe passée par `className` : l'en-tête et le pied ne sont pas exposés à l'appelant, ils
   * vivent entièrement dans ce composant.
   */
  compact?: boolean
  className?: string
  children: ReactNode
}

/**
 * Ce qu'un navigateur considère comme focalisable, restreint à ce que le produit emploie.
 *
 * `[tabindex]:not([tabindex="-1"])` est inclus pour les composants qui gèrent leur focus à
 * la main — `TreeRow` et la grille de `10` en auront besoin.
 *
 * **`a[href]` et non `[href]`.** Le sélecteur large, qu'on recopie partout, attrape les
 * `<use href="#i-db">` de nos icônes SVG : le piège plaçait alors un élément SVG en tête de
 * liste, et `.focus()` sur un `<use>` ne fait rien — donc le bouclage de tabulation était
 * muet et le focus restait sur place. Trois tests l'ont attrapé.
 */
const FOCALISABLES =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * La pile des modales ouvertes, de la plus ancienne à la plus récente.
 *
 * **Pourquoi une pile plutôt qu'un simple écouteur.** Chaque instance écoute `keydown` sur
 * `document` : quand `A3` se superpose à `A2`, les deux écouteurs sont armés et un `esc`
 * fermait donc **les deux**. `stopPropagation` n'y change rien — les deux écouteurs sont sur la
 * même cible, ils se déclenchent tous les deux. Seule la modale au sommet doit répondre.
 *
 * Défaut trouvé par un test e2e de `08d`, pas par les tests unitaires de `08a` : ceux-ci
 * n'avaient qu'une modale à la fois.
 */
const pile: symbol[] = []

/**
 * Vrai quand le focus est dans une **saisie de texte**.
 *
 * Pas « dans un contrôle » : un bouton ou une case à cocher n'a rien à quitter, et exiger deux
 * `esc` depuis un bouton serait une friction sans raison. Un `<select>`, en revanche, gère `esc`
 * lui-même pour refermer sa liste — le laisser hors de cette liste est donc volontaire.
 */
function dansUnChamp(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement) return true
  if (!(element instanceof HTMLInputElement)) return false
  // Les types qui portent du texte. Une case à cocher ou un bouton radio n'a pas de saisie à
  // abandonner.
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(element.type)
}

function focalisablesDe(racine: HTMLElement): HTMLElement[] {
  return Array.from(racine.querySelectorAll<HTMLElement>(FOCALISABLES)).filter(
    // `offsetParent` nul signale un élément non rendu — le contenu d'un
    // `CollapsiblePanel` replié, par exemple. Le piéger ferait sauter le focus dans le
    // vide. jsdom ne calcule pas `offsetParent`, d'où le repli sur `hidden`.
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true',
  )
}

export function Modal({
  title,
  icon,
  onClose,
  contexte,
  footer,
  nested = false,
  compact = false,
  className,
  children,
}: ModalProps) {
  const t = useT()
  const coquille = useRef<HTMLDivElement>(null)
  const corps = useRef<HTMLDivElement>(null)
  // Une identité par instance, stable entre les rendus.
  const identite = useRef(Symbol('modal'))

  // `onClose` est lu par les écouteurs ; le garder dans une ref évite de les reposer à
  // chaque rendu, ce qui reviendrait à réarmer `esc` en boucle.
  const fermer = useRef(onClose)
  fermer.current = onClose

  // --- Exigence 3 : restituer le focus. Posée en premier, et volontairement dans son
  // propre effet : mêlée à la mise au point initiale, la restitution partirait de
  // l'élément que *nous* venons de focaliser, pas de celui d'avant l'ouverture.
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null
    return () => origine?.focus?.()
  }, [])

  // --- Exigence 1 : entrer dans la modale.
  useEffect(() => {
    const premierDuCorps = corps.current ? focalisablesDe(corps.current)[0] : undefined
    if (premierDuCorps) {
      premierDuCorps.focus()
      return
    }
    // Repli sur le premier focalisable de la coquille — la croix. Sans lui, le focus
    // resterait sur `<body>`, hors de la modale, et le piège n'aurait rien à retenir.
    if (coquille.current) focalisablesDe(coquille.current)[0]?.focus()
  }, [])

  // --- Exigence 2 : piéger la tabulation. Et `esc`.
  useEffect(() => {
    const moi = identite.current
    pile.push(moi)

    function auSommet() {
      return pile.at(-1) === moi
    }

    function auClavier(evenement: KeyboardEvent) {
      // Seule la modale du sommet répond : sinon `esc` sur `A3` fermerait `A2` avec elle.
      if (!auSommet()) return
      if (evenement.key === 'Escape') {
        evenement.preventDefault()
        // **`esc` dans un champ rend d'abord le focus, il ne ferme pas la modale.** Sinon, une
        // frappe destinée à sortir d'un champ jette tout le formulaire — et l'utilisateur qui
        // vient de saisir dix valeurs les perd. Un second `esc`, le focus étant revenu sur la
        // coquille, ferme comme attendu.
        if (dansUnChamp(document.activeElement)) {
          coquille.current?.focus()
          return
        }
        fermer.current()
        return
      }
      if (evenement.key !== 'Tab' || !coquille.current) return

      const cibles = focalisablesDe(coquille.current)
      if (cibles.length === 0) return

      const premier = cibles.at(0)
      const dernier = cibles.at(-1)
      if (!premier || !dernier) return
      const actif = document.activeElement

      // Le bouclage n'est explicite qu'aux deux extrémités : entre elles, la tabulation
      // native fait le travail, et la doubler produirait des sauts.
      if (!evenement.shiftKey && actif === dernier) {
        evenement.preventDefault()
        premier.focus()
      } else if (evenement.shiftKey && actif === premier) {
        evenement.preventDefault()
        dernier.focus()
      }
    }

    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('keydown', auClavier)
      const rang = pile.indexOf(moi)
      if (rang !== -1) pile.splice(rang, 1)
    }
  }, [])

  return (
    // Le voile n'est pas un contrôle. En faire un `<button>` le rendrait focalisable et
    // annoncé — un lecteur d'écran lirait un bouton anonyme avant le contenu de la modale.
    // La fermeture au clavier passe par `esc`, testé, et par la croix, un vrai bouton nommé.
    // biome-ignore lint/a11y/noStaticElementInteractions: voir ci-dessus
    <div
      className={cx(styles.veil, nested && styles.veilNested)}
      data-testid="veil"
      // Le voile ferme au clic, mais uniquement quand il est lui-même la cible : sans ce
      // test, tout clic dans la coquille remonterait jusqu'ici et fermerait la modale.
      onMouseDown={(evenement) => {
        if (evenement.target === evenement.currentTarget) onClose()
      }}
    >
      {/* **`<div role="dialog">` et non `<dialog>`** : l'élément natif impose son propre voile et sa
          pile de superposition, incompatibles avec les deux voiles superposés de `A3`. (La directive
          `biome-ignore` qui portait cette note a été retirée : la règle `useSemanticElements` ne la
          réclame plus, et une suppression inutile est elle-même une erreur de lint.) */}
      <div
        ref={coquille}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Focalisable **par programme seulement** : `esc` dans un champ y ramène le focus, et un
        // second `esc` ferme. Sans `tabIndex`, `focus()` serait sans effet et le focus retomberait
        // sur `<body>`, hors du piège de tabulation.
        tabIndex={-1}
        className={cx(styles.shell, nested && styles.shellNested, className)}
      >
        <div className={cx(styles.header, compact && styles.headerCompact)}>
          <span className={cx(styles.badge, nested && styles.badgeNested)}>
            <Icon name={icon} size={nested ? 17 : 15} strokeWidth={1.9} />
          </span>
          <span className={cx(styles.title, nested && styles.titleNested)}>{title}</span>
          {contexte}
          <span className={styles.spacer} />
          {!nested && (
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={t('ui.modal.close')}
            >
              <Icon name="x" size={16} strokeWidth={1.9} />
            </button>
          )}
        </div>

        <div ref={corps} className={styles.body} data-testid="modal-body">
          {children}
        </div>

        {footer && (
          <div
            className={cx(styles.footer, compact && styles.footerCompact)}
            data-testid="modal-footer"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
