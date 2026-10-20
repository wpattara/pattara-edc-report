/**
 * ระบบขึ้นเงินบัตรเครดิต EDC — Web App v2 (แหล่งข้อมูล: ชีต "ETAX EDC — MASTER")
 * ---------------------------------------------------------
 * v2.0.0 (20/10/2569) ย้ายแหล่งข้อมูลจากชีตธนาคาร 3 ใบ (ดึงจาก Gmail · คนละบัญชี)
 * มาอ่านชีต MASTER ใบเดียวของ gm@ ที่ระบบดาวน์โหลดใบกำกับภาษี (auto_download_etax) เขียนให้ทุกวัน
 *   · แท็บละธนาคาร (KBANK / TTB / KTB / BBL / KRUNGSRI …) คอลัมน์เดียวกันทุกแท็บ (หัวคอลัมน์แถว 1)
 *   · แอปนี้ "อ่านอย่างเดียว" — ไม่เขียนข้อมูลลงชีต (log การตั้งค่าลงแท็บซ่อนเท่านั้น)
 *   · ไม่มีปุ่ม Sync / endpoint / Index editor อีกแล้ว — ข้อมูลเข้าชีตจากเครื่องที่รันตัวโหลด
 *   · รหัสสาขา/กลุ่ม (branch_code / group_code) มาจากแท็บ MERCHANT_MAP ซึ่งแก้ที่แอปตัวโหลด (ETAX_APP_URL)
 *
 * วันที่: คอลัมน์ `date` ในชีตเป็นข้อความ dd-mm-yyyy ค.ศ. · `date_iso` เป็น yyyy-mm-dd
 *   → กรอง/เรียงด้วย `date_iso` (เทียบสตริง) · แสดงผล dd/MM/yyyy ค.ศ. ทั้งแอป · อ่านชีตด้วย getDisplayValues เท่านั้น
 * ค่าตั้งค่าทั้งหมดอยู่ Script Properties (ไม่มีค่าสำรองในโค้ด): MASTER_SS_ID · ETAX_APP_URL · APP_* · ADMIN_PIN · PORTAL_SSO_KEY
 * ---------------------------------------------------------
 */

var APP_VERSION = '2.0.0';       // X.Y.Z — X โครงสร้าง · Y ฟีเจอร์/requirement ใหม่ · Z แก้ย่อย
                                 // ขยับเลขที่นี่เท่านั้น วันที่ระบบ stamp ให้เองตอนเห็นเลขใหม่ครั้งแรก
var TZ = 'Asia/Bangkok';
var MAX_ROWS = 20000;            // เพดานแถวต่อการดึง 1 ครั้ง กันหน้าเว็บอืด
var PIN_DEFAULT = '123456';      // PIN ตั้งต้น — ใช้ตอนยังไม่เคยตั้ง และตอน resetAdminPin() เท่านั้น
var APP_NAME_DEFAULT = 'ระบบขึ้นเงินบัตรเครดิต EDC';
var PROP_SS = 'MASTER_SS_ID';
var PROP_ETAX = 'ETAX_APP_URL';
var LOG_SHEET = 'EDC_WEBAPP_LOG';   // แท็บซ่อนในชีต MASTER — log การตั้งค่าของแอปนี้เท่านั้น

/* คอลัมน์ของชีต MASTER (k = หัวคอลัมน์จริงในแถว 1 · หาตำแหน่งจากชื่อ ไม่ fix เลขคอลัมน์)
   เรียงตามลำดับที่อยากให้แสดง · tech = คอลัมน์เทคนิค ซ่อนเป็นค่าเริ่มต้น (ผู้ใช้ติ๊กเปิดได้) */
