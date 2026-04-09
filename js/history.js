// js/history.js (frontend) — Saved reports management
// Depends on globals: coherenceResult, analysisResults, _cachedSummary, lang, tx(), lastFinalErrors, lastFinalWarnings, _histSearchTimer, window.__clerk_user
// Depends on: auth.js (isLoggedIn, openClerkSignIn), pdf.js (downloadPdfReport), rendering.js (renderResults), app.js (setStep)

async function saveReportManual() {
  const btn = document.getElementById('btnSaveReport');
  const txt = document.getElementById('saveReportTxt');
  if (!isLoggedIn()) {
    openClerkSignIn();
    return;
  }
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  if (txt) txt.textContent = lang==='es' ? 'Guardando...' : 'Saving...';
  try {
    await saveHistory();
    if (txt) txt.textContent = tx().saveReportDone || '✓ Saved';
    if (btn) { btn.style.background = 'rgba(26,107,58,0.08)'; btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)'; }
  } catch(e) {
    if (txt) txt.textContent = lang==='es' ? 'Error' : 'Error';
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    console.error('Save report error:', e);
  }
}

let _saveHistoryInProgress = false;
async function saveHistory() {
  if (!isLoggedIn()) return;
  // Prevent concurrent saves (debounce)
  if (_saveHistoryInProgress) return;
  _saveHistoryInProgress = true;
  try { await _saveHistoryInner(); } finally { _saveHistoryInProgress = false; }
}
async function _saveHistoryInner() {
  try {
    const blNum = analysisResults.find(r => r.blNumber)?.blNumber || '';
    const vessel = analysisResults.find(r => r.vesselName)?.vesselName || '';
    // Build compact result for storage (strip base64 data, keep extracted fields)
    const compactResults = analysisResults.map(r => {
      const c = {...r};
      delete c._file; delete c._blob;
      return c;
    });
    const resp = await fetch('/.netlify/functions/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        clerk_id: window.__clerk_user.id,
        bl_number: blNum,
        vessel_name: vessel,
        status: coherenceResult?.overallStatus || 'warning',
        doc_count: analysisResults.length,
        error_count: lastFinalErrors,
        warning_count: lastFinalWarnings,
        summary_text: coherenceResult?.summary || '',
        result_json: {
          coherenceResult: coherenceResult,
          analysisResults: compactResults,
        },
      })
    });
    if (!resp.ok) throw new Error('Server error: ' + resp.status);
  } catch (e) { console.warn('History save failed:', e.message); throw e; }
}

let _histSearchTimer = null;
function searchHistory() {
  clearTimeout(_histSearchTimer);
  _histSearchTimer = setTimeout(() => loadHistory(), 300);
}

async function loadHistory() {
  const sec = document.getElementById('historySection');
  if (!sec || !isLoggedIn()) { if(sec) sec.style.display='none'; return; }
  try {
    const search = (document.getElementById('histSearch')?.value || '').trim();
    const statusFilter = document.getElementById('histStatusFilter')?.value || '';
    const resp = await fetch('/.netlify/functions/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', clerk_id: window.__clerk_user.id, search: search || undefined, status_filter: statusFilter || undefined }),
    });
    const data = await resp.json();
    const rows = data.records || data.history || data || [];
    renderHistory(rows);
    sec.style.display = 'block';
  } catch (e) {
    console.warn('History load failed:', e.message);
    sec.style.display = 'none';
  }
}

