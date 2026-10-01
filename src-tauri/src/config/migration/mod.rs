//! La chaîne de migration du format de configuration.
//!
//! **Sortie de `store.rs` le jour où il a fallu deux formes typées côte à côte** (#164) — c'est le
//! « déclencheur du découpage » que `CLAUDE.md` annonçait : la v1, que `v1.rs` décrit encore parce
//! que la migration v1 → v2 s'en sert pour déduire les environnements déclarés, et la v6, que
//! `v6.rs` fige parce que le cran v6 → v7 connaît la structure qui entoure ce qu'il change.
//!
//! # Les étages
//!
//! ```text
//! crans sur Value (< 3, < 4, < 6)
//!   → 0 | 1  : v1 → v2, qui rend la forme v6 (`v1::vers_v2`)
//!   → 2..=6  : relecture en `v6::Fichier`
//!   → v6 → v7 (`v6::vers_v7`), sur des types et non sur du JSON
//! ```
//!
//! **Une seule sortie** depuis #165 : [`migrer_vers_la_v7`], qui rend l'arbre de dossiers et le plan
//! des mots de passe à déplacer. [`document_v6`] est la chaîne jusqu'à la v6, qu'elle compose.
//!
//! **Le fichier de transfert (`API-30`) passe par la même chaîne** depuis #169 :
//! [`arbre_du_document`] la compose pour une enveloppe antérieure à la v7.

use super::arbre::FolderTree;
use super::model::{Kubeconfigs, ManagedInstance, Preferences};

/// Le déplacement des mots de passe, l'autre moitié du cran v7 (#165).
pub(crate) mod secrets;
#[cfg(test)]
mod tests;
pub(crate) mod v1;
pub(crate) mod v6;

pub(crate) use v6::PlanDeSecrets;

/// Le document v6, tel que la chaîne le rend avant toute conversion : le point commun des deux
/// sorties.
///
/// Les crans sur `Value` passent d'abord, puis la relecture typée. **`2..=6` et non `2..=5`** : la v6
/// se relit ici *parce que* le cran v6 → v7 existe (`v6::vers_v7`), et non par élargissement d'une
/// borne — la règle n° 16 qu'a posée le cran v5 → v6. Un fichier postérieur tombe sur « aucune
/// migration connue ».
pub(crate) fn document_v6(
    mut valeur: serde_json::Value,
    depuis: u32,
) -> Result<v6::Fichier, String> {
    // **Le cran du proxy passe en premier, et il est le seul à travailler sur le JSON.** `05d`
    // remplace un tunnel plat par `{ localPort, proxy }` partout où un tunnel apparaît ; il ne
    // connaît ni les projets, ni les bases, ni les environnements. L'appliquer d'abord, sur la
    // valeur déjà analysée par `load`, évite de l'écrire deux fois — une pour la forme v1, qui
    // porte des variantes, une pour la v2, qui porte des connexions. Les crans suivants ne le
    // voient donc pas, et `v1::vers_v2` n'a rien à en savoir.
    if depuis < 3 {
        hisser_les_tunnels_vers_le_proxy(&mut valeur);
    }
    // v3 → v4 (`06j`) : même patron, même raison — un cran qui ne connaît ni les projets, ni
    // les bases, et qui s'applique avant les crans à types dédiés.
    if depuis < 4 {
        retirer_les_comptes_de_service(&mut valeur);
    }
    // v5 → v6 (`API-70`) : même patron que les deux crans ci-dessus — il ne connaît ni les projets,
    // ni les bases, seulement la forme d'un proxy Kubernetes, et il s'applique avant les crans à
    // types dédiés. Il est le premier à **rendre** quelque chose : les déclarations qu'il a créées
    // ne sont pas dans le document d'origine, donc rien ne pourrait les relire après coup.
    let declarees = (depuis < 6).then(|| declarer_les_kubeconfigs(&mut valeur));
    let brut_migre = valeur.to_string();

    // v0 → v1 : la v0 n'a jamais été diffusée, sa forme est celle de la v1.
    // v1 → v2 : `23a`/`23b`. La chaîne est écrite pour se composer — une v1 lue depuis une v0 passe
    // ensuite par le même bras que si elle venait du disque.
    // v2 → v3 : `05d`, déjà appliqué ci-dessus ; il ne reste qu'à lire la forme courante.
    // v3 → v4 : `06j`, de même.
    // v4 → v5 : `25c` **ne transforme rien** — `activeEnvironment` disparaît du modèle, et `serde`
    // ignore un champ qu'il ne connaît pas. Relire suffit ; le champ ne sera simplement pas réécrit.
    // v5 → v6 : `API-70`, appliqué ci-dessus sur le JSON.
    // v6 → v7 : #164, **après** cette relecture et sur des types — voir `v6::vers_v7`.
    let migre = match depuis {
        0 | 1 => v1::vers_v2(&brut_migre),
        // `2..=6` et non `2 | 3 | 4 | 5 | 6` : clippy refuse l'énumération d'entiers contigus.
        2..=6 => serde_json::from_str::<v6::Fichier>(&brut_migre),
        _ => {
            return Err(format!(
                "aucune migration connue depuis la version {depuis}"
            ));
        }
    };

    migre
        .map(|mut fichier| {
            // **Ce que le cran a déclaré l'emporte**, et il n'y a pas de conflit possible : il ne
            // tourne que pour `depuis < 6`, où le document ne portait aucune clé `kubeconfigs` à
            // relire. Un document déjà en v6 garde celles qu'il déclare.
            if let Some(declarees) = declarees {
                fichier.kubeconfigs = declarees;
            }
            fichier
        })
        .map_err(|erreur| format!("migration depuis la version {depuis} impossible : {erreur}"))
}

