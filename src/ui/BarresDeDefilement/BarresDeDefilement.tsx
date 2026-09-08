import { useEffect, useRef } from 'react'
import styles from './BarresDeDefilement.module.css'

/** Combien de temps un curseur reste visible après le dernier événement de défilement. */
const REMANENCE_MS = 700
/** Un curseur plus court que cela devient introuvable à la souris. */
const LONGUEUR_MINIMALE = 24
/**
 * L'épaisseur de la bande, le long d'un bord, qui révèle la barre de cet axe sans qu'on défile.
 *
 * Plus épaisse que le curseur, et c'est la condition pour qu'on puisse l'atteindre : un curseur de
 * 6 px invisible ne se survole pas, il se rencontre.
 */
const BANDE_DE_SURVOL = 14

type Axe = 'vertical' | 'horizontal'

const AXES: Axe[] = ['vertical', 'horizontal']

type Etat = {
  pouces: Partial<Record<Axe, HTMLDivElement>>
  /** Quels axes ont leur bande sous le pointeur. Un axe survolé ne s'efface pas. */
  survol: Partial<Record<Axe, boolean>>
  minuteur: number | undefined
}

type Survol = { zone: HTMLElement; axes: Axe[] }

/**
 * Les barres de défilement du produit : **superposées, et visibles seulement pendant le geste**.
 *
 * # Pourquoi elles sont dessinées ici et non déclarées en CSS
 *
 * Les deux exigences se contredisent en CSS pur. `::-webkit-scrollbar` permet de rendre une barre
 * discrète — c'est ce que faisait la correction du défaut n° 70 — mais **styler ce pseudo-élément
 * force WebKit à rendre une barre classique**, c'est-à-dire une barre qui *réserve sa place* dans la
 * mise en page et reste affichée en permanence. Il n'existe pas de propriété qui demande « une barre
 * en survol » : c'est un réglage du système, et l'utilisateur qui a choisi « Afficher les barres de
 * défilement : toujours » l'a réglé dans l'autre sens pour tout son bureau.
 *
 * Les barres natives sont donc **masquées partout** (voir `reset.css`), et celles-ci sont dessinées
 * dans une couche `position: fixed` qui recouvre la fenêtre sans rien y occuper.
 *
 * # Pourquoi un seul composant, monté une fois, et non un habillage par panneau
 *
 * Quatorze feuilles déclarent un conteneur défilant, et il en viendra d'autres. Un composant
 * d'habillage aurait demandé de reprendre quatorze chaînes de `flex` — chacune un risque de
 * régression de mise en page pour un dispositif qui n'en concerne aucune. Celui-ci écoute les
 * événements `scroll` en phase de **capture** sur le document : un `scroll` ne remonte pas, mais il
 * se capture. N'importe quel conteneur, présent ou futur, y a donc droit sans le savoir.
 *
 * # Ce qu'elles font, et ce qu'elles ne font pas
 *
 * Elles apparaissent au défilement **et au survol de leur bord** (API-34). Le survol seul ne
 * suffisait pas : une barre qu'on n'atteint qu'en défilant ne se saisit jamais, puisqu'il faut avoir
 * déjà fait à la molette le geste qu'on venait lui demander — et sur une table plus large que sa
 * colonne, c'est précisément la barre horizontale qu'on cherche du regard avant tout défilement.
 *
 * Ce qui est survolé est une **bande** de {@link BANDE_DE_SURVOL} px le long du bord, jamais le
 * curseur seul : celui-ci est invisible au repos, donc il n'y a rien à viser. Les curseurs restent
 * tant que le pointeur tient cette bande ou les traîne, et s'effacent {@link REMANENCE_MS} ms après.
 * Hors de là, **rien n'est visible** — c'est la seconde moitié de l'exigence, et c'est elle qui
 * interdit de remplacer la bande par une piste peinte.
 *
 * Elles ne s'élargissent toujours pas au survol, à la différence de celles du système : cela demande
 * de rendre aussi la piste, donc de dessiner en permanence ce que l'exigence demande d'effacer.
 */
