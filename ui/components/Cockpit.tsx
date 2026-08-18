'use client';
import useSWR from 'swr';
import LiveFeed from './LiveFeed';
import SessionIndicators from './SessionIndicators';
import SkillTicker from './SkillTicker';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function Cockpit() {
  const { data: insights } = useSWR<any>('/api/insights', fetcher, { refreshInterval: 3000 });
  const { data: heatmap } = useSWR<any>('/api/heatmap', fetcher, { refreshInterval: 5000 });

  const top = (insights?.insights || []).slice(0, 5);
  const peakHour = heatmap?.peakHour ?? null;

  return (
    <div className="absolute inset-0 grid grid-rows-[1fr_1fr_auto] grid-cols-[1fr_320px] gap-2 p-2 bg-zinc-950 overflow-hidden">
      {/* Top-left: Live Feed (largest) */}
      <div className="row-span-2 col-span-1 min-h-0">
        <LiveFeed limit={120} />
      </div>

      {/* Top-right: Active Sessions */}
      <div className="row-span-1 col-span-1 min-h-0">
        <SessionIndicators />
      </div>

      {/* Middle-right: Skill Ticker */}
      <div className="row-span-1 col-span-1 min-h-0">
        <SkillTicker />
      </div>

      {/* Bottom: Top Insights + Stats */}
      <div className="row-span-1 col-span-2 bg-zinc-900 border border-zinc-800 rounded p-3 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-bold">TOP INSIGHTS</span>
          {peakHour !== null && (
            <span className="ml-auto text-[9px] uppercase tracking-widest text-zinc-500 font-mono">
              PEAK HOUR: {peakHour}:00 · {heatmap?.totalEvents || 0} total events
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {top.length === 0 ? (
            <div className="col-span-full text-zinc-600 text-[10px] uppercase tracking-widest py-4 text-center">
              Generating insights...
            </div>
          ) : top.map((i: any) => (
            <div key={i.id} className="bg-zinc-950/50 border border-zinc-800 rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  i.type === 'anomaly' ? 'bg-rose-950 text-rose-400' :
                  i.type === 'trend' ? 'bg-cyan-950 text-cyan-400' :
                  'bg-zinc-800 text-zinc-300'
                }`}>{i.type}</span>
                <span className="text-[9px] text-zinc-500 font-mono">{Math.round(i.confidence * 100)}%</span>
              </div>
              <div className="text-zinc-200 text-[11px] font-mono leading-tight">{i.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
