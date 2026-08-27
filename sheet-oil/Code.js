/***********************************************************************
 * K-MERCHANT CSV EXTRACTION AUTOMATION  (v2)
 * ---------------------------------------------------------------------
 * WHAT CHANGED FROM v1
 *  - Processes ALL branches (single-merchant subject filter removed).
 *  - MERCHANT_ID -> BC code + DATABASE via the `index` sheet (one lookup).
 *  - Unknown MERCHANT_IDs are imported (not lost) and FLAGGED in the report.
 *  - Adds derived columns to raw on import: BC / ค่าใช้จ่าย / DATABASE.
 *  - QUERY sheet is rebuilt by a MANUAL function (user-run), never auto.
 *  - Daily run uses a 7-day overlap window so a missed/late day is recovered.
 *  - LockService prevents two runs colliding and double-inserting.
 *  - IDs (MERCHANT_ID, TAX INVOICE NO) forced to TEXT to stop Sheets from
 *    mangling values like "060526E00022178" into scientific notation.
 *  - Dates parsed explicitly as DD/MM/YYYY and stored as real Dates
 *    (the bank uses DD/MM; relying on Sheets auto-parse caused locale bugs).
 *
 * SETUP (do once)
 *  1. In the `index` sheet, add a column headed exactly  DATABASE
 *     and fill oil1 / oil4 for each MERCHANT_ID.
 *  2. Reload the spreadsheet -> use the new "K-Merchant" menu.
 *  3. Run "Create daily trigger" once.
 ***********************************************************************/

const CONFIG = {
  // --- Sheets ---
  RAW_SHEET_NAME:   'K-Merchant Raw Data',
  QUERY_SHEET_NAME: 'query',
  INDEX_SHEET_NAME: 'index',

  // --- Email source ---
  REPORT_EMAIL: 'ac@tgrhotel.com',
  EMAIL_FROM:   'K-Merchant_report@kasikornbank.com',
  SUBJECT_MAIN: 'K-Merchant Reports',   // all branches share this subject

  // --- Run windows ---
  DAILY_LOOKBACK_DAYS: 7,    // daily trigger looks back 7 days (dedup makes overlap free)
  BACKFILL_DAYS:       45,
  BACKFILL_LONG_DAYS:  180,
  TRIGGER_HOUR:        7,     // reports arrive ~05:35, so 07:00 grabs same-day data

  // --- CSV column positions (0-based) inside TAX_SUMMARY_BY_TAX_ID file ---
  CSV_COL: {
    MERCHANT_ID:  0,
    TAX_INVOICE:  3,
    BRANCH_NAME:  4,
    PROCESS_DATE: 6,
    TOTAL_AMT:    10,
    TOTAL_FEE:    13,
    VAT7:         14,
    NET_CREDIT:   16,
    VAT_CODE:     18
  },

  // --- index sheet header keywords (case-insensitive "contains") ---
  INDEX_MERCHANT_KEY: 'MERCHANT',   // -> MERCHANT_ID column
  INDEX_BC_KEY:       'เจ้าของ',     // -> BC column ("จริงๆแล้วเป็นของสาขา (เจ้าของ)")
  INDEX_DB_KEY:       'DATABASE',   // -> DATABASE column (add this to the index sheet)

  RAW_HEADERS: [
    'GMAIL_MESSAGE_ID','EMAIL_DATE','REPORT_DATE','BRANCH_NAME','MERCHANT_ID',
    'TAX INVOICE NO','PROCESS DATE','TOTAL AMT','TOTAL FEE/COMMISSION AMOUNT',
    'VAT 7%','NET CREDIT AMT','VAT CODE','รหัสสาขา BC','ค่าใช้จ่าย','DATABASE'
  ],

  QUERY_HEADERS: [
    'PROCESS DATE','TAX INVOICE NO','TOTAL AMT','TOTAL FEE/COMMISSION AMOUNT',
    'VAT 7%','NET CREDIT AMT','ค่าใช้จ่าย','รหัสสาขา BC','DATABASE'
  ]
};

