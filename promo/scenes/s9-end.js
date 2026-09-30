// S9 结尾：logo + slogan + 仓库地址 + 支持的 agent + 商标声明。
'use strict';

SCENES.push({
  id: 's9', start: TIMELINE.S.s9, end: TIMELINE.END, fadeIn: 0.4, fadeOut: 0.8,
  render(lt) {
    const C = TIMELINE.CUE.s9;
    const k = (a) => ease(prog(lt, C.logo + a, C.logo + a + 0.6));
    const up = (a) => `opacity:${k(a)};transform:translateY(${(1 - k(a)) * 18}px)`;
    const html = `<div class="endcard">
      <img src="logo.svg" alt="" style="opacity:${k(0)};transform:scale(${0.85 + 0.15 * outBack(prog(lt, C.logo, C.logo + 0.6))})">
      <div class="n" style="${up(0.15)}">agentdesk</div>
      <div class="sl" style="${up(0.5)}">哪个在<em>等你</em>，一眼就知道</div>
      <div class="url" style="${up(0.9)}">github.com/longroad93/agentdesk</div>
      <div class="agents" style="${up(1.3)}">
        <img src="assets/claude.png" alt=""><img src="assets/codex.png" alt=""><img src="assets/workbuddy.png" alt="">
        <span>Claude Code · Codex · WorkBuddy · 任意命令</span></div>
      <div class="tm" style="opacity:${k(1.6)}">Claude、Codex、WorkBuddy 为其各自所有者的商标。片中界面为示意，任务数据为演示数据。</div>
    </div>`;
    return { html };
  },
});
