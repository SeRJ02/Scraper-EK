// Entry point invoked by the time-driven trigger every CONFIG.POLL_MINUTES.
function runScrape() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Another runScrape is in progress; skipping this tick.');
    return;
  }
  try {
    var state = loadState();
    var seenSet = {};
    for (var i = 0; i < state.seenIds.length; i++) seenSet[state.seenIds[i]] = true;

    var newDeals = [];
    var sites = getSites();
    for (var s = 0; s < sites.length; s++) {
      var site = sites[s];
      var deals;
      try {
        deals = site.fetch() || [];
        console.log(site.name + ': ' + deals.length + ' deals returned');
      } catch (e) {
        console.error(site.name + ' fetch threw: ' + e);
        continue;
      }

      // Filter to unseen deals first, before any expensive resolution.
      var unseen = [];
      for (var d = 0; d < deals.length; d++) {
        var deal = deals[d];
        if (!deal || !deal.id) continue;
        if (seenSet[deal.id]) continue;
        // Mark seen now so retries don't re-process the same deal next cycle.
        seenSet[deal.id] = true;
        state.seenIds.push(deal.id);
        unseen.push(deal);
      }

      // Batch-resolve any pending rto links (IndiaFreeStuff Flipkart cards) —
      // only for unseen deals. Browserless only called for genuinely new deals.
      var pendingUrls = [];
      for (var u = 0; u < unseen.length; u++) {
        if (unseen[u]._pendingRto) pendingUrls.push(unseen[u]._pendingRto);
      }
      var resolved = {};
      if (pendingUrls.length > 0) {
        console.log(site.name + ': resolving ' + pendingUrls.length + ' new rto URL(s) via worker');
        for (var p = 0; p < pendingUrls.length; p++) {
          try { resolved[pendingUrls[p]] = proxyResolveSessionUrl(pendingUrls[p]); }
          catch (e) { console.warn(site.name + ' resolve threw for ' + pendingUrls[p] + ': ' + e); }
        }
      }

      for (var u = 0; u < unseen.length; u++) {
        var deal = unseen[u];

        // Resolve IndiaFreeStuff rto links.
        if (deal._pendingRto) {
          var url = resolved[deal._pendingRto];
          if (url && !/^https?:\/\/(?:www\.)?indiafreestuff\.in/i.test(url)) {
            deal.buyLink = url;
          }
          delete deal._pendingRto;
        }

        // Resolve PriceBefore detail pages (direct HTTP, no Browserless).
        if (deal._pendingDetail && site.resolveDetail) {
          var r = site.resolveDetail(deal._pendingDetail);
          if (r) { deal.buyLink = r.buyLink; deal.merchant = r.merchant; }
          delete deal._pendingDetail;
        }

        if (!deal.buyLink) {
          console.log('Drop (no buyLink): ' + (deal.title || deal.id));
          continue;
        }
        if (deal.currentPrice != null && deal.currentPrice > 75000) {
          console.log('Drop (price > ₹75000): ' + (deal.title || deal.id));
          continue;
        }
        var affLink = convertAffiliateLink(deal.buyLink);
        if (!affLink) {
          console.log('Drop (affiliate convert failed): ' + (deal.title || deal.id));
          continue;
        }
        deal.buyLink = affLink;
        newDeals.push(deal);
      }
    }

    var insertedCount = 0;
    if (newDeals.length) {
      // Most recently discovered new deal lands at row 2; insert above existing rows.
      newDeals.reverse();
      state.topDeals = newDeals.concat(state.topDeals).slice(0, CONFIG.MAX_ROWS);
      writeTopDeals(newDeals);
      insertedCount = newDeals.length;
      console.log('Pushed ' + newDeals.length + ' new deal(s) to the sheet.');
    } else if (state.topDeals.length === 0) {
      // First-ever run with nothing seen — ensure header exists.
      getSheet();
    } else {
      console.log('No new deals this cycle.');
    }

    // Always refresh rows 3-4 with fresh top-2 Myntra deals (no seenIds dedup).
    var myntraAdded = 0;
    try {
      var myntraDeals = OffertagMyntra.fetch();
      var myntraReady = _convertPinnedDeals(myntraDeals, 'Myntra');
      if (myntraReady.length > 0) {
        myntraAdded = writeMyntraDeals(myntraReady, insertedCount);
        console.log('Myntra: wrote ' + myntraReady.length + ' deal(s) to rows 3-4.');
      }
    } catch (e) {
      console.warn('Myntra scrape/write failed: ' + e);
    }

    // Always refresh rows 7-8 with fresh top-2 Ajio deals (no seenIds dedup).
    try {
      var ajioDeals = SmartprixAjio.fetch();
      var ajioReady = _convertPinnedDeals(ajioDeals, 'Ajio');
      if (ajioReady.length > 0) {
        writeAjioDeals(ajioReady, insertedCount + myntraAdded);
        console.log('Ajio: wrote ' + ajioReady.length + ' deal(s) to rows 7-8.');
      }
    } catch (e) {
      console.warn('Ajio scrape/write failed: ' + e);
    }

    saveState(state);
  } finally {
    lock.releaseLock();
  }
}

// Run once from the editor to install the 15-minute trigger.
function setup() {
  teardown();
  ScriptApp.newTrigger('runScrape')
    .timeBased()
    .everyMinutes(CONFIG.POLL_MINUTES)
    .create();
  console.log('Installed runScrape trigger every ' + CONFIG.POLL_MINUTES + ' minutes.');
  // Make sure the header exists without disturbing any data already in the sheet.
  getSheet();
}

// Remove any existing runScrape triggers.
function teardown() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runScrape') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  if (removed) console.log('Removed ' + removed + ' existing trigger(s).');
}

// Wipe persistent state so the next runScrape repopulates the sheet from scratch.
function resetState() {
  clearState();
  console.log('State cleared.');
}

// Convert buyLinks for pinned-slot deals (Myntra/Ajio) via the affiliate API.
// Drops any deal whose conversion fails.
function _convertPinnedDeals(deals, label) {
  var out = [];
  for (var i = 0; i < deals.length; i++) {
    var d = deals[i];
    if (!d.buyLink) continue;
    var link = convertAffiliateLink(d.buyLink);
    if (!link) { console.log(label + ' drop (affiliate failed): ' + d.title); continue; }
    d.buyLink = link;
    out.push(d);
  }
  return out;
}
