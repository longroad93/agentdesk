// 宣传片引擎：按时间挑场景、画字幕、摆鼠标、处理场景间的黑场。
// 所有画面都是 render(t) 的纯函数（鼠标位置会读 DOM 坐标，但只依赖这一帧的 DOM）。
// 预览：直接打开 index.html（实时循环；?t=30 从第 30 秒开始，空格暂停）。
// 录制：record.mjs 带 ?record 打开，逐帧调用 window.render(t)。
'use strict';

const stage = document.getElementById('stage');
const T = TIMELINE;
const SCENES = [];   // scenes/*.js 往这里注册：{ id, start, end, fadeIn, fadeOut, render(lt, t) }

// ---------- 场景共用的摆放工具 ----------
// L: { x, y, w, h, s } —— 原生尺寸 w×h，缩放 s 后左上角放在 (x, y)
function place(cls, L, inner, { opacity = 1, dx = 0, dy = 0, zoom = 1, dim = 0, z = 1, extra = '' } = {}) {
  if (opacity <= 0) return '';
  const s = L.s * zoom;
  // 放大时以窗口中心为基准，不往一边偏
  const x = L.x - (L.w * s - L.w * L.s) / 2 + dx, y = L.y - (L.h * s - L.h * L.s) / 2 + dy;
  return `<div class="win ${cls}" style="left:0;top:0;width:${L.w}px;height:${L.h}px;opacity:${opacity};z-index:${z};
    transform:translate(${x}px,${y}px) scale(${s});${extra}">
    ${inner}
    ${dim > 0 ? `<div class="dim" style="opacity:${dim}"></div>` : ''}
  </div>`;
}
function halo(L, o, { zoom = 1, z = 1, color = 'var(--waiting)' } = {}) {
  if (o <= 0) return '';
  const s = L.s * zoom, w = L.w * s, h = L.h * s;
  const x = L.x - (w - L.w * L.s) / 2, y = L.y - (h - L.h * L.s) / 2;
  return `<div class="halo" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:${o};z-index:${z};--hc:${color}"></div>`;
}
// 悬浮窗 / 通知：原生尺寸画好后整体缩放
function scaled(inner, { x, y, s, opacity = 1, z = 5, dx = 0, dy = 0 }) {
  if (opacity <= 0) return '';
  return `<div class="scaled" style="transform:translate(${x + dx}px,${y + dy}px) scale(${s});opacity:${opacity};z-index:${z}">${inner}</div>`;
}
function menubar(app, clock) {
  return `<div class="menubar"><b></b><b>${esc(app)}</b><span>文件</span><span>编辑</span><span>窗口</span>
    <span class="right">${esc(clock || '')}</span></div>`;
}
function clockPill(text, { ff = false, opacity = 1, label = '' } = {}) {
  if (opacity <= 0) return '';
  return `<div class="clock" style="opacity:${opacity}">${label ? `<span class="lb">${label}</span>` : ''}<span>${text}</span>
    ${ff ? '<span class="ff">▶▶ 快进</span>' : ''}</div>`;
}
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

// ---------- 字幕 ----------
const VD = (typeof VOICE_DUR === 'object' && VOICE_DUR) || {};
// ?nocap：不画字幕（截静态图用，比如 README 的头图）
const NOCAP = /[?&]nocap\b/.test(location.search);
function captions(t) {
  if (NOCAP) return '';
  let html = '';
  let any = false;
  T.voice.forEach((v, i) => {
    if (v.nosub) return;
    const next = T.voice[i + 1];
    const dur = VD[v.id] ?? v.text.length * 0.2;
    let end = v.until ?? (v.at + dur + 0.35);
    if (next) end = Math.min(end, next.at - 0.08);
    const o = fade(t, v.at - 0.05, v.at + 0.2, end - 0.2, end);
    if (o <= 0) return;
    any = true;
    const dy = (1 - ease(prog(t, v.at - 0.05, v.at + 0.25))) * 14;
    html += `<div class="cap${v.big ? ' big' : ''}" style="opacity:${o};transform:translateY(${dy}px)">${v.html || esc(v.text)}</div>`;
  });
  return (any ? '<div class="shade"></div>' : '') + html;
}

// ---------- 鼠标 ----------
// path: [{ at, sel } | { at, xy:[x,y] }]，clicks: [时刻]。sel 指向 data-a，取元素中心
const cursorCache = {};
function resolve(p) {
  if (p.xy) return p.xy;
  const el = stage.querySelector(`[data-a="${p.sel}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    cursorCache[p.sel] = [r.left + r.width * (p.fx ?? 0.5), r.top + r.height * (p.fy ?? 0.5)];
  }
  return cursorCache[p.sel] || null;
}
function drawCursor(lt, path, clicks = []) {
  if (!path || !path.length || lt < path[0].at - 0.25) return;
  const pts = path.map(resolve);
  let i = 0;
  while (i < path.length - 1 && lt >= path[i + 1].at) i++;
  let xy;
  if (i === path.length - 1 || lt < path[0].at) xy = pts[Math.min(i, pts.length - 1)] || pts.find(Boolean);
  else {
    const a = pts[i] || pts[i + 1], b = pts[i + 1] || a;
    // 每段先快后慢，最后 0.25 秒停在目标上（看起来像人在点）
    const k = ease(prog(lt, path[i].at, path[i + 1].at - 0.25));
    xy = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  if (!xy) return;
  const o = Math.min(1, (lt - path[0].at + 0.25) / 0.25);
  let press = 1, ring = '';
  for (const c of clicks) {
    if (lt >= c - 0.08 && lt < c + 0.12) press = 0.86;
    const r = prog(lt, c, c + 0.4);
    if (r > 0 && r < 1) ring += `<div class="ripple" style="left:${xy[0]}px;top:${xy[1]}px;transform:translate(-50%,-50%) scale(${0.3 + r});opacity:${1 - r}"></div>`;
  }
  stage.insertAdjacentHTML('beforeend', ring + `<div class="cursor" style="opacity:${o};transform:translate(${xy[0] - 3}px,${xy[1] - 2}px) scale(${press})">
    <svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 3-1.3-2.9-6.5h6.3z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg></div>`);
}

// ---------- 主渲染 ----------
function render(t) {
  t = Math.max(0, Math.min(T.END - 1e-6, t));
  const sc = SCENES.find((s) => t >= s.start && t < s.end) || SCENES[SCENES.length - 1];
  const lt = t - sc.start, dur = sc.end - sc.start;
  const out = sc.render(lt, t, dur);

  const fi = sc.fadeIn ?? 0.3, fo = sc.fadeOut ?? 0.3;
  const black = Math.max(fi ? 1 - ease(prog(lt, 0, fi)) : 0, fo ? ease(prog(lt, dur - fo, dur)) : 0);

  stage.innerHTML = out.html + captions(t) +
    (black > 0 ? `<div class="black" style="opacity:${black}"></div>` : '');
  if (out.cursor) drawCursor(lt, out.cursor, out.clicks);
}

window.render = render;
window.DURATION = T.END;
// 启动放在 boot.js：要等 scenes/*.js 都注册完
