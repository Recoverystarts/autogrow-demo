// AutoGrow — shared server library (merged v1 spine + v2 brain)
// Single KV namespace: env.CLIENTS. All keys are prefixed:
//   client:{id}            billing record (Stripe webhook owns it).
//                          Chatbot config lives NESTED under record.config.
//   kb:{id}                knowledge base { chunks:[...], embModel, pages }
//   conv:{id}:{date}:{ts}:{rand}  conversation turn  (v1 scheme — digest.js reads it)
//   stats:{id}:{date}      per-day counter           (v1 scheme — digest.js reads it)
//   lead:{id}:{ts}         captured lead
//   email:/stripe:/session: billing indexes (webhook owns them)
//   rl:...                 rate-limit buckets
// Dependency-free (Cloudflare Workers runtime).

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra }
  });
}
export function bad(msg, status = 400) {
  return json({ error: msg }, status);
}

// ── Client records (billing at top level, chatbot config nested) ──────────────
export async function getClient(env, id) {
  if (!id || !env.CLIENTS) return null;
  const raw = await env.CLIENTS.get('client:' + id);
  return raw ? JSON.parse(raw) : null;
}

// The chatbot presentation/behaviour config for a client — always an object.
export function clientConfig(record) {
  return (record && record.config) || {};
}

// Merge a config patch into a client's record.config WITHOUT touching billing
// fields (stripe ids, status, email, created_at). Creates a bare record only if
// one doesn't exist yet (e.g. a manually-provisioned demo client).
export async function patchClientConfig(env, id, patch) {
  if (!env.CLIENTS) throw new Error('CLIENTS KV not bound');
  const raw = await env.CLIENTS.get('client:' + id);
  let record = raw
    ? JSON.parse(raw)
    : { client_id: id, status: 'active', config: {}, created_at: new Date().toISOString(), provisioned_only: true };
  record.config = { ...(record.config || {}), ...patch };
  record.updated_at = new Date().toISOString();
  await env.CLIENTS.put('client:' + id, JSON.stringify(record));
  return record;
}

// ── Knowledge base ────────────────────────────────────────────────────────────
export async function getKB(env, id) {
  if (!id || !env.CLIENTS) return null;
  const raw = await env.CLIENTS.get('kb:' + id);
  return raw ? JSON.parse(raw) : null;
}
export async function saveKB(env, id, kb) {
  if (!env.CLIENTS) throw new Error('CLIENTS KV not bound');
  kb.updatedAt = Date.now();
  await env.CLIENTS.put('kb:' + id, JSON.stringify(kb));
  return kb;
}

// ── Text chunking ─────────────────────────────────────────────────────────────
export function chunkText(text, source = '', target = 700, overlap = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) || [clean];
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).length > target && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap));
    }
    buf += ' ' + s;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.map((t, i) => ({ id: i, text: t, source }));
}

// ── Embeddings (Gemini) ───────────────────────────────────────────────────────
export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIMS = 768;

