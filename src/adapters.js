// 声明式 adapter：加一个 agent = 加一个 JSON 文件，不碰代码。
import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from './store.js';

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
        // （codex 既有 notify 钩子，也有会话文件轮询）
        out[f.replace(/\.json$/, '')] = def;
      } catch (err) {
        process.stderr.write(`[agentdesk] adapter ${f} 解析失败: ${err.message}\n`);
      }
    }
  }
  return out;
}

// 会话标题在 transcript 里被反复追加，最新的一份永远在文件末尾。
// 只读尾部 64KB —— transcript 动辄上 MB，而 hook 是同步阻塞 agent 的，不能全读。
function readSessionTitle(path) {
  try {
    const size = statSync(path).size;
    const len = Math.min(size, 65536);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const text = buf.toString('utf8');
    // customTitle 是用户自己改的，优先于 AI 生成的
    for (const key of ['customTitle', 'aiTitle']) {
      const hits = [...text.matchAll(new RegExp('"' + key + '":"((?:[^"\\\\]|\\\\.)*)"', 'g'))];
      if (hits.length) {
        try { return JSON.parse('"' + hits[hits.length - 1][1] + '"'); } catch { return hits[hits.length - 1][1]; }
      }
    }
  } catch { /* 读不到就退回默认标题 */ }
  return undefined;
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

// 把一次钩子调用变成一条归一化事件；返回 null 表示这次调用不产生事件
export function toEvent(def, raw, agentName) {
  let payload = raw.stdin;
  if (def.source === 'argv') {
    const src = def.parse === 'json:$LAST' ? raw.argv[raw.argv.length - 1] : raw.argv[0];
    try { payload = JSON.parse(src); } catch { payload = { _raw: src }; }
  } else if (def.source === 'stdin' && typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = { _raw: payload }; }
  }
  if (!payload || typeof payload !== 'object') return null;

  const rule = (def.rules || []).find(r => evalWhen(payload, r.when));
  if (!rule) return null;

  const map = { ...(def.map || {}), ...(rule.map || {}) };
  const ev = {
    agent: agentName || def.name,
    kind: rule.kind,
    confidence: def.confidence || 'exact',
  };
  if (rule.auto) ev.auto = true;
  for (const [field, expr] of Object.entries(map)) {
    let val;
    if (typeof expr === 'string' && expr.startsWith('@')) {
      const [fn, inner] = expr.slice(1).split(':');
      const arg = jsonPath(payload, inner);
      val = arg && RESOLVERS[fn] ? RESOLVERS[fn](arg) : undefined;
    } else {
      val = jsonPath(payload, expr);
    }
    if (val !== undefined && val !== null && val !== '') {
      if ((field === 'summary' || field === 'prompt' || field === 'title') && isMachineText(val)) continue;
      ev[field] = field === 'title' ? clip(val, 70)
                : (field === 'summary' || field === 'prompt') ? clip(val, 160)
                : String(val);
    }
  }
  if (rule.summary && !ev.summary) ev.summary = clip(rule.summary, 160);
  if (!ev.key) ev.key = ev.cwd || 'unknown';
  return ev;
}
