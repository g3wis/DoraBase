import type { FolderColor, SslMode } from '../../domain/config'

/**
 * La pastille d'un dossier, en jeton de la palette (#166).
 *
 * **Anciennement `COULEURS_D_ENVIRONNEMENT`**, aux mêmes cinq clés : `FolderColor` a repris les
 * valeurs d'`EnvironmentColor`, et un sous-dossier migré depuis un environnement garde donc sa
 * teinte au pixel. Une couleur libre finirait par produire des pastilles indistinguables.
 */
export const COULEURS_DE_DOSSIER: Record<FolderColor, string> = {
  green: 'var(--success)',
  amber: 'var(--warn)',
  red: 'var(--danger)',
  slate: 'var(--ink-4)',
  violet: 'var(--violet)',
}

/** Les cinq couleurs, dans l'ordre où la rangée de pastilles les propose. */
export const ORDRE_DES_COULEURS: readonly FolderColor[] = [
  'green',
  'amber',
  'red',
  'slate',
  'violet',
]

/**
 * Les six modes SSL, dans l'ordre croissant d'exigence de `libpq` — celui du type Rust.
 *
 * Les deux derniers vérifient l'identité du serveur ; les autres non. La distinction n'est
 * pas cosmétique : `06b` emploie encore `NoTls`, donc ces deux modes ne vérifient rien
 * aujourd'hui, et `08d` doit le **dire** dans le résultat du test de connexion.
 */
export const SSL_MODES: Record<SslMode, { label: string; verifies: boolean }> = {
  disable: { label: 'disable', verifies: false },
  allow: { label: 'allow', verifies: false },
  prefer: { label: 'prefer', verifies: false },
  require: { label: 'require', verifies: false },
  'verify-ca': { label: 'verify-ca', verifies: true },
  'verify-full': { label: 'verify-full', verifies: true },
}

export const SSL_MODE_ORDER: readonly SslMode[] = [
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
]

/**
 * Vrai quand ce mode **authentifie** le serveur (`06f`).
 *
 * `verify-ca` et `verify-full` sont les deux seuls : `require` chiffre sans authentifier, donc il
 * n'empêche pas un intermédiaire — « l'erreur classique » que `06b` désignait. C'est ce qui décide de
 * l'affichage du champ « certificat d'autorité », comme de la mention « TLS non vérifié ».
 *
 * **Lit `verifies`, qui existait déjà** : une première version réécrivait la liste des deux modes, ce
 * qui aurait divergé de la table au premier mode ajouté. La table est la source.
 */
export function authentifie(mode: SslMode): boolean {
  return SSL_MODES[mode].verifies
}
