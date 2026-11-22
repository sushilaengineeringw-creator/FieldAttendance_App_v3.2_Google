'use strict';
// Local stand-in for the deployed web app (real Code.gs + simulated Google services) so live-load.js can be checked end to end. Prints the URL and writes creds.json. Not a Google measurement.
const http = require('http'), fs = require('fs'), { load } = require('../mock-google');
const COS = +process.argv[2] || 5, PER = +process.argv[3] || 5, out = process.argv[4] || '/tmp/creds.json', E = load(); E.x.setup();
const own = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token, companies = [];
for (let c = 0; c < COS; c++) { delete E.cache.reg_rate; delete E.cache.reg_day; const id = E.api({ action: 'register_start', company_name: 'Shim ' + c, admin_name: 'A', mobile: '98' + String(20000000 + c), email: '', admin_pin: 'Secret123' }).company_id;
  E.api({ action: 'owner_activate', token: own, company_id: id, plan: 'Growth', months: 1 }); delete E.cache['co_' + id]; const at = E.api({ action: 'login', company_id: id, id: 'ADMIN', pin: 'Secret123' }).token, staff = [];
  for (let i = 0; i < PER; i++) { const e = E.api({ action: 'emp_add', token: at, name: 'S' + c + i, mobile: '90' + String(30000000 + c * 100 + i), designation: 'T', department: 'D', employee_type: 'Technician' }); staff.push({ id: e.employee.id, pin: e.pin }); } companies.push({ id, admin_pin: 'Secret123', staff }); }
fs.writeFileSync(out, JSON.stringify({ companies }));
const srv = http.createServer((q, r) => { r.setHeader('Access-Control-Allow-Origin', '*'); r.setHeader('Access-Control-Allow-Headers', '*'); if (q.method === 'OPTIONS') { r.statusCode = 204; return r.end(); } let b = ''; q.on('data', d => b += d); q.on('end', () => { setTimeout(() => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(E.api(JSON.parse(b)))); }, +process.env.LATENCY_MS || 0); }); });
srv.listen(0, () => console.log('http://127.0.0.1:' + srv.address().port + '/exec'));
