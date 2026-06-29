// Scraper for https://www.dealsmagnet.com/offers/flipkart
//
// Page is JS-rendered — fetched via Firecrawl (headless browser).
// HTML is cached for 2 hours so we only burn ~12 Firecrawl credits/day.
//
// Run _debugDealsMagnet() first to inspect the rendered card HTML,
// then update the selectors in parseCard() below.

var DealsMagnet = (function () {
  var NAME = 'flipkart';
  var ENDPOINT = 'https://www.dealsmagnet.com/offers/flipkart';
  var MAX_CARDS = 15;

  function fetch() {
    var html;
    try { html = firecrawlFetch(ENDPOINT); }
    catch (e) { console.warn(NAME + ' firecrawl failed: ' + e); return []; }

    var cards = splitCards(html);
    console.log('DealsMagnet: ' + cards.length + ' cards found');
    var deals = [];
    for (var i = 0; i < Math.min(cards.length, MAX_CARDS); i++) {
      try {
        var d = parseCard(cards[i]);
        if (d && d.buyLink) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    return deals;
  }

  function splitCards(html) {
    // Selectors to be confirmed after running _debugDealsMagnet()
    var positions = [];
    var re = /<div\b[^>]*class="[^"]*\b(?:card|deal-card|offer-card|deal-item)\b[^"]*"[^>]*>/gi;
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
    // Buy link — flipkart.com direct or dealsmagnet redirector
    var fkM = /href="(https?:\/\/(?:www\.)?flipkart\.com\/[^"]+)"/i.exec(block);
    var redirM = /href="(https?:\/\/(?:www\.)?dealsmagnet\.com\/[^"]*(?:go|out|redirect|track)[^"]*|\/(?:go|out|redirect|track)\/[^"]+)"/i.exec(block);
    var buyLink = fkM ? decodeEntities(fkM[1]) : (redirM ? decodeEntities(redirM[1]) : null);

    var titleM = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(block) ||
                 /<a[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
                 /<[^>]*class="[^"]*\b(?:card-title|deal-title|product-title)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var title = titleM ? stripTags(titleM[1]) : '';

    var imgM = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var curM = /<[^>]*class="[^"]*\b(?:price|new-price|deal-price|sp)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var oldM = /<[^>]*class="[^"]*\b(?:mrp|old-price|original-price|strike)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    var current = curM ? parsePrice(stripTags(curM[1])) : null;
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    var discM = /<[^>]*class="[^"]*\b(?:discount|off)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
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
      merchant: 'flipkart',
      buyLink: buyLink,
      id: sha1Short((buyLink || '') + '|' + title),
      discount: discount
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testDealsMagnet() {
  console.log(JSON.stringify(DealsMagnet.fetch().slice(0, 3), null, 2));
}

// Run this first to inspect the rendered card HTML and verify selectors.
function _debugDealsMagnet() {
  var html = firecrawlFetch('https://www.dealsmagnet.com/offers/flipkart');
  console.log('HTML length: ' + html.length);
  console.log('flipkart.com hits: ' + (html.match(/flipkart\.com/g) || []).length);
  console.log('card hits: ' + (html.match(/\bcard\b/g) || []).length);
  console.log('deal hits: ' + (html.match(/\bdeal\b/g) || []).length);

  // Print first 2 card-like blocks
  var positions = [];
  var re = /<div\b[^>]*class="[^"]*\b(?:card|deal-card|offer-card)\b[^"]*"[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) positions.push(m.index);
  console.log('Card divs found: ' + positions.length);
  for (var i = 0; i < Math.min(2, positions.length); i++) {
    var end = i + 1 < positions.length ? positions[i + 1] : positions[i] + 3000;
    console.log('--- CARD ' + (i + 1) + ' ---\n' + html.substring(positions[i], end));
  }
  if (!positions.length) {
    // Dump a middle section to see what's there
    console.log('Mid HTML (chars 10000-13000):\n' + html.substring(10000, 13000));
  }
}