/// Ce qu'un document devient en v7 : l'arbre, ce qui l'accompagne, et les secrets à déplacer.
#[derive(Debug)]
pub(crate) struct DocumentV7 {
    pub arbre: FolderTree,
    pub preferences: Preferences,
    pub instances: Vec<ManagedInstance>,
    pub kubeconfigs: Kubeconfigs,
    /// Les couples `(ancienne, nouvelle)` de références de mots de passe — vide pour un document qui
    /// n'en déclarait aucun. C'est `load_config` (#165) qui les déplace, **avant** d'écrire la v7.
    pub secrets_a_deplacer: PlanDeSecrets,
}

/// La chaîne complète jusqu'à la v7 (#164), **branchée par #165** : `store::migrer` l'appelle pour
/// tout fichier antérieur à `VERSION_COURANTE`.
///
/// **La seule sortie de la chaîne.** Il y en eut deux le temps de la bascule — le modèle courant par
/// `migrer_le_document`, l'arbre par celle-ci ; la première est partie avec `Project`.
///
/// **L'arbre migré est validé**, en filet : ce que les refus nommés du cran ne couvrent pas — une
/// référence de secret restée sur l'ancien triplet, deux dossiers frères homonymes qu'un fichier
/// écrit à la main aurait produits — doit faire échouer la lecture plutôt qu'écrire une v7 fausse.
pub(crate) fn migrer_vers_la_v7(
    valeur: serde_json::Value,
    depuis: u32,
) -> Result<DocumentV7, String> {
    let fichier = document_v6(valeur, depuis)?;
    let (arbre, secrets_a_deplacer) = v6::vers_v7(fichier.projects);
    arbre
        .valider()
        .map_err(|erreur| format!("migration vers la version 7 impossible : {erreur}"))?;
    Ok(DocumentV7 {
        arbre,
        preferences: fichier.preferences,
        instances: fichier.instances,
        kubeconfigs: fichier.kubeconfigs,
        secrets_a_deplacer,
    })
}

/// Ce qu'un fichier de transfert antérieur à la v7 devient (#169) : l'arbre, le plan des mots de
/// passe, et les kubeconfigs que la chaîne a déclarés.
#[derive(Debug)]
pub(crate) struct TransfertV7 {
    pub arbre: FolderTree,
    /// Les couples `(ancienne, nouvelle)` : c'est par eux que `passwords` est **réindexé**, faute de
    /// quoi aucun mot de passe du fichier ne serait retrouvé sous la référence de sa connexion.
    pub secrets: PlanDeSecrets,
    /// Les déclarations que le cran v5 → v6 a créées. **Vides pour un fichier déjà en v6**, qui
    /// porte les siennes dans son enveloppe.
    pub kubeconfigs: Kubeconfigs,
}

