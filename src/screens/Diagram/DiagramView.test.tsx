import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ColumnInfo, Relation } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { DiagramStatusBar, DiagramView } from './DiagramView'
import type { EntreeDeTable } from './disposition'

/**
 * Ce que ce fichier peut mesurer, et ce qu'il ne peut pas.
 *
 * jsdom ne calcule aucune mise en page (règle n° 9) : les coordonnées, les tracés et le zoom n'y
 * sont vérifiables nulle part — leur géométrie est déjà testée en pur dans `disposition.test.ts`,
 * et le fait que le **rendu** tombe aux mêmes pixels que le calcul appartient à `e2e/`. Ce qui se
 * mesure ici est le contenu et les gestes : quelles boîtes existent, sous quel nom accessible, ce
 * qu'un clic et une touche déclenchent, et ce que la barre d'état dit.
 */
function monter(ui: ReactElement) {
  return render(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      {ui}
    </LanguageProvider>,
  )
}

function colonne(partiel: Partial<ColumnInfo> & Pick<ColumnInfo, 'position' | 'name'>): ColumnInfo {
  return {
    typeName: 'int8',
    category: 'number',
    nullable: false,
    default: null,
    identity: null,
    key: null,
    comment: null,
    frequency: null,
    ...partiel,
  }
}

const VERS_USERS: Relation = {
  constraintName: 'orders_user_id_fkey',
  direction: 'outgoing',
  cardinality: 'many',
  columns: ['user_id'],
  targetSchema: 'public',
  targetTable: 'users',
  targetColumns: ['id'],
}

const USERS: EntreeDeTable = {
  schema: 'public',
  name: 'users',
  columns: [
    colonne({ position: 1, name: 'id', key: 'primary' }),
    colonne({ position: 2, name: 'email', typeName: 'text', nullable: true }),
  ],
  relations: [],
}

const ORDERS: EntreeDeTable = {
  schema: 'public',
  name: 'orders',
  columns: [
    colonne({ position: 1, name: 'id', key: 'primary' }),
    colonne({ position: 2, name: 'user_id', key: 'foreign' }),
    colonne({ position: 3, name: 'status', typeName: 'text' }),
  ],
  relations: [VERS_USERS],
}

const DEUX = [ORDERS, USERS]

test('chaque table est une boîte nommée, avec ses comptes', async () => {
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  // **Le nom accessible vient d'`aria-label`**, pas du contenu concaténé — sans quoi il rendrait
  // « ordersidint8user_id… ». Le motif est **ancré** : `/orders/` compterait aussi `order_items`.
  expect(screen.getByRole('button', { name: /^orders · 3 colonnes · 1 lien$/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^users · 2 colonnes · 1 lien$/ })).toBeInTheDocument()
  // Les colonnes se lisent à l'intérieur de la boîte, elles ne sont pas dans son nom.
  expect(screen.getByText('user_id')).toBeInTheDocument()
  expect(screen.getByText('status')).toBeInTheDocument()
})

test('le double-clic sur une boîte ouvre la table', async () => {
  const utilisateur = userEvent.setup()
  const ouvertes: string[] = []
  monter(
    <DiagramView
      schema="public"
      tables={DEUX}
      total={2}
      onOuvrirLaTable={(n) => ouvertes.push(n)}
    />,
  )

  await utilisateur.dblClick(screen.getByRole('button', { name: /^orders ·/ }))
  expect(ouvertes).toEqual(['orders'])
})

test('`Entrée` ouvre la table, parce qu’un geste au double-clic seul est inatteignable au clavier', async () => {
  const utilisateur = userEvent.setup()
  const ouvertes: string[] = []
  monter(
    <DiagramView
      schema="public"
      tables={DEUX}
      total={2}
      onOuvrirLaTable={(n) => ouvertes.push(n)}
    />,
  )

  screen.getByRole('button', { name: /^users ·/ }).focus()
  await utilisateur.keyboard('{Enter}')
  expect(ouvertes).toEqual(['users'])
})

test('le clic choisit la boîte, et un second la relâche', async () => {
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const orders = screen.getByRole('button', { name: /^orders ·/ })

  expect(orders).toHaveAttribute('aria-pressed', 'false')
  await utilisateur.click(orders)
  expect(orders).toHaveAttribute('aria-pressed', 'true')
  // **La bascule est ce qui rend `aria-pressed` honnête des deux côtés** : un état qui ne peut pas
  // revenir à `false` par le même geste n'est pas un état pressé.
  await utilisateur.click(orders)
  expect(orders).toHaveAttribute('aria-pressed', 'false')
})

test('un double-clic ouvre et choisit, il ne bascule pas deux fois', async () => {
  const utilisateur = userEvent.setup()
  const ouvertes: string[] = []
  monter(
    <DiagramView
      schema="public"
      tables={DEUX}
      total={2}
      onOuvrirLaTable={(n) => ouvertes.push(n)}
    />,
  )
  const orders = screen.getByRole('button', { name: /^orders ·/ })

  // **Un double-clic émet deux clics avant le sien.** Sans la garde `detail === 1`, la bascule
  // jouait deux fois : la boîte repartait *non choisie* alors qu'on venait de l'ouvrir, et le
  // surlignage de ses liens s'allumait puis s'éteignait le temps d'un rendu. Avec la garde, seul le
  // premier clic compte — donc la table s'ouvre **et** la boîte reste choisie, ce qui est ce qu'on
  // attend d'un élément qu'on vient de désigner.
  await utilisateur.dblClick(orders)
  expect(ouvertes).toEqual(['orders'])
  expect(orders).toHaveAttribute('aria-pressed', 'true')

  // Le contrôle positif : la bascule marche encore, la garde ne l'a pas neutralisée.
  await utilisateur.click(orders)
  expect(orders).toHaveAttribute('aria-pressed', 'false')
})

test('choisir une table éclaire les colonnes de ses clés, aux deux bouts', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  const eclairees = () =>
    [...container.querySelectorAll('[data-colonne]')]
      .filter((ligne) => ligne.className.includes('EnEvidence'))
      .map(
        (ligne) =>
          `${ligne.closest('[data-boite]')?.getAttribute('data-boite')}.${ligne.getAttribute('data-colonne')}`,
      )
      .sort()

  // Rien n'est éclairé tant que rien n'est choisi : une marque permanente ne distinguerait plus ce
  // qu'on vient de désigner.
  expect(eclairees()).toEqual([])

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  /*
   * **Les deux bouts, et c'est le point.** Surligner les traits dit *qu'*une table en référence une
   * autre, pas **par quelle colonne** — or c'est justement la question qu'on se pose en choisissant
   * une boîte. La clé étrangère chez celle qui référence, la colonne référencée chez l'autre.
   */
  expect(eclairees()).toEqual(['orders.user_id', 'users.id'])

  // Et relâcher éteint : la marque suit la sélection, elle ne s'accumule pas.
  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  expect(eclairees()).toEqual([])
})

