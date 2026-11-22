import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:3100/training', { waitUntil: 'networkidle', timeout: 180000 });
await page.click('[data-testid=mode-practice]');
await page.click('[data-testid=kind-raid]');
await page.click('[data-testid=start-practice]');
for (let i = 0; i < 60 && !(await page.$('canvas')); i++) { await page.mouse.click(400, 225).catch(() => {}); await page.waitForTimeout(1000); }
await page.waitForFunction(() => typeof window.__czField === 'function', null, { timeout: 120000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { window.__czSkipBriefing?.(); window.__czKillAll?.(); });
const objs = await page.evaluate(() => window.__czObjectives());
const reach = objs.filter((o) => o.kind === 'reach');
const f0 = await page.evaluate(() => window.__czField());
const c = f0.items.find((i) => i.kind === 'cargo_case');
console.log('level case', c.id, c.pos, 'reach points', reach.map((r) => r.pos));
const hold = async (p) => {
  await page.evaluate(([x, z]) => window.__czWarp(x, z), p);
  await page.waitForTimeout(800);
  await page.keyboard.down('e'); 
  const seen = new Set();
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(500); const t = await page.evaluate(() => document.body.innerText); if (/INNER SITE/.test(t)) seen.add('refusal-toast'); if ((await page.evaluate(() => window.__czField().carried.length)) > 0) break; }
  await page.keyboard.up('e');
  return { target: await page.evaluate(() => window.__czField().target), reached: await page.evaluate(() => window.__czField().reached), hold: await page.evaluate(() => window.__czField().hold), carried: await page.evaluate(() => window.__czField().carried), seen: [...seen] };
};
console.log('straight to the case:', JSON.stringify(await hold(c.pos)));
for (const r of reach.slice(0, 2)) { await page.evaluate(([x, z]) => window.__czWarp(x, z), r.pos); await page.waitForTimeout(2500); await page.evaluate(() => window.__czKillAll?.()); console.log('at', r.pos, 'now', JSON.stringify(await page.evaluate(() => { const s = window.__czState(); return { reached: window.__czField().reached, target: window.__czField().target, p: s.player ?? s.playerPos }; }))); }
console.log('after entry and push:', JSON.stringify(await hold(c.pos)));
console.log('page errors', errs.length, errs.slice(0, 2));
await b.close();
