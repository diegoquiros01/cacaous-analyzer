// js/app.js — Main application logic, API calls, file management
// Depends on globals: lang, TX, tx(), uploadedFiles, analysisResults, coherenceResult, _cachedSummary, _analysisInProgress, _heavyLibsLoaded, _heavyLibsLoading, HERO_IMAGES, MAKE_WEBHOOK, GUEST_LIMIT
// Depends on: auth.js (isLoggedIn, getGuestCount, incGuestCount, showAuthModal, showUpgradeModal, buildAuthHeaders)
//             extraction.js (extractDoc, addFiles helpers, splitPdfToPages, excelToText, wordToText, detectDocType, isExcel, isWord, getIcon, getBadge)
//             coherence.js (analyzeCoherence, translateWithAI, translateSummaryLocal, translateSummary, tx)
//             rendering.js (renderResults)

function setLang(l){
  lang=l;
  localStorage.setItem('dv_lang', l);
  document.getElementById('btnES').classList.toggle('active',l==='es');
  document.getElementById('btnEN').classList.toggle('active',l==='en');
  applyLang();
  // Translate summary with AI if switching to ES and summary exists
  if(_cachedSummary){
    const summaryEls = document.querySelectorAll('.summary-comment-text');
    const labelEls = document.querySelectorAll('.summary-comment-label');
    labelEls.forEach(el => { el.textContent = tx().summaryLabel; });
    if(l === 'es'){
      // Show loading indicator
      summaryEls.forEach(el => { el.style.opacity = '0.5'; });
      translateWithAI(_cachedSummary, 'es').then(translated => {
        summaryEls.forEach(el => { el.textContent = translated; el.style.opacity = '1'; });
      });
    } else {
      // Back to English — use cached original
      summaryEls.forEach(el => { el.textContent = _cachedSummary; el.style.opacity = '1'; });
    }
  }
}

function applyLang(){
  const t = tx();
  // Helper: set textContent safely
  const st = (id, txt) => { const el = document.getElementById(id); if(el && txt !== undefined) el.textContent = txt; };
  // Helper: set innerHTML safely
  const sh = (id, html) => { const el = document.getElementById(id); if(el && html !== undefined) el.innerHTML = html; };

  // ── Hero ──────────────────────────────────────
  sh('logoTagline', t.logoTagline);
  sh('heroEyebrow', t.heroEyebrow);
  sh('heroTitle', t.heroTitle);
  st('heroSub', t.heroSub);
  const bulletsEl = document.getElementById('heroBullets');
  if(bulletsEl && t.heroBullets) bulletsEl.innerHTML = t.heroBullets.map(b=>`<span>${b}</span>`).join('');

  // ── Nav progress steps ─────────────────────────
  st('ps1txt', t.ps1); st('ps2txt', t.ps2); st('ps3txt', t.ps3); st('ps4txt', t.ps4);

  // ── Upload section ─────────────────────────────
  st('s1title', t.s1title); st('s1sub', t.s1sub);
  st('s2title', t.s2title); st('s2sub', t.s2sub);
  sh('uploadTitle', t.uploadTitle); sh('uploadSub', t.uploadSub);
  st('uploadCta', t.uploadCta);
  st('analyzeBtnTxt', t.analyzeBtnTxt);
  st('partialTipText', t.partialTip);
  st('upSt1Lbl', t.stepDocTypes || (lang==='es' ? 'Tipos de Doc' : 'Doc Types'));
  st('upSt2Lbl', t.stepUpload || (lang==='es' ? 'Subir Archivos' : 'Upload Files'));
  st('upSt3Lbl', t.stepAnalyze || (lang==='es' ? 'Analizar' : 'Analyze'));
  st('browseFilesText', t.browseFiles);
  const fal = document.getElementById('filesAddedLabel');
  if(fal) fal.textContent = lang==='es' ? 'Archivos cargados' : 'Files added';
  if(typeof updateUploadStepper === 'function') updateUploadStepper();

  // ── Doc type buttons ───────────────────────────
  document.querySelectorAll('.doc-type-btn').forEach(btn => {
    const lbl = btn.querySelector('.dt-label');
    if(lbl) lbl.textContent = lang==='es' ? btn.dataset.es : btn.dataset.en;
  });

  // ── Loading section ────────────────────────────
  st('loadTitle', t.loadTitle);
  const loadingActive = document.getElementById('loading')?.classList.contains('show');
  if(!loadingActive){
    st('loadSub', t.loadSubInit || (lang==='es' ? 'Iniciando extracción...' : 'Starting extraction...'));
    st('progressLabel', t.progressLabelInit || (lang==='es' ? 'Extrayendo documentos' : 'Extracting documents'));
    st('progressPhase', t.progressPhaseInit || (lang==='es' ? 'Inicializando...' : 'Initializing...'));
  }

  // ── Results header labels ───────────────────────
  const rhCommEl = document.querySelector('.rh-commercial .rh-col-label');
  const rhTransEl = document.querySelector('.rh-transport .rh-col-label');
  const rhTotalLbl = document.querySelector('.rh-commercial .rh-val-group:nth-child(1) .rh-val-label');
  const rhPriceLbl = document.querySelector('.rh-commercial .rh-val-group:nth-child(2) .rh-val-label');
  if (rhCommEl) rhCommEl.textContent = t.rhCommercial || 'COMMERCIAL';
  if (rhTransEl) rhTransEl.textContent = t.rhTransport || 'TRANSPORT';
  if (rhTotalLbl) rhTotalLbl.textContent = t.rhTotalValue || 'Total Value';
  if (rhPriceLbl) rhPriceLbl.textContent = t.rhPriceMT || 'Price / MT';

  // ── Results static labels ──────────────────────
  st('s3title', t.s3title); st('s3sub', t.s3sub);
  st('coherenceTitle', t.coherenceTitle);
  st('ctableTitle', t.ctableTitle);
  st('th1', t.th1); st('th2', t.th2); st('th3', t.th3); st('th4', t.th4);
  st('perDocTitle', t.perDocTitle);
  st('spEmptyText', t.spSelectField);
  st('matrixLabel', t.matrixLabel);
  st('matrixLegend', t.matrixLegend);

  // ── Action buttons ─────────────────────────────
  st('dlPdfTxt', t.dlPdfTxt);
  // Only update save button text if not already saved
  const saveBtn = document.getElementById('btnSaveReport');
  if(saveBtn && !saveBtn.disabled) st('saveReportTxt', t.saveReportTxt);
  st('dlTxt', t.dlTxt);
  st('resetTxt', t.resetTxt);
  st('trackTxt', t.trackTxt);
  st('trackingTitle', t.trackingTitle);

  // ── Tracking banner (initial state only) ───────
  const tsbBanner = document.getElementById('trackingStatusBanner');
  const tsbInactive = !tsbBanner || tsbBanner.style.display === 'none';
  if(tsbInactive){
    st('tsbTitle', lang==='es' ? 'Verificación de Naviera' : 'Carrier Verification');
    st('tsbDetail', lang==='es' ? 'Aún no consultado' : 'Not yet queried');
  }

  // ── Files count ────────────────────────────────
  if(uploadedFiles && uploadedFiles.length > 0){
    const fc = document.getElementById('filesCount');
    if(fc){ fc.style.display='block'; fc.textContent = t.filesCount(uploadedFiles.length); }
  }

  // ── Re-render results if visible ───────────────
  const resultsEl = document.getElementById('results');
  if(resultsEl && resultsEl.classList.contains('show') && analysisResults && analysisResults.length > 0){
    setTimeout(() => {
      try {
        renderResults();
        // Also directly update summary label which may not re-render
        // Update summary label and text directly
        document.querySelectorAll('.summary-comment-label').forEach(el => {
          el.textContent = tx().summaryLabel;
        });
        document.querySelectorAll('.summary-comment-text').forEach(el => {
          if(_cachedSummary) el.textContent = translateSummary(_cachedSummary);
        });
      } catch(e) { console.warn('Lang re-render error:', e.message); }
    }, 10);
  }
  // ── History labels ──────────────────────────────
  st('histTitle', t.histTitle); st('histSub', t.histSub);
  const histInput = document.getElementById('histSearch');
  if(histInput) histInput.placeholder = t.histSearch;
  const hfAll = document.getElementById('histFilterAll');
  const hfOk = document.getElementById('histFilterOk');
  const hfWarn = document.getElementById('histFilterWarn');
  const hfErr = document.getElementById('histFilterErr');
  if(hfAll) hfAll.textContent = lang==='es' ? 'Todos los estados' : 'All statuses';
  if(hfOk) hfOk.textContent = lang==='es' ? '✓ Aprobado' : '✓ Approved';
  if(hfWarn) hfWarn.textContent = lang==='es' ? '⚠ Observaciones' : '⚠ Observations';
  if(hfErr) hfErr.textContent = lang==='es' ? '✗ Rechazado' : '✗ Rejected';

  // ── Auth modal labels ───────────────────────────
  st('authModalTitle', t.authTitle);
  st('authModalBtn', t.authBtn);
  st('termsError', t.authTermsErr);
  const termsText = document.getElementById('termsText');
  if(termsText) termsText.innerHTML = t.authTerms + ' <a href="/terms.html" target="_blank" style="color:var(--brown-mid);text-decoration:underline;">' + t.authTermsLink + '</a>';
  const signInP = document.getElementById('authSignInP');
  if(signInP) signInP.innerHTML = t.authSignIn + ' <a href="#" onclick="openClerkSignIn()" style="color:var(--brown-mid);">' + t.authSignInLink + '</a>';
  // ── Upgrade modal labels ──────────────────────
  st('upgradeTitle', t.upgradeTitle);
  st('upgradeBtnTxt', t.upgradeBtnTxt);

  // Refresh ghost button labels
  document.querySelectorAll('.ghost-label').forEach(el => {
    el.textContent = lang === 'es' ? 'Otro documento' : 'Any other docs';
  });
  if(typeof fillGhostButtons === 'function') fillGhostButtons();
}

