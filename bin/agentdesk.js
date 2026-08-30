#!/usr/bin/env node
// node:sqlite 会打实验性警告，读 workbuddy 的库要用它，静音掉别刷屏
process.removeAllListeners('warning');
process.on('warning', w => { if (!/SQLite is an experimental/.test(w.message)) console.warn(w.message); });
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { append, loadEvents, project, loadConfig, EVENTS_FILE } from '../src/store.js';
import { loadAdapters, toEvent } from '../src/adapters.js';
import { STATES, ATTENTION, fmtAge } from '../src/states.js';

const [cmd, ...rest] = process.argv.slice(2);

function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

switch (cmd) {
  case undefined:
  case 'serve': {
    const { serve } = await import('../src/server.js');
    const p = rest.includes('--port') ? Number(rest[rest.indexOf('--port') + 1]) : undefined;
    const server = serve({ port: p });
    if (!rest.includes('--no-open')) {
      server.once('listening', () => openBrowser(`http://localhost:${server.address().port}`));
    }
    break;
  }

  // agent 钩子调这个。必须快 —— claude 会等它返回才继续。
  case 'hook': {
    const name = rest[0];
    const all = loadAdapters();
    const def = all[name] || Object.values(all).find(d =>
      d.name === name && (d.source === 'stdin' || d.source === 'argv'));
    if (!def) { process.stderr.write(`[agentdesk] 没有 ${name} 的 adapter\n`); process.exit(0); }
    const raw = { stdin: readStdin(), argv: rest.slice(1) };
    const ev = toEvent(def, raw, name);
    if (ev && ev.kind === 'ignore') {
      process.exit(0);                 // 规则明确说了不关心，不是没匹配上
    } else if (ev) {
      if (!ev.cwd) ev.cwd = process.cwd();
      append(ev);
    } else {
      // 没有规则匹配上：把原始数据留下来，不然这次调用就白白丢了
      const { probe } = await import('../src/probe.js');
      probe(name, raw, 'adapter 未匹配，照这份数据补一条 rule');
    }
    process.exit(0);
  }

  // 什么钩子都没有的工具，用它包一层
  case 'run': {
    const sep = rest.indexOf('--');
    if (sep < 0) { console.error('用法: agentdesk run "任务标题" -- <命令>'); process.exit(1); }
    // --as 只在 -- 之前找，否则用户命令里出现同名参数会被误判
    const head = rest.slice(0, sep);
    const asAt = head.indexOf('--as');
    const label = asAt >= 0 ? head[asAt + 1] : null;
    if (asAt >= 0) head.splice(asAt, 2);
    const [bin, ...args] = rest.slice(sep + 1);
    const title = head.join(' ') || bin;
    const key = `${process.pid}-${Date.now().toString(36)}`;
    const base = { agent: label || bin, key, title, cwd: process.cwd(), confidence: 'process' };
    append({ ...base, kind: 'start' });
    const child = spawn(bin, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    const beat = setInterval(() => append({ ...base, kind: 'heartbeat' }), 60_000);
    child.on('exit', code => {
      clearInterval(beat);
      append({ ...base, kind: code === 0 ? 'done' : 'failed', summary: code === 0 ? '正常结束' : `退出码 ${code}` });
      process.exit(code ?? 0);
    });
    break;
  }

  // 接入任何新 agent 的第一步：先看它到底传了什么过来
  case 'probe': {
    const { probe } = await import('../src/probe.js');
    probe(rest[0] || 'unknown', { stdin: readStdin(), argv: rest.slice(1) });
    break;
  }

  case 'init': {
    const { init } = await import('../src/init.js');
    await init({ dryRun: rest.includes('--dry-run') });
    break;
  }

  // 装完先跑这个，确认通知真能弹出来 —— 不然你不知道是没事件还是通知坏了
  case 'test': {
    const key = '__selftest__';
    const base = { agent: 'agentdesk', key, cwd: process.cwd(), title: '通知自检', confidence: 'exact' };
    append({ ...base, kind: 'waiting', summary: '这是一条测试通知，几秒后会自动变成"完成"' });
    console.log('\n  已注入测试事件。现在应该弹出一条「⏸ 等你 · 通知自检」的系统通知。');
    console.log('  没弹的话看下面这几项：');
    console.log('    1. 面板右上角「开启通知」是不是已经变成蓝色的「通知已开启」');
    console.log('    2. macOS 系统设置 → 通知 → 你的浏览器 → 允许通知');
    console.log('    3. 系统「专注模式」是不是开着');
    console.log('    4. 面板标签页是不是被浏览器休眠了（标题数字还会变就是活的）\n');
    setTimeout(() => {
      append({ ...base, kind: 'done', summary: '自检结束' });
      console.log('  已变成「完成」，第二条通知应该也弹了。\n');
    }, 6000);
    break;
  }

  // 桌面悬浮面板（macOS）。首次调用现编译并打包成 .app —— 打包是为了能加进登录项。
  case 'panel': {
    const { existsSync, statSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { execFileSync } = await import('node:child_process');
    if (process.platform !== 'darwin') {
      console.log('\n  悬浮面板目前只有 macOS 版。其他平台用浏览器面板：agentdesk\n');
      break;
    }
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const src = join(root, 'panel', 'panel.swift');
    const app = join(root, 'panel', 'AgentdeskPanel.app');
    const exe = join(app, 'Contents', 'MacOS', 'AgentdeskPanel');
    const stale = !existsSync(exe) || statSync(exe).mtimeMs < statSync(src).mtimeMs;
    if (stale) {
      process.stdout.write('  首次运行，正在编译悬浮面板（约 3 秒）...\n');
      try {
        mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
        execFileSync('swiftc', ['-O', '-o', exe, src, '-framework', 'Cocoa', '-framework', 'WebKit'],
          { stdio: 'inherit' });
        chmodSync(exe, 0o755);
        writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>AgentdeskPanel</string>
  <key>CFBundleIdentifier</key><string>com.agentdesk.panel</string>
  <key>CFBundleName</key><string>Agentdesk Panel</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
      } catch {
        console.log('\n  编译失败。需要 Xcode 命令行工具：xcode-select --install\n');
        break;
      }
    }
    const port = rest.includes('--port') ? rest[rest.indexOf('--port') + 1] : '4517';
    spawn('open', ['-g', app, '--args', `http://localhost:${port}/?compact=1`],
      { stdio: 'ignore', detached: true }).unref();
    console.log('\n  悬浮面板已启动，右上角。拖动窗口任意位置可移动，关掉窗口即退出。\n');
    break;
  }

  case 'uninit': {
    const { uninit } = await import('../src/uninit.js');
    await uninit({ dryRun: rest.includes('--dry-run'), purge: rest.includes('--purge') });
    break;
  }

  case 'autostart': {
    const { installAutostart } = await import('../src/autostart.js');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    installAutostart({
      dir: join(dirname(fileURLToPath(import.meta.url)), '..'),
      panel: !rest.includes('--no-panel'),
      off: rest.includes('--off'),
    });
    break;
  }

  case 'status': {
    const tasks = project(loadEvents(), { timeouts: loadConfig().timeouts });
    if (!tasks.length) { console.log('\n  还没有任务事件。跑 agentdesk init 接入 agent。\n'); break; }
    const now = Date.now();
    console.log('');
    for (const t of tasks.slice(0, 20)) {
      const st = STATES[t.state] || { icon: '?', label: t.state };
      const mark = ATTENTION.includes(t.state) ? '\x1b[1m' : '\x1b[2m';
      console.log(`  ${mark}${st.icon} ${st.label.padEnd(4)}\x1b[0m ${t.title.slice(0, 46).padEnd(48)}\x1b[2m${t.agent} · ${fmtAge(now - t.last_seen)}前\x1b[0m`);
    }
    const need = tasks.filter(t => ATTENTION.includes(t.state)).length;
    console.log(`\n  ${need ? `\x1b[33m${need} 个需要你处理\x1b[0m` : '都不用管'}\n`);
    break;
  }

  default:
    console.log(`
  agentdesk — 一个面板看住所有 AI agent

    agentdesk              启动面板（默认 http://localhost:4517）
    agentdesk serve        只起服务不开浏览器（--no-open）
    agentdesk init         自动检测并接入已安装的 agent
    agentdesk status       终端里快速看一眼
    agentdesk test         自检：验证通知能不能弹出来
    agentdesk panel        桌面悬浮小窗（macOS，常驻置顶）\n    agentdesk autostart    设为开机自启（--off 移除）\n    agentdesk uninit       撤销 init 的所有改动（--dry-run 预览，--purge 连数据一起删）
    agentdesk run "标题" -- <命令>    包装任意没有钩子的工具
    agentdesk probe <名字>            探针：dump 某个 agent 传来的原始数据

  事件日志: ${EVENTS_FILE}
`);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
}