// Raw column indexes (0-based) for readability
const RAW = {
  MSG_ID:0, EMAIL_DATE:1, REPORT_DATE:2, BRANCH:3, MERCHANT:4, TAX:5,
  PROCESS:6, TOTAL:7, FEE:8, VAT:9, NET:10, VATCODE:11, BC:12, EXPENSE:13, DB:14
};


/* ====================================================================
 * MENU
 * ================================================================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('K-Merchant')
    .addItem('Import — daily (last 7 days)', 'menuRunDaily')
    .addItem('Import — backfill 45 days',    'menuBackfill45')
    .addItem('Import — backfill 180 days',   'menuBackfill180')
    .addSeparator()
    .addItem('Build index — list new merchant IDs to fill', 'menuBuildIndex')
    .addItem('Rebuild QUERY sheet (manual)', 'menuRebuildQuery')
    .addSeparator()
    .addItem('Test: email search only',      'menuTestEmail')
    .addItem('Create daily trigger',         'createTrigger')
    .addItem('Remove daily trigger',         'removeTrigger')
    .addToUi();
}

function menuRunDaily()    { alertSummary_(processKMerchantEmails_(CONFIG.DAILY_LOOKBACK_DAYS)); }
function menuBackfill45()  { alertSummary_(processKMerchantEmails_(CONFIG.BACKFILL_DAYS)); }
function menuBackfill180() { alertSummary_(processKMerchantEmails_(CONFIG.BACKFILL_LONG_DAYS)); }

function menuBuildIndex() {
  const r = buildIndexSheet_();
  if (r.aborted) { SpreadsheetApp.getUi().alert(r.reason); return; }
  let msg = 'Index sheet ready.\n\n' +
            'New merchant IDs added (blank — fill BC + DATABASE): ' + r.added + '\n' +
            'Already in index (untouched): ' + r.existing;
  if (r.createdSheet)   msg += '\n\nThe "index" sheet was created.';
  if (r.addedColumns.length) msg += '\n\nColumns added to index: ' + r.addedColumns.join(', ');
  if (r.newIds.length)
    msg += '\n\nNewly added IDs waiting for you:\n- ' + r.newIds.join('\n- ');
  msg += '\n\nNext: open the "index" sheet, fill BC + DATABASE for any blank row, ' +
         'then run "Rebuild QUERY sheet".';
  SpreadsheetApp.getUi().alert(msg);
}

function menuRebuildQuery() {
  const r = rebuildQuerySheet_();
  if (r.aborted) { SpreadsheetApp.getUi().alert(r.reason); return; }
  let msg = 'QUERY rebuilt.\n\n' +
            'Query rows: ' + r.rebuilt + '\n' +
            'Raw derived columns refreshed: ' + r.refreshed;
  if (r.unknownMerchants && r.unknownMerchants.length)
    msg += '\n\nUnknown MERCHANT_ID (add to index):\n- ' + r.unknownMerchants.join('\n- ');
  if (r.warnings && r.warnings.length)
    msg += '\n\nWarnings:\n- ' + r.warnings.join('\n- ');
  SpreadsheetApp.getUi().alert(msg);
}

function menuTestEmail() {
  const q = buildGmailQuery_(CONFIG.DAILY_LOOKBACK_DAYS);
  const threads = GmailApp.search(q);
  const lines = [];
  threads.forEach(t => t.getMessages().forEach(m => {
    if ((m.getSubject() || '').includes(CONFIG.SUBJECT_MAIN))
      lines.push(formatDateTime_(m.getDate()) + ' | ' + m.getSubject());
  }));
  SpreadsheetApp.getUi().alert(
    'Query:\n' + q + '\n\nThreads: ' + threads.length +
    '\n\nMatching messages:\n' + (lines.length ? lines.join('\n') : '(none)')
  );
}


/* ====================================================================
 * TRIGGERS
 * ================================================================== */
function runDaily() { processKMerchantEmails_(CONFIG.DAILY_LOOKBACK_DAYS); }

function createTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(CONFIG.TRIGGER_HOUR).create();
  SpreadsheetApp.getUi().alert('Daily trigger created at ' + CONFIG.TRIGGER_HOUR + ':00.');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDaily') ScriptApp.deleteTrigger(t);
  });
}


