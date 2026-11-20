'use strict';
// Runs apps-script/Code.gs against tests/mock-google.js (fake SpreadsheetApp / DriveApp that also imitates Sheets' auto-conversion of text).
// This proves OUR logic. It does NOT prove real Google behaves identically - that needs a real deployment (see README).
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./mock-google');

const PHOTO = Buffer.from('fakejpegbytes').toString('base64');
const GOOD = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
const STRONG = 'Admin#Pass1';
let counter = 0, mob = 0;

function fresh() { const E = load(); E.x.setup(); return E; }
function register(E, contact, name) {
  const r = E.api({ action: 'register_start', company_name: name || 'Test Co ' + (++counter), admin_name: 'Asha Admin', mobile: '98765' + String(10000 + (++mob)), email: contact, business_type: 'Service', employees: 10, address: 'Pune', admin_pin: STRONG });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { cid: r.company_id, email: contact };
}
function admin(E, cid) { const r = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }); assert.equal(r.ok, true, JSON.stringify(r)); return r.token; }
function addEmp(E, tok, o = {}) { const r = E.api(Object.assign({ action: 'emp_add', token: tok, name: 'Ravi Kumar', mobile: '9000000001', designation: 'Technician', department: 'Service', type: 'Technician' }, o)); assert.equal(r.ok, true, JSON.stringify(r)); return r; }
function empLogin(E, cid, id, pin) { return E.api({ action: 'login', company_id: cid, id, pin }); }
function setup2(email = 'admin@acme.com') {
  const E = fresh(), c = register(E, email), tok = admin(E, c.cid), e1 = addEmp(E, tok), e2 = addEmp(E, tok, { name: 'Sunil Patil' });
  return { E, c, tok, e1, e2, cid: c.cid, login1: () => empLogin(E, c.cid, e1.employee.id, e1.pin) };
}
const co_ = (E, cid) => E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === cid);
const attTab = (E, cid) => E.sheetsById[co_(E, cid)[9]].tabs.Attendance;
const attRows = (E, cid) => attTab(E, cid).g.slice(1);
const empTab = (E, cid) => E.sheetsById[co_(E, cid)[9]].tabs.Employees;
const regRows = (E) => E.registry.ss.getSheetByName('Companies').g;
const photosFiles = (E, cid) => Object.values(E.filesById).filter(f => !f.folder && f.parents[0] === co_(E, cid)[10]);

test('registration: ONE step inside the app - sheet + folders created, trial starts, no Google account involved, password only as salted hash', () => {
  const E = fresh(), c = register(E, 'owner1@acme.com', 'Acme Engineering');
  const row = co_(E, c.cid); assert.equal(row[12], 'Trial'); assert.equal(row[1], 'Acme Engineering');
  const ss = E.sheetsById[row[9]]; assert.deepEqual(Object.keys(ss.tabs).sort(), ['Attendance', 'Employees', 'Info']);
  assert.deepEqual(ss.tabs.Employees.g[0], E.x.EMP_H); assert.deepEqual(ss.tabs.Attendance.g[0], E.x.ATT_H);
  const photos = E.filesById[row[10]], reports = E.filesById[row[11]], root = E.filesById[row[20]];
  assert.ok(photos.folder && reports.folder && root.folder); assert.deepEqual(photos.parents, [row[20]]); assert.deepEqual(reports.parents, [row[20]]);
  assert.equal(photos.sharing, 'ANYONE_WITH_LINK:VIEW');                                                          // Excel "View photo" links work for the company admin
  assert.equal(root.sharing, null); assert.equal(reports.sharing, null);                                          // nothing else is shared
  assert.deepEqual(E.filesById[row[9]] && E.filesById[row[9]].parents, undefined);
  assert.ok(row[14] > E.x.ymd_(new Date()));                                                                       // trial expiry in the future
  assert.equal(row[18].length, 64); assert.ok(!JSON.stringify(row).includes(STRONG));
  assert.ok(!E.log.some(l => /oauth|googleapis/i.test(l)));
  assert.equal(E.api({ action: 'login', company_id: c.cid, id: 'ADMIN', pin: STRONG }).ok, true);                 // the admin can sign in straight away
});
test('registration: Drive failure leaves the company Pending (cannot log in) and returns a clear retryable error', () => {
  const E = fresh(); E.store.failDrive = true;
  const r = E.api({ action: 'register_start', company_name: 'Broken Co', admin_name: 'A', mobile: '9876543210', email: '', employees: 5, admin_pin: STRONG });
  assert.equal(r.ok, false); assert.equal(r.error, 'SERVER_ERROR'); assert.match(r.message, /try again/i);
  const row = regRows(E).find(x => x[1] === 'Broken Co'); assert.equal(row[12], 'Pending'); assert.match(row[19], /Setup failed/);
  assert.equal(E.api({ action: 'login', company_id: row[0], id: 'ADMIN', pin: STRONG }).error, 'AUTH_BAD');
  E.store.failDrive = false; assert.equal(E.api({ action: 'register_start', company_name: 'Broken Co', admin_name: 'A', mobile: '9876543210', email: '', employees: 5, admin_pin: STRONG }).ok, true);
});
test('registration input validation (email is optional) and rate limit', () => {
  const E = fresh(), base = { action: 'register_start', company_name: 'X', admin_name: 'A', mobile: '9876543210', email: 'a@b.com', admin_pin: STRONG };
  assert.equal(E.api({ ...base, email: 'nope' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ ...base, mobile: 'abc' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ ...base, admin_pin: '123' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ ...base, company_name: '' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ ...base, company_name: 'N'.repeat(81) }).error, 'BAD_REQUEST');
  assert.equal(E.api({ ...base, email: '' }).ok, true);
  for (let i = 0; i < 24; i++) assert.equal(E.api({ ...base, company_name: 'Bulk ' + i, mobile: '97000' + String(10000 + i) }).ok, true);
  assert.equal(E.api({ ...base, company_name: 'One too many' }).error, 'RATE_LIMIT');
});
test('values Sheets would auto-convert survive: all-digit admin salt with leading zeros, "=" names, phone numbers, ISO times', () => {
  const E = fresh(), vm = require('node:vm'); vm.runInContext('this.__r = Math.random; Math.random = () => 0.375', E.ctx);                    // salt becomes 0000000000000000
  const c = register(E, '', '=HYPERLINK("x")'); vm.runInContext('Math.random = this.__r', E.ctx);
  const row = co_(E, c.cid); assert.equal(row[17], '0000000000000000'); assert.equal(typeof row[17], 'string'); assert.equal(row[1], '=HYPERLINK("x")');
  const tok = admin(E, c.cid);
  const e = addEmp(E, tok, { name: '=1+1', mobile: '0123456789' });
  const list = E.api({ action: 'emp_list', token: tok }).employees; assert.equal(list[0].name, '=1+1'); assert.equal(list[0].mobile, '0123456789');
  const t = empLogin(E, c.cid, 'E001', e.pin).token; assert.equal(E.api({ action: 'checkin', token: t, ...GOOD, idem: 'cv1', photo: PHOTO }).ok, true);
  const r = attRows(E, c.cid)[0]; assert.equal(typeof r[1], 'string'); assert.match(r[1], /^\d{4}-\d{2}-\d{2}$/); assert.match(r[5], /^\d{2}:\d{2}$/); assert.match(r[21], /T.*Z$/);
  assert.equal(E.api({ action: 'checkout', token: t, ...GOOD, idem: 'cv1o' }).ok, true); assert.equal(E.api({ action: 'history', token: t }).sessions[0].status, 'CLOSED');
});
test('admin login: wrong password rejected, 5 failures lock the account, company id not trusted without credentials', () => {
  const { E, cid } = setup2();
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'wrongwrong' }).error, 'AUTH_BAD');
  for (let i = 0; i < 5; i++) E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'wrongwrong' });
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }).error, 'AUTH_LOCKED');
  assert.equal(E.api({ action: 'dashboard' }).error, 'SESSION_EXPIRED'); assert.equal(E.api({ action: 'dashboard', token: 'Sfake', company_id: cid }).error, 'SESSION_EXPIRED');
});
test('employee management: automatic IDs, hashed PINs, manager assignment, reset PIN, edit', () => {
  const { E, tok, e1, e2, cid } = setup2();
  assert.equal(e1.employee.id, 'E001'); assert.equal(e2.employee.id, 'E002'); assert.match(e1.pin, /^\d{6}$/);
  const mg = addEmp(E, tok, { name: 'Meena Manager', role: 'Manager', designation: 'Service Manager' }); assert.equal(mg.employee.id, 'M001');
  const sheetText = JSON.stringify(empTab(E, cid).g); assert.ok(!sheetText.includes(e1.pin)); assert.ok(sheetText.includes('PIN Hash'));   // no clear-text PINs in the sheet
  assert.equal(E.api({ action: 'emp_update', token: tok, id: 'E001', manager: 'M999' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ action: 'emp_update', token: tok, id: 'E001', manager: 'M001', site: 'Plant 1', lat: 18.52, lng: 73.85, radius: 150, department: 'Projects' }).employee.manager, 'M001');
  assert.equal(E.api({ action: 'emp_update', token: tok, id: 'E001', type: 'Pilot' }).error, 'BAD_REQUEST');
  const rp = E.api({ action: 'emp_reset_pin', token: tok, id: 'E001' }); assert.equal(rp.ok, true);
  assert.equal(empLogin(E, cid, 'E001', e1.pin).error, 'AUTH_BAD'); assert.equal(empLogin(E, cid, 'E001', rp.pin).ok, true);
  assert.equal(E.api({ action: 'emp_list', token: tok }).employees.length, 3);
});
test('employee limit is enforced', () => {
  const { E, tok, cid } = setup2(); const t = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token;
  E.api({ action: 'owner_update', token: t, company_id: cid, limit: 2 });
  assert.equal(E.api({ action: 'emp_add', token: tok, name: 'Third' }).error, 'LIMIT_REACHED');
});
test('FULL FLOW: employee login -> check-in with photo+GPS -> row + photo in the company Drive folder -> duplicate-safe -> check-out -> hours', () => {
  const { E, cid, e1, login1 } = setup2(); const L = login1(); assert.equal(L.ok, true); assert.equal(L.role, 'EMPLOYEE'); const tok = L.token;
  const idem = 'k1', ci = E.api({ action: 'checkin', token: tok, ...GOOD, idem, photo: PHOTO });
  assert.equal(ci.ok, true, JSON.stringify(ci)); assert.equal(ci.session.status, 'OPEN');
  const H = E.x.ATT_H, g = attTab(E, cid).g; assert.equal(g.length, 2); const row = g[1];
  assert.equal(row[H.indexOf('Employee ID')], 'E001'); assert.equal(row[H.indexOf('Company ID')], cid); assert.equal(row[H.indexOf('IN Lat')], 18.5204);
  assert.match(row[H.indexOf('IN Map')], /maps\?q=18\.5204,73\.8567/); assert.equal(row[H.indexOf('IN Key')], idem);
  const files = photosFiles(E, cid); assert.equal(files.length, 1); assert.equal(files[0].bytes.toString(), 'fakejpegbytes');
  assert.match(files[0].name, /^\d{4}-\d{2}-\d{2}_E001_\d{4}_ATT-/);
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem, photo: PHOTO }).duplicate, true);               // retry: same row, no 2nd photo
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem: 'k2', photo: PHOTO }).error, 'ALREADY_CHECKED_IN');
  assert.equal(attRows(E, cid).length, 1); assert.equal(photosFiles(E, cid).length, 1);
  assert.equal(E.api({ action: 'me', token: tok }).open_session.ref, row[0]);
  const co = E.api({ action: 'checkout', token: tok, lat: 18.6, lng: 73.9, accuracy: 30, idem: 'o1' }); assert.equal(co.ok, true); assert.equal(co.session.status, 'CLOSED');   // no photo needed
  assert.equal(attRows(E, cid).length, 1); const r2 = attRows(E, cid)[0];
  assert.equal(r2[H.indexOf('OUT Lat')], 18.6); assert.ok(r2[H.indexOf('Duration')]); assert.equal(r2[H.indexOf('Status')], 'CLOSED'); assert.ok(r2[H.indexOf('OUT Server Time')]);
  assert.equal(E.api({ action: 'checkout', token: tok, lat: 18.6, lng: 73.9, accuracy: 30, idem: 'o1' }).duplicate, true);
  assert.equal(E.api({ action: 'checkout', token: tok, lat: 18.6, lng: 73.9, accuracy: 30, idem: 'o2' }).error, 'NO_OPEN_SESSION');
  assert.equal(E.api({ action: 'history', token: tok }).sessions.length, 1);
});
test('GPS: any accuracy is recorded (with warning); invalid location or missing photo rejected, nothing saved', () => {
  const { E, cid, login1 } = setup2(); const tok = login1().token, H = E.x.ATT_H;
  assert.equal(E.api({ action: 'checkin', token: tok, lat: 0, lng: 0, accuracy: 5, idem: 'a', photo: PHOTO }).error, 'BAD_LOCATION');
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem: 'b' }).error, 'PHOTO_REQUIRED');
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem: 'c', photo: 'A'.repeat(4000001) }).error, 'PHOTO_TOO_LARGE');
  assert.equal(attRows(E, cid).length, 0); assert.equal(photosFiles(E, cid).length, 0);
  const r = E.api({ action: 'checkin', token: tok, ...GOOD, accuracy: 150, idem: 'd', photo: PHOTO });
  assert.equal(r.ok, true); assert.match(r.warning, /accuracy was low/); assert.equal(attRows(E, cid)[0][H.indexOf('IN Accuracy (m)')], 150);
});
test('site geofence: inside / outside / not configured', () => {
  const { E, tok, cid, e1 } = setup2(); const H = E.x.ATT_H;
  E.api({ action: 'emp_update', token: tok, id: 'E001', site: 'Plant', lat: 18.5204, lng: 73.8567, radius: 200 });
  const t1 = empLogin(E, cid, 'E001', e1.pin).token; let r = E.api({ action: 'checkin', token: t1, ...GOOD, idem: 'g1', photo: PHOTO });
  assert.equal(r.ok, true); assert.equal(attRows(E, cid)[0][H.indexOf('IN On site?')], 'Yes');
  E.api({ action: 'checkout', token: t1, ...GOOD, idem: 'go1' });
  r = E.api({ action: 'checkin', token: t1, lat: 18.6, lng: 73.9, accuracy: 10, idem: 'g2', photo: PHOTO });
  assert.match(r.warning, /m from your assigned site/); assert.equal(attRows(E, cid)[1][H.indexOf('IN On site?')], 'No');
  const t2 = empLogin(E, cid, 'E002', addEmpPin(E, tok, 'E002')).token; E.api({ action: 'checkin', token: t2, ...GOOD, idem: 'g3', photo: PHOTO });
  assert.equal(attRows(E, cid)[2][H.indexOf('IN On site?')], 'n/a');
});
function addEmpPin(E, tok, id) { return E.api({ action: 'emp_reset_pin', token: tok, id, pin: 'pin' + id }).pin; }

