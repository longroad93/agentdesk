// claude code 的后台任务没有专属钩子，但它会把 [exited with code N] 写进 output 文件末尾。
// 这是确定性信号，不是靠静默时间猜的。
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
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
    out[f.replace(/\.output$/, '')] = {
      running: !m,
      exit_code: m ? Number(m[1]) : null,
      since: st.mtimeMs,
    };
  }
  return out;
}
