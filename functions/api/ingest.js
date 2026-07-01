// AutoGrow — Ingest / provision  (ADMIN)
// POST /api/ingest   Authorization: Bearer <ADMIN_TOKEN>
// Builds the knowledge base (chunk + embed) and writes chatbot config INTO the
// client's record.config — billing fields (Stripe ids, status, email) are never
// touched. This is the operator tool behind AutoGrow's done-for-you service.
//
// Body: {
//   client_id (e.g. ag_ab12cd34 from Stripe, or a custom demo id),
//   business, greeting?, color?, colors?, starters?, avatarUrl?,
//   model? ("gemini"|"claude"|"claude-fast"|"gpt"), modelId?,
//   systemPrompt?, contact?, notifyEmail?, topN?, dashboardToken?,
//   urls: [...], crawl?, maxPages?, embed? (default true)
// }

import { CORS, json, bad, getClient, patchClientConfig, saveKB, chunkText, embed } from './_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get('Authorization') || '';
  if (!env.ADMIN_TOKEN || auth.replace(/^Bearer\s+/i, '') !== env.ADMIN_TOKEN) return bad('Unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad('Invalid JSON');
  }

  // Client IDs: allow Stripe's ag_xxxx (underscore) and custom demo ids.
  const clientId = (body.client_id || '').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clientId) return bad('client_id required');

  const existing = await getClient(env, clientId);
  const existingCfg = (existing && existing.config) || {};

  // ── Crawl + extract ───────────────────────────────────────────────────────
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const maxPages = Math.min(body.maxPages || 12, 25);
  const pages = [];
  const seen = new Set();
  const queue = urls.slice();

  while (queue.length && pages.length < maxPages) {
    const raw = queue.shift();
    let u;
    try {
      u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    } catch (e) {
      continue;
    }
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    try {
      const r = await fetch(u.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoGrowBot/2.0; +https://autogrow.org)', Accept: 'text/html' },
        redirect: 'follow'
      });
      if (!r.ok) continue;
      const html = await r.text();
      const text = htmlToText(html);
      if (text.length > 80) pages.push({ url: u.href, text });
      if (body.crawl && pages.length === 1) {
        extractLinks(html, u).forEach((link) => {
          if (!seen.has(link) && queue.length + pages.length < maxPages) queue.push(link);
        });
      }
    } catch (e) {
      /* skip unreachable */
    }
  }

  // ── Chunk ─────────────────────────────────────────────────────────────────
  let chunks = [];
  for (const p of pages) chunks = chunks.concat(chunkText(p.text, p.url));
  chunks = chunks.slice(0, 400).map((c, i) => ({ id: i, text: c.text, source: c.source }));

  // ── Embed (real RAG) ──────────────────────────────────────────────────────
  let embModel = null;
  if (body.embed !== false && chunks.length > 0) {
    try {
      const vectors = await embed(env, chunks.map((c) => c.text));
      chunks.forEach((c, i) => { if (vectors[i]) c.embedding = vectors[i]; });
      embModel = 'gemini-embedding-001';
    } catch (e) {
      console.error('embed failed, storing keyword-only KB:', e.message);
    }
  }

  // ── Persist KB (only if we ingested something; else keep existing KB) ──────
  let kbSaved = false;
  if (chunks.length) {
    try {
      await saveKB(env, clientId, { chunks, embModel, pages: pages.map((p) => p.url) });
      kbSaved = true;
    } catch (e) {
      return bad('KB save failed: ' + e.message, 500);
    }
  }

  // ── Merge chatbot config into record.config (billing preserved) ────────────
  const dashboardToken =
    body.dashboardToken ||
    existingCfg.dashboardToken ||
    (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));

  const configPatch = {
    business: body.business ?? existingCfg.business ?? '',
    greeting: body.greeting ?? existingCfg.greeting ?? '',
    color: body.color ?? existingCfg.color ?? '',
    colors: body.colors ?? existingCfg.colors,
    accent: body.accent ?? existingCfg.accent,
    starters: body.starters ?? existingCfg.starters ?? [],
    avatarUrl: body.avatarUrl ?? existingCfg.avatarUrl ?? '',
    model: body.model ?? existingCfg.model ?? 'gemini',
    modelId: body.modelId ?? existingCfg.modelId,
    systemPrompt: body.systemPrompt ?? existingCfg.systemPrompt ?? '',
    contact: body.contact ?? existingCfg.contact ?? '',
    notifyEmail: body.notifyEmail ?? existingCfg.notifyEmail ?? '',
    topN: body.topN ?? existingCfg.topN ?? 4,
    dashboardToken
  };

  let record;
  try {
    record = await patchClientConfig(env, clientId, configPatch);
  } catch (e) {
    return bad('Client save failed: ' + e.message, 500);
  }

  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    client_id: clientId,
    provisioned_only: !!record.provisioned_only,
    billing_status: record.status || 'unknown',
    pagesIngested: pages.length,
    pageUrls: pages.map((p) => p.url),
    chunks: chunks.length,
    embedded: !!embModel,
    kbSaved,
    model: configPatch.model,
    embedSnippet: '<script src="' + origin + '/widget.js" data-client="' + clientId + '" async></script>',
    installUrl: origin + '/install/?id=' + clientId,
    dashboardUrl: origin + '/dashboard/?id=' + clientId + '&key=' + dashboardToken
  });
}

function htmlToText(html) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|br)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&mdash;/g, '—');
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function extractLinks(html, base) {
  const links = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === base.origin && /^https?:/.test(u.protocol) && !/\.(pdf|jpg|jpeg|png|gif|zip|mp4|css|js|svg|ico|woff2?)$/i.test(u.pathname)) {
        u.hash = '';
        links.add(u.href);
      }
    } catch (e) {}
  }
  return Array.from(links);
}
