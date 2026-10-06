//! Contexte partagé de l'appli : état enregistré, client du site, jeton, état en cours (jeu lancé, appairage…).

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rc_core::api::{Client, PairStart};
use rc_core::state::AppState;
use rc_core::wow::{Game, Install};
use tokio::sync::Notify;

/// Jeux synchronisés pour l'instant : Retail attend son addon (R3).
pub const GAMES: [Game; 1] = [Game::Forever];

pub struct Ctx {
    pub version: String,
    pub state_path: PathBuf,
    pub log_dir: PathBuf,
    pub client: Client,
    state: Mutex<AppState>,
    /// Une seule opération de synchro à la fois (boucle de fond ou bouton de l'interface).
    pub sync_lock: tokio::sync::Mutex<()>,
    /// Réveille la boucle de fond (fichier modifié, « Synchroniser maintenant »…).
    pub wake: Notify,
    pub live: Mutex<Live>,
    token: Mutex<Option<Option<String>>>,
}

/// Ce qui n'est pas enregistré : recalculé en continu.
#[derive(Default)]
pub struct Live {
    pub installs: Vec<Install>,
    pub installs_at: i64,
    /// Jeux lancés en ce moment.
    pub running: Vec<Game>,
    /// Dernière fois que le jeu tournait (mode « Avec le jeu » : l'icône reste un peu après).
    pub last_running_at: i64,
    pub pairing: Option<Pairing>,
    /// Addon de données créé pendant que le jeu tournait : relancer le jeu une fois.
    pub restart_needed: Vec<Game>,
    /// Relevé des données du site demandé tout de suite.
    pub force_pull: bool,
    /// Demande de code en cours (deux demandes en même temps donneraient deux codes différents).
    pub pairing_busy: bool,
}

#[derive(Clone)]
pub struct Pairing {
    pub start: PairStart,
    pub started_at: i64,
    pub status: String,
    pub message: Option<String>,
}

impl Ctx {
    pub fn new(version: String, state_path: PathBuf, log_dir: PathBuf, client: Client) -> Self {
        let state = AppState::load(&state_path);
        Ctx {
            version,
            state_path,
            log_dir,
            client,
            state: Mutex::new(state),
            sync_lock: tokio::sync::Mutex::new(()),
            wake: Notify::new(),
            live: Mutex::new(Live::default()),
            token: Mutex::new(None),
        }
    }

    /// État enregistré (verrou court : jamais pendant une requête au site).
    pub fn state(&self) -> MutexGuard<'_, AppState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn live(&self) -> MutexGuard<'_, Live> {
        self.live.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn save(&self) {
        let s = self.state().clone();
        if let Err(e) = s.save(&self.state_path) {
            tracing::error!("état non enregistré : {e}");
        }
    }

    /// Jeton de l'appareil (lu une fois dans le Gestionnaire d'identification, puis gardé en mémoire).
    pub fn token(&self) -> Option<String> {
        let mut cache = self.token.lock().unwrap_or_else(|e| e.into_inner());
        if cache.is_none() {
            *cache = Some(crate::secrets::load());
        }
        cache.clone().flatten()
    }

    pub fn set_token(&self, token: Option<&str>) {
        match token {
            Some(t) => crate::secrets::store(t),
            None => crate::secrets::clear(),
        }
        *self.token.lock().unwrap_or_else(|e| e.into_inner()) = Some(token.map(str::to_string));
    }

    /// Dossier du jeu utilisé pour un jeu : celui choisi, sinon le premier trouvé.
    pub fn install_for(&self, game: Game) -> Option<Install> {
        let chosen = self.state().settings.folders.get(&game).cloned();
        let live = self.live();
        match chosen {
            Some(path) => live.installs.iter().find(|i| i.path == path).cloned().or_else(|| {
                // Dossier choisi mais plus détecté (disque débranché…) : on le garde tel quel
                Some(Install {
                    dir_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    path,
                    product: None,
                    version: None,
                    game: Some(game),
                    test: false,
                })
            }),
            None => live.installs.iter().find(|i| i.game == Some(game)).cloned(),
        }
    }
}