/// La chaîne de migration, appliquée à l'enveloppe d'un fichier de transfert (#169).
///
/// **La même chaîne que la configuration, sans adaptateur** — c'est la décision d'`API-30` à ne pas
/// défaire : l'enveloppe porte `version` et `projects` à la racine, exactement comme un
/// `config.json` v6, donc les crans la lisent telle quelle.
///
/// **Une seule clé est retirée d'abord, `kubeconfigs`** : l'enveloppe la porte en **liste** de
/// déclarations, là où la configuration porte un objet `{ declarations, default }`. La laisser ferait
/// échouer la relecture v6 sur une forme qui n'est pas la sienne ; l'appelant la relit lui-même.
pub(crate) fn arbre_du_document(
    mut valeur: serde_json::Value,
    depuis: u32,
) -> Result<TransfertV7, String> {
    if let Some(objet) = valeur.as_object_mut() {
        objet.remove("kubeconfigs");
    }
    let document = migrer_vers_la_v7(valeur, depuis)?;
    Ok(TransfertV7 {
        arbre: document.arbre,
        secrets: document.secrets_a_deplacer,
        kubeconfigs: document.kubeconfigs,
    })
}

/// v5 → v6 (`API-70`) : un transfert Kubernetes porte une **référence** au lieu d'un chemin.
///
/// Relève chaque `kubeconfig` écrit dans un proxy Kubernetes, le déclare une fois — deux connexions
/// qui nommaient le même fichier partagent donc une déclaration, ce qui est tout l'objet du chantier
/// — et remplace le chemin par l'identifiant obtenu.
///
/// **Écrite sur du `serde_json::Value`, comme les deux crans précédents, et pour la même raison** :
/// un proxy Kubernetes apparaît sous une connexion de projet *et* sous une instance managée, et le
/// même document sert de fichier de transfert. Descendre l'arbre en cherchant les proxys plutôt
/// qu'en connaissant les chemins qui y mènent est la seule écriture qui ne se répète pas trois fois.
///
/// **Déterministe** : `serde_json::Map` est une `BTreeMap` — la crate n'active pas `preserve_order`
/// — donc l'ordre de visite est celui des clés, et celui des tableaux est le leur. Deux migrations
/// du même fichier rendent les mêmes identifiants, ce dont dépend le libellé attribué en cas de
/// collision.
///
/// **Pas idempotente, et elle n'a pas à l'être** : un second passage prendrait les identifiants
/// qu'elle vient d'écrire pour des chemins. C'est `depuis < 6` qui la garde, comme `depuis < 3`
/// garde le hissage des tunnels — lequel est idempotent par construction, non par précaution.
pub(crate) fn declarer_les_kubeconfigs(valeur: &mut serde_json::Value) -> Kubeconfigs {
    let mut kubeconfigs = Kubeconfigs::default();
    referencer_les_kubeconfigs(valeur, &mut kubeconfigs);
    kubeconfigs
}

fn referencer_les_kubeconfigs(valeur: &mut serde_json::Value, kubeconfigs: &mut Kubeconfigs) {
    match valeur {
        serde_json::Value::Object(objet) => {
            if objet.get("kind").and_then(serde_json::Value::as_str) == Some("kubernetes") {
                // **Une valeur blanche vaut absente**, comme partout ailleurs pour ce champ : la
                // déclarer poserait une entrée sans chemin dans la liste des préférences, que
                // `Kubeconfigs::valider` refuserait ensuite — donc une configuration migrée qui ne
                // se réécrit plus.
                let chemin = objet
                    .get("kubeconfig")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|chemin| !chemin.is_empty())
                    .map(str::to_owned);
                match chemin {
                    Some(chemin) => {
                        let id = kubeconfigs.declarer(&chemin);
                        objet.insert(
                            "kubeconfig".to_owned(),
                            serde_json::Value::from(id.as_str()),
                        );
                    }
                    None => {
                        objet.remove("kubeconfig");
                    }
                }
            }
            for (_, enfant) in objet.iter_mut() {
                referencer_les_kubeconfigs(enfant, kubeconfigs);
            }
        }
        serde_json::Value::Array(elements) => {
            for element in elements {
                referencer_les_kubeconfigs(element, kubeconfigs);
            }
        }
        _ => {}
    }
}

