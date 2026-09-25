// 什么时候该出声。"要不要重画"和"要不要提醒"是两件事，以前混用一个 changed 列表：
//   · 点一下已读、标题晚生成、后台数变化，都被当成"又有新情况"，重新弹一次「完成」、再推一次 webhook
//   · 启动时记的签名比比较时少两个字段，每次重启都把所有任务判成"变了"，webhook 集体重发
// 现在只看一件事：这个任务"为什么要你注意"变成了一个新的值。启动时和比较时用的是同一个函数。
import { STATES } from './states.js';

export const alertKey = t => (t.needs ? t.state : null);

export const alertsOf = tasks => new Map(tasks.map(t => [t.id, alertKey(t)]));

export function newAlerts(prev, tasks) {
  return tasks.filter(t => {
    const k = alertKey(t);
    return k && prev.get(t.id) !== k;
  });
}

// webhook 的 body 模板：在对象的每个字符串值上替换 {{字段}}。
// 以前是在序列化后的 JSON 字符串上做替换，靠删掉引号和反斜杠避免把 JSON 弄坏。
export function renderTemplate(v, task) {
  if (typeof v === 'string') {
    return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(task[k] ?? STATES[task.state]?.label ?? ''));
  }
  if (Array.isArray(v)) return v.map(x => renderTemplate(x, task));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renderTemplate(x, task)]));
  return v;
}

// 并发发出去，每个最多等 5 秒：一个挂住的地址不该拖住后面的
export function fireWebhooks(hooks, tasks, fetchImpl = globalThis.fetch) {
  const jobs = [];
  for (const hook of hooks || []) {
    for (const task of tasks) {
      if (hook.on && !hook.on.includes(task.state)) continue;
      jobs.push(fetchImpl(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderTemplate(hook.body || { text: '{{agent}} {{title}}' }, task)),
        signal: AbortSignal.timeout(5000),
      }).then(r => {
        if (r && r.ok === false) throw new Error(`HTTP ${r.status}`);
      }).catch(err => {
        process.stderr.write(`[agentdesk] webhook 失败 (${hook.url}): ${err.message}\n`);
      }));
    }
  }
  return Promise.all(jobs);
}
