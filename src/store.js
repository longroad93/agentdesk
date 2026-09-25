// 事件存储：只追加的 JSONL + 内存投影。没有数据库，没有 schema 迁移。
import {
  appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync,
  renameSync, rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { GROUP, WITHIN_ACTIVE, needsAttention } from './states.js';
import { describeTool, ASKS_USER } from './transcript.js';

export const HOME = process.env.AGENTDESK_HOME || join(homedir(), '.agentdesk');
export const EVENTS_FILE = join(HOME, 'events.jsonl');
export const ROTATED_FILE = join(HOME, 'events.1.jsonl');
export const CONFIG_FILE = join(HOME, 'config.json');

const MAX_BYTES = 2 * 1024 * 1024;   // 超过就轮转，只留上一份
const DEFAULT_TIMEOUT = 15 * 60 * 1000;
const DEFAULT_RETENTION = 12 * 60 * 60 * 1000;   // 看过的完成任务保留多久
// 没看过的、失败的、失联的保留多久。已读能准确判定之前，这里是个止血的上限：
// 你在 agent 窗口里早看过了却没点面板，它就永远是未读、永远不退场。
const ATTENTION_RETENTION = 24 * 60 * 60 * 1000;
// "等你"要等多久才认为那个窗口其实已经关了。必须远大于常规超时：
// agent 在等你的时候本来就停着不动，拿常规超时判它会把"需要你处理"
// 误报成"崩了"—— 那是这个面板最不该犯的错。
const WAITING_STALE_MS = 6 * 60 * 60 * 1000;

export function ensureHome() {
  if (!existsSync(HOME)) mkdirSync(HOME, { recursive: true });
}

// Windows 上并发追加偶尔撞锁，重试三次
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function append(event) {
  ensureHome();
  const line = JSON.stringify({ ts: Date.now(), ...event }) + '\n';
  for (let i = 0; i < 3; i++) {
    try {
      appendFileSync(EVENTS_FILE, line);
      rotateIfNeeded();
      return true;
    } catch (err) {
      if (i === 2) throw err;
      sleepSync(10);
    }
  }
}

// 轮转用改名，不用"读出来砍掉前半再整份写回"：钩子是一个个独立进程在并发追加，
// 读和写之间别的进程追加的那几行会被覆盖掉 —— 丢的可能正好是一条"等你"。
// 改名是原子的，之后的追加按路径打开，自然落到新文件里。
export function rotateIfNeeded(maxBytes = MAX_BYTES) {
  try {
    if (statSync(EVENTS_FILE).size <= maxBytes) return false;
  } catch { return false; }
  const lock = EVENTS_FILE + '.rotating';
  try {
    mkdirSync(lock);                       // mkdir 是原子的，当锁用
  } catch {
    // 别的进程正在轮转；锁残留太久（进程崩了）就清掉，下次再来
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmdirSync(lock); } catch {}
    return false;
  }
  try {
    if (statSync(EVENTS_FILE).size > maxBytes) { renameSync(EVENTS_FILE, ROTATED_FILE); return true; }
    return false;
  } catch { return false; } finally {
    try { rmdirSync(lock); } catch {}
  }
}

export function loadEvents() {
  const out = [];
  for (const f of [ROTATED_FILE, EVENTS_FILE]) {
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      if (!l) continue;
      try { out.push(JSON.parse(l)); } catch { /* 写到一半的行 */ }
    }
  }
  return out;
}