function fillGhostButtons(){
  const grid = document.getElementById('docTypesGrid');
  if(!grid) return;
  // Remove existing ghosts
  grid.querySelectorAll('.ghost').forEach(el => el.remove());
  // Determine columns from screen width (matches CSS breakpoints)
  const w = window.innerWidth;
  const cols = w <= 600 ? 2 : w <= 900 ? 3 : 5;
  // Count only real (non-ghost) buttons
  const realBtns = Array.from(grid.children).filter(el => !el.classList.contains('ghost'));
  const total = realBtns.length;
  const remainder = total % cols;
  const needed = remainder === 0 ? 0 : cols - remainder;
  const ghostLabel = lang === 'es' ? 'Otro documento' : 'Any other docs';
  for(let i = 0; i < needed; i++){
    const btn = document.createElement('button');
    btn.className = 'doc-type-btn ghost';
    btn.innerHTML = '<span class="dt-dot"></span><span class="dt-label ghost-label">' + ghostLabel + '</span>';
    btn.setAttribute('data-ghost', 'true');
    btn.setAttribute('disabled', 'true');
    grid.appendChild(btn);
  }
}

function toggleDocTypeAccordion() { /* no-op — accordion removed */ }
function updateDocTypeChips() { /* no-op — chips removed */ }

function updateUploadStepper() {
  const activeTypes = document.querySelectorAll('.doc-type-btn.active').length;
  const hasFiles = uploadedFiles.length > 0;

  // Stepper states
  const s2 = document.getElementById('upSt2');
  const l2 = document.getElementById('upStLine2');
  if (s2) {
    s2.className = hasFiles ? 'up-st up-st-done' : 'up-st up-st-active';
    const circ = s2.querySelector('.up-st-circ');
    if (circ) circ.textContent = hasFiles ? '✓' : '2';
  }
  if (l2) l2.className = hasFiles ? 'up-st-line up-st-line-done' : 'up-st-line';
  const s3 = document.getElementById('upSt3');
  if (s3) s3.className = hasFiles ? 'up-st up-st-active' : 'up-st';

  // Subtitle
  const sub = document.getElementById('uploadPanelSub');
  if (sub) {
    const tl = lang==='es' ? activeTypes+' tipos seleccionados' : activeTypes+' type'+(activeTypes===1?'':'s')+' selected';
    const fl = lang==='es' ? ' · Arrastra archivos o selecciona' : ' · Drag files or browse';
    sub.textContent = tl + fl;
  }

  // Files header
  const fh = document.getElementById('filesListHeader');
  const fc2 = document.getElementById('filesAddedCount');
  if (fh) fh.style.display = hasFiles ? 'flex' : 'none';
  if (fc2) fc2.textContent = uploadedFiles.length + ' / ~' + activeTypes;

  // Render doc type chips
  renderDocTypeChips();
}

function renderDocTypeChips() {
  const chips = document.getElementById('upDtChips');
  if (!chips) return;
  const active = document.querySelectorAll('.doc-type-btn.active');
  const editLabel = lang==='es' ? '+ EDITAR' : '+ EDIT TYPES';
  let html = '';
  active.forEach(btn => {
    const lbl = btn.querySelector('.dt-label');
    const text = lbl ? lbl.textContent : '';
    html += '<span class="up-dt-chip"><span class="chip-dot"></span>' + text + '</span>';
  });
  html += '<span class="up-dt-chip-edit" onclick="toggleDocTypeEdit()">' + editLabel + '</span>';
  chips.innerHTML = html;
}

function toggleDocTypeEdit() {
  const grid = document.getElementById('docTypesGrid');
  if (!grid) return;
  grid.classList.toggle('open');
  if (grid.classList.contains('open')) grid.style.display = 'flex';
  else grid.style.display = 'none';
}

async function addFiles(files){
  try { await loadHeavyLibs(); } catch(e){ console.warn('Lib load:', e.message); }

  for(const f of files){
    if(uploadedFiles.find(u=>u.name===f.name&&u.size===f.size)) continue;

    // Split multi-document PDFs using AI page classification
    if(f.name.toLowerCase().endsWith('.pdf')){
      const pages = await splitPdfToPages(f);
      if(pages && pages.length > 1){
        const docTypes = pages.filter(p => p._detectedDocType).map(p => p._detectedDocType);
        if(location?.hostname === 'localhost') console.log(`AI split: ${pages.length} documents`);
        for(const pageEntry of pages){
          if(!uploadedFiles.find(u=>u.name===pageEntry.name)) uploadedFiles.push(pageEntry);
        }
        renderFiles();
        continue;
      }
    }

    const entry={file:f,name:f.name,size:f.size};
    if(isExcel(f.name)){try{entry.textContent=await excelToText(f);}catch(e){entry.textContent=`[Error: ${e.message}]`;}}
    else if(isWord(f.name)){try{entry.textContent=await wordToText(f);}catch(e){entry.textContent=`[Error: ${e.message}]`;}}
    uploadedFiles.push(entry);
  }
  renderFiles();
}

