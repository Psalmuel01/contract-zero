// Records the radio voices as a player hears them (the final mix, after the limiter),
// in separate scenarios, and logs where each line's voice came from.
//   API=http://localhost:8080 node probe-voice-record.mjs <outDir>
// Needs the web app (BASE, default :3000) pointed at an API with a voice service
// (TTS_URL) and a world that has made a few decisions (GET /radio returns lines).
//
//   clean      a pre-voiced line, then a server-voiced line, no fight
//   combat     the same kinds of line during a firefight
//   strategic  three server-written faction/merchant lines in turn
//   failed     a missing voice (404), a voice service that never answers, a line with no
//              voice at all: the speaker's brief tone and nothing else, never fake speech
// Plus clean-vs-processed renders of the same voices through the game's own radio chain.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const API = process.env.API ?? 'http://localhost:8080'
const out = process.argv[2] ?? 'voice-out'
mkdirSync(out, { recursive: true })

// A voice service that accepts and never answers: the "slow / hung TTS" condition.
const held = []
const hole = net.createServer((s) => { held.push(s); s.on('error', () => {}) }).listen(8546, '127.0.0.1')

const radio = (await (await fetch(`${API}/radio?limit=12`)).json()).lines.filter((l) => l.audio)
const pick = (who) => radio.find((l) => l.speaker === who)
const strategic = ['vanguard', 'ashen', 'vex', 'halcyon'].map(pick).filter(Boolean).slice(0, 3)
if (strategic.length < 2) { console.error(`need strategic lines from ${API}/radio (got ${radio.length}); let the world run longer`); process.exit(1) }
const dyn = strategic[0]
console.log('strategic lines:', strategic.map((l) => `${l.speaker}: ${l.text}`).join(' | '))

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const outcomes = []
page.on('console', (m) => { if (m.text().startsWith('[radio]')) outcomes.push(m.text()) })
await page.addInitScript(() => { localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: 'low' })); localStorage.setItem('cz_welcome_seen', '1') })
await page.goto(`${BASE}/dev/level?site=dustline-depot&phase=day&kind=raid&defense=1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__czWarp === 'function' && window.__czAudio, null, { timeout: 180000 })
await page.mouse.click(300, 200)
await page.evaluate(() => { window.__czSkipBriefing(); window.__czKillAll() })
await page.waitForTimeout(2500)

async function record(name, script, args) {
  const b64 = await page.evaluate(async ([script, args]) => {
    const a = window.__czAudio
    const stream = a.captureStream()
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start(250)
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const p = window.__czPlayer()
    const fight = async (ms) => {
      const t0 = performance.now(); let k = 0
      const profile = { hpFreq: 1100, noiseDur: 0.06, vol: 0.55, bodyF0: 130, bodyF1: 55, bodyDur: 0.09, thump: true }
      while (performance.now() - t0 < ms) {
        if (k % 2 === 0) a.shot(profile)
        if (k % 3 === 0) a.enemyShot([p.x + Math.cos(k) * 12, 1.5, p.z - 6 + Math.sin(k) * 10], { impact: [p.x + 0.6, 1.4, p.z], hit: false })
        k++; await wait(130)
      }
    }
    // eslint-disable-next-line no-new-func
    await new Function('a', 'wait', 'fight', 'args', `return (async () => { ${script} })()`)(a, wait, fight, args)
    rec.stop(); await new Promise((r) => (rec.onstop = r))
    const buf = await new Blob(chunks).arrayBuffer()
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s)
  }, [script, args])
  writeFileSync(`${out}/${name}.webm`, Buffer.from(b64, 'base64'))
  console.log(`${name}: recorded`)
}

const url = (l) => `${API}${l.audio}`
await record('clean', `
  await wait(1500)
  a.vo('handler-first-contact', 'handler')                        // pre-voiced
  await wait(4500)
  a.vo('radio-' + args.dyn.key, args.dyn.speaker, undefined, args.dynUrl)  // server-voiced
  await wait(7000)
`, { dyn, dynUrl: url(dyn) })

await record('combat', `
  const f = fight(14000)
  await wait(2500); a.vo('handler-low-ammo', 'handler')
  await wait(5500); a.vo('radio-' + args.dyn.key, args.dyn.speaker, undefined, args.dynUrl)
  await f
  await wait(1000)
`, { dyn, dynUrl: url(dyn) })

await record('strategic', `
  await wait(1000)
  // As the feed sends them (it spaces lines out; 6 s here to keep the recording short).
  for (const l of args.lines) { a.vo('radio-' + l.key, l.speaker, undefined, l.url); await wait(6500) }
  await wait(1500)
`, { lines: strategic.map((l) => ({ ...l, url: url(l) })) })

await record('failed', `
  await wait(1000)
  a.vo('radio-missing', 'vanguard', undefined, args.missing)       // 404
  await wait(3000)
  a.vo('radio-hung', 'ashen', undefined, 'http://127.0.0.1:8546/x') // never answers: the deadline
  await wait(3500)
  a.vo('dyn-no-voice', 'vex')                                       // no voice at all
  await wait(3000)
`, { missing: `${API}/radio/decision-999999999/vo` })

// The same voices, clean (as synthesized) and through the radio chain, rendered offline.
for (const [name, src, who] of [['handler-first-contact', `${BASE}/vo/handler-first-contact.mp3`, 'handler'], [`strategic-${dyn.speaker}`, url(dyn), dyn.speaker]]) {
  for (const processed of [false, true]) {
    const r = await page.evaluate(async ([src, who, processed]) => {
      const { rate, samples } = await window.__czAudio.renderVoice(src, who, processed)
      const b = new Int16Array(samples.length); for (let i = 0; i < samples.length; i++) b[i] = Math.max(-1, Math.min(1, samples[i])) * 32767
      let s = ''; const u = new Uint8Array(b.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
      return { rate, pcm: btoa(s) }
    }, [src, who, processed])
    const pcm = Buffer.from(r.pcm, 'base64'), h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
    h.writeUInt32LE(r.rate, 24); h.writeUInt32LE(r.rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
    writeFileSync(`${out}/${name}-${processed ? 'processed' : 'clean'}.wav`, Buffer.concat([h, pcm]))
  }
}
writeFileSync(`${out}/outcomes.txt`, outcomes.join('\n') + '\n')
console.log(outcomes.join('\n'))
await browser.close(); hole.close(); held.forEach((s) => s.destroy())
