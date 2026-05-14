// Scraper for https://www.pricebefore.com/price-drops/
//
// DOM (verified live):
//   <ul class="product-list js-product-list">
//     <li class="item">
//       <div class="unit">
//         <div class="body">
//           <div class="col-left">
//             <a class="link" href="/SLUG-pXXXXXX.html" target="_blank">
//               <img src="https://m.media-amazon.com/images/I/...jpg" class="amazon-img-size">
//             </a>
//           </div>
//           <div class="col-right">
//             <div class="title"><b><a class="link" href="/SLUG-pXXXXXX.html" title="...">TITLE</a></b></div>
//             <div class="ratings">...</div>
//             <div class="price">₹CURRENT</div>
//             <div class="price-overview lowest">
//               <div class="item"><span class="label lowest"></span>₹LOWEST</div>
//               <div class="item"><span class="label highest"></span>₹HIGHEST</div>
//             </div>
//             <div class="btn-wrap">
//               <a href="/SLUG-pXXXXXX.html">View Price History</a>
//             </div>
//           </div>
//         </div>
//       </div>
//     </li>
//   </ul>
//
// The card has NO direct Amazon link — only a link to the pricebefore detail
// page, which in turn contains the outbound Amazon URL. So we fetch each
// detail page once to extract the amazon link. Capped at MAX_CARDS to stay
// within the 6-minute Apps Script execution budget.

var PriceBefore = (function () {
  var NAME = 'pricebefore';
  var BASE = 'https://www.pricebefore.com';
  var LIST_URL = BASE + '/price-drops/';
  var MAX_CARDS = 15;

  function fetch() {
    var html = fetchHtml(LIST_URL);
    var items = extractItems(html).slice(0, MAX_CARDS);
    var deals = [];
    for (var i = 0; i < items.length; i++) {
      try {
        var d = buildDeal(items[i]);
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
    // Top-level cards are <li class="item">; nested .item's are <div>, not <li>.
    var re = /<li\b[^>]*class="[^"]*\bitem\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var m;
    while ((m = re.exec(scope)) !== null) out.push(m[1]);
    return out;
  }

  function buildDeal(block) {
    var titleBlock = /<div[^>]*class="title"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    if (!titleBlock) return null;
    var anchorM = /<a[^>]+href="([^"]+)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i.exec(titleBlock[1]);
    if (!anchorM) return null;
    var detailUrl = absolute(anchorM[1]);
    var title = stripTags(anchorM[2] || anchorM[3]);

    var imgM = /<img[^>]+src="([^"]+)"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    // Current price — div whose class is exactly "price" (not "price-overview").
    var priceM = /<div[^>]*class="price"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = priceM ? parsePrice(stripTags(priceM[1])) : null;

    // Highest historical price = the text after <span class="label highest"></span>.
    var highM = /<span[^>]*class="[^"]*\bhighest\b[^"]*"[^>]*>[\s\S]*?<\/span>([\s\S]*?)<\/div>/i.exec(block);
    var original = highM ? parsePrice(stripTags(highM[1])) : null;

    // Amazon link lives on the pricebefore detail page — fetch and extract.
    var amazonLink = null;
    try {
      var detail = fetchHtml(detailUrl);
      var amzM =
        /href="(https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"]+)"/i.exec(detail) ||
        /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i.exec(detail);
      if (amzM) amazonLink = resolveAmazonLink(amzM[1]);
    } catch (e) {
      console.warn(NAME + ' detail fetch failed for ' + detailUrl + ': ' + e);
    }

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: detailUrl,
      amazonLink: amazonLink,
      id: sha1Short(amazonLink || detailUrl || title)
    };
  }

  function absolute(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return BASE + (url.charAt(0) === '/' ? url : '/' + url);
  }

  return { name: NAME, fetch: fetch };
})();

function _testPriceBefore() {
  console.log(JSON.stringify(PriceBefore.fetch().slice(0, 3), null, 2));
}
