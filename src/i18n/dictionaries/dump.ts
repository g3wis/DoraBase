import type { Dictionnaire } from '../types'

// Rempli par les deux modales de dump — export et import. Voir dictionaries/index.ts.
//
// **Les noms de binaires ne se traduisent pas** : `pg_dump` et `psql` sont ce que
// l'utilisateur tapera dans un terminal, et les franciser rendrait le message inutilisable.
export const dumpFr: Dictionnaire = {
  checking: {
    export: 'Vérification de pg_dump…',
    import: 'Vérification de psql…',
  },
  verdict: {
    readyExport: 'Exporter un dump',
    readyImport: 'Importer un dump',
    toolMissing: (p) => `${p.binary} est introuvable sur cette machine`,
    toolTooOld: "La version de l'outil est trop ancienne pour ce serveur",
    notYetSupportedExport: "L'export n'est pas encore disponible pour ce moteur",
    notYetSupportedImport: "L'import n'est pas encore disponible pour ce moteur",
    noLocalDumpExport: "Pas d'export local pour ce moteur",
    noLocalDumpImport: "Pas d'import local pour ce moteur",
  },
  explanation: {
    ready: (p) => `${p.tool}, version ${p.version}`,
    toolMissing: (p) =>
      `Installez les outils clients PostgreSQL, puis rouvrez cette fenêtre. ${p.binary} est cherché dans le PATH, puis dans les emplacements usuels de Homebrew et de Postgres.app.`,
    toolTooOld: (p) =>
      `L'outil est en version ${p.tool} face à un serveur ${p.server} : un outil plus ancien que le serveur refuse de travailler dessus. Mettez à jour les outils clients.`,
    notYetSupportedExport: (p) =>
      `L'export délègue à l'outil natif du moteur, et celui de ${p.engine} n'est pas encore branché.`,
    notYetSupportedImport: (p) =>
      `L'import délègue à l'outil natif du moteur, et celui de ${p.engine} n'est pas encore branché.`,
    noLocalDump: (p) =>
      `${p.engine} n'a pas d'outil local : ses sauvegardes passent par un stockage cloud, ce que DoraBase ne fait pas.`,
  },
  // Le transport **réellement employé** par pg_dump et psql (#82). Le nom libpq du mode finit
  // la phrase entre parenthèses : c'est celui qu'on retrouverait dans PGSSLMODE, et le seul mot
  // qui se compare sans ambiguïté au réglage choisi dans A2.
  transport: {
    disable: 'Transport : en clair, sans TLS (disable)',
    prefer: "Transport : TLS si le serveur l'offre, en clair sinon (prefer)",
    require: 'Transport : TLS, certificat du serveur non vérifié (require)',
    verifyCaFile: (p) => `Transport : TLS, certificat vérifié par l'autorité ${p.path} (verify-ca)`,
    verifyCaDefault:
      "Transport : TLS, certificat vérifié par l'autorité de ~/.postgresql/root.crt (verify-ca)",
    verifyFullFile: (p) =>
      `Transport : TLS, certificat et nom d'hôte vérifiés par l'autorité ${p.path} (verify-full)`,
    verifyFullSystem:
      "Transport : TLS, certificat et nom d'hôte vérifiés par les autorités du système (verify-full)",
  },
  export: {
    close: 'Fermer',
    cancel: 'Annuler l’export',
    choose: 'Choisir le fichier…',
    written: (p) => `${p.bytes} écrits…`,
    done: (p) => `Terminé : ${p.bytes} dans ${p.file}`,
  },
  import: {
    close: 'Fermer',
    choose: 'Choisir un fichier…',
    confirm: (p) => `Importer dans ${p.database}`,
    running: 'Import en cours…',
    done: 'Import terminé.',
    inspection: {
      pgDumpTitle: 'Importer un dump',
      truncatedTitle: 'Ce fichier est incomplet et ne sera pas importé',
      tooRecentTitle: "Ce dump vient d'une version plus récente que le serveur cible",
      foreignTitle: "Ce fichier n'a pas été produit par pg_dump",
      emptyTitle: 'Ce fichier est vide',
      unreadableTitle: "Ce fichier n'a pas pu être lu",
      pgDump: (p) =>
        `Dump d'un PostgreSQL ${p.origin}. L'import est joué en une seule transaction : à la première erreur, la base cible reste inchangée.`,
      truncated:
        "Le pied « PostgreSQL database dump complete » manque, donc le fichier a été coupé. Un dump tronqué au milieu d'un bloc COPY s'importe partiellement et en silence : psql traite la fin de fichier comme la fin normale des données et valide la transaction. L'import est donc refusé avant d'être lancé.",
      tooRecent: (p) =>
        `Le dump vient d'un PostgreSQL ${p.origin} et la cible est en ${p.target} : le rejouer risque de heurter une syntaxe que le serveur ne connaît pas.`,
      foreign:
        "Aucun en-tête pg_dump reconnaissable : le fichier est accepté tel quel, et son contenu n'est pas vérifié — c'est un script SQL arbitraire. Une erreur éventuelle sera rapportée par psql, avec la ligne fautive.",
      empty: "Il n'y a rien à importer.",
      unreadable: (p) => `Le fichier n'a pas pu être ouvert : ${p.cause}`,
    },
  },
  noTarget: {
    title: 'Aucune base à exporter ou importer',
    text: "Le menu ne dit pas quelle base viser, et la configuration en laisse plusieurs possibles — ou aucune. La cible viendra de la sélection de l'arbre ; d'ici là, l'export et l'import n'agissent que sur une configuration qui ne compte qu'une seule connexion.",
  },
  availabilityFailed: "La disponibilité de l'outil n'a pas pu être vérifiée",
}