function renderFiles(){
  const list=document.getElementById('filesList');
  const fc=document.getElementById('filesCount');
  // Show guest counter if not logged in
  const guestBar = document.getElementById('guestCounterBar');
  const guestTxt = document.getElementById('guestCounterText');
  const guestLink = document.getElementById('guestUpgradeLink');
  if(guestBar && !isLoggedIn()){
    const used = getGuestCount();
    const remaining = Math.max(0, GUEST_LIMIT - used);
    guestBar.style.display = 'block';
    if(guestTxt){
      guestTxt.textContent = lang === 'es'
        ? `${remaining} de ${GUEST_LIMIT} análisis gratuitos restantes`
        : `${remaining} of ${GUEST_LIMIT} free analyses remaining`;
    }
    if(guestLink){
      guestLink.textContent = lang === 'es' ? 'Mejorar plan →' : 'Upgrade for more →';
    }
    // Turn red when 0 remaining
    guestBar.style.background = remaining === 0 ? '#fdf0ee' : 'var(--cream)';
    guestBar.style.borderColor = remaining === 0 ? 'var(--red-light)' : 'var(--border-light)';
    if(guestTxt) guestTxt.style.color = remaining === 0 ? 'var(--red)' : 'var(--text-mid)';
  } else if(guestBar){
    guestBar.style.display = 'none';
  }
  list.innerHTML='';
  uploadedFiles.forEach((f,i)=>{
    const ext=f.name.split('.').pop().toUpperCase();
    const size=f.size<1048576?(f.size/1024).toFixed(1)+' KB':(f.size/1048576).toFixed(1)+' MB';
    const isPdfPage = !!f._pdfPage;
    const displayName = f._pdfSource
      ? f._pdfSource
      : f.name;
    const pageLabel = f._pdfPage
      ? `<span style="font-size:0.68rem;background:#e8d9c0;color:#7a5230;padding:2px 8px;border-radius:10px;letter-spacing:0.04em;font-family:'Raleway',sans-serif;">p.${f._pdfPage}</span>`
      : '';
    const displayExt = isPdfPage ? 'PDF' : ext;
    const detected = f._detectedDocType || detectDocType(f.name);
    const detectedHtml = detected
      ? `<span class="file-detected-type">\u2713 ${detected}</span>`
      : '';
    const itemCls = detected ? 'file-item fi-detected' : 'file-item';
    list.innerHTML+=`<div class="${itemCls}">
      <div class="file-icon">${getIcon(f.name, isPdfPage)}</div>
      <div class="file-info">
        <div class="file-name">${displayName}${f._pdfPage ? ` · <em style="opacity:0.5;font-size:0.85em;">page ${f._pdfPage}</em>` : ''}</div>
        <div class="file-size">${displayExt} · ${size}</div>
      </div>
      ${getBadge(f.name)}${pageLabel}${detectedHtml}
      <button class="file-del" onclick="removeFile(${i})">✕</button>
    </div>`;
  });
  const n=uploadedFiles.length;
  if(n>0){fc.style.display='block';fc.textContent=tx().filesCount(n);}
  else{fc.style.display='none';}
  document.getElementById('analyzeBtn').disabled=n===0;
  const ab = document.getElementById('analyzeBtn');
  if(ab) ab.classList.toggle('ready', n > 0);
  updateUploadStepper();
}

function removeFile(i){uploadedFiles.splice(i,1);renderFiles();}

function setStep(n){
  for(let i=1;i<=4;i++){
    const el=document.getElementById(`ps${i}`);
    if(!el) continue;
    el.classList.remove('active','done');
    if(i<n) el.classList.add('done');
    else if(i===n) el.classList.add('active');
  }
  // Hide hero and progress bar on results/download steps
  const hero = document.querySelector('.hero');
  const pbar = document.getElementById('progressBar');
  if(hero) hero.style.display = (n >= 3) ? 'none' : '';
  if(pbar) pbar.style.display = 'none'; // always hidden — replaced by up-stepper
  const upStepper = document.getElementById('upStepper');
  if(upStepper) upStepper.style.display = (n >= 3) ? 'none' : '';
  const footer = document.querySelector('footer');
  if(footer) footer.style.display = (n >= 3) ? 'none' : '';
}

function setProgress(pct, phase){
  document.getElementById('progressFill').style.width = pct+'%';
  document.getElementById('progressPct').textContent = Math.round(pct);
  if(phase) document.getElementById('progressPhase').textContent = phase;
  // Sync to tech progress bar
  var _tpf = document.getElementById('techProgressFill'); if(_tpf) _tpf.style.width = pct+'%';
  var _tpp = document.getElementById('techProgressPct'); if(_tpp) _tpp.textContent = Math.round(pct);
}

function buildDocList(){
  const list = document.getElementById('docProgressList');
  list.innerHTML = '';
  uploadedFiles.forEach((f,i)=>{
    const tag = isExcel(f.name)?'[Excel]':isWord(f.name)?'[Word]':'';
    list.innerHTML += `<div class="doc-progress-item" id="dpi${i}">
      <span class="doc-pi-icon">${getIcon(f.name)}</span>
      <span class="doc-pi-name">${f.name} ${tag}</span>
      <span class="doc-pi-status" id="dps${i}">${lang==='es'?'Pendiente':'Pending'}</span>
    </div>`;
  });
}

function setDocStatus(i, status){
  const item = document.getElementById(`dpi${i}`);
  const lbl  = document.getElementById(`dps${i}`);
  if(!item||!lbl) return;
  item.classList.remove('active','done');
  if(status==='active'){
    item.classList.add('active');
    lbl.textContent = lang==='es'?'Analizando...':'Analyzing...';
  } else if(status==='done'){
    item.classList.add('done');
    lbl.textContent = lang==='es'?'Listo ✓':'Done ✓';
  }
}

// Build auth headers for every call to /.netlify/functions/claude
// Logged-in users send their Clerk JWT; guests send X-Guest-Token: guest
async function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (isLoggedIn() && window.Clerk?.session) {
    try {
      const token = await window.Clerk.session.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch(e) { /* non-blocking */ }
  } else {
    headers['X-Guest-Token'] = 'guest';
  }
  return headers;
}

// Shared fetch-with-retry for Claude API calls (retries on 429, 500, 503, 504)
async function _callClaudeWithRetry(model, system, content, maxTokens, retries=2) {
  const headers = await buildAuthHeaders();
  const body = JSON.stringify({model, max_tokens:maxTokens, system, messages:[{role:'user',content}]});
  for(let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch('/.netlify/functions/claude', { method:'POST', headers, body });
      const text = await resp.text();
      if(text.trim().startsWith('<')) {
        if(attempt < retries) { await new Promise(r => setTimeout(r, 1000 * (attempt+1))); continue; }
        throw new Error(resp.status === 504 ? 'Request timeout — document may be too large' : `Server error ${resp.status}`);
      }
      let data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response from server'); }
      // Retry on rate limit or server errors
      if(data.error && [429, 500, 503, 529].includes(resp.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, 1500 * (attempt+1)));
        continue;
      }
      if(data.error) throw new Error(data.error.message||'API error');
      return (data.content?.map(b=>b.text||'').join('')||'').replace(/```json|```/g,'').trim();
    } catch(e) {
      if(attempt < retries && !e.message.includes('Authentication')) {
        await new Promise(r => setTimeout(r, 1000 * (attempt+1)));
        continue;
      }
      throw e;
    }
  }
}

async function callClaudeHaiku(system,content,maxTokens=2000){
  return _callClaudeWithRetry('claude-haiku-4-5-20251001', system, content, maxTokens);
}

async function callClaude(system,content,maxTokens=2000){
  return _callClaudeWithRetry('claude-sonnet-4-20250514', system, content, maxTokens);
}

function safeJSON(text){
  if(!text) return null;
  // Try direct parse
  try{return JSON.parse(text);}catch(e){}
  // Try extracting from first { to last }
  const s=text.indexOf('{'), en=text.lastIndexOf('}');
  if(s>=0&&en>s){try{return JSON.parse(text.slice(s,en+1));}catch(e){}}
  // Try fixing truncated JSON by balancing braces
  try{
    let f=text.slice(text.indexOf('{'));
    const opens=(f.match(/\{/g)||[]).length;
    const closes=(f.match(/\}/g)||[]).length;
    if(opens>closes) f+='}'.repeat(opens-closes);
    const parsed = JSON.parse(f);
    if(parsed) return parsed;
  }catch(e){}
  // Last resort: extract just the summary and status if JSON is too broken
  try{
    const statusMatch = text.match(/"overallStatus"\s*:\s*"([^"]+)"/);
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
    if(statusMatch || summaryMatch){
      return {
        overallStatus: statusMatch?.[1] || 'warning',
        summary: summaryMatch?.[1] || '',
        setValues: {},
        coherenceIssues: [],
        perDocumentStatus: {}
      };
    }
  }catch(e){}
  return null;
}

// ══════════════════════════════════════
// LAZY-LOAD HEAVY LIBS (pdf.js, xlsx, mammoth)
// Called once on first analysis — not at page load
// ══════════════════════════════════════

function loadHeavyLibs() {
  if(_heavyLibsLoaded) return Promise.resolve();
  if(_heavyLibsLoading) return _heavyLibsLoading;
  _heavyLibsLoading = new Promise((resolve, reject) => {
    const libs = [
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
    ];
    let loaded = 0;
    libs.forEach(src => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { loaded++; if(loaded === libs.length){ _heavyLibsLoaded = true; resolve(); } };
      s.onerror = () => reject(new Error('Failed to load: ' + src));
      document.head.appendChild(s);
    });
  });
  return _heavyLibsLoading;
}

