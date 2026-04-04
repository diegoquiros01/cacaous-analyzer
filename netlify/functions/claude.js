// netlify/functions/claude.js
// Proxy for Anthropic API — avoids CORS when called from the browser

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

exports.handler = async (event) => {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'Forbidden origin' } }) };
  }
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guest-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // Require some form of auth — either a Clerk JWT or the guest token
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const guestToken = event.headers['x-guest-token'] || event.headers['X-Guest-Token'] || '';
  if (!authHeader && !guestToken) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: 'Authentication required' } }),
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Validate model — only allow models our app actually uses
    if (!body.model || !ALLOWED_MODELS.includes(body.model)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'Invalid or disallowed model: ' + (body.model || 'none') } }),
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
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