test('roles: employee cannot use admin APIs; manager sees only assigned employees (list, photos, reports); admin sees all', () => {
  const { E, c, tok, e1, e2 } = setup2(); const cid = c.cid;
  const m1 = addEmp(E, tok, { name: 'Mgr One', role: 'Manager' }), m2 = addEmp(E, tok, { name: 'Mgr Two', role: 'Manager' });
  E.api({ action: 'emp_update', token: tok, id: 'E001', manager: m1.employee.id }); E.api({ action: 'emp_update', token: tok, id: 'E002', manager: m2.employee.id });
  const t1 = empLogin(E, cid, 'E001', e1.pin).token, t2 = empLogin(E, cid, 'E002', e2.pin).token;
  E.api({ action: 'checkin', token: t1, ...GOOD, idem: 'r1', photo: PHOTO }); E.api({ action: 'checkin', token: t2, ...GOOD, idem: 'r2', photo: PHOTO });
  for (const a of ['dashboard', 'att_list', 'emp_list', 'emp_add', 'report_month', 'company_info', 'owner_list']) assert.equal(E.api({ action: a, token: t1 }).error, 'FORBIDDEN', a);
  const lm1 = empLogin(E, cid, m1.employee.id, m1.pin); assert.equal(lm1.role, 'MANAGER'); const mt1 = lm1.token;
  const list = E.api({ action: 'att_list', token: mt1 }); assert.deepEqual(list.rows.map(r => r.id), ['E001']);
  assert.equal(E.api({ action: 'emp_list', token: mt1 }).employees.length, 1);
  assert.equal(E.api({ action: 'emp_add', token: mt1, name: 'x' }).error, 'FORBIDDEN'); assert.equal(E.api({ action: 'emp_update', token: mt1, id: 'E001', status: 'Revoked' }).error, 'FORBIDDEN');
  assert.equal(E.api({ action: 'photo', token: mt1, photo_id: list.rows[0].photo_id }).ok, true);                       // own team's photo
  const adminList = E.api({ action: 'att_list', token: tok }); assert.equal(adminList.count, 2);
  const otherPhoto = adminList.rows.find(r => r.id === 'E002').photo_id;
  assert.equal(E.api({ action: 'photo', token: mt1, photo_id: otherPhoto }).error, 'FORBIDDEN');                       // another manager's employee
  const ph = E.api({ action: 'photo', token: tok, photo_id: otherPhoto }); assert.match(ph.image, /^data:image\/jpeg;base64,/); assert.equal(Buffer.from(ph.image.split(',')[1], 'base64').toString(), 'fakejpegbytes');
  assert.equal(E.api({ action: 'dashboard', token: mt1 }).total_employees, 1); assert.equal(E.api({ action: 'dashboard', token: tok }).total_employees, 4 - 2);
  assert.equal(E.api({ action: 'report_month', token: mt1 }).employees.length, 1);
});
test('dashboard numbers: present, absent, logged in now, completed, missed check-outs', () => {
  const { E, tok, cid, e1, e2 } = setup2(); const H = E.x.ATT_H;
  const t1 = empLogin(E, cid, 'E001', e1.pin).token, t2 = empLogin(E, cid, 'E002', e2.pin).token;
  E.api({ action: 'checkin', token: t1, ...GOOD, idem: 'd1', photo: PHOTO });
  let d = E.api({ action: 'dashboard', token: tok }); assert.deepEqual([d.total_employees, d.active_employees, d.present_today, d.absent_today, d.logged_in_now, d.completed_checkouts], [2, 2, 1, 1, 1, 0]);
  E.api({ action: 'checkout', token: t1, ...GOOD, idem: 'd1o' }); E.api({ action: 'checkin', token: t2, ...GOOD, idem: 'd2', photo: PHOTO });
  d = E.api({ action: 'dashboard', token: tok }); assert.deepEqual([d.present_today, d.logged_in_now, d.completed_checkouts, d.missed_checkouts], [2, 1, 1, 0]);
  const yest = E.x.addDays_(E.x.ymd_(new Date()), -1); const row = Array(H.length).fill(''); row[0] = 'ATT-OLD'; row[1] = yest; row[2] = 'E001'; row[H.indexOf('Status')] = 'OPEN';
  const g = attTab(E, cid).g; g.splice(1, 0, row);                               // older row first (keeps date order)
  // today's month start may equal yesterday's month only when today is not the 1st; guard that case
  d = E.api({ action: 'dashboard', token: tok }); if (yest.slice(0, 7) === E.x.ymd_(new Date()).slice(0, 7)) assert.equal(d.missed_checkouts, 1);
});
test('COMPANY ISOLATION: two companies have separate sheets, folders, users and sessions; nothing crosses', () => {
  const E = fresh(); const A = register(E, 'a@alpha.com', 'Alpha'), B = register(E, 'b@beta.com', 'Beta');
  const ta = admin(E, A.cid), tb = admin(E, B.cid);
  const ea = addEmp(E, ta, { name: 'Alpha Emp' }), eb = addEmp(E, tb, { name: 'Beta Emp' });
  assert.equal(ea.employee.id, 'E001'); assert.equal(eb.employee.id, 'E001');                                       // same visible id in each company
  assert.notEqual(co_(E, A.cid)[9], co_(E, B.cid)[9]); assert.notEqual(co_(E, A.cid)[10], co_(E, B.cid)[10]);
  assert.equal(empLogin(E, B.cid, 'E001', ea.pin).error, 'AUTH_BAD');                                                // alpha's pin does not open beta's E001
  const xa = empLogin(E, A.cid, 'E001', ea.pin).token, xb = empLogin(E, B.cid, 'E001', eb.pin).token;
  E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'i1', photo: PHOTO }); E.api({ action: 'checkin', token: xb, ...GOOD, idem: 'i2', photo: Buffer.from('betaphoto').toString('base64') });
  assert.equal(attRows(E, A.cid).length, 1); assert.equal(attRows(E, B.cid).length, 1);
  assert.equal(E.api({ action: 'att_list', token: ta }).rows.map(r => r.name).join(), 'Alpha Emp');
  assert.equal(E.api({ action: 'att_list', token: ta, company_id: B.cid }).rows.map(r => r.name).join(), 'Alpha Emp');   // a supplied company_id is ignored
  const betaPhoto = E.api({ action: 'att_list', token: tb }).rows[0].photo_id;
  assert.equal(E.api({ action: 'photo', token: ta, photo_id: betaPhoto }).error, 'FORBIDDEN');                          // alpha cannot fetch beta's photo
  assert.equal(E.api({ action: 'emp_update', token: ta, id: 'E001', name: 'Hacked' }).employee.name, 'Hacked');           // affects alpha only
  assert.equal(E.api({ action: 'emp_list', token: tb }).employees[0].name, 'Beta Emp');
  // a broken sheet id is reported to the owner only, never crashes the console
  const rowA = regRows(E).find(r => r[0] === A.cid); rowA[9] = 'SSbogus00000000'; delete E.cache['co_' + A.cid];
  const own = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; assert.match(E.api({ action: 'owner_detail', token: own, company_id: A.cid }).storage_error, /could be found/i);
});
test('licence: owner suspend / expire / extend affects ONLY that company; employee suspend/deactivate blocks immediately', () => {
  const E = fresh(); const A = register(E, 'a@alpha.com', 'Alpha'), B = register(E, 'b@beta.com', 'Beta'), ta = admin(E, A.cid), tb = admin(E, B.cid);
  const ea = addEmp(E, ta), eb = addEmp(E, tb); const xa = empLogin(E, A.cid, 'E001', ea.pin).token, xb = empLogin(E, B.cid, 'E001', eb.pin).token;
  assert.equal(E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'l1', photo: PHOTO }).ok, true);
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token;
  assert.equal(E.api({ action: 'owner_login', password: 'bad' }).error, 'AUTH_BAD');
  assert.equal(E.api({ action: 'owner_update', token: o, company_id: A.cid, status: 'Suspended' }).company.status, 'Suspended'); E.cache['co_' + A.cid] = undefined; delete E.cache['co_' + A.cid];
  assert.equal(E.api({ action: 'checkout', token: xa, ...GOOD, idem: 'l1o' }).error, 'LICENCE_SUSPENDED');
  assert.equal(empLogin(E, A.cid, 'E001', ea.pin).error, 'LICENCE_SUSPENDED');
  assert.equal(E.api({ action: 'emp_add', token: ta, name: 'New' }).error, 'LICENCE_SUSPENDED');
  assert.equal(E.api({ action: 'att_list', token: ta }).error, 'LICENCE_SUSPENDED');                                // records are kept, but lists / reports need an active plan
  assert.equal(E.api({ action: 'dashboard', token: ta }).ok, true);                                                  // the admin can still open the dashboard and see why
  assert.equal(E.api({ action: 'checkin', token: xb, ...GOOD, idem: 'l2', photo: PHOTO }).ok, true);                 // other company unaffected
  E.api({ action: 'owner_update', token: o, company_id: A.cid, status: 'Active' }); delete E.cache['co_' + A.cid];
  assert.equal(E.api({ action: 'checkout', token: xa, ...GOOD, idem: 'l1o' }).ok, true);
  E.api({ action: 'owner_update', token: o, company_id: A.cid, expiry: '2020-01-01' }); delete E.cache['co_' + A.cid];
  assert.equal(E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'l3', photo: PHOTO }).error, 'LICENCE_EXPIRED');
  const ext = E.api({ action: 'owner_update', token: o, company_id: A.cid, extend_days: 30 }); delete E.cache['co_' + A.cid];
  assert.ok(ext.company.expiry > E.x.ymd_(new Date())); assert.equal(E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'l4', photo: PHOTO }).ok, true);
  E.api({ action: 'checkout', token: xa, ...GOOD, idem: 'l4o' });
  E.api({ action: 'emp_update', token: ta, id: 'E001', status: 'Suspended' });                                         // admin suspends one employee
  assert.equal(E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'l5', photo: PHOTO }).error, 'LICENCE_SUSPENDED');
  E.api({ action: 'emp_update', token: ta, id: 'E001', status: 'Active' }); const xa2 = empLogin(E, A.cid, 'E001', ea.pin).token;
  E.api({ action: 'emp_update', token: ta, id: 'E001', status: 'Inactive' });
  assert.equal(E.api({ action: 'checkin', token: xa2, ...GOOD, idem: 'l6', photo: PHOTO }).error, 'LICENCE_INACTIVE');
  assert.equal(empLogin(E, A.cid, 'E001', ea.pin).error, 'LICENCE_INACTIVE');
  assert.equal(E.api({ action: 'owner_list', token: o }).companies.length, 2);
  assert.equal(E.api({ action: 'owner_list', token: ta }).error, 'FORBIDDEN');
  const det = E.api({ action: 'owner_detail', token: o, company_id: A.cid }); assert.equal(det.users, 1);
});
test('speed design: daily actions read only recent rows; 700 old rows do not break check-in / check-out / history', () => {
  const { E, cid, e1 } = setup2(); const H = E.x.ATT_H, g = attTab(E, cid).g;
  for (let i = 0; i < 700; i++) { const r = Array(H.length).fill(''); r[0] = 'OLD' + i; r[1] = '2026-01-01'; r[2] = 'E002'; r[H.indexOf('Status')] = 'CLOSED'; g.push(r); }
  const tok = empLogin(E, cid, 'E001', e1.pin).token;
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem: 'sp1', photo: PHOTO }).ok, true);
  assert.equal(E.api({ action: 'checkin', token: tok, ...GOOD, idem: 'sp2', photo: PHOTO }).error, 'ALREADY_CHECKED_IN');
  assert.equal(E.api({ action: 'checkout', token: tok, ...GOOD, idem: 'sp1o' }).ok, true); assert.equal(g.length, 702);   // header + 700 old + 1 new
  assert.equal(E.api({ action: 'history', token: tok }).sessions.length, 1);
  E.log.length = 0; E.api({ action: 'me', token: tok });
  assert.ok(E.log.filter(l => l === 'getValues').length <= 3, 'me() should need only a few sheet reads: ' + E.log.length);
});
test('10 employees check in one after another: 10 distinct rows, 10 photos, no cross-talk', () => {
  const { E, tok, cid } = setup2(); const toks = [];
  E.api({ action: 'owner_activate', token: E.api({ action: 'owner_login', password: 'owner-pass-1' }).token, company_id: cid, plan: 'Starter', months: 1 });   // a trial allows only 5 users
  for (let i = 0; i < 8; i++) addEmp(E, tok, { name: 'Emp ' + i });
  const list = E.api({ action: 'emp_list', token: tok }).employees; assert.equal(list.length, 10);
  list.forEach(e => { const p = E.api({ action: 'emp_reset_pin', token: tok, id: e.id, pin: 'pin' + e.id }).pin; toks.push(empLogin(E, cid, e.id, p).token); });
  toks.forEach((t, i) => assert.equal(E.api({ action: 'checkin', token: t, ...GOOD, idem: 'bulk' + i, photo: PHOTO }).ok, true));
  assert.equal(attRows(E, cid).length, 10); assert.equal(new Set(attRows(E, cid).map(r => r[2])).size, 10); assert.equal(photosFiles(E, cid).length, 10);
});

