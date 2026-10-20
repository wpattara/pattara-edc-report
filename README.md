# pattara-edc-report — ระบบรายการตัดบัตรเครดิต (EDC)

เว็บแอปดูรายการตัดบัตรเครดิตจากเครื่อง EDC · กรองช่วงวัน/สาขา · สรุปยอด · export CSV/Excel/PDF

> ⚠️ **Private repo** — โค้ดมี `SYNC_TOKEN`, MERCHANT_ID และรหัสสาขาจริง **ห้ามเปลี่ยนเป็น public**

> ## 🆕 20/10/2569 — แอปใหม่ `master-webapp/` (v2.0.0) ย้ายแหล่งข้อมูลไปชีต ETAX EDC — MASTER
> สคริปต์ใหม่ `1D2MJfl1wDtAmrxUsUJkKJ9rTfqfe9s5-7GCKtRndUx_R1iSs9H9u0HY2` (gm@) อ่านชีต MASTER ใบเดียว ไม่มี Sync endpoint ไม่มีเรื่องบัญชีหลายคนอีก
> **บริบท/สถานะ/งานค้างทั้งหมดอยู่ใน [`docs/HANDOFF.md`](docs/HANDOFF.md)** — เนื้อหาด้านล่างนี้คือระบบเก่า (`webapp/` + `sheet-*`) ที่ยังเดินอยู่ ไม่ได้แตะ

## โครงสร้าง

| โฟลเดอร์ | คืออะไร | Script ID | เจ้าของ |
|---|---|---|---|
| `webapp/` | เว็บแอป EDC (standalone) `v1.7` | `1U4ZESWN34ap6GS9H1FNMgifECixWH1kTcDuhyqQRrQuT8TZOMgUuioEG` | — |
| `sheet-oil/` | `EDC SYSTEM` — ดึงเมล + SyncEndpoint | `144N888kFBMB8c2L7z8hkdVJ9c15yV__Iq04EdLeLon8rlZeaXNvxi8PX` | **wattanaoil123@gmail.com** |
| `sheet-bbl/` | `BBL EDC` — ดึงเมล eTax + SyncEndpoint | `1WB5JLj1N1LWiat9Zcq9JSEZAGBz0QIC-NZ4GB0_M9pXBAtt41uFLR5K5` | **wattanaoil123@gmail.com** |
| `sheet-amazon/` | `EXCEL AMAZON EDC` — ดึงเมล + SyncEndpoint | `1Y7_XS2Uocf_CRncTkFsUjTDMExCQ9D3-edYc4Y4qjT4_oUm36G6an2yr` | **ac@tgrhotel.com** |

ทุกโฟลเดอร์ยกเว้น `webapp/` เป็นสคริปต์ที่ผูกกับชีต (container-bound) · แต่ละโฟลเดอร์มี `.clasp.json` ของตัวเอง → `cd sheet-oil && clasp pull` แยกกันได้

> ไฟล์หลักของ `sheet-amazon/` ชื่อ **`รหัส.js`** ตามที่เอดิเตอร์ภาษาไทยตั้งให้ **ห้ามเปลี่ยนชื่อ** ไม่งั้น `clasp push` จะไปสร้างไฟล์ซ้ำบนคลาวด์

## ชิปในแอป · ชีต · endpoint

| ชิป | ธนาคาร | ชีต | Spreadsheet ID | เจ้าของชีต |
|---|---|---|---|---|
| `wcoil6` | K-Bank | `EXCEL AMAZON EDC` | `1EcgNdmrMDIpLhg489TQApJyVtQynEFcwUClMhBhkvq8` | ac@tgrhotel.com |
| `oilpark` | K-Bank | `KBANK EDC SYSTEM - OIL1/OIL4/TT/TK/OIL5/OIL6` | `1nCk-2Hr_t6NJFJszypCcHrpgJqnAVZVnhTtfYuPHUKM` | wattanaoil123@gmail.com |
| `bbloil` | BBL | `EDC oil1+oil4+oil5+oil6 EXTRACTION BBL` | `1HgQ4OS-cDuyhuJkv1ZOC0xvkXBV5Qeg3wpx-NsVcZjs` | wattanaoil123@gmail.com |

### ค่าที่ต้องกรอกในหน้า ⚙️ ตั้งค่าระบบ ของเว็บแอป

หน้า ⚙️ แสดงการ์ดของทุกชิปพร้อมกัน (ไม่ต้องเลือกชิปก่อน) — **ระวังกรอกข้ามการ์ด** ทุก deployment id ขึ้นต้น `AKfycb` เหมือนกันหมด ให้ดู token คู่กันเป็นหลัก

