// S5 后台跑着：Claude 这一轮回完话了（Stop 钩子），但它起的后台命令还在跑。
// 面板不说「完成」，说「后台跑着」；后台命令写出 [exited with code 0] 之后才变成完成。
'use strict';

const BG_CMD = 'npm run e2e -- --all';

SCENES.push({
  id: 's5', start: TIMELINE.S.s5, end: TIMELINE.S.s6, fadeIn: 0.3, fadeOut: 0.3,
  render(lt, t) {
    const C = TIMELINE.CUE.s5;
    const claudeL = { x: 64, y: 138, w: CLAUDE_W, h: CLAUDE_H, s: 0.98 };
    const P = { x: 1920 - 40 - 340 * 1.55, y: 60, s: 1.55 };
    const replied = lt >= C.reply;
    const done = lt >= C.done;
    // 后台命令跑了多久（快进段从 2 分钟走到 11 分钟）
    const bgSec = !replied ? 0 : lt < C.ff[0] ? (lt - C.reply) * 1.5 + 120
      : 120 + (C.ff[0] - C.reply) * 1.5 + 540 * ease(prog(lt, C.ff[0], C.ff[1]));

    let conv = cl.user('后台跑一遍全量 e2e，不用等它，先把结论告诉我') +
      cl.tool('Bash', BG_CMD + '  (run_in_background)', 'term');
    conv += `<div class="bgrow">${ico('term', 13)}<code>${esc(BG_CMD)}</code>${done
      ? '<span class="r ok">exited with code 0</span>'
      : `<span class="r">${spinner(t, 11)} 后台运行中 · ${mmss(bgSec)}</span>`}</div>`;
    if (replied) conv += cl.text('全量 e2e 已经在后台跑了，大概 10 分钟。这边先把改动总结一下：登录流程加了单飞锁，退款的旧接口都迁完了。');
    else conv += cl.status(`${Math.max(1, Math.floor(lt * 3))}s · Waiting for Claude…`);
    if (done) conv += `<div class="done"><b>${ico('check', 10, 2.2)}</b>后台任务完成：412 passed</div>`;

    let html = menubar('Claude', '周四 15:20');
    html += place('claude', claudeL, claudeWindow(t, { title: '后台跑全量 e2e', on: 'bg', conv }), { z: 1 });

    const state = done ? 'done' : replied ? 'bgrun' : 'running';
    const sub = done ? '412 passed' : replied ? '⧗ 1 个后台 · ' + BG_CMD : '在跑：' + BG_CMD;
    const tasks = [
      { id: 'bg', state, title: '后台跑全量 e2e', agent: 'claude', sub, when: done ? '刚刚' : '跑' + Math.max(1, Math.floor(bgSec / 60)) + '分', unread: done, flash: replied && !done ? 1 - prog(lt, C.reply, C.reply + 0.8) : done ? 1 - prog(lt, C.done, C.done + 0.8) : 0 },
      { id: 'e2e', state: 'stale', title: '迁移订单表到新 schema', agent: 'claude', sub: '最后在跑：node scripts/migrate.mjs', when: '断29分', unread: false },
      { id: 'refund', state: 'running', title: '重构退款流程', agent: 'codex', sub: '在跑：pnpm test refund', when: '跑58分' },
    ];
    // 对照：「Stop 钩子」一出来，一般的面板就会说完成 —— 这里标出来它没这么说
    const ao = fade(lt, C.reply + 0.4, C.reply + 0.8, C.done - 0.3, C.done);
    html += scaled(adPanel(tasks) + adCallout('回话了，但活还没干完', { side: 'left', color: AD_STATES.bgrun.color, opacity: ao }), { ...P, z: 6 });
    html += clockPill(mmss(bgSec), { label: '后台', ff: lt > C.ff[0] && lt < C.ff[1], opacity: replied && !done ? 1 : fade(lt, C.done, C.done, C.done + 0.2, C.done + 0.6) * (done ? 1 : 0) });
    html += `<div class="chap" style="--c:${AD_STATES.bgrun.color};opacity:${fade(lt, 0.3, 0.6, 99, 99)}"><i>⏳</i>后台跑着<small>回合结束 ≠ 活干完了</small></div>`;
    return { html };
  },
});
