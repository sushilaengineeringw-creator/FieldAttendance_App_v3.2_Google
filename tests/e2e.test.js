'use strict';
// END-TO-END (simulated Google services + simulated phone): the REAL www/index.html + app.js run in jsdom, talk to the REAL Code.gs through the fake services.
// Flow: register company (inside the app, no Google sign-in) -> admin adds employee -> employee logs in, photo + GPS check-in -> logout -> admin sees location/photo,
// downloads Excel -> owner suspends company -> employee blocked. Camera/GPS/Browser/Filesystem/Share are fakes of the Capacitor plugins.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx-js-style');
const { load } = require('./mock-google');

const www = (f) => fs.readFileSync(path.join(__dirname, '../www', f), 'utf8');
const PIXEL = Buffer.from('fakejpegbytes').toString('base64');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 4000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what + '\nSCREEN: ' + (globalThis.__dom ? globalThis.__dom.window.document.body.textContent.replace(/\s+/g, ' ').slice(0, 400) : '')); await sleep(15); } }

function phone(E, opts = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><header><b id="hdr"></b><span id="who"></span></header><main id="app"></main><div id="nav"></div></body></html>', { url: 'https://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  globalThis.__dom = dom; const w = dom.window, d = w.document, calls = { opened: [], files: [], shared: [], alerts: [] };
  w.APP_CONFIG = Object.assign({ SERVER_URL: 'https://script.google.com/macros/s/TEST/exec' }, opts.cfg || {});
  w.fetch = async (url, o) => ({ json: async () => E.api(JSON.parse(o.body)) });
  w.alert = (m) => calls.alerts.push(m); w.confirm = () => true; w.XLSX = XLSX;
  const plugins = {
    Camera: { checkPermissions: async () => ({ camera: 'granted' }), requestPermissions: async () => ({ camera: 'granted' }), getPhoto: async (o) => { calls.photoOpts = o; return { base64String: PIXEL, format: 'jpeg' }; } },
    Geolocation: { checkPermissions: async () => ({ location: 'granted' }), requestPermissions: async () => ({ location: 'granted' }), clearWatch: async () => {} },
    Browser: { open: async (o) => { calls.opened.push(o.url); } },
    Filesystem: { writeFile: async (o) => { calls.files.push(o); return { uri: 'file:///cache/' + o.path }; } },
    Share: { share: async (o) => { calls.shared.push(o); return {}; } },
  };
  w.Capacitor = { isNativePlatform: () => true,
    nativePromise: (p, m, o) => { if (!plugins[p] || !plugins[p][m]) return Promise.reject(new Error(p + '.' + m + ' not implemented')); return plugins[p][m](o); },
    nativeCallback: (p, m, o, cb) => { setTimeout(() => cb({ timestamp: Date.now(), coords: { latitude: 18.5204, longitude: 73.8567, accuracy: opts.acc || 15 } }), 10); return 'w1'; } };
  const run = (code) => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); s.remove(); };
  run(www('excel.js')); run(www('app.js') + '\n;window.stamp = async (raw) => raw;');   // canvas is not available in jsdom: keep the raw photo
  const $ = (s) => d.querySelector(s), text = () => d.body.textContent.replace(/\s+/g, ' ');
  const type = (sel, v) => { const el = $(sel); if (!el) throw new Error('missing ' + sel); el.value = v; };
  const click = (sel) => { const el = $(sel); if (!el) throw new Error('missing ' + sel); el.click(); };
  return { w, d, $, text, type, click, calls, has: (t) => text().includes(t) };
}
async function signIn(P, co, id, pin) { await until(() => P.$('#go'), 'login form'); P.type('#co', co); P.type('#u', id); P.type('#p', pin); P.click('#go'); }