async function startAnalysis(){
  if(uploadedFiles.length === 0) return;
  _analysisInProgress = true;

  // ── LOAD HEAVY LIBS ON FIRST USE ───────────────
  try {
    await loadHeavyLibs();
  } catch(e) {
    console.error('Library load failed:', e.message);
    alert(tx().libLoadErr);
    return;
  }

  // ── CHECK AUTH / GUEST LIMIT ───────────────────
  const loggedIn = isLoggedIn();
  const guestCount = getGuestCount();

  if(!loggedIn){
    try {
      const rlResp = await fetch('/.netlify/functions/rate-limit', {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ action: 'check' }),
      });
      const rlData = await rlResp.json();
      if(!rlData.allowed){
        showAuthModal('guest_limit');
        return;
      }
    } catch(e) {
      // Fallback to localStorage if server check fails
      if(guestCount >= GUEST_LIMIT){
        showAuthModal('guest_limit');
        return;
      }
    }
  }

  // If logged in, check plan limits
  if(loggedIn){
    try {
      const userId = window.__clerk_user.id;
      const email = window.__clerk_user.primaryEmailAddress?.emailAddress;
      const resp = await fetch('/.netlify/functions/user', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action:'get', clerk_id: userId, email })
      });
      const userData = await resp.json();
      if(!userData.can_analyze){
        showUpgradeModal(userData.plan, userData.validations_limit);
        return;
      }
    } catch(e){
      console.warn('Plan check failed:', e.message);
      alert(lang==='es' ? 'No se pudo verificar tu plan. Intenta de nuevo.' : 'Could not verify your plan. Please try again.');
      return;
    }
  }

  // Hide upload, show loading
  const uploadSec = document.getElementById('uploadSection');
  const loadingSec = document.getElementById('loading');
  if(uploadSec) uploadSec.style.display='none';
  if(loadingSec) loadingSec.classList.add('show');
  // Show tech progress, hide old cacao loader
  var _tw = document.getElementById('techProgressWrap');
  if (_tw) { _tw.style.display = 'block'; if(loadingSec) { loadingSec.style.display = 'none'; loadingSec.classList.remove('show'); } }
  var _al = document.getElementById('activityLog');
  if (_al) _al.innerHTML = '';
  setStep(2);
  analysisResults = [];
  coherenceResult = null;

  const sub = document.getElementById('loadSub');
  const lbl = document.getElementById('progressLabel');
  const total = uploadedFiles.length + 1;
  let done = 0;

  const tick = (phase) => {
    done++;
    setProgress(Math.min(98, Math.round((done/total)*100)), phase);
  };

  const setSub = (txt) => { if(sub) sub.textContent = txt; };
  const setLbl = (txt) => { if(lbl) lbl.textContent = txt; };

  try {
    buildDocList();
    setProgress(0, lang==='es'?'Inicializando...':'Initializing...');
    setLbl(lang==='es'?'Extrayendo documentos':'Extracting documents');
    if(typeof addActivityEntry==='function') addActivityEntry(lang==='es'?'Iniciando extracción de '+uploadedFiles.length+' documento(s)...':'Starting extraction of '+uploadedFiles.length+' document(s)...');

    const extractedDocs = {};
    // Extract all documents in parallel — much faster than sequential
    uploadedFiles.forEach((_, i) => setDocStatus(i, 'active'));
    setSub(lang==='es'?'Leyendo todos los documentos en paralelo...':'Reading all documents in parallel...');
    setProgress(10, lang==='es'?'Extrayendo...':'Extracting...');

    const extractPromises = uploadedFiles.map((e, i) =>
      extractDoc(e).then(docs => {
        const docsArr = Array.isArray(docs) ? docs : [docs];
        extractedDocs[e.name] = docsArr;
        docsArr.forEach(d => { d._filename = e.name; analysisResults.push(d); });



        setDocStatus(i, 'done', docsArr.filter(d=>!d._err).length > 1 ? docsArr.filter(d=>!d._err).length : null);
        const done = Object.keys(extractedDocs).length;
        setProgress(10 + Math.round((done/uploadedFiles.length)*60), `${done}/${uploadedFiles.length} ${lang==='es'?'listos':'done'}`);
        if(typeof addActivityEntry==='function') addActivityEntry('✓ ' + e.name + (docsArr.filter(d=>!d._err).length > 1 ? ' ('+docsArr.filter(d=>!d._err).length+' docs)' : ''), 'done');
      }).catch(err => {
        extractedDocs[e.name] = [{docType:e.name,_err:true,_filename:e.name}];
        setDocStatus(i, 'done');
      })
    );
    await Promise.all(extractPromises);

    // ── MERGE: combine docs from split PDF chunks ────────────────────────
    // When a large PDF is split into chunks, the same document type may appear
    // in multiple chunks. Merge them by _pdfSource + docType.
    setLbl(lang==='es'?'Combinando documentos':'Merging documents');
    setSub(lang==='es'?'Agrupando páginas del mismo documento...':'Grouping pages from same document...');
    setProgress(72, lang==='es'?'Combinando...':'Merging...');
    if(typeof addActivityEntry==='function') addActivityEntry(lang==='es'?'Combinando documentos multi-página...':'Merging multi-page documents...');

    const pdfSources = {};
    analysisResults.forEach(doc => {
      if (!doc._pdfSource || doc._err) return;
      const key = doc._pdfSource;
      if (!pdfSources[key]) pdfSources[key] = [];
      pdfSources[key].push(doc);
    });

    for (const [source, docs] of Object.entries(pdfSources)) {
      if (docs.length <= 1) continue; // Only one chunk, nothing to merge

      // Group by normalized docType within this PDF source
      const typeGroups = {};
      docs.forEach(d => {
        const dt = normalizeDocType(d.docType || '');
        if (!dt || dt === source) return; // Skip unnamed/error docs
        if (!typeGroups[dt]) typeGroups[dt] = [];
        typeGroups[dt].push(d);
      });

      // Merge each group into one doc
      for (const [dt, group] of Object.entries(typeGroups)) {
        if (group.length <= 1) continue;
        const merged = group[0]; // Base doc
        for (let i = 1; i < group.length; i++) {
          const other = group[i];
          Object.keys(other).forEach(k => {
            if (k.startsWith('_')) return;
            const mv = merged[k], ov = other[k];
            // Fill missing fields
            if ((mv == null || mv === '' || mv === 'null') && ov != null && ov !== '' && ov !== 'null') {
              merged[k] = ov;
            }
            // For numeric totals, take larger value
            if (['bagCount','netWeight','grossWeight'].includes(k) && ov && mv) {
              const on = parseFloat(String(ov).replace(/[^0-9.]/g,''));
              const mn = parseFloat(String(mv).replace(/[^0-9.]/g,''));
              if (!isNaN(on) && !isNaN(mn) && on > mn) merged[k] = ov;
            }
            // For arrays, merge unique values
            if (Array.isArray(ov) && Array.isArray(mv)) {
              merged[k] = [...new Set([...mv, ...ov])];
            } else if (Array.isArray(ov) && !Array.isArray(mv)) {
              merged[k] = ov;
            }
          });
          // Remove the duplicate from analysisResults
          const idx = analysisResults.indexOf(other);
          if (idx >= 0) analysisResults.splice(idx, 1);
          // Also remove from extractedDocs
          if (extractedDocs[other._filename]) {
            const arr = extractedDocs[other._filename];
            const di = arr.indexOf(other);
            if (di >= 0) arr.splice(di, 1);
          }
        }
      }
    }

    if(location?.hostname === 'localhost') console.log('After merge:', analysisResults.length, 'docs');

    // ── VERIFICATION PASS: re-extract with Sonnet when Haiku missed critical fields ──
    setLbl(lang==='es'?'Verificando campos críticos':'Verifying critical fields');
    setSub(lang==='es'?'Revisando extracción...':'Checking extraction...');
    setProgress(75, lang==='es'?'Verificando...':'Verifying...');
    var _tlbl2 = document.getElementById('techProgressLabel'); if(_tlbl2) _tlbl2.textContent = lang==='es'?'Verificando campos':'Verifying fields';
    if(typeof addActivityEntry==='function') addActivityEntry(lang==='es'?'Verificando campos críticos...':'Verifying critical fields...');

    // Define which doc types should have which fields
    const shouldHave = {
      containers: ['packing','lista de empaque','bill of lading','conocimiento','bl','waybill'],
      invoiceNumber: ['invoice','factura','fact','packing','bill of lading','conocimiento','certificate of origin','certificado de origen','cert orig'],
      totalAmount: ['invoice','factura','fact'],
      lotNumbers: ['packing','bill of lading','conocimiento','certificate of origin','certificado de origen','phyto','fitosanit','quality','calidad'],
    };

    const needsReextract = [];
    analysisResults.forEach((doc, idx) => {
      if(doc._err) return;
      const dt = (doc.docType||'').toLowerCase();
      const fn = (doc._filename||'').toLowerCase();
      const match = (keywords) => keywords.some(k => dt.includes(k) || fn.includes(k));

      let missing = false;
      // Check containers
      if(match(shouldHave.containers)) {
        const hasC = doc.containerNumbers?.length > 0 && doc.containerNumbers.some(c => /^[A-Z]{4}\d{6,7}$/i.test(String(c).trim()));
        if(!hasC) missing = true;
      }
      // Check invoice number
      if(match(shouldHave.invoiceNumber)) {
        if(!doc.invoiceNumber || doc.invoiceNumber === 'null') missing = true;
      }
      // Check total amount (for invoices)
      if(match(shouldHave.totalAmount)) {
        if(!doc.totalAmount || doc.totalAmount === 'null') missing = true;
      }
      // Check lot numbers
      if(match(shouldHave.lotNumbers)) {
        if(!doc.lotNumbers || doc.lotNumbers.length === 0) missing = true;
      }

      if(missing) needsReextract.push({ doc, idx });
    });

    if(needsReextract.length > 0) {
      setSub(lang==='es'?'Re-extrayendo ' + needsReextract.length + ' doc(s) con Sonnet...':'Re-extracting ' + needsReextract.length + ' doc(s) with Sonnet...');
      setProgress(75, lang==='es'?'Re-extrayendo...':'Re-extracting...');

      // Re-extract full doc with Sonnet (more accurate than Haiku for complex docs)
      const reextractPromises = needsReextract.map(({ doc }) => {
        const entry = uploadedFiles.find(f => f.name === doc._filename);
        if(!entry) return Promise.resolve();
        return (async () => {
          try {
            const result = await extractDoc(entry);
            // extractDoc now uses Haiku — call Sonnet directly for retry
            let content;
            if(entry.textContent) {
              content = 'Extract all data from this cacao/coffee export document:\n\n' + entry.textContent;
            } else {
              const b64 = await toBase64(entry.file);
              const mt = mediaType(entry.file);
              content = [];
              if(mt==='application/pdf') content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}});
              else content.push({type:'image',source:{type:'base64',media_type:mt,data:b64}});
              content.push({type:'text',text:'Extract all data from this cacao/coffee export document. Pay special attention to: containerNumbers, invoiceNumber, lotNumbers, totalAmount.'});
            }
            const retrySystem = 'You are an expert in cacao and coffee export documents. Extract ALL fields from this document. Return a JSON object. Pay special attention to: containerNumbers (format: 4 letters + 6-7 digits), sealNumbers, invoiceNumber, lotNumbers, bagCount, netWeight, grossWeight, totalAmount, pricePerUnit, vesselName, portOfLoading, portOfDischarge, blNumber, voyageNumber, shipper, consigneeName, destinationCountry, originCountry. Use null for fields not found.';
            const raw = await callClaude(retrySystem, content, 3000);
            let parsed;
            try {
              const cleaned = raw.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
              parsed = JSON.parse(cleaned);
              if(Array.isArray(parsed)) parsed = parsed[0];
            } catch(e) {
              const obj = raw.match(/(\{.*\})/s);
              if(obj) try { parsed = JSON.parse(obj[1]); } catch(e2) {}
            }
            if(parsed) {
              // Merge: only fill in missing fields, don't overwrite existing
              Object.keys(parsed).forEach(k => {
                if(k.startsWith('_')) return;
                const existing = doc[k];
                const newVal = parsed[k];
                if((!existing || existing === 'null' || (Array.isArray(existing) && existing.length === 0)) &&
                   newVal && newVal !== 'null' && newVal !== null) {
                  doc[k] = newVal;
                }
              });
              cleanExtractedFields(doc);
            }
          } catch(e) { console.warn('Sonnet re-extract failed for', doc._filename, ':', e.message); }
        })();
      });
      await Promise.all(reextractPromises);
    }

    setLbl(lang==='es'?'Verificando coherencia':'Verifying coherence');
    setSub(lang==='es'?'Comparando valores entre documentos...':'Cross-checking values across documents...');
    if(typeof addActivityEntry==='function') addActivityEntry(lang==='es'?'Analizando coherencia entre documentos — esto puede tomar 30-60s...':'Analyzing coherence across documents — this may take 30-60s...');
    setProgress(85, lang==='es'?'Analizando coherencia...':'Analyzing coherence...');
    var _tlbl = document.getElementById('techProgressLabel'); if(_tlbl) _tlbl.textContent = lang==='es'?'Analizando coherencia':'Analyzing coherence';

    // Filter out failed extractions before coherence
  const cleanDocs = {};
  Object.entries(extractedDocs).forEach(([fn, arr]) => {
    const good = (Array.isArray(arr) ? arr : [arr]).filter(d => !d._err);
    if(good.length > 0) cleanDocs[fn] = good;
  });
  coherenceResult = await analyzeCoherence(cleanDocs);
    _cachedSummary = coherenceResult?.summary || null;

    // Track usage — only if analysis produced a valid result
    // A valid result must have overallStatus set to approved/warning/rejected
    // This prevents consuming a validation when the analysis times out or fails silently
    const validStatuses = ['approved', 'warning', 'rejected'];
    const analysisSucceeded = coherenceResult &&
      validStatuses.includes(coherenceResult.overallStatus) &&
      Object.keys(cleanDocs).length > 0;

    if(analysisSucceeded){
      if(isLoggedIn()){
        const userId = window.__clerk_user.id;
        const email = window.__clerk_user.primaryEmailAddress?.emailAddress;
        fetch('/.netlify/functions/user', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'increment', clerk_id: userId, email })
        }).catch(e => console.warn('Usage increment failed:', e.message));
      } else {
        incGuestCount();
        fetch('/.netlify/functions/rate-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'increment' }),
        }).catch(() => {});
      }
    } else {
      console.warn('Analysis did not produce valid result — usage not incremented.');
    }
    // Save to history — moved after renderResults (see below)
    setProgress(100, lang==='es'?'Análisis completo ✓':'Analysis complete ✓');
    if(typeof addActivityEntry==='function') addActivityEntry(lang==='es'?'✓ Análisis completo':'✓ Analysis complete', 'done');
    await new Promise(r => setTimeout(r, 600));
    _analysisInProgress = false;

  } catch(err) {
    _analysisInProgress = false;
    console.error('Analysis error:', err);
    const userMsg = err.message.includes('timeout') ? (lang==='es'?'Tiempo de espera agotado — intenta con menos archivos':'Request timeout — try with fewer files')
      : err.message.includes('Rate limit') ? (lang==='es'?'Límite alcanzado. Crea una cuenta gratuita.':'Rate limit reached. Create a free account.')
      : (lang==='es'?'Error en el análisis. Intenta de nuevo.':'Analysis error. Please try again.');
    setSub(userMsg);
    await new Promise(r => setTimeout(r, 2000));
    if(loadingSec) loadingSec.classList.remove('show');
    var _tw2 = document.getElementById('techProgressWrap'); if (_tw2) _tw2.style.display = 'none';
    if(uploadSec) uploadSec.style.display='block';
    setStep(1);
    return;
  }

  if(loadingSec) loadingSec.classList.remove('show');
  var _tw3 = document.getElementById('techProgressWrap'); if (_tw3) _tw3.style.display = 'none';
  setStep(3);
  if(analysisResults.length > 0){
    renderResults();
    // Populate workspace left panel
    if(typeof renderDocumentStack==='function') renderDocumentStack(analysisResults, coherenceResult);
    // Save to history AFTER renderResults sets lastFinalErrors/lastFinalWarnings
    // Report saved manually via "Save Report" button — not auto-saved
  } else {
    // Nothing extracted — show upload again with error message
    if(uploadSec) uploadSec.style.display='block';
    setStep(1);
    alert(lang==='es'?'No se pudo analizar ningún documento. Verifica los archivos e intenta de nuevo.':'Could not analyze any documents. Please check your files and try again.');
  }
}

