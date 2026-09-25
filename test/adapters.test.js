import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.AGENTDESK_HOME = (await import('./helpers.js')).tmp();
const { mapPayload, toEvent, evalWhen, jsonPath } = await import('../src/adapters.js');
const claude = JSON.parse(readFileSync(new URL('../adapters/claude.json', import.meta.url), 'utf8'));

test('jsonPath / evalWhen', () => {
  assert.equal(jsonPath({ a: { 'turn-id': 3, b: [1, 2] } }, '$.a.turn-id'), 3);
  assert.equal(jsonPath({ a: { b: [1, 2] } }, '$.a.b[1]'), 2);
  assert.equal(evalWhen({ s: 'waiting_approval' }, '$.s ~= approval'), true);
  assert.equal(evalWhen({ u: 0 }, '$.u == 0'), true);
  assert.equal(evalWhen({}, '$.x exists'), false);
});

test('钩子：规则默认摘要、入口类型从环境变量来、key 缺省用 cwd', () => {
  const raw = { stdin: JSON.stringify({ hook_event_name: 'Notification', session_id: 's1', cwd: '/p' }), argv: [] };
  const ev = toEvent(claude, raw, 'claude', { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' });
  assert.equal(ev.kind, 'waiting');
  assert.equal(ev.summary, '需要你确认');
  assert.equal(ev.entrypoint, 'claude-desktop');
  const noKey = toEvent({ source: 'stdin', rules: [{ kind: 'done' }], map: { cwd: '$.cwd' } }, { stdin: '{"cwd":"/w"}', argv: [] }, 'x', {});
  assert.equal(noKey.key, '/w');
});

test('机器注入的 prompt 不进摘要，但标记出来（它会开新一轮，但不代表你回来了）', () => {
  const raw = { stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '<task-notification><task-id>x</task-id>' }), argv: [] };
  const ev = toEvent(claude, raw, 'claude', {});
  assert.equal(ev.kind, 'start');
  assert.equal(ev.prompt, undefined);
  assert.equal(ev.machine, true);
});

test('轮询和钩子走同一份映射：规则里的 summary 默认值对轮询源同样生效', () => {
  const def = { name: 'wb', map: { key: '$.id' }, rules: [{ when: '$.status == error', kind: 'failed', summary: '出错了' }] };
  assert.equal(mapPayload(def, { id: 1, status: 'error' }).summary, '出错了');
});
