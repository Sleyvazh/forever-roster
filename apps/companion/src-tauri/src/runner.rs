//! Boucle de fond : toutes les 5 secondes (ou dès qu'une sauvegarde change), regarde si le jeu tourne, lit les
//! sauvegardes, envoie au site, relève les données du site (toutes les 5 minutes par défaut) et écrit
//! `ForeverRoster_Data`. Une seule synchro à la fois (`sync_lock`).

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use rc_core::api::ApiError;
use rc_core::datafile::write_data_addon;
use rc_core::sync::Engine;
use rc_core::wow::{Game, detect, is_inside};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Manager};

use crate::ctx::{Ctx, GAMES};

const TICK: Duration = Duration::from_secs(5);
const RESCAN_S: i64 = 60;

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let ctx = app.state::<Arc<Ctx>>().inner().clone();
        let mut sys = System::new();
        let mut watch = Watch::default();
        loop {
            if let Err(e) = tick(&app, &ctx, &mut sys, &mut watch).await {
                tracing::error!("boucle de synchro : {e}");
            }
            tokio::select! {
                _ = ctx.wake.notified() => {
                    // Laisse le jeu finir d'écrire la sauvegarde
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                }
                _ = tokio::time::sleep(TICK) => {}
            }
        }
    });
}

/// Surveillance des dossiers SavedVariables (le jeu y réécrit la sauvegarde à la déconnexion et au /reload).
#[derive(Default)]
struct Watch {
    watcher: Option<notify::RecommendedWatcher>,
    dirs: BTreeSet<PathBuf>,
}

impl Watch {
    fn set(&mut self, ctx: &Arc<Ctx>, dirs: BTreeSet<PathBuf>) {
        if dirs == self.dirs && self.watcher.is_some() {
            return;
        }
        let c = ctx.clone();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res
                && ev
                    .paths
                    .iter()
                    .any(|p| p.file_name().is_some_and(|n| n.eq_ignore_ascii_case("ForeverRoster.lua")))
            {
                c.wake.notify_one();
            }
        });
        match w {
            Ok(mut w) => {
                for d in &dirs {
                    if d.is_dir()
                        && let Err(e) = w.watch(d, RecursiveMode::NonRecursive)
                    {
                        tracing::warn!("surveillance impossible de {} : {e}", d.display());
                    }
                }
                self.watcher = Some(w);
                self.dirs = dirs;
            }
            Err(e) => tracing::warn!("surveillance des sauvegardes indisponible : {e} (relecture toutes les 5 s)"),
        }
    }
}

async fn tick(app: &AppHandle, ctx: &Arc<Ctx>, sys: &mut System, watch: &mut Watch) -> Result<(), String> {
    let now = rc_core::now();

    // 1. Dossiers du jeu (relus chaque minute)
    let rescan = { now - ctx.live().installs_at >= RESCAN_S };
    if rescan {
        let roots = ctx.state().settings.extra_roots.clone();
        let installs = tauri::async_runtime::spawn_blocking(move || detect(&roots)).await.map_err(|e| e.to_string())?;
        let mut live = ctx.live();
        live.installs = installs;
        live.installs_at = now;
    }

    // 2. Jeu lancé ? (un exécutable dont le chemin est dans le dossier du jeu)
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    let mut running = Vec::new();
    for g in GAMES {
        if let Some(inst) = ctx.install_for(g)
            && sys.processes().values().any(|p| p.exe().is_some_and(|exe| is_inside(exe, &inst.path)))
        {
            running.push(g);
        }
    }
    {
        let mut live = ctx.live();
        let stopped: Vec<Game> = live.running.iter().copied().filter(|g| !running.contains(g)).collect();
        if !stopped.is_empty() {
            // Jeu fermé : l'addon de données est maintenant pris en compte au prochain lancement
            live.restart_needed.retain(|g| !stopped.contains(g));
            ctx.wake.notify_one();
        }
        if !running.is_empty() {
            live.last_running_at = now;
        }
        live.running = running;
    }

    // 3. Synchro (sauf pause, appareil non relié, ou installation pas terminée : rien ne part ni n'est écrit dans
    // le dossier du jeu avant « Installer et terminer », qui fait la première synchro)
    let (paused, linked, setup_done) = {
        let st = ctx.state();
        (st.paused_until.is_some_and(|t| t > now), st.device.is_some(), st.setup_done)
    };
    let token = ctx.token();
    if !paused
        && linked
        && setup_done
        && let Some(token) = token
    {
        let mut dirs = BTreeSet::new();
        for g in GAMES {
            if let Some(inst) = ctx.install_for(g) {
                for a in inst.accounts() {
                    dirs.insert(a.dir);
                }
            }
            match sync_game(app, ctx, g, &token, now, false).await {
                Err(ApiError::Unauthorized) => {
                    crate::unlinked(app, ctx);
                    break;
                }
                Err(e) => tracing::debug!("synchro {} : {e}", g.label()),
                Ok(()) => {}
            }
        }
        watch.set(ctx, dirs);
    }

    crate::tray::update(app, ctx);
    crate::ui::emit(app, ctx);
    Ok(())
}

