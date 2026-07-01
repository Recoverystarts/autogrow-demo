// AutoGrow — Chat endpoint (merged: v1 spine + v2 RAG/multi-model brain)
// POST /api/chat  — accepts THREE payload shapes, detected by field presence:
//
// 1) LEGACY  { contents:[...gemini...], config?, client_id?, mode? }
//    The demo funnel (index.html) and any already-embedded old widgets use this.
//    Preserves v1 exactly: client verification + status gate + Gemini pass-through
//    + conversation logging. THE MONEY-PATH DEMO DEPENDS ON THIS — do not remove.
//
// 2) MANAGED { client_id, message, history:[{role,content}] }
//    The new v2 widget. Server holds the prompt + KB; does RAG + model routing.
//    The page never sees the prompt or knowledge base.
//
// 3) INLINE  { inline:true, prompt, business, message, history }
//    Demo/preview with a page-supplied prompt (no server config). Rate-limited.

import {
  CORS, json, bad, getClient, clientConfig, getKB, retrieve,
  resolveModel, runModel, logTurn, rateLimited
} from './_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

const GUARDRAILS =
  '\n\nIMPORTANT RULES:\n' +
  '- Only answer using the business information provided above. If you do not know something, say so honestly and offer to connect them with the team.\n' +
  '- Never invent prices, hours, policies, or promises that are not in the information above.\n' +
  '- Be concise (2-4 sentences unless more detail is genuinely needed). Warm, human, helpful — like a great front-desk employee, not a robot.\n' +
  '- When relevant, guide the visitor toward booking, calling, or contacting the business.\n' +
  '- You may use light Markdown (bold, links, short lists).';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.GEMINI_API_KEY) return bad('API key not configured', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad('Invalid JSON body');
  }

  // ── Shape 1: LEGACY contents[] (demo funnel / old widgets) ────────────────
  if (Array.isArray(body.contents)) {
    return legacyChat(context, body);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const message = (body.message || '').toString().trim();
  if (!message) return bad('Empty message');
  if (message.length > 2000) return bad('Message too long');
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

  // ── Shape 3: INLINE demo ──────────────────────────────────────────────────
  if (body.inline) {
    if (await rateLimited(env, 'chat:' + ip, 20, 60)) return bad('Slow down a moment 🙂', 429);
    const business = (body.business || 'this business').toString().slice(0, 120);
    const system = (body.prompt || 'You are a helpful assistant.').toString().slice(0, 8000) + GUARDRAILS;
    try {
      const { reply, model } = await runModel(env, resolveModel({ model: 'gemini' }), { system, history, message });
      return json({ response: reply || fallbackReply(business), model });
    } catch (e) {
      console.error('inline chat error', e.message);
      return json({ response: fallbackReply(business) });
    }
  }

  // ── Shape 2: MANAGED RAG ──────────────────────────────────────────────────
  const clientId = (body.client_id || '').toString().trim();
  if (!clientId) return bad('client_id or contents required');
  if (await rateLimited(env, 'chat:' + clientId + ':' + ip, 30, 60)) return bad('Slow down a moment 🙂', 429);

  const record = await getClient(env, clientId);
  if (!record) {
    return json({ response: "This chat isn't fully set up yet. Please reach out to the business directly and they'll be happy to help." });
  }
  // Billing gate — mirror v1's status handling.
  if (record.status === 'inactive') {
    return json({ response: "This chatbot's subscription has ended. Visit autogrow.org to reactivate." }, 403);
  }
  if (record.status === 'past_due') {
    console.warn('⚠️ Client ' + clientId + ' past_due — still serving');
  }

  const cfg = clientConfig(record);

  // Retrieve relevant knowledge
  let contextBlock = '';
  try {
    const kb = await getKB(env, clientId);
    if (kb) {
      const chunks = await retrieve(env, kb, message, cfg.topN || 4);
      if (chunks.length) {
        contextBlock =
          '\n\nRELEVANT BUSINESS INFORMATION (use this to answer):\n' +
          chunks.map((c, i) => '[' + (i + 1) + '] ' + c.text).join('\n\n');
      }
    }
  } catch (e) {
    console.error('retrieve error', e.message);
  }

  const business = cfg.business || record.name || 'a local business';
  const persona =
    (cfg.systemPrompt || ('You are the friendly AI assistant for ' + business + '. Help visitors with their questions.')) +
    (cfg.contact ? '\n\nContact: ' + cfg.contact : '');
  const system = persona + contextBlock + GUARDRAILS;
  const model = resolveModel(cfg);

  let reply, usedModel;
  try {
    const res = await runModel(env, model, { system, history, message });
    reply = res.reply;
    usedModel = res.model;
  } catch (e) {
    console.error('model error (' + model.id + '):', e.message);
    if (model.provider !== 'gemini') {
      try {
        const res = await runModel(env, resolveModel({ model: 'gemini' }), { system, history, message });
        reply = res.reply;
        usedModel = res.model + ' (fallback)';
      } catch (e2) {
        console.error('gemini fallback error', e2.message);
      }
    }
  }
  if (!reply) reply = fallbackReply(business);

  context.waitUntil(logTurn(env, clientId, message, reply));
  return json({ response: reply, model: usedModel || model.id });
}

// ── Legacy path: preserves v1 chat.js behaviour verbatim ──────────────────────
async function legacyChat(context, body) {
  const { env } = context;
  const CLIENTS = env.CLIENTS;
  const { contents, client_id, mode } = body;

  // Client verification (our sales/demo bots pass through freely).
  if (mode !== 'sales' && mode !== 'demo' && client_id && CLIENTS) {
    const recordStr = await CLIENTS.get('client:' + client_id);
    if (!recordStr) {
      return json({ error: 'invalid_client', response: "This chatbot isn't configured yet. Please contact support@autogrow.org for help." }, 403);
    }
    const record = JSON.parse(recordStr);
    if (record.status === 'inactive') {
      return json({ error: 'subscription_inactive', response: "This chatbot's subscription has ended. Visit autogrow.org to reactivate." }, 403);
    }
    if (record.status === 'past_due') console.warn('⚠️ Client ' + client_id + ' has past_due subscription');
  }

  const geminiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + env.GEMINI_API_KEY;
  const gRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1200, topP: 0.9 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    })
  });
  if (!gRes.ok) {
    console.error('Gemini error:', (await gRes.text()).slice(0, 200));
    return bad('AI service error', 502);
  }
  const gData = await gRes.json();
  const responseText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm having trouble right now. Please try again.";

  // Log client conversations (not demo/sales).
  if (client_id && CLIENTS && mode !== 'sales' && mode !== 'demo') {
    const userMessage = contents[contents.length - 1]?.parts?.[0]?.text || '';
    context.waitUntil(logTurn(env, client_id, userMessage, responseText));
  }

  return json({ response: responseText });
}

function fallbackReply(business) {
  return (
    "I'm having a brief technical moment. Please try again in a few seconds — or reach out to " +
    (business || 'us') + ' directly and someone will help you right away.'
  );
}
