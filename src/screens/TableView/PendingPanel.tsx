import { Icon } from '../../design/icons/Icon'
import type { Value } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { Badge } from '../../ui/Badge/Badge'
import { cx } from '../../ui/cx'
import type { EnAttente, Modification, Saisie } from './modifications'
import styles from './PendingPanel.module.css'
import { SqlColore } from './SqlColore'

type PendingPanelProps = {
  attente: EnAttente
  /** `public.orders`, pour l'en-tête des cartes et le titre. */
  table: string
  /**
   * Le SQL rendu par le moteur, ou `null` tant qu'il n'est pas revenu.
   *
   * **Jamais fabriqué ici.** Le bloc annonce « SQL qui sera exécuté » : composer un équivalent côté
   * écran demanderait au JavaScript de citer les identifiants et littéraliser les valeurs pour sept
   * moteurs, et surtout produirait un texte *ressemblant* à celui qui partira. Tant que le cœur ne
   * l'a pas rendu, le panneau le dit.
   */
  sql: string | null
  /** Le refus de la prévisualisation, s'il y en a un. */
  erreurSql?: string | null
  onRetirer: (cle: string, column: string) => void
  onToutAnnuler: () => void
  onAppliquer?: () => void
  onCopierLeSQL?: () => void
  /** Vrai pendant l'écriture : les actions attendent. */
  enCours?: boolean
  /** Le refus de l'application — conflit, contrainte violée. Affiché ici, près du diff. */
  refus?: string | null
  /**
   * Le SQL qui **annule** l'application qui vient de réussir (`11d`).
   *
   * Disponible tant que l'onglet est ouvert, pas persisté : `A10` en fera une préférence à 24 h, ce
   * qui suppose de décider où le garder et ce qu'il advient d'un patch dont la base a changé.
   */
  patchInverse?: string | null
  onCopierLePatch?: () => void
  /** Écarte le rapport d'écriture et revient à la lecture. */
  onEcarterLePatch?: () => void
}

/**
 * Le panneau droit du mode édition (`11c`) : une carte par modification, le diff, le SQL.
 *
 * **Il remplace le panneau de `10f`, il ne s'y ajoute pas.** `10f` a posé qu'il y a *un* panneau
 * droit dont le contenu suit l'écran. Conséquence assumée, et c'est ce que le mockup montre : en
 * éditant, on ne voit plus le détail de la ligne sélectionnée — ce qu'on veut voir est ce qu'on a
 * changé.
 *
 * **Le diff se lit, il ne s'édite pas.** Le mockup n'y met aucun champ ; la correction se fait dans
 * la grille, là où l'on voit la ligne entière.
 */