var COLS = [
  { k: 'date',          th: 'วันที่',               type: 'date' },
  { k: 'bank',          th: 'ธนาคาร' },
  { k: 'unit',          th: 'หน่วยงาน' },
  { k: 'invoice_no',    th: 'เลขที่ใบกำกับ' },
  { k: 'merchant_name', th: 'ชื่อร้าน' },
  { k: 'branch',        th: 'สาขาในใบ' },
  { k: 'merchant_id',   th: 'MERCHANT_ID' },
  { k: 'branch_code',   th: 'รหัสสาขา' },
  { k: 'group_code',    th: 'กลุ่ม' },
  { k: 'items',         th: 'รายการในใบ',           type: 'num' },
  { k: 'sales',         th: 'ยอดขาย',               type: 'money' },
  { k: 'fee',           th: 'ค่าธรรมเนียม',         type: 'money' },
  { k: 'vat',           th: 'VAT',                  type: 'money' },
  { k: 'fee_vat',       th: 'ค่าธรรมเนียม+VAT',     type: 'money' },
  { k: 'wht',           th: 'หัก ณ ที่จ่าย 3%',     type: 'money' },
  { k: 'wht_gov',       th: 'หัก 1% หน่วยงานรัฐ',  type: 'money' },
  { k: 'net',           th: 'เงินเข้าสุทธิ',        type: 'money' },
  { k: 'note',          th: 'หมายเหตุ' },
  { k: 'tax_id',        th: 'เลขผู้เสียภาษี',       tech: true },
  { k: 'account_no',    th: 'บัญชีรับเงิน',          tech: true },
  { k: 'month',         th: 'เดือน',                tech: true },
  { k: 'card_types',    th: 'ประเภทบัตร',           tech: true },
  { k: 'file',          th: 'ไฟล์',                 tech: true },
  { k: 'page',          th: 'หน้า',                 type: 'num', tech: true },
  { k: 'extracted_at',  th: 'อ่านเมื่อ',            tech: true },
  { k: 'machine',       th: 'เครื่อง',              tech: true }
];
var SUM_COLS = ['sales', 'fee_vat', 'wht', 'net'];   // การ์ดสรุป + แถวรวมในมุมมองสรุป

/* ====================== ป้ายเวอร์ชัน ====================== */

/* คืน 'v2.0.0 · 20.10.2026' — stamp วันที่ครั้งแรกที่เจอเลขเวอร์ชันใหม่ (ป้ายเวอร์ชันใช้ ค.ศ. dd.MM.yyyy ตามมาตรฐานกลุ่ม) */
function appVersionLabel_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('APP_VERSION') !== APP_VERSION) {
    p.setProperty('APP_VERSION', APP_VERSION);
    p.setProperty('APP_VERSION_DATE', Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy'));
  }
  var d = p.getProperty('APP_VERSION_DATE') || '';
  return 'v' + APP_VERSION + (d ? ' · ' + d : '');
}

/* ====================== ติดตั้งครั้งแรก (เจ้าของรันจาก editor 1 ครั้ง) ====================== */

/**
 * สคริปต์ใหม่ต้องให้บัญชีที่ deploy (gm@) อนุมัติสิทธิ์ก่อน ไม่งั้นลิงก์ /exec ตอบ 403 "ต้องมีสิทธิ์เข้าถึง" กับทุกคน
 * เปิด editor → เลือกฟังก์ชัน setup → เรียกใช้ → กดอนุญาต แล้วค่อยเปิดลิงก์แอป
 * ไม่เขียนอะไรนอกจาก stamp เวอร์ชัน/salt ของ PIN · ถ้าตั้งชีต MASTER แล้วจะลองเปิดให้ดูใน log
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('ป้ายเวอร์ชัน: ' + appVersionLabel_());
  adminSalt_(); adminPinHash_();
  Logger.log('PIN ผู้ดูแล: ' + (pinIsDefault_() ? 'ยังเป็นค่าเริ่มต้น ' + PIN_DEFAULT + ' — เข้าแอปแล้วเปลี่ยนที่ ตั้งค่าระบบ › เปลี่ยน PIN' : 'ตั้งแล้ว'));
  var id = props.getProperty(PROP_SS) || '';
  if (!id) { Logger.log('ยังไม่ได้ตั้งชีต MASTER — เข้าแอปด้วย PIN แล้วไปที่ ตั้งค่าระบบ › การเชื่อมต่อ วางลิงก์ชีต'); }
  else {
    var ss = masterSs_();
    Logger.log('ชีต MASTER: ' + ss.getName() + ' · แท็บธนาคาร ' + bankTabs_(ss).join(', ') + ' · timezone ' + ss.getSpreadsheetTimeZone());
  }
  Logger.log('ลิงก์แอป: ' + (appPublicUrl_() || '(ยังไม่ได้ deploy)'));
  return 'OK';
}

/* ====================== Web entry ====================== */

