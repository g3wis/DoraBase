//! Description pure du menu natif de l'app.
//!
//! Aucun test automatisé ne voit un menu natif — Playwright ne pilote pas WKWebView —
//! donc c'est cette donnée, et non le menu construit, qui porte les garanties : aucun
//! accélérateur de commande ne recouvre un raccourci déjà pris par le handoff, les
//! recouvrements que les prédéfinis imposent sont exactement ceux assumés par la spec,
//! aucun identifiant n'est en doublon, et le menu Édition porte bien les items que le
//! remplacement du menu par défaut retire sinon. La construction (`build.rs`, tâche
//! suivante) consomme cette description sans la réinterpréter.

pub mod build;

/// Le nom de l'événement réémis vers la webview quand un item de menu est déclenché.
///
/// **Doit rester identique à `EVENEMENT_DE_MENU` dans `src/app/menuEvents.ts`.** Tauri ne
/// type pas les noms d'événements : un désaccord ne produirait pas d'erreur, seulement un
/// pont muet. `MenuEvent` ne porte que l'identifiant de l'item, donc c'est la seule
/// information transmise — le mapping identifiant → action vit côté React.
pub const EVENEMENT: &str = "menu://declenche";

/// Un item standard fourni par Tauri (`PredefinedMenuItem`).
///
/// Une énumération plutôt qu'un nom en `&str` : `build.rs` doit faire correspondre chaque
/// variante à un constructeur muda précis, et un `match` exhaustif sur une énumération est
/// vérifié par le compilateur — un nom mal orthographié dans une chaîne serait resté
/// silencieux (ignoré ou paniquant à l'exécution), et aucun test ne peut voir un menu
/// construit pour l'attraper.
///
/// Porte aussi son libellé français : la seule autre source possible serait une deuxième
/// table dans `build.rs`, qui pourrait diverger de celle-ci.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Predefini {
    APropos,
    Services,
    Masquer,
    MasquerLesAutres,
    Quitter,
    FermerFenetre,
    Annuler,
    Retablir,
    Couper,
    Copier,
    Coller,
    ToutSelectionner,
    PleinEcran,
    Reduire,
    Zoom,
}

impl Predefini {
    /// Le libellé français à afficher, en remplacement du texte anglais en dur de muda
    /// (`PredefinedMenuItem::*_with_text`). L'app est en français (`index.html` porte
    /// `lang="fr"`, aucun i18n dans le projet) : le texte est en dur ici comme ailleurs.
    pub fn libelle(&self) -> &'static str {
        match self {
            Predefini::APropos => "À propos de DoraBase",
            Predefini::Services => "Services",
            Predefini::Masquer => "Masquer DoraBase",
            Predefini::MasquerLesAutres => "Masquer les autres",
            Predefini::Quitter => "Quitter DoraBase",
            Predefini::FermerFenetre => "Fermer la fenêtre",
            Predefini::Annuler => "Annuler",
            Predefini::Retablir => "Rétablir",
            Predefini::Couper => "Couper",
            Predefini::Copier => "Copier",
            Predefini::Coller => "Coller",
            Predefini::ToutSelectionner => "Tout sélectionner",
            Predefini::PleinEcran => "Plein écran",
            Predefini::Reduire => "Réduire",
            // Le nom natif macOS pour l'item « Maximize » de muda est « Zoom » — c'est le
            // libellé qu'Apple lui-même utilise en français, d'où le nom de la variante.
            Predefini::Zoom => "Zoom",
        }
    }
}

/// Un item du menu, avant construction.
#[derive(Debug)]
pub enum Item {
    Predefini(Predefini),
    Separateur,
    /// Un item propre à DoraBase, avec son propre identifiant : celui qui revient dans
    /// `MenuEvent::id` au moment du clic.
    Commande {
        id: &'static str,
        libelle: &'static str,
        accelerateur: Option<&'static str>,
    },
}

/// Un sous-menu de la barre de menu, avec son identifiant propre.
#[derive(Debug)]
pub struct SousMenu {
    pub id: &'static str,
    pub libelle: &'static str,
    pub items: Vec<Item>,
}

/// Un item de commande porteur d'un accélérateur, tel que rendu par
/// [`MenuSpec::items_avec_accelerateur`].
pub struct ItemAvecAccelerateur<'a> {
    pub id: &'a str,
    pub accelerateur: &'a str,
}

/// La description complète du menu natif de l'app.
#[derive(Debug)]
pub struct MenuSpec {
    pub sous_menus: Vec<SousMenu>,
}

