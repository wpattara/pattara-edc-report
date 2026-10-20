/**
 * tests/cdp_admin.js — ขับหน้าแอปจริง (prod /exec) ผ่าน Chrome DevTools Protocol เพื่อเรียก google.script.run เหมือนผู้ดูแลกดเอง
 * ใช้หลัง deploy เพื่อ (1) ตั้งค่าชีต MASTER / ลิงก์แอปตัวโหลด (2) ยิง getData อ่านชีตจริง
 *
 * รัน:  node tests/cdp_admin.js "<url /exec>" <PIN> <คำสั่ง> [อาร์กิวเมนต์ JSON]
 *   คำสั่ง: settings            → getSettings(pin)
 *           conn <ssId> <etaxUrl>→ saveSettings(pin,{section:'conn',ssId,etaxUrl})
 *           test                → testMaster(pin)
 *           data <bank> <from> <to> → getData(bank,from,to) (สรุปจำนวน ไม่พิมพ์ทุกแถว)
 * ต้องมี Chrome ที่ C:\Program Files\Google\Chrome\Application\chrome.exe · ใช้ WebSocket ของ Node 22
 */
const { spawn } = require('child_process');
const http = require('http');
const [url, pin, cmd, ...rest] = process.argv.slice(2);
if (!url || !pin || !cmd) { console.error('ใช้: node tests/cdp_admin.js <url> <pin> <settings|conn|test|data> [...]'); process.exit(2); }
const CH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + PORT, '--user-data-dir=' + require('os').tmpdir() + '\\edc_cdp_profile', url], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJson(p) { return new Promise((res, rej) => http.get('http://127.0.0.1:' + PORT + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej)); }

(async () => {
  try {
    let ver = null;
    for (let i = 0; i < 40 && !ver; i++) { try { ver = await getJson('/json/version'); } catch (e) { await sleep(250); } }
    if (!ver) throw new Error('Chrome ไม่เปิด remote debugging');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {};
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    const send = (method, params, sessionId) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify(Object.assign({ id: n, method, params: params || {} }, sessionId ? { sessionId } : {}))); });

    // หา iframe ของ Apps Script (userCodeAppPanel) — google.script.run อยู่ในนั้น
    let sess = null;
    for (let i = 0; i < 60 && !sess; i++) {
      const t = await send('Target.getTargets');
      const fr = (t.result.targetInfos || []).find(x => x.type === 'iframe' && /userCodeAppPanel/.test(x.url));
      if (fr) { const a = await send('Target.attachToTarget', { targetId: fr.targetId, flatten: true }); sess = a.result.sessionId; }
      else await sleep(500);
    }
    if (!sess) throw new Error('ไม่พบ iframe userCodeAppPanel ใน 30 วิ');
    await send('Runtime.enable', {}, sess);
    const run = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 }, sess);
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      return r.result.result.value;
    };
    // รอให้หน้า init เสร็จ (มี google.script.run)
    for (let i = 0; i < 40; i++) { const ok = await run('typeof google!=="undefined" && !!(google.script && google.script.run)'); if (ok) break; await sleep(500); }
    const call = (fn, args) => run('new Promise(function(res,rej){ google.script.run.withSuccessHandler(function(v){res(JSON.stringify(v));}).withFailureHandler(function(e){rej(new Error(e&&e.message||String(e)));}).' + fn + '.apply(null,' + JSON.stringify(args) + '); }).then(function(s){return s;})');
    let out;
    if (cmd === 'settings') out = JSON.parse(await call('getSettings', [pin]));
    else if (cmd === 'conn') out = JSON.parse(await call('saveSettings', [pin, { section: 'conn', ssId: rest[0] || '', etaxUrl: rest[1] || '' }]));
    else if (cmd === 'test') out = JSON.parse(await call('testMaster', [pin]));
    else if (cmd === 'data') {
      const d = JSON.parse(await call('getData', [rest[0] || 'ALL', rest[1] || '', rest[2] || '']));
      out = { count: d.count, scanned: d.scanned, truncated: d.truncated, latest: d.latest, ms: d.ms, banks: d.banks, health: { rows: d.health.rows, merchants: d.health.merchants.length },
              runs: d.runs, headers: d.headers.length, sample: d.rows.slice(0, 2), lastRow: d.rows[d.rows.length - 1] };
    } else throw new Error('ไม่รู้จักคำสั่ง ' + cmd);
    if (out && out.appIcon) out.appIcon = '(' + out.appIcon.length + ' ตัวอักษร)';
    console.log(JSON.stringify(out, null, 1));
    ws.close();
  } catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 1; }
  finally { chrome.kill(); }
})();