| การ์ด | deployment id (ขึ้นต้น) | token |
|---|---|---|
| K-Bank · wc_oil6 Amazon | `AKfycbynt IM3kBfSa…` | `wcoil6-kbank-2769-sync` |
| K-Bank · OIL 1/4/5/6 · TT/TK | `AKfycbyrh K6hWKFfn…` | `oilpark-kbank-5183-sync` |
| BBL · OIL 1/4/5/6 | `AKfycbzrQ FCPqsIIt…` | `bbl-etax-7429-sync` |

รูปแบบ URL: `https://script.google.com/macros/s/<deployment id>/exec`

## 🔥 กติกาเหล็ก: ใครเป็นคน Deploy

Sync endpoint deploy แบบ **Execute as: Me** → `GmailApp.search` ค้นเมลใน**กล่องของคนที่กด deploy เท่านั้น** และ **`clasp redeploy` ผูกตัวตนใหม่ทุกครั้ง** (พิสูจน์แล้ว: gm redeploy ฝั่ง Amazon → endpoint ตอบ `ok:true` แต่ `threads: 0`)

- ฝั่ง **OIL / BBL** → ต้อง `wattanaoil123@gmail.com`
- ฝั่ง **Amazon** → ต้อง `ac@tgrhotel.com`
- **`gm@tgrhotel.com` ห้ามแตะ deployment เด็ดขาด** — pull/push/create-version ได้ แต่ redeploy เมื่อไหร่ตัวตนย้ายมาที่ gm ซึ่งไม่มีเมลธนาคารสักฉบับ (ตรวจแล้ว `from:K-Merchant_report@kasikornbank.com in:anywhere` = ว่าง)

