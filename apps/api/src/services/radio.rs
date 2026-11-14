//! Strategic radio: what the factions and merchants do, said in their own voices. Every
//! line is built HERE from a record the server holds (an accepted, logged faction
//! decision; a supply order that really filled), so the caption and the voice are the
//! same validated text, and the radio can only say what happened, with real numbers.
//! (These templates moved from apps/web/src/engine/story/strategicRadio.ts, unchanged in
//! wording, so the browser no longer writes text the server would have to voice.)
//!
//!   shortage     a faction's accepted order for a resource it is short of
//!   retaliation  a faction's accepted bounty on a rival (a response, or pre-emptive)
//!   procurement  a merchant filling a supply order

use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;

use cz_economy::{OrderStatus, Resource, World};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RadioLine {
    /// Stable per event (`decision-<seq>`, `order-<id>`): dedupe, and the voice's address.
    pub key: String,
    pub speaker: String,
    pub text: String,
    pub tick: u64,
    /// The record it was made from, for the advanced view.
    pub evidence: String,
}

fn name(r: &str) -> Option<&'static str> {
    match r { "ammo" => Some("ammunition"), "med" => Some("medicine"), "fuel" => Some("fuel"), _ => None }
}
fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}
/// 12345 -> "12,345" (as the browser's en-US formatting wrote it).
pub fn n(x: i64) -> String {
    let s = x.abs().to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); }
        out.push(ch);
    }
    if x < 0 { format!("-{out}") } else { out }
}
fn faction_name(id: &str) -> String {
    match id { "vanguard" => "Vanguard".into(), "ashen" => "Ashen Compact".into(), other => cap(other) }
}

/// One accepted faction decision as radio, if it is one of the moves the radio speaks of.
pub fn from_decision(seq: i64, tick: i64, source: &str, p: &Value) -> Option<RadioLine> {
    if p["validation"] != "accepted" { return None; }
    let who = source.trim_start_matches("agent:");
    if who != "vanguard" && who != "ashen" { return None; }
    let a = &p["action"];
    let trigger = p["trigger"].as_str().unwrap_or("");
    let ctx = |k: &str| p["context"].as_array().and_then(|c| c.iter().find(|e| e[0] == k)).and_then(|e| e[1].as_i64());
    let evidence = format!("{who}: {trigger}{}", p["rationale"].as_str().map(|r| format!(" · {r}")).unwrap_or_default());
    let line = |text: String| RadioLine { key: format!("decision-{seq}"), speaker: who.into(), text, tick: tick.max(0) as u64, evidence: evidence.clone() };
    // a shortage: it placed an order to buy what it is short of
    let mut words = trigger.splitn(2, ' ');
    if let (Some(res), Some(rest)) = (words.next(), words.next()) {
        if name(res).is_some() && (rest.starts_with("below target") || rest.starts_with("critical"))
            && a["action"] == "place_order" && (a.get("side").is_none() || a["side"] == "buy")
        {
            let (have, target) = (ctx("have")?, ctx("target")?);
            let r = cap(name(res)?);
            return Some(line(if who == "vanguard" {
                format!("{r} at {} of {}. Logged. Resupply is ordered.", n(have), n(target))
            } else {
                format!("{r} at {} of {}. We burn without it. We are buying.", n(have), n(target))
            }));
        }
    }
    // a response to a rival: it posted a bounty
    if (trigger == "retaliation" || trigger == "pre-emptive strike") && (a["action"] == "post_bounty" || a["action"] == "post_contract") {
        let target = a["target"].as_str()?;
        let res = name(a["resource"].as_str()?)?;
        let amount = a["amount"].as_i64()?;
        let place = format!("{}'s {res} depot", faction_name(target));
        return Some(line(if who == "vanguard" {
            format!("{} credits on {place}. We keep count.", n(amount))
        } else {
            format!("{} credits to whoever raids {place}. We pay for the fire.", n(amount))
        }));
    }
    None
}

/// A supply order that really filled, in the voice of the merchant that filled it.
pub fn from_order(w: &World, order: u64) -> Option<RadioLine> {
    let o = w.orders.get(&order)?;
    if o.status != OrderStatus::Filled || o.fills.is_empty() { return None; }
    let merchant = o.fills[0].merchant.as_str();
    if merchant != "vex" && merchant != "halcyon" { return None; }
    let qty: i64 = o.fills.iter().map(|f| f.qty).sum();
    let total: i64 = o.fills.iter().map(|f| f.total).sum();
    if qty <= 0 { return None; }
    let res = match o.resource { Resource::Ammo => "ammunition", Resource::Med => "medicine", Resource::Fuel => "fuel" };
    let requester = w.actors.get(&o.requester).map(|a| a.name.clone()).unwrap_or_else(|| o.requester.clone());
    let text = if merchant == "vex" {
        format!("Lovely. {} {res} to {requester} for {} credits. As agreed.", n(qty), n(total))
    } else {
        format!("Halcyon filled {} {res} for {requester} at {:.1} credits a unit.", n(qty), total as f64 / qty as f64)
    };
    let tick = o.fills.iter().map(|f| f.tick).max().unwrap_or(0);
    let evidence = format!("order #{order}: {}", o.fills.iter().map(|f| format!("{} {} for {} cr", f.merchant, f.qty, f.total)).collect::<Vec<_>>().join(", "));
    Some(RadioLine { key: format!("order-{order}"), speaker: merchant.into(), text, tick, evidence })
}

/// Filled orders as radio, from the world (call inside a brief world read).
pub fn order_lines(w: &World) -> Vec<RadioLine> {
    let mut filled: Vec<u64> = w.orders.values().filter(|o| o.status == OrderStatus::Filled && !o.fills.is_empty()).map(|o| o.id).collect();
    filled.sort_unstable();
    filled.iter().rev().take(20).filter_map(|&id| from_order(w, id)).collect()
}