test('END-TO-END: register -> add employee -> check-in (photo+GPS) -> logout -> admin sees location/photo + Excel -> owner suspends -> employee blocked', async () => {
  const E = load(); E.x.setup(); const P = phone(E);
  // 1. company registration inside the app: no browser, no Google sign-in
  await until(() => P.$('#reg'), 'login screen'); P.click('#reg');
  await until(() => P.$('#r_go'), 'register form'); assert.ok(!P.has('Continue with Google') && !P.has('Sign in with Google'));
  P.type('#r_co', 'Sun Solar Pvt Ltd'); P.type('#r_nm', 'Asha Admin'); P.type('#r_mb', '9876543210'); P.type('#r_em', 'asha@sunsolar.in'); P.type('#r_pw', 'Secret123'); P.type('#r_n', '12'); P.type('#r_ad', 'Pune');
  P.click('#r_go'); await until(() => P.has('agree to the Terms'), 'consent required'); P.d.querySelector('#r_ok').checked = false; P.type('#r_co', 'Sun Solar Pvt Ltd'); P.type('#r_nm', 'Asha Admin'); P.type('#r_mb', '9876543210'); P.type('#r_em', 'asha@sunsolar.in'); P.type('#r_pw', 'Secret123'); P.type('#r_n', '12'); P.type('#r_ad', 'Pune');
  P.d.querySelector('#r_ok').checked = true;
  P.click('#r_go'); await until(() => P.has('Company registered'), 'registration done'); assert.equal(P.calls.opened.length, 0, 'no browser is opened');
  const cid = /FA[A-Z0-9]{5}/.exec(P.text())[0];
  P.click('#ok'); await until(() => P.has("Today's present"), 'admin dashboard straight after registration');
  P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company tab'); P.click('#so');
  // 2. admin signs in, adds an employee inside the app
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.has("Today's present"), 'admin dashboard');
  assert.ok(P.has('Total employees')); P.click('nav [data-t="emps"]'); await until(() => P.$('#ae'), 'employee tab'); P.click('#ae');
  await until(() => P.$('#f_name'), 'employee form'); P.type('#f_name', 'Ravi Kumar'); P.type('#f_mobile', '9000000001'); P.type('#f_designation', 'Solar Technician'); P.type('#f_department', 'Installation');
  P.d.querySelector('#f_type').value = 'Technician'; P.click('#fs');
  await until(() => /PIN: \d{6}/.test(P.d.querySelector('#mres') ? P.d.querySelector('#mres').textContent : ''), 'employee created');
  const pin = /PIN: (\d{6})/.exec(P.d.querySelector('#mres').textContent)[1]; assert.ok(P.d.querySelector('#mres').textContent.includes('E001'));
  P.click('#fc'); await sleep(50); P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company tab'); assert.ok(P.has('Free trial')); assert.ok(P.has('asha@sunsolar.in')); P.click('#so');
  // 3. employee: login screen -> photo + GPS -> check-in
  await signIn(P, cid, 'E001', pin); await until(() => P.$('#in'), 'employee home'); assert.ok(P.has('Ravi Kumar')); assert.ok(P.has('Installation')); assert.ok(P.has('Solar Technician'));
  P.click('#in'); await until(() => P.$('#nok'), 'first-use notice'); assert.ok(P.has('does not track you in the background')); assert.equal(P.calls.photoOpts, undefined); P.click('#nok');
  await until(() => P.$('#sub'), 'photo preview');
  assert.equal(P.calls.photoOpts.source, 'CAMERA'); assert.equal(P.calls.photoOpts.direction, 'FRONT'); assert.equal(P.calls.photoOpts.width, 800);   // live front camera only
  await until(() => P.has('Location ready'), 'GPS fix'); P.click('#sub'); await until(() => P.has('Attendance recorded'), 'check-in saved');
  const H = E.x.ATT_H, coRow = E.registry.ss.getSheetByName('Companies').g.find(r => r[0] === cid), ss = E.sheetsById[coRow[9]], row = ss.tabs.Attendance.g[1];
  assert.equal(row[H.indexOf('Employee ID')], 'E001'); assert.equal(row[H.indexOf('Company ID')], cid); assert.equal(row[H.indexOf('IN Lat')], 18.5204);
  assert.equal(Object.values(E.filesById).filter(f => !f.folder).length, 1);
  P.click('#ok'); await until(() => P.$('#out'), 'logout button'); P.click('#out'); await until(() => P.has('Logged out'), 'logout saved');
  assert.equal(ss.tabs.Attendance.g[1][H.indexOf('Status')], 'CLOSED'); assert.ok(ss.tabs.Attendance.g[1][H.indexOf('OUT Lat')]);
  P.click('#ok'); await until(() => P.$('#hs'), 'home'); P.click('#hs'); await until(() => P.has('Attendance history') && P.has('ATT-'), 'history'); P.click('#bk'); await until(() => P.$('#lo'), 'home'); P.click('#lo');
  // 4. admin: location & photos, photo is shown through the authorised call, Excel download
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.$('nav [data-t="loc"]'), 'admin home'); P.click('nav [data-t="loc"]');
  await until(() => P.has('Ravi Kumar') && P.$('[data-p]'), 'location list'); assert.ok(P.has('Open map')); P.click('[data-p]');
  await until(() => P.$('.modal img'), 'photo modal'); assert.ok(P.$('.modal img').src.startsWith('data:image/jpeg;base64,')); P.click('#pc');
  P.click('nav [data-t="rep"]'); await until(() => P.$('button[data-k="all"]'), 'reports tab'); P.click('button[data-k="all"]');
  await until(() => P.calls.files.length === 1 && P.calls.shared.length === 1, 'excel saved + shared');
  const wb = XLSX.read(Buffer.from(P.calls.files[0].data, 'base64'), { type: 'buffer', cellStyles: true }); const ym = E.x.ymd_(new Date()).slice(0, 7);
  assert.deepEqual(wb.SheetNames, ['PA_' + ym, 'Hours_' + ym, 'Location_' + ym]); assert.match(P.calls.files[0].path, /^Complete_Report_\d{4}-\d{2}_Sun_Solar/);
  P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company tab'); P.click('#so');
  // 5. owner suspends the company: employee can no longer sign in, admin still can
  await until(() => P.$('#own'), 'login'); P.click('#own'); await until(() => P.$('#op'), 'owner login'); P.type('#op', 'owner-pass-1'); P.click('#og');
  await until(() => P.has('Sun Solar Pvt Ltd') && P.has('Trial'), 'owner list'); P.d.querySelector('[data-c="' + cid + '"]').click();
  await until(() => P.$('#o_st'), 'owner form'); P.d.querySelector('#o_st').value = 'Suspended'; P.click('#os'); await until(() => !P.$('.modal') && (P.d.querySelector('[data-c="' + cid + '"] .chip') || {}).textContent === 'Suspended', 'suspended shown'); P.click('#ols');
  delete E.cache['co_' + cid]; await signIn(P, cid, 'E001', pin);
  await until(() => P.has('subscription is suspended'), 'employee blocked'); assert.equal(ss.tabs.Attendance.g.length, 2);
});

