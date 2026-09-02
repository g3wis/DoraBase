//! La lecture de documents (`18e`) et l'écriture (`18f`), en fonctions **pures** partout où c'est
//! possible : la traduction des filtres et la composition des commandes se testent sans base.

use mongodb::bson::{doc, Bson, Document};

use crate::engine::{
    ColumnInfo, EngineError, Filter, FilterOperator, PendingUpdate, SortDirection, SortKey,
    TypeCategory,
};

/// Le critère `find` correspondant aux filtres de `06a`.
///
/// **Neuf opérateurs, et l'échappement de `matches`.** Une valeur tapée devient une expression
/// rationnelle : les caractères de la syntaxe y prendraient un sens que l'utilisateur n'a pas voulu,
/// et un motif pathologique coûterait un temps déraisonnable au serveur. Le filtre cherche donc une
/// **sous-chaîne**, comme `ILIKE '%…%'` en `06d`.
///
/// **Les quatre comparaisons exigent une valeur numérique, contrairement aux cinq autres qui restent
/// du texte.** MongoDB est typé nativement : un `$gt` avec une chaîne contre un champ entier ne
/// trouverait jamais rien, l'ordre BSON plaçant tous les nombres avant toutes les chaînes. La colonne
/// doit donc être `TypeCategory::Number` — même refus que Postgres, pour la même raison — et la
/// valeur saisie est convertie en nombre plutôt que laissée en texte.
pub fn critere(filtres: &[Filter], colonnes: &[ColumnInfo]) -> Result<Document, EngineError> {
    let mut critere = Document::new();
    for filtre in filtres {
        let champ = filtre.column.clone();
        let valeur = filtre.value.clone().unwrap_or_default();
        let condition = match filtre.operator {
            FilterOperator::Eq => Bson::String(valeur),
            FilterOperator::Ne => Bson::Document(doc! { "$ne": valeur }),
            // La liste se coupe sur la virgule, comme `06d` le fait pour `IN`.
            FilterOperator::In => Bson::Document(doc! {
                "$in": valeur.split(',').map(|v| Bson::String(v.trim().to_owned())).collect::<Vec<_>>()
            }),
            FilterOperator::Matches => Bson::Document(doc! {
                "$regex": echapper_pour_regex(&valeur),
                // Insensible à la casse, comme le `ILIKE` de `06d` : chercher « paris » et ne pas
                // trouver « Paris » se lit comme une absence de données.
                "$options": "i",
            }),
            // **`isNull` couvre le nul *et* l'absent.** C'est la différence que MongoDB a et que SQL
            // n'a pas : `{champ: null}` seul ne trouve pas un document où le champ manque, alors que
            // la grille affiche la même cellule vide pour les deux (`18e`). Un filtre qui n'en
            // trouverait que la moitié se lirait comme un défaut de lecture.
            FilterOperator::IsNull => Bson::Document(doc! { "$in": [Bson::Null] }),
            FilterOperator::Gt | FilterOperator::Gte | FilterOperator::Lte | FilterOperator::Lt => {
                let numerique = valeur_numerique(&filtre.column, &valeur, colonnes)?;
                let operateur = match filtre.operator {
                    FilterOperator::Gt => "$gt",
                    FilterOperator::Gte => "$gte",
                    FilterOperator::Lte => "$lte",
                    _ => "$lt",
                };
                Bson::Document(doc! { operateur: numerique })
            }
        };
        critere.insert(champ, condition);
    }
    Ok(critere)
}

