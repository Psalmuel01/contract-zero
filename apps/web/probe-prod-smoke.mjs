// Read-only smoke test of a DEPLOYED site: every main route on a desktop and a phone,
// signed out (production has no development sign-in). Records page errors, failed or
// refused API calls (including CORS), and whether the 3D scene comes up.
//   node probe-prod-smoke.mjs [https://contract-zero.vercel.app]
import { chromium, devices } from '@playwright/test'

const WEB = (process.argv[2] ?? 'https://contract-zero.vercel.app').replace(/\/$/, '')
const ROUTES = ['/', '/contracts', '/exchange', '/war-room', '/operator', '/signin', '/settings', '/training']
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
let failures = 0
const check = (ok, what, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }

for (const [label, opts] of [['desktop', { viewport: { width: 1366, height: 800 } }], ['phone', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext(opts)
  for (const route of ROUTES) {
    const page = await ctx.newPage()
    const errors = [], apiFails = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
    page.on('requestfailed', (r) => { if (/railway\.app/.test(r.url())) apiFails.push(`${r.failure()?.errorText} ${new URL(r.url()).pathname}`) })
    page.on('response', (r) => { if (/railway\.app/.test(r.url()) && r.status() >= 500) apiFails.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    const t = Date.now()
    const res = await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => ({ status: () => `ERR ${e.message.slice(0, 60)}` }))
    await page.waitForTimeout(4000)
    const status = res?.status?.()
    check(status === 200, `${label} ${route}: loads`, `${status} in ${Date.now() - t} ms`)
    check(errors.length === 0, `${label} ${route}: no page errors`, errors.slice(0, 2).join(' | '))
    check(apiFails.length === 0, `${label} ${route}: API calls succeed`, apiFails.slice(0, 3).join(' | '))
    await page.close()
  }
  // The game itself, signed out: the training range mounts the 3D scene.
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)))
  await page.goto(`${WEB}/training`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await page.click('[data-testid=start-practice]', { timeout: 30000 }).catch(() => {})
  const canvas = await page.waitForSelector('canvas', { timeout: 60000 }).then(() => true).catch(() => false)
  check(canvas, `${label} /training: the 3D scene mounts`)
  check(errs.length === 0, `${label} /training scene: no page errors`, errs.slice(0, 2).join(' | '))
  await page.close()
  await ctx.close()
}
await browser.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
