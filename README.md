# agentdesk

One panel for all your AI coding agents. It answers one question: **which one is waiting on me?**

English · [中文](./README.zh-CN.md)

---

Once you run Claude Code, Codex and Kimi side by side, the real time sink isn't
forgetting whether something finished. It's an agent **sitting there waiting for your
approval while you assume it's working**. The window is open, the cursor blinks, and
twenty minutes later you find out it asked you something three minutes in.

> Installing via an AI assistant? See [AGENTS.md](./AGENTS.md) — step-by-step with verification
> for each stage, and it marks the three steps that must be done by a human.

## Before you install

| Requirement | Note |
|---|---|
| **Node 18+** | The main program |
| **Xcode command line tools** | Only for the macOS floating panel — `xcode-select --install`. Everything else works without it |

**The npm name isn't registered yet, so install from source:**

```bash
git clone <repo> agentdesk
cd agentdesk
npm link
agentdesk init
```

`init` detects which agents you have and wires up their hooks (originals kept as
`.agentdesk-backup`). Use `agentdesk init --dry-run` to preview.

Not into a global install? Replace every `agentdesk` below with `node bin/agentdesk.js`.

## Three ways to watch

**① Floating desktop panel (macOS, recommended)**

```bash
agentdesk          # start the service
agentdesk panel    # open the floating window
```

Always on top, follows you across Spaces and full-screen apps, and clicking it doesn't steal
focus from whatever you're typing in. Drag anywhere to move; position and size are remembered.

Compiles on first run (~3s, 81KB binary). **Needs no system permissions** — it's just a WebView
shell. No Electron, because shipping a 100MB runtime to render a dozen lines of text isn't worth it.

**② Browser panel**

```bash
agentdesk
```

More detail (paths, full timestamps). Cross-platform.

**③ Terminal**

```bash
agentdesk status
```

## Commands

| Command | What it does |
|---|---|
| `agentdesk` | Start service + open browser panel (`--no-open` to skip the browser) |
| `agentdesk panel` | Floating desktop window (macOS) |
| `agentdesk init` | Wire up installed agents (`--dry-run` to preview) |
| `agentdesk status` | One-shot terminal view |
| `agentdesk test` | Self-check: verify notifications actually fire |
| `agentdesk run "title" -- <cmd>` | Wrap any tool that has no hooks |
| `agentdesk probe <name>` | Dump whatever an agent sends, to build an adapter from |

Run `agentdesk test` right after install — it injects a test notification and prints a
troubleshooting checklist if nothing shows up.

## Autostart

The whole point is that you don't have to remember to open it. Retyping a command after every
reboot defeats that.

```bash
agentdesk autostart          # service + floating panel
agentdesk autostart --off    # undo
```

macOS uses a LaunchAgent with `KeepAlive` — kill the service and it comes back (measured: under
5s). The floating panel is a GUI app, so it goes through Login Items instead (launchd has
session-scope pitfalls for GUI processes). Windows drops a `.vbs` in the Startup folder (vbs so
no console window flashes at boot).

Logs land in `~/.agentdesk/server.log`.

## Uninstalling

```bash
agentdesk uninit --dry-run   # preview
agentdesk uninit             # do it
agentdesk uninit --purge     # also delete ~/.agentdesk
```

It does **not** restore the backup files — if you edited those configs after `init`, a wholesale
restore would wipe your own changes too. Instead it surgically removes what agentdesk added:
hook entries whose command mentions agentdesk, the `notify` line (restored to whatever it was
before), autostart, and any running processes.

`.agentdesk-backup` files are left in place for you to delete once you're satisfied.

## Done but unseen

This is the whole point of the panel. A task that finished without anyone noticing is no
different from one that hasn't finished.

Completed tasks start **unread**: a dot on the card, a tint of the state color, counted in the
tab title and the header ("3 finished, unseen"). Click a card to mark it read, or use "mark all
read". Two paths mark a task read, both precise to a single task:

- **Speaking in that session again** — you're already back at the scene
- **Clicking the notification** — it names one task, and you just saw it

Focusing an agent's window does **not** clear its unreads. Foreground detection only yields an
app name (window titles need macOS accessibility permission), so it can't tell which of your 3
open claude sessions you actually looked at. Marking all 3 read is exactly the failure this tool
exists to prevent.

Foreground detection is used for something else instead: **while you're in an agent's window, its
notifications stay quiet, but the unread marks remain**. Walk away and the reminders resume. Set
`"muteForegroundAgent": false` to disable.

