import { describe, expect, it } from 'vitest'
import {
  A_LA_MAIN,
  composerRessource,
  decomposerRessource,
  optionsDeCatalogue,
  optionsDeSorte,
  RAFRAICHIR,
  SORTES,
} from './ressourceKubernetes'

/** Un `t` de test : rend la clé et ses paramètres, ce qui suffit à distinguer les entrées. */
const t = (cle: string, parametres?: Record<string, string | number>) =>
  parametres ? `${cle}:${Object.values(parametres).join(',')}` : cle

describe('lire une ressource écrite', () => {
  it('sépare la sorte du nom, sans canoniser la sorte', () => {
    // `svc` reste `svc` : la canoniser en `service` **réécrirait la valeur enregistrée** au premier
    // geste dans le panneau, sur toutes les connexions déclarées avant `API-73`.
    expect(decomposerRessource('svc/postgres')).toEqual({ sorte: 'svc', nom: 'postgres' })
    expect(decomposerRessource('statefulset/postgres-0')).toEqual({
      sorte: 'statefulset',
      nom: 'postgres-0',
    })
  })

  it('lit un nom nu comme un pod, parce que c’est ce que kubectl en fait', () => {
    // Si l'écran le lisait comme autre chose, la liste des objets décrirait une sorte différente de
    // celle que la connexion joindra — une liste plausible tirée du mauvais endroit.
    expect(decomposerRessource('postgres-0')).toEqual({ sorte: 'pod', nom: 'postgres-0' })
  })

  it('propose « service » sur un formulaire neuf', () => {
    // Celle qui survit à un redéploiement, là où le suffixe d'un pod change — ce que le placeholder
    // d'avant `API-73` recommandait déjà.
    expect(decomposerRessource('')).toEqual({ sorte: 'service', nom: '' })
    expect(decomposerRessource('   ')).toEqual({ sorte: 'service', nom: '' })
  })
})

describe('écrire une ressource', () => {
  it('compose sorte et nom', () => {
    expect(composerRessource('service', 'postgres')).toBe('service/postgres')
  })

  it('rend le vide quand le nom est vide', () => {
    // **Le point qui compte** : `service/` est une chaîne *non vide*, donc elle franchirait le
    // contrôle du cœur — qui refuse une ressource absente avec une phrase utile — pour échouer
    // vingt secondes plus tard sur un message de `kubectl`.
    expect(composerRessource('service', '')).toBe('')
    expect(composerRessource('service', '   ')).toBe('')
  })

  it('laisse gagner un nom qui porte déjà sa sorte', () => {
    // Ce qu'écrit qui a l'habitude du champ d'avant, ou qui recopie une ligne de terminal. Composer
    // donnerait `service/svc/postgres`, que `kubectl` refuse — et seulement à l'ouverture.
    expect(composerRessource('service', 'svc/postgres')).toBe('svc/postgres')
    // Et l'aller-retour est stable : la liste des sortes affiche alors ce qui a été tapé.
    expect(decomposerRessource(composerRessource('service', 'svc/postgres')).sorte).toBe('svc')
  })
})

describe('la liste des sortes', () => {
  it('porte les quatre proposées, dans leur ordre', () => {
    expect(optionsDeSorte('service').map((option) => option.value)).toEqual(
      SORTES.map((sorte) => sorte.value),
    )
  })

  it('montre une sorte qu’on ne propose pas plutôt que de n’afficher rien', () => {
    // `ListeDeroulante` rend le libellé de l'option choisie : une valeur absente des options n'en a
    // pas, donc la liste paraîtrait **vide** sur une connexion qui porte pourtant `svc/postgres`.
    const options = optionsDeSorte('svc')
    expect(options.map((option) => option.value)).toContain('svc')
    expect(options.at(-1)).toEqual({ value: 'svc', label: 'svc' })
  })
})

describe('la liste lue au cluster', () => {
  it('porte les noms, puis les deux entrées qui agissent', () => {
    const options = optionsDeCatalogue(['postgres', 'redis'], 'postgres', t, null)
    expect(options.map((option) => option.value)).toEqual([
      'postgres',
      'redis',
      RAFRAICHIR,
      A_LA_MAIN,
    ])
  })

  it('met l’entrée du vide en tête quand le vide est une valeur', () => {
    // C'est l'espace de noms : son vide vaut « celui que `kubectl` emploierait ». La ressource, elle,
    // ne reçoit cette entrée que tant que rien n'est choisi — l'appelant décide en passant `null`.
    const options = optionsDeCatalogue(['prod'], '', t, 'celui de kubectl')
    expect(options.at(0)).toEqual({ value: '', label: 'celui de kubectl' })
  })

  it('montre une valeur que le cluster ne porte plus, et la dit absente', () => {
    // Un pod détruit par un redéploiement, un espace de noms supprimé. La taire viderait le champ
    // **en silence**, donc changerait ce que la connexion joindra sans que personne l'ait demandé.
    const options = optionsDeCatalogue(['postgres'], 'postgres-ancien', t, null)
    const absente = options.find((option) => option.value === 'postgres-ancien')
    expect(absente?.label).toBe('newConnection.tunnel.catalogueAbsent:postgres-ancien')
  })

  it('marque d’un glyphe les deux entrées qui agissent, et elles seules', () => {
    // **Leur place en queue ne suffit pas à les distinguer** : d'un coup d'œil, « Rafraîchir la
    // liste » au milieu de dix pods se lit comme un onzième pod. Le glyphe le dit avant la lecture.
    //
    // Le **nom** de l'icône et non l'icône : ces fonctions ne rendent rien, et c'est la décision —
    // quelle entrée porte quel glyphe — qui se garde ici.
    const options = optionsDeCatalogue(['postgres', 'redis'], 'postgres', t, 'le vide')

    const parValeur = new Map(options.map((option) => [option.value, option.icone]))
    expect(parValeur.get(RAFRAICHIR)).toBe('refresh')
    expect(parValeur.get(A_LA_MAIN)).toBe('kbd')
    // L'autre moitié, et c'est elle qui porte l'exigence : une liste où **tout** serait orné ne
    // distinguerait plus rien.
    expect(parValeur.get('postgres')).toBeUndefined()
    expect(parValeur.get('redis')).toBeUndefined()
    expect(parValeur.get('')).toBeUndefined()
  })

  it('n’ajoute pas d’entrée d’absence pour une valeur que la liste porte', () => {
    // Le contrôle négatif : sans lui, l'assertion d'au-dessus passerait aussi avec une entrée
    // ajoutée à chaque fois, donc chaque nom doublé dans la liste.
    const options = optionsDeCatalogue(['postgres'], 'postgres', t, null)
    expect(options.filter((option) => option.value === 'postgres')).toHaveLength(1)
  })
})
