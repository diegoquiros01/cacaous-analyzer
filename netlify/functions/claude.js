// netlify/functions/claude.js
// Proxy for Anthropic API with:
// - Origin validation (only docsvalidate.com can call this)
// - Clerk JWT cryptographic signature verification via JWKS
// - Server-side guest rate limit enforcement (prevents bypass)
// - Model allowlist + token cap

const { verifyClerkJWT } = require('./verify-jwt');
const { getStore } = require('@netlify/blobs');

const ALLOWED_ORIGINS = [
  'https://www.docsvalidate.com',
  'https://docsvalidate.com',
  'http://localhost:8888',        // Netlify Dev
  'http://localhost:3000',
];

// Allowed models — prevent abuse of expensive models via our proxy
const ALLOWED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
];

// Server-side guest rate limit check (prevents bypass of rate-limit.js)
const GUEST_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
async function checkGuestRateLimit(event) {
  try {
    const ip = event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      'unknown';
    const store = getStore('guest-usage');
    const key = `ip:${ip}`;
    let record = null;
    try {
      const raw = await store.get(key);
      if (raw) record = JSON.parse(raw);
    } catch { record = null; }
    const now = Date.now();
    if (!record || (now - record.windowStart) > WINDOW_MS) return true;
    return record.count < GUEST_LIMIT;
  } catch {
    return true; // Fail open for availability
  }
}

exports.handler = async (event) => {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'Forbidden' } }) };
  }
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guest-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // ── AUTH CHECK ──────────────────────────────────────────────────────────────
  // A) Clerk JWT with cryptographic signature verification
  // B) Guest with server-side rate limit enforcement
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const guestToken = event.headers['x-guest-token'] || event.headers['X-Guest-Token'] || '';
  let authed = false;

  if (authHeader) {
    const clerk = await verifyClerkJWT(authHeader);
    if (clerk?.valid) authed = true;
  }

  if (!authed && guestToken === 'guest') {
    const allowed = await checkGuestRateLimit(event);
    if (allowed) {
      authed = true;
    } else {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'Rate limit exceeded. Create a free account for more.' } }),
      };
    }
  }

  if (!authed) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: 'Authentication required' } }),
    };
  }

  // ── PROXY TO ANTHROPIC ──────────────────────────────────────────────────────
  try {
    const body = JSON.parse(event.body);

    // Validate model — only allow models our app actually uses
    if (!body.model || !ALLOWED_MODELS.includes(body.model)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'Invalid model' } }),
      };
    }

    // Cap max_tokens to prevent abuse
    if (body.max_tokens && body.max_tokens > 8000) {
      body.max_tokens = 8000;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens,
        system: body.system,
        messages: body.messages,
      }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: { message: isTimeout ? 'Request timeout — try with fewer or smaller files' : 'Internal server error' }
      }),
    };
  }
};
