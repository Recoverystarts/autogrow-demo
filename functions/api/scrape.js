// AutoGrow — Website Scraper + AI Business Analyzer v2
// Now extracts site links, phone tel: links, map URLs
// The chatbot becomes a concierge that can deep-link to real pages

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

    // Normalize URL
    const baseUrl = url.startsWith('http') ? url : 'https://' + url;
    const urlObj = new URL(baseUrl);
    const domain = urlObj.origin;

    // ═══ STEP 1: Fetch the website ═══
    let html, pageContent, siteLinks, phoneLinks, mapLinks;
    try {
      const siteResponse = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AutoGrow Bot; +https://autogrow.org)',
          'Accept': 'text/html,application/xhtml+xml',
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

      // ═══ EXTRACT LINKS BEFORE STRIPPING HTML ═══

      // Internal site links (pages on the same domain)
      const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const rawLinks = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1].trim();
        let text = match[2].replace(/<[^>]+>/g, '').trim();
        if (!text || text.length < 2 || text.length > 80) continue;

        // Resolve relative URLs
        if (href.startsWith('/')) href = domain + href;

        // Keep internal links and important external ones
        if (href.startsWith(domain) || href.startsWith('/')) {
          rawLinks.push({ url: href, label: text });
        }
      }

      // Deduplicate by URL, keep unique pages
      const seenUrls = new Set();
      siteLinks = rawLinks.filter(l => {
        const clean = l.url.replace(/\/$/, '').toLowerCase();
        if (seenUrls.has(clean)) return false;
        seenUrls.add(clean);
        return true;
      }).slice(0, 20); // Cap at 20 links

      // Phone links (tel: hrefs)
      const phoneRegex = /(?:<a[^>]+href=["']tel:([^"']+)["']|(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}))/gi;
      phoneLinks = [];
      while ((match = phoneRegex.exec(html)) !== null) {
        if (match[1]) phoneLinks.push(match[1].trim());
      }

      // Google Maps links
      const mapsRegex = /https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|goo\.gl\/maps)[^\s"'<]*/gi;
      mapLinks = [];
      while ((match = mapsRegex.exec(html)) !== null) {
        mapLinks.push(match[0]);
      }

      // Strip HTML for text analysis
      pageContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
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

    } catch (fetchErr) {
      return new Response(JSON.stringify({ error: `Couldn't fetch that site: ${fetchErr.message}` }), {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ═══ STEP 2: Send to Gemini for extraction ═══
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    // Include discovered links in the prompt for context
    const linksContext = siteLinks.length > 0
      ? `\n\nSITE PAGES FOUND:\n${siteLinks.map(l => `- ${l.label}: ${l.url}`).join('\n')}`
      : '';

    const extractionPrompt = `Analyze this business website content and extract structured information. Return ONLY a JSON object with these fields (use null for anything you can't find):

{
  "businessName": "the business name",
  "industry": "one of: Healthcare, Restaurant, Retail, Professional Services, Home Services, Beauty & Wellness, Automotive, Real Estate, Fitness, Education, Legal, Dental, Other",
  "description": "2-3 sentence description of what the business does, its services, and value proposition",
  "hours": "business hours if found, e.g. 'Mon-Fri 9am-5pm, Sat 10am-2pm'",
  "phone": "phone number if found",
  "tone": "one of: Professional, Friendly & Warm, Casual, Clinical, Luxury",
  "commonQuestions": [
    "likely customer question based on their services",
    "another likely question",
    "another likely question",
    "another likely question",
    "another likely question"
  ],
  "services": ["service 1", "service 2", "service 3"],
  "location": "address or city if found",
  "sitePages": [
    {"label": "human-readable page name", "url": "full URL", "purpose": "what a customer would find there"}
  ]
}

For sitePages: map the site links below to customer-useful pages. Include product/service pages, contact, about, gallery, booking/ordering pages. Skip generic nav items like "Home" or login pages. Each entry should help a chatbot direct customers to the right place.

Return ONLY the JSON object. No markdown, no explanation, no backticks.

Website content:
${pageContent}${linksContext}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
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
      // Clean Gemini response: strip markdown fences, find JSON object
      let cleaned = responseText
        .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Extract JSON object if there's surrounding text
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      // Clean control characters that break JSON.parse
      cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, (ch) => {
        if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
        return '';
      });

      businessInfo = JSON.parse(cleaned);
    } catch (parseErr) {
      // Last resort: try to extract key fields with regex
      try {
        const getName = responseText.match(/"businessName"\s*:\s*"([^"]+)"/);
        const getDesc = responseText.match(/"description"\s*:\s*"([^"]+)"/);
        const getPhone = responseText.match(/"phone"\s*:\s*"([^"]+)"/);
        businessInfo = {
          businessName: getName ? getName[1] : 'Unknown Business',
          description: getDesc ? getDesc[1] : '',
          phone: getPhone ? getPhone[1] : null,
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

    // Add raw extracted data that Gemini might have missed
    if (phoneLinks.length > 0 && !businessInfo.phone) {
      businessInfo.phone = phoneLinks[0];
    }
    if (mapLinks.length > 0) {
      businessInfo.mapUrl = mapLinks[0];
    }

    return new Response(JSON.stringify({
      success: true,
      business: businessInfo,
      sourceUrl: url,
      rawLinks: siteLinks.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    console.error('Scrape error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}
