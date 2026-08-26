import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { EnvironmentDeclaration } from '../../domain/config'
import type { ColumnInfo, RowLimit } from '../../domain/engine'
import {
  type Charge,
  idBase,
  idEnvironnement,
  idProjet,
  idSchema,
} from '../../screens/Explorer/arbre'
import { BreadcrumbBar, type TypeObjet } from '../../screens/Explorer/BreadcrumbBar'
import { DetailPanel } from '../../screens/Explorer/DetailPanel'
import { ExplorerSidebar } from '../../screens/Explorer/ExplorerSidebar'
import { ObjectTable } from '../../screens/Explorer/ObjectTable'
import { Toolbar } from '../../screens/TableView/Toolbar'
import { SelectionIndicator } from '../../shell/SelectionIndicator/SelectionIndicator'
import { TitleBar } from '../../shell/TitleBar/TitleBar'
import { Badge } from '../../ui/Badge/Badge'
import { Button } from '../../ui/Button/Button'
import { Chip } from '../../ui/Chip/Chip'
import { CollapsiblePanel } from '../../ui/CollapsiblePanel/CollapsiblePanel'
import { ColumnRow } from '../../ui/ColumnRow/ColumnRow'
import { type Column, DataTable } from '../../ui/DataTable/DataTable'
import { Dot } from '../../ui/Dot/Dot'
import { Field } from '../../ui/Field/Field'
import { ABSENT, formatBytes, formatCount } from '../../ui/format'
import { Modal } from '../../ui/Modal/Modal'
import { Popover } from '../../ui/Popover/Popover'
import { RadioGroup } from '../../ui/RadioGroup/RadioGroup'
import { SegmentedControl } from '../../ui/SegmentedControl/SegmentedControl'
import { Select } from '../../ui/Select/Select'
import { Sidebar } from '../../ui/Sidebar/Sidebar'
import { SidebarFilterBar } from '../../ui/SidebarFilterBar/SidebarFilterBar'
import { SidebarSectionTitle } from '../../ui/SidebarSectionTitle/SidebarSectionTitle'
import { SidebarToolbar, SidebarToolbarButton } from '../../ui/SidebarToolbar/SidebarToolbar'
import { SplitPane } from '../../ui/SplitPane/SplitPane'
import { StatTile } from '../../ui/StatTile/StatTile'
import { Stepper } from '../../ui/Stepper/Stepper'
import { type Tab, TabStrip } from '../../ui/TabStrip/TabStrip'
import { Toggle } from '../../ui/Toggle/Toggle'
import { TreeRow } from '../../ui/TreeRow/TreeRow'
import { type GridColumn, VirtualGrid } from '../../ui/VirtualGrid/VirtualGrid'
import { Icon } from '../icons/Icon'
import { tokens } from '../tokens'
import styles from './Gallery.module.css'

// La galerie sert à juger une primitive isolément, pas à la mettre en scène : chaque
// section montre l'exhaustivité des variantes/tailles d'un côté, et les quatre états
// (normal, survolé, focus, désactivé) de l'autre, pour la variante la plus représentative.
//
// Survol et focus ne se capturent pas en CSS statique :
// - le focus clavier est rendu observable SANS action de l'utilisateur, via `AutoFocus`
//   ci-dessous, qui appelle `.focus()` sur le vrai contrôle DOM au montage. C'est un focus
//   réel (pas une imitation de `:focus-visible` recopiée hors du module de la primitive),
//   et les moteurs de rendu appliquent `:focus-visible` à un focus programmatique sur un
//   contrôle de formulaire — la bague d'accent apparaît donc sans manipulation.
// - le survol, lui, dépend de la position réelle du curseur : aucune API ne le simule
//   (les événements `mouseenter` synthétiques ne déclenchent pas `:hover`). Le forcer
//   demanderait de recopier hors du module de la primitive les déclarations `:hover`
//   qu'on n'a pas le droit de modifier — un second exemplaire, donc une dérive garantie
//   dès que le module change. La colonne « survolé » reste donc l'élément réel, avec une
//   légende qui dit d'y passer le curseur ; quand la primitive ne définit aucun style de
//   survol (Field, Toggle, Chip, Badge, Dot), la légende le dit aussi — ne pas suggérer un
//   effet qui n'existe pas.

function resolveVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}

function AutoFocus({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    hostRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
  }, [])

  return (
    <div ref={hostRef} className={styles.stateCell}>
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.sub}>
      <h3 className={styles.subTitle}>{title}</h3>
      {children}
    </div>
  )
}

type StatesRowProps = {
  label: string
  normal: ReactNode
  hover: ReactNode
  focus: ReactNode
  disabled: ReactNode
}

// Une ligne « Normal / Survolé / Focus / Désactivé » pour une variante donnée. Chaque
// cellule reçoit soit le contrôle réel, soit une `Note` expliquant pourquoi l'état ne
// s'applique pas — jamais une case vide sans justification.
function StatesRow({ label, normal, hover, focus, disabled }: StatesRowProps) {
  return (
    <div className={styles.statesRow}>
      <div className={styles.statesLabel}>{label}</div>
      <div className={styles.stateCell}>{normal}</div>
      <div className={styles.stateCell}>{hover}</div>
      {focus}
      <div className={styles.stateCell}>{disabled}</div>
    </div>
  )
}

function StatesHeader() {
  return (
    <div className={styles.statesRow}>
      <div className={styles.statesLabel} />
      <div className={styles.statesHead}>Normal</div>
      <div className={styles.statesHead}>Survolé</div>
      <div className={styles.statesHead}>Focus</div>
      <div className={styles.statesHead}>Désactivé</div>
    </div>
  )
}

function ButtonGallery() {
  const variants: Array<'accent' | 'dark' | 'secondary'> = ['accent', 'dark', 'secondary']
  const sizes: Array<'xs' | 'sm' | 'md' | 'lg' | 'xl'> = ['xs', 'sm', 'md', 'lg', 'xl']

  return (
    <Section title="Button">
      <Sub title="Variantes × tailles (15)">
        <div className={styles.grid}>
          {variants.map((variant) =>
            sizes.map((size) => (
              <div key={`${variant}-${size}`} className={styles.cell}>
                <Button variant={variant} size={size} shortcut="⌘K">
                  Label
                </Button>
                <span className={styles.cellCaption}>
                  {variant} · {size}
                </span>
              </div>
            )),
          )}
        </div>
      </Sub>
      <Sub title="États">
        <StatesHeader />
        {variants.map((variant) => (
          <StatesRow
            key={variant}
            label={variant}
            normal={<Button variant={variant}>Label</Button>}
            hover={
              variant === 'secondary' ? (
                <>
                  <Button variant={variant}>Label</Button>
                  <Note>Survolez ce bouton.</Note>
                </>
              ) : (
                <Note>Aucun style de survol défini pour cette variante.</Note>
              )
            }
            focus={
              <AutoFocus>
                <Button variant={variant}>Label</Button>
              </AutoFocus>
            }
            disabled={
              <Button variant={variant} disabled>
                Label
              </Button>
            }
          />
        ))}
      </Sub>
    </Section>
  )
}

function FieldGallery() {
  const sizes: Array<'sm' | 'md'> = ['sm', 'md']

  return (
    <Section title="Field">
      <Sub title="Tailles × mono (4)">
        <div className={styles.grid}>
          {sizes.map((size) =>
            [false, true].map((mono) => (
              <div key={`${size}-${String(mono)}`} className={styles.cell}>
                <Field
                  label={mono ? 'Hôte' : 'Nom'}
                  size={size}
                  mono={mono}
                  defaultValue={mono ? 'localhost:5432' : 'Ma connexion'}
                />
                <span className={styles.cellCaption}>
                  {size} · mono {mono ? 'oui' : 'non'}
                </span>
              </div>
            )),
          )}
        </div>
      </Sub>
      <Sub title="États (taille md)">
        <StatesHeader />
        <StatesRow
          label="md"
          normal={<Field label="Hôte" placeholder="localhost" />}
          hover={<Note>Aucun style de survol défini sur ce composant.</Note>}
          focus={
            <AutoFocus>
              <Field label="Hôte" placeholder="localhost" />
            </AutoFocus>
          }
          disabled={<Field label="Hôte" placeholder="localhost" disabled />}
        />
      </Sub>
    </Section>
  )
}

