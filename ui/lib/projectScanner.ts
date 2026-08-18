import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Project registry ──────────────────────────────────────────────────────────

const DEFS = [
  { folder: 'xxx5.0',               path: 'C:\\Users\\Tyson\\Desktop\\xxx5.0',               displayName: 'Xenlix AI' },
  { folder: 'focusflow-day-planner', path: 'C:\\Users\\Tyson\\Desktop\\focusflow-day-planner', displayName: 'FocusFlow' },
  { folder: 'Ai-insurance -agency',  path: 'C:\\Users\\Tyson\\Desktop\\Ai-insurance -agency',  displayName: 'AgencyOS' },
  { folder: 'Agentic dash',          path: 'C:\\Users\\Tyson\\Desktop\\Agentic dash',           displayName: 'Q DASH' },
  { folder: 'next-js-saas-starter',  path: 'C:\\Users\\Tyson\\next-js-saas-starter',            displayName: 'SaaS Starter' },
  { folder: 'saas-starter',          path: 'C:\\Users\\Tyson\\saas-starter',                    displayName: 'SaaS Starter (Fork)' },
  { folder: 'TruthBite',             path: 'C:\\Users\\Tyson\\TruthBite',                       displayName: 'TruthBite' },
  { folder: 'TruthBiteApp',          path: 'C:\\Users\\Tyson\\TruthBiteApp',                    displayName: 'TruthBite App' },
  { folder: 'graphify-repo',         path: 'C:\\Users\\Tyson\\graphify-repo',                   displayName: 'Graphify' },
  { folder: 'awesome-claude-skills', path: 'C:\\Users\\Tyson\\awesome-claude-skills',           displayName: 'Awesome Claude Skills' },
  { folder: 'obsidian-skills',       path: 'C:\\Users\\Tyson\\obsidian-skills',                 displayName: 'Obsidian Skills' },
  { folder: 'TestApp',               path: 'C:\\Users\\Tyson\\TestApp',                         displayName: 'Test App' },
];

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommitInfo { hash: string; message: string; date: string }
export interface TreeNode   { name: string; isDir: boolean; children: TreeNode[] }

export interface ProjectCard {
  slug: string;
  folderName: string;
  displayName: string;
  description: string;
  rootPath: string;
  framework: string;
  language: string;
  database: string | null;
  deployment: string | null;
  hasGit: boolean;
  gitStatus: 'clean' | 'dirty' | 'none';
  currentBranch: string | null;
  lastCommit: CommitInfo | null;
  remoteUrl: string | null;
  keyDeps: string[];
}

export interface ProjectDetail extends ProjectCard {
  allDeps: Record<string, string>;
  groupedDeps: Record<string, Array<[string, string]>>;
  recentCommits: CommitInfo[];
  dirtyFiles: string[];
  folderTree: TreeNode[];
  relatedNotes: Array<{ path: string; name: string; origin: string }>;
  relatedAgents: string[];
  aheadBehind: { ahead: number; behind: number } | null;
  fileCount: number;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd, timeout: 4000, encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { return ''; }
}

// Parse a block of lines: hash\nmessage\ndate\nhash\nmessage\ndate\n...
function parseCommitBlock(out: string): CommitInfo[] {
  const lines = out.split('\n').filter(Boolean);
  const result: CommitInfo[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    result.push({ hash: lines[i].slice(0, 7), message: lines[i + 1] ?? '', date: lines[i + 2] ?? '' });
  }
  return result;
}

function getGitCard(rootPath: string): Pick<ProjectCard, 'hasGit' | 'gitStatus' | 'currentBranch' | 'lastCommit' | 'remoteUrl'> {
  const hasGit = fs.existsSync(path.join(rootPath, '.git'));
  if (!hasGit) return { hasGit: false, gitStatus: 'none', currentBranch: null, lastCommit: null, remoteUrl: null };

  const branch = git(rootPath, 'branch --show-current');
  const dirty  = git(rootPath, 'status --porcelain');
  // Use %n (newline) as separator — safe on all platforms unlike pipe
  const logOut = git(rootPath, 'log -1 --format=%h%n%s%n%cr');
  const remote = git(rootPath, 'remote get-url origin');

  const commits = parseCommitBlock(logOut);

  return {
    hasGit: true,
    gitStatus: dirty ? 'dirty' : 'clean',
    currentBranch: branch || null,
    lastCommit: commits[0] ?? null,
    remoteUrl: remote || null,
  };
}

