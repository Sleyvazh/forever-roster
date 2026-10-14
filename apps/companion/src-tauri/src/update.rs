//! Mises à jour de l'appli (plugin updater de Tauri) : vérification au démarrage, une fois l'installation terminée,
//! puis une fois par jour, contre le `latest.json` de la dernière Release GitHub (`tauri.conf.json`, plugins > updater).
//! Rien n'est envoyé : l'appli lit seulement la liste des versions. Une version plus récente : notification (si
//! activées) et bandeau dans l'interface ; l'installateur n'est téléchargé que sur un clic, vérifié avec la clé
//! publique de signature (plugins > updater > pubkey) avant d'être lancé, et jamais pendant que le jeu tourne.
//! Tant que la clé publique n'est pas dans la configuration, aucune vérification n'est faite (l'interface le dit).

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Error as UpdError, Update, UpdaterExt};

use crate::ctx::Ctx;

/// Entre deux vérifications automatiques (heure du PC : tient compte d'une mise en veille) ; après un échec
/// (hors ligne au démarrage…), nouvel essai dans l'heure.
const EVERY_S: i64 = 24 * 3600;
const RETRY_S: i64 = 3600;
/// Après le démarrage, avant la première vérification (la première synchro passe d'abord).
const FIRST_DELAY: Duration = Duration::from_secs(20);
/// La boucle regarde toutes les heures si une vérification est due (toutes les minutes tant que l'installation
/// n'est pas terminée).
const TICK_READY: Duration = Duration::from_secs(3600);
const TICK_SETUP: Duration = Duration::from_secs(60);
/// Le relevé fait quelques Ko ; l'installateur quelques Mo.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Ce qui n'est pas enregistré : une vérification refaite à chaque démarrage, « Plus tard » vaut jusqu'au prochain.
#[derive(Default)]
pub struct Updates(Mutex<State>);

#[derive(Default)]
struct State {
    last_check: Option<i64>,
    /// Prochaine vérification automatique (0 : dès que possible).
    next_due: i64,
    checking: bool,
    /// Version plus récente trouvée (adresse et signature de l'installateur comprises).
    update: Option<Update>,
    /// « Plus tard » : bandeau caché jusqu'au prochain démarrage (ou une version encore plus récente).
    dismissed: bool,
    installing: bool,
    /// Octets reçus, taille annoncée.
    progress: Option<(u64, Option<u64>)>,
    /// Dernière erreur (vérification ou installation), en français, pour les options.
    error: Option<String>,
}

fn state(app: &AppHandle) -> MutexGuard<'_, State> {
    app.state::<Updates>().inner().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Clé publique de signature (tauri.conf.json, plugins > updater > pubkey) : vide tant que Flo ne l'a pas mise.