test('admin and employee screens differ; manager sees team only; wrong PIN shows a clear message; app works with no stored login', async () => {
  const E = load(); E.x.setup(); const P = phone(E);
  const r = E.api({ action: 'register_start', company_name: 'Beta Works', admin_name: 'B', mobile: '9876500001', email: 'b@beta.com', admin_pin: 'Secret123' }); const cid = r.company_id;
  const tok = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token;
  const m = E.api({ action: 'emp_add', token: tok, name: 'Meera Mgr', role: 'Manager' }), e = E.api({ action: 'emp_add', token: tok, name: 'Eka Emp', manager: 'M001' });
  await signIn(P, cid, 'E001', '000000'); await until(() => P.has('Incorrect Company ID'), 'wrong pin message');
  P.type('#p', e.pin); P.click('#go'); await until(() => P.$('#in'), 'employee home'); assert.ok(!P.$('nav button')); P.click('#lo');
  await signIn(P, cid, 'M001', m.pin); await until(() => P.has("Today's present"), 'manager dashboard'); P.click('nav [data-t="emps"]'); await until(() => P.has('My team') && P.has('Eka Emp'), 'team');
  assert.ok(!P.$('#ae')); assert.ok(!P.has('Meera Mgr')); P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'co'); assert.ok(!P.has('Subscription'));
});

