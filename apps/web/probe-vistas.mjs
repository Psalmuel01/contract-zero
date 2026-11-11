// Fixed-viewpoint captures of the three sites, so an environment change can be
// compared like for like. Hides the HUD (art only) unless HUD=1.
//   node probe-vistas.mjs [outDir] [site,...] [phase,...]
// Viewpoints come from each level's own named points, so they track the layout.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'vistas-out'
const sites = (process.argv[3] ?? 'dustline-depot,blacksite,cinder-yard').split(',')
const phases = (process.argv[4] ?? 'day,night').split(',')
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 720)
mkdirSync(out, { recursive: true })

// [name, point, yaw, pitch]; yaw 0 looks toward -z (into the site).
const VIEWS = [
  ['start', 'start', 0, 0.02],
  ['entry-back', 'entry', Math.PI, 0.04],
  ['push', 'push', 0, 0.02],
  ['cargo-side', 'cargo', Math.PI / 2, 0.03],
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const errors = []
for (const site of sites) for (const phase of phases) {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  page.on('pageerror', (e) => errors.push(`${site}/${phase}: ${e.message}`))
  await page.addInitScript((q) => {
    // A fixed tier, so Auto stepping down under software rendering can't change the look mid-capture.
    localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: q }))
    localStorage.setItem('cz_welcome_seen', '1')
    localStorage.setItem('cz_tips_seen', JSON.stringify(['controls', 'loot', 'heal', 'cargo', 'extract', 'consequence']))
  }, process.env.QUALITY ?? 'high')
  await page.goto(`${BASE}/dev/level?site=${site}&phase=${phase}&kind=raid&defense=2`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__czWarp === 'function', null, { timeout: 180000 })
  await page.evaluate(() => { window.__czSkipBriefing(); window.__czKillAll?.() })
  if (!process.env.HUD) await page.addStyleTag({ content: 'body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}' })
  const pts = await page.evaluate(() => {
    const o = window.__czObjectives?.() ?? []
    const p = window.__czPlayer()
    return { start: [p.x, p.z], objectives: o.map((x) => x.pos).filter(Boolean) }
  })
  const named = { start: pts.start, entry: pts.objectives[0] ?? pts.start, push: pts.objectives[2] ?? pts.objectives[1] ?? pts.start, cargo: pts.objectives[pts.objectives.length - 2] ?? pts.start }
  for (const [name, key, yaw, pitch] of VIEWS) {
    const [x, z] = named[key]
    await page.evaluate(([x, z, y, p]) => { window.__czWarp(x, z); window.__czLook(y, p) }, [x, z, yaw, pitch])
    await page.waitForTimeout(Number(process.env.SETTLE ?? 3500))
    await page.screenshot({ path: `${out}/${site}-${phase}-${name}.jpg`, type: 'jpeg', quality: 82 })
  }
  const draw = await page.evaluate(() => window.__czDrawStats?.(20)).catch(() => null)
  console.log(site, phase, 'draw', JSON.stringify(draw))
  await page.close()
}
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no page errors')
