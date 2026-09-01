import { acceptCompletion, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { useT } from '../../i18n/LanguageContext'
import type { Dialecte } from '../Workbench/onglets'
import { type Catalogue, sourceDeCompletion } from './completion'
import { themeDuHandoff } from './theme'

/** Un catalogue vide : l'autocomplétion se replie alors sur les mots-clés, toujours sûrs. */
const CATALOGUE_VIDE: Catalogue = { tables: [], colonnes: {}, schemas: [], tablesParSchema: {} }

type SqlEditorProps = {
  /**
   * Le texte au **montage**. Les frappes suivantes sont notifiées, jamais réimposées.
   *
   * **L'éditeur n'est pas « contrôlé », et c'est une décision, pas un raccourci.** L'écran garde bien
   * la vérité du texte — `12a` en a besoin par onglet, `12f` pour l'enregistrer — mais il la reçoit
   * plutôt que de la réinjecter. Un éditeur contrôlé perd des caractères : l'écran renvoie la valeur
   * en retard d'un rendu, et l'éditeur, qui a déjà avancé, se voit réécrire avec un texte plus
   * ancien. Taper « select 1 » donnait « slc ». Deux gardes successives — comparer au document, puis
   * à la dernière valeur notifiée — n'y ont rien changé : la course est structurelle.
   *
   * Conséquence assumée : un texte imposé de l'extérieur demande un **remontage**, ce que la `key`
   * par onglet fait déjà (`12a`). `12f`, qui chargera une requête enregistrée, fera de même.
   */
  texteInitial: string
  onTexteChange: (texte: string) => void
  /** `⌘↩` — branché en `12c`. Absent, la touche ne fait rien. */
  onExecuter?: () => void
  /** `⌥↩` — exécuter la sélection, branché en `12c`. */
  onExecuterLaSelection?: () => void
  /**
   * La portion sélectionnée, publiée à chaque changement (`12c`).
   *
   * L'écran en a besoin pour « Sélection » : la sélection vit dans CodeMirror, et la lire au moment du
   * clic obligerait à exposer la vue. La publier suit le même principe que le texte.
   */
  onSelectionChange?: (selection: string) => void
  /**
   * Ce que l'autocomplétion propose (`12d`), lu **au moment de la frappe**.
   *
   * Une fonction et non une valeur : les extensions de CodeMirror sont posées une fois au montage, et
   * un catalogue capturé alors resterait celui du montage — les colonnes d'une table ouverte ensuite
   * ne seraient jamais proposées.
   */
  catalogue?: () => Catalogue
  /**
   * La grammaire colorée (`13a`).
   *
   * **Le thème ne change pas** : les jetons `--syn-*` décrivent des mots-clés, des chaînes et des
   * nombres, qui existent dans les deux grammaires. Seul l'analyseur diffère.
   *
   * L'autocomplétion de `12d` est **désactivée en mongo** : elle propose des tables et des colonnes
   * SQL, et suggérer `left join` dans un pipeline serait une suggestion fausse — ce que `12d` a
   * établi comme pire qu'une absence.
   */
  dialecte?: Dialecte
}

/**
 * L'éditeur SQL de la console (`12b`) : **CodeMirror 6**, au thème du handoff.
 *
 * **Pourquoi une dépendance et pas un `textarea`.** `01` justifiait le choix de Tauri par « les deux
 * composants les plus coûteux — grille dense et éditeur de code — déjà résolus par l'écosystème
 * web ». La grille a finalement été écrite à la main (`10a`) : virtualiser un tableau dense s'est
 * révélé plus simple que d'en dépendre. L'éditeur non — le placement du curseur, la sélection au
 * clavier, l'annulation et la composition des caractères accentués sont quatre sujets où un éditeur
 * maison se casse discrètement. Monaco a été écarté : ~2 Mo pour une console de requêtes.
 *
 * **Monté une fois, jamais recréé.** Reconstruire la vue à chaque rendu perdrait le curseur et
 * l'historique d'annulation. Voir `texteInitial` pour pourquoi l'éditeur n'est pas contrôlé.
 */
export function SqlEditor({
  texteInitial,
  onTexteChange,
  onExecuter,
  onExecuterLaSelection,
  onSelectionChange,
  catalogue,
  dialecte = 'sql',
}: SqlEditorProps) {
  const t = useT()
  const hote = useRef<HTMLDivElement>(null)
  const vue = useRef<EditorView | null>(null)
  // Les rappels sont lus par les extensions de CodeMirror, qui ne sont posées qu'une fois : les
  // garder dans une ref évite de reconstruire la vue quand l'appelant recrée ses fonctions.
  // Le dialecte est lu au montage comme `texteInitial` : changer de langue demande un remontage,
  // ce que la `key` par onglet fait déjà — un onglet ne change pas de dialecte en cours de vie.
  const langue = useRef(dialecte)
  const rappels = useRef({
    onTexteChange,
    onExecuter,
    onExecuterLaSelection,
    onSelectionChange,
    catalogue,
  })
  rappels.current = {
    onTexteChange,
    onExecuter,
    onExecuterLaSelection,
    onSelectionChange,
    catalogue,
  }
  // Aucune dépendance : la vue est montée une fois et vit jusqu'au démontage. Reconstruire à chaque
  // rendu perdrait le curseur et l'historique d'annulation, et `texteInitial` ne vaut qu'au montage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (!hote.current) return

    const editeur = new EditorView({
      parent: hote.current,
      state: EditorState.create({
        // Lu directement : l'effet n'a aucune dépendance, donc cette valeur est celle du montage. Une
        // ref avait été posée pour « figer » l'intention ; la retirer ne changeait aucune mesure.
        doc: texteInitial,
        extensions: [
          lineNumbers(),
          // **La ligne courante était stylée sans être produite.** `theme.ts` habillait
          // `.cm-activeLine` alors qu'aucune extension ne posait cette classe : du CSS mort, et un
          // repère de curseur absent. Trouvé par le test qui mesurait son fond.
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          // **`⌘↩` et `⌥↩` avant `defaultKeymap`** : l'ordre décide qui répond, et la carte par
          // défaut lie `Mod-Enter` à l'insertion d'une ligne. Les nôtres passent d'abord.
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                rappels.current.onExecuter?.()
                // `true` empêche la touche de retomber dans les cartes suivantes, même sans
                // rappel branché : une console où `⌘↩` insérerait une ligne serait déroutante.
                return true
              },
            },
            {
              key: 'Alt-Enter',
              run: () => {
                rappels.current.onExecuterLaSelection?.()
                return true
              },
            },
          ]),
          // **Avant `defaultKeymap`** : `⇥` insère la suggestion retenue, et la carte par défaut le
          // lie à l'indentation. C'est ce que le mockup annonce — « ⇥ insérer ».
          // **Aucune autocomplétion en mongo** : celle de `12d` propose des tables et des colonnes
          // SQL. Proposer `left join` dans un pipeline produirait une requête en erreur que
          // l'utilisateur croirait correcte — la règle que `12d` a posée.
          ...(langue.current === 'mongo'
            ? []
            : [
                autocompletion({
                  override: [
                    sourceDeCompletion(() => rappels.current.catalogue?.() ?? CATALOGUE_VIDE),
                  ],
                  // Le mockup ne montre pas d'icônes dans la liste : ses entrées portent un nom et
                  // un type.
                  icons: false,
                  defaultKeymap: false,
                }),
                keymap.of([
                  { key: 'Tab', run: acceptCompletion },
                  ...completionKeymap.filter((lien) => lien.key !== 'Tab'),
                ]),
              ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          langue.current === 'mongo' ? javascript() : sql({ dialect: PostgreSQL }),
          // **Le nom accessible va sur `.cm-content`**, seul élément à porter `role="textbox"`. Le
          // poser sur l'hôte ne servait à rien : un `aria-label` sur un élément sans rôle est ignoré
          // — le troisième cas de ce piège dans le projet, après `08c` et `11c`, et Biome l'a signalé
          // les trois fois.
          // Le nom accessible dit **quelle** langue : « Requête SQL » sur une console mongo
          // annoncerait la mauvaise à la voix.
          EditorView.contentAttributes.of({
            'aria-label':
              langue.current === 'mongo'
                ? t('console.sqlEditor.ariaLabelMongo')
                : t('console.sqlEditor.ariaLabelSql'),
          }),
          themeDuHandoff,
          EditorView.updateListener.of((maj) => {
            if (maj.docChanged) rappels.current.onTexteChange(maj.state.doc.toString())
            if (maj.selectionSet || maj.docChanged) {
              const plage = maj.state.selection.main
              rappels.current.onSelectionChange?.(maj.state.doc.sliceString(plage.from, plage.to))
            }
          }),
        ],
      }),
    })
    vue.current = editeur

    return () => {
      editeur.destroy()
      vue.current = null
    }
  }, [])

  // L'hôte ne porte rien d'accessible : le nom vit sur `.cm-content`, posé par
  // `EditorView.contentAttributes` ci-dessus.
  return <div ref={hote} className="cm-hote" data-testid="editeur-sql" />
}
