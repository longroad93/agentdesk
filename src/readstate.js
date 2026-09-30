// 已读以 agent 自己的记录为准：你在哪个 app 的哪个会话里看过，它们自己记着。
//
// 以前靠一个 AppleScript 小程序读窗口标题去猜，那要辅助功能/自动化授权 ——
// 实测授权一直没拿到，它每 2 秒往 foreground.txt 里写一条报错，会话级已读和"开着就不打扰"从没生效过。
// 现在两样东西都不需要任何授权：
//   · 哪个会话看过 —— Claude 桌面版自己记的 lastFocusedAt、Codex 桌面版自己记的未读列表
//     （WorkBuddy 的 unread 列走 adapter 的 read 通道）
//   · 前台是哪个 app —— lsappinfo（问的是 LaunchServices，不走 Apple 事件）
import { readdirSync, readFileSync, statSync, watch, openSync, readSync, closeSync } from 'node:fs';
import { join, delimiter, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

// 桌面版的数据目录跟着登录方式走（规则照 Claude.app 2.9939 自己的代码，不是猜的）：
//   · 官方账号        —— <appData>/Claude
//   · 第三方模型 3p   —— 默认目录名后面接 -3p；Windows 上放在 %LOCALAPPDATA%\Claude-3p（不在 APPDATA）
//   · CLAUDE_USER_DATA_DIR 设了 —— 两种模式都直接用它
// 钩子里的 entrypoint 也跟着变：claude-desktop / claude-desktop-3p。
// 以前只读 Claude/：切到 API 登录的人新会话全在 Claude-3p/ 下，已读信号一条都拿不到，
// 而 status 里显示的是老目录的会话数，看起来一切正常。现在所有可能的位置都读，不存在的跳过；
// 切来切去、两边都有历史会话也没关系 —— 会话 id 不重复，按 id 取最近的 lastFocusedAt
export function claudeSessionsDirs(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AGENTDESK_CLAUDE_SESSIONS) return env.AGENTDESK_CLAUDE_SESSIONS.split(delimiter).filter(Boolean);
  const S = 'claude-code-sessions';
  const dirs = [];
  if (env.CLAUDE_USER_DATA_DIR) dirs.push(join(env.CLAUDE_USER_DATA_DIR, S));
  const root = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.APPDATA || join(home, 'AppData', 'Roaming'))
    : (env.XDG_CONFIG_HOME || join(home, '.config'));
  dirs.push(join(root, 'Claude', S), join(root, 'Claude-3p', S));
  if (platform === 'win32' && env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Claude-3p', S));
  return [...new Set(dirs)];
}

// 钩子上报的 CLAUDE_USER_DATA_DIR（adapter 的 env 映射进事件）。服务是 launchd 起的，
// 自己的环境里没有这个变量；但桌面版继承了它的话，每个钩子进程都有 —— 从事件里捡回来
export function claudeUserDataSessions(events) {
  const out = new Set();
  for (const e of events) {
    if (e.agent === 'claude' && typeof e.user_data_dir === 'string' && e.user_data_dir) out.add(join(e.user_data_dir, 'claude-code-sessions'));
  }
  return [...out];
}

// status / 服务启动时那一行：读到了多少会话、来自哪个目录。
// 只写"多少个会话"的话，切到 3p 之后读的还是老目录也看不出来 —— 以前就是这样
export function describeClaudeDirs(desktop) {
  if (!desktop.count) return '读不到（会退回"回话 / 点击才算已读"）';
  const names = desktop.activeDirs.map(d => basename(dirname(d)));
  return `${desktop.count} 个会话（${names.join(' + ')}）`;
}

// 这个入口是不是桌面版（官方账号或 3p）。"打开 ↗"、已读判定都靠它分出桌面版会话和 CLI / claude -p
export const isClaudeDesktop = (entrypoint) => typeof entrypoint === 'string' && /^claude-desktop(-|$)/.test(entrypoint);

