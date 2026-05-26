// Resolve URLs via Browserless v2's BrowserQL endpoint —
// a stealth-enabled headless Chromium that bypasses Cloudflare WAF.
//
// Two entry points:
//   browserlessResolveUrl(url)        — single URL (caching, used for one-offs)
//   browserlessResolveUrls(urlArray)  — BATCH: resolves N URLs in ONE browser session
//                                       (one BrowserQL call = one credit, not N)
//
// Endpoint: POST https://production-sfo.browserless.io/chromium/bql?token=TOKEN
// Auth    : BROWSERLESS_API_TOKEN script property (your v2 token).
// Proxy   : residential India — bypasses Cloudflare datacenter-IP block.
//
// Caching: 6-hour TTL via CacheService keyed by sha1(url).

var BROWSERQL_ENDPOINT = 'https://production-sfo.browserless.io/chromium/bql';
var BROWSERLESS_CACHE_TTL_SECONDS = 21600; // 6h
var BROWSERLESS_NEG_CACHE_TTL = 21600;     // 6h negative cache (same as success)

// ---------------------------------------------------------------------------
// Batch resolver — resolves up to MAX_BATCH_URLS URLs in a single BrowserQL
// call. Returns a plain object mapping input URL → resolved URL (or null).
// ---------------------------------------------------------------------------
var MAX_BATCH_URLS = 15; // keep mutation size reasonable

function browserlessResolveUrls(urls) {
  if (!urls || urls.length === 0) return {};

  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_BROWSERLESS_TOKEN);
  if (!token) {
    console.warn('BROWSERLESS_API_TOKEN not set');
    return {};
  }

  var cache = CacheService.getScriptCache();
  var result = {};
  var toFetch = [];

  // Serve cached results first.
  for (var i = 0; i < urls.length; i++) {
    var u = urls[i];
    var key = 'br_' + sha1Short(u);
    var hit = cache.get(key);
    if (hit) {
      result[u] = (hit === '__NULL__') ? null : hit;
    } else {
      toFetch.push(u);
    }
  }

  if (toFetch.length === 0) return result;

  // Process in chunks so the BrowserQL mutation doesn't get too large.
  for (var start = 0; start < toFetch.length; start += MAX_BATCH_URLS) {
    var chunk = toFetch.slice(start, start + MAX_BATCH_URLS);
    var chunkResult = _batchResolve(chunk, token, cache);
    for (var url in chunkResult) result[url] = chunkResult[url];
  }

  return result;
}

function _batchResolve(urls, token, cache) {
  // Build a single BrowserQL mutation that navigates through each URL
  // sequentially in the same browser tab, reading the final URL after each.
  // One session = one credit regardless of how many URLs we visit.
  var lines = [];
  for (var i = 0; i < urls.length; i++) {
    var idx = i + 1;
    lines.push('  visit' + idx + ': goto(url: ' + JSON.stringify(urls[i]) + ', waitUntil: domContentLoaded) { status }');
    lines.push('  pause' + idx + ': waitForTimeout(time: 2500) { time }');
    lines.push('  url' + idx + ': url { url }');
  }
  var query = 'mutation ResolveBatch {\n' + lines.join('\n') + '\n}';

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
    console.warn('BrowserQL batch fetch threw: ' + e);
    return {};
  }

  if (resp.getResponseCode() !== 200) {
    console.warn('BrowserQL batch HTTP ' + resp.getResponseCode() + ': ' +
      resp.getContentText().substring(0, 300));
    return {};
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); }
  catch (e) { console.warn('BrowserQL batch parse failed: ' + e); return {}; }

  if (data && data.errors) {
    console.warn('BrowserQL batch errors: ' + JSON.stringify(data.errors).substring(0, 300));
    return {};
  }

  var d = data && data.data;
  var result = {};
  for (var i = 0; i < urls.length; i++) {
    var idx = i + 1;
    var urlData = d && d['url' + idx];
    var rawUrl = urlData && urlData.url;
    var finalUrl = _postProcessUrl(rawUrl, urls[i]);
    result[urls[i]] = finalUrl;

    var cacheKey = 'br_' + sha1Short(urls[i]);
    if (finalUrl) {
      cache.put(cacheKey, finalUrl, BROWSERLESS_CACHE_TTL_SECONDS);
    } else {
      cache.put(cacheKey, '__NULL__', BROWSERLESS_NEG_CACHE_TTL);
    }
  }
  return result;
}

// Post-process a raw URL returned by BrowserQL: unwrap linkredirect.in,
// reject unchanged/invalid URLs. Returns the clean retailer URL or null.
function _postProcessUrl(finalUrl, inputUrl) {
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) return null;
  if (finalUrl === inputUrl) {
    console.warn('BrowserQL returned input unchanged for ' + inputUrl);
    return null;
  }

  // linkredirect.in embeds the real destination in a ?dl= query param.
  var dlMatch = /[?&]dl=([^&#]+)/i.exec(finalUrl);
  if (dlMatch) {
    var hostMatch = /^https?:\/\/([^\/]+)/i.exec(finalUrl);
    var host = hostMatch ? hostMatch[1] : '';
    if (/(^|\.)linkredirect\.in$/i.test(host)) {
      try {
        var decoded = decodeURIComponent(dlMatch[1]);
        if (/^https?:\/\//i.test(decoded)) {
          console.log('linkredirect.in → ' + decoded);
          return decoded;
        }
      } catch (e) {}
    }
  }

  return finalUrl;
}

// ---------------------------------------------------------------------------
// Single-URL resolver (backwards-compatible, uses batch internally).
// ---------------------------------------------------------------------------
function browserlessResolveUrl(targetUrl) {
  if (!targetUrl) return null;
  var results = browserlessResolveUrls([targetUrl]);
  return results[targetUrl] || null;
}

function _testBrowserless() {
  var rto = 'https://www.indiafreestuff.in/?rto=MjM3ODE1NDM4Mw==';
  console.log('Input : ' + rto);
  console.log('Output: ' + browserlessResolveUrl(rto));
}

function _testBrowserlessBatch() {
  var urls = [
    'https://www.indiafreestuff.in/?rto=MjM3ODE1NDM4Mw==',
    'https://www.indiafreestuff.in/?rto=Mjg2ODk2NTI5Nw=='
  ];
  console.log(JSON.stringify(browserlessResolveUrls(urls), null, 2));
}

// Cache-bypassing diagnostic.
function _testBrowserlessFresh() {
  var rto = 'https://www.indiafreestuff.in/?rto=MjM3ODE1NDM4Mw==';
  var cache = CacheService.getScriptCache();
  var key = 'br_' + sha1Short(rto);
  cache.remove(key);
  console.log('Token set? ' + !!PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_BROWSERLESS_TOKEN));
  var t0 = new Date().getTime();
  var out = browserlessResolveUrl(rto);
  console.log('Output: ' + out + ' (' + (new Date().getTime() - t0) + 'ms)');
}
