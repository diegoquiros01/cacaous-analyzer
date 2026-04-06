// netlify/functions/history.js
// Store and retrieve validation history from Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, clerk_id, ...params } = JSON.parse(event.body || '{}');

    if (!clerk_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing clerk_id' }) };
    }

    // ── SAVE ────────────────────────────────────────────────────────────────
    if (action === 'save') {
      const { status, doc_count, bl_number, vessel_name, error_count, warning_count, summary_text, result_json } = params;

      if (!status || doc_count == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: status, doc_count' }) };
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
        result_json: result_json || null,
      };

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
        const s = encodeURIComponent(search);
        path += `&or=(bl_number.ilike.*${s}*,vessel_name.ilike.*${s}*)`;
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

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
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
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
