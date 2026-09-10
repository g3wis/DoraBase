import { useEffect, useState } from 'react'
import type { InstanceAction, InstancePlan } from '../../domain/instances'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './SqlConfirm.module.css'

export type SqlConfirmProps = {
  action: InstanceAction
  /** L'instance est marquée production : la bande de rappel paraît. */
  production: boolean
  /** Compose le SQL du geste. C'est le **cœur** qui le fait — voir l'en-tête. */
  onPlan: (action: InstanceAction) => Promise<InstancePlan>
  /** Exécute le geste. Reçoit l'action, jamais les ordres qu'on vient d'afficher. */
  onRun: (action: InstanceAction) => Promise<void>
  onClose: () => void
}

/**
 * Le garde-fou des gestes d'administration (`API-32`) : **la confirmation montre le SQL exact**.
 *
 * # Ce qui distingue cet écran d'une confirmation ordinaire
 *
 * Une confirmation ordinaire demande « êtes-vous sûr ? ». Celle-ci répond à « sûr de *quoi* ? » : les
 * ordres sont affichés, dans l'ordre où ils partent, tels que le serveur les recevra. C'est la seule
 * forme qui vaille sur un écran qui supprime des rôles et des bases — un utilisateur qui reconnaît
 * un `REASSIGN OWNED` qu'il n'attendait pas annule ; un « voulez-vous supprimer analytics_bi ? » ne
 * lui aurait rien appris de ce qui va lui arriver.
 *
 * **Le SQL vient du cœur, pas d'ici.** L'écran envoie le geste, reçoit les ordres, les montre ; à
 * l'exécution il renvoie **le geste**, et le cœur recompose le SQL par la même fonction. Deux
 * compositions — une pour montrer, une pour exécuter — tiendraient tant qu'elles s'accordent, et
 * cesseraient le jour où l'une change (règle n° 17). C'est ce que `preview_updates` a établi en
 * `11c` : « s'il n'est pas exactement celui qui partira, il est pire qu'absent ».
 *
 * # La ligne sous l'encart
 *
 * Elle dit ce que le SQL **ne dit pas** — pourquoi trois ordres, pourquoi `RESTRICT` et non
 * `CASCADE`, que `REASSIGN OWNED` se rejoue base par base. Elle vient du plan, non de l'écran : un
 * commentaire SQL l'aurait mise *dans* ce qui part, et le premier lecteur à copier le bloc pour le
 * rejouer dans `psql` aurait emporté nos explications avec.
 */
export function SqlConfirm({ action, production, onPlan, onRun, onClose }: SqlConfirmProps) {
  const t = useT()
  const [plan, setPlan] = useState<InstancePlan | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let vivant = true
    onPlan(action)
      .then((rendu) => {
        if (vivant) setPlan(rendu)
      })
      .catch((cause) => {
        if (vivant) setErreur(messageDe(cause))
      })
    return () => {
      vivant = false
    }
  }, [action, onPlan])

  async function executer() {
    setEnCours(true)
    setErreur(null)
    try {
      await onRun(action)
      onClose()
    } catch (cause) {
      // **L'échec reste dans la modale**, plutôt que de la fermer sur un message ailleurs : c'est ici
      // qu'on lit le SQL qui a échoué, et c'est ici que le message du serveur a un sens.
      setErreur(t('instances.confirm.failed', { reason: messageDe(cause) }))
      setEnCours(false)
    }
  }

  return (
    <Modal
      title={t('instances.confirm.title')}
      icon="warn"
      nested
      compact
      onClose={onClose}
      footer={
        <div className={styles.pied}>
          <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
            {t('instances.confirm.cancel')}
          </Button>
          <Button
            variant="dark"
            size="md"
            /* **Le seul bouton rouge du produit, et il l'est pour un geste qui retire.** Le rouge
               n'est pas une variante de `Button` : `--danger` y serait une quatrième couleur offerte
               à tout appelant, et le projet n'invente pas d'état. Il est posé ici, sur le seul
               bouton dont le rôle est de dire « ceci retire quelque chose », et seulement quand le
               plan le déclare destructeur — un `CREATE DATABASE` en rouge ferait hésiter sans
               raison, et le rouge cesserait d'alerter. */
            className={plan?.destructive ? styles.danger : undefined}
            onClick={executer}
            disabled={enCours || plan === null}
          >
            {enCours ? t('instances.confirm.running') : t('instances.confirm.run')}
          </Button>
        </div>
      }
    >
      <div className={styles.corps}>
        {production && (
          <p className={styles.production}>
            <Badge tone="danger" size="xs">
              {t('instances.sidebar.production')}
            </Badge>{' '}
            {t('instances.confirm.production')}
          </p>
        )}
        <div className={styles.titreSql}>{t('instances.confirm.sql')}</div>
        {/* **Un `<pre>`, et le SQL en texte** : ni coloration, ni éditeur. Ce bloc n'est pas fait
            pour être lu comme du code mais pour être **reconnu** — et un `<pre>` se sélectionne et se
            copie, ce qui est le geste qu'on veut quand on préfère l'exécuter soi-même. */}
        <pre className={styles.sql}>{plan?.statements.join('\n') ?? '…'}</pre>
        {plan !== null && plan.note !== '' && <p className={styles.note}>{plan.note}</p>}
        {erreur !== null && (
          <p className={styles.erreur} role="alert">
            {erreur}
          </p>
        )}
      </div>
    </Modal>
  )
}

function messageDe(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message)
  }
  return String(cause)
}
