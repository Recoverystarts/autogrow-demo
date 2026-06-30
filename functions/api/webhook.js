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

// Cancel a Stripe subscription immediately (used for auto-canceling accidental duplicates)
async function cancelStripeSubscription(subscriptionId, secretKey) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${secretKey}` }
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to cancel duplicate subscription:', err);
    return false;
  }
}

// Send welcome email to new client + notification to Derick
async function sendWelcomeEmail(resendKey, clientRecord) {
  if (!resendKey) return; // gracefully skip if Resend not configured

  const { client_id, email, name } = clientRecord;
  const firstName = (name || '').split(' ')[0] || 'there';
  const welcomeUrl = `https://autogrow.org/welcome?client_id=${client_id}`;
  const accountUrl = 'https://autogrow.org/account/';

  // Email to the customer
  const customerHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <div style="background: linear-gradient(135deg, #16a34a, #15803d); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 1.5rem; margin: 0;">Welcome to AutoGrow! 🚀</h1>
      </div>
      <div style="background: #fff; padding: 28px 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 1rem; line-height: 1.7; color: #334155;">Hi ${firstName},</p>
        <p style="font-size: 1rem; line-height: 1.7; color: #334155;">Your AI chatbot is ready to go. Here's how to get it live on your website:</p>
        <div style="background: #f0fdf4; border-radius: 10px; padding: 20px; margin: 20px 0; border: 1px solid #bbf7d0;">
          <p style="margin: 0 0 12px; font-weight: 600; color: #166534;">Three steps to go live:</p>
          <p style="margin: 4px 0; color: #15803d;">1️⃣ Visit your <a href="${welcomeUrl}" style="color: #16a34a; font-weight: 600;">welcome page</a> to get your embed code</p>
          <p style="margin: 4px 0; color: #15803d;">2️⃣ Copy the one-line code snippet</p>
          <p style="margin: 4px 0; color: #15803d;">3️⃣ Paste it into your website — the chatbot on your welcome page knows how to install on every platform</p>
        </div>
        <p style="font-size: 0.9rem; color: #64748b; line-height: 1.7;">Your 14-day free trial has started. You can <a href="${accountUrl}" style="color: #16a34a;">manage your subscription</a> anytime.</p>
        <p style="font-size: 0.9rem; color: #64748b; line-height: 1.7;">Need help? Just reply to this email or reach out at <a href="mailto:support@autogrow.org" style="color: #16a34a;">support@autogrow.org</a>.</p>
        <p style="font-size: 0.9rem; color: #64748b; margin-top: 20px;">— The AutoGrow Team</p>
      </div>
    </div>`;

  // Email to Derick (new client notification)
  const derickHtml = `
    <h2>🎉 New AutoGrow Client!</h2>
    <p><b>Name:</b> ${name || '—'}</p>
    <p><b>Email:</b> ${email}</p>
    <p><b>Client ID:</b> ${client_id}</p>
    <p><b>Time:</b> ${new Date().toISOString()}</p>
    <p>Their welcome page: <a href="${welcomeUrl}">${welcomeUrl}</a></p>`;

  try {
    // Send customer welcome email
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AutoGrow AI <info@autogrow.org>',
        to: [email],
        reply_to: 'support@autogrow.org',
        subject: `Welcome to AutoGrow, ${firstName}! Your chatbot is ready 🚀`,
        html: customerHtml,
      }),
    });

    // Send Derick notification
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AutoGrow Alerts <info@autogrow.org>',
        to: ['derick@autogrow.org'],
        subject: `🎉 New client: ${name || email}`,
        html: derickHtml,
      }),
    });

    console.log(`📧 Welcome email sent to ${email}, notification to Derick`);
  } catch (err) {
    // Don't let email failure break the webhook — the client record is already saved
    console.error('Welcome email error (non-fatal):', err);
  }
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

        const subscriptionId = session.subscription;
        const customerId = session.customer;
        const customerEmail = session.customer_details?.email || '';
        const customerName = session.customer_details?.name || '';
        const normalizedEmail = customerEmail.toLowerCase().trim();

        // Duplicate-account check — same email already has an active client record
        if (normalizedEmail) {
          const existingClientId = await CLIENTS.get(`email:${normalizedEmail}`);
          if (existingClientId) {
            const existingRecordStr = await CLIENTS.get(`client:${existingClientId}`);
            const existingRecord = existingRecordStr ? JSON.parse(existingRecordStr) : null;

            if (existingRecord && existingRecord.status === 'active') {
              // This is a second signup on an email that already has an active subscription.
              // Cancel the new subscription immediately so it never bills, keep the
              // original record as the source of truth, and log it clearly.
              await cancelStripeSubscription(subscriptionId, STRIPE_SECRET_KEY);
              await CLIENTS.put(`session:${session.id}`, existingClientId); // welcome page still resolves correctly
              console.log(`⚠️ Duplicate signup for ${normalizedEmail} — new subscription ${subscriptionId} auto-canceled, existing client ${existingClientId} kept active`);
              break;
            }
          }
        }

        const clientId = generateClientId();

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

        // Store in KV with indexes for lookup by client_id, subscription_id, session_id, and email
        await CLIENTS.put(`client:${clientId}`, JSON.stringify(clientRecord));
        await CLIENTS.put(`stripe:${subscriptionId}`, clientId);
        await CLIENTS.put(`session:${session.id}`, clientId);
        if (normalizedEmail) {
          await CLIENTS.put(`email:${normalizedEmail}`, clientId);
        }

        console.log(`✅ Client created: ${clientId} for ${customerEmail}`);

        // Send welcome email (async, non-blocking — client record already saved)
        await sendWelcomeEmail(context.env.RESEND_API_KEY, clientRecord);
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

