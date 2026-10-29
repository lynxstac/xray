// Master + ovoz + musiqadan YouTube (16:9) va Reels/Shorts (9:16) videolarini yasaydi.
//   node video/render.ts [--work video/work] [--out video/out] [--music "<mp3>"] [--alt-music "<mp3>"] [--music-start 0]
// Kerak: video/work/master.mp4, timeline.json, audio/*.wav (record.ts va tts/synth.py natijalari).
import { chromium, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1]! : d);
const root = path.resolve(import.meta.dirname, '..');
const work = path.resolve(opt('work', path.join(root, 'video/work')));
const out = path.resolve(opt('out', path.join(root, 'video/out')));
const music = opt('music', path.join(os.homedir(), 'Videos/Video_Music/05_Corporate_Business/01_Close_Up__Michael_Ramir_C.mp3'));
const altMusic = opt('alt-music', path.join(os.homedir(), 'Videos/Video_Music/05_Corporate_Business/04_Pop_Track_03__Lily_J.mp3'));
const musicStart = Number(opt('music-start', '0'));
const scriptFile = path.resolve(opt('script', path.join(root, 'video/script.en.json')));
mkdirSync(out, { recursive: true });
const tmp = path.join(work, 'render');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

type Texts = { title: string; youtubeDescription: string; instagramCaption: string };
type Script = { lang: 'uz' | 'en'; scenes: Scene[]; reel: { introHeadline: string; endCard: { title: string; n1: string; n1label: string; n2: string; n2label: string; line1: string; line2: string } }; thumb: { title: string; sub: string; size: number }; cover: { title: string; size: number }; texts: Texts };
type Scene = { id: string; say: string; sub?: string; caption: string; headline: string; chapter: string; group: string; reel: boolean; card?: boolean; crop: { cx: number; cy: number; side: number } };
const script = JSON.parse(readFileSync(scriptFile, 'utf8')) as Script;
const tl = JSON.parse(readFileSync(path.join(work, 'timeline.json'), 'utf8')) as { fps: number; width: number; height: number; duration: number; scenes: { id: string; start: number; audioStart: number; narrationEnd: number; end: number }[] };
const audio = JSON.parse(readFileSync(path.join(work, 'audio/audio.json'), 'utf8')) as { durations: Record<string, number> };
const byId = new Map(script.scenes.map((s) => [s.id, s]));
const DSF = tl.width / 1280;

// ---------- yordamchilar ----------
function ffmpeg(args: string[], label: string): string {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg (${label}) xato:\n${r.stderr}`);
  return r.stderr;
}
function loudnorm(input: string, output: string, I: number, TP: number, LRA = 9): { before: number; after: number } {
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /\{[\s\S]*?"target_offset"[\s\S]*?\}/.exec(probe.stderr);
  if (!m) throw new Error('loudnorm o\'lchovi o\'qilmadi');
  const j = JSON.parse(m[0]) as Record<string, string>;
  ffmpeg(['-i', input, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`, '-ar', '48000', '-c:a', 'pcm_s16le', output], 'loudnorm');
  const v = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const vm = /\{[\s\S]*?"target_offset"[\s\S]*?\}/.exec(v.stderr);
  return { before: Number(j.input_i), after: vm ? Number((JSON.parse(vm[0]) as Record<string, string>).input_i) : NaN };
}
const dur = (f: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim());

