// Wraps the Ekaro / Affiliators link-converter API:
//   POST https://ekaro-api.affiliaters.in/api/converter/public
//   body: { deal: "<text-with-link>", convert_option: "convert_only" }
//   auth: Bearer <AFFILIATE_API_TOKEN script property>
//
// Returns the converted (affiliate) URL on success. On any failure — no token
// configured, HTTP error, parse failure — returns the original URL so the
// sheet still has a working link.
//
// Results are cached for 6 hours via CacheService keyed by sha1(url) so we
// don't re-hit the API for URLs we already saw this session.

var AFFILIATE_API_URL = 'https://ekaro-api.affiliaters.in/api/converter/public';
var AFFILIATE_CACHE_TTL_SECONDS = 21600; // 6h

function convertAffiliateLink(originalUrl) {
  if (!originalUrl) return originalUrl;
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_AFFILIATE_TOKEN);
  if (!token) return originalUrl;

  var cache = CacheService.getScriptCache();
  var key = 'aff_' + sha1Short(originalUrl);
  var hit = cache.get(key);
  if (hit) return hit;

  var resp;
  try {
    resp = UrlFetchApp.fetch(AFFILIATE_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ deal: originalUrl, convert_option: 'convert_only' }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.warn('Affiliate fetch threw: ' + e);
    return originalUrl;
  }

  if (resp.getResponseCode() !== 200) {
    console.warn('Affiliate API HTTP ' + resp.getResponseCode() + ' for ' + originalUrl);
    return originalUrl;
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); }
  catch (e) { console.warn('Affiliate parse failed: ' + e); return originalUrl; }

  if (!data || data.success !== 1 || !data.data) {
    console.warn('Affiliate API non-success: ' + (data && data.message));
    return originalUrl;
  }

  // The API returns the converted text. Extract a URL from it; fall back to
  // the whole string if it already is a URL.
  var converted = String(data.data).trim();
  var urlInText = /(https?:\/\/[^\s"<>]+)/i.exec(converted);
  if (urlInText) converted = urlInText[1];

  cache.put(key, converted, AFFILIATE_CACHE_TTL_SECONDS);
  return converted;
}

function _testAffiliate() {
  var url = 'https://www.amazon.in/dp/B0D223VZFF';
  console.log('Input : ' + url);
  console.log('Output: ' + convertAffiliateLink(url));
}
