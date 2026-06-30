// AutoGrow — Client Info API
// Returns client record for the welcome page after Stripe checkout
// Called with ?session_id=cs_xxx to look up client by checkout session

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const CLIENTS = context.env.CLIENTS;
  const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;

  if (!CLIENTS) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('session_id');
  const clientId = url.searchParams.get('client_id');

  if (!sessionId && !clientId) {
    return new Response(JSON.stringify({ error: 'Missing session_id or client_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  try {
    let resolvedClientId = clientId;

    // If we have a session_id, look up the client_id
    if (sessionId && !resolvedClientId) {
      resolvedClientId = await CLIENTS.get(`session:${sessionId}`);

      // If not found yet (webhook might not have fired), try creating from Stripe
      if (!resolvedClientId && STRIPE_SECRET_KEY) {
        resolvedClientId = await createClientFromSession(sessionId, STRIPE_SECRET_KEY, CLIENTS);
      }
    }

    if (!resolvedClientId) {
      return new Response(JSON.stringify({
        error: 'not_found',
        message: 'Your account is being set up. Please refresh in a few seconds.',
        retry: true
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Get the full client record
    const recordStr = await CLIENTS.get(`client:${resolvedClientId}`);
    if (!recordStr) {
      return new Response(JSON.stringify({
        error: 'not_found',
        message: 'Client record not found.',
        retry: true
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const record = JSON.parse(recordStr);

    // Build the embed snippet for this client
    const embedSnippet = `<script src="https://autogrow-demo.pages.dev/widget.js" data-client="${record.client_id}" data-api="https://autogrow-demo.pages.dev/api/chat"></script>`;

    return new Response(JSON.stringify({
      client_id: record.client_id,
      name: record.name,
      email: record.email,
      status: record.status,
      created_at: record.created_at,
      embed_snippet: embedSnippet,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    console.error('Client info error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

// Create client record directly from Stripe session (handles race condition
// where redirect arrives before webhook)
async function createClientFromSession(sessionId, stripeKey, CLIENTS) {
  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
      }
    });

    if (!response.ok) return null;

    const session = await response.json();

    // Only process completed subscription checkouts
    if (session.payment_status !== 'paid' && session.status !== 'complete') return null;
    if (session.mode !== 'subscription') return null;

    // Generate client ID
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let newClientId = 'ag_';
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    for (const byte of array) {
      newClientId += chars[byte % chars.length];
    }

    const clientRecord = {
      client_id: newClientId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      email: session.customer_details?.email || '',
      name: session.customer_details?.name || '',
      domain: '',
      config: {},
      status: 'active',
      created_at: new Date().toISOString(),
      checkout_session_id: sessionId,
    };

    await CLIENTS.put(`client:${newClientId}`, JSON.stringify(clientRecord));
    await CLIENTS.put(`stripe:${session.subscription}`, newClientId);
    await CLIENTS.put(`session:${sessionId}`, newClientId);

    console.log(`✅ Client created on-demand: ${newClientId} for ${clientRecord.email}`);
    return newClientId;

  } catch (err) {
    console.error('Failed to create client from session:', err);
    return null;
  }
}
