import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../cx'
import { useSortieDuPointeur } from '../sortieDuPointeur'
import styles from './Popover.module.css'

type PopoverProps = {
  /** Titre en capitales de l'en-tête, ex. « Opérateur · status ». Absent, pas d'en-tête. */
  title?: string
  /** Le déclencheur. Il reçoit `aria-expanded`, `aria-haspopup` et l'ouverture au clic. */
  children: ReactElement<Record<string, unknown>>
  /** Le contenu, ou une fonction qui reçoit de quoi refermer. */
  content: ReactNode | ((fermer: () => void) => ReactNode)
  /** Alignement par rapport au déclencheur. Le panneau bascule seul s'il déborde. */
  align?: 'start' | 'end'
  /**
   * De quel côté le panneau s'ouvre. `bas` par défaut, comme tous les popovers du produit.
   *
   * **Explicite, et non mesuré, délibérément.** La bascule horizontale se mesure parce qu'elle
   * dépend de la largeur du contenu — donc de la fenêtre, du texte, des polices chargées. La
   * verticale, elle, était **structurelle** chez le seul appelant qui en avait besoin : un
   * déclencheur dans la barre d'état est dans les 26 derniers pixels de la fenêtre, il n'aura
   * jamais la place en dessous, et aucune mesure ne changera cela.
   *
   * **Cet appelant n'existe plus** (2 septembre 2026) : l'annonce de mise à jour a quitté les
   * barres d'état pour une notification en bas à droite, qui n'est pas un popover. `'haut'` n'a
   * donc aujourd'hui aucun appelant, et la prop reste pour la raison qui l'a fait écrire — c'est le
   * jour où un déclencheur *peut* manquer de place selon le contenu que la bascule mesurée se
   * rajoutera ici, à côté de l'horizontale.
   */
  ouvertureVers?: 'haut' | 'bas'
  /**
   * Ferme le panneau quand le pointeur quitte l'ensemble déclencheur + panneau (`26`).
   *
   * **Opt-in, et non le comportement par défaut.** Un menu d'actions se referme volontiers quand on
   * s'en éloigne — on l'a quitté, on ne le visait plus. Un panneau où l'on *travaille*, comme le
   * sélecteur de colonnes de `10e` ou le popover d'opérateur de `A5`, doit au contraire survivre à un
   * pointeur qui va chercher autre chose : le fermer sous la souris ferait perdre une sélection en
   * cours. Les deux besoins sont opposés, donc l'appelant tranche.
   */
  fermerEnSortant?: boolean
}

/**
 * Un panneau flottant ancré à son déclencheur — le popover d'opérateur de `A5`, et le
 * sélecteur de colonnes de sa toolbar.
 *
 * **Trois fermetures, et les trois comptent.** `Échap` seul laisse un panneau ouvert derrière
 * un clic ailleurs ; le clic extérieur seul le laisse ouvert au clavier ; et la perte de focus
 * est celle qu'on oublie — sans elle, tabuler hors du panneau laisse visible un panneau que
 * plus rien ne concerne.
 *
 * **Pas de portail.** Un portail vers `document.body` simplifierait le débordement, mais
 * placerait le panneau en fin de document : `Tab` sauterait tout l'écran pour l'atteindre.
 * Rendu sur place, l'ordre de tabulation est le bon sans code de rattrapage. Contrepartie
 * assumée : le panneau se replace lui-même quand il déborde à droite.
 */
