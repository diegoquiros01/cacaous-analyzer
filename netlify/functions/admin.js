// netlify/functions/admin.js
// Admin-only backend — verifies ADMIN_EMAIL + JWT signature before serving any data
// Fetches aggregated data from Supabase + Stripe

// JWT verification inlined (same as claude.js) to avoid bundler caching stale module
const _JWKS_URL = 'https://clerk.docsvalidate.com/.well-known/jwks.json';
let _cachedJWKS = null, _cachedAt = 0;
async function _getJWKS() {
  if (_cachedJWKS && (Date.now() - _cachedAt) < 300000) return _cachedJWKS;
  const r = await fetch(_JWKS_URL);
  if (!r.ok) throw new Error('Failed to fetch JWKS: ' + r.status);
  _cachedJWKS = await r.json(); _cachedAt = Date.now(); return _cachedJWKS;
}
function _b64d(s) { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
async function verifyClerkJWT(authHeader) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const parts = authHeader.slice(7).split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(_b64d(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(_b64d(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 30) return null;
    let jwks = await _getJWKS();
    let jwk = jwks.keys.find(k => k.kid === header.kid);
    if (!jwk) { _cachedJWKS = null; jwks = await _getJWKS(); jwk = jwks.keys.find(k => k.kid === header.kid); if (!jwk) return null; }
    const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, _b64d(parts[2]), new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if (!valid) return null;
    const email = payload.email || payload.primary_email || payload.email_addresses?.[0]?.email_address || null;
    return { valid: true, email, sub: payload.sub };
  } catch (e) { console.error('JWT verification error:', e.message); return null; }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL; // e.g. diego@docsvalidate.com

const ALLOWED_ORIGINS = [
  'https://www.docsvalidate.com',
  'https://docsvalidate.com',
  'http://localhost:8888',
  'http://localhost:3000',
];

function getCORS(event) {
  const origin = event.headers['origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

// ── Supabase helper ─────────────────────────────────────────────────────────
async function sb(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`Supabase ${path} → ${res.status}`);
  return res.json();
}

// ── Stripe helper ────────────────────────────────────────────────────────────
async function stripe(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path} → ${res.status}`);
  return res.json();
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const CORS = getCORS(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // 1. Auth check — verify JWT signature + admin email or user ID
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const clerk = await verifyClerkJWT(authHeader);
  if (!clerk?.valid) {
    console.error('Admin auth failed: JWT invalid');
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  // Check admin by email OR by Clerk user ID (fallback when email not in JWT)
  const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '';
  const emailMatch = clerk.email && ADMIN_EMAIL && clerk.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const userIdMatch = clerk.sub && ADMIN_USER_ID && clerk.sub === ADMIN_USER_ID;
  if (!emailMatch && !userIdMatch) {
    console.error('Admin auth failed: email=' + (clerk.email||'null') + ' sub=' + (clerk.sub||'null') + ' expected=' + ADMIN_EMAIL);
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    // ── ACTION: overview ─────────────────────────────────────────────────────
    // Returns aggregated stats for the dashboard hero cards
    if (action === 'overview') {
      const [users, validations_log, errors_log] = await Promise.allSettled([
        sb('users?select=id,plan,validations_used,created_at,email'),
        sb('validation_logs?select=id,created_at,status&order=created_at.desc&limit=500'),
        sb('error_logs?select=id,created_at,error_type,message&order=created_at.desc&limit=200'),
      ]);

      const usersData      = users.status      === 'fulfilled' ? users.value      : [];
      const vLogs          = validations_log.status === 'fulfilled' ? validations_log.value : [];
      const eLogs          = errors_log.status === 'fulfilled' ? errors_log.value : [];

      const totalUsers     = usersData.length;
      const planBreakdown  = usersData.reduce((acc, u) => { acc[u.plan] = (acc[u.plan] || 0) + 1; return acc; }, {});
      const totalValidations = usersData.reduce((acc, u) => acc + (u.validations_used || 0), 0);
      const recentErrors   = eLogs.length;

      // New users in last 30 days
      const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const newUsers30 = usersData.filter(u => u.created_at > cutoff30).length;

      // Validations per day (last 14 days) from validation_logs if available
      const validationsPerDay = {};
      vLogs.forEach(v => {
        const day = v.created_at?.slice(0, 10);
        if (day) validationsPerDay[day] = (validationsPerDay[day] || 0) + 1;
      });

      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({
          totalUsers,
          newUsers30,
          planBreakdown,
          totalValidations,
          recentErrors,
          validationsPerDay,
        }),
      };
    }

    // ── ACTION: users ────────────────────────────────────────────────────────
    if (action === 'users') {
      const users = await sb('users?select=*&order=created_at.desc&limit=200');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ users }) };
    }

    // ── ACTION: stripe_payments ──────────────────────────────────────────────
    if (action === 'stripe_payments') {
      if (!STRIPE_KEY) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ payments: [], subscriptions: [], revenue: 0, note: 'STRIPE_SECRET_KEY not configured' }) };
      }
      const [charges, subs] = await Promise.all([
        stripe('charges?limit=50&expand[]=data.customer'),
        stripe('subscriptions?limit=50&status=all'),
      ]);
      const revenue = charges.data
        .filter(c => c.paid && !c.refunded)
        .reduce((acc, c) => acc + c.amount, 0);

      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({
          payments: charges.data.map(c => ({
            id: c.id,
            amount: c.amount,
            currency: c.currency,
            status: c.status,
            email: c.billing_details?.email || c.customer?.email || '—',
            description: c.description,
            created: c.created,
          })),
          subscriptions: subs.data.map(s => ({
            id: s.id,
            status: s.status,
            plan: s.items?.data?.[0]?.price?.nickname || s.items?.data?.[0]?.price?.id || '—',
            amount: s.items?.data?.[0]?.price?.unit_amount || 0,
            interval: s.items?.data?.[0]?.price?.recurring?.interval || '—',
            customer: s.customer,
            created: s.created,
            current_period_end: s.current_period_end,
          })),
          revenue_cents: revenue,
        }),
      };
    }

    // ── ACTION: errors ───────────────────────────────────────────────────────
    if (action === 'errors') {
      let logs;
      try {
        logs = await sb('error_logs?select=*&order=created_at.desc&limit=100');
      } catch (e) {
        // Table may not exist yet — return empty with note
        logs = [];
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ errors: logs }) };
    }

    // ── ACTION: analytics ────────────────────────────────────────────────────
    if (action === 'analytics') {
      const [users, vLogs] = await Promise.allSettled([
        sb('users?select=plan,validations_used,created_at&order=created_at.asc'),
        sb('validation_logs?select=created_at,status,user_id&order=created_at.asc&limit=1000').catch(() => []),
      ]);

      const usersData  = users.status  === 'fulfilled' ? users.value  : [];
      const vData      = vLogs.status  === 'fulfilled' ? vLogs.value  : [];

      // Users growth per month (by signup date)
      const growthMap = {};
      usersData.forEach(u => {
        const month = u.created_at?.slice(0, 7);
        if (month) growthMap[month] = (growthMap[month] || 0) + 1;
      });

      // Plan distribution
      const planDist = usersData.reduce((acc, u) => { acc[u.plan] = (acc[u.plan] || 0) + 1; return acc; }, {});

      // Total validations used
      const totalValidations = usersData.reduce((acc, u) => acc + (u.validations_used || 0), 0);

      // Avg validations per user
      const avgValidations = usersData.length > 0 ? (totalValidations / usersData.length).toFixed(1) : 0;

      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({
          userGrowthByMonth: growthMap,
          planDistribution: planDist,
          totalValidations,
          avgValidationsPerUser: avgValidations,
          validationLogs: vData.slice(-200),
        }),
      };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('admin function error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