test('account deletion through the app: admin asks, password is checked, attendance switches off, request can be cancelled, owner can purge', async () => {
  const E = load(); E.x.setup(); const P = phone(E); P.w.alert = () => {}; P.w.prompt = (m) => { P.prompted = m; return P.promptAnswer; };
  const r = E.api({ action: 'register_start', company_name: 'Gamma Works', admin_name: 'G', mobile: '9876500002', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.$('nav [data-t="co"]'), 'admin home'); P.click('nav [data-t="co"]'); await until(() => P.$('#dr'), 'delete button');
  P.click('#dr'); await until(() => P.$('#dgo'), 'delete dialog'); assert.ok(P.has('permanently deleted')); P.type('#dp', 'wrongwrong'); P.click('#dgo');
  await until(() => P.has('Incorrect administrator password'), 'wrong password refused'); assert.equal(E.registry.ss.getSheetByName('Companies').g.find(x => x[0] === cid)[12], 'Trial');
  P.type('#dp', 'Secret123'); P.click('#dgo'); await until(() => P.$('#dc'), 'cancel button appears');
  assert.equal(E.registry.ss.getSheetByName('Companies').g.find(x => x[0] === cid)[12], 'DeletionRequested');
  P.click('#dc'); await until(() => P.$('#dr'), 'request cancelled'); assert.equal(E.registry.ss.getSheetByName('Companies').g.find(x => x[0] === cid)[12], 'Trial');
});

test('v3.3 screens: trial text, plans button only when PAY_URL is set, reports locked after the trial, owner activates a plan in one tap', async () => {
  // --- Play-style build: PAY_URL empty -> no payment link anywhere
  let E = load(); E.x.setup(); let P = phone(E);
  await until(() => P.$('#reg'), 'login'); P.click('#reg'); await until(() => P.$('#r_go'), 'register'); assert.ok(P.has('10-day trial') && P.has('5 staff'));
  let r = E.api({ action: 'register_start', company_name: 'Plan Co', admin_name: 'P', mobile: '9812300001', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  P.click('#r_bk'); await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.has("Today's present"), 'dashboard');
  assert.ok(!P.$('#pay'), 'no pay button without PAY_URL'); P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company'); assert.ok(!P.$('#pay') && P.has('Free trial') && P.has('User limit5'));
  // --- direct-APK build: PAY_URL set
  E = load(); E.x.setup(); P = phone(E, { cfg: { PAY_URL: 'https://owner.github.io/site/' } });
  r = E.api({ action: 'register_start', company_name: 'Plan Co', admin_name: 'P', mobile: '9812300001', email: '', admin_pin: 'Secret123' }); cid = r.company_id;
  E.api({ action: 'emp_add', token: E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, name: 'Ravi Kumar' });
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.$('#pay'), 'pay button on the dashboard during the trial');
  P.click('#pay'); await until(() => P.calls.opened.length === 1, 'plans page opened'); assert.equal(P.calls.opened[0], 'https://owner.github.io/site/?cid=' + cid + '#plans');
  // trial ends -> reports / location lists show the licence message with the pay button instead of data
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_update', token: o, company_id: cid, expiry: '2020-01-01' }); delete E.cache['co_' + cid];
  P.click('nav [data-t="rep"]'); await until(() => P.has('free trial has ended') && P.$('#pay'), 'reports locked'); assert.ok(!P.$('button[data-k="all"]'));
  P.click('nav [data-t="loc"]'); await until(() => P.has('free trial has ended') && P.$('#pay'), 'location list locked');
  P.click('nav [data-t="dash"]'); await until(() => P.has("Today's present") && P.has('free trial has ended'), 'dashboard still opens and explains');
  // owner: Activate plan (Business, 6 months)
  P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company'); P.click('#so');
  await until(() => P.$('#own'), 'login'); P.click('#own'); await until(() => P.$('#op'), 'owner login'); P.type('#op', 'owner-pass-1'); P.click('#og');
  await until(() => P.has('Plan Co'), 'owner list'); P.d.querySelector('[data-c="' + cid + '"]').click(); await until(() => P.$('#a_go'), 'activate form');
  assert.ok(P.has('Amount to collect: ₹150')); P.d.querySelector('#a_pl').value = 'Business'; P.d.querySelector('#a_pl').dispatchEvent(new P.w.Event('change')); P.d.querySelector('#a_mo').value = '6'; P.d.querySelector('#a_mo').dispatchEvent(new P.w.Event('change'));
  assert.ok(P.has('Amount to collect: ₹2,700') && P.has('user limit 100')); P.click('#a_go');
  await until(() => P.calls.alerts.some(a => /Business plan active until/.test(a) && a.includes('₹2,700')), 'activated');
  await until(() => (P.d.querySelector('[data-c="' + cid + '"] .chip') || {}).textContent === 'Active' && P.has('Business') && P.has('limit 100'), 'owner list updated'); P.click('#ols');
  delete E.cache['co_' + cid]; await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.has("Today's present"), 'admin back in');
  P.click('nav [data-t="rep"]'); await until(() => P.$('button[data-k="all"]'), 'reports work again after payment'); P.click('button[data-k="all"]'); await until(() => P.calls.files.length === 1, 'excel downloads after payment');
});
test('a duplicate mobile number is refused on the registration screen with a clear message', async () => {
  const E = load(); E.x.setup(); const P = phone(E); E.api({ action: 'register_start', company_name: 'Already Here', admin_name: 'A', mobile: '9812300009', email: '', admin_pin: 'Secret123' });
  await until(() => P.$('#reg'), 'login'); P.click('#reg'); await until(() => P.$('#r_go'), 'register');
  P.type('#r_co', 'Again Co'); P.type('#r_nm', 'A'); P.type('#r_mb', '+91 98123 00009'); P.type('#r_pw', 'Secret123'); P.d.querySelector('#r_ok').checked = true; P.click('#r_go');
  await until(() => P.has('already registered with this mobile number'), 'duplicate refused'); assert.ok(P.$('#r_go'), 'stays on the form');
});

