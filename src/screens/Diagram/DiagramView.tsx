import { type PointerEvent as PointerEventReact, useMemo, useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import { useT } from '../../i18n/LanguageContext'
import { toucheMajuscule } from '../../shell/plateforme'
import { cx } from '../../ui/cx'
import { SANS_CORRECTION } from '../../ui/Field/Field'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './DiagramView.module.css'
import {
  type Boite,
  cheminEntre,
  comptesDeLiens,
  disposition,
  type EntreeDeTable,
  type Etape,
  HAUTEUR_ENTETE,
  HAUTEUR_LIGNE,
  idDeTable,
  type Lien,
} from './disposition'

/**
 * Les paliers de zoom.
 *
 * **Des paliers et non un curseur continu** : ce qu'on demande à un diagramme est « tout voir » ou
 * « lire les noms », et deux boutons y mènent en un clic là où un curseur demande une visée. Le
 * plancher tient un schéma d'une trentaine de tables dans la fenêtre ; en dessous, plus rien ne se
 * lit, et une vue d'ensemble illisible n'est pas une vue d'ensemble.
 */
const PALIERS_DE_ZOOM = [0.4, 0.55, 0.7, 0.85, 1, 1.25, 1.5] as const
const ZOOM_NEUTRE = PALIERS_DE_ZOOM.indexOf(1)

export type DiagramViewProps = {
  schema: string
  /**
   * Les structures **déjà lues**. La vue dessine ce qu'elle a ; la barre d'état dit ce qui manque.
   *
   * Attendre le schéma entier laisserait l'écran vide pendant toute la lecture — une table par
   * aller-retour —, alors que les premières boîtes sont déjà utiles. C'est l'arbitrage de « l'arbre
   * se lit sans réseau » : montrer ce qu'on sait, marquer ce qu'on ignore.
   */
  tables: readonly EntreeDeTable[]
  /** Le nombre de tables du schéma, pour que la barre d'état dise ce qui reste à lire. */
  total: number
  loading?: boolean
  error?: string | null
  /**
   * Ouvre une table dans un onglet de données — double-clic sur une boîte, `Entrée` au clavier.
   *
   * Absent, la boîte reste sélectionnable : le diagramme sert alors à lire, ce qui est son premier
   * usage, et rien ne promet un geste qui ne répondrait pas (défaut n° 36).
   */
  onOuvrirLaTable?: (table: string) => void
}

/**
 * Le diagramme de structure d'un schéma : une boîte par table, un trait coudé par clé étrangère.
 *
 * # Ce qu'il ajoute à ce que le produit montrait déjà
 *
 * `A9` décrit **une** table, et son bloc « Relations » nomme celles qu'elle touche ; l'arbre liste
 * les tables sans jamais dire ce qui les relie. La forme d'un schéma — quelles tables sont au
 * centre, lesquelles sont des feuilles, où sont les cycles — n'était donc lisible nulle part, alors
 * que c'est la première question qu'on se pose devant une base qu'on ne connaît pas.
 *
 * # Pourquoi des boîtes en HTML et des liens en SVG
 *
 * Tout en SVG aurait demandé de réinventer ce que le navigateur donne : l'ellipse d'un nom trop
 * long, le survol, le focus, un rôle et un nom accessible. Or ces boîtes sont **cliquables** — un
 * diagramme dont on ne peut pas ouvrir une table est une image. Elles sont donc des éléments
 * ordinaires, posés aux coordonnées que `disposition` a calculées, et le SVG ne porte que ce que le
 * HTML ne sait pas dessiner : des traits coudés. C'est aussi ce qui rend le contenu vérifiable par
 * `getByRole` plutôt qu'en comptant des pixels.
 *
 * # Une table choisie, deux tables comparées
 *
 * Choisir **une** boîte éclaire les colonnes de ses clés, aux deux bouts : « qu'est-ce qui touche
 * `orders` ? ». Un `⇧`-clic en adjoint une **seconde**, et la bande écrit alors le plus court chemin
 * de clés entre les deux — l'autre question, celle qu'on se pose avant d'écrire une jointure, et que
 * rien dans le produit ne savait poser. Voir `BandeDeRelation`, qui porte les arbitrages.
 *
 * # Le zoom est à boutons, et c'est délibéré
 *
 * La molette **défile**, elle ne zoome pas, et il n'y a plus de geste qui zoome : `⌘` / `Ctrl` +
 * molette comme le pincement du trackpad sont refusés par `useRefusDuZoom` (`API-57`), l'application
 * n'ayant plus aucun zoom global. Les paliers d'ici sont donc les seuls du produit — et c'est ce que
 * le zoom d'une **vue** a de différent : il grossit un dessin, non l'écran qui l'entoure. Les rendre
 * explicites reste juste pour la raison d'origine : un second zoom sur les mêmes gestes ferait
 * dépendre l'échelle de qui écoute l'événement le premier.
 */
export function DiagramView({
  schema,
  tables,
  total,
  loading = false,
  error = null,
  onOuvrirLaTable,
}: DiagramViewProps) {
  const t = useT()
  /**
   * Montrer toutes les colonnes, ou l'aperçu.
   *
   * **Un interrupteur, et non plus un contrôle segmenté « Clés | Toutes ».** Les deux mots ne
   * disaient pas ce que le réglage *fait* : on lisait « Clés » comme un filtre sur une nature de
   * colonne, sans comprendre que des lignes étaient **masquées**. Un interrupteur nommé « Toutes les
   * colonnes » l'annonce par sa forme même — éteint, il en manque —, et la ligne « + n autres » de
   * chaque boîte dit combien. Rapporté à l'usage.
   */
  const [toutesLesColonnes, setToutesLesColonnes] = useState(false)
  const [palier, setPalier] = useState(ZOOM_NEUTRE)
  /**
   * Les tables choisies — **une, ou deux**, par identité et non par nom : c'est déjà celle que les
   * liens emploient, et en tenir une seconde forme aurait demandé de les traduire à chaque
   * comparaison.
   *
   * # Pourquoi deux et pas une
   *
   * Choisir **une** table éclaire ses voisines immédiates, ce qui répond à « qu'est-ce qui touche
   * `orders` ? ». La question qui restait sans réponse est l'autre : « qu'est-ce qui relie `orders`
   * à `shipment_batches` ? » — deux tables qu'aucune clé ne relie *directement*, donc le cas où
   * l'on ne sait pas répondre soi-même, et celui qu'on se pose avant d'écrire une jointure.
   *
   * # La première est l'ancre
   *
   * Un troisième `⇧`-clic remplace la **seconde**, jamais la première. C'est ce qui rend le geste
   * utile plus d'une fois : on garde `users` sous la main et l'on essaie l'une après l'autre les
   * tables dont on se demande comment elles s'y rattachent. Remplacer la première rendrait chaque
   * comparaison indépendante de la précédente, ce qui n'est jamais ce qu'on veut.
   */
  const [selection, setSelection] = useState<readonly string[]>([])
  /**
   * Ce qu'on cherche — un nom de table **ou** de colonne.
   *
   * Les deux, parce que ce sont les deux questions qu'on pose à un schéma : « où est `orders` ? » et
   * « qui porte un `deleted_at` ? ». La seconde n'avait aucune réponse dans le produit : l'arbre ne
   * filtre que des libellés, et la vue Structure ne cherche que dans **une** table.
   */
  const [recherche, setRecherche] = useState('')
  /** Le rang de la correspondance qu'`Entrée` amènera à l'écran — voir `allerA`. */
  const visee = useRef(0)
  /** Le champ lui-même : le vider par le bouton doit lui **rendre** le focus, non le lui prendre. */
  const champ = useRef<HTMLInputElement>(null)
  const toile = useRef<HTMLDivElement>(null)

  const vue = useMemo(
    () =>
      disposition(tables, {
        toutesLesColonnes,
        libelleDuReste: (compte) => t('diagram.boite.reste', { count: compte }),
      }),
    [tables, toutesLesColonnes, t],
  )

  const echelle = PALIERS_DE_ZOOM[palier] ?? 1

  /**
   * Ce que la recherche désigne : des tables, et les colonnes qui l'ont fait correspondre.
   *
   * # Depuis les structures, non depuis le dessin
   *
   * Les boîtes ne portent que les colonnes **visibles** — l'aperçu en masque au-delà de huit — et
   * chercher là-dedans aurait rendu « aucun résultat » pour une colonne qui existe. La recherche
   * porte donc sur `tables`, qui est la donnée complète ; c'est le rendu qui se contente de marquer
   * ce qu'il montre.
   *
   * **Conséquence assumée** : une table peut correspondre par une colonne que l'aperçu masque. Elle
   * est alors marquée sans qu'on voie pourquoi — et l'interrupteur « Toutes les colonnes » est juste
   * à côté. Le contraire, ne pas la marquer, serait taire une réponse juste.
   */
  const correspondances = useMemo(() => {
    const cherche = recherche.trim().toLowerCase()
    if (cherche === '') return { tables: new Set<string>(), colonnes: new Set<string>() }
    const trouvees = new Set<string>()
    const colonnes = new Set<string>()
    for (const table of tables) {
      const id = idDeTable(table.schema, table.name)
      if (table.name.toLowerCase().includes(cherche)) trouvees.add(id)
      for (const colonne of table.columns) {
        if (!colonne.name.toLowerCase().includes(cherche)) continue
        trouvees.add(id)
        colonnes.add(`${id}.${colonne.name}`)
      }
    }
    return { tables: trouvees, colonnes }
  }, [tables, recherche])

  /** Les tables trouvées, dans l'ordre du dessin : c'est celui qu'`Entrée` parcourt. */
  const trouvees = useMemo(
    () => vue.boites.filter((boite) => correspondances.tables.has(boite.id)),
    [vue.boites, correspondances],
  )
  const chercheQuelqueChose = recherche.trim() !== ''

  /**
   * Amène la correspondance suivante à l'écran.
   *
   * # Pourquoi `Entrée` et non la frappe
   *
   * Faire défiler à chaque caractère déplacerait le dessin sous les yeux de celui qui tape, et sur
   * une toile de plusieurs milliers de pixels c'est désorientant. La frappe **marque** donc, et
   * `Entrée` **emmène** : le compte affiché à côté du champ dit d'avance s'il y a quelque part où
   * aller. C'est le geste d'un « chercher » ordinaire.
   *
   * # Ce que jsdom ne peut pas voir
   *
   * `scrollIntoView` n'existe pas sans mise en page (règle n° 9) : ce que Vitest garde est le
   * marquage et le compte, et c'est un test de bout en bout qui vérifie que la vue se déplace.
   */
  function allerA(rang: number) {
    const boite = trouvees[((rang % trouvees.length) + trouvees.length) % trouvees.length]
    if (!boite) return
    // **Désigner d'abord, déplacer ensuite.** La désignation est ce que le geste *veut* — elle
    // allume les liens et les colonnes de la table trouvée — et le défilement n'en est que la
    // courtoisie. Dans l'autre ordre, un défilement qui échoue emporterait la désignation avec lui.
    // **Et elle repart d'une sélection simple.** `Entrée` emmène à une table, pas à une paire :
    // garder la comparaison en cours ferait afficher un chemin dont un bout n'est plus celui qu'on
    // regarde.
    setSelection([boite.id])
    const zone = toile.current
    const element = zone?.querySelector(`[data-boite="${CSS.escape(boite.table)}"]`)
    element?.scrollIntoView({ block: 'center', inline: 'center' })
  }

  /**
   * Le chemin de clés entre les deux tables choisies, quand il y en a deux et qu'il en existe un.
   *
   * `null` recouvre **deux** situations que le dessin ne distingue pas — moins de deux tables
   * choisies, ou deux tables qu'aucune suite de clés ne relie —, et c'est voulu : dans les deux cas,
   * le dessin retombe sur la marque d'une sélection simple. C'est la bande qui les sépare, parce que
   * c'est elle qui a des mots pour le faire.
   */
  const chemin = useMemo(
    () =>
      selection.length === 2
        ? cheminEntre(vue.liens, selection[0] as string, selection[1] as string)
        : null,
    [vue.liens, selection],
  )

  /** Les liens du chemin, et les tables qu'il traverse — deux marques distinctes, voir `Cadre`. */
  const liensDuChemin = useMemo(
    () => new Set((chemin ?? []).map((etape) => etape.lien.id)),
    [chemin],
  )
  const tablesDuChemin = useMemo(
    () => new Set((chemin ?? []).flatMap((etape) => [etape.de, etape.vers])),
    [chemin],
  )

  /**
   * Les liens, chacun avec son état, **dans l'ordre où il faut les peindre**.
   *
   * # Pourquoi un ordre, et pourquoi ici
   *
   * SVG n'a pas de `z-index` : il peint dans l'**ordre du document**. Un lien gris déclaré après un
   * lien accentué passe donc *par-dessus*, et sur un dessin où les traits se croisent cela arrive
   * tout le temps — rapporté à l'usage, « parfois un trait gris est rendu au-dessus d'un trait
   * surligné, pareil pour les flèches ».
   *
   * **Et c'est ce qui explique le signalement d'avant**, « le surlignage ne s'applique pas à la
   * marque » : deux liens qui partent de la même ligne de colonne posent leurs deux marques au même
   * pixel. La marque accentuée était bien là, et bien accentuée — le DOM le disait —, mais la grise
   * du lien voisin se peignait après, donc dessus. Chercher le défaut dans la couleur ou dans le
   * câblage ne pouvait rien donner : il n'était ni dans l'une ni dans l'autre.
   *
   * Trois rangs, du fond vers la surface : **éteint**, ordinaire, **accentué**. Les deux extrêmes
   * ont la même justification par les deux bouts — ce qu'une recherche efface ne doit pas recouvrir
   * ce qu'elle désigne, et ce qu'une sélection désigne ne doit rien avoir au-dessus.
   *
   * **Le tri est stable**, donc l'ordre de `vue.liens` — qui est déterministe, et sur lequel
   * reposent les couloirs de la disposition — survit à l'intérieur de chaque rang. Peindre n'est pas
   * disposer : rien ici ne déplace un trait, seul l'ordre de rendu change.
   */
  const liensAPeindre = useMemo(() => {
    const avecEtat = vue.liens.map((lien) => ({
      lien,
      /* **Quand un chemin existe, c'est lui qu'on accentue, et lui seul.** Sinon, tous les liens
         incidents à ce qui est choisi — ce que fait une sélection simple. */
      touche: chemin
        ? liensDuChemin.has(lien.id)
        : selection.includes(lien.source) || selection.includes(lien.cible),
      /* **Un lien s'éteint quand la recherche ne concerne aucun de ses bouts.** Sans cela, les
         traits gardent toute leur force au-dessus de boîtes éteintes et dominent le dessin —
         l'inverse de ce qu'une recherche doit produire. */
      eteint:
        chercheQuelqueChose &&
        !correspondances.tables.has(lien.source) &&
        !correspondances.tables.has(lien.cible),
    }))
    const rang = (e: (typeof avecEtat)[number]) => (e.eteint ? 0 : e.touche ? 2 : 1)
    return avecEtat.sort((a, b) => rang(a) - rang(b))
  }, [vue.liens, chemin, liensDuChemin, selection, chercheQuelqueChose, correspondances])

  /**
   * Les colonnes que la sélection met en évidence, **aux deux bouts de chaque lien**.
   *
   * Surligner les traits ne suffisait pas : ils disent *qu'*une table en référence une autre, pas
   * **par quelle colonne**, et c'est justement la question qu'on se pose en choisissant une boîte.
   * Marquer les deux bouts — la clé étrangère chez celle qui référence, la colonne référencée chez
   * l'autre — fait lire la relation d'un coup d'œil, sans suivre le trait jusqu'à sa pointe.
   *
   * **Un chemin resserre la marque sur lui seul.** Quand deux tables sont choisies et qu'une suite
   * de clés les relie, ce qu'on demande n'est plus « qu'est-ce qui touche cette table » mais « par
   * où passe-t-on » : garder en plus tous les liens incidents des deux bouts allumerait un hub comme
   * `users` en entier, au milieu duquel les deux ou trois colonnes de la réponse se perdraient.
   *
   * L'identité est `table.colonne`, celle des liens : deux tables du dessin peuvent avoir une
   * colonne `id`, et une clé indexée par le seul nom de colonne les allumerait toutes les deux.
   */
  const enEvidence = useMemo(() => {
    const marquees = new Set<string>()
    if (selection.length === 0) return marquees
    const retenus = chemin
      ? chemin.map((etape) => etape.lien)
      : vue.liens.filter(
          (lien) => selection.includes(lien.source) || selection.includes(lien.cible),
        )
    for (const lien of retenus) {
      for (const colonne of lien.colonnes) marquees.add(`${lien.source}.${colonne}`)
      for (const colonne of lien.colonnesCibles) marquees.add(`${lien.cible}.${colonne}`)
    }
    return marquees
  }, [selection, chemin, vue.liens])

  /**
   * Vide le champ de recherche.
   *
   * `rendreLeFocus` distingue les deux appelants, et ils ne veulent pas la même chose : le bouton et
   * `Échap` partent **du champ**, donc on doit pouvoir continuer d'y taper — un bouton qui garde le
   * focus après avoir effacé oblige à revenir au champ à la souris. Le `⇧`-clic, lui, part d'une
   * boîte : lui voler le focus déplacerait le clavier à l'autre bout de l'écran sans qu'on l'ait
   * demandé.
   */
  function viderLaRecherche(rendreLeFocus: boolean) {
    setRecherche('')
    // Le rang d'`Entrée` repart de zéro, comme à chaque frappe : le laisser au milieu d'une liste
    // qui n'existe plus ferait sauter la recherche suivante à un rang que personne ne connaît.
    visee.current = 0
    if (rendreLeFocus) champ.current?.focus()
  }

  /** Choisir une table, ou l'adjoindre à celle qui l'est déjà — voir `basculer`. */
  function choisir(id: string, etendre: boolean) {
    const suivante = basculer(selection, id, etendre)
    setSelection(suivante)
    /*
     * **Une paire éteint la recherche** (3 septembre 2026, rapporté à l'usage : « la relation est
     * partiellement masquée »).
     *
     * Les deux gestes emploient les mêmes canaux en sens contraire. Une recherche **efface** les
     * tables qu'elle ne désigne pas, et leurs liens avec elles ; or le chemin entre deux tables
     * passe justement par des tables qu'on n'a pas cherchées — elles arrivaient donc à 32 %
     * d'opacité, et la réponse était à moitié illisible au moment même où on la demandait. Marquer
     * le chemin plus fort n'aurait rien réglé : ce qui manque à une table éteinte est le contraste,
     * pas l'accent.
     *
     * **Seulement à la seconde table.** Une table choisie et une recherche coexistent très bien —
     * c'est même ce qu'`Entrée` produit, qui désigne la correspondance où il emmène. Effacer dès la
     * première rendrait donc ce parcours impossible : chaque `Entrée` viderait le champ qu'on vient
     * de remplir.
     */
    if (suivante.length === 2) viderLaRecherche(false)
  }

  /**
   * Le glissement du fond déplace la vue.
   *
   * **Depuis le fond seulement.** Un glissement qui partirait d'une boîte devrait distinguer un
   * déplacement d'un clic par un seuil de mouvement, et un seuil mal réglé fait rater soit les
   * clics, soit les déplacements. Le fond occupe l'essentiel de la toile, et la molette comme les
   * barres de défilement restent là pour le reste.
   *
   * **La cible se reconnaît par `data-boite`, pas par la classe.** Une classe de module CSS est un
   * nom engendré : l'employer dans un sélecteur ferait dépendre le geste de la façon dont l'outil
   * de construction la compose.
   */
  function auPointeur(evenement: PointerEventReact<HTMLDivElement>) {
    const zone = toile.current
    if (!zone) return
    if (evenement.target instanceof Element && evenement.target.closest('[data-boite]')) return
    const depart = {
      x: evenement.clientX,
      y: evenement.clientY,
      left: zone.scrollLeft,
      top: zone.scrollTop,
    }
    zone.setPointerCapture(evenement.pointerId)

    const bouger = (mouvement: PointerEvent) => {
      zone.scrollLeft = depart.left - (mouvement.clientX - depart.x)
      zone.scrollTop = depart.top - (mouvement.clientY - depart.y)
    }
    const lacher = () => {
      zone.releasePointerCapture(evenement.pointerId)
      zone.removeEventListener('pointermove', bouger)
      zone.removeEventListener('pointerup', lacher)
      zone.removeEventListener('pointercancel', lacher)
    }
    zone.addEventListener('pointermove', bouger)
    zone.addEventListener('pointerup', lacher)
    zone.addEventListener('pointercancel', lacher)
  }

  if (error) {
    return (
      <div className={styles.root}>
        <p className={styles.vide}>{error}</p>
      </div>
    )
  }
  if (vue.boites.length === 0) {
    return (
      <div className={styles.root}>
        {/* **« Aucune table » et « pas encore lu » ne sont pas le même état**, comme « jamais
            tentée » n'est pas « hors ligne » pour une connexion. Un schéma vide est un fait ; une
            lecture en cours est une attente, et elle dit où elle en est. */}
        <p className={styles.vide}>
          {total === 0 && !loading
            ? t('diagram.vide.aucuneTable', { schema })
            : t('diagram.vide.lecture', { lues: tables.length, total })}
        </p>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.barre}>
        {/* **`Toggle` de `ui/` et un libellé posé ici**, plutôt que le `ToggleWithLabel` de `A2` :
            celui-là habille l'interrupteur avec la feuille de style de son écran, et l'importer
            ferait dépendre le diagramme du CSS du formulaire de connexion. La raison pour laquelle
            le `<span>` n'est pas un `<label>` est la sienne, en revanche, et elle vaut ici : le nom
            accessible vient déjà de l'`aria-label` du bouton, et un `<label for>` sur un
            `role="switch"` le doublerait dans l'annonce. */}
        <span className={styles.reglage}>
          <Toggle
            checked={toutesLesColonnes}
            onCheckedChange={setToutesLesColonnes}
            label={t('diagram.colonnes.toutes')}
          />
          <span className={cx(styles.reglageNom, !toutesLesColonnes && styles.reglageNomEteint)}>
            {t('diagram.colonnes.toutes')}
          </span>
        </span>
        {/*
          **Le témoin de lecture, là où le regard est.**

          La barre d'état dit *où en est* la lecture — « 3 / 7 tables lues » — mais elle court sous
          les trois colonnes de l'écran, à vingt-six pixels du bas : on ne la regarde pas en
          attendant un dessin. Le témoin dit donc seulement **que** ça travaille, à côté du réglage,
          et laisse le compte à la barre. Les deux ne se répètent pas, ils répondent à deux
          questions.

          C'est la convention de la première animation du produit (`Toolbar`), à ceci près qu'aucun
          contrôle n'a été actionné : rien n'est donc à désactiver, et l'`aria-live` reste celui de
          la barre d'état — deux régions qui s'annoncent pour la même chose parleraient l'une sur
          l'autre.
        */}
        {loading && (
          <span className={styles.chargement}>
            <Icon name="refresh" size={12} strokeWidth={2} className={styles.tourne} />
            {t('diagram.chargement')}
          </span>
        )}
        {/* **Le champ suit l'idiome du fil d'Ariane** — même hauteur, même icône, même
            `SANS_CORRECTION` : macOS transformerait `orders` en `Orders` et la recherche ne
            trouverait plus rien.

            **Un `<div>` et non un `<label>`** : une étiquette ne doit contenir aucun contenu
            interactif hors le champ qu'elle nomme, et celle-ci en porte un depuis qu'un bouton la
            vide. Elle ne nommait de toute façon rien — l'`aria-label` du champ l'emporte sur le
            texte d'une étiquette englobante —, et c'est la forme qu'a déjà `SidebarFilterBar`, le
            premier champ de recherche du produit. Ce qui se perd est le clic sur la marge du cadre,
            qui donnait le focus ; ce qui s'évite est un clic sur le bouton que l'étiquette pourrait
            aussi vouloir transmettre au champ. */}
        <div className={styles.chercher}>
          <Icon name="search" size={12} strokeWidth={2} className={styles.chercherIcone} />
          <input
            {...SANS_CORRECTION}
            ref={champ}
            type="text"
            className={styles.chercherChamp}
            value={recherche}
            placeholder={t('diagram.recherche.placeholder')}
            aria-label={t('diagram.recherche.label')}
            onChange={(evenement) => {
              setRecherche(evenement.target.value)
              // Une frappe repart de la première correspondance : sans cela, `Entrée` reprendrait au
              // rang d'une recherche précédente, donc au milieu d'une liste que l'utilisateur ne
              // connaît pas.
              visee.current = 0
            }}
            onKeyDown={(evenement) => {
              // **`Échap` vide le champ**, comme dans tout champ du produit qui abandonne ce qu'on y
              // a tapé — la cellule de filtre, le renommage, le nom de projet. C'est le jumeau au
              // clavier du bouton voisin, au même endroit que lui.
              if (evenement.key === 'Escape' && recherche !== '') {
                evenement.preventDefault()
                viderLaRecherche(true)
                return
              }
              if (evenement.key !== 'Enter' || trouvees.length === 0) return
              evenement.preventDefault()
              allerA(visee.current)
              visee.current += 1
            }}
          />
          {/* **Le compte, et « aucune » quand il n'y a rien** : le champ ne doit pas laisser croire
              qu'il cherche encore. `aria-live` parce que la valeur change sous la frappe, sans que
              le focus bouge. */}
          {chercheQuelqueChose && (
            <span className={styles.chercherCompte} aria-live="polite">
              {trouvees.length === 0
                ? t('diagram.recherche.aucune')
                : t('diagram.recherche.compte', { count: trouvees.length })}
            </span>
          )}
          {/* **Il ne paraît que s'il y a de quoi vider.** Un bouton d'effacement au-dessus d'un
              champ vide est inerte, et un contrôle inerte mais actif se lit comme une panne
              (défaut n° 36) — le désactiver reviendrait au même sans le gain d'un pixel. */}
          {chercheQuelqueChose && (
            <button
              type="button"
              className={styles.chercherVider}
              aria-label={t('diagram.recherche.effacer')}
              onClick={() => viderLaRecherche(true)}
            >
              <Icon name="x" size={10} strokeWidth={2} />
            </button>
          )}
        </div>
        <span className={styles.espace} />
        <div className={styles.zoom}>
          <button
            type="button"
            className={styles.bouton}
            aria-label={t('diagram.zoom.moins')}
            disabled={palier === 0}
            onClick={() => setPalier((rang) => Math.max(0, rang - 1))}
          >
            <span aria-hidden="true">−</span>
          </button>
          {/* Le pourcentage **est** le bouton du retour à l'échelle 1 : un troisième bouton pour
              une valeur déjà affichée aurait pris de la place pour la répéter. */}
          <button
            type="button"
            className={styles.echelle}
            aria-label={t('diagram.zoom.reinitialiser', { pourcentage: Math.round(echelle * 100) })}
            onClick={() => setPalier(ZOOM_NEUTRE)}
          >
            {Math.round(echelle * 100)} %
          </button>
          <button
            type="button"
            className={styles.bouton}
            aria-label={t('diagram.zoom.plus')}
            disabled={palier === PALIERS_DE_ZOOM.length - 1}
            onClick={() => setPalier((rang) => Math.min(PALIERS_DE_ZOOM.length - 1, rang + 1))}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>

      {/* **La bande paraît à la première table choisie, et pas avant.** Elle porte deux choses qui
          n'ont de sens qu'alors : ce qui relie les deux tables, et — tant qu'il n'y en a qu'une — le
          geste qui en désigne une seconde. Un `⇧`-clic ne s'annonce nulle part ailleurs, et un geste
          qu'on ne peut pas deviner n'existe pas. */}
      {selection.length > 0 && (
        <BandeDeRelation
          boites={vue.boites}
          selection={selection}
          chemin={chemin}
          // Le dessin est incomplet tant que toutes les tables du schéma n'y sont pas — lecture en
          // cours, ou plafond qui mord. « Aucun chemin » ne peut pas alors vouloir dire « aucun dans
          // la base » : la bande le dit autrement.
          partiel={tables.length < total}
          onEffacer={() => setSelection([])}
        />
      )}

      {/* **Un `pointerdown` sur un élément sans rôle, et sans suppression de règle.** Biome ne s'en
          plaint pas — la règle ne couvre pas les événements de pointeur —, et une suppression posée
          « au cas où » avait été signalée comme inutile. Le fait qui compte est que ce geste
          **double** le défilement plutôt que de le remplacer : la zone est atteignable par sa barre
          de défilement et les flèches l'y déplacent, donc rien n'est réservé à la souris. Un
          `role="application"` avalerait au contraire les touches du navigateur. */}
      <div className={styles.toile} data-toile="" ref={toile} onPointerDown={auPointeur}>
        {/* Deux cadres, et il en faut deux : `transform` ne change pas la place qu'un élément
            occupe dans la mise en page, donc la zone défilante ne verrait rien du zoom. Celui de
            l'extérieur porte la taille mise à l'échelle, celui de l'intérieur les coordonnées du
            calcul — ce qui garde `disposition` indépendante de l'échelle. */}
        <div
          className={styles.cadre}
          style={{ width: vue.largeur * echelle, height: vue.hauteur * echelle }}
        >
          <div
            className={styles.plan}
            style={{
              width: vue.largeur,
              height: vue.hauteur,
              transform: echelle === 1 ? undefined : `scale(${echelle})`,
            }}
          >
            {/* `data-liens` plutôt que la classe : celle d'un module CSS est un nom engendré, et
                un test qui s'y accrocherait mesurerait l'outil de construction. Le repère existe
                pour la même raison que `data-boite`. */}
            <svg
              className={styles.liens}
              data-liens=""
              width={vue.largeur}
              height={vue.hauteur}
              aria-hidden="true"
            >
              {liensAPeindre.map(({ lien, touche, eteint }) => {
                const etat = cx(touche && styles.lienChoisi, eteint && styles.lienEteint)
                return (
                  <g key={lien.id}>
                    <path
                      /* Le repère par lequel un test désigne un trait : une classe de module CSS
                         est un nom engendré, et s'y accrocher mesurerait l'outil de construction.
                         Même raison que `data-boite` et `data-colonne`. */
                      data-lien={lien.id}
                      d={lien.chemin}
                      className={cx(styles.lien, etat)}
                    />
                    {/* **La cardinalité se marque au *départ*, la flèche reste à l'arrivée.** Le
                        côté référencé est toujours *un* — une clé étrangère ne peut viser que des
                        colonnes uniques —, donc il n'y a qu'un bout où il y ait quelque chose à
                        dire. Et la pointe qui donne le sens du lien n'est pas déplaçable : une
                        flèche qui disparaît est un lien qui ne dit plus où il va. */}
                    <path
                      data-marque={lien.cardinalite === 'one' ? 'one' : 'many'}
                      data-marque-lien={lien.id}
                      d={
                        lien.cardinalite === 'one'
                          ? barreDeUn(lien.depart, lien.sensDepart)
                          : demiCercleDePlusieurs(lien.depart, lien.sensDepart)
                      }
                      className={cx(styles.lien, styles.pointe, etat)}
                    />
                    <path
                      data-marque="fleche"
                      data-marque-lien={lien.id}
                      d={pointeDeFleche(lien.arrivee, lien.sensArrivee)}
                      className={cx(styles.lien, styles.pointe, etat)}
                    />
                  </g>
                )
              })}
            </svg>
            {vue.boites.map((boite) => (
              <Cadre
                key={boite.id}
                boite={boite}
                liens={vue.liens}
                choisie={selection.includes(boite.id)}
                // Une table que le chemin **traverse** sans qu'on l'ait désignée : c'est la réponse
                // à « par où passe-t-on », et elle doit se distinguer des deux bouts qu'on a choisis.
                surLeChemin={tablesDuChemin.has(boite.id) && !selection.includes(boite.id)}
                enEvidence={enEvidence}
                trouvee={correspondances.tables.has(boite.id)}
                eteinte={chercheQuelqueChose && !correspondances.tables.has(boite.id)}
                colonnesTrouvees={correspondances.colonnes}
                onChoisir={(etendre) => choisir(boite.id, etendre)}
                onEffacer={() => setSelection([])}
                onOuvrir={onOuvrirLaTable}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function BandeDeRelation({
  boites,
  selection,
  chemin,
  partiel,
  onEffacer,
}: {
  boites: readonly Boite[]
  /** Une ou deux identités de tables — voir `selection` chez l'appelant. */
  selection: readonly string[]
  chemin: readonly Etape[] | null
  /**
   * Le dessin ne contient pas encore tout le schéma — lecture en cours, ou plafond qui mord.
   *
   * **« Aucun chemin » ne peut alors pas vouloir dire « aucun dans la base »** : le chemin passe
   * peut-être par une table qui n'est pas là. C'est la même honnêteté que les deux nombres de la
   * barre d'état — un diagramme amputé en silence se lirait comme un schéma complet.
   */
  partiel: boolean
  onEffacer: () => void
}) {
  const t = useT()
  const nomDe = (id: string) => boites.find((boite) => boite.id === id)?.table ?? id
  const [premiere, seconde] = selection

  return (
    <div className={styles.relation} role="status" aria-label={t('diagram.relation.ariaLabel')}>
      <Icon name="link" size={12} strokeWidth={2} className={styles.relationIcone} />
      <div className={styles.relationTexte}>
        {premiere === undefined ? null : seconde === undefined ? (
          t('diagram.relation.invite', { table: nomDe(premiere), maj: toucheMajuscule() })
        ) : chemin === null ? (
          t(partiel ? 'diagram.relation.aucunePartielle' : 'diagram.relation.aucune', {
            a: nomDe(premiere),
            b: nomDe(seconde),
          })
        ) : (
          <>
            {chemin.length === 1
              ? t('diagram.relation.directe')
              : t('diagram.relation.indirecte', { count: chemin.length })}
            {chemin.map((etape) => {
              // Le lien va de `source` vers `cible` ; l'étape va de `de` vers `vers`. Quand elle
              // **remonte** la clé, les deux ordres sont inverses, et c'est la flèche qui le dit —
              // pas l'ordre de lecture, qui reste celui du chemin.
              const gauche = etape.remonte ? etape.lien.colonnesCibles : etape.lien.colonnes
              const droite = etape.remonte ? etape.lien.colonnes : etape.lien.colonnesCibles
              return (
                <span key={etape.lien.id}>
                  {/* Le point porte ses espaces : sans elles, la voix rendrait
                      « users.idorders.user_id » (piège n° 1). C'est le séparateur du pied. */}
                  <span className={styles.relationPoint}>{' · '}</span>
                  <code className={styles.bout}>{qualifier(nomDe(etape.de), gauche)}</code>
                  <span className={styles.fleche} data-fleche="" aria-hidden="true">
                    {etape.remonte ? '←' : '→'}
                  </span>
                  <span className={styles.pourLaVoix}>
                    {t(
                      etape.remonte
                        ? 'diagram.relation.referenceePar'
                        : 'diagram.relation.reference',
                    )}
                  </span>
                  {/* **La notation, à côté de la flèche qu'elle qualifie.** C'est ce qui manque le
                      plus quand on lit un chemin pour écrire une jointure : deux sauts `1:1` rendent
                      une ligne, un seul `1:n` en rend autant que la table du milieu en compte. La
                      voix la reçoit en toutes lettres, avec ses espaces (piège n° 1). */}
                  {/* Les deux repères par lesquels un test mesure l'air autour de la notation :
                      une classe de module CSS est un nom engendré, et s'y accrocher mesurerait
                      l'outil de construction. Même raison que `data-boite` et `data-lien`. */}
                  <span className={styles.notation} data-notation="" aria-hidden="true">
                    {etape.lien.cardinalite === 'one' ? '1:1' : '1:n'}
                  </span>
                  <span className={styles.pourLaVoix}>
                    {t(
                      `diagram.cardinalite.${etape.lien.cardinalite === 'one' ? 'unVoix' : 'plusieursVoix'}`,
                    )}
                  </span>
                  <code className={styles.bout}>{qualifier(nomDe(etape.vers), droite)}</code>
                </span>
              )
            })}
          </>
        )}
      </div>
      {/* Le bouton du zoom, réemployé : même cote, même bordure, même survol — celui du bouton
          secondaire. Il existe parce que les boîtes choisies peuvent être hors de l'écran, et qu'on
          ne devrait pas avoir à les retrouver pour rendre le dessin au repos. `Échap` sur une boîte
          fait la même chose au clavier. */}
      <button
        type="button"
        className={styles.bouton}
        aria-label={t('diagram.relation.effacer')}
        onClick={onEffacer}
      >
        <Icon name="x" size={11} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * Ce que devient la sélection quand on désigne `id`.
 *
 * **Trois règles, et la bascule est ce qui rend `aria-pressed` honnête des deux côtés** : le même
 * geste doit pouvoir relâcher ce qu'il vient de désigner. `⇧` étend — c'est le geste d'extension
 * partout ailleurs —, et la première choisie reste l'**ancre** : un troisième `⇧`-clic remplace la
 * seconde, pour la raison écrite sur `selection`.
 *
 * Pure, et hors du composant : c'est la seule part de ce geste qui se raisonne sans rendu.
 */
function basculer(selection: readonly string[], id: string, etendre: boolean): readonly string[] {
  if (!etendre) return selection.length === 1 && selection[0] === id ? [] : [id]
  if (selection.includes(id)) return selection.filter((autre) => autre !== id)
  if (selection.length === 0) return [id]
  return [selection[0] as string, id]
}

/**
 * Une colonne nommée par sa table : `orders.user_id`.
 *
 * **Une clé composite garde ses colonnes groupées** — `orders.(tenant_id, id)`. Sans les
 * parenthèses, `orders.tenant_id, id` laisserait croire à deux bouts dont le second n'a pas de
 * table, ce qui est faux et se lit mal.
 */
function qualifier(table: string, colonnes: readonly string[]): string {
  if (colonnes.length > 1) return `${table}.(${colonnes.join(', ')})`
  return `${table}.${colonnes[0] ?? ''}`
}

/*
 * ============================================================================================
 * Les marques : des `<path>` ordinaires, et non des `<marker>` SVG
 * ============================================================================================
 *
 * **Pourquoi elles ont cessé d'être des `marker`** (4 septembre 2026, rapporté à l'usage : « le
 * demi-cercle reste surligné pour toujours, alors qu'il ne devrait pas ; pareil pour la flèche »,
 * puis « ça n'arrive pas toujours »).
 *
 * Un `marker` vit dans `<defs>` et se référence par `marker-start` / `marker-end`. Le dessin en
 * avait deux exemplaires par forme — l'ordinaire et l'accentué — et chaque trait basculait sa
 * *référence* d'un exemplaire à l'autre selon qu'il était choisi. Le DOM était juste dans tous les
 * états, mesuré sur toutes les sélections du décor ; **la webview de l'application, elle, gardait le
 * dessin précédent** — donc l'accent restait, par intermittence.
 *
 * Rien de tout cela ne se reproduit sous Chromium, sans tête comme avec : le seul endroit où le
 * défaut existe est WKWebView, que rien de cet outillage ne pilote (voir « Ce que l'outillage ne
 * peut pas voir »). **Le fait qui a tranché** est que les *traits*, eux, se repeignaient
 * correctement — seules les marques ne suivaient pas. Alors les marques deviennent des traits :
 * trois `<path>` par lien, avec les classes du trait, dans le même `<g>` que lui. Il n'y a plus de
 * ressource `marker` à invalider, donc plus de famille de défaut à laquelle échapper — et non un
 * contournement d'un bogue qu'on ne sait pas mesurer.
 *
 * Quatre choses gagnées au passage, et c'est ce qui rend l'échange favorable même sans le défaut :
 *
 * - **l'égalité d'encre et d'épaisseur devient structurelle.** Une marque porte `styles.lien` et
 *   l'état du trait, donc *les mêmes déclarations* — non deux valeurs qu'il fallait tenir en phase à
 *   la main, ce qui avait déjà coûté deux signalements ;
 * - **le piège de `markerUnits` disparaît avec la cause.** La boîte d'un `marker` se compte en
 *   multiples de l'épaisseur du trait marqué, ce qui rendait fausses toutes les cotes qu'on croyait
 *   poser en pixels. Un `<path>` est en pixels de toile, sans réglage ;
 * - **l'ordre de peinture est celui du `<g>`.** Une marque ne peut plus se retrouver au-dessus d'un
 *   trait accentué : elle voyage avec le sien ;
 * - **une marque devient mesurable.** Un `marker` dans `<defs>` n'a pas de boîte englobante — un
 *   test ne pouvait donc constater que sa *déclaration*, jamais qu'elle avait peint quelque part.
 *
 * Ce qui se perd est `orient="auto"`, qui donnait l'angle. Le tracé étant orthogonal, un bout est
 * toujours horizontal : `Lien.sensDepart` et `Lien.sensArrivee` valent `+1` ou `-1`, et les trois
 * fonctions ci-dessous s'en servent pour se retourner. Aucune rotation à composer.
 *
 * **Les cotes sont celles des `marker` qu'elles remplacent**, à l'unité près : elles y étaient
 * exprimées dans une `viewBox` de 13 à l'échelle 1, donc déjà en pixels, l'ancre tombant à
 * `(0, 6.5)` pour les deux marques de départ et à `(10.5, 6.5)` pour la flèche. Ici l'ancre est
 * l'origine, et les cotes sont comptées depuis elle.
 */

/**
 * Le demi-cercle du côté « plusieurs », posé au départ du lien.
 *
 * **Il dit la notation entité-association sans en reprendre le dessin.** Ce que la notation exige
 * est qu'un bout de lien se distingue de l'autre et qu'on sache lequel se multiplie ; la patte
 * d'oie est *une* façon de le dire, pas la seule. Le demi-cercle en est une autre, et c'est celle
 * qui s'accorde à ce dessin-ci : son diamètre s'appuie à plat contre le bord de la boîte, son arc
 * s'ouvre le long du lien, et il n'a **aucun angle** — là où tout le reste du tracé est fait de
 * coudes arrondis, la courbe ayant été bannie des liens eux-mêmes pour qu'ils se distinguent les
 * uns des autres.
 *
 * # Quatre dessins avant celui-ci (rapporté à l'usage, à chaque tour)
 *
 * 1. trois segments droits convergents, la patte d'oie canonique : trois angles vifs au bord de
 *    chaque boîte, le seul endroit anguleux du dessin ;
 * 2. des dents parallèles ramenées par une **traverse** d'angle droit : un crochet, les dents
 *    faisant à peine une épaisseur de trait ;
 * 3. des dents **cintrées** convergeant sans partie droite : un double chevron, le raccord prenant
 *    plus de place que les dents ;
 * 4. le demi-cercle. Une seule commande d'arc, aucun raccord à proportionner, et rien qui puisse se
 *    confondre avec son propre trait.
 *
 * Les deux échecs du milieu avaient la même cause, et elle n'était pas dans le tracé : la boîte de
 * la marque était plus petite qu'on ne le croyait, à cause de `markerUnits` — **on ne règle pas des
 * proportions dans une unité qu'on ignore**. Et rien de tout cela ne se voit autrement qu'à la
 * loupe : la seule mesure qui juge est une capture à `deviceScaleFactor: 6`, **regardée**.
 *
 * La corde va de `-5` à `+5`, donc dix pixels : le rayon est de cinq et l'arc culmine à cinq pixels
 * du bord. Écrire un rayon plus grand que la moitié de la corde ne lèverait rien — SVG l'agrandit
 * en silence jusqu'à ce qu'un arc soit possible, et le demi-cercle deviendrait un arc quelconque
 * sans qu'on sache pourquoi.
 */
function demiCercleDePlusieurs(ancre: { x: number; y: number }, sens: -1 | 1): string {
  // Le drapeau de balayage porte le retournement : à sens inverse, l'arc doit bomber de l'autre
  // côté de sa corde, et une corde verticale ne se retourne pas autrement.
  const balayage = sens === 1 ? 1 : 0
  return `M${ancre.x} ${ancre.y - 5} A5 5 0 0 ${balayage} ${ancre.x} ${ancre.y + 5}`
}

/**
 * La barre du côté « un », posée au départ du lien.
 *
 * L'autre moitié de la même notation : une barre perpendiculaire dit « une seule ligne ici ».
 * **Elle n'est pas l'absence de demi-cercle** — un lien sans marque se lirait comme un lien qu'on
 * n'a pas su qualifier, et les deux valeurs de `RelationCardinality` sont toutes deux des réponses.
 */
function barreDeUn(ancre: { x: number; y: number }, sens: -1 | 1): string {
  const x = ancre.x + sens * 4
  return `M${x} ${ancre.y - 4.5} L${x} ${ancre.y + 4.5}`
}

/**
 * La pointe d'un lien : un chevron **en trait**, comme toutes les icônes du projet.
 *
 * La pointe tombe *sur* l'ancre — le bord de la boîte visée — et les deux branches partent en
 * arrière, à contre-courant : c'est l'ancre qui désigne l'endroit où la flèche arrive, pas celui
 * où elle commence.
 */
function pointeDeFleche(ancre: { x: number; y: number }, sens: -1 | 1): string {
  const arriere = ancre.x - sens * 5.5
  return `M${arriere} ${ancre.y - 3.1} L${ancre.x} ${ancre.y} L${arriere} ${ancre.y + 3.1}`
}

/**
 * Une table dessinée.
 *
 * **Un `role="button"` sur un `div`, plutôt qu'un vrai `<button>`** : le contenu d'un bouton doit
 * être du contenu de phrasé, et une boîte est une pile de lignes. Le rôle porté explicitement donne
 * la même sémantique — et c'est lui qui rend `aria-label` opérant, un `aria-label` sur un élément
 * sans rôle étant ignoré (piège n° 2). Même arbitrage que `Chip`, pour la même raison.
 *
 * **Le nom accessible vient d'`aria-label`, non du contenu.** Concaténé, celui-ci rendrait
 * « ordersidint8placed_attimestamptz… » : le piège n° 1 dans sa forme extrême, qu'aucune espace
 * explicite n'arrangerait — ce ne sont pas les espaces qui manquent, c'est un nom. Il dit donc ce
 * que la boîte *est* : une table, son compte de colonnes, son compte de liens. Les colonnes se
 * lisent à l'intérieur.
 */
function Cadre({
  boite,
  liens,
  choisie,
  surLeChemin,
  enEvidence,
  trouvee,
  eteinte,
  colonnesTrouvees,
  onChoisir,
  onEffacer,
  onOuvrir,
}: {
  boite: Boite
  liens: readonly Lien[]
  choisie: boolean
  /** Le chemin entre les deux tables choisies traverse celle-ci, sans qu'on l'ait désignée. */
  surLeChemin: boolean
  /** Les `table.colonne` que la sélection éclaire — voir `enEvidence` chez l'appelant. */
  enEvidence: ReadonlySet<string>
  /** La recherche désigne cette table. */
  trouvee: boolean
  /** Une recherche est en cours et ne la désigne pas. */
  eteinte: boolean
  /** Les `table.colonne` que la recherche a fait correspondre. */
  colonnesTrouvees: ReadonlySet<string>
  /** `etendre` : le geste portait `⇧`, donc il **adjoint** au lieu de remplacer. */
  onChoisir: (etendre: boolean) => void
  onEffacer: () => void
  onOuvrir?: (table: string) => void
}) {
  const t = useT()
  const attaches = liens.filter((lien) => lien.source === boite.id || lien.cible === boite.id)
  /** Ce qu'une colonne de cette table référence, quand elle référence quelque chose. */
  const cibleDe = (column: string) =>
    liens.find((lien) => lien.source === boite.id && lien.colonnes.includes(column))

  return (
    // biome-ignore lint/a11y/useSemanticElements: un <button> n'accepte pas une pile de lignes, voir ci-dessus
    <div
      role="button"
      tabIndex={0}
      data-boite={boite.table}
      className={cx(
        styles.boite,
        choisie && styles.boiteChoisie,
        /* **Traversée n'est pas choisie**, et les deux se lisent ensemble : l'anneau d'accent dit
           « ce chemin passe par ici », l'en-tête teinté dit « c'est une des deux que j'ai
           désignées ». La bande nomme les trois par écrit — une couleur seule ne porte jamais une
           information. */
        surLeChemin && styles.boiteSurLeChemin,
        /* **La marque de recherche et la sélection sont deux choses**, et se distinguent par leur
           teinte : `--info` pour ce qu'on a cherché, l'accent pour ce qu'on a désigné. Une seule
           couleur pour les deux aurait fait lire « trouvée » comme « choisie », alors qu'`Entrée`
           fait bel et bien les deux à la fois. */
        trouvee && styles.boiteTrouvee,
        eteinte && styles.boiteEteinte,
      )}
      style={{ left: boite.x, top: boite.y, width: boite.width, height: boite.height }}
      aria-label={t('diagram.boite.label', {
        table: boite.table,
        colonnes: boite.lignes.filter((ligne) => ligne.sorte === 'colonne').length,
        liens: attaches.length,
      })}
      aria-pressed={choisie}
      /* **`detail === 1`, et ce n'est pas une précaution.** Un double-clic émet *deux* clics avant
         le sien : sans cette garde, la bascule jouait deux fois, si bien que la boîte qu'on venait
         d'ouvrir repartait **non choisie** et que le surlignage de ses liens s'allumait puis
         s'éteignait le temps d'un rendu. Avec elle, seul le premier clic compte : la table s'ouvre
         et la boîte reste choisie, ce qu'on attend de ce qu'on vient de désigner. Mesuré en
         écrivant le test — c'est lui qui a dit lequel des deux comportements sortait. */
      onClick={(evenement) => {
        if (evenement.detail > 1) return
        onChoisir(evenement.shiftKey)
      }}
      onDoubleClick={() => onOuvrir?.(boite.table)}
      onKeyDown={(evenement) => {
        // **`Entrée` ouvre, `Espace` choisit, `⇧Espace` adjoint.** Le double-clic et le `⇧`-clic
        // sont les gestes de la souris ; un geste qui n'existerait qu'à la souris serait invisible
        // et inatteignable au clavier, ce que le renommage des consoles a déjà tranché — et la
        // comparaison de deux tables, qui est tout l'intérêt du second, le mérite d'autant plus.
        if (evenement.key === 'Enter') {
          evenement.preventDefault()
          onOuvrir?.(boite.table)
        }
        if (evenement.key === ' ') {
          evenement.preventDefault()
          onChoisir(evenement.shiftKey)
        }
        // `Échap` rend le dessin au repos sans avoir à retrouver les boîtes choisies, qui peuvent
        // être hors de l'écran : c'est la sortie de la bande, au clavier.
        if (evenement.key === 'Escape') onEffacer()
      }}
    >
      <div className={styles.tete} style={{ height: HAUTEUR_ENTETE }}>
        <Icon name="table" size={11} strokeWidth={1.8} className={styles.teteIcone} />
        <span className={styles.teteNom}>{boite.table}</span>
      </div>
      {boite.lignes.map((ligne) =>
        ligne.sorte === 'reste' ? (
          <div key="reste" className={styles.reste} style={{ height: HAUTEUR_LIGNE }}>
            {ligne.texte}
          </div>
        ) : (
          <div
            key={ligne.column}
            className={cx(
              styles.ligne,
              enEvidence.has(`${boite.id}.${ligne.column}`) && styles.ligneEnEvidence,
              colonnesTrouvees.has(`${boite.id}.${ligne.column}`) && styles.ligneTrouvee,
            )}
            /* **Le repère qui rend « le calcul tombe où le rendu tombe » vérifiable.** jsdom ne
               calcule aucune mise en page : que la ligne d'une colonne soit *réellement* au pixel où
               `disposition` a ancré son lien ne se mesure qu'en bout de chaîne, dans un navigateur.
               Ce repère est ce qui permet d'y désigner une ligne précise sans s'accrocher à un nom
               de classe engendré. */
            data-colonne={ligne.column}
            style={{ height: HAUTEUR_LIGNE }}
            /* **Une seule infobulle par ligne, qui la décrit en entier.** Le type est coupé par
               l'ellipse dès qu'il est long, la nullité n'a pas la place de s'écrire, et ce qu'une
               clé étrangère vise n'est lisible qu'en suivant le trait des yeux. Elle *décrit*, elle
               ne nomme pas : c'est un `title`, pas un `aria-label` (piège n° 4). */
            title={descriptionDeLigne(t, ligne.typeName, ligne.nullable, cibleDe(ligne.column))}
          >
            {ligne.key !== null && (
              <Icon
                name={ligne.key === 'primary' ? 'key' : 'fk'}
                size={9}
                strokeWidth={2}
                className={ligne.key === 'primary' ? styles.cle : styles.cleEtrangere}
              />
            )}
            <span
              className={cx(
                styles.nom,
                ligne.key === 'primary' && styles.nomCle,
                ligne.key === null && styles.nomSansCle,
              )}
            >
              {ligne.column}
            </span>
            <span className={styles.type}>{ligne.typeName}</span>
          </div>
        ),
      )}
    </div>
  )
}

/**
 * Une liste de noms lisible dans une infobulle.
 *
 * **Bornée à trente** : au-delà, une infobulle cesse d'être une infobulle. Ce qui compte est de
 * pouvoir répondre « lesquelles ? » — les trente premières et leur compte y suffisent, et le tri par
 * nom rend la suite devinable.
 */
function listeCourte(noms: readonly string[]): string {
  const PREMIERES = 30
  if (noms.length <= PREMIERES) return noms.join(', ')
  return `${noms.slice(0, PREMIERES).join(', ')}… (+ ${noms.length - PREMIERES})`
}

/**
 * Le texte de l'infobulle d'une ligne : son type, sa nullité, et ce qu'elle référence.
 *
 * **La cardinalité y est écrite en toutes lettres**, et pas seulement dessinée : une marque se
 * lit d'un coup d'œil pour qui connaît la notation, et ne dit rien du tout à qui ne la connaît pas.
 * C'est aussi la seule forme qu'une voix puisse rendre — un `marker` SVG n'a pas de texte.
 */
function descriptionDeLigne(
  t: ReturnType<typeof useT>,
  typeName: string,
  nullable: boolean,
  vers: Lien | undefined,
): string {
  const nullite = nullable ? t('diagram.ligne.nullable') : t('diagram.ligne.nonNullable')
  const base = `${typeName} · ${nullite}`
  if (!vers) return base
  return `${base} · ${t('diagram.ligne.reference', {
    cible: `${vers.cible}.${vers.colonnesCibles[0] ?? ''}`,
  })} · ${t(`diagram.cardinalite.${vers.cardinalite === 'one' ? 'un' : 'plusieurs'}`)}`
}

/**
 * Le pied du diagramme.
 *
 * **Séparé de la vue**, comme `StructureStatusBar` l'est de `StructureView` : la barre d'état court
 * sous les trois colonnes de l'écran de travail, pas sous le centre. Le même partage, pour la même
 * raison.
 *
 * **Il recompte les liens plutôt que de les recevoir**, par `comptesDeLiens` — la même règle sans
 * la géométrie. La vue tient l'échelle et le mode d'affichage des colonnes, qui ne changent aucun
 * de ces nombres ; les faire remonter aurait couplé le pied à l'état interne du centre pour deux
 * entiers.
 *
 * Les liens dont l'autre bout n'est pas dans ce schéma ne sont pas tracés, faute de boîte où
 * arriver ; les tables au-delà du plafond ne sont pas demandées. **Les deux sont dits** : un
 * diagramme amputé en silence se lirait comme un schéma complet, ce qui est le pire défaut que
 * cette vue puisse avoir.
 */
export function DiagramStatusBar({
  tables,
  demandees,
  total,
  omises = [],
  loading = false,
}: {
  tables: readonly EntreeDeTable[]
  /** Les tables que le diagramme demande — `total` borné par le plafond de `useDiagramme`. */
  demandees: number
  /** Les tables du schéma. */
  total: number
  /** Celles que le plafond a écartées, pour que l'infobulle les **nomme**. */
  omises?: readonly string[]
  loading?: boolean
}) {
  const t = useT()
  const { liens, liensExternes } = useMemo(() => comptesDeLiens(tables), [tables])

  /**
   * Le premier morceau répond à « ce que je vois est-il tout ce qu'il y a ? », et il a **trois**
   * réponses, pas deux : la lecture n'est pas finie, elle l'est mais le schéma déborde du plafond,
   * ou elle l'est et le dessin est complet. Fondre les deux dernières laisserait « 60 / 128 » à
   * l'écran pour toujours, ce qui se lit comme une lecture qui n'aboutit pas.
   */
  const avancement =
    loading || tables.length < demandees
      ? t('diagram.statusBar.lues', { lues: tables.length, total: demandees })
      : demandees < total
        ? t('diagram.statusBar.plafonnees', { montrees: demandees, total })
        : t('diagram.statusBar.tables', { count: tables.length })

  const morceaux = [
    avancement,
    t('diagram.statusBar.liens', { count: liens }),
    liensExternes > 0 ? t('diagram.statusBar.externes', { count: liensExternes }) : null,
  ].filter((morceau): morceau is string => morceau !== null)

  return (
    <div className={styles.pied} role="status" aria-label={t('diagram.statusBar.ariaLabel')}>
      {morceaux.map((morceau, rang) => (
        <span
          key={morceau}
          // Le plafond est un choix, pas un incident : l'infobulle en donne la raison, là où la
          // bande de 26 px n'a la place que du nombre.
          /* **L'infobulle nomme ce qui manque**, et ne se contente pas d'en donner la raison.
             « soixante des cent vingt-quatre tables » a suscité la bonne question — « lesquelles ne
             sont pas affichées ? » — à laquelle l'écran ne savait pas répondre. Un compte dit qu'il
             manque quelque chose ; une liste dit quoi. */
          title={
            morceau === avancement && demandees < total
              ? t('diagram.statusBar.plafonneesRaison', {
                  plafond: demandees,
                  omises: listeCourte(omises),
                })
              : undefined
          }
        >
          {rang > 0 && <span className={styles.piedPoint}>·</span>}
          {morceau}
        </span>
      ))}
    </div>
  )
}
