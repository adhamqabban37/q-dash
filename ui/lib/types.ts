export interface GraphNode {
  id: string;
  label: string;
  type: 'skill' | 'project' | 'note' | 'api' | 'config' | 'agent' | 'unknown';
  category: string;
  subcategory?: string;
  origin: string;
  path: string;
  ext: string;
  size: number;
  modified: string;
  tags: string[];
  wikiLinks?: string[];
  // project-specific enrichment (from package.json nodes)
  projectName?: string;
  framework?: string;
  language?: string;
  database?: string;
  deployment?: string;
  hasGit?: boolean;
  // runtime fields added by force-graph
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated?: string;
  total?: number;
}

export interface RawEvent {
  type: 'file_added' | 'file_changed' | 'file_deleted';
  path: string;
  origin: string;
  timestamp: string;
  source: string;
}

export interface SemanticEvent extends RawEvent {
  semantic: {
    intent: string;
    category: string;
    project: string | null;
    domain: string;
    impact: 'high' | 'medium' | 'low';
    confidence: number;
    signals: string[];
    changeVerb: string;
  };
  linkedNodes: Array<{ id: string; label: string; type: string; relation: string }>;
  enrichedAt: string;
}

export interface Session {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  eventCount: number;
  dominantProject: string | null;
  dominantSkill: string | null;
  activityType: 'coding' | 'config' | 'research' | 'refactor' | 'cleanup' | 'mixed';
  filesChanged: string[];
  impactSummary: { high: number; medium: number; low: number };
}

export interface HeatFile {
  path: string;
  name: string;
  ext: string;
  count: number;
  lastSeen: string;
}

export interface HeatmapData {
  generated: string;
  totalEvents: number;
  hotFiles: HeatFile[];
  hotProjects: Array<{ name: string; count: number }>;
  hotSkills: Array<{ name: string; count: number }>;
  hotDirectories: Array<{ path: string; count: number }>;
  activityCurve: Array<{ hour: number; count: number }>;
  weekdayCurve: Array<{ day: number; label: string; count: number }>;
  peakHour: number;
  mostActiveProject: string | null;
  mostEditedFile: string | null;
}

export interface Insight {
  id: string;
  type: 'trend' | 'summary' | 'anomaly';
  category: 'project' | 'skill' | 'session' | 'system';
  message: string;
  confidence: number;
  supportingEvents: string[];
  timestamp: string;
}

export interface StatusData {
  totalFiles: number;
  graphNodes: number;
  graphEdges: number;
  totalEvents: number;
  semanticEvents: number;
  heatmapEvents: number;
  lastIndexed: string | null;
  lastGraph: string | null;
  skills: number;
  agents: number;
  projects: number;
  apis: number;
}

// ── graphify code-graph bridge (output/code-graphs.json) ──────────────────────

export interface CodeGraphGodNode {
  label: string;
  degree: number;
  file: string | null;
}

export interface CodeGraphSummary {
  project: string;
  path: string;
  nodes: number;
  edges: number;
  communities: number;
  inferredEdges: number;
  godNodes: CodeGraphGodNode[];
  builtAtCommit: string | null;
  currentCommit: string | null;
  stale: boolean | null;
  updatedAt: string | null;
}

export interface CodeGraphsData {
  generated: string;
  total: number;
  graphs: CodeGraphSummary[];
}

// ── agent-observability bridge (output/agent-sessions.json, spend.json, agent-events.log.json) ──

export type AgentType = 'claude-code' | 'gemini' | 'hermes' | 'human';

export type AgentEventType = 'session_start' | 'tool_call' | 'file_change' | 'session_end' | 'error';

export interface AgentSessionRollup {
  sessionId: string;
  agentId: string;
  agentType: AgentType;
  project: string;
  startTime: string;
  endTime: string | null;
  durationMs: number;
  eventCount: number;
  tokensIn: number | null;
  tokensOut: number | null;
  estimatedCostUsd: number;
  filesChanged: string[];
  errorCount: number;
  models: string[];
  tokensEstimated: boolean;
  live: boolean;
}

export interface AgentSessionsData {
  generated: string | null;
  totalSessions: number;
  sessions: AgentSessionRollup[];
  live: AgentSessionRollup[];
}

export interface SpendBucket {
  events: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
  durationMs: number;
  lastActive?: string | null;
}

export interface SpendDayBucket extends SpendBucket {
  byAgent: Record<string, SpendBucket>;
}

export interface SpendData {
  generated: string | null;
  timezone: string;
  totals: SpendBucket;
  byAgent: Record<string, SpendBucket>;
  byProject: Record<string, SpendBucket>;
  byDay: Record<string, SpendDayBucket>;
  byWeek: Record<string, SpendBucket>;
}

export interface AgentEventMetadata {
  kind?: string;
  tool?: string;
  cmd?: string;
  skill?: string;
  error?: string;
  [key: string]: any;
}

export interface AgentEvent {
  agentId: string;
  agentType: AgentType;
  sessionId: string;
  timestamp: string;
  eventType: AgentEventType;
  project: string;
  filesTouched: string[];
  tokensIn: number | null;
  tokensOut: number | null;
  model?: string | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  metadata?: AgentEventMetadata;
}

export interface AgentEventsData {
  events: AgentEvent[];
}
