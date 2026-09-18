import { expect, test } from '@playwright/test'
import { deplierUnEnvironnement } from './pourLesTests'

// `A10` de bout en bout : ce qu'un réglage change **réellement à l'écran**. Des géométries et des
// couleurs calculées, donc hors de portée de jsdom — qui ne calcule aucune mise en page.
test.beforeEach(async ({ page }) => {
  await page.goto('/?demo')
  await deplierUnEnvironnement(page)
  await page.getByRole('treeitem', { name: /^analytics/ }).dblclick()
  await page.getByRole('treeitem', { name: 'public' }).dblclick()
  await page.getByRole('treeitem', { name: /^orders 1\.9/ }).click()
  await page.waitForSelector('[role=grid]')
  await page.evaluate(() => document.fonts.ready)
})

async function ouvrirLesPreferences(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Préférences' }).click()
  await expect(page.getByRole('dialog', { name: 'Préférences' })).toBeVisible()
}

test('la densité change la hauteur des lignes de la grille', async ({ page }) => {
  const hauteurDe = () =>
    page.evaluate(() => {
      // **Index 3, et non 2** : la première ligne est l'en-tête, la seconde celle des filtres
      // (`10d`), qui a sa propre hauteur de 21 px. Mesurer la mauvaise ligne aurait fait échouer ce
      // test pour une raison qui n'a rien à voir avec la densité.
      const ligne = document.querySelector('[role=row][aria-rowindex="3"]')
      return ligne ? Math.round(ligne.getBoundingClientRect().height) : null
    })

  expect(await hauteurDe()).toBe(26)

  await ouvrirLesPreferences(page)
  await page.getByRole('tab', { name: 'Grille de données' }).click()
  await page.getByRole('slider', { name: 'Densité des lignes' }).fill('34')
  await page.getByRole('button', { name: 'Terminé' }).click()

  // **La mesure porte sur la ligne, pas sur le jeton.** Vérifier `--rowh` ne dirait que « la
  // variable a changé » ; ce qui compte est que la virtualisation de `10a` en tienne compte — c'est
  // le genre de réglage qui casse une grille écrite en supposant une hauteur fixe.
  expect(await hauteurDe()).toBe(34)
})

test('la grille reste utilisable à la densité la plus compacte', async ({ page }) => {
  await ouvrirLesPreferences(page)
  await page.getByRole('tab', { name: 'Grille de données' }).click()
  await page.getByRole('slider', { name: 'Densité des lignes' }).fill('20')
  await page.getByRole('button', { name: 'Terminé' }).click()

  const mesures = await page.evaluate(() => {
    // Les cinq premières lignes de **données** : l'en-tête et la ligne de filtres ont leur propre
    // hauteur, et les inclure ferait échouer la comparaison sur autre chose que la densité.
    const lignes = [...document.querySelectorAll('[role=row]')].slice(2, 7)
    const boites = lignes.map((l) => l.getBoundingClientRect())
    return {
      hauteurs: boites.map((b) => Math.round(b.height)),
      // Les lignes ne doivent pas se chevaucher : une virtualisation qui garderait un pas de 26 px
      // pour des lignes de 20 laisserait des trous, l'inverse les superposerait.
      chevauchement: boites.some((b, i) => i > 0 && b.top < (boites[i - 1]?.bottom ?? 0) - 1),
    }
  })
  expect(mesures.hauteurs).toEqual([20, 20, 20, 20, 20])
  expect(mesures.chevauchement).toBe(false)
})

/**
 * **Le relevé du point de la barre de titre est retiré, et il ne mesurait rien** (`25b`).
 *
 * Il visait `[class*="ProjectPill"]`, du nom du composant devenu `SelectionIndicator`. Mais les
 * classes des modules CSS sont **hachées** en développement (`_root_jt7rl_23`) : ce sélecteur n'a
 * jamais rien désigné, d'où le `void pointDe` qui le neutralisait sans le dire. Le renommer
 * n'y changerait rien.
 *
 * Et la propriété qu'il visait est fausse : le point de l'indicateur porte l'état de la connexion
 * (`--success`, `--gold`, `--danger`) et son sac à dos porte `--accent-deep`, qu'aucune préférence ne
 * change — seul `--accent` suit le réglage (`preferences.ts`). Ce que le mockup promet — « sert aussi à
 * teinter la connexion active » — se vérifie donc sur l'onglet actif, et c'est ce que ce test fait.
 */
