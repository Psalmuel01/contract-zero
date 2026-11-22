# Deploying CONTRACT ZERO: Neon + Railway + Netlify

**The three parts:**
- **Postgres** on Neon (any Postgres 15+ works; it ran on Supabase until Nov 2026);
- **the API** (Rust: economy, settlement worker, auth, NEAR) on Railway, from `apps/api/Dockerfile`;
- **the web app** (Next.js) on Netlify, from `apps/web`.

The contracts are already live on NEAR testnet (see NEAR.md), so nothing on chain changes here.

**No key or secret is ever committed or baked into an image.** The API reads its signing keys from one secret variable, `CZ_KEYS_JSON` (below).

## 1. Database (Neon)

1. Create a project in the region nearest the API. Railway runs the API in `europe-west4`, so use **AWS Frankfurt (eu-central-1)**.
2. Copy the **direct** connection string: the host without `-pooler`.
   - **Not the pooled one.** The API holds a session-level advisory lock as the single world writer, and a transaction pooler can't keep it.
   - On Supabase, the equivalent is the Session pooler (port 5432) or the direct connection, never the Transaction pooler (port 6543).
3. Keep `?sslmode=require`. The API runs every migration on boot (they're embedded in the binary).
4. **To keep the current world, move the existing database instead of starting fresh.** Use [DATABASE_MOVE.md](DATABASE_MOVE.md). It keeps the world's tick, ledger, orders, standings, accounts and settlement history.
   - A fresh database creates a new genesis world and realigns the actors' testnet balances to it on first boot. That works, but it erases the story so far.

**Free-plan budget.** Neon Free gives each project 1 GB of storage, 5 GB of network transfer and 100 CU-hours of compute a month. When transfer or compute runs out, the database is suspended until the next month.
- The database is about 0.25 GB.
- The API ticks every minute, so the database never scales to zero. 100 CU-hours is roughly 16 days at the smallest size; budget for that during judging.
- Each API restart reads the whole world ledger (about 130 MB at 88,000 entries). Avoid redeploying in a loop.

## 2. API (Railway)

```sh
railway login                        # interactive, once
cd apps/api
railway init                         # or: railway link to an existing project
railway variables --set "DATABASE_URL=postgresql://…:5432/postgres?sslmode=require" \
  --set "CZ_ENV=production" \
  --set "FRONTEND_ORIGIN=https://<your-netlify-domain>" \
  --set "AUTH_COOKIE_SECURE=1" \
  --set "WORLD_TICK_SECS=60" --set "AGENT_EVERY_TICKS=1" \
  --set "CZ_WORLD=world2.contract-zero.testnet" --set "CZ_ASSETS=assets.contract-zero.testnet" \
  --set "CZ_SERVER_ACCOUNT=server.contract-zero.testnet" \
  --set "CZ_VANGUARD_ACCOUNT=vanguard.contract-zero.testnet" --set "CZ_VEX_ACCOUNT=vex.contract-zero.testnet" \
  --set "CZ_RELAYER_ACCOUNT=cz-relayer-9abaff.testnet" \
  --set "NEAR_RPC_URL=https://rpc.testnet.fastnear.com" \
  --set "ADMIN_TOKEN=$(openssl rand -hex 24)"
# Every signing key, as one secret, without it ever touching the terminal:
railway variables --set "CZ_KEYS_JSON=$(node ../../scripts/keys-json.mjs)"
railway up                           # builds apps/api/Dockerfile, health-checks /health
```

**Signing keys.**
- `scripts/keys-json.mjs` collects the v3 actor keys, the server key and the relayer key.
- It refuses to print to a terminal.
- It copies only the account, public key and private key, so a wallet's seed phrase stays on your machine.
- At startup the API writes the keys to a private directory (0700, with files 0600) and removes the variable from its environment.

**Port.** The API binds `BIND_ADDR`, else Railway's `PORT`, else 8080.

**Optional variables:**
| Variable | Purpose |
|---|---|
| `NEAR_AI_API_KEY` | The strategic planner. The NEAR AI account needs credits, or every call returns 402 |
| `SENTRY_DSN` | Error reporting |
| `ONECLICK_API_KEY` | A 1Click partner key; without one, the adapter pays 1Click's +25 bps |

**Keep `NEAR_INTENTS_EXECUTION` unset in production.** The game never needs live swaps.

**One instance only.** The world has a single writer, enforced by an advisory lock. `numReplicas` is 1 in `railway.toml`, and a second instance would refuse to start.

## 3. Web (Netlify)

1. Create a site from the repository.
   - **Base directory:** `apps/web`.
   - **Build command:** `npm run build`.
   - Netlify detects Next.js and adds its runtime, so the `/api/*` rewrite in `next.config.ts` works.
2. Set these environment variables for production:
   - `NEXT_PUBLIC_API_URL=https://<railway-domain>`
   - `NEXT_PUBLIC_NEAR_NETWORK=testnet`
   - `NEXT_PUBLIC_NEAR_RPC=https://rpc.testnet.fastnear.com`
3. Deploy. The live site is <https://contractzero.netlify.app>.
4. Set `FRONTEND_ORIGIN` on Railway to the exact Netlify origin. It's comma-separated, so the old origin can stay during a move:
   ```
   https://contractzero.netlify.app,https://contract-zero.vercel.app
   ```
   In production, CORS and the CSRF origin check allow only these origins.
5. **Email sign-in (Privy):** the app ID comes from the API (`PRIVY_APP_ID` on Railway, served by `/auth/config`). Add the Netlify origin under the Privy app's allowed domains; Privy refuses logins from any domain not listed.

**Cookies stay first-party.** The browser calls `/api/*` on the Netlify origin, and Netlify forwards it to Railway. The session cookie belongs to the page's own site, so Brave and Safari don't block it.

**Don't set `NEXT_PUBLIC_CZ_DEV_HOOKS` in production.** Without it, the `/dev` routes and the test hooks are off.

**NEAR Auth (social sign-in).** NEAR's shared testnet login client accepts only `http://localhost:3000`. A deployed domain needs its own client from NEAR's dashboard; wallet sign-in works everywhere.

## 4. After the first deploy

1. **Health:** `GET /ready` returns `{"db":"up"}`. The startup log shows `migrations: applied N new`, and the settlement worker starts.
2. **Reconciliation:** `GET /reconciliation` returns `exact: true` once the queue drains. A fresh database aligns to the chain on boot (`settlement::bootstrap`).
3. **Smoke test:** run the probes against the deployed URLs, for example `node apps/web/probe-a11y.mjs https://<web> https://<api>` and `node scripts/supply-e2e.mjs https://<api>`.

## What was verified locally

| Check | Result |
|---|---|
| Production web build (`npm run build` in `apps/web`) | Builds; all routes prerender |
| API release build | Built with `cargo build` |
| The `CZ_KEYS_JSON` loader | Unit-tested: private file modes, mismatched or path-traversing entries refused |
| The container image | **Not verified here.** Docker's daemon wasn't running on this machine. The Dockerfile is a standard two-stage Rust build (rust:1-slim-bookworm → debian:bookworm-slim, with `libssl3` for TLS to Postgres) |
