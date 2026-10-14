//! Roster Companion : l'appli de bureau (Tauri 2). Le travail sur les fichiers et le site est dans `rc-core` ;
//! ici : icône près de l'horloge, fenêtre, boucle de fond, jeton, journal, démarrage avec Windows.

mod commands;
mod ctx;
mod notify;
mod runner;
mod secrets;
mod tray;
mod ui;
mod update;
mod windows;

use std::sync::{Arc, OnceLock};

use rc_core::api::{Client, Sites};
use rc_core::state::{CloseAction, Startup, state_file};
use rc_core::wow::Game;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;

use crate::ctx::Ctx;

/// Argument ajouté au démarrage avec la session : pas de fenêtre.
const HIDDEN_ARG: &str = "--hidden";

static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

fn init_logging(dir: &std::path::Path) {
    let _ = std::fs::create_dir_all(dir);
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("roster-companion")
        .filename_suffix("log")
        .max_log_files(7)
        .build(dir);
    match appender {
        Ok(a) => {
            let (writer, guard) = tracing_appender::non_blocking(a);
            let _ = LOG_GUARD.set(guard);
            let _ = tracing_subscriber::fmt()
                .with_writer(writer)
                .with_ansi(false)
                .with_target(false)
                .with_max_level(tracing::Level::INFO)
                .try_init();
        }
        Err(_) => {
            let _ = tracing_subscriber::fmt().with_max_level(tracing::Level::INFO).try_init();
        }
    }
}

/// Adresses des sites ; en version de développement, modifiables pour tester contre un serveur local.
fn sites() -> Sites {
    let mut s = Sites::default();
    if cfg!(debug_assertions) {
        if let Ok(v) = std::env::var("ROSTER_COMPANION_FOREVER") {
            s.forever = v;
        }
        if let Ok(v) = std::env::var("ROSTER_COMPANION_RETAIL") {
            s.retail = v;
        }
    }
    s
}

pub fn run() {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
    let result = tauri::Builder::default()
        // Une seule appli à la fois : relancer l'appli ouvre la fenêtre de celle qui tourne
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows::show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Mises à jour : liste des versions lue sur GitHub, installateur vérifié avec la clé publique (update.rs)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            init_logging(&log_dir);
            let version = app.package_info().version.to_string();
            tracing::info!("Roster Companion {version} démarre ({})", if hidden { "avec la session" } else { "à la main" });
            let client = Client::new(sites(), &version).map_err(|e| e.to_string())?;
            let ctx = Arc::new(Ctx::new(version, state_file(&data_dir), log_dir, client));
            app.manage(ctx.clone());
            // Appareil relié mais jeton absent du coffre (coffre vidé, autre session Windows…) : retour à l'appairage
            // plutôt qu'une appli qui ne synchronise plus sans rien dire
            if ctx.state().device.is_some() && ctx.token().is_none() {
                tracing::warn!("jeton introuvable dans le coffre du système : nouvel appairage nécessaire");
                forget_device(&ctx);
            }
            tray::create(&handle)?;
            runner::spawn(handle.clone());
            app.manage(update::Updates::default());
            update::spawn(handle.clone());
            // Fenêtre : lancée à la main, ou appairage pas terminé
            let setup_done = { ctx.state().setup_done && ctx.state().device.is_some() };
            if !hidden || !setup_done {
                windows::show_main(&handle);
            }
            tray::update(&handle, &ctx);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Alt+F4 : même chose que le ✕ de la barre de titre
                api.prevent_close();
                let app = window.app_handle().clone();
                let ctx = app.state::<Arc<Ctx>>().inner().clone();
                close_requested(&app, &ctx);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::pair_start,
            commands::pair_cancel,
            commands::use_install,
            commands::pick_folder,
            commands::rescan,
            commands::finish_setup,
            commands::sync_now,
            commands::resolve_unknown,
            commands::send_manual,
            commands::dismiss_manual,
            commands::pause,
            commands::set_settings,
            commands::ignored_list,
            commands::unignore,
            commands::unlink,
            commands::journal,
            commands::diagnostic,
            commands::open_site,
            commands::open_url,
            commands::window_close,
            commands::window_minimize,
            commands::quit,
            update::update_status,
            update::check_update,
            update::install_update,
            update::dismiss_update,
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|_app, event| {
            // Fenêtre fermée : l'appli continue près de l'horloge (Quitter : menu de l'icône)
            if let RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        }),
        Err(e) => {
            tracing::error!("démarrage impossible : {e}");
            eprintln!("Roster Companion n'a pas pu démarrer : {e}");
        }
    }
}

