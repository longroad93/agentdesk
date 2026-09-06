// claude code 的后台任务没有专属钩子，但它会把 [exited with code N] 写进 output 文件末尾。
// 这是确定性信号，不是靠静默时间猜的。
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { append } from './store.js';

const EXIT_RE = /\[exited with code (-?\d+)\]/;
const BG_MAX_AGE = 4 * 60 * 60 * 1000;   // 找不到就挂着不合适，4 小时后放弃
const pathCache = new Map();

function roots() {
  const out = [];
  for (const base of ['/tmp', tmpdir()]) {
    try {
      for (const d of readdirSync(base)) if (d.startsWith('claude-')) out.push(join(base, d));
    } catch { /* 目录不存在就跳过 */ }
  }
  return out;
}

function findOutput(sessionId, bgId) {
  const ck = `${sessionId}:${bgId}`;
  const hit = pathCache.get(ck);
  if (hit && existsSync(hit)) return hit;
  for (const root of roots()) {
    try {
      for (const proj of readdirSync(root)) {
        const p = join(root, proj, sessionId, 'tasks', `${bgId}.output`);
        if (existsSync(p)) { pathCache.set(ck, p); return p; }
      }
    } catch { /* 权限或并发删除 */ }
  }
  return null;
}

function readTail(path, n = 4096) {
  const size = statSync(path).size;
  const len = Math.min(size, n);
  if (!len) return '';
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  return buf.toString('utf8');
}

export function sweepBackground(tasks, now = Date.now()) {
  let found = 0;
  for (const t of tasks) {
    for (const [bgId, info] of Object.entries(t.bg || {})) {
      const p = findOutput(t.key, bgId);
      if (!p) {
        if (now - (info.since || 0) > BG_MAX_AGE) {
          append({ agent: t.agent, key: t.key, kind: 'bg_done', bg_id: bgId, exit_code: 0 });
          found++;
        }
        continue;
      }
      const m = readTail(p).match(EXIT_RE);
      if (m) {
        append({ agent: t.agent, key: t.key, kind: 'bg_done', bg_id: bgId, exit_code: Number(m[1]) });
        pathCache.delete(`${t.key}:${bgId}`);
        found++;
      }
    }
  }
  return found;
}

// 靠 PostToolUse 捕获后台任务是不够的：只有 Bash 的 run_in_background 会带
// backgroundTaskId，子 agent 那类根本不经过它。但不管谁起的后台任务，
// claude code 都会在 <tmp>/<项目>/<session>/tasks/ 下开一个 .output 文件，
// 跑完往末尾写 [exited with code N]。直接扫这个目录，来源无关。
const dirCache = new Map();

function tasksDirOf(sessionId) {
  const hit = dirCache.get(sessionId);
  if (hit !== undefined && (hit === null || existsSync(hit))) return hit;
  for (const root of roots()) {
    try {
      for (const proj of readdirSync(root)) {
        const p = join(root, proj, sessionId, 'tasks');
        if (existsSync(p)) { dirCache.set(sessionId, p); return p; }
      }
    } catch { /* 权限或并发删除 */ }
  }
  dirCache.set(sessionId, null);
  return null;
}

// 返回 { taskId: { running, exit_code, since } }
export function scanBackground(sessionId) {
  const dir = tasksDirOf(sessionId);
  if (!dir) return {};
  const out = {};
  let names = [];
  try { names = readdirSync(dir); } catch { return {}; }
  for (const f of names) {
    if (!f.endsWith('.output')) continue;
    const full = join(dir, f);
    let st;
    try { st = statSync(full); } catch { continue; }
    const m = readTail(full).match(EXIT_RE);
    // 有退出标记就是确定结束了。没有标记不等于还在跑 ——
    // 进程被杀、客户端崩溃、终端关掉，都不会留下标记，文件会永远停在那儿。
    // 实测有 10 天没动的文件仍被当成"后台跑着"，19 个里 0 个是真的。
    const running = m ? false : stillHeld(full, st);
    out[f.replace(/\.output$/, '')] = {
      running,
      exit_code: m ? Number(m[1]) : null,
      since: st.mtimeMs,
    };
  }
  return out;
}


// 文件还被进程打开着，才算真的在跑。这是确定性判据，不是"多久没动"那种猜测。
const heldCache = new Map();
const HELD_TTL = 20_000;
const ZOMBIE_AFTER = 2 * 60 * 60 * 1000;   // 超过这么久没输出，不再当作在跑

function stillHeld(path, st) {
  const idle = Date.now() - st.mtimeMs;
  // lsof 一次约 200ms，几十个文件就是好几秒，不能每个都查。
  // 两头用时间粗筛掉，只有中间地带才值得付这个代价：
  if (idle < 5000) return true;              // 刚写过，必然在跑
  if (idle > ZOMBIE_AFTER) return false;     // 这么久没动，查了也是白查

  const key = `${path}:${st.mtimeMs}:${st.size}`;
  const hit = heldCache.get(key);
  if (hit && Date.now() - hit.at < HELD_TTL) return hit.held;

  let held = false;
  if (process.platform === 'win32') {
    // Windows 上没有免安装的可靠办法，退回时间判据
    held = Date.now() - st.mtimeMs < 10 * 60 * 1000;
  } else {
    try {
      execFileSync('lsof', ['-t', path], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
      held = true;                       // lsof 有输出 = 有进程持有
    } catch {
      held = false;                      // 退出码非 0 = 没人持有它
    }
  }
  // 缓存下来，否则每轮 snapshot 都要为每个文件付一次 lsof 的开销
  heldCache.set(key, { held, at: Date.now() });
  if (heldCache.size > 500) heldCache.clear();
  return held;
}
