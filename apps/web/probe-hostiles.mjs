import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:3100/training', { waitUntil: 'networkidle', timeout: 240000 });
await page.click('[data-testid=mode-practice]'); await page.click('[data-testid=kind-raid]'); await page.click('[data-testid=start-practice]');
for (let i = 0; i < 60 && !(await page.$('canvas')); i++) { await page.mouse.click(400, 225).catch(() => {}); await page.waitForTimeout(1000); }
await page.waitForFunction(() => typeof window.__czField === 'function', null, { timeout: 120000 });
await page.waitForTimeout(6000); await page.evaluate(() => window.__czSkipBriefing?.());
const obj = () => page.evaluate(() => (document.body.innerText.match(/OBJECTIVE[^\n]*/) || [''])[0]);
await page.waitForTimeout(3000); console.log('start  :', await obj());
const objs = await page.evaluate(() => window.__czObjectives()); const reach = objs.filter((o) => o.kind === 'reach');
await page.evaluate(([x, z]) => window.__czWarp(x, z), reach[0].pos); await page.waitForTimeout(4000); console.log('entry  :', await obj());
await page.evaluate(() => window.__czKillAll()); await page.waitForTimeout(4000); console.log('cleared:', await obj());
await page.evaluate(([x, z]) => window.__czWarp(x, z), reach[1].pos); await page.waitForTimeout(6000); console.log('push   :', await obj());
await page.evaluate(() => window.__czKillAll()); await page.waitForTimeout(3000); console.log('killed :', await obj());
const c = objs.find((o) => o.kind === 'secure');
await page.evaluate(([x, z]) => window.__czWarp(x, z), c.pos);
for (let i = 0; i < 5; i++) { await page.waitForTimeout(30000); console.log(`cargo +${(i + 1) * 30}s:`, await obj(), ' sim t', await page.evaluate(() => window.__czMission().simTime.toFixed(1))); }
console.log('errors', errs.length, errs.slice(0, 2)); await b.close();