function renderHistory(rows) {
  const t = tx();
  const list = document.getElementById('histList');
  if (!list) return;
  if (!rows || rows.length === 0) {
    list.innerHTML = '<div style="padding:1.2rem;text-align:center;font-size:0.78rem;color:var(--text-light);">' + t.histEmpty + '</div>';
    return;
  }
  const statusBadge = (s) => {
    const colors = { approved:'var(--green)', warning:'var(--tan)', rejected:'var(--red)' };
    const labels = { approved: t.statusOk, warning: t.statusWarn, rejected: t.statusErr };
    return '<span style="font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;padding:2px 7px;border:1px solid '+
      (colors[s]||'var(--border)')+';color:'+(colors[s]||'var(--text-light)')+';font-weight:700;border-radius:2px;">'+
      (labels[s]||s)+'</span>';
  };
  const delSelLabel = lang==='es' ? 'Eliminar seleccionados' : 'Delete selected';
  const selectAllLabel = lang==='es' ? 'Todos' : 'All';
  const header = '<div style="display:flex;align-items:center;padding:0.5rem 1rem;background:var(--brown-dark);color:rgba(255,255,255,0.6);font-size:0.55rem;letter-spacing:0.15em;text-transform:uppercase;">'
    + '<span style="flex:0 0 28px;"><input type="checkbox" id="histSelectAll" onchange="toggleSelectAllReports(this.checked)" style="cursor:pointer;accent-color:var(--tan);"></span>'
    + '<span style="flex:0 0 100px;">'+t.histDate+'</span>'
    + '<span style="flex:1;">'+t.histBL+'</span>'
    + '<span style="flex:0 0 140px;">'+t.histVessel+'</span>'
    + '<span style="flex:0 0 80px;text-align:center;">'+t.histStatus+'</span>'
    + '<span style="flex:0 0 50px;text-align:center;">'+t.histDocs+'</span>'
    + '<span style="flex:0 0 30px;"></span>'
    + '</div>'
    + '<div id="histBulkActions" style="display:none;padding:0.4rem 1rem;background:var(--cream);border-bottom:1px solid var(--border-light);"><button onclick="deleteSelectedReports()" style="background:none;border:1px solid var(--red);color:var(--red);font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;padding:0.3rem 0.8rem;cursor:pointer;border-radius:2px;">' + delSelLabel + '</button></div>';
  // Escape HTML to prevent XSS from API data (BL numbers, vessel names, etc.)
  const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const rowsHtml = rows.map(r => {
    const d = new Date(r.created_at);
    const dateStr = d.toLocaleDateString(lang==='es'?'es-ES':'en-US', { month:'short', day:'numeric' });
    const safeId = esc(r.id||'');
    const safeBL = esc(r.bl_number||'—');
    const safeVessel = esc(r.vessel_name||'—');
    const safeSummary = esc(r.summary_text||'');
    const safeStatus = esc(r.status||'');
    return '<div class="hist-row" onclick="showHistDetail(this)" data-id="'+safeId+'" data-summary="'+safeSummary+'" data-status="'+safeStatus+'" data-bl="'+safeBL+'" style="display:flex;align-items:center;padding:0.55rem 1rem;border-bottom:1px solid var(--border-light);cursor:pointer;font-size:0.78rem;transition:background 0.15s;"'
      + ' onmouseover="this.style.background=\'var(--offwhite)\'" onmouseout="this.style.background=\'var(--white)\'">'
      + '<span style="flex:0 0 28px;" onclick="event.stopPropagation();"><input type="checkbox" class="hist-check" data-id="'+safeId+'" onchange="updateBulkActions()" style="cursor:pointer;accent-color:var(--tan);"></span>'
      + '<span style="flex:0 0 100px;color:var(--text-light);font-size:0.72rem;">'+esc(dateStr)+'</span>'
      + '<span style="flex:1;font-weight:600;color:var(--brown-dark);">'+safeBL+'</span>'
      + '<span style="flex:0 0 140px;color:var(--text-light);font-size:0.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+safeVessel+'</span>'
      + '<span style="flex:0 0 80px;text-align:center;">'+statusBadge(r.status)+'</span>'
      + '<span style="flex:0 0 50px;text-align:center;color:var(--text-light);">'+esc(String(r.doc_count||0))+'</span>'
      + '<span style="flex:0 0 30px;text-align:center;"><a href="#" onclick="event.stopPropagation();deleteReport(\''+safeId+'\');return false;" style="color:var(--text-light);text-decoration:none;font-size:0.8rem;transition:color 0.2s;" onmouseover="this.style.color=\'var(--red)\'" onmouseout="this.style.color=\'var(--text-light)\'">✕</a></span>'
      + '</div>';
  }).join('');
  list.innerHTML = header + rowsHtml;
}

