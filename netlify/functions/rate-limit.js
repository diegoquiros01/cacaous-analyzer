// netlify/functions/rate-limit.js
// IP-based usage tracking for guest users (not logged in)
// Uses Netlify Blobs — no external database needed
// Limit: 3 free analyses per IP per day
// Admin bypass: requests from ADMIN_EMAIL get unlimited access

const { getStore } = require('@netlify/blobs');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// Decode Clerk JWT payload to extract email (no crypto verify needed here —
// the Anthropic API call itself is gated; this is just rate limiting)
function getEmailFromJWT(authHeader) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const payload = JSON.parse(
      Buffer.from(authHeader.slice(7).split('.')[1], 'base64url').toString('utf8')
    );
    return (
      payload.email ||
      payload.primary_email ||
      (payload.email_addresses?.[0]?.email_address) ||
      null
    );
  } catch { return null; }
}


const GUEST_LIMIT     = 3;    // max analyses per IP per day
const WINDOW_MS       = 24 * 60 * 60 * 1000; // 24 hours in ms

// Extract real IP — Netlify passes it in headers
function getIP(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    // ── ADMIN BYPASS: unlimited validations ────────────────────────────────
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const requestEmail = getEmailFromJWT(authHeader);
    if (ADMIN_EMAIL && requestEmail && requestEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ allowed: true, remaining: 9999, limit: 9999, count: 0, admin: true }),
      };
    }

    const ip = getIP(event);

    // Use Netlify Blobs — store keyed by IP
    const store = getStore('guest-usage');
    const key   = `ip:${ip}`;

    // Read current record
    let record = null;
    try {
      const raw = await store.get(key);
      if (raw) record = JSON.parse(raw);
    } catch (e) {
      // Key doesn't exist yet — first time this IP visits
      record = null;
    }

    const now = Date.now();

    // Reset if window has passed
    if (!record || (now - record.windowStart) > WINDOW_MS) {
      record = { count: 0, windowStart: now };
    }

    if (action === 'check') {
      // Just return current status — don't increment
      const remaining = Math.max(0, GUEST_LIMIT - record.count);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          allowed:   remaining > 0,
          remaining,
          limit:     GUEST_LIMIT,
          count:     record.count,
          resetAt:   record.windowStart + WINDOW_MS,
        }),
      };
    }

    if (action === 'increment') {
      // Check limit before incrementing
      if (record.count >= GUEST_LIMIT) {
        return {
          statusCode: 429,
          headers: corsHeaders,
          body: JSON.stringify({
            allowed:   false,
            remaining: 0,
            limit:     GUEST_LIMIT,
            count:     record.count,
            resetAt:   record.windowStart + WINDOW_MS,
          }),
        };
      }

      // Increment and save
      record.count += 1;
      await store.set(key, JSON.stringify(record));

      const remaining = Math.max(0, GUEST_LIMIT - record.count);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          allowed:   true,
          remaining,
          limit:     GUEST_LIMIT,
          count:     record.count,
          resetAt:   record.windowStart + WINDOW_MS,
        }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid action. Use "check" or "increment".' }),
    };

  } catch (err) {
    console.error('rate-limit error:', err.message);
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ allowed: false, remaining: 0, limit: GUEST_LIMIT, error: 'Service temporarily unavailable' }),
    };
  }
};
