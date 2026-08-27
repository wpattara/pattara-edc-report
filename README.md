# pattara-edc-report — ระบบรายการตัดบัตรเครดิต (EDC)

เว็บแอปดูรายการตัดบัตรเครดิตจากเครื่อง EDC กสิกร · กรองช่วงวัน/สาขา · สรุปยอด · export CSV/Excel/PDF

> ⚠️ **Private repo** — โค้ดมี `SYNC_TOKEN`, MERCHANT_ID และรหัสสาขาจริง ห้ามเปลี่ยนเป็น public

## โครงสร้าง

| โฟลเดอร์ | คืออะไร | Script ID | เจ้าของ |
|---|---|---|---|
| `webapp/` | เว็บแอป EDC (standalone) | `1U4ZESWN34ap6GS9H1FNMgifECixWH1kTcDuhyqQRrQuT8TZOMgUuioEG` | — |
| `sheet-oil/` | `EDC SYSTEM` — ดึงเมล + SyncEndpoint (bound ชีต OIL) | `144N888kFBMB8c2L7z8hkdVJ9c15yV__Iq04EdLeLon8rlZeaXNvxi8PX` | **wattanaoil123@gmail.com** |
| `sheet-amazon/` | ฝั่ง wc_oil6 Amazon — **ยังไม่ได้ดึงลงมา** | (ยังไม่ทราบ) | — |

แต่ละโฟลเดอร์มี `.clasp.json` ของตัวเอง → `cd webapp && clasp pull` แยกกันได้

## ชีตข้อมูล

| ชิปในแอป | ชีต | Spreadsheet ID | เจ้าของ |
|---|---|---|---|
| `wcoil6` — K-Bank · wc_oil6 Amazon | — | `1EcgNdmrMDIpLhg489TQApJyVtQynEFcwUClMhBhkvq8` | — |
| `oilpark` — K-Bank · OIL 1/4/5/6 · TT/TK | `KBANK EDC SYSTEM - OIL1/OIL4/TT/TK/OIL5/OIL6` | `1nCk-2Hr_t6NJFJszypCcHrpgJqnAVZVnhTtfYuPHUKM` | **wattanaoil123@gmail.com** |

## 🔥 กติกาเหล็ก: ใครเป็นคน Deploy

Sync endpoint deploy แบบ **Execute as: Me** → `GmailApp.search` จะค้นเมลใน**กล่องของคนที่กด Deploy เท่านั้น**

- ฝั่ง OIL ต้อง deploy ด้วยบัญชีที่รับเมล `K-Merchant_report@kasikornbank.com` (subject `K-Merchant Reports`)
- `gm@tgrhotel.com` deploy แล้ว Sync ได้ **0 แถวตลอด** — พิสูจน์แล้ว รายงาน 18/08/2569 ระบุ `Threads found: 0`
- `worawatcafe123@gmail.com` มีสิทธิ์แค่ **Viewer** → ไม่มีปุ่ม Deploy และ `clasp create-version` ตอบ `Drive ACL permission denied`
- เจ้าของ = `wattanaoil123@gmail.com` เป็นบัญชีเดียวที่ให้สิทธิ์และ deploy ได้
- แต่ละบัญชีต้องเปิด Apps Script API ครั้งเดียวที่ https://script.google.com/home/usersettings ก่อนใช้ clasp

## Branch

`appsscript` = กระจกคลาวด์ · `vscode` = สายที่แก้ในเครื่อง · `main` = ที่ deploy แล้ว

## หนี้ที่ยังค้าง

- `ADMIN_PIN` ของเว็บแอปเก็บเป็น plaintext ใน Script Properties และ**ตกกลับไปใช้ `123456` เงียบ ๆ** ถ้าค่าผิดรูป
- เว็บแอปตั้ง `ANYONE_ANONYMOUS` + login กั้นฝั่ง client เท่านั้น = ข้อมูลยอดทุกสาขาเปิดสาธารณะให้คนมีลิงก์
- `SYNC_TOKEN` hardcode อยู่ในโค้ด `sheet-oil/SyncEndpoint-OIL.js` ควรย้ายไป Script Properties
- `sheet-amazon/` ยังไม่ได้ดึงลง repo
- ฝั่ง OIL ยังไม่เคยมี versioned deployment — `/exec` ยังไม่เกิด
