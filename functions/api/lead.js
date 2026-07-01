// AutoGrow — Lead capture (merged). Two flows, branched on client_id:
//
//  A) DEMO FUNNEL (no client_id): { email, name, business, website, industry }
//     Someone trying the demo wants AutoGrow → email Derick. (v1 behaviour — money path.)
//
//  B) WIDGET (client_id present): { client_id, email, phone, message, page }
//     A visitor on a CLIENT's site left contact info → store + notify the business.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json' }, 400);
  }

  const clientId = (body.client_id || '').toString().trim();
  return clientId ? widgetLead(context, body, clientId) : demoLead(context, body);
}

// ── A) Demo funnel lead → email Derick (v1 behaviour, preserved) ──────────────
async function demoLead(context, body) {
  const { env } = context;
  const { email, name, business, website, industry } = body;
  if (!email || !/.+@.+\..+/.test(email)) return json({ error: 'valid email required' }, 400);

  const lead = { email, name, business, website, industry, at: new Date().toISOString() };
  console.log('AUTOGROW_LEAD', JSON.stringify(lead));

  const key = env.RESEND_API_KEY;
  if (!key) return json({ ok: true, queued: true });

  const html =
    '<h2>New chatbot lead from the demo</h2>' +
    '<p><b>Email:</b> ' + esc(email) + '</p>' +
    '<p><b>Name:</b> ' + esc(name || '—') + '</p>' +
    '<p><b>Business:</b> ' + esc(business || '—') + '</p>' +
    '<p><b>Website:</b> ' + esc(website || '—') + '</p>' +
    '<p><b>Industry:</b> ' + esc(industry || '—') + '</p>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AutoGrow Leads <leads@autogrow.org>',
        to: ['derick@autogrow.org'],
        reply_to: email,
        subject: 'New AutoGrow lead: ' + (business || email),
        html
      })
    });
    if (!r.ok) { console.log('RESEND_ERROR', await r.text()); return json({ ok: true, queued: true }); }
    return json({ ok: true, sent: true });
  } catch (e) {
    return json({ ok: true, queued: true });
  }
}

// ── B) Widget lead → store + notify the business ──────────────────────────────
async function widgetLead(context, body, clientId) {
  const { env } = context;
  const email = (body.email || '').toString().slice(0, 200).trim();
  const phone = (body.phone || '').toString().slice(0, 60).trim();
  if (!email && !phone) return json({ error: 'email or phone required' }, 400);

  const lead = {
    client_id: clientId,
    email,
    phone,
    message: (body.message || '').toString().slice(0, 1000),
    page: (body.page || '').toString().slice(0, 500),
    ts: body.ts || Date.now()
  };

  // Store
  if (env.CLIENTS) {
    try {
      await env.CLIENTS.put('lead:' + clientId + ':' + lead.ts, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 });
    } catch (e) {
      console.error('lead store error', e.message);
    }
  }

  // Notify the business (falls back to Derick if the client has no notify email)
  let record = null;
  try {
    const raw = env.CLIENTS && (await env.CLIENTS.get('client:' + clientId));
    record = raw ? JSON.parse(raw) : null;
  } catch (e) {}
  const cfg = (record && record.config) || {};
  const to = cfg.notifyEmail || record?.email || env.LEADS_NOTIFY_EMAIL || 'derick@autogrow.org';

  if (to && env.RESEND_API_KEY) {
    const name = cfg.business || record?.name || clientId;
    const html =
      '<h2>New lead from your AutoGrow chatbot</h2>' +
      '<p><b>Business:</b> ' + esc(name) + '</p>' +
      (email ? '<p><b>Email:</b> ' + esc(email) + '</p>' : '') +
      (phone ? '<p><b>Phone:</b> ' + esc(phone) + '</p>' : '') +
      (lead.message ? '<p><b>They said:</b><br>' + esc(lead.message) + '</p>' : '') +
      (lead.page ? '<p><b>Page:</b> ' + esc(lead.page) + '</p>' : '');
    context.waitUntil(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.LEADS_FROM_EMAIL || 'AutoGrow Leads <leads@autogrow.org>',
          to: [to],
          reply_to: email || undefined,
          subject: '🔔 New lead from ' + name + (email ? ' (' + email + ')' : ''),
          html
        })
      }).catch(() => {})
    );
  }

  return json({ ok: true });
}
