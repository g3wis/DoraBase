import type { Engine } from '../../domain/config'

/**
 * Le découpage d'un texte de console en instructions (#156).
 *
 * # Pourquoi ici, et pas dans le cœur
 *
 * La console **classe déjà** ce qu'on lui donne côté écran — `natureDe` décide de la confirmation,
 * `projection.ts` réécrit la liste de colonnes —, et c'est là qu'il faut connaître la suite
 * d'instructions : la confirmation récapitule les écritures de toute la suite *avant* que la
 * première parte, et chaque réponse a son onglet. Le contrat de moteur, lui, reste « une instruction
 * par `run_sql` », ce qui garde intact tout ce qui s'y appuie : l'auto-`LIMIT` lu sur la fin du
 * texte, le compte de lignes touchées d'un seul `CommandComplete`, et le journal d'une transaction
 * manuelle, où **chaque instruction entre séparément** sans qu'une ligne de Rust ait changé.
 *
 * Ce n'est pas composer du SQL — ce que le front ne doit pas faire — mais **couper** un texte que
 * l'utilisateur a écrit : chaque morceau part tel qu'il est écrit, commentaires compris.
 *
 * # Ce qui ne coupe pas
 *
 * Un `;` ne termine une instruction qu'en dehors de ce qui peut en contenir un :
 *
 * - une chaîne `'…'` (le `''` redoublé y est une apostrophe) — et chez MySQL, un `\'` aussi,
 *   l'antislash y échappant par défaut. **Chez PostgreSQL et SQLite non** : `'a\'` y est une chaîne
 *   complète, et traiter l'antislash partout ferait avaler la suite du texte dans une chaîne ;
 * - un identifiant cité — `"…"`, `` `…` ``, et `[…]` chez SQLite ;
 * - un commentaire `-- …`, `/* … *\/`, et `# …` chez MySQL ;
 * - un corps en dollars de PostgreSQL, `$$ … $$` ou `$corps$ … $corps$` — celui d'une fonction ;
 * - le corps `begin … end` d'un `create trigger` (SQLite), d'un `create procedure | function |
 *   trigger | event` (MySQL) et d'un `begin atomic` (PostgreSQL), qui contiennent eux-mêmes des
 *   instructions terminées par `;`. Un `case … end` y est compté pour que son `end` ne ferme pas le
 *   corps, et un `end if` / `end loop` / `end while` / `end repeat` de MySQL ne ferme rien — leurs
 *   ouvertures ne sont pas comptées non plus, `if` étant aussi une fonction.
 *
 * # Ce qui reste hors de portée, et se dit
 *
 * Le `DELIMITER` du client `mysql` n'est pas du SQL : c'est une commande du client, que le serveur
 * refuserait, et il n'est pas nécessaire ici — le protocole reçoit le corps d'une procédure comme
 * une seule instruction, et c'est ce que le comptage ci-dessus rend. Écrire `DELIMITER` dans la
 * console part donc au serveur, qui le refuse en le disant.
 */

/** Une instruction du texte, telle qu'elle partira. */
export type Instruction = {
  /** Le texte de l'instruction, sans son `;` terminal ni les blancs qui l'entourent. */
  sql: string
  /** Sa position dans le texte d'origine, pour qu'un geste puisse la désigner. */
  debut: number
  fin: number
}

/**
 * Les moteurs dont la console reçoit une suite découpée.
 *
 * **MongoDB n'en est pas** : sa console parle un autre dialecte, où `;` ne sépare rien. **BigQuery
 * non plus** : il exécute un script à plusieurs instructions en **un seul job**, nativement — le
 * découper en ferait autant de jobs facturés, et casserait les variables qu'un script déclare pour
 * ses instructions suivantes.
 */
export function decoupeLesSuites(moteur: Engine | undefined): boolean {
  return moteur === 'postgresql' || moteur === 'mysql' || moteur === 'sqlite'
}

/**
 * Coupe un texte en instructions.
 *
 * **Un morceau sans rien d'exécutable n'est pas une instruction** : un commentaire après le dernier
 * `;`, ou deux `;` qui se suivent, ne donnent pas un onglet vide — le serveur répondrait par une
 * erreur de syntaxe ou par rien, et dans les deux cas l'onglet parlerait d'un texte qu'on n'a pas
 * écrit comme une requête.
 */
