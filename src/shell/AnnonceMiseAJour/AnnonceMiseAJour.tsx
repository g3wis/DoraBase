import { useEffect, useRef, useState } from 'react'
import { checkUpdate } from '../../data/commandes'
import { Icon } from '../../design/icons/Icon'
import type { AvailableUpdate } from '../../domain/maj'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { aUneVoieDeMiseAJour, type Plateforme, plateforme } from '../plateforme'
import styles from './AnnonceMiseAJour.module.css'

/**
 * La recherche, mémorisée par fonction de recherche.
 *
 * **« Une seule recherche au démarrage » est une propriété du produit.** L'annonce n'est plus montée
 * qu'une fois — au niveau de l'application, non plus dans trois barres d'état —, donc la mémoïsation
 * ne rattrape plus des remontages d'onglet ; ce qu'elle garde est le double effet de `StrictMode` en
 * développement, qui ferait deux requêtes là où le produit en promet une.
 *
 * **La clef est la fonction**, et non une constante : `checkUpdate` est une référence de module,
 * donc stable pour toute la session. Les tests, eux, passent une fermeture neuve à chaque `render`,
 * donc chacun garde sa propre recherche et son isolement.
 *
 * Un rejet reste mémorisé, et c'est voulu : hors ligne au démarrage, on ne réessaie pas — c'est
 * exactement ce que « aucune recherche périodique » veut dire.
 */
const recherches = new WeakMap<
  () => Promise<AvailableUpdate | null>,
  Promise<AvailableUpdate | null>
>()

function rechercheUnique(
  chercher: () => Promise<AvailableUpdate | null>,
): Promise<AvailableUpdate | null> {
  const dejaLancee = recherches.get(chercher)
  if (dejaLancee !== undefined) return dejaLancee
  const lancee = chercher()
  recherches.set(chercher, lancee)
  return lancee
}

type AnnonceMiseAJourProps = {
  /** Injectée, comme tout ce qui touche à l'IPC : le pont ne répond pas hors de la webview. */
  chercher?: () => Promise<AvailableUpdate | null>
  /**
   * La plateforme, paramètre pour la raison de `shell/plateforme` : `__APP_PLATFORM__` est figé
   * à la compilation, donc sans elle une seule des deux branches ci-dessous serait jamais
   * exercée.
   */
  sur?: Plateforme
  /**
   * « Installer » **n'installe pas ici** : il mène à la section « Mises à jour » des préférences, en
   * lui passant la recherche déjà faite. L'installation demande les notes de la release, un
   * avertissement de redémarrage et un état d'échec — trois choses que `A10` porte déjà, et qu'une
   * notification de coin d'écran redirait moins bien.
   */
  onInstaller: (maj: AvailableUpdate) => void
}

/**
 * « La version X est disponible », en bas à droite (2 septembre 2026).
 *
 * **Elle remplace la ligne des barres d'état**, qui a vécu du 26 août au 2 septembre. Le reproche
 * était juste : sur l'écran d'accueil — aucun projet ouvert, donc rien à faire — la seule phrase de
 * la barre qui ne décrivait pas l'application invitait à la mettre à jour, glissée entre le compte
 * de projets et le numéro de version. Une bande de 26 px n'a pas de place pour distinguer ce qui
 * *décrit* de ce qui *demande*.
 *
 * **Rien ne s'affiche par défaut, et c'est la propriété qui compte** — elle est reprise telle quelle
 * de l'ancienne annonce. Hors de la webview — la galerie, `?demo`, tout Playwright — `checkUpdate`
 * est rejetée, l'état reste `null`, et le composant ne rend rien. Aucune capture de fidélité ne
 * bouge, et il n'y a pas de variante de décor à maintenir pour ça.
 *
 * **Un seul montage, au niveau de l'application**, et c'est ce qui referme le trou que le montage en
 * trois barres laissait : un onglet de console n'a aucune barre au niveau de l'écran, donc n'avait
 * aucune annonce. Une notification en `position: fixed` ne dépend d'aucune composition d'écran.
 *
 * **Écartée, elle ne revient pas de la session** — et il n'y a rien à persister : la recherche n'a
 * lieu qu'au démarrage, donc le prochain lancement la refera de toute façon, et se souvenir d'un
 * refus reviendrait à taire une version que l'utilisateur n'a pas encore installée.
 *
 * **Et sur une plateforme sans voie de mise à jour, elle ne cherche rien** (4 septembre 2026).
 * `latest.json` ne porte que les deux clefs `darwin-*` : sous Windows et sous Linux le plugin
 * échoue sur « the platform … was not found », donc l'annonce serait de toute façon muette — mais
 * elle aurait payé une requête réseau au démarrage pour une réponse connue d'avance. C'est le même
 * arbitrage que « aucune recherche périodique », un cran plus tôt : ce qui ne peut rien apprendre
 * ne se demande pas. Le pendant qui se **voit** est dans `A10`, où le bouton est désactivé avec sa
 * raison ; ici il n'y a rien à dire, l'annonce ne rendant déjà rien.
 */
export function AnnonceMiseAJour({
  chercher = checkUpdate,
  onInstaller,
  sur = plateforme(),
}: AnnonceMiseAJourProps) {
  const t = useT()
  const [disponible, setDisponible] = useState<AvailableUpdate | null>(null)
  const [ecartee, setEcartee] = useState(false)
  // Le composant vit aussi longtemps que l'application, mais React le démonte deux fois en
  // développement (`StrictMode`) : sans ce garde, la seconde réponse écrit dans un état mort.
  const monte = useRef(true)

  useEffect(() => {
    // Avant le témoin de montage : sans voie de mise à jour il n'y a ni requête à lancer ni
    // réponse à attendre, donc rien à nettoyer.
    if (!aUneVoieDeMiseAJour(sur)) return
    monte.current = true
    rechercheUnique(chercher)
      .then((trouvee) => {
        if (monte.current) setDisponible(trouvee)
      })
      // **Le silence est le comportement voulu**, pas un oubli : voir `checkUpdate`. On ne dérange
      // personne pour une requête qu'il n'a pas demandée ; le bouton d'`A10`, lui, dit ses échecs.
      .catch(() => {})
    return () => {
      monte.current = false
    }
  }, [chercher, sur])

  if (disponible === null || ecartee) return null

  return (
    // `role="status"` : elle paraît sans que rien n'ait été cliqué, donc elle doit s'annoncer sans
    // voler le focus. Ce n'est pas une alerte — elle attend, elle n'interrompt pas.
    <div className={styles.annonce} role="status" aria-label={t('shell.annonceMaj.ariaLabel')}>
      <p className={styles.texte}>
        {t('shell.annonceMaj.avant')} <strong>{disponible.version}</strong>{' '}
        {t('shell.annonceMaj.apres')}
      </p>
      <Button
        size="sm"
        onClick={() => {
          // Écartée avant d'ouvrir : la modale la couvrirait, et la retrouver en la fermant ferait
          // redemander ce qu'on vient d'aller faire.
          setEcartee(true)
          onInstaller(disponible)
        }}
      >
        {t('shell.annonceMaj.installer')}
      </Button>
      {/* **En haut à droite, donc au-dessus du bouton et non à côté.** Deux actions côte à côte se
          pèsent l'une l'autre ; celles-ci ne se valent pas — l'une mène quelque part, l'autre range
          la notification. */}
      <button
        type="button"
        className={styles.fermer}
        onClick={() => setEcartee(true)}
        aria-label={t('shell.annonceMaj.ecarter')}
      >
        <Icon name="x" size={13} strokeWidth={1.9} />
      </button>
    </div>
  )
}
