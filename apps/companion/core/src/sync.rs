//! Moteur de synchro d'un jeu (Forever ou Retail), sans interface : testé avec un faux site.
//!
//! 1. **Lecture** (`collect`) : à chaque nouvelle sauvegarde, les blocs de l'outbox de l'addon entrent dans la file
//!    d'attente (un bloc par perso ou par bilan, la dernière version gagne).
//! 2. **Envoi** (`push`) : la file part au site. Un bloc accepté devient un accusé de réception (`sent`), écrit
//!    ensuite dans `ForeverRoster_Data` pour que l'addon le marque envoyé. Un perso inconnu attend la réponse du
//!    joueur (`unknown`) ; un bilan qui n'est pas celui du chef de raid attend un envoi à la main (`manual`).
//!    Erreur réseau : rien n'est perdu, nouvel essai de plus en plus espacé.
//! 3. **Réception** (`pull`) : données des groupes (FRG), seulement si elles ont changé (ETag).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::api::{ApiError, FrgResult, GroupSummary, ImportResult, SyncApi, UploadRequest};
use crate::datafile::{DataFile, Report};
use crate::outbox::{Block, BlockKind, block_label, read_outbox};
use crate::wow::{Account, Game};

/// Sauvegarde plus grosse : refusée (celle de Forever Roster fait quelques centaines de Ko).
pub const MAX_SAVED_VARIABLES: u64 = 64 * 1024 * 1024;
/// Envoi découpé : le site accepte 250 000 caractères par requête.
const MAX_BATCH: usize = 200_000;
/// Accusés des bilans gardés 40 jours (l'addon garde ses bilans 30 jours).
const KEEP_RAIDLOG_ACKS_S: i64 = 40 * 86400;
/// Un bloc refusé par le site (erreur sur ce bloc) n'est pas renvoyé tel quel avant une heure.
const BLOCK_RETRY_S: i64 = 3600;
const MAX_QUEUE: usize = 300;
const MAX_HISTORY: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Queued {
    pub kind: BlockKind,
    pub sig: String,
    pub lead: bool,
    pub text: String,
    pub label: String,
    /// Compte WoW d'où vient le bloc.
    pub account: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub sig: String,
    pub at: i64,
}

/// Perso que le site ne connaît pas : le joueur choisit « Créer la fiche » ou « Ignorer ».
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Unknown {
    pub name: String,
    pub cls: Option<String>,
    pub level: Option<u32>,
    pub sig: String,
    pub text: String,
    pub since: i64,
}

/// Ligne de l'historique affiché (« Vers le site »).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryLine {
    pub at: i64,
    /// Clé du bloc (perso ou bilan) : une seule ligne par clé
    #[serde(default)]
    pub key: String,
    pub label: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub len: u64,
    /// Millisecondes depuis 1970.
    pub modified: i64,
}

/// Tout ce qu'il faut garder d'une fois sur l'autre pour un jeu (enregistré dans l'état de l'appli).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct GameState {
    pub queue: BTreeMap<String, Queued>,
    pub sent: BTreeMap<String, Sent>,
    pub unknown: BTreeMap<String, Unknown>,
    pub manual: BTreeMap<String, Queued>,
    pub history: Vec<HistoryLine>,
    pub report: Option<Report>,
    /// Date de la dernière outbox lue, par compte WoW.
    pub outbox_at: BTreeMap<String, i64>,
    /// Taille et date des sauvegardes déjà lues (relues seulement si elles changent).
    pub files: BTreeMap<String, FileStamp>,
    pub read_error: Option<String>,
    pub frg: Option<String>,
    pub frg_at: i64,
    pub etag: Option<String>,
    pub groups: Vec<GroupSummary>,
    pub last_push: Option<i64>,
    pub last_pull: Option<i64>,
    pub failures: u32,
    pub retry_at: Option<i64>,
    pub last_error: Option<String>,
    /// Empreinte du contenu de Data.lua déjà écrit, et quand.
    pub data_hash: Option<u64>,
    pub data_at: Option<i64>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PushOutcome {
    pub sent: usize,
    pub accepted: usize,
    pub unknown: usize,
    pub errors: usize,
}

