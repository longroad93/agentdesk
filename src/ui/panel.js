// agentdesk 面板前端。浏览器和悬浮窗（WKWebView 壳）共用这一份。
'use strict';

const $ = id => document.getElementById(id);
const COMPACT = /[?&]compact=1/.test(location.search);
const CLIENT = Math.random().toString(36).slice(2, 10);
const RECENT_MS = 6 * 3600e3;
const BACKOFF = [90e3, 5 * 60e3, 15 * 60e3];      // 重提醒越来越稀，别一直 90 秒响一次

let STATES = {}, ATT = [], BUILD = null, TASKS = [], ON_SCREEN = null, NOTIFIER = null, HAS_EVENTS = true;
let expanded = false;

if (COMPACT) {
  document.body.classList.add('compact');
  $('allseen').textContent = '已读';
}

// ---- 悬浮窗的壳 ----
// 每次现查，不缓存 —— 壳注入 webkit 的时机不一定早于脚本执行
const shell = () => (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.panel) || null;
const inShell = () => !!(window.__shell || shell());
const markShell = () => { if (inShell()) document.body.classList.add('shell'); };
markShell();
setTimeout(markShell, 300);

// 这个页面能不能弹通知。悬浮窗走原生通知，授权状态由壳告诉我们（旧版壳不会告诉，当作不能）；
// 浏览器走 Notification API。服务端据此从所有打开的页面里挑一个负责弹通知。
function capability() {
  if (inShell()) return { cap: 'native', perm: (window.__shell && window.__shell.notify) || 'unknown' };
  if ('Notification' in window) return { cap: 'web', perm: Notification.permission };
  return { cap: 'none', perm: 'denied' };
}

// 壳在授权状态变化后回调这里
window.__shellNotify = status => {
  window.__shell = Object.assign({}, window.__shell, { notify: status });
  connect();
};

// ---- 和服务端的连接 ----
let es = null;
function connect() {
  if (es) es.close();
  const { cap, perm } = capability();
  es = new EventSource(`/events?client=${CLIENT}&cap=${cap}&perm=${perm}&compact=${COMPACT ? 1 : 0}`);
  es.onmessage = e => handle(JSON.parse(e.data));
  renderControls();
}

function handle(d) {
  if (d.build) {
    if (BUILD && d.build !== BUILD) { location.reload(); return; }
    BUILD = d.build;
  }
  if ('onScreen' in d) ON_SCREEN = d.onScreen;
  if ('notifier' in d) NOTIFIER = d.notifier;
  if (d.type !== 'sync') { renderControls(); return; }
  if (d.states) STATES = d.states;
  if (d.attention) ATT = d.attention;
  if ('hasEvents' in d) HAS_EVENTS = d.hasEvents;
  TASKS = d.tasks || [];
  render();
  renderControls();
  // 服务端已经挑好了：只有真的有新情况、而且不在你眼前的才会进 notify；由负责弹通知的那一个页面弹
  if (NOTIFIER === CLIENT && d.notify && d.notify.length) notify(d.notify);
}

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const markSeen = ids => { if (ids.length) post('/api/seen', { ids }); };
const openTask = id => post('/api/open', { id });

// ---- 渲染 ----
const isActive = t => t.state === 'waiting' || t.state === 'running' || t.state === 'bgrun';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function shortCwd(p) {
  if (!p) return '';
  return p.split(/[/\\]/).filter(Boolean).slice(-2).join('/');
}
function age(ms, short) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return short ? s + '秒' : s + ' 秒';
  const m = Math.floor(s / 60);
  if (m < 60) return short ? m + '分' : m + ' 分钟';
  const h = Math.floor(m / 60);
  return h < 24 ? (short ? h + '时' : h + ' 小时') : (short ? Math.floor(h / 24) + '天' : Math.floor(h / 24) + ' 天');
}

// 时间按状态说才有意义：在跑的是"跑了多久"，等你的是"等了你多久"，结束的是"多久前"
function when(t, now, short) {
  const since = x => age(now - x, short);
  switch (t.state) {
    case 'running': return (short ? '跑' : '已跑 ') + since(t.turn_at || t.started_at);
    case 'waiting': return (short ? '等' : '等了 ') + since(t.waiting_since || t.last_seen);
    case 'stale': return (short ? '断' : '没动静 ') + since(t.live_at || t.last_seen);
    case 'done': case 'failed': return since(t.done_at || t.last_seen) + (short ? '前' : '前');
    default: return since(t.last_seen) + (short ? '前' : '前');
  }
}

