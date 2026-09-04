import type { Dictionnaire } from '../types'

/** `A10`, l'écran de préférences (`src/screens/Preferences/PreferencesDialog.tsx`). */
export const preferencesFr: Dictionnaire = {
  title: 'Préférences',
  tablistLabel: 'Sections des préférences',
  sections: {
    general: 'Général',
    apparence: 'Apparence',
    grille: 'Grille de données',
    connexions: 'Connexions',
    securite: 'Sécurité & écriture',
    maj: 'Mises à jour',
  },
  footer: {
    immediat: 'Les préférences s’appliquent immédiatement',
    reinitialiser: 'Réinitialiser',
    termine: 'Terminé',
  },
  general: {
    langueTitre: 'Langue',
    aVenir: 'Le comportement au démarrage, et l’ouverture automatique des connexions.',
  },
  langues: {
    fr: 'Français',
    en: 'English',
    systeme: 'Système',
    detailFr: 'l’interface en français',
    detailEn: 'l’interface en anglais',
    detailSysteme: 'suit la langue de macOS, anglais à défaut',
  },
  apparence: {
    themeTitre: 'Thème',
    accentTitre: 'Couleur d’accent',
    accentNote: 'sert aussi à teinter la connexion active',
  },
  themes: {
    cahier: { nom: 'Cahier', detail: 'le thème clair du handoff' },
    nuit: { nom: 'Nuit', detail: 'le thème sombre' },
    systeme: { nom: 'Système', detail: 'suit le réglage de macOS' },
  },
  accents: {
    terracotta: 'terracotta',
    framboise: 'framboise',
    brique: 'brique',
    sauge: 'sauge',
    ardoise: 'ardoise',
    violette: 'violette',
  },
  grille: {
    densiteTitre: 'Densité des lignes',
    compact: 'compact',
    aere: 'aéré',
    densiteAriaLabel: 'Densité des lignes',
    contrainte: (p) =>
      `La police du code occupe ${p.corps} px : en dessous de ${p.plancher}px, le texte des cellules serait rogné.`,
    policeTitre: 'Police du code',
    policeAriaLabel: 'Corps de la police du code',
    policeNote:
      'La famille reste JetBrains Mono, embarquée avec l’application. Le corps s’applique à la grille, à l’éditeur et aux blocs SQL.',
  },
  connexions: {
    aVenir:
      'Le délai d’attente, la reconnexion automatique, et le chemin du fichier de clés SSH par défaut.',
  },
  securite: {
    titre: 'Garde-fous',
    pendingBeforeWrite: {
      libelle: 'Modifications en attente avant écriture',
      detail: (p) =>
        `Toute édition passe par un diff à valider (${p.raccourci}). Éteint, une cellule modifiée part directement dans la base.`,
    },
    prodReadOnly: {
      libelle: 'Ouvrir les bases « prod » en lecture seule',
      detail: (p) =>
        `${p.raccourci} déverrouille l’édition pour la session en cours. Éteint, une base de production s’ouvre modifiable.`,
    },
    refuseUnrestrictedWrites: {
      libelle: 'Refuser DELETE/UPDATE sans clause WHERE',
      detail:
        'Dans la console comme dans la grille. Éteint, la confirmation subsiste — mais elle se clique, là où un refus oblige à écrire la clause.',
    },
    keepInversePatch: {
      libelle: 'Garder le patch inverse 24 h',
      detail:
        'Le patch inverse existe pendant la session et se copie depuis le panneau des modifications. Le conserver au-delà demande de décider où l’écrire et ce qu’il advient d’un patch dont la base a changé : ce n’est pas encore tranché.',
    },
  },
  maj: {
    titre: 'Mises à jour',
    rechercher: 'Rechercher une mise à jour',
    recherche: 'Recherche…',
    aJour: 'DoraBase est à jour.',
    echec: (p) =>
      `La recherche n’a pas abouti : ${p.raison}. Une machine hors ligne, un pare-feu, ou l’application lancée hors de son bundle donnent tous ce résultat.`,
    disponibleAvant: 'La version',
    disponibleApres: 'est disponible.',
    sansNotes: 'Cette version n’a pas de notes.',
    installationEchouee: 'l’installation n’a pas abouti',
    installer: 'Installer et redémarrer',
    installation: 'Téléchargement…',
    redemarrageNote:
      'DoraBase se relance seul. Les consoles non enregistrées ne sont pas conservées.',
    // Windows et Linux : il n'y a pas de voie de mise à jour en place. L'infobulle nomme ce qui
    // manque, la phrase dit quoi faire à la place — voir `shell/plateforme.aUneVoieDeMiseAJour`.
    sansVoieTitre: 'Cette version de DoraBase ne se met pas à jour d’elle-même.',
    sansVoie:
      'Les mises à jour en place ne sont proposées que sur macOS. Ailleurs, téléchargez la version suivante depuis la page des releases.',
  },
  aVenir: {
    corps: (p) => `Rien à régler ici pour l’instant. Cette section portera : ${p.porte}`,
  },
  reinitialisation: {
    titre: 'Réinitialiser les préférences',
    annuler: 'Annuler',
    confirmer: 'Remettre les valeurs d’origine',
    corpsAvant:
      'Le thème, l’accent, la densité et la police reviendront aux valeurs du produit, et',
    corpsGras: 'les quatre garde-fous d’écriture seront réactivés',
    note: 'Aucune connexion et aucune requête enregistrée n’est touchée.',
  },
}

