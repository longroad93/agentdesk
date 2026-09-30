// WorkBuddy 桌面版。任务标题都是演示数据。
'use strict';

const WB_NAV = [
  ['newtask', '新建任务'], ['assist', '助理'], ['project', '项目'],
  ['expert', '专家·技能·连接器'], ['alarm', '定时任务'], ['book', '资料库'], ['grid', '更多'],
];
const WB_TASKS = [
  { id: 'api', title: '同步 API 文档' },
  { title: '竞品定价表整理', when: '2天前' },
  { title: '季度 OKR 初稿', when: '5天前' },
  { title: '客户访谈纪要归档', when: '9天前' },
  { title: '招聘 JD 改写', when: '12天前' },
];
const WB_STEPS = [
  '读取 docs/api 目录', '比对 orders 路由和文档', '补充分页参数说明', '更新示例响应',
  '检查 users 接口字段', '修正 3 处过期示例', '生成变更摘要', '校对术语表', '整理待确认问题',
];

// o.mode：'running'（任务在跑）| 'home'（新建任务首页）| 'done'（打开了跑完的任务）
// o.api：侧栏里「同步 API 文档」这一条的样子：'running' | 'unread' | 'read'
function workbuddyWindow(t, { w = 1100, h = 551, story = 0, mode = 'running', api = 'running' } = {}) {
  const navOn = mode === 'home' ? 0 : -1;
  const nav = WB_NAV.map(([ic, label], i) =>
    `<div class="nav${i === navOn ? ' on' : ''}" style="top:${102 + i * 30.5}px">${ico(ic, 15)}${label}</div>`).join('');
  const tasksTop = 102 + WB_NAV.length * 30.5 + 12;
  // 窗口矮的时候只放得下前几条，别压到底部的账号行
  const fit = Math.max(1, Math.floor((h - 56 - (tasksTop + 26)) / 30.5));
  const tasks = WB_TASKS.slice(0, fit).map((r, i) => {
    const top = tasksTop + 26 + i * 30.5;
    const on = r.id === 'api' && mode !== 'home';
    const tail = r.id !== 'api' ? `<small>${r.when}</small>`
      : api === 'running' ? spinner(t, 11)
      : api === 'unread' ? '<span class="dot"></span>'
      : '<small>刚刚</small>';
    return `<div class="task${on ? ' on' : ''}" ${r.id ? `data-a="wb-${r.id}"` : ''} style="top:${top - (on ? 3 : 0)}px">
      <span class="tt">${esc(r.title)}</span>${tail}</div>`;
  }).join('');

  let main;
  if (mode === 'home') {
    main = `
      <div class="home">
        <div class="hi">WorkBuddy，我帮你</div>
        <div class="cats"><span class="on">日常办公</span><span>代码开发</span><span>设计创意</span></div>
        <div class="pills"><span>文档处理</span><span>金融服务</span><span>数据分析及可视化</span><span>个人工作台</span></div>
        <div class="hinp"><span class="ph">今天帮你做些什么？@ 添加上下文，/调用技能与指令</span>
          <span class="pl">${ico('plus', 17)}</span>
          <div class="br"><span>${ico('cube', 14)}qwen3.8-max ${ico('chevD', 10)}</span>${ico('mic', 16)}<span class="go up">${ico('up', 14, 2)}</span></div>
        </div>
      </div>`;
  } else {
    const steps = [];
    if (mode === 'done') {
      for (const s of WB_STEPS.slice(-5)) steps.push(`<div class="step"><b>${ico('check', 11, 2)}</b>${s}</div>`);
      steps.push('<div class="fin">已完成：修正 12 处过期的接口说明，变更摘要写在 <code>docs/api/CHANGELOG.md</code>。</div>');
    } else {
      // 步骤一条条打勾：开场时已经跑过几步，窗口不至于空着
      const cur = Math.floor((story + 500) / 110);
      for (let i = Math.max(0, cur - 5); i <= cur; i++) {
        const s = WB_STEPS[i % WB_STEPS.length];
        steps.push(i < cur
          ? `<div class="step"><b>${ico('check', 11, 2)}</b>${s}</div>`
          : `<div class="step cur">${spinner(t, 13)}${s}</div>`);
      }
    }
    main = `
      <div class="hd"><b>同步 API 文档</b>${mode === 'done'
        ? '<span class="run ok">已完成</span>'
        : `<span class="run">${spinner(t, 9)}执行中</span>`}</div>
      <div class="conv">
        <div class="ub">对照最新的路由，把 docs/api 里过期的接口说明都改掉</div>
        ${steps.join('')}
      </div>
      <div class="inp">
        <span class="ph">继续追问，@ 添加上下文</span>
        <span class="pl">${ico('plus', 17)}</span>
        <div class="br"><span>${ico('cube', 14)}qwen3.8-max ${ico('chevD', 10)}</span>${ico('mic', 16)}<span class="go"><i></i></span></div>
      </div>
      <div class="opts"><span>${ico('folder', 13)}shop-api ${ico('chevD', 10)}</span><span>${ico('shield', 13)}默认权限 ${ico('chevD', 10)}</span></div>`;
  }

  return `
    ${lights(26, 26, 12, 18.5)}
    <div class="side">
      <span class="ti" style="left:143px">${ico('sidebar', 15)}</span>
      <span class="ti" style="left:176px">${ico('search', 15)}</span>
      <span class="ti" style="left:210px">${ico('filter', 15)}</span>
      <div class="brand">WorkBuddy<small>5.6.2</small></div>
      <div class="disc">${ico('project', 11)}发现应用${ico('chevD', 10)}</div>
      ${nav}
      <div class="lab" style="top:${tasksTop}px">任务 (24) ${ico('chevD', 11)}</div>
      ${tasks}
      <div class="me"><span class="av"><img src="assets/workbuddy.png" alt=""></span>演示账号
        <span class="r">${ico('bell', 15)}${ico('laptop', 15)}</span></div>
    </div>
    <div class="main">${main}</div>`;
}
