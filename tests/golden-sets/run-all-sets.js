#!/usr/bin/env node
// tests/golden-sets/run-all-sets.js
// Automated golden set runner — extracts docs via Anthropic API, runs coherence pre-checks,
// validates against manifest. Saves results for each set.
//
// Usage: ANTHROPIC_API_KEY=sk-ant-... node tests/golden-sets/run-all-sets.js [set-id]
// If set-id is provided, runs only that set. Otherwise runs all.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }

const SETS_BASE = '/Users/diegoquiros/Documents/Diego/Brandimap/CACAOUS/2 DocsValidate/sets de prueba';
const RESULTS_DIR = path.join(__dirname, 'results');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Anthropic API call ──────────────────────────────────────────────────────
async function callClaude(model, system, content, maxTokens) {
  const messages = [{ role: 'user', content }];
  const body = { model, max_tokens: maxTokens, system, messages };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  return data.content?.[0]?.text || '';
}

// ── Extraction system prompt (from extraction.js) ───────────────────────────
const EXTRACTION_SYSTEM = `You are an expert in cacao and coffee export documents.

CRITICAL: A single uploaded file may contain MULTIPLE documents bundled together.
Your first task is to IDENTIFY all distinct document types present in the file, then extract data from EACH one separately.

DOCUMENT DETECTION RULES:
- Look for document headers, titles, letterheads, and section breaks
- Each distinct document type should be extracted as a separate entry
- If only ONE document type is present, return a single-item array

CRITICAL — MULTI-PAGE SINGLE DOCUMENTS:
A Bill of Lading, Commercial Invoice, Packing List, or Certificate can span multiple pages.
"Sheet 1 of 2", "Sheet 2 of 2", "Continued" — these are ALL the SAME document.
When you see these markers, combine ALL pages into ONE extracted document with the TOTAL values.

RESPONSE FORMAT: Return a JSON ARRAY: [{ "docType": "Bill of Lading", ... }]
If only one document, still return an array: [{ "docType": "...", ... }]

DOCUMENT TYPES TO DETECT:
Bill of Lading, Commercial Invoice, Packing List, Certificate of Origin, Phytosanitary Certificate, Quality Certificate, ISF, Declaration Letter, Organic Certificate (COI), Fumigation Certificate, Shipping Notification, Import Permit, Transmittal Letter

CRITICAL: CONTAINER NUMBER FORMAT
A container number is ALWAYS 4 letters + 6-7 digits. A pure number like "266461945" is NEVER a container — it is a BL number.

CRITICAL INVOICE NUMBER EXTRACTION RULES:
- Invoice numbers have format ###-###-############ (e.g. 001-002-000000824)
- If digits appear separated by spaces, JOIN them
- In Certificate of Origin, column 10 "Number and date of invoices" contains the invoice number — read ALL digits including the very last one
- NEVER truncate the last digit

CRITICAL NUMBER EXTRACTION RULES:
- "50.094,00" (EU format) means 50094 kg
- "50,094.00" (US format) means 50094 kg
- Always extract the FULL number as written, preserving all digits

FOR EACH DOCUMENT, extract all applicable fields (use null if not present):
{"docType":"...","shipper":"...","consigneeName":"...","consigneeAddress":"...","notify":"...","containerNumbers":["MSCU1234567"],"sealNumbers":["123456"],"lotNumbers":["LOT-001"],"bagCount":"...","netWeight":"...","grossWeight":"...","productDescription":"...","originCountry":"...","destinationCountry":"...","portOfLoading":"...","portOfDischarge":"...","invoiceNumber":"...","blNumber":"...","vesselName":"...","voyageNumber":"...","qualityGrade":"...","totalAmount":"...","pricePerUnit":"...","incoterms":"..."}`;

