// Reliability regression tests for the API's locking, against a RUNNING off-chain API on
// a SCRATCH database (never production: it starts missions, holds row locks and kills
// connections). Needs Node 20+ and psql.
//
//   API=http://127.0.0.1:8099 DATABASE_URL=postgres://…/scratch node scripts/reliability.mjs [concurrency,locks,recovery]
//
// Start the API for it with AUTH_DEV_LOGIN=1, CZ_WORLD unset, BIND_ADDR matching API.
// `recovery` ends by killing the API's lock connection: the API should then EXIT (70).
import { spawn, spawnSync } from 'node:child_process'

const API = process.env.API ?? 'http://127.0.0.1:8099'
const DB = process.env.DATABASE_URL
const PSQL = process.env.PSQL ?? 'psql'
const only = (process.argv[2] ?? 'concurrency,locks,recovery').split(',')
if (!DB) { console.error('DATABASE_URL (the scratch database) is required'); process.exit(2) }

const H = { 'content-type': 'application/json', origin: 'http://localhost:3000' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'TIMEOUT')])
const sql = (q) => spawnSync(PSQL, [DB, '-At', '-c', q], { encoding: 'utf8' }).stdout.trim()
let failures = 0
const check = (ok, what, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }

async function timed(path, ms = 3000) {
  const t = Date.now()
  const r = await within(fetch(`${API}${path}`).then((x) => x.status).catch((e) => `ERR ${e.cause?.code ?? e.message}`), ms)
  return { status: r, ms: Date.now() - t }
}
async function responsive(label, ms = 3000) {
  for (const p of ['/health', '/world', '/board']) {
    const r = await timed(p, ms)
    check(r.status === 200, `${label}: ${p} answers`, `${r.status} in ${r.ms} ms`)
  }
}
async function player(tag) {
  const r = await fetch(`${API}/auth/dev`, { method: 'POST', headers: H, body: JSON.stringify({ account_id: `rel${tag}${Date.now() % 1e6}.testnet` }) })
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { ...H, cookie }
}
async function startMission(h, target) {
  for (let i = 0; i < 6; i++) {
    const s = await (await fetch(`${API}/missions/start`, { method: 'POST', headers: h, body: JSON.stringify({ target, resource: 'ammo', kind: 'raid' }) })).json()
    if (s.session) return s.session
    await sleep(3000) // per-IP deployment limiter
  }
  throw new Error('could not start a mission')
}
const events = (h, s) => fetch(`${API}/missions/${s}/events`, { method: 'POST', headers: h, body: JSON.stringify({ events: [] }) }).then((r) => r.status)
const complete = (h, s, outcome) => fetch(`${API}/missions/${s}/complete`, { method: 'POST', headers: h, body: JSON.stringify({ outcome, kills: 0 }) }).then((r) => r.status)

if (only.includes('concurrency')) {
  console.log('\n# events, extraction and death arriving together')
  for (const [n, outcome] of [[6, 'killed'], [6, 'extracted']]) {
    for (let t = 0; t < n; t++) {
      const h = await player(t)
      const s = await startMission(h, t % 2 ? 'ashen' : 'vanguard')
      const reqs = [events(h, s), events(h, s), complete(h, s, outcome), events(h, s), events(h, s)]
      const res = await within(Promise.all(reqs), 15000)
      check(res !== 'TIMEOUT', `${outcome} trial ${t + 1}: every request returned`, res === 'TIMEOUT' ? 'hung' : res.join(','))
      if (res === 'TIMEOUT') break
    }
  }
  console.log('\n# two players finishing at the same moment')
  const [a, b] = [await player('a'), await player('b')]
  const [sa, sb] = [await startMission(a, 'vanguard'), await startMission(b, 'ashen')]
  const both = await within(Promise.all([events(a, sa), complete(a, sa, 'killed'), events(b, sb), complete(b, sb, 'extracted'), events(a, sa), events(b, sb)]), 15000)
  check(both !== 'TIMEOUT', 'two players: every request returned', both === 'TIMEOUT' ? 'hung' : both.join(','))
  await responsive('after concurrency')
}

if (only.includes('locks')) {
  console.log('\n# a mission row held by another transaction: bounded wait, clean rollback')
  const h = await player('lock')
  const s = await startMission(h, 'vanguard')
  // Hold the session's row for 25 s from outside the API.
  const holder = spawn(PSQL, [DB, '-q', '-c', `BEGIN; SELECT 1 FROM mission_sessions WHERE id = '${s}' FOR UPDATE; SELECT pg_sleep(25); COMMIT;`], { stdio: 'ignore' })
  await sleep(1500)
  const t = Date.now()
  const st = await within(complete(h, s, 'killed'), 20000)
  const took = Date.now() - t
  check(st !== 'TIMEOUT' && st >= 400, 'completion behind a held row fails instead of waiting forever', `${st} after ${took} ms`)
  check(took < 13000, 'it gave up within the 10 s lock timeout', `${took} ms`)
  const ev = await within(events(h, s), 20000)
  check(ev !== 'TIMEOUT', 'an event batch behind the held row also returns', `${ev}`)
  check(sql(`SELECT completed_at IS NULL FROM mission_sessions WHERE id = '${s}'`) === 't', 'the failed completion left the session untouched (rolled back)')
  await responsive('while the row is still held')
  holder.kill()
  await sleep(1000)
  const done = await within(complete(h, s, 'killed'), 15000)
  check(done !== 'TIMEOUT', 'once released, the same completion goes through', `${done}`)
}

if (only.includes('recovery')) {
  console.log('\n# database connections dropped under the API')
  const killed = sql(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = pg_stat_activity.pid AND l.locktype = 'advisory')`)
  console.log(`  terminated ${killed} pool connection(s)`)
  await sleep(1500)
  await responsive('after the pool lost its connections', 8000)
  const h = await player('rec')
  const s = await startMission(h, 'vanguard').catch(() => null)
  check(!!s, 'a mission can start after the pool reconnects')

  console.log('\n# the connection holding the world lock dropped')
  const k = sql(`SELECT count(pg_terminate_backend(l.pid)) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid <> pg_backend_pid()`)
  console.log(`  terminated ${k} lock connection(s); the API should exit within ~20 s`)
  let gone = false
  for (let i = 0; i < 30 && !gone; i++) { await sleep(1000); gone = (await timed('/health', 1500)).status !== 200 }
  check(gone, 'the API stopped instead of running without the world lock')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
