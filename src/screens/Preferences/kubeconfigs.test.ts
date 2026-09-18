import { describe, expect, it } from 'vitest'
import type { Kubeconfigs, ManagedInstance, Project } from '../../domain/config'
import {
  avecLeChemin,
  avecLeDefaut,
  avecLeLibelle,
  sansLaDeclaration,
  utilisationsDe,
} from './kubeconfigs'

const DEUX: Kubeconfigs = {
  declarations: [
    { id: 'prod', label: 'prod', path: '~/.kube/prod/config' },
    { id: 'bac', label: 'bac à sable', path: '~/.kube/bac.yaml' },
  ],
  default: 'prod',
}

/** Une connexion qui vise un cluster par la référence donnée. */
function connexion(name: string, environment: string, kubeconfig: string | null) {
  return {
    name,
    engine: 'postgresql' as const,
    environment,
    connection: {
      host: '127.0.0.1',
      port: 5432,
      username: 'dora',
      password: null,
      defaultDatabase: 'catalogue',
      sslMode: 'prefer' as const,
      caCertificate: null,
      authDatabase: null,
      tunnel: {
        localPort: null,
        proxy: {
          kind: 'kubernetes' as const,
          kubeconfig,
          namespace: null,
          resource: 'svc/postgres',
        },
      },
    },
    consoles: [],
  }
}

function projet(name: string, databases: ReturnType<typeof connexion>[]): Project {
  return {
    name,
    environments: [{ id: 'prod', label: 'prod', color: 'rouge', production: true }],
    databases,
    queries: [],
  } as unknown as Project
}

describe('qui se sert d’une déclaration', () => {
  it('nomme les connexions, projet et environnement compris', () => {
    // **Des étiquettes, jamais un compte** : la raison d'un retrait refusé doit dire *quoi changer*,
    // et « 3 connexions » n'envoie nulle part.
    const projects = [projet('Halle', [connexion('catalogue', 'prod', 'prod')])]

    expect(utilisationsDe('prod', projects, [])).toEqual(['Halle › catalogue (prod)'])
  })

  it('compte aussi les instances managées', () => {
    // Elles portent les mêmes réglages de connexion, donc le même proxy. Les omettre ferait un
    // bouton **actif qui échoue** — exactement le défaut que le grisé existe pour éviter, et le
    // cœur refuserait alors le retrait que l'écran vient d'autoriser.
    const instances = [
      { id: 'pg-prod', label: 'pg prod', ...connexion('x', 'prod', 'prod') },
    ] as unknown as ManagedInstance[]

    expect(utilisationsDe('prod', [], instances)).toEqual(['pg prod'])
  })

  it('ne nomme pas une connexion qui vise une autre déclaration', () => {
    // Le contrôle négatif : sans lui, « qui s'en sert » rendrait tout ce qui est Kubernetes, et
    // aucune déclaration ne serait jamais retirable.
    const projects = [projet('Halle', [connexion('catalogue', 'prod', 'bac')])]

    expect(utilisationsDe('prod', projects, [])).toEqual([])
  })

  it('ne nomme pas une connexion sans kubeconfig, ni sans proxy', () => {
    const projects = [projet('Halle', [connexion('catalogue', 'prod', null)])]

    expect(utilisationsDe('prod', projects, [])).toEqual([])
  })
})

describe('régler la liste', () => {
  it('renomme sans toucher à l’identifiant — c’est lui que les connexions désignent', () => {
    const suivants = avecLeLibelle(DEUX, 'prod', 'production')

    const declaration = suivants.declarations?.find((entree) => entree.id === 'prod')
    expect(declaration?.label).toBe('production')
    expect(declaration?.id).toBe('prod')
  })

  it('déplace un fichier sans toucher à l’identifiant — c’est tout l’achat de la référence', () => {
    const suivants = avecLeChemin(DEUX, 'prod', '~/ailleurs/config')

    const declaration = suivants.declarations?.find((entree) => entree.id === 'prod')
    expect(declaration?.path).toBe('~/ailleurs/config')
    expect(declaration?.id).toBe('prod')
  })

  it('retire le défaut avec la déclaration qu’il désignait', () => {
    // Sans cela le défaut désignerait le vide, ce que `Kubeconfigs::valider` refuse côté Rust —
    // donc un retrait qui échouerait pour une raison que personne n'a demandée.
    const suivants = sansLaDeclaration(DEUX, 'prod')

    expect(suivants.declarations?.map((entree) => entree.id)).toEqual(['bac'])
    expect(suivants.default).toBeNull()
  })

  it('garde le défaut quand on retire une autre déclaration', () => {
    // Le contrôle négatif du test précédent : sans lui, tout retrait effacerait le défaut.
    const suivants = sansLaDeclaration(DEUX, 'bac')

    expect(suivants.default).toBe('prod')
  })

  it('déplace le défaut plutôt que d’en ajouter un second', () => {
    expect(avecLeDefaut(DEUX, 'bac').default).toBe('bac')
    expect(avecLeDefaut(DEUX, null).default).toBeNull()
  })
})
