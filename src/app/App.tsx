import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  createConsole,
  createFolder,
  declareKubeconfig,
  deleteConsole,
  deleteFolder,
  deleteInstance,
  listKubernetesNamespaces,
  listKubernetesResources,
  moveDatabase,
  moveFolder,
  recolorFolder,
  renameConsole,
  renameFolder,
  saveConsole,
  saveInstance,
  saveKubeconfigs,
  savePreferences,
  setFolderIcon,
  setFolderReadOnly,
} from '../data/commandes'
import { ARBRE_VIDE, arbreEstVide } from '../data/dossiers'
import { useConfiguration } from '../data/useConfiguration'
import { Sprite } from '../design/icons/Sprite'
import type {
  ConnectionId,
  Database,
  FolderId,
  FolderTree,
  Kubeconfigs,
  ManagedInstance,
  Preferences,
} from '../domain/config'
import type { AvailableUpdate } from '../domain/maj'
import { LanguageProvider, langueAppliquee } from '../i18n/LanguageContext'
import { DumpDialogs, type SensDuDump } from '../screens/Dump/DumpDialogs'
import { idDossier } from '../screens/Explorer/arbre'
import { DeleteInstanceDialog } from '../screens/Instances/DeleteInstanceDialog'
import { NewInstance } from '../screens/Instances/NewInstance'
import { renommerLaConnexion, retirerLaConnexion } from '../screens/NewConnection/enregistrerLaBase'
import { NewConnection } from '../screens/NewConnection/NewConnection'
import { ouvrirSelecteurDeKubeconfig } from '../screens/Preferences/ouvrirSelecteurDeKubeconfig'
import { PreferencesDialog } from '../screens/Preferences/PreferencesDialog'
import { jetonsDe, PREFERENCES_PAR_DEFAUT, themeApplique } from '../screens/Preferences/preferences'
import { type DemandeDeTransfert, TransferDialogs } from '../screens/Transfer/TransferDialogs'
import { WelcomeScreen } from '../screens/Welcome/WelcomeScreen'
import { Workbench } from '../screens/Workbench/Workbench'
import { AnnonceMiseAJour } from '../shell/AnnonceMiseAJour/AnnonceMiseAJour'
import { useClicDroitDesactive } from '../shell/useClicDroit'
import { useRefusDuZoom } from '../shell/useRefusDuZoom'
import { BarresDeDefilement } from '../ui/BarresDeDefilement/BarresDeDefilement'
import { brancherEvenementsDeMenu } from './menuEvents'
import { useRaccourcisDeCreation } from './useRaccourcisDeCreation'

// La galerie (`src/design/gallery/`) ne doit jamais partir dans le bundle livré : elle
// est montée derrière deux conditions, `import.meta.env.DEV` ET `?gallery` dans l'URL.
// `import.meta.env.DEV` est remplacé par `false` à la construction de production ; le
// bloc qui suit devient alors du code mort que Vite/Rollup élague — y compris l'appel
// `import()` lui-même, qui ne doit donc apparaître nulle part dans `dist/`. Un import
// statique de `Gallery` aurait suffi à la faire fuir dans le bundle initial ; l'import
// dynamique évite ce piège même si l'élagage venait à échouer.
const showGallery =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')

const Gallery = showGallery
  ? lazy(() => import('../design/gallery/Gallery').then((module) => ({ default: module.Gallery })))
  : null

// L'écran de travail sur données figées, monté aux mêmes deux conditions que la galerie et
// pour une raison analogue : Playwright pilote Chromium, où le pont Tauri ne répond pas, et
// `10b` exige qu'au moins un test parte de `/` plutôt que de `?gallery`.
const showDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')

const WorkbenchDemo = showDemo
  ? lazy(() =>
      import('../screens/Workbench/demo').then((module) => ({ default: module.WorkbenchDemo })),
    )
  : null

