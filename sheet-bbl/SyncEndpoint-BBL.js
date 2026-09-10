/************************************************************
 * SyncEndpoint.gs — สำหรับปุ่ม 🔄 Sync (ชิป BBL · OIL 1/4/5/6)
 * วางไฟล์นี้ "เพิ่ม" ในโปรเจกต์สคริปต์ของชีต
 *   "EDC oil1+oil4+oil5+oil6 EXTRACTION BBL"
 * ⚠️ ต้องทำโดยบัญชีที่รับเมล e-Tax ของแบงก์กรุงเทพ
 *   (บัญชีเดียวกับที่ trigger รายวันของสคริปต์ BBL eTax รันอยู่)
 * แล้ว Deploy เป็น Web app: Execute as **Me** / access **Anyone**
 * จากนั้นคัดลอก URL (/exec) + TOKEN ไปกรอกใน ⚙️ ตั้งค่าระบบ ของเว็บแอป EDC
 * (หน้า ⚙️ เดียวเห็นทุกชิป — กรอกในการ์ด BBL)
 *
 * พฤติกรรม: ตรวจ token → เรียก runBBLETaxDaily() ของสคริปต์เดิม
 * = ดึงเมลย้อนหลัง 7 วัน + rebuild แท็บ query ให้ในตัว (กันซ้ำอยู่แล้ว)
 * แล้วแปลงข้อความสรุปเป็นตัวเลข เพิ่มใหม่/ข้ามซ้ำ ส่งกลับให้แอป
 * ❗ ไม่แตะ trigger รายวันเดิม — ทำงานคู่กันได้
 * หมายเหตุ: BBL ต้องแปลง PDF ทีละไฟล์ ถ้ามีเมลค้างเยอะอาจใช้เวลานาน
 * ปุ่มนี้เหมาะกับงานประจำวัน (เมลใหม่ไม่กี่ฉบับ = ไม่กี่วินาที)
 *
 * 🆕 action=rebuild : สร้างแท็บ query ใหม่จาก "BBL eTax Invoices" + index ปัจจุบัน
 *   โดยไม่แตะเมลและไม่แปลง PDF — ใช้ตอนเพิ่งแก้ index แล้วอยากให้ query อัปเดตทันที
 *   GET ...?token=<TOKEN>&action=rebuild
 ************************************************************/

/* 🔒 token อยู่ใน Script Properties (คีย์ SYNC_TOKEN) ไม่ใช่ในโค้ด
   ค่าข้างล่างเป็นแค่ค่าตั้งต้นตอนย้าย — เรียกครั้งแรกจะคัดลอกลง property ให้เอง ของเดิมจึงไม่พัง
   อยากเปลี่ยนเป็นค่าสุ่มเมื่อไหร่ ให้รัน rotateSyncToken() จากเอดิเตอร์
   แล้วเอาค่าที่ได้ไปกรอกใน ⚙️ ตั้งค่าระบบ ของเว็บแอป */
const SYNC_TOKEN_INIT = 'bbl-etax-7429-sync';

function syncToken_() {
  const p = PropertiesService.getScriptProperties();
  let t = p.getProperty('SYNC_TOKEN');
  if (!t) { t = SYNC_TOKEN_INIT; p.setProperty('SYNC_TOKEN', t); }
  return t;
}

/** สุ่ม token ใหม่ — รันจากเอดิเตอร์ แล้วดูค่าที่ได้ใน บันทึกการดำเนินการ
 *  ⚠️ ปุ่ม 🔄 Sync ของชิปนี้จะใช้ไม่ได้ จนกว่าจะเอาค่าใหม่ไปกรอกใน ⚙️ ตั้งค่าระบบ การ์ด "BBL · OIL 1/4/5/6" */
