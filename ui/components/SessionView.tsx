'use client';

import { useState } from 'react';
import type { Session } from '@/lib/types';

const ACTIVITY_CONFIG: Record<string, { icon: string; color: string }> = {
  coding:   { icon: '⟨/⟩', color: '#00d4ff' },
  config:   { icon: '⚙',   color: '#f59e0b' },
  research: { icon: '◎',   color: '#3b82f6' },
  refactor: { icon: '↻',   color: '#9333ea' },
  cleanup:  { icon: '✕',   color: '#f43f5e' },
  mixed:    { icon: '≋',   color: '#8b949e' },
};

function fmtDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function shortPath(p: string) {
  return p.replace(/\\/g, '/').split('/').slice(-1)[0] || p;
}

interface Props { sessions: Session[]; }

export default function SessionView({ sessions }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalEvents = sessions.reduce((a, s) => a + s.eventCount, 0);

  return (
    <div className="flex flex-col h-full bg-q-surface">
      {/* Header */}
      <div className="px-4 py-3 border-b border-q-border shrink-0 flex items-center gap-3">
        <span className="text-xs font-bold text-q-text tracking-widest">WORKFLOW SESSIONS</span>
        <span className="q-chip bg-q-cyan/10 text-q-cyan">{sessions.length} sessions</span>
        <span className="q-chip bg-q-surface text-q-muted">{totalEvents} events</span>
      </div>

      {/* Session grid */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sessions.length === 0 && (
          <div className="flex items-center justify-center h-32 text-q-dim text-xs">
            No sessions yet — activity will be grouped automatically.
          </div>
        )}

        {sessions.map(s => {
          const cfg   = ACTIVITY_CONFIG[s.activityType] || ACTIVITY_CONFIG.mixed;
          const isExp = expanded.has(s.sessionId);
          const { high, medium, low } = s.impactSummary;
          const total = high + medium + low || 1;

          return (
            <div key={s.sessionId}
              className="q-panel p-3 cursor-pointer hover:border-q-raised transition-all animate-fade-in"
              onClick={() => toggle(s.sessionId)}
            >
              {/* Top row */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base" style={{ color: cfg.color }}>{cfg.icon}</span>
                <div>
                  <div className="text-xs font-semibold text-q-text" style={{ color: cfg.color }}>
                    {s.activityType.toUpperCase()}
                  </div>
                  <div className="text-[9px] text-q-muted">{fmtDuration(s.durationSeconds)}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[9px] text-q-muted">{new Date(s.startTime).toLocaleTimeString()}</div>
                  <div className="text-[9px] text-q-dim">→ {new Date(s.endTime).toLocaleTimeString()}</div>
                </div>
              </div>

              {/* Project + event count */}
              <div className="flex items-center gap-2 mb-2">
                {s.dominantProject && (
                  <span className="q-chip bg-q-purple/20 text-purple-300 text-[9px]">{s.dominantProject}</span>
                )}
                {s.dominantSkill && (
                  <span className="q-chip bg-q-cyan/10 text-q-cyan text-[9px]">skill:{s.dominantSkill}</span>
                )}
                <span className="text-[9px] text-q-dim ml-auto">{s.eventCount} events</span>
              </div>

              {/* Impact bar */}
              <div className="flex h-1.5 rounded overflow-hidden gap-px">
                <div style={{ width: `${(high / total) * 100}%`, background: '#f43f5e' }} />
                <div style={{ width: `${(medium / total) * 100}%`, background: '#f59e0b' }} />
                <div style={{ width: `${(low / total) * 100}%`, background: '#21262d' }} />
              </div>
              <div className="flex gap-3 mt-0.5 text-[9px] text-q-dim">
                <span style={{ color: '#f43f5e' }}>{high} HIGH</span>
                <span style={{ color: '#f59e0b' }}>{medium} MED</span>
                <span>{low} LOW</span>
              </div>

              {/* Expanded: file list */}
              {isExp && s.filesChanged.length > 0 && (
                <div className="mt-2 pt-2 border-t border-q-border">
                  <div className="text-[9px] text-q-dim mb-1 tracking-widest">FILES TOUCHED</div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {s.filesChanged.slice(0, 30).map((f, idx) => (
                      <div key={idx} className="text-[10px] text-q-muted truncate">
                        <span className="text-q-dim mr-1">·</span>{shortPath(f)}
                      </div>
                    ))}
                    {s.filesChanged.length > 30 && (
                      <div className="text-[9px] text-q-dim">+ {s.filesChanged.length - 30} more</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
