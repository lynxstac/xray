// Demo videoni yozadi: haqiqiy brauzer, 2x masshtab (2560x1440 kadrlar), ovozga bog'langan sahnalar.
//   node video/record.ts <repo> <base-sha> <head-sha> [--script video/script.en.json] [--audio video/work/audio] [--out video/work]
// Natija: <out>/master.mp4 (kadr to'g'ridan-to'g'ri ffmpeg'ga, 30 fps, devor soatiga aniq) va <out>/timeline.json
import { chromium, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { startServer } from '@xray/server';

const argv = process.argv.slice(2);
const opt = (name: string, def: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1]! : def);
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [repoSrc, base, head] = positional;
if (!repoSrc || !base || !head) throw new Error('usage: record.ts <repo> <base> <head> [--script f] [--audio dir] [--out dir]');

const root = path.resolve(import.meta.dirname, '..');
const scriptFile = path.resolve(opt('script', path.join(root, 'video/script.en.json')));
const audioDir = path.resolve(opt('audio', path.join(root, 'video/work/audio')));
const outDir = path.resolve(opt('out', path.join(root, 'video/work')));
const W = 1280, H = 720, DSF = 2, FPS = 30;
mkdirSync(outDir, { recursive: true });

const script = JSON.parse(readFileSync(scriptFile, 'utf8')) as {
  lang: 'uz' | 'en';
  scenes: { id: string }[];
  ui: { rangeLabel: string; enableAiLabel: string };
  cards: { intro: { title: string; line1: string; line2: string }; end: { title: string; line1: string; line2: string; line3: string } };
};
const LANG = script.lang;
const audio = JSON.parse(readFileSync(path.join(audioDir, 'audio.json'), 'utf8')) as { durations: Record<string, number> };

// Demo repo: neytral yo'l (foydalanuvchi nomi ko'rinmasin), asl repoga tegilmaydi
const demoRepo = '/tmp/demo/taxonomy';
if (!existsSync(demoRepo)) {
  mkdirSync('/tmp/demo', { recursive: true });
  execFileSync('git', ['clone', '-q', '--no-hardlinks', repoSrc, demoRepo]);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'xray-rec-'));
const srv = await startServer({ port: 8830, token: 'demo', webDist: path.join(root, 'apps/web/dist'), cacheDir: path.join(tmp, 'cache'), aiConfigPath: path.join(tmp, 'ai.json'), env: {} });

const browser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${DSF}`, `--window-size=${W},${H + 86}`, '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: null, locale: LANG === 'uz' ? 'uz-UZ' : 'en-US' });
await ctx.addInitScript((lang: string) => {
  try { localStorage.setItem('xray-lang', lang); } catch { /* ixtiyoriy */ }
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '@keyframes xr-rip{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(2.6);opacity:0}}';
    document.head.appendChild(style);
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(51,225,255,.5);border:2px solid #33e1ff;pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;transition:left .07s,top .07s';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX}px;top:${e.clientY}px;width:40px;height:40px;border-radius:50%;border:2px solid #33e1ff;pointer-events:none;animation:xr-rip .55s ease-out forwards`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 650);
    });
    const card = document.createElement('div');
    card.id = '__card';
    card.style.cssText = 'position:fixed;z-index:99990;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:radial-gradient(circle at 50% 40%,#0f1b26,#070a0e);color:#e6f3ff;font-family:Inter,system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .6s;pointer-events:none;padding:40px';
    document.body.appendChild(card);
  });
}, LANG);
const page = await ctx.newPage();

// Oyna balandligini aniq viewport H ga kalibrlaymiz
const bcdp = await browser.newBrowserCDPSession();
for (let i = 0; i < 3; i++) {
  const [iw, ih] = await page.evaluate(() => [innerWidth, innerHeight]);
  if (iw === W && ih === H) break;
  const { windowId, bounds } = await bcdp.send('Browser.getWindowForTarget', { targetId: undefined as never }).catch(async () => {
    const t = await bcdp.send('Target.getTargets');
    const pg = t.targetInfos.find((x) => x.type === 'page')!;
    return bcdp.send('Browser.getWindowForTarget', { targetId: pg.targetId });
  });
  await bcdp.send('Browser.setWindowBounds', { windowId, bounds: { width: (bounds.width ?? W) + (W - iw), height: (bounds.height ?? H) + (H - ih) } });
  await page.waitForTimeout(150);
}
const dims = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
if (dims[0] !== W || dims[1] !== H || dims[2] !== DSF) throw new Error(`viewport ${dims.join('x')} kutilgan ${W}x${H}@${DSF} emas`);

