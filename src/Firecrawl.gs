// Firecrawl.dev API wrapper.
//
// Fetches a JS-rendered page via Firecrawl's headless browser and returns
// the full HTML. Results are cached in CacheService for CACHE_TTL_SECONDS
// so repeated scrape cycles don't burn a credit every 30 minutes.
//
// At 2-hour cache TTL and 30-min poll: max 12 credits/day = ~360/month,
// well within the 500-credit free tier.
//
// Requires script property: FIRECRAWL_API_TOKEN

var FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';
var FIRECRAWL_CACHE_TTL = 7200; // 2 hours

function firecrawlFetch(targetUrl) {
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_FIRECRAWL_TOKEN);
  if (!token) throw new Error('FIRECRAWL_API_TOKEN not set in Script Properties.');

  var cache = CacheService.getScriptCache();
  var cacheKey = 'fc_' + sha1Short(targetUrl);
  var cached = cache.get(cacheKey);
  if (cached) {
    console.log('Firecrawl cache hit for ' + targetUrl);
    return cached;
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(FIRECRAWL_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ url: targetUrl, formats: ['html'] }),
      muteHttpExceptions: true
    });
  } catch (e) {
    throw new Error('Firecrawl fetch threw: ' + e);
  }

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Firecrawl HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); }
  catch (e) { throw new Error('Firecrawl JSON parse failed: ' + e); }

  if (!data.success || !data.data || !data.data.html) {
    throw new Error('Firecrawl returned no HTML: ' + JSON.stringify(data).substring(0, 200));
  }

  var html = data.data.html;
  // CacheService max value is 100KB — truncate silently if larger (still parseable).
  var toCache = html.length > 99000 ? html.substring(0, 99000) : html;
  cache.put(cacheKey, toCache, FIRECRAWL_CACHE_TTL);
  return html;
}