test('choisir la table référencée éclaire les mêmes deux colonnes', async () => {
  // Le lien est le même vu de l'autre bout : `users` est référencée par `orders`, et choisir l'une
  // ou l'autre doit éclairer le même couple. Sans cela, la marque ne dirait la relation que dans un
  // sens — celui de la table qui porte la clé.
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  await utilisateur.click(screen.getByRole('button', { name: /^users ·/ }))
  expect(
    [...container.querySelectorAll('[data-colonne]')]
      .filter((ligne) => ligne.className.includes('EnEvidence'))
      .map(
        (ligne) =>
          `${ligne.closest('[data-boite]')?.getAttribute('data-boite')}.${ligne.getAttribute('data-colonne')}`,
      )
      .sort(),
  ).toEqual(['orders.user_id', 'users.id'])
})

test('l’interrupteur « Toutes les colonnes » ouvre ce que l’aperçu résume', async () => {
  const utilisateur = userEvent.setup()
  const large: EntreeDeTable = {
    schema: 'public',
    name: 'large',
    columns: [
      colonne({ position: 1, name: 'id', key: 'primary' }),
      ...Array.from({ length: 12 }, (_, rang) =>
        colonne({ position: rang + 2, name: `champ_${rang}`, typeName: 'text' }),
      ),
    ],
    relations: [],
  }
  monter(<DiagramView schema="public" tables={[large]} total={1} />)

  // **L'interrupteur dit ce que le réglage fait.** Un contrôle segmenté « Clés | Toutes » se lisait
  // comme un filtre sur une nature de colonne, sans annoncer que des lignes étaient masquées : la
  // forme d'un interrupteur éteint le dit, et « + n autres » dit combien. Rapporté à l'usage.
  expect(screen.getByRole('switch', { name: 'Toutes les colonnes' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  // Huit colonnes, puis le résumé de ce qui reste — dit, jamais tu.
  expect(screen.getByRole('button', { name: /^large · 8 colonnes/ })).toBeInTheDocument()
  expect(screen.getByText('+ 5 autres')).toBeInTheDocument()
  expect(screen.queryByText('champ_10')).not.toBeInTheDocument()

  await utilisateur.click(screen.getByRole('switch', { name: 'Toutes les colonnes' }))
  expect(screen.getByRole('button', { name: /^large · 13 colonnes/ })).toBeInTheDocument()
  expect(screen.getByText('champ_10')).toBeInTheDocument()
  expect(screen.queryByText(/autres/)).not.toBeInTheDocument()
})

// --- Deux tables choisies, et ce qui les relie ---

/**
 * Le décor de ces tests porte **trois** tables en chaîne, et c'est ce qui les rend probants.
 *
 * `order_items` et `users` ne se touchent pas : c'est le cas où l'on ne sait pas répondre soi-même,
 * donc celui qui justifie la fonction. À deux tables, un chemin trouvé et un simple lien incident
 * seraient indiscernables (règle n° 5).
 */
const VERS_ORDERS: Relation = {
  constraintName: 'order_items_order_id_fkey',
  direction: 'outgoing',
  cardinality: 'many',
  columns: ['order_id'],
  targetSchema: 'public',
  targetTable: 'orders',
  targetColumns: ['id'],
}

const ORDER_ITEMS: EntreeDeTable = {
  schema: 'public',
  name: 'order_items',
  columns: [
    colonne({ position: 1, name: 'id', key: 'primary' }),
    colonne({ position: 2, name: 'order_id', key: 'foreign' }),
  ],
  relations: [VERS_ORDERS],
}

/** Une table qu'aucune clé du décor ne relie aux trois autres. */
const AUDIT: EntreeDeTable = {
  schema: 'public',
  name: 'audit_events',
  columns: [colonne({ position: 1, name: 'id', key: 'primary' })],
  relations: [],
}

/**
 * Le `1:1` du décor : `profils.user_id` est **à la fois** clé primaire et clé étrangère.
 *
 * Sans lui, toutes les clés du décor seraient `many` et une implémentation qui dessinerait toujours
 * la même marque passerait (règle n° 5). C'est aussi la forme la plus courante du `1:1` — et celle
 * qu'un écran ne peut pas déduire seul, `ColumnInfo.key` ne disant rien de l'unicité.
 */
const PROFILS: EntreeDeTable = {
  schema: 'public',
  name: 'profils',
  columns: [
    colonne({ position: 1, name: 'user_id', key: 'primary' }),
    colonne({ position: 2, name: 'bio', typeName: 'text', nullable: true }),
  ],
  relations: [
    {
      constraintName: 'profils_user_id_fkey',
      direction: 'outgoing',
      cardinality: 'one',
      columns: ['user_id'],
      targetSchema: 'public',
      targetTable: 'users',
      targetColumns: ['id'],
    },
  ],
}

const CHAINE = [ORDER_ITEMS, ORDERS, USERS]

function bande() {
  return screen.getByRole('status', { name: 'Ce qui relie les tables choisies' })
}

/**
 * Un ⇧-clic.
 *
 * `userEvent.click` ne prend pas de modificateur : on tient la touche **autour** du clic, ce qui est
 * aussi ce que fait la main. Le second argument que l'on serait tenté d'écrire n'existe pas, et
 * fabriquer l'événement à la main manquerait les `pointerdown`/`pointerup` que la boîte écoute.
 */
async function clicMaj(utilisateur: ReturnType<typeof userEvent.setup>, cible: HTMLElement) {
  await utilisateur.keyboard('{Shift>}')
  await utilisateur.click(cible)
  await utilisateur.keyboard('{/Shift}')
}

test('la bande paraît à la première table choisie, et annonce le geste qui en désigne une seconde', async () => {
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  // Au repos, rien : une bande permanente prendrait vingt-six pixels pour ne rien dire.
  expect(screen.queryByRole('status', { name: 'Ce qui relie les tables choisies' })).toBeNull()

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  /*
   * **Le geste est annoncé là où il sert, et nulle part ailleurs.** Le `⇧`-clic est le geste
   * d'extension universel, mais rien dans le produit ne l'annonçait : un geste qu'on ne peut pas
   * deviner n'existe pas. L'invite paraît donc dès qu'il y a une première table, c'est-à-dire dès
   * qu'il y a quelque chose à en faire.
   */
  expect(bande()).toHaveTextContent('orders')
  expect(bande()).toHaveTextContent('seconde table')
})

test('un ⇧-clic adjoint une seconde table, et la bande dit la clé qui les relie', async () => {
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^users ·/ }))

  // Les deux sont désignées : `aria-pressed` doit être vrai des deux côtés, sans quoi l'état de la
  // première serait perdu pour une voix.
  expect(screen.getByRole('button', { name: /^orders ·/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /^users ·/ })).toHaveAttribute('aria-pressed', 'true')

  expect(bande()).toHaveTextContent('Reliées par une clé')
  // **Les colonnes, et pas seulement les tables** : ce qu'on vient chercher est la jointure.
  expect(bande()).toHaveTextContent('orders.user_id')
  expect(bande()).toHaveTextContent('users.id')
  /*
   * **Le sens de la clé est *dit*, pas seulement dessiné.** La flèche est retirée de l'arbre
   * d'accessibilité — une voix qui rendrait « orders.user_id users.id » ne dirait plus laquelle
   * référence l'autre — et un verbe masqué en `clip-path` la remplace, avec ses espaces (piège
   * n° 1).
   */
  expect(bande()).toHaveTextContent('référence')
})

