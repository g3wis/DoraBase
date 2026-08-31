//! La conversion des types BigQuery vers le contrat commun (`21`).
//!
//! **L'API REST rend toute valeur scalaire en chaîne**, y compris les nombres — `{"v": "42"}`,
//! jamais `{"v": 42}`. C'est le type *déclaré* de la colonne, pas la forme JSON de la cellule, qui
//! dit comment la lire. D'où la dépendance de chaque fonction ici sur `TableFieldSchema`, jamais sur
//! la seule valeur.
//!
//! **Les champs `REPEATED` sont rendus en `Value::Json`**, quel que soit leur type d'élément : un
//! tableau n'a pas d'équivalent direct dans `Value`, et le représenter fidèlement demanderait un
//! type récursif que rien d'autre dans le contrat commun n'a. Le JSON brut reste lisible et exact,
//! ce qu'une case vide ne serait pas.

use gcp_bigquery_client::model::field_type::FieldType;
use gcp_bigquery_client::model::table_field_schema::TableFieldSchema;
use serde_json::Value as Json;

use crate::engine::{TypeCategory, Value};

/// Le nom du type tel qu'`A5`/`A9` l'affichent — la forme SCREAMING_SNAKE_CASE de l'API, qui est
/// aussi celle du langage SQL de BigQuery (`INT64`, `TIMESTAMP`…). Un tableau porte `ARRAY<…>` en
/// préfixe, la forme que `bq` lui-même emploie.
pub fn nom_du_type(champ: &TableFieldSchema) -> String {
    let base = match champ.r#type {
        FieldType::String => "STRING",
        FieldType::Bytes => "BYTES",
        FieldType::Integer | FieldType::Int64 => "INT64",
        FieldType::Float | FieldType::Float64 => "FLOAT64",
        FieldType::Numeric => "NUMERIC",
        FieldType::Bignumeric => "BIGNUMERIC",
        FieldType::Boolean | FieldType::Bool => "BOOL",
        FieldType::Timestamp => "TIMESTAMP",
        FieldType::Date => "DATE",
        FieldType::Time => "TIME",
        FieldType::Datetime => "DATETIME",
        FieldType::Record | FieldType::Struct => "STRUCT",
        FieldType::Geography => "GEOGRAPHY",
        FieldType::Json => "JSON",
    };
    if repete(champ) {
        format!("ARRAY<{base}>")
    } else {
        base.to_owned()
    }
}

fn repete(champ: &TableFieldSchema) -> bool {
    champ.mode.as_deref() == Some("REPEATED")
}

/// La catégorie qu'`A5` affiche en glyphe — voir `introspection::TypeCategory`.
pub fn categorie(champ: &TableFieldSchema) -> TypeCategory {
    if repete(champ) {
        return TypeCategory::Json;
    }
    match champ.r#type {
        FieldType::String | FieldType::Geography => TypeCategory::Text,
        FieldType::Bytes => TypeCategory::Binary,
        FieldType::Integer
        | FieldType::Int64
        | FieldType::Float
        | FieldType::Float64
        | FieldType::Numeric
        | FieldType::Bignumeric => TypeCategory::Number,
        FieldType::Boolean | FieldType::Bool => TypeCategory::Boolean,
        FieldType::Timestamp | FieldType::Date | FieldType::Time | FieldType::Datetime => {
            TypeCategory::Timestamp
        }
        FieldType::Record | FieldType::Struct | FieldType::Json => TypeCategory::Json,
    }
}

/// Convertit une cellule brute — telle que l'API REST la rend en `serde_json::Value` — vers le
/// modèle commun, d'après le type **déclaré** de sa colonne.
pub fn valeur(brute: Option<Json>, champ: &TableFieldSchema) -> Value {
    let Some(brute) = brute else {
        return Value::Null;
    };
    if matches!(brute, Json::Null) {
        return Value::Null;
    }
    if repete(champ) {
        return Value::Json {
            value: brute.to_string(),
        };
    }
    let texte = en_texte(&brute);
    match champ.r#type {
        FieldType::String | FieldType::Geography => Value::Text { value: texte },
        // Le corps est déjà en base64 — `Value::Binary` l'exige tel quel (`06a`).
        FieldType::Bytes => Value::Binary { base64: texte },
        FieldType::Integer | FieldType::Int64 => texte
            .parse::<i64>()
            .map(|value| Value::Int { value })
            .unwrap_or(Value::Text { value: texte }),
        FieldType::Float | FieldType::Float64 => texte
            .parse::<f64>()
            .map(|value| Value::Float { value })
            .unwrap_or(Value::Text { value: texte }),
        // **Un décimal exact, gardé en texte** — même raison que `numeric` en PostgreSQL (`06a`) :
        // un `f64` perdrait de la précision sur de l'argent.
        FieldType::Numeric | FieldType::Bignumeric => Value::Decimal { value: texte },
        FieldType::Boolean | FieldType::Bool => match texte.as_str() {
            "true" => Value::Bool { value: true },
            "false" => Value::Bool { value: false },
            _ => Value::Text { value: texte },
        },
        // **Seul `TIMESTAMP` arrive en secondes Unix** ; `DATE`/`TIME`/`DATETIME` sont déjà du texte
        // formaté par l'API — les reformater serait le travail que `introspection.rs` refuse de
        // faire pour les autres moteurs.
        FieldType::Timestamp => horodatage_depuis_epoch(&texte),
        FieldType::Date | FieldType::Time | FieldType::Datetime => {
            Value::Timestamp { value: texte }
        }
        FieldType::Record | FieldType::Struct | FieldType::Json => Value::Json { value: texte },
    }
}