/// FNV-1a 64 bits : empreinte stable d'une version à l'autre de l'appli.
pub fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn stamp(path: &Path) -> Option<FileStamp> {
    let m = fs::metadata(path).ok()?;
    let modified = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
    Some(FileStamp { len: m.len(), modified })
}

impl GameState {
    /// Lit les sauvegardes qui ont changé et met la file à jour. Renvoie le nombre de blocs nouveaux ou modifiés.
    pub fn collect(&mut self, accounts: &[Account], now: i64) -> usize {
        let mut changed = 0;
        self.read_error = None;
        for acc in accounts {
            let key = acc.file.to_string_lossy().into_owned();
            let Some(st) = stamp(&acc.file) else { continue };
            if self.files.get(&key) == Some(&st) {
                continue;
            }
            if st.len > MAX_SAVED_VARIABLES {
                self.read_error = Some(format!("sauvegarde du compte {} trop grosse", acc.name));
                continue;
            }
            let bytes = match fs::read(&acc.file) {
                Ok(b) => b,
                Err(e) => {
                    self.read_error = Some(format!("sauvegarde du compte {} illisible : {e}", acc.name));
                    continue;
                }
            };
            match read_outbox(&bytes) {
                Ok(Some(ob)) => {
                    // Une outbox plus ancienne que celle déjà lue (copie restaurée…) est ignorée
                    if ob.at >= self.outbox_at.get(&acc.name).copied().unwrap_or(0) {
                        changed += self.take_outbox(&acc.name, ob.blocks, now);
                        self.outbox_at.insert(acc.name.clone(), ob.at);
                    }
                    self.files.insert(key, st);
                }
                Ok(None) => {
                    self.files.insert(key, st);
                }
                Err(e) => {
                    // Fichier peut-être en cours d'écriture par le jeu : relu au prochain changement
                    tracing::warn!("sauvegarde illisible ({}) : {e}", acc.name);
                    self.read_error = Some(format!(
                        "La sauvegarde de l'addon n'a pas pu être lue ({e}) : elle sera relue au prochain /reload."
                    ));
                }
            }
        }
        changed
    }

    fn take_outbox(&mut self, account: &str, blocks: Vec<Block>, now: i64) -> usize {
        let present: std::collections::HashSet<&str> = blocks.iter().map(|b| b.key.as_str()).collect();
        // Ce compte n'a plus ces blocs à envoyer (copiés à la main entre-temps) : on ne renvoie pas une vieille version
        self.queue.retain(|k, q| q.account != account || present.contains(k.as_str()));
        let mut changed = 0;
        for b in blocks {
            if self.sent.get(&b.key).is_some_and(|s| s.sig == b.sig) {
                continue;
            }
            let q = Queued {
                kind: b.kind,
                sig: b.sig.clone(),
                lead: b.lead,
                label: block_label(&b),
                text: b.text,
                account: account.to_string(),
                error: None,
                error_at: None,
            };
            // Bilan qui n'est pas celui du chef de raid : le joueur décide de l'envoyer
            if b.kind == BlockKind::Frb && !b.lead {
                if self.manual.get(&b.key).is_none_or(|m| m.sig != b.sig) {
                    self.manual.insert(b.key, q);
                    changed += 1;
                }
                continue;
            }
            if let Some(u) = self.unknown.get_mut(&b.key) {
                // Toujours en attente de la réponse du joueur : on garde la dernière version
                if u.sig != b.sig {
                    u.sig = b.sig;
                    u.text = q.text;
                }
                continue;
            }
            if self.queue.get(&b.key).is_none_or(|old| old.sig != b.sig) {
                self.queue.insert(b.key, q);
                changed += 1;
            }
        }
        while self.queue.len() > MAX_QUEUE {
            let first = self.queue.keys().next().cloned();
            if let Some(k) = first {
                self.queue.remove(&k);
            }
        }
        let _ = now;
        changed
    }

