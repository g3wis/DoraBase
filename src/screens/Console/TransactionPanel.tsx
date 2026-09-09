import { Icon } from '../../design/icons/Icon'
import type { TransactionState, TransactionStatement } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { Badge } from '../../ui/Badge/Badge'
import { cx } from '../../ui/cx'
import { SqlColore } from '../TableView/SqlColore'
import styles from './TransactionPanel.module.css'

type TransactionPanelProps = {
  etat: TransactionState
  /** `analytics · public`, pour le pied — le même libellé que celui de la console. */
  contexte?: string
  /**
   * Le refus d'une validation, d'une annulation ou d'une lecture de réponse. Affiché ici, sous les
   * instructions.
   */
  erreur?: string | null
  onValider?: () => void
  onAnnuler?: () => void
  /**
   * Remet la réponse d'une instruction dans la grille du résultat (`API-38`).
   *
   * **Le panneau ne la contient pas** : il désigne, l'écran va la chercher au cœur, et la grille
   * l'affiche. C'est ce qui évite d'entasser toutes les réponses de la transaction dans 330 px de
   * large — et de les faire traverser l'IPC à chaque exécution, le journal étant relu à chaque fois.
   */
  onAfficher?: (index: number) => void
  /**
   * Le rang de l'instruction dont la réponse est dans la grille, ou `null`.
   *
   * `null` après chaque exécution : la grille montre alors la réponse toute neuve, et rien ne dit
   * quelle entrée du journal l'a produite — deux consoles y écrivent. Marquer la dernière serait
   * juste presque toujours, et faux dès qu'une voisine a exécuté après nous.
   */
  affichee?: number | null
  /** Vrai pendant l'un des deux gestes : les boutons attendent. */
  enCours?: boolean
}

/**
 * Le panneau de la transaction manuelle d'une console (`API-38`) : ce qui attend, et les deux
 * issues.
 *
 * # Ce qu'il liste : ses instructions, et le compte des autres
 *
 * Les instructions viennent du **registre**, qui les tient par connexion, et il n'en rend à cette
 * console que **les siennes** : les requêtes d'une voisine s'y liraient comme les nôtres, alors
 * qu'on ne les a ni écrites ni vues passer. Le filtre est au cœur, qui seul connaît l'origine de
 * chaque instruction.
 *
 * **Mais un « Valider » emporte la transaction entière** — c'est une seule session —, donc ce que la
 * liste ne montre pas se **dit** : `TransactionState.foreign`, sous les instructions. Un panneau
 * qui en listerait deux devant un `commit` qui en emporte quatre serait un mensonge sur ce qu'on
 * valide, et c'est le pire défaut que ce panneau puisse avoir. La confirmation de validation le
 * redit, au moment où l'on s'engage.
 *
 * # Il paraît avant la première instruction
 *
 * Le mode manuel se règle dans la barre d'outils, et la transaction ne s'ouvre qu'à la première
 * exécution : entre les deux, le panneau **dit** ce qui va se passer plutôt que de laisser une
 * colonne vide. C'est le seul endroit qui puisse expliquer le régime dans lequel on vient d'entrer.
 */
