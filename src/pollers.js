// 有些 agent 根本没有钩子（GUI 应用、跑在别的进程里的 CLI），只能主动去读它的数据。
// 两种读法：追加型 jsonl（codex 的会话流）和 sqlite（workbuddy 的会话表）。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync, watch } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { append, HOME, ensureHome } from './store.js';
import { evalWhen, jsonPath, mapPayload } from './adapters.js';
import { expand } from './util.js';

// node:sqlite 目前只有 CommonJS 入口，ESM 里得借 require
const require = createRequire(import.meta.url);

const STATE_FILE = join(HOME, 'poll-state.json');
const FRESH_MS = 6 * 60 * 60 * 1000;    // 只回溯 6 小时内动过的会话，别把半年历史全灌进来
const KEEP_MS = 2 * FRESH_MS;           // 去重记录保留多久：超过这个时间的会话不会再被读到

// 常驻内存，只在内容变了的时候落盘。以前每次刷新都整份重写（97KB），
// WorkBuddy 写日志期间 30 秒写 16 次
let STATE = null;
let savedJSON = '';
function loadState() {
  if (STATE) return STATE;
  try { STATE = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { STATE = {}; }
  // 旧格式的去重记录是纯字符串，当成刚更新过，免得升级后被一次清空、把近期状态全重发一遍
  for (const k of ['last']) {
    for (const [id, v] of Object.entries(STATE[k] || {})) if (typeof v === 'string') STATE[k][id] = { s: v, at: Date.now() };
  }
  savedJSON = JSON.stringify(STATE);
  return STATE;
}
function saveIfChanged() {
  const s = JSON.stringify(STATE);
  if (s === savedJSON) return;
  ensureHome();
  try { writeFileSync(STATE_FILE, s); savedJSON = s; } catch { /* 存不下不影响本轮 */ }
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
const indexCache = new Map();
function loadIndex(def) {
  const cfg = def.index;
  if (!cfg) return null;
  const file = expand(cfg.file);
  let st;
  try { st = statSync(file); } catch { return null; }
  const hit = indexCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.map;
  const map = new Map();
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o[cfg.key]) map.set(o[cfg.key], o);
      } catch { /* 坏行跳过 */ }
    }
  } catch { return null; }
  indexCache.set(file, { mtime: st.mtimeMs, map });
  return map;
}

function emit(def, name, payload, st, now) {
  const ev = mapPayload(def, payload, def.name || name);
  if (!ev || ev.kind === 'ignore' || !ev.key) return 0;
  const id = `${ev.agent}:${ev.key}`;
  let n = 0;
  // 记"这个任务上次发的是什么"，而不是"这条发过没有"。
  // 用后者的话，状态来回切（completed → planning → completed）时后面的变化会被永久吞掉。
  const sig = `${ev.kind}:${(ev.summary || '').slice(0, 60)}`;
  st.last = st.last || {};
  const sent = st.last[id]?.s !== sig;
  if (sent) { append(ev); n++; }
  st.last[id] = { s: sig, at: now };

  // 读状态单独一条通道，不改状态、不刷新活动时间。不能塞进上面的签名：
  // 已读一翻就会再发一条 done，任务又变回未读、重新通知。
  // 状态事件刚发过的话，把当前已读值也跟着发一遍 —— done 会把任务重置成未读，
  // 而 app 那边的值可能压根没变（你正看着它完成）。
  if (def.read) {
    const value = evalWhen(payload, def.read);
    st.read = st.read || {};
    if (sent || st.read[id]?.v !== value) {
      append({ agent: ev.agent, key: ev.key, kind: 'read', value });
      n++;
    }
    st.read[id] = { v: value, at: now };
  }

  // 心跳：没有 transcript 的 agent 靠事件时间判失联，长任务中途没有状态变化就会被误报。
  if (def.heartbeat && ev.kind === 'start') {
    const v = Number(jsonPath(payload, def.heartbeat.field)) || 0;
    st.hb = st.hb || {};
    const prev = st.hb[id]?.v || 0;
    if (v > prev + (def.heartbeat.every ?? 60_000)) {
      if (prev && !sent) { append({ agent: ev.agent, key: ev.key, kind: 'heartbeat' }); n++; }
      st.hb[id] = { v, at: now };
    }
  }
  return n;
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
    const meta = JSON.parse(buf.toString('utf8', 0, n).split('\n')[0]);
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

function pollJsonl(def, name, st, now) {
  const idx = loadIndex(def);
  let n = 0;
  const offsets = st.offsets = st.offsets || {};
  const files = expandGlob(def.glob);
  for (const file of files) {
    let fst;
    try { fst = statSync(file); } catch { continue; }
    if (now - fst.mtimeMs > FRESH_MS) { offsets[file] = fst.size; continue; }
    const from = Math.min(offsets[file] ?? 0, fst.size);
    if (from >= fst.size) continue;
    // ChatGPT app 会为内部功能开一堆子代理会话，那不是你发起的任务。
    // 判定必须读文件真正的开头 —— 增量读到的第一行不是 session_meta。
    const verdict = sessionFilterVerdict(file, def);
    if (verdict === 'skip') { offsets[file] = fst.size; continue; }
    if (verdict === 'retry') continue;      // 别动 offset，下轮重读

    const len = fst.size - from;
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, len, from); } finally { closeSync(fd); }
    offsets[file] = fst.size;

    // 从文件名取会话 id：rollout-<时间>-<uuid>.jsonl
    const m = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const sess = m ? m[1] : file;
    const meta = idx?.get(sess) || {};

    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      o._session = sess;
      o._file = file;
      for (const [k, v] of Object.entries(def.index?.fields || {})) o['_' + k] = meta[v];
      n += emit(def, name, o, st, now);
    }
  }
  // 删掉的、归档走的会话文件，进度记录没必要留着
  const alive = new Set(files);
  for (const f of Object.keys(offsets)) if (!alive.has(f) && f.startsWith(expand(def.glob).split('/*')[0])) delete offsets[f];
  return n;
}

