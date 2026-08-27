/**
 * ระบบขึ้นเงินบัตรเครดิต EDC — Web App
 * ---------------------------------------------------------
 * โครงหน้าตา/พฤติกรรมอิง "Delivery Platform OCR" เว็บแอปของกลุ่ม:
 * sidebar + ชิปแหล่งข้อมูล + แท็บ + ปุ่มดึงข้อมูล + การ์ดสรุป + ตาราง sort ได้
 * + Export CSV/Excel/PDF + ปุ่ม Sync + หน้า login แบบ Dual-Access (user เข้าเลย / admin PIN)
 *
 * ต่างจาก OCR ตรงที่แอปนี้มีจุดเขียนชีต "จุดเดียว" คือแท็บ Index
 * (ผู้ดูแลแก้ผ่านหน้าเว็บ, ตรวจ PIN ฝั่งเซิร์ฟเวอร์ทุกครั้ง, log ทุกการแก้ลงแท็บซ่อน)
 * นอกนั้นอ่านอย่างเดียวทั้งหมด (getValues เท่านั้น)
 *
 * 🔴 ระบบตรวจค่าว่างใน query:
 * แถวใน query ที่ "รหัสสาขา BC" ว่าง = MERCHANT_ID ยังไม่ถูกจับคู่ในแท็บ Index
 * → หน้าเว็บแจ้งเตือนสีแดง + ปิดปุ่ม Export ทุกช่องทาง (CSV/Excel/PDF)
 *   จนกว่าจะจับคู่ใน Index แล้วตรวจซ้ำผ่านจนข้อมูลครบ
 * ---------------------------------------------------------
 */

var APP_VERSION = 'v1.6 · 20/08/2026';

var MAX_ROWS = 20000;            // เพดานแถวต่อการดึง 1 ครั้ง กันหน้าเว็บอืด
var SYNC_COOLDOWN_SEC = 120;     // กันกดปุ่ม Sync ถี่ฝั่งแอป (endpoint กันอีกชั้น 60 วิ)
var PIN_DEFAULT = '123456';      // PIN ผู้ดูแล (เปลี่ยนภายหลังได้ใน ⚙️ ตั้งค่าระบบ)

/* ── แหล่งข้อมูล (อนาคตเพิ่ม BBL / KTB / TTB / Krungsri / OIL อื่น: เพิ่ม object ต่อท้าย) ── */
var SOURCES = [{
  key: 'wcoil6',
  label: 'K-Bank',
  sublabel: 'wc_oil6 Amazon',
  color: '#018A4B',                        // เขียวกสิกร
  fileLabel: 'EDC wc_oil6 Amazon',         // ใช้ตั้งชื่อไฟล์ดาวน์โหลด
  ssId: '1EcgNdmrMDIpLhg489TQApJyVtQynEFcwUClMhBhkvq8',
  logSheet: 'WebApp_Log',
  /* ตำแหน่งคอลัมน์แบบ fix ตามชีตจริง (ใช้กับ Index editor + ตัวตรวจค่าว่าง) */
  rawSheet: 'K_Merchant_CSV_Data',         // E=MERCHANT_ID F=TAX D(4)=BRANCH_NAME M(13)=รหัสสาขา BC
  indexSheet: 'Index',                     // A=ลำดับ B=MERCHANT_ID C=BC D=ชื่อร้านค้า E=ที่อยู่ F=สาขา
  indexEditable: true,
  indexSchema: { order: true,              // มีคอลัมน์ "ลำดับ" นำหน้า (ระบบใส่เลขให้เอง)
    fields: ['MERCHANT_ID', 'รหัสสาขา BC', 'ชื่อร้านค้า', 'ที่อยู่', 'สาขา'] },
  tabs: [
    { key: 'query', label: 'รายการ (Query)', sheet: 'query',
      dateCol: 'PROCESS DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL AMT', 'ค่าใช้จ่าย', 'NET CREDIT AMT'], exclude: [] },
    { key: 'raw', label: 'ข้อมูลดิบ', sheet: 'K_Merchant_CSV_Data',
      dateCol: 'PROCESS DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL AMT', 'ค่าใช้จ่าย', 'NET CREDIT AMT'], exclude: [] },
    { key: 'index', label: 'Index', sheet: 'Index',
      dateCol: '', storeCol: '', sum: [], exclude: [] }
  ]
}, {
  key: 'oilpark',
  label: 'K-Bank',
  sublabel: 'OIL 1/4/5/6 · TT/TK',
  color: '#0B57A4',                        // น้ำเงินปั๊ม PTT
  fileLabel: 'EDC OIL-Park',
  ssId: '1nCk-2Hr_t6NJFJszypCcHrpgJqnAVZVnhTtfYuPHUKM',
  logSheet: 'WebApp_Log',
  rawSheet: 'K-Merchant Raw Data',         // ตำแหน่งคอลัมน์เหมือนชีต Amazon ทุกช่อง
  indexSheet: 'index',                     // A=MERCHANT_ID B=เจ้าของ(BC) C=DATABASE — ไม่มีลำดับ
  indexEditable: false,                    // ชีตของบัญชี wattanaoil — เปิดดูอย่างเดียว แก้ที่ชีตต้นทาง
  indexSchema: { order: false,
    fields: ['MERCHANT_ID', 'รหัสสาขา BC (เจ้าของ)', 'DATABASE'] },
  tabs: [
    { key: 'query', label: 'รายการ (Query)', sheet: 'query',
      dateCol: 'PROCESS DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL AMT', 'ค่าใช้จ่าย', 'NET CREDIT AMT'], exclude: [] },
    { key: 'raw', label: 'ข้อมูลดิบ', sheet: 'K-Merchant Raw Data',
      dateCol: 'PROCESS DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL AMT', 'ค่าใช้จ่าย', 'NET CREDIT AMT'], exclude: [] },
    { key: 'index', label: 'Index', sheet: 'index',
      dateCol: '', storeCol: '', sum: [], exclude: [] }
  ]
}];

