# DoraBase

Un explorateur de bases de données desktop pour macOS, Windows et Linux : la densité de
l'explorateur d'IntelliJ, sans l'IDE. Quatre moteurs — **PostgreSQL**, **MySQL / MariaDB**,
**SQLite**, **MongoDB** — derrière un seul arbre, une grille dense, une console SQL et un écran
de structure.

Tauri 2 + React / TypeScript / Vite.

**macOS est la plateforme soutenue ; Windows et Linux sont distribués sans signature.** Chaque
version publiée porte un installateur `.exe` et deux paquets Linux à côté du `.dmg` : le produit
y fait tout ce qu'il fait sur macOS, et la CI le vérifie à chaque commit. Ce qui manque diffère
d'un côté à l'autre :

- **Windows** n'a pas de certificat Authenticode, donc **SmartScreen avertira au
  téléchargement** ;
- **Linux** n'a rien à signer, mais ses paquets sont construits sur la dernière Ubuntu des
  runners GitHub, donc **liés à la glibc de cette image** : une distribution plus ancienne ne les
  lancera pas.

Et sur les deux, **les installations ne se mettent pas à jour seules** — il faut retélécharger à
chaque version. La mise à jour en place est macOS seulement, et les raisons sont dites plus bas.

---

## Télécharger

