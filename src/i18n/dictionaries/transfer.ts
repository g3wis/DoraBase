import type { Dictionnaire } from '../types'

// Rempli par les deux modales de transfert (`API-30`, portées sur les dossiers par #169). Voir
// dictionaries/index.ts.
//
// **« Dossiers » et non « collections »** : la demande d'origine comparait le fichier à une
// collection Postman, et c'est la bonne analogie — mais « collection » est déjà le mot de MongoDB
// pour une table, que l'arbre affiche sous une connexion mongo. Ce qui voyage est un dossier, ou
// l'arbre entier.
export const transferFr: Dictionnaire = {
  close: 'Fermer',
  export: {
    title: 'Exporter',
    menu: 'Exporter le dossier…',
    everything: (p) =>
      p.count === 1
        ? 'Toute l’arborescence (1 dossier)'
        : `Toute l’arborescence (${p.count} dossiers)`,
    what: 'Le fichier porte les dossiers, leurs connexions et leurs consoles. Ni les préférences, ni les instances, ni aucune donnée des bases.',
    // Un dossier exporté seul devient un dossier racine du fichier : ce qu'il héritait voyage avec
    // lui, et le dire évite de croire à une lecture seule tombée du ciel à l'arrivée.
    inherited:
      'Exporté seul, le dossier emporte la lecture seule et les libellés de valeurs qu’il hérite de ses dossiers parents.',
    choose: 'Choisir un fichier…',
    withPasswords: 'Inclure les mots de passe',
    withoutPasswords:
      "Les connexions arriveront sans mot de passe, et l'import dira lesquelles en attendent un.",
    withPasswordsWarning:
      "Les mots de passe seront écrits en clair dans le fichier. Un fichier partagé ne se reprend pas : ne l'envoyez qu'à quelqu'un à qui vous confieriez ces accès.",
    done: (p) =>
      `${p.folders} dossier(s), ${p.connections} connexion(s), ${p.consoles} console(s) écrits.`,
    carried: (p) => `${p.count} mot(s) de passe écrit(s) en clair dans le fichier.`,
    missing: (p) =>
      `${p.count} connexion(s) déclarent un mot de passe introuvable dans le trousseau : ${p.list}`,
  },
  import: {
    title: 'Importer des dossiers',
    /** Le bouton de la bande de l'arbre, et celui de l'écran d'accueil. */
    menu: 'Importer des dossiers…',
    what: "Choisissez un fichier exporté par DoraBase. Rien ne sera écrit avant que vous ayez vu ce qu'il apporte.",
    choose: 'Choisir un fichier…',
    apply: (p) => (p.count === 1 ? 'Importer 1 élément' : `Importer ${p.count} éléments`),
    nothingSelected: 'Rien n’est retenu',
    emptyFile: 'Ce fichier ne porte aucun dossier.',
    carriesPasswords: 'Ce fichier porte des mots de passe en clair.',
    /** La ligne des connexions que le fichier range à la racine, hors de tout dossier. */
    rootConnections: 'Connexions à la racine',
    verdict: {
      created: 'Nouveau dossier',
      merged: 'Dossier existant, complété',
      rootMerged: 'Ajoutées à la racine',
      skipped: 'Écarté',
      rejected: 'Refusé',
      rejectedReason: 'Ce dossier ne peut pas être importé, voir la raison indiquée',
    },
    brings: (p) =>
      `+${p.folders} dossier(s), +${p.connections} connexion(s), +${p.consoles} console(s)`,
    connectionsKept: (p) =>
      `${p.count} connexion(s) déjà déclarées ici : leurs réglages et leur place sont gardés`,
    consolesKept: (p) => `${p.count} console(s) homonymes : le texte local est gardé`,
    foldersKept: (p) =>
      `${p.count} dossier(s) déjà présents ici : leur nom et leur couleur sont gardés`,
    // **Une réserve, et non un détail** (#169) : la lecture seule fusionne en « locale OU fichier »,
    // donc un dossier local peut la **recevoir**. C'est la seule chose qu'un import change à ce qui
    // était déjà là, et elle ferme les connexions concernées.
    readOnlyFromFile: (p) => `${p.count} dossier(s) local(aux) passent en lecture seule`,
    passwordsMissing: (p) => `${p.count} connexion(s) attendent leur mot de passe`,
    passwordsStored: (p) => `${p.count} mot(s) de passe rangés depuis le fichier`,
    localPaths: (p) => `${p.count} chemin(s) à vérifier sur cette machine`,
    // Les libellés de valeurs (`API-75`) : ce qui arrive est un **détail**, ce qui est gardé est une
    // **réserve**.
    valueLabelsAdded: (p) => `${p.count} colonne(s) reçoivent leurs libellés de valeurs`,
    valueLabelsKept: (p) =>
      `${p.count} colonne(s) déjà libellées : les libellés locaux sont gardés`,
    kubeconfigsMissing: (p) => `${p.count} connexion(s) sans kubeconfig déclaré dans le fichier`,
    connectionsRejected: (p) =>
      `${p.count} connexion(s) refusées : leur identifiant n'est pas valable`,
  },
}