export function TransactionPanel({
  etat,
  contexte,
  erreur = null,
  onValider,
  onAnnuler,
  onAfficher,
  affichee = null,
  enCours = false,
}: TransactionPanelProps) {
  const t = useT()
  // **Deux nombres, et il en faut deux.** Le rang du journal (`instruction.index`) est l'adresse
  // que le cœur attend et l'identité d'une entrée ; la place dans **cette** liste est ce qui
  // s'affiche, parce que la liste est filtrée — une console qui a joué la première et la troisième
  // instruction de la transaction montre « #1 » et « #2 », non « #1 » et « #3 » : un numéro qui
  // sauterait ferait chercher l'instruction manquante dans un panneau qui ne l'aura jamais.
  const rangees = etat.statements.map((instruction, place) => ({ instruction, place }))
  // **Ce qui décide des deux boutons est `open`, non le compte d'instructions.** Une transaction
  // dont la première instruction a échoué est ouverte et vide de succès : il y a bel et bien
  // quelque chose à annuler, et le dire est tout l'intérêt du journal.
  const active = etat.open && !enCours

  return (
    // `<aside>` et non un `div` porteur d'`aria-label` : **un nom accessible sur un élément sans
    // rôle est ignoré** (piège n° 2). L'élément sémantique porte le rôle `complementary`, ce que ce
    // panneau est — un complément de la console.
    <aside className={styles.root} aria-label={t('console.transaction.ariaLabel')}>
      <header className={styles.entete}>
        <Icon name="hist" size={13} strokeWidth={2.1} className={styles.icone} />
        <h2 className={styles.titre}>{t('console.transaction.titre')}</h2>
        {etat.statements.length > 0 && (
          <Badge tone="warn" size="xs">
            {etat.statements.length}
          </Badge>
        )}
      </header>

      <div className={styles.corps}>
        {/* **La transaction est abandonnée : il ne reste qu'à l'annuler.** Le bouton « Valider » est
            retiré, et la raison prend sa place — un bouton absent sans explication ferait chercher
            où il est passé, et c'est le seul endroit qui puisse dire ce qui s'est passé. Le fait
            vient du moteur (`TransactionState.aborted`) : PostgreSQL abandonne sur un refus, SQLite
            et MySQL non, et le déduire ici aurait retiré à ces deux-là une capacité qu'ils ont. */}
        {etat.aborted && <p className={styles.abandon}>{t('console.transaction.abandonnee')}</p>}
        {etat.statements.length === 0 ? (
          <p className={styles.invite}>{t('console.transaction.invite')}</p>
        ) : (
          // `<ol>` et non `<ul>` : l'ordre **est** l'information. Une transaction se lit dans
          // l'ordre où elle a été jouée, et c'est ce qui permet de retrouver l'instruction qui l'a
          // fait basculer.
          <ol className={styles.instructions}>
            {rangees.map(({ instruction, place }) => (
              <Instruction
                // **Le rang du journal en clef, et c'est le bon ici.** Deux exécutions du même SQL
                // sont deux instructions distinctes de la transaction, donc le texte ne les
                // distingue pas ; et ce journal ne se réordonne jamais — il ne fait que s'allonger,
                // jusqu'à ce qu'une validation ou une annulation le remplace en entier. C'est le
                // cœur qui le donne, non la boucle : la liste est filtrée, donc sa place n'est pas
                // le rang, et lire l'index de la boucle ferait signaler à Biome un défaut qui n'a
                // pas d'objet.
                key={instruction.index}
                instruction={instruction}
                rang={place + 1}
                // **Désignée par son rang de journal** : c'est l'adresse que le cœur attend, et la
                // seule qui reste juste quand une voisine a exécuté entre deux des nôtres.
                affichee={affichee === instruction.index}
                onAfficher={
                  onAfficher === undefined ? undefined : () => onAfficher(instruction.index)
                }
              />
            ))}
          </ol>
        )}

        {/* **Ce que la liste ne montre pas, et que la validation emporte.** Le compte, non les
            requêtes : celles-ci appartiennent à une console qui les a écrites et qui les affiche,
            et les recopier ici referait exactement ce que le filtre défait. Absent quand il n'y a
            rien à dire — le cas ordinaire, une seule console sur la connexion. */}
        {etat.foreign > 0 && (
          <p className={styles.etrangeres}>
            {t('console.transaction.etrangeres', { n: etat.foreign })}
          </p>
        )}

        {erreur !== null && (
          <p className={styles.refus} role="alert">
            {erreur}
          </p>
        )}
      </div>

      <footer className={styles.pied}>
        {contexte && <span className={styles.cible}>{contexte}</span>}
        {/* **`aria-disabled` et non `disabled`** : les deux boutons portent leur raison quand rien
            n'est ouvert, et un `<button disabled>` ne reçoit ni focus ni survol — son infobulle
            serait inatteignable exactement là où elle explique (piège n° 3). Le gestionnaire est
            donc retiré, plutôt que le bouton désactivé. */}
        <button
          type="button"
          className={styles.annuler}
          aria-disabled={!active}
          title={etat.open ? undefined : t('console.transaction.rienAAnnuler')}
          onClick={active ? onAnnuler : undefined}
        >
          {t('console.transaction.annuler')}
        </button>
        {/* **Retiré, et non désactivé, quand la transaction est abandonnée.** Ailleurs le projet
            grise et donne sa raison ; ici le bouton ne pourrait pas faire ce qu'il annonce — un
            `commit` sur une transaction abandonnée se comporte comme un `rollback` —, et un
            contrôle qui promet l'inverse de son acte est pire qu'un contrôle absent. Sa raison est
            écrite dans le corps du panneau, là où on la lit. */}
        {!etat.aborted && (
          <button
            type="button"
            className={styles.valider}
            aria-disabled={!active}
            title={etat.open ? undefined : t('console.transaction.rienAValider')}
            onClick={active ? onValider : undefined}
          >
            <Icon name="check" size={12} strokeWidth={2.6} />
            {enCours ? t('console.transaction.enCours') : t('console.transaction.valider')}
          </button>
        )}
      </footer>
    </aside>
  )
}