// 给人看的那一行：在跑的写正在干什么，等你的写要你干什么，完成的写它最后说了什么
function subline(t) {
  const text = t.state === 'running' ? (t.activity || t.prompt)
             : t.state === 'waiting' ? t.summary
             : (t.summary || t.prompt);
  if (!text) return '';
  const ask = t.state === 'done' && t.asks ? '<span class=ask title="最后一句是问句，可能在等你拍板（推测）">问</span>' : '';
  return ask + esc(text);
}

function classes(t) {
  return [
    'task', t.state,
    t.needs && 'needs',
    t.seen === false && 'unread',
    isActive(t) && 'active',
    !t.needs && !isActive(t) && 'quiet',
    t.confidence === 'guess' && 'guess',
  ].filter(Boolean).join(' ');
}

function card(t, now, groupstart) {
  const st = STATES[t.state] || { label: t.state, icon: '?', color: '#71717a' };
  const bgN = t.bg ? Object.keys(t.bg).length : 0;
  const sub = subline(t);
  const go = t.app ? `<button class=go data-go="${esc(t.id)}" title="切到 ${esc(t.app)}">${COMPACT ? '↗' : '打开 ↗'}</button>` : '';
  const head = `<div class="${classes(t)}${groupstart ? ' groupstart' : ''}" data-id="${esc(t.id)}" style="--bar:${st.color}">`;
  if (COMPACT) {
    const bits = [];
    if (bgN) bits.push(`⧗ ${bgN} 个后台`);
    return head +
      // 紧凑模式只有符号没有文字，鼠标停上去得能看出是什么状态
      `<span class=badge title="${esc(st.label)}">${st.mark || st.icon}</span>` +
      `<div class=main><div class=title>${esc(t.title)}</div>` +
      `<div class=sub><span class=who>${esc(t.agent)}</span> ${bits.map(esc).join(' · ')}${bits.length && sub ? ' · ' : ''}${sub}</div></div>` +
      `<span class=when>${esc(when(t, now, true))}${go}</span></div>`;
  }
  return head +
    '<span class=dot></span>' +
    `<span class=badge>${st.icon} ${esc(st.label)}</span>` +
    `<div class=main><div class=title>${esc(t.title)}</div>` +
    (sub ? `<div class=summary>${sub}</div>` : '') +
    `<div class=meta><span>${esc(t.agent)}${t.confidence === 'guess' ? ' (推测)' : ''}</span>` +
    (bgN ? `<span class=bgn>⏳ ${bgN} 个后台任务在跑</span>` : '') +
    (t.cwd ? `<code>${esc(shortCwd(t.cwd))}</code>` : '') +
    `<span>${esc(when(t, now, false))}</span>${go}</div></div></div>`;
}

// 主列表只放"当前的"：进行中的、需要你处理的一律显示，其余只留最近 6 小时，更早的收进折叠区。
// 以前没看过的旧任务也会被折叠：头部写着"3 未看"，列表里却一条都看不到。
// 需要你处理的有 24 小时的退场上限，不会无限堆积，没必要藏起来
function split(now) {
  const shown = [], folded = [];
  for (const t of TASKS) (expanded || isActive(t) || t.needs || now - t.last_seen < RECENT_MS ? shown : folded).push(t);
  return { shown, folded };
}

function render() {
  const list = $('list');
  const now = Date.now();
  if (!TASKS.length) {
    // 列表空了不等于坏了：看过的任务到点会自己退场
    list.innerHTML = '<div class=empty>' + (HAS_EVENTS
      ? '最近没有 agent 在动<br><br>跑完的任务看过之后会自己退场'
      : '还没有任何任务事件<br><br>跑一次 agentdesk init 接入你的 agent') + '</div>';
    document.title = 'agentdesk';
    setFavicon('#71717a', 0);
    $('count').textContent = '';
    $('allseen').style.display = 'none';
    document.body.classList.remove('alert');
    return;
  }

  const { shown, folded } = split(now);
  const firstEnded = shown.find(t => !isActive(t));
  list.innerHTML = shown.map(t => card(t, now, COMPACT && t === firstEnded && t !== shown[0])).join('') +
    (folded.length ? `<button id=more class=more>还有 ${folded.length} 条更早的（都处理过了）</button>`
      : expanded ? '<button id=more class=more>收起更早的</button>' : '');

  const need = TASKS.filter(t => t.needs);
  const waitN = need.filter(t => t.state === 'waiting').length;
  const badN = need.filter(t => t.state === 'failed' || t.state === 'stale').length;
  const unreadN = need.filter(t => t.state === 'done').length;
  document.title = (need.length ? `(${need.length}) ` : '') + 'agentdesk';
  const top = need.length ? (STATES[need[0].state] || {}).color : '#10b981';
  setFavicon(top || '#10b981', need.length);
  $('allseen').style.display = TASKS.some(t => t.seen === false) ? 'inline-block' : 'none';

  // 有东西在等你、或者出错了：整条头部染上它的颜色（悬浮窗折叠成一条时，这是唯一还看得见的）
  const alertState = waitN ? 'waiting' : badN ? need.find(t => t.state !== 'waiting' && t.state !== 'done').state : null;
  document.body.classList.toggle('alert', !!alertState);
  if (alertState) document.body.style.setProperty('--alert', STATES[alertState].color);

  const parts = [];
  if (COMPACT) {
    // 340px 宽放不下完整句子，用短的，否则标题栏会被挤到换行
    if (waitN) parts.push(waitN + ' 等你');
    if (badN) parts.push(badN + ' 出错');
    if (unreadN) parts.push(unreadN + ' 未看');
    $('count').textContent = parts.length ? parts.join(' · ') : TASKS.length + ' 个 · 都不用管';
  } else {
    if (waitN) parts.push(waitN + ' 个等你处理');
    if (badN) parts.push(badN + ' 个失败或失联');
    if (unreadN) parts.push(unreadN + ' 个完成了还没看');
    $('count').textContent = parts.length ? parts.join(' · ') : TASKS.length + ' 个任务 · 都不用管';
  }
}

