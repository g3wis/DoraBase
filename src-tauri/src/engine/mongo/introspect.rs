//! L'introspection MongoDB (`18c`) et le schéma déduit (`18d`).
//!
//! **Le niveau « schéma » porte les bases MongoDB** — décision de `18a`. La déclaration de connexion
//! est le serveur, le schéma est la base, l'objet est la collection : l'arbre de `A4` garde ses
//! quatre niveaux, et le mot « schéma » n'apparaît nulle part dans l'interface.

use mongodb::bson::{doc, Bson, Document};
use mongodb::Client;

use crate::engine::{
    ColumnInfo, ConstraintInfo, EngineError, IndexInfo, ObjectCounts, ObjectKind, RowCount,
    SchemaInfo, TableDetail, TableSummary,
};

use super::bson::categorie;
use super::error::traduire;

/// **Combien de documents l'échantillon de `18d` lit, et pourquoi ce nombre.**
///
/// Assez pour qu'un champ présent dans un document sur cinquante ait toutes les chances d'être vu ;
/// assez peu pour que `$sample` reste instantané — il tire par balayage aléatoire, et le coût suit
/// la taille de l'échantillon, pas celle de la collection.
///
/// **Écrit avec sa raison plutôt que choisi au hasard**, comme `18d` l'exige. Le rendre réglable est
/// une préférence, donc `15`.
const TAILLE_DE_L_ECHANTILLON: i64 = 200;

/// Les bases du serveur — le niveau « schéma » de l'arbre.
///
/// **`admin`, `config` et `local` sont écartées** : ce sont les bases de service de MongoDB, elles
/// n'appartiennent pas à l'utilisateur, et les afficher mettrait trois entrées de bruit en tête de
/// l'arbre. C'est l'équivalent de `pg_catalog` et `information_schema`, que `06c` écarte déjà.
pub async fn bases(client: &Client) -> Result<Vec<SchemaInfo>, EngineError> {
    let mut sortie = Vec::new();
    for nom in client
        .list_database_names()
        .await
        .map_err(|e| traduire(&e))?
    {
        if matches!(nom.as_str(), "admin" | "config" | "local") {
            continue;
        }
        let counts = compter(client, &nom).await?;
        sortie.push(SchemaInfo {
            name: nom,
            // Une base MongoDB n'a pas de propriétaire au sens d'un rôle SQL, et les bases de
            // service sont écartées juste au-dessus : rien n'arrive ici qui soit du catalogue.
            owner: None,
            system: false,
            counts,
        });
    }
    sortie.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sortie)
}

/// Les compteurs du contrôle segmenté de `A4`.
///
/// **Les fonctions sont à zéro, et c'est une valeur juste** : MongoDB n'en a pas côté serveur. Les
/// déclencheurs d'Atlas n'existent que dans le service géré, hors du serveur qu'on interroge.
///
/// **Le coût est un appel par collection** pour compter les index. Sur une base à deux cents
/// collections, cela fait deux cents allers-retours au dépliage — mesuré et dit dans `18c`. La
/// parade tenue en réserve : ne compter les index qu'à l'ouverture d'une collection, au prix d'un
/// compteur qui apparaîtrait après coup.
async fn compter(client: &Client, base: &str) -> Result<ObjectCounts, EngineError> {
    let db = client.database(base);
    let descriptions = db
        .run_command(doc! { "listCollections": 1, "nameOnly": false })
        .await
        .map_err(|e| traduire(&e))?;

    let mut tables = 0;
    let mut views = 0;
    let mut indexes = 0;

    for description in lot_de(&descriptions) {
        let nom = description.get_str("name").unwrap_or_default();
        if est_interne(nom) {
            continue;
        }
        match description.get_str("type").unwrap_or("collection") {
            "view" => views += 1,
            _ => {
                tables += 1;
                indexes += db
                    .collection::<Document>(nom)
                    .list_index_names()
                    .await
                    .map(|noms| u32::try_from(noms.len()).unwrap_or(u32::MAX))
                    .unwrap_or(0);
            }
        }
    }

    Ok(ObjectCounts {
        tables,
        views,
        functions: 0,
        indexes,
    })
}

