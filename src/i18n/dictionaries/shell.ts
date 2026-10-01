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
    edition: 'Édition',
    readOnly: 'Lecture seule',
    pendingChanges: (p) => ` ${p.count} modification${Number(p.count) > 1 ? 's' : ''} en attente`,
    status: {
      never: 'jamais connectée',
      connecting: 'connexion en cours',
      connected: (p) => `connectée · ${p.version}`,
      offline: (p) => `hors ligne · ${p.reason}`,
    },
  },
  // La raison d'une lecture seule effective (#168), dite partout où elle refuse ou fige : le bouton
  // du mode édition, le gestionnaire de schémas, le refus de la console. Elle nomme **où la lever**.
  lectureSeule: {
    imposee: (p) =>
      `Lecture seule, imposée par le dossier « ${p.dossier} » : levez-la sur ce dossier pour écrire.`,
    locale:
      'Lecture seule, réglée sur cette connexion : décochez « Lecture seule » dans ses réglages pour écrire.',
    // MongoDB et BigQuery n'ont pas de session à mettre en lecture seule : c'est DoraBase seul qui
    // refuse, et le dire évite de croire le serveur aussi protégé qu'un PostgreSQL.
    sansSession:
      'Ce moteur n’a pas de session en lecture seule : c’est DoraBase qui refuse d’écrire, pas le serveur.',
  },
  statusBar: {
    folderCount: (p) => `${p.count} dossier${Number(p.count) > 1 ? 's' : ''}`,
    paletteHint: (p) => `${p.raccourci} palette`,
    version: (p) => `DoraBase ${p.version}`,
  },
  titleBar: {
    preferences: 'Préférences',
    // Les trois boutons de fenêtre, Windows seulement (31 août 2026). `decorations: false` retire
    // ceux du système : ceux-ci les remplacent, donc ils ont besoin d'un nom accessible — l'icône
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
    edition: 'Editing',
    readOnly: 'Read only',
    pendingChanges: (p) => ` ${p.count} pending change${Number(p.count) > 1 ? 's' : ''}`,
    status: {
      never: 'never connected',
      connecting: 'connecting',
      connected: (p) => `connected · ${p.version}`,
      offline: (p) => `offline · ${p.reason}`,
    },
  },
  lectureSeule: {
    imposee: (p) =>
      `Read-only, imposed by the “${p.dossier}” folder: lift it on that folder to write.`,
    locale: 'Read-only, set on this connection: untick “Read-only” in its settings to write.',
    sansSession: 'This engine has no read-only session: DoraBase refuses to write, not the server.',
  },
  statusBar: {
    folderCount: (p) => `${p.count} folder${Number(p.count) > 1 ? 's' : ''}`,
    paletteHint: (p) => `${p.raccourci} palette`,
    version: (p) => `DoraBase ${p.version}`,
  },
  titleBar: {
    preferences: 'Preferences',
    reduire: 'Minimise',
    agrandir: 'Maximise',
    restaurer: 'Restore',
    fermer: 'Close',
  },
}
