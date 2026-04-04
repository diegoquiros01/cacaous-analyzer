// netlify/functions/create-checkout.js
// Creates a Stripe Checkout Session with client_reference_id for reliable user linking.
// Called from pricing.html when user clicks Subscribe.

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

// Price IDs — monthly and annual for each plan
// Update these if you change products in Stripe Dashboard
const PRICES = {
  professional_monthly: 'price_1TDa3bFZXtgfLmPeNZAjubq9',
  professional_annual:  'price_1TIcmzFZXtgfLmPeC2gaiBxU',
  enterprise_monthly:   'price_1TDa3xFZXtgfLmPe75FrukTG',
  enterprise_annual:    'price_1TIcpoFZXtgfLmPeG8E6neTO',
};

const ALLOWED_ORIGINS = ['https://www.docsvalidate.com', 'https://docsvalidate.com', 'http://localhost:8888', 'http://localhost:3000'];

function getCorsHeaders(event) {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

exports.handler = async (event) => {
  const CORS = getCorsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { plan, billing, clerk_id, email } = JSON.parse(event.body || '{}');

    if (!plan || !clerk_id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing plan or clerk_id' }) };
    }

    // Determine price ID
    const key = plan + '_' + (billing === 'annual' ? 'annual' : 'monthly');
    const priceId = PRICES[key];
    if (!priceId) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid plan: ' + key }) };
    }

    // Create Stripe Checkout Session via API (no SDK needed)
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('client_reference_id', clerk_id);
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', 'https://www.docsvalidate.com/?checkout=success');
    params.append('cancel_url', 'https://www.docsvalidate.com/pricing.html?checkout=cancelled');
    if (email) {
      params.append('customer_email', email);
    }
    // Allow promotion codes
    params.append('allow_promotion_codes', 'true');

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      console.error('Stripe error:', JSON.stringify(session));
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: session.error?.message || 'Stripe error' }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('create-checkout error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
