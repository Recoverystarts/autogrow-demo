// Generates public/install/*.html from one template.
// Run: node scripts/build-install.mjs
import { writeFileSync, mkdirSync } from 'fs';

const OUT = new URL('../install/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BASE = 'https://autogrow-demo.pages.dev';

const platforms = {
  wordpress: {
    name: 'WordPress',
    icon: '🅦',
    method: 'plugin',
    intro: 'The easiest way — our free plugin puts your chatbot live in under a minute.',
    steps: [
      'In WordPress, go to <b>Plugins → Add New</b> and search <b>“AutoGrow AI Chatbot.”</b> Install and activate it. (Or upload the plugin ZIP we sent you.)',
      'Open <b>Settings → AutoGrow Chatbot.</b>',
      'Paste your <b>Client ID</b> in the one field and press <b>Save &amp; Go Live.</b>',
      'Done — your chatbot is now on every page. Reload your site to see it.'
    ],
    codeNote: 'Prefer not to use the plugin? Paste this before the closing &lt;/body&gt; tag in your theme instead:'
  },
  wix: {
    name: 'Wix',
    icon: '🇼',
    method: 'code',
    intro: 'Add the chatbot with Wix’s Custom Code tool — it appears on every page.',
    steps: [
      'In your Wix dashboard, go to <b>Settings → Custom Code</b> (under “Advanced”).',
      'Click <b>+ Add Custom Code</b> and paste the code below.',
      'Under <b>Add Code to Pages</b>, choose <b>All pages</b>, and set <b>Place Code in</b> to <b>Body – end.</b>',
      'Set the category to <b>Essential</b> so it loads for every visitor, then <b>Apply.</b>'
    ],
    codeNote: 'Paste this exact snippet:'
  },
  squarespace: {
    name: 'Squarespace',
    icon: '⬛',
    method: 'code',
    intro: 'Use Squarespace’s Code Injection to add your chatbot site-wide.',
    steps: [
      'From your Squarespace admin, go to <b>Settings → Advanced → Code Injection.</b>',
      'Paste the code below into the <b>Footer</b> box.',
      'Click <b>Save.</b>',
      'Visit your live site — the chat bubble appears in the corner.'
    ],
    codeNote: 'Paste this into the Footer box:'
  },
  shopify: {
    name: 'Shopify',
    icon: '🛍️',
    method: 'code',
    intro: 'Add the chatbot to your Shopify theme so it shows on every storefront page.',
    steps: [
      'In Shopify admin, go to <b>Online Store → Themes.</b>',
      'On your current theme, click <b>… → Edit code.</b>',
      'Open <b>theme.liquid</b> and paste the code just before the closing <b>&lt;/body&gt;</b> tag.',
      'Click <b>Save.</b> Your chatbot is now live across your store.'
    ],
    codeNote: 'Paste this before &lt;/body&gt; in theme.liquid:'
  },
  html: {
    name: 'Any Website (HTML)',
    icon: '🌐',
    method: 'code',
    intro: 'Works on any site you can edit the HTML of — just one script tag.',
    steps: [
      'Open the HTML of your site (or your site builder’s “embed / custom code” area).',
      'Paste the code below just before the closing <b>&lt;/body&gt;</b> tag.',
      'Save and publish.',
      'That’s it — the chatbot loads on any page that includes the snippet.'
    ],
    codeNote: 'Your embed code:'
  }
};

const order = ['wordpress', 'wix', 'squarespace', 'shopify', 'html'];

function navLinks(active) {
  return order
    .map(
      (k) =>
        `<a href="./${k}.html" class="${k === active ? 'on' : ''}">${platforms[k].icon} ${platforms[k].name.replace(' (HTML)', '')}</a>`
    )
    .join('');
}

function page(key) {
  const p = platforms[key];
  const steps = p.steps.map((s, i) => `<li><span class="n">${i + 1}</span><div>${s}</div></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Install your AutoGrow chatbot on ${p.name} — AutoGrow AI</title>
<meta name="description" content="Step-by-step: add your AutoGrow AI chatbot to your ${p.name} site in under a minute.">
<style>
:root{--g:#34d399;--ink:#0f172a;--mut:#64748b;--bg:#f8fafc;--line:#e2e8f0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
.wrap{max-width:720px;margin:0 auto;padding:28px 20px 80px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:19px;margin-bottom:22px}
.brand .dot{width:26px;height:26px;border-radius:8px;background:var(--g);display:flex;align-items:center;justify-content:center;color:#04371f;font-size:15px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:26px}
nav a{font-size:13.5px;text-decoration:none;color:var(--mut);border:1px solid var(--line);background:#fff;padding:7px 12px;border-radius:20px}
nav a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
h1{font-size:26px;line-height:1.2;margin-bottom:8px}
.intro{color:var(--mut);font-size:15.5px;margin-bottom:24px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:18px}
.card h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin-bottom:14px}
label{font-size:13.5px;font-weight:600;display:block;margin-bottom:6px}
input{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 14px;font-size:15px;outline:none}
input:focus{border-color:var(--g);box-shadow:0 0 0 3px rgba(52,211,153,.18)}
.codebox{position:relative;margin-top:14px}
pre{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:16px;overflow-x:auto;font-size:13px;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
.copy{position:absolute;top:10px;right:10px;background:var(--g);color:#04371f;border:none;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:700;cursor:pointer}
.copy:active{transform:scale(.96)}
.note{font-size:13.5px;color:var(--mut);margin-top:4px}
ol.steps{list-style:none}
ol.steps li{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px}
ol.steps li:last-child{border-bottom:none}
.n{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:var(--g);color:#04371f;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px}
.help{text-align:center;color:var(--mut);font-size:14px;margin-top:30px}
.help a{color:var(--ink);font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot">A</span> AutoGrow AI</div>
  <nav>${navLinks(key)}</nav>

  <h1>Add your chatbot to ${p.name}</h1>
  <p class="intro">${p.intro}</p>

  <div class="card">
    <h2>1 · Your embed code</h2>
    <label for="cid">Your Client ID</label>
    <input id="cid" type="text" placeholder="e.g. ironside-barber" autocomplete="off" spellcheck="false">
    <p class="note">${p.codeNote}</p>
    <div class="codebox">
      <button class="copy" id="copyBtn">Copy</button>
      <pre id="code"></pre>
    </div>
  </div>

  <div class="card">
    <h2>2 · ${p.method === 'plugin' ? 'Install steps' : 'Where to paste it'}</h2>
    <ol class="steps">${steps}</ol>
  </div>

  <p class="help">Need help? We’ll do it for you.<br>
    📞 <a href="tel:+15875805494">587-580-5494</a> &nbsp;·&nbsp; ✉️ <a href="mailto:hello@autogrow.org">hello@autogrow.org</a>
  </p>
</div>

<script>
(function(){
  var BASE=${JSON.stringify(BASE)};
  var input=document.getElementById('cid');
  var code=document.getElementById('code');
  var btn=document.getElementById('copyBtn');
  // Prefill from ?id=
  var q=new URLSearchParams(location.search).get('id');
  if(q) input.value=q.replace(/[^a-z0-9-]/gi,'').toLowerCase();
  function snippet(){
    var id=(input.value||'YOUR-CLIENT-ID').replace(/[^a-z0-9-]/gi,'').toLowerCase()||'YOUR-CLIENT-ID';
    return '<script src="'+BASE+'/widget.js" data-client="'+id+'" async><\\/script>';
  }
  function render(){ code.textContent=snippet(); }
  input.addEventListener('input',render); render();
  btn.addEventListener('click',function(){
    navigator.clipboard.writeText(snippet()).then(function(){
      btn.textContent='Copied ✓'; setTimeout(function(){btn.textContent='Copy';},1600);
    });
  });
})();
</script>
</body>
</html>`;
}

for (const key of order) {
  const html = page(key);
  writeFileSync(new URL(`./${key}.html`, OUT), html);
  console.log('wrote install/' + key + '.html (' + html.length + ' bytes)');
}

// Simple index that redirects to the HTML guide by default + lists all.
const index = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install your AutoGrow chatbot</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.6}
a.card{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:10px 0;font-size:17px;font-weight:600}
a.card:hover{border-color:#34d399}h1{font-size:26px}p{color:#64748b}</style></head>
<body><h1>Install your AutoGrow chatbot</h1><p>Pick your platform — each takes about a minute.</p>
${order.map((k) => `<a class="card" href="./${k}.html">${platforms[k].icon}&nbsp; ${platforms[k].name}</a>`).join('\n')}
<p style="text-align:center;margin-top:24px">Need help? 📞 <a href="tel:+15875805494">587-580-5494</a></p>
</body></html>`;
writeFileSync(new URL('./index.html', OUT), index);
console.log('wrote install/index.html');
