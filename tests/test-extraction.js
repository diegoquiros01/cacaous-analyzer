// tests/test-extraction.js — Functional tests for document extraction logic
// Run: node tests/test-extraction.js

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function section(name) { console.log(`\n── ${name} ──`); }

// ═══════════════════════════════════════════════════════════
// Import functions from extraction.js (adapted for Node)
// ═══════════════════════════════════════════════════════════

function detectDocType(filename) {
  const n = filename.toUpperCase().replace(/[_\-\.]/g,' ');
  const rules = [
    [/\b(BL|WAYBILL|BILL\s*(OF\s*)?LADING|CONOCIMIENTO)\b/, 'Bill of Lading'],
    [/\b(FACT|INVOICE|INV\b)/, 'Commercial Invoice'],
    [/\b(PACK|PACKING)/, 'Packing List'],
    [/\b(FITO|PHYTO|FITOSANIT)/, 'Phytosanitary Certificate'],
    [/\b(CERT\s*ORIG|ORIGEN|ORIGIN|CERTIFICADO\s*DE\s*ORIG)/, 'Certificate of Origin'],
    [/\b(FUMIG|FUMIGACION|FUMIGATION|GAS\s*CLEAR)/, 'Fumigation Certificate'],
    [/\b(CALIDAD|QUALITY|QC)\b/, 'Quality Certificate'],
    [/\b(ISF|CUSTOMS)\b/, 'ISF'],
    [/\b(DECL|LETTER\s*OF|CARTA)/, 'Declaration Letter'],
    [/\b(COI|ORGANIC|ORG[AÁ]NICO)/, 'Organic Certificate (COI)'],
    [/\b(SHIPPING\s*NOT|SHIP\s*NOT|SHIPP\s*NOT)/, 'Shipping Notification'],
    [/\b(PERM|PERMIT|PERMISO)/, 'Import Permit'],
    [/\b(UNIDAD|UNIT)\b/, 'Shipping Notification'],
  ];
  for (const [re, type] of rules) {
    if (re.test(n)) return type;
  }
  return null;
}

function cleanExtractedFields(doc) {
  const MAX_FIELD_LEN = 500;
  for (const k of Object.keys(doc)) {
    if (k.startsWith('_')) continue;
    if (typeof doc[k] === 'string') {
      doc[k] = doc[k].replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      if (doc[k].length > MAX_FIELD_LEN) doc[k] = doc[k].substring(0, MAX_FIELD_LEN);
    }
    if (Array.isArray(doc[k])) {
      doc[k] = doc[k].map(v => typeof v === 'string'
        ? v.replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').substring(0, MAX_FIELD_LEN)
        : v
      );
    }
  }
  if (doc.invoiceNumber) {
    let inv = String(doc.invoiceNumber).trim();
    inv = inv.replace(/^\[|\]$/g, '');
    inv = inv.replace(/[\s\u00A0\u200B]+/g, '');
    inv = inv.replace(/\s*-\s*/g, '-');
    inv = inv.replace(/^[^0-9]+/, '');
    inv = inv.replace(/[^0-9]+$/, '');
    if (inv && inv !== doc.invoiceNumber) doc.invoiceNumber = inv;
  }
  if (doc.blNumber) {
    let bl = String(doc.blNumber).trim().replace(/\s+/g, '');
    if (bl !== doc.blNumber) doc.blNumber = bl;
  }
  if (doc.voyageNumber) {
    let voy = String(doc.voyageNumber).trim().replace(/\s+/g, '');
    if (voy !== doc.voyageNumber) doc.voyageNumber = voy;
  }
  if (Array.isArray(doc.containerNumbers)) {
    doc.containerNumbers = doc.containerNumbers.filter(c => {
      if (!c) return false;
      const clean = String(c).trim().toUpperCase().replace(/\s+/g, '');
      return /^[A-Z]{4}\d{6,7}$/.test(clean);
    }).map(c => String(c).trim().toUpperCase().replace(/\s+/g, ''));
  }
  if (Array.isArray(doc.sealNumbers)) {
    doc.sealNumbers = doc.sealNumbers
      .map(s => s ? String(s).trim().replace(/[^a-zA-Z0-9\-]/g, '').substring(0, 20) : '')
      .filter(s => s.length > 0);
  }
}

