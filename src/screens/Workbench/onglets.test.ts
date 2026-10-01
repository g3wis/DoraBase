import { describe, expect, it } from 'vitest'
import type { DatabaseKey } from '../../domain/arbre'
import {
  AUCUN_ONGLET,
  type EtatOnglets,
  fermer,
  idOnglet,
  type Onglet,
  type OngletConsole,
  ongletActif,
  ouvrir,
  ouvrirConsole,
  reordonner,
  viseeParLId,
} from './onglets'

const analytics: DatabaseKey = { connection: 'c0000000000000a1' }
const shop: DatabaseKey = { connection: 'c0000000000000a2' }

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
    expect(id).toBe('c0000000000000a1::console/1')
  })

  it('retirer une base emporte ses consoles comme ses tables (`08j`)', () => {
    const etat = ouvrirConsole(ouvrir(AUCUN_ONGLET, orders), analytics)
    const cible = { connexions: new Set([analytics.connection]) }
    // Une console laissée ouverte sur une base dont la déclaration est partie n'aurait plus de
    // connexion pour exécuter quoi que ce soit.
    expect(etat.onglets.map(idOnglet).every((id) => viseeParLId(cible, id))).toBe(true)
  })
})

describe('la cible d’un retrait (`08j`)', () => {
  const idDe = (connection: string) => `${connection}::public.orders`

  it('vise les onglets des connexions retirées, et pas ceux d’une voisine', () => {
    const cible = { connexions: new Set(['c0000000000000a1']) }
    expect(viseeParLId(cible, idDe('c0000000000000a1'))).toBe(true)
    expect(viseeParLId(cible, idDe('c0000000000000a2'))).toBe(false)
  })

  /*
   * **Un retrait de dossier emporte toutes ses connexions descendantes** (#166) : c'est l'ensemble
   * qui les nomme, calculé sur l'arbre d'avant le retrait.
   */
  it('un retrait de dossier vise toutes ses connexions, et elles seules', () => {
    const cible = { connexions: new Set(['c0000000000000a1', 'c0000000000000a2']) }
    expect(viseeParLId(cible, idDe('c0000000000000a1'))).toBe(true)
    expect(viseeParLId(cible, `c0000000000000a2::console/1`)).toBe(true)
    expect(viseeParLId(cible, idDe('c0000000000000a3'))).toBe(false)
  })

  it('ne confond pas deux identifiants dont l’un est le préfixe de l’autre', () => {
    // **Le défaut « Halle » / « Halles » est parti avec les noms**, et ce test garde qu'il ne revienne
    // pas par un test de préfixe : l'identifiant est comparé en entier.
    const cible = { connexions: new Set(['c00000000000aa']) }
    expect(viseeParLId(cible, idDe('c00000000000aa1'))).toBe(false)
  })

  it('un onglet d’instance n’est visé par aucun retrait', () => {
    expect(viseeParLId({ connexions: new Set(['instance']) }, 'instance/pg-prod')).toBe(false)
  })
})

/*
 * **Le renommage d'une connexion ne touche plus aux onglets** (#166) : leur identité porte
 * l'identifiant de la connexion, jamais son nom. `renommerLaConnexion`, `idApresRenommage` et
 * `reindexerParConnexion` sont partis — et ce que leurs tests gardaient est désormais structurel.
 */
describe('l’identité d’un onglet', () => {
  it('ne porte que l’identifiant de la connexion, jamais un nom', () => {
    expect(idOnglet(orders)).toBe('c0000000000000a1::public.orders')
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
