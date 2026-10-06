//! Ce que l'interface affiche : un instantané de l'état, envoyé à chaque passe de la boucle (événement « status »).

use std::sync::Arc;

use rc_core::api::GroupSummary;
use rc_core::datafile::Report;
use rc_core::state::{LinkedDevice, Settings};
use rc_core::sync::HistoryLine;
use rc_core::wow::{Game, Install};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::ctx::{Ctx, GAMES};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Overall {
    Active,
    Idle,
    Paused,
    Error,
    Unlinked,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiInstall {
    pub path: String,
    pub dir_name: String,
    pub version: Option<String>,
    pub game: Option<Game>,
    pub test: bool,
    pub addon_version: Option<String>,
    pub data_addon: bool,
    pub accounts: usize,
    pub saved: usize,
}

impl UiInstall {
    pub fn of(i: &Install) -> Self {
        let accounts = i.accounts();
        UiInstall {
            path: i.path.to_string_lossy().into_owned(),
            dir_name: i.dir_name.clone(),
            version: i.version.clone(),
            game: i.game,
            test: i.test,
            addon_version: i.addon_version(),
            data_addon: i.data_addon_installed(),
            saved: accounts.iter().filter(|a| a.file.is_file()).count(),
            accounts: accounts.len(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiUnknown {
    pub key: String,
    pub name: String,
    pub cls: Option<String>,
    pub level: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiManual {
    pub key: String,
    pub label: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiGame {
    pub game: Game,
    pub label: &'static str,
    /// Retail : en attente de son addon (R3).
    pub enabled: bool,
    pub site: String,
    pub install: Option<UiInstall>,
    pub running: bool,
    pub restart_needed: bool,
    pub queue: usize,
    pub queue_errors: Vec<String>,
    pub unknown: Vec<UiUnknown>,
    pub manual: Vec<UiManual>,
    pub history: Vec<HistoryLine>,
    pub report: Option<Report>,
    pub groups: Vec<GroupSummary>,
    pub frg_at: i64,
    pub has_frg: bool,
    pub last_push: Option<i64>,
    pub last_pull: Option<i64>,
    pub last_error: Option<String>,
    pub read_error: Option<String>,
    pub retry_at: Option<i64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiPairing {
    pub user_code: String,
    pub verify_url: String,
    pub expires_at: i64,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiStatus {
    pub version: String,
    pub now: i64,
    pub overall: Overall,
    pub tooltip: String,
    pub device: Option<LinkedDevice>,
    pub setup_done: bool,
    pub paused_until: Option<i64>,
    pub settings: Settings,
    pub games: Vec<UiGame>,
    pub installs: Vec<UiInstall>,
    pub pairing: Option<UiPairing>,
    pub os: &'static str,
}

/// État général (icône, infobulle) : délié, pause, erreur, synchro active (jeu lancé) ou veille.
pub fn overall(ctx: &Arc<Ctx>) -> (Overall, String) {
    let now = rc_core::now();
    let st = ctx.state();
    if st.device.is_none() {
        return (Overall::Unlinked, "Roster Companion · pas encore relié à ton compte".into());
    }
    if let Some(t) = st.paused_until.filter(|t| *t > now) {
        let _ = t;
        return (Overall::Paused, "Roster Companion · synchro en pause".into());
    }
    let error = GAMES
        .iter()
        .filter_map(|g| st.games.get(g))
        .find_map(|gs| gs.last_error.clone().or_else(|| gs.read_error.clone()));
    if let Some(e) = error {
        return (Overall::Error, format!("Roster Companion · {}", short(&e, 90)));
    }
    let running = !ctx.live().running.is_empty();
    let last = GAMES.iter().filter_map(|g| st.games.get(g)).filter_map(|gs| gs.last_push).max();
    let when = last.map(|t| format!("\nDernier envoi : {}", hhmm(t))).unwrap_or_default();
    if running {
        (Overall::Active, format!("Roster Companion · synchro active{when}"))
    } else {
        (Overall::Idle, format!("Roster Companion · en veille{when}"))
    }
}

fn short(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

/// Heure locale « 21:42 » (l'infobulle n'a pas accès au JavaScript).
fn hhmm(t: i64) -> String {
    let offset = local_offset_s();
    let s = (t + offset).rem_euclid(86400);
    format!("{:02}:{:02}", s / 3600, (s % 3600) / 60)
}

/// Décalage de l'heure locale (Windows : heure d'été comprise, via l'API du système).
fn local_offset_s() -> i64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        #[allow(dead_code)]
        struct SystemTime {
            y: u16,
            m: u16,
            dow: u16,
            d: u16,
            h: u16,
            mi: u16,
            s: u16,
            ms: u16,
        }
        unsafe extern "system" {
            fn GetLocalTime(t: *mut SystemTime);
            fn GetSystemTime(t: *mut SystemTime);
        }
        let mut l = SystemTime {
            y: 0,
            m: 0,
            dow: 0,
            d: 0,
            h: 0,
            mi: 0,
            s: 0,
            ms: 0,
        };
        let mut u = SystemTime {
            y: 0,
            m: 0,
            dow: 0,
            d: 0,
            h: 0,
            mi: 0,
            s: 0,
            ms: 0,
        };
        // SAFETY : deux structures SYSTEMTIME valides, remplies par Windows
        unsafe {
            GetLocalTime(&mut l);
            GetSystemTime(&mut u);
        }
        let mins = |t: &SystemTime| (t.d as i64) * 1440 + (t.h as i64) * 60 + t.mi as i64;
        let mut diff = mins(&l) - mins(&u);
        // Passage de jour (ou de mois) entre heure locale et UTC
        if diff > 720 {
            diff -= 1440 * ((diff + 720) / 1440);
        } else if diff < -720 {
            diff += 1440 * ((-diff + 720) / 1440);
        }
        diff * 60
    }
    #[cfg(not(windows))]
    {
        0
    }
}

pub fn snapshot(app: &AppHandle, ctx: &Arc<Ctx>) -> UiStatus {
    let _ = app;
    let (overall, tooltip) = overall(ctx);
    let now = rc_core::now();
    let (installs, running, restart, pairing) = {
        let live = ctx.live();
        (live.installs.clone(), live.running.clone(), live.restart_needed.clone(), live.pairing.clone())
    };
    let st = ctx.state().clone();
    let games = [Game::Forever, Game::Retail]
        .into_iter()
        .map(|g| {
            let gs = st.games.get(&g).cloned().unwrap_or_default();
            let enabled = GAMES.contains(&g);
            UiGame {
                game: g,
                label: g.label(),
                enabled,
                site: ctx.client.sites.of(g).to_string(),
                install: ctx.install_for(g).map(|i| UiInstall::of(&i)),
                running: running.contains(&g),
                restart_needed: restart.contains(&g),
                queue: gs.queue.len(),
                queue_errors: gs
                    .queue
                    .values()
                    .filter_map(|q| q.error.as_ref().map(|e| format!("{} : {e}", q.label)))
                    .collect(),
                unknown: gs
                    .unknown
                    .iter()
                    .map(|(k, u)| UiUnknown {
                        key: k.clone(),
                        name: u.name.clone(),
                        cls: u.cls.clone(),
                        level: u.level,
                    })
                    .collect(),
                manual: gs
                    .manual
                    .iter()
                    .map(|(k, m)| UiManual {
                        key: k.clone(),
                        label: m.label.clone(),
                    })
                    .collect(),
                history: gs.history.iter().take(12).cloned().collect(),
                report: gs.report.clone(),
                groups: gs.groups.clone(),
                frg_at: gs.frg_at,
                has_frg: gs.frg.is_some(),
                last_push: gs.last_push,
                last_pull: gs.last_pull,
                last_error: gs.last_error.clone(),
                read_error: gs.read_error.clone(),
                retry_at: gs.retry_at,
            }
        })
        .collect();
    UiStatus {
        version: ctx.version.clone(),
        now,
        overall,
        tooltip,
        device: st.device.clone(),
        setup_done: st.setup_done,
        paused_until: st.paused_until.filter(|t| *t > now),
        settings: st.settings.clone(),
        games,
        installs: installs.iter().map(UiInstall::of).collect(),
        pairing: pairing.map(|p| UiPairing {
            user_code: p.start.user_code,
            verify_url: p.start.verify_url,
            expires_at: p.started_at + p.start.expires_in as i64,
            status: p.status,
            message: p.message,
        }),
        os: std::env::consts::OS,
    }
}

/// Envoie l'état à la fenêtre, si elle est ouverte.
pub fn emit(app: &AppHandle, ctx: &Arc<Ctx>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("status", snapshot(app, ctx));
    }
}
