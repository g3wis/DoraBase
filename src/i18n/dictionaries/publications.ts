import type { Dictionnaire } from '../types'

// L'onglet des publications d'une base PostgreSQL (#195). Voir dictionaries/index.ts pour
// l'assemblage.
export const publicationsFr: Dictionnaire = {
  table: 'Publications de la base de données',
  count: (p) => `${p.count} publication${Number(p.count) > 1 ? 's' : ''}`,
  columns: {
    name: 'publication',
    owner: 'propriétaire',
    tables: 'tables',
    operations: 'opérations publiées',
    viaRoot: 'via la racine de partition',
  },
  scope: {
    // `FOR ALL TABLES` couvre aussi les tables à venir ; l'autre forme désigne ses tables (ou ses
    // schémas, depuis PostgreSQL 15) une à une — c'est ce qu'elle a de commun, et ce que la colonne
    // peut dire sans lire ce qu'elle publie.
    all: 'toutes les tables',
    listed: 'tables désignées',
  },
  // Une publication peut ne rien publier (`publish = ''`) : le dire plutôt qu'un tiret, qui se
  // lirait comme une valeur inconnue.
  noOperation: 'aucune',
  yes: 'oui',
  no: 'non',
  // Avant PostgreSQL 13, le réglage n'existe pas : ce n'est pas « non », c'est « le serveur ne le
  // connaît pas ».
  viaRootUnknown: 'ce serveur, antérieur à PostgreSQL 13, ne connaît pas ce réglage',
  toolbar: {
    refresh: 'Rafraîchir',
    measured: (p) => `relevé il y a ${p.age}`,
    neverMeasured: 'pas encore relevé',
  },
  state: {
    connecting: 'Connexion à la base de données…',
    never: 'La base de données n’est pas encore ouverte.',
    offline: (p) => `La base de données est injoignable : ${p.reason}`,
    open: 'Ouvrir la connexion',
    loading: 'Lecture des publications…',
    empty: 'Cette base de données ne déclare aucune publication.',
    failed: (p) => `Lecture impossible : ${p.reason}`,
  },
}

export const publicationsEn: Dictionnaire = {
  table: 'Publications of the database',
  count: (p) => `${p.count} publication${Number(p.count) > 1 ? 's' : ''}`,
  columns: {
    name: 'publication',
    owner: 'owner',
    tables: 'tables',
    operations: 'published operations',
    viaRoot: 'via partition root',
  },
  scope: {
    all: 'all tables',
    listed: 'listed tables',
  },
  noOperation: 'none',
  yes: 'yes',
  no: 'no',
  viaRootUnknown: 'this server, older than PostgreSQL 13, does not know this setting',
  toolbar: {
    refresh: 'Refresh',
    measured: (p) => `read ${p.age} ago`,
    neverMeasured: 'not read yet',
  },
  state: {
    connecting: 'Connecting to the database…',
    never: 'The database is not open yet.',
    offline: (p) => `The database is unreachable: ${p.reason}`,
    open: 'Open the connection',
    loading: 'Reading publications…',
    empty: 'This database declares no publication.',
    failed: (p) => `Could not read: ${p.reason}`,
  },
}