function safeEl(id){ return document.getElementById(id); }
function safeReset(id, prop, val){ const el=safeEl(id); if(el) el[prop]=val; }
function safeStyle(id, prop, val){ const el=safeEl(id); if(el) el.style[prop]=val; }
function safeClass(id, method, cls){ const el=safeEl(id); if(el) el.classList[method](cls); }

function resetApp(){
  uploadedFiles=[];analysisResults=[];coherenceResult=null;
  var _twr = document.getElementById('techProgressWrap'); if(_twr) _twr.style.display='none';
  var _alr = document.getElementById('activityLog'); if(_alr) _alr.innerHTML='';
  var _wdl = document.getElementById('wsDocList'); if(_wdl) _wdl.innerHTML='';
  var _wsn = document.getElementById('wsScoreNum'); if(_wsn) _wsn.innerHTML='&mdash;';
  safeReset('filesList','innerHTML','');
  safeStyle('filesCount','display','none');
  const ab=safeEl('analyzeBtn'); if(ab){ ab.disabled=true; ab.classList.remove('ready'); }
  safeStyle('uploadSection','display','block');
  safeClass('results','remove','show');
  safeReset('loadLog','innerHTML','');
  safeReset('docProgressList','innerHTML','');
  safeReset('trackingSection','innerHTML','');
  safeStyle('trackingSection','display','none');
  safeStyle('trackingSectionTitle','display','none');
  safeStyle('trackingStatusBanner','display','none');
  safeStyle('multiDocNotice','display','none');
  safeStyle('criticalBanner','display','none');
  safeStyle('alertsSection','display','none');
  safeStyle('alertsErrGroup','display','none');
  safeStyle('alertsWarnGroup','display','none');
  safeStyle('finPanel','display','none');
  safeStyle('actionItemsSection','display','none');
  safeStyle('summaryCard','display','none');
  safeStyle('blStrip','display','none');
  safeStyle('resultsHeader','display','none');
  safeStyle('actionRequired','display','none');
  safeReset('arBody','innerHTML','');
  const bar2=safeEl('trackingStatusBar'); if(bar2) bar2.className='tracking-status-bar pending';
  // Reset collapsible table and perdoc
  const rtb=safeEl('rTableBody'); if(rtb) rtb.classList.remove('open');
  const rtc=safeEl('rTableChev'); if(rtc) rtc.classList.remove('open');
  const rpb=safeEl('rPerdocBody'); if(rpb) rpb.classList.remove('open');
  const rpc=safeEl('rPerdocChev'); if(rpc) rpc.classList.remove('open');
  safeStyle('histDetail','display','none');
  safeStyle('historySection','display','none');
  // Reset save button
  const saveBtn = safeEl('btnSaveReport');
  if(saveBtn){ saveBtn.disabled=false; saveBtn.style.opacity='1'; saveBtn.style.background='none'; saveBtn.style.borderColor='var(--tan)'; saveBtn.style.color='var(--tan)'; }
  const saveTxt = safeEl('saveReportTxt');
  if(saveTxt) saveTxt.textContent = tx().saveReportTxt || 'Save Report';
  setStep(1);
  window.scrollTo({top:0,behavior:'smooth'});
}

