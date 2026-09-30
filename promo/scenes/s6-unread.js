// S6 未读：两个任务跑完了你还没看，头部写着「2 未看」。
// 已读以 agent 自己的记录为准：在 WorkBuddy 里点开那个任务（它自己的 unread 标记翻了），面板这条跟着变已读。
'use strict';

SCENES.push({
  id: 's6', start: TIMELINE.S.s6, end: TIMELINE.S.s7, fadeIn: 0.3, fadeOut: 0.3,
  render(lt, t) {
    const C = TIMELINE.CUE.s6;
    const wbL = { x: 64, y: 150, w: 1123, h: 760, s: 1.0 };
    const P = { x: 1920 - 40 - 340 * 1.55, y: 60, s: 1.55 };
    const d1 = lt >= C.done1, d2 = lt >= C.done2;
    const opened = lt >= C.click + 0.25;
    const readAt = C.click + 0.5;             // WorkBuddy 的已读写进它的库，面板亚秒级跟上
    const read = lt >= readAt;

    let html = menubar('WorkBuddy', '周四 15:34');
    html += place('wb', wbL, workbuddyWindow(t, {
      ...wbL, mode: opened ? 'done' : 'home', api: !d2 ? 'running' : opened ? 'read' : 'unread', story: 3000,
    }), { z: 1 });

    const tasks = [
      { id: 'refund', state: d1 ? 'done' : 'running', title: '重构退款流程', agent: 'codex', sub: d1 ? '退款逻辑已拆成独立模块，212 个测试全绿' : '在跑：pnpm test refund', when: d1 ? '刚刚' : '跑1时', unread: d1, flash: d1 ? 1 - prog(lt, C.done1, C.done1 + 0.8) : 0 },
      { id: 'api', state: d2 ? 'done' : 'running', title: '同步 API 文档', agent: 'workbuddy', sub: d2 ? '已完成：修正 12 处过期的接口说明' : '生成变更摘要', when: d2 ? '刚刚' : '跑42分', unread: d2 && !read, flash: d2 && !read ? 1 - prog(lt, C.done2, C.done2 + 0.8) : read ? 0.6 * (1 - prog(lt, readAt, readAt + 0.8)) : 0 },
      { id: 'bg', state: 'done', title: '后台跑全量 e2e', agent: 'claude', sub: '412 passed', when: '14分前', unread: false },
    ];
    const ao = fade(lt, C.done2 + 0.5, C.done2 + 0.9, C.click - 0.2, C.click + 0.1);
    const ro = fade(lt, readAt + 0.2, readAt + 0.5, 99, 99);
    html += scaled(adPanel(tasks) +
      adCallout('跑完了，你还没看', { side: 'left', color: AD_STATES.done.color, fg: '#fff', opacity: ao }) +
      adCallout('WorkBuddy 自己记着已读，这边跟着消掉', { side: 'below', color: '#fff', fg: '#1d1d1f', opacity: ro }), { ...P, z: 6 });
    html += `<div class="chap" style="--c:${AD_STATES.done.color};opacity:${fade(lt, 0.3, 0.6, 99, 99)}"><i>✓</i>完成了还没看<small>和没跑完是一回事</small></div>`;
    return {
      html,
      cursor: [{ at: 2.6, xy: [900, 700] }, { at: C.click, sel: 'wb-api' }],
      clicks: [C.click],
    };
  },
});
