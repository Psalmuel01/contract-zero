//! The strategic planner: a language model (NEAR AI Cloud) proposes each agent's
//! discretionary moves; the engine decides whether they happen.
//!
//! Two layers:
//! - **Operational** (`cz_economy::policy`, every tick, deterministic): keep stocks up,
//!   set posture from recent raids, sell surplus, seize when starving. It never stops,
//!   and is what runs when the model is unavailable.
//! - **Strategic** (this module, every `PLANNER_EVERY_TICKS`): each agent's model sees a
//!   structured observation (its own position, rivals, the market, threats and its
//!   memory of who hurt it, and what its deterministic policy would do) and proposes
//!   up to three moves.
//!
//! **The model never has authority.** Every proposal is parsed into a typed `Action`,
//! checked against the actor's spending policy here (reserve, price discipline, only
//! its own kind of moves), then executed by the engine like any other command. A
//! rejected proposal changes nothing. Trades settle on NEAR through the same restricted
//! keys as the deterministic policy's; the model never sees a key. Every call is logged
//! (model, observation digest, raw output, usage, latency, per-action validation).

use std::time::{Duration, Instant};

use cz_economy::policy::{self, ammo_target, spendable};
use cz_economy::{Action, ActorKind, Asset, ConvoyStatus, OpKind, Resource, Side, Strategy, World, DEFENSE_COST};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::world::{log_event, summarize};
use crate::AppState;

pub struct Planner {
    http: reqwest::Client,
    base: String,
    key: String,
    pub model: String,
    pub every_ticks: u64,
    timeout: Duration,
}

impl Planner {
    /// `None` without `NEAR_AI_API_KEY`: the deterministic policies run alone.
    pub fn from_env() -> Option<Self> {
        let key = std::env::var("NEAR_AI_API_KEY").ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())?;
        Some(Self {
            http: super::bounded_http(10, 120), // each call also sets its own, shorter limit
            base: std::env::var("NEAR_AI_BASE").unwrap_or_else(|_| "https://cloud-api.near.ai/v1".into()),
            key,
            model: std::env::var("NEAR_AI_MODEL").unwrap_or_else(|_| "anthropic/claude-haiku-5-5".into()),
            every_ticks: std::env::var("PLANNER_EVERY_TICKS").ok().and_then(|v| v.parse().ok()).unwrap_or(6).max(1),
            timeout: Duration::from_secs(std::env::var("PLANNER_TIMEOUT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(20)),
        })
    }

    async fn complete(&self, system: &str, user: &str) -> Result<(String, Value), String> {
        let max_tokens = std::env::var("PLANNER_MAX_TOKENS").ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(4096).clamp(1024, 16384);
        self.complete_json("plan", schema(), system, user, max_tokens, self.timeout).await
    }

    /// One chat completion constrained to a JSON schema. Returns the raw content and
    /// the usage block; the caller parses and validates.
    pub async fn complete_json(&self, name: &str, schema: Value, system: &str, user: &str, max_tokens: u32, timeout: Duration) -> Result<(String, Value), String> {
        // Some compatible providers do not enforce response_format. State the
        // contract in the prompt as well; typed parsing remains authoritative.
        let system = format!("{system}\nReturn a JSON object matching this JSON Schema exactly. String fields must be plain strings, not objects. Include every required field. Keep the answer concise.\n{schema}");
        let body = json!({
            "model": self.model,
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
            "response_format": { "type": "json_schema", "json_schema": { "name": name, "schema": schema } },
            "max_tokens": max_tokens,
            "temperature": 0.4,
        });
        let r = self.http.post(format!("{}/chat/completions", self.base)).bearer_auth(&self.key).timeout(timeout).json(&body).send().await.map_err(|e| format!("request: {e}"))?;
        let status = r.status();
        let v: Value = r.json().await.map_err(|e| format!("response: {e}"))?;
        if !status.is_success() {
            return Err(format!("HTTP {status}: {}", v.to_string().chars().take(300).collect::<String>()));
        }
        if v["choices"][0]["finish_reason"] == "length" {
            return Err(format!("output token limit reached ({max_tokens}); increase PLANNER_MAX_TOKENS for strategic plans"));
        }
        let content = v["choices"][0]["message"]["content"].as_str().ok_or_else(|| format!("no content: {}", v.to_string().chars().take(300).collect::<String>()))?.to_string();
        Ok((content, v["usage"].clone()))
    }
}

/// What a model may answer: an assessment, an in-character broadcast, and ≤ 3 moves.
pub fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assessment": { "type": "string", "description": "Two sentences: your situation and your intent." },
            "broadcast": { "type": "string", "description": "One in-character radio line (≤ 20 words) other factions and players can hear. No numbers you were not given." },
            "actions": {
                "type": "array", "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": { "type": "string", "enum": ["request_supplies", "trade", "post_bounty", "configure_defense", "seize_convoy", "set_margin", "post_sabotage", "none"] },
                        "resource": { "type": "string", "enum": ["ammo", "med", "fuel"] },
                        "side": { "type": "string", "enum": ["buy", "sell"] },
                        "qty": { "type": "integer" },
                        "target": { "type": "string" },
                        "amount": { "type": "integer" },
                        "level": { "type": "integer" },
                        "convoy": { "type": "integer" },
                        "margin_bp": { "type": "integer" },
                        "limit_total": { "type": "integer", "description": "request_supplies: the most you pay (buy) or least you take (sell) for the whole quantity" },
                        "rationale": { "type": "string" }
                    },
                    "required": ["type", "rationale"]
                }
            }
        },
        "required": ["assessment", "broadcast", "actions"]
    })
}

