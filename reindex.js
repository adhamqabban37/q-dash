'use strict';

const fs   = require('fs');
const path = require('path');

const { scan }       = require('./core/scanner');
const { classify }   = require('./core/classifier');
const { buildGraph } = require('./core/graphBuilder');
const { collectCodeGraphs } = require('./core/graphifyBridge');

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const raw        = scan();
const classified = classify(raw);
const graph      = buildGraph(classified);

const index = {
  generated: new Date().toISOString(),
  total: classified.length,
  files: [], skills: [], projects: [], apis: [], agents: [], unknown: [],
};
for (const file of classified) {
  const entry = {
    path: file.path, name: file.name, ext: file.ext,
    size: file.size, modified: file.modified, origin: file.origin,
    type: file.type, category: file.category, subcategory: file.subcategory,
    tags: file.tags || [], wikiLinks: file.wikiLinks || [],
    hasFrontmatter: file.hasFrontmatter || false,
  };
  index.files.push(entry);
  if (file.type === 'skill')        index.skills.push(entry);
  else if (file.type === 'project') index.projects.push(entry);
  else if (file.type === 'api')     index.apis.push(entry);
  else if (file.type === 'agent')   index.agents.push(entry);
  else if (file.type === 'unknown') index.unknown.push(entry);
}

fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, 'graph.json'), JSON.stringify(graph, null, 2));

const codeGraphs = collectCodeGraphs();
fs.writeFileSync(path.join(OUTPUT_DIR, 'code-graphs.json'), JSON.stringify(codeGraphs, null, 2));

const agentSkills = classified.filter(f => f.origin === 'agents-skills');

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║         Q DASH REINDEX COMPLETE           ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`  Files:    ${index.total}`);
console.log(`  Skills:   ${index.skills.length}  (${agentSkills.length} from .agents/skills)`);
console.log(`  Agents:   ${index.agents.length}`);
console.log(`  Projects: ${index.projects.length}`);
console.log(`  Graph:    ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
console.log(`  CodeGraphs: ${codeGraphs.total} project knowledge graph(s)`);
console.log('');
console.log('  .agents/skills dirs scanned:');
const skillDirs = [...new Set(agentSkills.map(f => path.dirname(f.path).split(path.sep).slice(-1)[0]))];
skillDirs.sort().forEach(d => console.log(`    - ${d}`));
console.log('');