function ToggleGallery() {
  return (
    <Section title="Toggle">
      <Sub title="Coché / non coché">
        <div className={styles.grid}>
          <div className={styles.cell}>
            <Toggle checked={false} onCheckedChange={() => {}} label="Éteint" />
            <span className={styles.cellCaption}>éteint</span>
          </div>
          <div className={styles.cell}>
            <Toggle checked={true} onCheckedChange={() => {}} label="Allumé" />
            <span className={styles.cellCaption}>allumé</span>
          </div>
        </div>
      </Sub>
      <Sub title="États">
        <StatesHeader />
        <StatesRow
          label="allumé"
          normal={<Toggle checked={true} onCheckedChange={() => {}} label="Exemple" />}
          hover={<Note>Aucun style de survol défini sur ce composant.</Note>}
          focus={
            <AutoFocus>
              <Toggle checked={true} onCheckedChange={() => {}} label="Exemple" />
            </AutoFocus>
          }
          disabled={<Toggle checked={true} onCheckedChange={() => {}} label="Exemple" disabled />}
        />
      </Sub>
    </Section>
  )
}

function BadgeGallery() {
  const tones: Array<'danger' | 'warn' | 'success' | 'violet' | 'muted' | 'engine-mg'> = [
    'danger',
    'warn',
    'success',
    'violet',
    'muted',
    'engine-mg',
  ]
  const sizes: Array<'xs' | 'sm' | 'md' | 'lg'> = ['xs', 'sm', 'md', 'lg']

  return (
    <Section title="Badge">
      <Sub title="Teintes × tailles (24)">
        <div className={styles.grid}>
          {tones.map((tone) =>
            sizes.map((size) => (
              <div key={`${tone}-${size}`} className={styles.cell}>
                <Badge tone={tone} size={size}>
                  Label
                </Badge>
                <span className={styles.cellCaption}>
                  {tone} · {size}
                </span>
              </div>
            )),
          )}
        </div>
      </Sub>
      <Sub title="États">
        <Note>
          Étiquette non interactive (`&lt;span&gt;`) : ni survol, ni focus, ni désactivé n'ont de
          sens pour ce composant — seul l'état normal existe.
        </Note>
      </Sub>
    </Section>
  )
}

function ChipGallery() {
  const variants: Array<'default' | 'accent' | 'selected'> = ['default', 'accent', 'selected']
  const sizes: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg']

  return (
    <Section title="Chip">
      <Sub title="Variantes × tailles (9)">
        <div className={styles.grid}>
          {variants.map((variant) =>
            sizes.map((size) => (
              <div key={`${variant}-${size}`} className={styles.cell}>
                <Chip variant={variant} size={size} icon={<Icon name="filter" size={12} />}>
                  Filtre
                </Chip>
                <span className={styles.cellCaption}>
                  {variant} · {size}
                </span>
              </div>
            )),
          )}
        </div>
      </Sub>
      <Sub title="Avec suppression">
        <div className={styles.grid}>
          <div className={styles.cell}>
            <Chip variant="accent" onRemove={() => {}} removeLabel="Retirer le filtre">
              Filtre actif
            </Chip>
          </div>
        </div>
      </Sub>
      <Sub title="États (chip interactif, variante default)">
        <StatesHeader />
        <StatesRow
          label="default"
          normal={<Chip onClick={() => {}}>Filtre</Chip>}
          hover={<Note>Aucun style de survol défini sur ce composant.</Note>}
          focus={
            <AutoFocus>
              <Chip onClick={() => {}}>Filtre</Chip>
            </AutoFocus>
          }
          disabled={<Note>Pas de prop `disabled` sur ce composant.</Note>}
        />
      </Sub>
    </Section>
  )
}

function DotGallery() {
  return (
    <Section title="Dot">
      <Sub title="Teintes (2)">
        <div className={styles.grid}>
          <div className={styles.cell}>
            <Dot tone="success" />
            <span className={styles.cellCaption}>success</span>
          </div>
          <div className={styles.cell}>
            <Dot tone="gold" />
            <span className={styles.cellCaption}>gold</span>
          </div>
        </div>
      </Sub>
      <Sub title="États">
        <Note>
          Pastille purement décorative (`aria-hidden` fixe, aucun enfant ni rôle) : ni survol, ni
          focus, ni désactivé n'ont de sens ici.
        </Note>
      </Sub>
    </Section>
  )
}

