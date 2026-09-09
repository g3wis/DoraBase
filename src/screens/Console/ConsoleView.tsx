import { useRef, useState } from 'react'
import { Icon } from '../../design/icons/Icon'
import type { QueryResult, TransactionMode } from '../../domain/engine'
import { useT } from '../../i18n/LanguageContext'
import { raccourci } from '../../shell/plateforme'
import { cx } from '../../ui/cx'
import { SplitPane } from '../../ui/SplitPane/SplitPane'
import { Toggle } from '../../ui/Toggle/Toggle'
import { MenuDesColonnes, StepperDeLimite } from '../TableView/Toolbar'
import type { Dialecte } from '../Workbench/onglets'
import { ConsoleResult, ordonner, type VueResultat } from './ConsoleResult'
import styles from './ConsoleView.module.css'
import type { Catalogue } from './completion'
import { limiteDe, poserLaLimite } from './limite'
import { reordonnerLaProjection } from './projection'
import { type CommandesEditeur, SqlEditor } from './SqlEditor'

/** Ce que le moteur applique quand la requête ne porte pas de `limit` — l'« auto-LIMIT 1000 ». */
const LIMITE_AUTOMATIQUE = 1000

type ConsoleViewProps = {
  /**
   * Le texte de la console. **L'écran le détient**, et l'éditeur le reçoit au montage seulement —
   * voir `SqlEditor` pour pourquoi un éditeur contrôlé perd des caractères.
   */
  texte: string
  onTexteChange: (texte: string) => void
  /** Le libellé de la base, pour le pied — `analytics · public`. */
  contexte?: string
  /** Exécute la requête entière (`12c`). Absent, l'action est désactivée avec sa raison. */
  onExecuter?: (sql: string) => void
  /** Exécute la portion sélectionnée, ou la requête entière faute de sélection. */
  onExecuterLaSelection?: (sql: string) => void
  enCours?: boolean
  resultat?: QueryResult | null
  erreur?: string | null
  /** Ce que l'autocomplétion propose (`12d`), lu au moment de la frappe. */
  catalogue?: () => Catalogue
  vue?: VueResultat
  onVueChange?: (vue: VueResultat) => void
  /** Ouvre la modale d'enregistrement (`12f`) avec le texte courant. */
  onEnregistrer?: (sql: string) => void
  /**
   * La langue de la console (`13a`) — `sql` ou `mongo`.
   *
   * Elle suit le moteur de la base, elle ne se choisit pas : une console mongo sur une base
   * PostgreSQL n'aurait rien à interroger.
   */
  dialecte?: Dialecte
  /** La densité de `15c`, transmise à la grille du résultat. */
  rowHeight?: number
  /**
   * Le régime de transaction de **cette console** (`API-38`), et de quoi le changer.
   *
   * **De la console, non de la connexion** : c'est sur cet onglet-là qu'on l'allume, et passer à un
   * voisin n'en montre pas le panneau. La **transaction**, elle, appartient à la session, donc à la
   * connexion — un `begin` posé ici englobe ce que les consoles voisines exécutent, et `etrangere`
   * est ce qui le dit à celle qui ne l'a pas demandé. C'est l'appelant qui tient les deux comptes,
   * voir `useTransaction`.
   *
   * Absent, le réglage n'est pas rendu : la galerie et les vitrines montent la console sans lui, et
   * une bascule sans effet se lirait comme une panne (défaut n° 36).
   */
  transaction?: {
    mode: TransactionMode
    onModeChange: (mode: TransactionMode) => void
    /**
     * Pourquoi la bascule ne peut pas bouger, quand elle ne peut pas.
     *
     * **Une seule raison pour les deux sens**, parce que la question est la même — « pourquoi ce
     * réglage ne répond-il pas ? » : un moteur qui ne sait pas tenir de transaction manuelle la
     * fige éteinte, une transaction en cours la fige allumée. Deux props auraient demandé à
     * l'appelant de deviner laquelle vaut, alors qu'il n'y en a jamais qu'une.
     */
    raison?: string | null
    /**
     * Vrai quand une transaction est ouverte sur la **connexion** alors que cette console est en
     * mode automatique (`API-38`).
     *
     * Les consoles d'une même base partagent une session : les requêtes de celle-ci entrent donc
     * dans une transaction qu'une voisine a ouverte, et qu'un « Valider » d'ailleurs décidera. Le
     * pied le dit — le taire serait laisser croire à une écriture validée, ce qui est le pire défaut
     * que cette fonction puisse avoir.
     */
    etrangere?: boolean
  }
}

