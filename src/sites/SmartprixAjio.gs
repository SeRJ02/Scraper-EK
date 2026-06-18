// Scraper for https://www.smartprix.com/deals/ajio-store
//
// Card structure (confirmed from live HTML):
//   <div class="sm-deal" data-way>
//     <div class="sm-img-wrap"><img class="sm-img" src="CDN_URL" alt="TITLE"></div>
//     <a href="/nf/dl/..." class="name clamp-3">TITLE</a>
//     <span class="price">From ₹375</span>
//     <div class="store">
//       <a class="sm-btn ..." href="https://l.smartprix.com/l?k=...">Visit</a>
//     </div>
//   </div>
//
// Buy link is a smartprix redirect (l.smartprix.com/l?k=...) resolved via
// proxyResolveUrl — only called for the top-2 cards to avoid extra proxy hits.
// Discount % is parsed from the title text ("Min. 60% OFF", "Upto 90% off").

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
        if (d) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }

    // Sort by discount first, then resolve redirect links only for the top-N
    // to avoid unnecessary proxy calls for the rest of the cards.
    deals.sort(function (a, b) { return (b.discount || 0) - (a.discount || 0); });
    var top = deals.slice(0, TOP_N);
    for (var j = 0; j < top.length; j++) {
      if (top[j]._rawLink) {
        var resolved = proxyResolveUrl(top[j]._rawLink);
        top[j].buyLink = resolved || null;
        delete top[j]._rawLink;
      }
    }
    return top.filter(function (d) { return d.buyLink; });
  }

  function splitCards(html) {
    var positions = [];
    var re = /<div\b[^>]*class="[^"]*\bsm-deal\b[^"]*"[^>]*>/gi;
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
    // Title from <a class="name clamp-3">
    var titleM = /<a\b[^>]*class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    var title = titleM ? stripTags(titleM[1]) : '';
    if (!title) return null;

    // Image from <img class="sm-img">
    var imgM = /<img\b[^>]*\bsm-img\b[^>]*>/i.exec(block);
    var image = '';
    if (imgM) {
      var srcM = /\bsrc="([^"]+)"/i.exec(imgM[0]);
      if (srcM) image = srcM[1];
    }

    // Current price from <span class="price">
    var priceM = /<span\b[^>]*class="[^"]*\bprice\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    var current = priceM ? parsePrice(stripTags(priceM[1])) : null;

    // Discount % parsed from title text: "Min. 60% OFF" / "Upto 90% off" / "60% off"
    var discM = /(\d+)\s*%\s*off/i.exec(title);
    var discount = discM ? parseInt(discM[1], 10) : 0;

    // Raw redirect link from the Visit button — resolved later for top-N only.
    var visitM = /href="(https?:\/\/l\.smartprix\.com\/l\?[^"]+)"/i.exec(block);
    var rawLink = visitM ? decodeEntities(visitM[1]) : null;

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: null,
      imageUrl: image,
      sourceLink: ENDPOINT,
      merchant: 'ajio',
      buyLink: null,
      _rawLink: rawLink,
      id: sha1Short((rawLink || '') + '|' + title),
      discount: discount
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testSmartprixAjio() {
  console.log(JSON.stringify(SmartprixAjio.fetch(), null, 2));
}

function _debugSmartprixAjio() {
  var html = fetchViaProxy('https://www.smartprix.com/deals/ajio-store');
  console.log('HTML length: ' + html.length);
  console.log('sm-deal hits: ' + (html.match(/sm-deal/g) || []).length);
  console.log('l.smartprix.com hits: ' + (html.match(/l\.smartprix\.com/g) || []).length);
  var positions = [];
  var re = /<div\b[^>]*class="[^"]*\bsm-deal\b[^"]*"[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) positions.push(m.index);
  for (var i = 0; i < Math.min(2, positions.length); i++) {
    var end = i + 1 < positions.length ? positions[i + 1] : positions[i] + 3000;
    console.log('--- CARD ' + (i + 1) + ' ---\n' + html.substring(positions[i], end));
  }
}
