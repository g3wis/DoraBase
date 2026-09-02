//! Lire, écrire, exécuter (`16c`).
//!
//! **Les fonctions qui composent du SQL sont pures**, comme en `06d`, `11c` et `17b` : c'est ce qui
//! rend le texte prévisualisé testable sans serveur, et surtout **identique** à celui qui part.

use mysql_async::{Row, Value as MysqlValue};

use crate::engine::{
    Filter, FilterOperator, PendingUpdate, RowLimit, RowQuery, SortDirection, UpdatePlan, Value,
};

use super::introspect::citer;

/// Le `SELECT` d'une fenêtre de lignes, et ses paramètres.
///
/// **Les valeurs sont des paramètres, les identifiants sont cités au backtick.** Un nom de colonne ne
/// peut pas être paramétré en SQL ; il vient de l'introspection et passe par `citer`. Une valeur de
/// filtre vient de l'utilisateur et n'est **jamais** interpolée.
pub fn requete_de(query: &RowQuery) -> (String, Vec<String>) {
    let mut parametres = Vec::new();
    let mut sql = format!(
        "select * from {}.{}",
        citer(&query.schema),
        citer(&query.table)
    );

    let conditions: Vec<String> = query
        .filters
        .iter()
        .map(|filtre| condition_de(filtre, &mut parametres))
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

    // **La limite est toujours là** : `RowQuery` l'exige (`06a`).
    //
    // `limit N offset M` plutôt que `limit M, N` : les deux formes existent en MySQL, la première est
    // celle de PostgreSQL et de SQLite, et une seule forme dans le projet vaut mieux que trois.
    sql.push_str(&format!(
        " limit {} offset {}",
        query.limit.value(),
        query.offset
    ));
    (sql, parametres)
}

fn condition_de(filtre: &Filter, parametres: &mut Vec<String>) -> String {
    let colonne = citer(&filtre.column);
    let valeur = filtre.value.clone().unwrap_or_default();
    match filtre.operator {
        FilterOperator::Eq => {
            parametres.push(valeur);
            format!("{colonne} = ?")
        }
        FilterOperator::Ne => {
            parametres.push(valeur);
            format!("{colonne} <> ?")
        }
        FilterOperator::In => {
            let morceaux: Vec<&str> = valeur
                .split(',')
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .collect();
            if morceaux.is_empty() {
                // `in ()` est une erreur de syntaxe : rendre une condition toujours fausse est ce que
                // l'utilisateur a demandé. Même décision qu'en `17b`.
                "0 = 1".to_owned()
            } else {
                let jokers = vec!["?"; morceaux.len()].join(", ");
                for morceau in morceaux {
                    parametres.push(morceau.to_owned());
                }
                format!("{colonne} in ({jokers})")
            }
        }
        FilterOperator::Matches => {
            // **`like` avec `%` autour, et les jokers échappés.** MySQL compare sans tenir compte de
            // la casse par défaut — la collation `utf8mb4_0900_ai_ci` est celle de MySQL 8 — donc
            // chercher « paris » trouve « Paris », comme `ILIKE` en `06d`.
            //
            // Sans échappement, chercher « 100_% » trouverait n'importe quoi.
            parametres.push(format!("%{}%", echapper_pour_like(&valeur)));
            format!("{colonne} like ? escape '\\\\'")
        }
        FilterOperator::IsNull => format!("{colonne} is null"),
        // Réservées aux colonnes numériques — l'écran ne les propose que là. Aucun transtypage :
        // MySQL compare une colonne numérique à une chaîne en la convertissant lui-même en nombre
        // (« dans tous les autres cas, les arguments sont comparés comme des flottants »), à
        // l'inverse de PostgreSQL, strict sur les types.
        FilterOperator::Gt => {
            parametres.push(valeur);
            format!("{colonne} > ?")
        }
        FilterOperator::Gte => {
            parametres.push(valeur);
            format!("{colonne} >= ?")
        }
        FilterOperator::Lte => {
            parametres.push(valeur);
            format!("{colonne} <= ?")
        }
        FilterOperator::Lt => {
            parametres.push(valeur);
            format!("{colonne} < ?")
        }
    }
}

