// Scraper for https://www.offertag.in/shops/ajio
//
// Same JSON/HTML structure as offertag.in/shops/myntra:
//   { "deals": "<html with cards>" }
//   <div class="featured-item-container col-md-3 col-xs-6">
//     <div class="deal_link" data-alt-href="https://ck.ajio.com/..." data-id="...">
//       <img data-src="https://www.offertag.in/storage/deal/thumbnail/...">
//     </div>
//     <h4>Title upto X% off</h4>
//     <div class="old-price"><span>₹3,999</span></div>
//     <div class="new-price"><span>₹499</span></div>
//     <div class="discount"><span>87% Off</span></div>
//   </div>
//
// Each cycle returns top-2 by highest discount %, NO seenIds dedup — always fresh.

var SmartprixAjio = (function () {
  var NAME = 'ajio';
  var ENDPOINT = 'https://www.offertag.in/shops/ajio';
  var TOP_N = 2;

  function fetch() {
    var raw = fetchViaProxy(ENDPOINT);
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      console.warn(NAME + ': JSON parse failed: ' + e);
      return [];
    }
    var html = parsed.deals || '';
    var cards = splitCards(html);
    var deals = [];
    for (var i = 0; i < cards.length; i++) {
      try {
        var d = parseCard(cards[i]);
        if (d) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    deals.sort(function (a, b) { return (b.discount || 0) - (a.discount || 0); });
    return deals.slice(0, TOP_N);
  }

  function splitCards(html) {
    var positions = [];
    var re = /<div\b[^>]*class="[^"]*\bfeatured-item-container\b[^"]*"[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) positions.push(m.index);
    var out = [];
    for (var i = 0; i < positions.length; i++) {
      var end = i + 1 < positions.length ? positions[i + 1] : positions[i] + 2000;
      out.push(html.substring(positions[i], end));
    }
    return out;
  }

  function parseCard(block) {
    var linkTagM = /<div\b[^>]*class="[^"]*\bdeal_link\b[^"]*"[^>]*>/i.exec(block);
    if (!linkTagM) return null;
    var hrefM = /\bdata-alt-href="([^"]+)"/i.exec(linkTagM[0]);
    if (!hrefM) return null;
    var buyLink = hrefM[1];

    var titleM = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(block);
    var title = titleM ? stripTags(titleM[1]) : '';

    var imgM = /<img[^>]+data-src="([^"]+)"/i.exec(block) ||
               /<img[^>]+src="([^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var oldM = /<div[^>]*class="[^"]*\bold-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var newM = /<div[^>]*class="[^"]*\bnew-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;
    var current  = newM ? parsePrice(stripTags(newM[1])) : null;

    var discM = /<div[^>]*class="[^"]*\bdiscount\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var discount = discM ? (parseFloat(stripTags(discM[1])) || 0) : 0;

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: ENDPOINT,
      merchant: 'ajio',
      buyLink: buyLink,
      id: sha1Short(buyLink + '|' + title),
      discount: discount
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testSmartprixAjio() {
  console.log(JSON.stringify(SmartprixAjio.fetch(), null, 2));
}
