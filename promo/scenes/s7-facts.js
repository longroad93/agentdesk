// S7 三张事实卡。每个数都能在仓库里查到：
//   dependencies 是空的（package.json）；悬浮窗产物约 115KB（README / AGENTS.md）；
//   接新 agent 是一个 JSON（adapters/*.json）；Electron 那个对比是 README 里作者自己的说法。
'use strict';

SCENES.push({
  id: 's7', start: TIMELINE.S.s7, end: TIMELINE.S.s8, fadeIn: 0.3, fadeOut: 0.3,
  render(lt) {
    const C = TIMELINE.CUE.s7;
    const card = (i, inner) => {
      const k = ease(prog(lt, C.cards[i], C.cards[i] + 0.5));
      if (k <= 0) return '';
      return `<div class="fact" style="left:${130 + i * 570}px;top:${230 + (1 - k) * 40}px;opacity:${k}">${inner}</div>`;
    };
    // 115KB 和 Electron 的 100MB 放一根条里比，115KB 那一截细到几乎看不见 —— 这就是要说的
    const barK = ease(prog(lt, C.cards[1] + 0.4, C.cards[1] + 1.2));
    let html = '';
    html += card(0, `<div class="big">0</div><div class="lb">运行时依赖</div>
      <div class="ds">只用 Node 内置模块。测试也是 Node 自带的 <code style="font:16px var(--mono)">node --test</code>。</div>
      <pre>"dependencies": <span class="k">{}</span></pre>`);
    html += card(1, `<div class="big">115<small>KB</small></div><div class="lb">原生悬浮窗</div>
      <div class="ds">系统自带的 swiftc 现编译，约 3 秒。不装 Electron：为了显示十几行字装 100MB 运行时不值当。</div>
      <div class="bar"><i style="width:${Math.max(0.6, 0.12 * barK)}%;background:var(--waiting)"></i><i style="width:${99 * barK}%;background:rgba(255,255,255,.18)"></i></div>
      <div class="legend"><span>agentdesk panel</span><span>一个 Electron 运行时 ≈ 100MB</span></div>`);
    html += card(2, `<div class="big">1<small>个 JSON</small></div><div class="lb">接入一个新 agent</div>
      <div class="ds">不写代码。钩子、会话文件、sqlite 都能接。</div>
      <pre>{ <span class="k">"source"</span>: <span class="s">"sqlite"</span>,
  <span class="k">"rules"</span>: [
    { <span class="k">"when"</span>: <span class="s">"$.status == completed"</span>,
      <span class="k">"kind"</span>: <span class="s">"done"</span> } ] }</pre>`);
    return { html };
  },
});