**[Dernière version →](https://github.com/g3wis/DoraBase/releases/latest)**

Chaque version publiée porte un `.dmg` universel — Apple Silicon **et** Intel — et son
empreinte SHA-256 :

| Fichier | Contenu |
| --- | --- |
| `DoraBase-X.Y.Z-universal.dmg` | l'application, à glisser dans *Applications* |
| `DoraBase-X.Y.Z-universal.dmg.sha256` | l'empreinte, à comparer avant d'ouvrir |
| `DoraBase-X.Y.Z-universal.app.tar.gz` | la mise à jour, que l'application va chercher elle-même |
| `latest.json` | ce que l'application lit pour savoir qu'une version existe (macOS seulement) |
| `DoraBase-X.Y.Z-x64-setup.exe` | l'installateur Windows, **non signé** — voir plus bas |
| `DoraBase-X.Y.Z-x64-setup.exe.sha256` | son empreinte |
| `DoraBase-X.Y.Z-amd64.deb` | le paquet Debian / Ubuntu — voir plus bas |
| `DoraBase-X.Y.Z-amd64.AppImage` | la même application, sans installation, pour les autres distributions |

**macOS 13 Ventura** au minimum. Toutes les versions sont sur la
[page des releases](https://github.com/g3wis/DoraBase/releases).

### Installer

Ouvrir le `.dmg`, glisser **DoraBase** dans **Applications**, double-cliquer. C'est tout :
l'application est signée par un Developer ID Apple et **notariée**, donc macOS ne demande rien
et n'avertit de rien.

Vérifier, si le cœur vous en dit — c'est ce que la CI vérifie à chaque publication :

```bash
spctl --assess --type execute --verbose=4 /Applications/DoraBase.app
# /Applications/DoraBase.app: accepted
# source=Notarized Developer ID
```

L'empreinte du `.dmg` est publiée à côté de lui :

```bash
shasum -a 256 ~/Téléchargements/DoraBase-*.dmg
```

### Installer sur Windows

Télécharger `DoraBase-X.Y.Z-x64-setup.exe` et l'exécuter. **Windows affichera un avertissement
SmartScreen** — « Windows a protégé votre ordinateur » —, à passer par *Informations
complémentaires → Exécuter quand même*.

Ce n'est pas un défaut de l'installateur : il n'est signé par aucun certificat Authenticode, donc
rien n'atteste son origine, et SmartScreen le dit. Comparer l'empreinte publiée à côté est la
vérification qui reste :

```powershell
Get-FileHash DoraBase-X.Y.Z-x64-setup.exe -Algorithm SHA256
```

**Il n'y a pas de mise à jour automatique sous Windows** : l'application ne propose rien, et il
faut retélécharger l'installateur à chaque version. C'est délibéré — proposer un remplacement que
personne ne peut authentifier serait pire que de ne rien proposer. La section « Mises à jour » des
préférences le dit sur place, plutôt que d'offrir un bouton qui échouerait toujours.

### Installer sur Linux

Deux formes, au choix, et **la même application** dans les deux :

```bash
# Debian, Ubuntu et dérivées
sudo apt install ./DoraBase-X.Y.Z-amd64.deb

# Partout ailleurs : rien à installer
chmod +x DoraBase-X.Y.Z-amd64.AppImage
./DoraBase-X.Y.Z-amd64.AppImage
```

Le `.deb` déclare ses dépendances et s'appuie sur la WebKitGTK du système ; l'AppImage embarque
la sienne, ce qui la rend plus lourde et indifférente à la distribution. Il n'y a **pas de
`.rpm`** : Tauri le produit sans déclarer aucune dépendance, donc il s'installerait proprement
et pourrait ne pas se lancer — l'AppImage couvre ces distributions honnêtement.

Les empreintes sont publiées à côté :

```bash
sha256sum -c DoraBase-X.Y.Z-amd64.deb.sha256
```

**Le plancher est celui du runner qui a construit** — la dernière Ubuntu des images GitHub — donc
une distribution nettement plus ancienne refusera de lancer le binaire, avec une erreur de glibc.
C'est le pendant du « macOS 13 Ventura » ci-dessus, à une différence près : celui-là est déclaré,
celui-ci est subi. Compiler soi-même est la réponse en attendant (voir *Développer*).

**Pas de mise à jour automatique sous Linux non plus**, et la raison n'est pas celle de Windows :
la clé du projet suffirait à authentifier une archive, mais le mécanisme de Tauri ne sait
remplacer qu'un AppImage. Une installation par le `.deb` verrait une annonce de version et un
bouton qui échoue à tous les coups ; une voie qui marche pour une moitié des installations n'est
pas une voie.

### Mettre à jour

Rien à télécharger. Quand une version plus récente existe, DoraBase l'annonce dans sa **barre
d'état**, en bas à droite, à côté du numéro qui tourne : cliquer dessus montre les changements
et le bouton *Installer et redémarrer*. L'application se remplace et se relance seule.

Il n'y a **ni recherche périodique ni installation automatique** : la recherche a lieu une fois
au démarrage, et l'installation attend un clic. Hors ligne, ou derrière un pare-feu qui ferme
`github.com`, rien ne s'affiche et rien ne se plaint.

Ce que l'application accepte d'installer est **signé deux fois** : par Apple, qui décide si
macOS l'ouvre, et par une clé propre au projet, qui décide si l'application accepte de se
remplacer par ce qu'on lui envoie. Une archive dont la seconde signature ne correspond pas est
refusée avant d'être ouverte.

Le remplacement demande de pouvoir écrire dans le bundle. Installée d'un glisser-déposer dans
*Applications*, elle en a le droit ; posée là par un administrateur pour un autre compte, elle
ne l'a pas, et le dit plutôt que d'échouer en silence — dans ce cas, retéléchargez le `.dmg`.

### Essayer un commit, sans attendre une version

Chaque commit poussé produit trois artefacts de CI, gardés **sept jours** : ouvrir le
[job CI](https://github.com/g3wis/DoraBase/actions/workflows/ci.yml) du commit, section
*Artifacts*, puis `DoraBase-<sha>-dmg`, `DoraBase-<sha>-nsis` ou `DoraBase-<sha>-linux`. Il faut
un accès au dépôt, et le `.dmg` est **mono-architecture** — celle du runner GitHub. Pour
installer, préférez une version publiée.

---

## Numéroter et publier

Les versions sont en **`majeur.fonction.correctif`** (SemVer) :

| Cran | Quand | Commande |
| --- | --- | --- |
| **correctif** | une correction, rien de neuf | `./scripts/version.sh correctif` |
| **fonction** | une fonctionnalité, rien de cassé | `./scripts/version.sh fonction` |
| **majeur** | une rupture assumée | `./scripts/version.sh majeur` |

Le flux, du travail à la release :

```
branche de travail  ──PR──▶  main (CI verte)  ──version.sh──▶  tag vX.Y.Z  ──▶  release GitHub
```

1. **Le travail se fait sur une branche**, arrive dans `main` par PR, et `main` reste verte —
   `ci.yml` tourne sur chaque push et chaque PR.
2. **Publier**, depuis `main` à jour et propre :

   ```bash
   git switch main && git pull
   ./scripts/version.sh fonction        # relève les 3 fichiers, committe, pose le tag annoté
   git push origin main --follow-tags   # c'est le tag qui déclenche la publication
   ```

3. **Le tag `vX.Y.Z` déclenche `publication.yml`** : un premier job crée la release et écrit
   les notes de version — celles-ci listent les commits depuis le tag précédent —, puis
   **trois constructions en parallèle** y attachent leurs artefacts. macOS produit le bundle
   universel, sa signature et sa notarisation Apple, l'archive de mise à jour et le manifeste
   `latest.json` ; Windows produit l'installateur NSIS ; Linux produit le `.deb` et
   l'AppImage. Les trois ne dépendent que de la release, jamais l'une de l'autre : **un échec
   de Windows ou de Linux ne coûte pas la publication macOS**, qui est l'artefact soutenu.

Ce que le script refuse, et pourquoi : une branche autre que `main` (le tag désignerait un
état que la CI n'a pas validé), un arbre sale (le commit de relèvement emporterait du
travail en cours), une divergence avec `origin/main`, un numéro qui recule, un tag déjà
publié. Il **ne pousse rien** : la commande est affichée, le geste reste humain.

### Publier depuis GitHub, sans poste

Le même geste, en bouton : [Actions → Release → *Run workflow*][release-workflow], un cran
choisi dans la liste (correctif / fonction / majeur). Le workflow rejoue `scripts/version.sh`
sur `main` à jour, committe, tague et pousse — le tag qui en sort déclenche `publication.yml`
exactement comme depuis un poste local.

Un secret `RELEASE_PUSH_TOKEN` doit être posé sur le dépôt (jeton personnel, permission
*Contents: Read and write*) : un push fait avec `GITHUB_TOKEN` ne déclenche aucun autre
workflow, donc le tag ne partirait jamais vers `publication.yml`.

[release-workflow]: https://github.com/g3wis/DoraBase/actions/workflows/release.yml

### Les huit secrets

`publication.yml` les contrôle **avant de compiler** : un secret vide vaut la chaîne vide, et
l'échec tomberait sinon après vingt minutes, sur un message qui ne le nomme pas.

| Secret | Ce que c'est |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | « Developer ID Application: … » — sa présence décide de tout le bloc |
| `APPLE_CERTIFICATE` | le certificat, en base64 |
| `APPLE_CERTIFICATE_PASSWORD` | son mot de passe |
| `APPLE_API_KEY` | le **Key ID** App Store Connect (dix caractères) |
| `APPLE_API_KEY_P8` | la clé `.p8` elle-même, en base64 — `notarytool` veut un fichier |
| `APPLE_ISSUER_ID` | l'**Issuer ID** du même écran (un UUID) — les échanger est l'erreur naturelle |
| `TAURI_SIGNING_PRIVATE_KEY` | la clé qui signe les mises à jour, en une ligne |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | son mot de passe |

Sans les six premiers, la construction reste possible : signature ad hoc, sans notarisation,
et **sans mise à jour proposée** — une archive qu'Apple n'a pas acceptée s'installerait
proprement puis serait refusée au redémarrage, chez des gens qui n'ont plus de voie de retour.

> **La clé de mise à jour est irremplaçable.** Sa moitié publique est dans le bundle que les
> utilisateurs ont déjà ; la perdre coupe la voie de mise à jour de toutes les installations
> existantes, définitivement — il leur faudra retélécharger un `.dmg` une fois. Elle se génère
> par `pnpm tauri signer generate --write-keys <chemin>`, et se garde ailleurs que dans GitHub.
> Elle n'a rien à voir avec la signature Apple : celle-ci décide si macOS *ouvre*
> l'application, celle-là si une application installée accepte de se *remplacer*.

Un numéro de version vit à **trois** endroits — `package.json` (que `tauri.conf.json` lit,
donc celui qui finit dans l'`Info.plist` et dans le nom du `.dmg`), `src-tauri/Cargo.toml`
et `src-tauri/Cargo.lock`. `version.sh` les écrit ensemble ;
`scripts/verifier-version.py` refuse qu'ils divergent, en local comme en CI, et le
workflow de publication exige en plus qu'ils s'accordent avec le nom du tag.

---

## Développer

```bash
pnpm install
export PATH="$HOME/.cargo/bin:$PATH"   # cargo n'est pas dans le PATH de tous les shells

pnpm dev             # serveur Vite ; ?gallery pour la galerie, ?demo pour le décor de démo
pnpm tauri dev       # l'application, dans sa fenêtre native
./scripts/verifier-tout.sh             # la barrière avant commit : ce que lance la CI
```

### Sur Windows

```bash
pnpm install
pnpm tauri build     # produit un installateur NSIS dans src-tauri/target/release/bundle/nsis/
```

Trois prérequis, en plus de Node et Rust :

| Prérequis | Pourquoi |
| --- | --- |
| **Rust, toolchain MSVC** | `x86_64-pc-windows-msvc` ; la toolchain GNU n'est pas exercée |
| **Git Bash sur le `PATH`** | `pnpm proxy:embarquer` et le hook de bundle sont des scripts bash |
| **WebView2** | fourni par Windows 11 ; à installer sur un Windows 10 nu |

L'installateur produit **n'est pas signé** : Windows affichera un avertissement SmartScreen, et
il faut passer par « Informations complémentaires → Exécuter quand même ». C'est le même
arbitrage que la signature ad hoc de macOS avant l'achat du Developer ID — dit franchement
plutôt que de laisser croire à une application cassée.

Pour compiler pour Windows **depuis un Mac** (utile pour vérifier qu'une modification compile,
sans machine Windows) : voir la section *Commandes* d'[AGENTS.md](AGENTS.md).

### Sur Linux

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
pnpm install
pnpm tauri build     # produit un .deb et un .AppImage dans src-tauri/target/release/bundle/
```

Les quatre paquets sont ceux que la CI installe ; sur une distribution non Debian, prendre leurs
équivalents. **Construire soi-même est aussi la façon de descendre sous le plancher de glibc** des
paquets publiés : compilé sur votre distribution, le binaire s'y lie.

La coquille dessine ses propres boutons de fenêtre (`decorations: false`), et le
redimensionnement au bord est celui de tao : une bande de 5 px, active parce que la fenêtre est
sans décoration. Le menu natif, lui, est inséré **dans** la fenêtre par GTK, au-dessus de la barre
de titre — voir la réserve consignée dans [AGENTS.md](AGENTS.md).

Les conventions, les décisions et leurs raisons, les prohibitions de design et les pièges
propres à cette machine sont dans **[AGENTS.md](AGENTS.md)** — le document de référence du
dépôt.
