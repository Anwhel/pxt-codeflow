// Prints pseudocode + Mermaid for each sample and checks the Mermaid parses.
// Usage: node test/run.js [--mermaid]
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Codeflow = require('../docs/codeflow.js');

const dir = path.join(__dirname, 'samples');
const showMermaid = process.argv.includes('--mermaid');
let failures = 0;

for (const file of fs.readdirSync(dir)) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const result = Codeflow.analyse(src, ts);
  console.log(`\n=================== ${file} ===================`);
  for (const w of result.warnings) console.log('WARNING:', w);
  for (const s of result.sections) {
    console.log('');
    for (const l of s.lines) console.log('    '.repeat(l.depth) + l.text);
    if (showMermaid) console.log('\n' + s.mermaid);
    // Every edge must point at a declared node.
    const ids = new Set([...s.mermaid.matchAll(/^\s+(\w+)[\[({]/gm)].map(m => m[1]));
    for (const m of s.mermaid.matchAll(/^\s+(\w+) -->(?:\|[^|]*\|)? (\w+)$/gm)) {
      if (!ids.has(m[1]) || !ids.has(m[2])) { failures++; console.log('BAD EDGE', m[0]); }
    }
    for (const l of s.lines) {
      if (l.nodeId && !ids.has(l.nodeId)) { failures++; console.log('BAD LINE LINK', l.text); }
    }
  }
}
if (failures) { console.log(`\n${failures} problem(s)`); process.exit(1); }
console.log('\nAll sections OK');
