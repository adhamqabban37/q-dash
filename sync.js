// npm run sync  -- writes a timestamp file that the API uses to check freshness
// This bridges the live engine output to the Next.js Vercel-style build
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'output');
const UI_OUT = path.join(__dirname, 'ui', 'public', 'api-cache');

function copyFresh(name) {
  const src = path.join(OUTPUT, name);
  const dst = path.join(UI_OUT, name);
  if (!fs.existsSync(src)) return false;
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  } catch { return false; }
}

fs.mkdirSync(UI_OUT, { recursive: true });

['index.json', 'graph.json', 'events.log.json', 'semantic-events.json',
 'sessions.json', 'heatmap.json', 'insights.json', 'code-graphs.json'].forEach(f => {
  if (copyFresh(f)) console.log(`  synced: ${f}`);
});

fs.writeFileSync(
  path.join(UI_OUT, '.last-sync'),
  new Date().toISOString()
);

console.log('\nSync complete to ui/public/api-cache/');
