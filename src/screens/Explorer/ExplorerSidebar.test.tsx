import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionId, FolderTree } from '../../domain/config'
import type { ColumnInfo, ConnectionState, SchemaInfo, TableSummary } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { arbreDeTest, connexionDeTest, ID_DE_TEST, trioDeTest } from '../NewConnection/pourLesTests'
import { type Charge, idBase, idDossier, idSchema, type Noeud } from './arbre'
import type { CibleDeSuppression } from './DeleteConnectionDialog'
import { ExplorerSidebar, type ExplorerSidebarProps, filtrer } from './ExplorerSidebar'

const ANALYTICS = 'c0000000000000a1'
const SHOP = 'c0000000000000a2'

/**
 * **Les deux connexions sont dans le même dossier** : le décor mesure le menu « … », le filtre et le
 * renommage de console, pas l'imbrication — `arbre.test.ts` s'en charge. Les regrouper évite de
 * déplier deux branches dans chaque test.
 */
const ARBRE: FolderTree = arbreDeTest(
  trioDeTest({
    prod: [
      connexionDeTest(ANALYTICS, 'analytics'),
      connexionDeTest(SHOP, 'shop', { engine: 'mysql' }),
    ],
  }),
)

const schema = (name: string, over: Partial<SchemaInfo> = {}): SchemaInfo => ({
  name,
  owner: 'atelier',
  system: false,
  counts: { tables: 1, views: 0, functions: 0, indexes: 0 },
  ...over,
})
const table = (name: string): TableSummary => ({
  name,
  kind: 'table',
  rows: { kind: 'estimated', value: 1000 },
  sizeBytes: 1024,
  columnCount: 3,
  primaryKey: 'id',
  lastAnalyze: null,
  comment: null,
})

const RIEN: Charge = { schemas: {}, objets: {}, enCours: new Set(), echecs: {} }

const ID_PROJET = idDossier(ID_DE_TEST.racine)
const ID_PROD = idDossier(ID_DE_TEST.prod)
const ID_ANALYTICS = idBase(ANALYTICS)
const ID_PUBLIC = idSchema(ANALYTICS, 'public')

/** Le dossier racine et son sous-dossier `prod` dépliés : la porte d'entrée des connexions. */
const JUSQU_AUX_CONNEXIONS = [ID_PROJET, ID_PROD]

/**
 * La ligne d'arbre dont le libellé est `label`, au palier `niveau`.
 *
 * Le nom accessible d'une ligne porte aussi sa méta et son badge — « prod PROD », « dev 0
 * connexion » — donc une expression régulière ancrée sur le seul libellé ne trouve rien, et une
 * non ancrée confond « Atelier » avec « Atelier Nord ». Le palier lève l'ambiguïté.
 */
function ligne(label: string, niveau: string): HTMLElement {
  const trouvee = screen
    .getAllByRole('treeitem')
    .find(
      (e) =>
        e.getAttribute('aria-level') === niveau &&
        (e.textContent === label || e.textContent?.startsWith(`${label} `) === true),
    )
  if (trouvee === undefined) throw new Error(`aucune ligne « ${label} » au palier ${niveau}`)
  return trouvee
}

function Piloté({
  charge = RIEN,
  initial = [] as string[],
  etat = { kind: 'never' } as ConnectionState,
  onToggleSpy,
  onEditDatabase,
  onRenameDatabase,
  onImportProjects,
  onExportFolder,
  onDelete,
  modificationsEnAttenteDe,
  onRefresh,
  consoles,
  onAddDatabase,
  onNewFolder,
  onRenameFolder,
  onRecolorFolder,
  onSetFolderIcon,
  onSetFolderReadOnly,
  onOpenPreferences,
  onOpenDiagram,
  onManageSchemas,
  onMove,
  arbre = ARBRE,
}: {
  charge?: Charge
  initial?: string[]
  etat?: ConnectionState
  onToggleSpy?: (n: Noeud) => void
  onEditDatabase?: (connection: ConnectionId) => void
  onRenameDatabase?: ExplorerSidebarProps['onRenameDatabase']
  onImportProjects?: () => void
  onExportFolder?: ExplorerSidebarProps['onExportFolder']
  onDelete?: (cible: CibleDeSuppression) => Promise<{ leftoverSecrets: string[] }>
  modificationsEnAttenteDe?: (cible: CibleDeSuppression) => number
  onRefresh?: () => void
  consoles?: ExplorerSidebarProps['consoles']
  onAddDatabase?: ExplorerSidebarProps['onAddDatabase']
  onNewFolder?: ExplorerSidebarProps['onNewFolder']
  onRenameFolder?: ExplorerSidebarProps['onRenameFolder']
  onRecolorFolder?: ExplorerSidebarProps['onRecolorFolder']
  onSetFolderIcon?: ExplorerSidebarProps['onSetFolderIcon']
  onSetFolderReadOnly?: ExplorerSidebarProps['onSetFolderReadOnly']
  onOpenPreferences?: () => void
  onOpenDiagram?: ExplorerSidebarProps['onOpenDiagram']
  onManageSchemas?: ExplorerSidebarProps['onManageSchemas']
  onMove?: ExplorerSidebarProps['onMove']
  arbre?: FolderTree
}) {
  const [deplies, setDeplies] = useState(new Set(initial))
  const [choisi, setChoisi] = useState<string | null>(null)
  return (
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <ExplorerSidebar
          arbre={arbre}
          deplies={deplies}
          charge={charge}
          etatDe={() => etat}
          selectedId={choisi}
          onEditDatabase={onEditDatabase}
          onRenameDatabase={onRenameDatabase}
          onImportProjects={onImportProjects}
          onExportFolder={onExportFolder}
          onDelete={onDelete}
          modificationsEnAttenteDe={modificationsEnAttenteDe}
          onRefresh={onRefresh}
          consoles={consoles}
          onAddDatabase={onAddDatabase}
          onNewFolder={onNewFolder}
          onRenameFolder={onRenameFolder}
          onRecolorFolder={onRecolorFolder}
          onSetFolderIcon={onSetFolderIcon}
          onSetFolderReadOnly={onSetFolderReadOnly}
          onOpenPreferences={onOpenPreferences}
          onOpenDiagram={onOpenDiagram}
          onManageSchemas={onManageSchemas}
          onMove={onMove}
          onSelect={(n) => setChoisi(n.id)}
          onToggle={(n) => {
            onToggleSpy?.(n)
            setDeplies((precedent) => {
              const suivant = new Set(precedent)
              if (suivant.has(n.id)) suivant.delete(n.id)
              else suivant.add(n.id)
              return suivant
            })
          }}
        />
      </LanguageProvider>
    </>
  )
}

// --- L'arbre ---

test('l’arbre s’annonce comme tel, avec ses niveaux', () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} />)
  // **« environnements » est dans le nom de l'arbre** depuis `25a` : c'est un palier, et l'annoncer
  // « Projets et bases » tairait ce qu'on parcourt.
  expect(screen.getByRole('tree', { name: 'Dossiers et connexions' })).toBeInTheDocument()
  const elements = screen.getAllByRole('treeitem')
  // L'arbre est aplati dans le DOM : `aria-level` porte la profondeur qu'une imbrication aurait
  // donnée gratuitement. Sans lui, un lecteur d'écran annoncerait une liste plate.
  //
  // Projet, ses trois environnements déclarés, puis les deux connexions de `prod` : les
  // environnements sont au niveau 2, les connexions au 3.
  expect(elements.map((e) => e.getAttribute('aria-level'))).toEqual(['1', '2', '2', '2', '3', '3'])
})

// Les cinq paliers, jusqu'au bout : projet, environnement, connexion, schéma, objet.
test('les cinq paliers s’annoncent de 1 à 5', () => {
  render(
    <Piloté
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS, ID_PUBLIC]}
      charge={{
        ...RIEN,
        schemas: { [ID_ANALYTICS]: [schema('public')] },
        objets: { [ID_PUBLIC]: [table('orders')] },
      }}
    />,
  )
  // `ligne` cherche par palier ; ces appels échouent donc si l'un des cinq manque.
  expect(ligne('Atelier Nord', '1')).toBeInTheDocument()
  expect(ligne('prod', '2')).toBeInTheDocument()
  expect(ligne('analytics', '3')).toBeInTheDocument()
  expect(ligne('public', '4')).toBeInTheDocument()
  expect(ligne('orders', '5')).toBeInTheDocument()
})

