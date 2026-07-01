// AutoGrow — Dashboard data (transparency analytics)
// GET /api/dashboard/:id?key=<dashboardToken>   (or Authorization: Bearer <token>)
// Reads v1's conversation logs (conv:/stats: keys — same data digest.js uses).
// Access gated by the client's config.dashboardToken or the ADMIN_TOKEN.

import { CORS, json, bad, getClient, clientConfig } from '../_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = params.id;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  const record = await getClient(env, id);
  if (!record) return bad('Not found', 404);
  const cfg = clientConfig(record);

  const authorized = key && (key === cfg.dashboardToken || (env.ADMIN_TOKEN && key === env.ADMIN_TOKEN));
  if (!authorized) return bad('Unauthorized', 401);

  // Per-day counts for the last 30 days (v1 stats: keys)
  const days = [];
  let monthTotal = 0;
  if (env.CLIENTS) {
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      let n = 0;
      try {
        n = parseInt((await env.CLIENTS.get('stats:' + id + ':' + iso)) || '0', 10);
      } catch (e) {}
      days.push({ date: iso, count: n });
      monthTotal += n;
    }
  }

  // Recent turns + top questions (v1 conv: keys → { time, user, bot })
  const recent = [];
  const questionFreq = {};
  if (env.CLIENTS) {
    try {
      const list = await env.CLIENTS.list({ prefix: 'conv:' + id + ':', limit: 400 });
      // Keys embed an ISO timestamp so ascending sort ≈ chronological; take newest.
      const keys = list.keys.map((k) => k.name).sort().slice(-60).reverse();
      for (const name of keys.slice(0, 40)) {
        const raw = await env.CLIENTS.get(name);
        if (!raw) continue;
        const c = JSON.parse(raw);
        const ts = c.time ? Date.parse(c.time) : null;
        recent.push({ q: c.user, a: c.bot, ts, model: c.model });
        const norm = normalizeQuestion(c.user);
        if (norm) questionFreq[norm] = (questionFreq[norm] || 0) + 1;
      }
    } catch (e) {
      console.error('dashboard list error', e.message);
    }
  }

  const topQuestions = Object.keys(questionFreq)
    .map((q) => ({ q, count: questionFreq[q] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return json({
    business: cfg.business || record.name || id,
    model: cfg.model || 'gemini',
    monthTotal,
    days,
    topQuestions,
    recent,
    billingUrl: env.STRIPE_PORTAL_URL || cfg.billingUrl || 'https://autogrow.org/account/',
    provisionedAt: record.created_at || null,
    status: record.status || 'active'
  });
}

function normalizeQuestion(q) {
  if (!q) return '';
  const s = q.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
  if (s.length < 4) return '';
  return s.split(' ').slice(0, 8).join(' ');
}
