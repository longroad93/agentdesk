#!/usr/bin/env node
// node:sqlite 会打实验性警告，读 workbuddy 的库要用它，静音掉别刷屏
process.removeAllListeners('warning');
process.on('warning', w => { if (!/SQLite is an experimental/.test(w.message)) console.warn(w.message); });
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { append, loadConfig, EVENTS_FILE } from '../src/store.js';
import { loadAdapters, toEvent } from '../src/adapters.js';
import { STATES, fmtAge } from '../src/states.js';

// 问一下正在跑的服务：没在跑返回 null；在跑但没有这个接口 = 升级前的旧版本还没重启
async function health(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    // 旧版本对任何路径都回 200 的 HTML 页面
    return r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : { old: true };
  } catch { return null; }
}

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
    // 先问服务端现在谁在负责弹通知：一个都没有的话，测试事件发了也不会弹，直接说原因
    const h = await health(loadConfig().port || 4517);
    console.log('');
    if (!h) { console.log('  服务没在跑，通知不可能弹出来。先起服务：agentdesk\n'); break; }
    if (h.old) { console.log('  在跑的服务还是升级前的旧版本，重启它才会用上新代码（开了自启的：launchctl kickstart -k gui/$(id -u)/com.agentdesk.server）\n'); break; }
    if (!h.notifier) {
      console.log('  \x1b[33m现在没有任何能弹通知的页面\x1b[0m，测试事件发了也不会弹：');
      const panel = h.clients.find(c => c.cap === 'native');
      if (panel) {
        console.log(panel.perm === 'unknown' ? '    · 悬浮窗是旧版本：重新运行 agentdesk panel'
          : panel.perm === 'denied' ? '    · 悬浮窗的通知被关了：系统设置 → 通知 → Agentdesk Panel → 允许通知'
          : '    · 悬浮窗还没授权：点它右上角的「开启通知」，系统会弹授权框');
      }
      const web = h.clients.filter(c => c.cap === 'web');
      if (web.length) {
        console.log(web.some(c => c.perm === 'denied') ? '    · 浏览器拒绝了面板的通知：到浏览器的网站设置里允许 localhost'
          : '    · 浏览器面板还没授权：点右上角「开启通知」');
      }
      if (!h.clients.length) console.log('    · 没有打开的面板：agentdesk panel（悬浮窗）或 agentdesk（浏览器）');
      console.log('');
      break;
    }
    append({ ...base, kind: 'waiting', summary: '这是一条测试通知，几秒后会自动变成"完成"' });
    const byPanel = h.notifier.cap === 'native';
    console.log(`  已注入测试事件，通知由${byPanel ? '悬浮窗' : '浏览器面板'}负责。现在应该弹出「⏸ 等你 · 通知自检」。`);
    console.log('  没弹的话看下面这几项：');
    console.log(`    1. 系统设置 → 通知 → ${byPanel ? 'Agentdesk Panel' : '你的浏览器'} → 允许通知`);
    console.log('    2. 系统「专注模式」是不是开着');
    console.log(`    3. 弹了但一闪而过：${byPanel ? 'Agentdesk Panel' : '浏览器'} 的通知样式是「横幅」，改成「提醒」才会一直停在屏幕上`);
    if (!byPanel) console.log('    4. 面板标签页是不是被浏览器休眠了（标题数字还会变就是活的）');
    console.log('');
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
      process.stdout.write('  正在编译悬浮面板（约 3 秒）...\n');
      try {
        mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
        execFileSync('swiftc', ['-O', '-o', exe, src, '-framework', 'Cocoa', '-framework', 'WebKit', '-framework', 'UserNotifications'],
          { stdio: 'inherit' });
        chmodSync(exe, 0o755);
        // NSUserNotificationAlertStyle=alert：请求默认用「提醒」样式（横幅几秒就消失）。
        // 新版 macOS 不一定理会（实测 macOS 26 仍是横幅），所以启动提示和 test 里还是让用户手动改
        writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>AgentdeskPanel</string>
  <key>CFBundleIdentifier</key><string>com.agentdesk.panel</string>
  <key>CFBundleName</key><string>Agentdesk Panel</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSUIElement</key><true/>
  <key>NSUserNotificationAlertStyle</key><string>alert</string>
</dict></plist>
`);
      } catch {
        console.log('\n  编译失败。需要 Xcode 命令行工具：xcode-select --install\n');
        break;
      }
      // 原生通知要求整个 .app 有签名；swiftc 的产物只有可执行文件带链接器签名，补一个 ad-hoc 签名
      try { execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' }); } catch { /* 没签上也能跑，只是可能弹不了通知 */ }
      // 旧版本还开着的话先关掉，而且要等它真的退出：还没退干净就 open，系统只会把旧进程调到前面
      try { execFileSync('pkill', ['-f', exe], { stdio: 'ignore' }); } catch { /* 没在跑 */ }
      for (let i = 0; i < 30; i++) {
        try { execFileSync('pgrep', ['-f', exe], { stdio: 'ignore' }); } catch { break; }   // pgrep 找不到 = 已退出
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    const port = rest.includes('--port') ? rest[rest.indexOf('--port') + 1] : '4517';
    spawn('open', ['-g', app, '--args', `http://localhost:${port}/?compact=1`],
      { stdio: 'ignore', detached: true }).unref();
    console.log('\n  悬浮面板已启动，右上角。拖动窗口任意位置可移动，关掉窗口即退出。');
    console.log('  通知由它负责：第一次会看到右上角「开启通知」，点一下，系统弹授权框时选允许。');
    console.log('  建议再到 系统设置 → 通知 → Agentdesk Panel 把样式改成「提醒」—— 默认的「横幅」几秒就消失。\n');
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

  // 和面板走同一条管道（view.js），看到的应该一模一样
  case 'status': {
    const { buildView, createIO } = await import('../src/view.js');
    const { createDesktopFocus } = await import('../src/readstate.js');
    const cfg = loadConfig();
    const desktop = createDesktopFocus();
    const tasks = buildView({ cfg, adapters: loadAdapters(), io: createIO({ desktop }) });
    const now = Date.now();
    console.log('');
    if (!tasks.length) console.log('  没有需要显示的任务（看过的任务到点会自己退场）。还没接入过的话：agentdesk init');
    for (const t of tasks.slice(0, 20)) {
      const st = STATES[t.state] || { icon: '?', label: t.state };
      const mark = t.needs ? '\x1b[1m' : '\x1b[2m';
      const sub = t.state === 'running' ? t.activity : t.state === 'waiting' || t.state === 'failed' ? t.summary : '';
      console.log(`  ${mark}${st.icon} ${st.label.padEnd(4)}\x1b[0m ${t.title.slice(0, 40).padEnd(42)}\x1b[2m${t.agent} · ${fmtAge(now - t.last_seen)}前${sub ? ' · ' + sub.slice(0, 40) : ''}\x1b[0m`);
    }
    const need = tasks.filter(t => t.needs).length;
    if (tasks.length) console.log(`\n  ${need ? `\x1b[33m${need} 个需要你处理\x1b[0m` : '都不用管'}`);
    // 已读判定靠的这几个信号，哪个失效了要看得见，别让它悄悄坏掉
    const h = await health(cfg.port || 4517);
    console.log(`\n  \x1b[2m已读信号：Claude 桌面版 ${desktop.count ? `${desktop.count} 个会话` : '读不到（会退回"回话 / 点击才算已读"）'}` +
      ` · 前台检测 ${process.platform === 'darwin' ? 'lsappinfo' : process.platform === 'win32' ? 'PowerShell' : '不支持'}` +
      ` · 服务 ${h?.old ? '\x1b[33m在跑，但还是旧版本，需要重启\x1b[2m' : h ? (h.notifier ? `在跑，通知由${h.notifier.cap === 'native' ? '悬浮窗' : '浏览器'}负责` : '在跑，\x1b[33m但没有能弹通知的页面\x1b[2m') : '没在跑'}\x1b[0m\n`);
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
    agentdesk panel        桌面悬浮小窗（macOS，常驻置顶，负责弹通知）
    agentdesk autostart    设为开机自启（--off 移除）
    agentdesk uninit       撤销 init 的所有改动（--dry-run 预览，--purge 连数据一起删）
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