// Les 47 noms d'icônes viennent du sprite réel (les `<symbol id="i-...">` injectés par
// `<Sprite />` dans le document), pas d'une liste recopiée à la main : `names.ts` fixe le
// type `IconName` pour le compilateur, cette planche lit le DOM pour rester exacte même si
// le sprite change sans qu'on pense à mettre la galerie à jour.
function IconBoard() {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    const symbols = document.querySelectorAll('symbol[id^="i-"]')
    const found = Array.from(symbols, (symbol) => symbol.id.replace(/^i-/, ''))
      .filter((name) => name !== 'logo')
      .sort()
    setNames(found)
  }, [])

  return (
    <Section title={`Icônes (${names.length})`}>
      <div className={styles.iconGrid}>
        {names.map((name) => (
          <div key={name} className={styles.iconCell}>
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <use
                href={`#i-${name}`}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.iconLabel}>{name}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// --- Planche des tokens -----------------------------------------------------------
//
// Énumérée depuis l'objet `tokens` de `tokens.ts` (jamais recopiée), pour que la planche
// ne devienne jamais une seconde source de vérité qui dérive du générateur.

type TokenGroup = {
  title: string
  match: (name: string) => boolean
}

const COLOR_GROUPS: TokenGroup[] = [
  {
    title: 'Surfaces',
    match: (n) =>
      ['canvas', 'paper', 'paper-alt', 'bar', 'field', 'muted', 'dark', 'dark-2'].includes(n),
  },
  {
    title: 'Encre',
    match: (n) => n === 'ink' || n.startsWith('ink-'),
  },
  {
    title: 'Traits',
    match: (n) =>
      ['border', 'border-field', 'divider', 'gridline', 'hover-border', 'track-off'].includes(n),
  },
  {
    title: 'Accent & interactions',
    match: (n) => n.startsWith('accent') || n === 'hover-bg' || n === 'hover-row',
  },
  {
    title: 'Sémantique',
    match: (n) =>
      n.startsWith('danger') ||
      n.startsWith('warn') ||
      n.startsWith('success') ||
      n.startsWith('info') ||
      n.startsWith('violet') ||
      n === 'gold',
  },
  { title: 'Moteurs', match: (n) => n.startsWith('engine-') },
  { title: 'Syntaxe', match: (n) => n.startsWith('syn-') },
  { title: 'JSON sur papier', match: (n) => n.startsWith('json-') },
]

type TokenBucket =
  | 'shadow'
  | 'radius'
  | 'text'
  | 'weight'
  | 'space'
  | 'font'
  | 'leading'
  | 'tracking'
  | 'height'
  | 'color'

function bucketOf(name: string): TokenBucket {
  if (name.startsWith('shadow-')) return 'shadow'
  if (name.startsWith('radius-')) return 'radius'
  if (name.startsWith('text-')) return 'text'
  if (name.startsWith('weight-')) return 'weight'
  if (name.startsWith('space-')) return 'space'
  if (name.startsWith('font-')) return 'font'
  if (name.startsWith('leading-')) return 'leading'
  if (name.startsWith('tracking-')) return 'tracking'
  if (name.startsWith('h-') || name.startsWith('rowh')) return 'height'
  return 'color'
}

function ColorSwatch({ name }: { name: string }) {
  return (
    <div className={styles.swatchCell}>
      <span className={styles.swatch} style={{ background: `var(--${name})` }} aria-hidden="true" />
      <div className={styles.swatchMeta}>
        <span className={styles.swatchName}>{name}</span>
        <span className={styles.swatchValue}>{resolveVar(name)}</span>
      </div>
    </div>
  )
}

function TokenBoard() {
  const names = Object.keys(tokens).sort()
  const buckets: Record<TokenBucket, string[]> = {
    shadow: [],
    radius: [],
    text: [],
    weight: [],
    space: [],
    font: [],
    leading: [],
    tracking: [],
    height: [],
    color: [],
  }
  for (const name of names) buckets[bucketOf(name)].push(name)

  return (
    <Section title={`Tokens (${names.length})`}>
      <Sub title={`Couleurs (${buckets.color.length})`}>
        {COLOR_GROUPS.map((group) => {
          const members = buckets.color.filter((n) => group.match(n))
          if (members.length === 0) return null
          return (
            <div key={group.title} className={styles.swatchGroup}>
              <h4 className={styles.swatchGroupTitle}>{group.title}</h4>
              <div className={styles.swatchGrid}>
                {members.map((name) => (
                  <ColorSwatch key={name} name={name} />
                ))}
              </div>
            </div>
          )
        })}
        {(() => {
          const grouped = new Set(
            COLOR_GROUPS.flatMap((g) => buckets.color.filter((n) => g.match(n))),
          )
          const rest = buckets.color.filter((n) => !grouped.has(n))
          if (rest.length === 0) return null
          return (
            <div className={styles.swatchGroup}>
              <h4 className={styles.swatchGroupTitle}>Autres</h4>
              <div className={styles.swatchGrid}>
                {rest.map((name) => (
                  <ColorSwatch key={name} name={name} />
                ))}
              </div>
            </div>
          )
        })()}
      </Sub>

      <Sub title={`Familles de police (${buckets.font.length})`}>
        <div className={styles.fontList}>
          {buckets.font.map((name) => (
            <div key={name} className={styles.fontRow} style={{ fontFamily: `var(--${name})` }}>
              <span className={styles.swatchName}>{name}</span>
              <span>Portefeuille — Abc 123</span>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title={`Tailles de texte (${buckets.text.length})`}>
        <div className={styles.textList}>
          {buckets.text.map((name) => (
            <div key={name} className={styles.textRow}>
              <span className={styles.swatchName}>
                {name} ({resolveVar(name)})
              </span>
              <span style={{ fontSize: `var(--${name})`, fontFamily: 'var(--font-ui)' }}>
                Portefeuille exquis
              </span>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title={`Graisses (${buckets.weight.length})`}>
        <div className={styles.textList}>
          {buckets.weight.map((name) => (
            <div key={name} className={styles.textRow}>
              <span className={styles.swatchName}>
                {name} ({resolveVar(name)})
              </span>
              <span style={{ fontWeight: `var(--${name})`, fontFamily: 'var(--font-ui)' }}>
                Portefeuille exquis
              </span>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title={`Espacement (${buckets.space.length})`}>
        <div className={styles.spaceList}>
          {buckets.space.map((name) => (
            <div key={name} className={styles.spaceRow}>
              <span className={styles.swatchName}>
                {name} ({resolveVar(name)})
              </span>
              <span className={styles.spaceBar} style={{ width: `var(--${name})` }} />
            </div>
          ))}
        </div>
      </Sub>

      <Sub title={`Rayons (${buckets.radius.length})`}>
        <div className={styles.swatchGrid}>
          {buckets.radius.map((name) => (
            <div key={name} className={styles.radiusCell}>
              <span
                className={styles.radiusBox}
                style={{ borderRadius: `var(--${name})` }}
                aria-hidden="true"
              />
              <span className={styles.swatchName}>
                {name} ({resolveVar(name)})
              </span>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title={`Ombres (${buckets.shadow.length})`}>
        <div className={styles.swatchGrid}>
          {buckets.shadow.map((name) => (
            <div key={name} className={styles.shadowCell}>
              <span className={styles.shadowBox} style={{ boxShadow: `var(--${name})` }} />
              <span className={styles.swatchName}>{name}</span>
            </div>
          ))}
        </div>
      </Sub>

      <Sub
        title={`Hauteurs, interlignes, interlettrages (${buckets.height.length + buckets.leading.length + buckets.tracking.length})`}
      >
        <div className={styles.miscTable}>
          {[...buckets.height, ...buckets.leading, ...buckets.tracking].map((name) => (
            <div key={name} className={styles.miscRow}>
              <span className={styles.swatchName}>{name}</span>
              <span className={styles.swatchValue}>{resolveVar(name)}</span>
            </div>
          ))}
        </div>
      </Sub>
    </Section>
  )
}

// Les trois familles d'onglet du handoff. Le filet supérieur suit la famille (accent pour
// les données, violet pour les consoles), l'icône suit le type d'objet — deux valeurs
// distinctes.
const GALLERY_TABS: Tab[] = [
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

function TabStripGallery() {
  const [tabs, setTabs] = useState(GALLERY_TABS)
  const [activeId, setActiveId] = useState('orders')

  return (
    <Section title="TabStrip">
      <Sub title="Bande contrôlée — cliquer, fermer, glisser pour réordonner">
        <TabStrip
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={(id) => setTabs((current) => current.filter((tab) => tab.id !== id))}
          onReorder={setTabs}
        />
      </Sub>
      <Note>
        La croix n'apparaît que sur l'onglet actif : lecture littérale du mockup, qui n'en montre
        sur aucun onglet inactif. Fermer tous les onglets vide la bande — recharger la page la remet
        en état.
      </Note>
    </Section>
  )
}

function SplitPaneGallery() {
  return (
    <Section title="SplitPane">
      <Sub title="Deux SplitPane imbriqués — la disposition à trois zones de A4">
        <div className={styles.splitDemo}>
          <SplitPane
            storageKey="gallery-sidebar"
            defaultSize={212}
            min={150}
            max={320}
            start={<div className={styles.splitZone}>sidebar 212</div>}
            end={
              <SplitPane
                storageKey="gallery-detail"
                defaultSize={300}
                min={200}
                max={420}
                start={<div className={styles.splitZone}>centre</div>}
                end={<div className={styles.splitZone}>détail 300</div>}
              />
            }
          />
        </div>
      </Sub>
      <Note>
        Aucun composant à N zones : trois zones s'obtiennent en imbriquant deux `SplitPane`, sans
        code supplémentaire. Glisser une poignée ou la focaliser puis utiliser les flèches ; la
        taille survit à un rechargement de la page.
      </Note>
    </Section>
  )
}

// Reproduit la hiérarchie de A5 : projet actif déplié → base → schéma → deux tables, dont
// une sélectionnée → projets voisins repliés → section contextuelle et ses colonnes. Les
// données sont fictives, comme le veut le handoff pour tout ce qui n'est pas encore branché
// sur un vrai modèle (spec 05).
function SidebarGallery() {
  const [filtre, setFiltre] = useState('order')
  const [selection, setSelection] = useState('orders')

  return (
    <Section title="Sidebar standard (A5 → A9)">
      <Sub title="Assemblage complet — bande d’actions, filtre, arbre, section contextuelle">
        <div className={styles.sidebarDemo}>
          <Sidebar
            filter={
              <SidebarFilterBar value={filtre} onChange={setFiltre} matchCount={2} totalCount={8} />
            }
            toolbar={
              <SidebarToolbar>
                <SidebarToolbarButton icon="bag" label="Nouveau projet" onClick={() => {}} />
              </SidebarToolbar>
            }
          >
            <TreeRow
              depth={0}
              label="Atelier Nord"
              icon="bag"
              iconColor="var(--accent-deep)"
              chevron="open"
              strong
              trailing={
                <Badge tone="danger" size="xs">
                  PROD
                </Badge>
              }
              onClick={() => {}}
            />
            {/* Ni `analytics` ni `public` ne portent de métadonnée dans A5 — c'est la
                sidebar de A4, plus large, qui affiche leur taille et leur compte d'objets. */}
            <TreeRow
              depth={1}
              label="analytics"
              icon="db"
              iconColor="var(--engine-pg)"
              chevron="open"
              onClick={() => {}}
            />
            <TreeRow
              depth={2}
              label="public"
              icon="schema"
              iconColor="var(--accent-deep)"
              chevron="open"
              onClick={() => {}}
            />
            <TreeRow
              depth={3}
              label="orders"
              icon="table"
              iconColor="var(--success)"
              meta="1.9 M"
              selected={selection === 'orders'}
              onClick={() => setSelection('orders')}
            />
            <TreeRow
              depth={3}
              label="order_items"
              icon="table"
              iconColor="var(--success)"
              meta="6.4 M"
              selected={selection === 'order_items'}
              onClick={() => setSelection('order_items')}
            />
            <TreeRow
              depth={0}
              label="Outils internes"
              icon="bag"
              chevron="closed"
              muted
              meta="4 bases"
              metaVariant="caps"
              onClick={() => {}}
            />
            <TreeRow
              depth={0}
              label="Data science"
              icon="bag"
              chevron="closed"
              muted
              meta="3 bases"
              metaVariant="caps"
              onClick={() => {}}
            />
            <SidebarSectionTitle>Colonnes de {selection}</SidebarSectionTitle>
            <ColumnRow label="id" typeIcon="key" typeIconColor="var(--gold)" meta="int8" />
            <ColumnRow label="user_id" typeIcon="fk" typeIconColor="var(--info)" meta="int8" />
            <ColumnRow label="status" typeGlyph="T" meta="filtré" metaActive onClick={() => {}} />
            <ColumnRow label="total_cents" typeGlyph="#" meta="int4" />
            <ColumnRow label="currency" typeGlyph="T" meta="bpchar" />
            <ColumnRow
              label="created_at"
              typeGlyph="⏱"
              meta="tri ↓"
              metaActive
              onClick={() => {}}
            />
            <ColumnRow label="shipped_at" typeGlyph="⏱" meta="tstz" />
            <ColumnRow label="+ 11 autres" summary />
          </Sidebar>
        </div>
      </Sub>
      <Note>
        Arbre et colonnes reproduisent A5 ligne pour ligne. Le pied porte les deux gestes de
        structure — « Connexion » et « Projet » — de même facture et à mi-largeur : c'est la forme
        retenue le 20 août 2026, après qu'un pied à trois registres a été démêlé. Aucune récursion
        ni modèle de données : l'écran consommateur aplatit son arbre et place lui-même ses lignes.
        Sélection et filtre sont de simples états locaux à la galerie, pour que les états se voient
        vraiment.
      </Note>
    </Section>
  )
}

// --- Primitives de `08a` -----------------------------------------------------------

const MOTEURS = [
  {
    value: 'postgres',
    label: 'PostgreSQL',
    prefix: <span style={{ color: 'var(--engine-pg)' }}>Pg</span>,
  },
  { value: 'mysql', label: 'MySQL', prefix: <span style={{ color: 'var(--engine-my)' }}>My</span> },
  {
    value: 'sqlite',
    label: 'SQLite',
    prefix: <span style={{ color: 'var(--engine-sq)' }}>Sq</span>,
  },
  {
    value: 'mongo',
    label: 'MongoDB',
    prefix: <span style={{ color: 'var(--engine-mg)' }}>Mg</span>,
  },
  { value: 'redis', label: 'Redis', prefix: <span style={{ color: 'var(--engine-rd)' }}>Rd</span> },
  // Snowflake et BigQuery n'ont **pas** de monogramme dans le mockup. Vérifié.
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'bigquery', label: 'BigQuery' },
] as const

const MODES_SSL = [
  { value: 'disable', label: 'disable' },
  { value: 'allow', label: 'allow' },
  { value: 'prefer', label: 'prefer' },
  { value: 'require', label: 'require' },
  { value: 'verify-ca', label: 'verify-ca' },
  { value: 'verify-full', label: 'verify-full' },
] as const

function SelectGallery() {
  const [mode, setMode] = useState<(typeof MODES_SSL)[number]['value']>('require')
  const [projet, setProjet] = useState('print')

  return (
    <Section title="Select">
      <Note>
        `&lt;select&gt;` natif habillé : le mockup ne montre que l’état fermé, donc rien n’impose
        une liste maison, et le natif apporte le clavier et la recherche à la frappe.
      </Note>
      <Sub title="Tailles (2) et icône">
        <div className={styles.grid}>
          <div className={styles.cell}>
            <Select label="Mode SSL" options={MODES_SSL} value={mode} onValueChange={setMode} />
            <span className={styles.cellCaption}>md · 30px</span>
          </div>
          <div className={styles.cell}>
            <Select
              label="Type"
              size="sm"
              options={[{ value: 'ssh', label: 'SSH' }]}
              value="ssh"
              onValueChange={() => {}}
            />
            <span className={styles.cellCaption}>sm · 28px (panneau proxy)</span>
          </div>
          <div className={styles.cell}>
            <Select
              label="Projet"
              icon={{ name: 'bag', color: 'var(--accent-deep)' }}
              options={[
                { value: 'print', label: 'Atelier Nord' },
                { value: 'web', label: 'Atelier Sud' },
              ]}
              value={projet}
              onValueChange={setProjet}
            />
            <span className={styles.cellCaption}>avec icône</span>
          </div>
          <div className={styles.cell}>
            <Select
              label="Désactivé"
              options={[{ value: 'x', label: 'auto' }]}
              value="x"
              onValueChange={() => {}}
              disabled
            />
            <span className={styles.cellCaption}>disabled</span>
          </div>
        </div>
      </Sub>
    </Section>
  )
}

function RadioGroupGallery() {
  const [moteur, setMoteur] = useState<(typeof MOTEURS)[number]['value']>('postgres')
  const [env, setEnv] = useState('prod')

  return (
    <Section title="RadioGroup">
      <Note>
        De vrais `&lt;button&gt;` frères, pas un `div[role=button]` : le sélecteur de moteur de A2
        n’a **aucune croix de suppression**, ce qui clôt la dette du Chip interactif. Tab entre et
        sort du groupe, les flèches naviguent dedans.
      </Note>
      <Sub title="Sélecteur de moteur — 7 options, 2 sans monogramme">
        <RadioGroup label="Moteur" options={MOTEURS} value={moteur} onValueChange={setMoteur} />
      </Sub>
      <Sub title="Variante d’environnement — l’habillage prod vient de 08b">
        <RadioGroup
          label="Variante d’environnement"
          options={[
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'prod', label: 'prod', prefix: <Icon name="warn" size={13} /> },
          ]}
          value={env}
          onValueChange={setEnv}
        />
        <Note>
          Le mockup ne montre que `prod` actif, en rouge. **Rien ne dit à quoi ressemble un `dev`
          actif** — l’accent générique est appliqué, la question est ouverte.
        </Note>
      </Sub>
    </Section>
  )
}

function CollapsiblePanelGallery() {
  const [ouvert, setOuvert] = useState(true)

  return (
    <Section title="CollapsiblePanel">
      <Note>
        Replié, le contenu est **retiré du DOM** : il sort de l’arbre d’accessibilité et de l’ordre
        de tabulation, donc le piège de focus de Modal ne le compte plus.
      </Note>
      <Sub title="Panneau proxy / tunnel de A2">
        <CollapsiblePanel
          title="Proxy / tunnel"
          icon="shield"
          badge={ouvert ? <Badge tone="violet">SSH activé</Badge> : undefined}
          open={ouvert}
          onOpenChange={setOuvert}
        >
          <div className={styles.grid}>
            <Field label="Hôte du bastion" size="sm" mono defaultValue="bastion.exemple.net" />
            <Field label="Port" size="sm" mono defaultValue="22" />
          </div>
        </CollapsiblePanel>
      </Sub>
    </Section>
  )
}

function ModalGallery() {
  const [ouvert, setOuvert] = useState(false)
  const [imbriquee, setImbriquee] = useState(false)

  return (
    <Section title="Modal">
      <Note>
        Pas de `&lt;dialog&gt;` : il impose son propre backdrop et sa pile de superposition, où les
        **deux voiles superposés** de A3 ne se composent pas. Le prix est de câbler esc, le piège de
        focus et aria-modal à la main — un test par exigence.
      </Note>
      <Sub title="A2 (820px) et A3 (436px, imbriquée)">
        <Button onClick={() => setOuvert(true)}>Ouvrir la modale A2</Button>
        <Note>
          La sous-modale A3 s’ouvre **depuis** A2, par le bouton « Tester la connexion » — c’est son
          vrai parcours, et un bouton posé dans la galerie serait de toute façon inatteignable
          derrière le voile de A2.
        </Note>
      </Sub>

      {ouvert && (
        <Modal
          title="Nouvelle connexion"
          icon="db"
          onClose={() => setOuvert(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setImbriquee(true)}>
                Tester la connexion
              </Button>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" onClick={() => setOuvert(false)}>
                Annuler
              </Button>
              <Button>Enregistrer &amp; ouvrir</Button>
            </>
          }
        >
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <Field label="Nom de la base" defaultValue="analytics" />
            <Field label="Hôte" mono defaultValue="db-analytics.internal" />
          </div>
        </Modal>
      )}

      {imbriquee && (
        <Modal title="Connexion impossible" icon="warn" nested onClose={() => setImbriquee(false)}>
          <div style={{ padding: '9px 16px 16px' }}>
            <p style={{ margin: 0, color: 'var(--ink-6)' }}>
              Le bastion a refusé la clé. La base n’a pas été contactée.
            </p>
            <Button variant="dark" onClick={() => setImbriquee(false)}>
              Fermer
            </Button>
          </div>
        </Modal>
      )}
    </Section>
  )
}

// --- Primitives de `09a` -----------------------------------------------------------

const SEGMENTS = [
  { value: 'tables', label: 'Tables', count: 8 },
  { value: 'vues', label: 'Vues', count: 2 },
  { value: 'fonctions', label: 'Fonctions', count: 6 },
  { value: 'index', label: 'Index', count: 31 },
] as const

function SegmentedControlGallery() {
  const [actif, setActif] = useState<(typeof SEGMENTS)[number]['value']>('tables')

  return (
    <Section title="SegmentedControl">
      <Note>
        **Pas un RadioGroup** : 25px contre 30, actif en `--dark` contre l’accent, et un compte
        accolé au libellé. L’accent dit « ce que vous avez choisi de faire », l’encre « ce que vous
        regardez ». Le compte **fait partie** du nom accessible.
      </Note>
      <Sub title="Filtre d’objets de A4">
        <SegmentedControl
          label="Type d’objet"
          segments={SEGMENTS}
          value={actif}
          onValueChange={setActif}
        />
      </Sub>
    </Section>
  )
}

function StatTileGallery() {
  return (
    <Section title="StatTile">
      <Note>
        Le compte de lignes de A4 est une **estimation** (`reltuples`), la taille est exacte. Les
        présenter à l’identique est un mensonge de précision, que le handoff commet — d’où
        l’astérisque et le `title`.
      </Note>
      <Sub title="Les deux tuiles du panneau de détail">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, width: 278 }}>
          <StatTile label="Lignes" value={formatCount(1_900_000)} approximate />
          <StatTile label="Taille" value={formatBytes(2.1 * 1024 ** 3)} />
        </div>
      </Sub>
      <Sub title="Formatage (format.ts)">
        <div className={styles.grid}>
          {[0, 999, 1000, 1024, 128_000, 1_900_000, -1].map((v) => (
            <div key={v} className={styles.cell}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatCount(v)}</span>
              <span className={styles.cellCaption}>formatCount({v})</span>
            </div>
          ))}
        </div>
        <Note>
          999 reste brut, 1000 s’abrège. Les comptes sont en puissances de **1000**, les tailles en
          puissances de **1024** — les confondre afficherait « 1.0 k » pour 1024 lignes.
        </Note>
      </Sub>
    </Section>
  )
}

type ObjetDemo = {
  nom: string
  lignes: number
  taille: number
  colonnes: number
  cle: string
  analyze: string
  commentaire: string
}

const OBJETS: ObjetDemo[] = [
  {
    nom: 'orders',
    lignes: 1_900_000,
    taille: 2.1 * 1024 ** 3,
    colonnes: 18,
    cle: 'id',
    analyze: '2026-08-06 04:12',
    commentaire: 'Commandes, une ligne par achat',
  },
  {
    nom: 'users',
    lignes: 128_000,
    taille: 96 * 1024 ** 2,
    colonnes: 12,
    cle: 'id',
    analyze: '2026-08-06 04:12',
    commentaire: '',
  },
  {
    nom: 'orders_by_day',
    lignes: -1,
    taille: 8 * 1024,
    colonnes: 3,
    cle: '',
    analyze: '',
    commentaire: 'Vue jamais analysée',
  },
]

const COLONNES_DEMO: Column<ObjetDemo>[] = [
  { key: 'nom', header: 'Nom', cell: (o) => o.nom, ui: true, width: '210px' },
  {
    key: 'lignes',
    header: 'Lignes',
    cell: (o) => formatCount(o.lignes),
    numeric: true,
    width: '88px',
  },
  {
    key: 'taille',
    header: 'Taille',
    cell: (o) => formatBytes(o.taille),
    numeric: true,
    width: '78px',
  },
  { key: 'col', header: 'Col.', cell: (o) => o.colonnes, numeric: true, width: '66px' },
  { key: 'cle', header: 'Clé primaire', cell: (o) => o.cle || ABSENT, width: '150px' },
  { key: 'analyze', header: 'Dernier ANALYZE', cell: (o) => o.analyze || ABSENT, width: '120px' },
  { key: 'commentaire', header: 'Commentaire', cell: (o) => o.commentaire || ABSENT },
]

function DataTableGallery() {
  const [choisi, setChoisi] = useState<string | null>('orders')

  return (
    <Section title="DataTable">
      <Note>
        Un vrai `&lt;table&gt;` : avec `scope=col` et `scope=row`, un lecteur d’écran annonce
        l’en-tête de chaque cellule sans un seul `aria-colindex`. La grille de A5 (spec 10) aura
        besoin de l’inverse — virtualisée, éditable — d’où deux composants séparés.
      </Note>
      <Note>
        Trois points que la seule prose du handoff aurait manqués : les en-têtes **ne sont pas** en
        capitales, les cellules sont en **mono par défaut** (seul le nom est en Nunito), et il y a
        des filets **verticaux** entre colonnes.
      </Note>
      <Sub title="Objets d’un schéma — 7 colonnes, ligne sélectionnable">
        <DataTable
          label="Objets du schéma"
          columns={COLONNES_DEMO}
          rows={OBJETS}
          rowId={(o) => o.nom}
          selectedId={choisi}
          onSelect={(o) => setChoisi(o.nom)}
        />
      </Sub>
      <Sub title="État vide">
        <DataTable
          label="Objets du schéma"
          columns={COLONNES_DEMO}
          rows={[]}
          rowId={(o) => o.nom}
          empty={<span>Ce schéma ne contient aucune table.</span>}
        />
      </Sub>
    </Section>
  )
}

// --- Barre de titre de A4 (`09c`) --------------------------------------------------

function TitleBarGallery() {
  return (
    <Section title="Barre de titre (A4)">
      <Note>
        **Le centre n’est plus qu’un indicateur** (`25b`) : plus de sélecteur d’environnement, plus
        de menu de pastille, et plus d’encadré. Les deux boîtes blanches du mockup entouraient des
        contrôles ; la zone n’en est plus un, et un encadré sur fond de barre est une affordance —
        l’argument que `24` a déjà retenu contre un `Chip` inerte. L’environnement se choisit
        désormais dans l’arbre, où il est un palier (`25a`).
      </Note>
      <Note>
        Le point d’état est celui de la connexion **ouverte** : un projet n’a pas d’état de
        connexion, ses connexions en ont. Sans connexion ouverte, **aucun point** plutôt qu’un point
        gris inventé.
      </Note>
      <Sub title="A4 — projet, environnement, fil d’Ariane, lecture seule">
        <div data-testid="titlebar-a4">
          <TitleBar
            showConsole
            center={
              <SelectionIndicator
                projectName="Atelier Nord"
                environment={{ label: 'coulisses', color: 'amber', production: false }}
                breadcrumb="analytics · public"
                connection={{
                  kind: 'connected',
                  serverVersion: 'PostgreSQL 17.6',
                  tunnelLocalPort: null,
                }}
                readOnly
              />
            }
          />
        </div>
      </Sub>
      <Sub title="Un environnement marqué production — le badge suit le drapeau, pas le libellé">
        <TitleBar
          center={
            <SelectionIndicator
              projectName="Atelier Nord"
              environment={{ label: 'vitrine', color: 'red', production: true }}
              breadcrumb="analytics · public"
              connection={{
                kind: 'connected',
                serverVersion: 'PostgreSQL 17.6',
                tunnelLocalPort: null,
              }}
            />
          }
        />
      </Sub>
      <Sub title="Un projet seul — la sélection ne désigne pas d’environnement">
        <TitleBar center={<SelectionIndicator projectName="Atelier Nord" />} />
      </Sub>
      <Sub title="Rien de sélectionné — le centre est vide, et la barre ne bouge pas">
        <div data-testid="titlebar-vide">
          <TitleBar showConsole />
        </div>
      </Sub>
      <Sub title="Connexion hors ligne">
        <TitleBar
          center={
            <SelectionIndicator
              projectName="Atelier Nord"
              environment={{ label: 'bac à sable', color: 'green', production: false }}
              breadcrumb="shop · public"
              connection={{ kind: 'offline', reason: 'hôte injoignable' }}
            />
          }
        />
      </Sub>
    </Section>
  )
}

// --- Sidebar de A4 (`09d`) --------------------------------------------------------

/**
 * Les réglages de connexion du décor de galerie.
 *
 * Ils étaient absents — `variants: []` — parce que l'arbre n'en lit aucun. Depuis `23b`, une connexion
 * en porte un et un seul, non optionnel : le modèle refuse une connexion sans réglages, et c'est ce qui
 * empêche une déclaration à moitié écrite.
 */
const REGLAGES_DE_GALERIE = {
  host: 'localhost',
  port: 5432,
  defaultDatabase: 'analytics',
  username: 'dorabase',
  password: null,
  sslMode: 'prefer' as const,
  caCertificate: null,
  authDatabase: null,
  readOnly: true,
  reconnectOnStartup: false,
  tunnel: null,
}

/**
 * **Quatre environnements, et le seul marqué production ne s'appelle pas « prod »** (`23g`, `25a`).
 *
 * C'est ce qui met un trio en dur en évidence à l'œil, dans le décor même : un écran qui relirait
 * `prod` / `staging` / `dev` afficherait ici quatre lignes sans badge, ou un badge sur la mauvaise.
 * Les identifiants sont volontairement décorrélés des libellés — `23a` fige l'un et laisse renommer
 * l'autre, et un décor où les deux coïncident ne prouve rien.
 */
const ENVIRONNEMENTS_DE_GALERIE: EnvironmentDeclaration[] = [
  { id: 'atelier', label: 'atelier', color: 'green', production: false },
  { id: 'coulisses', label: 'coulisses', color: 'amber', production: false },
  { id: 'bac-a-sable', label: 'bac à sable', color: 'violet', production: false },
  { id: 'vitrine', label: 'vitrine', color: 'red', production: true },
]

const PROJETS_DEMO = [
  {
    name: 'Atelier Nord',
    environments: ENVIRONNEMENTS_DE_GALERIE,
    queries: [],
    databases: [
      // **`analytics` est déclarée deux fois, dans deux environnements** (`25a`). C'est le décor qui
      // met les collisions d'identité de nœud en évidence : tant que `idBase` ne portait pas
      // l'environnement, ces deux lignes partageaient leur dépliage, leur sélection, leur clé de
      // rendu et leur entrée dans `charge.schemas` — la structure d'un serveur s'affichait sous la
      // ligne de l'autre. Elles sont ici côte à côte, à un palier près, pour que ça se voie.
      {
        name: 'analytics',
        engine: 'postgresql' as const,
        environment: 'vitrine',
        connection: REGLAGES_DE_GALERIE,
        consoles: [],
      },
      {
        name: 'shop',
        engine: 'mysql' as const,
        environment: 'vitrine',
        connection: REGLAGES_DE_GALERIE,
        consoles: [],
      },
      {
        name: 'cache',
        engine: 'redis' as const,
        environment: 'vitrine',
        connection: REGLAGES_DE_GALERIE,
        consoles: [],
      },
      {
        name: 'analytics',
        engine: 'postgresql' as const,
        environment: 'atelier',
        connection: REGLAGES_DE_GALERIE,
        // Une console, pour que le palier 3 montre autre chose qu'un schéma.
        consoles: [{ name: 'Comptes du jour', sql: 'select count(*) from commandes' }],
      },
    ],
  },
  {
    name: 'Atelier Sud',
    environments: ENVIRONNEMENTS_DE_GALERIE,
    queries: [],
    databases: [
      {
        name: 'tracking',
        engine: 'mongodb' as const,
        environment: 'atelier',
        connection: REGLAGES_DE_GALERIE,
        consoles: [],
      },
    ],
  },
]

const ID_ENV = idEnvironnement('Atelier Nord', 'vitrine')
const ID_BASE = idBase('Atelier Nord', 'vitrine', 'analytics')
const ID_SCHEMA = idSchema('Atelier Nord', 'vitrine', 'analytics', 'public')

const CHARGE_DEMO: Charge = {
  schemas: {
    [ID_BASE]: [
      { name: 'public', counts: { tables: 4, views: 1, functions: 2, indexes: 6 } },
      { name: 'introspection', counts: { tables: 4, views: 1, functions: 2, indexes: 6 } },
    ],
  },
  objets: {
    [ID_SCHEMA]: [
      {
        name: 'orders',
        kind: 'table',
        rows: { kind: 'estimated', value: 1_900_000 },
        sizeBytes: 2.1 * 1024 ** 3,
        columnCount: 18,
        primaryKey: 'id',
        lastAnalyze: null,
        comment: null,
      },
      {
        name: 'users',
        kind: 'table',
        rows: { kind: 'estimated', value: 128_000 },
        sizeBytes: 96 * 1024 ** 2,
        columnCount: 12,
        primaryKey: 'id',
        lastAnalyze: null,
        comment: null,
      },
      {
        name: 'orders_by_day',
        kind: 'view',
        rows: { kind: 'estimated', value: 0 },
        sizeBytes: null,
        columnCount: 3,
        primaryKey: null,
        lastAnalyze: null,
        comment: null,
      },
    ],
  },
  enCours: new Set([idBase('Atelier Nord', 'vitrine', 'shop')]),
  echecs: { [idBase('Atelier Nord', 'vitrine', 'cache')]: 'hôte injoignable' },
}

function ExplorerSidebarGallery() {
  const [deplies, setDeplies] = useState<Set<string>>(
    new Set([
      idProjet('Atelier Nord'),
      // **Le palier d'environnement doit être déplié**, sinon l'arbre s'ouvre sur quatre lignes
      // d'environnement et le décor perd ses trois états de chargement.
      ID_ENV,
      ID_BASE,
      ID_SCHEMA,
      idBase('Atelier Nord', 'vitrine', 'shop'),
      idBase('Atelier Nord', 'vitrine', 'cache'),
    ]),
  )
  const [choisi, setChoisi] = useState<string | null>(ID_SCHEMA)

  return (
    <Section title="Sidebar de A4">
      <Note>
        **Le dépliage est paresseux** : un schéma replié ne produit aucun nœud enfant, donc l’écran
        n’a rien à demander. C’est la contrainte transverse appliquée à l’arbre.
      </Note>
      <Note>
        Un dépliage qui échoue le dit **sur sa ligne** et ne vide pas l’arbre — voir `cache`
        ci-dessous, hors ligne, tandis que `analytics` reste dépliée.
      </Note>
      <Sub title="Cinq niveaux, trois états de chargement, deux connexions homonymes">
        <div data-testid="sidebar-a4" style={{ display: 'flex', height: 420 }}>
          <ExplorerSidebar
            projects={PROJETS_DEMO}
            deplies={deplies}
            charge={CHARGE_DEMO}
            // **L'état discrimine sur le nom *et* l'environnement** : avec deux `analytics`, ne
            // regarder que le nom leur donnerait le même état — et le décor cesserait de montrer que
            // deux connexions homonymes sont deux connexions.
            etatDe={(_p, base, environnement) =>
              base === 'analytics' && environnement === 'vitrine'
                ? { kind: 'connected', serverVersion: 'PostgreSQL 17.6', tunnelLocalPort: null }
                : base === 'cache'
                  ? { kind: 'offline', reason: 'hôte injoignable' }
                  : { kind: 'never' }
            }
            selectedId={choisi}
            onSelect={(n) => setChoisi(n.id)}
            onToggle={(n) =>
              setDeplies((precedent) => {
                const suivant = new Set(precedent)
                if (suivant.has(n.id)) suivant.delete(n.id)
                else suivant.add(n.id)
                return suivant
              })
            }
          />
        </div>
      </Sub>
    </Section>
  )
}

// --- Centre de A4 (`09e`) ---------------------------------------------------------

function CentreGallery() {
  const [type, setType] = useState<TypeObjet>('tables')
  const [filtre, setFiltre] = useState('')
  const [choisi, setChoisi] = useState<string | null>('orders')

  const objets = (CHARGE_DEMO.objets[ID_SCHEMA] ?? []).filter((o) =>
    o.name.toLowerCase().includes(filtre.trim().toLowerCase()),
  )

  return (
    <Section title="Centre de A4">
      <Note>
        Les quatre comptes du contrôle segmenté viennent des **données**, jamais de constantes : les
        coder en dur les rendrait faux dès la première base réelle.
      </Note>
      <Note>
        Le mockup écrit « Chercher un objet… ⌘P », ce qui promet une recherche traversant tous les
        schémas et un raccourci pour l’ouvrir. Ni l’un ni l’autre n’existe : le champ dit donc ce
        qu’il fait, et le rappel `⌘P` est retiré — un raccourci affiché qui ne répond pas est pire
        qu’un raccourci absent.
      </Note>
      <Sub title="Fil d’Ariane, filtre, contrôle segmenté et tableau">
        <div data-testid="centre-a4" style={{ border: '1px solid var(--divider)' }}>
          <BreadcrumbBar
            database="analytics"
            schema="public"
            counts={{ tables: 4, views: 1, functions: 2, indexes: 6 }}
            type={type}
            onTypeChange={setType}
            filter={filtre}
            onFilterChange={setFiltre}
          />
          <ObjectTable
            schema="public"
            objects={objets}
            type={type}
            selectedName={choisi}
            onSelect={(o) => setChoisi(o.name)}
          />
        </div>
      </Sub>
      <Sub title="Les trois états vides, qui ne se ressemblent pas">
        <div className={styles.grid}>
          <div className={styles.cell}>
            <ObjectTable schema="public" objects={[]} type="views" onSelect={() => {}} />
            <span className={styles.cellCaption}>vide</span>
          </div>
          <div className={styles.cell}>
            <ObjectTable schema="public" objects={[]} type="tables" loading onSelect={() => {}} />
            <span className={styles.cellCaption}>chargement</span>
          </div>
          <div className={styles.cell}>
            <ObjectTable
              schema="public"
              objects={[]}
              type="tables"
              error="hôte injoignable"
              onSelect={() => {}}
            />
            <span className={styles.cellCaption}>échec</span>
          </div>
        </div>
      </Sub>
    </Section>
  )
}

// --- VirtualGrid et Popover (`10a`) -----------------------------------------------

type LigneDemo = { rang: number; id: number; statut: string }

const LIGNES_DEMO: LigneDemo[] = Array.from({ length: 100_000 }, (_, i) => ({
  rang: i + 1,
  id: 184_220 - i,
  statut: ['paid', 'pending', 'refunded', 'cancelled'][i % 4] ?? 'paid',
}))

/**
 * La toolbar de `A5` (`10e`), et son **état d'attente**.
 *
 * C'est le seul endroit du dépôt où l'animation du bouton « Rafraîchir » se mesure : dans la démo
 * tout répond instantanément, et jsdom ne calcule aucune animation. La galerie la montre à l'arrêt et
 * en cours, côte à côte.
 */
function ToolbarGallery() {
  const [limite, setLimite] = useState<RowLimit>('fiveHundred')
  const colonne = (name: string, typeName: string): ColumnInfo => ({
    position: 1,
    name,
    typeName,
    category: 'text',
    nullable: true,
    default: null,
    identity: null,
    key: null,
    frequency: null,
    comment: null,
  })
  const colonnes = [colonne('id', 'int8'), colonne('palier', 'text')]

  return (
    <Section title="Toolbar (10e, 29)">
      <Note>
        Le bouton « Rafraîchir » relit **les lignes et la structure**. Pendant la relecture il
        tourne et devient inerte ; sous `prefers-reduced-motion`, il ne fait que devenir inerte.
      </Note>
      <Sub title="Au repos">
        <div data-testid="toolbar-repos">
          <Toolbar
            limite={limite}
            onLimiteChange={setLimite}
            filters={[]}
            onRemoveFilter={() => {}}
            sort={[]}
            columns={colonnes}
            masquees={new Set()}
            onToggleColonne={() => {}}
            sql="select * from atelier.paliers limit 500 offset 0"
            onRefresh={() => {}}
          />
        </div>
      </Sub>
      <Sub title="Relecture en cours">
        <div data-testid="toolbar-en-cours">
          <Toolbar
            limite={limite}
            onLimiteChange={setLimite}
            filters={[]}
            onRemoveFilter={() => {}}
            sort={[]}
            columns={colonnes}
            masquees={new Set()}
            onToggleColonne={() => {}}
            sql={null}
            onRefresh={() => {}}
            enCours
          />
        </div>
      </Sub>
    </Section>
  )
}

function VirtualGridGallery() {
  const [choisie, setChoisie] = useState<string | null>(null)

  const colonnes: GridColumn<LigneDemo>[] = [
    { key: '#', header: '#', width: 30, numeric: true, cell: (l) => l.rang },
    { key: 'id', header: 'id', width: 90, numeric: true, cell: (l) => formatCount(l.id) },
    {
      key: 'statut',
      header: 'statut',
      width: 120,
      tint: 'filtered',
      cell: (l) => l.statut,
      // Un `<input>` nu : `Field` impose une étiquette visible, ce qu'une cellule d'en-tête de
      // 20 px ne peut pas porter. `10d` livrera le champ de filtre propre à `A5`.
      filter: (
        <input className={styles.gridFilter} defaultValue="paid" aria-label="filtre statut" />
      ),
    },
    // **Assez de colonnes pour déborder des 340 px du cadre.** C'est le cas qui a révélé, le
    // 10 août 2026, que le fond d'une ligne sélectionnée s'arrêtait au bord droit de la fenêtre et
    // que l'en-tête ne suivait pas le défilement horizontal. Sans débordement, aucun test ne peut
    // les voir.
    { key: 'devise', header: 'devise', width: 90, cell: () => 'EUR' },
    { key: 'note', header: 'note', width: 160, cell: (l) => `ligne ${l.rang}` },
  ]

  return (
    <Section title="VirtualGrid (10a)">
      <Note>
        Cent mille lignes, une dizaine de nœuds montés. `aria-rowcount` porte le **total** et
        `aria-rowindex` l’indice réel : sans eux, la virtualisation mentirait à l’arbre
        d’accessibilité au lieu de mentir seulement au navigateur.
      </Note>
      <Note>
        La hauteur du conteneur est une **prop**, pas une mesure : jsdom ne calcule aucune mise en
        page, et une virtualisation qui lit `clientHeight` rendrait zéro ligne sous Vitest.
      </Note>
      <Sub title="Cent mille lignes, en-tête de filtres, sélection">
        <div data-testid="virtual-grid" style={{ border: '1px solid var(--divider)', width: 340 }}>
          <VirtualGrid
            label="Lignes de public.orders"
            columns={colonnes}
            rows={LIGNES_DEMO}
            rowId={(l) => String(l.id)}
            viewportHeight={208}
            filterRow
            selectedId={choisie}
            onSelect={(l) => setChoisie(String(l.id))}
          />
        </div>
      </Sub>
      {/* **Le cas inverse du précédent** : des colonnes qui ne remplissent pas le cadre. C'est celui
          qui a montré, le 25 août 2026, que la bande d'en-tête s'arrêtait après la dernière colonne
          — le fond était peint par piste de grille, et il n'y a pas de piste au-delà. Sans un décor
          où les colonnes sont plus étroites que le cadre, aucun test ne pouvait le voir. */}
      <Sub title="Moins de colonnes que de largeur">
        <div
          data-testid="virtual-grid-etroite"
          style={{ border: '1px solid var(--divider)', width: 340 }}
        >
          <VirtualGrid
            label="Lignes de public.paliers"
            columns={[
              { key: 'id', header: 'id', width: 40, cell: (l: LigneDemo) => String(l.id) },
              { key: 'palier', header: 'palier', width: 70, cell: () => 'or' },
            ]}
            rows={LIGNES_DEMO.slice(0, 4)}
            rowId={(l) => String(l.id)}
            viewportHeight={104}
            filterRow
          />
        </div>
      </Sub>
      <Sub title="Vide">
        <div style={{ border: '1px solid var(--divider)', width: 340 }}>
          <VirtualGrid
            label="Lignes"
            columns={colonnes}
            rows={[]}
            rowId={(l) => String(l.id)}
            viewportHeight={80}
            empty="Aucune ligne ne correspond aux filtres."
          />
        </div>
      </Sub>
    </Section>
  )
}

function PopoverGallery() {
  const operateurs = [
    { signe: '=', mot: 'égal' },
    { signe: '≠', mot: 'différent' },
    { signe: 'in', mot: 'dans la liste…' },
    { signe: '~', mot: 'contient' },
    { signe: '∅', mot: 'is null' },
  ]

  const contenu = (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {operateurs.map((o) => (
        <li key={o.signe}>
          <button type="button" className={styles.popoverItem}>
            <span className={styles.popoverSign}>{o.signe}</span>
            {o.mot}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <Section title="Popover (10a)">
      <Note>
        Trois fermetures, et les trois comptent : `Échap`, clic extérieur, perte de focus. La
        dernière est celle qu’on oublie — sans elle, tabuler hors du panneau laisse visible un
        panneau que plus rien ne concerne.
      </Note>
      <Note>
        Pas de portail : un portail placerait le panneau en fin de document et `Tab` sauterait tout
        l’écran pour l’atteindre. Contrepartie assumée — près du bord droit, le panneau bascule son
        alignement lui-même. La seconde carte le montre.
      </Note>
      <Sub title="Ancré à gauche, et rattrapé au bord droit">
        <div
          data-testid="popover-bord"
          style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
        >
          <Popover title="Opérateur · status" content={contenu}>
            <Button variant="secondary" size="sm">
              status
            </Button>
          </Popover>
          <Popover title="Opérateur · total_cents" content={contenu}>
            <Button variant="secondary" size="sm">
              total_cents
            </Button>
          </Popover>
        </div>
      </Sub>
    </Section>
  )
}

// --- Panneau de détail de A4 (`09f`) ----------------------------------------------

const DETAIL_DEMO = {
  schema: 'public',
  name: 'orders',
  rows: { kind: 'estimated' as const, value: 1_900_000 },
  sizeBytes: 2.1 * 1024 ** 3,
  comment: null,
  columns: [
    {
      position: 1,
      name: 'id',
      typeName: 'bigint',
      category: 'number' as const,
      nullable: false,
      default: null,
      identity: null,
      key: 'primary' as const,
      comment: null,
      frequency: null,
    },
    {
      position: 2,
      name: 'user_id',
      typeName: 'bigint',
      category: 'number' as const,
      nullable: false,
      default: null,
      identity: null,
      key: 'foreign' as const,
      comment: null,
      frequency: null,
    },
    {
      position: 3,
      name: 'status',
      typeName: 'text',
      category: 'text' as const,
      nullable: false,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 4,
      name: 'total_cents',
      typeName: 'integer',
      category: 'number' as const,
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    {
      position: 5,
      name: 'currency',
      typeName: 'char(3)',
      category: 'text' as const,
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    },
    ...Array.from({ length: 13 }, (_, i) => ({
      position: 6 + i,
      name: `extra_${i}`,
      typeName: 'text',
      category: 'text' as const,
      nullable: true,
      default: null,
      identity: null,
      key: null,
      comment: null,
      frequency: null,
    })),
  ],
  indexes: [],
  constraints: [],
  triggers: [],
  relations: [
    {
      constraintName: 'fk_user',
      direction: 'outgoing' as const,
      columns: ['user_id'],
      targetSchema: 'public',
      targetTable: 'users',
      targetColumns: ['id'],
    },
    {
      constraintName: 'fk_coupon',
      direction: 'outgoing' as const,
      columns: ['coupon_code'],
      targetSchema: 'public',
      targetTable: 'coupons',
      targetColumns: ['code'],
    },
    {
      constraintName: 'fk_invoice',
      direction: 'incoming' as const,
      columns: ['id'],
      targetSchema: 'public',
      targetTable: 'invoices',
      targetColumns: ['order_id'],
    },
  ],
  ddl: '',
}

/**
 * Le stepper de `24b`.
 *
 * **Vérifiable ici avant que le parcours existe** : la bande est une primitive, et l'agent UI l'avait
 * noté — elle peut expédier séparément de l'écran qui l'emploiera.
 */
function StepperGallery() {
  return (
    <Section title="Stepper informatif (24b)">
      <Note>
        Le handoff **ne maquette aucun stepper**. Celui-ci reprend la grammaire de bande du produit
        — `--h-bar` de contenu, fond `--bar`, filet bas `--divider`, comme `TabStrip` — pour qu’il
        se lise comme une rubrique de la modale plutôt que comme un objet venu d’ailleurs.
      </Note>
      <Note>
        **Rien n’y est cliquable, et il n’en a pas l’air.** Ni bouton, ni curseur de pointeur, ni
        survol, ni tabulation, ni `role="tablist"` — ce dernier *promettrait* la navigation aux
        flèches (leçon du défaut n° 52). Passez la souris dessus : rien ne réagit, et c’est le
        message.
      </Note>
      <Sub title="Étape 1 en cours">
        <div data-testid="stepper-un" style={{ width: 520 }}>
          <Stepper etapes={[{ libelle: 'PROJET' }, { libelle: 'CONNEXION' }]} courante={0} />
        </div>
      </Sub>
      <Sub title="Étape 1 faite, étape 2 en cours">
        <div data-testid="stepper-deux" style={{ width: 520 }}>
          <Stepper etapes={[{ libelle: 'PROJET' }, { libelle: 'CONNEXION' }]} courante={1} />
        </div>
      </Sub>
      <Sub title="Quatre étapes — la bande ne se disperse pas">
        <div style={{ width: 820 }}>
          <Stepper
            etapes={[
              { libelle: 'PROJET' },
              { libelle: 'CONNEXION' },
              { libelle: 'SCHÉMA' },
              { libelle: 'FIN' },
            ]}
            courante={2}
          />
        </div>
      </Sub>
    </Section>
  )
}

function DetailPanelGallery() {
  const [epingle, setEpingle] = useState(false)

  return (
    <Section title="Panneau de détail (A4)">
      <Note>
        **Les quatre actions sont désactivées, avec une infobulle nommant l’écran attendu** — à
        l’inverse de A1 et 08b, qui livrent des boutons actifs mais sans effet. Là un seul bouton
        était inerte et son écran venait dans la spec suivante ; ici quatre sur quatre le sont, à
        trois specs de distance.
      </Note>
      <Note>
        `aria-disabled` et non `disabled` : un bouton désactivé ne reçoit ni focus ni survol, donc
        son infobulle serait inatteignable — exactement là où elle est le plus utile.
      </Note>
      <Sub title="Table sélectionnée">
        {/* **300 px, la mesure du mockup, portée par le conteneur.** Le panneau la prenait de sa
            feuille de style ; dans l'écran de travail il est le panneau d'un `SplitPane` réglable, et
            une largeur fixe le faisait sortir de la fenêtre. La mesure du handoff reste vérifiée
            ici — c'est la galerie qui la donne, comme elle donne déjà sa hauteur. */}
        {/* Le filet gauche est celui de la **colonne** dans l'écran de travail (`ColonneDroite`) ; ici
            le panneau est montré seul, donc le décor le pose — sans quoi la galerie afficherait un
            panneau sans son bord, ce que l'écran ne fait jamais. */}
        <div
          data-testid="detail-a4"
          style={{
            display: 'flex',
            height: 520,
            width: 300,
            borderLeft: '1px solid var(--divider)',
          }}
        >
          <DetailPanel
            detail={DETAIL_DEMO}
            schema="public"
            pinned={epingle}
            onTogglePin={() => setEpingle((e) => !e)}
          />
        </div>
      </Sub>
      <Sub title="Sans sélection">
        <div style={{ display: 'flex', height: 120, borderLeft: '1px solid var(--divider)' }}>
          <DetailPanel detail={null} schema="public" />
        </div>
      </Sub>
    </Section>
  )
}

export function Gallery() {
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Galerie des primitives</h1>
      <ButtonGallery />
      <FieldGallery />
      <ToggleGallery />
      <BadgeGallery />
      <ChipGallery />
      <RadioGroupGallery />
      <SelectGallery />
      <CollapsiblePanelGallery />
      <ModalGallery />
      <SegmentedControlGallery />
      <StatTileGallery />
      <DataTableGallery />
      <TitleBarGallery />
      <ExplorerSidebarGallery />
      <CentreGallery />
      <VirtualGridGallery />
      <ToolbarGallery />
      <PopoverGallery />
      <StepperGallery />
      <DetailPanelGallery />
      <DotGallery />
      <SplitPaneGallery />
      <TabStripGallery />
      <SidebarGallery />
      <IconBoard />
      <TokenBoard />
    </div>
  )
}
