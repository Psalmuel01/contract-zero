// Regression: when Auto quality steps down mid-mission (any device that can't hold
// its frame rate), the level's instanced meshes are rebuilt with new materials. They
// used to keep the default identity matrices, so the whole site collapsed to the
// origin and the player stood on an empty plain. Software rendering is slow enough
// that Auto always steps down here, which is exactly the condition we need.
//   node probe-auto-stepdown.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }

for (const site of ['dustline-depot', 'blacksite', 'cinder-yard']) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: 'auto' })))
  await page.goto(`${BASE}/dev/level?site=${site}&phase=day&kind=raid`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__czCull === 'function', null, { timeout: 180000 })
  await page.evaluate(() => window.__czSkipBriefing())
  const spread = () => page.evaluate(() => {
    const m = window.__czCull().meshes.filter((x) => x.n > 1)
    return { n: m.length, maxR: Math.max(...m.map((x) => x.spread)), post: window.__czRender().plan.post }
  })
  const before = await spread()
  let after = before
  for (let i = 0; i < 12 && after.post !== 'off'; i++) { await page.waitForTimeout(3000); after = await spread() }
  check(after.post === 'off', `${site}: Auto stepped down to the minimal tier (${before.post} -> ${after.post})`)
  check(after.maxR > 10, `${site}: level instances still spread over the site after the step-down (widest instance spread ${after.maxR} m, was ${before.maxR} m)`)
  check(!errors.length, `${site}: no page errors${errors.length ? `: ${errors[0]}` : ''}`)
  await page.close()
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