### manifest ต้องเป็นแบบนี้เท่านั้น

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```
ในหน้า UI = Execute as **Me** / Who has access **Anyone**
⚠️ **ห้ามเลือก "Anyone with Google account"** (= `ANYONE`) เพราะจะบังคับ login แล้ว `UrlFetchApp` ผ่านไม่ได้ → เว็บแอปขึ้น *"เรียก Sync Endpoint ไม่สำเร็จ"* — เคยตั้งผิดแบบนี้มาแล้วทั้ง BBL และ OIL

## ขั้นตอน deploy

```sh
cp ~/.clasprc.gm.json ~/.clasprc.json      # สำรอง token gm ไว้ก่อนเสมอ
clasp login                                 # เลือกบัญชีเจ้าของกล่องเมลของชิปนั้น
cd sheet-oil
clasp pull                                  # เทียบคลาวด์ก่อนแตะโค้ดทุกครั้ง
clasp push
clasp create-version "<คำอธิบาย>"
clasp redeploy <deployment id> -V <เลขใหม่> # ทับตัวเดิม URL จะได้ไม่เปลี่ยน
cp ~/.clasprc.gm.json ~/.clasprc.json      # คืน token gm
```

**ตรวจหลัง deploy — ยิงด้วย token ผิดจงใจ ไม่มีผลข้างเคียง:**
```sh
curl "https://script.google.com/macros/s/<id>/exec?token=WRONG"
```
| ผลลัพธ์ | แปลว่า |
|---|---|
| `{"ok":false,"error":"invalid token"}` | ✅ ผ่าน |
| HTML เด้ง `accounts.google.com/v3/signin` | manifest ตั้งเป็น `ANYONE` ต้องแก้เป็น `ANYONE_ANONYMOUS` |
| HTML `ไม่พบฟังก์ชันของสคริปต์: doGet` | deployment ยังชี้ version เก่าที่ยังไม่มี SyncEndpoint |
| HTML `รหัสข้อผิดพลาด UNAUTHENTICATED` | ยังกระจายไม่ทั่ว รอ ~30 วิ แล้วลองใหม่ |

จากนั้นยิงจริงด้วย token ที่ถูก แล้วดู `threads` — ถ้าเป็น **0** แปลว่า deploy ผิดบัญชี

## Branch

`appsscript` = กระจกคลาวด์ · `vscode` = สายที่แก้ในเครื่อง · `main` = ที่ deploy แล้ว
`.gitattributes` ตั้ง `* -text` · ทุกไฟล์ **LF ล้วน UTF-8 ไม่มี BOM** — ห้ามให้ CR หลุดเข้าไป

## เรื่องที่ต้องรู้ก่อนแก้โค้ด

- **ชีตไม่ได้เรียงตามวันที่** ระบบต่อแถวท้ายไปเรื่อย ๆ ของใหม่อยู่**ล่างสุด** (กด `Ctrl+End`) — บนสุดของชีต OIL ยังเป็น 29/05/2026 ทั้งที่ข้อมูลเดินถึงปัจจุบัน อย่าเข้าใจผิดว่าค้าง
- **แท็บ `query` ฝั่ง OIL/BBL ไม่ใช่สูตร** ต้องเรียก `rebuildQuerySheet_()` ต่อท้ายการดึงเมล ไม่งั้นแอปไม่เห็นข้อมูลใหม่ (ฝั่ง Amazon เป็น ARRAYFORMULA ไม่ต้อง)
- **`SyncEndpoint-OIL.js` เคยเรียก `processEmails({daysBack})` ที่ไม่มีจริง** — ของจริงชื่อ `processKMerchantEmails_(days)` รับตัวเลข ตอนนี้มีสะพานให้แล้ว พร้อมแปลงชื่อคีย์ stats เป็น `inserted` / `skipDupTax` / `skipDupEmail` ที่เว็บแอปอ่าน
- **ห้ามถือ ScriptLock คร่อมงานดึงเมล** เพราะข้างในขอ lock ตัวเดียวกันซ้ำ → ชนตัวเอง ล็อกแค่ช่วงจอง cooldown แล้วปล่อย
- **บันทึกเมลที่ทำแล้วอยู่ใน Script Properties** (`PROCESSED_MSG_IDS`) ไม่ใช่ในชีต — เดิมจดไว้ที่คอลัมน์ `GMAIL_MESSAGE_ID` ของแถวที่เพิ่มจริงเท่านั้น เมลที่ทุกแถวโดนกันซ้ำจึงถูกแกะใหม่ทุกรอบตลอดไป (วัดได้ ~30 ฉบับ/รอบ) · ล้างด้วย `clearProcessedIds()`

## สถานะ deploy (9 ก.ย. 2569)

ทั้ง 3 ชิปใช้งานได้ครบ · redeploy ทับ deployment เดิมทุกตัว **URL ไม่เปลี่ยน**

| ชิป | version | บัญชีที่ deploy | ตัวแก้ `PROCESSED_MSG_IDS` | `action=rebuild` |
|---|---|---|---|---|
| K-Bank OIL | 4 | wattanaoil123@gmail.com | ✅ | ✅ |
| BBL | 3 | wattanaoil123@gmail.com | — (คนละโครงโค้ด ยังไม่ได้ตรวจว่ามีอาการเดียวกันไหม) | ✅ |
| K-Bank Amazon | 4 | ac@tgrhotel.com | ✅ | ✅ |

**ผลวัดตัวแก้เมลวนซ้ำ** — ยิง 2 รอบติดกัน:

| | OIL (5 ก.ย.) | Amazon (9 ก.ย.) |
|---|---|---|
| ก่อนแก้ | `emails 31` แกะ ZIP ทุกรอบ | `skipDupTax 1517` · `skipNoCSV 26` |
| หลังแก้ รอบ 2 | `emails 0` · `skipDupEmail 48` | `skipDupTax 0` · `skipNoCSV 0` · `skipDupEmail 117` |

> ⚠️ ตอน redeploy ฝั่ง Amazon กลับมาเป็น ac@ ครั้งแรกได้ `inserted: 123` — **มีข้อมูล 123 แถวที่หายไปเพราะ deploy ผิดบัญชี** อย่าเชื่อว่า trigger รายวันครอบคลุมอยู่แล้ว

## หนี้ที่ยังค้าง

- [ ] `ADMIN_PIN` ของเว็บแอปเก็บเป็น plaintext และ**ตกกลับไปใช้ `123456` เงียบ ๆ** ถ้าค่าผิดรูป
- [ ] เว็บแอปเปิด `ANYONE_ANONYMOUS` กั้นด้วย login ฝั่ง client เท่านั้น = ข้อมูลยอดทุกสาขาเปิดให้คนมีลิงก์
- [ ] `SYNC_TOKEN` hardcode ในโค้ดทั้ง 3 endpoint ควรย้ายไป Script Properties
- [ ] แท็บ `query` เรียงเก่า→ใหม่ อาจเพิ่ม sort ให้ล่าสุดขึ้นบน (เสนอไว้ ยังไม่ได้ทำ)
