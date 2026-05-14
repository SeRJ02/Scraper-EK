// Scraper for https://www.bigtricks.in/
// Same shape as IndiaFreeStuff — WordPress posts with an outbound deal link.

var BigTricks = (function () {
  var NAME = 'bigtricks';
  var BASE = 'https://www.bigtricks.in/';
  var MAX_POSTS_PER_RUN = 15;

  function fetch() {
    var html = fetchHtml(BASE);
    var posts = extractPosts(html).slice(0, MAX_POSTS_PER_RUN);
    var deals = [];
    for (var i = 0; i < posts.length; i++) {
      try {
        var d = buildDeal(posts[i]);
        if (d) deals.push(d);
      } catch (e) {
        console.warn(NAME + ' post failed: ' + e);
      }
    }
    return deals;
  }

  function extractPosts(html) {
    var out = [];
    var re = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var block = m[1];
      var titleMatch =
        /<h[12][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
        /<h[12][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!titleMatch) continue;
      var imgMatch = /<img[^>]+src="([^"]+)"/i.exec(block);
      out.push({
        url: titleMatch[1],
        title: stripTags(titleMatch[2]),
        image: imgMatch ? imgMatch[1] : ''
      });
    }
    return out;
  }

  function buildDeal(post) {
    var detail;
    try { detail = fetchHtml(post.url); }
    catch (e) { return null; }

    var outbound = findOutboundLink(detail);
    var amazonLink = outbound ? resolveAmazonLink(outbound) : null;
    var prices = findPrices(detail);
    var image = post.image || findOgImage(detail);

    return {
      source: NAME,
      title: post.title,
      currentPrice: prices.current,
      originalPrice: prices.original,
      imageUrl: image,
      sourceLink: post.url,
      amazonLink: amazonLink,
      id: sha1Short(amazonLink || outbound || post.url || post.title)
    };
  }

  function findOutboundLink(html) {
    var patterns = [
      /href="(https?:\/\/[^"]*amazon\.[a-z.]+\/[^"]+)"/i,
      /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?bigtricks\.in\/go\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?bigtricks\.in\/out\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?flipkart\.com\/[^"]+)"/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m) return m[1];
    }
    return null;
  }

  function findPrices(html) {
    var current = null, original = null;
    var mrp = /(?:MRP|M\.R\.P|Original Price|Regular Price)[^0-9₹]{0,20}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i.exec(html);
    if (mrp) original = parsePrice(mrp[1]);
    var deal = /(?:Deal Price|Offer Price|Now|Price)[^0-9₹]{0,20}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i.exec(html);
    if (deal) current = parsePrice(deal[1]);
    if (current == null) {
      var first = /(?:₹|Rs\.?\s*|INR\s*)([\d,]+(?:\.\d+)?)/i.exec(html);
      if (first) current = parsePrice(first[1]);
    }
    return { current: current, original: original };
  }

  function findOgImage(html) {
    var m = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
    return m ? m[1] : '';
  }

  return { name: NAME, fetch: fetch };
})();

function _testBigTricks() {
  console.log(JSON.stringify(BigTricks.fetch().slice(0, 3), null, 2));
}
