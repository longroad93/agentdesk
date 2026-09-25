import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIsOnScreen, isOnScreen, createScreenTracker } from '../src/screen.js';

const adapters = {
  claude: { name: 'claude', foreground: { darwin: 'Claude' } },
  'codex-sessions': { name: 'codex', foreground: { darwin: 'ChatGPT' } },
  workbuddy: { name: 'workbuddy', foreground: { darwin: 'WorkBuddy' }, read: '$.unread == 0' },
};
const desktop = { current: () => 'sess-b' };
const t = (agent, key, state = 'done', seen = false) => ({ id: `${agent}:${key}`, agent, key, state, seen });

test('屏幕上是谁：Claude 精确到会话，其他 app 只到 app', () => {
  assert.deepEqual(whatIsOnScreen('Claude', adapters, desktop, 'darwin'), { agent: 'claude', key: 'sess-b' });
  assert.deepEqual(whatIsOnScreen('ChatGPT', adapters, desktop, 'darwin'), { agent: 'codex', key: null });
  assert.equal(whatIsOnScreen('loginwindow', adapters, desktop, 'darwin'), null);
});

test('看着会话 A 时，并行的会话 B 不算在眼前（以前按 app 静音会把 B 一起静音）', () => {
  const on = { agent: 'claude', key: 'sess-b' };
  assert.equal(isOnScreen(t('claude', 'sess-b'), on), true);
  assert.equal(isOnScreen(t('claude', 'sess-a'), on), false);
  assert.equal(isOnScreen(t('claude', 'sess-a'), { agent: 'claude', key: null }), false, '拿不到会话就不猜');
  assert.equal(isOnScreen(t('codex', 'x'), { agent: 'codex', key: null }), true);
});

test('停留够 3 秒才算看过；只到 app 级时，多条未读分不清就不标', async () => {
  let front = 'Claude';
  const tr = createScreenTracker({ adapters, desktop, front: async () => front });
  const tasks = [t('claude', 'sess-b'), t('claude', 'sess-a'), t('codex', 'c1'), t('codex', 'c2'), t('workbuddy', 'w1')];
  await tr.sample(1000);
  assert.deepEqual(tr.toMarkSeen(tasks, 2000), []);
  await tr.sample(4500);
  assert.deepEqual(tr.toMarkSeen(tasks, 4500), ['claude:sess-b']);

  front = 'ChatGPT';
  await tr.sample(10_000);
  assert.deepEqual(tr.toMarkSeen(tasks, 20_000), [], '两条 codex 未读，分不清你看的是哪条');
  assert.deepEqual(tr.toMarkSeen([t('codex', 'c1')], 20_000), ['codex:c1']);

  front = 'WorkBuddy';
  await tr.sample(30_000);
  assert.deepEqual(tr.toMarkSeen(tasks, 40_000), [], 'WorkBuddy 自己记已读，听它的');
});
