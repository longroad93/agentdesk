// 单页面板，内嵌不外链：整页一个响应，没有静态资源路由。
// 前端代码放在 ui/ 下的真文件里。以前是字符串数组拼出来的 —— 手工转义、没有高亮、不能 lint，
// 写错一个引号页面就静默空白（server 启动时的编译检查就是为这个加的，现在也还留着）。
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`./ui/${f}`, import.meta.url), 'utf8');

export const panelScript = () => read('panel.js');

export function renderHTML() {
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>agentdesk</title><style>' + read('panel.css') + '</style></head><body>' +
    read('panel.html') + '<script>' + panelScript() + '</script></body></html>';
}
