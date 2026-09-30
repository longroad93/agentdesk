// S1 开场：三个 agent 并排在跑，Claude 14:03 问出授权确认，你二十分钟后才发现。
'use strict';
const OPEN_LAYOUT = {
  claude: { x: 48, y: 132, w: CLAUDE_W, h: CLAUDE_H, s: 0.86 },
  codex: { x: 1108, y: 132, w: 1123, h: 500, s: 0.68 },
  wb: { x: 1108, y: 132 + 500 * 0.68 + 22, w: 1123, h: 500, s: 0.68 },
};
const fmtClock = (s) => {
  s = Math.floor(s);
  const h = 14 + Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

// 开场这段 Claude 的对话按剧中时间一条条出来：[出现时刻（秒）, html]
const OPEN_CONV = [
  [0, cl.user('把 dist 清掉重新打包，然后跑一遍 e2e')],
  [25, cl.text('先看一下现在的构建脚本。')],
  [45, cl.tool('Read', 'package.json')],
  [70, cl.tool('Read', 'scripts/build.mjs')],
  [110, cl.text('构建产物在 <code>dist/</code>，e2e 依赖新的产物。要先删掉旧产物再打包，这条命令会删除目录，先问你一下。')],
];
const REBUILD_CMD = 'rm -rf dist && npm run build && npm run e2e';

function openClaudeConv(story, tag) {
  let conv = OPEN_CONV.filter(([at]) => story >= at).map(([, h]) => h).join('');
  if (story >= 178) conv += cl.perm(REBUILD_CMD, tag);
  else conv += cl.status(`${Math.max(1, Math.floor(story - 110))}s · Waiting for Claude…`);
  return conv;
}

// 三个窗口在开场的样子，S2 接着用（收拢成悬浮窗那一下）
function openDesk(t, story, { e = [1, 1, 1], reveal = 0, tag = '', dim = null, extraDy = [0, 0, 0], opacity = [1, 1, 1] } = {}) {
  const glow = reveal * (0.75 + 0.25 * Math.sin(t * 6));
  const zoom = 1 + reveal * 0.02;
  const d = dim ?? reveal * 0.55;
  let html = halo(OPEN_LAYOUT.claude, glow * opacity[0], { zoom });
  html += place('claude', OPEN_LAYOUT.claude,
    claudeWindow(t, { title: '重新打包并跑 e2e', on: 'rebuild', conv: openClaudeConv(story, tag) }),
    { opacity: e[0] * opacity[0], dy: (1 - e[0]) * 40 + extraDy[0], zoom });
  html += place('codex', OPEN_LAYOUT.codex, codexWindow(t, { ...OPEN_LAYOUT.codex, story }),
    { opacity: e[1] * opacity[1], dy: (1 - e[1]) * 40 + extraDy[1], dim: d });
  html += place('wb', OPEN_LAYOUT.wb, workbuddyWindow(t, { ...OPEN_LAYOUT.wb, story }),
    { opacity: e[2] * opacity[2], dy: (1 - e[2]) * 40 + extraDy[2], dim: d });
  return html;
}

function waitedTag(story, scale) {
  if (scale <= 0) return '';
  const waited = Math.max(0, Math.floor((story - 180) / 60));
  const label = waited >= 1 ? `⏸ 已经等了你 ${waited} 分钟` : '⏸ 14:03 问你的';
  return `<div class="tag" style="transform:scale(${scale}) rotate(-2deg)">${label}</div>`;
}

SCENES.push({
  id: 's1', start: TIMELINE.S.s1, end: TIMELINE.S.s2, fadeIn: 0, fadeOut: 0.35,
  render(lt) {
    const C = TIMELINE.CUE.s1;
    const story = TIMELINE.s1Story(lt);
    const e = [0, 1, 2].map((i) => ease(prog(lt, 0.05 + i * 0.12, 0.75 + i * 0.12)));
    const reveal = ease(prog(lt, C.reveal, C.reveal + 0.5));
    const tag = waitedTag(story, outBack(prog(lt, C.ask, C.ask + 0.4)));

    // 前台是 ChatGPT（Codex）—— 你一直盯着的是它，没注意到 Claude 在等
    let html = menubar('ChatGPT', '周四 ' + fmtClock(story).slice(0, -3));
    html += openDesk(lt, story, { e, reveal, tag });
    html += clockPill(fmtClock(story), { ff: lt > 2.4 && lt < C.reveal, opacity: fade(lt, 0.3, 0.8, 99, 99) });
    return { html };
  },
});
