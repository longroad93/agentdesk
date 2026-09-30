// S8 安装：三行命令，输出照 src/init.js 的真实格式。
// npm 包名还没注册，所以只写源码安装（README 原话）。
// 右边：或者把仓库丢给 AI，让它照着 AGENTS.md 装 —— 那三步系统授权它会停下来交给你。
'use strict';

SCENES.push({
  id: 's8', start: TIMELINE.S.s8, end: TIMELINE.S.s9, fadeIn: 0.3, fadeOut: 0.4,
  render(lt, t) {
    const C = TIMELINE.CUE.s8;
    const lines = [];
    let caretOn = null;
    for (const [i, ln] of C.typing.entries()) {
      if (lt < ln.at) break;
      const n = Math.min(ln.text.length, Math.floor((lt - ln.at) * ln.cps));
      const typedAll = n >= ln.text.length;
      lines.push(`<span class="p">~/code $</span> ${esc(ln.text.slice(0, n))}`);
      caretOn = lines.length - 1;
      const enterAt = ln.at + ln.text.length / ln.cps + 0.12;
      if (typedAll && lt >= enterAt) {
        caretOn = null;
        if (i === 0) lines.push('<span class="d">Cloning into \'agentdesk\'... done.</span>');
        if (i === 1) lines.push('<span class="d">added 1 package in 312ms</span>');
      }
    }
    if (lt >= C.output) {
      // 和 init.js 打印的一模一样（name 左对齐 10 格）
      const out = [
        ['ok', 'claude    ', '已接入 4 个 hook (UserPromptSubmit, Notification, Stop, SessionEnd)'],
        ['skip', 'kimi      ', '未检测到'],
      ];
      for (const [st, name, msg] of out) lines.push(`  <span class="${st === 'ok' ? 'ok' : 'd'}">${st === 'ok' ? '✓' : '–'}</span> ${name}${esc(msg)}`);
      lines.push('');
      lines.push('  配置已写入，原文件都留了 .agentdesk-backup');
      lines.push('  下一步: agentdesk');
    }
    const body = lines.map((l, i) => l + (i === caretOn ? `<span class="caret" style="opacity:${Math.floor(t * 2.4) % 2 ? 1 : 0.15}"></span>` : '')).join('\n');

    const ai = ease(prog(lt, C.ai, C.ai + 0.5));
    // AI 卡片出来时，终端往左让一点
    const tx = 150 - ai * 60;
    let html = `<div class="term" style="left:${tx}px;top:150px;width:1040px;height:560px">
      <div class="tb">${lights(20, 19, 12, 20)}zsh — agentdesk</div><div class="body">${body}</div></div>`;
    if (ai > 0) {
      html += `<div class="ai-card" style="left:1170px;width:640px;top:${440 + (1 - ai) * 40}px;opacity:${ai}">
        <div class="h"><img src="assets/claude.png" alt=""><img src="assets/codex.png" alt="">或者，交给你的 AI</div>
        读这个仓库的 <code>AGENTS.md</code>，帮我把 agentdesk 装好。
        <div style="font-size:14px;color:#8a8984;margin-top:12px">每一步它都会验证。系统弹出授权框的那三步，它会停下来交给你本人点。</div>
      </div>`;
    }
    return { html };
  },
});
