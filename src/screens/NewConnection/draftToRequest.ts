import type { ConnectionRequest } from '../../domain/engine'
import type { ConnectionDraft } from './ConnectionDraft'
import { authentifieParBase } from './engines'
import { tunnelDraftToTunnel } from './tunnelDraftToTunnel'

/**
 * Convertit le brouillon de `A2` en requête de test.
 *
 * **Ce n'est pas la conversion de `08e`.** Celle-ci produit une `ConnectionSettings`
 * *persistable* — mot de passe rangé, `SecretRef` en place, invariants de `05a` vérifiés, refus
 * possible. Ici on ne persiste rien : le mot de passe part en clair, à côté de la variante, et
 * un champ vide n'est pas une erreur mais une valeur que le moteur rejettera avec son propre
 * message. Confondre les deux ferait refuser un test parce qu'un nom de base est vide, alors
 * que tester sans nommer la base est parfaitement légitime.
 *
 * Le port est analysé ici. `Number.parseInt` sur une saisie invalide rend `NaN`, que `serde`
 * refuserait avec une erreur de désérialisation illisible ; `0` est envoyé à la place, et
 * PostgreSQL rend alors une erreur de connexion claire.
 */
export function draftToRequest(draft: ConnectionDraft): ConnectionRequest {
  const port = Number.parseInt(draft.port, 10)

  return {
    // **Le moteur voyage, il n'est plus supposé.** Il manquait, et `test_connection` appelait
    // l'adaptateur PostgreSQL quel que soit le choix de l'écran : tester une base MongoDB
    // faisait parler le protocole PostgreSQL à un `mongod`, qui n'y répond rien — l'appel
    // restait pendu, et « Tester la connexion » n'aboutissait jamais. Un clic sans effet
    // visible, donc le symptôme le plus difficile à rapporter.
    engine: draft.engine,
    // **Pas d'environnement ici.** `ConnectionRequest` sert au *test* de connexion (`08d`) : il ne
    // persiste rien, donc il n'a pas besoin de savoir à quel environnement la connexion appartiendra.
    // C'est `SaveDatabaseRequest` qui le porte (`enregistrerLaBase`).
    variant: {
      host: draft.host,
      port: Number.isFinite(port) ? port : 0,
      defaultDatabase: draft.defaultDatabase,
      username: draft.username,
      // La variante ne porte **jamais** de mot de passe : `05a` n'y met qu'une `SecretRef`, et
      // aucune n'existe avant `08e`. Le secret voyage à côté.
      password: null,
      sslMode: draft.sslMode,
      // Le vide devient `null` : « aucune autorité déclarée » se dit par l'absence,
      // et une chaîne vide dans le fichier de configuration se lirait comme un chemin.
      caCertificate: draft.caCertificate.trim() === '' ? null : draft.caCertificate.trim(),
      authDatabase: baseDAuthentificationAEnvoyer(draft),
      readOnly: draft.readOnly,
      reconnectOnStartup: draft.reconnectOnStartup,
      tunnel: tunnelDraftToTunnel(draft.tunnel),
    },
    password: draft.password === '' ? null : draft.password,
  }
}

/**
 * La base d'authentification à envoyer, **selon le moteur**.
 *
 * Le brouillon neuf porte `admin` (voir `emptyDraft`), et ce préremplissage n'a de sens que pour
 * MongoDB : seul moteur dont les utilisateurs habitent une base. Sans ce filtre, chaque connexion
 * PostgreSQL enregistrerait une base d'authentification `admin` que rien ne lit — du bruit dans le
 * fichier de configuration, et une affirmation fausse sur la connexion.
 *
 * Le vide devient `null` : c'est la convention du certificat d'autorité juste à côté, et un `''`
 * ferait s'authentifier MongoDB contre une base nommée « », qui n'existe pas.
 */
export function baseDAuthentificationAEnvoyer(draft: ConnectionDraft): string | null {
  if (!authentifieParBase(draft.engine)) return null
  const saisie = draft.authDatabase.trim()
  return saisie === '' ? null : saisie
}
