//! L'export d'un résultat de console dans un fichier (`API-29`).
//!
//! # Pourquoi le sérialiseur est ici et non à l'écran
//!
//! Les lignes d'un résultat de console sont **déjà dans la webview** — `RowLimit` en borne le
//! nombre à mille (`12c`) —, donc composer le CSV en TypeScript aurait été plus court d'un
//! aller-retour. Deux raisons l'écartent, et la seconde est décisive :
//!
//! - **la CSP interdit `blob:`**, et la décision prise avec elle est que l'écriture d'un fichier
//!   appartient au Rust (voir « L'export CSV est un sujet, pas un bouton » dans AGENTS.md). Si le
//!   Rust écrit, il lui faut de toute façon les octets ;
//! - **l'export de la vue table ne pourra être qu'un flux écrit ici.** Il porte 1,9 million de
//!   lignes, que rien ne fera traverser l'IPC. Un sérialiseur CSV écrit à l'écran maintenant et un
//!   second écrit ici plus tard divergeraient sur la citation, les `NULL` et les sauts de ligne —
//!   c'est la règle n° 17, « deux voies pour un même acte en laissent une en arrière », appliquée à
//!   un format de fichier que personne ne relit une fois écrit.
//!
//! # Ce qui est exporté
//!
//! **Les colonnes que l'écran montre, dans l'ordre où il les montre**, et toutes les lignes du
//! résultat. La projection est décidée par l'appelant — `ConsoleView` tient les masquées et l'ordre,
//! et réécrit déjà la requête avec eux —, donc ce module ne reçoit que la liste finale.
//!
//! **Les valeurs sont brutes, jamais le texte de la grille.** Celui-ci groupe les milliers, replie
//! un JSON sur une ligne et abrège un binaire en sa taille : un CSV qui porterait « 1 234 » avec une
//! espace insécable ne s'ouvrirait dans aucun tableur, et une colonne `bytea` exportée en
//! « \x… 42 o » serait un mensonge sur la donnée. C'est la distinction que `texteBrutDe` fait déjà
//! côté écran pour la saisie, pour la même raison.

use std::path::Path;

use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Value;

/// Les deux formats offerts.
///
/// **CSV et JSON, et pas seulement CSV.** Un résultat de console mongo est un arbre de documents et
/// non une grille (`13b`) : un CSV y serait l'aplatissement de documents hétérogènes en colonnes,
/// décision de produit explicitement remise. Sans JSON, l'un des quatre moteurs n'aurait aucun
/// export ; c'est l'écran qui refuse le CSV en mongo, avec sa raison (jamais en le cachant).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "engine.ts")]
pub enum ExportFormat {
    Csv,
    Json,
}

impl ExportFormat {
    /// L'extension du fichier proposé, sans le point.
    ///
    /// Elle vit **ici** et non à l'écran : le sélecteur de destination la propose, ce module la
    /// suppose, et deux tables de correspondance auraient fini par nommer un `.csv` que l'autre
    /// écrit en JSON.
    pub fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Json => "json",
        }
    }
}

/// Le séparateur d'enregistrements : `\n`, et non le `\r\n` de la RFC 4180.
///
/// Le même arbitrage que l'absence de BOM ci-dessous, et pour la même raison : ce fichier est de la
/// donnée avant d'être une pièce jointe. `\n` est ce que `COPY … CSV` écrit, ce que les outils unix
/// attendent, et ce qu'un tableur lit tout aussi bien — l'inverse n'est pas vrai.
const FIN_DE_LIGNE: char = '\n';

