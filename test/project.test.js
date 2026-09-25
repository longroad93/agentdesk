import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev } from './helpers.js';

process.env.AGENTDESK_HOME = (await import('./helpers.js')).tmp();
const { project } = await import('../src/store.js');

const MIN = 60_000, H = 60 * MIN;
const NOW = Date.parse('2026-09-20T12:00:00Z');
const TR = '/fake/sess.jsonl';

// 假的文件系统观测
const io = (o = {}) => ({
  transcript: p => o.info?.[p] ?? null,
  mtime: p => o.mtime?.[p] ?? 0,
  subagentsMtime: () => o.sub ?? 0,
  background: t => o.bg?.[t.key] ?? null,
  focusedAt: t => o.focus?.[t.key] ?? 0,
});
const one = (events, opts = {}) => {
  const out = project(events, { now: NOW, skipRetention: true, ...opts });
  assert.equal(out.length, 1, `期望 1 个任务，实际 ${out.length}`);
  return out[0];
};
const info = (o = {}) => ({
  mtime: NOW - MIN, title: undefined, lastReply: '', replyAt: 0, asks: false,
  tool: null, generating: false, interruptedAt: 0, apiError: null, ...o,
});

test('只有带状态的事件能建任务：closed / seen / read / heartbeat 建不出来（日志轮转留下的孤儿）', () => {
  const out = project([
    ev('claude', 'a', 'closed', NOW - H),
    ev('claude', 'b', 'seen', NOW - H),
    ev('workbuddy', 'c', 'read', NOW - H, { value: true }),
    ev('codex', 'd', 'heartbeat', NOW - H),
  ], { now: NOW, skipRetention: true });
  assert.equal(out.length, 0);
});

test('已读 / 会话关闭 / app 已读不刷新 last_seen（否则排序被污染）', () => {
  const t = one([
    ev('claude', 's', 'start', NOW - 3 * H),
    ev('claude', 's', 'done', NOW - 2 * H),
    ev('claude', 's', 'seen', NOW - MIN),
    ev('claude', 's', 'closed', NOW - MIN),
  ]);
  assert.equal(t.last_seen, NOW - 2 * H);
});

test('完成 = 未读；你回会话说话 = 已读；注入的"输入"（后台任务通知）不算你回来了', () => {
  const base = [ev('claude', 's', 'start', NOW - 10 * MIN), ev('claude', 's', 'done', NOW - 5 * MIN)];
  assert.equal(one(base).needs, true);
  assert.equal(one([...base, ev('claude', 's', 'start', NOW - MIN, { prompt: '继续' })]).seen, true);
  const t = one([...base, ev('claude', 's', 'start', NOW - MIN, { machine: true })]);
  assert.equal(t.seen, false, '机器注入的 start 不能把未读清掉');
});

test('无人值守的 claude -p：完成不算未读，失败照样提醒', () => {
  const s = ev('claude', 's', 'start', NOW - 10 * MIN, { entrypoint: 'sdk-cli' });
  assert.equal(one([s, ev('claude', 's', 'done', NOW - MIN)]).needs, false);
  assert.equal(one([s, ev('claude', 's', 'failed', NOW - MIN)]).needs, true);
});

test('app 自己记的已读（WorkBuddy unread 列）：两个方向都照搬', () => {
  const base = [ev('workbuddy', 'w', 'start', NOW - 10 * MIN), ev('workbuddy', 'w', 'done', NOW - 5 * MIN)];
  assert.equal(one([...base, ev('workbuddy', 'w', 'read', NOW - 4 * MIN, { value: true })]).seen, true);
  assert.equal(one([...base,
    ev('workbuddy', 'w', 'read', NOW - 4 * MIN, { value: true }),
    ev('workbuddy', 'w', 'read', NOW - 3 * MIN, { value: false })]).seen, false);
});

