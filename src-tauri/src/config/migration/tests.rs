//! Les tests du cran v6 → v7 (#164), sur une vraie configuration v6.
//!
//! **La fixture est écrite à la main**, pas sérialisée depuis le modèle : ce qu'il faut vérifier est
//! la lecture d'un fichier que la v7 ne saura plus écrire. Elle est composée depuis le décor de
//! `demo.tsx`, et elle est **irrégulière exprès** (règle n° 5) — une connexion dont le mot de passe
//! n'est pas rangé sous son triplet, deux connexions homonymes dans deux environnements, une requête
//! en transit homonyme d'une console, un projet sans connexion.

use super::v6::{reference_v6 as reference_de, PlanDeSecrets};
use super::{migrer_vers_la_v7, DocumentV7};
use crate::config::arbre::{
    reference_de_connexion, ConnectionId, Folder, FolderColor, FolderTree, LectureSeule,
};
use crate::config::model::{Proxy, SecretRef, Theme};

const FIXTURE_V6: &str = include_str!("../../../tests/fixtures/config-v6.json");

fn fixture() -> serde_json::Value {
    serde_json::from_str(FIXTURE_V6).expect("fixture v6 lisible")
}

fn migrer(valeur: serde_json::Value, depuis: u32) -> DocumentV7 {
    migrer_vers_la_v7(valeur, depuis).expect("la migration doit aboutir")
}

fn migrer_la_fixture() -> DocumentV7 {
    migrer(fixture(), 6)
}

fn racine<'a>(arbre: &'a FolderTree, nom: &str) -> &'a Folder {
    arbre
        .folders
        .iter()
        .find(|dossier| dossier.name == nom)
        .unwrap_or_else(|| panic!("dossier racine « {nom} »"))
}

fn sous_dossier<'a>(dossier: &'a Folder, nom: &str) -> &'a Folder {
    dossier
        .folders
        .iter()
        .find(|enfant| enfant.name == nom)
        .unwrap_or_else(|| panic!("sous-dossier « {nom} »"))
}

#[test]
fn une_configuration_v6_reelle_se_relit_en_v7_sans_perte() {
    let document = migrer_la_fixture();
    let arbre = &document.arbre;
    assert_eq!(arbre.valider(), Ok(()));

    // Un dossier racine par projet, dans l'ordre du fichier, et rien à la racine.
    let noms: Vec<&str> = arbre.folders.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(noms, ["Atelier Nord", "Outils internes"]);
    assert!(arbre.connections.is_empty());
    for dossier in &arbre.folders {
        assert_eq!(dossier.color, None, "{}", dossier.name);
        assert!(!dossier.read_only, "{}", dossier.name);
    }

    // Les environnements deviennent des sous-dossiers, **dans l'ordre déclaré** — pas trié.
    let nord = racine(arbre, "Atelier Nord");
    let sous: Vec<(&str, Option<FolderColor>, bool)> = nord
        .folders
        .iter()
        .map(|d| (d.name.as_str(), d.color, d.read_only))
        .collect();
    assert_eq!(
        sous,
        [
            ("dev", Some(FolderColor::Green), false),
            ("preprod", Some(FolderColor::Violet), false),
            ("staging", Some(FolderColor::Amber), false),
            ("prod", Some(FolderColor::Red), true),
        ]
    );

    // Les quatre connexions, chacune dans le dossier de son environnement.
    assert_eq!(arbre.connexions().count(), 4);
    let comptes: Vec<usize> = nord.folders.iter().map(|d| d.connections.len()).collect();
    assert_eq!(comptes, [1, 0, 1, 2]);
    assert!(nord.connections.is_empty(), "aucune connexion orpheline");

    // Ce que porte chaque connexion traverse tel quel.
    let prod = sous_dossier(nord, "prod");
    let analytics = &prod.connections[0];
    assert_eq!(analytics.name, "analytics");
    assert_eq!(analytics.label.as_deref(), Some("Catalogue"));
    assert_eq!(analytics.visible_schemas, Some(vec!["public".to_owned()]));
    assert_eq!(analytics.connection.host, "db.interne");
    let consoles: Vec<&str> = analytics.consoles.iter().map(|c| c.name.as_str()).collect();
    // La console d'origine, puis la requête en transit homonyme, versée sous un nom repris.
    assert_eq!(consoles, ["CA par jour", "CA par jour (reprise)"]);
    assert_eq!(prod.connections[1].name, "evenements");

    let entrepot = &sous_dossier(nord, "staging").connections[0];
    match &entrepot.connection.tunnel.as_ref().expect("tunnel").proxy {
        Proxy::Kubernetes(proxy) => {
            assert_eq!(
                proxy.kubeconfig.as_ref().map(|k| k.as_str()),
                Some("staging")
            );
            assert_eq!(proxy.resource, "svc/postgres");
        }
        autre => panic!("un transfert Kubernetes était attendu : {autre:?}"),
    }

    // Les libellés de valeurs vivent sur le dossier racine, et toutes ses connexions les lisent.
    assert_eq!(
        nord.value_labels["orders"]["status"]
            .get("3")
            .map(String::as_str),
        Some("expédiée")
    );
    assert!(arbre.libelles_de(&entrepot.id, "orders").is_some());
    assert!(
        nord.queries.is_empty(),
        "les requêtes ont trouvé une connexion"
    );

    // Ce qui entoure les projets passe tel quel.
    assert_eq!(document.preferences.theme, Theme::Nuit);
    assert_eq!(document.preferences.row_height, 24);
    assert_eq!(document.instances.len(), 1);
    assert_eq!(
        document.instances[0].connection.password,
        Some(SecretRef::new("instance/serveur-central"))
    );
    assert_eq!(
        document.kubeconfigs.default.as_ref().map(|k| k.as_str()),
        Some("staging")
    );
    assert_eq!(document.kubeconfigs.declarations.len(), 1);
}

