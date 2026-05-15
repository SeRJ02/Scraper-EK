// Resolve a URL by running it through Browserless v2's BrowserQL endpoint —
// a stealth-enabled headless Chromium that bypasses datacenter/bot detection.
// Used for indiafreestuff's session-bound rto links that 200-stub for any
// non-stealth fetcher (Apps Script, Cloudflare Worker, legacy Browserless
// /function). Confirmed working via the BrowserQL editor.
//
// Endpoint: POST https://production-sfo.browserless.io/chromium/bql?token=TOKEN
// Body    : { "query": "mutation { ... }" }
// Auth    : BROWSERLESS_API_TOKEN script property (your v2 token).
//
// Caching: 6-hour TTL via CacheService keyed by sha1(url). Failures are also
// cached briefly to avoid hammering the API on un-resolvable links.

var BROWSERQL_ENDPOINT = 'https://production-sfo.browserless.io/chromium/bql';
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

  // Residential proxy (set on the endpoint URL below) bypasses Cloudflare's
  // datacenter-IP block, so we can hit the rto URL directly — no homepage
  // prime needed. Saves a goto + ~5s per resolve.
  var query =
    'mutation Resolve {\n' +
    '  visit: goto(url: ' + JSON.stringify(targetUrl) + ', waitUntil: domContentLoaded) { status }\n' +
    '  pause: waitForTimeout(time: 3500) { time }\n' +
    '  current: url { url }\n' +
    '}';

  // Route the whole session through Browserless's residential-IP proxy so
  // Cloudflare WAF sees a residential IP, not a datacenter one.
  var endpoint = BROWSERQL_ENDPOINT +
    '?token=' + encodeURIComponent(token) +
    '&proxy=residential' +
    '&proxyCountry=in';
  var resp;
  try {
    resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ query: query }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.warn('BrowserQL fetch threw: ' + e);
    return null;
  }

  if (resp.getResponseCode() !== 200) {
    console.warn('BrowserQL HTTP ' + resp.getResponseCode() + ': ' +
      resp.getContentText().substring(0, 300));
    cache.put(key, '__NULL__', 600);  // brief negative cache (10 min) so we retry sooner
    return null;
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); }
  catch (e) { console.warn('BrowserQL parse failed: ' + e); return null; }

  if (data && data.errors) {
    console.warn('BrowserQL returned errors: ' + JSON.stringify(data.errors).substring(0, 300));
    cache.put(key, '__NULL__', 600);
    return null;
  }

  // Prefer the post-wait current URL (catches JS-driven redirects); fall back
  // to the goto-reported URL if needed.
  var d = data && data.data;
  var finalUrl = (d && d.current && d.current.url) ||
                 (d && d.visit && d.visit.url) || null;
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    console.warn('BrowserQL no url for ' + targetUrl + ': ' +
      JSON.stringify(data).substring(0, 300));
    cache.put(key, '__NULL__', 600);
    return null;
  }

  // Treat unchanged URL (server didn't redirect) as a failure so the deal
  // gets dropped rather than keeping the rto link in the sheet.
  if (finalUrl === targetUrl) {
    console.warn('BrowserQL returned input unchanged for ' + targetUrl);
    cache.put(key, '__NULL__', 600);
    return null;
  }

  // linkredirect.in is an affiliate middleman between deal sites and retailers
  // and embeds the actual destination in a ?dl= query param. Skip the extra
  // navigation hop by extracting it directly.
  var dlMatch = /[?&]dl=([^&#]+)/i.exec(finalUrl);
  if (dlMatch && /(^|\.)linkredirect\.in$/i.test((/^https?:\/\/([^\/]+)/i.exec(finalUrl) || [, ''])[1])) {
    try {
      var decoded = decodeURIComponent(dlMatch[1]);
      if (/^https?:\/\//i.test(decoded)) {
        console.log('linkredirect.in → ' + decoded);
        finalUrl = decoded;
      }
    } catch (e) {}
  }

  cache.put(key, finalUrl, BROWSERLESS_CACHE_TTL_SECONDS);
  return finalUrl;
}

function _testBrowserless() {
  var rto = 'https://www.indiafreestuff.in/?rto=MjM3ODE1NDM4Mw==';
  console.log('Input : ' + rto);
  console.log('Output: ' + browserlessResolveUrl(rto));
}

// Cache-bypassing diagnostic with explicit step-by-step logging.
function _testBrowserlessFresh() {
  var rto = 'https://www.indiafreestuff.in/?rto=MjM3ODE1NDM4Mw==';
  var cache = CacheService.getScriptCache();
  var key = 'br_' + sha1Short(rto);
  console.log('Cache key   : ' + key);
  console.log('Before clear: ' + (cache.get(key) || '(empty)'));
  cache.remove(key);
  console.log('After clear : ' + (cache.get(key) || '(empty)'));
  console.log('Token set?  : ' + !!PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_BROWSERLESS_TOKEN));
  console.log('Input       : ' + rto);
  var t0 = new Date().getTime();
  var out = browserlessResolveUrl(rto);
  var ms = new Date().getTime() - t0;
  console.log('Output      : ' + out);
  console.log('Took        : ' + ms + 'ms');
}