/**
 * Une instruction du journal : son rang, la réponse du serveur, et son SQL.
 *
 * **La réponse est en tête, le SQL en dessous.** C'est le chiffre qui décide d'une validation — « il
 * a touché trois lignes, pas trois mille » — et le chercher au bout d'une requête de cinq lignes
 * serait le mettre là où on ne le lit pas.
 */
function Instruction({
  instruction,
  rang,
  affichee,
  onAfficher,
}: {
  instruction: TransactionStatement
  rang: number
  affichee: boolean
  onAfficher?: () => void
}) {
  const t = useT()
  const refusee = instruction.error !== null
  // **Une instruction se choisit quand elle a une réponse à montrer.** `displayable` vient du
  // cœur : il est faux pour une écriture — son compte de lignes touchées *est* sa réponse, et un
  // clic ne ferait que vider la grille — et faux pour un refus, dont le message est juste dessous.
  const choisissable = instruction.displayable && onAfficher !== undefined

  const contenu = (
    <>
      <div className={styles.instructionEntete}>
        <span className={styles.rang}>{t('console.transaction.rang', { rang })}</span>
        <span className={styles.reponse}>{reponseDe(instruction, t)}</span>
        <span className={styles.duree}>
          {t('console.transaction.duree', { ms: instruction.durationMs })}
        </span>
      </div>
      {/* Enveloppé plutôt que doté d'un `className` : `SqlColore` porte son propre bloc — fond
          sombre, retour à la ligne, quatre couleurs — et n'a jamais eu à connaître la marge de son
          voisin. C'est ce que fait déjà `PendingPanel` de son bloc « SQL qui sera exécuté ». */}
      <div className={styles.sql}>
        <SqlColore texte={instruction.sql} />
      </div>
      {/* Pas de `role="alert"` : cette ligne n'annonce rien, elle **raconte** ce qui s'est passé, et
          une région d'alerte par instruction reparlerait à chaque rendu du panneau. Le refus d'une
          validation, lui, en porte un : celui-là est la réponse à un geste. */}
      {instruction.error !== null && <p className={styles.echec}>{instruction.error}</p>}
    </>
  )

  return (
    <li className={cx(styles.instruction, refusee && styles.refusee)}>
      {choisissable ? (
        // **Un bouton, et la carte entière** : la cible est ce qu'on lit — le SQL et sa réponse —,
        // et une petite action « Afficher » à côté aurait demandé de viser 60 px après en avoir lu
        // 300. `aria-pressed` porte l'état, comme le bouton d'édition d'`A5` et l'épingle du panneau
        // de ligne : le libellé, lui, ne bouge pas sous le doigt qui vient de le trouver.
        <button
          type="button"
          className={cx(styles.choix, affichee && styles.choixAffiche)}
          aria-pressed={affichee}
          onClick={onAfficher}
        >
          {contenu}
          {/* Le nom accessible doit dire **ce que le bouton fait**, pas seulement ce qu'il
              contient : concaténé, celui-ci rendrait « #2 12 lignes rendues 4 ms select … », qui
              décrit sans annoncer. Le verbe est donc ajouté en texte masqué en `clip-path`, et
              **en dernier** — son ordre décide de l'ordre de lecture (piège n° 2). */}
          <span className={styles.masque}>{t('console.transaction.afficher')}</span>
        </button>
      ) : (
        // **Ni bouton ni raison affichée.** Une écriture n'a pas de résultat à montrer et le dit
        // déjà — « 3 lignes touchées » —, donc une infobulle « rien à afficher » sur chacune de ces
        // cartes serait du bruit là où l'information est déjà lue.
        //
        // Une enveloppe quand même, et non le contenu nu : c'est elle qui porte le rembourrage dans
        // les deux cas, et sans elle les deux sortes de carte n'avaient pas le même rythme.
        <div className={styles.fixe}>{contenu}</div>
      )}
    </li>
  )
}

/**
 * Ce que le serveur a répondu, en une ligne.
 *
 * **Trois réponses distinctes, et jamais un zéro par défaut.** « 0 ligne rendue » sur un `update`
 * qui en a écrit trois est le mensonge que `QueryResult.affected` existe pour éviter : les lignes
 * *touchées* sont donc dites quand il y en a, les lignes *rendues* sinon, et un refus prend la place
 * des deux.
 */
function reponseDe(
  instruction: TransactionStatement,
  t: (cle: string, parametres?: Record<string, string | number>) => string,
): string {
  if (instruction.error !== null) return t('console.transaction.refusee')
  if (instruction.affected !== null) {
    return t('console.transaction.touchees', { n: instruction.affected })
  }
  return t('console.transaction.rendues', { n: instruction.returned })
}