/* ====================== Web entry ====================== */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.bootstrap = JSON.stringify(buildBootstrap_());
  return t.evaluate()
    .setTitle('ระบบขึ้นเงินบัตรเครดิต EDC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function buildBootstrap_() {
  return {
    appVersion: APP_VERSION,
    user: getUserEmail_(),
    maxRows: MAX_ROWS,
    sources: SOURCES.map(function (s) {
      return {
        key: s.key, label: s.label, sublabel: s.sublabel || '',
        color: s.color || '#0E6E5C', fileLabel: s.fileLabel || s.label,
        canSync: true,
        indexEditable: !!s.indexEditable,
        indexFields: (s.indexSchema && s.indexSchema.fields) || [],
        tabs: s.tabs.map(function (t) {
          return { key: t.key, label: t.label, sheet: t.sheet, dateCol: t.dateCol || '',
                   storeCol: t.storeCol || '', sum: t.sum || [] };
        })
      };
    }),
    lastSync: lastSyncInfo_(SOURCES[0].key)
  };
}

/* ====================== Auth ====================== */

function adminPin_() {
  // PIN ต้องเป็นตัวเลข 6 หลักเสมอ — ค่าที่เก็บไว้ผิดรูป (เช่นของเก่า) ให้ตกกลับมาใช้ค่าเริ่มต้น
  var v = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
  return /^\d{6}$/.test(v) ? v : PIN_DEFAULT;
}

function assertPin_(pin) {
  if (String(pin || '') !== adminPin_()) throw new Error('เฉพาะผู้ดูแลระบบ — PIN ไม่ถูกต้อง');
}

/** ตรวจ PIN ตอน login ผู้ดูแล พร้อมกันเดารหัส: ผิดครบ 8 ครั้ง ล็อก 15 นาที */
function verifyPin(pin) {
  var cache = CacheService.getScriptCache();
  var key = 'pinfail_' + (getUserEmail_() || 'anon');
  var fails = parseInt(cache.get(key), 10) || 0;
  if (fails >= 8) throw new Error('ใส่ PIN ผิดหลายครั้งเกินไป — กรุณารอ 15 นาทีแล้วลองใหม่');
  if (String(pin || '') === adminPin_()) { cache.remove(key); return { ok: true }; }
  cache.put(key, String(fails + 1), 900);
  throw new Error('PIN ไม่ถูกต้อง (' + (fails + 1) + '/8)');
}

