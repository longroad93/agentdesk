# agentdesk

One panel for all your AI coding agents. It answers one question: **which one is waiting on me?**

English · [中文](./README.zh-CN.md)

---

Once you run Claude Code, Codex and WorkBuddy side by side, the real time sink isn't
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

**It delivers the notifications.** The first time, click "开启通知" (enable notifications) in its
header and allow the system prompt — after that no browser tab has to stay open. macOS gives new apps
the "Banners" style, which vanishes after a few seconds — switch it to "Alerts" in System Settings →
Notifications → Agentdesk Panel. No other system permission is needed.

Compiles on first run (~3s, ~115KB binary). No Electron, because shipping a 100MB runtime to render
a dozen lines of text isn't worth it.

**② Browser panel**

```bash
agentdesk
```

More detail (paths, full timestamps). Cross-platform. After you allow notifications on the page it
can deliver them too; when the floating panel is also open, only the panel does, so nothing rings
twice. If no open page can deliver notifications, the panel says so at the top.

**③ Terminal**

```bash
agentdesk status
```

## Commands

| Command | What it does |
|---|---|
| `agentdesk` | Start service + open browser panel (`--no-open` to skip the browser) |
| `agentdesk panel` | Floating desktop window (macOS; delivers notifications) |
| `agentdesk init` | Wire up installed agents (`--dry-run` to preview) |
| `agentdesk status` | One-shot terminal view (same logic as the panel; last line shows read signals and notification status) |
| `agentdesk test` | Self-check: verify notifications actually fire |
| `agentdesk run "title" -- <cmd>` | Wrap any tool that has no hooks |
| `agentdesk probe <name>` | Dump whatever an agent sends, to build an adapter from |

Run `agentdesk test` right after install — it first asks the service who is delivering
notifications (the panel or a browser page) and tells you why if nobody is; otherwise it injects a
test notification and prints a checklist (system notification settings, Focus) if nothing shows up.

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
tab title and the header ("3 finished, unseen").

**Read state comes from the agents' own records**, always precise to a single session, with no
permissions required:

- **Claude desktop app** — it records when you last focused each session. If you opened that
  session after it finished, you've seen it
- **It was on your screen when it finished** — Claude in front, that session focused, for 3+
  seconds: counts as seen, and no notification fires
- **WorkBuddy** — mirrors its own unread flag (`sessions.unread`)
- **Speaking in that session again** — you're already back at the scene
- **Clicking the card or the notification** — it names one task, and you just saw it

Focusing an agent's app does **not** clear all its unreads. When only the app is known, not the
session (e.g. Codex), a task is marked read only if it's the single unread one for that app;
with several, it can't tell which one you looked at, so you click.

Unattended runs like `claude -p` never count as unread (nobody reads them in a UI); their
failures still alert. Tasks you interrupted yourself don't count as unread either.

**The session you're looking at stays quiet**; parallel sessions still notify (it used to mute the
whole app, so session B finishing while you watched session A went unnoticed). Set
`"muteForegroundAgent": false` to disable.

Clicking a failed or stale card acknowledges it and stops the reminders. Reminders back off —
90s, 5 min, 15 min — and skip whatever you're looking at.

Anything that needs you stays in the main list; only tasks you've already dealt with fold into
"older" after 6 hours, so the header count always matches what you can see.

Unread tasks stay up to 24 hours (`"attentionRetention"`, ms, in `~/.agentdesk/config.json`).
Nothing is deleted — they just stop showing on the panel.

The last line of `agentdesk status` shows whether these read signals work. The desktop app's
session records are a private format; if an update changes it, status says so and read receipts
fall back to "reply or click" instead of silently breaking.

## States

| State | Meaning |
|---|---|
| ⏸ Waiting | Blocked on a question or a permission prompt — the signal that matters most. The subtitle is the question itself, or the command awaiting approval |
| ⚠ Stale | No activity past the timeout (transcript, session log and sub-agents all silent). Crashed, terminal closed, machine slept |
| ✕ Failed | Non-zero exit, or an API error (overloaded, connection lost, logged out) ended the turn; the subtitle shows it |
| ⏳ Background | Main turn ended but background commands or background sub-agents are still running |
| ✓ Done | Finished normally; the subtitle is its last line (marked when it ends in a question). Unread until you look at it |
| ▶ Running | Working; the subtitle says what it's doing right now: which command, which file, thinking |
| ⏸ Idle | You interrupted it (Claude's interrupt marker, Codex's turn_aborted). Not unread — you stopped it |

**Stale is the important one.** No agent tells you it died. Listening only for
completion events will miss every abnormal ending. agentdesk tracks `last_seen`
per task and downgrades to stale on timeout.

**Background is the other blind spot.** Claude Code's `Stop` only means the main turn ended.
If background commands or sub-agents are still running, calling it "done" is a lie. Whoever starts
a background task, Claude Code opens a `.output` file under the temp dir's `tasks/` and appends
`[exited with code N]` when it ends; without that marker, agentdesk checks whether a process still
holds the file open (`lsof`, batched and asynchronous so it never stalls the service). Foreground
commands open a `.output` too, so only IDs the transcript registered as background
(`running in background with ID` / `agentId`) count — foreground ones only prove it's alive.

**Running vs. idle isn't guessed.** It used to be "no transcript write for 90s means stopped"; over
14 days that misfired 77 times on long replies and long commands, against 33 real interrupts.
Now only deterministic signals count: an unanswered tool call at the end of the transcript means
running, your message with no reply yet means thinking, an interrupt marker means idle.

## Supported

