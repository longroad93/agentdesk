// 宣传片的声音：旁白（macOS say）+ 音效和背景音乐（这里现合成，不用任何素材，没有版权问题）。
// 时间点全部来自 timeline.js，和画面共用一份。
//
//   node promo/audio.mjs                    # → promo/out/promo-audio.m4a、out/voice-durations.js
//   node promo/audio.mjs --voice Tingting   # 换一个中文声音（say -v '?' | grep zh_CN 看有哪些）
//   node promo/audio.mjs --rate 200         # 语速（字/分钟）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
// timeline.js 是给浏览器的普通脚本（仓库是 "type": "module"，不能 require），在沙箱里跑一遍拿结果
const T = vm.runInNewContext(readFileSync(join(here, 'timeline.js'), 'utf8') + '\n;TIMELINE');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const VOICE = arg('voice', 'Tingting');
const RATE = arg('rate', '200');
const SR = 48000;
const out = join(here, 'out');
const work = join(out, 'audio-work');
mkdirSync(work, { recursive: true });

// ---------- 旁白 ----------
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const durations = {};
for (const v of T.voice) {
  const aiff = join(work, `${v.id}.aiff`), wav = join(work, `${v.id}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', aiff, v.say || v.text]);
  // 去掉 say 首尾自带的静音，旁白才能卡准时间点；统一成 48k 单声道
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-ar', String(SR), '-ac', '1', wav]);
  durations[v.id] = Number(probe(wav).toFixed(2));
}
writeFileSync(join(out, 'voice-durations.js'),
  `// audio.mjs 生成，别手改。每句旁白的实际时长（秒），字幕按它收尾\nvar VOICE_DUR = ${JSON.stringify(durations, null, 2)};\n`);
// 撞车检查：一句还没说完下一句就开始了
T.voice.forEach((v, i) => {
  const next = T.voice[i + 1];
  if (next && v.at + durations[v.id] > next.at - 0.15) {
    console.warn(`⚠ 旁白 ${v.id} 说到 ${(v.at + durations[v.id]).toFixed(2)}s，下一句 ${next.id} 在 ${next.at}s 开始`);
  }
});

// ---------- 合成音效 ----------
const N = Math.ceil(T.END * SR);
const fx = new Float32Array(N);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function tone(at, { f = 440, f2 = f, dur = 0.15, gain = 0.2, attack = 0.005, type = 'sine', decay = 'exp' }) {
  const s0 = Math.round(at * SR), n = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < N; i++) {
    const x = i / n;
    const fr = f + (f2 - f) * x;
    ph += (2 * Math.PI * fr) / SR;
    let w = type === 'sine' ? Math.sin(ph) : type === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sign(Math.sin(ph)) * 0.5;
    const a = i < attack * SR ? i / (attack * SR) : 1;
    const e = decay === 'exp' ? Math.exp(-5 * x) : 1 - x;
    if (s0 + i >= 0) fx[s0 + i] += w * a * e * gain;
  }
}
function noise(at, { dur = 0.3, gain = 0.1, lp = 0.2, rise = 0.5 }) {
  const s0 = Math.round(at * SR), n = Math.round(dur * SR);
  let y = 0;
  for (let i = 0; i < n && s0 + i < N; i++) {
    const x = i / n;
    // 截止频率跟着包络扫，听起来像"嗖"
    const env = x < rise ? x / rise : (1 - x) / (1 - rise);
    const k = lp * (0.3 + 0.7 * env);
    y += k * (rnd() - y);
    fx[s0 + i] += y * env * gain;
  }
}

const SFX = {
  tick: (e) => tone(e.at, { f: e.k % 2 ? 2100 : 2500, dur: 0.028, gain: 0.07 * (e.gain ?? 1), attack: 0.001 }),
  pop: (e) => { tone(e.at, { f: 520, f2: 880, dur: 0.09, gain: 0.22 * (e.gain ?? 1) }); tone(e.at + 0.05, { f: 1320, dur: 0.12, gain: 0.08 * (e.gain ?? 1) }); },
  hit: (e) => { tone(e.at, { f: 110, f2: 55, dur: 0.9, gain: 0.5, decay: 'exp' }); noise(e.at, { dur: 0.35, gain: 0.25, lp: 0.08, rise: 0.02 }); tone(e.at, { f: 220, dur: 1.2, gain: 0.12, type: 'tri' }); },
  whoosh: (e) => noise(e.at - 0.25, { dur: 0.55, gain: 0.5 * (e.gain ?? 1), lp: 0.12, rise: 0.6 }),
  chime: (e) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(e.at + i * 0.07, { f, dur: 1.4, gain: 0.1, attack: 0.004 })),
  // 和面板 src/ui/panel.js 的 beep() 同一套：正弦、每个音 0.16 秒间隔、0.14 秒衰减
  beep: (e) => e.freqs.forEach((f, i) => tone(e.at + i * 0.16, { f, dur: 0.15, gain: 0.26, attack: 0.012 })),
  click: (e) => { noise(e.at, { dur: 0.018, gain: 0.35, lp: 0.9, rise: 0.05 }); tone(e.at, { f: 1800, dur: 0.02, gain: 0.08 }); },
  blip: (e) => tone(e.at, { f: 988, f2: 1318, dur: 0.1, gain: 0.12 * (e.gain ?? 1) }),
  thud: (e) => { tone(e.at, { f: 90, f2: 40, dur: 0.5, gain: 0.45 }); noise(e.at, { dur: 0.25, gain: 0.3, lp: 0.05, rise: 0.02 }); },
  key: (e) => noise(e.at, { dur: 0.022, gain: 0.16 + (e.k % 3) * 0.03, lp: 0.6, rise: 0.08 }),
  enter: (e) => { noise(e.at, { dur: 0.035, gain: 0.3, lp: 0.5, rise: 0.05 }); tone(e.at, { f: 260, dur: 0.05, gain: 0.08 }); },
  ding: (e) => { tone(e.at, { f: 1318.5, dur: 0.6, gain: 0.12 }); tone(e.at + 0.09, { f: 1760, dur: 0.8, gain: 0.09 }); },
};
for (const e of T.sfx) SFX[e.kind](e);

