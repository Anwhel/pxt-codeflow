// Prints pseudocode for every sample and checks each flowchart is well formed.
//   .ts samples -> MakeCode converter, .cs samples -> Unity (C#) converter
// Usage: node test/run.js [--mermaid] [name-filter]
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Parser = require('web-tree-sitter');
const Codeflow = require('../docs/codeflow.js');
const CodeflowCSharp = require('../docs/codeflow-csharp.js');

const dir = path.join(__dirname, 'samples');
const showMermaid = process.argv.includes('--mermaid');
const filter = process.argv.slice(2).find(a => !a.startsWith('--'));

async function csharpParser() {
  await Parser.init();
  const wasm = require.resolve('tree-sitter-c-sharp/tree-sitter-c_sharp.wasm');
  const lang = await Parser.Language.load(wasm);
  const p = new Parser();
  p.setLanguage(lang);
  return p;
}

(async () => {
  const cs = await csharpParser();
  let failures = 0;
  for (const file of fs.readdirSync(dir).sort()) {
    if (filter && !file.includes(filter)) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const result = file.endsWith('.cs') ? CodeflowCSharp.analyse(src, cs) : Codeflow.analyse(src, ts);
    console.log(`\n=================== ${file} ===================`);
    for (const w of result.warnings) { console.log('WARNING:', w); failures++; }
    for (const s of result.sections) {
      console.log('');
      for (const l of s.lines) console.log('    '.repeat(l.depth) + l.text);
      if (!s.mermaid) continue;
      if (showMermaid) console.log('\n' + s.mermaid);
      // Every edge and every linked line must point at a declared node.
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
})();
