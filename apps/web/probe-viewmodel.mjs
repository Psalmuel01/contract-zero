// The first-person weapon in the states a player actually sees: at the hip, aimed down
// the sights, mid-reload, pressed up against a wall, and at Low quality. Stills only;
// judge them by eye against the previous build's (BASE=... for another server).
//   node probe-viewmodel.mjs [outDir] [site] [phase]
// GPU=1 renders on this machine's GPU instead of SwiftShader.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'viewmodel-out'
const site = process.argv[3] ?? 'dustline-depot'
const phase = process.argv[4] ?? 'day'
mkdirSync(out, { recursive: true })
const gl = process.env.GPU ? ['--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader']
const browser = await chromium.launch({ channel: 'chrome', args: [...gl, '--ignore-gpu-blocklist'] })
const errors = []

async function open(quality, viewport = { width: 1280, height: 720 }, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript((q) => {
    localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: q }))
    localStorage.setItem('cz_welcome_seen', '1')
    localStorage.setItem('cz_tips_seen', JSON.stringify(['controls', 'loot', 'heal', 'cargo', 'extract', 'consequence']))
  }, quality)
  await page.goto(`${BASE}/dev/level?site=${site}&phase=${phase}&kind=raid&defense=2&seed=4`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__czWarp === 'function', null, { timeout: 180000 })
  await page.evaluate(() => { window.__czSkipBriefing(); window.__czKillAll?.() })
  await page.waitForTimeout(1500)
  return { page, ctx }
}
const shot = (page, name) => page.screenshot({ path: `${out}/${site}-${phase}-${name}.jpg`, type: 'jpeg', quality: 84 })

{
  const { page, ctx } = await open('high')
  await page.evaluate(() => window.__czLook(0.25, 0.02)); await page.waitForTimeout(1500)
  await shot(page, 'hip')
  await page.evaluate(() => window.__czAds?.(true)); await page.waitForTimeout(1500)
  await shot(page, 'ads')
  await page.evaluate(() => window.__czAds?.(false)); await page.waitForTimeout(800)
  // Mid-burst: the flash card, the smoke, a casing in the air and the kick on the weapon.
  await page.evaluate(() => window.__czFire(true)); await page.waitForTimeout(140); await shot(page, 'firing')
  await page.waitForTimeout(90); await shot(page, 'firing-2'); await page.evaluate(() => window.__czFire(false))
  await page.waitForTimeout(600)
  // Spend a few rounds so a reload is allowed, then catch it part way through.
  await page.evaluate(() => window.__czFire(true)); await page.waitForTimeout(700); await page.evaluate(() => window.__czFire(false))
  await page.waitForTimeout(400)
  await page.keyboard.press('r')
  for (const [ms, n] of [[450, 'reload-out'], [700, 'reload-in']]) { await page.waitForTimeout(ms); await shot(page, n) }
  await page.waitForTimeout(2500)
  // Nose against the nearest wall or cover face: the weapon must lower, never pass through it.
  const spot = await page.evaluate(() => {
    const p = window.__czPlayer(), cs = window.__czColliders()
    let best = null
    for (const c of cs) {
      const w = c.w ?? (c.max ? c.max[0] - c.min[0] : 0), d = c.d ?? (c.max ? c.max[2] - c.min[2] : 0)
      const x = c.x ?? (c.min[0] + c.max[0]) / 2, z = c.z ?? (c.min[2] + c.max[2]) / 2
      if (!(w > 2 && d > 0.3)) continue
      const face = z + d / 2 + 0.45 // stand just south of its south face, looking north
      const dist = Math.hypot(x - p.x, face - p.z)
      if (!best || dist < best.dist) best = { x, z: face, dist }
    }
    return best
  })
  if (spot) {
    await page.evaluate(([x, z]) => { window.__czWarp(x, z); window.__czLook(0, 0) }, [spot.x, spot.z])
    await page.waitForTimeout(1500)
    await shot(page, 'wall')
  }
  await ctx.close()
}
{
  const { page, ctx } = await open('low')
  await page.evaluate(() => window.__czLook(0.25, 0.02)); await page.waitForTimeout(1500)
  await shot(page, 'low')
  await ctx.close()
}
{
  const { page, ctx } = await open('high', { width: 844, height: 390 }, true)
  await page.evaluate(() => window.__czLook(0.25, 0.02)); await page.waitForTimeout(1500)
  await shot(page, 'phone')
  await ctx.close()
}
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no page errors')
