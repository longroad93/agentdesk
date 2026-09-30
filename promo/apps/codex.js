// Codex 桌面版（ChatGPT app 里的 Codex）。项目名、会话标题都是演示数据。
'use strict';

// 侧栏：项目 → 展开的那个项目下挂着会话
const CODEX_SIDEBAR = [
  { proj: 'shop-api', open: true },
  { thread: '重构退款流程', on: true, running: true },
  { thread: '对账报表导出' },
  { thread: '优惠券过期提醒' },
  { proj: 'web-admin' },
  { proj: 'docs-site' },
  { proj: 'infra' },
  { proj: 'mobile' },
  { proj: 'data' },
];

// 一直在刷的操作记录，按剧中时间每 7 秒一条
const CODEX_OPS = [
  `${ico('term', 12)}已运行 <code>pnpm test --filter payments</code>`,
  `${ico('edit', 12)}已编辑 <code>src/payments/refund.ts</code> <span class="a">+34</span> <span class="r">-12</span>`,
  `${ico('search', 12)}已搜索 <code>legacyRefund</code>`,
  `${ico('edit', 12)}已编辑 <code>src/payments/ledger.ts</code> <span class="a">+18</span> <span class="r">-5</span>`,
  `${ico('term', 12)}已运行 <code>pnpm tsc --noEmit</code>`,
  `${ico('edit', 12)}已编辑 <code>test/fixtures/refund.json</code> <span class="a">+41</span>`,
  `${ico('term', 12)}已运行 <code>pnpm test refund</code>`,
];

// o.story：剧中时间（秒），驱动操作记录滚动和"工作中"计时
function codexWindow(t, { w = 1000, h = 500, story = 0 } = {}) {
  let y = 134;
  const rows = CODEX_SIDEBAR.map((r) => {
    const top = y;
    y += 29.9;
    if (r.proj) {
      return `<div class="row" style="top:${top}px">${ico(r.open ? 'folderOpen' : 'folder', 15)}${esc(r.proj)}</div>`;
    }
    return `<div class="row thr${r.on ? ' on' : ''}" style="top:${top}px">${esc(r.thread)}${r.running ? spinner(t, 11) : ''}</div>`;
  }).join('');

  const n = Math.floor((story + 60) / 7);
  const ops = [];
  // 条数按窗口高度算，保证用户那条消息还留在顶上
  const room = Math.max(3, Math.floor((h - 42 - 14 - 150 - 36 - 28) / 27));
  for (let i = Math.max(0, n - room); i < n; i++) ops.push(`<div class="op">${CODEX_OPS[i % CODEX_OPS.length]}</div>`);

  return `
    ${lights(22, 21, 13, 22)}
    <div class="tb">
      <span class="ti" style="left:92px">${ico('left', 16)}</span>
      <span class="ti" style="left:125px;opacity:.45">${ico('right', 16)}</span>
      <span class="ti" style="left:158px">${ico('sidebar', 16)}</span>
    </div>
    <div class="rail">
      <span class="ri on" style="top:9px">${ico('home', 16)}</span>
      <span class="ri" style="top:51px">${ico('clock', 16)}</span>
      <span class="ri" style="top:93px">${ico('library', 16)}</span>
      <span class="ri" style="top:136px">${ico('cube', 16)}</span>
      <span class="ri" style="top:179px">${ico('at', 16)}</span>
      <span class="ri" style="top:221px">${ico('dots', 16)}</span>
      <span class="ri" style="bottom:46px">${ico('help', 16)}</span>
      <span class="av">DM</span>
    </div>
    <div class="side">
      <div class="brand">Codex ${ico('chevD', 12)}</div>
      <div class="tools">${ico('bell', 15)}${ico('search', 15)}</div>
      <div class="row" style="top:56px">${ico('edit', 15)}新聊天</div>
      <div class="lab" style="top:95px">项目</div>
      ${rows}
      <div class="sb" style="top:130px;height:220px"></div>
    </div>
    <div class="main">
      <div class="conv">
        <div class="ub">退款流程拆成独立模块，旧的 legacyRefund 全部迁过去，测试要全绿</div>
        ${ops.join('')}
        <div class="st">${spinner(t, 11)}<b>工作中</b> · ${fmtDur(story + 258)}</div>
      </div>
      <div class="chipbar">${ico('folder', 14)}shop-api</div>
      <div class="inp">
        <span class="ph">要求后续变更</span>
        <div class="bl">${ico('plus', 16)}<span>${ico('shield', 14)}帮我批准</span></div>
        <div class="br"><span>GPT-6 Astra 中 ${ico('chevD', 11)}</span>${ico('mic', 16)}<span class="go"><i></i></span></div>
      </div>
    </div>`;
}
