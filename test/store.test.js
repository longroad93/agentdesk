import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';

const home = (await import('./helpers.js')).tmp();
process.env.AGENTDESK_HOME = home;
const { append, loadEvents, rotateIfNeeded, EVENTS_FILE, ROTATED_FILE } = await import('../src/store.js');

test('轮转：改名而不是整份重写；读的时候两份都读，顺序不乱', () => {
  for (let i = 0; i < 50; i++) append({ agent: 'a', key: 'k', kind: 'heartbeat', n: i });
  assert.equal(rotateIfNeeded(1024), true);
  assert.ok(existsSync(ROTATED_FILE));
  assert.equal(existsSync(EVENTS_FILE), false, '改名之后，下一次追加会自己建新文件');
  append({ agent: 'a', key: 'k', kind: 'heartbeat', n: 50 });
  const evs = loadEvents();
  assert.equal(evs.length, 51, '轮转前后的事件一条不少');
  assert.deepEqual(evs.map(e => e.n), [...Array(51).keys()]);
  assert.ok(statSync(EVENTS_FILE).size < 200);
});

test('轮转有锁：锁在的时候不动', async () => {
  const { mkdirSync, rmdirSync } = await import('node:fs');
  for (let i = 0; i < 50; i++) append({ agent: 'a', key: 'k', kind: 'heartbeat' });
  mkdirSync(EVENTS_FILE + '.rotating');
  assert.equal(rotateIfNeeded(1024), false);
  rmdirSync(EVENTS_FILE + '.rotating');
  assert.equal(rotateIfNeeded(1024), true);
});