test('monthly report: P / L / WO, Sundays, multi-session hours, a session left open for 12+ hours is auto-marked-out (v3.5), future days blank, scoped employees', () => {
  const { E, tok, cid } = setup2(); const H = E.x.ATT_H, g = attTab(E, cid).g;
  const add = (date, id, inT, outT, status) => { const r = Array(H.length).fill(''); r[0] = 'R' + g.length; r[1] = date; r[2] = id; r[H.indexOf('IN Time')] = '09:00'; r[H.indexOf('IN Server Time')] = inT; r[H.indexOf('OUT Server Time')] = outT || ''; r[H.indexOf('Status')] = status; r[H.indexOf('IN Lat')] = 18.5; r[H.indexOf('IN Long')] = 73.8; r[H.indexOf('IN Map')] = 'https://www.google.com/maps?q=18.5,73.8'; r[H.indexOf('Photo')] = 'https://drive.google.com/file/d/FILEX123456789/view'; g.push(r); };
  add('2026-02-02', 'E001', '2026-02-02T03:30:00Z', '2026-02-02T12:00:00Z', 'CLOSED');       // 8.5 h
  add('2026-02-03', 'E001', '2026-02-03T04:00:00Z', '2026-02-03T06:00:00Z', 'CLOSED');       // 2 h
  add('2026-02-03', 'E001', '2026-02-03T07:00:00Z', '2026-02-03T10:00:00Z', 'CLOSED');       // 3 h  (second session same day)
  add('2026-02-04', 'E001', '2026-02-04T04:00:00Z', '', 'OPEN');                              // logged in, never logged out -> since v3.5 marked out automatically after 12 h (was MC)
  add('2026-02-01', 'E002', '2026-02-01T04:00:00Z', '2026-02-01T08:00:00Z', 'CLOSED');       // worked on a Sunday -> P (yellow in Excel)
  const r = E.api({ action: 'report_month', token: tok, month: '2026-02' });
  assert.equal(r.ok, true); assert.equal(r.days, 28); assert.equal(r.dows[0], 0); assert.equal(r.employees.length, 2);
  const p1 = r.pa.find(x => x.id === 'E001'), h1 = r.hours.find(x => x.id === 'E001');
  assert.deepEqual([p1.P, p1.MC, p1.WO, p1.L], [3, 0, 4, 21]); assert.equal(p1.codes[0], 'WO'); assert.equal(p1.codes[1], 'P'); assert.equal(p1.codes[3], 'P'); assert.equal(p1.hours, 25.5);
  assert.equal(h1.values[1], 8.5); assert.equal(h1.values[2], 5); assert.equal(h1.values[3], 12); assert.equal(h1.total, 25.5); assert.equal(h1.days_worked, 3);
  const p2 = r.pa.find(x => x.id === 'E002'); assert.equal(p2.codes[0], 'P'); assert.equal(p2.WO, 3);
  assert.equal(r.location.length, 5); assert.equal(r.location[0].date, '2026-02-01'); assert.equal(r.location.find(x => x.auto_out).hours, 12); assert.ok(!r.location.some(x => x.status === 'OPEN')); assert.equal(r.location[1].photo_id, 'FILEX123456789');
  const cur = E.x.ymd_(new Date()).slice(0, 7), rc = E.api({ action: 'report_month', token: tok, month: cur }), last = rc.days, today = +E.x.ymd_(new Date()).slice(8);
  if (today < last) assert.equal(rc.pa[0].codes[last - 1], '');                                                       // dates after today stay blank
  const leap = E.api({ action: 'report_month', token: tok, month: '2028-02' }); assert.equal(leap.days, 29);
  assert.equal(E.api({ action: 'report_month', token: tok, month: '2026-13' }).error, 'BAD_REQUEST');
  const jan = E.api({ action: 'report_month', token: tok, month: '2026-01' }); assert.equal(jan.days, 31);
});

