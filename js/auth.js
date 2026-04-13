// js/auth.js — Clerk authentication, profile, modals
// Depends on globals: lang, tx(), GUEST_LIMIT, window.__clerk_user
// Depends on: loadHistory() from history.js

function getGuestCount(){ return parseInt(localStorage.getItem('dv_guest_count')||'0'); }
function incGuestCount(){ localStorage.setItem('dv_guest_count', getGuestCount()+1); }
function isLoggedIn(){ return window.__clerk_user != null; }

// requestIdleCallback lets browser finish painting before touching Clerk.
// Falls back to setTimeout on browsers that don't support rIC.
function initClerk() {
  if(!window.Clerk) { setTimeout(initClerk, 500); return; }
  window.Clerk.load().then(() => {
    const user = window.Clerk?.user;
    if(user){
      window.__clerk_user = user;
      updateUserBadge(user);
      // History loads on demand via "My Reports" button
      // Show admin nav link if admin email matches
      window.Clerk.session?.getToken().then(token => {
        if(!token) return;
        fetch('/.netlify/functions/admin', {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
          body: JSON.stringify({action:'overview'}),
        }).then(r => {
          if(r.ok){ const li=document.getElementById('adminNavItem'); if(li) li.style.display='list-item'; }
        }).catch(()=>{});
      }).catch(()=>{});
    }
  }).catch(e => console.warn('Clerk load error:', e.message));
}
if('requestIdleCallback' in window){
  requestIdleCallback(initClerk, { timeout: 3000 });
} else {
  setTimeout(initClerk, 200);
}

function updateUserBadge(user){
  const badge = document.getElementById('userBadge');
  if(!badge) return;
  const name = user.firstName || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User';
  const reportsLabel = lang==='es' ? 'Reportes' : 'Reports';
  const profileLabel = lang==='es' ? 'Mi Cuenta' : 'Account';
  const signOutLabel = lang==='es' ? 'Salir' : 'Sign out';
  // Build DOM nodes instead of innerHTML to prevent XSS via user-controlled fields
  badge.innerHTML = '';
  const items = [
    { text: name, onclick: null },
    { text: reportsLabel, onclick: () => { toggleMyReports(); } },
    { text: profileLabel, onclick: () => { openProfile(); } },
    { text: signOutLabel, onclick: () => { signOut(); }, style: 'color:var(--text-light)' },
  ];
  items.forEach(item => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.text;
    if(item.style) a.style.cssText = item.style;
    a.addEventListener('click', (e) => { e.preventDefault(); if(item.onclick) item.onclick(); });
    li.appendChild(a);
    badge.appendChild(li);
  });
}

var _hadResultsBeforeReports = false;
function toggleMyReports() {
  const sec = document.getElementById('historySection');
  if (!sec) return;
  const isVisible = sec.style.display !== 'none' && sec.style.display !== '';
  const upload = document.getElementById('uploadSection');
  const stepper = document.getElementById('upStepper');
  const footer = document.querySelector('footer');
  const results = document.getElementById('results');
  const loading = document.getElementById('loading');
  const techProgress = document.getElementById('techProgressWrap');
  if (isVisible) {
    // Hide reports, restore previous view
    sec.style.display = 'none';
    if (stepper) stepper.style.display = '';
    if (footer) footer.style.display = '';
    if (_hadResultsBeforeReports && results) {
      // Restore results view
      results.classList.add('show');
    } else {
      // Restore upload view
      if (upload) upload.style.display = '';
    }
  } else {
    // Remember if results were showing
    _hadResultsBeforeReports = results && results.classList.contains('show');
    // Show reports, hide everything else
    if (upload) upload.style.display = 'none';
    if (stepper) stepper.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (results) results.classList.remove('show');
    if (loading) { loading.classList.remove('show'); loading.style.display = 'none'; }
    if (techProgress) techProgress.style.display = 'none';
    sec.style.display = 'block';
    loadHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ── TERMS CHECKBOX LOGIC ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const check = document.getElementById('termsCheck');
  const btn   = document.getElementById('signupBtn');
  if(check && btn){
    check.addEventListener('change', () => {
      btn.style.opacity = check.checked ? '1' : '0.5';
    });
  }
});