function detectShippingLine(bl){
  if(!bl) return null;
  const b = bl.toUpperCase();
  if(b.startsWith('MAEU')||b.startsWith('MSKU')||b.startsWith('SEAU')) return 'Maersk';
  if(b.startsWith('CMDU')||b.startsWith('CMDA')||b.startsWith('CMAU')) return 'CMA CGM';
  if(b.startsWith('MSCU')||b.startsWith('MEDU')) return 'MSC';
  if(b.startsWith('HLCU')||b.startsWith('HLXU')) return 'Hapag-Lloyd';
  if(b.startsWith('EGLV')) return 'Evergreen';
  if(b.startsWith('COSU')||b.startsWith('CBHU')) return 'COSCO';
  if(b.startsWith('ONEY')) return 'ONE';
  if(b.startsWith('ZIMU')) return 'ZIM';
  if(b.startsWith('HDMU')) return 'HMM';
  return 'Unknown';
}

async function fetchTracking(blNumber, shippingLine){
  // Build URL with query params for GET request (avoids CORS preflight)
  const url = MAKE_WEBHOOK
    + '?bl_number=' + encodeURIComponent(blNumber)
    + '&shipping_line=' + encodeURIComponent(shippingLine);

  const resp = await fetch(url, { method: 'GET' });
  if(!resp.ok) throw new Error('HTTP ' + resp.status);
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Invalid response: ' + text.slice(0,100)); }
}

function val(data, ...keys){ for(const k of keys){ if(data[k]&&data[k]!==''&&data[k]!=='N/A') return data[k]; } return '—'; }

function checkMatch(trackVal, docVal){
  if(!trackVal||trackVal==='—'||!docVal||docVal==='null') return null; // can't compare
  const t=trackVal.toLowerCase().trim();
  const d=docVal.toLowerCase().trim();
  return t.includes(d)||d.includes(t)||t===d;
}

