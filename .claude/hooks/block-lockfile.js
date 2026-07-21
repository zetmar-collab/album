#!/usr/bin/env node
// PreToolUse (Write|Edit): blokuje reczna edycje package-lock.json — powinien
// zmieniac sie tylko przez `npm install`.
const path = require('path');

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
  if (!filePath || path.basename(filePath) !== 'package-lock.json') process.exit(0);

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'package-lock.json zmienia sie tylko przez "npm install", nie recznie.'
    }
  }));
  process.exit(0);
});