function handleSignupClick(){
  const check = document.getElementById('termsCheck');
  const err   = document.getElementById('termsError');
  if(check && !check.checked){
    if(err) err.style.display = 'block';
    if(check) check.parentElement.style.outline = '1px solid #c0392b';
    return;
  }
  if(err) err.style.display = 'none';
  if(check) check.parentElement.style.outline = '';
  openClerkSignIn();
}

async function openProfile(){
  // Show plan info + link to Clerk account management
  if (!isLoggedIn()) { openClerkSignIn(); return; }
  const isES = lang === 'es';
  try {
    const userId = window.__clerk_user.id;
    const email = window.__clerk_user.primaryEmailAddress?.emailAddress || '';
    const resp = await fetch('/.netlify/functions/user', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'get', clerk_id: userId, email })
    });
    const data = await resp.json();
    const plan = (data.plan || 'starter').charAt(0).toUpperCase() + (data.plan || 'starter').slice(1);
    const used = data.validations_used || 0;
    const limit = data.validations_limit || 0;
    const remaining = data.remaining || 0;
    const nextReset = data.next_reset ? new Date(data.next_reset).toLocaleDateString(isES?'es-ES':'en-US',{month:'long',day:'numeric',year:'numeric'}) : '—';

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,17,23,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.id = 'profileModal';
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
    modal.innerHTML = `<div style="background:#fff;border-radius:4px;padding:2rem;max-width:400px;width:90%;position:relative;">
      <button onclick="document.getElementById('profileModal')?.remove()" style="position:absolute;top:0.8rem;right:0.8rem;background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-light);">✕</button>
      <h3 style="font-family:'Playfair Display',serif;font-size:1.2rem;color:var(--brown-dark);margin-bottom:1rem;">${isES?'Mi Cuenta':'My Account'}</h3>
      <div style="display:flex;flex-direction:column;gap:0.6rem;margin-bottom:1.2rem;">
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-light);">
          <span style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;">Email</span>
          <span style="font-size:0.78rem;color:var(--brown-dark);">${email.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-light);">
          <span style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;">${isES?'Plan':'Plan'}</span>
          <span style="font-size:0.78rem;color:var(--tan);font-weight:700;">${plan}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-light);">
          <span style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;">${isES?'Validaciones usadas':'Validations used'}</span>
          <span style="font-size:0.78rem;color:var(--brown-dark);">${used} / ${limit}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-light);">
          <span style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;">${isES?'Restantes':'Remaining'}</span>
          <span style="font-size:0.78rem;color:var(--green);font-weight:700;">${remaining}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0.4rem 0;">
          <span style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.1em;">${isES?'Próximo reset':'Next reset'}</span>
          <span style="font-size:0.78rem;color:var(--brown-dark);">${nextReset}</span>
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;">
        <a href="/pricing.html" style="flex:1;text-align:center;padding:0.6rem;background:var(--brown-dark);color:#fff;font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;border-radius:2px;">${isES?'Cambiar plan':'Change plan'}</a>
        <a href="https://accounts.docsvalidate.com/user" target="_blank" style="flex:1;text-align:center;padding:0.6rem;background:none;border:1px solid var(--border);color:var(--text-mid);font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;border-radius:2px;">${isES?'Editar perfil':'Edit profile'}</a>
      </div>
    </div>`;
    document.body.appendChild(modal);
  } catch(e) {
    console.error('Profile error:', e);
    window.open('https://accounts.docsvalidate.com/user', '_blank');
  }
}

function openClerkSignIn(){
  closeAuthModal();
  // Redirect to Clerk hosted sign-in page (more reliable than modal overlay)
  const returnUrl = encodeURIComponent(window.location.href);
  window.location.href = 'https://accounts.docsvalidate.com/sign-in?redirect_url=' + returnUrl;
}