export const preferencesEn: Dictionnaire = {
  title: 'Preferences',
  tablistLabel: 'Preferences sections',
  sections: {
    general: 'General',
    apparence: 'Appearance',
    grille: 'Data grid',
    connexions: 'Connections',
    securite: 'Security & writes',
    maj: 'Updates',
  },
  footer: {
    immediat: 'Preferences apply immediately',
    reinitialiser: 'Reset',
    termine: 'Done',
  },
  general: {
    langueTitre: 'Language',
    aVenir: 'Startup behavior, and automatically opening connections.',
  },
  langues: {
    fr: 'Français',
    en: 'English',
    systeme: 'System',
    detailFr: 'the interface in French',
    detailEn: 'the interface in English',
    detailSysteme: 'follows macOS’s language, English otherwise',
  },
  apparence: {
    themeTitre: 'Theme',
    accentTitre: 'Accent color',
    accentNote: 'also tints the active connection',
  },
  themes: {
    cahier: { nom: 'Notebook', detail: 'the handoff’s light theme' },
    nuit: { nom: 'Night', detail: 'the dark theme' },
    systeme: { nom: 'System', detail: 'follows macOS’s setting' },
  },
  accents: {
    terracotta: 'terracotta',
    framboise: 'raspberry',
    brique: 'brick',
    sauge: 'sage',
    ardoise: 'slate',
    violette: 'violet',
  },
  grille: {
    densiteTitre: 'Row density',
    compact: 'compact',
    aere: 'airy',
    densiteAriaLabel: 'Row density',
    contrainte: (p) =>
      `The code font is ${p.corps} px: below ${p.plancher}px, cell text would be clipped.`,
    policeTitre: 'Code font',
    policeAriaLabel: 'Code font size',
    policeNote:
      'The family stays JetBrains Mono, bundled with the application. The size applies to the grid, the editor, and SQL blocks.',
  },
  connexions: {
    aVenir: 'The timeout, automatic reconnection, and the default SSH key file path.',
  },
  securite: {
    titre: 'Guardrails',
    pendingBeforeWrite: {
      libelle: 'Pending changes before writing',
      detail: (p) =>
        `Every edit goes through a diff to confirm (${p.raccourci}). Off, an edited cell writes straight to the database.`,
    },
    prodReadOnly: {
      libelle: 'Open “prod” databases read-only',
      detail: (p) =>
        `${p.raccourci} unlocks editing for the current session. Off, a production database opens editable.`,
    },
    refuseUnrestrictedWrites: {
      libelle: 'Refuse DELETE/UPDATE without a WHERE clause',
      detail:
        'In the console as in the grid. Off, the confirmation stays — but it’s a click, where a refusal forces the clause to be written.',
    },
    keepInversePatch: {
      libelle: 'Keep the inverse patch for 24 h',
      detail:
        'The inverse patch exists for the session and can be copied from the changes panel. Keeping it longer requires deciding where to write it and what happens to a patch whose database has since changed: not yet settled.',
    },
  },
  maj: {
    titre: 'Updates',
    rechercher: 'Check for an update',
    recherche: 'Checking…',
    aJour: 'DoraBase is up to date.',
    echec: (p) =>
      `The check didn’t succeed: ${p.raison}. An offline machine, a firewall, or the application launched outside its bundle all give this result.`,
    disponibleAvant: 'Version',
    disponibleApres: 'is available.',
    sansNotes: 'This version has no release notes.',
    installationEchouee: 'the installation didn’t complete',
    installer: 'Install and restart',
    installation: 'Downloading…',
    redemarrageNote: 'DoraBase restarts on its own. Unsaved consoles are not kept.',
    sansVoieTitre: 'This build of DoraBase does not update itself.',
    sansVoie:
      'In-place updates are only offered on macOS. Elsewhere, download the next version from the releases page.',
  },
  aVenir: {
    corps: (p) => `Nothing to set here yet. This section will cover: ${p.porte}`,
  },
  reinitialisation: {
    titre: 'Reset preferences',
    annuler: 'Cancel',
    confirmer: 'Restore the original values',
    corpsAvant: 'The theme, accent, density, and font will return to the product’s values, and',
    corpsGras: 'the four write guardrails will be turned back on',
    note: 'No connection and no saved query is touched.',
  },
}