function renderTrackingBox(blNumber, shippingLine, data, docData){
  const t = tx();
  const sec = document.getElementById('trackingSection');

  // Extract fields — handle multiple possible JSONCargo response formats
  const status  = val(data,'status','shipmentStatus','tracking_status','state','shipment_status');
  const vessel  = val(data,'vessel','vesselName','vessel_name','pod_vessel','vessel_name_actual');
  const voyage  = val(data,'voyage','voyageNumber','voyage_number','voyage_no');
  const eta     = val(data,'eta','ETA','estimated_arrival','pod_eta','eta_final','etaFinal');
  const atd     = val(data,'atd','ATD','actual_departure','pol_atd','atdFinal');
  const pol     = val(data,'pol','portOfLoading','port_of_loading','origin_port','loadingPort','pol_name');
  const pod     = val(data,'pod','portOfDischarge','port_of_discharge','dest_port','dischargePort','pod_name');
  const containers = data.containers||data.container_numbers||data.containerNumbers||[];
  const blVerified = data.bl_number||data.blNumber||blNumber;

  // ── VALIDATION CHECKS ──
  const checks = [];

  // BL verified by carrier
  checks.push({
    label: lang==='es'?'BL verificado con naviera':'BL verified with carrier',
    docVal: blNumber,
    trackVal: blVerified,
    match: true, // if we got a response, the BL exists
    critical: true
  });

  // Vessel
  const vesselMatch = checkMatch(vessel, docData?.vesselName);
  if(vessel!=='—') checks.push({
    label: t.trackingVessel,
    docVal: docData?.vesselName||'—',
    trackVal: vessel,
    match: vesselMatch===null ? true : vesselMatch,
    critical: false
  });

  // Port of Loading
  const polMatch = checkMatch(pol, docData?.portOfLoading);
  if(pol!=='—') checks.push({
    label: t.trackingPOL,
    docVal: docData?.portOfLoading||'—',
    trackVal: pol,
    match: polMatch===null ? true : polMatch,
    critical: false
  });

  // Port of Discharge
  const podMatch = checkMatch(pod, docData?.portOfDischarge);
  if(pod!=='—') checks.push({
    label: t.trackingPOD,
    docVal: docData?.portOfDischarge||'—',
    trackVal: pod,
    match: podMatch===null ? true : podMatch,
    critical: false
  });

  // Containers
  if(containers.length && docData?.containerNumbers?.length){
    const docContainers = Array.isArray(docData.containerNumbers) ? docData.containerNumbers : [docData.containerNumbers];
    const apiContainers = Array.isArray(containers) ? containers : [containers];
    const containerStr = apiContainers.slice(0,3).join(', ');
    const docContainerStr = docContainers.slice(0,3).join(', ');
    const cMatch = docContainers.some(dc => apiContainers.some(ac =>
      String(ac).toLowerCase().includes(String(dc).toLowerCase()) ||
      String(dc).toLowerCase().includes(String(ac).toLowerCase())
    ));
    checks.push({
      label: t.trackingContainer,
      docVal: docContainerStr,
      trackVal: containerStr,
      match: cMatch,
      critical: true
    });
  }

  const hasErrors = checks.some(ch => !ch.match && ch.critical);
  const hasWarnings = checks.some(ch => !ch.match && !ch.critical);
  const overallStatus = hasErrors ? 'err' : hasWarnings ? 'warn' : 'ok';

  const overallIcon = overallStatus==='ok' ? '✓' : overallStatus==='warn' ? '⚠' : '✗';
  const overallLabel = overallStatus==='ok'
    ? (lang==='es'?'Verificado con naviera — Todo coincide':'Verified with carrier — All data matches')
    : overallStatus==='warn'
    ? (lang==='es'?'Verificado — Con observaciones':'Verified — With observations')
    : (lang==='es'?'Verificado — Inconsistencias encontradas':'Verified — Inconsistencies found');

  // Build validation checklist
  const checklistHtml = checks.map(ch => {
    const icon = ch.match ? '✓' : (ch.critical ? '✗' : '⚠');
    const cls  = ch.match ? 'chk-ok' : (ch.critical ? 'chk-err' : 'chk-warn');
    const diff = !ch.match && ch.docVal && ch.docVal!=='—'
      ? `<div class="chk-diff">
          <span class="chk-diff-label">${lang==='es'?'Doc:':'Doc:'}</span> <span class="chk-diff-val">${ch.docVal}</span>
          <span class="chk-diff-label">${lang==='es'?'Naviera:':'Carrier:'}</span> <span class="chk-diff-val err">${ch.trackVal}</span>
         </div>` : '';
    return `<div class="chk-item ${cls}">
      <span class="chk-icon">${icon}</span>
      <div class="chk-content">
        <div class="chk-label">${ch.label}</div>
        <div class="chk-val">${ch.trackVal}</div>
        ${diff}
      </div>
    </div>`;
  }).join('');

  // Events timeline
  const events = data.events||data.milestones||data.tracking_events||[];
  const eventsHtml = events.length > 0 ? `
    <div class="tracking-events">
      <div class="tracking-events-label">${t.trackingEvents}</div>
      <div class="event-timeline">
        ${events.slice(0,6).map((ev,i)=>`
          <div class="event-item ${i===0?'latest':''}">
            <div class="event-dot"></div>
            <div class="event-date">${ev.date||ev.timestamp||ev.event_date||'—'}</div>
            <div class="event-desc">${ev.description||ev.event||ev.status||ev.type||'—'}</div>
            <div class="event-location">${ev.location||ev.port||ev.place||''}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // Quick stats
  const statsHtml = `<div class="tracking-grid">
    <div class="tracking-field"><div class="tracking-field-label">${t.trackingStatus}</div><div class="tracking-field-val highlight">${status}</div></div>
    <div class="tracking-field"><div class="tracking-field-label">${t.trackingVessel}</div><div class="tracking-field-val">${vessel}</div></div>
    <div class="tracking-field"><div class="tracking-field-label">${t.trackingETA}</div><div class="tracking-field-val warn">${eta}</div></div>
    <div class="tracking-field"><div class="tracking-field-label">${t.trackingATD}</div><div class="tracking-field-val">${atd}</div></div>
    <div class="tracking-field"><div class="tracking-field-label">${t.trackingVoyage}</div><div class="tracking-field-val">${voyage}</div></div>
    ${containers.length?`<div class="tracking-field"><div class="tracking-field-label">${t.trackingContainer}</div><div class="tracking-field-val">${Array.isArray(containers)?containers.slice(0,2).join(', '):containers}</div></div>`:''}
  </div>`;

  const box = document.createElement('div');
  box.className = 'tracking-box';
  box.id = `track-${blNumber}`;
  box.innerHTML = `
    <div class="tracking-box-header">
      <h4>🚢 ${shippingLine}</h4>
      <span class="tracking-bl">${blNumber}</span>
      <span class="tracking-overall ${overallStatus}">${overallIcon} ${overallLabel}</span>
    </div>
    <div class="tracking-body">
      <div class="tracking-validation-title">${lang==='es'?'Validación contra documentos':'Validation against documents'}</div>
      <div class="tracking-checklist">${checklistHtml}</div>
      <div class="tracking-data-title">${lang==='es'?'Datos en tiempo real de la naviera':'Real-time carrier data'}</div>
      ${statsHtml}
      ${eventsHtml}
    </div>`;

  sec.appendChild(box);
}

async function loadTracking(){
  const t = tx();
  const sec = document.getElementById('trackingSection');
  const secTitle = document.getElementById('trackingSectionTitle');
  const banner = document.getElementById('trackingStatusBanner');
  const bar = document.getElementById('trackingStatusBar');
  const icon = document.getElementById('tsbIcon');
  const title = document.getElementById('tsbTitle');
  const detail = document.getElementById('tsbDetail');
  const badge = document.getElementById('tsbBadge');

  // Helper to update banner state
  const setBanner = (state, titleTxt, detailTxt, badgeTxt) => {
    if(!banner) return;
    banner.style.display = 'block';
    bar.className = 'tracking-status-bar ' + state;
    badge.className = 'tsb-badge ' + state;
    title.textContent = titleTxt;
    detail.innerHTML = detailTxt;
    badge.textContent = badgeTxt;
  };

  // Find all BL numbers
  const blNumbers = [];
  analysisResults.forEach(r => {
    if(r.blNumber && r.blNumber !== 'null' && r.blNumber !== 'undefined' && r.blNumber !== 'N/A'){
      if(!blNumbers.find(b => b.bl === r.blNumber)){
        blNumbers.push({ bl: r.blNumber, docData: r });
      }
    }
  });

  if(blNumbers.length === 0){
    setBanner('error',
      lang==='es'?'Sin número de BL':'No BL Number Found',
      lang==='es'?'No se encontró número de BL en los documentos del set.':'No BL number was found in the uploaded documents.',
      lang==='es'?'No disponible':'Not Available'
    );
    icon.textContent = '⚠️';
    return;
  }

  // Show loading state
  const blList = blNumbers.map(b=>b.bl).join(', ');
  setBanner('loading',
    lang==='es'?'Consultando naviera...':'Querying Carrier...',
    `<span class="tsb-spinner"></span>${lang==='es'?'Verificando BL':'Verifying BL'}: <strong>${blList}</strong>`,
    lang==='es'?'En curso...':'In Progress...'
  );
  icon.textContent = '🚢';

  // Show tracking section
  sec.style.display = 'block';
  secTitle.style.display = 'flex';
  const h3 = secTitle.querySelector('h3');
  if(h3) h3.textContent = t.trackingTitle;
  sec.innerHTML = '';

  let allVerified = true;
  let anyMismatch = false;
  let anyError = false;
  const resultsSummary = [];

  for(const {bl, docData} of blNumbers){
    const shippingLine = detectShippingLine(bl);

    // Loading box
    const loadDiv = document.createElement('div');
    loadDiv.className = 'tracking-box';
    loadDiv.innerHTML = `
      <div class="tracking-box-header">
        <h4>🚢 ${shippingLine}</h4>
        <span class="tracking-bl">${bl}</span>
      </div>
      <div class="tracking-body">
        <div class="tracking-loading">
          <div class="tracking-spinner"></div>
          <span>${t.trackingLoading} ${bl}...</span>
        </div>
      </div>`;
    sec.appendChild(loadDiv);

    try {
      const data = await fetchTracking(bl, shippingLine);
      loadDiv.remove();
      renderTrackingBox(bl, shippingLine, data, docData);

      // Determine match result for this BL
      const vessel  = data.vessel||data.vesselName||data.vessel_name||'';
      const pol     = data.pol||data.portOfLoading||data.port_of_loading||'';
      const pod     = data.pod||data.portOfDischarge||data.port_of_discharge||'';
      const status  = data.status||data.shipmentStatus||data.tracking_status||'—';

      const vesselMatch = !vessel || !docData?.vesselName || checkMatch(vessel, docData.vesselName) !== false;
      const polMatch    = !pol || !docData?.portOfLoading || checkMatch(pol, docData.portOfLoading) !== false;
      const podMatch    = !pod || !docData?.portOfDischarge || checkMatch(pod, docData.portOfDischarge) !== false;
      const hasIssues   = !vesselMatch || !polMatch || !podMatch;
      if(hasIssues) anyMismatch = true;

      resultsSummary.push({
        bl, shippingLine, status,
        vessel: vessel||'—', pol: pol||'—', pod: pod||'—',
        ok: !hasIssues
      });

    } catch(e) {
      anyError = true;
      allVerified = false;
      loadDiv.querySelector('.tracking-body').innerHTML =
        `<div class="tracking-error">${t.trackingError}<br><small style="opacity:0.7">${e.message}</small></div>`;
      resultsSummary.push({ bl, shippingLine, error: e.message });
    }
  }

  // Update banner with final result
  if(anyError && resultsSummary.every(r=>r.error)){
    setBanner('error',
      lang==='es'?'Error al consultar naviera':'Carrier Query Failed',
      lang==='es'?'No se pudo conectar con la naviera. Verifica tu configuración de Make.com.':'Could not connect to carrier. Check your Make.com configuration.',
      lang==='es'?'Error':'Error'
    );
    icon.textContent = '❌';
  } else if(anyMismatch){
    const issues = resultsSummary.filter(r=>!r.ok&&!r.error).map(r=>
      `${r.bl} (${r.shippingLine}) — ${lang==='es'?'Estado':'Status'}: ${r.status}`
    ).join(' · ');
    setBanner('mismatch',
      lang==='es'?'Consulta completada — Con observaciones':'Carrier Verified — With Observations',
      lang==='es'
        ? `La consulta a la naviera fue exitosa pero se encontraron diferencias con los documentos.<br><strong>${issues}</strong>`
        : `Carrier query successful but some data differs from documents.<br><strong>${issues}</strong>`,
      lang==='es'?'⚠ Revisar':'⚠ Review'
    );
    icon.textContent = '⚠️';
  } else {
    const summary = resultsSummary.filter(r=>!r.error).map(r=>
      `${r.bl} · ${r.shippingLine} · ${lang==='es'?'Estado':'Status'}: ${r.status}`
    ).join(' | ');
    setBanner('verified',
      lang==='es'?'✓ Verificado con la naviera':'✓ Verified with Carrier',
      lang==='es'
        ? `Todos los BL fueron consultados exitosamente y los datos coinciden con los documentos.<br><small>${summary}</small>`
        : `All BL numbers queried successfully and data matches documents.<br><small>${summary}</small>`,
      lang==='es'?'✓ Verificado':'✓ Verified'
    );
    icon.textContent = '✅';
  }
}

