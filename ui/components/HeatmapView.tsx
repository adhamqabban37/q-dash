'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { HeatmapData } from '@/lib/types';

const CYAN   = '#00d4ff';
const PURPLE = '#9333ea';
const GREEN  = '#22d3a5';
const AMBER  = '#f59e0b';

function shortName(p: string, n = 1) {
  return p.replace(/\\/g, '/').split('/').slice(-n).join('/');
}

const CustomTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-q-raised border border-q-border rounded px-2 py-1 text-[10px] text-q-text">
      <div className="text-q-muted">{label}</div>
      <div style={{ color: CYAN }}>{payload[0]?.value} events</div>
    </div>
  );
};

interface Props { data: HeatmapData | null; }

export default function HeatmapView({ data }: Props) {
  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-q-dim text-xs">
        No heatmap data yet. Run the engine to collect data.
      </div>
    );
  }

  const maxFileCount = data.hotFiles?.[0]?.count || 1;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Summary pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Events"  value={data.totalEvents} color={CYAN} />
        <StatCard label="Unique Files"  value={data.hotFiles?.length || 0} color={GREEN} />
        <StatCard label="Projects"      value={data.hotProjects?.length || 0} color={PURPLE} />
        <StatCard label="Peak Hour"     value={`${data.peakHour}:00`} color={AMBER} />
      </div>

      {/* Activity curve */}
      <Section title="ACTIVITY CURVE (24H)">
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data.activityCurve || []}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={CYAN} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CYAN} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#8b949e' }}
              tickFormatter={h => `${h}h`} interval={3} />
            <YAxis tick={{ fontSize: 9, fill: '#8b949e' }} />
            <Tooltip content={<CustomTip />} />
            <Area type="monotone" dataKey="count" stroke={CYAN} strokeWidth={1.5}
              fill="url(#cg)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* Weekday curve */}
      {data.weekdayCurve && (
        <Section title="WEEKDAY BREAKDOWN">
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={data.weekdayCurve}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#8b949e' }} />
              <YAxis tick={{ fontSize: 9, fill: '#8b949e' }} />
              <Tooltip content={<CustomTip />} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {data.weekdayCurve.map((_, i) => (
                  <Cell key={i} fill={i === new Date().getDay() ? CYAN : '#21262d'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Hot projects */}
      {data.hotProjects?.length > 0 && (
        <Section title="HOT PROJECTS">
          <ResponsiveContainer width="100%" height={Math.min(data.hotProjects.length * 32, 200)}>
            <BarChart data={data.hotProjects} layout="vertical"
              margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 9, fill: '#8b949e' }} />
              <YAxis type="category" dataKey="name" width={120}
                tick={{ fontSize: 9, fill: '#e6edf3' }}
                tickFormatter={n => n.length > 16 ? n.slice(0, 16) + '…' : n} />
              <Tooltip content={<CustomTip />} />
              <Bar dataKey="count" fill={PURPLE} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Hot skills */}
      {data.hotSkills?.length > 0 && (
        <Section title="ACTIVE SKILLS">
          <div className="space-y-1.5">
            {data.hotSkills.slice(0, 10).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-q-muted w-28 truncate">{s.name}</span>
                <div className="flex-1 h-1.5 bg-q-border rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${(s.count / (data.hotSkills[0]?.count || 1)) * 100}%`, background: CYAN }} />
                </div>
                <span className="text-[9px] text-q-muted w-6 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hot files table */}
      {data.hotFiles?.length > 0 && (
        <Section title="MOST EDITED FILES">
          <div className="space-y-1">
            {data.hotFiles.slice(0, 15).map((f, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-[9px] text-q-dim w-5 shrink-0 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="h-1 bg-q-border rounded overflow-hidden">
                    <div className="h-full rounded" style={{
                      width: `${(f.count / maxFileCount) * 100}%`,
                      background: i === 0 ? GREEN : '#21262d',
                    }} />
                  </div>
                </div>
                <span className="text-[10px] text-q-text truncate max-w-[140px]">{f.name}</span>
                <span className="text-[9px] text-q-muted shrink-0">{f.count}×</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hot directories */}
      {data.hotDirectories?.length > 0 && (
        <Section title="SYSTEM HOTSPOTS">
          <div className="space-y-1">
            {data.hotDirectories.slice(0, 8).map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="text-q-dim w-5 shrink-0 text-right">{d.count}</span>
                <span className="text-q-muted truncate">{shortName(d.path, 3)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="q-panel p-3 text-center">
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
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
