use actix_cors::Cors;
use actix_web::{middleware::Logger, web, App, HttpServer};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod migrate;
mod services;

/// BIND_ADDR, else the platform's PORT (Railway, Render, Fly), else 8080.
fn bind_addr() -> String {
    std::env::var("BIND_ADDR").unwrap_or_else(|_| format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or_else(|_| "8080".into())))
}

#[derive(Clone)]
pub struct AppState {
    /// NEAR settlement client (None = off-chain only).
    pub near: Option<std::sync::Arc<services::near::NearClient>>,
    /// The live economy (owns the database pool).
    pub world: services::world::WorldService,
    /// Per-IP limiter for mission start/complete. Built once and shared (Arc) so
    /// every Actix worker draws from the same bucket.
    pub mission_limiter: std::sync::Arc<services::rate_limiter::RateLimiter>,
    /// Sign-in, sessions and the gas relayer.
    pub auth: std::sync::Arc<services::auth::AuthService>,
    /// This process's id for settlement leases (host, pid and a random suffix).
    pub worker_id: String,
    /// The official NEAR Intents (1Click) adapter: read-only unless approved.
    pub intents: services::intents::IntentsClient,
    /// Radio voices (apps/tts), when TTS_URL and TTS_TOKEN are set.
    pub voice: Option<services::voice::VoiceService>,
}

/// `CZ_ENV=production` turns on the strict deployment rules: credentialed CORS only
/// for `FRONTEND_ORIGIN`, secure cookies, and no localhost exceptions.
pub fn is_production() -> bool {
    std::env::var("CZ_ENV").as_deref() == Ok("production")
}

/// Whether a browser origin may make credentialed requests. Development also allows
/// localhost and 127.0.0.1 on any port; production allows only the listed origins.
pub fn origin_allowed(origin: &str, listed: &[String], production: bool) -> bool {
    // An origin has no path, so a trailing slash in FRONTEND_ORIGIN ("https://x.app/",
    // as copied from a browser bar) is not part of it. Compared literally, it refused
    // every request from the real site.
    if listed.iter().any(|o| o.trim_end_matches('/') == origin) {
        return true;
    }
    !production && (origin.starts_with("http://localhost:") || origin.starts_with("https://localhost:") || origin.starts_with("http://127.0.0.1:"))
}

/// The world lives in this process's memory and is written back to Postgres, so only
/// one API instance may own it. This advisory lock is held for the life of the
/// process on a dedicated connection; a second instance on the same database refuses
/// to start instead of forking the world.
pub const WORLD_WRITER_LOCK: i64 = 0x0C2E_0001;

/// How often the instance confirms it still holds the world lock.
const WRITER_CHECK_SECS: u64 = 10;
/// Consecutive stalled checks (each WRITER_STALL_SECS) before giving the lock up for lost.
const WRITER_MAX_STALLS: u32 = 3;
const WRITER_STALL_SECS: u64 = 30;

/// Losing the world lock means another instance may already be writing: stop now.
fn fatal_writer(why: &str) -> ! {
    tracing::error!("{why}; exiting so a clean instance can take over (never two writers)");
    std::process::exit(70);
}

#[cfg(test)]
mod origin_tests {
    use super::origin_allowed;

    #[test]
    fn production_allows_only_listed_origins() {
        let listed = vec!["https://contract-zero.vercel.app".to_string()];
        assert!(origin_allowed("https://contract-zero.vercel.app", &listed, true));
        assert!(!origin_allowed("http://localhost:3000", &listed, true));
        assert!(!origin_allowed("http://127.0.0.1:3000", &listed, true));
        assert!(!origin_allowed("https://evil.example", &listed, true));
        assert!(!origin_allowed("https://contract-zero.vercel.app.evil.example", &listed, true));
        // A trailing slash in the setting still matches the browser's origin, and only it.
        let slashed = vec!["https://contract-zero.vercel.app/".to_string()];
        assert!(origin_allowed("https://contract-zero.vercel.app", &slashed, true));
        assert!(!origin_allowed("https://contract-zero.vercel.app.evil.example", &slashed, true));
    }

