import { expect, test } from 'vitest'
import spriteBrut from '../design/icons/sprite.svg?raw'
import tokens from '../design/tokens.json'
import type { Engine } from '../domain/config'
import { ENGINE_ORDER } from '../screens/NewConnection/engines'
import {
  dessinDeConnexion,
  iconeDeConnexion,
  iconeParDefautDeConnexion,
  iconesDeConnexion,
  jetonDeMoteur,
  teinteDeConnexion,
} from './iconesDeConnexion'
import { ICONE_PAR_DEFAUT, ICONES_DE_DOSSIER } from './iconesDeDossier'

const LOGOS = ['pg', 'mysql', 'sqlite', 'mongo'] as const

test('sans icône, une connexion garde le logo de son moteur, `db` pour un moteur sans logo', () => {
  expect(iconeParDefautDeConnexion('postgresql')).toBe('pg')
  expect(iconeParDefautDeConnexion('mongodb')).toBe('mongo')
  expect(iconeParDefautDeConnexion('snowflake')).toBe('db')
  expect(iconeDeConnexion({ engine: 'postgresql', icon: null })).toBe('pg')
  expect(iconeDeConnexion({ engine: 'postgresql' })).toBe('pg')
})

test('chaque moteur offre 56 icônes : son logo en tête, puis celles des dossiers sans pin', () => {
  const sansPin = ICONES_DE_DOSSIER.filter((icone) => icone !== ICONE_PAR_DEFAUT)
  for (const engine of ENGINE_ORDER) {
    const offertes = iconesDeConnexion(engine)
    // La géométrie du panneau d'un dossier : huit colonnes, sept rangées.
    expect(offertes, engine).toHaveLength(56)
    expect(offertes[0], engine).toBe(iconeParDefautDeConnexion(engine))
    expect(offertes.slice(1), engine).toEqual(sansPin)
    expect(new Set(offertes).size, engine).toBe(offertes.length)
    // `pin` nomme un dossier ; une connexion dessinée ainsi se lirait comme un dossier.
    expect(offertes, engine).not.toContain('pin')
  }
})

test('le seul logo offert est celui du moteur de la connexion', () => {
  const offertes = iconesDeConnexion('postgresql')
  expect(offertes.filter((icone) => (LOGOS as readonly string[]).includes(icone))).toEqual(['pg'])
})

test('une icône offerte est dessinée, un nom inconnu ou d’un autre moteur retombe sur le logo', () => {
  expect(iconeDeConnexion({ engine: 'postgresql', icon: 'rocket' })).toBe('rocket')
  expect(iconeDeConnexion({ engine: 'postgresql', icon: 'une-icone-de-demain' })).toBe('pg')
  // `pin` existe au sprite, et reste refusé : il n'est pas dans la liste d'une connexion.
  expect(iconeDeConnexion({ engine: 'postgresql', icon: 'pin' })).toBe('pg')
  // Un éléphant écrit à la main sur une connexion MySQL : il n'est pas dans **sa** liste.
  expect(iconeDeConnexion({ engine: 'mysql', icon: 'pg' })).toBe('mysql')
})

test('le dessin suit celui des dossiers : cloud se dessine en Lucide, le nom reste', () => {
  expect(iconeDeConnexion({ engine: 'postgresql', icon: 'cloud' })).toBe('cloud')
  expect(dessinDeConnexion({ engine: 'postgresql', icon: 'cloud' })).toBe('lucide-cloud')
  expect(dessinDeConnexion({ engine: 'postgresql', icon: null })).toBe('pg')
})

test('sans couleur, le jeton du moteur et le logo dans sa teinte de marque', () => {
  expect(teinteDeConnexion({ engine: 'mongodb', color: null })).toEqual({
    couleur: 'var(--engine-mg)',
    teinterLeLogo: false,
  })
  expect(teinteDeConnexion({ engine: 'postgresql' }).teinterLeLogo).toBe(false)
})

test('une couleur choisie est celle du dossier, et elle s’impose au logo', () => {
  expect(teinteDeConnexion({ engine: 'postgresql', color: 'amber' })).toEqual({
    couleur: 'var(--folder-amber)',
    teinterLeLogo: true,
  })
})

test('le jeton de chaque moteur existe : un var() vers un jeton absent ne casse rien de visible', () => {
  for (const engine of ENGINE_ORDER) {
    // Lu dans `tokens.json`, la source : `--engine-pg` est l'aplatissement de `engine.pg.base`.
    const abrege = jetonDeMoteur(engine as Engine).match(/^var\(--engine-([a-z]+)\)$/)?.[1]
    expect(abrege, engine).toBeDefined()
    const jetons: Record<string, { base?: string }> = tokens.engine
    expect(jetons[abrege ?? '']?.base, engine).toMatch(/^#[0-9A-F]{6}$/i)
  }
})

test('les quatre logos du sprite se teintent par `--logo-tint`, avec leur couleur de marque en repli', () => {
  for (const logo of LOGOS) {
    const symbole = spriteBrut.match(new RegExp(`<symbol id="i-${logo}"[^\\n]*</symbol>`))?.[0]
    expect(symbole, logo).toBeDefined()
    // **Le repli est la teinte de marque** : personne ne pose la variable, et rien ne change.
    expect(symbole, logo).toMatch(/fill="var\(--logo-tint,#[0-9A-F]{6}\)"/)
  }
})
