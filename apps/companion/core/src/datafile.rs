//! L'addon `ForeverRoster_Data`, écrit par l'appli : données des groupes (FRG), accusés de réception et compte rendu,
//! lus par l'addon Forever Roster à la connexion et au `/reload` (variable `ForeverRosterData`, format 1).
//!
//! Actualisation sans `/reload` (addon 1.4) : les mêmes données sont copiées dans `ForeverRoster_Data1` à `20`,
//! chargés à la demande (`## LoadOnDemand: 1`). Le jeu lit leurs fichiers au moment où l'addon les charge (vérifié sur
//! le client de Forever) : chaque copie donne une actualisation, une seule fois par session ; le `/reload` remet à zéro.
//!
//! Sécurité : tout ce qui vient du site est écrit en chaîne Lua **échappée octet par octet** : seuls les caractères
//! ASCII imprimables (hors `"` et `\`) restent tels quels, tout le reste devient `\ddd` sur trois chiffres. Le fichier
//! est donc en ASCII pur, et aucun texte ne peut fermer la chaîne ni ajouter du code.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const DATA_ADDON: &str = "ForeverRoster_Data";
/// Copies chargées à la demande (`ForeverRoster_Data1` à `ForeverRoster_Data20`) : une actualisation chacune.
/// 9 dans l'appli 0.1.0, 20 ensuite (choix de Flo) : les copies manquantes sont ajoutées à la synchro suivante.
pub const SLOTS: u32 = 20;
pub const MAIN_ADDON: &str = "ForeverRoster";
/// Interface du client de Forever si le .toc de l'addon principal est introuvable.
pub const DEFAULT_INTERFACE: &str = "16001";

/// Chaîne Lua sûre : `"…"`, échappée octet par octet.
pub fn lua_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for &b in s.as_bytes() {
        match b {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            0x20..=0x7E => out.push(b as char),
            _ => out.push_str(&format!("\\{b:03}")),
        }
    }
    out.push('"');
    out
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Report {
    pub at: i64,
    /// « Tournicoti », « bilan de « Vroum Vroum » »…
    pub items: Vec<String>,
}

/// Contenu de `Data.lua`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DataFile {
    pub app: String,
    /// Données des groupes ; None : jamais reçues (l'addon garde alors ce qu'il a).
    pub frg: Option<String>,
    pub frg_at: i64,
    pub acks: BTreeMap<String, String>,
    pub report: Option<Report>,
}

impl DataFile {
    /// Le fichier sans sa date d'écriture : sert à savoir si le contenu a changé.
    pub fn body(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!("  app = {},\n", lua_string(&self.app)));
        if let Some(frg) = &self.frg {
            s.push_str(&format!("  frgAt = {},\n", self.frg_at));
            s.push_str(&format!("  frg = {},\n", lua_string(frg)));
        }
        s.push_str("  acks = {\n");
        for (k, v) in &self.acks {
            s.push_str(&format!("    [{}] = {},\n", lua_string(k), lua_string(v)));
        }
        s.push_str("  },\n");
        if let Some(r) = &self.report {
            s.push_str(&format!("  report = {{ at = {}, items = {{", r.at));
            for (i, item) in r.items.iter().take(12).enumerate() {
                s.push_str(if i == 0 { " " } else { ", " });
                s.push_str(&lua_string(item));
            }
            s.push_str(" } },\n");
        }
        s
    }

    pub fn render(&self, at: i64) -> String {
        format!(
            "-- Écrit par Roster Companion : ne pas modifier (remplacé à chaque synchro).\nForeverRosterData = {{\n  v = 1,\n  at = {at},\n{}}}\n",
            self.body()
        )
    }
}

/// `## Interface:` du .toc de l'addon principal installé (même dossier du jeu) : chiffres, virgules et espaces seulement.
pub fn main_addon_interface(addons_dir: &Path) -> String {
    let toc = fs::read_to_string(addons_dir.join(MAIN_ADDON).join(format!("{MAIN_ADDON}.toc"))).unwrap_or_default();
    toc_field(&toc, "Interface")
        .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == ',' || c == ' '))
        .unwrap_or_else(|| DEFAULT_INTERFACE.to_string())
}

/// Valeur d'un champ `## Nom: valeur` d'un fichier .toc.
pub fn toc_field(toc: &str, name: &str) -> Option<String> {
    toc.lines().find_map(|l| {
        let rest = l.trim().strip_prefix("##")?.trim_start();
        let (k, v) = rest.split_once(':')?;
        (k.trim().eq_ignore_ascii_case(name)).then(|| v.trim().to_string())
    })
}

