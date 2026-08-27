/************************************************************
 * BBL eTax Invoice Extraction - SINGLE FILE (hardened build)
 * Paste this whole file into ONE .gs in your Apps Script project.
 * Delete any previous BBL code first to avoid duplicate functions.
 * Requires Advanced Drive Service: Editor -> Services (+) -> "Drive API".
 *
 * Sections:
 *   1. CONFIG + MENU + entry points + triggers
 *   2. SCRAPER       - Gmail + PDF -> source sheet (validated)
 *   3. QUERYBUILDER  - source -> query sheet (pure, deduped by invoice no)
 *   4. MAPPING       - `index` sheet is source of truth (by MERCHANT_ID)
 *   5. LIB           - sheet helpers, parsers, validation, utils
 *   6. CONSOLE       - unified tabbed dialog (Scrape / Query / Status)
 ************************************************************/

const CONFIG = {
  SOURCE_SHEET_NAME: 'BBL eTax Invoices',
  QUERY_SHEET_NAME: 'query',
  DEBUG_SHEET_NAME: 'BBL eTax Debug',
  INDEX_SHEET_NAME: 'index',
  PDF_FOLDER_NAME: 'BBL eTax PDF Archive',

  EMAIL_FROM: 'merchant_etax.ccd@bangkokbank.com',
  EMAIL_SUBJECT: 'Bangkok Bank Credit Card e-Tax Invoice/e-Receipt',
  BODY_MUST_CONTAIN_1: 'เรียน ท่านเจ้าของร้านค้า',
  BODY_MUST_CONTAIN_2: 'e-Tax Invoice/e-Receipt',

  DEFAULT_DAYS_LOOKBACK: 30,
  FIRST_RUN_DAYS_LOOKBACK: 180,
  GMAIL_PAGE_SIZE: 50,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_NEW_PDF_PER_RUN: 20,
  DAILY_TRIGGER_HOUR: 8,

  // Validation / reliability
  AMOUNT_TOLERANCE: 0.05,        // |total - fee - vat - net| must be <= this
  CONVERT_RETRIES: 1,            // extra attempts after the first conversion failure
  CONVERT_RETRY_SLEEP_MS: 2000,

  // true  = Scrape button touches ONLY the source sheet
  // false = every scrape also rebuilds the query sheet at the end
  DECOUPLE_QUERY_FROM_SCRAPE: false,

  SOURCE_HEADERS: [
    'GMAIL_MESSAGE_ID',            // 0  A
    'EMAIL_DATE',                  // 1  B
    'REPORT_DATE',                 // 2  C
    'BRANCH_NAME',                 // 3  D
    'MERCHANT_ID',                 // 4  E
    'TAX_INVOICE_NO',              // 5  F
    'PROCESS_DATE',                // 6  G
    'TOTAL_AMT',                   // 7  H
    'TOTAL_FEE_COMMISSION_AMOUNT', // 8  I
    'VAT_7_PERCENT',               // 9  J
    'NET_CREDIT_AMT',              // 10 K
    'WHT_3_PERCENT',               // 11 L
    'PDF_LINK',                    // 12 M
    'รหัสสาขา BC',                  // 13 N (cached; query recomputes from index)
    'ค่าใช้จ่าย',                    // 14 O (cached)
    'DATABASE',                    // 15 P (cached)
    'STATUS'                       // 16 Q (OK / WARN: ... - validation result)
  ],

  // EXACT labels and order of the live query sheet.
  QUERY_HEADERS: [
    'PROCESS DATE',                 // A
    'TAX INVOICE NO',               // B
    'TOTAL AMT',                    // C
    'TOTAL FEE/COMMISSION AMOUNT',  // D
    'VAT 7%',                       // E
    'NET CREDIT AMT',               // F
    'ค่าใช้จ่าย',                    // G
    'รหัสสาขา BC',                  // H
    'DATABASE'                      // I
  ],

  INDEX_HEADERS: [
    'ลำดับ',          // A
    'MERCHANT_ID',    // B  <- join key (unique; BRANCH_NAME is not)
    'รหัสสาขา BC',     // C
    'DATABASE',       // D
    'BRANCH_NAME',    // E  <- human label; auto-filled from source
    'หมายเหตุ'         // F
  ]
};


/* ---------------- MENU ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BBL eTax')
    .addItem('🖥️ Open Console', 'showConsole')
    .addSeparator()
    .addItem('1) Setup Sheets', 'setupBBLETax')
    .addSeparator()
    .addItem('SCRAPE - Test Yesterday', 'testYesterdayBBLETax')
    .addItem('SCRAPE - Last 30 Days', 'runBBLETax')
    .addItem('SCRAPE - First Time 180 Days', 'runBBLETax180Days')
    .addSeparator()
    .addItem('QUERY - Rebuild Query Sheet (all)', 'rebuildQuerySheet')
    .addItem('INDEX - Build / Refresh from Source', 'rebuildIndexFromSource')
    .addSeparator()
    .addItem('Install Daily Trigger 08:00', 'installDailyTrigger0800')
    .addItem('Delete Existing BBL Triggers', 'deleteBBLTriggers')
    .addToUi();
}

function setupBBLETax() {
  ensureSourceSheet_();
  ensureQuerySheet_();
  ensureDebugSheet_();
  ensureIndexSheet_();
  ensurePdfFolder_();
  buildIndexSheet_();
  rebuildQuerySheet();
  SpreadsheetApp.getActive().toast('Setup completed.');
}

/* ---- public entry points (safe to attach to drawing buttons) ---- */

function testYesterdayBBLETax() {
  const today = new Date();
  const startDate = new Date(today); startDate.setDate(today.getDate() - 1); startDate.setHours(0,0,0,0);
  const endDate = new Date(today); endDate.setHours(0,0,0,0);
  return scrapeBBLETax_({ startDate: startDate, endDate: endDate, mode: 'TEST_YESTERDAY' });
}
function testLast7DaysBBLETax() { return scrapeBBLETax_({ daysLookback: 7, mode: 'TEST_LAST_7_DAYS' }); }
function runBBLETax()           { return scrapeBBLETax_({ daysLookback: CONFIG.DEFAULT_DAYS_LOOKBACK, mode: 'RUN_LAST_30_DAYS' }); }
function runBBLETax180Days()    { return scrapeBBLETax_({ daysLookback: CONFIG.FIRST_RUN_DAYS_LOOKBACK, mode: 'RUN_180_DAYS' }); }
function runBBLETaxDaily()      { return scrapeBBLETax_({ daysLookback: 7, mode: 'DAILY_TRIGGER' }); }
function rebuildIndexFromSource() { return buildIndexSheet_(); }

/* ---- triggers ---- */

function installDailyTrigger0800() {
  deleteBBLTriggers();
  ScriptApp.newTrigger('runBBLETaxDaily').timeBased().everyDays(1).atHour(CONFIG.DAILY_TRIGGER_HOUR).create();
  SpreadsheetApp.getActive().toast('Daily trigger installed around 08:00.');
}

function deleteBBLTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runBBLETaxDaily') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getActive().toast('Existing BBL triggers deleted.');
}


/************************************************************
 * 2. SCRAPER
 * Gmail -> PDF -> validated row in the source sheet.
 *
 * Trust pipeline per PDF (any hard failure = no row, PDF archived
 * with FAILED_ prefix for inspection, ERROR logged):
 *   1. sender / subject / body markers checked        (isTargetMessage_)
 *   2. filename parsed: merchant + date + invoice no  (parseDataFromFileName_)
 *   3. PDF converted to text (1 automatic retry)      (convertPdfWithRetry_)
 *   4. PDF body parsed                                 (parseBangkokBankPdf_)
 *   5. IDENTITY CROSS-CHECK: filename vs PDF body must agree on
 *      merchant + invoice no                           (reconcileIdentity_)
 *   6. ARITHMETIC CHECK: total - fee - vat = net ±tol  (validateInvoice_)
 *      soft failures -> row stored with STATUS 'WARN: ...'
 ************************************************************/

function scrapeBBLETax_(options) {
  const startedAt = Date.now();
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch (err) { throw new Error('มี Script อื่นกำลังทำงานอยู่ กรุณาลองใหม่อีกครั้ง'); }

  let emailsChecked = 0, pdfChecked = 0, pdfSaved = 0, pdfConverted = 0;
  let rowsAdded = 0, rowsWarned = 0, duplicatesSkipped = 0, rejected = 0, errors = 0;
  let stoppedByLimit = false;
  const rows = [];

  try {
    const sourceSheet = ensureSourceSheet_();
    ensureDebugSheet_();
    const pdfFolder = ensurePdfFolder_();
    const existingKeys = getExistingKeys_(sourceSheet);
    const query = buildGmailQuery_(options);
    logDebug_('INFO', 'Gmail Query', query);

    let start = 0;
    while (true) {
      if (shouldStop_(startedAt, pdfConverted)) { stoppedByLimit = true; break; }

      const threads = GmailApp.search(query, start, CONFIG.GMAIL_PAGE_SIZE);
      if (!threads || threads.length === 0) break;

      for (const thread of threads) {
        if (shouldStop_(startedAt, pdfConverted)) { stoppedByLimit = true; break; }

        for (const message of thread.getMessages()) {
          if (shouldStop_(startedAt, pdfConverted)) { stoppedByLimit = true; break; }
          emailsChecked++;
          if (!isTargetMessage_(message)) continue;

          const messageId = message.getId();
          const emailDate = message.getDate();
          const reportDate = extractReportDateFromEmailBody_(message.getPlainBody() || '');

          const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
          for (const attachment of attachments) {
            if (shouldStop_(startedAt, pdfConverted)) { stoppedByLimit = true; break; }

            const fileName = attachment.getName() || '';
            if (!isPdfAttachment_(fileName, attachment.getContentType() || '')) continue;
            pdfChecked++;

            try {
              const fileData = parseDataFromFileName_(fileName);

              // Fast duplicate skip from the filename alone (no costly conversion).
              if (fileData.merchantId && fileData.taxInvoiceNo) {
                const fastKey = makeDuplicateKey_(messageId, fileData.merchantId, fileData.taxInvoiceNo);
                if (existingKeys.has(fastKey)) { duplicatesSkipped++; continue; }
              } else {
                logDebug_('WARN', 'Filename did not match BBLETAXACQ pattern', fileName);
              }

              const pdfBlob = attachment.copyBlob();
              pdfBlob.setName(fileName);
              pdfBlob.setContentType(MimeType.PDF);

              // 3. convert (with retry)
              let pdfText;
              try {
                pdfText = convertPdfWithRetry_(pdfBlob, fileName);
                pdfConverted++;
              } catch (convErr) {
                errors++;
                savePdfToDrive_(pdfFolder, pdfBlob, emailDate, 'FAILED_' + fileName);
                logDebug_('ERROR', 'PDF conversion failed (archived as FAILED_)',
                  'Email: ' + messageId + ' | File: ' + fileName + ' | ' + convErr.message);
                continue;
              }

              // 4. parse + 5. identity cross-check
              const parsed = parseBangkokBankPdf_(pdfText);
              const identity = reconcileIdentity_(fileData, parsed);

              if (!identity.ok) {
                rejected++;
                savePdfToDrive_(pdfFolder, pdfBlob, emailDate, 'FAILED_' + fileName);
                logDebug_('ERROR', 'Invoice REJECTED: identity check failed',
                  'Email: ' + messageId + ' | File: ' + fileName + ' | ' + identity.problems.join(' ; '));
                continue;
              }

              const dupKey = makeDuplicateKey_(messageId, identity.merchantId, identity.taxInvoiceNo);
              if (existingKeys.has(dupKey)) { duplicatesSkipped++; continue; }

              // 6. arithmetic / mapping validation (soft - row still stored)
              const warnings = identity.warnings.concat(validateInvoice_(parsed, identity.merchantId));
              const status = warnings.length ? ('WARN: ' + warnings.join(' ; ')) : 'OK';
              if (warnings.length) {
                rowsWarned++;
                logDebug_('WARN', 'Invoice stored with warnings',
                  'Invoice ' + identity.taxInvoiceNo + ' | ' + warnings.join(' ; '));
              }

              // Save PDF only after the invoice passed identity checks.
              const pdfUrl = savePdfToDrive_(pdfFolder, pdfBlob, emailDate, fileName);
              pdfSaved++;

              const bcCode   = mapMerchantIdToBCCode_(identity.merchantId);
              const expense  = round2_(toNumber_(parsed.totalFee) + toNumber_(parsed.vat7));
              const database = mapMerchantIdToDatabase_(identity.merchantId);

              rows.push([
                messageId, emailDate, reportDate, parsed.branchName, identity.merchantId,
                identity.taxInvoiceNo, identity.processDate, parsed.totalAmt, parsed.totalFee,
                parsed.vat7, parsed.netCreditAmt, parsed.wht3, pdfUrl, bcCode, expense, database, status
              ]);

              existingKeys.add(dupKey);
              rowsAdded++;
              if (rows.length >= 10) { appendSourceRows_(sourceSheet, rows); rows.length = 0; }

            } catch (pdfErr) {
              errors++;
              logDebug_('ERROR', 'PDF processing error',
                'Email: ' + messageId + ' | File: ' + fileName + ' | ' + pdfErr.message);
            }
          }
        }
      }

      start += threads.length;
      if (threads.length < CONFIG.GMAIL_PAGE_SIZE) break;
    }

    if (rows.length > 0) { appendSourceRows_(sourceSheet, rows); rows.length = 0; }
    formatSourceSheet_(sourceSheet);

    if (!CONFIG.DECOUPLE_QUERY_FROM_SCRAPE) rebuildQuerySheet();

    const summary = [
      'BBL eTax SCRAPE Completed',
      'Mode: ' + (options && options.mode ? options.mode : ''),
      'Emails checked: ' + emailsChecked,
      'PDF checked: ' + pdfChecked,
      'PDF converted: ' + pdfConverted,
      'PDF saved: ' + pdfSaved,
      'Rows added: ' + rowsAdded + (rowsWarned ? ' (' + rowsWarned + ' with warnings)' : ''),
      'Rejected (identity check): ' + rejected,
      'Duplicates skipped: ' + duplicatesSkipped,
      'Errors: ' + errors,
      stoppedByLimit ? 'Status: stopped by time/PDF limit. Run again to continue.' : 'Status: completed.'
    ].join('\n');

    setProp_('LAST_SCRAPE_AT', formatNow_());
    setProp_('LAST_SCRAPE_INFO',
      (options && options.mode ? options.mode : '') + ' | added ' + rowsAdded +
      ', warned ' + rowsWarned + ', rejected ' + rejected + ', errors ' + errors);

    logDebug_('INFO', 'Summary', summary);
    SpreadsheetApp.getActive().toast(summary);
    return summary;

  } finally {
    lock.releaseLock();
  }
}


