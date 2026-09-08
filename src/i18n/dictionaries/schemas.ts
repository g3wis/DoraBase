import type { Dictionnaire } from '../types'

// Rempli par l'écran « schemas » — le gestionnaire de schémas (`API-33`). Voir
// dictionaries/index.ts pour l'assemblage.
export const schemasFr: Dictionnaire = {
  title: 'Gérer les schémas',
  filterPlaceholder: 'Filtrer les schémas…',
  table: 'Schémas de la connexion',
  systemTable: 'Schémas système',
  columns: {
    name: 'schéma',
    objects: 'objets',
    owner: 'propriétaire',
    shown: 'affiché',
  },
  // Le détail des quatre compteurs, en infobulle du nombre total.
  objectsBreakdown: (p) =>
    `${p.tables} tables · ${p.views} vues · ${p.functions} fonctions · ${p.indexes} index`,
  noOwner: 'le moteur ne dit pas de propriétaire pour ce schéma',
  show: (p) => `Afficher ${p.schema} dans l’arbre`,
  system: (p) => `Schémas système (${p.count})`,
  loading: 'Lecture des schémas…',
  empty: 'Cette connexion ne déclare aucun schéma.',
  noMatch: 'Aucun schéma ne correspond au filtre.',
  create: {
    label: 'Créer un schéma',
    placeholder: 'nom_du_schema',
    button: 'Créer',
    // Sur un environnement marqué production seulement : l'exécution est immédiate et sans retour.
    warning: 'La commande part immédiatement sur la base ; DoraBase ne peut pas la défaire.',
    done: (p) => `Le schéma « ${p.name} » est créé, et coché.`,
  },
  footer: {
    // « n des m schémas de <base> sont affichés dans l'arbre », dans les deux nombres au singulier.
    count: (p) =>
      `${p.shown} des ${p.total} ${Number(p.total) > 1 ? 'schémas' : 'schéma'} de ${p.database} ${
        Number(p.shown) > 1 ? 'sont affichés' : 'est affiché'
      } dans l’arbre`,
    cancel: 'Annuler',
    save: 'Enregistrer',
  },
}

export const schemasEn: Dictionnaire = {
  title: 'Manage schemas',
  filterPlaceholder: 'Filter schemas…',
  table: 'Schemas of this connection',
  systemTable: 'System schemas',
  columns: {
    name: 'schema',
    objects: 'objects',
    owner: 'owner',
    shown: 'shown',
  },
  objectsBreakdown: (p) =>
    `${p.tables} tables · ${p.views} views · ${p.functions} functions · ${p.indexes} indexes`,
  noOwner: 'the engine reports no owner for this schema',
  show: (p) => `Show ${p.schema} in the tree`,
  system: (p) => `System schemas (${p.count})`,
  loading: 'Reading schemas…',
  empty: 'This connection declares no schema.',
  noMatch: 'No schema matches the filter.',
  create: {
    label: 'Create a schema',
    placeholder: 'schema_name',
    button: 'Create',
    warning: 'The statement runs on the database right away; DoraBase cannot undo it.',
    done: (p) => `Schema “${p.name}” created, and ticked.`,
  },
  footer: {
    count: (p) =>
      `${p.shown} of ${p.total} ${Number(p.total) > 1 ? 'schemas' : 'schema'} in ${p.database} ${
        Number(p.shown) > 1 ? 'are' : 'is'
      } shown in the tree`,
    cancel: 'Cancel',
    save: 'Save',
  },
}
