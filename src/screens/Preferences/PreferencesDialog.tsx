import { useState } from 'react'
import { checkUpdate, installUpdate } from '../../data/commandes'
import { Icon } from '../../design/icons/Icon'
import type { IconName } from '../../design/icons/names'
import type { Guards, Preferences, Theme } from '../../domain/config'
import type { AvailableUpdate } from '../../domain/maj'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { Toggle } from '../../ui/Toggle/Toggle'
import styles from './PreferencesDialog.module.css'
import {
  borner,
  CORPS_MAX,
  CORPS_MIN,
  HAUTEUR_MAX,
  hauteurMinimalePour,
  LANGUES,
  PALETTE,
  PREFERENCES_PAR_DEFAUT,
  THEMES,
} from './preferences'

type PreferencesDialogProps = {
  preferences: Preferences
  /**
   * Applique un réglage. **Appelé à chaque changement**, pas à la fermeture.
   *
   * « Les préférences s'appliquent immédiatement », dit le mockup, et cela engage : il n'y a pas de
   * bouton « Appliquer », donc pas de formulaire tampon. « Terminé » ferme, il ne valide pas.
   */
  onChange: (preferences: Preferences) => void
  onClose: () => void
  /** La version affichée en pied de sidebar — `DoraBase 0.4.2 (arm64)`. */
  version: string
  /**
   * Injectées, comme tout ce qui touche à l'IPC : le pont ne répond pas hors de la webview.
   * Les tests et la galerie passent les leurs ; l'application laisse les commandes réelles.
   */
  chercherMiseAJour?: () => Promise<AvailableUpdate | null>
  installerMiseAJour?: () => Promise<void>
  /**
   * La section ouverte au montage. Par défaut « Apparence », la seule du mockup qui ait du contenu.
   *
   * **Elle existe pour la notification de mise à jour** (2 septembre 2026) : son bouton « Installer »
   * mène ici, et ouvrir sur « Apparence » obligerait à chercher la section qu'on vient de demander.
   */
  sectionInitiale?: Section
  /**
   * Une recherche de mise à jour **déjà faite ailleurs**, reprise telle quelle.
   *
   * Sans elle, arriver depuis la notification demanderait de recliquer « Rechercher » pour réafficher
   * ce que la notification venait de dire — et de refaire une requête pour une réponse connue.
   * `null` laisse la section sur « pas encore cherché », qui n'est pas « à jour ».
   */
  majDejaTrouvee?: AvailableUpdate | null
}

/**
 * Les sections du mockup, dans son ordre, plus « Mises à jour » (26 août 2026).
 *
 * **« Éditeur SQL » et « Raccourcis » ont été retirées le 28 août 2026** : deux sections qui ne
 * portaient qu'une phrase « à venir », et sans date à laquelle ce contenu arrive. Elles
 * reviendront quand il y aura quelque chose à y régler.
 */
export type Section = 'general' | 'apparence' | 'grille' | 'connexions' | 'securite' | 'maj'

/**
 * L'écran de préférences de `A10` (`15a` → `15d`).
 *
 * **Deux des sections restantes n'ont rien à régler**, et elles le disent. Les cacher ferait
 * croire à une interface plus pauvre qu'elle ne sera ; les laisser vides ferait croire à un
 * défaut. C'est la règle de `09f`, appliquée à une section plutôt qu'à un bouton.
 */
