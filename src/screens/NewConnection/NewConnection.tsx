import { useEffect, useState } from 'react'
import {
  ancetreEnLectureSeule,
  connexion,
  dossier as dossierDe,
  idDeConnexion,
} from '../../data/dossiers'
import { Icon } from '../../design/icons/Icon'
import type { SaveDatabaseResult, UpdateVariantRequest } from '../../domain/arbre'
import type {
  Database,
  Engine,
  Folder,
  FolderId,
  FolderTree,
  Kubeconfigs,
} from '../../domain/config'
import type { ConnectionRequest, ConnectionTest } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { modificateurActif, raccourci } from '../../shell/plateforme'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { ConfirmationTls } from './ConfirmationTls'
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
import {
  confirmationTlsRequise,
  ENGINES,
  IMPLEMENTED_ENGINES,
  modeSslPourLeMoteur,
  portSuivant,
} from './engines'
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
import type { CatalogueKubernetes } from './useCatalogueKubernetes'

type NewConnectionProps = {
  onClose: () => void
  /**
   * L'arbre de dossiers, pour nommer le cadre et dire s'il est en lecture seule. Absent — la vitrine,
   * les tests —, le cadre s'annonce « Racine ».
   */
  arbre?: FolderTree
  /**
   * Ouvre le sélecteur de fichier de la clé privée.
   *
   * Injecté pour que le câblage du bouton « Parcourir… » soit testable : le plugin `dialog`
   * ne répond pas hors de la webview, donc sous Vitest l'appel réel rejetterait. Par défaut,
   * c'est l'appel réel.
   */
  onBrowseKey?: () => Promise<string | null>
  /**
   * Les kubeconfigs déclarés (`API-70`), pour la liste du visage Kubernetes.
   *
   * **Un défaut vide plutôt qu'une prop obligatoire** : la vitrine, la démo et les tests montent cet
   * écran sans configuration, et ce qu'ils y verraient — une liste qui ne propose que « celui de
   * kubectl » et « Autre fichier… » — est exactement l'état d'un poste qui n'a rien déclaré.
   */
  kubeconfigs?: Kubeconfigs
  /** Déclare un kubeconfig et rend sa référence. Injectée pour la raison d'`onBrowseKey`. */
  onDeclareKubeconfig?: () => Promise<string | null>
  /**
   * Ce que l'hôte sait demander à `kubectl` pour remplir les listes du visage Kubernetes
   * (`API-73`). Traversé tel quel, et absent hors de la webview.
   */
  catalogueKubernetes?: CatalogueKubernetes
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
  onSave?: (request: ReturnType<typeof draftToSaveRequest>) => Promise<SaveDatabaseResult>
  /**
   * Le dossier dans lequel la connexion se déclare — `null` : la racine. **Toujours connu, jamais
   * choisi ici** (26 août 2026, puis #166).
   *
   * Le dossier est le **cadre** du formulaire, non un de ses champs, et il s'annonce en tête de la
   * modale. Le déplacer est un autre geste (#167), qui ne se confond pas avec la déclaration. En
   * création, l'appelant le désigne : le menu d'une ligne de dossier le connaît. En édition, c'est
   * celui qui contient la connexion modifiée, qui fait foi.
   */
  dossier?: FolderId | null
  /**
   * La base à modifier (`08g`). Absente, la modale **crée**.
   *
   * Le même formulaire sert les deux : `A2` porte déjà tous les champs, et un second écran en
   * dupliquerait la mise en page — donc la dérive au premier changement du handoff.
   */
  edition?: Database
  /** Appelle la commande `update_variant` (`08g`). */
  onUpdate?: (request: UpdateVariantRequest) => Promise<FolderTree>
  /** Appelé après un enregistrement réussi, avec l'arbre à jour. */
  onSaved?: (arbre: FolderTree) => void
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
function varianteCible(edition: Database) {
  return edition.connection
}

export function NewConnection({
  onClose,
  arbre,
  onBrowseKey = ouvrirSelecteurDeCle,
  kubeconfigs = {},
  onDeclareKubeconfig = async () => null,
  catalogueKubernetes,
  onTest = testerLaConnexion,
  onSave = enregistrerLaBase,
  edition,
  onUpdate = mettreAJourLaVariante,
  onSaved,
  dossier = null,
}: NewConnectionProps) {
  const t = useT()
  /**
   * Les dossiers du cadre, du plus extérieur au plus proche.
   *
   * **En édition, ceux de la connexion**, jamais le dossier qu'on aurait passé à côté : la connexion
   * modifiée dit où elle vit, et deux sources pour un même cadre finiraient par se contredire.
   */
  const cadre: readonly Folder[] = (() => {
    if (arbre === undefined) return []
    if (edition) return connexion(arbre, idDeConnexion(edition))?.ancetres ?? []
    if (dossier === null) return []
    const situe = dossierDe(arbre, dossier)
    return situe === null ? [] : [...situe.ancetres, situe.dossier]
  })()
  // En mode édition, le brouillon part des réglages enregistrés. `useState` avec initialiseur : le
  // recalculer à chaque rendu écraserait la saisie en cours.
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    edition ? draftDepuisLaVariante(edition, varianteCible(edition)) : emptyDraft(),
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
  // Le rappel d'un mode SSL non authentifiant en production (#87) : ouvert par un enregistrement qui
  // le demande, fermé par « Revenir » ou par la confirmation, qui enregistre.
  const [confirmationTlsOuverte, setConfirmationTlsOuverte] = useState(false)
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
  // succès. Pas désactivé avant tout test : rien n'oblige à tester pour enregistrer. **Plus de garde
  // « sans projet »** (#166) : le cadre est toujours valide, la racine comprise.
  const enregistrementBloque = test.phase === 'echoue' || enregistrement.phase === 'en-cours'

  /**
   * Le dossier qui impose la lecture seule au cadre, s'il y en a un — ce qui tient lieu, en attendant
   * #168, du drapeau `production` que l'environnement portait pour le rappel TLS de #87.
   */
  const dossierEnLectureSeule = ancetreEnLectureSeule(cadre)

  /**
   * Enregistre — après le rappel de #87 quand la cible est marquée production et que le mode ne
   * vérifie pas le serveur. `confirme` n'est passé que par ce rappel : le bouton du pied et `⌘↩`
   * passent toujours par la question, y compris en édition, puisque c'est bien ce mode-là qui partira.
   */
  async function enregistrer(confirme = false) {
    if (enregistrementBloque) return
    if (
      !confirme &&
      confirmationTlsRequise(draft.engine, draft.sslMode, dossierEnLectureSeule !== null)
    ) {
      setConfirmationTlsOuverte(true)
      return
    }
    setConfirmationTlsOuverte(false)
    setEnregistrement({ phase: 'en-cours' })
    try {
      if (edition) {
        // **Mise à jour, pas enregistrement** : `save_database` refuserait une base déjà là, et
        // c'est cette garde qui protège d'un écrasement par mégarde.
        const suivant = await onUpdate(draftToUpdateRequest(draft, idDeConnexion(edition)))
        onSaved?.(suivant)
        onClose()
        return
      }
      // **Le dossier du cadre, jamais un champ du brouillon** (#166) : une seule commande, un seul
      // acte. L'identifiant de la connexion est tiré par le cœur.
      const issue = await onSave(draftToSaveRequest(draft, dossier))
      onSaved?.(issue.tree)
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
        message: messageDe(cause),
      })
    }
  }

  // `⌘↩`, tel que le pied l'affiche. Inopérant quand le bouton est désactivé : un raccourci
  // qui contourne l'état d'un bouton est un piège.
  useEffect(() => {
    function auClavier(evenement: KeyboardEvent) {
      if (modificateurActif(evenement) && evenement.key === 'Enter') {
        evenement.preventDefault()
        void enregistrer()
      }
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  })

  return (
    <Modal
      title={
        edition
          ? t('newConnection.title.edit', {
              // L'affichage suit `label` quand il est renseigné, comme partout ailleurs (`27a`) —
              // `edition.name` reste le nom technique, inchangé par cette substitution.
              name: edition.label?.trim() || edition.name,
            })
          : t('newConnection.title.new')
      }
      icon="db"
      onClose={onClose}
      contexte={
        /* **Le dossier, en tête** (26 août 2026, puis #166). Du texte et un glyphe, **pas un
           `Chip`** : un chip est un contrôle partout ailleurs dans ce produit, et un chip inerte se
           lit comme un contrôle en panne. `pin` est le glyphe du dossier dans l'arbre ; la racine
           se dit « Racine », jamais un vide qui laisserait deviner. */
        <span className={styles.dossierDuTitre} data-testid="dossier-de-la-modale">
          <Icon name="pin" size={13} strokeWidth={1.8} className={styles.dossierIcone} />
          <span className={styles.dossierDuTitreNom}>
            {cadre.length === 0
              ? t('newConnection.frame.root')
              : cadre.map((ancetre) => ancetre.name).join(' › ')}
          </span>
        </span>
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
            {libelleDuBouton(test.phase, t)}
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
                  {t('newConnection.footer.connected', {
                    latencyMs: test.resultat.latencyMs,
                    serverVersion: test.resultat.serverVersion,
                  })}
                  {test.resultat.tunnelLocalPort !== null &&
                    t('newConnection.footer.tunnelPort', { port: test.resultat.tunnelLocalPort })}
                  {test.resultat.tlsUnverified && (
                    // **Laid et honnête.** `06b` emploie `NoTls` : un test en `verify-ca` ou
                    // `verify-full` réussit sans que l'identité du serveur ait été contrôlée.
                    // Afficher « Connecté » sans plus serait exact et trompeur. À retirer quand
                    // le TLS sera branché — pas avant. Dans la même ligne que le verdict : à
                    // côté, le pied en faisait un second item flex, coupé pour son compte.
                    // L'espace avant le point médian est dans la chaîne : la mention était un
                    // item flex, et c'est l'écart du conteneur qui l'espaçait.
                    <span className={styles.testWarn}>
                      {t('newConnection.footer.tlsUnverified')}
                    </span>
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
                {t('newConnection.footer.unsupported', { engine: ENGINES[draft.engine].label })}
              </span>
            )}
          </span>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('newConnection.footer.cancel')}
          </Button>
          {/* `08e` le branchera, avec son raccourci ⌘↩. */}
          <Button
            size="lg"
            shortcut={raccourci('↩')}
            disabled={enregistrementBloque}
            onClick={() => void enregistrer()}
          >
            <Icon name="save" size={14} strokeWidth={2.2} />
            {edition ? t('newConnection.footer.saveEdit') : t('newConnection.footer.saveNew')}
          </Button>
        </>
      }
    >
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
        kubeconfigs={kubeconfigs}
        onDeclareKubeconfig={onDeclareKubeconfig}
        {...(catalogueKubernetes === undefined ? {} : { catalogueKubernetes })}
      />
      <ConnectionForm draft={draft} onChange={patch} />

      {confirmationTlsOuverte &&
        draft.sslMode !== 'verify-ca' &&
        draft.sslMode !== 'verify-full' && (
          <ConfirmationTls
            mode={draft.sslMode}
            rappel={t('newConnection.tlsConfirm.folder', {
              name: dossierEnLectureSeule?.name ?? '',
            })}
            onConfirmer={() => void enregistrer(true)}
            onClose={() => setConfirmationTlsOuverte(false)}
          />
        )}

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
function libelleDuBouton(phase: EtatDuTest['phase'], t: ReturnType<typeof useT>): string {
  if (phase === 'en-cours') return t('newConnection.footer.testButton.testing')
  if (phase === 'echoue') return t('newConnection.footer.testButton.retry')
  return t('newConnection.footer.testButton.idle')
}