test('elle traverse les tables intermédiaires, et les marque sans les confondre avec les choisies', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  await utilisateur.click(screen.getByRole('button', { name: /^order_items ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^users ·/ }))

  // La question à laquelle le dessin seul ne répondait pas : deux tables que rien ne relie
  // directement.
  expect(bande()).toHaveTextContent('Reliées en 2 étapes')
  expect(bande()).toHaveTextContent('order_items.order_id')
  expect(bande()).toHaveTextContent('orders.id')
  expect(bande()).toHaveTextContent('orders.user_id')
  expect(bande()).toHaveTextContent('users.id')

  const marquees = (classe: string) =>
    [...container.querySelectorAll('[data-boite]')]
      .filter((boite) => boite.className.includes(classe))
      .map((boite) => boite.getAttribute('data-boite'))
      .sort()

  // **Traversée n'est pas choisie**, et les deux marques doivent se distinguer : `orders` est la
  // réponse à « par où passe-t-on », pas une table qu'on a désignée.
  expect(marquees('boiteSurLeChemin')).toEqual(['orders'])
  expect(marquees('boiteChoisie')).toEqual(['order_items', 'users'])
})

test('un chemin resserre les colonnes éclairées sur lui seul', async () => {
  /*
   * **Le contrôle négatif de la marque.** `orders` porte deux clés : celle qui la relie à
   * `order_items` et celle qui la relie à `users`. Quand on demande le chemin d'`order_items` à
   * `orders`, seule la première est la réponse — garder l'autre allumerait une table centrale en
   * entier, au milieu de laquelle les deux colonnes cherchées se perdraient.
   */
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  const eclairees = () =>
    [...container.querySelectorAll('[data-colonne]')]
      .filter((ligne) => ligne.className.includes('EnEvidence'))
      .map(
        (ligne) =>
          `${ligne.closest('[data-boite]')?.getAttribute('data-boite')}.${ligne.getAttribute('data-colonne')}`,
      )
      .sort()

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  // Une seule table choisie : tous ses liens, dans les deux sens — le comportement d'avant.
  expect(eclairees()).toEqual(['order_items.order_id', 'orders.id', 'orders.user_id', 'users.id'])

  await clicMaj(utilisateur, screen.getByRole('button', { name: /^order_items ·/ }))
  expect(eclairees()).toEqual(['order_items.order_id', 'orders.id'])
})

test('elle dit qu’il n’y a aucun chemin, et autrement sur un dessin incomplet', async () => {
  const utilisateur = userEvent.setup()
  const { rerender } = monter(<DiagramView schema="public" tables={[...CHAINE, AUDIT]} total={4} />)

  await utilisateur.click(screen.getByRole('button', { name: /^users ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^audit_events ·/ }))
  expect(bande()).toHaveTextContent('Aucun chemin de clés entre users et audit_events')
  expect(bande()).not.toHaveTextContent('dessinées')

  /*
   * **« Aucun » ne peut pas vouloir dire « aucun dans la base » tant que le dessin est incomplet.**
   * Lecture en cours ou plafond qui mord, le chemin passe peut-être par une table qui n'est pas là :
   * l'affirmer serait le pire défaut que cette vue puisse avoir, celui d'un diagramme amputé qui se
   * lit comme un schéma complet.
   */
  rerender(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <DiagramView schema="public" tables={[...CHAINE, AUDIT]} total={9} loading />
    </LanguageProvider>,
  )
  expect(bande()).toHaveTextContent('parmi les tables dessinées')
})

test('un troisième ⇧-clic remplace la seconde, jamais l’ancre', async () => {
  /*
   * **C'est ce qui rend le geste utile plus d'une fois** : on garde `users` sous la main et l'on
   * essaie l'une après l'autre les tables dont on se demande comment elles s'y rattachent.
   * Remplacer la première rendrait chaque comparaison indépendante de la précédente.
   */
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  await utilisateur.click(screen.getByRole('button', { name: /^users ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^orders ·/ }))
  expect(bande()).toHaveTextContent('Reliées par une clé')

  await clicMaj(utilisateur, screen.getByRole('button', { name: /^order_items ·/ }))
  expect(bande()).toHaveTextContent('Reliées en 2 étapes')
  expect(screen.getByRole('button', { name: /^users ·/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /^orders ·/ })).toHaveAttribute('aria-pressed', 'false')
})

test('⇧Espace fait au clavier ce que le ⇧-clic fait à la souris', async () => {
  // **Un geste qui n'existerait qu'à la souris serait invisible et inatteignable au clavier**, ce
  // que le renommage des consoles a déjà tranché — et la comparaison de deux tables, qui est tout
  // l'intérêt du geste, le mérite d'autant plus.
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  screen.getByRole('button', { name: /^orders ·/ }).focus()
  await utilisateur.keyboard(' ')
  screen.getByRole('button', { name: /^users ·/ }).focus()
  await utilisateur.keyboard('{Shift>} {/Shift}')

  expect(bande()).toHaveTextContent('Reliées par une clé')
  expect(screen.getByRole('button', { name: /^orders ·/ })).toHaveAttribute('aria-pressed', 'true')
})

test('le bouton de la bande et Échap rendent le dessin au repos', async () => {
  // Les boîtes choisies peuvent être hors de l'écran sur une toile de plusieurs milliers de pixels :
  // on ne devrait pas avoir à les retrouver pour tout relâcher.
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={CHAINE} total={3} />)

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^users ·/ }))
  await utilisateur.click(screen.getByRole('button', { name: 'Ne plus rien choisir' }))

  expect(screen.queryByRole('status', { name: 'Ce qui relie les tables choisies' })).toBeNull()
  expect(screen.getByRole('button', { name: /^orders ·/ })).toHaveAttribute('aria-pressed', 'false')

  await utilisateur.click(screen.getByRole('button', { name: /^orders ·/ }))
  await utilisateur.keyboard('{Escape}')
  expect(screen.queryByRole('status', { name: 'Ce qui relie les tables choisies' })).toBeNull()
})

