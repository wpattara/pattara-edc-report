/**
 * tests/render_app.js — ประกอบ Index.html / Manual.html แบบที่ Apps Script จะเรนเดอร์ (แทน scriptlet ด้วยค่าจำลอง)
 * ใส่ stub ของ google.script.run แล้วเปิดดูใน Chrome headless · ใช้ก่อน push ทุกครั้งที่แตะ HTML
 *
 * รัน:  node tests/render_app.js <outdir>
 * ได้ <outdir>/preview_app.html · preview_manual.html · preview_noconf.html (ยังไม่ตั้งค่าชีต)
 * พรีวิว: #user = เข้าแบบผู้ใช้ · #admin = ผู้ดูแล · ต่อท้าย -daily / -branch / -unit / -settings / -conn / -share / -tech · #mini = ย่อแถบซ้าย
 */
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var out = process.argv[2] || path.join(root, 'tests', 'out');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

var url = 'https://script.google.com/macros/s/AKfycbTESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec';
var COLS = [
  { k:'date', th:'วันที่', type:'date' }, { k:'bank', th:'ธนาคาร', type:'text' }, { k:'unit', th:'หน่วยงาน', type:'text' },
  { k:'invoice_no', th:'เลขที่ใบกำกับ', type:'text' }, { k:'merchant_name', th:'ชื่อร้าน', type:'text' }, { k:'branch', th:'สาขาในใบ', type:'text' },
  { k:'merchant_id', th:'MERCHANT_ID', type:'text' }, { k:'branch_code', th:'รหัสสาขา', type:'text' }, { k:'group_code', th:'กลุ่ม', type:'text' },
  { k:'items', th:'รายการในใบ', type:'num' }, { k:'sales', th:'ยอดขาย', type:'money' }, { k:'fee', th:'ค่าธรรมเนียม', type:'money' },
  { k:'vat', th:'VAT', type:'money' }, { k:'fee_vat', th:'ค่าธรรมเนียม+VAT', type:'money' }, { k:'wht', th:'หัก ณ ที่จ่าย 3%', type:'money' },
  { k:'wht_gov', th:'หัก 1% หน่วยงานรัฐ', type:'money' }, { k:'net', th:'เงินเข้าสุทธิ', type:'money' }, { k:'note', th:'หมายเหตุ', type:'text' },
  { k:'tax_id', th:'เลขผู้เสียภาษี', type:'text', tech:true }, { k:'account_no', th:'บัญชีรับเงิน', type:'text', tech:true },
  { k:'month', th:'เดือน', type:'text', tech:true }, { k:'card_types', th:'ประเภทบัตร', type:'text', tech:true },
  { k:'file', th:'ไฟล์', type:'text', tech:true }, { k:'page', th:'หน้า', type:'num', tech:true },
  { k:'extracted_at', th:'อ่านเมื่อ', type:'text', tech:true }, { k:'machine', th:'เครื่อง', type:'text', tech:true }
];
function boot(configured) {
  return JSON.stringify({
    appVersion: 'v2.0.0 · 20.10.2026', manualUrl: url + '?page=manual', appName: 'ระบบขึ้นเงินบัตรเครดิต EDC', appDesc: '',
    appIcon: process.env.PREVIEW_ICON || '', appUrl: url, maxRows: 20000, cols: COLS, sumCols: ['sales', 'fee_vat', 'wht', 'net'],
    etaxUrl: configured ? url : '', configured: configured, banks: configured ? ['KBANK', 'TTB', 'KTB', 'BBL', 'KRUNGSRI'] : [], bankIcons: {}, error: ''
  });
}
// แถวจำลอง: ตรงกับโครง COLS (ค.ศ. dd/MM/yyyy · เงินเป็นตัวเลข · บางแถวรหัสสาขาว่าง)
function row(d, bank, unit, inv, name, br, mid, bc, gc, items, sales, fee, vat, wht, whtg, note) {
  var fv = Math.round((fee + vat) * 100) / 100, net = Math.round((sales - fv - whtg) * 100) / 100;
  return [d, bank, unit, inv, name, br, mid, bc, gc, items, sales, fee, vat, fv, wht, whtg, net, note || '',
          '0655567002551', 'xxx-x-x1848-x', '10-2026', '', bank + '\\' + unit + '\\10-2026\\x.pdf', 1, '17-10-2026 16:23:57', 'DESKTOP-53TIVN1'];
}
var ROWS = [
  row('01/10/2026', 'KBANK', 'Amazon', '011026E00003537', 'บจก.วรวัฒน์คาเฟ่', 'สำนักงานใหญ่', '401010204957001', 'A1', 'amz', 1, 65, 0.55, 0.04, 0.02, 0),
  row('01/10/2026', 'KBANK', 'Amazon', '011026E00003770', 'บจก.วรวัฒน์คาเฟ่', 'สาขา 00002', '401010307983001', '', '', 3, 185, 1.44, 0.10, 0.04, 0),
  row('02/10/2026', 'TTB', 'OIL1-4', '001021026/0257-1', 'บจก.วัฒนาออยล์แอนด์เซอร์วิส', 'สำนักงานใหญ่', '110164316', 'A4', 'oil1', '', 3884.40, 19.42, 1.36, 0, 0),
  row('02/10/2026', 'KTB', 'OIL1-4', '6446909-05-000381', '', 'สาขา 00004', '000001644000244', '', '', '', 13386.40, 66.93, 4.69, 2.02, 0),
  row('03/10/2026', 'BBL', 'OIL1-4', '26276-13-01061', 'WATTANA OIL & SERVICE CO.,LTD.', 'สาขา 00004', '200206578957', 'A4', 'oil1', '', 800, 4, 0.28, 0.12, 0),
  row('03/10/2026', 'KRUNGSRI', 'GRAND RIVERSIDE', '26S-1608965', '', '', '950601542', '', '', 2, 9800, 220.5, 15.44, 6.62, 0, 'ใบออกวันถัดจากรายการ (รายการ 02-10-2026)'),
  row('05/10/2026', 'KBANK', 'Amazon', '051026E00007367', 'บจก.วรวัฒน์คาเฟ่', 'สาขา 00005', '401013562257001', 'A5', 'amz', 1, 134, 1.14, 0.08, 0.03, 0),
  row('06/10/2026', 'KBANK', 'OIL1-4', '061026E00001111', 'บ.วัฒนาออยล์แอนด์เซอร์วิส จก.', 'สำนักงานใหญ่', '401012350966001', '', '', 2, 5200, 26, 1.82, 0, 0),
  row('06/10/2026', 'TTB', 'OIL1-4', '001061026/0300-1', 'บจก.วัฒนาออยล์แอนด์เซอร์วิส', 'สำนักงานใหญ่', '110164316', '', '', '', 1320, 6.6, 0.46, 0, 0),
  row('07/10/2026', 'KBANK', 'Amazon', '071026E00001234', 'บจก.วรวัฒน์คาเฟ่', 'สิงห์วัฒน์', '401015950464001', 'สิงห์วัฒน์', 'amz', 1, 210, 1.79, 0.13, 0.05, 0),
  row('07/10/2026', 'KRUNGSRI', 'THE PARK', '26S-1612000', '', '', '950602367', '', '', 1, 1500, 21, 1.47, 0.63, 0)
];
var STUB = [
  '<script>',
  '// stub ของ google.script.run สำหรับพรีวิวในเครื่อง',
  'window.google = { script: { run: null, url: { getLocation: function(cb){ cb({ parameter: {} }); } } } };',
  'var ROWS_ = ' + JSON.stringify(ROWS) + ';',
  'var COLS_ = ' + JSON.stringify(COLS) + ';',
  'function mkRun(){ var ok=function(){}, bad=function(){}; var h = {',
  '  withSuccessHandler:function(f){ ok=f; return h; }, withFailureHandler:function(f){ bad=f; return h; },',
  '  verifyPin:function(pin){ setTimeout(function(){ if(pin==="123456") ok({ok:true,pinIsDefault:true}); else bad(new Error("PIN ไม่ถูกต้อง (1/8)")); }, 0); },',
  '  ssoLogin:function(){ setTimeout(function(){ ok({ok:false,message:""}); }, 0); },',
  '  getData:function(bank, from, to){ setTimeout(function(){ var rows = ROWS_.filter(function(r){ return bank==="ALL" || r[1]===bank; });',
  '    var miss = {}; rows.forEach(function(r){ if(!r[7]){ var k=r[1]+"|"+r[6]; miss[k] = miss[k] || {bank:r[1],id:r[6],name:r[4],unit:r[2],count:0}; miss[k].count++; } });',
  '    ok({ headers: COLS_.map(function(c){return c.th;}), keys: COLS_.map(function(c){return c.k;}), rows: rows, count: rows.length, truncated:false,',
  '        latest:{iso:"2026-10-05",disp:"05/10/2026"}, ms: 812, health:{ rows: Object.keys(miss).reduce(function(a,k){return a+miss[k].count;},0), merchants: Object.keys(miss).map(function(k){return miss[k];}) },',
  '        runs:[{bank:"KBANK",at:"20-10-2026 10:04:12",status:"OK",added:"37",mode:"auto"},{bank:"TTB",at:"20-10-2026 10:05:40",status:"OK",added:"4",mode:"auto"},{bank:"KTB",at:"20-10-2026 10:06:01",status:"ERROR",added:"0",mode:"auto"},{bank:"BBL",at:"20-10-2026 10:06:30",status:"OK",added:"6",mode:"auto"},{bank:"KRUNGSRI",at:"20-10-2026 10:07:11",status:"OK",added:"3",mode:"auto"}], banks:["KBANK","TTB","KTB","BBL","KRUNGSRI"], scanned: ROWS_.length }); }, 0); },',
  '  getSettings:function(){ setTimeout(function(){ ok({ ok:true, pinIsDefault:true, sso:{set:false,masked:""}, manualUrl:"", appName:"ระบบขึ้นเงินบัตรเครดิต EDC", appDesc:"", appIcon:"", appVersion:"v2.0.0 · 20.10.2026",',
  '    ssId:"1JDqMLV8o6waHanXuN1lsjDxVTCRH6eC0QCJBHk94XYE", ssName:"ETAX EDC — MASTER", ssUrl:"https://docs.google.com/spreadsheets/d/1JDqMLV8o6waHanXuN1lsjDxVTCRH6eC0QCJBHk94XYE/edit", etaxUrl:"' + url + '" }); }, 0); },',
  '  testMaster:function(){ setTimeout(function(){ ok({ok:true, message:"เชื่อมต่อได้ — ETAX EDC — MASTER · KBANK 1,113 แถว · TTB 161 แถว"}); }, 0); },',
  '  saveSettings:function(){ setTimeout(function(){ ok({ok:true, message:"บันทึกแล้ว"}); }, 0); }',
  '}; return h; }',
  'window.google.script.run = new Proxy({}, { get:function(t,k){ var r = mkRun(); return typeof r[k]==="function" ? r[k].bind(r) : r[k]; } });',
  '// ป้ายวัดล้นจอ (พรีวิวเท่านั้น)',
  'setInterval(function(){ var p = document.getElementById("ovp") || document.body.appendChild(Object.assign(document.createElement("div"), { id:"ovp", style:"position:fixed;left:0;bottom:0;z-index:999;background:#000;color:#0f0;font:11px monospace;padding:2px 5px" }));',
  '  var sw = document.documentElement.scrollWidth, iw = window.innerWidth; p.textContent = "w " + iw + " sw " + sw + (sw > iw ? " OVERFLOW" : " ok"); p.style.color = sw > iw ? "#f66" : "#0f0"; }, 300);',
  'window.addEventListener("load", function(){ var h = location.hash;',
  '  if(h.indexOf("mini")!==-1){ document.getElementById("sidebar").classList.add("mini"); }',
  '  if(h.indexOf("#user")===0 || h.indexOf("#admin")===0){ setTimeout(function(){',
  '    if(h.indexOf("#admin")===0){ S.pin="123456"; enterApp("admin"); } else enterApp("user");',
  '    var part = h.split("-")[1];',
  '    var go = { daily:function(){ setView("daily"); }, branch:function(){ setView("branch"); }, unit:function(){ setView("unit"); },',
  '               tech:function(){ document.getElementById("chkTech").checked=true; S.tech=true; renderTable(); },',
  '               settings:function(){ openSettings(); }, conn:function(){ openSettings(); setTimeout(function(){ setTab("C"); }, 60); },',
  '               share:function(){ openShare(); }, oil:function(){ S.unit="OIL1-4"; renderPills(); renderHealth(); renderAll(); }, br:function(){ S.unit="OIL1-4"; S.branch="สาขา 00004"; renderPills(); renderAll(); }, bank:function(){ S.unit="OIL1-4"; S.bank="TTB"; renderPills(); renderAll(); } };',
  '    if(part && go[part]) setTimeout(go[part], 150); }, 30); } });',
  '</script>'
].join('\n');

