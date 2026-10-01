import type { Dictionnaire } from '../types'

// Rempli par l'écran « welcome ». Voir dictionaries/index.ts pour l'assemblage.
export const welcomeFr: Dictionnaire = {
  hero: {
    title: 'Prêt à explorer\xa0?',
    subtitle:
      "Crée un dossier, branche ses bases, puis passe de dev à prod d'un seul clic. Pas d'IDE à lancer.",
    newFolder: 'Nouveau dossier',
  },
  sidebar: {
    header: 'Mes dossiers',
    emptyTitle: 'Aucun dossier',
    emptyText: 'Un dossier range des bases de données, et d’autres dossiers — dev, staging, prod.',
    newFolder: 'Nouveau dossier',
  },
}

export const welcomeEn: Dictionnaire = {
  hero: {
    title: 'Ready to explore?',
    subtitle:
      'Create a folder, connect its databases, then switch from dev to prod in one click. No IDE to launch.',
    newFolder: 'New folder',
  },
  sidebar: {
    header: 'My folders',
    emptyTitle: 'No folders',
    emptyText: 'A folder holds databases, and other folders — dev, staging, prod.',
    newFolder: 'New folder',
  },
}
