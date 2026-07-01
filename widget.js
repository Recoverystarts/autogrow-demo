/*!
 * AutoGrow AI Chat Widget v2
 * Production embeddable widget — Shadow DOM isolated, ~zero host-CSS conflict.
 *
 * Embed (managed clients — recommended):
 *   <script src="https://autogrow-v2.pages.dev/widget.js" data-client="ironside-barber"></script>
 *   The server holds the client's prompt + knowledge base. The page never sees them.
 *
 * Embed (inline preview / demo — no server config):
 *   <script src=".../widget.js"
 *     data-config='{"business":"Name","greeting":"Hi!","color":"#34d399","prompt":"..."}'
 *     data-mode="inline"></script>
 *
 * Optional data-* attributes:
 *   data-api      Override API origin (default: derived from this script's src)
 *   data-theme    "auto" | "light" | "dark"  (default auto = follows host prefers-color-scheme)
 *   data-position "right" | "left"            (default right)
 *   data-open     "auto" to auto-open once after a delay
 *
 * License: proprietary. (c) AutoGrow AI Solutions.
 */
(function () {
  'use strict';

  // Guard against double-injection (e.g. plugin + manual snippet).
  if (window.__autogrowWidgetLoaded) return;
  window.__autogrowWidgetLoaded = true;

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIG — read from the <script> tag
  // ─────────────────────────────────────────────────────────────────────────
  var script =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

  function attr(name, fallback) {
    var v = script.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  }

  // Derive API origin from the script src so a single deploy "just works".
  var apiOrigin = attr('data-api', '');
  if (!apiOrigin) {
    try {
      apiOrigin = new URL(script.src).origin;
    } catch (e) {
      apiOrigin = 'https://autogrow-v2.pages.dev';
    }
  }
  apiOrigin = apiOrigin.replace(/\/+$/, '');

  var clientId = attr('data-client', '');
  var mode = attr('data-mode', clientId ? 'managed' : 'inline');
  var themePref = attr('data-theme', 'auto');
  var position = attr('data-position', 'right') === 'left' ? 'left' : 'right';
  var autoOpen = attr('data-open', '') === 'auto';

  var inlineConfig = {};
  try {
    inlineConfig = JSON.parse(attr('data-config', '{}')) || {};
  } catch (e) {
    inlineConfig = {};
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Small utilities
  // ─────────────────────────────────────────────────────────────────────────
  function hexToRgb(h) {
    if (!h) return null;
    h = String(h).trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function readableInk(h) {
    var x = hexToRgb(h);
    if (!x) return '#0f172a';
    // WCAG-ish relative luminance
    return (0.299 * x.r + 0.587 * x.g + 0.114 * x.b) / 255 > 0.6 ? '#0f172a' : '#ffffff';
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function now() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  // Minimal, safe markdown → HTML. Escapes first, then re-introduces a
  // whitelisted set of formatting. No raw HTML from the model is ever trusted.
  function mdToHtml(raw) {
    var text = esc(raw);

    // Fenced/inline code (before other inline rules so their * _ aren't touched)
    text = text.replace(/`([^`]+)`/g, function (_, c) {
      return '<code>' + c + '</code>';
    });

    // Links [label](url) — only http(s)/mailto/tel
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)/g, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    // Bare URLs
    text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url.replace(/^https?:\/\//, '') + '</a>';
    });

    // Bold **x** / __x__
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic *x* / _x_
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

    // Lists: group consecutive bullet/numbered lines
    var lines = text.split('\n');
    var out = [];
    var listType = null; // 'ul' | 'ol'
    function closeList() {
      if (listType) {
        out.push('</' + listType + '>');
        listType = null;
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var mUl = ln.match(/^\s*[-•]\s+(.*)$/);
      var mOl = ln.match(/^\s*\d+[.)]\s+(.*)$/);
      if (mUl) {
        if (listType !== 'ul') {
          closeList();
          listType = 'ul';
          out.push('<ul>');
        }
        out.push('<li>' + mUl[1] + '</li>');
      } else if (mOl) {
        if (listType !== 'ol') {
          closeList();
          listType = 'ol';
          out.push('<ol>');
        }
        out.push('<li>' + mOl[1] + '</li>');
      } else {
        closeList();
        out.push(ln);
      }
    }
    closeList();
    text = out.join('\n');

    // Remaining newlines → <br>, but not right after a block tag
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/(<\/(?:ul|ol|li)>)<br>/g, '$1');
    text = text.replace(/<br>(<(?:ul|ol)>)/g, '$1');
    return text;
  }

  // Lead detection — pull emails/phones out of what the visitor types.
  var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  var PHONE_RE = /(?:\+?\d[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}/g;
  var captured = { emails: {}, phones: {} };
  function detectLead(text) {
    var found = null;
    var emails = text.match(EMAIL_RE);
    var phones = text.match(PHONE_RE);
    if (emails) {
      emails.forEach(function (e) {
        var k = e.toLowerCase();
        if (!captured.emails[k]) {
          captured.emails[k] = 1;
          found = found || {};
          found.email = e;
        }
      });
    }
    if (phones) {
      phones.forEach(function (p) {
        var digits = p.replace(/\D/g, '');
        if (digits.length >= 10 && !captured.phones[digits]) {
          captured.phones[digits] = 1;
          found = found || {};
          found.phone = p.trim();
        }
      });
    }
    return found;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Default config (overridden by managed fetch or inline data-config)
  // ─────────────────────────────────────────────────────────────────────────
  var cfg = {
    business: inlineConfig.business || 'AI Assistant',
    greeting: inlineConfig.greeting || 'Hi! 👋 How can I help you today?',
    color: inlineConfig.color || (inlineConfig.colors && inlineConfig.colors.primary) || '#34d399',
    accent: (inlineConfig.colors && inlineConfig.colors.accent) || inlineConfig.color || '#34d399',
    starters: inlineConfig.starters || [],
    avatarUrl: inlineConfig.avatarUrl || '',
    prompt: inlineConfig.prompt || '' // inline mode only; managed mode never receives this
  };

  var state = { open: false, greeted: false, history: [], sending: false, config: null };

  // ─────────────────────────────────────────────────────────────────────────
  // DOM + Shadow root
  // ─────────────────────────────────────────────────────────────────────────
  var host = document.createElement('div');
  host.id = 'autogrow-widget-host';
  host.style.cssText = 'all:initial;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  (document.body || document.documentElement).appendChild(host);

  function css(primary, accent, ink) {
    var side = position === 'left' ? 'left' : 'right';
    return (
      ':host{all:initial}' +
      '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.ag-root{--ag-primary:' + primary + ';--ag-accent:' + accent + ';--ag-ink:' + ink + ';' +
        '--ag-bg:#ffffff;--ag-fg:#1e293b;--ag-muted:#94a3b8;--ag-bot-bg:#f1f5f9;--ag-border:#e2e8f0;--ag-header:#0f172a}' +
      '.ag-root.ag-dark{--ag-bg:#0f172a;--ag-fg:#e2e8f0;--ag-muted:#94a3b8;--ag-bot-bg:#1e293b;--ag-border:#334155;--ag-header:#020617}' +
      // Bubble
      '.ag-bubble{position:fixed;bottom:24px;' + side + ':24px;width:60px;height:60px;border-radius:50%;' +
        'background:var(--ag-primary);color:var(--ag-ink);display:flex;align-items:center;justify-content:center;' +
        'cursor:pointer;z-index:2147483000;border:none;box-shadow:0 6px 24px rgba(0,0,0,.18);' +
        'transition:transform .25s ease,box-shadow .25s ease}' +
      '.ag-bubble:hover{transform:scale(1.08);box-shadow:0 8px 30px rgba(0,0,0,.24)}' +
      '.ag-bubble:focus-visible{outline:3px solid var(--ag-accent);outline-offset:3px}' +
      '.ag-bubble.ag-hidden{transform:scale(0);pointer-events:none}' +
      '.ag-bubble svg{width:28px;height:28px}' +
      '.ag-badge{position:absolute;top:-2px;' + side + ':-2px;min-width:18px;height:18px;border-radius:9px;' +
        'background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px}' +
      // Window
      '.ag-win{position:fixed;bottom:24px;' + side + ':24px;width:384px;height:min(600px,calc(100vh - 48px));' +
        'max-height:600px;border-radius:18px;overflow:hidden;z-index:2147483000;background:var(--ag-bg);' +
        'box-shadow:0 12px 48px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.10);display:flex;flex-direction:column;' +
        'transform:scale(.85) translateY(24px);opacity:0;pointer-events:none;transform-origin:bottom ' + side + ';' +
        'transition:transform .28s cubic-bezier(.16,1,.3,1),opacity .22s ease}' +
      '.ag-win.ag-open{transform:scale(1) translateY(0);opacity:1;pointer-events:auto}' +
      // Header
      '.ag-header{background:var(--ag-header);color:#fff;padding:15px 16px;display:flex;align-items:center;gap:11px;flex-shrink:0}' +
      '.ag-avatar{width:38px;height:38px;border-radius:50%;background:var(--ag-primary);color:var(--ag-ink);' +
        'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;overflow:hidden}' +
      '.ag-avatar img{width:100%;height:100%;object-fit:cover}' +
      '.ag-htxt{min-width:0}' +
      '.ag-htxt h3{font-size:15px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ag-status{font-size:12px;color:#cbd5e1;display:flex;align-items:center;gap:5px;margin-top:2px}' +
      '.ag-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.5);animation:ag-pulse 2s infinite}' +
      '@keyframes ag-pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}' +
      '.ag-close{margin-left:auto;background:none;border:none;color:#cbd5e1;cursor:pointer;padding:6px;border-radius:8px;display:flex}' +
      '.ag-close:hover{color:#fff;background:rgba(255,255,255,.1)}' +
      '.ag-close:focus-visible{outline:2px solid #fff;outline-offset:1px}' +
      '.ag-close svg{width:20px;height:20px}' +
      // Body
      '.ag-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--ag-bg);scroll-behavior:smooth}' +
      '.ag-body::-webkit-scrollbar{width:6px}.ag-body::-webkit-scrollbar-thumb{background:var(--ag-border);border-radius:3px}' +
      '.ag-row{display:flex;flex-direction:column;max-width:86%}' +
      '.ag-row.ag-user{align-self:flex-end;align-items:flex-end}' +
      '.ag-row.ag-bot{align-self:flex-start;align-items:flex-start}' +
      '.ag-msg{padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;animation:ag-in .28s ease}' +
      '@keyframes ag-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
      '.ag-bot .ag-msg{background:var(--ag-bot-bg);color:var(--ag-fg);border-bottom-left-radius:5px}' +
      '.ag-user .ag-msg{background:var(--ag-primary);color:var(--ag-ink);border-bottom-right-radius:5px}' +
      '.ag-msg a{color:inherit;text-decoration:underline;font-weight:600}' +
      '.ag-bot .ag-msg a{color:var(--ag-accent)}' +
      '.ag-msg code{background:rgba(100,116,139,.18);padding:1px 5px;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}' +
      '.ag-msg ul,.ag-msg ol{margin:6px 0 6px 20px}.ag-msg li{margin:2px 0}' +
      '.ag-time{font-size:11px;color:var(--ag-muted);margin-top:4px;padding:0 4px}' +
      // Typing
      '.ag-typing{display:flex;gap:4px;padding:14px 16px;background:var(--ag-bot-bg);border-radius:16px;border-bottom-left-radius:5px;width:fit-content}' +
      '.ag-typing span{width:8px;height:8px;border-radius:50%;background:var(--ag-muted);animation:ag-bounce 1.3s infinite ease-in-out}' +
      '.ag-typing span:nth-child(2){animation-delay:.18s}.ag-typing span:nth-child(3){animation-delay:.36s}' +
      '@keyframes ag-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-6px);opacity:1}}' +
      // Starters
      '.ag-starters{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 4px}' +
      '.ag-chip{border:1px solid var(--ag-border);background:var(--ag-bg);color:var(--ag-fg);border-radius:16px;' +
        'padding:8px 13px;font-size:13px;cursor:pointer;transition:all .15s;text-align:left}' +
      '.ag-chip:hover{border-color:var(--ag-primary);background:var(--ag-bot-bg)}' +
      '.ag-chip:focus-visible{outline:2px solid var(--ag-accent);outline-offset:1px}' +
      // Input
      '.ag-input-area{padding:12px 14px;border-top:1px solid var(--ag-border);display:flex;gap:8px;align-items:flex-end;background:var(--ag-bg);flex-shrink:0}' +
      '.ag-input{flex:1;border:1px solid var(--ag-border);border-radius:22px;padding:11px 16px;font-size:14.5px;' +
        'outline:none;background:var(--ag-bg);color:var(--ag-fg);resize:none;max-height:96px;line-height:1.4;font-family:inherit}' +
      '.ag-input:focus{border-color:var(--ag-primary);box-shadow:0 0 0 3px rgba(52,211,153,.15)}' +
      '.ag-input::placeholder{color:var(--ag-muted)}' +
      '.ag-send{width:42px;height:42px;border-radius:50%;border:none;background:var(--ag-primary);color:var(--ag-ink);' +
        'cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .15s,opacity .15s}' +
      '.ag-send:hover{transform:scale(1.06)}.ag-send:disabled{opacity:.45;cursor:default;transform:none}' +
      '.ag-send:focus-visible{outline:3px solid var(--ag-accent);outline-offset:2px}' +
      '.ag-send svg{width:20px;height:20px}' +
      // Footer
      '.ag-footer{text-align:center;padding:7px;font-size:11px;color:var(--ag-muted);background:var(--ag-bg);border-top:1px solid var(--ag-border);flex-shrink:0}' +
      '.ag-footer a{color:var(--ag-accent);text-decoration:none;font-weight:600}' +
      // Mobile — full screen, honor the on-screen keyboard via visualViewport.
      // Input MUST be >=16px or iOS Safari auto-zooms on focus and breaks layout.
      '@media (max-width:480px){' +
        '.ag-win{width:100%;height:100vh;height:100dvh;max-height:none;bottom:0;' + side + ':0;border-radius:0}' +
        '.ag-bubble{bottom:18px;' + side + ':18px}' +
        '.ag-input{font-size:16px}' +
      '}' +
      '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    );
  }

  function icon(name) {
    if (name === 'chat')
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    if (name === 'close')
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    if (name === 'send')
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    return '';
  }

  // Build shadow DOM once we know the config.
  var els = {};
  function render() {
    var primary = cfg.color || '#34d399';
    var accent = cfg.accent || primary;
    var ink = readableInk(primary);
    var dark =
      themePref === 'dark' ||
      (themePref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    var style = document.createElement('style');
    style.textContent = css(primary, accent, ink);

    var wrap = document.createElement('div');
    wrap.className = 'ag-root' + (dark ? ' ag-dark' : '');
    var initial = cfg.business.charAt(0).toUpperCase();
    var avatarInner = cfg.avatarUrl ? '<img src="' + esc(cfg.avatarUrl) + '" alt="">' : esc(initial);

    wrap.innerHTML =
      '<button class="ag-bubble" aria-label="Open chat with ' + esc(cfg.business) + '" aria-haspopup="dialog">' +
        icon('chat') + '<span class="ag-badge" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="ag-win" role="dialog" aria-modal="false" aria-label="Chat with ' + esc(cfg.business) + '" aria-hidden="true">' +
        '<div class="ag-header">' +
          '<div class="ag-avatar" aria-hidden="true">' + avatarInner + '</div>' +
          '<div class="ag-htxt"><h3>' + esc(cfg.business) + '</h3>' +
            '<div class="ag-status"><span class="ag-dot"></span>Online now</div></div>' +
          '<button class="ag-close" aria-label="Close chat">' + icon('close') + '</button>' +
        '</div>' +
        '<div class="ag-body" role="log" aria-live="polite" aria-atomic="false"></div>' +
        '<div class="ag-starters"></div>' +
        '<div class="ag-input-area">' +
          '<textarea class="ag-input" rows="1" placeholder="Type a message…" aria-label="Message"></textarea>' +
          '<button class="ag-send" aria-label="Send message" disabled>' + icon('send') + '</button>' +
        '</div>' +
        '<div class="ag-footer">Powered by <a href="https://autogrow.org" target="_blank" rel="noopener">AutoGrow AI</a></div>' +
      '</div>';

    root.appendChild(style);
    root.appendChild(wrap);

    els.wrap = wrap;
    els.bubble = wrap.querySelector('.ag-bubble');
    els.badge = wrap.querySelector('.ag-badge');
    els.win = wrap.querySelector('.ag-win');
    els.body = wrap.querySelector('.ag-body');
    els.starters = wrap.querySelector('.ag-starters');
    els.input = wrap.querySelector('.ag-input');
    els.send = wrap.querySelector('.ag-send');
    els.close = wrap.querySelector('.ag-close');

    wireEvents();
  }

  function wireEvents() {
    els.bubble.addEventListener('click', function () { toggle(true); });
    els.close.addEventListener('click', function () { toggle(false); });
    els.send.addEventListener('click', send);

    els.input.addEventListener('input', function () {
      els.send.disabled = !els.input.value.trim() || state.sending;
      // auto-grow textarea
      els.input.style.height = 'auto';
      els.input.style.height = Math.min(els.input.scrollHeight, 96) + 'px';
    });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // ESC closes; basic focus handling
    els.win.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        toggle(false);
        els.bubble.focus();
      }
    });

    // iOS/Android: keep the window sized to the *visible* viewport when the
    // on-screen keyboard opens, so the input never hides behind it.
    if (window.visualViewport) {
      var vv = window.visualViewport;
      var onVV = function () {
        if (state.open && window.innerWidth <= 480) {
          els.win.style.height = vv.height + 'px';
        }
      };
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
    }
  }

  function toggle(open) {
    state.open = open;
    els.bubble.classList.toggle('ag-hidden', open);
    els.bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
    els.win.classList.toggle('ag-open', open);
    els.win.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      els.badge.style.display = 'none';
      if (!state.greeted) {
        state.greeted = true;
        showTyping();
        setTimeout(function () {
          hideTyping();
          addMessage('bot', cfg.greeting);
          renderStarters();
        }, 500);
      }
      setTimeout(function () { els.input.focus(); }, 320);
    }
  }

  function renderStarters() {
    els.starters.innerHTML = '';
    if (!cfg.starters || !cfg.starters.length || state.history.length) return;
    cfg.starters.slice(0, 4).forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'ag-chip';
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', function () {
        els.input.value = q;
        send();
      });
      els.starters.appendChild(b);
    });
  }
  function clearStarters() { els.starters.innerHTML = ''; }

  function addMessage(who, text) {
    var row = document.createElement('div');
    row.className = 'ag-row ag-' + who;
    var msg = document.createElement('div');
    msg.className = 'ag-msg';
    if (who === 'user') msg.textContent = text;
    else msg.innerHTML = mdToHtml(text);
    var time = document.createElement('div');
    time.className = 'ag-time';
    time.textContent = now();
    row.appendChild(msg);
    row.appendChild(time);
    els.body.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
  }

  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'ag-row ag-bot';
    typingEl.innerHTML = '<div class="ag-typing" aria-label="Assistant is typing"><span></span><span></span><span></span></div>';
    els.body.appendChild(typingEl);
    els.body.scrollTop = els.body.scrollHeight;
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function fireLead(lead, sourceMsg) {
    if (mode !== 'managed' || !clientId) return; // only report for managed clients
    try {
      fetch(apiOrigin + '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          email: lead.email || '',
          phone: lead.phone || '',
          message: sourceMsg,
          page: location.href,
          ts: Date.now()
        }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function send() {
    var text = els.input.value.trim();
    if (!text || state.sending) return;

    clearStarters();
    els.input.value = '';
    els.input.style.height = 'auto';
    addMessage('user', text);
    state.history.push({ role: 'user', content: text });

    var lead = detectLead(text);
    if (lead) fireLead(lead, text);

    state.sending = true;
    els.send.disabled = true;
    showTyping();

    var payload;
    var url;
    if (mode === 'managed') {
      url = apiOrigin + '/api/chat';
      payload = { client_id: clientId, message: text, history: state.history.slice(-12) };
    } else {
      // inline/demo mode — legacy contract, prompt supplied by page
      url = apiOrigin + '/api/chat';
      payload = { inline: true, prompt: cfg.prompt, business: cfg.business, message: text, history: state.history.slice(-12) };
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        hideTyping();
        var reply = data.response || data.reply || "I'm having trouble right now — please try again.";
        addMessage('bot', reply);
        state.history.push({ role: 'assistant', content: reply });
      })
      .catch(function (err) {
        hideTyping();
        addMessage('bot', "Sorry, I hit a snag. Give me a moment and try again. 😊");
        if (window.console) console.error('[AutoGrow] chat error:', err);
      })
      .then(function () {
        state.sending = false;
        els.send.disabled = !els.input.value.trim();
        els.input.focus();
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Boot: managed mode fetches public config; inline mode uses data-config.
  // ─────────────────────────────────────────────────────────────────────────
  function applyConfig(remote) {
    if (remote) {
      cfg.business = remote.business || cfg.business;
      cfg.greeting = remote.greeting || cfg.greeting;
      cfg.color = remote.color || (remote.colors && remote.colors.primary) || cfg.color;
      cfg.accent = (remote.colors && remote.colors.accent) || remote.accent || cfg.color;
      cfg.starters = remote.starters || cfg.starters;
      cfg.avatarUrl = remote.avatarUrl || cfg.avatarUrl;
    }
  }

  function boot() {
    if (mode === 'managed' && clientId) {
      fetch(apiOrigin + '/api/client/' + encodeURIComponent(clientId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (remote) { applyConfig(remote); })
        .catch(function () {})
        .then(function () {
          render();
          maybeAutoOpen();
        });
    } else {
      render();
      maybeAutoOpen();
    }
  }

  function maybeAutoOpen() {
    if (autoOpen) {
      setTimeout(function () {
        if (!state.open && !state.greeted) toggle(true);
      }, 4500);
    }
  }

  // Public programmatic API — host pages / install snippets can drive the widget.
  // Also drains any pre-load command queue (stub-loader pattern):
  //   window.AutoGrow = window.AutoGrow || function(){(AutoGrow.q=AutoGrow.q||[]).push(arguments)}
  //   AutoGrow('open')
  function api(cmd) {
    if (!els.bubble) return; // not booted yet
    if (cmd === 'open') toggle(true);
    else if (cmd === 'close') toggle(false);
    else if (cmd === 'toggle') toggle(!state.open);
  }
  var queued = (window.AutoGrow && window.AutoGrow.q) || [];
  window.AutoGrow = function () { api.apply(null, arguments); };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);

  // replay queued commands after boot settles
  setTimeout(function () {
    queued.forEach(function (args) { api.apply(null, args); });
  }, 1200);
})();