// ---- kadr yig'uvchi: CDP screencast -> ffmpeg (30 fps, devor soatiga mos) ----
const masterPath = path.join(outDir, 'master.mp4');
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '13', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', masterPath], { stdio: ['pipe', 'inherit', 'inherit'] });
const cdp = await ctx.newCDPSession(page);
let latest: Buffer | null = null;
let t0 = 0;
let running = true;
let written = 0;
let frameSize = '';
cdp.on('Page.screencastFrame', (f) => {
  latest = Buffer.from(f.data, 'base64');
  if (!t0) { t0 = performance.now(); frameSize = `${f.metadata.deviceWidth}x${f.metadata.deviceHeight}`; }
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
});
const pacer = (async () => {
  while (running || (latest && written < Math.floor(((performance.now() - t0) * FPS) / 1000))) {
    if (latest && t0) {
      const target = Math.floor(((performance.now() - t0) * FPS) / 1000);
      while (written < target) {
        if (!ff.stdin.write(latest)) await once(ff.stdin, 'drain');
        written++;
      }
    }
    await new Promise((r) => setTimeout(r, 3));
    if (!running) break;
  }
})();
const now = () => (performance.now() - t0) / 1000;
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * DSF, maxHeight: H * DSF, everyNthFrame: 1 });

await page.goto('http://127.0.0.1:8830/?token=demo');
for (let i = 0; i < 100 && !t0; i++) await page.waitForTimeout(20);
if (!t0) throw new Error('screencast kadr bermadi');

// ---- yordamchilar ----
const timeline: { id: string; start: number; audioStart: number; narrationEnd: number; end: number }[] = [];
const sleepUntil = async (t: number) => { const d = (t - now()) * 1000; if (d > 0) await page.waitForTimeout(d); };
const card = (html: string | null) => page.evaluate((h) => { const c = document.getElementById('__card'); if (!c) return; if (h) c.innerHTML = h; c.style.opacity = h ? '1' : '0'; }, html);
const glide = async (sel: string, steps = 22) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
};
const click = async (sel: string) => { await glide(sel); await page.waitForTimeout(120); await page.locator(sel).first().click(); };
const GAP = 0.5; // sahnalar orasidagi nafas

async function scene(id: string, actions: () => Promise<void>) {
  const dur = audio.durations[id];
  if (dur === undefined) throw new Error(`audio yo'q: ${id}`);
  const start = now();
  const audioStart = start + 0.12;
  await actions();
  const narrationEnd = audioStart + dur;
  await sleepUntil(narrationEnd + GAP);
  timeline.push({ id, start, audioStart, narrationEnd, end: now() });
}