/* ---------- identity & validation ---------- */

/**
 * Cross-check filename-derived identity vs PDF-body-derived identity.
 * HARD failures (no row written): merchant or invoice missing from both
 * sources, or present in both but DIFFERENT (misfiled/tampered signal).
 * SOFT warning: process date disagrees (filename date wins).
 */
function reconcileIdentity_(fileData, parsed) {
  const problems = [];
  const warnings = [];

  const fm = String(fileData.merchantId || '').trim();
  const pm = String(parsed.merchantId || '').trim();
  const fi = String(fileData.taxInvoiceNo || '').trim();
  const pi = String(parsed.taxInvoiceNo || '').trim();
  const fd = String(fileData.processDate || '').trim();
  const pd = String(parsed.processDate || '').trim();

  if (fm && pm && fm !== pm) problems.push('merchant mismatch: filename=' + fm + ' pdf=' + pm);
  if (fi && pi && fi !== pi) problems.push('invoice no mismatch: filename=' + fi + ' pdf=' + pi);

  const merchantId = fm || pm;
  const taxInvoiceNo = fi || pi;
  if (!merchantId) problems.push('merchant id missing from filename AND pdf');
  if (!taxInvoiceNo) problems.push('tax invoice no missing from filename AND pdf');

  if (fd && pd && fd !== pd) warnings.push('process date differs: filename=' + fd + ' pdf=' + pd);

  return {
    ok: problems.length === 0,
    merchantId: merchantId,
    taxInvoiceNo: taxInvoiceNo,
    processDate: fd || pd,
    problems: problems,
    warnings: warnings
  };
}

/** Soft checks. Returns array of warning strings (empty = clean). */
function validateInvoice_(parsed, merchantId) {
  const w = [];
  const total = toNumber_(parsed.totalAmt);
  const fee = toNumber_(parsed.totalFee);
  const vat = toNumber_(parsed.vat7);
  const net = toNumber_(parsed.netCreditAmt);

  if (!(total > 0)) {
    w.push('TOTAL_AMT missing/zero - amount row not parsed');
  } else {
    const expectNet = round2_(total - fee - vat);
    if (Math.abs(expectNet - net) > CONFIG.AMOUNT_TOLERANCE) {
      w.push('amounts do not reconcile: total-fee-vat=' + expectNet.toFixed(2) + ' but net=' + net.toFixed(2));
    }
  }
  if (!parsed.processDate) w.push('process date missing from pdf');
  if (!mapMerchantIdToBCCode_(merchantId)) w.push('merchant ' + merchantId + ' not in index - run INDEX refresh and fill BC/DATABASE');
  return w;
}


/* ---------- Gmail ---------- */

function buildGmailQuery_(options) {
  const parts = [
    'from:' + CONFIG.EMAIL_FROM,
    'subject:"' + CONFIG.EMAIL_SUBJECT + '"',
    'has:attachment',
    'filename:pdf'
  ];
  if (options && options.startDate && options.endDate) {
    parts.push('after:' + formatGmailDate_(options.startDate));
    parts.push('before:' + formatGmailDate_(options.endDate));
  } else {
    const days = (options && options.daysLookback) ? options.daysLookback : CONFIG.DEFAULT_DAYS_LOOKBACK;
    parts.push('newer_than:' + days + 'd');
  }
  return parts.join(' ');
}

function isTargetMessage_(message) {
  const from = getEmailAddressOnly_(message.getFrom()).toLowerCase();
  const subject = String(message.getSubject() || '');
  const body = normalizeText_(message.getPlainBody() || '');
  if (from !== CONFIG.EMAIL_FROM.toLowerCase()) return false;
  if (subject.indexOf(CONFIG.EMAIL_SUBJECT) === -1) return false;
  if (body.indexOf(normalizeText_(CONFIG.BODY_MUST_CONTAIN_1)) === -1) return false;
  if (body.indexOf(normalizeText_(CONFIG.BODY_MUST_CONTAIN_2)) === -1) return false;
  return true;
}

