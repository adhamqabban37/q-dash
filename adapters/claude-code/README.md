# Q DASH — Claude Code Hook Adapter

Sends Claude Code sessions, prompts, tool calls, file edits, and token usage to Q DASH as live telemetry, in the canonical `qdash.agent-event.v1` wire format shared by every Q DASH adapter.

## Install (one-time, 30 seconds)

1. Make sure Q DASH is running: `node "C:\Users\Tyson\Desktop\Agentic dash\run.js"` in a separate terminal.
2. Open `C:\Users\Tyson\.claude\settings.json`.
3. Add the `hooks` block below (or merge it into an existing `hooks` key — see `settings-snippet.json` in this folder for a ready-to-paste copy).
4. Done. Start a Claude Code session in any project — events appear at `http://localhost:4200` within about a second, or land in the local inbox if Q DASH isn't running.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ],
    "PostToolUse": [
      { "matcher": ".*", "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "node \"C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js\"" } ] }
    ]
  }
}
```

`PreToolUse` is intentionally **not** registered — the adapter emits nothing for it (see below), so wiring it up would only add latency to every tool call for no benefit.

## The AgentEvent wire format

Every line the adapter sends (via POST body, or as one line of the inbox JSONL fallback) is a single JSON object:

```jsonc
{
  "schema": "qdash.agent-event.v1",
  "agentId": "claude-code",
  "agentType": "claude-code",
  "sessionId": "<session_id from the hook payload, or null>",
  "timestamp": "<ISO 8601 UTC, e.g. 2026-07-14T18:32:01.123Z>",
  "eventType": "session_start" | "tool_call" | "file_change" | "session_end" | "error",
  "project": "<detected project name>",
  "filesTouched": ["<absolute paths, may be empty>"],
  "tokensIn": 123,          // int, or null if genuinely unknown — never 0-as-unknown
  "tokensOut": 45,          // int, or null
  "model": "claude-...",    // model id string, or null
  "estimatedCostUsd": null, // ALWAYS null from the adapter — the engine computes cost
  "durationMs": 4200,       // int, or null
  "metadata": { "...": "event-specific, see below" }
}
```

### Event mapping

| Claude Code hook event | `eventType`    | Notes |
|-------------------------|----------------|-------|
| `SessionStart`          | `session_start`| Initializes per-session token-tracking state (see below). `metadata: { hookEvent, source? }`. |
| `UserPromptSubmit`      | `tool_call`    | `metadata: { kind: "prompt", hookEvent }`. |
| `PreToolUse`            | *(nothing emitted)* | Skipped entirely — only `PostToolUse` emits, to avoid double-counting a tool call. |
| `PostToolUse` — Edit / Write / MultiEdit / NotebookEdit | `file_change` | `filesTouched` = the edited file. `metadata: { kind: "edit", tool }`. |
| `PostToolUse` — Read     | `tool_call`    | `filesTouched` = the file read. `metadata: { kind: "memory_read", tool }` — or, if the path ends in `SKILL.md` (case-insensitive), `metadata: { kind: "skill_invoked", skill: <parent dir name>, tool }`. |
| `PostToolUse` — Bash     | `tool_call`    | `metadata: { kind: "command_run", tool, cmd: <first 200 chars> }`. |
| `PostToolUse` — anything else | `tool_call` | `metadata: { kind: "tool", tool }`. |
| `PostToolUse` — any of the above, when `tool_response` indicates failure | `error` (overrides the mapping above) | Adds `metadata.error` (first 300 chars) on top of the usual `kind`/`tool` fields. Failure = `tool_response.is_error === true`, or a truthy `tool_response.error`, or a string `tool_response` starting with `Error`. |
| `Stop` / `SessionEnd`   | `session_end`  | Incremental token deltas — see below. `metadata: { hookEvent, cacheReadTokens, cacheWriteTokens, tokensEstimated? }`. |
| `SubagentStop`          | `tool_call`    | `metadata: { kind: "subagent", hookEvent }`. No token parsing — subagent usage is already folded into the main transcript's totals. |
| `Notification` / anything unrecognized | *(nothing emitted)* | |

## Incremental token-delta semantics (`Stop` / `SessionEnd`)

Claude Code hook payloads never carry token usage directly. The only real source is the session's transcript JSONL file (`transcript_path` from the hook payload) — lines with `type: "assistant"` carry `message.model` and `message.usage = { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`.

- On `SessionStart`, the adapter writes `~/.qdash/state/claude-<sessionId>.json`:
  ```json
  { "sessionId": "...", "startTs": "...", "transcriptPath": "...", "offset": 0, "reportedIn": 0, "reportedOut": 0, "lastModel": null, "project": "..." }
  ```
- On every `Stop` (and `SessionEnd`), the adapter re-opens the transcript, seeks to the saved byte `offset`, reads at most 5 MB of new content, and parses only **complete** JSONL lines — if the last line in the read chunk is truncated (still being written), the offset is **not** advanced past it, so it's re-read whole next time.
- `tokensIn` = sum of `input_tokens` across new assistant messages only. `tokensOut` = sum of `output_tokens`. Cache token counts go in `metadata.cacheReadTokens` / `metadata.cacheWriteTokens` — they are never folded into `tokensIn`/`tokensOut`.
- `model` = the last `message.model` seen in this delta, falling back to the previous session's last known model.
- `durationMs` = `Date.now() - Date.parse(state.startTs)` — a **running total** from session start, not a per-delta duration. The engine is expected to take the max across a session's `session_end` events, not sum them.
- The state file's `offset`, `reportedIn`, `reportedOut`, and `lastModel` are updated after each `Stop`/`SessionEnd`.
- **Multiple `session_end` events per session are expected** — Claude Code fires `Stop` at the end of every turn. Each event carries only the token delta since the *previous* `Stop`/`SessionEnd`, not the session's cumulative total. Consumers that want a session total should sum `tokensIn`/`tokensOut` across all `session_end` events for a `sessionId`.

### `tokensEstimated` fallback

If the transcript is missing, unreadable, or its content doesn't parse as JSONL, the adapter falls back to an estimate: `Math.round(bytesGrown / 4)` total tokens (a rough chars-per-token heuristic), split 80/20 between `tokensIn`/`tokensOut`, and sets `metadata.tokensEstimated = true` so downstream consumers can discount or flag these numbers. If even the file size can't be read, `tokensIn` and `tokensOut` are both `null` (never `0` — `0` would falsely imply zero usage).

## Project detection

The adapter walks up from the hook payload's `cwd`, looking for `.git` first, then `package.json` (using its `name` field if present), then falls back to the folder name.

## Failure modes

- **Q DASH not running:** POST fails/times out (2s hard cap) → falls back to writing a JSONL line to `C:\Users\Tyson\.qdash\inbox\`. When Q DASH comes back up, the bridge drains the inbox.
- **Hook takes too long (>2s):** Aborts the request, falls back to the inbox JSONL.
- **State file missing or corrupt:** Treated as absent; the adapter rebuilds a best-effort ephemeral state so a `Stop`/`SessionEnd` can still emit (duration/tokens will only reflect from that point forward).
- **Anything else goes wrong:** The hook always exits 0. Claude Code never sees a hook error.

## Inbox folder

`C:\Users\Tyson\.qdash\inbox\claude-<timestamp>.jsonl` — one canonical AgentEvent per line, NDJSON.
