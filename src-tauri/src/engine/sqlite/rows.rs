//! Lire des lignes, écrire, exécuter (`17b`).
//!
//! **Les fonctions qui composent du SQL sont pures**, comme en `06d` et `11c` : c'est ce qui rend le
//! texte prévisualisé testable sans fichier, et surtout **identique** à celui qui part.

use rusqlite::types::ValueRef;
use rusqlite::Connection;

use crate::engine::{
    EngineError, Filter, FilterOperator, PendingUpdate, RowLimit, RowQuery, SortDirection,
    UpdatePlan, Value,
};

use super::error::traduire;
use super::introspect::citer;

/// Le `SELECT` d'une fenêtre de lignes.
///
/// **Les valeurs sont des paramètres, les identifiants sont cités.** Un nom de colonne ne peut pas
/// être paramétré en SQL ; il vient de l'introspection et est cité par `citer`. Une valeur de filtre
/// vient de l'utilisateur et n'est **jamais** interpolée.
pub fn requete_de(query: &RowQuery) -> (String, Vec<String>) {
    let mut parametres = Vec::new();
    let mut sql = format!("select * from {}", citer(&query.table));

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

    // **La limite est toujours là** : `RowQuery` l'exige (`06a`), et aucune signature ne permet de
    // demander un jeu complet.
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
            format!("{colonne} = ?{}", parametres.len())
        }
        FilterOperator::Ne => {
            parametres.push(valeur);
            format!("{colonne} <> ?{}", parametres.len())
        }
        FilterOperator::In => {
            let morceaux: Vec<String> = valeur
                .split(',')
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(|m| {
                    parametres.push(m.to_owned());
                    format!("?{}", parametres.len())
                })
                .collect();
            if morceaux.is_empty() {
                // Une liste vide ne correspond à rien : `in ()` est une erreur de syntaxe en SQLite,
                // et rendre une condition toujours fausse est ce que l'utilisateur a demandé.
                "0 = 1".to_owned()
            } else {
                format!("{colonne} in ({})", morceaux.join(", "))
            }
        }
        FilterOperator::Matches => {
            // **`like` et non `glob`**, et le motif est encadré de `%` : on cherche une sous-chaîne,
            // comme `06d` le fait avec `ILIKE`. `like` est insensible à la casse pour l'ASCII en
            // SQLite, ce qui est le comportement attendu — chercher « paris » et ne pas trouver
            // « Paris » se lirait comme une absence de données.
            //
            // Les caractères de la syntaxe de `like` — `%` et `_` — sont **échappés** : sans cela,
            // chercher « 100_% » trouverait n'importe quoi.
            parametres.push(format!("%{}%", echapper_pour_like(&valeur)));
            format!("{colonne} like ?{} escape '\\'", parametres.len())
        }
        FilterOperator::IsNull => format!("{colonne} is null"),
        // Réservées aux colonnes numériques — l'écran ne les propose que là. Aucun transtypage :
        // l'affinité de type de SQLite convertit d'elle-même un paramètre texte en numérique
        // dès que la colonne comparée a une affinité INTEGER, REAL ou NUMERIC.
        FilterOperator::Gt => {
            parametres.push(valeur);
            format!("{colonne} > ?{}", parametres.len())
        }
        FilterOperator::Gte => {
            parametres.push(valeur);
            format!("{colonne} >= ?{}", parametres.len())
        }
        FilterOperator::Lte => {
            parametres.push(valeur);
            format!("{colonne} <= ?{}", parametres.len())
        }
        FilterOperator::Lt => {
            parametres.push(valeur);
            format!("{colonne} < ?{}", parametres.len())
        }
    }
}