export function Popover({
  title,
  children,
  content,
  align = 'start',
  ouvertureVers = 'bas',
  fermerEnSortant = false,
}: PopoverProps) {
  const id = useId()
  const [ouvert, setOuvert] = useState(false)
  const [alignement, setAlignement] = useState(align)
  const racine = useRef<HTMLSpanElement>(null)
  const panneau = useRef<HTMLDivElement>(null)

  function fermer(rendreLeFocus = true) {
    setOuvert(false)
    if (rendreLeFocus) {
      const declencheur = racine.current?.querySelector<HTMLElement>('[aria-haspopup]')
      declencheur?.focus()
    }
  }

  // Clic extérieur. `pointerdown` et non `click` : un clic qui commence dans le panneau et
  // finit dehors ne doit pas le fermer, et l'inverse doit le fermer avant que la cible ne
  // reçoive son événement.
  useEffect(() => {
    if (!ouvert) return
    function surPointeur(evenement: PointerEvent) {
      if (!racine.current?.contains(evenement.target as Node)) setOuvert(false)
    }
    document.addEventListener('pointerdown', surPointeur)
    return () => document.removeEventListener('pointerdown', surPointeur)
  }, [ouvert])

  // Bascule d'alignement quand le panneau déborderait à droite. `getBoundingClientRect` rend
  // des zéros sous jsdom, où la condition est donc toujours fausse — c'est Playwright qui
  // vérifie ce comportement, comme pour toute exigence de mise en page.
  //
  // **Une seule mesure ne suffit pas.** Le panneau s'ouvre avant que la page ait fini de se
  // poser — polices, images, contenu asynchrone — et une position mesurée trop tôt laisse un
  // panneau qui déborde une fois la mise en page stabilisée. Le test Playwright a d'abord été
  // vert pour cette raison, puis rouge une fois la page alourdie : il mesurait un instant, pas
  // un état. D'où la ré-évaluation à chaque changement de géométrie.
  //
  // **`useLayoutEffect` et non `useEffect`** : la bascule a lieu avant la peinture, sinon le
  // panneau apparaît un instant à cheval sur le bord avant de se replacer. Scintillement bref
  // mais réel — et c'est lui qui rendait le test de position intermittent.
  useLayoutEffect(() => {
    if (!ouvert) return
    function recadrer() {
      const boite = panneau.current?.getBoundingClientRect()
      const ancre = racine.current?.getBoundingClientRect()
      if (!boite || !ancre || boite.width === 0) return
      // **Mesuré depuis l'ancre, pas depuis le panneau.** Une condition portant sur la position
      // *courante* du panneau oscillerait : basculé, il tient ; tenant, on le remet à gauche ; à
      // gauche, il déborde à nouveau. La question est « où serait-il aligné à gauche ? », et
      // seule l'ancre y répond quelle que soit sa position actuelle.
      const deborderait = ancre.left + boite.width > window.innerWidth
      setAlignement(deborderait ? 'end' : align)
    }
    recadrer()
    const observateur = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(recadrer)
    observateur?.observe(document.documentElement)
    window.addEventListener('resize', recadrer)
    return () => {
      observateur?.disconnect()
      window.removeEventListener('resize', recadrer)
    }
  }, [ouvert, align])

  // **Sur la racine, qui contient le déclencheur *et* le panneau** : le départ n'est réel que
  // lorsque le pointeur quitte l'ensemble. Un délai de grâce absorbe l'interstice de 2px que
  // `top: calc(100% + var(--space-1))` laisse entre les deux — voir `useSortieDuPointeur`.
  const sortie = useSortieDuPointeur(ouvert && fermerEnSortant, () => setOuvert(false))

  const declencheur = cloneElement(children, {
    'aria-haspopup': 'dialog',
    'aria-expanded': ouvert,
    'aria-controls': ouvert ? id : undefined,
    onClick: () => setOuvert((etait) => !etait),
  })

  return (
    // L'enveloppe ne fait que capter `Échap` et la sortie de focus pour le compte de ses deux
    // enfants ; les contrôles restent le déclencheur et le contenu.
    // biome-ignore lint/a11y/noStaticElementInteractions: voir ci-dessus
    <span
      ref={racine}
      className={styles.root}
      onKeyDown={(evenement) => {
        if (evenement.key === 'Escape' && ouvert) {
          evenement.stopPropagation()
          fermer()
        }
      }}
      onPointerLeave={sortie.onPointerLeave}
      onPointerEnter={sortie.onPointerEnter}
      onBlur={(evenement) => {
        // Le focus quitte l'ensemble déclencheur + panneau : `relatedTarget` est l'élément qui
        // le reçoit, et `null` quand la fenêtre elle-même le perd — auquel cas on ne ferme pas,
        // sinon revenir à l'application refermerait le panneau qu'on avait laissé ouvert.
        const suivant = evenement.relatedTarget as Node | null
        if (suivant && !racine.current?.contains(suivant)) setOuvert(false)
      }}
    >
      {declencheur}
      {ouvert && (
        <div
          ref={panneau}
          id={id}
          role="dialog"
          aria-label={title}
          /* Le sens d'ouverture, dans le DOM. **Ce n'est pas qu'un crochet de test** : c'est la
             seule trace lisible d'une propriété que jsdom ne calcule pas et qu'une classe de CSS
             module ne nomme qu'en `string | undefined`. Un panneau ouvert hors de la fenêtre est
             invisible *et* indistinguable d'un panneau bien posé. */
          data-ouverture={ouvertureVers}
          className={cx(
            styles.panel,
            alignement === 'end' ? styles.aDroite : styles.aGauche,
            ouvertureVers === 'haut' ? styles.versLeHaut : styles.versLeBas,
          )}
        >
          {title !== undefined && <div className={styles.title}>{title}</div>}
          {typeof content === 'function' ? content(() => fermer()) : content}
        </div>
      )}
    </span>
  )
}