export function PendingPanel({
  attente,
  table,
  sql,
  erreurSql = null,
  onRetirer,
  onToutAnnuler,
  onAppliquer,
  onCopierLeSQL,
  enCours = false,
  refus = null,
  patchInverse = null,
  onCopierLePatch,
  onEcarterLePatch,
}: PendingPanelProps) {
  const t = useT()
  // **Deux états pour un panneau** : ce qui attend d'être écrit, et ce qui vient de l'être. Le
  // second n'a ni carte ni SQL à venir — seulement de quoi défaire.
  const apresEcriture = attente.length === 0 && patchInverse !== null
  return (
    // `<aside>` et non un `div` avec `aria-label` : **un nom accessible sur un élément sans rôle est
    // ignoré**, et Biome a raison de le signaler — le même piège qu'en `08c` avec le port local et
    // qu'en `09c` avec le point d'état. L'élément sémantique porte le rôle `complementary`, ce que ce
    // panneau est : un complément de la grille.
    <aside className={styles.root} aria-label={t('tableView.pendingPanel.ariaLabel')}>
      <header className={styles.entete}>
        <Icon name="pencil" size={13} strokeWidth={2.1} className={styles.icone} />
        <h2 className={styles.titre}>
          {apresEcriture
            ? t('tableView.pendingPanel.writtenTitle')
            : t('tableView.pendingPanel.pendingTitle')}
        </h2>
        {apresEcriture ? (
          <Badge tone="success" size="xs">
            {t('tableView.pendingPanel.done')}
          </Badge>
        ) : (
          <Badge tone="warn" size="xs">
            {attente.length}
          </Badge>
        )}
      </header>

      <div className={styles.corps}>
        {/* **Après une écriture réussie, le modèle est vide** — et le panneau reste pour montrer de
            quoi défaire. Une première version le démontait avec la dernière carte, emportant le
            patch inverse avec elle : l'utilisateur perdait le seul moyen d'annuler, à l'instant
            précis où il pouvait en avoir besoin. Trouvé par le test de relecture. */}
        <ul className={styles.cartes}>
          {attente.map((modification) =>
            modification.sorte === 'ligne' ? (
              <li key={modification.cle} className={styles.carte}>
                <div className={styles.carteEntete}>
                  {/* **Pas de clé à montrer** : celle de la base n'existe pas encore, et en inventer
                      une ferait croire à une ligne déjà écrite. Le numéro d'ordre suffit à désigner
                      celle dont on parle. */}
                  <span className={styles.position}>
                    {t('tableView.pendingPanel.newRow', { rang: modification.rang })}
                  </span>
                  <button
                    type="button"
                    className={styles.retirer}
                    aria-label={t('tableView.pendingPanel.removeNewRow', {
                      rang: modification.rang,
                    })}
                    onClick={() => onRetirer(modification.cle, '')}
                  >
                    <Icon name="x" size={11} strokeWidth={2.4} />
                  </button>
                </div>
                {/* **Aucun diff : il n'y a pas d'avant.** Une ligne ajoutée se lit comme une liste de
                    valeurs, et les colonnes absentes n'y figurent pas — ce sont celles que la base
                    remplira, et les montrer vides les ferait passer pour nulles. */}
                <ul className={styles.valeurs}>
                  {Object.entries(modification.valeurs).map(([column, saisie]) => (
                    <li key={column} className={styles.valeur}>
                      <span className={styles.colonne}>{column}</span>
                      <Apres saisie={saisie} />
                    </li>
                  ))}
                  {Object.keys(modification.valeurs).length === 0 && (
                    <li className={styles.valeur}>
                      <span className={styles.vide}>
                        {t('tableView.pendingPanel.noValueEntered')}
                      </span>
                    </li>
                  )}
                </ul>
              </li>
            ) : modification.sorte === 'suppression' ? (
              <li key={modification.cle} className={styles.carte}>
                <div className={styles.carteEntete}>
                  <span className={styles.position}>
                    {t('tableView.pendingPanel.rowPosition', {
                      rang: modification.rang,
                      cle: modification.cle,
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.retirer}
                    aria-label={t('tableView.pendingPanel.cancelDeletion', {
                      rang: modification.rang,
                    })}
                    onClick={() => onRetirer(modification.cle, '')}
                  >
                    <Icon name="x" size={11} strokeWidth={2.4} />
                  </button>
                </div>
                <p className={styles.vide}>{t('tableView.pendingPanel.willBeDeleted')}</p>
              </li>
            ) : (
              <li key={`${modification.cle}::${modification.column}`} className={styles.carte}>
                <div className={styles.carteEntete}>
                  {/* Le rang **et** la clé : le rang situe la ligne à l'écran, la clé l'identifie
                      quand un tri l'aura déplacée (`11a`). */}
                  <span className={styles.position}>
                    {t('tableView.pendingPanel.rowPosition', {
                      rang: modification.rang,
                      cle: modification.cle,
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.retirer}
                    aria-label={t('tableView.pendingPanel.removeCellChange', {
                      column: modification.column,
                    })}
                    onClick={() => onRetirer(modification.cle, modification.column)}
                  >
                    <Icon name="x" size={11} strokeWidth={2.4} />
                  </button>
                </div>
                <div className={styles.colonne}>{modification.column}</div>
                <div className={styles.diff}>
                  <Avant valeur={modification.avant} />
                  <Icon name="chevr" size={10} strokeWidth={2.4} className={styles.fleche} />
                  <Apres saisie={modification.apres} />
                </div>
              </li>
            ),
          )}
        </ul>

        {!apresEcriture && (
          <section className={styles.bloc}>
            <div className={styles.blocEntete}>
              <span className={styles.blocTitre}>{t('tableView.pendingPanel.sqlToRun')}</span>
              {onCopierLeSQL && sql !== null && (
                <button type="button" className={styles.copier} onClick={onCopierLeSQL}>
                  <Icon name="copy" size={11} strokeWidth={2} />
                  {t('tableView.pendingPanel.copy')}
                </button>
              )}
            </div>
            {erreurSql !== null ? (
              <p className={styles.absent} role="alert">
                {erreurSql}
              </p>
            ) : sql === null ? (
              // **Pas de SQL fabriqué en attendant.** Un texte plausible affiché sous ce titre serait
              // pire qu'une absence : c'est le dernier endroit où l'on vérifie avant d'écrire.
              <p className={styles.absent}>{t('tableView.pendingPanel.preparingQuery')}</p>
            ) : (
              <SqlColore texte={sql} />
            )}
          </section>
        )}

        {refus !== null && (
          <p className={styles.refus} role="alert">
            {refus}
          </p>
        )}

        {patchInverse !== null && (
          // **Après le succès, de quoi défaire.** Le montrer est le minimum honnête : `A10`
          // promettra de le garder 24 h, et annoncer cette garantie sans la tenir serait pire que ne
          // rien annoncer.
          <section className={styles.bloc}>
            <div className={styles.blocEntete}>
              <span className={styles.blocTitre}>{t('tableView.pendingPanel.undoSql')}</span>
              {onCopierLePatch && (
                <button type="button" className={styles.copier} onClick={onCopierLePatch}>
                  <Icon name="copy" size={11} strokeWidth={2} />
                  {t('tableView.pendingPanel.copy')}
                </button>
              )}
            </div>
            <SqlColore texte={patchInverse} />
            <p className={styles.rappelPatch}>{t('tableView.pendingPanel.undoSqlNote')}</p>
          </section>
        )}

        {/* **L'encart rouge de production est parti** (#168) : une connexion en lecture seule
            n'a pas de modifications en attente — l'écran n'entre pas en mode édition, et le cœur
            refuse d'écrire —, donc il n'y a plus rien à annoncer ici. */}
      </div>

      <footer className={styles.pied}>
        <span className={styles.cible}>{table}</span>
        {apresEcriture ? (
          // Rien à annuler ni à appliquer : l'écriture a eu lieu. Le seul geste restant est
          // d'écarter le rapport pour revenir à la lecture.
          <button type="button" className={styles.annuler} onClick={onEcarterLePatch}>
            {t('tableView.pendingPanel.close')}
          </button>
        ) : (
          <>
            {/* Le pied est là où l'on arrive après avoir relu le diff : « Tout annuler » et
            « Appliquer » vivent ensemble, à portée du geste qui suit la lecture. */}
            <button
              type="button"
              className={styles.annuler}
              onClick={onToutAnnuler}
              disabled={enCours}
            >
              {t('tableView.pendingPanel.cancelAll')}
            </button>
            <button
              type="button"
              className={styles.appliquer}
              onClick={onAppliquer}
              disabled={onAppliquer === undefined || enCours}
              title={
                onAppliquer === undefined
                  ? t('tableView.pendingPanel.applyDisabledReason')
                  : undefined
              }
            >
              <Icon name="check" size={12} strokeWidth={2.6} />
              {enCours ? t('tableView.pendingPanel.writing') : t('tableView.pendingPanel.apply')}
              <span className={styles.raccourci}>{raccourci('↩')}</span>
            </button>
          </>
        )}
      </footer>
    </aside>
  )
}

/**
 * L'ancienne valeur, barrée, **avec sa forme**.
 *
 * Trois natures, trois rendus, et c'est ce qui rend le diff lisible : « `NULL` → valeur » et
 * « `''` → valeur » sont deux changements différents qu'un rendu unique confondrait.
 */
function Avant({ valeur }: { valeur: Value }) {
  if (valeur.kind === 'null') {
    return <span className={cx(styles.jeton, styles.avant, styles.nul)}>NULL</span>
  }
  const texte = brut(valeur)
  return (
    <span className={cx(styles.jeton, styles.avant)}>
      {texte === '' ? <span className={styles.vide}>''</span> : texte}
    </span>
  )
}

function Apres({ saisie }: { saisie: Saisie }) {
  if (saisie.kind === 'null') {
    return <span className={cx(styles.jeton, styles.apres, styles.nul)}>NULL</span>
  }
  return (
    <span className={cx(styles.jeton, styles.apres)}>
      {saisie.texte === '' ? <span className={styles.vide}>''</span> : saisie.texte}
    </span>
  )
}

/**
 * La valeur d'origine en texte brut.
 *
 * Volontairement **non formatée** — pas de groupement des milliers : le diff montre ce que la base
 * contient et ce qui partira, et « 12 900 → 12901 » ferait douter d'une valeur pourtant juste.
 */
function brut(valeur: Value): string {
  switch (valeur.kind) {
    case 'null':
      return 'NULL'
    case 'bool':
      return valeur.value ? 'true' : 'false'
    case 'int':
    case 'float':
      return String(valeur.value)
    case 'decimal':
    case 'text':
    case 'timestamp':
    case 'json':
      return valeur.value
    case 'binary':
      return valeur.base64
  }
}

/** Le type est exporté pour les tests de l'écran, qui construisent des modifications. */
export type { Modification }
