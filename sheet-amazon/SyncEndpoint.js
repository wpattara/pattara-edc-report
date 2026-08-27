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
 ************************************************************/

const SYNC_TOKEN = 'wcoil6-kbank-2769-sync';  // 🔒 เปลี่ยนได้ แต่ต้องแก้ใน ⚙️ ของเว็บแอปให้ตรงกัน
const SYNC_DAYS_BACK = 7;                     // ปุ่ม Sync ดึงเมลย้อนหลัง 7 วัน
const SYNC_COOLDOWN_SEC = 60;                 // กันยิงถี่ฝั่ง endpoint (ฝั่งแอปกัน 2 นาทีอีกชั้น)

function doGet(e)  { return handleSync_(e); }
function doPost(e) { return handleSync_(e); }

function handleSync_(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o))
                                 .setMimeType(ContentService.MimeType.JSON);
  try {
    const token = e && e.parameter && e.parameter.token;
    if (token !== SYNC_TOKEN) return out({ ok: false, error: 'invalid token' });

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
