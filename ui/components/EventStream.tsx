'use client';

import { useEffect, useRef, useState } from 'react';
import type { SemanticEvent } from '@/lib/types';

const TYPE_STYLE: Record<string, { glyph: string; cls: string; color: string }> = {
  file_added:   { glyph: '+', cls: 'event-added',   color: '#22d3a5' },
  file_changed: { glyph: '~', cls: 'event-changed', color: '#f59e0b' },
  file_deleted: { glyph: '−', cls: 'event-deleted', color: '#f43f5e' },
};

const IMPACT_COLOR: Record<string, string> = {
  high:   '#f43f5e',
  medium: '#f59e0b',
  low:    '#3d444d',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function shortPath(p: string, n = 2) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.slice(-n).join('/');
}

interface Props {
  events: SemanticEvent[];
  fullScreen?: boolean;
}

export default function EventStream({ events, fullScreen }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter]   = useState<string>('');
  const [paused, setPaused]   = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-scroll to bottom unless paused
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, paused]);

  const filtered = events.filter(e => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return e.path?.toLowerCase().includes(q)
      || e.type?.includes(q)
      || e.semantic?.project?.toLowerCase().includes(q)
      || e.semantic?.intent?.toLowerCase().includes(q);
  });

  const toggleExpand = (key: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div className={`flex flex-col h-full ${fullScreen ? '' : 'border-l border-q-border'} bg-q-surface`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-q-border shrink-0">
        <span className="w-2 h-2 rounded-full bg-q-green animate-blink" />
        <span className="text-xs font-bold text-q-text tracking-widest">LIVE EVENTS</span>
        <span className="ml-auto text-[10px] text-q-muted">{filtered.length}</span>
        <button
          onClick={() => setPaused(p => !p)}
          className={`text-[10px] px-2 py-0.5 rounded border ${paused ? 'border-q-amber text-q-amber' : 'border-q-border text-q-muted hover:border-q-cyan hover:text-q-cyan'}`}
        >{paused ? 'RESUME' : 'PAUSE'}</button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-q-border shrink-0">
        <input
          className="w-full bg-q-bg border border-q-border rounded px-2 py-1 text-xs text-q-text placeholder-q-dim focus:outline-none focus:border-q-cyan"
          placeholder="filter events..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {filtered.slice(-200).map((evt, i) => {
          const style = TYPE_STYLE[evt.type] || { glyph: '?', cls: '', color: '#8b949e' };
          const key   = `${evt.path}|${evt.timestamp}|${i}`;
          const isExp = expanded.has(key);
          const sem   = evt.semantic;

          return (
            <div
              key={key}
              className={`${style.cls} rounded-r bg-q-bg/60 px-2 py-1.5 cursor-pointer hover:bg-q-raised transition-colors text-[11px]`}
              onClick={() => toggleExpand(key)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold shrink-0 w-4 text-center" style={{ color: style.color }}>{style.glyph}</span>
                <span className="text-q-text font-semibold truncate">{shortPath(evt.path)}</span>
                <span className="ml-auto shrink-0 text-q-dim text-[9px]">{timeAgo(evt.timestamp)}</span>
              </div>

              {sem && (
                <div className="flex items-center gap-1.5 mt-0.5 ml-6">
                  {sem.impact && (
                    <span className="q-chip" style={{ background: IMPACT_COLOR[sem.impact] + '22', color: IMPACT_COLOR[sem.impact] }}>
                      {sem.impact}
                    </span>
                  )}
                  {sem.project && (
                    <span className="q-chip bg-q-purple/20 text-purple-300">{sem.project}</span>
                  )}
                  {sem.confidence != null && (
                    <span className="text-q-dim text-[9px]">{Math.round(sem.confidence * 100)}%</span>
                  )}
                </div>
              )}

              {isExp && sem && (
                <div className="mt-1.5 ml-6 space-y-0.5 text-q-muted text-[10px] border-t border-q-border pt-1.5">
                  <div><span className="text-q-dim">intent  </span>{sem.intent}</div>
                  <div><span className="text-q-dim">category</span> {sem.category}</div>
                  <div><span className="text-q-dim">signals </span>{sem.signals?.join(', ') || '—'}</div>
                  <div className="text-[9px] text-q-dim break-all">{evt.path}</div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Footer count */}
      <div className="shrink-0 px-3 py-1.5 border-t border-q-border text-[10px] text-q-dim flex gap-3">
        <span style={{ color: '#22d3a5' }}>+{events.filter(e => e.type === 'file_added').length}</span>
        <span style={{ color: '#f59e0b' }}>~{events.filter(e => e.type === 'file_changed').length}</span>
        <span style={{ color: '#f43f5e' }}>−{events.filter(e => e.type === 'file_deleted').length}</span>
        <span className="ml-auto">showing {Math.min(filtered.length, 200)} of {events.length}</span>
      </div>
    </div>
  );
}
