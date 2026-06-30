// AutoGrow — Gemini API Proxy with Client Verification
// Cloudflare Pages Function at /api/chat
// THE SPINE: checks client_id against KV on every request

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const GEMINI_KEY = context.env.GEMINI_API_KEY;
  const CLIENTS = context.env.CLIENTS; // KV binding

  if (!GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  try {
    const body = await context.request.json();
    const { contents, config, client_id, mode } = body;

    if (!contents || !Array.isArray(contents)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ═══ CLIENT VERIFICATION ═══
    // Our own chatbots (sales, demo) pass through freely.
    // Client chatbots must have a valid, active client_id.
    if (mode !== 'sales' && mode !== 'demo' && client_id) {
      if (CLIENTS) {
        const recordStr = await CLIENTS.get(`client:${client_id}`);

        if (!recordStr) {
          return new Response(JSON.stringify({
            error: 'invalid_client',
            response: "This chatbot isn't configured yet. Please contact support@autogrow.org for help."
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

        const record = JSON.parse(recordStr);

        if (record.status === 'inactive') {
          return new Response(JSON.stringify({
            error: 'subscription_inactive',
            response: "This chatbot's subscription has ended. Visit autogrow.org to reactivate."
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

        if (record.status === 'past_due') {
          // Still allow but log — gives business owner time to fix payment
          console.warn(`⚠️ Client ${client_id} has past_due subscription`);
        }
      }
    }

    // ═══ GEMINI API CALL ═══
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1200,
          topP: 0.9,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Gemini error:', errText);
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
      || "I'm having trouble right now. Please try again.";

    // ═══ CONVERSATION LOGGING ═══
    // Log every client chatbot conversation for analytics and daily digests.
    // Each turn gets its own KV key — no race conditions, easy to list by prefix.
    // Demo/sales mode conversations are NOT logged (internal use only).
    if (client_id && CLIENTS && mode !== 'sales' && mode !== 'demo') {
      try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toISOString();
        const rand = Math.random().toString(36).substring(2, 6);
        const userMessage = contents[contents.length - 1]?.parts?.[0]?.text || '';
        
        const turnData = {
          time: timeStr,
          user: userMessage.substring(0, 500), // cap at 500 chars
          bot: responseText.substring(0, 500),
        };
        
        // Key: conv:{client_id}:{date}:{timestamp}:{random}
        await CLIENTS.put(
          `conv:${client_id}:${dateStr}:${timeStr}:${rand}`,
          JSON.stringify(turnData),
          { expirationTtl: 60 * 60 * 24 * 90 } // keep 90 days
        );
        
        // Increment daily counter (lightweight stats)
        const counterKey = `stats:${client_id}:${dateStr}`;
        const currentCount = parseInt(await CLIENTS.get(counterKey) || '0');
        await CLIENTS.put(counterKey, String(currentCount + 1), {
          expirationTtl: 60 * 60 * 24 * 90
        });
      } catch (logErr) {
        // Never let logging break the chat response
        console.error('Conversation log error (non-fatal):', logErr);
      }
    }

    return new Response(JSON.stringify({ response: responseText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS }
    });

  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

