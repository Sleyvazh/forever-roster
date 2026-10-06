//! Notifications Windows : coupées par défaut, chaque type activable dans les options.

use std::sync::Arc;

use rc_core::sync::GameState;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::ctx::Ctx;

fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("notification impossible : {e}");
    }
}

pub fn sent(app: &AppHandle, ctx: &Arc<Ctx>, gs: &GameState) {
    let n = ctx.state().settings.notifications.clone();
    if !(n.enabled && n.sent) {
        return;
    }
    if let Some(r) = &gs.report {
        show(app, "Envoyé au site", &r.items.join(", "));
    }
}

pub fn unknown(app: &AppHandle, ctx: &Arc<Ctx>, gs: &GameState) {
    let n = ctx.state().settings.notifications.clone();
    if !(n.enabled && n.unknown) {
        return;
    }
    let names: Vec<&str> = gs.unknown.values().map(|u| u.name.as_str()).collect();
    show(
        app,
        "Nouveau perso",
        &format!("{} : à créer sur le site ou à ignorer (ouvre Roster Companion).", names.join(", ")),
    );
}

pub fn error(app: &AppHandle, ctx: &Arc<Ctx>, message: &str) {
    let n = ctx.state().settings.notifications.clone();
    if !(n.enabled && n.errors) {
        return;
    }
    show(app, "Synchro en attente", message);
}

pub fn unlinked(app: &AppHandle, ctx: &Arc<Ctx>) {
    let n = ctx.state().settings.notifications.clone();
    if n.enabled && n.errors {
        show(
            app,
            "Appareil délié",
            "Roster Companion n'est plus relié à ton compte : ouvre l'appli pour le relier de nouveau.",
        );
    }
}