// ---- sahnalar ----
await scene('intro', async () => {
  const ic = script.cards.intro;
  await card(`<div style="font-size:112px;font-weight:800;letter-spacing:.12em"><span style="color:#33e1ff;text-shadow:0 0 30px rgba(51,225,255,.6)">X</span>-RAY</div><div style="font-size:34px">${ic.line1}</div><div style="font-size:22px;color:#7d8fa0">${ic.line2}</div>`);
  await page.waitForTimeout(1500);
});
await scene('open', async () => {
  await card(null);
  await page.waitForTimeout(900);
  await page.getByTestId('repo-path').click();
  await page.getByTestId('repo-path').pressSequentially(demoRepo, { delay: 55 });
  await page.waitForTimeout(500);
  await click('[data-testid=open-repo]');
  await page.getByTestId('index-report').waitFor();
});
await scene('report', async () => {
  const sk = page.locator('.kv-block summary');
  if (await sk.count()) { await glide('.kv-block summary'); await page.waitForTimeout(500); await sk.first().click(); }
});
await scene('explore', async () => {
  await click('[data-testid=tab-explorer]');
  await page.waitForTimeout(500);
  await page.getByTestId('search').pressSequentially('Button', { delay: 90 });
  await page.waitForTimeout(700);
  await click('[data-testid=results] button');
});
await scene('panels', async () => {
  const drag = async (side: 'r' | 'l', dx: number) => {
    const h = (await page.getByTestId(`handle-${side}`).boundingBox())!;
    const y = h.y + h.height / 2;
    await page.mouse.move(h.x + 4, y, { steps: 12 });
    await page.mouse.down();
    await page.mouse.move(h.x + 4 + dx, y, { steps: 26 });
    await page.mouse.up();
  };
  await drag('r', -170); await page.waitForTimeout(500); await drag('r', 170);
});
await scene('impact', async () => {
  await click('[data-testid=tab-impact]');
  await page.waitForTimeout(500);
  await page.getByText(script.ui.rangeLabel).click();
  await page.waitForTimeout(250);
  await page.getByTestId('base-ref').click();
  await page.getByTestId('base-ref').pressSequentially(base, { delay: 55 });
  await page.getByTestId('head-ref').fill(head);
});
await scene('summary', async () => {
  await click('[data-testid=run-impact]');
  await page.getByTestId('impact-report').waitFor();
  await page.waitForTimeout(400);
  await glide('[data-testid=itab-changed]'); await page.waitForTimeout(250);
  await glide('[data-testid=itab-direct]'); await page.waitForTimeout(250);
  await glide('[data-testid=itab-indirect]');
});
await scene('direct', async () => {
  await click('[data-testid=itab-direct]');
  await page.waitForTimeout(300);
  await glide('[data-testid=impact-item]');
  await page.mouse.move(420, 330, { steps: 16 });
});
await scene('evidence', async () => {
  await click('[data-testid=impact-item]');
  await page.waitForTimeout(1300);
  await glide('[data-testid=evidence-body] .steps', 26);
  await page.waitForTimeout(900);
  await glide('[data-testid=evidence-body] .source', 26);
});
await scene('indirect', async () => {
  await click('[data-testid=itab-indirect]');
  await page.waitForTimeout(400);
  await click('[data-testid=impact-item]');
  await page.waitForTimeout(500);
  await glide('[data-testid=evidence-body] .mini-graph', 26);
});
await scene('routes', async () => {
  if (await page.getByTestId('itab-routes').count()) {
    await click('[data-testid=itab-routes]');
    await page.waitForTimeout(500);
    await glide('[data-testid=routes] button', 24);
  } else {
    await page.waitForTimeout(800);
  }
});
await scene('ask', async () => {
  await click('[data-testid=tab-ask]');
  await page.waitForTimeout(400);
  await page.getByTestId('question').click();
  await page.getByTestId('question').pressSequentially('Where is `Button` used?', { delay: 70 });
  await page.waitForTimeout(300);
  await click('[data-testid=ask-btn]');
  await page.getByTestId('ask-result').waitFor();
});
await scene('askoff', async () => {
  await glide('[data-testid=ai-status]', 20);
  await page.waitForTimeout(700);
  const en = page.getByText(script.ui.enableAiLabel);
  if (await en.count()) { await glide('details.enable summary'); await en.click(); await page.waitForTimeout(500); await glide('[data-testid=consent-text]', 24); }
});
await scene('end', async () => {
  await page.mouse.move(W / 2, H + 40, { steps: 8 });
  const ec = script.cards.end;
  await card(`<div style="font-size:54px;font-weight:800;color:#33e1ff">${ec.title}</div><div style="font-size:30px;max-width:1000px;line-height:1.4">${ec.line1}</div><div style="font-size:21px;color:#9fb3c4;max-width:960px">${ec.line2}</div><div style="font-size:19px;color:#6f8294;margin-top:8px">${ec.line3}</div>`);
  await page.waitForTimeout(1200);
});
await page.waitForTimeout(1200); // oxirgi kadrni ushlab turamiz

const duration = now();
running = false;
await cdp.send('Page.stopScreencast');
await pacer;
ff.stdin.end();
const [code] = (await once(ff, 'close')) as [number];
await ctx.close(); await browser.close(); await srv.close();
rmSync(tmp, { recursive: true, force: true });
if (code !== 0) throw new Error(`ffmpeg ${code} bilan tugadi`);
writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ fps: FPS, width: W * DSF, height: H * DSF, frameSize, duration, framesWritten: written, scenes: timeline }, null, 2));
console.log(`master.mp4: ${duration.toFixed(1)}s, ${written} kadr (${written / FPS}s), kadr ${frameSize}`);
