// Google Sheets writer. Renders the current top deals into the `Deals` worksheet
// in a single batched setValues call.

var HEADERS = [
  'Rank', 'Source', 'Merchant', 'Title', 'Current Price', 'Original Price',
  'Image', 'Buy Link', 'Source Link'
];

function getSheet() {
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_SHEET_ID);
  if (!id) {
    throw new Error(
      'Script Property SHEET_ID is not set. Open the Apps Script editor → ' +
      'Project Settings → Script Properties → add SHEET_ID = <your Google Sheet id>.'
    );
  }
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  ensureHeader(sheet);
  return sheet;
}

function ensureHeader(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (firstRow[i] !== HEADERS[i]) { needs = true; break; }
  }
  if (needs) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(4, 320); // Title (now column D after adding Merchant)
    sheet.setColumnWidth(7, 120); // Image (now column G)
    sheet.setRowHeights(2, CONFIG.MAX_ROWS, 90);
  }
}

function writeTopDeals(deals) {
  var sheet = getSheet();
  var rows = [];
  for (var i = 0; i < CONFIG.MAX_ROWS; i++) {
    var d = deals[i];
    if (!d) {
      rows.push(['', '', '', '', '', '', '', '', '']);
      continue;
    }
    var merchant = d.merchant || '';
    var buyLabel = merchant === 'amazon' ? 'Open on Amazon'
                  : merchant === 'flipkart' ? 'Open on Flipkart'
                  : merchant ? 'Open on ' + merchant
                  : 'Open';
    var buyLink = d.buyLink || d.amazonLink || null;  // tolerate legacy field name
    rows.push([
      i + 1,
      d.source || '',
      merchant,
      d.title || '',
      d.currentPrice == null ? '' : d.currentPrice,
      d.originalPrice == null ? '' : d.originalPrice,
      d.imageUrl ? '=IMAGE("' + escapeFormula(d.imageUrl) + '")' : '',
      buyLink ? '=HYPERLINK("' + escapeFormula(buyLink) + '","' + buyLabel + '")' : '',
      d.sourceLink || ''
    ]);
  }
  sheet.getRange(2, 1, CONFIG.MAX_ROWS, HEADERS.length).setValues(rows);
}

function escapeFormula(s) {
  return String(s).replace(/"/g, '""');
}