fn en_texte(valeur: &Json) -> String {
    match valeur {
        Json::String(s) => s.clone(),
        autre => autre.to_string(),
    }
}

fn horodatage_depuis_epoch(brut: &str) -> Value {
    let Ok(secondes) = brut.parse::<f64>() else {
        return Value::Timestamp {
            value: brut.to_owned(),
        };
    };
    match chrono::DateTime::from_timestamp(
        secondes.trunc() as i64,
        ((secondes.fract() * 1_000_000_000.0).round()) as u32,
    ) {
        Some(date) => Value::Timestamp {
            value: date.to_rfc3339(),
        },
        None => Value::Timestamp {
            value: brut.to_owned(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn champ(r#type: FieldType) -> TableFieldSchema {
        TableFieldSchema {
            categories: None,
            description: None,
            fields: None,
            mode: None,
            name: "c".into(),
            policy_tags: None,
            r#type,
        }
    }

    #[test]
    fn les_entiers_arrivent_en_chaine_et_se_reconvertissent() {
        let v = valeur(Some(Json::String("42".into())), &champ(FieldType::Int64));
        assert_eq!(v, Value::Int { value: 42 });
    }

    #[test]
    fn un_decimal_reste_du_texte_exact() {
        let v = valeur(
            Some(Json::String("12345678.91".into())),
            &champ(FieldType::Numeric),
        );
        assert_eq!(
            v,
            Value::Decimal {
                value: "12345678.91".into()
            }
        );
    }

    #[test]
    fn un_booleen_se_lit_depuis_sa_chaine() {
        assert_eq!(
            valeur(Some(Json::String("true".into())), &champ(FieldType::Bool)),
            Value::Bool { value: true }
        );
    }

    #[test]
    fn un_horodatage_epoch_devient_iso_8601() {
        let v = valeur(
            Some(Json::String("1700000000".into())),
            &champ(FieldType::Timestamp),
        );
        let Value::Timestamp { value } = v else {
            panic!("attendu un horodatage")
        };
        assert!(value.starts_with("2023-11-14"), "{value}");
    }

    #[test]
    fn une_date_n_est_pas_reinterpretee_comme_un_epoch() {
        // **La distinction du commentaire de tête** : seul TIMESTAMP est en epoch. DATE arrive déjà
        // en texte ; le convertir depuis un epoch produirait une valeur absurde.
        let v = valeur(
            Some(Json::String("2024-03-01".into())),
            &champ(FieldType::Date),
        );
        assert_eq!(
            v,
            Value::Timestamp {
                value: "2024-03-01".into()
            }
        );
    }

    #[test]
    fn une_cellule_nulle_reste_nulle() {
        assert_eq!(valeur(None, &champ(FieldType::String)), Value::Null);
        assert_eq!(
            valeur(Some(Json::Null), &champ(FieldType::String)),
            Value::Null
        );
    }

    #[test]
    fn un_champ_repete_devient_du_json_quel_que_soit_son_type_d_element() {
        let mut c = champ(FieldType::Int64);
        c.mode = Some("REPEATED".into());
        let v = valeur(Some(Json::String("[1,2,3]".into())), &c);
        assert!(matches!(v, Value::Json { .. }));
        assert_eq!(categorie(&c), TypeCategory::Json);
        assert_eq!(nom_du_type(&c), "ARRAY<INT64>");
    }

    #[test]
    fn les_categories_suivent_le_tableau_du_projet() {
        assert_eq!(categorie(&champ(FieldType::String)), TypeCategory::Text);
        assert_eq!(categorie(&champ(FieldType::Bytes)), TypeCategory::Binary);
        assert_eq!(categorie(&champ(FieldType::Int64)), TypeCategory::Number);
        assert_eq!(categorie(&champ(FieldType::Bool)), TypeCategory::Boolean);
        assert_eq!(
            categorie(&champ(FieldType::Timestamp)),
            TypeCategory::Timestamp
        );
        assert_eq!(categorie(&champ(FieldType::Struct)), TypeCategory::Json);
    }
}