    /// Blocs à envoyer maintenant (hors ceux refusés il y a moins d'une heure).
    pub fn due(&self, now: i64) -> Vec<String> {
        self.queue
            .iter()
            .filter(|(_, q)| q.error_at.is_none_or(|at| now - at >= BLOCK_RETRY_S))
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Prochain essai permis après des erreurs réseau (30 s, 1 min, 2 min… jusqu'à 15 min).
    pub fn can_try(&self, now: i64) -> bool {
        self.retry_at.is_none_or(|t| now >= t)
    }

    fn network_failed(&mut self, e: &ApiError, now: i64) {
        self.failures = self.failures.saturating_add(1);
        let wait = (30_i64 << (self.failures - 1).min(5)).min(900);
        self.retry_at = Some(now + wait);
        self.last_error = Some(e.to_string());
    }

    fn network_ok(&mut self) {
        self.failures = 0;
        self.retry_at = None;
        self.last_error = None;
    }

    /// Dernier état de chaque envoi : une ligne par perso ou bilan (« fiche créée » remplace « inconnu du site »).
    fn remember(&mut self, line: HistoryLine) {
        self.history.retain(|h| h.key.is_empty() || h.key != line.key);
        self.history.insert(0, line);
        self.history.truncate(MAX_HISTORY);
    }

    /// Applique les résultats du site aux blocs envoyés.
    fn apply_results(&mut self, sent: &BTreeMap<String, Queued>, results: &[ImportResult], now: i64) -> PushOutcome {
        let mut out = PushOutcome {
            sent: sent.len(),
            ..Default::default()
        };
        let mut items = Vec::new();
        for r in results {
            let Some(q) = sent.get(&r.key) else { continue };
            match r.status.as_str() {
                // Reçu (ou ignoré exprès, ou déjà remplacé par le bilan du chef) : accusé de réception pour l'addon
                "updated" | "created" | "ignored" | "kept" | "skipped" | "refused" => {
                    self.queue.remove(&r.key);
                    self.manual.remove(&r.key);
                    self.unknown.remove(&r.key);
                    self.sent.insert(r.key.clone(), Sent { sig: q.sig.clone(), at: now });
                    if matches!(r.status.as_str(), "updated" | "created") {
                        out.accepted += 1;
                        items.push(q.label.clone());
                    }
                }
                "unknown" => {
                    self.queue.remove(&r.key);
                    self.unknown.insert(
                        r.key.clone(),
                        Unknown {
                            name: r.name.clone(),
                            cls: r.cls.clone(),
                            level: r.level,
                            sig: q.sig.clone(),
                            text: q.text.clone(),
                            since: now,
                        },
                    );
                    out.unknown += 1;
                }
                _ => {
                    if let Some(entry) = self.queue.get_mut(&r.key) {
                        entry.error = Some(r.message.clone());
                        entry.error_at = Some(now);
                    }
                    out.errors += 1;
                }
            }
            self.remember(HistoryLine {
                at: now,
                key: r.key.clone(),
                label: q.label.clone(),
                status: r.status.clone(),
                message: r.message.clone(),
            });
        }
        if !items.is_empty() {
            self.report = Some(Report { at: now, items });
        }
        self.prune(now);
        out
    }

    fn prune(&mut self, now: i64) {
        self.sent.retain(|k, s| !k.starts_with("frb:") || now - s.at < KEEP_RAIDLOG_ACKS_S);
    }

    /// Contenu de `ForeverRoster_Data` pour ce jeu.
    pub fn data_file(&self, app_version: &str, now: i64) -> DataFile {
        DataFile {
            app: app_version.to_string(),
            frg: self.frg.clone(),
            frg_at: if self.frg_at > 0 { self.frg_at } else { now },
            acks: self.sent.iter().map(|(k, s)| (k.clone(), s.sig.clone())).collect(),
            report: self.report.clone(),
        }
    }

    /// Faut-il réécrire Data.lua ? (contenu changé, ou plus de 12 h : l'addon voit ainsi que l'appli tourne)
    pub fn data_needs_write(&self, data: &DataFile, now: i64, file_exists: bool) -> bool {
        !file_exists || self.data_hash != Some(fnv1a(&data.body())) || self.data_at.is_none_or(|at| now - at > 12 * 3600)
    }

    pub fn data_written(&mut self, data: &DataFile, now: i64) {
        self.data_hash = Some(fnv1a(&data.body()));
        self.data_at = Some(now);
    }
}

/// Envoi et réception pour un jeu, avec le jeton de l'appareil.
pub struct Engine<'a, A: SyncApi> {
    pub api: &'a A,
    pub game: Game,
    pub token: &'a str,
}

impl<A: SyncApi> Engine<'_, A> {
    async fn upload(
        &self,
        gs: &mut GameState,
        blocks: BTreeMap<String, Queued>,
        create: Vec<String>,
        ignore: Vec<String>,
        manual: bool,
        now: i64,
    ) -> Result<PushOutcome, ApiError> {
        let mut total = PushOutcome::default();
        // Paquets de 200 000 caractères au plus
        let mut batches: Vec<BTreeMap<String, Queued>> = vec![BTreeMap::new()];
        let mut size = 0;
        for (k, q) in blocks {
            if size + q.text.len() > MAX_BATCH && !batches.last().is_some_and(BTreeMap::is_empty) {
                batches.push(BTreeMap::new());
                size = 0;
            }
            size += q.text.len() + 1;
            batches.last_mut().expect("au moins un paquet").insert(k, q);
        }
        for batch in batches.into_iter().filter(|b| !b.is_empty()) {
            let text = batch.values().map(|q| q.text.as_str()).collect::<Vec<_>>().join("\n");
            let req = UploadRequest {
                text,
                create: create.clone(),
                ignore: ignore.clone(),
                manual,
            };
            match self.api.upload(self.game, self.token, &req).await {
                Ok(res) => {
                    gs.network_ok();
                    gs.last_push = Some(now);
                    let o = gs.apply_results(&batch, &res.results, now);
                    total.sent += o.sent;
                    total.accepted += o.accepted;
                    total.unknown += o.unknown;
                    total.errors += o.errors;
                }
                Err(e) => {
                    if e.retryable() {
                        gs.network_failed(&e, now);
                    } else {
                        gs.last_error = Some(e.to_string());
                    }
                    return Err(e);
                }
            }
        }
        Ok(total)
    }

