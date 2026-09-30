import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, delimiter } from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import {
  createDesktopFocus, createCodexReadState, isCodexDesktopThread, frontmostApp,
  claudeSessionsDirs, isClaudeDesktop, claudeUserDataSessions, describeClaudeDirs,
} from '../src/readstate.js';
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

test('Claude 桌面版数据目录：官方账号、3p、CLAUDE_USER_DATA_DIR、Windows 的 LOCALAPPDATA 都在候选里', () => {
  const S = 'claude-code-sessions';
  const mac = claudeSessionsDirs({}, 'darwin', '/Users/u');
  assert.deepEqual(mac, [
    join('/Users/u', 'Library', 'Application Support', 'Claude', S),
    join('/Users/u', 'Library', 'Application Support', 'Claude-3p', S),
  ]);
  const custom = claudeSessionsDirs({ CLAUDE_USER_DATA_DIR: '/data/claude' }, 'darwin', '/Users/u');
  assert.equal(custom[0], join('/data/claude', S), '显式指定的目录排最前');
  assert.equal(custom.length, 3, '默认位置照样读：换过目录的人老会话还在那儿');
  const win = claudeSessionsDirs({ APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\u');
  assert.ok(win.includes(join('C:\\L', 'Claude-3p', S)), 'Windows 上 3p 的目录在 LOCALAPPDATA 下，不在 APPDATA');
  assert.deepEqual(claudeSessionsDirs({ AGENTDESK_CLAUDE_SESSIONS: '/a' + delimiter + '/b' }), ['/a', '/b']);
});

test('isClaudeDesktop：官方账号和 3p 都算桌面版，CLI / claude -p 不算', () => {
  assert.equal(isClaudeDesktop('claude-desktop'), true);
  assert.equal(isClaudeDesktop('claude-desktop-3p'), true);
  assert.equal(isClaudeDesktop('cli'), false);
  assert.equal(isClaudeDesktop('sdk-cli'), false);
  assert.equal(isClaudeDesktop('claude-desktopx'), false);
  assert.equal(isClaudeDesktop(undefined), false);
});

test('钩子上报的 CLAUDE_USER_DATA_DIR：从事件里捡出会话目录，只认 claude 的', () => {
  const dirs = claudeUserDataSessions([
    { agent: 'claude', user_data_dir: '/data/claude' },
    { agent: 'claude', user_data_dir: '/data/claude' },
    { agent: 'claude' },
    { agent: 'codex', user_data_dir: '/nope' },
  ]);
  assert.deepEqual(dirs, [join('/data/claude', 'claude-code-sessions')]);
});

test('服务起来之后才出现的目录（第一次换成 API 登录）：不用重启也能认出来', async () => {
  const late = join(tmp(), 'Claude-3p', 'claude-code-sessions');
  const f = createDesktopFocus([late], { rescanMs: 50 });
  let calls = 0;
  const stop = f.watch(() => calls++);
  assert.equal(f.count, 0);
  write(join(late, 'o', 'u', 'local_x.json'), rec('sess-x', 4000));
  await new Promise(r => setTimeout(r, 250));
  assert.equal(f.focusedAt('sess-x'), 4000, '定时补挂上了新目录，并读了里面已有的会话');
  assert.ok(calls >= 1, '挂上新目录要通知一次，里面可能有已经看过的会话');
  // 挂上之后的变化照常走 fs.watch
  write(join(late, 'o', 'u', 'local_x.json'), rec('sess-x', 5000));
  await new Promise(r => setTimeout(r, 300));
  stop();
  assert.equal(f.focusedAt('sess-x'), 5000);
});

test('addDirs：中途加进来的目录立刻读，status 能看出读的是哪个目录', () => {
  const a = join(tmp(), 'Claude', 'claude-code-sessions');
  const b = join(tmp(), 'custom', 'claude-code-sessions');
  write(join(a, 'o', 'u', 'local_a.json'), rec('sess-a', 1000));
  write(join(b, 'o', 'u', 'local_b.json'), rec('sess-b', 2000));
  const f = createDesktopFocus([a]);
  assert.equal(f.count, 1);
  assert.equal(f.addDirs([b, a]), true);
  assert.equal(f.addDirs([b]), false, '已经有的不重复加');
  assert.equal(f.focusedAt('sess-b'), 2000);
  assert.deepEqual(f.activeDirs, [a, b]);
  assert.equal(describeClaudeDirs(f), '2 个会话（Claude + custom）');
  assert.match(describeClaudeDirs(createDesktopFocus([join(tmp(), 'missing')])), /读不到/);
});

test('Claude 桌面版：Claude/ 和 Claude-3p/ 两个目录都读', () => {
  const a = tmp(), b = tmp();
  write(join(a, 'o', 'u', 'local_a.json'), rec('sess-a', 1000));
  write(join(b, 'o', 'u', 'local_b.json'), rec('sess-b', 2000));
  const f = createDesktopFocus([a, b, join(tmp(), 'missing')]);
  assert.equal(f.count, 2);
  assert.equal(f.focusedAt('sess-b'), 2000);
  assert.equal(f.current(), 'sess-b');
});

const codexState = unread => JSON.stringify({
  'other-key': 1,
  'electron-thread-read-state-v1': { version: 1, unreadByIdentity: { acct: { 'local:host': unread } } },
});

test('Codex 桌面版未读列表：在列表里 = 未读，不在 = 已读，读不到 = null', () => {
  const file = write(join(tmp(), '.codex-global-state.json'), codexState(['t1']));
  const r = createCodexReadState(file);
  assert.equal(r.known, true);
  assert.equal(r.isUnread('t1'), true);
  assert.equal(r.isUnread('t2'), false);
  assert.ok(r.savedAt > 0);
  assert.equal(createCodexReadState(join(tmp(), 'missing.json')).isUnread('t1'), null);
  const bad = write(join(tmp(), 's.json'), JSON.stringify({ other: 1 }));
  assert.equal(createCodexReadState(bad).isUnread('t1'), null, '格式变了就当没信号，不能当成全部已读');
});

test('Codex 未读列表：文件被整个替换也能盯到，集合变了才回调', async () => {
  const dir = tmp();
  const file = write(join(dir, '.codex-global-state.json'), codexState(['t1']));
  const r = createCodexReadState(file);
  let calls = 0;
  const stop = r.watch(() => calls++);
  await new Promise(res => setTimeout(res, 100));
  write(join(dir, 'tmp.json'), codexState([]));
  renameSync(join(dir, 'tmp.json'), file);
  await new Promise(res => setTimeout(res, 300));
  stop();
  assert.ok(calls >= 1);
  assert.equal(r.isUnread('t1'), false);
});

test('Codex 会话是不是桌面版开的：看会话头的 originator，头再长也读得全', () => {
  const dir = tmp();
  const meta = o => JSON.stringify({ type: 'session_meta', payload: { originator: o, base_instructions: 'x'.repeat(30000) } }) + '\n{}\n';
  assert.equal(isCodexDesktopThread(write(join(dir, 'a.jsonl'), meta('Codex Desktop'))), true);
  assert.equal(isCodexDesktopThread(write(join(dir, 'b.jsonl'), meta('codex_work_desktop'))), true);
  assert.equal(isCodexDesktopThread(write(join(dir, 'c.jsonl'), meta('codex_cli_rs'))), false, 'CLI 的会话不进桌面版未读列表');
  assert.equal(isCodexDesktopThread(join(dir, 'missing.jsonl')), false);
});

test('前台 app：测试时可以伪造', async () => {
  process.env.AGENTDESK_FAKE_FRONT = 'Claude';
  assert.equal(await frontmostApp(), 'Claude');
  process.env.AGENTDESK_FAKE_FRONT = '';
  assert.equal(await frontmostApp(), null);
  delete process.env.AGENTDESK_FAKE_FRONT;
});
