import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Icon } from '../../design/icons/Icon'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { SANS_CORRECTION } from '../../ui/Field/Field'
import styles from './BandeDeRecherche.module.css'
import { compterLesOccurrences } from './recherche'

type BandeDeRechercheProps = {
  vue: EditorView
  /**
   * S'abonne aux mises à jour de l'éditeur. La bande **lit** l'état de CodeMirror plutôt que d'en
   * tenir une copie : la requête vit dans le `searchState` de l'éditeur, que `⌘F` réécrit depuis la
   * sélection — deux vérités divergeraient au premier `⌘F` frappé bande ouverte.
   */
  abonner: (ecouteur: () => void) => () => void
}

/**
 * La bande de recherche et de remplacement de la console (#185), posée **en tête de l'éditeur**
 * comme un panneau CodeMirror (`search({ top: true, createPanel })`) et rendue ici par un portail.
 *
 * **Le moteur est celui de `@codemirror/search`, la bande est la nôtre.** Le moteur apporte ce
 * qu'il ne faut pas réécrire — la normalisation des caractères accentués, la casse, le surlignage
 * des occurrences visibles, le remplacement inscrit dans l'historique, donc `⌘Z`. Le panneau qu'il
 * fournit, lui, est un formulaire anglais en gris littéraux, avec trois cases à cocher que personne
 * n'a demandées : la bande reprend à la place la facture du champ de recherche du diagramme, le seul
 * autre du produit.
 *
 * **La frappe marque, `Entrée` emmène** — l'idiome du diagramme. Faire sauter la sélection à chaque
 * caractère ferait défiler l'éditeur sous les doigts.
 */