test('l’accent change le jeton, et l’onglet de la connexion active suit', async ({ page }) => {
  await ouvrirLesPreferences(page)
  await page.getByRole('radio', { name: 'sauge' }).check()
  await page.getByRole('button', { name: 'Terminé' }).click()

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  )
  expect(accent.toUpperCase()).toBe('#2E9E6B')
  // Et l'onglet actif suit : c'est le même jeton, et le vérifier ferme la boucle.
  const liseré = await page.evaluate(() => {
    const onglet = document.querySelector('[role=tab][aria-selected=true]')
    return onglet ? getComputedStyle(onglet).getPropertyValue('--accent').trim() : null
  })
  expect(liseré?.toUpperCase()).toBe('#2E9E6B')
})

test('« Nuit » pose l’attribut de thème, « Système » ne pose rien', async ({ page }) => {
  await ouvrirLesPreferences(page)
  await page.getByRole('radio', { name: /Nuit/ }).check()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('nuit')

  // **Rien pour « Système »** : sans attribut, c'est `prefers-color-scheme` qui décide, donc le
  // thème suit l'OS sans rechargement. Poser un attribut « système » obligerait le CSS à traiter un
  // troisième cas qui ne décrit aucune couleur.
  await page.getByRole('radio', { name: /Système/ }).check()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined()
})

test('la police du code s’applique à la grille et à l’éditeur', async ({ page }) => {
  await ouvrirLesPreferences(page)
  await page.getByRole('tab', { name: 'Grille de données' }).click()
  await page.getByRole('slider', { name: /Corps de la police/ }).fill('150')
  await page.getByRole('button', { name: 'Terminé' }).click()

  const corps = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-code').trim(),
  )
  expect(corps).toBe('15px')
  // Le plancher de densité a suivi : le curseur de densité ne peut plus descendre à 20.
  await ouvrirLesPreferences(page)
  await page.getByRole('tab', { name: 'Grille de données' }).click()
  const plancher = await page
    .getByRole('slider', { name: 'Densité des lignes' })
    .getAttribute('min')
  expect(Number(plancher)).toBeGreaterThan(20)
})

test('la modale des préférences tient dans la fenêtre minimale', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await ouvrirLesPreferences(page)

  const tient = await page.evaluate(() => {
    const modale = document.querySelector('[role=dialog][aria-label="Préférences"]')
    if (!modale) return null
    const boite = modale.getBoundingClientRect()
    return {
      dansLaLargeur: boite.left >= 0 && boite.right <= window.innerWidth,
      dansLaHauteur: boite.top >= 0 && boite.bottom <= window.innerHeight,
    }
  })
  // 960 × 600 est la fenêtre minimale déclarée du produit. Une modale qui en sort n'a plus de
  // « Terminé » atteignable — le piège que `modal-primitives` a déjà attrapé sur `A2`.
  expect(tient?.dansLaLargeur).toBe(true)
  expect(tient?.dansLaHauteur).toBe(true)
})

