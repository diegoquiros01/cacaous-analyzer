// netlify/functions/tracking.js
// Server-side proxy for Make.com carrier tracking webhook.
// Keeps the webhook URL secret (env var) instead of exposing it client-side.

const { verifyClerkJWT } = require('./verify-jwt');

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
