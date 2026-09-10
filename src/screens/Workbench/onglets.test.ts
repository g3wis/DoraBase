import { describe, expect, it } from 'vitest'
import type { DatabaseKey } from '../../domain/engine'
import {
  AUCUN_ONGLET,
  type EtatOnglets,
  fermer,
  idApresRenommage,
  idOnglet,
  type Onglet,
  type OngletConsole,
  ongletActif,
  ouvrir,
  ouvrirConsole,
  reindexerParConnexion,
  renommerLaConnexion,
  reordonner,
  viseeParLId,
} from './onglets'

const analytics: DatabaseKey = {
  project: 'Atelier Nord',
  database: 'analytics',
  environment: 'prod',
}
const shop: DatabaseKey = { project: 'Atelier Nord', database: 'shop', environment: 'prod' }

const orders = {
  sorte: 'table' as const,
  key: analytics,
  schema: 'public',
  table: 'orders',
  kind: 'table' as const,
}
const items = {
  sorte: 'table' as const,
  key: analytics,
  schema: 'public',
  table: 'order_items',
  kind: 'table' as const,
}

/**
 * Le nom lisible d'un onglet — l'union interdit un `.table` direct.
 *
 * **Un `switch` exhaustif depuis le 3 septembre 2026.** Cette fonction s'écrivait en un ternaire
 * « console, ou table » ; le diagramme de schéma, troisième membre de l'union, y serait tombé du
 * côté « table » et aurait rendu `undefined`. Le compilateur l'a refusé, et c'est exactement ce
 * qu'on lui demande — le défaut n° 16 est ce qui arrive quand un bras attrape-tout l'en empêche.
 */
function libelle(onglet: Onglet): string {
  switch (onglet.sorte) {
    // `API-32` : le quatrième membre de l'union. Le compilateur l'a réclamé ici aussi — c'est ce que
    // ce `switch` existe pour faire.
    case 'instance':
      return onglet.instance
    case 'console':
      return `console ${onglet.numero}`
    case 'diagramme':
      return onglet.schema
    case 'table':
      return onglet.table
  }
}

function avec(...ouverts: (typeof orders)[]): EtatOnglets {
  return ouverts.reduce(ouvrir, AUCUN_ONGLET)
}

describe('onglets', () => {
  it('ouvre une table et l’active', () => {
    const etat = ouvrir(AUCUN_ONGLET, orders)
    expect(etat.onglets).toHaveLength(1)
    expect(ongletActif(etat)).toEqual(orders)
  })

  it('rouvrir une table déjà ouverte l’active sans la dupliquer', () => {
    const etat = fermer(avec(orders, items), idOnglet(items))
    const rouvert = ouvrir(ouvrir(etat, items), orders)

    expect(rouvert.onglets).toHaveLength(2)
    expect(rouvert.actif).toBe(idOnglet(orders))
  })

  it('deux tables de même nom dans deux bases font deux onglets', () => {
    const autre = { ...orders, key: shop }
    const etat = ouvrir(ouvrir(AUCUN_ONGLET, orders), autre)

    expect(etat.onglets).toHaveLength(2)
    expect(idOnglet(orders)).not.toBe(idOnglet(autre))
  })

  it('fermer l’onglet actif active son voisin de droite', () => {
    const etat = { ...avec(orders, items), actif: idOnglet(orders) }
    expect(fermer(etat, idOnglet(orders)).actif).toBe(idOnglet(items))
  })

  it('fermer le dernier onglet de la bande active celui de gauche', () => {
    expect(fermer(avec(orders, items), idOnglet(items)).actif).toBe(idOnglet(orders))
  })

  it('fermer un onglet inactif ne change pas l’onglet actif', () => {
    const etat = { ...avec(orders, items), actif: idOnglet(items) }
    expect(fermer(etat, idOnglet(orders)).actif).toBe(idOnglet(items))
  })

  it('fermer le seul onglet laisse la bande sans actif, pas un écran fermé', () => {
    const etat = fermer(avec(orders), idOnglet(orders))
    expect(etat.onglets).toHaveLength(0)
    expect(etat.actif).toBeNull()
    expect(ongletActif(etat)).toBeNull()
  })

  it('réordonne, et refuse un ordre qui perdrait un onglet', () => {
    const etat = avec(orders, items)
    const inverse = reordonner(etat, [idOnglet(items), idOnglet(orders)])
    expect(inverse.onglets.map(libelle)).toEqual(['order_items', 'orders'])

    const ampute = reordonner(etat, [idOnglet(items)])
    expect(ampute.onglets.map(libelle)).toEqual(['orders', 'order_items'])
  })
})

