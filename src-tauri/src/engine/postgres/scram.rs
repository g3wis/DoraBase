//! Le vérificateur SCRAM-SHA-256 d'un mot de passe de rôle (`API-32`, 9 septembre 2026).
//!
//! # Pourquoi le mot de passe est haché **ici**, et pas envoyé au serveur
//!
//! `ALTER ROLE x PASSWORD 'secret'` marche, et c'est ce qu'on écrit d'abord. Il a trois défauts, et
//! le troisième est celui qui décide :
//!
//! 1. le mot de passe traverse le réseau **en clair** dans l'ordre SQL, chiffré par TLS seulement si
//!    la connexion l'est — or `prefer` replie en clair sans le dire ;
//! 2. il atterrit dans les **journaux du serveur** dès que `log_statement` vaut `ddl` ou `all`, et
//!    dans `pg_stat_activity` le temps de l'exécution — là où n'importe quel superutilisateur le
//!    lit ;
//! 3. et surtout, il rendrait la confirmation de ce produit **impossible à tenir**. Elle promet de
//!    montrer le SQL exact qui part ; avec un mot de passe en clair dedans, elle l'afficherait à
//!    l'écran de quelqu'un qui demande « je fais ça ? » à son voisin, et le masquer ferait mentir la
//!    promesse. C'est la raison pour laquelle `CREATE ROLE` est resté sans mot de passe.
//!
//! Le hachage côté client lève les trois d'un coup : ce qui part est le **vérificateur**, c'est-à-dire
//! exactement ce que `pg_authid` stockera, et il peut donc s'afficher sans mentir ni divulguer le
//! mot de passe. C'est ce que fait `\password` de `psql`, et pour ces raisons-là.
//!
//! **Ce que le vérificateur reste** : un dérivé salé à 4096 tours, non le mot de passe — on ne peut
//! pas le relire à l'envers. Il n'est pas anodin pour autant (qui le possède peut se faire passer
//! pour le rôle auprès d'un serveur SCRAM), mais c'est déjà la valeur que la base garde, et celle que
//! le réseau porterait de toute façon.
//!
//! # Ce que ce module n'invente pas
//!
//! Le format est celui de PostgreSQL, lisible dans `pg_authid.rolpassword` :
//!
//! ```text
//! SCRAM-SHA-256$<tours>:<sel base64>$<StoredKey base64>:<ServerKey base64>
//! ```
//!
//! et la dérivation celle de la RFC 5802 : `SaltedPassword = Hi(SASLprep(mdp), sel, tours)`,
//! `ClientKey = HMAC(SaltedPassword, "Client Key")`, `StoredKey = SHA256(ClientKey)`,
//! `ServerKey = HMAC(SaltedPassword, "Server Key")`.

use base64::Engine as _;
use hmac::{Hmac, KeyInit, Mac};
use rand::Rng as _;
use sha2::{Digest, Sha256};

use crate::engine::EngineError;

/// Le nombre de tours de PBKDF2. **Celui de PostgreSQL**, non un choix fait ici.
///
/// `password_encryption` ne se règle pas côté client, et le serveur emploie 4096 depuis la 10. Un
/// nombre plus élevé serait accepté — le format le porte — mais produirait des vérificateurs qui ne
/// ressemblent à aucun de ceux que la base a écrits elle-même, ce qui ferait chercher une différence
/// là où il n'y en a pas.
const TOURS: u32 = 4096;

/// La taille du sel, en octets. Celle de PostgreSQL.
const OCTETS_DE_SEL: usize = 16;

type HmacSha256 = Hmac<Sha256>;

/// Le vérificateur d'un mot de passe, prêt à être posé par `ALTER ROLE … PASSWORD`.
///
/// **Le sel est tiré ici, une fois.** C'est ce qui oblige l'écran à demander le vérificateur *avant*
/// de composer le geste : si le plan et l'exécution le calculaient chacun de leur côté, ils
/// tireraient deux sels et l'encart montrerait un ordre qui n'est pas celui qui part — la promesse
/// exactement retournée contre elle-même.
pub fn verificateur(mot_de_passe: &str) -> Result<String, EngineError> {
    // `rand::rng()` est le générateur du fil, réamorcé depuis le système et marqué `CryptoRng` : la
    // même source que celle dont `chacha20poly1305` tire les nonces du magasin de secrets. Un sel
    // prévisible ne rendrait pas le vérificateur lisible, mais il permettrait de préparer une table
    // pour un mot de passe faible — ce que le sel existe pour empêcher.
    let mut sel = [0u8; OCTETS_DE_SEL];
    rand::rng().fill_bytes(&mut sel);
    verificateur_avec_sel(mot_de_passe, &sel, TOURS)
}

