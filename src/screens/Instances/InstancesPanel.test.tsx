import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { ConnectionState } from '../../domain/engine'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { INDENT } from '../../ui/TreeRow/TreeRow'
import { InstancesPanel } from './InstancesPanel'
import { instanceDeTest } from './pourLesTests'

function monter(options: Partial<Parameters<typeof InstancesPanel>[0]> = {}) {
  return render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <InstancesPanel
          instances={[instanceDeTest()]}
          etats={{}}
          onSelect={() => {}}
          {...options}
        />
      </LanguageProvider>
    </>,
  )
}

test('une instance sans état n’affiche aucun badge : « jamais tentée » n’est pas un défaut', () => {
  // La règle des quatre états de l'arbre, reprise telle quelle : coller une marque à une instance
  // qu'on n'a pas ouverte la ferait paraître en défaut.
  monter()
  expect(screen.queryByText('OK')).toBeNull()
  expect(screen.queryByText('HORS LIGNE')).toBeNull()
})

test('les quatre états portent le vocabulaire de l’arbre, pas un second', () => {
  // Une instance ouverte et une base ouverte sont dans le même état, décrit par le même type : deux
  // vocabulaires feraient lire « OK » d'un côté et « Connectée » de l'autre, à trois lignes d'écart.
  const cas: [ConnectionState, string | null][] = [
    [{ kind: 'never' }, null],
    [{ kind: 'connecting' }, '…'],
    [{ kind: 'connected', serverVersion: 'PostgreSQL 17.6', tunnelLocalPort: null }, 'OK'],
    [{ kind: 'offline', reason: 'injoignable' }, 'HORS LIGNE'],
  ]
  for (const [etat, attendu] of cas) {
    const { unmount } = monter({ etats: { 'pg-atelier': etat } })
    if (attendu === null) expect(screen.queryByText('OK')).toBeNull()
    else expect(screen.getByText(attendu)).toBeInTheDocument()
    unmount()
  }
})

test('la version ne paraît qu’une fois la connexion faite', () => {
  // L'annoncer avant serait affirmer une version qu'on n'a pas lue.
  monter()
  expect(screen.queryByText('pg 17.6')).toBeNull()

  monter({
    etats: {
      'pg-atelier': {
        kind: 'connected',
        serverVersion: 'PostgreSQL 17.6',
        tunnelLocalPort: null,
      },
    },
  })
  expect(screen.getByText('pg 17.6')).toBeInTheDocument()
})

test('le badge PROD suit le drapeau, jamais le libellé', () => {
  // La règle d'`EnvironmentDeclaration::production` : une instance nommée « live » et marquée
  // production est protégée ; une instance nommée « prod » que personne n'a marquée ne l'est pas.
  monter({ instances: [instanceDeTest({ label: 'prod', production: false })] })
  expect(screen.queryByText('PROD')).toBeNull()

  monter({ instances: [instanceDeTest({ id: 'live', label: 'live', production: true })] })
  expect(screen.getByText('PROD')).toBeInTheDocument()
})

test('l’icône d’une instance tombe dans la colonne des icônes de projet', () => {
  // **`INDENT[0] + 16`, la reprise de la gouttière du chevron** qu'une feuille n'occupe pas — la
  // règle de `TreeRow`. Sans elle, deux listes voisines auraient leurs icônes décalées de 16 px, ce
  // qui se lit comme deux composants mal assemblés.
  //
  // La mesure porte sur la **déclaration**, non sur un rectangle : jsdom ne calcule aucune mise en
  // page (règle n° 9), et c'est la valeur posée qui est en cause ici.
  monter()
  const ligne = screen.getByRole('button', { name: /^PG atelier/ })
  // jsdom réduit `calc(8px + 16px)` à `calc(24px)` : c'est la **somme** qu'il faut lire, non la
  // chaîne écrite. Elle est comparée à `INDENT[0]`, importée et non recopiée — une valeur en dur ici
  // se périmerait à la première mesure d'indentation qui bouge, sans que rien le dise.
  expect(pixels(ligne.style.paddingLeft)).toBe(pixels(INDENT[0]) + 16)
})

/** La somme des longueurs d'une déclaration CSS, en pixels. */
function pixels(declaration: string): number {
  return (declaration.match(/-?\d+(?:\.\d+)?(?=px)/g) ?? [])
    .map(Number)
    .reduce((total, valeur) => total + valeur, 0)
}

