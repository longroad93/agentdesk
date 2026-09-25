// 声明式 adapter：加一个 agent = 加一个 JSON 文件，不碰代码。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from './store.js';
import { readSessionTitle } from './transcript.js';

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters');
const USER_DIR = join(HOME, 'adapters');   // 用户自定义的覆盖内置的

export function loadAdapters() {
  const out = {};
  for (const dir of [BUILTIN_DIR, USER_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const def = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        // key 用文件名，这样同一个 agent 可以有多个数据源
        out[f.replace(/\.json$/, '')] = def;
      } catch (err) {
        process.stderr.write(`[agentdesk] adapter ${f} 解析失败: ${err.message}\n`);
      }
    }
  }
  return out;
}

// 按 agent 名找它的定义（同一个 agent 可能有多个数据源，取第一个声明了 foreground 的）
export function adapterFor(adapters, agent) {
  const defs = Object.values(adapters).filter(d => d.name === agent);
  return defs.find(d => d.foreground) || defs[0] || null;
}

// map 里以 @ 开头的值走这里，让声明式配置也能取到需要读文件才拿得到的东西
const RESOLVERS = {
  title: readSessionTitle,
};

// 极简 JSON path：$.a.b、$.a[0]、$.turn-id（连字符 key 是 codex 在用的）
export function jsonPath(obj, expr) {
  if (typeof expr !== 'string' || !expr.startsWith('$')) return expr;
  let cur = obj;
  for (const seg of expr.slice(1).split('.').filter(Boolean)) {
    const m = seg.match(/^([^[\]]*)((\[\d+\])*)$/);
    if (!m) return undefined;
    if (m[1]) cur = cur?.[m[1]];
    for (const idx of (m[2] || '').match(/\d+/g) || []) cur = cur?.[Number(idx)];
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

// 条件求值，不用 eval。只支持 `path op value`，够表达所有 adapter 需求。
export function evalWhen(obj, when) {
  if (!when) return true;
  const m = when.match(/^\s*(\$[^\s]*)\s*(==|!=|~=|exists)\s*(.*)$/);
  if (!m) return false;
  const actual = jsonPath(obj, m[1]);
  const expected = m[3].trim().replace(/^['"]|['"]$/g, '');
  switch (m[2]) {
    case 'exists': return actual !== undefined && actual !== null && actual !== '';
    case '==': return String(actual) === expected;
    case '!=': return String(actual) !== expected;
    case '~=': return String(actual ?? '').includes(expected);
    default: return false;
  }
}

// agent 之间传的结构化内部消息（风险评估、审批回执之类）不是给人读的，别塞进摘要
export function isMachineText(s) {
  const t = String(s).trim();
  // 系统注入的消息：后台任务完成通知、上下文提醒等，也会走 UserPromptSubmit
  if (/^<(task-notification|system-reminder|command-name|local-command)/i.test(t)) return true;
  if (!/^[{[]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch { return /"[a-z_]+"\s*:/.test(t.slice(0, 120)); }
}

function clip(s, n) {
  if (s === undefined || s === null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

const TEXT_FIELDS = new Set(['title', 'summary', 'prompt']);

// 一条原始数据 → 一条归一化事件。钩子和轮询共用这一份。
// 以前是两份实现（adapters.toEvent / pollers.emit），@resolver、规则里的 summary 默认值、
// 标题的机器文本过滤都只有一边支持：照着 claude.json 给 sqlite adapter 写的字段会被静默忽略。
export function mapPayload(def, payload, agentName) {
  if (!payload || typeof payload !== 'object') return null;
  const rule = (def.rules || []).find(r => evalWhen(payload, r.when));
  if (!rule) return null;
  const ev = { agent: agentName || def.name, kind: rule.kind, confidence: def.confidence || 'exact' };
  // 纠正型事件：只用来把状态推回正轨，不该让任务重新变成未读（见 store.js 里 seen 的处理）
  if (rule.auto) ev.auto = true;
  const map = { ...(def.map || {}), ...(rule.map || {}) };
  for (const [field, expr] of Object.entries(map)) {
    let val;
    if (typeof expr === 'string' && expr.startsWith('@')) {
      const [fn, inner] = expr.slice(1).split(':');
      const arg = jsonPath(payload, inner);
      val = arg && RESOLVERS[fn] ? RESOLVERS[fn](arg) : undefined;
    } else {
      val = jsonPath(payload, expr);
    }
    if (val === undefined || val === null || val === '') continue;
    if (TEXT_FIELDS.has(field) && isMachineText(val)) {
      // 后台任务完成通知之类被注入成"用户输入"。它会开新一轮，但不代表你回来了
      if (field === 'prompt') ev.machine = true;
      continue;
    }
    ev[field] = field === 'title' ? clip(val, 70)
              : (field === 'summary' || field === 'prompt') ? clip(val, 160)
              : String(val);
  }
  if (rule.summary && !ev.summary) ev.summary = clip(rule.summary, 160);
  return ev;
}

// 钩子调用 → 事件；返回 null 表示没有规则匹配上（调用方会留证到 probe 日志）
export function toEvent(def, raw, agentName, env = process.env) {
  let payload = raw.stdin;
  if (def.source === 'argv') {
    const src = def.parse === 'json:$LAST' ? raw.argv[raw.argv.length - 1] : raw.argv[0];
    try { payload = JSON.parse(src); } catch { payload = { _raw: src }; }
  } else if (def.source === 'stdin' && typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = { _raw: payload }; }
  }
  const ev = mapPayload(def, payload, agentName);
  if (!ev) return null;
  // 钩子进程继承了 agent 的环境变量，有些信息只在这里：
  // 比如 CLAUDE_CODE_ENTRYPOINT 能分出桌面版会话和 claude -p 这类无人值守的自动任务
  for (const [field, name] of Object.entries(def.env || {})) {
    if (env[name]) ev[field] = String(env[name]);
  }
  if (!ev.key) ev.key = ev.cwd || 'unknown';
  return ev;
}
