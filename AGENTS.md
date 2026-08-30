# 给 AI 助手：如何帮用户装 agentdesk

你正在帮用户安装 agentdesk —— 一个把多个 AI coding agent 的任务状态收到一处的本地面板。

**先读这两条，它们决定你会不会把事情办砸：**

1. **有三步必须交还给用户本人**（浏览器通知授权、Xcode 工具安装、macOS 通知样式）。
   这几步会弹系统对话框，你点不了，也不该绕过。走到那里就停下来，把要点的位置说清楚，等他回话。
2. **每一步都要验证再往下走**。这个工具的失败模式是「装完了但没反应」，
   而不是报错 —— 不验证的话你和用户都会以为装好了。

---

## 环境要求

```bash
node -v                    # 需要 >= 18
sw_vers -productVersion    # macOS 版本，仅供参考
which swiftc               # 有 = 能装悬浮窗；没有 = 跳过第 6 步，其他不受影响
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

## 4. 【停下来交给用户】开启浏览器通知

**这步你做不了。** 告诉用户：

> 打开 http://localhost:4517，点右上角「开启通知」，浏览器会弹授权框，点允许。
> 按钮变成蓝色的「通知已开启」就好了。

然后让他跑自检：

```bash
agentdesk test
```

这会注入一条测试通知，6 秒后变成「完成」，**两条通知都该弹出来**。

没弹的话按顺序查（`agentdesk test` 自己也会打印这个清单）：

1. 面板右上角按钮是不是已经变蓝
2. 面板上点「试一条」—— 这条不经过服务端，能弹说明问题在事件推送，不能弹说明是浏览器/系统层
3. macOS 系统设置 → 通知 → 对应的浏览器 → 是否允许
4. 系统「专注模式」是否开着

## 5. 【建议交给用户】把通知样式改成「提醒」

macOS 默认的「横幅」样式几秒就自动消失，很容易错过。告诉用户：

> 系统设置 → 通知 → 找到你的浏览器 → 提醒样式选「提醒」

不改也能用（有 90 秒重提醒和声音兜底），但体验差不少。

## 6. 悬浮窗（仅 macOS，可选）

```bash
agentdesk panel
```

首次运行会用系统自带的 `swiftc` 现编译（约 3 秒，产物 81KB）。
**不需要任何系统权限** —— 它只是个 WebView 壳。

编译失败且报错提到 Xcode 时，**不要自己跑 `xcode-select --install`**，让用户执行。

## 7. 开机自启

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

## 不要做的事

- **不要替用户点任何系统权限对话框**，也不要用 osascript 之类的方式绕过
- **不要跳过验证步骤**。这个工具装错了不报错，只是没反应
- **不要改用户的 shell 配置文件**（`.zshrc` 等）来解决 PATH 问题，换用完整路径调用即可
- **不要在 `init` 报错时自己猜原因**，把原始输出给用户看
- 用户的 `~/.claude/settings.json` 里可能有他自己配的 hooks，`init` 是追加不是覆盖，
  **不要手工编辑这个文件**