function getUserEmail_() {
  try { return (Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}

/* ====================== Data API (read-only) ====================== */

function srcOf_(key) {
  for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].key === key) return SOURCES[i];
  return SOURCES[0];
}

function tabOf_(src, tabKey) {
  for (var i = 0; i < src.tabs.length; i++) if (src.tabs[i].key === tabKey) return src.tabs[i];
  throw new Error('ไม่พบแท็บที่ระบุ');
}

function getData(sourceKey, tabKey, fromStr, toStr) {
  var t0 = Date.now();
  var src = srcOf_(sourceKey);
  var tab = tabOf_(src, tabKey);

  var ss = SpreadsheetApp.openById(src.ssId);
  var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  var sh = ss.getSheetByName(tab.sheet);
  if (!sh) throw new Error('ไม่พบแท็บ "' + tab.sheet + '" ในชีตข้อมูล');

  var values = sh.getDataRange().getValues();
  var out = { headers: [], rows: [], count: 0, truncated: false, latest: null, ms: 0,
              health: checkHealth_(src), lastSync: lastSyncInfo_(src.key) };
  if (values.length < 1) { out.ms = Date.now() - t0; return out; }

  var rawHeaders = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var excl = {};
  (tab.exclude || []).forEach(function (h) { excl[h] = true; });
  var keep = [];
  rawHeaders.forEach(function (h, i) { if (h !== '' && !excl[h]) keep.push(i); });
  out.headers = keep.map(function (i) { return rawHeaders[i]; });

  var dateIdxRaw = tab.dateCol ? rawHeaders.indexOf(tab.dateCol) : -1;
  var from = parseYmd_(fromStr, false, tz);
  var to = parseYmd_(toStr, true, tz);

  // วันที่ล่าสุดที่มีข้อมูลจริง (สแกนทั้งแท็บ ไม่สนช่วงที่กรอง)
  var latestTs = null;
  if (dateIdxRaw >= 0) {
    for (var lr = 1; lr < values.length; lr++) {
      var lv = values[lr][dateIdxRaw];
      if (lv instanceof Date) {
        var lt = lv.getTime();
        if (latestTs === null || lt > latestTs) latestTs = lt;
      }
    }
  }

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blank = true;
    for (var b = 0; b < keep.length; b++) {
      var cv = row[keep[b]];
      if (cv !== '' && cv != null) { blank = false; break; }
    }
    if (blank) continue;
    if (dateIdxRaw >= 0 && (from || to)) {
      var dv = row[dateIdxRaw];
      if (!(dv instanceof Date)) continue;
      var ts = dv.getTime();
      if (from && ts < from) continue;
      if (to && ts > to) continue;
    }
    var o = new Array(keep.length);
    for (var c = 0; c < keep.length; c++) o[c] = formatCell_(row[keep[c]], tz);
    out.rows.push(o);
    if (out.rows.length >= MAX_ROWS) { out.truncated = true; break; }
  }

  out.count = out.rows.length;
  out.latest = latestTs === null ? null : {
    iso: Utilities.formatDate(new Date(latestTs), tz, 'yyyy-MM-dd'),
    disp: Utilities.formatDate(new Date(latestTs), tz, 'dd/MM/yyyy')
  };
  out.ms = Date.now() - t0;
  return out;
}

/** รายชื่อสาขาสำหรับ dropdown: [{v:'D2', label:'D2 · SD1767'}] (จากแท็บ Index) */
function ixBase_(src) { return (src.indexSchema && src.indexSchema.order) ? 1 : 0; }

