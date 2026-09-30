// Claude 桌面版（Code 模式）。会话标题、项目名都是演示数据。
// 对话内容由场景传进来（html），这里只画窗口骨架。
'use strict';
const CLAUDE_W = 1200, CLAUDE_H = 816;

const CLAUDE_SIDEBAR = [
  { item: '整理周会纪要' },
  { group: 'shop-api' },
  { item: '重新打包并跑 e2e', id: 'rebuild' },
  { item: '后台跑全量 e2e', id: 'bg' },
  { item: '订单接口加分页' },
  { item: '排查登录偶发 401', id: 'auth' },
  { group: 'web-admin' },
  { item: '表格换成虚拟滚动' },
  { item: '补齐权限页单测' },
  { group: 'docs-site' },
  { item: 'README 补安装说明' },
  { group: 'infra' },
  { item: '升级 Node 22' },
  { item: 'CI 缓存命中率' },
  { group: 'mobile' },
  { item: '推送点击率埋点' },
  { item: '崩溃日志归类' },
  { group: 'data' },
  { item: '周报 SQL 提速' },
];

// o.title：会话标题；o.on：侧栏选中哪条（CLAUDE_SIDEBAR 的 id）；o.conv：对话区 html
function claudeWindow(t, o) {
  const side = CLAUDE_SIDEBAR.map((r) => r.group
    ? `<div class="grp">${esc(r.group)}${ico('chevR', 11)}<span class="pl">${ico('plus', 14)}</span></div>`
    : `<div class="it${r.id && r.id === o.on ? ' on' : ''}"><i></i>${esc(r.item)}</div>`).join('');

  return `
    ${lights(24, 24, 13, 23)}
    <div class="side">
      <span class="ti" style="left:88px">${ico('sidebar', 16)}</span>
      <span class="ti" style="left:112px">${ico('search', 16)}</span>
      <div class="seg"><span>${ico('cowork', 13)}Cowork</span><span class="on">${ico('code', 13)}Code</span></div>
      <div class="new"><b>${ico('plus', 11, 1.7)}</b>New</div>
      <div class="list">${side}</div>
      <div class="me">${spark(18)}demo <small>· Pro</small>${ico('chevD', 13)}</div>
    </div>
    <div class="main">
      <div class="hd">${ico('laptop', 16)}<b>${esc(o.title)}</b>${ico('chevD', 12)}<span class="chip">shop-api</span>
        <span class="r">${ico('term', 16)}${ico('newwin', 16)}${ico('play', 16)}${ico('dots', 16)}</span></div>
      <div class="conv">${o.conv}</div>
      <div class="git">shop-api<span>main</span><span class="df"><b>+48</b> <s>-12</s></span><span class="cm">Commit changes</span></div>
      <div class="inp"><span class="ph">Type / for commands</span>${ico('ret', 16)}</div>
      <div class="ft">${ico('plus', 14)}<span class="r">claude-opus-5-5<span>High</span><span class="ring"></span></span></div>
    </div>`;
}

// 对话里常用的几种块
const cl = {
  user: (s) => `<div class="ub">${esc(s)}</div>`,
  text: (html) => `<div>${html}</div>`,
  tool: (name, arg, icon = 'library') => `<div class="tool">${ico(icon, 13)}<b>${name}</b><code>${esc(arg)}</code></div>`,
  status: (s) => `<div class="st"><i></i>${esc(s)}</div>`,
  perm: (cmd, tag = '') => `<div class="perm">
      <div class="q">${ico('term', 14, 1.6)}Allow Claude to run this command?</div>
      <pre>${esc(cmd)}</pre>
      <div class="btns"><span class="pri" data-a="allow">Allow once</span><span>Always allow</span><span>Deny</span></div>
      ${tag}
    </div>`,
};