function fixGasClearanceFields(doc, textContent) {
  if (!textContent) return;
  const t = textContent;
  const dt = (doc.docType || '').toLowerCase();
  if (!dt.includes('fumig') && !dt.includes('gas clearance') && !dt.includes('clearance') && !dt.includes('quarantine')) return;
  if (!doc.destinationCountry) {
    const m = t.match(/country[^:]*destination[^:]*:[ \t]*([A-Za-z][A-Za-z ]{2,20})/i)
           || t.match(/destino[ \t]*:[ \t]*([A-Za-z][A-Za-z ]{2,20})/i)
           || t.match(/Destination[ \t]*:[ \t]*([A-Z]{3,})/);
    if (m) doc.destinationCountry = m[1].trim().replace(/[\r\n].*/, '').trim();
  }
  if (!doc.blNumber) {
    const m = t.match(/Bl[^:]*Cont[^:]*:[ \t]*([0-9]{8,})/i)
           || t.match(/Container[ \t]*:[ \t]*([0-9]{8,})/i);
    if (m) doc.blNumber = m[1].trim();
  }
}

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

section('detectDocType — Filenames en inglés');
assert(detectDocType('bill-of-lading-MAEU123.pdf') === 'Bill of Lading', 'bill-of-lading → BL');
assert(detectDocType('BL_cacaous_2026.pdf') === 'Bill of Lading', 'BL_ prefix → BL');
assert(detectDocType('waybill-draft.pdf') === 'Bill of Lading', 'waybill → BL');
assert(detectDocType('commercial_invoice_824.pdf') === 'Commercial Invoice', 'commercial_invoice → Invoice');
assert(detectDocType('INV-001-002.pdf') === 'Commercial Invoice', 'INV- prefix → Invoice');
assert(detectDocType('packing-list-final.xlsx') === 'Packing List', 'packing-list → PL');
assert(detectDocType('phyto-cert-ecuador.pdf') === 'Phytosanitary Certificate', 'phyto-cert → Phyto');
assert(detectDocType('certificate-of-origin.pdf') === 'Certificate of Origin', 'certificate-of-origin → COI');
assert(detectDocType('fumigation-certificate.pdf') === 'Fumigation Certificate', 'fumigation-certificate → Fumig');
assert(detectDocType('gas-clearance-cert.pdf') === 'Fumigation Certificate', 'gas-clearance → Fumig');
assert(detectDocType('quality-cert-lot1.pdf') === 'Quality Certificate', 'quality-cert → QC');
assert(detectDocType('ISF-filing.pdf') === 'ISF', 'ISF-filing → ISF');
assert(detectDocType('organic-certificate.pdf') === 'Organic Certificate (COI)', 'organic-certificate → Organic');
assert(detectDocType('COI-kiwa-2026.pdf') === 'Organic Certificate (COI)', 'COI- prefix → Organic');
assert(detectDocType('import-permit-usda.pdf') === 'Import Permit', 'import-permit → Import Permit');
assert(detectDocType('shipping-notification.pdf') === 'Shipping Notification', 'shipping-notification → Ship Notif (FIXED)');
assert(detectDocType('ship-not-2026.pdf') === 'Shipping Notification', 'ship-not (abbreviated) → Ship Notif');

section('detectDocType — Filenames en español');
assert(detectDocType('conocimiento-embarque.pdf') === 'Bill of Lading', 'conocimiento → BL');
assert(detectDocType('factura-comercial-001.pdf') === 'Commercial Invoice', 'factura → Invoice');
assert(detectDocType('certificado-fitosanitario.pdf') === 'Phytosanitary Certificate', 'fitosanitario → Phyto (FIXED)');
assert(detectDocType('fito-cert-ecuador.pdf') === 'Phytosanitary Certificate', 'fito-cert (abbreviated) → Phyto');
assert(detectDocType('certificado-de-origen.pdf') === 'Certificate of Origin', 'certificado-de-origen → COI');
assert(detectDocType('certificado-fumigacion.pdf') === 'Fumigation Certificate', 'fumigacion → Fumig');
assert(detectDocType('permiso-importacion.pdf') === 'Import Permit', 'permiso → Import Permit');

section('detectDocType — Edge cases');
assert(detectDocType('random-document.pdf') === null, 'unrecognized file → null');
assert(detectDocType('photo.jpg') === null, 'photo.jpg → null');
assert(detectDocType('FACT_824.pdf') === 'Commercial Invoice', 'FACT_ → Invoice (Spanish abbrev)');
assert(detectDocType('FITO-CERT.pdf') === 'Phytosanitary Certificate', 'FITO- → Phyto (Spanish abbrev)');
assert(detectDocType('declaration-letter.pdf') === 'Declaration Letter', 'declaration-letter → Declaration (FIXED)');
assert(detectDocType('decl-letter-2026.pdf') === 'Declaration Letter', 'decl-letter (abbreviated) → Declaration');
assert(detectDocType('carta-declaracion.pdf') === 'Declaration Letter', 'carta → Declaration');