function build(file, outName, configured) {
  var html = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  if (file === 'Index.html') {
    var n = (html.match(/<\?!= bootstrap \?>/g) || []).length;
    if (n !== 1) throw new Error(file + ': scriptlet bootstrap ไม่ครบ ' + n);
    html = html.replace('<?!= bootstrap ?>', boot(configured));
    html = html.replace('<script>var BOOTSTRAP', STUB + '\n<script>var BOOTSTRAP');
  } else {
    html = html.replace('<?!= boot ?>', JSON.stringify({ appName: 'ระบบขึ้นเงินบัตรเครดิต EDC', appVersion: 'v2.0.0 · 20.10.2026', appIcon: '', today: '20/10/2026' }));
  }
  if (/<\?!?=/.test(html)) throw new Error(file + ': ยังมี scriptlet เหลืออยู่');
  var open = (html.match(/<div\b/g) || []).length, close = (html.match(/<\/div>/g) || []).length;
  console.log(file + ' → ' + outName + ' · div ' + open + '/' + close + (open === close ? ' ok' : ' ❌ MISMATCH'));
  fs.writeFileSync(path.join(out, outName), html);
}
build('Index.html', 'preview_app.html', true);
build('Index.html', 'preview_noconf.html', false);
build('Manual.html', 'preview_manual.html', true);
console.log('เสร็จ → ' + out);
