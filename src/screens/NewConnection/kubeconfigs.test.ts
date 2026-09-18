import { describe, expect, it } from 'vitest'
import type { Kubeconfigs } from '../../domain/config'
import { AUCUN, AUTRE_FICHIER, kubeconfigParDefaut, optionsDeKubeconfig } from './kubeconfigs'

/** Un `t` de test : rend la clé et ses paramètres, ce qui suffit à distinguer les entrées. */
const t = (cle: string, parametres?: Record<string, string | number>) =>
  parametres ? `${cle}:${Object.values(parametres).join(',')}` : cle

const DEUX: Kubeconfigs = {
  declarations: [
    { id: 'prod', label: 'prod', path: '~/.kube/prod/config' },
    { id: 'bac', label: 'bac à sable', path: '~/.kube/bac.yaml' },
  ],
}

describe('les entrées de la liste', () => {
  it('porte le repli en tête et l’entrée qui agit en queue', () => {
    const options = optionsDeKubeconfig(DEUX, t)

    expect(options.at(0)?.value).toBe(AUCUN)
    expect(options.at(-1)?.value).toBe(AUTRE_FICHIER)
    // Les déclarations entre les deux, dans leur ordre : celui de la liste réglée, non celui d'un
    // tri que personne n'a demandé.
    expect(options.slice(1, -1).map((option) => option.value)).toEqual(['prod', 'bac'])
  })

  it('affiche le chemin quand une déclaration n’a pas de libellé', () => {
    // Un libellé vide est représentable — le champ se vide dans les préférences. Rendre une entrée
    // sans texte ferait une ligne qu'on ne peut ni lire ni viser ; le chemin la nomme toujours.
    const options = optionsDeKubeconfig(
      { declarations: [{ id: 'prod', label: '  ', path: '~/.kube/prod/config' }] },
      t,
    )
    expect(options.map((option) => option.label)).toContain('~/.kube/prod/config')
  })

  it('montre une référence que plus rien ne déclare, et la dit retirée', () => {
    // **Le pire affichage serait le silence.** `ListeDeroulante` rend le libellé de l'option
    // choisie : une valeur absente des options n'en a pas, donc la liste paraîtrait vide. Et la
    // vider pour de bon ferait retomber la connexion sur le cluster **par défaut de `kubectl`**,
    // avec succès — le mode de défaillance que tout `API-70` traite comme inacceptable.
    const options = optionsDeKubeconfig(DEUX, t, 'disparu')

    const retiree = options.find((option) => option.value === 'disparu')
    expect(retiree?.label).toContain('disparu')
    expect(retiree?.label).toContain('kubeconfigRetire')
  })

  it('n’invente pas d’entrée pour une référence qui est bien déclarée', () => {
    // Le contrôle négatif du test précédent : sans lui, une entrée « retirée » s'ajouterait à
    // **chaque** choix, et la liste doublerait toutes ses déclarations.
    const options = optionsDeKubeconfig(DEUX, t, 'prod')
    expect(options.filter((option) => option.value === 'prod')).toHaveLength(1)
  })

  it('n’invente rien non plus quand rien n’est choisi', () => {
    const options = optionsDeKubeconfig(DEUX, t, AUCUN)
    expect(options.filter((option) => option.value === AUCUN)).toHaveLength(1)
  })
})

describe('le kubeconfig par défaut', () => {
  it('est celui que la configuration désigne', () => {
    expect(kubeconfigParDefaut({ ...DEUX, default: 'bac' })).toBe('bac')
  })

  it('vaut « celui de kubectl » quand aucun n’est désigné', () => {
    expect(kubeconfigParDefaut(DEUX)).toBe(AUCUN)
  })

  it('ignore un défaut qui ne désigne plus rien, plutôt que de le reprendre', () => {
    // **Une connexion neuve ne doit pas naître avec une référence morte.** Le cœur refuse déjà un
    // défaut non déclaré (`Kubeconfigs::valider`), donc ce cas vient d'un fichier édité à la main ;
    // le reprendre poserait à la création le défaut qu'on passe le reste du chantier à éviter.
    expect(kubeconfigParDefaut({ ...DEUX, default: 'disparu' })).toBe(AUCUN)
  })
})
