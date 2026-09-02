import { lazy, Suspense, useEffect, useState } from 'react'
import {
  createConsole,
  deleteConsole,
  renameConsole,
  saveConsole,
  savePreferences,
} from '../data/commandes'
import { useConfiguration } from '../data/useConfiguration'
import { Sprite } from '../design/icons/Sprite'
import type { Database, EnvironmentId, Preferences, Project } from '../domain/config'
import type { AvailableUpdate } from '../domain/maj'
import { LanguageProvider, langueAppliquee } from '../i18n/LanguageContext'
import { DumpDialogs, type SensDuDump } from '../screens/Dump/DumpDialogs'
import {
  renommerLaConnexion,
  renommerLeProjet,
  retirerLaConnexion,
  retirerLeProjet,
} from '../screens/NewConnection/enregistrerLaBase'
import { NewConnection } from '../screens/NewConnection/NewConnection'
import { ParcoursDeCreation } from '../screens/NewProject/ParcoursDeCreation'
import { PreferencesDialog } from '../screens/Preferences/PreferencesDialog'
import { jetonsDe, PREFERENCES_PAR_DEFAUT, themeApplique } from '../screens/Preferences/preferences'
import { WelcomeScreen } from '../screens/Welcome/WelcomeScreen'
import { Workbench } from '../screens/Workbench/Workbench'
import { AnnonceMiseAJour } from '../shell/AnnonceMiseAJour/AnnonceMiseAJour'
import { useClicDroitDesactive } from '../shell/useClicDroit'
import { useZoom } from '../shell/useZoom'
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
  // Le zoom au geste, à pas fin — sous Tauri seulement, la webview étant ce qui zoome.
  useZoom()
  // Le menu contextuel du moteur de rendu, remplacé par le silence : nos menus s'ouvrent eux-mêmes.
  useClicDroitDesactive()

  /**
   * La déclaration d'une connexion est ouverte, et **sur quoi** (26 août 2026).
   *
   * Un objet plutôt qu'un booléen, et ses deux champs **obligatoires** : le geste ne part plus que du
   * menu d'une ligne d'environnement, qui sait de quel projet et de quel environnement il s'agit. Le
   * raccourci `⇧⌘N` était le seul appelant à ne rien désigner, et il a été retiré — c'est ce qui
   * permet au type de refuser l'ignorance plutôt que de la traiter.
   */
  const [connexionOuverte, setConnexionOuverte] = useState<{
    project: string
    environment: EnvironmentId
  } | null>(null)
  /**
   * Le parcours de création est ouvert (`24d`).
   *
   * **Deux états distincts, non un mode d'un seul** : « ajouter une connexion » et « nouveau projet »
   * sont deux gestes, et les confondre ramènerait la sentinelle du sélecteur que `24c` a retirée.
   */
  const [projetOuvert, setProjetOuvert] = useState<{ raison?: string } | null>(null)
  /**
   * La base en cours de modification (`08g`), ou `null` quand la modale **crée**.
   *
   * Un seul état pour les deux usages : c'est la même modale, et deux drapeaux indépendants
   * permettraient de l'ouvrir en création *et* en édition à la fois.
   */
  const [edition, setEdition] = useState<{ project: string; database: Database } | null>(null)
  /**
   * Les projets connus, **relus au démarrage** depuis `09b`.
   *
   * La boucle du produit est désormais complète : saisir (`08e`), persister, relire, afficher.
   * `load_config` existait depuis `05b` et n'était appelée par personne — une base enregistrée
   * était bien écrite sur le disque mais jamais retrouvée au lancement suivant.
   */
  const configuration = useConfiguration()
  const [projects, setProjects] = useState<Project[]>([])
  /**
   * Les préférences (`15a`), lues au démarrage avec les projets.
   *
   * **Un état local, alimenté par le disque puis par la commande** — exactement le montage des
   * projets ci-dessus : le disque au démarrage, `save_preferences` ensuite, et c'est elle qui rend
   * la valeur retenue (bornée). Les deux ne peuvent donc pas diverger.
   */
  const [preferences, setPreferences] = useState<Preferences>(PREFERENCES_PAR_DEFAUT)
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

  useEffect(() => {
    brancherEvenementsDeMenu({
      exporter: () => setDump('export'),
      importer: () => setDump('import'),
    })
  }, [])

  // Les projets lus alimentent l'état local, que `08e` met ensuite à jour après chaque
  // enregistrement. Deux sources pour une même liste, mais dans le temps : le disque au
  // démarrage, la commande ensuite — et c'est la commande qui rend la liste à jour, donc les
  // deux ne peuvent pas diverger.
  useEffect(() => {
    if (configuration.kind === 'chargement') return
    setProjects(configuration.projects)
    setPreferences(configuration.preferences)
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

  useRaccourcisDeCreation({ nouveauProjet: () => setProjetOuvert({}) })

  /**
   * Les projets sous la forme que les écrans de création attendent.
   *
   * **Calculée une fois** : l'expression était recopiée à chaque point de montage, et une recopie qui
   * oublie un champ ne se voit qu'à l'écran concerné.
   */
  const projetsPourLesEcrans = projects.map((projet) => ({
    id: projet.name,
    name: projet.name,
    // Ses environnements déclarés : c'est ce que `A2` propose (`23d`).
    environments: projet.environments,
  }))

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
      ) : projects.length > 0 ? (
        // **Un projet existe : l'écran de travail est le bon écran.** `A1` est l'écran des
        // débuts — `07` le décrit comme « première ouverture, aucun projet » — et le laisser
        // devant un utilisateur qui a dix bases ferait de l'accueil une impasse. C'est aussi ce
        // qui rend `A4` atteignable : jusqu'ici, rien ne le montait.
        <>
          <Workbench
            projects={projects}
            onOpenPreferences={() => setPreferencesOuvertes(true)}
            rowHeight={preferences.rowHeight}
            onNewDatabase={setConnexionOuverte}
            onNewProject={() => setProjetOuvert({})}
            onEditDatabase={(project, database) => setEdition({ project, database })}
            // Le renommage rend les projets à jour : les reposer ici évite un second aller-retour,
            // et supprime la fenêtre pendant laquelle l'arbre montrerait l'ancien nom.
            // Les quatre écritures sur les consoles. Elles rendent les projets à jour, donc l'écran
            // n'a pas à relire — et l'arbre suit immédiatement.
            onCreateConsole={async (project, database, environment, name) => {
              setProjects(
                await createConsole({
                  project,
                  database,
                  environment,
                  name,
                  sql: null,
                  renameTo: null,
                }),
              )
            }}
            onSaveConsole={async (project, database, environment, name, sql) => {
              setProjects(
                await saveConsole({ project, database, environment, name, sql, renameTo: null }),
              )
            }}
            onDeleteConsole={async (project, database, environment, name) => {
              setProjects(
                await deleteConsole({
                  project,
                  database,
                  environment,
                  name,
                  sql: null,
                  renameTo: null,
                }),
              )
            }}
            onRenameConsole={async (project, database, environment, name, renameTo) => {
              setProjects(
                await renameConsole({
                  project,
                  database,
                  environment,
                  name,
                  sql: null,
                  renameTo,
                }),
              )
            }}
            onDelete={async (cible) => {
              const issue =
                cible.kind === 'project'
                  ? await retirerLeProjet({ project: cible.project })
                  : await retirerLaConnexion({
                      project: cible.project,
                      database: cible.database,
                      environment: cible.environment,
                    })
              setProjects(issue.projects)
              return issue
            }}
            // Les cinq gestes de `23c` rendent la liste entière : la reposer ici évite un second
            // aller-retour, et supprime la fenêtre pendant laquelle l'arbre montrerait l'ancien état.
            onProjets={setProjects}
            onRenameProject={async (project, nom) => {
              const issue = await renommerLeProjet({ project, name: nom })
              setProjects(issue.projects)
              return issue
            }}
            // Le renommage d'une connexion (`26`) : la liste rendue est reposée telle quelle, comme
            // pour le projet — l'arbre montre le nouveau nom sans second aller-retour.
            onRenameDatabase={async (project, database, environment, nouveau) => {
              const issue = await renommerLaConnexion({
                project,
                database,
                environment,
                name: nouveau,
              })
              setProjects(issue.projects)
              return issue
            }}
          />
          {dump && <DumpDialogs sens={dump} projects={projects} onClose={() => setDump(null)} />}
          {(connexionOuverte !== null || edition) && (
            <NewConnection
              onClose={() => {
                setConnexionOuverte(null)
                setEdition(null)
              }}
              projects={projetsPourLesEcrans}
              edition={edition ?? undefined}
              /* **Le projet est le cadre de la modale** (26 août 2026), plus un champ à choisir : il
                 vient de la ligne d'arbre d'où part le geste, toujours. Le repli sur « le premier
                 projet de la liste » a disparu avec `⇧⌘N`, seul chemin qui ne désignait rien : plus
                 aucun appelant ne laisse ce cadre à deviner.

                 La chaîne vide reste pour le mode **édition**, où le projet qui fait foi est celui de
                 la base modifiée — `NewConnection` le lit sur `edition`. */
              projet={connexionOuverte?.project ?? ''}
              {...(connexionOuverte === null
                ? {}
                : { environnement: connexionOuverte.environment })}
              onSaved={setProjects}
            />
          )}
        </>
      ) : (
        <>
          {/* **Le bouton dit « Nouveau projet », et ouvre « Nouveau projet »** (`24d`). Il ouvrait la
              modale de connexion : ce n'était pas une erreur d'assemblage — `08f` créait le projet au
              passage, par une entrée du sélecteur — mais le geste s'est inversé, et l'écran de
              création existe désormais. */}
          <WelcomeScreen
            // **`A1` mène à l'étape 1**, non à la modale de connexion (`24d`). Le bouton disait
            // « Nouveau projet » et ouvrait « Nouvelle connexion » : ce n'était pas une erreur
            // d'assemblage — `08f` créait le projet au passage — mais le geste s'est inversé.
            onNewProject={() => setProjetOuvert({})}
            // **`A1` a un engrenage, donc il doit ouvrir quelque chose.** La modale est montée
            // au-dessus du choix de l'écran pour cette raison exactement.
            onOpenPreferences={() => setPreferencesOuvertes(true)}
            projectCount={projects.length}
            dimmed={connexionOuverte !== null || projetOuvert !== null}
          />
        </>
      )}
      {/* **Monté hors des deux branches** — et c'est un défaut corrigé, non un rangement : le parcours
          ne vivait que dans la branche `A1`, si bien que « Nouveau projet » au pied de la sidebar de
          `A4` appelait un état que rien n'écoutait. Le geste existe sur les deux écrans (`24d`), donc
          la modale doit vivre au-dessus du choix de l'écran — la raison même qui met les préférences
          ici. */}
      {projetOuvert !== null && (
        <ParcoursDeCreation
          depart={{
            etape: 'projet',
            ...(projetOuvert.raison === undefined ? {} : { raison: projetOuvert.raison }),
          }}
          projets={projetsPourLesEcrans}
          onClose={() => setProjetOuvert(null)}
          onProjets={setProjects}
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
