import { consoleEn, consoleFr } from './console'
import { diagramEn, diagramFr } from './diagram'
import { dumpEn, dumpFr } from './dump'
import { explorerEn, explorerFr } from './explorer'
import { newConnectionEn, newConnectionFr } from './newConnection'
import { newProjectEn, newProjectFr } from './newProject'
import { preferencesEn, preferencesFr } from './preferences'
import { schemasEn, schemasFr } from './schemas'
import { shellEn, shellFr } from './shell'
import { structureEn, structureFr } from './structure'
import { tableViewEn, tableViewFr } from './tableView'
import { uiEn, uiFr } from './ui'
import { welcomeEn, welcomeFr } from './welcome'

/**
 * Un fichier par écran (`10b`), pour que chacun se traduise sans toucher aux autres — le
 * même principe que « un jeu de résultats complet ne traverse pas l'IPC » appliqué ici à
 * l'édition : un dictionnaire commun aurait fait de chaque traduction une source de conflit.
 */
export const DICTIONNAIRES = {
  fr: {
    preferences: preferencesFr,
    welcome: welcomeFr,
    newConnection: newConnectionFr,
    newProject: newProjectFr,
    explorer: explorerFr,
    tableView: tableViewFr,
    console: consoleFr,
    structure: structureFr,
    diagram: diagramFr,
    shell: shellFr,
    dump: dumpFr,
    schemas: schemasFr,
    ui: uiFr,
  },
  en: {
    preferences: preferencesEn,
    welcome: welcomeEn,
    newConnection: newConnectionEn,
    newProject: newProjectEn,
    explorer: explorerEn,
    tableView: tableViewEn,
    console: consoleEn,
    structure: structureEn,
    diagram: diagramEn,
    shell: shellEn,
    dump: dumpEn,
    schemas: schemasEn,
    ui: uiEn,
  },
} as const
