# agentdesk

一个面板看住所有 AI coding agent，告诉你**哪个在等你**。

[English](./README.md) · 中文

---

同时开着 Claude Code、Codex、WorkBuddy 之后，真正浪费时间的不是"忘了它跑完没"，
而是它**卡在那儿等你确认，你却以为它在干活**。窗口开着，光标在闪，二十分钟后
你才发现它三分钟前就问完了。

agentdesk 把所有 agent 的状态收到一处，只回答一个问题：现在有几个在等我。

> 让 AI 帮你装？项目里有 [AGENTS.md](./AGENTS.md)，把仓库丢给 Claude Code / Codex 让它读那个文件，
> 里面写了每一步的验证方法，以及哪三步必须由你本人操作。

## 装它之前

| 前提 | 说明 |
|---|---|
| **Node 18+** | 主程序。`node -v` 确认 |
| **Xcode 命令行工具** | 只有 macOS 悬浮窗需要，`xcode-select --install`。不装的话其他功能照常用，只是没有桌面小窗 |

**npm 包名还没注册，目前只能从源码装：**

```bash
git clone <仓库地址> agentdesk
cd agentdesk
npm link          # 把 agentdesk 命令挂到全局
agentdesk init    # 自动接入已安装的 agent
```

`init` 会扫描你装了哪些 agent 并写好钩子配置，原文件都留 `.agentdesk-backup`。
想先看会改什么：`agentdesk init --dry-run`。

不想全局安装的话，把下面所有 `agentdesk` 换成 `node bin/agentdesk.js` 也一样能用。

## 三种看法，挑一个

**① 桌面悬浮窗（macOS，推荐）**

```bash
agentdesk          # 先起服务
agentdesk panel    # 再开悬浮窗
```

一个常驻置顶的小窗，切到别的桌面或全屏应用也跟着走，点它不会抢走你正在打字的窗口的焦点。
拖任意位置可移动，位置和大小会记住，关掉窗口即退出。

**通知由它负责。** 第一次打开会看到右上角「开启通知」，点一下，系统弹授权框时选允许 ——
之后就不需要开着浏览器了。系统给新 app 的默认样式是「横幅」，几秒就自己消失，很容易错过 ——
建议到 系统设置 → 通知 → Agentdesk Panel，把样式改成「提醒」。
除此之外不需要任何系统权限。

首次运行会现编译（约 3 秒，产物约 115KB）。不用 Electron 是因为为了显示十几行文字装 100MB 运行时不值当。

**② 浏览器面板**

```bash
agentdesk          # 起服务并打开浏览器
```

信息更全（带路径、完整时间），适合摊开看。跨平台。在页面上点「开启通知」授权后，它也能弹通知；
和悬浮窗同时开着时只由悬浮窗弹，不会每条响两遍。一个能弹通知的页面都没有时，面板顶上会直接说原因。

**③ 终端**

```bash
agentdesk status   # 打印一屏就退出
```

## 命令

| 命令 | 作用 |
|---|---|
| `agentdesk` | 起服务 + 开浏览器面板（`--no-open` 只起服务） |
| `agentdesk panel` | 桌面悬浮窗（macOS，负责弹通知） |
| `agentdesk init` | 自动接入已装的 agent（`--dry-run` 预览） |
| `agentdesk status` | 终端里看一眼（和面板同一套判定，最后一行是已读信号和通知状态） |
| `agentdesk test` | 自检：验证通知能不能弹出来 |
| `agentdesk run "标题" -- <命令>` | 包装任意没有钩子的工具 |
| `agentdesk probe <名字>` | 探针：dump 某个 agent 传来的原始数据 |

装完先跑一次 `agentdesk test` —— 它先问服务端现在由谁负责弹通知（悬浮窗还是浏览器页面），
一个都没有就直接告诉你原因；有的话注入一条测试通知，弹不出来再按它打印的清单排查（系统通知设置、专注模式）。

## 开机自启

面板的价值在于「你不用记得开它」，每次重启都手动敲一遍命令，这个前提就不成立了。

