// 测试用的小工具：临时目录、造 transcript 行、造事件
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function tmp(prefix = 'agentdesk-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

export function append(path, text) {
  appendFileSync(path, text);
  return path;
}

const iso = at => new Date(at).toISOString();
export const asst = (at, blocks, extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), message: { role: 'assistant', content: blocks }, ...extra }) + '\n';
export const user = (at, content, extra = {}) =>
  JSON.stringify({ type: 'user', timestamp: iso(at), message: { role: 'user', content }, ...extra }) + '\n';
export const text = t => ({ type: 'text', text: t });
export const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
export const toolResult = (id, content = 'ok') => ({ type: 'tool_result', tool_use_id: id, content });

// 事件：ev('claude', 's1', 'start', 1000, { prompt: 'hi' })
export const ev = (agent, key, kind, ts, extra = {}) => ({ ts, agent, key, kind, ...extra });
