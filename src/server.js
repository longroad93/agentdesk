// 一个进程干完所有事：HTTP、SSE 推送、超时扫描、webhook。不需要 launchd / 计划任务。
import { createServer } from 'node:http';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, existsSync } from 'node:fs';
import { loadEvents, project, loadConfig, EVENTS_FILE, HOME, ensureHome, append, byUrgency } from './store.js';
import { STATES, ATTENTION, needsAttention } from './states.js';
import { Script } from 'node:vm';
import { renderHTML } from './ui.js';
import { sweepBackground, scanBackground } from './bgwatch.js';
import { pollAll, watchSources } from './pollers.js';
import { foregroundAgents, matchedTasks, resetDwell, ensureHelper } from './foreground.js';
import { loadAdapters } from './adapters.js';

// 前端 JS 是字符串拼出来的，转义写错会在浏览器里静默炸掉、页面一片空白。
// 启动时先编译一遍，坏了当场报，别等用户打开页面才发现。
function assertUICompiles() {
  const js = renderHTML({ port: 0 }).split('<script>')[1]?.split('</script>')[0] || '';
  try {
    new Script(js);
  } catch (err) {
    process.stderr.write(`\n[agentdesk] 面板 JS 有语法错误，页面会是空白:\n  ${err.message}\n\n`);
    process.exit(1);
  }
}

const SELF_DIR = pathJoin(dirname(fileURLToPath(import.meta.url)), '..');

const BUILD = String(Date.now());