test('un nœud dépliable annonce son état, une feuille non', () => {
  render(
    <Piloté
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS, ID_PUBLIC]}
      charge={{
        ...RIEN,
        schemas: { [ID_ANALYTICS]: [schema('public')] },
        objets: { [ID_PUBLIC]: [table('orders')] },
      }}
    />,
  )
  expect(screen.getByRole('treeitem', { name: /^Atelier Nord/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  // Un objet est une feuille : `aria-expanded` sur une feuille annoncerait un enfant inexistant.
  expect(screen.getByRole('treeitem', { name: /orders/ })).not.toHaveAttribute('aria-expanded')
})

// **La contrainte transverse.** Un schéma replié ne produit aucun nœud enfant, donc l'écran n'a
// rien à demander : c'est ce que le compteur vérifie.
test('déplier un dossier ne demande rien pour les schémas', async () => {
  const deplies: Noeud[] = []
  render(<Piloté onToggleSpy={(n) => deplies.push(n)} />)

  await userEvent.dblClick(screen.getByRole('treeitem', { name: /Atelier Nord/ }))

  expect(deplies).toHaveLength(1)
  expect(deplies[0]?.kind).toBe('folder')
  // Aucune base dépliée, donc aucune demande de schémas.
  expect(deplies.filter((n) => n.kind === 'database')).toHaveLength(0)
})

/**
 * Le dépliage, détaché du clic simple.
 *
 * Le clic faisait les deux, et regarder une connexion refermait le sous-arbre qu'on venait
 * d'ouvrir. Trois gestes désormais : le clic **sélectionne**, la flèche et le double-clic
 * **déplient**. Les quatre tests qui suivent couvrent les trois, plus le clavier — sans lui,
 * déplier serait devenu impossible sans souris.
 */
describe('le dépliage n’est plus le clic', () => {
  const flecheDe = (ligne: HTMLElement) => ligne.querySelector('[data-chevron-zone]') as HTMLElement

  test('un clic sélectionne, et ne déplie pas', async () => {
    const deplies: Noeud[] = []
    render(<Piloté onToggleSpy={(n) => deplies.push(n)} />)
    await userEvent.click(screen.getByRole('treeitem', { name: /Atelier Nord/ }))

    const ligne = screen.getByRole('treeitem', { name: /Atelier Nord/ })
    expect(ligne).toHaveAttribute('aria-selected', 'true')
    expect(ligne).toHaveAttribute('aria-expanded', 'false')
    expect(deplies).toHaveLength(0)
  })

  test('un clic sur la flèche déplie, sans changer la sélection', async () => {
    render(<Piloté />)
    await userEvent.click(flecheDe(screen.getByRole('treeitem', { name: /Atelier Nord/ })))

    const ligne = screen.getByRole('treeitem', { name: /Atelier Nord/ })
    expect(ligne).toHaveAttribute('aria-expanded', 'true')
    // La flèche ouvre ; elle ne désigne pas. Sélectionner au passage déplacerait le centre de
    // l'écran pour un geste qui ne parlait que de l'arbre.
    expect(ligne).toHaveAttribute('aria-selected', 'false')
  })

  test('un double-clic déplie, et la ligne finit sélectionnée', async () => {
    render(<Piloté />)
    await userEvent.dblClick(screen.getByRole('treeitem', { name: /Atelier Nord/ }))

    const ligne = screen.getByRole('treeitem', { name: /Atelier Nord/ })
    expect(ligne).toHaveAttribute('aria-expanded', 'true')
    // Les deux clics du geste sélectionnent d'abord : c'est ce que le double-clic veut dire aussi.
    expect(ligne).toHaveAttribute('aria-selected', 'true')
  })

  test('les flèches du clavier déplient et replient', async () => {
    render(<Piloté />)
    const ligne = screen.getByRole('treeitem', { name: /Atelier Nord/ })
    ligne.focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('treeitem', { name: /Atelier Nord/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('treeitem', { name: /Atelier Nord/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

// --- Les échecs ---

test('un dépliage qui échoue le dit sans vider l’arbre', () => {
  render(
    <Piloté
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      charge={{ ...RIEN, echecs: { [ID_ANALYTICS]: 'hôte injoignable' } }}
    />,
  )
  expect(screen.getByText('hôte injoignable')).toBeInTheDocument()
  // L'autre base est toujours là.
  expect(screen.getByRole('treeitem', { name: /shop/ })).toBeInTheDocument()
})

// Une ligne de message n'est **pas** un `treeitem` : ce n'est pas un nœud de l'arbre mais un état
// de son chargement, et l'annoncer comme tel ferait compter un enfant qui n'existe pas.
test('une ligne de message n’est pas un nœud de l’arbre', () => {
  render(
    <Piloté
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      charge={{ ...RIEN, enCours: new Set([ID_ANALYTICS]) }}
    />,
  )
  expect(screen.getByText('Chargement…')).toBeInTheDocument()
  expect(screen.queryByRole('treeitem', { name: 'Chargement…' })).not.toBeInTheDocument()
})

/*
 * **L'indentation d'une ligne de message vient d'`INDENT`, non d'une table CSS** (`25a`).
 *
 * Trois règles `.message[data-depth=…]` recopiaient les mêmes 36 et 52 px. Un palier de retard entre
 * les deux tables se lit comme un message mal aligné, et personne n'y pense en ajoutant un palier.
 * Le style en ligne est donc ce qui est testable ici — jsdom ne calcule pas le CSS.
 */
test('une ligne de message est indentée par la règle de TreeRow, en style en ligne', () => {
  render(
    <Piloté
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      charge={{ ...RIEN, enCours: new Set([ID_ANALYTICS]) }}
    />,
  )
  // Un message enfant d'une connexion (niveau 2) est sous elle : `indentation(2, 1)`.
  expect(screen.getByText('Chargement…')).toHaveStyle({ paddingLeft: '52px' })
})

// **Un dossier vide le dit**, à l'indentation de ses enfants : `staging` est au niveau 1.
test('un dossier déplié sans contenu le dit, aligné sur ses enfants', () => {
  render(<Piloté initial={[ID_PROJET, idDossier(ID_DE_TEST.staging)]} />)
  const vide = screen.getByText('Dossier vide')
  expect(vide).toHaveStyle({ paddingLeft: '36px' })
  // Ce n'est pas un nœud de l'arbre : c'est un fait sur son contenu.
  expect(screen.queryByRole('treeitem', { name: /Dossier vide/ })).toBeNull()
})

// --- Les états de connexion ---

test('l’état d’une base est dans son nom accessible, pas seulement en couleur', () => {
  render(
    <Piloté
      initial={JUSQU_AUX_CONNEXIONS}
      etat={{ kind: 'offline', reason: 'hôte injoignable' }}
    />,
  )
  expect(
    screen.getByRole('treeitem', { name: /analytics · hors ligne : hôte injoignable/ }),
  ).toBeInTheDocument()
})

// --- Les dossiers (#166) ---

test('le verrou suit le dossier qui déclare la lecture seule, et s’entend', () => {
  render(<Piloté initial={[ID_PROJET]} />)
  // `prod` la déclare : sa ligne porte le verrou, et le dit dans son nom accessible.
  const prod = screen.getByRole('treeitem', { name: 'prod · lecture seule' })
  expect(prod.querySelector('use[href="#i-lock"]')).not.toBeNull()
  expect(ligne('dev', '2').querySelector('use[href="#i-lock"]')).toBeNull()
  // Le badge `PROD` des environnements est parti avec eux.
  expect(prod).not.toHaveTextContent('PROD')
})

test('un dossier replié dit son compte de connexions, à toute profondeur', () => {
  render(<Piloté />)
  expect(screen.getByRole('treeitem', { name: /Atelier Nord/ })).toHaveTextContent('2 connexions')
})

// --- Le filtre ---

// **Les ancêtres d'une correspondance sont conservés** : filtrer sur « orders » sans garder son
// schéma et sa base produirait une ligne orpheline, indentée sans parent visible.
test('le filtre garde les ancêtres d’une correspondance', () => {
  // Cinq paliers depuis `25a` : l'environnement est un ancêtre à conserver comme les autres.
  const noeuds: Noeud[] = [
    { id: 'p', kind: 'folder', depth: 0, indent: '', label: 'Halle' },
    { id: 'e', kind: 'folder', depth: 1, indent: '', label: 'Atelier' },
    { id: 'd', kind: 'database', depth: 2, indent: '', label: 'analytics' },
    { id: 's', kind: 'schema', depth: 3, indent: '', label: 'public' },
    { id: 'o', kind: 'object', depth: 4, indent: '', label: 'orders' },
    { id: 'o2', kind: 'object', depth: 4, indent: '', label: 'users' },
  ]
  expect(filtrer(noeuds, 'orders').map((n) => n.id)).toEqual(['p', 'e', 'd', 's', 'o'])
})

test('un filtre vide ne retire rien', () => {
  const noeuds: Noeud[] = [{ id: 'p', kind: 'folder', depth: 0, indent: '', label: 'Halle' }]
  expect(filtrer(noeuds, '   ')).toHaveLength(1)
})

test('le filtre ignore la casse', () => {
  const noeuds: Noeud[] = [{ id: 'p', kind: 'folder', depth: 0, indent: '', label: 'Atelier' }]
  expect(filtrer(noeuds, 'ATELIER')).toHaveLength(1)
})

// Une ligne de message ne doit pas « correspondre » : filtrer sur « chargement » ferait
// apparaître des états au lieu de données.
test('le filtre ne fait pas correspondre les lignes de message', () => {
  const noeuds: Noeud[] = [
    { id: 'p', kind: 'folder', depth: 0, indent: '', label: 'Halle' },
    { id: 'm', kind: 'message', depth: 2, indent: '', label: 'Chargement…', message: true },
  ]
  expect(filtrer(noeuds, 'chargement')).toHaveLength(0)
})

test('un filtre sans résultat le dit', async () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} />)
  await userEvent.type(screen.getByLabelText(/Filtrer/), 'zzz')
  expect(screen.getByText(/Aucune ligne affichée ne correspond/)).toBeInTheDocument()
})

// Le compteur `n/m` de `04` rappelle implicitement que le filtre porte sur ce qui est affiché.
test('le filtre affiche son compteur, et seulement quand il est actif', async () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} />)
  expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Filtrer/), 'analytics')
  // Six lignes affichées — le dossier racine, trois sous-dossiers, deux connexions — dont trois
  // retenues : `analytics` et ses deux ancêtres.
  expect(screen.getByText('3/6')).toBeInTheDocument()
})

// --- Le pied ---

test('la colonne n’a plus de pied du tout', () => {
  render(<Piloté onAddDatabase={() => {}} onNewFolder={async () => 'f-neuf'} />)
  // **Le pied a disparu le 26 août 2026.** « Ajouter une connexion » y devait deviner l'environnement
  // et vit désormais dans le menu du palier qui le sait ; « Nouveau dossier » est monté dans la bande
  // d'actions. Ce test est le garde-fou du retrait : sans lui, un pied réintroduit par mégarde
  // reprendrait ses 78 px sur la hauteur de l'arbre sans que rien ne le dise.
  expect(screen.queryByRole('button', { name: /Ajouter une connexion$/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Rafraîchir' })).toBeNull()
})

test('la bande d’actions est en tête, avant le filtre', () => {
  render(<Piloté onNewFolder={async () => 'f-neuf'} />)
  const bande = screen.getByRole('toolbar', { name: /Actions du panneau/ })
  const bouton = screen.getByRole('button', { name: 'Nouveau dossier' })
  expect(bande).toContainElement(bouton)
  // L'ordre du DOM est celui du parcours clavier : on agit sur le panneau avant de filtrer sa liste.
  const champ = screen.getByRole('textbox')
  expect(bande.compareDocumentPosition(champ)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

/**
 * **Le bouton des préférences est dans la bande, à côté du « + »** (`API-46`, à la demande).
 *
 * Il a quitté la barre de titre, qui n'a plus aucune action dans l'écran de travail. Ce qui est
 * mesurable ici est l'appartenance et l'ordre du DOM — le rythme des deux carrés est une mise en
 * page, donc hors de portée de jsdom (règle n° 9) —, et le reste est un test d'assemblage : la
 * vitrine ne peut pas prouver que le bouton est branché à l'écran qui monte la modale (règle n° 8).
 */
test('le bouton des préférences suit « Nouveau dossier » dans la bande, et ouvre les préférences', async () => {
  const ouvrir = vi.fn()
  render(<Piloté onNewFolder={async () => 'f-neuf'} onOpenPreferences={ouvrir} />)
  const bande = screen.getByRole('toolbar', { name: /Actions du panneau/ })
  const reglages = screen.getByRole('button', { name: 'Préférences' })
  // Enfant **direct** de la bande : c'est ce qui interdit une enveloppe de rangement autour de lui,
  // dont un `margin-left: auto` le renverrait à l'autre bout sans que le DOM en dise rien.
  expect(reglages.parentElement).toBe(bande)
  expect(
    screen.getByRole('button', { name: 'Nouveau dossier' }).compareDocumentPosition(reglages),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

  await userEvent.click(reglages)
  expect(ouvrir).toHaveBeenCalledOnce()
})

test('sans gestionnaire, le bouton n’est pas rendu — et la bande subsiste', () => {
  // C'est la règle de « Nouveau dossier » juste au-dessus : un contrôle qui ne fait rien est pire
  // qu'un contrôle absent (défaut n° 36). Et le cas de la galerie, où aucune modale ne répond.
  render(<Piloté onNewFolder={async () => 'f-neuf'} />)
  expect(screen.queryByRole('button', { name: 'Préférences' })).toBeNull()
  expect(screen.getByRole('toolbar', { name: /Actions du panneau/ })).toBeInTheDocument()
})

test('sans aucun des deux gestes, la bande n’est pas montée du tout', () => {
  // Une bande vide coûterait ses 28 px sur la hauteur de l'arbre pour ne rien porter — c'est
  // exactement ce que le retrait du pied avait gagné.
  render(<Piloté />)
  expect(screen.queryByRole('toolbar', { name: /Actions du panneau/ })).toBeNull()
})

// **Le geste n'est pas supprimé, il est déplacé** — et ce test est ce qui l'atteste. `rafraichir`
// vide tout le cache de l'arbre, et `useArbre` justifie l'absence de rechargement au second dépliage
// par son existence : sans lui, un arbre périmé ne se récupérerait qu'en redémarrant l'application.
test('« Rafraîchir l’arborescence » vit dans le menu d’une ligne projet', async () => {
  const rafraichir = vi.fn()
  render(<Piloté onRefresh={rafraichir} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
  await userEvent.click(screen.getByRole('button', { name: /Rafraîchir l’arborescence/ }))
  expect(rafraichir).toHaveBeenCalledOnce()
})

test('« Nouveau dossier » n’est rendu que si le geste existe, et la bande avec lui', () => {
  render(<Piloté />)
  // Sans la prop, le bouton n'est **pas rendu** — et non rendu inerte : un contrôle qui ne fait rien
  // est pire qu'un contrôle absent (défaut n° 36). C'est le cas de la galerie.
  expect(screen.queryByRole('button', { name: /Nouveau projet/ })).toBeNull()
  // Et la bande ne reste pas vide derrière lui : une bande d'un seul geste sans ce geste est une
  // bande de rien, qui prendrait 35 px pour ne rien offrir.
  expect(screen.queryByRole('toolbar')).toBeNull()
})

// --- Le menu « … » des lignes (`08h`) ---

/** Un retrait qui n'a rien laissé dans le Trousseau. */
const AUCUN_RESIDU = { leftoverSecrets: [] }

const TOUT_DEPLIE = [ID_PROJET, ID_PROD, ID_ANALYTICS, ID_PUBLIC]

test('les lignes de dossier et de connexion portent un « … »', () => {
  render(
    <Piloté
      initial={TOUT_DEPLIE}
      charge={{ ...RIEN, schemas: { ...RIEN.schemas }, objets: { ...RIEN.objets } }}
    />,
  )
  // Le dossier racine, ses trois sous-dossiers, ses deux connexions : **tout dossier en porte un**,
  // c'est de là que part la déclaration d'une connexion (#166).
  expect(screen.getByRole('button', { name: 'Actions de Atelier Nord' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Actions de prod' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Actions de analytics' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Actions de shop' })).toBeInTheDocument()
})

/**
 * **Il n'existe pas de ligne d'arbre sans menu** (#162), et la sorte `folder` n'y fait pas
 * exception : chaque `treeitem` a son « … » dans l'enveloppe qu'il partage avec lui. Le contrôle
 * négatif — la ligne de message, qui n'est pas un nœud — vit plus bas, avec le clic droit.
 */
test('toute ligne d’arbre, dossier compris, porte son « … »', () => {
  const charge: Charge = {
    schemas: { [ID_ANALYTICS]: [schema('public')] },
    objets: { [ID_PUBLIC]: [table('orders')] },
    enCours: new Set(),
    echecs: {},
  }
  render(
    <Piloté
      arbre={avecConsole('console 1')}
      initial={TOUT_DEPLIE}
      charge={charge}
      consoles={GESTES_DE_CONSOLE}
    />,
  )
  const lignes = screen.getAllByRole('treeitem')
  // Le décor couvre les cinq sortes : dossier, connexion, console, schéma, objet.
  expect(lignes.length).toBeGreaterThanOrEqual(9)
  for (const ligneDArbre of lignes) {
    const enveloppe = ligneDArbre.parentElement as HTMLElement
    expect(within(enveloppe).getByRole('button', { name: /^Actions de / })).toBeInTheDocument()
  }
})

test('« Nouvelle connexion… » part du dossier, avec son identifiant', async () => {
  const vues: unknown[] = []
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} onAddDatabase={(cible) => vues.push(cible)} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de prod' }))
  await userEvent.click(screen.getByRole('button', { name: 'Nouvelle connexion…' }))
  // **L'identifiant, jamais le nom** : deux dossiers homonymes vivent sous deux parents, et c'est
  // le cadre de la modale qui ne se redemande pas.
  expect(vues).toEqual([ID_DE_TEST.prod])
})

test('au clic droit sur un dossier, le même menu', async () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} onAddDatabase={() => {}} />)
  fireEvent.contextMenu(ligne('prod', '2'))
  // Une seule construction pour les deux ouvertures : deux listes d'entrées auraient divergé d'une
  // action au premier ajout.
  expect(screen.getByRole('menu', { name: 'Actions de prod' }).textContent).toContain(
    'Nouvelle connexion…',
  )
})

test('sans commande reliée, l’entrée est désactivée et dit pourquoi', async () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de prod' }))
  // Présente et désactivée, jamais absente ni cliquable-inerte : la règle de `09f` et le défaut
  // n° 36. C'est le cas de la galerie, où aucune commande ne répond.
  expect(screen.getByRole('button', { name: 'Nouvelle connexion…' })).toBeDisabled()
})

/**
 * **Une table a un menu depuis #162 ; elle n'en avait aucun jusque-là.**
 *
 * Ce test a dit successivement « un schéma et une table n'en portent pas », puis « une table n'en
 * porte pas — un menu y doublerait le clic ». La raison qu'il gardait — il n'y a rien à
 * *configurer* sur ces lignes — reste vraie, et les deux exceptions qui l'ont érodée la confirment
 * plutôt qu'elles ne l'invalident : le diagramme d'un schéma n'est pas de la configuration, et
 * copier un nom non plus. Ce qui est **tombé**, en revanche, est l'invariant que ce test gardait
 * vraiment : il n'y a plus de sorte de ligne d'arbre sans menu. L'écrire encore serait garder un
 * test vert qui ne mesure plus rien — d'où le remplacement par ce que le menu d'une table fait.
 */
function avecUneTable() {
  const charge: Charge = {
    schemas: { [ID_ANALYTICS]: [schema('public')] },
    objets: { [ID_PUBLIC]: [table('orders')] },
    enCours: new Set(),
    echecs: {},
  }
  return render(<Piloté initial={TOUT_DEPLIE} charge={charge} />)
}

/**
 * L'espion du presse-papiers.
 *
 * `navigator.clipboard` n'a qu'un accesseur sous jsdom : `Object.assign` échoue, il faut redéfinir
 * la propriété. Même geste que `panneau.test.tsx` et `edition.test.tsx`.
 */
function espionnerLePressePapiers() {
  const writeText = vi.fn(async (_texte: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

test('une table porte un menu, dont l’unique entrée copie son nom', async () => {
  const writeText = espionnerLePressePapiers()
  avecUneTable()
  // Le décor doit bien contenir la ligne, sinon le test ne mesure que son absence.
  expect(screen.getByRole('treeitem', { name: /orders/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Actions de orders' }))
  await userEvent.click(screen.getByRole('button', { name: 'Copier le nom' }))
  // **Le nom nu**, jamais `public.orders` : le schéma est le palier au-dessus.
  expect(writeText).toHaveBeenCalledWith('orders')
})

test('au clic droit sur une table, le même menu', () => {
  avecUneTable()
  fireEvent.contextMenu(ligne('orders', '5'))
  // Une seule construction pour les deux ouvertures : deux listes d'entrées auraient divergé d'une
  // action au premier ajout.
  expect(screen.getByRole('menu', { name: 'Actions de orders' }).textContent).toContain(
    'Copier le nom',
  )
})

test('le menu d’un schéma ouvre son diagramme, avec les coordonnées de son nœud', async () => {
  const vues: unknown[] = []
  const charge: Charge = {
    schemas: { [ID_ANALYTICS]: [schema('public')] },
    objets: { [ID_PUBLIC]: [table('orders')] },
    enCours: new Set(),
    echecs: {},
  }
  render(
    <Piloté initial={TOUT_DEPLIE} charge={charge} onOpenDiagram={(...args) => vues.push(args)} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de public' }))
  await userEvent.click(screen.getByRole('button', { name: 'Diagramme du schéma' }))
  // L'identifiant de la connexion et le schéma viennent du **nœud**, jamais d'une déduction sur le
  // libellé : deux schémas homonymes vivent dans deux connexions, et deux connexions homonymes dans
  // deux dossiers.
  expect(vues).toEqual([[ANALYTICS, 'public']])
})

test('sans commande, l’entrée du diagramme est désactivée et dit pourquoi', async () => {
  const charge: Charge = {
    schemas: { [ID_ANALYTICS]: [schema('public')] },
    objets: {},
    enCours: new Set(),
    echecs: {},
  }
  render(<Piloté initial={TOUT_DEPLIE} charge={charge} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de public' }))
  // La règle de `09f` : présente et désactivée, jamais cliquable et inerte (défaut n° 36).
  expect(screen.getByRole('button', { name: 'Diagramme du schéma' })).toBeDisabled()
})

test('« Modifier… » porte les coordonnées du nœud, pas une déduction sur son libellé', async () => {
  const vues: unknown[] = []
  render(<Piloté initial={TOUT_DEPLIE} onEditDatabase={(...args) => vues.push(args)} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de shop' }))
  await userEvent.click(screen.getByRole('button', { name: 'Modifier…' }))
  // L'identifiant vient du nœud : deux connexions homonymes dans deux dossiers seraient
  // indiscernables autrement (#166).
  expect(vues).toEqual([[SHOP]])
})

test('le retrait se désactive quand l’écran ne le relie à rien', async () => {
  render(<Piloté initial={TOUT_DEPLIE} onEditDatabase={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
  // **Présente et désactivée**, pas absente : la cacher ferait croire qu'elle n'existera jamais, la
  // laisser cliquable et inerte ferait croire à une panne (défaut n° 36).
  expect(screen.getByRole('button', { name: 'Retirer de DoraBase…' })).toBeDisabled()
})

test('l’entrée du menu dit « Retirer de DoraBase », jamais « supprimer »', async () => {
  render(<Piloté initial={TOUT_DEPLIE} onDelete={async () => AUCUN_RESIDU} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))

  const menu = screen.getByRole('dialog', { name: 'Actions' })
  // **Le mot compte, et c'est toute la décision de `08j`** : ce qui part est une déclaration sur cet
  // ordinateur, pas une base de données. « Supprimer analytics » dans un client de bases se lit
  // comme un `DROP DATABASE`.
  expect(menu).toHaveTextContent('Retirer de DoraBase…')
  expect(menu.textContent?.toLowerCase()).not.toContain('supprimer')
})

test('la confirmation nomme ce qui part et ce qui n’est pas touché', async () => {
  render(<Piloté initial={TOUT_DEPLIE} onDelete={async () => AUCUN_RESIDU} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))

  const modale = screen.getByRole('dialog', { name: /Retirer analytics de DoraBase/ })
  expect(modale).toHaveTextContent('effacé de cet ordinateur')
  expect(modale).toHaveTextContent('mots de passe enregistrés dans le Trousseau')
  // **Le fait qui rassure, dit aussi clairement que celui qui inquiète.** C'est la seule chose ici
  // qui pourrait coûter des données à quelqu'un : croire qu'on efface son serveur.
  expect(modale).toHaveTextContent('n’est pas touché : le serveur et ses données')
  expect(modale).toHaveTextContent('n’envoie aucune commande à la base')
  // Pas d'annulation : la configuration est un fichier, la restaurer relève d'une sauvegarde.
  expect(modale).toHaveTextContent('pas d’annulation')
  // Le bouton porte le verbe du geste, jamais « OK ».
  expect(screen.getByRole('button', { name: 'Retirer la connexion' })).toBeInTheDocument()
})

test('les modifications en attente perdues sont comptées dans la confirmation', async () => {
  render(
    <Piloté
      initial={TOUT_DEPLIE}
      onDelete={async () => AUCUN_RESIDU}
      modificationsEnAttenteDe={() => 3}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))

  // **Une confirmation qui tairait cette perte serait un piège** : les onglets se ferment, et ce qui
  // attendait d'être écrit disparaît.
  expect(screen.getByRole('dialog', { name: /Retirer analytics/ })).toHaveTextContent(
    '3 modifications en attente seront perdues',
  )
})

test('un mot de passe resté dans le Trousseau est dit, et la modale attend', async () => {
  render(
    <Piloté
      initial={TOUT_DEPLIE}
      onDelete={async () => ({ leftoverSecrets: ['Atelier Nord/analytics/prod'] })}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer la connexion' }))

  expect(await screen.findByRole('status')).toHaveTextContent('n’a pas pu être effacé')
  expect(screen.getByRole('dialog', { name: /Retirer analytics/ })).toBeInTheDocument()
})

test('un refus s’affiche dans la confirmation, qui reste ouverte', async () => {
  render(
    <Piloté
      initial={TOUT_DEPLIE}
      onDelete={async () => {
        throw new Error('la configuration n’a pas pu être écrite')
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer la connexion' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('pas pu être écrite')
  expect(screen.getByRole('dialog', { name: /Retirer analytics/ })).toBeInTheDocument()
})

// --- Le menu d'un dossier (#166) ---

test('le menu d’un dossier racine suit l’ordre décidé, le geste destructeur en dernier', async () => {
  render(
    <Piloté
      initial={TOUT_DEPLIE}
      onRefresh={vi.fn()}
      onAddDatabase={vi.fn()}
      onNewFolder={async () => 'f-neuf'}
      onRenameFolder={async () => {}}
      onRecolorFolder={async () => {}}
      onSetFolderIcon={async () => {}}
      onSetFolderReadOnly={async () => {}}
      onExportFolder={vi.fn()}
      onDelete={async () => AUCUN_RESIDU}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
  // **« Exporter le dossier… » (#169) après la lecture seule**, puis « Déplacer vers… » (#167) juste
  // avant « Retirer… », qui reste le dernier. Le « … » rend un `Popover` de boutons, donc l'ordre se
  // lit dans le panneau lui-même.
  const attendues = [
    'Rafraîchir l’arborescence',
    'Nouvelle connexion…',
    'Nouveau dossier',
    'Renommer…',
    'Couleur et icône…',
    'Passer en lecture seule',
    'Exporter le dossier…',
    'Déplacer vers…',
    'Retirer de DoraBase…',
  ]
  const panneau = screen.getByRole('button', { name: attendues[0] }).parentElement
  expect([...(panneau?.children ?? [])].map((entree) => entree.textContent)).toEqual(attendues)
})

test('« Rafraîchir l’arborescence » ne vit que sur les dossiers de premier niveau', async () => {
  render(<Piloté initial={JUSQU_AUX_CONNEXIONS} onRefresh={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de prod' }))
  expect(screen.queryByRole('button', { name: /Rafraîchir/ })).toBeNull()
})

test('« Nouveau dossier » crée dans ce dossier, le déplie et passe la ligne en renommage', async () => {
  const parents: (string | null)[] = []
  function Hote() {
    const [arbre, setArbre] = useState(ARBRE)
    return (
      <Piloté
        arbre={arbre}
        initial={[ID_PROJET]}
        onNewFolder={async (parent) => {
          parents.push(parent)
          setArbre((precedent) => ({
            ...precedent,
            folders: precedent.folders.map((racine) => ({
              ...racine,
              folders: (racine.folders ?? []).map((sous) =>
                sous.id === ID_DE_TEST.staging
                  ? {
                      ...sous,
                      folders: [{ id: 'f0000000000000n1', name: 'dossier 1', readOnly: false }],
                    }
                  : sous,
              ),
            })),
          }))
          return 'f0000000000000n1'
        }}
      />
    )
  }
  render(<Hote />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  // L'entrée du menu, et non le bouton homonyme de la bande — celui-là crée à la racine.
  const bande = screen.getByRole('toolbar', { name: 'Actions du panneau' })
  const entree = screen
    .getAllByRole('button', { name: 'Nouveau dossier' })
    .find((bouton) => !bande.contains(bouton))
  if (entree === undefined) throw new Error('aucune entrée « Nouveau dossier » dans le menu')
  await userEvent.click(entree)
  expect(parents).toEqual([ID_DE_TEST.staging])
  // Le parent est déplié, et le dossier neuf attend son nom **sur place** : aucune modale ne nomme
  // un objet à sa création.
  // (Le focus, lui, se mesure dans un navigateur : jsdom ne le pose pas sur `select()`.)
  expect(await screen.findByLabelText('Nouveau nom de dossier 1')).toHaveValue('dossier 1')
})

test('« Nouveau dossier » de la bande crée à la racine', async () => {
  const parents: (string | null)[] = []
  render(
    <Piloté
      onNewFolder={async (parent) => {
        parents.push(parent)
        return 'f0000000000000n2'
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Nouveau dossier' }))
  expect(parents).toEqual([null])
})

test('« Renommer… » d’un dossier passe sa ligne en édition, et envoie son identifiant', async () => {
  const renommes: [string, string][] = []
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRenameFolder={async (folder, nom) => {
        renommes.push([folder, nom])
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
  const champ = screen.getByDisplayValue('staging')
  await userEvent.clear(champ)
  await userEvent.type(champ, 'recette{Enter}')
  expect(renommes).toEqual([[ID_DE_TEST.staging, 'recette']])
})

test('un refus de renommage de dossier est dit, avec ce qui rassure', async () => {
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRenameFolder={async () => {
        throw 'un dossier « dev » existe déjà à cet endroit'
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
  const champ = screen.getByDisplayValue('staging')
  await userEvent.clear(champ)
  await userEvent.type(champ, 'dev{Enter}')
  const dialogue = await screen.findByRole('dialog', { name: /« dev » n’a pas pu être donné/ })
  expect(dialogue).toHaveTextContent('existe déjà')
  expect(dialogue).toHaveTextContent('Le nom d’avant est gardé.')
})

test('« Couleur et icône… » ouvre le nuancier, dont une pastille recolore le dossier', async () => {
  const recolores: [string, string | null][] = []
  const icones: [string, string | null][] = []
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async (folder, couleur) => {
        recolores.push([folder, couleur])
      }}
      onSetFolderIcon={async (folder, icone) => {
        icones.push([folder, icone])
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Couleur et icône…' }))
  const nuancier = screen.getByRole('radiogroup', { name: 'Couleur de staging' })
  // La couleur en place est cochée — et « Aucune » est une pastille comme les autres.
  expect(within(nuancier).getByRole('radio', { name: 'Ambre' })).toBeChecked()
  await userEvent.click(within(nuancier).getByRole('radio', { name: 'Aucune' }))
  expect(recolores).toEqual([[ID_DE_TEST.staging, null]])
  // **Un geste, une commande** (#171) : recolorier n'a rien écrit de l'icône.
  expect(icones).toEqual([])
})

test('chaque pastille porte son nom en toutes lettres, en nom accessible et en `title`', async () => {
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async () => {}}
      onSetFolderIcon={async () => {}}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Couleur et icône…' }))
  const nuancier = screen.getByRole('radiogroup', { name: 'Couleur de staging' })
  const noms = ['Aucune', 'Vert', 'Ambre', 'Rouge', 'Ardoise', 'Violet']
  // **Ancrés** : un motif lâche accepterait « amber » sous « Ambre », ou le nom deux fois.
  for (const nom of noms) {
    const pastille = within(nuancier).getByRole('radio', { name: new RegExp(`^${nom}$`) })
    // Le `title` est sur la case qui porte la pastille — la cible de 22 px, comme dans la grille.
    expect(pastille.closest('label')).toHaveAttribute('title', nom)
  }
  expect(within(nuancier).getAllByRole('radio')).toHaveLength(noms.length)
  // **Creuse** : « Aucune » ne porte aucun fond, les cinq autres portent leur couleur.
  const aucune = within(nuancier).getByRole('radio', { name: 'Aucune' })
  expect(aucune.style.background).toBe('')
  expect(within(nuancier).getByRole('radio', { name: 'Vert' }).style.background).toBe(
    'var(--success)',
  )
})

test('la grille d’icônes change l’icône du dossier, et « Repère » la rend à pin', async () => {
  const recolores: [string, string | null][] = []
  const icones: [string, string | null][] = []
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async (folder, couleur) => {
        recolores.push([folder, couleur])
      }}
      onSetFolderIcon={async (folder, icone) => {
        icones.push([folder, icone])
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Couleur et icône…' }))
  const grille = screen.getByRole('group', { name: 'Icône de staging' })
  // Contrôle positif : la grille porte la sélection entière, chacune nommée en toutes lettres.
  expect(within(grille).getAllByRole('radio')).toHaveLength(56)
  // Sans icône enregistrée, c'est `pin` — « Repère » — qui est cochée.
  expect(within(grille).getByRole('radio', { name: 'Repère' })).toBeChecked()

  await userEvent.click(within(grille).getByRole('radio', { name: 'Fusée' }))
  expect(within(grille).getByRole('radio', { name: 'Fusée' })).toBeChecked()
  await userEvent.click(within(grille).getByRole('radio', { name: 'Repère' }))
  // `pin` s'écrit `null` : l'absence de choix, pas un nom.
  expect(icones).toEqual([
    [ID_DE_TEST.staging, 'rocket'],
    [ID_DE_TEST.staging, null],
  ])
  expect(recolores).toEqual([])
})

test('un refus du cœur rend la case d’avant, et se dit', async () => {
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async () => {}}
      onSetFolderIcon={async () => {
        throw 'configuration verrouillée'
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Couleur et icône…' }))
  const grille = screen.getByRole('group', { name: 'Icône de staging' })
  await userEvent.click(within(grille).getByRole('radio', { name: 'Fusée' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('configuration verrouillée')
  expect(within(grille).getByRole('radio', { name: 'Repère' })).toBeChecked()
})

// --- Le panneau sous l'icône (#171) ---

const ICONE_DE_STAGING = 'Changer la couleur et l’icône de « staging »'

function PilotéAvecApparence(props: { onToggleSpy?: (n: Noeud) => void }) {
  return (
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async () => {}}
      onSetFolderIcon={async () => {}}
      {...props}
    />
  )
}

test('cliquer l’icône d’un dossier ouvre le panneau, sans sélectionner ni déplier la ligne', async () => {
  const bascules: string[] = []
  render(<PilotéAvecApparence onToggleSpy={(n) => bascules.push(n.id)} />)
  const ligne = screen.getByRole('treeitem', { name: /^staging\b/ })
  const icone = screen.getByRole('button', { name: ICONE_DE_STAGING })
  expect(icone).toHaveAttribute('aria-expanded', 'false')

  await userEvent.click(icone)
  const panneau = screen.getByRole('dialog', { name: 'Couleur et icône de staging' })
  expect(within(panneau).getByRole('radiogroup', { name: 'Couleur de staging' })).toBeVisible()
  expect(within(panneau).getAllByRole('radio', { name: /./ }).length).toBe(6 + 56)
  expect(icone).toHaveAttribute('aria-expanded', 'true')
  // **La négative est le sujet** : le clic est tombé sur l'icône, pas sur la ligne.
  expect(ligne).toHaveAttribute('aria-selected', 'false')
  expect(bascules).toEqual([])

  // Contrôle positif du décor : un clic sur le libellé, lui, sélectionne toujours.
  await userEvent.click(within(ligne).getByText('staging'))
  expect(ligne).toHaveAttribute('aria-selected', 'true')
})

test('le glyphe du dossier est dans le contrôle, et la ligne garde sa place vide', () => {
  render(<PilotéAvecApparence />)
  const ligne = screen.getByRole('treeitem', { name: /^staging\b/ })
  const icone = screen.getByRole('button', { name: ICONE_DE_STAGING })
  expect([...icone.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#i-pin'])
  expect(ligne.querySelector('[data-icon-slot]')).not.toBeNull()
  // **Un frère, pas un enfant** : un bouton dans le bouton de la ligne serait invalide.
  expect(ligne.contains(icone)).toBe(false)
  // Hors du parcours de tabulation : le chemin clavier est l'entrée du menu.
  expect(icone).toHaveAttribute('tabindex', '-1')
})

test('« Couleur et icône… » ouvre le même panneau, sous la même icône', async () => {
  render(<PilotéAvecApparence />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de staging' }))
  await userEvent.click(screen.getByRole('button', { name: 'Couleur et icône…' }))
  const panneau = screen.getByRole('dialog', { name: 'Couleur et icône de staging' })
  const icone = screen.getByRole('button', { name: ICONE_DE_STAGING })
  // **Une seule mécanique** (règle n° 17) : c'est l'icône qui se dit ouverte, et le panneau vit à
  // côté d'elle — non une seconde fenêtre ouverte ailleurs.
  expect(icone).toHaveAttribute('aria-expanded', 'true')
  expect(icone.parentElement?.contains(panneau)).toBe(true)
})

test('`Échap` ferme le panneau et rend le focus à l’icône', async () => {
  render(<PilotéAvecApparence />)
  const icone = screen.getByRole('button', { name: ICONE_DE_STAGING })
  await userEvent.click(icone)
  const panneau = screen.getByRole('dialog', { name: 'Couleur et icône de staging' })
  // Le focus est entré, sur la couleur en place.
  expect(document.activeElement).toBe(within(panneau).getByRole('radio', { name: 'Ambre' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(icone)
})

test('un clic ailleurs, ou un second clic sur l’icône, ferment le panneau', async () => {
  render(<PilotéAvecApparence />)
  const icone = screen.getByRole('button', { name: ICONE_DE_STAGING })
  await userEvent.click(icone)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await userEvent.click(icone)
  expect(screen.queryByRole('dialog')).toBeNull()

  await userEvent.click(icone)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tree'))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('un choix dans le panneau s’applique au clic, et le panneau reste ouvert', async () => {
  const icones: [string, string | null][] = []
  render(
    <Piloté
      initial={[ID_PROJET]}
      onRecolorFolder={async () => {}}
      onSetFolderIcon={async (folder, icone) => {
        icones.push([folder, icone])
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: ICONE_DE_STAGING }))
  const panneau = screen.getByRole('dialog', { name: 'Couleur et icône de staging' })
  await userEvent.click(within(panneau).getByRole('radio', { name: 'Fusée' }))
  expect(icones).toEqual([[ID_DE_TEST.staging, 'rocket']])
  expect(within(panneau).getByRole('radio', { name: 'Fusée' })).toBeChecked()
  expect(screen.getByRole('dialog', { name: 'Couleur et icône de staging' })).toBe(panneau)
})

test('la ligne d’un dossier dessine son icône, et retombe sur pin pour un nom inconnu', () => {
  const arbre = structuredClone(ARBRE)
  const racine = arbre.folders[0]
  const [premier, second] = racine?.folders ?? []
  if (!racine || !premier || !second)
    throw new Error('le décor porte une racine et deux sous-dossiers')
  racine.icon = 'rocket'
  premier.icon = 'une-icone-de-demain'
  second.icon = 'Pas Un Nom !'
  render(<Piloté initial={[ID_PROJET]} arbre={arbre} />)
  // Les glyphes de la ligne, chevron et verrou écartés : ce qui reste est l'icône du dossier.
  const glypheDe = (nom: string) =>
    [...screen.getByRole('treeitem', { name: new RegExp(`^${nom}\\b`) }).querySelectorAll('use')]
      .map((use) => use.getAttribute('href'))
      .filter((href) => href !== '#i-chevr' && href !== '#i-chevd' && href !== '#i-lock')
  expect(glypheDe(racine.name)).toEqual(['#i-rocket'])
  // Le repli ne rend jamais une case vide : un `<use>` vers `#i-une-icone-de-demain` n'y serait pas.
  expect(glypheDe(premier.name)).toEqual(['#i-pin'])
  expect(glypheDe(second.name)).toEqual(['#i-pin'])
})

test('la lecture seule se pose et se lève depuis le menu du dossier qui la déclare', async () => {
  const reglages: [string, boolean][] = []
  const onSet = async (folder: string, lectureSeule: boolean) => {
    reglages.push([folder, lectureSeule])
  }
  render(<Piloté initial={[ID_PROJET]} onSetFolderReadOnly={onSet} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de dev' }))
  await userEvent.click(screen.getByRole('button', { name: 'Passer en lecture seule' }))
  await userEvent.click(screen.getByRole('button', { name: /^Actions de prod/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Lever la lecture seule' }))
  expect(reglages).toEqual([
    [ID_DE_TEST.dev, true],
    [ID_DE_TEST.prod, false],
  ])
})

test('un refus de la lecture seule se dit, avec le dossier qu’il concerne (#168)', async () => {
  // Le cœur refuse quand une transaction manuelle est ouverte sur une connexion du dossier : un menu
  // qui se fermerait sans effet se lirait comme une panne (défaut n° 36).
  const refus =
    'une transaction manuelle est ouverte dans une console de « analytics » : validez-la ou annulez-la avant de changer la lecture seule de ce dossier.'
  render(<Piloté initial={[ID_PROJET]} onSetFolderReadOnly={() => Promise.reject(refus)} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de dev' }))
  await userEvent.click(screen.getByRole('button', { name: 'Passer en lecture seule' }))
  const dialogue = await screen.findByRole('dialog', {
    name: 'La lecture seule de « dev » n’a pas changé',
  })
  expect(dialogue).toHaveTextContent(refus)
  expect(dialogue).toHaveTextContent('aucune connexion n’a été fermée')
})

test('sous un ancêtre en lecture seule, l’entrée est désactivée et nomme l’ancêtre', async () => {
  const arbre = arbreDeTest({
    id: 'f0000000000000c1',
    name: 'Coffre',
    readOnly: true,
    folders: [{ id: 'f0000000000000c2', name: 'dedans', readOnly: false }],
  })
  render(
    <Piloté
      arbre={arbre}
      initial={[idDossier('f0000000000000c1')]}
      onSetFolderReadOnly={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de dedans' }))
  const entree = screen.getByRole('button', { name: 'Passer en lecture seule' })
  expect(entree).toBeDisabled()
  expect(entree).toHaveAttribute('title', 'Imposée par « Coffre ».')
})

test('retirer un dossier compte ses connexions et porte son propre verbe', async () => {
  const cibles: CibleDeSuppression[] = []
  render(
    <Piloté
      onDelete={async (cible) => {
        cibles.push(cible)
        return AUCUN_RESIDU
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retirer de DoraBase…' }))
  const dialogue = screen.getByRole('dialog', { name: 'Retirer Atelier Nord de DoraBase' })
  expect(dialogue).toHaveTextContent(
    'le dossier Atelier Nord, ses sous-dossiers et ses 2 connexions',
  )
  await userEvent.click(within(dialogue).getByRole('button', { name: 'Retirer le dossier' }))
  expect(cibles).toEqual([
    { kind: 'folder', folder: ID_DE_TEST.racine, nom: 'Atelier Nord', connexions: 2 },
  ])
})

test('« Modifier… » se désactive quand l’écran ne la relie à rien', async () => {
  render(<Piloté initial={TOUT_DEPLIE} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
  // Une action branchée sur rien est le défaut n° 36 : mieux vaut le dire que laisser cliquer.
  expect(screen.getByRole('button', { name: 'Modifier…' })).toBeDisabled()
})

describe('la section contextuelle : colonnes déclarées ou schéma déduit (`13c`)', () => {
  const champ = (nom: string, frequence: number | null): ColumnInfo => ({
    position: 1,
    name: nom,
    typeName: 'string',
    category: 'text',
    nullable: true,
    default: null,
    identity: null,
    key: null,
    comment: null,
    frequency: frequence,
  })

  function monterAvec(colonnes: ColumnInfo[]) {
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <ExplorerSidebar
            arbre={{ folders: [], connections: [] }}
            deplies={new Set<string>()}
            charge={RIEN}
            etatDe={() => ({ kind: 'never' })}
            selectedId={null}
            onSelect={() => {}}
            onToggle={() => {}}
            columns={{ table: 'evenements', columns: colonnes }}
          />
        </LanguageProvider>
      </>,
    )
  }

  it('dit « Colonnes de » quand les colonnes sont déclarées', () => {
    monterAvec([champ('statut', null)])
    expect(screen.getByText('Colonnes de evenements')).toBeInTheDocument()
    // Le type s'affiche : il n'y a pas de fréquence à dire.
    expect(screen.getByText('string')).toBeInTheDocument()
  })

  it('dit « Schéma déduit de » dès qu’un champ porte une fréquence', () => {
    // **Le mot le plus important de la section** : les champs viennent d'un échantillon (`18d`),
    // pas d'un catalogue. Le titre se déduit de la donnée plutôt que d'un drapeau qu'un appelant
    // pourrait oublier de poser.
    monterAvec([champ('canal', 0.98)])
    expect(screen.getByText('Schéma déduit de evenements')).toBeInTheDocument()
  })

  it('affiche la fréquence d’un champ partiel, et le type d’un champ complet', () => {
    monterAvec([champ('canal', 0.98), champ('sorte', 1)])
    // `98 %` prend la place du type — c'est ce que le mockup d'`A8` montre.
    expect(screen.getByText('98 %')).toBeInTheDocument()
    // **Un champ à 100 % garde son type** : répéter « 100 % » sur quinze lignes noierait les deux
    // qui ne le sont pas, et ce sont celles-là qui comptent.
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.queryByText('100 %')).toBeNull()
  })

  it('arrondit sans faire disparaître un champ presque complet', () => {
    // 0,996 s'arrondirait à « 100 % », ce qui serait un mensonge de précision : au-delà du seuil, on
    // affiche le type plutôt qu'un pourcentage faux.
    monterAvec([champ('presque', 0.996)])
    expect(screen.queryByText(/%/)).toBeNull()
  })
})

// --- Les consoles dans l'arbre, et leur renommage sur place ---

/** Le décor d'`ARBRE`, avec une console sur la connexion `analytics`. */
function avecConsole(nom: string): FolderTree {
  return arbreDeTest(
    trioDeTest({
      prod: [
        connexionDeTest(ANALYTICS, 'analytics', { consoles: [{ name: nom, sql: '' }] }),
        connexionDeTest(SHOP, 'shop', { engine: 'mysql' }),
      ],
    }),
  )
}

const GESTES_DE_CONSOLE = {
  onCreer: () => {},
  onRenommer: () => {},
  onRetirer: () => {},
}

test('un double-clic sur une console ouvre le champ de renommage', async () => {
  render(
    <Piloté
      arbre={avecConsole('console 1')}
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      consoles={GESTES_DE_CONSOLE}
    />,
  )
  await userEvent.dblClick(screen.getByRole('treeitem', { name: /console 1/ }))
  // Le champ prend la place du libellé, et son contenu est **présélectionné** : un renommage
  // commence presque toujours par tout remplacer.
  const champ = screen.getByLabelText('Nouveau nom de console 1')
  expect(champ).toHaveValue('console 1')
})

test('« Entrée » valide le renommage, « Échap » l’abandonne', async () => {
  const renommer = vi.fn()
  const gestes = { ...GESTES_DE_CONSOLE, onRenommer: renommer }
  render(
    <Piloté
      arbre={avecConsole('console 1')}
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      consoles={gestes}
    />,
  )

  await userEvent.dblClick(screen.getByRole('treeitem', { name: /console 1/ }))
  await userEvent.clear(screen.getByLabelText('Nouveau nom de console 1'))
  await userEvent.type(screen.getByLabelText('Nouveau nom de console 1'), 'Audit{Enter}')
  expect(renommer).toHaveBeenCalledWith(ANALYTICS, 'console 1', 'Audit')

  renommer.mockClear()
  await userEvent.dblClick(screen.getByRole('treeitem', { name: /console 1/ }))
  await userEvent.type(screen.getByLabelText('Nouveau nom de console 1'), 'Perdu{Escape}')
  // **Un double-clic de trop doit pouvoir être abandonné sans réfléchir.**
  expect(renommer).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Nouveau nom de console 1')).toBeNull()
})

test('un nom vide ou inchangé n’envoie rien', async () => {
  const renommer = vi.fn()
  render(
    <Piloté
      arbre={avecConsole('console 1')}
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      consoles={{ ...GESTES_DE_CONSOLE, onRenommer: renommer }}
    />,
  )

  await userEvent.dblClick(screen.getByRole('treeitem', { name: /console 1/ }))
  await userEvent.clear(screen.getByLabelText('Nouveau nom de console 1'))
  await userEvent.keyboard('{Enter}')
  // Les deux sont des non-gestes : les envoyer ferait refuser le premier par le cœur et écrire le
  // second pour rien.
  expect(renommer).not.toHaveBeenCalled()
})

test('les autres lignes de l’arbre ne se renomment pas au double-clic', async () => {
  render(
    <Piloté
      arbre={avecConsole('console 1')}
      initial={[...JUSQU_AUX_CONNEXIONS, ID_ANALYTICS]}
      consoles={GESTES_DE_CONSOLE}
    />,
  )
  // **Une connexion se renomme depuis son menu « … », pas au double-clic** (`26`) : son clic simple
  // déplie, et un double-clic replierait puis déplierait sous le champ de saisie. Le nom d'une table
  // ou d'un schéma, lui, vient du serveur et ne nous appartient pas.
  await userEvent.dblClick(screen.getByRole('treeitem', { name: /analytics/ }))
  expect(screen.queryByLabelText(/Nouveau nom de/)).toBeNull()
})

describe('renommer une connexion depuis sa ligne (`26`)', () => {
  /** Le renommage réussi : muet, et sans rien à rapporter depuis #166. */
  const SANS_RESERVE = undefined

  test('« Renommer… » passe la ligne en édition, et n’appelle rien avant validation', async () => {
    const renommer = vi.fn().mockResolvedValue(SANS_RESERVE)
    render(<Piloté initial={TOUT_DEPLIE} onRenameDatabase={renommer} />)

    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))

    // Le champ prend la place du libellé, présélectionné : un renommage commence presque toujours
    // par tout remplacer.
    expect(screen.getByLabelText('Nouveau nom de analytics')).toHaveValue('analytics')
    // **Rien n'est parti** : ouvrir le champ n'est pas renommer.
    expect(renommer).not.toHaveBeenCalled()
  })

  test('« Entrée » envoie l’identifiant du nœud', async () => {
    const renommer = vi.fn().mockResolvedValue(SANS_RESERVE)
    render(<Piloté initial={TOUT_DEPLIE} onRenameDatabase={renommer} />)

    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
    await userEvent.clear(screen.getByLabelText('Nouveau nom de analytics'))
    await userEvent.type(screen.getByLabelText('Nouveau nom de analytics'), 'entrepot{Enter}')

    // L'identifiant, jamais le nom : sans lui, la commande viserait la première connexion de ce nom.
    expect(renommer).toHaveBeenCalledWith(ANALYTICS, 'entrepot')
  })

  test('« Échap » abandonne, et un nom inchangé n’envoie rien', async () => {
    const renommer = vi.fn().mockResolvedValue(SANS_RESERVE)
    render(<Piloté initial={TOUT_DEPLIE} onRenameDatabase={renommer} />)

    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
    await userEvent.type(screen.getByLabelText('Nouveau nom de analytics'), '{Escape}')
    expect(renommer).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Nouveau nom de analytics')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
    await userEvent.keyboard('{Enter}')
    // Un non-geste ne déplace pas un mot de passe dans le Trousseau pour rien.
    expect(renommer).not.toHaveBeenCalled()
  })

  test('un succès sans réserve ne monte aucune modale', async () => {
    render(
      <Piloté initial={TOUT_DEPLIE} onRenameDatabase={vi.fn().mockResolvedValue(SANS_RESERVE)} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
    await userEvent.clear(screen.getByLabelText('Nouveau nom de analytics'))
    await userEvent.type(screen.getByLabelText('Nouveau nom de analytics'), 'entrepot{Enter}')

    // **Le succès est muet** : la ligne renommée est sa propre confirmation, et une modale « c'est
    // fait » à chaque fois apprendrait à cliquer sans lire.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('un refus du cœur est dit, avec ce qui rassure', async () => {
    const renommer = vi
      .fn()
      .mockRejectedValue(new Error('une connexion « shop » est déjà déclarée en « prod »'))
    render(<Piloté initial={TOUT_DEPLIE} onRenameDatabase={renommer} />)

    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Renommer…' }))
    await userEvent.clear(screen.getByLabelText('Nouveau nom de analytics'))
    await userEvent.type(screen.getByLabelText('Nouveau nom de analytics'), 'shop{Enter}')

    const modale = await screen.findByRole('dialog')
    expect(modale).toHaveTextContent('déjà déclarée')
    // Le fait qui rassure, dit aussi fort que celui qui inquiète — la règle de `08j`.
    expect(modale).toHaveTextContent('Le nom d’avant est gardé.')
  })

  test('« Renommer… » se désactive quand l’écran ne la relie à rien', async () => {
    render(<Piloté initial={TOUT_DEPLIE} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    // Présente et désactivée, pas absente : la règle de `09f` et le défaut n° 36.
    expect(screen.getByRole('button', { name: 'Renommer…' })).toBeDisabled()
  })

  // --- Le gestionnaire de schémas (`API-33`) ---

  test('« Gérer les schémas… » part du menu de la connexion, avec ses coordonnées', async () => {
    const vues: unknown[] = []
    render(<Piloté initial={TOUT_DEPLIE} onManageSchemas={(...args) => vues.push(args)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gérer les schémas…' }))

    // **L'identifiant vient du nœud** : deux connexions homonymes ouvriraient sinon le gestionnaire
    // de la première venue.
    expect(vues).toEqual([[ANALYTICS]])
  })

  test('hors PostgreSQL l’entrée reste, désactivée avec sa raison', async () => {
    render(<Piloté initial={TOUT_DEPLIE} onManageSchemas={vi.fn()} />)
    // `shop` est déclarée en MySQL dans le décor. **Présente et désactivée, pas absente** : la
    // cacher ferait croire qu'elle n'existera jamais, quand c'est un « pas encore ».
    await userEvent.click(screen.getByRole('button', { name: 'Actions de shop' }))
    const entree = screen.getByRole('button', { name: 'Gérer les schémas…' })
    expect(entree).toBeDisabled()
    expect(entree).toHaveAttribute('title', 'Seul PostgreSQL est géré pour l’instant.')
  })

  test('sans écran relié, l’entrée dit que rien ne l’ouvre — et non que le moteur est en cause', async () => {
    render(<Piloté initial={TOUT_DEPLIE} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    const entree = screen.getByRole('button', { name: 'Gérer les schémas…' })
    expect(entree).toBeDisabled()
    // **Les deux raisons sont distinctes**, et c'est ce qui compte : « pas branché » sur une
    // connexion PostgreSQL ne doit pas accuser le moteur, qui est le bon.
    expect(entree).toHaveAttribute('title', 'Cet écran n’est pas relié au gestionnaire de schémas.')
  })

  test('le renommage d’une connexion ne branche pas celui d’un dossier', async () => {
    render(<Piloté initial={TOUT_DEPLIE} onRenameDatabase={vi.fn()} />)
    // Deux commandes, deux disponibilités : sans `onRenameFolder`, l'entrée du dossier se désactive
    // avec sa raison, même quand celle de la connexion est branchée.
    await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))
    expect(screen.getByRole('button', { name: 'Renommer…' })).toBeDisabled()
  })
})

describe('le clic droit ouvre le même menu, au pointeur (`26`)', () => {
  /** Le clic droit, en `fireEvent` : `userEvent` ne porte pas de geste « bouton secondaire ». */
  function clicDroit(ligne: HTMLElement) {
    fireEvent.contextMenu(ligne, { clientX: 120, clientY: 80 })
  }

  test('une ligne de connexion ouvre ses actions, les mêmes que le « … »', () => {
    render(<Piloté initial={TOUT_DEPLIE} onEditDatabase={() => {}} onRenameDatabase={vi.fn()} />)
    clicDroit(ligne('analytics', '3'))

    const menu = screen.getByRole('menu', { name: 'Actions de analytics' })
    // **Les mêmes entrées que le « … »**, dans le même ordre : c'est une seule construction, et ce
    // test est ce qui le prouve plutôt que de le supposer.
    expect(
      [...menu.querySelectorAll('[role=menuitem]')].map((entree) => entree.textContent),
    ).toEqual([
      'Nouvelle console…',
      // **« Gérer les schémas… » en seconde position** (`API-33`) : les deux gestes qui *ouvrent*
      // quelque chose d'abord, ceux qui configurent ensuite.
      'Gérer les schémas…',
      'Renommer…',
      'Modifier…',
      'Déplacer vers…',
      'Retirer de DoraBase…',
    ])
  })

  test('une entrée agit, et le menu se referme', async () => {
    const vues: unknown[] = []
    render(<Piloté initial={TOUT_DEPLIE} onEditDatabase={(...args) => vues.push(args)} />)
    clicDroit(ligne('shop', '3'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Modifier…' }))

    // L'identifiant vient du nœud cliqué, pas de la première ligne du décor.
    expect(vues).toEqual([[SHOP]])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('une action indisponible reste offerte et dit pourquoi', () => {
    render(<Piloté initial={TOUT_DEPLIE} />)
    clicDroit(ligne('analytics', '3'))
    // La règle de `09f` valait déjà pour le « … » ; un second menu qui cacherait les entrées
    // désactivées ferait croire à deux produits.
    expect(screen.getByRole('menuitem', { name: 'Renommer…' })).toBeDisabled()
  })

  /**
   * **La ligne visée a été un schéma, puis une table, et c'est maintenant une ligne de message.**
   *
   * Les deux premières ont gagné un menu — le diagramme le 3 septembre 2026, « Copier le nom » avec
   * #162 —, et il n'existe plus de **sorte de nœud** sans actions. Ce qui reste, et qui est le vrai
   * sujet du test, est la ligne de message : « Aucun objet », « Chargement… », un échec de dépliage.
   * Ce n'est pas un nœud de l'arbre mais un état de son chargement — elle n'est délibérément pas un
   * `treeitem` —, et `preventDefault` sur un clic droit sans menu y retirerait le geste natif pour
   * rien.
   */
  test('une ligne de message n’ouvre aucun menu, et garde celui du système', () => {
    const charge: Charge = {
      schemas: { [ID_ANALYTICS]: [schema('public')] },
      // Un schéma déplié et vide : `enfantsDe` rend la ligne « Aucun objet » à la place des objets.
      objets: { [ID_PUBLIC]: [] },
      enCours: new Set(),
      echecs: {},
    }
    render(<Piloté initial={TOUT_DEPLIE} charge={charge} />)

    const message = screen.getByText('Aucun objet')
    // Le contrôle positif : la ligne est bien là et n'est pas un `treeitem`, sinon le test ne
    // mesurerait que l'absence de quelque chose qu'il n'a pas trouvé.
    expect(message).not.toHaveAttribute('role', 'treeitem')
    const evenement = fireEvent.contextMenu(message)
    expect(evenement).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // Le pendant : une ligne **qui** a des actions retire bien le menu du système, sans quoi le test
  // ci-dessus passerait aussi sur un arbre où plus aucun clic droit ne serait câblé.
  test('une ligne qui a des actions, elle, retire celui du système', () => {
    render(<Piloté initial={TOUT_DEPLIE} />)
    expect(fireEvent.contextMenu(ligne('analytics', '3'))).toBe(false)
  })

  test('le clic droit sur un schéma ouvre le menu du diagramme', () => {
    const charge: Charge = {
      schemas: { [ID_ANALYTICS]: [schema('public')] },
      objets: { [ID_PUBLIC]: [table('orders')] },
      enCours: new Set(),
      echecs: {},
    }
    render(<Piloté initial={TOUT_DEPLIE} charge={charge} onOpenDiagram={() => {}} />)

    // Le contrôle négatif du test voisin : c'est le même geste sur la ligne d'à côté, et il ouvre
    // bien quelque chose — sinon « aucun menu » se vérifierait tout seul.
    clicDroit(ligne('public', '4'))
    expect(screen.getByRole('menuitem', { name: 'Diagramme du schéma' })).toBeEnabled()
  })
})

test('« Exporter le dossier… » passe l’identifiant et le nom du dossier de sa ligne', async () => {
  // **Le geste part du palier qui connaît son contexte** (#169) : le cœur reçoit l'identifiant,
  // la modale montre le nom. Un sous-dossier s'exporte aussi — c'est lui qui a le plus à perdre,
  // puisqu'il perd ses ancêtres.
  const onExportFolder = vi.fn()
  render(<Piloté initial={TOUT_DEPLIE} onExportFolder={onExportFolder} />)

  await userEvent.click(screen.getByRole('button', { name: 'Actions de prod' }))
  await userEvent.click(screen.getByRole('button', { name: 'Exporter le dossier…' }))

  expect(onExportFolder).toHaveBeenCalledWith(ID_DE_TEST.prod, 'prod')
})

test('sans export relié, l’entrée est désactivée avec sa raison', async () => {
  render(<Piloté initial={TOUT_DEPLIE} />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions de Atelier Nord' }))

  const entree = screen.getByRole('button', { name: 'Exporter le dossier…' })
  expect(entree).toBeDisabled()
  expect(entree).toHaveAttribute('title', 'Cet écran n’est pas relié à l’export.')
})

test('« Importer des dossiers… » vit dans la bande, à côté de « Nouveau dossier »', async () => {
  // **Le second chemin de l'import** (`API-30`, 17 septembre 2026, à la demande) : il n'existait
  // que dans le menu natif, donc personne ne l'a trouvé. Les deux gestes de cette bande produisent
  // un projet — l'un le déclare, l'autre le reçoit —, et les voisiner est ce qui fait trouver le
  // second quand on cherchait le premier.
  const onImportProjects = vi.fn()
  render(<Piloté onNewFolder={async () => 'f-neuf'} onImportProjects={onImportProjects} />)

  const bande = screen.getByRole('toolbar', { name: 'Actions du panneau' })
  await userEvent.click(within(bande).getByRole('button', { name: 'Importer des dossiers…' }))

  expect(onImportProjects).toHaveBeenCalledOnce()
})

test('la bande ne rend pas l’import quand l’écran ne le relie à rien', () => {
  // **Le contrôle négatif** : un bouton d'icône nue qui ne mènerait nulle part se lirait comme une
  // panne (défaut n° 36), et il n'y a rien à expliquer dans 22 px — donc on ne le rend pas, plutôt
  // que de le désactiver avec sa raison comme le fait une entrée de menu, qui a la place de la dire.
  render(<Piloté onNewFolder={async () => 'f-neuf'} />)

  expect(screen.queryByRole('button', { name: 'Importer des dossiers…' })).toBeNull()
})

// --- Déplacer (#167) ---

describe('« Déplacer vers… » depuis le menu (#167)', () => {
  test('le menu d’une connexion ouvre la modale, et le déplacement part vers le cœur', async () => {
    const onMove = vi.fn<NonNullable<ExplorerSidebarProps['onMove']>>(async () => ({
      kind: 'moved',
      tree: ARBRE,
    }))
    render(<Piloté initial={TOUT_DEPLIE} onMove={onMove} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Déplacer vers…' }))
    const modale = screen.getByRole('dialog')
    await userEvent.click(within(modale).getByRole('button', { name: 'Racine' }))
    await userEvent.click(within(modale).getByRole('button', { name: 'Déplacer' }))
    expect(onMove).toHaveBeenCalledWith(
      { kind: 'database', connection: ANALYTICS },
      { destination: null, index: null },
      expect.any(Boolean),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('sans `onMove`, l’entrée est désactivée avec sa raison', async () => {
    render(<Piloté initial={TOUT_DEPLIE} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions de analytics' }))
    expect(screen.getByRole('button', { name: 'Déplacer vers…' })).toBeDisabled()
  })
})