// Claude 桌面版的每个会话一个 local_<id>.json，里面有 cliSessionId（= 钩子里的 session_id）
// 和 lastFocusedAt（点开 / 切到这个会话的时间）。它只在切换时写，停在上面看不会刷新，
// 所以"完成那一刻它就在你屏幕上"要另外判断，见 server.js 的 onScreen。
//
// 这是桌面版的私有格式，升级可能会变。读不到就当没有这个信号，退回原来的判定，
// 并在 agentdesk status 里显示出来 —— 别让它悄悄坏掉。
export function createDesktopFocus(dirs = claudeSessionsDirs(), { rescanMs = 60_000 } = {}) {
  dirs = [...new Set([].concat(dirs))];
  const byFile = new Map();     // file -> { id, focusedAt, archived }
  let loaded = false;
  const watched = new Map();    // dir -> FSWatcher
  let onChangeCb = null;

  function readOne(file) {
    try {
      const o = JSON.parse(readFileSync(file, 'utf8'));
      if (o && typeof o.cliSessionId === 'string') {
        const rec = { id: o.cliSessionId, focusedAt: Number(o.lastFocusedAt) || 0, archived: o.isArchived === true };
        byFile.set(file, rec);
        return rec;
      }
    } catch { /* 写到一半、被删 */ }
    byFile.delete(file);
    return null;
  }

  function walk(d, depth, out) {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1, out);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
    }
    return out;
  }

  function load() {
    byFile.clear();
    for (const d of dirs) for (const f of walk(d, 0, [])) readOne(f);
    loaded = true;
  }
  const ensure = () => { if (!loaded) load(); };

  // 目录这一刻不存在很正常（还没用过 3p，或者反过来）。之后才出现的 —— 比如服务起来以后你才第一次
  // 换成 API 登录 —— 要能补上，不然得重启服务才认得新目录
  function attach(dir) {
    if (!onChangeCb || watched.has(dir)) return false;
    try {
      watched.set(dir, watch(dir, { recursive: true }, (_e, name) => {
        if (!name || !String(name).endsWith('.json')) return;
        const file = join(dir, String(name));
        const before = byFile.get(file)?.focusedAt;
        if (readOne(file)?.focusedAt !== before) onChangeCb();
      }));
    } catch { return false; }
    for (const f of walk(dir, 0, [])) readOne(f);
    return true;
  }
  const attachAll = () => {
    let added = false;
    for (const d of dirs) if (attach(d)) added = true;
    if (added) onChangeCb();
  };

  return {
    get dirs() { return dirs.slice(); },
    // 实际读到会话的目录（status 用：让人看得出读的是 Claude/ 还是 Claude-3p/）
    get activeDirs() {
      ensure();
      const on = new Set();
      for (const f of byFile.keys()) { const d = dirs.find(x => f.startsWith(x)); if (d) on.add(d); }
      return dirs.filter(d => on.has(d));
    },
    // 中途发现新的位置（钩子上报的 CLAUDE_USER_DATA_DIR）
    addDirs(more) {
      const fresh = [].concat(more).filter(d => d && !dirs.includes(d));
      if (!fresh.length) return false;
      dirs.push(...fresh);
      if (loaded) for (const d of fresh) for (const f of walk(d, 0, [])) readOne(f);
      if (onChangeCb) attachAll();
      return true;
    },
    get count() { ensure(); return byFile.size; },
    focusedAt(id) {
      ensure();
      let best = 0;
      for (const r of byFile.values()) if (r.id === id && r.focusedAt > best) best = r.focusedAt;
      return best;
    },
    // 当前聚焦的会话 = 最近一次被切到的那个
    current() {
      ensure();
      let best = null;
      for (const r of byFile.values()) if (!r.archived && (!best || r.focusedAt > best.focusedAt)) best = r;
      return best?.id ?? null;
    },
    reload: load,
    // 盯住目录，只重读变了的那个文件；lastFocusedAt 真变了才回调（会话活动也会改这些文件）
    // 还不存在的目录每隔 rescanMs 再试一次，出现了就挂上，并回调一次（新目录里可能已经有看过的会话）
    watch(onChange) {
      ensure();
      onChangeCb = onChange;
      for (const d of dirs) attach(d);
      const timer = rescanMs > 0 ? setInterval(attachAll, rescanMs) : null;
      timer?.unref?.();
      return () => {
        if (timer) clearInterval(timer);
        for (const w of watched.values()) w.close();
        watched.clear();
        onChangeCb = null;
      };
    },
  };
}

// Codex 桌面版（ChatGPT.app）自己记的未读：.codex-global-state.json 里的 electron-thread-read-state-v1。
// 回合结束它把 thread id 加进 unreadByIdentity[账号][host]，你点开那个会话就移出去。
// 这里只有"现在谁未读"，没有时间 —— 刚完成、app 还没来得及写的那几秒要调用方自己留宽限。
//
// 同样是私有格式：解析不出来就当没有信号（isUnread 返回 null），并在 status 里显示出来
export function codexStateFile() {
  return process.env.AGENTDESK_CODEX_STATE || join(process.env.CODEX_HOME || join(homedir(), '.codex'), '.codex-global-state.json');
}

