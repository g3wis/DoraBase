import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Sprite } from '../../design/icons/Sprite'
import type { UpdateVariantRequest } from '../../domain/arbre'
import type { Database, FolderTree, SecretRef } from '../../domain/config'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { emptyDraft } from './ConnectionDraft'
import { draftToUpdateRequest } from './enregistrerLaBase'
import { NewConnection } from './NewConnection'
import { arbreDeTest, trioDeTest } from './pourLesTests'

// **Noms inventés.** Ce test portait les identifiants d'une base réelle du commanditaire, ce qui
// publiait un nom d'utilisateur et un nom de base dans le dépôt. Un décor de test n'a jamais besoin
// d'être vrai — seulement cohérent.
const BASE: Database = {
  id: 'c0000000000000e1',
  name: 'analytics',
  engine: 'postgresql',
  connection: {
    host: 'localhost',
    port: 5432,
    defaultDatabase: 'atelier',
    username: 'atelier',
    // `SecretRef` est un type **nominal** (`05a`) : une chaîne ne s'y affecte pas, ce qui empêche
    // d'y mettre une valeur de secret par erreur. Le cast est donc explicite, et cantonné au test.
    password: 'connexion/c0000000000000e1' as SecretRef,
    // **`verify-full`, et pas pour ce qu'il chiffre** : la base est en `prod`, et un mode qui
    // n'authentifie pas y fait passer l'enregistrement par un rappel (#87) — que ces tests, qui
    // parlent de mise à jour et de secret, n'ont pas à traverser. Le rappel a les siens.
    sslMode: 'verify-full',
    caCertificate: null,
    authDatabase: null,
    readOnly: true,
    reconnectOnStartup: false,
    tunnel: null,
  },
  consoles: [],
}

/** La connexion vit dans `Atelier Nord` › `prod` : c'est le cadre qui s'annonce en édition. */
const APRES: FolderTree = arbreDeTest(trioDeTest({ prod: [BASE] }))

function monter(over: { onUpdate?: (r: UpdateVariantRequest) => Promise<FolderTree> } = {}) {
  const requetes: UpdateVariantRequest[] = []
  render(
    <>
      <Sprite />
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection
          onClose={() => {}}
          arbre={APRES}
          edition={BASE}
          onBrowseKey={async () => null}
          onTest={async () => {
            throw new Error('non employé')
          }}
          onUpdate={
            over.onUpdate ??
            (async (requete) => {
              requetes.push(requete)
              return APRES
            })
          }
        />
      </LanguageProvider>
    </>,
  )
  return requetes
}

const enregistrer = () => screen.getByRole('button', { name: /Enregistrer les modifications/ })

describe('draftToUpdateRequest', () => {
  it('l’identité vient de la cible, jamais du brouillon', () => {
    // Ce test le vérifie au niveau de la fonction, où la divergence est représentable : un nom
    // modifié dans le brouillon ne désigne aucune autre connexion (#166).
    const draft = { ...emptyDraft(), name: 'renommee', host: 'db.nouveau' }
    const requete = draftToUpdateRequest(draft, 'c0000000000000e1')

    expect(requete.connection).toBe('c0000000000000e1')
    // Les réglages, eux, viennent bien du brouillon.
    expect(requete.variant.host).toBe('db.nouveau')
  })
})