/// La même chose, le sel et les tours en paramètres.
///
/// Séparée pour la raison de `connect_via` : une fonction dont une part est aléatoire ne se compare
/// à rien. Avec un sel donné, elle est **pure**, donc le format se gèle dans un test.
pub fn verificateur_avec_sel(
    mot_de_passe: &str,
    sel: &[u8],
    tours: u32,
) -> Result<String, EngineError> {
    // **SASLprep avant tout le reste** (RFC 4013), parce que c'est ce que le serveur ferait. Sans
    // elle, un mot de passe portant un espace insécable ou une ligature produirait un vérificateur
    // que le pilote ne retrouverait pas à la connexion suivante : le compte serait verrouillé, sans
    // message et sans que rien ne l'ait annoncé.
    //
    // **Un échec n'est pas un repli.** `stringprep` refuse ce que le profil interdit — un caractère
    // de contrôle, un mélange de sens d'écriture. PostgreSQL, lui, prend alors le mot de passe tel
    // quel ; nous refusons, parce qu'un vérificateur posé sur une chaîne que le client normalisera
    // autrement est précisément le compte verrouillé qu'on cherche à éviter.
    let prepare = stringprep::saslprep(mot_de_passe).map_err(|_| {
        EngineError::local(
            "ce mot de passe contient un caractère que la normalisation SASLprep refuse (RFC 4013) \
             — un caractère de contrôle, ou un mélange de sens d'écriture. Le serveur et le pilote \
             ne s'accorderaient pas sur sa forme, et le rôle deviendrait injoignable."
                .to_owned(),
        )
    })?;

    let sale = hi(prepare.as_bytes(), sel, tours);
    let cle_client = hmac(&sale, b"Client Key");
    let cle_stockee = Sha256::digest(cle_client);
    let cle_serveur = hmac(&sale, b"Server Key");

    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(format!(
        "SCRAM-SHA-256${tours}:{}${}:{}",
        b64.encode(sel),
        b64.encode(cle_stockee),
        b64.encode(cle_serveur)
    ))
}

/// `Hi` de la RFC 5802 — c'est-à-dire PBKDF2-HMAC-SHA-256 sur une seule sortie de bloc.
///
/// **Écrit ici plutôt qu'en dépendance**, et c'est huit lignes : la crate `pbkdf2` exigerait
/// d'appairer sa version avec celles de `hmac` et `digest`, dont deux exemplaires cohabitent déjà
/// dans l'arbre. Une boucle de XOR n'a pas besoin d'être achetée — mais elle a besoin d'être
/// vérifiée, d'où le vecteur de la RFC 7914 dans les tests.
fn hi(mot_de_passe: &[u8], sel: &[u8], tours: u32) -> [u8; 32] {
    // Le premier tour porte `sel || INT(1)` : la sortie fait exactement un bloc SHA-256, donc il n'y
    // a jamais de second bloc à concaténer.
    let mut sale = [0u8; 32];
    let mut precedent = {
        let mut mac = HmacSha256::new_from_slice(mot_de_passe).expect("HMAC accepte toute clé");
        mac.update(sel);
        mac.update(&1u32.to_be_bytes());
        mac.finalize().into_bytes()
    };
    sale.copy_from_slice(&precedent);

    for _ in 1..tours {
        precedent = {
            let mut mac = HmacSha256::new_from_slice(mot_de_passe).expect("HMAC accepte toute clé");
            mac.update(&precedent);
            mac.finalize().into_bytes()
        };
        for (accumule, tour) in sale.iter_mut().zip(precedent.iter()) {
            *accumule ^= tour;
        }
    }
    sale
}