| Agent | Mechanism | Detects "waiting" | Latency |
|---|---|---|---|
| Claude Code | native hooks; read state from the desktop app's own session records | ✅ | seconds |
| Codex (ChatGPT app) | watches `~/.codex/sessions/**.jsonl`; a session log still being written is never stale | ⚠️ no approval event seen yet | sub-second |
| ~~Codex CLI `notify`~~ | disabled — ChatGPT app's internal subagents trigger it too, and the notify payload carries nothing to tell them apart | — | — |
| Kimi Code | `notify` | ⚠️ **adapter written but never verified** — copied from Codex; the author's account was unusable at the time | — |
| WorkBuddy | watches its sqlite `sessions` table; read state mirrors its `unread` column | ⚠️ same | sub-second |
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

**The premise: it has to write its state down somewhere.** A hook is ideal, but failing that
there's always a session file, a database, or a log. Of the three agents supported here, only
one has native hooks.

### 1. Find where it writes state

Check in this order, stop at the first hit:

```bash
# Hooks / notify config? (best — sub-second, no polling)
grep -rn "hooks\|notify" ~/.<agent>/*.json ~/.<agent>/*.toml 2>/dev/null

# Session files? (next best — fs.watch still gets sub-second)
find ~/.<agent> -name "*.jsonl" -o -name "*.json" | head

# A database? (often the richest — status fields already exist)
find ~/.<agent> -name "*.db" -o -name "*.sqlite" | head
sqlite3 "file:<db>?mode=ro" ".tables"
```

### 2. Judge whether the signal is trustworthy

**Don't skip this — it determines the quality of the adapter.**

| Deterministic | Guesswork |
|---|---|
| `status = 'completed'` | how long since the file changed |
| `type: task_complete` | whether a process still exists |
| `[exited with code 0]` | whether some keyword appeared in output |

Guesswork can still work, but mark the adapter `"confidence": "guess"` — the panel then labels
those tasks and de-emphasizes them. **Never let a guess look as certain as a hook.**

Also watch out: **many agents spawn internal sub-sessions** (summaries, sub-agents). Those aren't
user tasks and become noise. Look for a field that separates them — Codex has
`session_meta.thread_source` (`user` / `subagent`), WorkBuddy has `is_background_automation`.

### 3. Write the adapter

One JSON file in `~/.agentdesk/adapters/`, no code:

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

| source | When | Example here |
|---|---|---|
| `stdin` | Hook delivers data on stdin | Claude Code hooks |
| `argv` | Hook delivers data as a CLI arg | Codex CLI `notify` |
| `watch-jsonl` | Append-only jsonl session log | Codex session stream |
| `sqlite` | State lives in a database | WorkBuddy `sessions` |
| `run` | None of the above — wrap the command | `agentdesk run "title" -- <cmd>` |

`kind` is one of `start` / `waiting` / `done` / `failed` / `closed` / `stopped` (you interrupted it;
shown as idle, not unread) / `heartbeat` / `ignore`.
**Rules match in order, first hit wins** — put specific cases first, fallbacks last.

Optional fields: `session_filter` (drop whole sessions, e.g. internal sub-agents),
`index` (enrich rows from another file), `foreground` (which app window this agent owns — used for
muting and the "open ↗" button), `confidence`, plus:

- `read` — a condition telling whether the agent itself considers the session read, e.g. WorkBuddy's
  `"$.unread == 0"`. When declared it wins, and it travels on its own channel so a read flip never
  turns the task unread again
- `heartbeat` — `{ "field": "$.last_activity_at", "every": 60000 }`: for agents without a transcript,
  emit a heartbeat as this field grows so long tasks aren't reported stale
- `map.alive` — a file path (Codex uses `$._file`, the session log itself); while it's being written,
  the task is alive
- `env` — for hook adapters, fields taken from environment variables, e.g. Claude's
  `{ "entrypoint": "CLAUDE_CODE_ENTRYPOINT" }`, which tells desktop sessions from `claude -p` runs

### 4. Verify

```bash
agentdesk serve --no-open
agentdesk status
cat ~/.agentdesk/events.jsonl | tail -5
```

**Anything an adapter fails to match is recorded** to `~/.agentdesk/probe-<agent>.log` so you can
write the rule from real data. Credential-like env vars are redacted; safe to paste into an issue.

### Let an AI do it

Hand the repo to Claude Code / Codex and say:

> Read AGENTS.md and the existing examples under adapters/, then write an adapter for <agent>.
> First run the discovery commands from README step 1 to find where it writes state, tell me
> what signal you found and why you trust it, and wait for my confirmation before writing JSON.
> Don't guess at rules — if there's no deterministic signal, say so.

That last sentence matters. **Guessing produces a panel that looks like it works but reports the
wrong state**, which is worse than no panel.

**PRs adding adapters are welcome — it's just a JSON file, no code changes.**

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

Webhooks fire only on real changes: marking something read, a title arriving late or a service
restart never re-sends; a task that's on your screen isn't pushed either.

## How it works

```
agent hook ──> agentdesk hook ──> events.jsonl ──> projection ──> SSE ──> panel/notify
                                       ↑
                                 timeout sweep (covers what emits no signal)
```

Events are append-only. State is projected from the event stream on every read and
never persisted, so deleting `~/.agentdesk/events.jsonl` is a complete reset.

**Zero runtime dependencies.** Node built-ins only; `dependencies` is empty.

One codebase for Windows and macOS. On macOS the floating panel posts native notifications;
elsewhere they go through the browser's Notification API — native OS notifications either way,
with no dependency.

Tests: `npm test` (Node's built-in `node --test`, also dependency-free).

## License

MIT
