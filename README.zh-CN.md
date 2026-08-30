# agentdesk

一个面板看住所有 AI coding agent，告诉你**哪个在等你**。

[English](./README.md) · 中文

---

同时开着 Claude Code、Codex、Kimi 之后，真正浪费时间的不是"忘了它跑完没"，
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

## 五个状态

| 状态 | 含义 |
|---|---|
| ⏸ 等你 | 卡在提问或授权确认上 —— 这是最值钱的信号 |
| ⚠ 失联 | 超时没有任何动静。崩了、终端被误关、机器睡了都算 |
| ✕ 失败 | 非零退出 |
| ⏳ 后台跑着 | 前台回合结束了，但后台命令还在跑 —— 别急着关窗口 |
| ✓ 完成 | 正常结束。**没看过的会一直标记为未读**，看过才沉底 |
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
| Kimi Code | `notify` | ✅ | 秒级 |
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

## 加一个新 agent

不用读文档，也不用逆向二进制 —— 让它自己把数据交出来。

第一步，把探针配到目标 agent 的任意钩子位置，跑一次：

```bash
agentdesk probe myagent
```

它会把收到的 `argv`、`stdin`、相关环境变量原样 dump 到 `~/.agentdesk/probe-myagent.log`。

第二步，照着 dump 写一个 JSON 丢进 `~/.agentdesk/adapters/`：

```json
{
  "name": "myagent",
  "source": "argv",
  "parse": "json:$LAST",
  "map": {
    "key": "$.turn-id",
    "title": "$.input-messages[0]",
    "summary": "$.last-assistant-message"
  },
  "rules": [
    { "when": "$.type == agent-turn-complete", "kind": "done" },
    { "when": "$.type ~= approval", "kind": "waiting" }
  ]
}
```

`source` 决定数据从哪来：

| source | 用于 | 例子 |
|---|---|---|
| `stdin` | 钩子走标准输入 | Claude Code |
| `argv` | 钩子走命令行参数 | Codex CLI 的 `notify` |
| `watch-jsonl` | 轮询追加型 jsonl，只读新增部分 | Codex 的会话流 |
| `sqlite` | 轮询数据库表 | WorkBuddy 的 `sessions` |
| `run` | 什么钩子都没有，包命令 | 任意 CLI |

轮询型还能声明 `index`，从另一个文件补齐字段 —— Codex 的会话标题在
`session_index.jsonl` 里而不在会话流里，就是这么接上的。

不写一行代码。**欢迎 PR 新的 adapter —— 只是一个 JSON 文件。**

探针还有个被动模式：**adapter 认不出来的数据会自动留证**。任何 hook 或 notify 调用没匹配到
规则时，原始数据会写进 `~/.agentdesk/probe-<agent>.log`，你照着补一条 rule 就行 ——
不用事先知道格式，也不用专门跑测试。日志里的凭证类环境变量会被脱敏，可以直接贴到 issue。


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
