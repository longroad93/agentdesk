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

首次运行会现编译（约 3 秒，产物 81KB）。**不需要任何系统权限** —— 它只是个 WebView 壳。
不用 Electron 是因为为了显示十几行文字装 100MB 运行时不值当。

**② 浏览器面板**

```bash
agentdesk          # 起服务并打开浏览器
```

信息更全（带路径、完整时间），适合摊开看。跨平台。

**③ 终端**

```bash
agentdesk status   # 打印一屏就退出
```

## 命令

| 命令 | 作用 |
|---|---|
| `agentdesk` | 起服务 + 开浏览器面板（`--no-open` 只起服务） |
| `agentdesk panel` | 桌面悬浮窗（macOS） |
| `agentdesk init` | 自动接入已装的 agent（`--dry-run` 预览） |
| `agentdesk status` | 终端里看一眼 |
| `agentdesk test` | 自检：验证通知能不能弹出来 |
| `agentdesk run "标题" -- <命令>` | 包装任意没有钩子的工具 |
| `agentdesk probe <名字>` | 探针：dump 某个 agent 传来的原始数据 |

装完先跑一次 `agentdesk test` —— 它会注入一条测试通知，弹不出来就按它打印的清单排查
（浏览器权限、macOS 通知设置、专注模式）。

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
（「3 个完成了还没看」）。点一下卡片就算看过，或者用右上角「全部已读」。

已读有两条路径，都精确到具体任务：

- **你在那个会话里重新说话** —— 你都回到现场了，自动算已读
- **点击通知** —— 通知对应的就是那一条任务，点了就是看到了

**不会**因为你打开了某个 agent 的窗口就把它的未读全清掉。前台检测只能拿到 app 名
（窗口标题要 macOS 辅助功能授权），分不清你开着的 3 个 claude 会话看的是哪一个。
把 3 个都标成已读，正是这个工具本该防住的事故。

前台检测改用在另一件事上：**你正开着某个 agent 的窗口时，它的通知不打扰你，
但未读标记原样保留**。人走开了，提醒继续。要关掉它，配置里设
`"muteForegroundAgent": false`。

被你主动中断的任务不算未读 —— 它是自己停的，你知道。

**但未读也有期限：24 小时。** 过了这个时间还没顾上的，要么不重要，要么你早在 agent 窗口里
看过了、只是没回来点面板 —— 已读只能靠上面两条路径触发，这种情况很常见。继续挂着只会越积越多，
把真正新的淹掉。失败、失联的任务同理。还在跑的不受这个限制。

想留得更久，在 `~/.agentdesk/config.json` 里设 `"attentionRetention"`（毫秒）。
数据不会被删，只是不在面板上显示了。

## 状态

| 状态 | 含义 |
|---|---|
| ⏸ 等你 | 卡在提问或授权确认上 —— 这是最值钱的信号 |
| ⚠ 失联 | 超时没有任何动静。崩了、终端被误关、机器睡了都算 |
| ✕ 失败 | 非零退出 |
| ⏳ 后台跑着 | 前台回合结束了，但后台命令还在跑 —— 别急着关窗口 |
| ✓ 完成 | 正常结束。没看过的标记为未读，看过才沉底；未读最多挂 24 小时 |
| ▶ 运行中 | 在跑，不用管 |
| ⏸ 停着 | 会话没在动，但也没正式结束（transcript 停笔判定，恢复活动会自动变回运行中）|

**失联这条最重要。** 没有任何 agent 会主动告诉你"我死了"，只监听完成事件必然漏掉
所有非正常结束的情况。agentdesk 给每条任务记 `last_seen`，超时就降级成失联。

**「后台跑着」这条解决另一个盲区。** Claude Code 的 `Stop` 只代表主回合结束 —— 如果它
还挂着后台任务（`run_in_background` 起的命令），面板说"完成"就是在骗你。agentdesk 从
`PostToolUse` 捕获后台任务启动，再去读 output 文件末尾的 `[exited with code N]` 判断结束。
这是确定性信号，不是靠静默时间猜的，连退出码都能拿到 —— 后台任务失败会直接把任务标成失败。

## 已支持

| agent | 接入方式 | 能拿到「等你」 | 实时性 |
|---|---|---|---|
| Claude Code | 原生 hooks | ✅ | 秒级 |
| Codex（ChatGPT app） | 监听会话流 `~/.codex/sessions/**.jsonl` | ⚠️ 未遇到过审批事件 | 亚秒 |
| ~~Codex CLI `notify`~~ | 已停用 —— ChatGPT app 的内部子代理也会触发它，而 notify 的载荷里没有能区分"是不是你发起的"的字段 | — | — |
| Kimi Code | `notify` | ⚠️ **adapter 写了但从未验证过** —— 照 Codex 抄的，作者的账号当时用不了 | — |
| WorkBuddy | 监听它的 sqlite `sessions` 表 | ⚠️ 同上 | 亚秒 |
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
| `heartbeat` | 还活着，只刷新时间不改状态 |
| `ignore` | 认识但不关心，不进面板也不留证 |

**规则按顺序匹配，第一条命中就停**，所以特殊情况写前面、兜底写后面。

几个可选字段：

- `session_filter` —— 整个会话级的过滤，用来挡掉内部子代理（判定读文件头，不受读取进度影响）
- `index` —— 从另一个文件补字段。Codex 的会话标题在 `session_index.jsonl` 里而不在会话流里
- `foreground` —— 声明这个 agent 对应哪个 app 窗口，用于「你正开着它时不打扰你」
- `confidence` —— `exact`（默认）或 `guess`

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

## 工作原理

```
agent 钩子 ──> agentdesk hook ──> events.jsonl ──> 投影成状态 ──> SSE ──> 面板/通知
                                       ↑
                                  超时扫描（补上没有信号的情况）
```

事件只追加不修改，状态是每次从事件流投影出来的，不落盘。出问题删掉
`~/.agentdesk/events.jsonl` 重来就行。日志是人能直接读的 JSONL。

**零运行时依赖。** 只用 Node 内置模块，`dependencies` 是空的。

Windows 和 macOS 一套代码 —— 这也是为什么通知走浏览器的 Notification API
而不是系统托盘：两个平台上它都是原生系统通知，且不需要引入任何依赖。

## License

MIT
