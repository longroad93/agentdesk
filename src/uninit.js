// 撤销 init 做过的一切。
//
// 不用"还原备份文件"的做法 —— 你在 init 之后可能又改过这些配置，
// 整体还原会把你自己的改动一起抹掉。这里只精确摘掉 agentdesk 加的那几条。
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadAdapters } from './adapters.js';
import { loadConfig, saveConfig, HOME } from './store.js';

const expand = p => p.replace(/^~/, homedir());
const isOurs = s => /agentdesk/i.test(String(s));

export async function uninit({ dryRun = false, purge = false } = {}) {
  const report = [];
  const cfg = loadConfig();

  for (const [name, def] of Object.entries(loadAdapters())) {
    if (!def.install) continue;
    try {
      if (def.install.type === 'claude-hooks') report.push([name, ...stripClaudeHooks(def, dryRun)]);
      else if (def.install.type === 'toml-notify') report.push([name, ...restoreNotify(def, name, cfg, dryRun)]);
    } catch (err) {
      report.push([name, 'fail', err.message]);
    }
  }

  // 自启、常驻进程、helper 一并收掉，否则"卸载了还在跑"
  report.push(['autostart', ...removeAutostart(dryRun)]);
  report.push(['进程', ...killRunning(dryRun)]);

  if (purge && !dryRun) {
    try {
      rmSync(HOME, { recursive: true, force: true });
      report.push(['数据', 'ok', `已删除 ${HOME}`]);
    } catch (err) {
      report.push(['数据', 'fail', err.message]);
    }
  } else {
    report.push(['数据', 'skip', purge ? '' : `保留在 ${HOME}（加 --purge 一并删除）`]);
  }

  if (!dryRun) {
    delete cfg.chained;
    saveConfig(cfg);
  }

  console.log('');
  for (const [name, status, msg] of report) {
    const icon = status === 'ok' ? '\x1b[32m✓\x1b[0m' : status === 'skip' ? '\x1b[2m–\x1b[0m' : '\x1b[31m✕\x1b[0m';
    console.log(`  ${icon} ${String(name).padEnd(10)} ${msg}`);
  }
  console.log(`\n  ${dryRun ? '（--dry-run，什么都没改）' : '已卸载。备份文件 .agentdesk-backup 保留着，确认没问题可以自行删除。'}\n`);
}

function stripClaudeHooks(def, dryRun) {
  const file = expand(def.detect.config);
  if (!existsSync(file)) return ['skip', '配置文件不存在'];
  const s = JSON.parse(readFileSync(file, 'utf8'));
  if (!s.hooks) return ['skip', '没有 hooks 配置'];

  let removed = 0;
  for (const [evt, entries] of Object.entries(s.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(e => {
      const hit = (e.hooks || []).some(h => isOurs(h.command));
      if (hit) removed++;
      return !hit;
    });
    if (kept.length) s.hooks[evt] = kept;
    else delete s.hooks[evt];         // 这个事件只剩我们的，整个键删掉
  }
  if (!removed) return ['skip', '没有 agentdesk 的 hook'];
  if (!Object.keys(s.hooks).length) delete s.hooks;
  if (dryRun) return ['ok', `会摘掉 ${removed} 条 hook`];
  writeFileSync(file, JSON.stringify(s, null, 2));
  return ['ok', `已摘掉 ${removed} 条 hook，你自己的配置原样保留`];
}

function restoreNotify(def, name, cfg, dryRun) {
  const file = expand(def.install.file);
  if (!existsSync(file)) return ['skip', '配置文件不存在'];
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^\s*notify\s*=\s*(\[[^\]]*\])/m);
  if (!m || !isOurs(m[1])) return ['skip', 'notify 不是 agentdesk 的'];

  const orig = (cfg.chained || {})[name];
  if (dryRun) return ['ok', orig ? `会还原成 ${String(orig[0]).split(/[/\\]/).pop()}` : '会删掉这行 notify'];
  writeFileSync(file, orig
    ? text.replace(m[0], `notify = ${JSON.stringify(orig)}`)
    : text.replace(m[0] + '\n', '').replace(m[0], ''));
  return ['ok', orig ? `已还原成接管前的 ${String(orig[0]).split(/[/\\]/).pop()}` : '已删掉 notify 行'];
}

function removeAutostart(dryRun) {
  const plist = join(homedir(), 'Library/LaunchAgents/com.agentdesk.server.plist');
  if (process.platform === 'darwin' && existsSync(plist)) {
    if (dryRun) return ['ok', '会移除开机自启'];
    try { execFileSync('launchctl', ['unload', '-w', plist], { stdio: 'ignore' }); } catch { /* 没加载过 */ }
    unlinkSync(plist);
    return ['ok', '已移除开机自启'];
  }
  if (process.platform === 'win32') {
    const vbs = join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs/Startup/agentdesk.vbs');
    if (existsSync(vbs)) {
      if (dryRun) return ['ok', '会移除开机自启'];
      unlinkSync(vbs);
      return ['ok', '已移除开机自启'];
    }
  }
  return ['skip', '没设过开机自启'];
}

function killRunning(dryRun) {
  if (dryRun) return ['ok', '会停掉服务和悬浮窗'];
  let n = 0;
  for (const pat of ['agentdesk.js serve', 'agentdesk-panel', 'AgentdeskHelper']) {
    try { execFileSync('pkill', ['-f', pat], { stdio: 'ignore' }); n++; } catch { /* 没在跑 */ }
  }
  return ['ok', n ? '已停掉在跑的进程' : '没有在跑的进程'];
}
