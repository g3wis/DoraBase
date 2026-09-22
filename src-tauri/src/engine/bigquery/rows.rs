//! Composer le SQL BigQuery — lecture et texte lisible (`21`).
//!
//! **Les fonctions qui composent du SQL sont pures**, comme en `06d`, `11c` et `17b` : c'est ce qui
//! rend le texte prévisualisé identique à celui qui part, et ce qui permet de les tester sans
//! connexion — le seul étage de ce moteur qu'aucun décor de test réel ne peut atteindre (`21`, voir
//! `raison_du_refus` côté `engine::mod`).
//!
//! **Les identifiants de table sont un seul jeton entre backticks**, `` `projet.jeu.table` `` : un
//! identifiant de projet GCP porte souvent des tirets, invalides dans un identifiant nu ou cité par
//! morceaux. Les noms de colonnes, eux, sont cités séparément.
//!
//! **Les valeurs de filtre restent des paramètres nommés** (`@p1`, `@p2`…), jamais interpolées —
//! même règle qu'ailleurs (`06d`). La colonne est comparée après conversion en `STRING` : `RowQuery`
//! ne porte pas le type de la colonne, et le reconvertir demanderait un aller-retour d'introspection
//! qu'aucun autre moteur ne fait pour filtrer.

use gcp_bigquery_client::model::query_parameter::QueryParameter;
use gcp_bigquery_client::model::query_parameter_type::QueryParameterType;
use gcp_bigquery_client::model::query_parameter_value::QueryParameterValue;

use crate::engine::{
    ColumnInfo, Filter, FilterOperator, RowLimit, RowQuery, SortDirection, TypeCategory, Value,
};

/// Cite un identifiant simple — une colonne. Le guillemet du dialecte BigQuery est le backtick,
/// doublé s'il apparaît dans le nom.
pub fn citer(identifiant: &str) -> String {
    format!("`{}`", identifiant.replace('`', "``"))
}

/// Cite la référence complète `projet.jeu.table`, en un seul jeton — voir le commentaire de tête.
pub fn citer_table(projet: &str, jeu: &str, table: &str) -> String {
    format!("`{projet}.{jeu}.{table}`")
}

fn parametre_texte(rang: usize, valeur: &str) -> QueryParameter {
    QueryParameter {
        name: Some(format!("p{rang}")),
        parameter_type: Some(QueryParameterType {
            array_type: None,
            struct_types: None,
            r#type: "STRING".to_owned(),
        }),
        parameter_value: Some(QueryParameterValue {
            array_values: None,
            struct_values: None,
            value: Some(valeur.to_owned()),
        }),
    }
}

/// Le `select` d'une fenêtre de lignes, paramétré.
/// **Les colonnes sont exigées**, et non lues au besoin : trois opérateurs — `is true`, `is false`
/// et les comparaisons — ont un SQL qui dépend du type déclaré, BigQuery étant aussi strict que
/// PostgreSQL. `rows()` les tient déjà : la réponse de `table.get`, qu'il demande de toute façon
/// pour le compte de lignes, porte le schéma. Aucun aller-retour de plus.
pub fn requete_de(
    projet: &str,
    jeu: &str,
    query: &RowQuery,
    colonnes: &[ColumnInfo],
) -> (String, Vec<QueryParameter>) {
    let mut parametres = Vec::new();
    let mut sql = format!("select * from {}", citer_table(projet, jeu, &query.table));

    let conditions: Vec<String> = query
        .filters
        .iter()
        .map(|filtre| condition_de(filtre, colonnes, &mut parametres))
        .collect();
    if !conditions.is_empty() {
        sql.push_str(" where ");
        sql.push_str(&conditions.join(" and "));
    }

    if !query.sort.is_empty() {
        let cles: Vec<String> = query
            .sort
            .iter()
            .map(|cle| {
                format!(
                    "{} {}",
                    citer(&cle.column),
                    match cle.direction {
                        SortDirection::Ascending => "asc",
                        SortDirection::Descending => "desc",
                    }
                )
            })
            .collect();
        sql.push_str(" order by ");
        sql.push_str(&cles.join(", "));
    }

    // La limite est toujours là : `RowQuery` l'exige (`06a`).
    sql.push_str(&format!(
        " limit {} offset {}",
        query.limit.value(),
        query.offset
    ));
    (sql, parametres)
}

fn colonne_en_texte(nom: &str) -> String {
    format!("cast({} as string)", citer(nom))
}

