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
 ************************************************************/

const SYNC_TOKEN = 'bbl-etax-7429-sync';   // 🔒 ต้องตรงกับที่กรอกใน ⚙️ ของเว็บแอป
const SYNC_COOLDOWN_SEC = 60;              // กันยิงถี่ฝั่ง endpoint (ฝั่งแอปกัน 2 นาทีอีกชั้น)

function doGet(e)  { return handleSync_(e); }
function doPost(e) { return handleSync_(e); }

function handleSync_(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o))
                                 .setMimeType(ContentService.MimeType.JSON);
  try {
    const token = e && e.parameter && e.parameter.token;
    if (token !== SYNC_TOKEN) return out({ ok: false, error: 'invalid token' });

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
