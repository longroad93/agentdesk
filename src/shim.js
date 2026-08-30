// codex/kimi 的 notify 只能配一个命令。这个 shim 先把原来那个原样转发，
// 再顺手记一份自己的 —— 不这么做会直接废掉用户已有的功能。
import { spawn } from 'node:child_process';
import { append } from './store.js';
import { loadAdapters, toEvent } from './adapters.js';
import { loadConfig } from './store.js';

const agent = process.argv[2];
const passthrough = process.argv.slice(3);

const all = loadAdapters();
const def = all[agent] || Object.values(all).find(d =>
  d.name === agent && (d.source === 'stdin' || d.source === 'argv'));
if (def) {
  try {
    const raw = { stdin: '', argv: passthrough };
    const ev = toEvent(def, raw, agent);
    if (ev) {
      if (!ev.cwd) ev.cwd = process.cwd();
      append(ev);
    } else {
      const { probe } = await import('./probe.js');
      probe(agent, raw, 'adapter 未匹配，照这份数据补一条 rule');
    }
  } catch { /* 记录失败绝不能影响转发 */ }
}

const chained = (loadConfig().chained || {})[agent];
if (chained && chained.length) {
  const [bin, ...args] = chained;
  spawn(bin, [...args, ...passthrough], { stdio: 'inherit', detached: false })
    .on('exit', code => process.exit(code ?? 0));
} else {
  process.exit(0);
}