export function PreferencesDialog({
  preferences,
  onChange,
  onClose,
  version,
  chercherMiseAJour = checkUpdate,
  installerMiseAJour = installUpdate,
  sectionInitiale = 'apparence',
  majDejaTrouvee = null,
}: PreferencesDialogProps) {
  const t = useT()

  const SECTIONS: readonly { cle: Section; nom: string; icone: IconName }[] = [
    { cle: 'general', nom: t('preferences.sections.general'), icone: 'gear' },
    { cle: 'apparence', nom: t('preferences.sections.apparence'), icone: 'paint' },
    { cle: 'grille', nom: t('preferences.sections.grille'), icone: 'cols' },
    { cle: 'connexions', nom: t('preferences.sections.connexions'), icone: 'srv' },
    { cle: 'securite', nom: t('preferences.sections.securite'), icone: 'shield' },
    // **En dernier, et après les cinq du mockup.** Ce n'est pas un réglage : rien ne s'y règle, on y
    // demande et on y installe. La placer parmi les sections de préférences la ferait chercher parmi
    // les cases à cocher, et la version que la sidebar affiche déjà juste en dessous en est le
    // voisinage naturel.
    { cle: 'maj', nom: t('preferences.sections.maj'), icone: 'dl' },
  ]

  // Le mockup ouvre sur « Apparence » : c'est la section qui a du contenu, et ouvrir sur « Général »
  // montrerait d'abord une section qui annonce ce qu'elle portera. C'est le défaut de la prop, que
  // seule la notification de mise à jour remplace aujourd'hui.
  const [section, setSection] = useState<Section>(sectionInitiale)
  const [aReinitialiser, setAReinitialiser] = useState(false)

  const regler = (partiel: Partial<Preferences>) => onChange(borner({ ...preferences, ...partiel }))
  const reglerUnGardeFou = (partiel: Partial<Guards>) =>
    onChange({ ...preferences, guards: { ...preferences.guards, ...partiel } })

  return (
    <Modal
      title={t('preferences.title')}
      icon="gear"
      onClose={onClose}
      compact
      className={styles.modale}
      footer={
        <div className={styles.pied}>
          {/* La phrase du mockup, et elle **engage** : pas de bouton « Appliquer ». */}
          <span className={styles.immediat}>{t('preferences.footer.immediat')}</span>
          <span className={styles.espace} />
          <Button variant="secondary" size="md" onClick={() => setAReinitialiser(true)}>
            {t('preferences.footer.reinitialiser')}
          </Button>
          <Button variant="dark" size="md" onClick={onClose}>
            {t('preferences.footer.termine')}
          </Button>
        </div>
      }
    >
      <div className={styles.corps}>
        {/* `role="tablist"` : six panneaux dont un seul est visible, ce qui est exactement ce que
            les onglets ARIA décrivent.
            **Les flèches sont écrites à la main, et il fallait qu'elles le soient.** Un rôle ARIA ne
            fournit aucun comportement : il *annonce* une convention, et c'est au code de la tenir.
            Un `tablist` sans navigation aux flèches est un mensonge à la voix — un lecteur d'écran
            annonce « onglet 1 sur 6 » et les flèches ne font rien. Un commentaire de ce fichier
            affirmait le contraire ; c'est le test Playwright qui l'a démenti. */}
        <div
          className={styles.sections}
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('preferences.tablistLabel')}
          onKeyDown={(evenement) => {
            const pas = evenement.key === 'ArrowDown' ? 1 : evenement.key === 'ArrowUp' ? -1 : 0
            if (pas === 0) return
            evenement.preventDefault()
            // **Le départ est l'onglet qui a le focus, pas celui qui est sélectionné.** Les deux
            // sont tenus en phase par ce gestionnaire, mais ils divergent dès qu'on porte le focus
            // ailleurs — au clic, ou par un `focus()`. Partir de la sélection faisait alors sauter
            // d'un onglet de trop, ce que le test Playwright a montré.
            const depuis =
              evenement.target instanceof HTMLElement
                ? (evenement.target.dataset.section ?? section)
                : section
            const rang = SECTIONS.findIndex((entree) => entree.cle === depuis)
            // Le parcours **boucle** : c'est la convention ARIA pour un `tablist`, et s'arrêter au
            // bout obligerait à revenir en sens inverse pour atteindre la première.
            const suivant = SECTIONS[(rang + pas + SECTIONS.length) % SECTIONS.length]
            if (!suivant) return
            setSection(suivant.cle)
            // Le focus suit la sélection : c'est le modèle « sélection automatique » des onglets,
            // celui que les flèches impliquent.
            evenement.currentTarget
              .querySelector<HTMLButtonElement>(`[data-section="${suivant.cle}"]`)
              ?.focus()
          }}
        >
          {SECTIONS.map((entree) => (
            <button
              key={entree.cle}
              type="button"
              role="tab"
              data-section={entree.cle}
              aria-selected={section === entree.cle}
              // **Un seul onglet dans l'ordre de tabulation**, l'actif : c'est la convention ARIA,
              // et sans elle six tabulations séparent la liste du panneau.
              tabIndex={section === entree.cle ? 0 : -1}
              className={section === entree.cle ? styles.sectionActive : styles.section}
              onClick={() => setSection(entree.cle)}
            >
              <Icon name={entree.icone} size={13} strokeWidth={1.9} />
              {entree.nom}
            </button>
          ))}
          <span className={styles.espace} />
          <span className={styles.version}>{version}</span>
        </div>

        <div className={styles.panneau} role="tabpanel">
          {section === 'apparence' && <Apparence preferences={preferences} onRegler={regler} />}
          {section === 'grille' && <Grille preferences={preferences} onRegler={regler} />}
          {section === 'securite' && (
            <GardeFous guards={preferences.guards} onRegler={reglerUnGardeFou} />
          )}
          {section === 'maj' && (
            <MisesAJour
              chercher={chercherMiseAJour}
              installer={installerMiseAJour}
              dejaTrouvee={majDejaTrouvee}
            />
          )}
          {section === 'general' && <General preferences={preferences} onRegler={regler} />}
          {section === 'connexions' && (
            <AVenir
              titre={t('preferences.sections.connexions')}
              porte={t('preferences.connexions.aVenir')}
            />
          )}
        </div>
      </div>

      {aReinitialiser && (
        <ReinitialisationConfirmee
          onClose={() => setAReinitialiser(false)}
          onConfirmer={() => {
            onChange(PREFERENCES_PAR_DEFAUT)
            setAReinitialiser(false)
          }}
        />
      )}
    </Modal>
  )
}

