// Records what a player hears in each site: the final mix after the limiter, via a
// capture tap, through a fixed script driven by the game's own sound functions:
//   0-10 s   the site's soundscape alone (guards down, so nothing else sounds)
//   10-22 s  a firefight: the player's rifle and guards' shots around the listener
//   14 s     a radio line over the fight (a real pre-voiced line; VO_ID picks it)
//   22-34 s  extraction: the call, the vehicle coming in, the countdown, success
// Writes <out>/<site>.webm and <site>.json (segment marks) for ffmpeg analysis.
//   node probe-audio-record.mjs [outDir] [site,...]
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'audio-out'
const sites = (process.argv[3] ?? 'dustline-depot,blacksite,cinder-yard').split(',')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] })
for (const site of sites) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: 'low' })); localStorage.setItem('cz_welcome_seen', '1') })
  await page.goto(`${BASE}/dev/level?site=${site}&phase=${process.env.PHASE ?? 'day'}&kind=raid`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__czAudio === 'object' && typeof window.__czKillAll === 'function', null, { timeout: 180000 })
  await page.mouse.click(320, 180) // a gesture unlocks audio
  await page.evaluate(() => { window.__czSkipBriefing(); window.__czKillAll() })
  await page.waitForTimeout(3000)
  const b64 = await page.evaluate(async ([parts, VO_ID]) => {
    const a = window.__czAudio
    const stream = a.captureStream()
    if (!stream) return null
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 })
    const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start(500)
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const p = window.__czPlayer()
    const around = (k) => [p.x + Math.cos(k) * (8 + (k % 3) * 9), 1.5, p.z - 6 + Math.sin(k) * 10]
    const profile = { hpFreq: 1100, noiseDur: 0.06, vol: 0.55, bodyF0: 130, bodyF1: 55, bodyDur: 0.09, thump: true }
    await wait(10000)                                    // soundscape alone
    if (parts.includes('music')) a.setMusicState?.('combat')
    const t0 = performance.now()
    let k = 0, radio = false
    while (performance.now() - t0 < 12000) {             // firefight
      if (parts.includes('shot') && k % 2 === 0) a.shot(profile)
      if (parts.includes('enemy') && k % 3 === 0) a.enemyShot(around(k), { impact: [p.x + 0.6, 1.4, p.z], hit: false })
      if (parts.includes('impact') && k % 7 === 0) a.impact('wall', [p.x + 1, 1.2, p.z - 2])
      if (parts.includes('radio') && !radio && performance.now() - t0 > 4000) { a.vo(VO_ID, 'handler', 3.5); radio = true }
      k++
      await wait(130)
    }
    a.setMusicState?.('infiltration')
    a.extractCall(); a.setExtraction(true); a.setMusicOverride?.('extraction')
    await wait(4000); a.extractLeft()
    await wait(3000); a.extractLeft()
    await wait(3500); a.extractSuccess(); a.setExtraction(false); a.setMusicOverride?.(null)
    await wait(1500)
    rec.stop()
    await new Promise((r) => (rec.onstop = r))
    const buf = await new Blob(chunks).arrayBuffer()
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s)
  }, [(process.env.FIGHT ?? 'shot,enemy,impact,radio,music').split(','), process.env.VO_ID ?? 'handler-first-contact'])
  if (b64) {
    writeFileSync(`${out}/${site}.webm`, Buffer.from(b64, 'base64'))
    writeFileSync(`${out}/${site}.json`, JSON.stringify({ segments: { soundscape: [0, 10], firefight: [10, 22], radio: [14, 17.5], extraction: [22, 34] } }))
    console.log(site, 'recorded', errors.length ? `errors: ${errors[0]}` : 'no page errors')
  } else console.log(site, 'FAIL no capture stream')
  await page.close()
}
await browser.close()
