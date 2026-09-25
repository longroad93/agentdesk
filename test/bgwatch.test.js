import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { utimesSync } from 'node:fs';
import { tmp, write } from './helpers.js';

const root = tmp('agentdesk-claude-tmp-');
process.env.AGENTDESK_CLAUDE_TMP = root;
const { scanBackground, tasksDirOf, heldSettled, onHeldChange } = await import('../src/bgwatch.js');

test('会话先被扫过、之后才建 tasks/：过了索引有效期要能检测到（服务跑久了新会话 bg 全空的 bug）', () => {
  const now = Date.now();
  assert.equal(tasksDirOf('sess-late', now), null);
  write(join(root, '-proj', 'sess-late', 'tasks', 'b1.output'), 'hello');
  assert.equal(tasksDirOf('sess-late', now + 1000), null, '索引有效期内沿用旧结果');
  assert.ok(tasksDirOf('sess-late', now + 11_000), '索引过期后重建，找到新目录');
});

test('退出标记 = 结束；刚写过 = 在跑；两小时没动 = 不算在跑', async () => {
  const dir = join(root, '-proj', 'sess-a', 'tasks');
  write(join(dir, 'done.output'), 'ok\n[exited with code 3]\n');
  const live = write(join(dir, 'live.output'), 'working');
  const old = write(join(dir, 'zombie.output'), 'stuck');
  const t = (Date.now() - 3 * 3600e3) / 1000;
  utimesSync(old, t, t);
  const m = (Date.now() - 60_000) / 1000;
  utimesSync(live, m, m);                     // 一分钟前写的：要靠 lsof 判断
  let changes = 0;
  onHeldChange(() => changes++);
  // 时间推到索引有效期之外，保证重建时能看到这个新会话
  const bg = scanBackground('sess-a', Date.now() + 60_000);
  assert.deepEqual(bg.done, { running: false, exit_code: 3, since: bg.done.since });
  assert.equal(bg.zombie.running, false);
  assert.equal(bg.live.running, true, 'lsof 结果回来之前按"在跑"算，不能先报完成');
  await heldSettled();
  assert.equal(changes, 1, '查询结果和临时判断不一样，要通知刷新');
  assert.equal(scanBackground('sess-a', Date.now()).live.running, false, '没有进程持有它');
});

test('被进程持有的文件：批量 lsof 认得出来', async () => {
  const { spawn } = await import('node:child_process');
  const file = write(join(root, '-proj', 'sess-b', 'tasks', 'held.output'), 'x');
  const m = (Date.now() - 60_000) / 1000;
  utimesSync(file, m, m);
  // 起一个进程把文件开着不放
  const child = spawn(process.execPath, ['-e', `require('fs').openSync(${JSON.stringify(file)}, 'r'); setTimeout(() => {}, 10000)`]);
  await new Promise(r => setTimeout(r, 500));
  try {
    scanBackground('sess-b', Date.now() + 120_000);
    await heldSettled();
    assert.equal(scanBackground('sess-b', Date.now() + 120_000).held.running, true);
  } finally { child.kill(); }
});