export async function embed(env, texts) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const arr = Array.isArray(texts) ? texts : [texts];
  const out = [];
  for (let i = 0; i < arr.length; i += 100) {
    const batch = arr.slice(i, i + 100);
    const requests = batch.map((t) => ({
      model: 'models/' + EMBED_MODEL,
      content: { parts: [{ text: t }] },
      outputDimensionality: EMBED_DIMS
    }));
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' + EMBED_MODEL + ':batchEmbedContents?key=' + key;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });
    if (!r.ok) throw new Error('embed failed ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const data = await r.json();
    (data.embeddings || []).forEach((e) => out.push(e.values));
  }
  return Array.isArray(texts) ? out : out[0];
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
function keywordScore(chunkText, qTerms) {
  const t = chunkText.toLowerCase();
  let s = 0;
  for (const term of qTerms) {
    if (term.length < 3) continue;
    if (t.indexOf(term) !== -1) s += 1;
  }
  return s;
}

export async function retrieve(env, kb, question, topN = 4) {
  if (!kb || !kb.chunks || !kb.chunks.length) return [];
  const chunks = kb.chunks;
  const hasEmb = chunks[0] && Array.isArray(chunks[0].embedding);
  if (hasEmb) {
    try {
      const qvec = await embed(env, question);
      return chunks
        .map((c) => ({ c, score: cosine(qvec, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .filter((x) => x.score > 0.35)
        .map((x) => x.c);
    } catch (e) {
      /* fall through to keyword */
    }
  }
  const qTerms = question.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const scored = chunks.map((c) => ({ c, score: keywordScore(c.text, qTerms) })).sort((a, b) => b.score - a.score);
  const top = scored.filter((x) => x.score > 0).slice(0, topN).map((x) => x.c);
  return top.length ? top : chunks.slice(0, Math.min(topN, chunks.length));
}

// ── Model routing (Gemini + Claude + GPT) ─────────────────────────────────────
export const MODEL_MAP = {
  gemini: { provider: 'gemini', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  claude: { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Claude Sonnet' },
  'claude-fast': { provider: 'anthropic', id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku' },
  gpt: { provider: 'openai', id: 'gpt-4o-mini', label: 'GPT-4o mini' }
};
export function resolveModel(cfg) {
  const want = (cfg && (cfg.model || cfg.modelKey)) || 'gemini';
  const base = MODEL_MAP[want] || MODEL_MAP.gemini;
  if (cfg && cfg.modelId) return { ...base, id: cfg.modelId };
  return base;
}
export async function runModel(env, model, args) {
  if (model.provider === 'anthropic') return runClaude(env, model, args);
  if (model.provider === 'openai') return runOpenAI(env, model, args);
  return runGemini(env, model, args);
}
async function runGemini(env, model, { system, history, message }) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const contents = [];
  for (const h of history || []) contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] });
  contents.push({ role: 'user', parts: [{ text: message }] });
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model.id + ':generateContent?key=' + key;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 1000, topP: 0.9 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    })
  });
  if (!r.ok) throw new Error('gemini ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  return { reply: data?.candidates?.[0]?.content?.parts?.[0]?.text || '', model: model.id };
}
async function runClaude(env, model, { system, history, message }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const messages = [];
  for (const h of history || []) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  messages.push({ role: 'user', content: message });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model.id, max_tokens: 1000, system, messages })
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  return { reply: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), model: model.id };
}
async function runOpenAI(env, model, { system, history, message }) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing — add it to enable GPT models');
  const messages = [{ role: 'system', content: system }];
  for (const h of history || []) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
  messages.push({ role: 'user', content: message });
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: model.id, max_tokens: 1000, temperature: 0.6, messages })
  });
  if (!r.ok) throw new Error('openai ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  return { reply: data?.choices?.[0]?.message?.content || '', model: model.id };
}

// ── Conversation logging (v1 key scheme — digest.js depends on it) ────────────
export async function logTurn(env, clientId, userMsg, botMsg) {
  if (!env.CLIENTS || !clientId) return;
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString();
    const rand = Math.random().toString(36).substring(2, 6);
    await env.CLIENTS.put(
      'conv:' + clientId + ':' + dateStr + ':' + timeStr + ':' + rand,
      JSON.stringify({ time: timeStr, user: String(userMsg).slice(0, 500), bot: String(botMsg).slice(0, 500) }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
    const counterKey = 'stats:' + clientId + ':' + dateStr;
    const cur = parseInt((await env.CLIENTS.get(counterKey)) || '0', 10);
    await env.CLIENTS.put(counterKey, String(cur + 1), { expirationTtl: 60 * 60 * 24 * 90 });
  } catch (e) {
    /* logging must never break a chat */
  }
}

export async function rateLimited(env, key, limit = 30, windowSec = 60) {
  if (!env.CLIENTS) return false;
  const bucket = 'rl:' + key + ':' + Math.floor(Date.now() / (windowSec * 1000));
  try {
    const cur = parseInt((await env.CLIENTS.get(bucket)) || '0', 10);
    if (cur >= limit) return true;
    await env.CLIENTS.put(bucket, String(cur + 1), { expirationTtl: windowSec + 5 });
  } catch (e) {}
  return false;
}