    /// Envoie la file (persos et bilans du chef de raid).
    pub async fn push(&self, gs: &mut GameState, now: i64) -> Result<PushOutcome, ApiError> {
        if !gs.can_try(now) {
            return Ok(PushOutcome::default());
        }
        let due: BTreeMap<String, Queued> = gs.due(now).into_iter().filter_map(|k| gs.queue.get(&k).cloned().map(|q| (k, q))).collect();
        if due.is_empty() {
            return Ok(PushOutcome::default());
        }
        self.upload(gs, due, vec![], vec![], false, now).await
    }

    /// Réponse du joueur pour des persos inconnus : créer leur fiche, ou les ignorer (pour de bon).
    pub async fn resolve(&self, gs: &mut GameState, create: &[String], ignore: &[String], now: i64) -> Result<PushOutcome, ApiError> {
        let blocks: BTreeMap<String, Queued> = create
            .iter()
            .chain(ignore)
            .filter_map(|k| {
                gs.unknown.get(k).map(|u| {
                    (
                        k.clone(),
                        Queued {
                            kind: BlockKind::Frc,
                            sig: u.sig.clone(),
                            lead: false,
                            text: u.text.clone(),
                            label: u.name.clone(),
                            account: String::new(),
                            error: None,
                            error_at: None,
                        },
                    )
                })
            })
            .collect();
        if blocks.is_empty() {
            return Ok(PushOutcome::default());
        }
        self.upload(gs, blocks, create.to_vec(), ignore.to_vec(), false, now).await
    }