function extractReportDateFromEmailBody_(body) {
  const text = normalizeText_(body);
  const match = text.match(/สำหรับวันที่\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  return (match && match[1]) ? convertThaiYearToAD_(match[1]) : '';
}


/* ---------- PDF save + convert ---------- */

function savePdfToDrive_(folder, pdfBlob, emailDate, fileNameForSave) {
  const timestamp = Utilities.formatDate(emailDate || new Date(),
    Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  const safeName = sanitizeFileName_(timestamp + '_' + fileNameForSave);
  const copied = pdfBlob.copyBlob();
  copied.setName(safeName);
  copied.setContentType(MimeType.PDF);
  const file = folder.createFile(copied);
  file.setName(safeName);
  return file.getUrl();
}

/** Conversion with automatic retry for transient Drive API failures. */
function convertPdfWithRetry_(pdfBlob, originalFileName) {
  let lastErr = null;
  for (let attempt = 0; attempt <= CONFIG.CONVERT_RETRIES; attempt++) {
    try {
      if (attempt > 0) Utilities.sleep(CONFIG.CONVERT_RETRY_SLEEP_MS);
      return extractTextFromPdfByConvertingToGoogleDoc_(pdfBlob, originalFileName);
    } catch (err) {
      lastErr = err;
      logDebug_('WARN', 'Conversion attempt ' + (attempt + 1) + ' failed', originalFileName + ' | ' + err.message);
    }
  }
  throw lastErr;
}

/**
 * Convert a PDF to a temporary Google Doc and return its text.
 * Supports BOTH Drive Advanced Service versions:
 *   v3 -> Drive.Files.create({name, mimeType}, blob)              (current)
 *   v2 -> Drive.Files.insert({title, mimeType}, blob, {convert})  (deprecated)
 */
function extractTextFromPdfByConvertingToGoogleDoc_(pdfBlob, originalFileName) {
  const tempName = 'TEMP_BBL_ETAX_' + new Date().getTime() + '_' + sanitizeFileName_(originalFileName);
  let tempDocId = '';
  try {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw new Error('Advanced Drive Service not enabled. Editor -> Services (+) -> add "Drive API".');
    }
    let file;
    if (typeof Drive.Files.create === 'function') {
      file = Drive.Files.create({ name: tempName, mimeType: MimeType.GOOGLE_DOCS }, pdfBlob);
    } else if (typeof Drive.Files.insert === 'function') {
      file = Drive.Files.insert({ title: tempName, mimeType: MimeType.GOOGLE_DOCS }, pdfBlob, { convert: true });
    } else {
      throw new Error('Neither Drive.Files.create (v3) nor Drive.Files.insert (v2) is available.');
    }
    tempDocId = file.id;
    const text = DocumentApp.openById(tempDocId).getBody().getText() || '';
    DriveApp.getFileById(tempDocId).setTrashed(true);
    if (!text || text.length < 50) throw new Error('Converted document is empty/too short - PDF may be image-only.');
    return text;
  } catch (err) {
    if (tempDocId) { try { DriveApp.getFileById(tempDocId).setTrashed(true); } catch (e) {} }
    throw new Error('PDF->Doc conversion failed: ' + err.message);
  }
}


/************************************************************
 * 3. QUERYBUILDER
 * source -> query. Pure, idempotent, no Gmail/Drive.
 * - recomputes BC / expense / DATABASE from MERCHANT_ID via the index
 * - optional PROCESS DATE range filter
 * - deduplicates by TAX INVOICE NO (keeps the newest occurrence)
 ************************************************************/

function rebuildQuerySheet() { return rebuildQueryCore_(null, null); }

function rebuildQueryCore_(filterStart, filterEnd) {
  const sourceSheet = ensureSourceSheet_();
  const querySheet = ensureQuerySheet_();

  querySheet.clear();
  querySheet.getRange(1, 1, 1, CONFIG.QUERY_HEADERS.length).setValues([CONFIG.QUERY_HEADERS]);

  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) { formatQuerySheet_(querySheet); return 0; }

  const lastCol = CONFIG.SOURCE_HEADERS.length;
  const values = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const display = sourceSheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const items = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const disp = display[i];

    const processDateDisplay = disp[6];      // G PROCESS_DATE
    if (!processDateDisplay) continue;

    const procDate = parseDateForSort_(row[6], processDateDisplay);
    if (!withinRange_(procDate, filterStart, filterEnd)) continue;

    const merchantId = row[4];                // E - trusted key
    const taxInvoiceNo = row[5];              // F
    const totalAmt = row[7], totalFee = row[8], vat7 = row[9], netCredit = row[10];

    const bcCode = mapMerchantIdToBCCode_(merchantId);
    const expense = round2_(toNumber_(totalFee) + toNumber_(vat7));
    const database = mapMerchantIdToDatabase_(merchantId);

    if (!bcCode) {
      logDebug_('WARN', 'No index mapping for merchant',
        String(merchantId) + ' (invoice ' + String(taxInvoiceNo) + '). Run INDEX - Build / Refresh.');
    }

    items.push({
      sortDate: procDate,
      sortEmailDate: parseDateForSort_(row[1], disp[1]),
      row: [processDateDisplay, taxInvoiceNo, totalAmt, totalFee, vat7, netCredit, expense, bcCode, database]
    });
  }

  items.sort((a, b) => {
    const da = a.sortDate ? a.sortDate.getTime() : 0;
    const db = b.sortDate ? b.sortDate.getTime() : 0;
    if (db !== da) return db - da;
    const ea = a.sortEmailDate ? a.sortEmailDate.getTime() : 0;
    const eb = b.sortEmailDate ? b.sortEmailDate.getTime() : 0;
    return eb - ea;
  });

  // Deduplicate by TAX INVOICE NO (col B). Newest-first sort means the kept
  // occurrence is the most recent. Blank invoice numbers are never collapsed.
  const seenInvoice = new Set();
  let dupRemoved = 0;
  const finalRows = [];
  items.forEach(it => {
    const key = String(it.row[1] || '').trim();
    if (key && seenInvoice.has(key)) { dupRemoved++; return; }
    if (key) seenInvoice.add(key);
    finalRows.push(it.row);
  });
  if (dupRemoved) logDebug_('INFO', 'Query dedupe', 'Removed ' + dupRemoved + ' duplicate invoice row(s).');

  if (finalRows.length > 0) {
    querySheet.getRange(2, 1, finalRows.length, CONFIG.QUERY_HEADERS.length).setValues(finalRows);
  }

  formatQuerySheet_(querySheet);
  setProp_('LAST_QUERY_AT', formatNow_());
  setProp_('LAST_QUERY_INFO', finalRows.length + ' records' +
    (dupRemoved ? ', ' + dupRemoved + ' duplicates removed' : '') +
    (filterStart || filterEnd ? ' (date-filtered)' : ' (all)'));

  SpreadsheetApp.getActive().toast('Rebuilt query sheet: ' + finalRows.length + ' record(s)' +
    (dupRemoved ? ', removed ' + dupRemoved + ' duplicate(s)' : ''));
  return finalRows.length;
}


/************************************************************
 * 4. MAPPING - `index` sheet is the source of truth, by MERCHANT_ID.
 * (BRANCH_NAME cannot be the key: "PHITSANULOK TEERAWAT CO.,LTD."
 *  exists under two merchants -> A5 and A6.)
 ************************************************************/

var MAPPING_CACHE_ = { indexMap: null };

// Fallback only - used when the index sheet lacks a row / cell.
var MERCHANT_TO_BC_FALLBACK_ = {
  '200206587065': 'A1',
  '200206578957': 'A4',
  '200206587107': 'A5',
  '200206578999': 'A6'
};

function mapMerchantIdToBCCode_(merchantId) {
  const id = String(merchantId || '').trim();
  if (!id) return '';
  const e = loadIndexMap_()[id];
  if (e && e.bc) return e.bc;
  return MERCHANT_TO_BC_FALLBACK_[id] || '';
}

function mapMerchantIdToDatabase_(merchantId) {
  const id = String(merchantId || '').trim();
  if (!id) return '';
  const e = loadIndexMap_()[id];
  if (e && e.database) return e.database;
  return databaseFromBC_(mapMerchantIdToBCCode_(id));
}

function databaseFromBC_(bcCode) {
  const code = String(bcCode || '').trim();
  if (code === 'A1' || code === 'A4') return 'oil1';
  if (code === 'A5' || code === 'A6') return 'oil5';
  return '';
}

function loadIndexMap_() {
  if (MAPPING_CACHE_.indexMap) return MAPPING_CACHE_.indexMap;
  MAPPING_CACHE_.indexMap = readExistingIndex_();
  return MAPPING_CACHE_.indexMap;
}

