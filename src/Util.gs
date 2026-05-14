// Generic helpers: HTTP fetch, hashing, price parsing, regex helpers.

function fetchHtml(url, extraHeaders) {
  var headers = {
    'User-Agent': CONFIG.USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: headers
  });
  if (resp.getResponseCode() >= 400) {
    throw new Error('HTTP ' + resp.getResponseCode() + ' for ' + url);
  }
  return resp.getContentText();
}

function fetchJson(url) {
  return JSON.parse(fetchHtml(url));
}

// Fetch via the Cloudflare Worker proxy (for hosts that 403 Apps Script's IP).
// Worker URL + token live in Script Properties; if not set, throws so the
// caller can fall back / log clearly.
function fetchViaProxy(targetUrl) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty(CONFIG.PROP_WORKER_URL);
  var token = props.getProperty(CONFIG.PROP_WORKER_TOKEN);
  if (!base || !token) {
    throw new Error(
      'Proxy not configured. Set Script Properties ' +
      CONFIG.PROP_WORKER_URL + ' and ' + CONFIG.PROP_WORKER_TOKEN + '.'
    );
  }
  var proxied = base.replace(/\/+$/, '') +
    '/?url=' + encodeURIComponent(targetUrl) +
    '&token=' + encodeURIComponent(token);
  return fetchHtml(proxied);
}

// Short stable id for deduplication.
function sha1Short(str) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    String(str)
  );
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    var h = b.toString(16);
    hex += h.length === 1 ? '0' + h : h;
  }
  return hex.substring(0, 16);
}

// Pull the first INR-style number out of a string. Handles "₹1,299", "Rs. 999", "1299.00".
function parsePrice(str) {
  if (str == null) return null;
  var m = String(str).replace(/[,\s]/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

// Decode common HTML entities so titles look right in the sheet.
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .trim();
}

// Strip HTML tags from a snippet.
function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

// Run a global regex and return all matches as arrays of capture groups.
function matchAll(html, re) {
  var out = [];
  var m;
  while ((m = re.exec(html)) !== null) out.push(m);
  return out;
}

// Extract attribute value from an HTML tag string.
function attr(tag, name) {
  var re = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i');
  var m = re.exec(tag);
  if (m) return m[1];
  re = new RegExp(name + "\\s*=\\s*'([^']*)'", 'i');
  m = re.exec(tag);
  return m ? m[1] : '';
}
