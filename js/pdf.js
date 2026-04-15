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
    var t = tx();
    var _e = function(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
    var date = new Date().toLocaleString(lang==='es'?'es-ES':'en-US');
    var status = coherenceResult?.overallStatus || 'warning';
    var finalErr = lastFinalErrors || 0;
    var finalWarn = lastFinalWarnings || 0;
    var okDocs = Math.max(0, analysisResults.length - finalErr);
    var blDoc = findBLDoc ? findBLDoc(analysisResults) : null;
    var blNum = _e((analysisResults.find(function(r){return r.blNumber})||{}).blNumber||'');
    var vessel = _e((analysisResults.find(function(r){return r.vesselName})||{}).vesselName||'');
    var voyage = _e((analysisResults.find(function(r){return r.voyageNumber})||{}).voyageNumber||'');
    var portL = _e((analysisResults.find(function(r){return r.portOfLoading})||{}).portOfLoading||'');
    var portD = _e((analysisResults.find(function(r){return r.portOfDischarge})||{}).portOfDischarge||'');
    var lots = [...new Set(analysisResults.flatMap(function(r){return r.lotNumbers||[]}).filter(Boolean))].map(_e);
    var summary = _e(coherenceResult?.summary||'');
    var actionItems = (coherenceResult?.actionItems||[]).map(_e);
    var totalAmt = _e((analysisResults.find(function(r){return r.totalAmount})||{}).totalAmount||'');
    var priceUnit = _e((analysisResults.find(function(r){return r.pricePerUnit})||{}).pricePerUnit||'');

    var sc = {approved:{bg:'#28a989',lbl:'APPROVED'},warning:{bg:'#4a6fa5',lbl:'WITH OBSERVATIONS'},rejected:{bg:'#7a2e22',lbl:'REJECTED'}}[status]||{bg:'#4a6fa5',lbl:'WARNING'};
    if(lang==='es') sc.lbl = {approved:'APROBADO',warning:'CON OBSERVACIONES',rejected:'RECHAZADO'}[status]||'ADVERTENCIA';
    var cleanDoc = function(s){return _e((s||'').replace(/\.[^.]+$/,''));};

    // ── CONSISTENCY MATRIX ──
    var matrixHtml = '';
    if(blDoc){
      var otherDocs = analysisResults.filter(function(r){return r!==blDoc&&!r._err});
      if(otherDocs.length>0){
        var mxFields = [
          {k:'shipper',l:FL('shipper')},{k:'consigneeName',l:FL('consignee')},
          {k:'lotNumbers',l:FL('lots'),a:1},{k:'bagCount',l:FL('bags')},
          {k:'netWeight',l:FL('netWeight')},{k:'grossWeight',l:FL('grossWeight')},
          {k:'containerNumbers',l:FL('containers'),a:1},{k:'sealNumbers',l:FL('seals'),a:1},
          {k:'vesselName',l:FL('vessel')},{k:'portOfLoading',l:FL('portOfLoading')},
          {k:'portOfDischarge',l:FL('portOfDischarge')},{k:'destinationCountry',l:FL('destinationCountry')},
          {k:'blNumber',l:FL('blNumber')},{k:'invoiceNumber',l:FL('invoiceNumber')},
          {k:'voyageNumber',l:FL('voyageNumber')}
        ];
        var gv=function(doc,k,a){var v=doc[k];if(a)return(Array.isArray(v)?v:v?[v]:[]).filter(Boolean).sort().join(', ');return v?String(v).trim():'';};
        var sn=function(r){return _e((translateDocType(r.docType)||r._filename||'').replace(/\.[^.]+$/,'').substring(0,20));};
        matrixHtml='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;margin:14px 0 6px;">'+_e(t.matrixLabel||'Consistency Matrix')+'</div>';
        matrixHtml+='<table style="width:100%;border-collapse:collapse;font-size:7px;border:1px solid #e8edf5;"><thead><tr style="background:#0d1b2a;">';
        matrixHtml+='<th style="padding:4px 6px;text-align:left;color:#fff;font-size:6.5px;letter-spacing:0.06em;">'+(lang==='es'?'Campo':'Field')+'</th>';
        matrixHtml+='<th style="padding:4px 6px;text-align:left;color:#fff;font-size:6.5px;background:#4a6fa5;">B/L</th>';
        otherDocs.forEach(function(d){matrixHtml+='<th style="padding:4px 6px;text-align:center;color:#fff;font-size:5.5px;white-space:nowrap;">'+sn(d)+'</th>';});
        matrixHtml+='</tr></thead><tbody>';
        mxFields.forEach(function(f){
          var bv=gv(blDoc,f.k,f.a); if(!bv)return;
          matrixHtml+='<tr><td style="padding:3px 6px;border-bottom:1px solid #e8edf5;font-weight:600;font-size:7px;background:#f7f8fa;">'+_e(f.l)+'</td>';
          matrixHtml+='<td style="padding:3px 6px;border-bottom:1px solid #e8edf5;font-size:6.5px;background:#f7f8fa;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_e(bv.substring(0,28))+'</td>';
          otherDocs.forEach(function(d){
            var dv=gv(d,f.k,f.a);
            if(!dv){matrixHtml+='<td style="padding:3px 6px;border-bottom:1px solid #e8edf5;text-align:center;color:#d0d6e2;">&mdash;</td>';return;}
            var ok=isTrivialDifference(bv,dv);
            matrixHtml+='<td style="padding:3px 6px;border-bottom:1px solid #e8edf5;text-align:center;font-weight:700;font-size:7px;color:'+(ok?'#1a6b3a':'#7a2e22')+';background:'+(ok?'rgba(26,107,58,0.06)':'rgba(176,64,48,0.08)')+';">'+(ok?'OK':'DIFF')+'</td>';
          });
          matrixHtml+='</tr>';
        });
        matrixHtml+='</tbody></table>';
        matrixHtml+='<div style="font-size:5.5px;color:#7a8499;margin:3px 0 10px;">'+_e(t.matrixLegend||'OK = consistent with B/L | — = field not present | DIFF = different value')+'</div>';
      }
    }

    // ── INCONSISTENCIES + VERIFIED FIELDS from _spFields ──
    var fields = (typeof _spFields!=='undefined'&&_spFields.length>0)?_spFields:[];
    var errFields = fields.filter(function(f){return f.severity==='err'});
    var warnFields = fields.filter(function(f){return f.severity==='warn'});
    var okFields = fields.filter(function(f){return f.severity==='ok'});

    var issuesHtml = '';
    if(errFields.length>0){
      issuesHtml+='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#7a2e22;margin:14px 0 8px;">'+_e(t.spCritical||'Critical Inconsistencies')+' ('+errFields.length+')</div>';
      errFields.forEach(function(f){
        issuesHtml+='<div style="border:1px solid rgba(122,46,34,0.2);border-radius:6px;margin-bottom:8px;overflow:hidden;">';
        issuesHtml+='<div style="background:rgba(122,46,34,0.06);padding:6px 10px;font-size:8px;font-weight:700;color:#7a2e22;text-transform:uppercase;letter-spacing:0.08em;">'+_e(f.label)+'</div>';
        issuesHtml+='<div style="padding:8px 10px;font-size:8px;line-height:1.5;">';
        if(f.message) issuesHtml+='<div style="color:#3a4255;margin-bottom:6px;">'+_e(f.message)+'</div>';
        if(f.values&&f.values.length>0){
          issuesHtml+='<div style="font-size:7px;font-weight:700;color:#7a8499;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">'+(lang==='es'?'Valor por documento':'Value per document')+'</div>';
          f.values.forEach(function(v){
            var isOut = f.majVal && (v.value||'').trim()!==f.majVal;
            issuesHtml+='<div style="display:flex;align-items:center;gap:8px;padding:3px 8px;margin-bottom:2px;border-radius:4px;font-size:7.5px;'+(isOut?'background:rgba(176,64,48,0.06);color:#7a2e22;font-weight:700;':'background:#f7f8fa;color:#3a4255;')+'">';
            issuesHtml+='<span style="color:#7a8499;min-width:120px;">'+cleanDoc(v.doc)+'</span>';
            issuesHtml+='<span>'+_e(v.value||'—')+'</span>';
            issuesHtml+='<span style="margin-left:auto;">'+(isOut?'✗':'✓')+'</span></div>';
          });
        }
        issuesHtml+='</div></div>';
      });
    }
    if(warnFields.length>0){
      issuesHtml+='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#4a6fa5;margin:12px 0 8px;">'+_e(t.spObservations||'Observations')+' ('+warnFields.length+')</div>';
      warnFields.forEach(function(f){
        issuesHtml+='<div style="border:1px solid rgba(74,111,165,0.2);border-radius:6px;padding:6px 10px;margin-bottom:6px;font-size:8px;color:#4a6fa5;font-weight:600;">● '+_e(f.label)+'</div>';
      });
    }
    if(okFields.length>0){
      issuesHtml+='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#1a6b3a;margin:12px 0 8px;">'+_e(t.spVerified||'Verified Fields')+' ('+okFields.length+')</div>';
      issuesHtml+='<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      okFields.forEach(function(f){
        issuesHtml+='<span style="font-size:7px;color:#1a6b3a;background:rgba(26,107,58,0.06);padding:2px 8px;border-radius:100px;">● '+_e(f.label)+'</span>';
      });
      issuesHtml+='</div>';
    }

    // ── ACTION ITEMS ──
    var aiHtml = '';
    if(actionItems.length>0){
      aiHtml='<div style="margin-top:12px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#7a2e22;margin-bottom:6px;">'+_e(t.actionItemsLabel||'Action Items')+'</div>';
      actionItems.forEach(function(item,i){
        aiHtml+='<div style="padding:3px 0;font-size:8px;line-height:1.5;border-bottom:1px solid #f0f2f5;"><span style="color:#7a2e22;font-weight:700;">'+(i+1)+'.</span> '+item+'</div>';
      });
      aiHtml+='</div>';
    }

    // ── PER DOCUMENT TABLE ──
    var perDoc = coherenceResult?.perDocumentStatus||{};
    var docRows = '';
    analysisResults.forEach(function(r){
      if(r._err) return;
      var ds = perDoc[r._filename]||{};
      var ico = ds.status==='approved'?'✓':ds.status==='rejected'?'✗':'⚠';
      var col = ds.status==='approved'?'#28a989':ds.status==='rejected'?'#7a2e22':'#4a6fa5';
      docRows+='<tr><td style="padding:4px 8px;border-bottom:1px solid #e8edf5;font-size:8px;font-weight:600;">'+_e(translateDocType(ds.docType||r.docType)||r._filename)+'</td>';
      docRows+='<td style="padding:4px 8px;border-bottom:1px solid #e8edf5;font-size:7px;color:#7a8499;">'+_e(r._filename)+'</td>';
      docRows+='<td style="padding:4px 8px;border-bottom:1px solid #e8edf5;text-align:center;color:'+col+';font-weight:700;font-size:10px;">'+ico+'</td>';
      docRows+='<td style="padding:4px 8px;border-bottom:1px solid #e8edf5;font-size:7px;color:#7a8499;">'+_e(ds.comment||'')+'</td></tr>';
    });

    // ── BUILD FULL HTML ──
    var routeLine = [portL,portD].filter(Boolean).join(' → ');
    var lotsLine = lots.length?(lang==='es'?'Lotes: ':'Lots: ')+lots.join(', '):'';
    var containers = [...new Set(analysisResults.flatMap(function(r){return r.containerNumbers||[]}).filter(Boolean))];

    var html = '<div style="width:190mm;font-family:Helvetica,Arial,sans-serif;color:#0f1117;font-size:10px;line-height:1.4;">'

    // HEADER
    +'<table style="width:100%;border-bottom:2px solid #0d1b2a;margin-bottom:10px;"><tr>'
    +'<td style="font-size:16px;font-weight:700;letter-spacing:0.1em;color:#0d1b2a;padding-bottom:8px;">DOCSVALIDATE</td>'
    +'<td style="text-align:right;font-size:9px;color:#7a8499;padding-bottom:8px;line-height:1.5;">'+date+(blNum?'<br><b style="color:#0d1b2a;">B/L: '+blNum+'</b>':'')+(vessel?'<br>'+vessel+(voyage?' · Voy. '+voyage:''):'')+'</td>'
    +'</tr></table>'

    // TRANSPORT INFO
    +'<table style="width:100%;margin-bottom:10px;border:1px solid #e8edf5;border-collapse:collapse;"><tr>'
    +'<td style="padding:10px 14px;width:50%;vertical-align:top;border-right:1px solid #e8edf5;">'
    +'<div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;margin-bottom:4px;">TRANSPORT</div>'
    +(blNum?'<div style="font-size:14px;font-weight:700;color:#0d1b2a;margin-bottom:2px;">B/L '+blNum+'</div>':'')
    +(vessel?'<div style="font-size:9px;color:#3a4255;"><b>'+vessel+'</b>'+(voyage?' · Voy. '+voyage:'')+'</div>':'')
    +(routeLine?'<div style="font-size:8px;color:#7a8499;margin-top:2px;">'+routeLine+'</div>':'')
    +(lotsLine?'<div style="font-size:8px;color:#7a8499;">'+lotsLine+(containers.length?' · '+containers.length+' containers':'')+'</div>':'')
    +'</td>'
    +'<td style="padding:10px 14px;vertical-align:top;">'
    +'<div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#7a8499;margin-bottom:4px;">COMMERCIAL</div>'
    +(totalAmt?'<div style="font-size:12px;font-weight:700;color:#0d1b2a;">'+totalAmt+'</div>':'<div style="color:#d0d6e2;">—</div>')
    +(priceUnit?'<div style="font-size:8px;color:#7a8499;">'+priceUnit+'</div>':'')
    +'</td></tr></table>'

    // VERDICT
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border:1px solid #e8edf5;border-left:4px solid '+sc.bg+';margin-bottom:8px;border-radius:0 6px 6px 0;">'
    +'<div style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+sc.bg+';"></span><span style="font-size:10px;font-weight:700;color:'+sc.bg+';">'+sc.lbl+'</span></div>'
    +'<div style="font-size:8px;color:#7a8499;"><span style="color:#7a2e22;font-weight:700;">'+finalErr+'</span> critical · <span>'+analysisResults.length+'</span> docs · <span style="color:#1a6b3a;">'+okDocs+'</span> clean</div>'
    +'</div>'

    // AI SUMMARY
    +(summary?'<div style="border-left:3px solid #4a6fa5;padding:8px 12px;margin-bottom:10px;font-size:8.5px;line-height:1.7;color:#3a4255;font-style:italic;background:#f7f8fa;">'+summary+'</div>':'')

    // STATS ROW
    +'<table style="width:100%;border-collapse:collapse;margin-bottom:10px;"><tr>'
    +'<td style="text-align:center;padding:8px;border:1px solid #e8edf5;border-top:3px solid #4a6fa5;"><div style="font-size:20px;font-weight:700;color:#4a6fa5;">'+analysisResults.length+'</div><div style="font-size:6.5px;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;">'+_e(t.statDocs)+'</div></td>'
    +'<td style="text-align:center;padding:8px;border:1px solid #e8edf5;border-top:3px solid #28a989;"><div style="font-size:20px;font-weight:700;color:#28a989;">'+okDocs+'</div><div style="font-size:6.5px;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;">'+_e(t.statOk)+'</div></td>'
    +'<td style="text-align:center;padding:8px;border:1px solid #e8edf5;border-top:3px solid #4a6fa5;"><div style="font-size:20px;font-weight:700;color:#4a6fa5;">'+finalWarn+'</div><div style="font-size:6.5px;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;">'+_e(t.statWarn)+'</div></td>'
    +'<td style="text-align:center;padding:8px;border:1px solid #e8edf5;border-top:3px solid #7a2e22;"><div style="font-size:20px;font-weight:700;color:#7a2e22;">'+finalErr+'</div><div style="font-size:6.5px;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;">'+_e(t.statErr)+'</div></td>'
    +'</tr></table>'

    // CONSISTENCY MATRIX
    +matrixHtml

    // INCONSISTENCIES + VERIFIED
    +issuesHtml

    // ACTION ITEMS
    +aiHtml

    // PER DOCUMENT TABLE
    +'<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#7a8499;margin:14px 0 6px;">'+_e(t.perDocTitle||'Document Detail')+'</div>'
    +'<table style="width:100%;border-collapse:collapse;border:1px solid #e8edf5;"><thead><tr style="background:#f7f8fa;">'
    +'<th style="padding:4px 8px;text-align:left;font-size:6.5px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">'+(lang==='es'?'Tipo':'Type')+'</th>'
    +'<th style="padding:4px 8px;text-align:left;font-size:6.5px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">'+(lang==='es'?'Archivo':'File')+'</th>'
    +'<th style="padding:4px 8px;text-align:center;font-size:6.5px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">Status</th>'
    +'<th style="padding:4px 8px;text-align:left;font-size:6.5px;letter-spacing:0.08em;text-transform:uppercase;color:#7a8499;">'+(lang==='es'?'Notas':'Notes')+'</th>'
    +'</tr></thead><tbody>'+docRows+'</tbody></table>'

    // FOOTER
    +'<div style="border-top:1px solid #d0d6e2;padding-top:6px;margin-top:14px;font-size:7px;color:#7a8499;text-align:center;letter-spacing:0.08em;">'
    +'Validated by DocsValidate · '+(t.rptSubtitle||'AI-Powered Export Validation')+' · '+date
    +'</div></div>';

    var container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;';
    container.innerHTML = html;
    document.body.appendChild(container);

    var filename = 'docsvalidate-report-'+(blNum||Date.now())+'.pdf';
    await html2pdf().set({
      margin:[8,8,8,8],
      filename:filename,
      image:{type:'jpeg',quality:0.95},
      html2canvas:{scale:2,useCORS:true,logging:false},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
      pagebreak:{mode:['avoid-all','css','legacy']},
    }).from(container.firstElementChild).save();

    document.body.removeChild(container);
  } catch(e) {
    console.error('PDF generation error:',e);
    alert('PDF error: '+e.message);
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