export const transferEn: Dictionnaire = {
  close: 'Close',
  export: {
    title: 'Export',
    menu: 'Export folder…',
    everything: (p) =>
      p.count === 1 ? 'The whole tree (1 folder)' : `The whole tree (${p.count} folders)`,
    what: 'The file carries folders, their connections and their consoles. Neither preferences, nor instances, nor any database data.',
    inherited:
      'Exported on its own, the folder carries the read-only mode and value labels it inherits from its parent folders.',
    choose: 'Choose a file…',
    withPasswords: 'Include passwords',
    withoutPasswords:
      'Connections will arrive without a password, and the import will name the ones still waiting for one.',
    withPasswordsWarning:
      'Passwords will be written to the file in cleartext. A shared file cannot be taken back: only send it to someone you would trust with these credentials.',
    done: (p) =>
      `${p.folders} folder(s), ${p.connections} connection(s), ${p.consoles} console(s) written.`,
    carried: (p) => `${p.count} password(s) written to the file in cleartext.`,
    missing: (p) =>
      `${p.count} connection(s) declare a password the keychain does not hold: ${p.list}`,
  },
  import: {
    title: 'Import folders',
    menu: 'Import folders…',
    what: 'Choose a file exported by DoraBase. Nothing is written until you have seen what it brings.',
    choose: 'Choose a file…',
    apply: (p) => (p.count === 1 ? 'Import 1 item' : `Import ${p.count} items`),
    nothingSelected: 'Nothing selected',
    emptyFile: 'This file carries no folder.',
    carriesPasswords: 'This file carries passwords in cleartext.',
    rootConnections: 'Connections at the root',
    verdict: {
      created: 'New folder',
      merged: 'Existing folder, completed',
      rootMerged: 'Added at the root',
      skipped: 'Skipped',
      rejected: 'Refused',
      rejectedReason: 'This folder cannot be imported, see the stated reason',
    },
    brings: (p) =>
      `+${p.folders} folder(s), +${p.connections} connection(s), +${p.consoles} console(s)`,
    connectionsKept: (p) =>
      `${p.count} connection(s) already declared here: settings and place are kept`,
    consolesKept: (p) => `${p.count} console(s) with the same name: the local text is kept`,
    foldersKept: (p) => `${p.count} folder(s) already here: their name and colour are kept`,
    readOnlyFromFile: (p) => `${p.count} local folder(s) become read-only`,
    passwordsMissing: (p) => `${p.count} connection(s) are waiting for their password`,
    passwordsStored: (p) => `${p.count} password(s) stored from the file`,
    localPaths: (p) => `${p.count} path(s) to check on this machine`,
    valueLabelsAdded: (p) => `${p.count} column(s) receive their value labels`,
    valueLabelsKept: (p) => `${p.count} column(s) already labelled: the local labels are kept`,
    kubeconfigsMissing: (p) =>
      `${p.count} connection(s) whose kubeconfig the file does not declare`,
    connectionsRejected: (p) => `${p.count} connection(s) refused: their identifier is not valid`,
  },
}
