// netlify/functions/rate-limit.js
// IP-based usage tracking for guest users (not logged in)
// Uses Netlify Blobs — no external database needed
// Limit: 3 free analyses per IP per day

const { getStore } = require('@netlify/blobs');

const GUEST_LIMIT     = 3;    // max analyses per IP per day
const WINDOW_MS       = 24 * 60 * 60 * 1000; // 24 hours in ms

// Extract real IP — Netlify passes it in headers
function getIP(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');
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
    // On error, allow the request through — don't block users due to infra issues
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowed: true, remaining: 1, limit: 3, count: 0, error: err.message }),
    };
  }
};