export function serve({ port } = {}) {
  assertUICompiles();
  ensureHome();
  const cfg = loadConfig();
  port = port || cfg.port || 4517;

  let clients = new Set();
  let lastSnapshot = new Map();   // id -> `state:seen`，用来判断"变了才推通知"

  function snapshot() {
    const tasks = project(loadEvents(), { timeouts: cfg.timeouts, retention: cfg.retention });
    for (const t of tasks) {
      // 后台任务不看事件看目录：子 agent 那类根本不经过 PostToolUse，
      // 但只要起了后台任务就一定有 .output 文件。扫描是幂等的，跑完自己就变回 done。
      // 这个目录结构是 claude code 特有的，别的 agent 扫了也是白扫。
      if (t.agent !== 'claude') continue;
      const bg = scanBackground(t.key);
      const running = {};
      for (const [id, v] of Object.entries(bg)) if (v.running) running[id] = v;
      t.bg = running;
      const hasBg = Object.keys(running).length > 0;
      // 必须双向：只升不降的话，后台跑完了状态还挂在"后台跑着"上下不来
      if (hasBg && (t.state === 'done' || t.state === 'idle')) t.state = 'bgrun';
      else if (!hasBg && t.state === 'bgrun') t.state = 'done';
    }
    // 上面改过 state（done → bgrun），排序是 project 里按旧状态做的，得重来一次
    tasks.sort(byUrgency);
    return tasks.map(t => ({ ...t, needs: needsAttention(t) }));
  }

  // 只推状态真正发生变化的任务，避免面板刷一次就重复弹通知
  const adapters = loadAdapters();

  function diffAndBroadcast() {
    let tasks = snapshot();
    // 没有钩子的 agent 靠轮询：codex 读会话流，workbuddy 读它的 sqlite。
    // 后台任务结束也没有钩子，同样只能主动探。任一有产出就重新投影。
    const changedByPoll = pollAll(adapters) + sweepBackground(tasks);
    if (changedByPoll) tasks = snapshot();
    const changed = [];
    for (const t of tasks) {
      // 签名里带上标题和后台数：会话标题是后来才生成的，后台任务数也会变，
      // 只看 state:seen 的话这些变化要等 20 秒定时器才推到面板
      const sig = `${t.state}:${t.seen}:${t.title}:${Object.keys(t.bg || {}).length}`;
      if (lastSnapshot.get(t.id) !== sig) {
        changed.push(t);
        lastSnapshot.set(t.id, sig);
      }
    }
    for (const id of [...lastSnapshot.keys()]) {
      if (!tasks.find(t => t.id === id)) lastSnapshot.delete(id);
    }
    push({ type: 'sync', tasks, changed, states: STATES, attention: ATTENTION, foreground: fgAgents, build: BUILD });
    if (changed.length) fireWebhooks(cfg, changed);
  }

  function push(data) {
    const frame = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(frame); } catch { clients.delete(res); }
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      clients.add(res);
      // 新连接先给一份全量，changed 为空避免一打开就把历史全弹一遍
      res.write(`data: ${JSON.stringify({ type: 'sync', tasks: snapshot(), changed: [], states: STATES, attention: ATTENTION, foreground: fgAgents, build: BUILD })}\n\n`);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ tasks: snapshot(), states: STATES }));
    }

    if (url.pathname === '/api/seen' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { ids } = JSON.parse(body || '{}');
          for (const id of ids || []) {
            const i = String(id).indexOf(':');
            if (i > 0) append({ agent: id.slice(0, i), key: id.slice(i + 1), kind: 'seen' });
          }
        } catch { /* 坏请求忽略 */ }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        setTimeout(diffAndBroadcast, 60);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHTML({ port }));
  });

  server.listen(port, '127.0.0.1', () => {
    ensureHome();
    lastSnapshot = new Map(snapshot().map(t => [t.id, `${t.state}:${t.seen}`]));
    // 启动就先轮一次，否则打开面板要空等一个定时周期
    try { pollAll(adapters); } catch { /* 轮询失败不该拖住服务 */ }
    // 必须和 diffAndBroadcast 里的 sig 同构，否则重启后第一次 diff 会把所有任务判成"变了"，全推一遍通知
    lastSnapshot = new Map(snapshot().map(t => [t.id, `${t.state}:${t.seen}`]));
    process.stdout.write(`\n  agentdesk 面板  →  http://localhost:${port}\n  事件日志        →  ${EVENTS_FILE}\n\n  第一次打开请点「允许通知」，否则只有标签页标题会变。\n  Ctrl+C 退出。\n\n`);
  });

  // 监听目录而不是单个文件。首次安装时 events.jsonl 还不存在，盯文件等于没盯；
  // 而且日志轮转会重写文件，单文件句柄会失效。
  let debounce = null;
  try {
    watch(HOME, (_evt, filename) => {
      if (filename && filename !== 'events.jsonl') return;
      clearTimeout(debounce);
      debounce = setTimeout(diffAndBroadcast, 120);
    });
  } catch (err) {
    process.stderr.write(`[agentdesk] 目录监听失败，退回轮询: ${err.message}\n`);
  }
  // 没有钩子的 agent：盯它们的数据文件，变了立刻处理，不等定时器
  const ws = watchSources(adapters, diffAndBroadcast);
  if (ws.count) process.stdout.write(`  已监听 ${ws.count} 个数据源目录（codex / workbuddy 的状态变化会即时反映）\n\n`);

  // 前台检测两件事，边界很清楚：
  //   1. 静音 —— 只需 app 名，你开着 claude 时它的通知不吵你（未读标记原样保留）
  //   2. 已读 —— 必须从窗口标题认出具体是哪个会话，认不出就什么都不做。
  // 绝不因为"你打开了 Claude"就把 3 个并行会话全标成已读，那正是本工具要防的事故。
  let fgAgents = [];
  if (cfg.muteForegroundAgent !== false) {
    ensureHelper(SELF_DIR);
    setInterval(() => {
      const tasks = snapshot();
      if (!tasks.some(t => t.needs)) { resetDwell(); if (fgAgents.length) { fgAgents = []; push({ type: 'foreground', agents: fgAgents }); } return; }

      const { agents } = foregroundAgents(adapters);
      if (agents.join() !== fgAgents.join()) { fgAgents = agents; push({ type: 'foreground', agents: fgAgents }); }

      if (cfg.sessionLevelSeen === false) return;
      const unread = tasks.filter(t => t.state === 'done' && t.seen === false);
      const hit = matchedTasks(unread, adapters);
      if (!hit.length) return;
      for (const id of hit) {
        const i = id.indexOf(':');
        append({ agent: id.slice(0, i), key: id.slice(i + 1), kind: 'seen' });
      }
      diffAndBroadcast();
    }, 3000);
  }

  setInterval(diffAndBroadcast, 20_000);

  return server;
}

async function fireWebhooks(cfg, changed) {
  for (const hook of cfg.webhooks || []) {
    for (const task of changed) {
      if (hook.on && !hook.on.includes(task.state)) continue;
      const render = obj => JSON.parse(
        JSON.stringify(obj).replace(/\{\{(\w+)\}\}/g, (_, k) =>
          String(task[k] ?? STATES[task.state]?.label ?? '').replace(/["\\]/g, ''))
      );
      try {
        await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(render(hook.body || { text: '{{agent}} {{title}}' })),
        });
      } catch (err) {
        process.stderr.write(`[agentdesk] webhook 失败: ${err.message}\n`);
      }
    }
  }
}