/** Reads old or new index layout. Returns { merchantId: {bc,database,branch,note} } */
function readExistingIndex_() {
  const out = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INDEX_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return out;

  const data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const header = data[0].map(h => String(h || '').trim());
  const find = preds => header.findIndex(h => preds.some(p => h.indexOf(p) !== -1));

  let cMerchant = find(['MERCHANT_ID', 'MERCHANT']);
  let cBC       = find(['รหัสสาขา BC', 'BC', 'เจ้าของ']);
  let cDB       = find(['DATABASE']);
  let cBranch   = find(['BRANCH_NAME', 'ชื่อร้าน']);
  let cNote     = find(['หมายเหตุ', 'NOTE']);
  if (cMerchant === -1) cMerchant = 1;
  if (cBC === -1) cBC = 2;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const merchant = String(r[cMerchant] || '').trim();
    if (!merchant) continue;
    out[merchant] = {
      bc:       cBC     > -1 ? String(r[cBC] || '').trim()     : '',
      database: cDB     > -1 ? String(r[cDB] || '').trim()     : '',
      branch:   cBranch > -1 ? String(r[cBranch] || '').trim() : '',
      note:     cNote   > -1 ? String(r[cNote] || '').trim()   : ''
    };
  }
  return out;
}

function buildIndexSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = readExistingIndex_();

  const branchByMerchant = {};
  const src = ss.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
  if (src && src.getLastRow() > 1) {
    const vals = src.getRange(2, 1, src.getLastRow() - 1, CONFIG.SOURCE_HEADERS.length).getValues();
    vals.forEach(r => {
      const merchant = String(r[4] || '').trim();
      const branch = String(r[3] || '').trim();
      if (merchant && branch) branchByMerchant[merchant] = branch;
    });
  }

  const ids = new Set(
    Object.keys(existing)
      .concat(Object.keys(branchByMerchant))
      .concat(Object.keys(MERCHANT_TO_BC_FALLBACK_))
  );

  const rows = [];
  let seq = 1;
  Array.from(ids).sort().forEach(id => {
    const ex = existing[id] || {};
    const bc = ex.bc || MERCHANT_TO_BC_FALLBACK_[id] || '';
    const database = ex.database || databaseFromBC_(bc) || '';
    const branch = branchByMerchant[id] || ex.branch || '';
    rows.push([seq++, id, bc, database, branch, ex.note || '']);
  });

  const sheet = ss.getSheetByName(CONFIG.INDEX_SHEET_NAME) || ss.insertSheet(CONFIG.INDEX_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, CONFIG.INDEX_HEADERS.length).setValues([CONFIG.INDEX_HEADERS]);
  if (rows.length) sheet.getRange(2, 1, rows.length, CONFIG.INDEX_HEADERS.length).setValues(rows);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CONFIG.INDEX_HEADERS.length)
    .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sheet.getRange(1, 2, Math.max(sheet.getMaxRows(), 1), 1).setNumberFormat('@');
  sheet.autoResizeColumns(1, CONFIG.INDEX_HEADERS.length);

  MAPPING_CACHE_.indexMap = null;

  const blanks = rows.filter(r => !r[2] || !r[3]).length;
  const msg = 'Index rebuilt: ' + rows.length + ' merchants' +
    (blanks ? ' (' + blanks + ' need BC/DATABASE filled in)' : '') + '.';
  SpreadsheetApp.getActive().toast(msg);
  return msg;
}


/************************************************************
 * 5. LIB - sheets, parsers, dup keys, debug, props, utils
 ************************************************************/

function ensureSourceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SOURCE_SHEET_NAME) || ss.insertSheet(CONFIG.SOURCE_SHEET_NAME);
  sheet.getRange(1, 1, 1, CONFIG.SOURCE_HEADERS.length).setValues([CONFIG.SOURCE_HEADERS]);
  formatSourceSheet_(sheet);
  return sheet;
}

function ensureQuerySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CONFIG.QUERY_SHEET_NAME) || ss.insertSheet(CONFIG.QUERY_SHEET_NAME);
}

function ensureIndexSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.INDEX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.INDEX_SHEET_NAME);
    sheet.getRange(1, 1, 1, CONFIG.INDEX_HEADERS.length).setValues([CONFIG.INDEX_HEADERS]);
    sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensurePdfFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.PDF_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.PDF_FOLDER_NAME);
}

function appendSourceRows_(sheet, rows) {
  if (!rows || rows.length === 0) return;
  formatPlainTextColumns_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CONFIG.SOURCE_HEADERS.length).setValues(rows);
}

function formatSourceSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CONFIG.SOURCE_HEADERS.length)
    .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setWrap(true);
  formatPlainTextColumns_(sheet);
  if (sheet.getLastRow() > 1) {
    const n = sheet.getLastRow() - 1;
    sheet.getRange(2, 2, n, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');  // B EMAIL_DATE
    sheet.getRange(2, 8, n, 5).setNumberFormat('#,##0.00');             // H..L
    sheet.getRange(2, 15, n, 1).setNumberFormat('#,##0.00');            // O ค่าใช้จ่าย
  }
  sheet.autoResizeColumns(1, CONFIG.SOURCE_HEADERS.length);
}

function formatQuerySheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CONFIG.QUERY_HEADERS.length)
    .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setWrap(true);
  if (sheet.getLastRow() > 1) {
    const n = sheet.getLastRow() - 1;
    sheet.getRange(2, 1, n, 2).setNumberFormat('@');        // A,B text
    sheet.getRange(2, 3, n, 5).setNumberFormat('#,##0.00'); // C..G numeric
    sheet.getRange(2, 8, n, 2).setNumberFormat('@');        // H,I text
  }
  sheet.autoResizeColumns(1, CONFIG.QUERY_HEADERS.length);
}

function formatPlainTextColumns_(sheet) {
  // text columns: A msg, C reportdate, D branch, E merchant, F invoice,
  // G processdate, M pdflink, N BC, P database, Q status
  [1, 3, 4, 5, 6, 7, 13, 14, 16, 17].forEach(col => {
    sheet.getRange(1, col, Math.max(sheet.getMaxRows(), 1), 1).setNumberFormat('@');
  });
}


/* ---------- PDF parsers ---------- */

function parseBangkokBankPdf_(text) {
  const rawText = String(text || '');
  const normalized = normalizePdfText_(rawText);
  const lines = rawText.split(/\r?\n/).map(cleanLine_).filter(l => l !== '');

  const branchName = extractBranchName_(rawText, lines);
  const taxInvoiceNo = extractTaxInvoiceNo_(normalized);
  const processDate = extractProcessDate_(normalized);
  const m = extractMerchantAndAmounts_(normalized);

  // WHT 3% is charged on the fee; computing beats scraping mangled glyphs.
  const wht3 = round2_(toNumber_(m.totalFee) * 0.03);

  return {
    branchName: branchName,
    merchantId: m.merchantId,
    taxInvoiceNo: taxInvoiceNo,
    processDate: processDate,
    totalAmt: m.totalAmt,
    totalFee: m.totalFee,
    vat7: m.vat7,
    netCreditAmt: m.netCreditAmt,
    wht3: wht3
  };
}