export const dumpEn: Dictionnaire = {
  checking: {
    export: 'Checking pg_dump…',
    import: 'Checking psql…',
  },
  verdict: {
    readyExport: 'Export a dump',
    readyImport: 'Import a dump',
    toolMissing: (p) => `${p.binary} was not found on this machine`,
    toolTooOld: 'The tool is too old for this server',
    notYetSupportedExport: 'Export is not available yet for this engine',
    notYetSupportedImport: 'Import is not available yet for this engine',
    noLocalDumpExport: 'No local export for this engine',
    noLocalDumpImport: 'No local import for this engine',
  },
  explanation: {
    ready: (p) => `${p.tool}, version ${p.version}`,
    toolMissing: (p) =>
      `Install the PostgreSQL client tools, then reopen this window. ${p.binary} is looked up in PATH, then in the usual Homebrew and Postgres.app locations.`,
    toolTooOld: (p) =>
      `The tool is version ${p.tool} against a ${p.server} server: a tool older than the server refuses to work on it. Update the client tools.`,
    notYetSupportedExport: (p) =>
      `Export delegates to the engine's native tool, and ${p.engine}'s is not wired yet.`,
    notYetSupportedImport: (p) =>
      `Import delegates to the engine's native tool, and ${p.engine}'s is not wired yet.`,
    noLocalDump: (p) =>
      `${p.engine} has no local tool: its backups go through cloud storage, which DoraBase does not do.`,
  },
  transport: {
    disable: 'Transport: cleartext, no TLS (disable)',
    prefer: 'Transport: TLS if the server offers it, cleartext otherwise (prefer)',
    require: 'Transport: TLS, server certificate not verified (require)',
    verifyCaFile: (p) => `Transport: TLS, certificate verified against ${p.path} (verify-ca)`,
    verifyCaDefault:
      'Transport: TLS, certificate verified against ~/.postgresql/root.crt (verify-ca)',
    verifyFullFile: (p) =>
      `Transport: TLS, certificate and host name verified against ${p.path} (verify-full)`,
    verifyFullSystem:
      "Transport: TLS, certificate and host name verified against the system's authorities (verify-full)",
  },
  export: {
    close: 'Close',
    cancel: 'Cancel export',
    choose: 'Choose the file…',
    written: (p) => `${p.bytes} written…`,
    done: (p) => `Done: ${p.bytes} in ${p.file}`,
  },
  import: {
    close: 'Close',
    choose: 'Choose a file…',
    confirm: (p) => `Import into ${p.database}`,
    running: 'Importing…',
    done: 'Import finished.',
    inspection: {
      pgDumpTitle: 'Import a dump',
      truncatedTitle: 'This file is incomplete and will not be imported',
      tooRecentTitle: 'This dump comes from a newer version than the target server',
      foreignTitle: 'This file was not produced by pg_dump',
      emptyTitle: 'This file is empty',
      unreadableTitle: 'This file could not be read',
      pgDump: (p) =>
        `Dump of a PostgreSQL ${p.origin}. The import runs in a single transaction: on the first error, the target database is left unchanged.`,
      truncated:
        'The "PostgreSQL database dump complete" footer is missing, so the file was cut short. A dump truncated in the middle of a COPY block imports partially and silently: psql treats end-of-file as the normal end of the data and commits the transaction. The import is therefore refused before it starts.',
      tooRecent: (p) =>
        `The dump comes from PostgreSQL ${p.origin} and the target runs ${p.target}: replaying it risks hitting syntax the server does not know.`,
      foreign:
        'No recognisable pg_dump header: the file is accepted as is, and its contents are not checked — it is an arbitrary SQL script. Any error will be reported by psql, with the offending line.',
      empty: 'There is nothing to import.',
      unreadable: (p) => `The file could not be opened: ${p.cause}`,
    },
  },
  noTarget: {
    title: 'No database to export or import',
    text: 'The menu does not say which database to target, and the configuration leaves several possible — or none. The target will come from the tree selection; until then, export and import only act on a configuration holding a single connection.',
  },
  availabilityFailed: 'The availability of the tool could not be checked',
}
