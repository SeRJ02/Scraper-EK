// Resolve an outbound deal-site link to its final amazon.in URL by chasing
// redirects manually. UrlFetchApp does not expose the post-redirect URL when
// followRedirects:true, so we follow Location headers ourselves.

var AMAZON_HOST_RE = /(^|\.)amazon\.(in|com)$|(^|\.)amzn\.to$|(^|\.)amzn\.in$/i;

function resolveAmazonLink(url) {
  if (!url) return null;
  var current = url;
  for (var i = 0; i < 6; i++) {
    var resp;
    try {
      resp = UrlFetchApp.fetch(current, {
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
        headers: { 'User-Agent': CONFIG.USER_AGENT }
      });
    } catch (e) {
      return isAmazon(current) ? cleanAmazon(current) : null;
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
  return isAmazon(current) ? cleanAmazon(current) : null;
}

function isAmazon(url) {
  var m = /^https?:\/\/([^\/]+)/i.exec(url);
  return m ? AMAZON_HOST_RE.test(m[1]) : false;
}

// Strip tracking/affiliate params; keep the canonical /dp/<ASIN> form when present.
function cleanAmazon(url) {
  var asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(url);
  if (asin) {
    var host = /^https?:\/\/([^\/]+)/i.exec(url)[1];
    return 'https://' + host + '/dp/' + asin[1];
  }
  return url.split('?')[0];
}

function absolutize(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var m = /^(https?:\/\/[^\/]+)/i.exec(base);
  if (!m) return loc;
  if (loc.charAt(0) === '/') return m[1] + loc;
  return m[1] + '/' + loc;
}
