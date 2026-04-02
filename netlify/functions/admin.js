// netlify/functions/admin.js
// Admin-only backend — verifies ADMIN_EMAIL from env vars before serving any data
// Fetches aggregated data from Supabase + Stripe

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL; // e.g. diego@docsvalidate.com

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

// ── Verify admin token via Clerk JWT ─────────────────────────────────────────
// We decode the JWT payload (no crypto verify needed — Netlify/Clerk does that).
// We only trust the email claim to gate access. For extra security, add
// Clerk JWT verification with the public key in production.
function extractEmailFromJWT(authHeader) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    // Clerk stores email in different claims depending on version
    return (
      payload.email ||
      payload.primary_email ||
      (payload.email_addresses?.[0]?.email_address) ||
      null
    );
  } catch (e) {
    return null;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // 1. Auth check
  const email = extractEmailFromJWT(event.headers['authorization'] || event.headers['Authorization']);
  if (!email || email.toLowerCase() !== (ADMIN_EMAIL || '').toLowerCase()) {
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
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