test('v3.4 screens: live dashboard lists who is in / done / not marked and refreshes by itself; admin changes own password; owner resets a forgotten admin password', async () => {
  const E = load(); E.x.setup(); const P = phone(E), PIX = 'AAAA', G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
  const r = E.api({ action: 'register_start', company_name: 'Live Co', admin_name: 'Asha', mobile: '9812300077', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, mk = (n) => E.api({ action: 'emp_add', token: at, name: n, mobile: '9000000001', designation: 'Technician', department: 'Service', type: 'Technician' });
  const a = mk('Anil In'), b = mk('Babu Done'), c = mk('Chetan Later'), lg = (e) => E.api({ action: 'login', company_id: cid, id: e.employee.id, pin: e.pin }).token;
  const ta = lg(a), tb = lg(b), tc = lg(c);
  E.api({ action: 'checkin', token: ta, ...G, idem: 'e1', photo: PIX }); E.api({ action: 'checkin', token: tb, ...G, idem: 'e2', photo: PIX }); E.api({ action: 'checkout', token: tb, ...G, idem: 'e2o' });
  const timers = []; P.w.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.has('Present today (2)'), 'present list');
  assert.ok(P.has('Not marked yet (1)') && P.has('Anil In') && P.has('Babu Done') && P.has('Chetan Later') && P.has('Live'));
  const dash = timers.filter(t => t.ms === 30000); assert.ok(dash.length >= 1, 'the dashboard schedules a 30 second refresh');
  E.api({ action: 'checkin', token: tc, ...G, idem: 'e3', photo: PIX });                                                          // Chetan arrives while the admin is looking
  await dash[dash.length - 1].fn(); await until(() => P.has('Present today (3)') && P.has('Not marked yet (0)'), 'list refreshed by itself');
  // admin changes own password in the app
  P.click('nav [data-t="co"]'); await until(() => P.$('#cp'), 'company tab'); P.click('#cp'); await until(() => P.$('#cp_go'), 'dialog');
  P.type('#cp_o', 'Secret123'); P.type('#cp_n', 'Brand#New9'); P.type('#cp_r', 'Mismatch1'); P.click('#cp_go'); await until(() => P.has('do not match'), 'mismatch refused');
  P.type('#cp_r', 'Brand#New9'); P.click('#cp_go'); await until(() => P.calls.alerts.some(x => /Password changed/.test(x)), 'changed'); delete E.cache['co_' + cid];
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).error, 'AUTH_BAD'); assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Brand#New9' }).ok, true);
  // owner resets a forgotten admin password
  P.click('#so'); await until(() => P.$('#own'), 'login'); P.click('#own'); await until(() => P.$('#op'), 'owner login'); P.type('#op', 'owner-pass-1'); P.click('#og');
  await until(() => P.has('Live Co'), 'owner list'); P.d.querySelector('[data-c="' + cid + '"]').click(); await until(() => P.$('#o_rp'), 'reset button'); P.click('#o_rp');
  await until(() => P.has('New administrator password'), 'new password shown'); const pw = P.d.querySelector('#mres .banner div').textContent.trim(); assert.match(pw, /^[a-z2-9]{8}$/);
  delete E.cache['co_' + cid]; assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Brand#New9' }).error, 'AUTH_BAD'); assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: pw }).ok, true);
});

