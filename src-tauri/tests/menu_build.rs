//! Tests de `menu::build::construire` — la seule chose du projet qui construise un vrai
//! menu natif et puisse en inspecter le résultat.
//!
//! **`harness = false`** (déclaré dans `Cargo.toml`) : `tauri::test::mock_app()` appelle
//! muda pour de vrai, qui sur macOS exige d'être appelé depuis le thread principal du
//! **processus** (`MainThreadMarker::new()`, vérifié dans
//! `muda-0.19.3/src/platform_impl/macos/mod.rs`). Le harness `libtest` par défaut exécute
//! chaque `#[test]` sur un thread de travail qu'il spawn lui-même — jamais le vrai thread
//! principal, quel que soit `--test-threads`. Sans `harness = false`, les trois tests de ce
//! fichier paniqueraient systématiquement avec « can only be created on the main thread ».
//! Avec, `main()` ci-dessous est appelé directement par cargo sur le thread principal réel.
//!
//! Conséquence : ce fichier n'est pas un module `#[cfg(test)]` de `src/menu/build.rs` —
//! rien n'empêcherait `cargo test` de router ces fonctions vers un thread de travail dans
//! ce cas. Un fichier de `tests/`, avec son propre `main()`, est ce que cargo exécute tel
//! quel.
//!
//! **`#[cfg(target_os = "macos")]` sur tout le corps du fichier.**
//! **Ce que ce `cfg` ne garantit *pas*** : que `build::construire` fonctionnerait sur
//! Linux (muda y passe par gtk, dont `tauri::test::mock_app()` ne fait très probablement
//! pas l'initialisation) — ça n'a jamais été vérifié, ni sur cette machine ni en CI. Le
//! gate est une précaution contre un job Ubuntu qui casserait pour une raison étrangère au
//! sujet du test, pas une conclusion sur le comportement réel hors macOS.
//!
//! **Ce qui a changé le 4 septembre 2026** : le menu est désormais *décrit* par plateforme —
//! `MenuSpec::pour` —, parce que muda-sur-GTK écarte en silence les items prédéfinis qu'il
//! n'implémente pas. Les trois descriptions sont mesurées par les tests de `src/menu/mod.rs`,
//! qui sont purs ; ce fichier-ci, qui construit un vrai menu, ne peut toujours en exercer
//! qu'une — celle de la machine, donc celle de macOS. C'est exactement le partage que ce dépôt
//! fait partout : la donnée porte les garanties, la construction est vérifiée là où elle
//! tourne.

#[cfg(target_os = "macos")]
mod macos {
    use dorabase_lib::menu::build;
    use dorabase_lib::menu::MenuSpec;
    use tauri::menu::{Menu, MenuItemKind};
    use tauri::Runtime;

    /// Tous les identifiants portés par le menu construit, sous-menus compris — ce que
    /// `MenuEvent::id` rendra au clic.
    fn tous_les_identifiants_du_menu_construit<R: Runtime>(menu: &Menu<R>) -> Vec<String> {
        let mut identifiants = Vec::new();
        for item in menu.items().unwrap() {
            collecter_identifiants(&item, &mut identifiants);
        }
        identifiants
    }

    fn collecter_identifiants<R: Runtime>(item: &MenuItemKind<R>, identifiants: &mut Vec<String>) {
        identifiants.push(item.id().0.clone());
        if let MenuItemKind::Submenu(sous_menu) = item {
            for enfant in sous_menu.items().unwrap() {
                collecter_identifiants(&enfant, identifiants);
            }
        }
    }

    /// Tous les libellés portés par le menu construit, sous-menus compris.
    fn tous_les_libelles_du_menu_construit<R: Runtime>(menu: &Menu<R>) -> Vec<String> {
        let mut libelles = Vec::new();
        for item in menu.items().unwrap() {
            collecter_libelles(&item, &mut libelles);
        }
        libelles
    }

    fn collecter_libelles<R: Runtime>(item: &MenuItemKind<R>, libelles: &mut Vec<String>) {
        match item {
            MenuItemKind::Submenu(sous_menu) => {
                libelles.push(sous_menu.text().unwrap());
                for enfant in sous_menu.items().unwrap() {
                    collecter_libelles(&enfant, libelles);
                }
            }
            MenuItemKind::MenuItem(item) => libelles.push(item.text().unwrap()),
            MenuItemKind::Predefined(item) => libelles.push(item.text().unwrap()),
            MenuItemKind::Check(_) | MenuItemKind::Icon(_) => {}
        }
    }