```bash
agentdesk autostart          # 服务 + 悬浮窗都设为开机自启
agentdesk autostart --off    # 撤销
```

macOS 用 LaunchAgent，带 `KeepAlive` —— 服务被杀掉也会自动拉起（实测强杀后 5 秒内恢复）。
悬浮窗是 GUI，交给 launchd 管有会话作用域的坑，所以走「登录项」。
Windows 会在启动文件夹放一个 `.vbs`（用 vbs 是为了开机时不闪黑窗）。

日志在 `~/.agentdesk/server.log`。

## 不想用了

```bash
agentdesk uninit --dry-run   # 先看会改什么
agentdesk uninit             # 执行
agentdesk uninit --purge     # 连 ~/.agentdesk 的数据一起删
```

**它不是"还原备份文件"**，而是精确摘掉 agentdesk 加的那几条 —— 你在 init 之后如果又改过
这些配置，整体还原会把你自己的改动一起抹掉。具体做的事：从 hooks 里摘掉 command 含
agentdesk 的条目、把 `notify` 还原成接管前的值、移除开机自启、停掉在跑的进程。

`.agentdesk-backup` 备份文件会保留，确认没问题可以自己删。

## 完成了但你还没看

这是整个面板存在的理由。任务跑完却没人知道，和没跑完是一回事。

完成的任务默认是**未读**：卡片左侧一个圆点、底色带一抹状态色，计入标签页数字和顶部计数
（「3 个完成了还没看」）。

**已读以 agent 自己的记录为准**，都精确到具体会话，不需要任何授权：

- **Claude 桌面版** —— 它给每个会话记着你最后一次点开的时间。完成之后你在桌面版里点开过那个会话，就是看过了
- **完成那一刻它就在你屏幕上** —— Claude 在前台、正聚焦着这个会话、停留 3 秒以上，算看过，也不弹通知
- **WorkBuddy** —— 直接照搬它自己的未读标记（`sessions.unread`）
- **你在那个会话里重新说话** —— 你都回到现场了
- **点卡片 / 点通知** —— 通知对应的就是那一条

**不会**因为你打开了某个 agent 的窗口就把它的未读全清掉。只知道是哪个 app、不知道是哪个会话的时候（比如 Codex），
只有它只剩一条没看过的才算；多条分不清你看的是哪个，宁可让你多点一下。

`claude -p` 这类无人值守的自动任务，完成不算未读（没人会去 UI 里看它），失败照样提醒。
被你主动中断的任务不算未读 —— 它是自己停的，你知道。

**你正看着的那个会话，它的通知不打扰你**；并行的其他会话照常提醒（以前是按 app 静音，
你看着会话 A 时会话 B 完成也被一起静音）。不想要这个行为：配置里设 `"muteForegroundAgent": false`。

失败、失联的任务点一下卡片就算"知道了"，不再重提醒。重提醒的间隔是 90 秒、5 分钟、15 分钟，越来越稀；
你正看着的不提醒。

需要你处理的任务一律留在主列表里，只有处理过的旧任务（6 小时前）才收进"更早的"—— 头部的计数就是你能看到的条数。

未读最多挂 24 小时（`~/.agentdesk/config.json` 的 `"attentionRetention"`，毫秒）。
数据不会被删，只是不在面板上显示了。

`agentdesk status` 最后一行会显示这些已读信号能不能用。Claude 桌面版的会话记录是它的私有格式，
哪天升级改了格式，这里会显示读不到，已读退回"回话 / 点击才算"—— 不会悄悄坏掉。

## 状态

