/************************************************************
 * SyncEndpoint.gs — สำหรับปุ่ม 🔄 Sync (ชิป K-Bank · OIL 1/4/5/6 · TT/TK)
 * อยู่ในโปรเจกต์สคริปต์ของชีต
 *   "KBANK EDC SYSTEM - OIL1/OIL4/TT/TK/OIL5/OIL6"  (เจ้าของ: wattanaoil123@gmail.com)
 *
 * ⚠️ ต้อง Deploy ด้วยบัญชีที่รับเมล K-Merchant ของกลุ่ม OIL/Park
 *   (บัญชีเดียวกับที่ trigger ดึงเมลรายวันของชีตนี้รันอยู่ = wattanaoil123@gmail.com)
 *   เพราะ Execute as: Me → GmailApp.search จะค้นในกล่องของ "คน Deploy" เท่านั้น
 * Deploy เป็น Web app:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * จากนั้นคัดลอก URL (/exec) + TOKEN ด้านล่าง ไปกรอกในเว็บแอป EDC:
 *   login ผู้ดูแล → คลิกชิป OIL ก่อน → ⚙️ ตั้งค่าระบบ → Sync URL / Token → บันทึก
 *
 * พฤติกรรม: ตรวจ token → กันยิงถี่ (cooldown) → เรียกตัวดึงเมลของสคริปต์เดิม
 * ดึงเมลย้อนหลัง 7 วัน (สคริปต์ตระกูลนี้กันข้อมูลซ้ำอยู่แล้ว) → rebuild แท็บ query → ตอบ stats กลับ
 * ❗ ไม่ยุ่งกับ trigger รายวันเดิมของชีตนี้ — ทำงานคู่กันได้
 *
 * 🆕 action=rebuild : สร้างแท็บ query ใหม่จากข้อมูลดิบ + index ปัจจุบัน "โดยไม่แตะ Gmail"
 *   ใช้ตอนเพิ่ง map MERCHANT_ID ใหม่ใน index แล้วอยากให้ query อัปเดตทันที
 *   เร็วกว่า Sync มาก และไม่กิน quota อ่านเมล
 *   GET ...?token=<TOKEN>&action=rebuild
 ************************************************************/

const SYNC_TOKEN = 'oilpark-kbank-5183-sync';  // 🔒 ต้องตรงกับที่กรอกใน ⚙️ ของเว็บแอป
const SYNC_DAYS_BACK = 7;                      // ปุ่ม Sync ดึงเมลย้อนหลัง 7 วัน
const SYNC_COOLDOWN_SEC = 60;                  // กันยิงถี่ฝั่ง endpoint (ฝั่งแอปกัน 2 นาทีอีกชั้น)
const SYNC_REBUILD_QUERY = true;               // sync แล้ว rebuild แท็บ query ต่อ (แอป EDC อ่านแท็บนี้)
const REBUILD_COOLDOWN_SEC = 30;               // cooldown แยกของ action=rebuild (ไม่แตะเมล จึงถี่กว่าได้)

/* ธงบอกสคริปต์เดิมว่า "รอบนี้มาจากปุ่ม Sync" → ไม่ต้องส่งเมลรายงาน (ดู sendReport_ ใน Code.js) */
var SYNC_SILENT_ = false;

function doGet(e)  { return handleSync_(e); }
function doPost(e) { return handleSync_(e); }

/**
 * สะพานไปสคริปต์ดึงเมลของชีตนี้
 * ชื่อจริงคือ processKMerchantEmails_(daysBack) และรับ "จำนวนวัน" เป็นตัวเลข ไม่ใช่ object
 * แล้วแปลงชื่อคีย์ stats ให้ตรงกับที่เว็บแอป EDC อ่าน (inserted / skipDupTax / skipDupEmail)
 */
