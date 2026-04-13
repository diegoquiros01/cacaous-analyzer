// js/pdf.js — PDF and TXT report generation
// Depends on globals: coherenceResult, analysisResults, lang, tx(), lastFinalErrors, lastFinalWarnings, _spFields, _html2pdfLoaded
// Depends on: coherence.js (FL, translateDocType, isTrivialDifference), extraction.js (isExcel, isWord), app.js (setStep)

let _html2pdfLoaded = false;
function loadHtml2Pdf() {
  if (_html2pdfLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload = () => { _html2pdfLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load html2pdf'));
    document.head.appendChild(s);
  });
}

async function downloadPdfReport() {
  try {
    setStep(4);
    await loadHtml2Pdf();

    // Clone the ws-right panel (the actual rendered results) for PDF
    var wsRight = document.querySelector('.ws-right');
    if (!wsRight) { alert('No results to export'); return; }

    // Create a clean container for PDF rendering
    var container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '190mm';
    container.style.background = '#fff';

    // Build PDF content: header + cloned results
    var blNum = (analysisResults.find(function(r){return r.blNumber})||{}).blNumber || '';
    var vessel = (analysisResults.find(function(r){return r.vesselName})||{}).vesselName || '';
    var voyage = (analysisResults.find(function(r){return r.voyageNumber})||{}).voyageNumber || '';
    var date = new Date().toLocaleString(lang==='es'?'es-ES':'en-US');

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'font-family:Helvetica,Arial,sans-serif;padding:0 0 8px;border-bottom:2px solid #0d1b2a;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end;';
    header.innerHTML = '<div style="font-size:16px;font-weight:700;letter-spacing:0.1em;color:#0d1b2a;">DOCSVALIDATE</div>'
      + '<div style="text-align:right;font-size:9px;color:#7a8499;line-height:1.5;">'
      + date + (blNum ? '<br><b style="color:#0d1b2a;">B/L: '+blNum+'</b>' : '')
      + (vessel ? '<br>'+vessel+(voyage?' · Voy. '+voyage:'') : '')
      + '</div>';
    container.appendChild(header);

    // Clone the results content
    var clone = wsRight.cloneNode(true);

    // Remove interactive elements from clone (buttons, click handlers)
    clone.querySelectorAll('button, .r-dcard-view, [onclick]').forEach(function(el){
      if (el.tagName === 'BUTTON' && (el.textContent||'').match(/View|Close|Ver|Cerrar|Fix|Not an|Verify|Dismiss/i)) {
        el.remove();
      }
    });

    // Expand all collapsed sections for PDF
    clone.querySelectorAll('.r-perdoc-body').forEach(function(el){ el.classList.add('open'); el.style.display='block'; });
    clone.querySelectorAll('.r-dcard-body').forEach(function(el){ el.style.display='block'; });
    clone.querySelectorAll('.r-dcard').forEach(function(el){ el.classList.add('open'); });

    // Remove the "03 Analysis Results" section label (redundant in PDF)
    var secLabel = clone.querySelector('.section-label');
    if (secLabel) secLabel.remove();

    // Fix sticky elements for print
    clone.querySelectorAll('[style*="sticky"]').forEach(function(el){ el.style.position='static'; });

    // Make matrix table non-sticky for PDF
    clone.querySelectorAll('.mx-table td, .mx-table th').forEach(function(el){ el.style.position='static'; });
    var mxWrap = clone.querySelector('.mx-scroll-wrap');
    if (mxWrap) mxWrap.style.overflow = 'visible';

    // Set font family on clone
    clone.style.fontFamily = 'Helvetica, Arial, sans-serif';
    clone.style.fontSize = '10px';
    clone.style.padding = '0';
    clone.style.maxWidth = '190mm';

    container.appendChild(clone);

    // Footer
    var footer = document.createElement('div');
    footer.style.cssText = 'border-top:1px solid #d0d6e2;padding-top:8px;margin-top:16px;font-size:7px;color:#7a8499;text-align:center;letter-spacing:0.08em;font-family:Helvetica,Arial,sans-serif;';
    footer.textContent = 'Validated by DocsValidate · ' + (tx().rptSubtitle || 'AI-Powered Export Validation') + ' · ' + date;
    container.appendChild(footer);

    document.body.appendChild(container);

    var filename = 'docsvalidate-report-' + (blNum || Date.now()) + '.pdf';
    await html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container).save();

    document.body.removeChild(container);
  } catch(e) {
    console.error('PDF generation error:', e);
    alert('PDF error: ' + e.message);
  }
}