describe('les consoles (`12a`)', () => {
  it('deux consoles sur la même base coexistent', () => {
    const etat = ouvrirConsole(ouvrirConsole(AUCUN_ONGLET, analytics), analytics)
    // **Contrairement à deux onglets sur la même table**, qui n'en font qu'un : on ouvre une seconde
    // console parce qu'on veut garder la première.
    expect(etat.onglets).toHaveLength(2)
    expect(etat.onglets.map(libelle)).toEqual(['console 1', 'console 2'])
  })

  it('le numéro libéré par une fermeture est réutilisé', () => {
    let etat = ouvrirConsole(
      ouvrirConsole(ouvrirConsole(AUCUN_ONGLET, analytics), analytics),
      analytics,
    )
    etat = fermer(etat, idOnglet({ sorte: 'console', key: analytics, numero: 2, dialecte: 'sql' }))
    etat = ouvrirConsole(etat, analytics)
    // Un compteur qui monte afficherait « console 4 » à côté de « console 1 » et « console 3 » : le
    // numéro est une étiquette, pas un historique.
    expect(etat.onglets.map(libelle)).toEqual(['console 1', 'console 3', 'console 2'])
  })

  it('les numéros sont comptés par base, pas globalement', () => {
    const etat = ouvrirConsole(ouvrirConsole(AUCUN_ONGLET, analytics), shop)
    // Deux bases, deux « console 1 » : le numéro situe la console dans **sa** base, et deux bases
    // ouvertes côte à côte n'ont pas à se partager une numérotation.
    expect(etat.onglets.map(libelle)).toEqual(['console 1', 'console 1'])
    expect(new Set(etat.onglets.map(idOnglet)).size).toBe(2)
  })

  it('une console et une table cohabitent, et se ferment pareil', () => {
    let etat = ouvrir(AUCUN_ONGLET, orders)
    etat = ouvrirConsole(etat, analytics)
    expect(etat.onglets.map(libelle)).toEqual(['orders', 'console 1'])

    etat = fermer(etat, etat.actif as string)
    // Le voisin reprend la main, exactement comme entre deux tables.
    expect(etat.onglets.map(libelle)).toEqual(['orders'])
    expect(etat.actif).toBe(idOnglet(orders))
  })

  it('l’identité d’une console ne se confond pas avec celle d’une table', () => {
    const console = ouvrirConsole(AUCUN_ONGLET, analytics)
    const id = idOnglet(console.onglets[0] as Onglet)
    // Le séparateur `::` et le segment `console/` : une table nommée `console` dans un schéma nommé
    // `1` produirait `…::1.console`, jamais `…::console/1`.
    expect(id).toBe('Atelier Nord/analytics/prod::console/1')
  })

  it('retirer une base emporte ses consoles comme ses tables (`08j`)', () => {
    const etat = ouvrirConsole(ouvrir(AUCUN_ONGLET, orders), analytics)
    const cible = {
      kind: 'database' as const,
      project: 'Atelier Nord',
      database: 'analytics',
      environment: 'prod',
    }
    // Une console laissée ouverte sur une base dont la déclaration est partie n'aurait plus de
    // connexion pour exécuter quoi que ce soit.
    expect(etat.onglets.map(idOnglet).every((id) => viseeParLId(cible, id))).toBe(true)
  })
})

