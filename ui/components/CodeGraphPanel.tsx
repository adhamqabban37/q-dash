'use client';

import { useState } from 'react';
import type { CodeGraphSummary } from '@/lib/types';

function shortPath(p: string) {
  return p.replace(/\\/g, '/').split('/').slice(-2).join('/');
}

function timeAgo(iso: string | null) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function FreshnessBadge({ stale }: { stale: boolean | null }) {
  if (stale === null)
    return <span className="q-chip border text-[9px]" style={{ borderColor: '#21262d', color: '#8b949e' }}>NO GIT</span>;
  return stale ? (
    <span className="q-chip border text-[9px]" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>STALE</span>
  ) : (
    <span className="q-chip border text-[9px]" style={{ borderColor: '#22d3a5', color: '#22d3a5' }}>FRESH</span>
  );
}

interface Props { graphs: CodeGraphSummary[]; }

export default function CodeGraphPanel({ graphs }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="flex flex-col h-full bg-q-surface">
      {/* Header */}
      <div className="px-4 py-3 border-b border-q-border shrink-0 flex items-center gap-2">
        <span className="text-xs font-bold text-q-text tracking-widest">CODE KNOWLEDGE GRAPHS</span>
        <span className="ml-auto text-[10px] text-q-muted">
          {graphs.length} project{graphs.length === 1 ? '' : 's'} graphified
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {graphs.length === 0 && (
          <div className="text-[11px] text-q-muted p-4">
            No graphify graphs found. Run <code className="text-cyan-400">graphify update .</code> inside
            a project to build one — it will appear here on the next reindex.
          </div>
        )}

        {graphs.map(g => {
          const open = expanded.has(g.path);
          return (
            <div key={g.path} className="border border-q-border rounded bg-zinc-900/40">
              {/* Card header */}
              <button onClick={() => toggle(g.path)} className="w-full text-left px-3 py-2 flex items-center gap-2">
                <span className="text-[12px] font-bold text-q-text">{g.project}</span>
                <FreshnessBadge stale={g.stale} />
                <span className="ml-auto text-[9px] text-q-muted">{timeAgo(g.updatedAt)}</span>
                <span className="text-q-muted text-[10px]">{open ? '▾' : '▸'}</span>
              </button>

              {/* Stats row */}
              <div className="px-3 pb-2 flex gap-4 text-[10px] text-q-muted">
                <span><b className="text-cyan-400">{g.nodes.toLocaleString()}</b> nodes</span>
                <span><b className="text-cyan-400">{g.edges.toLocaleString()}</b> edges</span>
                <span><b className="text-purple-400">{g.communities}</b> communities</span>
                <span><b className="text-amber-400">{g.inferredEdges}</b> inferred</span>
                {g.builtAtCommit && (
                  <span className="ml-auto font-mono">
                    @{g.builtAtCommit}
                    {g.stale && g.currentCommit ? ` → HEAD ${g.currentCommit}` : ''}
                  </span>
                )}
              </div>

              {/* Expanded: god nodes */}
              {open && (
                <div className="px-3 pb-3 border-t border-q-border pt-2">
                  <div className="text-[9px] text-q-muted tracking-widest mb-1.5">
                    GOD NODES — CORE ABSTRACTIONS
                  </div>
                  <div className="space-y-1">
                    {g.godNodes.map((n, i) => (
                      <div key={`${n.label}-${i}`} className="flex items-center gap-2 text-[10px]">
                        <span className="text-q-muted w-4 text-right">{i + 1}</span>
                        <span className="text-q-text font-mono">{n.label}</span>
                        <span className="text-cyan-400">{n.degree} edges</span>
                        {n.file && <span className="ml-auto text-q-muted truncate max-w-[45%]">{shortPath(n.file)}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[9px] text-q-muted font-mono truncate">{g.path}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
