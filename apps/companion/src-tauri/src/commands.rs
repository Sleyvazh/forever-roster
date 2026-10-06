//! Commandes appelées par l'interface (`invoke`). Les erreurs reviennent en texte lisible.

use std::path::PathBuf;
use std::sync::Arc;

use rc_core::api::{ApiError, DeviceDescription, PairPoll};
use rc_core::state::{LinkedDevice, Settings};
use rc_core::sync::{Engine, dismiss_manual as dismiss};
use rc_core::wow::{Game, scan_root};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::ctx::{Ctx, GAMES, Pairing};
use crate::ui::{UiStatus, snapshot};

type Ctxs<'a> = State<'a, Arc<Ctx>>;

fn refresh(app: &AppHandle, ctx: &Arc<Ctx>) {
    crate::tray::update(app, ctx);
    crate::ui::emit(app, ctx);
}

#[tauri::command]
pub fn get_status(app: AppHandle, ctx: Ctxs<'_>) -> UiStatus {
    snapshot(&app, ctx.inner())
}

/* ---------- Appairage ---------- */

fn device_name() -> String {
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .unwrap_or_else(|| "PC".into());
    let name: String = raw.trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if name.is_empty() { "PC".into() } else { name }
}

fn os_label() -> String {
    let name = sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string());
    name.chars().take(40).collect()
}

/// Demande un code d'appairage, puis attend la réponse du joueur en fond (événement « status » à chaque étape).
#[tauri::command]
pub async fn pair_start(app: AppHandle, ctx: Ctxs<'_>) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    let info = DeviceDescription {
        name: device_name(),
        platform: os_label(),
        app_version: ctx.version.clone(),
    };
    let start = ctx.client.pair_start(&info).await.map_err(|e| e.to_string())?;
    let now = rc_core::now();
    ctx.live().pairing = Some(Pairing {
        start: start.clone(),
        started_at: now,
        status: "pending".into(),
        message: None,
    });
    refresh(&app, &ctx);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = start.interval.max(5);
        let deadline = now + start.expires_in as i64 + 30;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
            // Annulé, ou remplacé par une nouvelle demande
            if ctx.live().pairing.as_ref().is_none_or(|p| p.start.pair_id != start.pair_id) {
                return;
            }
            let set = |status: &str, message: Option<String>| {
                if let Some(p) = ctx.live().pairing.as_mut() {
                    p.status = status.into();
                    p.message = message;
                }
            };
            if rc_core::now() > deadline {
                set("expired", None);
                refresh(&app2, &ctx);
                return;
            }
            match ctx.client.pair_poll(&start.pair_id).await {
                Ok(PairPoll::Pending) => set("pending", None),
                Ok(PairPoll::SlowDown) => interval += 5,
                Ok(PairPoll::Denied) => {
                    set("denied", None);
                    refresh(&app2, &ctx);
                    return;
                }
                Ok(PairPoll::Expired) => {
                    set("expired", None);
                    refresh(&app2, &ctx);
                    return;
                }
                Ok(PairPoll::Approved { token, device }) => {
                    ctx.set_token(Some(&token));
                    let user = ctx.client.me(&token).await.map(|m| m.user.display_name).unwrap_or_default();
                    {
                        let mut st = ctx.state();
                        st.device = Some(LinkedDevice {
                            id: device.id,
                            name: device.name.clone(),
                            user,
                            linked_at: rc_core::now(),
                        });
                        // Nouveau compte : rien de l'ancien ne doit servir
                        st.games.clear();
                    }
                    ctx.save();
                    tracing::info!("appareil relié : {}", device.name);
                    set("approved", None);
                    ctx.live().force_pull = true;
                    ctx.wake.notify_one();
                    refresh(&app2, &ctx);
                    return;
                }
                Err(e) if e.retryable() => set("pending", Some(format!("Le site ne répond pas ({e}) : nouvel essai…"))),
                Err(e) => {
                    set("error", Some(e.to_string()));
                    refresh(&app2, &ctx);
                    return;
                }
            }
            refresh(&app2, &ctx);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn pair_cancel(app: AppHandle, ctx: Ctxs<'_>) {
    ctx.live().pairing = None;
    refresh(&app, ctx.inner());
}

