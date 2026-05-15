#!/usr/bin/env node
// tests/golden-sets/validate-all.js
// Runs validation for ALL sets that have results captured.
// Usage: node tests/golden-sets/validate-all.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

if (!fs.existsSync(RESULTS_DIR)) {
  console.error('No results/ directory found. Run sets through the app first.');
  process.exit(1);
}

const resultFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
const setsWithResults = [...new Set(resultFiles.map(f => f.replace(/-run.*\.json$/, '')))];

if (setsWithResults.length === 0) {
  console.log('No results captured yet.\n');
  console.log('To capture results for a set:');
  console.log('  1. Upload the documents in the app');
  console.log('  2. Open browser console (F12)');
  console.log('  3. Run: copy(JSON.stringify({analysisResults, coherenceResult}))');
  console.log('  4. Save to: tests/golden-sets/results/<set-id>-run.json\n');
  console.log('Available sets:');
  MANIFEST.sets.forEach(s => console.log(`  ${s.id} — ${s.description.substring(0, 60)}`));
  process.exit(0);
}

console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  GOLDEN SET VALIDATION — ALL SETS                           ║`);
console.log(`║  Sets with results: ${String(setsWithResults.length).padEnd(40)}║`);
console.log(`║  Sets pending: ${String(MANIFEST.sets.length - setsWithResults.length).padEnd(45)}║`);
console.log(`╚══════════════════════════════════════════════════════════════╝`);

let totalPassed = 0, totalFailed = 0;

for (const setId of setsWithResults.sort()) {
  try {
    execSync(`node "${path.join(__dirname, 'validate-run.js')}" ${setId}`, { stdio: 'inherit' });
    totalPassed++;
  } catch (e) {
    totalFailed++;
  }
}

// Show which sets are missing
const missing = MANIFEST.sets.filter(s => !setsWithResults.includes(s.id));
if (missing.length > 0) {
  console.log('\n── Sets without results (not yet tested) ──');
  missing.forEach(s => console.log(`  ○ ${s.id} — ${s.description.substring(0, 55)}`));
}

console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`  TOTAL: ${totalPassed} sets passed, ${totalFailed} sets failed, ${missing.length} pending`);
console.log(`══════════════════════════════════════════════════════════════\n`);

process.exit(totalFailed > 0 ? 1 : 0);
