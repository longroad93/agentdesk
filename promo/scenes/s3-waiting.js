// S3 等你：你在 Codex 里干活，Claude 在另一个会话里要授权 → 通知立刻弹出来，
// 写着要执行的命令 → 点通知切回 Claude → 批准，面板上那条变回"运行中"。
// 事实边界：「等你」只让 Claude 演（Codex / WorkBuddy 的审批事件 README 写着没验证过）。
'use strict';

const AUTH_CMD = 'git push --force-with-lease origin fix/auth-401';
function s3Tasks(state, waited = 0) {
  return [
    state === 'waiting'
      ? { id: 'auth', state: 'waiting', title: '排查登录偶发 401', agent: 'claude', sub: '要执行：' + AUTH_CMD, when: '等' + Math.floor(waited) + '秒' }
      : { id: 'auth', state: 'running', title: '排查登录偶发 401', agent: 'claude', sub: '在跑：' + AUTH_CMD, when: '跑6分' },
    { id: 'refund', state: 'running', title: '重构退款流程', agent: 'codex', sub: '在跑：pnpm tsc --noEmit', when: '跑31分' },
    { id: 'api', state: 'running', title: '同步 API 文档', agent: 'workbuddy', sub: '修正 3 处过期示例', when: '跑28分' },
  ];
}

SCENES.push({
  id: 's3', start: TIMELINE.S.s3, end: TIMELINE.S.s4, fadeIn: 0.3, fadeOut: 0.3,
  render(lt, t) {
    const C = TIMELINE.CUE.s3;
    const switched = lt >= C.clickNote + 0.35;       // 点了通知，切到 Claude
    const allowed = lt >= C.clickAllow + 0.2;
    const asking = lt >= C.ask;

    const P = { x: 1920 - 40 - 340 * 1.55, y: 60, s: 1.55 };
    const codexL = { x: 64, y: 150, w: 1123, h: 760, s: 1.0 };
    const claudeL = { x: 64, y: 138, w: CLAUDE_W, h: CLAUDE_H, s: 0.98 };

    let html = menubar(switched ? 'Claude' : 'ChatGPT', '周四 14:41');
    // 切换：Codex 往后退，Claude 从后面上来
    const sw = ease(prog(lt, C.clickNote + 0.3, C.clickNote + 0.8));
    const story = 1200 + lt * 3;
    if (sw < 1) html += place('codex', codexL, codexWindow(t, { ...codexL, story }), { opacity: 1 - sw * 0.9, zoom: 1 - sw * 0.04, z: 1 });

    if (sw > 0) {
      let conv = cl.user('登录偶发 401，查一下 token 刷新那块') +
        cl.tool('Read', 'src/auth/refresh.ts') +
        cl.text('问题在并发刷新：两个请求同时拿到过期 token，后一个把前一个刚换的新 token 作废了。已经加了单飞锁，测试通过。') +
        cl.tool('Bash', 'npm test -- auth', 'term');
      conv += allowed
        ? `<div class="tool">${ico('term', 13)}<b>Bash</b><code>${esc(AUTH_CMD)}</code></div>` + cl.status('3s · Pushing…')
        : cl.perm(AUTH_CMD);
      html += place('claude', claudeL, claudeWindow(t, { title: '排查登录偶发 401', on: 'auth', conv }),
        { opacity: sw, dy: (1 - sw) * 30, z: 2 });
    }

    const state = asking && !allowed ? 'waiting' : 'running';
    const tasks = asking ? s3Tasks(state, lt - C.ask)
      : s3Tasks('running').map((x) => x.id === 'auth' ? { ...x, sub: '在跑：npm test -- auth' } : x);
    html += scaled(adPanel(tasks), { ...P, z: 6 });

    // 通知横幅：从右边滑进来，点了之后收走
    const nin = ease(prog(lt, C.notify, C.notify + 0.4));
    const nout = ease(prog(lt, C.clickNote + 0.05, C.clickNote + 0.4));
    const ns = 1.55, nx = 1920 - 24 - 372 * ns + (1 - nin) * 620 + nout * 620;
    if (nin > 0 && nout < 1) {
      html += scaled(adNotify({ state: 'waiting', title: '排查登录偶发 401', body: '要执行：' + AUTH_CMD, agent: 'claude', cwd: 'demo/shop-api' }),
        { x: nx, y: 390, s: ns, z: 9 });
    }

    html += `<div class="chap" style="--c:${AD_STATES.waiting.color};opacity:${fade(lt, 0.3, 0.6, 99, 99)}"><i>⏸</i>等你<small>最值钱的信号</small></div>`;
    return {
      html,
      cursor: [{ at: 1.6, xy: [760, 620] }, { at: C.clickNote, sel: 'note', fx: 0.5, fy: 0.5 }, { at: C.clickAllow, sel: 'allow' }],
      clicks: [C.clickNote, C.clickAllow],
    };
  },
});