/// Convertit la valeur saisie en nombre, pour une comparaison — refuse si la colonne n'est pas
/// numérique, ou si la valeur ne se lit pas comme un nombre.
///
/// **`i64` d'abord, `f64` en repli** : un entier gardé en entier compare exactement, là où passer
/// systématiquement par `f64` perdrait de la précision au-delà de 2^53 — le même souci que celui qui
/// a fait garder `Value::Decimal` en texte côté lecture.
fn valeur_numerique(
    champ: &str,
    valeur: &str,
    colonnes: &[ColumnInfo],
) -> Result<Bson, EngineError> {
    let colonne = colonnes.iter().find(|c| c.name == champ);
    if !matches!(colonne.map(|c| c.category), Some(TypeCategory::Number)) {
        return Err(EngineError::local(format!(
            "les comparaisons ne sont proposées que pour un champ numérique, et « {champ} » ne l'est pas"
        )));
    }
    if let Ok(entier) = valeur.parse::<i64>() {
        return Ok(Bson::Int64(entier));
    }
    valeur.parse::<f64>().map(Bson::Double).map_err(|_| {
        EngineError::local(format!("« {valeur} » n'est pas un nombre pour « {champ} »"))
    })
}

/// Le tri `find` correspondant aux clés de tri de `06a`.
pub fn tri(cles: &[SortKey]) -> Document {
    let mut tri = Document::new();
    for cle in cles {
        tri.insert(
            cle.column.clone(),
            match cle.direction {
                SortDirection::Ascending => 1,
                SortDirection::Descending => -1,
            },
        );
    }
    tri
}

/// Un document aplati en ligne de grille, dans l'ordre des colonnes déduites.
///
/// **Par nom, jamais par position** : l'ordre des champs d'un document BSON est celui de son
/// écriture, donc `_id` n'est pas garanti premier et deux documents n'ont pas le même ordre.
///
/// Un champ absent devient `Null` — la limite nommée dans `18e`, dont la fréquence de `18d` est le
/// seul remède affichable.
pub fn ligne(document: &Document, colonnes: &[ColumnInfo]) -> Vec<crate::engine::Value> {
    colonnes
        .iter()
        .map(|colonne| match document.get(&colonne.name) {
            Some(valeur) => super::bson::valeur_de(valeur),
            None => crate::engine::Value::Null,
        })
        .collect()
}

/// Le filtre qui désigne **un** document pour une modification (`18f`).
///
/// Deux conditions : la clé, et **l'ancienne valeur** — zéro document modifié signifie que le
/// document a changé depuis la lecture, et toute la transaction est annulée. C'est la garantie de
/// `06a`, et elle transpose exactement.
///
/// **La nuance qui n'existe pas en SQL** : quand l'ancienne valeur est vide, le filtre doit accepter
/// le champ nul **et** le champ absent. Sans cela, une modification partant d'une cellule vide
/// n'affecterait aucun document et annulerait la transaction sans que personne comprenne pourquoi —
/// le défaut le plus probable de `18f`, nommé dans la spec avant d'être écrit.
pub fn filtre_de_modification(modification: &PendingUpdate, cle: &str) -> Document {
    let mut filtre = doc! { cle: valeur_de_cle(&modification.key) };
    match &modification.expected {
        Some(attendue) => {
            filtre.insert(modification.column.clone(), Bson::String(attendue.clone()));
        }
        // `$in: [null]` trouve les deux : le champ à `null` et le champ absent. C'est la seule
        // forme qui le fasse — `{champ: null}` seul ne trouve que le premier.
        None => {
            filtre.insert(modification.column.clone(), doc! { "$in": [Bson::Null] });
        }
    }
    filtre
}

/// La mise à jour correspondante : `$set` d'une valeur, `$unset` d'un vide.
///
/// **`$unset` et non `$set: null`.** Poser `null` créerait un champ nul là où l'utilisateur a vidé
/// une cellule, ce qui n'est pas la même chose qu'un champ absent — et rendrait le document
/// différent de ses voisins vides. Retirer le champ est ce qui ressemble le plus à « vider ».
pub fn mise_a_jour(modification: &PendingUpdate) -> Document {
    match &modification.value {
        Some(valeur) => doc! { "$set": { modification.column.clone(): valeur.clone() } },
        None => doc! { "$unset": { modification.column.clone(): "" } },
    }
}

