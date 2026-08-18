'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function SessionIndicators() {
  const { data } = useSWR<any>('/api/cockpit', fetcher, { refreshInterval: 2000 });
  const sessions: any[] = data?.activeSessions || [];

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-zinc-800 bg-zinc-950/40">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-bold">ACTIVE SESSIONS</span>
        <span className="text-[9px] text-zinc-500 font-mono">({sessions.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <div className="text-zinc-600 text-center py-4 text-[10px] uppercase tracking-widest">
            No active sessions
          </div>
        )}
        {sessions.map((s, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-zinc-200 font-mono text-[11px] flex-1 truncate">{s.project}</span>
            <span className="text-cyan-400 font-mono text-[10px]">{s.count}</span>
            <span className="text-zinc-500 text-[9px] uppercase tracking-widest">events</span>
          </div>
        ))}
      </div>
    </div>
  );
}
