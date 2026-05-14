// Scraper for https://www.indiafreestuff.in/
// WordPress-style listing of deal posts. Each post links to a detail page
// that contains the outbound Amazon/Flipkart link and prices.
//
// Selectors here target the common .post / .entry-* WordPress markup. If
// IndiaFreeStuff's theme uses different class names, adjust LISTING_POST_RE
// and the detail-page price/link patterns below.

var IndiaFreeStuff = (function () {
  var NAME = 'indiafreestuff';
  var BASE = 'https://www.indiafreestuff.in/';
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

  // Pull <article>...</article> blocks from the listing HTML.
  function extractPosts(html) {
    var out = [];
    var re = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var block = m[1];
      var linkMatch = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<\/a>/i.exec(block);
      var titleMatch =
        /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
        /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      var imgMatch = /<img[^>]+src="([^"]+)"/i.exec(block);
      if (!linkMatch || !titleMatch) continue;
      out.push({
        url: linkMatch[1],
        title: stripTags(titleMatch[1]),
        image: imgMatch ? imgMatch[1] : ''
      });
    }
    return out;
  }

  function buildDeal(post) {
    var detail;
    try { detail = fetchHtml(post.url); }
    catch (e) { return null; }

    // Outbound link: anchors pointing to amazon / amzn / the site's /go/ redirector.
    var outbound = findOutboundLink(detail);
    var amazonLink = outbound ? resolveAmazonLink(outbound) : null;

    var prices = findPrices(detail);
    var image = post.image || findOgImage(detail);

    var keyForId = amazonLink || outbound || post.url || post.title;
    return {
      source: NAME,
      title: post.title,
      currentPrice: prices.current,
      originalPrice: prices.original,
      imageUrl: image,
      sourceLink: post.url,
      amazonLink: amazonLink,
      id: sha1Short(keyForId)
    };
  }

  function findOutboundLink(html) {
    var patterns = [
      /href="(https?:\/\/[^"]*amazon\.[a-z.]+\/[^"]+)"/i,
      /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?indiafreestuff\.in\/go\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?indiafreestuff\.in\/out\/[^"]+)"/i,
      /href="(https?:\/\/(?:www\.)?flipkart\.com\/[^"]+)"/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m) return m[1];
    }
    return null;
  }

  function findPrices(html) {
    // Heuristics: look for ₹/Rs patterns. First number = current; if a higher
    // number appears nearby labelled "MRP" / strikethrough, treat as original.
    var current = null, original = null;
    var mrp = /(?:MRP|M\.R\.P|Original Price|Regular Price)[^0-9₹]{0,20}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i.exec(html);
    if (mrp) original = parsePrice(mrp[1]);
    var deal = /(?:Deal Price|Offer Price|Now|Price)[^0-9₹]{0,20}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i.exec(html);
    if (deal) current = parsePrice(deal[1]);
    if (current == null) {
      var firstRupee = /(?:₹|Rs\.?\s*|INR\s*)([\d,]+(?:\.\d+)?)/i.exec(html);
      if (firstRupee) current = parsePrice(firstRupee[1]);
    }
    return { current: current, original: original };
  }

  function findOgImage(html) {
    var m = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
    return m ? m[1] : '';
  }

  return { name: NAME, fetch: fetch };
})();

function _testIndiaFreeStuff() {
  var ds = IndiaFreeStuff.fetch().slice(0, 3);
  console.log(JSON.stringify(ds, null, 2));
}
