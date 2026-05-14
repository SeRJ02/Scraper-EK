// Scraper for https://www.indiafreestuff.in/
//
// DOM (verified live):
//   <div class="col-xs-3 product-outer">
//     <div class="product-item">
//       <a class="product-img" href="DETAIL_URL"><img src="IMG"></a>
//       <a class="item-title"  href="DETAIL_URL">TITLE</a>
//       <div class="price-wrap">
//         <div class="old-price"><p><i class="fa fa-inr"></i> 415 </p></div>
//         <div class="new-price"><p><i class="fa fa-inr"></i> 225 </p></div>
//       </div>
//       <div class="product-footer">
//         <div class="logo-shop-now">
//           <a class="btn btn-shopnow ripplelink" href="https://www.indiafreestuff.in/?rto=XXX">Shop Now</a>
//         </div>
//       </div>
//     </div>
//   </div>
//
// The `?rto=` URL is a server-side 30x redirect to the actual Amazon/Flipkart
// product page. We chase it via Amazon.resolveAmazonLink.

var IndiaFreeStuff = (function () {
  var NAME = 'indiafreestuff';
  var BASE = 'https://www.indiafreestuff.in/deals/trending';
  var MAX_CARDS = 25;

  function fetch() {
    var html = fetchWithFallback();
    var cards = splitCards(html).slice(0, MAX_CARDS);
    var deals = [];
    for (var i = 0; i < cards.length; i++) {
      try {
        var d = parseCard(cards[i]);
        if (d) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    return deals;
  }

  // Try /deals/trending first; fall back to homepage if it 403s.
  function fetchWithFallback() {
    var urls = [
      'https://www.indiafreestuff.in/deals/trending',
      'https://www.indiafreestuff.in/'
    ];
    var lastErr;
    for (var i = 0; i < urls.length; i++) {
      try {
        return fetchHtml(urls[i], { 'Referer': 'https://www.indiafreestuff.in/' });
      } catch (e) {
        lastErr = e;
        console.warn(NAME + ' fetch ' + urls[i] + ' failed: ' + e);
      }
    }
    throw lastErr;
  }

  // Slice the page into per-card HTML blocks by anchoring on the product-outer wrapper.
  function splitCards(html) {
    var positions = [];
    var re = /<div\s+class="col-xs-\d+\s+product-outer"[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) positions.push(m.index);
    var blocks = [];
    for (var i = 0; i < positions.length; i++) {
      var end = i + 1 < positions.length ? positions[i + 1] : positions[i] + 4000;
      blocks.push(html.substring(positions[i], end));
    }
    return blocks;
  }

  function parseCard(block) {
    var titleM = /<a[^>]*class="[^"]*\bitem-title\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleM) return null;
    var detailUrl = titleM[1];
    var title = stripTags(titleM[2]);

    var imgM = /<a[^>]*class="[^"]*\bproduct-img\b[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var newM = /<div[^>]*class="[^"]*\bnew-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var oldM = /<div[^>]*class="[^"]*\bold-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = newM ? parsePrice(stripTags(newM[1])) : null;
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    var shopM = /<a[^>]*class="[^"]*\bbtn-shopnow\b[^"]*"[^>]+href="([^"]+)"/i.exec(block);
    var outbound = shopM ? shopM[1] : detailUrl;
    var amazonLink = resolveAmazonLink(outbound);

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: detailUrl,
      amazonLink: amazonLink,
      id: sha1Short(amazonLink || outbound || detailUrl || title)
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testIndiaFreeStuff() {
  console.log(JSON.stringify(IndiaFreeStuff.fetch().slice(0, 3), null, 2));
}

// Probe each candidate URL and dump what we got back.
function _debugIndiaFreeStuff() {
  var urls = [
    'https://www.indiafreestuff.in/deals/trending',
    'https://www.indiafreestuff.in/'
  ];
  for (var i = 0; i < urls.length; i++) {
    console.log('\n=== ' + urls[i] + ' ===');
    try {
      var html = fetchHtml(urls[i], { 'Referer': 'https://www.indiafreestuff.in/' });
      console.log('OK length=' + html.length);
      console.log('<title>: ' + (/<title>([^<]+)<\/title>/i.exec(html) || ['n/a'])[1]);
      console.log('product-outer: ' + (html.match(/product-outer/g) || []).length);
      console.log('product-item: ' + (html.match(/product-item/g) || []).length);
      console.log('item-title: ' + (html.match(/item-title/g) || []).length);
      console.log('First 400 chars:\n' + html.substring(0, 400));
      var idx = html.indexOf('product-outer');
      if (idx >= 0) {
        console.log('--- first product-outer context ---\n' +
          html.substring(Math.max(0, idx - 80), idx + 500));
      }
    } catch (e) {
      console.log('FAILED: ' + e);
    }
  }
}
