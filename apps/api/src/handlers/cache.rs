//! A shared, short-lived response cache for PUBLIC read endpoints (the War Room's): every
//! open tab polls them, and each call reads the database. One computation serves every
//! viewer for up to `TTL`, keyed by path + query + world version, so a committed world
//! change is visible on the next request. Concurrent callers of one key wait for a single
//! computation. Only 200 responses are kept. Never use it for player-specific data.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use actix_web::{body::to_bytes, http::StatusCode, web, web::Bytes, HttpRequest, HttpResponse};

use tokio::sync::Mutex;

use crate::AppState;

const TTL: Duration = Duration::from_secs(5);
const MAX_KEYS: usize = 256;

type Slot = Arc<Mutex<Option<(Instant, u64, Bytes)>>>;

fn slots() -> &'static std::sync::Mutex<HashMap<String, Slot>> {
    static S: OnceLock<std::sync::Mutex<HashMap<String, Slot>>> = OnceLock::new();
    S.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

pub async fn shared<F, Fut>(state: &web::Data<AppState>, req: &HttpRequest, fresh: F) -> HttpResponse
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = HttpResponse>,
{
    let key = format!("{}?{}", req.path(), req.query_string());
    let slot = {
        let mut m = slots().lock().unwrap_or_else(|e| e.into_inner());
        if m.len() >= MAX_KEYS && !m.contains_key(&key) { m.clear(); }
        m.entry(key).or_default().clone()
    };
    let mut entry = slot.lock().await;
    let version = state.world.read(|w| w.version).await;
    if let Some((at, v, body)) = entry.as_ref() && *v == version && at.elapsed() < TTL {
        return json(body.clone());
    }
    let resp = fresh().await;
    if resp.status() != StatusCode::OK {
        return resp;
    }
    match to_bytes(resp.into_body()).await {
        Ok(body) => {
            *entry = Some((Instant::now(), version, body.clone()));
            json(body)
        }
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

fn json(body: Bytes) -> HttpResponse {
    HttpResponse::Ok().content_type("application/json").body(body)
}