// ── Extract a single file ───────────────────────────────────────────────────
async function extractFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // Skip non-document files
  if (['.png','.jpg','.jpeg','.gif','.ico'].includes(ext) && !fileName.match(/cert|fito|bl|pack|inv|fac|letter|ship|fumig|origen|calidad|isf|coi/i)) {
    return null;
  }
  // Skip DocsValidate reports
  if (fileName.startsWith('docsvalidate-report')) return null;

  let content;
  if (ext === '.pdf') {
    const b64 = fs.readFileSync(filePath).toString('base64');
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: 'Extract all data from this export document.' }
    ];
  } else if (ext === '.xlsx' || ext === '.xls') {
    // Convert Excel to text, then send as text content
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      let text = `[Excel: ${fileName}]\n`;
      wb.SheetNames.forEach(s => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[s], { skipHidden: true });
        if (csv.trim()) text += `\n[Sheet: ${s}]\n${csv}\n`;
      });
      content = `Extract all data from this ISF/customs Excel document:\n\n${text}`;
    } catch (e) {
      console.log(`    ⚠ Skipping Excel file: ${fileName} (${e.message})`);
      return null;
    }
  } else if (['.jpg','.jpeg','.png'].includes(ext)) {
    const b64 = fs.readFileSync(filePath).toString('base64');
    const mt = ext === '.png' ? 'image/png' : 'image/jpeg';
    content = [
      { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
      { type: 'text', text: 'Extract all data from this export document.' }
    ];
  } else {
    return null;
  }

  const raw = await callClaude('claude-haiku-4-5-20251001', EXTRACTION_SYSTEM, content, 3000);
  let parsed;
  try {
    let clean = raw.trim().replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim();
    parsed = JSON.parse(clean);
  } catch {
    try {
      const m = raw.match(/(\[.*\])/s) || raw.match(/(\{.*\})/s);
      if (m) parsed = JSON.parse(m[1]);
    } catch {}
  }
  if (!parsed) return [{ docType: fileName, _err: true, _filename: fileName }];

  const docs = Array.isArray(parsed) ? parsed : [parsed];
  docs.forEach(d => { d._filename = fileName; });
  return docs;
}

