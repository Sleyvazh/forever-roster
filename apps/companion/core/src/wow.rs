//! Installations de WoW sur le PC : dossiers de jeu (`_classic_beta_`, `_classic_`, `_retail_`…), produit et version
//! (fichier `.build.info` du launcher), comptes de `WTF`, addons installés, et jeu lancé ou non.
//!
//! Forever : produit `wow_classic*` en version 1.60 ou plus (bêta : `_classic_beta_`, puis `_classic_` à la sortie).
//! Retail : produit `wow` (et ses PTR / bêtas).

use std::fs;
use std::path::{Path, PathBuf};

use crate::datafile::{MAIN_ADDON, data_addon_complete, toc_field};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Game {
    Forever,
    Retail,
}

impl Game {
    pub fn key(self) -> &'static str {
        match self {
            Game::Forever => "forever",
            Game::Retail => "retail",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Game::Forever => "Forever",
            Game::Retail => "Retail",
        }
    }
}

/// Une ligne de `.build.info` (fichier texte du launcher, colonnes séparées par « | », en-tête « Nom!TYPE:taille »).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildInfoRow {
    pub product: String,
    pub version: String,
    pub active: bool,
}

pub fn parse_build_info(text: &str) -> Vec<BuildInfoRow> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let Some(head) = lines.next() else { return vec![] };
    let cols: Vec<String> = head.split('|').map(|c| c.split('!').next().unwrap_or("").trim().to_ascii_lowercase()).collect();
    let idx = |name: &str| cols.iter().position(|c| c == name);
    let (Some(ip), Some(iv)) = (idx("product"), idx("version")) else {
        return vec![];
    };
    let ia = idx("active");
    lines
        .filter_map(|l| {
            let f: Vec<&str> = l.split('|').collect();
            Some(BuildInfoRow {
                product: f.get(ip)?.trim().to_string(),
                version: f.get(iv)?.trim().to_string(),
                active: ia.and_then(|i| f.get(i)).is_none_or(|v| v.trim() != "0"),
            })
        })
        .filter(|r| !r.product.is_empty())
        .collect()
}

/// Dossier d'un produit du launcher : wow → _retail_, wowt → _ptr_, wowxptr → _xptr_, wow_X → _X_.
pub fn folder_of_product(product: &str) -> String {
    match product {
        "wow" => "_retail_".into(),
        "wowt" => "_ptr_".into(),
        "wowxptr" => "_xptr_".into(),
        p => format!("_{}_", p.strip_prefix("wow_").unwrap_or(p)),
    }
}

/// Jeu d'un produit et de sa version ; None : jeu que l'appli ne gère pas (Classic Era, MoP Classic…).
pub fn classify(product: &str, version: &str) -> Option<Game> {
    let mut v = version.split('.').map(|n| n.parse::<u32>().unwrap_or(0));
    let (major, minor) = (v.next().unwrap_or(0), v.next().unwrap_or(0));
    if product.starts_with("wow_classic") && major == 1 && minor >= 60 {
        return Some(Game::Forever);
    }
    if matches!(product, "wow" | "wowt" | "wowxptr" | "wow_beta") {
        return Some(Game::Retail);
    }
    None
}

/// Un dossier de jeu (`…\World of Warcraft\_classic_beta_`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    pub path: PathBuf,
    pub dir_name: String,
    pub product: Option<String>,
    pub version: Option<String>,
    pub game: Option<Game>,
    /// Bêta ou serveur de test (pas le jeu « normal »).
    pub test: bool,
}

