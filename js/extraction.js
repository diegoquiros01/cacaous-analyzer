// js/extraction.js — Document extraction and file processing
// Depends on globals: lang, callClaudeHaiku, callClaude, safeJSON
// Called by: app.js (addFiles, startAnalysis)

const isExcel=n=>/\.(xlsx|xls)$/i.test(n);
const isWord=n=>/\.(docx|doc)$/i.test(n);
const getIcon=(n,isPdfPage)=>{
  const badge=(txt,color)=>`<span style="font-size:0.6rem;font-family:'Raleway',sans-serif;font-weight:600;letter-spacing:0.08em;background:${color};color:#fff;padding:3px 6px;border-radius:3px;">${txt}</span>`;
  if(isPdfPage||/\.pdf$/i.test(n)) return badge('PDF','#7a5230');
  if(isExcel(n)) return badge('XLS','#217346');
  if(isWord(n))  return badge('DOC','#2b579a');
  if(/\.(jpg|jpeg|png)$/i.test(n)) return badge('IMG','#888');
  return badge('FILE','#999');
};
const getBadge=n=>isExcel(n)?'<span class="file-badge badge-excel">Excel</span>':isWord(n)?'<span class="file-badge badge-word">Word</span>':'';

function detectDocType(filename) {
  const n = filename.toUpperCase().replace(/[_\-\.]/g,' ');
  const rules = [
    [/\b(BL|WAYBILL|BILL\s*(OF\s*)?LADING|CONOCIMIENTO)\b/, 'Bill of Lading'],
    [/\b(FACT|INVOICE|INV\b)/, 'Commercial Invoice'],
    [/\b(PACK|PACKING)\b/, 'Packing List'],
    [/\b(FITO|PHYTO|FITOSANIT)\b/, 'Phytosanitary Certificate'],
    [/\b(CERT\s*ORIG|ORIGEN|ORIGIN|CERTIFICADO\s*DE\s*ORIG)\b/, 'Certificate of Origin'],
    [/\b(FUMIG|FUMIGACION|FUMIGATION|GAS\s*CLEAR)/, 'Fumigation Certificate'],
    [/\b(CALIDAD|QUALITY|QC)\b/, 'Quality Certificate'],
    [/\b(ISF|CUSTOMS)\b/, 'ISF'],
    [/\b(DECL|LETTER\s*OF|CARTA)\b/, 'Declaration Letter'],
    [/\b(COI|ORGANIC|ORG[AÁ]NICO)\b/, 'Organic Certificate (COI)'],
    [/\b(SHIPPING\s*NOT|SHIP\s*NOT|SHIPP\s*NOT)\b/, 'Shipping Notification'],
    [/\b(PERM|PERMIT|PERMISO)\b/, 'Import Permit'],
    [/\b(UNIDAD|UNIT)\b/, 'Shipping Notification'],
  ];
  for (const [re, type] of rules) {
    if (re.test(n)) return type;
  }
  return null;
}

async function excelToText(f){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        let t=`[Excel: ${f.name}]\n`;
        wb.SheetNames.forEach(s=>{
          const csv=XLSX.utils.sheet_to_csv(wb.Sheets[s],{skipHidden:true});
          if(csv.trim()) t+=`\n[Sheet: ${s}]\n${csv}\n`;
        });
        res(t);
      }catch(e){rej(e);}
    };
    r.onerror=rej; r.readAsArrayBuffer(f);
  });
}

async function wordToText(f){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>{
      mammoth.extractRawText({arrayBuffer:e.target.result})
        .then(x=>res(`[Word: ${f.name}]\n\n${x.value}`))
        .catch(rej);
    };
    r.onerror=rej; r.readAsArrayBuffer(f);
  });
}

async function toBase64(f){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(f);});
}

function mediaType(f){
  if(f.type==='application/pdf') return 'application/pdf';
  if(f.type?.startsWith('image/')) return f.type;
  const e=f.name.split('.').pop().toLowerCase();
  return e==='pdf'?'application/pdf':['jpg','jpeg'].includes(e)?'image/jpeg':'image/jpeg';
}

