// 有些 agent 根本没有钩子（GUI 应用、跑在别的进程里的 CLI），只能主动去读它的数据。
// 两种读法：追加型 jsonl（codex 的会话流）和 sqlite（workbuddy 的会话表）。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { append, HOME, ensureHome } from './store.js';
import { evalWhen, jsonPath, isMachineText } from './adapters.js';

// node:sqlite 目前只有 CommonJS 入口，ESM 里得借 require
const require = createRequire(import.meta.url);

const STATE_FILE = join(HOME, 'poll-state.json');
const FRESH_MS = 6 * 60 * 60 * 1000;    // 只回溯 6 小时内动过的会话，别把半年历史全灌进来

const expand = p => p.replace(/^~/, homedir());

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  ensureHome();
  try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch { /* 存不下不影响本轮 */ }
}

// 把 glob 里的 * 展开成实际路径，只支持每段一个 *，够用且不引依赖
function expandGlob(pattern) {
  const parts = expand(pattern).split('/');
  let paths = [parts[0] || '/'];
  for (const seg of parts.slice(1)) {
    if (!seg) continue;
    if (!seg.includes('*')) {
      paths = paths.map(p => join(p, seg)).filter(existsSync);
      continue;
    }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const next = [];
    for (const p of paths) {
      try {
        for (const name of readdirSync(p)) if (re.test(name)) next.push(join(p, name));
      } catch { /* 不可读就跳过 */ }
    }
    paths = next;
  }
  return paths;
}

// adapter 声明的外部索引：codex 的会话标题在 session_index.jsonl 里，不在会话流里
function loadIndex(def) {
  const cfg = def.index;
  if (!cfg) return null;
  const file = expand(cfg.file);
  if (!existsSync(file)) return null;
  const map = new Map();
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        const k = o[cfg.key];
        if (k) map.set(k, o);
      } catch { /* 坏行跳过 */ }
    }
  } catch { return null; }
  return map;
}

function emit(def, name, payload, state) {
  const rule = (def.rules || []).find(r => evalWhen(payload, r.when));
  if (!rule || rule.kind === 'ignore') return false;
  const map = { ...(def.map || {}), ...(rule.map || {}) };
  const ev = { agent: def.name || name, kind: rule.kind, confidence: def.confidence || 'exact' };
  // 纠正型事件：只用来把状态推回正轨，不该让任务重新变成未读（见 store.js 里 seen 的处理）
  if (rule.auto) ev.auto = true;
  for (const [f, expr] of Object.entries(map)) {
    const v = jsonPath(payload, expr);
    if ((f === 'summary' || f === 'prompt') && isMachineText(v)) continue;
    if (v !== undefined && v !== null && v !== '') {
      ev[f] = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, f === 'title' ? 70 : 160) : String(v);
    }
  }
  if (!ev.key) return false;
  // 记"这个任务上次发的是什么"，而不是"这条发过没有"。
  // 用后者的话，状态来回切（completed → planning → completed）时后面的变化会被永久吞掉。
  const id = `${ev.agent}:${ev.key}`;
  const sig = `${ev.kind}:${(ev.summary || '').slice(0, 60)}`;
  state.last = state.last || {};
  if (state.last[id] === sig) return false;
  state.last[id] = sig;
  append(ev);
  return true;
}

const filterCache = new Map();
const retryCount = new Map();

// 三态，不能只有"过"和"不过"：
//   pass  —— 确认是你发起的会话
//   skip  —— 确认是内部子代理，整个文件跳过
//   retry —— 头还没落盘，本轮什么都别做，下轮再判
// 早先把 retry 当 pass 处理，结果新会话在头写入前就被放行、事件已经进库，
// 等下一轮判出是 subagent 已经晚了 —— 写进去的事件不会回滚。
function sessionFilterVerdict(file, def) {
  if (!def.session_filter) return 'pass';
  const cached = filterCache.get(file);
  if (cached !== undefined) return cached ? 'pass' : 'skip';
  try {
    const buf = Buffer.alloc(8192);
    const fd = openSync(file, 'r');
    let n = 0;
    try { n = readSync(fd, buf, 0, 8192, 0); } finally { closeSync(fd); }
    const head = buf.toString('utf8', 0, n).split('\n')[0];
    const meta = JSON.parse(head);
    if (meta?.type === 'session_meta') {
      const ok = evalWhen(meta, def.session_filter);
      filterCache.set(file, ok);
      return ok ? 'pass' : 'skip';
    }
  } catch { /* 头还没落盘 */ }
  // 一直读不出会话头的文件（格式不符），重试几轮后放行，免得永远卡住
  const n = (retryCount.get(file) || 0) + 1;
  retryCount.set(file, n);
  if (n > 5) { filterCache.set(file, true); return 'pass'; }
  return 'retry';
}

