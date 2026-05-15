// Scraper for IndiaFreeStuff.
//
// The homepage and /deals/trending are bot-blocked (403) by Cloudflare for
// Apps Script's UrlFetchApp. The site's own AJAX endpoint that fills the
// homepage product grid is open and returns the same HTML cards:
//
//   GET https://www.indiafreestuff.in/pages/getdeals
//
// Card shape (verified from the live response):
//   <div class="col-xs-3 product-outer 1">    <-- note trailing class token
//     <div class="product-item">
//       <div class="product-img"><img src="IMG"></div>
//       <a class="item-title" href="DETAIL_URL">TITLE</a>
//       <div class="price-wrap">
//         <div class="old-price"><p><i></i> 12900 </p></div>
//         <div class="new-price"><p><i></i> 9900 </p></div>
//       </div>
//       <!-- Some cards also contain product-footer with a Shop Now button -->
//       <!--   <a class="btn btn-shopnow ripplelink" href="https://www.indiafreestuff.in/?rto=XXX">Shop Now</a> -->
//     </div>
//   </div>
//
// When the card includes Shop Now (?rto=XXX) we chase that redirect to the
// final Amazon URL. When it doesn't (e.g. pre-book / Super Deal layouts),
// we fall back to fetching the detail page and grabbing the first amazon
// anchor there.

var IndiaFreeStuff = (function () {
  var NAME = 'indiafreestuff';
  var ENDPOINT = 'https://www.indiafreestuff.in/pages/getdeals';
  // Each card requires a Browserless residential-proxy session (~20s + quota
  // cost), so cap per-cycle work. The 15-min trigger naturally fills the
  // sheet across cycles as new deals appear on the listing.
  var MAX_CARDS = 8;

  function fetch() {
    // The site 403s Apps Script's IP range; go via the Cloudflare Worker proxy.
    var html = fetchViaProxy(ENDPOINT);
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

  // Match <div class="... product-outer ..."> regardless of additional trailing classes.
  function splitCards(html) {
    var positions = [];
    var re = /<div\b[^>]*class="[^"]*\bproduct-outer\b[^"]*"[^>]*>/gi;
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
    // Find the <a class="...item-title..."> anchor and extract href + inner text
    // regardless of attribute order.
    var titleAnchorM = /<a\b[^>]*\bclass="[^"]*\bitem-title\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleAnchorM) return null;
    var titleHrefM = /\bhref="([^"]+)"/i.exec(titleAnchorM[0]);
    if (!titleHrefM) return null;
    var detailUrl = titleHrefM[1];
    var title = stripTags(titleAnchorM[1]);

    // Image may live inside <div class="product-img"> or an anchor with that class.
    var imgM =
      /<(?:a|div)[^>]*class="[^"]*\bproduct-img\b[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(block) ||
      /<img[^>]+src="([^"]+)"[^>]*class="[^"]*\blazy\b[^"]*"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var newM = /<div[^>]*class="[^"]*\bnew-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var oldM = /<div[^>]*class="[^"]*\bold-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = newM ? parsePrice(stripTags(newM[1])) : null;
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    // Find the rto Shop Now URL from the card (attribute-order-agnostic).
    var shopAnchorM = /<a\b[^>]*\bclass="[^"]*\bbtn-shopnow\b[^"]*"[^>]*>/i.exec(block);
    var rtoUrl = null;
    if (shopAnchorM) {
      var hrefM = /\bhref="([^"]+)"/i.exec(shopAnchorM[0]);
      if (hrefM) rtoUrl = hrefM[1];
    }
    // Resolve rto → retailer URL via a real headless browser (browserless.io).
    // The rto endpoint is session-bound and JS-driven, so HTTP-only fetchers
    // (Apps Script, plain Cloudflare Worker) can't follow it. browserless
    // opens it in a real Chromium and reports the URL the page lands on.
    var buyLink = null;
    if (rtoUrl) {
      var resolved = browserlessResolveUrl(rtoUrl);
      // Only accept resolved URLs that exit indiafreestuff to a retailer.
      if (resolved && !/^https?:\/\/(?:www\.)?indiafreestuff\.in/i.test(resolved)) {
        buyLink = resolved;
      }
    }

    // The card also contains a small brand logo anchor pointing at
    //   https://www.indiafreestuff.in/stores/<merchant>
    // Use that to tag the merchant column.
    var merchant = null;
    var brandM = /<a[^>]+href="https?:\/\/(?:www\.)?indiafreestuff\.in\/stores\/([a-z0-9_-]+)"/i.exec(block);
    if (brandM) merchant = brandM[1].toLowerCase();

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: detailUrl,
      merchant: merchant,
      buyLink: buyLink,
      id: sha1Short(detailUrl + '|' + title)
    };
  }

  return { name: NAME, fetch: fetch };
})();

// Quick test of the new session-aware resolver. Replace the rto URL with one
// from your live sheet (right-click an indiafreestuff Source Link row → open
// → right-click Shop Now → copy link).
function _testRtoResolveSession() {
  var rto = 'https://www.indiafreestuff.in/?rto=Mjg2ODk2NTI5Nw==';
  console.log('Input : ' + rto);
  console.log('Output: ' + proxyResolveSessionUrl(rto));
}

function _testIndiaFreeStuff() {
  console.log(JSON.stringify(IndiaFreeStuff.fetch().slice(0, 3), null, 2));
}

function _debugIndiaFreeStuff() {
  try {
    var html = fetchViaProxy('https://www.indiafreestuff.in/pages/getdeals');
    console.log('OK length=' + html.length);
    console.log('product-outer: ' + (html.match(/product-outer/g) || []).length);
    console.log('item-title: ' + (html.match(/item-title/g) || []).length);
    console.log('btn-shopnow: ' + (html.match(/btn-shopnow/g) || []).length);
    console.log('First 400 chars:\n' + html.substring(0, 400));
  } catch (e) {
    console.log('FAILED: ' + e);
  }
}
