//! Lecture paginée des lignes.
//!
//! # La contrainte transverse, et ce qu'elle exige vraiment
//!
//! `AGENTS.md` pose : « Aucun jeu de résultats complet ne traverse l'IPC. La récupération
//! est **paginée, pas seulement le rendu**. »
//!
//! Cette dernière phrase est celle qui coûte. Récupérer un million de lignes en Rust puis
//! n'en envoyer que cinq cents respecterait la lettre et manquerait tout : l'empreinte
//! serait celle du million. Le `LIMIT` et l'`OFFSET` partent donc **dans la requête**, ce
//! qu'un test mesure en comparant une table de cent mille lignes à une de mille.

use std::time::Instant;

use tokio_postgres::types::ToSql;
use tokio_postgres::{Client, Row};

use crate::engine::{
    ColumnInfo, EngineError, Filter, FilterOperator, RowQuery, RowWindow, SortDirection,
    TypeCategory, Value,
};

use super::error::traduire;

/// Lit une fenêtre de lignes.
///
/// Les noms de colonnes viennent de `colonnes`, obtenues par introspection : un nom absent
/// de cette liste est **refusé**, pas échappé. C'est ce qui rend l'injection par nom de
/// colonne impossible, là où les valeurs sont protégées par le paramétrage.
pub async fn rows(
    client: &Client,
    requete: &RowQuery,
    colonnes: &[ColumnInfo],
) -> Result<RowWindow, EngineError> {
    let (sql, valeurs) = construire_sql(requete, colonnes)?;

    let parametres: Vec<&(dyn ToSql + Sync)> =
        valeurs.iter().map(|v| v as &(dyn ToSql + Sync)).collect();

    let depart = Instant::now();
    let lignes = client
        .query(&sql, &parametres)
        .await
        .map_err(|erreur| traduire(&erreur))?;
    let duree = u32::try_from(depart.elapsed().as_millis()).unwrap_or(u32::MAX);

    let valeurs_lues = lignes
        .iter()
        .map(|ligne| valeurs_de(ligne, colonnes))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(RowWindow {
        offset: requete.offset,
        rows: valeurs_lues,
        // Le total n'est pas compté : sur une grande table il coûterait un parcours
        // complet, et `A5` affiche de toute façon le compte de la fenêtre.
        total: None,
        sql: sql_affichable(&sql, &valeurs),
        duration_ms: duree,
    })
}

/// Construit la requête et ses paramètres.
///
/// Rendu séparément de l'exécution pour être **testable sans base** : c'est ici que se joue
/// la protection contre l'injection, et elle mérite des tests unitaires exhaustifs.
pub(super) fn construire_sql(
    requete: &RowQuery,
    colonnes: &[ColumnInfo],
) -> Result<(String, Vec<String>), EngineError> {
    let mut valeurs: Vec<String> = Vec::new();
    let mut conditions: Vec<String> = Vec::new();

    for filtre in &requete.filters {
        let colonne = valider_colonne(&filtre.column, colonnes)?;
        conditions.push(condition_de(filtre, colonne, &mut valeurs)?);
    }

    let ou = if conditions.is_empty() {
        String::new()
    } else {
        format!(" where {}", conditions.join(" and "))
    };

    let tri = construire_tri(requete, colonnes)?;

    // `LIMIT` et `OFFSET` sont écrits en clair, non paramétrés : ce sont des entiers issus
    // d'une énumération fermée et d'un `u64`, donc aucune chaîne utilisateur n'y entre.
    let sql = format!(
        "select {} from {}.{}{ou}{tri} limit {} offset {}",
        liste_colonnes(colonnes),
        identifiant(&requete.schema),
        identifiant(&requete.table),
        requete.limit.value(),
        requete.offset
    );

    Ok((sql, valeurs))
}

/// Le tri, avec un critère **stable** ajouté quand il ne l'est pas.
///
/// Une pagination par décalage sur un tri non total rend des lignes en ordre indéfini d'une
/// page à l'autre : donc des doublons et des oublis, silencieux. La clé primaire est ajoutée
/// en dernier critère quand elle existe — comportement documenté plutôt que subi.
fn construire_tri(requete: &RowQuery, colonnes: &[ColumnInfo]) -> Result<String, EngineError> {
    let mut criteres: Vec<String> = Vec::new();

    for cle in &requete.sort {
        let colonne = valider_colonne(&cle.column, colonnes)?;
        let sens = match cle.direction {
            SortDirection::Ascending => "asc",
            SortDirection::Descending => "desc",
        };
        criteres.push(format!("{} {sens}", identifiant(&colonne.name)));
    }

    // Le tri est-il déjà total ? Il l'est si l'un de ses critères porte sur la clé primaire.
    let cle_primaire = colonnes
        .iter()
        .find(|c| c.key == Some(crate::engine::KeyKind::Primary));

    if let Some(primaire) = cle_primaire {
        let deja_stable = requete.sort.iter().any(|c| c.column == primaire.name);
        if !deja_stable {
            criteres.push(format!("{} asc", identifiant(&primaire.name)));
        }
    }

    Ok(if criteres.is_empty() {
        String::new()
    } else {
        format!(" order by {}", criteres.join(", "))
    })
}

/// Traduit un filtre en condition, en **paramétrant** sa valeur.
///
/// Interpoler la valeur serait une injection ouverte sur l'outil même dont le métier est
/// d'exécuter du SQL — donc une faille qui ne se remarquerait pas.
fn condition_de(
    filtre: &Filter,
    colonne: &ColumnInfo,
    valeurs: &mut Vec<String>,
) -> Result<String, EngineError> {
    let nom = identifiant(&colonne.name);

    if filtre.operator == FilterOperator::IsNull {
        return Ok(format!("{nom} is null"));
    }

    let valeur = filtre.value.as_ref().ok_or_else(|| {
        EngineError::local(format!(
            "l'opérateur {:?} exige une valeur pour la colonne « {} »",
            filtre.operator, colonne.name
        ))
    })?;

    match filtre.operator {
        FilterOperator::Eq | FilterOperator::Ne => {
            valeurs.push(valeur.clone());
            let comparaison = if filtre.operator == FilterOperator::Eq {
                "="
            } else {
                "<>"
            };
            // `::text` sur la colonne : la valeur saisie est du texte, et comparer un
            // entier à du texte échouerait sans transtypage. C'est aussi ce qui rend le
            // filtre utilisable sur n'importe quel type sans connaître les sept moteurs.
            Ok(format!("{nom}::text {comparaison} ${}", valeurs.len()))
        }
        FilterOperator::Matches => {
            valeurs.push(valeur.clone());
            Ok(format!("{nom}::text ~ ${}", valeurs.len()))
        }
        FilterOperator::In => {
            // Une liste séparée par des virgules, chaque élément **paramétré** séparément :
            // un `in ($1)` avec une chaîne « a,b,c » chercherait la valeur littérale
            // « a,b,c », pas trois valeurs.
            let elements: Vec<String> = valeur
                .split(',')
                .map(|element| element.trim().to_owned())
                .filter(|element| !element.is_empty())
                .collect();

            if elements.is_empty() {
                return Err(EngineError::local(format!(
                    "l'opérateur « in » exige au moins une valeur pour « {} »",
                    colonne.name
                )));
            }

            let places: Vec<String> = elements
                .into_iter()
                .map(|element| {
                    valeurs.push(element);
                    format!("${}", valeurs.len())
                })
                .collect();

            Ok(format!("{nom}::text in ({})", places.join(", ")))
        }
        FilterOperator::Gt | FilterOperator::Gte | FilterOperator::Lte | FilterOperator::Lt => {
            // Réservé aux colonnes numériques : `>` sur du texte trierait lexicographiquement
            // (`"9" > "10"`), ce que le signe affiché contredirait. L'écran ne propose ces
            // opérateurs que pour `TypeCategory::Number` ; ce refus tient si une configuration
            // écrite à la main les envoie quand même.
            if colonne.category != TypeCategory::Number {
                return Err(EngineError::local(format!(
                    "l'opérateur {:?} n'est proposé que pour une colonne numérique, et « {} » ne l'est pas",
                    filtre.operator, colonne.name
                )));
            }
            valeurs.push(valeur.clone());
            let comparaison = match filtre.operator {
                FilterOperator::Gt => ">",
                FilterOperator::Gte => ">=",
                FilterOperator::Lte => "<=",
                _ => "<",
            };
            // `${}::text::numeric` : le paramètre est décrit comme texte — ce que `String` sait
            // lier —, et c'est le cast *externe*, appliqué après coup, qui le convertit en
            // numeric à l'exécution. Le premier cast qui touche `$N` décide de son type déclaré ;
            // sans ce détour, Postgres décrirait le paramètre en `numeric`, type que `ToSql` pour
            // `String` ne sait pas lier.
            Ok(format!(
                "{nom}::numeric {comparaison} ${}::text::numeric",
                valeurs.len()
            ))
        }
        FilterOperator::IsNull => unreachable!("traité plus haut"),
    }
}