describe('la cible d’un retrait (`08j`)', () => {
  const idDe = (projet: string, base: string) => `${projet}/${base}/prod::public.orders`

  it('vise les onglets de la base nommée, et pas ceux d’une voisine', () => {
    const cible = {
      kind: 'database' as const,
      project: 'Halle',
      database: 'analytics',
      environment: 'prod',
    }
    expect(viseeParLId(cible, idDe('Halle', 'analytics'))).toBe(true)
    expect(viseeParLId(cible, idDe('Halle', 'shop'))).toBe(false)
  })

  /*
   * **Le défaut que le palier d'environnement rend franc** (`25a`).
   *
   * `idOnglet` compose `projet/base/env`, et `viseeParLId` ne lisait pas le troisième segment :
   * retirer `analytics` en production fermait aussi les onglets d'`analytics` en dev, et faussait le
   * compte de modifications que la confirmation de `08j` promet exact. Le défaut ne se voyait pas
   * tant que l'arbre ne montrait qu'un environnement à la fois.
   */
  it('ne vise pas une connexion homonyme d’un autre environnement', () => {
    const cible = {
      kind: 'database' as const,
      project: 'Halle',
      database: 'analytics',
      environment: 'prod',
    }
    expect(viseeParLId(cible, 'Halle/analytics/prod::public.orders')).toBe(true)
    // Même projet, même nom de base, autre environnement : ce sont deux connexions (`23b`).
    expect(viseeParLId(cible, 'Halle/analytics/dev::public.orders')).toBe(false)
  })

  // Retirer un **projet** emporte tout, quel que soit l'environnement : c'est la déclaration entière
  // qui part.
  it('un retrait de projet emporte tous les environnements', () => {
    const projet = { kind: 'project' as const, project: 'Halle' }
    expect(viseeParLId(projet, 'Halle/analytics/dev::public.orders')).toBe(true)
    expect(viseeParLId(projet, 'Halle/analytics/prod::public.orders')).toBe(true)
  })

  it('ne confond pas deux noms dont l’un est le préfixe de l’autre', () => {
    // **Un test de préfixe de chaîne emporterait les onglets du voisin.** `Halle` est un préfixe de
    // `Halles`, et `analytics` de `analytics_old` : deux projets ou deux bases distincts dont
    // l'un ferait disparaître les onglets de l'autre. La comparaison porte sur les coordonnées
    // découpées, jamais sur le début de la chaîne.
    const projet = { kind: 'project' as const, project: 'Halle' }
    expect(viseeParLId(projet, idDe('Halles', 'analytics'))).toBe(false)

    const base = { kind: 'database' as const, project: 'Halle', database: 'analytics' }
    expect(viseeParLId(base, idDe('Halle', 'analytics_old'))).toBe(false)
  })

  it('un projet vise toutes ses bases', () => {
    const cible = { kind: 'project' as const, project: 'Halle' }
    expect(viseeParLId(cible, idDe('Halle', 'analytics'))).toBe(true)
    expect(viseeParLId(cible, idDe('Halle', 'shop'))).toBe(true)
    expect(viseeParLId(cible, idDe('Outils', 'analytics'))).toBe(false)
  })
})

describe('le dialecte d’une console (`13a`)', () => {
  it('vaut « sql » par défaut, et « mongo » quand on le demande', () => {
    const sql = ouvrirConsole(AUCUN_ONGLET, analytics).onglets[0] as OngletConsole
    expect(sql.dialecte).toBe('sql')
    const mongo = ouvrirConsole(AUCUN_ONGLET, analytics, 'mongo').onglets[0] as OngletConsole
    expect(mongo.dialecte).toBe('mongo')
  })

  it('ne fait pas partie de l’identité : deux dialectes ne dédoublent pas la numérotation', () => {
    // **Le dialecte n'est pas une coordonnée.** Une console mongo et une console SQL sur la même
    // base sont deux consoles, comme deux consoles SQL le sont — et elles se numérotent dans la
    // même suite, sans quoi la bande afficherait deux « console 1 ».
    const etat = ouvrirConsole(ouvrirConsole(AUCUN_ONGLET, analytics, 'mongo'), analytics)
    expect(etat.onglets.map(libelle)).toEqual(['console 1', 'console 2'])
  })
})