test('adjoindre une seconde table efface la recherche, qui masquait la réponse', async () => {
  /*
   * **Rapporté à l'usage : « la relation est partiellement masquée ».**
   *
   * Les deux gestes emploient les mêmes canaux en sens contraire. Une recherche efface les tables
   * qu'elle ne désigne pas ; or le chemin entre deux tables passe justement par des tables qu'on n'a
   * pas cherchées — `orders` ici, que ni `order_items` ni `users` ne nomment. Elles arrivaient donc
   * à 32 % d'opacité, et la réponse était à moitié illisible au moment même où on la demandait.
   */
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={CHAINE} total={3} />)
  const champ = screen.getByRole('textbox', { name: /Chercher/ })

  await utilisateur.type(champ, 'order_items')
  const eteintes = () =>
    [...container.querySelectorAll('[data-boite]')]
      .filter((boite) => boite.className.includes('boiteEteinte'))
      .map((boite) => boite.getAttribute('data-boite'))
      .sort()
  // Le décor doit rendre le défaut visible : la table que le chemin traverse est bien éteinte.
  expect(eteintes()).toEqual(['orders', 'users'])

  await utilisateur.click(screen.getByRole('button', { name: /^order_items ·/ }))
  // **Une table choisie et une recherche coexistent** : c'est ce qu'`Entrée` produit, qui désigne la
  // correspondance où il emmène. Effacer dès la première rendrait ce parcours impossible.
  expect(champ).toHaveValue('order_items')

  await clicMaj(utilisateur, screen.getByRole('button', { name: /^users ·/ }))
  expect(champ).toHaveValue('')
  expect(eteintes()).toEqual([])
  // Et la réponse est là, entière.
  expect(bande()).toHaveTextContent('Reliées en 2 étapes')
})

// --- Un à un, un à plusieurs ---

test('chaque lien porte au départ la marque de sa cardinalité', async () => {
  /*
   * **Le côté qui référence, et lui seul.** Le côté référencé est toujours *un* — une clé étrangère
   * ne peut viser que des colonnes uniques —, donc il n'y a qu'un bout où il y ait quelque chose à
   * dire. La flèche reste à l'arrivée : elle donne le sens, et ce n'est pas la même information.
   *
   * Ce que jsdom peut mesurer ici est le **choix de la marque** ; qu'elle se dessine en demi-cercle
   * appartient à `e2e/` comme tout ce qui est mise en page (règle n° 9).
   *
   * Le repère est `data-marque` : les marques sont des `<path>` ordinaires depuis le 4 septembre
   * 2026 — voir la raison dans `DiagramView` —, donc il n'y a plus d'attribut `marker-start` à
   * lire, et le tracé lui-même n'a pas à entrer dans une assertion (il a changé quatre fois).
   */
  const { container } = monter(
    <DiagramView schema="public" tables={[...CHAINE, PROFILS]} total={4} />,
  )

  const marques = () =>
    Object.fromEntries(
      [
        ...container.querySelectorAll(
          '[data-liens] path[data-marque="one"], [data-liens] path[data-marque="many"]',
        ),
      ].map((marque) => [
        marque.getAttribute('data-marque-lien'),
        marque.getAttribute('data-marque'),
      ]),
    )

  expect(marques()).toEqual({
    // Plusieurs commandes par compte, plusieurs lignes par commande : rien ne les borne.
    'public.orders::orders_user_id_fkey': 'many',
    'public.order_items::order_items_order_id_fkey': 'many',
    // Un seul profil par utilisateur, parce que sa clé étrangère **est** sa clé primaire.
    'public.profils::profils_user_id_fkey': 'one',
  })
})

test('la cardinalité s’écrit aussi en toutes lettres, là où une marque ne se lit pas', async () => {
  /*
   * **Un demi-cercle ne dit rien à qui ne connaît pas la notation**, et un tracé SVG n'a aucun
   * texte qu'une voix puisse rendre. Les deux endroits où la relation se lit en mots doivent donc la
   * porter : l'infobulle d'une ligne, et la bande qui écrit le chemin entre deux tables.
   */
  const utilisateur = userEvent.setup()
  const { container } = monter(
    <DiagramView schema="public" tables={[...CHAINE, PROFILS]} total={4} />,
  )

  const infobulle = (table: string, colonne: string) =>
    container
      .querySelector(`[data-boite="${table}"] [data-colonne="${colonne}"]`)
      ?.getAttribute('title')

  expect(infobulle('profils', 'user_id')).toContain('un à un')
  expect(infobulle('orders', 'user_id')).toContain('un à plusieurs')

  await utilisateur.click(screen.getByRole('button', { name: /^profils ·/ }))
  await clicMaj(utilisateur, screen.getByRole('button', { name: /^users ·/ }))
  // La notation visible pour l'œil, le mot pour la voix — et les deux disent la même chose.
  expect(bande()).toHaveTextContent('1:1')
  expect(bande()).toHaveTextContent('un à un')
})

// --- La recherche ---

/**
 * Le champ de recherche du diagramme.
 *
 * **Ce que jsdom ne peut pas voir** : `Entrée` amène la correspondance à l'écran par
 * `scrollIntoView`, qui n'existe pas sans mise en page (règle n° 9). Ce qui se mesure ici est le
 * **marquage** et le **compte** ; le déplacement de la vue appartient à `e2e/`.
 */
function chercher(container: HTMLElement) {
  const marquees = (classe: string) =>
    [...container.querySelectorAll('[data-boite]')]
      .filter((boite) => boite.className.includes(classe))
      .map((boite) => boite.getAttribute('data-boite'))
      .sort()
  return {
    trouvees: () => marquees('boiteTrouvee'),
    eteintes: () => marquees('boiteEteinte'),
    colonnes: () =>
      [...container.querySelectorAll('[data-colonne]')]
        .filter((ligne) => ligne.className.includes('ligneTrouvee'))
        .map(
          (ligne) =>
            `${ligne.closest('[data-boite]')?.getAttribute('data-boite')}.${ligne.getAttribute('data-colonne')}`,
        )
        .sort(),
  }
}

test('la recherche marque les tables par leur nom, et éteint les autres', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const vu = chercher(container)

  // Rien n'est marqué ni éteint tant qu'on ne cherche rien : un dessin au repos est un dessin
  // entier.
  expect(vu.trouvees()).toEqual([])
  expect(vu.eteintes()).toEqual([])

  await utilisateur.type(
    screen.getByRole('textbox', { name: /Chercher une table ou une colonne/ }),
    'user',
  )
  // `users` par son nom, et `orders` par sa colonne `user_id` — le champ cherche les deux.
  expect(vu.trouvees()).toEqual(['orders', 'users'])
  expect(vu.eteintes()).toEqual([])
  expect(screen.getByText('2 trouvées')).toBeInTheDocument()
})

test('elle cherche aussi dans les colonnes, et dit laquelle a répondu', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  await utilisateur.type(screen.getByRole('textbox', { name: /Chercher/ }), 'status')
  const vu = chercher(container)
  // **La colonne qui a fait correspondre est marquée**, pas seulement sa table : sans cela on
  // trouverait une table sans savoir pourquoi.
  expect(vu.trouvees()).toEqual(['orders'])
  expect(vu.colonnes()).toEqual(['orders.status'])
  // Et la table qui ne correspond pas s'efface.
  expect(vu.eteintes()).toEqual(['users'])
})

