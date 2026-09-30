// 最后加载：场景都注册完了再开始画。
'use strict';
SCENES.sort((a, b) => a.start - b.start);

// 预览模式：实时循环播放，带声音（有 out/promo-audio.m4a 的话）；
// ?t=30 从第 30 秒开始，空格暂停/继续。录制时 record.mjs 带 ?record 打开，不自动播
if (!location.search.includes('record')) {
  const q = new URLSearchParams(location.search);
  const audio = new Audio('out/promo-audio.m4a');
  let offset = Number(q.get('t') || 0), t0 = performance.now(), paused = false, at = offset;
  const play = () => { audio.currentTime = at; audio.play().catch(() => {}); };
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    paused = !paused;
    if (paused) audio.pause();
    else { offset = at; t0 = performance.now(); play(); }
  });
  // 浏览器要求先有一次交互才让出声
  addEventListener('click', () => { if (!paused) play(); }, { once: true });
  const loop = (now) => {
    if (!paused) {
      const next = offset + (now - t0) / 1000;
      if (next >= DURATION) { offset = 0; t0 = now; at = 0; play(); } else at = next;
      render(at);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  render(0);
}
