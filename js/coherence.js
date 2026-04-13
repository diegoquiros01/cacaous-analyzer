// js/coherence.js — Coherence analysis, normalization, translation
// Depends on globals: lang, tx(), PRODUCT_SYNONYMS, DOC_TYPE_ES, _translationCache, callClaude, callClaudeHaiku
// Called by: app.js (startAnalysis), rendering.js, pdf.js

// Find the BL document — prefer files with "bl" or "bill" in the filename
function findBLDoc(results) {
  const isBLType = r => {
    const dt = (r.docType||'').toLowerCase();
    return dt.includes('bill of lading') || dt.includes('waybill') || dt.includes('conocimiento');
  };
  const candidates = results.filter(r => !r._err && isBLType(r));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Multiple BLs — prefer one from a file named "bl" or "bill"
  const fromBLFile = candidates.find(r => {
    const fn = (r._filename||'').toLowerCase();
    return fn.includes('bl') || fn.includes('bill') || fn.includes('lading') || fn.includes('conocimiento');
  });
  return fromBLFile || candidates[0];
}

async function analyzeCoherence(docs){
  const isES = lang === 'es';

  // Slim down to relevant fields only
  const relevantFields = ['docType','lotNumbers','bagCount','netWeight','grossWeight',
    'containerNumbers','sealNumbers','blNumber','invoiceNumber','shipper','consigneeName',
    'consigneeAddress','notify','vesselName','portOfLoading','portOfDischarge',
    'destinationCountry','originCountry','voyageNumber','qualityGrade'];

  const slim = {};
  Object.entries(docs).forEach(([fn, arr]) => {
    (Array.isArray(arr) ? arr : [arr]).forEach((d, i) => {
      const key = (Array.isArray(arr) && arr.length > 1) ? fn + '_doc' + i : fn;
      const s = {};
      relevantFields.forEach(f => { if(d[f] != null && d[f] !== '' && d[f] !== 'null') s[f] = d[f]; });
      if(Object.keys(s).length > 1) slim[key] = s; // skip empty docs
    });
  });

  const system = `You are an expert validator of cacao and coffee export documents.
LANGUAGE: You MUST write ALL output text (summary, messages, comments, actionItems) in ${isES ? 'SPANISH' : 'ENGLISH'}. ${isES ? 'Todo tu output debe estar en español — no mezcles inglés.' : 'All output must be in English.'}
Analyze the extracted fields from this document set and find ALL inconsistencies.

IGNORE these — they are NOT errors:
- Case differences: "Indonesia" = "INDONESIA"
- Number formatting: "150,480.00" = "150480"
- Unit synonyms: kg = KGS = kilogramos
- Company name + address vs name alone
- Transport mode vs vessel name: "Marítimo" ≠ mismatch with "MAERSK GLACIER"
- Port area: "New York" = "Jersey City" = "Newark"
- Country synonyms: "USA" = "United States"
- Missing/null fields in some documents
- Port of discharge vs final destination (Thessaloniki port vs Sofia destination = normal transit)

FLAG these as CRITICAL errors (type: "error"):
- destinationCountry: if ANY document has a different country than the majority — this is CRITICAL
- lotNumbers: if any document references a different lot than the majority — wrong document
- bagCount: mismatch after summing multi-docs of same type
- netWeight/grossWeight: mismatch > 0.5%
- containerNumbers: differ between BL and packing list
- blNumber: differs between documents
- shipper/consignee: completely different company

FLAG these as WARNINGS (type: "warning") — observations that need attention but are not errors:
- COI or certificate marked as DRAFT or not yet signed
- Signature or seal section left blank in a certificate
- Certificate expiry date that seems unusually short (1 year vs typical 2 years)
- Port of discharge vs destination country discrepancy worth noting (e.g. BL says Thessaloniki, cert says Sofia — note for transit confirmation)
- Certificate of Origin marked as replacement/substitute for a previous one
- Any document with a reference to a previous version or correction

DESTINATION COUNTRY IS MANDATORY: You MUST check every single document's destinationCountry.

WRITING RULES — there is no field-by-field table shown to the user. Your text IS the explanation. Be specific and practical — explain not just what differs but why it matters and what needs to happen.

"summary" — 3-5 sentences. Write like a trade compliance officer briefing a colleague. BE EXTREMELY SPECIFIC — cite actual values, container numbers, document names, and company names. Generic summaries are useless.
  - Sentence 1: Overall verdict, document count, and BL number. ("12 documents analyzed for BL GQL0444337 on vessel CMA CGM HARMONY — 2 critical issues require correction before customs release.")
  - Sentence 2-3: The most critical issues with ACTUAL values quoted. Do NOT say "container mismatch found" — say exactly WHICH containers differ and in WHICH document. ("The Packing List shows 8 containers (BSIU8177031, CAAU5976057, CMAU9334195...) that share ZERO overlap with the 8 containers in the Bill of Lading (CMAU9710760, FFAU4792315, CMAU8482644...). This Packing List appears to belong to a different shipment entirely.")
  - Sentence 4: Why this matters for customs/operations. ("Customs will reject the shipment if the Packing List containers do not match the BL — the cargo cannot be released.")
  - Final sentence: The single most urgent action with WHO must do it. ("Request a corrected Packing List from Aromacacao S.A. referencing BL GQL0444337 immediately — before the vessel arrives at New York.")
  - If clean: "All [N] documents for BL [NUMBER] are consistent. Containers, seals, lots, weights ([X] kg net), and parties all match across [shipper] → [consignee]. The set is ready for customs release."

"message" per coherenceIssue — 2-3 sentences maximum. ALWAYS quote exact values. Structure:
  1. What differs, between which documents, with EXACT values quoted. NEVER say "container mismatch" without listing the actual container numbers. ("The Packing List lists 8 containers (BSIU8177031, CAAU5976057, CMAU9334195, TCLU8505492, TCNU5567348, TLLU4659292, TXGU4024457, TXGU8424003) — NONE of these match the 8 containers in the BL (CMAU9710760, FFAU4792315, CMAU8482644, UETU6357893, CAAU6292470, FFAU4540777, BSIU8070017, CMAU6910580). The Packing List appears to be from a completely different shipment.")
  2. Why this matters for customs/operations. ("Customs will reject the entry — the Packing List must reference the same containers as the transport document.")
  3. What action is needed, from whom, by when. ("Request a corrected Packing List from Aromacacao S.A. before the vessel arrives at New York.")

"comment" per document in perDocumentStatus — 2 sentences max, 25 words max total. First sentence: what's notable about this document (DRAFT, missing signature, conflicting value, or clean). Second sentence: the practical implication if it's an issue. Examples:
  - "All fields consistent with the set. No action required."
  - "DRAFT — section 18 signature and Kiwa BCS stamp are blank. Cargo cannot be certified organic without the final signed version."
  - "Shows container MRSU8021108, which differs from MRSU8021109 in all other documents. This document must be corrected before customs release."

"actionItems" — a flat numbered list of concrete next steps the exporter or importer must take. Only include items that are genuinely required — do not invent actions if the set is clean. Each item must:
  - Start with a verb ("Request", "Update", "Confirm", "Obtain", "Contact")
  - Name who is responsible or who to contact
  - State urgency if relevant ("before vessel arrival", "before customs release", "immediately")
  - Be one sentence only
  Examples:
  - "Request a corrected Packing List from Aromacacao showing container MRSU8021109 before the vessel arrives."
  - "Obtain the final signed COI from Kiwa BCS — the current version is DRAFT and cargo cannot be released as organic without it."
  - "Update the ISF filing with CBP to reflect the new vessel (Matthew Schulte) and containers (BEAU4744754, TLLU7985271) immediately."
  - "Confirm the correct bank account number with Banco Pichincha — Invoice shows 23119464 but Shipping Notification shows 23119422."
  If the set is fully clean, return: "actionItems": []

Write all text in ${isES ? 'Spanish' : 'English'}.

Return ONLY valid JSON:
{"overallStatus":"approved|warning|rejected","summary":"3-4 sentences as described","actionItems":["Concrete action 1 — who must do it and when","Concrete action 2 — who must do it and when"],"coherenceIssues":[{"type":"error|warning","field":"fieldName","message":"2-3 sentences: what differs + why it matters + what action is needed","details":[{"doc":"filename","value":"value"}]}],"setValues":{"lots":{"status":"consistent|inconsistent","values":[{"doc":"file","value":"val"}]},"bags":{"status":"consistent|inconsistent","values":[]},"netWeight":{"status":"consistent|inconsistent","values":[]},"grossWeight":{"status":"consistent|inconsistent","values":[]},"containers":{"status":"consistent|inconsistent","values":[]},"seals":{"status":"consistent|inconsistent","values":[]},"blNumber":{"status":"consistent|inconsistent","values":[]},"shipper":{"status":"consistent|inconsistent","values":[]},"consignee":{"status":"consistent|inconsistent","values":[]},"vessel":{"status":"consistent|inconsistent","values":[]},"portOfLoading":{"status":"consistent|inconsistent","values":[]},"portOfDischarge":{"status":"consistent|inconsistent","values":[]},"destinationCountry":{"status":"consistent|inconsistent","values":[]}},"perDocumentStatus":{"filename":{"status":"approved|warning|rejected","docType":"type","issues":[],"comment":"2 sentences max, 25 words: what is notable + practical implication"}}}`

  // ── JS PRE-CHECK: detect critical mismatches deterministically ──
  const jsPreErrors = [];

  // Check destinationCountry — BL is master; fallback to majority if no BL
  const destVals = Object.entries(slim)
    .filter(([,v]) => v.destinationCountry)
    .map(([k,v]) => ({ doc: k, value: String(v.destinationCountry).trim(), docType: (v.docType||'').toLowerCase() }));
  if(destVals.length >= 2) {
    const normD = s => s.toLowerCase().replace(/[^a-z]/g,'');
    // Prefer BL's destination as master
    const blDest = destVals.find(v =>
      v.docType.includes('bill of lading') || v.docType.includes('waybill') || v.docType.includes('conocimiento')
    );
    let masterVal, masterNorm, masterLabel;
    if (blDest) {
      masterVal = blDest.value;
      masterNorm = normD(blDest.value);
      masterLabel = isES ? 'el BL' : 'the BL';
    } else {
      // No BL — fallback to majority
      const dcounts = {}; destVals.forEach(v => { const n=normD(v.value); dcounts[n]=(dcounts[n]||0)+1; });
      const dsorted = Object.entries(dcounts).sort((a,b)=>b[1]-a[1]);
      masterNorm = dsorted[0][0];
      masterVal = destVals.find(v=>normD(v.value)===masterNorm)?.value || dsorted[0][0];
      masterLabel = isES ? 'la mayoría de documentos' : 'the majority of documents';
    }
    destVals.filter(v=>normD(v.value)!==masterNorm).forEach(o => {
      jsPreErrors.push({ type:'error', field:'destinationCountry',
        message: isES
          ? '"'+o.doc.replace(/\.[^.]+$/,'')+'" indica destino "'+o.value+'" pero '+masterLabel+' indica "'+masterVal+'". Error crítico — corregir el certificado.'
          : '"'+o.doc.replace(/\.[^.]+$/,'')+'" shows destination "'+o.value+'" but '+masterLabel+' shows "'+masterVal+'". Critical error — the certificate must be corrected.',
        details: destVals.map(v=>({doc:v.doc, value:v.value}))
      });
    });
  }

  // Check blNumber — catches wrong BL number in set
  const blVals = Object.entries(slim)
    .filter(([,v]) => v.blNumber)
    .map(([k,v]) => ({ doc: k, value: String(v.blNumber).trim().toUpperCase() }));
  if(blVals.length >= 2) {
    const blCounts = {};
    blVals.forEach(v => { blCounts[v.value]=(blCounts[v.value]||0)+1; });
    const blSorted = Object.entries(blCounts).sort((a,b)=>b[1]-a[1]);
    if(blSorted.length > 1) {
      const majBL = blSorted[0][0];
      blVals.filter(v => v.value !== majBL).forEach(o => {
        jsPreErrors.push({ type:'error', field:'blNumber',
          message: isES
            ? '"'+o.doc.replace(/\.[^.]+$/,'')+'" indica BL "'+o.value+'" pero los demás documentos indican "'+majBL+'". Verificar y corregir.'
            : '"'+o.doc.replace(/\.[^.]+$/,'')+'" shows BL "'+o.value+'" but other documents show "'+majBL+'". Please verify and correct.',
          details: blVals.map(v=>({doc:v.doc, value:v.value}))
        });
      });
    }
  }

  // Check lotNumbers — catches wrong document in set
  // Exclude per-lot docs (fumigation, phyto) — they only cover 1 lot each by design
  const perLotDocTypes = ['fumig','gas clearance','quarantine','phytosanitary','fitosanitario'];
  const lotVals = Object.entries(slim)
    .filter(([k,v]) => {
      if (!v.lotNumbers || v.lotNumbers.length === 0) return false;
      const dt = (v.docType||'').toLowerCase();
      const fn = k.toLowerCase();
      if (perLotDocTypes.some(t => dt.includes(t) || fn.includes(t))) return false;
      return true;
    })
    .map(([k,v]) => ({ doc: k, value: String(v.lotNumbers).trim() }));
  if(lotVals.length >= 2) {
    const normL = s => s.toLowerCase().replace(/\s+/g,'').replace(/^lote?\s*[-:\s]*/i,'').replace(/^lot\s*[-:\s]*/i,'').trim();
    const lcounts = {}; lotVals.forEach(v => { const n=normL(v.value); lcounts[n]=(lcounts[n]||0)+1; });
    const lsorted = Object.entries(lcounts).sort((a,b)=>b[1]-a[1]);
    if(lsorted.length > 1) {
      const majNorm = lsorted[0][0];
      const majVal = lotVals.find(v=>normL(v.value)===majNorm)?.value || lsorted[0][0];
      lotVals.filter(v=>normL(v.value)!==majNorm).forEach(o => {
        jsPreErrors.push({ type:'error', field:'lots',
          message: isES
            ? '"'+o.doc.replace(/\.[^.]+$/,'')+'" referencia lote "'+o.value+'" pero los demás documentos referencian "'+majVal+'". Este documento pertenece a otro embarque y debe reemplazarse.'
            : '"'+o.doc.replace(/\.[^.]+$/,'')+'" references lot "'+o.value+'" but other documents reference "'+majVal+'". This document belongs to a different shipment and must be replaced.',
          details: lotVals.map(v=>({doc:v.doc, value:v.value}))
        });
      });
    }
  }

  // ── BL IS MASTER: container, seal, vessel, port validation ──────────────────
  // The Bill of Lading is the authoritative transport document.
  // Any other doc with different containers/seals/vessel/ports than the BL is wrong — not the BL.
  (function checkFieldsAgainstBL() {
    // Find BL — prefer entries from files named "bl" or "bill"
    const blCandidates = Object.entries(slim).filter(([k, v]) => {
      const dt = (v.docType || '').toLowerCase();
      return dt.includes('bill of lading') || dt.includes('waybill') ||
             dt.includes('conocimiento') || dt === 'bl';
    });
    const blEntry = blCandidates.find(([k]) => {
      const fn = k.toLowerCase();
      return fn.includes('bl') || fn.includes('bill') || fn.includes('lading');
    }) || blCandidates[0];
    if (!blEntry) return;
    const [blDoc, blData] = blEntry;
    const blLabel = blDoc.replace(/\.[^.]+$/, '');

    // Skip types for reference-only docs
    const skipTypes = ['notification','notificacion','email','correo',
      'letter','carta','declaration letter','carta declaracion',
      'shipping notification','unidad','transmittal'];

    // ── CONTAINERS ──
    const blContainers = (blData.containerNumbers || [])
      .map(c => String(c).trim().toUpperCase())
      .filter(c => /^[A-Z]{4}\d{6,7}$/.test(c));

    if (blContainers.length > 0) {
      const blSet = new Set(blContainers);
      Object.entries(slim).forEach(([docName, docData]) => {
        if (docName === blDoc) return;
        const dt = (docData.docType || '').toLowerCase();
        const fn = docName.toLowerCase();
        if (skipTypes.some(s => dt.includes(s) || fn.includes(s))) return;
        const docContainers = (docData.containerNumbers || [])
          .map(c => String(c).trim().toUpperCase())
          .filter(c => /^[A-Z]{4}\d{6,7}$/.test(c));
        if (docContainers.length === 0) {
          // If this doc type SHOULD have containers, warn about missing extraction
          const shouldHaveContainers = ['packing','lista de empaque','phytosanitary',
            'fitosanitario','fumig','certificate of origin','certificado de origen','invoice','factura'];
          const isPL = dt.includes('packing') || fn.includes('packing') || dt.includes('lista de empaque');
          if (shouldHaveContainers.some(s => dt.includes(s) || fn.includes(s))) {
            jsPreErrors.push({
              type: isPL ? 'error' : 'warning', field: 'containers',
              message: isES
                ? '"' + docName.replace(/\.[^.]+$/,'') + '" no incluye contenedores — verificar manualmente contra el BL (' + blLabel + ').'
                : '"' + docName.replace(/\.[^.]+$/,'') + '" has no containers listed — verify manually against BL (' + blLabel + ').',
              details: [
                { doc: blDoc, value: blContainers.join(', ') },
                { doc: docName, value: '(none extracted)' },
              ]
            });
          }
          return;
        }

        const docSet = new Set(docContainers);
        const extraInDoc = docContainers.filter(c => !blSet.has(c));
        const missingFromDoc = blContainers.filter(c => !docSet.has(c));
        if (extraInDoc.length === 0 && missingFromDoc.length === 0) return;

        const docLabel = docName.replace(/\.[^.]+$/, '');
        let msg;
        if (isES) {
          if (extraInDoc.length > 0 && missingFromDoc.length > 0) {
            msg = '"' + docLabel + '" lista contenedores diferentes a los del BL (' + blLabel + '). '
                + 'Contenedores en este doc no presentes en BL: ' + extraInDoc.join(', ') + '. '
                + 'Contenedores del BL no presentes en este doc: ' + missingFromDoc.join(', ') + '. '
                + 'El BL es el documento master — este documento debe corregirse.';
          } else if (extraInDoc.length > 0) {
            msg = '"' + docLabel + '" incluye ' + extraInDoc.length + ' contenedor(es) que NO están en el BL (' + blLabel + '): '
                + extraInDoc.join(', ') + '. El BL es el documento master — este documento debe corregirse.';
          } else {
            msg = '"' + docLabel + '" omite ' + missingFromDoc.length + ' contenedor(es) del BL (' + blLabel + '): '
                + missingFromDoc.join(', ') + '. El BL es el documento master — este documento debe corregirse.';
          }
        } else {
          if (extraInDoc.length > 0 && missingFromDoc.length > 0) {
            msg = '"' + docLabel + '" lists different containers than the BL (' + blLabel + '). '
                + 'In this doc but NOT in BL: ' + extraInDoc.join(', ') + '. '
                + 'In BL but missing from this doc: ' + missingFromDoc.join(', ') + '. '
                + 'The BL is the master document — this document must be corrected.';
          } else if (extraInDoc.length > 0) {
            msg = '"' + docLabel + '" includes ' + extraInDoc.length + ' container(s) NOT in the BL (' + blLabel + '): '
                + extraInDoc.join(', ') + '. The BL is the master document — this document must be corrected.';
          } else {
            msg = '"' + docLabel + '" is missing ' + missingFromDoc.length + ' container(s) from the BL (' + blLabel + '): '
                + missingFromDoc.join(', ') + '. The BL is the master document — this document must be corrected.';
          }
        }
        jsPreErrors.push({
          type: 'error', field: 'containers', message: msg,
          details: [
            { doc: blDoc, value: 'BL (master): ' + blContainers.join(', ') },
            { doc: docName, value: docLabel + ': ' + docContainers.join(', ') },
          ]
        });
      });
    }

    // ── SEALS (BL is master) ──
    const blSeals = (blData.sealNumbers || [])
      .map(s => String(s).trim().toUpperCase()).filter(Boolean);
    if (blSeals.length > 0) {
      const blSealSet = new Set(blSeals);
      Object.entries(slim).forEach(([docName, docData]) => {
        if (docName === blDoc) return;
        const dt = (docData.docType || '').toLowerCase();
        if (skipTypes.some(s => dt.includes(s))) return;
        const docSeals = (docData.sealNumbers || [])
          .map(s => String(s).trim().toUpperCase()).filter(Boolean);
        if (docSeals.length === 0) return;
        const docSealSet = new Set(docSeals);
        const extra = docSeals.filter(s => !blSealSet.has(s));
        const missing = blSeals.filter(s => !docSealSet.has(s));
        if (extra.length === 0 && missing.length === 0) return;
        const docLabel = docName.replace(/\.[^.]+$/, '');
        const msg = isES
          ? '"' + docLabel + '" tiene sellos diferentes al BL (' + blLabel + '). BL: ' + blSeals.join(', ') + '. Doc: ' + docSeals.join(', ') + '. El BL es el documento master.'
          : '"' + docLabel + '" has different seals than BL (' + blLabel + '). BL: ' + blSeals.join(', ') + '. Doc: ' + docSeals.join(', ') + '. The BL is the master document.';
        jsPreErrors.push({
          type: 'error', field: 'seals', message: msg,
          details: [
            { doc: blDoc, value: 'BL (master): ' + blSeals.join(', ') },
            { doc: docName, value: docLabel + ': ' + docSeals.join(', ') },
          ]
        });
      });
    }

    // ── VESSEL NAME (BL is master) ──
    const blVessel = (blData.vesselName || '').trim();
    if (blVessel) {
      const blVesselNorm = blVessel.toLowerCase().replace(/[^a-z0-9]/g, '');
      Object.entries(slim).forEach(([docName, docData]) => {
        if (docName === blDoc) return;
        const dt = (docData.docType || '').toLowerCase();
        if (skipTypes.some(s => dt.includes(s))) return;
        const docVessel = (docData.vesselName || '').trim();
        if (!docVessel) return;
        const docVesselNorm = docVessel.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Skip transport mode words
        const transportModes = ['maritimo','marítimo','maritime','sea','ocean','air'];
        if (transportModes.includes(docVesselNorm)) return;
        if (blVesselNorm === docVesselNorm) return;
        if (blVesselNorm.includes(docVesselNorm) || docVesselNorm.includes(blVesselNorm)) return;
        const docLabel = docName.replace(/\.[^.]+$/, '');
        const msg = isES
          ? '"' + docLabel + '" indica buque "' + docVessel + '" pero el BL (' + blLabel + ') indica "' + blVessel + '". El BL es el documento master.'
          : '"' + docLabel + '" shows vessel "' + docVessel + '" but BL (' + blLabel + ') shows "' + blVessel + '". The BL is the master document.';
        jsPreErrors.push({
          type: 'error', field: 'vessel', message: msg,
          details: [
            { doc: blDoc, value: 'BL (master): ' + blVessel },
            { doc: docName, value: docLabel + ': ' + docVessel },
          ]
        });
      });
    }

    // ── PORTS (BL is master) ──
    ['portOfLoading', 'portOfDischarge'].forEach(portField => {
      const blPort = (blData[portField] || '').trim();
      if (!blPort) return;
      const blPortNorm = normalizeValue(blPort);
      Object.entries(slim).forEach(([docName, docData]) => {
        if (docName === blDoc) return;
        const dt = (docData.docType || '').toLowerCase();
        if (skipTypes.some(s => dt.includes(s))) return;
        const docPort = (docData[portField] || '').trim();
        if (!docPort) return;
        const docPortNorm = normalizeValue(docPort);
        if (blPortNorm === docPortNorm) return;
        if (blPortNorm.includes(docPortNorm) || docPortNorm.includes(blPortNorm)) return;
        const docLabel = docName.replace(/\.[^.]+$/, '');
        const fieldLabel = portField === 'portOfLoading'
          ? (isES ? 'Puerto de Carga' : 'Port of Loading')
          : (isES ? 'Puerto de Descarga' : 'Port of Discharge');
        const msg = isES
          ? '"' + docLabel + '" indica ' + fieldLabel + ' "' + docPort + '" pero el BL (' + blLabel + ') indica "' + blPort + '". El BL es el documento master.'
          : '"' + docLabel + '" shows ' + fieldLabel + ' "' + docPort + '" but BL (' + blLabel + ') shows "' + blPort + '". The BL is the master document.';
        jsPreErrors.push({
          type: 'warning', field: portField, message: msg,
          details: [
            { doc: blDoc, value: 'BL (master): ' + blPort },
            { doc: docName, value: docLabel + ': ' + docPort },
          ]
        });
      });
    });
  })();

  // ── SUM FUMIGATION / PHYTOSANITARY bags & weights by lot before comparison ──
  // When multiple fumigation certs exist (one per lot), sum their bags/weights
  // and add a synthetic "total" entry so the AI compares the sum vs BL total.
  (function sumMultiDocTypes() {
    const sumTypes = ['fumigation certificate', 'phytosanitary certificate',
      'certificado de fumigación', 'certificado fitosanitario'];
    const typeGroups = {};
    Object.entries(slim).forEach(([k, v]) => {
      const dt = normalizeDocType(v.docType);
      if (sumTypes.includes(dt)) {
        if (!typeGroups[dt]) typeGroups[dt] = [];
        typeGroups[dt].push({ key: k, data: v });
      }
    });
    Object.entries(typeGroups).forEach(([dt, entries]) => {
      if (entries.length < 2) return; // only sum when there are multiple
      let totalBags = 0, totalNet = 0, totalGross = 0;
      const lots = [];
      entries.forEach(({ data }) => {
        const bags = parseFloat(String(data.bagCount || '0').replace(/[^0-9.]/g, ''));
        const net = parseFloat(String(data.netWeight || '0').replace(/[^0-9.]/g, ''));
        const gross = parseFloat(String(data.grossWeight || '0').replace(/[^0-9.]/g, ''));
        if (!isNaN(bags)) totalBags += bags;
        if (!isNaN(net)) totalNet += net;
        if (!isNaN(gross)) totalGross += gross;
        if (data.lotNumbers) lots.push(...(Array.isArray(data.lotNumbers) ? data.lotNumbers : [data.lotNumbers]));
      });
      // Add synthetic total entry for AI comparison
      const label = isES ? 'TOTAL ' + dt.toUpperCase() : 'TOTAL ' + dt.toUpperCase();
      slim['__sum_' + dt.replace(/\s+/g, '_')] = {
        docType: label + ' (' + entries.length + ' docs)',
        bagCount: totalBags > 0 ? String(totalBags) : null,
        netWeight: totalNet > 0 ? String(Math.round(totalNet * 100) / 100) : null,
        grossWeight: totalGross > 0 ? String(Math.round(totalGross * 100) / 100) : null,
        lotNumbers: [...new Set(lots)],
        _isSummedTotal: true,
      };
    });
  })();

  // Include JS pre-detected errors so the AI can reference them in the summary
  const preErrorsContext = jsPreErrors.length > 0
    ? `\n\nPRE-DETECTED CRITICAL ISSUES (verified by deterministic checks — include these in your summary with exact values):\n${jsPreErrors.map(e => `- ${e.field}: ${e.message}`).join('\n')}\n\nIMPORTANT REMINDER: Write ALL text (summary, messages, comments, action items) in ${isES ? 'SPANISH' : 'ENGLISH'}. ${isES ? 'Todo el texto debe estar en español.' : ''}\n`
    : '';

  const msg = `Documents and their fields:\n${JSON.stringify(slim, null, 2)}${preErrorsContext}`;


  try {
    const raw = await callClaude(system, msg, 4000);
    const cleaned = raw.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    // Try to parse, if truncated try to salvage
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch(e) {
      // Try to extract just coherenceIssues from truncated JSON
      const issMatch = cleaned.match(/"coherenceIssues"\s*:\s*(\[.*?\])/s);
      if(issMatch) {
        try {
          const issues = JSON.parse(issMatch[1]);
          parsed = { overallStatus: issues.some(i=>i.type==='error') ? 'rejected' : 'warning', coherenceIssues: issues, setValues: {}, perDocumentStatus: {} };
        } catch(e2) {}
      }
    }
    if(parsed && (parsed.setValues || parsed.coherenceIssues)) {
      // Merge JS pre-errors with AI results — JS errors take priority
      const aiIssues = (parsed.coherenceIssues||[]).filter(i =>
        !jsPreErrors.some(j => j.field === i.field) // don't duplicate
      );
      parsed.coherenceIssues = [...jsPreErrors, ...aiIssues];
      if(jsPreErrors.some(e=>e.type==='error')) parsed.overallStatus = 'rejected';
      return parsed;
    }
    // If AI failed but we have JS errors, still return them
    if(jsPreErrors.length > 0) {
      return { overallStatus:'rejected', summary:'', setValues:{}, coherenceIssues:jsPreErrors, perDocumentStatus:{} };
    }
    return { overallStatus:'warning', summary:'', setValues:{}, coherenceIssues:[], perDocumentStatus:{} };
  } catch(e) {
    console.error('analyzeCoherence error:', e.message);
    // Even on timeout, return JS pre-errors if we have them
    if(jsPreErrors.length > 0) {
      return { overallStatus:'rejected', summary:'', setValues:{}, coherenceIssues:jsPreErrors, perDocumentStatus:{} };
    }
    return { overallStatus:'warning', summary:'', setValues:{}, coherenceIssues:[{type:'warning',field:'system',message:'Analysis timeout — results may be incomplete. Try with fewer documents.',details:[]}], perDocumentStatus:{} };
  }
}

