// AutoGrow — Request a magic login link
// Looks up the email index, mints a short-lived single-use token, emails the link.
// Always responds the same way regardless of whether the email matched anything —
// this is deliberate, so the endpoint can't be used to check which emails are customers.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const GENERIC_RESPONSE = { ok: true, message: "If that email has an AutoGrow account, a login link is on its way." };

export async function onRequestPost(context) {
  const CLIENTS = context.env.CLIENTS;
  if (!CLIENTS) return json({ error: 'Server configuration error' }, 500);

  try {
    const { email } = await context.request.json();
    if (!email || !/.+@.+\..+/.test(email)) return json({ error: 'valid email required' }, 400);

    const normalizedEmail = email.toLowerCase().trim();
    const clientId = await CLIENTS.get(`email:${normalizedEmail}`);

    // No match (or no longer active) — respond generically, don't reveal which it was.
    if (!clientId) return json(GENERIC_RESPONSE);

    const recordStr = await CLIENTS.get(`client:${clientId}`);
    const record = recordStr ? JSON.parse(recordStr) : null;
    if (!record || record.status !== 'active') return json(GENERIC_RESPONSE);

    const token = generateToken();
    // 15-minute single-use token
    await CLIENTS.put(`login:${token}`, clientId, { expirationTtl: 900 });

    const verifyUrl = `https://autogrow-demo.pages.dev/api/account-verify?token=${token}`;

    const key = context.env.RESEND_API_KEY;
    if (key) {
      const html =
        '<h2>Manage your AutoGrow account</h2>' +
        '<p>Click below to securely view and manage your subscription. This link works once and expires in 15 minutes.</p>' +
        '<p><a href="' + esc(verifyUrl) + '" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Manage my account</a></p>' +
        '<p style="color:#888;font-size:13px;">Didn\'t request this? You can safely ignore this email.</p>';

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AutoGrow Account <noreply@autogrow.org>',
          to: [record.email],
          subject: 'Your AutoGrow account login link',
          html: html,
        }),
      });
      if (!r.ok) console.log('RESEND_ERROR', await r.text());
    }

    return json(GENERIC_RESPONSE);
  } catch (e) {
    console.error('account-request-link error:', e);
    return json({ error: 'internal' }, 500);
  }
}