    /// Envoi à la main d'un bilan qui n'est pas celui du chef de raid (remplace, comme un Ctrl+V).
    pub async fn send_manual(&self, gs: &mut GameState, key: &str, now: i64) -> Result<PushOutcome, ApiError> {
        let Some(q) = gs.manual.get(key).cloned() else {
            return Ok(PushOutcome::default());
        };
        let mut one = BTreeMap::new();
        one.insert(key.to_string(), q);
        self.upload(gs, one, vec![], vec![], true, now).await
    }

    /// Données des groupes : true si elles ont changé.
    pub async fn pull(&self, gs: &mut GameState, now: i64) -> Result<bool, ApiError> {
        if !gs.can_try(now) {
            return Ok(false);
        }
        match self.api.frg(self.game, self.token, gs.etag.as_deref()).await {
            Ok(FrgResult::NotModified) => {
                gs.network_ok();
                gs.last_pull = Some(now);
                Ok(false)
            }
            Ok(FrgResult::Data { text, at, groups, etag }) => {
                gs.network_ok();
                gs.last_pull = Some(now);
                let changed = gs.frg.as_deref() != Some(text.as_str());
                gs.frg = Some(text);
                gs.frg_at = if at > 0 { at } else { now };
                gs.groups = groups;
                gs.etag = etag;
                Ok(changed)
            }
            Err(e) => {
                if e.retryable() {
                    gs.network_failed(&e, now);
                } else {
                    gs.last_error = Some(e.to_string());
                }
                Err(e)
            }
        }
    }
}

