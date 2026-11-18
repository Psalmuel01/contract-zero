// Enemy locomotion check: wakes Dustline's guards, samples every live guard's played
// clip against the gait its real motion calls for (enemyGait), and saves frames when a
// guard strafes. Prints the clip mix and any disagreement (expect 0).
//   node probe-gait.mjs <outDir>   (dev server on :3100)
import { chromium } from '@playwright/test'
const S = process.argv[2]
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []; p.on('pageerror', (e) => errors.push(e.message))
await p.addInitScript(() => { localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: 'high' })); localStorage.setItem('cz_welcome_seen', '1'); localStorage.setItem('cz_tips_seen', JSON.stringify(['controls','loot','heal','cargo','extract','consequence'])) })
await p.goto('http://localhost:3100/dev/level?site=dustline-depot&phase=day&kind=raid&defense=3&seed=4', { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => typeof window.__czWarp === 'function' && typeof window.__czGaits === 'function', null, { timeout: 180000 })
await p.evaluate(() => window.__czSkipBriefing())
await p.mouse.click(640, 360)
// step into the motor pool so the yard guards engage
await p.evaluate(() => { window.__czWarp(0, 3); window.__czLook(0, 0.02); for (const r of [0, 1, 2, 3]) window.__czWakeRoom?.(r) })
const counts = {}, mismatch = [], ais = {}, speeds = []
let shots = 0
for (let t = 0; t < 70; t++) {
  await p.waitForTimeout(250)
  const g = await p.evaluate(() => window.__czGaits())
  for (const e of g) if (e.alive) { ais[e.ai] = (ais[e.ai] ?? 0) + 1; if (e.speed > 0) speeds.push(e.speed) }
  for (const e of g) if (e.alive && e.clip) {
    counts[e.clip] = (counts[e.clip] ?? 0) + 1
    if (e.gait && e.gait.clip !== e.clip) mismatch.push(`${e.clip}≠${e.gait.clip}`)
  }
  if (shots < 3 && g.some((e) => e.alive && /strafe/.test(e.clip ?? ''))) { await p.screenshot({ path: `${S}/gait-strafe-${shots++}.jpg`, type: 'jpeg', quality: 85 }) }
}
console.log('ai states:', JSON.stringify(ais), 'nonzero speed samples:', speeds.length, 'max', Math.max(0, ...speeds)); console.log('player', JSON.stringify(await p.evaluate(() => window.__czMission?.()).then((m) => ({ alive: m?.alive, hp: m?.hp, obj: m?.objective })))); console.log('clip frames:', JSON.stringify(counts))
console.log('clip/gait disagreements:', mismatch.length, mismatch.slice(0, 5).join(' '))
console.log(errors.length ? errors.join('\n') : 'no page errors')
await b.close()
