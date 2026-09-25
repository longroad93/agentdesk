// 已读以 agent 自己的记录为准：你在哪个 app 的哪个会话里看过，它们自己记着。
//
// 以前靠一个 AppleScript 小程序读窗口标题去猜，那要辅助功能/自动化授权 ——
// 实测授权一直没拿到，它每 2 秒往 foreground.txt 里写一条报错，会话级已读和"开着就不打扰"从没生效过。
// 现在两样东西都不需要任何授权：
//   · 哪个会话看过 —— Claude 桌面版自己记的 lastFocusedAt（WorkBuddy 的 unread 列走 adapter 的 read 通道）
//   · 前台是哪个 app —— lsappinfo（问的是 LaunchServices，不走 Apple 事件）
import { readdirSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

export function claudeSessionsDir() {
  if (process.env.AGENTDESK_CLAUDE_SESSIONS) return process.env.AGENTDESK_CLAUDE_SESSIONS;
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Claude')
    : process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude');
  return join(base, 'claude-code-sessions');
}

// Claude 桌面版的每个会话一个 local_<id>.json，里面有 cliSessionId（= 钩子里的 session_id）
// 和 lastFocusedAt（点开 / 切到这个会话的时间）。它只在切换时写，停在上面看不会刷新，
// 所以"完成那一刻它就在你屏幕上"要另外判断，见 server.js 的 onScreen。
//
// 这是桌面版的私有格式，升级可能会变。读不到就当没有这个信号，退回原来的判定，
// 并在 agentdesk status 里显示出来 —— 别让它悄悄坏掉。
export function createDesktopFocus(dir = claudeSessionsDir()) {
  const byFile = new Map();     // file -> { id, focusedAt, archived }
  let loaded = false;

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
    for (const f of walk(dir, 0, [])) readOne(f);
    loaded = true;
  }
  const ensure = () => { if (!loaded) load(); };

  return {
    dir,
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
    watch(onChange) {
      ensure();
      try {
        const w = watch(dir, { recursive: true }, (_e, name) => {
          if (!name || !String(name).endsWith('.json')) return;
          const file = join(dir, String(name));
          const before = byFile.get(file)?.focusedAt;
          if (readOne(file)?.focusedAt !== before) onChange();
        });
        return () => w.close();
      } catch {
        return () => {};
      }
    },
  };
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