test('elle dit « aucune » plutôt que de laisser croire qu’elle cherche encore', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  await utilisateur.type(screen.getByRole('textbox', { name: /Chercher/ }), 'zzzz')
  expect(screen.getByText('aucune')).toBeInTheDocument()
  // Tout est éteint, et rien n'est marqué : l'état est lisible, pas ambigu.
  expect(chercher(container).trouvees()).toEqual([])
  expect(chercher(container).eteintes()).toEqual(['orders', 'users'])
})

test('le champ se vide par son bouton, qui lui rend le focus', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const champ = screen.getByRole('textbox', { name: /Chercher/ })

  // **Rien à vider, aucun bouton** : un contrôle inerte mais actif se lit comme une panne, et le
  // désactiver reviendrait au même sans le gain d'un pixel.
  expect(screen.queryByRole('button', { name: 'Effacer la recherche' })).toBeNull()

  await utilisateur.type(champ, 'status')
  await utilisateur.click(screen.getByRole('button', { name: 'Effacer la recherche' }))

  expect(champ).toHaveValue('')
  // Le dessin revient entier : plus rien n'est marqué ni éteint.
  expect(chercher(container).trouvees()).toEqual([])
  expect(chercher(container).eteintes()).toEqual([])
  // **Le focus revient au champ** : un bouton qui le garde après avoir effacé oblige à revenir au
  // champ à la souris pour taper la recherche suivante.
  expect(champ).toHaveFocus()
})

test('Échap vide le champ, comme partout où l’on abandonne ce qu’on a tapé', async () => {
  // Le jumeau au clavier du bouton voisin, et l'idiome déjà en place dans la cellule de filtre, le
  // renommage et le nom de projet.
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const champ = screen.getByRole('textbox', { name: /Chercher/ })

  await utilisateur.type(champ, 'status')
  await utilisateur.keyboard('{Escape}')

  expect(champ).toHaveValue('')
  expect(champ).toHaveFocus()
})

test('elle trouve une colonne que l’aperçu masque', async () => {
  /*
   * **La conséquence assumée du plafond de colonnes.** La recherche porte sur les structures, non
   * sur le dessin : chercher dans les seules lignes visibles aurait rendu « aucune » pour une
   * colonne qui existe. La table est donc marquée, et l'interrupteur « Toutes les colonnes » est
   * juste à côté pour voir pourquoi.
   */
  const utilisateur = userEvent.setup()
  const large: EntreeDeTable = {
    schema: 'public',
    name: 'large',
    columns: [
      colonne({ position: 1, name: 'id', key: 'primary' }),
      ...Array.from({ length: 12 }, (_, rang) =>
        colonne({ position: rang + 2, name: `champ_${rang}`, typeName: 'text' }),
      ),
    ],
    relations: [],
  }
  const { container } = monter(<DiagramView schema="public" tables={[large]} total={1} />)
  // Le décor doit bien masquer la colonne visée, sinon ce test ne mesure rien de particulier.
  expect(screen.queryByText('champ_11')).not.toBeInTheDocument()

  await utilisateur.type(screen.getByRole('textbox', { name: /Chercher/ }), 'champ_11')
  expect(chercher(container).trouvees()).toEqual(['large'])
  // Aucune ligne marquée : celle qui correspond n'est pas à l'écran, et rien ne prétend le
  // contraire.
  expect(chercher(container).colonnes()).toEqual([])

  // Et l'interrupteur la fait paraître, marquée.
  await utilisateur.click(screen.getByRole('switch', { name: 'Toutes les colonnes' }))
  expect(chercher(container).colonnes()).toEqual(['large.champ_11'])
})

test('les liens dont aucun bout n’est cherché s’effacent', async () => {
  const utilisateur = userEvent.setup()
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const estEteint = (n: Element | null) => n?.getAttribute('class')?.includes('lienEteint') ?? false
  // **Le trait seul**, par `data-lien` : un lien est dessiné par trois `<path>` — sa trace et ses
  // deux marques —, et compter tout ce qui porte un `d` compterait trois fois chaque lien.
  const eteints = () =>
    [...container.querySelectorAll('[data-liens] path[data-lien]')].filter(estEteint).length

  expect(eteints()).toBe(0)
  // `status` ne désigne qu'`orders` ; le lien `orders → users` a donc un bout cherché et reste.
  await utilisateur.type(screen.getByRole('textbox', { name: /Chercher/ }), 'status')
  expect(eteints()).toBe(0)

  // Un terme qui ne désigne rien éteint tout : sinon les traits gardent leur force au-dessus d'un
  // dessin éteint et le dominent.
  await utilisateur.clear(screen.getByRole('textbox', { name: /Chercher/ }))
  await utilisateur.type(screen.getByRole('textbox', { name: /Chercher/ }), 'zzzz')
  expect(eteints()).toBe(1)

  /*
   * **Et ses deux marques s'effacent avec lui.** C'est la propriété qui a fait des marques des
   * `<path>` plutôt que des `<marker>` : un état du trait doit les atteindre *par construction*,
   * puisqu'elles portent ses classes. Un `marker` vivait dans `<defs>`, était partagé par tous les
   * liens, et son état se choisissait en basculant une **référence** — ce que la webview de
   * l'application ne repeignait pas toujours. Ici il n'y a plus de référence, donc plus rien à
   * repeindre : jsdom suffit à le constater.
   */
  const trait = container.querySelector('[data-liens] path[data-lien]')
  const id = trait?.getAttribute('data-lien')
  const sesMarques = [...container.querySelectorAll(`[data-marque-lien="${id}"]`)]
  expect(sesMarques).toHaveLength(2)
  expect(sesMarques.every(estEteint)).toBe(true)
})

test('`Entrée` désigne la correspondance, et passe à la suivante', async () => {
  // `scrollIntoView` n'existe pas sous jsdom : ce qui se mesure est la **désignation**, qui suit le
  // déplacement et se lit dans `aria-pressed`. Le défilement appartient à `e2e/`.
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const champ = screen.getByRole('textbox', { name: /Chercher/ })

  await utilisateur.type(champ, 'user')
  const enAvant = () =>
    ['orders', 'users'].filter(
      (nom) =>
        screen
          .getByRole('button', { name: new RegExp(`^${nom} ·`) })
          .getAttribute('aria-pressed') === 'true',
    )
  expect(enAvant()).toEqual([])

  await utilisateur.type(champ, '{Enter}')
  const premiere = enAvant()
  expect(premiere).toHaveLength(1)
  await utilisateur.type(champ, '{Enter}')
  const seconde = enAvant()
  expect(seconde).toHaveLength(1)
  // **La seconde n'est pas la première** : `Entrée` avance, il ne rejoue pas.
  expect(seconde).not.toEqual(premiere)
  // Et il boucle plutôt que de s'arrêter au bout.
  await utilisateur.type(champ, '{Enter}')
  expect(enAvant()).toEqual(premiere)
})

