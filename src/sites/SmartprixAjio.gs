// Scraper for https://www.smartprix.com/deals/ajio-store
//
// Fetches top deals on the Ajio store page on Smartprix. Picks top-2 by
// highest discount % and always refreshes rows 7-8 each cycle (no seenIds dedup).
//
// NOTE: card selectors below are based on Smartprix's typical deal-card markup.
// If the page renders differently, run _debugSmartprixAjio() to dump the
// raw HTML and adjust the regexes.

var SmartprixAjio = (function () {
  var NAME = 'ajio';
  var ENDPOINT = 'https://www.smartprix.com/deals/ajio-store';
  var TOP_N = 2;

  function fetch() {
    var html;
    try { html = fetchViaProxy(ENDPOINT); }
    catch (e) { console.warn(NAME + ' fetch failed: ' + e); return []; }

    var cards = splitCards(html);
    var deals = [];
    for (var i = 0; i < cards.length; i++) {
      try {
        var d = parseCard(cards[i]);
        if (d && d.buyLink) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    deals.sort(function (a, b) { return (b.discount || 0) - (a.discount || 0); });
    return deals.slice(0, TOP_N);
  }

  // Smartprix deal cards: <div class="dlst-itm"> wrappers. Fallback to
  // generic deal-card class names if the markup uses a different wrapper.
  function splitCards(html) {
    var positions = [];
    var re = /<div\b[^>]*class="[^"]*\b(?:dlst-itm|sm-deal|deal-card|prd-itm)\b[^"]*"[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) positions.push(m.index);
    var out = [];
    for (var i = 0; i < positions.length; i++) {
      var end = i + 1 < positions.length ? positions[i + 1] : positions[i] + 3000;
      out.push(html.substring(positions[i], end));
    }
    return out;
  }

  function parseCard(block) {
    // Outbound link: prefer a direct ajio.com URL if present, otherwise the
    // Smartprix /out/ redirector — the worker can resolve that on demand.
    var ajioM = /href="(https?:\/\/(?:www\.)?ajio\.com\/[^"]+)"/i.exec(block);
    var buyLink = ajioM ? decodeEntities(ajioM[1]) : null;
    if (!buyLink) {
      var outM = /href="(https?:\/\/(?:www\.)?smartprix\.com\/out\/[^"]+)"/i.exec(block);
      if (outM) buyLink = decodeEntities(outM[1]);
    }

    // Title: alt on the image, or <h3>/<h2>/<a class*=title>
    var titleM = /<img[^>]+alt="([^"]+)"/i.exec(block) ||
                 /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(block) ||
                 /<a[^>]+class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    var title = titleM ? stripTags(titleM[1]) : '';

    // Image — Smartprix uses data-src for lazy-loaded images.
    var imgM = /<img[^>]+data-src="([^"]+)"/i.exec(block) ||
               /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    // Prices: common class patterns on Smartprix.
    var currentM = /<[^>]*class="[^"]*\b(?:price|sm-prc|deal-price|new-price)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var originalM = /<[^>]*class="[^"]*\b(?:mrp|old-price|original-price|sm-mrp|strike)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var current = currentM ? parsePrice(stripTags(currentM[1])) : null;
    var original = originalM ? parsePrice(stripTags(originalM[1])) : null;

    // Discount % — explicit element if present, otherwise computed.
    var discM = /<[^>]*class="[^"]*\b(?:discount|off|sm-off)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var discount = discM ? (parseFloat(stripTags(discM[1])) || 0) : 0;
    if (!discount && current && original && original > current) {
      discount = Math.round((original - current) * 100 / original);
    }

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: ENDPOINT,
      merchant: 'ajio',
      buyLink: buyLink,
      id: sha1Short((buyLink || '') + '|' + title),
      discount: discount
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testSmartprixAjio() {
  console.log(JSON.stringify(SmartprixAjio.fetch(), null, 2));
}

// Dump the first card block raw so we can verify selectors against the actual markup.
function _debugSmartprixAjio() {
  var html = fetchViaProxy('https://www.smartprix.com/deals/ajio-store');
  console.log('HTML length: ' + html.length);
  console.log('dlst-itm hits: ' + (html.match(/dlst-itm/g) || []).length);
  console.log('sm-deal hits: '  + (html.match(/sm-deal/g)  || []).length);
  console.log('deal-card hits: '+ (html.match(/deal-card/g)|| []).length);
  console.log('ajio.com hits: ' + (html.match(/ajio\.com/g)|| []).length);
  console.log('First 2000 chars:\n' + html.substring(0, 2000));
}
