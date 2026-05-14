// Cloudflare Worker that proxies HTML fetches for Apps Script.
//
// Why this exists: indiafreestuff.in's /pages/getdeals endpoint 403s requests
// coming from Google Cloud IP ranges (where Apps Script's UrlFetchApp runs).
// This Worker forwards the request from Cloudflare's edge, which the site
// accepts. Apps Script calls:
//
//   https://<your-worker>.workers.dev/?url=<encoded>&token=<TOKEN>
//
// Configure two Worker environment variables (Settings → Variables and Secrets):
//   PROXY_TOKEN  : a long random string; Apps Script must send the same value
//   ALLOWED_HOSTS: comma-separated list of hostnames the proxy will fetch
//                  e.g. "www.indiafreestuff.in,indiafreestuff.in"
//
// Free plan: 100,000 requests/day — more than enough for a 15-min cron.

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const target = u.searchParams.get('url');
    const token = u.searchParams.get('token');

    if (!env.PROXY_TOKEN || token !== env.PROXY_TOKEN) {
      return new Response('forbidden', { status: 403 });
    }
    if (!target) {
      return new Response('missing url param', { status: 400 });
    }

    let t;
    try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }

    const allowed = (env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(t.hostname)) {
      return new Response('host not allowed: ' + t.hostname, { status: 403 });
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-IN,en;q=0.9',
      'Referer': `${t.protocol}//${t.hostname}/`,
      'X-Requested-With': 'XMLHttpRequest'
    };

    let upstream;
    try {
      upstream = await fetch(t.toString(), { headers, redirect: 'follow' });
    } catch (e) {
      return new Response('upstream error: ' + e.message, { status: 502 });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Upstream-Status': String(upstream.status)
      }
    });
  }
};