test('Claude 桌面版：完成之后点开过这个会话 = 已读；完成之前点开的不算', () => {
  const evs = [ev('claude', 's', 'start', NOW - 10 * MIN), ev('claude', 's', 'done', NOW - 5 * MIN)];
  const after = one(evs, { io: io({ focus: { s: NOW - 2 * MIN } }) });
  assert.equal(after.seen, true);
  assert.equal(after.seen_via, 'app');
  assert.equal(one(evs, { io: io({ focus: { s: NOW - 7 * MIN } }) }).needs, true);
});

test('失联：超时没有任何活动；看过之后不再算需要注意', () => {
  const evs = [ev('codex', 'c', 'start', NOW - 20 * MIN)];
  const t = one(evs);
  assert.equal(t.state, 'stale');
  assert.equal(t.needs, true);
  assert.equal(one([...evs, ev('codex', 'c', 'seen', NOW - MIN)]).needs, false, '点过失联卡片就不该再一直提醒');
});

test('Codex 长回合：会话流文件还在写，就不算失联（以前 34 分钟的回合被报了 19 分钟失联）', () => {
  const evs = [ev('codex', 'c', 'start', NOW - 30 * MIN, { alive: '/fake/rollout.jsonl' })];
  assert.equal(one(evs, { io: io({ mtime: { '/fake/rollout.jsonl': NOW - 2 * MIN } }) }).state, 'running');
});

test('Codex 被你中断（turn_aborted → stopped）：停着，不算未读，也不会过 15 分钟变失联', () => {
  const t = one([ev('codex', 'c', 'start', NOW - 40 * MIN), ev('codex', 'c', 'stopped', NOW - 38 * MIN)]);
  assert.equal(t.state, 'idle');
  assert.equal(t.needs, false);
});

test('"等你"用长得多的尺子量：停 2 小时还是等你，不是失联', () => {
  const t = one([ev('claude', 's', 'start', NOW - 3 * H), ev('claude', 's', 'waiting', NOW - 2 * H)]);
  assert.equal(t.state, 'waiting');
});

test('长命令跑了 10 分钟 transcript 一声不吭：仍是运行中，写明在干什么（不再误判停着）', () => {
  const t = one([ev('claude', 's', 'start', NOW - 12 * MIN, { transcript: TR })], {
    io: io({
      info: { [TR]: info({ mtime: NOW - 10 * MIN, tool: { name: 'Bash', input: { description: '跑集成测试' }, at: NOW - 10 * MIN } }) },
      bg: { s: { bg: {}, busy: true } },
    }),
  });
  assert.equal(t.state, 'running');
  assert.equal(t.activity, '在跑：跑集成测试');
});

test('模型长时间生成：运行中 / 思考中', () => {
  const t = one([ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR })], {
    io: io({ info: { [TR]: info({ mtime: NOW - 3 * MIN, generating: true }) } }),
  });
  assert.equal(t.state, 'running');
  assert.equal(t.activity, '思考中');
});

test('只有真正的中断标记才算停着', () => {
  const t = one([ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR })], {
    io: io({ info: { [TR]: info({ interruptedAt: NOW - 4 * MIN }) } }),
  });
  assert.equal(t.state, 'idle');
  // 上一轮的中断不影响这一轮
  const u = one([ev('claude', 's', 'start', NOW - MIN, { transcript: TR })], {
    io: io({ info: { [TR]: info({ interruptedAt: NOW - 4 * MIN, generating: true }) } }),
  });
  assert.equal(u.state, 'running');
});

test('在问你问题：原因写成问题本身；没有 Notification 钩子也能判出"等你"', () => {
  const ask = { name: 'AskUserQuestion', input: { questions: [{ question: '用方案 A 还是 B？' }] }, at: NOW - 2 * MIN };
  const withHook = one([
    ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR }),
    ev('claude', 's', 'waiting', NOW - 2 * MIN, { summary: 'Claude needs your permission to use AskUserQuestion' }),
  ], { io: io({ info: { [TR]: info({ mtime: NOW - 2 * MIN, tool: ask }) } }) });
  assert.equal(withHook.state, 'waiting');
  assert.equal(withHook.summary, '问你：用方案 A 还是 B？');
  const noHook = one([ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR })],
    { io: io({ info: { [TR]: info({ mtime: NOW - 2 * MIN, tool: ask }) } }) });
  assert.equal(noHook.state, 'waiting');
});

