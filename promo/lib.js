// 场景共用的小工具和图标。全是普通 <script>，直接双击 index.html 也能跑。
'use strict';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// 淡入淡出：a→b 进，c→d 出
const fade = (t, a, b, c, d) => Math.min(ease(prog(t, a, b)), 1 - ease(prog(t, c, d)));
const fmtDur = (s) => `${Math.floor(s / 60)}m ${String(Math.floor(s) % 60).padStart(2, '0')}s`;

// 16×16 描边图标，颜色跟随 currentColor
const ICONS = {
  folder: '<path d="M2 4.8c0-.8.6-1.4 1.4-1.4h2.8l1.4 1.4h4.9c.8 0 1.4.6 1.4 1.4v5c0 .8-.6 1.4-1.4 1.4H3.4c-.8 0-1.4-.6-1.4-1.4z"/>',
  folderOpen: '<path d="M2 11.6V4.8c0-.8.6-1.4 1.4-1.4h2.8l1.4 1.4h4.2c.8 0 1.4.6 1.4 1.4v.6"/><path d="M2 11.6 3.6 7.4c.2-.5.6-.8 1.1-.8h8.6c.6 0 1 .6.8 1.1l-1.4 3.9c-.2.5-.6.8-1.1.8H2.9z"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.3 3.3"/>',
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.2H3z"/><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>',
  home: '<path d="M2.5 7.2 8 2.8l5.5 4.4V13a.6.6 0 0 1-.6.6H9.8V10H6.2v3.6H3.1a.6.6 0 0 1-.6-.6z" fill="currentColor"/>',
  clock: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  edit: '<path d="M13 8.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3.5"/><path d="m11.3 2.7 2 2L8 10H6V8z"/>',
  chevD: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  chevR: '<path d="M6.5 4.5 10 8l-3.5 3.5"/>',
  left: '<path d="M13 8H3.5M7.5 4l-4 4 4 4"/>',
  right: '<path d="M3 8h9.5M8.5 4l4 4-4 4"/>',
  sidebar: '<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M6.5 3v10"/>',
  mic: '<rect x="6" y="2.5" width="4" height="7" rx="2"/><path d="M4 8a4 4 0 0 0 8 0M8 12v2"/>',
  laptop: '<rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/>',
  term: '<path d="M3 4.5 6.5 8 3 11.5M8 12h5"/>',
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  dots: '<path d="M8 3.5h.01M8 8h.01M8 12.5h.01" stroke-width="2.2"/>',
  library: '<rect x="2.5" y="3" width="2.6" height="10" rx=".5"/><rect x="6.2" y="3" width="2.6" height="10" rx=".5"/><path d="m10 3.5 2.4-.6 2 9.5-2.4.6z"/>',
  cube: '<path d="M8 2.5 13 5v6l-5 2.5L3 11V5z"/><path d="m3 5 5 2.5L13 5M8 7.5v6"/>',
  at: '<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.2"/>',
  help: '<circle cx="8" cy="8" r="5.6"/><path d="M6.4 6.4a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.1M8 11v.2"/>',
  filter: '<path d="M3 3.5h10L9.2 8.3V13l-2.4-1.2V8.3z"/>',
  assist: '<rect x="3" y="3" width="10" height="10" rx="3"/><circle cx="8" cy="7" r="1.6"/><path d="M5.5 11.5c.6-1.2 1.5-1.8 2.5-1.8s1.9.6 2.5 1.8"/>',
  project: '<circle cx="5" cy="5" r="2"/><circle cx="11" cy="11" r="2"/><path d="M7 5h2a2 2 0 0 1 2 2v2"/>',
  expert: '<circle cx="8" cy="8" r="5.6"/><path d="M5.8 7h.01M10.2 7h.01M5.8 10c1.2 1 3.2 1 4.4 0"/>',
  alarm: '<circle cx="8" cy="8.6" r="5"/><path d="M8 6.2v2.6l1.6 1M3 3.6l1.6-1.3M13 3.6l-1.6-1.3"/>',
  book: '<path d="M2.5 4c2-.8 3.8-.8 5.5.5 1.7-1.3 3.5-1.3 5.5-.5v8.5c-2-.8-3.8-.8-5.5.5-1.7-1.3-3.5-1.3-5.5-.5zM8 4.5V13"/>',
  grid: '<circle cx="5" cy="5" r="1.8"/><circle cx="11" cy="5" r="1.8"/><circle cx="5" cy="11" r="1.8"/><path d="M11 9v4M9 11h4"/>',
  newtask: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5.5v5M5.5 8h5"/>',
  cowork: '<path d="M3 4.5h3M3 8h5M3 11.5h3M9.5 4.5 13 4.5M10.5 8H13M9.5 11.5H13"/>',
  code: '<path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5M9 3.5l-2 9"/>',
  ret: '<path d="M13 4v4.5H4M6.5 6 4 8.5 6.5 11"/>',
  newwin: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.5v5M5.5 8h5"/>',
  shield: '<path d="M8 2.5 13 4.5V8c0 3-2.2 5-5 5.8C5.2 13 3 11 3 8V4.5z"/><path d="M8 5.5v3l1.5 1"/>',
  up: '<path d="M8 13V3.5M4 7.5l4-4 4 4"/>',
  wave: '<path d="M4 6.5v3M6.5 4.5v7M9 5.5v5M11.5 7v2"/>',
  check: '<path d="m4.5 8.2 2.3 2.3 4.7-5"/>',
};
function ico(name, size = 14, sw = 1.35) {
  return `<svg class="ic" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// Claude 的橙色星芒（侧栏底部账号行）
function spark(size = 16, color = '#d97757') {
  let p = '';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + 0.2, r = i % 2 ? 6 : 7.4;
    const f = (v) => v.toFixed(2);
    p += `<path d="M${f(8 + Math.cos(a) * 1.4)} ${f(8 + Math.sin(a) * 1.4)}L${f(8 + Math.cos(a) * r)} ${f(8 + Math.sin(a) * r)}"/>`;
  }
  return `<svg class="ic" viewBox="0 0 16 16" width="${size}" height="${size}" stroke="${color}" stroke-width="1.7" stroke-linecap="round">${p}</svg>`;
}

// 红黄绿三个窗口按钮：cx 是第一个圆心的 x，gap 是圆心间距
function lights(cx, cy, d = 12, gap = 19) {
  return ['#ff5f57', '#febc2e', '#28c840']
    .map((c, i) => `<span class="tl" style="left:${cx + i * gap - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;background:${c}"></span>`)
    .join('');
}

// 转圈：角度跟视频时间走（不是剧中时间），快进时也是匀速转
function spinner(t, size = 10) {
  return `<span class="spin" style="width:${size}px;height:${size}px;transform:rotate(${(t * 360) % 360}deg)"></span>`;
}