    fn le_menu_construit_a_la_forme_de_la_description() {
        // La seule chose du projet qui voie un menu construit. Ce que ça attrape et
        // qu'aucun test de la tâche 1 ne peut voir : un sous-menu oublié dans la
        // construction, un libellé anglais laissé en place, un identifiant qui n'arrive
        // pas jusqu'à muda.
        let app = tauri::test::mock_app();
        let menu = build::construire(app.handle()).unwrap();

        let sous_menus = menu.items().unwrap();
        assert_eq!(sous_menus.len(), MenuSpec::actuelle().sous_menus.len());

        for (construit, decrit) in sous_menus.iter().zip(&MenuSpec::actuelle().sous_menus) {
            let sous_menu = construit
                .as_submenu()
                .expect("un item de la barre n'est pas un sous-menu");
            assert_eq!(sous_menu.text().unwrap(), decrit.libelle);
            assert_eq!(sous_menu.items().unwrap().len(), decrit.items.len());
        }
    }

    fn les_deux_entrees_de_dump_arrivent_jusqu_au_menu_construit() {
        let app = tauri::test::mock_app();
        let menu = build::construire(app.handle()).unwrap();
        let identifiants = tous_les_identifiants_du_menu_construit(&menu);

        // Ces identifiants sont ce que `MenuEvent` rendra au clic : s'ils ne traversent
        // pas la construction, la tâche 3 écoutera un événement qui n'arrive jamais.
        assert!(identifiants.contains(&"fichier.exporter-dump".to_string()));
        assert!(identifiants.contains(&"fichier.importer-dump".to_string()));
    }

    fn aucun_libelle_anglais_de_muda_ne_subsiste() {
        // `PredefinedMenuItem::*` porte un texte anglais en dur ; oublier de passer notre
        // libellé français laisserait « Copy » au milieu d'un menu français, et rien
        // d'autre ne le verrait.
        let app = tauri::test::mock_app();
        let menu = build::construire(app.handle()).unwrap();
        for texte in tous_les_libelles_du_menu_construit(&menu) {
            for anglais in [
                "Copy",
                "Paste",
                "Cut",
                "Undo",
                "Redo",
                "Select All",
                "Quit",
                "Hide",
            ] {
                assert_ne!(
                    texte, anglais,
                    "libellé anglais de muda laissé en place : {texte}"
                );
            }
        }
    }

    /// Reproduit la sortie et la convention d'échec de `libtest` (`test <nom> ... ok/FAILED`,
    /// code de sortie non nul si un test a échoué) pour que ce fichier reste lisible comme
    /// les autres tests du projet, malgré `harness = false`. Rend `true` si tout est passé.
    pub fn executer() -> bool {
        let tests: &[(&str, fn())] = &[
            (
                "le_menu_construit_a_la_forme_de_la_description",
                le_menu_construit_a_la_forme_de_la_description,
            ),
            (
                "les_deux_entrees_de_dump_arrivent_jusqu_au_menu_construit",
                les_deux_entrees_de_dump_arrivent_jusqu_au_menu_construit,
            ),
            (
                "aucun_libelle_anglais_de_muda_ne_subsiste",
                aucun_libelle_anglais_de_muda_ne_subsiste,
            ),
        ];

        let mut tout_est_passe = true;
        for (nom, test) in tests {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(test)) {
                Ok(()) => println!("test {nom} ... ok"),
                Err(_) => {
                    tout_est_passe = false;
                    println!("test {nom} ... FAILED");
                }
            }
        }
        tout_est_passe
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    {
        if !macos::executer() {
            std::process::exit(1);
        }
    }

    // Un garde qui disparaît sans le dire n'en est plus un : la ligne ci-dessous est ce
    // qui permet de distinguer, dans la sortie du job Ubuntu de la CI, « ces tests ont été
    // sciemment sautés » d'un simple silence qu'on pourrait confondre avec un succès.
    #[cfg(not(target_os = "macos"))]
    {
        println!(
            "menu_build : ignoré, la construction de menu est macOS seulement \
             (le menu natif est macOS seulement)"
        );
    }
}