/// Dossiers de l'addon de données : celui chargé à la connexion, puis les copies chargées à la demande.
pub fn data_addon_dirs() -> Vec<String> {
    std::iter::once(DATA_ADDON.to_string())
        .chain((1..=SLOTS).map(|i| format!("{DATA_ADDON}{i}")))
        .collect()
}

/// En-tête repliable de la liste des addons du jeu (directive `## Category`, clients 11.1 et suivants, Forever compris) :
/// les copies y sont rangées dans l'ordre, « Copie 01 » à « Copie 20 » (choix de Flo, la liste était encombrée).
pub const COPIES_CATEGORY: &str = "Roster Companion";

/// .toc de l'addon de données (`slot` 0) ou d'une copie chargée à la demande (`slot` 1 à 20).
/// Le numéro de version de l'appli est dans `Data.lua` : une nouvelle version de l'appli réécrit donc les .toc.
pub fn data_toc(interface: &str, app_version: &str, slot: u32) -> String {
    if slot == 0 {
        return format!(
            "## Interface: {interface}\n## Title: Forever Roster (données)\n## Notes: Données déposées par Roster Companion pour l'addon Forever Roster. Ne pas modifier.\n## Author: Sleyvazh\n## Version: {app_version}\n## X-Generated-By: Roster Companion\n\nData.lua\n"
        );
    }
    format!(
        "## Interface: {interface}\n## Title: Copie {slot:02}\n## Notes: Copie des données de Roster Companion, chargée par l'addon Forever Roster pour actualiser sans /reload. Ne pas modifier.\n## Category: {COPIES_CATEGORY}\n## Author: Sleyvazh\n## Version: {app_version}\n## LoadOnDemand: 1\n## X-Generated-By: Roster Companion\n\nData.lua\n"
    )
}

/// Tous les dossiers de l'addon de données sont en place (.toc et Data.lua).
pub fn data_addon_complete(addons_dir: &Path) -> bool {
    data_addon_dirs()
        .iter()
        .all(|d| addons_dir.join(d).join(format!("{d}.toc")).is_file() && addons_dir.join(d).join("Data.lua").is_file())
}

/// Écrit un fichier sans jamais laisser une version à moitié écrite : fichier temporaire, puis renommage.
pub fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("chemin sans dossier"))?;
    fs::create_dir_all(dir)?;
    let tmp: PathBuf = dir.join(format!(".{}.tmp", path.file_name().and_then(|n| n.to_str()).unwrap_or("fichier")));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content)?;
        f.sync_all()?;
    }
    // Windows refuse de remplacer un fichier que le jeu est en train de lire : on réessaie un court instant
    let mut tries = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(_) if tries < 5 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(60 * tries));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
        }
    }
}

