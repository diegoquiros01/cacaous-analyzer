// netlify/functions/user.js
// Get user plan and validation count, create user if first time

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const PLAN_LIMITS = {
  starter:      20,
  professional: 200,
  enterprise:   1000,
};

async function supabase(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, clerk_id, email } = JSON.parse(event.body || '{}');

    if (!clerk_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing clerk_id' }) };

    // GET USER
    if (action === 'get' || !action) {
      let users = await supabase(`users?clerk_id=eq.${clerk_id}&select=*`);

      // Create user if doesn't exist
      if (!users || users.length === 0) {
        users = await supabase('users', 'POST', {
          clerk_id,
          email: email || '',
          plan: 'starter',
          validations_used: 0,
        });
      }

      const user = Array.isArray(users) ? users[0] : users;
      const limit = PLAN_LIMITS[user.plan] || 20;
      const remaining = Math.max(0, limit - (user.validations_used || 0));

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          plan: user.plan,
          validations_used: user.validations_used,
          validations_limit: limit,
          remaining,
          can_analyze: remaining > 0,
        }),
      };
    }

    // INCREMENT USAGE
    if (action === 'increment') {
      const users = await supabase(`users?clerk_id=eq.${clerk_id}&select=*`);
      const user = Array.isArray(users) ? users[0] : users;
      if (!user) return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };

      const limit = PLAN_LIMITS[user.plan] || 20;
      if (user.validations_used >= limit) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: false, reason: 'limit_reached', plan: user.plan, limit }),
        };
      }

      await supabase(`users?clerk_id=eq.${clerk_id}`, 'PATCH', {
        validations_used: user.validations_used + 1,
        updated_at: new Date().toISOString(),
      });

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          validations_used: user.validations_used + 1,
          remaining: limit - user.validations_used - 1,
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('user function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
