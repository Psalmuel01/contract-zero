//! Radio voices for lines the server wrote: a mission's story (authored, or rewritten
//! by the model and checked). Synthesis runs in the
//! private voice service (apps/tts, TTS_URL + TTS_TOKEN); the browser never sees it or
//! its token, and can only ask for a line by its id in a record the server stored, never
//! for arbitrary text. Every distinct line is synthesized once (voice_cache).
//!
//! Anything that fails (no service configured, a slow or failed synthesis) is a 404 for
//! the client, which keeps the subtitle and the radio's own squelch for that line.

use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

/// Bump with apps/tts/voices.py VOICE_VERSION when a character's voice changes.
pub const VOICE_VERSION: u32 = 1;
pub const SPEAKERS: [&str; 5] = ["handler", "halcyon", "vanguard", "vex", "ashen"];
const MAX_CHARS: usize = 300;

#[derive(Clone)]
pub struct VoiceService {
    url: String,
    token: String,
    http: reqwest::Client,
}

pub fn cache_key(speaker: &str, text: &str) -> String {
    hex::encode(Sha256::digest(format!("{VOICE_VERSION}|{speaker}|{}", text.split_whitespace().collect::<Vec<_>>().join(" ")).as_bytes()))
}

impl VoiceService {
    /// `None` unless both TTS_URL and TTS_TOKEN are set.
    pub fn from_env() -> Option<Self> {
        let url = std::env::var("TTS_URL").ok().map(|u| u.trim().trim_end_matches('/').to_string()).filter(|u| !u.is_empty())?;
        let token = std::env::var("TTS_TOKEN").ok().filter(|t| !t.trim().is_empty())?;
        // A line takes a few seconds on a CPU; past this the client already moved on.
        Some(Self { url, token, http: super::bounded_http(5, 45) })
    }

    async fn synthesize(&self, speaker: &str, text: &str) -> Result<Vec<u8>, String> {
        let r = self.http.post(format!("{}/synthesize", self.url)).bearer_auth(&self.token).json(&json!({ "speaker": speaker, "text": text })).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("voice service: {}", r.status()));
        }
        Ok(r.bytes().await.map_err(|e| e.to_string())?.to_vec())
    }

    /// The line's audio: from the cache, or synthesized now and cached.
    pub async fn audio(&self, db: &PgPool, speaker: &str, text: &str) -> Result<Vec<u8>, String> {
        if !SPEAKERS.contains(&speaker) || text.trim().is_empty() || text.len() > MAX_CHARS {
            return Err("not a voiceable line".into());
        }
        let key = cache_key(speaker, text);
        if let Ok(Some((audio,))) = sqlx::query_as::<_, (Vec<u8>,)>("SELECT audio FROM voice_cache WHERE key = $1").bind(&key).fetch_optional(db).await {
            return Ok(audio);
        }
        let audio = self.synthesize(speaker, text).await?;
        let _ = sqlx::query("INSERT INTO voice_cache (key, speaker, text, audio) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING")
            .bind(&key).bind(speaker).bind(text).bind(&audio).execute(db).await;
        Ok(audio)
    }

    /// Voice a mission's lines in the background, in the order a run meets them, so
    /// most are cached before they are needed. Sequential: the service does one at a time anyway.
    pub fn warm(&self, db: PgPool, lines: Vec<(String, String)>) {
        let me = self.clone();
        tokio::spawn(async move {
            for (speaker, text) in lines {
                if let Err(e) = me.audio(&db, &speaker, &text).await {
                    tracing::debug!("voice warm-up skipped a line: {e}");
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });
    }
}

/// The order a mission's radio beats tend to fire in (presence.ts triggers).
const BEAT_ORDER: [&str; 14] = ["opStart", "opBreach", "firstContact", "rivalFirstWord", "opPushIn", "troopsCleared", "reinforcements", "cargoSecured", "chargePlaced", "detonation", "extractCalled", "extractBroken", "extractDone", "missionCleared"];

/// A stored story's RADIO lines, in the order a run tends to meet them: (id, speaker,
/// text). The briefing is read on screen, never played, so it is never voiced.
pub fn story_lines(story: &Value) -> Vec<(String, String, String)> {
    let line = |l: &Value| Some((l["id"].as_str()?.to_string(), l["speaker"].as_str()?.to_string(), l["text"].as_str()?.to_string()));
    let mut out: Vec<(String, String, String)> = Vec::new();
    let radio = story["radio"].as_object();
    let mut keys: Vec<&String> = radio.map(|r| r.keys().collect()).unwrap_or_default();
    keys.sort_by_key(|k| BEAT_ORDER.iter().position(|b| b == k).unwrap_or(BEAT_ORDER.len()));
    for k in keys {
        out.extend(radio.unwrap()[k].as_array().into_iter().flatten().filter_map(line));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cache_key_ignores_spacing_but_not_words_speaker_or_version() {
        assert_eq!(cache_key("vex", "Lovely.  Bring it round."), cache_key("vex", "Lovely. Bring it round."));
        assert_ne!(cache_key("vex", "Lovely."), cache_key("ashen", "Lovely."));
        assert_ne!(cache_key("vex", "Lovely."), cache_key("vex", "Lovely!"));
    }

    #[test]
    fn a_story_is_voiced_in_play_order_and_its_briefing_never() {
        let s = json!({
            "briefing": [{ "id": "dyn-b1", "speaker": "handler", "text": "Brief." }],
            "radio": {
                "extractDone": [{ "id": "dyn-x", "speaker": "handler", "text": "Out." }],
                "opStart": [{ "id": "dyn-s", "speaker": "handler", "text": "Go." }],
                "rivalFirstWord": [{ "id": "dyn-r", "speaker": "vanguard", "text": "Vanguard." }],
            }
        });
        let ids: Vec<String> = story_lines(&s).into_iter().map(|l| l.0).collect();
        assert_eq!(ids, ["dyn-s", "dyn-r", "dyn-x"]);
    }
}