/** ลิงก์แอปรูปที่แจกได้ — บัญชีองค์กรจะได้ /a/macros/<โดเมน>/ ซึ่งบังคับล็อกอินโดเมนนั้น
 *  ต้องแปลงกลับเป็น /macros/ เสมอ (pattara-webapp-standards ข้อ 6) */
function appPublicUrl_() {
  var u = '';
  try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  return u.replace(/\/a\/macros\/[^\/]+\//, '/macros/');
}

/** ลิงก์คู่มือ — ไม่ได้ตั้ง APP_MANUAL_URL ให้ตกมาที่หน้าคู่มือในตัวแอป */
function manualUrl_() {
  var v = String(PropertiesService.getScriptProperties().getProperty('APP_MANUAL_URL') || '').trim();
  if (v) return v;
  var base = appPublicUrl_();
  return base ? (base + '?page=manual') : '';
}

function appName_() {
  return PropertiesService.getScriptProperties().getProperty('APP_NAME') || APP_NAME_DEFAULT;
}

function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'manual') {
    var m = HtmlService.createTemplateFromFile('Manual');
    m.boot = JSON.stringify({
      appName: appName_(),
      appVersion: appVersionLabel_(),
      appIcon: getAppIcon_(),
      today: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy')
    });
    return m.evaluate()
      .setTitle('คู่มือการใช้งาน — ' + appName_())
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  t.bootstrap = JSON.stringify(buildBootstrap_());
  return t.evaluate()
    .setTitle(appName_())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** ค่าตั้งต้นของหน้า — ส่วนที่ต้องเปิดชีตห่อ try ไว้ หน้าเว็บต้องเปิดได้แม้ยังไม่ตั้งค่าชีต */
function buildBootstrap_() {
  var props = PropertiesService.getScriptProperties();
  var out = {
    appVersion: appVersionLabel_(),
    manualUrl: manualUrl_(),
    appName: appName_(),
    appDesc: props.getProperty('APP_DESC') || '',
    appIcon: getAppIcon_(),
    appUrl: appPublicUrl_(),
    maxRows: MAX_ROWS,
    cols: COLS.map(function (c) { return { k: c.k, th: c.th, type: c.type || 'text', tech: !!c.tech }; }),
    sumCols: SUM_COLS,
    etaxUrl: props.getProperty(PROP_ETAX) || '',
    configured: !!props.getProperty(PROP_SS),
    banks: [],
    error: ''
  };
  if (out.configured) {
    try { out.banks = bankTabs_(masterSs_()); }
    catch (e) { out.error = String((e && e.message) || e); }
  }
  return out;
}

/* ====================== Auth ====================== */

/* PIN ผู้ดูแลเก็บเป็น sha256(pin + '|' + salt) ไม่เก็บตัวเลขตรง ๆ · salt สุ่มครั้งเดียวต่อโปรเจกต์ */

function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

function adminSalt_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('PIN_SALT');
  if (!s) { s = Utilities.getUuid(); p.setProperty('PIN_SALT', s); }
  return s;
}

function hashPin_(pin) { return sha256_(String(pin || '') + '|' + adminSalt_()); }