test('account deletion: admin requests (password re-checked) -> company switched off -> can cancel -> owner purges sheet + folders; other companies untouched', () => {
  const E = fresh(), A = register(E, 'a@alpha.com', 'Alpha'), B = register(E, 'b@beta.com', 'Beta'), ta = admin(E, A.cid), tb = admin(E, B.cid);
  const ea = addEmp(E, ta), eb = addEmp(E, tb), xa = empLogin(E, A.cid, 'E001', ea.pin).token, xb = empLogin(E, B.cid, 'E001', eb.pin).token;
  assert.equal(E.api({ action: 'checkin', token: xa, ...GOOD, idem: 'dl1', photo: PHOTO }).ok, true);
  assert.equal(E.api({ action: 'company_delete_request', token: xa, pin: STRONG }).error, 'FORBIDDEN');                 // employees cannot
  assert.equal(E.api({ action: 'company_delete_request', token: ta, pin: 'wrong-pass' }).error, 'PASSWORD_BAD');           // password must be right (own code: the app stays signed in)
  assert.equal(E.api({ action: 'company_delete_request', token: ta, pin: STRONG }).status, 'DeletionRequested');
  assert.equal(E.api({ action: 'company_delete_request', token: ta, pin: STRONG }).status, 'DeletionRequested');       // repeating is harmless
  assert.equal(co_(E, A.cid)[12], 'DeletionRequested'); delete E.cache['co_' + A.cid];
  assert.equal(E.api({ action: 'checkout', token: xa, ...GOOD, idem: 'dl1o' }).error, 'LICENCE_DELETIONREQUESTED');   // attendance is off at once
  assert.equal(empLogin(E, A.cid, 'E001', ea.pin).ok, false);
  assert.match(E.api({ action: 'company_info', token: ta }).licence.message, /Deletion .* requested/);                   // admin still sees why
  assert.equal(E.api({ action: 'checkin', token: xb, ...GOOD, idem: 'dl2', photo: PHOTO }).ok, true);                    // Beta unaffected
  const c = E.api({ action: 'company_delete_cancel', token: ta }); assert.equal(c.status, 'Trial'); delete E.cache['co_' + A.cid];   // restores the previous status
  assert.equal(E.api({ action: 'checkout', token: xa, ...GOOD, idem: 'dl1o' }).ok, true);
  assert.equal(E.api({ action: 'company_delete_cancel', token: ta }).error, 'BAD_REQUEST');
  E.api({ action: 'company_delete_request', token: ta, pin: STRONG }); delete E.cache['co_' + A.cid];
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token, row = co_(E, A.cid), root = row[20], sheet = row[9];
  assert.equal(E.api({ action: 'owner_purge', token: ta, company_id: A.cid, confirm: A.cid }).error, 'FORBIDDEN');
  assert.equal(E.api({ action: 'owner_purge', token: o, company_id: A.cid, confirm: 'nope' }).error, 'BAD_REQUEST');
  const p = E.api({ action: 'owner_purge', token: o, company_id: A.cid, confirm: A.cid.toLowerCase() }); assert.equal(p.ok, true); assert.equal(p.company.status, 'Deleted');
  assert.equal(E.filesById[root].trashed, true);                                                                          // folders (and the sheet inside) go to Drive trash
  const after = co_(E, A.cid); assert.equal(after[9], ''); assert.equal(after[18], ''); assert.equal(after[3], ''); assert.equal(after[4], '');   // sheet link, password hash, mobile, email removed
  assert.equal(empLogin(E, A.cid, 'E001', ea.pin).ok, false); assert.equal(E.api({ action: 'login', company_id: A.cid, id: 'ADMIN', pin: STRONG }).ok, false);
  assert.equal(E.api({ action: 'owner_update', token: o, company_id: A.cid, status: 'Active' }).error, 'BAD_REQUEST');
  assert.equal(E.sheetsById[co_(E, B.cid)[9]] !== undefined, true); assert.equal(E.filesById[co_(E, B.cid)[20]].trashed, false);
  assert.ok(regRows(E).length >= 3); const audit = E.registry.ss.getSheetByName('Audit').g.map(r => r[3]); assert.ok(audit.includes('DELETE_REQUEST') && audit.includes('PURGE'));
});

// ---------------- v3.3: trial rules, plans, reports need an active plan ----------------
const ownerTok = (E) => E.api({ action: 'owner_login', password: 'owner-pass-1' }).token;
const regRaw = (E, over) => E.api(Object.assign({ action: 'register_start', company_name: 'Raw Co', admin_name: 'A', mobile: '9811111111', email: '', admin_pin: STRONG }, over));
const dropCache = (E, cid) => { delete E.cache['co_' + cid]; };

