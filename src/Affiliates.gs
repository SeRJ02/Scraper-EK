// Wraps the Ekaro / Affiliators link-converter API:
//   POST https://ekaro-api.affiliaters.in/api/converter/public
//   body: { deal: "<text-with-link>", convert_option: "convert_only" }
//   auth: Bearer <AFFILIATE_API_TOKEN script property>
//
// Returns the converted (affiliate) URL on success, or **null** on any failure
// — no token configured, HTTP error, API rejection, parse failure, or a
// response that didn't contain a recognizable URL. Callers are expected to
// drop deals that can't be converted (we don't want non-affiliate links
// reaching the sheet).
//
// Results are cached for 6 hours via CacheService keyed by sha1(url) so we
// don't re-hit the API for URLs we already saw this session.

var AFFILIATE_API_URL = 'https://ekaro-api.affiliaters.in/api/converter/public';
var AFFILIATE_CACHE_TTL_SECONDS = 21600; // 6h

function convertAffiliateLink(originalUrl) {
  if (!originalUrl) return null;
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_AFFILIATE_TOKEN);
  if (!token) {
    console.warn('AFFILIATE_API_TOKEN not set — all deals will be dropped.');
    return null;
  }

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
    return null;
  }

  if (resp.getResponseCode() !== 200) {
    console.warn('Affiliate API HTTP ' + resp.getResponseCode() + ' for ' + originalUrl);
    return null;
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); }
  catch (e) { console.warn('Affiliate parse failed: ' + e); return null; }

  if (!data || data.success !== 1 || !data.data) {
    console.warn('Affiliate API non-success for ' + originalUrl + ': ' +
      (data && (data.message || JSON.stringify(data))));
    return null;
  }

  var converted = String(data.data).trim();
  var urlInText = /(https?:\/\/[^\s"<>]+)/i.exec(converted);
  if (!urlInText) {
    console.warn('Affiliate API returned no URL for ' + originalUrl);
    return null;
  }
  converted = urlInText[1];
  // A successful response that hands back the same URL means no affiliate
  // program matched — treat as a failure so the deal gets dropped.
  if (converted === originalUrl) {
    console.warn('Affiliate API returned input unchanged for ' + originalUrl);
    return null;
  }

  cache.put(key, converted, AFFILIATE_CACHE_TTL_SECONDS);
  return converted;
}

function _testAffiliate() {
  var url = 'https://www.amazon.in/dp/B0D223VZFF';
  console.log('Input : ' + url);
  console.log('Output: ' + convertAffiliateLink(url));
}
