import type { Dictionnaire } from '../types'

// Rempli par les deux modales de transfert de projets (`API-30`). Voir dictionaries/index.ts.
//
// **« Projets » et non « collections »** : la demande compare le fichier à une collection Postman,
// et c'est la bonne analogie — mais « collection » est déjà le mot de MongoDB pour une table, que
// l'arbre affiche sous une connexion mongo. Ce qui voyage est un projet.
export const transferFr: Dictionnaire = {
  close: 'Fermer',
  export: {
    title: 'Exporter les projets',
    menu: 'Exporter le projet…',
    allProjects: (p) => (p.count === 1 ? 'Tous les projets (1)' : `Tous les projets (${p.count})`),
    what: 'Le fichier porte les environnements, les connexions et leurs consoles. Ni les préférences, ni aucune donnée des bases.',
    choose: 'Choisir un fichier…',
    withPasswords: 'Inclure les mots de passe',
    withoutPasswords:
      "Les connexions arriveront sans mot de passe, et l'import dira lesquelles en attendent un.",
    withPasswordsWarning:
      "Les mots de passe seront écrits en clair dans le fichier. Un fichier partagé ne se reprend pas : ne l'envoyez qu'à quelqu'un à qui vous confieriez ces accès.",
    done: (p) =>
      `${p.projects} projet(s), ${p.connections} connexion(s), ${p.consoles} console(s) écrits.`,
    carried: (p) => `${p.count} mot(s) de passe écrit(s) en clair dans le fichier.`,
    missing: (p) =>
      `${p.count} connexion(s) déclarent un mot de passe introuvable dans le trousseau : ${p.list}`,
  },
  import: {
    title: 'Importer des projets',
    /** Le bouton de la bande de l'arbre, et celui de l'écran d'accueil. */
    menu: 'Importer des projets…',
    what: "Choisissez un fichier de projets exporté par DoraBase. Rien ne sera écrit avant que vous ayez vu ce qu'il apporte.",
    choose: 'Choisir un fichier…',
    apply: (p) => (p.count === 1 ? 'Importer 1 projet' : `Importer ${p.count} projets`),
    nothingSelected: 'Aucun projet retenu',
    emptyFile: 'Ce fichier ne porte aucun projet.',
    carriesPasswords: 'Ce fichier porte des mots de passe en clair.',
    verdict: {
      created: 'Nouveau projet',
      merged: 'Projet existant, complété',
      skipped: 'Écarté',
      rejected: 'Refusé',
      rejectedReason: 'Ce projet ne peut pas être importé, voir la raison indiquée',
    },
    brings: (p) =>
      `+${p.environments} environnement(s), +${p.connections} connexion(s), +${p.consoles} console(s)`,
    connectionsKept: (p) =>
      `${p.count} connexion(s) déjà déclarées ici : leurs réglages sont gardés`,
    consolesKept: (p) => `${p.count} console(s) homonymes : le texte local est gardé`,
    environmentsKept: (p) =>
      `${p.count} environnement(s) déjà déclarés ici : la déclaration locale est gardée`,
    passwordsMissing: (p) => `${p.count} connexion(s) attendent leur mot de passe`,
    passwordsStored: (p) => `${p.count} mot(s) de passe rangés depuis le fichier`,
    localPaths: (p) => `${p.count} chemin(s) à vérifier sur cette machine`,
    // Les libellés de valeurs (`API-75`). Ils voyagent avec le projet, qui porte leur déclaration :
    // ce qui arrive est un **détail**, ce qui est gardé est une **réserve**.
    valueLabelsAdded: (p) => `${p.count} colonne(s) reçoivent leurs libellés de valeurs`,
    valueLabelsKept: (p) =>
      `${p.count} colonne(s) déjà libellées : les libellés locaux sont gardés`,
    kubeconfigsMissing: (p) => `${p.count} connexion(s) sans kubeconfig déclaré dans le fichier`,
    connectionsRejected: (p) =>
      `${p.count} connexion(s) refusées : leur environnement n'est déclaré nulle part`,
  },
}

export const transferEn: Dictionnaire = {
  close: 'Close',
  export: {
    title: 'Export projects',
    menu: 'Export project…',
    allProjects: (p) => (p.count === 1 ? 'All projects (1)' : `All projects (${p.count})`),
    what: 'The file carries environments, connections and their consoles. Neither preferences, nor any database data.',
    choose: 'Choose a file…',
    withPasswords: 'Include passwords',
    withoutPasswords:
      'Connections will arrive without a password, and the import will name the ones still waiting for one.',
    withPasswordsWarning:
      'Passwords will be written to the file in cleartext. A shared file cannot be taken back: only send it to someone you would trust with these credentials.',
    done: (p) =>
      `${p.projects} project(s), ${p.connections} connection(s), ${p.consoles} console(s) written.`,
    carried: (p) => `${p.count} password(s) written to the file in cleartext.`,
    missing: (p) =>
      `${p.count} connection(s) declare a password the keychain does not hold: ${p.list}`,
  },
  import: {
    title: 'Import projects',
    menu: 'Import projects…',
    what: 'Choose a projects file exported by DoraBase. Nothing is written until you have seen what it brings.',
    choose: 'Choose a file…',
    apply: (p) => (p.count === 1 ? 'Import 1 project' : `Import ${p.count} projects`),
    nothingSelected: 'No project selected',
    emptyFile: 'This file carries no project.',
    carriesPasswords: 'This file carries passwords in cleartext.',
    verdict: {
      created: 'New project',
      merged: 'Existing project, completed',
      skipped: 'Skipped',
      rejected: 'Refused',
      rejectedReason: 'This project cannot be imported, see the stated reason',
    },
    brings: (p) =>
      `+${p.environments} environment(s), +${p.connections} connection(s), +${p.consoles} console(s)`,
    connectionsKept: (p) => `${p.count} connection(s) already declared here: settings are kept`,
    consolesKept: (p) => `${p.count} console(s) with the same name: the local text is kept`,
    environmentsKept: (p) =>
      `${p.count} environment(s) already declared here: the local declaration is kept`,
    passwordsMissing: (p) => `${p.count} connection(s) are waiting for their password`,
    passwordsStored: (p) => `${p.count} password(s) stored from the file`,
    localPaths: (p) => `${p.count} path(s) to check on this machine`,
    valueLabelsAdded: (p) => `${p.count} column(s) receive their value labels`,
    valueLabelsKept: (p) => `${p.count} column(s) already labelled: the local labels are kept`,
    kubeconfigsMissing: (p) =>
      `${p.count} connection(s) whose kubeconfig the file does not declare`,
    connectionsRejected: (p) =>
      `${p.count} connection(s) refused: their environment is declared nowhere`,
  },
}
