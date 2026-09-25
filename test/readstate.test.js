import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createDesktopFocus, frontmostApp } from '../src/readstate.js';
import { tmp, write } from './helpers.js';

const rec = (id, focusedAt, extra = {}) =>
  JSON.stringify({ sessionId: 'local_' + id, cliSessionId: id, lastFocusedAt: focusedAt, isArchived: false, ...extra });

test('按 cliSessionId 取 lastFocusedAt；当前会话 = 最近被切到的、没归档的那个', () => {
  const dir = tmp();
  write(join(dir, 'org', 'user', 'local_a.json'), rec('sess-a', 1000));
  write(join(dir, 'org', 'user', 'local_b.json'), rec('sess-b', 3000));
  write(join(dir, 'org', 'user', 'local_c.json'), rec('sess-c', 9000, { isArchived: true }));
  write(join(dir, 'org', 'user', 'broken.json'), '{not json');
  const f = createDesktopFocus(dir);
  assert.equal(f.count, 3);
  assert.equal(f.focusedAt('sess-a'), 1000);
  assert.equal(f.focusedAt('nope'), 0);
  assert.equal(f.current(), 'sess-b', '归档的会话不算当前会话');
});

test('目录不存在：没有信号，不报错', () => {
  const f = createDesktopFocus(join(tmp(), 'missing'));
  assert.equal(f.count, 0);
  assert.equal(f.current(), null);
});

test('盯目录：lastFocusedAt 变了才回调', async () => {
  const dir = tmp();
  const file = write(join(dir, 'o', 'u', 'local_a.json'), rec('sess-a', 1000));
  const f = createDesktopFocus(dir);
  let calls = 0;
  const stop = f.watch(() => calls++);
  await new Promise(r => setTimeout(r, 100));
  writeFileSync(file, rec('sess-a', 1000, { lastActivityAt: 5 }));   // 只是会话活动，不是切换
  await new Promise(r => setTimeout(r, 300));
  assert.equal(calls, 0);
  writeFileSync(file, rec('sess-a', 2000));
  await new Promise(r => setTimeout(r, 300));
  stop();
  assert.ok(calls >= 1);
  assert.equal(f.focusedAt('sess-a'), 2000);
});

test('前台 app：测试时可以伪造', async () => {
  process.env.AGENTDESK_FAKE_FRONT = 'Claude';
  assert.equal(await frontmostApp(), 'Claude');
  process.env.AGENTDESK_FAKE_FRONT = '';
  assert.equal(await frontmostApp(), null);
  delete process.env.AGENTDESK_FAKE_FRONT;
});
