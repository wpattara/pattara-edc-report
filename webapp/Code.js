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

var APP_VERSION = '1.11.0';       // X.Y.Z — X โครงสร้าง · Y ฟีเจอร์/requirement ใหม่ · Z แก้ย่อย
                                 // 1.8.0 = สั่ง rebuild แท็บ query จากหน้าเว็บได้ (ผู้ดูแล)
                                 // ขยับเลขที่นี่เท่านั้น วันที่ระบบ stamp ให้เองตอนเห็นเลขใหม่ครั้งแรก

/* คืน 'v1.7.1 · 02/09/2569' — stamp วันที่ครั้งแรกที่เจอเลขเวอร์ชันใหม่ */
function appVersionLabel_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('APP_VERSION') !== APP_VERSION) {
    p.setProperty('APP_VERSION', APP_VERSION);
    var now = new Date();
    p.setProperty('APP_VERSION_DATE',
      Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/') +
      (Number(Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy')) + 543));
  }
  var d = p.getProperty('APP_VERSION_DATE') || '';
  return 'v' + APP_VERSION + (d ? ' · ' + d : '');
}

var MAX_ROWS = 20000;            // เพดานแถวต่อการดึง 1 ครั้ง กันหน้าเว็บอืด
var SYNC_COOLDOWN_SEC = 120;     // กันกดปุ่ม Sync ถี่ฝั่งแอป (endpoint กันอีกชั้น 60 วิ)
var REBUILD_COOLDOWN_SEC = 30;   // กันกดปุ่ม rebuild ถี่ฝั่งแอป (endpoint กันอีกชั้น 30 วิ)
var PIN_DEFAULT = '123456';      // PIN ตั้งต้น — ใช้ตอนยังไม่เคยตั้ง และตอน resetAdminPin() เท่านั้น

/* ── แหล่งข้อมูล (อนาคตเพิ่ม BBL / KTB / TTB / Krungsri / OIL อื่น: เพิ่ม object ต่อท้าย) ── */
var SOURCES = [{
  key: 'wcoil6',
  label: 'K-Bank',
  sublabel: 'wc_oil6 Amazon',
  color: '#018A4B',                        // เขียวกสิกร
  fileLabel: 'EDC wc_oil6 Amazon',         // ใช้ตั้งชื่อไฟล์ดาวน์โหลด
  ssId: '1EcgNdmrMDIpLhg489TQApJyVtQynEFcwUClMhBhkvq8',
  logSheet: 'WebApp_Log',
  /* แท็บ query ของชีตนี้เป็น ARRAYFORMULA (VLOOKUP กลับไป Index) — ปุ่ม rebuild = สั่งคำนวณสูตรใหม่
     ต่างจาก OIL/BBL ที่ query เป็นค่าจริงและต้องสร้างแถวใหม่ทั้งแท็บ */
  queryMode: 'formula',
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
  queryMode: 'rows',                       // query เป็นค่าจริง — rebuildQuerySheet_() ในสคริปต์ของชีต
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
}, {
  key: 'bbloil',
  label: 'BBL',
  sublabel: 'OIL 1/4/5/6',
  color: '#1E4B9E',                        // น้ำเงินแบงก์กรุงเทพ
  fileLabel: 'EDC BBL OIL',
  ssId: '1HgQ4OS-cDuyhuJkv1ZOC0xvkXBV5Qeg3wpx-NsVcZjs',
  logSheet: 'WebApp_Log',
  queryMode: 'rows',                       // query เป็นค่าจริง — rebuildQuerySheet() ในสคริปต์ของชีต
  rawSheet: 'BBL eTax Invoices',           // 17 คอลัมน์ ตำแหน่ง MERCHANT/TAX/BRANCH เหมือน K-Bank แต่ BC อยู่ N + มี PDF/STATUS
  indexSheet: 'index',                     // A=ลำดับ B=MERCHANT_ID C=BC D=DATABASE E=BRANCH_NAME F=หมายเหตุ
  indexEditable: false,                    // ชีตของบัญชี wattanaoil — ดูอย่างเดียว แก้ที่ชีตต้นทาง
  indexSchema: { order: true,
    fields: ['MERCHANT_ID', 'รหัสสาขา BC', 'DATABASE', 'BRANCH_NAME', 'หมายเหตุ'] },
  /* BBL: คอลัมน์ BC ในชีตดิบเป็นแค่ cache — ของจริงถูกคำนวณตอน rebuild query จาก index
     จึงตรวจค่าว่างที่แท็บ query ตรงๆ แล้ว join กลับหา MERCHANT ผ่านเลข TAX ในชีตดิบ */
  health: { mode: 'query' },
  tabs: [
    { key: 'query', label: 'รายการ (Query)', sheet: 'query',
      dateCol: 'PROCESS DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL AMT', 'ค่าใช้จ่าย', 'NET CREDIT AMT'], exclude: [] },
    { key: 'raw', label: 'ข้อมูลดิบ', sheet: 'BBL eTax Invoices',
      dateCol: 'PROCESS_DATE', storeCol: 'รหัสสาขา BC',
      sum: ['TOTAL_AMT', 'ค่าใช้จ่าย', 'NET_CREDIT_AMT'], exclude: [] },
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
    appVersion: appVersionLabel_(),
    manualUrl: PropertiesService.getScriptProperties().getProperty('APP_MANUAL_URL') || '',
    appName: PropertiesService.getScriptProperties().getProperty('APP_NAME') || 'ระบบขึ้นเงินบัตรเครดิต',
    appDesc: PropertiesService.getScriptProperties().getProperty('APP_DESC') || '',
    appIcon: getAppIcon_(),
    user: getUserEmail_(),
    maxRows: MAX_ROWS,
    sources: SOURCES.map(function (s) {
      return {
        key: s.key, label: s.label, sublabel: s.sublabel || '',
        color: s.color || '#0E6E5C', fileLabel: s.fileLabel || s.label,
        canSync: true,
        queryMode: s.queryMode || 'rows',
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

/* PIN ผู้ดูแลเก็บเป็น sha256(pin + '|' + salt) ไม่เก็บตัวเลขตรง ๆ
   แพตเทิร์นเดียวกับแอปอื่นของกลุ่ม · salt สุ่มครั้งเดียวต่อโปรเจกต์
   คนที่เปิด Script Properties ดูจึงย้อนกลับเป็นตัว PIN ไม่ได้ */

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

/* คืน hash ที่เก็บไว้ พร้อมย้ายของเก่าให้อัตโนมัติ
   - hex 64 ตัว  = เป็น hash อยู่แล้ว
   - ตัวเลข 6 หลัก = ของเดิมที่เก็บเป็น plaintext → เข้ารหัสทับให้ครั้งเดียว PIN เดิมยังใช้ได้
   - ว่าง/ผิดรูป   = ตั้งเป็นค่าเริ่มต้น แต่ปักธง PIN_IS_DEFAULT ไว้เพื่อเตือนในหน้าตั้งค่า
     (ของเดิมตกกลับไป 123456 เงียบ ๆ โดยไม่มีอะไรบอก) */
function adminPinHash_() {
  var p = PropertiesService.getScriptProperties();
  var v = String(p.getProperty('ADMIN_PIN') || '').trim();

  if (/^[0-9a-f]{64}$/.test(v)) return v;

  if (/^\d{6}$/.test(v)) {
    var h = hashPin_(v);
    p.setProperty('ADMIN_PIN', h);
    p.deleteProperty('PIN_IS_DEFAULT');
    log_('ย้าย PIN เป็นแบบเข้ารหัส', 'ของเดิมเก็บเป็นตัวเลขตรง ๆ — PIN เดิมยังใช้ได้ตามปกติ');
    return h;
  }

  var d = hashPin_(PIN_DEFAULT);
  p.setProperty('ADMIN_PIN', d);
  p.setProperty('PIN_IS_DEFAULT', '1');
  log_('ตั้ง PIN เริ่มต้น', 'ไม่พบ ADMIN_PIN ที่ใช้ได้ — ตั้งค่าเริ่มต้นและปักธงเตือน');
  return d;
}

/** จริง = PIN ยังเป็นค่าเริ่มต้น หน้าตั้งค่าจะขึ้นแถบเตือนสีแดง */
function pinIsDefault_() {
  return PropertiesService.getScriptProperties().getProperty('PIN_IS_DEFAULT') === '1';
}

function assertPin_(pin) {
  if (hashPin_(pin) !== adminPinHash_()) throw new Error('เฉพาะผู้ดูแลระบบ — PIN ไม่ถูกต้อง');
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
      var lt = cellTs_(values[lr][dateIdxRaw]);
      if (lt !== null && (latestTs === null || lt > latestTs)) latestTs = lt;
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
      var ts = cellTs_(row[dateIdxRaw]);
      if (ts === null) continue;
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
    var mode = (src.health && src.health.mode) || 'raw';
    var ss = SpreadsheetApp.openById(src.ssId);
    var miss = {}, order = [], total = 0;
    var add = function (mid, bname, n) {
      mid = mid || '(ไม่มี MERCHANT_ID)';
      if (!miss[mid]) { miss[mid] = { id: mid, name: bname || '', count: 0 }; order.push(mid); }
      miss[mid].count += n;
      if (bname && !miss[mid].name) miss[mid].name = bname;
      total += n;
    };

    if (mode === 'query') {
      /* BBL: ความจริงอยู่ที่ query (ถูก rebuild จาก index ตอน Sync)
         query ไม่มีคอลัมน์ MERCHANT → join กลับผ่านเลข TAX ในชีตดิบ */
      var qname = '';
      for (var t = 0; t < src.tabs.length; t++) if (src.tabs[t].key === 'query') qname = src.tabs[t].sheet;
      var qs = ss.getSheetByName(qname);
      if (!qs) return { ok: true, rows: 0, merchants: [] };
      var taxInfo = {};
      var rs = ss.getSheetByName(src.rawSheet);
      if (rs) {
        var rv = rs.getDataRange().getValues();
        for (var i = 1; i < rv.length; i++) {
          var rtax = String(rv[i][5] == null ? '' : rv[i][5]).trim();
          if (rtax && !taxInfo[rtax]) {
            taxInfo[rtax] = {
              id: String(rv[i][4] == null ? '' : rv[i][4]).trim(),
              name: String(rv[i][3] == null ? '' : rv[i][3]).trim()
            };
          }
        }
      }
      var qv = qs.getDataRange().getValues();
      var missingTax = {};
      for (var q = 1; q < qv.length; q++) {
        var qtax = String(qv[q][1] == null ? '' : qv[q][1]).trim();
        if (!qtax) continue;
        var qbc = String(qv[q][7] == null ? '' : qv[q][7]).trim();
        if (qbc) continue;
        if (!missingTax[qtax]) missingTax[qtax] = 0;
        missingTax[qtax]++;
      }
      Object.keys(missingTax).forEach(function (tax) {
        var info = taxInfo[tax] || { id: '(ไม่พบในชีตดิบ)', name: 'TAX ' + tax };
        add(info.id, info.name, missingTax[tax]);
      });
    } else {
      /* K-Bank: ชีตดิบมี ARRAYFORMULA/ค่าจริง — สแกนตำแหน่งคอลัมน์ตรงๆ */
      var sh = ss.getSheetByName(src.rawSheet);
      if (!sh) return { ok: true, rows: 0, merchants: [] };
      var values = sh.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        var tax = String(values[r][5] == null ? '' : values[r][5]).trim();
        if (!tax) continue;                                 // แถวว่าง/ไม่ใช่รายการ
        var bc = String(values[r][12] == null ? '' : values[r][12]).trim();
        if (bc) continue;                                   // จับคู่แล้ว
        add(String(values[r][4] == null ? '' : values[r][4]).trim(),
            String(values[r][3] == null ? '' : values[r][3]).trim(), 1);
      }
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
      var rng = sh.getRange(2, 1, out.length, width);
      /* บังคับทั้งบล็อกเป็น "ข้อความล้วน" ก่อนเขียน — สำคัญมาก
         ถ้าปล่อยเซลล์เป็นรูปแบบ "อัตโนมัติ" Sheets จะแปลง MERCHANT_ID 15 หลัก
         จากข้อความเป็นตัวเลข แล้ว VLOOKUP ที่ชีตดิบใช้เทียบจะไม่ตรง
         → คอลัมน์ BC ว่างทั้งแผ่น ปุ่ม Export โดนล็อก (เกิดจริงมาแล้ว 10 ก.ย. 2569)
         คอลัมน์ "สาขา" ก็โดนด้วย — "003" เคยกลายเป็น 3 มาแล้ว */
      rng.setNumberFormat('@');
      rng.setValues(out);
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
             message: 'ยังไม่ได้ตั้งค่า Sync URL / Token — ให้ผู้ดูแลกรอกใน ตั้งค่าระบบ' };
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

/* ====================== Rebuild query (admin) ====================== */
/* แท็บ query คือแท็บที่ทั้งแอปใช้คิดยอด แต่เดิมสั่งสร้างใหม่ได้จากเมนูในชีตเท่านั้น
   ปุ่มนี้ยิง action=rebuild ไป SyncEndpoint ตัวเดียวกับ Sync — ไม่แตะ Gmail จึงเร็วและไม่กิน quota
     · wcoil6  → query เป็น ARRAYFORMULA  = เขียนสูตรเดิมทับตัวเองเพื่อบังคับ recalc
     · oilpark → rebuildQuerySheet_()      = สร้างแถวใหม่ทั้งแท็บจากชีตดิบ + index
     · bbloil  → rebuildQuerySheet()       = สร้างแถวใหม่ทั้งแท็บจากชีตดิบ + index
   จำกัดเฉพาะผู้ดูแล เพราะเป็นการ "เขียนชีต" ไม่ใช่การอ่าน */

function startRebuild(pin, sourceKey) {
  assertPin_(pin);
  var src = srcOf_(sourceKey);
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL_' + src.key);
  var token = props.getProperty('SYNC_TOKEN_' + src.key);
  if (!url || !token) {
    return { ok: false, reason: 'notconfigured',
             message: 'ยังไม่ได้ตั้งค่า Sync URL / Token ของชิปนี้ — กรอกใน ตั้งค่าระบบ ก่อน' };
  }

  var lastTs = Number(props.getProperty('REBUILD_APP_TS_' + src.key) || 0);
  var now = Date.now();
  if (now - lastTs < REBUILD_COOLDOWN_SEC * 1000) {
    return { ok: false, reason: 'cooldown',
             waitSec: Math.ceil((REBUILD_COOLDOWN_SEC * 1000 - (now - lastTs)) / 1000) };
  }

  var full = url + (url.indexOf('?') > -1 ? '&' : '?') +
             'token=' + encodeURIComponent(token) + '&action=rebuild';
  var data;
  try {
    var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
    data = JSON.parse(resp.getContentText());
  } catch (e) {
    /* ได้ HTML แทน JSON = endpoint ถูก deploy เป็น "Anyone with Google account" หรือ URL เป็นเวอร์ชันเก่า */
    return { ok: false, reason: 'error',
             message: 'เรียก Endpoint ไม่สำเร็จ — ตรวจว่า deploy เป็น Web app แบบ Anyone ' +
                      'และ endpoint เวอร์ชันที่ใช้อยู่รองรับ action=rebuild แล้ว' };
  }
  if (!data || !data.ok) {
    if (data && data.error === 'cooldown') return { ok: false, reason: 'cooldown', waitSec: data.waitSec || 30 };
    return { ok: false, reason: 'error',
             message: 'สร้างตาราง query ใหม่ไม่สำเร็จ: ' + ((data && data.error) || 'ไม่ทราบสาเหตุ') };
  }

  props.setProperty('REBUILD_APP_TS_' + src.key, String(now));
  var unknown = data.unknownMerchants || [];
  log_('สร้างตาราง query ใหม่ (' + src.key + ')',
       'mode=' + (data.mode || '-') + ' · แถว ' + (data.rebuilt == null ? '-' : data.rebuilt) +
       (unknown.length ? ' · MERCHANT ที่ยัง map ไม่ได้ ' + unknown.length + ': ' + unknown.join(', ') : ''));

  return {
    ok: true,
    mode: data.mode || 'rows',
    rebuilt: data.rebuilt == null ? null : data.rebuilt,
    unknownMerchants: unknown,
    warnings: data.warnings || [],
    at: data.at || '',
    health: checkHealth_(src)          // แบนเนอร์แดง/ปุ่ม export ต้องอัปเดตตามผลใหม่ทันที
  };
}

function lastSyncInfo_(sourceKey) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('SYNC_LAST_INFO_' + sourceKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ====================== Settings (admin) ====================== */

/* หน้า เดียวเห็น config ของทุกชิป — ไม่ผูกกับชิปที่เลือกอยู่ */
/* ---------- ไอคอนป้ายแอป ----------
   Script Property เก็บได้ 9KB ต่อค่า ซึ่งไม่พอกับ data URI ของรูป
   จึงหั่นเก็บเป็นก้อนละ 8000 ตัวอักษร APP_ICON_0..n แล้วต่อกลับตอนอ่าน
   (โควตารวมของ store คือ 500KB — ไอคอน 96x96 ใช้ไม่ถึง 10% ) */
var ICON_CHUNK = 8000;
var ICON_MAX_CHARS = 200000;     // ~150KB หลังถอด base64 — เผื่อไว้มากแล้วสำหรับ 96x96

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
  for (var i = 0; i < old; i++) props.deleteProperty('APP_ICON_' + i);   // ล้างของเดิมก่อนเสมอ

  var v = String(dataUri || '').trim();
  if (!v) { props.deleteProperty('APP_ICON_N'); return 0; }
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(v)) {
    throw new Error('ไฟล์ไอคอนต้องเป็นรูปภาพ (PNG / JPEG / WebP)');
  }
  if (v.length > ICON_MAX_CHARS) {
    throw new Error('ไฟล์ไอคอนใหญ่เกินไป — ลองใช้รูปที่เรียบง่ายกว่านี้');
  }
  var k = 0;
  for (var pos = 0; pos < v.length; pos += ICON_CHUNK) {
    props.setProperty('APP_ICON_' + k, v.substr(pos, ICON_CHUNK));
    k++;
  }
  props.setProperty('APP_ICON_N', String(k));
  return k;
}

/** ปิดบัง token ก่อนส่งออกไปหน้าเว็บ — pattara-setting ข้อ 5 ห้ามคืนค่าจริงเด็ดขาด */
function maskToken_(t) {
  t = String(t || '');
  if (!t) return '';
  return t.length <= 8 ? '••••••' : (t.slice(0, 3) + '……' + t.slice(-4));
}

function getSettings(pin) {
  assertPin_(pin);
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    pinIsDefault: pinIsDefault_(),
    manualUrl: props.getProperty('APP_MANUAL_URL') || '',
    appName: props.getProperty('APP_NAME') || 'ระบบขึ้นเงินบัตรเครดิต',
    appDesc: props.getProperty('APP_DESC') || '',
    appIcon: getAppIcon_(),
    appVersion: appVersionLabel_(),
    sources: SOURCES.map(function (s) {
      var tk = props.getProperty('SYNC_TOKEN_' + s.key) || '';
      return {
        key: s.key, label: s.label, sublabel: s.sublabel || '',
        syncUrl: props.getProperty('SYNC_URL_' + s.key) || '',
        hasToken: !!tk,
        tokenMask: maskToken_(tk)
      };
    })
  };
}

/** ยิงปลายทางจริงด้วย token ที่ผิดจงใจ — ไม่มีผลข้างเคียง แต่บอกได้ว่าปลายทางเป็นอะไร */
function testSyncEndpoint(pin, key) {
  assertPin_(pin);
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL_' + key) || '';
  var tk = props.getProperty('SYNC_TOKEN_' + key) || '';
  if (!url) return { ok: false, message: 'ยังไม่ได้ตั้ง Sync URL ของชิปนี้' };
  if (!tk)  return { ok: false, message: 'ยังไม่ได้ตั้ง Sync Token ของชิปนี้' };
  try {
    var full = url + (url.indexOf('?') > -1 ? '&' : '?') + 'token=CONNECTION_TEST_WRONG';
    var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
    var body = String(resp.getContentText() || '');
    if (body.charAt(0) === '{') {
      var d = {};
      try { d = JSON.parse(body); } catch (e) {}
      if (d.error === 'invalid token') {
        return { ok: true, message: 'เชื่อมต่อได้ ปลายทางตอบเป็น JSON และตรวจ token ถูกต้อง' };
      }
      return { ok: true, message: 'เชื่อมต่อได้ ปลายทางตอบ: ' + body.slice(0, 160) };
    }
    if (body.indexOf('accounts.google.com') > -1 || body.indexOf('ServiceLogin') > -1) {
      return { ok: false, message: 'ปลายทางบังคับให้ล็อกอิน — ต้อง deploy เป็น Web app โดยตั้ง "ผู้ที่มีสิทธิ์เข้าถึง" เป็น ทุกคน (ไม่ใช่ ทุกคนที่มีบัญชี Google)' };
    }
    if (body.indexOf('doGet') > -1) {
      return { ok: false, message: 'ปลายทางยังชี้เวอร์ชันเก่าที่ไม่มี doGet — ต้องปั๊มเวอร์ชันใหม่แล้ว redeploy' };
    }
    return { ok: false, message: 'ปลายทางไม่ได้ตอบเป็น JSON — ตรวจว่า URL ลงท้ายด้วย /exec และเป็นของชิปนี้จริง' };
  } catch (e) {
    return { ok: false, message: 'เรียกไม่สำเร็จ: ' + ((e && e.message) || e) };
  }
}

/**
 * บันทึกทีละส่วนตามปุ่มที่กด (pattara-setting ข้อ 4 — ไม่มีปุ่มบันทึกรวม)
 * obj.section = 'brand' | 'conn' | 'pin'
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
    if (obj.iconAction === 'set')    { var k = setAppIcon_(obj.appIcon); iconNote = ' · เปลี่ยนไอคอน (' + k + ' ก้อน)'; }
    else if (obj.iconAction === 'clear') { setAppIcon_(''); iconNote = ' · ลบไอคอน'; }
    log_('บันทึกป้ายแอป', 'ชื่อ/คำอธิบาย/ลิงก์คู่มือ' + iconNote);
    return { ok: true, section: 'brand', appIcon: getAppIcon_() };
  }

  if (section === 'conn') {
    var known = {};
    SOURCES.forEach(function (s) { known[s.key] = true; });
    var touched = [], tokenChanged = [];
    (obj.sources || []).forEach(function (e) {
      if (!e || !known[e.key]) return;                       // key แปลกปลอม = เมิน
      if (typeof e.syncUrl === 'string') props.setProperty('SYNC_URL_' + e.key, e.syncUrl.trim());
      /* token: ส่งมาเป็นสตริงว่าง = ไม่แตะของเดิม · ส่ง clearToken = ล้างทิ้ง */
      if (e.clearToken) { props.deleteProperty('SYNC_TOKEN_' + e.key); tokenChanged.push(e.key); }
      else if (typeof e.syncToken === 'string' && e.syncToken.trim()) {
        props.setProperty('SYNC_TOKEN_' + e.key, e.syncToken.trim());
        tokenChanged.push(e.key);
      }
      touched.push(e.key);
    });
    log_('บันทึกการเชื่อมต่อ',
      'URL (' + touched.join(', ') + ')' +
      (tokenChanged.length ? ' · เปลี่ยน token (' + tokenChanged.join(', ') + ')' : ''));   // ไม่เขียนค่า token ลง log
    return { ok: true, section: 'conn', tokenChanged: tokenChanged.length };
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

/* ====================== Helpers ====================== */

/* คืน timestamp จากค่าเซลล์วันที่ — รองรับทั้ง Date จริง และข้อความ dd/MM/yyyy (เช่น query ของ BBL) */
function cellTs_(v) {
  if (v instanceof Date) return v.getTime();
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v == null ? '' : v).trim());
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
  return null;
}

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
