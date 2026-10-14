//! Boucle de fond : toutes les 5 secondes (ou dès qu'une sauvegarde change), regarde si le jeu tourne, lit les
//! sauvegardes, envoie au site, relève les données du site (toutes les 5 minutes par défaut) et écrit
//! `ForeverRoster_Data`. Une seule synchro à la fois (`sync_lock`).
//!
//! **Un seul chemin pour modifier l'état de synchro** (`AppState::games`). Une passe (`sync_game`) travaille sur
//! une copie de l'état du jeu pendant ses requêtes (jusqu'à 30 s) puis la réinscrit : tout ce qui changerait
//! `games` pendant ce temps serait écrasé. Donc :
//! - les commandes qui modifient `games` (« Créer la fiche », « Envoyer », « Ne plus ignorer »…) prennent
//!   `sync_lock` autour de leur modification : elles attendent la fin de la passe, jamais l'inverse ;
//! - « Synchroniser maintenant » ne modifie rien : c'est une **demande** (`Live::sync_requested`) que la passe
//!   consomme à son début, sous le verrou (sauvegardes relues, délai réseau ignoré, site relevé). Un clic pendant
//!   une passe laisse la demande notée et le réveil gardé par `Notify` : une nouvelle passe suit aussitôt, et
//!   l'interface affiche « en attente de la synchro en cours… » jusque-là ;
//! - ce qui remet `games` à zéro (appareil oublié, nouvel appairage) avance `Ctx::generation` : une passe commencée
//!   avant ne réinscrit pas sa copie, qui appartient à l'ancien appareil.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use rc_core::api::ApiError;
use rc_core::datafile::write_data_addon;
use rc_core::sync::{Engine, file_stamp};
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
    let stopped: Vec<(Game, i64)> = {
        let live = ctx.live();
        live.running
            .iter()
            .filter(|g| !running.contains(g))
            .map(|g| (*g, live.started_at.get(g).copied().unwrap_or(now)))
            .collect()
    };
    for (g, started) in &stopped {
        // Jeu fermé : l'addon de données est maintenant pris en compte au prochain lancement
        ctx.live().restart_needed.retain(|x| x != g);
        // Fermé sans avoir réécrit sa sauvegarde depuis son lancement (plantage, fin de tâche) : ce qui a été
        // fait en jeu ne partira qu'à la prochaine déconnexion normale, autant le dire (sans verrou sur `live`
        // pendant la lecture des dossiers)
        let saved = ctx
            .install_for(*g)
            .map(|i| {
                i.accounts()
                    .iter()
                    .any(|a| file_stamp(&a.file).is_some_and(|s| s.modified.div_euclid(1000) >= *started))
            })
            .unwrap_or(true);
        if !saved {
            tracing::info!("{} fermé sans réécrire sa sauvegarde (lancé depuis {started})", g.label());
            ctx.live().closed_without_save.insert(*g, *started);
        }
    }
    {
        let mut live = ctx.live();
        for (g, _) in &stopped {
            live.started_at.remove(g);
        }
        if !stopped.is_empty() {
            ctx.wake.notify_one();
        }
        for g in &running {
            live.started_at.entry(*g).or_insert(now);
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
    } else {
        // Pas de synchro possible : une demande « Synchroniser maintenant » n'attendrait rien
        ctx.live().sync_requested.clear();
    }

    crate::tray::update(app, ctx);
    crate::ui::emit(app, ctx);
    Ok(())
}

/// `Live::syncing` levé le temps d'une passe, retombé quoi qu'il arrive.
struct Syncing<'a>(&'a Ctx);

impl Drop for Syncing<'_> {
    fn drop(&mut self) {
        self.0.live().syncing = false;
    }
}

/// Une passe de synchro pour un jeu : lecture, envoi, relevé (si dû ou forcé), écriture de ForeverRoster_Data.
/// `force` (fin de l'installation) vaut une demande « Synchroniser maintenant ».
pub async fn sync_game(app: &AppHandle, ctx: &Arc<Ctx>, game: Game, token: &str, now: i64, force: bool) -> Result<(), ApiError> {
    let _guard = ctx.sync_lock.lock().await;
    let generation = ctx.generation.load(Ordering::SeqCst);
    // La demande « Synchroniser maintenant » est consommée ici, sous le verrou : une demande arrivée pendant la
    // passe reste pour la suivante (voir l'en-tête du fichier)
    let (requested, running) = {
        let mut live = ctx.live();
        live.syncing = true;
        let n = live.sync_requested.len();
        live.sync_requested.retain(|g| *g != game);
        (force || live.sync_requested.len() != n, live.running.contains(&game))
    };
    let _syncing = Syncing(ctx);
    let Some(inst) = ctx.install_for(game) else { return Ok(()) };
    if requested {
        crate::ui::emit(app, ctx);
    }
    let (mut gs, interval) = {
        let mut st = ctx.state();
        let interval = st.settings.pull_interval_s(running);
        (st.game(game).clone(), interval)
    };
    let before = gs.clone();
    let force_pull = requested;
    if requested {
        // Sauvegardes relues même si elles n'ont pas changé, délai d'attente réseau ignoré
        gs.retry_at = None;
        gs.files.clear();
    }

    let accounts = inst.accounts();
    gs.collect(&accounts, now);
    if gs.files != before.files {
        // Une sauvegarde a changé : le jeu a bien écrit, l'avertissement de fermeture sans sauvegarde n'a plus lieu
        ctx.live().closed_without_save.remove(&game);
    }
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
        let previous = gs.frg.clone();
        match engine.pull(&mut gs, now).await {
            Err(ApiError::Unauthorized) => return Err(ApiError::Unauthorized),
            Err(e) => result = Err(e),
            // Nouveautés pendant que le jeu tourne (pas au premier relevé, ni juste après un envoi : ce serait l'écho
            // de ce que le joueur vient de faire en jeu)
            Ok(true) if running && gs.last_push.is_none_or(|t| now - t > 90) => {
                if let (Some(old), Some(new)) = (previous.as_deref(), gs.frg.as_deref()) {
                    let what = rc_core::frg::changes(old, new, 3);
                    if !what.is_empty() {
                        crate::notify::fresh(app, ctx, &what);
                    }
                }
            }
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
                // Le jeu verrouille parfois le fichier un instant : réessayé au passage suivant, signalé seulement
                // au troisième échec de suite (et l'erreur disparaît dès qu'une écriture réussit)
                Err(e) => {
                    if gs.data_write_failed(&e.to_string()) {
                        tracing::error!("ForeverRoster_Data non écrit : {e}");
                    } else {
                        tracing::warn!("ForeverRoster_Data non écrit ({e}) : nouvel essai au prochain passage");
                    }
                }
            }
        }
    }

    if gs != before {
        ctx.store_game(game, gs, generation);
    }
    result
}
