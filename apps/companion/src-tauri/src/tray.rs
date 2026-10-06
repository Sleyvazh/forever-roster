//! Icône près de l'horloge : quatre états (synchro active, veille, pause, erreur), infobulle et menu.

use std::sync::Arc;

use rc_core::state::Startup;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::ctx::Ctx;
use crate::ui::{Overall, overall};

const ID: &str = "rc";
/// Mode « Avec le jeu » : l'icône reste 2 minutes après la fermeture du jeu (dernier envoi).
const LINGER_S: i64 = 120;

fn icon(state: Overall) -> Option<Image<'static>> {
    let bytes: &'static [u8] = match state {
        Overall::Active => include_bytes!("../icons/tray-active.png"),
        Overall::Idle => include_bytes!("../icons/tray-idle.png"),
        Overall::Paused => include_bytes!("../icons/tray-paused.png"),
        Overall::Error | Overall::Unlinked => include_bytes!("../icons/tray-error.png"),
    };
    Image::from_bytes(bytes).ok()
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Synchroniser maintenant", true, None::<&str>)?;
    let p1 = MenuItem::with_id(app, "pause_1h", "Pendant 1 heure", true, None::<&str>)?;
    let p2 = MenuItem::with_id(app, "pause_tomorrow", "Jusqu'à demain", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Reprendre", true, None::<&str>)?;
    let pause = Submenu::with_items(app, "Mettre en pause", true, &[&p1, &p2, &resume])?;
    let site_f = MenuItem::with_id(app, "site_forever", "Ouvrir Forever Roster", true, None::<&str>)?;
    let site_r = MenuItem::with_id(app, "site_retail", "Ouvrir Roster", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&open, &sync, &pause, &sep()?, &site_f, &site_r, &sep()?, &quit])?;

    TrayIconBuilder::with_id(ID)
        .icon(icon(Overall::Idle).ok_or_else(|| tauri::Error::AssetNotFound("icône".into()))?)
        .tooltip("Roster Companion")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let ctx = app.state::<Arc<Ctx>>().inner().clone();
            match ev.id().as_ref() {
                "open" => crate::windows::show_main(app),
                "sync" => crate::sync_now(&ctx),
                "pause_1h" => crate::pause(app, &ctx, Some(rc_core::now() + 3600)),
                "pause_tomorrow" => crate::pause(app, &ctx, Some(crate::tomorrow_morning())),
                "resume" => crate::pause(app, &ctx, None),
                "site_forever" => crate::open_site(app, &ctx, rc_core::wow::Game::Forever, "/"),
                "site_retail" => crate::open_site(app, &ctx, rc_core::wow::Game::Retail, "/"),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                crate::windows::toggle_main(tray.app_handle());
            }
        })
        .build(app)
}

/// Icône, infobulle et visibilité selon l'état (mode « Avec le jeu » : visible seulement autour d'une partie).
pub fn update(app: &AppHandle, ctx: &Arc<Ctx>) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    let (state, tip) = overall(ctx);
    let _ = tray.set_icon(icon(state));
    let _ = tray.set_tooltip(Some(tip));
    let startup = ctx.state().settings.startup;
    let visible = match startup {
        Startup::Game => {
            let live = ctx.live();
            !live.running.is_empty()
                || rc_core::now() - live.last_running_at < LINGER_S
                || app.get_webview_window("main").is_some()
                || state == Overall::Unlinked
        }
        _ => true,
    };
    let _ = tray.set_visible(visible);
}