/* คืน hash ที่เก็บไว้ — ว่าง/ผิดรูป = ตั้งค่าเริ่มต้นและปักธง PIN_IS_DEFAULT ให้หน้าตั้งค่าเตือน */
function adminPinHash_() {
  var p = PropertiesService.getScriptProperties();
  var v = String(p.getProperty('ADMIN_PIN') || '').trim();
  if (/^[0-9a-f]{64}$/.test(v)) return v;
  var d = hashPin_(PIN_DEFAULT);
  p.setProperty('ADMIN_PIN', d);
  p.setProperty('PIN_IS_DEFAULT', '1');
  return d;
}

function pinIsDefault_() {
  return PropertiesService.getScriptProperties().getProperty('PIN_IS_DEFAULT') === '1';
}

function assertPin_(pin) {
  if (ssoPassOk_(pin)) return;   // บัตรผ่านจาก Apps Center (Sso.js)
  if (hashPin_(pin) !== adminPinHash_()) throw new Error('เฉพาะผู้ดูแลระบบ — PIN ไม่ถูกต้อง');
}

/** เปิดจาก Pattara Apps Center พร้อมตั๋ว ?sso= → คืนบัตรผ่าน sso:… ให้หน้าเว็บใช้แทน PIN */
function ssoLogin(ticket) {
  var r = ssoFromTicket_(String(ticket || ''));
  return r.key ? { ok: true, pin: r.key, pinIsDefault: pinIsDefault_() } : { ok: false, message: r.err || '' };
}

/** ตรวจ PIN ตอน login ผู้ดูแล พร้อมกันเดารหัส: ผิดครบ 8 ครั้ง ล็อก 15 นาที */
function verifyPin(pin) {
  var cache = CacheService.getScriptCache();
  var key = 'pinfail_' + (getUserEmail_() || 'anon');
  var fails = parseInt(cache.get(key), 10) || 0;
  if (fails >= 8) throw new Error('ใส่ PIN ผิดหลายครั้งเกินไป — กรุณารอ 15 นาทีแล้วลองใหม่');
  if (hashPin_(pin) === adminPinHash_()) {
    cache.remove(key);
    return { ok: true, pinIsDefault: pinIsDefault_() };
  }
  cache.put(key, String(fails + 1), 900);
  throw new Error('PIN ไม่ถูกต้อง (' + (fails + 1) + '/8)');
}

/** กู้ PIN กลับเป็นค่าเริ่มต้น — เปิดเอดิเตอร์แล้วกด เรียกใช้ เฉพาะตอนลืม PIN */
function resetAdminPin() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('ADMIN_PIN', hashPin_(PIN_DEFAULT));
  p.setProperty('PIN_IS_DEFAULT', '1');
  log_('รีเซ็ต PIN ผู้ดูแล', 'สั่งจากเอดิเตอร์');
  Logger.log('รีเซ็ต PIN เป็น ' + PIN_DEFAULT + ' แล้ว — เข้าระบบแล้วรีบเปลี่ยนในหน้าตั้งค่าระบบ');
}

function getUserEmail_() {
  try { return (Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}

/* ====================== ชีต MASTER ====================== */

function masterSs_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SS) || '';
  if (!id) throw new Error('ยังไม่ได้ตั้งค่าชีต MASTER — ผู้ดูแลไปที่ ตั้งค่าระบบ › การเชื่อมต่อ');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('เปิดชีต MASTER ไม่ได้ (' + id.slice(0, 8) + '…) — ตรวจ ID และสิทธิ์ของบัญชีที่ deploy'); }
}

/** แท็บธนาคาร = ทุกแท็บที่ช่อง A1 เป็นหัว "bank" (เรียงตามลำดับแท็บในชีต) — ไม่ fix รายชื่อธนาคารในโค้ด */
function bankTabs_(ss) {
  var out = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === LOG_SHEET) return;
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    var a1 = String(sh.getRange(1, 1).getDisplayValue() || '').trim().toLowerCase();
    if (a1 === 'bank') out.push(sh.getName());
  });
  return out;
}

