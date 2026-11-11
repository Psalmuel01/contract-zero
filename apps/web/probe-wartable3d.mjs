// The War Table relief against the live API: renders, selection from the list focuses
// a facility and lays out its holder's stock, the flat map still works, and phones get
// it too. Screenshots for review.
//   node probe-wartable3d.mjs [outDir]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'wartable-out'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }

for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404/.test(m.text())) errors.push(m.text()) })
  await page.addInitScript(() => {
    localStorage.setItem('cz_welcome_seen', '1')
    localStorage.removeItem('cz_wartable_view')
    localStorage.setItem('cz_tips_seen', JSON.stringify(['controls', 'loot', 'heal', 'cargo', 'extract', 'consequence', 'screen:war-table', 'screen:exchange', 'screen:intel']))
  })
  await page.goto(`${BASE}/war-room`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="war-table-3d"] canvas', { timeout: 180000 })
  await page.waitForTimeout(6000)
  const box = page.locator('[data-testid="war-table"]')
  await box.screenshot({ path: `${out}/${name}-relief.jpg`, type: 'jpeg', quality: 85 })
  check(await page.locator('[data-testid="war-table-3d"] canvas').count() === 1, `${name}: the relief renders a canvas`)
  const label = await page.locator('[data-testid="war-table-3d"]').getAttribute('aria-label')
  check(/War Table, a schematic relief/.test(label ?? ''), `${name}: the relief describes itself to screen readers (${(label ?? '').slice(0, 80)}…)`)
  // select Cinder Yard from the accessible list
  const btn = page.getByRole('group', { name: 'Facilities' }).getByRole('button', { name: /Cinder Yard/i })
  if (await btn.count()) {
    await btn.first().click()
    await page.waitForTimeout(5000)
    check(await btn.first().getAttribute('aria-pressed') === 'true', `${name}: Cinder Yard selected from the list`)
    await box.screenshot({ path: `${out}/${name}-relief-cinder.jpg`, type: 'jpeg', quality: 85 })
  } else check(false, `${name}: Cinder Yard in the facility list`)
  // play a real supply order on the table, beat by beat
  const play = page.locator('[data-testid^="play-order-"]').first()
  if (await play.count()) {
    await play.click()
    await page.waitForSelector('[data-testid="order-card"]', { timeout: 10000 })
    check(true, `${name}: a supply order plays on the table with its card`)
    for (const [i, wait] of [[1, 3800], [2, 3800], [3, 3800]]) {
      await page.waitForTimeout(wait)
      await box.screenshot({ path: `${out}/${name}-order-beat${i}.jpg`, type: 'jpeg', quality: 85 })
    }
    const card = await page.locator('[data-testid="order-card"]').innerText()
    check(/Supply order #\d+/i.test(card) && /(competing offers|single offer|no offers)/i.test(card), `${name}: the card names the order and how many offers there really were`)
    await page.getByTestId('order-card-close').click()
    check(await page.locator('[data-testid="order-card"]').count() === 0, `${name}: the card closes`)
  } else console.log(`SKIP ${name}: no supply orders recorded to play`)
  // the flat map still works
  await page.getByTestId('wt-view-flat').click()
  await page.waitForTimeout(800)
  check(await page.locator('[data-testid="war-table"] svg[aria-label^="War Table"]').count() === 1, `${name}: the flat map is one click away`)
  const kept = await page.evaluate(() => localStorage.getItem('cz_wartable_view'))
  check(kept === 'flat', `${name}: the choice is remembered (${kept})`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 1, `${name}: no sideways scroll (${overflow}px)`)
  check(!errors.length, `${name}: no page errors${errors.length ? `: ${errors.slice(0, 2).join(' | ')}` : ''}`)
  await page.close()
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