function pollSqlite(def, name, st, now) {
  const file = expand(def.db);
  if (!existsSync(file)) return 0;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return 0; }
  let db, rows = [];
  try {
    db = new DatabaseSync(file, { readOnly: true });
    rows = db.prepare(def.query).all(now - FRESH_MS);
  } catch { return 0; } finally { try { db?.close(); } catch {} }
  let n = 0;
  for (const r of rows) n += emit(def, name, r, st, now);
  return n;
}

export function pollAll(adapters, now = Date.now()) {
  const st = loadState();
  let total = 0;
  for (const [name, def] of Object.entries(adapters)) {
    try {
      if (def.source === 'watch-jsonl') total += pollJsonl(def, name, st, now);
      else if (def.source === 'sqlite') total += pollSqlite(def, name, st, now);
    } catch (err) {
      process.stderr.write(`[agentdesk] ${name} 轮询失败: ${err.message}\n`);
    }
  }
  // 去重记录按时间清理：比能被读到的时间窗口还老的，不会再用上
  for (const k of ['last', 'read', 'hb']) {
    for (const [id, v] of Object.entries(st[k] || {})) if (!v || now - (v.at || 0) > KEEP_MS) delete st[k][id];
  }
  saveIfChanged();
  return total;
}

// 盯什么、怎么过滤。单独拿出来是为了能测：以前 sqlite 源盯的是数据库所在的整个目录（递归），
// 在 ~/.workbuddy 上就是 2GB、8.4 万个文件，它写一行日志面板就重算一遍 —— 30 秒 15 次里有 13 次是这个。
export function watchPlan(def) {
  if (def.source === 'watch-jsonl' && def.glob) {
    // 盯 glob 里第一个 * 之前的那段固定路径，递归往下看，只认会话文件
    return { dir: expand(def.glob).split('/*')[0], recursive: true, match: n => n.endsWith('.jsonl') };
  }
  if (def.source === 'sqlite' && def.db) {
    // WAL 模式下真正频繁变的是 .db-wal，所以按前缀认：xxx.db / xxx.db-wal / xxx.db-shm
    const file = expand(def.db);
    const base = basename(file);
    return { dir: dirname(file), recursive: false, match: n => basename(n).startsWith(base) };
  }
  return null;
}

// 轮询的 20 秒延迟没必要忍。这些 agent 虽然没有钩子，但它们写文件 ——
// 盯住那些文件，就能把延迟压到亚秒级，效果等同钩子。
export function watchSources(adapters, onChange) {
  const plans = Object.values(adapters).map(watchPlan).filter(p => p && existsSync(p.dir));
  const watchers = [];
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 400); };
  for (const p of plans) {
    const cb = (_e, name) => { if (!name || p.match(String(name))) fire(); };
    try {
      watchers.push(watch(p.dir, { recursive: p.recursive }, cb));
    } catch (err) {
      // Linux 老内核不支持 recursive，退回非递归；再不行就只剩定时轮询兜底
      try { watchers.push(watch(p.dir, cb)); }
      catch { process.stderr.write(`[agentdesk] 监听 ${p.dir} 失败，该源退回轮询: ${err.message}\n`); }
    }
  }
  return { dirs: plans.map(p => p.dir), count: watchers.length, close: () => watchers.forEach(w => { try { w.close(); } catch {} }) };
}
