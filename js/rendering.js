// js/rendering.js — Results rendering: split panel, matrix, verdict
// Depends on globals: coherenceResult, analysisResults, lang, TX, _cachedSummary, _spFields, _spSelectingFromClick, lastFinalErrors, lastFinalWarnings
// Depends on: coherence.js (filterTrivialInconsistencies, buildSetValuesFromResults, FL, translateDocType, etc.), extraction.js (isExcel, isWord)

function renderResults(){
  try {
  document.getElementById('results').classList.add('show');
  const t=tx();

  // ── STEP 1: Use JS-determined results directly (no AI filtering needed)
  // Apply trivial-difference filter (kg vs kgs, bags vs sacos, case, number format, etc.)
  const filtered = filterTrivialInconsistencies(coherenceResult);
  const smartResult = filtered;
  // displayIssues: filter out system/document_processing fields
  const displayIssues = (filtered?.coherenceIssues||[]).filter(iss =>
    iss.field !== 'system' && iss.field !== 'document_processing' && iss.field !== 'documentProcessing'
  );

  // ── STEP 2: Build tableData and tableEntries (GROUND TRUTH) ─
  const perDoc = (() => {
    let pd = smartResult?.perDocumentStatus || {};
    const hasMatchingKeys = analysisResults.some(r => pd[r._filename]);
    if(!hasMatchingKeys && Object.keys(pd).length > 0){
      const remapped = {};
      analysisResults.forEach(r => {
        const match = Object.entries(pd).find(([k,v]) =>
          k === r._filename ||
          (v.docType && r.docType && v.docType.toLowerCase().includes(r.docType.toLowerCase().substring(0,6)))
        );
        if(match) remapped[r._filename] = match[1];
      });
      if(Object.keys(remapped).length > 0) pd = remapped;
    }
    if(!analysisResults.some(r => pd[r._filename])){
      analysisResults.forEach(r => {
        pd[r._filename] = {
          status: r._err ? 'warning' : 'approved',
          docType: translateDocType(r.docType) || r._filename,
          issues: r._err ? ['Could not fully extract data'] : [],
          comment: ''
        };
      });
    }
    return pd;
  })();

  let tableData = smartResult?.setValues || {};
  // Always run JS comparison as ground truth
  const jsTableData = buildSetValuesFromResults(analysisResults);
  if(location?.hostname==='localhost') console.log('[renderResults] AI setValues keys:', Object.keys(tableData).length, '| JS tableData keys:', Object.keys(jsTableData).length, '| analysisResults:', analysisResults.length);
  if(!Object.values(tableData).some(d=>d?.values?.length)){
    tableData = jsTableData;
  } else {
    // Merge: JS wins when it detects inconsistency that AI missed
    for (const [key, jsField] of Object.entries(jsTableData)) {
      if (!tableData[key] || !tableData[key].values?.length) {
        tableData[key] = jsField;
      } else if (jsField.status === 'inconsistent' && tableData[key].status === 'consistent') {
        tableData[key].status = 'inconsistent';
      }
    }
  }

  // Override: if JS pre-check found errors for a field, force it to inconsistent
  // This handles cases where AI didn't extract data from some docs but JS detected mismatches
  (displayIssues||[]).forEach(iss => {
    if(iss.type !== 'error') return;
    const fieldKey = iss.field;
    const aliases = {
      containerNumbers:'containers', container_numbers:'containers',
      sealNumbers:'seals', seal_numbers:'seals',
      vesselName:'vessel', vessel_name:'vessel',
      port_of_loading:'portOfLoading', port_of_discharge:'portOfDischarge',
    };
    const key = aliases[fieldKey] || fieldKey;
    if(tableData[key]) {
      if(tableData[key].status === 'consistent' || tableData[key].status === 'single_source') {
        tableData[key].status = 'inconsistent';
        // Add the pre-check details as values if missing
        if(iss.details && iss.details.length > 0 && (!tableData[key].values || tableData[key].values.length < 2)) {
          tableData[key].values = iss.details;
        }
      }
    } else if(iss.details && iss.details.length > 0) {
      // Field not in tableData at all — add it
      tableData[key] = { status:'inconsistent', values: iss.details };
    }
  });

  // Build tableEntries — trust status set by JS comparison engine
  const tableEntries = Object.entries(tableData).map(([k,d]) => {
    // Skip internal fields
    if(k === 'system' || k === 'document_processing') return null;
    const uv = [...new Set((d.values||[]).map(v=>v.value).filter(v=>v&&v!=='null'&&v!=='undefined'))];
    if(uv.length === 0) return null;
    // Use the status set by analyzeCoherence JS engine — don't re-filter
    const isErr = d.status === 'inconsistent';
    const allSame = d.status === 'consistent' || d.status === 'single_source';
    const sortKey = isErr ? 0 : !allSame ? 1 : 2;
    return {k, d, uv, allSame, isErr, sortKey};
  }).filter(e => e !== null && e.uv.length > 0);
  tableEntries.sort((a,b) => a.sortKey - b.sortKey);

  // ── STEP 3: Derive counts from ground truth ─────────────────
  // tableEntries is the single source of truth
  // All non-trivial inconsistencies are critical — the filter already removed trivial ones
  // (case, number format, geography, units, dates)
  const tableErrors   = tableEntries.filter(e => e.isErr).length;
  const issueErrors   = displayIssues.filter(i=>i.type==='error').length;
  const issueWarnings = displayIssues.filter(i=>i.type==='warning').length;
  const finalErrors   = Math.max(tableErrors, issueErrors);
  const finalWarnings = finalErrors > 0 ? 0 : issueWarnings;
  lastFinalErrors = finalErrors; lastFinalWarnings = finalWarnings;

  // ── STEP 4: Status pill + summary card ──────────────────────
  const pill     = document.getElementById('statusPill');
  const pillText = document.getElementById('statusPillText');
  const sumCard  = document.getElementById('summaryCard');
  const sumText  = document.getElementById('summaryCardText');

  // legacy hidden elements — kept for compat
  const vIcon  = document.getElementById('verdictIcon');
  const vTitle = document.getElementById('verdictTitle');
  const vDesc  = document.getElementById('verdictDesc');

  if(finalErrors > 0){
    if(pill) { pill.className='rv-wrap rv-err'; }
    if(pillText) pillText.textContent = lang==='es'
      ? `${finalErrors} inconsistencia(s) crítica(s) — no liberar la carga`
      : `${finalErrors} critical inconsistenc${finalErrors===1?'y':'ies'} — do not release cargo`;
    if(sumCard) sumCard.className = 'r-summary-card sc-err';
    if(vTitle) vTitle.textContent = t.verdictRejected;
    if(vDesc)  vDesc.textContent  = t.verdictRejectedDesc(finalErrors);
  } else if(finalWarnings > 0){
    if(pill) { pill.className='rv-wrap rv-warn'; }
    if(pillText) pillText.textContent = lang==='es'
      ? `${finalWarnings} observación(es) a revisar`
      : `${finalWarnings} observation${finalWarnings===1?'':'s'} to review`;
    if(sumCard) sumCard.className = 'r-summary-card sc-warn';
    if(vTitle) vTitle.textContent = t.verdictWarning;
    if(vDesc)  vDesc.textContent  = t.verdictWarningDesc(finalWarnings);
  } else {
    if(pill) { pill.className='rv-wrap rv-ok'; }
    if(pillText) pillText.textContent = lang==='es'
      ? 'Set aprobado — coherencia verificada'
      : 'Set approved — coherence verified';
    if(sumCard) sumCard.className = 'r-summary-card sc-ok';
    if(vTitle) vTitle.textContent = t.verdictApproved;
    if(vDesc)  vDesc.textContent  = t.verdictApprovedDesc;
  }

  // ── VERDICT ROW stats ──────────────────────
  const rvDot = document.getElementById('rvDot');
  const rvStats = document.getElementById('rvStats');
  if (pill) {
    if (finalErrors > 0) {
      if (rvDot) rvDot.className = 'rv-dot rvd-err';
    } else if (finalWarnings > 0) {
      if (rvDot) rvDot.className = 'rv-dot rvd-warn';
    } else {
      if (rvDot) rvDot.className = 'rv-dot rvd-ok';
    }
    pill.style.display = 'flex';
  }
  if (rvStats) {
    const errLabel = lang==='es' ? 'críticos' : 'critical';
    const docLabel = lang==='es' ? 'docs' : 'docs';
    const okLabel = lang==='es' ? 'sin problemas' : 'clean';
    const okCount = Math.max(0, analysisResults.length - finalErrors);
    rvStats.innerHTML =
      '<span class="rv-stat rvs-err"><span class="rv-stat-n">' + finalErrors + '</span> ' + errLabel + '</span>'
      + '<span class="rv-stat"><span class="rv-stat-n">' + analysisResults.length + '</span> ' + docLabel + '</span>'
      + '<span class="rv-stat rvs-ok"><span class="rv-stat-n">' + okCount + '</span> ' + okLabel + '</span>';
  }

  // AI summary — always show the card; use AI text if available, fallback otherwise
  const aiSummaryText = coherenceResult?.summary || '';
  if(sumCard && sumText){
    if(aiSummaryText){
      if(lang==='es'){
        // Show local translation immediately, then async AI translation
        sumText.textContent = translateSummaryLocal(aiSummaryText);
        sumText.style.opacity = '0.6';
        translateWithAI(aiSummaryText, 'es').then(translated => {
          sumText.textContent = translated;
          sumText.style.opacity = '1';
        }).catch(() => { sumText.style.opacity = '1'; });
      } else {
        sumText.textContent = aiSummaryText;
      }
    } else {
      // Fallback summary when AI text is unavailable (timeout, truncation, etc.)
      sumText.textContent = finalErrors > 0
        ? (lang==='es'
            ? `Se detectaron ${finalErrors} inconsistencia(s) crítica(s) en el set de documentos. Revisar los campos marcados en rojo antes de liberar la carga.`
            : `${finalErrors} critical inconsistenc${finalErrors===1?'y':'ies'} detected in this document set. Review the fields flagged in red before releasing cargo.`)
        : finalWarnings > 0
          ? (lang==='es'
              ? `El set tiene ${finalWarnings} observación(es) que deben revisarse. No se encontraron errores críticos en los campos verificados.`
              : `The set has ${finalWarnings} observation(s) to review. No critical errors were found in the verified fields.`)
          : (lang==='es'
              ? 'Todos los campos verificados son consistentes entre los documentos del set. El embarque puede proceder.'
              : 'All verified fields are consistent across the documents in this set. The shipment may proceed.');
    }
    sumCard.style.display = 'block';
  }

  // BL number strip
  const blStrip = document.getElementById('blStrip');
  const blStripNum = document.getElementById('blStripNumber');
  const blStripExtra = document.getElementById('blStripExtra');
  const blPrefix = document.getElementById('blStripPrefix');
  if(blStrip && blStripNum){
    const blVals = analysisResults
      .filter(r => r.blNumber)
      .map(r => r.blNumber.trim());
    const uniqueBLs = [...new Set(blVals)];
    const vessel = analysisResults.find(r=>r.vesselName)?.vesselName || '';
    const lot = analysisResults.find(r=>r.lotNumbers?.length)?.lotNumbers?.[0] || '';
    if(uniqueBLs.length > 0){
      blStripNum.textContent = uniqueBLs.join(' · ');
      const lotLabel = t.blLabelLot || (lang==='es' ? 'Lote' : 'Lot');
      const extras = [vessel, lot ? `${lotLabel} ${lot}` : ''].filter(Boolean);
      blStripExtra.textContent = extras.join('  ·  ');
      if(blPrefix) blPrefix.textContent = t.blLabelPrefix || 'B/L';
      // blStrip data populated for PDF report but kept hidden (resultsHeader replaces it)
    }
  }

  // Global financial panel — priority: invoice > shipping notification > letter of declaration > any
  const finPanel   = document.getElementById('finPanel');
  const finTotal   = document.getElementById('finTotal');
  const finPrice   = document.getElementById('finPrice');
  const finPriceW  = document.getElementById('finPriceWrap');
  const finTerms   = document.getElementById('finTerms');
  const finTermsW  = document.getElementById('finTermsWrap');
  const finSource  = document.getElementById('finSource');
  if(finPanel){
    const docPriority = ['invoice','commercial invoice','factura','shipping notification','letter of declaration','carta'];
    const scored = analysisResults.map(r => {
      const dt = (r.docType||'').toLowerCase();
      const pri = docPriority.findIndex(p => dt.includes(p));
      return { r, pri: pri === -1 ? 99 : pri };
    }).sort((a,b) => a.pri - b.pri);

    const src = scored.find(s => s.r.totalAmount || s.r.pricePerUnit);
    if(src){
      const r = src.r;
      if(finTotal) finTotal.textContent = r.totalAmount || '';
      if(r.pricePerUnit && finPrice && finPriceW){
        finPrice.textContent = r.pricePerUnit;
        finPriceW.style.display = 'flex';
      } else if(finPriceW) finPriceW.style.display = 'none';
      const terms = [r.incoterms, r.paymentTerms].filter(Boolean).join(' · ');
      if(terms && finTerms && finTermsW){
        finTerms.textContent = terms;
        finTermsW.style.display = 'flex';
      } else if(finTermsW) finTermsW.style.display = 'none';
      if(finSource) finSource.textContent = r._filename
        ? `${t.finLabelSource||'Source'}: ${r._filename.replace(/\.[^.]+$/,'')}`
        : '';
      // Update labels
      const finCommLabel = document.querySelector('#finPanel .fin-comm-label');
      const finPrLabel   = document.querySelector('#finPanel .fin-pr-label');
      const finTrLabel   = document.querySelector('#finPanel .fin-tr-label');
      if(finCommLabel) finCommLabel.textContent = t.finLabelCommercial || 'Commercial Value';
      if(finPrLabel)   finPrLabel.textContent   = t.finLabelPrice      || 'Price / Unit';
      if(finTrLabel)   finTrLabel.textContent   = t.finLabelTerms      || 'Terms';
      // finPanel data populated for PDF report but kept hidden (resultsHeader replaces it)
    } else {
      finPanel.style.display = 'none';
    }
  }

  // ── RESULTS HEADER — Commercial / Transport ──────────────
  const rh = document.getElementById('resultsHeader');
  if (rh) {
    // Find BL document for authoritative transport data
    const blDoc = findBLDoc(analysisResults);

    // Commercial data
    const totalAmount = analysisResults.find(r => r.totalAmount)?.totalAmount || '';
    const pricePerUnit = analysisResults.find(r => r.pricePerUnit)?.pricePerUnit || '';
    const incoterm = analysisResults.find(r => r.incoterms)?.incoterms || '';
    const paymentTerms = analysisResults.find(r => r.paymentTerms)?.paymentTerms || '';

    const rhTotal = document.getElementById('rhTotal');
    const rhPrice = document.getElementById('rhPrice');
    const rhChips = document.getElementById('rhChips');
    if (rhTotal) rhTotal.textContent = totalAmount || '—';
    if (rhPrice) rhPrice.textContent = pricePerUnit || '—';
    if (rhChips) {
      const chips = [paymentTerms, incoterm].filter(Boolean);
      rhChips.innerHTML = chips.map(c => '<span class="rh-chip">' + c + '</span>').join('');
    }

    // Transport data
    const blNum = blDoc?.blNumber || analysisResults.find(r => r.blNumber)?.blNumber || '';
    const vessel = blDoc?.vesselName || analysisResults.find(r => r.vesselName)?.vesselName || '';
    const voyage = blDoc?.voyageNumber || analysisResults.find(r => r.voyageNumber)?.voyageNumber || '';
    const portLoad = blDoc?.portOfLoading || analysisResults.find(r => r.portOfLoading)?.portOfLoading || '';
    const portDisch = blDoc?.portOfDischarge || analysisResults.find(r => r.portOfDischarge)?.portOfDischarge || '';
    const lots = [...new Set(analysisResults.flatMap(r => r.lotNumbers || []).filter(Boolean))];
    const containers = [...new Set(analysisResults.flatMap(r => r.containerNumbers || []).filter(Boolean))];

    const rhBL = document.getElementById('rhBL');
    const rhVessel = document.getElementById('rhVessel');
    const rhRoute = document.getElementById('rhRoute');
    const rhLots = document.getElementById('rhLots');

    if (rhBL) rhBL.textContent = blNum || '—';
    if (rhVessel) rhVessel.innerHTML = (vessel ? '<strong>' + vessel + '</strong>' : '') + (voyage ? ' · Voy. ' + voyage : '');
    if (rhRoute) rhRoute.innerHTML = portLoad && portDisch ? portLoad + ' → ' + portDisch : (portLoad || portDisch || '');
    if (rhLots) {
      const parts = [];
      if (lots.length) parts.push((lang==='es' ? 'Lotes: ' : 'Lots: ') + lots.join(', '));
      if (containers.length) parts.push(containers.length + ' ' + (lang==='es' ? 'contenedores' : 'containers'));
      rhLots.textContent = parts.join(' · ');
    }

    rh.style.display = (totalAmount || blNum) ? 'grid' : 'none';
  }

  const docsWithIssues = new Set([
    ...displayIssues.flatMap(i=>(i.details||[]).map(d=>d.doc)),
    ...tableEntries.filter(e=>e.isErr).flatMap(e=>(e.d.values||[]).map(v=>v.doc))
  ]);
  const okDocs = Math.max(0, analysisResults.length - docsWithIssues.size);
  const statsEl = document.getElementById('statsRow');
  if(statsEl) statsEl.innerHTML = `
    <div class="r-stat-card"><div class="r-stat-n rn-tot">${analysisResults.length}</div><div class="r-stat-l">${t.statDocs}</div></div>
    <div class="r-stat-card"><div class="r-stat-n rn-ok">${okDocs}</div><div class="r-stat-l">${t.statOk}</div></div>
    <div class="r-stat-card"><div class="r-stat-n rn-warn">${finalWarnings}</div><div class="r-stat-l">${t.statWarn}</div></div>
    <div class="r-stat-card"><div class="r-stat-n rn-err">${finalErrors}</div><div class="r-stat-l">${t.statErr}</div></div>`;

  renderMatrix();

  // ── STEP 6: Coherence badge ─────────────────────────────────
  const cb = document.getElementById('coherenceBadge');
  if(cb){
    if(finalErrors>0){ cb.className='r-badge rb-err'; cb.textContent=t.cbErr(finalErrors); }
    else if(finalWarnings>0){ cb.className='r-badge rb-warn'; cb.textContent=t.cbWarn; }
    else { cb.className='r-badge rb-ok'; cb.textContent=t.cbOk; }
  }

  // ── STEP 6b: Split Panel ─────────────────────────────────────
  // Fields where BL is master — use BL's value as "correct", not majority
  const blMasterFields = new Set(['containers','containerNumbers','seals','sealNumbers',
    'vessel','vesselName','portOfLoading','portOfDischarge','invoiceNumber']);
  // invoiceNumber now uses BL as master (BL references the correct invoice for this shipment)
  const invoiceMasterFields = new Set([]);

  renderSplitPanel(tableEntries, displayIssues, blMasterFields, invoiceMasterFields, t);

  // ── STEP 6c: Per-doc title ───────────────────────────────────
  const pdTitle = document.getElementById('perDocTitle');
  if(pdTitle) pdTitle.textContent = lang==='es'
    ? `${analysisResults.length} documentos analizados`
    : `${analysisResults.length} document${analysisResults.length===1?'':'s'} analyzed`;

  // ── STEP 6e: Action Items ────────────────────────────────────
  const aiSec  = document.getElementById('actionItemsSection');
  const aiList = document.getElementById('actionItemsList');
  const aiLabel = document.getElementById('actionItemsLabel');
  if(aiSec && aiList){
    const items = coherenceResult?.actionItems || [];
    if(items.length > 0){
      if(aiLabel) aiLabel.textContent = t.actionItemsLabel || (lang==='es' ? 'Acciones Requeridas' : 'Action Items');
      aiList.innerHTML = items.map((item, i) =>
        `<div class="r-action-item">
          <span class="r-action-num">${i+1}</span>
          <span class="r-action-text">${item}</span>
        </div>`
      ).join('');
      aiSec.style.display = 'block';
    } else {
      aiSec.style.display = 'none';
    }
  }

  // ── STEP 6d: Open table if errors ───────────────────────────
  const rTableBody = document.getElementById('rTableBody');
  const rTableChev = document.getElementById('rTableChev');
  if(rTableBody && finalErrors > 0){ rTableBody.classList.add('open'); if(rTableChev) rTableChev.classList.add('open'); }



  // ── details toggle icons ────────────────────────────────────
  document.querySelectorAll('details').forEach(det => {
    det.addEventListener('toggle', () => {
      const icon = det.querySelector('.details-toggle-icon');
      if(icon) icon.textContent = det.open ? '▼' : '▶';
    });
  });

  // ── STEP 7: Critical banner ─────────────────────────────────
  // CRITICAL_FIELDS already defined in Step 3
  const critBanner = document.getElementById('criticalBanner');
  if(critBanner){
    // All non-trivial inconsistencies are critical
    const critFromTable = tableEntries.filter(e => e.isErr);
    const critFromIssues = displayIssues.filter(i => i.type==='error');
    // Merge, dedup by field — group all container issues into ONE
    const seen = new Set();
    const allCrit = [];

    // First add from table (ground truth) — one entry per field
    critFromTable.forEach(e => {
      const fieldKey = e.k;
      if(!seen.has(fieldKey)){
        seen.add(fieldKey);
        const issueMatch = displayIssues.find(i =>
          i.field===fieldKey ||
          (fieldKey==='containers' && i.field==='containerNumbers') ||
          (fieldKey==='containerNumbers' && i.field==='containers')
        );
        allCrit.push({
          field: fieldKey,
          message: issueMatch?.message || (lang==='es'
            ? FL(fieldKey)+': valores diferentes entre documentos'
            : FL(fieldKey)+': values differ between documents'),
          details: e.d.values || []
        });
      }
    });

    // Then add from issues only if field not already in banner
    // Group container-related issues: containerNumbers, containers → same field
    const containerAliases = new Set(['containers','containerNumbers','container_numbers']);
    let containerAdded = allCrit.some(c => containerAliases.has(c.field));

    critFromIssues.forEach(i => {
      // Skip system/internal errors and document_processing
      if(i.field === 'system' || i.field === 'document_processing' || i.field === 'documentProcessing') return;
      // Skip if this is a container alias and we already have a container entry
      if(containerAliases.has(i.field) && containerAdded) return;
      if(!seen.has(i.field)){
        seen.add(i.field);
        if(containerAliases.has(i.field)) containerAdded = true;
        allCrit.push(i);
      }
    });

    if(allCrit.length > 0){
      // Shared token renderer — same logic as consistency table
      const critRenderTokens = (val, tokenFreq, totalDocs) => {
        const tokens = String(val||'').split(/,\s*|\s+/).filter(Boolean);
        if(tokens.length <= 1) return '<span style="font-weight:500;">'+val+'</span>';
        return tokens.map(tok => {
          const t = tok.trim();
          const freq = tokenFreq[t.toUpperCase()]||0;
          if(freq > totalDocs/2)
            return '<span style="display:inline-block;background:#eef5ee;color:#4a7a4a;border:1px solid #b8d8b8;padding:1px 6px;border-radius:4px;font-size:0.72rem;margin:1px;">'+t+'</span>';
          else if(freq === 1)
            return '<span style="display:inline-block;background:#ffd4cc;color:#c0392b;border:1px solid #e8a090;padding:1px 6px;border-radius:4px;font-size:0.72rem;font-weight:700;margin:1px;">⚠ '+t+'</span>';
          else
            return '<span style="display:inline-block;background:#fff3cc;color:#8a6a00;border:1px solid #e0c060;padding:1px 6px;border-radius:4px;font-size:0.72rem;margin:1px;">'+t+'</span>';
        }).join(' ');
      };

      const rows = allCrit.map(iss => {
        const details = iss.details || [];
        let detailsHtml = '';
        if(details.length > 0){
          // Build token frequency from all doc values
          const tFreq = {};
          details.forEach(d => {
            new Set(String(d.value||'').split(/[,\s]+/).filter(Boolean).map(x=>x.toUpperCase()))
              .forEach(tok => { tFreq[tok] = (tFreq[tok]||0)+1; });
          });
          const tTotal = details.length;
          // Determine master value — BL for transport, Invoice for invoice number
          let majVal;
          if (blMasterFields.has(iss.field)) {
            const blD = details.find(d => { const doc=(d.doc||'').toLowerCase(); return doc.includes('bl ')||doc.includes('bill')||doc.includes('lading')||doc.includes('conocimiento'); });
            if (blD) majVal = (blD.value||'').trim();
          }
          if (!majVal && invoiceMasterFields.has(iss.field)) {
            const invD = details.find(d => { const doc=(d.doc||'').toLowerCase(); return doc.includes('fact')||doc.includes('invoice')||doc.includes('factura'); });
            if (invD) majVal = (invD.value||'').trim();
          }
          if (!majVal) {
            const valCounts = {};
            details.forEach(d => { const v=(d.value||'').trim(); valCounts[v]=(valCounts[v]||0)+1; });
            majVal = Object.entries(valCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
          }

          detailsHtml = '<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">'
            + details.map(d => {
                const isOutlier = (d.value||'').trim() !== majVal;
                const bg = isOutlier ? '#fff8f7' : '#f8fdf8';
                const border = isOutlier ? '#c0392b' : '#6aaa6a';
                const icon = isOutlier ? '✗' : '✓';
                const iconColor = isOutlier ? '#c0392b' : '#6aaa6a';
                return '<div style="background:'+bg+';border-left:3px solid '+border+';padding:6px 10px;border-radius:0 4px 4px 0;">'
                  +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
                  +'<span style="color:'+iconColor+';font-weight:700;">'+icon+'</span>'
                  +'<span style="font-size:0.65rem;color:#888;">'+d.doc.replace(/\.[^.]+$/,'')+'</span>'
                  +'</div>'
                  +'<div style="line-height:1.8;">'+critRenderTokens(d.value, tFreq, tTotal)+'</div>'
                  +'</div>';
              }).join('')
            +'</div>';
        }
        return '<div class="critical-item">'
          +'<span class="critical-field">'+FL(iss.field)+'</span>'
          +'<div class="critical-item-body">'
            +'<span class="critical-msg">'+(iss.message||'')+'</span>'
            +detailsHtml
          +'</div>'
          +'</div>';
      }).join('');
      critBanner.innerHTML = '<div class="critical-banner-title">'
        +(lang==='es'?'Inconsistencias Críticas':'Critical Inconsistencies')
        +' ('+allCrit.length+')</div>'+rows;
      critBanner.style.display = 'block';
    } else {
      critBanner.style.display = 'none';
    }
  }

  // ── STEP 8: Multi-doc notice ────────────────────────────────
  const mdNotice = document.getElementById('multiDocNotice');
  if(mdNotice){
    const docTypes2 = {};
    analysisResults.forEach(r => {
      const dt = (r.docType||'Unknown').toLowerCase().trim();
      if(!docTypes2[dt]) docTypes2[dt] = [];
      docTypes2[dt].push(r);
    });
    const multiGroups = Object.entries(docTypes2).filter(([,d]) => d.length > 1);
    if(multiGroups.length > 0){
      const rows = multiGroups.map(([type, docs]) => {
        const totalBags = docs.reduce((s,r) => s + (parseFloat(r.bagCount)||0), 0);
        const totalNet  = docs.reduce((s,r) => s + (parseFloat(r.netWeight)||0), 0);
        const unit = docs.find(r=>r.netWeightUnit)?.netWeightUnit || '';
        return '<div class="mdoc-row">'
          +'<span class="mdoc-type">'+(docs[0].docType||type)+'</span>'
          +'<span>'+docs.length+' '+(lang==='es'?'documentos':'documents')+'</span>'
          +(totalBags?'<span class="mdoc-sum">Σ '+totalBags+' '+(lang==='es'?'sacos':'bags')+'</span>':'')
          +(totalNet?'<span class="mdoc-sum">Σ '+totalNet+' '+unit+'</span>':'')
          +'</div>';
      }).join('');
      mdNotice.innerHTML = '<strong>📋 '+(lang==='es'
        ?'Documentos múltiples detectados — totales sumados automáticamente para validación:'
        :'Multiple documents detected — totals summed automatically for validation:')
        +'</strong><br><br>'+rows;
      // Multi-doc notice hidden — info integrated into AI summary
      mdNotice.style.display = 'none';
    }
  }

  // ── STEP 9: Render consistency table ────────────────────────
  const tbody=document.getElementById('ctbody');
  tbody.innerHTML='';

  const errEntries  = tableEntries.filter(e => e.isErr && e.k !== 'system');
  const okEntries   = tableEntries.filter(e => e.allSame);
  const warnEntries = tableEntries.filter(e => !e.isErr && !e.allSame);
  const cleanDoc    = s => s.replace(/\.[^.]+$/, '').replace(/_page(\d+)/, ' p.$1');

  const statusOkTxt   = lang==='es' ? 'Consistente' : 'Consistent';
  const statusErrTxt  = lang==='es' ? 'Inconsistente' : 'Inconsistent';
  const statusWarnTxt = lang==='es' ? 'Observación' : 'Observation';
  const statusSingTxt = lang==='es' ? 'Un documento' : 'Single source';

  // ERROR rows
  errEntries.forEach(({k, d, uv}) => {
    const vals = d.values || [];
    let majVal;
    if (blMasterFields.has(k)) {
      const blV = vals.find(v => { const doc=(v.doc||'').toLowerCase(); return doc.includes('bl ')||doc.includes('bill')||doc.includes('lading')||doc.includes('conocimiento'); });
      if (blV) majVal = (blV.value||'').trim();
    }
    if (!majVal && invoiceMasterFields.has(k)) {
      const invV = vals.find(v => { const doc=(v.doc||'').toLowerCase(); return doc.includes('fact')||doc.includes('invoice')||doc.includes('factura'); });
      if (invV) majVal = (invV.value||'').trim();
    }
    if (!majVal) {
      const valCounts = {};
      vals.forEach(v => { const vv=(v.value||'').trim(); valCounts[vv]=(valCounts[vv]||0)+1; });
      majVal = Object.entries(valCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
    }
    const valHtml = vals.map(v => {
      const isOut = (v.value||'').trim() !== majVal;
      let disp = v.value||'—';
      if(isOut && majVal && disp.length===majVal.length && disp.length<=20){
        let hl='';
        for(let i=0;i<disp.length;i++){
          hl += disp[i]!==majVal[i] ? `<span class="char-diff">${disp[i]}</span>` : disp[i];
        }
        disp = hl;
      }
      return `<div class="r-diff-row ${isOut?'rdr-err':'rdr-ok'}" style="margin-bottom:3px;">
        <span class="r-diff-doc">${cleanDoc(v.doc||'')}</span>
        <span class="r-diff-val">${disp}</span>
        <span class="r-diff-icon">${isOut?'✗':'✓'}</span>
      </div>`;
    }).join('');
    tbody.innerHTML += `<tr class="rt-err">
      <td><span class="r-dot d-err"></span>${FL(k)}</td>
      <td><span style="font-size:0.7rem;color:var(--red);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${statusErrTxt}</span></td>
      <td colspan="2"><div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">${valHtml}</div></td>
    </tr>`;
  });

  // WARN rows
  warnEntries.forEach(({k, d, uv}) => {
    const vals = d.values || [];
    const valHtml = vals.map(v =>
      `<span style="font-size:0.72rem;color:var(--text-light);">${cleanDoc(v.doc)}:</span> <code style="background:var(--cream);padding:1px 5px;border-radius:2px;font-size:0.74rem;">${v.value||'—'}</code>`
    ).join('  ');
    tbody.innerHTML += `<tr class="rt-warn">
      <td><span class="r-dot d-warn"></span>${FL(k)}</td>
      <td><span style="font-size:0.7rem;color:var(--brown-mid);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${statusWarnTxt}</span></td>
      <td colspan="2">${valHtml}</td>
    </tr>`;
  });

  // OK rows
  okEntries.forEach(({k, uv, d}) => {
    const isSingle = d?.status === 'single_source';
    const dotCls = isSingle ? 'd-neu' : 'd-ok';
    const stLbl  = isSingle ? statusSingTxt : statusOkTxt;
    const stColor = isSingle ? 'var(--text-light)' : 'var(--green)';
    tbody.innerHTML += `<tr class="rt-ok">
      <td style="color:var(--text-light)"><span class="r-dot ${dotCls}"></span>${FL(k)}</td>
      <td><span style="font-size:0.7rem;color:${stColor};font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${stLbl}</span></td>
      <td style="color:var(--text-light);font-size:0.78rem;" colspan="2">${uv.join(' / ')}</td>
    </tr>`;
  });

  // Update thead to match 4-col structure
  const thead = document.querySelector('#rTableBody .r-ctable thead tr');
  if(thead) thead.innerHTML = `
    <th style="width:22%">${t.th1}</th>
    <th style="width:18%">${t.th2}</th>
    <th colspan="2">${t.th3}</th>`;


  // ── STEP 10: Inconsistency cards — removed, replaced by alerts section ─

  // ── STEP 11: Per document cards ─────────────────────────────
  const dc=document.getElementById('docCards');
  if(!dc){ console.error('docCards not found'); return; }
  dc.innerHTML='';

  analysisResults.forEach((r, cardIdx)=>{
    const ds=perDoc[r._filename]||{};
    const s=ds.status||'warning';
    const sc=s==='approved'?'ok':s==='warning'?'warn':'err';
    const lbl=s==='approved'?t.statusOk:s==='warning'?t.statusWarn:t.statusErr;
    const ftag=isExcel(r._filename)
      ?'<span class="file-badge badge-excel">Excel</span>'
      :isWord(r._filename)
      ?'<span class="file-badge badge-word">Word</span>':'';

    // Build set of inconsistent fields for this doc from tableEntries
    const inconsFields = new Set();
    const warnFields = new Set();
    const fieldMap = {
      containers:'containerNumbers', seals:'sealNumbers', lots:'lotNumbers',
      bags:'bagCount', netWeight:'netWeight', grossWeight:'grossWeight',
      shipper:'shipper', consignee:'consigneeName', vessel:'vesselName',
      portOfLoading:'portOfLoading', portOfDischarge:'portOfDischarge',
      blNumber:'blNumber', invoiceNumber:'invoiceNumber'
    };
    tableEntries.filter(e=>e.isErr).forEach(e=>{
      const hasThisDoc = (e.d.values||[]).some(v =>
        v.doc === r._filename || v.doc === r._filename.replace(/\.[^.]+$/,'')
      );
      if(hasThisDoc) inconsFields.add(fieldMap[e.k]||e.k);
    });
    (smartResult?.coherenceIssues||[]).forEach(iss => {
      const hasThisDoc = (iss.details||[]).some(d =>
        d.doc === r._filename || d.doc === r._filename.replace(/\.[^.]+$/,'')
      );
      if(hasThisDoc){
        if(iss.type==='error') inconsFields.add(fieldMap[iss.field]||iss.field);
        else warnFields.add(fieldMap[iss.field]||iss.field);
      }
    });

    const fHtml=t.DOCFIELDS.map(([l,k])=>{
      let v=r[k];
      if(Array.isArray(v)) v=v.filter(Boolean).join(', ');
      const emp=!v||v==='null'||v==='undefined'||v==='';
      const isIncons = inconsFields.has(k);
      const isWarn = !isIncons && warnFields.has(k);
      const cls = isIncons ? ' rf-err' : isWarn ? ' rf-warn' : '';
      return `<div class="r-dfield${cls}">
        <div class="r-dfield-label">${l}</div>
        <div class="r-dfield-val${emp?' dv-empty':''}">${emp?'—':v}</div>
      </div>`;
    }).join('');

    const issHtml=(ds.issues||[]).map(i=>
      `<div style="font-size:0.74rem;color:var(--text-light);padding:0.4rem 0.6rem;margin-bottom:3px;border-left:2px solid var(--tan);background:rgba(74,111,165,0.06);">⚠ ${i}</div>`
    ).join('');

    const commentHtml = ds.comment
      ? `<div class="r-dcard-comment">${ds.comment}</div>`
      : '';

    // Invoice financial panel — now shown globally, skip per-doc
    let invPanelHtml = '';

    const card = document.createElement('div');
    card.className = 'r-dcard';
    card.id = 'dc'+cardIdx;
    card.innerHTML =
      `<div class="r-dcard-head">
        <div class="r-dcard-stripe ds-${sc}"></div>
        <div class="r-dcard-info">
          <div class="r-dcard-type">${translateDocType(ds.docType||r.docType||r._filename)}</div>
          <div class="r-dcard-file">${r._filename}</div>
        </div>
        <span class="r-dcard-badge db-${sc}">${lbl}</span>
        <button class="r-dcard-view" onclick="toggleCard(${cardIdx})" id="dcv${cardIdx}">${lang==='es'?'Ver':'View'}</button>
      </div>
      <div class="r-dcard-body">
        ${invPanelHtml}
        ${commentHtml}
        <div class="r-dcard-fields">${fHtml}</div>
        ${issHtml?`<div style="margin-top:8px">${issHtml}</div>`:''}
        ${r._err?`<div style="margin-top:12px;padding:10px 14px;background:rgba(122,46,34,0.05);border:1px solid rgba(122,46,34,0.15);border-radius:8px;display:flex;align-items:center;gap:12px;">
          <span style="font-size:0.8rem;color:var(--red-light);">${lang==='es'?'Error al extraer este documento':'Failed to extract this document'}</span>
          <button data-retry="${r._filename}" onclick="retryDocument('${r._filename.replace(/'/g,"\\'")}')" style="margin-left:auto;padding:6px 16px;background:var(--navy);color:#fff;border:none;border-radius:6px;font-family:'Raleway',sans-serif;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">${lang==='es'?'Reintentar':'Retry'}</button>
        </div>`:''}
      </div>`;
    dc.appendChild(card);
  });

  // Action required panel is now replaced by alerts — keep div hidden
  const arPanel = document.getElementById('actionRequired');
  if(arPanel) arPanel.style.display = 'none';

  // ── Populate workspace left panel from inside renderResults ──
  (function(){
    var wsList = document.getElementById('wsDocList');
    var wsScore = document.getElementById('wsScoreNum');
    if (!wsList) return;
    // Score from tableEntries — weighted: critical fields count more
    var criticalFields = ['containers','seals','blNumber','destinationCountry','lots','netWeight','grossWeight'];
    var totalWeight = 0, okWeight = 0;
    tableEntries.forEach(function(e){
      var w = criticalFields.indexOf(e.k) >= 0 ? 3 : 1; // critical fields worth 3x
      totalWeight += w;
      if(e.allSame) okWeight += w;
    });
    var pct = totalWeight > 0 ? Math.round((okWeight / totalWeight) * 100) : (finalErrors === 0 ? 100 : 0);
    if(location?.hostname==='localhost') console.log('[Score]', totalWeight, okWeight, pct, tableEntries.length);
    if (wsScore) wsScore.textContent = pct + '/100';
    // Doc list from analysisResults + perDoc (already resolved above)
    wsList.innerHTML = '';
    var seen = {};
    var blShown = false;
    // Sort: BL first, then alphabetically by docType
    var sorted = analysisResults.slice().sort(function(a,b){
      var aBL = /bill of lading|conocimiento|waybill/i.test(a.docType||'');
      var bBL = /bill of lading|conocimiento|waybill/i.test(b.docType||'');
      if(aBL && !bBL) return -1;
      if(!aBL && bBL) return 1;
      return (a.docType||'').localeCompare(b.docType||'');
    });
    sorted.forEach(function(r){
      if (r._err) return;
      var fn = r._filename || '';
      var dt = r.docType || fn;
      // Dedup by filename AND by docType — prevents duplicate BL from split PDFs
      var keyFn = fn || dt;
      var keyDt = (dt||'').toLowerCase().replace(/[^a-z]/g,'').substring(0,20);
      if (seen[keyFn] || seen['dt:'+keyDt]) return;
      seen[keyFn] = true;
      if(keyDt) seen['dt:'+keyDt] = true;
      var isBL = (dt.toLowerCase().indexOf('bill of lading') >= 0 || dt.toLowerCase().indexOf('conocimiento') >= 0 || dt.toLowerCase().indexOf('waybill') >= 0);
      // Only show one BL entry
      if (isBL && blShown) return;
      if (isBL) blShown = true;
      var pds = perDoc[fn] || perDoc[dt] || {};
      if (!pds.status) { Object.keys(perDoc).forEach(function(k){ if (fn && (k.indexOf(fn)>=0 || fn.indexOf(k)>=0)) pds = perDoc[k]; }); }
      var st = pds.status || 'approved';
      var cls = 'ws-doc-item';
      var bcls = 'ws-doc-badge';
      var btxt = '✓ Match';
      var ico = '📄';
      if (isBL) { cls += ' ws-doc-master'; bcls += ' master'; btxt = 'Master'; ico = '📋'; }
      else if (st === 'rejected') { cls += ' ws-doc-err'; bcls += ' err'; btxt = '✗ Error'; ico = '🔴'; }
      else if (st === 'warning') { cls += ' ws-doc-warn'; bcls += ' warn'; btxt = '⚠ Obs'; ico = '🟡'; }
      else { bcls += ' ok'; }
      var name = (dt || fn.replace(/\.[^.]+$/, '')).substring(0, 30);
      wsList.innerHTML += '<div class="'+cls+'"><span class="ws-doc-icon">'+ico+'</span><span class="ws-doc-name">'+name+'</span><span class="'+bcls+'">'+btxt+'</span></div>';
    });
  })();

  // ── Click doc in left panel → scroll to its detail card ──
  (function(){
    var items = document.querySelectorAll('#wsDocList .ws-doc-item');
    var cards = document.querySelectorAll('#docCards .r-dcard');
    items.forEach(function(item, idx){
      item.addEventListener('click', function(){
        // Highlight active doc
        items.forEach(function(el){ el.classList.remove('ws-doc-active'); });
        item.classList.add('ws-doc-active');
        // Expand the per-doc section if collapsed
        var perdocBody = document.getElementById('rPerdocBody');
        if(perdocBody && !perdocBody.classList.contains('open')) toggleRPerdoc();
        // Find matching card — try by index first, then by name match
        var card = cards[idx] || document.getElementById('dc'+idx);
        if(card){
          var cardIdx = card.id ? parseInt(card.id.replace('dc','')) : idx;
          if(!card.classList.contains('open')) toggleCard(cardIdx);
          setTimeout(function(){ card.scrollIntoView({behavior:'smooth',block:'center'}); }, 150);
        }
      });
    });
  })();

  // ── FIX 5: Auto-expand document detail when there are errors ──
  if(finalErrors > 0){
    var perdocBody = document.getElementById('rPerdocBody');
    var perdocBtn = document.getElementById('rPerdocBtn');
    if(perdocBody && !perdocBody.classList.contains('open')){
      perdocBody.classList.add('open');
      if(perdocBtn) perdocBtn.textContent = lang==='es'?'Cerrar':'Close';
    }
  }

  // ── FIX 6: Empty states ──
  // Hide coherence table header row if table is empty
  var ctbodyEl = document.getElementById('ctbody');
  if(ctbodyEl && ctbodyEl.innerHTML.trim() === ''){
    var coherenceWrap = document.getElementById('coherenceWrap');
    if(coherenceWrap) coherenceWrap.style.display = 'none';
  }
  // Hide "Critical Inconsistencies" section if no errors
  var critBannerEl = document.getElementById('criticalBanner');
  if(critBannerEl && finalErrors === 0) critBannerEl.style.display = 'none';
  // Hide action items if empty
  var aiSecEl = document.getElementById('actionItemsSection');
  if(aiSecEl && (!displayIssues || displayIssues.length === 0)) aiSecEl.style.display = 'none';

  // Scroll to results — only if results are below current viewport
  var _scrollTarget = document.querySelector('.ws-right') || document.getElementById('results');
  if(_scrollTarget) {
    var rect = _scrollTarget.getBoundingClientRect();
    if(rect.top > window.innerHeight || rect.top < 0) {
      _scrollTarget.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }
  } catch(err) {
    console.error('renderResults ERROR:', err.message, err.stack);
    const dc = document.getElementById('docCards');
    if(dc) dc.innerHTML = '<div style="padding:2rem;color:red;font-size:0.8rem">Debug error: '+err.message+'</div>';
  }
}
function toggleCard(i){
  const card = document.getElementById('dc'+i);
  if(!card) return;
  const body = card.querySelector('.r-dcard-body');
  const btn  = document.getElementById('dcv'+i);
  const isOpen = card.classList.contains('open');
  const isES = lang === 'es';
  const t2 = TX[lang] || TX.en;
  if(isOpen){
    card.classList.remove('open');
    if(body) body.style.display = 'none';
    if(btn) btn.textContent = t2.docCardViewBtn || (isES ? 'Ver' : 'View');
  } else {
    card.classList.add('open');
    if(body){ body.style.display = 'block'; }
    if(btn) btn.textContent = t2.docCardCloseBtn || (isES ? 'Cerrar' : 'Close');
  }
}

function toggleRTable(){
  const body = document.getElementById('rTableBody');
  const chev = document.getElementById('rTableChev');
  if(!body) return;
  body.classList.toggle('open');
  if(chev) chev.classList.toggle('open');
}

function toggleRPerdoc(){
  const body = document.getElementById('rPerdocBody');
  const btn  = document.getElementById('rPerdocBtn');
  if(!body) return;
  const t2 = TX[lang] || TX.en;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open');
  if(btn) btn.textContent = isOpen
    ? (t2.perDocViewBtn  || (lang==='es' ? 'Ver'    : 'View'))
    : (t2.perDocCloseBtn || (lang==='es' ? 'Cerrar' : 'Close'));
}

// ── CONSISTENCY MATRIX RENDERING ──────────────────────────────
function renderMatrix(){
  const section = document.getElementById('matrixSection');
  const table = document.getElementById('matrixTable');
  const legend = document.getElementById('matrixLegend');
  if(!section || !table) return;

  // Find the BL document
  const blDoc = findBLDoc(analysisResults);
  if(!blDoc || analysisResults.length < 2){
    section.style.display = 'none';
    return;
  }

  // Other (non-BL, non-error) documents
  const otherDocs = analysisResults.filter(r => r !== blDoc && !r._err);
  if(otherDocs.length === 0){
    section.style.display = 'none';
    return;
  }

  const t = tx();

  // Fields to compare
  const matrixFields = [
    { key: 'shipper', label: FL('shipper') },
    { key: 'consigneeName', label: FL('consignee') },
    { key: 'lotNumbers', label: FL('lots'), isArray: true },
    { key: 'bagCount', label: FL('bags') },
    { key: 'netWeight', label: FL('netWeight') },
    { key: 'grossWeight', label: FL('grossWeight') },
    { key: 'containerNumbers', label: FL('containers'), isArray: true },
    { key: 'sealNumbers', label: FL('seals'), isArray: true },
    { key: 'vesselName', label: FL('vessel') },
    { key: 'portOfLoading', label: FL('portOfLoading') },
    { key: 'portOfDischarge', label: FL('portOfDischarge') },
    { key: 'destinationCountry', label: FL('destinationCountry') },
    { key: 'blNumber', label: FL('blNumber') },
    { key: 'invoiceNumber', label: FL('invoiceNumber') },
    { key: 'voyageNumber', label: FL('voyageNumber') },
  ];

  const getVal = (doc, key, isArray) => {
    const v = doc[key];
    if(isArray && Array.isArray(v)) return v.filter(Boolean).sort().join(', ');
    return v ? String(v).trim() : '';
  };

  const truncate = (s, n) => s.length > n ? s.slice(0, n) + '...' : s;

  // Short label for each doc
  const shortLabel = (r) => {
    const lbl = translateDocType(r.docType) || (r._filename||'').replace(/\.[^.]+$/, '');
    return truncate(lbl, 15);
  };

  // Build header
  const fieldHeader = lang === 'es' ? 'Campo' : 'Field';
  let html = '<thead><tr>';
  html += `<th>${fieldHeader}</th>`;
  html += `<th class="mx-master">${truncate('B/L (' + ((blDoc._filename||'').replace(/\.[^.]+$/, '')) + ')', 20)}</th>`;
  otherDocs.forEach(d => {
    html += `<th>${shortLabel(d)}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Filter to only fields where the BL has a value
  const activeFields = matrixFields.filter(f => {
    const blVal = getVal(blDoc, f.key, f.isArray);
    return blVal !== '';
  });

  // Build rows
  activeFields.forEach(f => {
    const blVal = getVal(blDoc, f.key, f.isArray);
    html += '<tr>';
    html += `<td>${f.label}</td>`;
    html += `<td class="mx-master-val" title="${blVal.replace(/"/g,'&quot;')}">${truncate(blVal, 20)}</td>`;
    otherDocs.forEach(d => {
      const docVal = getVal(d, f.key, f.isArray);
      if(!docVal){
        html += '<td class="mx-na">&mdash;</td>';
      } else if(isTrivialDifference(blVal, docVal)){
        html += '<td class="mx-ok">OK</td>';
      } else {
        html += '<td class="mx-diff">DIFF</td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;

  if(legend){
    legend.textContent = t.matrixLegend || (lang === 'es'
      ? 'OK = consistente con B/L | \u2014 = campo no presente | DIFF = valor diferente'
      : 'OK = consistent with B/L | \u2014 = field not present | DIFF = different value');
  }

  section.style.display = activeFields.length > 0 ? '' : 'none';
}

// ── SPLIT PANEL RENDERING ─────────────────────────────────────
let _spFields = []; // global array of split-panel field objects

function renderSplitPanel(tableEntries, displayIssues, blMasterFields, invoiceMasterFields, t) {
  const spPanel = document.getElementById('splitPanel');
  const spLeft  = document.getElementById('spLeft');
  if (!spPanel || !spLeft) return;

  // Build field array from all tableEntries
  _spFields = [];

  const computeMajVal = (vals, fieldKey) => {
    let majVal;
    // BL is master for transport fields
    if (blMasterFields.has(fieldKey)) {
      const blVal = vals.find(v => {
        const doc = (v.doc||'').toLowerCase();
        return doc.includes('bl ') || doc.includes('bill') || doc.includes('lading')
            || doc.includes('conocimiento') || doc.includes('waybill');
      });
      majVal = blVal ? (blVal.value||'').trim() : '';
    }
    // Commercial Invoice is master for invoice number
    if (!majVal && invoiceMasterFields.has(fieldKey)) {
      const invVal = vals.find(v => {
        const doc = (v.doc||'').toLowerCase();
        return doc.includes('fact') || doc.includes('invoice') || doc.includes('factura');
      });
      majVal = invVal ? (invVal.value||'').trim() : '';
    }
    if (!majVal) {
      const valCounts = {};
      vals.forEach(v => { const vv=(v.value||'').trim(); valCounts[vv]=(valCounts[vv]||0)+1; });
      const sorted = Object.entries(valCounts).sort((a,b)=>b[1]-a[1]);
      majVal = sorted[0]?.[0] || '';
    }
    return majVal;
  };

  // Error fields
  tableEntries.filter(e => e.isErr).forEach(e => {
    const vals = e.d.values || [];
    const fieldAlias = [['containers','containerNumbers'],['seals','sealNumbers'],['vessel','vesselName'],['portOfLoading','port_of_loading'],['portOfDischarge','port_of_discharge']];
    const issueMatch = displayIssues.find(i => i.field === e.k ||
      fieldAlias.some(([a,b]) => (e.k===a && i.field===b) || (e.k===b && i.field===a)));
    _spFields.push({
      key: e.k,
      label: FL(e.k),
      severity: 'err',
      values: vals,
      message: issueMatch?.message || (lang==='es' ? 'Valores distintos encontrados entre documentos' : 'Different values found across documents'),
      majVal: computeMajVal(vals, e.k)
    });
  });

  // Warning fields
  displayIssues.filter(i => i.type==='warning').forEach(iss => {
    const fieldLabel = (t.FL && t.FL[iss.field]) || iss.field || '';
    if (!fieldLabel) return;
    // Avoid duplicates if already added as error
    if (_spFields.some(f => f.key === iss.field)) return;
    _spFields.push({
      key: iss.field,
      label: fieldLabel,
      severity: 'warn',
      values: iss.details || [],
      message: iss.message || '',
      majVal: ''
    });
  });

  // OK fields
  tableEntries.filter(e => e.allSame).forEach(e => {
    if (_spFields.some(f => f.key === e.k)) return;
    _spFields.push({
      key: e.k,
      label: FL(e.k),
      severity: 'ok',
      values: e.d.values || [],
      message: '',
      majVal: (e.uv && e.uv.length > 0) ? e.uv.join(' / ') : ''
    });
  });

  // Build left panel HTML — priority fields first (BL, containers, invoice)
  const priorityKeys = ['containers','containerNumbers','blNumber','invoiceNumber','seals','sealNumbers'];
  const sortByPriority = (a, b) => {
    const pa = priorityKeys.indexOf(a.key), pb = priorityKeys.indexOf(b.key);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  };
  const errFields  = _spFields.filter(f => f.severity === 'err').sort(sortByPriority);
  const warnFields = _spFields.filter(f => f.severity === 'warn').sort(sortByPriority);
  const okFields   = _spFields.filter(f => f.severity === 'ok');

  // Reorder _spFields to match the sorted display order (left = right)
  _spFields = [...errFields, ...warnFields, ...okFields];

  let leftHtml = '';

  if (errFields.length > 0) {
    leftHtml += '<div class="sp-section sp-sec-err">' + (t.spCritical || 'Critical Inconsistencies') + ' (' + errFields.length + ')</div>';
    errFields.forEach(f => {
      const idx = _spFields.indexOf(f);
      leftHtml += '<div class="sp-row sp-row-err" data-sp-idx="' + idx + '" onclick="selectField(' + idx + ')">'
        + '<span class="sp-row-dot dot-err"></span>'
        + '<span class="sp-row-name">' + f.label + '</span>'
        + '<span class="sp-row-badge sb-err">' + (t.spFixRequired || 'Fix required') + '</span>'
        + '<span class="sp-row-chev">›</span>'
        + '</div>';
    });
  }

  if (warnFields.length > 0) {
    leftHtml += '<div class="sp-section sp-sec-warn">' + (t.spObservations || 'Observations') + ' (' + warnFields.length + ')</div>';
    warnFields.forEach(f => {
      const idx = _spFields.indexOf(f);
      leftHtml += '<div class="sp-row sp-row-warn" data-sp-idx="' + idx + '" onclick="selectField(' + idx + ')">'
        + '<span class="sp-row-dot dot-warn"></span>'
        + '<span class="sp-row-name">' + f.label + '</span>'
        + '<span class="sp-row-badge sb-warn">' + (t.spVerify || 'Verify') + '</span>'
        + '<span class="sp-row-chev">›</span>'
        + '</div>';
    });
  }

  if (okFields.length > 0) {
    leftHtml += '<div class="sp-section sp-sec-ok">' + (t.spVerified || 'Verified Fields') + ' (' + okFields.length + ')</div>';
    okFields.forEach(f => {
      const idx = _spFields.indexOf(f);
      leftHtml += '<div class="sp-row sp-row-ok" data-sp-idx="' + idx + '" onclick="selectField(' + idx + ')">'
        + '<span class="sp-row-dot dot-ok"></span>'
        + '<span class="sp-row-name">' + f.label + '</span>'
        + '<span class="sp-row-chev">›</span>'
        + '</div>';
    });
  }

  spLeft.innerHTML = leftHtml;

  // Build ALL field details in the right panel at once (scrollable)
  const spContent = document.getElementById('spRightContent');
  const spEmpty   = document.getElementById('spRightEmpty');
  if (spContent) {
    let rightHtml = '';
    const cleanDoc = s => s.replace(/\.[^.]+$/, '').replace(/_page(\d+)/, ' p.$1');

    _spFields.forEach((field, idx) => {
      const sevCls = field.severity === 'err' ? 'sdt-err' : field.severity === 'warn' ? 'sdt-warn' : 'sdt-ok';
      const sevLabel = field.severity === 'err' ? (t.spFixRequired || 'Fix required')
        : field.severity === 'warn' ? (t.spVerify || 'Verify')
        : (t.spConsistent || 'Consistent');

      const actionBtn = field.severity !== 'ok'
        ? '<button onclick="spDismissField(' + idx + ')" style="font-size:0.58rem;font-family:\'Raleway\',sans-serif;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-light);border:1px solid var(--border);border-radius:2px;padding:2px 8px;background:none;cursor:pointer;">'
          + (t.spNotAnIssue || 'Not an issue') + '</button>'
        : '';

      rightHtml += '<div class="sp-field-block" id="spField' + idx + '" data-sp-idx="' + idx + '">';
      rightHtml += '<div class="sp-detail-header"><span class="sp-detail-field">' + field.label + '</span><span class="sp-detail-tag ' + sevCls + '">' + sevLabel + '</span>' + actionBtn + '</div>';
      rightHtml += '<div class="sp-detail-body">';

      if (field.message) {
        const msgText = lang==='es' ? translateSummaryLocal(field.message) : field.message;
        rightHtml += '<div class="sp-detail-msg">' + msgText + '</div>';
      }

      if (field.values && field.values.length > 0 && field.severity !== 'ok') {
        rightHtml += '<div class="r-diff-wrap"><div class="r-diff-label">' + (t.spValuePerDoc || 'Value per document') + '</div><div class="r-diff-rows">';
        field.values.forEach(v => {
          const isOut = field.majVal && (v.value||'').trim() !== field.majVal;
          const rc = isOut ? 'rdr-err' : (field.majVal ? 'rdr-ok' : 'rdr-neu');
          const icon = isOut ? '✗' : (field.majVal ? '✓' : '');
          let dispVal = v.value || '—';
          if (isOut && field.majVal && dispVal.length === field.majVal.length && dispVal.length <= 20) {
            let hl = '';
            for (let ci = 0; ci < dispVal.length; ci++) {
              hl += dispVal[ci] !== field.majVal[ci] ? '<span class="char-diff">' + dispVal[ci] + '</span>' : dispVal[ci];
            }
            dispVal = hl;
          }
          rightHtml += '<div class="r-diff-row ' + rc + '"><span class="r-diff-doc">' + cleanDoc(v.doc||'') + '</span><span class="r-diff-val">' + dispVal + '</span><span class="r-diff-icon">' + icon + '</span></div>';
        });
        rightHtml += '</div>';
        const isContainerField = ['containers','containerNumbers','seals','sealNumbers'].includes(field.key);
        const isBLField = blMasterFields.has(field.key);
        if (field.severity === 'err' && field.majVal) {
          const noteText = isBLField
            ? (lang==='es' ? 'El BL es el documento master. El valor correcto es <strong>' + field.majVal + '</strong>. Los dem\u00e1s documentos deben corregirse.' : 'The BL is the master document. The correct value is <strong>' + field.majVal + '</strong>. Other documents must be corrected.')
            : (lang==='es' ? 'El valor correcto (mayor\u00eda) es <strong>' + field.majVal + '</strong>.' : 'The correct value (majority) is <strong>' + field.majVal + '</strong>. Documents in red must be corrected.');
          rightHtml += '<div class="sp-detail-note">' + noteText + '</div>';
        }
        rightHtml += '</div>';
      }

      if (field.severity === 'ok' && field.majVal) {
        rightHtml += '<div class="sp-detail-value"><strong>' + (t.spConsistent || 'Consistent') + ':</strong> ' + field.majVal + '</div>';
      }

      rightHtml += '</div></div>'; // close body + block
    });

    spContent.innerHTML = rightHtml;
    if (spEmpty) spEmpty.style.display = 'none';
    spContent.style.display = 'block';

    // Async translate AI messages to current language
    if (lang === 'es') {
      spContent.querySelectorAll('.sp-detail-msg').forEach(el => {
        const original = el.textContent;
        if (!original || /[áéíóúñ¿¡]/.test(original)) return; // already Spanish
        el.style.opacity = '0.6';
        translateWithAI(original, 'es').then(tr => {
          el.textContent = tr;
          el.style.opacity = '1';
        }).catch(() => { el.style.opacity = '1'; });
      });
    }
  }

  // Show/hide panel
  if (_spFields.length > 0) {
    spPanel.style.display = 'grid';
    // Auto-highlight first error in left panel
    const firstIdx = errFields.length > 0 ? _spFields.indexOf(errFields[0])
      : warnFields.length > 0 ? _spFields.indexOf(warnFields[0]) : 0;
    selectField(firstIdx);
  } else {
    spPanel.style.display = 'none';
  }
}

// selectField: highlight left row and scroll right panel to the matching field block
function selectField(idx) {
  if (idx < 0 || idx >= _spFields.length) return;
  _spSelectingFromClick = true;

  // Update left panel highlighting
  document.querySelectorAll('#spLeft .sp-row').forEach(row => row.classList.remove('active'));
  const targetRow = document.querySelector('#spLeft .sp-row[data-sp-idx="' + idx + '"]');
  if (targetRow) {
    targetRow.classList.add('active');
    targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Scroll WITHIN the right panel only (not the page)
  const spRight = document.getElementById('spRight');
  const fieldBlock = document.getElementById('spField' + idx);
  if (spRight && fieldBlock) {
    spRight.scrollTo({ top: fieldBlock.offsetTop - spRight.offsetTop, behavior: 'smooth' });
  }
  setTimeout(() => { _spSelectingFromClick = false; }, 500);
}

// Scroll sync: right panel scroll → highlight matching left row
let _spSelectingFromClick = false;
function initScrollSync() {
  // Defer until DOM is ready
  const attach = () => {
    const spRight = document.getElementById('spRight');
    if (!spRight) return;
    spRight.addEventListener('scroll', () => {
      if (_spSelectingFromClick) return; // don't fight with click scroll
      const blocks = spRight.querySelectorAll('.sp-field-block');
      let closest = null, closestDist = Infinity;
      const top = spRight.scrollTop + 20; // small offset
      blocks.forEach(b => {
        const dist = Math.abs(b.offsetTop - spRight.offsetTop - top);
        if (dist < closestDist) { closestDist = dist; closest = b; }
      });
      if (closest) {
        const idx = parseInt(closest.dataset.spIdx);
        if (!isNaN(idx)) {
          document.querySelectorAll('#spLeft .sp-row').forEach(r => r.classList.remove('active'));
          const row = document.querySelector('#spLeft .sp-row[data-sp-idx="' + idx + '"]');
          if (row) {
            row.classList.add('active');
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    }, { passive: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else setTimeout(attach, 200);
}

function spDismissField(idx) {
  if (idx < 0 || idx >= _spFields.length) return;
  // Fade left row
  const row = document.querySelector('#spLeft .sp-row[data-sp-idx="' + idx + '"]');
  if (row) row.classList.add('dismissed');
  // Fade right field block
  const block = document.getElementById('spField' + idx);
  if (block) block.style.opacity = '0.35';
  // Recalculate verdict
  recalcVerdict();
}

// ── DISMISS ALERT (legacy compat + split panel) ──────────────
function dismissAlert(btn) {
  // Legacy alert dismiss — also works with split panel via spDismissField
  const alertEl = btn.closest('.r-alert');
  if (!alertEl) return;
  alertEl.classList.add('dismissed');
  alertEl.classList.remove('open');
  const lbl = lang==='es' ? '✓ Descartado' : '✓ Dismissed';
  btn.outerHTML = '<span class="r-alert-dismissed-label">' + lbl + '</span>';
  recalcVerdict();
}

function recalcVerdict() {
  const t = tx();

  // Count active (non-dismissed) errors and warnings from split panel
  const activeErrors   = document.querySelectorAll('#spLeft .sp-row.sp-row-err:not(.dismissed)').length;
  const activeWarnings = document.querySelectorAll('#spLeft .sp-row.sp-row-warn:not(.dismissed)').length;

  // Update verdict row
  const pill = document.getElementById('statusPill');
  const pillText = document.getElementById('statusPillText');
  const rvDot = document.getElementById('rvDot');
  if (activeErrors > 0) {
    if (pill) pill.className = 'rv-wrap rv-err';
    if (rvDot) rvDot.className = 'rv-dot rvd-err';
    if (pillText) pillText.textContent = lang==='es'
      ? activeErrors + ' inconsistencia(s) cr\u00edtica(s) \u2014 no liberar la carga'
      : activeErrors + ' critical inconsistenc' + (activeErrors===1?'y':'ies') + ' \u2014 do not release cargo';
  } else if (activeWarnings > 0) {
    if (pill) pill.className = 'rv-wrap rv-warn';
    if (rvDot) rvDot.className = 'rv-dot rvd-warn';
    if (pillText) pillText.textContent = lang==='es'
      ? activeWarnings + ' observaci\u00f3n(es) a revisar'
      : activeWarnings + ' observation' + (activeWarnings===1?'':'s') + ' to review';
  } else {
    if (pill) pill.className = 'rv-wrap rv-ok';
    if (rvDot) rvDot.className = 'rv-dot rvd-ok';
    if (pillText) pillText.textContent = lang==='es'
      ? 'Set aprobado \u2014 coherencia verificada'
      : 'Set approved \u2014 coherence verified';
  }

  // Update summary card
  const sumCard = document.getElementById('summaryCard');
  if (sumCard) {
    sumCard.className = activeErrors > 0 ? 'r-summary-card sc-err'
      : activeWarnings > 0 ? 'r-summary-card sc-warn' : 'r-summary-card sc-ok';
  }

  // Update stats row error/warning counts
  const statsEl = document.getElementById('statsRow');
  if (statsEl) {
    const statCards = statsEl.querySelectorAll('.r-stat-card');
    if (statCards[2]) statCards[2].querySelector('.r-stat-n').textContent = activeWarnings;
    if (statCards[3]) statCards[3].querySelector('.r-stat-n').textContent = activeErrors;
  }

  // Hide critical banner if no active errors
  const critBanner = document.getElementById('criticalBanner');
  if (critBanner && activeErrors === 0) critBanner.style.display = 'none';
}

// Initialize scroll sync
initScrollSync();

// ── Document Stack for workspace left panel ──
function renderDocumentStack(results, coherenceResult) {
  var list = document.getElementById('wsDocList');
  var scoreEl = document.getElementById('wsScoreNum');
  if (!list) return;

  // Calculate score
  var totalFields = 0, okFields = 0;
  if (coherenceResult && coherenceResult.setValues) {
    Object.values(coherenceResult.setValues).forEach(function(sv) {
      totalFields++;
      if (sv.status === 'consistent') okFields++;
    });
  }
  var score = totalFields > 0 ? Math.round((okFields / totalFields) * 100) : 0;
  // Fallback: if no setValues but overall status is approved, score is 100
  if (score === 0 && coherenceResult && coherenceResult.overallStatus === 'approved') score = 100;
  if (score === 0 && coherenceResult && coherenceResult.overallStatus === 'warning') score = 75;
  if (scoreEl) scoreEl.textContent = score + '/100';

  // Build doc list from coherenceResult.perDocumentStatus or analysisResults
  list.innerHTML = '';
  var perDoc = coherenceResult && coherenceResult.perDocumentStatus ? coherenceResult.perDocumentStatus : {};
  var allResults = Array.isArray(results) ? results : [];

  // Flatten results if they are nested by filename
  var flatResults = [];
  if (typeof results === 'object' && !Array.isArray(results)) {
    Object.entries(results).forEach(function(entry) {
      var fn = entry[0];
      var arr = entry[1];
      (Array.isArray(arr) ? arr : [arr]).forEach(function(d) {
        d._filename = d._filename || fn;
        flatResults.push(d);
      });
    });
  } else {
    flatResults = allResults;
  }

  // Deduplicate by filename — show each file once
  var seenFiles = {};
  flatResults.forEach(function(doc) {
    if (doc._err) return;
    var fn = doc._filename || '';
    var dt = doc.docType || fn;
    // Skip duplicates (multi-doc PDFs produce multiple entries per file)
    var key = fn || dt;
    if (seenFiles[key]) return;
    seenFiles[key] = true;

    var isBL = dt.toLowerCase().indexOf('bill of lading') >= 0 || dt.toLowerCase().indexOf('conocimiento') >= 0 || dt.toLowerCase().indexOf('waybill') >= 0;

    // Check per-doc status — try multiple key formats
    var pds = perDoc[fn] || perDoc[dt] || {};
    // Also try matching by partial filename
    if (!pds.status) {
      Object.keys(perDoc).forEach(function(k) {
        if (fn && (k.indexOf(fn) >= 0 || fn.indexOf(k) >= 0)) pds = perDoc[k];
      });
    }
    var status = pds.status || 'approved';
    var hasErr = status === 'rejected';
    var hasWarn = status === 'warning';

    var cls = 'ws-doc-item';
    var badgeCls = 'ws-doc-badge';
    var badgeText = '✓ Match';

    if (isBL) {
      cls += ' ws-doc-master';
      badgeCls += ' master';
      badgeText = 'Master';
    } else if (hasErr) {
      cls += ' ws-doc-err';
      badgeCls += ' err';
      badgeText = '✗ Error';
    } else if (hasWarn) {
      cls += ' ws-doc-warn';
      badgeCls += ' warn';
      badgeText = '⚠ Obs';
    } else {
      badgeCls += ' ok';
    }

    var icon = isBL ? '📋' : hasErr ? '🔴' : hasWarn ? '🟡' : '📄';
    // Prefer short doc type name, fallback to filename without extension
    var shortName = dt || fn.replace(/\.[^.]+$/, '');
    var displayName = shortName.length > 30 ? shortName.substring(0, 30) + '…' : shortName;

    list.innerHTML += '<div class="' + cls + '">'
      + '<span class="ws-doc-icon">' + icon + '</span>'
      + '<span class="ws-doc-name">' + displayName + '</span>'
      + '<span class="' + badgeCls + '">' + badgeText + '</span>'
      + '</div>';
  });
}

// ── Inconsistency Cards v2 ──
function renderInconsistencyCardsV2(inconsistencies, containerId) {
  var container = document.getElementById(containerId);
  if (!container || !inconsistencies || !inconsistencies.length) return;

  container.innerHTML = '';

  inconsistencies.forEach(function(inc) {
    var isCritical = inc.type === 'error';
    var cls = isCritical ? 'err' : 'warn';
    var fieldLabel = inc.field || 'Field';

    var docsHtml = '';
    if (inc.details && Array.isArray(inc.details)) {
      inc.details.forEach(function(d) {
        var isMaster = (d.doc || '').toLowerCase().indexOf('bl') >= 0 || (d.doc || '').toLowerCase().indexOf('lading') >= 0;
        var isDiff = isCritical && !isMaster;
        docsHtml += '<div class="icard-v2-doc">'
          + '<div class="icard-v2-doc-name">' + (d.doc || '').replace(/\.[^.]+$/, '') + '</div>'
          + '<div class="icard-v2-doc-val ' + (isMaster ? 'is-master' : isDiff ? 'is-diff' : '') + '">'
          + (d.value || '— not found')
          + '</div></div>';
      });
    }

    container.innerHTML += '<div class="icard-v2 ' + cls + '">'
      + '<div class="icard-v2-header">'
      + '<span class="icard-v2-field">' + fieldLabel + '</span>'
      + (isCritical
        ? '<span style="font-size:.65rem;color:var(--red-light);margin-left:auto;">Critical</span>'
        : '<span style="font-size:.65rem;color:var(--steel);margin-left:auto;">Observation</span>')
      + '</div>'
      + '<div class="icard-v2-body">' + docsHtml + '</div>'
      + '</div>';
  });
}