test('une ligne n’a pas de chevron : ce qui est dans une instance se regarde au centre', () => {
  // Le déplier ici ferait entrer une matrice de rôles × bases dans une colonne de 228 px.
  monter()
  expect(screen.getByRole('button', { name: /^PG atelier/ })).not.toHaveAttribute('aria-expanded')
})

test('le clic sélectionne, et le menu « … » n’ouvre pas l’onglet', async () => {
  // **Un menu et non deux carrés nus** (9 septembre 2026) : deux boutons de 18 px recouvraient la
  // version et le badge d'état, et `RowMenu` est ce que portent déjà les lignes de projet et de
  // connexion. Le test suit donc le vrai parcours — ouvrir le menu, choisir l'entrée.
  const onSelect = vi.fn()
  const onEdit = vi.fn()
  const onRemove = vi.fn()
  monter({ onSelect, onEdit, onRemove })
  const utilisateur = userEvent.setup()

  await utilisateur.click(screen.getByRole('button', { name: /^PG atelier/ }))
  expect(onSelect).toHaveBeenCalledTimes(1)

  // **Ouvrir le menu ne sélectionne pas** : le déclencheur vit dans la gouttière, en frère de la
  // ligne et non dedans — un bouton dans un bouton serait invalide, et le clic déclencherait les
  // deux.
  await utilisateur.click(screen.getByRole('button', { name: 'Actions de PG atelier' }))
  expect(onSelect).toHaveBeenCalledTimes(1)

  await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }))
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledTimes(1)

  await utilisateur.click(screen.getByRole('button', { name: 'Actions de PG atelier' }))
  await utilisateur.click(screen.getByRole('button', { name: 'Supprimer' }))
  expect(onRemove).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledTimes(1)
})

test('les actions vivent dans un menu, une seule cible dans la gouttière', () => {
  // **Le défaut du 9 septembre, gardé par sa cause** : deux boutons de 18 px occupaient 45 px depuis
  // le bord et recouvraient « pg 17.6 » puis « OK ». Un seul déclencheur tient dans la gouttière de
  // 24 px que `TreeRow` réserve.
  //
  // Ce que ce niveau peut dire est **le compte de cibles** ; le recouvrement lui-même est une
  // mesure de rectangles, donc hors de portée de jsdom (règle n° 9) — `api-32-instances.spec.ts`
  // s'en charge.
  monter({
    onEdit: () => {},
    onRemove: () => {},
    etats: {
      'pg-atelier': {
        kind: 'connected',
        serverVersion: 'PostgreSQL 17.6',
        tunnelLocalPort: null,
      },
    },
  })
  const ligne = screen.getByRole('button', { name: /^PG atelier/ })
  const enveloppe = ligne.parentElement as HTMLElement
  const cibles = within(enveloppe)
    .getAllByRole('button')
    .filter((bouton) => bouton !== ligne)
  expect(cibles).toHaveLength(1)
  expect(cibles[0]).toHaveAccessibleName('Actions de PG atelier')
  // Et la méta que les deux boutons recouvraient est bien là, à côté du badge d'état.
  expect(screen.getByText('pg 17.6')).toBeInTheDocument()
  expect(screen.getByText('OK')).toBeInTheDocument()
})

test('le « + » ne paraît que si quelque chose l’écoute', async () => {
  // Un bouton inerte mais actif se lit comme une panne : le défaut n° 36.
  monter()
  expect(screen.queryByRole('button', { name: 'Déclarer une instance' })).toBeNull()

  const onDeclare = vi.fn()
  monter({ onDeclare })
  await userEvent.setup().click(screen.getByRole('button', { name: 'Déclarer une instance' }))
  expect(onDeclare).toHaveBeenCalled()
})

test('aucune instance déclarée : la zone le dit, et garde son « + »', () => {
  // Sans ce chemin, un utilisateur qui n'a jamais déclaré d'instance n'aurait nulle part où
  // commencer — la zone serait vide et muette.
  monter({ instances: [], onDeclare: () => {} })
  expect(screen.getByText('Aucune instance déclarée.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Déclarer une instance' })).toBeInTheDocument()
})

test('l’infobulle d’une ligne dit l’hôte, le port et le rôle', () => {
  // C'est ce qui distingue deux instances de libellé voisin, et le libellé seul ne le dit pas.
  monter()
  expect(screen.getByRole('button', { name: /^PG atelier/ })).toHaveAttribute(
    'title',
    'localhost:5432 — connecté en postgres',
  )
})