// ── PDF PAGE SPLITTER ─────────────────────────────────────
async function splitPdfToPages(file){
  // Split PDFs with >2 pages into 2-page chunks for faster processing
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
    const numPages = pdf.numPages;

    // 1-2 pages: always send as-is
    if(numPages <= 4) return null; // 4 pages or less = always one document

    // Only split PDFs that are clearly multi-document bundles (5+ pages)
    // Single documents (BL, invoice, packing list, certs) can be many pages — never split them
    const nameLower = file.name.toLowerCase();
    const isSingleDoc =
      nameLower.includes('bl') || nameLower.includes('bill') || nameLower.includes('lading') ||
      nameLower.includes('invoice') || nameLower.includes('factura') || nameLower.includes('fact') ||
      nameLower.includes('packing') || nameLower.includes('pack') ||
      nameLower.includes('phyto') || nameLower.includes('fito') ||
      nameLower.includes('cert') || nameLower.includes('certif') ||
      nameLower.includes('origin') || nameLower.includes('origen') ||
      nameLower.includes('fumig') || nameLower.includes('gas') ||
      nameLower.includes('letter') || nameLower.includes('carta') ||
      nameLower.includes('declar') || nameLower.includes('shipping') ||
      nameLower.includes('notify') || nameLower.includes('notif') ||
      nameLower.includes('sample') || nameLower.includes('quality') ||
      nameLower.includes('calidad') || nameLower.includes('weight') ||
      nameLower.includes('peso') || nameLower.includes('swb');
    if(isSingleDoc) return null;

    // >2 pages: split into individual page images (lower res = faster)
    const pages = [];
    for(let i = 1; i <= numPages; i++){
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({scale: 1.2}); // low res = small payload = fast
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({canvasContext: ctx, viewport}).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.65));
      const pageName = file.name.replace(/\.pdf$/i,'') + `_page${i}.jpg`;
      pages.push({file: new File([blob], pageName, {type:'image/jpeg'}), name: pageName, size: blob.size, _pdfPage: i, _pdfSource: file.name});
    }
    return pages;
  } catch(e){
    console.warn('PDF split error:', e.message);
    return null;
  }
}