/* ---------- Actions partagées (menu de l'icône, commandes) ---------- */

/// « Synchroniser maintenant » : une demande pour la boucle de fond, rien n'est modifié ici (une passe en cours
/// écraserait la modification : voir l'en-tête de `runner.rs`) ; l'interface voit la demande tout de suite.
pub(crate) fn sync_now(app: &AppHandle, ctx: &Arc<Ctx>) {
    ctx.request_sync();
    ui::emit(app, ctx);
}

pub(crate) fn pause(app: &AppHandle, ctx: &Arc<Ctx>, until: Option<i64>) {
    ctx.state().paused_until = until;
    ctx.save();
    if until.is_none() {
        ctx.wake.notify_one();
    }
    tracing::info!("{}", if until.is_some() { "synchro en pause" } else { "synchro reprise" });
    tray::update(app, ctx);
    ui::emit(app, ctx);
}

/// Demain 6 h, heure du PC : fin de la pause « Jusqu'à demain ».
pub(crate) fn tomorrow_morning() -> i64 {
    tomorrow_at(rc_core::now(), ui::local_offset_s(), 6)
}

/// Prochain lendemain à `hour` h en heure locale (`offset` : décalage de l'heure locale en secondes), en UTC.
fn tomorrow_at(now: i64, offset: i64, hour: i64) -> i64 {
    let local = now + offset;
    local - local.rem_euclid(86400) + 86400 + hour * 3600 - offset
}

pub(crate) fn open_external(app: &AppHandle, url: &str) {
    if let Err(e) = app.opener().open_url(url, None::<&str>) {
        tracing::warn!("lien non ouvert : {e}");
    }
}

pub(crate) fn open_site(app: &AppHandle, ctx: &Arc<Ctx>, game: Game, path: &str) {
    let path = if path.starts_with('/') { path } else { "/" };
    let url = format!("{}{}", ctx.client.sites.of(game), path);
    if ctx.client.sites.is_site_url(&url) {
        open_external(app, &url);
    }
}

pub(crate) fn apply_autostart(app: &AppHandle, ctx: &Arc<Ctx>) {
    let startup = ctx.state().settings.startup;
    let al = app.autolaunch();
    let r = match startup {
        Startup::Manual => al.disable(),
        Startup::Windows | Startup::Game => al.enable(),
    };
    if let Err(e) = r {
        tracing::warn!("démarrage avec Windows non réglé : {e}");
    }
}

pub(crate) fn close_requested(app: &AppHandle, ctx: &Arc<Ctx>) {
    match ctx.state().settings.close {
        CloseAction::Hide => windows::close_main(app),
        CloseAction::Quit => app.exit(0),
    }
    tray::update(app, ctx);
}

/// Oublie l'appareil (jeton effacé du coffre, état de synchro remis à zéro ; une passe en cours n'y réinscrira rien).
pub(crate) fn forget_device(ctx: &Arc<Ctx>) {
    ctx.set_token(None);
    {
        let mut st = ctx.state();
        st.device = None;
        st.setup_done = false;
    }
    ctx.reset_games();
    ctx.live().pairing = None;
    ctx.save();
}

#[cfg(test)]
mod tests {
    use super::tomorrow_at;

    #[test]
    fn jusqu_a_demain_en_heure_locale() {
        // 14/10/2026 21:30 UTC = 23:30 à Paris (UTC+2) : demain 6 h à Paris = 15/10 04:00 UTC
        let now = 1_792_013_400;
        assert_eq!(tomorrow_at(now, 7200, 6), 1_792_036_800);
        // 14/10/2026 23:30 UTC = 15/10 01:30 à Paris : « demain » est le 16/10, 6 h à Paris = 16/10 04:00 UTC
        assert_eq!(tomorrow_at(now + 7200, 7200, 6), 1_792_036_800 + 86400);
        // Sans décalage connu : 6 h UTC
        assert_eq!(tomorrow_at(now, 0, 6), 1_792_044_000);
    }
}

/// Le site a refusé le jeton (appareil délié dans Compte & sécurité) : retour à l'appairage.
pub(crate) fn unlinked(app: &AppHandle, ctx: &Arc<Ctx>) {
    tracing::warn!("jeton refusé par le site : appareil délié");
    forget_device(ctx);
    notify::unlinked(app, ctx);
    windows::show_main(app);
}