test('un témoin tourne pendant la lecture, et disparaît après', () => {
  /*
   * **Le témoin dit *que* ça travaille ; la barre d'état dit *où en est* la lecture.**
   *
   * Les deux ne se répètent pas : la barre court sous les trois colonnes de l'écran, à vingt-six
   * pixels du bas, et personne ne la regarde en attendant un dessin. Le témoin vit donc dans la
   * bande d'outils, à côté du réglage — là où le regard est.
   */
  const { unmount } = monter(<DiagramView schema="public" tables={DEUX} total={7} loading />)
  expect(screen.getByText('Lecture…')).toBeInTheDocument()
  unmount()

  // Et il s'efface quand il n'y a plus rien à attendre : un témoin qui tournerait toujours ne
  // dirait plus rien.
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  expect(screen.queryByText('Lecture…')).not.toBeInTheDocument()
})

test('le zoom se règle par paliers, et le pourcentage y ramène', async () => {
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  expect(screen.getByRole('button', { name: /^Échelle 100 %/ })).toBeInTheDocument()
  await utilisateur.click(screen.getByRole('button', { name: 'Réduire le diagramme' }))
  const reduit = screen.getByRole('button', { name: /^Échelle 85 %/ })
  await utilisateur.click(reduit)
  // Le pourcentage **est** le retour à l'échelle 1 : son nom accessible le dit, plutôt qu'un
  // troisième bouton pour une valeur déjà affichée.
  expect(screen.getByRole('button', { name: /^Échelle 100 %/ })).toBeInTheDocument()
})

test('les extrémités du zoom se désactivent, elles ne bouclent pas', async () => {
  const utilisateur = userEvent.setup()
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  for (let i = 0; i < 6; i++)
    await utilisateur.click(screen.getByRole('button', { name: 'Réduire le diagramme' }))
  // Boucler du plancher au plafond ferait sauter le dessin d'un extrême à l'autre sur un clic de
  // trop, sans que rien l'annonce.
  expect(screen.getByRole('button', { name: 'Réduire le diagramme' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Agrandir le diagramme' })).toBeEnabled()
})

/**
 * La toile, par son repère plutôt que par sa classe : celle d'un module CSS est un nom engendré, et
 * s'y accrocher mesurerait l'outil de construction.
 */
function laToile(container: HTMLElement): HTMLElement {
  const toile = container.querySelector('[data-toile]')
  if (!(toile instanceof HTMLElement)) throw new Error('la toile du diagramme est absente')
  return toile
}

test('`⌘` / `Ctrl` + molette zoome, la molette nue ne zoome pas', () => {
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const toile = laToile(container)

  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true })
  expect(screen.getByRole('button', { name: /^Échelle 125 %/ })).toBeInTheDocument()
  // `metaKey` est le `⌘` d'une souris sur macOS ; `ctrlKey`, le pincement du trackpad des deux
  // moteurs et le `Ctrl` + molette de Windows.
  fireEvent.wheel(toile, { deltaY: 100, metaKey: true })
  expect(screen.getByRole('button', { name: /^Échelle 100 %/ })).toBeInTheDocument()

  // **Le contrôle négatif, et c'est la moitié de l'arbitrage d'`API-82`** : la molette nue défile
  // la toile. La reprendre retirerait le seul défilement vertical confortable d'un schéma haut.
  fireEvent.wheel(toile, { deltaY: -100 })
  fireEvent.wheel(toile, { deltaY: -100 })
  expect(screen.getByRole('button', { name: /^Échelle 100 %/ })).toBeInTheDocument()
})

test('le geste et les boutons règlent la même échelle', () => {
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const toile = laToile(container)

  // Les deux voies passent par `reglerLePalier` (règle n° 17). Ce que ce test garde est que le
  // palier tenu en ref pour le geste et celui rendu par l'état **ne divergent pas** : s'ils le
  // faisaient, un bouton après un geste repartirait d'une valeur que l'écran n'affiche pas.
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true })
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir le diagramme' }))
  expect(screen.getByRole('button', { name: /^Échelle 150 %/ })).toBeInTheDocument()

  fireEvent.wheel(toile, { deltaY: 100, ctrlKey: true })
  expect(screen.getByRole('button', { name: /^Échelle 125 %/ })).toBeInTheDocument()
})

test('le geste s’arrête aux extrémités, il ne boucle pas', () => {
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const toile = laToile(container)

  // Huit crans pour six paliers : les deux derniers ne doivent rien faire. Boucler du plafond au
  // plancher ferait sauter le dessin d'un extrême à l'autre sur un cran de trop, comme pour les
  // boutons — et c'est la même borne, puisque c'est la même fonction.
  for (let i = 0; i < 8; i++) fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true })
  expect(screen.getByRole('button', { name: /^Échelle 150 %/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Agrandir le diagramme' })).toBeDisabled()
})

test('le geste répond même quand la toile arrive après le premier rendu', () => {
  // **La raison pour laquelle la toile est un nœud d'état et non une `useRef`.** Les structures
  // arrivent une par une : le premier rendu d'un diagramme est une phrase de lecture, sans zone
  // défilante. Un effet accroché au montage serait parti sur un `ref.current` nul et n'aurait plus
  // rien observé — le geste n'aurait jamais répondu, en silence. C'est la leçon d'`API-74`.
  const { container, rerender } = monter(
    <DiagramView schema="public" tables={[]} total={2} loading />,
  )
  expect(container.querySelector('[data-toile]')).toBeNull()

  rerender(
    <LanguageProvider preferences={{ language: 'fr' }}>
      <Sprite />
      <DiagramView schema="public" tables={DEUX} total={2} />
    </LanguageProvider>,
  )

  fireEvent.wheel(laToile(container), { deltaY: -100, ctrlKey: true })
  expect(screen.getByRole('button', { name: /^Échelle 125 %/ })).toBeInTheDocument()
})

/**
 * Rendre la toile défilante **pour jsdom**, qui ne calcule aucune mise en page : `scrollLeft` y est
 * un zéro perpétuel, donc un ancrage appliqué ne se verrait nulle part.
 *
 * Ce que le double remplace est la seule chose qui manque — un défilement qui retient ce qu'on lui
 * écrit. Il ne simule aucune géométrie : les coordonnées du pointeur sont passées à la main, et
 * c'est l'arithmétique de `zoomALaSouris.test.ts` qui juge le calcul lui-même.
 */
function rendreDefilante(toile: HTMLElement): { valeur: () => number; poser: (n: number) => void } {
  let gauche = 0
  Object.defineProperty(toile, 'scrollLeft', {
    configurable: true,
    get: () => gauche,
    set: (n: number) => {
      gauche = n
    },
  })
  return { valeur: () => gauche, poser: (n) => (gauche = n) }
}

test('un geste qui ne change rien ne laisse pas d’ancrage derrière lui', () => {
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const toile = laToile(container)
  const defilement = rendreDefilante(toile)

  // Jusqu'au plafond : deux crans suffisent, de 100 % à 150 %.
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 })
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 })
  expect(screen.getByRole('button', { name: /^Échelle 150 %/ })).toBeInTheDocument()

  // **Le cran de trop** : au plafond, il ne change pas l'échelle, donc il n'a rien à ancrer.
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 })

  // L'utilisateur défile ensuite ailleurs, puis réduit par le bouton. Un ancrage retenu par le cran
  // de trop serait consommé **ici**, avec le défilement d'avant : la vue sauterait à un endroit que
  // plus rien ne désigne, sur un clic qui n'a rien à voir avec le geste précédent.
  defilement.poser(0)
  fireEvent.click(screen.getByRole('button', { name: 'Réduire le diagramme' }))

  expect(screen.getByRole('button', { name: /^Échelle 125 %/ })).toBeInTheDocument()
  expect(defilement.valeur()).toBe(0)
})

