// netlify/functions/stripe-webhook.js
// Receives Stripe events and updates user plan in Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const PRICE_TO_PLAN = {
  // Add your Stripe Price IDs here after creating products
  // e.g. 'price_xxx': 'professional'
  [process.env.STRIPE_PRICE_PRO]:        'professional',
  [process.env.STRIPE_PRICE_ENTERPRISE]: 'enterprise',
};

async function supabaseUpdate(email, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const body = JSON.parse(event.body || '{}');
  const stripeEvent = body;

  console.log('Stripe event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      // Payment succeeded — upgrade plan
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const email = session.customer_details?.email;
        const priceId = session.line_items?.data?.[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'professional';
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (email) {
          await supabaseUpdate(email, {
            plan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            validations_used: 0,
            updated_at: new Date().toISOString(),
          });
          console.log(`Plan updated to ${plan} for ${email}`);
        }
        break;
      }

      // Subscription cancelled or payment failed — downgrade to starter
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const obj = stripeEvent.data.object;
        const customerId = obj.customer;

        // Look up email from Supabase by customer ID
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/users?stripe_customer_id=eq.${customerId}&select=email`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const users = await res.json();
        if (users?.[0]?.email) {
          await supabaseUpdate(users[0].email, {
            plan: 'starter',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          });
          console.log(`Plan downgraded to starter for ${users[0].email}`);
        }
        break;
      }

      // Subscription renewed — reset monthly usage
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        if (invoice.billing_reason === 'subscription_cycle') {
          const customerId = invoice.customer;
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/users?stripe_customer_id=eq.${customerId}&select=email`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          const users = await res.json();
          if (users?.[0]?.email) {
            await supabaseUpdate(users[0].email, {
              validations_used: 0,
              validations_reset_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            console.log(`Monthly usage reset for ${users[0].email}`);
          }
        }
        break;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
