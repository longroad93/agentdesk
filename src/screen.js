// 此刻你屏幕上的是哪个 agent 的哪个会话。两个用处：
//   1. 它就在你眼前 —— 不弹通知（以前按 app 静音：你看着会话 A 时，并行的会话 B 完成也被一起静音）
//   2. 你看着它停留够久 —— 算你看过了（完成那一刻你正盯着它，桌面版不会刷新 lastFocusedAt）
import { frontmostApp } from './readstate.js';
import { adapterFor } from './adapters.js';

export function whatIsOnScreen(front, adapters, desktop, platform = process.platform) {
  if (!front) return null;
  const def = Object.values(adapters).find(d =>
    d.foreground?.[platform] && String(d.foreground[platform]).toLowerCase() === String(front).toLowerCase());
  if (!def) return null;
  // Claude 桌面版能精确到会话：当前聚焦的会话 = 最近一次被切到的那个。别的 app 只知道是哪个 app
  const key = def.name === 'claude' ? desktop?.current() ?? null : null;
  return { agent: def.name, key };
}

export function isOnScreen(t, on) {
  if (!on || t.agent !== on.agent) return false;
  if (on.key) return t.key === on.key;          // 会话级：只有正看着的那一个
  if (t.agent === 'claude') return false;       // 是 claude 却拿不到会话：不猜
  return true;                                  // 只能到 app 级的 agent：沿用"开着就不打扰"
}

const UNREAD = t => t.seen === false && (t.state === 'done' || t.state === 'failed' || t.state === 'stale');

export function createScreenTracker({ adapters, desktop, front = frontmostApp, dwell = 3000 }) {
  let cur = null;     // { agent, key, since }
  return {
    get current() { return cur; },
    async sample(now = Date.now()) {
      const on = whatIsOnScreen(await front(now), adapters, desktop);
      const same = cur && on && cur.agent === on.agent && cur.key === on.key;
      if (!same) cur = on ? { ...on, since: now } : null;
      return cur;
    },
    // 在屏幕上停留够久的那一条，没看过的话就算看过
    toMarkSeen(tasks, now = Date.now()) {
      if (!cur || now - cur.since < dwell) return [];
      const hits = tasks.filter(t => UNREAD(t) && isOnScreen(t, cur));
      if (cur.key) return hits.map(t => t.id);
      // 只知道是哪个 app：自己记已读的 agent 听它自己的；
      // 否则只有一条没看过的时候才算 —— 多条分不清你看的是哪个，宁可让你多点一下
      if (adapterFor(adapters, cur.agent)?.read) return [];
      return hits.length === 1 ? [hits[0].id] : [];
    },
  };
}
