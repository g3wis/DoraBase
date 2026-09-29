import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'
import type { DumpTransport } from '../../domain/dump'
import { LanguageProvider, useT } from '../../i18n/LanguageContext'
import { phraseDuTransport } from './verdict'

// En français figé, comme les autres tests de ces modales : les assertions portent sur des mots.
const { result } = renderHook(() => useT(), {
  wrapper: ({ children }: { children: ReactNode }) => (
    <LanguageProvider preferences={{ language: 'fr' }}>{children}</LanguageProvider>
  ),
})
const t = result.current

function phrase(transport: DumpTransport) {
  return phraseDuTransport(transport, t)
}

test('chaque mode se dit, et finit sur le nom que libpq recevra', () => {
  expect(phrase({ mode: 'disable', root: { kind: 'unused' } })).toMatch(/en clair.*\(disable\)$/)
  expect(phrase({ mode: 'prefer', root: { kind: 'unused' } })).toMatch(/en clair sinon \(prefer\)$/)
  expect(phrase({ mode: 'require', root: { kind: 'unused' } })).toMatch(/non vérifié \(require\)$/)
})

test('un mode qui vérifie nomme l’autorité employée', () => {
  expect(
    phrase({ mode: 'verify-full', root: { kind: 'file', path: '/Users/x/certs/interne.pem' } }),
  ).toMatch(/\/Users\/x\/certs\/interne\.pem \(verify-full\)$/)
  expect(phrase({ mode: 'verify-full', root: { kind: 'system' } })).toMatch(
    /autorités du système \(verify-full\)$/,
  )
  expect(phrase({ mode: 'verify-ca', root: { kind: 'file', path: '/c/ca.pem' } })).toMatch(
    /\/c\/ca\.pem \(verify-ca\)$/,
  )
  // Sans autorité déclarée, `verify-ca` s'appuie sur celle de libpq — et le dit, plutôt que de
  // laisser croire aux autorités du système, que libpq refuse dans ce mode.
  expect(phrase({ mode: 'verify-ca', root: { kind: 'libpqDefault' } })).toMatch(
    /~\/\.postgresql\/root\.crt \(verify-ca\)$/,
  )
})