/** 'yyyy-mm-dd' → 'dd/MM/yyyy' (ค.ศ.) ด้วยสตริงล้วน ไม่ผ่าน Date — อ่านไม่ออกคืนค่าเดิม */
function dispDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(iso || '');
}

/** "3,884.40" → 3884.4 · ว่าง → '' · อ่านไม่ออกคืนข้อความเดิม */
function num_(v) {
  var s = String(v == null ? '' : v).replace(/,/g, '').trim();
  if (s === '') return '';
  var n = Number(s);
  return isNaN(n) ? s : Math.round(n * 100) / 100;
}

/**
 * ดึงรายการ — bank = 'ALL' หรือชื่อแท็บ · from/to = 'yyyy-MM-dd' หรือ '' (เทียบสตริงกับ date_iso)
 * อ่านด้วย getDisplayValues ทั้งแท็บ (คอลัมน์วันที่/รหัสเป็นข้อความ @ ชีตจะไม่เดา locale)
 * คืน headers (ไทย) · keys · rows (array ตาม COLS) · latest · health (แถวที่ยังไม่มีรหัสสาขา) · runs (รอบอ่านล่าสุด)
 */
function getData(bank, fromStr, toStr) {
  var t0 = Date.now();
  var ss = masterSs_();
  var tabs = bankTabs_(ss);
  bank = String(bank || 'ALL');
  var want = bank === 'ALL' ? tabs : tabs.filter(function (t) { return t === bank; });
  if (bank !== 'ALL' && !want.length) throw new Error('ไม่พบแท็บธนาคาร "' + bank + '" ในชีต MASTER');
  var from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromStr || '')) ? String(fromStr) : '';
  var to = /^\d{4}-\d{2}-\d{2}$/.test(String(toStr || '')) ? String(toStr) : '';

  var out = { headers: COLS.map(function (c) { return c.th; }), keys: COLS.map(function (c) { return c.k; }),
              rows: [], count: 0, truncated: false, latest: null, ms: 0,
              health: { rows: 0, merchants: [] }, runs: runs_(ss, want), banks: tabs, scanned: 0 };
  var miss = {}, missOrder = [], latestIso = '';

  for (var ti = 0; ti < want.length && !out.truncated; ti++) {
    var sh = ss.getSheetByName(want[ti]);
    if (!sh || sh.getLastRow() < 2) continue;
    var disp = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    var head = disp[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    head.forEach(function (h, i) { if (h && idx[h] == null) idx[h] = i; });
    var iIso = idx['date_iso'], iBc = idx['branch_code'], iMid = idx['merchant_id'], iName = idx['merchant_name'], iUnit = idx['unit'];
    if (iIso == null) throw new Error('แท็บ "' + want[ti] + '" ไม่มีคอลัมน์ date_iso');
    var colIdx = COLS.map(function (c) { return idx[c.k] == null ? -1 : idx[c.k]; });

    for (var r = 1; r < disp.length; r++) {
      var row = disp[r];
      var iso = String(row[iIso] || '').trim();
      if (!iso) continue;                                  // แถวว่าง/ไม่ใช่รายการ
      out.scanned++;
      if (iso > latestIso) latestIso = iso;
      /* สุขภาพข้อมูล: นับทุกแถวของธนาคารที่เลือก ไม่สนช่วงวัน — รหัสสาขาว่าง = MERCHANT_MAP ยังไม่ได้ใส่รหัส */
      if (iBc != null && !String(row[iBc] || '').trim()) {
        var mk = want[ti] + '|' + String(iMid == null ? '' : row[iMid] || '').trim();
        if (!miss[mk]) {
          miss[mk] = { bank: want[ti], id: String(iMid == null ? '' : row[iMid] || '').trim() || '(ไม่มี MERCHANT_ID)',
                       name: String(iName == null ? '' : row[iName] || '').trim(), unit: String(iUnit == null ? '' : row[iUnit] || '').trim(), count: 0 };
          missOrder.push(mk);
        }
        miss[mk].count++;
        out.health.rows++;
      }
      if (from && iso < from) continue;
      if (to && iso > to) continue;
      var o = new Array(COLS.length);
      for (var c = 0; c < COLS.length; c++) {
        var ci = colIdx[c];
        var v = ci < 0 ? '' : row[ci];
        var ty = COLS[c].type;
        if (ty === 'date') o[c] = dispDate_(iso);          // แสดงจาก date_iso เสมอ ไม่พึ่งคอลัมน์ date ที่เป็นข้อความ
        else if (ty === 'money' || ty === 'num') o[c] = num_(v);
        else o[c] = String(v == null ? '' : v);
      }
      out.rows.push(o);
      if (out.rows.length >= MAX_ROWS) { out.truncated = true; break; }
    }
  }
  out.health.merchants = missOrder.map(function (k) { return miss[k]; });
  out.count = out.rows.length;
  out.latest = latestIso ? { iso: latestIso, disp: dispDate_(latestIso) } : null;
  out.ms = Date.now() - t0;
  return out;
}

