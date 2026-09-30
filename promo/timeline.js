// 整片的时间轴：场景起点、场景内的关键时刻、旁白、音效。
// scene.js（浏览器）和 audio.mjs（Node）共用这一份，画面和声音靠它对齐 —— 改时间只改这里。
'use strict';
var TIMELINE = (function () {
  // 各场景起点（秒）
  const S = { s1: 0, s2: 8.3, s2b: 13.9, s3: 18.2, s4: 27.2, s5: 34, s6: 41.6, s7: 50.6, s8: 58.6, s9: 66.4 };
  const END = 72;

  // 开场的"剧中时间"：视频秒 → 从 14:00:00 起的秒
  function s1Story(t) {
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    if (t < 1.4) return ease(clamp(t / 1.4)) * 180;              // 14:00 → 14:03，它问出问题
    if (t < 2.4) return 180 + (t - 1.4) * 4;                      // 正常走几秒
    if (t < 6.2) return 184 + ease(clamp((t - 2.4) / 3.8)) * 1196; // 快进到 14:23
    return 1380 + (t - 6.2);                                      // 停住
  }

  // 场景内的关键时刻（相对场景起点的秒）
  const CUE = {
    s1: { ask: 1.5, reveal: 6.2 },
    s2: { converge: 0.9, logo: 1.35 },
    s3: { ask: 0.8, notify: 1.0, clickNote: 5.6, clickAllow: 7.0 },
    s4: { crash: 1.1, ff: [1.7, 3.7], stale: 3.8 },
    s5: { reply: 1.6, ff: [4.3, 5.9], done: 6.0 },
    s6: { done1: 0.6, done2: 1.3, click: 4.7 },
    s7: { cards: [0.3, 1.5, 4.3] },
    s8: {
      typing: [
        { at: 0.3, text: 'git clone https://github.com/longroad93/agentdesk && cd agentdesk', cps: 36 },
        { at: 2.5, text: 'npm link', cps: 14 },
        { at: 3.4, text: 'agentdesk init', cps: 17 },
      ],
      output: 4.5, ai: 5.3,
    },
    s9: { logo: 0.2 },
  };

  // 旁白：text 上字幕，say 给语音合成（英文缩写、文件名要换成念得出来的写法）
  const voice = [
    { id: 'v1', at: S.s1 + 1.9, text: '它三分钟就问完了。', big: true },
    { id: 'v2', at: S.s1 + 6.3, text: '你二十分钟后才发现。', html: '你<em>二十分钟后</em>才发现。', big: true },
    { id: 'v3', at: S.s2 + 0.5, text: 'agentdesk 把所有 AI 编程助手的状态，收到一个面板里。', say: 'agent desk，把所有 AI 编程助手的状态，收到一个面板里。' },
    { id: 'v4', at: S.s2b + 0.4, text: '它只回答一个问题：现在，有几个在等你？' },
    { id: 'v5', at: S.s3 + 0.5, text: 'Claude 一停下来等你确认，通知马上就到，要执行什么都写在上面。' },
    { id: 'v6', at: S.s4 + 0.3, text: '没有哪个 agent 会告诉你它崩了。超时没动静，就标成失联。' },
    { id: 'v7', at: S.s5 + 0.3, text: '主回合说完了，不等于活干完了。后台命令还在跑，就不会说完成。' },
    { id: 'v8', at: S.s6 + 0.3, text: '跑完了你没看，它就一直亮着。在 WorkBuddy 里点开过，这边自动消掉。' },
    { id: 'v9', at: S.s7 + 0.3, text: '零依赖。原生悬浮窗只有一百多 KB。接入新的 agent，只要写一个 JSON。', say: '零依赖。原生悬浮窗只有一百多 K B。接入新的 agent，只要写一个 JSON。' },
    { id: 'v10', at: S.s8 + 0.3, text: '三行命令装好。或者把仓库丢给你的 AI，让它照着 AGENTS.md 来。', say: '三行命令装好。或者把仓库丢给你的 AI，让它照着 AGENTS 点 M D 来。' },
    { id: 'v11', at: S.s9 + 0.4, text: 'agentdesk。哪个在等你，一眼就知道。', say: 'agent desk。哪个在等你，一眼就知道。', nosub: true },
  ];

  // 音效
  const sfx = [];
  const add = (at, kind, extra) => sfx.push(Object.assign({ at, kind }, extra));

  // 开场：剧中时间每走一秒响一下，快进时密到上限就不再加密
  for (let t = 0.1, last = -1, lastAt = -1, k = 0; t < CUE.s1.reveal; t += 1 / 240) {
    const s = Math.floor(s1Story(t));
    if (s !== last && t - lastAt >= 0.07) { add(t, 'tick', { k: k++ }); lastAt = t; }
    last = s;
  }
  add(CUE.s1.ask, 'pop');
  add(CUE.s1.reveal, 'hit');

  add(S.s2 + CUE.s2.converge, 'whoosh');
  add(S.s2 + CUE.s2.logo, 'chime');
  add(S.s2b + 0.5, 'whoosh', { gain: 0.5 });

  add(S.s3 + CUE.s3.notify, 'beep', { freqs: [880, 1174] });   // 就是面板自己"等你"的提示音
  add(S.s3 + CUE.s3.clickNote, 'click');
  add(S.s3 + CUE.s3.clickAllow, 'click');
  add(S.s3 + CUE.s3.clickAllow + 0.25, 'blip');

  add(S.s4 + CUE.s4.crash, 'thud');
  for (let i = 0; i < 16; i++) add(S.s4 + CUE.s4.ff[0] + (i / 16) * (CUE.s4.ff[1] - CUE.s4.ff[0]), 'tick', { k: i, gain: 0.6 });
  add(S.s4 + CUE.s4.stale, 'beep', { freqs: [660, 550, 440] });  // 面板"失联/失败"的提示音

  add(S.s5 + CUE.s5.reply, 'blip');
  for (let i = 0; i < 12; i++) add(S.s5 + CUE.s5.ff[0] + (i / 12) * (CUE.s5.ff[1] - CUE.s5.ff[0]), 'tick', { k: i, gain: 0.5 });
  add(S.s5 + CUE.s5.done, 'blip', { gain: 0.7 });

  add(S.s6 + CUE.s6.done1, 'blip');
  add(S.s6 + CUE.s6.done2, 'blip');
  add(S.s6 + CUE.s6.click, 'click');
  add(S.s6 + CUE.s6.click + 0.5, 'pop', { gain: 0.6 });   // 面板上那条跟着变成已读

  for (const c of CUE.s7.cards) add(S.s7 + c, 'whoosh', { gain: 0.7 });

  for (const line of CUE.s8.typing) {
    for (let i = 0; i < line.text.length; i++) if (line.text[i] !== ' ') add(S.s8 + line.at + i / line.cps, 'key', { k: i });
    add(S.s8 + line.at + line.text.length / line.cps + 0.12, 'enter');
  }
  add(S.s8 + CUE.s8.output, 'ding');
  add(S.s8 + CUE.s8.ai, 'whoosh', { gain: 0.5 });

  add(S.s9 + CUE.s9.logo, 'chime');

  return { S, END, CUE, s1Story, voice, sfx };
})();