/// Un nom de colonne **doit** figurer parmi celles introspectées.
///
/// Refusé, pas échappé : un nom inconnu est une erreur de l'appelant ou une tentative
/// d'injection, et dans les deux cas l'exécuter serait pire que la refuser.
fn valider_colonne<'a>(
    nom: &str,
    colonnes: &'a [ColumnInfo],
) -> Result<&'a ColumnInfo, EngineError> {
    colonnes.iter().find(|c| c.name == nom).ok_or_else(|| {
        EngineError::local(format!(
            "la colonne « {nom} » n'existe pas dans cette table"
        ))
    })
}

/// Échappe un identifiant SQL par des guillemets doubles.
///
/// Nécessaire même pour un nom validé : un nom légitime peut contenir une majuscule ou un
/// mot réservé, que PostgreSQL replierait ou refuserait sans guillemets.
fn identifiant(nom: &str) -> String {
    format!("\"{}\"", nom.replace('"', "\"\""))
}

/// La liste des colonnes du `select`, **avec le transtypage en texte là où il est nécessaire**.
///
/// `valeur_de` lit nativement trois catégories — booléen, nombre, binaire — et replie tout le
/// reste sur du texte. Ce repli suppose que la colonne *arrive* en texte : sans `::text`,
/// `try_get::<String>` échoue sur un `timestamptz`, un `jsonb`, un `uuid` ou une énumération, et
/// la valeur devient `Null`.
///
/// **Défaut trouvé le 9 août 2026**, en écrivant le test d'`INSERT` de `10f` : l'`INSERT`
/// reconstruit posait `NULL` dans `created_at`, colonne `not null`, et la base l'a refusé. Le
/// commentaire de `valeur_de` annonçait ce transtypage depuis `06d` ; il n'avait jamais été
/// écrit. Aucun test ne l'avait vu, les tables de mesure ne portant que des entiers et du texte.
fn liste_colonnes(colonnes: &[ColumnInfo]) -> String {
    if colonnes.is_empty() {
        return "*".to_owned();
    }
    colonnes
        .iter()
        .map(|c| match c.category {
            // Un `numeric` est **décimal de précision arbitraire** : `tokio-postgres` ne le lit ni
            // en `i64` ni en `f64`, donc sans transtypage il retombait sur le repli texte — qui
            // échouait faute de `::text`, et la valeur arrivait en `Null`.
            TypeCategory::Number if est_decimal(&c.type_name) => {
                format!("{}::text", identifiant(&c.name))
            }
            // Lues dans leur type Rust naturel : les transtyper perdrait le typage sans rien
            // gagner (« 12900 » au lieu de 12900, un booléen en « t »).
            TypeCategory::Boolean | TypeCategory::Number | TypeCategory::Binary => {
                identifiant(&c.name)
            }
            _ => format!("{}::text", identifiant(&c.name)),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Vrai pour les types décimaux exacts de PostgreSQL — `numeric` et son alias `decimal`.
///
/// Le nom vient de `format_type`, donc porte sa précision : « numeric(10,2) ». Un préfixe suffit,
/// et `money` n'en fait pas partie — il se lit nativement.
fn est_decimal(type_name: &str) -> bool {
    let nom = type_name.trim();
    nom.starts_with("numeric") || nom.starts_with("decimal")
}

/// Le SQL tel que `A5` le montre derrière « Voir le SQL ».
///
/// Les paramètres y sont substitués **pour l'affichage seulement** : montrer une requête
/// différente de celle qui tourne serait un piège pour qui débogue. L'exécution, elle,
/// emploie toujours la forme paramétrée.
fn sql_affichable(sql: &str, valeurs: &[String]) -> String {
    let mut affichable = sql.to_owned();
    // À l'envers, pour que `$10` ne soit pas confondu avec `$1`.
    for (index, valeur) in valeurs.iter().enumerate().rev() {
        let place = format!("${}", index + 1);
        let litteral = format!("'{}'", valeur.replace('\'', "''"));
        affichable = affichable.replace(&place, &litteral);
    }
    affichable
}

/// Lit les valeurs d'une ligne, **typées** et non préformatées.
///
/// `A5` rend `NULL` distinctement, aligne nombres et dates en mono, met certaines colonnes
/// en pastille : c'est l'écran qui formate, lui seul connaissant la densité et la locale.
fn valeurs_de(ligne: &Row, colonnes: &[ColumnInfo]) -> Result<Vec<Value>, EngineError> {
    colonnes
        .iter()
        .enumerate()
        .map(|(index, colonne)| valeur_de(ligne, index, colonne))
        .collect()
}

/// Les valeurs d'une ligne de requête libre, **rendues en texte par le serveur** (`12c`).
///
/// Le protocole simple ne rend que du texte : c'est ce qui permet de lire un `jsonb` ou un `uuid`
/// sans transtyper le SQL de l'utilisateur. La catégorie, elle, vient de `prepare` — donc le
/// `Value` reste typé pour l'alignement et les glyphes, et un nombre ne s'affiche pas comme du texte.
///
/// **Un texte que la catégorie ne permet pas de convertir reste du texte.** Refuser la ligne, ou
/// rendre `Null`, serait le défaut de `06d` sous une autre forme : la valeur existe, elle doit
/// s'afficher.
pub fn valeurs_textuelles(
    ligne: &tokio_postgres::SimpleQueryRow,
    colonnes: &[(String, crate::engine::TypeCategory)],
) -> Vec<Value> {
    colonnes
        .iter()
        .enumerate()
        .map(|(index, (_, categorie))| match ligne.get(index) {
            None => Value::Null,
            Some(texte) => valeur_textuelle(texte, *categorie),
        })
        .collect()
}

/// Un texte du serveur converti selon la catégorie de sa colonne.
fn valeur_textuelle(texte: &str, categorie: crate::engine::TypeCategory) -> Value {
    use crate::engine::TypeCategory;
    match categorie {
        TypeCategory::Boolean => match texte {
            // Le protocole simple rend `t` et `f`, pas `true` et `false`.
            "t" => Value::Bool { value: true },
            "f" => Value::Bool { value: false },
            _ => Value::Text {
                value: texte.to_owned(),
            },
        },
        TypeCategory::Number => {
            if let Ok(value) = texte.parse::<i64>() {
                Value::Int { value }
            } else if texte.contains('.') || texte.contains('e') || texte.contains('E') {
                // **Un décimal reste du texte exact.** `12345678.91` en `f64` vaut
                // 12345678.909999999… : la précision compte plus que le type, décision de `06d`.
                Value::Decimal {
                    value: texte.to_owned(),
                }
            } else {
                Value::Text {
                    value: texte.to_owned(),
                }
            }
        }
        TypeCategory::Timestamp => Value::Timestamp {
            value: texte.to_owned(),
        },
        TypeCategory::Json => Value::Json {
            value: texte.to_owned(),
        },
        // Le binaire arrive en `\x…` : gardé tel quel, la grille l'abrège de toute façon. Le décoder
        // pour le réencoder en base64 coûterait sans rien apporter à l'affichage.
        _ => Value::Text {
            value: texte.to_owned(),
        },
    }
}

fn valeur_de(ligne: &Row, index: usize, colonne: &ColumnInfo) -> Result<Value, EngineError> {
    // Chaque catégorie est lue dans son type Rust naturel, puis repliée sur du texte si la
    // conversion échoue — un type exotique ne doit pas empêcher d'afficher une ligne.
    let valeur = match colonne.category {
        TypeCategory::Boolean => ligne
            .try_get::<_, Option<bool>>(index)
            .map(|v| v.map(|value| Value::Bool { value }))
            .ok(),
        // Un décimal est transtypé en texte par le `select`, et gardé tel quel : sa valeur exacte
        // compte plus que son type Rust, et `f64` la perdrait.
        TypeCategory::Number if est_decimal(&colonne.type_name) => ligne
            .try_get::<_, Option<String>>(index)
            .map(|v| v.map(|value| Value::Decimal { value }))
            .ok(),
        TypeCategory::Number => lire_nombre(ligne, index),
        // Le JSON est lu en **texte**, non en `serde_json::Value` : ce dernier exigerait la
        // feature `with-serde_json-1` de tokio-postgres pour un gain nul, l'écran affichant
        // de toute façon la forme textuelle. Le transtypage est fait côté serveur par le
        // repli universel plus bas.
        TypeCategory::Json => None,
        TypeCategory::Binary => ligne
            .try_get::<_, Option<Vec<u8>>>(index)
            .map(|v| {
                v.map(|octets| Value::Binary {
                    base64: encoder_base64(&octets),
                })
            })
            .ok(),
        _ => None,
    };

    if let Some(lue) = valeur {
        return Ok(lue.unwrap_or(Value::Null));
    }

    // Repli universel : tout type se rend en texte côté serveur. La requête ne le fait pas
    // d'emblée pour ne pas perdre le typage des cas courants.
    let texte: Option<String> = ligne.try_get(index).unwrap_or(None);
    Ok(match texte {
        None => Value::Null,
        Some(texte) => match colonne.category {
            TypeCategory::Timestamp => Value::Timestamp { value: texte },
            _ => Value::Text { value: texte },
        },
    })
}

/// Un entier ou un flottant, selon ce que la colonne porte réellement.
fn lire_nombre(ligne: &Row, index: usize) -> Option<Option<Value>> {
    if let Ok(entier) = ligne.try_get::<_, Option<i64>>(index) {
        return Some(entier.map(|value| Value::Int { value }));
    }
    if let Ok(entier) = ligne.try_get::<_, Option<i32>>(index) {
        return Some(entier.map(|v| Value::Int {
            value: i64::from(v),
        }));
    }
    if let Ok(reel) = ligne.try_get::<_, Option<f64>>(index) {
        return Some(reel.map(|value| Value::Float { value }));
    }
    None
}

/// Encodage base64 sans dépendance : l'IPC transporte du JSON, donc un binaire doit se
/// représenter en texte. Une dépendance pour trente lignes ne se justifie pas.
///
/// **Partagé avec l'adaptateur MongoDB** (`18a`), qui a le même besoin pour `BinData`. Une seconde
/// copie aurait été une seconde table de 64 caractères à écrire correctement — et le remplissage
/// des trois restes est exactement l'endroit où l'on se trompe.
pub(in crate::engine) fn encoder_base64(octets: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut sortie = String::with_capacity(octets.len().div_ceil(3) * 4);

    for morceau in octets.chunks(3) {
        let b0 = u32::from(morceau[0]);
        let b1 = morceau.get(1).copied().map_or(0, u32::from);
        let b2 = morceau.get(2).copied().map_or(0, u32::from);
        let assemble = (b0 << 16) | (b1 << 8) | b2;

        sortie.push(ALPHABET[((assemble >> 18) & 63) as usize] as char);
        sortie.push(ALPHABET[((assemble >> 12) & 63) as usize] as char);
        sortie.push(if morceau.len() > 1 {
            ALPHABET[((assemble >> 6) & 63) as usize] as char
        } else {
            '='
        });
        sortie.push(if morceau.len() > 2 {
            ALPHABET[(assemble & 63) as usize] as char
        } else {
            '='
        });
    }

    sortie
}

/// Une ligne rendue en `INSERT`, tel que `A5` le copie (`10f`).
///
/// **Côté Rust, et non côté écran.** Composer ce SQL en JavaScript demanderait au front de
/// connaître les règles de citation de sept moteurs — le projet a déjà refusé ce couplage deux
/// fois, pour la clé de base (`09b`) et pour la référence de secret (`08e`).
///
/// Le SQL produit doit être **exécutable** : identifiants cités, apostrophes doublées, `NULL`
/// sans guillemets, binaire en `\x…`. C'est ce que son test vérifie, en le réinjectant dans la
/// base de test.
pub fn insert_de(
    schema: &str,
    table: &str,
    colonnes: &[ColumnInfo],
    valeurs: &[Value],
) -> Result<String, EngineError> {
    if colonnes.len() != valeurs.len() {
        return Err(EngineError::local(format!(
            "{} colonnes pour {} valeurs : la ligne ne correspond pas à la table",
            colonnes.len(),
            valeurs.len()
        )));
    }

    let noms = colonnes
        .iter()
        .map(|c| identifiant(&c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let litteraux = valeurs
        .iter()
        .map(litteral_de)
        .collect::<Vec<_>>()
        .join(", ");

    Ok(format!(
        "INSERT INTO {}.{} ({noms})\nVALUES ({litteraux});",
        identifiant(schema),
        identifiant(table)
    ))
}

/// Un littéral SQL pour une valeur.
///
/// **`NULL` sans guillemets** : `'NULL'` est la chaîne « NULL », pas l'absence de valeur, et les
/// confondre insérerait un texte là où la colonne devait rester vide.
/// La limite à ajouter à une requête libre, **ou rien** (`12c`).
///
/// **Rien pour ce qui n'est pas une lecture.** Un `insert`, un `update`, un `create` ne rendent pas
/// de lignes : leur coller un `limit` serait une erreur de syntaxe. Rien non plus pour une requête
/// qui porte déjà une limite — l'utilisateur a dit ce qu'il voulait.
///
/// **La reconnaissance est syntaxique, donc approximative.** Elle lit le premier mot significatif et
/// cherche un `limit` de premier niveau. Un `limit` dans une sous-requête suivi d'un `select` externe
/// sans limite passerait pour limité : cas rare, et l'erreur va dans le sens le moins nuisible —
/// aucune limite ajoutée, donc aucun mensonge sur les données. L'inverse, ajouter une limite à une
/// requête qui en a une, produirait un SQL invalide.
pub fn limite_a_ajouter(sql: &str, limite: crate::engine::RowLimit) -> Option<u32> {
    let nu = sans_commentaires(sql);
    let debut = nu.trim_start().to_ascii_lowercase();
    let lecture = ["select", "with", "table", "values", "show", "explain"]
        .iter()
        .any(|mot| debut.starts_with(mot));
    if !lecture {
        return None;
    }
    // `limit` ou `fetch first` : les deux formes du standard, et PostgreSQL accepte les deux.
    let minuscule = nu.to_ascii_lowercase();
    if minuscule.contains(" limit ")
        || minuscule.contains("\nlimit ")
        || minuscule.contains(" fetch ")
    {
        return None;
    }
    Some(limite.value())
}

/// Le SQL débarrassé de ses commentaires, pour l'analyse seulement.
///
/// **Jamais pour l'exécution** : c'est le texte de l'utilisateur qui part, commentaires compris. Ici
/// on veut seulement éviter qu'un `-- limit 10` en fin de ligne fasse croire à une limite.
fn sans_commentaires(sql: &str) -> String {
    let mut sortie = String::with_capacity(sql.len());
    let mut reste = sql;
    while let Some(debut) = reste.find("--") {
        sortie.push_str(&reste[..debut]);
        match reste[debut..].find('\n') {
            Some(fin) => reste = &reste[debut + fin..],
            None => return sortie,
        }
    }
    sortie.push_str(reste);
    sortie
}

/// Le SQL avec sa limite, sous une forme **visible** dans le texte exécuté.
pub fn avec_limite(sql: &str, limite: u32) -> String {
    // Le point-virgule final est retiré : `select 1; limit 10` n'est pas du SQL. Il est rare dans une
    // console mais fréquent quand on copie une requête depuis ailleurs.
    let nu = sql.trim().trim_end_matches(';');
    format!("{nu}\nlimit {limite}")
}

/// Une instruction à exécuter : **le SQL complet, littéraux compris**.
///
/// **Une seule chaîne, montrée et exécutée.** `11c` annonce « SQL qui sera exécuté » ; deux
/// représentations — l'une pour l'œil, l'autre paramétrée pour le serveur — divergeraient sur les cas
/// rares, citation d'un nom ou valeur contenant une apostrophe. Ici il n'y a rien à faire
/// correspondre : c'est le même texte.
///
/// Le chemin paramétré a été essayé et abandonné pour une raison technique, pas par préférence : le
/// pilote déduit le type de chaque paramètre de la colonne visée, donc envoyer du texte pour une clé
/// `bigint` échoue à la sérialisation ; et un paramètre déclaré non typé n'est pas transmissible au
/// format binaire du pilote. Un littéral, lui, est résolu par le serveur comme n'importe quelle
/// constante — pour toute colonne, sans perdre l'index de la clé.
///
/// **L'échappement est donc la seule protection, et il est vérifié** : `apply_updates` refuse
/// d'écrire si `standard_conforming_strings` est à `off`, réglage sous lequel un antislash pourrait
/// défaire le doublement des apostrophes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instruction {
    pub sql: String,
}

/// Les instructions d'une suite de modifications.
///
/// **Un `UPDATE` sans `WHERE` est impossible par construction, pas par vérification.** Chaque
/// instruction porte la clé de sa ligne, et une table sans clé primaire est refusée plus haut. Le
/// garde-fou de `A10` (« refuser DELETE/UPDATE sans WHERE ») est donc tenu par le type, ce qui vaut
/// mieux qu'un test de chaîne sur du SQL généré.
///
/// **Le `WHERE` porte aussi l'ancienne valeur** : c'est la détection de conflit. Zéro ligne rendue
/// signifie que la ligne a changé depuis la lecture.
///
/// **Un `UPDATE` par cellule, et non un par ligne.** Regrouper les colonnes d'une même ligne
/// donnerait un SQL plus court mais illisible en regard des cartes du panneau, où chaque
/// modification est une entrée. La lisibilité du dernier écran avant écriture passe devant la
/// concision.
pub fn instructions_de(plan: &crate::engine::UpdatePlan) -> Result<Vec<Instruction>, EngineError> {
    if plan.changes.is_empty() && plan.inserts.is_empty() && plan.deletes.is_empty() {
        return Err(EngineError::local(
            "aucune modification à appliquer".to_owned(),
        ));
    }
    // **La clé n'est exigée que par les modifications et les suppressions.** Une insertion ne vise
    // aucune ligne : une table sans clé primaire refuse l'`UPDATE`/`DELETE` et accepte l'`INSERT`,
    // et confondre les deux interdirait d'ajouter une ligne là où c'est parfaitement possible.
    if (!plan.changes.is_empty() || !plan.deletes.is_empty()) && plan.key_column.is_empty() {
        // Sans clé, le `WHERE` viserait toutes les lignes. Refuser plutôt que produire un SQL qui
        // récrirait la table entière.
        return Err(EngineError::local(
            "la table n'a pas de clé primaire : une modification ne peut pas viser une ligne"
                .to_owned(),
        ));
    }

    let cible = format!("{}.{}", identifiant(&plan.schema), identifiant(&plan.table));
    let cle = identifiant(&plan.key_column);

    let mut instructions: Vec<Instruction> = plan
        .changes
        .iter()
        .map(|changement| {
            let colonne = identifiant(&changement.column);
            // `is not distinct from` et non `=` : `NULL = NULL` vaut `NULL` en SQL, donc un `WHERE`
            // sur une ancienne valeur nulle ne trouverait jamais sa ligne. Cette forme traite `NULL`
            // comme une valeur comparable — modifier une cellule vide est un cas courant.
            //
            // **`RETURNING 1` fait partie du SQL, montré comme exécuté.** Il sert à compter les
            // lignes touchées, donc à détecter le conflit. Le retirer de l'affichage rendrait le bloc
            // plus joli et la promesse fausse.
            Instruction {
                sql: format!(
                    "UPDATE {cible} SET {colonne} = {} WHERE {cle} = {} AND {colonne} is not distinct from {} RETURNING 1",
                    litteral_saisi(changement.value.as_deref()),
                    litteral_saisi(Some(&changement.key)),
                    litteral_saisi(changement.expected.as_deref()),
                ),
            }
        })
        .collect();

    // **Les insertions viennent après**, dans la même transaction : une ligne ajoutée puis modifiée
    // dans la même passe n'existe pas — le modèle de l'écran retient les deux séparément — mais
    // l'ordre reste celui que le panneau montre, et il se lit du haut vers le bas.
    for insertion in &plan.inserts {
        instructions.push(Instruction {
            sql: insert_saisi(&cible, insertion),
        });
    }

    // **Les suppressions viennent en dernier**, même raison que les insertions : l'ordre du panneau,
    // qui se lit du haut vers le bas. Pas de valeur attendue dans le `WHERE` — `PendingDelete` n'en
    // porte pas — mais `RETURNING 1` détecte quand même le conflit : zéro ligne rendue signifie que
    // la ligne a déjà changé ou disparu depuis la lecture.
    for suppression in &plan.deletes {
        instructions.push(Instruction {
            sql: format!(
                "DELETE FROM {cible} WHERE {cle} = {} RETURNING 1",
                litteral_saisi(Some(&suppression.key)),
            ),
        });
    }

    Ok(instructions)
}

/// L'`INSERT` d'une ligne saisie.
///
/// **Les colonnes non saisies sont absentes du SQL, pas posées à `NULL`.** C'est ce qui laisse la
/// base appliquer ses défauts — une séquence, un `now()`, une valeur déclarée. Les poser à `NULL`
/// ferait échouer l'insertion sur la première colonne obligatoire, et la ferait échouer en accusant
/// l'utilisateur d'une valeur qu'il n'a pas saisie.
///
/// **Aucune valeur du tout donne `DEFAULT VALUES`**, la forme de PostgreSQL pour une ligne
/// entièrement faite de défauts : `INSERT INTO t () VALUES ()` n'y est pas du SQL valide.
fn insert_saisi(cible: &str, insertion: &crate::engine::PendingInsert) -> String {
    if insertion.values.is_empty() {
        return format!("INSERT INTO {cible} DEFAULT VALUES RETURNING 1");
    }
    let noms = insertion
        .values
        .iter()
        .map(|valeur| identifiant(&valeur.column))
        .collect::<Vec<_>>()
        .join(", ");
    let litteraux = insertion
        .values
        .iter()
        .map(|valeur| litteral_saisi(valeur.value.as_deref()))
        .collect::<Vec<_>>()
        .join(", ");
    // `RETURNING 1` pour la même raison que l'`UPDATE` : il donne le compte des lignes écrites sans
    // second aller-retour, et il est montré parce qu'il est exécuté.
    format!("INSERT INTO {cible} ({noms}) VALUES ({litteraux}) RETURNING 1")
}

/// Les instructions **inversées** : celles qui défont l'application (`11d`).
///
/// Le patch inverse n'est pas un second générateur : c'est le même plan, valeurs et attendus
/// échangés. Deux chemins de génération divergeraient — et un patch inverse qui ne défait pas
/// exactement ce qui a été fait est pire qu'absent.
/// **Les insertions ni les suppressions n'y sont pas** : voir `engine::rows::avertissements`, qui
/// dit pourquoi elles ne se défont pas et le fait dire au patch.
pub fn instructions_inverses(
    plan: &crate::engine::UpdatePlan,
) -> Result<Vec<Instruction>, EngineError> {
    if plan.changes.is_empty() {
        // Un plan qui n'ajoute que des lignes n'a rien à inverser : rendre le vide plutôt que le
        // refus d'`instructions_de`, qui parlerait d'un plan sans modification alors qu'il y en a.
        return Ok(Vec::new());
    }
    let inverse = crate::engine::UpdatePlan {
        schema: plan.schema.clone(),
        table: plan.table.clone(),
        key_column: plan.key_column.clone(),
        changes: plan
            .changes
            .iter()
            .map(|changement| crate::engine::PendingUpdate {
                key: changement.key.clone(),
                column: changement.column.clone(),
                value: changement.expected.clone(),
                expected: changement.value.clone(),
            })
            .collect(),
        inserts: Vec::new(),
        deletes: Vec::new(),
    };
    instructions_de(&inverse)
}

/// Le patch inverse en texte : les avertissements d'insertions et de suppressions, puis les
/// `UPDATE` qui défont.
pub fn patch_inverse_de(plan: &crate::engine::UpdatePlan) -> Result<String, EngineError> {
    let instructions = instructions_inverses(plan)?;
    Ok(crate::engine::rows::patch_inverse(
        crate::engine::rows::avertissements(plan.inserts.len(), plan.deletes.len()),
        (!instructions.is_empty()).then(|| texte_de(&instructions)),
    ))
}

/// Les instructions encadrées par la transaction, pour l'affichage de `11c`.
///
/// **Une transaction, annoncée.** `BEGIN` et `COMMIT` encadrent le tout : dix corrections partent
/// ensemble ou pas du tout, et le lecteur doit le voir avant de cliquer.
pub fn texte_de(instructions: &[Instruction]) -> String {
    let mut lignes = vec!["BEGIN;".to_owned()];
    for instruction in instructions {
        lignes.push(format!("{};", instruction.sql));
    }
    lignes.push("COMMIT;".to_owned());
    lignes.join("\n")
}

/// La suite d'instructions qu'`Appliquer` exécutera, en texte (`11c`).
pub fn updates_de(plan: &crate::engine::UpdatePlan) -> Result<String, EngineError> {
    Ok(texte_de(&instructions_de(plan)?))
}

/// Un texte saisi rendu en littéral SQL, ou `NULL`.
///
/// **`None` et `Some("")` sont deux choses différentes**, et les confondre est l'erreur qu'un client
/// de bases ne doit pas commettre : `NULL` et la chaîne vide ne se comparent pas, ne s'indexent pas
/// et ne s'affichent pas pareil.
fn litteral_saisi(texte: Option<&str>) -> String {
    match texte {
        None => "NULL".to_owned(),
        Some(valeur) => format!("'{}'", valeur.replace('\'', "''")),
    }
}

fn litteral_de(valeur: &Value) -> String {
    match valeur {
        Value::Null => "NULL".to_owned(),
        Value::Bool { value } => value.to_string(),
        Value::Int { value } => value.to_string(),
        Value::Float { value } => value.to_string(),
        // Les apostrophes se doublent — la règle du standard SQL, et le seul échappement dont
        // une chaîne littérale a besoin en PostgreSQL hors chaînes E''.
        // Un décimal se rend **sans guillemets** : c'est un nombre, et le citer forcerait
        // PostgreSQL à un transtypage implicite qui échouerait sur une colonne d'un autre type.
        Value::Decimal { value } => value.clone(),
        Value::Text { value } | Value::Timestamp { value } | Value::Json { value } => {
            format!("'{}'", value.replace('\'', "''"))
        }
        Value::Binary { base64 } => format!("decode('{}', 'base64')", base64.replace('\'', "''")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{KeyKind, RowLimit, SortKey};

    fn colonnes() -> Vec<ColumnInfo> {
        vec![
            ColumnInfo {
                position: 1,
                name: "id".into(),
                type_name: "bigint".into(),
                category: TypeCategory::Number,
                nullable: false,
                default: None,
                identity: None,
                frequency: None,
                key: Some(KeyKind::Primary),
                comment: None,
            },
            ColumnInfo {
                position: 2,
                name: "statut".into(),
                type_name: "text".into(),
                category: TypeCategory::Text,
                nullable: true,
                default: None,
                identity: None,
                frequency: None,
                key: None,
                comment: None,
            },
        ]
    }

    fn requete() -> RowQuery {
        RowQuery::new("public", "orders", RowLimit::FiveHundred)
    }

    #[test]
    fn la_limite_et_le_decalage_sont_dans_la_requete() {
        // **Le cœur de la contrainte transverse** : si la pagination se faisait après
        // récupération, ces mots n'apparaîtraient pas.
        let mut r = requete();
        r.offset = 1000;
        let (sql, _) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains("limit 500"), "{sql}");
        assert!(sql.contains("offset 1000"), "{sql}");
    }

    #[test]
    fn une_valeur_de_filtre_passe_en_parametre_jamais_dans_le_sql() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::Eq,
            value: Some("payé".into()),
        }];

        let (sql, valeurs) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains("$1"), "{sql}");
        assert!(
            !sql.contains("payé"),
            "la valeur ne doit pas être dans le SQL : {sql}"
        );
        assert_eq!(valeurs, vec!["payé".to_owned()]);
    }

    #[test]
    fn une_tentative_d_injection_reste_une_donnee() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::Eq,
            value: Some("' or 1=1 --".into()),
        }];

        let (sql, valeurs) = construire_sql(&r, &colonnes()).unwrap();
        assert!(!sql.contains("or 1=1"), "injection dans le SQL : {sql}");
        assert_eq!(valeurs, vec!["' or 1=1 --".to_owned()]);
    }

    #[test]
    fn un_nom_de_colonne_inconnu_est_refuse_pas_echappe() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "colonne_inventee".into(),
            operator: FilterOperator::Eq,
            value: Some("x".into()),
        }];

        let erreur = construire_sql(&r, &colonnes()).expect_err("doit être refusé");
        assert!(erreur.message.contains("colonne_inventee"), "{erreur}");
    }

    #[test]
    fn un_nom_de_colonne_injectant_est_refuse() {
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "id; drop table users --".into(),
            direction: SortDirection::Ascending,
        }];
        assert!(construire_sql(&r, &colonnes()).is_err());
    }

    #[test]
    fn is_null_ne_consomme_pas_de_parametre() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::IsNull,
            value: None,
        }];

        let (sql, valeurs) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains("is null"), "{sql}");
        assert!(valeurs.is_empty());
    }

    #[test]
    fn in_parametre_chaque_element_separement() {
        // `in ($1)` avec « a,b,c » chercherait la valeur littérale « a,b,c ».
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::In,
            value: Some("payé, en attente ,annulé".into()),
        }];

        let (sql, valeurs) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains("in ($1, $2, $3)"), "{sql}");
        assert_eq!(valeurs, vec!["payé", "en attente", "annulé"]);
    }

    #[test]
    fn les_operateurs_non_numeriques_produisent_du_sql_sur_une_colonne_texte() {
        for operateur in FilterOperator::tous() {
            if operateur.est_une_comparaison_numerique() {
                continue;
            }
            let mut r = requete();
            r.filters = vec![Filter {
                column: "statut".into(),
                operator: operateur,
                value: operateur.prend_une_valeur().then(|| "x".to_owned()),
            }];
            assert!(
                construire_sql(&r, &colonnes()).is_ok(),
                "{operateur:?} devrait produire du SQL"
            );
        }
    }

    #[test]
    fn les_quatre_comparaisons_produisent_du_sql_sur_une_colonne_numerique() {
        for operateur in FilterOperator::tous() {
            if !operateur.est_une_comparaison_numerique() {
                continue;
            }
            let mut r = requete();
            r.filters = vec![Filter {
                column: "id".into(),
                operator: operateur,
                value: Some("10".into()),
            }];
            let (sql, valeurs) = construire_sql(&r, &colonnes()).unwrap_or_else(|erreur| {
                panic!("{operateur:?} devrait produire du SQL : {erreur}")
            });
            assert!(sql.contains("::numeric"), "{sql}");
            assert_eq!(valeurs, vec!["10".to_owned()]);
        }
    }

    #[test]
    fn une_comparaison_numerique_sur_une_colonne_texte_est_refusee() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::Gt,
            value: Some("10".into()),
        }];
        let erreur = construire_sql(&r, &colonnes()).expect_err("doit être refusé");
        assert!(erreur.message.contains("statut"), "{erreur}");
    }

    #[test]
    fn un_operateur_exigeant_une_valeur_la_reclame() {
        let mut r = requete();
        r.filters = vec![Filter {
            column: "statut".into(),
            operator: FilterOperator::Eq,
            value: None,
        }];
        assert!(construire_sql(&r, &colonnes()).is_err());
    }

    #[test]
    fn un_critere_stable_est_ajoute_quand_le_tri_n_est_pas_total() {
        // Sans lui, paginer sur un tri non total rend des doublons et des oublis entre
        // pages, en silence.
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "statut".into(),
            direction: SortDirection::Descending,
        }];

        let (sql, _) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains(r#"order by "statut" desc, "id" asc"#), "{sql}");
    }

    #[test]
    fn un_tri_deja_total_n_est_pas_double() {
        let mut r = requete();
        r.sort = vec![SortKey {
            column: "id".into(),
            direction: SortDirection::Descending,
        }];

        let (sql, _) = construire_sql(&r, &colonnes()).unwrap();
        assert_eq!(
            sql.matches(r#""id""#).count(),
            2,
            "id en select et en tri : {sql}"
        );
        assert!(sql.contains(r#"order by "id" desc"#), "{sql}");
        assert!(!sql.contains("asc"), "pas de second critère sur id : {sql}");
    }

    #[test]
    fn le_tri_multiple_respecte_l_ordre_des_rangs() {
        let mut r = requete();
        r.sort = vec![
            SortKey {
                column: "statut".into(),
                direction: SortDirection::Ascending,
            },
            SortKey {
                column: "id".into(),
                direction: SortDirection::Descending,
            },
        ];

        let (sql, _) = construire_sql(&r, &colonnes()).unwrap();
        assert!(sql.contains(r#"order by "statut" asc, "id" desc"#), "{sql}");
    }

    #[test]
    fn le_sql_affichable_substitue_les_valeurs_sans_les_confondre() {
        let valeurs: Vec<String> = (1..=12).map(|n| format!("v{n}")).collect();
        let sql = "select * from t where a = $1 and b = $10 and c = $12";
        let affichable = sql_affichable(sql, &valeurs);

        assert!(affichable.contains("a = 'v1'"), "{affichable}");
        assert!(affichable.contains("b = 'v10'"), "{affichable}");
        assert!(affichable.contains("c = 'v12'"), "{affichable}");
    }

    #[test]
    fn le_sql_affichable_echappe_les_apostrophes() {
        let affichable = sql_affichable("select * from t where a = $1", &["l'un".to_owned()]);
        assert!(affichable.contains("'l''un'"), "{affichable}");
    }

    #[test]
    fn un_identifiant_est_echappe() {
        assert_eq!(identifiant("statut"), r#""statut""#);
        assert_eq!(identifiant(r#"a"b"#), r#""a""b""#);
    }

    #[test]
    fn le_base64_suit_la_norme() {
        assert_eq!(encoder_base64(b""), "");
        assert_eq!(encoder_base64(b"f"), "Zg==");
        assert_eq!(encoder_base64(b"fo"), "Zm8=");
        assert_eq!(encoder_base64(b"foo"), "Zm9v");
        assert_eq!(encoder_base64(b"foob"), "Zm9vYg==");
        assert_eq!(encoder_base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(encoder_base64(b"foobar"), "Zm9vYmFy");
    }
}

#[cfg(test)]
mod tests_previsualisation {
    use super::*;
    use crate::engine::{PendingUpdate, UpdatePlan};

    fn plan(changes: Vec<PendingUpdate>) -> UpdatePlan {
        UpdatePlan {
            schema: "public".into(),
            table: "orders".into(),
            key_column: "id".into(),
            inserts: Vec::new(),
            deletes: Vec::new(),
            changes,
        }
    }

    fn changement(key: &str, column: &str, value: Option<&str>) -> PendingUpdate {
        attendu(key, column, value, Some("ancienne"))
    }

    /// Un changement dont on précise la valeur **attendue** — celle du `WHERE` de détection de
    /// conflit.
    fn attendu(
        key: &str,
        column: &str,
        value: Option<&str>,
        expected: Option<&str>,
    ) -> PendingUpdate {
        PendingUpdate {
            key: key.into(),
            column: column.into(),
            value: value.map(str::to_owned),
            expected: expected.map(str::to_owned),
        }
    }

    #[test]
    fn une_transaction_encadre_un_update_par_modification() {
        let sql = updates_de(&plan(vec![
            changement("184219", "status", Some("shipped")),
            changement("184217", "status", Some("refunded")),
        ]))
        .expect("prévisualisation");

        let lignes: Vec<&str> = sql.lines().collect();
        assert_eq!(lignes[0], "BEGIN;");
        assert_eq!(lignes[lignes.len() - 1], "COMMIT;");
        // **Un `UPDATE` par cellule** : le panneau montre une carte par modification, et un SQL
        // regroupé ne se relirait plus en regard de ces cartes.
        assert_eq!(lignes.len(), 4);
        // Le `WHERE` porte la clé **et** l'ancienne valeur : c'est la détection de conflit de `11d`,
        // montrée dès la prévisualisation puisque c'est ce qui sera exécuté.
        assert_eq!(
            lignes[1],
            // `RETURNING 1` fait partie du SQL exécuté : il compte les lignes touchées, donc détecte
            // le conflit. Il est **montré** aussi — un affichage plus joli que ce qui part serait une
            // promesse fausse sous un titre qui dit « SQL qui sera exécuté ».
            r#"UPDATE "public"."orders" SET "status" = 'shipped' WHERE "id" = '184219' AND "status" is not distinct from 'ancienne' RETURNING 1;"#
        );
        // L'ordre du modèle est conservé : le panneau les liste dans l'ordre de saisie.
        assert!(lignes[2].contains("refunded"));
    }

    #[test]
    fn null_n_est_pas_la_chaine_vide() {
        let sql = updates_de(&plan(vec![
            changement("1", "shipped_at", None),
            changement("2", "note", Some("")),
        ]))
        .expect("prévisualisation");

        // **La distinction que ce projet ne doit pas brouiller.** `NULL` et `''` ne se comparent pas,
        // ne s'indexent pas et ne s'affichent pas pareil ; les rendre identiques ici écrirait l'un
        // en croyant écrire l'autre.
        assert!(sql.contains(r#"SET "shipped_at" = NULL"#));
        assert!(sql.contains(r#"SET "note" = ''"#));
    }

    #[test]
    fn une_apostrophe_est_doublee_dans_la_valeur_comme_dans_la_cle() {
        let sql = updates_de(&plan(vec![attendu(
            "O'Brien",
            "note",
            Some("l'été n'est pas fini"),
            Some("d'avant"),
        )]))
        .expect("prévisualisation");

        // Sans doublement, `l'été` fermerait la chaîne et le reste de la ligne deviendrait du SQL —
        // le mécanisme même d'une injection, ici sur un texte que l'utilisateur a tapé lui-même.
        assert!(sql.contains(r#"SET "note" = 'l''été n''est pas fini'"#));
        assert!(sql.contains(r#"WHERE "id" = 'O''Brien'"#));
    }

    #[test]
    fn un_identifiant_a_guillemets_est_echappe() {
        let mut p = plan(vec![changement("1", r#"col"bizarre"#, Some("x"))]);
        p.table = r#"ta"ble"#.into();
        let sql = updates_de(&p).expect("prévisualisation");
        assert!(sql.contains(r#""ta""ble""#));
        assert!(sql.contains(r#""col""bizarre""#));
    }

    #[test]
    fn un_texte_numerique_reste_du_texte_cite() {
        let sql = updates_de(&plan(vec![changement("1", "code", Some("0012"))]))
            .expect("prévisualisation");
        // **En déduire un nombre changerait la valeur** : `0012` deviendrait `12`. PostgreSQL
        // convertit le littéral vers le type de la colonne — la base tranche, pas nous.
        assert!(sql.contains(r#"SET "code" = '0012'"#));
    }

    #[test]
    fn sans_cle_primaire_la_previsualisation_est_refusee() {
        let mut p = plan(vec![changement("1", "status", Some("x"))]);
        p.key_column = String::new();
        // Un `WHERE` sans clé viserait **toutes** les lignes : mieux vaut refuser que produire un
        // SQL qui récrirait la table entière.
        assert!(updates_de(&p).is_err());
    }

    #[test]
    fn sans_modification_il_n_y_a_rien_a_previsualiser() {
        assert!(updates_de(&plan(Vec::new())).is_err());
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

    fn plan_avec_insertions(inserts: Vec<crate::engine::PendingInsert>) -> UpdatePlan {
        let mut p = plan(Vec::new());
        p.inserts = inserts;
        p
    }

    #[test]
    fn une_ligne_ajoutee_donne_un_insert_dans_la_transaction() {
        let sql = updates_de(&plan_avec_insertions(vec![insertion(&[
            ("status", Some("pending")),
            ("note", Some("l'été")),
        ])]))
        .expect("prévisualisation");

        let lignes: Vec<&str> = sql.lines().collect();
        assert_eq!(lignes[0], "BEGIN;");
        assert_eq!(lignes[lignes.len() - 1], "COMMIT;");
        assert_eq!(lignes.len(), 3);
        assert!(
            lignes[1].starts_with(r#"INSERT INTO "public"."orders" ("status", "note") VALUES ("#)
        );
        // Même échappement que pour une modification : sans doublement, l'apostrophe fermerait la
        // chaîne et la suite deviendrait du SQL.
        assert!(lignes[1].contains("'pending', 'l''été'"));
    }

    #[test]
    fn une_colonne_non_saisie_est_absente_de_l_insert() {
        let sql = updates_de(&plan_avec_insertions(vec![insertion(&[(
            "status",
            Some("pending"),
        )])]))
        .expect("prévisualisation");
        // **Absente, pas nulle** : c'est ce qui laisse la séquence de `id` et le `now()` de
        // `created_at` s'appliquer. Les poser à `NULL` ferait échouer l'insertion sur la première
        // colonne obligatoire.
        assert!(!sql.contains(r#""id""#));
        assert!(!sql.contains("NULL"));
    }

    #[test]
    fn un_null_demande_reste_un_null_ecrit() {
        let sql = updates_de(&plan_avec_insertions(vec![insertion(&[(
            "shipped_at",
            None,
        )])]))
        .expect("prévisualisation");
        // Un `NULL` **demandé** est écrit, là où une colonne absente est laissée à son défaut : les
        // deux se ressemblent à l'écran et ne veulent pas dire la même chose.
        assert!(sql.contains(r#"("shipped_at") VALUES (NULL)"#));
    }

    #[test]
    fn une_ligne_sans_aucune_valeur_prend_les_defauts_de_la_base() {
        let sql =
            updates_de(&plan_avec_insertions(vec![insertion(&[])])).expect("prévisualisation");
        // `INSERT INTO t () VALUES ()` n'est pas du SQL valide en PostgreSQL : `DEFAULT VALUES` est
        // la forme qui l'exprime.
        assert!(sql.contains(r#"INSERT INTO "public"."orders" DEFAULT VALUES"#));
    }

    #[test]
    fn une_table_sans_cle_primaire_accepte_une_insertion() {
        let mut p = plan_avec_insertions(vec![insertion(&[("nom", Some("x"))])]);
        p.key_column = String::new();
        // **Une insertion ne vise aucune ligne** : elle n'a pas besoin du `WHERE` qui manque à la
        // modification. Refuser les deux ensemble interdirait un ajout parfaitement possible.
        assert!(updates_de(&p).is_ok());
    }

    #[test]
    fn les_insertions_viennent_apres_les_modifications() {
        let mut p = plan(vec![changement("1", "status", Some("x"))]);
        p.inserts = vec![insertion(&[("status", Some("y"))])];
        let sql = updates_de(&p).expect("prévisualisation");
        let lignes: Vec<&str> = sql.lines().collect();
        assert!(lignes[1].starts_with("UPDATE"));
        assert!(lignes[2].starts_with("INSERT"));
    }

    #[test]
    fn le_patch_inverse_annonce_les_insertions_qu_il_ne_defait_pas() {
        let mut p = plan(vec![changement("1", "status", Some("x"))]);
        p.inserts = vec![insertion(&[("status", Some("y"))])];
        let patch = patch_inverse_de(&p).expect("patch");

        // **Annoncé, jamais silencieux.** Le patch défait l'`UPDATE` et le dit pour l'insertion :
        // un patch incomplet qui se tait laisserait croire que tout est réversible.
        assert!(patch.starts_with("-- 1 ligne ajoutée"));
        assert!(patch.contains("UPDATE"));
        assert!(!patch.contains("INSERT"));
        // Et il ne rejoue **pas** l'insertion : un patch inverse qui insère à nouveau doublerait
        // la ligne qu'on voulait retirer.
        assert!(!patch.contains("'y'"));
    }

    #[test]
    fn un_patch_inverse_sans_modification_n_a_pas_de_transaction_vide() {
        let patch = patch_inverse_de(&plan_avec_insertions(vec![insertion(&[(
            "status",
            Some("y"),
        )])]))
        .expect("patch");
        // Un `BEGIN; COMMIT;` sans rien entre les deux serait un patch qui prétend défaire quelque
        // chose : il ne reste que la phrase qui dit pourquoi il n'y a rien.
        assert!(!patch.contains("BEGIN"));
        assert!(patch.starts_with("-- 1 ligne ajoutée"));
    }

    fn plan_avec_suppressions(deletes: Vec<crate::engine::PendingDelete>) -> UpdatePlan {
        let mut p = plan(Vec::new());
        p.deletes = deletes;
        p
    }

    fn suppression(key: &str) -> crate::engine::PendingDelete {
        crate::engine::PendingDelete { key: key.into() }
    }

    #[test]
    fn une_ligne_marquee_donne_un_delete_dans_la_transaction() {
        let sql = updates_de(&plan_avec_suppressions(vec![suppression("184219")]))
            .expect("prévisualisation");
        let lignes: Vec<&str> = sql.lines().collect();
        assert_eq!(lignes[0], "BEGIN;");
        assert_eq!(lignes[lignes.len() - 1], "COMMIT;");
        assert_eq!(lignes.len(), 3);
        // Pas de valeur attendue dans le `WHERE` — `PendingDelete` n'en porte pas — mais
        // `RETURNING 1` détecte quand même le conflit : zéro ligne rendue signifie que la ligne a
        // déjà changé ou disparu depuis la lecture.
        assert_eq!(
            lignes[1],
            r#"DELETE FROM "public"."orders" WHERE "id" = '184219' RETURNING 1;"#
        );
    }

    #[test]
    fn les_suppressions_viennent_apres_les_modifications_et_les_insertions() {
        let mut p = plan(vec![changement("1", "status", Some("x"))]);
        p.inserts = vec![insertion(&[("status", Some("y"))])];
        p.deletes = vec![suppression("2")];
        let sql = updates_de(&p).expect("prévisualisation");
        let lignes: Vec<&str> = sql.lines().collect();
        assert!(lignes[1].starts_with("UPDATE"));
        assert!(lignes[2].starts_with("INSERT"));
        assert!(lignes[3].starts_with("DELETE"));
    }

    #[test]
    fn sans_cle_primaire_une_suppression_est_refusee() {
        let mut p = plan_avec_suppressions(vec![suppression("1")]);
        p.key_column = String::new();
        // Même raison que pour une modification : sans clé, le `WHERE` viserait toutes les lignes.
        assert!(updates_de(&p).is_err());
    }

    #[test]
    fn une_table_sans_cle_primaire_accepte_toujours_une_insertion_seule() {
        // Une suppression exige une clé, une insertion non : les deux ne doivent pas se confondre
        // dans le refus.
        let mut p = plan_avec_insertions(vec![insertion(&[("nom", Some("x"))])]);
        p.key_column = String::new();
        assert!(updates_de(&p).is_ok());
    }

    #[test]
    fn le_patch_inverse_annonce_les_suppressions_sans_les_defaire() {
        let patch =
            patch_inverse_de(&plan_avec_suppressions(vec![suppression("1")])).expect("patch");
        // Même arbitrage que pour les insertions : DoraBase n'a gardé que la clé, pas le reste de
        // la ligne, donc rien à réinsérer pour la restaurer.
        assert!(patch.starts_with("-- 1 ligne supprimée"));
        assert!(!patch.contains("INSERT"));
        assert!(!patch.contains("BEGIN"));
    }

    #[test]
    fn le_patch_inverse_annonce_les_deux_quand_il_y_a_insertions_et_suppressions() {
        let mut p = plan(Vec::new());
        p.inserts = vec![insertion(&[("status", Some("y"))])];
        p.deletes = vec![suppression("1")];
        let patch = patch_inverse_de(&p).expect("patch");
        assert!(patch.contains("ligne ajoutée"));
        assert!(patch.contains("ligne supprimée"));
    }
}

#[cfg(test)]
mod tests_limite {
    use super::*;
    use crate::engine::RowLimit;

    #[test]
    fn une_lecture_sans_limite_en_recoit_une() {
        assert_eq!(
            limite_a_ajouter("select * from orders", RowLimit::OneThousand),
            Some(1000)
        );
        // `with`, `table` et `values` rendent aussi des lignes.
        assert_eq!(
            limite_a_ajouter("with x as (select 1) select * from x", RowLimit::OneHundred),
            Some(100)
        );
        assert_eq!(
            limite_a_ajouter("table orders", RowLimit::OneHundred),
            Some(100)
        );
    }

    #[test]
    fn une_lecture_qui_porte_sa_limite_n_est_pas_touchee() {
        // **L'utilisateur a dit ce qu'il voulait.** Ajouter une seconde limite produirait un SQL
        // invalide, ce qui est la pire des deux erreurs possibles ici.
        assert_eq!(
            limite_a_ajouter("select 1 limit 5", RowLimit::OneThousand),
            None
        );
        assert_eq!(
            limite_a_ajouter("select 1\nlimit 5", RowLimit::OneThousand),
            None
        );
        // `fetch first` est l'autre forme du standard, et PostgreSQL l'accepte.
        assert_eq!(
            limite_a_ajouter("select 1 fetch first 5 rows only", RowLimit::OneThousand),
            None
        );
    }

    #[test]
    fn ce_qui_ne_rend_pas_de_lignes_n_est_jamais_limite() {
        // **Coller un `limit` à un `insert` serait une erreur de syntaxe**, pas une protection.
        for sql in [
            "insert into orders (id) values (1)",
            "update orders set status = 'x'",
            "delete from orders",
            "create table t (id int)",
            "truncate orders",
            "begin",
        ] {
            assert_eq!(limite_a_ajouter(sql, RowLimit::OneThousand), None, "{sql}");
        }
    }

    #[test]
    fn un_limit_en_commentaire_ne_compte_pas() {
        // Sans retirer les commentaires, `-- limit 10` ferait croire à une limite et laisserait
        // passer un `select *` sans borne — un million de lignes vers l'IPC.
        assert_eq!(
            limite_a_ajouter("select * from orders -- limit 10\n", RowLimit::OneThousand),
            Some(1000)
        );
    }

    #[test]
    fn la_limite_est_visible_dans_le_sql_execute() {
        // **Elle doit se lire.** Le panneau montre le SQL exécuté, et une limite invisible ferait
        // douter du nombre de lignes affiché.
        assert_eq!(avec_limite("select 1", 500), "select 1\nlimit 500");
        // Un point-virgule final vient souvent d'un copier-coller : `select 1; limit 500` n'est pas
        // du SQL.
        assert_eq!(avec_limite("select 1;", 500), "select 1\nlimit 500");
    }
}
