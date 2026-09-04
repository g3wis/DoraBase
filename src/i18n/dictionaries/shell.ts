import type { Dictionnaire } from '../types'

// Rempli par l'écran « shell ». Voir dictionaries/index.ts pour l'assemblage.
export const shellFr: Dictionnaire = {
  annonceMaj: {
    ariaLabel: 'Mise à jour disponible',
    avant: 'La version',
    apres: 'est disponible',
    installer: 'Installer',
    ecarter: 'Écarter la notification',
  },
  selectionIndicator: {
    prod: 'PROD',
    edition: 'Édition',
    readOnly: 'Lecture seule',
    productionAnnouncement: ' environnement de production',
    pendingChanges: (p) => ` ${p.count} modification${Number(p.count) > 1 ? 's' : ''} en attente`,
    status: {
      never: 'jamais connectée',
      connecting: 'connexion en cours',
      connected: (p) => `connectée · ${p.version}`,
      offline: (p) => `hors ligne · ${p.reason}`,
    },
  },
  statusBar: {
    projectCount: (p) => `${p.count} projet${Number(p.count) > 1 ? 's' : ''}`,
    paletteHint: (p) => `${p.raccourci} palette`,
    version: (p) => `DoraBase ${p.version}`,
  },
  titleBar: {
    preferences: 'Préférences',
    preferencesDisabledTitle: 'Les préférences ne sont pas montées sur cet exemplaire de la barre.',
    // Les trois boutons de fenêtre, hors macOS (31 août 2026). `decorations: false` retire ceux
    // du système : ceux-ci les remplacent, donc ils ont besoin d'un nom accessible — l'icône
    // seule ne dit rien à la voix.
    reduire: 'Réduire',
    agrandir: 'Agrandir',
    restaurer: 'Restaurer',
    fermer: 'Fermer',
  },
}
export const shellEn: Dictionnaire = {
  annonceMaj: {
    ariaLabel: 'Update available',
    avant: 'Version',
    apres: 'is available',
    installer: 'Install',
    ecarter: 'Dismiss notification',
  },
  selectionIndicator: {
    prod: 'PROD',
    edition: 'Editing',
    readOnly: 'Read only',
    productionAnnouncement: ' production environment',
    pendingChanges: (p) => ` ${p.count} pending change${Number(p.count) > 1 ? 's' : ''}`,
    status: {
      never: 'never connected',
      connecting: 'connecting',
      connected: (p) => `connected · ${p.version}`,
      offline: (p) => `offline · ${p.reason}`,
    },
  },
  statusBar: {
    projectCount: (p) => `${p.count} project${Number(p.count) > 1 ? 's' : ''}`,
    paletteHint: (p) => `${p.raccourci} palette`,
    version: (p) => `DoraBase ${p.version}`,
  },
  titleBar: {
    preferences: 'Preferences',
    preferencesDisabledTitle: 'Preferences are not mounted on this instance of the bar.',
    reduire: 'Minimise',
    agrandir: 'Maximise',
    restaurer: 'Restore',
    fermer: 'Close',
  },
}
