import type { CSSProperties } from 'react'
import { dessinDeConnexion, teinteDeConnexion } from '../../data/iconesDeConnexion'
import { dessinDeDossier, ICONE_PAR_DEFAUT } from '../../data/iconesDeDossier'
import { Icon } from '../../design/icons/Icon'
import type { Database, Folder, FolderColor } from '../../domain/config'
import type { ConnectionState } from '../../domain/engine'
import { shellFr } from '../../i18n/dictionaries/shell'
import { useT } from '../../i18n/LanguageContext'
import type { Dictionnaire, Entree } from '../../i18n/types'
import { COULEURS_DE_DOSSIER } from '../../screens/NewConnection/environments'
import { Badge } from '../../ui/Badge/Badge'
import styles from './SelectionIndicator.module.css'

type SelectionIndicatorProps = {
  /**
   * Le chemin de dossiers de la sélection, par leurs noms, du plus extérieur au plus proche (#166).
   *
   * Il remplace le projet et l'environnement : ce sont les deux premiers dossiers d'une
   * configuration migrée. Un chemin long est **raccourci à gauche** — c'est la fin, le dossier le
   * plus proche, qui dit où l'on est.
   */
  chemin: readonly string[]
  /**
   * Le dossier le plus extérieur du chemin — le projet —, dont l'icône et la couleur précèdent le
   * chemin, comme sur sa ligne d'arbre (#183). Absent, le `pin` par défaut.
   */
  projet?: Pick<Folder, 'icon' | 'color'>
  /**
   * La connexion que le fil d'Ariane nomme : son icône précède son nom, avec la teinte de sa ligne
   * d'arbre — le logo de son moteur faute d'icône choisie (#179, #183).
   */
  base?: Pick<Database, 'icon' | 'engine' | 'color'>
  /**
   * La couleur du dossier coloré **le plus proche**, s'il y en a un — la pastille qui suit le
   * chemin. Absente, aucune pastille plutôt qu'un gris inventé.
   */
  couleur?: FolderColor | null
  /**
   * Le fil d'Ariane de la connexion ouverte : `analytics · public`. Absent quand rien n'est ouvert.
   */
  breadcrumb?: string
  /**
   * L'état de la connexion **ouverte**, qui donne le point de couleur.
   *
   * Un projet n'a pas d'état de connexion — ses connexions en ont. Absent, **aucun point** plutôt
   * qu'un point gris inventé.
   */
  connection?: ConnectionState
  /** Vrai quand la connexion ouverte est en lecture seule. */
  readOnly?: boolean
  /**
   * Le nombre de modifications en attente (`11b`). Au-dessus de zéro, l'indicateur porte le badge
   * « ÉDITION » et son point passe à l'ambre.
   *
   * **Le point change de sens, et c'est le mockup qui le dit** : `A5` le montre vert (connexion
   * ouverte), `A6` ambre — la même connexion. Il décrit donc l'état de l'**écran** quand il y a
   * quelque chose à signaler, et celui de la connexion sinon. Le badge lève l'ambiguïté sans
   * dépendre de la couleur, ce que `09d` exige déjà de ses quatre états.
   */
  pendingChanges?: number
}