/**
 * L'écran de console SQL (`12a`) : la toolbar, l'éditeur, le résultat.
 *
 * **L'éditeur est celui de `12b`** — CodeMirror 6, au thème du handoff. L'exécution arrive en `12c`. Les actions qui en dépendent sont
 * **désactivées avec leur raison** : la règle de `09f`, et la leçon du défaut n° 36, où un bouton
 * cliquable et inerte s'est lu comme une panne.
 */
export function ConsoleView({
  texte,
  onTexteChange,
  contexte,
  onExecuter,
  onExecuterLaSelection,
  enCours = false,
  resultat = null,
  erreur = null,
  catalogue,
  vue,
  onVueChange,
  onEnregistrer,
  dialecte = 'sql',
  rowHeight,
  transaction,
}: ConsoleViewProps) {
  const t = useT()
  // La sélection courante, publiée par l'éditeur : « Sélection » l'exécute, et se replie sur la
  // requête entière quand il n'y a rien de sélectionné — un bouton qui ne ferait rien sur une
  // sélection vide se lirait comme une panne.
  const [selection, setSelection] = useState('')
  // Les commandes de l'éditeur — le canal impératif de `SqlEditor`, rempli au montage.
  const editeur = useRef<CommandesEditeur | null>(null)
  // Les colonnes masquées et l'ordre d'affichage du résultat — tenus **ici**, pas dans
  // `ConsoleResult` : la barre d'outils montre le menu « colonnes affichées », et chaque geste
  // réécrit la requête. Écart-au-défaut, par nom : un nom absent du prochain résultat est sans
  // effet, donc corriger sa requête ne défait pas la mise en page.
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(new Set())
  const [ordre, setOrdre] = useState<readonly string[] | null>(null)

  /** Les colonnes visibles, dans l'ordre d'affichage — ce que la projection de la requête devient. */
  function projectionVisible(
    ordreCourant: readonly string[] | null,
    masqueesCourantes: ReadonlySet<string>,
  ): string[] {
    if (!resultat) return []
    return ordonner(
      resultat.columns.map((nom) => ({ nom })),
      ordreCourant,
    )
      .map((entree) => entree.nom)
      .filter((nom) => !masqueesCourantes.has(nom))
  }

  /**
   * Chaque geste de colonnes — réordonner, masquer, réafficher — réécrit la projection de la
   * requête, quand celle-ci se laisse lire avec certitude (`projection.ts` — sinon `null`, et la
   * requête reste telle quelle ; l'affichage, lui, a déjà suivi le geste). Trois points :
   *
   * - **rien n'est réexécuté.** Une requête de console n'est pas forcément idempotente — un
   *   `update … returning` relancé sur un glissement de colonne écrirait deux fois. Le journal des
   *   messages continue donc de porter le SQL réellement exécuté, qui peut différer de l'éditeur ;
   * - la réécriture passe par une transaction CodeMirror (`remplacerTexte`), donc `⌘Z` rend le
   *   texte d'avant — c'est le chemin de retour du geste ;
   * - `onTexteChange` est notifié par l'éditeur lui-même, comme pour une frappe : l'écran garde
   *   la vérité du texte sans second circuit.
   */
  function reecrireLaProjection(colonnes: readonly string[]) {
    if (dialecte === 'mongo' || colonnes.length === 0) return
    const reecriture = reordonnerLaProjection(texte, colonnes)
    if (reecriture === null || reecriture.sql === texte) return
    // Le repli : une longue liste s'affiche pliée derrière une `…` cliquable, mais le texte reste
    // entier — exécutable, copiable, relisible. Voir `Reecriture.repli`.
    editeur.current?.remplacerTexte(reecriture.sql, reecriture.repli ?? undefined)
  }

  function poserLOrdre(nouvelOrdre: readonly string[]) {
    setOrdre(nouvelOrdre)
    reecrireLaProjection(projectionVisible(nouvelOrdre, masquees))
  }

  function basculerLaColonne(nom: string) {
    const suivantes = new Set(masquees)
    if (suivantes.has(nom)) suivantes.delete(nom)
    else suivantes.add(nom)
    setMasquees(suivantes)
    reecrireLaProjection(projectionVisible(ordre, suivantes))
  }

  function reafficherTout() {
    setMasquees(new Set())
    reecrireLaProjection(projectionVisible(ordre, new Set()))
  }

  // Le stepper `LIMIT` est **bidirectionnel** : il affiche la limite que la requête porte — lue à
  // chaque frappe, puisque le texte redescend par les props — et ses flèches l'écrivent dedans.
  // Sans limite écrite, il montre celle que le moteur ajoutera, et l'infobulle le dit.
  const limiteEcrite = dialecte === 'mongo' ? null : limiteDe(texte)

  function choisirLaLimite(valeur: number) {
    const nouveau = poserLaLimite(texte, valeur)
    if (nouveau === null || nouveau === texte) return
    editeur.current?.remplacerTexte(nouveau)
  }

  const executer = onExecuter === undefined ? undefined : () => onExecuter(texte)
  const executerLaSelection =
    onExecuterLaSelection === undefined
      ? undefined
      : () => onExecuterLaSelection(selection.trim() === '' ? texte : selection)

  const actions = ACTIONS.map((action) => {
    if (action.id === 'executer') return { ...action, onClick: executer }
    if (action.id === 'selection') return { ...action, onClick: executerLaSelection }
    if (action.id === 'enregistrer') {
      return {
        ...action,
        onClick: onEnregistrer === undefined ? undefined : () => onEnregistrer(texte),
      }
    }
    return action
  })

  return (
    <div className={styles.root}>
      {/* `role="toolbar"`, comme celle de `A5` (`10e`) : un groupe de commandes qui agissent sur la
          même chose. Le nom la distingue — « Exécuter » ici et une action homonyme ailleurs
          s'annonceraient à l'identique sans lui. */}
      <div className={styles.toolbar} role="toolbar" aria-label={t('console.toolbar.ariaLabel')}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.principale ? styles.principale : styles.action}
            onClick={'onClick' in action ? action.onClick : undefined}
            disabled={!('onClick' in action) || action.onClick === undefined || enCours}
            title={
              'onClick' in action && action.onClick !== undefined
                ? undefined
                : t(`console.toolbar.actions.${action.id}.raison`)
            }
          >
            {action.icone && <Icon name={action.icone} size={12} strokeWidth={2.1} />}
            {enCours && action.principale
              ? t('console.toolbar.enCours')
              : t(`console.toolbar.actions.${action.id}.libelle`)}
            {action.raccourci && <span className={styles.raccourci}>{action.raccourci}</span>}
          </button>
        ))}
        <span className={styles.espace} />
        {/* **Le régime de transaction, avant les deux réglages de lecture** (`API-38`). Un
            interrupteur et non un contrôle segmenté « Auto | Manuel » : c'est un réglage binaire
            dont le défaut est éteint, et la forme d'un interrupteur éteint l'annonce — la leçon du
            « Toutes les colonnes » du diagramme. Le libellé nomme l'état allumé, comme là-bas. */}
        {transaction !== undefined && (
          <span className={styles.reglage}>
            <Toggle
              checked={transaction.mode === 'manual'}
              // **Figée par un `aria-disabled`, jamais par `disabled`** : elle porte sa raison, et
              // un bouton désactivé ne reçoit ni survol ni focus — l'infobulle serait
              // inatteignable là où elle explique (piège n° 3). Le gestionnaire est donc retiré.
              aria-disabled={transaction.raison ? true : undefined}
              className={cx(transaction.raison && styles.reglageFige)}
              title={transaction.raison ?? t('console.transaction.modeAide')}
              onCheckedChange={
                transaction.raison
                  ? () => {}
                  : (coche) => transaction.onModeChange(coche ? 'manual' : 'auto')
              }
              label={t('console.transaction.modeLabel')}
            />
            <span
              className={cx(
                styles.reglageNom,
                transaction.mode === 'auto' && styles.reglageNomEteint,
              )}
            >
              {t('console.transaction.modeLabel')}
            </span>
          </span>
        )}
        {/* **En mongo, l'auto-`$limit` reste un état affiché** : ce n'est pas un `LIMIT` SQL mais
            un `$limit` ajouté en fin de pipeline (`18g`), que le stepper ne sait pas écrire.

            **En SQL, l'état est devenu les deux réglages d'`A5`** — le stepper `LIMIT` et le menu
            des colonnes affichées, les mêmes composants — et tous deux parlent à la **requête** :
            le stepper affiche la limite écrite (ou celle que le moteur ajoutera, l'infobulle le
            dit) et ses flèches l'écrivent ; le menu coche les colonnes du dernier résultat, et
            chaque bascule réécrit la projection. */}
        {dialecte === 'mongo' ? (
          <span className={styles.limite}>{t('console.toolbar.autoLimitMongo')}</span>
        ) : (
          <>
            <StepperDeLimite
              valeur={limiteEcrite ?? LIMITE_AUTOMATIQUE}
              onChoisir={choisirLaLimite}
              titre={limiteEcrite === null ? t('console.toolbar.limiteImplicite') : undefined}
            />
            {resultat !== null && resultat.columns.length > 0 && (
              <MenuDesColonnes
                colonnes={resultat.columns.map((name) => ({ name }))}
                masquees={masquees}
                onToggle={basculerLaColonne}
                // La console n'a que ce menu et celui des en-têtes pour revenir : la dernière
                // colonne visible ne se décoche pas, même règle que le menu d'en-tête.
                raisonDeLaDerniere={t('console.resultat.derniereColonne')}
              />
            )}
          </>
        )}
      </div>

      <div className={styles.corps}>
        <SplitPane
          storageKey="console:resultat"
          orientation="vertical"
          defaultSize={240}
          min={120}
          max={520}
          start={
            <div className={styles.editeur}>
              <SqlEditor
                texteInitial={texte}
                onTexteChange={onTexteChange}
                onSelectionChange={setSelection}
                onExecuter={executer}
                onExecuterLaSelection={executerLaSelection}
                catalogue={catalogue}
                commandes={editeur}
                dialecte={dialecte}
              />
            </div>
          }
          end={
            <ConsoleResult
              resultat={resultat}
              erreur={erreur}
              enCours={enCours}
              vue={vue}
              onVueChange={onVueChange}
              dialecte={dialecte}
              rowHeight={rowHeight}
              masquees={masquees}
              ordre={ordre}
              onBasculerColonne={basculerLaColonne}
              onReafficher={reafficherTout}
              onOrdreChange={poserLOrdre}
            />
          }
        />
      </div>

      {(contexte || transaction?.etrangere) && (
        <div className={styles.pied}>
          {contexte}
          {/* **Une transaction ouverte ailleurs, dite ici.** Elle ne se règle pas depuis cette
              console — son interrupteur est éteint —, mais ses requêtes y entrent : c'est le seul
              endroit de cet onglet qui puisse l'annoncer, et le pied est déjà celui qui dit sur quoi
              la console porte. */}
          {transaction?.etrangere && (
            <span className={styles.etrangere}>{t('console.transaction.etrangere')}</span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Les quatre actions de la toolbar du mockup, toutes désactivées à ce stade.
 *
 * **Présentes et désactivées, pas absentes** : les cacher ferait croire qu'elles n'existeront pas,
 * les laisser cliquables et inertes ferait croire à une panne. Chacune porte sa raison.
 */
const ACTIONS = [
  {
    id: 'executer',
    icone: 'play' as const,
    raccourci: raccourci('↩'),
    principale: true,
  },
  {
    id: 'selection',
    raccourci: '⌥↩',
  },
  {
    id: 'enregistrer',
    icone: 'save' as const,
  },
  {
    // **La seule action qui n'a pas de spec**, et sa raison le dit : formater du SQL demande un
    // formateur, qui est une décision de dépendance à part entière — pas un détail d'écran.
    id: 'formater',
  },
] satisfies readonly {
  id: 'executer' | 'selection' | 'enregistrer' | 'formater'
  icone?: 'play' | 'save'
  raccourci?: string
  principale?: boolean
}[]