async function extractDoc(entry){
  const system=`You are an expert in cacao and coffee export documents.

CRITICAL: A single uploaded file may contain MULTIPLE documents bundled together (e.g., a transmittal letter + packing list + certificate of origin + fumigation certificate all in one PDF).

Your first task is to IDENTIFY all distinct document types present in the file, then extract data from EACH one separately.

DOCUMENT DETECTION RULES:
- Look for document headers, titles, letterheads, and section breaks
- Common bundles: transmittal letter with attachments, multi-doc PDFs from exporters
- Each distinct document type should be extracted as a separate entry
- If only ONE document type is present, return a single-item array

CRITICAL — MULTI-PAGE SINGLE DOCUMENTS:
A Bill of Lading, Commercial Invoice, Packing List, or Certificate can span multiple pages.
"Sheet 1 of 2", "Sheet 2 of 2", "Continued from previous sheet", "Page 1 of 2" — these are ALL the SAME document, not separate documents.
When you see these markers, combine ALL pages into ONE extracted document with the TOTAL values (total bags, total weight from the last sheet or summary line).
NEVER return two separate Bill of Lading entries for the same BL number — merge them into one.
The totals are usually on the LAST page (e.g. "Weight in Kgs Total: 2 CONTAINER(S) 50457.000").

RESPONSE FORMAT: Return a JSON ARRAY where each element is one document:
[
  { "docType": "Bill of Lading", "blNumber": "...", ... },
  { "docType": "Packing List", "bagCount": "...", ... },
  { "docType": "Certificate of Origin", ... }
]

If only one document, still return an array: [{ "docType": "...", ... }]

DOCUMENT TYPES TO DETECT:
Bill of Lading, Commercial Invoice, Packing List, Certificate of Origin, Phytosanitary Certificate, Quality Certificate, ISF, Declaration Letter, 3rd Party Quality Report, Import Permit, Organic Certificate (COI), Fumigation Certificate (also known as: Gas Clearance Certificate, Quarantine Treatment Certificate — all are the same type: Fumigation Certificate), Sample Test Results, Transmittal Letter

The docType field should be in \${lang==='es'?'Spanish':'English'}.

CRITICAL: CONTAINER NUMBER FORMAT
A container number is ALWAYS 4 letters + 6-7 digits: e.g. MRSU4826790, CAAU9018479, TCKU7300166.
A pure number like "266461945" is NEVER a container — it is a BL number. Never put pure digit strings into containerNumbers.

SPECIAL FIELD MAPPING FOR FUMIGATION / GAS CLEARANCE / QUARANTINE CERTIFICATES:
- "Country / city of destination" or "Destino" → destinationCountry (CRITICAL — extract exact country name, even if MALAYSIA or INDONESIA)
- "Bl/Cont." field → if value is pure digits (e.g. 266461945) → blNumber NOT containerNumbers
- "Number of batch" / "Lote No." / "LOTE NO." → lotNumbers array
- "Number of fumigated bags" → bagCount
- "Treated weight" / "Peso tratado" → netWeight
- "Vessel name" / "Nombre del vapor" → vesselName
- "Export Company" / "Razón social del exportador" → shipper
- "Consignee" / "Comprador" → consigneeName
- "Trip No." / "No. de viaje" → voyageNumber

CRITICAL INVOICE NUMBER EXTRACTION RULES:
- Invoice numbers have format ###-###-############ (e.g. 001-002-000000824)
- If digits appear separated by spaces, JOIN them: "0 0 1 - 0 0 2 - 00000082 4" → "001-002-000000824"
- In Certificate of Origin, column 10 "Number and date of invoices" contains the invoice number — read ALL digits including the very last one at the edge of the cell
- NEVER truncate the last digit — "001-002-00000082" is WRONG, the full number is "001-002-000000824" (13 digits after the dashes)
- If a bracket or parenthesis wraps the number, remove it: "[001-002-000000824]" → "001-002-000000824"

CRITICAL NUMBER EXTRACTION RULES:
- Many documents use EUROPEAN format: period as thousands separator, comma as decimal → "50.094,00" means 50094 kg
- Many documents use AMERICAN format: comma as thousands separator, period as decimal → "50,094.00" means 50094 kg
- Both "50.094,00" and "50,094.00" and "50094" mean the SAME number: fifty thousand ninety four
- NEVER read "50.094" as "50.004" — the digit after the period is NOT a decimal, it is part of the number
- Always extract the FULL number as written, preserving all digits exactly
- For weights: "50.094,00 KG" → extract "50094" (remove separators, keep all digits)
- For bag counts: "726 sacos" or "726 bags" → extract "726"
- Double-check: if a weight seems unusually small compared to bag count (e.g. 726 bags but only 50004 kg), you have likely misread a separator

FOR EACH DOCUMENT IN THE ARRAY, extract all applicable fields (use null if not present):
Also include an "extraFields" object for any fields present in the document that don't fit the standard schema — for example: contract numbers, DAE numbers, purchase order numbers, letter of credit numbers, permit numbers, or any other reference numbers. Format: {"extraFields": {"Contract Number": "ARC-26-E003", "DAE": "028-2026-40-00398796"}}



{"docType":"detected type","shipper":"exporter name or null","consigneeName":"consignee name or null","consigneeAddress":"address or null","notify":"notify party or null","containerNumbers":["MSCU1234567"],"sealNumbers":["123456"],"lotNumbers":["LOT-001"],"bagCount":"500 or null","bagUnit":"bags","netWeight":"25000 or null","netWeightUnit":"kg","grossWeight":"25500 or null","grossWeightUnit":"kg","productDescription":"description or null","originCountry":"country or null","destinationCountry":"country or null","portOfLoading":"port or null","portOfDischarge":"port or null","exportDate":"date or null","expiryDate":"date or null","invoiceNumber":"number or null","blNumber":"number or null","vesselName":"vessel name or null","voyageNumber":"voyage number or null","labName":"lab or certifier name if 3rd party quality report else null","labCertNumber":"lab cert number or null","moistureContent":"moisture % if quality report or null","qualityGrade":"grade/classification or null","phytoCertNumber":"phyto cert number or null","phytoInspectionDate":"inspection date or null","phytoIssueDate":"issue date or null","importPermitNumber":"import permit number or null","importPermitValidUntil":"permit expiry date or null","importerOfRecord":"importer of record or null","coiCertNumber":"COI or NOP certificate number or null","coiCertifier":"certifying body name (e.g. CCOF, Ecocert, Control Union) or null","coiStandard":"organic standard (e.g. USDA NOP, EU Organic) or null","coiOperator":"certified operator name and address or null","coiProducts":"certified products listed in COI or null","coiValidFrom":"COI issue date or null","coiValidUntil":"COI expiry date or null","coiTransactionCert":"transaction certificate number (TC#) or null","coiLots":"lot numbers in COI or null","totalAmount":"total commercial value with currency symbol e.g. USD 374625.00 or null — extract from ANY document that states a shipment value (invoice, shipping notification, letter of declaration, etc.)","pricePerUnit":"unit price with unit e.g. 14985.00 USD/MT or 3.22 USD/kg or null — extract from any document","paymentTerms":"payment terms e.g. CAD, LC, TT or null — extract from any document","incoterms":"incoterm e.g. FOB, CIF, CFR or null — extract from any document","bankBeneficiary":"beneficiary name for payment or null — extract from any document","bankAccount":"account number or null — extract from any document"}`;


  let content;
  if(entry.textContent){
    content='Extract all data from this cacao/coffee export document:\n\n' + entry.textContent;
  } else {
    const b64=await toBase64(entry.file);
    const mt=mediaType(entry.file);
    content=[];
    if(mt==='application/pdf') content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}});
    else content.push({type:'image',source:{type:'base64',media_type:mt,data:b64}});
    content.push({type:'text',text:'Extract all data from this cacao/coffee export document.'});
  }
  try{
    const t=await callClaudeHaiku(system,content,3000);
    // Parse — could be array (multi-doc) or single object
    let raw = t.trim();
    // Strip markdown fences
    // Strip markdown fences
    raw = raw.replace(/^`{3}json\s*/,'').replace(/^`{3}\s*/,'').replace(/\s*`{3}$/,'').trim();
    let parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){
      // Try to extract array or object
      const arrMatch = raw.match(/(\[.*\])/s);
      const objMatch = raw.match(/(\{.*\})/s);
      if(arrMatch) try{ parsed = JSON.parse(arrMatch[1]); }catch(e2){}
      if(!parsed && objMatch) try{ parsed = JSON.parse(objMatch[1]); }catch(e2){}
    }
    if(!parsed) return [{docType:entry.name,_err:true,_filename:entry.name}];

    // Normalize to array
    const docs = Array.isArray(parsed) ? parsed : [parsed];

    // Fix numbers and tag each doc with source filename
    const fixNumber = (val) => { if(!val) return val; return String(val).replace(/\s/g,''); };
    let processed = docs.map(p => {
      if(p.netWeight)   p.netWeight   = fixNumber(p.netWeight);
      if(p.grossWeight) p.grossWeight = fixNumber(p.grossWeight);
      p._filename = entry.name;
      if(entry.textContent) fixGasClearanceFields(p, entry.textContent);
      cleanExtractedFields(p);
      return p;
    });

    // Merge duplicate same-type docs from the same file (multi-page BLs, invoices, etc.)
    // If two docs have the same docType and same blNumber → they are the same document split across pages
    const merged = [];
    processed.forEach(p => {
      if(p._err) { merged.push(p); return; }
      const normType = (p.docType||'').toLowerCase();
      const existing = merged.find(m =>
        !m._err &&
        m.docType === p.docType &&
        ((p.blNumber && m.blNumber && p.blNumber === m.blNumber) ||
         (p.invoiceNumber && m.invoiceNumber && p.invoiceNumber === m.invoiceNumber) ||
         // Same doc type with no identifying number — merge if same file
         (!p.blNumber && !p.invoiceNumber && m._filename === p._filename &&
          (normType.includes('bill') || normType.includes('lading') || normType.includes('conocimiento')))
        )
      );
      if(existing) {
        // Merge — prefer non-null values, take larger numbers for totals
        Object.keys(p).forEach(k => {
          if(k.startsWith('_')) return;
          if(p[k] != null && p[k] !== '' && (existing[k] == null || existing[k] === '')) {
            existing[k] = p[k];
          }
          // For numeric totals, take the larger value (last page usually has the total)
          if(['bagCount','netWeight','grossWeight'].includes(k) && p[k] && existing[k]) {
            const pNum = parseFloat(String(p[k]).replace(/[^0-9.]/g,''));
            const eNum = parseFloat(String(existing[k]).replace(/[^0-9.]/g,''));
            if(!isNaN(pNum) && !isNaN(eNum) && pNum > eNum) existing[k] = p[k];
          }
          // For arrays, merge unique values
          if(Array.isArray(p[k]) && Array.isArray(existing[k])) {
            existing[k] = [...new Set([...existing[k], ...p[k]])];
          }
        });
      } else {
        merged.push(p);
      }
    });

    return merged;
  }
  catch(e){return [{docType:entry.name,_err:true,_msg:e.message,_filename:entry.name}];}
}

// ── POST-PROCESS: fix Gas Clearance Certificate field mapping from text ──
function fixGasClearanceFields(doc, textContent) {
  if(!textContent) return;
  const t = textContent;
  const dt = (doc.docType||"").toLowerCase();
  if(!dt.includes("fumig") && !dt.includes("gas clearance") && !dt.includes("clearance") && !dt.includes("quarantine")) return;

  // Extract destinationCountry from "Country / city of destination: MALAYSIA"
  if(!doc.destinationCountry){
    const m = t.match(/country[^:]*destination[^:]*:[ \t]*([A-Za-z][A-Za-z ]{2,20})/i)
           || t.match(/destino[ \t]*:[ \t]*([A-Za-z][A-Za-z ]{2,20})/i)
           || t.match(/Destination[ \t]*:[ \t]*([A-Z]{3,})/);
    if(m) doc.destinationCountry = m[1].trim().replace(/[\r\n].*/,"").trim();
  }

  // Extract blNumber from "Bl/Cont.: 266461945"
  if(!doc.blNumber){
    const m = t.match(/Bl[^:]*Cont[^:]*:[ \t]*([0-9]{8,})/i)
           || t.match(/Container[ \t]*:[ \t]*([0-9]{8,})/i);
    if(m) doc.blNumber = m[1].trim();
  }
}

// ── POST-PROCESS: clean garbled reference numbers ──────────────────
function cleanExtractedFields(doc) {
  // Clean invoice number — remove spaces between digits, leading non-digit chars
  if (doc.invoiceNumber) {
    let inv = String(doc.invoiceNumber).trim();
    // Remove brackets: [001-002-000000824] → 001-002-000000824
    inv = inv.replace(/^\[|\]$/g, '');
    // Remove spaces between digits/dashes: "0 0 1 - 0 0 2 - 00000082 4" → "001-002-0000000824"
    inv = inv.replace(/(\d)\s+(\d)/g, '$1$2').replace(/(\d)\s*-\s*(\d)/g, '$1-$2');
    // Remove leading non-digit chars (OCR artifacts): "I001-002-..." → "001-002-..."
    inv = inv.replace(/^[^0-9]+/, '');
    // Remove trailing non-digit chars
    inv = inv.replace(/[^0-9]+$/, '');
    if (inv && inv !== doc.invoiceNumber) doc.invoiceNumber = inv;
  }
  // Clean BL number — remove spaces
  if (doc.blNumber) {
    let bl = String(doc.blNumber).trim().replace(/\s+/g, '');
    if (bl !== doc.blNumber) doc.blNumber = bl;
  }
  // Clean voyage number — remove spaces
  if (doc.voyageNumber) {
    let voy = String(doc.voyageNumber).trim().replace(/\s+/g, '');
    if (voy !== doc.voyageNumber) doc.voyageNumber = voy;
  }
}