impl Install {
    pub fn addons_dir(&self) -> PathBuf {
        self.path.join("Interface").join("AddOns")
    }
    /// Version de l'addon Forever Roster installé (champ Version du .toc).
    pub fn addon_version(&self) -> Option<String> {
        let toc = fs::read_to_string(self.addons_dir().join(MAIN_ADDON).join(format!("{MAIN_ADDON}.toc"))).ok()?;
        toc_field(&toc, "Version")
    }
    /// ForeverRoster_Data et ses copies chargées à la demande sont tous en place.
    pub fn data_addon_installed(&self) -> bool {
        data_addon_complete(&self.addons_dir())
    }
    /// Sauvegardes de l'addon, une par compte WoW (`WTF\Account\<compte>\SavedVariables\ForeverRoster.lua`).
    /// Les dossiers de compte sans sauvegarde sont listés aussi : l'addon peut l'écrire plus tard.
    pub fn accounts(&self) -> Vec<Account> {
        let root = self.path.join("WTF").join("Account");
        let Ok(rd) = fs::read_dir(&root) else { return vec![] };
        let mut out: Vec<Account> = rd
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                // « SavedVariables » à la racine de Account : réglages communs, pas un compte
                if name.eq_ignore_ascii_case("SavedVariables") {
                    return None;
                }
                let sv = e.path().join("SavedVariables");
                Some(Account {
                    file: sv.join(format!("{MAIN_ADDON}.lua")),
                    dir: sv,
                    name,
                })
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    /// Dossier SavedVariables (surveillé : le jeu y réécrit les fichiers en entier).
    pub dir: PathBuf,
    pub file: PathBuf,
}

/// Dossiers de jeu sous un dossier « World of Warcraft » (ou le dossier de jeu lui-même).
pub fn scan_root(root: &Path) -> Vec<Install> {
    // Dossier de jeu donné directement (…\_classic_beta_) : on remonte à la racine
    if let Some(name) = root.file_name().and_then(|n| n.to_str())
        && is_game_dir_name(name)
        && let Some(parent) = root.parent()
    {
        return scan_root(parent).into_iter().filter(|i| i.dir_name == name).collect();
    }
    let rows = fs::read_to_string(root.join(".build.info")).map(|t| parse_build_info(&t)).unwrap_or_default();
    let Ok(rd) = fs::read_dir(root) else { return vec![] };
    let mut out: Vec<Install> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let dir_name = e.file_name().to_string_lossy().into_owned();
            if !is_game_dir_name(&dir_name) {
                return None;
            }
            let path = e.path();
            // Un vrai dossier de jeu a Interface ou WTF (sinon : reste d'une désinstallation)
            if !path.join("Interface").is_dir() && !path.join("WTF").is_dir() {
                return None;
            }
            let row = rows.iter().find(|r| folder_of_product(&r.product).eq_ignore_ascii_case(&dir_name));
            let game = row.and_then(|r| classify(&r.product, &r.version));
            let product = row.map(|r| r.product.clone());
            let test = product
                .as_deref()
                .is_some_and(|p| p.contains("beta") || p.contains("ptr") || p == "wowt" || p == "wowxptr");
            Some(Install {
                path,
                dir_name,
                product,
                version: row.map(|r| r.version.clone()),
                game,
                test,
            })
        })
        .collect();
    out.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    out
}

