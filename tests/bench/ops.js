'use strict';
// PER-REQUEST COST BENCH. Counts the Google service calls each API action makes (Sheets reads/writes, cells moved, openById, Drive, cache) on the REAL Code.gs,
// against a realistic company (N staff, ROWS attendance rows). On real Google these calls are what takes the time (each Sheets call is network I/O),
// so fewer calls = faster. It does NOT measure real Google latency. Usage: node tests/bench/ops.js [rows] [staff] > result
const { load } = require('../mock-google');
const ROWS = +process.argv[2] || 6000, STAFF = +process.argv[3] || 40, G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
function build() {
  const E = load(); E.x.setup();
  const cid = E.api({ action: 'register_start', company_name: 'Bench Co', admin_name: 'Asha', mobile: '9812300001', email: '', admin_pin: 'Secret123' }).company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Enterprise', months: 12 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, emps = [];
  for (let i = 0; i < STAFF; i++) emps.push(E.api({ action: 'emp_add', token: at, name: 'Emp ' + i, mobile: '90000' + String(10000 + i), designation: 'Tech', department: 'Svc', employee_type: 'Technician', site: 'Site ' + (i % 5) }));
  // fill history directly (fast): ROWS closed sessions spread over the last ~120 days
  const H = E.x.ATT_H, col = (n) => H.indexOf(n), coRow = E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === cid), sh = E.sheetsById[coRow[9]].tabs.Attendance;
  for (let i = 0; i < ROWS; i++) {
    const d = new Date(Date.now() - (i % 120 + 1) * 86400000), ymd = d.toISOString().slice(0, 10), e = emps[i % STAFF].employee.id, r = Array(H.length).fill('');
    r[0] = 'R' + (i + 1); r[col('Date')] = ymd; r[col('Employee ID')] = e; r[col('Status')] = 'CLOSED'; r[col('IN Time')] = '09:00'; r[col('OUT Time')] = '18:00'; r[col('IN Server Time')] = ymd + 'T03:30:00.000Z'; r[col('OUT Server Time')] = ymd + 'T12:30:00.000Z'; r[col('Duration')] = '09h 00m';
    r[col('IN Lat')] = 18.52; r[col('IN Long')] = 73.85; sh.g.push(r);
  }
  sh.maxRows = sh.g.length + 500;
  return { E, cid, o, emps };
}
function measure(E, label, fn, cold) {
  if (cold) { Object.keys(E.cache).forEach(k => { if (!k.startsWith('sess_')) delete E.cache[k]; }); }
  E.log.ops = {}; const t0 = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6, o = E.log.ops;
  if (r && r.ok === false) throw new Error(label + ' failed: ' + JSON.stringify(r));
  return { action: label, cache: cold ? 'cold' : 'warm', sheet_reads: o['sheet.read'] || 0, getLastRow: o['sheet.getLastRow'] || 0, cells_read: o['cells.read'] || 0, writes: o['sheet.write'] || 0, openById: o['openById'] || 0, drive: (o['drive'] || 0) + (o['drive.createFile'] || 0), cpu_ms: +ms.toFixed(1) };
}
const { E, cid, o, emps } = build(), out = [];
const login = (id, pin) => E.api({ action: 'login', company_id: cid, id, pin });
const adminTok = login('ADMIN', 'Secret123').token, e0 = emps[0], et = login(e0.employee.id, e0.pin).token, e1 = emps[1], et1 = login(e1.employee.id, e1.pin).token;
const month = new Date().toISOString().slice(0, 7);
const steps = [
  ['login (employee)', () => login(e0.employee.id, e0.pin)],
  ['employee home (me)', () => E.api({ action: 'me', token: et })],
  ['check-in', () => E.api({ action: 'checkin', token: et, ...G, idem: 'b' + Math.random(), photo: 'AAAA' })],
  ['check-out', () => E.api({ action: 'checkout', token: et, ...G, idem: 'o' + Math.random() })],
  ['employee history', () => E.api({ action: 'history', token: et1 })],
  ['admin dashboard', () => E.api({ action: 'dashboard', token: adminTok })],
  ['employee list', () => E.api({ action: 'emp_list', token: adminTok })],
  ['location list (today)', () => E.api({ action: 'att_list', token: adminTok, from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })],
  ['monthly report', () => E.api({ action: 'report_month', token: adminTok, month })],
  ['company info', () => E.api({ action: 'company_info', token: adminTok })],
];
const byName = Object.fromEntries(steps);
for (const [l, fn] of steps) {
  if (l === 'check-out') continue;
  if (l === 'check-in') { out.push(measure(E, l, fn, true)); out.push(measure(E, 'check-out', byName['check-out'], true)); out.push(measure(E, l, fn, false)); out.push(measure(E, 'check-out', byName['check-out'], false)); continue; }
  out.push(measure(E, l, fn, true)); out.push(measure(E, l, fn, false));
}
console.log(JSON.stringify({ rows: ROWS, staff: STAFF, results: out }, null, 1));
if (require.main === module && process.env.TABLE) {
  console.log('\n' + 'action'.padEnd(24) + 'cache  reads lastRow cells   writes openById drive cpu_ms'); out.forEach(r => console.log(r.action.padEnd(24) + r.cache.padEnd(6) + String(r.sheet_reads).padStart(5) + String(r.getLastRow).padStart(8) + String(r.cells_read).padStart(8) + String(r.writes).padStart(7) + String(r.openById).padStart(9) + String(r.drive).padStart(6) + String(r.cpu_ms).padStart(8)));
}
