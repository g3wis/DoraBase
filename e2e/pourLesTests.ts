import type { Page } from '@playwright/test'

/**
 * Déplie un dossier racine, puis l'un de ses sous-dossiers, pour rendre ses connexions visibles.
 *
 * **Le nom est resté, le modèle a changé** (#166) : il n'y a plus ni projet ni environnement, mais
 * le décor de `?demo` est la migration exacte de l'ancien — « Atelier Nord » › `prod` porte les deux
 * connexions (`analytics` et `evenements`). Trente specs l'appellent ; le renommer n'aurait rien
 * appris à personne.
 *
 * **Le dépliage est un double-clic**, qui sélectionne aussi. **Le motif du sous-dossier est
 * ancré** : le décor déclare `preprod` à côté de `prod`, et `/prod/` désigne les deux.
 */
export async function deplierUnEnvironnement(
  page: Page,
  environnement = 'prod',
  projet = 'Atelier Nord',
): Promise<void> {
  await page.getByRole('treeitem', { name: new RegExp(projet) }).dblclick()
  await page.getByRole('treeitem', { name: new RegExp(`^${environnement}\\b`) }).dblclick()
}

/**
 * Ouvre une console sur une connexion, depuis le menu « … » de sa ligne.
 *
 * **C'est le seul chemin depuis le 20 août 2026.** Le pied de la sidebar portait un bouton
 * « Nouvelle console », que huit specs employaient ; il a été retiré, une console appartenant à une
 * connexion et le pied ne sachant pas laquelle. Un helper plutôt que la séquence recopiée huit fois :
 * le jour où ce chemin change encore, il ne change qu'ici.
 *
 * La connexion doit être **visible dans l'arbre** — donc son projet déplié.
 *
 * **Le survol est obligatoire, et ce n'est pas une précaution.** Le « … » d'une ligne est en
 * `visibility: hidden` hors survol (`TreeRow.module.css`) : la boîte garde sa place pour que le méta
 * de la ligne ne bouge pas d'un pixel, mais Playwright refuse de cliquer un élément invisible. Sans
 * ce `hover`, l'attente expire au bout de trente secondes sans rien dire d'utile.
 *
 * **Le « … » est visé dans l'enveloppe de *sa* ligne, et le palier est nommé** (#162). Deux raisons,
 * et la seconde est arrivée par surprise :
 *
 * - le « … » est rendu **frère** du `treeitem`, pas dedans (voir `TreeRow`) : le chercher dans la
 *   page entière était donc la seule voie tant qu'un seul bouton portait ce nom ;
 * - depuis que les lignes d'objet ont un menu, **deux boutons peuvent porter le même nom** — le
 *   décor de démo nomme `evenements` à la fois une connexion et une collection, et les sept specs
 *   mongo sont tombées d'un coup sur une violation de mode strict. Un `.first()` sur le bouton
 *   aurait suffi à les faire repasser en pariant sur l'ordre du DOM ; nommer le palier dit ce qu'on
 *   vise. Une connexion du décor est à `aria-level` 3 — dossier racine 1, sous-dossier 2, connexion 3.
 */
export async function ouvrirUneConsole(page: Page, connexion: string): Promise<void> {
  const ligne = page
    .getByRole('treeitem', { name: new RegExp(connexion) })
    .and(page.locator('[aria-level="3"]'))
    .first()
  await ligne.hover()
  // `xpath=..` remonte à l'enveloppe `presentation` que `TreeRow` pose autour du couple
  // ligne + gouttière : c'est la plus petite portée qui contienne les deux.
  await ligne
    .locator('xpath=..')
    .getByRole('button', { name: `Actions de ${connexion}` })
    .click()
  await page.getByRole('button', { name: /Nouvelle console/ }).click()
}

/**
 * Ouvre `A2` depuis le menu « … » d'un dossier (#166).
 *
 * **C'est le chemin de création d'une connexion depuis que les projets sont partis** : le parcours
 * en deux étapes (projet, puis connexion) n'existe plus, et une connexion naît du palier qui connaît
 * son contexte — le menu d'un dossier —, comme une console naît du menu d'une connexion. Le dossier
 * doit être **visible dans l'arbre** ; celui du décor de `?demo` l'est au chargement.
 *
 * Le motif est **ancré** : le nom accessible d'une ligne de dossier commence par son nom, suivi de son
 * compte de connexions — et `prod` désignerait aussi `preprod`.
 */
export async function ouvrirLaNouvelleConnexion(
  page: Page,
  dossier = 'Atelier Nord',
): Promise<void> {
  const ligne = page.getByRole('treeitem', { name: new RegExp(`^${dossier}\\b`) }).first()
  await ligne.hover()
  await ligne
    .locator('xpath=..')
    .getByRole('button', { name: `Actions de ${dossier}` })
    .click()
  await page.getByRole('button', { name: /Nouvelle base de données/ }).click()
  await page.waitForSelector('[data-testid=dossier-de-la-modale]')
}
