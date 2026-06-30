// AutoGrow — Stripe Webhook Handler
// Creates and manages client records in Cloudflare KV
// This is THE SPINE — everything depends on client_id existing

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Generate unique client ID: ag_ + 8 random alphanumeric chars
function generateClientId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'ag_';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (const byte of array) {
    id += chars[byte % chars.length];
  }
  return id;
}

// Verify Stripe webhook signature
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const elements = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = elements['t'];
  const signature = elements['v1'];

  if (!timestamp || !signature) return false;

  // Reject if timestamp is more than 5 minutes old
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expectedSig === signature;
}

export async function onRequestPost(context) {
  const STRIPE_WEBHOOK_SECRET = context.env.STRIPE_WEBHOOK_SECRET;
  const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;
  const CLIENTS = context.env.CLIENTS; // KV binding

  if (!CLIENTS) {
    console.error('CLIENTS KV binding not configured');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const rawBody = await context.request.text();
    const sigHeader = context.request.headers.get('stripe-signature');

    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET) {
      const valid = await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
      if (!valid) {
        console.error('Invalid Stripe webhook signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const event = JSON.parse(rawBody);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Only process subscription checkouts
        if (session.mode !== 'subscription') break;

        const clientId = generateClientId();
        const subscriptionId = session.subscription;
        const customerId = session.customer;
        const customerEmail = session.customer_details?.email || '';
        const customerName = session.customer_details?.name || '';

        const clientRecord = {
          client_id: clientId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          email: customerEmail,
          name: customerName,
          domain: '', // Set later during onboarding
          config: {}, // Client chatbot config — set during setup
          status: 'active',
          created_at: new Date().toISOString(),
          checkout_session_id: session.id,
        };

        // Store in KV with two keys for bidirectional lookup
        await CLIENTS.put(`client:${clientId}`, JSON.stringify(clientRecord));
        await CLIENTS.put(`stripe:${subscriptionId}`, clientId);
        await CLIENTS.put(`session:${session.id}`, clientId);

        console.log(`✅ Client created: ${clientId} for ${customerEmail}`);
        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.canceled': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // Look up client by subscription ID
        const clientId = await CLIENTS.get(`stripe:${subscriptionId}`);
        if (clientId) {
          const recordStr = await CLIENTS.get(`client:${clientId}`);
          if (recordStr) {
            const record = JSON.parse(recordStr);
            record.status = 'inactive';
            record.deactivated_at = new Date().toISOString();
            await CLIENTS.put(`client:${clientId}`, JSON.stringify(record));
            console.log(`⛔ Client deactivated: ${clientId}`);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        const clientId = await CLIENTS.get(`stripe:${subscriptionId}`);
        if (clientId) {
          const recordStr = await CLIENTS.get(`client:${clientId}`);
          if (recordStr) {
            const record = JSON.parse(recordStr);
            // Update status based on subscription status
            if (subscription.status === 'active' || subscription.status === 'trialing') {
              record.status = 'active';
            } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
              record.status = 'past_due';
            } else if (subscription.status === 'canceled') {
              record.status = 'inactive';
              record.deactivated_at = new Date().toISOString();
            }
            record.updated_at = new Date().toISOString();
            await CLIENTS.put(`client:${clientId}`, JSON.stringify(record));
            console.log(`📋 Client updated: ${clientId} → ${record.status}`);
          }
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
