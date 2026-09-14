//! Que la surface de permissions Tauri reste **minimale et explicite**.
//!
//! `01` a réduit les permissions de 92 (le jeu par défaut) à six, délibérément. Rien ne
//! gardait ce choix : ajouter `dialog:default` pour un seul sélecteur de fichier aurait
//! ouvert au passage la sauvegarde, les messages et la confirmation — sans qu'aucune
//! vérification ne le remarque.
//!
//! Ce test est en `tests/` et non dans la bibliothèque : il lit un fichier de configuration,
//! pas du code, et n'a aucune raison d'être compilé dans le binaire livré.

use std::collections::BTreeSet;

/// Les permissions attendues, une par ligne, avec la raison de chacune.
///
/// **Modifier cette liste est le geste qui doit être délibéré.** Un ajout ici est visible en
/// revue ; un ajout dans `capabilities/default.json` seul fait échouer ce test.
const ATTENDUES: &[(&str, &str)] = &[
    (
        "core:path:default",
        "résoudre le répertoire de configuration (05b)",
    ),
    ("core:event:default", "les événements de fenêtre"),
    ("core:window:default", "la fenêtre elle-même"),
    ("core:webview:default", "la webview"),
    ("core:app:default", "les métadonnées de l'application"),
    ("core:resources:default", "les ressources embarquées"),
    (
        "core:window:allow-start-dragging",
        "déplacer la fenêtre par sa barre de titre (`data-tauri-drag-region`) — `core:window:default` \
         n'accorde aucune permission d'écriture, et l'attribut seul ne suffisait donc pas",
    ),
    (
        "dialog:allow-open",
        "le bouton « Parcourir… » de la clé privée (08c) — ouverture seule",
    ),
    (
        "dialog:allow-save",
        "le sélecteur de destination du dump (22b) — sauvegarde seule, pas `dialog:default`",
    ),
    (
        "log:allow-log",
        "les journaux du front, qui rendent le pont IPC observable (08d) — `log` seul",
    ),
    // --- Windows seulement, depuis le 31 août 2026 (`capabilities/windows.json`) ---
    //
    // **Ces quatre-là n'existent pas sur macOS**, et c'est la raison du second fichier. La
    // capacité porte `"platforms": ["windows"]`, donc la surface macOS reste à dix — celle que
    // `01` a réduite de 92 à six, et que ce test garde. Une capacité sans ce champ aurait
    // accordé quatre droits d'écriture sur la fenêtre à une plateforme qui n'en a pas l'usage.
    //
    // Elles sont nécessaires parce que `decorations: false` retire les boutons du système : ce
    // sont les nôtres qui les remplacent, et `core:window:default` n'accorde **aucune**
    // permission d'écriture (0 des 42, relevé au plan `01`).
    (
        "core:window:allow-minimize",
        "le bouton de réduction de `TitleBar`, sous Windows",
    ),
    (
        "core:window:allow-toggle-maximize",
        "le bouton d'agrandissement / restauration — une seule bascule plutôt que \
         `allow-maximize` **et** `allow-unmaximize`, qui feraient deux permissions pour un bouton",
    ),
    (
        "core:window:allow-close",
        "le bouton de fermeture. `⌘W`/`Alt+F4` passent par le menu natif, qui est du Rust et \
         n'a besoin d'aucune capacité — celle-ci ne sert qu'au bouton de la webview",
    ),
    (
        "core:window:allow-is-maximized",
        "choisir le glyphe du bouton central : carré quand la fenêtre est normale, deux carrés \
         décalés quand elle est agrandie. Sans lui le bouton mentirait sur ce qu'il va faire",
    ),
];

/// Les deux fichiers de capacités, et pourquoi il y en a deux.
///
/// `default.json` vaut partout ; `windows.json` porte `"platforms": ["windows"]` et n'accorde
/// donc rien sur macOS. Les lire tous les deux est ce qui fait que `ATTENDUES` reste la liste
/// **complète** du projet : un fichier de capacités qu'aucun test ne lit serait exactement
/// l'angle mort que ce test existe pour fermer.
const FICHIERS: &[&str] = &["default.json", "windows.json"];

fn permissions_declarees() -> Vec<String> {
    let mut toutes = Vec::new();

    for fichier in FICHIERS {
        let chemin = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities"))
            .join(fichier);
        let brut = std::fs::read_to_string(&chemin)
            .unwrap_or_else(|_| panic!("capabilities/{fichier} doit être lisible"));
        let json: serde_json::Value = serde_json::from_str(&brut).expect("JSON valable");

        toutes.extend(
            json["permissions"]
                .as_array()
                .expect("le tableau `permissions`")
                .iter()
                .map(|valeur| {
                    valeur
                        .as_str()
                        .expect("les permissions de ce projet sont toutes des chaînes")
                        .to_owned()
                }),
        );
    }

    toutes
}