function processEmails(opts) {
  const days = (opts && opts.daysBack) || SYNC_DAYS_BACK;

  let s;
  SYNC_SILENT_ = true;                       // กดปุ่ม Sync ไม่ต้องส่งเมลรายงานทุกครั้ง
  try { s = processKMerchantEmails_(days) || {}; }
  finally { SYNC_SILENT_ = false; }

  if (s.aborted) return { aborted: true, reason: s.reason || 'Another run is in progress.' };

  let rebuilt = null;
  if (SYNC_REBUILD_QUERY) {
    const r = rebuildQuerySheet_() || {};    // แท็บ query ของชีตนี้ไม่ใช่สูตร ต้อง rebuild เอง
    rebuilt = r.aborted ? null : (r.rebuilt || 0);
  }

  return {
    inserted:     s.rowsInserted || 0,
    skipDupTax:   s.skippedDuplicateTax || 0,
    skipDupEmail: s.skippedDuplicateMsg || 0,
    threads:      s.threadsFound || 0,
    emails:       s.emailsProcessed || 0,
    unknown:      (s.unknownMerchants || []).length,
    queryRows:    rebuilt
  };
}

/**
 * action=rebuild — สร้างแท็บ query ใหม่จากข้อมูลดิบ + index ปัจจุบัน ไม่แตะ Gmail
 * ใช้ cooldown แยกจาก Sync เพราะงานเบากว่ามาก (แค่อ่าน-เขียนชีต)
 */
function handleRebuild_(out) {
  if (typeof rebuildQuerySheet_ !== 'function') {
    return out({ ok: false,
      error: 'ไม่พบฟังก์ชัน rebuildQuerySheet_ ในโปรเจกต์นี้ — สคริปต์ของชีตนี้อาจเปลี่ยนชื่อฟังก์ชัน' });
  }

  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('REBUILD_LAST_TS') || 0);
  const now = Date.now();
  if (now - last < REBUILD_COOLDOWN_SEC * 1000) {
    return out({ ok: false, error: 'cooldown',
                 waitSec: Math.ceil((REBUILD_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
  }

  const r = rebuildQuerySheet_() || {};
  // rebuildQuerySheet_ ถือ ScriptLock เอง — ชนกับ trigger รายวันได้ ต้องบอกผู้ใช้ตรงๆ ไม่ใช่รายงานว่าสำเร็จ
  if (r.aborted) return out({ ok: false, error: r.reason || 'กำลังมีงานอื่นรันอยู่ กรุณารอสักครู่' });

  props.setProperty('REBUILD_LAST_TS', String(now));
  return out({
    ok: true,
    action: 'rebuild',
    mode: 'rows',                                   // แท็บ query ของชีตนี้เป็นค่าจริง ไม่ใช่สูตร
    at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    rebuilt: r.rebuilt || 0,
    refreshed: r.refreshed || 0,
    unknownMerchants: r.unknownMerchants || [],
    warnings: r.warnings || []
  });
}

function handleSync_(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o))
                                 .setMimeType(ContentService.MimeType.JSON);
  try {
    const token = e && e.parameter && e.parameter.token;
    if (token !== SYNC_TOKEN) return out({ ok: false, error: 'invalid token' });

    if (e && e.parameter && e.parameter.action === 'rebuild') return handleRebuild_(out);

    if (typeof processKMerchantEmails_ !== 'function') {
      return out({ ok: false,
        error: 'ไม่พบฟังก์ชัน processKMerchantEmails_ ในโปรเจกต์นี้ — สคริปต์ดึงเมลของชีตนี้อาจเปลี่ยนชื่อ ให้ส่งไฟล์สคริปต์มาปรับ endpoint' });
    }

    /* ล็อกไว้แค่ช่วงเช็ค+จองคิว cooldown แล้วปล่อยทันที
       ห้ามถือยาวคร่อม processEmails เพราะข้างในขอ ScriptLock ตัวเดียวกันซ้ำ = ชนกันเอง */
    const props = PropertiesService.getScriptProperties();
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return out({ ok: false, error: 'กำลัง Sync อยู่ กรุณารอสักครู่' });
    try {
      const last = Number(props.getProperty('SYNC_LAST_TS') || 0);
      const now = Date.now();
      if (now - last < SYNC_COOLDOWN_SEC * 1000) {
        return out({ ok: false, error: 'cooldown',
                     waitSec: Math.ceil((SYNC_COOLDOWN_SEC * 1000 - (now - last)) / 1000) });
      }
      props.setProperty('SYNC_LAST_TS', String(now));   // จองคิวก่อนเริ่มงานจริง
    } finally {
      lock.releaseLock();
    }

    const stats = processEmails({ daysBack: SYNC_DAYS_BACK });
    if (stats.aborted) return out({ ok: false, error: 'กำลัง Sync อยู่ กรุณารอสักครู่' });

    return out({
      ok: true,
      at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      stats: stats
    });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}
