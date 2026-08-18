# Q DASH — Quickstart Guide (v2.0 — Agent Observability)

Your personal cognitive OS dashboard. Started as filesystem intelligence for
a single machine; now an **agent-observability platform**: cost/time per
agent + project, one unified activity stream (agents *and* human edits), and
a stdio MCP server so any MCP client (Claude Code, etc.) can query your own
agent history as context.

---

## RUN IT

```bash
cd "C:\Users\Tyson\Desktop\Agentic dash"

# One-shot reindex (updates all JSON files, no watcher)
npm run reindex

# Full live mode (index + watch + engine, incl. agent telemetry ingest)
node run.js

# In another terminal — start the UI
cd ui && npm run dev          # http://localhost:4200

# Sync engine output -> UI static build
npm run sync
npm run build                 # builds to ui/out/ for static hosting
```

---

## WHAT IT SCANS

| Root | Origin | What you get |
|------|--------|-------------|
| `C:\Users\Tyson\brain` | brain | Notes, agents, skills, project docs |
| `C:\Users\Tyson\gstack` | gstack | 50+ automation/orchestration skills |
| `C:\Users\Tyson\.agents\skills` | agents-skills | Azure/infrastructure skills |
| `C:\Users\Tyson\.claude\skills` | claude-skills | Claude-specific skill junctions |
| `C:\Users\Tyson\.gemini\agents` | gemini-agents | Gemini reasoning skills |
| `C:\Users\Tyson\Desktop` | Desktop | Projects, notes, screenshots, etc. |

---

## WHAT IT IS NOW

Q DASH Phase 1-2 was pure filesystem intelligence: scan, classify, graph,
watch. Phase 3 adds **agent observability** on top of that same engine:

- **Cost & time per agent, per project.** Every Claude Code session (and any
  other adapter that speaks the wire format) reports real token usage and
  duration, rolled up by agent, by project, by day/week.
- **One activity stream, not two.** Agent tool calls/edits and raw human
  filesystem edits flow through the *same* event bus, so the LIVE feed and
  the neural graph show one coherent picture of "what happened here," not a
  human view and a separate agent view.
- **Monitor-only.** Q DASH never writes back into a project, never gates a
  commit, never blocks a tool call. It watches, aggregates, and serves —
  nothing more. The new MCP server (below) is read-only for the same reason.

---

## ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────────────┐
│  Phase 1: SCAN + CLASSIFY + GRAPH BUILD  (run.js boot)                 │
│  Phase 2: LIVE WATCH  (chokidar → eventBus → update chain)             │
│  Phase 3: SEMANTIC    (impact, confidence, intent, project)            │
│  Phase 4: COGNITIVE   (sessions, heatmap, insights)                    │
│  Phase 5: AGENT OBSERVABILITY (below)                                  │
└────────────────────────────────────────────────────────────────────────┘

  adapter (e.g. adapters/claude-code/qdash-hook.js)
        │  POST http://localhost:<port>/api/ingest        (2s hard cap)
        │  on failure/timeout ──▶ ~/.qdash/inbox/*.jsonl   (fallback)
        ▼
  core/ingestBridge.js
        — watches the inbox + a trigger file, normalizes canonical
          qdash.agent-event.v1 events (or legacy {source,type,detail} shape),
          tags origin:'agent', fires them into the same eventBus human edits
          use, and appends every canonical event to
          output/agent-events.log.json (source of truth, NDJSON)
        ▼
  core/agentSessionBuilder.js  →  output/agent-sessions.json (rollups + live[])
  core/spendAggregator.js      →  output/spend.json (totals, byAgent/byProject/byDay/byWeek)
  core/ledgerWriter.js         →  output/ledger/<project-slug>.md (per-project session log)
        ▼
  Next.js UI (port 4200) — tabs LIVE / BRAIN / SPEND / PROJECTS / …
        ▼
  mcp/server.mjs — stdio MCP server, reads the same output/ files, serves
        them to any MCP client (Claude Code, etc.) as 4 read-only tools
```

Q DASH itself never has to be reachable for an agent to keep working: if
`/api/ingest` is down, the adapter falls back to writing NDJSON into
`~/.qdash/inbox/`, and `ingestBridge.js` drains that inbox the next time the
engine starts (or on its next poll). The MCP server takes the same
resilience one step further — it doesn't even need the engine *running* at
query time, since it reads the last snapshot written to `output/`.

---

## OUTPUT FILES

```
output/
  index.json               # 4,300+ indexed files with metadata
  graph.json                # Nodes + edges for the neural graph
  events.log.json           # NDJSON raw filesystem events
  semantic-events.json      # NDJSON enriched events with intent, impact, confidence
  sessions.json              # Grouped work sessions (15-min gap split)
  heatmap.json               # Activity curves, peak hours, hot files
  insights.json               # Auto-generated intelligence (top project, anomalies, etc.)

  agent-events.log.json     # NDJSON canonical AgentEvents — source of truth for agent telemetry
  agent-sessions.json       # { sessions: [rollup...], live: [rollup...] } — per-session cost/time/files
  spend.json                # { totals, byAgent, byProject, byDay, byWeek } — cost & token aggregates
  ledger/<slug>.md          # Per-project context ledger — "what happened last time" for a future agent
```

`agent-events.log.json`, `sessions.json`, and `events.log.json` are all
NDJSON (one JSON object per line), not JSON arrays — everything else is a
single JSON document.

---

## HOOK SETUP (Claude Code adapter)

Hooks live in `C:\Users\Tyson\.claude\settings.json` under a top-level
`hooks` key, wired to 6 Claude Code lifecycle events, all pointing at the
same adapter script:

```json
{
  "hooks": {
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }],
    "PostToolUse":  [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/Tyson/Desktop/Agentic dash/adapters/claude-code/qdash-hook.js\"" }] }]
  }
}
```

**This is already registered on this machine** — no action needed. `PreToolUse`
is intentionally *not* wired up (it would only add latency per tool call for
no benefit; `PostToolUse` alone is sufficient to emit `tool_call`/`file_change`
events). Full wire-format details, event mapping, and failure modes are in
`adapters/claude-code/README.md`.

---

## TOKEN / COST SEMANTICS

- **Real usage, not guesses.** Token counts come from the Claude Code session
  transcript JSONL (`message.usage.input_tokens` / `output_tokens`), not the
  hook payload — hook payloads never carry usage directly.
- **Deltas per `Stop`, not totals.** Claude Code fires `Stop` at the end of
  every turn, so the adapter reports the *incremental* token delta since the
  previous `Stop`/`SessionEnd` for that session, tracked via a small state
  file at `~/.qdash/state/claude-<sessionId>.json`. A session's true total is
  the sum of all its `session_end` events' deltas — `agentSessionBuilder.js`
  does this summing for you into `output/agent-sessions.json`.
- **Estimates are flagged.** If the transcript is missing or unparsable, the
  adapter falls back to a `bytesGrown / 4` heuristic and sets
  `metadata.tokensEstimated: true` so downstream consumers (including the
  MCP server) can discount or call out estimated numbers. `tokensIn`/
  `tokensOut` are `null` — never `0` — when genuinely unknown, so a session
  with no measurable usage is never mistaken for a free one.
- **Pricing lives in `config/model-pricing.json`**, per-model input/output/
  cacheRead/cacheWrite rates in USD per million tokens, matched by longest
  model-id prefix (falls back to a `default` entry, flagged in event
  metadata when no prefix matches). Edit freely — the engine reloads
  pricing on restart.
- **Storage vs. display timezone.** Everything is stored in UTC
  (`timestamp`, `startTime`, `endTime`, ISO 8601). `spend.json`'s
  `byDay`/`byWeek` buckets are computed in `America/Chicago` (see
  `spend.timezone`) — bucket boundaries follow local calendar days/weeks,
  not UTC ones.

---

## MCP SERVER

`mcp/server.mjs` is a local, read-only, stdio MCP server that exposes Q
DASH's agent-observability data to any MCP client. It never writes
anything except its own diagnostic logging to stderr, and it works even
when the engine (`node run.js`) is down — it just serves the last
snapshot written to `output/`.

**Install (one command):**

```bash
claude mcp add qdash -- node "C:/Users/Tyson/Desktop/Agentic dash/mcp/server.mjs"
```

**Tools:**

| Tool | Call it when… | Reads |
|------|----------------|-------|
| `qdash_context({project})` | Starting a session in a project — load what previous agent sessions did there | `output/ledger/<slug>.md` |
| `qdash_search({query, limit?})` | You need to find where something lives on disk, or check a file/skill/project exists | `output/index.json` |
| `qdash_spend({period?, groupBy?})` | You want token usage / estimated cost, today / this week / all time, by agent/project/day | `output/spend.json` |
| `qdash_active()` | You want to know what's live right now — which agents/humans are working, on what, plus the last 10 raw events | `output/agent-sessions.json`, `output/agent-events.log.json` |

Missing data files (engine never run, or ledger not written yet for that
project) return a graceful text response — never an error — telling you the
engine may not be running, plus, for `qdash_context`, the list of ledgers
that *do* exist so you can retry with the right project name.

---

## UI TABS

| Tab | Default? | What it shows |
|-----|:---:|---------------|
| **LIVE** | ✅ default | Live agent-observability board — active sessions, cost/tokens ticking up, recent event stream |
| **BRAIN** | | Live force-directed graph of all files. Filter by type. Search. Click nodes for detail. |
| **SPEND** | | Cost & token usage report — totals plus breakdowns by agent, project, day, week |
| **PROJECTS** | | Project cards from your desktop (git status, deps, last commit, branch) |
| **COCKPIT** | | Live feed + active-session indicators + skill ticker + top insights/heatmap peak — the old EVENTS/SESSIONS/HEATMAP/INTEL tabs, consolidated into one view |
| **MEMORY** | | Project-memory browser |
| **CODE** | | Cross-project code graphs (via graphify), with engine status sidebar |

A pulsing green dot at the bottom of the left sidebar indicates the engine
is live and reachable — not tied to any single tab.

**Retired as standalone top-level tabs:** EVENTS, SESSIONS, HEATMAP, and
INTEL — their content lives inside **COCKPIT** now rather than as separate
nav entries.

---

## KEYBOARD / CONTROLS

```
Ctrl+C on engine    Graceful shutdown (flushes all state)
Right-click graph   Zoom to fit
Graph zoom +/−      Zoom in/out
Graph search box    Highlight matching nodes in amber
Pause/Resume        Stop/start auto-scroll on Events tab
```

---

## CUSTOMIZING FOR YOUR SETUP

### Add a new project to the Projects Hub
Edit `C:\Users\Tyson\Desktop\Agentic dash\ui\lib\projectScanner.ts`:

```ts
const DEFS = [
  ... existing items ...
  { folder: 'my-new-app', path: 'C:\\Users\\Tyson\\Desktop\\my-new-app', displayName: 'My New App' },
];
```

### Add a new project to semantic detection
Edit `C:\Users\Tyson\Desktop\Agentic dash\core\semanticEngine.js`:

```js
const KNOWN_PROJECTS = [
  ... existing items ...
  { pattern: /\/my-new-app/i, name: 'my-new-app', domain: 'custom' },
];
```

### Fix timezone on heatmap
Heatmap currently uses UTC. Edit `core/heatmapEngine.js`:
Change `d.getUTCHours()` → `d.getHours()` and `d.getUTCDay()` → `d.getDay()`.

---

## STATE OF THE ENGINE (post-fixes)

```
Files:      4,371
  By origin:
    Desktop:         2,502 (all Desktop stuff)
    agents-skills:     832 (Azure skills)
    gstack:            784 (automation skills)
    brain:             253 (notes, agents, skills)
    gemini-agents:      17 (Gemini reasoning)
    claude-skills:       2 (junctions to real skills)

Breakdown:
  Skills:        1,614
  Projects:      1,783  (mostly Desktop package.json + source files)
  Notes:           581
  APIs:             24
  Agents:            6
  Unknown:         294

Graph:  ~10,000+ nodes, edges connecting by folder/wikilink/tag/type/agent-uses
Events: 4,372 raw + 4,094 semantic
Insights: 6 active
```

---

## NEXT UP (if you want me to build it)

1. **Timezone fix** — heatmap uses local time
2. **Better Desktop filtering** — ignore screenshot pngs, installers, zips, temp files
3. **Auto-project discovery** — projects hub pulls from graph.json instead of hardcoded list
4. **Mobile-responsive** — tab bar is fine but detail panels need work
5. **Dark/light toggle** — currently locked to cyberpunk dark
6. **MCP resources/prompts** — the server currently exposes tools only; consider MCP resources for direct ledger/spend URIs if a client wants to subscribe rather than poll

Press Ctrl+C on the engine when done, or leave it running for continuous intelligence.