/* ====================================================================
 * MAIN IMPORT
 * ================================================================== */
function processKMerchantEmails_(daysBack) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { aborted: true, reason: 'Another run is in progress.' };

  const startTime = new Date();
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateRawSheet_(ss);
    const idx   = readIndexMap_(ss);
    const seen  = loadExistingKeys_(sheet);

    const gmailQuery = buildGmailQuery_(daysBack);
    const threads    = GmailApp.search(gmailQuery);

    let emailsProcessed = 0, skippedDuplicateMsg = 0, skippedDuplicateTax = 0,
        skippedTotalRows = 0, skippedInvalidRows = 0, skippedNonCsvFiles = 0;
    const unknownMerchants = new Set();
    const errors = [];
    const outputRows = [];

    threads.forEach(thread => {
      thread.getMessages().forEach(message => {
        const subject = message.getSubject() || '';
        if (!subject.includes(CONFIG.SUBJECT_MAIN)) return;

        const msgId = message.getId();
        if (seen.messageIds.has(msgId)) { skippedDuplicateMsg++; return; }

        emailsProcessed++;
        const emailDate  = message.getDate();                       // real Date
        const reportDate = extractReportDate_(subject, emailDate);  // Date

        try {
          message.getAttachments().forEach(att => {
            const fileName = att.getName() || '';
            if (!fileName.toLowerCase().endsWith('.zip')) { skippedNonCsvFiles++; return; }

            let files;
            try {
              files = Utilities.unzip(att.copyBlob());
            } catch (e) {
              errors.push('Cannot unzip ' + fileName + ' (encrypted/corrupt?) | ' + e.message);
              return;
            }

            files.forEach(file => {
              const csvName = file.getName() || '';
              if (!csvName.toLowerCase().endsWith('.csv')) { skippedNonCsvFiles++; return; }
              if (csvName.toUpperCase().indexOf('TAX_SUMMARY') === -1) return;

              const rows = Utilities.parseCsv(file.getDataAsString('UTF-8'));
              for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.length === 0) { skippedInvalidRows++; continue; }
                if (r.length <= CONFIG.CSV_COL.VAT_CODE) { skippedInvalidRows++; continue; } // structure guard

                const merchantId   = normalizeId_(r[CONFIG.CSV_COL.MERCHANT_ID]);
                const taxInvoiceNo = clean_(r[CONFIG.CSV_COL.TAX_INVOICE]);
                const branchName   = clean_(r[CONFIG.CSV_COL.BRANCH_NAME]);
                const processDate  = parseBankDate_(r[CONFIG.CSV_COL.PROCESS_DATE]);
                const totalAmt     = cleanNumber_(r[CONFIG.CSV_COL.TOTAL_AMT]);
                const totalFee     = cleanNumber_(r[CONFIG.CSV_COL.TOTAL_FEE]);
                const vat7         = cleanNumber_(r[CONFIG.CSV_COL.VAT7]);
                const netCreditAmt = cleanNumber_(r[CONFIG.CSV_COL.NET_CREDIT]);
                const vatCode      = clean_(r[CONFIG.CSV_COL.VAT_CODE]);

                if (merchantId.toUpperCase() === 'TOTAL') { skippedTotalRows++; continue; }
                if (!taxInvoiceNo || taxInvoiceNo.toUpperCase() === 'TOTAL') { skippedInvalidRows++; continue; }
                if (seen.taxInvoices.has(taxInvoiceNo)) { skippedDuplicateTax++; continue; }
                seen.taxInvoices.add(taxInvoiceNo);

                const d = computeDerived_(merchantId, totalFee, vat7, idx.map);
                if (!d.found) unknownMerchants.add(merchantId + (branchName ? ' (' + branchName + ')' : ''));

                const row = new Array(CONFIG.RAW_HEADERS.length);
                row[RAW.MSG_ID]=msgId;        row[RAW.EMAIL_DATE]=emailDate;  row[RAW.REPORT_DATE]=reportDate;
                row[RAW.BRANCH]=branchName;   row[RAW.MERCHANT]=merchantId;   row[RAW.TAX]=taxInvoiceNo;
                row[RAW.PROCESS]=processDate; row[RAW.TOTAL]=totalAmt;        row[RAW.FEE]=totalFee;
                row[RAW.VAT]=vat7;            row[RAW.NET]=netCreditAmt;      row[RAW.VATCODE]=vatCode;
                row[RAW.BC]=d.bc;             row[RAW.EXPENSE]=d.expense;     row[RAW.DB]=d.database;
                outputRows.push(row);
              }
            });
          });
          seen.messageIds.add(msgId);
        } catch (e) {
          errors.push('Message ID ' + msgId + ' | ' + e.message);
        }
      });
    });

    let rowsInserted = 0;
    if (outputRows.length > 0) {
      applyRawFormats_(sheet);
      sheet.getRange(sheet.getLastRow() + 1, 1, outputRows.length, CONFIG.RAW_HEADERS.length)
           .setValues(outputRows);
      rowsInserted = outputRows.length;
    }

    const summary = {
      startTime, gmailQuery, daysBack,
      threadsFound: threads.length, emailsProcessed, rowsInserted,
      skippedDuplicateMsg, skippedDuplicateTax, skippedTotalRows,
      skippedInvalidRows, skippedNonCsvFiles,
      unknownMerchants: Array.from(unknownMerchants),
      warnings: idx.warnings,
      errors
    };
    sendReport_(summary);
    return summary;

  } finally {
    lock.releaseLock();
  }
}


