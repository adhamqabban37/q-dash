'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { GraphData, GraphNode, AgentEventsData } from '@/lib/types';

const ForceGraph2D = dynamic(
  () => import('@/lib/ForceGraphCompat'),
  { ssr: false, loading: () => <GraphPlaceholder /> }
);

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Agent-event pulse: highlight nodes whose files were just touched ──────────
const PULSE_MS = 4000;
const PULSE_COLOR = '#f59e0b'; // reuse the existing search-highlight amber

// ── Colour map ────────────────────────────────────────────────────────────────
const NODE_COLOR: Record<string, string> = {
  skill:   '#00d4ff',
  agent:   '#22d3a5',
  project: '#9333ea',
  note:    '#3b82f6',
  api:     '#f59e0b',
  config:  '#64748b',
  unknown: '#374151',
};

// Edge colour by relation — meaningful edges are bright, structural are near-invisible
function edgeColor(relation: string): string {
  if (relation === 'agent-uses')          return 'rgba(34,211,165,0.9)';
  if (relation === 'project-uses-agent')  return 'rgba(34,211,165,0.55)';
  if (relation === 'wiki-link')           return 'rgba(59,130,246,0.85)';
  if (relation === 'project-has-note')    return 'rgba(59,130,246,0.5)';
  if (relation === 'project-uses-skill')  return 'rgba(147,51,234,0.7)';
  if (relation.startsWith('shared-tag'))  return 'rgba(245,158,11,0.4)';
  if (relation === 'folder-sibling')      return 'rgba(40,50,60,0.4)';
  if (relation === 'project-contains')    return 'rgba(40,50,60,0.3)';
  if (relation.startsWith('same-type'))   return 'rgba(40,50,60,0.22)';
  return 'rgba(40,50,60,0.3)';
}

function edgeWidth(relation: string): number {
  if (relation === 'agent-uses' || relation === 'wiki-link') return 1.5;
  if (relation === 'project-uses-agent' || relation === 'project-has-note') return 1;
  if (relation === 'project-uses-skill') return 0.8;
  if (relation.startsWith('shared-tag'))  return 0.5;
  return 0.3;
}

function edgeParticles(relation: string): number {
  if (relation === 'agent-uses')          return 3;
  if (relation === 'wiki-link')           return 2;
  if (relation === 'project-uses-agent')  return 1;
  return 0;
}

// Structural edges that clutter the graph — hidden by default
const STRUCTURAL = new Set(['folder-sibling', 'project-contains']);
function isSameType(r: string) { return r.startsWith('same-type'); }

// ── Node priority & sizing ────────────────────────────────────────────────────
const NODE_LIMIT = 1500;

function nodePriority(n: GraphNode): number {
  if (n.type === 'agent')                                   return 0;
  if (n.type === 'skill' && n.label === 'SKILL.md')        return 1;
  if (n.type === 'note')                                    return 2;
  if (n.type === 'project' && n.label === 'package.json')  return 3;
  if (n.type === 'skill')                                   return 4;
  if (n.type === 'project')                                 return 5;
  if (n.type === 'config')                                  return 6;
  return 7;
}

function nodeRadius(node: any, isSel: boolean): number {
  if (isSel)                                               return 8;
  if (node.type === 'agent')                               return 8;
  if (node.type === 'skill' && node.label === 'SKILL.md') return 5;
  if (node.type === 'note')                                return 4;
  if (node.type === 'project' && node.label === 'package.json') return 4;
  return 3;
}

function GraphPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-q-muted text-xs tracking-widest animate-pulse">
      LOADING NEURAL GRAPH...
    </div>
  );
}

interface Props { data: GraphData | null; filterType?: string; }