/** รอบอ่านล่าสุดต่อธนาคารจากแท็บ EXTRACT_LOG (run_at · status · added) — ไม่มีแท็บ = [] */
function runs_(ss, banks) {
  try {
    var sh = ss.getSheetByName('EXTRACT_LOG');
    if (!sh || sh.getLastRow() < 2) return [];
    var disp = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    var head = disp[0].map(function (h) { return String(h || '').trim(); });
    var iAt = head.indexOf('run_at'), iBank = head.indexOf('bank'), iSt = head.indexOf('status'), iAdd = head.indexOf('added'), iMode = head.indexOf('mode');
    if (iAt < 0 || iBank < 0) return [];
    var seen = {}, out = [];
    for (var r = disp.length - 1; r >= 1 && out.length < banks.length; r--) {
      var b = String(disp[r][iBank] || '').trim();
      if (banks.indexOf(b) < 0 || seen[b]) continue;
      seen[b] = true;
      out.push({ bank: b, at: String(disp[r][iAt] || ''), status: iSt < 0 ? '' : String(disp[r][iSt] || ''),
                 added: iAdd < 0 ? '' : String(disp[r][iAdd] || ''), mode: iMode < 0 ? '' : String(disp[r][iMode] || '') });
    }
    return out;
  } catch (e) { return []; }
}

/* ====================== Log (แท็บซ่อนในชีต MASTER) ====================== */

function log_(action, detail) {
  try {
    var ss = masterSs_();
    var sh = ss.getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(LOG_SHEET);
      sh.getRange(1, 1, 1, 4).setValues([['เวลา', 'ผู้ทำ', 'การกระทำ', 'รายละเอียด']]);
      sh.hideSheet();
    }
    sh.appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss'),
                  getUserEmail_() || 'admin', action, String(detail || '').slice(0, 45000)]);
  } catch (e) { /* log พังต้องไม่ล้มงานหลัก (รวมถึงตอนยังไม่ตั้งค่าชีต) */ }
}

/* ====================== Settings (admin) ====================== */

/* ---------- ไอคอนป้ายแอป ----------
   Script Property เก็บได้ 9KB ต่อค่า ไม่พอกับ data URI ของรูป → หั่นเก็บก้อนละ 8000 ตัวอักษร APP_ICON_0..n */
var ICON_CHUNK = 8000;
var ICON_MAX_CHARS = 200000;

function getAppIcon_() {
  var props = PropertiesService.getScriptProperties();
  var cnt = Number(props.getProperty('APP_ICON_N') || 0);
  if (!cnt) return '';
  var parts = [];
  for (var i = 0; i < cnt; i++) parts.push(props.getProperty('APP_ICON_' + i) || '');
  return parts.join('');
}

