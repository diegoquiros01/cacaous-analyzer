#!/usr/bin/env node
// tests/golden-sets/validate-run.js
// Validates a DocsValidate run against the golden set manifest.
//
// USAGE:
//   1. Run a set through the app (docsvalidate.com or localhost)
//   2. Open browser console, copy the extraction results:
//        copy(JSON.stringify({analysisResults, coherenceResult}))
//   3. Save to: tests/golden-sets/results/set-XX-run.json
//   4. Run: node tests/golden-sets/validate-run.js set-11
//
// This validates:
//   - Did the tool detect expected issues? (must-detect errors)
//   - Did the tool produce known false positives? (extraction bugs)
//   - Are key extracted values correct? (invoice numbers, BL, weights)
//   - What is the verdict? (approved/warning/rejected)

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, warnings = 0;

function pass(msg) { passed++; console.log(`  ✓ ${msg}`); }
function fail(msg) { failed++; console.error(`  ✗ FAIL: ${msg}`); }
function warn(msg) { warnings++; console.warn(`  ⚠ WARN: ${msg}`); }
function section(name) { console.log(`\n── ${name} ──`); }

// ── Main ─────────────────────────────────────────────────────────────────────
const setId = process.argv[2];
if (!setId) {
  console.log('Usage: node validate-run.js <set-id>');
  console.log('Available sets:');
  MANIFEST.sets.forEach(s => console.log(`  ${s.id} — ${s.description.substring(0, 60)}...`));
  process.exit(0);
}

const setDef = MANIFEST.sets.find(s => s.id === setId);
if (!setDef) {
  console.error(`Set "${setId}" not found in manifest.`);
  process.exit(1);
}

// Find the most recent run file for this set
const runFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.startsWith(setId) && f.endsWith('.json'));
if (runFiles.length === 0) {
  console.error(`No run results found for ${setId} in ${RESULTS_DIR}/`);
  console.error(`Run the set through the app, then save results to: ${RESULTS_DIR}/${setId}-run.json`);
  console.error('');
  console.error('HOW TO CAPTURE RESULTS:');
  console.error('  1. Open the app and upload the documents');
  console.error('  2. Wait for analysis to complete');
  console.error('  3. Open browser console (F12)');
  console.error('  4. Run: copy(JSON.stringify({analysisResults, coherenceResult}))');
  console.error(`  5. Create file: ${RESULTS_DIR}/${setId}-run.json and paste`);
  process.exit(1);
}

