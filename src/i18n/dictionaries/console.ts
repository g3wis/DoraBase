import type { Dictionnaire } from '../types'

export const consoleFr: Dictionnaire = {
  arbreJson: {
    vide: 'La commande n’a rendu aucun document.',
    toutReplier: 'Tout replier',
    deplierUnCran: 'Déplier d’un cran',
    documentsAriaLabel: 'Documents du résultat',
    document: (p) => `document ${p.numero}`,
    replier: 'Replier',
    deplier: 'Déplier',
    basculerAriaLabel: (p) => `${p.action} ${p.etiquette}`,
    copier: 'Copier',
    // `noeudsJson.ts`, `resume()` — le résumé d'un nœud replié : « { 3 champs } » ou « [ 5 ] ».
    resumeTableau: (p) => `[ ${p.enfants} ]`,
    resumeObjet: (p) => `{ ${p.enfants} champ${Number(p.enfants) > 1 ? 's' : ''} }`,
  },
  resultat: {
    enCours: 'Exécution…',
    aucun: 'Aucun résultat : exécutez une requête.',
    vueLabel: 'Vue du résultat',
    documents: 'Documents',
    resultat: 'Résultat',
    json: 'JSON',
    messages: 'Messages',
    grilleLabel: (p) => `Résultat de la requête, ${p.n} ligne${Number(p.n) > 1 ? 's' : ''}`,
    // Mot pour mot les libellés d'`A5` (`tableView.grid.resizeColumn`/`reorderColumn`) : le même
    // geste sur la même grille ne doit pas se dire de deux façons.
    redimensionnerLaColonne: (p) => `Redimensionner ${p.colonne}`,
    deplacerLaColonne: (p) => `Déplacer ${p.colonne} (flèches gauche et droite)`,
    menuDeLaValeur: (p) => `Actions sur la valeur de ${p.colonne}`,
    copierLaValeur: 'Copier la valeur',
    menuDeLaColonne: (p) => `Actions sur la colonne ${p.colonne}`,
    masquerLaColonne: 'Masquer la colonne',
    reafficherLesColonnes: (p) => `Réafficher les colonnes masquées (${p.n})`,
    derniereColonne: 'C’est la dernière colonne affichée : la masquer ne laisserait rien à lire.',
    grilleVide: 'La requête n’a rendu aucune ligne.',
    etatAriaLabel: 'État du résultat',
    compteDocuments: (p) => `${p.texte} doc${Number(p.n) > 1 ? 's' : ''}`,
    compteLignes: (p) => `${p.texte} ligne${Number(p.n) > 1 ? 's' : ''}`,
    limite: (p) => `limité à ${p.n} par DoraBase`,
  },
  toolbar: {
    ariaLabel: 'Actions de la console',
    enCours: 'Exécution…',
    autoLimitMongo: 'auto-$limit 1000',
    limiteImplicite:
      'La requête ne porte pas de LIMIT : celui-ci sera ajouté par DoraBase. Les flèches l’écrivent dans la requête.',
    actions: {
      executer: {
        libelle: 'Exécuter',
        raison: 'Aucune base n’est ouverte : il n’y a rien à interroger.',
      },
      selection: {
        libelle: 'Sélection',
        raison: 'Aucune base n’est ouverte : il n’y a rien à interroger.',
      },
      enregistrer: {
        libelle: 'Enregistrer',
        raison: 'Aucun projet n’est ouvert : il n’y a nulle part où enregistrer.',
      },
      formater: {
        libelle: 'Formater',
        raison: 'Formater demande un formateur SQL : aucune dépendance n’a encore été choisie.',
      },
    },
  },
  transaction: {
    ariaLabel: 'Transaction en cours',
    titre: 'Transaction',
    // La transaction s'ouvre à la **première exécution** : entre le réglage et elle, le panneau dit
    // ce qui va se passer plutôt que de laisser une colonne vide.
    invite:
      'Rien n’est encore retenu. La transaction s’ouvrira à la première exécution, et rien ne sera écrit avant que vous la validiez.',
    rang: (p) => `#${p.rang}`,
    duree: (p) => `${p.ms} ms`,
    rendues: (p) => `${p.n} ligne${Number(p.n) > 1 ? 's' : ''} rendue${Number(p.n) > 1 ? 's' : ''}`,
    // **Les lignes touchées, dites à part** : « 0 ligne rendue » sur un `update` qui en a écrit
    // trois est le mensonge que ce compte existe pour éviter.
    touchees: (p) =>
      `${p.n} ligne${Number(p.n) > 1 ? 's' : ''} touchée${Number(p.n) > 1 ? 's' : ''}`,
    refusee: 'refusée',
    // **Le verbe du bouton**, ajouté au nom accessible de la carte : sans lui, celle-ci s'annoncerait
    // « #2 12 lignes rendues 4 ms select … », ce qui décrit sans dire ce qu'un clic fera.
    afficher: 'Afficher ce résultat dans la grille',
    valider: 'Valider',
    annuler: 'Annuler',
    enCours: 'Validation…',
    // **Le moteur, sans le nommer** : la phrase est vraie de PostgreSQL, seul des trois à
    // abandonner, et l'écran ne sait pas lequel répond — il lit `aborted`.
    abandonnee:
      'Une instruction a échoué et le moteur a abandonné la transaction : elle ne peut plus être validée, seulement annulée.',
    rienAValider: 'Aucune transaction n’est ouverte : il n’y a rien à valider.',
    rienAAnnuler: 'Aucune transaction n’est ouverte : il n’y a rien à annuler.',
    modeLabel: 'Transaction manuelle',
    // **Le réglage vaut pour la connexion**, pas pour cet onglet, et la phrase le dit : c'est ce qui
    // explique pourquoi la console voisine change d'aspect en même temps, et pourquoi un « Valider »
    // emporte aussi ce qu'elle a exécuté.
    // **Tout appartient à la console**, et la phrase le dit : le réglage, la transaction, et la
    // session qui la tient. Le dernier membre est ce qui compte le plus — il annonce que ce qu'on
    // retient ici ne se voit pas ailleurs, ce qui est la contrepartie de l'isolation.
    modeAide:
      'Éteint, chaque requête est validée par le serveur. Allumé, les requêtes s’accumulent dans une transaction que vous validez ou annulez vous-même. Cette transaction est celle de cette console seule : les autres consoles et les tables ouvertes ne verront ce qu’elle retient qu’une fois validée.',
    modeVerrouille:
      'Cette transaction contient des instructions : validez-la ou annulez-la avant de revenir au mode automatique.',
    // **Le geste qui reste, et lui seul** : proposer de valider une transaction abandonnée serait
    // proposer ce que le panneau vient de retirer.
    modeVerrouilleAbandon:
      'Cette transaction a été abandonnée : annulez-la avant de revenir au mode automatique.',
    raisons: {
      mongodb:
        'La console MongoDB ne fait que lire — find, aggregate, countDocuments, distinct : une transaction manuelle n’y aurait rien à valider.',
      bigquery:
        'BigQuery exécute chaque requête comme un job indépendant : il n’y a pas de session à tenir ouverte entre deux exécutions. Une transaction s’y écrit dans un script, en une seule requête.',
      redis:
        'DoraBase ne sait pas encore parler à Redis : sa connexion est refusée avant qu’une console s’ouvre.',
      snowflake:
        'DoraBase ne sait pas encore parler à Snowflake : sa connexion est refusée avant qu’une console s’ouvre.',
    },
  },
  commitConfirm: {
    titre: 'Valider la transaction',
    // Le pluriel de l'alerte n'est pas décidé ici : une seule écriture sans `where` suffit à la
    // faire paraître, et c'est le fait qui compte, pas leur nombre.
    sansRestrictionAvant: 'L’une des écritures n’a pas de ',
    sansRestrictionApres: ' : elle touche toutes les lignes de sa table.',
    ecritures: 'Écritures',
    instructions: 'Instructions',
    base: 'Base',
    environnement: 'Environnement',
    production: 'production',
    rappel:
      'La validation est définitive : DoraBase ne sait pas la défaire, et il n’y a pas de patch inverse pour une requête de console.',
    annuler: 'Annuler',
    enCours: 'Validation…',
    confirmer: (p) => `Valider ${p.n} écriture${Number(p.n) > 1 ? 's' : ''}`,
  },
  runConfirm: {
    titreSchema: 'Modifier la structure',
    titreEcriture: 'Écrire dans la base',
    sansRestrictionAvant: 'Cette requête n’a pas de ',
    toutesLesLignes: 'toutes les lignes',
    sansRestrictionMilieu: ' : elle touchera ',
    sansRestrictionApres: ' de la table.',
    alerteSchema: 'Une modification de structure ne se défait pas par une autre requête.',
    instruction: 'Instruction',
    base: 'Base',
    environnement: 'Environnement',
    production: 'production',
    rappel:
      'DoraBase exécute la requête telle qu’elle est écrite, sans transaction et sans patch inverse.',
    // **Seule une modification de structure arrive ici en transaction manuelle** (`API-38`) : les
    // écritures y sont dispensées de confirmation, c'est la validation qui la porte. Et la structure
    // n'est pas dispensée parce qu'une transaction ne la retient pas toujours — le rappel dit
    // exactement cela, là où « sans transaction » serait faux et « rien ne sera écrit » serait une
    // promesse que le moteur peut ne pas tenir.
    rappelTransaction:
      'Une modification de structure n’est pas toujours retenue par une transaction : selon le moteur, elle valide d’office ce qui attend avant de s’exécuter.',
    annuler: 'Annuler',
    enCours: 'Exécution…',
    confirmer: (p) => `Exécuter ce ${p.instruction}`,
  },
  sqlEditor: {
    ariaLabelSql: 'Requête SQL',
    ariaLabelMongo: 'Commande MongoDB',
    deplier: 'Déplier',
    replier: 'Replier',
    colonnesRepliees: 'Colonnes repliées à l’affichage — la requête les porte toutes',
  },
  vues: {
    jsonInvite: 'Sélectionnez une ligne du résultat pour la voir en JSON.',
    execute: 'exécuté',
    dureeEtLignes: (p) =>
      ` en ${p.ms} ms, ${p.n} ligne${Number(p.n) > 1 ? 's' : ''} rendue${Number(p.n) > 1 ? 's' : ''}`,
    dorabase: 'DoraBase',
    aAjoute: 'a ajouté',
    neEnPortaitPas: 'la requête n’en portait pas.',
    avisServeurAvant: 'Les avis du serveur (',
    avisServeurMilieu: ', ',
    avisServeurApres: ') ne sont pas encore captés.',
  },
}

