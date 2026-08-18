'use client';

import { useState } from 'react';
import useSWR from 'swr';

// ── Framework accent colours ──────────────────────────────────────────────────
const FW_COLOR: Record<string, string> = {
  'Next.js':            '#e6edf3',
  'Expo':               '#8b5cf6',
  'React + Capacitor':  '#00d4ff',
  'React + Vite':       '#61dafb',
  'React':              '#61dafb',
  'Node.js':            '#68a063',
  'Python':             '#ffd43b',
  'Unknown':            '#6b7280',
};

const GIT_COLOR = { clean: '#22c55e', dirty: '#f59e0b', none: '#6b7280' };

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Tiny shared primitives ────────────────────────────────────────────────────

function Dot({ status }: { status: 'clean' | 'dirty' | 'none' }) {
  const pulse = status === 'clean' ? ' animate-pulse' : '';
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0${pulse}`}
      style={{ background: GIT_COLOR[status] }}
      title={status === 'clean' ? 'Git clean' : status === 'dirty' ? 'Uncommitted changes' : 'No git'}
    />
  );
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded border font-mono tracking-wide"
      style={{ borderColor: color ?? '#21262d', color: color ?? '#8b949e' }}
    >
      {label}
    </span>
  );
}

function SectionHead({ label }: { label: string }) {
  return <div className="text-[9px] text-q-dim tracking-widest mt-4 mb-1.5 first:mt-0 border-b border-q-border/30 pb-1">{label}</div>;
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({ p, selected, onClick }: { p: any; selected: boolean; onClick: () => void }) {
  const accent = FW_COLOR[p.framework] ?? '#6b7280';
  return (
    <button
      onClick={onClick}
      className={`text-left w-full q-panel p-4 transition-all hover:border-opacity-60 ${
        selected ? 'ring-1' : 'hover:bg-q-raised/30'
      }`}
      style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : {}}
    >
      {/* Name + git dot */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-bold text-sm leading-tight" style={{ color: accent }}>
          {p.displayName}
        </span>
        <Dot status={p.gitStatus} />
      </div>

      {/* Description */}
      {p.description && (
        <p className="text-[10px] text-q-muted leading-snug mb-2 line-clamp-2">
          {p.description}
        </p>
      )}

      {/* Stack badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        <Badge label={p.framework} color={accent} />
        {p.language === 'TypeScript' && <Badge label="TS" color="#3178c6" />}
        {p.database && <Badge label={p.database.split(' ')[0]} color="#f59e0b" />}
        {p.deployment && <Badge label={p.deployment} color="#9333ea" />}
      </div>

      {/* Last commit */}
      {p.lastCommit ? (
        <div className="text-[9px] text-q-dim truncate">
          {p.currentBranch && <span className="text-q-cyan mr-1">{p.currentBranch}</span>}
          {p.lastCommit.date} · {p.lastCommit.message.slice(0, 48)}
        </div>
      ) : (
        <div className="text-[9px] text-q-dim">No git history</div>
      )}
    </button>
  );
}

// ── Tree renderer ─────────────────────────────────────────────────────────────

function TreeNode({ node, depth = 0 }: { node: any; depth?: number }) {
  return (
    <div style={{ paddingLeft: depth * 12 }} className="text-[9px] font-mono">
      <span className="text-q-dim mr-1">{node.isDir ? '▸' : '·'}</span>
      <span className={node.isDir ? 'text-q-cyan' : 'text-q-muted'}>{node.name}</span>
      {node.children?.map((c: any) => <TreeNode key={c.name} node={c} depth={depth + 1} />)}
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function ProjectDetail({ slug }: { slug: string }) {
  const { data, error, isLoading } = useSWR(`/api/projects/${slug}`, fetcher, {
    revalidateOnFocus: false,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-40 text-q-dim text-xs animate-pulse tracking-widest">
      LOADING PROJECT DATA...
    </div>
  );
  if (error || !data || data.error) return (
    <div className="text-q-red text-xs p-4">Failed to load project detail.</div>
  );

  const accent = FW_COLOR[data.framework] ?? '#6b7280';

  return (
    <div className="h-full overflow-y-auto p-4 space-y-1 text-xs">

      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-base font-bold" style={{ color: accent }}>{data.displayName}</h2>
          <Dot status={data.gitStatus} />
          {data.gitStatus !== 'none' && (
            <span className="text-[9px] text-q-dim">
              {data.gitStatus === 'dirty' ? `${data.dirtyFiles?.length ?? 0} unsaved` : 'clean'}
            </span>
          )}
        </div>
        {data.description && (
          <p className="text-q-muted text-[11px] leading-relaxed">{data.description}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge label={data.framework} color={accent} />
          <Badge label={data.language} color="#6b7280" />
          {data.database   && <Badge label={data.database}   color="#f59e0b" />}
          {data.deployment && <Badge label={data.deployment} color="#9333ea" />}
          {data.fileCount  && <Badge label={`${data.fileCount} files`} />}
        </div>
      </div>

      {/* Git info */}
      {data.hasGit && (
        <>
          <SectionHead label="GIT" />
          <div className="space-y-0.5 text-[10px] text-q-muted mb-1">
            {data.currentBranch && (
              <div><span className="text-q-dim w-16 inline-block">Branch</span>
                <span className="text-q-cyan">{data.currentBranch}</span>
              </div>
            )}
            {data.aheadBehind && (data.aheadBehind.ahead > 0 || data.aheadBehind.behind > 0) && (
              <div><span className="text-q-dim w-16 inline-block">Remote</span>
                <span className="text-q-amber">↑{data.aheadBehind.ahead} ↓{data.aheadBehind.behind}</span>
              </div>
            )}
            {data.remoteUrl && (
              <div className="truncate"><span className="text-q-dim w-16 inline-block">Remote</span>
                <span className="text-[9px]">{data.remoteUrl}</span>
              </div>
            )}
          </div>

          {data.recentCommits?.length > 0 && (
            <div className="space-y-0.5 mt-1">
              {data.recentCommits.map((c: any) => (
                <div key={c.hash} className="flex gap-2 text-[9px]">
                  <span className="text-q-cyan font-mono shrink-0">{c.hash}</span>
                  <span className="text-q-muted truncate flex-1">{c.message}</span>
                  <span className="text-q-dim shrink-0">{c.date}</span>
                </div>
              ))}
            </div>
          )}

          {data.dirtyFiles?.length > 0 && (
            <div className="mt-2 p-2 bg-q-raised/40 rounded border border-q-border/30">
              <div className="text-[9px] text-q-amber mb-1">Uncommitted changes</div>
              {data.dirtyFiles.map((f: string) => (
                <div key={f} className="text-[9px] text-q-muted font-mono truncate">· {f}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Dependencies */}
      {Object.keys(data.groupedDeps ?? {}).length > 0 && (
        <>
          <SectionHead label="DEPENDENCIES" />
          {Object.entries(data.groupedDeps as Record<string, [string, string][]>).map(([group, entries]) => (
            <div key={group} className="mb-2">
              <div className="text-[9px] text-q-dim mb-0.5">{group}</div>
              <div className="flex flex-wrap gap-1">
                {entries.slice(0, 12).map(([name, ver]) => (
                  <span key={name} className="text-[9px] font-mono text-q-muted bg-q-raised/30 px-1 py-0.5 rounded">
                    {name.replace(/^@[^/]+\//, '')}
                    <span className="text-q-dim ml-1">{String(ver).replace('^','').replace('~','').slice(0,8)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Folder tree */}
      {data.folderTree?.length > 0 && (
        <>
          <SectionHead label="STRUCTURE" />
          <div className="bg-q-raised/20 rounded p-2 border border-q-border/30">
            <div className="text-[9px] font-mono text-q-cyan mb-1">
              {data.folderName}/
            </div>
            {data.folderTree.map((n: any) => (
              <TreeNode key={n.name} node={n} depth={1} />
            ))}
          </div>
        </>
      )}

      {/* Related brain notes */}
      {data.relatedNotes?.length > 0 && (
        <>
          <SectionHead label="BRAIN NOTES" />
          <div className="space-y-0.5">
            {data.relatedNotes.map((n: any) => (
              <div key={n.path} className="text-[9px] text-q-muted truncate">
                <span className="text-q-blue mr-1">◈</span>{n.name}
                <span className="text-q-dim ml-1 text-[8px]">{n.path.split('\\').slice(-2).join('\\')}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Related agents */}
      {data.relatedAgents?.length > 0 && (
        <>
          <SectionHead label="AGENTS" />
          <div className="flex flex-wrap gap-1">
            {data.relatedAgents.map((a: string) => (
              <Badge key={a} label={a} color="#22d3a5" />
            ))}
          </div>
        </>
      )}

    </div>
  );
}

// ── Main hub ──────────────────────────────────────────────────────────────────

export default function ProjectsHub() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useSWR('/api/projects', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  });

  const projects: any[] = data?.projects ?? [];

  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* Left — card grid */}
      <div className={`flex flex-col overflow-hidden transition-all ${selected ? 'w-[420px] shrink-0' : 'flex-1'}`}>

        {/* Toolbar */}
        <div className="shrink-0 h-9 flex items-center px-4 gap-3 border-b border-q-border bg-q-surface/60 text-[9px] text-q-dim">
          <span className="text-q-cyan font-bold tracking-widest">PROJECTS HUB</span>
          <span>{projects.length} projects</span>
          <span className="ml-auto">
            {projects.filter((p: any) => p.hasGit).length} with git ·{' '}
            {projects.filter((p: any) => p.gitStatus === 'dirty').length} dirty
          </span>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && (
            <div className="text-q-dim text-xs text-center mt-8 animate-pulse tracking-widest">
              SCANNING PROJECTS...
            </div>
          )}
          <div className={`grid gap-2 ${selected ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'}`}>
            {projects.map((p: any) => (
              <ProjectCard
                key={p.slug}
                p={p}
                selected={selected === p.slug}
                onClick={() => setSelected(prev => prev === p.slug ? null : p.slug)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right — detail panel */}
      {selected && (
        <div className="flex-1 border-l border-q-border bg-q-surface/30 flex flex-col overflow-hidden">
          {/* Detail header */}
          <div className="shrink-0 h-9 flex items-center px-4 border-b border-q-border bg-q-surface/60">
            <span className="text-[9px] text-q-dim tracking-widest flex-1">PROJECT BRIEFING</span>
            <button
              onClick={() => setSelected(null)}
              className="text-q-dim hover:text-q-red text-xs w-6 h-6 flex items-center justify-center"
            >✕</button>
          </div>
          <ProjectDetail slug={selected} />
        </div>
      )}

    </div>
  );
}