    #[test]
    fn development_also_allows_local_origins() {
        assert!(origin_allowed("http://localhost:3000", &[], false));
        assert!(origin_allowed("http://127.0.0.1:3000", &[], false));
        assert!(!origin_allowed("https://evil.example", &[], false));
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    // A host with no key files passes every signing key in CZ_KEYS_JSON (one secret);
    // write them to a private directory before anything reads CZ_KEYS_DIR.
    if let Ok(json) = std::env::var("CZ_KEYS_JSON") {
        let dir = std::env::temp_dir().join(format!("cz-keys-{}", std::process::id()));
        let (dir, accounts) = services::keys::materialize(&json, dir).map_err(anyhow::Error::msg)?;
        // SAFETY: first thing at startup, before any other code reads the environment.
        unsafe {
            std::env::set_var("CZ_KEYS_DIR", &dir);
            if let (Ok(relayer), Err(_)) = (std::env::var("CZ_RELAYER_ACCOUNT"), std::env::var("CZ_RELAYER_KEY_FILE")) {
                if accounts.contains(&relayer) {
                    std::env::set_var("CZ_RELAYER_KEY_FILE", dir.join(format!("{relayer}.json")));
                }
            }
            std::env::remove_var("CZ_KEYS_JSON");
        }
        tracing::info!("signing keys loaded from CZ_KEYS_JSON for {} account(s)", accounts.len());
    }

    let _sentry_guard = std::env::var("SENTRY_DSN").ok().map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions { release: sentry::release_name!(), ..Default::default() },
        ))
    });

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .with(sentry_tracing::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let connect_opts = PgConnectOptions::from_str(&database_url).expect("Invalid DATABASE_URL");
    // Wait for the database instead of exiting: a host restarting a crashing service
    // gives up after a few tries, and a database blip (Supabase was unreachable for a
    // few minutes on 2026-11-13) then left the API down for hours.
    let db = {
        let mut wait = 2u64;
        loop {
            match PgPoolOptions::new().max_connections(20).acquire_timeout(std::time::Duration::from_secs(15)).connect_with(connect_opts.clone()).await {
                Ok(db) => break db,
                Err(e) => {
                    tracing::warn!("database not reachable ({e}); retrying in {wait}s");
                    tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                    wait = (wait * 2).min(30);
                }
            }
        }
    };

    // Apply pending migrations before serving; a failure aborts boot on purpose.
    migrate::run(&db).await?;

    // Single writer: hold the world lock for as long as this process runs.
    let mut writer = db.acquire().await?.detach();
    let (locked,): (bool,) = sqlx::query_as("SELECT pg_try_advisory_lock($1)").bind(WORLD_WRITER_LOCK).fetch_one(&mut writer).await?;
    if !locked {
        // Another instance owns the world. On a platform deploy that is the previous
        // release, still serving until this one reports healthy; exiting here meant no
        // release could ever replace it. So stand by: answer /health (and nothing else)
        // until the old instance stops and its session, and with it the lock, goes away.
        // A second instance started by mistake just waits here, never writing.
        tracing::warn!("another API instance owns the world (advisory lock {WORLD_WRITER_LOCK:#x}); standing by until it releases");
        let standby = HttpServer::new(|| {
            App::new()
                .route("/health", web::get().to(|| async { actix_web::HttpResponse::Ok().body("standby") }))
                .default_service(web::to(|| async {
                    actix_web::HttpResponse::ServiceUnavailable()
                        .insert_header(("Retry-After", "5"))
                        .json(serde_json::json!({ "error": "the API is handing over to a new release; retry in a few seconds" }))
                }))
        })
        .workers(1)
        .bind(bind_addr())?
        .run();
        let handle = standby.handle();
        let serving = tokio::spawn(standby);
        let started = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let (got,): (bool,) = sqlx::query_as("SELECT pg_try_advisory_lock($1)").bind(WORLD_WRITER_LOCK).fetch_one(&mut writer).await?;
            if got {
                break;
            }
            if started.elapsed().as_secs() % 60 < 2 {
                tracing::info!("still standing by for the world lock ({}s)", started.elapsed().as_secs());
            }
        }
        handle.stop(true).await;
        let _ = serving.await;
        tracing::info!("world lock acquired after {}s; starting", started.elapsed().as_secs());
    }
    // The lock lives on this one connection. If the connection drops (a network blip, a
    // database or pooler restart), Postgres releases the lock while this process would
    // carry on as if it still owned the world, and a release standing by could take it:
    // two writers. So check it on the same connection; on any doubt, exit and let the
    // platform restart this instance cleanly.
    tokio::spawn(async move {
        let mut writer = writer;
        let mut stalls = 0u32;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(WRITER_CHECK_SECS)).await;
            let held = tokio::time::timeout(
                std::time::Duration::from_secs(WRITER_STALL_SECS),
                sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND ((classid::bigint << 32) | objid::bigint) = $1)")
                    .bind(WORLD_WRITER_LOCK)
                    .fetch_one(&mut writer),
            )
            .await;
            // Exit on evidence only: the lock is gone, or the connection is broken (the
            // session, and with it the lock, is then gone too). A slow answer is not
            // evidence; one 10 s stall during a database blip took production down.
            match held {
                Ok(Ok((true,))) => stalls = 0,
                Ok(Ok((false,))) => fatal_writer("the world lock is no longer held by this instance"),
                Ok(Err(e)) => fatal_writer(&format!("the connection holding the world lock failed: {e}")),
                Err(_) => {
                    stalls += 1;
                    tracing::warn!("the world-lock check stalled ({stalls} in a row)");
                    if stalls >= WRITER_MAX_STALLS {
                        fatal_writer("the connection holding the world lock stopped answering");
                    }
                }
            }
        }
    });

    let production = is_production();
    if production && std::env::var("FRONTEND_ORIGIN").unwrap_or_default().trim().is_empty() {
        anyhow::bail!("CZ_ENV=production requires FRONTEND_ORIGIN (the web app's exact origin)");
    }

    let near = match services::near::NearClient::from_env() {
        Ok(Some(n)) => {
            tracing::info!("settlement: CZ World at {} on NEAR testnet", n.contract);
            Some(std::sync::Arc::new(n))
        }
        Ok(None) => None,
        Err(e) => anyhow::bail!("NEAR settlement misconfigured: {e}"),
    };
    let auth = services::auth::AuthService::from_env(near.as_ref().map(|n| n.contract.to_string())).map_err(|e| anyhow::anyhow!("auth misconfigured: {e}"))?;
    if auth.dev_login && near.is_some() {
        anyhow::bail!("AUTH_DEV_LOGIN cannot be enabled while settlement is on NEAR");
    }
    match &auth.relayer {
        Some(r) => tracing::info!("auth: gas relayer {}", r.account),
        None => tracing::info!("auth: no gas relayer (sessions keys and social sign-in sponsorship disabled)"),
    }
    let world = services::world::WorldService::load(db, near.clone()).await?;
    let app_state = AppState {
        near,
        world,
        mission_limiter: std::sync::Arc::new(services::rate_limiter::RateLimiter::new(20, 60)),
        auth: std::sync::Arc::new(auth),
        worker_id: format!("{}-{}-{}", std::env::var("HOSTNAME").unwrap_or_else(|_| "api".into()), std::process::id(), &uuid::Uuid::new_v4().to_string()[..8]),
        intents: services::intents::IntentsClient::from_env(),
        voice: services::voice::VoiceService::from_env(),
    };
    tracing::info!("voice: {}", if app_state.voice.is_some() { "radio lines are synthesized (TTS_URL)" } else { "no voice service; radio lines play as subtitles and squelch" });

    services::scheduler::spawn(app_state.clone());
    services::voice::spawn_radio_warmup(app_state.clone());
    services::settlement::spawn_worker(app_state.clone());
    services::exchange::spawn_sweeper(app_state.clone());
    services::planner::spawn(app_state.clone());

    // FRONTEND_ORIGIN: comma-separated allowed origins. In development, localhost and
    // 127.0.0.1 are allowed too; in production (CZ_ENV=production) only the list.
    let allowed_origins: Vec<String> = std::env::var("FRONTEND_ORIGIN")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // BIND_ADDR, else the platform's PORT (Railway, Render, Fly), else 8080.
    let bind_addr = bind_addr();
    tracing::info!("Starting CONTRACT ZERO API on {}", bind_addr);

    HttpServer::new(move || {
        let origins = allowed_origins.clone();
        let csrf_origins = allowed_origins.clone();
        let cors = Cors::default()
            .allowed_origin_fn(move |origin, _req_head| origin_allowed(origin.to_str().unwrap_or(""), &origins, production))
            .allow_any_method()
            .allow_any_header()
            .supports_credentials()
            .max_age(3600);

        App::new()
            .app_data(web::Data::new(app_state.clone()))
            // CSRF: a state-changing request that carries a browser Origin must come from an
            // allowed origin, whatever CORS lets through. (Scripts without an Origin still
            // need the session cookie, which a browser on another site won't attach to a
            // request it can't read.)
            .wrap(actix_web::middleware::Condition::new(true, actix_web::middleware::from_fn(move |req: actix_web::dev::ServiceRequest, next: actix_web::middleware::Next<actix_web::body::BoxBody>| {
                let origins = csrf_origins.clone();
                async move {
                    let unsafe_method = !matches!(*req.method(), actix_web::http::Method::GET | actix_web::http::Method::HEAD | actix_web::http::Method::OPTIONS);
                    let origin = req.headers().get("origin").and_then(|v| v.to_str().ok()).map(str::to_string);
                    if unsafe_method {
                        if let Some(o) = origin {
                            if !origin_allowed(&o, &origins, production) {
                                return Err(actix_web::error::ErrorForbidden("cross-site request refused"));
                            }
                        }
                    }
                    next.call(req).await
                }
            })))
            .wrap(Logger::default())
            .wrap(cors)
            .wrap(sentry_actix::Sentry::new())
            .configure(handlers::configure_routes)
    })
    .bind(&bind_addr)?
    .run()
    .await?;

    Ok(())
}
