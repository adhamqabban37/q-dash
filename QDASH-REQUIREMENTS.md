# QDASH REQUIREMENTS — Agent Telemetry Cockpit
**Project:** Q DASH (Q Dash Core Engine)
**Location:** `C:\Users\Tyson\Desktop\Agentic dash`
**Current state:** Filesystem intelligence dashboard (scanner, classifier, graph, heatmap, insights, project hub)
**Target state:** Agent telemetry cockpit that shows what AI agents (starting with Claude Code) actually do, which skills fire, and what memory each project uses

---

## 1. WHAT Q DASH NEEDS TO BECOME

Q DASH is shifting from **passive filesystem viewer** → **active agent telemetry cockpit**.

The engine already watches files and builds a neural graph of your local workspace. That stays. On top of it, we add an **agent event ingest layer** that accepts structured telemetry from AI agents (Claude Code first, then Hermes, Gemini CLI, manual), routes it through the existing eventBus, and surfaces it in a new **Cockpit** view plus per-project drill-downs.

Key principle: **extend, don't rewrite.** The scanner, classifier, graphBuilder, semanticEngine, sessionBuilder, heatmapEngine, and insightEngine all stay. We add ingestion + adapters + a new UI shell on top.

---

## 2. EVENT SCHEMA

Every agent event ingested (via HTTP or JSONL inbox) must conform to this shape. Malformed events are rejected and logged to `output/ingest-errors.log`.

```json
{
  "source": "claude-code | hermes | gemini-cli | manual",
  "project": "string (project name or git root folder name)",
  "type": "session_start | session_end | tool_call | skill_invoked | file_edit | command_run | memory_read",
  "detail": { "free-form": "object — tool name, file path, command, skill name, exit code, etc." },
  "ts": "ISO 8601 with timezone (e.g. 2026-07-04T14:23:11-05:00)"
}
```

### Event type semantics
| Type | Fired by | What goes in `detail` |
|------|----------|----------------------|
| `session_start` | Adapter on agent boot | `{ model, agent, working_dir }` |
| `session_end` | Adapter on agent stop | `{ duration_ms, total_tool_calls, exit_reason }` |
| `tool_call` | PreToolUse hook | `{ tool: "Read"|"Write"|"Bash"|"Edit"|"Glob"|"Grep"|..., file?: string, cmd?: string }` |
| `skill_invoked` | Skill loader | `{ skill: "gstack-pair-agent", trigger: "user"|"agent" }` |
| `file_edit` | PostToolUse hook | `{ file, before_lines, after_lines, tool: "Edit"|"Write" }` |
| `command_run` | PostToolUse on Bash | `{ cmd, exit_code, duration_ms }` |
| `memory_read` | Session start / context load | `{ files: ["CLAUDE.md", ".claude/rules.md"], bytes }` |

After validation, the event is enriched with `origin: "agent"` (vs `origin: "filesystem"` from chokidar) and pushed to the existing `eventBus`. From there it flows through `semanticEngine` → `sessionBuilder` → `heatmapEngine` → `insightEngine` exactly like a filesystem event.

---

## 3. INGESTION ARCHITECTURE

Two redundant paths. The HTTP endpoint is primary; the JSONL inbox is the fallback when the engine is down.

### 3.1 HTTP endpoint
- **Path:** `POST http://localhost:4200/api/ingest`
- **Why 4200:** Reuses the Next.js port already in use. No new port to manage.
- **Why not the engine's standalone port:** Engine is a CLI watcher, not an HTTP server. Pushing the HTTP surface into the Next.js UI process keeps the architecture simple and shares CORS/origin handling.
- **Implementation:** `ui/app/api/ingest/route.ts` — accepts a single event object or `{ events: [...] }` batch. Validates against schema, forwards each valid event to the engine via:
  - **Hot path (engine running):** append a single line to `output/inbox-pending.jsonl` AND fire a filesystem event on a file the engine watches (see 3.3).
  - **Cold path (engine down):** the same inbox file gets picked up next time the engine boots.
- **Response:** `{ ok: true, id, queued }` or `{ ok: false, error, code }` with appropriate HTTP status.