function rotateSyncToken() {
  const t = 'bbl-etax-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', t);
  Logger.log('SYNC_TOKEN ใหม่ = ' + t);
  Logger.log('→ ไปกรอกใน ⚙️ ตั้งค่าระบบ ของเว็บแอป การ์ด "BBL · OIL 1/4/5/6" แล้วกดบันทึก');
  return t;
}
const SYNC_COOLDOWN_SEC = 60;              // กันยิงถี่ฝั่ง endpoint (ฝั่งแอปกัน 2 นาทีอีกชั้น)
const REBUILD_COOLDOWN_SEC = 30;           // cooldown แยกของ action=rebuild (ไม่แตะเมล จึงถี่กว่าได้)

function doGet(e)  { return handleSync_(e); }
function doPost(e) { return handleSync_(e); }

/**
 * action=rebuild — สร้างแท็บ query ใหม่จากชีตดิบ + index ปัจจุบัน ไม่แตะเมล/PDF
 * rebuildQuerySheet() ของสคริปต์นี้ไม่ได้ถือ ScriptLock เอง (มีแต่ scrapeBBLETax_)
 * จึงต้องถือ lock ที่นี่ กันชนกับ trigger รายวันที่กำลังเขียนชีตดิบอยู่
 */
function handleRebuild_(out) {
  if (typeof rebuildQuerySheet !== 'function') {
    return out({ ok: false,
      error: 'ไม่พบฟังก์ชัน rebuildQuerySheet ในโปรเจกต์นี้ — ตรวจว่าวางไฟล์นี้ในสคริปต์ของชีต BBL eTax แล้ว' });
  }

  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('REBUILD_LAST_TS') || 0);
  const now = Date.now();
  if (now - last < REBUILD_COOLDOWN_SEC * 1000) {
    return out({ ok: false, error: 'cooldown',
                 waitSec: Math.ceil((REBUILD_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return out({ ok: false, error: 'มี Script อื่นกำลังทำงานอยู่ (ดึงเมล/แปลง PDF) กรุณารอสักครู่' });
  }
  let rebuilt;
  try {
    rebuilt = Number(rebuildQuerySheet()) || 0;
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }

  props.setProperty('REBUILD_LAST_TS', String(now));
  return out({
    ok: true,
    action: 'rebuild',
    mode: 'rows',                                   // แท็บ query ของชีตนี้เป็นค่าจริง ไม่ใช่สูตร
    at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    rebuilt: rebuilt,
    unknownMerchants: [],                           // BBL จดแถวที่ map ไม่ได้ลง log ของสคริปต์เอง
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

    if (typeof runBBLETaxDaily !== 'function') {
      return out({ ok: false,
        error: 'ไม่พบฟังก์ชัน runBBLETaxDaily ในโปรเจกต์นี้ — ตรวจว่าวางไฟล์นี้ในสคริปต์ของชีต BBL eTax แล้ว' });
    }

    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('SYNC_LAST_TS') || 0);
    const now = Date.now();
    if (now - last < SYNC_COOLDOWN_SEC * 1000) {
      return out({ ok: false, error: 'cooldown',
                   waitSec: Math.ceil((SYNC_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
    }

    // สคริปต์ BBL มี LockService ของตัวเอง — ถ้าชนกับ trigger จะโยนข้อความไทย จับส่งต่อให้ผู้ใช้
    let summary;
    try {
      summary = String(runBBLETaxDaily() || '');
    } catch (err) {
      return out({ ok: false, error: String((err && err.message) || err) });
    }

    props.setProperty('SYNC_LAST_TS', String(now));
    return out({
      ok: true,
      at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      stats: parseSummary_(summary),
      summary: summary
    });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

/** แปลงข้อความสรุปของสคริปต์ BBL → ตัวเลขที่เว็บแอปใช้ (หาไม่เจอ = 0) */
function parseSummary_(s) {
  const num = re => { const m = re.exec(s); return m ? parseInt(m[1], 10) : 0; };
  return {
    inserted: num(/Rows added:\s*(\d+)/i),
    skipDupTax: num(/Duplicates skipped:\s*(\d+)/i),
    skipDupEmail: 0,
    warned: num(/\((\d+)\s*with warnings\)/i),
    rejected: num(/Rejected \(identity check\):\s*(\d+)/i),
    errors: num(/Errors:\s*(\d+)/i)
  };
}
