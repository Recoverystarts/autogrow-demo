// AutoGrow — Public widget config
// GET /api/client/:id
// Returns ONLY presentation fields the widget needs (from record.config).
// Never the system prompt, knowledge base, model choice, billing, or contact.

import { CORS, json, getClient, clientConfig } from '../_lib.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const id = context.params.id;
  const record = await getClient(context.env, id);

  if (!record) {
    return json(
      { business: 'AI Assistant', greeting: 'Hi! 👋 How can I help you today?', color: '#34d399', starters: [], provisioned: false },
      200,
      { 'Cache-Control': 'public, max-age=60' }
    );
  }

  const cfg = clientConfig(record);
  const business = cfg.business || record.name || 'AI Assistant';
  return json(
    {
      business,
      greeting: cfg.greeting || ('Hi! 👋 Welcome to ' + business + '. How can I help?'),
      color: cfg.color || (cfg.colors && cfg.colors.primary) || '#34d399',
      colors: cfg.colors || undefined,
      accent: cfg.accent || undefined,
      starters: Array.isArray(cfg.starters) ? cfg.starters.slice(0, 4) : [],
      avatarUrl: cfg.avatarUrl || '',
      provisioned: !!cfg.systemPrompt || !!cfg.business,
      active: record.status !== 'inactive'
    },
    200,
    { 'Cache-Control': 'public, max-age=60' }
  );
}
