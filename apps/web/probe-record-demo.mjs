// A representative gameplay recording WITH the game's own audio: the Hub, the contract
// board, a Cinder Yard raid at dusk played through its real objectives to extraction,
// the War Table playing a real supply order, and the Exchange. Each segment is browser
// video plus the final mix captured from the audio engine (FpsAudio.captureStream),
// muxed and captioned, then joined into one file.
//   node probe-record-demo.mjs [outDir]
// Needs ffmpeg, the web app (BASE, default :3000) and the API. The fight is the dev bench
// (/dev/level): unscored, same scene and sounds as a live contract.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const out = process.argv[2] ?? 'demo-out'
const W = 1280, H = 720
mkdirSync(`${out}/seg`, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const GL = process.env.SWIFTSHADER ? ['--use-gl=angle', '--use-angle=swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
const browser = await chromium.launch({ channel: 'chrome', args: [...GL, '--autoplay-policy=no-user-gesture-required'] })
const report = []

async function until(page, fn, arg, ms = 30000, step = 250) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(step) }
  return false
}

/** Record one segment: run `act(page)` with audio captured from `engine` (a page expression). */
async function segment(name, caption, url, engine, act) {
  if (process.env.SEG && !process.env.SEG.split(',').includes(name.split('-')[0])) return
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: `${out}/seg`, size: { width: W, height: H } } })
  const t0 = Date.now()
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    localStorage.setItem('cz_welcome_seen', '1')
    localStorage.setItem('cz_tips_seen', JSON.stringify(['controls', 'loot', 'heal', 'cargo', 'extract', 'consequence', 'screen:war-table', 'screen:exchange', 'screen:intel']))
    localStorage.setItem('cz_settings', JSON.stringify({ v: 3, quality: 'medium' }))
  })
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  await act.ready?.(page)
  // the caption is part of the page, so it is in the browser's own video
  await page.evaluate((c) => {
    const d = document.createElement('div')
    d.textContent = c
    d.setAttribute('aria-hidden', 'true')
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:10px 16px;background:rgba(0,0,0,.6);color:#fff;font:600 18px Rajdhani,Arial,sans-serif;letter-spacing:.06em;pointer-events:none'
    document.body.appendChild(d)
  }, caption)
  await page.mouse.click(W - 40, H / 2) // a gesture: unlocks sound
  await sleep(300)
  const started = await page.evaluate(async (expr) => {
    const a = eval(expr)
    const s = a?.captureStream?.()
    if (!s) return false
    const rec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 })
    window.__czRec = { rec, chunks: [] }
    rec.ondataavailable = (e) => window.__czRec.chunks.push(e.data)
    rec.start(500)
    return true
  }, engine)
  const tAudio = Date.now()
  const trace = process.env.TRACE ? setInterval(() => page.evaluate(() => { const m = window.__czMission?.(), f = window.__czField?.(); return m ? `hp ${m.hp} alive ${m.alive} obj ${m.objective} hold ${f?.hold?.toFixed?.(2)} carried ${f?.carried?.length} t ${m.simTime.toFixed(1)}` : '' }).then((x) => x && console.log('   ', x)).catch(() => {}), 1000) : null
  await act.run(page)
  if (trace) clearInterval(trace)
  const b64 = started ? await page.evaluate(async () => {
    const { rec, chunks } = window.__czRec
    rec.stop(); await new Promise((r) => (rec.onstop = r))
    const u = new Uint8Array(await new Blob(chunks).arrayBuffer()); let s = ''
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s)
  }) : null
  const video = page.video()
  await ctx.close()
  const vpath = await video.path()
  renameSync(vpath, `${out}/seg/${name}-video.webm`)
  if (b64) writeFileSync(`${out}/seg/${name}-audio.webm`, Buffer.from(b64, 'base64'))
  // video starts at page creation; audio when the recorder started: skip the difference
  const skip = ((tAudio - t0) / 1000).toFixed(2)
  const args = ['-loglevel', 'error', '-y', '-ss', skip, '-i', `${out}/seg/${name}-video.webm`]
  if (b64) args.push('-i', `${out}/seg/${name}-audio.webm`)
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  args.push('-map', '0:v', '-map', '1:a', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest')
  args.push(`${out}/seg/${name}.mp4`)
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  report.push({ name, caption, audio: !!b64, seconds: (Date.now() - tAudio) / 1000, errors: errors.slice(0, 3), ffmpeg: r.status === 0 ? 'ok' : r.stderr.slice(0, 300) })
  console.log(name, b64 ? 'audio ok' : 'NO AUDIO', errors.length ? `errors: ${errors[0]}` : 'no page errors', r.status === 0 ? '' : r.stderr.slice(0, 200))
}