/* ---------- Dossiers du jeu ---------- */

/// Utiliser ce dossier (parmi ceux trouvés) pour un jeu.
#[tauri::command]
pub fn use_install(app: AppHandle, ctx: Ctxs<'_>, game: Game, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !ctx.live().installs.iter().any(|i| i.path == path) {
        return Err("Dossier inconnu : relance la recherche.".into());
    }
    ctx.state().settings.folders.insert(game, path);
    ctx.save();
    ctx.wake.notify_one();
    refresh(&app, ctx.inner());
    Ok(())
}

/// Choisir un dossier à la main (autre disque, Lutris…) : « World of Warcraft » ou directement « _classic_ ».
#[tauri::command]
pub async fn pick_folder(app: AppHandle, ctx: Ctxs<'_>, game: Game) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Dossier de World of Warcraft").pick_folder(move |f| {
        let _ = tx.send(f.and_then(|p| p.into_path().ok()));
    });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let found = scan_root(&picked);
    let chosen = found.iter().find(|i| i.game == Some(game)).or_else(|| found.first()).cloned();
    let Some(inst) = chosen else {
        return Err("Aucun dossier de jeu ici : choisis le dossier « World of Warcraft » (celui qui contient _classic_ ou _retail_).".into());
    };
    let root = inst.path.parent().map(PathBuf::from).unwrap_or_else(|| picked.clone());
    {
        let mut st = ctx.state();
        if !st.settings.extra_roots.contains(&root) {
            st.settings.extra_roots.push(root);
        }
        st.settings.folders.insert(game, inst.path.clone());
    }
    ctx.save();
    ctx.live().installs_at = 0;
    ctx.wake.notify_one();
    refresh(&app, ctx.inner());
    Ok(true)
}

/// Relance la recherche des dossiers du jeu.
#[tauri::command]
pub fn rescan(ctx: Ctxs<'_>) {
    ctx.live().installs_at = 0;
    ctx.wake.notify_one();
}

/// Fin de l'appairage : addon de données installé, démarrage réglé, première synchro.
/// Site injoignable : l'installation se termine quand même (la synchro réessaie toute seule) ; dossier du jeu
/// impossible à écrire : erreur, car l'addon ne recevrait rien.
#[tauri::command]
pub async fn finish_setup(app: AppHandle, ctx: Ctxs<'_>) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    let token = ctx.token().ok_or("Appareil non relié.")?;
    let now = rc_core::now();
    for g in GAMES {
        match crate::runner::sync_game(&app, &ctx, g, &token, now, true).await {
            Err(ApiError::Unauthorized) => {
                crate::unlinked(&app, &ctx);
                refresh(&app, &ctx);
                return Err("Cet appareil a été délié sur le site : recommence l'appairage.".into());
            }
            Err(e) => tracing::warn!("première synchro de {} : {e} (nouvel essai plus tard)", g.label()),
            Ok(()) => {}
        }
        if let Some(inst) = ctx.install_for(g)
            && !inst.data_addon_installed()
        {
            let why = ctx.state().games.get(&g).and_then(|gs| gs.last_error.clone());
            return Err(why.unwrap_or_else(|| "ForeverRoster_Data n'a pas pu être installé dans le dossier du jeu.".into()));
        }
    }
    ctx.state().setup_done = true;
    ctx.live().pairing = None;
    ctx.save();
    crate::apply_autostart(&app, &ctx);
    refresh(&app, &ctx);
    Ok(())
}

/* ---------- Synchro ---------- */

#[tauri::command]
pub fn sync_now(ctx: Ctxs<'_>) {
    crate::sync_now(ctx.inner());
}

fn engine_token(ctx: &Arc<Ctx>) -> Result<String, String> {
    ctx.token().ok_or_else(|| "Appareil non relié.".to_string())
}

