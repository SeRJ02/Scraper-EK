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
  // Source sites (indiafreestuff, bigtricks) block Apps Script's IP. If the
  // starting URL is on one of those hosts, ask the Worker to chase the chain
  // (HTTP + HTML/JS bounces) from Cloudflare's edge and return the final URL.
  var startHostM = /^https?:\/\/([^\/]+)/i.exec(current);
  if (startHostM && SOURCE_HOST_RE.test(startHostM[1])) {
    var viaProxy = proxyResolveUrl(current);
    if (viaProxy) current = viaProxy;
  } else {
    // Non-source host (amzn.to, fkrt.it, direct amazon/flipkart/etc.): chase
    // plain HTTP redirects directly. NO HTML-body bounce parsing here —
    // retailer product pages reference their own asset URLs that would
    // false-match a generic "find retailer link" regex.
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
      break;
    }
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
