// 面板和 CLI 共用的一条管道：事件 → 投影 → 结合文件系统现看的状态 → 退场 → 排序。
// 以前 server.js 的 snapshot 和 agentdesk status 是两条路：status 不扫后台、不读退场配置，
// 永远显示不出「后台跑着」—— 而 AGENTS.md 让 AI 用它来验证 adapter。
import { statSync } from 'node:fs';
import { loadEvents, project } from './store.js';
import { transcriptInfo, subagentsMtime, backgroundIds } from './transcript.js';
import { scanBackground } from './bgwatch.js';
import { adapterFor } from './adapters.js';

export function createIO({ desktop = null } = {}) {
  return {
    transcript: transcriptInfo,
    mtime: p => {
      if (!p) return 0;
      try { return statSync(p).mtimeMs; } catch { return 0; }
    },
    subagentsMtime,
    // 真后台任务 vs 正在执行的前台工具：都会在 tasks/ 下开 .output，
    // 区别是后台任务起来后工具立刻返回，transcript 里留下了它的 ID
    background(t) {
      if (t.agent !== 'claude') return null;      // 这个目录结构是 claude code 特有的
      const running = Object.entries(scanBackground(t.key)).filter(([, v]) => v.running);
      if (!running.length) return { bg: {}, busy: false };
      const launched = t.transcript ? backgroundIds(t.transcript) : new Set();
      const bg = {};
      let busy = false;
      for (const [id, v] of running) {
        if (launched.has(id)) bg[id] = v;
        else busy = true;
      }
      return { bg, busy };
    },
    focusedAt: t => (desktop && t.agent === 'claude' ? desktop.focusedAt(t.key) : 0),
  };
}

export function buildView({ cfg, adapters, io, now = Date.now(), events = loadEvents() }) {
  const tasks = project(events, {
    now,
    timeouts: cfg.timeouts,
    retention: cfg.retention,
    attentionRetention: cfg.attentionRetention,
    io,
  });
  for (const t of tasks) t.app = appFor(t, adapters, io);
  return tasks;
}

// 点"打开"时拉起哪个 app。claude -p 和终端里的 CLI 没有窗口可去；
// 旧事件里没记入口的，桌面版会话文件里有它就算桌面版
export function appFor(t, adapters, io) {
  const name = adapterFor(adapters, t.agent)?.foreground?.[process.platform];
  if (!name) return null;
  if (t.agent === 'claude' && t.entrypoint !== 'claude-desktop' && !(io?.focusedAt(t) > 0)) return null;
  return name;
}
