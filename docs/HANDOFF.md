# HANDOFF — ระบบขึ้นเงินบัตรเครดิต EDC (pattara-edc-report)
> **แอปใหม่ `master-webapp/` v2.0.0** deploy @1 (20/10/2569) **ยังเปิดไม่ได้ — รอเจ้าของรัน `setup()` อนุมัติสิทธิ์** (ลิงก์ตอบ 403 จนกว่าจะอนุมัติ) · ในรีโป v2.0.0 · **แอปเก่า `webapp/` v1.13.0 @16 ยังเดินตามเดิม ไม่แตะ** · อัปเดต 20/10/2569 · คุยกับผู้ใช้: ภาษาไทย

## 1. ระบบคืออะไร / ใครใช้
ฝ่ายบัญชีใช้ดูใบกำกับภาษีค่าธรรมเนียม EDC ที่ธนาคารออกให้ตอนโอนเงินจากการรูดบัตรเข้าบัญชี (ใบละ 1 แถว: ยอดขาย ค่าธรรมเนียม VAT หัก ณ ที่จ่าย เงินเข้าสุทธิ) กรองช่วงวัน/ธนาคาร/หน่วยงาน/สาขา สรุปรายวัน-รายสาขา-รายหน่วยงาน export CSV/Excel/PDF
**20/10/2569 เจ้าของสั่ง migrate แหล่งข้อมูล**: เลิกชีตธนาคาร 3 ใบ (ดึงจาก Gmail คนละบัญชี ติดปัญหา deploy ทุกครั้ง) → อ่านชีต **ETAX EDC — MASTER** ใบเดียวของ gm@ ที่ระบบดาวน์โหลดใบกำกับ (`auto_download_etax`) เขียนให้ทุกวัน 10:00 · แอปใหม่อยู่คนละสคริปต์ **สคริปต์เก่าไม่แตะ** ปล่อยให้เดินจนเจ้าของสั่งปิด

## 2. ที่อยู่ของงาน
| อะไร | ที่ไหน |
|---|---|
| repo / branch | `wpattara/pattara-edc-report` (Private) · `vscode` = สายแก้ในเครื่อง · `main` = ที่ deploy แล้ว · `appsscript` = กระจกคลาวด์ของแอปเก่า |
| working copy | `D:\SomO\VS Code\edc_report` |
| **แอปใหม่** `master-webapp/` | scriptId `1D2MJfl1wDtAmrxUsUJkKJ9rTfqfe9s5-7GCKtRndUx_R1iSs9H9u0HY2` (standalone · gm@) · deployment prod `AKfycbwU1gu1nM-U2FPRLMOMruit164Fhp8f-5YHHV-eGw94mXe3iDezfaOI2rY9eKva6Z7ZuA` @1 · URL `https://script.google.com/macros/s/AKfycbwU1gu1nM-U2FPRLMOMruit164Fhp8f-5YHHV-eGw94mXe3iDezfaOI2rY9eKva6Z7ZuA/exec` · ?page=manual = คู่มือ |
| ชีตต้นทางแอปใหม่ | `1JDqMLV8o6waHanXuN1lsjDxVTCRH6eC0QCJBHk94XYE` "ETAX EDC — MASTER" (gm@ · timezone Asia/Bangkok · เจ้าของข้อมูลคือโปรเจกต์ `auto_download_etax` ดู HANDOFF ของมัน) · id เก็บใน Script Properties `MASTER_SS_ID` (ยังไม่ได้ตั้ง — ตั้งผ่านหน้าตั้งค่าหรือ `tests/cdp_admin.js`) |
| แอปเก่า `webapp/` | scriptId `1U4ZESWN34ap6GS9H1FNMgifECixWH1kTcDuhyqQRrQuT8TZOMgUuioEG` · prod v1.13.0 @16 deployment `AKfycbxsoU0Q…` · อ่านชีตธนาคาร 3 ใบ + endpoint `sheet-oil/ sheet-bbl/ sheet-amazon/` (รายละเอียด/กติกาบัญชี deploy อยู่ใน `README.md` ราก) |
| บัญชีที่ deploy ได้ | แอปใหม่และแอปเก่า: **gm@tgrhotel.com** เท่านั้น · endpoint ชีตธนาคาร (เก่า): wattanaoil123 / ac@ ตาม README — ไม่เกี่ยวกับแอปใหม่ |
| แอปตัวโหลดใบกำกับ (ใส่รหัสร้าน) | `https://script.google.com/macros/s/AKfycbyDhpAPI0SzGHqT1kkueseMoulESARWXdmMsQpcCTq6Z8BHRyzdbkgRV1WB0ES9sB6g/exec` (etax เว็บ 1.9.0) · ใส่ไว้ใน Script Property `ETAX_APP_URL` ของแอปใหม่ |

