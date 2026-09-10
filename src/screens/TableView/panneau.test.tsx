import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type {
  ColumnInfo,
  DatabaseKey,
  Relation,
  RowQuery,
  TableDetail,
  Value,
} from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import type { PasserelleDetail } from '../Workbench/useDetailTable'
import type { Echelle } from './horodatage'
import { RowPanel } from './RowPanel'
import type { PasserelleLignes } from './useLignes'

const CLE: DatabaseKey = { project: 'Halle', database: 'analytics', environment: 'prod' }

const colonne = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  position: 1,
  name,
  typeName: 'text',
  category: 'text',
  nullable: true,
  default: null,
  identity: null,
  key: null,
  comment: null,
  frequency: null,
  ...over,
})

const COLONNES = [
  colonne('id', { category: 'number', key: 'primary' }),
  colonne('user_id', { category: 'number', key: 'foreign' }),
  colonne('status'),
  // **Une colonne nulle et une valeur longue, délibérément.** Sans elles, deux mesures de `10f` ne
  // mordraient pas : celle qui distingue « `NULL` affiché » de « chaîne vide copiée », et celle qui
  // vérifie que l'aperçu montre en entier ce que l'ellipse a coupé.
  colonne('shipped_at', { category: 'timestamp', nullable: true }),
  colonne('reference'),
]

const RELATION: Relation = {
  constraintName: 'orders_user_id_fkey',
  direction: 'outgoing',
  cardinality: 'many',
  columns: ['user_id'],
  targetSchema: 'public',
  targetTable: 'users',
  targetColumns: ['id'],
}

/**
 * **Une entrante en plus de la sortante, et c'est le décor qui rend le défaut visible** (règle n° 5).
 *
 * Avec la seule sortante, « chaque lien est écrit sur sa colonne » passerait sur une implémentation
 * qui ne saurait traiter qu'un sens — et c'est précisément l'erreur naturelle, `relationDe` ne
 * rendant que les sortantes.
 */
const RELATION_ENTRANTE: Relation = {
  constraintName: 'order_items_order_id_fkey',
  direction: 'incoming',
  cardinality: 'many',
  // Pour une entrante, `columns` est la colonne de **cette** table, celle qui est référencée.
  columns: ['id'],
  targetSchema: 'public',
  targetTable: 'order_items',
  targetColumns: ['order_id'],
}

const REFERENCE_LONGUE = '041ff6ac-ca09-4c57-b1fe-e4055c074abf-suite-qui-deborde-de-la-colonne'

const LIGNE: Value[] = [
  { kind: 'int', value: 184_220 },
  { kind: 'int', value: 90_233 },
  { kind: 'text', value: 'paid' },
  { kind: 'null' },
  { kind: 'text', value: REFERENCE_LONGUE },
]

function detail(colonnesCible: ColumnInfo[]): TableDetail {
  return {
    schema: 'public',
    name: 'users',
    rows: { kind: 'estimated', value: 100 },
    sizeBytes: null,
    comment: null,
    columns: colonnesCible,
    indexes: [],
    constraints: [],
    triggers: [],
    relations: [],
    ddl: '',
  }
}

type Options = {
  /** Les colonnes de la table **cible**, qui décident si l'aperçu est autorisé. */
  colonnesCible?: ColumnInfo[]
  relations?: Relation[]
  columns?: ColumnInfo[]
  ligne?: Value[] | null
  rang?: number | null
  total?: number
  onCopyInsert?: () => void
  onNavigate?: (rang: number) => void
  lectures?: Readonly<Record<string, Echelle>>
}