export function createCodexReadState(file = codexStateFile()) {
  let mtime = -1;
  let unread = null;     // Set<threadId>；null = 没有信号

  function load() {
    let m;
    try { m = statSync(file).mtimeMs; } catch { mtime = -1; unread = null; return; }
    if (m === mtime) return;
    mtime = m;
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'))['electron-thread-read-state-v1'];
      const by = s?.unreadByIdentity;
      if (!by || typeof by !== 'object') { unread = null; return; }
      const ids = new Set();
      for (const hosts of Object.values(by)) {
        for (const list of Object.values(hosts || {})) if (Array.isArray(list)) list.forEach(id => ids.add(String(id)));
      }
      unread = ids;
    } catch { mtime = -1; /* 写到一半，下次再读 */ }
  }

  const key = () => (unread ? [...unread].sort().join(',') : '');

  return {
    file,
    get known() { load(); return unread !== null; },
    get count() { load(); return unread?.size ?? 0; },
    // app 最后一次落盘的时间：晚于任务完成，才说明 app 已经处理过这次完成
    get savedAt() { load(); return unread ? mtime : 0; },
    // true = app 说没看过；false = app 说看过了；null = 读不到
    isUnread(id) { load(); return unread ? unread.has(id) : null; },
    // 文件会被整个替换，盯文件本身会丢事件，盯它所在的目录。未读集合真变了才回调
    watch(onChange) {
      load();
      try {
        let before = key();
        const w = watch(dirname(file), (_e, name) => {
          if (name && String(name) !== basename(file)) return;
          load();
          const now = key();
          if (now !== before) { before = now; onChange(); }
        });
        return () => w.close();
      } catch {
        return () => {};
      }
    },
  };
}

// 这个会话是不是 Codex 桌面版开的。只有桌面版在流式接收的会话才会进它的未读列表 ——
// 终端里 codex CLI 跑的会话永远不在列表里，"不在"不能当成"看过"。
// 看会话头 session_meta 的 originator（"Codex Desktop" / "codex_work_desktop"；CLI 是 codex_cli_rs）。
// 会话头里嵌着整份 base_instructions，常见两万字节上下，得读到第一个换行为止
const originCache = new Map();    // rollout 路径 -> 是不是桌面版；读不出来不缓存，下次再试
export function isCodexDesktopThread(rollout) {
  if (!rollout) return false;
  if (originCache.has(rollout)) return originCache.get(rollout);
  let line = null;
  try { line = firstLine(rollout); } catch { return false; }
  if (line === null) return false;
  let origin = '';
  try { origin = String(JSON.parse(line)?.payload?.originator || ''); } catch { /* 格式不符 */ }
  const ok = /desktop/i.test(origin);
  originCache.set(rollout, ok);
  return ok;
}

function firstLine(file) {
  const fd = openSync(file, 'r');
  try {
    const chunks = [];
    for (let pos = 0; pos < 1024 * 1024;) {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) return null;
      const i = buf.subarray(0, n).indexOf(0x0a);
      if (i >= 0) return Buffer.concat([...chunks, buf.subarray(0, i)]).toString('utf8');
      chunks.push(buf.subarray(0, n));
      pos += n;
    }
    return '';
  } finally { closeSync(fd); }
}

const PS_FOREGROUND = [
  'Add-Type @"',
  'using System;using System.Runtime.InteropServices;',
  'public class Fg{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int p);}',
  '"@',
  '$h=[Fg]::GetForegroundWindow();$procId=0;[void][Fg]::GetWindowThreadProcessId($h,[ref]$procId)',
  '(Get-Process -Id $procId).ProcessName',
].join('\n');

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { encoding: 'utf8', timeout }, (err, out) => (err ? reject(err) : resolve(out))));
}

// 前台 app 的名字。异步执行，不堵事件循环（以前的 osascript 是同步调用，超时 3 秒）
let frontCache = { at: -Infinity, name: null };
export async function frontmostApp(now = Date.now()) {
  if (process.env.AGENTDESK_FAKE_FRONT !== undefined) return process.env.AGENTDESK_FAKE_FRONT || null;
  if (now - frontCache.at < 1000) return frontCache.name;
  let name = null;
  try {
    if (process.platform === 'darwin') {
      const asn = (await run('lsappinfo', ['front'], 2000)).trim();
      if (asn) {
        const info = await run('lsappinfo', ['info', '-only', 'name', asn], 2000);
        name = info.match(/"(?:LSDisplayName|name)"="([^"]*)"/)?.[1] || null;
      }
    } else if (process.platform === 'win32') {
      name = (await run('powershell', ['-NoProfile', '-Command', PS_FOREGROUND], 5000)).trim() || null;
    }
  } catch { name = null; }
  frontCache = { at: now, name };
  return name;
}

export const frontmostSupported = () =>
  process.env.AGENTDESK_FAKE_FRONT !== undefined || process.platform === 'darwin' || process.platform === 'win32';