## 3. สถาปัตยกรรม + โครงข้อมูล (แอปใหม่)
- `Code.js` (server · อ่านอย่างเดียว): `doGet` (Index / ?page=manual) · `getData(bank, fromIso, toIso)` · `getSettings/saveSettings/testMaster` · PIN sha256+salt · `setup()` รันครั้งแรก · `Sso.js` = ไฟล์กลาง SSO Apps Center (เหมือนทุกแอป) · `Index.html` หน้าเดียว (login dual-access · ชิปธนาคาร · ตาราง · ตั้งค่า · กล่อง QR) · `Manual.html`
- **ชีต MASTER**: แท็บธนาคาร = ทุกแท็บที่ A1 = `bank` (ตอนนี้ KBANK TTB KTB BBL KRUNGSRI · ค้นหาเอง ไม่ fix รายชื่อ) หัวคอลัมน์ 27 ตัว `bank unit date date_iso month invoice_no merchant_name tax_id branch merchant_id account_no items sales fee vat fee_vat wht wht_gov net branch_code group_code file page card_types extracted_at machine note` · แท็บ `MERCHANT_MAP` (รหัสสาขา/กลุ่มต่อร้าน · แก้ที่แอป etax เท่านั้น) · `EXTRACT_LOG` (รอบอ่าน · แอปโชว์แถวล่าสุดต่อธนาคาร) · แอปสร้างแท็บซ่อน `EDC_WEBAPP_LOG` ไว้ log การตั้งค่า
- **วันที่ (พิสูจน์ 20/10/2569 จากชีตจริง)**: `date` เป็นข้อความ `dd-mm-yyyy` ค.ศ. · `date_iso` = `yyyy-mm-dd` ตรงกันทุกแถวที่ดู (Python เขียนทั้งคู่) → แอป **กรอง/เรียงด้วย `date_iso` เทียบสตริง** และแสดง `dd/MM/yyyy` ค.ศ. แปลงจาก date_iso ด้วยสตริงล้วน · อ่านชีตด้วย `getDisplayValues()` ทั้งแท็บ (เงินมี `,` → `num_()` ถอดเอง) · **ห้าม getValues** กับชีตนี้ (คอลัมน์วันที่/รหัสเป็นข้อความ @)
- COLS ใน Code.js = ลำดับ/ป้ายไทย/ชนิดคอลัมน์ที่แสดง · หาตำแหน่งคอลัมน์จากชื่อหัวแถว 1 (เรียงคอลัมน์ในชีตใหม่ได้ไม่พัง) · คอลัมน์ `tech:true` ซ่อนเป็นค่าเริ่มต้น (ติ๊ก "แสดงคอลัมน์เทคนิค")
- Script Properties: `MASTER_SS_ID` · `ETAX_APP_URL` · `APP_NAME/APP_DESC/APP_MANUAL_URL/APP_ICON_0..n/APP_ICON_N` · `ADMIN_PIN`(hash) `PIN_SALT` `PIN_IS_DEFAULT` · `PORTAL_SSO_KEY` · `APP_VERSION/_DATE` — **ไม่มีค่าสำรองในโค้ด** ยังไม่ตั้งชีต = แถบแดงบอกให้ไปตั้งค่า
- เครื่องมือ: `tests/render_app.js <outdir>` พรีวิว Chrome headless (stub google.script.run · #user/#admin-daily/-branch/-settings/-conn/-share) · `tests/unit_fns.js` · `tests/cdp_admin.js "<url>" <PIN> settings|conn <ssId> <etaxUrl>|test|data ALL 2026-10-01 2026-10-31` ขับหน้า prod จริงผ่าน DevTools (ใช้หลังเจ้าของอนุมัติสิทธิ์)

## 4. สถานะจริง (✅ / 🟡 / ❌) — 20/10/2569
- ✅ โค้ด v2.0.0 ครบ · syntax/div/unit test ผ่าน · เรนเดอร์ Chrome headless 13 สถานะ ไม่มี console error · push คลาวด์แล้ว · version 1 · deployment @1 สร้างแล้ว (manifest USER_DEPLOYING + ANYONE_ANONYMOUS)
- ❌ **ลิงก์ /exec ตอบ 403 "ต้องมีสิทธิ์เข้าถึง"** = สคริปต์ใหม่ยังไม่เคยได้รับอนุมัติสิทธิ์จาก gm@ (clasp ทำแทนไม่ได้) → เจ้าของเปิด editor รัน `setup()` กดอนุญาต แล้วลิงก์จะใช้ได้ทันที (ไม่ต้อง redeploy)
- ❌ ยังไม่ได้ตั้ง `MASTER_SS_ID` / `ETAX_APP_URL` / PIN ใหม่ / รหัส SSO — ทำได้หลังข้อบน (ผ่านหน้าตั้งค่า PIN 123456 หรือ `tests/cdp_admin.js … conn <ssId> <etaxUrl>`)
- ❌ ยังไม่ได้ verify_live กับหน้า prod (ทำไม่ได้จนกว่า 403 หาย) · ยังไม่ได้ลงทะเบียน URL ใหม่ใน Pattara Apps Center
- ✅ แอปเก่า webapp v1.13.0 + endpoint 3 ตัว ยังเดินตามเดิม ไม่ได้แตะ
- ชีต MASTER ณ 17/10: 1,578 ใบ (ก.ย.+ต.ค. 2569) · `branch_code/group_code` ว่างทั้งหมด (เจ้าของยังไม่ใส่รหัส 71 ร้านที่แอป etax) → แอปใหม่จะขึ้นแถบเหลืองเตือนทุกแถวจนกว่าจะใส่

## 5. งานค้าง (เรียงความสำคัญ)
1. **เจ้าของ**: เปิด editor สคริปต์ `1D2MJfl1…` → รัน `setup()` → อนุญาตสิทธิ์ → เปิดลิงก์ /exec ต้องเห็นหน้า login · *ติด: ต้องเจ้าของบัญชี gm@ กดเองเท่านั้น*
2. **agent หลังข้อ 1**: `node ~/.claude/skills/errorLog/scripts/verify_live.js "<url>" edc2` + `?page=manual` ต้อง syntaxBad 0 · แล้ว `node master-webapp/tests/cdp_admin.js "<url>" 123456 conn 1JDqMLV8o6waHanXuN1lsjDxVTCRH6eC0QCJBHk94XYE "<etax url>"` · `… test` · `… data ALL 2026-10-01 2026-10-31` เทียบจำนวนกับชีต · ถ้าผ่าน merge `vscode` → `main`
3. **เจ้าของ**: เปลี่ยน PIN (ตั้งค่าระบบ › เปลี่ยน PIN) · ใส่ไอคอน/ชื่อแอป · ลงทะเบียนลิงก์ใหม่ใน Pattara Apps Center แล้วคัดรหัส SSO มาวางที่ ตั้งค่าระบบ › การเชื่อมต่อ (ลิงก์เก่าในพอร์ทัลชี้แอป v1.13.0)
4. **เจ้าของ**: ใส่รหัสสาขา/กลุ่ม 71 ร้านที่แอป etax › ตาราง master › รหัสร้าน → อัปเดตแถวเก่าตาม MAP · จนกว่าจะทำ ตัวกรองสาขา/สรุปรายสาขาในแอปใหม่ยังไร้ความหมาย
5. ข้อมูลย้อนหลังก่อน ก.ย. 2569 — **รอหัวหน้าอนุมัติ** (เจ้าของบอก 20/10) · ถ้าอนุมัติ ให้ฝั่ง etax ดึง PDF ย้อนหลังลง MASTER (แอปนี้ไม่ต้องแก้)
6. ปิดแอปเก่า + trigger ดึงเมลในชีตธนาคาร 3 ใบ — รอเจ้าของสั่ง หลังใช้แอปใหม่จนพอใจ · README ราก ยังอธิบายระบบเก่าทั้งหมด ถึงตอนนั้นค่อยย้ายไปหัวข้อ "ของเก่า"
7. ~~เขียนแอปใหม่บนสคริปต์ 1D2MJ…~~ เสร็จ 20/10/2569

## 6. มติที่ LOCK แล้ว — ห้ามถามซ้ำ (เจ้าของเคาะ 20/10/2569)
- แอปใหม่ใช้ข้อมูล MASTER **เท่าที่มี** · ย้อนหลังรอหัวหน้า
- **เลิก** ชีตธนาคาร 3 ใบ/endpoint/บัญชีหลายคน ใช้ MASTER แทน · แต่ **ไม่แตะสคริปต์เก่า** สร้างบนสคริปต์ใหม่
- แก้รหัสร้าน (MERCHANT_MAP) **ที่หน้าแอปเท่านั้น ไม่แก้ในชีต** — แอปใหม่เลือกเป็น read-only ชี้ไปแอป etax ที่มีตัวแก้อยู่แล้ว (agent เลือก default นี้ เจ้าของไม่คัดค้านตอน "ต่อเลย") ถ้าเจ้าของอยากแก้ในแอปนี้ด้วย ค่อยเพิ่ม
- คอลัมน์เทคนิค (file/page/machine/extracted_at/card_types/tax_id/account_no/month) ซ่อนเป็นค่าเริ่มต้น
- เวอร์ชันแอปใหม่เริ่ม **2.0.0** requirement "ย้ายแหล่งข้อมูลไป ETAX EDC MASTER"
- วันที่ในแอปใหม่ = **ค.ศ. dd/MM/yyyy ทั้งแอป** (ปฏิทิน year:'ce') ตามชีต MASTER และแอป etax — agent เคาะเพื่อไม่ให้ปน พ.ศ./ค.ศ. (แอปเก่าปนอยู่) เจ้าของยังไม่ได้ยืนยันตรง ๆ
- รหัสสาขาว่าง = **เตือนสีเหลือง ไม่ล็อก export** (ต่างจากแอปเก่าที่ล็อก) เพราะตอนนี้ว่างทั้งแผ่นและเจ้าของสั่งใช้เท่าที่มี
- ของเดิมที่ยังใช้: PIN sha256+salt · ไอคอนหั่นก้อน 8000 · คู่มือในตัว ?page=manual · SSO จาก Apps Center (Sso.js ไฟล์กลาง)

## 7. บั๊กที่เคยเจอ + ห้ามทำพัง
- **สคริปต์ใหม่ deploy ด้วย clasp แล้ว 403 "ต้องมีสิทธิ์เข้าถึง"** (20/10/2569) = ยังไม่อนุมัติสิทธิ์ ไม่ใช่ manifest ผิด — ให้เจ้าของรันฟังก์ชันใด ๆ ใน editor 1 ครั้ง (`setup()`)
- errorLog E1: string ใน `<script>` ของหน้า template เขียน `https:\/\/` · regex ที่มี `/` ใช้ `new RegExp('…')` (แปลงแล้วทั้งหน้า) · หลัง deploy ต้อง verify_live ทุกหน้า
- ห้าม `getValues()` กับชีต MASTER (วันที่/รหัสเป็นข้อความ) · ห้าม `new Date('dd-mm-yyyy')` · แสดงผลจาก `date_iso` เท่านั้น
- แอปนี้ **ห้ามเขียนข้อมูลลงชีต MASTER** (เขียนได้แค่แท็บซ่อน log) — ข้อมูลเป็นของโปรเจกต์ etax
- ล็อกอิน **ห้าม auto-login ตอนครบ 6 หลัก** (มาตรฐาน 11/09/2569 · แอปเก่ายังทำอยู่ ไม่แก้เพราะไม่แตะ)
- `aside` ใช้ `position:sticky` อย่างเดียว ห้ามเปลี่ยนเป็น relative (บั๊กแอปเก่า 1.9.0)
- Chrome headless บน Git Bash: path screenshot ใช้ `C:/…` forward slash · `sed 's#..#..#'` พังถ้ามี `#` ใน path

## 8. วิธีทำงานกับเจ้าของโปรเจกต์
ภาษาไทย · ถามเป็นตัวเลือกสั้น ๆ แล้วรอคำตอบ · deploy ได้เลยไม่ต้องถาม (มติ 28/09/2569) แต่ต้องผ่าน: `clasp show-authorized-user` = gm@ · syntax + นับ div + เรนเดอร์ Chrome · verify_live หลัง deploy · รายงาน @version ให้เทส · ทุก delivery แนบ: ลิงก์ · เลขเวอร์ชัน/deployment · สิ่งที่เจ้าของต้องกดเอง

## 9. ความลับ (redacted)
PIN ผู้ดูแล: Script Property `ADMIN_PIN` (hash) — ตั้งต้น 123456 จนกว่าจะเปลี่ยน · รหัส SSO: `PORTAL_SSO_KEY` (คัดจากพอร์ทัล) · ไม่มี token อื่นในแอปใหม่ · ของแอปเก่า (SYNC_TOKEN_*) ดู README

## 10. Suggested skills + ประโยคเปิดแชทใหม่
`pattara-webapp-standards` · `errorLog` (check/verify_live) · `pattara-check-date` · `pattara-setting` · `pattara-manual` · `handoff`

> ผมทำ **ระบบขึ้นเงินบัตรเครดิต EDC แอปใหม่ master-webapp** (Apps Script · v2.0.0 · สคริปต์ 1D2MJfl1…) — บริบทอยู่ใน `docs/HANDOFF.md` โค้ดอยู่ที่ `D:\SomO\VS Code\edc_report\master-webapp`
> ตอนนี้จะ [ทำงานค้างข้อ N] — **ก่อนแตะโค้ด ให้ `clasp pull` เทียบกับคลาวด์ก่อนเสมอ** (ใน master-webapp/) แล้วทำต่อโดยเคารพ §6 มติที่ LOCK, §7 ห้ามทำพัง และ §8 วิธีทำงาน — ตอบภาษาไทย
