// AutoGrow — Lead capture from the demo. Emails Derick via Resend; logs as fallback.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestPost(context) {
  try {
    const { email, name, business, website, industry } = await context.request.json();
    if (!email || !/.+@.+\..+/.test(email)) return json({ error: 'valid email required' }, 400);

    const lead = { email, name, business, website, industry, at: new Date().toISOString() };
    console.log('AUTOGROW_LEAD', JSON.stringify(lead));   // always retrievable in logs

    const key = context.env.RESEND_API_KEY;
    if (!key) return json({ ok: true, queued: true });     // UX still succeeds

    const html = '<h2>New chatbot lead from the demo</h2>' +
      '<p><b>Email:</b> ' + esc(email) + '</p>' +
      '<p><b>Name:</b> ' + esc(name || '—') + '</p>' +
      '<p><b>Business:</b> ' + esc(business || '—') + '</p>' +
      '<p><b>Website:</b> ' + esc(website || '—') + '</p>' +
      '<p><b>Industry:</b> ' + esc(industry || '—') + '</p>';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AutoGrow Leads <leads@autogrow.org>',
        to: ['derick@autogrow.org'],
        reply_to: email,
        subject: 'New AutoGrow lead: ' + (business || email),
        html: html,
      }),
    });
    if (!r.ok) { console.log('RESEND_ERROR', await r.text()); return json({ ok: true, queued: true }); }
    return json({ ok: true, sent: true });
  } catch (e) {
    return json({ error: 'internal' }, 500);
  }
}
