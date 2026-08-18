'use client';

import { useState } from 'react';
import type { Insight } from '@/lib/types';

const TYPE_CONFIG = {
  trend:   { label: 'TREND',   color: '#00d4ff', bg: 'rgba(0,212,255,0.08)'  },
  summary: { label: 'SUMMARY', color: '#22d3a5', bg: 'rgba(34,211,165,0.08)' },
  anomaly: { label: 'ANOMALY', color: '#f43f5e', bg: 'rgba(244,63,94,0.08)'  },
};

const CAT_COLOR: Record<string, string> = {
  project: '#9333ea',
  skill:   '#00d4ff',
  session: '#22d3a5',
  system:  '#f59e0b',
};

function shortPath(p: string) {
  return p.replace(/\\/g, '/').split('/').slice(-2).join('/');
}

interface Props { insights: Insight[]; }

export default function InsightPanel({ insights }: Props) {
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = insights.filter(i =>
    (!catFilter  || i.category === catFilter) &&
    (!typeFilter || i.type     === typeFilter)
  );

  const cats  = ['project', 'skill', 'session', 'system'];
  const types = ['trend', 'summary', 'anomaly'] as const;

  return (
    <div className="flex flex-col h-full bg-q-surface">
      {/* Header */}
      <div className="px-4 py-3 border-b border-q-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-q-text tracking-widest">SYSTEM INTELLIGENCE</span>
          <span className="ml-auto text-[10px] text-q-muted">{filtered.length} insights</span>
        </div>
        {/* Filters */}
        <div className="flex gap-1 flex-wrap">
          {types.map(t => {
            const cfg = TYPE_CONFIG[t];
            return (
              <button key={t} onClick={() => setTypeFilter(prev => prev === t ? '' : t)}
                className="q-chip border text-[9px]"
                style={{ borderColor: typeFilter === t ? cfg.color : '#21262d', color: typeFilter === t ? cfg.color : '#8b949e' }}>
                {cfg.label}
              </button>
            );
          })}
          <span className="w-px bg-q-border mx-1" />
          {cats.map(c => (
            <button key={c} onClick={() => setCatFilter(prev => prev === c ? '' : c)}
              className="q-chip border text-[9px]"
              style={{ borderColor: catFilter === c ? CAT_COLOR[c] : '#21262d', color: catFilter === c ? CAT_COLOR[c] : '#8b949e' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-q-dim text-xs">
            No insights yet — run the engine to generate insights.
          </div>
        )}

        {filtered.map(ins => {
          const cfg = TYPE_CONFIG[ins.type] || TYPE_CONFIG.summary;
          const isExp = expanded.has(ins.id);
          const conf  = Math.round(ins.confidence * 100);

          return (
            <div key={ins.id}
              className="q-panel p-3 cursor-pointer hover:border-q-raised transition-all animate-fade-in"
              style={{ borderLeft: `3px solid ${cfg.color}` }}
              onClick={() => toggle(ins.id)}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <span className="q-chip text-[9px] shrink-0"
                  style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                <span className="q-chip text-[9px]"
                  style={{ color: CAT_COLOR[ins.category] || '#8b949e' }}>{ins.category}</span>
                <span className="ml-auto text-[9px] text-q-muted shrink-0">
                  {new Date(ins.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <p className="text-xs text-q-text leading-relaxed">{ins.message}</p>

              {/* Confidence bar */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1 bg-q-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${conf}%`, background: cfg.color }} />
                </div>
                <span className="text-[9px] text-q-muted w-8 text-right">{conf}%</span>
              </div>

              {/* Expanded: supporting events */}
              {isExp && ins.supportingEvents.length > 0 && (
                <div className="mt-2 pt-2 border-t border-q-border space-y-0.5">
                  <div className="text-[9px] text-q-dim mb-1 tracking-widest">SUPPORTING EVIDENCE</div>
                  {ins.supportingEvents.map((p, idx) => (
                    <div key={idx} className="text-[10px] text-q-muted truncate">
                      <span className="text-q-dim mr-1">↳</span>{shortPath(p)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
