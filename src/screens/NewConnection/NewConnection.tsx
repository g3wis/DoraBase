import { useEffect, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type {
  Database,
  Engine,
  EnvironmentDeclaration,
  EnvironmentId,
  Project,
  UpdateVariantRequest,
} from '../../domain/config'
import type { ConnectionRequest, ConnectionTest } from '../../domain/engine'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { Stepper } from '../../ui/Stepper/Stepper'
import {
  type ConnectionDraft,
  draftDepuisLaVariante,
  emptyDraft,
  emptyTunnel,
  type ProxyDraft,
  type ProxyKind,
} from './ConnectionDraft'
import { ConnectionFailure } from './ConnectionFailure'
import { ConnectionForm } from './ConnectionForm'
import { draftToRequest } from './draftToRequest'
import { EngineSelector } from './EngineSelector'
import { ENGINES, IMPLEMENTED_ENGINES, modeSslPourLeMoteur, portSuivant } from './engines'
import {
  draftToSaveRequest,
  draftToUpdateRequest,
  enregistrerLaBase,
  mettreAJourLaVariante,
} from './enregistrerLaBase'
import styles from './NewConnection.module.css'
import { ouvrirSelecteurDeCle } from './ouvrirSelecteurDeCle'
import { TunnelPanel } from './TunnelPanel'
import { codeDe, messageDe, testerLaConnexion } from './testerLaConnexion'

type NewConnectionProps = {
  onClose: () => void
  /** Les projets existants. Vide, l'enregistrement sera refusé par `08e`. */
  projects?: readonly {
    id: string
    name: string
    /** Ses environnements déclarés, que `A2` propose (`23d`). */
    environments: readonly EnvironmentDeclaration[]
  }[]
  /**
   * Ouvre le sélecteur de fichier de la clé privée.
   *
   * Injecté pour que le câblage du bouton « Parcourir… » soit testable : le plugin `dialog`
   * ne répond pas hors de la webview, donc sous Vitest l'appel réel rejetterait. Par défaut,
   * c'est l'appel réel.
   */
  onBrowseKey?: () => Promise<string | null>
  /** Le sélecteur du fichier de compte de service Google, injecté pour la même raison. */
  /**
   * Appelle la commande `test_connection`.
   *
   * Injecté pour la même raison que `onBrowseKey` : le pont IPC ne répond pas hors de la
   * webview. Ce qui est testé ici est le **câblage** — l'état d'attente, l'affichage du
   * résultat, la sous-modale d'échec. Le pont lui-même s'observe dans l'app réelle, et un test
   * Vitest qui simulerait `invoke` ne vérifierait que le simulacre.
   */
  onTest?: (request: ConnectionRequest) => Promise<ConnectionTest>
  /** Appelle la commande `save_database`. Injectée pour la même raison que `onTest`. */
  onSave?: (request: ReturnType<typeof draftToSaveRequest>) => Promise<Project[]>
  /**
   * Le projet dans lequel la connexion se déclare. **Toujours connu, jamais choisi ici**
   * (26 août 2026, à la demande).
   *
   * Il vivait dans le formulaire, sous une étiquette « Projet », dans un sélecteur qui proposait d'en
   * changer. Or changer de projet dans ce formulaire n'a jamais voulu dire ce que le contrôle laissait
   * croire : le triplet `projet/base/environnement` est la clé du registre et la référence du secret,
   * et déplacer une connexion d'un projet à l'autre est un geste qui **n'existe pas** — la
   * confirmation de suppression se garde déjà de le proposer.
   *
   * Le projet est donc le **cadre** du formulaire, non un de ses champs, et il s'annonce en tête de la
   * modale. En édition, c'est celui de la base modifiée, qui fait foi.
   *
   * En création, l'appelant le désigne : le menu d'une ligne d'environnement le connaît, le parcours de
   * création vient de le créer.
   */
  projet?: string
  /**
   * L'environnement préréglé, quand l'appelant le connaît (26 août 2026).
   *
   * Le menu d'une ligne d'environnement le connaît. Absent, le brouillon prend `dev` — le moins
   * risqué. Le groupe de radios reste là : l'environnement, lui, est bien un champ de la connexion.
   */
  environnement?: EnvironmentId
  /**
   * Vrai quand cet écran est **l'étape 2 du parcours de création** (`24c`).
   *
   * La bande de progression paraît, « Annuler » devient « Plus tard » — à ce moment, « Annuler »
   * mentirait, le projet étant déjà créé — et la phrase du pied dit ce qu'il advient de lui.
   *
   * **Distinct de « le projet est connu »**, qu'il était jusqu'ici sous le nom `projetImpose` : le
   * projet est désormais *toujours* connu, et confondre les deux faisait paraître une bande de
   * progression à deux étapes devant quelqu'un qui n'en avait franchi aucune.
   */
  venantDuParcours?: boolean
  /**
   * La base à modifier (`08g`). Absente, la modale **crée**.
   *
   * Le même formulaire sert les deux : `A2` porte déjà tous les champs, et un second écran en
   * dupliquerait la mise en page — donc la dérive au premier changement du handoff.
   */
  edition?: { project: string; database: Database }
  /** Appelle la commande `update_variant` (`08g`). */
  onUpdate?: (request: UpdateVariantRequest) => Promise<Project[]>
  /** Appelé après un enregistrement réussi, avec les projets à jour. */
  onSaved?: (projects: Project[]) => void
}

/**
 * L'issue du test de connexion.
 *
 * **Quatre états, pas deux.** Le mockup montre le succès (`A2`) et l'échec (`A3`), et il manque
 * l'attente : un test vers un hôte injoignable prend jusqu'à 30 secondes (`06e` a posé ce
 * délai). Sans état d'attente, le bouton semble mort et l'utilisateur reclique.
 */
type EtatDuTest =
  | { phase: 'jamais' }
  | { phase: 'en-cours' }
  | { phase: 'reussi'; resultat: ConnectionTest }
  | { phase: 'echoue'; message: string; code: string | null; viaTunnel: boolean }

/**
 * `A2` — la modale de nouvelle connexion.
 *
 * **Aucun comportement dans ce scope.** « Tester la connexion » vient en `08d`,
 * « Enregistrer & ouvrir » en `08e`, et le panneau proxy / tunnel en `08c`. Les trois
 * boutons du pied sont présents et inertes, comme ceux de `A1` l'ont été jusqu'ici — un
 * bouton absent ferait croire que la fonction n'est pas prévue.
 */
/**
 * La variante à modifier — la **première** de la base.
 *
 * Une base peut en avoir trois (`dev`, `staging`, `prod`), et le menu de la pastille n'en désigne
 * qu'une : celle de l'environnement actif du projet. Ce scope modifie donc la variante qui
 * correspond, ou la première à défaut. Choisir laquelle éditer quand il y en a plusieurs appartient
 * à l'écran « Bases du projet » de `A10`.
 */
/**
 * Les réglages à éditer.
 *
 * **Il n'y a plus de choix à faire** (`23b`) : une connexion porte un seul jeu de réglages. Cette
 * fonction prenait la première variante « ou celle qui correspond », et le commentaire d'origine
 * renvoyait le vrai choix à un écran « Bases du projet ». Le modèle a tranché à sa place.
 */
function varianteCible(edition: { database: Database }) {
  return edition.database.connection
}

export function NewConnection({
  onClose,
  projects = [],
  onBrowseKey = ouvrirSelecteurDeCle,
  onTest = testerLaConnexion,
  onSave = enregistrerLaBase,
  edition,
  onUpdate = mettreAJourLaVariante,
  onSaved,
  projet,
  environnement,
  venantDuParcours = false,
}: NewConnectionProps) {
  /**
   * Le projet qui fait foi.
   *
   * **En édition, celui de la base**, jamais celui qu'on aurait passé à côté : la base modifiée dit
   * dans quel projet elle vit, et deux sources pour un même nom finiraient par se contredire.
   */
  const projetCourant = edition?.project ?? projet ?? ''
  // En mode édition, le brouillon part des réglages enregistrés. `useState` avec initialiseur : le
  // recalculer à chaque rendu écraserait la saisie en cours.
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    edition
      ? draftDepuisLaVariante(edition.project, edition.database, varianteCible(edition))
      : {
          ...emptyDraft(),
          // Le projet du brouillon **est** celui du cadre : plus personne ne peut le changer, donc il
          // n'a plus à être aligné après coup — c'est tout l'effet qui suivait, et il disparaît.
          project: projetCourant,
          ...(environnement === undefined ? {} : { environment: environnement }),
        },
  )
  // Le panneau proxy est replié à l'ouverture : le mockup le montre déplié, mais il y montre
  // aussi un tunnel configuré. Pour une connexion neuve, déplier un bloc vide de cinq champs
  // pousserait vers le bas ce que l'utilisateur doit remplir d'abord.
  const [tunnelOuvert, setTunnelOuvert] = useState(false)
  /**
   * La sorte de proxy **affichée** par le panneau.
   *
   * En état local et non dans le brouillon, parce qu'elle existe avant tout proxy : changer le
   * « Type » sans rien saisir ne déclare rien, donc `draft.tunnel` reste `null` et n'a nulle
   * part où ranger ce choix. Une fois un proxy déclaré, c'est `draft.tunnel.proxy.kind` qui fait
   * foi — les deux sont tenus égaux par `changerSorte`.
   */
  const [sorteProxy, setSorteProxy] = useState<ProxyKind>('ssh')
  const [test, setTest] = useState<EtatDuTest>({ phase: 'jamais' })
  // La sous-modale de `A3` se ferme sans effacer l'échec : le pied garde son message et
  // « Retester », ce que le handoff montre explicitement.
  const [echecOuvert, setEchecOuvert] = useState(false)
  const [enregistrement, setEnregistrement] = useState<
    { phase: 'jamais' } | { phase: 'en-cours' } | { phase: 'refuse'; message: string }
  >({ phase: 'jamais' })

  function patch(changes: Partial<ConnectionDraft>) {
    setDraft((previous) => ({ ...previous, ...changes }))
  }

  /*
   * **L'effet qui alignait le brouillon sur le sélecteur a disparu** (26 août 2026), avec le
   * sélecteur : il n'y a plus de contrôle capable d'afficher un projet que l'état ne porte pas —
   * c'était « le piège du select contrôlé », dont l'enregistrement visait un projet inexistant. Le
   * projet du brouillon vient du cadre, une fois, à l'initialisation.
   */

  /**
   * Toucher un champ du panneau **crée** le proxy s'il n'existe pas.
   *
   * L'utilisateur qui saisit un bastion déclare par là qu'il en veut un ; lui demander de cocher
   * une case en plus serait une étape que le handoff ne maquette pas. `05a` garde l'absence
   * représentable (`Option<Tunnel>`), et c'est ce qui compte : `06b` refuse une variante
   * déclarant un proxy qu'on n'a pas ouvert.
   */
  /**
   * Changer de moteur emmène le port **et le mode SSL** avec lui.
   *
   * **Le port par défaut appartient au moteur, pas au formulaire** : `5432` devant une connexion
   * MySQL échoue à l'ouverture sans dire pourquoi, et le champ est le dernier endroit où l'on
   * regarderait. `portSuivant` tranche le seul cas ambigu — un port saisi à la main reste.
   *
   * **Le mode SSL suit pour une raison différente, et c'est ce qui justifie une seule fonction pour
   * les deux.** Les moteurs n'expriment pas les mêmes modes — `allow` et `prefer` demandent une
   * négociation que seul PostgreSQL a dans son protocole. Laisser le brouillon sur `prefer` en
   * passant à MongoDB donnerait une liste déroulante dont la valeur n'est aucune de ses options : le
   * piège du sélecteur contrôlé, déjà rencontré sur le projet. `modeSslPourLeMoteur` remonte au mode
   * offert le plus proche **vers le haut**, donc la liste affiche ce qui s'appliquera — le contraire
   * de la promotion silencieuse qu'on retire.
   *
   * **Deux transitions séparées seraient un défaut**, pas une maladresse : le port suivant se calcule
   * sur le moteur *précédent*, donc `setDraft` une seule fois, et non `patch` deux fois.
   */
  function changerMoteur(engine: Engine) {
    setDraft((precedent) => ({
      ...precedent,
      engine,
      port: portSuivant(precedent.engine, precedent.port, engine),
      sslMode: modeSslPourLeMoteur(engine, precedent.sslMode),
    }))
  }

  function changerProxy(proxy: ProxyDraft) {
    setDraft((previous) => ({
      ...previous,
      // `localPort` est conservé s'il existait : il vient de l'ouverture, pas de la saisie.
      tunnel: { localPort: previous.tunnel?.localPort ?? null, proxy },
    }))
  }

  /**
   * Changer le « Type » remet à zéro les champs de l'autre sorte.
   *
   * **Par nécessité, pas par hygiène** : `05d` a fait de `Proxy` une union, donc `08e` ne peut
   * pas convertir un brouillon portant un bastion **et** une instance. Garder les champs « au
   * cas où l'utilisateur revienne » obligerait la conversion à choisir, c'est-à-dire à deviner.
   *
   * Sans proxy déclaré, **seule la sorte affichée change** : choisir un type n'est pas déclarer
   * un proxy, et faire apparaître « Cloud SQL activé » sur une instance vide serait une fausse
   * déclaration.
   */
  function changerSorte(kind: ProxyKind) {
    setSorteProxy(kind)
    setDraft((previous) =>
      previous.tunnel ? { ...previous, tunnel: emptyTunnel(kind) } : previous,
    )
  }

  /**
   * Les environnements déclarés par le projet du cadre (`23d`).
   *
   * **Calculés ici, et passés tout faits au formulaire.** Le formulaire les cherchait lui-même sur
   * `projetImpose ?? draft.project`, et l'oubli du premier terme avait rendu le groupe vide à l'étape 2
   * — on ne pouvait plus déclarer de connexion. Une recherche en moins est un oubli en moins.
   */
  const environnementsDuProjet =
    // **Par le nom, et non par l'`id`.** Un projet est identifié par son nom (`05a`) : c'est ce que
    // porte la ligne d'arbre, ce que la requête d'enregistrement envoie, et ce que l'en-tête affiche.
    // L'`id` du sélecteur était le seul endroit où les deux se distinguaient, et le sélecteur est
    // parti.
    projects.find((candidat) => candidat.name === projetCourant)?.environments ?? []

  const engineImplemented = IMPLEMENTED_ENGINES.includes(draft.engine)

  async function lancerLeTest() {
    setTest({ phase: 'en-cours' })
    const viaTunnel = draft.tunnel !== null
    try {
      const resultat = await onTest(draftToRequest(draft))
      setTest({ phase: 'reussi', resultat })
    } catch (cause) {
      setTest({ phase: 'echoue', message: messageDe(cause), code: codeDe(cause), viaTunnel })
      setEchecOuvert(true)
    }
  }

  // « Enregistrer & ouvrir » est désactivé **après un échec de test**, et réactivé après un
  // succès. Pas désactivé avant tout test : rien n'oblige à tester pour enregistrer, et le
  // handoff ne le demande pas.
  //
  // Il est aussi désactivé **sans aucun projet** : `A2` déclare une base *dans un projet
  // existant*, et le handoff ne maquette pas le parcours d'un utilisateur qui n'en a aucun.
  // Le handoff ne maquettait pas le parcours d'un utilisateur sans aucun projet.
  // **Il est de nouveau désactivé faute de projet**, et c'est le retour de la garde de `08e` : cet
  // écran ne sait plus créer de projet (`24c`), donc sans projet il n'a rien où enregistrer. Le cas
  // ne se produit plus dans l'application — `24d` renvoie vers l'étape 1 — mais la garde reste : un
  // appelant qui l'oublierait verrait un refus, non un enregistrement dans le vide.
  // **Sans projet, rien à enregistrer.** La garde de `08e` reste, sous une autre forme : le cadre est
  // désormais une chaîne, et c'est son vide qui dit qu'aucun projet n'a été désigné. Le cas ne se
  // produit plus dans l'application — `24d` renvoie vers l'étape 1 — mais un appelant qui l'oublierait
  // verrait un refus, non un enregistrement dans le vide.
  const sansProjet = projetCourant === ''
  const enregistrementBloque =
    test.phase === 'echoue' || sansProjet || enregistrement.phase === 'en-cours'

  async function enregistrer() {
    if (enregistrementBloque) return
    setEnregistrement({ phase: 'en-cours' })
    try {
      if (edition) {
        // **Mise à jour, pas enregistrement** : `save_database` refuserait une base déjà là, et
        // c'est cette garde qui protège d'un écrasement par mégarde.
        const projets = await onUpdate(
          draftToUpdateRequest(draft, {
            project: edition.project,
            database: edition.database.name,
            environment: edition.database.environment,
          }),
        )
        onSaved?.(projets)
        onClose()
        return
      }
      // **Cet écran ne crée plus de projet** (`24c`). Il en créait un au passage, par la sentinelle
      // du sélecteur : deux commandes pour un geste. Le projet est désormais créé par l'étape 1, et
      // arrive ici dans le cadre — une seule commande, un seul acte.
      const projets = await onSave(draftToSaveRequest({ ...draft, project: projetCourant }))
      onSaved?.(projets)
      // La modale se ferme : `08e` § Hors périmètre — « ouvrir » veut dire aller vers `A4`,
      // qui n'existe pas avant `09`. Ce scope enregistre et ferme ; `09` branchera la
      // navigation. Dit ici pour qu'un lecteur ne cherche pas le bug.
      onClose()
    } catch (cause) {
      // Le refus s'affiche là où `08d` affiche déjà les échecs : le message inline du pied.
      // `A2` ne maquette aucun message d'erreur de champ — réemploi plutôt qu'invention, et la
      // question d'un affichage par champ est consignée au § « À trancher ».
      setEnregistrement({
        phase: 'refuse',
        // **Le message dit que le projet est gardé** (`24c`). Sans cette précision, l'utilisateur
        // ferme, recommence par « Nouveau projet », et se heurte à « ce nom est déjà pris » — le
        // défaut se produirait à coup sûr.
        message: !venantDuParcours
          ? messageDe(cause)
          : `${messageDe(cause)} Le projet « ${projetCourant} » est créé ; la connexion n’a pas été enregistrée.`,
      })
    }
  }

  // `⌘↩`, tel que le pied l'affiche. Inopérant quand le bouton est désactivé : un raccourci
  // qui contourne l'état d'un bouton est un piège.
  useEffect(() => {
    function auClavier(evenement: KeyboardEvent) {
      if (evenement.metaKey && evenement.key === 'Enter') {
        evenement.preventDefault()
        void enregistrer()
      }
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  })

  return (
    <Modal
      title={edition ? `Modifier ${edition.database.name}` : 'Nouvelle connexion'}
      icon="db"
      onClose={onClose}
      contexte={
        /* **Le projet, en tête** (26 août 2026). Du texte et un glyphe, **pas un `Chip`** : un chip
           est un contrôle partout ailleurs dans ce produit, et un chip inerte se lit comme un contrôle
           en panne. Le sac est le glyphe du projet dans tout le produit. */
        projetCourant === '' ? undefined : (
          <span className={styles.projetDuTitre} data-testid="projet-de-la-modale">
            <Icon name="bag" size={13} strokeWidth={1.8} className={styles.projetIcone} />
            <span className={styles.projetDuTitreNom}>{projetCourant}</span>
          </span>
        )
      }
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            onClick={lancerLeTest}
            disabled={test.phase === 'en-cours' || !engineImplemented}
          >
            {/* La fiole est verte dans le mockup, seule icône du pied à ne pas prendre la
                couleur de son texte. */}
            <Icon name="flask" size={14} strokeWidth={2} className={styles.flask} />
            {libelleDuBouton(test.phase)}
          </Button>

          {/* **Une seule fente souple entre les deux groupes de boutons**, et c'est elle qui les
              écarte : le pied n'a plus de cale séparée. La cale et un message étaient deux items
              flex, et le repli d'une ligne flex précède sa compression — un verdict long faisait
              donc passer « Enregistrer & ouvrir » à la ligne *avant* que quiconque ait eu
              l'occasion de se réduire. En `flex: 1 1 0`, la fente ne demande rien, prend ce qui
              reste, et ses messages s'y élident. */}
          <span className={styles.footerMessage}>
            {test.phase === 'reussi' && (
              <span className={styles.testOk}>
                <Icon name="check" size={14} strokeWidth={2.4} className={styles.testOkIcon} />
                <span className={styles.testOkTexte}>
                  Connecté en {test.resultat.latencyMs} ms · {test.resultat.serverVersion}
                  {test.resultat.tunnelLocalPort !== null &&
                    ` · tunnel :${test.resultat.tunnelLocalPort}`}
                  {test.resultat.tlsUnverified && (
                    // **Laid et honnête.** `06b` emploie `NoTls` : un test en `verify-ca` ou
                    // `verify-full` réussit sans que l'identité du serveur ait été contrôlée.
                    // Afficher « Connecté » sans plus serait exact et trompeur. À retirer quand
                    // le TLS sera branché — pas avant. Dans la même ligne que le verdict : à
                    // côté, le pied en faisait un second item flex, coupé pour son compte.
                    // L'espace avant le point médian est dans la chaîne : la mention était un
                    // item flex, et c'est l'écart du conteneur qui l'espaçait.
                    <span className={styles.testWarn}> · TLS non vérifié</span>
                  )}
                </span>
              </span>
            )}
            {test.phase === 'echoue' && (
              <button
                type="button"
                className={styles.testFail}
                onClick={() => setEchecOuvert(true)}
              >
                {test.message}
              </button>
            )}
            {enregistrement.phase === 'refuse' && (
              <span className={styles.testFail}>{enregistrement.message}</span>
            )}
            {!engineImplemented && (
              // Un moteur sans adaptateur est **sélectionnable et le dit**. Le masquer ferait
              // croire que le produit ne le prévoit pas ; le laisser muet ferait croire que
              // « Tester » est cassé.
              <span className={styles.unsupported}>
                {ENGINES[draft.engine].label} n’a pas encore d’adaptateur
              </span>
            )}
          </span>
          {/* **« Plus tard », et non « Annuler », quand le projet vient d'être créé** (`24c`). À ce
              moment, « Annuler » mentirait : le projet reste, et un bouton ne doit pas nommer un
              défaissement qui n'a pas lieu. C'est la règle de `08j` prise par l'autre bout. */}
          <Button variant="secondary" size="lg" onClick={onClose}>
            {venantDuParcours ? 'Plus tard' : 'Annuler'}
          </Button>
          {/* `08e` le branchera, avec son raccourci ⌘↩. */}
          <Button
            size="lg"
            shortcut="⌘↩"
            disabled={enregistrementBloque}
            onClick={() => void enregistrer()}
          >
            <Icon name="save" size={14} strokeWidth={2.2} />
            {edition ? 'Enregistrer les modifications' : <>Enregistrer &amp; ouvrir</>}
          </Button>
          {/* **Dite avant le clic, non après** (`24c`). Elle fait trois choses en une phrase : elle
              confirme l'écriture de l'étape 1, elle rend « Plus tard » sans conséquence, et elle nomme
              le chemin de retour. Sans elle, « Plus tard » demanderait de deviner ce qu'il advient du
              projet. */}
          {venantDuParcours && (
            <p className={styles.projetCree} role="status">
              Le projet <strong>{projetCourant}</strong> est créé. Vous pouvez déclarer sa première
              connexion maintenant, ou plus tard depuis la sidebar.
            </p>
          )}
        </>
      }
    >
      {/* La bande de progression : **seulement à l'étape 2 du parcours** (`24b`). Ouvert pour un
          projet existant, cet écran n'a qu'une étape, et une bande à une seule étape utile
          affirmerait que cette modale a créé le projet. */}
      {venantDuParcours && (
        <Stepper etapes={[{ libelle: 'PROJET' }, { libelle: 'CONNEXION' }]} courante={1} />
      )}
      <EngineSelector value={draft.engine} onValueChange={changerMoteur} />
      {/* **Le panneau passe avant le formulaire** (24 août 2026, à la demande). L'ordre dit
          quelque chose : par où l'on joint la base se décide avant ce qu'on y saisit, parce
          que ce choix **change** les champs qui suivent — avec un proxy Cloud SQL, l'hôte
          n'est pas saisi, le port vaut « auto » et le mot de passe ne sert pas. Le mettre en
          dernier faisait remplir des champs qu'on découvrait ensuite inutiles. */}
      <TunnelPanel
        tunnel={draft.tunnel}
        kind={draft.tunnel?.proxy.kind ?? sorteProxy}
        onKindChange={changerSorte}
        onProxyChange={changerProxy}
        open={tunnelOuvert}
        onOpenChange={setTunnelOuvert}
        onBrowseKey={onBrowseKey}
      />
      <ConnectionForm
        draft={draft}
        onChange={patch}
        environnements={environnementsDuProjet}
        verrouille={!!edition}
      />

      {echecOuvert && test.phase === 'echoue' && (
        <ConnectionFailure
          message={test.message}
          code={test.code}
          viaTunnel={test.viaTunnel}
          onClose={() => setEchecOuvert(false)}
        />
      )}
    </Modal>
  )
}

/**
 * Le libellé du bouton de test selon la phase.
 *
 * « Retester » après un échec est le mot du handoff (`A3` § pied). L'état d'attente n'est pas
 * maquetté : « Test en cours… » est le minimum défendable, sans animation inventée. La question
 * d'un indicateur de progression est consignée dans `AGENTS.md`.
 */
function libelleDuBouton(phase: EtatDuTest['phase']): string {
  if (phase === 'en-cours') return 'Test en cours…'
  if (phase === 'echoue') return 'Retester'
  return 'Tester la connexion'
}
