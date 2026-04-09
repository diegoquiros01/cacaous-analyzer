// netlify/functions/stripe-webhook.js
// Listens to Stripe live events and keeps Supabase in sync.
//
// SETUP CHECKLIST (do this once in Stripe Dashboard):
// 1. Go to Developers → Webhooks → Add endpoint
// 2. Endpoint URL: https://www.docsvalidate.com/.netlify/functions/stripe-webhook
// 3. Select events:
//      checkout.session.completed
//      customer.subscription.updated
//      customer.subscription.deleted
//      invoice.payment_failed
// 4. Copy the Webhook Signing Secret (whsec_xxx) → add to Netlify env as STRIPE_WEBHOOK_SECRET
//
// REQUIRED ENV VARS in Netlify:
//   STRIPE_SECRET_KEY      — your live secret key (sk_live_xxx)
//   STRIPE_WEBHOOK_SECRET  — from Stripe webhook endpoint (whsec_xxx)
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// ─────────────────────────────────────────────────────────────────────────────
// PRICE ID → PLAN MAPPING
// Fill these in with your actual Stripe Price IDs from Stripe Dashboard → Products
// ─────────────────────────────────────────────────────────────────────────────
// Price-to-plan mapping — built from env vars with hardcoded fallbacks
// To add/change prices: set STRIPE_PRICE_* env vars in Netlify
const PRICE_TO_PLAN = {};
// Starter
PRICE_TO_PLAN[process.env.STRIPE_PRICE_STARTER || 'price_1TDa31FZXtgfLmPehPPvJxzZ'] = 'starter';
// Professional
PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_1TJNY8FZXtgfLmPeUZYxVebI'] = 'professional';
PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO_ANNUAL  || 'price_1TJNYSFZXtgfLmPeoLCcQrza'] = 'professional';
// Enterprise
PRICE_TO_PLAN[process.env.STRIPE_PRICE_ENT_MONTHLY || 'price_1TJNbKFZXtgfLmPeq2WJTHT3'] = 'enterprise';
PRICE_TO_PLAN[process.env.STRIPE_PRICE_ENT_ANNUAL  || 'price_1TJNcXFZXtgfLmPede2a7C4b'] = 'enterprise';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// ── Supabase helper ──────────────────────────────────────────────────────────
async function sb(path, method = 'GET', body = null) {
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
  if (!res.ok) throw new Error(`Supabase error on ${path}: ${JSON.stringify(data)}`);
  return data;
}

