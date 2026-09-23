import type { Dictionnaire } from '../types'

// Le diagramme de structure d'un schéma. Voir dictionaries/index.ts pour l'assemblage.
export const diagramFr: Dictionnaire = {
  boite: {
    // Le nom accessible d'une boîte. **Les espaces y sont explicites** et les deux comptes en font
    // partie : c'est l'information, et elle n'est écrite nulle part ailleurs (piège n° 1).
    label: (p) =>
      `${p.table} · ${p.colonnes} colonne${Number(p.colonnes) > 1 ? 's' : ''} · ${p.liens} lien${
        Number(p.liens) > 1 ? 's' : ''
      }`,
    reste: (p) => `+ ${p.count} autre${Number(p.count) > 1 ? 's' : ''}`,
  },
  ligne: {
    nullable: 'peut être nul',
    nonNullable: 'jamais nul',
    reference: (p) => `référence ${p.cible}`,
  },
  colonnes: {
    // **Le libellé dit ce que le réglage fait, non ce qu'il filtre.** « Clés | Toutes » se lisait
    // comme un filtre sur une nature de colonne, sans annoncer que des lignes étaient masquées.
    toutes: 'Toutes les colonnes',
  },
  relation: {
    ariaLabel: 'Ce qui relie les tables choisies',
    // **L'invite dit le geste au moment où il sert.** `⇧`-clic est le geste d'extension universel,
    // mais il ne s'annonce nulle part : la bande paraît dès la première table choisie, et c'est là
    // — et seulement là — qu'il y a quelque chose à en faire.
    invite: (p) => `${p.table} — ${p.maj}-clic sur une seconde table pour voir ce qui les relie`,
    directe: 'Reliées par une clé',
    indirecte: (p) => `Reliées en ${p.count} étapes`,
    reference: ' référence ',
    referenceePar: ' est référencée par ',
    // **« Aucune » ne peut pas vouloir dire « aucune dans la base » tant que le dessin est
    // incomplet** : une lecture en cours ou un plafond qui mord laissent hors du graphe des tables
    // par lesquelles le chemin passerait peut-être. Deux phrases, parce que ce sont deux faits.
    aucune: (p) => `Aucun chemin de clés entre ${p.a} et ${p.b}`,
    aucunePartielle: (p) =>
      `Aucun chemin de clés entre ${p.a} et ${p.b} parmi les tables dessinées`,
    effacer: 'Ne plus rien choisir',
  },
  // **La cardinalité, en toutes lettres.** La notation se lit d'un coup d'œil pour qui la connaît
  // la notation, et ne dit rien à qui ne la connaît pas — un `marker` SVG n'a d'ailleurs aucun texte
  // qu'une voix puisse rendre. Les deux formes disent la même chose : la brève pour une infobulle,
  // celle qui porte ses espaces pour la lecture d'un chemin.
  cardinalite: {
    un: 'un à un',
    plusieurs: 'un à plusieurs',
    unVoix: ' un à un ',
    plusieursVoix: ' un à plusieurs ',
  },
  chargement: 'Lecture…',
  recherche: {
    // **« table ou colonne », parce que le champ cherche les deux** : annoncer « une table » ferait
    // chercher ailleurs pour une colonne, et ne rien annoncer laisserait deviner.
    placeholder: 'Chercher une table, une colonne…',
    label: 'Chercher une table ou une colonne dans le diagramme',
    compte: (p) => `${p.count} trouvée${Number(p.count) > 1 ? 's' : ''}`,
    aucune: 'aucune',
    effacer: 'Effacer la recherche',
  },
  zoom: {
    // **Les deux boutons nomment ce qu'ils agrandissent**, et ce n'est pas une précision de style.
    // La barre de titre de Windows porte « Réduire » et « Agrandir » pour la *fenêtre* : sans le
    // complément, deux boutons de la même fenêtre auraient le même nom accessible, ce qui est le
    // piège n° 1 par un bout que l'espace n'arrange pas. Découvert le 3 septembre 2026 en exécutant
    // la suite e2e sur une machine Windows, où trois tests ne savaient plus lequel viser.
    moins: 'Réduire le diagramme',
    plus: 'Agrandir le diagramme',
    reinitialiser: (p) => `Échelle ${p.pourcentage} % — revenir à 100 %`,
    // **Le geste s'annonce, sinon il n'existe pas.** C'est la règle que ce dépôt a déjà payée au
    // `⌘E` du mode édition et au `⇧`-clic de cette vue : un chemin qu'on ne voit pas est un chemin
    // que personne ne trouve. Il est posé sur le pourcentage, seul des trois boutons à n'être
    // jamais désactivé — une infobulle sur un bouton mort est inatteignable (piège n° 3), et elle
    // partirait justement aux deux extrémités de l'échelle.
    geste: (p) => `${p.touche} + molette, ou pincement du trackpad`,
  },
  vide: {
    aucuneTable: (p) => `Le schéma ${p.schema} ne contient aucune table.`,
    lecture: (p) => `Lecture des structures… ${p.lues} / ${p.total}`,
  },
  statusBar: {
    ariaLabel: 'Résumé du diagramme',
    tables: (p) => `${p.count} table${Number(p.count) > 1 ? 's' : ''}`,
    lues: (p) => `${p.lues} / ${p.total} tables lues`,
    plafonnees: (p) => `${p.montrees} des ${p.total} tables`,
    // **Le critère, puis les noms.** « n des m tables » disait qu'il manquait quelque chose sans
    // dire quoi ni selon quelle règle — la question s'est posée telle quelle.
    plafonneesRaison: (p) =>
      `Le diagramme s’arrête à ${p.plafond} tables, prises dans l’ordre alphabétique. ` +
      `Absentes du dessin : ${p.omises}`,
    liens: (p) => `${p.count} lien${Number(p.count) > 1 ? 's' : ''}`,
    externes: (p) => `${p.count} hors du schéma`,
  },
}