// ── Coherence pre-checks (from coherence.js) ────────────────────────────────
function runPreChecks(slim) {
  const errors = [];

  // Invoice number check (with truncation tolerance)
  const invVals = Object.entries(slim).filter(([,v]) => v.invoiceNumber)
    .map(([k,v]) => ({ doc: k, value: String(v.invoiceNumber).trim() }));
  if (invVals.length >= 2) {
    const isPrefix = (a, b) => {
      if (a === b) return true;
      const pa = a.split('-'), pb = b.split('-');
      if (pa.length !== 3 || pb.length !== 3) {
        const short = a.length <= b.length ? a : b;
        const long = a.length <= b.length ? b : a;
        return long.startsWith(short) && (long.length - short.length) <= 3;
      }
      if (pa[0] !== pb[0] || pa[1] !== pb[1]) return false;
      const sa = String(parseInt(pa[2],10)), sb = String(parseInt(pb[2],10));
      const short = sa.length <= sb.length ? sa : sb;
      const long = sa.length <= sb.length ? sb : sa;
      return long.startsWith(short) && (long.length - short.length) <= 2;
    };
    const fullLengthVals = invVals.filter(v => {
      const parts = v.value.split('-');
      return parts.length !== 3 || parts[2].length >= 9;
    });
    const fullCounts = {};
    fullLengthVals.forEach(v => { fullCounts[v.value]=(fullCounts[v.value]||0)+1; });
    const fullSorted = Object.entries(fullCounts).sort((a,b)=>b[1]-a[1]);
    if (fullSorted.length > 1) {
      const majInv = fullSorted[0][0];
      fullLengthVals.filter(v => v.value !== majInv).forEach(o => {
        if (!isPrefix(o.value, majInv)) {
          errors.push({ type:'error', field:'invoiceNumber',
            message: `"${o.doc}" shows invoice "${o.value}" but other docs show "${majInv}"`,
            details: invVals.map(v=>({doc:v.doc, value:v.value}))
          });
        }
      });
    } else if (fullSorted.length === 0 && invVals.length >= 2) {
      const counts = {};
      invVals.forEach(v => { counts[v.value]=(counts[v.value]||0)+1; });
      const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      if (sorted.length > 1) {
        const maj = sorted[0][0];
        invVals.filter(v => v.value !== maj).forEach(o => {
          if (!isPrefix(o.value, maj)) {
            errors.push({ type:'error', field:'invoiceNumber',
              message: `"${o.doc}" shows invoice "${o.value}" but other docs show "${maj}"`,
              details: invVals.map(v=>({doc:v.doc, value:v.value}))
            });
          }
        });
      }
    }
  }

  // BL number check
  const blVals = Object.entries(slim).filter(([,v]) => v.blNumber)
    .map(([k,v]) => ({ doc: k, value: String(v.blNumber).trim().toUpperCase() }));
  if (blVals.length >= 2) {
    const counts = {}; blVals.forEach(v => { counts[v.value]=(counts[v.value]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    if (sorted.length > 1) {
      const maj = sorted[0][0];
      blVals.filter(v => v.value !== maj).forEach(o => {
        errors.push({ type:'error', field:'blNumber',
          message: `"${o.doc}" shows BL "${o.value}" but other docs show "${maj}"`,
          details: blVals.map(v=>({doc:v.doc, value:v.value}))
        });
      });
    }
  }

  // Lot number check (exclude per-lot docs)
  const perLotTypes = ['fumig','gas clearance','quarantine','phytosanitary','fitosanitario'];
  const lotVals = Object.entries(slim).filter(([k,v]) => {
    if (!v.lotNumbers || v.lotNumbers.length === 0) return false;
    const dt = (v.docType||'').toLowerCase();
    const fn = k.toLowerCase();
    if (perLotTypes.some(t => dt.includes(t) || fn.includes(t))) return false;
    return true;
  }).map(([k,v]) => ({ doc: k, value: String(v.lotNumbers).trim() }));
  if (lotVals.length >= 2) {
    const normL = s => {
      let n = s.toLowerCase().replace(/\s+/g,' ').trim();
      const parts = n.split(/[,;]+/).map(p =>
        p.trim().replace(/^lotes?\s*[-:\s#.]*/i,'').replace(/^lots?\s*[-:\s#.]*/i,'').trim()
      ).filter(p => p.length > 0);
      return parts.sort().join(',');
    };
    const counts = {}; lotVals.forEach(v => { const n=normL(v.value); counts[n]=(counts[n]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    if (sorted.length > 1) {
      const majNorm = sorted[0][0];
      const majVal = lotVals.find(v=>normL(v.value)===majNorm)?.value;
      lotVals.filter(v=>normL(v.value)!==majNorm).forEach(o => {
        errors.push({ type:'error', field:'lots',
          message: `"${o.doc}" references lot "${o.value}" but other docs reference "${majVal}"`,
          details: lotVals.map(v=>({doc:v.doc, value:v.value}))
        });
      });
    }
  }

  // Destination country check
  const destVals = Object.entries(slim).filter(([,v]) => v.destinationCountry)
    .map(([k,v]) => ({ doc: k, value: String(v.destinationCountry).trim(), docType: (v.docType||'').toLowerCase() }));
  if (destVals.length >= 2) {
    const countryAliases = {
      'usa':'unitedstates','eeuu':'unitedstates','estadosunidos':'unitedstates',
      'unitedstatesofamerica':'unitedstates','us':'unitedstates',
      'uk':'unitedkingdom','greatbritain':'unitedkingdom',
      'holanda':'netherlands','holland':'netherlands','paisesbajos':'netherlands',
    };
    const normD = s => {
      let n = s.toLowerCase().trim();
      const cityCountry = n.match(/^.+[-–—]\s*(.+)$/) || n.match(/^.+,\s*(.+)$/);
      if (cityCountry) n = cityCountry[1].trim();
      n = n.replace(/[^a-z]/g,'');
      return countryAliases[n] || n;
    };
    const blDest = destVals.find(v => v.docType.includes('bill of lading') || v.docType.includes('waybill'));
    let masterNorm;
    if (blDest) { masterNorm = normD(blDest.value); }
    else {
      const counts = {}; destVals.forEach(v => { const n=normD(v.value); counts[n]=(counts[n]||0)+1; });
      masterNorm = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    }
    destVals.filter(v => normD(v.value) !== masterNorm).forEach(o => {
      errors.push({ type:'error', field:'destinationCountry',
        message: `"${o.doc}" shows destination "${o.value}" vs "${destVals.find(v=>normD(v.value)===masterNorm)?.value}"`,
        details: destVals.map(v=>({doc:v.doc, value:v.value}))
      });
    });
  }

  return errors;
}

// ── Validate against manifest ───────────────────────────────────────────────
function validateAgainstManifest(setDef, allDocs, preCheckErrors) {
  let passed = 0, failed = 0, warnings = 0;
  const results = [];

  const log = (status, msg) => {
    results.push({ status, msg });
    if (status === 'pass') passed++;
    else if (status === 'fail') failed++;
    else warnings++;
  };

  // Document count
  const totalDocs = allDocs.filter(d => !d._err).length;
  if (totalDocs >= setDef.docCount) log('pass', `Extracted ${totalDocs} docs (expected >= ${setDef.docCount})`);
  else log('warn', `Extracted ${totalDocs} docs (expected >= ${setDef.docCount})`);

  // Expected extractions
  if (setDef.expectedExtractions) {
    for (const [field, expected] of Object.entries(setDef.expectedExtractions)) {
      if (field.includes('_')) continue;
      const values = allDocs.map(d => d[field]).filter(v => v != null && v !== '' && v !== 'null');
      const flat = values.flat().map(v => String(v).toLowerCase().trim());
      if (typeof expected === 'string' && expected.startsWith('should ')) {
        log('pass', `${field}: ${[...new Set(flat)].slice(0,3).join(', ')}`);
      } else {
        const expArr = Array.isArray(expected) ? expected : [String(expected)];
        const found = expArr.some(exp => flat.some(v => v.includes(exp.toLowerCase())));
        if (found) log('pass', `${field}: correctly extracted`);
        else log('fail', `${field}: expected "${expected}" but found "${[...new Set(flat)].slice(0,3).join(', ')}"`);
      }
    }
  }

  // Must-detect issues
  if (setDef.expectedIssues) {
    for (const ei of setDef.expectedIssues) {
      if (!ei.mustDetect) continue;
      const found = preCheckErrors.some(e => e.field.toLowerCase().includes(ei.field.toLowerCase()));
      if (found) log('pass', `DETECTED: ${ei.field} — ${ei.description.substring(0, 50)}`);
      else log('fail', `NOT DETECTED: ${ei.field} — ${ei.description}`);
    }
  }

  // Known false positives
  if (setDef.knownFalsePositives) {
    for (const fp of setDef.knownFalsePositives) {
      if (fp.wrongValue) {
        const bad = allDocs.filter(d => String(d[fp.field] || '').includes(fp.wrongValue));
        if (bad.length > 0) log('fail', `EXTRACTION BUG: ${fp.field} read as "${fp.wrongValue}" instead of "${fp.correctValue}" in ${bad.map(d=>d._filename).join(', ')}`);
        else log('pass', `${fp.field}: correctly extracted (no "${fp.wrongValue}")`);
      }
    }
  }

  return { passed, failed, warnings, results };
}

// ── Process one set ─────────────────────────────────────────────────────────
async function processSet(setDef) {
  const setDir = path.join(SETS_BASE, setDef.path.replace('sets de prueba/', ''));
  if (!fs.existsSync(setDir)) {
    console.error(`  ✗ Directory not found: ${setDir}`);
    return { passed: 0, failed: 1 };
  }

  const files = fs.readdirSync(setDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.pdf','.xlsx','.xls','.jpg','.jpeg','.png'].includes(ext)
      && !f.startsWith('docsvalidate-report');
  });

  console.log(`  Files: ${files.length}`);

  const allDocs = [];
  const analysisResults = {};

  for (const file of files) {
    const filePath = path.join(setDir, file);
    process.stdout.write(`    📄 ${file}...`);
    try {
      const docs = await extractFile(filePath);
      if (docs) {
        analysisResults[file] = docs;
        allDocs.push(...docs);
        const types = docs.filter(d=>!d._err).map(d=>d.docType).join(', ');
        console.log(` ✓ ${types || '(error)'}`);
      } else {
        console.log(' ⊘ skipped');
      }
    } catch (e) {
      console.log(` ✗ ${e.message.substring(0, 60)}`);
      allDocs.push({ docType: file, _err: true, _filename: file, _msg: e.message });
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Build slim object for pre-checks
  const slim = {};
  Object.entries(analysisResults).forEach(([fn, arr]) => {
    (Array.isArray(arr) ? arr : [arr]).forEach((d, i) => {
      if (d._err) return;
      const key = (Array.isArray(arr) && arr.length > 1) ? fn + '_doc' + i : fn;
      slim[key] = d;
    });
  });

  // Run pre-checks
  const preCheckErrors = runPreChecks(slim);
  if (preCheckErrors.length > 0) {
    console.log(`\n  Pre-check issues found: ${preCheckErrors.length}`);
    preCheckErrors.forEach(e => console.log(`    ${e.type === 'error' ? '🔴' : '🟡'} ${e.field}: ${e.message.substring(0, 80)}`));
  } else {
    console.log(`\n  Pre-checks: all consistent ✓`);
  }

  // Validate against manifest
  const validation = validateAgainstManifest(setDef, allDocs, preCheckErrors);

  // Save results
  const resultFile = path.join(RESULTS_DIR, `${setDef.id}-run.json`);
  fs.writeFileSync(resultFile, JSON.stringify({
    _capturedAt: new Date().toISOString(),
    _setId: setDef.id,
    analysisResults,
    preCheckErrors,
    coherenceResult: { coherenceIssues: preCheckErrors },
    validation: validation.results,
  }, null, 2));

  return validation;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const targetId = process.argv[2];
  const sets = targetId
    ? MANIFEST.sets.filter(s => s.id === targetId)
    : MANIFEST.sets;

  if (sets.length === 0) {
    console.error(`Set "${targetId}" not found`);
    process.exit(1);
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  GOLDEN SET AUTOMATED RUNNER                                ║`);
  console.log(`║  Sets to process: ${String(sets.length).padEnd(42)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  let totalPassed = 0, totalFailed = 0, totalWarnings = 0;
  const summary = [];

  for (const setDef of sets) {
    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  ${setDef.id.toUpperCase()} — ${setDef.description.substring(0, 50)}`);
    console.log(`${'═'.repeat(62)}`);

    try {
      const result = await processSet(setDef);
      totalPassed += result.passed;
      totalFailed += result.failed;
      totalWarnings += result.warnings || 0;

      const status = result.failed > 0 ? '✗ FAIL' : '✓ PASS';
      console.log(`\n  Result: ${status} (${result.passed} pass, ${result.failed} fail, ${result.warnings || 0} warn)`);
      summary.push({ id: setDef.id, ...result });
    } catch (e) {
      console.error(`\n  ✗ ERROR: ${e.message}`);
      totalFailed++;
      summary.push({ id: setDef.id, passed: 0, failed: 1, error: e.message });
    }
  }

  // Final summary
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  FINAL SUMMARY`);
  console.log(`${'═'.repeat(62)}`);
  summary.forEach(s => {
    const icon = s.failed > 0 ? '✗' : '✓';
    console.log(`  ${icon} ${s.id}: ${s.passed} pass, ${s.failed} fail${s.error ? ' (ERROR: '+s.error.substring(0,40)+')' : ''}`);
  });
  console.log(`\n  TOTAL: ${totalPassed} passed, ${totalFailed} failed, ${totalWarnings} warnings`);
  console.log(`${'═'.repeat(62)}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
})();