/// How long one read of recent decisions serves every caller (each open game tab polls
/// `/radio`, and the voice warm-up loop reads it too). Decisions arrive once a game hour.
const DECISIONS_TTL: std::time::Duration = std::time::Duration::from_secs(10);
type Cached = Option<(std::time::Instant, Vec<RadioLine>)>;
fn decisions_cache() -> &'static tokio::sync::Mutex<Cached> {
    static C: std::sync::OnceLock<tokio::sync::Mutex<Cached>> = std::sync::OnceLock::new();
    C.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Recent accepted decisions as radio, from the database (outside any world lock). One
/// query per `DECISIONS_TTL` however many ask: callers queue on the cache's lock, so a
/// burst shares a single read (served by idx_world_events_accepted_decisions).
pub async fn decision_lines(db: &PgPool) -> Vec<RadioLine> {
    let mut cache = decisions_cache().lock().await;
    if let Some((at, lines)) = cache.as_ref() {
        if at.elapsed() < DECISIONS_TTL { return lines.clone(); }
    }
    let rows: Result<Vec<(i64, i64, String, Value)>, _> = sqlx::query_as(
        "SELECT seq, tick, source, payload FROM world_events WHERE kind = 'agent_decision' AND payload->>'validation' = 'accepted' ORDER BY seq DESC LIMIT 60",
    ).fetch_all(db).await;
    match rows {
        Ok(rows) => {
            let lines: Vec<RadioLine> = rows.iter().filter_map(|(s, t, src, p)| from_decision(*s, *t, src, p)).collect();
            *cache = Some((std::time::Instant::now(), lines.clone()));
            lines
        }
        // A failed read is not cached; the last good lines are better than none.
        Err(_) => cache.as_ref().map(|(_, l)| l.clone()).unwrap_or_default(),
    }
}

/// The latest `limit` lines, oldest first.
pub fn latest(mut lines: Vec<RadioLine>, limit: usize) -> Vec<RadioLine> {
    lines.sort_by_key(|l| l.tick);
    let skip = lines.len().saturating_sub(limit);
    lines.into_iter().skip(skip).collect()
}

/// One decision line by its key, rebuilt from its record (never from the request).
pub async fn decision_by_key(db: &PgPool, key: &str) -> Option<RadioLine> {
    let seq = key.strip_prefix("decision-")?.parse::<i64>().ok()?;
    let (s, t, src, p): (i64, i64, String, Value) = sqlx::query_as("SELECT seq, tick, source, payload FROM world_events WHERE seq = $1 AND kind = 'agent_decision'")
        .bind(seq).fetch_optional(db).await.ok()??;
    from_decision(s, t, &src, &p)
}

/// One order line by its key (call inside a brief world read).
pub fn order_by_key(w: &World, key: &str) -> Option<RadioLine> {
    from_order(w, key.strip_prefix("order-")?.parse().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_read_as_the_browser_wrote_them() {
        assert_eq!(n(7), "7");
        assert_eq!(n(1234), "1,234");
        assert_eq!(n(12233), "12,233");
        assert_eq!(n(1_000_000), "1,000,000");
    }

    #[test]
    fn a_shortage_order_is_said_in_the_faction_s_voice_with_the_real_numbers() {
        let p = json!({ "validation": "accepted", "trigger": "med below target", "context": [["have", 17], ["target", 24]],
                        "action": { "action": "place_order", "side": "buy", "resource": "med", "qty": 7 } });
        let v = from_decision(14433, 2490, "vanguard", &p).unwrap();
        assert_eq!((v.key.as_str(), v.speaker.as_str(), v.text.as_str()), ("decision-14433", "vanguard", "Medicine at 17 of 24. Logged. Resupply is ordered."));
        let a = from_decision(1, 1, "agent:ashen", &json!({ "validation": "accepted", "trigger": "ammo critical", "context": [["have", 3], ["target", 1200]], "action": { "action": "place_order" } })).unwrap();
        assert_eq!(a.text, "Ammunition at 3 of 1,200. We burn without it. We are buying.");
    }

    #[test]
    fn a_bounty_names_the_rival_s_depot() {
        let p = json!({ "validation": "accepted", "trigger": "retaliation", "action": { "action": "post_bounty", "target": "ashen", "resource": "fuel", "amount": 2500 } });
        assert_eq!(from_decision(2, 2, "vanguard", &p).unwrap().text, "2,500 credits on Ashen Compact's fuel depot. We keep count.");
        let q = json!({ "validation": "accepted", "trigger": "pre-emptive strike", "action": { "action": "post_contract", "target": "vanguard", "resource": "ammo", "amount": 900 } });
        assert_eq!(from_decision(3, 3, "ashen", &q).unwrap().text, "900 credits to whoever raids Vanguard's ammunition depot. We pay for the fire.");
    }

    #[test]
    fn nothing_else_becomes_radio() {
        // rejected, a surplus sale, a merchant, or a shortage without its numbers
        assert!(from_decision(1, 1, "vanguard", &json!({ "validation": "rejected", "trigger": "med below target", "context": [["have", 1], ["target", 2]], "action": { "action": "place_order" } })).is_none());
        assert!(from_decision(1, 1, "ashen", &json!({ "validation": "accepted", "trigger": "fuel surplus", "context": [["have", 843]], "action": { "action": "place_order", "side": "sell" } })).is_none());
        assert!(from_decision(1, 1, "vex", &json!({ "validation": "accepted", "trigger": "med below target", "action": { "action": "place_order" } })).is_none());
        assert!(from_decision(1, 1, "vanguard", &json!({ "validation": "accepted", "trigger": "med below target", "action": { "action": "place_order" } })).is_none());
    }
}