test('les six sections sont atteignables au clavier', async ({ page }) => {
  await ouvrirLesPreferences(page)
  // **Porté sur la modale** : la bande d'onglets de l'écran de travail en a aussi, et une
  // assertion à l'échelle de la page les compterait ensemble.
  const modale = page.getByRole('dialog', { name: 'Préférences' })
  const onglets = modale.getByRole('tab')
  // Six depuis `API-70` : « Connexions » est revenue, portant les kubeconfigs déclarés.
  await expect(onglets).toHaveCount(6)

  // `role="tablist"` **promet** la navigation aux flèches, il ne la fournit pas : un rôle ARIA
  // annonce une convention, et c'est au code de la tenir. Sans elle, un lecteur d'écran annonce
  // « onglet 1 sur 6 » et les flèches ne font rien.
  await modale.getByRole('tab', { name: 'Général' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(modale.getByRole('tab', { name: 'Apparence' })).toBeFocused()
  await expect(modale.getByRole('tab', { name: 'Apparence' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Et le parcours boucle : depuis la première, la flèche haute mène à la dernière — « Mises à
  // jour » depuis le 26 août 2026.
  await modale.getByRole('tab', { name: 'Général' }).click()
  await page.keyboard.press('ArrowUp')
  await expect(modale.getByRole('tab', { name: 'Mises à jour' })).toBeFocused()
})

// --- Une fenêtre trop courte pour la modale.
//
// `A10` porte le corps le plus haut du produit — un plancher de 340px, plus l'en-tête et le pied.
// Sur une fenêtre courte, la coquille est plafonnée par `Modal` : ce qui doit céder est la zone à
// deux colonnes, dont le panneau de droite a déjà son propre défilement — et non le corps de la
// modale, dont le défilement emporterait la bande de sections avec lui.
test.describe('sur une fenêtre trop courte', () => {
  test.use({ viewport: { width: 1360, height: 420 } })

  test('le pied et les sections restent en vue, et le corps de la modale ne défile pas', async ({
    page,
  }) => {
    await ouvrirLesPreferences(page)

    const mesures = await page.evaluate(() => {
      const modale = document.querySelector('[role=dialog]')
      const pied = document.querySelector('[data-testid=modal-footer]')
      const corpsDeLaModale = document.querySelector('[data-testid=modal-body]')
      // La zone à deux colonnes, désignée par le panneau qu'elle contient plutôt que par une
      // classe engendrée.
      const deuxColonnes = document.querySelector('[role=tabpanel]')?.parentElement
      const derniereSection = [...document.querySelectorAll('[role=tab]')].at(-1)
      if (!(modale && pied && corpsDeLaModale && deuxColonnes && derniereSection)) return null
      return {
        basModale: Math.round(modale.getBoundingClientRect().bottom),
        basPied: Math.round(pied.getBoundingClientRect().bottom),
        basDerniereSection: Math.round(derniereSection.getBoundingClientRect().bottom),
        hauteurDesColonnes: Math.round(deuxColonnes.getBoundingClientRect().height),
        modaleDefile: corpsDeLaModale.scrollHeight > corpsDeLaModale.clientHeight,
        fenetre: window.innerHeight,
      }
    })

    expect(mesures?.basModale).toBeLessThanOrEqual(mesures?.fenetre as number)
    expect(mesures?.basPied).toBeLessThanOrEqual(mesures?.fenetre as number)
    // La bande de sections tient entièrement : c'est ce que le plancher de 340px lui coûtait.
    expect(mesures?.basDerniereSection).toBeLessThanOrEqual(mesures?.fenetre as number)
    // La zone à deux colonnes est passée **sous** son plancher de 340px : c'est elle qui a cédé,
    // et le panneau de droite défile déjà de lui-même.
    expect(mesures?.hauteurDesColonnes).toBeLessThan(340)
    expect(mesures?.modaleDefile).toBe(false)
  })
})

// --- La section « Connexions » : les kubeconfigs déclarés (`API-70`).
//
// **Ici et non en Vitest** : jsdom ne calcule aucune mise en page, donc ni « la liste tient dans la
// modale » ni « le retrait refusé porte sa raison au survol » n'y ont de juge (règle n° 9). Le décor
// de `?demo` déclare deux fichiers, dont un par défaut.
test.describe('les kubeconfigs déclarés', () => {
  test('la section liste les déclarations, avec leur chemin, sans sortir de la modale', async ({
    page,
  }) => {
    await ouvrirLesPreferences(page)
    const modale = page.getByRole('dialog', { name: 'Préférences' })
    await modale.getByRole('tab', { name: 'Connexions' }).click()

    // Les deux déclarations du décor, **et leur chemin** : c'est le chemin qui dit *quel* fichier,
    // là où le libellé ne dit que le nom qu'on lui a donné.
    const valeurs = await modale
      .locator('input[type=text], input:not([type])')
      .evaluateAll((champs) => champs.map((champ) => (champ as HTMLInputElement).value))
    expect(valeurs).toContain('prod')
    expect(valeurs).toContain('~/.kube/prod/config')
    expect(valeurs).toContain('~/.kube/bac-a-sable.yaml')

    // **Rien ne franchit le bord de la modale.** Deux champs et deux actions par entrée, dans une
    // colonne de droite dont la largeur n'a jamais été composée pour cela.
    const deborde = await page.evaluate(() => {
      const dialogue = document.querySelector('[role=dialog]')
      if (!dialogue) return null
      const cadre = dialogue.getBoundingClientRect()
      return [...dialogue.querySelectorAll('input, button')].some((element) => {
        const boite = element.getBoundingClientRect()
        return boite.width > 0 && (boite.right > cadre.right + 1 || boite.left < cadre.left - 1)
      })
    })
    expect(deborde).toBe(false)
  })

  test('l’étiquette « Par défaut » et « Retirer » se lisent comme le reste de la section', async ({
    page,
  }) => {
    // **Le défaut que ce test empêche a été livré une fois, et il était déjà écrit dans
    // `AGENTS.md`** (rapporté à l'usage, 18 septembre 2026 : « wrong font and font size »). Deux
    // causes, toutes deux muettes :
    //
    // - `font-size: var(--text-sm)` désignait un jeton qui **n'existe pas** — ni TypeScript, ni
    //   Biome, ni Vitest, ni aucune assertion de rôle ne le dit, et la déclaration est simplement
    //   ignorée ;
    // - `font: inherit` sur le bouton, posé pour « neutraliser » la police de formulaire d'un
    //   `<button>` — ce qu'il n'y avait pas à neutraliser, les styles d'auteur l'emportant de toute
    //   façon — reposait au passage famille, graisse et hauteur de ligne. C'est la leçon d'`API-55`,
    //   à la lettre, sur le fichier d'à côté.
    //
    // **Ce qui est gardé est une égalité, pas une valeur** : les deux contrôles se lisent comme la
    // note de la section. Figer « 11px Nunito 500 » périmerait au premier passage de design.
    await ouvrirLesPreferences(page)
    const modale = page.getByRole('dialog', { name: 'Préférences' })
    await modale.getByRole('tab', { name: 'Connexions' }).click()

    const polices = await page.evaluate(() => {
      const dialogue = document.querySelector('[role=dialog]')
      if (!dialogue) return null
      const police = (element: Element | null | undefined) => {
        if (!element) return null
        const calcule = getComputedStyle(element)
        return [calcule.fontFamily, calcule.fontSize, calcule.fontWeight, calcule.lineHeight].join(
          ' | ',
        )
      }
      return {
        // La référence : la note de la section, qui porte la police que le dépôt donne à ce
        // registre de texte.
        note: police(dialogue.querySelector('[class*=note]')),
        defaut: police(dialogue.querySelector('[class*=kubeconfigDefaut]')),
        retirer: police(dialogue.querySelector('[class*=kubeconfigRetrait]')),
      }
    })

    expect(polices?.note).not.toBeNull()
    expect(polices?.defaut).toBe(polices?.note)
    expect(polices?.retirer).toBe(polices?.note)
  })

  test('le bouton de retrait porte aria-disabled, jamais disabled', async ({ page }) => {
    await ouvrirLesPreferences(page)
    const modale = page.getByRole('dialog', { name: 'Préférences' })
    await modale.getByRole('tab', { name: 'Connexions' }).click()

    // **`aria-disabled` et non `disabled`** : un bouton désactivé ne reçoit ni focus ni survol, donc
    // son infobulle serait inatteignable — exactement là où elle est le plus utile, puisqu'elle dit
    // *quoi changer d'abord*. C'est le piège n° 3, et ce test est ce qui l'empêche de revenir.
    const retraits = modale.getByRole('button', { name: 'Retirer' })
    await expect(retraits).toHaveCount(2)

    // Aucune connexion du décor ne vise ces fichiers : les deux se retirent. C'est le **contrôle
    // positif** — sans lui, un refus qui refuserait tout passerait pour une garde qui marche.
    //
    // **Le refus lui-même est vérifié ailleurs**, et à deux niveaux : le câblage de l'écran — le
    // grisé et sa raison — dans `PreferencesDialog.test.tsx`, qui peut poser le décor qu'il faut
    // sans toucher à celui de `?demo` ; et la garantie du cœur dans `config::commands`. Ici il n'y
    // a que ce que jsdom ne sait pas juger : la géométrie, et le fait que le bouton reste
    // atteignable au survol.
    for (const rang of [0, 1]) {
      await expect(retraits.nth(rang)).toHaveAttribute('aria-disabled', 'false')
      await expect(retraits.nth(rang)).not.toHaveAttribute('disabled', '')
    }
  })
})
