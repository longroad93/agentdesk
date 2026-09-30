// S4 失联：长任务跑着跑着，Claude 崩了（窗口没了、机器睡了都一样）。
// 没有任何 agent 会主动说"我死了"：面板靠超时没动静，把它降级成紫色的「失联」。
'use strict';

function s4Tasks(stale, since) {
  return [
    stale
      ? { id: 'e2e', state: 'stale', title: '迁移订单表到新 schema', agent: 'claude', sub: '最后在跑：node scripts/migrate.mjs --batch 5000', when: '断' + since, unread: true }
      : { id: 'e2e', state: 'running', title: '迁移订单表到新 schema', agent: 'claude', sub: '在跑：node scripts/migrate.mjs --batch 5000', when: '跑' + since },
    { id: 'refund', state: 'running', title: '重构退款流程', agent: 'codex', sub: '在跑：pnpm test refund', when: '跑46分' },
    { id: 'api', state: 'done', title: '同步 API 文档', agent: 'workbuddy', sub: '已完成：修正 12 处过期的接口说明', when: '3分前' },
  ];
}

SCENES.push({
  id: 's4', start: TIMELINE.S.s4, end: TIMELINE.S.s5, fadeIn: 0.3, fadeOut: 0.3,
  render(lt, t) {
    const C = TIMELINE.CUE.s4;
    const claudeL = { x: 64, y: 138, w: CLAUDE_W, h: CLAUDE_H, s: 0.98 };
    const P = { x: 1920 - 40 - 340 * 1.55, y: 60, s: 1.55 };
    const crashed = lt >= C.crash;

    // 快进：没动静的时间从 0 走到 15 分钟（默认超时）
    const quiet = crashed ? 900 * ease(prog(lt, C.ff[0], C.ff[1])) : 0;
    const stale = lt >= C.stale;

    let html = menubar(crashed ? 'Finder' : 'Claude', '周四 15:06');
    const co = 1 - ease(prog(lt, C.crash, C.crash + 0.35));
    if (co > 0) {
      const conv = cl.user('把订单表迁到新 schema，分批跑，别锁表') +
        cl.tool('Read', 'scripts/migrate.mjs') +
        cl.text('按 5000 条一批跑，每批之间停 200ms，预计 40 分钟。') +
        cl.tool('Bash', 'node scripts/migrate.mjs --batch 5000', 'term') +
        cl.status(`${12 + Math.floor(lt)}m · batch 118/402`);
      // 崩的那一下：抖一下、缩一下、没了
      const shake = lt > C.crash - 0.15 && lt < C.crash + 0.1 ? Math.sin(lt * 90) * 8 : 0;
      html += place('claude', claudeL, claudeWindow(t, { title: '迁移订单表到新 schema', on: 'rebuild', conv }),
        { opacity: co, zoom: 1 - (1 - co) * 0.08, dx: shake, z: 1 });
    }
    // 窗口没了之后留一个空桌面上的提示
    const gone = ease(prog(lt, C.crash + 0.3, C.crash + 0.7));
    if (gone > 0) {
      html += `<div class="crash" style="left:${claudeL.x}px;top:${claudeL.y}px;width:${CLAUDE_W * claudeL.s}px;height:${CLAUDE_H * claudeL.s}px;opacity:${gone * 0.9};background:none;border:2px dashed rgba(255,255,255,.18)">
        <div>Claude 意外退出<br><span style="color:#8b8b95;font-size:18px;font-weight:400">transcript 不再写入，也没有任何事件发出来</span></div></div>`;
    }

    const since = quiet < 60 ? Math.floor(quiet) + '秒' : Math.floor(quiet / 60) + '分';
    const panelTasks = s4Tasks(stale, stale ? '15分' : (crashed ? since : '12分'));
    // 变成失联的那一下，那一行闪一下
    const flash = stale ? 1 - prog(lt, C.stale, C.stale + 0.8) : 0;
    panelTasks[0].flash = flash;
    html += scaled(adPanel(panelTasks), { ...P, z: 6 });

    const fo = crashed && !stale ? 1 : fade(lt, 0, 0.01, C.stale + 1.4, C.stale + 1.8) * (crashed ? 1 : 0);
    html += clockPill(mmss(quiet), { label: '没动静', ff: lt > C.ff[0] && lt < C.ff[1], opacity: fo });

    if (stale) {
      const ns = 1.55;
      const nin = ease(prog(lt, C.stale + 0.1, C.stale + 0.5));
      html += scaled(adNotify({ state: 'stale', title: '迁移订单表到新 schema', body: '15 分钟没有任何动静', agent: 'claude', cwd: 'demo/shop-api' }),
        { x: 1920 - 24 - 372 * ns + (1 - nin) * 620, y: 60 + 400, s: ns, z: 9 });
    }
    html += `<div class="chap" style="--c:${AD_STATES.stale.color};opacity:${fade(lt, 0.3, 0.6, 99, 99)}"><i>⚠</i>失联<small>它不会告诉你它死了</small></div>`;
    return { html };
  },
});
