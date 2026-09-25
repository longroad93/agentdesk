import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertsOf, newAlerts, renderTemplate, fireWebhooks } from '../src/transitions.js';

const task = (id, state, needs, extra = {}) => ({ id, state, needs, title: 't', agent: 'claude', ...extra });

test('重启：用同一个函数初始化，第一次比较不会把所有任务判成新提醒', () => {
  const tasks = [task('a', 'done', true), task('b', 'failed', true), task('c', 'running', false)];
  assert.deepEqual(newAlerts(alertsOf(tasks), tasks), []);
});

test('点已读、标题晚生成、后台数变化：都不再提醒', () => {
  const before = [task('a', 'done', true, { title: '' })];
  const prev = alertsOf(before);
  assert.deepEqual(newAlerts(prev, [task('a', 'done', false)]), [], '标成已读');
  assert.deepEqual(newAlerts(prev, [task('a', 'done', true, { title: '后来生成的标题', bg: { x: {} } })]), [], '只是标题和后台数变了');
});

test('真的有新情况才提醒：新完成、等你、等你变失败', () => {
  const prev = alertsOf([task('a', 'running', false), task('b', 'waiting', true)]);
  const fired = newAlerts(prev, [task('a', 'done', true), task('b', 'failed', true), task('c', 'waiting', true)]);
  assert.deepEqual(fired.map(t => t.id), ['a', 'b', 'c']);
});

test('webhook 模板：替换对象里每个字符串值，引号不会把 JSON 弄坏', () => {
  const body = renderTemplate({ msg_type: 'text', content: { text: '{{agent}} {{state}}: {{title}}' }, n: 1, tags: ['{{agent}}'] },
    { agent: 'claude', state: 'waiting', title: '改 "支付" 模块\\' });
  assert.deepEqual(body, { msg_type: 'text', content: { text: 'claude waiting: 改 "支付" 模块\\' }, n: 1, tags: ['claude'] });
});

test('webhook：按 on 过滤，带超时', async () => {
  const calls = [];
  const fake = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
  await fireWebhooks([{ url: 'http://x/', on: ['waiting'] }], [task('a', 'done', true), task('b', 'waiting', true)], fake);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].opts.signal, '要有超时，挂住的地址不能拖住别的');
});