function monter({
  colonnesCible = [colonne('id'), colonne('email')],
  relations = [RELATION],
  columns = COLONNES,
  ligne = LIGNE,
  rang = 1,
  onCopyInsert,
  lectures,
}: Options = {}) {
  const readRows = vi.fn(async (_cle: DatabaseKey, _requete: RowQuery) => ({
    offset: 0,
    rows: [
      [
        { kind: 'int' as const, value: 90_233 },
        { kind: 'text' as const, value: 'marie.l@example.com' },
      ],
    ],
    total: null,
    sql: 'select …',
    durationMs: 41,
  }))
  const describeTable = vi.fn(async () => detail(colonnesCible))

  const rendu = render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <RowPanel
          cle={CLE}
          columns={columns}
          relations={relations}
          ligne={ligne}
          lectures={lectures}
          rang={rang}
          onCopyInsert={onCopyInsert}
          passerelleDetail={{ describeTable } as unknown as PasserelleDetail}
          passerelleLignes={{ readRows } as unknown as PasserelleLignes}
        />
      </LanguageProvider>
    </>,
  )
  return { readRows, describeTable, rendu }
}

/**
 * Le bloc d'un champ, depuis le nom de sa colonne.
 *
 * Par le `<dt>` et non par un `[class*=]` : c'est le terme, et son bloc est son parent. Un sélecteur
 * de classe se périmerait au premier renommage de la feuille de style.
 */
/** La section « Liens », par son titre — le seul en-tête du panneau. */
function sectionDesLiens(): HTMLElement {
  return screen.getByRole('heading', { name: 'Liens' }).parentElement as HTMLElement
}

function champDe(colonne: string): HTMLElement {
  const terme = screen
    .getAllByRole('term')
    .find((dt) => dt.querySelector('[data-nom]')?.textContent === colonne)
  if (!terme) throw new Error(`aucun champ « ${colonne} » dans le panneau`)
  return terme.parentElement as HTMLElement
}