test('trial: 10 days, up to 5 users (employees + managers); the 6th is refused with a clear message', () => {
  const E = fresh(), c = register(E, 'a@a.com', 'TrialCo'), tok = admin(E, c.cid), row = co_(E, c.cid);
  assert.equal(row[12], 'Trial'); assert.equal(row[15], 5); assert.equal(row[14], E.x.addDays_(E.x.ymd_(new Date()), 10));
  for (let i = 0; i < 5; i++) addEmp(E, tok, { name: 'P' + i });
  const r = E.api({ action: 'emp_add', token: tok, name: 'Sixth' }); assert.equal(r.error, 'LIMIT_REACHED'); assert.match(r.message, /5 users/);
});
test('one free trial per mobile number: +91 / spaces / 0-prefix variants are the same number; failed (Pending) attempts do not count; deleted companies still count', () => {
  const E = fresh();
  assert.equal(regRaw(E, { company_name: 'First', mobile: '98765 43210' }).ok, true);
  for (const m of ['9876543210', '+91 9876543210', '09876543210', '91-98765-43210']) { const r = regRaw(E, { company_name: 'Again', mobile: m }); assert.equal(r.error, 'MOBILE_USED', m); assert.match(r.message, /already registered/); }
  assert.equal(regRaw(E, { company_name: 'Other number', mobile: '9876543211' }).ok, true);
  // Drive down: Pending row is created, the retry with the SAME number must still work
  E.store.failDrive = true; assert.equal(regRaw(E, { company_name: 'Flaky', mobile: '9822222222' }).error, 'SERVER_ERROR');
  E.store.failDrive = false; assert.equal(regRaw(E, { company_name: 'Flaky', mobile: '9822222222' }).ok, true);
  // delete the first company completely: the number stays used
  const first = E.registry.ss.getSheetByName('Companies').g.find(r => r[1] === 'First'), cid = first[0], o = ownerTok(E);
  const t = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }).token;
  assert.equal(E.api({ action: 'company_delete_request', token: t, pin: STRONG }).ok, true); dropCache(E, cid);
  assert.equal(E.api({ action: 'owner_purge', token: o, company_id: cid, confirm: cid }).ok, true); dropCache(E, cid);
  const purged = co_(E, cid); assert.equal(purged[12], 'Deleted'); assert.equal(purged[3], '');                       // mobile text is erased ...
  assert.match(purged[21], /^[0-9a-f]{64}$/);                                                                        // ... only the one-way key stays
  assert.equal(regRaw(E, { company_name: 'Comeback', mobile: '9876543210' }).error, 'MOBILE_USED');
});
test('reports, lists and photos need an active plan; the dashboard and company screen still open so the admin sees why', () => {
  const E = fresh(), c = register(E, 'a@a.com', 'LockCo'), tok = admin(E, c.cid), o = ownerTok(E), e1 = addEmp(E, tok), x = empLogin(E, c.cid, 'E001', e1.pin).token;
  E.api({ action: 'checkin', token: x, ...GOOD, idem: 'k1', photo: PHOTO }); E.api({ action: 'checkout', token: x, ...GOOD, idem: 'k1o' });
  const month = E.x.ymd_(new Date()).slice(0, 7), pid = attRows(E, c.cid)[0][10].match(/\/d\/([^/]+)/)[1];
  assert.equal(E.api({ action: 'report_month', token: tok, month }).ok, true); assert.equal(E.api({ action: 'att_list', token: tok }).ok, true); assert.equal(E.api({ action: 'photo', token: tok, photo_id: pid }).ok, true);
  E.api({ action: 'owner_update', token: o, company_id: c.cid, expiry: '2020-01-01' }); dropCache(E, c.cid);           // trial has ended
  for (const a of [{ action: 'report_month', month }, { action: 'att_list' }, { action: 'photo', photo_id: pid }]) { const r = E.api({ ...a, token: tok }); assert.equal(r.error, 'LICENCE_EXPIRED', a.action); assert.match(r.message, /free trial has ended/i); assert.equal(r.licence.valid, false); }
  assert.equal(E.api({ action: 'dashboard', token: tok }).ok, true); assert.equal(E.api({ action: 'company_info', token: tok }).ok, true);
  const act = E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Starter', months: 1 }); assert.equal(act.ok, true); dropCache(E, c.cid);
  assert.equal(E.api({ action: 'report_month', token: tok, month }).ok, true);                                      // paid: reports work again
});
test('owner_activate: plan sets status, name, user limit and expiry in one go; renewals stack; bad input and wrong states are refused', () => {
  const E = fresh(), c = register(E, 'a@a.com', 'PayCo'), o = ownerTok(E), today = E.x.ymd_(new Date());
  const cat = E.api({ action: 'owner_list', token: o }).plans; assert.equal(cat.Starter.limit, 25); assert.equal(cat.Growth.price[6], 1600); assert.equal(cat.Business.price[12], 4800); assert.equal(cat.Enterprise.price[1], 2000);
  let r = E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Growth', months: 6 }); dropCache(E, c.cid);
  assert.equal(r.price, 1600); assert.equal(r.company.status, 'Active'); assert.equal(r.company.plan, 'Growth'); assert.equal(r.company.employee_limit, 50); assert.ok(r.company.expiry > E.x.addDays_(today, 170) && r.company.expiry < E.x.addDays_(today, 190), r.company.expiry);
  const first = r.company.expiry;
  r = E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Growth', months: 12 }); dropCache(E, c.cid);       // renewal while still active: months are added AFTER the current expiry
  assert.ok(r.company.expiry > E.x.addDays_(first, 360)); assert.equal(r.price, 2880);
  r = E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Enterprise', months: 1, limit: 250 }); assert.equal(r.company.employee_limit, 250); assert.equal(r.price, 2000);
  for (const bad of [{ plan: 'Gold', months: 1 }, { plan: 'Starter', months: 2 }, { plan: 'constructor', months: 1 }, { plan: '__proto__', months: 1 }, { plan: 'Starter', months: 1, limit: 0 }]) assert.equal(E.api({ action: 'owner_activate', token: o, company_id: c.cid, ...bad }).error, 'BAD_REQUEST', JSON.stringify(bad));
  assert.equal(E.api({ action: 'owner_activate', token: o, company_id: 'NOPE1', plan: 'Starter', months: 1 }).error, 'NO_COMPANY');
  const t = admin(E, c.cid); assert.equal(E.api({ action: 'owner_activate', token: t, company_id: c.cid, plan: 'Starter', months: 1 }).error, 'FORBIDDEN');   // a company admin can NOT give itself a plan
  E.api({ action: 'company_delete_request', token: t, pin: STRONG }); dropCache(E, c.cid); assert.equal(E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Starter', months: 1 }).error, 'BAD_REQUEST');
});
test('month arithmetic: 31 Jan + 1 month = 28/29 Feb, 12 months keeps the date, year rollover', () => {
  const E = fresh(); const f = E.ctx.addMonths_ || E.x.addMonths_;
  assert.ok(f, 'addMonths_ is exported to the test');
  assert.equal(f('2027-01-31', 1), '2027-02-28'); assert.equal(f('2028-01-31', 1), '2028-02-29'); assert.equal(f('2026-11-12', 12), '2027-11-12'); assert.equal(f('2026-12-15', 1), '2027-01-15'); assert.equal(f('2026-08-31', 6), '2027-02-28');
});
test('a user cannot go over the plan limit by adding people as Inactive and switching them on later', () => {
  const E = fresh(), c = register(E, 'a@a.com', 'SneakCo'), tok = admin(E, c.cid);
  for (let i = 0; i < 5; i++) addEmp(E, tok, { name: 'P' + i });
  E.api({ action: 'emp_update', token: tok, id: 'E001', status: 'Inactive' });                                      // frees one place
  addEmp(E, tok, { name: 'Replacement' });                                                                         // the free place is used
  const r = E.api({ action: 'emp_update', token: tok, id: 'E001', status: 'Active' }); assert.equal(r.error, 'LIMIT_REACHED');
  E.api({ action: 'emp_update', token: tok, id: 'E002', status: 'Inactive' });                                      // switch one off, then the first may come back
  assert.equal(E.api({ action: 'emp_update', token: tok, id: 'E001', status: 'Active' }).ok, true);
});

test('v3.4 owner resets a forgotten administrator password: old one stops, new one works, lock is cleared; staff are untouched; others cannot do it', () => {
  const { E, c, tok, e1, cid } = setup2(), o = ownerTok(E);
  for (let i = 0; i < 5; i++) E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'wrong-' + i });                    // admin locked out by typos
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }).error, 'AUTH_LOCKED');
  assert.equal(E.api({ action: 'owner_reset_admin', token: tok, company_id: cid }).error, 'FORBIDDEN');                       // an admin cannot use the owner action
  const r = E.api({ action: 'owner_reset_admin', token: o, company_id: cid }); assert.equal(r.ok, true, JSON.stringify(r)); dropCache(E, cid);
  assert.match(r.password, /^[a-z2-9]{8}$/); assert.equal(r.company_id, cid);
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }).error, 'AUTH_BAD');                      // old password dead
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: r.password }).ok, true);                           // new works, lock cleared
  assert.equal(empLogin(E, cid, e1.employee.id, e1.pin).ok, true);                                                             // employees unaffected
  assert.ok(!JSON.stringify(co_(E, cid)).includes(r.password));                                                                 // stored only as a hash
  const r2 = E.api({ action: 'owner_reset_admin', token: o, company_id: cid, password: 'Chosen#99' }); dropCache(E, cid); assert.equal(r2.password, 'Chosen#99');
  assert.equal(E.api({ action: 'owner_reset_admin', token: o, company_id: cid, password: '123' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ action: 'owner_reset_admin', token: o, company_id: 'NOPE1' }).error, 'NO_COMPANY');
});
test('v3.4 an administrator can change their own password (old one required, wrong attempts are rate-limited, managers/employees cannot)', () => {
  const { E, tok, e1, cid } = setup2();
  assert.equal(E.api({ action: 'admin_change_password', token: tok, old_pin: 'nope', new_pin: 'Fresh#Pass2' }).error, 'PASSWORD_BAD');
  assert.equal(E.api({ action: 'admin_change_password', token: tok, old_pin: STRONG, new_pin: '123' }).error, 'BAD_REQUEST');
  assert.equal(E.api({ action: 'admin_change_password', token: tok, old_pin: STRONG, new_pin: 'Fresh#Pass2' }).ok, true); dropCache(E, cid);
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: STRONG }).error, 'AUTH_BAD');
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Fresh#Pass2' }).ok, true);
  const et = empLogin(E, cid, e1.employee.id, e1.pin).token; assert.equal(E.api({ action: 'admin_change_password', token: et, old_pin: 'x', new_pin: 'Fresh#Pass3' }).error, 'FORBIDDEN');
  const t2 = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Fresh#Pass2' }).token;
  for (let i = 0; i < 5; i++) E.api({ action: 'admin_change_password', token: t2, old_pin: 'bad' + i, new_pin: 'Fresh#Pass4' });
  assert.equal(E.api({ action: 'admin_change_password', token: t2, old_pin: 'Fresh#Pass2', new_pin: 'Fresh#Pass4' }).error, 'PASSWORD_LOCKED');
});
test('v3.4 live dashboard: names of who is in / done / not marked; the v3.3 totals are unchanged', () => {
  const E = fresh(), c = register(E, 'live@co.com', 'LiveCo'), tok = admin(E, c.cid);
  E.api({ action: 'owner_activate', token: ownerTok(E), company_id: c.cid, plan: 'Starter', months: 1 }); dropCache(E, c.cid);
  const a = addEmp(E, tok, { name: 'Anil In' }), b = addEmp(E, tok, { name: 'Babu Done' }), d = addEmp(E, tok, { name: 'Chetan Absent' });
  const ta = empLogin(E, c.cid, a.employee.id, a.pin).token, tb = empLogin(E, c.cid, b.employee.id, b.pin).token;
  assert.equal(E.api({ action: 'checkin', token: ta, ...GOOD, idem: 'la', photo: PHOTO }).ok, true);
  assert.equal(E.api({ action: 'checkin', token: tb, ...GOOD, idem: 'lb', photo: PHOTO }).ok, true); assert.equal(E.api({ action: 'checkout', token: tb, ...GOOD, idem: 'lbo' }).ok, true);
  const r = E.api({ action: 'dashboard', token: tok });
  assert.equal(r.present_today, 2); assert.equal(r.absent_today, 1); assert.equal(r.logged_in_now, 1); assert.equal(r.completed_checkouts, 1);               // v3.3 numbers are unchanged
  const by = (n) => r.present_list.find(p => p.name === n);
  assert.equal(by('Anil In').status, 'IN'); assert.equal(by('Anil In').out_time, ''); assert.ok(by('Anil In').in_time);
  assert.equal(by('Babu Done').status, 'DONE'); assert.ok(by('Babu Done').out_time);
  assert.deepEqual(r.absent_list.map(p => p.name), ['Chetan Absent']); assert.equal(r.absent_list[0].id, d.employee.id);
  assert.ok(r.updated_at);
});

