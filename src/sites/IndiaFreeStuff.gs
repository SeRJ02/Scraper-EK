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
// Buy-link strategy:
//   amazon  → rto URL passed directly to Ekaro (no Browserless needed)
//   others  → ALL non-Amazon rto URLs are resolved in ONE batched BrowserQL
//             call per fetch() invocation (one credit, not one-per-URL)

var IndiaFreeStuff = (function () {
  var NAME = 'indiafreestuff';
  var ENDPOINT = 'https://www.indiafreestuff.in/pages/getdeals';
  var MAX_CARDS = 20;

  function fetch() {
    var html = fetchViaProxy(ENDPOINT);
    var cards = splitCards(html).slice(0, MAX_CARDS);

    // First pass: parse cards without resolving non-Amazon rto links.
    var parsed = [];
    var rtoUrlsToResolve = [];
    for (var i = 0; i < cards.length; i++) {
      try {
        var d = parseCard(cards[i]);
        if (!d) continue;
        parsed.push(d);
        // Queue rto URLs that need Browserless resolution (non-Amazon).
        if (d._pendingRto) rtoUrlsToResolve.push(d._pendingRto);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }

    // Second pass: resolve all pending rto links in ONE batch BrowserQL call.
    var resolved = {};
    if (rtoUrlsToResolve.length > 0) {
      console.log(NAME + ': resolving ' + rtoUrlsToResolve.length +
        ' non-Amazon rto URLs in one batch');
      try {
        resolved = browserlessResolveUrls(rtoUrlsToResolve);
      } catch (e) {
        console.warn(NAME + ' batch resolve threw: ' + e);
      }
    }

    // Apply resolved URLs to deals.
    var deals = [];
    for (var j = 0; j < parsed.length; j++) {
      var deal = parsed[j];
      if (deal._pendingRto) {
        var url = resolved[deal._pendingRto];
        if (url && !/^https?:\/\/(?:www\.)?indiafreestuff\.in/i.test(url)) {
          deal.buyLink = url;
        }
        delete deal._pendingRto;
      }
      deals.push(deal);
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
    var titleAnchorM = /<a\b[^>]*\bclass="[^"]*\bitem-title\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleAnchorM) return null;
    var titleHrefM = /\bhref="([^"]+)"/i.exec(titleAnchorM[0]);
    if (!titleHrefM) return null;
    var detailUrl = titleHrefM[1];
    var title = stripTags(titleAnchorM[1]);

    var imgM =
      /<(?:a|div)[^>]*class="[^"]*\bproduct-img\b[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(block) ||
      /<img[^>]+src="([^"]+)"[^>]*class="[^"]*\blazy\b[^"]*"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var newM = /<div[^>]*class="[^"]*\bnew-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var oldM = /<div[^>]*class="[^"]*\bold-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = newM ? parsePrice(stripTags(newM[1])) : null;
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    // Find the rto Shop Now URL (attribute-order-agnostic).
    var shopAnchorM = /<a\b[^>]*\bclass="[^"]*\bbtn-shopnow\b[^"]*"[^>]*>/i.exec(block);
    var rtoUrl = null;
    if (shopAnchorM) {
      var hrefM = /\bhref="([^"]+)"/i.exec(shopAnchorM[0]);
      if (hrefM) rtoUrl = hrefM[1];
    }

    // Merchant from brand logo anchor: /stores/<merchant>
    var merchant = null;
    var brandM = /<a[^>]+href="https?:\/\/(?:www\.)?indiafreestuff\.in\/stores\/([a-z0-9_-]+)"/i.exec(block);
    if (brandM) merchant = brandM[1].toLowerCase();

    var buyLink = null;
    var pendingRto = null;

    if (rtoUrl) {
      if (merchant === 'amazon') {
        // Ekaro can convert Amazon rto URLs directly — no Browserless needed.
        buyLink = rtoUrl;
      } else {
        // Queue for batch Browserless resolution in fetch().
        pendingRto = rtoUrl;
      }
    }

    var deal = {
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
    if (pendingRto) deal._pendingRto = pendingRto;
    return deal;
  }

  return { name: NAME, fetch: fetch };
})();

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