fn key_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/* ---------- Ce que l'interface voit ---------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiAvailable {
    pub version: String,
    /// Texte des changements (`notes` du manifeste : section du CHANGELOG).
    pub notes: Option<String>,
    pub date: Option<i64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiUpdate {
    pub key_configured: bool,
    pub current: String,
    pub last_check: Option<i64>,
    pub checking: bool,
    pub available: Option<UiAvailable>,
    pub dismissed: bool,
    pub installing: bool,
    /// Téléchargement : pourcentage, si la taille est connue.
    pub progress: Option<u8>,
    pub error: Option<String>,
}

pub fn snapshot(app: &AppHandle) -> UiUpdate {
    let current = app.state::<Arc<Ctx>>().version.clone();
    let s = state(app);
    UiUpdate {
        key_configured: key_configured(app),
        current,
        last_check: s.last_check,
        checking: s.checking,
        available: s.update.as_ref().map(|u| UiAvailable {
            version: u.version.clone(),
            notes: u.body.clone(),
            date: u.date.map(|d| d.unix_timestamp()),
        }),
        dismissed: s.dismissed,
        installing: s.installing,
        progress: s
            .progress
            .and_then(|(done, total)| total.map(|t| (done.saturating_mul(100) / t.max(1)).min(100) as u8)),
        error: s.error.clone(),
    }
}

/// Envoie l'état des mises à jour à la fenêtre (événement « update »), si elle est ouverte.
fn emit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::windows::MAIN) {
        let _ = w.emit("update", snapshot(app));
    }
}

/// Erreur du plugin en français court (les erreurs réseau restent silencieuses dans l'interface).
fn explain(e: &UpdError) -> String {
    match e {
        UpdError::Reqwest(r) if r.is_timeout() => "GitHub ne répond pas (délai dépassé)".into(),
        UpdError::Reqwest(r) if r.is_connect() => "GitHub injoignable (connexion impossible)".into(),
        UpdError::Reqwest(r) => format!("GitHub : {r}"),
        UpdError::Network(s) => format!("téléchargement impossible : {s}"),
        UpdError::ReleaseNotFound => "aucune version publiée pour l'instant".into(),
        UpdError::TargetNotFound(_) | UpdError::TargetsNotFound(_) => "pas d'installateur Windows dans cette version".into(),
        UpdError::Minisign(_) | UpdError::Base64(_) | UpdError::SignatureUtf8(_) => "signature de l'installateur invalide : mise à jour refusée".into(),
        UpdError::SignedVersionMismatch { .. } | UpdError::MissingSignedVersion => {
            "la signature ne correspond pas à la version annoncée : mise à jour refusée".into()
        }
        other => other.to_string(),
    }
}

/* ---------- Boucle ---------- */

/// Vérification 20 s après le démarrage (une fois l'installation terminée : rien pendant l'appairage), puis une
/// fois par jour (regardé toutes les heures).
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if !key_configured(&app) {
            tracing::info!("mises à jour : clé de signature pas encore configurée, aucune vérification");
            return;
        }
        let ctx = app.state::<Arc<Ctx>>().inner().clone();
        tokio::time::sleep(FIRST_DELAY).await;
        loop {
            let ready = {
                let st = ctx.state();
                st.setup_done && st.device.is_some()
            };
            if ready && rc_core::now() >= state(&app).next_due {
                let _ = check(&app, false).await;
            }
            tokio::time::sleep(if ready { TICK_READY } else { TICK_SETUP }).await;
        }
    });
}

/// Une vérification. À la main (options), l'erreur revient en texte ; en automatique, journal INFO seulement.
pub async fn check(app: &AppHandle, manual: bool) -> Result<UiUpdate, String> {
    if !key_configured(app) {
        return Err("Mises à jour : clé de signature pas encore configurée.".into());
    }
    let already = {
        let mut s = state(app);
        let already = s.checking;
        s.checking = true;
        already
    };
    if already {
        return Ok(snapshot(app));
    }
    emit(app);
    let found = async {
        let updater = app.updater_builder().timeout(CHECK_TIMEOUT).build()?;
        updater.check().await
    }
    .await;
    let current = app.state::<Arc<Ctx>>().version.clone();
    let (newer, error) = {
        let now = rc_core::now();
        let mut s = state(app);
        s.checking = false;
        s.last_check = Some(now);
        s.next_due = now + if found.is_ok() { EVERY_S } else { RETRY_S };
        match found {
            Ok(Some(u)) => {
                let newer = s.update.as_ref().is_none_or(|old| old.version != u.version);
                if newer {
                    tracing::info!("mise à jour disponible : {} (version actuelle {current})", u.version);
                    s.dismissed = false;
                }
                s.update = Some(u);
                s.error = None;
                (newer, None)
            }
            Ok(None) => {
                tracing::info!("mises à jour : {current} est la dernière version");
                s.update = None;
                s.error = None;
                (false, None)
            }
            Err(e) => {
                let text = explain(&e);
                tracing::info!("vérification des mises à jour impossible : {text}");
                s.error = Some(text.clone());
                (false, Some(text))
            }
        }
    };
    if newer {
        notify(app);
    }
    emit(app);
    match error {
        Some(e) if manual => Err(format!("Vérification impossible : {e}.")),
        _ => Ok(snapshot(app)),
    }
}

