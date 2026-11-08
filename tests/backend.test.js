'use strict';
// Runs apps-script/Code.gs against tests/mock-google.js (fake SpreadsheetApp / DriveApp that also imitates Sheets' auto-conversion of text).
// This proves OUR logic. It does NOT prove real Google behaves identically - that needs a real deployment (see README).
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./mock-google');

const PHOTO = Buffer.from('fakejpegbytes').toString('base64');
const GOOD = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
const STRONG = 'Admin#Pass1';
let counter = 0;

function fresh() { const E = load(); E.x.setup(); return E; }
function register(E, contact, name) {
  const r = E.api({ action: 'register_start', company_name: name || 'Test Co ' + (++counter), admin_name: 'Asha Admin', mobile: '9876543210', email: contact, business_type: 'Service', employees: 10, address: 'Pune', admin_pin: STRONG });
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
  for (let i = 0; i < 24; i++) assert.equal(E.api({ ...base, company_name: 'Bulk ' + i }).ok, true);
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
  assert.equal(E.api({ action: 'att_list', token: ta }).ok, true);                                                   // records remain readable
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
  for (let i = 0; i < 8; i++) addEmp(E, tok, { name: 'Emp ' + i });
  const list = E.api({ action: 'emp_list', token: tok }).employees; assert.equal(list.length, 10);
  list.forEach(e => { const p = E.api({ action: 'emp_reset_pin', token: tok, id: e.id, pin: 'pin' + e.id }).pin; toks.push(empLogin(E, cid, e.id, p).token); });
  toks.forEach((t, i) => assert.equal(E.api({ action: 'checkin', token: t, ...GOOD, idem: 'bulk' + i, photo: PHOTO }).ok, true));
  assert.equal(attRows(E, cid).length, 10); assert.equal(new Set(attRows(E, cid).map(r => r[2])).size, 10); assert.equal(photosFiles(E, cid).length, 10);
});

test('monthly report: P / L / WO / MC, Sundays, multi-session hours, missed logout not counted, future days blank, scoped employees', () => {
  const { E, tok, cid } = setup2(); const H = E.x.ATT_H, g = attTab(E, cid).g;
  const add = (date, id, inT, outT, status) => { const r = Array(H.length).fill(''); r[0] = 'R' + g.length; r[1] = date; r[2] = id; r[H.indexOf('IN Time')] = '09:00'; r[H.indexOf('IN Server Time')] = inT; r[H.indexOf('OUT Server Time')] = outT || ''; r[H.indexOf('Status')] = status; r[H.indexOf('IN Lat')] = 18.5; r[H.indexOf('IN Long')] = 73.8; r[H.indexOf('IN Map')] = 'https://www.google.com/maps?q=18.5,73.8'; r[H.indexOf('Photo')] = 'https://drive.google.com/file/d/FILEX123456789/view'; g.push(r); };
  add('2026-02-02', 'E001', '2026-02-02T03:30:00Z', '2026-02-02T12:00:00Z', 'CLOSED');       // 8.5 h
  add('2026-02-03', 'E001', '2026-02-03T04:00:00Z', '2026-02-03T06:00:00Z', 'CLOSED');       // 2 h
  add('2026-02-03', 'E001', '2026-02-03T07:00:00Z', '2026-02-03T10:00:00Z', 'CLOSED');       // 3 h  (second session same day)
  add('2026-02-04', 'E001', '2026-02-04T04:00:00Z', '', 'OPEN');                              // logged in, no logout -> MC
  add('2026-02-01', 'E002', '2026-02-01T04:00:00Z', '2026-02-01T08:00:00Z', 'CLOSED');       // worked on a Sunday -> P (yellow in Excel)
  const r = E.api({ action: 'report_month', token: tok, month: '2026-02' });
  assert.equal(r.ok, true); assert.equal(r.days, 28); assert.equal(r.dows[0], 0); assert.equal(r.employees.length, 2);
  const p1 = r.pa.find(x => x.id === 'E001'), h1 = r.hours.find(x => x.id === 'E001');
  assert.deepEqual([p1.P, p1.MC, p1.WO, p1.L], [2, 1, 4, 21]); assert.equal(p1.codes[0], 'WO'); assert.equal(p1.codes[1], 'P'); assert.equal(p1.codes[3], 'MC'); assert.equal(p1.hours, 13.5);
  assert.equal(h1.values[1], 8.5); assert.equal(h1.values[2], 5); assert.equal(h1.values[3], 'MC'); assert.equal(h1.total, 13.5); assert.equal(h1.days_worked, 2);
  const p2 = r.pa.find(x => x.id === 'E002'); assert.equal(p2.codes[0], 'P'); assert.equal(p2.WO, 3);
  assert.equal(r.location.length, 5); assert.equal(r.location[0].date, '2026-02-01'); assert.equal(r.location.find(x => x.status === 'OPEN').hours, null); assert.equal(r.location[1].photo_id, 'FILEX123456789');
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