#[test]
fn l_environnement_de_production_arrive_en_lecture_seule() {
    let document = migrer_la_fixture();
    let nord = racine(&document.arbre, "Atelier Nord");
    let prod = sous_dossier(nord, "prod");
    assert!(prod.read_only);
    assert!(!sous_dossier(nord, "staging").read_only);

    // Le réglage **local** de la connexion n'est pas touché : il valait `false`, et c'est le dossier
    // qui impose — lever la lecture seule du dossier rendra à la connexion ce choix-là.
    let analytics = &prod.connections[0];
    assert!(!analytics.connection.read_only);
    assert_eq!(
        document.arbre.lecture_seule_effective(&analytics.id),
        Some(LectureSeule::Imposee {
            dossiers: vec![prod.id.clone()]
        })
    );
    // Et une connexion déjà en lecture seule locale le reste, sous le même dossier.
    assert!(prod.connections[1].connection.read_only);
}

#[test]
fn deux_migrations_du_meme_document_rendent_les_memes_identifiants() {
    let premier = migrer_la_fixture();
    let second = migrer_la_fixture();
    // **Octet pour octet** : c'est ce qui rend la migration rejouable tant que rien ne l'a écrite.
    assert_eq!(
        serde_json::to_string(&premier.arbre).expect("sérialisable"),
        serde_json::to_string(&second.arbre).expect("sérialisable")
    );
    assert_eq!(premier.secrets_a_deplacer, second.secrets_a_deplacer);
    // Et les identifiants ont la forme attendue — seize chiffres hexadécimaux.
    for (base, _) in premier.arbre.connexions() {
        assert_eq!(base.id.as_str().len(), 16, "{}", base.id);
        assert!(base.id.as_str().bytes().all(|o| o.is_ascii_hexdigit()));
    }
}

#[test]
fn les_deux_analytics_homonymes_recoivent_deux_identifiants() {
    let document = migrer_la_fixture();
    let nord = racine(&document.arbre, "Atelier Nord");
    let dev = &sous_dossier(nord, "dev").connections[0];
    let prod = &sous_dossier(nord, "prod").connections[0];
    assert_eq!(dev.name, prod.name);
    assert_ne!(dev.id, prod.id);
}

#[test]
fn le_plan_part_de_la_reference_stockee_et_non_du_triplet() {
    let document = migrer_la_fixture();
    let nord = racine(&document.arbre, "Atelier Nord");
    let dev = &sous_dossier(nord, "dev").connections[0];

    let PlanDeSecrets(couples) = &document.secrets_a_deplacer;
    // Trois mots de passe déclarés parmi les quatre connexions ; celui de l'instance n'est pas
    // concerné, sa référence ne dépend d'aucun triplet.
    assert_eq!(couples.len(), 3);
    assert!(couples
        .iter()
        .all(|(ancienne, _)| !ancienne.as_str().starts_with("instance/")));

    let pour_dev: Vec<&SecretRef> = couples
        .iter()
        .filter(|(_, nouvelle)| nouvelle == &reference_de_connexion(&dev.id))
        .map(|(ancienne, _)| ancienne)
        .collect();
    // **La référence écrite dans le fichier**, laissée par un ancien nom de projet — et non celle que
    // le triplet recalculerait, sous laquelle le magasin n'a rien.
    assert_eq!(pour_dev, [&SecretRef::new("Ancien Nord/analytics/dev")]);
    assert_ne!(
        pour_dev[0],
        &reference_de("Atelier Nord", "analytics", "dev"),
        "le décor doit distinguer la référence stockée du triplet"
    );
}