Tasks you interrupted yourself don't count as unread. You stopped them; you know.

## States

| State | Meaning |
|---|---|
| ⏸ Waiting | Blocked on a question or a permission prompt — the signal that matters most |
| ⚠ Stale | No activity past the timeout. Crashed, terminal closed, machine slept |
| ✕ Failed | Non-zero exit |
| ⏳ Background | Main turn ended but background commands are still running |
| ✓ Done | Finished normally. **Stays flagged unread until you look at it** |
| ▶ Running | Working, ignore it |
| ⏸ Idle | Session went quiet without a proper ending; resumes automatically if it comes back |

**Stale is the important one.** No agent tells you it died. Listening only for
completion events will miss every abnormal ending. agentdesk tracks `last_seen`
per task and downgrades to stale on timeout.

**Background is the other blind spot.** Claude Code's `Stop` only means the main turn ended.
If background commands are still running, calling it "done" is a lie. agentdesk catches
background starts from `PostToolUse` and detects the end by reading `[exited with code N]`
from the task's output file — a deterministic marker, not a silence heuristic, and it carries
the exit code, so a failed background job marks the whole task failed.

## Supported

| Agent | Mechanism | Detects "waiting" | Latency |
|---|---|---|---|
| Claude Code | native hooks | ✅ | seconds |
| Codex (ChatGPT app) | watches `~/.codex/sessions/**.jsonl` | ⚠️ no approval event seen yet | sub-second |
| ~~Codex CLI `notify`~~ | disabled — ChatGPT app's internal subagents trigger it too, and the notify payload carries nothing to tell them apart | — | — |
| Kimi Code | `notify` | ✅ | seconds |
| WorkBuddy | watches its sqlite `sessions` table | ⚠️ same | sub-second |
| Anything else | `agentdesk run` wrapper | ❌ start/done/failed only | seconds |

GUI apps with no hooks still work: **they have to write state somewhere**. WorkBuddy keeps
sessions in sqlite (with `title` and `status`); Codex appends each turn to jsonl.

These sources aren't polled on a timer — `fs.watch` covers the directories and reacts on
change, measured at 826ms end to end. The timer is only a fallback for platforms where
recursive watching isn't available.

If `notify` is already taken (e.g. by Codex Computer Use), `init` chains to the
existing command instead of overwriting it.

```bash
agentdesk run --as kimi "refactor payments" -- kimi -p "..."
```

## Adding an agent

Don't read docs or reverse-engineer binaries — make the agent hand over its data.

```bash
agentdesk probe myagent
```

Point that at any hook slot the agent offers, run it once, and it dumps the raw
`argv`, `stdin` and relevant env vars to `~/.agentdesk/probe-myagent.log`.

Then write a JSON file into `~/.agentdesk/adapters/`:

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

`source` picks where data comes from: `stdin` (hooks over stdin, e.g. Claude Code),
`argv` (JSON as a CLI argument), `watch-jsonl` (poll an append-only jsonl, reading only what's
new), `sqlite` (poll a database table), `run` (wrap the command).

Polling adapters can also declare an `index` to enrich rows from another file — that's how
Codex session titles get pulled from `session_index.jsonl`.

No code required. **PRs adding adapters are just a JSON file.**

The probe also runs passively: **anything an adapter fails to match gets recorded**. If a hook or
notify call matches no rule, the raw payload lands in `~/.agentdesk/probe-<agent>.log` so you can
write the rule from real data. Credential-like env vars are redacted, so the log is safe to paste
into an issue.


## Push to your phone

`~/.agentdesk/config.json`:

```json
{
  "timeouts": { "default": 900000, "codex": 1800000 },
  "webhooks": [{
    "url": "https://your-webhook",
    "on": ["waiting", "stale", "failed"],
    "body": { "text": "{{agent}} {{state}}: {{title}}" }
  }]
}
```

Any service that takes a POST works — Feishu, DingTalk, Telegram, ntfy, Slack.

## How it works

```
agent hook ──> agentdesk hook ──> events.jsonl ──> projection ──> SSE ──> panel/notify
                                       ↑
                                 timeout sweep (covers what emits no signal)
```

Events are append-only. State is projected from the event stream on every read and
never persisted, so deleting `~/.agentdesk/events.jsonl` is a complete reset.

**Zero runtime dependencies.** Node built-ins only; `dependencies` is empty.

One codebase for Windows and macOS — which is why notifications go through the
browser's Notification API rather than a system tray: it's a native OS notification
on both platforms and needs no dependency.

## License

MIT
