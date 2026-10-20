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
    const contexts = [];   // {sessionId, contextId} ของทุก frame (iframe ในโปรเซสเดียวกันไม่เป็น target แยก ต้องไล่ execution context)
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
      if (m.method === 'Runtime.executionContextCreated') contexts.push({ sessionId: m.sessionId || null, contextId: m.params.context.id, origin: m.params.context.origin });
    };
    const send = (method, params, sessionId) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify(Object.assign({ id: n, method, params: params || {} }, sessionId ? { sessionId } : {}))); });

    // Apps Script ซ้อน iframe หลายชั้น (userCodeAppPanel → sandboxFrame → userHtmlFrame) — ไล่ทุก target หาชั้นที่มี google.script.run
    const attached = {};
    const evalIn = async (c, expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000, contextId: c.contextId }, c.sessionId);
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      return r.result.result.value;
    };
    let ctx = null;
    for (let i = 0; i < 80 && !ctx; i++) {
      const t = await send('Target.getTargets');
      for (const x of (t.result.targetInfos || [])) {
        if (x.type !== 'iframe' && x.type !== 'page') continue;
        if (!attached[x.targetId]) { try { const a = await send('Target.attachToTarget', { targetId: x.targetId, flatten: true }); attached[x.targetId] = a.result.sessionId; await send('Runtime.enable', {}, attached[x.targetId]); } catch (e) { continue; } }
      }
      for (const c of contexts.slice()) {
        try { if (await evalIn(c, 'typeof google!=="undefined" && !!(google.script && google.script.run) && typeof enterApp==="function"')) { ctx = c; break; } } catch (e) { /* context หายไปแล้ว */ }
      }
      if (!ctx) await sleep(500);
    }
    if (!ctx) { console.error('contexts ที่เห็น:', contexts.map(c => c.origin).join(' | ')); throw new Error('ไม่พบ frame ที่มี google.script.run ใน 40 วิ'); }
    const run = (expr) => evalIn(ctx, expr);
    const call = (fn, args) => run('new Promise(function(res,rej){ google.script.run.withSuccessHandler(function(v){res(JSON.stringify(v));}).withFailureHandler(function(e){rej(new Error(e&&e.message||String(e)));}).' + fn + '.apply(null,' + JSON.stringify(args) + '); }).then(function(s){return s;})');
    let out;
    if (cmd === 'settings') out = JSON.parse(await call('getSettings', [pin]));
    else if (cmd === 'conn') out = JSON.parse(await call('saveSettings', [pin, { section: 'conn', ssId: rest[0] || '', etaxUrl: rest[1] || '' }]));
    else if (cmd === 'test') out = JSON.parse(await call('testMaster', [pin]));
    else if (cmd === 'data') {
      const d = JSON.parse(await call('getData', [rest[0] || 'ALL', rest[1] || '', rest[2] || '']));
      out = { count: d.count, scanned: d.scanned, truncated: d.truncated, latest: d.latest, ms: d.ms, banks: d.banks, health: { rows: d.health.rows, merchants: d.health.merchants.length },
              runs: d.runs, headers: d.headers.length, sample: d.rows.slice(0, 2), lastRow: d.rows[d.rows.length - 1] };
    } else if (cmd === 'units') {   // สรุป หน่วยงาน → ธนาคาร → สาขาในใบ/MERCHANT_ID/รหัสสาขา (นับใบ)
      const d = JSON.parse(await call('getData', ['ALL', '', '']));
      const k = n => d.keys.indexOf(n); const m = {};
      d.rows.forEach(r => { const u = r[k('unit')], b = r[k('bank')], key = u + ' | ' + b + ' | ' + r[k('branch')] + ' | ' + r[k('merchant_id')] + ' | ' + (r[k('merchant_name')] || '') + ' | bc=' + r[k('branch_code')] + ' gc=' + r[k('group_code')]; m[key] = (m[key] || 0) + 1; });
      out = Object.keys(m).sort().map(x => x + ' → ' + m[x]);
    } else throw new Error('ไม่รู้จักคำสั่ง ' + cmd);
    if (out && out.appIcon) out.appIcon = '(' + out.appIcon.length + ' ตัวอักษร)';
    console.log(JSON.stringify(out, null, 1));
    ws.close();
  } catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 1; }
  finally { chrome.kill(); }
})();