/**
 * Ce que la barre de titre indique : le chemin de dossiers, ce qui est ouvert (`25b`, #166).
 *
 * # Un indicateur, plus un contrôle
 *
 * C'était `ProjectPill` : un `<button>` dans une boîte blanche bordée, avec un chevron, qui ouvrait
 * le menu des projets et bases. À sa droite, dans une seconde boîte, un sélecteur d'environnement.
 * Les deux sont partis — l'environnement se choisit désormais dans l'arbre, où il est un palier
 * (`25a`), et le menu des projets vit dans le « … » de la ligne projet.
 *
 * **La boîte blanche part avec le bouton.** Un encadré sur fond de barre est une affordance, et ce
 * dépôt a déjà tranché ce point exact en refusant un `Chip` inerte pour la cellule « Projet » de
 * `24` : un contrôle inerte se lit comme un contrôle en panne. D'autant que cette boîte *a été* un
 * bouton pendant tout le développement — la garder inviterait au clic qu'elle a longtemps accepté.
 *
 * # Ce qui reste, et pourquoi
 *
 * L'élision sur le nom **et** sur le fil d'Ariane : c'est ce qui empêche un nom long de pousser les
 * icônes d'action hors de la barre. `.center` ne peut pas s'en charger — un `overflow: hidden` y
 * découpait le menu projet (défaut du 10 août 2026), et même sans menu ce n'est pas au conteneur de
 * décider ce qu'on sacrifie.
 *
 * # Le chemin n'est pas capitalisé
 *
 * Les noms de dossier sont des chaînes de l'utilisateur, et « Pré-production » ne doit pas devenir
 * « PRÉ-PRODUCTION ». Le badge `PROD` des environnements est parti avec eux (#166) : ce qu'il
 * signalait est désormais la lecture seule, que la puce « Lecture seule » porte.
 *
 * # Aucun rôle, et surtout pas `role="status"`
 *
 * `status` est une région live implicite. La sélection changeant à **chaque flèche** dans l'arbre, un
 * lecteur d'écran énoncerait tout l'indicateur par-dessus l'annonce de la ligne en cours de
 * parcours : c'est le pire endroit du produit pour une région live.
 *
 * `role="group"` a été essayé, et écarté : ARIA le destine à un ensemble de **contrôles** — Biome le
 * signale d'ailleurs en proposant `<fieldset>`, ce qui serait faux pour une zone en lecture seule.
 * Cette zone n'est que du texte, lu dans l'ordre du document, et c'est exactement ce qu'un indicateur
 * doit être. Ce qui compte pour un lecteur d'écran, c'est que la couleur ne porte rien seule : d'où
 * les mentions masquées visuellement, ci-dessous.
 */
export function SelectionIndicator({
  chemin,
  projet,
  base,
  couleur = null,
  breadcrumb,
  connection,
  readOnly = false,
  pendingChanges = 0,
}: SelectionIndicatorProps) {
  const t = useT()
  const teinte = base === undefined ? undefined : teinteDeConnexion(base)
  return (
    <div className={styles.root}>
      {(connection || pendingChanges > 0) && (
        <span
          className={styles.dot}
          data-state={pendingChanges > 0 ? 'pending' : connection?.kind}
          aria-hidden="true"
        />
      )}
      {/* **Les dessins de l'arbre, par ses propres résolutions** (#183) : un `pin` fixe ne
          ressemblait ni au projet ni à la connexion dès que l'un d'eux avait choisi son icône. Sans
          couleur, le dossier garde la teinte de `.bag`, qui est celle de sa ligne. */}
      <Icon
        name={projet ? dessinDeDossier(projet) : ICONE_PAR_DEFAUT}
        size={12}
        strokeWidth={2}
        className={styles.bag}
        style={projet?.color ? { color: COULEURS_DE_DOSSIER[projet.color] } : undefined}
      />
      {/* **Raccourci à gauche** : le conteneur est en `rtl` pour que l'ellipse tombe au début, et le
          texte lui-même est isolé en `ltr` pour que la ponctuation ne se retourne pas. Les
          séparateurs sont du texte, donc le chemin se lit à voix haute tel qu'il s'écrit. */}
      <span className={styles.name}>
        <span className={styles.cheminTexte}>{chemin.join(' › ')}</span>
      </span>
      {couleur !== null && (
        // La couleur **arrive de la déclaration**, non d'un attribut lu par le CSS : une table de
        // teintes par identifiant serait une seconde source.
        <span
          className={styles.envDot}
          style={{ background: COULEURS_DE_DOSSIER[couleur] }}
          aria-hidden="true"
        />
      )}
      {breadcrumb && base && teinte && (
        <Icon
          name={dessinDeConnexion(base)}
          size={12}
          strokeWidth={2}
          className={styles.baseIcon}
          // Une couleur choisie teint le logo lui-même, comme sur la ligne d'arbre.
          style={
            {
              color: teinte.couleur,
              ...(teinte.teinterLeLogo ? { '--logo-tint': 'currentColor' } : {}),
            } as CSSProperties
          }
        />
      )}
      {breadcrumb && <span className={styles.breadcrumb}>{breadcrumb}</span>}
      {pendingChanges > 0 && (
        <Badge tone="warn" size="xs" icon={<Icon name="pencil" size={10} strokeWidth={2.6} />}>
          {t('shell.selectionIndicator.edition')}
        </Badge>
      )}
      {/* **« Lecture seule » disparaît en édition** : les deux badges côte à côte se
          contrediraient. Le mockup de `A6` met « ÉDITION » là où `A5` met « LECTURE SEULE ». */}
      {readOnly && pendingChanges === 0 && (
        <Badge tone="muted" size="xs" icon={<Icon name="lock" size={10} strokeWidth={2.4} />}>
          {t('shell.selectionIndicator.readOnly')}
        </Badge>
      )}
      {/* **L'état en texte masqué visuellement, pas en `aria-label` sur le point.**
          `aria-label` sur un `<span>` sans rôle est *ignoré* — Biome le signale, et il a raison.
          Le point étant une décoration, l'état a sa place dans le nom du groupe, que ce texte y
          ajoute. Un point vert et un point rouge sont de toute façon indiscernables pour une part
          des utilisateurs : la couleur renforce, elle ne porte pas.
          Les espaces sont explicites, faute de quoi les nœuds de texte se collent — le piège de
          `08a`, `09a` et `09c`. */}
      {connection && pendingChanges === 0 && (
        <span className={styles.srOnly}>{` ${libelleDeConnexion(connection, t)}`}</span>
      )}
      {pendingChanges > 0 && (
        <span className={styles.srOnly}>
          {t('shell.selectionIndicator.pendingChanges', { count: pendingChanges })}
        </span>
      )}
    </div>
  )
}

