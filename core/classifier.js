'use strict';

const fs = require('fs');
const path = require('path');

let matter;
try {
  matter = require('gray-matter');
} catch {
  matter = null;
}

function fsExistsSync(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function detectFramework(deps) {
  if ('next' in deps) return 'Next.js';
  if ('expo' in deps) return 'Expo';
  if ('@capacitor/core' in deps) return 'React + Capacitor';
  if ('react-native' in deps) return 'React Native';
  if ('vite' in deps && 'react' in deps) return 'React + Vite';
  if ('react' in deps) return 'React';
  if ('express' in deps || 'fastify' in deps || '@hapi/hapi' in deps) return 'Node.js';
  return 'Unknown';
}

function detectDatabase(deps, pkg) {
  if ('prisma' in deps || '@prisma/client' in deps) {
    const gen = pkg?.prisma?.generator?.[0]?.provider;
    return gen ? `Prisma (${gen})` : 'Prisma';
  }
  if ('mongoose' in deps) return 'MongoDB';
  if ('@supabase/supabase-js' in deps) return 'Supabase';
  if ('pg' in deps || '@vercel/postgres' in deps || '@neondatabase/serverless' in deps) return 'PostgreSQL';
  if ('mysql2' in deps || 'mysql' in deps) return 'MySQL';
  if ('better-sqlite3' in deps || 'sqlite3' in deps) return 'SQLite';
  if ('firebase' in deps || 'firebase-admin' in deps) return 'Firebase';
  return null;
}

function detectDeployment(projectDir, deps) {
  if (fsExistsSync(path.join(projectDir, 'vercel.json')) || '@vercel/node' in deps) return 'Vercel';
  if (fsExistsSync(path.join(projectDir, 'render.yaml'))) return 'Render';
  if (fsExistsSync(path.join(projectDir, 'railway.json'))) return 'Railway';
  if (fsExistsSync(path.join(projectDir, 'fly.toml'))) return 'Fly.io';
  if (fsExistsSync(path.join(projectDir, 'Procfile'))) return 'Heroku';
  if (fsExistsSync(path.join(projectDir, 'Dockerfile'))) return 'Docker';
  if (fsExistsSync(path.join(projectDir, '.github', 'workflows'))) return 'GitHub Actions';
  return null;
}

function detectHasGit(dir) {
  let current = dir;
  for (let i = 0; i < 4; i++) {
    if (fsExistsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

const CONFIG_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'package.json', 'tsconfig.json', 'jsconfig.json',
  '.eslintrc', '.prettierrc', 'babel.config.js', 'vite.config.js',
  'webpack.config.js', 'rollup.config.js', 'tailwind.config.js',
  'next.config.js', 'nuxt.config.js', 'astro.config.js',
  'capacitor.config.ts', 'capacitor.config.json',
  'app.json', 'eas.json', 'metro.config.js',
]);

const API_EXTENSIONS = new Set(['.yaml', '.yml', '.toml']);

function readContent(filePath, ext) {
  if (!['.md', '.mdx', '.txt', '.json'].includes(ext)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extractFrontmatter(content, filePath) {
  if (!matter || !content) return { data: {}, hasFrontmatter: false };
  try {
    const parsed = matter(content);
    const hasFrontmatter = Object.keys(parsed.data).length > 0;
    return { data: parsed.data, content: parsed.content, hasFrontmatter };
  } catch {
    return { data: {}, hasFrontmatter: false };
  }
}

function extractWikiLinks(content) {
  if (!content) return [];
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
  return matches.map(m => m.slice(2, -2).trim());
}

function extractTags(content) {
  if (!content) return [];
  const matches = content.match(/#([a-zA-Z0-9_-]+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

function classifyFile(file) {
  const { path: filePath, name, ext, origin } = file;
  const parts = filePath.replace(/\\/g, '/').split('/');

  let type = 'unknown';
  let category = 'uncategorized';
  let tags = [];
  let wikiLinks = [];
  let frontmatter = {};
  let hasFrontmatter = false;

  // Read content for text-based files
  const content = readContent(filePath, ext);
  if (content) {
    const fm = extractFrontmatter(content, filePath);
    frontmatter = fm.data;
    hasFrontmatter = fm.hasFrontmatter;
    wikiLinks = extractWikiLinks(content);
    tags = extractTags(content);

    // Override with frontmatter type if present
    if (frontmatter.type) {
      type = frontmatter.type;
    }
    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
      tags = [...new Set([...tags, ...frontmatter.tags])];
    }
  }

  // Classification rules
  if (!frontmatter.type) {
    if (origin === 'gstack') {
      type = 'skill';
      category = 'tool';
    } else if (origin === 'agents-skills') {
      type = 'skill';
      category = 'user-skill';
    } else if (origin === 'brain') {
      const normPath = parts.map(p => p.toLowerCase());
      // Brain subfolder-based classification
      if (normPath.includes('skills')) {
        type = 'skill';
        category = 'brain-skill';
      } else if (normPath.includes('agents')) {
        type = 'agent';
        category = 'brain-agent';
      } else if (normPath.includes('projects')) {
        type = 'note';
        category = 'project-note';
      } else if (normPath.includes('ideas')) {
        type = 'note';
        category = 'idea-note';
      } else if (['.md', '.mdx'].includes(ext)) {
        type = 'note';
        category = 'knowledge';
      } else if (['.json'].includes(ext)) {
        type = 'config';
        category = 'brain-config';
      } else {
        type = 'note';
        category = 'brain-asset';
      }
    } else if (origin === 'claude-skills') {
      type = 'skill';
      category = 'claude-skill';
    } else if (origin === 'gemini-agents') {
      type = 'skill';
      category = 'gemini-skill';
    } else if (origin === 'agents-skills') {
      type = 'skill';
      category = 'user-skill';
    } else if (origin === 'Desktop') {
      if (name === 'package.json') {
        type = 'project';
        category = 'node-project';
      } else if (CONFIG_FILES.has(name)) {
        type = 'config';
        category = 'project-config';
      } else if (ext === '.env' || name.startsWith('.env')) {
        type = 'api';
        category = 'environment';
      } else if (['.md', '.mdx'].includes(ext)) {
        type = 'note';
        category = 'documentation';
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        type = 'project';
        category = 'source-code';
      } else if (API_EXTENSIONS.has(ext)) {
        type = 'api';
        category = 'api-spec';
      }
    }

    // Config files override regardless of origin
    if (CONFIG_FILES.has(name)) {
      type = 'config';
    }
    if (ext === '.env' || name.startsWith('.env')) {
      type = 'api';
      category = 'environment';
    }
  }

  // Detect project roots: any folder with package.json nearby
  if (name === 'package.json') {
    type = 'project';
    category = 'node-project';
    let pkgData = {};
    try {
      pkgData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}

    const projectDir = path.dirname(filePath);
    const allDeps = { ...pkgData.dependencies, ...pkgData.devDependencies };
    const framework  = detectFramework(allDeps);
    const language   = ('typescript' in allDeps || '@types/node' in allDeps || 'ts-node' in allDeps) ? 'TypeScript' : 'JavaScript';
    const database   = detectDatabase(allDeps, pkgData);
    const deployment = detectDeployment(projectDir, allDeps);
    const hasGit     = detectHasGit(projectDir);

    return {
      ...file,
      type,
      category,
      subcategory: pkgData.description ? 'described-project' : 'bare-project',
      tags,
      wikiLinks,
      frontmatter,
      hasFrontmatter: true,
      projectName: pkgData.name || path.basename(projectDir),
      projectVersion: pkgData.version || null,
      framework,
      language,
      database,
      deployment,
      hasGit,
    };
  }

  const subcategory = frontmatter.subcategory || deriveSubcategory(type, ext, parts);

  return {
    ...file,
    type,
    category,
    subcategory,
    tags,
    wikiLinks,
    frontmatter,
    hasFrontmatter,
  };
}

function deriveSubcategory(type, ext, parts) {
  if (type === 'agent') {
    return 'agent-persona';
  }
  if (type === 'skill') {
    if (ext === '.md') return 'skill-doc';
    if (['.js', '.ts'].includes(ext)) return 'skill-script';
    if (ext === '.json') return 'skill-config';
    return 'skill-asset';
  }
  if (type === 'note') {
    if (parts.some(p => p.toLowerCase().includes('project'))) return 'project-note';
    if (parts.some(p => p.toLowerCase().includes('idea'))) return 'idea-note';
    return 'general-note';
  }
  if (type === 'project') {
    if (['.js', '.ts'].includes(ext)) return 'js-project';
    return 'generic-project';
  }
  return 'general';
}

function classify(files) {
  console.log(`[classifier] Classifying ${files.length} files...`);
  const classified = files.map(classifyFile);

  const summary = classified.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});

  console.log('[classifier] Type breakdown:', summary);
  return classified;
}

// Single-file classification without console noise (used by incremental updater)
function classifyOne(file) {
  return classifyFile(file);
}

module.exports = { classify, classifyOne };