/// Notification Windows « Version X disponible » (si les notifications sont activées).
fn notify(app: &AppHandle) {
    let ctx = app.state::<Arc<Ctx>>();
    if !ctx.state().settings.notifications.enabled {
        return;
    }
    let Some(version) = state(app).update.as_ref().map(|u| u.version.clone()) else {
        return;
    };
    let r = app
        .notification()
        .builder()
        .title(format!("Roster Companion {version} disponible"))
        .body("Ouvre l'appli pour l'installer (pas pendant que le jeu tourne).")
        .show();
    if let Err(e) = r {
        tracing::warn!("notification impossible : {e}");
    }
}

/// Télécharge, vérifie la signature, lance l'installateur et relance l'appli. Jamais pendant que le jeu tourne,
/// jamais pendant une synchro.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    const GAME_RUNNING: &str = "Ferme le jeu d'abord : l'installateur remplace l'appli puis la relance.";
    let ctx = app.state::<Arc<Ctx>>().inner().clone();
    let update = {
        let mut s = state(app);
        if s.installing {
            return Err("Installation déjà en cours.".into());
        }
        let Some(u) = s.update.clone() else {
            return Err("Aucune mise à jour à installer : vérifie d'abord dans les options.".into());
        };
        if !ctx.live().running.is_empty() {
            return Err(GAME_RUNNING.into());
        }
        s.installing = true;
        s.progress = Some((0, None));
        s.error = None;
        u
    };
    emit(app);
    tracing::info!("mise à jour {} : téléchargement de l'installateur", update.version);

    let mut done: u64 = 0;
    let mut shown = Instant::now();
    let progress_app = app.clone();
    let mut download = update.clone();
    download.timeout = Some(DOWNLOAD_TIMEOUT);
    let downloaded = download
        .download(
            |chunk, total| {
                done += chunk as u64;
                if shown.elapsed() >= Duration::from_millis(300) {
                    shown = Instant::now();
                    state(&progress_app).progress = Some((done, total));
                    emit(&progress_app);
                }
            },
            || {},
        )
        .await;
    let bytes = match downloaded {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("mise à jour {} : {e}", update.version);
            let why = explain(&e);
            abort(app, &why);
            return Err(format!("Mise à jour non installée : {why}."));
        }
    };
    // Le jeu a pu être lancé pendant le téléchargement : même règle
    if !ctx.live().running.is_empty() {
        abort(app, "le jeu tourne");
        return Err(GAME_RUNNING.into());
    }
    // Pas pendant une synchro (écriture dans le dossier du jeu, état enregistré) : on attend qu'elle finisse
    let _sync = ctx.sync_lock.lock().await;
    tracing::info!("mise à jour {} : installateur vérifié, lancement", update.version);
    // Le journal est écrit par un fil à part : lui laisser le temps avant la sortie du processus
    tokio::time::sleep(Duration::from_millis(300)).await;
    if let Err(e) = update.install(bytes) {
        tracing::error!("mise à jour {} : installateur non lancé : {e}", update.version);
        let why = explain(&e);
        abort(app, &why);
        return Err(format!("Mise à jour non installée : {why}."));
    }
    // Windows : install() a lancé l'installateur (qui relance l'appli) et quitté le processus. Ailleurs, on relance.
    app.restart()
}

/// Installation abandonnée : l'interface retrouve le bandeau, avec la raison.
fn abort(app: &AppHandle, why: &str) {
    {
        let mut s = state(app);
        s.installing = false;
        s.progress = None;
        s.error = Some(why.to_string());
    }
    emit(app);
}

/* ---------- Commandes ---------- */

#[tauri::command]
pub fn update_status(app: AppHandle) -> UiUpdate {
    snapshot(&app)
}

/// « Vérifier maintenant » (options).
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UiUpdate, String> {
    check(&app, true).await
}

/// « Installer » (bandeau ou options).
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    install(&app).await
}

/// « Plus tard » : bandeau caché jusqu'au prochain démarrage.
#[tauri::command]
pub fn dismiss_update(app: AppHandle) {
    state(&app).dismissed = true;
    emit(&app);
}