async function signOut(){
  await window.Clerk?.signOut();
  window.__clerk_user = null;
  const badge = document.getElementById('userBadge');
  if(badge) badge.innerHTML = '<li><a href="#" onclick="openClerkSignIn();return false;">Sign in</a></li>';
}

// ── KEYBOARD: Escape closes modals ───────────────
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') {
    const auth = document.getElementById('authModal');
    if(auth && auth.style.display === 'flex') { closeAuthModal(); return; }
    const upgrade = document.getElementById('upgradeModal');
    if(upgrade && upgrade.style.display === 'flex') { closeUpgradeModal(); return; }
    const profile = document.getElementById('profileModal');
    if(profile) { profile.remove(); return; }
  }
});

// ── AUTH MODAL ───────────────────────────────────
function showAuthModal(reason){
  const modal = document.getElementById('authModal');
  const title = document.getElementById('authModalTitle');
  const desc  = document.getElementById('authModalDesc');
  const btn   = document.getElementById('authModalBtn');
  const isES  = lang === 'es';

  const t2 = tx();
  if(reason === 'guest_limit'){
    title.textContent = t2.authTitle;
    desc.textContent  = t2.authDesc;
    btn.textContent   = t2.authBtn;
  }

  // Reset checkbox state every time modal opens
  const check = document.getElementById('termsCheck');
  const err   = document.getElementById('termsError');
  const signupBtn = document.getElementById('signupBtn');
  if(check){ check.checked = false; }
  if(err){ err.style.display = 'none'; }
  if(signupBtn){ signupBtn.style.opacity = '0.5'; }

  modal.style.display = 'flex';
}

function closeAuthModal(){
  document.getElementById('authModal').style.display = 'none';
  const err = document.getElementById('termsError');
  if(err) err.style.display = 'none';
}

// ── UPGRADE MODAL ────────────────────────────────
function showUpgradeModal(plan, limit){
  const modal = document.getElementById('upgradeModal');
  const desc  = document.getElementById('upgradeDesc');
  const isES  = lang === 'es';

  desc.textContent = isES
    ? `Has alcanzado el límite de ${limit} validaciones de tu plan ${plan}. Actualiza para continuar.`
    : `You've reached the ${limit} validation limit on your ${plan} plan. Upgrade to continue.`;

  modal.style.display = 'flex';
}

function closeUpgradeModal(){
  document.getElementById('upgradeModal').style.display = 'none';
}

// ── CHECKOUT SUCCESS DETECTION ──────────────────
(function checkCheckoutSuccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    // Remove param from URL without reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    // Show success message after a short delay (let Clerk load)
    setTimeout(() => {
      const isES = lang === 'es';
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,17,23,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      modal.innerHTML = '<div style="background:#fff;border-radius:4px;padding:2.5rem;max-width:420px;width:90%;text-align:center;">'
        + '<div style="font-size:2.5rem;margin-bottom:1rem;">✓</div>'
        + '<h3 style="font-family:Playfair Display,serif;font-size:1.3rem;color:#0f1117;margin-bottom:0.8rem;">'
        + (isES ? '¡Suscripción activada!' : 'Subscription activated!') + '</h3>'
        + '<p style="font-size:0.85rem;color:#3a4255;line-height:1.6;margin-bottom:1.5rem;">'
        + (isES ? 'Tu plan ha sido actualizado exitosamente. Ya puedes usar todas las validaciones de tu nuevo plan.' : 'Your plan has been upgraded successfully. You can now use all validations in your new plan.') + '</p>'
        + '<button onclick="this.closest(\'div[style]\').remove()" style="padding:0.7rem 2rem;background:#0f1117;color:#7da4d4;border:none;font-size:0.65rem;letter-spacing:0.18em;text-transform:uppercase;cursor:pointer;border-radius:2px;">'
        + (isES ? 'Comenzar' : 'Get started') + '</button>'
        + '</div>';
      document.body.appendChild(modal);
    }, 500);
  }
})();
