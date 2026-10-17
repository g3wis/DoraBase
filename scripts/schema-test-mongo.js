// Décor de test pour le moteur MongoDB (specs 18a → 18g).
//
// Composition **délibérée**, comme `schema-test-pg.sql` : chaque cas que les tests vérifient est
// présent une fois, et les comptages sont connus — ce qui permet d'affirmer des valeurs exactes
// plutôt que des « au moins un ». Modifier ce fichier casse des tests par conception.
//
// **Noms inventés.** Aucun nom de collection, de champ ou de base ne vient d'une base réelle : la
// règle est dans `AGENTS.md`, et le défaut n° 51 dit pourquoi. Ce qui compte pour les mesures est
// la longueur, la quantité et le type — pas le nom.
//
//   2 bases           `atelier_ventes` et `atelier_journal` : le niveau « schéma » de `18a` porte
//                     les bases MongoDB, donc il en faut plus d'une pour que le test morde
//   5 collections     dans `atelier_ventes`, dont une **vide** et une volumineuse
//   1 vue             sur `commandes`, pour la distinguer d'une collection (`18c`)
//   4 index           dont un unique et un composé
//   9 types BSON      ObjectId, Date, Decimal128, BinData, document, tableau, null, int, string
//   1 champ absent    `remise` n'est dans que 3 documents sur 5 : la fréquence de `18d` a de quoi
//                     rendre autre chose que 100 %
//   1 champ hétérogène `montant` en int dans les anciens documents, en Decimal128 dans les récents
//
// Idempotent : les `drop` permettent de le rejouer.
//
// Local :
//   docker exec -i dorabase-test-mongo mongosh --quiet < scripts/schema-test-mongo.js
// CI : voir le job `rust` de .github/workflows/ci.yml

db.getSiblingDB('atelier_ventes').dropDatabase()
db.getSiblingDB('atelier_journal').dropDatabase()

const ventes = db.getSiblingDB('atelier_ventes')

// --- `commandes` : la collection qui porte tous les cas ------------------------------------

ventes.createCollection('commandes')

// **Un champ hétérogène et un champ absent, dans la même collection.** Sans eux, `18d` rendrait
// 100 % partout et un type unique par champ : le décor mesurerait le décor.
ventes.commandes.insertMany([
  {
    reference: 'CMD-0001',
    statut: 'en_attente',
    // `montant` en entier : les « anciens » documents, avant une migration imaginaire.
    montant: 12900,
    devise: 'EUR',
    cree_le: new Date('2026-03-04T09:12:00Z'),
    // Un document imbriqué et un tableau : `18a` les rend en `Value::Json`.
    livraison: { pays: 'FR', ville: 'Toulouse', code: '31000' },
    lignes: [
      { article: 'ART-77', quantite: 2 },
      { article: 'ART-19', quantite: 1 },
    ],
    remise: 500,
    // `BinData`, que `18a` rend en `Value::Binary`.
    empreinte: BinData(0, 'AQIDBAUGBwg='),
  },
  {
    reference: 'CMD-0002',
    statut: 'payee',
    montant: 4550,
    devise: 'EUR',
    cree_le: new Date('2026-03-05T14:02:00Z'),
    livraison: { pays: 'BE', ville: 'Gand', code: '9000' },
    lignes: [{ article: 'ART-04', quantite: 5 }],
    remise: 0,
    empreinte: BinData(0, 'CAcGBQQDAgE='),
  },
  {
    reference: 'CMD-0003',
    statut: 'payee',
    // `Decimal128` : les documents « récents ». C'est le type majoritaire de `montant` ? Non —
    // deux entiers contre trois décimaux, donc le majoritaire est le décimal, et le nom natif
    // doit dire les deux (`18d`).
    montant: NumberDecimal('88.40'),
    devise: 'EUR',
    cree_le: new Date('2026-03-07T08:44:00Z'),
    livraison: { pays: 'FR', ville: 'Lille', code: '59000' },
    lignes: [],
    // `remise` **absente** : c'est ce qui fait descendre sa fréquence sous 100 %.
    empreinte: BinData(0, 'AAECAwQFBgc='),
  },
  {
    reference: 'CMD-0004',
    statut: 'expediee',
    montant: NumberDecimal('1204.05'),
    devise: 'CHF',
    cree_le: new Date('2026-03-09T17:20:00Z'),
    livraison: { pays: 'CH', ville: 'Vevey', code: '1800' },
    lignes: [
      { article: 'ART-31', quantite: 1 },
      { article: 'ART-31', quantite: 3 },
    ],
    // **`remise` explicitement nulle**, là où `CMD-0003` ne l'a pas du tout. La grille de `18e`
    // affiche la même cellule vide pour les deux, et `18f` doit filtrer sur les deux cas — c'est
    // le défaut le plus probable de cette spec, donc le décor porte les deux.
    remise: null,
    empreinte: BinData(0, 'BwYFBAMCAQA='),
  },
  {
    reference: 'CMD-0005',
    statut: 'annulee',
    montant: NumberDecimal('0.01'),
    devise: 'EUR',
    cree_le: new Date('2026-03-11T11:05:00Z'),
    livraison: { pays: 'FR', ville: 'Brest', code: '29200' },
    lignes: [{ article: 'ART-52', quantite: 1 }],
    remise: 1250,
    empreinte: BinData(0, 'AwIBAAcGBQQ='),
  },
])