/// Sérialise en CSV — **UTF-8, sans BOM**.
///
/// Le BOM aurait fait qu'Excel sous Windows ouvre les accents correctement au double-clic. Il a été
/// écarté parce qu'il entre dans le **nom de la première colonne** de tout consommateur qui ne le
/// retire pas : `COPY … FROM`, `grep`, `pandas` sans `utf-8-sig`. Un export de base de données est
/// de la donnée à relire par un programme d'abord ; l'encodage se choisit à l'import d'un tableur,
/// un en-tête corrompu ne se rattrape nulle part.
///
/// # Le `NULL` et la chaîne vide
///
/// **La convention de `COPY … CSV` : `NULL` est un champ vide non cité, la chaîne vide s'écrit
/// `""`.** C'est la seule forme qui garde la distinction, et c'est l'une des rares que cet outil ne
/// doit jamais brouiller — la même raison qui fait écrire `NULL` en toutes lettres dans la grille
/// plutôt que de laisser une cellule blanche.
pub fn en_csv(colonnes: &[String], lignes: &[Vec<Value>]) -> String {
    let mut sortie = String::new();

    // L'en-tête passe par la même citation que les valeurs : un nom de colonne peut porter une
    // virgule — `count(*), total` sous un alias, ou une colonne citée à la création.
    ecrire_une_ligne(&mut sortie, colonnes.iter().map(|nom| cite(nom)));

    for ligne in lignes {
        ecrire_une_ligne(
            &mut sortie,
            (0..colonnes.len()).map(|index| champ_csv(ligne.get(index))),
        );
    }

    sortie
}

fn ecrire_une_ligne(sortie: &mut String, champs: impl Iterator<Item = String>) {
    let mut premier = true;
    for champ in champs {
        if !premier {
            sortie.push(',');
        }
        premier = false;
        sortie.push_str(&champ);
    }
    sortie.push(FIN_DE_LIGNE);
}

/// Un champ CSV : le texte brut de la valeur, cité si le format l'exige.
fn champ_csv(valeur: Option<&Value>) -> String {
    // Une valeur absente est traitée comme `NULL` : une ligne plus courte que l'en-tête n'arrive
    // pas d'un moteur, mais la supposer impossible serait un `unwrap` sur une donnée reçue de
    // l'IPC.
    match valeur {
        None | Some(Value::Null) => String::new(),
        Some(valeur) => cite(&texte_brut(valeur)),
    }
}

/// Cite un champ **quand il le faut, et seulement alors**.
///
/// La chaîne vide est citée : c'est ce qui la distingue d'un `NULL`, qui n'écrit rien du tout.
fn cite(champ: &str) -> String {
    let doit_citer = champ.is_empty()
        || champ.contains([',', '"', '\n', '\r'])
        // Une espace en tête ou en queue survit à la citation et se perd sans elle chez les
        // lecteurs qui rognent — dont Excel.
        || champ.starts_with(' ')
        || champ.ends_with(' ');

    if !doit_citer {
        return champ.to_owned();
    }
    let mut cite = String::with_capacity(champ.len() + 2);
    cite.push('"');
    for caractere in champ.chars() {
        if caractere == '"' {
            cite.push('"');
        }
        cite.push(caractere);
    }
    cite.push('"');
    cite
}

/// La valeur en texte **brut** — le pendant Rust de `texteBrutDe`, et non de `texteDeValeur`.
fn texte_brut(valeur: &Value) -> String {
    match valeur {
        Value::Null => String::new(),
        Value::Bool { value } => if *value { "true" } else { "false" }.to_owned(),
        Value::Int { value } => value.to_string(),
        // Ni groupement ni arrondi. Un flottant non fini — PostgreSQL accepte `'NaN'` et
        // `'Infinity'` sur un `double precision` — s'écrit tel que Rust le rend : `NaN`, `inf`. La
        // valeur d'origine du moteur n'est plus disponible à ce stade, `Value::Float` ne portant
        // qu'un `f64`.
        Value::Float { value } => value.to_string(),
        // Le texte exact rendu par la base : un `numeric` est un décimal de précision arbitraire, et
        // le reformater trahirait la valeur qu'on exporte précisément pour sa précision.
        Value::Decimal { value } | Value::Text { value } | Value::Timestamp { value } => {
            value.clone()
        }
        // **Le JSON entier, non replié.** La grille l'écrase sur une ligne pour tenir dans 26 px de
        // haut ; un fichier n'a pas cette contrainte, et la citation CSV traite les sauts de ligne.
        Value::Json { value } => value.clone(),
        // **Le base64, et non l'abrégé de la grille.** Il est sans perte et c'est déjà ce que
        // `texteBrutDe` rend côté écran ; « \x… 42 o » aurait été une description, pas une donnée.
        Value::Binary { base64 } => base64.clone(),
    }
}