export function BandeDeRecherche({ vue, abonner }: BandeDeRechercheProps) {
  const t = useT()
  // `vue.state` change d'identité à chaque transaction et pas autrement : c'est exactement
  // l'instantané que `useSyncExternalStore` attend.
  const etat = useSyncExternalStore(abonner, () => vue.state)
  const requete = getSearchQuery(etat)
  const { total, rang, auDela } = compterLesOccurrences(etat, requete)
  const champ = useRef<HTMLInputElement>(null)

  // Le focus à l'ouverture. `openSearchPanel` le donnerait lui-même s'il trouvait le champ, mais le
  // portail n'est rendu qu'après le montage du panneau : au moment où CodeMirror le cherche, le
  // champ n'existe pas encore. Un `⌘F` frappé bande ouverte, lui, le trouve (`main-field`).
  useEffect(() => {
    champ.current?.focus()
    champ.current?.select()
  }, [])

  function modifier(changement: { search?: string; replace?: string }) {
    const suivante = new SearchQuery({
      search: requete.search,
      replace: requete.replace,
      caseSensitive: requete.caseSensitive,
      literal: requete.literal,
      regexp: requete.regexp,
      wholeWord: requete.wholeWord,
      ...changement,
    })
    if (!suivante.eq(requete)) vue.dispatch({ effects: setSearchQuery.of(suivante) })
  }

  // **`aria-disabled` et non `disabled`** : un bouton désactivé perd le focus qu'il portait — après
  // « Tout remplacer », il n'y a plus rien à trouver, et le focus tomberait sur le `body`, d'où ni
  // `Échap` ni `Tab` ne ramènent dans la bande. Et sa raison vit dans un `title` (piège n° 3).
  //
  // Les gestionnaires restent branchés, sans garde : sans occurrence, les quatre commandes de
  // `@codemirror/search` ne font rien d'elles-mêmes — et sur un champ vide, elles redonnent le
  // focus au champ, ce qui est la seule chose utile à faire.
  const rien = total === 0

  let compte: string | null = null
  if (requete.valid) {
    if (rien) compte = t('console.recherche.aucune')
    else if (auDela) compte = t('console.recherche.auDela', { total })
    else if (rang !== null) compte = t('console.recherche.position', { rang, total })
    else compte = t('console.recherche.compte', { total })
  }

  return (
    // **`Échap` ferme, d'où qu'on soit dans la bande**, et rend le focus à l'éditeur
    // (`closeSearchPanel` le fait quand le focus était dans le panneau). C'est l'inverse du champ du
    // diagramme, où `Échap` vide : une bande de recherche d'éditeur se ferme à `Échap` partout, et le
    // texte cherché reste là au prochain `⌘F`.
    // biome-ignore lint/a11y/useSemanticElements: `<search>` n'existe qu'à partir de Safari 17, et le plancher du produit est Safari 16.4 — l'élément y serait inconnu et le repère perdu.
    <div
      className={styles.bande}
      role="search"
      aria-label={t('console.recherche.bande')}
      onKeyDown={(evenement) => {
        if (evenement.key !== 'Escape') return
        evenement.preventDefault()
        closeSearchPanel(vue)
      }}
    >
      {/* Les deux groupes passent l'un sous l'autre quand la console est étroite — le panneau de
          transaction ouvert, par exemple —, la croix restant en haut à droite. */}
      <div className={styles.lignes}>
        <div className={styles.groupe}>
          {/* **Un `<div>` et non un `<label>`**, comme le champ du diagramme : une étiquette ne doit
            contenir aucun contenu interactif hors le champ qu'elle nomme. */}
          <div className={styles.champ}>
            <Icon name="search" size={12} strokeWidth={2} className={styles.icone} />
            <input
              {...SANS_CORRECTION}
              ref={champ}
              type="text"
              className={styles.saisie}
              value={requete.search}
              placeholder={t('console.recherche.champPlaceholder')}
              aria-label={t('console.recherche.champ')}
              // Le champ que `openSearchPanel` refocalise quand `⌘F` est frappé bande ouverte.
              main-field="true"
              onChange={(evenement) => modifier({ search: evenement.target.value })}
              onKeyDown={(evenement) => {
                if (evenement.key !== 'Enter') return
                evenement.preventDefault()
                ;(evenement.shiftKey ? findPrevious : findNext)(vue)
              }}
            />
            {/* `aria-live` : la valeur change sous la frappe, sans que le focus bouge. */}
            {compte !== null && (
              <span className={styles.compte} aria-live="polite">
                {compte}
              </span>
            )}
          </div>
          <button
            type="button"
            className={styles.bouton}
            aria-label={t('console.recherche.precedente')}
            title={rien ? t('console.recherche.rienATrouver') : t('console.recherche.precedente')}
            aria-disabled={rien || undefined}
            onClick={() => findPrevious(vue)}
          >
            <Icon name="asc" size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.bouton}
            aria-label={t('console.recherche.suivante')}
            title={rien ? t('console.recherche.rienATrouver') : t('console.recherche.suivante')}
            aria-disabled={rien || undefined}
            onClick={() => findNext(vue)}
          >
            <Icon name="desc" size={13} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.groupe}>
          <div className={styles.champ}>
            <input
              {...SANS_CORRECTION}
              type="text"
              className={styles.saisie}
              value={requete.replace}
              placeholder={t('console.recherche.remplacementPlaceholder')}
              aria-label={t('console.recherche.remplacement')}
              onChange={(evenement) => modifier({ replace: evenement.target.value })}
              onKeyDown={(evenement) => {
                if (evenement.key !== 'Enter' || evenement.shiftKey) return
                evenement.preventDefault()
                replaceNext(vue)
              }}
            />
          </div>
          <Button
            variant="secondary"
            size="xs"
            aria-disabled={rien || undefined}
            title={rien ? t('console.recherche.rienATrouver') : undefined}
            onClick={() => replaceNext(vue)}
          >
            {t('console.recherche.remplacer')}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            aria-disabled={rien || undefined}
            title={rien ? t('console.recherche.rienATrouver') : undefined}
            onClick={() => replaceAll(vue)}
          >
            {t('console.recherche.toutRemplacer')}
          </Button>
        </div>
      </div>
      <button
        type="button"
        className={styles.bouton}
        aria-label={t('console.recherche.fermer')}
        title={t('console.recherche.fermer')}
        onClick={() => closeSearchPanel(vue)}
      >
        <Icon name="x" size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
