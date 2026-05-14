// Buy-link resolver: follow redirects on an outbound deal-site URL and report
// the final destination if it lands on Amazon or Flipkart.
//
// UrlFetchApp does not expose the post-redirect URL when followRedirects:true,
// so we chase Location headers ourselves.
//
// Returns either:
//   { url: <canonical buy URL>, merchant: 'amazon' | 'flipkart' }
// or null if the redirect chain ended somewhere else.
//
// Backwards-compatible thin wrapper resolveAmazonLink(url) → string|null still
// exists so older callers keep working; it returns the URL only when the
// final host is Amazon.

var AMAZON_HOST_RE   = /(^|\.)amazon\.(in|com)$|(^|\.)amzn\.to$|(^|\.)amzn\.in$/i;
var FLIPKART_HOST_RE = /(^|\.)flipkart\.com$|(^|\.)fkrt\.(it|cc)$|(^|\.)dl\.flipkart\.com$/i;
// Hosts we should never expose as the "buy" link — they're deal-site pages,
// not retailers. If the redirect chain ends here, treat it as unresolved.
var SOURCE_HOST_RE = /(^|\.)indiafreestuff\.in$|(^|\.)bigtricks\.in$|(^|\.)pricebefore\.com$|(^|\.)price-history\.in$/i;

function resolveBuyLink(url) {
  if (!url) return null;
  var current = url;
  for (var i = 0; i < 8; i++) {
    var resp;
    try {
      resp = UrlFetchApp.fetch(current, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
        headers: { 'User-Agent': CONFIG.USER_AGENT }
      });
    } catch (e) {
      break;
    }
    var code = resp.getResponseCode();
    if (code >= 300 && code < 400) {
      var loc = resp.getAllHeaders()['Location'] || resp.getAllHeaders()['location'];
      if (!loc) break;
      current = absolutize(current, loc);
      continue;
    }
    if (code === 200) {
      // Some redirectors (?rto=...) return 200 with an HTML page that
      // bounces via <meta http-equiv="refresh"> or window.location=.
      // UrlFetchApp can't execute JS, but we can parse for these patterns.
      var body = '';
      try { body = resp.getContentText(); } catch (e) { body = ''; }
      var bouncedTo = extractBounce(body);
      if (bouncedTo && bouncedTo !== current) {
        current = absolutize(current, bouncedTo);
        continue;
      }
    }
    break;
  }
  var hostM = /^https?:\/\/([^\/]+)/i.exec(current);
  if (!hostM) return null;
  var host = hostM[1];
  // Never surface a deal-site URL as the buy link — those are sources, not retailers.
  if (SOURCE_HOST_RE.test(host)) return null;
  if (AMAZON_HOST_RE.test(host))   return { url: cleanAmazon(current),   merchant: 'amazon' };
  if (FLIPKART_HOST_RE.test(host)) return { url: cleanFlipkart(current), merchant: 'flipkart' };
  // Other retailers (Myntra, Ajio, Snapdeal, ...) — keep the URL.
  return { url: current.split('?')[0], merchant: host.replace(/^www\./, '') };
}

// Look for a non-HTTP-redirect bounce inside an HTML body. Returns the
// destination URL or null.
function extractBounce(html) {
  var meta = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s>]+)/i.exec(html);
  if (meta) return meta[1];
  var js = /(?:window\.location(?:\.href)?|location\.href|location\.replace\s*\(?)\s*=?\s*["']([^"']+)["']/i.exec(html);
  if (js) return js[1];
  // Anchor href fallback (some "press to continue" interstitials).
  var canonicalRetailer = /href="(https?:\/\/(?:[^"]*amazon\.[a-z.]+|amzn\.(?:to|in)|(?:www\.)?flipkart\.com|fkrt\.(?:it|cc)|(?:www\.)?myntra\.com|(?:www\.)?ajio\.com|(?:www\.)?snapdeal\.com)\/[^"]+)"/i.exec(html);
  if (canonicalRetailer) return canonicalRetailer[1];
  return null;
}

function resolveAmazonLink(url) {
  var r = resolveBuyLink(url);
  return r && r.merchant === 'amazon' ? r.url : null;
}

// Strip tracking junk; collapse to /dp/<ASIN> form when present.
function cleanAmazon(url) {
  var asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(url);
  if (asin) {
    var host = /^https?:\/\/([^\/]+)/i.exec(url)[1];
    return 'https://' + host + '/dp/' + asin[1];
  }
  return url.split('?')[0];
}

// Strip Flipkart affiliate/marketing params but keep the product path + pid.
function cleanFlipkart(url) {
  var split = url.split('?');
  var base = split[0];
  if (!split[1]) return base;
  // Keep only `pid` (Flipkart's product id) — it's all that identifies the listing.
  var keep = [];
  var pairs = split[1].split('&');
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i].split('=');
    if (p[0] === 'pid') keep.push(pairs[i]);
  }
  return keep.length ? base + '?' + keep.join('&') : base;
}

function absolutize(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var m = /^(https?:\/\/[^\/]+)/i.exec(base);
  if (!m) return loc;
  if (loc.charAt(0) === '/') return m[1] + loc;
  return m[1] + '/' + loc;
}