/// Les collections d'une base — le tableau d'objets de `A4`.
pub async fn collections(client: &Client, base: &str) -> Result<Vec<TableSummary>, EngineError> {
    let db = client.database(base);
    let descriptions = db
        .run_command(doc! { "listCollections": 1, "nameOnly": false })
        .await
        .map_err(|e| traduire(&e))?;

    let mut sortie = Vec::new();
    for description in lot_de(&descriptions) {
        let nom = description.get_str("name").unwrap_or_default().to_owned();
        if est_interne(&nom) {
            continue;
        }
        let vue = description.get_str("type").unwrap_or("collection") == "view";

        // **Une vue n'a ni compte ni taille propres** : elle en aurait celles de son pipeline, qu'il
        // faudrait exécuter. `RowCount::Unknown` dit exactement cela, et `A4` l'affiche déjà.
        let (rows, size_bytes) = if vue {
            (RowCount::Unknown, None)
        } else {
            statistiques(&db, &nom).await
        };

        sortie.push(TableSummary {
            name: nom,
            kind: if vue {
                ObjectKind::View
            } else {
                ObjectKind::Table
            },
            rows,
            size_bytes,
            // **Zéro colonne, et non « une par champ deviné »** : les colonnes sont déduites
            // (`18d`), et les déduire ici coûterait un échantillonnage par ligne du tableau. `A4`
            // affiche le compte de la table ouverte, pas de toutes.
            column_count: 0,
            // `_id` est **toujours** la clé primaire d'une collection : MongoDB en crée l'index
            // d'office et interdit de le supprimer. C'est la seule certitude structurelle qu'offre
            // une collection.
            primary_key: if vue { None } else { Some("_id".to_owned()) },
            // Pas d'`ANALYZE` en MongoDB : les statistiques sont tenues à jour en continu.
            last_analyze: None,
            comment: None,
        });
    }
    sortie.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sortie)
}

/// Le compte de documents et la taille, depuis `collStats`.
///
/// **Estimé, et le type le dit** : `count` de `collStats` lit les métadonnées de la collection —
/// instantané et approximatif. `countDocuments()` serait exact et parcourrait la collection, ce que
/// `06c` a refusé pour la même raison en SQL.
///
/// Après un arrêt brutal, l'estimation de MongoDB peut être **fausse**, pas seulement imprécise.
/// C'est ce que `RowCount::Estimated` promet — une estimation, pas une borne.
///
/// Un échec ici ne fait pas échouer le tableau : une collection dont on ne sait pas la taille
/// s'affiche sans, ce qui vaut mieux qu'un écran vide.
async fn statistiques(db: &mongodb::Database, collection: &str) -> (RowCount, Option<u64>) {
    match db.run_command(doc! { "collStats": collection }).await {
        Ok(stats) => {
            let compte = nombre_de(&stats, "count").unwrap_or(0);
            let taille = nombre_de(&stats, "storageSize").and_then(|n| u64::try_from(n).ok());
            (RowCount::Estimated { value: compte }, taille)
        }
        Err(_) => (RowCount::Unknown, None),
    }
}

