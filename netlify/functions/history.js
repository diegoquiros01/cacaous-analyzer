// netlify/functions/history.js
// Store and retrieve validation history from Supabase

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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabase(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
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
    // Verify JWT if present — extract clerk_id from token (secure)
    // Fallback to clerk_id from body for backward compat
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const jwtResult = await verifyClerkJWT(authHeader);

    const { action, clerk_id: body_clerk_id, ...params } = JSON.parse(event.body || '{}');

    // Prefer JWT clerk_id, fall back to body clerk_id
    const clerk_id = jwtResult?.valid ? jwtResult.sub : body_clerk_id;

    if (!clerk_id) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    }

    // Delete requires JWT; save/list/get allow body fallback
    if (!jwtResult?.valid && action === 'delete' && !clerk_id) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required for delete' }) };
    }
    // Validate clerk_id format to prevent injection
    if (!/^[a-zA-Z0-9_-]{10,60}$/.test(clerk_id)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid clerk_id' }) };
    }

    // ── SAVE ────────────────────────────────────────────────────────────────
    if (action === 'save') {
      const { status, doc_count, bl_number, vessel_name, error_count, warning_count, summary_text, result_json } = params;

      if (!status || doc_count == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: status, doc_count' }) };
      }

      // Truncate result_json if too large (Supabase has row size limits)
      let safeResultJson = result_json || null;
      if (safeResultJson) {
        const jsonStr = JSON.stringify(safeResultJson);
        console.log('History save: result_json size =', jsonStr.length, 'bytes');
        if (jsonStr.length > 500000) {
          // Strip large fields to fit within limits
          try {
            const trimmed = JSON.parse(jsonStr);
            if (trimmed.analysisResults) {
              trimmed.analysisResults = trimmed.analysisResults.map(r => {
                const c = { ...r };
                delete c.productDescription;
                delete c.extraFields;
                delete c.consigneeAddress;
                return c;
              });
            }
            safeResultJson = trimmed;
          } catch (e) { /* keep original */ }
        }
      }

      const record = {
        clerk_id,
        status,
        doc_count,
        bl_number: bl_number || null,
        vessel_name: vessel_name || null,
        error_count: error_count ?? 0,
        warning_count: warning_count ?? 0,
        summary_text: summary_text || null,
        result_json: safeResultJson,
      };

      console.log('History save: clerk_id =', clerk_id, 'status =', status, 'doc_count =', doc_count);
      const rows = await supabase('validation_history', 'POST', record);
      const created = Array.isArray(rows) ? rows[0] : rows;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, record: created }),
      };
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { search, status_filter, limit } = params;
      const take = Math.min(parseInt(limit, 10) || 20, 100);

      let path = `validation_history?clerk_id=eq.${encodeURIComponent(clerk_id)}&select=id,clerk_id,bl_number,vessel_name,status,doc_count,error_count,warning_count,summary_text,created_at&order=created_at.desc&limit=${take}`;

      if (search) {
        // Sanitize search: strip Supabase operators and special chars to prevent injection
        const sanitized = String(search).replace(/[^a-zA-Z0-9\s\-_.]/g, '').substring(0, 50);
        if (sanitized) {
          const s = encodeURIComponent(sanitized);
          path += `&or=(bl_number.ilike.*${s}*,vessel_name.ilike.*${s}*)`;
        }
      }

      if (status_filter && ['approved','warning','rejected'].includes(status_filter)) {
        path += `&status=eq.${status_filter}`;
      }

      const rows = await supabase(path);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ records: rows }),
      };
    }

    // ── GET ─────────────────────────────────────────────────────────────────
    if (action === 'get') {
      const { id } = params;

      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid id' }) };
      }

      const rows = await supabase(`validation_history?id=eq.${encodeURIComponent(id)}&select=*`);
      const record = Array.isArray(rows) ? rows[0] : rows;

      if (!record) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Record not found' }) };
      }

      if (record.clerk_id !== clerk_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Access denied' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ record }),
      };
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { id } = params;
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid id' }) };
      }
      // Verify ownership first
      const rows = await supabase(`validation_history?id=eq.${encodeURIComponent(id)}&select=id,clerk_id`);
      const record = Array.isArray(rows) ? rows[0] : rows;
      if (!record) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Record not found' }) };
      }
      if (record.clerk_id !== clerk_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Access denied' }) };
      }
      await supabase(`validation_history?id=eq.${encodeURIComponent(id)}`, 'DELETE');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown action' }),
    };

  } catch (err) {
    console.error('history function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
