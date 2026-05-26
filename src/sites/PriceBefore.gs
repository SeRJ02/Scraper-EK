// Scraper for https://www.pricebefore.com/price-drops/
//
// Listing page (server-rendered, fetched via CF Worker proxy):
//   <ul class="product-list js-product-list">
//     <li class="item">
//       <div class="col-left">
//         <a class="link" href="/SLUG-pXXXXXX.html"><img src="IMG"></a>
//       </div>
//       <div class="col-right">
//         <div class="title"><b><a class="link" href="/SLUG-pXXXXXX.html" title="TITLE">...</a></b></div>
//         <div class="price"><span class="final lowest">₹CURRENT</span></div>
//         <span class="price-old">₹ORIGINAL</span>
//       </div>
//     </li>
//   </ul>
//
// Detail page contains direct Amazon/Flipkart URLs — no masking.
// Each detail page is fetched via the proxy (one call per new deal only,
// since Main.gs resolves after the seenIds filter).

var PriceBefore = (function () {
  var NAME = 'pricebefore';
  var BASE = 'https://www.pricebefore.com';
  var LIST_URL = BASE + '/price-drops/';
  var MAX_CARDS = 15;

  function fetch() {
    var html = fetchViaProxy(LIST_URL);
    var items = extractItems(html).slice(0, MAX_CARDS);
    var deals = [];
    for (var i = 0; i < items.length; i++) {
      try {
        var d = parseCard(items[i]);
        if (d) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    return deals;
  }

  function extractItems(html) {
    var listM = /<ul[^>]+class="[^"]*\bproduct-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(html);
    var scope = listM ? listM[1] : html;
    var out = [];
    var re = /<li\b[^>]*class="[^"]*\bitem\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var m;
    while ((m = re.exec(scope)) !== null) out.push(m[1]);
    return out;
  }

  function parseCard(block) {
    // Title + detail URL from the title anchor
    var titleBlock = /<div[^>]*class="title"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    if (!titleBlock) return null;
    var anchorM = /<a[^>]+href="([^"]+)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i.exec(titleBlock[1]);
    if (!anchorM) return null;
    var detailPath = anchorM[1];
    var detailUrl = /^https?:\/\//i.test(detailPath) ? detailPath : BASE + (detailPath.charAt(0) === '/' ? detailPath : '/' + detailPath);
    var title = stripTags(anchorM[2] || anchorM[3]);

    var imgM = /<img[^>]+src="([^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    // Current price from <div class="price">
    var priceM = /<div[^>]*class="price"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = priceM ? parsePrice(stripTags(priceM[1])) : null;

    // Original price from <span class="price-old">
    var oldM = /<span[^>]*class="[^"]*\bprice-old\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    // Detail page fetch is deferred — _pendingDetail signals Main.gs to fetch
    // it after the seenIds filter, so we only pay per new deal.
    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: detailUrl,
      merchant: null,
      buyLink: null,
      id: sha1Short(detailUrl + '|' + title),
      _pendingDetail: detailUrl
    };
  }

  // Called by Main.gs for each unseen deal that has _pendingDetail set.
  // Fetches the detail page and extracts the first Amazon or Flipkart link.
  function resolveDetail(detailUrl) {
    try {
      var html = fetchViaProxy(detailUrl);
      // Amazon
      var amzM = /href="(https?:\/\/(?:www\.)?amazon\.in\/[^"]+)"/i.exec(html) ||
                 /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i.exec(html);
      if (amzM) return { buyLink: decodeEntities(amzM[1]), merchant: 'amazon' };
      // Flipkart
      var fkM = /href="(https?:\/\/(?:www\.)?flipkart\.com\/[^"]+)"/i.exec(html);
      if (fkM) return { buyLink: decodeEntities(fkM[1]), merchant: 'flipkart' };
    } catch (e) {
      console.warn(NAME + ' detail fetch failed for ' + detailUrl + ': ' + e);
    }
    return null;
  }

  return { name: NAME, fetch: fetch, resolveDetail: resolveDetail };
})();

function _testPriceBefore() {
  console.log(JSON.stringify(PriceBefore.fetch().slice(0, 3), null, 2));
}

function _testPriceBeforeFull() {
  var deals = PriceBefore.fetch().slice(0, 2);
  for (var i = 0; i < deals.length; i++) {
    if (deals[i]._pendingDetail) {
      var r = PriceBefore.resolveDetail(deals[i]._pendingDetail);
      if (r) { deals[i].buyLink = r.buyLink; deals[i].merchant = r.merchant; }
      delete deals[i]._pendingDetail;
    }
  }
  console.log(JSON.stringify(deals, null, 2));
}