/** Cover the operator while it can't fight back: clear arrivals, and use a field dressing (H) when hurt. */
function cover(p) {
  const id = setInterval(async () => {
    try {
      const hp = await p.evaluate(() => { window.__czKillAll(); return window.__czMission().hp })
      if (hp < 65) { await p.keyboard.down('KeyH'); await sleep(250); await p.keyboard.up('KeyH') }
    } catch { /* page closing */ }
  }, 700)
  return () => clearInterval(id)
}

const shared = 'window.__czSharedAudio?.()'
const fight = 'window.__czAudio'

// 1. Hub: one operational update, a last look seeded three in-game hours back
await segment('1-hub', 'HUB: the hangar, the next operation, and what changed since the last look', '/', shared, {
  ready: async (p) => {
    await p.evaluate(() => localStorage.setItem('cz_hub_last', JSON.stringify({ tick: 0, at: Date.now() - 3 * 3600e3, readiness: { vanguard: 'Operational', ashen: 'Operational' } })))
    await p.reload({ waitUntil: 'domcontentloaded' })
    await p.waitForSelector('[data-testid="since-visit"]', { timeout: 120000 })
    await sleep(3000)
  },
  run: async () => { await sleep(11000) },
})

// 2. Contract board: the operations map follows the list
await segment('2-contracts', 'CONTRACTS: the operations map follows the contract you point at', '/contracts', shared, {
  ready: async (p) => { await p.waitForSelector('[data-testid="board-table"] canvas', { timeout: 120000 }); await sleep(3000) },
  run: async (p) => {
    const cards = p.locator('[data-testid="contract-card"]')
    const n = Math.min(4, await cards.count())
    for (let i = 0; i < n; i++) { await cards.nth(i).hover(); await sleep(3200) }
  },
})