/// Sérialise en JSON : un tableau d'objets, une clé par colonne.
///
/// Trois décisions :
///
/// - **les clés sont dans l'ordre des colonnes**, d'où la sérialisation à la main plutôt qu'une
///   `serde_json::Map` : celle-ci est une `BTreeMap` faute de la feature `preserve_order`, donc elle
///   aurait rendu les colonnes **triées alphabétiquement** — l'ordre que l'utilisateur vient de
///   régler à la poignée, perdu en silence. L'activer aurait changé le comportement de `serde_json`
///   dans tout le binaire, mongo et BigQuery compris ;
/// - **un `Value::Json` redevient un objet**, il ne reste pas une chaîne échappée. C'est ce que
///   `documentsDe` fait déjà pour l'arbre de `13b`, et sans quoi l'export d'un résultat mongo — le
///   seul format qui lui soit offert — aurait porté du JSON dans du JSON ;
/// - **un décimal reste une chaîne.** C'est ce que la vue JSON de la console affiche déjà, et un
///   nombre JSON serait relu en `double` par la plupart des consommateurs : un `numeric(20,2)` y
///   perdrait les chiffres pour lesquels il existe.
///
/// **Limite assumée** : deux colonnes homonymes — `select 1 as a, 2 as a` — donnent deux clés
/// homonymes. C'est du JSON valable, et les fondre en aurait perdu une, ce qui est le défaut qu'un
/// export ne peut pas se permettre.
pub fn en_json(colonnes: &[String], lignes: &[Vec<Value>]) -> Result<String, String> {
    let documents: Vec<Ligne<'_>> = lignes
        .iter()
        .map(|valeurs| Ligne { colonnes, valeurs })
        .collect();

    serde_json::to_string_pretty(&documents)
        .map(|mut json| {
            // Un fichier de texte se termine par une fin de ligne, comme le CSV ci-dessus.
            json.push(FIN_DE_LIGNE);
            json
        })
        .map_err(|erreur| format!("le résultat n'a pas pu être mis en JSON : {erreur}"))
}

/// Une ligne en objet JSON, sérialisée dans l'ordre des colonnes.
struct Ligne<'a> {
    colonnes: &'a [String],
    valeurs: &'a [Value],
}

impl Serialize for Ligne<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut objet = serializer.serialize_map(Some(self.colonnes.len()))?;
        for (index, nom) in self.colonnes.iter().enumerate() {
            objet.serialize_entry(nom, &EnJson(self.valeurs.get(index)))?;
        }
        objet.end()
    }
}

/// Une valeur en donnée JSON — le pendant Rust de `brutDe`, dans `documents.ts`.
struct EnJson<'a>(Option<&'a Value>);

impl Serialize for EnJson<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            // Une valeur absente est un `null`, comme dans la grille et dans l'arbre : c'est la
            // perte déjà nommée par `documentsDe` — un champ absent et un champ nul arrivent tous
            // deux en `Value::Null` (`18e`).
            None | Some(Value::Null) => serializer.serialize_none(),
            Some(Value::Bool { value }) => serializer.serialize_bool(*value),
            Some(Value::Int { value }) => serializer.serialize_i64(*value),
            // `serde_json` écrit `null` pour un flottant non fini, JSON n'ayant pas de `NaN`. C'est
            // déjà ce que la traversée de l'IPC en fait à l'aller ; le CSV, lui, le garde.
            Some(Value::Float { value }) => serializer.serialize_f64(*value),
            Some(Value::Json { value }) => match serde_json::from_str::<serde_json::Value>(value) {
                Ok(imbrique) => imbrique.serialize(serializer),
                // Un JSON illisible est rendu tel quel plutôt que perdu : c'est une donnée de la
                // base. Même repli que `brutDe`.
                Err(_) => serializer.serialize_str(value),
            },
            Some(autre) => serializer.serialize_str(&texte_brut(autre)),
        }
    }
}