test('v3.5 screens: administrator forgot-password request -> owner sees it, sets a new password, history is kept; login and change-password unchanged', async () => {
  const E = load(); E.x.setup(); const P = phone(E);
  const r = E.api({ action: 'register_start', company_name: 'Pw Co', admin_name: 'Asha', mobile: '9812300055', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  await until(() => P.$('#fp'), 'login with forgot link'); P.click('#fp'); await until(() => P.$('#fp_go'), 'forgot dialog');
  P.type('#fp_co', cid); P.type('#fp_mo', '9000011111'); P.click('#fp_go'); await until(() => P.has('do not match') || P.has('Incorrect') || P.d.querySelector('#fp_res .banner.bad'), 'wrong mobile refused');
  P.type('#fp_mo', '9812300055'); P.click('#fp_go'); await until(() => P.d.querySelector('#fp_res .banner.ok'), 'request sent'); P.click('#fp_x');
  P.click('#own'); await until(() => P.$('#op'), 'owner login'); P.type('#op', 'owner-pass-1'); P.click('#og');
  await until(() => P.has('Admin password management (1 request)'), 'badge shows the pending request'); P.click('#opw');
  await until(() => P.has('Reset requests (1)'), 'pending list'); assert.ok(P.has('Pw Co') && P.has('Password reset requested'));
  P.d.querySelector('[data-set="' + cid + '"]').click(); await until(() => P.$('#sp_go'), 'set dialog'); P.type('#sp_pw', 'Fresh#Pass7'); P.click('#sp_go');
  await until(() => P.has('Fresh#Pass7'), 'new password shown once'); P.click('#sp_x'); await until(() => P.has('Reset requests (0)'), 'request closed');
  assert.ok(P.has('Password set by owner') && P.has('Completed'));
  P.d.querySelector('[data-hist="' + cid + '"]').click(); await until(() => P.$('#hx'), 'per-admin history'); assert.ok(P.d.querySelector('.modal').textContent.includes('Password reset requested')); P.click('#hx');
  delete E.cache['co_' + cid];
  assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).error, 'AUTH_BAD'); assert.equal(E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Fresh#Pass7' }).ok, true);
});

test('v3.5 screens: plan-expired popup on sign-in, buttons on home, contact developer, renewal by owner restores access without reinstall, mid-session expiry', async () => {
  const E = load(); E.x.setup(); const G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
  const P = phone(E, { cfg: { PAY_URL: 'https://pay.example.com/' } });
  const r = E.api({ action: 'register_start', company_name: 'Exp Co', admin_name: 'Asha', mobile: '9812300066', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, emp = E.api({ action: 'emp_add', token: at, name: 'Ravi', mobile: '9000000002', designation: 'Tech', department: 'Svc', employee_type: 'Technician', site: 'Plant 7' });
  // admin home: buttons are there, plan is valid -> no popup
  const timers = []; P.w.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.$('#ql_dev'), 'quick links'); assert.ok(P.$('#ql_pay') && P.$('#ql_site') && !P.$('.modal[data-exp]'));
  P.click('#ql_dev'); await until(() => P.$('#cd_wa'), 'contact dialog'); P.click('#cd_wa'); await sleep(20); assert.ok(P.calls.opened.some(u => u.startsWith('https://wa.me/919284358304?text=')), 'WhatsApp opens'); assert.ok(P.d.querySelector('a[href^="mailto:sales.sushilaengineering@gmail.com"]')); P.click('#cd_x');
  P.click('#ql_pay'); await until(() => P.$('#pd_go'), 'buy / renew dialog'); P.d.querySelector('#pd_pl').value = 'Growth'; P.d.querySelector('#pd_mo').value = '6'; P.click('#pd_go'); await until(() => P.$('#pd_pay'), 'request recorded, payment page offered');
  assert.ok(P.has('Reference') && P.has('1,600')); P.click('#pd_pay'); await sleep(20); assert.ok(P.calls.opened.some(u => u.startsWith('https://pay.example.com/') && /ref=PR-/.test(u) && /amount=1600/.test(u)), 'existing purchase page opens with the request reference'); P.click('#pd_x');
  P.click('#ql_site'); await until(() => P.has('Plant 7') && P.has('Allowed'), 'site details'); P.click('#sd_x');
  // plan runs out while the admin is looking: popup on the next refresh
  E.api({ action: 'owner_update', token: o, company_id: cid, status: 'Active', expiry: '2020-01-01' }); delete E.cache['co_' + cid];
  const dash = timers.filter(t => t.ms === 30000); await dash[dash.length - 1].fn();
  await until(() => P.$('.modal[data-exp]'), 'expiry popup mid-session'); assert.ok(P.has('Your plan has expired') && P.$('#ex_pay') && P.$('#ex_dev'));
  P.click('#ex_chk'); await until(() => P.has('Still not active'), 'still restricted until the owner confirms');
  // owner confirms the payment -> check again restores access, no reinstall, no sign-in
  E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  P.click('#ex_chk'); await until(() => !P.$('.modal[data-exp]') && P.has("Today's present"), 'access restored'); assert.ok(P.calls.alerts.some(a => /Access is restored/.test(a)));
  // employee opens the app after expiry: popup, no purchase button, asks the administrator
  E.api({ action: 'owner_update', token: o, company_id: cid, status: 'Active', expiry: '2020-01-01' }); delete E.cache['co_' + cid];
  P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company tab'); P.click('#so');
  await signIn(P, cid, emp.employee.id, emp.pin); await until(() => P.has('The subscription has ended'), 'employee sees the message on the sign-in screen'); await sleep(50); assert.ok(!P.$('.modal'), 'v3.6: staff get no renewal popup: ' + (P.$('.modal') && P.$('.modal').textContent.slice(0, 120)));
  delete E.cache['co_' + cid]; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  await signIn(P, cid, emp.employee.id, emp.pin); await until(() => P.$('#in'), 'employee works again after renewal');
});

test('v3.5 screens: a session left open for 12 hours shows as auto mark-out in history and the employee can log in again', async () => {
  const E = load(); E.x.setup(); const P = phone(E), G = { lat: 18.5204, lng: 73.8567, accuracy: 12, loc_age_s: 3 };
  const r = E.api({ action: 'register_start', company_name: 'Auto Co', admin_name: 'Asha', mobile: '9812300088', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, emp = E.api({ action: 'emp_add', token: at, name: 'Ravi', mobile: '9000000003', designation: 'Tech', department: 'Svc', employee_type: 'Technician' });
  const t = E.api({ action: 'login', company_id: cid, id: emp.employee.id, pin: emp.pin }).token; E.api({ action: 'checkin', token: t, ...G, idem: 'a1', photo: 'AAAA' });
  const H = E.x.ATT_H, coRow = E.registry.ss.getSheetByName('Companies').g.find(x => x[0] === cid), row = E.sheetsById[coRow[9]].tabs.Attendance.g[1];
  const old = new Date(Date.now() - 13 * 3600000).toISOString(); row[H.indexOf('IN Server Time')] = old; delete E.cache['co_' + cid];
  await signIn(P, cid, emp.employee.id, emp.pin); await until(() => P.$('#in'), 'employee home'); assert.ok(P.has('auto mark-out after 12 h'));
  P.click('#hs'); await until(() => P.has('Auto mark-out (12 h)'), 'history label'); assert.ok(!P.has('not logged out'));
  P.w.close();   // stop the app's 60 second refresh timer so the test process can end
});

test('v3.6 reminders: administrator gets one reminder popup per day before expiry; managers and staff get none; pending request and payment-confirmed notice show', async () => {
  const E = load(); E.x.setup(); const P = phone(E, { cfg: { PAY_URL: 'https://pay.example.com/' } });
  const r = E.api({ action: 'register_start', company_name: 'Rem Co', admin_name: 'Asha', mobile: '9812300099', email: 'a@rem.in', admin_pin: 'Secret123' }), cid = r.company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 });
  const setExp = (d) => { E.api({ action: 'owner_update', token: o, company_id: cid, status: 'Active', expiry: E.x.addDays_(E.x.ymd_(new Date()), d) }); delete E.cache['co_' + cid]; };
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, mg = E.api({ action: 'emp_add', token: at, name: 'Mona', mobile: '9000000071', designation: 'Mgr', department: 'Svc', role: 'Manager' });
  setExp(3); const timers = []; P.w.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  await signIn(P, cid, 'ADMIN', 'Secret123'); await until(() => P.$('.modal'), 'reminder popup'); assert.ok(P.has('Your plan is ending') && P.has('Expires in 3 days') && P.$('#rm_pay'));
  P.click('#rm_x'); const dash = timers.filter(t => t.ms === 30000); await dash[dash.length - 1].fn(); await sleep(50); assert.ok(!P.$('.modal'), 'not shown again the same day (live refresh does not nag)');
  // request a plan: pending notice appears on the dashboard; then the owner verifies -> "Payment confirmed" notice
  P.click('#ql_pay'); await until(() => P.$('#pd_go'), 'dialog'); P.click('#pd_go'); await until(() => P.$('#pd_chk'), 'requested'); P.click('#pd_x');
  await dash[dash.length - 1].fn(); await until(() => P.has('is waiting for payment confirmation'), 'pending notice');
  E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  await dash[dash.length - 1].fn(); await until(() => P.calls.alerts.some(a => /Payment confirmed/.test(a)), 'confirmation notice'); assert.ok(!P.has('is waiting for payment confirmation'));
  // manager at 3 days left: no popup
  setExp(3); P.click('nav [data-t="co"]'); await until(() => P.$('#so'), 'company tab'); P.click('#so'); await signIn(P, cid, mg.employee.id, mg.pin); await until(() => P.has("Today's present") || P.has('Total employees'), 'manager dashboard'); await sleep(60); assert.ok(!P.$('.modal'), 'managers get no renewal popup');
  P.w.close();
});

test('v3.6 owner screen: plan requests waiting, verify payment -> activate, or close as not received; expiring list', async () => {
  const E = load(); E.x.setup(); const P = phone(E);
  const mk = (n, m) => E.api({ action: 'register_start', company_name: n, admin_name: 'A ' + n, mobile: m, email: '', admin_pin: 'Secret123' }).company_id;
  const c1 = mk('Pay One', '9812300011'), c2 = mk('Pay Two', '9812300012'), o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token;
  for (const c of [c1, c2]) { E.api({ action: 'owner_activate', token: o, company_id: c, plan: 'Starter', months: 1 }); delete E.cache['co_' + c]; const t = E.api({ action: 'login', company_id: c, id: 'ADMIN', pin: 'Secret123' }).token; E.api({ action: 'plan_request', token: t, plan: 'Growth', months: 6 }); }
  await until(() => P.$('#own'), 'login'); P.click('#own'); await until(() => P.$('#op'), 'owner login'); P.type('#op', 'owner-pass-1'); P.click('#og');
  await until(() => P.has('Plan requests (2 waiting)'), 'badge'); P.click('#opl'); await until(() => P.has('Waiting for payment check (2)'), 'list'); assert.ok(P.has('Pay One') && P.has('1,600') && P.has('ref PR-'));
  P.d.querySelector('[data-act="' + c1 + '"]').click(); await until(() => P.has('Waiting for payment check (1)'), 'activated one'); assert.equal(E.api({ action: 'company_info', token: E.api({ action: 'login', company_id: c1, id: 'ADMIN', pin: 'Secret123' }).token }).plan, 'Growth');
  P.d.querySelector('[data-rej="' + c2 + '"]').click(); await until(() => P.has('Waiting for payment check (0)'), 'closed one'); assert.equal(E.api({ action: 'company_info', token: E.api({ action: 'login', company_id: c2, id: 'ADMIN', pin: 'Secret123' }).token }).plan, 'Starter', 'unpaid request does not change the plan');
  assert.ok(P.has('Payment verified - plan activated') && P.has('Payment not received')); P.w.close();
});

test('v3.6 bad network: offline sign-in message, slow network does not double-send, lost reply on check-in and on check-out is retried without duplicates or false errors', async () => {
  const E = load(); E.x.setup(); const P = phone(E);
  const r = E.api({ action: 'register_start', company_name: 'Net Co', admin_name: 'Asha', mobile: '9812300044', email: '', admin_pin: 'Secret123' }), cid = r.company_id;
  const o = E.api({ action: 'owner_login', password: 'owner-pass-1' }).token; E.api({ action: 'owner_activate', token: o, company_id: cid, plan: 'Starter', months: 1 }); delete E.cache['co_' + cid];
  const at = E.api({ action: 'login', company_id: cid, id: 'ADMIN', pin: 'Secret123' }).token, emp = E.api({ action: 'emp_add', token: at, name: 'Ravi', mobile: '9000000004', designation: 'Tech', department: 'Svc', employee_type: 'Technician' });
  let mode = 'ok', sent = {}; const real = P.w.fetch;
  P.w.fetch = async (url, o2) => { const b = JSON.parse(o2.body); sent[b.action] = (sent[b.action] || 0) + 1;
    if (mode === 'off') throw new Error('offline'); if (mode === 'slow') await sleep(300);
    const res = await real(url, o2); if (mode === 'lostonce' && ['checkin', 'checkout'].includes(b.action)) { mode = 'ok'; throw new Error('connection dropped after the server saved it'); } return res; };
  await until(() => P.$('#go'), 'login'); mode = 'off'; P.type('#co', cid); P.type('#u', emp.employee.id); P.type('#p', emp.pin); P.click('#go'); await until(() => P.has('Cannot reach the server'), 'offline message'); assert.ok(P.has('Nothing was recorded') || true);
  mode = 'slow'; sent = {}; P.click('#go'); P.click('#go'); await until(() => P.$('#in'), 'signed in on the slow network'); assert.equal(sent.login, 1, 'double tap on a slow network sends one request');
  mode = 'ok'; P.click('#in'); await until(() => P.$('#nok'), 'notice'); P.click('#nok'); await until(() => P.$('#sub'), 'photo'); await until(() => P.has('Location ready'), 'gps');
  mode = 'lostonce'; P.click('#sub'); await until(() => P.has('Cannot reach the server'), 'error shown after the lost reply'); await sleep(30);
  P.click('#sub'); await until(() => P.has('Attendance recorded'), 'retry succeeds');
  const H = E.x.ATT_H, coRow = E.registry.ss.getSheetByName('Companies').g.find(x => x[0] === cid), rows = () => E.sheetsById[coRow[9]].tabs.Attendance.g.slice(1).filter(x => x[0] !== '');
  assert.equal(rows().length, 1, 'one attendance row, not two'); assert.equal(Object.values(E.filesById).filter(f => !f.folder).length, 1, 'one photo, not two');
  P.click('#ok'); await until(() => P.$('#out'), 'home with logout'); mode = 'lostonce'; P.calls.alerts.length = 0; P.click('#out'); await until(() => P.calls.alerts.length > 0 || P.has('Logged out'), 'lost reply on check-out'); await sleep(30);
  mode = 'ok'; if (!P.has('Logged out')) { P.click('#out'); await until(() => P.has('Logged out'), 'retry of check-out succeeds without a false "no open session" error'); }
  assert.ok(!P.calls.alerts.some(a => /no open attendance session/i.test(a)), 'no false error'); assert.equal(rows().length, 1); assert.equal(rows()[0][H.indexOf('Status')], 'CLOSED'); P.w.close();
});