/**
 * « Général » : la langue de l'interface (26 août 2026, `general` n'avait jusque-là rien à régler).
 *
 * **Le reste que la section promettait — comportement au démarrage, ouverture automatique des
 * connexions — n'est toujours pas livré**, et le dit encore, sous la langue : livrer un réglage ne
 * doit pas faire disparaître ce qui reste annoncé.
 */
function General({
  preferences,
  onRegler,
}: {
  preferences: Preferences
  onRegler: (partiel: Partial<Preferences>) => void
}) {
  const t = useT()
  return (
    <>
      <section className={styles.bloc}>
        <h3 className={styles.titre}>{t('preferences.general.langueTitre')}</h3>
        {/* **Des radios natives**, comme le thème juste en dessous : l'exclusivité, la navigation
            aux flèches et l'annonce à la voix viennent du navigateur. */}
        <div className={styles.themes}>
          {LANGUES.map((langue) => (
            <label
              key={langue.valeur}
              className={preferences.language === langue.valeur ? styles.themeActif : styles.theme}
              title={t(`preferences.langues.detail${majuscule(langue.valeur)}`)}
            >
              <input
                type="radio"
                name="language"
                className={styles.radio}
                checked={preferences.language === langue.valeur}
                onChange={() => onRegler({ language: langue.valeur })}
              />
              {t(`preferences.langues.${langue.valeur}`)}
            </label>
          ))}
        </div>
      </section>
      <AVenir titre={t('preferences.sections.general')} porte={t('preferences.general.aVenir')} />
    </>
  )
}

/** `'fr'` → `'Fr'`, `'systeme'` → `'Systeme'` — pour composer `detailFr`/`detailEn`/`detailSysteme`. */
function majuscule(valeur: string): string {
  return valeur.charAt(0).toUpperCase() + valeur.slice(1)
}

/** Thème et couleur d'accent (`15b`). */
function Apparence({
  preferences,
  onRegler,
}: {
  preferences: Preferences
  onRegler: (partiel: Partial<Preferences>) => void
}) {
  const t = useT()
  return (
    <>
      <section className={styles.bloc}>
        <h3 className={styles.titre}>{t('preferences.apparence.themeTitre')}</h3>
        {/* **Des radios natives**, comme `RadioGroup` (`08a`) : l'exclusivité, la navigation aux
            flèches et l'annonce à la voix viennent du navigateur. Un `role="radio"` posé sur un
            bouton redemanderait tout cela à la main — et Biome le signale. */}
        <div className={styles.themes}>
          {THEMES.map((theme) => (
            <label
              key={theme.valeur}
              className={preferences.theme === theme.valeur ? styles.themeActif : styles.theme}
            >
              <input
                type="radio"
                name="theme"
                className={styles.radio}
                checked={preferences.theme === theme.valeur}
                onChange={() => onRegler({ theme: theme.valeur })}
              />
              <span className={styles.apercu} data-theme-apercu={theme.valeur} aria-hidden="true" />
              {t(`preferences.themes.${theme.valeur}.nom`)}
            </label>
          ))}
        </div>
      </section>

      <section className={styles.bloc}>
        <h3 className={styles.titre}>{t('preferences.apparence.accentTitre')}</h3>
        <div className={styles.palette}>
          {PALETTE.map((entree) => (
            <label
              key={entree.valeur}
              className={
                preferences.accent === entree.valeur ? styles.pastilleActive : styles.pastille
              }
              style={{ background: entree.couleur }}
            >
              <input
                type="radio"
                name="accent"
                className={styles.radio}
                checked={preferences.accent === entree.valeur}
                onChange={() => onRegler({ accent: entree.valeur })}
              />
              {/* Le nom est **porté par un texte**, pas par un `aria-label` sur une pastille de
                  couleur : « terracotta » doit s'annoncer, et une couleur seule n'est pas un nom. */}
              <span className={styles.pourLaVoix}>{t(`preferences.accents.${entree.valeur}`)}</span>
            </label>
          ))}
          <span className={styles.note}>{t('preferences.apparence.accentNote')}</span>
        </div>
      </section>
    </>
  )
}

