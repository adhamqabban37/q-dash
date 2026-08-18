'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function SkillTicker() {
  const { data } = useSWR<any>('/api/skill-stats', fetcher, { refreshInterval: 3000 });
  const skills: any[] = (data?.skills || []).filter((s: any) => s.invocationCount > 0).slice(0, 8);
  const dormant: any[] = (data?.skills || []).filter((s: any) => s.dormant).slice(0, 5);

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-zinc-800 bg-zinc-950/40">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-bold">SKILL TICKER</span>
        <span className="text-[9px] text-zinc-500 font-mono">({skills.length} active · {dormant.length} dormant)</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {skills.length === 0 && dormant.length === 0 && (
          <div className="text-zinc-600 text-center py-4 text-[10px] uppercase tracking-widest">
            No skill telemetry yet
          </div>
        )}
        {skills.map((s: any) => (
          <div key={s.name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/50">
            <span className="text-violet-400 font-mono text-[11px] flex-1 truncate">★ {s.name}</span>
            <span className="text-cyan-400 font-mono text-[10px]">×{s.invocationCount}</span>
            <span className="text-zinc-600 text-[9px] truncate w-16 text-right">{s.projects.length}p</span>
          </div>
        ))}
        {dormant.length > 0 && (
          <>
            <div className="border-t border-zinc-800 mt-2 pt-2 px-2 text-[9px] uppercase tracking-widest text-amber-400">
              ⚠ Dormant
            </div>
            {dormant.map((s: any) => (
              <div key={s.name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/50 opacity-60">
                <span className="text-amber-400 font-mono text-[11px] flex-1 truncate">○ {s.name}</span>
                <span className="text-zinc-500 text-[9px]">unused</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
