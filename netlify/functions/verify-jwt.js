// netlify/functions/verify-jwt.js
// Shared module: Verify Clerk JWTs using JWKS (public key fetched from Clerk)
// This replaces the insecure base64-decode-only approach.

const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL || 'https://accounts.docsvalidate.com/.well-known/jwks.json';

let _cachedJWKS = null;
let _cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fetch Clerk's JWKS (public keys) with caching
async function getJWKS() {
  const now = Date.now();
  if (_cachedJWKS && (now - _cachedAt) < CACHE_TTL) return _cachedJWKS;

  const res = await fetch(CLERK_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  const jwks = await res.json();
  _cachedJWKS = jwks;
  _cachedAt = now;
  return jwks;
}

// Import a JWK as a CryptoKey for verification
async function importKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

// Base64url decode (handles missing padding)
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// Verify a Clerk JWT and return the payload if valid, or null if invalid
async function verifyClerkJWT(authHeader) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode header to get key ID (kid)
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    // Check not-before
    if (payload.nbf && payload.nbf > now + 30) return null; // 30s clock skew tolerance

    // Fetch JWKS and find matching key
    const jwks = await getJWKS();
    const jwk = jwks.keys.find(k => k.kid === header.kid);
    if (!jwk) {
      // Key not found — force refresh cache and try again
      _cachedJWKS = null;
      const freshJwks = await getJWKS();
      const freshJwk = freshJwks.keys.find(k => k.kid === header.kid);
      if (!freshJwk) return null;
      return await _verifyWithKey(freshJwk, parts, payload);
    }

    return await _verifyWithKey(jwk, parts, payload);
  } catch (e) {
    console.error('JWT verification error:', e.message);
    return null;
  }
}

async function _verifyWithKey(jwk, parts, payload) {
  const key = await importKey(jwk);
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const signature = base64urlDecode(parts[2]);

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) return null;

  // Extract email from Clerk payload
  const email = payload.email ||
    payload.primary_email ||
    (payload.email_addresses?.[0]?.email_address) ||
    null;

  return { valid: true, email, sub: payload.sub, payload };
}

module.exports = { verifyClerkJWT };