fn echapper_pour_like(valeur: &str) -> String {
    valeur
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Une valeur MySQL dans le modèle de `06a`.
///
/// # Pourquoi tout passe par le texte
///
/// Le pilote rend la plupart des colonnes en `Bytes` : le protocole textuel de MySQL transporte les
/// valeurs sous forme de chaînes, et c'est **ce qu'on veut** — un `DECIMAL(10,2)` doit garder
/// `45.00`, et le convertir en flottant perdrait la précision. C'est la leçon du défaut du 10 août
/// 2026 en PostgreSQL, où `numeric` se lisait `NULL` faute de transtypage.
///
/// La catégorie de la colonne dit **comment** interpréter ce texte, et c'est pour cela qu'elle est
/// passée : sans elle, `45.00` deviendrait un `Text` aligné à gauche.
pub fn valeur_de(brute: &MysqlValue, categorie: crate::engine::TypeCategory) -> Value {
    use crate::engine::TypeCategory as C;
    match brute {
        MysqlValue::NULL => Value::Null,
        MysqlValue::Int(n) => match categorie {
            C::Boolean => Value::Bool { value: *n != 0 },
            _ => Value::Int { value: *n },
        },
        MysqlValue::UInt(n) => Value::Int {
            value: i64::try_from(*n).unwrap_or(i64::MAX),
        },
        MysqlValue::Float(x) => Value::Float {
            value: f64::from(*x),
        },
        MysqlValue::Double(x) => Value::Float { value: *x },
        MysqlValue::Date(annee, mois, jour, heure, minute, seconde, micro) => Value::Timestamp {
            value: if *micro == 0 {
                format!("{annee:04}-{mois:02}-{jour:02} {heure:02}:{minute:02}:{seconde:02}")
            } else {
                format!(
                    "{annee:04}-{mois:02}-{jour:02} {heure:02}:{minute:02}:{seconde:02}.{micro:06}"
                )
            },
        },
        MysqlValue::Time(negatif, jours, heures, minutes, secondes, micro) => Value::Text {
            value: format!(
                "{}{:02}:{minutes:02}:{secondes:02}{}",
                if *negatif { "-" } else { "" },
                u32::from(*heures) + jours * 24,
                if *micro == 0 {
                    String::new()
                } else {
                    format!(".{micro:06}")
                }
            ),
        },
        MysqlValue::Bytes(octets) => match categorie {
            // **Le binaire reste binaire** : un `BLOB` rendu en texte donnerait des caractères de
            // remplacement là où il y a des octets.
            C::Binary => Value::Binary {
                base64: crate::engine::postgres::rows::encoder_base64(octets),
            },
            _ => {
                let texte = String::from_utf8_lossy(octets).into_owned();
                match categorie {
                    // **Un décimal reste exact, en texte.** `Value::Decimal` existe pour cela, et
                    // l'écran l'aligne à droite comme un nombre.
                    C::Number if texte.contains('.') => Value::Decimal { value: texte },
                    C::Number => match texte.parse::<i64>() {
                        Ok(value) => Value::Int { value },
                        Err(_) => Value::Decimal { value: texte },
                    },
                    C::Boolean => Value::Bool {
                        value: texte != "0" && !texte.is_empty(),
                    },
                    C::Timestamp => Value::Timestamp { value: texte },
                    C::Json => Value::Json { value: texte },
                    _ => Value::Text { value: texte },
                }
            }
        },
    }
}

/// Les instructions qu'`Appliquer` exécutera, **une par modification**.
///
/// Le `where` porte l'ancienne valeur avec `<=>`, l'égalité **sûre au nul** de MySQL — l'équivalent
/// du `is not distinct from` de `11d` et du `is` de `17b`. Sans lui, une modification partant d'une
/// cellule vide ne trouverait aucune ligne, et la transaction s'annulerait sans raison lisible.
pub fn instructions_de(plan: &UpdatePlan) -> Vec<(String, Vec<Option<String>>)> {
    let mut instructions: Vec<(String, Vec<Option<String>>)> = plan
        .changes
        .iter()
        .map(|modification| instruction_de(plan, modification))
        .collect();
    // Les insertions viennent après les modifications, dans la même transaction — l'ordre du panneau.
    instructions.extend(
        plan.inserts
            .iter()
            .map(|insertion| insertion_de(plan, insertion)),
    );
    // Les suppressions en dernier, même raison.
    instructions.extend(
        plan.deletes
            .iter()
            .map(|suppression| suppression_de(plan, suppression)),
    );
    instructions
}

/// Le `delete` d'une ligne marquée, paramétré comme les modifications.
///
/// `<=>` et non `=` : l'égalité **sûre au nul** de MySQL, comme `instruction_de` — sans ça, `NULL`
/// dans la colonne clé ne serait jamais un `NULL` égal à lui-même. Pas de valeur attendue :
/// `PendingDelete` n'en porte pas, voir `rows.rs`.
fn suppression_de(
    plan: &UpdatePlan,
    suppression: &crate::engine::PendingDelete,
) -> (String, Vec<Option<String>>) {
    (
        format!(
            "delete from {}.{} where {} <=> ?",
            citer(&plan.schema),
            citer(&plan.table),
            citer(&plan.key_column),
        ),
        vec![Some(suppression.key.clone())],
    )
}

/// L'`insert` d'une ligne saisie, paramétré comme les modifications.
///
/// **Les colonnes non saisies sont absentes**, pour que la base applique ses défauts —
/// `AUTO_INCREMENT`, `DEFAULT CURRENT_TIMESTAMP`. Aucune valeur du tout donne `() values ()`, la
/// forme MySQL d'une ligne entièrement faite de défauts.
fn insertion_de(
    plan: &UpdatePlan,
    insertion: &crate::engine::PendingInsert,
) -> (String, Vec<Option<String>>) {
    let cible = format!("{}.{}", citer(&plan.schema), citer(&plan.table));
    if insertion.values.is_empty() {
        return (format!("insert into {cible} () values ()"), Vec::new());
    }
    let noms = insertion
        .values
        .iter()
        .map(|valeur| citer(&valeur.column))
        .collect::<Vec<_>>()
        .join(", ");
    let places = vec!["?"; insertion.values.len()].join(", ");
    (
        format!("insert into {cible} ({noms}) values ({places})"),
        insertion
            .values
            .iter()
            .map(|valeur| valeur.value.clone())
            .collect(),
    )
}

fn instruction_de(
    plan: &UpdatePlan,
    modification: &PendingUpdate,
) -> (String, Vec<Option<String>>) {
    (
        format!(
            "update {}.{} set {} = ? where {} <=> ? and {} <=> ?",
            citer(&plan.schema),
            citer(&plan.table),
            citer(&modification.column),
            citer(&plan.key_column),
            citer(&modification.column)
        ),
        vec![
            modification.value.clone(),
            Some(modification.key.clone()),
            modification.expected.clone(),
        ],
    )
}

/// Le patch inverse : valeur et attendue échangées, comme `11d` et `17b` le font.
///
/// **Les insertions ni les suppressions n'y sont pas** — voir `engine::rows::avertissements`.
pub fn instructions_inverses(plan: &UpdatePlan) -> Vec<(String, Vec<Option<String>>)> {
    plan.changes
        .iter()
        .map(|modification| {
            let inverse = PendingUpdate {
                key: modification.key.clone(),
                column: modification.column.clone(),
                value: modification.expected.clone(),
                expected: modification.value.clone(),
            };
            instruction_de(plan, &inverse)
        })
        .collect()
}

/// Le texte lisible d'une suite d'instructions, encadré de sa transaction.
///
/// **Les paramètres sont inscrits en clair ici, et seulement ici** : c'est un texte à lire, pas à
/// exécuter. Les deux viennent de la même liste, donc ils ne peuvent pas décrire des écritures
/// différentes — la règle de `11d`.
pub fn texte_de(instructions: &[(String, Vec<Option<String>>)]) -> String {
    let mut lignes = vec!["START TRANSACTION;".to_owned()];
    for (sql, parametres) in instructions {
        let mut lisible = String::with_capacity(sql.len() + 32);
        let mut rang = 0;
        for morceau in sql.split('?') {
            lisible.push_str(morceau);
            if rang < parametres.len() {
                lisible.push_str(&litteral(parametres[rang].as_deref()));
                rang += 1;
            }
        }
        lignes.push(format!("{lisible};"));
    }
    lignes.push("COMMIT;".to_owned());
    lignes.join("\n")
}

/// Le patch inverse en texte : les avertissements d'insertions et de suppressions, puis les
/// `update` qui défont.
pub fn patch_inverse_de(plan: &UpdatePlan) -> String {
    let instructions = instructions_inverses(plan);
    crate::engine::rows::patch_inverse(
        crate::engine::rows::avertissements(plan.inserts.len(), plan.deletes.len()),
        (!instructions.is_empty()).then(|| texte_de(&instructions)),
    )
}

/// Un littéral MySQL.
///
/// **La contre-oblique est un caractère d'échappement en MySQL**, contrairement au SQL standard : une
/// valeur contenant `\` doit la doubler, sans quoi le texte affiché n'est plus celui qui partirait.
/// C'est le pendant du garde `standard_conforming_strings` de `11d`, ici imposé par le dialecte.
fn litteral(valeur: Option<&str>) -> String {
    match valeur {
        None => "NULL".to_owned(),
        Some(texte) => format!("'{}'", texte.replace('\\', "\\\\").replace('\'', "''")),
    }
}

/// Une ligne rendue en `INSERT` exécutable — ce que `10f` copie.
pub fn insert_de(schema: &str, table: &str, colonnes: &[String], valeurs: &[Value]) -> String {
    let noms: Vec<String> = colonnes.iter().map(|nom| citer(nom)).collect();
    let litteraux: Vec<String> = valeurs.iter().map(litteral_de_valeur).collect();
    format!(
        "INSERT INTO {}.{} ({}) VALUES ({});",
        citer(schema),
        citer(table),
        noms.join(", "),
        litteraux.join(", ")
    )
}

fn litteral_de_valeur(valeur: &Value) -> String {
    match valeur {
        Value::Null => "NULL".to_owned(),
        Value::Bool { value } => if *value { "1" } else { "0" }.to_owned(),
        Value::Int { value } => value.to_string(),
        Value::Float { value } => value.to_string(),
        Value::Decimal { value } => value.clone(),
        // `x'…'` : coller cet `INSERT` doit recréer les octets, pas leur représentation textuelle.
        Value::Binary { base64 } => format!("x'{}'", hexadecimal_de(base64)),
        Value::Text { value } | Value::Timestamp { value } | Value::Json { value } => {
            litteral(Some(value))
        }
    }
}

/// Le base64 d'un binaire, retourné en hexadécimal pour un littéral `x'…'`.
///
/// Écrit deux fois — ici et en `17b` — parce que le contrat transporte du texte (`06a`) et que ces
/// deux moteurs sont les seuls à en avoir besoin. Une fonction partagée pour vingt lignes aurait
/// demandé un module commun que rien d'autre n'habite.
fn hexadecimal_de(base64: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bits = 0u32;
    let mut compte = 0u32;
    let mut octets = Vec::new();
    for c in base64.bytes() {
        if c == b'=' {
            break;
        }
        let Some(valeur) = TABLE.iter().position(|t| *t == c) else {
            continue;
        };
        bits = (bits << 6) | valeur as u32;
        compte += 6;
        if compte >= 8 {
            compte -= 8;
            octets.push(((bits >> compte) & 0xFF) as u8);
        }
    }
    octets.iter().map(|o| format!("{o:02X}")).collect()
}

/// La limite ajoutée à une requête libre qui n'en porte pas (`12c`).
pub fn avec_limite(sql: &str, limite: RowLimit) -> (String, Option<u32>) {
    let nu = sql.trim().trim_end_matches(';').trim();
    let minuscules = nu.to_lowercase();
    // Seules les requêtes qui **rendent des lignes** reçoivent une limite. Un `update` limité ne
    // ferait pas ce que l'utilisateur a écrit.
    let rend_des_lignes = minuscules.starts_with("select")
        || minuscules.starts_with("with")
        || minuscules.starts_with("show")
        || minuscules.starts_with("describe")
        || minuscules.starts_with("explain");
    // `show` et `describe` **n'acceptent pas de `limit`** : les borner serait une erreur de syntaxe.
    let accepte_une_limite = minuscules.starts_with("select") || minuscules.starts_with("with");
    if !rend_des_lignes
        || !accepte_une_limite
        || minuscules.contains(" limit ")
        || minuscules.ends_with(" limit")
    {
        return (nu.to_owned(), None);
    }
    (
        format!("{nu} limit {}", limite.value()),
        Some(limite.value()),
    )
}

/// Les valeurs d'une ligne, dans l'ordre des colonnes déclarées.
pub fn ligne_de(ligne: &Row, categories: &[crate::engine::TypeCategory]) -> Vec<Value> {
    (0..ligne.columns_ref().len())
        .map(|index| {
            let brute = ligne.as_ref(index).cloned().unwrap_or(MysqlValue::NULL);
            valeur_de(
                &brute,
                categories
                    .get(index)
                    .copied()
                    .unwrap_or(crate::engine::TypeCategory::Other),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{SortKey, TypeCategory};

    fn requete() -> RowQuery {
        RowQuery::new("dorabase_test", "ateliers", RowLimit::FiveHundred)
    }

    #[test]
    fn une_lecture_simple_cite_au_backtick_et_porte_sa_limite() {
        let (sql, parametres) = requete_de(&requete());
        assert_eq!(
            sql,
            "select * from `dorabase_test`.`ateliers` limit 500 offset 0"
        );
        assert!(parametres.is_empty());
    }

    #[test]
    fn un_mot_reserve_comme_colonne_ne_casse_pas_le_tri() {
        // `order` est un mot réservé : sans citation au backtick, la requête échoue. Le décor de test
        // porte une telle colonne exprès.
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "order".into(),
            direction: SortDirection::Descending,
        }];
        let (sql, _) = requete_de(&r);
        assert!(sql.contains("order by `order` desc"), "{sql}");
    }

    #[test]
    fn les_valeurs_de_filtre_sont_des_parametres_jamais_du_texte_interpole() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "nom".into(),
            operator: FilterOperator::Eq,
            value: Some("'; drop table ateliers; --".into()),
        }];
        let (sql, parametres) = requete_de(&r);
        assert!(!sql.contains("drop table"), "{sql}");
        assert!(sql.contains("= ?"), "{sql}");
        assert_eq!(parametres, vec!["'; drop table ateliers; --".to_owned()]);
    }

    #[test]
    fn un_motif_like_est_echappe() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "nom".into(),
            operator: FilterOperator::Matches,
            value: Some("100_%".into()),
        }];
        let (_, parametres) = requete_de(&r);
        assert_eq!(parametres, vec!["%100\\_\\%%".to_owned()]);
    }

    #[test]
    fn une_liste_vide_ne_correspond_a_rien_plutot_que_de_casser_la_syntaxe() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "nom".into(),
            operator: FilterOperator::In,
            value: Some("  ,  ".into()),
        }];
        let (sql, parametres) = requete_de(&r);
        assert!(sql.contains("0 = 1"), "{sql}");
        assert!(parametres.is_empty());
    }

    #[test]
    fn les_quatre_comparaisons_produisent_un_parametre_jamais_du_texte_interpole() {
        for (operateur, signe) in [
            (FilterOperator::Gt, ">"),
            (FilterOperator::Gte, ">="),
            (FilterOperator::Lte, "<="),
            (FilterOperator::Lt, "<"),
        ] {
            let mut r = requete();
            r.filters = vec![Filter {
                column: "capacite".into(),
                operator: operateur,
                value: Some("10".into()),
            }];
            let (sql, parametres) = requete_de(&r);
            assert!(sql.contains(&format!("`capacite` {signe} ?")), "{sql}");
            assert_eq!(parametres, vec!["10".to_owned()]);
        }
    }

    #[test]
    fn le_where_d_une_modification_emploie_l_egalite_sure_au_nul() {
        let plan = plan_avec(None);
        let (sql, parametres) = &instructions_de(&plan)[0];
        // **`<=>` et non `=`** : c'est l'égalité sûre au nul de MySQL. Avec `=`, une modification
        // partant d'une cellule vide ne trouverait aucune ligne et la transaction s'annulerait sans
        // raison lisible — le piège de `11d`, de `18f` et de `17b`, ici pour la quatrième fois.
        assert!(sql.contains("<=> ?"), "{sql}");
        assert_eq!(parametres[2], None);
    }

    #[test]
    fn le_texte_previsualise_porte_les_valeurs_de_l_execution() {
        let plan = plan_avec(Some("Toulouse"));
        let texte = texte_de(&instructions_de(&plan));
        assert!(texte.starts_with("START TRANSACTION;"), "{texte}");
        assert!(texte.contains("'Albi'"), "{texte}");
        assert!(texte.contains("'Toulouse'"), "{texte}");
        assert!(texte.trim_end().ends_with("COMMIT;"), "{texte}");
        // Aucun `?` ne doit subsister : un texte à trous n'est pas lisible, et il ne dirait pas ce
        // qui part.
        assert!(!texte.contains('?'), "{texte}");
    }

    #[test]
    fn une_contre_oblique_est_doublee_dans_le_texte_lisible() {
        // **MySQL traite `\` comme un échappement**, contrairement au SQL standard : sans le doubler,
        // le texte affiché ne serait plus celui qui partirait. C'est le pendant du garde
        // `standard_conforming_strings` de `11d`, ici imposé par le dialecte.
        assert_eq!(litteral(Some(r"c:\temp")), r"'c:\\temp'");
        assert_eq!(litteral(Some("l'atelier")), "'l''atelier'");
        assert_eq!(litteral(None), "NULL");
    }

    #[test]
    fn le_patch_inverse_echange_la_valeur_et_l_attendue() {
        let plan = plan_avec(Some("Toulouse"));
        let (_, parametres) = &instructions_inverses(&plan)[0];
        assert_eq!(parametres[0], Some("Toulouse".to_owned()));
        assert_eq!(parametres[2], Some("Albi".to_owned()));
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
    fn show_et_describe_ne_recoivent_pas_de_limite() {
        // **`show` n'accepte pas de `limit`** : la borner serait une erreur de syntaxe, pas une
        // protection. C'est le cas que PostgreSQL n'a pas.
        assert_eq!(
            avec_limite("show tables", RowLimit::OneThousand),
            ("show tables".to_owned(), None)
        );
        assert_eq!(
            avec_limite("describe ateliers", RowLimit::OneThousand),
            ("describe ateliers".to_owned(), None)
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
    fn un_decimal_reste_exact_en_texte() {
        // **Le convertir en flottant perdrait la précision**, et c'est inacceptable pour de l'argent —
        // la leçon du défaut du 10 août 2026.
        let brute = MysqlValue::Bytes(b"45.00".to_vec());
        assert_eq!(
            valeur_de(&brute, TypeCategory::Number),
            Value::Decimal {
                value: "45.00".to_owned()
            }
        );
    }

    #[test]
    fn un_entier_rendu_en_texte_redevient_un_entier() {
        let brute = MysqlValue::Bytes(b"12900".to_vec());
        assert_eq!(
            valeur_de(&brute, TypeCategory::Number),
            Value::Int { value: 12900 }
        );
    }

    #[test]
    fn un_tinyint_1_devient_un_booleen_pas_un_zero() {
        // La catégorie décide : sans elle, `0` s'afficherait comme un nombre là où l'on attend une
        // valeur logique.
        assert_eq!(
            valeur_de(&MysqlValue::Int(0), TypeCategory::Boolean),
            Value::Bool { value: false }
        );
        assert_eq!(
            valeur_de(&MysqlValue::Int(1), TypeCategory::Boolean),
            Value::Bool { value: true }
        );
    }

    #[test]
    fn un_blob_reste_binaire_plutot_que_de_devenir_du_texte_abime() {
        // Rendu en texte, un `BLOB` donnerait des caractères de remplacement là où il y a des octets.
        let brute = MysqlValue::Bytes(vec![1, 2, 3, 0xFF]);
        assert!(matches!(
            valeur_de(&brute, TypeCategory::Binary),
            Value::Binary { .. }
        ));
    }

    #[test]
    fn une_date_est_rendue_dans_une_forme_stable() {
        let brute = MysqlValue::Date(2026, 3, 4, 9, 12, 0, 0);
        assert_eq!(
            valeur_de(&brute, TypeCategory::Timestamp),
            Value::Timestamp {
                value: "2026-03-04 09:12:00".to_owned()
            }
        );
    }

    #[test]
    fn un_insert_cite_ses_identifiants_et_rend_les_octets_en_hexadecimal() {
        let sql = insert_de(
            "atelier",
            "order",
            &["empreinte".to_owned()],
            &[Value::Binary {
                base64: "AQIDBAUGBwg=".to_owned(),
            }],
        );
        assert!(sql.contains("INTO `atelier`.`order`"), "{sql}");
        assert!(sql.contains("x'0102030405060708'"), "{sql}");
    }

    fn plan_avec(attendue: Option<&str>) -> UpdatePlan {
        UpdatePlan {
            schema: "dorabase_test".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes: vec![PendingUpdate {
                key: "1".into(),
                column: "ville".into(),
                value: Some("Albi".into()),
                expected: attendue.map(str::to_owned),
            }],
        }
    }

    fn plan_qui_ajoute(valeurs: &[(&str, Option<&str>)]) -> UpdatePlan {
        UpdatePlan {
            schema: "dorabase_test".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            changes: Vec::new(),
            inserts: vec![crate::engine::PendingInsert {
                values: valeurs
                    .iter()
                    .map(|(column, value)| crate::engine::PendingInsertValue {
                        column: (*column).to_owned(),
                        value: value.map(str::to_owned),
                    })
                    .collect(),
            }],
            deletes: Vec::new(),
        }
    }

    #[test]
    fn une_ligne_ajoutee_est_un_insert_parametre() {
        let plan = plan_qui_ajoute(&[("ville", Some("Albi")), ("pays", None)]);
        let instructions = instructions_de(&plan);
        assert_eq!(instructions.len(), 1);
        let (sql, parametres) = &instructions[0];
        assert_eq!(
            sql,
            "insert into `dorabase_test`.`ateliers` (`ville`, `pays`) values (?, ?)"
        );
        // **Les valeurs restent des paramètres**, comme celles d'une modification : c'est le pilote
        // qui les transporte, pas le texte.
        assert_eq!(parametres, &vec![Some("Albi".to_owned()), None::<String>]);
    }

    #[test]
    fn une_ligne_sans_valeur_prend_les_defauts() {
        let (sql, parametres) = instructions_de(&plan_qui_ajoute(&[]))[0].clone();
        // La forme MySQL d'une ligne entièrement faite de défauts — `AUTO_INCREMENT` compris.
        assert_eq!(sql, "insert into `dorabase_test`.`ateliers` () values ()");
        assert!(parametres.is_empty());
    }

    #[test]
    fn le_texte_lisible_d_une_insertion_porte_ses_valeurs() {
        let texte = texte_de(&instructions_de(&plan_qui_ajoute(&[
            ("ville", Some("Albi")),
            ("pays", None),
        ])));
        // Le texte montré est celui qui part, valeurs comprises : c'est la promesse du dernier
        // écran avant écriture.
        assert!(texte.contains("values ('Albi', NULL)"), "{texte}");
    }

    #[test]
    fn le_patch_inverse_annonce_les_insertions_qu_il_ne_defait_pas() {
        let patch = patch_inverse_de(&plan_qui_ajoute(&[("ville", Some("Albi"))]));
        assert!(patch.starts_with("-- 1 ligne ajoutée"));
        // Pas de transaction vide : il n'y a aucune modification à défaire.
        assert!(!patch.contains("START TRANSACTION"));
    }

    fn plan_qui_supprime(cles: &[&str]) -> UpdatePlan {
        UpdatePlan {
            schema: "dorabase_test".into(),
            table: "ateliers".into(),
            key_column: "id".into(),
            changes: Vec::new(),
            inserts: Vec::new(),
            deletes: cles
                .iter()
                .map(|cle| crate::engine::PendingDelete {
                    key: (*cle).to_owned(),
                })
                .collect(),
        }
    }

    #[test]
    fn une_ligne_marquee_est_un_delete_parametre() {
        let instructions = instructions_de(&plan_qui_supprime(&["1"]));
        assert_eq!(instructions.len(), 1);
        let (sql, parametres) = &instructions[0];
        // `<=>` : l'égalité sûre au nul de MySQL, même raison que pour une modification.
        assert_eq!(
            sql,
            "delete from `dorabase_test`.`ateliers` where `id` <=> ?"
        );
        assert_eq!(parametres, &vec![Some("1".to_owned())]);
    }

    #[test]
    fn les_suppressions_viennent_apres_les_insertions() {
        let mut p = plan_qui_ajoute(&[("ville", Some("Albi"))]);
        p.deletes = plan_qui_supprime(&["2"]).deletes;
        let instructions = instructions_de(&p);
        assert!(instructions[0].0.starts_with("insert"));
        assert!(instructions[1].0.starts_with("delete"));
    }

    #[test]
    fn le_patch_inverse_annonce_les_suppressions_sans_les_defaire() {
        let patch = patch_inverse_de(&plan_qui_supprime(&["1"]));
        assert!(patch.starts_with("-- 1 ligne supprimée"));
        assert!(!patch.contains("delete"));
        assert!(!patch.contains("START TRANSACTION"));
    }
}
