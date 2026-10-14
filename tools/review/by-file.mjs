// Error counts per file from an ESLint JSON report, optionally the findings
// of one file. Usage: node by-file.mjs report.json [path-substring]
import fs from 'node:fs';

const [file, only] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const counts = new Map();
let total = 0;
for (const result of report) {
  const name = result.filePath.replace(/.*Obsidian-Surfing[\\/]/, '').replace(/\\/g, '/');
  for (const m of result.messages) {
    if (m.severity !== 2) continue;
    total++;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (only && name.includes(only)) console.log(`${name}:${m.line}:${m.column} ${m.ruleId} ${m.message.slice(0, 90)}`);
  }
}
if (!only) {
  console.log('errors', total);
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), name);
}