export default function BrainGraph({ data, filterType }: Props) {
  const fgRef   = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [dims, setDims]               = useState({ w: 800, h: 600 });
  const [selected, setSelected]       = useState<GraphNode | null>(null);
  const [tooltip, setTooltip]         = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [mousePos, setMousePos]       = useState({ x: 0, y: 0 });
  const [typeFilter, setTypeFilter]   = useState<string>(filterType || '');
  const [showStructural, setShowStructural] = useState(false);
  const [search, setSearch]           = useState('');

  // ── Agent-event pulse state ──────────────────────────────────────────────
  const pulseMapRef      = useRef<Map<string, number>>(new Map()); // nodeId -> pulseUntil (ms epoch)
  const seenEventIdsRef  = useRef<Set<string>>(new Set());          // timestamp|sessionId|eventType, pulse once
  const [pulseTick, setPulseTick] = useState(0);                    // force repaint when pulses change

  const { data: agentEvents } = useSWR<AgentEventsData>('/api/agent-events?n=50', fetcher, { refreshInterval: 2000 });

  // Normalized path -> node id lookup, rebuilt whenever the graph data changes
  const pathIndex = useMemo(() => {
    const idx = new Map<string, string>();
    (data?.nodes || []).forEach(n => {
      if (n.path) idx.set(n.path.replace(/\\/g, '/').toLowerCase(), n.id);
    });
    return idx;
  }, [data]);

  // Match new agent events against graph nodes by (normalized) path and set a pulse
  useEffect(() => {
    const events = agentEvents?.events || [];
    if (events.length === 0) return;
    let changed = false;
    for (const e of events) {
      const eventId = `${e.timestamp}|${e.sessionId}|${e.eventType}`;
      if (seenEventIdsRef.current.has(eventId)) continue;
      seenEventIdsRef.current.add(eventId);

      for (const f of e.filesTouched || []) {
        const norm = f.replace(/\\/g, '/').toLowerCase();
        let nodeId = pathIndex.get(norm);
        if (!nodeId) {
          // Fall back to a suffix match (e.g. event path is absolute, node path is relative, or vice versa)
          const hit = Array.from(pathIndex.entries()).find(([p]) => norm.endsWith(p) || p.endsWith(norm));
          if (hit) nodeId = hit[1];
        }
        if (nodeId) {
          pulseMapRef.current.set(nodeId, Date.now() + PULSE_MS);
          changed = true;
        }
      }
    }
    if (changed) setPulseTick(t => t + 1);
  }, [agentEvents, pathIndex]);

  // Sweep expired pulses so the highlight fades out even with no new events
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let anyExpired = false;
      pulseMapRef.current.forEach((until, nodeId) => {
        if (until <= now) { pulseMapRef.current.delete(nodeId); anyExpired = true; }
      });
      if (anyExpired) setPulseTick(t => t + 1);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Track container size
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Unfreeze ONLY when type filter changes — not on every SWR data refresh
  const prevFilter = useRef(typeFilter);
  useEffect(() => {
    if (prevFilter.current === typeFilter) return;
    prevFilter.current = typeFilter;
    if (!data?.nodes) return;
    data.nodes.forEach((n: any) => { delete n.fx; delete n.fy; });
  }, [typeFilter, data]);

  // Build the graph dataset
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    let nodes: GraphNode[] = data.nodes || [];

    if (typeFilter) {
      nodes = nodes.filter(n => n.type === typeFilter);
    } else if (nodes.length > NODE_LIMIT) {
      nodes = [...nodes].sort((a, b) => nodePriority(a) - nodePriority(b)).slice(0, NODE_LIMIT);
    }

    const nodeIds = new Set(nodes.map(n => n.id));
    const links = (data.edges || [])
      .filter(e => {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
        if (!showStructural && (STRUCTURAL.has(e.relation) || isSameType(e.relation))) return false;
        return true;
      })
      .map(e => ({ source: e.source, target: e.target, relation: e.relation }));

    return { nodes, links };
  }, [data, typeFilter, showStructural]);

  // Search — highlight matching nodes
  const searchMatches = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    const q = search.toLowerCase();
    return new Set(
      graphData.nodes
        .filter(n =>
          n.label?.toLowerCase().includes(q) ||
          n.category?.toLowerCase().includes(q) ||
          (n as any).framework?.toLowerCase().includes(q)
        )
        .map(n => n.id)
    );
  }, [search, graphData.nodes]);

  // Freeze nodes after simulation settles, then zoom to fit
  const handleEngineStop = useCallback(() => {
    if (!fgRef.current) return;
    fgRef.current.zoomToFit(600, 40);
    (fgRef.current.graphData().nodes as any[]).forEach(n => {
      n.fx = n.x; n.fy = n.y;
    });
  }, []);

  // Custom canvas node renderer
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const isSel      = node === selected;
    const isHit      = searchMatches.size > 0 && searchMatches.has(node.id);
    const isDimmed    = searchMatches.size > 0 && !isHit && !isSel;
    const pulseUntil = pulseMapRef.current.get(node.id);
    const isPulsing  = !!pulseUntil && pulseUntil > Date.now();
    const r          = nodeRadius(node, isSel) + (isPulsing ? 4 : 0);
    const color      = NODE_COLOR[node.type] || '#374151';

    // Soft glow behind agent nodes
    if (node.type === 'agent') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34,211,165,0.12)';
      ctx.fill();
    }

    // Bright amber halo for nodes whose files were just touched by an agent
    if (isPulsing) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,158,11,0.25)';
      ctx.fill();
    }

    // Main dot
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isPulsing ? PULSE_COLOR : (isDimmed ? 'rgba(61,68,77,0.35)' : color);
    ctx.fill();

    // Ring: selection = node colour, search hit / pulse = amber
    if (isSel || isHit || isPulsing) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = (isHit || isPulsing) ? PULSE_COLOR : color;
      ctx.lineWidth   = 1.5 / scale;
      ctx.stroke();
    }

    // Labels — agents always at low zoom, others only when zoomed in
    const zoomThreshold = node.type === 'agent' ? 0.6 : (isSel || isHit || isPulsing ? 1.0 : 2.8);
    if (scale > zoomThreshold) {
      const fs = Math.max(2.5, Math.min(5, 8 / scale));
      ctx.font      = `${fs}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isSel || isHit || isPulsing ? '#f0f6fc' : 'rgba(200,210,220,0.75)';
      const lbl = node.type === 'agent'
        ? node.label.replace(/\.md$/i, '').toUpperCase()
        : node.label?.slice(0, 22) || '';
      ctx.fillText(lbl, node.x, node.y + r + fs + 1);
    }
  }, [selected, searchMatches, pulseTick]);

  const handleNodeClick = useCallback((node: any) => {
    setSelected(prev => prev?.id === node.id ? null : (node as GraphNode));
  }, []);

  const handleNodeHover = useCallback((node: any) => {
    setTooltip(node ? { x: mousePos.x, y: mousePos.y, node } : null);
  }, [mousePos]);

  // Clamp tooltip to viewport
  const tooltipPos = useMemo(() => {
    if (!tooltip) return { left: 0, top: 0 };
    const W = typeof window !== 'undefined' ? window.innerWidth  : 1280;
    const H = typeof window !== 'undefined' ? window.innerHeight : 800;
    return {
      left: Math.min(tooltip.x + 14, W - 230),
      top:  Math.min(tooltip.y + 14, H - 90),
    };
  }, [tooltip]);

  const TYPES = ['skill', 'agent', 'project', 'note', 'api', 'config'];

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full bg-q-bg overflow-hidden"
      onMouseMove={e => setMousePos({ x: e.clientX, y: e.clientY })}
      onContextMenu={e => { e.preventDefault(); fgRef.current?.zoomToFit(400, 40); }}
    >

      {/* ── Type filter chips + structural toggle ──────────────────────────── */}
      <div className="absolute top-3 left-3 z-10 flex gap-1 flex-wrap items-center">
        <button
          onClick={() => setTypeFilter('')}
          className={`q-chip border ${!typeFilter ? 'border-q-cyan text-q-cyan' : 'border-q-border text-q-muted'}`}
        >ALL</button>
        {TYPES.map(t => (
          <button key={t}
            onClick={() => setTypeFilter(prev => prev === t ? '' : t)}
            className="q-chip border"
            style={{
              borderColor: typeFilter === t ? NODE_COLOR[t] : '#21262d',
              color:       typeFilter === t ? NODE_COLOR[t] : '#8b949e',
            }}
          >{t}</button>
        ))}
        <button
          onClick={() => setShowStructural(p => !p)}
          title="Toggle structural edges (folder-sibling, project-contains, same-type)"
          className="q-chip border ml-1"
          style={{
            borderColor: showStructural ? '#f59e0b' : '#21262d',
            color:       showStructural ? '#f59e0b' : '#3d444d',
          }}
        >{showStructural ? '⊞ struct' : '⊟ struct'}</button>
      </div>

      {/* ── Search box ─────────────────────────────────────────────────────── */}
      <div className="absolute top-3 z-10 flex items-center" style={{ right: '44px' }}>
        <div className="relative">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search…"
            className="bg-q-surface border border-q-border text-[10px] text-q-muted rounded px-2 py-1 w-32 focus:outline-none focus:border-q-cyan placeholder:text-q-dim"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-q-dim hover:text-q-red text-[10px] leading-none"
            >✕</button>
          )}
        </div>
      </div>

      {/* ── Zoom controls ──────────────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button onClick={() => fgRef.current?.zoom(1.5, 300)}
          className="w-7 h-7 bg-q-surface border border-q-border text-q-muted hover:text-q-cyan text-sm rounded flex items-center justify-center">+</button>
        <button onClick={() => fgRef.current?.zoom(0.67, 300)}
          className="w-7 h-7 bg-q-surface border border-q-border text-q-muted hover:text-q-cyan text-sm rounded flex items-center justify-center">−</button>
        <button onClick={() => fgRef.current?.zoomToFit(400, 40)}
          className="w-7 h-7 bg-q-surface border border-q-border text-q-muted hover:text-q-cyan text-xs rounded flex items-center justify-center">⊡</button>
      </div>

      {/* ── Force graph canvas ─────────────────────────────────────────────── */}
      {dims.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dims.w}
          height={dims.h}
          backgroundColor="#060b12"
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(link: any) => edgeColor(link.relation)}
          linkWidth={(link: any) => edgeWidth(link.relation)}
          linkDirectionalParticles={(link: any) => edgeParticles(link.relation)}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={(link: any) => edgeColor(link.relation)}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.35}
          cooldownTicks={120}
          onEngineStop={handleEngineStop}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      )}

      {/* ── Selected node detail panel ─────────────────────────────────────── */}
      {selected && (
        <div className="absolute bottom-10 right-3 z-20 q-panel p-4 w-72 text-xs animate-slide-in">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="font-bold text-q-text leading-tight">
              {selected.type === 'agent'
                ? selected.label.replace(/\.md$/i, '').toUpperCase()
                : selected.label}
            </span>
            <button onClick={() => setSelected(null)} className="text-q-muted hover:text-q-red shrink-0">✕</button>
          </div>
          <div className="space-y-1 text-q-muted">
            <Row label="Type"      value={selected.type}     color={NODE_COLOR[selected.type]} />
            <Row label="Category"  value={selected.category} />
            <Row label="Origin"    value={selected.origin} />
            {(selected as any).framework  && <Row label="Framework" value={(selected as any).framework}  color="#9333ea" />}
            {(selected as any).language   && <Row label="Language"  value={(selected as any).language} />}
            {(selected as any).database   && <Row label="Database"  value={(selected as any).database}  color="#f59e0b" />}
            {(selected as any).deployment && <Row label="Deploy"    value={(selected as any).deployment} color="#9333ea" />}
            {(selected as any).hasGit !== undefined && (
              <Row label="Git" value={(selected as any).hasGit ? 'yes' : 'no'} color={(selected as any).hasGit ? '#22d3a5' : '#64748b'} />
            )}
            <Row label="Ext"       value={selected.ext || '—'} />
            <Row label="Size"      value={selected.size ? fmtSize(selected.size) : '—'} />
            <Row label="Modified"  value={selected.modified ? new Date(selected.modified).toLocaleDateString() : '—'} />
            {selected.tags?.length > 0 && (
              <div className="pt-1 flex flex-wrap gap-1">
                {selected.tags.slice(0, 8).map(t => (
                  <span key={t} className="text-[9px] text-q-cyan bg-q-raised px-1 py-0.5 rounded">#{t}</span>
                ))}
              </div>
            )}
            <div className="pt-1 text-[9px] text-q-dim break-all">{selected.path}</div>
          </div>
        </div>
      )}

      {/* ── Hover tooltip ──────────────────────────────────────────────────── */}
      {tooltip && (
        <div className="node-tooltip" style={tooltipPos}>
          <span style={{ color: NODE_COLOR[tooltip.node.type] }}>{tooltip.node.type}</span>
          {' · '}
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>
            {tooltip.node.type === 'agent'
              ? tooltip.node.label.replace(/\.md$/i, '').toUpperCase()
              : tooltip.node.label}
          </span>
          <br />
          <span style={{ color: '#3d444d', fontSize: '9px' }}>{tooltip.node.category}</span>
          {(tooltip.node as any).framework && (
            <span style={{ color: '#9333ea', fontSize: '9px' }}> · {(tooltip.node as any).framework}</span>
          )}
        </div>
      )}

      {/* ── Bottom: stats + legend ─────────────────────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5">
        <div className="text-[10px] text-q-muted flex items-center gap-3">
          <span>
            {graphData.nodes.length} nodes · {graphData.links.length} edges
            {data?.total && data.total > graphData.nodes.length
              ? <span className="text-q-dim"> / {data.total} total</span>
              : null}
          </span>
          {search && searchMatches.size > 0 && (
            <span style={{ color: '#f59e0b' }}>
              {searchMatches.size} match{searchMatches.size !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          {TYPES.map(t => (
            <span key={t} className="flex items-center gap-1 text-[10px] text-q-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: NODE_COLOR[t] }} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-q-dim">{label}</span>
      <span style={color ? { color } : {}} className="truncate">{value}</span>
    </div>
  );
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