test('要授权的提示翻成中文', () => {
  const t = one([ev('claude', 's', 'start', NOW - 5 * MIN),
    ev('claude', 's', 'waiting', NOW - MIN, { summary: 'Claude needs your permission to use Bash' })]);
  assert.equal(t.summary, '要授权：Bash');
});

test('批准之后命令在跑：transcript 没写，但有前台工具在执行 → 不再"等你"', () => {
  const t = one([
    ev('claude', 's', 'start', NOW - 10 * MIN, { transcript: TR }),
    ev('claude', 's', 'waiting', NOW - 8 * MIN),
  ], { io: io({
    info: { [TR]: info({ mtime: NOW - 8 * MIN, tool: { name: 'Bash', input: { command: 'make' }, at: NOW - 8 * MIN } }) },
    bg: { s: { bg: {}, busy: true } },
  }) });
  assert.equal(t.state, 'running');
});

test('API 报错结束这一轮：失败，原因就是报错', () => {
  const t = one([ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR })], {
    io: io({ info: { [TR]: info({ apiError: { at: NOW - 4 * MIN, text: 'API Error: 529 Overloaded' } }) } }),
  });
  assert.equal(t.state, 'failed');
  assert.equal(t.summary, 'API Error: 529 Overloaded');
  assert.equal(t.needs, true);
});

test('完成：副行是它最后一句话；问句结尾标出来', () => {
  const t = one([ev('claude', 's', 'start', NOW - 5 * MIN, { transcript: TR }), ev('claude', 's', 'done', NOW - MIN)], {
    io: io({ info: { [TR]: info({ lastReply: '要我顺便提交吗？', replyAt: NOW - MIN, asks: true }) } }),
  });
  assert.equal(t.summary, '要我顺便提交吗？');
  assert.equal(t.asks, true);
});

test('后台任务：只有 transcript 里登记过的才算后台；前台命令只证明还活着', () => {
  const evs = [ev('claude', 's', 'start', NOW - 10 * MIN), ev('claude', 's', 'done', NOW - 5 * MIN)];
  const bg = one(evs, { io: io({ bg: { s: { bg: { bg1: { running: true } }, busy: false } } }) });
  assert.equal(bg.state, 'bgrun');
  assert.equal(bg.needs, false);
  const fg = one(evs, { io: io({ bg: { s: { bg: {}, busy: true } } }) });
  assert.equal(fg.state, 'done');
});

test('退场：在跑的永远留着；看过的完成 12 小时后退场；没看过的 24 小时', () => {
  const out = project([
    ev('claude', 'run', 'start', NOW - 3 * 24 * H),
    ev('claude', 'read', 'start', NOW - 14 * H), ev('claude', 'read', 'done', NOW - 13 * H), ev('claude', 'read', 'seen', NOW - 13 * H),
    ev('claude', 'unread', 'start', NOW - 14 * H), ev('claude', 'unread', 'done', NOW - 13 * H),
  ], { now: NOW, io: io({ bg: { run: { bg: {}, busy: true } } }) });
  assert.deepEqual(out.map(t => t.key).sort(), ['run', 'unread']);
});

test('排序：进行中在前，等你排进行中的最前', () => {
  const out = project([
    ev('claude', 'done', 'start', NOW - 3 * MIN), ev('claude', 'done', 'done', NOW - MIN),
    ev('claude', 'run', 'start', NOW - 2 * MIN),
    ev('claude', 'wait', 'start', NOW - 10 * MIN), ev('claude', 'wait', 'waiting', NOW - 9 * MIN),
  ], { now: NOW, skipRetention: true });
  assert.deepEqual(out.map(t => t.key), ['wait', 'run', 'done']);
});
