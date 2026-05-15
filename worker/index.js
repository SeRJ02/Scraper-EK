// Cloudflare Worker that proxies HTML fetches and URL resolutions for Apps
// Script. indiafreestuff.in's API and rto-redirector endpoints 403 requests
// from Google Cloud IP ranges where Apps Script runs; this Worker forwards
// from Cloudflare's edge instead.
//
// Three endpoints, all gated by ?token=PROXY_TOKEN:
//
//   GET /?url=<encoded>                  — forward the HTML body
//                                          Allowed hosts come from ALLOWED_HOSTS.
//                                          Returns the upstream body, plus
//                                          X-Final-URL and X-Upstream-Status headers.
//
//   GET /resolve?url=<encoded>           — follow redirects + HTML/JS bounces
//                                          on the URL and return { url, status }.
//                                          No host allowlist.
//
//   GET /resolve-session?url=<encoded>   — same as /resolve, but first hits
//                                          the URL's origin homepage to capture
//                                          session cookies, then replays them
//                                          on the target. Used for rto-style
//                                          masked links that require a prior
//                                          session.
//
// Required Worker variables (Settings → Variables and Secrets):
//   PROXY_TOKEN   (Secret) : shared with Apps Script
//   ALLOWED_HOSTS (Text)   : "www.indiafreestuff.in,indiafreestuff.in"

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const token = u.searchParams.get('token');

    if (!env.PROXY_TOKEN || token !== env.PROXY_TOKEN) {
      return new Response('forbidden', { status: 403 });
    }

    if (u.pathname === '/resolve')         return handleResolve(u, /*withSession=*/false);
    if (u.pathname === '/resolve-session') return handleResolve(u, /*withSession=*/true);
    return handleFetch(u, env);
  }
};

async function handleResolve(u, withSession) {
  const target = u.searchParams.get('url');
  if (!target) return json({ error: 'missing url' }, 400);

  let t;
  try { t = new URL(target); } catch { return json({ error: 'bad url' }, 400); }

  // Prime cookies by walking through the same navigation a real visitor would:
  //   1. GET the homepage  (browser-style headers)
  //   2. GET /pages/getdeals (XHR-style, with cookies from step 1)
  // Only after this does the server consider the session "warm" enough to
  // honour the ?rto= redirect for a deal it knows we've seen.
  let cookieHeader = '';
  if (withSession) {
    const origin = `${t.protocol}//${t.hostname}`;
    try {
      const home = await fetch(origin + '/', {
        headers: browserHeadersForNavigation(origin + '/'),
        redirect: 'follow'
      });
      cookieHeader = collectCookies(home.headers);
    } catch (e) {}
    // Step 2: hit the deals AJAX endpoint (only meaningful for indiafreestuff,
    // harmless for others — 404s don't break the resolve flow).
    if (t.hostname.endsWith('indiafreestuff.in')) {
      try {
        const xhrHeaders = browserHeaders(origin + '/pages/getdeals');
        if (cookieHeader) xhrHeaders['Cookie'] = cookieHeader;
        const deals = await fetch(origin + '/pages/getdeals', {
          headers: xhrHeaders, redirect: 'follow'
        });
        const more = collectCookies(deals.headers);
        if (more) cookieHeader = mergeCookies(cookieHeader, more);
      } catch (e) {}
    }
  }

  let current = target;
  for (let i = 0; i < 6; i++) {
    const headers = browserHeaders(current);
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    let r;
    try {
      r = await fetch(current, { headers, redirect: 'follow' });
    } catch (e) {
      return json({ error: 'upstream: ' + e.message, url: current }, 502);
    }
    // Accumulate any new cookies from this hop.
    if (withSession) {
      const more = collectCookies(r.headers);
      if (more) cookieHeader = mergeCookies(cookieHeader, more);
    }
    if (r.url && r.url !== current) current = r.url;
    if (r.status !== 200) break;

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) break;

    const body = await r.text();
    const bounced = extractBounceFromHtml(body);
    if (!bounced) break;
    try { current = new URL(bounced, current).toString(); }
    catch { break; }
  }
  return json({ url: current, status: 200 });
}

function collectCookies(headers) {
  // Workers Headers exposes getSetCookie() to retrieve all Set-Cookie values
  // as an array (handling multiple cookies correctly).
  let raw = [];
  if (typeof headers.getSetCookie === 'function') raw = headers.getSetCookie();
  else {
    const single = headers.get('set-cookie');
    if (single) raw = [single];
  }
  return raw.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

function mergeCookies(existing, fresh) {
  if (!existing) return fresh;
  if (!fresh) return existing;
  const map = {};
  (existing + '; ' + fresh).split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (k) map[k] = v.join('=');
  });
  return Object.keys(map).map(k => k + '=' + map[k]).join('; ');
}

function extractBounceFromHtml(html) {
  const meta = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s>]+)/i.exec(html);
  if (meta) return meta[1];
  const js = /(?:window\.location(?:\.href)?|location\.href|location\.replace\s*\(?)\s*=?\s*["']([^"']+)["']/i.exec(html);
  if (js) return js[1];
  return null;
}

async function handleFetch(u, env) {
  const target = u.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  let t;
  try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }

  const allowed = (env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(t.hostname)) {
    return new Response('host not allowed: ' + t.hostname, { status: 403 });
  }

  let upstream;
  try {
    upstream = await fetch(t.toString(), {
      headers: browserHeaders(t.toString()),
      redirect: 'follow'
    });
  } catch (e) {
    return new Response('upstream error: ' + e.message, { status: 502 });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Upstream-Status': String(upstream.status),
      'X-Final-URL': upstream.url
    }
  });
}

function browserHeaders(url) {
  let referer = 'https://www.indiafreestuff.in/';
  try {
    const t = new URL(url);
    referer = `${t.protocol}//${t.hostname}/`;
  } catch {}
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Referer': referer,
    'X-Requested-With': 'XMLHttpRequest'
  };
}

function browserHeadersForNavigation(url) {
  // Headers a real browser sends for a top-level navigation (not an XHR).
  // Some sites set their session cookie only on this kind of request.
  let referer = 'https://www.google.com/';
  try {
    const t = new URL(url);
    referer = `${t.protocol}//${t.hostname}/`;
  } catch {}
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Referer': referer
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