/** Densité des lignes et police du code (`15c`). */
function Grille({
  preferences,
  onRegler,
}: {
  preferences: Preferences
  onRegler: (partiel: Partial<Preferences>) => void
}) {
  const t = useT()
  const plancher = hauteurMinimalePour(preferences.codeFontTenths)
  const contraint = plancher > 20

  return (
    <>
      <section className={styles.bloc}>
        <h3 className={styles.titre}>{t('preferences.grille.densiteTitre')}</h3>
        <div className={styles.curseur}>
          <span className={styles.borne}>{t('preferences.grille.compact')}</span>
          <input
            type="range"
            min={plancher}
            max={HAUTEUR_MAX}
            step={1}
            value={preferences.rowHeight}
            aria-label={t('preferences.grille.densiteAriaLabel')}
            onChange={(evenement) => onRegler({ rowHeight: Number(evenement.target.value) })}
          />
          <span className={styles.borne}>{t('preferences.grille.aere')}</span>
          <span className={styles.valeur}>{preferences.rowHeight}px</span>
        </div>
        {/* **La contrainte est dite, pas subie** (`15c`) : le curseur ne descend plus, et sans cette
            phrase l'utilisateur chercherait pourquoi. */}
        {contraint && (
          <p className={styles.reserve}>
            {t('preferences.grille.contrainte', {
              corps: preferences.codeFontTenths / 10,
              plancher,
            })}
          </p>
        )}
      </section>

      <section className={styles.bloc}>
        <h3 className={styles.titre}>{t('preferences.grille.policeTitre')}</h3>
        <div className={styles.curseur}>
          <span className={styles.borne}>{CORPS_MIN / 10} px</span>
          <input
            type="range"
            min={CORPS_MIN}
            max={CORPS_MAX}
            step={5}
            value={preferences.codeFontTenths}
            aria-label={t('preferences.grille.policeAriaLabel')}
            onChange={(evenement) => onRegler({ codeFontTenths: Number(evenement.target.value) })}
          />
          <span className={styles.borne}>{CORPS_MAX / 10} px</span>
          <span className={styles.valeur}>{preferences.codeFontTenths / 10} px</span>
        </div>
        {/* La famille n'est pas réglable : `--font-mono` porte JetBrains Mono, embarquée par `02`.
            Proposer une liste de polices système demanderait de les énumérer, ce que le web ne
            permet pas sans une permission que Tauri ne donne pas. */}
        <p className={styles.note}>{t('preferences.grille.policeNote')}</p>
      </section>
    </>
  )
}

