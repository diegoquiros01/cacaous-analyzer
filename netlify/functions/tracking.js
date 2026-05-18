// netlify/functions/tracking.js
// Server-side proxy for Make.com carrier tracking webhook.
// Keeps the webhook URL secret (env var) instead of exposing it client-side.

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

const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL;

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  // Verify JWT
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const jwtResult = await verifyClerkJWT(authHeader);
  if (!jwtResult?.valid) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
  }

  if (!MAKE_WEBHOOK) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tracking not configured' }) };
  }

  try {
    const { bl_number, shipping_line } = JSON.parse(event.body || '{}');

    if (!bl_number || !shipping_line) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing bl_number or shipping_line' }) };
    }

    const url = MAKE_WEBHOOK
      + '?bl_number=' + encodeURIComponent(bl_number)
      + '&shipping_line=' + encodeURIComponent(shipping_line);

    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: 'Tracking service error' }) };
    }

    const data = await resp.text();
    return { statusCode: 200, headers, body: data };

  } catch (err) {
    console.error('tracking function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