function getBranches(sourceKey) {
  var src = srcOf_(sourceKey);
  var sh = SpreadsheetApp.openById(src.ssId).getSheetByName(src.indexSheet);
  if (!sh) return [];
  var base = ixBase_(src);
  var values = sh.getDataRange().getValues();
  var map = {};
  for (var r = 1; r < values.length; r++) {
    var bc = String(values[r][base + 1] == null ? '' : values[r][base + 1]).trim();
    var shop = String(values[r][base + 2] == null ? '' : values[r][base + 2]).trim();
    if (!bc) continue;
    if (!map[bc]) map[bc] = {};
    if (shop) map[bc][shop] = true;
  }
  return Object.keys(map).sort().map(function (bc) {
    var shops = Object.keys(map[bc]).sort();
    return { v: bc, label: bc + (shops.length ? ' · ' + shops.join('/') : '') };
  });
}

/* ====================== 🔴 ตัวตรวจค่าว่างใน query ====================== */
/* คอลัมน์ "รหัสสาขา BC" ใน query มาจาก ARRAYFORMULA VLOOKUP(MERCHANT_ID, Index!B:C)
   ถ้า MERCHANT ไหนไม่อยู่ใน Index → ช่องจะว่าง = ข้อมูล query ไม่ครบ
   ตรวจจากชีตดิบ (ตำแหน่งคอลัมน์ fix): E=MERCHANT_ID, F=TAX, D=BRANCH_NAME, M=รหัสสาขา BC */

function checkHealth_(src) {
  try {
    var sh = SpreadsheetApp.openById(src.ssId).getSheetByName(src.rawSheet);
    if (!sh) return { ok: true, rows: 0, merchants: [] };
    var values = sh.getDataRange().getValues();
    var miss = {}, order = [], total = 0;
    for (var r = 1; r < values.length; r++) {
      var tax = String(values[r][5] == null ? '' : values[r][5]).trim();
      if (!tax) continue;                                   // แถวว่าง/ไม่ใช่รายการ
      var bc = String(values[r][12] == null ? '' : values[r][12]).trim();
      if (bc) continue;                                     // จับคู่แล้ว
      var mid = String(values[r][4] == null ? '' : values[r][4]).trim() || '(ไม่มี MERCHANT_ID)';
      var bname = String(values[r][3] == null ? '' : values[r][3]).trim();
      if (!miss[mid]) { miss[mid] = { id: mid, name: bname, count: 0 }; order.push(mid); }
      miss[mid].count++;
      if (bname && !miss[mid].name) miss[mid].name = bname;
      total++;
    }
    return { ok: total === 0, rows: total,
             merchants: order.map(function (k) { return miss[k]; }) };
  } catch (e) {
    // ตรวจไม่ได้ = ฟันธงไม่ได้ว่าครบ → กัน export ไว้ก่อน พร้อมบอกเหตุ
    return { ok: false, rows: -1, merchants: [], error: String((e && e.message) || e) };
  }
}

/** ให้หน้าเว็บกดตรวจซ้ำได้ (เช่น หลังบันทึก Index) */
function recheckHealth(sourceKey) {
  return checkHealth_(srcOf_(sourceKey));
}

/* ====================== Index (จุดเขียนจุดเดียว — admin) ====================== */

function getIndexRows(sourceKey) {
  var src = srcOf_(sourceKey);
  var sh = SpreadsheetApp.openById(src.ssId).getSheetByName(src.indexSheet);
  if (!sh) throw new Error('ไม่พบแท็บ ' + src.indexSheet);
  var base = ixBase_(src);
  var nf = src.indexSchema.fields.length;
  var values = sh.getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var m = String(values[r][base] == null ? '' : values[r][base]).trim();
    if (!m) continue;
    var row = [];
    for (var f = 0; f < nf; f++) row.push(String(values[r][base + f] == null ? '' : values[r][base + f]).trim());
    rows.push(row);
  }
  return { ok: true, rows: rows };
}

