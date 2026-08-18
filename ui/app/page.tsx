'use client';

import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useState } from 'react';

import EventStream  from '@/components/EventStream';
import StatusPanel  from '@/components/StatusPanel';
import ProjectsHub  from '@/components/ProjectsHub';
import Cockpit      from '@/components/Cockpit';
import MemoryPanel  from '@/components/MemoryPanel';
import StatusStrip  from '@/components/StatusStrip';
import CodeGraphPanel from '@/components/CodeGraphPanel';
import LiveBoard     from '@/components/LiveBoard';
import SpendView     from '@/components/SpendView';

import type {
  GraphData, SemanticEvent,
  StatusData, CodeGraphsData,
} from '@/lib/types';

const BrainGraph = dynamic(() => import('@/components/BrainGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-500 text-xs tracking-widest animate-pulse">
      INITIALISING NEURAL GRAPH...
    </div>
  ),
});

const fetcher = (url: string) => fetch(url).then(r => r.json());

type Tab = 'live' | 'brain' | 'spend' | 'projects' | 'cockpit' | 'memory' | 'codegraphs';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'live',       label: 'LIVE',     icon: '⚡' },
  { id: 'brain',      label: 'BRAIN',    icon: '◉' },
  { id: 'spend',      label: 'SPEND',    icon: '$' },
  { id: 'projects',   label: 'PROJECTS', icon: '⬡' },
  { id: 'cockpit',    label: 'COCKPIT',  icon: '◎' },
  { id: 'memory',     label: 'MEMORY',   icon: '◐' },
  { id: 'codegraphs', label: 'CODE',     icon: '⬢' },
];

export default function CockpitPage() {
  const [tab, setTab] = useState<Tab>('live');

  const { data: graphData }  = useSWR<GraphData>('/api/graph', fetcher, { refreshInterval: 5000 });
  const { data: eventsRaw }  = useSWR<{ events: SemanticEvent[]; total: number }>('/api/events', fetcher, { refreshInterval: 1500 });
  const { data: status }     = useSWR<StatusData>('/api/status', fetcher, { refreshInterval: 2000 });
  const { data: codeGraphs } = useSWR<CodeGraphsData>('/api/code-graphs', fetcher, { refreshInterval: 15000 });

  const events = eventsRaw?.events ?? [];

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* Left sidebar nav */}
      <aside className="w-14 shrink-0 flex flex-col items-center py-4 gap-1 border-r border-zinc-800 bg-zinc-900 z-30">
        <div className="mb-4 text-cyan-400 font-black text-xs tracking-widest select-none">Q</div>

        {NAV.map(n => (
          <button
            key={n.id}
            title={n.label}
            onClick={() => setTab(n.id)}
            className={`w-10 h-10 rounded flex flex-col items-center justify-center gap-0.5 transition-all text-[16px]
              ${tab === n.id
                ? 'bg-zinc-800 text-cyan-400'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
          >
            <span>{n.icon}</span>
            <span className="text-[7px] tracking-widest">{n.label.slice(0, 4)}</span>
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-[7px] text-zinc-500 tracking-widest">LIVE</span>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <StatusStrip />

        <main className="flex-1 min-h-0 relative">
          {tab === 'live' && (
            <div className="absolute inset-0">
              <LiveBoard />
            </div>
          )}

          {tab === 'brain' && (
            <div className="absolute inset-0 grid grid-cols-[1fr_380px]">
              <BrainGraph data={graphData ?? null} />
              <EventStream events={events} />
            </div>
          )}

          {tab === 'spend' && (
            <div className="absolute inset-0">
              <SpendView />
            </div>
          )}

          {tab === 'projects' && (
            <div className="absolute inset-0">
              <ProjectsHub />
            </div>
          )}

          {tab === 'cockpit' && <Cockpit />}

          {tab === 'memory' && (
            <div className="absolute inset-0">
              <MemoryPanel />
            </div>
          )}

          {tab === 'codegraphs' && (
            <div className="absolute inset-0 grid grid-cols-[1fr_300px] gap-0">
              <div className="overflow-hidden">
                <CodeGraphPanel graphs={codeGraphs?.graphs ?? []} />
              </div>
              <div className="border-l border-zinc-800 overflow-hidden p-3">
                <StatusPanel status={status ?? null} />
              </div>
            </div>
          )}
        </main>

        <footer className="shrink-0 h-6 flex items-center px-4 gap-4 border-t border-zinc-800 bg-zinc-900/60 text-[9px] text-zinc-500">
          <span>Q DASH COGNITIVE ENGINE</span>
          <span className="ml-auto">AGENT TELEMETRY · LOCAL-FIRST · NO CLOUD</span>
        </footer>
      </div>
    </div>
  );
}
