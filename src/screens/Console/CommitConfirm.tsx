import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
// **La feuille de style de `RunConfirm`, et non une copie** : les deux modales sont celles du même
// écran, avec la même coquille, la même échelle et les mêmes blocs — un récapitulatif, une alerte,
// un rappel, un pied. Un second fichier de soixante lignes identiques se serait réparé une fois sur
// deux. Ce qui reste interdit est l'inverse : habiller une primitive de `ui/` avec la CSS d'un écran.
import styles from './RunConfirm.module.css'
import type { ValidationADemander } from './useTransaction'

type CommitConfirmProps = {
  validation: ValidationADemander
  /** La base visée, pour que la confirmation dise *où* la transaction va s'écrire. */
  cible: string
  /** Vrai quand l'environnement de la connexion est **marqué production** (`23g`). */
  production: boolean
  onClose: () => void
  onConfirmer: () => void
  enCours?: boolean
}

/**
 * La confirmation d'une validation de transaction (`API-38`).
 *
 * # Pourquoi elle a remplacé la confirmation de chaque écriture
 *
 * En transaction manuelle, une requête qui écrit n'écrit rien : elle entre dans la transaction, le
 * panneau la liste, et **la validation** est le moment où l'on s'engage. Confirmer les deux ferait
 * cliquer deux fois pour un seul engagement — et le premier clic, celui qu'on fait vingt fois, ne
 * protégerait de rien. La confirmation a donc suivi le geste qui compte.
 *
 * Une exception, portée par `useExecution` : une modification de **structure** garde la sienne,
 * parce qu'une transaction ne la retient pas toujours — MySQL valide d'office ce qui attend avant de
 * l'exécuter.
 *
 * # Elle récapitule ce qui devient définitif
 *
 * Le compte d'instructions, les verbes des écritures, la cible, et le `where` manquant s'il en
 * manque un. Le panneau derrière elle porte déjà la liste : la modale ne la redit pas, elle en donne
 * la mesure — « 2 DELETE, dont un sans WHERE » est ce qui fait s'apercevoir qu'on s'est trompé.
 *
 * # Et ce que le panneau ne montre pas
 *
 * Une console ne voit que ses propres instructions ; un `commit` emporte la transaction **entière**,
 * une connexion n'ayant qu'une session. Quand une voisine y a mis quelque chose, cette modale le
 * dit — le nombre, non les requêtes, dont les verbes ne sont pas connus de cette console.
 *
 * **C'est aussi ce qui la fait paraître alors que rien n'a été écrit ici.** Une transaction où l'on
 * n'a fait que lire n'a rien à confirmer ; une transaction qui porte des instructions qu'on ne voit
 * pas en a, puisque rien ne dit qu'elles ne sont que des lectures. Le bouton compte alors la
 * transaction plutôt que des écritures qu'il ne peut pas compter.
 */
export function CommitConfirm({
  validation,
  cible,
  production,
  onClose,
  onConfirmer,
  enCours = false,
}: CommitConfirmProps) {
  const t = useT()

  return (
    <Modal title={t('console.commitConfirm.titre')} icon="warn" nested onClose={onClose}>
      <div className={styles.corps}>
        {/* **Le fait le plus coûteux en premier**, comme dans la confirmation d'une requête isolée :
            un `update` sans `where` touche toute la table, et le noyer au milieu d'un récapitulatif
            reviendrait à ne pas le dire. */}
        {validation.sansRestriction && (
          <p className={styles.alerte}>
            {t('console.commitConfirm.sansRestrictionAvant')}
            <strong>WHERE</strong>
            {t('console.commitConfirm.sansRestrictionApres')}
          </p>
        )}
        {/* **Ce que le panneau ne montre pas, et que ce clic emporte.** Après le `where` manquant,
            qui reste le fait le plus coûteux, et avant le récapitulatif : c'est une phrase, non une
            ligne de compte — elle doit dire *pourquoi* ce nombre n'est pas dans la liste. */}
        {validation.etrangeres > 0 && (
          <p className={styles.alerte}>
            {t('console.commitConfirm.etrangeres', { n: validation.etrangeres })}
          </p>
        )}
        <dl className={styles.recap}>
          {/* **Absente quand cette console n'a rien écrit** : une rangée « Écritures » vide se
              lirait comme une écriture qu'on n'a pas su nommer. Le cas existe — la confirmation
              paraît aussi pour les instructions d'une voisine, dont les verbes sont inconnus
              d'ici — et c'est la phrase ci-dessus qui le dit alors. */}
          {validation.ecritures.length > 0 && (
            <div className={styles.entree}>
              <dt>{t('console.commitConfirm.ecritures')}</dt>
              {/* Les verbes, dans l'ordre où ils ont été joués — « DELETE, UPDATE » et non « 2
                  écritures » : c'est ce qui distingue deux corrections d'une suppression. */}
              <dd className={styles.mono}>{validation.ecritures.join(', ')}</dd>
            </div>
          )}
          <div className={styles.entree}>
            <dt>{t('console.commitConfirm.instructions')}</dt>
            <dd>{validation.instructions}</dd>
          </div>
          <div className={styles.entree}>
            <dt>{t('console.commitConfirm.base')}</dt>
            <dd className={styles.mono}>{cible}</dd>
          </div>
          {production && (
            <div className={styles.entree}>
              <dt>{t('console.commitConfirm.environnement')}</dt>
              <dd className={styles.prod}>{t('console.commitConfirm.production')}</dd>
            </div>
          )}
        </dl>
        {/* Ce que DoraBase ne fera pas. Une validation ne se défait par aucun geste du produit : il
            n'y a pas de patch inverse ici, contrairement à `11d`, et le dire est le minimum
            honnête — laisser croire à un filet qui n'existe pas serait pire que se taire. */}
        <p className={styles.rappel}>{t('console.commitConfirm.rappel')}</p>
      </div>
      <div className={styles.pied}>
        <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
          {t('console.commitConfirm.annuler')}
        </Button>
        {/* Le verbe du geste, comme en `08j` et `11d` : un bouton qui nomme son acte est la dernière
            chance de lire ce qu'on fait. */}
        <Button variant="dark" size="md" onClick={onConfirmer} disabled={enCours}>
          {enCours
            ? t('console.commitConfirm.enCours')
            : validation.ecritures.length > 0
              ? t('console.commitConfirm.confirmer', { n: validation.ecritures.length })
              : // **Jamais « Valider 0 écriture »** : le bouton emporte bel et bien quelque chose —
                // les instructions d'une voisine —, et un zéro dirait le contraire.
                t('console.commitConfirm.confirmerSansEcriture')}
        </Button>
      </div>
    </Modal>
  )
}