function setAppIcon_(dataUri) {
  var props = PropertiesService.getScriptProperties();
  var old = Number(props.getProperty('APP_ICON_N') || 0);
  for (var i = 0; i < old; i++) props.deleteProperty('APP_ICON_' + i);
  var v = String(dataUri || '').trim();
  if (!v) { props.deleteProperty('APP_ICON_N'); return 0; }
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(v)) throw new Error('ไฟล์ไอคอนต้องเป็นรูปภาพ (PNG / JPEG / WebP)');
  if (v.length > ICON_MAX_CHARS) throw new Error('ไฟล์ไอคอนใหญ่เกินไป — ลองใช้รูปที่เรียบง่ายกว่านี้');
  var k = 0;
  for (var pos = 0; pos < v.length; pos += ICON_CHUNK) { props.setProperty('APP_ICON_' + k, v.substr(pos, ICON_CHUNK)); k++; }
  props.setProperty('APP_ICON_N', String(k));
  return k;
}

/** รับทั้ง ID ตรง ๆ และลิงก์ https://docs.google.com/spreadsheets/d/<id>/… */
function parseSsId_(s) {
  s = String(s || '').trim();
  var m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}

function getSettings(pin) {
  assertPin_(pin);
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty(PROP_SS) || '';
  var ssName = '', ssUrl = '';
  if (ssId) {
    try { var ss = SpreadsheetApp.openById(ssId); ssName = ss.getName(); ssUrl = ss.getUrl(); } catch (e) { ssName = ''; }
  }
  return {
    ok: true,
    pinIsDefault: pinIsDefault_(),
    sso: ssoKeyInfo_(),
    manualUrl: props.getProperty('APP_MANUAL_URL') || '',
    appName: appName_(),
    appDesc: props.getProperty('APP_DESC') || '',
    appIcon: getAppIcon_(),
    appVersion: appVersionLabel_(),
    ssId: ssId, ssName: ssName, ssUrl: ssUrl,
    etaxUrl: props.getProperty(PROP_ETAX) || ''
  };
}

/** ทดสอบเปิดชีต MASTER — คืนชื่อชีต แท็บธนาคารพร้อมจำนวนแถว และรอบอ่านล่าสุด (อ่านอย่างเดียว ไม่มีผลข้างเคียง) */
function testMaster(pin) {
  assertPin_(pin);
  try {
    var ss = masterSs_();
    var tabs = bankTabs_(ss);
    if (!tabs.length) return { ok: false, message: 'เปิดชีต "' + ss.getName() + '" ได้ แต่ไม่พบแท็บที่หัวคอลัมน์ A1 เป็น bank — ใช่ชีต ETAX EDC — MASTER หรือไม่' };
    var parts = tabs.map(function (t) { return t + ' ' + Math.max(0, ss.getSheetByName(t).getLastRow() - 1).toLocaleString() + ' แถว'; });
    var runs = runs_(ss, tabs).map(function (r) { return r.bank + ' ' + r.at + (r.status ? ' ' + r.status : ''); });
    return { ok: true, message: 'เชื่อมต่อได้ — "' + ss.getName() + '" · ' + parts.join(' · ') +
             (runs.length ? ' · รอบอ่านล่าสุด: ' + runs.join(' | ') : ' · ยังไม่มีแท็บ EXTRACT_LOG') };
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) };
  }
}

/**
 * บันทึกทีละส่วนตามปุ่มที่กด (pattara-setting — ไม่มีปุ่มบันทึกรวม)
 * obj.section = 'brand' | 'conn' | 'sso' | 'pin'
 */
