// agentdesk 自己：悬浮窗 + 原生通知 + 浏览器面板。
// 悬浮窗的排版直接用 src/ui/panel.css 的紧凑模式（index.html 里引了真文件），
// 状态的文案、符号、颜色抄自 src/states.js —— 片子里的产品界面就是真的。
'use strict';

const AD_STATES = {
  waiting: { label: '等你', icon: '⏸', mark: '◆', color: '#f59e0b' },
  stale: { label: '失联', icon: '⚠', mark: '▲', color: '#a855f7' },
  failed: { label: '失败', icon: '✕', mark: '✕', color: '#ef4444' },
  bgrun: { label: '后台跑着', icon: '⏳', mark: '⧗', color: '#06b6d4' },
  done: { label: '完成', icon: '✓', mark: '✓', color: '#10b981' },
  running: { label: '运行中', icon: '▶', mark: '▶', color: '#3b82f6' },
  idle: { label: '停着', icon: '⏸', mark: '■', color: '#94a3b8' },
};
const AD_ACTIVE = new Set(['waiting', 'running', 'bgrun']);
// 排序照 src/states.js：先"进行中"一组（等你 > 后台 > 运行中），再"已结束"一组
const AD_ORDER = { waiting: 0, bgrun: 1, running: 2, failed: 3, stale: 3, done: 3, idle: 3 };

// 任务：{ id, state, title, agent, sub, when, unread, flash }
// needs 照 src/states.js 的 needsAttention：等你一直算；失败/失联/完成没看过才算
const adNeeds = (x) => x.state === 'waiting' || (['failed', 'stale', 'done'].includes(x.state) && x.unread);

function adCount(tasks) {
  const need = tasks.filter(adNeeds);
  const w = need.filter((x) => x.state === 'waiting').length;
  const b = need.filter((x) => x.state === 'failed' || x.state === 'stale').length;
  const u = need.filter((x) => x.state === 'done').length;
  const parts = [];
  if (w) parts.push(w + ' 等你');
  if (b) parts.push(b + ' 出错');
  if (u) parts.push(u + ' 未看');
  const alert = w ? 'waiting' : b ? need.find((x) => x.state === 'failed' || x.state === 'stale').state : null;
  return { text: parts.length ? parts.join(' · ') : tasks.length + ' 个 · 都不用管', alert };
}

// 紧凑模式的一行，结构和 src/ui/panel.js 的 card() 一致
function adRow(x, groupstart) {
  const st = AD_STATES[x.state];
  const needs = adNeeds(x);
  const cls = ['task', x.state, needs && 'needs', !needs && !AD_ACTIVE.has(x.state) && 'quiet', groupstart && 'groupstart'].filter(Boolean).join(' ');
  const flash = x.flash ? `box-shadow:inset 0 0 0 999px color-mix(in srgb,${st.color} ${Math.round(x.flash * 22)}%,transparent);` : '';
  return `<div class="${cls}" data-a="ad-${x.id}" style="--bar:${st.color};${flash}">` +
    `<span class="badge">${st.mark}</span>` +
    `<div class="main"><div class="title">${esc(x.title)}</div>` +
    `<div class="sub"><span class="who">${esc(x.agent)}</span> ${esc(x.sub || '')}</div></div>` +
    `<span class="when">${esc(x.when || '')}</span></div>`;
}

// 悬浮窗。原生尺寸 340 宽（和 panel.swift 的默认宽度一致），高度随内容。
// o.hl：头部计数的高亮强度（0–1），讲"现在有几个在等你"的时候用
function adPanel(tasks, { hl = 0 } = {}) {
  const sorted = tasks.slice().sort((a, b) => (AD_ORDER[a.state] - AD_ORDER[b.state]));
  const firstEnded = sorted.find((x) => !AD_ACTIVE.has(x.state));
  const { text, alert } = adCount(tasks);
  const rows = sorted.map((x) => adRow(x, x === firstEnded && x !== sorted[0])).join('');
  const alertStyle = alert ? `--alert:${AD_STATES[alert].color}` : '';
  const hlStyle = hl > 0 ? `style="box-shadow:0 0 0 ${1 + hl}px color-mix(in srgb,var(--alert) ${Math.round(hl * 100)}%,transparent);border-radius:4px;padding:0 4px"` : '';
  return `<div class="adp">
    <div class="adp-tl">${lights(14, 13, 11, 18)}</div>
    <div class="adp-body compact shell${alert ? ' alert' : ''}" style="${alertStyle}">
      <header><h1>agentdesk</h1><span id="count" ${hlStyle}>${esc(text)}</span>
        <button id="mute" class="on">🔔</button><button style="display:inline-block">▾</button></header>
      <div id="list">${rows}</div>
    </div>
  </div>`;
}

// 面板旁边的标注，和 adPanel() 一起传给 scaled()。side：'below'（面板下方）| 'left'（面板左侧）
function adCallout(text, { side = 'below', color = '#f59e0b', fg = '#1c1300', opacity = 1 } = {}) {
  if (opacity <= 0) return '';
  return `<div class="callout ${side}" style="opacity:${opacity};--cc:${color};color:${fg}">${esc(text)}</div>`;
}

// macOS 通知横幅（悬浮窗发的原生通知）。标题、正文的拼法照 panel.js 的 show()
function adNotify({ state, title, body, agent, cwd }) {
  const st = AD_STATES[state];
  return `<div class="mac-note" data-a="note">
    <img class="ni" src="logo.svg" alt="">
    <div class="nt"><div class="nh"><b>Agentdesk Panel</b><span>现在</span></div>
      <div class="ntl">${st.icon} ${st.label} · ${esc(title)}</div>
      <div class="nb">${esc(body)}</div>
      <div class="nb dim">${esc(agent)}  ·  ${esc(cwd)}</div></div>
  </div>`;
}
