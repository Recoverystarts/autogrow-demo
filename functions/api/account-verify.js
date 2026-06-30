// AutoGrow — Verify a magic login token, open a real Stripe Billing Portal session.
// Single-use: the token is deleted on first use whether it succeeds or not.
// AutoGrow never builds its own cancel/billing UI — Stripe's own portal handles it.

export async function onRequestGet(context) {
  const CLIENTS = context.env.CLIENTS;
  const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;
  const url = new URL(context.request.url);
  const token = url.searchParams.get('token');

  const expired = () => Response.redirect('https://autogrow.org/account/?error=expired', 302);

  if (!CLIENTS || !STRIPE_SECRET_KEY || !token) return expired();

  try {
    const clientId = await CLIENTS.get(`login:${token}`);
    if (!clientId) return expired(); // already used, or never existed, or timed out

    await CLIENTS.delete(`login:${token}`); // single use, regardless of outcome below

    const recordStr = await CLIENTS.get(`client:${clientId}`);
    const record = recordStr ? JSON.parse(recordStr) : null;
    if (!record || !record.stripe_customer_id) return expired();

    const body = new URLSearchParams({
      customer: record.stripe_customer_id,
      return_url: 'https://autogrow.org/account/',
    });

    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const portal = await portalRes.json();
    if (!portalRes.ok || !portal.url) {
      console.error('Stripe portal session failed:', JSON.stringify(portal));
      return expired();
    }

    return Response.redirect(portal.url, 302);
  } catch (e) {
    console.error('account-verify error:', e);
    return expired();
  }
}