| 状态 | 含义 |
|---|---|
| ⏸ 等你 | 卡在提问或授权确认上 —— 这是最值钱的信号。副行直接写问题本身（「问你：用方案 A 还是 B？」）或要执行的命令 |
| ⚠ 失联 | 超时没有任何动静（transcript、会话流文件、子 agent 都不写了）。崩了、终端被误关、机器睡了都算 |
| ✕ 失败 | 非零退出，或者 API 报错（过载、断线、登录过期）结束了这一轮，副行写着报错 |
| ⏳ 后台跑着 | 前台回合结束了，但后台命令或后台子 agent 还在跑 —— 别急着关窗口 |
| ✓ 完成 | 正常结束，副行是它最后一句话（最后一句是问句会标一个「问」）。没看过的是未读 |
| ▶ 运行中 | 在跑，副行写着它此刻在干什么：在跑哪条命令、在改哪个文件、思考中 |
| ⏸ 停着 | 被你中断了（Claude 的中断标记、Codex 的 turn_aborted）。你自己停的，不算未读 |

**失联这条最重要。** 没有任何 agent 会主动告诉你"我死了"，只监听完成事件必然漏掉
所有非正常结束的情况。agentdesk 给每条任务记 `last_seen`，超时就降级成失联。

**「后台跑着」这条解决另一个盲区。** Claude Code 的 `Stop` 只代表主回合结束 —— 如果它
还挂着后台任务（`run_in_background` 起的命令、后台子 agent），面板说"完成"就是在骗你。
不管谁起的后台任务，Claude Code 都会在临时目录的 `tasks/` 下开一个 `.output`，跑完往末尾写
`[exited with code N]`；还没写的，再看文件是不是还被进程打开着（`lsof`，异步批量查，不会卡住服务）。
前台命令跑的时候也会开 `.output`，所以只有 transcript 里登记过的（`running in background with ID` /
`agentId`）才算后台 —— 前台命令只用来证明"它还活着"。

**「运行中」和「停着」不靠猜。** 以前是"transcript 90 秒没写就算停了"，实测 14 天里 77 次是 agent
正在生成长回复、跑长命令时被误判，同期真正的中断只有 33 次。现在只认确定性信号：transcript 末尾有没配对的
工具调用 = 在跑；你说完话模型还没回 = 思考中；有中断标记 = 停着。

## 已支持

| agent | 接入方式 | 能拿到「等你」 | 实时性 |
|---|---|---|---|
| Claude Code | 原生 hooks；已读看桌面版自己的会话记录 | ✅ | 秒级 |
| Codex（ChatGPT app） | 监听会话流 `~/.codex/sessions/**.jsonl`；会话流文件在写就不算失联 | ⚠️ 未遇到过审批事件 | 亚秒 |
| ~~Codex CLI `notify`~~ | 已停用 —— ChatGPT app 的内部子代理也会触发它，而 notify 的载荷里没有能区分"是不是你发起的"的字段 | — | — |
| Kimi Code | `notify` | ⚠️ **adapter 写了但从未验证过** —— 照 Codex 抄的，作者的账号当时用不了 | — |
| WorkBuddy | 监听它的 sqlite `sessions` 表；已读照搬它的 `unread` 列 | ⚠️ 同上 | 亚秒 |
| 任意命令 | `agentdesk run` 包装 | ❌ 只有跑完/失败 | 秒级 |

没有钩子的 GUI 应用也能接：**它总得把状态写在某个地方**。WorkBuddy 把会话存在
sqlite 里（带 `title` 和 `status`），Codex 把每轮对话追加进 jsonl。

这些源不靠定时轮询 —— `fs.watch` 盯住那几个目录，文件一变就处理，实测端到端 826ms，
和钩子的体感没有区别。定时器只作为监听失效时的兜底（某些 Linux 内核不支持递归监听）。

已经配了 `notify` 的（比如 Codex Computer Use），`init` 会自动做转发包装，
**不会覆盖掉你原有的配置**。

包装任意没有钩子的工具：

```bash
agentdesk run --as kimi "重构支付模块" -- kimi -p "..."
```

## 接入一个新的 agent

**核心前提：它总得把状态写在某个地方。** 有钩子最好，没钩子也一定有会话文件、
数据库或者日志 —— 找到那个地方就能接。这个项目支持的三个 agent 里，只有一个有原生钩子。

### 第一步：找它把状态写在哪

