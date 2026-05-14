# Scraper-EK — Deal Tracker on Google Apps Script

Polls four Indian deal-aggregator sites every 15 minutes and pushes the latest
deals into a Google Sheet (cap 50 rows, newest deal pinned to row 1).

**Sources**

- https://www.indiafreestuff.in/
- https://www.bigtricks.in/
- https://www.pricebefore.com/price-drops/?price-drop=todaysDeals
- https://price-history.in/amazon-price-tracker

**Sheet columns**: Rank · Source · Title · Current Price · Original Price ·
Image (rendered inline) · Amazon Link · Source Link.

---

## One-time setup

### 1. Create the Google Sheet

1. Go to https://sheets.new and create a blank spreadsheet (any name).
2. Copy its **ID** from the URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

### 2. Create the Apps Script project

1. Open https://script.google.com → **New project**.
2. Project Settings (gear icon) → copy the **Script ID**.
3. Project Settings → **Script properties** → **Add script property**:
   - Property: `SHEET_ID`
   - Value: `<the sheet id from step 1>`

### 3. Push the code from this repo using `clasp`

```bash
npm install -g @google/clasp
clasp login                       # opens a browser, authenticates your Google account
clasp clone <SCRIPT_ID> --rootDir ./
# OR if you already initialised:
echo '{"scriptId":"<SCRIPT_ID>","rootDir":"./"}' > .clasp.json
clasp push -f
```

`clasp` picks up `appsscript.json` and every `.gs` under `src/`.

### 4. Authorise and install the trigger

1. Refresh the Apps Script editor — you should see `Main.gs`, `Config.gs`, etc.
2. Select the function `setup` in the toolbar and click **Run**.
3. Google prompts for OAuth consent — approve. Scopes requested:
   - Spreadsheets (write deals)
   - External requests (scrape sites)
   - Script app (manage triggers)
4. Open **Triggers** (clock icon in the left rail) — you should see one
   time-driven trigger calling `runScrape` every 15 minutes.

### 5. Verify

- In the editor, run `runScrape` manually once. Watch **Executions** for logs
  like `indiafreestuff: 12 deals returned`.
- Open the Google Sheet — rows 2..N should populate, images rendered inline,
  the Amazon Link column should be clickable.
- Run `runScrape` again immediately — `No new deals this cycle.` appears in
  logs and the sheet does not change.
- To simulate a fresh start, run `resetState` (clears `seenIds` and
  `topDeals` in Script Properties), then `runScrape`.

---

## How it works

- **`Main.gs#runScrape`** — invoked by the trigger. Iterates registered
  scrapers, dedups deals against `seenIds` in Script Properties, prepends any
  new deals to the in-memory top list, and rewrites rows 2..51 in a single
  `setValues` call.
- **`src/sites/*.gs`** — one scraper per source. Each exposes a `fetch()` that
  returns an array of `Deal` objects newest-first.
- **`Amazon.gs#resolveAmazonLink`** — chases redirects manually (Apps Script
  hides the final URL when `followRedirects:true`) and normalises to
  `https://www.amazon.in/dp/<ASIN>` when an ASIN is in the path.
- **`State.gs`** — persists `seenIds` (FIFO-trimmed to 2000) and the current
  top 50 across runs via `PropertiesService.getScriptProperties()`.

### Adjusting the cap or interval

Edit `src/Config.gs`:

```js
POLL_MINUTES: 15,   // change → re-run setup() to reinstall the trigger
MAX_ROWS: 50,       // larger sheet window
```

After changing `POLL_MINUTES`, run `setup()` again (it calls `teardown()` first).

---

## Limitations

- **PriceBefore** and **Price-History** may render their deal lists with
  JavaScript. The scrapers try `__NEXT_DATA__` JSON and then a regex sweep of
  the raw HTML; if both come up empty, they log a warning and return `[]`.
  Apps Script cannot run a headless browser. If a site is consistently empty:
  1. Open the page in Chrome → DevTools → **Network** → reload → look for an
     XHR/fetch returning JSON with deal data.
  2. Replace the `fetch()` body in that site's `.gs` to call the JSON endpoint
     directly via `fetchJson(url)`.
- Selectors for IndiaFreeStuff and BigTricks were written against the common
  WordPress `<article>` / `entry-title` markup. If a theme update changes
  those classes, adjust the regexes in `extractPosts` / `findPrices`.
- 6-minute execution cap per trigger run. Each scrape currently does
  one listing fetch + up to ~15 detail fetches per site + redirect resolution.
  If you raise `MAX_POSTS_PER_RUN` in the site files, watch execution time in
  the Executions panel.

---

## Branch

All development happens on `claude/build-price-tracker-scraper-Pru7z`.