/** Résolution minimale d'un chemin par points, pour le repli français de `libelleDeConnexion`. */
function resoudre(dictionnaire: Dictionnaire, chemin: string): Entree | undefined {
  return chemin.split('.').reduce<Entree | Dictionnaire | undefined>((noeud, segment) => {
    if (noeud !== null && typeof noeud === 'object' && segment in noeud) {
      return (noeud as Dictionnaire)[segment]
    }
    return undefined
  }, dictionnaire) as Entree | undefined
}

/**
 * Repli quand `libelleDeConnexion` est appelée hors d'un composant — c'est le cas de son propre
 * test, qui l'appelle directement plutôt que de rendre `SelectionIndicator` (`resoudre` ne dépend
 * pas de `LanguageProvider`, donc ce repli reste utilisable sans lui).
 */
function tParDefaut(cle: string, parametres: Record<string, string | number> = {}): string {
  // `shellFr` est la racine du dictionnaire « shell » : le préfixe `shell.` que porte `useT()`
  // n'y a pas cours, d'où ce retrait avant résolution.
  const entree = resoudre(shellFr, cle.replace(/^shell\./, ''))
  if (entree === undefined) return cle
  return typeof entree === 'function' ? entree(parametres) : entree
}

/**
 * Le libellé d'un état de connexion.
 *
 * Les quatre états doivent se distinguer autrement que par la couleur. `arbre.ts` a son propre
 * `resumeEtat` — deux formulations, et c'est assumé : celle-ci nomme la version du serveur, dont une
 * ligne d'arbre n'a pas la place.
 */
export function libelleDeConnexion(
  etat: ConnectionState,
  t: (cle: string, parametres?: Record<string, string | number>) => string = tParDefaut,
): string {
  switch (etat.kind) {
    case 'never':
      return t('shell.selectionIndicator.status.never')
    case 'connecting':
      return t('shell.selectionIndicator.status.connecting')
    case 'connected':
      return t('shell.selectionIndicator.status.connected', { version: etat.serverVersion })
    case 'offline':
      return t('shell.selectionIndicator.status.offline', { reason: etat.reason })
  }
}
