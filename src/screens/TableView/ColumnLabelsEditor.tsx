import { useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { SANS_CORRECTION } from '../../ui/Field/Field'
import { Modal } from '../../ui/Modal/Modal'
import styles from './ColumnLabelsEditor.module.css'
import {
  type LibellesDeColonne,
  type LigneDeLibelle,
  libellesDepuisLesLignes,
  lignesDepuisLesLibelles,
} from './libelles'

type ColumnLabelsEditorProps = {
  /** La table, annoncée dans l'en-tête : c'est le **cadre** de ce qu'on déclare, pas un champ. */
  table: string
  colonne: string
  /** Les libellés déjà déclarés, tels que le projet les porte. */
  libelles: LibellesDeColonne
  onClose: () => void
  /** Enregistre. Rejette avec le refus à afficher — le disque, un projet retiré entre-temps. */
  onEnregistrer: (libelles: Record<string, string>) => Promise<void>
}

/** Une ligne vide : ce qu'on ajoute, et ce qu'un éditeur ouvert sur rien montre déjà. */
const VIDE: LigneDeLibelle = { valeur: '', libelle: '' }

/**
 * L'éditeur des libellés de valeurs d'une colonne (`API-75`).
 *
 * # Pourquoi il s'ouvre du menu de l'en-tête
 *
 * **C'est le palier qui connaît son contexte.** La table et la colonne sont déjà désignées par le
 * clic droit : rien ne se saisit deux fois, et rien ne peut viser à côté. La même déclaration faite
 * depuis la modale de projet aurait demandé de taper un nom de table et un nom de colonne à la
 * main, sans rien pour les vérifier — et une faute de frappe y aurait produit une déclaration
 * silencieusement inerte, la famille du `var()` vers un jeton inexistant. C'est la règle qui a déjà
 * fait partir la création de console du pied de la sidebar et la gestion des schémas vers le menu
 * d'une connexion.
 *
 * # Ce qui attend « Enregistrer »
 *
 * Un libellé est une **préférence**, comme les schémas affichés d'`API-33` : elle se règle, puis on
 * valide. C'est l'écart avec la modale de projet, dont chaque geste part au relâchement du champ —
 * là-bas un geste est un acte (renommer, recolorier), ici la liste n'a de sens qu'entière. Écrire à
 * la frappe ferait une écriture de configuration par caractère tapé.
 *
 * # Ce qu'il refuse, et pourquoi il le refuse plutôt que de l'accepter
 *
 * Une valeur qui n'est pas un entier, et une valeur en double. Les deux produiraient une
 * déclaration qui **ne dit rien** — l'une ne correspondrait à aucune cellule, l'autre serait
 * écrasée en silence par sa jumelle —, et rien ne le dénoncerait ensuite : l'éditeur est le seul
 * endroit qui puisse le dire, puisque c'est le seul qui voie la liste avant qu'elle devienne une
 * table. Voir `libellesDepuisLesLignes`, qui porte les trois règles.
 */
export function ColumnLabelsEditor({
  table,
  colonne,
  libelles,
  onClose,
  onEnregistrer,
}: ColumnLabelsEditorProps) {
  const t = useT()
  /**
   * L'état initial, calculé **une fois** : l'éditeur est une copie de travail, et c'est tout
   * l'intérêt d'un formulaire qui attend « Enregistrer ». Une ligne vide quand rien n'est déclaré —
   * sinon l'éditeur s'ouvrirait sur une liste sans rien où taper, et il faudrait un clic pour
   * commencer ce qu'on est venu faire.
   */
  const [lignes, setLignes] = useState<LigneDeLibelle[]>(() => {
    const existantes = lignesDepuisLesLibelles(libelles)
    return existantes.length === 0 ? [VIDE] : existantes
  })
  const [refus, setRefus] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const modifier = (rang: number, champ: keyof LigneDeLibelle, valeur: string) =>
    setLignes((precedent) =>
      precedent.map((ligne, index) => (index === rang ? { ...ligne, [champ]: valeur } : ligne)),
    )

  /**
   * Retirer la dernière ligne la **vide** au lieu de la faire disparaître.
   *
   * Un éditeur sans aucune ligne n'aurait plus rien où taper, et « Ajouter une valeur » serait le
   * seul geste restant : le bouton de retrait aurait alors mené à une impasse dont il faut sortir
   * par un autre bouton. Vider mène au même enregistrement — une liste sans entrée retire la
   * déclaration — sans fermer le chemin.
   */
  const retirer = (rang: number) =>
    setLignes((precedent) =>
      precedent.length === 1 ? [VIDE] : precedent.filter((_, index) => index !== rang),
    )

  async function enregistrer() {
    const verdict = libellesDepuisLesLignes(lignes)
    if (!verdict.ok) {
      setRefus(t(`tableView.labels.refus.${verdict.refus}`, { valeur: verdict.valeur }))
      return
    }
    setRefus(null)
    setEnCours(true)
    try {
      await onEnregistrer(verdict.libelles)
      onClose()
    } catch (erreur) {
      setRefus(erreur instanceof Error ? erreur.message : String(erreur))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modal
      title={t('tableView.labels.title', { column: colonne })}
      icon="msg"
      /* La table **dans la bande d'en-tête**, à droite du titre : c'est le cadre de la
         déclaration et non un de ses champs — l'arbitrage du projet dans la modale de connexion. */
      contexte={<span className={styles.cadre}>{table}</span>}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={enCours}>
            {t('tableView.labels.cancel')}
          </Button>
          <Button variant="dark" size="md" onClick={() => void enregistrer()} disabled={enCours}>
            {enCours ? t('tableView.labels.saving') : t('tableView.labels.save')}
          </Button>
        </>
      }
    >
      <div className={styles.corps}>
        {/* **Ce que la déclaration fait, et ce qu'elle ne fait pas.** La seconde moitié est celle
            qui compte : rien ici ne change ce qui est stocké, et sans le dire on laisserait croire
            qu'enregistrer des libellés écrit dans la base. */}
        <p className={styles.note}>{t('tableView.labels.note')}</p>

        <div className={styles.lignes}>
          {/* Les deux en-têtes sont des `<span>` et non des `<th>` : ce n'est pas un tableau de
              données mais un formulaire, et chaque champ porte déjà son nom accessible — le rang,
              jamais la valeur saisie, qui ferait changer le nom d'un contrôle sous les doigts
              (piège n° 5). */}
          <span className={styles.entete}>{t('tableView.labels.value')}</span>
          <span className={styles.entete}>{t('tableView.labels.label')}</span>
          <span />

          {lignes.map((ligne, rang) => (
            // L'index comme clé : ces lignes n'ont pas d'identité propre — la valeur se saisit,
            // donc elle est vide au départ et change ensuite. Réordonner n'existe pas ici.
            // biome-ignore lint/suspicious/noArrayIndexKey: une ligne de saisie n'a pas d'identité
            <div className={styles.ligne} key={rang}>
              <input
                className={styles.valeur}
                {...SANS_CORRECTION}
                /* `inputMode` et non `type="number"` : celui-ci apporte des flèches d'incrément et
                   une validation du navigateur qui viderait le champ à la première saisie
                   intermédiaire, là où le refus est déjà dit par l'éditeur et nomme la valeur. */
                inputMode="numeric"
                aria-label={t('tableView.labels.valueOfRow', { rang: rang + 1 })}
                value={ligne.valeur}
                onChange={(evenement) => modifier(rang, 'valeur', evenement.target.value)}
              />
              <input
                className={styles.libelle}
                {...SANS_CORRECTION}
                aria-label={t('tableView.labels.labelOfRow', { rang: rang + 1 })}
                value={ligne.libelle}
                onChange={(evenement) => modifier(rang, 'libelle', evenement.target.value)}
              />
              <button
                type="button"
                className={styles.retirer}
                aria-label={t('tableView.labels.removeRow', { rang: rang + 1 })}
                onClick={() => retirer(rang)}
              >
                <Icon name="x" size={11} strokeWidth={2.2} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className={styles.ajouter}
          onClick={() => setLignes((p) => [...p, VIDE])}
        >
          <Icon name="plus" size={11} strokeWidth={2.2} />
          {t('tableView.labels.add')}
        </button>

        {/* `role="alert"` : le refus arrive **après** un clic sur « Enregistrer », donc une voix
            doit l'annoncer sans qu'on aille le chercher. Il ne paraît que s'il y a de quoi — une
            bande vide se lirait comme une réserve. */}
        {refus !== null && (
          <p className={styles.refus} role="alert">
            {refus}
          </p>
        )}
      </div>
    </Modal>
  )
}
