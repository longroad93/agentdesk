// 接入新 agent 不靠读文档、不靠逆向二进制 —— 让它自己把数据交出来。
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, ensureHome } from './store.js';

export function probe(name, raw, tag = '') {
  ensureHome();
  const file = join(HOME, `probe-${name}.log`);
  const note = tag ? { note: tag } : {};
  const dump = {
    ...note,
    at: new Date().toISOString(),
    argv: raw.argv,
    stdin: raw.stdin ? tryParse(raw.stdin) : null,
    cwd: process.cwd(),
    env: safeEnv(),
  };
  appendFileSync(file, JSON.stringify(dump, null, 2) + '\n---\n');
  if (!tag) process.stderr.write(`[agentdesk] 已记录到 ${file}\n`);
}

// probe 日志是用来贴 issue 求助的，绝不能把凭证带出去
const SENSITIVE = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION_ID/i;
function safeEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/SESSION|AGENT|CLAUDE|CODEX|KIMI|TURN|THREAD/i.test(k)) continue;
    if (SENSITIVE.test(k)) { out[k] = '<redacted>'; continue; }
    // 名字看不出来的，按形态兜一层：长串 hex / base64 一律当凭证处理
    out[k] = /^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(v) ? '<redacted>' : v;
  }
  return out;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
