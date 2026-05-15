// Resolve a URL by opening it in a real headless Chromium hosted by
// browserless.io. Used for indiafreestuff's session-bound rto links that
// HTTP-only fetchers (Apps Script, Cloudflare Worker) can't follow because
// the redirect happens inside the browser session via JS.
//
// API: POST https://production-sfo.browserless.io/chromium/function?token=TOKEN
//      Content-Type: application/javascript
//      Body: a JS module that navigates to the URL and returns page.url()
// Auth: BROWSERLESS_API_TOKEN script property.
//
// Free tier: 1000 sessions/month — comfortably more than 25 IFS deals × 4
// cycles/hour × 24 hours = 2400/day if every link were a cache miss, but
// caching keeps actual API calls way down.
//
// Returns the final URL string, or null on any failure.

var BROWSERLESS_BASE = 'https://production-sfo.browserless.io/chromium/function';
var BROWSERLESS_CACHE_TTL_SECONDS = 21600; // 6h

function browserlessResolveUrl(targetUrl) {
  if (!targetUrl) return null;
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_BROWSERLESS_TOKEN);
  if (!token) {
    console.warn('BROWSERLESS_API_TOKEN not set');
    return null;
  }

  var cache = CacheService.getScriptCache();
  var key = 'br_' + sha1Short(targetUrl);
  var hit = cache.get(key);
  if (hit) return hit === '__NULL__' ? null : hit;

  // Inline the URL safely: JSON.stringify wraps + escapes it as a JS literal.
  var safeUrl = JSON.stringify(targetUrl);
  var code =
    'export default async function ({ page }) {\n' +
    '  await page.goto(' + safeUrl + ', { waitUntil: "domcontentloaded", timeout: 25000 });\n' +
    '  // Give JS-driven redirects a moment to fire.\n' +
    '  await new Promise(function (r) { setTimeout(r, 2500); });\n' +
    '  return { data: page.url(), type: "application/json" };\n' +
    '}\n';

  var endpoint = BROWSERLESS_BASE + '?token=' + encodeURIComponent(token);
  var resp;
  try {
    resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/javascript',
      payload: code,
      muteHttpExceptions: true
    });
  } catch (e) {
    console.warn('Browserless fetch threw: ' + e);
    return null;
  }

  if (resp.getResponseCode() !== 200) {
    console.warn('Browserless HTTP ' + resp.getResponseCode() + ': ' +
      resp.getContentText().substring(0, 200));
    cache.put(key, '__NULL__', BROWSERLESS_CACHE_TTL_SECONDS);
    return null;
  }

  // The body is plain text — the URL the page settled on. Sometimes wrapped
  // as a JSON string.
  var body = resp.getContentText().trim();
  if (body.charAt(0) === '"') {
    try { body = JSON.parse(body); } catch (e) { /* fall through */ }
  } else if (body.charAt(0) === '{') {
    try {
      var parsed = JSON.parse(body);
      if (parsed && typeof parsed.data === 'string') body = parsed.data;
    } catch (e) {}
  }

  if (!body || !/^https?:\/\//i.test(body)) {
    console.warn('Browserless returned no URL for ' + targetUrl + ': ' + body);
    cache.put(key, '__NULL__', BROWSERLESS_CACHE_TTL_SECONDS);
    return null;
  }

  cache.put(key, body, BROWSERLESS_CACHE_TTL_SECONDS);
  return body;
}

function _testBrowserless() {
  var rto = 'https://www.indiafreestuff.in/?rto=Mjg2ODk2NTI5Nw==';
  console.log('Input : ' + rto);
  console.log('Output: ' + browserlessResolveUrl(rto));
}