/// Bilan écarté par le joueur (il ne l'enverra pas) : marqué reçu pour que l'addon arrête de le proposer.
pub fn dismiss_manual(gs: &mut GameState, key: &str, now: i64) -> bool {
    match gs.manual.remove(key) {
        Some(q) => {
            gs.sent.insert(key.to_string(), Sent { sig: q.sig, at: now });
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::FrgResult;
    use std::sync::Mutex;

    /// Faux site : réponses programmées, requêtes notées.
    #[derive(Default)]
    struct FakeSite {
        uploads: Mutex<Vec<UploadRequest>>,
        /// key → statut renvoyé (défaut : updated)
        status: Mutex<BTreeMap<String, String>>,
        down: Mutex<bool>,
        frg: Mutex<Option<(String, String)>>,
    }

    fn key_of(block: &str) -> String {
        let f: Vec<&str> = block.lines().next().unwrap_or("").split(';').collect();
        if f[0] == "FRB" {
            format!("frb:{}", f[2])
        } else {
            format!("{}-{}", f[2], f[3])
        }
    }

    impl SyncApi for FakeSite {
        async fn frg(&self, _game: Game, _token: &str, etag: Option<&str>) -> Result<FrgResult, ApiError> {
            if *self.down.lock().unwrap() {
                return Err(ApiError::Network("hors ligne".into()));
            }
            let f = self.frg.lock().unwrap().clone();
            match f {
                Some((text, tag)) if etag != Some(tag.as_str()) => Ok(FrgResult::Data {
                    text,
                    at: 1000,
                    groups: vec![],
                    etag: Some(tag),
                }),
                _ => Ok(FrgResult::NotModified),
            }
        }
        async fn upload(&self, _game: Game, _token: &str, req: &UploadRequest) -> Result<crate::api::UploadResponse, ApiError> {
            if *self.down.lock().unwrap() {
                return Err(ApiError::Network("hors ligne".into()));
            }
            self.uploads.lock().unwrap().push(req.clone());
            let status = self.status.lock().unwrap().clone();
            let mut blocks: Vec<String> = Vec::new();
            for line in req.text.lines() {
                if line.starts_with("FRC;") || line.starts_with("FRB;") {
                    blocks.push(line.to_string());
                }
            }
            let results = blocks
                .iter()
                .map(|head| {
                    let key = key_of(head);
                    let s = if req.create.contains(&key) {
                        "created".to_string()
                    } else if req.ignore.contains(&key) {
                        "ignored".to_string()
                    } else {
                        status.get(&key).cloned().unwrap_or_else(|| "updated".into())
                    };
                    ImportResult {
                        key: key.clone(),
                        kind: if head.starts_with("FRB") { "raidlog".into() } else { "character".into() },
                        name: key,
                        status: s,
                        message: String::new(),
                        cls: Some("Druid".into()),
                        level: Some(60),
                    }
                })
                .collect();
            Ok(crate::api::UploadResponse { results, errors: vec![] })
        }
    }

    fn save(dir: &Path, account: &str, at: i64, blocks: &[(&str, &str, &str, bool, &str)]) -> Account {
        let sv = dir.join("WTF/Account").join(account).join("SavedVariables");
        fs::create_dir_all(&sv).unwrap();
        let mut s = format!("ForeverRosterDB = {{\n[\"outbox\"] = {{\n[\"v\"] = 1,\n[\"at\"] = {at},\n[\"blocks\"] = {{\n");
        for (kind, key, sig, lead, text) in blocks {
            s.push_str(&format!(
                "{{\n[\"kind\"] = \"{kind}\",\n[\"key\"] = \"{key}\",\n[\"sig\"] = \"{sig}\",\n[\"lead\"] = {lead},\n[\"text\"] = \"{}\",\n}},\n",
                text.replace('\n', "\\n")
            ));
        }
        s.push_str("},\n},\n}\n");
        let file = sv.join("ForeverRoster.lua");
        fs::write(&file, s).unwrap();
        // Date de modification différente à chaque écriture (sinon le fichier passerait pour inchangé)
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(at as u64);
        fs::File::options().write(true).open(&file).unwrap().set_modified(t).unwrap();
        Account {
            name: account.into(),
            dir: sv,
            file,
        }
    }

    const TOURNI: &str = "FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1;1.3.1\nEND;0";
    const BANK: &str = "FRC;2;Banquier;Forever EU;ROGUE;Orc;1;Horde;1;1.3.1\nEND;0";
    const LOG_LEAD: &str = "FRB;2;r1;1;2;Tournicoti;Vroum;MC;1\nEND;0";
    const LOG_OTHER: &str = "FRB;2;r2;1;2;Tournicoti;Onyxia;Ony;0\nEND;0";

    #[tokio::test]
    async fn envoie_accuse_et_ne_renvoie_pas() {
        let dir = tempfile::tempdir().unwrap();
        let site = FakeSite::default();
        let engine = Engine {
            api: &site,
            game: Game::Forever,
            token: "rc_x",
        };
        let mut gs = GameState::default();
        let acc = save(
            dir.path(),
            "1#1",
            100,
            &[
                ("frc", "Tournicoti-Forever EU", "s1", false, TOURNI),
                ("frb", "frb:r1", "50", true, LOG_LEAD),
                ("frb", "frb:r2", "60", false, LOG_OTHER),
            ],
        );
        assert_eq!(gs.collect(std::slice::from_ref(&acc), 100), 3);
        assert_eq!(gs.queue.len(), 2, "le bilan qui n'est pas celui du chef attend un envoi à la main");
        assert!(gs.manual.contains_key("frb:r2"));
        let o = engine.push(&mut gs, 101).await.unwrap();
        assert_eq!((o.sent, o.accepted), (2, 2));
        assert!(gs.queue.is_empty());
        assert_eq!(gs.sent["Tournicoti-Forever EU"].sig, "s1");
        assert_eq!(gs.report.as_ref().unwrap().items, vec!["Tournicoti", "bilan de « Vroum »"]);
        // Fichier inchangé : pas relu ; même contenu réécrit : rien de nouveau à envoyer
        assert_eq!(gs.collect(std::slice::from_ref(&acc), 102), 0);
        let acc = save(dir.path(), "1#1", 110, &[("frc", "Tournicoti-Forever EU", "s1", false, TOURNI)]);
        assert_eq!(gs.collect(std::slice::from_ref(&acc), 110), 0);
        assert_eq!(engine.push(&mut gs, 111).await.unwrap().sent, 0);
        assert_eq!(site.uploads.lock().unwrap().len(), 1);
        // Les accusés partent dans ForeverRoster_Data
        let data = gs.data_file("0.1.0", 120);
        assert_eq!(data.acks.get("frb:r1").map(String::as_str), Some("50"));
        // Envoi à la main du bilan d'un autre officier : manual = true
        let o = engine.send_manual(&mut gs, "frb:r2", 130).await.unwrap();
        assert_eq!(o.accepted, 1);
        assert!(site.uploads.lock().unwrap().last().unwrap().manual);
        assert!(gs.manual.is_empty());
    }

    #[tokio::test]
    async fn perso_inconnu_creer_ou_ignorer() {
        let dir = tempfile::tempdir().unwrap();
        let site = FakeSite::default();
        site.status.lock().unwrap().insert("Tournicoti-Forever EU".into(), "unknown".into());
        site.status.lock().unwrap().insert("Banquier-Forever EU".into(), "unknown".into());
        let engine = Engine {
            api: &site,
            game: Game::Forever,
            token: "rc_x",
        };
        let mut gs = GameState::default();
        let acc = save(
            dir.path(),
            "1#1",
            100,
            &[
                ("frc", "Tournicoti-Forever EU", "s1", false, TOURNI),
                ("frc", "Banquier-Forever EU", "b1", false, BANK),
            ],
        );
        gs.collect(&[acc], 100);
        let o = engine.push(&mut gs, 101).await.unwrap();
        assert_eq!(o.unknown, 2);
        assert_eq!(gs.unknown["Tournicoti-Forever EU"].cls.as_deref(), Some("Druid"));
        assert!(gs.queue.is_empty(), "plus rien à envoyer tant que le joueur n'a pas répondu");
        assert_eq!(engine.push(&mut gs, 102).await.unwrap().sent, 0);
        // Nouvelle version du perso pendant l'attente : gardée, sans renvoi
        let acc = save(
            dir.path(),
            "1#1",
            103,
            &[
                ("frc", "Tournicoti-Forever EU", "s2", false, TOURNI),
                ("frc", "Banquier-Forever EU", "b1", false, BANK),
            ],
        );
        gs.collect(&[acc], 103);
        assert_eq!(gs.unknown["Tournicoti-Forever EU"].sig, "s2");
        assert!(gs.queue.is_empty());
        let o = engine
            .resolve(&mut gs, &["Tournicoti-Forever EU".into()], &["Banquier-Forever EU".into()], 104)
            .await
            .unwrap();
        assert_eq!(o.accepted, 1);
        assert!(gs.unknown.is_empty());
        assert_eq!(gs.sent["Tournicoti-Forever EU"].sig, "s2");
        assert_eq!(
            gs.sent["Banquier-Forever EU"].sig, "b1",
            "un perso ignoré est marqué reçu : l'addon arrête de le proposer"
        );
        let last = site.uploads.lock().unwrap().last().unwrap().clone();
        assert_eq!(
            (last.create, last.ignore),
            (vec!["Tournicoti-Forever EU".to_string()], vec!["Banquier-Forever EU".to_string()])
        );
        // Une ligne par perso dans « Vers le site » : la dernière nouvelle remplace « inconnu du site »
        let labels: Vec<_> = gs.history.iter().map(|h| h.key.as_str()).collect();
        let mut dedup = labels.clone();
        dedup.sort();
        dedup.dedup();
        assert_eq!(labels.len(), dedup.len(), "{labels:?}");
        assert!(gs.history.iter().all(|h| h.status != "unknown"), "{:?}", gs.history);
    }

    #[tokio::test]
    async fn hors_ligne_rien_n_est_perdu() {
        let dir = tempfile::tempdir().unwrap();
        let site = FakeSite::default();
        *site.down.lock().unwrap() = true;
        let engine = Engine {
            api: &site,
            game: Game::Forever,
            token: "rc_x",
        };
        let mut gs = GameState::default();
        let acc = save(dir.path(), "1#1", 100, &[("frc", "Tournicoti-Forever EU", "s1", false, TOURNI)]);
        gs.collect(&[acc], 100);
        assert!(engine.push(&mut gs, 100).await.is_err());
        assert_eq!(gs.queue.len(), 1);
        assert_eq!(gs.retry_at, Some(130));
        assert!(gs.last_error.as_deref().unwrap().contains("hors ligne"));
        // Pas d'essai avant le délai, puis 1 min, 2 min…
        assert_eq!(engine.push(&mut gs, 110).await.unwrap().sent, 0);
        assert!(engine.push(&mut gs, 130).await.is_err());
        assert_eq!(gs.retry_at, Some(190));
        *site.down.lock().unwrap() = false;
        assert_eq!(engine.push(&mut gs, 190).await.unwrap().accepted, 1);
        assert_eq!((gs.failures, gs.retry_at, gs.last_error.clone()), (0, None, None));
    }

    #[tokio::test]
    async fn bloc_refuse_puis_reessaye_plus_tard() {
        let dir = tempfile::tempdir().unwrap();
        let site = FakeSite::default();
        site.status.lock().unwrap().insert("Tournicoti-Forever EU".into(), "error".into());
        let engine = Engine {
            api: &site,
            game: Game::Forever,
            token: "rc_x",
        };
        let mut gs = GameState::default();
        gs.collect(&[save(dir.path(), "1#1", 100, &[("frc", "Tournicoti-Forever EU", "s1", false, TOURNI)])], 100);
        assert_eq!(engine.push(&mut gs, 100).await.unwrap().errors, 1);
        assert_eq!(engine.push(&mut gs, 200).await.unwrap().sent, 0, "pas renvoyé tout de suite");
        assert_eq!(engine.push(&mut gs, 100 + BLOCK_RETRY_S).await.unwrap().sent, 1);
        assert_eq!(gs.history[0].status, "error");
    }

    #[tokio::test]
    async fn copie_manuelle_entre_temps_pas_de_vieille_version() {
        let dir = tempfile::tempdir().unwrap();
        let mut gs = GameState::default();
        gs.collect(&[save(dir.path(), "1#1", 100, &[("frc", "Tournicoti-Forever EU", "s1", false, TOURNI)])], 100);
        assert_eq!(gs.queue.len(), 1);
        // Le joueur a copié l'export à la main : la nouvelle outbox ne contient plus ce perso
        gs.collect(&[save(dir.path(), "1#1", 200, &[])], 200);
        assert!(gs.queue.is_empty());
        // Une outbox plus ancienne (copie restaurée) est ignorée
        gs.collect(&[save(dir.path(), "1#1", 150, &[("frc", "Tournicoti-Forever EU", "s0", false, TOURNI)])], 210);
        assert!(gs.queue.is_empty());
    }

    #[tokio::test]
    async fn donnees_des_groupes_et_data_lua() {
        let site = FakeSite::default();
        *site.frg.lock().unwrap() = Some(("FRG;1;g;1;Groupe\nEND;0".into(), "\"e1\"".into()));
        let engine = Engine {
            api: &site,
            game: Game::Forever,
            token: "rc_x",
        };
        let mut gs = GameState::default();
        assert!(engine.pull(&mut gs, 10).await.unwrap());
        assert!(!engine.pull(&mut gs, 20).await.unwrap(), "304 : rien de nouveau");
        assert_eq!(gs.etag.as_deref(), Some("\"e1\""));
        let data = gs.data_file("0.1.0", 30);
        assert!(gs.data_needs_write(&data, 30, false));
        gs.data_written(&data, 30);
        assert!(!gs.data_needs_write(&data, 40, true));
        let newer = DataFile {
            app: "9.9.9".into(),
            ..data.clone()
        };
        assert!(gs.data_needs_write(&newer, 40, true), "nouvelle version de l'appli : .toc réécrits");
        assert!(gs.data_needs_write(&data, 30 + 13 * 3600, true), "réécrit au moins toutes les 12 h");
        dismiss_manual(&mut gs, "inconnu", 50);
        assert!(gs.data_needs_write(&gs.data_file("0.1.0", 50), 50, true) == (gs.data_file("0.1.0", 50).body() != data.body()));
    }

    #[test]
    fn empreinte_stable() {
        assert_eq!(fnv1a(""), 0xcbf29ce484222325);
        assert_eq!(fnv1a("a"), 0xaf63dc4c8601ec8c);
    }
}