/// Persos inconnus : « Créer la fiche » ou « Ignorer ».
#[tauri::command]
pub async fn resolve_unknown(app: AppHandle, ctx: Ctxs<'_>, game: Game, create: Vec<String>, ignore: Vec<String>) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    let token = engine_token(&ctx)?;
    let _g = ctx.sync_lock.lock().await;
    let mut gs = ctx.state().game(game).clone();
    let r = Engine {
        api: &ctx.client,
        game,
        token: &token,
    }
    .resolve(&mut gs, &create, &ignore, rc_core::now())
    .await;
    ctx.state().games.insert(game, gs);
    ctx.save();
    drop(_g);
    ctx.wake.notify_one();
    refresh(&app, &ctx);
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Bilan qui n'est pas celui du chef de raid : l'envoyer quand même (il remplace le bilan du site).
#[tauri::command]
pub async fn send_manual(app: AppHandle, ctx: Ctxs<'_>, game: Game, key: String) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    let token = engine_token(&ctx)?;
    let _g = ctx.sync_lock.lock().await;
    let mut gs = ctx.state().game(game).clone();
    let r = Engine {
        api: &ctx.client,
        game,
        token: &token,
    }
    .send_manual(&mut gs, &key, rc_core::now())
    .await;
    ctx.state().games.insert(game, gs);
    ctx.save();
    drop(_g);
    ctx.wake.notify_one();
    refresh(&app, &ctx);
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Ne pas envoyer ce bilan (l'addon arrête de le proposer).
#[tauri::command]
pub async fn dismiss_manual(app: AppHandle, ctx: Ctxs<'_>, game: Game, key: String) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    let _g = ctx.sync_lock.lock().await;
    let now = rc_core::now();
    dismiss(ctx.state().game(game), &key, now);
    ctx.save();
    drop(_g);
    ctx.wake.notify_one();
    refresh(&app, &ctx);
    Ok(())
}

#[tauri::command]
pub fn pause(app: AppHandle, ctx: Ctxs<'_>, minutes: Option<u32>, tomorrow: Option<bool>) {
    let until = if tomorrow.unwrap_or(false) {
        Some(crate::tomorrow_morning())
    } else {
        minutes.map(|m| rc_core::now() + i64::from(m.clamp(1, 24 * 60)) * 60)
    };
    crate::pause(&app, ctx.inner(), until);
}

/* ---------- Réglages ---------- */

#[tauri::command]
pub fn set_settings(app: AppHandle, ctx: Ctxs<'_>, settings: Settings) -> Result<(), String> {
    if ![1, 5, 15].contains(&settings.sync_minutes) {
        return Err("Délai de synchro invalide.".into());
    }
    {
        let mut st = ctx.state();
        // Les dossiers se changent par leurs propres commandes
        let folders = st.settings.folders.clone();
        let roots = st.settings.extra_roots.clone();
        st.settings = Settings {
            folders,
            extra_roots: roots,
            ..settings
        };
    }
    ctx.save();
    crate::apply_autostart(&app, ctx.inner());
    refresh(&app, ctx.inner());
    Ok(())
}

#[tauri::command]
pub async fn ignored_list(ctx: Ctxs<'_>, game: Game) -> Result<Vec<String>, String> {
    let token = engine_token(ctx.inner())?;
    Ok(ctx
        .client
        .ignored(game, &token)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|k| k.key)
        .collect())
}

#[tauri::command]
pub async fn unignore(ctx: Ctxs<'_>, game: Game, keys: Vec<String>) -> Result<u32, String> {
    let token = engine_token(ctx.inner())?;
    let n = ctx.client.unignore(game, &token, &keys).await.map_err(|e| e.to_string())?;
    // Ces persos seront proposés de nouveau au prochain envoi
    {
        let mut st = ctx.state();
        let gs = st.game(game);
        for k in &keys {
            gs.sent.remove(k);
        }
        gs.files.clear();
        gs.outbox_at.clear();
    }
    ctx.save();
    ctx.wake.notify_one();
    Ok(n)
}

/// Délier cet appareil (sur le site aussi, si le site répond).
#[tauri::command]
pub async fn unlink(app: AppHandle, ctx: Ctxs<'_>) -> Result<Option<String>, String> {
    let ctx = ctx.inner().clone();
    let mut warning = None;
    if let Some(token) = ctx.token()
        && let Err(e) = ctx.client.unlink(&token).await
        && !matches!(e, rc_core::api::ApiError::Unauthorized)
    {
        warning = Some(format!(
            "Le site n'a pas pu être prévenu ({e}) : délie aussi l'appareil dans Compte & sécurité."
        ));
    }
    crate::forget_device(&ctx);
    tracing::info!("appareil délié depuis l'appli");
    refresh(&app, &ctx);
    Ok(warning)
}

/* ---------- Journal ---------- */

/// Les 300 dernières lignes du journal (fichier du jour, ou le plus récent).
#[tauri::command]
pub fn journal(ctx: Ctxs<'_>) -> Vec<String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(&ctx.log_dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "log")).collect())
        .unwrap_or_default();
    files.sort();
    let text = files.last().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    let lines: Vec<String> = text.lines().map(str::to_string).collect();
    lines[lines.len().saturating_sub(300)..].to_vec()
}

/// Diagnostic à copier (version, système, dossiers, état de la synchro, fin du journal). Jamais le jeton.
#[tauri::command]
pub fn diagnostic(app: AppHandle, ctx: Ctxs<'_>) -> String {
    let s = snapshot(&app, ctx.inner());
    let mut out = format!(
        "Roster Companion {} · {}\nÉtat : {:?} · {}\n",
        s.version,
        os_label(),
        s.overall,
        s.tooltip.replace('\n', " · ")
    );
    out.push_str(&format!(
        "Relié : {}\n",
        s.device.as_ref().map(|d| format!("{} ({})", d.name, d.user)).unwrap_or_else(|| "non".into())
    ));
    out.push_str(&format!(
        "Démarrage : {:?} · synchro toutes les {} min\n",
        s.settings.startup, s.settings.sync_minutes
    ));
    for i in &s.installs {
        out.push_str(&format!(
            "Dossier : {} · {:?} · {} · addon {} · données {} · comptes {} ({} sauvegardes)\n",
            i.path,
            i.game,
            i.version.clone().unwrap_or_default(),
            i.addon_version.clone().unwrap_or_else(|| "absent".into()),
            if i.data_addon { "oui" } else { "non" },
            i.accounts,
            i.saved
        ));
    }
    for g in &s.games {
        out.push_str(&format!(
            "{} : jeu {} · file {} · inconnus {} · à la main {} · dernier envoi {:?} · dernier relevé {:?} · erreur {:?} · lecture {:?}\n",
            g.label,
            if g.running { "lancé" } else { "fermé" },
            g.queue,
            g.unknown.len(),
            g.manual.len(),
            g.last_push,
            g.last_pull,
            g.last_error,
            g.read_error
        ));
    }
    out.push_str("--- journal ---\n");
    let lines = journal(ctx);
    for l in &lines[lines.len().saturating_sub(60)..] {
        out.push_str(l);
        out.push('\n');
    }
    out
}

/* ---------- Fenêtre ---------- */

#[tauri::command]
pub fn open_site(app: AppHandle, ctx: Ctxs<'_>, game: Game, path: String) {
    crate::open_site(&app, ctx.inner(), game, &path);
}

#[tauri::command]
pub fn open_url(app: AppHandle, ctx: Ctxs<'_>, url: String) -> Result<(), String> {
    if !ctx.client.sites.is_site_url(&url) {
        return Err("Lien refusé.".into());
    }
    crate::open_external(&app, &url);
    Ok(())
}

/// ✕ de la barre de titre : cacher (par défaut) ou quitter, selon les options.
#[tauri::command]
pub fn window_close(app: AppHandle, ctx: Ctxs<'_>) {
    crate::close_requested(&app, ctx.inner());
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window(crate::windows::MAIN) {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
