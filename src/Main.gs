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
      for (var d = 0; d < deals.length; d++) {
        var deal = deals[d];
        if (!deal || !deal.id) continue;
        if (!seenSet[deal.id]) {
          seenSet[deal.id] = true;
          state.seenIds.push(deal.id);
          newDeals.push(deal);
        }
      }
    }

    if (newDeals.length) {
      // Most recently discovered new deal lands at row 1.
      newDeals.reverse();
      state.topDeals = newDeals.concat(state.topDeals).slice(0, CONFIG.MAX_ROWS);
      writeTopDeals(state.topDeals);
      console.log('Pushed ' + newDeals.length + ' new deal(s) to the sheet.');
    } else if (state.topDeals.length === 0) {
      // First-ever run with nothing seen — still draw header & blank rows.
      writeTopDeals([]);
    } else {
      console.log('No new deals this cycle.');
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
  // Touch the sheet so the user sees the header immediately.
  writeTopDeals([]);
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
