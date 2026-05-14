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
  var MAX_CARDS = 25;
  var MAX_DETAIL_FETCHES = 10;  // cap detail-page fetches to stay under the 6-min budget

  function fetch() {
    var html = fetchHtml(ENDPOINT, xhrHeaders());
    var cards = splitCards(html).slice(0, MAX_CARDS);
    var deals = [];
    var detailFetched = 0;
    for (var i = 0; i < cards.length; i++) {
      try {
        var d = parseCard(cards[i], detailFetched < MAX_DETAIL_FETCHES);
        if (d) {
          if (d._fetchedDetail) detailFetched++;
          delete d._fetchedDetail;
          deals.push(d);
        }
      } catch (e) {
        console.warn(NAME + ' card ' + i + ' failed: ' + e);
      }
    }
    return deals;
  }

  // Headers matching what the live site sends for this XHR (CORS, same-origin).
  function xhrHeaders() {
    return {
      'Referer': 'https://www.indiafreestuff.in/',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
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

  function parseCard(block, mayFetchDetail) {
    var titleM = /<a[^>]*class="[^"]*\bitem-title\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleM) return null;
    var detailUrl = titleM[1];
    var title = stripTags(titleM[2]);

    // Image may live inside <div class="product-img"> or an anchor with that class.
    var imgM =
      /<(?:a|div)[^>]*class="[^"]*\bproduct-img\b[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(block) ||
      /<img[^>]+src="([^"]+)"[^>]*class="[^"]*\blazy\b[^"]*"/i.exec(block);
    var image = imgM ? imgM[1] : '';

    var newM = /<div[^>]*class="[^"]*\bnew-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var oldM = /<div[^>]*class="[^"]*\bold-price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var current = newM ? parsePrice(stripTags(newM[1])) : null;
    var original = oldM ? parsePrice(stripTags(oldM[1])) : null;

    var shopM = /<a[^>]*class="[^"]*\bbtn-shopnow\b[^"]*"[^>]+href="([^"]+)"/i.exec(block);
    var outbound = shopM ? shopM[1] : null;
    var amazonLink = null;
    var fetchedDetail = false;

    if (outbound) {
      amazonLink = resolveAmazonLink(outbound);
    } else if (mayFetchDetail) {
      // No Shop Now on the card — pull the amazon link from the detail page.
      try {
        var detail = fetchHtml(detailUrl, { 'Referer': 'https://www.indiafreestuff.in/' });
        fetchedDetail = true;
        var amzInDetailM =
          /href="(https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"]+)"/i.exec(detail) ||
          /href="(https?:\/\/amzn\.(?:to|in)\/[^"]+)"/i.exec(detail) ||
          /href="(https?:\/\/(?:www\.)?indiafreestuff\.in\/\?rto=[^"]+)"/i.exec(detail);
        if (amzInDetailM) {
          outbound = amzInDetailM[1];
          amazonLink = resolveAmazonLink(outbound);
        }
      } catch (e) {
        console.warn(NAME + ' detail fetch failed for ' + detailUrl + ': ' + e);
      }
    }

    return {
      source: NAME,
      title: title,
      currentPrice: current,
      originalPrice: original,
      imageUrl: image,
      sourceLink: detailUrl,
      amazonLink: amazonLink,
      id: sha1Short(amazonLink || outbound || detailUrl || title),
      _fetchedDetail: fetchedDetail
    };
  }

  return { name: NAME, fetch: fetch };
})();

function _testIndiaFreeStuff() {
  console.log(JSON.stringify(IndiaFreeStuff.fetch().slice(0, 3), null, 2));
}

function _debugIndiaFreeStuff() {
  var html = fetchHtml('https://www.indiafreestuff.in/pages/getdeals', {
    'Referer': 'https://www.indiafreestuff.in/',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  });
  console.log('Length: ' + html.length);
  console.log('product-outer: ' + (html.match(/product-outer/g) || []).length);
  console.log('item-title: ' + (html.match(/item-title/g) || []).length);
  console.log('btn-shopnow: ' + (html.match(/btn-shopnow/g) || []).length);
  console.log('First 400 chars:\n' + html.substring(0, 400));
}