/* ====================================================================
 * MANUAL QUERY REBUILD
 *  - Recomputes BC / ค่าใช้จ่าย / DATABASE from the CURRENT index,
 *    writes them back to raw (M:O), then rebuilds the query projection.
 *  - Index is the single source of truth: add a merchant -> rerun this.
 * ================================================================== */
function rebuildQuerySheet_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { aborted: true, reason: 'Another run is in progress.' };

  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const raw = ss.getSheetByName(CONFIG.RAW_SHEET_NAME);
    if (!raw || raw.getLastRow() < 2)
      return { rebuilt: 0, refreshed: 0, unknownMerchants: [], warnings: ['Raw sheet is empty.'] };

    const idx     = readIndexMap_(ss);
    const lastRow = raw.getLastRow();
    const data    = raw.getRange(2, 1, lastRow - 1, CONFIG.RAW_HEADERS.length).getValues();

    const unknownMerchants = new Set();
    const derived   = [];   // [BC, ค่าใช้จ่าย, DATABASE]
    const queryRows = [];

    data.forEach(r => {
      const mid = normalizeId_(r[RAW.MERCHANT]);
      const fee = toNum_(r[RAW.FEE]);
      const vat = toNum_(r[RAW.VAT]);
      const hit = idx.map[mid];

      // NON-DESTRUCTIVE: index value wins if present; otherwise keep whatever
      // is already on the raw row. A blank only survives if BOTH are empty.
      const bc = (hit && hit.bc)       ? hit.bc       : clean_(r[RAW.BC]);
      const db = (hit && hit.database) ? hit.database : clean_(r[RAW.DB]);
      const expense = (fee === '' && vat === '')
        ? clean_(r[RAW.EXPENSE])
        : round2_((fee === '' ? 0 : fee) + (vat === '' ? 0 : vat));

      if (mid && (!bc || !db)) unknownMerchants.add(mid);

      derived.push([bc, expense, db]);
      queryRows.push([
        r[RAW.PROCESS], r[RAW.TAX], r[RAW.TOTAL], r[RAW.FEE], r[RAW.VAT],
        r[RAW.NET], expense, bc, db
      ]);
    });

    // refresh derived columns on raw
    raw.getRange(2, RAW.BC + 1, derived.length, 3).setValues(derived);

    // rebuild query sheet
    const q = getOrCreateQuerySheet_(ss);
    if (q.getLastRow() > 1)
      q.getRange(2, 1, q.getLastRow() - 1, CONFIG.QUERY_HEADERS.length).clearContent();
    applyQueryFormats_(q);
    if (queryRows.length)
      q.getRange(2, 1, queryRows.length, CONFIG.QUERY_HEADERS.length).setValues(queryRows);

    return {
      rebuilt: queryRows.length, refreshed: derived.length,
      unknownMerchants: Array.from(unknownMerchants), warnings: idx.warnings
    };
  } finally {
    lock.releaseLock();
  }
}