test('le geste garde sous le pointeur le point qui y était', () => {
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const toile = laToile(container)
  const defilement = rendreDefilante(toile)
  defilement.poser(400)

  // **Le contrôle positif** : sans lui, un ancrage qui ne s'appliquerait jamais rendrait le test
  // d'au-dessus vert pour la mauvaise raison — « rien n'a bougé » est justement ce qu'il attend.
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 })

  expect(screen.getByRole('button', { name: /^Échelle 125 %/ })).toBeInTheDocument()
  // (400 + 300) / 1 × 1,25 − 300. L'arithmétique est celle de `defilementAncre`, vérifiée chez elle.
  expect(defilement.valeur()).toBe(575)

  // **Un second cran part de l'échelle *rendue*, non de celle du départ.** C'est le cas courant —
  // on zoome deux fois de suite — et le seul qui distingue une échelle suivie d'une échelle figée
  // au montage : à 1 au lieu de 1,25, le calcul rendrait 1012,5 et le dessin glisserait.
  fireEvent.wheel(toile, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 })
  expect(screen.getByRole('button', { name: /^Échelle 150 %/ })).toBeInTheDocument()
  expect(defilement.valeur()).toBe(750)
  // Et c'est bien **le même point** qui est resté sous le pointeur d'un bout à l'autre du geste.
  expect((575 + 300) / 1.25).toBe(700)
  expect((750 + 300) / 1.5).toBe(700)

  // **Et un ancrage ne sert qu'une fois.** Laissé derrière lui, il serait consommé au prochain
  // changement d'échelle — un bouton, dix minutes plus tard — avec un défilement devenu faux
  // entre-temps : la vue sauterait sans que rien ne l'explique.
  // **Deux crans, et c'est le décor qui l'exige** (règle n° 5) : réduire une fois ramènerait à
  // 125 %, c'est-à-dire exactement l'échelle qu'un des ancrages avait relevée — un ancrage survivant
  // y serait écarté pour la bonne valeur au mauvais motif, et le sabotage resterait vert.
  defilement.poser(0)
  fireEvent.click(screen.getByRole('button', { name: 'Réduire le diagramme' }))
  fireEvent.click(screen.getByRole('button', { name: 'Réduire le diagramme' }))
  expect(screen.getByRole('button', { name: /^Échelle 100 %/ })).toBeInTheDocument()
  expect(defilement.valeur()).toBe(0)
})

test('le pourcentage annonce le geste, sans cesser de nommer son acte', () => {
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)

  // Un geste qu'on ne peut pas deviner n'existe pas — la règle payée au `⌘E` du mode édition et au
  // `⇧`-clic de cette vue. Il est posé sur le pourcentage, seul des trois boutons à n'être jamais
  // désactivé : une infobulle sur un bouton mort est inatteignable (piège n° 3).
  const pourcentage = screen.getByRole('button', { name: /^Échelle 100 %/ })
  expect(pourcentage).toHaveAttribute('title', expect.stringMatching(/molette/))
  // Et l'infobulle **décrit**, elle ne nomme pas (piège n° 4) : le nom reste l'acte du bouton.
  expect(pourcentage).toHaveAccessibleName('Échelle 100 % — revenir à 100 %')
})

test('un schéma sans table le dit ; une lecture en cours dit où elle en est', () => {
  const { unmount } = monter(<DiagramView schema="public" tables={[]} total={0} />)
  expect(screen.getByText('Le schéma public ne contient aucune table.')).toBeInTheDocument()
  unmount()

  // **« Aucune table » n'est pas « pas encore lu »**, comme « jamais tentée » n'est pas « hors
  // ligne » : quatre états, pas deux.
  monter(<DiagramView schema="public" tables={[]} total={9} loading />)
  expect(screen.getByText('Lecture des structures… 0 / 9')).toBeInTheDocument()
})

test('un échec se dit, plutôt que de laisser une toile vide', () => {
  monter(
    <DiagramView
      schema="public"
      tables={[]}
      total={3}
      error="aucune connexion ouverte pour public"
    />,
  )
  expect(screen.getByText('aucune connexion ouverte pour public')).toBeInTheDocument()
})

test('la toile ne rend rien pendant qu’elle attend, mais garde ses gestes après', async () => {
  // Le contrôle positif de l'état vide : les mêmes props avec des tables rendent bien un dessin,
  // sinon les deux tests ci-dessus passeraient aussi sur un composant qui ne rend jamais rien.
  monter(<DiagramView schema="public" tables={DEUX} total={2} loading />)
  expect(screen.getByRole('button', { name: /^orders ·/ })).toBeInTheDocument()
})

// --- La barre d'état ---

test('la barre d’état compte les tables et les liens', () => {
  monter(<DiagramStatusBar tables={DEUX} demandees={2} total={2} />)
  const pied = screen.getByRole('status', { name: 'Résumé du diagramme' })
  expect(pied).toHaveTextContent('2 tables')
  expect(pied).toHaveTextContent('1 lien')
  // Rien de « hors du schéma » quand il n'y a rien à dire : un zéro affiché ferait chercher ce qui
  // manque.
  expect(pied).not.toHaveTextContent('hors du schéma')
})

test('elle compte les clés dont l’autre bout est ailleurs', () => {
  const versAilleurs: EntreeDeTable = {
    ...ORDERS,
    relations: [
      VERS_USERS,
      {
        ...VERS_USERS,
        constraintName: 'orders_snapshot_fkey',
        targetSchema: 'archive',
        targetTable: 'snapshots',
      },
    ],
  }
  monter(<DiagramStatusBar tables={[versAilleurs, USERS]} demandees={2} total={2} />)
  // Un lien qu'on ne peut pas tracer, faute de boîte où arriver. Le taire ferait lire le diagramme
  // comme complet, ce qui est le pire défaut que cette vue puisse avoir.
  expect(screen.getByRole('status')).toHaveTextContent('1 hors du schéma')
})

