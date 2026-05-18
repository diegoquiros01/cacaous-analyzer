// netlify/functions/rate-limit.js
// IP-based usage tracking for guest users (not logged in)
// Uses Netlify Blobs — no external database needed
// Limit: 3 free analyses per IP per day
// Admin bypass: requests from ADMIN_EMAIL get unlimited access

const { getStore } = require('@netlify/blobs');

// JWT verification inlined to avoid Netlify bundler caching stale module
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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;


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

const ALLOWED_ORIGINS = [
  'https://www.docsvalidate.com',
  'https://docsvalidate.com',
  'http://localhost:8888',
  'http://localhost:3000',
];

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    // ── ADMIN BYPASS: unlimited validations (JWT signature verified) ─────
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const clerk = await verifyClerkJWT(authHeader);
    const requestEmail = clerk?.email || null;
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