// 3. Cinder Yard at dusk: in, fight, take the cargo, extract
await segment('3-cinder-yard', 'CINDER YARD, DUSK: raid the Ashen Compact, take the cargo, extract (dev bench, unscored)', '/dev/level?site=cinder-yard&phase=dusk&kind=raid&defense=1', fight, {
  ready: async (p) => {
    await until(p, () => typeof window.__czWarp === 'function', null, 180000); await p.evaluate(() => window.__czSkipBriefing())
    // the mouse-capture hint stays up until a real pointer lock, which a headless browser never gets
    await p.evaluate(() => setInterval(() => document.querySelectorAll('div').forEach((d) => { if (d.textContent?.startsWith('AIM UP/DOWN')) d.style.setProperty('visibility', 'hidden', 'important') }), 300))
    await sleep(1500)
  },
  run: async (p) => {
    // take in the yard, then move up the road
    for (const y of [0, -0.5, 0.5, 0]) { await p.evaluate((y) => window.__czLook(y, 0.02), y); await sleep(1300) }
    await p.keyboard.down('KeyW'); await sleep(2500); await p.keyboard.up('KeyW')
    // contact: wake the yard and return fire
    await p.evaluate(() => window.__czWakeAll())
    await p.evaluate(() => window.__czFire(true)); await sleep(4500); await p.evaluate(() => window.__czFire(false))
    await sleep(1500)
    // through the objectives to the cargo (rooms cleared, points reached)
    for (let g = 0; g < 10; g++) {
      const m = await p.evaluate(() => window.__czMission()), objs = await p.evaluate(() => window.__czObjectives())
      const cur = objs[m.objective]
      if (!cur || cur.kind === 'secure' || cur.kind === 'extract') break
      if (cur.kind === 'reach') await p.evaluate(([x, z]) => window.__czWarp(x, z), cur.pos)
      if (cur.kind === 'clear') { await p.evaluate(() => window.__czFire(true)); await sleep(2000); await p.evaluate(() => { window.__czFire(false); window.__czKillAll() }) }
      // the guards woken at contact are dealt with as the operator moves through (a script can't aim)
      await p.evaluate(() => window.__czKillAll())
      await until(p, (i) => window.__czMission().objective > i, m.objective, 20000)
      await sleep(800)
    }
    // load every case (up to three) and hold the position (the objective is a 10 s hold under reinforcement);
    // the script can't aim, so it is covered from here to the end
    await p.evaluate(() => window.__czKillAll())
    const covering = cover(p)
    const cases = (await p.evaluate(() => window.__czField().items)).filter((i) => i.kind === 'cargo_case').slice(0, 3)
    for (const [k, c] of cases.entries()) {
      await p.evaluate(([x, z]) => { window.__czWarp(x, z + 0.5); window.__czLook(0, -1.0) }, c.pos)
      // reinforcements come in waves while you load; the script can't aim, so they're cleared as they land
      await p.keyboard.down('KeyE'); await until(p, (n) => window.__czField().carried.length >= n, k + 1, 30000, 200); await p.keyboard.up('KeyE')
      await sleep(600)
    }
    // to the extraction zone, and hold it
    for (let g = 0; g < 6; g++) {
      const m = await p.evaluate(() => window.__czMission()), objs = await p.evaluate(() => window.__czObjectives())
      const cur = objs[m.objective]
      if (!cur || cur.kind === 'extract') break
      if (cur.kind === 'reach') await p.evaluate(([x, z]) => window.__czWarp(x, z), cur.pos)
      await until(p, (i) => window.__czMission().objective > i, m.objective, 25000)
    }
    const z = (await p.evaluate(() => window.__czField())).exfil
    if (z) {
      await p.evaluate(([x, zz]) => { window.__czWarp(x, zz); window.__czLook(Math.PI, 0.05) }, z.pos)
      // call the extraction (hold the use key in the zone), then hold the zone through the countdown
      await p.keyboard.down('KeyE'); await until(p, () => window.__czField().phase === 'counting', null, 20000, 200); await p.keyboard.up('KeyE')
      await p.evaluate(() => window.__czLook(1.2, 0.05))
      await until(p, () => window.__czMission().complete, null, 60000, 300)
    }
    covering()
    await sleep(3000)
  },
})

// 4. War Table: a real supply order played on the relief
await segment('4-war-table', 'WAR TABLE: a real supply order: shortage, competing offers, the winner, delivery', '/war-room', shared, {
  ready: async (p) => { await p.waitForSelector('[data-testid="war-table-3d"] canvas', { timeout: 120000 }); await sleep(4000) },
  run: async (p) => {
    const play = p.locator('[data-testid^="play-order-"]').first()
    if (await play.count()) { await play.click(); await sleep(3400 * 7 + 1500) } else await sleep(12000)
  },
})

// 5. Exchange: the market floor
await segment('5-exchange', 'EXCHANGE: two merchants, their real shelves and live prices', '/exchange', shared, {
  ready: async (p) => { await p.waitForSelector('[data-testid="market-floor"] canvas', { timeout: 120000 }); await sleep(3000) },
  run: async (p) => { await sleep(6000); await p.mouse.wheel(0, 500); await sleep(4000) },
})

await browser.close()
if (process.env.SEG) process.exit(0)
const list = ['1-hub', '2-contracts', '3-cinder-yard', '4-war-table', '5-exchange'].map((n) => `file 'seg/${n}.mp4'`).join('\n')
writeFileSync(`${out}/list.txt`, list)
const cat = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${out}/list.txt`, '-c', 'copy', `${out}/contract-zero-living-world.mp4`], { encoding: 'utf8' })
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
console.log(cat.status === 0 ? `wrote ${out}/contract-zero-living-world.mp4` : cat.stderr)