function pollJsonl(def, name, state) {
  const idx = loadIndex(def);
  let n = 0;
  const offsets = state.offsets = state.offsets || {};
  for (const file of expandGlob(def.glob)) {
    let st;
    try { st = statSync(file); } catch { continue; }
    if (Date.now() - st.mtimeMs > FRESH_MS) { offsets[file] = st.size; continue; }
    const from = Math.min(offsets[file] ?? 0, st.size);
    if (from >= st.size) continue;
    // ChatGPT app 会为内部功能（生成活动摘要、个性化建议）开一堆子代理会话，
    // 那不是你发起的任务。判定必须读文件真正的开头 —— 增量读到的第一行不是
    // session_meta，早先那版就是栽在这里，过滤形同虚设。
    const verdict = sessionFilterVerdict(file, def);
    if (verdict === 'skip') { offsets[file] = st.size; continue; }
    if (verdict === 'retry') continue;      // 别动 offset，下轮重读

    const len = st.size - from;
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, len, from); } finally { closeSync(fd); }
    offsets[file] = st.size;

    // 从文件名取会话 id：rollout-<时间>-<uuid>.jsonl
    const m = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const sess = m ? m[1] : file;
    const meta = idx?.get(sess) || {};

    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      o._session = sess;
      o._file = file;
      for (const [k, v] of Object.entries(def.index?.fields || {})) o['_' + k] = meta[v];
      if (emit(def, name, o, state)) n++;
    }
  }
  return n;
}

function pollSqlite(def, name, state) {
  const file = expand(def.db);
  if (!existsSync(file)) return 0;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return 0; }
  let db, rows = [];
  try {
    db = new DatabaseSync(file, { readOnly: true });
    rows = db.prepare(def.query).all(Date.now() - FRESH_MS);
  } catch { return 0; } finally { try { db?.close(); } catch {} }
  let n = 0;
  for (const r of rows) if (emit(def, name, r, state)) n++;
  return n;
}

export function pollAll(adapters) {
  const state = loadState();
  let total = 0;
  for (const [name, def] of Object.entries(adapters)) {
    try {
      if (def.source === 'watch-jsonl') total += pollJsonl(def, name, state);
      else if (def.source === 'sqlite') total += pollSqlite(def, name, state);
    } catch (err) {
      process.stderr.write(`[agentdesk] ${name} 轮询失败: ${err.message}\n`);
    }
  }
  // 别无限长
  if (state.last && Object.keys(state.last).length > 4000) state.last = {};
  saveState(state);
  return total;
}


// 轮询的 20 秒延迟没必要忍。这些 agent 虽然没有钩子，但它们写文件 ——
// 盯住那些文件，就能把延迟压到亚秒级，效果等同钩子。
export function watchSources(adapters, onChange) {
  const dirs = new Set();
  for (const def of Object.values(adapters)) {
    if (def.source === 'watch-jsonl' && def.glob) {
      // 盯 glob 里第一个 * 之前的那段固定路径，递归往下看
      const fixed = expand(def.glob).split('/*')[0];
      if (existsSync(fixed)) dirs.add(fixed);
    } else if (def.source === 'sqlite' && def.db) {
      // sqlite 是 WAL 模式，真正频繁变的是 .db-wal，盯目录能一起覆盖
      const d = dirname(expand(def.db));
      if (existsSync(d)) dirs.add(d);
    }
  }

  const watchers = [];
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 400); };

  for (const d of dirs) {
    try {
      watchers.push(watch(d, { recursive: true }, fire));
    } catch (err) {
      // Linux 老内核不支持 recursive，退回非递归；再不行就只剩定时轮询兜底
      try { watchers.push(watch(d, fire)); }
      catch { process.stderr.write(`[agentdesk] 监听 ${d} 失败，该源退回轮询: ${err.message}\n`); }
    }
  }
  return { dirs: [...dirs], count: watchers.length, close: () => watchers.forEach(w => { try { w.close(); } catch {} }) };
}