/** Les quatre garde-fous d'écriture (`15d`). */
function GardeFous({
  guards,
  onRegler,
}: {
  guards: Guards
  onRegler: (partiel: Partial<Guards>) => void
}) {
  const t = useT()
  return (
    <section className={styles.bloc}>
      <h3 className={styles.titre}>{t('preferences.securite.titre')}</h3>
      {/* **Chaque bascule dit ce qu'elle protège, pas comment elle marche.** Les phrases sont
          celles du mockup, complétées de ce qui arrive quand on éteint : `11d` avait posé qu'un
          garde-fou désactivable avant qu'un écran ne l'explique est un garde-fou qu'on désactive
          par accident. L'écran existe maintenant. */}
      <GardeFou
        libelle={t('preferences.securite.pendingBeforeWrite.libelle')}
        detail={t('preferences.securite.pendingBeforeWrite.detail')}
        checked={guards.pendingBeforeWrite}
        onCheckedChange={(pendingBeforeWrite) => onRegler({ pendingBeforeWrite })}
      />
      <GardeFou
        libelle={t('preferences.securite.prodReadOnly.libelle')}
        detail={t('preferences.securite.prodReadOnly.detail')}
        checked={guards.prodReadOnly}
        onCheckedChange={(prodReadOnly) => onRegler({ prodReadOnly })}
      />
      <GardeFou
        libelle={t('preferences.securite.refuseUnrestrictedWrites.libelle')}
        detail={t('preferences.securite.refuseUnrestrictedWrites.detail')}
        checked={guards.refuseUnrestrictedWrites}
        onCheckedChange={(refuseUnrestrictedWrites) => onRegler({ refuseUnrestrictedWrites })}
      />
      {/* **Désactivé avec sa raison**, et non allumé sans effet : `11c` et `11d` avaient annoncé
          cette promesse puis l'avaient retirée, faute de persister le patch. La leçon du défaut
          n° 36 tranche — un réglage qui ne fait rien est pire qu'un réglage absent. */}
      <GardeFou
        libelle={t('preferences.securite.keepInversePatch.libelle')}
        detail={t('preferences.securite.keepInversePatch.detail')}
        checked={false}
        onCheckedChange={() => {}}
        indisponible
      />
    </section>
  )
}

function GardeFou({
  libelle,
  detail,
  checked,
  onCheckedChange,
  indisponible,
}: {
  libelle: string
  detail: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  indisponible?: boolean
}) {
  return (
    <div className={indisponible ? styles.gardeFouInerte : styles.gardeFou}>
      <Toggle
        checked={checked}
        onCheckedChange={onCheckedChange}
        label={libelle}
        disabled={indisponible}
      />
      <div className={styles.gardeFouTexte}>
        <span className={styles.gardeFouLibelle}>{libelle}</span>
        <span className={styles.gardeFouDetail}>{detail}</span>
      </div>
    </div>
  )
}

/**
 * « Mises à jour » : chercher une version plus récente, et l'installer (26 août 2026).
 *
 * **La version installée n'est pas redite ici** : le pied de la sidebar la porte, à trois
 * centimètres de là et dans la même vue. Deux vérités pour une seule valeur, dont la visible
 * pourrait être la fausse — c'est la raison qui a déjà tenu `AvailableUpdate` hors de la version
 * courante.
 *
 * **Rien n'est cherché à l'ouverture.** La barre d'état interroge déjà une fois au démarrage, et
 * une seconde recherche à chaque ouverture des préférences n'annoncerait rien de neuf. Surtout,
 * un appel au montage ferait dépendre le rendu de la modale d'une réponse réseau — donc de
 * l'instant — et toute capture de fidélité de `A10` deviendrait instable. La recherche part d'un
 * clic, et c'est le clic qui autorise à afficher ce qu'elle répond.
 *
 * **Ici, l'échec se dit** — à l'inverse de la barre d'état, qui l'avale. La règle n'a pas changé :
 * on ne dérange pas quelqu'un pour une requête qu'il n'a pas demandée. Celle-ci, il l'a demandée,
 * et un bouton qui retombe en silence se lit comme une panne.
 */
