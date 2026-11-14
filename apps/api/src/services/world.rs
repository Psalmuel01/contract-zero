//! The live economy: one `World` behind one lock.
//!
//! Every command runs under the lock, so commands are serialized and there are no
//! concurrent-order races to reason about. After each committed change the full
//! state is snapshotted to Postgres; if that write fails, the in-memory change is
//! rolled back so memory and the database never disagree.

use std::sync::Arc;

use cz_economy::{policy, Action, Caller, EconError, Event, World};
use cz_economy::policy::Decision;
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum WorldError {
    #[error(transparent)]
    Econ(#[from] EconError),
    #[error("storage: {0}")]
    Db(#[from] sqlx::Error),
    #[error("{0}")]
    Other(String),
}

#[derive(Clone)]
pub struct WorldService {
    world: Arc<Mutex<World>>,
    db: PgPool,
    strategic_events: tokio::sync::broadcast::Sender<Value>,
    /// NEAR settlement, when configured. `None` keeps the economy fully off-chain.
    near: Option<Arc<super::near::NearClient>>,
}

/// Mirror issuance/destruction on chain every this many ticks (and always before a
/// trade or raid settles).
const FLOW_SYNC_TICKS: u64 = 12;

/// Snapshots kept per world; older ones are pruned.
const KEEP_SNAPSHOTS: i64 = 500;

impl WorldService {
    /// Load the latest snapshot, or create the genesis world from `WORLD_SEED`.
    pub async fn load(db: PgPool, near: Option<Arc<super::near::NearClient>>) -> anyhow::Result<Self> {
        let latest: Option<(Value, Option<i64>)> =
            sqlx::query_as("SELECT state, ledger_len FROM world_snapshots ORDER BY id DESC LIMIT 1").fetch_optional(&db).await?;
        let world = match latest {
            Some((state, ledger_len)) => {
                let mut w: World = serde_json::from_value(state)?;
                match ledger_len {
                    // Current format: the snapshot holds the ledger's tail; the rest is in world_ledger.
                    Some(n) => w.ledger = load_ledger(&db, n, &w.ledger).await?,
                    // Old format (ledger inline): copy it into world_ledger once, before serving.
                    None => backfill_ledger(&db, &w).await?,
                }
                w
            }
            None => {
                // WORLD_SCENARIO=acceptance starts from the end-to-end acceptance state.
                let scenario = std::env::var("WORLD_SCENARIO").unwrap_or_default();
                let w = if scenario == "acceptance" {
                    cz_economy::acceptance()
                } else {
                    cz_economy::genesis(std::env::var("WORLD_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(2026))
                };
                let mut w = w;
                persist(&mut *db.acquire().await?, &mut w).await?;
                tracing::info!("world: created {} world (seed {})", if scenario == "acceptance" { "acceptance" } else { "genesis" }, w.seed);
                w
            }
        };
        // A live world that predates the Ashen Compact gains it, provided settlement
        // (when on) can sign for it; its starting stock is genesis issuance and is
        // mirrored on chain by the next flow sync.
        let mut world: World = world;
        let can_sign = near.as_ref().is_none_or(|n| n.actor_account("ashen").is_some());
        if world.market.living && can_sign && cz_economy::add_rival(&mut world) {
            persist(&mut *db.acquire().await?, &mut world).await?;
            tracing::info!("world: the Ashen Compact joined at tick {}", world.tick);
        }
        // Likewise the second merchant, Halcyon Logistics.
        let can_sign = near.as_ref().is_none_or(|n| n.actor_account("halcyon").is_some());
        if world.market.living && can_sign && cz_economy::add_halcyon(&mut world) {
            persist(&mut *db.acquire().await?, &mut world).await?;
            tracing::info!("world: Halcyon Logistics joined at tick {}", world.tick);
        }
        tracing::info!("world: loaded at tick {} (version {})", world.tick, world.version);
        Ok(Self { world: Arc::new(Mutex::new(world)), db, near, strategic_events: tokio::sync::broadcast::channel(256).0 })
    }

    pub fn strategic_events(&self) -> tokio::sync::broadcast::Receiver<Value> {
        self.strategic_events.subscribe()
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    pub fn near(&self) -> Option<Arc<super::near::NearClient>> {
        self.near.clone()
    }

    /// Run a read-only view of the world.
    pub async fn read<T>(&self, f: impl FnOnce(&World) -> T) -> T {
        f(&*self.world.lock().await)
    }

    /// Run `f` against the world under the lock, then persist. On any error the world
    /// is restored to its state before `f`.
    /// Run `f` against the world and the database as ONE unit. Every row `f` writes
    /// (events, sessions, settlements) and the new world snapshot go into a single
    /// PostgreSQL transaction, committed only if `f` and the snapshot both succeed.
    /// On any error the transaction rolls back AND the in-memory world is restored,
    /// so neither side ever keeps half of an action.
    ///
    /// `f` must not call the chain: a NEAR transaction can't be rolled back. Chain
    /// calls happen outside (the settlement worker, the exchange's quote flow).
    pub async fn transact<T, F>(&self, f: F) -> Result<T, WorldError>
    where
        F: AsyncFnOnce(&mut World, &mut PgConnection) -> Result<T, WorldError>,
    {
        // The connection first, THEN the world: waiting on a busy pool while holding the
        // world lock froze every world read behind it (/world, /board into 502s).
        let mut tx = self.db.begin().await?;
        let mut w = self.world.lock().await;
        let before = w.clone();
        let result = async {
            let out = f(&mut w, &mut tx).await?;
            if w.version != before.version {
                persist(&mut tx, &mut w).await?;
            }
            Ok::<T, WorldError>(out)
        }
        .await;
        match result {
            Ok(out) => match tx.commit().await {
                Ok(()) => {
                    // Notifications follow the commit, so rolled-back outcomes never trigger AI.
                    for event in strategic_changes(&before, &w) {
                        let _ = self.strategic_events.send(event);
                    }
                    Ok(out)
                },
                Err(e) => {
                    *w = before;
                    Err(e.into())
                }
            },
            Err(e) => {
                *w = before;
                let _ = tx.rollback().await;
                Err(e)
            }
        }
    }

    /// Execute one command as `caller` and log it.
    pub async fn execute(&self, caller: Caller, action: Action, source: &str) -> Result<Vec<Event>, WorldError> {
        let source = source.to_string();
        self.transact(async move |w, db| {
            let ev = w.execute(&caller, &action)?;
            log_event(&mut *db, w.tick, &source, "economy", &json!({ "action": action, "events": summarize(&ev) })).await?;
            Ok(ev)
        })
        .await
    }

    /// Advance `ticks` ticks, running the agents every `agents_every` ticks. Returns a
    /// summary of what happened. Used by the scheduler and by fast-forward.
    pub async fn advance(&self, ticks: u64, agents_every: u64) -> Result<Value, WorldError> {
        let near = self.near.clone();
        self.transact(async move |w, db| {
            let mut shortages = 0usize;
            let mut decisions = 0usize;
            let mut notable = Vec::new();
            for _ in 0..ticks {
                record_history(w, &mut *db).await?;
                let tick_events = w.tick();
                if let Some(near) = &near {
                    super::settlement::queue_order_steps(w, &mut *db, near, &tick_events).await?;
                }
                for e in tick_events {
                    match e {
                        Event::Shortage { .. } => shortages += 1,
                        Event::Transfer(_) => {}
                        other => notable.push(other),
                    }
                }
                if agents_every > 0 && w.tick % agents_every == 0 {
                    for (decision, result) in policy::run_fallback_agents(w) {
                        decisions += 1;
                        log_decision(&mut *db, w.tick, "fallback", &decision, result.as_ref()).await?;
                        // An accepted trade with the merchant (a purchase or a sale)
                        // settles on NEAR.
                        if let (Some(near), Some(Ok(events))) = (&near, &result) {
                            for e in events {
                                if let Event::Traded(t) = e {
                                    // Order fills settle as order steps, not instant trades.
                                    if t.order.is_none() {
                                        super::settlement::queue_trade(w, &mut *db, near, t).await?;
                                    }
                                }
                            }
                            super::settlement::queue_order_steps(w, &mut *db, near, events).await?;
                        }
                    }
                }
            }
            if let Some(near) = &near {
                if w.tick % FLOW_SYNC_TICKS == 0 {
                    super::settlement::sync_flows(w, &mut *db, near).await?;
                }
            }
            for e in &notable {
                log_event(&mut *db, w.tick, "system", "economy", &json!({ "event": e })).await?;
            }
            Ok(json!({ "ticks": ticks, "tick": w.tick, "decisions": decisions, "shortages": shortages, "events": notable.len() }))
        })
        .await
    }
}

fn strategic_changes(before: &World, after: &World) -> Vec<Value> {
    let mut events = Vec::new();
                    for (id, raid) in &after.raids {
                        if matches!(raid.status, cz_economy::RaidStatus::Extracted { .. })
                            && before.raids.get(id).is_none_or(|old| old.status != raid.status) {
                            events.push(json!({ "trigger": "mission_completed", "raid": id, "target": raid.plan.target, "kind": raid.plan.kind.name(), "resource": raid.plan.resource.name(), "status": raid.status }));
                        }
                    }
                    for (id, convoy) in &after.convoys {
                        if matches!(convoy.status, cz_economy::ConvoyStatus::Seized { .. })
                            && before.convoys.get(id).is_none_or(|old| old.status != convoy.status) {
                            events.push(json!({ "trigger": "convoy_seized", "convoy": convoy }));
                        }
                    }
    events
}

/// Ledger entries a snapshot keeps inline: checked against world_ledger on load.
const LEDGER_TAIL: usize = 64;

/// Save the world: append the ledger entries world_ledger doesn't have yet, then insert a
/// snapshot of everything else (the ledger's length and last LEDGER_TAIL entries only).
/// Both go into the caller's transaction, so they commit or roll back together.
async fn persist(db: &mut PgConnection, w: &mut World) -> Result<(), sqlx::Error> {
    let len = w.ledger.len();
    let (have,): (Option<i64>,) = sqlx::query_as("SELECT max(seq) FROM world_ledger").fetch_one(&mut *db).await?;
    let from = have.map_or(0, |s| (s + 1).max(0) as usize).min(len);
    if from < len {
        append_ledger(&mut *db, &w.ledger[from..]).await?;
    }
    // Serialize the world with only the ledger's tail, then put the full ledger back.
    let full = std::mem::take(&mut w.ledger);
    w.ledger = full[len.saturating_sub(LEDGER_TAIL)..].to_vec();
    let state = serde_json::to_value(&*w).expect("world serializes");
    w.ledger = full;
    sqlx::query("INSERT INTO world_snapshots (tick, version, state, ledger_len) VALUES ($1, $2, $3, $4)")
        .bind(w.tick as i64)
        .bind(w.version as i64)
        .bind(state)
        .bind(len as i64)
        .execute(&mut *db)
        .await?;
    // Prune only current-format snapshots (small). Old-format ones (each carrying the whole
    // ledger, ~1 MB stored) are left as a static archive: deleting them one per tick cost
    // ~2.8 MB of WAL each, as much as the old design. They cost disk space, not I/O.
    sqlx::query("DELETE FROM world_snapshots WHERE ledger_len IS NOT NULL AND id <= (SELECT max(id) FROM world_snapshots) - $1")
        .bind(KEEP_SNAPSHOTS)
        .execute(&mut *db)
        .await?;
    Ok(())
}

/// Insert ledger entries (one statement). An existing row at the same seq is replaced:
/// after a manual restore to an older snapshot, the restored timeline's entries win.
async fn append_ledger(db: &mut PgConnection, entries: &[cz_economy::LedgerEntry]) -> Result<(), sqlx::Error> {
    let rows = serde_json::to_value(entries).expect("ledger serializes");
    sqlx::query(
        "INSERT INTO world_ledger (seq, tick, entry) SELECT (e->>'seq')::bigint, (e->>'tick')::bigint, e FROM jsonb_array_elements($1) AS e \
         ON CONFLICT (seq) DO UPDATE SET tick = excluded.tick, entry = excluded.entry",
    )
    .bind(rows)
    .execute(&mut *db)
    .await?;
    Ok(())
}

/// Reassemble the ledger for a snapshot of length `len`, and refuse a ledger that doesn't
/// match it exactly: every seq 0..len present in order, and the last entries equal to the
/// ones the snapshot kept. A world with a damaged ledger would mis-settle on chain.
async fn load_ledger(db: &PgPool, len: i64, tail: &[cz_economy::LedgerEntry]) -> anyhow::Result<Vec<cz_economy::LedgerEntry>> {
    let rows: Vec<(Value,)> = sqlx::query_as("SELECT entry FROM world_ledger WHERE seq < $1 ORDER BY seq").bind(len).fetch_all(db).await?;
    if rows.len() as i64 != len {
        anyhow::bail!("world ledger: the snapshot has {len} entries, world_ledger has {}; refusing to start", rows.len());
    }
    let ledger: Vec<cz_economy::LedgerEntry> = rows.into_iter().map(|(v,)| serde_json::from_value(v)).collect::<Result<_, _>>()?;
    if let Some(bad) = ledger.iter().enumerate().find(|(i, e)| e.seq != *i as u64) {
        anyhow::bail!("world ledger: entry {} has seq {}; refusing to start", bad.0, bad.1.seq);
    }
    if !tail.is_empty() && ledger[ledger.len() - tail.len()..] != *tail {
        anyhow::bail!("world ledger: its last {} entries differ from the snapshot's; refusing to start", tail.len());
    }
    tracing::info!("world ledger: {} entries loaded and checked", ledger.len());
    Ok(ledger)
}

/// One-time move of an old-format snapshot's inline ledger into world_ledger (idempotent).
async fn backfill_ledger(db: &PgPool, w: &World) -> anyhow::Result<()> {
    let mut tx = db.begin().await?;
    for chunk in w.ledger.chunks(5_000) {
        append_ledger(&mut tx, chunk).await?;
    }
    tx.commit().await?;
    tracing::info!("world ledger: {} entries copied from the old-format snapshot", w.ledger.len());
    Ok(())
}

pub async fn log_event<'e, E: sqlx::PgExecutor<'e>>(db: E, tick: u64, source: &str, kind: &str, payload: &Value) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO world_events (tick, source, kind, payload) VALUES ($1, $2, $3, $4)")
        .bind(tick as i64)
        .bind(source)
        .bind(kind)
        .bind(payload)
        .execute(db)
        .await?;
    Ok(())
}

/// Record an agent decision with its validation and execution result: the War Room's
/// causal record. `planner` is "llm" or "fallback".
pub async fn log_decision<'e, E: sqlx::PgExecutor<'e>>(
    db: E,
    tick: u64,
    planner: &str,
    d: &Decision,
    result: Option<&Result<Vec<Event>, EconError>>,
) -> Result<(), sqlx::Error> {
    let (validation, error, events) = match result {
        None => ("no_action", None, vec![]),
        Some(Ok(ev)) => ("accepted", None, summarize(ev)),
        Some(Err(e)) => ("rejected", Some(e.to_string()), vec![]),
    };
    let payload = json!({
        "planner": planner,
        "trigger": d.trigger,
        "context": d.context,
        "action": d.action,
        "rationale": d.rationale,
        "validation": validation,
        "error": error,
        "events": events,
    });
    log_event(db, tick, &d.actor, "agent_decision", &payload).await
}

/// Domain events only; individual ledger transfers stay in the snapshot's ledger.
pub fn summarize(ev: &[Event]) -> Vec<&Event> {
    ev.iter().filter(|e| !matches!(e, Event::Transfer(_))).collect()
}

/// Prices and holdings at this tick, for the War Room's history.
async fn record_history(w: &World, db: &mut PgConnection) -> Result<(), sqlx::Error> {
    let prices: serde_json::Map<String, Value> = cz_economy::Resource::ALL.iter().map(|&r| { let p = w.price(r); (r.name().to_string(), json!({ "ask": p.ask, "bid": p.bid, "stock": w.merchant_stock(r) })) }).collect();
    let holdings: serde_json::Map<String, Value> = w.actors.values().map(|a| (a.id.clone(), json!({
        "credits": w.balance(&a.account, cz_economy::Asset::Credits),
        "ammo": w.balance(&a.account, cz_economy::Asset::Res(cz_economy::Resource::Ammo)),
        "med": w.balance(&a.account, cz_economy::Asset::Res(cz_economy::Resource::Med)),
        "fuel": w.balance(&a.account, cz_economy::Asset::Res(cz_economy::Resource::Fuel)),
        "defense": a.defense,
    }))).collect();
    sqlx::query("INSERT INTO market_history (tick, prices, holdings) VALUES ($1, $2, $3) ON CONFLICT (tick) DO NOTHING")
        .bind(w.tick as i64).bind(Value::Object(prices)).bind(Value::Object(holdings)).execute(&mut *db).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategic_events_require_new_successful_outcomes() {
        let mut w = cz_economy::acceptance();
        w.execute(&Caller::Player("tester.testnet".into()), &Action::StartRaid { target: "vanguard".into(), resource: cz_economy::Resource::Ammo }).unwrap();
        let before = w.clone();
        assert!(strategic_changes(&before, &w).is_empty(), "starting a mission is not a completed outcome");
        let raid = w.raids.values_mut().next_back().unwrap();
        raid.status = cz_economy::RaidStatus::Extracted { units: 10, bounty: 0 };
        let events = strategic_changes(&before, &w);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["trigger"], "mission_completed");
        assert_eq!(events[0]["target"], "vanguard");
        assert!(strategic_changes(&w, &w).is_empty(), "unchanged outcomes must not retrigger");
        let before = w.clone();
        w.convoys.insert(999, cz_economy::Convoy { id: 999, owner: "vex".into(), resource: cz_economy::Resource::Ammo, units: 5, defense: 1, dispatched_at: 0, arrives_at: 10, status: cz_economy::ConvoyStatus::InTransit });
        assert!(strategic_changes(&before, &w).is_empty());
        let before = w.clone();
        w.convoys.get_mut(&999).unwrap().status = cz_economy::ConvoyStatus::Seized { by: "ashen".into() };
        assert_eq!(strategic_changes(&before, &w)[0]["trigger"], "convoy_seized");
    }

    /// A failed action leaves nothing behind: not the rows it wrote, not the world change.
    /// Needs CZ_DB_TESTS=1 and DATABASE_URL (it reads the dev world but writes nothing
    /// that survives).
    #[tokio::test]
    async fn a_failed_transaction_rolls_back_the_database_and_the_world() {
        if std::env::var("CZ_DB_TESTS").as_deref() != Ok("1") {
            return;
        }
        dotenvy::dotenv().ok();
        let db = PgPool::connect(&std::env::var("DATABASE_URL").unwrap()).await.unwrap();
        let svc = WorldService { world: Arc::new(Mutex::new(cz_economy::acceptance())), db: db.clone(), near: None, strategic_events: tokio::sync::broadcast::channel(256).0 };
        let tag = format!("test-atomic-{}", uuid::Uuid::new_v4());
        let before = svc.read(|w| w.version).await;
        let t = tag.clone();
        let r: Result<(), WorldError> = svc
            .transact(async move |w, db| {
                log_event(&mut *db, w.tick, &t, "test", &json!({ "step": 1 })).await?;
                w.version += 1; // a change in memory
                Err(WorldError::Other("fails after writing".into()))
            })
            .await;
        assert!(r.is_err());
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM world_events WHERE source = $1").bind(&tag).fetch_one(&db).await.unwrap();
        assert_eq!(n, 0, "the event written before the failure was rolled back");
        assert_eq!(svc.read(|w| w.version).await, before, "the world was restored");
        // And a successful one commits.
        let t = tag.clone();
        svc.transact(async move |w, db| { log_event(&mut *db, w.tick, &t, "test", &json!({})).await?; Ok(()) }).await.unwrap();
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM world_events WHERE source = $1").bind(&tag).fetch_one(&db).await.unwrap();
        assert_eq!(n, 1);
        sqlx::query("DELETE FROM world_events WHERE source = $1").bind(&tag).execute(&db).await.unwrap();
    }

    /// The ledger lives in world_ledger: a saved world reloads identically, an old-format
    /// snapshot migrates once, a damaged ledger refuses to load, and a rolled-back save
    /// leaves no ledger rows. Needs CZ_DB_TESTS=1 and CZ_LEDGER_TEST_DB: a SCRATCH database
    /// URL (the test empties its world tables).
    #[tokio::test]
    async fn the_ledger_table_round_trips_migrates_and_refuses_damage() {
        if std::env::var("CZ_DB_TESTS").as_deref() != Ok("1") {
            return;
        }
        let url = std::env::var("CZ_LEDGER_TEST_DB").expect("CZ_LEDGER_TEST_DB: a scratch database");
        assert!(!url.contains("supabase"), "never against production");
        let db = PgPool::connect(&url).await.unwrap();
        crate::migrate::run(&db).await.unwrap();
        let reset = || async { sqlx::query("TRUNCATE world_snapshots, world_ledger").execute(&db).await.unwrap(); };

        // 1. a saved world reloads identically, ledger included
        reset().await;
        let mut w = cz_economy::acceptance();
        while w.ledger.len() <= LEDGER_TAIL * 3 { w.tick(); }
        assert!(w.ledger.len() > LEDGER_TAIL, "the test world has a real ledger ({})", w.ledger.len());
        persist(&mut *db.acquire().await.unwrap(), &mut w).await.unwrap();
        let loaded = WorldService::load(db.clone(), None).await.unwrap();
        let back = loaded.read(|x| x.clone()).await;
        assert_eq!(back.ledger, w.ledger);
        assert_eq!(serde_json::to_value(&back).unwrap(), serde_json::to_value(&w).unwrap(), "the whole world round-trips");
        let (stored_len,): (i64,) = sqlx::query_as("SELECT jsonb_array_length(state->'ledger')::bigint FROM world_snapshots ORDER BY id DESC LIMIT 1").fetch_one(&db).await.unwrap();
        assert_eq!(stored_len as usize, LEDGER_TAIL, "the snapshot keeps only the tail");

        // a later save appends only the new entries
        let mut w2 = back;
        let before = w2.ledger.len();
        w2.tick();
        persist(&mut *db.acquire().await.unwrap(), &mut w2).await.unwrap();
        let (rows,): (i64,) = sqlx::query_as("SELECT count(*) FROM world_ledger").fetch_one(&db).await.unwrap();
        assert_eq!(rows as usize, w2.ledger.len());
        assert!(w2.ledger.len() >= before);

        // 2. an old-format snapshot (ledger inline, no ledger_len) loads and backfills once
        reset().await;
        sqlx::query("INSERT INTO world_snapshots (tick, version, state) VALUES ($1, $2, $3)")
            .bind(w.tick as i64).bind(w.version as i64).bind(serde_json::to_value(&w).unwrap()).execute(&db).await.unwrap();
        let loaded = WorldService::load(db.clone(), None).await.unwrap();
        assert_eq!(loaded.read(|x| x.ledger.clone()).await, w.ledger);
        let (rows,): (i64,) = sqlx::query_as("SELECT count(*) FROM world_ledger").fetch_one(&db).await.unwrap();
        assert_eq!(rows as usize, w.ledger.len(), "backfilled");
        loaded.transact(async move |x, _| { x.version += 1; Ok(()) }).await.unwrap();
        let (len,): (Option<i64>,) = sqlx::query_as("SELECT ledger_len FROM world_snapshots ORDER BY id DESC LIMIT 1").fetch_one(&db).await.unwrap();
        assert_eq!(len, Some(w.ledger.len() as i64), "the next save is the new format");
        assert_eq!(WorldService::load(db.clone(), None).await.unwrap().read(|x| x.ledger.clone()).await, w.ledger);

        // 3. damage refuses to load: a missing entry, then an altered one
        sqlx::query("DELETE FROM world_ledger WHERE seq = 3").execute(&db).await.unwrap();
        assert!(WorldService::load(db.clone(), None).await.is_err(), "a missing entry");
        let e3 = serde_json::to_value(&w.ledger[3]).unwrap();
        sqlx::query("INSERT INTO world_ledger (seq, tick, entry) VALUES (3, $1, $2)").bind(w.ledger[3].tick as i64).bind(e3).execute(&db).await.unwrap();
        assert!(WorldService::load(db.clone(), None).await.is_ok(), "repaired");
        let last = (w.ledger.len() - 1) as i64;
        sqlx::query("UPDATE world_ledger SET entry = jsonb_set(entry, '{qty}', to_jsonb((entry->>'qty')::bigint + 1)) WHERE seq = $1").bind(last).execute(&db).await.unwrap();
        assert!(WorldService::load(db.clone(), None).await.is_err(), "an altered entry");

        // 4. a rolled-back save leaves no ledger rows
        reset().await;
        let mut w3 = cz_economy::acceptance();
        persist(&mut *db.acquire().await.unwrap(), &mut w3).await.unwrap();
        let svc = WorldService::load(db.clone(), None).await.unwrap();
        let n0 = svc.read(|x| x.ledger.len()).await;
        let r: Result<(), WorldError> = svc.transact(async move |x, _| { x.tick(); Err(WorldError::Other("fails".into())) }).await;
        assert!(r.is_err());
        let (rows,): (i64,) = sqlx::query_as("SELECT count(*) FROM world_ledger").fetch_one(&db).await.unwrap();
        assert_eq!(rows as usize, n0, "no rows from the rolled-back tick");
        assert_eq!(svc.read(|x| x.ledger.len()).await, n0);
    }

}