// 按钮和"通知没生效"的提示
function renderControls() {
  const { cap, perm } = capability();
  const perm$ = $('perm');
  // 被拒绝时点按钮也没用（系统不会再弹授权框），原因写在下面的提示条里；紧凑模式地方小，直接不显示
  perm$.style.display = cap === 'none' || perm === 'granted' || perm === 'unknown' || (COMPACT && perm === 'denied') ? 'none' : '';
  perm$.textContent = perm === 'denied' ? '通知被拒绝' : '开启通知';
  const w = $('warn');
  // 有别的页面在负责弹通知就不用提醒；一个能弹的都没有，得明说 —— 这个工具最怕"装完了但没反应"
  if (NOTIFIER || !BUILD) { w.hidden = true; return; }
  let msg;
  const btn = `点右上角「${perm$.textContent}」`;
  if (cap === 'native' && perm === 'unknown') msg = '悬浮窗是旧版本，弹不了通知。重新运行 agentdesk panel';
  else if (cap === 'native') msg = perm === 'denied' ? '悬浮窗的通知被关了：系统设置 → 通知 → Agentdesk Panel → 允许通知' : '通知还没开：' + btn;
  else if (cap === 'web') msg = perm === 'denied' ? '浏览器拒绝了这个页面的通知：到浏览器的网站设置里允许 localhost' : '通知还没开：' + btn;
  else msg = '这个页面弹不了通知';
  // 悬浮窗被拒绝过：系统不会再弹授权框，点提示条直接打开系统的通知设置
  const openable = cap === 'native' && perm === 'denied';
  w.textContent = '⚠ 通知没生效：' + msg + (openable ? '（点这里打开设置）' : '');
  w.style.cursor = openable ? 'pointer' : '';
  w.onclick = openable ? () => { const s = shell(); if (s) s.postMessage({ action: 'requestNotify' }); } : null;
  w.hidden = false;
}

function setFavicon(color, n) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
  if (n) {
    x.fillStyle = '#fff'; x.font = 'bold 42px -apple-system,sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 32, 35);
  }
  let l = document.querySelector('link[rel=icon]');
  if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
  l.href = c.toDataURL();
}

// ---- 通知与提醒 ----
let muted = false;
try { muted = localStorage.getItem('ad_muted') === '1'; } catch {}
let actx = null;

// 系统通知可能被 OS 静默拦掉，声音不会 —— 不需要权限，跨平台行为一致。
// 浏览器要求用户先和页面交互过才允许出声，所以任何一次点击都顺手把音频激活
function audio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
  return actx;
}
document.addEventListener('click', audio);
function beep(freqs) {
  if (muted) return;
  const a = audio();
  if (!a) return;
  freqs.forEach((hz, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = 'sine'; o.frequency.value = hz;
    const t0 = a.currentTime + i * 0.16;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.14);
    o.start(t0); o.stop(t0 + 0.15);
  });
}

const reminded = {};      // id -> { at, n }

function show(t) {
  const st = STATES[t.state];
  if (!st || st.notify === 'never') return;
  const head = `${st.icon} ${st.label} · ${t.title || t.agent}`;
  const body = [t.summary || t.activity || t.prompt, t.agent + (t.cwd ? '  ·  ' + shortCwd(t.cwd) : '')].filter(Boolean).join('\n');
  const sound = !!st.sound && !muted;
  // 悬浮窗：交给壳发原生通知（WKWebView 里的网页通知权限拿不到，一申请就是 denied）
  if (inShell()) {
    const s = shell();
    if (s) s.postMessage({ action: 'notify', id: t.id, title: head, body, sound });
    return;
  }
  if (sound) beep(t.state === 'waiting' ? [880, 1174] : [660, 550, 440]);
  try {
    const n = new Notification(head, { body, tag: t.id, requireInteraction: st.notify === 'always' });
    n.onclick = () => { window.focus(); n.close(); onNotifyClick(t.id); };
  } catch {}
}

