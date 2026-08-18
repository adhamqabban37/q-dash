'use client';
import { useEffect, useRef, useState } from 'react';

interface FeedEvent {
  source?: string;
  type?: string;
  agentType?: string;
  agentProject?: string;
  agentDetail?: any;
  path?: string;
  timestamp?: string;
  semantic?: { impact?: string; project?: string; intent?: string; category?: string };
}

const SOURCE_COLORS: Record<string, string> = {
  'claude-code': 'text-emerald-400',
  'hermes':      'text-cyan-400',
  'gemini-cli':  'text-violet-400',
  'manual':      'text-amber-400',
  'watcher':     'text-amber-300',
};

const TYPE_GLYPHS: Record<string, string> = {
  'tool_call':     '⚙',
  'command_run':   '▶',
  'file_edit':     '✎',
  'memory_read':   '◉',
  'skill_invoked': '★',
  'session_start': '◐',
  'session_end':   '◑',
  'file_added':    '+',
  'file_changed':  '~',
  'file_deleted':  '−',
};

export default function LiveFeed({ limit = 80 }: { limit?: number }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('event', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setEvents(prev => [...prev.slice(-(limit - 1)), data]);
      } catch {}
    });
    es.addEventListener('system', () => {});
    return () => es.close();
  }, [limit]);

  useEffect(() => {
    if (paused || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [events, paused]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded">
      <div className="flex items-center justify-between px-3 h-8 border-b border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-bold">LIVE FEED</span>
          <span className="text-[9px] text-zinc-500 font-mono">({events.length})</span>
        </div>
        <button onClick={() => setPaused(p => !p)} className="text-[9px] uppercase tracking-widest text-zinc-500 hover:text-cyan-400">
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5">
        {events.length === 0 && (
          <div className="text-zinc-600 text-center py-8 text-[10px] uppercase tracking-widest">
            Awaiting agent telemetry...
          </div>
        )}
        {events.slice().reverse().map((e, i) => {
          const source = e.source || (e.path ? 'watcher' : 'unknown');
          const type = e.agentType || e.type || 'event';
          const project = e.agentProject || e.semantic?.project || (e.path ? e.path.split('\\').slice(-2, -1)[0] : '—');
          const detail = e.agentDetail?.tool || e.agentDetail?.skill || e.agentDetail?.cmd?.slice(0, 30) || e.agentDetail?.file || (e.path || '').split('\\').pop() || '';
          const time = (e.timestamp || '').slice(11, 19);
          const color = SOURCE_COLORS[source] || 'text-zinc-400';
          const glyph = TYPE_GLYPHS[type] || '·';
          return (
            <div key={i} className="flex items-baseline gap-2 hover:bg-zinc-800/50 px-1 rounded">
              <span className="text-zinc-600 shrink-0">{time}</span>
              <span className={`shrink-0 w-3 ${color}`}>{glyph}</span>
              <span className={`shrink-0 w-20 truncate ${color}`}>{source}</span>
              <span className="shrink-0 w-24 truncate text-zinc-500">{type}</span>
              <span className="shrink-0 w-28 truncate text-zinc-400">{project}</span>
              <span className="text-zinc-300 truncate flex-1">{detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