function extractBranchName_(rawText, lines) {
  for (const line of lines) {
    const candidate = cleanBranchCandidate_(line);
    if (/CO\.,?\s*LTD\.?|COMPANY\s+LIMITED|LTD\.?/i.test(candidate) && !/Bangkok Bank/i.test(candidate)) {
      return candidate;
    }
  }
  const text = normalizeText_(rawText);
  const match = text.match(/ใบเสร็จรับเงิน\/ใบ[กํำ]กับภาษี\s*([\s\S]{0,300})/i);
  if (match && match[1]) {
    const seg = match[1].split(/\r?\n/).map(cleanBranchCandidate_).filter(l => l !== '');
    for (const c of seg) {
      if (c && c.indexOf('ที่อยู่') === -1 && c.indexOf('ที่อยู') === -1 &&
          c.indexOf('วันที่') === -1 && c.indexOf('เลขที่') === -1 &&
          c.indexOf('หน้า') === -1 && c.indexOf('ชื่อ') === -1) {
        return c;
      }
    }
  }
  return '';
}

function cleanBranchCandidate_(text) {
  return cleanLine_(text)
    .replace(/^ชื่อ\s*[:：]\s*หน้า\s*[:：]\s*\d+\s*\/\s*\d+\s*/i, '')
    .replace(/^ชื่อ\s*[:：]\s*/i, '')
    .replace(/^หน้า\s*[:：]\s*\d+\s*\/\s*\d+\s*/i, '')
    .trim();
}

function extractTaxInvoiceNo_(t) {
  return extractByRegex_(t, /เลขที่\s*[:：]?\s*([0-9]{5}-[0-9]{2}-[0-9]{5})/i);
}

function extractProcessDate_(t) {
  return convertThaiYearToAD_(extractByRegex_(t, /วันที่\s*[:：]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
}

function extractMerchantAndAmounts_(t) {
  const amt = '([0-9]{1,3}(?:,[0-9]{3})*\\.\\d{2}|[0-9]+\\.\\d{2})';
  const regex = new RegExp('\\b(\\d{10,15})\\s+' + amt + '\\s+' + amt + '\\s+' + amt + '\\s+' + amt, 'i');
  const m = t.match(regex);
  if (!m) return { merchantId: '', totalAmt: '', totalFee: '', vat7: '', netCreditAmt: '' };
  return {
    merchantId: m[1],
    totalAmt: toNumber_(m[2]),
    totalFee: toNumber_(m[3]),
    vat7: toNumber_(m[4]),
    netCreditAmt: toNumber_(m[5])
  };
}

function parseDataFromFileName_(fileName) {
  const m = String(fileName || '').match(/BBLETAXACQ_(\d{10,15})_(\d{8})_([0-9]{5}-[0-9]{2}-[0-9]{5})/i);
  if (!m) return { merchantId: '', processDate: '', taxInvoiceNo: '' };
  return { merchantId: m[1], processDate: convertYYYYMMDDToDDMMYYYY_(m[2]), taxInvoiceNo: m[3] };
}

function isPdfAttachment_(fileName, contentType) {
  const name = String(fileName || '').toLowerCase();
  return name.endsWith('.pdf') || String(contentType || '').toLowerCase().indexOf('pdf') !== -1;
}


/* ---------- duplicate keys ---------- */

function getExistingKeys_(sheet) {
  const keys = new Set();
  if (sheet.getLastRow() < 2) return keys;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.SOURCE_HEADERS.length).getValues();
  values.forEach(row => {
    if (row[0] && row[4] && row[5]) keys.add(makeDuplicateKey_(row[0], row[4], row[5]));
  });
  return keys;
}

function makeDuplicateKey_(gmailMessageId, merchantId, taxInvoiceNo) {
  return [String(gmailMessageId || '').trim(), String(merchantId || '').trim(), String(taxInvoiceNo || '').trim()].join('|');
}


/* ---------- debug + properties ---------- */

function ensureDebugSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.DEBUG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DEBUG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Level', 'Message', 'Reference']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

function logDebug_(level, message, reference) {
  try { ensureDebugSheet_().appendRow([new Date(), level, message, reference]); }
  catch (err) { console.log(level + ' | ' + message + ' | ' + reference); }
}

function setProp_(key, value) {
  try { PropertiesService.getDocumentProperties().setProperty('BBL_' + key, String(value)); } catch (e) {}
}

function getProp_(key) {
  try { return PropertiesService.getDocumentProperties().getProperty('BBL_' + key) || ''; } catch (e) { return ''; }
}

function formatNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
}


/* ---------- speed control ---------- */

function shouldStop_(startedAt, pdfConverted) {
  if (Date.now() - startedAt > CONFIG.MAX_RUNTIME_MS) return true;
  if (pdfConverted >= CONFIG.MAX_NEW_PDF_PER_RUN) return true;
  return false;
}


/* ---------- generic utils ---------- */

function getEmailAddressOnly_(fromText) {
  const text = String(fromText || '').trim();
  const m = text.match(/<([^>]+)>/);
  return m && m[1] ? m[1].trim().toLowerCase() : text.replace(/"/g, '').trim().toLowerCase();
}

function formatGmailDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy/MM/dd');
}

function convertThaiYearToAD_(dateText) {
  if (!dateText) return '';
  const m = String(dateText).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return dateText;
  let year = Number(m[3]);
  if (year > 2400) year -= 543;
  return pad2_(Number(m[1])) + '/' + pad2_(Number(m[2])) + '/' + year;
}

function convertYYYYMMDDToDDMMYYYY_(value) {
  const t = String(value || '');
  if (!/^\d{8}$/.test(t)) return '';
  return t.substring(6, 8) + '/' + t.substring(4, 6) + '/' + t.substring(0, 4);
}

function parseDateForSort_(value, displayValue) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return value;
  const text = String(displayValue || value || '').trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) { const d = new Date(text); return isNaN(d) ? null : d; }
  let year = Number(m[3]);
  if (year > 2400) year -= 543;
  return new Date(year, Number(m[2]) - 1, Number(m[1]));
}