section('cleanExtractedFields — Invoice number cleaning');
{
  const doc = { invoiceNumber: '[001-002-000000824]' };
  cleanExtractedFields(doc);
  assert(doc.invoiceNumber === '001-002-000000824', 'removes brackets from invoice number');
}
{
  const doc = { invoiceNumber: '0 0 1 - 0 0 2 - 000000824' };
  cleanExtractedFields(doc);
  assert(doc.invoiceNumber === '001-002-000000824', 'joins spaced invoice digits');
}
{
  const doc = { invoiceNumber: '  001-002-000000824  ' };
  cleanExtractedFields(doc);
  assert(doc.invoiceNumber === '001-002-000000824', 'trims invoice whitespace');
}

section('cleanExtractedFields — BL number cleaning');
{
  const doc = { blNumber: ' MAEU 266461945 ' };
  cleanExtractedFields(doc);
  assert(doc.blNumber === 'MAEU266461945', 'removes spaces from BL number');
}

section('cleanExtractedFields — Container number validation');
{
  const doc = { containerNumbers: ['MSCU4826790', '266461945', 'CAAU9018479', 'INVALID', ''] };
  cleanExtractedFields(doc);
  assert(doc.containerNumbers.length === 2, 'filters invalid containers (keeps only 4-letter + 6-7 digit)');
  assert(doc.containerNumbers[0] === 'MSCU4826790', 'keeps valid container MSCU4826790');
  assert(doc.containerNumbers[1] === 'CAAU9018479', 'keeps valid container CAAU9018479');
}
{
  const doc = { containerNumbers: ['mscu4826790'] };
  cleanExtractedFields(doc);
  assert(doc.containerNumbers[0] === 'MSCU4826790', 'uppercases container numbers');
}

section('cleanExtractedFields — XSS sanitization');
{
  const doc = { shipper: '<script>alert("xss")</script>Cacaous S.A.' };
  cleanExtractedFields(doc);
  assert(!doc.shipper.includes('<script>'), 'strips HTML script tags from strings');
  assert(doc.shipper === 'alert("xss")Cacaous S.A.', 'preserves non-HTML content');
}
{
  const doc = { containerNumbers: ['<img onerror=alert(1)>MSCU4826790'] };
  cleanExtractedFields(doc);
  // HTML tags are stripped FIRST, leaving valid container number
  assert(doc.containerNumbers.length === 1, 'HTML stripped → valid container survives');
  assert(doc.containerNumbers[0] === 'MSCU4826790', 'container is clean after HTML strip');
}

section('cleanExtractedFields — Field length limit');
{
  const longStr = 'A'.repeat(600);
  const doc = { shipper: longStr };
  cleanExtractedFields(doc);
  assert(doc.shipper.length === 500, 'truncates strings to 500 chars');
}

section('cleanExtractedFields — Seal number sanitization');
{
  const doc = { sealNumbers: ['ABC123', '!@#$%^', '', '  SEAL-456  '] };
  cleanExtractedFields(doc);
  assert(doc.sealNumbers.length === 2, 'filters empty/special-char seals correctly (FIXED)');
  assert(doc.sealNumbers[0] === 'ABC123', 'keeps valid seal ABC123');
  assert(doc.sealNumbers[1] === 'SEAL-456', 'trims and cleans seal SEAL-456');
}

section('fixGasClearanceFields — Destination extraction');
{
  const doc = { docType: 'Fumigation Certificate', destinationCountry: null };
  fixGasClearanceFields(doc, 'Country / city of destination: MALAYSIA\nOther data...');
  assert(doc.destinationCountry === 'MALAYSIA', 'extracts destination from English fumigation cert');
}
{
  const doc = { docType: 'Gas Clearance Certificate', destinationCountry: null };
  fixGasClearanceFields(doc, 'Destino: Indonesia\nOther data...');
  assert(doc.destinationCountry === 'Indonesia', 'extracts destination from Spanish gas clearance');
}
{
  const doc = { docType: 'Fumigation Certificate', destinationCountry: 'Ecuador' };
  fixGasClearanceFields(doc, 'Country / city of destination: MALAYSIA');
  assert(doc.destinationCountry === 'Ecuador', 'does NOT overwrite existing destination');
}
{
  const doc = { docType: 'Commercial Invoice', destinationCountry: null };
  fixGasClearanceFields(doc, 'Country / city of destination: MALAYSIA');
  assert(doc.destinationCountry === null, 'ignores non-fumigation doc types');
}

section('fixGasClearanceFields — BL number extraction');
{
  const doc = { docType: 'Fumigation Certificate', blNumber: null };
  fixGasClearanceFields(doc, 'Bl/Cont.: 266461945\nOther data...');
  assert(doc.blNumber === '266461945', 'extracts BL from Bl/Cont field');
}
{
  const doc = { docType: 'Fumigation Certificate', blNumber: 'MAEU123' };
  fixGasClearanceFields(doc, 'Bl/Cont.: 266461945');
  assert(doc.blNumber === 'MAEU123', 'does NOT overwrite existing BL');
}

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`EXTRACTION TESTS: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
