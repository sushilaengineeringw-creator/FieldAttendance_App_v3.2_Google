'use strict';
// LIVE LOAD TEST for a REAL deployment (or the local shim). Nothing here is simulated: it sends real HTTPS requests and measures real response times.
// Usage:  node tests/bench/live-load.js <web-app-url> <creds.json> [concurrency=20] [rounds=1]
// creds.json = { "companies": [ { "id": "FA1ABCD", "admin_pin": "...", "staff": [ { "id": "E001", "pin": "123456" } ] } ] }   (TEST companies only - it writes real attendance rows and photos)
// Each virtual user: login -> me -> check-in (small photo + GPS) -> check-out; each admin also loads dashboard + today's location list + monthly report.
// Apps Script runs about 30 requests in parallel per deployment, so concurrency above ~30 mostly measures queueing; start with 10-20.
const fs = require('fs');
const [URL_, CREDS, CONC = '20', ROUNDS = '1'] = process.argv.slice(2);
if (!URL_ || !CREDS) { console.error('usage: node live-load.js <url> <creds.json> [concurrency] [rounds]'); process.exit(2); }
const creds = JSON.parse(fs.readFileSync(CREDS, 'utf8')), conc = +CONC, rounds = +ROUNDS, PHOTO = Buffer.from('fakejpegbytes').toString('base64'), G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
const lat = {}, errs = {}; let nreq = 0, seq = 0;
async function call(action, body) {
  const t = process.hrtime.bigint(); nreq++;
  try { const res = await fetch(URL_, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...body }) }); const j = await res.json();
    (lat[action] = lat[action] || []).push(Number(process.hrtime.bigint() - t) / 1e6); if (!j.ok) { const k = action + ':' + j.error; errs[k] = (errs[k] || 0) + 1; } return j; }
  catch (e) { (lat[action] = lat[action] || []).push(Number(process.hrtime.bigint() - t) / 1e6); const k = action + ':NETWORK ' + e.message.slice(0, 40); errs[k] = (errs[k] || 0) + 1; return { ok: false }; }
}
const staffJob = (co, s) => async () => { const l = await call('login', { company_id: co.id, id: s.id, pin: s.pin }); if (!l.ok) return; const tk = l.token; await call('me', { token: tk });
  await call('checkin', { token: tk, ...G, idem: 'L' + Date.now() + (++seq), photo: PHOTO }); await call('checkout', { token: tk, ...G, idem: 'O' + Date.now() + (++seq) }); };
const adminJob = (co) => async () => { const l = await call('login', { company_id: co.id, id: 'ADMIN', pin: co.admin_pin }); if (!l.ok) return; const tk = l.token, d = new Date().toISOString().slice(0, 10);
  await call('dashboard', { token: tk }); await call('att_list', { token: tk, from: d, to: d }); await call('emp_list', { token: tk }); await call('report_month', { token: tk, month: d.slice(0, 7) }); };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
(async () => {
  let jobs = []; for (let r = 0; r < rounds; r++) creds.companies.forEach(co => { co.staff.forEach(s => jobs.push(staffJob(co, s))); jobs.push(adminJob(co)); });
  for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  const t0 = Date.now(); let next = 0; await Promise.all(Array.from({ length: conc }, async () => { while (next < jobs.length) await jobs[next++](); }));
  const wall = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ target: URL_, concurrency: conc, virtual_users: jobs.length, requests: nreq, wall_seconds: +wall.toFixed(1), requests_per_second: +(nreq / wall).toFixed(1), errors: errs,
    latency_ms: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99), max: pct(v, 100) }])) }, null, 1));
})();
