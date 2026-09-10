/************************************************************
 * SyncEndpoint.gs — สำหรับปุ่ม 🔄 Sync ในเว็บแอป EDC
 * วางไฟล์นี้ "เพิ่ม" ในโปรเจกต์สคริปต์เดียวกับ K-Merchant CSV Extractor
 * (โปรเจกต์ที่ผูกกับชีต EXCEL AMAZON EDC) แล้ว Deploy เป็น Web app
 *   - Execute as: Me (บัญชีเดียวกับที่รัน trigger เดิม เพราะต้องเห็นเมล K-Merchant)
 *   - Who has access: Anyone
 * จากนั้นคัดลอก URL + TOKEN ไปกรอกในหน้า ⚙️ ของเว็บแอป
 *
 * พฤติกรรม: ตรวจ token → กันรันซ้อน → ดึงเมลย้อนหลัง 7 วัน
 * (processEmails กันซ้ำด้วย MERCHANT_ID + TAX อยู่แล้ว) → ตอบ stats กลับ
 * ❗ ไม่ส่งเมลสรุป — ผลไปแสดงในแอปแทน / trigger 23:00 เดิมทำงานตามปกติ
 *
 * 🆕 action=rebuild : บังคับให้แท็บ query คำนวณใหม่
 *   ชีตนี้ต่างจาก OIL/BBL — query เป็น ARRAYFORMULA ที่ VLOOKUP กลับไปที่ Index
 *   ปกติมันอัปเดตเองอยู่แล้ว แต่ถ้าค้าง (เพิ่งแก้ Index แล้วค่ายังว่าง) ให้เขียนสูตรเดิมทับ
 *   ตัวเอง = บังคับ recalc โดยไม่เปลี่ยนสูตร และไม่แตะข้อมูลสักแถว
 *   GET ...?token=<TOKEN>&action=rebuild
 ************************************************************/

/* 🔒 token อยู่ใน Script Properties (คีย์ SYNC_TOKEN) ไม่ใช่ในโค้ด
   ค่าข้างล่างเป็นแค่ค่าตั้งต้นตอนย้าย — เรียกครั้งแรกจะคัดลอกลง property ให้เอง ของเดิมจึงไม่พัง
   อยากเปลี่ยนเป็นค่าสุ่มเมื่อไหร่ ให้รัน rotateSyncToken() จากเอดิเตอร์
   แล้วเอาค่าที่ได้ไปกรอกใน ⚙️ ตั้งค่าระบบ ของเว็บแอป */
const SYNC_TOKEN_INIT = 'wcoil6-kbank-2769-sync';

function syncToken_() {
  const p = PropertiesService.getScriptProperties();
  let t = p.getProperty('SYNC_TOKEN');
  if (!t) { t = SYNC_TOKEN_INIT; p.setProperty('SYNC_TOKEN', t); }
  return t;
}

/** สุ่ม token ใหม่ — รันจากเอดิเตอร์ แล้วดูค่าที่ได้ใน บันทึกการดำเนินการ
 *  ⚠️ ปุ่ม 🔄 Sync ของชิปนี้จะใช้ไม่ได้ จนกว่าจะเอาค่าใหม่ไปกรอกใน ⚙️ ตั้งค่าระบบ การ์ด "K-Bank · wc_oil6 Amazon" */
function rotateSyncToken() {
  const t = 'wcoil6-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', t);
  Logger.log('SYNC_TOKEN ใหม่ = ' + t);
  Logger.log('→ ไปกรอกใน ⚙️ ตั้งค่าระบบ ของเว็บแอป การ์ด "K-Bank · wc_oil6 Amazon" แล้วกดบันทึก');
  return t;
}
const SYNC_DAYS_BACK = 7;                     // ปุ่ม Sync ดึงเมลย้อนหลัง 7 วัน
const SYNC_COOLDOWN_SEC = 60;                 // กันยิงถี่ฝั่ง endpoint (ฝั่งแอปกัน 2 นาทีอีกชั้น)
const REBUILD_COOLDOWN_SEC = 30;              // cooldown แยกของ action=rebuild (ไม่แตะเมล จึงถี่กว่าได้)
const QUERY_SHEET_NAME = 'query';             // แท็บที่เว็บแอป EDC อ่าน