/// Installe ou met à jour l'addon de données et ses copies dans `Interface\AddOns` du dossier du jeu.
/// Renvoie true si un dossier vient d'être créé (le jeu ne le voit qu'après avoir été relancé).
pub fn write_data_addon(addons_dir: &Path, data: &DataFile, at: i64) -> std::io::Result<bool> {
    if !addons_dir.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("dossier des addons introuvable : {}", addons_dir.display()),
        ));
    }
    let interface = main_addon_interface(addons_dir);
    let lua = data.render(at);
    let mut created = false;
    // Les copies d'abord : le dossier chargé à la connexion, écrit en dernier, dit que tout est à jour
    for (slot, name) in data_addon_dirs().iter().enumerate().rev() {
        let dir = addons_dir.join(name);
        let toc_path = dir.join(format!("{name}.toc"));
        created |= !toc_path.exists();
        let toc = data_toc(&interface, &data.app, slot as u32);
        if fs::read_to_string(&toc_path).ok().as_deref() != Some(toc.as_str()) {
            write_atomic(&toc_path, toc.as_bytes())?;
        }
        write_atomic(&dir.join("Data.lua"), lua.as_bytes())?;
    }
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lua::{LuaValue, find_global};

    #[test]
    fn chaine_echappee_octet_par_octet() {
        assert_eq!(lua_string("abc"), "\"abc\"");
        assert_eq!(lua_string("a\"b\\c\nd"), "\"a\\\"b\\\\c\\010d\"");
        assert_eq!(lua_string("é"), "\"\\195\\169\"");
        // Une tentative de sortir de la chaîne reste du texte
        let evil = "\"] os.execute('x') --[[ \\\"";
        let s = lua_string(evil);
        assert!(s.is_ascii());
        // Relue, la chaîne redonne exactement le texte : rien n'en sort
        let back = find_global(format!("X = {s}").as_bytes(), "X").unwrap().unwrap();
        assert_eq!(back.as_str(), Some(evil));
    }

    #[test]
    fn relu_a_l_identique_par_le_lecteur_lua() {
        let mut acks = BTreeMap::new();
        acks.insert("Tournicoti-Forever EU".to_string(), "0a1b-118".to_string());
        acks.insert("frb:6f1c".to_string(), "1790000500".to_string());
        let d = DataFile {
            app: "0.1.0".into(),
            frg: Some("FRG;1;g1;1790000000;Les « Veilleurs »\nR;r1;0;Onyxia;;\nEND;1".into()),
            frg_at: 1_790_000_100,
            acks,
            report: Some(Report {
                at: 1_790_000_200,
                items: vec!["Tournicoti".into(), "bilan de « Vroum »".into()],
            }),
        };
        let text = d.render(1_790_000_300);
        assert!(d.body().is_ascii(), "les données sont en ASCII pur");
        let v = find_global(text.as_bytes(), "ForeverRosterData").unwrap().unwrap();
        let t = v.as_table().unwrap();
        assert_eq!(t.num("v"), Some(1.0));
        assert_eq!(t.num("at"), Some(1_790_000_300.0));
        assert_eq!(t.str("frg"), d.frg.as_deref());
        assert_eq!(t.table("acks").unwrap().str("Tournicoti-Forever EU"), Some("0a1b-118"));
        let items: Vec<_> = t
            .table("report")
            .unwrap()
            .table("items")
            .unwrap()
            .array()
            .into_iter()
            .filter_map(LuaValue::as_str)
            .collect();
        assert_eq!(items, vec!["Tournicoti", "bilan de « Vroum »"]);
        // Le corps ne dépend pas de la date d'écriture
        assert!(!d.body().contains("1790000300"));
    }

    #[test]
    fn champ_de_toc_et_interface() {
        let dir = tempfile::tempdir().unwrap();
        let addons = dir.path();
        assert_eq!(main_addon_interface(addons), DEFAULT_INTERFACE);
        fs::create_dir_all(addons.join(MAIN_ADDON)).unwrap();
        fs::write(
            addons.join(MAIN_ADDON).join("ForeverRoster.toc"),
            "## Interface: 16001, 120105\n## Version: 1.3.1\n",
        )
        .unwrap();
        assert_eq!(main_addon_interface(addons), "16001, 120105");
        fs::write(addons.join(MAIN_ADDON).join("ForeverRoster.toc"), "## Interface: 16001\\n## Title: piege\n").unwrap();
        assert_eq!(main_addon_interface(addons), DEFAULT_INTERFACE);
        assert_eq!(toc_field("## Version: 1.3.1\n", "version").as_deref(), Some("1.3.1"));
    }

    #[test]
    fn installe_l_addon_de_donnees() {
        let dir = tempfile::tempdir().unwrap();
        let addons = dir.path().join("Interface").join("AddOns");
        let d = DataFile {
            app: "0.1.0".into(),
            ..Default::default()
        };
        assert!(write_data_addon(&addons, &d, 1).is_err(), "dossier des addons absent");
        fs::create_dir_all(&addons).unwrap();
        assert!(!data_addon_complete(&addons));
        assert!(write_data_addon(&addons, &d, 1).unwrap());
        assert!(data_addon_complete(&addons));
        assert!(!write_data_addon(&addons, &d, 2).unwrap());
        let toc = fs::read_to_string(addons.join(DATA_ADDON).join("ForeverRoster_Data.toc")).unwrap();
        assert!(toc.contains("## Interface: 16001") && toc.ends_with("Data.lua\n"));
        assert!(!toc.contains("LoadOnDemand"), "chargé à la connexion");
        let data = fs::read_to_string(addons.join(DATA_ADDON).join("Data.lua")).unwrap();
        assert!(data.contains("at = 2,"));
        assert!(!addons.join(DATA_ADDON).join(".Data.lua.tmp").exists());
        // Les 20 copies chargées à la demande, avec les mêmes données
        assert_eq!(data_addon_dirs().len(), 21);
        for i in 1..=SLOTS {
            let name = format!("ForeverRoster_Data{i}");
            let toc = fs::read_to_string(addons.join(&name).join(format!("{name}.toc"))).unwrap();
            assert!(toc.contains("## LoadOnDemand: 1") && toc.contains(&format!("## Title: Copie {i:02}\n")));
            assert!(toc.contains("## Category: Roster Companion\n"), "rangées sous un en-tête repliable");
            assert_eq!(fs::read_to_string(addons.join(&name).join("Data.lua")).unwrap(), data);
        }
        // Une copie supprimée : signalée, puis remise (et le jeu devra être relancé pour la voir)
        fs::remove_dir_all(addons.join("ForeverRoster_Data4")).unwrap();
        assert!(!data_addon_complete(&addons));
        assert!(write_data_addon(&addons, &d, 3).unwrap());
        assert!(data_addon_complete(&addons));
    }
}
