// Scraper for https://www.pricebefore.com/price-drops/?price-drop=todaysDeals
//
// The page is likely rendered client-side. This scraper first tries to parse
// any embedded JSON in the initial HTML (a common Next.js pattern stores deal
// data in <script id="__NEXT_DATA__">). If that yields nothing, it falls back
// to a regex sweep of the raw HTML; if still empty, the run returns [] and
// logs a warning — Apps Script cannot run JS to render an SPA. In that case,
// inspect the live Network tab for a JSON endpoint and replace fetch() below.

var PriceBefore = (function () {
  var NAME = 'pricebefore';
  var URL = 'https://www.pricebefore.com/price-drops/?price-drop=todaysDeals';

  function fetch() {
    var html;
    try { html = fetchHtml(URL); }
    catch (e) { console.warn(NAME + ' fetch failed: ' + e); return []; }

    var deals = parseNextData(html);
    if (deals.length) return deals;

    deals = parseGenericCards(html);
    if (!deals.length) {
      console.warn(NAME + ': no deals parsed — page likely needs JS. ' +
        'Inspect DevTools → Network for a JSON endpoint and update this scraper.');
    }
    return deals;
  }

  function parseNextData(html) {
    var m = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return [];
    var data;
    try { data = JSON.parse(m[1]); }
    catch (e) { return []; }
    var found = [];
    walk(data, found);
    return found.map(toDeal).filter(Boolean);
  }

  // Recursively find objects that look like a deal record.
  function walk(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walk(node[i], out);
      return;
    }
    if (looksLikeDeal(node)) out.push(node);
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k], out);
    }
  }

  function looksLikeDeal(o) {
    var hasPrice = ('current_price' in o) || ('currentPrice' in o) || ('price' in o);
    var hasLink = ('url' in o) || ('product_url' in o) || ('amazon_url' in o) || ('affiliate_url' in o);
    var hasTitle = ('title' in o) || ('name' in o) || ('product_name' in o);
    return hasPrice && hasLink && hasTitle;
  }

  function toDeal(o) {
    var title = o.title || o.name || o.product_name;
    var current = parsePrice(o.current_price || o.currentPrice || o.price);
    var original = parsePrice(o.original_price || o.originalPrice || o.mrp || o.list_price);
    var image = o.image || o.image_url || o.thumbnail || '';
    var src = o.url || o.product_url || o.affiliate_url || o.amazon_url || '';
    if (!src || !title) return null;
    var amazonLink = resolveAmazonLink(src);
    return {
      source: NAME,
      title: stripTags(title),
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: src,
      amazonLink: amazonLink,
      id: sha1Short(amazonLink || src || title)
    };
  }

  function parseGenericCards(html) {
    // Last-resort: scan for amazon links + nearby titles/prices.
    var out = [];
    var seen = {};
    var re = /href="(https?:\/\/[^"]*(?:amazon\.[a-z.]+|amzn\.(?:to|in))[^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var link = m[1];
      if (seen[link]) continue;
      seen[link] = true;
      var ctx = html.substring(Math.max(0, m.index - 600), m.index + 600);
      var titleM = /<(?:h[1-6]|a)[^>]*>([^<]{8,120})<\/(?:h[1-6]|a)>/i.exec(ctx);
      var priceM = /(?:₹|Rs\.?\s*)([\d,]+(?:\.\d+)?)/.exec(ctx);
      var imgM = /<img[^>]+src="([^"]+)"/i.exec(ctx);
      var amazonLink = resolveAmazonLink(link);
      out.push({
        source: NAME,
        title: titleM ? stripTags(titleM[1]) : '(untitled)',
        currentPrice: priceM ? parsePrice(priceM[1]) : null,
        originalPrice: null,
        imageUrl: imgM ? imgM[1] : '',
        sourceLink: link,
        amazonLink: amazonLink,
        id: sha1Short(amazonLink || link)
      });
      if (out.length >= 20) break;
    }
    return out;
  }

  return { name: NAME, fetch: fetch };
})();

function _testPriceBefore() {
  console.log(JSON.stringify(PriceBefore.fetch().slice(0, 3), null, 2));
}