function showHistDetail(el) {
  const histId = el.dataset.id;
  if (!histId) return;
  // Load report data and download PDF directly
  downloadHistReport(histId);
}

async function downloadHistReport(histId) {
  if (!isLoggedIn()) return;
  try {
    const resp = await fetch('/.netlify/functions/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', clerk_id: window.__clerk_user.id, id: histId }),
    });
    const data = await resp.json();
    const record = data.record;
    if (!record?.result_json) {
      alert(lang==='es' ? 'Este reporte no tiene datos guardados.' : 'This report has no saved data.');
      return;
    }
    // Restore state temporarily for PDF generation
    let saved = record.result_json;
    if (typeof saved === 'string') saved = JSON.parse(saved);
    const prevCoherence = coherenceResult;
    const prevResults = analysisResults;
    coherenceResult = saved.coherenceResult;
    analysisResults = saved.analysisResults || [];
    _cachedSummary = coherenceResult?.summary || null;
    // Generate and download PDF
    await downloadPdfReport();
    // Restore previous state
    coherenceResult = prevCoherence;
    analysisResults = prevResults;
  } catch (e) {
    console.error('Download report error:', e);
    alert(lang==='es' ? 'Error descargando reporte' : 'Error downloading report');
  }
}

function toggleSelectAllReports(checked) {
  document.querySelectorAll('.hist-check').forEach(cb => { cb.checked = checked; });
  updateBulkActions();
}

function updateBulkActions() {
  const checked = document.querySelectorAll('.hist-check:checked').length;
  const bar = document.getElementById('histBulkActions');
  if (bar) bar.style.display = checked > 0 ? 'block' : 'none';
}

async function deleteSelectedReports() {
  const checks = document.querySelectorAll('.hist-check:checked');
  if (checks.length === 0) return;
  const confirmMsg = lang==='es'
    ? '¿Eliminar ' + checks.length + ' reporte(s)?'
    : 'Delete ' + checks.length + ' report(s)?';
  if (!confirm(confirmMsg)) return;
  const ids = Array.from(checks).map(cb => cb.dataset.id).filter(Boolean);
  for (const id of ids) {
    try {
      await fetch('/.netlify/functions/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', clerk_id: window.__clerk_user.id, id }),
      });
    } catch (e) { console.warn('Delete failed:', id, e.message); }
  }
  loadHistory();
}

async function deleteReport(histId) {
  if (!isLoggedIn() || !histId) return;
  const confirmMsg = lang==='es' ? '¿Eliminar este reporte?' : 'Delete this report?';
  if (!confirm(confirmMsg)) return;
  try {
    const resp = await fetch('/.netlify/functions/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', clerk_id: window.__clerk_user.id, id: histId }),
    });
    if (!resp.ok) throw new Error('Delete failed');
    loadHistory(); // refresh list
  } catch (e) {
    console.error('Delete report error:', e);
    alert(lang==='es' ? 'Error eliminando reporte' : 'Error deleting report');
  }
}

async function loadHistReport(histId) {
  if (!isLoggedIn()) return;
  try {
    const resp = await fetch('/.netlify/functions/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', clerk_id: window.__clerk_user.id, id: histId }),
    });
    const data = await resp.json();
    const record = data.record;
    if (!record?.result_json) {
      alert(lang==='es' ? 'Este reporte no tiene datos guardados.' : 'This report has no saved data.');
      return;
    }
    // Restore the analysis state and render results
    let saved = record.result_json;
    if (typeof saved === 'string') saved = JSON.parse(saved);
    coherenceResult = saved.coherenceResult;
    analysisResults = saved.analysisResults || [];
    _cachedSummary = coherenceResult?.summary || null;

    // Hide upload, show results
    const uploadSec = document.getElementById('uploadSection');
    const histSec = document.getElementById('historySection');
    if (uploadSec) uploadSec.style.display = 'none';
    if (histSec) histSec.style.display = 'none';
    setStep(3);
    renderResults();
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error('Load report error:', e);
    alert(lang==='es' ? 'Error cargando reporte: ' + e.message : 'Error loading report: ' + e.message);
  }
}
