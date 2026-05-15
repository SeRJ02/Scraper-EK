// Cloudflare Worker that proxies HTML fetches and URL resolutions for Apps
// Script. indiafreestuff.in's API and rto-redirector endpoints 403 requests
// from Google Cloud IP ranges where Apps Script runs; this Worker forwards
// from Cloudflare's edge instead.
//
// Two endpoints, both gated by ?token=PROXY_TOKEN:
//
//   GET /?url=<encoded>           — forward the HTML body
//                                   Allowed hosts come from ALLOWED_HOSTS.
//                                   Returns the upstream body, plus
//                                   X-Final-URL and X-Upstream-Status headers.
//
//   GET /resolve?url=<encoded>    — follow redirects on the URL and return
//                                   { url, status } as JSON.
//                                   No host allowlist on this endpoint (we
//                                   want to chase redirects that exit the
//                                   source site to retailers); the token is
//                                   the only gate.
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

    if (u.pathname === '/resolve') return handleResolve(u);
    return handleFetch(u, env);
  }
};

async function handleResolve(u) {
  const target = u.searchParams.get('url');
  if (!target) return json({ error: 'missing url' }, 400);

  // Chase HTTP redirects (handled by fetch) and HTML/JS bounces (handled here)
  // up to a small bound. Source sites sometimes return 200 with a meta-refresh
  // or window.location bounce instead of a 30x.
  let current = target;
  for (let i = 0; i < 6; i++) {
    let r;
    try {
      r = await fetch(current, { headers: browserHeaders(current), redirect: 'follow' });
    } catch (e) {
      return json({ error: 'upstream: ' + e.message, url: current }, 502);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