test('elle distingue « en cours », « plafonné » et « complet »', () => {
  const { unmount } = monter(<DiagramStatusBar tables={[ORDERS]} demandees={2} total={2} />)
  expect(screen.getByRole('status')).toHaveTextContent('1 / 2 tables lues')
  unmount()

  // **Le cas qui manquerait** : la lecture est finie, et le schéma déborde du plafond. Sans ce
  // troisième message, « 60 / 128 » resterait à l'écran pour toujours et se lirait comme une
  // lecture qui n'aboutit pas.
  const { unmount: fermer } = monter(<DiagramStatusBar tables={DEUX} demandees={2} total={128} />)
  expect(screen.getByRole('status')).toHaveTextContent('2 des 128 tables')
  fermer()

  monter(<DiagramStatusBar tables={DEUX} demandees={2} total={2} />)
  expect(screen.getByRole('status')).toHaveTextContent('2 tables')
})

test('une infobulle nomme les tables que le plafond écarte', () => {
  /*
   * **Le compte ne suffisait pas.** « 60 des 124 tables » a suscité exactement la bonne question —
   * « lesquelles ne sont pas affichées ? » — et l'écran ne savait pas y répondre. L'infobulle dit
   * donc le **critère** (l'ordre alphabétique, qui n'est pas un choix de pertinence et doit être
   * avoué) puis **les noms**.
   */
  monter(
    <DiagramStatusBar
      tables={DEUX}
      demandees={2}
      total={4}
      omises={['shipment_batches', 'zz_archives']}
    />,
  )
  const infobulle = screen.getByTitle(/s’arrête à 2 tables/)
  expect(infobulle).toHaveAttribute('title', expect.stringContaining('ordre alphabétique'))
  expect(infobulle).toHaveAttribute(
    'title',
    expect.stringContaining('shipment_batches, zz_archives'),
  )
})

test('elle borne la liste des écartées, pour rester une infobulle', () => {
  // Au-delà de trente noms, une infobulle cesse d'être une infobulle : les premières et le compte
  // du reste suffisent à répondre « lesquelles ? », le tri par nom rendant la suite devinable.
  const beaucoup = Array.from({ length: 42 }, (_, rang) => `t${String(rang).padStart(2, '0')}`)
  monter(<DiagramStatusBar tables={DEUX} demandees={2} total={44} omises={beaucoup} />)

  const titre = screen.getByTitle(/s’arrête à 2 tables/).getAttribute('title') ?? ''
  expect(titre).toContain('t00, t01')
  expect(titre).toContain('(+ 12)')
  // La trente-et-unième n'y est pas : c'est là que la borne coupe.
  expect(titre).not.toContain('t30')
})

test('les liens se comptent une fois quand les deux tables déclarent la même clé', () => {
  // Le catalogue rend la clé des deux côtés ; la compter deux fois annoncerait deux flèches là où
  // le dessin n'en trace qu'une.
  const usersAvecEntrante: EntreeDeTable = {
    ...USERS,
    relations: [
      {
        constraintName: 'orders_user_id_fkey',
        direction: 'incoming',
        cardinality: 'many',
        columns: ['id'],
        targetSchema: 'public',
        targetTable: 'orders',
        targetColumns: ['user_id'],
      },
    ],
  }
  monter(<DiagramStatusBar tables={[ORDERS, usersAvecEntrante]} demandees={2} total={2} />)
  expect(screen.getByRole('status')).toHaveTextContent('1 lien')
})

test('l’infobulle d’une ligne dit son type, sa nullité et ce qu’elle référence', () => {
  monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  // Quatre faits qu'une boîte de 200 px n'a pas la place d'écrire, et que le tracé ne dit pas
  // précisément. Une infobulle **décrit** : c'est un `title`, jamais un `aria-label` (piège n° 4).
  // La cardinalité s'y est ajoutée le 3 septembre 2026 : la marque ne dit rien à qui ne
  // connaît pas la notation, et un `marker` SVG n'a aucun texte qu'une voix puisse rendre.
  expect(
    screen.getByTitle('int8 · jamais nul · référence public.users.id · un à plusieurs'),
  ).toBeInTheDocument()
  expect(screen.getByTitle('text · peut être nul')).toBeInTheDocument()
})

test('deux diagrammes montés ensemble ne partagent pas leurs flèches', () => {
  // Un `id` de `marker` est global au document : deux vues qui les nommeraient pareil feraient
  // pointer les liens de la seconde sur les marques de la première, et changer la sélection dans
  // l'une retinterait les flèches de l'autre.
  const { container } = monter(
    <>
      <DiagramView schema="public" tables={DEUX} total={2} />
      <DiagramView schema="archive" tables={DEUX} total={2} />
    </>,
  )
  const marques = [...container.querySelectorAll('marker')].map((m) => m.id)
  expect(new Set(marques).size).toBe(marques.length)
})

test('aucune couleur littérale n’est posée en style inline', () => {
  // Le garde-fou `pnpm tokens:check` porte sur `tokens.json` ; un `style` en JSX lui échappe. Cette
  // vue en pose beaucoup — les coordonnées de chaque boîte —, et c'est justement l'endroit où une
  // couleur se glisserait sans être vue.
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const styles = [...container.querySelectorAll('[style]')].map((e) => e.getAttribute('style'))
  expect(styles.length).toBeGreaterThan(0)
  for (const style of styles) {
    expect(style).not.toMatch(/#[0-9a-f]{3}|rgb|oklch|color-mix/i)
  }
})

test('le SVG des liens est retiré de l’arbre d’accessibilité', () => {
  // Un tracé n'a pas de nom à annoncer, et ce qu'il dit est déjà dans les lignes des boîtes :
  // l'icône d'une clé étrangère et l'infobulle qui nomme sa cible.
  //
  // **Ce test a d'abord été vert sous sabotage** (règle n° 1). Il cherchait
  // `svg[aria-hidden="true"]` : `Icon` en pose un sur chacun des siens, donc la requête trouvait
  // l'icône d'une clé primaire et non la couche des liens — retirer l'attribut du bon élément ne
  // changeait rien. Le repère est donc `data-liens`, qui ne désigne qu'elle.
  const { container } = monter(<DiagramView schema="public" tables={DEUX} total={2} />)
  const svg = container.querySelector('[data-liens]')
  expect(svg).not.toBeNull()
  expect(svg).toHaveAttribute('aria-hidden', 'true')
  // Le contrôle positif : la couche porte bien des tracés, sinon « masquée » se vérifierait sur un
  // conteneur vide.
  expect(svg?.querySelectorAll('path[d^="M"]').length).toBeGreaterThan(0)
})

test('une lecture qui n’a pas encore commencé n’appelle rien d’elle-même', () => {
  // La vue ne lit pas : elle reçoit. C'est ce qui la rend montable dans la galerie, dans `?demo` et
  // sous Vitest sans qu'aucun pont réponde — et ce qui garde une capture de fidélité stable.
  const espion = vi.fn()
  monter(<DiagramView schema="public" tables={DEUX} total={2} onOuvrirLaTable={espion} />)
  expect(espion).not.toHaveBeenCalled()
})