export function App() {
  // Aucun zoom global : le pincement du trackpad et `⌘`/`Ctrl` + molette sont refusés (`API-57`).
  useRefusDuZoom()
  // Le menu contextuel du moteur de rendu, remplacé par le silence : nos menus s'ouvrent eux-mêmes.
  useClicDroitDesactive()

  /**
   * La déclaration d'une connexion est ouverte, et **dans quel dossier** (26 août 2026, puis #166).
   *
   * Un objet plutôt qu'un booléen : le geste part du menu d'une ligne de dossier, qui sait lequel.
   * `null` dans le champ, c'est la racine — une valeur, non une ignorance.
   */
  const [connexionOuverte, setConnexionOuverte] = useState<{ dossier: FolderId | null } | null>(
    null,
  )
  /**
   * La connexion en cours de modification (`08g`), ou `null` quand la modale **crée**.
   *
   * Un seul état pour les deux usages : c'est la même modale, et deux drapeaux indépendants
   * permettraient de l'ouvrir en création *et* en édition à la fois.
   */
  const [edition, setEdition] = useState<Database | null>(null)
  /**
   * L'arbre de dossiers, **relu au démarrage** depuis `09b` et reposé par chaque écriture.
   *
   * La boucle du produit : saisir, persister, relire, afficher. Chaque commande de configuration rend
   * l'arbre à jour, donc l'écran et le disque ne peuvent pas diverger.
   */
  const configuration = useConfiguration()
  const [arbre, setArbre] = useState<FolderTree>(ARBRE_VIDE)
  /**
   * La ligne à passer en renommage sur place dans l'écran de travail — le dossier que l'accueil ou
   * `⌘N` vient de créer (#166). Aucune modale ne nomme un objet à sa création : il naît « dossier
   * N », puis se nomme là où il est.
   */
  const [aRenommer, setARenommer] = useState<string | undefined>(undefined)
  /**
   * La connexion qu'« Enregistrer & ouvrir » vient de créer, que l'écran de travail **révèle** —
   * ancêtres dépliés, ligne sélectionnée (#108). Un objet neuf à chaque création : c'est son
   * identité qui relance la révélation, même pour deux créations dans le même dossier.
   */
  const [revelation, setRevelation] = useState<{ connection: ConnectionId } | undefined>(undefined)
  /**
   * Les préférences (`15a`), lues au démarrage avec les projets.
   *
   * **Un état local, alimenté par le disque puis par la commande** — exactement le montage des
   * projets ci-dessus : le disque au démarrage, `save_preferences` ensuite, et c'est elle qui rend
   * la valeur retenue (bornée). Les deux ne peuvent donc pas diverger.
   */
  const [preferences, setPreferences] = useState<Preferences>(PREFERENCES_PAR_DEFAUT)
  /**
   * Les instances managées déclarées (`API-32`), lues avec l'arbre.
   *
   * **Le même montage que l'arbre** : le disque au démarrage, les commandes ensuite, et ce sont
   * elles qui rendent la liste à jour — donc les deux ne peuvent pas diverger. Un état séparé plutôt
   * qu'une feuille de l'arbre : une instance n'appartient à aucun dossier.
   */
  const [instances, setInstances] = useState<ManagedInstance[]>([])
  /**
   * Les kubeconfigs déclarés (`API-70`), lus avec l'arbre.
   *
   * **Le même montage que l'arbre et les instances** : le disque au démarrage, les commandes
   * ensuite, et ce sont elles qui rendent la liste à jour. Un état à part plutôt qu'un champ de
   * `preferences` : une connexion les **référence**, donc ce sont des objets que le modèle désigne,
   * et `save_preferences` passerait par-dessus.
   */
  const [kubeconfigs, setKubeconfigs] = useState<Kubeconfigs>({})
  /**
   * L'instance dont la modale de déclaration est ouverte.
   *
   * `{}` déclare une neuve, `{ instance }` en modifie une — **un seul état pour les deux usages**,
   * comme `edition` pour les connexions : c'est la même modale, et deux drapeaux indépendants
   * permettraient de l'ouvrir en création *et* en édition à la fois.
   */
  const [instanceOuverte, setInstanceOuverte] = useState<{ instance?: ManagedInstance } | null>(
    null,
  )
  /** L'instance dont on confirme le retrait. */
  const [instanceARetirer, setInstanceARetirer] = useState<ManagedInstance | null>(null)
  const [preferencesOuvertes, setPreferencesOuvertes] = useState(false)
  /**
   * La mise à jour que la notification a trouvée, quand c'est elle qui a ouvert les préférences.
   *
   * **Deux états et non un**, parce qu'ils ne disent pas la même chose : `preferencesOuvertes` dit
   * que la modale est là, celui-ci d'où l'on vient. Les fondre ferait que fermer puis rouvrir par
   * l'engrenage rouvrirait sur « Mises à jour » avec un résultat périmé.
   */
  const [majAInstaller, setMajAInstaller] = useState<AvailableUpdate | null>(null)

  /**
   * Ce que `⇧⌘E` et `⇧⌘I` ouvrent (`22a`–`22c`).
   *
   * Les deux entrées du menu natif n'ont pas d'équivalent dans l'interface : le handoff ne
   * maquette aucun bouton d'export, et c'est pour cette raison que `22a` a placé le point
   * d'entrée dans le menu. L'abonnement est posé une seule fois — le repositionner à chaque
   * rendu réarmerait l'écoute en boucle.
   */
  const [dump, setDump] = useState<SensDuDump | null>(null)

  /**
   * Ce que le transfert de projets ouvre (`API-30`).
   *
   * **Un seul état pour tous les points d'entrée** : les deux entrées du menu natif, le bouton
   * d'import de la bande et de l'accueil, et « Exporter le dossier… » dans le menu d'une ligne de
   * dossier (#169) — le seul qui nomme une portée, parce que c'est le seul palier qui la connaisse. Une bande en tête de colonne aurait dû la deviner, comme
   * le pied de la sidebar devait deviner un environnement.
   */
  const [transfert, setTransfert] = useState<DemandeDeTransfert | null>(null)

  useEffect(() => {
    brancherEvenementsDeMenu({
      exporter: () => setDump('export'),
      importer: () => setDump('import'),
      exporterLesProjets: () => setTransfert({ sens: 'export', dossier: null }),
      importerDesProjets: () => setTransfert({ sens: 'import' }),
    })
  }, [])

  // Les projets lus alimentent l'état local, que `08e` met ensuite à jour après chaque
  // enregistrement. Deux sources pour une même liste, mais dans le temps : le disque au
  // démarrage, la commande ensuite — et c'est la commande qui rend la liste à jour, donc les
  // deux ne peuvent pas diverger.
  useEffect(() => {
    if (configuration.kind === 'chargement') return
    setArbre(configuration.tree)
    setPreferences(configuration.preferences)
    setInstances(configuration.instances)
    setKubeconfigs(configuration.kubeconfigs)
  }, [configuration])

  /**
   * Les jetons et le thème, posés **sur la racine du document**.
   *
   * `document.documentElement` et non un conteneur React : `--rowh` doit atteindre la grille,
   * `--accent` la pastille de projet, `--text-code` l'éditeur et les blocs SQL. Les poser composant
   * par composant en oublierait un — et c'est le genre d'oubli qui ne se voit que sur l'écran qu'on
   * n'a pas regardé (`15c`).
   *
   * **Aucun attribut pour « Système »** : sans lui, c'est `prefers-color-scheme` qui décide, donc le
   * thème suit l'OS sans rechargement.
   */
  useEffect(() => {
    const racine = document.documentElement
    const jetons = jetonsDe(preferences)
    for (const [nom, valeur] of Object.entries(jetons)) racine.style.setProperty(nom, valeur)

    const theme = themeApplique(preferences)
    if (theme === null) racine.removeAttribute('data-theme')
    else racine.setAttribute('data-theme', theme)

    // `lang`, pour les technologies d'assistance et le correcteur du système — même résolution
    // que `LanguageProvider`, posée ici plutôt que dans le contexte pour rester avec le thème,
    // l'autre attribut de racine que les préférences gouvernent.
    racine.lang = langueAppliquee(preferences)

    return () => {
      for (const nom of Object.keys(jetons)) racine.style.removeProperty(nom)
      racine.removeAttribute('data-theme')
    }
  }, [preferences])

  /**
   * Applique un réglage : l'écran d'abord, le disque ensuite.
   *
   * **L'écran d'abord**, parce que « les préférences s'appliquent immédiatement » : attendre
   * l'écriture ferait sauter le curseur de densité à chaque mouvement. Le disque rend la valeur
   * **bornée**, qui est reposée — c'est ainsi qu'un curseur poussé trop bas remonte de lui-même.
   */
  const appliquer = async (suivantes: Preferences) => {
    setPreferences(suivantes)
    try {
      setPreferences(await savePreferences(suivantes))
    } catch {
      // Une écriture refusée (fichier en quarantaine) ne doit pas défaire le réglage à l'écran :
      // l'utilisateur verrait son geste annulé sans raison. Le blocage est déjà dit par `09b`.
    }
  }

  /**
   * Écrit la liste des kubeconfigs, et repose ce que le cœur a retenu (`API-70`).
   *
   * **L'écran d'abord, comme pour les préférences** : renommer une déclaration doit se voir à la
   * frappe. Un refus — retirer une déclaration qu'une connexion emploie — **défait** le geste à
   * l'écran, à l'inverse des préférences : là-bas un refus vient d'un fichier en quarantaine et ne
   * dit rien du réglage, ici il dit que ce réglage précis est impossible, et le garder afficherait
   * une liste que le disque ne porte pas.
   */
  const reglerLesKubeconfigs = async (suivants: Kubeconfigs) => {
    const avant = kubeconfigs
    setKubeconfigs(suivants)
    try {
      setKubeconfigs(await saveKubeconfigs(suivants))
    } catch {
      setKubeconfigs(avant)
    }
  }

  /**
   * Ce que l'application sait demander à `kubectl` pour les listes du visage Kubernetes (`API-73`).
   *
   * **Mémoïsé, et ce n'est pas de l'optimisation** : `useCatalogueKubernetes` garde cet objet hors
   * de ses dépendances d'effet précisément parce qu'un appelant peut le reconstruire à chaque rendu
   * — c'est le piège de `10d`, désarmé à la source. Le mémoïser ici est la ceinture, comme la démo
   * mémoïse sa passerelle de transaction : gratuit, et le jour où le hook cesserait de se garder,
   * ce n'est pas une boucle de requêtes authentifiées qu'on veut découvrir en production.
   */
  const catalogueKubernetes = useMemo(
    () => ({
      espacesDeNoms: listKubernetesNamespaces,
      ressources: listKubernetesResources,
    }),
    [],
  )

  /**
   * « Ajouter un fichier… » : choisir un kubeconfig et le déclarer.
   *
   * **Le sélecteur natif n'est pas testable**, même angle mort que « Parcourir… » de la clé privée
   * SSH : l'appel réel vit ici, et les écrans reçoivent la fonction. Renoncer ne déclare rien et ne
   * dit rien — il n'y a ni réussite ni échec à annoncer sur un geste qu'on vient d'annuler.
   */
  const declarerUnKubeconfig = async () => {
    await declarerUnKubeconfigEtRendreSaReference()
  }

  /**
   * Déclare un kubeconfig et **rend sa référence** — ce dont `A2` a besoin pour la choisir.
   *
   * **La même fonction que le bouton des préférences**, à ce retour près : deux voies pour un même
   * acte en laissent une en arrière (règle n° 17), et c'est ici que la liste globale se remplit
   * depuis « Autre fichier… ». La référence est retrouvée **par le chemin** dans la liste rendue,
   * parce que `declarer` dédoublonne par lui : choisir un fichier déjà déclaré rend la déclaration
   * existante, ce qui est le comportement voulu.
   */
  const declarerUnKubeconfigEtRendreSaReference = async (): Promise<string | null> => {
    const chemin = await ouvrirSelecteurDeKubeconfig()
    if (chemin === null) return null
    try {
      const suivants = await declareKubeconfig(chemin)
      setKubeconfigs(suivants)
      const posee = (suivants.declarations ?? []).find(
        (declaration) => declaration.path.trim() === chemin.trim(),
      )
      return posee?.id ?? null
    } catch {
      // Une écriture refusée est déjà dite par le blocage de configuration (`09b`).
      return null
    }
  }

  /**
   * Crée un dossier et rend son identifiant — **le geste de la bande, des menus, de l'accueil et de
   * `⌘N`** (#166). Une seule fonction, parce que deux voies pour un même acte en laissent une en
   * arrière (règle n° 17).
   */
  const creerUnDossier = async (parent: FolderId | null): Promise<FolderId> => {
    const issue = await createFolder({ parent })
    setArbre(issue.tree)
    return issue.folder
  }

  /**
   * Crée un dossier à la racine **et demande son renommage sur place** : c'est ce que font l'accueil
   * et `⌘N`, qui n'ont pas la sidebar sous la main pour s'en charger.
   */
  const creerALaRacine = () => {
    void creerUnDossier(null).then(
      (cree) => setARenommer(idDossier(cree)),
      () => {
        // Un refus de création — un fichier en quarantaine — est déjà dit par le blocage (`09b`).
      },
    )
  }

  useRaccourcisDeCreation({ nouveauDossier: creerALaRacine })

  return (
    <LanguageProvider preferences={preferences}>
      <Sprite />
      {/* **Montées une fois, pour toute l'application.** Elles écoutent le défilement en capture sur
          le document : n'importe quel panneau y a droit sans le savoir, y compris ceux qui n'existent
          pas encore. Voir `BarresDeDefilement` pour la raison de ce choix. */}
      <BarresDeDefilement />
      {Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : configuration.kind ===
        'chargement' ? // Rien pendant la lecture : afficher `A1` (« aucun projet ») ferait clignoter l'écran
      // d'accueil devant un utilisateur qui en a dix. La lecture d'un fichier local est
      // immédiate ; un état de chargement visible serait un scintillement de plus.
      null : WorkbenchDemo ? (
        <Suspense fallback={null}>
          <WorkbenchDemo />
        </Suspense>
      ) : !arbreEstVide(arbre) ? (
        // **L'arbre n'est pas vide : l'écran de travail est le bon écran.** `A1` est l'écran des
        // débuts — « première ouverture, aucun dossier » —, et le laisser devant un utilisateur qui
        // a dix bases ferait de l'accueil une impasse. Un dossier vide suffit : c'est là qu'on
        // déclare sa première connexion.
        <>
          <Workbench
            arbre={arbre}
            onOpenPreferences={() => setPreferencesOuvertes(true)}
            rowHeight={preferences.rowHeight}
            onNewDatabase={(dossier) => setConnexionOuverte({ dossier })}
            onNewFolder={creerUnDossier}
            renommageInitial={aRenommer}
            revelation={revelation}
            onRenameFolder={async (folder, name) => {
              setArbre(await renameFolder({ folder, name }))
            }}
            onRecolorFolder={async (folder, color) => {
              setArbre(await recolorFolder({ folder, color }))
            }}
            onSetFolderIcon={async (folder, icon) => {
              setArbre(await setFolderIcon({ folder, icon }))
            }}
            onSetFolderReadOnly={async (folder, readOnly) => {
              setArbre(await setFolderReadOnly({ folder, readOnly }))
            }}
            // Déplacer (#167) : l'arbre rendu est reposé quand le cœur a déplacé ; une question sur
            // la lecture seule remonte telle quelle, et la sidebar la pose dans « Déplacer vers… ».
            onMove={async (sujet, { destination, index }, confirmed) => {
              const issue =
                sujet.kind === 'folder'
                  ? await moveFolder({
                      folder: sujet.folder,
                      parent: destination,
                      index,
                      confirmed,
                    })
                  : await moveDatabase({
                      connection: sujet.connection,
                      folder: destination,
                      index,
                      confirmed,
                    })
              if (issue.kind === 'moved') setArbre(issue.tree)
              return issue
            }}
            onEditDatabase={setEdition}
            // Les quatre écritures sur les consoles. Elles rendent l'arbre à jour, donc l'écran n'a
            // pas à relire — et l'arbre suit immédiatement.
            onCreateConsole={async (connection, name) => {
              setArbre(await createConsole({ connection, name, sql: null, renameTo: null }))
            }}
            onSaveConsole={async (connection, name, sql) => {
              setArbre(await saveConsole({ connection, name, sql, renameTo: null }))
            }}
            onDeleteConsole={async (connection, name) => {
              setArbre(await deleteConsole({ connection, name, sql: null, renameTo: null }))
            }}
            onRenameConsole={async (connection, name, renameTo) => {
              setArbre(await renameConsole({ connection, name, sql: null, renameTo }))
            }}
            onDelete={async (cible) => {
              const issue =
                cible.kind === 'folder'
                  ? await deleteFolder({ folder: cible.folder })
                  : await retirerLaConnexion({ connection: cible.connection })
              setArbre(issue.tree)
              return issue
            }}
            // Les écritures que l'écran de travail porte lui-même — schémas affichés, libellés de
            // valeurs — rendent l'arbre entier : le reposer ici évite un second aller-retour.
            onArbre={setArbre}
            instances={instances}
            onDeclareInstance={() => setInstanceOuverte({})}
            onEditInstance={(instance) => setInstanceOuverte({ instance })}
            onRemoveInstance={setInstanceARetirer}
            /* **Le troisième chemin vers l'import**, après le menu natif et l'écran d'accueil — et
               le seul que voit quelqu'un qui a déjà des dossiers. Voir `ExplorerSidebar`, qui porte
               la raison : un chemin unique dans un menu natif n'a été trouvé par personne. */
            onImportProjects={() => setTransfert({ sens: 'import' })}
            // « Exporter le dossier… » (#169) : le seul point d'entrée qui nomme une portée.
            onExportFolder={(id, nom) => setTransfert({ sens: 'export', dossier: { id, nom } })}
            // Le renommage d'une connexion (`26`) : l'arbre rendu est reposé tel quel.
            onRenameDatabase={async (connection, name) => {
              setArbre(await renommerLaConnexion({ connection, name }))
            }}
          />
          {dump && <DumpDialogs sens={dump} arbre={arbre} onClose={() => setDump(null)} />}
          {/* **Les deux modales d'instance, dans la branche de l'écran de travail** (`API-32`).
              Contrairement aux préférences et au parcours de création, le geste n'existe **que** là :
              la zone d'instances vit sous l'arbre, et l'écran d'accueil n'a pas de sidebar. Les
              monter plus haut ferait exister un état que rien ne pourrait déclencher — l'inverse du
              défaut n° 89, et tout aussi faux. */}
          {instanceOuverte !== null && (
            <NewInstance
              {...(instanceOuverte.instance === undefined
                ? {}
                : { edition: instanceOuverte.instance })}
              kubeconfigs={kubeconfigs}
              onDeclareKubeconfig={declarerUnKubeconfigEtRendreSaReference}
              catalogueKubernetes={catalogueKubernetes}
              onClose={() => setInstanceOuverte(null)}
              onEnregistrer={async (requete) => {
                setInstances(
                  await saveInstance({
                    id: requete.id,
                    label: requete.label,
                    engine: requete.engine,
                    connection: {
                      host: requete.host,
                      port: requete.port,
                      defaultDatabase: requete.defaultDatabase,
                      username: requete.username,
                      // **`null` toujours** : la référence du secret est posée par le cœur, jamais
                      // par l'écran — lui laisser composer la chaîne dupliquerait la convention, et
                      // une convention dupliquée diverge (`08e`).
                      password: null,
                      sslMode: requete.sslMode,
                      caCertificate: null,
                      authDatabase: null,
                      // Une connexion d'administration n'est **jamais** en lecture seule : tout ce
                      // que cet écran fait est d'écrire. Le garde-fou est ailleurs — la confirmation
                      // qui montre le SQL.
                      readOnly: false,
                      reconnectOnStartup: requete.reconnectOnStartup,
                      tunnel: requete.tunnel,
                    },
                    production: requete.production,
                    confirmWrites: requete.confirmWrites,
                    password: requete.password,
                  }),
                )
              }}
            />
          )}
          {instanceARetirer !== null && (
            <DeleteInstanceDialog
              instance={instanceARetirer}
              onClose={() => setInstanceARetirer(null)}
              onRetirer={async () => {
                const issue = await deleteInstance(instanceARetirer.id)
                setInstances(issue.instances)
                return issue.secretResiduel
              }}
            />
          )}
          {(connexionOuverte !== null || edition) && (
            <NewConnection
              onClose={() => {
                setConnexionOuverte(null)
                setEdition(null)
              }}
              arbre={arbre}
              edition={edition ?? undefined}
              /* **Le dossier est le cadre de la modale** (26 août 2026, puis #166), jamais un champ :
                 il vient de la ligne d'arbre d'où part le geste. En édition, c'est celui qui contient
                 la connexion modifiée — `NewConnection` le lit sur l'arbre. */
              dossier={connexionOuverte?.dossier ?? null}
              kubeconfigs={kubeconfigs}
              onDeclareKubeconfig={declarerUnKubeconfigEtRendreSaReference}
              catalogueKubernetes={catalogueKubernetes}
              onSaved={(suivant, creee) => {
                setArbre(suivant)
                if (creee !== undefined) setRevelation({ connection: creee })
              }}
            />
          )}
        </>
      ) : (
        <>
          <WelcomeScreen
            // **`A1` crée un dossier** (#166) — le même geste que la bande de tête de l'arbre. Le
            // parcours en deux étapes (projet, puis connexion) est parti avec les projets : le
            // dossier naît « dossier 1 », l'écran de travail prend la place de l'accueil, et la
            // ligne passe en renommage sur place.
            onNewFolder={creerALaRacine}
            // **`A1` a un engrenage, donc il doit ouvrir quelque chose.** La modale est montée
            // au-dessus du choix de l'écran pour cette raison exactement.
            onOpenPreferences={() => setPreferencesOuvertes(true)}
            /* **L'import depuis l'écran des débuts** (`API-30`) : c'est là qu'on en a le plus besoin
               — un second poste, aucun dossier, et rien à l'écran qui dise qu'un fichier peut en
               apporter. La modale est la même que celle des deux autres chemins. */
            onImportProjects={() => setTransfert({ sens: 'import' })}
            folderCount={arbre.folders.length}
            dimmed={connexionOuverte !== null}
          />
        </>
      )}
      {/* **Au niveau de l'application, et c'est un défaut corrigé** (`API-30`, 17 septembre 2026).
          Elle était montée dans la branche de l'écran de travail, donc `transfert` se posait sans
          que rien ne paraisse dès que la configuration était vide : « Importer des projets… » du
          menu natif **ne faisait rien** sur `A1`, c'est-à-dire exactement là où l'on importe — un
          second poste, aucun projet. C'est le défaut de l'engrenage d'`A1` du 26 août 2026, à la
          lettre, et l'écran d'accueil en porte désormais le bouton, ce qui l'aurait rendu visible
          de toute façon. La règle qui en sort est celle que les préférences énoncent juste en
          dessous : **une modale atteignable depuis deux écrans se monte au-dessus des deux**. */}
      {transfert && (
        <TransferDialogs
          demande={transfert}
          total={arbre.folders.length}
          onClose={() => setTransfert(null)}
          /* L'arbre rendu est **reposé**, comme après chaque écriture de configuration :
             c'est ce changement qui fait relire les états du registre et purger le cache de
             l'arbre. La modale reste ouverte pour montrer son rapport. */
          onImported={setArbre}
        />
      )}
      {/* **Au niveau de l'application, pas de l'écran de travail.** Les préférences règlent des
          jetons de la racine et des garde-fous globaux : les monter dans `Workbench` les rendrait
          inaccessibles depuis `A1`, où l'engrenage existe aussi. */}
      {preferencesOuvertes && (
        <PreferencesDialog
          preferences={preferences}
          onChange={appliquer}
          onClose={() => {
            setPreferencesOuvertes(false)
            setMajAInstaller(null)
          }}
          version={VERSION_AFFICHEE}
          kubeconfigs={kubeconfigs}
          onKubeconfigsChange={(suivants) => void reglerLesKubeconfigs(suivants)}
          onDeclarerKubeconfig={declarerUnKubeconfig}
          arbre={arbre}
          instances={instances}
          {...(majAInstaller === null
            ? {}
            : { sectionInitiale: 'maj' as const, majDejaTrouvee: majAInstaller })}
        />
      )}
      {/* **Montée ici, une seule fois, et hors des deux branches d'écran** (2 septembre 2026). Elle
          a d'abord été une ligne des barres d'état, ce qui la faisait dépendre de l'écran affiché :
          absente d'un onglet de console, qui n'a aucune barre au niveau de l'écran, et présente sur
          l'accueil, où elle se lisait comme une invitation glissée sous le compte de projets. Au
          niveau de l'application, elle ne dépend plus d'aucune composition.

          Elle n'installe rien : elle mène à la section « Mises à jour » d'`A10`, en lui passant la
          recherche qu'elle vient de faire. */}
      <AnnonceMiseAJour
        onInstaller={(maj) => {
          setMajAInstaller(maj)
          setPreferencesOuvertes(true)
        }}
      />
    </LanguageProvider>
  )
}

/**
 * La version affichée en pied des préférences.
 *
 * Lue de `package.json` **à la construction** par Vite, et non écrite à la main : une version en dur
 * cesse d'être vraie à la publication suivante, et personne ne penserait à la corriger.
 *
 * L'architecture est celle de la machine qui exécute — `arm64` sur un Mac Apple Silicon, `x86_64`
 * sinon. `navigator.userAgent` ne la donne pas de façon fiable dans un WKWebView ; le mot vient donc
 * de ce que Vite a construit.
 */
const VERSION_AFFICHEE = `DoraBase ${__APP_VERSION__} (${__APP_ARCH__})`