function notify(tasks) {
  for (const t of tasks) {
    reminded[t.id] = { at: Date.now(), n: 0 };
    show(t);
  }
}

// 点了通知：切到那个 agent 的窗口；通知对应的就是这一条，点了就是看到了
function onNotifyClick(id) {
  if (reminded[id]) reminded[id].at = Date.now() + 10 * 60e3;
  const t = TASKS.find(x => x.id === id);
  if (t && t.app) openTask(id);
  if (t && t.seen === false) markSeen([id]);
}
window.__onNotifyClick = onNotifyClick;

const onScreen = t => !!ON_SCREEN && t.agent === ON_SCREEN.agent &&
  (ON_SCREEN.key ? t.key === ON_SCREEN.key : t.agent !== 'claude');

// macOS 的横幅样式几秒就消失，一条通知很容易错过。没处理掉的会重提醒，间隔越来越长；
// 你正看着的、折叠起来的不提醒
setInterval(() => {
  if (NOTIFIER !== CLIENT) return;
  const now = Date.now();
  const visible = new Set(split(now).shown.map(t => t.id));
  for (const t of TASKS) {
    if (!t.needs || ATT.indexOf(t.state) < 0 || !visible.has(t.id) || onScreen(t)) continue;
    const r = reminded[t.id] || (reminded[t.id] = { at: now, n: 0 });
    if (now - r.at > BACKOFF[Math.min(r.n, BACKOFF.length - 1)]) {
      r.at = now; r.n++;
      show(t);
    }
  }
  for (const id of Object.keys(reminded)) if (!TASKS.some(t => t.id === id && t.needs)) delete reminded[id];
}, 30_000);

// ---- 交互 ----
$('list').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { e.stopPropagation(); openTask(go.getAttribute('data-go')); return; }
  if (e.target.closest('#more')) { expanded = !expanded; render(); return; }
  const card = e.target.closest('.task');
  if (!card) return;
  // 点卡片 = "我知道了"：没看过的完成、失败、失联都一样，点了就不再提醒
  const t = TASKS.find(x => x.id === card.getAttribute('data-id'));
  if (t && t.seen === false) markSeen([t.id]);
});

$('allseen').onclick = () => markSeen(TASKS.filter(t => t.seen === false).map(t => t.id));

$('perm').onclick = () => {
  const { cap } = capability();
  if (cap === 'native') { const s = shell(); if (s) s.postMessage({ action: 'requestNotify' }); return; }
  if (!('Notification' in window)) return alert('此浏览器不支持通知');
  Notification.requestPermission().then(connect);
};

// 二分法用：不经过 SSE、不经过服务端。能弹说明问题在事件推送，不能弹就是浏览器/系统层面
$('try').onclick = () => {
  beep([880, 1174]);
  if (!('Notification' in window)) return alert('此浏览器不支持通知 API');
  if (Notification.permission !== 'granted') return alert('当前权限: ' + Notification.permission + ' —— 先点「开启通知」');
  try {
    const n = new Notification('⏸ 等你 · 通知自检', {
      body: '这条是页面直接发的，没走服务端。\n看到它说明浏览器和系统都正常。',
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { alert('发送失败: ' + e.message); }
};

const muteBtn = $('mute');
function syncMute() { muteBtn.textContent = muted ? '🔕' : '🔔'; muteBtn.className = muted ? '' : 'on'; }
muteBtn.onclick = () => {
  muted = !muted;
  try { localStorage.setItem('ad_muted', muted ? '1' : '0'); } catch {}
  syncMute();
  if (!muted) beep([880, 1174]);
};
syncMute();

// 窗口尺寸归壳管，网页只发意图；壳改完再回调 __setCollapsed 同步样式
let folded = false;
window.__setCollapsed = on => {
  folded = !!on;
  document.body.classList.toggle('folded', folded);
  const b = $('fold');
  if (b) { b.textContent = folded ? '▸' : '▾'; b.title = folded ? '展开' : '收起'; }
};
$('fold').onclick = () => {
  const s = shell();
  if (s) s.postMessage({ action: folded ? 'expand' : 'collapse' });
};

// 相对时间要走动；数据不变也每 30 秒重画一次
setInterval(() => { if (TASKS.length) render(); }, 30_000);
connect();