impl MenuSpec {
    /// La composition actuelle du menu : le menu applicatif et le menu Édition que Tauri
    /// installe par défaut, reconstruits à l'identique — **remplacer le menu par défaut
    /// retire le menu Édition, donc `⌘C` / `⌘V` meurent dans toute la webview** — et le menu
    /// Fichier enrichi des deux entrées de dump.
    ///
    /// Reconstruit plutôt qu'amendé : ni « File » ni « Edit » n'ont d'identifiant stable
    /// dans Tauri 2.11.5 (vérifié dans `menu/menu.rs`), donc les retrouver dans le menu par
    /// défaut pour y insérer nos entrées demanderait de reconnaître un libellé anglais non
    /// documenté.
    pub fn actuelle() -> MenuSpec {
        MenuSpec {
            sous_menus: vec![
                SousMenu {
                    id: "application",
                    libelle: "DoraBase",
                    items: vec![
                        Item::Predefini(Predefini::APropos),
                        Item::Separateur,
                        Item::Predefini(Predefini::Services),
                        Item::Separateur,
                        Item::Predefini(Predefini::Masquer),
                        Item::Predefini(Predefini::MasquerLesAutres),
                        Item::Separateur,
                        Item::Predefini(Predefini::Quitter),
                    ],
                },
                SousMenu {
                    id: "fichier",
                    libelle: "Fichier",
                    items: vec![
                        Item::Commande {
                            id: "fichier.exporter-dump",
                            libelle: "Exporter un dump…",
                            accelerateur: Some("CmdOrCtrl+Shift+E"),
                        },
                        Item::Commande {
                            id: "fichier.importer-dump",
                            libelle: "Importer un dump…",
                            accelerateur: Some("CmdOrCtrl+Shift+I"),
                        },
                        Item::Separateur,
                        /* **Les projets, et non « les collections »** (`API-30`). La demande
                        compare le fichier à une collection Postman, et c'est la bonne analogie
                        — mais « collection » est déjà le mot de MongoDB pour une table, que
                        l'arbre affiche sous une connexion mongo. « Exporter les collections… »
                        dans ce menu se lirait comme un export de données. Ce qui voyage est un
                        projet, et la demande le dit elle-même : « everything or only a specific
                        project ».

                        **Aucun accélérateur.** `⇧⌘E` et `⇧⌘I` appartiennent au dump, et les
                        chords libres qui resteraient — `⌥⌘E`, `⌃⌘E` — ne sont le geste de
                        personne. Un raccourci inventé qui recouvrirait celui d'un autre écran
                        coûterait plus que l'absence d'un raccourci sur une action qu'on fait
                        deux fois par an.

                        **Après le dump, non avant** : les deux entrées de dump gardent leur
                        place et leurs raccourcis, où la mémoire des doigts les cherche. */
                        Item::Commande {
                            id: "fichier.exporter-projets",
                            libelle: "Exporter les projets…",
                            accelerateur: None,
                        },
                        Item::Commande {
                            id: "fichier.importer-projets",
                            libelle: "Importer des projets…",
                            accelerateur: None,
                        },
                        Item::Separateur,
                        Item::Predefini(Predefini::FermerFenetre),
                    ],
                },
                SousMenu {
                    id: "edition",
                    libelle: "Édition",
                    items: vec![
                        Item::Predefini(Predefini::Annuler),
                        Item::Predefini(Predefini::Retablir),
                        Item::Separateur,
                        Item::Predefini(Predefini::Couper),
                        Item::Predefini(Predefini::Copier),
                        Item::Predefini(Predefini::Coller),
                        Item::Predefini(Predefini::ToutSelectionner),
                    ],
                },
                SousMenu {
                    id: "affichage",
                    libelle: "Affichage",
                    items: vec![Item::Predefini(Predefini::PleinEcran)],
                },
                SousMenu {
                    id: "fenetre",
                    libelle: "Fenêtre",
                    items: vec![
                        Item::Predefini(Predefini::Reduire),
                        Item::Predefini(Predefini::Zoom),
                        Item::Separateur,
                        Item::Predefini(Predefini::FermerFenetre),
                    ],
                },
                SousMenu {
                    id: "aide",
                    libelle: "Aide",
                    items: vec![],
                },
            ],
        }
    }

