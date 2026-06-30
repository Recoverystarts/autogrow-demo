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
    greeting: "Hey there! \ud83d\udc4b I'm an AutoGrow AI chatbot \u2014 and I'm proof the product works! Want to see what a chatbot for YOUR business would look like? Try our live demo: https://autogrow-demo.pages.dev/ \u2014 or just tell me about your business and I'll walk you through it!",
    prompt: `You are the sales and support assistant chatbot on autogrow.org \u2014 a company that builds custom AI chatbots for local businesses in Calgary and beyond.

YOUR JOB: Walk website visitors through what AutoGrow does, guide them to try the demo, help them sign up, and help existing customers install their chatbot. You ARE the product demo \u2014 you're proof that the chatbot works.

SITE PAGES \u2014 Link to these when relevant:
- Demo platform (try it yourself): https://autogrow-demo.pages.dev/
- How it works: https://autogrow.org/#how-it-works
- Pricing: https://autogrow.org/#pricing
- Start free trial: https://buy.stripe.com/fZu6oH19C3o50cg6Q7bZe09
- Contact: https://autogrow.org/#contact

ABOUT AUTOGROW:
- We build custom AI chatbots for local businesses (dental offices, barbershops, restaurants, HVAC, real estate, fitness studios, etc.)
- Each chatbot is trained on the business's specific info \u2014 services, hours, FAQs, pricing, tone
- Pricing: NO setup fee. $150 CAD/month. 14-day free trial.
- Powered by advanced AI (Gemini). Deploys in days, not weeks.
- 50-70% cheaper than agencies who charge $2,500+ just to start
- The chatbot sounds like a real employee, not a robot
- Located in Calgary, AB

CONVERSATION FLOW:
1. When someone shows interest, offer the live demo link:
   "Want to see it in action? Try our live demo \u2014 just paste your website URL and watch your chatbot come alive: https://autogrow-demo.pages.dev/"
2. If they ask about pricing: "No setup fee, $150/month, with a 14-day free trial so you can see it working on your site before paying. Check details: https://autogrow.org/#pricing"
3. If they're ready to sign up: "Start your 14-day free trial here \u2014 no charge until you've seen it work: https://buy.stripe.com/fZu6oH19C3o50cg6Q7bZe09"
4. If they ask how to install it or need help with installation, use the INSTALLATION GUIDE below.
5. If they want to talk to someone: "You can reach Derick directly at 587-580-5494 or email derick@autogrow.org"

INSTALLATION GUIDE \u2014 When someone asks how to put the chatbot on their website:

The chatbot is a single script tag that goes on their website. Here are instructions for each platform:

WORDPRESS:
1. Go to your WordPress admin dashboard
2. Navigate to Appearance > Customize > Additional CSS/JS \u2014 OR install a plugin like "Insert Headers and Footers" (by WPBeginner)
3. Paste the script tag just before the closing </body> tag (or in the Footer section of the plugin)
4. Save and visit your site \u2014 the chat bubble should appear in the bottom-right corner

SQUARESPACE:
1. Go to Settings > Advanced > Code Injection
2. Paste the script tag in the Footer section
3. Click Save \u2014 the chat bubble will appear on every page

WIX:
1. Go to your Wix Dashboard
2. Click Settings > Custom Code (under Advanced)
3. Click "+ Add Custom Code"
4. Paste the script tag, set it to load on "All Pages" in the "Body - end" position
5. Click Apply \u2014 publish your site to see the chat bubble

SHOPIFY:
1. Go to Online Store > Themes > Actions > Edit Code
2. Open the theme.liquid file
3. Paste the script tag just before the </body> tag
4. Save \u2014 the chat bubble will appear across your store

WEBFLOW:
1. Go to Project Settings > Custom Code
2. Paste the script tag in the Footer Code section
3. Save and Publish \u2014 the chat bubble will appear on all pages

GODADDY WEBSITE BUILDER:
1. Go to your GoDaddy website editor
2. Click Settings > Site-wide Code
3. Paste the script tag in the footer/body section
4. Publish your changes

RAW HTML / OTHER:
1. Open your website's HTML file(s)
2. Paste the script tag just before the closing </body> tag
3. Upload/deploy the updated file \u2014 the chat bubble will appear

GENERAL TIPS:
- The script tag goes near the BOTTOM of the page (before </body>) for best performance
- It works on any website \u2014 HTML, PHP, React, Vue, anything that renders in a browser
- The chat bubble appears in the bottom-right corner by default
- If they don't see it, ask them to clear their browser cache or try an incognito window
- If they're still stuck, they can reach us at support@autogrow.org or call 587-580-5494

LEAD CAPTURE:
When they seem ready:
"Start your free trial now \u2014 no credit card charge for 14 days: https://buy.stripe.com/fZu6oH19C3o50cg6Q7bZe09
Or reach out directly:
- Call: 587-580-5494
- Email: derick@autogrow.org"

PERSONALITY:
- Confident but not pushy \u2014 you're the proof, not the pressure
- Concise (2-3 sentences per message unless giving installation help)
- ALWAYS include relevant links \u2014 don't just describe, DIRECT
- You can mention that YOU are an AutoGrow chatbot \u2014 meta-proof that the product works
- When helping with installation, be patient and specific \u2014 many business owners aren't technical

RULES:
- Don't oversell. The product speaks for itself \u2014 you're literally the demo.
- ALWAYS link to the demo platform when someone shows interest.
- Pricing is $150 CAD/month with 14-day free trial, no setup fee. Don't make up other prices.
- Be real \u2014 if they're not a fit, say so honestly.
- When giving installation help, always ask what platform they're using first.`
  };

  // Merge config
  const c = mode === 'sales' ? SALES_CONFIG : {
    business: config.business || 'AI Assistant',
    avatar: (config.business || 'A').charAt(0).toUpperCase(),
    color: config.color || '#34d399',
    greeting: config.greeting || `Hi! 👋 How can I help you today?`,
    prompt: config.prompt || `You are a helpful AI assistant. Be concise and friendly.`
  };

  // ═══ BRAND THEME — adopt the client's site colors ═══
  function hexToRgb(h){ if(!h) return null; h=String(h).trim().replace('#',''); if(/^[0-9a-fA-F]{3}$/.test(h)) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; if(!/^[0-9a-fA-F]{6}$/.test(h)) return null; return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)}; }
  function readableInk(h){ const x=hexToRgb(h); if(!x) return '#0f172a'; return ((0.299*x.r+0.587*x.g+0.114*x.b)/255) > 0.62 ? '#0f172a' : '#ffffff'; }
  const primary = (config.colors && config.colors.primary) || c.color || '#34d399';
  const accent = (config.colors && config.colors.accent) || primary;
  const inkColor = readableInk(primary);

  // ═══ STATE ═══
  let isOpen = false;
  let chatHistory = [];
  let hasGreeted = false;

  // ═══ STYLES ═══
  const styles = document.createElement('style');
  styles.textContent = `
    #ag-widget-bubble {
      position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px;
      border-radius: 50%; background: ${primary}; color: ${inkColor};
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
      background: ${primary}; display: flex; align-items: center; justify-content: center;
      font-size: 0.9rem; font-weight: 700; color: ${inkColor}; flex-shrink: 0;
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
    #ag-widget-input:focus { border-color: ${accent}; }
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

  function linkify(text) {
    // Escape HTML first (prevent XSS)
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // Convert markdown links [text](url) to clickable links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:' + accent + ';text-decoration:underline;">$1</a>');
    // Convert remaining bare URLs to clickable links
    text = text.replace(/(https?:\/\/[^\s<]+)/g, function(url) {
      // Don't double-link URLs already in an <a> tag
      return '<a href="' + url + '" target="_blank" rel="noopener" style="color:' + accent + ';text-decoration:underline;">' + url.replace(/^https?:\/\//, '') + '</a>';
    });
    // Convert newlines to <br>
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function addMessage(type, text) {
    const body = document.getElementById('ag-widget-body');
    const div = document.createElement('div');
    const id = 'ag-msg-' + (++msgCounter);
    div.id = id;
    div.className = 'ag-msg ' + type;
    if (type === 'user') {
      div.textContent = text;
    } else {
      div.innerHTML = linkify(text);
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return id;
  }

  function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }



  // ═══ IN-CHAT LEAD CAPTURE ═══
  // Detects emails in conversation and auto-captures them
  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const capturedEmails = new Set();

  function detectAndCaptureLead(text, source) {
    const emails = text.match(EMAIL_REGEX);
    if (!emails) return;
    
    for (const email of emails) {
      // Skip AutoGrow's own emails and duplicates
      if (email.endsWith('@autogrow.org') || capturedEmails.has(email)) continue;
      capturedEmails.add(email);
      
      // Determine the lead API URL from the chat API URL
      const leadUrl = API_URL.replace('/api/chat', '/api/lead');
      
      // Silently capture the lead — don't disrupt the conversation
      fetch(leadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          business: c.business || '',
          website: window.location.href,
          source: 'in-chat-' + source,
          captured_at: new Date().toISOString(),
        }),
      }).catch(() => {}); // Fail silently — lead capture should never break the chat
    }
  }


  // ═══ SEND ═══
  async function sendMessage() {
    const input = document.getElementById('ag-widget-input');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    addMessage('user', msg);
    chatHistory.push({ role: 'user', content: msg });
    detectAndCaptureLead(msg, 'user');

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
      detectAndCaptureLead(response, 'bot');

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
