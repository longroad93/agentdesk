// 状态定义只写一份，服务端和前端共用，避免两边文案/颜色对不上
export const STATES = {
  waiting: { label: '等你',   icon: '⏸', mark: '◆', color: '#f59e0b', notify: 'always', sound: true  },
  stale:   { label: '失联',   icon: '⚠', mark: '▲',  color: '#a855f7', notify: 'always', sound: true  },
  failed:  { label: '失败',   icon: '✕', mark: '✕',  color: '#ef4444', notify: 'always', sound: true  },
  bgrun:   { label: '后台跑着', icon: '⏳', mark: '⧗', color: '#06b6d4', notify: 'never',  sound: false },
  done:    { label: '完成',   icon: '✓', mark: '✓',  color: '#10b981', notify: 'once',   sound: false },
  running: { label: '运行中', icon: '▶', mark: '▶',  color: '#3b82f6', notify: 'never',  sound: false },
  idle:    { label: '停着',   icon: '⏸', mark: '■', color: '#94a3b8', notify: 'never',  sound: false },
};

// 只有这些算"占着你的注意力"。注意 done 也算 —— 前提是你还没看过它。
// "跑完了但我不知道"和"还没跑完"，对使用者是同一件事。
export const ATTENTION = ['waiting', 'stale', 'failed'];

export function needsAttention(t) {
  return ATTENTION.includes(t.state) || (t.state === 'done' && t.seen === false);
}

// 排序权重：等你 > 失联 > 失败 > 后台还在跑 > 完成 > 运行中
// 面板首先要回答"现在有哪些 agent 在动"，其次才是"刚才发生了什么"。
// 所以先分两组，组内再排 —— 而不是把所有状态拉平成一个优先级序列。
export const GROUP = {
  waiting: 0, running: 0, bgrun: 0,          // 进行中：还在动，或者卡着等你
  failed: 1, stale: 1, done: 1, idle: 1,     // 已结束
};
// 进行中组内：等你的排最前（要你动手），然后是在跑的
export const WITHIN_ACTIVE = { waiting: 0, bgrun: 1, running: 2 };

export function fmtAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} 小时` : `${Math.floor(h / 24)} 天`;
}