/// Le détail d'une collection — ce que `A9` affiche.
pub async fn detail(
    client: &Client,
    base: &str,
    collection: &str,
) -> Result<TableDetail, EngineError> {
    let db = client.database(base);
    let descriptions = db
        .run_command(doc! { "listCollections": 1, "filter": { "name": collection } })
        .await
        .map_err(|e| traduire(&e))?;
    let description = lot_de(&descriptions).into_iter().next().ok_or_else(|| {
        EngineError::local(format!(
            "la collection « {collection} » n'existe pas dans « {base} »"
        ))
    })?;
    let vue = description.get_str("type").unwrap_or("collection") == "view";

    let columns = if vue {
        // Une vue s'échantillonne comme une collection : le pipeline s'exécute, et c'est bien ce
        // qu'on veut voir — les champs que la vue **rend**, pas ceux de sa source.
        champs_deduits(&db, collection).await.unwrap_or_default()
    } else {
        champs_deduits(&db, collection).await?
    };

    let indexes = if vue {
        Vec::new()
    } else {
        index_de(&db, collection).await?
    };
    let (rows, size_bytes) = if vue {
        (RowCount::Unknown, None)
    } else {
        statistiques(&db, collection).await
    };

    // **Le validateur est la seule contrainte déclarée qu'une collection puisse porter.** Le rendre
    // dans `constraints` le fait apparaître dans le tableau de `14b` sans code propre au moteur.
    let constraints = match description
        .get_document("options")
        .ok()
        .and_then(|o| o.get("validator"))
    {
        Some(validateur) => vec![ConstraintInfo {
            name: format!("{collection}_validator"),
            definition: json_lisible(validateur),
        }],
        None => Vec::new(),
    };

    let ddl = super::ddl::assembler(base, collection, &description, &indexes);

    Ok(TableDetail {
        schema: base.to_owned(),
        name: collection.to_owned(),
        rows,
        size_bytes,
        comment: None,
        columns,
        indexes,
        constraints,
        // Les déclencheurs d'Atlas vivent dans le service géré, pas dans le serveur.
        triggers: Vec::new(),
        // **Aucune relation, et ce n'est pas un manque** : MongoDB n'a pas de clé étrangère. Une
        // convention de nommage (`client_id` → `clients`) serait une devinette, et `12d` a déjà
        // établi qu'une suggestion fausse est pire qu'une absence.
        relations: Vec::new(),
        ddl,
    })
}

