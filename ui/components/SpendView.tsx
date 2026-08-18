'use client';

import useSWR from 'swr';
import type { SpendData, SpendBucket, AgentSessionsData, AgentSessionRollup } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const AGENT_TYPE_COLOR: Record<string, string> = {
  'claude-code': '#00d4ff',
  gemini:        '#9333ea',
  hermes:        '#f59e0b',
  human:         '#22d3a5',
};

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortSessionId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

export default function SpendView() {
  const { data: spend } = useSWR<SpendData>('/api/spend', fetcher, { refreshInterval: 5000 });
  const { data: sessionsData } = useSWR<AgentSessionsData>('/api/agent-sessions', fetcher, { refreshInterval: 5000 });

  if (!spend) {
    return (
      <div className="flex items-center justify-center h-full text-q-dim text-xs animate-pulse tracking-widest">
        LOADING SPEND DATA...
      </div>
    );
  }

  const byDay  = spend.byDay ?? {};
  const dayKeys = Object.keys(byDay).sort().slice(-14);
  const byWeek = spend.byWeek ?? {};
  const weekKeys = Object.keys(byWeek).sort().slice(-8);

  const maxDayCost = Math.max(1, ...dayKeys.map(d => byDay[d]?.costUsd ?? 0));

  const byAgentRows: [string, SpendBucket][] = Object.entries(spend.byAgent ?? {})
    .sort((a, b) => (b[1].costUsd ?? 0) - (a[1].costUsd ?? 0));
  const byProjectRows: [string, SpendBucket][] = Object.entries(spend.byProject ?? {})
    .sort((a, b) => (b[1].costUsd ?? 0) - (a[1].costUsd ?? 0));

  const allSessions: AgentSessionRollup[] = [
    ...(sessionsData?.sessions ?? []),
    ...(sessionsData?.live ?? []),
  ];
  const topSessions = [...allSessions]
    .sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0))
    .slice(0, 10);

  const activeDays = dayKeys.filter(d => (byDay[d]?.events ?? 0) > 0).length;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Lifetime Cost" value={fmtCost(spend.totals?.costUsd)} color="#f59e0b" />
        <StatCard label="Lifetime Tokens" value={`${fmtTokens(spend.totals?.tokensIn)} in / ${fmtTokens(spend.totals?.tokensOut)} out`} color="#00d4ff" />
        <StatCard label="Active Days" value={activeDays} color="#22d3a5" />
        <StatCard label="Timezone" value={spend.timezone || '—'} color="#9333ea" />
      </div>

      {/* Daily cost bar chart */}
      <Section title="DAILY COST (LAST 14 DAYS)">
        {dayKeys.length === 0 ? (
          <div className="text-q-dim text-xs py-6 text-center">No daily spend recorded yet.</div>
        ) : (
          <div className="flex items-end gap-1.5 h-40">
            {dayKeys.map(d => {
              const bucket = byDay[d];
              const total = bucket?.costUsd ?? 0;
              const heightPct = total > 0 ? Math.max((total / maxDayCost) * 100, 2) : 0;
              const agents = Object.entries(bucket?.byAgent ?? {});
              return (
                <div key={d} className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end group">
                  <div
                    className="w-full rounded-t overflow-hidden flex flex-col-reverse"
                    style={{ height: `${heightPct}%` }}
                    title={`${d}: ${fmtCost(total)}`}
                  >
                    {agents.length > 0 ? agents.map(([agentId, b]) => (
                      <div
                        key={agentId}
                        style={{
                          height: `${((b.costUsd ?? 0) / (total || 1)) * 100}%`,
                          background: AGENT_TYPE_COLOR[agentId] || '#00d4ff',
                        }}
                        title={`${d} · ${agentId}: ${fmtCost(b.costUsd)}`}
                      />
                    )) : (
                      <div className="h-full" style={{ background: '#21262d' }} />
                    )}
                  </div>
                  <span className="text-[8px] text-q-dim whitespace-nowrap">{d.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Weekly rollup */}
      <Section title="WEEKLY ROLLUP (LAST 8 WEEKS)">
        {weekKeys.length === 0 ? (
          <div className="text-q-dim text-xs py-4 text-center">No weekly spend recorded yet.</div>
        ) : (
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {weekKeys.map(w => (
              <div key={w} className="q-panel p-2 text-center">
                <div className="text-[9px] text-q-dim truncate">{w}</div>
                <div className="text-xs font-bold text-q-amber">{fmtCost(byWeek[w]?.costUsd)}</div>
                <div className="text-[9px] text-q-muted">{byWeek[w]?.events ?? 0} evts</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Breakdown tables */}
      <Section title="BY AGENT">
        <BreakdownTable rows={byAgentRows} />
      </Section>

      <Section title="BY PROJECT">
        <BreakdownTable rows={byProjectRows} />
      </Section>

      {/* Most expensive sessions */}
      <Section title="MOST EXPENSIVE SESSIONS">
        {topSessions.length === 0 ? (
          <div className="text-q-dim text-xs py-4 text-center">No sessions recorded yet.</div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[90px_1fr_1fr_60px_110px_80px] gap-2 text-[9px] text-q-dim tracking-widest px-1 pb-1 border-b border-q-border/40">
              <span>SESSION</span><span>AGENT</span><span>PROJECT</span><span>DUR</span><span>TOKENS</span><span>COST</span>
            </div>
            {topSessions.map(s => (
              <div
                key={s.sessionId}
                className="grid grid-cols-[90px_1fr_1fr_60px_110px_80px] gap-2 text-[10px] items-center px-1 py-1 hover:bg-q-raised/30 rounded"
              >
                <span className="text-q-cyan font-mono truncate" title={s.sessionId}>{shortSessionId(s.sessionId)}</span>
                <span className="truncate" style={{ color: AGENT_TYPE_COLOR[s.agentType] || '#8b949e' }}>{s.agentId}</span>
                <span className="text-q-muted truncate">{s.project}</span>
                <span className="text-q-muted">{fmtDurationMs(s.durationMs)}</span>
                <span className="text-q-muted">{fmtTokens(s.tokensIn)} / {fmtTokens(s.tokensOut)}</span>
                <span className="text-q-amber font-semibold">
                  {fmtCost(s.estimatedCostUsd)}
                  {s.tokensEstimated && <span className="text-q-dim ml-1 font-normal">~est</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: [string, SpendBucket][] }) {
  if (rows.length === 0) {
    return <div className="text-q-dim text-xs py-4 text-center">No data yet.</div>;
  }
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_60px_80px_80px_70px_70px] gap-2 text-[9px] text-q-dim tracking-widest px-1 pb-1 border-b border-q-border/40">
        <span>NAME</span><span>EVENTS</span><span>TOKENS IN</span><span>TOKENS OUT</span><span>TIME</span><span>COST</span>
      </div>
      {rows.map(([name, b]) => (
        <div key={name} className="grid grid-cols-[1fr_60px_80px_80px_70px_70px] gap-2 text-[10px] items-center px-1 py-1 hover:bg-q-raised/30 rounded">
          <span className="truncate" style={{ color: AGENT_TYPE_COLOR[name] || '#e6edf3' }}>{name}</span>
          <span className="text-q-muted">{b.events ?? 0}</span>
          <span className="text-q-muted">{fmtTokens(b.tokensIn)}</span>
          <span className="text-q-muted">{fmtTokens(b.tokensOut)}</span>
          <span className="text-q-muted">{fmtDurationMs(b.durationMs)}</span>
          <span className="text-q-amber font-semibold">{fmtCost(b.costUsd)}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="q-panel p-3 text-center">
      <div className="text-lg font-bold truncate" style={{ color }}>{value}</div>
      <div className="text-[9px] text-q-muted tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-q-muted tracking-widest mb-2">{title}</div>
      <div className="q-panel p-3">{children}</div>
    </div>
  );
}