/* ====================================================================
 * DERIVED VALUES + INDEX LOOKUP
 * ================================================================== */
function computeDerived_(merchantId, totalFee, vat7, indexMap) {
  let expense = '';
  if (totalFee !== '' || vat7 !== '')
    expense = round2_((totalFee === '' ? 0 : totalFee) + (vat7 === '' ? 0 : vat7));

  const hit = indexMap[merchantId];
  if (hit) return { found: true,  bc: hit.bc, database: hit.database, expense: expense };
  return        { found: false, bc: '',     database: '',          expense: expense };
}

function readIndexMap_(ss) {
  const warnings = [];
  const map = {};
  const sheet = ss.getSheetByName(CONFIG.INDEX_SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) {
    warnings.push('index sheet "' + CONFIG.INDEX_SHEET_NAME + '" not found or empty.');
    return { map, warnings };
  }

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(h => clean_(h));
  const mCol  = findHeader_(header, CONFIG.INDEX_MERCHANT_KEY);
  const bcCol = findHeader_(header, CONFIG.INDEX_BC_KEY);
  const dbCol = findHeader_(header, CONFIG.INDEX_DB_KEY);

  if (mCol  === -1) warnings.push('index: MERCHANT_ID column not found.');
  if (bcCol === -1) warnings.push('index: BC column ("' + CONFIG.INDEX_BC_KEY + '") not found.');
  if (dbCol === -1) warnings.push('index: DATABASE column not found — add a column headed "DATABASE".');
  if (mCol === -1 || bcCol === -1) return { map, warnings };

  for (let i = 1; i < values.length; i++) {
    const mid = normalizeId_(values[i][mCol]);
    if (!mid) continue;
    map[mid] = {
      bc:       clean_(values[i][bcCol]),
      database: dbCol === -1 ? '' : clean_(values[i][dbCol])
    };
  }
  return { map, warnings };
}

function findHeader_(headerArr, keyword) {
  const k = String(keyword).toLowerCase();
  for (let i = 0; i < headerArr.length; i++)
    if (String(headerArr[i]).toLowerCase().indexOf(k) !== -1) return i;
  return -1;
}

/* --------------------------------------------------------------------
 * BUILD INDEX SHEET (blank, for the user to fill)
 *  - Ensures the index sheet exists with MERCHANT_ID / BC / DATABASE.
 *  - Scans raw data for every distinct MERCHANT_ID.
 *  - APPENDS only IDs not already in the index, with BLANK BC + DATABASE.
 *  - Never touches existing index rows (append-only, no guessing).
 *  - User fills BC + DATABASE by hand, then runs Rebuild QUERY.
 * ------------------------------------------------------------------ */