const latestRun = runFiles.sort().pop();
console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  GOLDEN SET VALIDATION: ${setId.padEnd(37)}║`);
console.log(`║  ${setDef.description.substring(0, 60).padEnd(60)}║`);
console.log(`║  Run file: ${latestRun.padEnd(49)}║`);
console.log(`╚══════════════════════════════════════════════════════════════╝`);

const run = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, latestRun), 'utf8'));
const { analysisResults, coherenceResult } = run;

if (!analysisResults) {
  fail('analysisResults is missing from run file');
  process.exit(1);
}

// ── 1. Document Count ────────────────────────────────────────────────────────
section('Document Count');
const extractedDocs = Object.keys(analysisResults);
const totalExtracted = extractedDocs.reduce((sum, key) => {
  const val = analysisResults[key];
  return sum + (Array.isArray(val) ? val.length : 1);
}, 0);

if (totalExtracted >= setDef.docCount) {
  pass(`Extracted ${totalExtracted} documents from ${extractedDocs.length} files (expected >= ${setDef.docCount})`);
} else {
  warn(`Extracted ${totalExtracted} documents from ${extractedDocs.length} files (expected >= ${setDef.docCount})`);
}

// ── 2. Key Extractions ──────────────────────────────────────────────────────
if (setDef.expectedExtractions) {
  section('Key Extractions');
  const allDocs = [];
  Object.values(analysisResults).forEach(v => {
    (Array.isArray(v) ? v : [v]).forEach(d => { if (!d._err) allDocs.push(d); });
  });

  for (const [field, expected] of Object.entries(setDef.expectedExtractions)) {
    if (field.includes('_')) continue; // Skip compound keys like invoiceNumber_majority

    const values = allDocs
      .map(d => d[field])
      .filter(v => v != null && v !== '' && v !== 'null');

    if (values.length === 0) {
      fail(`${field}: not extracted in any document (expected: ${expected})`);
      continue;
    }

    const flatValues = values.flat().map(v => String(v).toLowerCase().trim());
    const expectedLower = Array.isArray(expected)
      ? expected.map(e => e.toLowerCase())
      : [String(expected).toLowerCase()];

    if (typeof expected === 'string' && expected.startsWith('should ')) {
      // Qualitative check — just report values
      pass(`${field}: found ${[...new Set(flatValues)].length} unique values — ${[...new Set(flatValues)].slice(0, 3).join(', ')}`);
    } else {
      const found = expectedLower.some(exp => flatValues.some(v => v.includes(exp)));
      if (found) {
        pass(`${field}: correctly extracted (${[...new Set(flatValues)].slice(0, 2).join(', ')})`);
      } else {
        fail(`${field}: expected "${expected}" but found "${[...new Set(flatValues)].slice(0, 3).join(', ')}"`);
      }
    }
  }
}

// ── 3. Must-Detect Issues ───────────────────────────────────────────────────
if (setDef.expectedIssues && setDef.expectedIssues.length > 0) {
  section('Must-Detect Issues');

  const cohIssues = coherenceResult?.coherenceIssues || [];
  const cohText = JSON.stringify(coherenceResult || {}).toLowerCase();

  for (const expected of setDef.expectedIssues) {
    if (!expected.mustDetect) continue;

    const fieldLower = (expected.field || '').toLowerCase();
    const found = cohIssues.some(issue => {
      const issueText = JSON.stringify(issue).toLowerCase();
      return issueText.includes(fieldLower) ||
        (expected.description && issueText.includes(expected.description.substring(0, 30).toLowerCase()));
    }) || cohText.includes(fieldLower);

    if (found) {
      pass(`Detected: ${expected.field} — ${expected.description.substring(0, 60)}`);
    } else {
      fail(`NOT DETECTED: ${expected.field} — ${expected.description}`);
    }
  }
}

// ── 4. Known False Positives ────────────────────────────────────────────────
if (setDef.knownFalsePositives && setDef.knownFalsePositives.length > 0) {
  section('Known False Positives (should NOT appear)');

  const allDocs = [];
  Object.values(analysisResults).forEach(v => {
    (Array.isArray(v) ? v : [v]).forEach(d => { if (!d._err) allDocs.push(d); });
  });

  for (const fp of setDef.knownFalsePositives) {
    if (fp.wrongValue) {
      // Check if any doc extracted the wrong value
      const badExtractions = allDocs.filter(d => {
        const val = String(d[fp.field] || '');
        return val.includes(fp.wrongValue);
      });

      if (badExtractions.length > 0) {
        fail(`EXTRACTION BUG: ${fp.field} extracted as "${fp.wrongValue}" instead of "${fp.correctValue}" in ${badExtractions.length} doc(s): ${badExtractions.map(d => d._filename || d.docType).join(', ')}`);
      } else {
        pass(`${fp.field}: correctly extracted (no "${fp.wrongValue}" found)`);
      }
    } else {
      // Check if coherence flagged this as an error (it shouldn't)
      const cohIssues = coherenceResult?.coherenceIssues || [];
      const flagged = cohIssues.filter(issue => {
        const issueText = JSON.stringify(issue).toLowerCase();
        return issueText.includes(fp.field.toLowerCase()) &&
          (issue.type === 'error');
      });

      if (flagged.length > 0) {
        warn(`${fp.field}: flagged as error but ${fp.expectedBehavior}. ${fp.description}`);
      } else {
        pass(`${fp.field}: not flagged as error (correct)`);
      }
    }
  }
}

// ── 5. Verdict ──────────────────────────────────────────────────────────────
if (setDef.expectedVerdict && !setDef.expectedVerdict.startsWith('check')) {
  section('Verdict');

  const verdict = coherenceResult?.verdict ||
    (coherenceResult?.coherenceIssues?.some(i => i.type === 'error') ? 'rejected' :
     coherenceResult?.coherenceIssues?.some(i => i.type === 'warning') ? 'warning' : 'approved');

  if (verdict === setDef.expectedVerdict) {
    pass(`Verdict: ${verdict} (expected: ${setDef.expectedVerdict})`);
  } else {
    fail(`Verdict: ${verdict} (expected: ${setDef.expectedVerdict})`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`  ${setId.toUpperCase()}: ${passed} passed, ${failed} failed, ${warnings} warnings`);
if (failed > 0) {
  console.log(`  ⚠ ACTION REQUIRED: Fix the ${failed} failure(s) above`);
}
console.log(`══════════════════════════════════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