export function decouper(texte: string, moteur: Engine | undefined): Instruction[] {
  const mysql = moteur === 'mysql'
  const postgres = moteur === 'postgresql'
  const sqlite = moteur === 'sqlite'

  const instructions: Instruction[] = []
  let debut = 0
  // Les mots significatifs de l'instruction courante, hors chaînes et commentaires : c'est d'eux
  // que se déduit qu'un corps `begin … end` est ouvert.
  let mots: string[] = []
  let profondeur = 0
  let corps = false
  let qualifieUnEnd = false

  const clore = (fin: number) => {
    const brut = texte.slice(debut, fin)
    const decalage = brut.length - brut.trimStart().length
    const sql = brut.trim()
    if (aDuContenu(sql, mysql)) {
      instructions.push({ sql, debut: debut + decalage, fin: debut + decalage + sql.length })
    }
    mots = []
    profondeur = 0
    corps = false
    qualifieUnEnd = false
  }

  const compterLeMot = (mot: string, apres: number) => {
    mots.push(mot)
    // Le corps s'ouvre au premier `begin` d'un `create … trigger` (ou d'une routine MySQL), ou sur
    // un `begin atomic`.
    if (!corps) {
      // **Dans les premiers mots seulement** : `create table journal (event text, …)` porte un
      // `event` qui n'annonce aucun corps. `definer = root@localhost` en ajoute trois chez MySQL.
      const routine =
        mots[0] === 'create' &&
        mots.slice(1, 6).some((m) => (sqlite ? m === 'trigger' : ROUTINES.has(m)))
      const atomique = postgres && mot === 'atomic' && mots[mots.length - 2] === 'begin'
      if ((routine && (sqlite || mysql) && mot === 'begin') || atomique) {
        corps = true
        profondeur = 1
      }
      return
    }
    // Le mot qui suit un `end` le qualifie — `end case`, `end if` — et n'ouvre donc rien.
    if (qualifieUnEnd) {
      qualifieUnEnd = false
      if (mot === 'case' || FERMETURES_NEUTRES.has(mot)) return
    }
    if (mot === 'begin' || mot === 'case') profondeur += 1
    else if (mot === 'end') {
      qualifieUnEnd = true
      if (!FERMETURES_NEUTRES.has(motSuivant(texte, apres))) profondeur -= 1
    }
  }

  let i = 0
  while (i < texte.length) {
    const c = texte.charAt(i)
    const suivant = texte.charAt(i + 1)

    // Les commentaires.
    if (c === '-' && suivant === '-') {
      i = finDeLigne(texte, i)
      continue
    }
    if (mysql && c === '#') {
      i = finDeLigne(texte, i)
      continue
    }
    if (c === '/' && suivant === '*') {
      const fin = texte.indexOf('*/', i + 2)
      i = fin === -1 ? texte.length : fin + 2
      continue
    }

    // Les chaînes et les identifiants cités.
    if (c === "'") {
      i = finDeCitation(texte, i, "'", mysql)
      continue
    }
    if (c === '"') {
      i = finDeCitation(texte, i, '"', mysql)
      continue
    }
    if (c === '`') {
      i = finDeCitation(texte, i, '`', false)
      continue
    }
    if (sqlite && c === '[') {
      const fin = texte.indexOf(']', i + 1)
      i = fin === -1 ? texte.length : fin + 1
      continue
    }

    // Le corps en dollars de PostgreSQL : `$$` ou `$etiquette$`. Un `$1` n'en est pas un — une
    // étiquette ne commence pas par un chiffre.
    if (postgres && c === '$') {
      const etiquette = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(texte.slice(i))
      if (etiquette) {
        const marque = etiquette[0]
        const fin = texte.indexOf(marque, i + marque.length)
        i = fin === -1 ? texte.length : fin + marque.length
        continue
      }
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < texte.length && /[A-Za-z0-9_$]/.test(texte.charAt(j))) j += 1
      compterLeMot(texte.slice(i, j).toLowerCase(), j)
      i = j
      continue
    }

    if (c === ';' && !(corps && profondeur > 0)) {
      clore(i)
      debut = i + 1
    }
    i += 1
  }
  clore(texte.length)
  return instructions
}

/** Ce que MySQL déclare avec un corps `begin … end`. */
const ROUTINES = new Set(['procedure', 'function', 'trigger', 'event'])

/**
 * Les `end x` qui ferment un bloc de contrôle MySQL et non un `begin` ni un `case` — `end case`, lui,
 * ferme un `case` et compte donc comme un `end`.
 */
const FERMETURES_NEUTRES = new Set(['if', 'loop', 'while', 'repeat'])

/** Le mot qui suit la position `i`, en minuscules — vide s'il n'y en a pas. */
function motSuivant(texte: string, i: number): string {
  return /^\s*([A-Za-z_]+)/.exec(texte.slice(i))?.[1]?.toLowerCase() ?? ''
}

function finDeLigne(texte: string, i: number): number {
  const fin = texte.indexOf('\n', i)
  return fin === -1 ? texte.length : fin
}

/**
 * La fin d'une citation ouverte en `i`. Le délimiteur redoublé l'échappe partout ; l'antislash
 * seulement là où le moteur le dit. Une citation jamais refermée court jusqu'au bout du texte : le
 * serveur dira qu'elle n'est pas terminée, ce que nous ne saurions pas dire mieux.
 */
function finDeCitation(texte: string, i: number, quote: string, antislash: boolean): number {
  let j = i + 1
  while (j < texte.length) {
    const c = texte[j]
    if (antislash && c === '\\') {
      j += 2
      continue
    }
    if (c === quote) {
      if (texte[j + 1] === quote) {
        j += 2
        continue
      }
      return j + 1
    }
    j += 1
  }
  return texte.length
}

/** Vrai quand un morceau porte autre chose que des blancs et des commentaires. */
function aDuContenu(sql: string, mysql: boolean): boolean {
  let nu = sql.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ').replace(/--[^\n]*/g, ' ')
  if (mysql) nu = nu.replace(/#[^\n]*/g, ' ')
  return nu.trim() !== ''
}

/**
 * Le premier mot d'une instruction, en capitales — ce qui la nomme dans son onglet : `SELECT`,
 * `UPDATE`, `CREATE`. Les commentaires de tête sont sautés, sans quoi un `-- note` nommerait
 * l'onglet.
 */
export function verbeDe(sql: string): string {
  const nu = sql.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ').replace(/(--|#)[^\n]*/g, ' ')
  return /[A-Za-z_]+/.exec(nu)?.[0]?.toUpperCase() ?? ''
}