#[test]
fn la_liste_des_permissions_est_exactement_celle_qui_est_justifiee() {
    let declarees: BTreeSet<String> = permissions_declarees().into_iter().collect();
    let attendues: BTreeSet<String> = ATTENDUES.iter().map(|(nom, _)| (*nom).to_owned()).collect();

    let en_trop: Vec<_> = declarees.difference(&attendues).collect();
    let manquantes: Vec<_> = attendues.difference(&declarees).collect();

    assert!(
        en_trop.is_empty(),
        "permission(s) non justifiée(s) : {en_trop:?} — ajoutez-la à ATTENDUES avec sa raison, \
         ou retirez-la de capabilities/default.json"
    );
    assert!(
        manquantes.is_empty(),
        "permission(s) manquante(s) : {manquantes:?}"
    );
}

/// Le cas précis que `08c` demande de refuser.
///
/// Le sélecteur de fichier n'a besoin que de l'**ouverture**. `dialog:default` accorde aussi
/// `allow-save`, `allow-message`, `allow-ask` et `allow-confirm` : quatre capacités que rien
/// dans le produit ne réclame, dont une qui écrit sur le disque.
#[test]
fn aucune_permission_par_defaut_de_plugin_n_est_prise() {
    for permission in permissions_declarees() {
        let est_core = permission.starts_with("core:");
        let est_defaut = permission.ends_with(":default");
        assert!(
            est_core || !est_defaut,
            "« {permission} » prend le jeu par défaut d'un plugin. Nommez les capacités une \
             par une — `dialog:allow-open` plutôt que `dialog:default`."
        );
    }
}

/// **Les capacités Windows ne doivent rien accorder à macOS.**
///
/// C'est ce qui fait que la surface macOS reste à dix permissions alors que le projet en
/// déclare quatorze. La garantie tient à un seul champ, `"platforms"`, et rien ne la gardait :
/// l'oublier n'aurait produit aucune erreur — Tauri accorde alors la capacité **partout** —, et
/// un bundle macOS aurait embarqué quatre droits d'écriture sur la fenêtre que rien n'appelle.
///
/// Sabotage vérifié le 31 août 2026 : en retirant `"platforms"` de `windows.json`, ce test
/// tombe et les trois autres restent verts.
#[test]
fn les_capacites_de_windows_sont_bornees_a_windows() {
    let chemin = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/windows.json");
    let brut =
        std::fs::read_to_string(chemin).expect("capabilities/windows.json doit être lisible");
    let json: serde_json::Value = serde_json::from_str(&brut).expect("JSON valable");

    let plateformes = json["platforms"].as_array().expect(
        "`platforms` doit être déclaré : sans lui, Tauri accorde la capacité sur **toutes** les \
         plateformes, et macOS reçoit quatre permissions d'écriture sur la fenêtre dont il n'a \
         aucun usage (ses boutons sont dessinés par le système)",
    );

    let noms: Vec<&str> = plateformes.iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(
        noms,
        vec!["windows"],
        "`platforms` doit valoir exactement [\"windows\"] — la casse compte, `Target` de \
         tauri-utils sérialise « windows » en minuscules et « macOS » avec une majuscule"
    );
}

#[test]
fn la_surface_reste_tres_inferieure_au_jeu_par_defaut_de_tauri() {
    // 92 permissions dans le jeu par défaut, relevé au plan `01`. Le chiffre exact importe
    // moins que l'ordre de grandeur : ce test attrape une dérive lente.
    //
    // **Le plafond est passé de 12 à 15 le 31 août 2026**, pour les quatre boutons de fenêtre de
    // Windows, puis **redescendu à 14 le 14 septembre 2026** : `API-57` retire tout zoom global,
    // donc `core:webview:allow-set-webview-zoom` avec lui. C'est le geste que ce test veut rendre
    // délibéré, et il l'a été dans les deux sens : lever un plafond se voit en revue, et le
    // **baisser** est ce qui fait qu'un retour du zoom devra se justifier ici. À noter que **dix
    // de ces quatorze seulement s'appliquent à macOS** — les quatre autres portent
    // `"platforms": ["windows"]`.
    let compte = permissions_declarees().len();
    assert!(
        compte <= 14,
        "{compte} permissions : la surface dérive (six au plan 01, sept depuis 08c, huit depuis \
         10g, quinze depuis les boutons de fenêtre de Windows, quatorze depuis `API-57`)"
    );
}
