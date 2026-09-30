// 把宣传片打包成一个自包含的 HTML：样式、脚本、图标、音轨全部内嵌，双击就能看，也方便整个发给别人。
//
//   node promo/bundle.mjs              # → promo/out/agentdesk-promo-standalone.html
//   node promo/bundle.mjs --no-audio   # 不带音轨（小很多）
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const noAudio = process.argv.includes('--no-audio');
const read = (p) => readFileSync(join(here, p), 'utf8');

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.m4a': 'audio/mp4' };
const dataUri = (p) => `data:${MIME[extname(p)]};base64,${readFileSync(join(here, p)).toString('base64')}`;

// 场景脚本里用到的外部资源：相对路径 → data URI
const assets = ['logo.svg', 'assets/claude.png', 'assets/codex.png', 'assets/workbuddy.png'];
if (!noAudio) assets.push('out/promo-audio.m4a');
const missing = assets.filter((p) => !existsSync(join(here, p)));
if (missing.length) {
  console.error('缺文件：' + missing.join('、') + '\n图标先跑 promo/extract-icons.sh，音轨先跑 node promo/audio.mjs');
  process.exit(1);
}
const inlineAssets = (s) => assets.reduce((acc, p) => acc.split(p).join(dataUri(p)), s);

let html = read('index.html');
// <link rel="stylesheet" href="x.css"> → <style>
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>/* ${p} */\n${inlineAssets(read(p))}</style>`);
// <script src="x.js"></script> → 内联脚本（</script 要转义，否则会提前结束标签）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => {
  if (!existsSync(join(here, p))) return `<!-- 缺 ${p}，跳过 -->`;
  return `<script>/* ${p} */\n${inlineAssets(read(p)).replace(/<\/script/gi, '<\\/script')}</script>`;
});
if (noAudio) html = html.replace("new Audio('out/promo-audio.m4a')", 'new Audio()');

const out = join(here, 'out', noAudio ? 'agentdesk-promo-standalone-noaudio.html' : 'agentdesk-promo-standalone.html');
writeFileSync(out, html);
console.log(`已输出 ${out}（${(statSync(out).size / 1024 / 1024).toFixed(1)} MB）`);