/** rows = [[MERCHANT_ID, BC, ชื่อร้านค้า, ที่อยู่, สาขา], ...] — เขียนทับทั้งบล็อก + ใส่ลำดับใหม่ */
function saveIndexRows(pin, sourceKey, rows) {
  assertPin_(pin);
  var src = srcOf_(sourceKey);
  if (!src.indexEditable) throw new Error('แหล่งข้อมูลนี้เปิดดู Index อย่างเดียว — แก้การจับคู่ที่ชีตต้นทางโดยตรง');
  var nf = src.indexSchema.fields.length;
  var incoming = (rows || []).map(function (r) {
    var o = [];
    for (var f = 0; f < nf; f++) o.push(String((r && r[f]) || '').trim());
    return o;
  }).filter(function (r) { return r.some(function (v) { return v !== ''; }); });

  var seen = {};
  for (var i = 0; i < incoming.length; i++) {
    var r = incoming[i];
    if (!r[0]) throw new Error('แถวที่ ' + (i + 1) + ': ต้องมี MERCHANT_ID');
    if (!r[1]) throw new Error('แถวที่ ' + (i + 1) + ' (' + r[0] + '): ต้องระบุรหัสสาขา BC');
    if (seen[r[0]]) throw new Error('MERCHANT_ID ซ้ำ: ' + r[0]);
    seen[r[0]] = true;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var before = getIndexRows(sourceKey).rows;
    var sh = SpreadsheetApp.openById(src.ssId).getSheetByName(src.indexSheet);
    if (!sh) throw new Error('ไม่พบแท็บ ' + src.indexSheet);

    var base = ixBase_(src);
    var width = base + nf;
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
    if (incoming.length) {
      var out = incoming.map(function (r, ix) { return base ? [ix + 1].concat(r) : r.slice(); });
      sh.getRange(2, 1, out.length, width).setValues(out);
    }

    log_('แก้ไข Index (' + src.key + ')', diffIndex_(before, incoming));
    return { ok: true, count: incoming.length, health: checkHealth_(src) };
  } finally {
    lock.releaseLock();
  }
}

function diffIndex_(before, after) {
  var b = {}, a = {};
  before.forEach(function (r) { b[r[0]] = r; });
  after.forEach(function (r) { a[r[0]] = r; });
  var added = [], removed = [], changed = [];
  Object.keys(a).forEach(function (k) {
    if (!b[k]) added.push(k);
    else if (b[k].join('|') !== a[k].join('|')) changed.push(k + ' (' + b[k][1] + '→' + a[k][1] + ')');
  });
  Object.keys(b).forEach(function (k) { if (!a[k]) removed.push(k); });
  var parts = [];
  if (added.length)   parts.push('เพิ่ม ' + added.length + ': ' + added.join(', '));
  if (changed.length) parts.push('แก้ ' + changed.length + ': ' + changed.join(', '));
  if (removed.length) parts.push('ลบ ' + removed.length + ': ' + removed.join(', '));
  return parts.join(' | ') || 'ไม่มีการเปลี่ยนแปลง';
}

function log_(action, detail) {
  try {
    var home = SOURCES[0];   // log รวมที่ชีตหลักเสมอ (กันไปสร้างแท็บในชีตที่เราไม่ได้เป็นเจ้าของ)
    var ss = SpreadsheetApp.openById(home.ssId);
    var sh = ss.getSheetByName(home.logSheet);
    if (!sh) {
      sh = ss.insertSheet(home.logSheet);
      sh.getRange(1, 1, 1, 4).setValues([['เวลา', 'ผู้ทำ', 'การกระทำ', 'รายละเอียด']]);
      sh.hideSheet();
    }
    var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
    sh.appendRow([Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss'),
                  getUserEmail_() || 'admin', action, String(detail || '').slice(0, 45000)]);
  } catch (e) { /* log พังต้องไม่ล้มงานหลัก */ }
}

/* ====================== Sync (proxy ไป SyncEndpoint ของชีต) ====================== */
/* token ไม่เคยถูกส่งไปเบราว์เซอร์ — หน้าเว็บเรียกผ่าน startSync เท่านั้น
   endpoint รัน processEmails ทันที (ดึงเมลย้อนหลัง 7 วัน, กันซ้ำ MERCHANT_ID+TAX, ไม่ส่งเมล) */

