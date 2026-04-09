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
    const t = tx();

    // HTML escape function to prevent injection in PDF templates
    const _e = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const date = new Date().toLocaleString(lang==='es'?'es-ES':'en-US');
    const status = coherenceResult?.overallStatus || 'warning';
    const issues = coherenceResult?.coherenceIssues || [];
    const finalErr = lastFinalErrors;
    const finalWarn = lastFinalWarnings;
    const okDocs = Math.max(0, analysisResults.length - finalErr);
    const blNum = _e(analysisResults.find(r=>r.blNumber)?.blNumber || '');
    const vessel = _e(analysisResults.find(r=>r.vesselName)?.vesselName || '');
    const voyage = _e(analysisResults.find(r=>r.voyageNumber)?.voyageNumber || '');
    const portL = _e(analysisResults.find(r=>r.portOfLoading)?.portOfLoading || '');
    const portD = _e(analysisResults.find(r=>r.portOfDischarge)?.portOfDischarge || '');
    const lots = [...new Set(analysisResults.flatMap(r=>r.lotNumbers||[]).filter(Boolean))].map(_e);
    const summary = _e(coherenceResult?.summary || '');
    const actionItems = (coherenceResult?.actionItems || []).map(_e);
    const totalAmt = _e(analysisResults.find(r=>r.totalAmount)?.totalAmount || '');
    const priceUnit = _e(analysisResults.find(r=>r.pricePerUnit)?.pricePerUnit || '');
    const incoterm = _e(analysisResults.find(r=>r.incoterms)?.incoterms || '');
    const payTerms = _e(analysisResults.find(r=>r.paymentTerms)?.paymentTerms || '');

    const sc = {
      approved: { bg:'#1a6b3a', label: lang==='es'?'APROBADO':'APPROVED' },
      warning:  { bg:'#8a6a00', label: lang==='es'?'CON OBSERVACIONES':'WITH OBSERVATIONS' },
      rejected: { bg:'#7a2e22', label: lang==='es'?'RECHAZADO':'REJECTED' },
    }[status] || { bg:'#8a6a00', label:'WARNING' };

    const cleanDoc = s => _e((s||'').replace(/\.[^.]+$/,'').replace(/_page(\d+)/,' p.$1'));

    // Use _spFields (from split panel) — always populated
    const fields = (typeof _spFields !== 'undefined' && _spFields.length > 0) ? _spFields : [];

    // Build coherence table from _spFields
    let tableRows = '';
    fields.forEach(f => {
      const icon = f.severity==='err' ? '✗' : f.severity==='warn' ? '⚠' : '✓';
      const color = f.severity==='err' ? '#7a2e22' : f.severity==='warn' ? '#8a6a00' : '#1a6b3a';
      const bg = f.severity==='err' ? '#fdf2f0' : f.severity==='warn' ? '#fdf8ee' : '#fff';
      let valCell = '';
      if (f.severity==='ok') {
        valCell = _e(f.majVal || '—');
      } else if (f.values && f.values.length > 0) {
        valCell = f.values.map(v => {
          const isOut = f.majVal && (v.value||'').trim() !== f.majVal;
          return '<div style="margin-bottom:2px;' + (isOut?'color:#7a2e22;font-weight:700;':'') + '">'
            + '<span style="color:#7a8499;font-size:8px;">' + cleanDoc(v.doc) + ':</span> '
            + _e(v.value||'—') + (isOut?' ✗':'') + '</div>';
        }).join('');
      }
      tableRows += '<tr style="background:'+bg+';">'
        + '<td style="padding:6px 10px;border-bottom:1px solid #e8edf5;font-weight:600;font-size:10px;color:'+color+';white-space:nowrap;">' + icon + ' ' + _e(f.label) + '</td>'
        + '<td style="padding:6px 10px;border-bottom:1px solid #e8edf5;font-size:9px;line-height:1.6;">' + valCell + '</td>'
        + '</tr>';
    });

    // Per-document rows
    let docRows = '';
    const perDoc = coherenceResult?.perDocumentStatus || {};
    analysisResults.forEach(r => {
      const ds = perDoc[r._filename] || {};
      const icon = ds.status==='approved' ? '✓' : ds.status==='rejected' ? '✗' : '⚠';
      const color = ds.status==='approved' ? '#1a6b3a' : ds.status==='rejected' ? '#7a2e22' : '#8a6a00';
      docRows += '<tr>'
        + '<td style="padding:4px 10px;border-bottom:1px solid #e8edf5;font-size:10px;font-weight:600;">' + _e(translateDocType(ds.docType||r.docType)||r._filename) + '</td>'
        + '<td style="padding:4px 10px;border-bottom:1px solid #e8edf5;font-size:9px;color:#7a8499;">' + _e(r._filename) + '</td>'
        + '<td style="padding:4px 10px;border-bottom:1px solid #e8edf5;text-align:center;color:'+color+';font-weight:700;font-size:11px;">' + icon + '</td>'
        + '<td style="padding:4px 10px;border-bottom:1px solid #e8edf5;font-size:8px;color:#7a8499;">' + _e(ds.comment||'') + '</td>'
        + '</tr>';
    });

    // Action items
    let aiHtml = '';
    if (actionItems.length > 0) {
      aiHtml = '<div style="margin-top:14px;page-break-inside:avoid;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#7a2e22;margin-bottom:6px;">'
        + (t.actionItemsLabel || 'Action Items') + '</div>';
      actionItems.forEach((item, i) => {
        aiHtml += '<div style="padding:3px 0;font-size:9px;line-height:1.5;border-bottom:1px solid #f0f2f5;">'
          + '<span style="color:#7a2e22;font-weight:700;">' + (i+1) + '.</span> '
          + '<span style="color:#3a4255;">' + item + '</span></div>';
      });
      aiHtml += '</div>';
    }

    // Commercial + Transport info line
    const infoLine = [totalAmt, priceUnit, incoterm, payTerms].filter(Boolean).join(' · ');
    const routeLine = [portL, portD].filter(Boolean).join(' → ');
    const lotsLine = lots.length ? (lang==='es'?'Lotes: ':'Lots: ') + lots.join(', ') : '';

    // Build consistency matrix HTML before the template
    let matrixHtml = '';
    try {
      const blDoc = findBLDoc(analysisResults);
      if (blDoc) {
        const otherDocs = analysisResults.filter(r => r !== blDoc && !r._err);
        if (otherDocs.length > 0) {
          const mxFields = [
            {key:'shipper',label:FL('shipper')},{key:'consigneeName',label:FL('consignee')},
            {key:'lotNumbers',label:FL('lots'),isArr:true},{key:'bagCount',label:FL('bags')},
            {key:'netWeight',label:FL('netWeight')},{key:'grossWeight',label:FL('grossWeight')},
            {key:'containerNumbers',label:FL('containers'),isArr:true},
            {key:'sealNumbers',label:FL('seals'),isArr:true},
            {key:'vesselName',label:FL('vessel')},{key:'portOfLoading',label:FL('portOfLoading')},
            {key:'portOfDischarge',label:FL('portOfDischarge')},{key:'destinationCountry',label:FL('destinationCountry')},
            {key:'blNumber',label:FL('blNumber')},{key:'invoiceNumber',label:FL('invoiceNumber')},
            {key:'voyageNumber',label:FL('voyageNumber')},
          ];
          const gv = (doc,key,isArr) => { const v=doc[key]; if(isArr) return (Array.isArray(v)?v:v?[v]:[]).filter(Boolean).sort().join(', '); return v?String(v).trim():''; };
          const sn = r => (translateDocType(r.docType)||r._filename||'').replace(/\.[^.]+$/,'').substring(0,18);
          matrixHtml = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;border-bottom:1px solid #e8edf5;padding-bottom:3px;">'+(t.matrixLabel||'Consistency Matrix')+'</div>';
          matrixHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:4px;font-size:7px;"><thead><tr style="background:#1c2230;">';
          matrixHtml += '<th style="padding:3px 5px;text-align:left;color:white;font-size:6px;letter-spacing:0.06em;text-transform:uppercase;">'+(lang==='es'?'Campo':'Field')+'</th>';
          matrixHtml += '<th style="padding:3px 5px;text-align:left;color:white;font-size:6px;background:#3a4660;">B/L</th>';
          otherDocs.forEach(d => { matrixHtml += '<th style="padding:3px 5px;text-align:center;color:white;font-size:5.5px;letter-spacing:0.04em;white-space:nowrap;">'+sn(d)+'</th>'; });
          matrixHtml += '</tr></thead><tbody>';
          mxFields.forEach(f => {
            const blVal = gv(blDoc,f.key,f.isArr);
            if (!blVal) return;
            matrixHtml += '<tr><td style="padding:2px 5px;border-bottom:1px solid #e8edf5;font-weight:600;font-size:7px;">'+f.label+'</td>';
            matrixHtml += '<td style="padding:2px 5px;border-bottom:1px solid #e8edf5;font-size:6.5px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+blVal.substring(0,25)+(blVal.length>25?'...':'')+'</td>';
            otherDocs.forEach(d => {
              const dv = gv(d,f.key,f.isArr);
              if (!dv) { matrixHtml += '<td style="padding:2px 5px;border-bottom:1px solid #e8edf5;text-align:center;color:#d0d6e2;">—</td>'; return; }
              const match = isTrivialDifference(blVal, dv);
              matrixHtml += '<td style="padding:2px 5px;border-bottom:1px solid #e8edf5;text-align:center;font-weight:700;color:'+(match?'#1a6b3a':'#7a2e22')+';font-size:7px;">'+(match?'OK':'DIFF')+'</td>';
            });
            matrixHtml += '</tr>';
          });
          matrixHtml += '</tbody></table>';
          matrixHtml += '<div style="font-size:6px;color:#7a8499;margin-bottom:10px;">'+(t.matrixLegend||'OK = consistent with B/L | — = field not present | DIFF = different value')+'</div>';
        }
      }
    } catch(e) { console.warn('PDF matrix error:', e.message); }

    const html = `<div style="width:190mm;font-family:Helvetica,Arial,sans-serif;color:#0f1117;font-size:10px;line-height:1.4;">
<!-- Header -->
<table style="width:100%;border-bottom:2px solid #1c2230;margin-bottom:10px;"><tr>
<td style="font-size:16px;font-weight:700;letter-spacing:0.1em;padding-bottom:8px;">DOCSVALIDATE</td>
<td style="text-align:right;font-size:9px;color:#7a8499;padding-bottom:8px;line-height:1.5;">
${date}<br>${blNum?'<b style="color:#0f1117;">B/L: '+blNum+'</b><br>':''}${vessel}${voyage?' · Voy. '+voyage:''}
</td>
</tr></table>

<!-- Status + Stats -->
<table style="width:100%;margin-bottom:10px;"><tr>
<td style="width:140px;vertical-align:top;">
<div style="background:${sc.bg};color:white;padding:5px 14px;font-size:11px;font-weight:700;letter-spacing:0.08em;display:inline-block;">${sc.label}</div>
</td>
<td style="vertical-align:top;">
<table style="width:100%;border-collapse:collapse;"><tr>
<td style="text-align:center;padding:6px;background:#f7f8fa;border:1px solid #e8edf5;"><div style="font-size:18px;color:#4a6fa5;">${analysisResults.length}</div><div style="font-size:7px;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;">${t.statDocs}</div></td>
<td style="text-align:center;padding:6px;background:#f7f8fa;border:1px solid #e8edf5;"><div style="font-size:18px;color:#1a6b3a;">${okDocs}</div><div style="font-size:7px;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;">${t.statOk}</div></td>
<td style="text-align:center;padding:6px;background:#f7f8fa;border:1px solid #e8edf5;"><div style="font-size:18px;color:#8a6a00;">${finalWarn}</div><div style="font-size:7px;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;">${t.statWarn}</div></td>
<td style="text-align:center;padding:6px;background:#f7f8fa;border:1px solid #e8edf5;"><div style="font-size:18px;color:#7a2e22;">${finalErr}</div><div style="font-size:7px;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;">${t.statErr}</div></td>
</tr></table>
</td>
</tr></table>

<!-- Transport + Commercial info -->
${(routeLine||lotsLine||infoLine) ? '<div style="background:#f7f8fa;border:1px solid #e8edf5;padding:7px 10px;margin-bottom:10px;font-size:9px;color:#3a4255;line-height:1.6;">'
  + (routeLine ? '<b>'+routeLine+'</b><br>' : '')
  + (lotsLine ? lotsLine + '<br>' : '')
  + (infoLine ? infoLine : '')
  + '</div>' : ''}

<!-- AI Summary -->
${summary ? '<div style="border-left:3px solid #4a6fa5;padding:8px 12px;margin-bottom:12px;font-size:9.5px;line-height:1.7;color:#3a4255;font-style:italic;background:#f7f8fa;">'+summary+'</div>' : ''}

<!-- Consistency Matrix -->
${matrixHtml}


${aiHtml}

<!-- Per Document -->
<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;border-bottom:1px solid #e8edf5;padding-bottom:3px;">${t.perDocTitle || 'Per Document Detail'}</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
<thead><tr style="background:#f0f2f5;">
<th style="padding:4px 10px;text-align:left;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">${lang==='es'?'Tipo':'Type'}</th>
<th style="padding:4px 10px;text-align:left;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">${lang==='es'?'Archivo':'File'}</th>
<th style="padding:4px 10px;text-align:center;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">${t.th2}</th>
<th style="padding:4px 10px;text-align:left;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">${lang==='es'?'Notas':'Notes'}</th>
</tr></thead>
<tbody>${docRows}</tbody>
</table>

<!-- Footer -->
<div style="border-top:1px solid #d0d6e2;padding-top:6px;margin-top:12px;font-size:7px;color:#7a8499;text-align:center;letter-spacing:0.08em;">
Validated by DocsValidate · ${t.rptSubtitle || 'AI-Powered Export Validation'} · ${date}
</div>
</div>`;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.innerHTML = html;
    document.body.appendChild(container);

    const filename = 'docsvalidate-report-' + (blNum || Date.now()) + '.pdf';
    await html2pdf().set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container.firstElementChild).save();

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
