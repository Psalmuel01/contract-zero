// Sign-in page → "Continue with email" → Privy's email modal. Stops before the code.
import { chromium } from 'playwright'
const out = process.argv[2]
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
await p.goto('http://localhost:3000/signin', { waitUntil: 'networkidle' })
const btn = p.getByTestId('signin-email')
await btn.waitFor({ timeout: 30000 })
const labels = await p.locator('main button').allInnerTexts()
console.log('buttons:', JSON.stringify(labels))
await p.screenshot({ path: `${out}/signin.png` })
await btn.click()
const input = p.locator('input[type=email], input#email-input, input[placeholder*="email" i]').first()
await input.waitFor({ timeout: 45000 }).then(() => console.log('privy email field: shown')).catch(() => console.log('privy email field: NOT shown'))
await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/privy-modal.png` })
console.log('scripts loaded on /signin from privy:', (await p.evaluate(() => performance.getEntriesByType('resource').filter((r) => /privy/.test(r.name)).length)))
console.log('errors:', JSON.stringify(errs.slice(0, 6)))
await b.close()