export const diagramEn: Dictionnaire = {
  boite: {
    label: (p) =>
      `${p.table} · ${p.colonnes} column${Number(p.colonnes) === 1 ? '' : 's'} · ${p.liens} link${
        Number(p.liens) === 1 ? '' : 's'
      }`,
    reste: (p) => `+ ${p.count} more`,
  },
  ligne: {
    nullable: 'nullable',
    nonNullable: 'not null',
    reference: (p) => `references ${p.cible}`,
  },
  colonnes: {
    toutes: 'All columns',
  },
  relation: {
    ariaLabel: 'What links the selected tables',
    invite: (p) => `${p.table} — ${p.maj}-click a second table to see what links them`,
    directe: 'Linked by a key',
    indirecte: (p) => `Linked in ${p.count} steps`,
    reference: ' references ',
    referenceePar: ' is referenced by ',
    aucune: (p) => `No key path between ${p.a} and ${p.b}`,
    aucunePartielle: (p) => `No key path between ${p.a} and ${p.b} among the tables drawn`,
    effacer: 'Clear the selection',
  },
  cardinalite: {
    un: 'one to one',
    plusieurs: 'one to many',
    unVoix: ' one to one ',
    plusieursVoix: ' one to many ',
  },
  chargement: 'Reading…',
  recherche: {
    placeholder: 'Find a table, a column…',
    label: 'Find a table or a column in the diagram',
    compte: (p) => `${p.count} found`,
    aucune: 'none',
    effacer: 'Clear the search',
  },
  zoom: {
    moins: 'Zoom the diagram out',
    plus: 'Zoom the diagram in',
    reinitialiser: (p) => `Scale ${p.pourcentage} % — back to 100 %`,
    geste: (p) => `${p.touche} + scroll, or trackpad pinch`,
  },
  vide: {
    aucuneTable: (p) => `Schema ${p.schema} contains no table.`,
    lecture: (p) => `Reading structures… ${p.lues} / ${p.total}`,
  },
  statusBar: {
    ariaLabel: 'Diagram summary',
    tables: (p) => `${p.count} table${Number(p.count) === 1 ? '' : 's'}`,
    lues: (p) => `${p.lues} / ${p.total} tables read`,
    plafonnees: (p) => `${p.montrees} of ${p.total} tables`,
    plafonneesRaison: (p) =>
      `The diagram stops at ${p.plafond} tables, taken in alphabetical order. ` +
      `Missing from the drawing: ${p.omises}`,
    liens: (p) => `${p.count} link${Number(p.count) === 1 ? '' : 's'}`,
    externes: (p) => `${p.count} outside the schema`,
  },
}