/// Les index d'une collection, résumés comme `14b` les affiche.
async fn index_de(db: &mongodb::Database, collection: &str) -> Result<Vec<IndexInfo>, EngineError> {
    let reponse = db
        .run_command(doc! { "listIndexes": collection })
        .await
        .map_err(|e| traduire(&e))?;

    let mut sortie: Vec<IndexInfo> = lot_de(&reponse)
        .into_iter()
        .map(|index| {
            let nom = index.get_str("name").unwrap_or_default().to_owned();
            let unique = index.get_bool("unique").unwrap_or(false);
            let cles = index
                .get_document("key")
                .map(|k| {
                    k.iter()
                        .map(|(champ, sens)| {
                            match sens.as_i32().or(sens.as_i64().map(|n| n as i32)) {
                                Some(-1) => format!("{champ} DESC"),
                                Some(_) => champ.clone(),
                                // Un index textuel ou géospatial porte un mot à la place du sens.
                                None => format!("{champ} {}", json_lisible(sens)),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            // **La forme d'un `CREATE INDEX`**, pour que `resumeDIndex` (`14b`) la reconnaisse
            // sans une seconde grammaire côté écran : « unique » et « USING … (…) » sont les deux
            // choses qu'il y cherche.
            IndexInfo {
                definition: format!(
                    "CREATE {}INDEX {nom} ON {}.{collection} USING btree ({cles})",
                    if unique { "UNIQUE " } else { "" },
                    db.name()
                ),
                name: nom,
            }
        })
        .collect();
    sortie.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sortie)
}

/// **Le schéma déduit** (`18d`) : les champs d'une collection et leur fréquence.
///
/// Le pipeline agrège **dans MongoDB** : `$sample` tire, `$project` avec `$objectToArray` énumère
/// les champs de chaque document, `$unwind` les étale, `$group` les compte. Ce qui traverse l'IPC
/// est une liste de champs — jamais un document, ce que la contrainte transverse interdit.
///
/// **`$sample` est aléatoire** : deux lectures peuvent ne pas donner les mêmes champs rares. C'est
/// inhérent, et c'est pourquoi la fréquence est affichée — elle dit à quel point s'y fier.
async fn champs_deduits(
    db: &mongodb::Database,
    collection: &str,
) -> Result<Vec<ColumnInfo>, EngineError> {
    let pipeline = vec![
        doc! { "$sample": { "size": TAILLE_DE_L_ECHANTILLON } },
        doc! { "$project": { "champs": { "$objectToArray": "$$ROOT" } } },
        doc! { "$unwind": "$champs" },
        doc! { "$group": {
            "_id": { "nom": "$champs.k", "type": { "$type": "$champs.v" } },
            "compte": { "$sum": 1 },
        }},
        doc! { "$group": {
            "_id": "$_id.nom",
            "compte": { "$sum": "$compte" },
            "types": { "$push": { "type": "$_id.type", "compte": "$compte" } },
        }},
        doc! { "$sort": { "compte": -1, "_id": 1 } },
    ];

    let mut curseur = db
        .collection::<Document>(collection)
        .aggregate(pipeline)
        .await
        .map_err(|e| traduire(&e))?;

    // Le dénominateur est le **nombre de documents échantillonnés**, pas la somme des champs :
    // diviser par la seconde donnerait des fractions qui ne veulent rien dire.
    let echantillon = db
        .collection::<Document>(collection)
        .aggregate(vec![
            doc! { "$sample": { "size": TAILLE_DE_L_ECHANTILLON } },
            doc! { "$count": "n" },
        ])
        .await
        .map_err(|e| traduire(&e))?;
    let total = premier_compte(echantillon).await.max(1);

    let mut champs = Vec::new();
    use futures_util::StreamExt;
    while let Some(ligne) = curseur.next().await {
        let ligne = ligne.map_err(|e| traduire(&e))?;
        let nom = match ligne.get("_id") {
            Some(Bson::String(nom)) => nom.clone(),
            _ => continue,
        };
        let compte = nombre_de(&ligne, "compte").unwrap_or(0);
        let types = types_du_champ(&ligne);
        champs.push((nom, compte, types));
    }

    // `_id` en premier : c'est la clé, et une collection l'a toujours. Le reste par fréquence
    // décroissante — ce que le `$sort` du pipeline donne déjà, et qui met en tête les champs qui
    // décrivent la collection plutôt que ses exceptions.
    champs.sort_by_key(|(nom, _, _)| (nom != "_id", 0));

    Ok(champs
        .into_iter()
        .enumerate()
        .map(|(rang, (nom, compte, types))| {
            let (majoritaire, natif) = types;
            ColumnInfo {
                position: u32::try_from(rang + 1).unwrap_or(0),
                // **`_id` n'est jamais nul et jamais absent** : MongoDB l'impose. Les autres champs
                // sont tous facultatifs — il n'y a pas de `NOT NULL` dans une collection.
                nullable: nom != "_id",
                key: if nom == "_id" {
                    Some(crate::engine::KeyKind::Primary)
                } else {
                    None
                },
                name: nom,
                category: categorie(&majoritaire),
                type_name: natif,
                default: None,
                identity: None,
                comment: None,
                frequency: Some((compte as f32 / total as f32).min(1.0)),
            }
        })
        .collect())
}

/// Le type majoritaire d'un champ, et son nom natif — qui dit s'il y en a plusieurs.
///
/// **Le majoritaire, et le nom qui dit les autres** : une collection réelle porte des champs
/// hétérogènes, `montant` en `int` dans les anciens documents et en `decimal` dans les récents.
/// Choisir silencieusement le premier vu ferait croire à une collection homogène — exactement ce
/// qu'une migration à moitié faite produit, et exactement ce qu'on veut voir.
///
/// La **catégorie**, elle, reste unique : elle décide du glyphe et de l'alignement (`06a`).
fn types_du_champ(ligne: &Document) -> (String, String) {
    let mut par_frequence: Vec<(String, i64)> = ligne
        .get_array("types")
        .map(|types| {
            types
                .iter()
                .filter_map(|t| t.as_document())
                .map(|t| {
                    (
                        t.get_str("type").unwrap_or("other").to_owned(),
                        nombre_de(t, "compte").unwrap_or(0),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    par_frequence.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let majoritaire = par_frequence
        .first()
        .map(|(nom, _)| nom.clone())
        .unwrap_or_else(|| "other".to_owned());
    let natif = par_frequence
        .iter()
        .map(|(nom, _)| nom.as_str())
        .collect::<Vec<_>>()
        .join(" | ");
    (majoritaire, natif)
}

/// Le premier `count` d'un curseur d'agrégation, ou zéro.
async fn premier_compte(mut curseur: mongodb::Cursor<Document>) -> i64 {
    use futures_util::StreamExt;
    match curseur.next().await {
        Some(Ok(ligne)) => nombre_de(&ligne, "n").unwrap_or(0),
        _ => 0,
    }
}

/// Le lot d'un curseur rendu par `run_command` — `{ cursor: { firstBatch: [ … ] } }`.
///
/// **Un seul lot**, et c'est suffisant ici : `listCollections` et `listIndexes` rendent tout dans le
/// premier lot tant qu'on reste sous cent une entrées. Au-delà, il faudrait suivre le curseur — à
/// faire le jour où une base de test porte plus de cent collections, pas avant, et la limite est
/// nommée pour qu'on sache où chercher.
fn lot_de(reponse: &Document) -> Vec<Document> {
    reponse
        .get_document("cursor")
        .and_then(|c| c.get_array("firstBatch"))
        .map(|lot| {
            lot.iter()
                .filter_map(|d| d.as_document().cloned())
                .collect()
        })
        .unwrap_or_default()
}

/// Un entier d'un document, quelle que soit sa largeur BSON.
///
/// `collStats` rend ses compteurs tantôt en `int32`, tantôt en `int64`, tantôt en `double` selon la
/// taille — lire une seule largeur rendrait zéro sur les grandes collections.
fn nombre_de(document: &Document, cle: &str) -> Option<i64> {
    match document.get(cle)? {
        Bson::Int32(n) => Some(i64::from(*n)),
        Bson::Int64(n) => Some(*n),
        Bson::Double(x) => Some(*x as i64),
        _ => None,
    }
}

/// Les collections que MongoDB tient pour lui : `system.views`, `system.profile`, etc.
///
/// Constaté sur le décor de test : `system.views` apparaît dès qu'une vue existe, et l'afficher
/// mettrait une entrée de plomberie au milieu des collections de l'utilisateur.
fn est_interne(nom: &str) -> bool {
    nom.starts_with("system.")
}

/// Un fragment BSON rendu lisible, pour une définition de contrainte ou une clé d'index.
fn json_lisible(valeur: &Bson) -> String {
    valeur.clone().into_relaxed_extjson().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn les_bases_de_service_sont_ecartees() {
        assert!(est_interne("system.views"));
        assert!(est_interne("system.profile"));
        assert!(!est_interne("commandes"));
        // Un nom qui *contient* « system » sans en être une : l'écarter serait cacher une
        // collection de l'utilisateur.
        assert!(!est_interne("filesystem_events"));
    }

    #[test]
    fn un_compteur_se_lit_quelle_que_soit_sa_largeur() {
        // `collStats` change de largeur selon la taille : lire une seule forme rendrait zéro sur
        // les grandes collections, c'est-à-dire exactement là où le compte importe.
        assert_eq!(nombre_de(&doc! { "n": 3i32 }, "n"), Some(3));
        assert_eq!(nombre_de(&doc! { "n": 3i64 }, "n"), Some(3));
        assert_eq!(nombre_de(&doc! { "n": 3.0f64 }, "n"), Some(3));
        assert_eq!(nombre_de(&doc! { "n": "trois" }, "n"), None);
    }

    #[test]
    fn le_type_majoritaire_gagne_et_le_nom_natif_dit_les_autres() {
        let ligne = doc! {
            "_id": "montant",
            "compte": 5i32,
            "types": [
                { "type": "int", "compte": 2i32 },
                { "type": "decimal", "compte": 3i32 },
            ],
        };
        let (majoritaire, natif) = types_du_champ(&ligne);
        assert_eq!(majoritaire, "decimal", "trois décimaux contre deux entiers");
        // **Le nom natif dit les deux** : une colonne annoncée « decimal » seule ferait croire à
        // une collection homogène, et c'est ce qu'une migration à moitié faite produit.
        assert_eq!(natif, "decimal | int");
    }

    #[test]
    fn un_champ_homogene_ne_porte_pas_de_barre() {
        let ligne = doc! {
            "_id": "statut",
            "compte": 5i32,
            "types": [{ "type": "string", "compte": 5i32 }],
        };
        assert_eq!(types_du_champ(&ligne), ("string".into(), "string".into()));
    }

    #[test]
    fn le_lot_d_un_curseur_vide_ne_panique_pas() {
        assert!(lot_de(&doc! {}).is_empty());
        assert!(lot_de(&doc! { "cursor": { "firstBatch": [] } }).is_empty());
    }
}
