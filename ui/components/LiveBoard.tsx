'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type {
  AgentSessionRollup, AgentSessionsData, SpendData,
  AgentEvent, AgentEventsData, AgentType,
} from '@/lib/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const AGENT_TYPE_COLOR: Record<string, string> = {
  'claude-code': '#00d4ff',
  gemini:        '#9333ea',
  hermes:        '#f59e0b',
  human:         '#22d3a5',
};

const AGENT_TYPE_LABEL: Record<string, string> = {
  'claude-code': 'CLAUDE CODE',
  gemini:        'GEMINI',
  hermes:        'HERMES',
  human:         'HUMAN',
};

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function basename(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() || p;
}

function timeAgo(ts: string | number): string {
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diff = Date.now() - t;
  if (!Number.isFinite(diff)) return '—';
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

interface LaneData {
  agentId: string;
  agentType: AgentType;
  active: boolean;
  liveSession?: AgentSessionRollup;
  lastEndTime?: string | null;
  lifetimeCost: number;
  lifetimeTokensIn: number | null;
  lifetimeTokensOut: number | null;
  lastError?: string;
}

export default function LiveBoard() {
  const { data: sessionsData } = useSWR<AgentSessionsData>('/api/agent-sessions', fetcher, { refreshInterval: 2000 });
  const { data: eventsData }   = useSWR<AgentEventsData>('/api/agent-events?n=100', fetcher, { refreshInterval: 2000 });
  const { data: spendData }    = useSWR<SpendData>('/api/spend', fetcher, { refreshInterval: 5000 });

  // Tick every second so durations / relative times stay live without waiting on SWR.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const events   = eventsData?.events ?? [];
  const sessions = sessionsData?.sessions ?? [];
  const live     = sessionsData?.live ?? [];
  const byAgent  = spendData?.byAgent ?? {};

  const lanes = useMemo<LaneData[]>(() => {
    const ids = new Set<string>([
      ...Object.keys(byAgent),
      ...live.map(s => s.agentId),
      ...sessions.map(s => s.agentId),
    ]);

    return Array.from(ids).map(agentId => {
      const liveSession   = live.find(s => s.agentId === agentId);
      const agentSessions = sessions.filter(s => s.agentId === agentId);
      const agentType: AgentType = liveSession?.agentType ?? agentSessions[0]?.agentType ?? 'human';

      // ACTIVE = has a live session with an event in the last 5 min.
      let active = false;
      if (liveSession) {
        const recentEvent = events.find(e =>
          e.agentId === agentId && Date.now() - new Date(e.timestamp).getTime() < ACTIVE_WINDOW_MS
        );
        active = !!recentEvent || Date.now() - new Date(liveSession.startTime).getTime() < ACTIVE_WINDOW_MS;
      }

      const lastEndTime = agentSessions
        .map(s => s.endTime)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] ?? null;

      const bucket = byAgent[agentId];
      const lastErrorEvent = [...events].reverse().find(e => e.agentId === agentId && e.eventType === 'error');

      return {
        agentId,
        agentType,
        active,
        liveSession,
        lastEndTime,
        lifetimeCost: bucket?.costUsd ?? 0,
        lifetimeTokensIn: bucket?.tokensIn ?? null,
        lifetimeTokensOut: bucket?.tokensOut ?? null,
        lastError: lastErrorEvent?.metadata?.error,
      };
    }).sort((a, b) => Number(b.active) - Number(a.active) || a.agentId.localeCompare(b.agentId));
  }, [byAgent, live, sessions, events]);

  return (
    <div className="flex flex-col h-full bg-q-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-q-border shrink-0 flex items-center gap-3">
        <span className="text-xs font-bold text-q-text tracking-widest">LIVE</span>
        <span className="q-chip bg-q-green/10 text-q-green">{lanes.filter(l => l.active).length} active</span>
        <span className="q-chip bg-q-surface text-q-muted">{lanes.length} agents</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {lanes.length === 0 && (
          <div className="flex items-center justify-center h-32 text-q-dim text-xs">
            No agent activity yet — run the engine to start collecting telemetry.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {lanes.map(lane => <Lane key={lane.agentId} lane={lane} />)}
        </div>
      </div>

      <div className="shrink-0 border-t border-q-border" style={{ height: '40%' }}>
        <LiveEventFeed events={events} />
      </div>
    </div>
  );
}

function Lane({ lane }: { lane: LaneData }) {
  const color = AGENT_TYPE_COLOR[lane.agentType] || '#8b949e';
  const s = lane.liveSession;

  return (
    <div className="q-panel p-3 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${lane.active ? 'animate-pulse' : ''}`}
          style={{
            background: lane.active ? '#22d3a5' : '#3d444d',
            boxShadow: lane.active ? '0 0 8px rgba(34,211,165,0.6)' : 'none',
          }}
        />
        <span className="text-xs font-bold truncate" style={{ color }}>{lane.agentId}</span>
        <span className="q-chip shrink-0" style={{ background: color + '22', color }}>
          {AGENT_TYPE_LABEL[lane.agentType] || lane.agentType}
        </span>
        <span className={`ml-auto shrink-0 text-[9px] tracking-widest ${lane.active ? 'text-q-green' : 'text-q-dim'}`}>
          {lane.active ? 'ACTIVE' : 'IDLE'}
        </span>
      </div>

      {lane.active && s ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="q-chip bg-q-purple/20 text-purple-300 truncate max-w-[140px]">{s.project}</span>
            <span className="ml-auto text-q-muted shrink-0">{fmtDuration(Date.now() - new Date(s.startTime).getTime())}</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-q-muted flex-wrap">
            <span>cost <span className="text-q-amber font-semibold">{fmtCost(s.estimatedCostUsd)}</span>
              {s.tokensEstimated && <span className="text-q-dim"> ~est</span>}
            </span>
            <span>in <span className="text-q-text">{fmtTokens(s.tokensIn)}</span></span>
            <span>out <span className="text-q-text">{fmtTokens(s.tokensOut)}</span></span>
          </div>
          {s.filesChanged?.length > 0 && (
            <div className="text-[9px] text-q-dim truncate" title={s.filesChanged.slice(-5).join(', ')}>
              {s.filesChanged.slice(-5).map(basename).join(', ')}
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px]">
            <span className={s.errorCount > 0 ? 'text-q-red font-bold' : 'text-q-dim'}>
              {s.errorCount} error{s.errorCount === 1 ? '' : 's'}
            </span>
          </div>
          {lane.lastError && (
            <div className="text-[9px] text-q-red truncate" title={lane.lastError}>
              ⚠ {lane.lastError.slice(0, 90)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1 text-[10px] text-q-muted">
          <div>last active <span className="text-q-text">{lane.lastEndTime ? timeAgo(lane.lastEndTime) : '—'}</span></div>
          <div>lifetime cost <span className="text-q-amber font-semibold">{fmtCost(lane.lifetimeCost)}</span></div>
          <div>
            lifetime tokens{' '}
            <span className="text-q-text">{fmtTokens(lane.lifetimeTokensIn)}</span> in /{' '}
            <span className="text-q-text">{fmtTokens(lane.lifetimeTokensOut)}</span> out
          </div>
        </div>
      )}
    </div>
  );
}

function LiveEventFeed({ events }: { events: AgentEvent[] }) {
  const ordered = [...events].reverse(); // newest-first

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-q-border shrink-0">
        <span className="w-2 h-2 rounded-full bg-q-green animate-blink" />
        <span className="text-[10px] font-bold text-q-text tracking-widest">EVENT FEED</span>
        <span className="ml-auto text-[9px] text-q-dim">{events.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {ordered.length === 0 && (
          <div className="flex items-center justify-center h-20 text-q-dim text-[10px]">No events yet.</div>
        )}
        {ordered.map((e, i) => {
          const color = AGENT_TYPE_COLOR[e.agentType] || '#8b949e';
          const key = `${e.timestamp}|${e.sessionId}|${e.eventType}|${i}`;
          return (
            <div key={key} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded bg-q-bg/40">
              <span className="text-q-dim shrink-0 w-16">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="q-chip shrink-0" style={{ background: color + '22', color }}>{e.agentType}</span>
              <span className="text-q-text shrink-0">{e.eventType}</span>
              <span className="text-q-muted truncate">{e.project}</span>
              {e.metadata?.tool && <span className="text-q-cyan text-[9px] shrink-0">tool:{e.metadata.tool}</span>}
              {e.metadata?.skill && <span className="text-purple-300 text-[9px] shrink-0">skill:{e.metadata.skill}</span>}
              {e.metadata?.kind && !e.metadata?.tool && !e.metadata?.skill && (
                <span className="text-q-dim text-[9px] shrink-0">{e.metadata.kind}</span>
              )}
              {e.eventType === 'session_end' && e.estimatedCostUsd != null && (
                <span className="ml-auto text-q-amber text-[9px] shrink-0">{fmtCost(e.estimatedCostUsd)}</span>
              )}
              {e.eventType === 'error' && e.metadata?.error && (
                <span className="ml-auto text-q-red text-[9px] truncate max-w-[220px]">{e.metadata.error}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
