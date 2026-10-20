// ทดสอบฟังก์ชันล้วนในหน้า Index.html (ดึงโค้ดจริงจากไฟล์มารันใน vm) — node tests/unit_fns.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
function grab(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}|function ' + name + '\\([^)]*\\)\\{[^\\n]*\\}');
  const m = src.match(re); if (!m) throw new Error('ไม่พบฟังก์ชัน ' + name); return m[0];
}
const ctx = { BOOTSTRAP: { appUrl: 'https://script.google.com/a/macros/tgrhotel.com/s/AKfy/exec' } }; vm.createContext(ctx);
['dateKey', 'xlsxTabName', 'shareUrl', 'ddmmyyyy', 'pad', 'ymd'].forEach(n => vm.runInContext(grab(n), ctx));
let fail = 0;
function eq(label, got, want) { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log((ok ? 'ผ่าน ' : 'ไม่ผ่าน ') + label + ' → ' + JSON.stringify(got) + (ok ? '' : ' (ต้องเป็น ' + JSON.stringify(want) + ')')); }
eq('dateKey 03/10/2026 (วันก่อนเดือน)', ctx.dateKey('03/10/2026'), 20261003);
eq('dateKey 10/03/2026', ctx.dateKey('10/03/2026'), 20260310);
eq('dateKey 31/12/2026 < 01/01/2027', ctx.dateKey('31/12/2026') < ctx.dateKey('01/01/2027'), true);
eq('dateKey ข้อความอื่น', ctx.dateKey('ทั้งหมด'), null);
eq('xlsxTabName ตัดอักขระต้องห้าม', ctx.xlsxTabName('K-Bank [a]*?/\\:b'), 'K-Bank a b');
eq('xlsxTabName ยาว 40 → 31', ctx.xlsxTabName('x'.repeat(40)).length, 31);
eq('shareUrl ตัด /a/<โดเมน>/', ctx.shareUrl(), 'https://script.google.com/macros/s/AKfy/exec');
eq('ddmmyyyy', ctx.ddmmyyyy('2026-10-03'), '03-10-2026');
console.log(fail ? '\nรวม ไม่ผ่าน ' + fail : '\nรวม ผ่านทั้งหมด'); process.exit(fail ? 1 : 0);
