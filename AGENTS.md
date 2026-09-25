# 给 AI 助手：如何帮用户装 agentdesk

你正在帮用户安装 agentdesk —— 一个把多个 AI coding agent 的任务状态收到一处的本地面板。

**先读这两条，它们决定你会不会把事情办砸：**

1. **有三步必须交还给用户本人**（通知授权、Xcode 工具安装、macOS 通知样式）。
   这几步会弹系统对话框，你点不了，也不该绕过。走到那里就停下来，把要点的位置说清楚，等他回话。
2. **每一步都要验证再往下走**。这个工具的失败模式是「装完了但没反应」，
   而不是报错 —— 不验证的话你和用户都会以为装好了。

---

## 环境要求

```bash
node -v                    # 需要 >= 18
sw_vers -productVersion    # macOS 版本，仅供参考
which swiftc               # 有 = 能装悬浮窗；没有 = 第 4 步改用浏览器面板，其他不受影响
```

`swiftc` 不存在时**不要**擅自跑 `xcode-select --install` —— 那会弹窗要密码。
先问用户要不要装悬浮窗，他说要再让他自己执行。

## 1. 安装

用户拿到的可能是 tarball 或者 git 仓库：

```bash
# tarball
npm i -g ./agentdesk-0.1.0.tgz

# 或者源码
cd agentdesk && npm link
```

验证：

```bash
agentdesk help     # 应该打印命令列表
```

`agentdesk: command not found` 说明全局 bin 目录不在 PATH 里。
不要去改用户的 shell 配置，直接改用 `node <项目>/bin/agentdesk.js` 的形式跑完后面所有步骤。

## 2. 接入已安装的 agent

**先预览，再执行**：

```bash
agentdesk init --dry-run   # 看会改哪些文件
agentdesk init             # 确认没问题再执行
```

它会改 `~/.claude/settings.json`、`~/.codex/config.toml` 这类文件，原文件都留 `.agentdesk-backup`。

输出里每个 agent 会有一行：

- `✓ 已接入 N 个 hook` —— 成功
- `✓ 已经配过了，跳过` —— 之前装过，正常，不用管
- `– 未检测到` —— 这台机器没装这个 agent，正常
- `✕` —— 失败，把原始报错给用户看，别自己猜

## 3. 起服务

```bash
agentdesk                       # 起服务并打开浏览器
agentdesk serve --no-open       # 只起服务
```