/// Écrit le contenu dans le fichier, et rend le nombre d'octets écrits.
///
/// **À l'échec d'écriture, le fichier partiel est supprimé** — la règle du dump (`22b`), et pour la
/// même raison : un export tronqué qui ressemble à un export complet est l'artefact dangereux de
/// cette fonction. Il n'y a rien à préserver en échange, l'ouverture l'ayant déjà tronqué.
///
/// **Mais seulement à l'échec d'écriture, et c'est la raison des deux étapes.** Un `fs::write` ne
/// distingue pas « l'ouverture a échoué » de « l'écriture a échoué », donc supprimer sur son seul
/// `Err` aurait effacé un fichier auquel on n'a **jamais touché** — celui dont l'ouverture est
/// refusée parce qu'il est en lecture seule, par exemple. Un export refusé qui détruit le fichier
/// précédent serait bien pire que l'export tronqué qu'on cherche à éviter.
pub fn ecrire(chemin: &Path, contenu: &str) -> Result<u64, String> {
    use std::io::Write;

    let refus = |erreur: std::io::Error| {
        format!(
            "le fichier « {} » n'a pas pu être écrit : {erreur}",
            chemin.display()
        )
    };

    // Rien n'est créé ni tronqué quand cette ouverture échoue : il n'y a donc rien à nettoyer.
    let mut fichier = std::fs::File::create(chemin).map_err(refus)?;

    match fichier.write_all(contenu.as_bytes()) {
        Ok(()) => Ok(contenu.len() as u64),
        Err(erreur) => {
            // L'échec de la suppression n'est pas remonté : c'est celui de l'écriture qui explique
            // ce qui s'est passé, et un second message le noierait.
            drop(fichier);
            let _ = std::fs::remove_file(chemin);
            Err(refus(erreur))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texte(valeur: &str) -> Value {
        Value::Text {
            value: valeur.to_owned(),
        }
    }

    #[test]
    fn le_csv_porte_son_en_tete_puis_ses_lignes() {
        let csv = en_csv(
            &["id".into(), "nom".into()],
            &[
                vec![Value::Int { value: 1 }, texte("Ada")],
                vec![Value::Int { value: 2 }, texte("Grace")],
            ],
        );
        assert_eq!(csv, "id,nom\n1,Ada\n2,Grace\n");
    }

    /// **La distinction que cet outil ne doit pas brouiller.** `NULL` n'écrit rien, la chaîne vide
    /// s'écrit `""` — la convention de `COPY … CSV`.
    #[test]
    fn le_nul_et_la_chaine_vide_ne_s_ecrivent_pas_pareil() {
        let csv = en_csv(&["a".into(), "b".into()], &[vec![Value::Null, texte("")]]);
        assert_eq!(csv, "a,b\n,\"\"\n");
    }

    #[test]
    fn un_champ_qui_porte_une_virgule_un_guillemet_ou_un_saut_de_ligne_est_cite() {
        let csv = en_csv(
            &["v".into()],
            &[
                vec![texte("Lovelace, Ada")],
                vec![texte("elle a dit « oui »")],
                vec![texte("un \"vrai\" guillemet")],
                vec![texte("deux\nlignes")],
                vec![texte(" espacé ")],
            ],
        );
        assert_eq!(
            csv,
            "v\n\"Lovelace, Ada\"\nelle a dit « oui »\n\"un \"\"vrai\"\" guillemet\"\n\
             \"deux\nlignes\"\n\" espacé \"\n"
        );
    }

    /// Un nom de colonne passe par la **même** citation : un alias peut porter une virgule.
    #[test]
    fn un_nom_de_colonne_est_cite_comme_une_valeur() {
        let csv = en_csv(&["total, en euros".into()], &[]);
        assert_eq!(csv, "\"total, en euros\"\n");
    }

    /// **Le texte brut, jamais celui de la grille.** Un entier groupé par milliers avec l'espace
    /// insécable de la locale ne s'ouvrirait dans aucun tableur.
    #[test]
    fn un_entier_s_ecrit_sans_groupement_et_un_binaire_en_base64() {
        let csv = en_csv(
            &["n".into(), "octets".into(), "montant".into()],
            &[vec![
                Value::Int { value: 1_234_567 },
                Value::Binary {
                    base64: "SGVsbG8=".into(),
                },
                Value::Decimal {
                    value: "12345678.91".into(),
                },
            ]],
        );
        assert_eq!(csv, "n,octets,montant\n1234567,SGVsbG8=,12345678.91\n");
    }

    /// Le JSON d'une cellule sort **entier**, sauts de ligne compris — la citation CSV s'en charge.
    #[test]
    fn un_json_de_cellule_n_est_pas_replie_dans_le_csv() {
        let csv = en_csv(
            &["doc".into()],
            &[vec![Value::Json {
                value: "{\n  \"a\": 1\n}".into(),
            }]],
        );
        assert_eq!(csv, "doc\n\"{\n  \"\"a\"\": 1\n}\"\n");
    }

    /// Une ligne plus courte que l'en-tête ne vient d'aucun moteur — mais elle vient de l'IPC.
    #[test]
    fn une_ligne_incomplete_comble_avec_des_champs_vides() {
        let csv = en_csv(&["a".into(), "b".into(), "c".into()], &[vec![texte("x")]]);
        assert_eq!(csv, "a,b,c\nx,,\n");
    }

    #[test]
    fn le_json_est_un_tableau_d_objets() {
        let json = en_json(
            &["id".into(), "nom".into()],
            &[vec![Value::Int { value: 1 }, texte("Ada")]],
        )
        .expect("le JSON doit se composer");
        assert_eq!(
            json,
            "[\n  {\n    \"id\": 1,\n    \"nom\": \"Ada\"\n  }\n]\n"
        );
    }

    /// **L'ordre des colonnes est celui de l'écran, pas l'alphabet.** C'est ce que la
    /// sérialisation à la main garantit ; une `serde_json::Map` aurait rendu `a` avant `z` avant
    /// `m`, en triant ce que la poignée de la grille vient de régler.
    #[test]
    fn les_cles_du_json_gardent_l_ordre_des_colonnes() {
        let json = en_json(
            &["z".into(), "a".into(), "m".into()],
            &[vec![
                Value::Int { value: 1 },
                Value::Int { value: 2 },
                Value::Int { value: 3 },
            ]],
        )
        .expect("le JSON doit se composer");
        let position = |cle: &str| json.find(cle).expect("chaque clé doit y être");
        assert!(position("\"z\"") < position("\"a\""));
        assert!(position("\"a\"") < position("\"m\""));
    }

    /// Sans cela, l'export d'un résultat mongo — son **seul** format — porterait du JSON échappé
    /// dans du JSON, et rien n'y serait relisible comme un document.
    #[test]
    fn un_json_de_cellule_redevient_un_objet_imbrique() {
        let json = en_json(
            &["contexte".into()],
            &[vec![Value::Json {
                value: "{\"pays\":\"FR\",\"essais\":[1,2]}".into(),
            }]],
        )
        .expect("le JSON doit se composer");
        assert!(json.contains("\"pays\": \"FR\""), "{json}");
        assert!(!json.contains("\\\""), "aucune chaîne échappée : {json}");
    }

    #[test]
    fn un_json_illisible_est_rendu_en_chaine_plutot_que_perdu() {
        let json = en_json(
            &["brut".into()],
            &[vec![Value::Json {
                value: "{ceci n'est pas du JSON".into(),
            }]],
        )
        .expect("le JSON doit se composer");
        assert!(json.contains("ceci n'est pas du JSON"), "{json}");
    }

    #[test]
    fn le_nul_est_un_null_json_et_le_decimal_une_chaine() {
        let json = en_json(
            &["vide".into(), "montant".into()],
            &[vec![
                Value::Null,
                Value::Decimal {
                    value: "12345678.91".into(),
                },
            ]],
        )
        .expect("le JSON doit se composer");
        assert!(json.contains("\"vide\": null"), "{json}");
        assert!(json.contains("\"montant\": \"12345678.91\""), "{json}");
    }

    #[test]
    fn les_deux_formats_nomment_leur_extension() {
        assert_eq!(ExportFormat::Csv.extension(), "csv");
        assert_eq!(ExportFormat::Json.extension(), "json");
    }

    #[test]
    fn ecrire_rend_le_nombre_d_octets() {
        let repertoire =
            std::env::temp_dir().join(format!("dorabase-export-{}", std::process::id()));
        std::fs::create_dir_all(&repertoire).expect("le répertoire de test");
        let fichier = repertoire.join("resultat.csv");

        let octets = ecrire(&fichier, "a,b\n1,2\n").expect("l'écriture doit réussir");
        assert_eq!(octets, 8);
        assert_eq!(
            std::fs::read_to_string(&fichier).expect("relecture"),
            "a,b\n1,2\n"
        );

        std::fs::remove_dir_all(&repertoire).ok();
    }

    /// Le message nomme le fichier : c'est la seule chose que l'utilisateur puisse corriger.
    #[test]
    fn un_chemin_impossible_est_refuse_en_nommant_le_fichier() {
        let chemin = std::path::Path::new("/repertoire-qui-n-existe-pas/resultat.csv");
        let erreur = ecrire(chemin, "a\n").expect_err("l'écriture doit échouer");
        assert!(erreur.contains("resultat.csv"), "{erreur}");
    }

    /// **Un export refusé ne détruit pas le fichier d'avant.**
    ///
    /// C'est le défaut qu'un `fs::write` suivi d'un `remove_file` produisait : il ne distingue pas
    /// l'ouverture de l'écriture, donc un fichier dont l'ouverture est **refusée** — en lecture
    /// seule ici — était supprimé alors que rien n'y avait été écrit. Le nettoyage vise un export
    /// tronqué ; effacer le précédent est bien pire.
    ///
    /// **`cfg(unix)`, et la garde n'est pas décorative** : `std::os::unix` compile sur Linux comme
    /// sur macOS, donc un oubli ne se verrait ni ici ni dans le job Linux de la CI — seulement dans
    /// le job Windows. C'est le seul défaut de compilation que le dépôt ait connu (`dump/discover.rs`,
    /// 31 août 2026). Le refus d'ouverture, lui, existe sous Windows par d'autres moyens — un
    /// fichier ouvert exclusivement, un attribut « lecture seule » —, mais aucun ne se pose depuis
    /// un test portable.
    #[cfg(unix)]
    #[test]
    fn un_fichier_dont_l_ouverture_est_refusee_survit() {
        use std::os::unix::fs::PermissionsExt;

        let repertoire = std::env::temp_dir().join(format!(
            "dorabase-export-refus-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&repertoire).expect("le répertoire de test");
        let fichier = repertoire.join("precedent.csv");
        std::fs::write(&fichier, "l'export précédent\n").expect("le fichier d'avant");
        std::fs::set_permissions(&fichier, std::fs::Permissions::from_mode(0o444))
            .expect("en lecture seule");

        let erreur = ecrire(&fichier, "a,b\n").expect_err("l'écriture doit être refusée");

        assert!(erreur.contains("precedent.csv"), "{erreur}");
        assert_eq!(
            std::fs::read_to_string(&fichier).expect("le fichier d'avant doit être encore là"),
            "l'export précédent\n"
        );

        std::fs::set_permissions(&fichier, std::fs::Permissions::from_mode(0o644)).ok();
        std::fs::remove_dir_all(&repertoire).ok();
    }
}
