/************************************************************
 * K-Merchant CSV Extractor (AMZ SUBJECT FILTER VERSION)
 * v2 — เปลี่ยนคีย์กันซ้ำจาก TAX อย่างเดียว เป็น MERCHANT_ID + TAX
 *      (แก้ 3 จุด: existingTax, จุดเช็ค/เพิ่มคีย์ในลูป, เพิ่ม getPairSet_)
 ************************************************************/

const CONFIG = {
  SHEET_NAME: 'K_Merchant_CSV_Data',
  NOTIFY_EMAIL: 'ac@tgrhotel.com',

  GMAIL_FROM: 'K-Merchant_report@kasikornbank.com',
  SUBJECT_KEYWORD: 'K-Merchant Reports',
  SUBJECT_FILTER: 'AMZ', // 🔥 สำคัญ

  HEADER: [
    'GMAIL_MESSAGE_ID',
    'EMAIL_DATE',
    'REPORT_DATE',
    'BRANCH_NAME',
    'MERCHANT_ID',
    'TAX INVOICE NO',
    'PROCESS DATE',
    'TOTAL AMT',
    'TOTAL FEE/COMMISSION AMOUNT',
    'VAT 7%',
    'NET CREDIT AMT',
    'VAT CODE'
  ]
};

/** ================= MAIN ================= */

// 🔥 ดึงย้อนหลัง 180 วัน
function runLast180Days() {
  const result = processEmails({ daysBack: 180 });
  sendSummaryEmail_(result, "RUN 180 DAYS");
}

// daily run
function runDaily() {
  const result = processEmails({ daysBack: 1 });
  sendSummaryEmail_(result, "DAILY");
}

// test yesterday
function testYesterday() {
  const result = processEmails({ yesterday: true });
  sendSummaryEmail_(result, "TEST YESTERDAY");
}

// test email only
function testEmailOnly() {
  const result = processEmails({ yesterday: true, dryRun: true });
  sendSummaryEmail_(result, "TEST EMAIL ONLY");
}

// create trigger 23:00
function createTrigger() {
  deleteTriggers();

  ScriptApp.newTrigger("runDaily")
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();
}

/** ================= CORE ================= */

function processEmails(opt) {

  const sheet = getSheet_();
  const existingMsg = getSet_(sheet, 1);
  const processed = loadProcessedIds_();
  const existingTax = getPairSet_(sheet, 5, 6); // 🔑 MERCHANT_ID|TAX

  const query = buildQuery_(opt);
  const threads = GmailApp.search(query);

  let stats = {
    threads: threads.length,
    messages: 0,
    inserted: 0,
    skipNoAMZ: 0,
    skipTotal: 0,
    skipDupTax: 0,
    skipDupEmail: 0,
    skipNoCSV: 0
  };

  let rows = [];

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {

      stats.messages++;

      const id = msg.getId();
      if (existingMsg.has(id) || processed[id]) {
        stats.skipDupEmail++;
        return;
      }

      const subject = msg.getSubject();
      const from = msg.getFrom();

      if (!from.includes(CONFIG.GMAIL_FROM)) return;
      if (!subject.includes(CONFIG.SUBJECT_KEYWORD)) return;

      // 🔥 FILTER SUBJECT ต้องมี AMZ
      if (!subject.toUpperCase().includes(CONFIG.SUBJECT_FILTER)) {
        stats.skipNoAMZ++;
        return;
      }

      const attachments = msg.getAttachments();
      let hasCSV = false;

      attachments.forEach(att => {

        if (!att.getName().toLowerCase().endsWith(".zip")) return;

        const files = Utilities.unzip(att);

        files.forEach(f => {

          if (!f.getName().toLowerCase().endsWith(".csv")) return;

          hasCSV = true;

          const data = Utilities.parseCsv(f.getDataAsString());

          for (let i = 1; i < data.length; i++) {

            const r = data[i];
            const taxNo = clean_(r[3]);
            const merchantId = clean_(r[0]);

            // ❌ skip TOTAL
            if (taxNo.toUpperCase().includes("TOTAL")) {
              stats.skipTotal++;
              continue;
            }

            if (!taxNo || taxNo.length < 10) continue;

            const dupKey = merchantId + '|' + taxNo; // 🔑 MERCHANT_ID + TAX
            if (existingTax.has(dupKey)) {
              stats.skipDupTax++;
              continue;
            }

            existingTax.add(dupKey);

            rows.push([
              id,
              formatDate_(msg.getDate()),
              extractDate(subject),
              clean_(r[4]), // ✅ BRANCH จาก Excel
              merchantId,
              taxNo,
              clean_(r[6]),
              clean_(r[10]),
              clean_(r[13]),
              clean_(r[14]),
              clean_(r[16]),
              clean_(r[18])
            ]);

            stats.inserted++;
          }

        });

      });

      if (!hasCSV) stats.skipNoCSV++;

      existingMsg.add(id);
      processed[id] = Date.now();

    });
  });

  if (rows.length && !opt?.dryRun) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CONFIG.HEADER.length)
      .setValues(rows);
  }

  if (!opt?.dryRun) saveProcessedIds_(processed);   // โหมดซ้อมไม่ต้องจด

  return stats;
}

