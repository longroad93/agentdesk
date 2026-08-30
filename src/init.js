// 自动接入。任何需要用户手动编辑 JSON 的步骤都会劝退一半人，所以这里尽量做全。
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadAdapters } from './adapters.js';
import { loadConfig, saveConfig, ensureHome } from './store.js';

const SELF = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expand = p => p.replace(/^~/, homedir()).replace(/\//g, process.platform === 'win32' ? '\\' : '/');

// process.execPath 在 Homebrew 下是 .../Cellar/node/25.2.1/bin/node，版本号写死了。
// node 一升级所有钩子就失效，所以优先取 PATH 里的软链。
export function nodeBin() {
  try {
    const p = execSync(process.platform === 'win32' ? 'where node' : 'command -v node',
      { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (p && !p.includes('/Cellar/')) return p;
  } catch {}
  return process.execPath;
}

// 装了全局包就用短命令，否则退回 node + 绝对路径（开发/免安装场景）
function cmdFor(sub) {
  let onPath = false;
  try {
    execSync(process.platform === 'win32' ? 'where agentdesk' : 'command -v agentdesk',
      { stdio: 'ignore' });
    onPath = true;
  } catch {}
  return onPath
    ? `agentdesk ${sub}`
    : `"${nodeBin()}" "${join(SELF, 'bin', 'agentdesk.js')}" ${sub}`;
}

function backup(file) {
  const bak = file + '.agentdesk-backup';
  if (existsSync(file) && !existsSync(bak)) copyFileSync(file, bak);
  return bak;
}

export async function init({ dryRun = false } = {}) {
  ensureHome();
  const adapters = loadAdapters();
  const cfg = loadConfig();
  cfg.chained = cfg.chained || {};
  const report = [];

  for (const [name, def] of Object.entries(adapters)) {
    if (!def.install) continue;          // 轮询型 adapter 不需要写任何配置
    const detected = detect(def);
    if (!detected) { report.push([name, 'skip', '未检测到']); continue; }
    try {
      const msg = def.install?.type === 'claude-hooks'
        ? installClaudeHooks(def, name, dryRun)
        : def.install?.type === 'toml-notify'
        ? installTomlNotify(def, name, cfg, dryRun)
        : '该 adapter 没有安装方式，需要手动配置';
      report.push([name, 'ok', msg]);
    } catch (err) {
      report.push([name, 'fail', err.message]);
    }
  }

  if (!dryRun) saveConfig(cfg);

  console.log('');
  for (const [name, status, msg] of report) {
    const icon = status === 'ok' ? '\x1b[32m✓\x1b[0m' : status === 'skip' ? '\x1b[2m–\x1b[0m' : '\x1b[31m✕\x1b[0m';
    console.log(`  ${icon} ${name.padEnd(10)} ${msg}`);
  }
  console.log(`\n  ${dryRun ? '（--dry-run，什么都没改）' : '配置已写入，原文件都留了 .agentdesk-backup'}`);
  console.log('  下一步: agentdesk\n');
}

function detect(def) {
  const { bin, config } = def.detect || {};
  if (config && existsSync(expand(config))) return true;
  if (!bin) return false;
  try {
    execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function installClaudeHooks(def, name, dryRun) {
  const file = expand(def.detect.config);
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  settings.hooks = settings.hooks || {};
  const command = cmdFor(`hook ${name}`);

  let added = 0;
  for (const evt of def.install.events) {
    settings.hooks[evt] = settings.hooks[evt] || [];
    const already = JSON.stringify(settings.hooks[evt]).includes('agentdesk');
    if (already) continue;
    const entry = { hooks: [{ type: 'command', command }] };
    const matcher = def.install.matchers?.[evt];
    if (matcher) entry.matcher = matcher;
    settings.hooks[evt].push(entry);
    added++;
  }
  if (!added) return '已经配过了，跳过';
  if (dryRun) return `会往 ${def.install.events.length} 个 hook 里加一条`;
  backup(file);
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return `已接入 ${added} 个 hook (${def.install.events.join(', ')})`;
}

function installTomlNotify(def, name, cfg, dryRun) {
  const file = expand(def.install.file);
  if (!existsSync(file)) return '配置文件不存在，跳过';
  const text = readFileSync(file, 'utf8');
  const shim = [nodeBin(), join(SELF, 'src', 'shim.js'), name];
  const line = `notify = ${JSON.stringify(shim)}`;

  const m = text.match(/^\s*notify\s*=\s*(\[[^\]]*\])/m);
  if (m) {
    const existing = JSON.parse(m[1].replace(/'/g, '"'));
    if (existing.some(x => String(x).includes('agentdesk') || String(x).includes('shim.js'))) {
      return '已经配过了，跳过';
    }
    // 关键：原来那个 notify 不能丢，存起来让 shim 转发
    cfg.chained[name] = existing;
    if (dryRun) return `会接管 notify，并保留转发给 ${existing[0].split(/[/\\]/).pop()}`;
    backup(file);
    writeFileSync(file, text.replace(m[0], line));
    return `已接管 notify，原有的 ${existing[0].split(/[/\\]/).pop()} 会被转发调用`;
  }

  if (dryRun) return '会新增一行 notify';
  backup(file);
  writeFileSync(file, line + '\n' + text);
  return '已写入 notify';
}