按这个顺序查，找到一个就停：

```bash
# 1. 有没有钩子/通知配置？（最理想，秒级且不用轮询）
ls ~/.<agent>/          # 找 settings.json / config.toml
grep -rn "hooks\|notify" ~/.<agent>/*.json ~/.<agent>/*.toml 2>/dev/null

# 2. 有没有会话文件？（次选，文件监听也能做到亚秒级）
find ~/.<agent> -name "*.jsonl" -o -name "*.json" | head
# 找到后看它每轮写什么：
tail -1 <会话文件> | python3 -m json.tool | head -30

# 3. 有没有数据库？（往往质量最好，状态字段是现成的）
find ~/.<agent> -name "*.db" -o -name "*.sqlite" | head
sqlite3 "file:<库路径>?mode=ro" ".tables"
sqlite3 "file:<库路径>?mode=ro" "PRAGMA table_info(sessions);"

# 4. 是 GUI 应用、上面全没有？看它的 app 包
find /Applications/<App>.app -name "*.json" -path "*hook*" 2>/dev/null
```

### 第二步：判断这个信号靠不靠谱

**这一步决定了 adapter 的质量，别跳过。**

| 好信号（确定性） | 坏信号（靠猜） |
|---|---|
| 状态字段：`status = 'completed'` | 文件多久没动了 |
| 明确的事件类型：`type: task_complete` | 进程还在不在 |
| 退出标记：`[exited with code 0]` | 输出里有没有某个关键词 |

拿不到确定性信号也能做，但要在 adapter 里标 `"confidence": "guess"`，
面板会给这类任务加「(推测)」并降低视觉权重 —— **别让使用者以为推测出来的状态和钩子一样准。**

还要留意一件事：**很多 agent 会为内部功能开子会话**（生成摘要、跑子代理），
那些不是用户发起的任务，混进面板就是噪音。找找有没有能区分的字段，
比如 Codex 的 `session_meta.thread_source`（`user` / `subagent`），
或者 WorkBuddy 的 `is_background_automation`。

### 第三步：写 adapter

一个 JSON 文件丢进 `~/.agentdesk/adapters/`，不写代码：

```json
{
  "name": "myagent",
  "source": "sqlite",
  "db": "~/.myagent/data.db",
  "query": "SELECT id, title, status FROM sessions WHERE updated_at > ? LIMIT 50",
  "map": { "key": "$.id", "title": "$.title" },
  "rules": [
    { "when": "$.status == running",   "kind": "start"   },
    { "when": "$.status == completed", "kind": "done"    },
    { "when": "$.status == error",     "kind": "failed"  },
    { "when": "$.status ~= wait",      "kind": "waiting" }
  ]
}
```

`source` 五选一：

| source | 什么时候用 | 本项目里的例子 |
|---|---|---|
| `stdin` | 有钩子，数据走标准输入 | Claude Code 的 hooks |
| `argv` | 有钩子，数据走命令行参数 | Codex CLI 的 `notify` |
| `watch-jsonl` | 会话是追加型 jsonl，监听新增行 | Codex 的会话流 |
| `sqlite` | 状态存在数据库里 | WorkBuddy 的 `sessions` 表 |
| `run` | 以上全没有，包住命令自己看 | `agentdesk run "标题" -- <命令>` |

`kind` 有这几种：

| kind | 含义 |
|---|---|
| `start` | 任务开始 / 有新一轮活动 |
| `waiting` | 卡在提问或授权上，**最值钱的信号** |
| `done` | 正常结束 |
| `failed` | 失败 |
| `closed` | 会话关闭（跑到一半关掉算完成） |
| `stopped` | 被你中断了。显示成「停着」，不算未读 |
| `heartbeat` | 还活着，只刷新时间不改状态 |
| `ignore` | 认识但不关心，不进面板也不留证 |

**规则按顺序匹配，第一条命中就停**，所以特殊情况写前面、兜底写后面。

几个可选字段：