function doGet(e)  { return handleSync_(e); }
function doPost(e) { return handleSync_(e); }

/**
 * action=rebuild — บังคับ ARRAYFORMULA ในแท็บ query ให้คำนวณใหม่
 * ทำโดยเขียน "สูตรเดิม" ทับตัวเอง จึงไม่มีทางทำข้อมูลหาย
 * ถ้าแท็บนี้ไม่มีสูตรเลย = โครงชีตเปลี่ยนไปจากที่เข้าใจ → บอกตรงๆ ไม่รายงานว่าสำเร็จ
 */
function handleRebuild_(out) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('REBUILD_LAST_TS') || 0);
  const now = Date.now();
  if (now - last < REBUILD_COOLDOWN_SEC * 1000) {
    return out({ ok: false, error: 'cooldown',
                 waitSec: Math.ceil((REBUILD_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
  }

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUERY_SHEET_NAME);
  if (!sh) return out({ ok: false, error: 'ไม่พบแท็บ "' + QUERY_SHEET_NAME + '" ในชีตนี้' });

  // ARRAYFORMULA อยู่แถวบนสุดของบล็อก — บางชีตวางไว้ที่ A1 (สูตรสร้างหัวตารางเอง) จึงกวาดตั้งแต่แถว 1
  const scanRows = Math.min(3, sh.getMaxRows());
  const formulas = sh.getRange(1, 1, scanRows, sh.getLastColumn() || 1).getFormulas();

  let touched = 0;
  for (let r = 0; r < formulas.length; r++) {
    for (let c = 0; c < formulas[r].length; c++) {
      const f = formulas[r][c];
      if (!f) continue;
      sh.getRange(1 + r, 1 + c).setFormula(f);     // เขียนสูตรเดิมทับ = สั่ง recalc (สูตรไม่เปลี่ยน)
      touched++;
    }
  }
  SpreadsheetApp.flush();

  if (!touched) {
    return out({ ok: false,
      error: 'แท็บ "' + QUERY_SHEET_NAME + '" ไม่มีสูตรให้คำนวณใหม่ — โครงชีตอาจถูกเปลี่ยนเป็นค่าคงที่ ' +
             'ให้ตรวจที่ชีตก่อน (ชีตนี้ควรเป็น ARRAYFORMULA)' });
  }

  props.setProperty('REBUILD_LAST_TS', String(now));
  const rows = Math.max(0, sh.getLastRow() - 1);
  return out({
    ok: true,
    action: 'rebuild',
    mode: 'formula',                                // แท็บนี้เป็นสูตร ไม่ได้เขียนแถวใหม่
    at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    rebuilt: rows,
    formulas: touched,
    unknownMerchants: [],
    warnings: []
  });
}

function handleSync_(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o))
                                 .setMimeType(ContentService.MimeType.JSON);
  try {
    const token = e && e.parameter && e.parameter.token;
    if (token !== syncToken_()) return out({ ok: false, error: 'invalid token' });

    if (e && e.parameter && e.parameter.action === 'rebuild') return handleRebuild_(out);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return out({ ok: false, error: 'กำลัง Sync อยู่ กรุณารอสักครู่' });

    try {
      const props = PropertiesService.getScriptProperties();
      const last = Number(props.getProperty('SYNC_LAST_TS') || 0);
      const now = Date.now();
      if (now - last < SYNC_COOLDOWN_SEC * 1000) {
        return out({ ok: false, error: 'cooldown',
                     waitSec: Math.ceil((SYNC_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
      }

      const stats = processEmails({ daysBack: SYNC_DAYS_BACK }); // จากไฟล์ Extractor เดิม

      props.setProperty('SYNC_LAST_TS', String(now));
      return out({
        ok: true,
        at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
        stats: stats
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}
