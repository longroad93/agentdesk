// 逐帧录制宣传片：headless Chrome 打开 index.html?record，每帧调用 render(t) 截图，
// 帧直接喂给 ffmpeg 的 stdin 编码成 mp4。零 npm 依赖（Node 自带 WebSocket / fetch，需要 Node 22+）。
//
//   node promo/record.mjs                 # 默认 30fps → promo/out/agentdesk-promo.mp4
//   node promo/record.mjs --fps 60 --out promo/out/x.mp4
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const FPS = Number(arg('fps', 30));
const OUT = resolve(arg('out', join(here, 'out', 'agentdesk-promo.mp4')));
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PORT = 9333;

mkdirSync(dirname(OUT), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'agentdesk-promo-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1920,1080',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

// 异常退出时至少把 Chrome 杀掉；临时目录在正常结束路径里等 Chrome 退干净再删
process.on('exit', () => chrome.kill());
const cleanup = async () => {
  const closed = new Promise((r) => chrome.once('close', r));
  chrome.kill();
  await closed;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
};

async function waitForTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome 没起来，检查 --chrome 路径');
}

const ws = new WebSocket(await waitForTarget());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 出错');
  return r.result.value;
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
// --nocap：不画字幕（剪 README 用的动图时，中英文 README 共用一份）
const url = pathToFileURL(join(here, 'index.html')).href + '?record' + (process.argv.includes('--nocap') ? '&nocap' : '');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 800));
await evaluate('document.fonts.ready.then(() => true)');
const duration = await evaluate('window.DURATION');
const frames = Math.round(duration * FPS);

// 有音轨（audio.mjs 生成的）就一起封进去；--silent 不要声音
const AUDIO = join(here, 'out', 'promo-audio.m4a');
const withAudio = !process.argv.includes('--silent') && existsSync(AUDIO);
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  ...(withAudio ? ['-i', AUDIO, '-map', '0:v', '-map', '1:a', '-c:a', 'copy', '-shortest'] : []),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });

// --from / --to：只录一段（秒），调某个场景时省时间
const FROM = Number(arg('from', 0)), TO = Math.min(duration, Number(arg('to', duration)));
for (let f = Math.round(FROM * FPS); f < Math.round(TO * FPS); f++) {
  // 每帧重建 DOM，<img> 是新元素：等它们解码完再截，否则图标会偶尔闪空
  await evaluate(`(render(${f / FPS}), Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => true))`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % FPS === 0) process.stdout.write(`\r录制中 ${f}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
ws.close();
await cleanup();
console.log(`\r已输出 ${OUT}（${Math.round((TO - FROM) * FPS)} 帧 @ ${FPS}fps）`);
process.exit(0);
