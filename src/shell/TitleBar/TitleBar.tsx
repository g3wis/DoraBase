import { type ReactNode, useEffect, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { PASSERELLE_FENETRE, type PasserelleFenetre } from '../fenetre'
import { dessineSesBoutonsDeFenetre, type Plateforme, plateforme } from '../plateforme'
import styles from './TitleBar.module.css'

/*
 * **La barre n'a plus d'accès à la console** (26 août 2026). Le bouton était livré sans `onClick`
 * depuis le premier assemblage : cliquable, inerte, donc lisible comme une panne — c'est exactement
 * le défaut n° 36, dont l'engrenage voisin porte le remède en commentaire. Les consoles s'ouvrent
 * depuis le menu d'une connexion, qui est le palier qui connaît son contexte ; un bouton de barre
 * de titre aurait dû deviner pour laquelle. La prop `showConsole` part avec lui.
 */
type TitleBarProps = {
  /**
   * Ternit la barre quand une modale bloque la fenêtre — `A2` et `A3`.
   *
   * **Le mockup grise aussi les trois feux, ce qui n'est pas réalisable** :
   * `titleBarStyle: "Overlay"` les fait dessiner par macOS, hors d'atteinte du CSS, et le
   * système ne les ternit que sur perte de focus — qu'une modale interne ne provoque pas.
   * Les deux autres effets du mockup sont appliqués : `saturate(.6)` sur la barre et
   * `opacity .55` sur le wordmark. Écart consigné dans `AGENTS.md`.
   */
  dimmed?: boolean
  /**
   * Le centre de la barre : l'indicateur de sélection (`A4` → `A9`).
   *
   * Passé en contenu plutôt qu'en propriétés : `A1` n'en a aucun, les écrans de travail en ont un, et
   * son contenu a déjà changé deux fois. Une liste de propriétés grandirait à chaque écran là où un
   * contenu s'assemble chez l'appelant.
   *
   * **La prop `right` a disparu avec `25b`.** Elle n'avait qu'un appelant, le sélecteur
   * d'environnement, posé là le 19 août 2026 pour qu'il cesse de se déplacer avec la longueur du fil
   * d'Ariane. Le sélecteur parti, une prop sans appelant n'est qu'un emplacement que le prochain
   * écran remplira sans savoir pourquoi il existe.
   */
  center?: ReactNode
  /**
   * Ouvre les préférences (`15a`). Absent, l'engrenage reste **désactivé avec sa raison** — la règle
   * de `09f` : un bouton cliquable et inerte se lit comme une panne (défaut n° 36).
   *
   * **Depuis le 26 août 2026, aucun écran du produit ne le laisse absent** : `A1` le passait pas, et
   * son engrenage ne faisait rien. La galerie est le dernier appelant à monter la barre sans, d'où
   * une infobulle qui ne nomme plus d'écran — celui qu'elle nommait n'existe pas quand `A1` est à
   * l'écran. Un tel bouton désactivé dans le produit serait désormais un défaut.
   */
  onOpenPreferences?: () => void
  /**
   * Les gestes des trois boutons de fenêtre. Injectée pour la raison de `PASSERELLE_ZOOM` :
   * hors de la webview, `getCurrentWindow()` n'existe pas.
   */
  fenetre?: PasserelleFenetre
  /**
   * La plateforme, paramètre pour la même raison qu'ailleurs — `__APP_PLATFORM__` est figé à
   * la compilation, donc sans elle la barre hors macOS ne serait montée par aucun test.
   */
  sur?: Plateforme
}

/**
 * Les trois boutons que le système ne dessine plus, hors macOS.
 *
 * # Pourquoi ils existent
 *
 * `titleBarStyle: "Overlay"` et `hiddenTitle` sont des clefs **macOS seulement** : ailleurs
 * elles ne font rien, et le système dessinerait sa propre barre **au-dessus** de la nôtre —
 * 72 px de chrome pour 40 px d'information, et le mot « DoraBase » deux fois. `decorations:
 * false` retire ce cadre, ce qui rend les trois boutons à notre charge. Ce sont les premiers
 * pixels inventés du projet ; la raison est consignée dans AGENTS.md.
 *
 * # Windows et Linux les reçoivent à l'identique
 *
 * Ce n'est pas une économie : les deux systèmes placent la fermeture **au bord droit**, dans
 * cet ordre — GNOME et KDE comme Windows —, et les trois gestes passent par la même passerelle
 * Tauri. Un jeu de boutons par plateforme serait deux jeux à tenir en phase pour un rendu
 * identique.
 *
 * **Ce que Linux ajoute, et que rien ici ne voit** : `decorations: false` y retire aussi les
 * bordures de redimensionnement du gestionnaire de fenêtres. C'est tao qui les rend — une bande
 * de 5 px × facteur d'échelle testée à chaque clic, active **seulement** quand la fenêtre est
 * sans décoration, redimensionnable et non agrandie (`platform_impl/linux/event_loop.rs`, lu le
 * 4 septembre 2026). La fenêtre reste donc redimensionnable sans qu'on écrive une poignée, et
 * sans la permission `allow-start-resize-dragging`.
 *
 * # Ce qui les distingue des feux de macOS
 *
 * Ils sont **à droite**, et ils sont à nous — donc, contrairement aux feux, ils obéissent au
 * CSS. Deux conséquences : `padding-left: 78px` n'a plus de raison d'être (c'était le
 * dégagement des feux, qui sont à gauche), et `dimmed` les ternit vraiment, ce que le mockup
 * demandait et que macOS refusait.
 *
 * # Le glyphe du bouton central suit l'état
 *
 * Carré quand la fenêtre est normale, deux carrés décalés quand elle est agrandie. Un bouton
 * qui annoncerait toujours « agrandir » mentirait une fois sur deux sur ce qu'il va faire.
 * L'état est relu à chaque `resize` : c'est le seul événement qui change la maximisation, y
 * compris par un double-clic sur la barre, par `Win+↑` ou par une tuile du gestionnaire de
 * fenêtres, que rien dans ce composant ne voit.
 */
function BoutonsDeFenetre({ passerelle }: { passerelle: PasserelleFenetre }) {
  const t = useT()
  const [maximisee, setMaximisee] = useState(false)

  useEffect(() => {
    let vivant = true
    const relire = () => {
      // **Le rejet est avalé, et c'est voulu.** Hors de la webview il n'y a pas de fenêtre à
      // interroger ; le glyphe reste alors celui de « agrandir », qui est l'état de départ. Une
      // erreur en console à chaque montage de la galerie n'apprendrait rien à personne.
      passerelle
        .estMaximisee()
        .then((valeur) => {
          if (vivant) setMaximisee(valeur)
        })
        .catch(() => {})
    }
    relire()
    window.addEventListener('resize', relire)
    return () => {
      vivant = false
      window.removeEventListener('resize', relire)
    }
  }, [passerelle])

  return (
    <>
      <button
        type="button"
        className={styles.action}
        aria-label={t('shell.titleBar.reduire')}
        onClick={() => void passerelle.reduire().catch(() => {})}
      >
        <Icon name="wmin" size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={styles.action}
        aria-label={maximisee ? t('shell.titleBar.restaurer') : t('shell.titleBar.agrandir')}
        onClick={() => void passerelle.basculerMaximisation().catch(() => {})}
      >
        <Icon name={maximisee ? 'wrestore' : 'wmax'} size={15} strokeWidth={1.8} />
      </button>
      {/* **Le seul bouton du produit à porter un survol rouge**, et le cinquième état de survol
          du dépôt. C'est la convention de Windows comme des bureaux Linux, et s'en écarter
          ferait chercher la fermeture.
          Le rouge est `--hover-close`, dérivé de `--danger` : celui du produit, pas le #E81123
          de Microsoft, qui jurerait sur du papier crème. Consigné dans AGENTS.md. */}
      <button
        type="button"
        className={cx(styles.action, styles.fermer)}
        aria-label={t('shell.titleBar.fermer')}
        onClick={() => void passerelle.fermer().catch(() => {})}
      >
        <Icon name="x" size={15} strokeWidth={1.8} />
      </button>
    </>
  )
}

// `data-tauri-drag-region` rend la fenêtre déplaçable : sous `titleBarStyle: Overlay`
// (spec 01), macOS ne fournit plus de zone de glissement native.
//
// **La valeur `deep` est nécessaire, et l'attribut nu ne suffisait pas.** Le script de Tauri
// (`window/scripts/drag.js`) traite l'attribut nu comme « seuls les clics **directs** sur cet
// élément » : `el === composedPath[0]`. Or la barre est presque entièrement couverte par ses
// enfants — wordmark, centre, actions — donc seule la bande de fond autour des feux répondait.
// Constaté à l'usage le 10 août 2026, après avoir cru le problème réglé par la seule permission.
//
// `deep` étend le glissement au sous-arbre, et les éléments **cliquables** le bloquent
// d'eux-mêmes : le même script refuse de glisser dès qu'un `<button>`, `<select>` ou tout élément
// focalisable se trouve sur le chemin. Cliquer la pastille projet ou l'engrenage active donc le
// contrôle, sans déplacer la fenêtre — ce qui est le comportement voulu, et qu'il n'a pas fallu
// écrire.
export function TitleBar({
  dimmed = false,
  center,
  onOpenPreferences,
  fenetre = PASSERELLE_FENETRE,
  sur = plateforme(),
}: TitleBarProps) {
  const t = useT()
  const nosBoutons = dessineSesBoutonsDeFenetre(sur)
  return (
    <div
      className={cx(styles.root, nosBoutons && styles.rootNosBoutons, dimmed && styles.dimmed)}
      data-tauri-drag-region="deep"
    >
      <div className={cx(styles.wordmark, dimmed && styles.wordmarkDimmed)}>
        <svg className={styles.logo} viewBox="0 0 512 512" aria-hidden="true">
          <use href="#logo" />
        </svg>
        <span className={styles.name}>DoraBase</span>
      </div>
      {/* Le centre est **centré dans la barre**, pas simplement placé après le wordmark : le
          mockup l'enveloppe dans un `flex:1; justify-content:center`. Sans cela, la pastille
          collerait au logo et se déplacerait avec la longueur du fil d'Ariane. */}
      <div className={styles.center}>{center}</div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          aria-label={t('shell.titleBar.preferences')}
          onClick={onOpenPreferences}
          disabled={onOpenPreferences === undefined}
          title={
            onOpenPreferences === undefined
              ? t('shell.titleBar.preferencesDisabledTitle')
              : undefined
          }
        >
          <Icon name="gear" size={15} strokeWidth={1.8} />
        </button>
        {/* Après l'engrenage : les boutons de fenêtre sont **au bord**, comme partout hors de
            macOS, et une action du produit ne doit pas se glisser entre eux. */}
        {nosBoutons && <BoutonsDeFenetre passerelle={fenetre} />}
      </div>
    </div>
  )
}
