// Practice raid: no reinforcements while you merely stand by the cargo; while loading
// they come from the far side and stop at the run's cap.
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://localhost:3100';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${URL}/training`, { waitUntil: 'networkidle', timeout: 240000 });
await page.click('[data-testid=mode-practice]'); await page.click('[data-testid=kind-raid]');
await page.click('[data-testid=defense-3]'); await page.click('[data-testid=start-practice]');
for (let i = 0; i < 60 && !(await page.$('canvas')); i++) { await page.mouse.click(400, 225).catch(() => {}); await page.waitForTimeout(1000); }
await page.waitForFunction(() => typeof window.__czField === 'function', null, { timeout: 120000 });
await page.waitForTimeout(6000); await page.evaluate(() => window.__czSkipBriefing?.());
const alive = () => page.evaluate(() => window.__czState().enemies.filter((e) => e.alive && e.active).length);
const st = () => page.evaluate(() => { const s = window.__czState(); return { t: +window.__czMission().simTime.toFixed(1), alive: s.enemies.filter((e) => e.alive && e.active).length }; });
const objs = await page.evaluate(() => window.__czObjectives()); const reach = objs.filter((o) => o.kind === 'reach');
await page.evaluate(([x, z]) => window.__czWarp(x, z), reach[0].pos); await page.waitForTimeout(3000);
await page.evaluate(([x, z]) => window.__czWarp(x, z), reach[1].pos); await page.waitForTimeout(3000);
await page.evaluate(() => window.__czKillAll()); await page.waitForTimeout(1500);
const cargo = objs.find((o) => o.kind === 'secure').pos;
const cases = (await page.evaluate(() => window.__czField().items)).filter((i) => i.kind === 'cargo_case');
// 1. Stand right by the cargo, not loading, long enough for several old-style drops.
await page.evaluate(([x, z]) => window.__czWarp(x + 2, z), cargo);
const t0 = (await st()).t; let maxIdle = 0;
while ((await st()).t - t0 < 20) { maxIdle = Math.max(maxIdle, await alive()); await page.waitForTimeout(2000); }
console.log(`standing by the cargo for 20 s of game time, not loading: max guards up = ${maxIdle}`);
// 2. Load every case; count every guard that comes back, and how far from us.
let spawned = 0, prev = 0, nearest = Infinity;
for (const c of cases) {
  await page.evaluate(([x, z]) => window.__czWarp(x, z + 0.5), c.pos);
  await page.keyboard.down('e');
  const t1 = (await st()).t;
  while ((await st()).t - t1 < 12) {
    const s = await page.evaluate(() => { const st = window.__czState(); return { up: st.enemies.filter((e) => e.alive && e.active).map((e) => [e.x, e.z]), me: window.__czField().carried.length }; });
    if (s.up.length > prev) { spawned += s.up.length - prev; for (const [x, z] of s.up) nearest = Math.min(nearest, Math.hypot(x - c.pos[0], z - c.pos[1])); }
    prev = s.up.length;
    // keep the field clear so later drops can still happen, as a player who fights back would
    if (s.up.length) { await page.evaluate(() => window.__czKillAll()); prev = 0; }
    await page.waitForTimeout(1500);
  }
  await page.keyboard.up('e');
}
const carried = await page.evaluate(() => window.__czField().carried.length);
console.log(`loading ${cases.length} cases (${carried} carried): reinforcements that arrived = ${spawned} (cap at L3 = 4); closest arrival = ${nearest.toFixed(1)} m from the case`);
console.log('page errors', errs.length, errs.slice(0, 2)); await b.close();