function MisesAJour({
  chercher,
  installer,
  dejaTrouvee,
}: {
  chercher: () => Promise<AvailableUpdate | null>
  installer: () => Promise<void>
  /** Voir `majDejaTrouvee` : une recherche faite par la notification, reprise sans en refaire une. */
  dejaTrouvee: AvailableUpdate | null
}) {
  const t = useT()
  // Quatre états, et « pas encore cherché » n'est pas « à jour » — c'est la même distinction que
  // les quatre états d'une base dans l'arbre : « jamais tentée » n'est pas « hors ligne ».
  const [etat, setEtat] = useState<
    | { quoi: 'repos' }
    | { quoi: 'recherche' }
    | { quoi: 'aJour' }
    | { quoi: 'disponible'; maj: AvailableUpdate }
    | { quoi: 'echec'; raison: string }
  >(dejaTrouvee === null ? { quoi: 'repos' } : { quoi: 'disponible', maj: dejaTrouvee })
  const [installation, setInstallation] = useState(false)
  const [echecInstallation, setEchecInstallation] = useState<string | null>(null)

  async function rechercher() {
    setEtat({ quoi: 'recherche' })
    try {
      const trouvee = await chercher()
      setEtat(trouvee === null ? { quoi: 'aJour' } : { quoi: 'disponible', maj: trouvee })
    } catch (erreur) {
      setEtat({ quoi: 'echec', raison: message(erreur) })
    }
  }

  async function lancer() {
    setInstallation(true)
    setEchecInstallation(null)
    try {
      await installer()
      // **Atteint seulement en cas d'échec** : au succès, le processus est remplacé pendant
      // l'attente. Le dire ainsi plutôt que de laisser le bouton tourner indéfiniment, qui est le
      // pire des deux messages possibles.
      setEchecInstallation(t('preferences.maj.installationEchouee'))
    } catch (erreur) {
      setEchecInstallation(message(erreur))
    }
    setInstallation(false)
  }

  return (
    <section className={styles.bloc}>
      <h3 className={styles.titre}>{t('preferences.maj.titre')}</h3>
      <div className={styles.maj}>
        <Button
          variant="secondary"
          size="md"
          onClick={rechercher}
          disabled={etat.quoi === 'recherche'}
        >
          {etat.quoi === 'recherche'
            ? t('preferences.maj.recherche')
            : t('preferences.maj.rechercher')}
        </Button>
      </div>

      {/* `role="status"` : la réponse arrive après le clic, donc elle doit s'annoncer sans que le
          focus quitte le bouton. */}
      <div role="status">
        {etat.quoi === 'aJour' && <p className={styles.majVerdict}>{t('preferences.maj.aJour')}</p>}
        {etat.quoi === 'echec' && (
          <p className={styles.reserve}>{t('preferences.maj.echec', { raison: etat.raison })}</p>
        )}
        {etat.quoi === 'disponible' && (
          <div className={styles.majTrouvee}>
            <p className={styles.majVerdict}>
              {t('preferences.maj.disponibleAvant')} <strong>{etat.maj.version}</strong>{' '}
              {t('preferences.maj.disponibleApres')}
            </p>
            {/* Une release sans notes est un cas normal du manifeste, et l'écran tient sans. */}
            <p className={styles.majNotes}>{etat.maj.notes ?? t('preferences.maj.sansNotes')}</p>
            {echecInstallation !== null && <p className={styles.reserve}>{echecInstallation}</p>}
            <Button variant="dark" size="md" onClick={lancer} disabled={installation}>
              {installation ? t('preferences.maj.installation') : t('preferences.maj.installer')}
            </Button>
            <p className={styles.note}>{t('preferences.maj.redemarrageNote')}</p>
          </div>
        )}
      </div>
    </section>
  )
}

/** Ce que `catch` reçoit n'est pas toujours une `Error` : Tauri rejette avec une chaîne. */
function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur)
}

/**
 * Une section qui n'a rien à régler, **et qui dit ce qu'elle portera**.
 *
 * La cacher ferait croire à une interface plus pauvre qu'elle ne sera ; la laisser vide ferait
 * croire à un défaut.
 */
function AVenir({ titre, porte }: { titre: string; porte: string }) {
  const t = useT()
  return (
    <section className={styles.bloc}>
      <h3 className={styles.titre}>{titre}</h3>
      <p className={styles.aVenir}>{t('preferences.aVenir.corps', { porte })}</p>
    </section>
  )
}

/**
 * La confirmation de « Réinitialiser ».
 *
 * **Destructif pour les réglages**, donc confirmé — y compris les garde-fous, qu'un clic distrait
 * remettrait tous à leur valeur d'origine. La confirmation dit *ce qui* revient, pas « êtes-vous
 * sûr ? » : c'est la règle établie en `08j` et `11d`.
 */
function ReinitialisationConfirmee({
  onClose,
  onConfirmer,
}: {
  onClose: () => void
  onConfirmer: () => void
}) {
  const t = useT()
  return (
    <Modal
      title={t('preferences.reinitialisation.titre')}
      icon="warn"
      nested
      onClose={onClose}
      footer={
        <div className={styles.pied}>
          <span className={styles.espace} />
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('preferences.reinitialisation.annuler')}
          </Button>
          <Button variant="dark" size="md" onClick={onConfirmer}>
            {t('preferences.reinitialisation.confirmer')}
          </Button>
        </div>
      }
    >
      <div className={styles.confirmation}>
        <p>
          {t('preferences.reinitialisation.corpsAvant')}{' '}
          <strong>{t('preferences.reinitialisation.corpsGras')}</strong>.
        </p>
        <p className={styles.note}>{t('preferences.reinitialisation.note')}</p>
      </div>
    </Modal>
  )
}

/** Le thème appliqué à la racine, exporté pour que `Workbench` n'ait pas à le recalculer. */
export type { Theme }
