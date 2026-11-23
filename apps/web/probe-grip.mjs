// Stills of the grip bench (/dev/grip): one weapon, hands on, in the rig view from two
// angles and in the player view at the hip and aimed. For judging hands and finish by eye.
//   node probe-grip.mjs [outDir] [gunId]
// GPU=1 renders on this machine's GPU instead of SwiftShader.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'grip-out'
const gun = process.argv[3] ?? 'assault_rifle'
mkdirSync(out, { recursive: true })
const gl = process.env.GPU ? ['--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader']
const browser = await chromium.launch({ channel: 'chrome', args: [...gl, '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${BASE}/dev/grip`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: gun, exact: true }).click()
await page.waitForTimeout(2500)
const canvas = () => page.locator('canvas').first()
// A page clip, not an element screenshot: a live canvas never settles, and Playwright
// waits for an element to be stable before shooting it.
const shot = async (name) => { const b = await canvas().boundingBox(); await page.screenshot({ path: `${out}/${gun}-${name}.jpg`, type: 'jpeg', quality: 88, clip: b }) }
await shot('player-hip')
await page.keyboard.press('a'); await page.waitForTimeout(800); await shot('player-ads')
await page.keyboard.press('a'); await page.keyboard.press('r'); await page.waitForTimeout(1200); await shot('rig-right')
// Orbit to the far side and up top: the sides the player never sees are where hands fall apart.
const box = await canvas().boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 520, cy, { steps: 12 }); await page.mouse.up()
await page.waitForTimeout(600); await shot('rig-left')
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 260, { steps: 12 }); await page.mouse.up()
await page.waitForTimeout(600); await shot('rig-top')
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no page errors')
