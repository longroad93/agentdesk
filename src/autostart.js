// 开机自启。面板的价值在于"你不用记得开它"，每次重启都要手动敲一遍命令，
// 这个前提就不成立了。
//
// macOS 用 LaunchAgent（KeepAlive 让它崩了也能自己回来），
// Windows 放一个 .vbs 到启动文件夹（用 vbs 是为了不闪黑窗）。
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { HOME, ensureHome } from './store.js';

const LABEL = 'com.agentdesk.server';
const plistPath = () => join(homedir(), 'Library/LaunchAgents', LABEL + '.plist');
const vbsPath = () => join(process.env.APPDATA || homedir(),
  'Microsoft/Windows/Start Menu/Programs/Startup/agentdesk.vbs');

function nodeBin() {
  try {
    const p = execFileSync(process.platform === 'win32' ? 'where' : 'command',
      process.platform === 'win32' ? ['node'] : ['-v', 'node'],
      { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    // Homebrew 的 process.execPath 带版本号（.../Cellar/node/25.2.1/...），
    // node 一升级自启就废了，优先用 PATH 里的软链
    if (p && !p.includes('/Cellar/')) return p;
  } catch { /* 落回 execPath */ }
  return process.execPath;
}

export function installAutostart({ dir, panel = true, off = false } = {}) {
  if (off) return remove();
  if (process.platform === 'darwin') return macos(dir, panel);
  if (process.platform === 'win32') return windows(dir);
  console.log(`
  这个平台还没做自启。手动起：
    nohup node ${join(dir, 'bin/agentdesk.js')} serve --no-open > /dev/null 2>&1 &
`);
  return false;
}

function macos(dir, panel) {
  ensureHome();
  const entry = join(dir, 'bin', 'agentdesk.js');
  const args = [nodeBin(), entry, 'serve', '--no-open'];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map(a => '    <string>' + a.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</string>').join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(HOME, 'server.log')}</string>
  <key>StandardErrorPath</key><string>${join(HOME, 'server.log')}</string>
</dict>
</plist>
`;
  const p = plistPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, plist);
  try { execFileSync('launchctl', ['unload', p], { stdio: 'ignore' }); } catch { /* 之前没加载过 */ }
  execFileSync('launchctl', ['load', '-w', p], { stdio: 'ignore' });

  console.log(`
  ✓ 服务已设为开机自启（崩了也会自动拉起）
    ${p}
    日志：${join(HOME, 'server.log')}
`);

  if (panel) {
    // 悬浮窗是 GUI，交给 launchctl 管会有会话作用域的坑，用登录项更稳
    const app = join(dir, 'panel', 'AgentdeskPanel.app');
    if (existsSync(app)) {
      try {
        execFileSync('osascript', ['-e',
          `tell application "System Events" to make login item at end with properties {path:"${app}", hidden:true}`],
          { stdio: 'ignore' });
        console.log('  ✓ 悬浮窗已加入登录项\n');
      } catch {
        console.log('  – 悬浮窗加入登录项失败，可以手动拖进「系统设置 → 通用 → 登录项」\n');
      }
    } else {
      console.log('  – 悬浮窗还没打包成 .app，暂时需要每次手动 agentdesk panel\n');
    }
  }
  return true;
}

function windows(dir) {
  const entry = join(dir, 'bin', 'agentdesk.js');
  // WScript.Shell 的 Run 第三参数 0 = 隐藏窗口，不然每次开机闪一个黑框
  const vbs = `Set s = CreateObject("WScript.Shell")
s.Run """${nodeBin()}"" ""${entry}"" serve --no-open", 0, False
`;
  const p = vbsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, vbs);
  console.log(`\n  ✓ 服务已设为开机自启\n    ${p}\n`);
  return true;
}

function remove() {
  let done = false;
  const p = plistPath();
  if (existsSync(p)) {
    try { execFileSync('launchctl', ['unload', '-w', p], { stdio: 'ignore' }); } catch {}
    unlinkSync(p);
    done = true;
  }
  const v = vbsPath();
  if (existsSync(v)) { unlinkSync(v); done = true; }
  try {
    execFileSync('osascript', ['-e',
      'tell application "System Events" to delete (every login item whose name contains "Agentdesk")'],
      { stdio: 'ignore' });
  } catch { /* 没有就算了 */ }
  console.log(done ? '\n  ✓ 开机自启已移除\n' : '\n  – 本来就没设过开机自启\n');
  return done;
}
