'use strict';

const path = require('path');

const FRAMEWORK_KEYWORDS = {
  'Next.js':           ['react', 'next', 'nextjs'],
  'Expo':              ['expo', 'react-native', 'mobile'],
  'React + Capacitor': ['react', 'capacitor', 'mobile'],
  'React + Vite':      ['react', 'vite'],
  'React':             ['react'],
  'Node.js':           ['node', 'express', 'api'],
  'Python':            ['python', 'django', 'flask', 'fastapi'],
};

function makeNodeId(filePath) {
  return filePath.replace(/\\\\/g, '/').replace(/[^a-zA-Z0-9/._-]/g, '_');
}

function getParentFolder(filePath) {
  return path.dirname(filePath).replace(/\\\\/g, '/');
}

function buildGraph(classifiedFiles) {
  console.log(`[graphBuilder] Building graph from ${classifiedFiles.length} nodes...`);

  const nodes = [];
  const edges = [];
  const edgeSet = new Set();
  const nodeMap = new Map();
  const folderNodes = new Map();

  // ── Step 1: Create all file nodes ─────────────────────────────────────────────
  for (const file of classifiedFiles) {
    const id = makeNodeId(file.path);
    const node = {
      id,
      label: file.name,
      type: file.type,
      category: file.category,
      subcategory: file.subcategory,
      origin: file.origin,
      path: file.path,
      ext: file.ext,
      size: file.size,
      modified: file.modified,
      tags: file.tags || [],
      wikiLinks: file.wikiLinks || [],
      ...(file.projectName  ? { projectName:  file.projectName  } : {}),
      ...(file.framework    ? { framework:    file.framework    } : {}),
      ...(file.language     ? { language:     file.language     } : {}),
      ...(file.database     ? { database:     file.database     } : {}),
      ...(file.deployment   ? { deployment:   file.deployment   } : {}),
      ...(file.hasGit !== undefined ? { hasGit: file.hasGit }   : {}),
    };
    nodes.push(node);
    nodeMap.set(file.path.replace(/\\\\/g, '/'), id);
    nodeMap.set(file.name.toLowerCase(), id);
  }

  function addEdge(source, target, relation, weight = 1) {
    if (!source || !target || source === target) return;
    const key = `${source}|${target}|${relation}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source, target, relation, weight });
  }

  // ── Step 2: Filesystem Hierarchy (The Spine) ──────────────────────────────────
  for (const file of classifiedFiles) {
    const filePath = file.path.replace(/\\\\/g, '/');
    const segments = filePath.split('/');
    
    let currentPath = '';
    for (let i = 0; i < segments.length - 1; i++) {
      currentPath += (currentPath ? '/' : '') + segments[i];
      const folderId = `dir:${currentPath}`;
      
      if (!folderNodes.has(folderId)) {
        nodes.push({
          id: folderId,
          label: path.basename(currentPath) || 'root',
          type: 'folder',
          origin: file.origin,
          path: currentPath
        });
        folderNodes.set(folderId, true);
      }

      if (i === segments.length - 2) {
        addEdge(folderId, makeNodeId(file.path), 'contains');
      }
      
      if (i > 0) {
        const parentPath = segments.slice(0, i).join('/');
        addEdge(`dir:${parentPath}`, folderId, 'parent-of');
      }
    }
  }

  // ── Step 3: Project Hubs (Gravity Centers) ────────────────────────────────────
  for (const file of classifiedFiles) {
    if (file.name === 'package.json') {
      const projectRoot = getParentFolder(file.path);
      const projectId = `proj:${projectRoot}`;
      
      if (!nodes.find(n => n.id === projectId)) {
        nodes.push({
          id: projectId,
          label: `Project: ${path.basename(projectRoot)}`,
          type: 'project-hub',
          origin: file.origin,
          path: projectRoot
        });
      }

      for (const other of classifiedFiles) {
        const otherPath = other.path.replace(/\\\\/g, '/');
        if (otherPath.startsWith(projectRoot)) {
          addEdge(projectId, makeNodeId(other.path), 'project-member');
        }
      }
    }
  }

  // ── Step 4: Semantic Connectivity ─────────────────────────────────────────────
  // Wiki Links
  for (const file of classifiedFiles) {
    if (!file.wikiLinks || file.wikiLinks.length === 0) continue;
    const sourceId = makeNodeId(file.path);
    for (const link of file.wikiLinks) {
      const lowerLink = link.toLowerCase().replace(/\\s+/g, '_');
      const targetId = nodeMap.get(lowerLink) || 
                       nodeMap.get(link.toLowerCase()) || 
                       [...nodeMap.entries()].find(([k]) => k.includes(lowerLink))?.[1];
      if (targetId) addEdge(sourceId, targetId, 'wiki-link', 2);
    }
  }

  // Shared Tags
  const tagMap = new Map();
  for (const file of classifiedFiles) {
    if (!file.tags || file.tags.length === 0) continue;
    const id = makeNodeId(file.path);
    for (const tag of file.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(id);
    }
  }

  for (const [tag, ids] of tagMap.entries()) {
    const tagNodeId = `tag:${tag}`;
    nodes.push({ id: tagNodeId, label: `#${tag}`, type: 'tag' });
    for (const id of ids) addEdge(tagNodeId, id, 'has-tag');
  }

  // Agent Uses Skill
  for (const file of classifiedFiles) {
    if (file.type !== 'agent') continue;
    const fm = file.frontmatter || {};
    const skillList = Array.isArray(fm.skills) ? fm.skills : (String(fm.skills || '').split(',').map(s => s.trim()).filter(Boolean));
    const agentId = makeNodeId(file.path);

    for (const skillName of skillList) {
      const lower = skillName.toLowerCase().trim().replace(/\\s+/g, '-');
      const targetId = nodeMap.get(lower) || 
                       nodeMap.get(lower + '.md') || 
                       [...nodeMap.entries()].find(([k]) => k.includes('/' + lower + '/'))?.[1];
      if (targetId) addEdge(agentId, targetId, 'agent-uses', 3);
    }
  }

  console.log(`[graphBuilder] Graph Optimized: ${nodes.length} nodes, ${edges.length} edges`);
  return { nodes, edges };
}

module.exports = { buildGraph };
