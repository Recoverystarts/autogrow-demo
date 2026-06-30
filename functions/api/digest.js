// AutoGrow — Daily Digest Email Generator
// Hit this endpoint daily (via cron, Rhizome, or manual) to send each active
// client a summary of what their chatbot did in the last 24 hours.
// Secured with a simple bearer token (DIGEST_SECRET env var).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const CLIENTS = context.env.CLIENTS;
  const RESEND_KEY = context.env.RESEND_API_KEY;
  const DIGEST_SECRET = context.env.DIGEST_SECRET;

  // Simple auth — prevent random hits from triggering mass emails
  const authHeader = context.request.headers.get('Authorization') || '';
  if (DIGEST_SECRET && authHeader !== `Bearer ${DIGEST_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  if (!CLIENTS || !RESEND_KEY) {
    return new Response(JSON.stringify({ error: 'missing configuration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  try {
    // Get yesterday's date (the day we're reporting on)
    const now = new Date();
    const yesterday = new Date(now - 86400000);
    const dateStr = yesterday.toISOString().split('T')[0];
    const prettyDate = yesterday.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Find all active clients by listing KV keys with prefix "client:"
    const clientKeys = await CLIENTS.list({ prefix: 'client:' });
    const results = [];

    for (const key of clientKeys.keys) {
      const clientId = key.name.replace('client:', '');
      const recordStr = await CLIENTS.get(key.name);
      if (!recordStr) continue;

      const record = JSON.parse(recordStr);
      if (record.status !== 'active') continue;
      if (!record.email) continue;

      // Get yesterday's conversation count
      const counterKey = `stats:${clientId}:${dateStr}`;
      const msgCount = parseInt(await CLIENTS.get(counterKey) || '0');

      // Get a sample of conversations for the digest
      const convKeys = await CLIENTS.list({
        prefix: `conv:${clientId}:${dateStr}:`,
        limit: 10
      });

      const conversations = [];
      for (const ck of convKeys.keys) {
        const turnStr = await CLIENTS.get(ck.name);
        if (turnStr) {
          try { conversations.push(JSON.parse(turnStr)); } catch {}
        }
      }

      // Build the top questions summary
      const topQuestions = conversations.slice(0, 5).map(c =>
        `<li style="margin-bottom: 8px; color: #334155;">"${escHtml(c.user)}"</li>`
      ).join('');

      // Only send digest if there was activity
      if (msgCount === 0) {
        results.push({ clientId, email: record.email, status: 'skipped', reason: 'no activity' });
        continue;
      }

      const firstName = (record.name || '').split(' ')[0] || 'there';
      const businessName = record.config?.business || record.name || 'your business';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
          <div style="background: linear-gradient(135deg, #16a34a, #15803d); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #fff; font-size: 1.3rem; margin: 0;">Your Chatbot's Daily Report</h1>
            <p style="color: #bbf7d0; font-size: 0.85rem; margin: 4px 0 0;">${prettyDate}</p>
          </div>
          <div style="background: #fff; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="font-size: 1rem; color: #334155;">Hi ${escHtml(firstName)},</p>
            <p style="font-size: 0.95rem; color: #475569; line-height: 1.6;">Your AI chatbot handled <strong style="color: #16a34a; font-size: 1.2rem;">${msgCount}</strong> conversation${msgCount === 1 ? '' : 's'} yesterday. Here's what visitors asked about:</p>
            ${topQuestions ? `
            <div style="background: #f8fafc; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #e2e8f0;">
              <p style="font-weight: 600; color: #1e293b; margin-bottom: 8px; font-size: 0.9rem;">Top questions:</p>
              <ul style="padding-left: 20px; margin: 0;">${topQuestions}</ul>
            </div>` : ''}
            <div style="background: #f0fdf4; border-radius: 10px; padding: 16px; margin: 16px 0; border: 1px solid #bbf7d0; text-align: center;">
              <p style="font-size: 0.85rem; color: #15803d; margin: 0;">Each conversation your chatbot handles would cost <strong>$2-5 in staff time</strong>.<br>Yesterday's savings estimate: <strong style="color: #166534;">$${(msgCount * 3).toFixed(0)}</strong></p>
            </div>
          </div>
          <div style="background: #f8fafc; padding: 16px 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
            <p style="font-size: 0.82rem; color: #94a3b8; margin: 0;">Your chatbot from <a href="https://autogrow.org" style="color: #16a34a; text-decoration: none;">AutoGrow AI</a> &middot; <a href="https://autogrow.org/account/" style="color: #94a3b8;">Manage subscription</a></p>
          </div>
        </div>`;

      // Send the digest email
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AutoGrow AI <info@autogrow.org>',
          to: [record.email],
          reply_to: 'support@autogrow.org',
          subject: `Your chatbot handled ${msgCount} conversation${msgCount === 1 ? '' : 's'} yesterday`,
          html: html,
        }),
      });

      results.push({
        clientId,
        email: record.email,
        status: emailResp.ok ? 'sent' : 'failed',
        conversations: msgCount
      });
    }

    // Summary email to Derick
    const sent = results.filter(r => r.status === 'sent');
    if (sent.length > 0) {
      const summaryHtml = `<h2>Daily Digest Summary — ${prettyDate}</h2>` +
        sent.map(r => `<p>${r.email}: ${r.conversations} conversations</p>`).join('') +
        `<p style="color: #64748b;">${results.filter(r => r.status === 'skipped').length} clients had no activity (digest skipped)</p>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AutoGrow Ops <info@autogrow.org>',
          to: ['derick@autogrow.org'],
          subject: `📊 Daily digest sent to ${sent.length} client${sent.length === 1 ? '' : 's'}`,
          html: summaryHtml,
        }),
      });
    }

    return new Response(JSON.stringify({
      date: dateStr,
      clientsProcessed: results.length,
      digestsSent: sent ? sent.length : 0,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    console.error('Digest error:', err);
    return new Response(JSON.stringify({ error: 'digest failed', details: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
