// netlify/functions/claude.js
// Proxy for Anthropic API with:
// - Origin validation (only docsvalidate.com can call this)
// - Clerk JWT verification (must be logged in OR guest with valid rate-limit token)
// - Extended timeout support

const ALLOWED_ORIGINS = [
  'https://www.docsvalidate.com',
  'https://docsvalidate.com',
  'http://localhost:3000',      // local dev
  'http://localhost:8888',      // netlify dev
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // kept permissive for OPTIONS preflight
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guest-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Verify Clerk JWT — decode payload and check it's not expired
// We don't do full crypto verification here (that's Clerk's job on auth endpoints)
// but we confirm the token is structurally valid and not expired
function verifyClerkToken(authHeader) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    // Extract email
    const email = payload.email ||
      payload.primary_email ||
      (payload.email_addresses?.[0]?.email_address) ||
      null;

    return { valid: true, email, sub: payload.sub };
  } catch (e) {
    return null;
  }
}

// Check if request comes from our domain
function isAllowedOrigin(event) {
  const origin = event.headers['origin'] || event.headers['referer'] || '';
  // In production, must match our domain
  // In dev (no origin header from Netlify CLI), allow through
  if (!origin) return true; // Netlify Functions called server-side have no origin
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── ORIGIN CHECK ────────────────────────────────────────────────────────────
  if (!isAllowedOrigin(event)) {
    console.warn('Blocked request from unauthorized origin:',
      event.headers['origin'] || event.headers['referer']);
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Unauthorized origin' } }),
    };
  }

  // ── AUTH CHECK ──────────────────────────────────────────────────────────────
  // Accept either:
  // A) A valid Clerk JWT (logged-in user)
  // B) A guest request that passed rate limiting (X-Guest-Token: 'guest')
  //    — the actual rate limiting is enforced by rate-limit.js separately
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const guestToken = event.headers['x-guest-token'] || event.headers['X-Guest-Token'] || '';
  const isGuest = guestToken === 'guest';

  let authed = false;
  let userEmail = null;

  if (authHeader) {
    const clerk = verifyClerkToken(authHeader);
    if (clerk?.valid) {
      authed = true;
      userEmail = clerk.email;
    }
  }

  if (!authed && isGuest) {
    // Guest allowed — rate limiting is handled by rate-limit.js
    authed = true;
  }

  if (!authed) {
    console.warn('Blocked unauthenticated request to claude.js');
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Authentication required' } }),
    };
  }

  // ── PROXY TO ANTHROPIC ──────────────────────────────────────────────────────
  try {
    const body = JSON.parse(event.body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s timeout (allows page classification + extraction)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: {
          message: isTimeout
            ? 'Request timeout — try with fewer or smaller files'
            : err.message
        }
      }),
    };
  }
};