// ── Stripe API helper ────────────────────────────────────────────────────────
async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` },
  });
  if (!res.ok) throw new Error(`Stripe GET ${path} failed: ${res.status}`);
  return res.json();
}

// ── Verify Stripe webhook signature ─────────────────────────────────────────
// Stripe signs every webhook with HMAC-SHA256. We verify to reject forged requests.
async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) throw new Error('Invalid Stripe signature header');

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);
  const signedPayload = `${timestamp}.${payload}`;

  // Use Web Crypto API (available in Netlify Functions Node 18+)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed !== signature) throw new Error('Stripe signature mismatch');

  // Reject events older than 5 minutes (replay attack protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) throw new Error('Stripe event too old — possible replay attack');

  return true;
}

// ── Webhook deduplication — prevent replay attacks ──────────────────────────
// Stores processed event IDs in Supabase to reject duplicates
async function isEventProcessed(eventId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    return data && data.length > 0;
  } catch { return false; }
}

async function markEventProcessed(eventId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/webhook_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ event_id: eventId, created_at: new Date().toISOString() }),
    });
  } catch (e) { console.warn('Failed to mark event processed:', e.message); }
}

// ── Get plan name from Price ID ──────────────────────────────────────────────
function planFromPriceId(priceId) {
  return PRICE_TO_PLAN[priceId] || null;
}

// ── Update user plan in Supabase by Stripe customer ID ───────────────────────
async function updateUserPlan(stripeCustomerId, newPlan, clerkId = null) {
  const now = new Date().toISOString();
  let users = [];

  // 1. Best: look up by Clerk ID (set via client_reference_id in Payment Link)
  //    This is 100% reliable — no email matching needed
  if (clerkId) {
    users = await sb(`users?clerk_id=eq.${clerkId}&select=*`).catch(() => []);
  }

  // 2. Good: look up by stripe_customer_id (set on previous payments)
  if (!users || users.length === 0) {
    users = await sb(`users?stripe_customer_id=eq.${stripeCustomerId}&select=*`).catch(() => []);
  }

  // 3. Fallback: look up by email from Stripe customer object
  if (!users || users.length === 0) {
    const customer = await stripeGet(`customers/${stripeCustomerId}`);
    const email = customer.email;
    if (!email) {
      console.error('No email found for Stripe customer:', stripeCustomerId);
      return false;
    }
    users = await sb(`users?email=eq.${encodeURIComponent(email)}&select=*`).catch(() => []);
  }

  if (!users || users.length === 0) {
    console.error('User not found in Supabase for Stripe customer:', stripeCustomerId, 'clerkId:', clerkId);
    return false;
  }

  const user = users[0];

  // Update plan + save stripe_customer_id for future lookups + reset counter
  await sb(`users?clerk_id=eq.${user.clerk_id}`, 'PATCH', {
    plan:                 newPlan,
    stripe_customer_id:   stripeCustomerId,
    validations_used:     0,
    last_reset:           now,
    updated_at:           now,
  });

  console.log(`✓ Updated user ${user.email} (clerk: ${user.clerk_id}) to plan: ${newPlan}`);
  return true;
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sigHeader = event.headers['stripe-signature'];
  if (!sigHeader) {
    return { statusCode: 400, body: 'Missing Stripe signature' };
  }

  // Verify signature
  try {
    await verifyStripeSignature(event.body, sigHeader, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 401, body: `Signature error: ${err.message}` };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  console.log('Stripe event received:', stripeEvent.type, stripeEvent.id);

  // Deduplicate — reject already-processed events
  if (await isEventProcessed(stripeEvent.id)) {
    console.log('Duplicate event, skipping:', stripeEvent.id);
    return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  try {
    switch (stripeEvent.type) {

      // ── Checkout completed — customer just paid ─────────────────────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!subscriptionId) {
          // One-time payment (not subscription) — handle if needed
          console.log('One-time payment completed, no subscription to process');
          break;
        }

        // Get subscription to find the Price ID
        const subscription = await stripeGet(`subscriptions/${subscriptionId}`);
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = planFromPriceId(priceId);

        if (!plan) {
          console.error('Unknown price ID:', priceId, '— add it to PRICE_TO_PLAN map');
          break;
        }

        // client_reference_id = Clerk user ID (set in pricing.html buildStripeUrl)
        // This is the most reliable way to find the user — no email matching needed
        const clerkId = session.client_reference_id || null;
        await updateUserPlan(customerId, plan, clerkId);
        break;
      }

      // ── Subscription updated — plan change or renewal ───────────────────
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const customerId = sub.customer;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = planFromPriceId(priceId);

        if (!plan) {
          console.log('Subscription updated but price not in PRICE_TO_PLAN:', priceId);
          break;
        }

        // Only update if subscription is active or trialing
        if (['active', 'trialing'].includes(sub.status)) {
          await updateUserPlan(customerId, plan);
        }
        break;
      }

      // ── Subscription canceled or expired ───────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const customerId = sub.customer;
        const now = new Date().toISOString();

        // Downgrade to starter on cancel
        let users = await sb(`users?stripe_customer_id=eq.${customerId}&select=*`);
        if (!users || users.length === 0) {
          const customer = await stripeGet(`customers/${customerId}`);
          if (customer.email) {
            users = await sb(`users?email=eq.${encodeURIComponent(customer.email)}&select=*`);
          }
        }
        if (users && users.length > 0) {
          await sb(`users?clerk_id=eq.${users[0].clerk_id}`, 'PATCH', {
            plan:               'starter',
            stripe_customer_id: customerId,
            validations_used:   0,
            last_reset:         now,
            updated_at:         now,
          });
          console.log(`✓ Downgraded ${users[0].email} to starter after cancellation`);
        }
        break;
      }

      // ── Payment failed — notify but don't downgrade immediately ─────────
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        console.warn('Payment failed for customer:', invoice.customer, 'attempt:', invoice.attempt_count);
        // Stripe will retry and eventually fire customer.subscription.deleted
        // if all retries fail. No action needed here unless you want to
        // send a custom email — handle that via Stripe's built-in dunning.
        break;
      }

      default:
        console.log('Unhandled event type:', stripeEvent.type);
    }

    // Mark event as processed after successful handling
    await markEventProcessed(stripeEvent.id);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ received: false }) };
  }
};