export const consoleEn: Dictionnaire = {
  arbreJson: {
    vide: 'The command returned no document.',
    toutReplier: 'Collapse all',
    deplierUnCran: 'Expand one level',
    documentsAriaLabel: 'Result documents',
    document: (p) => `document ${p.numero}`,
    replier: 'Collapse',
    deplier: 'Expand',
    basculerAriaLabel: (p) => `${p.action} ${p.etiquette}`,
    copier: 'Copy',
    resumeTableau: (p) => `[ ${p.enfants} ]`,
    resumeObjet: (p) => `{ ${p.enfants} field${Number(p.enfants) === 1 ? '' : 's'} }`,
  },
  resultat: {
    enCours: 'Running…',
    aucun: 'No result: run a query.',
    vueLabel: 'Result view',
    documents: 'Documents',
    resultat: 'Result',
    json: 'JSON',
    messages: 'Messages',
    grilleLabel: (p) => `Query result, ${p.n} row${Number(p.n) > 1 ? 's' : ''}`,
    redimensionnerLaColonne: (p) => `Resize ${p.colonne}`,
    deplacerLaColonne: (p) => `Move ${p.colonne} (left and right arrows)`,
    menuDeLaValeur: (p) => `Actions on the value of ${p.colonne}`,
    copierLaValeur: 'Copy the value',
    menuDeLaColonne: (p) => `Actions on column ${p.colonne}`,
    masquerLaColonne: 'Hide column',
    reafficherLesColonnes: (p) => `Show hidden columns again (${p.n})`,
    derniereColonne: 'This is the last column shown: hiding it would leave nothing to read.',
    grilleVide: 'The query returned no rows.',
    etatAriaLabel: 'Result status',
    compteDocuments: (p) => `${p.texte} doc${Number(p.n) > 1 ? 's' : ''}`,
    compteLignes: (p) => `${p.texte} row${Number(p.n) > 1 ? 's' : ''}`,
    limite: (p) => `limited to ${p.n} by DoraBase`,
  },
  toolbar: {
    ariaLabel: 'Console actions',
    enCours: 'Running…',
    autoLimitMongo: 'auto-$limit 1000',
    limiteImplicite:
      'The query carries no LIMIT: DoraBase will add one. The arrows write it into the query.',
    actions: {
      executer: {
        libelle: 'Run',
        raison: 'No database is open: there is nothing to query.',
      },
      selection: {
        libelle: 'Selection',
        raison: 'No database is open: there is nothing to query.',
      },
      enregistrer: {
        libelle: 'Save',
        raison: 'No project is open: there is nowhere to save.',
      },
      formater: {
        libelle: 'Format',
        raison:
          'Formatting SQL needs a formatter, which is a dependency decision of its own — none has been chosen yet.',
      },
    },
  },
  transaction: {
    ariaLabel: 'Open transaction',
    titre: 'Transaction',
    invite:
      'Nothing is held yet. The transaction will open on the first run, and nothing will be written until you commit it.',
    rang: (p) => `#${p.rang}`,
    duree: (p) => `${p.ms} ms`,
    rendues: (p) => `${p.n} row${Number(p.n) > 1 ? 's' : ''} returned`,
    touchees: (p) => `${p.n} row${Number(p.n) > 1 ? 's' : ''} affected`,
    refusee: 'refused',
    afficher: 'Show this result in the grid',
    valider: 'Commit',
    annuler: 'Roll back',
    enCours: 'Committing…',
    abandonnee:
      'A statement failed and the engine abandoned the transaction: it can no longer be committed, only rolled back.',
    rienAValider: 'No transaction is open: there is nothing to commit.',
    rienAAnnuler: 'No transaction is open: there is nothing to roll back.',
    modeLabel: 'Manual transaction',
    modeAide:
      'Off, every query is committed by the server. On, queries pile up in a transaction that you commit or roll back yourself. That transaction belongs to this console alone: other consoles and open tables will not see what it holds until you commit.',
    modeVerrouille:
      'This transaction holds statements: commit it or roll it back before returning to automatic mode.',
    modeVerrouilleAbandon:
      'This transaction was abandoned: roll it back before returning to automatic mode.',
    raisons: {
      mongodb:
        'The MongoDB console only reads — find, aggregate, countDocuments, distinct: a manual transaction would have nothing to commit.',
      bigquery:
        'BigQuery runs every query as an independent job: there is no session to hold open between two runs. A transaction is written there as a script, in a single query.',
      redis:
        'DoraBase cannot talk to Redis yet: its connection is refused before a console can open.',
      snowflake:
        'DoraBase cannot talk to Snowflake yet: its connection is refused before a console can open.',
    },
  },
  commitConfirm: {
    titre: 'Commit the transaction',
    sansRestrictionAvant: 'One of the writes has no ',
    sansRestrictionApres: ': it affects every row of its table.',
    ecritures: 'Writes',
    instructions: 'Statements',
    base: 'Database',
    environnement: 'Environment',
    production: 'production',
    rappel:
      'Committing is final: DoraBase cannot undo it, and there is no inverse patch for a console query.',
    annuler: 'Cancel',
    enCours: 'Committing…',
    confirmer: (p) => `Commit ${p.n} write${Number(p.n) > 1 ? 's' : ''}`,
  },
  runConfirm: {
    titreSchema: 'Modify the structure',
    titreEcriture: 'Write to the database',
    sansRestrictionAvant: 'This query has no ',
    toutesLesLignes: 'all rows',
    sansRestrictionMilieu: ': it will affect ',
    sansRestrictionApres: ' of the table.',
    alerteSchema: 'A structural change cannot be undone by another query.',
    instruction: 'Instruction',
    base: 'Database',
    environnement: 'Environment',
    production: 'production',
    rappel:
      'DoraBase runs the query exactly as written, without a transaction and without an inverse patch.',
    rappelTransaction:
      'A structural change is not always held by a transaction: depending on the engine, it commits whatever is pending before running.',
    annuler: 'Cancel',
    enCours: 'Running…',
    confirmer: (p) => `Run this ${p.instruction}`,
  },
  sqlEditor: {
    ariaLabelSql: 'SQL query',
    ariaLabelMongo: 'MongoDB command',
    deplier: 'Unfold',
    replier: 'Fold',
    colonnesRepliees: 'Columns folded in the display — the query carries them all',
  },
  vues: {
    jsonInvite: 'Select a row from the result to view it as JSON.',
    execute: 'executed',
    dureeEtLignes: (p) => ` in ${p.ms} ms, ${p.n} row${Number(p.n) > 1 ? 's' : ''} returned`,
    dorabase: 'DoraBase',
    aAjoute: 'added',
    neEnPortaitPas: 'the query did not include one.',
    avisServeurAvant: 'Server notices (',
    avisServeurMilieu: ', ',
    avisServeurApres: ') are not yet captured.',
  },
}
