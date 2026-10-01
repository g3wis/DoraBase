//! La nature d'une requête de console : lecture, écriture de données, ou modification de schéma
//! (#168).
//!
//! **Le miroir exact de `src/screens/Console/nature.ts`**, et la fixture partagée
//! `tests/fixtures/nature-sql.json` le garde : les deux classificateurs doivent rendre la même
//! réponse sur chacun de ses cas. L'écran refuse **avant la modale**, avec un message lisible ; le
//! cœur refuse ce qui arrive quand même — une version de l'écran en retard sur son cœur, ou un appel
//! qui ne passe pas par la console. Ce ne sont pas deux règles, c'est la même vue de deux côtés du
//! pont (règle n° 20).
//!
//! **Syntaxique, donc approximative, et volontairement large** — la raison écrite côté écran vaut
//! ici : refuser une lecture dont une chaîne contient `delete` dans un `with` est un inconfort,
//! laisser passer un `drop` sur une connexion en lecture seule ne l'est pas. Et sur les trois moteurs
//! qui la tiennent, la **session** du moteur est elle-même en lecture seule : ce classificateur ne
//! sert qu'à refuser *avant l'envoi*, avec une phrase plutôt qu'avec le message du serveur — et à
//! BigQuery, qui n'a aucune session à régler.

use serde::Serialize;

/// La nature d'une requête, sous la forme de `Nature` côté écran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Nature {
    Lecture,
    /// Écrit des données : `insert`, `update`, `delete`, `truncate`, `merge`, `copy`.
    Ecriture {
        instruction: String,
    },
    /// Modifie le schéma : `drop`, `alter`, `create`, `grant`…
    Schema {
        instruction: String,
    },
}

impl Nature {
    /// L'instruction qui écrit, en capitales ; `None` pour une lecture.
    pub fn instruction(&self) -> Option<&str> {
        match self {
            Self::Lecture => None,
            Self::Ecriture { instruction } | Self::Schema { instruction } => Some(instruction),
        }
    }
}

const ECRITURE: &[&str] = &["insert", "update", "delete", "truncate", "merge", "copy"];
const SCHEMA: &[&str] = &[
    "drop", "alter", "create", "grant", "revoke", "reindex", "vacuum", "cluster",
];

/// Classe une requête d'après son premier mot significatif — voir `natureDe`.
pub fn nature_de(sql: &str) -> Nature {
    let nu = sans_commentaires(sql).trim().to_lowercase();
    let premier = nu
        .split(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .next()
        .unwrap_or("");
    // `with … delete from` : le premier mot est `with`, mais la requête écrit — on cherche alors le
    // mot dans tout le texte, comme l'écran.
    let trouve = |liste: &[&str]| -> Option<String> {
        liste
            .iter()
            .find(|mot| {
                if premier == "with" {
                    contient_le_mot(&nu, mot)
                } else {
                    premier == **mot
                }
            })
            .map(|mot| mot.to_uppercase())
    };
    if let Some(instruction) = trouve(SCHEMA) {
        return Nature::Schema { instruction };
    }
    if let Some(instruction) = trouve(ECRITURE) {
        return Nature::Ecriture { instruction };
    }
    Nature::Lecture
}

/// `\bmot\b` au sens de JavaScript : une frontière de mot ASCII (`[A-Za-z0-9_]`).
fn contient_le_mot(texte: &str, mot: &str) -> bool {
    let est_de_mot = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    texte.match_indices(mot).any(|(debut, _)| {
        let avant = texte[..debut].chars().next_back();
        let apres = texte[debut + mot.len()..].chars().next();
        !est_de_mot(avant) && !est_de_mot(apres)
    })
}

/// Le SQL sans ses commentaires, **pour l'analyse seulement** : les blocs `/* … */` d'abord, qui
/// peuvent contenir des `--`, puis les commentaires de ligne. Un bloc non refermé court jusqu'à la
/// fin, comme la version de l'écran le laisse tel quel — il n'y a alors plus rien à classer après.
fn sans_commentaires(sql: &str) -> String {
    let mut sans_blocs = String::with_capacity(sql.len());
    let mut reste = sql;
    while let Some(debut) = reste.find("/*") {
        match reste[debut + 2..].find("*/") {
            Some(fin) => {
                sans_blocs.push_str(&reste[..debut]);
                sans_blocs.push(' ');
                reste = &reste[debut + 2 + fin + 2..];
            }
            None => break,
        }
    }
    sans_blocs.push_str(reste);

    sans_blocs
        .lines()
        .map(|ligne| match ligne.find("--") {
            Some(debut) => &ligne[..debut],
            None => ligne,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **La fixture partagée avec `nature.ts`** : les deux classificateurs doivent rendre exactement
    /// `expected`, sans quoi l'écran laisserait partir ce que le cœur refuse, ou l'inverse.
    #[test]
    fn la_fixture_partagee_de_la_nature_est_tenue() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/nature-sql.json"))
                .expect("fixture lisible");
        let cas = fixture["cases"].as_array().expect("des cas");
        // Contrôle positif : une fixture vide passerait.
        assert!(cas.len() >= 10, "{}", cas.len());
        for un in cas {
            let sql = un["sql"].as_str().expect("un sql");
            assert_eq!(
                serde_json::to_value(nature_de(sql)).expect("sérialisable"),
                un["expected"],
                "« {sql} »"
            );
        }
    }
}