/// Une clé de document, telle que `A5` l'a lue — texte pour la grille, `ObjectId` pour MongoDB.
///
/// **Les 24 caractères hexadécimaux redeviennent un `ObjectId`.** `18a` a fait d'un `ObjectId` un
/// texte à l'affichage ; le chemin du retour doit le défaire, sans quoi `updateOne` chercherait la
/// chaîne `"64b7…"` là où le document porte un identifiant binaire — et ne trouverait rien.
/// Le document d'une ligne à insérer.
///
/// **Une colonne non saisie est absente du document ; un `NULL` demandé y est posé à `null`.** La
/// distinction est native en MongoDB — un champ absent et un champ nul ne se filtrent pas pareil —
/// et c'est exactement celle que le modèle de l'écran retient. La confondre poserait `null` sur tous
/// les champs qu'on n'a pas remplis, et donnerait un document qui ne ressemble à aucun autre de la
/// collection.
///
/// **Les valeurs restent du texte**, comme celles d'une modification : deviner un type à partir de
/// la saisie — « 0012 est un nombre » — changerait la valeur avant de l'écrire.
pub fn document_a_inserer(insertion: &crate::engine::PendingInsert) -> Document {
    let mut document = Document::new();
    for valeur in &insertion.values {
        match &valeur.value {
            Some(texte) => document.insert(valeur.column.clone(), texte.clone()),
            None => document.insert(valeur.column.clone(), Bson::Null),
        };
    }
    document
}

/// L'`insertOne` lisible d'une ligne à insérer — le pendant de `commande_lisible`.
pub fn insertion_lisible(collection: &str, document: &Document) -> String {
    format!(
        "db.{collection}.insertOne(\n  {}\n);",
        Bson::Document(document.clone()).into_relaxed_extjson()
    )
}

/// Le filtre qui désigne le document à supprimer.
///
/// **Juste la clé, aucune détection de conflit sur une ancienne valeur** : `PendingDelete` n'en
/// porte pas (voir `rows.rs`) — une ligne n'a qu'une seule colonne qui l'identifie, contrairement à
/// une modification qui vise une colonne précise.
pub fn filtre_de_suppression(cle_valeur: &str, cle_champ: &str) -> Document {
    doc! { cle_champ: valeur_de_cle(cle_valeur) }
}

/// Le `deleteOne` lisible — le pendant de `insertion_lisible`.
pub fn suppression_lisible(collection: &str, filtre: &Document) -> String {
    format!(
        "db.{collection}.deleteOne(\n  {}\n);",
        Bson::Document(filtre.clone()).into_relaxed_extjson()
    )
}

pub fn valeur_de_cle(texte: &str) -> Bson {
    if let Ok(oid) = texte.parse::<mongodb::bson::oid::ObjectId>() {
        return Bson::ObjectId(oid);
    }
    // Un `_id` numérique est courant sur les collections importées d'un SQL. Le laisser en texte
    // ferait échouer la recherche de la même façon.
    if let Ok(entier) = texte.parse::<i64>() {
        return Bson::Int64(entier);
    }
    Bson::String(texte.to_owned())
}

/// Le texte `mongosh` d'une modification — ce que `11c` affiche, et ce que `18f` exécute.
///
/// **Le même appel, rendu deux fois** : `preview_updates` promet « ce qui sera exécuté », et `11d`
/// a posé qu'un texte qui n'est pas exactement celui qui partira est *pire qu'absent*. Les deux
/// chemins partent donc du même couple filtre / mise à jour.
pub fn commande_lisible(collection: &str, filtre: &Document, mise_a_jour: &Document) -> String {
    format!(
        "db.{collection}.updateOne(\n  {},\n  {}\n);",
        Bson::Document(filtre.clone()).into_relaxed_extjson(),
        Bson::Document(mise_a_jour.clone()).into_relaxed_extjson()
    )
}