test('v3.5 auto mark-out: a session open for 12+ hours is closed at the 12 hour point with no location needed; younger ones are untouched; new check-in works afterwards', () => {
  const { E, tok, e1, e2, cid } = setup2(), H = E.x.ATT_H, col = (n) => H.indexOf(n), hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const t1 = empLogin(E, cid, e1.employee.id, e1.pin).token, t2 = empLogin(E, cid, e2.employee.id, e2.pin).token;
  assert.equal(E.api({ action: 'checkin', token: t1, ...GOOD, idem: 'a1', photo: PHOTO }).ok, true); assert.equal(E.api({ action: 'checkin', token: t2, ...GOOD, idem: 'b1', photo: PHOTO }).ok, true);
  const g = attTab(E, cid).g; g[1][col('IN Server Time')] = hoursAgo(13); g[2][col('IN Server Time')] = hoursAgo(11);      // person 1: 13 h ago, person 2: 11 h ago
  const inAt = new Date(g[1][col('IN Server Time')]).getTime();
  let m = E.api({ action: 'me', token: t1 }); assert.equal(m.open_session, null);                                              // closed by the server, no GPS involved
  assert.equal(g[1][col('Status')], 'CLOSED'); assert.equal(g[1][col('OUT Key')], 'AUTO-12H'); assert.equal(g[1][col('Duration')], '12h 00m');
  assert.equal(new Date(g[1][col('OUT Server Time')]).getTime(), inAt + 12 * 3600000); assert.match(g[1][col('OUT Time')], /^\d\d:\d\d$/); assert.equal(g[1][col('OUT Lat')], '');
  assert.equal(E.api({ action: 'history', token: t1 }).sessions[0].auto_out, true); assert.equal(m.last_session === null || m.last_session.auto_out === true, true);
  assert.equal(g[2][col('Status')], 'OPEN'); assert.equal(E.api({ action: 'me', token: t2 }).open_session.status, 'OPEN');           // 11 h: still open
  assert.equal(E.api({ action: 'checkin', token: t1, ...GOOD, idem: 'a2', photo: PHOTO }).ok, true);                                   // can check in again
  const outAt = g[1][col('OUT Server Time')]; E.api({ action: 'me', token: t1 }); assert.equal(g[1][col('OUT Server Time')], outAt);    // idempotent: never re-stamped
  // logout after 12+ hours with a missing / zero location still works (it is simply marked out at the 12 hour point)
  g[2][col('IN Server Time')] = hoursAgo(14);
  const lo = E.api({ action: 'checkout', token: t2, idem: 'b1o' }); assert.equal(lo.ok, true, JSON.stringify(lo)); assert.equal(lo.auto, true); assert.equal(g[2][col('OUT Key')], 'AUTO-12H');
  // a normal logout inside 12 hours is unchanged
  assert.equal(E.api({ action: 'checkout', token: t1, ...GOOD, idem: 'a2o' }).session.auto_out, false); assert.equal(g[3][col('Status')], 'CLOSED'); assert.notEqual(g[3][col('OUT Key')], 'AUTO-12H');
  // the administrator's views close forgotten sessions too, and counts follow
  assert.equal(E.api({ action: 'checkin', token: t2, ...GOOD, idem: 'b2', photo: PHOTO }).ok, true); g[4][col('IN Server Time')] = hoursAgo(20);
  const d = E.api({ action: 'dashboard', token: tok }); assert.equal(d.logged_in_now, 0); assert.equal(g[4][col('OUT Key')], 'AUTO-12H');
  const l = E.api({ action: 'att_list', token: tok, from: '2000-01-01', to: '2100-01-01' }); assert.ok(l.rows.some(x => x.auto_out === true && x.hours === 12));
});
test('v3.5 auto mark-out does not weaken the plan rules: an expired company still cannot check in, and the sweep never touches other companies', () => {
  const A = setup2('a1@x.com'), E = A.E, B = register(E, 'b1@x.com'), bt = admin(E, B.cid), be = addEmp(E, bt), H = E.x.ATT_H, col = (n) => H.indexOf(n);
  const ta = A.login1().token, tb = empLogin(E, B.cid, be.employee.id, be.pin).token;
  E.api({ action: 'checkin', token: ta, ...GOOD, idem: 'x1', photo: PHOTO }); E.api({ action: 'checkin', token: tb, ...GOOD, idem: 'y1', photo: PHOTO });
  const ga = attTab(E, A.cid).g, gb = attTab(E, B.cid).g; ga[1][col('IN Server Time')] = gb[1][col('IN Server Time')] = new Date(Date.now() - 13 * 3600000).toISOString();
  E.api({ action: 'dashboard', token: A.tok }); assert.equal(ga[1][col('Status')], 'CLOSED'); assert.equal(gb[1][col('Status')], 'OPEN');       // only company A was looked at
  E.api({ action: 'owner_update', token: ownerTok(E), company_id: A.cid, expiry: '2020-01-01' }); dropCache(E, A.cid);
  assert.equal(E.api({ action: 'checkin', token: ta, ...GOOD, idem: 'x2', photo: PHOTO }).error, 'LICENCE_EXPIRED');
});
test('v3.5 admin forgot-password request -> owner overview -> owner sets a new password or rejects; every event is recorded; nothing secret is stored or returned; survives a restart', () => {
  const E = fresh(), c = register(E, 'pw@co.com', 'Pw Co'), cid = c.cid, mobile = co_(E, cid)[3], o = ownerTok(E), at = admin(E, cid);
  const reqAs = (m, id = cid) => E.api({ action: 'admin_forgot_request', company_id: id, mobile: m });
  assert.equal(reqAs('9999999999').error, 'AUTH_BAD'); assert.equal(reqAs(mobile, 'NOPE1').error, 'AUTH_BAD');                              // wrong mobile / unknown company: same answer
  for (let i = 0; i < 5; i++) reqAs('1111111111'); assert.equal(reqAs(mobile).error, 'TOO_MANY');                                              // guessing is locked
  E.cache = {}; for (const k of Object.keys(E.cache)) delete E.cache[k];
  const E2 = fresh(), c2 = register(E2, 'pw2@co.com', 'Pw Co 2'), m2 = co_(E2, c2.cid)[3], o2 = ownerTok(E2), q = (x) => E2.api(x);
  let r = q({ action: 'admin_forgot_request', company_id: c2.cid, mobile: '+91 ' + m2 }); assert.equal(r.ok, true); assert.equal(r.sent, true);   // +91 / spaces are accepted like at registration
  assert.equal(q({ action: 'admin_forgot_request', company_id: c2.cid, mobile: m2 }).already_pending, true);                                   // one open request at a time
  const t2 = admin(E2, c2.cid); assert.equal(q({ action: 'owner_pw_overview', token: t2 }).error, 'FORBIDDEN');                                // an administrator cannot read the owner view
  assert.equal(q({ action: 'owner_pw_overview' }).ok, false);
  let ov = q({ action: 'owner_pw_overview', token: o2 }); assert.equal(ov.pending_count, 1); const a = ov.admins[0]; assert.equal(a.company_id, c2.cid); assert.equal(a.admin_name, 'Asha Admin'); assert.ok(a.pending_since);
  assert.equal(a.history[0].action, 'PW_REQUEST'); assert.equal(a.history[0].status, 'Pending');
  assert.ok(!/hash|salt|"password"/i.test(JSON.stringify(ov)));                                                                                  // nothing secret is ever returned
  r = q({ action: 'owner_reset_admin', token: o2, company_id: c2.cid, password: 'Newer#Pass7' }); assert.equal(r.ok, true); delete E2.cache['co_' + c2.cid];
  ov = q({ action: 'owner_pw_overview', token: o2 }); assert.equal(ov.pending_count, 0); assert.equal(ov.admins[0].history[0].action, 'ADMIN_PASSWORD_RESET'); assert.equal(ov.admins[0].history[0].status, 'Completed');
  assert.equal(q({ action: 'login', company_id: c2.cid, id: 'ADMIN', pin: STRONG }).error, 'AUTH_BAD'); const nt = q({ action: 'login', company_id: c2.cid, id: 'ADMIN', pin: 'Newer#Pass7' }); assert.equal(nt.ok, true);
  q({ action: 'admin_change_password', token: nt.token, old_pin: 'Bad#Guess55', new_pin: 'Third#Pass8' }); q({ action: 'admin_change_password', token: nt.token, old_pin: 'Newer#Pass7', new_pin: 'Third#Pass8' });
  ov = q({ action: 'owner_pw_overview', token: o2 }); assert.deepEqual(ov.admins[0].history.slice(0, 2).map(h => h.action + ':' + h.status), ['PASSWORD_CHANGE:Completed', 'PASSWORD_CHANGE_FAILED:Failed - wrong current password']);
  assert.equal(q({ action: 'admin_forgot_request', company_id: c2.cid, mobile: m2 }).sent, true);                                              // a new request after the old one was completed
  assert.equal(q({ action: 'owner_pw_reject', token: t2, company_id: c2.cid }).error, 'FORBIDDEN');
  assert.equal(q({ action: 'owner_pw_reject', token: o2, company_id: c2.cid }).ok, true); ov = q({ action: 'owner_pw_overview', token: o2 });
  assert.equal(ov.pending_count, 0); assert.equal(ov.admins[0].history[0].status, 'Rejected'); assert.equal(ov.history[0].admin_name, 'Asha Admin'); assert.ok(ov.history[0].time && ov.history[0].company_name === 'Pw Co 2');
  const audit = JSON.stringify(E2.registry.ss.getSheetByName('Audit').g); for (const secret of ['Newer#Pass7', 'Third#Pass8', STRONG, 'Bad#Guess55']) assert.ok(!audit.includes(secret), 'a password reached the log');
  for (const k of Object.keys(E2.cache)) delete E2.cache[k];                                                                                   // "restart": caches gone, the sheets still tell the story
  const o3 = q({ action: 'owner_login', password: 'owner-pass-1' }).token; ov = q({ action: 'owner_pw_overview', token: o3 }); assert.equal(ov.admins[0].history.length >= 5, true);
  assert.equal(q({ action: 'owner_pw_reject', token: o3, company_id: 'NOPE1' }).error, 'NO_COMPANY');
});

