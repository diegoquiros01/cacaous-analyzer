// netlify/functions/user.js
// Get user plan and validation count, create user if first time
// Reset logic: calendar month (1st of each month)
//   - First period: 30 days from signup (grace period so new users get a full month)
//   - From 2nd period onward: resets on the 1st of each calendar month

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const PLAN_LIMITS = {
  starter:      10,
  growth:       50,
  professional: 150,
  enterprise:   350,
};

async function supabase(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

// Reset logic:
//   - If user has never been reset (last_reset = created_at or null):
//       wait 30 days from signup (grace period) before first reset
//   - After that: reset on the 1st of each calendar month
function shouldReset(user) {
  const now = new Date();
  const created = new Date(user.created_at || now);
  const lastReset = user.last_reset ? new Date(user.last_reset) : created;

  // Has the user completed their initial 30-day grace period?
  const daysSinceCreation = (now - created) / (1000 * 60 * 60 * 24);
  const inGracePeriod = daysSinceCreation < 30;

  if (inGracePeriod) {
    // Still in first 30 days — never reset yet
    return false;
  }

  // After grace period: reset on the 1st of the current calendar month
  // i.e. if last_reset is before the 1st of this month, reset now
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return lastReset < firstOfThisMonth;
}

// Returns the next reset date for display in the frontend
function nextResetDate(user) {
  const now = new Date();
  const created = new Date(user.created_at || now);
  const daysSinceCreation = (now - created) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 30) {
    // Still in grace period — next reset is 30 days from signup
    return new Date(created.getTime() + 30 * 86400000).toISOString();
  }

  // Next reset = 1st of next month
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return firstOfNextMonth.toISOString();
}

const ALLOWED_ORIGINS = [
  'https://www.docsvalidate.com',
  'https://docsvalidate.com',
  'http://localhost:8888',
  'http://localhost:3000',
];

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, clerk_id, email, new_plan } = JSON.parse(event.body || '{}');

    if (!clerk_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing clerk_id' }) };
    }
    // Validate clerk_id format to prevent injection
    if (!/^[a-zA-Z0-9_-]{10,60}$/.test(clerk_id)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid clerk_id' }) };
    }

    // ── GET USER ────────────────────────────────────────────────────────────
    if (action === 'get' || !action) {
      let users = await supabase(`users?clerk_id=eq.${encodeURIComponent(clerk_id)}&select=*`);

      // Create user if doesn't exist
      if (!users || users.length === 0) {
        const now = new Date().toISOString();
        users = await supabase('users', 'POST', {
          clerk_id,
          email: email || '',
          plan: 'starter',
          validations_used: 0,
          last_reset: now,
        });
      }

      let user = Array.isArray(users) ? users[0] : users;
      if (!user) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get or create user' }) };
      }

      // ── AUTO-RESET if 30 days have passed ──────────────────────────────
      if (shouldReset(user)) {
        const now = new Date().toISOString();
        await supabase(`users?clerk_id=eq.${encodeURIComponent(clerk_id)}`, 'PATCH', {
          validations_used: 0,
          last_reset: now,
          updated_at: now,
        });
        user = { ...user, validations_used: 0, last_reset: now };
      }

      const limit     = PLAN_LIMITS[user.plan] || 20;
      const remaining = Math.max(0, limit - (user.validations_used || 0));

      // Calculate next reset date for the frontend to display
      const nextReset = nextResetDate(user);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          plan:              user.plan,
          validations_used:  user.validations_used,
          validations_limit: limit,
          remaining,
          can_analyze:       remaining > 0,
          next_reset:        nextReset,
        }),
      };
    }

    // ── INCREMENT USAGE (atomic — prevents race conditions) ────────────────
    if (action === 'increment') {
      let users = await supabase(`users?clerk_id=eq.${encodeURIComponent(clerk_id)}&select=*`);
      let user  = Array.isArray(users) ? users[0] : users;
      if (!user) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
      }

      // Auto-reset check on increment too (edge case: user was at limit, period expired)
      if (shouldReset(user)) {
        const now = new Date().toISOString();
        await supabase(`users?clerk_id=eq.${encodeURIComponent(clerk_id)}`, 'PATCH', {
          validations_used: 0,
          last_reset: now,
          updated_at: now,
        });
        user = { ...user, validations_used: 0, last_reset: now };
      }

      const limit = PLAN_LIMITS[user.plan] || 20;

      if (user.validations_used >= limit) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: false,
            reason:  'limit_reached',
            plan:    user.plan,
            limit,
          }),
        };
      }

      // Atomic increment: only update if validations_used hasn't changed (optimistic lock)
      // The filter ensures the row only updates if still at the expected count
      const now = new Date().toISOString();
      const cid = encodeURIComponent(clerk_id);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users?clerk_id=eq.${cid}&validations_used=lt.${limit}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          validations_used: user.validations_used + 1,
          updated_at: now,
        }),
      });
      const updated = await res.json();

      // If no rows were updated, someone else incremented first (race condition caught)
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: false,
            reason:  'limit_reached',
            plan:    user.plan,
            limit,
          }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success:          true,
          validations_used: user.validations_used + 1,
          remaining:        limit - user.validations_used - 1,
        }),
      };
    }

    // ── UPDATE PLAN (called by Stripe webhook) ──────────────────────────────
    if (action === 'update_plan') {
      if (!new_plan || !PLAN_LIMITS[new_plan]) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan: ' + new_plan }) };
      }

      // When upgrading plan, reset counter — next reset will be 1st of next month
      const now = new Date().toISOString();
      await supabase(`users?clerk_id=eq.${encodeURIComponent(clerk_id)}`, 'PATCH', {
        plan:             new_plan,
        validations_used: 0,
        last_reset:       now,
        updated_at:       now,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, plan: new_plan }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown action' }),
    };

  } catch (err) {
    console.error('user function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