### 3.2 JSONL inbox (fallback)
- **Folder:** `C:\Users\Tyson\.qdash\inbox\` (auto-created on first use)
- **File pattern:** `*.jsonl` — one event per line, NDJSON
- **Watcher:** the engine adds this folder to its chokidar watch list
- **On new file:** tail it line-by-line, ingest each line, rename the file to `*.processed-<timestamp>` after success
- **Why both:** if the Next.js dev server crashes, the adapter falls back to writing JSONL. When the engine comes back, it drains the inbox.

### 3.3 Engine bridge
- The engine watches `C:\Users\Tyson\.qdash\bridge\trigger.json` for changes
- The UI's `/api/ingest` route, on receiving an event, appends to the bridge file's sibling `inbox-pending.jsonl` AND bumps `trigger.json`'s mtime
- Engine picks up the bump, reads the new lines, processes them, deletes the processed lines
- This is a poor-man's IPC that works without sockets, named pipes, or extra ports

---

## 4. CLAUDE CODE HOOKS ADAPTER

Located in `adapters/claude-code/`.

### 4.1 Files
- **`qdash-hook.js`** — Node.js entry point. Reads hook JSON from stdin, maps to event schema, POSTs to ingest API, falls back to JSONL append. Hard 2-second timeout via `AbortController`. All errors caught and swallowed. Always `process.exit(0)`.
- **`qdash-hook.cmd`** — Windows wrapper. Forwards stdin/stdout to `node qdash-hook.js`. Needed because Claude Code's hooks config on Windows expects a command that can be invoked directly.
- **`settings-snippet.json`** — the exact `hooks` block to merge into `C:\Users\Tyson\.claude\settings.json`:
  ```json
  {
    "hooks": {
      "PreToolUse":   [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js" }] }],
      "PostToolUse":  [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js" }] }],
      "SessionStart": [{ "hooks": [{ "type": "command", "command": "node C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js" }] }],
      "Stop":         [{ "hooks": [{ "type": "command", "command": "node C:\\Users\\Tyson\\Desktop\\Agentic dash\\adapters\\claude-code\\qdash-hook.js" }] }]
    }
  }
  ```
- **`README.md`** — exact install steps for Adam.

### 4.2 Hook event mapping
| Claude Code hook | Event type | Detail shape |
|------------------|------------|--------------|
| `PreToolUse` | `tool_call` | `{ tool, file?, cmd? }` |
| `PostToolUse` (Edit/Write) | `file_edit` | `{ file, tool }` |
| `PostToolUse` (Bash) | `command_run` | `{ cmd }` |
| `SessionStart` | `session_start` | `{ cwd }` |
| `Stop` | `session_end` | `{ reason }` |

### 4.3 Project detection
- Receive `cwd` from Claude Code's hook payload
- Walk up from `cwd` to find `.git` directory → use its parent as `project`
- If no `.git`, walk up to find `package.json` → use its parent
- If neither, use `path.basename(cwd)` as the project name

### 4.4 Skill invocation detection
- `skill_invoked` is NOT a Claude Code hook event — there's no native hook for it
- The adapter will detect skill invocations heuristically: if a `tool_call` detail has `tool: "Read"` and `file` ends with `SKILL.md`, emit a `skill_invoked` event with `{ skill: <basename of parent dir> }`
- This is best-effort; can be made more accurate later by parsing the actual Skill tool calls

### 4.5 Hard rules
- **Never block Claude Code.** 2-second timeout. If POST is slow, abort and fall back to JSONL.
- **Never crash.** All errors caught at top level.
- **Always exit 0.** Even on catastrophic failure, exit cleanly so the agent doesn't see a hook error.

---

## 5. SKILL REGISTRY + INVOCATION TRACKING

### 5.1 Registry
- **Source:** `C:\Users\Tyson\.claude\skills\` (resolves junctions to real paths automatically via `fs.realpathSync`)
- **Each entry:** `{ name, description, path, source: "claude"|"gstack"|"brain", lastSeenInIndex }`
- **Scan timing:** on engine boot, refresh registry. Also refresh on any chokidar event in the skills root.
- **Output:** `output/skill-registry.json`

### 5.2 Graph integration
- Each registered skill becomes a node in the neural graph (type: `skill-registry`)
- When the engine boots, ensure all registry skills exist as nodes even if not in the file index

### 5.3 Invocation tracking
- New engine module: `core/skillTracker.js`
- Maintains in-memory map: `skillName → { invocations: [], lastUsed, projects: Set }`
- On `skill_invoked` event, record: `{ ts, project, source }` and bump counts
- Persist to `output/skill-stats.json` on debounced flush (1.5s)
- On engine boot, reload from `skill-stats.json`

### 5.4 Dormant skills
- Any skill in the registry with `invocations.length === 0` AND `lastUsed === null` AND not seen in the last 7 days is flagged as **dormant**
- The `insightEngine` gets a new insight type: `"dormant_skill"` with detail `{ skill, daysSinceLastSeen }`
- Surfaces in the Intel tab as a yellow/amber insight

---

## 6. MEMORY PANEL

### 6.1 What counts as "memory"
- `CLAUDE.md`, `GEMINI.md`, `XENLIX-CONTEXT.md` at any depth
- Any `*.md` file at project root that contains a `memory` or `context` tag in its frontmatter
- `AGENTS.md` (new convention)
- `.claude/rules.md`, `.claude/rules/*.md`

### 6.2 Per-project memory listing
- For each known project (from `projectScanner` or graph), walk its root for memory files
- Record: `{ path, name, size, modified, lastReadBy?: session_id, readCount: number }`
- Persist to `output/memory-index.json`

### 6.3 Session correlation
- On `session_start` and `memory_read` events, link the session to the memory files it touched
- The Memory panel shows: "This project has 3 memory files. Last read by session `abc123` 2 hours ago. 12 total reads this week."

### 6.4 UI
- New tab: **Memory**
- Layout: project selector on the left, memory file list in the middle, file preview + read history on the right
- Each file shows: name, path, size, last modified, last read by, read count (sparkline if possible)

---

## 7. COCKPIT UI OVERHAUL

### 7.1 New default landing view: **Cockpit**
A dense, dark-theme mission-control layout. Single page, no scrolling required for the main view.

**Layout grid:**
```
┌──────────────────────────────────────────────────────────────┐
│  [STATUS STRIP]  Engine: ●  Watcher: ●  Ingest: ●  Rate: 12/m│
├───────────────────────────────────┬──────────────────────────┤
│                                   │                          │
│  LIVE AGENT FEED                  │  ACTIVE SESSIONS         │
│  ─────────────────                │  ─────────────           │
│  14:23 claude-code  tool_call     │  ● xxx5.0     3m ago    │
│  14:23 claude-code  skill_invoked │  ● brain      12m ago   │
│  14:22 hermes       memory_read   │  ● gstack     1h ago    │
│  ...                              │                          │
│  [auto-scroll, color-coded]       │  SKILL TICKER            │
│                                   │  ──────────              │
│                                   │  gstack-pair-agent ×3   │
│                                   │  stitch-design     ×1   │
│                                   │                          │
├───────────────────────────────────┴──────────────────────────┤
│  TOP INSIGHTS                                                 │
│  • Peak hour: 14:00  • Most active: xxx5.0  • 3 dormant skills│
├──────────────────────────────────────────────────────────────┤
│  [Brain] [Events] [Sessions] [Heatmap] [Intel] [Projects]     │
│           [Memory] [Cockpit]      ← tab bar (Cockpit default)│
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Live updates
- **Mechanism:** Server-Sent Events (SSE) endpoint at `GET /api/stream`
- The UI process owns the SSE endpoint; the engine pushes new events to it via the bridge file (3.3)
- The UI subscribes once and updates state in-place — no SWR polling on the Cockpit tab
- Existing tabs keep their SWR polling (no regression)

### 7.3 Status lights
- Green: component healthy (responded within last 10s)
- Yellow: stale (no response 10–30s)
- Red: down (no response >30s or explicit error)
- **Engine:** checked by reading `output/state.json` mtime
- **Watcher:** checked by reading `output/events.log.json` mtime
- **Ingest API:** self-check (the route always returns 200 when running)

### 7.4 Visual style
- Background: `bg-zinc-950`
- Panels: `bg-zinc-900` with `border-zinc-800` 1px borders
- Text: `text-zinc-100` for primary, `text-zinc-400` for secondary
- Monospace: `font-mono text-xs` for data readouts and timestamps
- Accent colors per source: claude-code `text-emerald-400`, hermes `text-cyan-400`, gemini `text-violet-400`, filesystem `text-amber-400`
- Event-type icons: small SVG glyphs in the left margin
- No emojis in data, no clutter, no fake "futuristic" gradients — ops console aesthetic

### 7.5 Per-project drill-down
- Click any project card or active session indicator → opens `/projects/[slug]`
- Shows: live event feed filtered to that project, skills used in this project, memory files for this project, session history timeline
- Backed by existing `/api/projects/[slug]` route, extended to include new fields

### 7.6 Tab changes
- **Cockpit** is the new default landing tab
- **Memory** is the new 7th tab
- Existing tabs (Brain, Events, Sessions, Heatmap, Intel, Projects) restyled to match the cockpit aesthetic

---

## 8. FILE-BY-FILE CHANGE LIST

### New files
- `QDASH-REQUIREMENTS.md` ← this file
- `core/ingestBridge.js` — watches the bridge file, drains pending events into eventBus
- `core/skillTracker.js` — registry + invocation tracking + dormant detection
- `core/memoryScanner.js` — discovers memory files per project
- `adapters/claude-code/qdash-hook.js` — Claude Code hook adapter
- `adapters/claude-code/qdash-hook.cmd` — Windows wrapper
- `adapters/claude-code/settings-snippet.json` — hooks config
- `adapters/claude-code/README.md` — install instructions
- `ui/app/api/ingest/route.ts` — HTTP ingest endpoint
- `ui/app/api/stream/route.ts` — SSE stream endpoint
- `ui/app/api/skill-stats/route.ts` — returns skill invocation stats
- `ui/app/api/memory/route.ts` — returns memory index
- `ui/app/api/cockpit/route.ts` — returns aggregated cockpit state
- `ui/components/Cockpit.tsx` — main cockpit layout
- `ui/components/LiveFeed.tsx` — streaming event feed
- `ui/components/StatusStrip.tsx` — top status bar with lights
- `ui/components/SessionIndicators.tsx` — active sessions panel
- `ui/components/SkillTicker.tsx` — skill invocation ticker
- `ui/components/MemoryPanel.tsx` — memory tab content
- `ui/components/ProjectCockpit.tsx` — per-project drill-down view
- `ui/lib/useLiveEvents.ts` — SSE subscription hook

### Modified files
- `run.js` — wire in `ingestBridge`, `skillTracker`, `memoryScanner`; add `.qdash/inbox` to watcher roots
- `core/watcher.js` — add `C:\Users\Tyson\.qdash\inbox\` and `C:\Users\Tyson\.qdash\bridge\` to WATCH_ROOTS
- `core/eventBus.js` — add `origin` field defaulting to `"agent"` for ingested events
- `core/semanticEngine.js` — handle `origin: "agent"` events (project comes from event.project, not path matching)
- `core/insightEngine.js` — add dormant_skill insight type
- `ui/app/page.tsx` — set Cockpit as default tab
- `ui/app/layout.tsx` — apply dark theme baseline
- `ui/components/*.tsx` — restyle for cockpit aesthetic
- `ui/lib/projectScanner.ts` — extend to scan memory files

### No changes
- `core/scanner.js`, `core/classifier.js`, `core/graphBuilder.js` — keep as-is (already overhauled)
- `core/heatmapEngine.js`, `core/sessionBuilder.js` — only minor enrichment to handle `origin: "agent"`

---

## 9. ACCEPTANCE CRITERIA CHECKLIST

End state: I open localhost:4200, see the Cockpit view, start a Claude Code session in any project, and watch its tool calls, skill invocations, and memory reads appear live, per project, with dormant skills flagged in Intel.

- [x] Engine boots cleanly with all 4 phases + new ingest bridge + skill tracker + memory scanner
- [x] POST /api/ingest accepts valid events and rejects malformed ones with 400
- [x] JSONL inbox at C:\Users\Tyson\.qdash\inbox\ is watched and drained
- [x] Claude Code adapter installed and verified (settings-snippet.json + qdash-hook.js + .cmd wrapper)
- [x] Tool calls, file edits, commands appear in Cockpit live feed within 1s (via SSE)
- [x] Skill invocations detected and tallied per skill (via Read-of-SKILL.md heuristic)
- [x] Dormant skills surface in Intel tab as a distinct insight type
- [x] Memory panel shows per-project context files with read history
- [x] Cockpit is the default landing view at localhost:4200
- [x] Status lights reflect real engine/watcher/ingest health
- [x] SSE stream delivers events without page refresh (/api/stream)
- [x] Per-project drill-down via /api/cockpit shows live sessions per project
- [x] All existing tabs (Brain, Events, Sessions, Heatmap, Intel, Projects) still work
- [x] All output JSON files regenerate cleanly on engine boot
- [x] No regressions: scanner, classifier, graph, heatmap, sessions all still work
- [x] Engine still requires PTY to run (known quirk, documented)

STATUS: ALL ACCEPTANCE CRITERIA MET. COCKPIT IS LIVE.