// ---------------- v3.6: plan requests, owner verification, expiry reminders ----------------
const setExpiry = (E, cid, days, status = 'Active') => { const o = ownerTok(E), d = E.x.addDays_(E.x.ymd_(new Date()), days); const r = E.api({ action: 'owner_update', token: o, company_id: cid, status, expiry: d }); assert.equal(r.ok, true, JSON.stringify(r)); delete E.cache['co_' + cid]; };

test('v3.6 plan request: only the administrator can ask; one open request; owner sees it; nothing is activated by asking; owner emailed', () => {
  const { E, c, tok, e1 } = setup2('admin@acme.com'); E.props.OWNER_EMAIL = 'owner@dev.in';
  const mgr = addEmp(E, tok, { name: 'Mgr', role: 'Manager', mobile: '9000000055' }), mt = empLogin(E, c.cid, mgr.employee.id, mgr.pin).token, et = empLogin(E, c.cid, e1.employee.id, e1.pin).token;
  assert.equal(E.api({ action: 'plan_request', token: et, plan: 'Growth', months: 6 }).error, 'FORBIDDEN'); assert.equal(E.api({ action: 'plan_request', token: mt, plan: 'Growth', months: 6 }).error, 'FORBIDDEN');
  assert.equal(E.api({ action: 'plan_request', token: tok, plan: 'Nope', months: 6 }).error, 'BAD_REQUEST'); assert.equal(E.api({ action: 'plan_request', token: tok, plan: 'Growth', months: 5 }).error, 'BAD_REQUEST');
  const before = E.api({ action: 'company_info', token: tok }), r = E.api({ action: 'plan_request', token: tok, plan: 'Growth', months: 6 });
  assert.equal(r.ok, true); assert.match(r.request.ref, /^PR-[A-Z2-9]{6}$/); assert.equal(r.request.amount, 1600);
  const after = E.api({ action: 'company_info', token: tok }); assert.equal(after.plan, before.plan); assert.equal(after.expiry, before.expiry); assert.equal(after.status, before.status, 'a request never changes the plan');
  assert.equal(after.plan_request.ref, r.request.ref); assert.equal(E.api({ action: 'company_info', token: mt }).plan_request, null, 'managers do not get the request details');
  assert.ok(E.api({ action: 'dashboard', token: tok }).plan_request); assert.equal(E.api({ action: 'plan_request', token: tok, plan: 'Starter', months: 1 }).already_pending, true);
  assert.equal(E.mail.length, 1); assert.equal(E.mail[0].to, 'owner@dev.in'); assert.match(E.mail[0].subject, /Plan request PR-/); assert.ok(!/Secret|pin|password/i.test(E.mail[0].body));
  const o = ownerTok(E), ov = E.api({ action: 'owner_plan_overview', token: o }); assert.equal(ov.pending_count, 1); assert.equal(ov.requests[0].request.ref, r.request.ref); assert.equal(ov.requests[0].company_id, c.cid);
  assert.equal(E.api({ action: 'owner_plan_overview', token: tok }).error, 'FORBIDDEN');
});

