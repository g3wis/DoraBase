import { useId } from 'react'
import type { Kubeconfigs } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { CollapsiblePanel } from '../../ui/CollapsiblePanel/CollapsiblePanel'
import { Field } from '../../ui/Field/Field'
import { Select } from '../../ui/Select/Select'
import { emptyProxy, type ProxyDraft, type ProxyKind, type TunnelDraft } from './ConnectionDraft'
import { AUTRE_FICHIER, optionsDeKubeconfig } from './kubeconfigs'
import styles from './NewConnection.module.css'

type TunnelPanelProps = {
  /** `null` quand la connexion ne passe par aucun proxy. */
  tunnel: TunnelDraft | null
  /** La sorte **affichée**, qui peut différer de celle du tunnel quand il n'y en a pas. */
  kind: ProxyKind
  onKindChange: (kind: ProxyKind) => void
  /**
   * Le proxy entier, et non un `Partial`.
   *
   * **Pourquoi pas un patch.** Un `Partial<ProxyDraft>` sur une union autorise un objet mêlant
   * les champs des deux sortes, ce que le type est précisément là pour interdire. Le panneau
   * connaît le proxy courant, donc il peut composer le suivant — et le composer est le seul
   * moyen de garder l'union honnête.
   */
  onProxyChange: (proxy: ProxyDraft) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Ouvre le sélecteur de la clé privée SSH, et rend le chemin choisi, ou `null` si
   * l'utilisateur annule.
   *
   * **Injecté plutôt qu'appelé directement.** Le plugin `dialog` de Tauri ne répond pas hors de
   * la webview : sous Vitest, `open()` rejette. Passer l'ouverture en paramètre rend le câblage
   * du bouton testable, et laisse l'appel réel au seul endroit qui tourne dans l'app.
   */
  onBrowseKey: () => Promise<string | null>
  /**
   * Les kubeconfigs déclarés (`API-70`), que la liste du visage Kubernetes propose.
   *
   * **Passés plutôt que lus ici** : `A2` est monté par deux écrans — la connexion et l'instance
   * managée — et aucun des deux ne lit la configuration lui-même. C'est aussi ce qui laisse la
   * vitrine et la démo rendre ce visage sans pont IPC.
   */
  kubeconfigs: Kubeconfigs
  /**
   * Déclare un kubeconfig et rend sa référence, ou `null` si l'utilisateur renonce.
   *
   * **C'est « Autre fichier… », et il déclare** — la décision d'`API-70` : un fichier choisi ici
   * entre dans la liste globale, de sorte qu'une référence ne peut jamais désigner une déclaration
   * qui n'existe pas. Injecté pour la raison d'`onBrowseKey` : le sélecteur natif ne répond pas
   * hors de la webview, et la commande qui déclare écrit dans la configuration.
   */
  onDeclareKubeconfig: () => Promise<string | null>
}

/**
 * Le bloc « Proxy / tunnel » de `A2`, dans l'un ou l'autre de ses trois visages.
 *
 * Le panneau existe toujours ; c'est la **présence d'un proxy** qui change. Sans proxy, les
 * champs sont là mais vides et le badge est absent — le mockup ne montre pas cet état, et c'est
 * la seule lecture cohérente : masquer le panneau entier ferait disparaître une fonction du
 * formulaire.
 *
 * Toucher un champ crée le proxy s'il n'existe pas (voir `NewConnection`) : l'utilisateur qui
 * saisit un bastion déclare par là qu'il en veut un. **Changer le Type, en revanche, ne crée
 * rien** : choisir une sorte n'est pas déclarer un proxy, et faire apparaître « Cloud SQL
 * activé » sur une instance vide serait une fausse déclaration — que `06b` refuserait ensuite,
 * puisqu'il rejette une variante déclarant un proxy qu'on n'a pas ouvert.
 */
