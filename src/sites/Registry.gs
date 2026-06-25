// Site registry. Order here determines per-cycle scrape order; within a single
// cycle, newly-discovered deals are pinned to the top of the sheet in the
// reverse order they're found (so the last new deal of the cycle is row 2).
function getSites() {
  // PriceHistory disabled — Cloudflare Managed Challenge blocks all proxies.
  // IndiaFreeStuff disabled — rto links require Browserless to resolve,
  // and free Browserless quota gets exhausted in <1 day at 30-min poll.
  // PriceBefore and BigTricks cover Amazon deals for free.
  return [BigTricks, PriceBefore];
}