function startSync(sourceKey) {
  var src = srcOf_(sourceKey);
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL_' + src.key);
  var token = props.getProperty('SYNC_TOKEN_' + src.key);
  if (!url || !token) {
    return { ok: false, reason: 'notconfigured',
             message: 'ยังไม่ได้ตั้งค่า Sync URL / Token — ให้ผู้ดูแลกรอกใน ⚙️ ตั้งค่าระบบ' };
  }

  var lastTs = Number(props.getProperty('SYNC_APP_TS_' + src.key) || 0);
  var now = Date.now();
  if (now - lastTs < SYNC_COOLDOWN_SEC * 1000) {
    return { ok: false, reason: 'cooldown',
             waitSec: Math.ceil((SYNC_COOLDOWN_SEC * 1000 - (now - lastTs)) / 1000) };
  }

  var full = url + (url.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
  var data;
  try {
    var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
    data = JSON.parse(resp.getContentText());
  } catch (e) {
    return { ok: false, reason: 'error',
             message: 'เรียก Sync Endpoint ไม่สำเร็จ — ตรวจว่า deploy เป็น Web app แบบ Anyone และใช้ URL เวอร์ชันล่าสุด' };
  }
  if (!data || !data.ok) {
    if (data && data.error === 'cooldown') return { ok: false, reason: 'cooldown', waitSec: data.waitSec || 60 };
    return { ok: false, reason: 'error', message: 'Sync ไม่สำเร็จ: ' + ((data && data.error) || 'ไม่ทราบสาเหตุ') };
  }

  props.setProperty('SYNC_APP_TS_' + src.key, String(now));
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var info = {
    at: Utilities.formatDate(new Date(), tz, 'HH:mm'),
    date: Utilities.formatDate(new Date(), tz, 'dd/MM'),
    inserted: (data.stats && data.stats.inserted) || 0,
    dup: ((data.stats && data.stats.skipDupTax) || 0) + ((data.stats && data.stats.skipDupEmail) || 0)
  };
  props.setProperty('SYNC_LAST_INFO_' + src.key, JSON.stringify(info));
  return { ok: true, stats: data.stats, lastSync: info };
}

function lastSyncInfo_(sourceKey) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('SYNC_LAST_INFO_' + sourceKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ====================== Settings (admin) ====================== */

/* หน้า ⚙️ เดียวเห็น config ของทุกชิป — ไม่ผูกกับชิปที่เลือกอยู่ */
function getSettings(pin) {
  assertPin_(pin);
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    sources: SOURCES.map(function (s) {
      return {
        key: s.key, label: s.label, sublabel: s.sublabel || '',
        syncUrl: props.getProperty('SYNC_URL_' + s.key) || '',
        syncToken: props.getProperty('SYNC_TOKEN_' + s.key) || ''
      };
    })
  };
}

function saveSettings(pin, obj) {
  assertPin_(pin);
  obj = obj || {};
  var props = PropertiesService.getScriptProperties();
  var known = {};
  SOURCES.forEach(function (s) { known[s.key] = true; });
  var touched = [];
  (obj.sources || []).forEach(function (e) {
    if (!e || !known[e.key]) return;                 // key แปลกปลอม = เมิน
    props.setProperty('SYNC_URL_' + e.key, String(e.syncUrl || '').trim());
    props.setProperty('SYNC_TOKEN_' + e.key, String(e.syncToken || '').trim());
    touched.push(e.key);
  });
  var np = String(obj.newPin || '').trim();
  if (np) {
    if (!/^\d{6}$/.test(np)) throw new Error('PIN ใหม่ต้องเป็นตัวเลข 6 หลัก');
    props.setProperty('ADMIN_PIN', np);
  }
  log_('บันทึกตั้งค่า', 'Sync URL/Token (' + touched.join(', ') + ')' + (np ? ' + เปลี่ยน PIN' : ''));
  return { ok: true, pinChanged: !!np };
}

/* ====================== Helpers ====================== */

function parseYmd_(s, endOfDay, tz) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  var base = Utilities.parseDate(String(s), tz || Session.getScriptTimeZone(), 'yyyy-MM-dd').getTime();
  return endOfDay ? base + 86399999 : base;
}

function formatCell_(v, tz) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    var hasTime = v.getHours() + v.getMinutes() + v.getSeconds() > 0;
    return Utilities.formatDate(v, tz, hasTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
  }
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  return String(v);
}