function buildIndexSheet_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { aborted: true, reason: 'Another run is in progress.' };

  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const raw = ss.getSheetByName(CONFIG.RAW_SHEET_NAME);
    if (!raw || raw.getLastRow() < 2)
      return { added:0, existing:0, createdSheet:false, addedColumns:[], newIds:[],
               aborted:false };

    // distinct MERCHANT_IDs from raw, in first-seen order
    const data = raw.getRange(2, RAW.MERCHANT + 1, raw.getLastRow() - 1, 1).getValues();
    const seenOrder = [];
    const seenSet = {};
    data.forEach(r => {
      const mid = normalizeId_(r[0]);
      if (mid && mid.toUpperCase() !== 'TOTAL' && !seenSet[mid]) { seenSet[mid] = true; seenOrder.push(mid); }
    });

    // ensure index sheet + the three columns
    const addedColumns = [];
    let createdSheet = false;
    let sheet = ss.getSheetByName(CONFIG.INDEX_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.INDEX_SHEET_NAME);
      sheet.getRange(1, 1, 1, 3)
           .setValues([['MERCHANT_ID', 'จริงๆแล้วเป็นของสาขา (เจ้าของ)', 'DATABASE']]);
      sheet.setFrozenRows(1);
      createdSheet = true;
    }
    let col = sheet.getLastColumn();
    let header = sheet.getRange(1, 1, 1, col).getValues()[0].map(h => clean_(h));
    let mCol  = findHeader_(header, CONFIG.INDEX_MERCHANT_KEY);
    let bcCol = findHeader_(header, CONFIG.INDEX_BC_KEY);
    let dbCol = findHeader_(header, CONFIG.INDEX_DB_KEY);
    if (mCol  === -1) { sheet.getRange(1, ++col).setValue('MERCHANT_ID'); mCol  = col - 1; addedColumns.push('MERCHANT_ID'); }
    if (bcCol === -1) { sheet.getRange(1, ++col).setValue('จริงๆแล้วเป็นของสาขา (เจ้าของ)'); bcCol = col - 1; addedColumns.push('BC'); }
    if (dbCol === -1) { sheet.getRange(1, ++col).setValue('DATABASE'); dbCol = col - 1; addedColumns.push('DATABASE'); }

    const width = sheet.getLastColumn();

    // which IDs already exist in the index
    const present = {};
    if (sheet.getLastRow() >= 2) {
      const idxVals = sheet.getRange(2, mCol + 1, sheet.getLastRow() - 1, 1).getValues();
      idxVals.forEach(row => { const m = normalizeId_(row[0]); if (m) present[m] = true; });
    }

    // append blank rows for new IDs only
    const appends = [], newIds = [];
    seenOrder.forEach(mid => {
      if (present[mid]) return;
      const row = new Array(width).fill('');
      row[mCol] = mid;          // BC + DATABASE left blank on purpose
      appends.push(row);
      newIds.push(mid);
    });
    if (appends.length)
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, width).setValues(appends);

    // keep MERCHANT_ID column as text so long IDs never become 4.01E+14
    if (sheet.getLastRow() > 1)
      sheet.getRange(2, mCol + 1, sheet.getLastRow() - 1, 1).setNumberFormat('@');

    return { added: appends.length, existing: Object.keys(present).length,
             createdSheet, addedColumns, newIds, aborted:false };
  } finally {
    lock.releaseLock();
  }
}


/* ====================================================================
 * SHEET HELPERS
 * ================================================================== */
function getOrCreateRawSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.RAW_SHEET_NAME) || ss.insertSheet(CONFIG.RAW_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.RAW_HEADERS.length).setValues([CONFIG.RAW_HEADERS]);
    sheet.setFrozenRows(1);
  }
  applyRawFormats_(sheet);
  return sheet;
}

function getOrCreateQuerySheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.QUERY_SHEET_NAME) || ss.insertSheet(CONFIG.QUERY_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.QUERY_HEADERS.length).setValues([CONFIG.QUERY_HEADERS]);
    sheet.setFrozenRows(1);
  }
  applyQueryFormats_(sheet);
  return sheet;
}

function applyRawFormats_(sheet) {
  sheet.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm:ss'); // EMAIL_DATE
  sheet.getRange('C:C').setNumberFormat('dd/MM/yyyy');          // REPORT_DATE
  sheet.getRange('E:E').setNumberFormat('@');                   // MERCHANT_ID  (text)
  sheet.getRange('F:F').setNumberFormat('@');                   // TAX INVOICE NO (text)
  sheet.getRange('G:G').setNumberFormat('dd/MM/yyyy');          // PROCESS DATE
}

function applyQueryFormats_(sheet) {
  sheet.getRange('A:A').setNumberFormat('dd/MM/yyyy');          // PROCESS DATE
  sheet.getRange('B:B').setNumberFormat('@');                   // TAX INVOICE NO (text)
}

function loadExistingKeys_(sheet) {
  const messageIds = new Set(), taxInvoices = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { messageIds, taxInvoices };

  const vals = sheet.getRange(2, 1, lastRow - 1, CONFIG.RAW_HEADERS.length).getValues();
  vals.forEach(row => {
    const m = clean_(row[RAW.MSG_ID]);
    const t = clean_(row[RAW.TAX]);
    if (m) messageIds.add(m);
    if (t) taxInvoices.add(t);
  });
  return { messageIds, taxInvoices };
}


