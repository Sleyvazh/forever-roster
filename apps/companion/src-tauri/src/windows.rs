//! La fenêtre (barre de titre maison, comme la maquette) : créée à l'ouverture, détruite à la fermeture pour que
//! l'appli ne garde presque rien en mémoire quand elle tourne en fond.

use tauri::webview::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const MAIN: &str = "main";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Roster Companion")
        .inner_size(400.0, 680.0)
        .min_inner_size(400.0, 520.0)
        .resizable(true)
        .maximizable(false)
        .decorations(false)
        .shadow(true)
        .center()
        // Fond du thème sombre : pas d'éclair blanc à l'ouverture
        .background_color(Color(14, 20, 39, 255))
        .focused(true)
        .build();
    if let Err(e) = built {
        tracing::error!("fenêtre impossible à ouvrir : {e}");
    }
}

pub fn toggle_main(app: &AppHandle) {
    match app.get_webview_window(MAIN) {
        Some(w) if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) => close_main(app),
        _ => show_main(app),
    }
}

/// Ferme la fenêtre (l'appli continue près de l'horloge).
pub fn close_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.destroy();
    }
}
