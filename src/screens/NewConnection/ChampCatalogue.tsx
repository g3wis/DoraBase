/**
 * Un champ du visage Kubernetes qui **propose** ce que le cluster contient, et reste saisissable
 * quand il ne peut rien proposer (`API-73`).
 *
 * # Le contrôle suit ce qu'on sait, et il y a toujours un chemin
 *
 * Une liste quand une lecture a rendu des noms ; un champ de saisie sinon — poste sans `kubectl`,
 * cluster injoignable, rôle sans droit de lister, espace de noms sans le moindre pod, ou objet qui
 * n'existe **pas encore**, ce dernier cas étant le plus ordinaire de tous. C'est la décision
 * d'`API-73` : « no writing pod/xxxx » vaut pour le geste courant, il ne peut pas valoir pour un
 * formulaire qu'on remplit hors ligne ou avant que le pod soit créé.
 *
 * Les deux sens ont **un** geste chacun, et un seul : la liste porte « Saisir à la main… », le champ
 * porte un bouton « Choisir dans la liste ». Ce bouton est aussi ce qui **réessaie** après un échec —
 * une seconde commande « Réessayer » aurait dit deux fois la même chose, puisque vouloir la liste et
 * vouloir qu'on la relise sont le même souhait.
 */
import { useId } from 'react'
import { useT } from '../../i18n/LanguageContext'
import { Field } from '../../ui/Field/Field'
import { Select } from '../../ui/Select/Select'
import styles from './NewConnection.module.css'
import { A_LA_MAIN, optionsDeCatalogue, RAFRAICHIR } from './ressourceKubernetes'
import type { Piste } from './useCatalogueKubernetes'

type ChampCatalogueProps = {
  label: string
  value: string
  /**
   * L'origine dit **d'où vient** la valeur, et l'appelant en a besoin.
   *
   * Choisir un espace de noms dans la liste doit relire les ressources ; le taper ne doit rien
   * relire, sans quoi `prod` enverrait quatre requêtes authentifiées. Le champ est le seul à savoir
   * lequel des deux vient d'arriver.
   */
  onChange: (valeur: string, origine: 'liste' | 'saisie') => void
  /** La liste et ses trois gestes. */
  piste: Piste
  /** Faux quand l'hôte ne sait rien demander : le champ redevient ce qu'il était avant `API-73`. */
  disponible: boolean
  placeholder?: string
  /** Le libellé de l'entrée du vide, quand le vide est une valeur. Voir `optionsDeCatalogue`. */
  videLibelle?: string | null
  /** Ce qu'on dit d'une lecture qui n'a rendu aucun nom — la phrase diffère selon le champ. */
  videMessage: string
  /** Une aide de l'appelant, jointe à celle que ce champ rend lui-même. */
  aideId?: string
}

export function ChampCatalogue({
  label,
  value,
  onChange,
  piste,
  disponible,
  placeholder,
  videLibelle = null,
  videMessage,
  aideId,
}: ChampCatalogueProps) {
  const t = useT()
  const monAideId = useId()

  if (piste.enListe && piste.liste.etat === 'lue') {
    return (
      <Select
        label={label}
        size="sm"
        options={optionsDeCatalogue(piste.liste.noms, value, t, videLibelle)}
        value={value}
        onValueChange={(choix) => {
          // Les deux entrées qui **agissent** plutôt que de désigner, comme « Autre fichier… » de la
          // liste de kubeconfigs juste au-dessus : elles ne peuvent pas entrer en collision avec un
          // nom Kubernetes, qui ne commence jamais par un tiret.
          if (choix === RAFRAICHIR) {
            piste.relire()
            return
          }
          if (choix === A_LA_MAIN) {
            piste.saisirALaMain()
            return
          }
          onChange(choix, 'liste')
        }}
      />
    )
  }

  // Ce que le champ a à dire de la lecture : rien quand l'hôte ne sait pas demander — c'est
  // l'état de la galerie et des tests, où annoncer une panne serait mentir.
  const aide = !disponible
    ? null
    : piste.liste.etat === 'echec'
      ? t('newConnection.tunnel.catalogueEchec', { raison: piste.liste.raison })
      : piste.liste.etat === 'lue'
        ? videMessage
        : null

  const enLecture = piste.liste.etat === 'lecture'
  // Vide plutôt qu'un attribut vide : `aria-describedby=""` désigne un élément qui n'existe pas.
  const decrivent = [aideId, aide === null ? undefined : monAideId].filter(Boolean).join(' ')

  return (
    <>
      <Field
        label={label}
        size="sm"
        mono
        {...(placeholder === undefined ? {} : { placeholder })}
        value={value}
        onChange={(event) => onChange(event.target.value, 'saisie')}
        {...(decrivent === '' ? {} : { 'aria-describedby': decrivent })}
        suffix={
          disponible ? (
            <button
              type="button"
              className={styles.browse}
              onClick={piste.choisirDansLaListe}
              disabled={enLecture}
            >
              {enLecture
                ? t('newConnection.tunnel.catalogueEnLecture')
                : t('newConnection.tunnel.catalogueChoisir')}
            </button>
          ) : undefined
        }
      />
      {aide !== null && (
        <p id={monAideId} className={styles.tunnelHint}>
          {aide}
        </p>
      )}
    </>
  )
}