function normalizeValue(v){
  if(!v) return '';
  let s = String(v).toLowerCase().trim();
  // Strip trailing decimal zeros: 199824.00 → 199824
  s = s.replace(/(\d+)\.0+(?=$|\s)/g, '$1');
  // Remove thousand separators
  s = s.replace(/(\d),(\d{3})/g, '$1$2');
  // Normalize weight units to 'kg'
  s = s.replace(/\bkilogramos?\b/g, 'kg').replace(/\bkilograms?\b/g, 'kg')
       .replace(/\bkgs\b/g, 'kg').replace(/\bkilos?\b/g, 'kg');
  // Normalize metric tons
  s = s.replace(/\btoneladas?\s*m[eé]tricas?\b/g, 'mt').replace(/\bmetric\s*ton+e?s?\b/g, 'mt');

  // ── BAG / SACK UNITS ──────────────────────────────────────────
  // Rules:
  // 1. Bare unit words (no type) → normalize to "bags"
  //    "saco", "sacos", "bag", "bags", "sack", "sacks", "bolsa" → "bags"
  // 2. WITH a material/type qualifier → normalize the word but KEEP the type
  //    "sacos de yute" → "bags yute"  (type preserved for comparison)
  //    "plastic bags"  → "bags plastic"
  //    "jute bags"     → "bags jute"
  //    "sacos de plastico" → "bags plastico"
  // This way: "sacos de yute" vs "jute bags" → same ✓
  //           "sacos de yute" vs "plastic bags" → DIFFERENT ✗ (flagged as observation)

  // Material types to watch for
  const bagMaterials = [
    'yute','jute','plastic','plástico','plastico','polipropileno','polypropylene',
    'pp','burlap','arpillera','tela','woven','tejido','paper','papel','mesh','malla'
  ];
  const bagMaterialPattern = bagMaterials.join('|');

  // "sacos de yute" / "saco de plastico" → "bags yute" / "bags plastico"
  s = s.replace(new RegExp('\\b(?:sacos?|bolsas?|sacks?|bags?)\\s+(?:de\\s+)?(' + bagMaterialPattern + ')\\b', 'gi'), 'bags $1');
  // "jute bags" / "plastic bags" → "bags jute" / "bags plastic"
  s = s.replace(new RegExp('\\b(' + bagMaterialPattern + ')\\s+(?:sacos?|bolsas?|sacks?|bags?)\\b', 'gi'), 'bags $1');

  // Normalize material name variants (yute=jute, plastico=plastic, etc.)
  s = s.replace(/\bplástico\b/g, 'plastic').replace(/\bplastico\b/g, 'plastic');
  s = s.replace(/\byute\b/g, 'jute');
  s = s.replace(/\barpillera\b/g, 'jute').replace(/\bburlap\b/g, 'jute');
  s = s.replace(/\bpolipropileno\b/g, 'pp').replace(/\bpolypropylene\b/g, 'pp');

  // Bare bag words (no material) → "bags"
  s = s.replace(/\bsacos?\b/g, 'bags');
  s = s.replace(/\bbolsas?\b/g, 'bags');
  s = s.replace(/\bsacks?\b/g, 'bags');
  s = s.replace(/\bsacs?\b/g, 'bags');
  s = s.replace(/\bbags?\b/g, 'bags');
  // "JT" = jute bags in some certificates
  s = s.replace(/\bjt\b/g, 'bags jute');

  // ── COUNTRY NAMES ─────────────────────────────────────────────
  s = s.replace(/\bunited\s*states\s*of\s*america\b/g, 'usa')
       .replace(/\bunited\s*states\b/g, 'usa').replace(/\bu\.s\.a\.?\b/g, 'usa')
       .replace(/\bestados\s*unidos\b/g, 'usa');

  // ── VESSEL / TRANSPORT MODE ─────────────────────────────────────
  // "Marítimo" / "Maritimo" / "Maritime" = transport mode, not a vessel name
  // If the value is just a transport mode word, blank it out so it doesn't match vessel names
  const transportModeWords = ['maritimo','marítimo','maritime','maritima','air','airfreight','road','truck','rail','sea'];
  if(transportModeWords.includes(s.trim())) return '__transport_mode__';

  // ── PORT NORMALIZATION ────────────────────────────────────────
  // Strip prefixes
  s = s.replace(/\b(puerto\s+de|port\s+of|harbor\s+of|puerto)\s+/g, '');
  // Strip country/state suffixes (comma, hyphen, or space before country)
  // Strip country suffixes only when preceded by other content (comma, hyphen, or word chars)
  // This preserves standalone country names like "USA" or "Ecuador"
  s = s.replace(/(\S)[-,]\s*(ecuador|colombia|venezuela|peru|usa|u\.s\.a?\.?|mexico|panama|costa rica|guatemala|china|netherlands|germany|france|spain|italy|united kingdom|estados\s*unidos|united\s*states)\b.*/g, '$1')
       .replace(/(\S)\s+(ecuador|colombia|venezuela|peru|usa|u\.s\.a?\.?|mexico|panama|costa rica|guatemala|china|netherlands|germany|france|spain|italy|united kingdom|estados\s*unidos|united\s*states)\s*$/g, '$1');
  s = s.replace(/,\s*(ny|nj|ca|fl|tx|ga|sc|nc|va|pa|wa)\b.*/g, '')
       .replace(/\s+(ny|nj|ca|fl|tx|ga|sc|nc|va|pa|wa)\s*$/g, '');
  // Known port area normalizations
  s = s.replace(/\bjersey\s*city\b/g, 'new york');
  s = s.replace(/\bnewark\b/g, 'new york');
  s = s.replace(/\bnueva\s*york\b/g, 'new york');
  s = s.replace(/\bguayas\b/g, 'posorja');
  s = s.replace(/\bguayaquil\b/g, 'posorja');
  // Final cleanup: strip everything after comma, trim leading/trailing punctuation
  s = s.replace(/,.*$/, '').replace(/^[\s,\-]+/, '').trim();

  // ── STRIP ADDRESS FROM COMPANY NAME ─────────────────────────────
  // "COMPANY NAME AV FRANCISCO DE ORELLANA..." → "COMPANY NAME"
  // Remove everything after common address indicators
  s = s.replace(/\s+(av\s|avenida\s|calle\s|street\s|st\s|blvd\s|road\s|ave\s|c\/\s|carrera\s|km\s|#\s*\d).*$/i, '');
  // Remove city/country after company name (comma + word)
  s = s.replace(/,\s*[a-z]{3,}.*$/i, '');

  // ── COMPANY SUFFIXES ──────────────────────────────────────────
  s = s.replace(/\bcorporation\b/g, 'corp').replace(/\bincorporated\b/g, 'inc')
       .replace(/\blimited\b/g, 'ltd').replace(/\bcompany\b/g, 'co');

  // ── PUNCTUATION ───────────────────────────────────────────────
  s = s.replace(/[.,;]+$/g, '').replace(/\.(?=\s|$)/g, '');
  s = s.replace(/[\s\-]+/g, ' ').trim();
  return s;
}

function extractNum(s){
  const m = String(s).replace(/,/g,'').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function isCode(s){
  // Reference codes that must match EXACTLY — never compare numerically
  const t = s.trim();
  return /^[A-Z]{4}\d{6,7}$/i.test(t) ||           // container: ECMU5239485
         /^[A-Z]{2,4}\d{6,}$/i.test(t) ||           // BL/seal: MAEU266461945
         /^\d{3}-\d{3}-\d{6,}$/.test(t) ||           // invoice: 001-002-000000824
         /^\d{3}-\d{4}-\d{2}-\d{6,}$/.test(t) ||     // DAE: 028-2026-40-00512739
         /^\d+-\d+-\d+$/.test(t);                     // any digit-dash-digit reference
}

function splitCodes(s){
  // Split "ECMU123, SEKU456, TCKU789" into ["ECMU123","SEKU456","TCKU789"]
  return String(s).split(/[,;\s]+/).map(x=>x.trim().toUpperCase()).filter(x=>x.length>2);
}

function isContainerList(s){
  // A value is a container list if it contains at least one container-format code
  const tokens = splitCodes(s);
  return tokens.some(t => /^[A-Z]{4}\d{6,7}$/.test(t));
}

function normalizeDocType(dt){
  if(!dt) return '';
  const s = dt.toLowerCase().trim();
  if(s.indexOf('gas clearance')>=0||s.indexOf('quarantine treatment')>=0||
     s.indexOf('tratamiento cuarentenario')>=0||s.indexOf('fumig')>=0) return 'fumigation certificate';
  if(s.indexOf('packing')>=0) return 'packing list';
  if(s.indexOf('bill of lading')>=0||s.indexOf('conocimiento')>=0) return 'bill of lading';
  if(s.indexOf('phytosanitary')>=0||s.indexOf('fitosanitario')>=0) return 'phytosanitary certificate';
  if(s.indexOf('certificate of origin')>=0||s.indexOf('certificado de origen')>=0) return 'certificate of origin';
  if(s.indexOf('commercial invoice')>=0||s.indexOf('factura comercial')>=0) return 'commercial invoice';
  if(s.indexOf('declaration letter')>=0) return 'declaration letter';
  if(s.indexOf('sample test')>=0||s.indexOf('quality cert')>=0) return 'quality certificate';
  return s;
}

// Known cocoa/coffee product description synonyms — same commodity, different language/format
const PRODUCT_SYNONYMS = [
  ['cocoa bean','cacao en grano','grano de cacao','theobroma cacao','cocoa beans','cacao beans','cocoa bean from','granos de cacao'],
  ['coffee bean','cafe en grano','grano de cafe','coffea arabica','coffee beans','green coffee'],
];
function isSameProduct(a, b){
  const norm = s => String(s||'').toLowerCase().replace(/[^a-z\s]/g,'').trim();
  const na = norm(a), nb = norm(b);
  for(const group of PRODUCT_SYNONYMS){
    const inA = group.some(syn => na.includes(syn));
    const inB = group.some(syn => nb.includes(syn));
    if(inA && inB) return true;
  }
  return false;
}

function isTrivialDifference(a, b){
  if(!a || !b) return false;
  const sa = String(a).trim(), sb = String(b).trim();

  // 1. Case-insensitive exact match
  if(sa.toLowerCase() === sb.toLowerCase()) return true;

  // 1b. Bag count: same number + any bag unit variant = trivial
  // "1448 bags" = "1448 YUTE BAGS" = "1448 JT" = "1448 sacos" = "1448 S A C O"
  const bagPattern = /^(\d[\d,.]*)\s*(bags?|sacos?|sacks?|bolsas?|jt|jute|yute|s\s*a\s*c\s*o|yute\s+bags?|jute\s+bags?|pp\s+bags?|plastic\s+bags?|bultos?|boxes?|cajones?|cajas?)?\s*$/i;
  const ma = bagPattern.exec(sa.replace(/\s+/g,' ').trim());
  const mb = bagPattern.exec(sb.replace(/\s+/g,' ').trim());
  if(ma && mb) {
    const na = parseFloat(ma[1].replace(/,/g,''));
    const nb = parseFloat(mb[1].replace(/,/g,''));
    if(!isNaN(na) && !isNaN(nb) && Math.abs(na-nb) < 0.01) return true;
  }

  // 0b. Same product — commercial vs botanical vs translated name
  if(isSameProduct(sa, sb)) return true;


  // 2. CONTAINER LISTS — compare element by element
  // If both values contain container-format codes, compare the sets
  if(isContainerList(sa) || isContainerList(sb)){
    const codesA = new Set(splitCodes(sa));
    const codesB = new Set(splitCodes(sb));
    if(codesA.size !== codesB.size) return false;
    for(const code of codesA){
      if(!codesB.has(code)) return false;
    }
    return true; // all codes match
  }

  // 3. Single code (BL, seal) — exact match only, but allow OCR errors for invoice numbers
  if(isCode(sa) || isCode(sb)) {
    const la = sa.replace(/[\s\-]/g,'').toLowerCase(), lb = sb.replace(/[\s\-]/g,'').toLowerCase();
    // Prefix match (truncation): "00100200000080" starts with "0010020000008"
    if(la.length > 8 && lb.length > 8 && Math.abs(la.length - lb.length) <= 2) {
      const shorter = la.length <= lb.length ? la : lb;
      const longer = la.length > lb.length ? la : lb;
      if(longer.startsWith(shorter)) return true;
    }
    // High similarity: same prefix structure, differs only in last 3 digits (OCR error)
    // e.g. "001002000000080" vs "001002000000802" — share first 12 digits
    if(la.length > 10 && lb.length > 10) {
      const minLen = Math.min(la.length, lb.length);
      const prefixLen = Math.floor(minLen * 0.8);
      if(la.substring(0, prefixLen) === lb.substring(0, prefixLen)) return true;
    }
    return false;
  }

  // 4. After full normalization
  const na = normalizeValue(sa), nb = normalizeValue(sb);
  if(na === nb) return true;

  // 4b. Transport mode words are not real values — treat as trivial
  if(na === '__transport_mode__' || nb === '__transport_mode__') return true;

  // 5. Containment — only for plain text (cities, names), not codes, not bag-type values
  const looksLikeCode = s => /^[A-Z0-9\-]{6,}$/i.test(s.replace(/[\s,]/g,''));
  // If either value contains "bags" followed by a material, skip containment entirely
  // because "726 bags jute" must NOT match "726 bags plastic" via containment
  const hasBagWord = s => /\bbags\b/.test(s);
  // Only use containment for pure text without bag units
  if(!looksLikeCode(na) && !looksLikeCode(nb) && !hasBagWord(na) && !hasBagWord(nb)){
    if(na && nb && (na.includes(nb) || nb.includes(na))) return true;
    // Port-specific: both values start with the same significant word (city name)
    const firstWord = s => s.split(/[\s,\-]+/)[0];
    if(firstWord(na).length > 3 && firstWord(na) === firstWord(nb)) return true;
  }
  // 5b. After stripping company legal suffixes, check if core name matches
  const stripSuffix = s => s
    .replace(/\s*(corporation|incorporated|limited|company)\.?$/gi, '')
    .replace(/\s*(corp|inc|ltd|llc|co|sa|srl|gmbh|bv|nv|plc|pvt|pty)\.?$/gi, '')
    .trim();
  const ca = stripSuffix(na), cb = stripSuffix(nb);
  if(ca && cb && ca.length > 3 && ca === cb) return true;
  // 5c. Compare with spaces removed — "aroma cacao" = "aromacacao"
  const noSp = s => s.replace(/\s/g,'');
  if(noSp(ca).length > 5 && noSp(ca) === noSp(cb)) return true;
  // 5d. One contains the other after suffix strip — "aromas y sabores del ecuador aromacacao" contains "aromacacao"
  if(ca && cb && ca.length > 5 && cb.length > 5 && (ca.includes(cb) || cb.includes(ca))) return true;

  // 6. Numeric comparison — only for values that are purely numeric/weight
  // Skip if values have bag material qualifiers (726 bags jute ≠ 726 bags plastic)
  const hasBagMaterial = s => /\bbags\s+\w+\b/.test(s) || /\bbag\s+\w+\b/.test(s);
  const skipNumeric = hasBagMaterial(na) || hasBagMaterial(nb);
  if(!skipNumeric){
    const n1 = extractNum(sa), n2 = extractNum(sb);
    if(!isNaN(n1) && !isNaN(n2) && n1 > 0 && Math.abs(n1-n2) < 0.01) return true;
    // Numeric after normalization (handles 199824.00 KGS vs 199824 kg)
    const nn1 = extractNum(na), nn2 = extractNum(nb);
    if(!isNaN(nn1) && !isNaN(nn2) && nn1 > 0 && Math.abs(nn1-nn2) < 0.01) return true;
  }

  // 8. European vs American format (50.094 vs 50,094 vs 50094)
  // Skip if values have bag material qualifiers (same guard as step 6)
  if(!skipNumeric){
    const en1 = normalizeExtractedNumber(sa), en2 = normalizeExtractedNumber(sb);
    if(en1 && en2 && !isNaN(en1) && !isNaN(en2) && en1 > 0 && Math.abs(en1-en2) < 0.01) return true;
  }

  // 8. Both look like dates
  const isDate = s => /\d{1,2}[\/\-\.]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago)/i.test(s);
  if(isDate(sa) && isDate(sb)) return true;

  // 9. Weight tolerance — values within 0.5% are trivial (scale rounding, moisture loss)
  if(!skipNumeric){
    const w1 = normalizeExtractedNumber(sa), w2 = normalizeExtractedNumber(sb);
    if(w1 && w2 && !isNaN(w1) && !isNaN(w2) && w1 > 100 && w2 > 100) {
      const diff = Math.abs(w1 - w2);
      const pct = diff / Math.max(w1, w2);
      if(pct < 0.005) return true; // 0.5% tolerance
    }
  }

  // 10. Shipper/company: one value is a substring or abbreviation of the other
  // "AROMACACAO S.A. Av. Francisco de Orellana..." vs "AROMACACAO S.A."
  // After normalization, the shorter should be contained in the longer
  if(na.length > 5 && nb.length > 5) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length > nb.length ? na : nb;
    // If shorter is >60% of longer and longer starts with shorter
    if(shorter.length > longer.length * 0.5 && longer.startsWith(shorter)) return true;
  }

  // 11. Vessel name prefixes: "MV MAERSK GLACIER" = "MAERSK GLACIER" = "M/V MAERSK GLACIER"
  const stripVesselPrefix = s => s.replace(/^(m\/v|mv|m\.v\.|ss|mt|m\/t)\s+/i, '').trim();
  const va = stripVesselPrefix(na), vb = stripVesselPrefix(nb);
  if(va.length > 4 && vb.length > 4 && va === vb) return true;
  // One contains the other after prefix strip
  if(va.length > 5 && vb.length > 5 && (va.includes(vb) || vb.includes(va))) return true;

  return false;
}

function filterTrivialInconsistencies(coherenceResult){
  if(!coherenceResult) return coherenceResult;
  const f = JSON.parse(JSON.stringify(coherenceResult));
  // Filter coherenceIssues
  const containerFields = new Set(['containers','containerNumbers','container_numbers','sealNumbers','seals']);
  let containerIssueAdded = false;
  const filtered_issues = [];

  for(const iss of (f.coherenceIssues||[])){
    // Skip internal system errors — not a real doc inconsistency
    if(iss.field === 'system') continue;

    // Deduplicate container issues — keep only the first one
    if(containerFields.has(iss.field)){
      if(containerIssueAdded) continue; // skip duplicates
    }

    const vals = (iss.details||[]).map(d=>d.value).filter(Boolean);
    if(vals.length < 2){ filtered_issues.push(iss); if(containerFields.has(iss.field)) containerIssueAdded=true; continue; }

    let keep = false;
    for(let i=0; i<vals.length && !keep; i++)
      for(let j=i+1; j<vals.length && !keep; j++)
        if(!isTrivialDifference(vals[i], vals[j])) keep = true;

    if(keep){
      filtered_issues.push(iss);
      if(containerFields.has(iss.field)) containerIssueAdded = true;
    }
  }
  f.coherenceIssues = filtered_issues;
  // Fix setValues statuses
  if(f.setValues){
    for(const key of Object.keys(f.setValues)){
      const d = f.setValues[key];
      if(d && d.status==='inconsistent' && (d.values||[]).length > 1){
        const vals = d.values.map(v=>v.value).filter(Boolean);
        let trivial = true;
        outer: for(let i=0; i<vals.length; i++)
          for(let j=i+1; j<vals.length; j++)
            if(!isTrivialDifference(vals[i],vals[j])){ trivial=false; break outer; }
        if(trivial) d.status = 'consistent';
      }
    }
  }
  const errs = f.coherenceIssues.filter(i=>i.type==='error').length;
  const warns = f.coherenceIssues.filter(i=>i.type==='warning').length;
  if(errs===0 && warns===0) f.overallStatus='approved';
  else if(errs===0) f.overallStatus='warning';
  return f;
}

function highlightDiffs(uniqueVals, allValues){
  if(!uniqueVals || uniqueVals.length <= 1) return (uniqueVals||[])[0] || '—';
  function tokenize(s){ return String(s||'').split(/[\s,\/\-]+/).filter(Boolean); }
  const tokenSets = uniqueVals.map(v => new Set(tokenize(v)));
  const firstTokens = tokenize(uniqueVals[0]);
  const commonTokens = new Set(firstTokens.filter(t => tokenSets.every(ts => ts.has(t))));
  const rows = allValues.map(entry => {
    const docName = (entry.doc||'').replace(/\.[^.]+$/,'');
    const val = entry.value || '—';
    const tokens = tokenize(val);
    const highlighted = tokens.map(token =>
      commonTokens.has(token) ? token : '<mark class="diff-mark">'+token+'</mark>'
    ).join(' ');
    return '<div class="diff-row"><span class="diff-doc">'+docName+':</span> <span class="diff-val">'+highlighted+'</span></div>';
  });
  return '<div class="diff-block">'+rows.join('')+'</div>';
}

const _translationCache = {}; // cache to avoid re-translating same text

async function translateWithAI(text, targetLang){
  if(!text || targetLang === 'en') return text;
  const cacheKey = targetLang + '::' + text;
  if(_translationCache[cacheKey]) return _translationCache[cacheKey];

  // First try local phrase-by-phrase translation (no API needed)
  const local = translateSummaryLocal(text);
  if(local !== text){
    _translationCache[cacheKey] = local;
    return local;
  }

  // If local didn't change much, try API
  try {
    const system = 'You are a translator. Translate the following text to Spanish. Return ONLY the translated text, nothing else. Keep technical terms like BL, COI, ISF, container numbers, lot numbers, and company names as-is.';
    const result = await callClaudeHaiku(system, text, 500);
    const translated = result.trim();
    _translationCache[cacheKey] = translated;
    return translated;
  } catch(e) {
    console.warn('Translation failed:', e.message);
    // Return local translation as fallback even if partial
    return local;
  }
}

function translateSummaryLocal(text){
  if(!text) return text;
  // Comprehensive phrase-by-phrase translation
  const phrases = [
    // Verdicts
    ['Document set shows strong internal coherence','El set de documentos muestra coherencia interna sólida'],
    ['Document set shows','El set de documentos muestra'],
    ['strong internal coherence','fuerte coherencia interna'],
    ['internal coherence','coherencia interna'],
    ['All documents are consistent','Todos los documentos son coherentes'],
    ['All values are consistent','Todos los valores son coherentes'],
    ['No inconsistencies found','No se encontraron inconsistencias'],
    ['The shipment can proceed','El embarque puede proceder'],
    // Issues
    ['Critical warning:','Advertencia crítica:'],
    ['Critical inconsistency:','Inconsistencia crítica:'],
    ['Container number inconsistency','Inconsistencia en número de contenedor'],
    ['Container number mismatch','Discrepancia en número de contenedor'],
    ['container number','número de contenedor'],
    ['Shipper name discrepancy','Discrepancia en nombre del shipper'],
    ['shipper name','nombre del shipper'],
    ['Invoice number','Número de factura'],
    ['invoice number','número de factura'],
    ['does not match','no coincide'],
    ['do not match','no coinciden'],
    ['mismatch detected','discrepancia detectada'],
    ['mismatch','discrepancia'],
    ['discrepancy','discrepancia'],
    ['inconsistency','inconsistencia'],
    ['inconsistencies','inconsistencias'],
    ['require clarification','requieren aclaración'],
    ['requires clarification','requiere aclaración'],
    ['should be verified','debe verificarse'],
    ['should be reviewed','debe revisarse'],
    ['must be resolved','debe resolverse'],
    // Multi-doc
    ['with matching totals across multi-document groups','con totales coincidentes en grupos de documentos múltiples'],
    ['multi-document groups','grupos de documentos múltiples'],
    ['matching totals','totales coincidentes'],
    // Units
    ['bags','sacos'],
    ['net weight','peso neto'],
    ['gross weight','peso bruto'],
    ['containers','contenedores'],
    ['lot number','número de lote'],
    ['bill of lading','conocimiento de embarque'],
    ['vessel','buque'],
    ['port of loading','puerto de carga'],
    ['port of discharge','puerto de descarga'],
    // Connectors
    [' and ',' y '],
    [' also differs',' también difiere'],
    [' also ',' también '],
    ['appears to be','parece ser'],
    ['typographical error','error tipográfico'],
    ['while','mientras que'],
    ['shows','muestra'],
    ['lists','indica'],
    ['vs','vs'],
    // More connectors and common phrases
    ['across all documents','en todos los documentos'],
    ['across','entre'],
    ['between','entre'],
    ['Analysis completed but response could not be fully processed.','Análisis completado pero la respuesta no pudo procesarse completamente.'],
    ['could not be fully processed','no pudo procesarse completamente'],
    ['The document set','El set de documentos'],
    ['document set','set de documentos'],
    ['documents show','los documentos muestran'],
    ['are consistent','son coherentes'],
    ['is consistent','es coherente'],
    ['overall','en general'],
    ['however','sin embargo'],
    ['but','pero'],
    ['This is a','Esto es una'],
    ['This appears','Esto parece'],
    ['These values','Estos valores'],
    ['The values','Los valores'],
    ['differ between','difieren entre'],
    ['differ from','difieren de'],
    ['found in','encontrado en'],
    ['not found','no encontrado'],
    ['missing in','falta en'],
  ];

  let result = text;
  for(const [en, es] of phrases){
    // Case-insensitive replacement preserving structure
    result = result.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'), es);
  }
  return result;
}

const DOC_TYPE_ES = {
  'bill of lading': 'Bill of Lading',
  'commercial invoice': 'Factura Comercial',
  'packing list': 'Packing List',
  'certificate of origin': 'Certificado de Origen',
  'phytosanitary certificate': 'Certificado Fitosanitario',
  'fumigation certificate': 'Certificado de Fumigación',
  'fumigation treatment certificate': 'Certificado de Tratamiento de Fumigación',
  'quality certificate': 'Certificado de Calidad',
  'letter of declaration': 'Carta de Declaración',
  'declaration letter': 'Carta Declaración',
  'isf': 'ISF',
  '3rd party quality report': 'Reporte de Calidad (Tercero)',
  'import permit': 'Permiso de Importación',
  'organic certificate': 'Certificado Orgánico (COI)',
  'organic certificate (coi)': 'Certificado Orgánico (COI)',
  'coi': 'COI',
  'shipping notification': 'Notificación de Embarque',
  'shipping instruction': 'Instrucción de Embarque',
  'delivery order': 'Orden de Entrega',
  'customs declaration': 'Declaración Aduanera',
  'weight certificate': 'Certificado de Peso',
  'inspection certificate': 'Certificado de Inspección',
  'health certificate': 'Certificado Sanitario',
  'insurance certificate': 'Certificado de Seguro',
  'bank draft': 'Letra de Cambio',
  'letter of credit': 'Carta de Crédito',
};

function translateDocType(docType){
  if(!docType || lang !== 'es') return docType;
  const key = String(docType).toLowerCase().trim();
  return DOC_TYPE_ES[key] || docType;
}

function translateSummary(summary){
  if(!summary) return summary;
  if(lang !== 'es') return summary;
  // Use comprehensive local translator
  const local = translateSummaryLocal(summary);
  if(local !== summary) return local;
  // Fallback: translate known AI fallback messages
  const known = [
    ['Analysis completed but response could not be fully processed.',
     'Análisis completado pero la respuesta no pudo ser procesada completamente.'],
    ['Connection error:', 'Error de conexión:'],
    ['All documents are consistent', 'Todos los documentos son coherentes'],
    ['No inconsistencies found', 'No se encontraron inconsistencias'],
    ['All values are consistent', 'Todos los valores son coherentes'],
    ['The shipment can proceed', 'El embarque puede proceder'],
    ['Critical discrepancy', 'Discrepancia crítica'],
    ['mismatch detected', 'discrepancia detectada'],
    ['does not match', 'no coincide'],
    ['should be reviewed', 'debe ser revisado'],
    ['inconsistency found', 'inconsistencia encontrada'],
    ['values differ', 'los valores difieren'],
  ];
  let result = summary;
  for(const [en, es] of known){
    result = result.replace(new RegExp(en, 'gi'), es);
  }
  return result;
}

function FL(key){
  if(!key) return key;
  // Extra fields have prefix 'extra_FieldName' — show the original field name
  if(key.startsWith('extra_')) return key.replace('extra_', '');
  return tx().FL[key] || key;
}

function normalizeExtractedNumber(val){
  // Fix OCR number separator confusion
  // European: "50.094,00" → 50094
  // American: "50,094.00" → 50094
  // Plain decimal: "199824.00" → 199824
  if(!val) return null;
  const s = String(val).trim();
  // European: digits.3digits[,decimal] e.g. "50.094,00"
  if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)){
    return parseFloat(s.replace(/\./g,'').replace(',','.'));
  }
  // American: digits,3digits[.decimal] e.g. "50,094.00"
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)){
    return parseFloat(s.replace(/,/g,''));
  }
  // Plain: "199824.00" or "199824" — just parseFloat
  const plain = parseFloat(s.replace(/,/g,''));
  return isNaN(plain) ? NaN : plain;
}
function buildSetValuesFromResults(results){
  // Directly extract and compare values from all docs — used when AI setValues is empty
  const fieldMap = {
    containers: r => { const a = r.containerNumbers; return (Array.isArray(a) ? a : a ? [a] : []).map(c=>String(c).trim().toUpperCase()).sort().join(', '); },
    seals:      r => { const a = r.sealNumbers; return (Array.isArray(a) ? a : a ? [a] : []).map(s=>String(s).trim().toUpperCase()).sort().join(', '); },
    lots:       r => { const l = r.lotNumbers; return (Array.isArray(l) ? l : l ? [l] : []).map(x=>String(x).trim()).sort().join(', '); },
    bags:       r => r.bagCount ? r.bagCount + ' ' + (r.bagUnit||'') : null,
    netWeight:  r => r.netWeight ? r.netWeight + ' ' + (r.netWeightUnit||'') : null,
    grossWeight:r => r.grossWeight ? r.grossWeight + ' ' + (r.grossWeightUnit||'') : null,
    shipper:    r => r.shipper,
    consignee:  r => r.consigneeName,
    vessel:     r => r.vesselName,
    portOfLoading:  r => r.portOfLoading,
    portOfDischarge:r => r.portOfDischarge,
    blNumber:   r => r.blNumber,
    invoiceNumber: r => r.invoiceNumber,
    destinationCountry: r => r.destinationCountry,
    originCountry: r => r.originCountry,
    voyageNumber: r => r.voyageNumber,
  };

  // Doc types that cover individual lots — exclude from lot comparison
  const perLotTypes = ['fumigation','fumigación','fumigacion','gas clearance','quarantine',
    'phytosanitary','fitosanitario'];
  // Doc types/filenames to exclude from container/seal comparison
  const skipContainerTypes = ['notification','notificacion','email','correo','letter','carta',
    'declaration','shipping notification','unidad','isf','transmittal'];

  const out = {};
  for(const [key, getter] of Object.entries(fieldMap)){
    const values = [];
    results.forEach(r => {
      const dt = (r.docType||'').toLowerCase();
      const fn = (r._filename||'').toLowerCase();

      // Skip per-lot docs for lot comparison (fumigation/phyto cover 1 lot each)
      if(key === 'lots' && perLotTypes.some(t => dt.includes(t) || fn.includes(t))) return;

      // Skip reference-only docs for containers/seals
      if((key === 'containers' || key === 'seals') &&
         skipContainerTypes.some(t => dt.includes(t) || fn.includes(t))) return;

      const v = getter(r);
      if(v && v !== 'null' && v !== 'undefined' && v.trim() !== '') {
        values.push({ doc: r._filename||r.docType||'?', value: v.trim() });
      }
    });
    if(!values.length) continue;
    const unique = [...new Set(values.map(v=>v.value))];
    // Check if all unique values are trivially the same (kg vs kgs, bags vs sacos, case, etc.)
    let allTrivial = true;
    if (unique.length > 1) {
      for (let i = 0; i < unique.length && allTrivial; i++)
        for (let j = i+1; j < unique.length && allTrivial; j++)
          if (!isTrivialDifference(unique[i], unique[j])) allTrivial = false;
    }
    out[key] = {
      status: unique.length === 1 || allTrivial ? 'consistent' : values.length > 1 ? 'inconsistent' : 'single_source',
      values
    };
  }
  return out;
}
