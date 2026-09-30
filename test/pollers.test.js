import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { tmp, write, append as appendText } from './helpers.js';

const home = tmp();
process.env.AGENTDESK_HOME = home;
const { pollAll, watchPlan } = await import('../src/pollers.js');
const { loadEvents } = await import('../src/store.js');

let DatabaseSync = null;
try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* node < 22 */ }

const kinds = since => loadEvents().slice(since).map(e => e.kind + (e.kind === 'read' ? `:${e.value}` : ''));

test('sqlite：已读单独一条通道，变了才发；状态事件后面跟一条当前已读值', { skip: !DatabaseSync && 'node:sqlite 不可用' }, () => {
  const file = join(tmp(), 'wb.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sessions (id TEXT, title TEXT, status TEXT, unread INT, last_activity_at INT)`);
  const now = Date.now();
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run('w1', '任务', 'running', 0, now);
  const def = {
    name: 'wb', source: 'sqlite', db: file,
    query: 'SELECT * FROM sessions WHERE last_activity_at > ?',
    map: { key: '$.id', title: '$.title' },
    read: '$.unread == 0',
    heartbeat: { field: '$.last_activity_at', every: 60000 },
    rules: [{ when: '$.status == completed', kind: 'done' }, { when: '$.status exists', kind: 'start' }],
  };
  const adapters = { wb: def };
  let mark = loadEvents().length;
  pollAll(adapters, now);
  assert.deepEqual(kinds(mark), ['start', 'read:true']);

  mark = loadEvents().length;
  pollAll(adapters, now + 1000);
  assert.deepEqual(kinds(mark), [], '什么都没变：不发');

  db.prepare('UPDATE sessions SET last_activity_at = ?').run(now + 120_000);
  mark = loadEvents().length;
  pollAll(adapters, now + 120_000);
  assert.deepEqual(kinds(mark), ['heartbeat'], '还在跑、有新活动：发心跳（不然长任务会被判失联）');

  db.prepare("UPDATE sessions SET status = 'completed', unread = 1").run();
  mark = loadEvents().length;
  pollAll(adapters, now + 130_000);
  assert.deepEqual(kinds(mark), ['done', 'read:false']);

  db.prepare('UPDATE sessions SET unread = 0').run();
  mark = loadEvents().length;
  pollAll(adapters, now + 140_000);
  assert.deepEqual(kinds(mark), ['read:true'], '在 app 里看过了：只发已读，不再发一遍 done');
  db.close();
});

test('jsonl：过滤掉内部子代理会话；事件带上会话流文件路径当存活信号', () => {
  const dir = tmp();
  const sess = '01a0d1c9-0000-4000-8000-000000000001';
  const sub = '01a0d1c9-0000-4000-8000-000000000002';
  const f = write(join(dir, '2026', '09', '20', `rollout-x-${sess}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { thread_source: 'user', cwd: '/p' } }) + '\n');
  write(join(dir, '2026', '09', '20', `rollout-x-${sub}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { thread_source: 'subagent' } }) + '\n' +
    JSON.stringify({ payload: { type: 'task_complete' } }) + '\n');
  appendText(f, JSON.stringify({ payload: { type: 'task_complete', last_agent_message: '好了' } }) + '\n');
  const def = JSON.parse(JSON.stringify((globalThis.codexDef ??= {
    name: 'codex', source: 'watch-jsonl', glob: join(dir, '*/*/*/rollout-*.jsonl'),
    map: { key: '$._session', alive: '$._file' }, session_filter: '$.payload.thread_source == user',
    rules: [{ when: '$.payload.type == task_complete', kind: 'done', map: { summary: '$.payload.last_agent_message' } },
      { when: '$.type == session_meta', kind: 'start', map: { cwd: '$.payload.cwd' } }],
  })));
  const mark = loadEvents().length;
  pollAll({ codex: def });
  const evs = loadEvents().slice(mark);
  assert.deepEqual(evs.map(e => e.kind), ['start', 'done']);
  assert.ok(evs.every(e => e.key === sess), '子代理会话整个跳过');
  assert.equal(evs[1].alive, f);
});

