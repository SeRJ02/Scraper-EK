// Global configuration constants.
var CONFIG = {
  POLL_MINUTES: 30,
  MAX_ROWS: 50,
  SHEET_NAME: 'Deals',
  SEEN_CAP: 2000,
  REQUEST_TIMEOUT_MS: 20000,
  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  STATE_KEY_SEEN: 'seenIds',
  STATE_KEY_TOP: 'topDeals',
  PROP_SHEET_ID: 'SHEET_ID',
  PROP_WORKER_URL: 'PROXY_WORKER_URL',         // e.g. https://my-proxy.workers.dev
  PROP_WORKER_TOKEN: 'PROXY_WORKER_TOKEN',     // shared secret matching the Worker
  PROP_AFFILIATE_TOKEN: 'AFFILIATE_API_TOKEN', // Ekaro / Affiliators bearer token
  PROP_BROWSERLESS_TOKEN: 'BROWSERLESS_API_TOKEN', // browserless.io API token
  PROP_FIRECRAWL_TOKEN: 'FIRECRAWL_API_TOKEN'      // firecrawl.dev API token
};