describe('panneau de ligne', () => {
  it('sans sélection, il ne rend rien du tout', () => {
    const { rendu } = monter({ ligne: null, rang: null })
    // **Rien, et non une phrase.** « Sélectionnez une ligne pour en voir le détail. » y était ; depuis
    // `22`, l'en-tête permanent de la colonne rend celle-ci lisible sans elle, et une phrase qui
    // décrit un geste évident finit par se lire comme du remplissage. C'est le cadre qui est vérifié
    // dans `ColonneDroite.test.tsx` : l'en-tête, lui, reste.
    expect(rendu.container.querySelector('aside')).toBeNull()
  })

  // **Trois tests ont disparu avec l'en-tête, et non été « adaptés ».** Ils vérifiaient que le titre
  // nomme le rang et la clé primaire, et qu'une table sans clé primaire n'invente pas d'identifiant.
  // Ce titre n'existe plus (`22`) : le rang est dans la gouttière `#` de la grille, l'identifiant est
  // la première valeur du corps. Les flèches, elles, sont mesurées dans `ColonneDroite.test.tsx`.

  it('la lecture d’une colonne d’entiers suit celle de la grille', () => {
    // **Le panneau et la grille montrent la même cellule.** Deux lectures divergentes du même
    // entier — l'une en date, l'autre en nombre — se liraient comme un défaut de lecture, et c'est
    // le motif de la sélection, pilotée depuis l'écran pour la même raison.
    monter({ lectures: { id: 'secondes' } })

    // `id` vaut 184 220 : lu en secondes, c'est le 5 janvier 1970.
    expect(screen.getByText('1970-01-03 03:10:20')).toBeInTheDocument()
    expect(screen.queryByText('184 220')).toBeNull()
    // `user_id` est numérique aussi, et rien ne l'a touché : la lecture suit la colonne.
    expect(screen.getByText('90 233')).toBeInTheDocument()
  })

  it('l’onglet JSON ignore la lecture : c’est le document qui se réécrit', async () => {
    // Une date y remplacerait la valeur stockée, et `documentJson` sert aussi l'éditeur de document
    // (`18g`), qui écrit.
    const utilisateur = userEvent.setup()
    monter({ lectures: { id: 'secondes' } })
    await utilisateur.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(screen.getByText(/184220/)).toBeInTheDocument()
  })

  it('l’onglet JSON rend la ligne en objet typé', async () => {
    const utilisateur = userEvent.setup()
    monter()

    await utilisateur.click(screen.getByRole('tab', { name: 'JSON' }))
    // Le texte du **bloc**, et non d'un fragment : `JsonColore` découpe le JSON en `<span>` pour
    // le colorer, donc chercher par texte ne trouverait qu'un jeton.
    const bloc = screen.getByLabelText('Détail de la ligne 1').querySelector('pre')
    // Un nombre reste un nombre : un JSON dont tout serait chaîne ne se recollerait nulle part.
    expect(bloc?.textContent).toContain('"id": 184220')
    expect(bloc?.textContent).toContain('"status": "paid"')
  })

  it('le bouton copie le JSON de la ligne, reparsable et complet', async () => {
    const utilisateur = userEvent.setup()
    const columnsAttendues = COLONNES.length
    // Le paramètre est typé : sans lui, `mock.calls[0]` est un tuple vide et l'accès à `[0]` ne
    // compile pas — `pnpm typecheck` l'a dit, `pnpm vitest` non (défaut n° 50).
    const writeText = vi.fn(async (_texte: string) => {})
    // `navigator.clipboard` n'a qu'un accesseur sous jsdom : `Object.assign` échoue, il faut
    // redéfinir la propriété.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    monter()

    await utilisateur.click(screen.getByRole('tab', { name: 'JSON' }))
    await utilisateur.click(screen.getByRole('button', { name: 'Copier le JSON de la ligne' }))

    const copie = writeText.mock.calls[0]?.[0] ?? ''
    // Le JSON copié se reparse, avec les types de la ligne : c'est la propriété qui compte pour un
    // texte destiné à être recollé ailleurs.
    expect(JSON.parse(copie)).toMatchObject({ id: 184220, status: 'paid' })
    // Et l'objet est **entier** — les huit colonnes, pas celles qui tiennent à l'écran.
    expect(Object.keys(JSON.parse(copie))).toHaveLength(columnsAttendues)

    // **Ce que ce test ne prouve pas.** Le bouton copie le texte source plutôt que le rendu de
    // `JsonColore` — un choix, puisque le rendu est découpé en `<span>` pour la coloration. Mais un
    // sabotage qui copie `textContent` du bloc affiché **passe** : `textContent` recolle les fragments
    // à l'identique. La distinction n'est donc pas observable ici, et prétendre le contraire dans un
    // commentaire de test serait une garantie inventée.
  })

  /** Le presse-papiers, remplacé par un espion. */
  function espionnerLePressePapiers() {
    const writeText = vi.fn(async (_texte: string) => {})
    // `navigator.clipboard` n'a qu'un accesseur sous jsdom : `Object.assign` échoue, il faut
    // redéfinir la propriété.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  /** La cellule de valeur d'un champ, par le nom de sa colonne. */
  function valeurDe(colonne: string) {
    return champDe(colonne).querySelector('dd') as HTMLElement
  }

  it('le clic droit sur la valeur copie la valeur, telle qu’elle s’affiche', async () => {
    const utilisateur = userEvent.setup()
    const writeText = espionnerLePressePapiers()
    monter()

    await utilisateur.pointer({ target: valeurDe('status'), keys: '[MouseRight]' })

    const menu = screen.getByRole('menu', { name: /la valeur de status/ })
    await utilisateur.click(within(menu).getByRole('menuitem', { name: 'Copier la valeur' }))
    expect(writeText).toHaveBeenCalledWith('paid')
  })

  it('le clic droit sur la clé copie la clé, et le libellé le dit', async () => {
    const utilisateur = userEvent.setup()
    const writeText = espionnerLePressePapiers()
    monter()

    await utilisateur.pointer({ target: screen.getByText('status'), keys: '[MouseRight]' })

    // **Le libellé nomme ce qui sera copié**, pas l'endroit du clic : un libellé unique obligerait à
    // se souvenir de ce qu'on visait.
    const menu = screen.getByRole('menu', { name: /la clé de status/ })
    await utilisateur.click(within(menu).getByRole('menuitem', { name: 'Copier la clé' }))
    expect(writeText).toHaveBeenCalledWith('status')
  })

  it('la valeur copiée est celle qu’on lit, `NULL` comprise', async () => {
    const utilisateur = userEvent.setup()
    const writeText = espionnerLePressePapiers()
    monter()

    // **Le cas qui distingue « ce qu'on lit » de « la valeur brute ».** Une cellule nulle affiche
    // `NULL` ; copier une chaîne vide donnerait un presse-papiers qui ne dit pas la même chose que
    // l'écran, et coller ce vide dans une requête produirait autre chose que ce qui était visé.
    await utilisateur.pointer({ target: valeurDe('shipped_at'), keys: '[MouseRight]' })
    await utilisateur.click(screen.getByRole('menuitem', { name: 'Copier la valeur' }))
    expect(writeText).toHaveBeenCalledWith('NULL')
  })

  it('le menu se referme sur `Échap` sans rien copier', async () => {
    const utilisateur = userEvent.setup()
    const writeText = espionnerLePressePapiers()
    monter()

    await utilisateur.pointer({ target: valeurDe('status'), keys: '[MouseRight]' })
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await utilisateur.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('le bouton de copie du JSON n’apparaît que sur l’onglet JSON', async () => {
    const utilisateur = userEvent.setup()
    monter()
    // Sur Champs, il n'y a pas de JSON à copier — et un bouton qui copierait « la ligne » depuis un
    // onglet qui ne la montre pas en JSON serait une promesse sur un format invisible.
    expect(screen.queryByRole('button', { name: 'Copier le JSON de la ligne' })).toBeNull()

    await utilisateur.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(screen.getByRole('button', { name: 'Copier le JSON de la ligne' })).toBeInTheDocument()
  })

  /**
   * **Deux onglets, et le troisième n'a pas été perdu en route** (`API-49`).
   *
   * « Liens » était un onglet à part, donc un endroit où l'on n'allait pas ; c'est une **section**
   * de l'onglet « Champs », sous la liste. Ce test garde les deux moitiés du changement : l'onglet
   * n'existe plus, et les relations se lisent sans changer d'onglet — un compte qui tomberait à zéro
   * serait le pire résultat possible, une information tue sans que rien l'annonce.
   */
  it('« Liens » est une section de l’onglet Champs, plus un onglet', async () => {
    monter({ relations: [RELATION, RELATION_ENTRANTE] })

    expect(screen.queryByRole('tab', { name: 'Liens' })).toBeNull()
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    const liens = sectionDesLiens()
    // **Chaque ligne renomme sa colonne**, puisqu'elle n'est plus à côté d'elle : sans ce nom, la
    // section serait une liste de destinations sans départ.
    expect(within(liens).getByText('user_id')).toBeInTheDocument()
    expect(within(liens).getByText('users.id')).toBeInTheDocument()
    expect(within(liens).getByText('order_items.order_id')).toBeInTheDocument()

    // **Le sens n'est pas porté par la couleur seule** : la flèche est masquée aux voix, un verbe
    // la remplace, et c'est lui qui dit laquelle référence l'autre (pièges n° 1 et n° 2).
    expect(within(liens).getByText('référence', { exact: false })).toBeInTheDocument()
    expect(within(liens).getByText('est référencée par', { exact: false })).toBeInTheDocument()

    // **Et les deux sections sont bien deux**, dans cet ordre : la clé de `user_id` ne porte plus
    // son lien. Le mesurer sur le champ, et non sur la page, est ce qui distingue « déplacé » de
    // « dupliqué » — les deux laisseraient les assertions ci-dessus vertes.
    expect(within(champDe('user_id')).queryByText('users.id')).toBeNull()
  })

  it('la section des liens suit l’ordre des champs, et disparaît quand il n’y en a pas', () => {
    // L'entrante porte `id`, la sortante `user_id` : le moteur les rend dans l'autre ordre, et
    // c'est le catalogue qui décide, pour qu'un champ soit à la même place dans les deux sections.
    monter({ relations: [RELATION, RELATION_ENTRANTE] })
    const departs = within(sectionDesLiens())
      .getAllByText(/^(id|user_id)$/)
      .map((element) => element.textContent)
    expect(departs).toEqual(['id', 'user_id'])

    // **Rien plutôt qu'une section vide.** Une phrase « aucune clé étrangère » occuperait de la
    // place pour dire ce que son absence dit déjà.
    cleanup()
    monter({ relations: [] })
    expect(screen.queryByRole('heading', { name: 'Liens' })).toBeNull()
  })

  it('chaque clé porte le glyphe de sa catégorie', () => {
    monter()

    // Le même glyphe que la section « Colonnes de » de la sidebar, décidé au même endroit —
    // `glypheDeType`. Deux tables de glyphes divergeraient au premier type ajouté.
    expect(within(champDe('id')).getByText('#')).toBeInTheDocument()
    expect(within(champDe('status')).getByText('T')).toBeInTheDocument()
    expect(within(champDe('shipped_at')).getByText('⏱')).toBeInTheDocument()
  })
})

describe('règle « ligne liée »', () => {
  it('affiche l’aperçu quand la table cible porte un champ lisible', async () => {
    monter({ colonnesCible: [colonne('id'), colonne('email')] })

    expect(await screen.findByText(/Ligne liée · users/)).toBeInTheDocument()
    expect(screen.getByText('marie.l@example.com')).toBeInTheDocument()
    // La légende nomme les champs réellement détectés.
    expect(screen.getByText(/email détecté/)).toBeInTheDocument()
  })

  it('n’affiche **aucun** aperçu quand la table cible n’a que des identifiants techniques', async () => {
    // **Le bord qui compte, et celui qu'on oublie de tester.** Un aperçu automatique qui déverse
    // une ligne référencée transforme un clic distrait en fuite de données.
    const { readRows } = monter({ colonnesCible: [colonne('id'), colonne('tenant_id')] })

    await waitFor(() => expect(screen.getByLabelText('Détail de la ligne 1')).toBeInTheDocument())
    expect(screen.queryByText(/Ligne liée/)).not.toBeInTheDocument()

    // Et surtout : la ligne cible n'a **pas été lue**. La règle s'applique avant la lecture, pas
    // après — sinon les données auraient traversé l'IPC pour être ensuite masquées.
    expect(readRows).not.toHaveBeenCalled()
  })

  it('sans clé étrangère, aucun aperçu et aucune lecture supplémentaire', async () => {
    const { describeTable } = monter({ relations: [] })

    await waitFor(() => expect(screen.getByLabelText('Détail de la ligne 1')).toBeInTheDocument())
    expect(screen.queryByText(/Ligne liée/)).not.toBeInTheDocument()
    expect(describeTable).not.toHaveBeenCalled()
  })
})

describe('copier en INSERT', () => {
  it('le bouton délègue, il ne compose pas le SQL', async () => {
    const utilisateur = userEvent.setup()
    const onCopyInsert = vi.fn()
    monter({ onCopyInsert })

    await utilisateur.click(screen.getByRole('button', { name: /Copier la ligne en INSERT/ }))
    expect(onCopyInsert).toHaveBeenCalledTimes(1)
  })

  it('sans commande, le bouton n’est pas rendu', () => {
    monter()
    expect(screen.queryByRole('button', { name: /Copier la ligne/ })).not.toBeInTheDocument()
  })
})