// 现在的 Codex 会话头（session_meta）里嵌着整份 base_instructions，实测 1.8 万～2.2 万字节。
// 以前只读文件开头 8KB，第一行永远读不全 → 当成"头还没写完"重试 5 次 → 兜底放行：
// 你发起的会话平均晚 23 秒才出现，内部会话（guardian_review 等）重试完也被放了进来
test('会话头超过 8KB：第一轮就判定；内部会话轮询多少轮都进不来', () => {
  const dir = tmp();
  const big = 'x'.repeat(20_000);
  const user = '01a0d8ad-0000-4000-8000-000000000011';
  const guard = '01a0d8ad-0000-4000-8000-000000000012';
  const head = src => JSON.stringify({ type: 'session_meta', payload: { thread_source: src, cwd: '/p', base_instructions: { text: big } } }) + '\n';
  write(join(dir, '2026', '09', '25', `rollout-a-${user}.jsonl`), head('user') + JSON.stringify({ payload: { type: 'task_started' } }) + '\n');
  write(join(dir, '2026', '09', '25', `rollout-b-${guard}.jsonl`), head('guardian_review') + JSON.stringify({ payload: { type: 'task_complete' } }) + '\n');
  const def = {
    name: 'codex', source: 'watch-jsonl', glob: join(dir, '*/*/*/rollout-*.jsonl'),
    map: { key: '$._session' }, session_filter: '$.payload.thread_source == user',
    rules: [{ when: '$.payload.type == task_complete', kind: 'done' }, { when: '$.payload.type == task_started', kind: 'start' }],
  };
  const mark = loadEvents().length;
  pollAll({ codex: def });
  assert.ok(loadEvents().slice(mark).some(e => e.key === user && e.kind === 'start'), '你发起的会话第一轮就该出现');
  for (let i = 0; i < 7; i++) pollAll({ codex: def });
  assert.equal(loadEvents().slice(mark).filter(e => e.key === guard).length, 0, '内部会话重试多少轮都不能放行');
});

test('会话头还没写完（没有换行）：这轮不动，写完再判', () => {
  const dir = tmp();
  const sess = '01a0d8ad-0000-4000-8000-000000000013';
  const file = write(join(dir, '2026', '09', '25', `rollout-c-${sess}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { thread_source: 'user', base_instructions: 'y'.repeat(20_000) } }));
  const def = {
    name: 'codex', source: 'watch-jsonl', glob: join(dir, '*/*/*/rollout-*.jsonl'),
    map: { key: '$._session' }, session_filter: '$.payload.thread_source == user',
    rules: [{ when: '$.type == session_meta', kind: 'start' }],
  };
  const mark = loadEvents().length;
  pollAll({ codex: def });
  assert.equal(loadEvents().slice(mark).filter(e => e.key === sess).length, 0);
  appendText(file, '\n');
  pollAll({ codex: def });
  assert.equal(loadEvents().slice(mark).filter(e => e.key === sess).length, 1);
});

test('监听计划：sqlite 只盯数据库那几个文件，不再递归盯整个目录', () => {
  const p = watchPlan({ source: 'sqlite', db: '/Users/x/.workbuddy/workbuddy.db' });
  assert.equal(p.dir, '/Users/x/.workbuddy');
  assert.equal(p.recursive, false);
  assert.equal(p.match('workbuddy.db-wal'), true);
  assert.equal(p.match('logs/2026-09-24'), false);
  const j = watchPlan({ source: 'watch-jsonl', glob: '/Users/x/.codex/sessions/*/*/*/rollout-*.jsonl' });
  assert.equal(j.dir, '/Users/x/.codex/sessions');
  assert.equal(j.match('2026/09/20/rollout-a.jsonl'), true);
});
