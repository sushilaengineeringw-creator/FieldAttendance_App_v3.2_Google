'use strict';
// LOAD / ISOLATION TEST on the REAL Code.gs with simulated Google services: 100 companies x 10 staff = 1,000 users + 100 admins.
// Operations run in a randomly shuffled order (a stand-in for concurrent arrival; Node is single-threaded, so this measures our code's CPU and the number of Google calls,
// NOT Google's latency or its limit on parallel executions - see the report). Everything printed is measured from this run. Usage: node tests/bench/load.js [companies] [staffPerCompany]
const { load } = require('../mock-google');
const COS = +process.argv[2] || 100, PER = +process.argv[3] || 10, G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
const E = load(); E.x.setup();
const t0 = Date.now(), pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2) : 0; };
const own = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token, cos = [];
for (let c = 0; c < COS; c++) {
  delete E.cache.reg_rate; delete E.cache.reg_day;   // the registration rate limit (30/hour) is a protection, not part of what is being load-tested
  const cid = E.api({ action: 'register_start', company_name: 'Load Co ' + c, admin_name: 'Admin ' + c, mobile: '98' + String(10000000 + c), email: '', admin_pin: 'Secret123' }).company_id;
  E.api({ action: 'owner_activate', token: own, company_id: cid, plan: 'Growth', months: 1 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, staff = [];
  for (let i = 0; i < PER; i++) { const e = E.api({ action: 'emp_add', token: at, name: `C${c} Emp${i}`, mobile: '90' + String(c * 100 + i + 10000000), designation: 'Tech', department: 'Svc', employee_type: 'Technician', site: 'S' + (i % 3) }); if (!e.employee) throw new Error('emp_add failed: ' + JSON.stringify(e) + ' company ' + c + ' emp ' + i + ' cid ' + cid); staff.push({ id: e.employee.id, pin: e.pin }); }
  cos.push({ cid, at, staff });
}
const setupMs = Date.now() - t0;
// history: 300 closed rows per company so reads are realistic
const H = E.x.ATT_H, col = (n) => H.indexOf(n);
cos.forEach((co, c) => { const row = E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === co.cid), sh = E.sheetsById[row[9]].tabs.Attendance;
  for (let i = 0; i < 300; i++) { const d = new Date(Date.now() - (1 + i % 25) * 86400000).toISOString().slice(0, 10), r = Array(H.length).fill(''); r[0] = 'H' + i; r[col('Date')] = d; r[col('Employee ID')] = co.staff[i % PER].id; r[col('Name')] = 'x'; r[col('Status')] = 'CLOSED'; r[col('IN Time')] = '09:00'; r[col('OUT Time')] = '18:00'; r[col('IN Server Time')] = d + 'T03:30:00.000Z'; r[col('OUT Server Time')] = d + 'T12:30:00.000Z'; r[col('Company ID')] = co.cid; sh.g.push(r); }
  sh.maxRows = sh.g.length + 500; });
cos.forEach(co => co.staff.forEach(s => { s.tok = E.api({ action: 'login', company_id: co.cid, id: s.id, pin: s.pin }).token; }));
const stats = {}, errors = {}; let seq = 0;
const op = (name, body, expectErr) => { E.log.ops = {}; const a = process.hrtime.bigint(), r = E.api(body), ms = Number(process.hrtime.bigint() - a) / 1e6, o = E.log.ops;
  const st = stats[name] || (stats[name] = { ms: [], reads: 0, cells: 0, writes: 0, n: 0, lastRow: 0 });
  st.ms.push(ms); st.n++; st.reads += o['sheet.read'] || 0; st.cells += o['cells.read'] || 0; st.writes += o['sheet.write'] || 0; st.lastRow += o['sheet.getLastRow'] || 0;
  if (!r.ok && !(expectErr && expectErr.includes(r.error))) { const k = name + ':' + r.error; errors[k] = (errors[k] || 0) + 1; } return r; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const month = new Date().toISOString().slice(0, 7), today = new Date().toISOString().slice(0, 10);
const mem0 = process.memoryUsage().rss, cpu0 = process.cpuUsage(), wall0 = Date.now();
// Phase 1: every user checks in (1,000 check-ins) mixed with 1,000 employee home loads and 100 admin dashboards, shuffled
let jobs = [];
cos.forEach(co => { co.staff.forEach(s => { jobs.push(() => op('check-in', { action: 'checkin', token: s.tok, ...G, idem: 'in' + (++seq), photo: 'AAAA' })); jobs.push(() => op('employee home (me)', { action: 'me', token: s.tok })); }); jobs.push(() => op('admin dashboard', { action: 'dashboard', token: co.at })); });
// ensure each user's "me" may come before its check-in: fine (both valid)
shuffle(jobs).forEach(j => j());
// Phase 2: 1,000 check-outs + 100 dashboards + 100 location lists + 50 monthly reports + 100 staff lists
jobs = [];
cos.forEach((co, c) => { co.staff.forEach(s => jobs.push(() => op('check-out', { action: 'checkout', token: s.tok, ...G, idem: 'out' + (++seq) }))); jobs.push(() => op('admin dashboard', { action: 'dashboard', token: co.at })); jobs.push(() => op('location list', { action: 'att_list', token: co.at, from: today, to: today }));
  jobs.push(() => op('employee list', { action: 'emp_list', token: co.at })); if (c % 2 === 0) jobs.push(() => op('monthly report', { action: 'report_month', token: co.at, month })); });
shuffle(jobs).forEach(j => j());
const cpu = process.cpuUsage(cpu0), wall = Date.now() - wall0;
// ISOLATION CHECKS
let leaks = 0, checked = 0;
cos.forEach((co, c) => {
  const row = E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === co.cid), g = E.sheetsById[row[9]].tabs.Attendance.g.slice(1).filter(r => r[0] !== '');
  checked += g.length; g.forEach(r => { if (r[col('Company ID')] !== co.cid && !String(r[0]).startsWith('H')) leaks++; if (String(r[col('Name')]).startsWith('C') && !String(r[col('Name')]).startsWith('C' + c + ' ')) leaks++; });
  const d = E.api({ action: 'dashboard', token: co.at }); if (d.total_employees !== PER || [...d.present_list, ...d.absent_list].some(p => !String(p.name).startsWith('C' + c + ' '))) leaks++;
  const a = E.api({ action: 'att_list', token: co.at, from: today, to: today }); if (a.rows.some(r => !String(r.name).startsWith('C' + c + ' '))) leaks++;
  // a staff token of company c must not reach admin functions or another company's data
  const f = E.api({ action: 'dashboard', token: co.staff[0].tok }); if (f.ok) leaks++;
  const other = cos[(c + 1) % COS]; const x = E.api({ action: 'att_list', token: co.at, from: today, to: today, emp: other.staff[0].id, company_id: other.cid }); if (x.rows && x.rows.some(r => String(r.name).startsWith('C' + ((c + 1) % COS) + ' '))) leaks++;
});
const completeSessions = cos.reduce((n, co) => { const row = E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === co.cid); return n + E.sheetsById[row[9]].tabs.Attendance.g.filter(r => r[col('Status')] === 'CLOSED' && String(r[0]).startsWith('ATT')).length; }, 0);
const rows = Object.entries(stats).map(([k, s]) => ({ op: k, n: s.n, p50_ms: pct(s.ms, 50), p95_ms: pct(s.ms, 95), p99_ms: pct(s.ms, 99), max_ms: pct(s.ms, 100), sheet_reads_per_op: +(s.reads / s.n).toFixed(2), getLastRow_per_op: +(s.lastRow / s.n).toFixed(2), cells_read_per_op: Math.round(s.cells / s.n), writes_per_op: +(s.writes / s.n).toFixed(2) }));
const total = Object.values(stats).reduce((n, s) => n + s.n, 0);
console.log(JSON.stringify({ companies: COS, users: COS * PER, total_operations: total, setup_seconds: +(setupMs / 1000).toFixed(1), run_wall_seconds: +(wall / 1000).toFixed(2), cpu_user_seconds: +(cpu.user / 1e6).toFixed(2), cpu_system_seconds: +(cpu.system / 1e6).toFixed(2),
  throughput_ops_per_sec_cpu_bound: +(total / (wall / 1000)).toFixed(0), rss_mb_before: Math.round(mem0 / 1048576), rss_mb_after: Math.round(process.memoryUsage().rss / 1048576), errors, cross_company_leaks: leaks, attendance_rows_checked: checked, completed_sessions_written: completeSessions, expected_sessions: COS * PER, per_operation: rows }, null, 1));
