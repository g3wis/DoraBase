import { type ReactNode, useEffect, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import { useT } from '../../i18n/LanguageContext'
import { cx } from '../../ui/cx'
import { PASSERELLE_FENETRE, type PasserelleFenetre } from '../fenetre'
import { estWindows, type Plateforme, plateforme } from '../plateforme'
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
   * `opacity .55` sur le logo. Écart consigné dans `AGENTS.md`.
   */
  dimmed?: boolean
  /**
   * Le centre de la barre : l'indicateur de sélection (`A4` → `A9`), posé **à droite du logo**
   * depuis `API-47` — les deux forment le groupe que la barre centre.
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
   * Les gestes de fenêtre des trois boutons Windows. Injectée pour la raison de
   * `PASSERELLE_ZOOM` : hors de la webview, `getCurrentWindow()` n'existe pas.
   */
  fenetre?: PasserelleFenetre
  /**
   * La plateforme, paramètre pour la même raison qu'ailleurs — `__APP_PLATFORM__` est figé à
   * la compilation, donc sans elle la barre Windows ne serait montée par aucun test.
   */
  sur?: Plateforme
}

/**
 * Les trois boutons que Windows ne dessine plus.
 *
 * # Pourquoi ils existent
 *
 * `titleBarStyle: "Overlay"` et `hiddenTitle` sont des clefs **macOS seulement** : sous Windows
 * elles ne font rien, et le système dessinerait sa propre barre **au-dessus** de la nôtre —
 * 72 px de chrome pour 40 px d'information, et le mot « DoraBase » deux fois. `decorations:
 * false` retire ce cadre, ce qui rend les trois boutons à notre charge. Ce sont les premiers
 * pixels inventés du projet ; la raison est consignée dans AGENTS.md.
 *
 * # Ce qui les distingue des feux de macOS
 *
 * Ils sont **à droite** (convention Windows), et ils sont à nous — donc, contrairement aux feux,
 * ils obéissent au CSS. Deux conséquences : `padding-left: 78px` n'a plus de raison d'être
 * (c'était le dégagement des feux, qui sont à gauche), et `dimmed` les ternit vraiment, ce que
 * le mockup demandait et que macOS refusait.
 *
 * # Le glyphe du bouton central suit l'état
 *
 * Carré quand la fenêtre est normale, deux carrés décalés quand elle est agrandie. Un bouton
 * qui annoncerait toujours « agrandir » mentirait une fois sur deux sur ce qu'il va faire.
 * L'état est relu à chaque `resize` : c'est le seul événement qui change la maximisation, y
 * compris par un double-clic sur la barre ou par `Win+↑`, que rien dans ce composant ne voit.
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
          du dépôt. C'est la convention Windows, et s'en écarter ferait chercher la fermeture.
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
// enfants — centre, actions — donc seule la bande de fond autour des feux répondait.
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
  const windows = estWindows(sur)
  return (
    <div
      className={cx(styles.root, windows && styles.rootWindows, dimmed && styles.dimmed)}
      data-tauri-drag-region="deep"
    >
      {/* **Le logo est au centre, et le mot « DoraBase » n'y est plus** (`API-47`, à la demande).
          Il vivait à gauche, apparié au wordmark, dans une zone que le dégagement des feux de macOS
          poussait déjà de 78 px : le nom y était dit une seconde fois, la barre d'état le portant
          déjà avec la version — et une barre de titre n'a pas à répéter le nom de la fenêtre.

          Il entre donc dans le centre, **avant** l'indicateur, et les deux ne font qu'un groupe que
          `.center` centre. Conséquence voulue, et c'est ce que « centrer un groupe de largeur
          variable » veut dire : le logo se déplace avec la longueur du fil d'Ariane. L'autre issue
          — le figer au milieu et laisser l'indicateur couler à sa droite — décentrerait l'indicateur,
          que le mockup centre.

          Il reste `aria-hidden` : c'est une décoration, et il l'était déjà quand le nom le
          nommait. Ce nom n'a pas disparu de l'arbre d'accessibilité pour autant — la barre d'état
          l'annonce, et la fenêtre le porte. */}
      <div className={styles.center}>
        <svg
          className={cx(styles.logo, dimmed && styles.logoDimmed)}
          viewBox="0 0 512 512"
          aria-hidden="true"
        >
          <use href="#logo" />
        </svg>
        {center}
      </div>
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
        {/* Après l'engrenage : les boutons de fenêtre sont **au bord**, comme partout sous
            Windows, et une action du produit ne doit pas se glisser entre eux. */}
        {windows && <BoutonsDeFenetre passerelle={fenetre} />}
      </div>
    </div>
  )
}