// ---------- 背景音乐：慢速的 Am–F–C–G 铺底 ----------
// 开场那 8 秒是悬疑的，只有低频嗡声；产品出场后才进和弦
const music = new Float32Array(N);
const BPM = 96, beat = 60 / BPM, bar = beat * 4;
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am F C G（MIDI）
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const musicStart = T.S.s2;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let v = 0;
  if (t < musicStart) {
    // 开场：低频嗡声，越来越紧
    const k = t / musicStart;
    v = 0.05 * (0.5 + k) * (Math.sin(2 * Math.PI * 55 * t) + 0.5 * Math.sin(2 * Math.PI * 55.6 * t));
  } else {
    const mt = t - musicStart;
    const ci = Math.floor(mt / bar) % 4, inBar = (mt % bar) / bar;
    const pad = CH[ci].reduce((a, m) => a + Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(2 * Math.PI * hz(m + 12) * t), 0);
    // 和弦之间交叉淡化，避免换和弦的"咔"一声
    const xf = Math.min(1, inBar * 12, (1 - inBar) * 12);
    // 八分音符的琶音
    const step = Math.floor((mt % bar) / (beat / 2)), sp = ((mt % (beat / 2)) / (beat / 2));
    const arpM = CH[ci][step % 3] + 12 + (step >= 3 && step < 6 ? 12 : 0);
    const arp = Math.sin(2 * Math.PI * hz(arpM) * t) * Math.exp(-6 * sp);
    const bass = Math.sin(2 * Math.PI * hz(CH[ci][0] - 12) * t) * (0.6 + 0.4 * Math.exp(-3 * ((mt % beat) / beat)));
    const inK = Math.min(1, mt / 1.5);
    v = inK * (0.022 * pad * xf + 0.03 * arp + 0.05 * bass * xf);
  }
  // 最后 2 秒收尾
  v *= Math.min(1, (T.END - t) / 2);
  music[i] = v;
}

function writeWav(file, data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(file, buf);
}
writeWav(join(work, 'sfx.wav'), fx);
writeWav(join(work, 'music.wav'), music);

// ---------- 混音 ----------
// 旁白各自延迟到时间点；音乐在有旁白的地方自动压低（sidechaincompress）
const inputs = ['-i', join(work, 'music.wav'), '-i', join(work, 'sfx.wav')];
const vf = [];
T.voice.forEach((v, i) => {
  inputs.push('-i', join(work, `${v.id}.wav`));
  const ms = Math.round(v.at * 1000);
  vf.push(`[${i + 2}:a]adelay=${ms}|${ms},apad[v${i}]`);
});
const vlabels = T.voice.map((_, i) => `[v${i}]`).join('');
const graph = [
  ...vf,
  `${vlabels}amix=inputs=${T.voice.length}:normalize=0,atrim=0:${T.END},volume=1.35,asplit=2[voice][key]`,
  `[0:a]atrim=0:${T.END}[mus]`,
  `[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[musduck]`,
  `[1:a]atrim=0:${T.END}[fx]`,
  `[musduck][fx][voice]amix=inputs=3:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11[out]`,
];
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph.join(';'),
  '-map', '[out]', '-ar', String(SR), '-ac', '2', '-c:a', 'aac', '-b:a', '192k', join(out, 'promo-audio.m4a')]);
console.log(`已输出 ${join(out, 'promo-audio.m4a')}（${T.END}s，旁白 ${T.voice.length} 句，音效 ${T.sfx.length} 个）`);
