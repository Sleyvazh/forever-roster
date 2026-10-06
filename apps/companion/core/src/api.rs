//! Client de l'API du site (routes de Roster Companion : /api/devices et /api/sync).
//! Un site, deux adresses : Forever Roster pour Forever, Roster pour Retail ; même compte, même jeton.

use std::future::Future;
use std::time::Duration;

use reqwest::{StatusCode, header};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::wow::Game;

/// Adresses des deux sites (modifiables pour les tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sites {
    pub forever: String,
    pub retail: String,
}

impl Default for Sites {
    fn default() -> Self {
        Sites {
            forever: "https://forever-roster.sleyvazh.fr".into(),
            retail: "https://roster.sleyvazh.fr".into(),
        }
    }
}

impl Sites {
    pub fn of(&self, game: Game) -> &str {
        match game {
            Game::Forever => &self.forever,
            Game::Retail => &self.retail,
        }
    }
    /// Une adresse du site (lien à ouvrir dans le navigateur) : seulement les deux sites, en https (http en test local).
    pub fn is_site_url(&self, url: &str) -> bool {
        [&self.forever, &self.retail]
            .iter()
            .any(|base| url == base.as_str() || url.starts_with(&format!("{base}/")))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("appareil délié : relie Roster Companion de nouveau")]
    Unauthorized,
    #[error("trop de requêtes : nouvel essai dans quelques minutes")]
    RateLimited,
    #[error("{message}")]
    Http { status: u16, message: String },
    #[error("le site ne répond pas ({0})")]
    Network(String),
    #[error("réponse illisible du site ({0})")]
    Decode(String),
}

impl ApiError {
    /// Erreur passagère : on réessaie plus tard sans rien perdre.
    pub fn retryable(&self) -> bool {
        match self {
            ApiError::Network(_) | ApiError::RateLimited => true,
            ApiError::Http { status, .. } => *status >= 500,
            _ => false,
        }
    }
}

/* ---------- Appairage ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDescription {
    pub name: String,
    pub platform: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairStart {
    pub pair_id: String,
    pub user_code: String,
    pub expires_in: u64,
    pub interval: u64,
    pub verify_url: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DeviceRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PairPoll {
    Pending,
    SlowDown,
    Denied,
    Expired,
    Approved { token: String, device: DeviceRef },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub device: DeviceRef,
    pub user: MeUser,
}
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeUser {
    pub display_name: String,
}

/* ---------- Synchro ---------- */

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
pub struct GroupSummary {
    pub name: String,
    #[serde(default)]
    pub raids: u32,
    #[serde(default)]
    pub patterns: u32,
    #[serde(default)]
    pub bis: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrgResult {
    NotModified,
    Data {
        text: String,
        at: i64,
        groups: Vec<GroupSummary>,
        etag: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct UploadRequest {
    pub text: String,
    pub create: Vec<String>,
    pub ignore: Vec<String>,
    /// Envoi demandé par le joueur (bilan qui n'est pas celui du chef) : remplace comme un Ctrl+V.
    pub manual: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub key: String,
    pub kind: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub cls: Option<String>,
    #[serde(default)]
    pub level: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
pub struct UploadResponse {
    pub results: Vec<ImportResult>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct IgnoredKey {
    pub key: String,
}

/// Ce dont le moteur de synchro a besoin (remplacé par un faux site dans les tests).
pub trait SyncApi: Send + Sync {
    fn frg(&self, game: Game, token: &str, etag: Option<&str>) -> impl Future<Output = Result<FrgResult, ApiError>> + Send;
    fn upload(&self, game: Game, token: &str, req: &UploadRequest) -> impl Future<Output = Result<UploadResponse, ApiError>> + Send;
}

#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    pub sites: Sites,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
}

impl Client {
    pub fn new(sites: Sites, app_version: &str) -> Result<Self, ApiError> {
        let http = reqwest::Client::builder()
            .user_agent(format!("RosterCompanion/{app_version} ({})", std::env::consts::OS))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .https_only(sites.forever.starts_with("https://") && sites.retail.starts_with("https://"))
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok(Client { http, sites })
    }

    fn url(&self, game: Game, path: &str) -> String {
        format!("{}{}", self.sites.of(game).trim_end_matches('/'), path)
    }

    async fn send<T: DeserializeOwned>(&self, rb: reqwest::RequestBuilder) -> Result<T, ApiError> {
        let res = rb.send().await.map_err(|e| ApiError::Network(short(e)))?;
        Self::decode(res).await
    }

    async fn decode<T: DeserializeOwned>(res: reqwest::Response) -> Result<T, ApiError> {
        let status = res.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ApiError::RateLimited);
        }
        let bytes = res.bytes().await.map_err(|e| ApiError::Network(short(e)))?;
        if !status.is_success() {
            let message = serde_json::from_slice::<ErrorBody>(&bytes)
                .map(|b| b.error)
                .unwrap_or_else(|_| format!("erreur {}", status.as_u16()));
            return Err(ApiError::Http {
                status: status.as_u16(),
                message,
            });
        }
        serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))
    }

    /// 1. Demande d'un code d'appairage (sur Forever Roster : le compte vaut pour les deux sites).
    pub async fn pair_start(&self, info: &DeviceDescription) -> Result<PairStart, ApiError> {
        self.send(self.http.post(self.url(Game::Forever, "/api/devices/pair")).json(info)).await
    }

