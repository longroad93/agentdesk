// 生成 README 里的面板截图：用产品自己的前端（src/ui/ 的 html/css/js，经 src/ui.js 拼装）
// 渲染一份演示数据，所以截图和装完看到的一模一样 —— 改了面板样式，重跑这个就行。
//
//   node docs/shots.mjs     # → docs/images/panel-{light,dark}.png、browser-{light,dark}.png
//
// 做法：页面里的 EventSource 换成一个假的，连上就推一帧 sync（格式同 src/server.js 的 frame()）。
// 任务的排序、needs 用 src/store.js / src/states.js 的真函数算，不手写。
// 需要本机有 Google Chrome。
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderHTML } from '../src/ui.js';
import { ATTENTION, STATES, needsAttention } from '../src/states.js';
import { byUrgency } from '../src/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'images');
mkdirSync(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---------- 演示数据：七种状态各有一条，内容都是编的 ----------
const now = Date.now(), M = 60e3;
const cwd = (p) => '/Users/demo/code/' + p;
const raw = [
  { id: 'a', agent: 'claude', app: 'Claude', state: 'waiting', title: '排查登录偶发 401', cwd: cwd('shop-api'),
    summary: '要执行：git push --force-with-lease origin fix/auth-401', waiting_since: now - 2 * M, last_seen: now - 2 * M },
  { id: 'b', agent: 'claude', app: 'Claude', state: 'bgrun', title: '后台跑全量 e2e', cwd: cwd('shop-api'),
    summary: '全量 e2e 已经在后台跑了，先把改动总结一下', bg: { b1: {} }, started_at: now - 9 * M, last_seen: now - 1.5 * M },
  { id: 'c', agent: 'codex', app: 'ChatGPT', state: 'running', title: '重构退款流程', cwd: cwd('shop-api'),
    activity: '在跑：pnpm test --filter payments', turn_at: now - 31 * M, last_seen: now - 1.2 * M },
  { id: 'd', agent: 'workbuddy', app: 'WorkBuddy', state: 'running', title: '同步 API 文档', cwd: cwd('docs-site'),
    activity: '修正 3 处过期示例', turn_at: now - 24 * M, last_seen: now - 3 * M },
  { id: 'e', agent: 'claude', app: 'Claude', state: 'stale', title: '迁移订单表到新 schema', cwd: cwd('shop-api'),
    summary: '最后在跑：node scripts/migrate.mjs --batch 5000', live_at: now - 17 * M, last_seen: now - 17 * M, seen: false },
  { id: 'f', agent: 'codex', app: 'ChatGPT', state: 'failed', title: '对账报表导出', cwd: cwd('shop-api'),
    summary: 'API 报错：overloaded_error，这一轮没跑完', done_at: now - 6 * M, last_seen: now - 6 * M, seen: false },
  { id: 'g', agent: 'workbuddy', app: 'WorkBuddy', state: 'done', title: '竞品定价表整理', cwd: cwd('biz'),
    summary: '整理好了，表格在 docs/pricing.xlsx', done_at: now - 4 * M, last_seen: now - 4 * M, seen: false },
  { id: 'h', agent: 'claude', app: 'Claude', state: 'done', title: '订单接口加分页', cwd: cwd('shop-api'),
    summary: '改好了。要不要顺便给 users 接口也加上？', asks: true, done_at: now - 38 * M, last_seen: now - 38 * M, seen: true },
  { id: 'i', agent: 'claude', app: 'Claude', state: 'idle', title: 'README 补安装说明', cwd: cwd('docs-site'),
    summary: '', last_seen: now - 52 * M, seen: true },
];
const tasks = raw.map((t) => ({ bg: {}, seen: true, confidence: 'exact', started_at: t.last_seen - 10 * M, ...t }))
  .map((t) => ({ ...t, needs: needsAttention(t) }))
  .sort(byUrgency);
const frame = { type: 'sync', tasks, states: STATES, attention: ATTENTION, build: 'shots', hasEvents: true, onScreen: null, notifier: 'shots', notify: [] };

// 假的 EventSource + 通知权限当作已授权（否则头部会显示「开启通知」按钮）。
// 悬浮窗模式再补上壳注入的 window.__shell，和 panel.swift 的做法一样
// 「等你」的徽标有呼吸动画，截图会截在半透明的那一刻 —— 截图里关掉动画
const stub = (shell) => `<style>*{animation:none!important}</style><script>
  ${shell ? "window.__shell = { notify: 'granted' };" : ''}
  try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch {}
  window.EventSource = class { constructor() { setTimeout(() => this.onmessage && this.onmessage({ data: ${JSON.stringify(JSON.stringify(frame))} }), 0); } close() {} };
</script>`;
const page = (shell) => renderHTML().replace('<body>', '<body>' + stub(shell));

// 悬浮窗：WKWebView 外面那层 NSPanel —— 透明标题栏里的红绿灯 + 圆角 + 阴影。
// 里面是真面板页面（iframe），不是重画的
const frameHTML = (src, dark) => `<!doctype html><html><head><style>
  html,body{margin:0;background:transparent}
  .w{margin:36px;width:340px;border-radius:12px;overflow:hidden;background:${dark ? '#0b0b0e' : '#fbfbfd'};
     box-shadow:0 18px 50px rgba(0,0,0,${dark ? '.55' : '.22'}),0 0 0 .5px rgba(0,0,0,${dark ? '.8' : '.18'})}
  .tb{height:28px;position:relative}
  .tb i{position:absolute;top:8px;width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)}
  iframe{display:block;border:0;width:340px;height:400px}
</style></head><body><div class="w"><div class="tb">
  <i style="left:10px;background:#ff5f57"></i><i style="left:30px;background:#febc2e"></i><i style="left:50px;background:#28c840"></i>
</div><iframe src="${src}"></iframe></div>
<script>
  // 窗口高度跟着内容走，列表不被截断（Chrome 带 --allow-file-access-from-files 才读得到 iframe 里的文档）
  const f = document.querySelector('iframe');
  const fit = () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } catch {} };
  f.onload = () => { fit(); setTimeout(fit, 400); };
</script></body></html>`;

// ---------- 截图 ----------
const tmp = mkdtempSync(join(tmpdir(), 'agentdesk-shots-'));
writeFileSync(join(tmp, 'browser.html'), page(false));
writeFileSync(join(tmp, 'panel.html'), page(true));
for (const dark of [false, true]) writeFileSync(join(tmp, `frame-${dark ? 'dark' : 'light'}.html`), frameHTML('panel.html?compact=1', dark));

const PORT = 9335;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmp, 'profile')}`,
  '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
}
if (!wsUrl) throw new Error('Chrome 没起来：' + CHROME);
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map(), errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

async function shot(file, url, { width, height, dark }) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url });
  await sleep(900);   // panel.js 的 markShell 有一次 300ms 的补刀
  // 高度按内容收紧，不留大片空白
  const h = (await send('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true })).result.value;
  await send('Emulation.setDeviceMetricsOverride', { width, height: Math.max(h, 100), deviceScaleFactor: 2, mobile: false });
  await sleep(150);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
  console.log('✓ docs/images/' + file);
}

for (const dark of [false, true]) {
  const m = dark ? 'dark' : 'light';
  await shot(`panel-${m}.png`, pathToFileURL(join(tmp, `frame-${m}.html`)).href, { width: 412, height: 560, dark });
  await shot(`browser-${m}.png`, pathToFileURL(join(tmp, 'browser.html')).href, { width: 868, height: 900, dark });
}

ws.close();
const closed = new Promise((r) => chrome.once('close', r));
chrome.kill();
await closed;
rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
if (errors.length) { console.error('页面报错：\n' + [...new Set(errors)].join('\n')); process.exit(1); }
