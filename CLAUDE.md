# Q DASH — CLAUDE.md

Personal cognitive-OS dashboard: a Node.js filesystem-intelligence engine that indexes and live-watches this machine's knowledge roots, plus a Next.js UI ("cockpit") that visualizes the output.

## Commands
```bash
npm run reindex     # one-shot reindex — rebuilds all output/*.json, no watcher
node run.js         # full live mode: index + watch + engine
npm run dev         # UI dev server (cd ui) — http://localhost:4200
npm run sync        # copy engine output/ -> UI static data
npm run build       # static UI build to ui/out/
```
Engine and UI are separate processes — run both for live mode.

## Layout
```
run.js / reindex.js / sync.js   engine entry points (plain Node, no build step)
core/                           engine internals
adapters/                       per-root scan adapters
output/                         generated JSON (index, graph, events, sessions,
                                heatmap, insights) — REGENERATED, don't hand-edit
ui/                             Next.js cockpit (own package.json, port 4200)
project-memory/                 persisted project state
qdash/                          dashboard assets
```

## Scan Roots
`~/brain`, `~/gstack`, `~/.agents/skills`, `~/.claude/skills`, `~/.gemini/agents`, `~/Desktop` — changing roots means editing the adapter config, then `npm run reindex`.

## graphify Bridge
`core/graphifyBridge.js` discovers `graphify-out/graph.json` knowledge graphs across
Desktop/brain/gstack during reindex (and `run.js` phase 1), writes summaries to
`output/code-graphs.json` (nodes/edges/communities, top god nodes, stale-vs-HEAD
commit check). UI: CODE tab (`ui/components/CodeGraphPanel.tsx`, `/api/code-graphs`).
To add a project to the panel: run `graphify update .` in that repo, then reindex.
This project's own graph is kept clean by `.graphifyignore` (excludes `output/`,
`project-memory/`, `ui/public/api-cache/`).

## Rules
1. Never hand-edit `output/*.json` — it is regenerated; fix the engine or reindex instead.
2. `events.log.json` / `semantic-events.json` are NDJSON (one JSON object per line), not JSON arrays.
3. The engine watches Desktop recursively — avoid creating high-churn temp files under Desktop while `run.js` is live.
4. UI reads static JSON snapshots; after engine changes run `npm run sync` before judging UI behavior.

## See Also
- `GET_STARTED.md` — quickstart, output-file schema, UI tab guide
- `QDASH-REQUIREMENTS.md` — spec