- `session_filter` —— 整个会话级的过滤，用来挡掉内部子代理（判定读文件头，不受读取进度影响）
- `index` —— 从另一个文件补字段。Codex 的会话标题在 `session_index.jsonl` 里而不在会话流里
- `foreground` —— 声明这个 agent 对应哪个 app 窗口，用于「你正开着它时不打扰你」和「打开 ↗」
- `confidence` —— `exact`（默认）或 `guess`
- `read` —— 这个 agent 自己记不记已读，写成一个条件，比如 WorkBuddy 的 `"$.unread == 0"`。
  声明了就以它为准，状态变化和已读变化分两条通道发，不会因为已读一翻就把任务重新变回未读
- `heartbeat` —— `{ "field": "$.last_activity_at", "every": 60000 }`：没有 transcript 的 agent，
  长任务中途没有状态变化，靠这个字段的增长发心跳，免得被误判失联
- `map.alive` —— 一个文件路径（比如 Codex 的 `$._file`，就是会话流文件本身），它还在写就算活着
- `env` —— 钩子类 adapter 从环境变量取字段，比如 Claude 的 `{ "entrypoint": "CLAUDE_CODE_ENTRYPOINT" }`，
  用来分出桌面版会话和 `claude -p` 自动任务

### 第四步：验证

```bash
agentdesk serve --no-open        # 重启服务加载新 adapter
agentdesk status                 # 看有没有抓到
cat ~/.agentdesk/events.jsonl | tail -5
```

**adapter 认不出来的数据会自动留证**到 `~/.agentdesk/probe-<agent>.log`，
照着补规则就行 —— 不用事先知道全部格式。日志里的凭证类环境变量会脱敏，可以直接贴 issue。

有钩子的 agent 还可以主动探：把 `agentdesk probe <名字>` 配到它的钩子位置跑一次，
收到的 `argv` / `stdin` / 环境变量会原样 dump 下来。

### 让 AI 替你做这件事

上面这套流程是可以交给 AI 的。把仓库丢给 Claude Code / Codex，然后：

> 读这个项目的 AGENTS.md 和 adapters/ 下的现有例子，帮我给 <agent 名字> 写一个 adapter。
> 先按 README「接入一个新的 agent」第一步的命令查清楚它把状态写在哪，
> 把你找到的信号源和判断依据告诉我，我确认之后你再写 JSON。
> 不要凭猜测写规则，找不到确定性信号就直接说找不到。

最后那句很重要 —— **不确定的时候硬写规则，会做出一个"看起来在工作但状态是错的"面板**，
那比没有面板更糟。

**欢迎 PR 新的 adapter —— 只是一个 JSON 文件，不用改代码。**

## 推到手机

`~/.agentdesk/config.json`：

```json
{
  "timeouts": { "default": 900000, "codex": 1800000 },
  "webhooks": [{
    "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    "on": ["waiting", "stale", "failed"],
    "body": { "msg_type": "text", "content": { "text": "{{agent}} {{state}}: {{title}}" } }
  }]
}
```

飞书、钉钉、Telegram、ntfy、Server酱都是一个 POST，改 `url` 和 `body` 就行。

只在真有新情况时推：点已读、标题晚生成、服务重启都不会重推；任务就在你屏幕上的也不推。

## 工作原理

```
agent 钩子 ──> agentdesk hook ──> events.jsonl ──> 投影成状态 ──> SSE ──> 面板/通知
                                       ↑
                                  超时扫描（补上没有信号的情况）
```

事件只追加不修改，状态是每次从事件流投影出来的，不落盘。出问题删掉
`~/.agentdesk/events.jsonl` 重来就行。日志是人能直接读的 JSONL。

**零运行时依赖。** 只用 Node 内置模块，`dependencies` 是空的。

Windows 和 macOS 一套代码。通知在 macOS 上由悬浮窗发原生通知，其他平台走浏览器的 Notification API ——
两种都是系统原生通知，且不需要引入任何依赖。

测试：`npm test`（Node 内置的 `node --test`，同样零依赖）。

## License

MIT