fn is_game_dir_name(name: &str) -> bool {
    name.len() > 2 && name.starts_with('_') && name.ends_with('_') && name[1..name.len() - 1].chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

/// Racines possibles : registre de Blizzard, puis emplacements habituels sur chaque disque.
pub fn candidate_roots() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_LOCAL_MACHINE;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        for key in [
            r"SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft",
            r"SOFTWARE\Blizzard Entertainment\World of Warcraft",
        ] {
            if let Ok(k) = hklm.open_subkey(key)
                && let Ok(p) = k.get_value::<String, _>("InstallPath")
            {
                // InstallPath pointe sur un dossier de jeu (…\_retail_\) : sa racine nous intéresse
                let p = PathBuf::from(p.trim_end_matches(['\\', '/']));
                let root = match p.file_name().and_then(|n| n.to_str()) {
                    Some(n) if is_game_dir_name(n) => p.parent().map(Path::to_path_buf).unwrap_or(p),
                    _ => p,
                };
                out.push(root);
            }
        }
        for drive in b'C'..=b'Z' {
            let d = format!("{}:\\", drive as char);
            if !Path::new(&d).exists() {
                continue;
            }
            for sub in [
                "Program Files (x86)\\World of Warcraft",
                "Program Files\\World of Warcraft",
                "World of Warcraft",
                "Games\\World of Warcraft",
                "Jeux\\World of Warcraft",
                "Battle.net\\World of Warcraft",
                "Blizzard\\World of Warcraft",
            ] {
                out.push(PathBuf::from(format!("{d}{sub}")));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| p.is_dir() && seen.insert(p.to_string_lossy().to_lowercase()));
    out
}

/// Toutes les installations trouvées (racines connues + dossiers ajoutés à la main), sans doublon.
pub fn detect(extra_roots: &[PathBuf]) -> Vec<Install> {
    let mut roots = candidate_roots();
    roots.extend(extra_roots.iter().cloned());
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for r in roots {
        for i in scan_root(&r) {
            if seen.insert(i.path.to_string_lossy().to_lowercase()) {
                out.push(i);
            }
        }
    }
    out
}

/// Le jeu tourne-t-il depuis ce dossier ? (un exécutable lancé dont le chemin est dans le dossier du jeu)
pub fn is_inside(exe: &Path, folder: &Path) -> bool {
    // Insensible à la casse et aux séparateurs ; préfixe des chemins longs de Windows (\\?\) ignoré
    let norm = |p: &Path| {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_start_matches("\\\\?\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    let (e, f) = (norm(exe), norm(folder));
    e.len() > f.len() && e.starts_with(&f) && e.as_bytes()[f.len()] == b'\\'
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUILD_INFO: &str = "Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Install Key!HEX:16|IM Size!DEC:4|CDN Path!STRING:0|CDN Hosts!STRING:0|CDN Servers!STRING:0|Tags!STRING:0|Armadillo!STRING:0|Last Activated!STRING:0|Version!STRING:0|KeyRing!HEX:16|Product!STRING:0\n\
eu|1|aa|bb|cc||tpr/wow|eu.cdn|http://eu.cdn|Windows x86_64 EU? enUS speech?:Windows x86_64 EU? enUS text?|||1.60.1.70170|dd|wow_classic_beta\n\
eu|1|aa|bb|cc||tpr/wow|eu.cdn|http://eu.cdn|tags|||12.1.0.63000|dd|wow\n\
eu|1|aa|bb|cc||tpr/wow|eu.cdn|http://eu.cdn|tags|||1.15.7.61000|dd|wow_classic_era\n";

    #[test]
    fn lit_build_info() {
        let rows = parse_build_info(BUILD_INFO);
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[0],
            BuildInfoRow {
                product: "wow_classic_beta".into(),
                version: "1.60.1.70170".into(),
                active: true
            }
        );
        assert!(parse_build_info("").is_empty());
        assert!(parse_build_info("Colonne!STRING:0\nx").is_empty());
    }

    #[test]
    fn produit_dossier_et_jeu() {
        assert_eq!(folder_of_product("wow"), "_retail_");
        assert_eq!(folder_of_product("wow_classic_beta"), "_classic_beta_");
        assert_eq!(folder_of_product("wowt"), "_ptr_");
        assert_eq!(classify("wow_classic_beta", "1.60.1.70170"), Some(Game::Forever));
        assert_eq!(classify("wow_classic", "1.60.2.71000"), Some(Game::Forever));
        assert_eq!(classify("wow_classic", "5.5.1.60000"), None);
        assert_eq!(classify("wow_classic_era", "1.15.7.61000"), None);
        assert_eq!(classify("wow", "12.1.0.63000"), Some(Game::Retail));
    }

    #[test]
    fn detecte_les_dossiers_et_les_comptes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("World of Warcraft");
        for d in [
            "_classic_beta_/Interface/AddOns/ForeverRoster",
            "_classic_beta_/WTF/Account/123#1/SavedVariables",
            "_classic_beta_/WTF/Account/SavedVariables",
            "_retail_/Interface",
            "_classic_era_/WTF",
            "_vide_",
            "Data",
        ] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        fs::write(root.join(".build.info"), BUILD_INFO).unwrap();
        fs::write(
            root.join("_classic_beta_/Interface/AddOns/ForeverRoster/ForeverRoster.toc"),
            "## Interface: 16001\n## Version: 1.3.1\n",
        )
        .unwrap();
        let all = scan_root(&root);
        let names: Vec<_> = all.iter().map(|i| (i.dir_name.as_str(), i.game)).collect();
        assert_eq!(
            names,
            vec![
                ("_classic_beta_", Some(Game::Forever)),
                ("_classic_era_", None),
                ("_retail_", Some(Game::Retail))
            ]
        );
        let forever = &all[0];
        assert!(forever.test);
        assert_eq!(forever.version.as_deref(), Some("1.60.1.70170"));
        assert_eq!(forever.addon_version().as_deref(), Some("1.3.1"));
        assert!(!forever.data_addon_installed());
        let accounts = forever.accounts();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].name, "123#1");
        assert!(accounts[0].file.ends_with("SavedVariables/ForeverRoster.lua"));
        // Dossier de jeu donné directement
        let direct = scan_root(&root.join("_retail_"));
        assert_eq!(direct.len(), 1);
        assert_eq!(direct[0].game, Some(Game::Retail));
        assert_eq!(detect(&[root.clone(), root.join("_retail_")]).len(), 3);
    }

    #[test]
    fn jeu_lance_depuis_le_dossier() {
        let f = Path::new("C:\\Games\\World of Warcraft\\_classic_beta_");
        assert!(is_inside(Path::new("C:\\Games\\World of Warcraft\\_classic_beta_\\WowClassicB.exe"), f));
        assert!(is_inside(Path::new("c:/games/world of warcraft/_classic_beta_/Wow.exe"), f));
        assert!(!is_inside(Path::new("C:\\Games\\World of Warcraft\\_classic_beta_2\\Wow.exe"), f));
        assert!(!is_inside(Path::new("C:\\Games\\World of Warcraft\\_retail_\\Wow.exe"), f));
        assert!(
            is_inside(Path::new("\\\\?\\C:\\Games\\World of Warcraft\\_classic_beta_\\Wow.exe"), f),
            "chemin long de Windows"
        );
    }
}