function parseInputDate_(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateKeyInt_(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function withinRange_(d, start, end) {
  if (!start && !end) return !!d || true;
  if (!d) return false;
  const k = dateKeyInt_(d);
  if (start && k < dateKeyInt_(start)) return false;
  if (end && k > dateKeyInt_(end)) return false;
  return true;
}

function extractByRegex_(text, regex) {
  const m = String(text || '').match(regex);
  return (m && m[1]) ? cleanLine_(m[1]) : '';
}

function normalizeText_(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
}

function normalizePdfText_(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
}

function cleanLine_(text) {
  return String(text || '').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ').trim();
}

function toNumber_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function round2_(number) { return Math.round(Number(number || 0) * 100) / 100; }
function pad2_(number) { return ('0' + Number(number)).slice(-2); }
function sanitizeFileName_(name) {
  return String(name || 'file.pdf').replace(/[\\\/\?\%\*\:\|\"\<\>]/g, '_').substring(0, 180);
}


/************************************************************
 * 6. CONSOLE - unified tabbed dialog (Scrape / Query / Status)
 ************************************************************/

function showConsole() {
  const html = HtmlService.createHtmlOutput(consoleHtml_()).setWidth(520).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'BBL eTax Console');
}

// Aliases so previously-assigned drawing buttons keep working.
function showScrapeConsole() { showConsole(); }
function showQueryConsole() { showConsole(); }

/** Server call: scrape by email-received date range ('YYYY-MM-DD'). */
function scrapeByDateRange(startStr, endStr) {
  const start = parseInputDate_(startStr);
  const end = parseInputDate_(endStr);
  if (!start || !end) throw new Error('Please choose both a start and an end date.');
  if (start.getTime() > end.getTime()) throw new Error('Start date must be on or before the end date.');
  // Gmail "before:" is exclusive, so include the chosen end day.
  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  return scrapeBBLETax_({ startDate: start, endDate: endExclusive, mode: 'CONSOLE_RANGE' });
}

/** Server call: rebuild query filtered by PROCESS DATE range. Blank = open-ended. */
function rebuildQueryByDateRange(startStr, endStr) {
  const start = parseInputDate_(startStr);
  const end = parseInputDate_(endStr);
  if (start && end && start.getTime() > end.getTime()) {
    throw new Error('Start date must be on or before the end date.');
  }
  const n = rebuildQueryCore_(start, end);
  return 'Query rebuilt: ' + n + ' record(s) with PROCESS DATE from ' +
    (startStr || 'beginning') + ' to ' + (endStr || 'today') + '.';
}

/** Server call: live status for the Status tab. */
function getConsoleStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
  const qry = ss.getSheetByName(CONFIG.QUERY_SHEET_NAME);
  const dbg = ss.getSheetByName(CONFIG.DEBUG_SHEET_NAME);

  const sourceRows = src ? Math.max(src.getLastRow() - 1, 0) : 0;
  const queryRows = qry ? Math.max(qry.getLastRow() - 1, 0) : 0;

  // Merchants present in source but unmapped in index.
  const unmapped = [];
  if (src && src.getLastRow() > 1) {
    const ids = new Set();
    src.getRange(2, 5, src.getLastRow() - 1, 1).getValues().forEach(r => {
      const id = String(r[0] || '').trim();
      if (id) ids.add(id);
    });
    ids.forEach(id => { if (!mapMerchantIdToBCCode_(id)) unmapped.push(id); });
  }

  // Last few WARN/ERROR entries from the debug sheet.
  const recentIssues = [];
  if (dbg && dbg.getLastRow() > 1) {
    const n = dbg.getLastRow() - 1;
    const take = Math.min(n, 200);
    const vals = dbg.getRange(dbg.getLastRow() - take + 1, 1, take, 4).getValues();
    const tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
    for (let i = vals.length - 1; i >= 0 && recentIssues.length < 5; i--) {
      const lvl = String(vals[i][1] || '');
      if (lvl === 'ERROR' || lvl === 'WARN') {
        let when = '';
        try { when = Utilities.formatDate(new Date(vals[i][0]), tz, 'dd/MM HH:mm'); } catch (e) {}
        recentIssues.push('[' + lvl + ' ' + when + '] ' + vals[i][2] + ' — ' + vals[i][3]);
      }
    }
  }

  return {
    sourceRows: sourceRows,
    queryRows: queryRows,
    lastScrapeAt: getProp_('LAST_SCRAPE_AT'),
    lastScrapeInfo: getProp_('LAST_SCRAPE_INFO'),
    lastQueryAt: getProp_('LAST_QUERY_AT'),
    lastQueryInfo: getProp_('LAST_QUERY_INFO'),
    unmapped: unmapped,
    recentIssues: recentIssues
  };
}


/* ---------- console HTML ---------- */

function consoleHtml_() {
  const css = `
    *{box-sizing:border-box;}
    body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:0;color:#202124;background:#fff;}
    .tabs{display:flex;border-bottom:2px solid #e8eaed;background:#f8f9fa;}
    .tab{flex:1;padding:12px 0;text-align:center;font-size:13px;font-weight:bold;color:#5f6368;cursor:pointer;border-bottom:3px solid transparent;}
    .tab.active{color:#1a73e8;border-bottom-color:#1a73e8;background:#fff;}
    .panel{display:none;padding:18px;}
    .panel.active{display:block;}
    h3{margin:0 0 4px;font-size:15px;color:#1a73e8;}
    p.sub{margin:0 0 12px;font-size:12px;color:#5f6368;line-height:1.45;}
    label{display:block;font-size:12px;font-weight:bold;margin:8px 0 4px;}
    input[type=date]{width:100%;padding:8px;font-size:14px;border:1px solid #dadce0;border-radius:6px;}
    .row{display:flex;gap:12px;}
    .row>div{flex:1;}
    .chips{margin:10px 0 2px;display:flex;flex-wrap:wrap;gap:6px;}
    .chip{font-size:11px;padding:5px 10px;border:1px solid #dadce0;border-radius:14px;background:#f8f9fa;cursor:pointer;}
    .chip:hover{background:#e8f0fe;border-color:#1a73e8;color:#1a73e8;}
    button.go{margin-top:14px;width:100%;padding:11px;font-size:14px;font-weight:bold;color:#fff;background:#1a73e8;border:0;border-radius:6px;cursor:pointer;}
    button.go:disabled{background:#9bbcf0;cursor:default;}
    .status{margin-top:12px;font-size:12px;line-height:1.5;white-space:pre-wrap;min-height:18px;}
    .ok{color:#188038;} .err{color:#d93025;} .busy{color:#5f6368;}
    .hint{font-size:11px;color:#5f6368;margin-top:6px;}
    .stat{display:flex;justify-content:space-between;font-size:12px;padding:7px 2px;border-bottom:1px solid #f1f3f4;}
    .stat b{color:#202124;}
    .issues{font-size:11px;color:#b06000;margin-top:10px;line-height:1.5;white-space:pre-wrap;}
    .unmapped{font-size:11px;color:#d93025;margin-top:10px;line-height:1.5;}
    .refresh{font-size:11px;color:#1a73e8;cursor:pointer;text-decoration:underline;margin-top:10px;display:inline-block;}
  `;

  // Client script: deliberately uses string concatenation only (no template
  // literal interpolation) so nothing is evaluated server-side by accident.
  const js = `
    function pad(n){return (n<10?'0':'')+n;}
    function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
    function $(id){return document.getElementById(id);}
    function setStatus(id,t,cls){var el=$(id);el.textContent=t;el.className='status '+(cls||'');}

    function showTab(name){
      var tabs=['scrape','query','status'];
      for(var i=0;i<tabs.length;i++){
        $('tab-'+tabs[i]).className='tab'+(tabs[i]===name?' active':'');
        $('panel-'+tabs[i]).className='panel'+(tabs[i]===name?' active':'');
      }
      if(name==='status') loadStatus();
    }

    function setRange(prefix,start,end){
      $(prefix+'-start').value=start?iso(start):'';
      $(prefix+'-end').value=end?iso(end):'';
    }
    function pickYesterday(p){var d=new Date();d.setDate(d.getDate()-1);setRange(p,d,d);}
    function pickDays(p,n){var e=new Date();var s=new Date();s.setDate(e.getDate()-n);setRange(p,s,e);}
    function pickThisMonth(p){var t=new Date();setRange(p,new Date(t.getFullYear(),t.getMonth(),1),t);}
    function pickLastMonth(p){var t=new Date();var s=new Date(t.getFullYear(),t.getMonth()-1,1);var e=new Date(t.getFullYear(),t.getMonth(),0);setRange(p,s,e);}
    function pickThisYear(p){var t=new Date();setRange(p,new Date(t.getFullYear(),0,1),t);}
    function pickAll(p){setRange(p,null,null);}

    function runScrape(){
      var s=$('scrape-start').value, e=$('scrape-end').value;
      if(!s||!e){setStatus('scrape-status','Please choose both dates.','err');return;}
      $('scrape-go').disabled=true;
      setStatus('scrape-status','Scraping Gmail… keep this window open. Large ranges run in 20-PDF batches; run again if it says "stopped by limit".','busy');
      google.script.run
        .withSuccessHandler(function(msg){$('scrape-go').disabled=false;setStatus('scrape-status',msg,'ok');})
        .withFailureHandler(function(err){$('scrape-go').disabled=false;setStatus('scrape-status','Error: '+err.message,'err');})
        .scrapeByDateRange(s,e);
    }

    function runQuery(){
      var s=$('query-start').value, e=$('query-end').value;
      $('query-go').disabled=true;
      setStatus('query-status','Rebuilding query sheet…','busy');
      google.script.run
        .withSuccessHandler(function(msg){$('query-go').disabled=false;setStatus('query-status',msg,'ok');})
        .withFailureHandler(function(err){$('query-go').disabled=false;setStatus('query-status','Error: '+err.message,'err');})
        .rebuildQueryByDateRange(s,e);
    }

    function loadStatus(){
      $('st-body').style.opacity='0.4';
      google.script.run
        .withSuccessHandler(function(st){
          $('st-body').style.opacity='1';
          $('st-source').textContent=st.sourceRows;
          $('st-query').textContent=st.queryRows;
          $('st-lscrape').textContent=(st.lastScrapeAt||'never')+(st.lastScrapeInfo?' — '+st.lastScrapeInfo:'');
          $('st-lquery').textContent=(st.lastQueryAt||'never')+(st.lastQueryInfo?' — '+st.lastQueryInfo:'');
          $('st-unmapped').textContent=st.unmapped.length
            ? ('⚠ Unmapped merchants (fill in the index sheet): '+st.unmapped.join(', '))
            : '';
          $('st-issues').textContent=st.recentIssues.length
            ? ('Recent warnings/errors:\\n'+st.recentIssues.join('\\n'))
            : 'No recent warnings or errors. ✓';
        })
        .withFailureHandler(function(err){
          $('st-body').style.opacity='1';
          $('st-issues').textContent='Could not load status: '+err.message;
        })
        .getConsoleStatus();
    }

    window.onload=function(){
      pickDays('scrape',30);
      pickThisMonth('query');
    };
  `;

  return `<!DOCTYPE html><html><head><base target="_top"><style>${css}</style></head>
<body>
  <div class="tabs">
    <div class="tab active" id="tab-scrape" onclick="showTab('scrape')">📥 Scrape</div>
    <div class="tab" id="tab-query" onclick="showTab('query')">🔁 Query</div>
    <div class="tab" id="tab-status" onclick="showTab('status')">📊 Status</div>
  </div>

  <div class="panel active" id="panel-scrape">
    <h3>Scrape e-Tax Invoices from Gmail</h3>
    <p class="sub">Pulls Bangkok Bank e-Tax PDFs for the chosen <b>email received date</b> range into the source sheet. Each invoice is identity-checked (filename vs PDF must match) and amount-validated. Duplicates are skipped.</p>
    <div class="chips">
      <span class="chip" onclick="pickYesterday('scrape')">Yesterday</span>
      <span class="chip" onclick="pickDays('scrape',7)">Last 7 days</span>
      <span class="chip" onclick="pickDays('scrape',30)">Last 30 days</span>
      <span class="chip" onclick="pickThisMonth('scrape')">This month</span>
      <span class="chip" onclick="pickLastMonth('scrape')">Last month</span>
    </div>
    <div class="row">
      <div><label>Start date</label><input type="date" id="scrape-start"></div>
      <div><label>End date</label><input type="date" id="scrape-end"></div>
    </div>
    <button class="go" id="scrape-go" onclick="runScrape()">Run Scrape</button>
    <div class="status" id="scrape-status"></div>
    <div class="hint">Tip: invoices carry the previous day's PROCESS DATE, so scrape one day wider than the invoice dates you need.</div>
  </div>

  <div class="panel" id="panel-query">
    <h3>Rebuild Query Sheet</h3>
    <p class="sub">Rebuilds the <b>query</b> sheet from the source sheet, keeping rows whose <b>PROCESS DATE</b> falls in the range. Duplicate invoice numbers are removed automatically. No Gmail access.</p>
    <div class="chips">
      <span class="chip" onclick="pickThisMonth('query')">This month</span>
      <span class="chip" onclick="pickLastMonth('query')">Last month</span>
      <span class="chip" onclick="pickThisYear('query')">This year</span>
      <span class="chip" onclick="pickAll('query')">All records</span>
    </div>
    <div class="row">
      <div><label>From PROCESS DATE</label><input type="date" id="query-start"></div>
      <div><label>To PROCESS DATE</label><input type="date" id="query-end"></div>
    </div>
    <div class="hint">Leave a field blank for no limit on that side (blank–blank = everything).</div>
    <button class="go" id="query-go" onclick="runQuery()">Rebuild Query</button>
    <div class="status" id="query-status"></div>
  </div>

  <div class="panel" id="panel-status">
    <h3>System Status</h3>
    <div id="st-body">
      <div class="stat"><span>Source rows (invoices stored)</span><b id="st-source">…</b></div>
      <div class="stat"><span>Query rows (current view)</span><b id="st-query">…</b></div>
      <div class="stat"><span>Last scrape</span><b id="st-lscrape">…</b></div>
      <div class="stat"><span>Last query rebuild</span><b id="st-lquery">…</b></div>
      <div class="unmapped" id="st-unmapped"></div>
      <div class="issues" id="st-issues">Loading…</div>
    </div>
    <span class="refresh" onclick="loadStatus()">↻ Refresh</span>
  </div>

<script>${js}</script>
</body></html>`;
}