export function TunnelPanel({
  tunnel,
  kind,
  onKindChange,
  onProxyChange,
  open,
  onOpenChange,
  onBrowseKey,
  kubeconfigs,
  onDeclareKubeconfig,
}: TunnelPanelProps) {
  const t = useT()
  const aideId = useId()

  // Le proxy affiché : celui du tunnel s'il existe **et** s'il est de la sorte choisie, un proxy
  // vide sinon. Le second cas couvre le panneau sans tunnel, où les champs sont là mais vides.
  const proxy: ProxyDraft = tunnel && tunnel.proxy.kind === kind ? tunnel.proxy : emptyProxy(kind)

  /**
   * Les trois sortes de proxy : `05d` les modélise, `06g` ouvre la seconde, le 31 août 2026 la
   * troisième.
   *
   * **Ni Cloud SQL ni Kubernetes ne sont dans le handoff** : ces libellés, comme les champs de
   * leurs visages, sont inventés ici et attendent un passage de design. Le garde-fou qui remplace
   * la maquette est l'union discriminée de `ConnectionDraft` — c'est `tsc`, et non l'œil, qui
   * empêche ce panneau de lire `bastionHost` sur un transfert Kubernetes.
   */
  const types = [
    { value: 'ssh', label: t('newConnection.tunnel.types.ssh') },
    { value: 'cloud-sql', label: t('newConnection.tunnel.types.cloudSql') },
    { value: 'kubernetes', label: t('newConnection.tunnel.types.kubernetes') },
  ] as const

  /**
   * Ce que le badge annonce pour chaque sorte.
   *
   * `Record<ProxyKind, string>` et non un objet libre : ajouter une sorte au modèle fait échouer
   * `tsc` ici tant qu'elle n'a pas son libellé — sans quoi un badge vide paraîtrait sur un proxy
   * pourtant déclaré.
   */
  const badges: Record<ProxyKind, string> = {
    ssh: t('newConnection.tunnel.badges.ssh'),
    'cloud-sql': t('newConnection.tunnel.badges.cloudSql'),
    kubernetes: t('newConnection.tunnel.badges.kubernetes'),
  }

  /**
   * Ouvre un sélecteur natif, et applique ce qu'il rend.
   *
   * Employée par la clé privée SSH — qui en rend un **chemin** — et par « Autre fichier… » du
   * visage Kubernetes, qui en rend une **référence** de déclaration (`API-70`). Les deux ont la
   * même forme et la même règle d'annulation ; en écrire deux en aurait laissé une en arrière.
   */
  async function parcourir(
    ouvrir: () => Promise<string | null>,
    appliquer: (rendu: string) => ProxyDraft,
  ) {
    const rendu = await ouvrir()
    // `null` = l'utilisateur a annulé. Écraser ce qui est déjà réglé serait une perte.
    if (rendu !== null) onProxyChange(appliquer(rendu))
  }

  return (
    <div className={styles.tunnelBlock}>
      <CollapsiblePanel
        title={t('newConnection.tunnel.panelTitle')}
        icon="shield"
        badge={tunnel ? <Badge tone="violet">{badges[tunnel.proxy.kind]}</Badge> : undefined}
        open={open}
        onOpenChange={onOpenChange}
      >
        <div className={styles.tunnelGrid}>
          <Select
            label={t('newConnection.tunnel.typeLabel')}
            size="sm"
            options={types}
            value={kind}
            onValueChange={onKindChange}
          />

          {proxy.kind === 'ssh' && (
            <>
              <Field
                label={t('newConnection.tunnel.bastionHostLabel')}
                size="sm"
                mono
                value={proxy.bastionHost}
                onChange={(event) => onProxyChange({ ...proxy, bastionHost: event.target.value })}
              />
              <Field
                label={t('newConnection.tunnel.portLabel')}
                size="sm"
                mono
                inputMode="numeric"
                value={proxy.bastionPort}
                onChange={(event) => onProxyChange({ ...proxy, bastionPort: event.target.value })}
              />
              <Field
                label={t('newConnection.tunnel.usernameLabel')}
                size="sm"
                mono
                value={proxy.username}
                onChange={(event) => onProxyChange({ ...proxy, username: event.target.value })}
              />
            </>
          )}

          {proxy.kind === 'cloud-sql' && (
            // L'instance prend les trois colonnes restantes : un nom de connexion
            // `projet:région:instance` est long, et le couper sur `1fr` le rendrait illisible.
            //
            // **L'enveloppe n'est pas décorative, elle est l'élément de grille** (31 août 2026).
            // `Field` pose son `className` sur l'`<input>` — ou sur son enveloppe quand il y a un
            // suffixe —, jamais sur le `<div>` racine qui porte l'étiquette. Un `grid-column` passé
            // en `className` atterrissait donc sur un élément qui n'est pas enfant de la grille,
            // donc **sans aucun effet** : l'instance occupait une seule piste `1fr` depuis `08k`,
            // et le test de géométrie qui prétendait la garder passait pour une autre raison — son
            // `> 2 ×` était satisfait par la largeur d'une piste seule. Trouvé en écrivant le même
            // `grid-column` pour le visage Kubernetes, où l'effet attendu n'arrivait pas.
            <div className={styles.tunnelInstance}>
              <Field
                label={t('newConnection.tunnel.instanceLabel')}
                size="sm"
                mono
                placeholder={t('newConnection.tunnel.instancePlaceholder')}
                value={proxy.instanceConnectionName}
                onChange={(event) =>
                  onProxyChange({ ...proxy, instanceConnectionName: event.target.value })
                }
              />
            </div>
          )}

          {proxy.kind === 'kubernetes' && (
            // **Un seul champ dans cette rangée depuis le retrait du contexte** (31 août 2026) : il
            // n'y a plus de cote à répartir, l'espace de noms tenant largement dans une colonne
            // `1fr`. Le fichier et la ressource vivent dans la rangée pleine largeur en dessous, où
            // un chemin et un `statefulset/…` ont la place qu'ils demandent.
            <Field
              label={t('newConnection.tunnel.namespaceLabel')}
              size="sm"
              mono
              placeholder={t('newConnection.tunnel.namespacePlaceholder')}
              value={proxy.namespace}
              onChange={(event) => onProxyChange({ ...proxy, namespace: event.target.value })}
            />
          )}

          <div className={styles.tunnelKeyRow}>
            {proxy.kind === 'ssh' && (
              <Field
                label={t('newConnection.tunnel.privateKeyLabel')}
                size="sm"
                mono
                value={proxy.privateKeyPath}
                onChange={(event) =>
                  onProxyChange({ ...proxy, privateKeyPath: event.target.value })
                }
                suffix={
                  <button
                    type="button"
                    className={styles.browse}
                    onClick={() =>
                      parcourir(onBrowseKey, (chemin) => ({ ...proxy, privateKeyPath: chemin }))
                    }
                  >
                    {t('newConnection.tunnel.browse')}
                  </button>
                }
              />
            )}

            {proxy.kind === 'kubernetes' && (
              <>
                {/* **Le kubeconfig est dans la rangée pleine largeur, et avant la ressource.** Un
                    libellé de fichier ne tient pas dans une colonne de la grille, et cette rangée
                    est déjà à `1fr` unique — donc aucune classe de grille à écrire. Placé avant la
                    ressource parce que c'est ce fichier qui *désigne le cluster* : la lecture suit
                    l'ordre où les coordonnées se déterminent.

                    **Une liste depuis `API-70`, et non un champ de saisie.** Un cluster porte
                    souvent des dizaines de bases, donc le chemin était ressaisi connexion par
                    connexion. La liste maison, jamais un `<select>` natif — la prohibition du
                    dépôt, et elle porte ici une entrée qui *agit* (« Autre fichier… »), ce qu'un
                    natif ne saurait pas distinguer d'une valeur. */}
                <Select
                  label={t('newConnection.tunnel.kubeconfigLabel')}
                  size="sm"
                  options={optionsDeKubeconfig(kubeconfigs, t, proxy.kubeconfig)}
                  value={proxy.kubeconfig}
                  onValueChange={(choix) => {
                    if (choix !== AUTRE_FICHIER) {
                      onProxyChange({ ...proxy, kubeconfig: choix })
                      return
                    }
                    // **Renoncer ne change rien** : le choix précédent reste, plutôt que de
                    // retomber sur « celui de kubectl » — un sélecteur annulé ne doit pas défaire
                    // ce qu'on avait déjà réglé. C'est la règle de `parcourir`, et c'est pourquoi
                    // ce geste passe par elle plutôt que par une seconde mécanique.
                    void parcourir(onDeclareKubeconfig, (reference) => ({
                      ...proxy,
                      kubeconfig: reference,
                    }))
                  }}
                />
                {/* La ressource prend la rangée entière : `statefulset/postgres-principal` tient
                    mal dans une colonne, et c'est le seul champ obligatoire de ce visage. */}
                <Field
                  label={t('newConnection.tunnel.resourceLabel')}
                  size="sm"
                  mono
                  aria-describedby={aideId}
                  placeholder={t('newConnection.tunnel.resourcePlaceholder')}
                  value={proxy.resource}
                  onChange={(event) => onProxyChange({ ...proxy, resource: event.target.value })}
                />
                {/* **Deux faits qu'aucun champ ne dit et qu'on ne devine pas.** Que le transfert
                    dépende d'un `kubectl` installé sur la machine — donc qu'une absence
                    d'installation soit la première chose à vérifier. Et que le champ « Port » du
                    formulaire soit celui de la base *dans le pod*, là où l'« Hôte » ne sert pas :
                    sans cette phrase, on remplit l'hôte et on cherche pourquoi il est grisé.

                    Lié par `aria-describedby` au champ, contrairement à la phrase Cloud SQL qui
                    n'en a plus : ici il y a bien un champ, et l'aide *le* décrit. Un piège d'`A2`
                    à ne pas rejouer — une infobulle décrit, elle ne nomme pas. */}
                <p id={aideId} className={styles.tunnelHint}>
                  {t('newConnection.tunnel.kubernetesHintPrefix')} <code>kubectl</code>
                  {t('newConnection.tunnel.kubernetesHintSuffix')}
                </p>
              </>
            )}

            {proxy.kind === 'cloud-sql' && (
              // **Aucun champ dans cette ligne.** Un « Compte de service » s'y saisissait
              // (`06j`), puis une bascule « Authentification IAM » (`06k`) : les deux sont
              // partis, l'un parce que l'authentification est celle de la machine et non de la
              // connexion, l'autre parce que le mode est désormais **toujours** actif. Il reste
              // une phrase, et rien à remplir.
              //
              // **Un paragraphe simple, plus lié par `aria-describedby`.** Le lien existait
              // pour empêcher qu'un champ vide se lise comme un champ oublié ; sans champ,
              // cette raison tombe, et un texte informatif dans le flux est annoncé à sa place.
              //
              // Les deux phrases sont là parce qu'elles répondent à deux questions
              // différentes, et qu'aucune ne se devine : **avec quoi** l'application
              // s'authentifie — la commande `gcloud` entière, jamais « authentifiez-vous avec
              // gcloud », qui enverrait sur `gcloud auth login` (`06i`) — et **ce que
              // l'utilisateur doit saisir**, à savoir une adresse et pas un rôle, sans mot de
              // passe. Sans la seconde, une connexion IAM se remplit comme une autre et
              // n'apprend qu'à l'échec, sur « IAM user authentication failed ».
              <p className={styles.tunnelHint}>
                {t('newConnection.tunnel.cloudSqlAuthPrefix')}{' '}
                <code>gcloud auth application-default login</code>
                {t('newConnection.tunnel.cloudSqlAuthSuffix')}
              </p>
            )}
          </div>
        </div>
      </CollapsiblePanel>
    </div>
  )
}