    /// 3. Réponse du joueur : le jeton n'arrive qu'une fois.
    pub async fn pair_poll(&self, pair_id: &str) -> Result<PairPoll, ApiError> {
        self.send(
            self.http
                .post(self.url(Game::Forever, "/api/devices/pair/poll"))
                .json(&serde_json::json!({ "pairId": pair_id })),
        )
        .await
    }

    pub async fn me(&self, token: &str) -> Result<Me, ApiError> {
        self.send(self.http.get(self.url(Game::Forever, "/api/devices/self")).bearer_auth(token)).await
    }

    /// Délier cet appareil (le jeton ne sert plus à rien ensuite).
    pub async fn unlink(&self, token: &str) -> Result<(), ApiError> {
        let _: serde_json::Value = self
            .send(self.http.delete(self.url(Game::Forever, "/api/devices/self")).bearer_auth(token))
            .await?;
        Ok(())
    }

    pub async fn ignored(&self, game: Game, token: &str) -> Result<Vec<IgnoredKey>, ApiError> {
        #[derive(Deserialize)]
        struct R {
            ignored: Vec<IgnoredKey>,
        }
        let r: R = self.send(self.http.get(self.url(game, "/api/sync/ignored")).bearer_auth(token)).await?;
        Ok(r.ignored)
    }

    pub async fn unignore(&self, game: Game, token: &str, keys: &[String]) -> Result<u32, ApiError> {
        #[derive(Deserialize)]
        struct R {
            removed: u32,
        }
        let r: R = self
            .send(
                self.http
                    .post(self.url(game, "/api/sync/ignored/remove"))
                    .bearer_auth(token)
                    .json(&serde_json::json!({ "keys": keys })),
            )
            .await?;
        Ok(r.removed)
    }
}

impl SyncApi for Client {
    async fn frg(&self, game: Game, token: &str, etag: Option<&str>) -> Result<FrgResult, ApiError> {
        let mut rb = self.http.get(self.url(game, "/api/sync/frg")).bearer_auth(token);
        if let Some(e) = etag {
            rb = rb.header(header::IF_NONE_MATCH, e);
        }
        let res = rb.send().await.map_err(|e| ApiError::Network(short(e)))?;
        if res.status() == StatusCode::NOT_MODIFIED {
            return Ok(FrgResult::NotModified);
        }
        let etag = res.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).map(str::to_string);
        #[derive(Deserialize)]
        struct R {
            text: String,
            #[serde(default)]
            groups: Vec<GroupSummary>,
            #[serde(default)]
            at: i64,
        }
        let r: R = Self::decode(res).await?;
        Ok(FrgResult::Data {
            text: r.text,
            at: r.at,
            groups: r.groups,
            etag,
        })
    }

    async fn upload(&self, game: Game, token: &str, req: &UploadRequest) -> Result<UploadResponse, ApiError> {
        self.send(self.http.post(self.url(game, "/api/sync/upload")).bearer_auth(token).json(req)).await
    }
}

/// Message d'erreur réseau court et lisible (sans l'adresse complète).
fn short(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "délai dépassé".into()
    } else if e.is_connect() {
        "connexion impossible".into()
    } else {
        e.without_url().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_les_reponses_d_appairage() {
        let p: PairPoll = serde_json::from_str(r#"{"status":"pending"}"#).unwrap();
        assert_eq!(p, PairPoll::Pending);
        let p: PairPoll = serde_json::from_str(r#"{"status":"slow_down"}"#).unwrap();
        assert_eq!(p, PairPoll::SlowDown);
        let p: PairPoll = serde_json::from_str(r#"{"status":"approved","token":"rc_x","device":{"id":"d1","name":"PC"}}"#).unwrap();
        assert_eq!(
            p,
            PairPoll::Approved {
                token: "rc_x".into(),
                device: DeviceRef {
                    id: "d1".into(),
                    name: "PC".into()
                }
            }
        );
        let s: PairStart =
            serde_json::from_str(r#"{"pairId":"p","userCode":"KPTZ-RQMV","expiresIn":600,"interval":5,"verifyUrl":"https://x/appairer?code=KPTZ-RQMV"}"#)
                .unwrap();
        assert_eq!(s.user_code, "KPTZ-RQMV");
    }

    #[test]
    fn liens_autorises() {
        let s = Sites::default();
        assert!(s.is_site_url("https://forever-roster.sleyvazh.fr/appairer?code=X"));
        assert!(s.is_site_url("https://roster.sleyvazh.fr"));
        assert!(!s.is_site_url("https://forever-roster.sleyvazh.fr.evil.test/"));
        assert!(!s.is_site_url("file:///C:/Windows/System32/calc.exe"));
    }

    #[test]
    fn erreurs_passageres() {
        assert!(ApiError::Network("x".into()).retryable());
        assert!(
            ApiError::Http {
                status: 502,
                message: "x".into()
            }
            .retryable()
        );
        assert!(
            !ApiError::Http {
                status: 400,
                message: "x".into()
            }
            .retryable()
        );
        assert!(!ApiError::Unauthorized.retryable());
    }
}