export function BarresDeDefilement() {
  const couche = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const hote = couche.current
    if (!hote) return

    const etats = new Map<Element, Etat>()
    /**
     * À quel curseur appartient un élément de la couche.
     *
     * C'est ce qui rend le pointeur *sur* un curseur indiscernable du pointeur dans sa bande : la
     * couche est `fixed` et n'a aucun ancêtre défilant, donc sans cette carte, poser le pointeur sur
     * la barre — ce qu'on fait pour la saisir — l'effacerait.
     */
    const proprietaires = new Map<Element, { zone: HTMLElement; axe: Axe }>()
    let survol: Survol | null = null

    function etatDe(zone: Element): Etat {
      const existant = etats.get(zone)
      if (existant) return existant
      const etat: Etat = { pouces: {}, survol: {}, minuteur: undefined }
      etats.set(zone, etat)
      return etat
    }

    function pouceDe(zone: HTMLElement, axe: Axe): HTMLDivElement {
      const etat = etatDe(zone)
      const existant = etat.pouces[axe]
      if (existant) return existant
      const pouce = document.createElement('div')
      // `?? ''` : les modules CSS sont typés comme un dictionnaire ouvert, donc chaque classe peut
      // être `undefined` pour le compilateur. Une classe manquante rendrait un curseur invisible, pas
      // une erreur — c'est le genre de faute que seule une mesure attrape.
      pouce.className = (axe === 'vertical' ? styles.vertical : styles.horizontal) ?? ''
      installerLeGlissement(pouce, zone, axe)
      hote?.appendChild(pouce)
      proprietaires.set(pouce, { zone, axe })
      etat.pouces[axe] = pouce
      return pouce
    }

    /**
     * Traîner le curseur défile la zone.
     *
     * Le rapport est celui des courses : un pixel de curseur vaut `course de contenu / course de
     * curseur` pixels de contenu. Sans ce facteur, traîner d'un centimètre sur une table de cent
     * mille lignes ne bougerait de rien.
     */
    function installerLeGlissement(pouce: HTMLDivElement, zone: HTMLElement, axe: Axe) {
      pouce.addEventListener('pointerdown', (evenement) => {
        evenement.preventDefault()
        pouce.setPointerCapture(evenement.pointerId)
        pouce.dataset.tenu = 'oui'
        const depart = axe === 'vertical' ? evenement.clientY : evenement.clientX
        const departDuDefilement = axe === 'vertical' ? zone.scrollTop : zone.scrollLeft

        const deplacer = (mouvement: PointerEvent) => {
          const delta = (axe === 'vertical' ? mouvement.clientY : mouvement.clientX) - depart
          const visible = axe === 'vertical' ? zone.clientHeight : zone.clientWidth
          const total = axe === 'vertical' ? zone.scrollHeight : zone.scrollWidth
          // **La même piste qu'au placement.** Deux définitions divergentes feraient dériver le
          // curseur sous le doigt — d'autant plus vite que l'en-tête collé est haut.
          const piste = visible - (axe === 'vertical' ? hauteurCollee(zone) : 0)
          const longueurDuPouce = Math.max(LONGUEUR_MINIMALE, (piste * visible) / total)
          const courseDuPouce = piste - longueurDuPouce
          if (courseDuPouce <= 0) return
          const facteur = (total - visible) / courseDuPouce
          if (axe === 'vertical') zone.scrollTop = departDuDefilement + delta * facteur
          else zone.scrollLeft = departDuDefilement + delta * facteur
        }
        const relacher = () => {
          delete pouce.dataset.tenu
          pouce.removeEventListener('pointermove', deplacer)
          pouce.removeEventListener('pointerup', relacher)
          pouce.removeEventListener('pointercancel', relacher)
          effacerPlusTard(zone)
        }
        pouce.addEventListener('pointermove', deplacer)
        pouce.addEventListener('pointerup', relacher)
        pouce.addEventListener('pointercancel', relacher)
      })
    }

    /**
     * La hauteur de ce qui est **collé en haut** de la zone : un en-tête `sticky`, et la ligne de
     * filtres qui le suit.
     *
     * La piste du curseur commence en dessous. Sans cela, elle démarrait au niveau des en-têtes de
     * colonnes — donc au-dessus de la première ligne de données — et le curseur semblait décrire un
     * contenu qui commence plus haut qu'il ne commence. Signalé à l'écran le 19 août 2026.
     *
     * Mesuré sur l'arbre plutôt que déclaré : ce composant ne connaît aucun de ses quatorze
     * conteneurs, et une constante de 55 px serait fausse dès qu'un panneau colle autre chose — ou
     * dès qu'un réglage de densité change la hauteur de l'en-tête (`15c`).
     */
    function hauteurCollee(zone: HTMLElement): number {
      let total = 0
      for (const enfant of zone.children) {
        if (!(enfant instanceof HTMLElement)) continue
        const style = getComputedStyle(enfant)
        if (style.position !== 'sticky') continue
        // `top: 0` : seul ce qui se colle **en haut** décale le début de la piste. Un pied collé en
        // bas la raccourcirait par l'autre bout, ce qu'aucun panneau ne fait aujourd'hui.
        if (Number.parseFloat(style.top || 'NaN') !== 0) continue
        total += enfant.getBoundingClientRect().height
      }
      return total
    }

    function placer(zone: HTMLElement, axe: Axe) {
      const visible = axe === 'vertical' ? zone.clientHeight : zone.clientWidth
      const total = axe === 'vertical' ? zone.scrollHeight : zone.scrollWidth
      const position = axe === 'vertical' ? zone.scrollTop : zone.scrollLeft
      // Un pixel de tolérance : un filet en `content-box` suffit à créer un débordement qui ne se
      // voit pas, et une barre pour un pixel serait du bruit (défaut n° 69).
      if (total <= visible + 1) {
        etats.get(zone)?.pouces[axe]?.style.setProperty('opacity', '0')
        return
      }
      const boite = zone.getBoundingClientRect()
      // La piste : la partie de la zone que le curseur peut parcourir, en-tête collé exclu.
      const debut = axe === 'vertical' ? hauteurCollee(zone) : 0
      const piste = visible - debut
      const longueur = Math.max(LONGUEUR_MINIMALE, (piste * visible) / total)
      const decalage = ((piste - longueur) * position) / (total - visible)
      const pouce = pouceDe(zone, axe)
      // **Coordonnées de fenêtre, sur une couche `fixed`.** Positionner le curseur dans le conteneur
      // demanderait un `position: relative` sur chacun des quatorze — donc de toucher leur mise en
      // page pour un dispositif qui n'en fait pas partie.
      if (axe === 'vertical') {
        pouce.style.top = `${boite.top + debut + decalage}px`
        pouce.style.left = `${boite.right - 8}px`
        pouce.style.height = `${longueur}px`
      } else {
        pouce.style.left = `${boite.left + decalage}px`
        pouce.style.top = `${boite.bottom - 8}px`
        pouce.style.width = `${longueur}px`
      }
      pouce.style.opacity = '1'
    }

    function effacerPlusTard(zone: Element) {
      const etat = etatDe(zone)
      window.clearTimeout(etat.minuteur)
      etat.minuteur = window.setTimeout(() => {
        let reste = false
        // **Axe par axe.** Une barre tenue ou survolée ne dit rien de l'autre : survoler le bord bas
        // d'une grille doit y laisser la barre horizontale seule, et effacer la verticale.
        for (const axe of AXES) {
          const pouce = etat.pouces[axe]
          if (!pouce) continue
          // Ni pendant un glissement, ni sous le pointeur : c'est le moment où la barre sert.
          if (pouce.dataset.tenu === 'oui' || etat.survol[axe]) {
            reste = true
            continue
          }
          pouce.style.opacity = '0'
        }
        if (reste) effacerPlusTard(zone)
      }, REMANENCE_MS)
    }

    function deborde(zone: HTMLElement, axe: Axe): boolean {
      // Le même pixel de tolérance qu'au placement, et pour la même raison (défaut n° 69).
      return axe === 'vertical'
        ? zone.scrollHeight > zone.clientHeight + 1
        : zone.scrollWidth > zone.clientWidth + 1
    }

    /** Le point est-il dans la bande qui longe le bord où vit la barre de cet axe ? */
    function dansLaBande(boite: DOMRect, x: number, y: number, axe: Axe): boolean {
      if (x < boite.left || x > boite.right || y < boite.top || y > boite.bottom) return false
      return axe === 'vertical'
        ? boite.right - x <= BANDE_DE_SURVOL
        : boite.bottom - y <= BANDE_DE_SURVOL
    }

    function axesSurvoles(zone: HTMLElement, x: number, y: number): Axe[] {
      const boite = zone.getBoundingClientRect()
      const style = getComputedStyle(zone)
      return AXES.filter(
        (axe) =>
          deborde(zone, axe) &&
          /auto|scroll/.test(axe === 'vertical' ? style.overflowY : style.overflowX) &&
          dansLaBande(boite, x, y, axe),
      )
    }

    /**
     * La zone dont une bande est sous le pointeur, et les axes concernés.
     *
     * La remontée part de l'élément sous le point : un conteneur défilant n'a pas à se déclarer,
     * exactement comme pour l'écoute des `scroll` en capture. Elle s'arrête à la **première** zone
     * qui réponde — la plus intérieure, celle que le geste visait.
     */
    function survolDe(x: number, y: number): Survol | null {
      const cible = document.elementFromPoint(x, y)
      const proprietaire = cible ? proprietaires.get(cible) : undefined
      if (proprietaire) {
        const axes = axesSurvoles(proprietaire.zone, x, y)
        return {
          zone: proprietaire.zone,
          axes: axes.includes(proprietaire.axe) ? axes : [...axes, proprietaire.axe],
        }
      }
      let noeud: Element | null = cible
      while (noeud instanceof HTMLElement) {
        const axes = axesSurvoles(noeud, x, y)
        if (axes.length > 0) return { zone: noeud, axes }
        noeud = noeud.parentElement
      }
      return null
    }

    function memeSurvol(un: Survol | null, autre: Survol | null): boolean {
      if (!un || !autre) return un === autre
      return (
        un.zone === autre.zone &&
        un.axes.length === autre.axes.length &&
        un.axes.every((axe) => autre.axes.includes(axe))
      )
    }

    function poserLeSurvol(suivant: Survol | null) {
      const precedent = survol
      if (precedent) {
        const etat = etats.get(precedent.zone)
        if (etat) for (const axe of precedent.axes) etat.survol[axe] = false
      }
      survol = suivant
      if (suivant) {
        const etat = etatDe(suivant.zone)
        for (const axe of suivant.axes) {
          etat.survol[axe] = true
          placer(suivant.zone, axe)
        }
      }
      // **La rémanence, et non un effacement immédiat.** Quitter la bande d'un pixel en visant le
      // curseur ne doit pas le retirer sous la main ; et le minuteur, qui relit les axes survolés au
      // moment où il tire, laisse en place ce qui l'est encore.
      if (precedent) effacerPlusTard(precedent.zone)
    }

    let trameDemandee = 0
    let dernierX = 0
    let dernierY = 0

    function auMouvement(evenement: PointerEvent) {
      dernierX = evenement.clientX
      dernierY = evenement.clientY
      // Une révision par trame au plus : le pointeur émet bien plus d'événements que l'écran ne rend
      // d'images, et chaque révision lit une géométrie.
      if (trameDemandee) return
      trameDemandee = requestAnimationFrame(() => {
        trameDemandee = 0
        const suivant = survolDe(dernierX, dernierY)
        if (!memeSurvol(survol, suivant)) poserLeSurvol(suivant)
      })
    }

    function auDepart() {
      if (survol) poserLeSurvol(null)
    }

    function auDefilement(evenement: Event) {
      const zone = evenement.target
      // Le document lui-même ne défile pas (`overflow: hidden` sur `html`/`body`), et un `scroll` sur
      // lui n'aurait pas de boîte à mesurer.
      if (!(zone instanceof HTMLElement)) return
      placer(zone, 'vertical')
      placer(zone, 'horizontal')
      effacerPlusTard(zone)
    }

    // **En capture.** Un événement `scroll` ne remonte pas l'arbre, mais il le descend : c'est ce qui
    // permet d'écouter tous les conteneurs, y compris ceux qui n'existent pas encore, sans que
    // chacun ait à se déclarer.
    document.addEventListener('scroll', auDefilement, true)
    // En capture aussi : un composant qui arrête la propagation d'un `pointermove` — une poignée
    // qu'on traîne — ne doit pas priver de barre le panneau qu'il occupe.
    document.addEventListener('pointermove', auMouvement, true)
    // Le pointeur qui sort de la fenêtre n'émet pas toujours un dernier mouvement dans la zone
    // qu'il quitte : sans cela, une barre pouvait rester en place après le départ de la souris.
    document.documentElement.addEventListener('pointerleave', auDepart)
    return () => {
      document.removeEventListener('scroll', auDefilement, true)
      document.removeEventListener('pointermove', auMouvement, true)
      document.documentElement.removeEventListener('pointerleave', auDepart)
      if (trameDemandee) cancelAnimationFrame(trameDemandee)
      for (const etat of etats.values()) {
        window.clearTimeout(etat.minuteur)
        for (const pouce of Object.values(etat.pouces)) pouce.remove()
      }
    }
  }, [])

  // `aria-hidden` : une barre de défilement n'est pas du contenu, et le clavier défile déjà sans
  // elle. L'annoncer ajouterait deux éléments muets au parcours de chaque panneau.
  return <div ref={couche} className={styles.couche} aria-hidden="true" />
}