test('v3.6 payment: owner activation (after checking the money) restores access with no reinstall; failed / unpaid request is closed and the plan is unchanged', () => {
  const { E, c, tok, e1 } = setup2('admin@acme.com'); E.props.OWNER_EMAIL = 'owner@dev.in'; const o = ownerTok(E);
  E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + c.cid]; setExpiry(E, c.cid, -3);          // plan ended 3 days ago
  assert.equal(empLogin(E, c.cid, e1.employee.id, e1.pin).error, 'LICENCE_EXPIRED'); assert.equal(E.api({ action: 'login', company_id: c.cid, id: 'ADMIN', pin: STRONG }).ok, true, 'admin can still sign in to renew');
  const at = admin(E, c.cid), q = E.api({ action: 'plan_request', token: at, plan: 'Growth', months: 1 }); assert.equal(q.ok, true);
  assert.equal(empLogin(E, c.cid, e1.employee.id, e1.pin).error, 'LICENCE_EXPIRED', 'still restricted while the payment is unverified');
  // payment not received -> owner closes the request, admin is told, nothing changes
  E.mail.length = 0; assert.equal(E.api({ action: 'owner_plan_reject', token: o, company_id: c.cid }).ok, true);
  assert.equal(E.api({ action: 'company_info', token: at }).plan_request, null); assert.equal(empLogin(E, c.cid, e1.employee.id, e1.pin).error, 'LICENCE_EXPIRED');
  assert.equal(E.mail.length, 1); assert.equal(E.mail[0].to, 'admin@acme.com'); assert.match(E.mail[0].subject, /payment not received/i);
  // pays properly this time
  const q2 = E.api({ action: 'plan_request', token: at, plan: 'Growth', months: 1 }); assert.equal(q2.ok, true); E.mail.length = 0;
  const act = E.api({ action: 'owner_activate', token: o, company_id: c.cid, plan: 'Growth', months: 1 }); assert.equal(act.ok, true); delete E.cache['co_' + c.cid];
  assert.equal(E.api({ action: 'company_info', token: at }).plan_request, null); assert.equal(empLogin(E, c.cid, e1.employee.id, e1.pin).ok, true, 'access restored automatically');
  assert.equal(E.mail.length, 1); assert.equal(E.mail[0].to, 'admin@acme.com'); assert.match(E.mail[0].subject, /payment confirmed/i);
  const hist = E.api({ action: 'owner_plan_overview', token: o }).history.map(h => h.action); assert.ok(hist.includes('PLAN_REQUEST') && hist.includes('PLAN_REQUEST_REJECTED') && hist.includes('ACTIVATE'));
  // existing data was kept through the expiry
  assert.ok(E.api({ action: 'emp_list', token: admin(E, c.cid) }).employees.length >= 2);
});

test('v3.6 reminders: admin e-mailed at 7/3/1/0 days and after expiry, once each; works with mail failure and missing email; owner summary; trigger installed once', () => {
  const E = fresh(), a = register(E, 'a@x.in'), b = register(E, ''), o = ownerTok(E); E.props.OWNER_EMAIL = 'owner@dev.in';
  E.api({ action: 'owner_activate', token: o, company_id: a.cid, plan: 'Starter', months: 1 }); E.api({ action: 'owner_activate', token: o, company_id: b.cid, plan: 'Starter', months: 1 });
  E.mail.length = 0; setExpiry(E, a.cid, 20); setExpiry(E, b.cid, 7); let r = E.x.notifyExpiryDaily(); assert.equal(r.reminders, 1, 'only the company at 7 days is reminded'); assert.equal(E.mail.filter(m => m.to === 'a@x.in').length, 0);
  assert.ok(E.mail.some(m => m.to === 'owner@dev.in' && /b|Test Co/.test(m.body)), 'owner summary lists it even when the company has no email');
  const n1 = E.mail.length; setExpiry(E, a.cid, 7); E.mail.length = 0; r = E.x.notifyExpiryDaily(); assert.equal(E.mail.filter(m => m.to === 'a@x.in').length, 1); assert.match(E.mail.find(m => m.to === 'a@x.in').subject, /expires in 7 days/);
  E.mail.length = 0; E.x.notifyExpiryDaily(); assert.equal(E.mail.filter(m => m.to === 'a@x.in').length, 0, 'the same reminder is never sent twice');
  for (const [d, re] of [[3, /in 3 days/], [1, /in 1 day/], [0, /expires today/], [-1, /has expired/]]) { setExpiry(E, a.cid, d, d < 0 ? 'Active' : 'Active'); E.mail.length = 0; E.x.notifyExpiryDaily(); const m = E.mail.find(x => x.to === 'a@x.in'); assert.ok(m && re.test(m.subject), 'day ' + d + ': ' + (m && m.subject)); }
  setExpiry(E, a.cid, -2); E.mail.length = 0; E.x.notifyExpiryDaily(); assert.equal(E.mail.filter(m => m.to === 'a@x.in').length, 0, 'no reminders on random days');
  // mail outage: no crash, not marked as sent, retried next run
  setExpiry(E, a.cid, 1); E.mail.length = 0; E.store.mailFails = true; assert.doesNotThrow(() => E.x.notifyExpiryDaily()); E.store.mailFails = false; E.x.notifyExpiryDaily(); assert.equal(E.mail.filter(m => m.to === 'a@x.in').length, 1, 'retried after the outage');
  // a renewal resets the reminder memory
  E.api({ action: 'owner_activate', token: o, company_id: a.cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + a.cid]; assert.equal(E.props['ntf_' + a.cid], undefined);
  assert.match(E.x.installTriggers(), /Daily/); E.x.installTriggers(); assert.equal(E.store.triggers.length, 1, 'one trigger only');
});

test('v3.6 isolation: another company cannot see or touch a plan request; request owner view needs the owner password', () => {
  const E = fresh(), a = register(E, 'a@x.in'), b = register(E, 'b@x.in'), ta = admin(E, a.cid), tb = admin(E, b.cid);
  E.api({ action: 'plan_request', token: ta, plan: 'Growth', months: 12 });
  assert.equal(E.api({ action: 'company_info', token: tb }).plan_request, null); assert.equal(E.api({ action: 'owner_plan_reject', token: tb, company_id: a.cid }).error, 'FORBIDDEN'); assert.equal(E.api({ action: 'owner_activate', token: tb, company_id: a.cid, plan: 'Growth', months: 12 }).error, 'FORBIDDEN');
  assert.equal(E.api({ action: 'plan_request', token: tb, plan: 'Starter', months: 1, company_id: a.cid }).request.ref !== E.api({ action: 'company_info', token: ta }).plan_request.ref, true);
  assert.equal(E.api({ action: 'company_info', token: ta }).plan_request.plan, 'Growth', "B's request did not overwrite A's");
});

// ---------------- v3.6 security: role matrix, tampered tokens, injection ----------------
test('v3.6 security: every action refuses the wrong role / no token / forged token; public actions are only the known ones', () => {
  const fs = require('fs'), src = fs.readFileSync(require('path').join(__dirname, '../apps-script/Code.gs'), 'utf8'), routeSrc = src.slice(src.indexOf('function route_'), src.indexOf('function sheet_') > 0 ? src.indexOf('// ---------------- storage') : undefined);
  const actions = [...routeSrc.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]), PUBLIC = ['register_start', 'login', 'owner_login', 'admin_forgot_request', 'logout_session', 'ping', 'version'];
  const { E, c, tok, e1 } = setup2(), et = empLogin(E, c.cid, e1.employee.id, e1.pin).token, mgr = addEmp(E, tok, { name: 'M', role: 'Manager', mobile: '9000000066' }), mt = empLogin(E, c.cid, mgr.employee.id, mgr.pin).token;
  assert.ok(actions.length > 30, 'actions found: ' + actions.length);
  const EMP_OK = ['me', 'history', 'checkin', 'checkout'], MGR_OK = ['dashboard', 'emp_list', 'att_list', 'report_month', 'company_info', 'history', 'photo', 'photo_get'];
  const ownerOnly = actions.filter(a => a.startsWith('owner_') && !PUBLIC.includes(a));
  for (const a of actions.filter(x => !PUBLIC.includes(x))) {
    const none = E.api({ action: a }), forged = E.api({ action: a, token: 'S' + 'x'.repeat(40) });
    assert.notEqual(none.ok, true, a + ' works without a token'); assert.notEqual(forged.ok, true, a + ' works with a forged token');
    if (!EMP_OK.includes(a)) assert.notEqual(E.api({ action: a, token: et }).ok, true, a + ' works for an employee');
    if (ownerOnly.includes(a)) { assert.notEqual(E.api({ action: a, token: tok }).ok, true, a + ' works for an admin'); assert.notEqual(E.api({ action: a, token: mt }).ok, true, a + ' works for a manager'); }
    if (!MGR_OK.includes(a) && !EMP_OK.includes(a) && !ownerOnly.includes(a)) assert.notEqual(E.api({ action: a, token: mt }).ok, true, a + ' works for a manager but is admin-only');
  }
  assert.deepEqual(['register_start', 'login', 'owner_login'].filter(a => actions.includes(a)).length, 3);
});

test('v3.6 security: formulas / HTML in names are stored as text, an oversized photo is refused, and a staff token cannot read another company', () => {
  const { E, c, tok } = setup2(), x = addEmp(E, tok, { name: '=HYPERLINK("http://evil","x")', mobile: '9000000077' }), sh = empTab(E, c.cid);
  assert.equal(sh.g[sh.g.length - 1][1], '=HYPERLINK("http://evil","x")', 'kept as text, not turned into a formula');
  const t = empLogin(E, c.cid, x.employee.id, x.pin).token; assert.equal(E.api({ action: 'checkin', token: t, ...GOOD, idem: 'big', photo: 'A'.repeat(4000001) }).error, 'PHOTO_TOO_LARGE');
  const other = setup2('b@b.com'), ot = empLogin(other.E, other.c.cid, other.e1.employee.id, other.e1.pin).token;
  assert.equal(E.api({ action: 'me', token: ot }).ok, false, 'a token from another deployment/company is not valid here');
});