describe('le renommage d’une connexion (`26`)', () => {
  it('fait suivre les onglets ouverts, et l’onglet actif avec eux', () => {
    const etat = ouvrir(ouvrir(AUCUN_ONGLET, orders), { ...items, key: shop })
    const renomme = renommerLaConnexion(etat, analytics, 'entrepot')

    // La connexion visée bouge… et sa voisine reste où elle est.
    expect(
      renomme.onglets.map((onglet) => (onglet.sorte === 'instance' ? null : onglet.key.database)),
    ).toEqual(['entrepot', 'shop'])
    // L'onglet actif était celui de `shop`, ouvert en second : il ne change pas d'identité.
    expect(renomme.actif).toBe(idOnglet({ ...items, key: shop }))

    // Et quand c'est l'onglet renommé qui est actif, `actif` suit — sans quoi la bande
    // désignerait un onglet disparu et le centre reviendrait à `A4`.
    const surOrders = { ...etat, actif: idOnglet(orders) }
    expect(renommerLaConnexion(surOrders, analytics, 'entrepot').actif).toBe(
      idOnglet({ ...orders, key: { ...analytics, database: 'entrepot' } }),
    )
  })

  it('n’ouvre ni ne ferme rien : les onglets survivent au renommage', () => {
    // C'est la différence avec le retrait de `08j`, qui les ferme : la déclaration existe encore.
    const etat = ouvrir(ouvrir(AUCUN_ONGLET, orders), items)
    const renomme = renommerLaConnexion(etat, analytics, 'entrepot')
    expect(renomme.onglets).toHaveLength(2)
    expect(renomme.onglets.map((onglet) => (onglet.sorte === 'table' ? onglet.table : ''))).toEqual(
      ['orders', 'order_items'],
    )
  })

  it('le même nom ne touche à rien', () => {
    const etat = ouvrir(AUCUN_ONGLET, orders)
    expect(renommerLaConnexion(etat, analytics, 'analytics')).toBe(etat)
  })

  it('ne renomme pas une table homonyme de sa base', () => {
    // **Le piège d'un `replace` de sous-chaîne.** Sur `Atelier Nord/orders/prod::public.orders`, un
    // remplacement textuel de « orders » toucherait aussi la table — l'onglet pointerait alors une
    // table qui n'existe pas. Le découpage par coordonnées est ce qui l'évite.
    const cle: DatabaseKey = { project: 'Atelier Nord', database: 'orders', environment: 'prod' }
    const id = 'Atelier Nord/orders/prod::public.orders'
    expect(idApresRenommage(id, cle, 'commandes')).toBe(
      'Atelier Nord/commandes/prod::public.orders',
    )
  })

  it('laisse intact un identifiant qui ne vise pas cette connexion', () => {
    const id = idOnglet({ ...items, key: shop })
    expect(idApresRenommage(id, analytics, 'entrepot')).toBe(id)
  })

  it('distingue deux homonymes de deux environnements', () => {
    // `analytics` en dev et `analytics` en prod sont deux connexions (`23b`) : renommer l'une ne
    // doit pas déplacer les onglets de l'autre.
    const dev: DatabaseKey = { ...analytics, environment: 'dev' }
    const etat = ouvrir(ouvrir(AUCUN_ONGLET, orders), { ...orders, key: dev })
    const renomme = renommerLaConnexion(etat, dev, 'entrepot')

    expect(
      renomme.onglets.map((onglet) => (onglet.sorte === 'instance' ? null : onglet.key)),
    ).toEqual([analytics, { ...dev, database: 'entrepot' }])
  })

  it('réindexe les tables indexées par identifiant d’onglet', () => {
    // Le texte d'une console et ses modifications en attente vivent dans des tables indexées par
    // cet identifiant : sans réindexation, l'onglet renommé ne trouve plus rien à sa clé, et
    // l'éditeur se rouvre vide.
    const table = {
      [idOnglet(orders)]: 'select 1',
      [idOnglet({ ...items, key: shop })]: 'select 2',
    }
    const reindexe = reindexerParConnexion(table, analytics, 'entrepot')

    expect(reindexe[idOnglet({ ...orders, key: { ...analytics, database: 'entrepot' } })]).toBe(
      'select 1',
    )
    expect(reindexe[idOnglet({ ...items, key: shop })]).toBe('select 2')
    expect(Object.keys(reindexe)).toHaveLength(2)
  })
})