    /// Les commandes porteuses d'un accélérateur, tous sous-menus confondus. Les
    /// prédéfinis n'y figurent **pas** — délibérément : leur accélérateur est câblé en dur
    /// dans muda et non redéfinissable (`predefined.rs:301-341`), donc cette méthode ne
    /// peut rien y changer. Certains d'entre eux recouvrent bel et bien un raccourci du
    /// handoff (`⌘Z` pour Annuler, `⇧⌘Z` pour Rétablir) ; ce recouvrement-là est assumé et
    /// gardé séparément par le test `les_valeurs_macos_des_predefinis_sont_figees`.
    /// Les items prédéfinis réclament `⌘Z` et `⇧⌘Z` : muda les leur donne, et ce
    /// recouvrement est assumé.
    pub fn items_avec_accelerateur(&self) -> impl Iterator<Item = ItemAvecAccelerateur<'_>> {
        self.sous_menus.iter().flat_map(|sous_menu| {
            sous_menu.items.iter().filter_map(|item| match item {
                Item::Commande {
                    id,
                    accelerateur: Some(accelerateur),
                    ..
                } => Some(ItemAvecAccelerateur { id, accelerateur }),
                _ => None,
            })
        })
    }

    /// Tous les identifiants de la description : ceux des sous-menus et ceux des
    /// commandes. Les deux espaces de noms sont confondus à dessein — un sous-menu et une
    /// commande qui partageraient un identifiant seraient tout aussi ambigus au moment de
    /// router un `MenuEvent`.
    pub fn tous_les_identifiants(&self) -> impl Iterator<Item = &str> {
        self.sous_menus.iter().flat_map(|sous_menu| {
            std::iter::once(sous_menu.id).chain(sous_menu.items.iter().filter_map(
                |item| match item {
                    Item::Commande { id, .. } => Some(*id),
                    _ => None,
                },
            ))
        })
    }

    /// L'accélérateur de la commande d'identifiant `id`, si elle existe et en porte un.
    pub fn accelerateur_de(&self, id: &str) -> Option<&str> {
        self.sous_menus
            .iter()
            .flat_map(|sous_menu| &sous_menu.items)
            .find_map(|item| match item {
                Item::Commande {
                    id: item_id,
                    accelerateur,
                    ..
                } if *item_id == id => accelerateur.as_deref(),
                _ => None,
            })
    }

    /// Vrai si le sous-menu d'identifiant `sous_menu_id` porte le prédéfini `attendu`.
    pub fn contient_predefini(&self, sous_menu_id: &str, attendu: Predefini) -> bool {
        self.sous_menus
            .iter()
            .find(|sous_menu| sous_menu.id == sous_menu_id)
            .is_some_and(|sous_menu| {
                sous_menu
                    .items
                    .iter()
                    .any(|item| matches!(item, Item::Predefini(predefini) if *predefini == attendu))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les raccourcis que le handoff s'est déjà attribués. Un accélérateur natif est
    /// intercepté par macOS **avant** la webview : le recouvrir masquerait silencieusement
    /// le `keydown` correspondant.
    const RACCOURCIS_DU_HANDOFF: &[&str] = &[
        "CmdOrCtrl+N",     // « + Nouveau projet ⌘N » — A1
        "CmdOrCtrl+K",     // palette de commandes — A1, A4
        "CmdOrCtrl+P",     // « Chercher un objet… ⌘P » — A4
        "CmdOrCtrl+E",     // « lecture seule — ⌘E pour éditer » — A5
        "CmdOrCtrl+Z",     // annuler une modification en attente — A6
        "CmdOrCtrl+Enter", // appliquer / exécuter — A6, A7
        "Alt+Enter",       // exécuter la sélection — A7
    ];

    #[test]
    fn aucun_accelerateur_ne_recouvre_le_handoff() {
        for item in MenuSpec::actuelle().items_avec_accelerateur() {
            assert!(
                !RACCOURCIS_DU_HANDOFF.contains(&item.accelerateur),
                "l'accélérateur {} de l'item {} recouvre un raccourci du handoff",
                item.accelerateur,
                item.id
            );
        }
    }

    /// Vrai si `accelerateur` est écrit à la graphie canonique `CmdOrCtrl+[Shift+][Alt+]<Touche>`.
    ///
    /// La comparaison de `aucun_accelerateur_ne_recouvre_le_handoff` est **littérale** :
    /// muda accepte plusieurs graphies du même raccourci (`Cmd+N`, `Super+N`,
    /// `cmdorctrl+n`…), donc rien n'y détecterait qu'un accélérateur recouvre le handoff
    /// écrit autrement que dans `RACCOURCIS_DU_HANDOFF`. Contraindre la graphie de nos
    /// propres commandes rend cette comparaison totale plutôt qu'à moitié.
    fn est_graphie_canonique(accelerateur: &str) -> bool {
        let tokens: Vec<&str> = accelerateur.split('+').collect();
        let Some((touche, modificateurs)) = tokens.split_last() else {
            return false;
        };
        !touche.is_empty()
            && matches!(
                modificateurs,
                ["CmdOrCtrl"]
                    | ["CmdOrCtrl", "Shift"]
                    | ["CmdOrCtrl", "Alt"]
                    | ["CmdOrCtrl", "Shift", "Alt"]
            )
    }

    #[test]
    fn les_accelerateurs_des_commandes_sont_a_la_graphie_canonique() {
        for item in MenuSpec::actuelle().items_avec_accelerateur() {
            assert!(
                est_graphie_canonique(item.accelerateur),
                "l'accélérateur {} de l'item {} n'est pas à la graphie canonique \
                 CmdOrCtrl+[Shift+][Alt+]<Touche>",
                item.accelerateur,
                item.id
            );
        }
    }

    /// Ce que chaque prédéfini retenu par [`MenuSpec::actuelle`] réclame comme
    /// accélérateur **sur macOS**, d'après `muda-0.19.3/src/items/predefined.rs:301-341` :
    /// les accélérateurs y sont câblés en dur, `PredefinedMenuItem::*_with_text` ne change
    /// que le libellé. `None` pour les prédéfinis qui n'en réclament aucun (vérifié à la
    /// même source).
    ///
    /// Ce que rien ne peut garantir : que la valeur inscrite ici soit bien celle de muda.
    /// `PredefinedMenuItemType::accelerator()` est `pub(crate)`, inaccessible depuis ce
    /// crate — aucune API ne permet de faire mieux que relire la source à la main.
    ///
    /// La table elle-même **n'est pas** `cfg(macos)` : la liste des noms qu'elle connaît
    /// sert de garde d'appartenance sur toutes les cibles (voir
    /// `tous_les_predefinis_utilises_sont_repertories`, qui ne compare que des `Predefini`,
    /// jamais une valeur). Seules les **valeurs** qu'elle porte sont spécifiques à macOS :
    /// `Redo` réclame `⌘Y` ailleurs, `CloseWindow` réclame `Alt+F4`, et
    /// `Fullscreen`/`Quit` ne réclament rien du tout hors macOS — c'est pourquoi le test
    /// qui les lit (`les_valeurs_macos_des_predefinis_sont_figees`) porte, lui,
    /// `#[cfg(target_os = "macos")]`.
    const ACCELERATEURS_DES_PREDEFINIS: &[(Predefini, Option<&str>)] = &[
        (Predefini::APropos, None),
        (Predefini::Services, None),
        (Predefini::Masquer, Some("CmdOrCtrl+H")),
        (Predefini::MasquerLesAutres, Some("CmdOrCtrl+Alt+H")),
        (Predefini::Quitter, Some("CmdOrCtrl+Q")),
        (Predefini::FermerFenetre, Some("CmdOrCtrl+W")),
        (Predefini::Annuler, Some("CmdOrCtrl+Z")),
        (Predefini::Retablir, Some("CmdOrCtrl+Shift+Z")),
        (Predefini::Couper, Some("CmdOrCtrl+X")),
        (Predefini::Copier, Some("CmdOrCtrl+C")),
        (Predefini::Coller, Some("CmdOrCtrl+V")),
        (Predefini::ToutSelectionner, Some("CmdOrCtrl+A")),
        (Predefini::PleinEcran, Some("Ctrl+Cmd+F")),
        (Predefini::Reduire, Some("CmdOrCtrl+M")),
        (Predefini::Zoom, None),
    ];

    /// Garde d'appartenance, indépendante de la plateforme : un prédéfini ajouté à
    /// `MenuSpec::actuelle()` sans entrée dans `ACCELERATEURS_DES_PREDEFINIS` — ou une
    /// entrée qui ne correspond plus à rien — n'est comparé à aucune valeur ici, donc rien
    /// n'empêche ce test de tourner sur toutes les cibles de CI, y compris le job
    /// `ubuntu-latest`. Les valeurs elles-mêmes, spécifiques à macOS, sont vérifiées à part
    /// par `les_valeurs_macos_des_predefinis_sont_figees`.
    #[test]
    fn tous_les_predefinis_utilises_sont_repertories() {
        let utilises: Vec<Predefini> = MenuSpec::actuelle()
            .sous_menus
            .iter()
            .flat_map(|sous_menu| &sous_menu.items)
            .filter_map(|item| match item {
                Item::Predefini(predefini) => Some(*predefini),
                _ => None,
            })
            .collect();

        // Un prédéfini utilisé mais absent de la table : son accélérateur n'a jamais été
        // vérifié contre muda.
        for predefini in &utilises {
            assert!(
                ACCELERATEURS_DES_PREDEFINIS
                    .iter()
                    .any(|(connu, _)| connu == predefini),
                "{predefini:?} n'est pas répertorié dans ACCELERATEURS_DES_PREDEFINIS — \
                 son accélérateur n'a pas été vérifié contre muda"
            );
        }

        // Et réciproquement : une entrée qui ne correspond plus à aucun prédéfini utilisé
        // est une ligne morte, jamais confrontée à rien.
        for (predefini, _) in ACCELERATEURS_DES_PREDEFINIS {
            assert!(
                utilises.contains(predefini),
                "{predefini:?} est répertorié dans ACCELERATEURS_DES_PREDEFINIS mais n'est \
                 utilisé par aucun sous-menu de MenuSpec::actuelle"
            );
        }
    }

    /// Les recouvrements avec le handoff sont exactement ceux assumés par la spec : Annuler
    /// réclame ⌘Z — littéralement dans `RACCOURCIS_DU_HANDOFF` — et Rétablir réclame ⇧⌘Z —
    /// la même touche que ⌘Z, avec Maj, assumée par construction sans figurer séparément
    /// dans la liste du handoff. Aucun autre prédéfini retenu ne doit recouvrir quoi que ce
    /// soit du handoff. `#[cfg(target_os = "macos")]` : ce test lit des **valeurs**
    /// d'accélérateur, spécifiques à la plateforme — voir la doc de
    /// `ACCELERATEURS_DES_PREDEFINIS`.
    #[cfg(target_os = "macos")]
    #[test]
    fn les_valeurs_macos_des_predefinis_sont_figees() {
        let accelerateur_de = |cherche: Predefini| {
            ACCELERATEURS_DES_PREDEFINIS
                .iter()
                .find(|(predefini, _)| *predefini == cherche)
                .and_then(|(_, accelerateur)| *accelerateur)
        };
        assert_eq!(accelerateur_de(Predefini::Annuler), Some("CmdOrCtrl+Z"));
        assert_eq!(
            accelerateur_de(Predefini::Retablir),
            Some("CmdOrCtrl+Shift+Z")
        );

        for (predefini, accelerateur) in ACCELERATEURS_DES_PREDEFINIS {
            if matches!(predefini, Predefini::Annuler | Predefini::Retablir) {
                continue;
            }
            if let Some(accelerateur) = accelerateur {
                assert!(
                    !RACCOURCIS_DU_HANDOFF.contains(accelerateur),
                    "{predefini:?} réclame {accelerateur}, qui recouvre le handoff — \
                     recouvrement non assumé par la spec"
                );
            }
        }
    }

    #[test]
    fn aucun_identifiant_en_doublon() {
        let mut vus = std::collections::BTreeSet::new();
        for id in MenuSpec::actuelle().tous_les_identifiants() {
            assert!(vus.insert(id), "identifiant en doublon : {id}");
        }
    }

    #[test]
    fn les_deux_entrees_de_dump_sont_presentes_avec_leurs_accelerateurs() {
        let spec = MenuSpec::actuelle();
        assert_eq!(
            spec.accelerateur_de("fichier.exporter-dump"),
            Some("CmdOrCtrl+Shift+E")
        );
        assert_eq!(
            spec.accelerateur_de("fichier.importer-dump"),
            Some("CmdOrCtrl+Shift+I")
        );
    }

    #[test]
    fn le_menu_edition_porte_les_items_que_le_remplacement_retire() {
        // La régression que ce remplacement peut introduire : sans Annuler / Rétablir,
        // ⌘Z / ⇧⌘Z ne défont plus rien dans les champs de saisie de l'app ; sans les items
        // de presse-papier, ⌘X / ⌘C / ⌘V deviennent inertes partout. Annuler est de plus la
        // cible obligatoire de l'annulation de `A6` depuis que le menu Édition est
        // prédéfinis réclament ⌘Z ».
        let spec = MenuSpec::actuelle();
        for attendu in [
            Predefini::Annuler,
            Predefini::Retablir,
            Predefini::Couper,
            Predefini::Copier,
            Predefini::Coller,
            Predefini::ToutSelectionner,
        ] {
            assert!(
                spec.contient_predefini("edition", attendu),
                "le menu Édition ne porte pas {attendu:?}"
            );
        }
    }
}
