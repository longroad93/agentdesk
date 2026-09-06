// 事件存储：只追加的 JSONL + 内存投影。没有数据库，没有 schema 迁移。
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP, WITHIN_ACTIVE } from './states.js';
import { homedir } from 'node:os';

export const HOME = process.env.AGENTDESK_HOME || join(homedir(), '.agentdesk');
export const EVENTS_FILE = join(HOME, 'events.jsonl');
export const CONFIG_FILE = join(HOME, 'config.json');

const MAX_BYTES = 2 * 1024 * 1024;   // 超过就砍掉前半，日志不需要永久保留
const DEFAULT_TIMEOUT = 15 * 60 * 1000;
const IDLE_TURN_MS = 90 * 1000;   // transcript 停笔多久算这一轮停了
const DEFAULT_RETENTION = 12 * 60 * 60 * 1000;   // 看过的完成任务保留多久

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

function rotateIfNeeded() {
  try {
    if (statSync(EVENTS_FILE).size <= MAX_BYTES) return;
    const lines = readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
    writeFileSync(EVENTS_FILE, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
  } catch { /* 轮转失败不影响写入 */ }
}

export function loadEvents() {
  if (!existsSync(EVENTS_FILE)) return [];
  return readFileSync(EVENTS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
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

// 事件 kind -> 任务 state。只有五个状态，多了你也不会看。
const TRANSITIONS = {
  start:     'running',
  progress:  'running',
  waiting:   'waiting',
  done:      'done',
  failed:    'failed',
  heartbeat: null,      // 只更新 last_seen，不改状态
  seen:      null,      // 只翻已读标记
  bg_start:  null,      // 后台任务另算，见下面特判
  bg_done:   null,
  closed:    null,      // 特判见下
};

export function project(events, { now = Date.now(), timeouts = {}, retention } = {}) {
  const tasks = new Map();

  for (const ev of events) {
    if (!ev.agent || !ev.key) continue;
    const id = `${ev.agent}:${ev.key}`;
    let t = tasks.get(id);
    if (!t) {
      // SessionEnd 不能凭空建任务。claude code 一重启，所有历史会话同时 SessionEnd，
      // 否则面板瞬间多出十几条你根本没在跑的"已完成"。
      // done/waiting 可以建 —— codex 那类只有回合结束事件、没有开始事件。
      if (ev.kind === 'closed') continue;
      t = {
        id, agent: ev.agent, key: ev.key,
        title: '', prompt: '', cwd: ev.cwd || '', summary: '', bg: {}, seen: true,
        state: 'running', started_at: ev.ts, last_seen: ev.ts,
        confidence: ev.confidence || 'exact',
      };
      tasks.set(id, t);
    }

    if (ev.title) t.title = ev.title;
    if (ev.prompt) t.prompt = ev.prompt;
    if (ev.transcript) t.transcript = ev.transcript;
    if (ev.cwd) t.cwd = ev.cwd;
    if (ev.summary) t.summary = ev.summary;
    // 摘要是绑在状态上的：waiting 时那句"需要授权"在任务完成后就是误导，得清掉
    else if (ev.kind === 'done' || ev.kind === 'failed' || ev.kind === 'start') t.summary = '';
    if (ev.confidence) t.confidence = ev.confidence;
    // last_seen 是"agent 最后一次真实活动"，排序和退场都靠它。
    // 你点"已读"不是 agent 的活动；客户端重启时几十个会话同时 SessionEnd 也不是。
    // 这两种事件之前都在刷 last_seen，结果点一次"全部已读"，37 条几天前的任务
    // 全跳到了列表最前面，显示"7 分钟前"。
    if (ev.kind !== 'seen' && ev.kind !== 'closed') t.last_seen = ev.ts;

    if (ev.kind === 'seen') { t.seen = true; continue; }
    // 回合结束 = 有东西等你看。用户重新在这个会话里说话，说明他回来了，自动算已读。
    // 但纠正型事件（auto）不是"又有新东西"，它只是把状态推回正轨；
    // 而且既然坏状态被撤销了，未读也该跟着撤，否则面板上会留一条谁都不会去点的"完成"。
    if (ev.kind === 'done' || ev.kind === 'failed') {
      if (!ev.auto) t.seen = false;
      else if (t.state === 'failed' || t.state === 'stale') t.seen = true;
    }
    if (ev.kind === 'start') t.seen = true;

    // 后台任务状态不走事件，由服务端扫 tasks/ 目录现算（见 server.js 的 snapshot）。
    // 事件是一次性的：bg_start 没等到配对的 bg_done，状态就被永久钉在"后台跑着"。
    if (ev.kind === 'bg_start' || ev.kind === 'bg_done') continue;

    if (ev.kind === 'closed') {
      // 会话关掉了：跑到一半算失败，已完成的保持完成
      if (t.state === 'running' || t.state === 'waiting') t.state = 'done';
    } else {
      const next = TRANSITIONS[ev.kind];
      if (next) t.state = next;
    }
  }

  // 标题兜底单独一轮，不能和下面的超时判定混在一个循环里 ——
  // 那个循环里有 continue，之前兜底写在它后面，transcript 活跃的任务全被跳过，
  // 面板上就出现了标题为空、只剩副行的条目。
  for (const t of tasks.values()) {
    if (t.title) continue;
    t.title = t.prompt ? titleFromPrompt(t.prompt)
            : t.cwd ? (t.cwd.split(/[/\\]/).filter(Boolean).pop() || t.cwd)
            : t.key.slice(0, 12);
  }

  // 中断没有任何钩子。claude 干活时持续写 transcript，停笔就说明这轮停了。
  // 关键是这里"每次投影现算"而不是写一条 done 事件 —— 会话一旦恢复写入，
  // 状态自己就回到运行中。用事件表达持续观察出来的状态，只会把状态钉死。
  for (const t of tasks.values()) {
    if (t.state !== 'running' || !t.transcript) continue;
    try {
      if (now - statSync(t.transcript).mtimeMs > IDLE_TURN_MS) t.state = 'idle';
    } catch { /* transcript 没了就维持原状 */ }
  }

  // 关键的一步：没有任何 agent 会主动告诉你"我死了"，只能靠心跳超时兜住
  for (const t of tasks.values()) {
    if (t.state !== 'running' && t.state !== 'waiting') continue;
    const limit = timeouts[t.agent] ?? timeouts.default ?? DEFAULT_TIMEOUT;
    // 长时间没有新事件不等于失联：agent 可能正在跑一个很久的工具调用。
    // transcript 还在写就说明它活着，这比事件时间戳可靠。
    if (t.transcript) {
      try {
        if (now - statSync(t.transcript).mtimeMs <= limit) continue;
      } catch { /* transcript 没了，按事件时间判 */ }
    }
    if (now - t.last_seen > limit) {
      t.stale_from = t.state;
      t.state = 'stale';
    }
  }

  // 面板会无限增长。已经看过的完成任务过一段时间就该退场；
  // 但没看过的、还需要你处理的，无论多老都留着 —— 那正是它存在的意义。
  const keepMs = retention ?? DEFAULT_RETENTION;
  return [...tasks.values()]
    .filter(t => {
      if (t.state === 'waiting' || t.state === 'stale' || t.state === 'failed') return true;
      if (t.state === 'done' && t.seen === false) return true;
      return now - t.last_seen <= keepMs;
    })
    .sort(byUrgency);
}

// 没有会话标题时拿第一句话凑。claude code 的 prompt 常以 @文件引用 开头，
// 那种当标题就是一串路径，剥掉再取。
function titleFromPrompt(p) {
  let s = String(p).trim();
  // @"path with spaces" 或 @path/to/file，可能连续好几个
  s = s.replace(/^(@"[^"]*"\s*|@\S+\s*)+/, '').trim();
  if (!s) s = String(p).trim();
  // 到第一个句末标点为止，多半就是一句完整的话
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
