// Scraper for https://www.bigtricks.in/
//
// DOM (verified live):
//   <article data-post-type="deal">
//     <div class="bt-card-inner">
//       <a class="bt-card-thumb" href="https://amzn.to/XXXXXXX" target="_blank">
//         <img data-src="https://m.media-amazon.com/images/I/....jpg" src="...">
//       </a>
//       <div class="p-5 sm:p-6 ...">
//         <h2>
//           <a href="https://www.bigtricks.in/deal/SLUG/">
//             <span aria-hidden="true"></span>
//             TITLE
//           </a>
//         </h2>
//         <div class="flex items-baseline gap-3 mb-3">
//           <span class="text-2xl ... text-primary-600">₹124</span>
//           <span class="... line-through ...">₹365</span>
//         </div>
//         ...
//       </div>
//     </div>
//   </article>

var BigTricks = (function () {
  var NAME = 'bigtricks';
  var BASE = 'https://www.bigtricks.in/';
  var MAX_CARDS = 25;

  function fetch() {
    var html = fetchHtml(BASE);
    var cards = extractArticles(html).slice(0, MAX_CARDS);
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

  function extractArticles(html) {
    var out = [];
    var re = /<article\b[^>]*data-post-type="deal"[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
  }

  function parseCard(block) {
    // Detail-page link + title come from the h2 anchor.
    var titleM = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(block);
    if (!titleM) return null;
    var detailUrl = titleM[1];
    // Strip the absolute-positioned overlay span and any other inline tags.
    var title = stripTags(titleM[2]);

    // Amazon shortlink — usually on the thumb anchor, also repeated on the "Shop" button.
    var amazonOutboundM =
      /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i.exec(block) ||
      /href="(https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"]+)"/i.exec(block);
    var outbound = amazonOutboundM ? amazonOutboundM[1] : null;
    var amazonLink = outbound ? resolveAmazonLink(outbound) : null;

    // Image: prefer data-src (lazy-load real URL) over src (often a placeholder).
    var imgTagM = /<img\b[^>]*>/i.exec(block);
    var image = '';
    if (imgTagM) {
      image = attr(imgTagM[0], 'data-src') ||
              attr(imgTagM[0], 'data-lazy-src') ||
              attr(imgTagM[0], 'src') ||
              '';
    }

    // Prices: line-through span = MRP; the other ₹ number nearby = current.
    var mrpM = /<span[^>]*class="[^"]*\bline-through\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    var original = mrpM ? parsePrice(stripTags(mrpM[1])) : null;

    var current = null;
    // First ₹-prefixed number that isn't inside the line-through span.
    var withoutMrp = mrpM ? block.replace(mrpM[0], '') : block;
    var curM = /(?:₹|Rs\.?\s*|INR\s*)([\d,]+(?:\.\d+)?)/i.exec(withoutMrp);
    if (curM) current = parsePrice(curM[1]);

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

function _testBigTricks() {
  console.log(JSON.stringify(BigTricks.fetch().slice(0, 3), null, 2));
}
