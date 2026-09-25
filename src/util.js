// 几处共用的小工具。以前 init.js / autostart.js 各有一份 nodeBin，实现还不一样，
// pollers / init / uninit 各有一份 expand。
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export const expand = p => String(p).replace(/^~(?=$|[\\/])/, homedir());

// 装在 PATH 上的命令。走 sh -c 'command -v "$1"' 而不是字符串拼接，adapter 里写的 bin 名不会被当成 shell 代码
export function which(bin) {
  try {
    const out = process.platform === 'win32'
      ? execFileSync('where', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

// process.execPath 在 Homebrew 下带版本号（.../Cellar/node/25.2.1/bin/node），
// node 一升级，钩子和自启就全废了，所以优先取 PATH 里的软链
export function nodeBin() {
  const p = which('node');
  return p && !p.includes('/Cellar/') ? p : process.execPath;
}