/// Cite la colonne, transtypée en `bignumeric` — pour les quatre comparaisons, réservées aux
/// colonnes numériques.
///
/// **Pas `colonne_en_texte`** : BigQuery est aussi strict que PostgreSQL sur les types, et
/// comparer deux `string` avec `>` trierait lexicographiquement (`"9" > "10"`), ce que le signe
/// affiché contredirait. `bignumeric` plutôt que `float64` pour garder la précision exacte d'un
/// entier — la même raison que le `numeric` de PostgreSQL.
fn colonne_en_numerique(nom: &str) -> String {
    format!("cast({} as bignumeric)", citer(nom))
}

/// Un paramètre `BIGNUMERIC`, pour les quatre comparaisons.
///
/// La valeur reste transmise en texte : c'est ainsi que l'API REST de BigQuery représente tout
/// paramètre, quel que soit son type déclaré — seul `r#type` change entre `parametre_texte` et
/// celui-ci.
fn parametre_numerique(rang: usize, valeur: &str) -> QueryParameter {
    QueryParameter {
        name: Some(format!("p{rang}")),
        parameter_type: Some(QueryParameterType {
            array_type: None,
            struct_types: None,
            r#type: "BIGNUMERIC".to_owned(),
        }),
        parameter_value: Some(QueryParameterValue {
            array_values: None,
            struct_values: None,
            value: Some(valeur.to_owned()),
        }),
    }
}

fn condition_de(
    filtre: &Filter,
    colonnes: &[ColumnInfo],
    parametres: &mut Vec<QueryParameter>,
) -> String {
    let colonne = colonne_en_texte(&filtre.column);
    match filtre.operator {
        FilterOperator::Eq => {
            let param = parametre_texte(
                parametres.len() + 1,
                &filtre.value.clone().unwrap_or_default(),
            );
            let nom = param.name.clone().unwrap();
            parametres.push(param);
            format!("{colonne} = @{nom}")
        }
        FilterOperator::Ne => {
            let param = parametre_texte(
                parametres.len() + 1,
                &filtre.value.clone().unwrap_or_default(),
            );
            let nom = param.name.clone().unwrap();
            parametres.push(param);
            format!("{colonne} <> @{nom}")
        }
        FilterOperator::In => {
            let valeur = filtre.value.clone().unwrap_or_default();
            let morceaux: Vec<String> = valeur
                .split(',')
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(|m| {
                    let param = parametre_texte(parametres.len() + 1, m);
                    let nom = format!("@{}", param.name.clone().unwrap());
                    parametres.push(param);
                    nom
                })
                .collect();
            if morceaux.is_empty() {
                // Une liste vide ne correspond à rien : `in ()` est une erreur de syntaxe.
                "0 = 1".to_owned()
            } else {
                format!("{colonne} in ({})", morceaux.join(", "))
            }
        }
        FilterOperator::Matches => {
            let motif = format!(
                "%{}%",
                echapper_pour_like(&filtre.value.clone().unwrap_or_default())
            );
            let param = parametre_texte(parametres.len() + 1, &motif);
            let nom = param.name.clone().unwrap();
            parametres.push(param);
            // Insensible à la casse, comme `06d` avec `ILIKE` : chercher « paris » doit trouver
            // « Paris ». BigQuery n'a pas d'opérateur `ilike` : `lower()` des deux côtés.
            format!("lower({colonne}) like lower(@{nom}) escape '\\\\'")
        }
        FilterOperator::IsNull => format!("{} is null", citer(&filtre.column)),
        FilterOperator::IsNotNull => format!("{} is not null", citer(&filtre.column)),
        // `is true` / `is false` : BigQuery a un vrai type `BOOL`, donc le prédicat est direct et
        // ne transtype rien. Le refus d'une colonne non booléenne est celui de `condition_de` chez
        // PostgreSQL ; ici il n'y a rien à refuser, `cast(x as string) is true` étant une erreur de
        // type que BigQuery rend lui-même.
        FilterOperator::IsTrue => format!("{} is true", citer(&filtre.column)),
        FilterOperator::IsFalse => format!("{} is false", citer(&filtre.column)),
        FilterOperator::Gt | FilterOperator::Gte | FilterOperator::Lte | FilterOperator::Lt => {
            let comparaison = match filtre.operator {
                FilterOperator::Gt => ">",
                FilterOperator::Gte => ">=",
                FilterOperator::Lte => "<=",
                _ => "<",
            };
            let saisie = filtre.value.clone().unwrap_or_default();
            // **C'est la borne qu'on transtype pour une date, et la colonne pour un nombre.**
            // BigQuery n'accepte aucune coercition entre `DATE`, `DATETIME` et `TIMESTAMP` : un
            // `cast(@p as timestamp)` contre une colonne `DATE` échouerait sur la comparaison. Le
            // type **déclaré** de la colonne est donc le seul transtypage juste, et
            // `ColumnInfo::type_name` le porte déjà en vocabulaire BigQuery (`nom_du_type`).
            match colonne_temporelle(&filtre.column, colonnes) {
                Some(type_bq) => {
                    let param = parametre_texte(parametres.len() + 1, &saisie);
                    let nom = param.name.clone().unwrap();
                    parametres.push(param);
                    format!(
                        "{} {comparaison} cast(@{nom} as {type_bq})",
                        citer(&filtre.column)
                    )
                }
                None => {
                    let param = parametre_numerique(parametres.len() + 1, &saisie);
                    let nom = param.name.clone().unwrap();
                    parametres.push(param);
                    format!(
                        "{} {comparaison} @{nom}",
                        colonne_en_numerique(&filtre.column)
                    )
                }
            }
        }
    }
}

