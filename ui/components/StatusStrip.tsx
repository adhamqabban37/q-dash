'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Health { engine: 'green'|'yellow'|'red'; watcher: 'green'|'yellow'|'red'; ingest: 'green'|'yellow'|'red' }

export default function StatusStrip() {
  const { data } = useSWR<any>('/api/cockpit', fetcher, { refreshInterval: 2000 });
  const h: Health = data?.health || { engine: 'red', watcher: 'red', ingest: 'red' };

  const Light = ({ color, label }: { color: string; label: string }) => (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${
        color === 'green' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' :
        color === 'yellow' ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' :
        'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
      } animate-pulse`} />
      <span className="text-[9px] uppercase tracking-widest text-zinc-400">{label}</span>
    </div>
  );

  return (
    <div className="flex items-center gap-6 px-4 h-9 bg-zinc-900 border-b border-zinc-800 text-zinc-300">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black tracking-widest text-cyan-400">Q DASH</span>
        <span className="text-[9px] text-zinc-500">·</span>
        <span className="text-[9px] uppercase tracking-widest text-zinc-500">COCKPIT</span>
      </div>

      <div className="flex items-center gap-4 border-l border-zinc-800 pl-4">
        <Light color={h.engine}  label="Engine" />
        <Light color={h.watcher} label="Watcher" />
        <Light color={h.ingest}  label="Ingest" />
      </div>

      <div className="ml-auto flex items-center gap-4 text-[9px] font-mono">
        {data && (
          <>
            <span><span className="text-cyan-400">{data.totalFiles}</span> <span className="text-zinc-500">files</span></span>
            <span><span className="text-violet-400">{data.graphNodes}</span> <span className="text-zinc-500">nodes</span></span>
            <span><span className="text-emerald-400">{data.semanticEvents}</span> <span className="text-zinc-500">events</span></span>
            <span><span className="text-amber-400">{data.pendingIngest}</span> <span className="text-zinc-500">pending</span></span>
            <span><span className="text-rose-400">{data.dormantSkills}</span> <span className="text-zinc-500">dormant</span></span>
          </>
        )}
        <span className="text-zinc-500 border-l border-zinc-800 pl-4" suppressHydrationWarning>
          {new Date().toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
