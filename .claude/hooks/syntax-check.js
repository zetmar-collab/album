#!/usr/bin/env node
// PostToolUse (Write|Edit): sprawdza skladnie edytowanego pliku .js przez `node --check`
// i odsyla blad do Claude, zeby mogl go od razu poprawic.
const { execFileSync } = require('child_process');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const filePath = payload && payload.tool_input && payload.tool_input.file_path;
  if (!filePath || !filePath.endsWith('.js')) process.exit(0);

  try {
    execFileSync('node', ['--check', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    process.exit(0);
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim();
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'Blad skladni w ' + filePath + ':\n' + msg
    }));
    process.exit(0);
  }
});
