//! État de l'appli enregistré sur le disque (`state.json` dans le dossier de données de l'appli) : réglages,
//! appareil relié, et synchro de chaque jeu. Jamais le jeton : il est rangé dans le Gestionnaire d'identification.
//! Écriture atomique ; un fichier abîmé est mis de côté (`state.json.abime`) et l'appli repart de zéro.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::datafile::write_atomic;
use crate::sync::GameState;
use crate::wow::Game;

pub const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Startup {
    /// Démarre avec la session, icône près de l'horloge.
    #[default]
    Windows,
    /// Démarre avec la session, invisible jusqu'au lancement de WoW.
    Game,
    /// Rien ne démarre tout seul.
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CloseAction {
    /// ✕ cache la fenêtre, l'appli continue près de l'horloge.
    #[default]
    Hide,
    /// ✕ quitte l'appli.
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Notifications {
    /// Coupées par défaut (choix de Flo).
    pub enabled: bool,
    pub errors: bool,
    pub sent: bool,
    pub unknown: bool,
}

impl Default for Notifications {
    fn default() -> Self {
        Notifications {
            enabled: false,
            errors: true,
            sent: false,
            unknown: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub startup: Startup,
    pub close: CloseAction,
    pub theme: Theme,
    pub notifications: Notifications,
    /// Données du site relevées toutes les N minutes (1, 5 ou 15 ; 5 par défaut, demande de Flo).
    pub sync_minutes: u32,
    /// Dossier du jeu choisi pour chaque jeu (sinon : le premier trouvé).
    pub folders: BTreeMap<Game, PathBuf>,
    /// Dossiers « World of Warcraft » ajoutés à la main (Lutris, autre disque…).
    pub extra_roots: Vec<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            startup: Startup::default(),
            close: CloseAction::default(),
            theme: Theme::default(),
            notifications: Notifications::default(),
            sync_minutes: 5,
            folders: BTreeMap::new(),
            extra_roots: Vec::new(),
        }
    }
}

impl Settings {
    /// Délai entre deux relevés, borné aux valeurs proposées.
    pub fn sync_interval_s(&self) -> i64 {
        match self.sync_minutes {
            1 => 60,
            15 => 900,
            _ => 300,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDevice {
    pub id: String,
    pub name: String,
    pub user: String,
    pub linked_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AppState {
    pub version: u32,
    pub settings: Settings,
    pub device: Option<LinkedDevice>,
    /// L'appairage est terminé (étape « Prêt » passée).
    pub setup_done: bool,
    pub games: BTreeMap<Game, GameState>,
    /// Pause demandée jusqu'à cette date.
    pub paused_until: Option<i64>,
}

impl AppState {
    pub fn game(&mut self, g: Game) -> &mut GameState {
        self.games.entry(g).or_default()
    }

    pub fn load(path: &Path) -> AppState {
        match fs::read(path) {
            Ok(bytes) => match serde_json::from_slice::<AppState>(&bytes) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("état illisible ({e}) : mis de côté, l'appli repart de zéro");
                    let _ = fs::rename(path, path.with_extension("json.abime"));
                    AppState {
                        version: STATE_VERSION,
                        ..Default::default()
                    }
                }
            },
            Err(_) => AppState {
                version: STATE_VERSION,
                ..Default::default()
            },
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut s = self.clone();
        s.version = STATE_VERSION;
        let json = serde_json::to_vec_pretty(&s).map_err(std::io::Error::other)?;
        write_atomic(path, &json)
    }
}

pub fn state_file(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enregistre_et_relit() {
        let dir = tempfile::tempdir().unwrap();
        let path = state_file(dir.path());
        let mut s = AppState::load(&path);
        assert_eq!(s.version, STATE_VERSION);
        assert!(!s.settings.notifications.enabled, "notifications coupées par défaut");
        assert_eq!(s.settings.sync_interval_s(), 300, "synchro toutes les 5 minutes par défaut");
        s.settings.startup = Startup::Game;
        s.settings
            .folders
            .insert(Game::Forever, PathBuf::from("C:/Games/World of Warcraft/_classic_beta_"));
        s.game(Game::Forever).etag = Some("\"e\"".into());
        s.save(&path).unwrap();
        let back = AppState::load(&path);
        assert_eq!(back, {
            let mut x = s.clone();
            x.version = STATE_VERSION;
            x
        });
        let json = fs::read_to_string(&path).unwrap();
        assert!(json.contains("\"forever\"") && !json.to_lowercase().contains("token"));
    }

    #[test]
    fn fichier_abime_mis_de_cote() {
        let dir = tempfile::tempdir().unwrap();
        let path = state_file(dir.path());
        fs::write(&path, b"{ pas du json").unwrap();
        let s = AppState::load(&path);
        assert!(s.device.is_none());
        assert!(dir.path().join("state.json.abime").exists());
    }

    #[test]
    fn champs_inconnus_ou_manquants_toleres() {
        let s: AppState = serde_json::from_str(r#"{"version":1,"settings":{"startup":"manual","futur":true},"nouveau":1}"#).unwrap();
        assert_eq!(s.settings.startup, Startup::Manual);
        assert_eq!(s.settings.close, CloseAction::Hide);
    }
}