// Un index unique et un index composé : `18c` doit les distinguer, et `14a` affiche « unique ».
ventes.commandes.createIndex({ reference: 1 }, { unique: true, name: 'commandes_reference_uniq' })
ventes.commandes.createIndex({ statut: 1, cree_le: -1 }, { name: 'commandes_statut_date_idx' })

// --- `clients` : une collection ordinaire, pour que l'arbre en ait plus d'une ---------------

ventes.clients.insertMany([
  { courriel: 'a@exemple.test', nom: 'A', inscrit_le: new Date('2025-11-02T10:00:00Z') },
  { courriel: 'b@exemple.test', nom: 'B', inscrit_le: new Date('2025-12-19T10:00:00Z') },
  { courriel: 'c@exemple.test', nom: 'C', inscrit_le: new Date('2026-01-08T10:00:00Z') },
])
ventes.clients.createIndex({ courriel: 1 }, { unique: true, name: 'clients_courriel_uniq' })

// --- `paniers_abandonnes` : **vide**, et elle doit apparaître quand même ---------------------
//
// `18c` l'exige : une collection vide se voit, elle ne disparaît pas. Une collection absente se
// lit comme une donnée non chargée — le doute que le défaut de `06d` a produit.
ventes.createCollection('paniers_abandonnes')

// --- `mouvements` : volumineuse, pour mesurer le coût d'une page lointaine (`18e`) ----------
//
// 20 000 documents : assez pour que `skip` se voie, assez peu pour que le décor se charge vite.
const lot = []
for (let i = 1; i <= 20000; i++) {
  lot.push({ rang: i, canal: i % 4 === 0 ? 'boutique' : 'ligne', valeur: `v${i}` })
}
ventes.mouvements.insertMany(lot)
ventes.mouvements.createIndex({ rang: 1 }, { name: 'mouvements_rang_idx' })

// --- Une vue, que `18c` doit distinguer d'une collection -------------------------------------

ventes.createCollection('commandes_payees', {
  viewOn: 'commandes',
  pipeline: [{ $match: { statut: 'payee' } }],
})

// --- Une seconde base : le niveau « schéma » de `18a` en porte plusieurs ---------------------

const journal = db.getSiblingDB('atelier_journal')
journal.evenements.insertMany([
  { sorte: 'connexion', horodatage: new Date('2026-03-04T09:00:00Z') },
  { sorte: 'export', horodatage: new Date('2026-03-06T16:30:00Z') },
])

print('décor mongo prêt')
print(`  atelier_ventes  : ${ventes.getCollectionNames().sort().join(', ')}`)
print(`  atelier_journal : ${journal.getCollectionNames().sort().join(', ')}`)