/// Le type BigQuery de la colonne quand elle est temporelle, `None` sinon — le discriminant des
/// deux transtypages de comparaison.
fn colonne_temporelle(nom: &str, colonnes: &[ColumnInfo]) -> Option<String> {
    colonnes
        .iter()
        .find(|c| c.name == nom)
        .filter(|c| c.category == TypeCategory::Timestamp)
        .map(|c| c.type_name.clone())
}

fn echapper_pour_like(valeur: &str) -> String {
    valeur
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// La limite ajoutée à une requête libre qui n'en porte pas (`12c`) — même règle que les autres
/// moteurs : `select * from grande` ne doit pas faire traverser l'IPC à des millions de lignes.
pub fn avec_limite(sql: &str, limite: RowLimit) -> (String, Option<u32>) {
    let nu = sql.trim().trim_end_matches(';').trim();
    let minuscules = nu.to_lowercase();
    let rend_des_lignes = minuscules.starts_with("select") || minuscules.starts_with("with");
    if !rend_des_lignes || minuscules.contains(" limit ") || minuscules.ends_with(" limit") {
        return (nu.to_owned(), None);
    }
    (
        format!("{nu} limit {}", limite.value()),
        Some(limite.value()),
    )
}

/// Une ligne rendue en `INSERT` exécutable — ce que `10f` copie.
pub fn insert_de(
    projet: &str,
    jeu: &str,
    table: &str,
    colonnes: &[String],
    valeurs: &[Value],
) -> String {
    let noms: Vec<String> = colonnes.iter().map(|nom| citer(nom)).collect();
    let litteraux: Vec<String> = valeurs.iter().map(litteral_de).collect();
    format!(
        "INSERT INTO {} ({}) VALUES ({});",
        citer_table(projet, jeu, table),
        noms.join(", "),
        litteraux.join(", ")
    )
}

fn litteral_de(valeur: &Value) -> String {
    match valeur {
        Value::Null => "NULL".to_owned(),
        // Le dialecte SQL standard de BigQuery, pas `1`/`0` : `TRUE`/`FALSE` sont ses mots-clés.
        Value::Bool { value } => if *value { "TRUE" } else { "FALSE" }.to_owned(),
        Value::Int { value } => value.to_string(),
        Value::Float { value } => value.to_string(),
        Value::Decimal { value } => format!("NUMERIC '{}'", echapper_chaine(value)),
        // **`FROM_BASE64(...)` et non un littéral hexadécimal** : BigQuery n'a pas de syntaxe
        // `x'…'`, et la valeur est déjà en base64 (`06a`) — l'y reconvertir en hexadécimal comme le
        // fait SQLite serait un aller-retour sans raison ici.
        Value::Binary { base64 } => format!("FROM_BASE64('{}')", echapper_chaine(base64)),
        Value::Text { value } | Value::Timestamp { value } | Value::Json { value } => {
            format!("'{}'", echapper_chaine(value))
        }
    }
}

/// **`\'`, pas `''`.** Le SQL standard double l'apostrophe pour l'échapper ; BigQuery, comme la
/// plupart des dialectes issus de C, emploie le backslash — doubler l'apostrophe y laisserait une
/// chaîne mal fermée. Le backslash lui-même est échappé en premier, sans quoi une valeur qui en
/// contient déjà un casserait l'échappement de l'apostrophe suivante.
fn echapper_chaine(valeur: &str) -> String {
    valeur.replace('\\', "\\\\").replace('\'', "\\'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::SortKey;

    fn requete() -> RowQuery {
        RowQuery::new("jeu", "commandes", RowLimit::FiveHundred)
    }

    /// Le décor de colonnes des tests, **avec `DATE` et `TIMESTAMP` distincts** : un décor où les
    /// deux porteraient le même type ne dirait pas si le transtypage suit la colonne ou une valeur
    /// choisie une fois pour toutes (règle n° 5).
    fn colonnes() -> Vec<ColumnInfo> {
        [
            ("montant", "NUMERIC", TypeCategory::Number),
            ("statut", "STRING", TypeCategory::Text),
            ("reference", "STRING", TypeCategory::Text),
            ("cree_le", "TIMESTAMP", TypeCategory::Timestamp),
            ("jour", "DATE", TypeCategory::Timestamp),
            ("actif", "BOOL", TypeCategory::Boolean),
        ]
        .into_iter()
        .enumerate()
        .map(|(rang, (nom, type_bq, categorie))| ColumnInfo {
            position: rang as u32 + 1,
            name: nom.to_owned(),
            type_name: type_bq.to_owned(),
            category: categorie,
            nullable: true,
            default: None,
            identity: None,
            key: None,
            comment: None,
            frequency: None,
        })
        .collect()
    }

    #[test]
    fn une_lecture_simple_cite_la_table_en_un_seul_jeton() {
        let (sql, parametres) = requete_de("mon-projet", "jeu", &requete(), &colonnes());
        assert_eq!(
            sql,
            "select * from `mon-projet.jeu.commandes` limit 500 offset 0"
        );
        assert!(parametres.is_empty());
    }

    #[test]
    fn les_valeurs_de_filtre_sont_des_parametres_jamais_du_texte_interpole() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::Eq,
            value: Some("'; drop table commandes; --".into()),
        }];
        let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
        assert!(!sql.contains("drop table"), "{sql}");
        assert!(sql.contains("= @p1"), "{sql}");
        assert_eq!(
            parametres[0]
                .parameter_value
                .as_ref()
                .unwrap()
                .value
                .as_deref(),
            Some("'; drop table commandes; --")
        );
    }

    #[test]
    fn un_motif_matches_est_echappe_et_insensible_a_la_casse() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "reference".into(),
            operator: FilterOperator::Matches,
            value: Some("100_%".into()),
        }];
        let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
        assert!(sql.contains("lower("), "{sql}");
        assert_eq!(
            parametres[0]
                .parameter_value
                .as_ref()
                .unwrap()
                .value
                .as_deref(),
            Some("%100\\_\\%%")
        );
    }

    #[test]
    fn une_liste_vide_ne_correspond_a_rien() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::In,
            value: Some("  ,  ".into()),
        }];
        let (sql, _) = requete_de("p", "jeu", &r, &colonnes());
        assert!(sql.contains("0 = 1"), "{sql}");
    }

    #[test]
    fn les_quatre_comparaisons_transtypent_en_bignumeric_plutot_qu_en_string() {
        // **Pas `colonne_en_texte`** : deux `string` comparés par `>` trieraient
        // lexicographiquement (`"9" > "10"`), ce que le signe affiché contredirait.
        for (operateur, signe) in [
            (FilterOperator::Gt, ">"),
            (FilterOperator::Gte, ">="),
            (FilterOperator::Lte, "<="),
            (FilterOperator::Lt, "<"),
        ] {
            let mut r = requete();
            r.filters = vec![Filter {
                column: "montant".into(),
                operator: operateur,
                value: Some("10".into()),
            }];
            let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
            assert!(
                sql.contains(&format!("cast(`montant` as bignumeric) {signe} @p1")),
                "{sql}"
            );
            assert_eq!(
                parametres[0].parameter_type.as_ref().unwrap().r#type,
                "BIGNUMERIC"
            );
        }
    }

    #[test]
    fn les_deux_predicats_de_nullite_sont_sans_parametre() {
        for (operateur, attendu) in [
            (FilterOperator::IsNull, "is null"),
            (FilterOperator::IsNotNull, "is not null"),
        ] {
            let mut r = requete();
            r.filters = vec![Filter {
                column: "actif".into(),
                operator: operateur,
                value: None,
            }];
            let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
            assert!(sql.contains(attendu), "{sql}");
            // Aucun paramètre nommé : un `@p1` déclaré sans valeur ferait refuser la requête par
            // l'API avant même de joindre la table.
            assert!(parametres.is_empty());
        }
    }

    #[test]
    fn is_true_et_is_false_sont_des_predicats_sans_parametre() {
        for (operateur, attendu) in [
            (FilterOperator::IsTrue, "`actif` is true"),
            (FilterOperator::IsFalse, "`actif` is false"),
        ] {
            let mut r = requete();
            r.filters = vec![Filter {
                column: "actif".into(),
                operator: operateur,
                value: None,
            }];
            let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
            assert!(sql.contains(attendu), "{sql}");
            // Pas de `cast(… as string)` : BigQuery a un vrai type `BOOL`.
            assert!(!sql.contains("cast(`actif`"), "{sql}");
            assert!(parametres.is_empty());
        }
    }

    #[test]
    fn une_borne_de_date_est_transtypee_vers_le_type_declare_de_la_colonne() {
        // **Le type suit la colonne, pas un choix fait ici.** BigQuery n'accepte aucune coercition
        // entre `DATE`, `DATETIME` et `TIMESTAMP` : un `cast(@p as timestamp)` contre une colonne
        // `DATE` échouerait sur la comparaison. Le décor porte les deux types exprès.
        for (colonne, type_bq) in [("cree_le", "TIMESTAMP"), ("jour", "DATE")] {
            let mut r = requete();
            r.filters = vec![Filter {
                column: colonne.into(),
                operator: FilterOperator::Lt,
                value: Some("2026-03-01".into()),
            }];
            let (sql, parametres) = requete_de("p", "jeu", &r, &colonnes());
            assert!(
                sql.contains(&format!("`{colonne}` < cast(@p1 as {type_bq})")),
                "{sql}"
            );
            // La borne part en `STRING`, transtypée par le SQL : c'est ce que l'API REST sait
            // transmettre, `bignumeric` étant faux pour une date.
            assert_eq!(
                parametres[0].parameter_type.as_ref().unwrap().r#type,
                "STRING"
            );
        }
    }

    #[test]
    fn le_tri_cite_ses_colonnes() {
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "cree le".into(),
            direction: SortDirection::Descending,
        }];
        let (sql, _) = requete_de("p", "jeu", &r, &colonnes());
        assert!(sql.contains("order by `cree le` desc"), "{sql}");
    }

    #[test]
    fn une_limite_est_ajoutee_aux_lectures_seulement() {
        assert_eq!(
            avec_limite("select * from t", RowLimit::OneThousand),
            ("select * from t limit 1000".to_owned(), Some(1000))
        );
        assert_eq!(
            avec_limite("delete from t where a = 1", RowLimit::OneThousand),
            ("delete from t where a = 1".to_owned(), None)
        );
    }

    #[test]
    fn une_limite_deja_ecrite_est_respectee() {
        assert_eq!(
            avec_limite("select * from t limit 10", RowLimit::OneThousand),
            ("select * from t limit 10".to_owned(), None)
        );
    }

    #[test]
    fn un_insert_rend_les_octets_en_from_base64() {
        let sql = insert_de(
            "p",
            "jeu",
            "commandes",
            &["empreinte".to_owned()],
            &[Value::Binary {
                base64: "AQIDBAUGBwg=".to_owned(),
            }],
        );
        assert!(sql.contains("FROM_BASE64('AQIDBAUGBwg=')"), "{sql}");
    }

    #[test]
    fn un_insert_echappe_l_apostrophe_au_backslash_pas_en_la_doublant() {
        let sql = insert_de(
            "p",
            "jeu",
            "t",
            &["nom".to_owned()],
            &[Value::Text {
                value: "l'atelier".to_owned(),
            }],
        );
        assert!(sql.contains("'l\\'atelier'"), "{sql}");
        assert!(!sql.contains("l''atelier"), "{sql}");
    }

    #[test]
    fn un_decimal_recoit_le_prefixe_numeric() {
        let sql = insert_de(
            "p",
            "jeu",
            "t",
            &["montant".to_owned()],
            &[Value::Decimal {
                value: "12345678.91".to_owned(),
            }],
        );
        assert!(sql.contains("NUMERIC '12345678.91'"), "{sql}");
    }
}
