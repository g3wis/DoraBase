import { useEffect, useState } from 'react'
import { previewUpdates } from '../../data/commandes'
import type { DatabaseKey } from '../../domain/arbre'
import type {
  ColumnInfo,
  PendingDelete,
  PendingInsert,
  PendingUpdate,
  UpdatePlan,
} from '../../domain/engine'
import {
  type EnAttente,
  estUneLigneAjoutee,
  estUneLigneSupprimee,
  type LigneAjoutee,
  type LigneSupprimee,
  type ModificationDeCellule,
  texteBrutDe,
} from './modifications'

/** Ce qui appelle la commande. Injectable, le pont ne répondant pas hors de la webview. */
export type PasserellePreview = {
  previewUpdates: (key: DatabaseKey, plan: UpdatePlan) => Promise<string>
}

export const PASSERELLE_PREVIEW: PasserellePreview = { previewUpdates }

export type SqlPrevu = { sql: string | null; erreur: string | null }

/**
 * Le SQL de `11c`, demandé au moteur à chaque changement du modèle.
 *
 * **Rien n'est composé ici.** Le panneau annonce « SQL qui sera exécuté » : un texte fabriqué côté
 * écran *ressemblerait* à celui qui partira, ce qui est le pire cas pour le dernier écran avant
 * écriture. Tant que le cœur n'a pas répondu, `sql` reste `null` et le panneau le dit.
 *
 * **La clé primaire vient de l'introspection**, pas d'une convention sur le nom : une table dont la
 * clé s'appelle `uuid` n'est pas plus rare qu'une autre, et supposer `id` produirait un `WHERE` sur
 * une colonne qui n'identifie rien.
 */
export function useSqlPrevu(
  cle: DatabaseKey | null,
  cible: { schema: string; table: string } | null,
  attente: EnAttente,
  colonnes: readonly ColumnInfo[],
  passerelle: PasserellePreview,
): SqlPrevu {
  const [etat, setEtat] = useState<SqlPrevu>({ sql: null, erreur: null })

  // La signature du plan, en chaîne : sans elle, l'effet se relancerait à chaque rendu, le tableau
  // `attente` étant recréé par le parent. Le piège de `10d`, où une passerelle littérale relisait
  // les lignes à chaque frappe.
  const cleColonne = colonnes.find((colonne) => colonne.key === 'primary')?.name ?? ''
  const signature = JSON.stringify({ cle, cible, cleColonne, attente })

  // `signature` sérialise tout ce qui entre dans le plan — clé, cible, colonne d'identité,
  // changements. Lister les objets eux-mêmes relancerait l'effet à chaque rendu, leur identité
  // changeant chez le parent : le piège de `10d`, où une passerelle littérale relisait les lignes à
  // chaque frappe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: voir ci-dessus
  useEffect(() => {
    if (cle === null || cible === null || attente.length === 0) {
      setEtat({ sql: null, erreur: null })
      return
    }

    let vivant = true
    const plan = planDuModele(cible, cleColonne, attente)

    passerelle
      .previewUpdates(cle, plan)
      .then((sql) => {
        if (vivant) setEtat({ sql, erreur: null })
      })
      .catch((erreur: unknown) => {
        // Le refus s'affiche : une table sans clé primaire ne peut pas être modifiée ligne à ligne,
        // et le taire laisserait un panneau qui prépare éternellement sa requête.
        if (vivant) setEtat({ sql: null, erreur: messageDe(erreur) })
      })

    return () => {
      vivant = false
    }
  }, [signature, passerelle])

  return etat
}

function messageDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  if (erreur !== null && typeof erreur === 'object' && 'message' in erreur) {
    return String((erreur as { message: unknown }).message)
  }
  return 'la requête n’a pas pu être préparée'
}

/**
 * Une modification du modèle traduite pour le moteur.
 *
 * **Exportée, et c'est le point de `11d`** : la prévisualisation et l'application partent de la même
 * traduction. Deux conversions divergeraient, et l'écart tomberait sur les cas rares — une valeur
 * attendue nulle, une chaîne vide.
 */
export function planDe(modification: ModificationDeCellule): PendingUpdate {
  return {
    key: modification.cle,
    column: modification.column,
    // `null` **et** chaîne vide sont deux valeurs distinctes jusqu'au SQL.
    value: modification.apres.kind === 'null' ? null : modification.apres.texte,
    // La valeur attendue entre dans le `WHERE` : c'est la détection de conflit de `11d`. Elle vient
    // du **texte brut** de l'origine, celui que la base a rendu — pas du rendu formaté de la grille,
    // qui grouperait les milliers et ne comparerait plus rien.
    expected: modification.avant.kind === 'null' ? null : texteBrutDe(modification.avant),
  }
}

/**
 * Une ligne ajoutée traduite pour le moteur.
 *
 * **Seules les colonnes saisies partent**, et c'est tout l'enjeu : une colonne absente laisse la
 * base appliquer son défaut, une colonne à `NULL` écrit `NULL`. Les confondre ferait échouer
 * l'insertion sur la première colonne obligatoire.
 */
export function insertionDe(ligne: LigneAjoutee): PendingInsert {
  return {
    values: Object.entries(ligne.valeurs).map(([column, saisie]) => ({
      column,
      value: saisie.kind === 'null' ? null : saisie.texte,
    })),
  }
}

/**
 * Une ligne marquée pour suppression traduite pour le moteur.
 *
 * **Aucune valeur attendue** : contrairement à `planDe`, une ligne n'a qu'une seule colonne qui
 * l'identifie. Zéro ligne affectée par le `DELETE` porte déjà toute la détection de conflit dont on
 * a besoin — la ligne a changé, ou disparu, depuis la lecture.
 */
export function suppressionDe(ligne: LigneSupprimee): PendingDelete {
  return { key: ligne.cle }
}

/**
 * Le plan complet d'un modèle — modifications, lignes ajoutées **et** lignes supprimées.
 *
 * **Exportée, et c'est le point de `11d` étendu** : la prévisualisation et l'application partent de
 * la même traduction. Deux conversions divergeraient, et l'écart tomberait sur les cas rares — une
 * valeur attendue nulle, une colonne laissée à son défaut.
 */
export function planDuModele(
  cible: { schema: string; table: string },
  cleColonne: string,
  attente: EnAttente,
): UpdatePlan {
  return {
    schema: cible.schema,
    table: cible.table,
    keyColumn: cleColonne,
    changes: attente.filter((m) => m.sorte === 'cellule').map(planDe),
    inserts: attente.filter(estUneLigneAjoutee).map(insertionDe),
    deletes: attente.filter(estUneLigneSupprimee).map(suppressionDe),
  }
}
