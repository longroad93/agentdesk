// 抽几帧静态图检查画面，不用录整片：node promo/frames.mjs 3.5 20 31.2 …（秒）→ promo/out/frames/*.png
// 顺便收集页面报错（场景脚本写错了会在这里暴露）。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// --file <html>：换一个页面来抽帧（比如检查 bundle.mjs 打出来的单文件版）
const fi = process.argv.indexOf('--file');
const PAGE = fi > 0 ? process.argv[fi + 1] : join(here, 'index.html');
// --nocap：不画字幕
const times = process.argv.slice(2).filter((_, i, a) => a[i - 1] !== '--file' && !_.startsWith('--')).map(Number).filter((x) => !Number.isNaN(x));
const dir = join(here, 'out', 'frames');
mkdirSync(dir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'agentdesk-frames-'));
const PORT = 9334;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1920,1080', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map(), errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(PAGE).href + '?record' + (process.argv.includes('--nocap') ? '&nocap' : '') });
await new Promise((r) => setTimeout(r, 1000));
for (const t of times) {
  const r = await send('Runtime.evaluate', { expression: `(render(${t}), Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => true))`, awaitPromise: true });
  if (r.result?.exceptionDetails) errors.push(`t=${t}: ` + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(dir, `t${t}.png`), Buffer.from(result.data, 'base64'));
}
ws.close();
const closed = new Promise((r) => chrome.once('close', r));
chrome.kill();
await closed;
rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
console.log(errors.length ? '页面报错：\n' + [...new Set(errors)].join('\n') : `✓ ${times.length} 帧，无报错 → ${dir}`);