fn echapper_pour_like(valeur: &str) -> String {
    valeur
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Une valeur SQLite dans le modèle de `06a`.
///
/// **La nature réelle, pas la déclaration.** Une colonne `INTEGER` peut contenir du texte : SQLite a
/// une affinité de type, pas un type. C'est ici que la vérité de chaque valeur se lit, et l'écart avec
/// `ColumnInfo.type_name` est assumé (`17b`).
pub fn valeur_de(brute: ValueRef<'_>) -> Value {
    match brute {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::Int { value: n },
        ValueRef::Real(x) => Value::Float { value: x },
        ValueRef::Text(octets) => Value::Text {
            value: String::from_utf8_lossy(octets).into_owned(),
        },
        ValueRef::Blob(octets) => Value::Binary {
            base64: crate::engine::postgres::rows::encoder_base64(octets),
        },
    }
}

/// Les instructions qu'`Appliquer` exécutera, **une par modification**.
///
/// Rendues en couples (SQL, paramètres) : le texte affiché par `11c` et l'exécution partent de la
/// **même** composition, ce que `11d` a posé comme critère — un texte différent de ce qui part est
/// pire qu'absent.
///
/// Le `where` porte l'ancienne valeur, avec `is` plutôt que `=` : `is` est l'égalité **sûre au nul**
/// de SQLite, l'équivalent du `is not distinct from` que `11d` emploie en PostgreSQL. Sans lui, une
/// modification partant d'une cellule vide ne trouverait aucune ligne.
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
/// `is` et non `=` : l'égalité **sûre au nul** de SQLite, comme `instruction_de`. Pas de valeur
/// attendue : `PendingDelete` n'en porte pas, voir `rows.rs`.
fn suppression_de(
    plan: &UpdatePlan,
    suppression: &crate::engine::PendingDelete,
) -> (String, Vec<Option<String>>) {
    (
        format!(
            "delete from {} where {} is ?1",
            citer(&plan.table),
            citer(&plan.key_column)
        ),
        vec![Some(suppression.key.clone())],
    )
}

/// L'`insert` d'une ligne saisie, paramétré comme les modifications.
///
/// **Les colonnes non saisies sont absentes**, pour que la base applique ses défauts — un
/// `INTEGER PRIMARY KEY` qui s'auto-incrémente, un `DEFAULT`. Aucune valeur du tout donne
/// `DEFAULT VALUES`, la forme SQLite d'une ligne entièrement faite de défauts.
fn insertion_de(
    plan: &UpdatePlan,
    insertion: &crate::engine::PendingInsert,
) -> (String, Vec<Option<String>>) {
    let cible = citer(&plan.table);
    if insertion.values.is_empty() {
        return (format!("insert into {cible} default values"), Vec::new());
    }
    let noms = insertion
        .values
        .iter()
        .map(|valeur| citer(&valeur.column))
        .collect::<Vec<_>>()
        .join(", ");
    // Les places sont **numérotées** — `?1`, `?2` — parce que `texte_de` les retrouve par leur
    // numéro pour composer le texte lisible.
    let places = (1..=insertion.values.len())
        .map(|rang| format!("?{rang}"))
        .collect::<Vec<_>>()
        .join(", ");
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
            "update {} set {} = ?1 where {} is ?2 and {} is ?3",
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

/// Le patch inverse : valeur et attendue échangées, comme `11d` le fait.
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
/// exécuter — l'exécution passe par les paramètres. Les deux viennent de la même liste, donc ils ne
/// peuvent pas décrire des écritures différentes.
/// Le patch inverse en texte : les avertissements d'insertions et de suppressions, puis les
/// `update` qui défont.
pub fn patch_inverse_de(plan: &UpdatePlan) -> String {
    let instructions = instructions_inverses(plan);
    crate::engine::rows::patch_inverse(
        crate::engine::rows::avertissements(plan.inserts.len(), plan.deletes.len()),
        (!instructions.is_empty()).then(|| texte_de(&instructions)),
    )
}

pub fn texte_de(instructions: &[(String, Vec<Option<String>>)]) -> String {
    let mut lignes = vec!["BEGIN;".to_owned()];
    for (sql, parametres) in instructions {
        let mut lisible = sql.clone();
        // **En ordre décroissant, et c'est une correction.** `?1` est un préfixe de `?11` : substitué
        // en premier, il coupait le second en deux et le texte montré cessait d'être celui qui part.
        // Invisible à trois paramètres — la taille d'une modification —, certain dès qu'une insertion
        // porte onze colonnes.
        for (rang, parametre) in parametres.iter().enumerate().rev() {
            let litteral = match parametre {
                Some(valeur) => format!("'{}'", valeur.replace('\'', "''")),
                None => "NULL".to_owned(),
            };
            lisible = lisible.replace(&format!("?{}", rang + 1), &litteral);
        }
        lignes.push(format!("{lisible};"));
    }
    lignes.push("COMMIT;".to_owned());
    lignes.join("\n")
}

/// Une ligne rendue en `INSERT` exécutable — ce que `10f` copie.
pub fn insert_de(table: &str, colonnes: &[String], valeurs: &[Value]) -> String {
    let noms: Vec<String> = colonnes.iter().map(|nom| citer(nom)).collect();
    let litteraux: Vec<String> = valeurs.iter().map(litteral_de).collect();
    format!(
        "INSERT INTO {} ({}) VALUES ({});",
        citer(table),
        noms.join(", "),
        litteraux.join(", ")
    )
}

fn litteral_de(valeur: &Value) -> String {
    match valeur {
        Value::Null => "NULL".to_owned(),
        Value::Bool { value } => if *value { "1" } else { "0" }.to_owned(),
        Value::Int { value } => value.to_string(),
        Value::Float { value } => value.to_string(),
        Value::Decimal { value } => value.clone(),
        // **`x'…'` et non la chaîne base64** : coller cet `INSERT` doit recréer les octets, pas leur
        // représentation textuelle. C'est le seul littéral dont la forme diffère de son affichage.
        Value::Binary { base64 } => format!("x'{}'", hexadecimal_de(base64)),
        Value::Text { value } | Value::Timestamp { value } | Value::Json { value } => {
            format!("'{}'", value.replace('\'', "''"))
        }
    }
}

/// Le base64 d'un binaire, retourné en hexadécimal pour un littéral `x'…'`.
///
/// L'aller-retour paraît détourné : le moteur a lu des octets, les a encodés en base64 pour l'IPC
/// (`06a`), et les voici rendus en hexadécimal. C'est le prix du contrat — `Value` transporte du
/// texte, et cette fonction est le seul endroit qui a besoin des octets.
fn hexadecimal_de(base64: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let rang = |c: u8| TABLE.iter().position(|t| *t == c);
    let mut bits = 0u32;
    let mut compte = 0u32;
    let mut octets = Vec::new();
    for c in base64.bytes() {
        if c == b'=' {
            break;
        }
        let Some(valeur) = rang(c) else { continue };
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
///
/// **Même règle qu'en PostgreSQL** : `select * from grande` ne doit pas faire traverser l'IPC à un
/// million de lignes. Rendue dans `applied_limit` pour que l'écran le dise.
pub fn avec_limite(sql: &str, limite: RowLimit) -> (String, Option<u32>) {
    let nu = sql.trim().trim_end_matches(';').trim();
    let minuscules = nu.to_lowercase();
    // Seules les requêtes qui **rendent des lignes** reçoivent une limite. Un `update` limité ne
    // ferait pas ce que l'utilisateur a écrit.
    let rend_des_lignes = minuscules.starts_with("select")
        || minuscules.starts_with("with")
        || minuscules.starts_with("pragma");
    if !rend_des_lignes || minuscules.contains(" limit ") || minuscules.ends_with(" limit") {
        return (nu.to_owned(), None);
    }
    (
        format!("{nu} limit {}", limite.value()),
        Some(limite.value()),
    )
}

/// Les colonnes et les lignes d'une requête préparée.
pub fn lire(
    connexion: &Connection,
    sql: &str,
    parametres: &[&dyn rusqlite::ToSql],
) -> Result<(Vec<String>, Vec<Vec<Value>>), EngineError> {
    let mut requete = connexion.prepare(sql).map_err(|e| traduire(&e))?;
    let colonnes: Vec<String> = requete
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let largeur = colonnes.len();

    let mut lignes = Vec::new();
    let mut curseur = requete.query(parametres).map_err(|e| traduire(&e))?;
    while let Some(ligne) = curseur.next().map_err(|e| traduire(&e))? {
        let mut valeurs = Vec::with_capacity(largeur);
        for index in 0..largeur {
            valeurs.push(valeur_de(ligne.get_ref(index).map_err(|e| traduire(&e))?));
        }
        lignes.push(valeurs);
    }
    Ok((colonnes, lignes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::SortKey;

    fn requete() -> RowQuery {
        RowQuery::new("commandes", "commandes", RowLimit::FiveHundred)
    }

    #[test]
    fn une_lecture_simple_porte_toujours_sa_limite() {
        let (sql, parametres) = requete_de(&requete());
        assert_eq!(sql, "select * from \"commandes\" limit 500 offset 0");
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
        let (sql, parametres) = requete_de(&r);
        // La valeur n'apparaît **pas** dans le texte : c'est ce qui rend l'injection impossible par
        // construction, et non par échappement.
        assert!(!sql.contains("drop table"), "{sql}");
        assert!(sql.contains("= ?1"), "{sql}");
        assert_eq!(parametres, vec!["'; drop table commandes; --".to_owned()]);
    }

    #[test]
    fn un_motif_like_est_echappe() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "reference".into(),
            operator: FilterOperator::Matches,
            value: Some("100_%".into()),
        }];
        let (sql, parametres) = requete_de(&r);
        // Sans échappement, `_` et `%` sont des jokers : « 100_% » trouverait n'importe quoi.
        assert_eq!(parametres, vec!["%100\\_\\%%".to_owned()]);
        assert!(sql.contains("escape '\\'"), "{sql}");
    }

    #[test]
    fn une_liste_vide_ne_correspond_a_rien_plutot_que_de_casser_la_syntaxe() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::In,
            value: Some("  ,  ".into()),
        }];
        let (sql, _) = requete_de(&r);
        // `in ()` est une erreur de syntaxe en SQLite. Une condition fausse est ce qui a été demandé.
        assert!(sql.contains("0 = 1"), "{sql}");
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
                column: "montant".into(),
                operator: operateur,
                value: Some("10".into()),
            }];
            let (sql, parametres) = requete_de(&r);
            assert!(sql.contains(&format!("\"montant\" {signe} ?1")), "{sql}");
            assert_eq!(parametres, vec!["10".to_owned()]);
        }
    }

    #[test]
    fn le_tri_cite_ses_colonnes() {
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "cree le".into(),
            direction: SortDirection::Descending,
        }];
        let (sql, _) = requete_de(&r);
        // Une colonne à espace, ou nommée `order`, casserait la requête sans citation.
        assert!(sql.contains("order by \"cree le\" desc"), "{sql}");
    }

    #[test]
    fn le_where_d_une_modification_emploie_is_pas_egale() {
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "commandes".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes: vec![PendingUpdate {
                key: "7".into(),
                column: "note".into(),
                value: Some("vu".into()),
                expected: None,
            }],
        };
        let (sql, parametres) = &instructions_de(&plan)[0];
        // **`is` et non `=`** : c'est l'égalité sûre au nul de SQLite. Avec `=`, une modification
        // partant d'une cellule vide ne trouverait aucune ligne et la transaction s'annulerait sans
        // que personne comprenne — le même piège que `11d` en PostgreSQL et `18f` en MongoDB.
        assert!(sql.contains("is ?3"), "{sql}");
        assert_eq!(parametres[2], None);
    }

    #[test]
    fn le_texte_previsualise_porte_les_valeurs_de_l_execution() {
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "commandes".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes: vec![PendingUpdate {
                key: "7".into(),
                column: "statut".into(),
                value: Some("payee".into()),
                expected: Some("en_attente".into()),
            }],
        };
        let texte = texte_de(&instructions_de(&plan));
        // `11d` : un texte affiché différent de celui qui part est **pire qu'absent**. Les trois
        // valeurs qui décident de l'écriture doivent s'y lire.
        assert!(texte.starts_with("BEGIN;"), "{texte}");
        assert!(texte.contains("'payee'"), "{texte}");
        assert!(texte.contains("'en_attente'"), "{texte}");
        assert!(texte.contains("'7'"), "{texte}");
        assert!(texte.trim_end().ends_with("COMMIT;"), "{texte}");
    }

    #[test]
    fn une_apostrophe_dans_une_valeur_ne_casse_pas_le_texte_lisible() {
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "t".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes: vec![PendingUpdate {
                key: "1".into(),
                column: "nom".into(),
                value: Some("l'atelier".into()),
                expected: None,
            }],
        };
        assert!(texte_de(&instructions_de(&plan)).contains("'l''atelier'"));
    }

    #[test]
    fn le_patch_inverse_echange_la_valeur_et_l_attendue() {
        let plan = UpdatePlan {
            schema: "main".into(),
            table: "t".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes: vec![PendingUpdate {
                key: "1".into(),
                column: "statut".into(),
                value: Some("payee".into()),
                expected: Some("en_attente".into()),
            }],
        };
        let (_, parametres) = &instructions_inverses(&plan)[0];
        assert_eq!(parametres[0], Some("en_attente".to_owned()));
        assert_eq!(parametres[2], Some("payee".to_owned()));
    }

    fn plan_qui_ajoute(valeurs: &[(&str, Option<&str>)]) -> UpdatePlan {
        UpdatePlan {
            schema: "main".into(),
            table: "t".into(),
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
        let (sql, parametres) =
            instructions_de(&plan_qui_ajoute(&[("nom", Some("Albi")), ("pays", None)]))[0].clone();
        assert_eq!(sql, r#"insert into "t" ("nom", "pays") values (?1, ?2)"#);
        assert_eq!(parametres, vec![Some("Albi".to_owned()), None::<String>]);
    }

    #[test]
    fn une_ligne_sans_valeur_prend_les_defauts() {
        let (sql, parametres) = instructions_de(&plan_qui_ajoute(&[]))[0].clone();
        // `insert into t () values ()` n'est pas du SQL SQLite : `default values` l'est.
        assert_eq!(sql, r#"insert into "t" default values"#);
        assert!(parametres.is_empty());
    }

    #[test]
    fn le_texte_lisible_ne_coupe_pas_les_places_a_deux_chiffres() {
        // **Le piège de `?1` préfixe de `?11`.** Substitué en premier, il coupait le second en deux
        // et le texte montré cessait d'être celui qui part — invisible à trois paramètres, certain
        // dès qu'une ligne ajoutée porte onze colonnes.
        let colonnes: Vec<(String, Option<String>)> = (1..=12)
            .map(|rang| (format!("c{rang}"), Some(format!("v{rang}"))))
            .collect();
        let empruntees: Vec<(&str, Option<&str>)> = colonnes
            .iter()
            .map(|(nom, valeur)| (nom.as_str(), valeur.as_deref()))
            .collect();
        let texte = texte_de(&instructions_de(&plan_qui_ajoute(&empruntees)));
        assert!(texte.contains("'v11'"), "{texte}");
        assert!(texte.contains("'v12'"), "{texte}");
        // Et aucune place ne survit à la substitution : un `?` restant serait une valeur perdue.
        assert!(!texte.contains('?'), "{texte}");
    }

    #[test]
    fn le_patch_inverse_annonce_les_insertions_qu_il_ne_defait_pas() {
        let patch = patch_inverse_de(&plan_qui_ajoute(&[("nom", Some("Albi"))]));
        assert!(patch.starts_with("-- 1 ligne ajoutée"), "{patch}");
        assert!(!patch.contains("BEGIN"), "{patch}");
    }

    fn plan_qui_supprime(cles: &[&str]) -> UpdatePlan {
        UpdatePlan {
            schema: "main".into(),
            table: "t".into(),
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
        let (sql, parametres) = instructions_de(&plan_qui_supprime(&["1"]))[0].clone();
        // `is` : l'égalité sûre au nul de SQLite, même raison que pour une modification.
        assert_eq!(sql, r#"delete from "t" where "id" is ?1"#);
        assert_eq!(parametres, vec![Some("1".to_owned())]);
    }

    #[test]
    fn les_suppressions_viennent_apres_les_insertions() {
        let mut p = plan_qui_ajoute(&[("nom", Some("Albi"))]);
        p.deletes = plan_qui_supprime(&["2"]).deletes;
        let instructions = instructions_de(&p);
        assert!(instructions[0].0.starts_with("insert"));
        assert!(instructions[1].0.starts_with("delete"));
    }

    #[test]
    fn le_patch_inverse_annonce_les_suppressions_sans_les_defaire() {
        let patch = patch_inverse_de(&plan_qui_supprime(&["1"]));
        assert!(patch.starts_with("-- 1 ligne supprimée"), "{patch}");
        assert!(!patch.contains("BEGIN"), "{patch}");
    }

    #[test]
    fn une_limite_est_ajoutee_aux_lectures_seulement() {
        assert_eq!(
            avec_limite("select * from t", RowLimit::OneThousand),
            ("select * from t limit 1000".to_owned(), Some(1000))
        );
        // Une requête qui **écrit** ne doit pas être limitée : ce serait faire autre chose que ce qui
        // a été écrit.
        assert_eq!(
            avec_limite("delete from t where a = 1", RowLimit::OneThousand),
            ("delete from t where a = 1".to_owned(), None)
        );
    }

    #[test]
    fn une_limite_deja_ecrite_est_respectee() {
        // Annoncer « limité à 1000 par DoraBase » serait **faux** : l'utilisateur a demandé dix.
        assert_eq!(
            avec_limite("select * from t limit 10", RowLimit::OneThousand),
            ("select * from t limit 10".to_owned(), None)
        );
    }

    #[test]
    fn un_insert_rend_les_octets_en_hexadecimal_pas_en_base64() {
        let sql = insert_de(
            "commandes",
            &["empreinte".to_owned()],
            &[Value::Binary {
                base64: "AQIDBAUGBwg=".to_owned(),
            }],
        );
        // Coller cet `INSERT` doit recréer les **octets**, pas leur représentation textuelle.
        assert!(sql.contains("x'0102030405060708'"), "{sql}");
    }

    #[test]
    fn un_insert_cite_ses_identifiants_et_ses_chaines() {
        let sql = insert_de(
            "order",
            &["nom".to_owned()],
            &[Value::Text {
                value: "l'atelier".to_owned(),
            }],
        );
        // `order` est un mot réservé : sans citation, l'`INSERT` collé échouerait.
        assert!(sql.contains("INTO \"order\""), "{sql}");
        assert!(sql.contains("'l''atelier'"), "{sql}");
    }
}