#[derive(Debug, Deserialize)]
pub struct Proposal {
    pub assessment: String,
    #[serde(default)]
    pub broadcast: String,
    #[serde(default)]
    pub actions: Vec<Proposed>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Proposed {
    #[serde(rename = "type")]
    pub kind: String,
    pub resource: Option<String>,
    pub side: Option<String>,
    pub qty: Option<i64>,
    pub target: Option<String>,
    pub amount: Option<i64>,
    pub level: Option<u8>,
    pub convoy: Option<u64>,
    pub margin_bp: Option<i64>,
    #[serde(default)]
    pub limit_total: Option<i64>,
    #[serde(default)]
    pub rationale: String,
}

fn character(w: &World, actor: &str) -> String {
    let a = &w.actors[actor];
    match (a.kind, actor) {
        (ActorKind::Merchant, _) => format!("You are {}, an independent arms and supply merchant. Profit over loyalty; you trade with every faction and price by scarcity. You can change your margin, and pay for sabotage or raids that make your goods scarcer or your rivals' cheaper.", a.name),
        (_, "ashen") => format!("You command the {}, a fuel-refining militia. Doctrine: strike first. You make fuel, you need ammunition, and you'd rather pay raiders to bleed a rival than wait to be bled.", a.name),
        _ => format!("You command {}, a disciplined garrison that manufactures ammunition. Doctrine: hold ground. You protect your depots, keep your reserves, and only pay for raids on rivals who paid for raids on you.", a.name),
    }
}

const RULES: &str = "Rules: answer ONLY with the JSON object. Propose at most 3 actions, or [{\"type\":\"none\"}] if nothing beyond your routine operations is warranted (they already run: restocking to target, selling surplus, posture after raids). Use only numbers from the observation; you cannot create resources or credits. Spending is capped at your spendable credits. A bounty or contract amount must be 25%..150% of the target's value. Every action is checked by the game engine and refused if invalid.";

/// The structured observation for one agent (also what gets digested into the log).
pub fn observation(w: &World, actor: &str) -> Value {
    let a = &w.actors[actor];
    let res = |acct: &str| json!({ "credits": w.balance(acct, Asset::Credits), "ammo": w.balance(acct, Asset::Res(Resource::Ammo)), "med": w.balance(acct, Asset::Res(Resource::Med)), "fuel": w.balance(acct, Asset::Res(Resource::Fuel)) });
    let targets = |x: &cz_economy::Actor| json!({ "ammo": if x.kind == ActorKind::Faction { ammo_target(x) } else { w.market.target[0] }, "med": if x.kind == ActorKind::Faction { x.requirement(Resource::Med) } else { w.market.target[1] }, "fuel": if x.kind == ActorKind::Faction { x.requirement(Resource::Fuel) } else { w.market.target[2] } });
    let factions: Vec<Value> = w.actors.values().filter(|x| x.kind == ActorKind::Faction && x.id != actor).map(|x| json!({
        "id": x.id, "name": x.name, "holdings": res(&x.account), "defense": x.defense,
        "depots": Resource::ALL.iter().filter_map(|&r| cz_economy::mission::raid_plan(w, &x.id, r).map(|p| json!({ "resource": r.name(), "units": p.manifest, "value": p.manifest * cz_economy::pricing::production_cost(r) }))).collect::<Vec<_>>(),
    })).collect();
    let prices: Vec<Value> = Resource::ALL.iter().map(|&r| { let p = w.price(r); json!({ "resource": r.name(), "ask": p.ask, "bid": p.bid, "merchant_stock": w.merchant_stock(r), "production_cost": cz_economy::pricing::production_cost(r) }) }).collect();
    let memory = w.memory.get(actor).map(|m| json!({
        "players": m.players.iter().map(|(p, g)| json!({ "player": p, "raids": g.raids, "sabotage": g.sabotage, "recoveries": g.recoveries, "units_lost": g.units_lost, "last_tick": g.last_tick })).collect::<Vec<_>>(),
        "rivals_who_paid_for_raids_on_you": m.sponsors.iter().map(|(s, t)| json!({ "rival": s, "times": t.len(), "last_tick": t.last() })).collect::<Vec<_>>(),
    }));
    let contracts: Vec<Value> = w.open_bounties().map(|b| json!({ "kind": b.kind.name(), "sponsor": b.sponsor, "target": b.target, "resource": b.resource.name(), "amount": b.amount })).collect();
    let caravans: Vec<Value> = w.convoys.values().filter(|c| c.status == ConvoyStatus::InTransit && w.actors.get(&c.owner).is_some_and(|o| o.kind == ActorKind::Merchant)).map(|c| json!({ "convoy": c.id, "resource": c.resource.name(), "units": c.units, "arrives_at": c.arrives_at })).collect();
    let routine: Vec<String> = match a.kind {
        ActorKind::Merchant => policy::merchant(w),
        _ => policy::commander(w, actor),
    }.into_iter().map(|d| d.rationale).collect();
    json!({
        "tick": w.tick, "hour": w.tick % 24,
        "you": {
            "id": a.id, "name": a.name, "kind": a.kind, "holdings": res(&a.account), "targets": targets(a),
            "spendable_credits": spendable(w, a), "credit_reserve": a.credit_reserve, "defense": a.defense,
            "doctrine": a.doctrine, "production_per_day": a.production, "consumption_per_day": a.consumption,
            "production_down": Resource::ALL.iter().filter(|&&r| w.disrupted(actor, r)).map(|r| r.name()).collect::<Vec<_>>(),
            "recent_raids_on_you": w.recent_raids_on(actor, policy::RAID_MEMORY_TICKS),
            "memory": memory,
        },
        "factions": factions,
        "market": { "merchant": w.market.merchant, "insolvent": w.merchant_insolvent(), "margin_bp": w.market.strategy.margin_bp, "prices": prices },
        "open_contracts": contracts,
        // The supply market: every merchant's own price, and your open orders with the
        // proposals on them. request_supplies posts a bounded order every merchant may
        // answer; the choice among proposals follows your doctrine.
        "merchants": w.merchant_ids().iter().map(|m| json!({ "id": m, "ask": Resource::ALL.iter().map(|&r| (r.name(), w.merchant_quote(m, r, Side::Buy, 1))).collect::<std::collections::BTreeMap<_, _>>(), "bid": Resource::ALL.iter().map(|&r| (r.name(), w.merchant_quote(m, r, Side::Sell, 1))).collect::<std::collections::BTreeMap<_, _>>() })).collect::<Vec<_>>(),
        "your_open_orders": w.open_orders().filter(|o| o.requester == actor).map(|o| json!({ "order": o.id, "side": o.side, "resource": o.resource.name(), "qty": o.qty, "filled": o.filled, "limit_total": o.limit_total, "expires_at": o.expires_at, "proposals": w.pending_proposals(o.id).map(|p| json!({ "merchant": p.merchant, "qty": p.qty, "total": p.total })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
        "merchant_caravans_on_the_road": caravans,
        "routine_operations_this_tick": routine,
        "defense_cost_per_shipment": DEFENSE_COST,
    })
}

fn resource(s: &Option<String>) -> Result<Resource, String> {
    match s.as_deref() {
        Some("ammo") => Ok(Resource::Ammo),
        Some("med") => Ok(Resource::Med),
        Some("fuel") => Ok(Resource::Fuel),
        other => Err(format!("unknown resource {other:?}")),
    }
}

/// Turn one proposal into an engine command, enforcing the actor's own policy limits
/// (which the engine alone doesn't know): only its kind of moves, spending above its
/// reserve only, and price discipline. `Ok(None)` = an explicit "do nothing".
pub fn validate(w: &World, actor: &str, p: &Proposed) -> Result<Option<Action>, String> {
    let a = w.actors.get(actor).ok_or("unknown actor")?;
    let merchant = a.kind == ActorKind::Merchant;
    let budget = spendable(w, a);
    let faction = |id: &Option<String>| -> Result<String, String> {
        let id = id.clone().ok_or("missing target")?;
        let t = w.actors.get(&id).ok_or_else(|| format!("unknown target {id}"))?;
        if t.kind != ActorKind::Faction || id == actor {
            return Err(format!("{id} is not a rival faction"));
        }
        Ok(id)
    };
    match p.kind.as_str() {
        "none" => Ok(None),
        // A supply order: bounded by the same rules as the deterministic commander
        // (budget above reserve, doctrine ceiling unless critically short, cost floor
        // when selling). The model never picks the merchant or signs anything.
        "request_supplies" if !merchant => {
            let r = resource(&p.resource)?;
            let side = match p.side.as_deref() { Some("buy") => Side::Buy, Some("sell") => Side::Sell, s => return Err(format!("bad side {s:?}")) };
            let qty = p.qty.filter(|q| (1..=200).contains(q)).ok_or("qty must be 1..200")?;
            let limit_total = p.limit_total.filter(|l| *l > 0).ok_or("missing limit_total")?;
            let cost = cz_economy::pricing::production_cost(r);
            let have = w.balance(&a.account, Asset::Res(r));
            let target = if r == Resource::Ammo { ammo_target(a) } else { a.requirement(r) };
            let critical = have * 4 < target;
            match side {
                Side::Buy => {
                    if limit_total > budget {
                        return Err(format!("{limit_total} cr is over the spendable {budget}"));
                    }
                    let unit_cap = cost * if critical { cz_economy::pricing::PRICE_CEIL_MULT } else { a.doctrine.max_price_mult };
                    if limit_total > unit_cap * qty {
                        return Err(format!("{limit_total} cr for {qty} breaks price discipline (at most {unit_cap}/unit)"));
                    }
                }
                Side::Sell => {
                    if qty > have {
                        return Err(format!("only {have} {} to sell", r.name()));
                    }
                    if limit_total < cost * qty {
                        return Err(format!("{limit_total} cr for {qty} is below production cost"));
                    }
                }
            }
            let nonce = w.order_nonces.get(actor).copied().unwrap_or(0) + 1;
            let urgency = if critical { 3 } else if have * 2 < target { 2 } else { 1 };
            Ok(Some(Action::PlaceOrder { side, resource: r, qty, limit_total, allow_partial: true, ttl_ticks: policy::ORDER_TTL_TICKS, nonce, urgency, purpose: p.rationale.chars().take(120).collect(), chain_id: None }))
        }
        "trade" if !merchant => {
            let r = resource(&p.resource)?;
            let side = match p.side.as_deref() { Some("buy") => Side::Buy, Some("sell") => Side::Sell, s => return Err(format!("bad side {s:?}")) };
            let qty = p.qty.filter(|q| (1..=200).contains(q)).ok_or("qty must be 1..200")?;
            let q = w.quote(r, side, qty).map_err(|e| e.to_string())?;
            if side == Side::Buy {
                if q.total > budget {
                    return Err(format!("{} cr is over the spendable {budget}", q.total));
                }
                let ceiling = cz_economy::pricing::production_cost(r) * a.doctrine.max_price_mult * qty;
                if q.total > ceiling {
                    return Err(format!("{} cr breaks price discipline (ceiling {ceiling})", q.total));
                }
            }
            Ok(Some(Action::Trade { resource: r, side, qty, limit_total: q.total }))
        }
        "post_bounty" => {
            let target = faction(&p.target)?;
            let r = resource(&p.resource)?;
            let amount = p.amount.filter(|&x| x > 0).ok_or("missing amount")?;
            if amount > budget {
                return Err(format!("{amount} cr is over the spendable {budget}"));
            }
            Ok(Some(Action::PostBounty { target, resource: r, amount }))
        }
        "configure_defense" if !merchant => {
            let level = p.level.filter(|l| (1..=5).contains(l)).ok_or("level must be 1..5")?;
            let need = a.credit_reserve + DEFENSE_COST[level as usize];
            if w.balance(&a.account, Asset::Credits) < need {
                return Err(format!("can't pay level {level} escorts above the reserve ({need} cr needed)"));
            }
            Ok(Some(Action::ConfigureDefense { level }))
        }
        "seize_convoy" if !merchant => Ok(Some(Action::SeizeConvoy { convoy: p.convoy.ok_or("missing convoy")? })),
        "set_margin" if merchant => {
            let margin_bp = p.margin_bp.filter(|m| (1_000..=4_000).contains(m)).ok_or("margin_bp must be 1000..4000")?;
            Ok(Some(Action::SetStrategy { strategy: Strategy { margin_bp, spread_bp: w.market.strategy.spread_bp } }))
        }
        "post_sabotage" if merchant => {
            let target = faction(&p.target)?;
            let r = resource(&p.resource)?;
            let amount = p.amount.filter(|&x| x > 0).ok_or("missing amount")?;
            if amount > budget {
                return Err(format!("{amount} cr is over the spendable {budget}"));
            }
            Ok(Some(Action::PostContract { kind: OpKind::Sabotage, target, resource: r, amount, convoy: None }))
        }
        k => Err(format!("{k} is not a move a {} can make", if merchant { "merchant" } else { "faction" })),
    }
}

/// One strategic round: each agent in turn (observe, propose, validate, execute, log).
/// The world lock is never held across a model call.
static ROUND_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn run(state: &AppState, planner: &Planner) {
    run_triggered(state, planner, "manual strategic review", &[]).await;
}

// ── Spending discipline ─────────────────────────────────────────────────────
// A periodic round used to call the model for every agent whatever had happened:
// ~100 calls an hour overnight, all periodic, while the world sat still. Now a
// periodic round only asks an agent whose situation has materially changed (or who
// has not been asked for PLANNER_MAX_IDLE_SECS), events always ask, and a rolling
// daily cap bounds the spend. Below the cap or not, the deterministic policies run
// every tick regardless, so a skipped call never leaves an agent idle.

/// What a commander actually decides on, coarsened: each stock as a band against its
/// target (critical, low, adequate, comfortable, surplus), credits in doublings, defense,
/// lines down, raids and grudges, the contracts, orders and proposals on the table, and
/// prices in 25% bands of production cost. Production and consumption nudge every
/// holding every tick; at two significant figures nearly every round looked new (715 of
/// 720 in six quiet hours). This changes when the decision might.
pub fn situation_fingerprint(o: &Value) -> String {
    let n = |v: &Value| v.as_f64().unwrap_or(0.0);
    let band = |have: f64, want: f64| -> u8 {
        let r = if want <= 0.0 { if have > 0.0 { 9.0 } else { 1.0 } } else { have / want };
        match r { x if x < 0.25 => 0, x if x < 0.5 => 1, x if x < 0.8 => 2, x if x < 1.25 => 3, x if x < 2.0 => 4, _ => 5 }
    };
    let doublings = |x: f64| if x <= 0.0 { -1 } else { x.log2().floor() as i64 };
    let you = &o["you"];
    let stocks: Vec<u8> = ["ammo", "med", "fuel"].iter().map(|r| band(n(&you["holdings"][r]), n(&you["targets"][r]))).collect();
    let rivals: Vec<Value> = o["factions"].as_array().into_iter().flatten()
        .map(|f| {
            let held: Vec<i64> = ["ammo", "med", "fuel"].iter().map(|r| doublings(n(&f["holdings"][r]))).collect();
            let depots = f["depots"].as_array().map_or(0, |d| d.len());
            json!([f["id"], f["defense"], held, depots])
        })
        .collect();
    let prices: Vec<i64> = o["market"]["prices"].as_array().into_iter().flatten()
        .map(|p| { let c = n(&p["production_cost"]).max(1.0); (n(&p["ask"]) / c * 4.0).round() as i64 })
        .collect();
    let grudges = you["memory"]["players"].as_array().map_or((0, 0.0), |ps| (ps.len(), ps.iter().map(|g| n(&g["raids"]) + n(&g["sabotage"])).sum::<f64>()));
    let key = json!({
        "stocks": stocks,
        "credits": doublings(n(&you["spendable_credits"])),
        "defense": you["defense"],
        "down": you["production_down"],
        "raided": you["recent_raids_on_you"],
        "grudges": [grudges.0, grudges.1],
        "rivals_paid": you["memory"]["rivals_who_paid_for_raids_on_you"].as_array().map_or(0, |r| r.len()),
        "rivals": rivals,
        "insolvent": o["market"]["insolvent"],
        "prices": prices,
        "contracts": o["open_contracts"].as_array().map(|c| c.iter().map(|x| json!([x["kind"], x["sponsor"], x["target"], x["resource"]])).collect::<Vec<_>>()),
        "orders": o["your_open_orders"].as_array().map(|os| os.iter().map(|x| json!([x["order"], x["filled"], x["proposals"].as_array().map_or(0, |p| p.len())])).collect::<Vec<_>>()),
        "caravans": o["merchant_caravans_on_the_road"].as_array().map_or(0, |c| c.len()),
    });
    hex::encode(Sha256::digest(key.to_string().as_bytes()))
}

struct Spend {
    /// Per agent: the fingerprint it was last asked about, and when.
    last: std::collections::BTreeMap<String, (String, Instant)>,
    /// Model calls in the last 24 h (strategic only; mission dialogue has its own).
    calls: std::collections::VecDeque<Instant>,
    seeded: bool,
    warned_at: Option<Instant>,
}
static SPEND: tokio::sync::Mutex<Spend> = tokio::sync::Mutex::const_new(Spend { last: std::collections::BTreeMap::new(), calls: std::collections::VecDeque::new(), seeded: false, warned_at: None });

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Why an agent is NOT asked this round, if it isn't.
fn skip_reason(spend: &mut Spend, actor: &str, fingerprint: &str, periodic: bool, now: Instant) -> Option<&'static str> {
    let day = Duration::from_secs(86_400);
    while spend.calls.front().is_some_and(|t| now.duration_since(*t) > day) {
        spend.calls.pop_front();
    }
    if spend.calls.len() as u64 >= env_u64("PLANNER_MAX_CALLS_PER_DAY", 800) {
        return Some("daily call cap reached");
    }
    if periodic {
        if let Some((fp, at)) = spend.last.get(actor) {
            if fp == fingerprint && now.duration_since(*at) < Duration::from_secs(env_u64("PLANNER_MAX_IDLE_SECS", 1800)) {
                return Some("situation unchanged");
            }
        }
    }
    None
}

async fn run_triggered(state: &AppState, planner: &Planner, trigger: &str, context: &[Value]) {
    let _round = ROUND_LOCK.lock().await;
    let periodic = context.is_empty();
    {
        // Count the last day's calls once, so a restart doesn't reset the cap.
        let mut spend = SPEND.lock().await;
        if !spend.seeded {
            let n: i64 = sqlx::query_scalar("SELECT count(*) FROM world_events WHERE kind = 'planner_call' AND created_at > now() - interval '24 hours'")
                .fetch_one(state.world.db()).await.unwrap_or(0);
            let now = Instant::now();
            spend.calls = (0..n.max(0)).map(|_| now).collect();
            spend.seeded = true;
        }
    }
    let agents: Vec<String> = state.world.read(|w| w.actors.keys().cloned().collect()).await;
    let mut skipped = Vec::new();
    for actor in agents {
        let (obs, system, tick) = state.world.read(|w| (observation(w, &actor), format!("{}\n{RULES}", character(w, &actor)), w.tick)).await;
        let fingerprint = situation_fingerprint(&obs);
        {
            let mut spend = SPEND.lock().await;
            let now = Instant::now();
            if let Some(why) = skip_reason(&mut spend, &actor, &fingerprint, periodic, now) {
                if why == "daily call cap reached" && spend.warned_at.is_none_or(|t| now.duration_since(t) > Duration::from_secs(600)) {
                    tracing::warn!("planner: PLANNER_MAX_CALLS_PER_DAY reached; agents run on their deterministic policies until the window frees up");
                    spend.warned_at = Some(now);
                }
                skipped.push(format!("{actor} ({why})"));
                continue;
            }
            spend.calls.push_back(now);
            spend.last.insert(actor.clone(), (fingerprint, now));
        }
        let user = format!("Review trigger: {trigger}\nRecent committed events (JSON): {}\nObservation (JSON):\n{obs}", json!(context));
        let digest = hex::encode(Sha256::digest(user.as_bytes()));
        let started = Instant::now();
        let out = planner.complete(&system, &user).await;
        let latency_ms = started.elapsed().as_millis() as u64;
        let db = state.world.db().clone();
        let (raw, usage, parsed) = match out {
            Ok((raw, usage)) => {
                let parsed = serde_json::from_str::<Proposal>(raw.trim().trim_start_matches("```json").trim_end_matches("```").trim()).map_err(|e| format!("not a valid plan: {e}"));
                (raw, usage, parsed)
            }
            Err(e) => (String::new(), Value::Null, Err(e)),
        };
        let proposal = match parsed {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("planner: {actor}: {e}; deterministic policy continues");
                let _ = log_event(&db, tick, &actor, "planner_call", &json!({ "model": planner.model, "trigger": trigger, "context": context, "ok": false, "error": e, "latency_ms": latency_ms, "observation_sha256": digest, "raw": raw.chars().take(2000).collect::<String>(), "fallback": "deterministic policy continues" })).await;
                continue;
            }
        };
        let near = state.near.clone();
        let model = planner.model.clone();
        let actor_c = actor.clone();
        let decision_trigger = trigger.to_string();
        let decision_context = context.to_vec();
        let summary = state
            .world
            .transact(async move |w, db| {
                let mut results = Vec::new();
                for p in proposal.actions.iter().take(3) {
                    let validated = validate(w, &actor_c, p);
                    let (validation, error, events, action) = match &validated {
                        Ok(None) => ("no_action", None, vec![], None),
                        Err(e) => ("rejected_by_policy", Some(e.clone()), vec![], None),
                        Ok(Some(act)) => match w.execute(&cz_economy::Caller::Agent(actor_c.clone()), act) {
                            Ok(ev) => {
                                if let Some(near) = &near {
                                    for e in &ev {
                                        if let cz_economy::Event::Traded(t) = e {
                                            if t.order.is_none() {
                                                super::settlement::queue_trade(w, &mut *db, near, t).await?;
                                            }
                                        }
                                    }
                                    super::settlement::queue_order_steps(w, &mut *db, near, &ev).await?;
                                }
                                ("accepted", None, summarize(&ev).into_iter().cloned().collect::<Vec<_>>(), Some(act.clone()))
                            }
                            Err(e) => ("rejected_by_engine", Some(e.to_string()), vec![], Some(act.clone())),
                        },
                    };
                    let payload = json!({
                        "planner": format!("llm:{model}"), "trigger": decision_trigger, "context": [], "event_context": decision_context, "proposed": { "type": p.kind, "resource": p.resource, "side": p.side, "qty": p.qty, "target": p.target, "amount": p.amount, "level": p.level, "convoy": p.convoy, "margin_bp": p.margin_bp },
                        "action": action, "rationale": p.rationale, "validation": validation, "error": error, "events": events,
                    });
                    log_event(&mut *db, w.tick, &actor_c, "agent_decision", &payload).await?;
                    results.push(json!({ "type": p.kind, "validation": validation, "error": payload["error"], "rationale": p.rationale, "action": payload["action"], "events": payload["events"] }));
                }
                if !proposal.broadcast.trim().is_empty() {
                    log_event(&mut *db, w.tick, &actor_c, "faction_broadcast", &json!({ "text": proposal.broadcast.chars().take(200).collect::<String>(), "model": model })).await?;
                }
                Ok(json!({ "assessment": proposal.assessment, "results": results }))
            })
            .await;
        let summary = summary.unwrap_or_else(|e| json!({ "error": e.to_string() }));
        let _ = log_event(&db, tick, &actor, "planner_call", &json!({ "model": planner.model, "trigger": trigger, "context": context, "ok": true, "latency_ms": latency_ms, "usage": usage, "observation_sha256": digest, "raw": raw.chars().take(2000).collect::<String>(), "outcome": summary })).await;
    }
    if !skipped.is_empty() {
        tracing::info!("planner: not asked this round: {}", skipped.join(", "));
    }
}

fn review_due(now: tokio::time::Instant, next_allowed: tokio::time::Instant, next_periodic: tokio::time::Instant, has_events: bool) -> bool {
    now >= next_allowed && (has_events || now >= next_periodic)
}

pub fn spawn(state: AppState) {
    let Some(planner) = Planner::from_env() else {
        tracing::info!("planner: NEAR_AI_API_KEY not set; agents run on their deterministic policies only");
        return;
    };
    let tick_secs = std::env::var("WORLD_TICK_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(60u64).max(1);
    let period = Duration::from_secs(tick_secs * planner.every_ticks);
    tracing::info!("planner: {} every {} tick(s) ({period:?})", planner.model, planner.every_ticks);
    let mut events = state.world.strategic_events();
    let cooldown = Duration::from_secs(std::env::var("PLANNER_COOLDOWN_SECS").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(120).max(1));
    tokio::spawn(async move {
        let mut pulse = tokio::time::interval(Duration::from_secs(2));
        pulse.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut next_periodic = tokio::time::Instant::now() + period;
        let mut next_allowed = tokio::time::Instant::now();
        let mut pending = Vec::new();
        loop {
            tokio::select! {
                event = events.recv() => match event {
                    Ok(event) => {
                        if pending.len() == 32 { pending.remove(0); }
                        pending.push(event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("planner: missed {n} notifications; requesting world review");
                        if pending.len() == 32 { pending.remove(0); }
                        pending.push(json!({ "trigger": "event_backlog", "missed": n }));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                _ = pulse.tick() => {
                    let now = tokio::time::Instant::now();
                    if review_due(now, next_allowed, next_periodic, !pending.is_empty()) {
                        let context = std::mem::take(&mut pending);
                        let trigger = if context.is_empty() { "periodic strategic review" } else { "response to committed world events" };
                        tracing::info!("planner: {trigger} ({} event(s))", context.len());
                        run_triggered(&state, &planner, trigger, &context).await;
                        let finished = tokio::time::Instant::now();
                        next_allowed = finished + cooldown;
                        next_periodic = finished + period;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fingerprint_ignores_the_clock_and_drift_but_not_a_real_change() {
        let mut w = cz_economy::genesis(1);
        let base = situation_fingerprint(&observation(&w, "vanguard"));
        let mut o = observation(&w, "vanguard");
        o["tick"] = json!(999);
        o["hour"] = json!(7);
        assert_eq!(situation_fingerprint(&o), base, "the clock is not a change");
        // A real shift in what the faction holds is.
        let ammo = w.balance("faction:vanguard", Asset::Res(Resource::Ammo));
        w.apply(&[cz_economy::Transfer { from: "faction:vanguard".into(), to: cz_economy::WORLD.into(), asset: Asset::Res(Resource::Ammo), qty: ammo / 2, reason: cz_economy::Reason::Consumption }]).unwrap();
        assert_ne!(situation_fingerprint(&observation(&w, "vanguard")), base, "losing half the ammunition is");
    }

    #[test]
    fn periodic_rounds_skip_unchanged_agents_events_never_do_and_the_cap_holds() {
        let mut sp = Spend { last: Default::default(), calls: Default::default(), seeded: true, warned_at: None };
        let now = Instant::now();
        assert_eq!(skip_reason(&mut sp, "vex", "a", true, now), None, "never asked: ask");
        sp.last.insert("vex".into(), ("a".into(), now));
        assert_eq!(skip_reason(&mut sp, "vex", "a", true, now), Some("situation unchanged"));
        assert_eq!(skip_reason(&mut sp, "vex", "b", true, now), None, "changed: ask");
        assert_eq!(skip_reason(&mut sp, "vex", "a", false, now), None, "an event always asks");
        let later = now + Duration::from_secs(1801);
        assert_eq!(skip_reason(&mut sp, "vex", "a", true, later), None, "idle too long: ask anyway");
        sp.calls = (0..800).map(|_| now).collect();
        assert_eq!(skip_reason(&mut sp, "vex", "b", false, now), Some("daily call cap reached"));
        assert_eq!(skip_reason(&mut sp, "vex", "b", false, now + Duration::from_secs(86_401)), None, "the window rolls");
    }

    #[test]
    fn a_living_world_changes_materially_far_less_often_than_every_round() {
        // Six in-game hours of an undisturbed world, a periodic round every 2 ticks:
        // count how many rounds would actually ask each agent.
        let mut w = cz_economy::genesis(7);
        let agents: Vec<String> = w.actors.keys().cloned().collect();
        let mut last: std::collections::BTreeMap<String, String> = Default::default();
        let (mut asked, mut rounds) = (0, 0);
        for t in 0..360 {
            w.tick();
            if t % 2 != 0 { continue }
            rounds += agents.len();
            for a in &agents {
                let fp = situation_fingerprint(&observation(&w, a));
                if last.get(a) != Some(&fp) { asked += 1; last.insert(a.clone(), fp); }
            }
        }
        eprintln!("material changes: {asked} of {rounds} periodic agent-rounds");
        assert!(asked * 4 < rounds, "a quiet world should ask under a quarter of the time: {asked} of {rounds}");
    }

    #[test]
    fn events_bypass_periodic_wait_but_respect_cooldown() {
        let now = tokio::time::Instant::now();
        let later = now + Duration::from_secs(120);
        assert!(review_due(now, now, later, true));
        assert!(!review_due(now, later, later, true));
        assert!(!review_due(now, now, later, false));
        assert!(review_due(later, later, later, false));
        assert!(!review_due(now, later, now, false));
    }

    fn prop(v: Value) -> Proposed {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn proposals_become_engine_commands_only_within_policy() {
        let w = cz_economy::genesis(1);
        // A sensible buy is accepted with the live quote as its limit.
        let ok = validate(&w, "vanguard", &prop(json!({ "type": "trade", "resource": "med", "side": "buy", "qty": 5, "rationale": "x" }))).unwrap().unwrap();
        assert!(matches!(ok, Action::Trade { qty: 5, .. }));
        // Spending past the reserve is refused before the engine sees it.
        let r = validate(&w, "vanguard", &prop(json!({ "type": "trade", "resource": "ammo", "side": "buy", "qty": 200, "rationale": "x" })));
        assert!(r.is_err(), "{r:?}");
        // Factions can't do merchant moves, and vice versa.
        assert!(validate(&w, "vanguard", &prop(json!({ "type": "set_margin", "margin_bp": 3000, "rationale": "x" }))).is_err());
        assert!(validate(&w, "vex", &prop(json!({ "type": "configure_defense", "level": 5, "rationale": "x" }))).is_err());
        // Bounties only on a rival faction, never on yourself or the merchant.
        assert!(validate(&w, "vanguard", &prop(json!({ "type": "post_bounty", "target": "vanguard", "resource": "fuel", "amount": 100, "rationale": "x" }))).is_err());
        assert!(validate(&w, "vanguard", &prop(json!({ "type": "post_bounty", "target": "vex", "resource": "fuel", "amount": 100, "rationale": "x" }))).is_err());
        assert!(validate(&w, "ashen", &prop(json!({ "type": "post_bounty", "target": "vanguard", "resource": "ammo", "amount": 100, "rationale": "x" }))).unwrap().is_some());
        // Out-of-range numbers and unknown moves.
        assert!(validate(&w, "vex", &prop(json!({ "type": "set_margin", "margin_bp": 90000, "rationale": "x" }))).is_err());
        assert!(validate(&w, "vanguard", &prop(json!({ "type": "mint_money", "rationale": "x" }))).is_err());
        assert!(validate(&w, "vanguard", &prop(json!({ "type": "none", "rationale": "quiet" }))).unwrap().is_none());
    }

    #[test]
    fn a_planner_supply_request_is_held_to_doctrine() {
        let w = cz_economy::genesis(1);
        let ok = validate(&w, "vanguard", &prop(json!({ "type": "request_supplies", "resource": "med", "side": "buy", "qty": 5, "limit_total": 250, "rationale": "medics are short" }))).unwrap().unwrap();
        assert!(matches!(ok, Action::PlaceOrder { qty: 5, limit_total: 250, allow_partial: true, .. }), "{ok:?}");
        // Over budget, over the price ceiling, selling below cost or more than held,
        // or a merchant placing an order: all refused before the engine sees them.
        for bad in [
            json!({ "type": "request_supplies", "resource": "ammo", "side": "buy", "qty": 200, "limit_total": 999_999, "rationale": "x" }),
            json!({ "type": "request_supplies", "resource": "med", "side": "buy", "qty": 5, "limit_total": 5 * 30 * 3, "rationale": "x" }),
            json!({ "type": "request_supplies", "resource": "fuel", "side": "sell", "qty": 10, "limit_total": 10, "rationale": "x" }),
            json!({ "type": "request_supplies", "resource": "fuel", "side": "sell", "qty": 200, "limit_total": 9_000, "rationale": "x" }),
            json!({ "type": "request_supplies", "resource": "med", "side": "buy", "qty": 5, "rationale": "no limit" }),
        ] {
            assert!(validate(&w, "vanguard", &prop(bad.clone())).is_err(), "{bad}");
        }
        assert!(validate(&w, "vex", &prop(json!({ "type": "request_supplies", "resource": "med", "side": "buy", "qty": 5, "limit_total": 250, "rationale": "x" }))).is_err());
        assert!(observation(&w, "vanguard")["merchants"].as_array().unwrap().len() >= 2, "the planner sees every merchant");
    }

    #[test]
    fn the_observation_carries_what_a_decision_needs() {
        let w = cz_economy::genesis(1);
        let o = observation(&w, "ashen");
        assert_eq!(o["you"]["id"], "ashen");
        assert!(o["factions"].as_array().unwrap().iter().any(|f| f["id"] == "vanguard"));
        assert_eq!(o["market"]["prices"].as_array().unwrap().len(), 3);
        assert!(o["routine_operations_this_tick"].is_array());
    }

    #[test]
    fn plans_parse_from_the_schema_shape() {
        let p: Proposal = serde_json::from_value(json!({ "assessment": "a", "broadcast": "b", "actions": [{ "type": "none", "rationale": "r" }] })).unwrap();
        assert_eq!(p.actions.len(), 1);
        assert_eq!(schema()["properties"]["actions"]["maxItems"], 3);
    }
}