#[test]
fn chaque_mot_de_passe_passe_sous_sa_nouvelle_reference() {
    let document = migrer_la_fixture();
    for (base, _) in document.arbre.connexions() {
        if let Some(reference) = &base.connection.password {
            assert_eq!(
                reference,
                &reference_de_connexion(&base.id),
                "{}",
                base.name
            );
        }
    }
    // Une connexion sans mot de passe n'en reçoit pas.
    let nord = racine(&document.arbre, "Atelier Nord");
    assert_eq!(
        sous_dossier(nord, "prod").connections[1]
            .connection
            .password,
        None
    );
}

#[test]
fn un_projet_sans_connexion_garde_ses_requetes_dans_son_dossier_racine() {
    let document = migrer_la_fixture();
    let outils = racine(&document.arbre, "Outils internes");
    let requetes: Vec<&str> = outils.queries.iter().map(|q| q.name.as_str()).collect();
    assert_eq!(requetes, ["Inventaire"]);
    // Ses environnements deviennent des sous-dossiers vides — et `prod` y est en lecture seule.
    let sous: Vec<(&str, bool)> = outils
        .folders
        .iter()
        .map(|d| (d.name.as_str(), d.read_only))
        .collect();
    assert_eq!(sous, [("dev", false), ("prod", true)]);
}

/// Un projet v6 minimal, pour les cas que la fixture ne porte pas.
fn projet(
    nom: &str,
    environnements: serde_json::Value,
    bases: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "name": nom,
        "environments": environnements,
        "databases": bases,
    })
}

fn base(nom: &str, environnement: &str, mot_de_passe: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "name": nom,
        "engine": "postgresql",
        "environment": environnement,
        "connection": {
            "host": "localhost", "port": 5432, "defaultDatabase": nom, "username": "dora",
            "password": mot_de_passe, "sslMode": "verify-full", "readOnly": false,
            "reconnectOnStartup": false, "tunnel": null
        }
    })
}

fn document(projets: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({ "version": 6, "projects": projets })
}

#[test]
fn deux_libelles_d_environnement_egaux_se_distinguent_par_leur_identifiant() {
    let doc = document(vec![projet(
        "Halle",
        serde_json::json!([
            { "id": "prod", "label": "prod", "color": "red", "production": true },
            { "id": "prod-eu", "label": "prod", "color": "violet", "production": true },
        ]),
        serde_json::json!([]),
    )]);
    let migre = migrer(doc, 6);
    let noms: Vec<&str> = migre.arbre.folders[0]
        .folders
        .iter()
        .map(|d| d.name.as_str())
        .collect();
    assert_eq!(noms, ["prod", "prod (prod-eu)"]);
    assert_eq!(migre.arbre.valider(), Ok(()));
}

#[test]
fn deux_projets_homonymes_ecrits_a_la_main_restent_distincts() {
    // Le cas qu'un fichier écrit à la main peut seul produire : les identifiants dérivés
    // coïncideraient, et le rang les sépare ; les noms aussi, sans quoi `valider` refuserait.
    let environnements =
        serde_json::json!([{ "id": "dev", "label": "dev", "color": "green", "production": false }]);
    let doc = document(vec![
        projet(
            "Halle",
            environnements.clone(),
            serde_json::json!([base("a", "dev", None)]),
        ),
        projet(
            "Halle",
            environnements,
            serde_json::json!([base("a", "dev", None)]),
        ),
    ]);
    let migre = migrer(doc, 6);
    let racines = &migre.arbre.folders;
    assert_ne!(racines[0].id, racines[1].id);
    assert_eq!(racines[0].name, "Halle");
    assert_ne!(racines[1].name, "Halle");
    assert_ne!(
        racines[0].folders[0].connections[0].id,
        racines[1].folders[0].connections[0].id
    );
    assert_eq!(migre.arbre.valider(), Ok(()));
}

#[test]
fn une_connexion_d_un_environnement_non_declare_n_est_pas_perdue() {
    let doc = document(vec![projet(
        "Halle",
        serde_json::json!([{ "id": "dev", "label": "dev", "color": "green", "production": false }]),
        serde_json::json!([base("fantome", "inconnu", None)]),
    )]);
    let migre = migrer(doc, 6);
    let halle = &migre.arbre.folders[0];
    assert_eq!(halle.connections.len(), 1, "rangée dans le dossier racine");
    assert_eq!(halle.connections[0].name, "fantome");
}

