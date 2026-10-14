// Summarizes an ESLint JSON report: counts per rule, and the findings
// outside the given rule pattern. Usage: node summary.mjs report.json [skipRegex]
import fs from 'node:fs';

const [file, skip = '^$'] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const skipRe = new RegExp(skip);
const counts = new Map();
let errors = 0, warnings = 0;
const listed = [];
for (const result of report) {
  for (const m of result.messages) {
    const key = `${m.severity === 2 ? 'E' : 'W'} ${m.ruleId ?? 'fatal'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (m.severity === 2) errors++; else warnings++;
    if (!skipRe.test(m.ruleId ?? '')) listed.push(`${key}  ${result.filePath.replace(/.*Obsidian-Surfing[\\/]/, '')}:${m.line}  ${m.message.slice(0, 100)}`);
  }
}
console.log(`errors ${errors}, warnings ${warnings}`);
for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), key);
console.log(listed.sort().join('\n'));
