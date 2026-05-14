// Site registry. Order here determines per-cycle scrape order; within a single
// cycle, newly-discovered deals are pinned to the top of the sheet in the
// reverse order they're found (so the last new deal of the cycle is row 2).
function getSites() {
  return [IndiaFreeStuff, BigTricks, PriceBefore, PriceHistory];
}
