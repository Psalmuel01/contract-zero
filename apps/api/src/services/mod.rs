pub mod alerts;
pub mod rate_limiter;
pub mod scheduler;
pub mod world;
pub mod near;
pub mod settlement;
pub mod exchange;
pub mod auth;
pub mod planner;
pub mod story;
pub mod protocol;
pub mod intents;
pub mod keys;

/// An HTTP client that can't wait forever. Every outbound call (NEAR RPC, NEAR Auth,
/// alerts) used `reqwest::Client::new()`, which has no timeout: an endpoint that
/// accepts the connection and never answers held its caller indefinitely (for the
/// settlement worker, the whole queue). Per-request timeouts still override `total`.
pub fn bounded_http(connect_secs: u64, total_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(connect_secs))
        .timeout(std::time::Duration::from_secs(total_secs))
        .build()
        .expect("http client")
}
