//! Cœur de Roster Companion, sans interface : tout ce qui touche aux fichiers du jeu et au site, testable seul.
//!
//! - [`lua`] : lecture sûre (sans exécution) de la sauvegarde de l'addon.
//! - [`outbox`] : blocs à envoyer rangés par l'addon à la déconnexion.
//! - [`datafile`] : l'addon `ForeverRoster_Data` écrit pour le jeu (chaînes échappées octet par octet).
//! - [`wow`] : dossiers du jeu, comptes, addons installés, jeu lancé.
//! - [`api`] : client du site (appairage, synchro).
//! - [`sync`] : moteur de synchro (file d'attente, accusés, persos inconnus, reprise après erreur).
//! - [`state`] : réglages et état enregistrés.

pub mod api;
pub mod datafile;
pub mod lua;
pub mod outbox;
pub mod state;
pub mod sync;
pub mod wow;

/// Date actuelle en secondes Unix.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