/* ====================================================================
 * SMALL UTILITIES
 * ================================================================== */
function buildGmailQuery_(daysBack) {
  return [
    'from:' + CONFIG.EMAIL_FROM,
    'subject:"' + CONFIG.SUBJECT_MAIN + '"',
    'newer_than:' + daysBack + 'd',
    'has:attachment'
  ].join(' ');
}

function extractReportDate_(subject, fallbackDate) {
  const m = subject.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return m ? parseBankDate_(m[1]) : fallbackDate;
}

// Bank dates are DD/MM/YYYY — parse explicitly so locale never flips day/month.
function parseBankDate_(value) {
  const s = clean_(value);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^\uFEFF/, '').replace(/^'/, '').trim();
}

function normalizeId_(value) {
  return clean_(value).replace(/\.0+$/, '');   // 401017712799001.0 -> 401017712799001
}

function cleanNumber_(value) {
  const t = clean_(value).replace(/,/g, '');
  if (t === '') return '';
  const n = Number(t);
  return isNaN(n) ? '' : n;
}

function toNum_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  return cleanNumber_(value);
}

function round2_(n) { return Math.round(n * 100) / 100; }

function formatDateTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}


/* ====================================================================
 * REPORTING
 * ================================================================== */
function sendReport_(d) {
  // รอบที่มาจากปุ่ม 🔄 Sync ของเว็บแอป EDC ไม่ต้องส่งเมลรายงาน (กดถี่ = เมลท่วม)
  if (typeof SYNC_SILENT_ !== 'undefined' && SYNC_SILENT_) return;
  const durationSec = Math.round((new Date() - d.startTime) / 1000);
  const body =
`K-Merchant CSV Extraction Report

Execution Time: ${formatDateTime_(d.startTime)}
Duration: ${durationSec} seconds
Lookback window: ${d.daysBack} days

Gmail Query:
${d.gmailQuery}

Summary:
- Threads found: ${d.threadsFound}
- Emails processed: ${d.emailsProcessed}
- Rows inserted: ${d.rowsInserted}

Skipped:
- Duplicate Gmail Message ID: ${d.skippedDuplicateMsg}
- Duplicate TAX INVOICE NO: ${d.skippedDuplicateTax}
- TOTAL rows: ${d.skippedTotalRows}
- Invalid rows: ${d.skippedInvalidRows}
- Non CSV / ignored files: ${d.skippedNonCsvFiles}

Unknown MERCHANT_ID (add to "index", then Rebuild QUERY):
${d.unknownMerchants.length ? '- ' + d.unknownMerchants.join('\n- ') : 'None'}

Index warnings:
${d.warnings.length ? '- ' + d.warnings.join('\n- ') : 'None'}

Errors:
${d.errors.length ? d.errors.join('\n') : 'No errors'}

Status:
${d.errors.length ? 'Completed with errors' : 'Completed successfully'}
`;
  GmailApp.sendEmail(
    CONFIG.REPORT_EMAIL,
    'K-Merchant CSV Extraction Report - ' + formatDateTime_(new Date()),
    body
  );
}

function alertSummary_(s) {
  if (s.aborted) { SpreadsheetApp.getUi().alert(s.reason); return; }
  let msg = 'Import done (last ' + s.daysBack + ' days).\n\n' +
            'Emails processed: ' + s.emailsProcessed + '\n' +
            'Rows inserted: ' + s.rowsInserted + '\n' +
            'Dup TAX skipped: ' + s.skippedDuplicateTax + '\n' +
            'Dup email skipped: ' + s.skippedDuplicateMsg;
  if (s.unknownMerchants.length)
    msg += '\n\nUnknown MERCHANT_ID (add to index):\n- ' + s.unknownMerchants.join('\n- ');
  if (s.warnings.length)
    msg += '\n\nWarnings:\n- ' + s.warnings.join('\n- ');
  if (s.errors.length)
    msg += '\n\nErrors:\n' + s.errors.join('\n');
  msg += '\n\nReminder: run "Rebuild QUERY sheet" to refresh the query view.';
  SpreadsheetApp.getUi().alert(msg);
}