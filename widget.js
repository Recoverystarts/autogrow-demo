// AutoGrow AI Chat Widget — Embeddable on any website
// Usage: <script src="https://autogrow-demo.pages.dev/widget.js" data-config='{"business":"Name","prompt":"..."}' data-api="https://autogrow-demo.pages.dev/api/chat"></script>
// Or use data-mode="sales" for the AutoGrow sales assistant

(function() {
  'use strict';

  // ═══ CONFIG ═══
  const script = document.currentScript;
  const API_URL = script.getAttribute('data-api') || 'https://autogrow-demo.pages.dev/api/chat';
  const mode = script.getAttribute('data-mode') || 'custom';
  const configStr = script.getAttribute('data-config') || '{}';
  let config;
  try { config = JSON.parse(configStr); } catch(e) { config = {}; }

  // Sales mode — AutoGrow's own chatbot
  const SALES_CONFIG = {
    business: 'AutoGrow AI',
    avatar: 'A',
    color: '#34d399',
    greeting: "Hey there! 👋 I'm an AutoGrow AI chatbot — and I'm proof the product works! Want to see what a chatbot for YOUR business would look like? Try our live demo: https://autogrow-demo.pages.dev/ — or just tell me about your business and I'll walk you through it!",
    prompt: `You are the sales assistant chatbot on autogrow.org — a company that builds custom AI chatbots for local businesses in Calgary and beyond.

YOUR JOB: Walk website visitors through what AutoGrow does, guide them to the right page on the site, and get them excited to try the live demo. You ARE the product demo — you're proof that the chatbot works.

SITE PAGES — Link to these when relevant:
- Demo platform (try it yourself): https://autogrow-demo.pages.dev/
- How it works: https://autogrow.org/#how-it-works
- Pricing: https://autogrow.org/#pricing
- Contact: https://autogrow.org/#contact

ABOUT AUTOGROW:
- We build custom AI chatbots for local businesses (dental offices, barbershops, restaurants, HVAC, real estate, fitness studios, etc.)
- Each chatbot is trained on the business's specific info — services, hours, FAQs, pricing, tone
- Setup: $500-$1,500 one-time. Monthly: $150-$300.
- Powered by advanced AI (Gemini). Deploys in days, not weeks.
- 50-70% cheaper than big AI agencies who charge $2,500+ just to start
- The chatbot sounds like a real employee, not a robot
- Located in Calgary, AB — we do in-person demos with a laptop

CONVERSATION FLOW:
1. When someone shows interest, IMMEDIATELY offer the live demo link:
   "Want to see it in action? Try our live demo — just paste your website URL and watch your chatbot come alive: https://autogrow-demo.pages.dev/"
2. If they ask about pricing, link them: "Check out our pricing here: https://autogrow.org/#pricing"
3. If they ask how it works, link them: "Here's how the whole process works: https://autogrow.org/#how-it-works"
4. If they want to talk to someone: "You can reach Derick directly at 587-580-5494 or email derick@autogrow.org"

THE DEMO OFFER:
Always guide interested visitors to the live demo platform:
"Want to try something cool? Head to our demo platform and paste your website URL — it'll build a custom chatbot for your business in about 10 seconds: https://autogrow-demo.pages.dev/"

LEAD CAPTURE:
When they seem impressed or ready:
"Love what you see? Reach out and we'll have your chatbot live on your website this week:
- Call: 587-580-5494
- Email: derick@autogrow.org
- Or fill out the contact form: https://autogrow.org/#contact"

PERSONALITY:
- Confident but not pushy — you're the proof, not the pressure
- Concise (2-3 sentences per message unless demonstrating)
- ALWAYS include relevant links — don't just describe, DIRECT
- You can mention that YOU are an AutoGrow chatbot — meta-proof that the product works

RULES:
- Don't oversell. The product speaks for itself — you're literally the demo.
- ALWAYS link to the demo platform when someone shows interest. Never just describe it.
- Don't make up pricing beyond what's listed above.
- Be real — if they're not a fit, say so honestly.`
  };

  // Merge config
  const c = mode === 'sales' ? SALES_CONFIG : {
    business: config.business || 'AI Assistant',
    avatar: (config.business || 'A').charAt(0).toUpperCase(),
    color: config.color || '#34d399',
    greeting: config.greeting || `Hi! 👋 How can I help you today?`,
    prompt: config.prompt || `You are a helpful AI assistant. Be concise and friendly.`
  };

  // ═══ STATE ═══
  let isOpen = false;
  let chatHistory = [];
  let hasGreeted = false;

  // ═══ STYLES ═══
  const styles = document.createElement('style');
  styles.textContent = `
    #ag-widget-bubble {
      position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px;
      border-radius: 50%; background: ${c.color}; color: #0f172a;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 99999; border: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      font-size: 1.5rem; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: transform 0.3s, box-shadow 0.3s;
    }
    #ag-widget-bubble:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(0,0,0,0.2); }
    #ag-widget-bubble.open { transform: scale(0); pointer-events: none; }
    
    #ag-widget-window {
      position: fixed; bottom: 24px; right: 24px; width: 380px; height: 540px;
      border-radius: 16px; overflow: hidden; z-index: 99999;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08);
      display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transform: scale(0.8) translateY(20px); opacity: 0; pointer-events: none;
      transition: transform 0.3s ease, opacity 0.3s ease;
      transform-origin: bottom right;
    }
    #ag-widget-window.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }

    #ag-widget-header {
      background: linear-gradient(135deg, #1e293b, #334155); color: white;
      padding: 16px 18px; display: flex; align-items: center; gap: 12px; flex-shrink: 0;
    }
    #ag-widget-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: ${c.color}; display: flex; align-items: center; justify-content: center;
      font-size: 0.9rem; font-weight: 700; color: #0f172a; flex-shrink: 0;
    }
    #ag-widget-header-info h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
    #ag-widget-header-info p { font-size: 0.72rem; color: #94a3b8; margin: 2px 0 0 0; }
    #ag-widget-close {
      margin-left: auto; background: none; border: none; color: #94a3b8;
      font-size: 1.4rem; cursor: pointer; padding: 4px 8px; line-height: 1;
    }
    #ag-widget-close:hover { color: white; }

    #ag-widget-body {
      flex: 1; overflow-y: auto; padding: 16px; display: flex;
      flex-direction: column; gap: 10px; background: #ffffff;
    }
    #ag-widget-body::-webkit-scrollbar { width: 3px; }
    #ag-widget-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }

    .ag-msg {
      max-width: 85%; padding: 10px 14px; border-radius: 14px;
      font-size: 0.88rem; line-height: 1.5; animation: ag-fade 0.3s ease;
      word-wrap: break-word;
    }
    @keyframes ag-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .ag-msg.bot { background: #f1f5f9; color: #1e293b; align-self: flex-start; border-bottom-left-radius: 4px; }
    .ag-msg.user { background: #1e293b; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .ag-msg.typing { background: #f1f5f9; color: #94a3b8; align-self: flex-start; font-style: italic; }

    #ag-widget-input-area {
      padding: 12px 14px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px;
      background: #ffffff; flex-shrink: 0;
    }
    #ag-widget-input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 20px; padding: 10px 16px;
      font-size: 0.88rem; outline: none; font-family: inherit;
    }
    #ag-widget-input:focus { border-color: ${c.color}; }
    #ag-widget-send {
      width: 38px; height: 38px; border-radius: 50%; border: none;
      background: #1e293b; color: white; cursor: pointer; font-size: 1rem;
      display: flex; align-items: center; justify-content: center;
    }
    #ag-widget-send:hover { background: #334155; }

    #ag-widget-powered {
      text-align: center; padding: 5px; font-size: 0.62rem; color: #94a3b8;
      background: #f8fafc; flex-shrink: 0;
    }
    #ag-widget-powered a { color: #6366f1; text-decoration: none; font-weight: 500; }

    @media (max-width: 480px) {
      #ag-widget-window { width: calc(100vw - 16px); height: calc(100vh - 80px); bottom: 8px; right: 8px; border-radius: 12px; }
    }
  `;
  document.head.appendChild(styles);

  // ═══ BUILD UI ═══
  // Bubble
  const bubble = document.createElement('button');
  bubble.id = 'ag-widget-bubble';
  bubble.innerHTML = '💬';
  bubble.title = `Chat with ${c.business}`;
  bubble.onclick = () => toggleWidget(true);
  document.body.appendChild(bubble);

  // Window
  const win = document.createElement('div');
  win.id = 'ag-widget-window';
  win.innerHTML = `
    <div id="ag-widget-header">
      <div id="ag-widget-avatar">${c.avatar}</div>
      <div id="ag-widget-header-info">
        <h3>${c.business}</h3>
        <p>Online now</p>
      </div>
      <button id="ag-widget-close" onclick="document.getElementById('ag-widget-bubble').click()">&times;</button>
    </div>
    <div id="ag-widget-body"></div>
    <div id="ag-widget-input-area">
      <input type="text" id="ag-widget-input" placeholder="Type a message...">
      <button id="ag-widget-send">→</button>
    </div>
    <div id="ag-widget-powered">Powered by <a href="https://autogrow.org" target="_blank">AutoGrow AI</a></div>
  `;
  document.body.appendChild(win);

  // Wire up events
  document.getElementById('ag-widget-close').onclick = () => toggleWidget(false);
  document.getElementById('ag-widget-send').onclick = sendMessage;
  document.getElementById('ag-widget-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // ═══ TOGGLE ═══
  function toggleWidget(open) {
    isOpen = open;
    bubble.classList.toggle('open', open);
    win.classList.toggle('open', open);
    if (open && !hasGreeted) {
      hasGreeted = true;
      setTimeout(() => addMessage('bot', c.greeting), 400);
    }
    if (open) {
      setTimeout(() => document.getElementById('ag-widget-input').focus(), 350);
    }
  }

  // ═══ MESSAGES ═══
  let msgCounter = 0;

  function addMessage(type, text) {
    const body = document.getElementById('ag-widget-body');
    const div = document.createElement('div');
    const id = 'ag-msg-' + (++msgCounter);
    div.id = id;
    div.className = 'ag-msg ' + type;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return id;
  }

  function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // ═══ SEND ═══
  async function sendMessage() {
    const input = document.getElementById('ag-widget-input');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    addMessage('user', msg);
    chatHistory.push({ role: 'user', content: msg });

    const typingId = addMessage('typing', 'Typing...');

    try {
      // Build contents for Gemini
      const contents = [
        { role: 'user', parts: [{ text: c.prompt + '\n\nRespond as this chatbot. First message follows.' }] },
        { role: 'model', parts: [{ text: 'Understood. I am ready as ' + c.business + '.' }] }
      ];

      for (const h of chatHistory) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.content }]
        });
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      });

      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json();
      const response = data.response || "I'm having trouble right now. Please try again!";

      removeMessage(typingId);
      addMessage('bot', response);
      chatHistory.push({ role: 'assistant', content: response });

    } catch (err) {
      removeMessage(typingId);
      addMessage('bot', "Sorry, I'm having a moment! Try again in a sec. 😊");
      console.error('AutoGrow widget error:', err);
    }
  }

  // ═══ AUTO-OPEN (optional) ═══
  // Open after 5 seconds if not interacted with
  if (mode === 'sales') {
    setTimeout(() => {
      if (!isOpen && !hasGreeted) toggleWidget(true);
    }, 5000);
  }

})();