验证：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4517/    # 期望 200
```

## 4. 【停下来交给用户】开启通知

**macOS：通知由悬浮窗负责。** WKWebView 里的网页通知拿不到权限，浏览器标签又不会随开机自启打开，
所以悬浮窗自己发原生通知：

```bash
agentdesk panel
```

首次运行会用系统自带的 `swiftc` 现编译（约 3 秒，产物约 115KB）。
编译失败且报错提到 Xcode 时，**不要自己跑 `xcode-select --install`**，让用户执行。

**授权这步你做不了。** 告诉用户：

> 悬浮窗右上角点「开启通知」，系统会弹授权框（也可能是通知中心里的一条询问），选允许。

**其他平台，或者不想用悬浮窗：** 告诉用户打开 http://localhost:4517，点右上角「开启通知」，
浏览器弹授权框时点允许。

然后跑自检：

```bash
agentdesk test
```

它先问服务端现在由谁负责弹通知。**一个都没有会直接说原因**（没开面板、没授权、被拒绝、悬浮窗是旧版本），
照它说的处理，别自己猜。有的话它注入一条测试通知，6 秒后变成「完成」，**两条通知都该弹出来**。

没弹的话按顺序查：

1. 系统设置 → 通知 → Agentdesk Panel（或对应的浏览器）→ 是否允许
2. 系统「专注模式」是否开着
3. 用的是浏览器面板的话，点「试一条」—— 不经过服务端，能弹说明问题在事件推送，不能弹说明是浏览器/系统层

## 5. 【建议交给用户】确认通知样式是「提醒」

macOS 给新 app 的默认样式是「横幅」，几秒就自动消失，很容易错过（悬浮窗的 Info.plist 里请求了「提醒」，
但实测 macOS 26 不理会）。告诉用户：

> 系统设置 → 通知 → Agentdesk Panel（用浏览器面板的话是你的浏览器）→ 提醒样式选「提醒」

不改也能用（有重提醒兜底），但体验差不少。

## 6. 开机自启

```bash
agentdesk autostart
```

验证：

```bash
launchctl list | grep agentdesk        # 应该看到 com.agentdesk.server
```

## 装完的最终验证

让用户在任意一个已接入的 agent 里干点活（比如给 Claude Code 发一句话），然后：

```bash
cat ~/.agentdesk/events.jsonl | tail -3
```

**有事件写进来才算真的通了。** 空的话说明钩子没生效 —— 大概率是那个 agent 需要重启才会加载新配置，
让用户重启一次那个客户端。

---

## 常见情况

**面板是空的**
不一定是坏的。轮询只回溯最近 6 小时，如果这段时间没有 agent 活动，空是正常的。
让用户干点活再看。

**codex/workbuddy 没有任何任务**
同上。另外这两个是靠读它们自己的数据文件/数据库，只有用户实际用过才有数据。

**看过了还显示未读 / 已读不准**
跑 `agentdesk status`，最后一行是已读信号：Claude 桌面版的会话记录读不到时，已读会退回"回话 / 点击才算"。
终端里的 Claude CLI、Codex 没有 app 侧的记录，只能靠回话、点击，或者 app 在前台且它只剩一条未读。

**通知没弹**
`agentdesk test` 会直接说现在由谁负责弹通知、为什么没有。不要自己猜。

**从旧版本升级**
旧版的前台探测小程序 AgentdeskHelper 已经不用了（它需要的授权一直没拿到，功能从没生效过）：
`pkill -f AgentdeskHelper`。悬浮窗要重新编译才有通知：重新运行 `agentdesk panel`（会自动重编译并重启它）。

**面板出现了用户没创建过的任务**
adapter 的过滤规则可能没覆盖到某种内部调用。看 `~/.agentdesk/probe-*.log`，
里面是没被规则匹配上的原始数据，照着补一条 rule 到对应的 adapter JSON 里。

**想撤销**

```bash
agentdesk uninit --dry-run    # 先看会改什么
agentdesk uninit              # 执行
agentdesk uninit --purge      # 连 ~/.agentdesk 数据一起删
```

它是精确摘掉 agentdesk 加的条目，不是整体还原备份 —— 用户在 init 之后自己改的配置不会被抹掉。

---

## 如果用户是让你「接入一个新 agent」

这是另一类任务，不是装机。照下面走。

### 铁律：找不到确定性信号就说找不到

**猜出来的规则会做出一个「看起来在工作但状态是错的」面板 —— 那比没有面板更糟。**
用户会信任它，然后错过真正在等他的任务。宁可告诉他这个 agent 接不了。

### 第一步：查它把状态写在哪，把结论报给用户再动手

```bash
# 1. 钩子/通知配置（最理想）
ls ~/.<agent>/
grep -rn "hooks\|notify" ~/.<agent>/*.json ~/.<agent>/*.toml 2>/dev/null

# 2. 会话文件
find ~/.<agent> -name "*.jsonl" -o -name "*.json" | head
tail -1 <会话文件> | python3 -m json.tool | head -40

# 3. 数据库（往往质量最好）
find ~/.<agent> -name "*.db" -o -name "*.sqlite" | head
sqlite3 "file:<库>?mode=ro" ".tables"
sqlite3 "file:<库>?mode=ro" "PRAGMA table_info(<表>);"

# 4. GUI 应用，上面都没有
find /Applications/<App>.app -name "*.json" -path "*hook*" 2>/dev/null
```

**先把找到的信号源和判断依据告诉用户，等他确认再写 JSON。** 不要查完直接写。

### 第二步：判断信号质量

好信号是状态字段（`status = 'completed'`）、事件类型（`type: task_complete`）、
退出标记（`[exited with code 0]`）。

坏信号是「文件多久没动」「进程还在不在」这类推断。用了就必须标
`"confidence": "guess"`，面板会相应降级显示。

### 第三步：找出内部子会话怎么区分

**这一步最容易漏，漏了面板就会被噪音淹掉。** 很多 agent 会为内部功能开子会话
（生成摘要、跑子代理），那不是用户发起的任务。

本项目踩过的坑：Codex 的内部子代理会不断产生任务，靠 `session_meta.thread_source`
（`user` / `subagent`）才区分开；WorkBuddy 的定时任务靠 `is_background_automation`。

查的时候对比几个会话的头部字段，找出「用户发起」和「内部调用」的差异。

### 第四步：写 adapter 并验证

参考 `adapters/` 下的现有文件，四个 source 各有一例。写完：

```bash
agentdesk serve --no-open       # 重启加载
agentdesk status                # 看抓到没有
tail -5 ~/.agentdesk/events.jsonl
cat ~/.agentdesk/probe-<agent>.log   # 没匹配上的原始数据在这里
```

**验证要看两头**：该抓的抓到了，不该抓的没混进来。只验证前者是这个项目反复踩过的坑 ——
加过滤条件时只确认「噪音没了」，结果把正常任务也一起滤掉，而且不报错。

### 状态语义（写规则时对照）

| kind | 什么时候用 |
|---|---|
| `start` | 任务开始或有新一轮活动 |
| `waiting` | 卡在提问/授权上等用户 —— 最值钱，优先找这个信号 |
| `done` | 正常结束 |
| `failed` | 失败 |
| `closed` | 会话关闭 |
| `stopped` | 被用户中断（显示成「停着」，不算未读）。别漏了这个：不映射的话任务会一直"在跑"，15 分钟后被误报失联 |
| `heartbeat` | 还活着，只刷新时间不改状态 |
| `ignore` | 认识但不关心，不进面板也不留证 |

规则按顺序匹配，第一条命中就停。特殊情况写前面，兜底写后面。

另外两件事决定面板准不准，写规则时一起查：

- **这个 agent 自己记不记已读？** 有的话用 `read` 字段声明（WorkBuddy 是 `"$.unread == 0"`），已读就以它为准。
- **没有 transcript 的话，长任务中途靠什么证明还活着？** 会话文件就用 `map.alive` 指向它；数据库就用
  `heartbeat` 指向一个活动时间字段。都没有的话，长任务会被误报失联 —— 把这一点告诉用户。

---

## 不要做的事

- **不要替用户点任何系统权限对话框**，也不要用 osascript 之类的方式绕过
- **不要跳过验证步骤**。这个工具装错了不报错，只是没反应
- **不要改用户的 shell 配置文件**（`.zshrc` 等）来解决 PATH 问题，换用完整路径调用即可
- **不要在 `init` 报错时自己猜原因**，把原始输出给用户看
- 用户的 `~/.claude/settings.json` 里可能有他自己配的 hooks，`init` 是追加不是覆盖，
  **不要手工编辑这个文件**