/** ================= HELPERS ================= */

/* ---------- PROCESSED-EMAIL LOG ----------
 * เดิมร่องรอยว่า "เมลฉบับนี้ทำแล้ว" มีที่เดียวคือคอลัมน์ GMAIL_MESSAGE_ID
 * ของแถวที่ถูกเพิ่มจริง เมลที่ทุกแถวโดนกันซ้ำจึงไม่เหลือร่องรอย แล้วถูก
 * โหลด + แตก ZIP + แกะ CSV ใหม่ทุกรอบตลอดไป (ฝั่ง OIL วัดได้ ~30 ฉบับ/รอบ)
 * จึงย้ายไปจดใน Script Properties แทน จดทุกฉบับไม่ว่าจะได้แถวหรือไม่
 * ตัดของเก่าทิ้งตามอายุ + จำกัดจำนวน กันชนเพดาน 9 KB ของ property
 */
const PROCESSED_PROP = 'PROCESSED_MSG_IDS';
const PROCESSED_KEEP_DAYS = 21;
const PROCESSED_MAX = 350;

function loadProcessedIds_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PROCESSED_PROP) || '';
    const cutoff = Date.now() - PROCESSED_KEEP_DAYS * 86400000;
    const map = {};
    raw.split(',').forEach(part => {
      const i = part.indexOf(':');
      if (i < 1) return;
      const id = part.slice(0, i), ts = Number(part.slice(i + 1));
      if (id && ts && ts >= cutoff) map[id] = ts;
    });
    return map;
  } catch (e) {
    return {};   // อ่านไม่ได้ต้องไม่ทำให้การดึงเมลล้ม
  }
}

function saveProcessedIds_(map) {
  try {
    const kept = Object.keys(map)
      .map(id => [id, map[id]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, PROCESSED_MAX);
    PropertiesService.getScriptProperties()
      .setProperty(PROCESSED_PROP, kept.map(e => e[0] + ':' + e[1]).join(','));
  } catch (e) { /* จดไม่ได้ต้องไม่ทำให้รอบนั้นล้ม */ }
}

/** ล้างบันทึก — ใช้เมื่อลบแถวในชีตแล้วอยากให้ระบบดึงกลับมาใหม่ (รันจากเอดิเตอร์) */
function clearProcessedIds() {
  PropertiesService.getScriptProperties().deleteProperty(PROCESSED_PROP);
  const msg = 'ล้างบันทึกเมลที่ประมวลผลแล้วเรียบร้อย — รอบถัดไปจะอ่านเมลใหม่ทั้งหมดในช่วงที่กำหนด';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* รันจากเอดิเตอร์อาจไม่มี UI */ }
}

function extractDate(s) {
  const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : '';
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
    sh.getRange(1, 1, 1, CONFIG.HEADER.length).setValues([CONFIG.HEADER]);
  }

  return sh;
}

// 🔑 v2: คีย์คู่ MERCHANT_ID(colA) + '|' + TAX(colB)
function getPairSet_(sheet, colA, colB) {
  const set = new Set();
  const last = sheet.getLastRow();

  if (last < 2) return set;

  const a = sheet.getRange(2, colA, last - 1, 1).getValues();
  const b = sheet.getRange(2, colB, last - 1, 1).getValues();

  for (let i = 0; i < a.length; i++) {
    const m = String(a[i][0] || '').trim();
    const t = String(b[i][0] || '').trim();
    if (t) set.add(m + '|' + t);
  }

  return set;
}

function getSet_(sheet, col) {
  const set = new Set();
  const last = sheet.getLastRow();

  if (last < 2) return set;

  const data = sheet.getRange(2, col, last - 1, 1).getValues();

  data.forEach(r => {
    if (r[0]) set.add(String(r[0]).trim());
  });

  return set;
}

function buildQuery_(opt) {
  let q = `from:${CONFIG.GMAIL_FROM} subject:"${CONFIG.SUBJECT_KEYWORD}" has:attachment`;

  if (opt?.yesterday) {
    const t = new Date();
    const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    q += ` after:${formatGmail_(y)} before:${formatGmail_(t)}`;
  } else {
    q += ` newer_than:${opt.daysBack || 1}d`;
  }

  return q;
}

function sendSummaryEmail_(stats, title) {

  let body = `
K-Merchant (${title})

Threads: ${stats.threads}
Messages: ${stats.messages}

Inserted: ${stats.inserted}

Skip Not AMZ: ${stats.skipNoAMZ}
Skip TOTAL: ${stats.skipTotal}
Skip Duplicate TAX: ${stats.skipDupTax}
Skip Duplicate Email: ${stats.skipDupEmail}
Skip No CSV: ${stats.skipNoCSV}

Time: ${new Date()}
`;

  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, "[K-Merchant] Amazon Report", body);
}

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}

function clean_(v) {
  return String(v || '').trim();
}

function formatDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function formatGmail_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}