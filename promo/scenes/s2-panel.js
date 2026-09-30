// S2 产品出场：三个窗口收拢成右上角的悬浮窗 → 悬浮窗特写，讲"现在有几个在等你"。
'use strict';

// 开场那三个任务在面板上的样子
const PANEL_OPEN = [
  { id: 'rebuild', state: 'waiting', title: '重新打包并跑 e2e', agent: 'claude', sub: '要执行：rm -rf dist && npm run build && npm run e2e', when: '等20分' },
  { id: 'refund', state: 'running', title: '重构退款流程', agent: 'codex', sub: '在跑：pnpm test --filter payments', when: '跑27分' },
  { id: 'api', state: 'running', title: '同步 API 文档', agent: 'workbuddy', sub: '检查 users 接口字段', when: '跑24分' },
];

SCENES.push({
  id: 's2', start: TIMELINE.S.s2, end: TIMELINE.S.s2b, fadeIn: 0.35, fadeOut: 0,
  render(lt, t) {
    const C = TIMELINE.CUE.s2;
    const story = TIMELINE.s1Story(99);           // 停在 14:23
    // 三个窗口往悬浮窗的位置缩下去、变淡
    const k = ease(prog(lt, C.converge - 0.5, C.converge + 0.5));
    const pull = (L) => ({ ...L, x: L.x + (1500 - L.x) * k * 0.55, y: L.y + (160 - L.y) * k * 0.45, s: L.s * (1 - 0.5 * k) });
    let html = menubar('ChatGPT', '周四 14:23');
    const lay = { claude: pull(OPEN_LAYOUT.claude), codex: pull(OPEN_LAYOUT.codex), wb: pull(OPEN_LAYOUT.wb) };
    const o = 1 - ease(prog(lt, C.converge - 0.2, C.converge + 0.5));
    if (o > 0) {
      html += place('claude', lay.claude, claudeWindow(t, { title: '重新打包并跑 e2e', on: 'rebuild', conv: openClaudeConv(story, '') }), { opacity: o });
      html += place('codex', lay.codex, codexWindow(t, { ...OPEN_LAYOUT.codex, story }), { opacity: o, dim: 0.55 * o });
      html += place('wb', lay.wb, workbuddyWindow(t, { ...OPEN_LAYOUT.wb, story }), { opacity: o, dim: 0.55 * o });
    }

    // 悬浮窗：从一个点弹出来，停在画面中间偏上，放大到能读清
    const pin = outBack(prog(lt, C.logo - 0.1, C.logo + 0.45));
    const s = 2.35 * Math.max(0.001, pin);
    const w = 340 * s;
    html += scaled(adPanel(PANEL_OPEN), { x: 960 - w / 2, y: 190 + (1 - pin) * 60, s, opacity: Math.min(1, pin * 1.5), z: 6 });
    // 片名
    const tt = ease(prog(lt, C.logo + 0.3, C.logo + 0.8));
    html += `<div class="s2-title" style="opacity:${tt};transform:translateY(${(1 - tt) * 14}px)">
      <img src="logo.svg" alt=""><span>agentdesk</span></div>`;
    return { html };
  },
});

// S2b 悬浮窗常驻在桌面右上角，你照常干活；头部计数"1 等你"高亮
SCENES.push({
  id: 's2b', start: TIMELINE.S.s2b, end: TIMELINE.S.s3, fadeIn: 0, fadeOut: 0.3,
  render(lt, t) {
    const story = TIMELINE.s1Story(99);
    const k = ease(prog(lt, 0.2, 1.1));
    // 从中间特写移到右上角，窗口们回到桌面上
    const s = 2.35 + (1.55 - 2.35) * k;
    const w = 340 * s;
    const x = (960 - w / 2) + ((1920 - 40 - 340 * 1.55) - (960 - w / 2)) * k;
    const y = 190 + (60 - 190) * k;
    const back = ease(prog(lt, 0.4, 1.2));
    // 一张普通的桌面：窗口叠着放，悬浮窗浮在最上面
    const L = {
      claude: { ...OPEN_LAYOUT.claude, s: 0.72, x: 60, y: 140 },
      wb: { ...OPEN_LAYOUT.wb, s: 0.5, x: 940, y: 140 },
      codex: { ...OPEN_LAYOUT.codex, s: 0.6, x: 1000, y: 430 },
    };
    let html = menubar('ChatGPT', '周四 14:23');
    html += place('wb', L.wb, workbuddyWindow(t, { ...OPEN_LAYOUT.wb, story }), { opacity: back, dy: (1 - back) * 30, z: 1 });
    html += place('claude', L.claude, claudeWindow(t, { title: '重新打包并跑 e2e', on: 'rebuild', conv: openClaudeConv(story, '') }), { opacity: back, dy: (1 - back) * 30, z: 2 });
    html += place('codex', L.codex, codexWindow(t, { ...OPEN_LAYOUT.codex, story }), { opacity: back, dy: (1 - back) * 30, z: 3 });
    const hl = fade(lt, 1.6, 2.0, 3.8, 4.2);
    // 指向头部计数的标注
    const ao = fade(lt, 1.7, 2.1, 3.8, 4.2);
    html += scaled(adPanel(PANEL_OPEN, { hl }) + adCallout('现在有几个在等你', { side: 'left', opacity: ao }), { x, y, s, z: 6 });
    return { html };
  },
});
