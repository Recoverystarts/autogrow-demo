// AutoGrow — Website Scraper + AI Business Analyzer
// Cloudflare Pages Function at /api/scrape
// Takes a URL → fetches content → Gemini extracts business info → returns structured data

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

    // ═══ STEP 1: Fetch the website ═══
    let pageContent;
    try {
      const siteResponse = await fetch(url, {
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

      const html = await siteResponse.text();

      // Strip scripts, styles, and HTML tags — extract text content
      pageContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' [HEADER] ')
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
        .slice(0, 8000); // Keep it under token limits

    } catch (fetchErr) {
      return new Response(JSON.stringify({ error: `Couldn't fetch that site: ${fetchErr.message}` }), {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ═══ STEP 2: Send to Gemini for extraction ═══
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const extractionPrompt = `Analyze this business website content and extract structured information. Return ONLY a JSON object with these fields (use null for anything you can't find):

{
  "businessName": "the business name",
  "industry": "one of: Healthcare, Restaurant, Retail, Professional Services, Home Services, Beauty & Wellness, Automotive, Real Estate, Fitness, Education, Legal, Other",
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
  "location": "address or city if found"
}

Return ONLY the JSON object. No markdown, no explanation, no backticks.

Website content:
${pageContent}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
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

    // Parse the JSON response
    let businessInfo;
    try {
      // Clean potential markdown formatting
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      businessInfo = JSON.parse(cleaned);
    } catch (parseErr) {
      return new Response(JSON.stringify({
        error: 'Could not parse business info',
        raw: responseText.slice(0, 500)
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      business: businessInfo,
      sourceUrl: url
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
