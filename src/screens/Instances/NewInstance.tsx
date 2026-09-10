import { useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { Engine, ManagedInstance, SslMode } from '../../domain/config'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { Button } from '../../ui/Button/Button'
import { Field, SANS_CORRECTION } from '../../ui/Field/Field'
import { Modal } from '../../ui/Modal/Modal'
import { RadioGroup } from '../../ui/RadioGroup/RadioGroup'
import { Select } from '../../ui/Select/Select'
import { Toggle } from '../../ui/Toggle/Toggle'
import { emptyProxy, type ProxyKind, type TunnelDraft } from '../NewConnection/ConnectionDraft'
import { ENGINES, modesSslDisponibles } from '../NewConnection/engines'
import { ouvrirSelecteurDeCle } from '../NewConnection/ouvrirSelecteurDeCle'
import { TunnelPanel } from '../NewConnection/TunnelPanel'
import { tunnelDraftToTunnel } from '../NewConnection/tunnelDraftToTunnel'
import { MOTEURS_MANAGES, MOTEURS_OFFERTS, raisonDuMoteur } from './moteurs'
import styles from './NewInstance.module.css'

export type NewInstanceProps = {
  /** L'instance à modifier, ou `undefined` : la modale déclare. */
  edition?: ManagedInstance
  onClose: () => void
  /** Enregistre. Rend la liste entière, que l'appelant repose. */
  onEnregistrer: (requete: {
    id: string | null
    label: string
    engine: Engine
    host: string
    port: number
    defaultDatabase: string
    username: string
    password: string | null
    sslMode: SslMode
    production: boolean
    confirmWrites: boolean
    reconnectOnStartup: boolean
    tunnel: ReturnType<typeof tunnelDraftToTunnel>
  }) => Promise<void>
  /** Ouvre le sélecteur de clé privée SSH — injecté, comme dans `A2`. */
  onBrowseKey?: () => Promise<string | null>
}

/**
 * La déclaration d'une instance managée (`API-32`).
 *
 * # La facture d'`A2`, reprise telle quelle
 *
 * Même largeur, même grille, **même panneau « Proxy / tunnel »** — le composant, pas une copie. Une
 * instance managée se joint par un bastion aussi souvent qu'une connexion, et en réécrire un jeu de
 * champs aurait fait vivre deux fois les trois visages de proxy, leur validation et leur conversion
 * (règle n° 17). Ce qui change est ce que le formulaire décrit : un **serveur** et un compte
 * d'administration, non une base et son lecteur.
 *
 * # Les trois autres moteurs sont désactivés, non masqués
 *
 * Masquer dirait « jamais » ; ils viennent après. C'est la distinction que les cinq verdicts du dump
 * tiennent déjà, et celle du gestionnaire de schémas hors PostgreSQL. La raison est portée par le
 * `title` du bouton, jamais devinée.
 *
 * # Ce que la phrase du pied engage
 *
 * DoraBase lit `pg_roles` à l'ouverture et **nomme les gestes que ce compte n'a pas le droit de
 * faire**, plutôt que de laisser les boutons échouer. C'est une promesse tenue par la vue
 * d'ensemble ; l'annoncer ici est ce qui fait comprendre pourquoi le formulaire demande un compte
 * d'administration et pas n'importe lequel.
 */
export function NewInstance({ edition, onClose, onEnregistrer, onBrowseKey }: NewInstanceProps) {
  const t = useT()
  const [engine, setEngine] = useState<Engine>(edition?.engine ?? 'postgresql')
  const [libelle, setLibelle] = useState(edition?.label ?? '')
  const [hote, setHote] = useState(edition?.connection.host ?? 'localhost')
  const [port, setPort] = useState(String(edition?.connection.port ?? 5432))
  const [base, setBase] = useState(edition?.connection.defaultDatabase ?? 'postgres')
  const [utilisateur, setUtilisateur] = useState(edition?.connection.username ?? 'postgres')
  const [motDePasse, setMotDePasse] = useState('')
  const [motDePasseVisible, setMotDePasseVisible] = useState(false)
  const [ssl, setSsl] = useState<SslMode>(edition?.connection.sslMode ?? 'prefer')
  const [production, setProduction] = useState(edition?.production ?? false)
  const [confirmer, setConfirmer] = useState(edition?.confirmWrites ?? true)
  const [reconnecter, setReconnecter] = useState(edition?.connection.reconnectOnStartup ?? false)
  const [tunnel, setTunnel] = useState<TunnelDraft | null>(null)
  const [sorteDeProxy, setSorteDeProxy] = useState<ProxyKind>('ssh')
  const [proxyOuvert, setProxyOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const nomManquant = libelle.trim() === ''

  async function enregistrer() {
    if (nomManquant) return
    setEnCours(true)
    setErreur(null)
    try {
      await onEnregistrer({
        id: edition?.id ?? null,
        label: libelle.trim(),
        engine,
        host: hote.trim(),
        port: Number.parseInt(port, 10) || 5432,
        defaultDatabase: base.trim(),
        username: utilisateur.trim(),
        // **Un mot de passe vide veut dire « inchangé »**, jamais « aucun » : c'est la règle de
        // `mettre_a_jour`, et l'inverse effacerait le secret de qui rouvre le formulaire pour
        // corriger un port.
        password: motDePasse === '' ? null : motDePasse,
        sslMode: ssl,
        production,
        confirmWrites: confirmer,
        reconnectOnStartup: reconnecter,
        tunnel: tunnelDraftToTunnel(tunnel),
      })
      onClose()
    } catch (cause) {
      setErreur(messageDe(cause))
      setEnCours(false)
    }
  }

  return (
    <Modal
      title={edition ? t('instances.form.titleEdit') : t('instances.form.titleNew')}
      icon="srv"
      onClose={onClose}
      className={styles.modale}
      contexte={
        edition && (
          <span className={styles.identifiant}>
            <Badge tone="muted" size="xs">
              {edition.id}
            </Badge>
          </span>
        )
      }
      footer={
        <div className={styles.pied}>
          <p className={styles.droits}>{t('instances.form.rights')}</p>
          <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
            {t('instances.form.cancel')}
          </Button>
          <Button
            variant="accent"
            size="md"
            onClick={enregistrer}
            disabled={enCours || nomManquant}
            title={nomManquant ? t('instances.form.labelRequired') : undefined}
          >
            {t('instances.form.save')}
          </Button>
        </div>
      }
    >
      <div className={styles.corps}>
        <section className={styles.bloc}>
          <div className={styles.titreBloc}>{t('instances.form.engine')}</div>
          {/* **Quatre moteurs et non les sept d'`A2`.** Les trois autres — Redis, Snowflake,
              BigQuery — n'ont pas d'instance à gérer au sens de cet écran : un espace de clés, un
              entrepôt sans rôles SQL, et un projet dont les autorisations sont celles d'IAM. Les
              lister désactivés dirait « pas encore » d'un cas qui ne viendra pas, ce que les cinq
              verdicts du dump distinguent déjà.

              **Le `RadioGroup` de `ui/` et non `EngineSelector`** : celui-ci rend les sept, sans
              qu'aucun ne puisse être désactivé séparément. */}
          <RadioGroup
            label={t('instances.form.engine')}
            options={MOTEURS_OFFERTS.map((candidat) => ({
              value: candidat,
              label: ENGINES[candidat].label,
              disabled: !MOTEURS_MANAGES.includes(candidat),
              ...(raisonDuMoteur(candidat, t) === undefined
                ? {}
                : { title: raisonDuMoteur(candidat, t) }),
              ...(ENGINES[candidat].icon === undefined
                ? {}
                : {
                    prefix: (
                      <span style={{ color: ENGINES[candidat].color }}>
                        <Icon name={ENGINES[candidat].icon} size={15} strokeWidth={1.9} />
                      </span>
                    ),
                  }),
            }))}
            value={engine}
            onValueChange={setEngine}
          />
        </section>

        <div className={styles.grille}>
          <Field
            label={t('instances.form.host')}
            value={hote}
            onChange={(evenement) => setHote(evenement.target.value)}
            {...SANS_CORRECTION}
          />
          <Field
            label={t('instances.form.port')}
            value={port}
            inputMode="numeric"
            onChange={(evenement) => setPort(evenement.target.value)}
            {...SANS_CORRECTION}
          />
          <Field
            label={t('instances.form.serviceDatabase')}
            value={base}
            title={t('instances.form.serviceDatabaseHint')}
            onChange={(evenement) => setBase(evenement.target.value)}
            {...SANS_CORRECTION}
          />
          <Field
            label={t('instances.form.username')}
            value={utilisateur}
            onChange={(evenement) => setUtilisateur(evenement.target.value)}
            {...SANS_CORRECTION}
          />
          <Field
            label={t('instances.form.password')}
            type={motDePasseVisible ? 'text' : 'password'}
            value={motDePasse}
            /* En édition, le champ vide **est** l'état normal : le secret est au magasin, et le
               placeholder dit qu'il y reste. Le remplir d'étoiles ferait croire qu'on le renvoie. */
            placeholder={edition ? t('instances.form.passwordKept') : undefined}
            onChange={(evenement) => setMotDePasse(evenement.target.value)}
            {...SANS_CORRECTION}
            suffix={
              <>
                <button
                  type="button"
                  className={styles.oeil}
                  aria-label={t('instances.form.password')}
                  aria-pressed={motDePasseVisible}
                  onClick={() => setMotDePasseVisible((visible) => !visible)}
                >
                  ◉
                </button>
                <Badge tone="violet" size="xs">
                  {t('instances.overview.secret')}
                </Badge>
              </>
            }
          />
          <Select
            label={t('instances.form.sslMode')}
            options={modesSslDisponibles(engine).map((mode) => ({ value: mode, label: mode }))}
            value={ssl}
            onValueChange={setSsl}
          />
          <div className={styles.pleineLargeur}>
            <Field
              label={t('instances.form.label')}
              value={libelle}
              title={t('instances.form.labelHint')}
              onChange={(evenement) => setLibelle(evenement.target.value)}
              {...SANS_CORRECTION}
            />
          </div>
        </div>

        {/* Le panneau d'`A2`, **le composant** et non une copie : voir l'en-tête. */}
        <TunnelPanel
          tunnel={tunnel}
          kind={sorteDeProxy}
          onKindChange={setSorteDeProxy}
          onProxyChange={(proxy) => setTunnel({ localPort: null, proxy })}
          open={proxyOuvert}
          onOpenChange={setProxyOuvert}
          onBrowseKey={onBrowseKey ?? ouvrirSelecteurDeCle}
        />

        <div className={styles.bascules}>
          <Interrupteur
            coche={production}
            onChange={setProduction}
            libelle={t('instances.form.production')}
          />
          <Interrupteur
            coche={confirmer}
            onChange={setConfirmer}
            libelle={t('instances.form.confirmWrites')}
          />
          <Interrupteur
            coche={reconnecter}
            onChange={setReconnecter}
            libelle={t('instances.form.reconnect')}
          />
        </div>

        {erreur !== null && (
          <p className={styles.erreur} role="alert">
            {erreur}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Le `Toggle` de `ui/`, habillé ici — voir la note du même composant dans `GestureDialogs`. */
function Interrupteur({
  coche,
  onChange,
  libelle,
}: {
  coche: boolean
  onChange: (coche: boolean) => void
  libelle: string
}) {
  return (
    /* **Un `<span>` et non un `<label>`** : le nom accessible vient déjà de l'`aria-label` du
       bouton, et un `<label for>` sur un `role="switch"` le doublerait dans l'annonce. C'est la
       raison de `ToggleWithLabel`, et elle vaut ici. Le texte reste cliquable — il est dans la
       zone du contrôle, dont le `onClick` remonte. */
    <span className={styles.interrupteur}>
      <Toggle checked={coche} onCheckedChange={onChange} label={libelle} />
      <span>{libelle}</span>
    </span>
  )
}

/** Un proxy neuf, quand le panneau en demande un. Réexporté pour la lisibilité de l'import. */
export { emptyProxy }

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