/// Une passe de synchro pour un jeu : lecture, envoi, relevé (si dû ou forcé), écriture de ForeverRoster_Data.
pub async fn sync_game(app: &AppHandle, ctx: &Arc<Ctx>, game: Game, token: &str, now: i64, force: bool) -> Result<(), ApiError> {
    let Some(inst) = ctx.install_for(game) else { return Ok(()) };
    let _guard = ctx.sync_lock.lock().await;
    let (mut gs, interval) = {
        let mut st = ctx.state();
        let interval = st.settings.sync_interval_s();
        (st.game(game).clone(), interval)
    };
    let before = gs.clone();
    let force_pull = force || std::mem::take(&mut ctx.live().force_pull);
    if force {
        gs.retry_at = None;
    }

    let accounts = inst.accounts();
    gs.collect(&accounts, now);
    let engine = Engine { api: &ctx.client, game, token };
    let mut result = Ok(());
    let pushed = engine.push(&mut gs, now).await;
    match &pushed {
        Ok(o) if o.accepted > 0 => crate::notify::sent(app, ctx, &gs),
        Ok(o) if o.unknown > 0 => crate::notify::unknown(app, ctx, &gs),
        Err(ApiError::Unauthorized) => return Err(ApiError::Unauthorized),
        Err(e) => {
            crate::notify::error(app, ctx, &e.to_string());
        }
        _ => {}
    }
    if let Err(e) = pushed {
        result = Err(e);
    }
    let due = gs.last_pull.is_none_or(|t| now - t >= interval);
    if force_pull || due {
        match engine.pull(&mut gs, now).await {
            Err(ApiError::Unauthorized) => return Err(ApiError::Unauthorized),
            Err(e) => result = Err(e),
            Ok(_) => {}
        }
    }

    // ForeverRoster_Data et ses copies : seulement si le contenu change (ou toutes les 12 h), ou si un dossier manque
    let addons = inst.addons_dir();
    if addons.is_dir() {
        let data = gs.data_file(&ctx.version, now);
        let complete = rc_core::datafile::data_addon_complete(&addons);
        if gs.data_needs_write(&data, now, complete) {
            let (dir, file) = (addons.clone(), data.clone());
            let written = tokio::task::spawn_blocking(move || write_data_addon(&dir, &file, now))
                .await
                .unwrap_or_else(|e| Err(std::io::Error::other(e.to_string())));
            match written {
                Ok(created) => {
                    gs.data_written(&data, now);
                    if created {
                        tracing::info!("addon ForeverRoster_Data installé dans {}", addons.display());
                        let mut live = ctx.live();
                        if live.running.contains(&game) && !live.restart_needed.contains(&game) {
                            live.restart_needed.push(game);
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("ForeverRoster_Data non écrit : {e}");
                    gs.last_error = Some(format!("Impossible d'écrire les données pour le jeu : {e}"));
                }
            }
        }
    }

    if gs != before {
        ctx.state().games.insert(game, gs);
        ctx.save();
    }
    result
}