describe('modifier une connexion (08g)', () => {
  it('la modale se nomme par la base et son bouton dit « modifications »', () => {
    monter()
    expect(screen.getByRole('dialog', { name: 'Modifier analytics' })).toBeInTheDocument()
    expect(enregistrer()).toBeInTheDocument()
  })

  it('les réglages enregistrés sont préremplis', () => {
    monter()
    expect(screen.getByLabelText('Hôte')).toHaveValue('localhost')
    expect(screen.getByLabelText('Port')).toHaveValue('5432')
    expect(screen.getByLabelText('Base par défaut')).toHaveValue('atelier')
    expect(screen.getByLabelText('Utilisateur')).toHaveValue('atelier')
  })

  it('le mot de passe part vide : le front ne l’a pas', () => {
    monter()
    // La variante ne porte qu'une `SecretRef`, jamais la valeur — et un champ vide veut dire
    // « inchangé », ce que le cœur applique.
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('')
  })

  it('aucun champ d’identité ne subsiste : le groupe « Environnement » est parti', () => {
    // Le dernier champ verrouillé du formulaire était l'environnement. La connexion se range dans
    // un dossier, qui est le cadre de la modale (#166).
    monter()
    expect(screen.queryByRole('group', { name: 'Environnement' })).toBeNull()
  })

  it('le dossier de la connexion modifiée s’annonce en tête, et ne se choisit pas', () => {
    monter()
    expect(screen.queryByRole('combobox', { name: /Projet|Dossier/ })).toBeNull()
    expect(screen.getByTestId('dossier-de-la-modale')).toHaveTextContent('Atelier Nord › prod')
  })

  it('enregistrer envoie une mise à jour, jamais un ajout', async () => {
    const utilisateur = userEvent.setup()
    const requetes = monter()

    await utilisateur.clear(screen.getByLabelText('Port'))
    await utilisateur.type(screen.getByLabelText('Port'), '5433')
    await utilisateur.click(enregistrer())

    await waitFor(() => expect(requetes).toHaveLength(1))
    const requete = requetes[0]
    expect(requete?.variant.port).toBe(5433)
    // L'identité vient de la **cible**, pas du brouillon : c'est elle qui désigne la connexion.
    expect(requete?.connection).toBe('c0000000000000e1')
    // Champ vide : le secret reste en place.
    expect(requete?.password).toBeNull()
  })

  it('un mot de passe saisi est envoyé, et remplace le secret', async () => {
    const utilisateur = userEvent.setup()
    const requetes = monter()

    await utilisateur.type(screen.getByLabelText('Mot de passe'), 'nouveau')
    await utilisateur.click(enregistrer())

    await waitFor(() => expect(requetes[0]?.password).toBe('nouveau'))
  })

  it('un refus du cœur s’affiche là où les échecs s’affichent déjà', async () => {
    const utilisateur = userEvent.setup()
    monter({
      onUpdate: async () => {
        throw new Error('la base de données « c0000000000000e1 » n’existe plus')
      },
    })

    await utilisateur.click(enregistrer())
    expect(await screen.findByText(/n’existe plus/)).toBeInTheDocument()
  })

  it('un tunnel enregistré est prérempli, panneau compris', () => {
    // **Le tunnel est le sujet du test**, et une conversion mécanique du décor l'avait remplacé par
    // des réglages neutres : le test échouait alors sur l'absence de « SSH activé », c'est-à-dire sur
    // son propre décor.
    const avecTunnel: Database = {
      ...BASE,
      connection: {
        ...BASE.connection,
        tunnel: {
          localPort: null,
          proxy: {
            kind: 'ssh',
            bastionHost: 'bastion.interne',
            bastionPort: 22,
            username: 'dora',
            privateKeyPath: '/Users/dora/.ssh/id_ed25519',
          },
        },
      },
    }
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <NewConnection
            onClose={() => {}}
            arbre={APRES}
            edition={avecTunnel}
            onBrowseKey={async () => null}
            onTest={async () => {
              throw new Error('non employé')
            }}
            onUpdate={async () => APRES}
          />
        </LanguageProvider>
      </>,
    )

    // Le panneau est replié à l'ouverture (`08c`) : le badge dit qu'il y a un tunnel dedans.
    expect(screen.getByText(/SSH activé/)).toBeInTheDocument()
  })
})

describe('la case « Lecture seule » sous un dossier qui l’impose (#168)', () => {
  it('montre l’état effectif, figé avec sa raison, et enregistre la valeur locale', async () => {
    // **Localement inscriptible** : sans cela, « la valeur locale est gardée » et « la valeur
    // effective est envoyée » rendraient la même requête (règle n° 5).
    const locale: Database = { ...BASE, connection: { ...BASE.connection, readOnly: false } }
    const arbre = arbreDeTest(trioDeTest({ prod: [locale] }))
    const requetes: UpdateVariantRequest[] = []
    render(
      <>
        <Sprite />
        <LanguageProvider preferences={{ language: 'fr' }}>
          <NewConnection
            onClose={() => {}}
            arbre={arbre}
            edition={locale}
            onBrowseKey={async () => null}
            onTest={async () => {
              throw new Error('non employé')
            }}
            onUpdate={async (requete) => {
              requetes.push(requete)
              return arbre
            }}
          />
        </LanguageProvider>
      </>,
    )

    const caseLS = screen.getByRole('switch', { name: 'Ouvrir en lecture seule' })
    expect(caseLS).toHaveAttribute('aria-checked', 'true')
    expect(caseLS).toBeDisabled()
    expect(caseLS).toHaveAttribute('title', 'Imposée par le dossier « prod »')

    await userEvent.click(enregistrer())
    await waitFor(() => expect(requetes).toHaveLength(1))
    // **La valeur locale, non écrasée** : lever la lecture seule du dossier rendra à la connexion le
    // choix qu'on y avait fait.
    expect(requetes[0]?.variant.readOnly).toBe(false)
  })

  it('hors d’un dossier qui l’impose, la case est la valeur locale et se règle', () => {
    const libre: Database = { ...BASE, connection: { ...BASE.connection, readOnly: false } }
    const arbre = arbreDeTest(trioDeTest({ dev: [libre] }))
    render(
      <LanguageProvider preferences={{ language: 'fr' }}>
        <NewConnection
          onClose={() => {}}
          arbre={arbre}
          edition={libre}
          onBrowseKey={async () => null}
          onTest={async () => {
            throw new Error('non employé')
          }}
        />
      </LanguageProvider>,
    )
    const caseLS = screen.getByRole('switch', { name: 'Ouvrir en lecture seule' })
    expect(caseLS).toHaveAttribute('aria-checked', 'false')
    expect(caseLS).toBeEnabled()
    expect(caseLS).not.toHaveAttribute('title')
  })
})
