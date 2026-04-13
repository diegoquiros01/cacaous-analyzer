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

    var wsRight = document.querySelector('.ws-right');
    if (!wsRight) { alert('No results to export'); return; }

    var blNum = (analysisResults.find(function(r){return r.blNumber})||{}).blNumber || '';
    var date = new Date().toLocaleString(lang==='es'?'es-ES':'en-US');

    // Temporarily expand all collapsed sections in the live DOM
    var perdocBody = document.getElementById('rPerdocBody');
    var wasOpen = perdocBody && perdocBody.classList.contains('open');
    if (perdocBody && !wasOpen) { perdocBody.classList.add('open'); perdocBody.style.display = 'block'; }

    var closedCards = [];
    document.querySelectorAll('#docCards .r-dcard').forEach(function(card){
      if (!card.classList.contains('open')) {
        card.classList.add('open');
        var body = card.querySelector('.r-dcard-body');
        if (body) body.style.display = 'block';
        closedCards.push(card);
      }
    });

    // Clone into an offscreen container with fixed width
    var container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;background:#fff;padding:20px;font-family:Lato,Helvetica,Arial,sans-serif;';

    // Header
    container.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0d1b2a;padding-bottom:8px;margin-bottom:16px;">'
      + '<div style="font-size:18px;font-weight:700;letter-spacing:0.1em;color:#0d1b2a;">DOCSVALIDATE</div>'
      + '<div style="text-align:right;font-size:10px;color:#7a8499;line-height:1.5;">' + date
      + (blNum ? '<br><b style="color:#0d1b2a;">B/L: '+blNum+'</b>' : '') + '</div></div>';

    // Clone the content
    var clone = wsRight.cloneNode(true);
    clone.style.cssText = 'padding:0;max-width:none;overflow:visible;';

    // Remove action buttons and section label from clone
    var cloneActions = clone.querySelector('.actions');
    if (cloneActions) cloneActions.remove();
    var cloneSec = clone.querySelector('.section-label');
    if (cloneSec) cloneSec.remove();

    // Remove interactive buttons
    clone.querySelectorAll('.r-dcard-view, .r-alert-btn, [onclick*="toggleCard"], [onclick*="toggleR"]').forEach(function(el){ el.remove(); });

    // Ensure all sections expanded in clone
    clone.querySelectorAll('.r-perdoc-body').forEach(function(el){ el.style.display='block'; el.classList.add('open'); });
    clone.querySelectorAll('.r-dcard').forEach(function(el){ el.classList.add('open'); });
    clone.querySelectorAll('.r-dcard-body').forEach(function(el){ el.style.display='block'; });

    // Fix sticky positions in clone
    clone.querySelectorAll('.mx-table td, .mx-table th').forEach(function(el){ el.style.position='static'; });
    var cloneMx = clone.querySelector('.mx-scroll-wrap');
    if (cloneMx) cloneMx.style.overflow = 'visible';

    // Copy computed styles for key elements
    var styleDefs = document.querySelector('style');
    if (styleDefs) {
      var styleClone = document.createElement('style');
      styleClone.textContent = styleDefs.textContent;
      container.appendChild(styleClone);
    }

    container.appendChild(clone);

    // Footer
    var footer = document.createElement('div');
    footer.style.cssText = 'border-top:1px solid #d0d6e2;padding-top:8px;margin-top:20px;font-size:8px;color:#7a8499;text-align:center;letter-spacing:0.08em;';
    footer.textContent = 'Validated by DocsValidate · AI-Powered Export Validation · ' + date;
    container.appendChild(footer);

    document.body.appendChild(container);

    var filename = 'docsvalidate-report-' + (blNum || Date.now()) + '.pdf';
    await html2pdf().set({
      margin: [6, 6, 6, 6],
      filename: filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container).save();

    document.body.removeChild(container);

    // Restore collapsed state in live DOM
    closedCards.forEach(function(card){
      card.classList.remove('open');
      var body = card.querySelector('.r-dcard-body');
      if (body) body.style.display = 'none';
    });
    if (perdocBody && !wasOpen) { perdocBody.classList.remove('open'); perdocBody.style.display = 'none'; }

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
