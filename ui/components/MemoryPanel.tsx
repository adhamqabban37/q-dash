'use client';
import useSWR from 'swr';
import { useState } from 'react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function MemoryPanel() {
  const { data } = useSWR<any>('/api/memory', fetcher, { refreshInterval: 5000 });
  const [selected, setSelected] = useState<{ project: any; file: any } | null>(null);

  const projects: any[] = data?.projects || [];
  const withMemory = projects.filter((p: any) => p.memoryFileCount > 0);

  if (selected) {
    return (
      <div className="flex h-full bg-zinc-950">
        <div className="w-72 border-r border-zinc-800 overflow-y-auto">
          <button onClick={() => setSelected(null)} className="w-full text-left px-3 py-2 text-[10px] uppercase tracking-widest text-cyan-400 hover:bg-zinc-900 border-b border-zinc-800">
            ← All Projects
          </button>
          <div className="p-2 space-y-1">
            {selected.project.memoryFiles.map((f: any) => (
              <button
                key={f.path}
                onClick={() => setSelected({ project: selected.project, file: f })}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-mono ${
                  selected.file?.path === f.path ? 'bg-cyan-950 text-cyan-300' : 'text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                <div className="truncate">{f.name}</div>
                <div className="text-[9px] text-zinc-500">{f.size} bytes · {new Date(f.modified).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {selected.file && (
            <>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">FILE</div>
              <div className="text-zinc-200 font-mono text-[12px] mb-4">{selected.file.name}</div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">PATH</div>
              <div className="text-zinc-400 font-mono text-[11px] mb-4 break-all">{selected.file.path}</div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">STATS</div>
              <div className="text-zinc-300 font-mono text-[11px] space-y-1">
                <div>Size: {selected.file.size} bytes</div>
                <div>Modified: {new Date(selected.file.modified).toLocaleString()}</div>
                <div>Kind: {selected.file.kind}</div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-zinc-950 p-4 overflow-y-auto">
      <div className="max-w-5xl w-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[14px] uppercase tracking-widest text-cyan-400 font-black">MEMORY INDEX</h2>
            <p className="text-[10px] text-zinc-500 mt-1">{withMemory.length} of {projects.length} projects have context files</p>
          </div>
        </div>

        {withMemory.length === 0 ? (
          <div className="text-zinc-600 text-center py-12 text-[11px] uppercase tracking-widest">
            No memory files indexed yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {withMemory.map((p: any) => (
              <div key={p.path} className="bg-zinc-900 border border-zinc-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-cyan-400 font-mono text-[12px] truncate">{p.name}</div>
                  <span className="text-[9px] text-zinc-500 uppercase tracking-widest">{p.memoryFileCount} files</span>
                </div>
                <div className="space-y-1">
                  {p.memoryFiles.slice(0, 4).map((f: any) => (
                    <button
                      key={f.path}
                      onClick={() => setSelected({ project: p, file: f })}
                      className="w-full text-left flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-800 text-[11px] font-mono"
                    >
                      <span className="text-zinc-300 truncate">{f.name}</span>
                      <span className="text-zinc-600 text-[9px] shrink-0">{(f.size / 1024).toFixed(1)}k</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
