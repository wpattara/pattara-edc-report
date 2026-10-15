/**
 * SSO จาก Pattara Apps Center (v1.13.0) — ไฟล์กลางชุดเดียวกันทุกแอป (ต้นแบบ: ระบบแจ้งซ่อม v2.38.0 · พอร์ทัล v3.8.0)
 * พอร์ทัลต่อ ?sso=<ตั๋ว> ท้ายลิงก์ · ตั๋ว = base64url(JSON) + '.' + base64url(HMAC-SHA256(ส่วนแรก, รหัส SSO ของแอปนี้))
 *   ตั๋วอายุ 2 นาที ใช้ได้ครั้งเดียว · ตั๋วฝั่ง admin เท่านั้นที่ได้ "บัตรผ่าน" (k:'s') หมดพร้อม session ของพอร์ทัล
 *   หน้าเว็บเก็บบัตรผ่าน "sso:…" ไว้ในช่องเดียวกับ PIN (sessionStorage = เฉพาะแท็บนั้น) · ด่านตรวจ PIN เรียก ssoPassOk_ ก่อน
 * รหัส SSO อยู่ Script Properties (ความลับ ไม่ลงชีต) — ผู้ดูแลคัดลอกจากพอร์ทัล › แก้ไขแอป มาวางที่หน้าตั้งค่าของแอปนี้
 * ไฟล์นี้ไม่มีโค้ดระดับบนสุดที่อ้างไฟล์อื่น (Apps Script ไม่การันตีลำดับโหลดไฟล์)
 */
const SSO_KEY_PROP = 'PORTAL_SSO_KEY';
function ssoKey_() { return PropertiesService.getScriptProperties().getProperty(SSO_KEY_PROP) || ''; }
function ssoB64_(v) { return Utilities.base64EncodeWebSafe(v).replace(/=+$/, ''); }
function ssoSign_(body, key) { return ssoB64_(Utilities.computeHmacSha256Signature(body, key)); }

/** อ่านตั๋ว/บัตรผ่านที่ลายเซ็นถูก — ไม่ถูก/ยังไม่ตั้งรหัส = null */
function ssoRead_(tok) {
  const key = ssoKey_();
  const i = String(tok || '').lastIndexOf('.');
  if (!key || i < 1) return null;
  const body = tok.slice(0, i);
  if (ssoSign_(body, key) !== tok.slice(i + 1)) return null;
  try {
    const pad = body + '===='.slice(0, (4 - body.length % 4) % 4);
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
  } catch (e) { return null; }
}

/** ตั๋วจากพอร์ทัล → { key: บัตรผ่านผู้ดูแล } หรือ { err } (err ว่าง = ตั๋วฝั่งผู้ใช้ ไม่ต้องเข้าแบบผู้ดูแล) */
function ssoFromTicket_(ticket) {
  if (!ssoKey_()) return { err: 'ระบบนี้ยังไม่ได้ตั้งรหัส SSO — ใส่ PIN เข้าใช้งาน (ตั้งได้ที่ ตั้งค่าระบบ)' };
  const p = ssoRead_(ticket);
  if (!p || p.k !== 't') return { err: 'ลิงก์เข้าจาก Apps Center ไม่ถูกต้อง — ใส่ PIN หรือกดเข้าจากพอร์ทัลใหม่' };
  if (Date.now() > Number(p.x)) return { err: 'ลิงก์เข้าจาก Apps Center หมดอายุ — กดเข้าจากพอร์ทัลใหม่' };
  if (p.s !== 'admin' || p.r !== 'admin') return {};
  const cache = CacheService.getScriptCache(), used = 'sso_j_' + p.j;
  if (cache.get(used)) return { err: 'ลิงก์นี้ถูกใช้ไปแล้ว — กดเข้าจากพอร์ทัลใหม่' };
  cache.put(used, '1', 600);
  const exp = Math.min(Number(p.e) || 0, Date.now() + 8 * 3600 * 1000);
  const body = ssoB64_(Utilities.newBlob(JSON.stringify({ k: 's', u: p.u, n: p.n, e: exp })).getBytes());
  return { key: 'sso:' + body + '.' + ssoSign_(body, ssoKey_()) };
}

/** อ่าน ?sso= จาก doGet แล้วคืนค่าที่จะฝังลงหน้า — ล้มยังไงหน้าก็ต้องเปิดได้ */
function ssoPage_(e) {
  try {
    const t = e && e.parameter && e.parameter.sso;
    const r = t ? ssoFromTicket_(String(t)) : {};
    return { key: r.key || '', err: r.err || '' };
  } catch (err) { return { key: '', err: 'เข้าจาก Apps Center ไม่สำเร็จ — ใส่ PIN' }; }
}

/** ด่านตรวจ: ไม่ใช่บัตรผ่าน = false (ให้ตรวจ PIN ต่อ) · บัตรผ่านใช้ได้ = true · บัตรผ่านเสีย/หมดอายุ = throw */
function ssoPassOk_(pin) {
  if (String(pin || '').indexOf('sso:') !== 0) return false;
  const p = ssoRead_(String(pin).slice(4));
  if (p && p.k === 's' && Date.now() < Number(p.e)) return true;
  throw new Error('การเข้าจาก Apps Center หมดอายุ — กดเข้าจากพอร์ทัลใหม่ หรือใส่ PIN');
}

/** สถานะรหัสสำหรับหน้าตั้งค่า — คืนแค่ค่าปิดบัง */
function ssoKeyInfo_() {
  const k = ssoKey_();
  return { set: !!k, masked: k ? '••••' + k.slice(-4) : '' };
}

/** บันทึกรหัส (ผ่านด่านผู้ดูแลก่อนเรียก) — ว่าง = ปิด SSO · คืน { old, now, msg } ให้แอปลง log ตามแบบของตัวเอง */
function ssoSaveKey_(key) {
  const k = String(key || '').trim().toLowerCase();
  if (k && !/^[0-9a-f]{64}$/.test(k)) throw new Error('รหัส SSO ต้องเป็นตัวอักษร 0-9 a-f ยาว 64 ตัว — คัดลอกจากพอร์ทัล › แก้ไขแอป ให้ครบ');
  const old = ssoKeyInfo_().masked;
  const props = PropertiesService.getScriptProperties();
  if (k) props.setProperty(SSO_KEY_PROP, k); else props.deleteProperty(SSO_KEY_PROP);
  return { old: old, now: ssoKeyInfo_().masked, msg: k ? 'บันทึกรหัส SSO แล้ว — เข้าจาก Apps Center ได้เลย' : 'ปิด SSO แล้ว — เข้าด้วย PIN อย่างเดียว' };
}

/** ค่าที่ฝังลง <script> ของหน้า template — ใส่ quote เอง · escape / (กัน // โดนตัด) และ < (กันปิด script) ตามสกิล errorLog E1 */
function ssoJs_(v) {
  return JSON.stringify(v == null ? '' : String(v)).replace(/\//g, '\\/').replace(/</g, '\\u003c');
}
