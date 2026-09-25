// claude code 的后台任务没有专属钩子，但不管谁起的（Bash 的 run_in_background、子 agent），
// 都会在 <tmp>/claude-<uid>/<项目>/<会话>/tasks/ 下开一个 .output，跑完往末尾写 [exited with code N]。
// 这是确定性信号，不是靠静默时间猜的。
//
// 注意前台命令跑的时候也会在这里开 .output（跑完就删）。哪些是真后台，由 transcript 决定，见 view 层。
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EXIT_RE = /\[exited with code (-?\d+)\]/;
const INDEX_TTL = 10_000;

const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };

function roots() {
  if (process.env.AGENTDESK_CLAUDE_TMP) return process.env.AGENTDESK_CLAUDE_TMP.split(':').filter(Boolean);
  const out = new Set();
  for (const base of ['/tmp', tmpdir()]) {
    try {
      for (const d of readdirSync(base)) {
        const p = join(base, d);
        // /tmp 下也有 claude- 开头的普通文件，别当目录扫
        if (d.startsWith('claude-') && isDir(p)) {
          try { out.add(realpathSync(p)); } catch { out.add(p); }
        }
      }
    } catch { /* 目录不存在就跳过 */ }
  }
  return [...out];
}

// 会话 -> tasks 目录。整张表定期重建，而不是按会话缓存"找没找到"：
// tasks/ 要等会话起第一个后台任务才建，以前把"没找到"永久缓存，
// 服务启动之后新开的会话就再也检测不到后台任务了（服务跑 14 天，新会话全是 bg: {}）。
let index = { at: -Infinity, map: new Map() };
export function tasksDirOf(sessionId, now = Date.now()) {
  if (now - index.at >= INDEX_TTL) {
    const map = new Map();
    for (const r of roots()) {
      let projs = [];
      try { projs = readdirSync(r); } catch { continue; }
      for (const proj of projs) {
        let sess = [];
        try { sess = readdirSync(join(r, proj)); } catch { continue; }
        for (const s of sess) {
          const p = join(r, proj, s, 'tasks');
          if (!map.has(s) && existsSync(p)) map.set(s, p);
        }
      }
    }
    index = { at: now, map };
  }
  return index.map.get(sessionId) || null;
}

function readTail(path, size, n = 4096) {
  const len = Math.min(size, n);
  if (!len) return '';
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  return buf.toString('utf8');
}

// 退出码只看文件尾，文件没变就不用再读
const exitCache = new Map();
function exitCodeOf(path, st) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = exitCache.get(path);
  if (hit && hit.key === key) return hit.code;
  const m = readTail(path, st.size).match(EXIT_RE);
  const code = m ? Number(m[1]) : null;
  if (exitCache.size > 2000) exitCache.clear();
  exitCache.set(path, { key, code });
  return code;
}

// 返回 { id: { running, exit_code, since } }
export function scanBackground(sessionId, now = Date.now()) {
  const dir = tasksDirOf(sessionId, now);
  if (!dir) return {};
  let names = [];
  try { names = readdirSync(dir); } catch { return {}; }
  const out = {};
  for (const f of names) {
    if (!f.endsWith('.output')) continue;
    const full = join(dir, f);
    let st;
    try { st = statSync(full); } catch { continue; }
    const code = exitCodeOf(full, st);
    // 有退出标记就是确定结束了。没有标记不等于还在跑 ——
    // 进程被杀、客户端崩溃、终端关掉，都不会留下标记，文件会永远停在那儿。
    out[f.slice(0, -'.output'.length)] = {
      running: code === null && stillHeld(full, st, now),
      exit_code: code,
      since: st.mtimeMs,
    };
  }
  return out;
}

// 文件还被进程打开着，才算真的在跑。这是确定性判据，不是"多久没动"那种猜测。
//
// lsof 一次约 260ms。以前是逐个同步调用、结果只缓存 20 秒 —— 正好等于定时刷新的间隔，
// 于是每 20 秒整个服务被卡住 3 秒多（实测 12 个文件 3160ms），期间事件、通知全部停摆。
// 现在：异步批量一次查完，从不阻塞；查询结果回来之前按"还在跑"算 ——
// 宁可让「完成」晚到几百毫秒，也不能先报完成再撤回。
const heldCache = new Map();    // path -> { key, held, at }
const HELD_TTL = 60_000;        // "有人持有"要定期复查；"没人持有"只要文件没变就永久有效
const ZOMBIE_AFTER = 2 * 60 * 60 * 1000;   // 超过这么久没输出，不再当作在跑
const queued = new Map();       // path -> 视图当时用的是什么值
let checking = null;            // 正在跑的那次批量查询
let onUpdate = () => {};

// 查询结果和之前的判断不一样时回调（server 用它触发一次刷新）
export function onHeldChange(fn) { onUpdate = fn; }

// 等手上的查询都跑完（启动时用：初始的提醒基线要建立在真实结果上，而不是"先按在跑算"的临时值）
export async function heldSettled() {
  while (checking) await checking;
}

function stillHeld(path, st, now) {
  const idle = now - st.mtimeMs;
  if (idle < 5000) return true;              // 刚写过，必然在跑
  if (idle > ZOMBIE_AFTER) return false;     // 这么久没动，查了也是白查
  // Windows 上没有免安装的可靠办法，退回时间判据
  if (process.platform === 'win32') return idle < 10 * 60 * 1000;

  const key = `${st.mtimeMs}:${st.size}`;
  const hit = heldCache.get(path);
  if (hit && hit.key === key && (!hit.held || now - hit.at < HELD_TTL)) return hit.held;
  // 过期的"有人持有"沿用到新结果回来；没查过的、文件变过的，先按在跑算
  const assumed = hit && hit.key === key ? hit.held : true;
  queued.set(path, assumed);
  if (!checking) checking = new Promise(r => setImmediate(r)).then(runChecks);
  return assumed;
}

function lsof(paths) {
  // 退出码 1 只表示"有的文件没人打开"，输出照样有效
  return new Promise(resolve => execFile('lsof', ['-F', 'n', '--', ...paths], { encoding: 'utf8', timeout: 10_000 },
    (_err, out) => resolve(new Set(String(out || '').split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1))))));
}

async function runChecks() {
  try {
    while (queued.size) {
      const batch = [...queued];
      queued.clear();
      const open = await lsof(batch.map(([p]) => p));
      const now = Date.now();
      let changed = false;
      for (const [p, assumed] of batch) {
        let st, real;
        try { st = statSync(p); real = realpathSync(p); } catch { heldCache.delete(p); changed = true; continue; }
        // lsof 报的是解析过符号链接的真实路径（/tmp → /private/tmp）
        const held = open.has(p) || open.has(real);
        if (held !== assumed) changed = true;
        heldCache.set(p, { key: `${st.mtimeMs}:${st.size}`, held, at: now });
      }
      if (heldCache.size > 2000) heldCache.clear();
      if (changed) onUpdate();
    }
  } finally {
    checking = null;
  }
}
