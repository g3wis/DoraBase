import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Tab, TabStrip } from './TabStrip'

// Les trois familles d'onglet du handoff, avec leurs deux couleurs distinctes : le trait
// supérieur suit la famille (données / console), l'icône suit le type d'objet.
const demoTabs: Tab[] = [
  {
    id: 'public',
    icon: 'schema',
    iconColor: 'var(--accent-deep)',
    accentColor: 'var(--accent)',
    label: 'public',
  },
  {
    id: 'orders',
    icon: 'table',
    iconColor: 'var(--success)',
    accentColor: 'var(--accent)',
    label: 'orders',
  },
  {
    id: 'console-1',
    icon: 'term',
    iconColor: 'var(--violet-ink)',
    accentColor: 'var(--violet)',
    label: 'console 1',
    meta: '·psql',
  },
]

function renderStrip(activeId: string) {
  return render(
    <TabStrip
      tabs={demoTabs}
      activeId={activeId}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onReorder={vi.fn()}
    />,
  )
}

test("l'onglet actif est marqué sélectionné et porte une croix de fermeture", () => {
  renderStrip('orders')
  expect(screen.getByRole('tab', { name: /orders/i })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: /fermer orders/i })).toBeInTheDocument()
})

test("un onglet inactif n'a pas de croix", () => {
  renderStrip('orders')
  expect(screen.queryByRole('button', { name: /fermer public/i })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /public/i })).toHaveAttribute('aria-selected', 'false')
})

test('affiche le suffixe optionnel', () => {
  renderStrip('orders')
  expect(screen.getByText('·psql')).toBeInTheDocument()
})

// Le trait supérieur d'un onglet de table est en accent, pas dans la couleur verte de son
// icône : ce test échouerait si les deux couleurs étaient fusionnées en une seule prop.
test("le trait supérieur suit la famille, pas la couleur d'icône", () => {
  const { container } = renderStrip('orders')
  const active = container.querySelector('[data-active="true"]') as HTMLElement
  expect(active.style.borderTopColor).toBe('var(--accent)')
})

test('un onglet de console porte un trait violet', () => {
  const { container } = renderStrip('console-1')
  const active = container.querySelector('[data-active="true"]') as HTMLElement
  expect(active.style.borderTopColor).toBe('var(--violet)')
})

test('cliquer un onglet le sélectionne', async () => {
  const onSelect = vi.fn()
  render(
    <TabStrip
      tabs={demoTabs}
      activeId="orders"
      onSelect={onSelect}
      onClose={vi.fn()}
      onReorder={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: /public/i }))
  expect(onSelect).toHaveBeenCalledWith('public')
})

test('la croix ferme sans sélectionner', async () => {
  const onClose = vi.fn()
  const onSelect = vi.fn()
  render(
    <TabStrip
      tabs={demoTabs}
      activeId="orders"
      onSelect={onSelect}
      onClose={onClose}
      onReorder={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /fermer orders/i }))
  expect(onClose).toHaveBeenCalledWith('orders')
  expect(onSelect).not.toHaveBeenCalled()
})

// `dataTransfer` est fourni à la main : jsdom ne construit pas l'objet natif, et
// `fireEvent` accepte de le remplacer par un espion.
test('glisser un onglet sur un autre les réordonne', () => {
  const onReorder = vi.fn()
  render(
    <TabStrip
      tabs={demoTabs}
      activeId="orders"
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onReorder={onReorder}
    />,
  )
  const tabs = screen.getAllByRole('tab')
  const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'public') }
  fireEvent.dragStart(tabs[0] as HTMLElement, { dataTransfer })
  fireEvent.drop(tabs[2] as HTMLElement, { dataTransfer })
  expect(onReorder).toHaveBeenCalledWith([demoTabs[1], demoTabs[2], demoTabs[0]])
})

test('déposer un onglet sur lui-même ne réordonne pas', () => {
  const onReorder = vi.fn()
  render(
    <TabStrip
      tabs={demoTabs}
      activeId="orders"
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onReorder={onReorder}
    />,
  )
  const tabs = screen.getAllByRole('tab')
  const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'public') }
  fireEvent.dragStart(tabs[0] as HTMLElement, { dataTransfer })
  fireEvent.drop(tabs[0] as HTMLElement, { dataTransfer })
  expect(onReorder).not.toHaveBeenCalled()
})

/**
 * **Le libellé coupé se lit au survol prolongé** (#156).
 *
 * jsdom ne calcule aucune mise en page : la coupure est donc **posée** sur le libellé, comme la
 * mesure qu'`useApercuTronque` lit. La cote qui la produit — `largeurMax` — n'a pour juge que
 * Playwright (`e2e/156-suite-d-instructions.spec.ts`).
 */
describe('un libellé coupé', () => {
  const requete: Tab = {
    id: '0',
    icon: 'check',
    iconColor: 'var(--success)',
    accentColor: 'var(--accent)',
    label: 'select id, total from orders where total > 100',
    titre: 'select id, total\nfrom orders\nwhere total > 100',
  }

  function couper(element: HTMLElement, coupe: boolean) {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: coupe ? 400 : 100 })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 100 })
  }

  afterEach(() => vi.useRealTimers())

  test('montre son texte entier au survol prolongé, retours à la ligne compris', () => {
    vi.useFakeTimers()
    render(<TabStrip tabs={[requete]} activeId="0" onSelect={vi.fn()} largeurMax={240} />)
    const libelle = screen.getByText(requete.label)
    couper(libelle, true)

    fireEvent.mouseEnter(screen.getByRole('tab'))
    // **Prolongé** : rien avant le délai, sans quoi traverser la bande ferait clignoter des bulles.
    act(() => vi.advanceTimersByTime(400))
    expect(screen.queryByText((_, e) => e?.textContent === requete.titre)).toBeNull()
    act(() => vi.advanceTimersByTime(200))
    const apercu = screen.getByText((_, e) => e?.textContent === requete.titre)
    expect(apercu).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByRole('tab'))
    expect(screen.queryByText((_, e) => e?.textContent === requete.titre)).toBeNull()
  })

  test("ne montre rien quand le libellé n'est pas coupé", () => {
    vi.useFakeTimers()
    render(<TabStrip tabs={[requete]} activeId="0" onSelect={vi.fn()} largeurMax={240} />)
    const libelle = screen.getByText(requete.label)
    couper(libelle, false)

    fireEvent.mouseEnter(screen.getByRole('tab'))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText((_, e) => e?.textContent === requete.titre)).toBeNull()
  })

  test('pose la largeur maximale sur chaque onglet, et seulement si on la demande', () => {
    const { unmount } = render(
      <TabStrip tabs={[requete]} activeId="0" onSelect={vi.fn()} largeurMax={240} />,
    )
    expect(screen.getByRole('tab').parentElement).toHaveStyle({ maxWidth: '240px' })
    unmount()
    render(<TabStrip tabs={[requete]} activeId="0" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab').parentElement?.style.maxWidth).toBe('')
  })

  test('sans `onClose` ni `onReorder`, ni croix ni glisser-déposer', () => {
    render(<TabStrip tabs={[requete]} activeId="0" onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Fermer/ })).toBeNull()
    expect(screen.getByRole('tab')).not.toHaveAttribute('draggable')
  })
})
