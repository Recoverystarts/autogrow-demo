// AutoGrow — Website Scraper + AI Business Analyzer v3
// UPGRADE: Aggressive content extraction, meta/OG tags, structured data,
// nav link discovery, and enriched Gemini prompt for better analysis

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const GEMINI_KEY = context.env.GEMINI_API_KEY;

  if (!GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  try {
    const { url } = await context.request.json();

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const baseUrl = url.startsWith('http') ? url : 'https://' + url;
    const urlObj = new URL(baseUrl);
    const domain = urlObj.origin;

    // ═══ STEP 1: Fetch + Deep Content Extraction ═══
    let html, metadata, siteLinks, phoneLinks, mapLinks, brandColors, logoUrl, ogImage;
    try {
      const siteResponse = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (!siteResponse.ok) {
        return new Response(JSON.stringify({ error: `Couldn't reach that site (${siteResponse.status})` }), {
          status: 422,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      html = await siteResponse.text();

      // ═══ METADATA EXTRACTION — reliable even on JS sites ═══
      metadata = {};

      // Title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      metadata.title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Meta description
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      metadata.description = metaDesc ? metaDesc[1].trim() : '';

      // OG tags — often have the best summary content
      const ogTags = {};
      const ogRegex = /<meta[^>]+property=["']og:(\w+)["'][^>]+content=["']([^"']+)["']/gi;
      let ogMatch;
      while ((ogMatch = ogRegex.exec(html)) !== null) {
        ogTags[ogMatch[1].toLowerCase()] = ogMatch[2].trim();
      }
      // Also check reversed attribute order
      const ogRegex2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:(\w+)["']/gi;
      while ((ogMatch = ogRegex2.exec(html)) !== null) {
        if (!ogTags[ogMatch[2].toLowerCase()]) {
          ogTags[ogMatch[2].toLowerCase()] = ogMatch[1].trim();
        }
      }
      metadata.og = ogTags;
      ogImage = ogTags.image || null;

      // Twitter card
      const twDesc = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
      if (twDesc && !metadata.description) metadata.description = twDesc[1].trim();

      // JSON-LD structured data — goldmine for business info
      const jsonLdBlocks = [];
      const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let ldMatch;
      while ((ldMatch = ldRegex.exec(html)) !== null) {
        try {
          const parsed = JSON.parse(ldMatch[1].trim());
          jsonLdBlocks.push(parsed);
        } catch(e) {}
      }
      metadata.structuredData = jsonLdBlocks;

      // ═══ LINK EXTRACTION — more aggressive ═══
      const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const rawLinks = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1].trim();
        let text = match[2].replace(/<[^>]+>/g, '').trim();
        if (!text || text.length < 2 || text.length > 80) continue;
        // Skip anchors, javascript, mailto
        if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;

        // Resolve relative URLs
        if (href.startsWith('/')) href = domain + href;
        else if (!href.startsWith('http')) href = domain + '/' + href;

        // Keep internal links
        try {
          const linkHost = new URL(href).hostname.replace(/^www\./, '');
          const siteHost = urlObj.hostname.replace(/^www\./, '');
          if (linkHost === siteHost) {
            rawLinks.push({ url: href, label: text });
          }
        } catch(e) {}
      }

      // Deduplicate by URL path, keep unique pages
      const seenPaths = new Set();
      siteLinks = rawLinks.filter(l => {
        try {
          const path = new URL(l.url).pathname.replace(/\/$/, '').toLowerCase();
          if (path === '' || path === '/' || seenPaths.has(path)) return false;
          seenPaths.add(path);
          return true;
        } catch(e) { return false; }
      }).slice(0, 25);

      // Phone links
      const phoneRegex = /(?:<a[^>]+href=["']tel:([^"']+)["']|(?:(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}))/gi;
      phoneLinks = [];
      while ((match = phoneRegex.exec(html)) !== null) {
        if (match[1]) phoneLinks.push(match[1].trim());
      }
      // Also look for phone in text content
      const phoneInText = html.replace(/<[^>]+>/g, ' ').match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
      if (phoneInText) {
        for (const p of phoneInText) {
          const cleaned = p.replace(/[\s.-]/g, '');
          if (cleaned.length >= 10 && cleaned.length <= 12) {
            phoneLinks.push(p.trim());
          }
        }
      }

      // Google Maps links
      const mapsRegex = /https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|goo\.gl\/maps)[^\s"'<]*/gi;
      mapLinks = [];
      while ((match = mapsRegex.exec(html)) !== null) {
        mapLinks.push(match[0]);
      }

      // ═══ BRAND COLORS ═══
      const absUrl = (u) => {
        if (!u) return null;
        u = u.trim();
        if (u.startsWith('//')) return urlObj.protocol + u;
        if (u.startsWith('/')) return domain + u;
        if (!u.startsWith('http')) return domain + '/' + u.replace(/^\.?\//, '');
        return u;
      };
      const colorCounts = {};
      const tallyColor = (raw) => {
        let hex = raw.toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
        if (!/^#[0-9a-f]{6}$/.test(hex)) return;
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        const light = (max+min)/2/255;
        const sat = max === 0 ? 0 : (max-min)/max;
        if (light > 0.93 || light < 0.06) return;
        if (sat < 0.18) return;
        colorCounts[hex] = (colorCounts[hex]||0) + 1;
      };
      let cmatch;
      const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
      while ((cmatch = hexRe.exec(html)) !== null) tallyColor(cmatch[0]);
      const rgbRe = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
      while ((cmatch = rgbRe.exec(html)) !== null) {
        tallyColor('#' + [cmatch[1],cmatch[2],cmatch[3]].map(n => Math.min(255,+n).toString(16).padStart(2,'0')).join(''));
      }
      let sorted = Object.entries(colorCounts).sort((a,b) => b[1]-a[1]).map(e => e[0]);
      const themeMeta = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
      if (themeMeta && /^#[0-9a-fA-F]{3,6}$/.test(themeMeta[1].trim())) {
        let t = themeMeta[1].trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(t)) t = '#' + t[1]+t[1]+t[2]+t[2]+t[3]+t[3];
        sorted = [t, ...sorted.filter(c => c !== t)];
      }
      sorted = [...new Set(sorted)];
      brandColors = sorted.length ? { primary: sorted[0], accent: sorted[1] || sorted[0], all: sorted.slice(0,6) } : null;

      // Logo
      const logoTag = html.match(/<img[^>]*(?:class|id|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i);
      if (logoTag) {
        const src = logoTag[0].match(/\bsrc=["']([^"']+)["']/i);
        logoUrl = src ? absUrl(src[1]) : null;
      }
      if (!logoUrl) {
        // Try finding logo by common patterns
        const logoLink = html.match(/<link[^>]+rel=["'](?:icon|apple-touch-icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i);
        if (logoLink) logoUrl = absUrl(logoLink[1]);
      }

      // ═══ ENRICHED CONTENT — headings, services, key text ═══
      // Extract headings separately — they're the strongest signal
      const headings = [];
      const hRegex = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
      while ((match = hRegex.exec(html)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text && text.length > 2 && text.length < 120) headings.push(text);
      }

      // Extract list items — often contain services, features, hours
      const listItems = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      while ((match = liRegex.exec(html)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text && text.length > 3 && text.length < 200) listItems.push(text);
      }

      // Strip HTML for general text content
      const pageContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // Skip nav — we extracted links separately
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // Skip footer boilerplate
        .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n## $1\n')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#?\w+;/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .trim()
        .slice(0, 8000);

      // ═══ STEP 2: Send ENRICHED data to Gemini ═══
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

      // Build a rich context for Gemini
      let geminiContext = '';
      
      // Always include meta/OG data — it's the most reliable on modern sites
      if (metadata.title) geminiContext += `PAGE TITLE: ${metadata.title}\n`;
      if (metadata.description) geminiContext += `META DESCRIPTION: ${metadata.description}\n`;
      if (metadata.og.title) geminiContext += `OG TITLE: ${metadata.og.title}\n`;
      if (metadata.og.description) geminiContext += `OG DESCRIPTION: ${metadata.og.description}\n`;
      if (metadata.og.site_name) geminiContext += `SITE NAME: ${metadata.og.site_name}\n`;
      
      // Structured data is gold
      if (metadata.structuredData.length > 0) {
        geminiContext += `\nSTRUCTURED DATA (JSON-LD):\n${JSON.stringify(metadata.structuredData, null, 1).slice(0, 3000)}\n`;
      }
      
      // Headings tell you the page structure
      if (headings.length > 0) {
        geminiContext += `\nPAGE HEADINGS:\n${headings.slice(0, 30).map(h => '- ' + h).join('\n')}\n`;
      }
      
      // List items often contain services, features, hours
      if (listItems.length > 0) {
        geminiContext += `\nLIST ITEMS FOUND:\n${listItems.slice(0, 30).map(li => '- ' + li).join('\n')}\n`;
      }

      // Site links
      if (siteLinks.length > 0) {
        geminiContext += `\nSITE PAGES FOUND:\n${siteLinks.map(l => `- ${l.label}: ${l.url}`).join('\n')}\n`;
      }

      // Phone numbers found
      if (phoneLinks.length > 0) {
        geminiContext += `\nPHONE NUMBERS FOUND: ${[...new Set(phoneLinks)].slice(0, 3).join(', ')}\n`;
      }

      const extractionPrompt = `You are analyzing a business website to extract information for a customer-facing chatbot. Use ALL the data sources below — metadata, structured data, headings, list items, AND the page content — to build the most complete picture possible.

Return ONLY a JSON object with these fields (use null for anything you genuinely can't find, but TRY HARD):

{
  "businessName": "the business name (check og:site_name, title, structured data)",
  "industry": "one of: Healthcare, Restaurant, Retail, Professional Services, Home Services, Beauty & Wellness, Automotive, Real Estate, Fitness, Education, Legal, Dental, Veterinary, Construction, Technology, Other",
  "description": "2-3 sentence description of what the business does. Pull from meta description, OG description, or synthesize from headings and content. Make it useful for a chatbot.",
  "hours": "business hours if found anywhere (structured data, content, list items). Format: 'Mon-Fri 9am-5pm' style",
  "phone": "primary business phone number (check structured data, tel: links, content)",
  "email": "business email if found",
  "tone": "one of: Professional, Friendly & Warm, Casual, Clinical, Luxury — judge from the site's language and style",
  "commonQuestions": ["5 questions a real customer would ask this business, based on what they offer"],
  "services": ["list every service/product you can find — check headings, list items, content"],
  "pricing": "any pricing information found (even ranges or 'starting at' prices)",
  "location": "full address if found",
  "sitePages": [
    {"label": "human-readable name", "url": "full URL", "purpose": "what a customer finds there"}
  ]
}

For sitePages: include EVERY page that would help a customer — services, pricing, booking, contact, about, gallery, menu, FAQ, team, testimonials. Skip generic nav items like "Home", login, privacy policy, terms.

CRITICAL: Extract services even if you have to infer them from headings, list items, or page content. A plumber's site with headings "Drain Cleaning", "Water Heater Repair", "Pipe Installation" = services: ["Drain Cleaning", "Water Heater Repair", "Pipe Installation"].

Return ONLY the JSON object. No markdown, no explanation.

═══ EXTRACTED DATA ═══

${geminiContext}

═══ PAGE CONTENT ═══

${pageContent}`;

      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
          },
        })
      });

      if (!geminiResponse.ok) {
        return new Response(JSON.stringify({ error: 'AI analysis failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      const geminiData = await geminiResponse.json();
      const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let businessInfo;
      try {
        let cleaned = responseText
          .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.slice(firstBrace, lastBrace + 1);
        }
        cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, (ch) => {
          if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
          return '';
        });
        businessInfo = JSON.parse(cleaned);
      } catch (parseErr) {
        try {
          const getName = responseText.match(/"businessName"\s*:\s*"([^"]+)"/);
          const getDesc = responseText.match(/"description"\s*:\s*"([^"]+)"/);
          const getPhone = responseText.match(/"phone"\s*:\s*"([^"]+)"/);
          businessInfo = {
            businessName: getName ? getName[1] : metadata.og.site_name || metadata.title || 'Unknown Business',
            description: getDesc ? getDesc[1] : metadata.description || metadata.og.description || '',
            phone: getPhone ? getPhone[1] : (phoneLinks.length > 0 ? phoneLinks[0] : null),
            industry: 'Other',
            tone: 'Friendly & Warm',
            commonQuestions: [],
            sitePages: [],
            _parseFallback: true
          };
        } catch (regexErr) {
          return new Response(JSON.stringify({
            error: 'Could not parse business info',
            raw: responseText.slice(0, 500)
          }), {
            status: 422,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }
      }

      // Enrich with extracted data that Gemini might have missed
      if (phoneLinks.length > 0 && !businessInfo.phone) {
        businessInfo.phone = phoneLinks[0];
      }
      if (mapLinks.length > 0) {
        businessInfo.mapUrl = mapLinks[0];
      }
      // Use meta/OG as fallbacks
      if (!businessInfo.description && metadata.description) {
        businessInfo.description = metadata.description;
      }
      if (!businessInfo.description && metadata.og.description) {
        businessInfo.description = metadata.og.description;
      }
      if (!businessInfo.businessName || businessInfo.businessName === 'Unknown Business') {
        businessInfo.businessName = metadata.og.site_name || metadata.title?.split(/[|–—-]/)[0]?.trim() || 'Unknown Business';
      }

      // Brand styling
      businessInfo.brandColors = brandColors;
      businessInfo.logoUrl = logoUrl;
      businessInfo.ogImage = ogImage;

      return new Response(JSON.stringify({
        success: true,
        business: businessInfo,
        sourceUrl: url,
        rawLinks: siteLinks.length,
        metaExtracted: {
          title: !!metadata.title,
          description: !!metadata.description,
          ogTags: Object.keys(metadata.og).length,
          structuredData: metadata.structuredData.length,
          headings: headings.length,
          listItems: listItems.length,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });

    } catch (fetchErr) {
      return new Response(JSON.stringify({ error: `Couldn't fetch that site: ${fetchErr.message}` }), {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

  } catch (err) {
    console.error('Scrape error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}