// ── INITIALIZATION ──────────────────────────────────────────
// Initialize — apply saved language preference
document.getElementById('btnES')?.classList.toggle('active', lang==='es');
document.getElementById('btnEN')?.classList.toggle('active', lang==='en');
applyLang();
setTimeout(updateUploadStepper, 100);

// ── ROTATING HERO IMAGES ──────────────────────────
// HERO_IMAGES is declared in index.html inline script
(function setRandomHero(){
  const heroImg = document.querySelector('.hero-img');
  if(heroImg){
    const idx = Math.floor(Math.random() * HERO_IMAGES.length);
    const grad = 'linear-gradient(to bottom, rgba(10,5,2,0.60) 0%, rgba(10,5,2,0.50) 60%, rgba(10,5,2,0.35) 100%)';
    heroImg.style.background = grad + ", url('" + HERO_IMAGES[idx] + "')";
    heroImg.style.backgroundSize = 'cover, cover';
    heroImg.style.backgroundPosition = 'center, center';
    heroImg.style.backgroundRepeat = 'no-repeat, no-repeat';
  }
})();

// ── UPLOAD ZONE DRAG/DROP ─────────────────────────
const zone=document.getElementById('uploadZone');
zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');addFiles([...e.dataTransfer.files]);});
document.getElementById('fileInput').addEventListener('change',e=>{addFiles([...e.target.files]);e.target.value='';});

// ── DOC TYPE BUTTON CLICK LISTENERS ───────────────
document.querySelectorAll('.doc-type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
    updateUploadStepper();
  });
});

// ── GHOST BUTTONS INIT + RESIZE ───────────────────
fillGhostButtons();
window.addEventListener('resize', fillGhostButtons);
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', ()=>setTimeout(fillGhostButtons, 50));
} else {
  setTimeout(fillGhostButtons, 50);
}

// ── BEFORE UNLOAD WARNING ─────────────────────────
window.addEventListener('beforeunload', e => {
  if (_analysisInProgress) { e.preventDefault(); e.returnValue = ''; }
});

// ── Activity Log + Tech Progress helpers ──
// These augment the existing loading UI — they don't replace anything.
function addActivityEntry(text, status) {
  status = status || 'active';
  var log = document.getElementById('activityLog');
  if (!log) return;
  var prev = log.querySelector('.activity-entry.active');
  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('done');
    var dot = prev.querySelector('.activity-dot');
    if (dot) dot.style.animation = 'none';
  }
  var entry = document.createElement('div');
  entry.className = 'activity-entry ' + status;
  entry.innerHTML = '<span class="activity-dot"></span><span>' + text + '</span>';
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function setTechProgress(pct, label) {
  var fill = document.getElementById('techProgressFill');
  var pctEl = document.getElementById('techProgressPct');
  var lblEl = document.getElementById('techProgressLabel');
  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct;
  if (lblEl && label) lblEl.textContent = label;
}

function showTechProgress() {
  var el = document.getElementById('techProgressWrap');
  if (el) el.style.display = 'block';
}

function hideTechProgress() {
  var el = document.getElementById('techProgressWrap');
  if (el) el.style.display = 'none';
  var log = document.getElementById('activityLog');
  if (log) log.innerHTML = '';
}

// ── Retry failed document extraction ──
// Re-extracts a single document that previously failed, then re-runs coherence
async function retryDocument(filename) {
  var entry = uploadedFiles.find(function(f){ return f.name === filename; });
  if (!entry) { alert('File not found: ' + filename); return; }

  // Show retry status on the button
  var btn = document.querySelector('[data-retry="'+filename+'"]');
  if (btn) { btn.disabled = true; btn.textContent = lang==='es' ? 'Reintentando...' : 'Retrying...'; }

  try {
    var docs = await extractDoc(entry);
    var docsArr = Array.isArray(docs) ? docs : [docs];
    docsArr.forEach(function(d){ d._filename = filename; });

    // Remove old failed entries for this file
    analysisResults = analysisResults.filter(function(r){ return r._filename !== filename; });
    // Add new results
    docsArr.forEach(function(d){ analysisResults.push(d); });

    var hasError = docsArr.some(function(d){ return d._err; });
    if (hasError) {
      if (btn) { btn.disabled = false; btn.textContent = lang==='es' ? 'Falló — Reintentar' : 'Failed — Retry'; }
      return;
    }

    // Re-run coherence with updated results
    var cleanDocs = {};
    analysisResults.forEach(function(r){
      if (r._err) return;
      var fn = r._filename || 'unknown';
      if (!cleanDocs[fn]) cleanDocs[fn] = [];
      cleanDocs[fn].push(r);
    });
    coherenceResult = await analyzeCoherence(cleanDocs);
    _cachedSummary = coherenceResult && coherenceResult.summary ? coherenceResult.summary : null;

    // Re-render results
    renderResults();
    if (typeof renderDocumentStack === 'function') renderDocumentStack(analysisResults, coherenceResult);

  } catch(e) {
    console.error('Retry failed:', e.message);
    if (btn) { btn.disabled = false; btn.textContent = lang==='es' ? 'Error — Reintentar' : 'Error — Retry'; }
  }
}