function saveSettings(pin, obj) {
  assertPin_(pin);
  obj = obj || {};
  var props = PropertiesService.getScriptProperties();
  var section = String(obj.section || '');

  if (section === 'brand') {
    if (typeof obj.appName === 'string') {
      var nm = obj.appName.trim();
      if (!nm) throw new Error('ชื่อแอปว่างไม่ได้');
      props.setProperty('APP_NAME', nm);
    }
    if (typeof obj.appDesc === 'string') props.setProperty('APP_DESC', obj.appDesc.trim());
    if (typeof obj.manualUrl === 'string') {
      var mu = obj.manualUrl.trim();
      if (mu && !/^https:\/\//i.test(mu)) throw new Error('ลิงก์คู่มือต้องขึ้นต้นด้วย https://');
      props.setProperty('APP_MANUAL_URL', mu);
    }
    var iconNote = '';
    if (obj.iconAction === 'set') { var k = setAppIcon_(obj.appIcon); iconNote = ' · เปลี่ยนไอคอน (' + k + ' ก้อน)'; }
    else if (obj.iconAction === 'clear') { setAppIcon_(''); iconNote = ' · ลบไอคอน'; }
    log_('บันทึกป้ายแอป', 'ชื่อ/คำอธิบาย/ลิงก์คู่มือ' + iconNote);
    return { ok: true, section: 'brand', appIcon: getAppIcon_() };
  }

  if (section === 'conn') {
    if (typeof obj.ssId === 'string') {
      var id = parseSsId_(obj.ssId);
      if (!id) throw new Error('ชีต MASTER: ใส่ ID หรือลิงก์ของ Google Sheets ให้ถูกต้อง');
      var ss;
      try { ss = SpreadsheetApp.openById(id); } catch (e) { throw new Error('เปิดชีตนี้ไม่ได้ — ตรวจว่าบัญชีที่ deploy แอปมีสิทธิ์อ่านชีต'); }
      if (!bankTabs_(ss).length) throw new Error('ชีต "' + ss.getName() + '" ไม่มีแท็บที่หัวคอลัมน์ A1 เป็น bank — ไม่ใช่ชีต MASTER');
      var oldId = props.getProperty(PROP_SS) || '';
      props.setProperty(PROP_SS, id);
      log_('ตั้งค่าชีต MASTER', (oldId ? oldId.slice(0, 8) + '… → ' : '') + id.slice(0, 8) + '… (' + ss.getName() + ')');
    }
    if (typeof obj.etaxUrl === 'string') {
      var eu = obj.etaxUrl.trim();
      if (eu && !/^https:\/\//i.test(eu)) throw new Error('ลิงก์แอปตัวโหลดต้องขึ้นต้นด้วย https://');
      props.setProperty(PROP_ETAX, eu);
      log_('ตั้งค่าลิงก์แอปตัวโหลด', eu || '(ว่าง)');
    }
    return { ok: true, section: 'conn' };
  }

  if (section === 'sso') {   // รหัส SSO จาก Apps Center — ว่าง = ปิด
    var r = ssoSaveKey_(obj.key);
    log_('รหัส SSO Apps Center', (r.old || '-') + ' → ' + (r.now || '-'));
    return { ok: true, section: 'sso', message: r.msg };
  }

  if (section === 'pin') {
    var np = String(obj.newPin || '').trim();
    var cf = String(obj.confirmPin || '').trim();
    if (!/^\d{6}$/.test(np)) throw new Error('PIN ใหม่ต้องเป็นตัวเลข 6 หลัก');
    if (np !== cf) throw new Error('PIN ใหม่กับช่องยืนยันไม่ตรงกัน');
    if (np === PIN_DEFAULT) throw new Error('PIN ใหม่ซ้ำกับค่าเริ่มต้น กรุณาตั้งเลขอื่น');
    props.setProperty('ADMIN_PIN', hashPin_(np));
    props.deleteProperty('PIN_IS_DEFAULT');
    log_('เปลี่ยน PIN ผู้ดูแล', '');                          // ไม่เขียนค่า PIN ลง log
    return { ok: true, section: 'pin', pinChanged: true };
  }

  throw new Error('ไม่รู้จักส่วนที่จะบันทึก');
}
