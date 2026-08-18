'use client';

import type { StatusData } from '@/lib/types';

function Metric({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-q-border/40 last:border-0">
      <span className="text-[10px] text-q-muted">{label}</span>
      <span className="text-[10px] font-mono" style={color ? { color } : { color: '#e6edf3' }}>{value}</span>
    </div>
  );
}

function SectionHead({ label }: { label: string }) {
  return <div className="text-[9px] text-q-dim tracking-widest mt-3 mb-1 first:mt-0">{label}</div>;
}

export default function StatusPanel({ status }: { status: StatusData | null }) {
  if (!status) {
    return (
      <div className="q-panel p-4 text-q-dim text-xs text-center animate-pulse">
        AWAITING ENGINE...
      </div>
    );
  }

  const lastIdx = status.lastIndexed
    ? new Date(status.lastIndexed).toLocaleTimeString()
    : '—';
  const lastGph = status.lastGraph
    ? new Date(status.lastGraph).toLocaleTimeString()
    : '—';

  return (
    <div className="q-panel p-4 text-xs">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-q-green animate-pulse-slow" />
        <span className="font-bold text-q-text tracking-widest text-[10px]">SYSTEM STATUS</span>
      </div>

      <SectionHead label="INDEX" />
      <Metric label="Total Files"   value={status.totalFiles}   color="#00d4ff" />
      <Metric label="Graph Nodes"   value={status.graphNodes}   color="#9333ea" />
      <Metric label="Graph Edges"   value={status.graphEdges}   color="#9333ea" />
      <Metric label="Last Indexed"  value={lastIdx} />
      <Metric label="Last Graph"    value={lastGph} />

      <SectionHead label="EVENTS" />
      <Metric label="Raw Events"    value={status.totalEvents}    color="#f59e0b" />
      <Metric label="Semantic"      value={status.semanticEvents} color="#22d3a5" />
      <Metric label="Heatmap Evts"  value={status.heatmapEvents} />

      <SectionHead label="DETECTED" />
      <Metric label="Skills"    value={`${status.skills} · ${status.projects + status.agents + status.apis + (status.totalFiles - status.skills - status.projects - status.agents - status.apis)} other`}   color="#00d4ff" />
      <Metric label="Agents"    value={status.agents}   color="#22d3a5" />
      <Metric label="Projects"  value={status.projects} color="#9333ea" />
      <Metric label="API Files" value={status.apis}     color="#f59e0b" />
    </div>
  );
}
