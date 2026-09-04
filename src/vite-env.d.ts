/// <reference types="vite/client" />

// Injectée par `vite.config.ts` depuis `package.json`, à la compilation.
declare const __APP_VERSION__: string
/** L'architecture de construction, affichée en pied des préférences (`15a`). */
declare const __APP_ARCH__: string
/**
 * La plateforme de construction — `'macos'`, `'windows'` ou `'linux'`.
 *
 * Typée `string` et non en union des trois : la valeur vient d'un `JSON.stringify` de
 * `vite.config.ts`, donc TypeScript n'en garantit rien, et une union promettrait ici une
 * garantie que seul `plateforme()` établit — par son repli.
 *
 * À lire par `shell/plateforme.ts` et **nulle part ailleurs** : un composant qui interroge le
 * global directement contourne le seul endroit où le sens de cette valeur est écrit, et il
 * cesse d'être testable par `DORABASE_PLATEFORME_DECOR`.
 */
declare const __APP_PLATFORM__: string