function getRecentCommits(rootPath: string): CommitInfo[] {
  const out = git(rootPath, 'log -8 --format=%h%n%s%n%cr');
  return parseCommitBlock(out);
}

function getDirtyFiles(rootPath: string): string[] {
  const out = git(rootPath, 'status --porcelain');
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(l => l.slice(3).trim()).slice(0, 20);
}

function getAheadBehind(rootPath: string): { ahead: number; behind: number } | null {
  const out = git(rootPath, 'rev-list --left-right --count HEAD...@{upstream}');
  if (!out) return null;
  const [a, b] = out.split('\t').map(Number);
  return { ahead: a ?? 0, behind: b ?? 0 };
}

// ── Package.json helpers ──────────────────────────────────────────────────────

function readPkg(rootPath: string): Record<string, any> | null {
  const pkgPath = path.join(rootPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return null; }
}

function allDeps(pkg: Record<string, any>): Record<string, string> {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

const SKIP_DEPS = new Set([
  'typescript','eslint','prettier','postcss','autoprefixer','tailwindcss',
  '@types/node','@types/react','@types/react-dom','@tailwindcss/postcss',
  'eslint-config-next','@eslint/eslintrc','jest','jest-environment-jsdom',
  'ts-jest','vitest','@vitejs/plugin-react','@testing-library/react',
  '@testing-library/dom','@testing-library/jest-dom','cross-env','concurrently',
  'wait-on','tailwind-merge','class-variance-authority','clsx','dotenv',
]);

function keyDepsFrom(pkg: Record<string, any>): string[] {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return Object.keys(deps)
    .filter(k => !SKIP_DEPS.has(k) && !k.startsWith('@types/') && !k.startsWith('@testing-library/'))
    .slice(0, 12);
}

function detectFramework(deps: Record<string, string>): string {
  if (deps.next)                  return 'Next.js';
  if (deps.expo)                  return 'Expo';
  if (deps['@capacitor/core'])    return 'React + Capacitor';
  if (deps.react && deps.vite)    return 'React + Vite';
  if (deps.react)                 return 'React';
  if (deps.express)               return 'Express';
  if (deps.fastapi || deps.flask) return 'Python';
  return 'Node.js';
}

function detectLanguage(rootPath: string): string {
  if (fs.existsSync(path.join(rootPath, 'tsconfig.json'))) return 'TypeScript';
  const pkg = readPkg(rootPath);
  if (pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript) return 'TypeScript';
  if (fs.readdirSync(rootPath).some(f => f.endsWith('.py'))) return 'Python';
  return 'JavaScript';
}

function detectDatabase(deps: Record<string, string>, rootPath: string): string | null {
  if (deps['@prisma/client'] || deps.prisma) {
    const schemas = ['prisma/schema.prisma', 'schema.prisma'];
    for (const s of schemas) {
      const sp = path.join(rootPath, s);
      if (fs.existsSync(sp)) {
        const m = fs.readFileSync(sp, 'utf8').match(/provider\s*=\s*"([^"]+)"/);
        if (m) return `Prisma (${m[1]})`;
      }
    }
    return 'Prisma';
  }
  if (deps['@supabase/supabase-js'])       return 'Supabase';
  if (deps['drizzle-orm'])                  return 'Drizzle ORM';
  if (deps.firebase || deps['firebase-admin']) return 'Firebase';
  if (deps.mongoose)                        return 'MongoDB';
  if (deps['better-sqlite3'] || deps.sqlite3) return 'SQLite';
  if (deps.pg)                              return 'PostgreSQL';
  return null;
}