export function loadConfig() {
  const defaults = { timeouts: { default: DEFAULT_TIMEOUT }, webhooks: [], port: 4517 };
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

export function saveConfig(cfg) {
  ensureHome();
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// 事件 kind -> 任务 state
const TRANSITIONS = {
  start:     'running',
  progress:  'running',
  waiting:   'waiting',
  done:      'done',
  failed:    'failed',
  stopped:   'idle',    // 被你中断了。你自己停的，你知道，不算未读
  heartbeat: null,      // 只更新 last_seen，不改状态
  seen:      null,      // 只翻已读标记
  read:      null,      // app 自己记的已读状态（WorkBuddy 的 unread 列）
  closed:    null,      // 特判见下
};

// 只有带状态的事件能建任务。
//   closed —— claude code 一重启，所有历史会话同时 SessionEnd，面板会瞬间多出十几条"已完成"
//   seen / read / heartbeat —— 日志轮转后会留下只剩这类事件的孤儿，建出来就是一条假的"失联"
const CREATES = new Set(['start', 'progress', 'waiting', 'done', 'failed']);
// last_seen 是"agent 最后一次真实活动"，排序和退场都靠它。
// 你点"已读"不是 agent 的活动；客户端重启时几十个会话同时 SessionEnd 也不是。
// 这两种事件以前都在刷 last_seen，结果点一次"全部已读"，37 条几天前的任务
// 全跳到了列表最前面，显示"7 分钟前"。
const NOT_ACTIVITY = new Set(['seen', 'closed', 'read']);

// 投影要看的文件系统信号都从 io 进来，测试时换成假的。
//   transcript(path)  → transcript.js 的 transcriptInfo
//   mtime(path)       → 文件修改时间，没有返回 0
//   subagentsMtime(p) → 子 agent transcript 的最新修改时间
//   background(task)  → { bg: {id: info}, busy: bool }：真后台任务 / 有前台工具正在执行
//   focusedAt(task)   → app 记录的"你最后一次点开这个会话"的时间
const NO_IO = {
  transcript: () => null, mtime: () => 0, subagentsMtime: () => 0,
  background: () => null, focusedAt: () => 0,
};

export function project(events, {
  now = Date.now(), timeouts = {}, retention, attentionRetention, skipRetention = false, io = {},
} = {}) {
  io = { ...NO_IO, ...io };
  const tasks = new Map();

  for (const ev of events) {
    if (!ev.agent || !ev.key) continue;
    // 旧版本写的后台事件。后台状态现在由扫目录现算，这些事件既不建任务也不算活动
    if (ev.kind === 'bg_start' || ev.kind === 'bg_done') continue;
    const id = `${ev.agent}:${ev.key}`;
    let t = tasks.get(id);
    if (!t) {
      if (!CREATES.has(ev.kind)) continue;
      t = {
        id, agent: ev.agent, key: ev.key,
        title: '', prompt: '', cwd: ev.cwd || '', summary: '', bg: {}, seen: true,
        state: 'running', started_at: ev.ts, last_seen: ev.ts, turn_at: ev.ts,
        confidence: ev.confidence || 'exact',
      };
      tasks.set(id, t);
    }

    if (ev.title) t.title = ev.title;
    if (ev.prompt) t.prompt = ev.prompt;
    if (ev.transcript) t.transcript = ev.transcript;
    if (ev.alive) t.alive = ev.alive;
    if (ev.entrypoint) t.entrypoint = ev.entrypoint;
    if (ev.cwd) t.cwd = ev.cwd;
    if (ev.summary) t.summary = ev.summary;
    // 摘要是绑在状态上的：waiting 时那句"需要授权"在任务完成后就是误导，得清掉
    else if (ev.kind === 'done' || ev.kind === 'failed' || ev.kind === 'start') t.summary = '';
    if (ev.confidence) t.confidence = ev.confidence;
    if (!NOT_ACTIVITY.has(ev.kind)) t.last_seen = ev.ts;

    if (ev.kind === 'seen') { t.seen = true; t.seen_at = ev.ts; continue; }
    if (ev.kind === 'read') {
      if (ev.value) { t.seen = true; t.seen_at = ev.ts; }
      else if (t.state === 'done' || t.state === 'failed') t.seen = false;
      continue;
    }
    // 回合结束 = 有东西等你看。但纠正型事件（auto）不是"又有新东西"，它只是把状态推回正轨；
    // 既然坏状态被撤销了，未读也该跟着撤，否则面板上会留一条谁都不会去点的"完成"。
    if (ev.kind === 'done' || ev.kind === 'failed') {
      t.done_at = ev.ts;
      // claude -p 这类无人值守的自动任务，没有人会去 UI 里看它：完成不算未读，失败照样提醒
      if (!ev.auto) t.seen = ev.kind === 'done' && t.entrypoint === 'sdk-cli';
      else if (t.state === 'failed') t.seen = true;
    }
    // 你重新在这个会话里说话，说明你回来了，自动算已读。
    // 后台任务完成通知这类注入的"输入"会开新一轮，但不代表你回来了。
    if (ev.kind === 'start') {
      t.turn_at = ev.ts;
      if (!ev.machine) t.seen = true;
    }
    if (ev.kind === 'waiting') t.waiting_since = ev.ts;

    if (ev.kind === 'closed') {
      // 会话关掉了：跑到一半的算结束，已完成的保持完成
      if (t.state === 'running' || t.state === 'waiting') t.state = 'done';
    } else {
      const next = TRANSITIONS[ev.kind];
      if (next) t.state = next;
    }
  }

  const list = [...tasks.values()];
  for (const t of list) derive(t, io, now, timeouts);
  return (skipRetention ? list : applyRetention(list, { now, retention, attentionRetention })).sort(byUrgency);
}

// 事件只记录"发生过什么"，此刻的状态还要结合文件系统现看。关键是每次投影现算、不写事件 ——
// 用事件表达持续观察出来的状态，只会把状态钉死。
function derive(t, io, now, timeouts) {
  const info = t.transcript ? io.transcript(t.transcript) : null;
  // 属于当前这一轮的信号才算（一秒宽限：钩子和 transcript 写入的先后不固定）
  const inTurn = at => at && at >= (t.turn_at || 0) - 1000;
  const tool = info?.tool && inTurn(info.tool.at) ? info.tool : null;

  // 会话标题是 agent 后来才生成的，钩子触发那一刻读不到很正常，每次投影都再试一次
  if (!t.title) {
    t.title = info?.title
      || (t.prompt ? titleFromPrompt(t.prompt)
      : t.cwd ? (t.cwd.split(/[/\\]/).filter(Boolean).pop() || t.cwd)
      : t.key.slice(0, 12));
  }

  if (info) {
    // 在问你问题 / 等你批准计划：工具一挂起就是在等你，不需要等 Notification 钩子
    if (tool && ASKS_USER.has(tool.name) && (t.state === 'running' || t.state === 'waiting')) {
      if (t.state !== 'waiting' || !t.waiting_since || t.waiting_since < tool.at - 5000) t.waiting_since = tool.at;
      t.state = 'waiting';
    }
    // "等你确认"是瞬时事件：你批准之后 agent 继续干活，不会再触发任何钩子。
    // transcript 在那条 waiting 之后还在写，就说明早就不等了（宽限 15 秒：钩子触发的当下本来就会写一笔）
    if (t.state === 'waiting' && !(tool && ASKS_USER.has(tool.name))
        && t.waiting_since && info.mtime > t.waiting_since + 15_000) t.state = 'running';
    // API 报错（过载、断线、登录过期）会直接结束这一轮，没有任何钩子告诉你
    if (info.apiError && inTurn(info.apiError.at) && ['running', 'waiting', 'done'].includes(t.state)) {
      t.state = 'failed';
      t.summary = info.apiError.text;
      t.done_at = Math.max(t.done_at || 0, info.apiError.at);
      t.seen = (t.seen_at || 0) > info.apiError.at;
    }
    // 中断没有钩子，但 transcript 里会写一条 [Request interrupted by user]。
    // 以前靠"90 秒没写就算停了"，长命令、长回复全被误判
    if (t.state === 'running' && inTurn(info.interruptedAt) && !tool && !info.generating) t.state = 'idle';
  }

  // 后台任务不看事件看目录，而且得和 transcript 对上：前台命令跑的时候也会开 .output
  const bgInfo = io.background(t);
  if (bgInfo) { t.bg = bgInfo.bg || {}; t.busy = !!bgInfo.busy; }
  if (Object.keys(t.bg).length && (t.state === 'done' || t.state === 'idle')) t.state = 'bgrun';
  // 批准之后命令开始执行，但命令跑完之前 transcript 一个字都不写 —— 有前台工具正在执行就说明不等了
  if (t.state === 'waiting' && t.busy && !(tool && ASKS_USER.has(tool.name))) t.state = 'running';

  // 没有任何 agent 会主动告诉你"我死了"，只能靠超时兜住。
  // 长时间没有新事件不等于失联：transcript、会话流文件、子 agent 还在写就说明活着
  if ((t.state === 'running' || t.state === 'waiting') && !t.busy) {
    const base = timeouts[t.agent] ?? timeouts.default ?? DEFAULT_TIMEOUT;
    // "等你"用一把长得多的尺子量，理由见 WAITING_STALE_MS
    const limit = t.state === 'waiting' ? Math.max(base * 8, WAITING_STALE_MS) : base;
    const live = Math.max(t.last_seen, io.mtime(t.transcript), io.mtime(t.alive), io.subagentsMtime(t.transcript));
    if (now - live > limit) {
      t.stale_from = t.state;
      t.state = 'stale';
      t.live_at = live;
      t.stale_at = live + limit;
      // 失联是现算出来的状态，"看过"要晚于它变成失联的那一刻才算
      t.seen = (t.seen_at || 0) > t.stale_at;
    }
  }

  // 已读以 app 自己的记录为准：完成之后你在 app 里点开过这个会话，就是看过了
  if (t.seen === false && ['done', 'failed', 'stale'].includes(t.state)) {
    const since = t.state === 'stale' ? t.stale_at : t.done_at;
    const f = io.focusedAt(t);
    if (since && f > since) { t.seen = true; t.seen_via = 'app'; }
  }

  // 给人看的那一行：在跑的写正在干什么，等你的写要你干什么，完成的写它最后说了什么
  if (t.state === 'running') t.activity = tool ? describeTool(tool, 'run') : info?.generating ? '思考中' : '';
  if (t.state === 'waiting') {
    if (tool) t.summary = describeTool(tool, 'ask');
    else t.summary = localizeNotice(t.summary);
  }
  if (t.state === 'done' && !t.summary && info?.lastReply && inTurn(info.replyAt)) t.summary = info.lastReply;
  if (t.state === 'done') t.asks = /[?？]\s*$/.test(t.summary || '');
  t.needs = needsAttention(t);
}

// Claude 的 Notification 消息是英文的，而且"permission to use AskUserQuestion"其实是在问你问题
function localizeNotice(s) {
  const m = String(s || '').match(/needs your permission to use (.+)$/i);
  if (m) return m[1].trim() === 'AskUserQuestion' ? '在问你问题' : `要授权：${m[1].trim()}`;
  if (/waiting for your input/i.test(s || '')) return '等你输入';
  return s;
}

// 面板会无限增长。已经看过的完成任务过一段时间就该退场；
// 没看过的、还需要你处理的、后台还在跑的留得久一点 —— 那正是这个面板存在的意义。
export function applyRetention(tasks, { now = Date.now(), retention, attentionRetention } = {}) {
  const keepMs = retention ?? DEFAULT_RETENTION;
  const attnMs = attentionRetention ?? ATTENTION_RETENTION;
  return tasks.filter(t => {
    // 真在跑的无论多久都留着——那是"现在"，不是历史
    if (t.state === 'running' || t.state === 'bgrun' || Object.keys(t.bg || {}).length) return true;
    return now - t.last_seen <= (needsAttention(t) ? attnMs : keepMs);
  });
}

// 没有会话标题时拿第一句话凑。claude code 的 prompt 常以 @文件引用 开头，
// 那种当标题就是一串路径，剥掉再取。
function titleFromPrompt(p) {
  let s = String(p).trim();
  s = s.replace(/^(@"[^"]*"\s*|@\S+\s*)+/, '').trim();
  if (!s) s = String(p).trim();
  const m = s.match(/^[^。！？!?\n]{4,60}/);
  return (m ? m[0] : s.slice(0, 40)).trim();
}

// 先按组（进行中 / 已结束），组内按时间。见 states.js 的 GROUP。
export function byUrgency(a, b) {
  const g = (GROUP[a.state] ?? 1) - (GROUP[b.state] ?? 1);
  if (g !== 0) return g;
  if (GROUP[a.state] === 0) {
    const w = (WITHIN_ACTIVE[a.state] ?? 9) - (WITHIN_ACTIVE[b.state] ?? 9);
    if (w !== 0) return w;
  }
  return b.last_seen - a.last_seen;   // 组内一律最近的在前
}