function downloadReport(){
  try{
    setStep(4);
    const t=tx();
    const date=new Date().toLocaleString(lang==='es'?'es-ES':'en-US');
    const issues=coherenceResult?.coherenceIssues||[];
    const perDoc=coherenceResult?.perDocumentStatus||{};
    const fl=t.FL;

    let txt=`${t.rptTitle}\n${t.rptSubtitle}\n${t.rptDate}: ${date}\n${'═'.repeat(64)}\n\n`;
    txt+=`${t.rptStatus.padEnd(20)}: ${(coherenceResult?.overallStatus||'N/A').toUpperCase()}\n`;
    txt+=`${t.rptDocs.padEnd(20)}: ${analysisResults.length}\n`;
    txt+=`${t.rptIncons.padEnd(20)}: ${issues.filter(i=>i.type==='error').length}\n`;
    txt+=`${t.rptObs.padEnd(20)}: ${issues.filter(i=>i.type==='warning').length}\n`;
    txt+=`\n${coherenceResult?.summary||''}\n`;

    txt+=`\n${'═'.repeat(64)}\n${t.rptCoherence}\n${'═'.repeat(64)}\n`;
    for(const[k,d] of Object.entries(coherenceResult?.setValues||{})){
      if(!d?.values?.length) continue;
      txt+=`\n${(fl[k]||k).padEnd(22)}: [${d.status}]\n`;
      d.values.forEach(v=>{txt+=`  · ${v.doc}: ${v.value||'—'}\n`;});
    }
    if(issues.length){
      txt+=`\n${'═'.repeat(64)}\n${t.rptDetailIss}\n${'═'.repeat(64)}\n`;
      issues.forEach((iss,i)=>{
        txt+=`\n[${i+1}] ${iss.type.toUpperCase()} — ${fl[iss.field]||iss.field}\n${iss.message}\n`;
        (iss.details||[]).forEach(d=>{txt+=`  · ${d.doc}: "${d.value||t.rptNotFound}"\n`;});
      });
    }
    txt+=`\n${'═'.repeat(64)}\n${t.rptDetail}\n${'═'.repeat(64)}\n`;
    analysisResults.forEach((r,i)=>{
      const ds=perDoc[r._filename]||{};
      txt+=`\n[${i+1}] ${ds.docType||r.docType||r._filename}${isExcel(r._filename)?' [Excel]':isWord(r._filename)?' [Word]':''}\n`;
      txt+=`${t.rptFile.padEnd(16)}: ${r._filename}\n`;
      txt+=`${t.rptStatus.padEnd(16)}: ${(ds.status||'N/A').toUpperCase()}\n`;
      txt+=`${t.rptShipper.padEnd(16)}: ${r.shipper||'N/A'}\n`;
      txt+=`${t.rptConsignee.padEnd(16)}: ${r.consigneeName||'N/A'}\n`;
      txt+=`${t.rptContainers.padEnd(16)}: ${(r.containerNumbers||[]).join(', ')||'N/A'}\n`;
      txt+=`${t.rptSeals.padEnd(16)}: ${(r.sealNumbers||[]).join(', ')||'N/A'}\n`;
      txt+=`${t.rptLots.padEnd(16)}: ${(r.lotNumbers||[]).join(', ')||'N/A'}\n`;
      txt+=`${t.rptBags.padEnd(16)}: ${r.bagCount||'N/A'} ${r.bagUnit||''}\n`;
      txt+=`${t.rptNet.padEnd(16)}: ${r.netWeight||'N/A'} ${r.netWeightUnit||''}\n`;
      txt+=`${t.rptGross.padEnd(16)}: ${r.grossWeight||'N/A'} ${r.grossWeightUnit||''}\n`;
      txt+=`${t.rptVessel.padEnd(16)}: ${r.vesselName||'N/A'}\n`;
      txt+=`${t.rptPOL.padEnd(16)}: ${r.portOfLoading||'N/A'}\n`;
      txt+=`${t.rptPOD.padEnd(16)}: ${r.portOfDischarge||'N/A'}\n`;
      txt+=`${t.rptBL.padEnd(16)}: ${r.blNumber||'N/A'}\n`;
      txt+=`${t.rptInv.padEnd(16)}: ${r.invoiceNumber||'N/A'}\n`;
      txt+=`${t.rptComment.padEnd(16)}: ${ds.comment||'N/A'}\n`;
      txt+=`${'─'.repeat(64)}\n`;
    });
    txt+=`\n${t.rptFooter} · ${date}`;

    const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`docsvalidate-report-${Date.now()}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},200);
  }catch(e){alert('Error: '+e.message);}
}
