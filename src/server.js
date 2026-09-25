// 一个进程干完所有事：HTTP、SSE 推送、超时扫描、webhook。不需要 launchd / 计划任务。
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { Script } from 'node:vm';
import { loadConfig, loadEvents, EVENTS_FILE, HOME, ensureHome, append } from './store.js';
import { STATES, ATTENTION, needsAttention } from './states.js';
import { renderHTML, panelScript } from './ui.js';
import { pollAll, watchSources } from './pollers.js';
import { loadAdapters } from './adapters.js';
import { createDesktopFocus, frontmostSupported } from './readstate.js';
import { createIO, buildView } from './view.js';
import { alertsOf, newAlerts, fireWebhooks } from './transitions.js';
import { createScreenTracker, isOnScreen } from './screen.js';
import { onHeldChange, heldSettled } from './bgwatch.js';

// 前端写错会在浏览器里静默炸掉、页面一片空白。启动时先编译一遍，坏了当场报。
function assertUICompiles() {
  try {
    new Script(panelScript());
  } catch (err) {
    process.stderr.write(`\n[agentdesk] 面板 JS 有语法错误，页面会是空白:\n  ${err.message}\n\n`);
    process.exit(1);
  }
}

const BUILD = String(Date.now());

export function serve({ port } = {}) {
  assertUICompiles();
  ensureHome();
  const cfg = loadConfig();
  port = port || cfg.port || 4517;

  const adapters = loadAdapters();
  const desktop = createDesktopFocus();
  const io = createIO({ desktop });
  const screen = createScreenTracker({ adapters, desktop });
  // 兼容旧配置：muteForegroundAgent=false 关掉"在你眼前就不提醒"，sessionLevelSeen=false 关掉"看了一会儿就算看过"
  const muteOnScreen = cfg.muteForegroundAgent !== false;
  const seenOnScreen = cfg.sessionLevelSeen !== false;
  const clients = new Map();      // res -> { id, cap, perm, compact }
  let tasks = [];                 // 最近一次算出来的视图：新连接、前台检测都直接用它，不重算
  let alerts = new Map();         // id -> 为什么要你注意（见 transitions.js）
  let hasEvents = false;

  function view() {
    const events = loadEvents();
    hasEvents = events.length > 0;
    tasks = buildView({ cfg, adapters, io, events });
    return tasks;
  }

  // 谁来弹通知：悬浮窗（原生通知）优先，其次是授权过的浏览器页面。只挑一个 ——
  // 浏览器和悬浮窗都开着的时候，不然每条提醒都会弹两遍、响两遍
  function notifier() {
    const list = [...clients.values()];
    return list.find(c => c.cap === 'native' && c.perm === 'granted')
      || list.filter(c => c.cap === 'web' && c.perm === 'granted').at(-1)
      || null;
  }

  function frame(extra = {}) {
    return {
      type: 'sync', tasks, states: STATES, attention: ATTENTION, build: BUILD, hasEvents,
      onScreen: muteOnScreen ? screen.current : null, notifier: notifier()?.id ?? null, notify: [], ...extra,
    };
  }
  function push(data) {
    const line = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients.keys()) {
      try { res.write(line); } catch { clients.delete(res); }
    }
  }
  const pushNotifier = () => push({ type: 'notifier', notifier: notifier()?.id ?? null });

  function markSeen(id, via) {
    const i = String(id).indexOf(':');
    if (i <= 0) return;
    append({ agent: id.slice(0, i), key: id.slice(i + 1), kind: 'seen', ...(via ? { via } : {}) });
    const t = tasks.find(x => x.id === id);
    if (t) { t.seen = true; t.needs = needsAttention(t); }
  }

  // 提醒基线建好之前不比较：启动时要等后台任务查询回来才建基线，这期间文件监听和定时器
  // 已经在触发刷新了，拿空基线去比，会把所有需要处理的任务当成"新情况"全提醒一遍
  let baselineReady;
  const baseline = new Promise(r => { baselineReady = r; });

  // 串行执行：前台检测是异步的，期间又来了变化就等这一轮跑完再补一次
  let busy = false, again = false;
  async function diff() {
    await baseline;
    if (busy) { again = true; return; }
    busy = true;
    try {
      // 没有钩子的 agent 靠轮询（codex 读会话流，workbuddy 读 sqlite）。先轮询再投影，只算一遍
      try { pollAll(adapters); } catch (err) { process.stderr.write(`[agentdesk] 轮询失败: ${err.message}\n`); }
      view();
      if (frontmostSupported()) {
        await screen.sample();
        // 完成那一刻它就在你屏幕上、而且你已经看了一会儿：算看过
        if (seenOnScreen) for (const id of screen.toMarkSeen(tasks)) markSeen(id, 'screen');
      }
      const fired = newAlerts(alerts, tasks);
      alerts = alertsOf(tasks);
      // 就在你眼前的不弹通知、不推 webhook
      const loud = muteOnScreen ? fired.filter(t => !isOnScreen(t, screen.current)) : fired;
      push(frame({ notify: loud }));
      if (loud.length) fireWebhooks(cfg.webhooks, loud);
    } catch (err) {
      process.stderr.write(`[agentdesk] 刷新失败: ${err.stack || err.message}\n`);
    } finally {
      busy = false;
      if (again) { again = false; setImmediate(diff); }
    }
  }

  let debounce = null;
  const soon = (ms = 120) => { clearTimeout(debounce); debounce = setTimeout(diff, ms); };

  // 只认本机地址。不校验 Host 的话，DNS rebinding 能让任意网页读到任务标题、prompt 和路径
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const origins = new Set([...hosts].map(h => `http://${h}`));

  const server = createServer((req, res) => {
    if (!hosts.has(req.headers.host)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'POST') {
      // 写操作只收 JSON、只认面板自己：text/plain 的跨站请求不需要预检，任何网页都能替你标已读、拉起 app
      const origin = req.headers.origin;
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '') || (origin && !origins.has(origin))) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        let data = {};
        try { data = JSON.parse(body || '{}'); } catch { /* 坏请求当空 */ }
        const out = handlePost(url.pathname, data);
        res.writeHead(out ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(out || {}));
      });
      return;
    }

    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      const q = url.searchParams;
      const c = { id: q.get('client') || Math.random().toString(36).slice(2), cap: q.get('cap') || 'none', perm: q.get('perm') || 'default', compact: q.get('compact') === '1' };
      clients.set(res, c);
      // 新连接先给一份全量，不带提醒：一打开就把历史全弹一遍不合适
      res.write(`data: ${JSON.stringify(frame())}\n\n`);
      pushNotifier();                  // 负责弹通知的可能换人了
      req.on('close', () => { clients.delete(res); pushNotifier(); });
      return;
    }

    if (url.pathname === '/api/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ tasks, states: STATES }));
      return;
    }

    // 给 agentdesk test / status 用：通知到底有没有人在弹、已读信号能不能用
    if (url.pathname === '/api/health') {
      const n = notifier();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        clients: [...clients.values()].map(({ cap, perm, compact }) => ({ cap, perm, compact })),
        notifier: n ? { cap: n.cap, compact: n.compact } : null,
        signals: { claudeDesktopSessions: desktop.count, frontmost: frontmostSupported(), onScreen: screen.current },
      }));
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML());
      return;
    }
    res.writeHead(404).end();
  });

  function handlePost(path, data) {
    if (path === '/api/seen') {
      for (const id of Array.isArray(data.ids) ? data.ids : []) markSeen(String(id));
      soon(60);
      return {};
    }
    // 切到这个任务所在的 app。只认视图里已有的任务，拉起哪个 app 由 adapter 决定，不接受任意输入
    if (path === '/api/open') {
      const t = tasks.find(x => x.id === data.id);
      if (!t?.app) return { ok: false };
      if (process.platform === 'darwin') spawn('open', ['-a', t.app], { stdio: 'ignore', detached: true }).unref();
      return { ok: process.platform === 'darwin', app: t.app };
    }
    return null;
  }

  // 后台任务"还在不在跑"是异步查的，结果和先前的判断不一样就重算一次
  onHeldChange(() => soon(100));

  server.listen(port, '127.0.0.1', async () => {
    ensureHome();
    // 启动就先轮一次，否则打开面板要空等一个定时周期
    try { pollAll(adapters); } catch { /* 轮询失败不该拖住服务 */ }
    view();
    // 提醒基线要建在真实结果上：后台任务查询回来之前是按"在跑"临时算的，
    // 拿临时值当基线，查询一回来就会把一批早就完成的任务当成"刚完成"提醒一遍
    await heldSettled();
    view();
    // 和 diff 用的是同一个函数：重启不会把所有任务当成"新情况"再提醒一遍
    alerts = alertsOf(tasks);
    baselineReady();
    process.stdout.write(`\n  agentdesk 面板  →  http://localhost:${port}\n  事件日志        →  ${EVENTS_FILE}\n` +
      `  已读信号        →  Claude 桌面版 ${desktop.count} 个会话${frontmostSupported() ? '，前台检测可用' : ''}\n\n` +
      '  通知由悬浮窗（agentdesk panel）或点过「开启通知」的浏览器页面负责。\n  Ctrl+C 退出。\n\n');
  });

  // 监听目录而不是单个文件：首次安装时 events.jsonl 还不存在；轮转会把它改名
  try {
    watch(HOME, (_evt, filename) => {
      if (filename && !/^events(\.1)?\.jsonl$/.test(filename)) return;
      soon();
    });
  } catch (err) {
    process.stderr.write(`[agentdesk] 目录监听失败，退回轮询: ${err.message}\n`);
  }
  // 没有钩子的 agent：盯它们的数据文件，变了立刻处理，不等定时器
  const ws = watchSources(adapters, diff);
  if (ws.count) process.stdout.write(`  已监听 ${ws.count} 个数据源（codex / workbuddy 的状态变化会即时反映）\n\n`);
  // 你在 Claude 桌面版里点开一个会话，这里就知道它被看过了
  desktop.watch(() => soon(300));

  // 有 agent 在动、或者有东西等你时，每 2 秒看一眼前台：
  // 停留够久的算看过；你正看着的不重提醒。什么都不用管的时候不查
  if (frontmostSupported()) {
    setInterval(async () => {
      if (busy || !tasks.some(t => t.needs || t.state === 'running' || t.state === 'waiting')) return;
      const before = JSON.stringify(screen.current);
      await screen.sample();
      const ids = seenOnScreen ? screen.toMarkSeen(tasks) : [];
      for (const id of ids) markSeen(id, 'screen');
      if (ids.length) soon(60);
      else if (muteOnScreen && JSON.stringify(screen.current) !== before) push({ type: 'screen', onScreen: screen.current });
    }, 2000);
  }

  setInterval(diff, 20_000);
  return server;
}
