// Claude Code transcript 的读法。面板上"agent 此刻在干什么"大多从这里来：
// 标题、最后一句回复、正在跑的工具、有没有被你中断、有没有 API 报错、起过哪些后台任务。
//
// 以前靠"transcript 90 秒没写就算停了"来猜。实测 14 天里 77 次是 agent 正在
// 生成长回复或跑长命令时被误判成「停着」，同期真正的中断只有 33 次 —— 猜错的比猜对的多。
// transcript 里其实有确定性信号，读出来就行。
import { statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const TAIL = 128 * 1024;
const cache = new Map();      // path -> { key, info }

export function transcriptInfo(path) {
  if (!path) return null;
  let st;
  try { st = statSync(path); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(path);
  if (hit && hit.key === key) return hit.info;

  let info = null;
  try {
    info = parse(path, st);
  } catch (err) {
    // 文件读不到是正常的（会话被删、权限变了）。但 ReferenceError/TypeError 是代码写错了 ——
    // 标题读取曾经因为漏了一个 import 静默失效很久，别再让它藏起来。
    if (err instanceof ReferenceError || err instanceof TypeError) {
      process.stderr.write(`[agentdesk] transcript 解析代码错误: ${err.message}\n`);
    }
  }
  if (cache.size > 300) cache.clear();
  cache.set(path, { key, info });
  return info;
}

// 给 adapter 的 @title 解析器用（钩子触发那一刻读标题）
export function readSessionTitle(path) {
  return transcriptInfo(path)?.title;
}

function parse(path, st) {
  const fd = openSync(path, 'r');
  let tail, head = '';
  try {
    tail = readChunk(fd, Math.max(0, st.size - TAIL), Math.min(st.size, TAIL));
    // 标题两头都读：有的会话每轮都重写标题（最新的在末尾），有的只在开头写一次
    if (st.size > TAIL && !pickTitle(tail)) head = readChunk(fd, 0, TAIL);
  } finally { closeSync(fd); }

  const lines = tail.split('\n');
  if (st.size > TAIL) lines.shift();          // 窗口切在行中间，第一行不完整

  const pending = new Map();                  // tool_use_id -> { name, input, at }
  let lastUserAt = 0, lastAsstAt = 0, interruptedAt = 0, reply = '', replyAt = 0, last = null;
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue;
    const at = Date.parse(o.timestamp) || 0;
    const blocks = Array.isArray(o.message?.content) ? o.message.content
      : typeof o.message?.content === 'string' ? [{ type: 'text', text: o.message.content }] : [];

    if (o.type === 'assistant') {
      lastAsstAt = at;
      last = { at, apiError: o.isApiErrorMessage ? textOf(blocks) : null };
      if (o.isApiErrorMessage) continue;
      for (const b of blocks) {
        if (b.type === 'tool_use') pending.set(b.id, { name: b.name, input: b.input || {}, at });
        else if (b.type === 'text' && b.text?.trim()) { reply = b.text; replyAt = at; }
      }
    } else {
      let interrupt = false, meta = o.isMeta === true, result = false;
      for (const b of blocks) {
        if (b.type === 'tool_result') { pending.delete(b.tool_use_id); result = true; }
        else if (b.type === 'text') {
          if (b.text?.includes('[Request interrupted')) interrupt = true;
          else if (/^\s*<(local-command|command-name|command-message)/.test(b.text || '')) meta = true;
        }
      }
      if (interrupt) interruptedAt = at;
      // 被中断、或者你已经开了新一轮：之前没拿到结果的工具都作废了。
      // 会话在工具执行中途被杀、之后又恢复的话，不清掉就会留下一个永远"在跑"的幽灵工具
      if (interrupt || (!result && !meta)) pending.clear();
      last = { at, apiError: null };
      // 本地命令、系统注入的说明不会让模型开始干活
      if (!meta) lastUserAt = at;
    }
  }

  const tool = [...pending.values()].at(-1) || null;
  const line = lastLine(reply);
  return {
    mtime: st.mtimeMs,
    title: pickTitle(tail) || pickTitle(head),
    lastReply: line.slice(0, 160),
    replyAt,
    asks: /[?？]$/.test(line),
    tool,                                     // 正在执行、还没拿到结果的工具（最新的那个）
    // 你说完话、模型还没回：正在生成。中断标记本身也是一条 user 条目，要排除
    generating: !tool && lastUserAt > lastAsstAt && lastUserAt !== interruptedAt,
    interruptedAt,
    apiError: last?.apiError ? { at: last.at, text: last.apiError.slice(0, 160) } : null,
  };
}

function readChunk(fd, pos, len) {
  if (len <= 0) return '';
  const buf = Buffer.alloc(len);
  const n = readSync(fd, buf, 0, len, pos);
  return buf.toString('utf8', 0, n);
}

function textOf(blocks) {
  return blocks.filter(b => b.type === 'text').map(b => b.text || '').join(' ').replace(/\s+/g, ' ').trim();
}

// customTitle 是你自己改的，优先于 AI 生成的
function pickTitle(text) {
  if (!text) return undefined;
  for (const key of ['customTitle', 'aiTitle']) {
    const hits = [...text.matchAll(new RegExp('"' + key + '":"((?:[^"\\\\]|\\\\.)*)"', 'g'))];
    if (hits.length) {
      const raw = hits[hits.length - 1][1];
      try { return JSON.parse('"' + raw + '"'); } catch { return raw; }
    }
  }
  return undefined;
}

// 回复的最后一行，去掉 markdown 记号。结尾常常就是"要我开始吗？"这类要你拍板的话
function lastLine(text) {
  const lines = String(text).split('\n')
    .map(s => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')      // [文字](链接) 只留文字
      .replace(/^[\s>#*\-•|]+/, '').replace(/[\s*_`|]+$/, '').trim())
    .filter(s => s.replace(/[\p{P}\p{S}\s]/gu, '').length >= 2);
  return lines.at(-1) || '';
}

// 把一个工具调用说成人话。ask = 等你批准时的说法，run = 正在执行时的说法
export function describeTool(tool, mode = 'run') {
  if (!tool) return '';
  const i = tool.input || {};
  const ask = mode === 'ask';
  const host = u => { try { return new URL(u).host; } catch { return String(u || ''); } };
  switch (tool.name) {
    case 'AskUserQuestion': {
      const q = i.questions?.[0]?.question;
      return q ? `问你：${q}` : '在问你问题';
    }
    case 'ExitPlanMode': return '等你批准计划';
    case 'Bash': return (ask ? '要执行：' : '在跑：') + (i.description || i.command || '命令');
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return (ask ? '要改：' : '在改：') + basename(String(i.file_path || i.notebook_path || ''));
    case 'Read': return (ask ? '要读：' : '在读：') + basename(String(i.file_path || ''));
    case 'WebFetch': return (ask ? '要访问：' : '在访问：') + host(i.url);
    case 'WebSearch': return (ask ? '要搜索：' : '在搜索：') + (i.query || '');
    case 'Agent': case 'Task': return '子任务：' + (i.description || i.subagent_type || '');
    // mcp__<服务名>__<工具名>，服务名里自己也可能带下划线
    default: return (ask ? '要用：' : '在用：') + String(tool.name).split('__').at(-1);
  }
}

// 这两个工具一挂起就是在等你，不需要等 Notification 钩子
export const ASKS_USER = new Set(['AskUserQuestion', 'ExitPlanMode']);

// 哪些 .output 是真的后台任务。前台命令跑的时候也会在 tasks/ 下开 .output，
// 光看文件分不出来；区别在于后台任务起来之后工具立刻返回，transcript 里会留下这两种说法。
// 整个文件增量扫一遍（启动很久的后台任务，那一行早就不在末尾窗口里了）。
const BG_ID_RE = /(?:running in background with ID|agentId): ([A-Za-z0-9_-]+)/g;
const bgScan = new Map();    // path -> { offset, carry, ids }

export function backgroundIds(path) {
  let st;
  try { st = statSync(path); } catch { return new Set(); }
  let s = bgScan.get(path);
  if (!s || st.size < s.offset) { s = { offset: 0, carry: '', ids: new Set() }; bgScan.set(path, s); }
  if (st.size > s.offset) {
    const fd = openSync(path, 'r');
    try {
      const STEP = 4 * 1024 * 1024;
      for (let pos = s.offset; pos < st.size; pos += STEP) {
        const text = s.carry + readChunk(fd, pos, Math.min(STEP, st.size - pos));
        for (const m of text.matchAll(BG_ID_RE)) s.ids.add(m[1]);
        s.carry = text.slice(-80);           // ID 被切在两次读取之间
      }
    } finally { closeSync(fd); }
    s.offset = st.size;
  }
  return s.ids;
}

// 子 agent 写自己的 transcript（<会话>/subagents/），主 transcript 在这期间一声不吭
const subCache = new Map();
export function subagentsMtime(transcriptPath, now = Date.now()) {
  if (!transcriptPath) return 0;
  const hit = subCache.get(transcriptPath);
  if (hit && now - hit.at < 2000) return hit.mtime;
  let mtime = 0;
  const dir = join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  try {
    for (const f of readdirSync(dir)) {
      try { mtime = Math.max(mtime, statSync(join(dir, f)).mtimeMs); } catch { /* 刚被删 */ }
    }
  } catch { /* 没起过子 agent */ }
  if (subCache.size > 300) subCache.clear();
  subCache.set(transcriptPath, { at: now, mtime });
  return mtime;
}
