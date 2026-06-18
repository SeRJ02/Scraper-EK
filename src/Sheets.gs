// Google Sheets writer.
//
// Column layout (HEADERS order):
//   A Title | B Description1 | C Description2 | D Description |
//   E logo  | F Image        | G ButtonText   | H Link        | I CopyLink

var HEADERS = [
  'Title', 'Description1', 'Description2', 'Description',
  'logo', 'Image', 'ButtonText', 'Link', 'CopyLink'
];

var MERCHANT_COMMISSION = {
  amazon:   'Upto 10.2% Profit',
  flipkart: 'Upto 6.4% Profit',
  myntra:   'Upto 8% Profit',
  ajio:     'Upto 10% Profit'
};

var MERCHANT_LOGO = {
  amazon:   'https://asset21.ckassets.com/resources/image/stores/amazon-store-live-1-1777975646.png',
  flipkart: 'https://asset21.ckassets.com/resources/image/stores/flipkart-direct-6-1770728207.png',
  ajio:     'https://asset21.ckassets.com/resources/image/stores/ajio-store-1606812055.png',
  myntra:   'https://asset21.ckassets.com/resources/image/stores/myntra-new-t-1777980142.png'
};

var BUTTON_TEXT_CONST = 'Convert Link';
var BUTTON_LINK_CONST = 'https://earnkaro.com/create-earn-link';

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
    sheet.setColumnWidth(1, 320); // Title
    sheet.setColumnWidth(6, 120); // Image
  }
}

// Build a single sheet row array from a deal object.
function buildDealRow(d) {
  var merchant = (d.merchant || '').toLowerCase();
  return [
    d.title || '',
    d.originalPrice == null ? '' : '₹' + d.originalPrice,
    d.currentPrice  == null ? '' : '₹' + d.currentPrice,
    MERCHANT_COMMISSION[merchant] || '',
    MERCHANT_LOGO[merchant] || '',
    d.imageUrl ? '=IMAGE("' + escapeFormula(d.imageUrl) + '")' : '',
    BUTTON_TEXT_CONST,
    BUTTON_LINK_CONST,
    d.buyLink || d.amazonLink || ''
  ];
}

// Insert newDeals above any existing data (row 2), pushing older rows down.
// Called only when newDeals.length > 0.
function writeTopDeals(newDeals) {
  if (!newDeals || newDeals.length === 0) return;
  var sheet = getSheet();
  sheet.insertRowsBefore(2, newDeals.length);
  var rows = [];
  for (var i = 0; i < newDeals.length; i++) rows.push(buildDealRow(newDeals[i]));
  sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

// Always refresh rows 3-4 with the top-2 Myntra deals.
// insertedAbove = number of rows just inserted by writeTopDeals (0 if no new deals).
// The old Myntra rows (previously at 3-4) shifted down by insertedAbove; we delete
// them before inserting fresh ones so the sheet doesn't grow unboundedly.
function writeMyntraDeals(deals, insertedAbove) {
  if (!deals || deals.length === 0) return;
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();

  // Delete the old Myntra rows that shifted down (only after first-ever Myntra write).
  // oldMyntraStart = 3 + insertedAbove; we delete up to 2 rows there.
  var oldStart = 3 + insertedAbove;
  if (lastRow >= oldStart) {
    var toDelete = Math.min(2, lastRow - oldStart + 1);
    sheet.deleteRows(oldStart, toDelete);
  }

  // Insert 2 fresh rows at position 3.
  sheet.insertRowsBefore(3, 2);
  var rows = [];
  for (var i = 0; i < 2; i++) {
    rows.push(deals[i] ? buildDealRow(deals[i]) : ['', '', '', '', '', '', '', '', '']);
  }
  sheet.getRange(3, 1, 2, HEADERS.length).setValues(rows);
}

function escapeFormula(s) {
  return String(s).replace(/"/g, '""');
}
