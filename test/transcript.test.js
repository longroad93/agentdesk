import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { transcriptInfo, describeTool, backgroundIds, subagentsMtime } from '../src/transcript.js';
import { tmp, write, append, asst, user, text, toolUse, toolResult } from './helpers.js';

const T0 = Date.parse('2026-09-01T10:00:00Z');

test('正在执行的工具：有 tool_use 没有 tool_result', () => {
  const p = write(join(tmp(), 'a.jsonl'),
    user(T0, 'run the tests') +
    asst(T0 + 1000, [text('跑一下测试'), toolUse('t1', 'Bash', { command: 'npm test', description: '跑单测' })]));
  const info = transcriptInfo(p);
  assert.equal(info.tool.name, 'Bash');
  assert.equal(describeTool(info.tool, 'run'), '在跑：跑单测');
  assert.equal(describeTool(info.tool, 'ask'), '要执行：跑单测');
  assert.equal(info.generating, false);
});

test('工具有了结果就不算在跑；最后一行回复是问句时 asks=true', () => {
  const p = write(join(tmp(), 'b.jsonl'),
    user(T0, 'go') +
    asst(T0 + 1000, [toolUse('t1', 'Read', { file_path: '/x/a.js' })]) +
    user(T0 + 2000, [toolResult('t1')]) +
    asst(T0 + 3000, [text('改好了。\n\n**要我顺便提交吗？**')]));
  const info = transcriptInfo(p);
  assert.equal(info.tool, null);
  assert.equal(info.lastReply, '要我顺便提交吗？');
  assert.equal(info.asks, true);
  assert.equal(info.generating, false);
});

test('中断标记', () => {
  const p = write(join(tmp(), 'c.jsonl'),
    user(T0, 'go') +
    asst(T0 + 1000, [text('开始')]) +
    user(T0 + 5000, [text('[Request interrupted by user]')]));
  const info = transcriptInfo(p);
  assert.equal(info.interruptedAt, T0 + 5000);
  assert.equal(info.generating, false, '中断标记本身是一条 user 条目，不能被当成"你说完话在等回复"');
});

test('你说完话、模型还没回：正在生成；本地命令不算', () => {
  const dir = tmp();
  const p = write(join(dir, 'd.jsonl'), asst(T0, [text('上一轮')]) + user(T0 + 1000, '下一个问题'));
  assert.equal(transcriptInfo(p).generating, true);
  const q = write(join(dir, 'e.jsonl'), asst(T0, [text('上一轮')]) +
    user(T0 + 1000, '<local-command-stdout>ok</local-command-stdout>') +
    user(T0 + 1100, 'Caveat: ...', { isMeta: true }));
  assert.equal(transcriptInfo(q).generating, false);
});

test('API 报错结尾', () => {
  const p = write(join(tmp(), 'f.jsonl'),
    user(T0, 'go') +
    asst(T0 + 1000, [text('API Error: 529 Overloaded. This is a server-side issue')], { isApiErrorMessage: true }));
  const info = transcriptInfo(p);
  assert.match(info.apiError.text, /Overloaded/);
  assert.equal(info.apiError.at, T0 + 1000);
  // 重试成功之后就不算了
  append(p, asst(T0 + 9000, [text('好了')]));
  assert.equal(transcriptInfo(p).apiError, null);
});

test('子代理（sidechain）的条目不影响主会话判断', () => {
  const p = write(join(tmp(), 'g.jsonl'),
    user(T0, 'go') +
    asst(T0 + 1000, [text('派个子任务'), toolUse('t1', 'Agent', { description: '查资料' })]) +
    asst(T0 + 2000, [toolUse('s1', 'Bash', { command: 'ls' })], { isSidechain: true }));
  const info = transcriptInfo(p);
  assert.equal(info.tool.name, 'Agent');
  assert.equal(describeTool(info.tool), '子任务：查资料');
});

test('标题：customTitle 优先；只写在开头的标题也能从头部读到', () => {
  const dir = tmp();
  const p = write(join(dir, 'h.jsonl'),
    JSON.stringify({ type: 'ai-title', aiTitle: 'AI 起的' }) + '\n' +
    JSON.stringify({ type: 'custom-title', customTitle: '我改的' }) + '\n');
  assert.equal(transcriptInfo(p).title, '我改的');
  const filler = user(T0, 'x'.repeat(1000));
  const q = write(join(dir, 'i.jsonl'),
    JSON.stringify({ type: 'ai-title', aiTitle: '开头的标题' }) + '\n' + filler.repeat(200));
  assert.equal(transcriptInfo(q).title, '开头的标题');
});

test('AskUserQuestion 说成人话', () => {
  const t = { name: 'AskUserQuestion', input: { questions: [{ question: '用方案 A 还是 B？' }] } };
  assert.equal(describeTool(t, 'ask'), '问你：用方案 A 还是 B？');
  assert.equal(describeTool({ name: 'mcp__srv__do_thing' }, 'ask'), '要用：do_thing');
  assert.equal(describeTool({ name: 'mcp__Claude_Browser__preview_start' }, 'run'), '在用：preview_start', '服务名带下划线');
});

test('最后一句回复里的 markdown 链接只留文字', () => {
  const p = write(join(tmp(), 'k.jsonl'), asst(T0, [text('做完了。\n来源：[官方文档](https://example.com/a)、[博客](https://b.example)')]));
  assert.equal(transcriptInfo(p).lastReply, '来源：官方文档、博客');
});

test('后台任务 ID：增量扫描，只认两种固定说法', () => {
  const p = write(join(tmp(), 'j.jsonl'),
    user(T0, [toolResult('t1', 'Command running in background with ID: bg7xqr8yb. Output is being written to ...')]) +
    user(T0 + 1, [toolResult('t2', 'total 8\nbsw5zqnhe.output')]));
  assert.deepEqual([...backgroundIds(p)], ['bg7xqr8yb'], 'ls 输出里顺带出现的文件名不算');
  append(p, user(T0 + 2, [toolResult('t3', 'Async agent launched. agentId: a1b2c3')]));
  assert.deepEqual([...backgroundIds(p)].sort(), ['a1b2c3', 'bg7xqr8yb']);
});

test('子代理 transcript 的修改时间算作主会话的存活信号', () => {
  const dir = tmp();
  const main = write(join(dir, 'sess.jsonl'), user(T0, 'go'));
  assert.equal(subagentsMtime(main), 0);
  write(join(dir, 'sess', 'subagents', 'agent-1.jsonl'), 'x');
  assert.ok(subagentsMtime(main, Date.now() + 5000) > 0);
});