function detectDeployment(rootPath: string): string | null {
  if (fs.existsSync(path.join(rootPath, 'vercel.json')))  return 'Vercel';
  if (fs.existsSync(path.join(rootPath, 'netlify.toml'))) return 'Netlify';
  if (fs.existsSync(path.join(rootPath, 'Dockerfile')))   return 'Docker';
  if (fs.existsSync(path.join(rootPath, '.github', 'workflows'))) return 'GitHub Actions';
  const pkg = readPkg(rootPath);
  if (pkg?.scripts?.deploy?.includes('vercel'))  return 'Vercel';
  return null;
}

function readDescription(rootPath: string, pkg: Record<string, any> | null): string {
  if (pkg?.description) return pkg.description;
  const readme = path.join(rootPath, 'README.md');
  if (!fs.existsSync(readme)) return '';
  try {
    const lines = fs.readFileSync(readme, 'utf8').split('\n').filter(l => l.trim());
    // Skip the heading, find first non-heading paragraph
    const para = lines.find(l => !l.startsWith('#') && l.trim().length > 20);
    return para?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`<>]/g, '').trim().slice(0, 140) ?? '';
  } catch { return ''; }
}

// ── Folder tree ───────────────────────────────────────────────────────────────

const SKIP_TREE = new Set(['node_modules','.git','.next','.expo','dist','build','__pycache__','.cache','coverage','.turbo','.vercel']);

function buildTree(dir: string, depth = 0, maxDepth = 2): TreeNode[] {
  if (depth >= maxDepth) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !SKIP_TREE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => ({
        name:    e.name,
        isDir:   e.isDirectory(),
        children: e.isDirectory() ? buildTree(path.join(dir, e.name), depth + 1, maxDepth) : [],
      }));
  } catch { return []; }
}

// ── File count ────────────────────────────────────────────────────────────────

function countFiles(dir: string): number {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_TREE.has(e.name) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
      else n++;
    }
  } catch {}
  return n;
}

// ── Dep grouping ──────────────────────────────────────────────────────────────

const DEP_GROUPS: Array<[string, RegExp]> = [
  ['Framework',  /^(next|react$|react-dom|vue|svelte|expo|@remix-run|vite$|@capacitor)/],
  ['Database',   /^(@prisma|prisma$|@supabase|drizzle-orm|firebase|mongoose|pg$|better-sqlite3|ioredis|redis$|@upstash)/],
  ['Auth',       /^(next-auth|@auth\/|better-auth|clerk|passport|jose$|bcrypt|jsonwebtoken)/],
  ['AI',         /^(@anthropic|openai|@google\/genai|@google\/generative|langchain|@genkit|genkit$)/],
  ['Payments',   /^(stripe$|@stripe)/],
  ['UI',         /^(@radix-ui|@headlessui|framer-motion|lucide-react|@heroicons|recharts|react-hot-toast)/],
  ['State',      /^(zustand|jotai|recoil|redux|@tanstack\/react-query|@reduxjs)/],
  ['Infra',      /^(puppeteer|playwright|cheerio|axios|node-fetch|undici|bullmq|ioredis|pino$|sentry|@sentry)/],
];

function groupDeps(deps: Record<string, string>): Record<string, Array<[string, string]>> {
  const result: Record<string, Array<[string, string]>> = {};
  const assigned = new Set<string>();

  for (const [group, re] of DEP_GROUPS) {
    const matched = Object.entries(deps).filter(([k]) => re.test(k));
    if (matched.length) { result[group] = matched; matched.forEach(([k]) => assigned.add(k)); }
  }

  const rest = Object.entries(deps).filter(([k]) =>
    !assigned.has(k) &&
    !SKIP_DEPS.has(k) &&
    !k.startsWith('@types/') &&
    !k.startsWith('@testing-library/')
  );
  if (rest.length) result['Other'] = rest;

  return result;
}

// ── Related brain notes ───────────────────────────────────────────────────────

const INDEX_PATH = path.join(process.cwd(), '..', 'output', 'index.json');

function relatedNotes(folderName: string, displayName: string): Array<{ path: string; name: string; origin: string }> {
  try {
    if (!fs.existsSync(INDEX_PATH)) return [];
    const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    const terms = [folderName, displayName].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return (idx.files as any[])
      .filter((f: any) => {
        if (f.origin !== 'brain' || !['.md', '.mdx'].includes(f.ext)) return false;
        const haystack = f.path.toLowerCase().replace(/[^a-z0-9]/g, '');
        return terms.some(t => t.length > 3 && haystack.includes(t));
      })
      .slice(0, 8)
      .map((f: any) => ({ path: f.path, name: f.name, origin: f.origin }));
  } catch { return []; }
}

// ── Related agents ────────────────────────────────────────────────────────────

const AGENT_DIR = 'C:\\Users\\Tyson\\brain\\agents';

function relatedAgents(framework: string, folderName: string): string[] {
  try {
    if (!fs.existsSync(AGENT_DIR)) return [];
    const agents: string[] = [];
    for (const file of fs.readdirSync(AGENT_DIR)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(AGENT_DIR, file), 'utf8').toLowerCase();
      const agentName = path.basename(file, '.md');
      // Match if agent content references the framework or folder name
      const terms = [framework.toLowerCase().split(' ')[0], folderName.toLowerCase().split(/[-_.]/)[0]];
      if (terms.some(t => t.length > 2 && content.includes(t))) {
        agents.push(agentName.charAt(0).toUpperCase() + agentName.slice(1));
      }
    }
    return agents;
  } catch { return []; }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getAllProjectCards(): ProjectCard[] {
  return DEFS
    .filter(d => fs.existsSync(d.path))
    .map(d => {
      const pkg   = readPkg(d.path);
      const deps  = pkg ? allDeps(pkg) : {};
      const gitInfo = getGitCard(d.path);

      return {
        slug:        slugify(d.folder),
        folderName:  d.folder,
        displayName: d.displayName,
        description: readDescription(d.path, pkg),
        rootPath:    d.path,
        framework:   pkg ? detectFramework(deps) : 'Unknown',
        language:    detectLanguage(d.path),
        database:    pkg ? detectDatabase(deps, d.path) : null,
        deployment:  detectDeployment(d.path),
        keyDeps:     pkg ? keyDepsFrom(pkg) : [],
        ...gitInfo,
      };
    });
}

export function getProjectDetail(slug: string): ProjectDetail | null {
  const def = DEFS.find(d => slugify(d.folder) === slug);
  if (!def || !fs.existsSync(def.path)) return null;

  const pkg    = readPkg(def.path);
  const deps   = pkg ? allDeps(pkg) : {};
  const gitInfo = getGitCard(def.path);

  const card: ProjectCard = {
    slug,
    folderName:  def.folder,
    displayName: def.displayName,
    description: readDescription(def.path, pkg),
    rootPath:    def.path,
    framework:   pkg ? detectFramework(deps) : 'Unknown',
    language:    detectLanguage(def.path),
    database:    pkg ? detectDatabase(deps, def.path) : null,
    deployment:  detectDeployment(def.path),
    keyDeps:     pkg ? keyDepsFrom(pkg) : [],
    ...gitInfo,
  };

  return {
    ...card,
    allDeps:       deps,
    groupedDeps:   groupDeps(deps),
    recentCommits: card.hasGit ? getRecentCommits(def.path) : [],
    dirtyFiles:    card.hasGit ? getDirtyFiles(def.path) : [],
    folderTree:    buildTree(def.path),
    relatedNotes:  relatedNotes(def.folder, def.displayName),
    relatedAgents: relatedAgents(card.framework, def.folder),
    aheadBehind:   card.hasGit ? getAheadBehind(def.path) : null,
    fileCount:     countFiles(def.path),
  };
}