fn hmac(cle: &[u8], message: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(cle).expect("HMAC accepte toute clé");
    mac.update(message);
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hi_rend_le_vecteur_de_la_rfc_7914() {
        // **Un vecteur externe, et c'est tout l'intérêt** : figer ma propre sortie ne vérifierait que
        // ma propre boucle. PBKDF2-HMAC-SHA-256 avec P="passwd", S="salt", c=1 — RFC 7914 § 11, dont
        // les 32 premiers octets sont ceux que `Hi` rend.
        let attendu = [
            0x55, 0xac, 0x04, 0x6e, 0x56, 0xe3, 0x08, 0x9f, 0xec, 0x16, 0x91, 0xc2, 0x25, 0x44,
            0xb6, 0x05, 0xf9, 0x41, 0x85, 0x21, 0x6d, 0xde, 0x04, 0x65, 0xe6, 0x8b, 0x9d, 0x57,
            0xc2, 0x0d, 0xac, 0xbc,
        ];
        assert_eq!(hi(b"passwd", b"salt", 1), attendu);
    }

    #[test]
    fn le_format_est_celui_de_pg_authid() {
        // Le sel est fixe, donc la sortie est reproductible : c'est la **forme** qui est gelée ici —
        // le préfixe, les deux séparateurs, les deux clés en base64. Le fait que la valeur soit la
        // bonne se vérifie contre un vrai serveur, dans `tests_db_administration`.
        let rendu = verificateur_avec_sel("pencil", b"0123456789abcdef", 4096)
            .expect("un mot de passe ASCII passe SASLprep");

        assert!(rendu.starts_with("SCRAM-SHA-256$4096:"), "{rendu}");
        let corps = rendu.trim_start_matches("SCRAM-SHA-256$");
        let (tours_et_sel, cles) = corps.split_once('$').expect("deux parties");
        assert_eq!(tours_et_sel, "4096:MDEyMzQ1Njc4OWFiY2RlZg==");
        let (stockee, serveur) = cles.split_once(':').expect("deux clés");
        // 32 octets en base64 : 44 caractères, le dernier étant le remplissage.
        assert_eq!(stockee.len(), 44, "{stockee}");
        assert_eq!(serveur.len(), 44, "{serveur}");
        assert_ne!(
            stockee, serveur,
            "les deux clés dérivent de messages distincts"
        );
    }

    #[test]
    fn deux_appels_ne_rendent_pas_le_meme_verificateur() {
        // Le sel est tiré à chaque fois : deux rôles au même mot de passe n'ont pas la même ligne
        // dans `pg_authid`, et c'est exactement ce à quoi le sel sert.
        let premier = verificateur("pencil").expect("aléa");
        let second = verificateur("pencil").expect("aléa");
        assert_ne!(premier, second);
    }

    #[test]
    fn saslprep_normalise_avant_de_hacher() {
        // U+00A0, l'espace insécable, que SASLprep ramène à l'espace ordinaire. Sans cette étape le
        // vérificateur ne correspondrait pas à ce que le pilote calcule à la connexion — un compte
        // verrouillé, sans message.
        let insecable = verificateur_avec_sel("mot\u{00A0}de passe", b"0123456789abcdef", 4096)
            .expect("SASLprep accepte");
        let ordinaire = verificateur_avec_sel("mot de passe", b"0123456789abcdef", 4096)
            .expect("SASLprep accepte");
        assert_eq!(insecable, ordinaire);
    }

    #[test]
    fn un_mot_de_passe_que_saslprep_refuse_est_refuse_ici_aussi() {
        // **Et non pris tel quel**, ce que PostgreSQL ferait : un vérificateur posé sur une chaîne
        // que le client normalisera autrement rendrait le rôle injoignable, sans message.
        let erreur = verificateur_avec_sel("mot\u{0007}de passe", b"0123456789abcdef", 4096)
            .expect_err("un caractère de contrôle est refusé");
        assert!(erreur.message.contains("SASLprep"), "{erreur}");
    }

    #[test]
    fn un_mot_de_passe_vide_reste_hachable() {
        // Refuser ici serait décider à la place de l'écran : c'est le formulaire qui exige une
        // saisie, et un mot de passe vide est une valeur que le serveur accepte.
        assert!(verificateur_avec_sel("", b"0123456789abcdef", 4096).is_ok());
    }
}