/** Ovoz yo'li: har sahna wav'i berilgan vaqtda (adelay). */
function buildVoice(items: { id: string; at: number }[], total: number, outFile: string) {
  const inputs: string[] = [];
  const chains: string[] = [];
  items.forEach((it, i) => {
    inputs.push('-i', path.join(work, 'audio', `${it.id}.wav`));
    const ms = Math.round(it.at * 1000);
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
  });
  const mix = `${items.map((_, i) => `[v${i}]`).join('')}amix=inputs=${items.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[o]`;
  ffmpeg([...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[o]', '-c:a', 'pcm_s16le', outFile], 'voice');
}

/** Musiqa: doimiy daraja (ducking YO'Q), kirish/chiqish fade. */
function buildMusic(file: string, start: number, total: number, outFile: string, tag: string) {
  const raw = path.join(tmp, `music_${tag}_raw.wav`);
  ffmpeg(['-stream_loop', '-1', '-ss', String(start), '-t', total.toFixed(3), '-i', file, '-af', `aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=1.2,afade=t=out:st=${(total - 3).toFixed(3)}:d=3`, '-c:a', 'pcm_s16le', raw], 'music');
  return loudnorm(raw, outFile, -32, -6, 11); // ovozdan ~16 dB past
}

function makeAudio(items: { id: string; at: number }[], total: number, musicFile: string, tag: string): string {
  const voice = path.join(tmp, `voice_${tag}.wav`);
  const voiceN = path.join(tmp, `voice_${tag}_n.wav`);
  const musicN = path.join(tmp, `music_${tag}_n.wav`);
  const mix = path.join(tmp, `mix_${tag}.wav`);
  const fin = path.join(tmp, `final_${tag}.wav`);
  buildVoice(items, total, voice);
  const v = loudnorm(voice, voiceN, -16, -2, 7);
  const m = buildMusic(musicFile, musicStart, total, musicN, tag);
  ffmpeg(['-i', voiceN, '-i', musicN, '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95[o]', '-map', '[o]', '-c:a', 'pcm_s16le', mix], 'mix');
  const f = loudnorm(mix, fin, -14, -1.5, 9);
  console.log(`  [${tag}] ovoz ${v.before.toFixed(1)}→${v.after.toFixed(1)} LUFS, musiqa → ${m.after.toFixed(1)} LUFS, yakuniy ${f.before.toFixed(1)}→${f.after.toFixed(1)} LUFS`);
  return fin;
}

// ---------- matn bo'laklari (subtitr/izoh) ----------
const subText = (s: string) => s.replace(/Next J S/g, 'Next.js').replace(/A\.I\./g, 'AI').replace(/\bX-Ray\b/g, 'X-Ray');
function chunks(sc: Scene, a: number, b: number): { a: number; b: number; text: string }[] {
  // Gaplarga BO'LISH asl `say` matnida (u yerda "Next J S", "A.I." nuqta bilan buzmaydi), keyin ko'rinadigan imloga o'tkaziladi.
  const raw = (sc.sub ?? sc.say).trim();
  const parts = raw.split(/(?<=[.:])\s+(?=[A-Z])/).map((p) => subText(p.trim())).filter(Boolean);
  const tot = parts.reduce((n, p) => n + p.length, 0);
  let t = a;
  return parts.map((p) => {
    const d = ((b - a) * p.length) / tot;
    const o = { a: t, b: t + d, text: p };
    t += d;
    return o;
  });
}

// ---------- HTML -> PNG ----------
async function png(page: Page, html: string, w: number, h: number, file: string, transparent = true) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;${transparent ? 'background:transparent' : ''};font-family:Inter,system-ui,sans-serif;color:#eaf4ff}</style>${html}`);
  await page.waitForTimeout(60);
  await page.screenshot({ path: file, omitBackground: transparent });
}

const SEC = (n: number) => n.toFixed(3);
const LEAD = 0.45, TAIL = 1.4;

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();

  // ================= YouTube 16:9 =================
  const total = tl.duration + LEAD + TAIL;
  const items = tl.scenes.map((s) => ({ id: s.id, at: s.audioStart + LEAD }));
  console.log('YouTube: audio');
  const ytAudio = makeAudio(items, total, music, 'yt');
  const ytAudioAlt = existsSync(altMusic) ? makeAudio(items, total, altMusic, 'yt_alt') : null;

  console.log('YouTube: video');
  const ytVideo = path.join(tmp, 'yt_video.mp4');
  const scale = `scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int:in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`;
  ffmpeg(['-i', path.join(work, 'master.mp4'), '-vf', `tpad=start_duration=${LEAD}:start_mode=clone:stop_duration=${TAIL}:stop_mode=clone,${scale},fade=t=in:st=0:d=0.5,fade=t=out:st=${SEC(total - 1.0)}:d=1.0,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-level', '4.2', '-r', '30', '-g', '60', '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', ytVideo], 'yt video');
  const mux = (video: string, aud: string, dest: string, abr: string) =>
    ffmpeg(['-i', video, '-i', aud, '-c:v', 'copy', '-c:a', 'aac', '-b:a', abr, '-ar', '48000', '-shortest', '-movflags', '+faststart', '-metadata', `title=${script.texts.title}`, dest], 'mux');
  mux(ytVideo, ytAudio, path.join(out, 'xray-youtube-1080p.mp4'), '256k');
  if (ytAudioAlt) mux(ytVideo, ytAudioAlt, path.join(out, 'xray-youtube-1080p_alt-music.mp4'), '256k');

  // subtitrlar (SRT/VTT)
  const cues: { a: number; b: number; text: string }[] = [];
  for (const s of tl.scenes) cues.push(...chunks(byId.get(s.id)!, s.audioStart + LEAD, s.narrationEnd + LEAD));
  const stamp = (t: number, sep: string) => { const ms = Math.round(t * 1000); const p = (n: number, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`; };
  const wrap = (t: string) => { if (t.length <= 44) return t; const mid = t.lastIndexOf(' ', Math.floor(t.length / 2) + 6); return mid > 0 ? `${t.slice(0, mid)}\n${t.slice(mid + 1)}` : t; };
  writeFileSync(path.join(out, 'xray-youtube.srt'), cues.map((c, i) => `${i + 1}\n${stamp(c.a, ',')} --> ${stamp(c.b, ',')}\n${wrap(c.text)}\n`).join('\n'));
  writeFileSync(path.join(out, 'xray-youtube.vtt'), 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.a, '.')} --> ${stamp(c.b, '.')}\n${wrap(c.text)}\n`).join('\n'));

  // boblar (chapters)
  const groups: { name: string; at: number }[] = [];
  for (const s of tl.scenes) {
    const g = byId.get(s.id)!.group;
    if (!groups.length || groups[groups.length - 1]!.name !== g) groups.push({ name: g, at: s.start + LEAD });
  }
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  groups[0]!.at = 0;
  const chapters = groups.map((g) => `${mmss(g.at)} ${g.name}`).join('\n');

  // ================= Reels / Shorts 9:16 =================
  console.log('Reels: overlays');
  const reelScenes = tl.scenes.filter((s) => byId.get(s.id)!.reel);
  const W = 1080, H = 1920, SW = 1080, SH = 860, SY = 470; // ekran oynasi (IG xavfsiz zonalari: tepa ~250 px, past ~420 px)
  const bg = path.join(tmp, 'bg.png');
  await png(page, `<div style="width:${W}px;height:${H}px;background:radial-gradient(circle at 50% 30%,#10202e 0%,#070a0e 70%)"></div>`, W, H, bg, false);
  const mask = path.join(tmp, 'mask.png');
  await png(page, `<div style="width:${SW}px;height:${SH}px;background:#000"><div style="width:100%;height:100%;border-radius:36px;background:#fff"></div></div>`, SW, SH, mask, false);
  const frame = path.join(tmp, 'frame.png');
  await png(page, `<div style="position:absolute;left:0;top:${SY}px;width:${SW}px;height:${SH}px;border-radius:36px;border:3px solid rgba(51,225,255,.55);box-shadow:0 0 60px rgba(51,225,255,.25)"></div>`, W, H, frame);
  const reelParts: { id: string; scene: Scene; a: number; b: number; len: number }[] = [];
  let cursor = 0;
  const GAPR = 0.3;
  for (const ts of reelScenes) {
    const sc = byId.get(ts.id)!;
    const len = audio.durations[ts.id]! + GAPR + 0.15;
    reelParts.push({ id: ts.id, scene: sc, a: ts.audioStart - 0.1, b: ts.audioStart - 0.1 + len, len });
    cursor += len;
  }
  const reelTotal = cursor + 1.2;
  const headerPng: Record<string, string> = {};
  for (const p of reelParts) {
    const f = path.join(tmp, `hdr_${p.id}.png`);
    await png(page, `<div style="position:absolute;left:0;right:0;top:268px;text-align:center"><div style="font-size:34px;font-weight:800;letter-spacing:.34em;color:#33e1ff;text-shadow:0 0 22px rgba(51,225,255,.55)">X-RAY</div><div style="margin-top:14px;font-size:96px;font-weight:800;line-height:1.05;letter-spacing:-.02em;text-shadow:0 4px 30px rgba(0,0,0,.6)">${p.scene.id === 'end' ? '' : p.scene.id === 'intro' ? script.reel.introHeadline : p.scene.headline}</div></div>`, W, H, f);
    headerPng[p.id] = f;
  }
  const capPngs: Record<string, { a: number; b: number; file: string }[]> = {};
  // Karaoke izohlar: har so'z o'z vaqtida yoritiladi (word-timings: video/wordtimes.py -> audio/words.json); yo'q bo'lsa gap bo'laklari.
  const wordsFile = path.join(work, 'audio/words.json');
  const words = existsSync(wordsFile) ? (JSON.parse(readFileSync(wordsFile, 'utf8')) as Record<string, { w: string; s: number; e: number }[]>) : {};
  const capHtml = (inner: string) => `<div style="position:absolute;left:70px;right:70px;top:1368px;height:210px;display:flex;align-items:flex-start;justify-content:center;text-align:center;font-size:60px;font-weight:800;line-height:1.2;letter-spacing:-.01em;text-shadow:0 3px 18px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9)">${inner}</div>`;
  for (const p of reelParts) {
    capPngs[p.id] = [];
    const ws = words[p.id];
    if (ws?.length) {
      // qatorlarga bo'lish: ~4 so'z yoki tinish belgisida
      const lines: { w: string; s: number; e: number }[][] = [];
      let cur: { w: string; s: number; e: number }[] = [];
      for (const w of ws) {
        cur.push(w);
        if (cur.length >= 4 || /[.:;?!]$/.test(w.w) || (cur.length >= 3 && /,$/.test(w.w))) { lines.push(cur); cur = []; }
      }
      if (cur.length) lines.push(cur);
      let li = 0;
      for (const line of lines) {
        for (let k = 0; k < line.length; k++) {
          const inner = `<div>${line.map((w, j) => `<span style="color:${j === k ? '#33e1ff' : j < k ? '#ffffff' : 'rgba(255,255,255,.55)'};${j === k ? 'text-shadow:0 0 26px rgba(51,225,255,.7),0 3px 18px rgba(0,0,0,.85);' : ''}">${w.w}</span>`).join(' ')}</div>`;
          const f = path.join(tmp, `cap_${p.id}_${li}_${k}.png`);
          await png(page, capHtml(inner), W, H, f);
          const a = k === 0 ? (li === 0 ? 0 : line[0]!.s + 0.1) : line[k]!.s + 0.1;
          const nextLine = lines[li + 1];
          const b = k < line.length - 1 ? line[k + 1]!.s + 0.1 : nextLine ? nextLine[0]!.s + 0.1 : p.len;
          capPngs[p.id]!.push({ a, b, file: f });
        }
        li++;
      }
      continue;
    }
    const cs = chunks(p.scene, 0.1, 0.1 + audio.durations[p.id]!);
    for (let i = 0; i < cs.length; i++) {
      const f = path.join(tmp, `cap_${p.id}_${i}.png`);
      await png(page, capHtml(cs[i]!.text), W, H, f);
      capPngs[p.id]!.push({ a: i === 0 ? 0 : cs[i]!.a, b: i === cs.length - 1 ? p.len : cs[i]!.b, file: f });
    }
  }

  console.log('Reels: segments');
  const segFiles: string[] = [];
  for (const p of reelParts) {
    if (p.scene.card) {
      // Yakuniy karta: ekran kesimi emas, vertikal uchun maxsus yaratilgan karta (matn kesilmasin)
      const cardPng = path.join(tmp, 'endcard.png');
      const ec = script.reel.endCard;
      await png(page, `<div style="position:absolute;left:60px;right:60px;top:470px;text-align:center"><div style="font-size:76px;font-weight:800;line-height:1.05;color:#33e1ff;letter-spacing:-.02em">${ec.title}</div><div style="margin:46px auto 0;display:flex;justify-content:center;gap:34px"><div><div style="font-size:112px;font-weight:800;line-height:1">${ec.n1}</div><div style="font-size:28px;color:#9fb3c4;margin-top:4px">${ec.n1label}</div></div><div><div style="font-size:112px;font-weight:800;line-height:1">${ec.n2}</div><div style="font-size:28px;color:#9fb3c4;margin-top:4px">${ec.n2label}</div></div></div><div style="margin-top:46px;font-size:40px;line-height:1.3;font-weight:600">${ec.line1}</div><div style="margin-top:34px;font-size:30px;color:#9fb3c4;line-height:1.4">${ec.line2}</div></div>`, W, H, cardPng);
      const f = path.join(tmp, `seg_${p.id}.mp4`);
      const capsC = capPngs[p.id]!;
      const inC = ['-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', bg, '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', cardPng, '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', headerPng[p.id]!];
      capsC.forEach((cp) => inC.push('-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', cp.file));
      const gc = ['[0:v]format=rgba[b0]', '[b0][1:v]overlay=0:0[b1]', '[b1][2:v]overlay=0:0[b2]'];
      let lc = 'b2';
      capsC.forEach((cp, i) => { gc.push(`[${lc}][${3 + i}:v]overlay=0:0:enable='between(t,${SEC(cp.a)},${SEC(cp.b)})'[c${i}]`); lc = `c${i}`; });
      gc.push(`[${lc}]scale=flags=lanczos+accurate_rnd+full_chroma_int:out_range=tv:out_color_matrix=bt709,format=yuv420p[vout]`);
      ffmpeg([...inC, '-filter_complex', gc.join(';'), '-map', '[vout]', '-t', SEC(p.len), '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', f], `seg ${p.id}`);
      segFiles.push(f);
      continue;
    }
    const c = p.scene.crop;
    const wPx = Math.round((c.side * DSF) / 2) * 2;
    const hPx = Math.round((wPx * SH) / SW / 2) * 2;
    const cx = Math.min(Math.max(Math.round(c.cx * DSF - wPx / 2), 0), tl.width - wPx);
    const cy = Math.min(Math.max(Math.round(c.cy * DSF - hPx / 2), 0), tl.height - hPx);
    const n = Math.round(p.len * 30);
    const pan = reelParts.indexOf(p) % 2 ? -1 : 1;
    const caps = capPngs[p.id]!;
    const inputs = ['-ss', SEC(p.a), '-t', SEC(p.len), '-i', path.join(work, 'master.mp4'), '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', bg, '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', mask, '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', frame, '-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', headerPng[p.id]!];
    caps.forEach((cp) => inputs.push('-loop', '1', '-framerate', '30', '-t', SEC(p.len), '-i', cp.file));
    const g: string[] = [
      `[0:v]fps=30,crop=${wPx}:${hPx}:${cx}:${cy},zoompan=z='min(1+0.09*on/${n},1.09)':x='iw/2-(iw/zoom/2)+${pan}*iw*0.025*on/${n}':y='ih/2-(ih/zoom/2)':d=1:s=${SW}x${SH}:fps=30,scale=${SW}:${SH}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=full:in_color_matrix=bt601,format=rgba[scr]`,
      `[2:v]format=gray[m]`, `[scr][m]alphamerge[sm]`,
      `[1:v]format=rgba[b0]`, `[b0][sm]overlay=0:${SY}[b1]`, `[b1][3:v]overlay=0:0[b2]`, `[b2][4:v]overlay=0:0[b3]`,
    ];
    let last = 'b3';
    caps.forEach((cp, i) => { g.push(`[${last}][${5 + i}:v]overlay=0:0:enable='between(t,${SEC(cp.a)},${SEC(cp.b)})'[c${i}]`); last = `c${i}`; });
    g.push(`[${last}]scale=flags=lanczos+accurate_rnd+full_chroma_int:out_range=tv:out_color_matrix=bt709,format=yuv420p[vout]`);
    const f = path.join(tmp, `seg_${p.id}.mp4`);
    ffmpeg([...inputs, '-filter_complex', g.join(';'), '-map', '[vout]', '-t', SEC(p.len), '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', f], `seg ${p.id}`);
    segFiles.push(f);
  }
  const list = path.join(tmp, 'segs.txt');
  writeFileSync(list, segFiles.map((f) => `file '${f}'`).join('\n'));
  const reelVideo = path.join(tmp, 'reel_video.mp4');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tpad=stop_duration=1.2:stop_mode=clone,fade=t=out:st=${SEC(reelTotal - 0.7)}:d=0.7`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-level', '4.2', '-r', '30', '-g', '60', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', reelVideo], 'reel concat');
  let at = 0;
  const reelItems = reelParts.map((p) => { const it = { id: p.id, at: at + 0.1 }; at += p.len; return it; });
  console.log('Reels: audio');
  const reelAudio = makeAudio(reelItems, reelTotal, music, 'reel');
  const reelAudioAlt = existsSync(altMusic) ? makeAudio(reelItems, reelTotal, altMusic, 'reel_alt') : null;
  const muxReel = (aud: string, dest: string) => ffmpeg(['-i', reelVideo, '-i', aud, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', '-metadata', 'title=X-Ray', dest], 'mux reel');
  muxReel(reelAudio, path.join(out, 'xray-reel-1080x1920.mp4'));
  if (reelAudioAlt) muxReel(reelAudioAlt, path.join(out, 'xray-reel-1080x1920_alt-music.mp4'));

  // ================= Thumbnail va muqova =================
  console.log('Thumbnail / cover');
  const evid = tl.scenes.find((s) => s.id === 'evidence')!;
  const still = path.join(tmp, 'still.png');
  ffmpeg(['-ss', SEC(evid.audioStart + 3.2), '-i', path.join(work, 'master.mp4'), '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos:in_range=full:out_range=full:in_color_matrix=bt601:out_color_matrix=bt709', still], 'still');
  const stillUrl = `data:image/png;base64,${readFileSync(still).toString('base64')}`;
  await png(page, `<div style="position:relative;width:1280px;height:720px;overflow:hidden;background:#070a0e"><img src="${stillUrl}" style="position:absolute;right:-120px;top:70px;width:1100px;border-radius:18px;border:3px solid rgba(51,225,255,.5);box-shadow:0 0 80px rgba(51,225,255,.28);opacity:.95"/><div style="position:absolute;inset:0;background:linear-gradient(90deg,#070a0e 0%,#070a0eee 36%,#070a0e55 62%,transparent 100%)"></div><div style="position:absolute;left:64px;top:96px;width:620px"><div style="font-size:30px;font-weight:800;letter-spacing:.36em;color:#33e1ff">X-RAY</div><div style="margin-top:22px;font-size:${script.thumb.size}px;font-weight:800;line-height:1.04;letter-spacing:-.03em">${script.thumb.title}</div><div style="margin-top:26px;font-size:32px;color:#9fb3c4;line-height:1.3">${script.thumb.sub}</div></div></div>`, 1280, 720, path.join(out, 'xray-thumbnail-1280x720.png'), false);
  await png(page, `<div style="position:relative;width:${W}px;height:${H}px;background:radial-gradient(circle at 50% 30%,#10202e 0%,#070a0e 70%);overflow:hidden"><div style="position:absolute;left:0;right:0;top:268px;text-align:center"><div style="font-size:34px;font-weight:800;letter-spacing:.34em;color:#33e1ff">X-RAY</div><div style="margin-top:14px;font-size:${script.cover.size}px;font-weight:800;line-height:1.06;letter-spacing:-.02em;padding:0 60px">${script.cover.title}</div></div><img src="${stillUrl}" style="position:absolute;left:-330px;top:${SY + 250}px;width:1540px;border-radius:36px;border:3px solid rgba(51,225,255,.55);box-shadow:0 0 60px rgba(51,225,255,.25)"/></div>`, W, H, path.join(out, 'xray-reel-cover-1080x1920.png'), false);
  await browser.close();

  // ================= Tavsif matnlari =================
  writeFileSync(path.join(out, 'youtube-description.txt'), script.texts.youtubeDescription.replace('{chapters}', chapters));
  writeFileSync(path.join(out, 'instagram-caption.txt'), script.texts.instagramCaption);
  console.log(`\nTayyor: ${out}`);
}

await main();
void copyFileSync;