#[test]
fn deux_bases_au_meme_triplet_partagent_leur_ancienne_reference() {
    // `a/b` › `c` et `a` › `b/c` composent le même triplet : deux couples, une même ancienne
    // référence, deux nouvelles — c'est le déplacement de #165 qui dédoublonne les effacements.
    let environnement =
        serde_json::json!([{ "id": "dev", "label": "dev", "color": "green", "production": false }]);
    let doc = document(vec![
        projet(
            "a/b",
            environnement.clone(),
            serde_json::json!([base("c", "dev", Some("a/b/c/dev"))]),
        ),
        projet(
            "a",
            environnement,
            serde_json::json!([base("b/c", "dev", Some("a/b/c/dev"))]),
        ),
    ]);
    let migre = migrer(doc, 6);
    let couples = migre.secrets_a_deplacer.couples();
    assert_eq!(couples.len(), 2);
    assert_eq!(couples[0].0, couples[1].0);
    assert_ne!(couples[0].1, couples[1].1);
}

#[test]
fn une_v1_traverse_toute_la_chaine_jusqu_a_la_v7() {
    let v1 = serde_json::json!({
        "version": 1,
        "projects": [{
            "name": "Halle",
            "activeEnvironment": "prod",
            "databases": [{
                "name": "analytics",
                "engine": "postgresql",
                "variants": [{
                    "environment": "prod",
                    "host": "prod.interne", "port": 5432, "defaultDatabase": "analytics",
                    "username": "dora", "password": "Halle/analytics/prod",
                    "sslMode": "verify-full", "readOnly": false, "reconnectOnStartup": false,
                    "tunnel": null
                }]
            }]
        }]
    });
    let migre = migrer(v1, 1);
    let prod = &migre.arbre.folders[0].folders[0];
    assert_eq!(prod.name, "prod");
    assert!(
        prod.read_only,
        "la v1 déduisait déjà `production` de l'identifiant « prod »"
    );
    assert_eq!(
        migre.secrets_a_deplacer.couples()[0].0,
        SecretRef::new("Halle/analytics/prod")
    );
    assert!(!migre.secrets_a_deplacer.est_vide());
}

#[test]
fn une_version_sans_cran_est_refusee() {
    let mut doc = fixture();
    doc["version"] = serde_json::json!(7);
    let erreur = migrer_vers_la_v7(doc, 7).expect_err("aucun cran ne part de la v7");
    assert!(erreur.contains("aucune migration connue"), "{erreur}");
}

#[test]
fn un_arbre_migre_qui_garderait_l_ancienne_reference_serait_refuse() {
    // Ce que `valider` attrape si le cran oubliait de réécrire une référence : l'arbre migré, une
    // référence remise sur son triplet.
    let mut document = migrer_la_fixture();
    let id: ConnectionId = document
        .arbre
        .connexions()
        .find(|(base, _)| base.connection.password.is_some())
        .map(|(base, _)| base.id.clone())
        .expect("une connexion à mot de passe");
    document
        .arbre
        .connexion_mut(&id)
        .expect("connue")
        .connection
        .password = Some(SecretRef::new("Atelier Nord/analytics/prod"));
    assert!(document.arbre.valider().is_err());
}

#[test]
fn la_fixture_v6_se_lit_par_le_chargement_en_arbre_avec_sa_migration_en_attente() {
    // Depuis #165, `VERSION_COURANTE` vaut 7 : le chargement lit la fixture v6 en arbre, sans rien
    // écrire, et rend le plan des mots de passe à déplacer — c'est `ConfigStore::ouvrir` qui
    // l'achève.
    let dossier = tempfile::tempdir().expect("dossier temporaire");
    let chemin = dossier.path().join("config.json");
    std::fs::write(&chemin, FIXTURE_V6).expect("écriture de la fixture");
    match crate::config::load(&chemin) {
        crate::config::LoadOutcome::Loaded {
            tree,
            migration: Some(migration),
            ..
        } => {
            assert_eq!(tree.folders.len(), 2);
            assert_eq!(migration.depuis, 6);
            assert!(!migration.secrets.est_vide());
            assert!(tree.valider().is_ok());
        }
        autre => panic!("la fixture devait se lire, migration en attente : {autre:?}"),
    }
    assert_eq!(
        std::fs::read_to_string(&chemin).expect("relecture"),
        FIXTURE_V6,
        "le chargement seul n'écrit rien"
    );
}