/// v2 → v3 (`05d`) : le tunnel plat devient `{ localPort, proxy: { kind: "ssh", … } }`.
///
/// **Purement structurelle, sans perte possible** : jusqu'à la v2, un tunnel ne pouvait décrire
/// qu'un bastion SSH — aucune autre sorte n'existait. L'étiquette est donc connue sans avoir à la
/// deviner.
///
/// **Écrite sur du `serde_json::Value`, et c'est ce qui la rend indépendante des autres crans.**
/// Un `mod v2` de types dédiés, comme `mod v1` en fait pour `23a`/`23b`, obligerait à décrire deux
/// fois la structure qui *entoure* le tunnel : une fois telle qu'elle est en v1, avec ses variantes,
/// une fois telle qu'elle est en v2, avec ses connexions. La forme du tunnel, elle, est la même dans
/// les deux. Descendre l'arbre en cherchant les `tunnel` plutôt qu'en connaissant le chemin qui y
/// mène est donc la seule écriture qui ne se répète pas.
///
/// **Cette fonction ne valide rien** : elle transforme ce qu'elle reconnaît, et laisse passer tel
/// quel ce qu'elle ne reconnaît pas (`tunnel` absent, `null`, ou déjà sous la forme v3 — reconnue à
/// sa clé `proxy`). C'est sûr uniquement parce que `migrer` désérialise le résultat juste après :
/// tout ce qu'elle n'a pas su remettre en forme y échouera et partira en quarantaine, jamais
/// silencieusement accepté.
pub(crate) fn hisser_les_tunnels_vers_le_proxy(valeur: &mut serde_json::Value) {
    match valeur {
        serde_json::Value::Object(objet) => {
            if let Some(tunnel) = objet.get_mut("tunnel") {
                // `null` est le cas courant — aucun tunnel déclaré : rien à faire, et c'est un
                // chemin couvert. Un objet portant déjà `proxy` est une v3 : laissée intacte, ce
                // qui rend la fonction idempotente.
                if let Some(plat) = tunnel.as_object_mut() {
                    if !plat.contains_key("proxy") {
                        let port_local =
                            plat.remove("localPort").unwrap_or(serde_json::Value::Null);
                        // `kind` valait déjà « ssh » avant la v3. Le réécrire explicitement rend la
                        // migration lisible sans connaître l'ancienne forme, et fait de lui
                        // l'étiquette du proxy — ce que `#[serde(tag = "kind")]` attend.
                        plat.insert("kind".to_owned(), serde_json::Value::from("ssh"));
                        let proxy = serde_json::Value::Object(std::mem::take(plat));
                        *tunnel = serde_json::json!({ "localPort": port_local, "proxy": proxy });
                    }
                }
            }
            for (_, enfant) in objet.iter_mut() {
                hisser_les_tunnels_vers_le_proxy(enfant);
            }
        }
        serde_json::Value::Array(elements) => {
            for element in elements {
                hisser_les_tunnels_vers_le_proxy(element);
            }
        }
        _ => {}
    }
}

/// v3 → v4 (`06j`) : le chemin de compte de service disparaît des proxys Cloud SQL.
///
/// **Pourquoi un cran, alors que `serde` ignore les clés inconnues.** Sans lui, un fichier v3
/// serait lu comme courant, la clé serait silencieusement perdue à la première écriture, et
/// aucune sauvegarde n'aurait été prise. Le cran existe pour deux effets, tous deux dans
/// `migrer` : la version du fichier finit par dire la vérité sur le modèle qu'il porte, et
/// l'original part dans `config.v3.bak` **avant** que la clé s'en aille. Un utilisateur qui
/// avait désigné un compte de service peut donc le retrouver ; sans ce cran, il n'aurait
/// nulle part où le chercher.
///
/// **Ce qui reste possible après ce retrait** : `GOOGLE_APPLICATION_CREDENTIALS`, que le
/// proxy lit de lui-même. Le retrait ferme un champ, pas une voie.
///
/// Même écriture que `hisser_les_tunnels_vers_le_proxy`, et pour la même raison : descendre
/// l'arbre en cherchant les proxys plutôt qu'en connaissant le chemin qui y mène évite de
/// décrire deux fois ce qui les entoure. Elle ne valide rien non plus — `migrer`
/// désérialise juste après, donc ce qu'elle laisserait mal formé part en quarantaine.
pub(crate) fn retirer_les_comptes_de_service(valeur: &mut serde_json::Value) {
    match valeur {
        serde_json::Value::Object(objet) => {
            // Uniquement sous un proxy Cloud SQL, reconnu à son étiquette. Retirer la clé
            // partout où elle porte ce nom marcherait aujourd'hui et deviendrait faux le jour
            // où un autre objet la porte pour une autre raison.
            if objet.get("kind").and_then(serde_json::Value::as_str) == Some("cloud-sql") {
                objet.remove("credentialsFilePath");
            }
            for (_, enfant) in objet.iter_mut() {
                retirer_les_comptes_de_service(enfant);
            }
        }
        serde_json::Value::Array(elements) => {
            for element in elements {
                retirer_les_comptes_de_service(element);
            }
        }
        _ => {}
    }
}