/// Échappe les caractères de la syntaxe des expressions rationnelles.
fn echapper_pour_regex(valeur: &str) -> String {
    let mut sortie = String::with_capacity(valeur.len());
    for c in valeur.chars() {
        if "\\^$.|?*+()[]{}".contains(c) {
            sortie.push('\\');
        }
        sortie.push(c);
    }
    sortie
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filtre(colonne: &str, operateur: FilterOperator, valeur: Option<&str>) -> Filter {
        Filter {
            column: colonne.into(),
            operator: operateur,
            value: valeur.map(str::to_owned),
        }
    }

    fn colonne_avec_categorie(nom: &str, categorie: TypeCategory) -> ColumnInfo {
        ColumnInfo {
            position: 1,
            name: nom.into(),
            type_name: "texte".into(),
            category: categorie,
            nullable: true,
            default: None,
            identity: None,
            frequency: None,
            key: None,
            comment: None,
        }
    }

    /// Un jeu de colonnes couvrant les champs des tests : `montant` numérique, le reste en
    /// texte — suffisant pour les filtres qui ne portent pas de comparaison.
    fn colonnes() -> Vec<ColumnInfo> {
        vec![
            colonne_avec_categorie("ville", TypeCategory::Text),
            colonne_avec_categorie("remise", TypeCategory::Text),
            colonne_avec_categorie("statut", TypeCategory::Text),
            colonne_avec_categorie("montant", TypeCategory::Number),
        ]
    }

    #[test]
    fn un_motif_est_echappe_plutot_qu_interprete() {
        let critere = critere(
            &[filtre("ville", FilterOperator::Matches, Some("a.*b"))],
            &colonnes(),
        )
        .unwrap();
        let regex = critere
            .get_document("ville")
            .unwrap()
            .get_str("$regex")
            .unwrap();
        // Sans échappement, `.*` chercherait n'importe quoi entre `a` et `b` — donc trouverait des
        // lignes que l'utilisateur n'a pas demandées, et un motif pathologique coûterait cher.
        assert_eq!(regex, r"a\.\*b");
    }

    #[test]
    fn is_null_trouve_le_champ_nul_et_le_champ_absent() {
        // **Le cœur de `18e`** : la grille affiche la même cellule vide pour les deux, donc le
        // filtre doit trouver les deux. `{champ: null}` seul n'en trouverait que la moitié.
        let critere = critere(
            &[filtre("remise", FilterOperator::IsNull, None)],
            &colonnes(),
        )
        .unwrap();
        let condition = critere.get_document("remise").unwrap();
        assert_eq!(
            condition.get_array("$in").unwrap(),
            &vec![Bson::Null],
            "{condition:?}"
        );
    }

    #[test]
    fn une_liste_se_coupe_sur_la_virgule_et_se_deleste_des_espaces() {
        let critere = critere(
            &[filtre(
                "statut",
                FilterOperator::In,
                Some("payee, expediee"),
            )],
            &colonnes(),
        )
        .unwrap();
        assert_eq!(
            critere
                .get_document("statut")
                .unwrap()
                .get_array("$in")
                .unwrap(),
            &vec![
                Bson::String("payee".into()),
                Bson::String("expediee".into())
            ]
        );
    }

    #[test]
    fn une_comparaison_produit_un_operateur_bson_numerique() {
        for (operateur, signe) in [
            (FilterOperator::Gt, "$gt"),
            (FilterOperator::Gte, "$gte"),
            (FilterOperator::Lte, "$lte"),
            (FilterOperator::Lt, "$lt"),
        ] {
            let critere = critere(&[filtre("montant", operateur, Some("42"))], &colonnes())
                .unwrap_or_else(|erreur| panic!("{operateur:?} : {erreur}"));
            let condition = critere.get_document("montant").unwrap();
            assert_eq!(condition.get_i64(signe).unwrap(), 42, "{condition:?}");
        }
    }

    #[test]
    fn une_comparaison_garde_la_precision_d_un_flottant() {
        let critere = critere(
            &[filtre("montant", FilterOperator::Gt, Some("4.5"))],
            &colonnes(),
        )
        .unwrap();
        let condition = critere.get_document("montant").unwrap();
        assert_eq!(condition.get_f64("$gt").unwrap(), 4.5, "{condition:?}");
    }

    #[test]
    fn une_comparaison_sur_un_champ_non_numerique_est_refusee() {
        let erreur = critere(
            &[filtre("statut", FilterOperator::Gt, Some("42"))],
            &colonnes(),
        )
        .expect_err("doit être refusé");
        assert!(erreur.message.contains("statut"), "{erreur}");
    }

    #[test]
    fn une_comparaison_sans_valeur_numerique_est_refusee() {
        let erreur = critere(
            &[filtre("montant", FilterOperator::Gt, Some("pas un nombre"))],
            &colonnes(),
        )
        .expect_err("doit être refusé");
        assert!(erreur.message.contains("pas un nombre"), "{erreur}");
    }

    #[test]
    fn un_objectid_en_texte_redevient_un_objectid() {
        // Sans ce retour, `updateOne` chercherait la chaîne là où le document porte un identifiant
        // binaire, et ne trouverait rien — modification silencieusement sans effet.
        let cle = valeur_de_cle("64b7f9a2c3d4e5f60718293a");
        assert!(matches!(cle, Bson::ObjectId(_)), "{cle:?}");
    }

    #[test]
    fn une_cle_numerique_redevient_un_entier_et_une_cle_libre_reste_du_texte() {
        assert_eq!(valeur_de_cle("42"), Bson::Int64(42));
        assert_eq!(
            valeur_de_cle("CMD-0001"),
            Bson::String("CMD-0001".to_owned())
        );
    }

    #[test]
    fn une_valeur_vide_devient_un_unset_pas_un_null() {
        // Poser `null` créerait un champ nul là où l'utilisateur a vidé une cellule — ce qui n'est
        // pas la même chose, et rendrait ce document différent de ses voisins vides.
        let modification = PendingUpdate {
            key: "1".into(),
            column: "remise".into(),
            value: None,
            expected: Some("500".into()),
        };
        assert!(mise_a_jour(&modification).contains_key("$unset"));
    }

    #[test]
    fn un_attendu_vide_filtre_sur_le_nul_et_sur_l_absent() {
        let modification = PendingUpdate {
            key: "1".into(),
            column: "remise".into(),
            value: Some("100".into()),
            expected: None,
        };
        let filtre = filtre_de_modification(&modification, "_id");
        // Le défaut annoncé par `18f` : sans `$in`, ce filtre n'affecterait aucun document dont le
        // champ est **absent**, et annulerait toute la transaction sans raison lisible.
        assert!(
            filtre.get_document("remise").unwrap().contains_key("$in"),
            "{filtre:?}"
        );
    }

    #[test]
    fn le_texte_previsualise_porte_le_filtre_et_la_mise_a_jour_reels() {
        let modification = PendingUpdate {
            key: "64b7f9a2c3d4e5f60718293a".into(),
            column: "statut".into(),
            value: Some("payee".into()),
            expected: Some("en_attente".into()),
        };
        let filtre = filtre_de_modification(&modification, "_id");
        let texte = commande_lisible("commandes", &filtre, &mise_a_jour(&modification));
        // `11d` : un texte qui n'est pas celui qui part est **pire qu'absent**. Les quatre valeurs
        // qui décident de l'écriture doivent s'y lire.
        assert!(texte.contains("db.commandes.updateOne"), "{texte}");
        assert!(texte.contains("64b7f9a2c3d4e5f60718293a"), "{texte}");
        assert!(texte.contains("en_attente"), "{texte}");
        assert!(texte.contains("payee"), "{texte}");
    }

    #[test]
    fn un_champ_absent_du_document_donne_une_cellule_nulle() {
        let colonnes = vec![colonne("reference"), colonne("remise")];
        let document = doc! { "reference": "CMD-0003" };
        assert_eq!(
            ligne(&document, &colonnes),
            vec![
                crate::engine::Value::Text {
                    value: "CMD-0003".into()
                },
                crate::engine::Value::Null
            ]
        );
    }

    #[test]
    fn les_champs_se_lisent_par_nom_pas_par_position() {
        // Deux documents dont les champs sont écrits dans un ordre différent : lire par position
        // mettrait la référence dans la colonne du statut.
        let colonnes = vec![colonne("reference"), colonne("statut")];
        let inverse = doc! { "statut": "payee", "reference": "CMD-0002" };
        assert_eq!(
            ligne(&inverse, &colonnes),
            vec![
                crate::engine::Value::Text {
                    value: "CMD-0002".into()
                },
                crate::engine::Value::Text {
                    value: "payee".into()
                }
            ]
        );
    }

    fn insertion(valeurs: &[(&str, Option<&str>)]) -> crate::engine::PendingInsert {
        crate::engine::PendingInsert {
            values: valeurs
                .iter()
                .map(|(column, value)| crate::engine::PendingInsertValue {
                    column: (*column).to_owned(),
                    value: value.map(str::to_owned),
                })
                .collect(),
        }
    }

    #[test]
    fn une_colonne_non_saisie_est_absente_du_document() {
        let document = document_a_inserer(&insertion(&[("statut", Some("en_attente"))]));
        // **Absente, et non posée à `null`.** Un champ absent et un champ nul ne se filtrent pas
        // pareil en MongoDB : poser `null` partout donnerait un document qui ne ressemble à aucun
        // autre de la collection.
        assert_eq!(document.len(), 1);
        assert!(!document.contains_key("reference"));
    }

    #[test]
    fn un_null_demande_est_pose_a_null() {
        let document = document_a_inserer(&insertion(&[("note", None)]));
        assert_eq!(document.get("note"), Some(&Bson::Null));
    }

    #[test]
    fn une_ligne_sans_valeur_donne_un_document_vide() {
        // Toutes les valeurs viennent de la base — un `_id` qu'elle engendre, et rien d'autre.
        assert!(document_a_inserer(&insertion(&[])).is_empty());
    }

    #[test]
    fn l_insertion_lisible_nomme_la_collection_et_ses_valeurs() {
        let texte = insertion_lisible(
            "commandes",
            &document_a_inserer(&insertion(&[("statut", Some("payee"))])),
        );
        assert!(texte.starts_with("db.commandes.insertOne("), "{texte}");
        assert!(texte.contains("payee"), "{texte}");
    }

    #[test]
    fn le_filtre_de_suppression_ne_porte_que_la_cle() {
        // Les trois formes que `valeur_de_cle` reconnaît, comme pour une modification.
        assert_eq!(filtre_de_suppression("42", "_id"), doc! { "_id": 42_i64 });
        assert_eq!(
            filtre_de_suppression("CMD-0001", "reference"),
            doc! { "reference": "CMD-0001" }
        );
    }

    #[test]
    fn la_suppression_lisible_nomme_la_collection_et_le_filtre() {
        let texte =
            suppression_lisible("commandes", &filtre_de_suppression("CMD-0001", "reference"));
        assert!(texte.starts_with("db.commandes.deleteOne("), "{texte}");
        assert!(texte.contains("CMD-0001"), "{texte}");
    }

    fn colonne(nom: &str) -> ColumnInfo {
        ColumnInfo {
            position: 1,
            name: nom.to_owned(),
            type_name: "string".into(),
            category: crate::engine::TypeCategory::Text,
            nullable: true,
            default: None,
            identity: None,
            key: None,
            comment: None,
            frequency: Some(1.0),
        }
    }
}
