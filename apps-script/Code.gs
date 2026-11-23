/**
 * Field Attendance App - CENTRAL backend (Google Apps Script, owner account, deployed ONCE).
 *
 * One APK, many companies. Companies register INSIDE the app (name, mobile, password) - nobody needs a Google account or
 * any Google sign-in. All data is kept centrally in the PRODUCT OWNER's Google account, strictly separated per company:
 *   - a private "registry" spreadsheet (company list, licence, hashed admin password), and
 *   - for every company its own spreadsheet (Employees, Attendance, Info) and its own Drive folders (photos, reports).
 * Company admins/managers/employees only ever see their own company's data, through this API (the company id comes from the
 * login session, never from the client).
 *
 * Attendance engine = VATS v2.5 logic: idempotent check-in/out, duplicate pre-check before photo upload,
 * photo upload outside the lock, recent-rows reads for daily actions, best-effort GPS recorded with accuracy.
 */
var TZ = 'Asia/Kolkata';
var PRODUCT = 'Field Attendance App';
var LOW_ACCURACY_WARN_M = 100, MAX_PHOTO_B64 = 4000000, MAX_FAILS = 5, RECENT_ROWS = 600, SESSION_TTL = 21600, TRIAL_DAYS_DEFAULT = 10, TRIAL_LIMIT = 5;
// Paid plans. limit = most users (employees + managers). price = rupees for 1 / 6 / 12 months. Used by the Owner screen 'Activate plan'.
var PLANS_ = {
  Starter:    { limit: 25,  price: { 1: 150,  6: 800,   12: 1440 } },
  Growth:     { limit: 50,  price: { 1: 299,  6: 1600,  12: 2880 } },
  Business:   { limit: 100, price: { 1: 499,  6: 2700,  12: 4800 } },
  Enterprise: { limit: 500, price: { 1: 2000, 6: 12000, 12: 24000 } }
};
var PLAN_MONTHS_ = [1, 6, 12];

var CO_H = ['Company ID', 'Company Name', 'Admin Name', 'Mobile', 'Email', 'Business Type', 'Employees (expected)', 'Address', 'Google Account (unused)', 'Spreadsheet ID',
  'Photos Folder ID', 'Reports Folder ID', 'Status', 'Plan', 'Expiry Date', 'Employee Limit', 'Created', 'Admin Salt', 'Admin Hash', 'Notes', 'Root Folder ID', 'Mobile Key'];
var EMP_H = ['Employee ID', 'Name', 'PIN Hash', 'PIN Salt', 'Role', 'Status', 'Expiry Date', 'Mobile', 'Designation', 'Department', 'Employee Type',
  'Manager ID', 'Site', 'Site Lat', 'Site Long', 'Radius (m)', 'Created', 'Updated', 'Notes'];
var ATT_H = ['Ref', 'Date', 'Employee ID', 'Name', 'Site', 'IN Time', 'IN Lat', 'IN Long', 'IN Accuracy (m)', 'IN Map', 'Photo', 'IN Distance from site (m)', 'IN On site?',
  'OUT Time', 'OUT Lat', 'OUT Long', 'OUT Accuracy (m)', 'OUT Map', 'OUT On site?', 'Duration', 'Status', 'IN Server Time', 'OUT Server Time', 'IN Key', 'OUT Key', 'Company ID'];
var EMP_TYPES = ['Field Sales', 'Service Engineer', 'Site Engineer', 'Technician', 'Other'];
var EMP_STATUS = ['Active', 'Trial', 'Suspended', 'Revoked', 'Inactive'];

// ---------------- small helpers ----------------
function fail_(code, msg, extra) { var e = new Error(msg); e.code = code; e.extra = extra || null; return e; }
function P_() { return PropertiesService.getScriptProperties(); }
function C_() { return CacheService.getScriptCache(); }
function ea_(n) { return ATT_H.indexOf(n); }
function ee_(n) { return EMP_H.indexOf(n); }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function hm_(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function mapLink_(lat, lng) { return 'https://www.google.com/maps?q=' + lat + ',' + lng; }
function dayNum_(s) { var p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
function addDays_(ymd, n) { var d = new Date(dayNum_(ymd) * 86400000 + n * 86400000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
function addMonths_(ymd, n) {   // same day-of-month n months later (31 Jan + 1 month = 28/29 Feb)
  var p = String(ymd).split('-'), y = +p[0], m = +p[1] - 1, d = +p[2], t = new Date(Date.UTC(y, m + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + Math.min(d, last)).slice(-2);
}
function round2_(x) { return Math.round(x * 100) / 100; }
function str_(v) { return v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function hex_(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) { var b = (bytes[i] + 256) % 256; s += (b < 16 ? '0' : '') + b.toString(16); } return s; }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function rnd_(n, alphabet) { var s = ''; for (var i = 0; i < n; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length)); return s; }
function safeEq_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function pad_(rows, w) { return rows.map(function (r) { r = r.slice(); while (r.length < w) r.push(''); return r; }); }
function cfg_(k) { var v = P_().getProperty(k); if (!v) throw fail_('SETUP', 'Server is not set up yet (' + k + ' missing). The owner must run setup() once (see SETUP.md).'); return v; }

// ---------------- web app entry points ----------------
function doGet() {
  return ContentService.createTextOutput(PRODUCT + ' backend is running.');
}
function doPost(e) {
  var out; ATT_MEMO_ = null;   // each request starts with no remembered rows (Google already starts a fresh run; this keeps test runners honest)
  try { var req = JSON.parse(e.postData.contents); out = route_(req); out.ok = true; }
  catch (err) {
    out = { ok: false, error: err.code || 'SERVER_ERROR', message: err.code ? err.message : 'Something went wrong. Please retry.' };
    if (err.extra) out.licence = err.extra;
    if (!err.code) console.error(err && err.stack || err);
  }
  out.server_time = new Date().toISOString();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function route_(req) {
  switch (req.action) {
    case 'register_start': return registerStart_(req);
    case 'login': return login_(req);
    case 'owner_login': return ownerLogin_(req);
    case 'admin_forgot_request': return adminForgotRequest_(req);
    case 'me': return me_(req);
    case 'logout_session': return logoutSession_(req);
    case 'checkin': return checkin_(req);
    case 'checkout': return checkout_(req);
    case 'history': return history_(req);
    case 'dashboard': return dashboard_(req);
    case 'att_list': return attList_(req);
    case 'photo': return photo_(req);
    case 'report_month': return reportMonth_(req);
    case 'emp_list': return empList_(req);
    case 'emp_add': return empAdd_(req);
    case 'emp_update': return empUpdate_(req);
    case 'emp_reset_pin': return empResetPin_(req);
    case 'company_info': return companyInfo_(req);
    case 'company_delete_request': return companyDeleteRequest_(req);
    case 'company_delete_cancel': return companyDeleteCancel_(req);
    case 'owner_list': return ownerList_(req);
    case 'owner_update': return ownerUpdate_(req);
    case 'owner_activate': return ownerActivate_(req);
    case 'plan_request': return planRequest_(req);
    case 'owner_plan_overview': return ownerPlanOverview_(req);
    case 'owner_plan_reject': return ownerPlanReject_(req);
    case 'owner_detail': return ownerDetail_(req);
    case 'owner_purge': return ownerPurge_(req);
    case 'owner_reset_admin': return ownerResetAdmin_(req);
    case 'owner_pw_overview': return ownerPwOverview_(req);
    case 'owner_pw_reject': return ownerPwReject_(req);
    case 'admin_change_password': return adminChangePassword_(req);
    default: throw fail_('BAD_REQUEST', 'Unknown request.');
  }
}

// ---------------- storage: the owner's own spreadsheets / Drive (native services, no OAuth) ----------------
// Strings that Sheets would auto-convert (dates, times, numbers, TRUE/FALSE, formulas) are stored as text with a leading apostrophe,
// so ids, hashes, ISO times and phone numbers come back exactly as written. Numbers stay numbers.
function cell_(v) { return (typeof v === 'string' && v !== '' && /^([\d=+\-@.\s]|true$|false$)/i.test(v)) ? "'" + v : v; }
function cells_(rows, w) { return rows.map(function (r) { var o = []; for (var i = 0; i < w; i++) o.push(i < r.length ? cell_(r[i]) : ''); return o; }); }
var SS_ = {};
function sheet_(co, tab) {
  if (!co.sheetId) throw fail_('SERVER_ERROR', 'This company\'s sheet is not ready. Please contact support.');
  var ss = SS_[co.sheetId] || (SS_[co.sheetId] = SpreadsheetApp.openById(co.sheetId)), sh = ss.getSheetByName(tab);
  if (!sh) throw fail_('SERVER_ERROR', 'Company sheet is missing the ' + tab + ' tab. Do not rename tabs.');
  return sh;
}
function colNum_(L) { var n = 0; for (var i = 0; i < L.length; i++) n = n * 26 + L.charCodeAt(i) - 64; return n; }
function pr_(range) {
  var m = /^([^!]+)!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(range); if (!m) throw new Error('bad range ' + range);
  return { tab: m[1], c1: colNum_(m[2]), r1: m[3] ? parseInt(m[3], 10) : 1, c2: m[4] ? colNum_(m[4]) : colNum_(m[2]), r2: m[5] ? parseInt(m[5], 10) : 0 };
}
function blank_(v) { return v === '' || v === null || v === undefined; }
function rd_(co, range) {
  var r = pr_(range), sh = sheet_(co, r.tab), end = r.r2 || sh.getLastRow();   // v3.6: a caller that gives the end row has already looked up the last row, so no second getLastRow call
  if (end < r.r1) return [];
  var v = sh.getRange(r.r1, r.c1, end - r.r1 + 1, r.c2 - r.c1 + 1).getValues();
  v = v.map(function (row) { row = row.slice(); while (row.length && blank_(row[row.length - 1])) row.pop(); return row; });
  while (v.length && v[v.length - 1].length === 0) v.pop();
  return v;
}
function wr_(co, range, values) {
  var r = pr_(range), sh = sheet_(co, r.tab), w = r.c2 - r.c1 + 1; if (r.tab === 'Attendance') ATT_MEMO_ = null;
  if (r.r1 + values.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r.r1 + values.length - 1 - sh.getMaxRows() + 200);
  sh.getRange(r.r1, r.c1, values.length, w).setValues(cells_(values, w)); SpreadsheetApp.flush();
  if (r.tab === 'Employees') C_().remove('el_' + co.id);   // after the write, so nobody can re-cache the old list
}
function ap_(co, range, values, knownLast) {   // knownLast: the caller (holding the lock) has just read the last row, so one call is saved inside the lock
  var r = pr_(range), sh = sheet_(co, r.tab), w = r.c2 - r.c1 + 1, row = (knownLast || sh.getLastRow()) + 1; if (r.tab === 'Attendance') ATT_MEMO_ = null;
  if (row + values.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), values.length + 500);
  sh.getRange(row, r.c1, values.length, w).setValues(cells_(values, w)); SpreadsheetApp.flush();
  if (r.tab === 'Employees') C_().remove('el_' + co.id);
  return row;
}
function lastRow_(co, tab) { return sheet_(co, tab).getLastRow(); }

// ---------------- registry (owner's private spreadsheet) ----------------
function reg_() { return SpreadsheetApp.openById(cfg_('REGISTRY_ID')); }
function coFromRow_(r, rowNum) {
  return { rowNum: rowNum, id: str_(r[0]), name: str_(r[1]), adminName: str_(r[2]), mobile: str_(r[3]), email: str_(r[4]), btype: str_(r[5]), expected: r[6], address: str_(r[7]),
    google: str_(r[8]), sheetId: str_(r[9]), photosId: str_(r[10]), reportsId: str_(r[11]), status: str_(r[12]), plan: str_(r[13]), expiry: isDate_(r[14]) ? ymd_(r[14]) : str_(r[14]),
    limit: parseInt(r[15], 10) || 0, created: str_(r[16]), salt: str_(r[17]), hash: str_(r[18]), notes: str_(r[19]), rootId: str_(r[20]), mobileKey: str_(r[21]) };
}
function loadCo_(cid) {
  cid = str_(cid).toUpperCase(); if (!cid) return null;
  var cache = C_(), k = 'co_' + cid, hit = cache.get(k); if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(); if (n < 2) return null;
  var v = sh.getRange(2, 1, n - 1, CO_H.length).getValues();
  for (var i = 0; i < v.length; i++) if (str_(v[i][0]).toUpperCase() === cid) { var co = coFromRow_(v[i], i + 2); cache.put(k, JSON.stringify(co), 60); return co; }
  return null;
}
function saveCo_(co) {
  var sh = reg_().getSheetByName('Companies');
  var r = [co.id, co.name, co.adminName, co.mobile, co.email, co.btype, co.expected, co.address, co.google, co.sheetId, co.photosId, co.reportsId, co.status, co.plan, co.expiry, co.limit,
    co.created, co.salt, co.hash, co.notes, co.rootId, co.mobileKey || ''];
  if (!co.rowNum) co.rowNum = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(co.rowNum, 1, 1, CO_H.length).setValues(cells_([r], CO_H.length));
  C_().remove('co_' + co.id);
}
function audit_(cid, actor, action, detail) {
  try { var sh = reg_().getSheetByName('Audit'), n = Math.max(sh.getLastRow(), 1) + 1; sh.getRange(n, 1, 1, 5).setValues(cells_([[new Date().toISOString(), cid, actor, action, str_(detail).slice(0, 300)]], 5)); } catch (e) {}
}
// One free trial per mobile number: the key is a hash of the last 10 digits, kept even after the company is deleted.
function mobKey_(mobile) { var d = String(mobile || '').replace(/\D/g, ''); if (d.length > 10) d = d.slice(-10); return d ? sha_('mobile:' + d) : ''; }
function mobKeyOf_(co) { return co.mobileKey || mobKey_(co.mobile); }
function mobileUsed_(key) {   // true if a completed registration (any status, also Deleted) already used this number
  var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(); if (n < 2 || !key) return false;
  var v = sh.getRange(2, 1, n - 1, CO_H.length).getValues();
  for (var i = 0; i < v.length; i++) { if (!str_(v[i][0])) continue; var c = coFromRow_(v[i], i + 2); if (c.status !== 'Pending' && mobKeyOf_(c) === key) return true; }
  return false;
}
function coLicence_(co) {
  var today = ymd_(new Date()), st = co.status.toLowerCase(), exp = co.expiry || null, left = exp ? dayNum_(exp) - dayNum_(today) : null;
  var base = { state: st, expiry: exp, days_left: left, valid: false, plan: co.plan };
  if (st === 'pending') { base.message = 'Company registration is not complete.'; return base; }
  if (st === 'deletionrequested') { base.message = 'Deletion of this company\'s data has been requested. Attendance is switched off. The administrator can cancel the request before the data is deleted.'; return base; }
  if (st === 'deleted') { base.message = 'This company has been deleted.'; return base; }
  if (st === 'suspended') { base.message = 'This company subscription is suspended. Attendance and reports are switched off. Contact your administrator.'; return base; }
  if (st !== 'trial' && st !== 'active') { base.message = 'This company subscription is not active.'; return base; }
  if (exp && exp < today) { base.state = 'expired'; base.message = (st === 'trial' ? 'The free trial has ended.' : 'The subscription has ended.') + ' Attendance and reports are switched off until a plan is active. Your records are kept.'; return base; }
  base.valid = true; base.message = (st === 'trial' ? 'Free trial' : 'Active') + (exp ? ' - ' + left + ' day' + (left === 1 ? '' : 's') + ' remaining (expires ' + exp + ')' : '');
  return base;
}
function needLicence_(co) { var l = coLicence_(co); if (!l.valid) throw fail_('LICENCE_' + l.state.toUpperCase(), l.message, l); return l; }

// ---------------- one-time owner setup ----------------
function setup() {
  var p = P_(); if (!p.getProperty('OWNER_PASSWORD')) throw new Error('Add Script property OWNER_PASSWORD first (Project Settings > Script properties). See SETUP.md.');
  DriveApp.getRootFolder();   // makes Google ask the owner to allow Drive access (needed once)
  if (!p.getProperty('REGISTRY_ID')) {
    var ss = SpreadsheetApp.create(PRODUCT + ' - REGISTRY (owner only)'); p.setProperty('REGISTRY_ID', ss.getId());
    var c = ss.getSheets()[0]; c.setName('Companies'); c.getRange(1, 1, 1, CO_H.length).setValues([CO_H]);
    var a = ss.insertSheet('Audit'); a.getRange(1, 1, 1, 5).setValues([['Time', 'Company ID', 'Actor', 'Action', 'Detail']]);
  }
  else { try { reg_().getSheetByName('Companies').getRange(1, 1, 1, CO_H.length).setValues([CO_H]); } catch (e) {} }   // adds the newest header cells to an older registry
  return 'Setup complete. Registry: ' + p.getProperty('REGISTRY_ID') + '. Now Deploy > New deployment > Web app (Execute as: Me, Access: Anyone) and paste its /exec URL into the app build.';
}

// ---------------- company registration (inside the app, no Google sign-in) ----------------
function validPin_(pin, min) { return /^[A-Za-z0-9@#_-]+$/.test(String(pin || '')) && String(pin).length >= (min || 4) && String(pin).length <= 20; }
function registerStart_(req) {
  var cache = C_(), n = parseInt(cache.get('reg_rate') || '0', 10), d = parseInt(cache.get('reg_day') || '0', 10);
  if (n >= 30 || d >= 150) throw fail_('RATE_LIMIT', 'Too many registrations right now. Try again later.'); cache.put('reg_rate', String(n + 1), 3600); cache.put('reg_day', String(d + 1), 21600);
  var f = { name: str_(req.company_name), adminName: str_(req.admin_name), mobile: str_(req.mobile), email: str_(req.email).toLowerCase(), btype: str_(req.business_type), expected: parseInt(req.employees, 10) || 0, address: str_(req.address) };
  if (!f.name || !f.adminName) throw fail_('BAD_REQUEST', 'Company name and administrator name are required.');
  if (f.name.length > 80 || f.adminName.length > 60) throw fail_('BAD_REQUEST', 'Name is too long.');
  if (!/^[0-9+ -]{8,15}$/.test(f.mobile)) throw fail_('BAD_REQUEST', 'Enter a valid mobile number.');
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw fail_('BAD_REQUEST', 'Enter a valid email address or leave it empty.');
  if (!validPin_(req.admin_pin, 6)) throw fail_('BAD_REQUEST', 'Administrator password must be 6-20 letters/numbers.');
  var mkey = mobKey_(f.mobile); if (mobileUsed_(mkey)) throw fail_('MOBILE_USED', 'A company is already registered with this mobile number, so a new free trial is not available. Sign in with your Company ID, or contact the app provider.');
  var cid; for (var t = 0; t < 10; t++) { cid = 'FA' + rnd_(5, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); if (!loadCo_(cid)) break; }
  var salt = rnd_(16, 'abcdef0123456789');
  var co = { id: cid, name: f.name, adminName: f.adminName, mobile: f.mobile, email: f.email, btype: f.btype, expected: f.expected, address: f.address, google: '', sheetId: '', photosId: '', reportsId: '', status: 'Pending',
    plan: 'Trial', expiry: '', limit: TRIAL_LIMIT, created: new Date().toISOString(), salt: salt, hash: sha_(salt + ':' + req.admin_pin), notes: '', rootId: '', mobileKey: mkey };
  saveCo_(co);
  try { createResources_(co); }
  catch (e) { console.error(e && e.stack || e); co.notes = 'Setup failed: ' + String(e.message || e).slice(0, 150); saveCo_(co); throw fail_('SERVER_ERROR', 'Could not create the company sheet. Please try again in a minute.'); }
  co.status = 'Trial'; co.plan = 'Trial'; co.expiry = addDays_(ymd_(new Date()), parseInt(P_().getProperty('TRIAL_DAYS') || TRIAL_DAYS_DEFAULT, 10));
  saveCo_(co); audit_(co.id, f.adminName, 'REGISTER_DONE', f.name);
  return { company_id: co.id, expiry: co.expiry };
}
// Creates this company's spreadsheet + folders (owner's account). Photos folder is link-restricted by id: employees' photos open for
// the company admin from the Excel "View photo" links; nothing else in the Drive is shared.
function createResources_(co) {
  var ss = SpreadsheetApp.create(co.name + ' - Field Attendance'); co.sheetId = ss.getId();
  try { ss.setSpreadsheetTimeZone(TZ); } catch (e) {}
  var emp = ss.getSheets()[0]; emp.setName('Employees'); emp.getRange(1, 1, 1, EMP_H.length).setValues([EMP_H]); emp.setFrozenRows(1);
  var att = ss.insertSheet('Attendance'); att.getRange(1, 1, 1, ATT_H.length).setValues([ATT_H]); att.setFrozenRows(1);
  var info = ss.insertSheet('Info');
  info.getRange(1, 1, 4, 2).setValues(cells_([[PRODUCT, ''], ['Company ID', co.id], ['Company', co.name], ['Do not rename the Employees / Attendance tabs or their header rows. Use the app to add employees and download reports.', '']], 2));
  var root = DriveApp.createFolder('Field Attendance - ' + co.name + ' (' + co.id + ')'); co.rootId = root.getId();
  var photos = root.createFolder('Attendance Photos'), reports = root.createFolder('Reports'); co.photosId = photos.getId(); co.reportsId = reports.getId();
  try { DriveApp.getFileById(co.sheetId).moveTo(root); } catch (e) {}
  try { photos.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  SpreadsheetApp.flush();
}

// ---------------- sessions / login ----------------
function hashPin_(salt, pin) { return sha_(salt + ':' + pin); }
function newSession_(s) { var t = 'S' + rnd_(40, 'abcdefghijklmnopqrstuvwxyz0123456789'); C_().put('sess_' + t, JSON.stringify(s), SESSION_TTL); return t; }
function sess_(req) { var t = str_(req.token); if (!t) return null; var v = C_().get('sess_' + t); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
function logoutSession_(req) { if (req.token) C_().remove('sess_' + req.token); return {}; }
function lockCheck_(key) { var n = parseInt(C_().get(key) || '0', 10); if (n >= MAX_FAILS) throw fail_('AUTH_LOCKED', 'Too many wrong attempts. Try again after 15 minutes.'); return n; }
function empFromRow_(r, rowNum) {
  return { row: rowNum, id: str_(r[0]), name: str_(r[1]), hash: str_(r[2]), salt: str_(r[3]), role: str_(r[4]) || 'Employee', status: str_(r[5]), expiry: str_(r[6]), mobile: str_(r[7]),
    designation: str_(r[8]), department: str_(r[9]), type: str_(r[10]), manager: str_(r[11]).toUpperCase(), site: str_(r[12]), lat: r[13] === '' ? NaN : parseFloat(r[13]), lng: r[14] === '' ? NaN : parseFloat(r[14]),
    radius: parseFloat(r[15]) || 200, created: str_(r[16]), updated: str_(r[17]), notes: str_(r[18]) };
}
function readEmps_(co) {
  var v = rd_(co, 'Employees!A2:S'), out = [];
  for (var i = 0; i < v.length; i++) { var e = empFromRow_(pad_([v[i]], EMP_H.length)[0], i + 2); if (e.id) out.push(e); }
  return out;
}
// v3.6: read-only screens (dashboard, lists, reports) reuse the staff list for 30 s. Any write to the Employees tab clears it (wr_ / ap_); writers always read fresh.
function readEmpsCached_(co) {
  var cache = C_(), k = 'el_' + co.id, hit = cache.get(k);
  if (hit) { try { var a = JSON.parse(hit); a.forEach(function (o) { if (o.lat === null) o.lat = NaN; if (o.lng === null) o.lng = NaN; }); return a; } catch (e) {} }
  var all = readEmps_(co); try { cache.put(k, JSON.stringify(all), 30); } catch (e) {}   // too large for the cache (very big company): simply not cached
  return all;
}
function empById_(co, id) {
  id = str_(id).toUpperCase(); var cache = C_(), k = 'er_' + co.id + '_' + id, hit = cache.get(k);
  if (hit) { try { var o = JSON.parse(hit); if (o.lat === null) o.lat = NaN; if (o.lng === null) o.lng = NaN; return o; } catch (e) {} }   // JSON turns NaN into null
  var all = readEmps_(co); for (var i = 0; i < all.length; i++) if (all[i].id.toUpperCase() === id) { cache.put(k, JSON.stringify(all[i]), 60); return all[i]; }
  return null;
}
function empLicence_(e) {
  var st = e.status.toLowerCase(), today = ymd_(new Date()), exp = e.expiry || null, left = exp ? dayNum_(exp) - dayNum_(today) : null;
  var b = { state: st || 'not_assigned', expiry: exp, days_left: left, valid: false };
  if (st === 'suspended') { b.message = 'Your account is suspended.'; return b; }
  if (st === 'revoked') { b.message = 'Your account has been revoked.'; return b; }
  if (st === 'inactive') { b.message = 'Your account is deactivated. Contact your administrator.'; return b; }
  if (st !== 'active' && st !== 'trial') { b.state = 'not_assigned'; b.message = 'No valid account. Contact your administrator.'; return b; }
  if (exp && exp < today) { b.state = 'expired'; b.message = 'Your account has expired.'; return b; }
  b.valid = true; b.message = (st === 'trial' ? 'Trial' : 'Active') + (exp ? ' - expires ' + exp : ''); return b;
}
function login_(req) {
  var cid = str_(req.company_id).toUpperCase(), id = str_(req.id).toUpperCase(), pin = str_(req.pin);
  if (!cid || !id || !pin) throw fail_('AUTH_BAD', 'Enter Company ID, user ID and PIN.');
  var fk = 'fail_' + cid + '_' + id, fails = lockCheck_(fk), co = loadCo_(cid);
  var bad = function () { C_().put(fk, String(fails + 1), 900); return fail_('AUTH_BAD', 'Incorrect Company ID, user ID or PIN.'); };
  if (!co || co.status === 'Pending' || co.status === 'Deleted') throw bad();
  var role, user = null;
  if (id === 'ADMIN') { if (!safeEq_(hashPin_(co.salt, pin), co.hash)) throw bad(); role = 'ADMIN'; }
  else {
    user = empById_(co, id); if (!user || !user.hash || !safeEq_(hashPin_(user.salt, pin), user.hash)) throw bad();
    var el = empLicence_(user); if (!el.valid) throw fail_('LICENCE_' + el.state.toUpperCase(), el.message, el);
    role = user.role.toLowerCase() === 'manager' ? 'MANAGER' : 'EMPLOYEE';
    if (role === 'EMPLOYEE') needLicence_(co);
  }
  C_().remove(fk);
  var token = newSession_({ c: co.id, id: id, role: role });
  if (role === 'ADMIN') audit_(co.id, 'ADMIN', 'LOGIN', '');
  var out = profile_(co, role, user); out.token = token; return out;
}
function profile_(co, role, user) {
  var out = { role: role, company: { id: co.id, name: co.name, licence: coLicence_(co) } };
  out.user = user ? { id: user.id, name: user.name, designation: user.designation, department: user.department, site: user.site, mobile: user.mobile, type: user.type } : { id: 'ADMIN', name: co.adminName };
  return out;
}
function ctx_(req, roles) {
  var s = sess_(req); if (!s) throw fail_('SESSION_EXPIRED', 'Please sign in again.');
  if (roles && roles.indexOf(s.role) < 0) throw fail_('FORBIDDEN', 'You do not have access to this.');
  if (s.role === 'OWNER') return { s: s, co: null, user: null };
  var co = loadCo_(s.c); if (!co) throw fail_('SESSION_EXPIRED', 'Please sign in again.');
  var user = null;
  if (s.role !== 'ADMIN') {
    user = empById_(co, s.id); if (!user) throw fail_('SESSION_EXPIRED', 'Please sign in again.');
    var el = empLicence_(user); if (!el.valid) { C_().remove('sess_' + req.token); throw fail_('LICENCE_' + el.state.toUpperCase(), el.message, el); }
  }
  return { s: s, co: co, user: user };
}
function me_(req) {
  var x = ctx_(req); var out = profile_(x.co, x.s.role, x.user);
  if (x.s.role === 'EMPLOYEE') {
    autoOutSweep_(x.co, x.user.id);
    var a = attRecent_(x.co), open = findOpen_(a.v, x.user.id), today = ymd_(new Date()), last = null;
    for (var i = a.v.length - 1; i >= 1; i--) if (String(a.v[i][ea_('Employee ID')]) === x.user.id) { if (a.v[i][ea_('Date')] === today) last = a.v[i]; break; }
    out.open_session = open ? view_(open.row) : null; out.last_session = last ? view_(last) : null;
  }
  return out;
}

// ---------------- attendance engine (v2.5 logic over Google REST) ----------------
var EMPTY_ROW_ = [];
// v3.6: within ONE request the recent rows are read once and reused (copies, so callers can change them safely). Code that holds the lock calls attRecent_(co, true) to read fresh data,
// because another request may have written in between. Every write to the Attendance tab clears the copy.
var ATT_MEMO_ = null;
function attRecent_(co, fresh) {
  if (!fresh && ATT_MEMO_ && ATT_MEMO_.cid === co.id) return { v: ATT_MEMO_.v.map(function (r) { return r.slice(); }), last: ATT_MEMO_.last };
  var last = lastRow_(co, 'Attendance'), v = [ATT_H.slice()], start = Math.max(2, last - RECENT_ROWS + 1);
  for (var i = 2; i < start; i++) v.push(EMPTY_ROW_);
  if (last >= start) { var rows = pad_(rd_(co, 'Attendance!A' + start + ':Z' + last), ATT_H.length); for (var k = 0; k < rows.length; k++) v.push(rows[k]); }
  ATT_MEMO_ = { cid: co.id, v: v.map(function (r) { return r.slice(); }), last: last };
  return { v: v, last: last };
}
// v3.5: a session still open after 12 hours is marked out automatically at the 12 hour point. Done here on the server, so no GPS, phone or open app is needed.
// It runs whenever the data is looked at (employee screens, admin dashboard / lists / reports) and before a new check-in. Sheet status stays CLOSED (so hours and reports work as before);
// the row is recognised by OUT Key = AUTO-12H, with the real mark-out time in OUT Time / OUT Server Time and no coordinates.
var AUTO_OUT_HOURS = 12, AUTO_OUT_KEY = 'AUTO-12H';
function autoOutRows_(co, v, onlyId) {   // v = Attendance rows (v[0] header). Returns the rows it closed.
  var lim = AUTO_OUT_HOURS * 3600000, now = Date.now(), done = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r || r[ea_('Status')] !== 'OPEN' || (onlyId && String(r[ea_('Employee ID')]) !== onlyId)) continue;
    var t = new Date(r[ea_('IN Server Time')]).getTime(); if (!isFinite(t) || now - t < lim) continue;
    var at = new Date(t + lim), w = r.slice();
    w[ea_('OUT Time')] = hm_(at); w[ea_('OUT Lat')] = ''; w[ea_('OUT Long')] = ''; w[ea_('OUT Accuracy (m)')] = ''; w[ea_('OUT Map')] = ''; w[ea_('OUT On site?')] = '';
    w[ea_('Duration')] = duration_(t, at); w[ea_('Status')] = 'CLOSED'; w[ea_('OUT Server Time')] = at.toISOString(); w[ea_('OUT Key')] = AUTO_OUT_KEY;
    wr_(co, 'Attendance!A' + (i + 1) + ':Z' + (i + 1), [w]); v[i] = w; done.push(w);
  }
  return done;
}
function autoOutSweep_(co, onlyId) {   // for callers that do not hold the lock; takes it only when something has to be closed
  var lim = AUTO_OUT_HOURS * 3600000, now = Date.now(), v = attRecent_(co).v, need = false;
  for (var i = 1; i < v.length; i++) { var r = v[i]; if (r && r[ea_('Status')] === 'OPEN' && (!onlyId || String(r[ea_('Employee ID')]) === onlyId) && now - new Date(r[ea_('IN Server Time')]).getTime() >= lim) { need = true; break; } }
  if (!need) return 0;
  var lock = LockService.getScriptLock(); try { lock.waitLock(10000); } catch (e) { return 0; }
  try { return autoOutRows_(co, attRecent_(co, true).v, onlyId).length; } finally { lock.releaseLock(); }
}
function findOpen_(v, id) { for (var i = v.length - 1; i >= 1; i--) if (String(v[i][ea_('Employee ID')]) === id && v[i][ea_('Status')] === 'OPEN') return { rowNum: i + 1, row: v[i] }; return null; }
function view_(r) {
  var num = function (x) { return x === '' || x === undefined ? null : parseFloat(x); };
  return { ref: r[ea_('Ref')], date: r[ea_('Date')], site: r[ea_('Site')], in_time: r[ea_('IN Time')], out_time: r[ea_('OUT Time')] || null, in_ts: r[ea_('IN Server Time')], out_ts: r[ea_('OUT Server Time')] || null,
    in_lat: num(r[ea_('IN Lat')]), in_lng: num(r[ea_('IN Long')]), out_lat: num(r[ea_('OUT Lat')]), out_lng: num(r[ea_('OUT Long')]), duration: r[ea_('Duration')] || null, status: r[ea_('Status')],
    in_on_site: r[ea_('IN On site?')], in_acc: r[ea_('IN Accuracy (m)')], out_acc: r[ea_('OUT Accuracy (m)')], auto_out: r[ea_('OUT Key')] === AUTO_OUT_KEY };
}
function distanceM_(a, b, c, d) { var R = 6371000, rad = function (x) { return x * Math.PI / 180; }, dl = rad(c - a), dn = rad(d - b); var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dn / 2) * Math.sin(dn / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
function checkLoc_(req) {
  var lat = Number(req.lat), lng = Number(req.lng), acc = Number(req.accuracy);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) throw fail_('BAD_LOCATION', 'Location was not received. Turn ON Location (GPS) and try again.');
  return { lat: lat, lng: lng, acc: isFinite(acc) && acc >= 0 ? acc : 9999 };
}
function accWarn_(loc) { return loc.acc > LOW_ACCURACY_WARN_M ? 'GPS accuracy was low (about ' + Math.round(loc.acc) + ' m). It is recorded as it is.' : null; }
function siteCheck_(emp, loc) {
  if (!isFinite(emp.lat) || !isFinite(emp.lng)) return { dist: '', on: 'n/a' };
  var d = Math.round(distanceM_(loc.lat, loc.lng, emp.lat, emp.lng)); return { dist: d, on: d <= emp.radius ? 'Yes' : 'No' };
}
function duration_(a, b) { var m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)); return Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm'; }
function photoIdFromUrl_(u) { var m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(u || '')) || /[?&]id=([A-Za-z0-9_-]+)/.exec(String(u || '')); return m ? m[1] : ''; }

function checkin_(req) {
  var x = ctx_(req, ['EMPLOYEE']), co = x.co, emp = x.user; needLicence_(co);
  var idem = String(req.idem || '').slice(0, 80); if (!idem) throw fail_('BAD_REQUEST', 'Missing request key.');
  var loc = checkLoc_(req), b64 = String(req.photo || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw fail_('PHOTO_REQUIRED', 'A fresh photo is required.');
  if (b64.length > MAX_PHOTO_B64) throw fail_('PHOTO_TOO_LARGE', 'Photo is too large. Please retake.');
  var pre = attRecent_(co).v;
  for (var p = 1; p < pre.length; p++) if (pre[p][ea_('IN Key')] === idem && String(pre[p][ea_('Employee ID')]) === emp.id) return { duplicate: true, session: view_(pre[p]) };
  if (findOpen_(pre, emp.id) && autoOutSweep_(co, emp.id)) pre = attRecent_(co).v;   // (memo was cleared by the write) a session open for 12+ hours is closed first, so the person can check in again
  if (findOpen_(pre, emp.id)) throw fail_('ALREADY_CHECKED_IN', 'You already have an open attendance session. Please log out first.');
  // v3.7: when the administrator has set a site location for this person, check-in is allowed ONLY inside the site radius (nothing is saved, no photo is uploaded). No site location set = no distance rule.
  var site = siteCheck_(emp, loc);
  if (site.on === 'No') throw fail_('OUTSIDE_SITE', 'You are ' + site.dist + ' m away from your assigned site' + (emp.site ? ' (' + emp.site + ')' : '') + '. Attendance can be marked only within ' + Math.round(emp.radius) + ' m of the site. Please go to the site and try again.');
  // Photo goes to the company's Drive folder BEFORE the lock (slow part), so many employees can check in at once.
  var now = new Date(), ref = 'ATT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  var fname = ymd_(now) + '_' + emp.id + '_' + hm_(now).replace(':', '') + '_' + ref + '.jpg';
  var file = DriveApp.getFolderById(co.photosId).createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', fname));
  var fileId = file.getId(), photoUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var rec = attRecent_(co, true), v = rec.v;
    var trash = function () { try { file.setTrashed(true); } catch (e) {} };
    for (var i = 1; i < v.length; i++) if (v[i][ea_('IN Key')] === idem && String(v[i][ea_('Employee ID')]) === emp.id) { trash(); return { duplicate: true, session: view_(v[i]) }; }
    if (findOpen_(v, emp.id)) { trash(); throw fail_('ALREADY_CHECKED_IN', 'You already have an open attendance session. Please log out first.'); }
    var row = []; for (var k = 0; k < ATT_H.length; k++) row.push('');
    var set = function (n, val) { row[ea_(n)] = val; };
    set('Ref', ref); set('Date', ymd_(now)); set('Employee ID', emp.id); set('Name', emp.name); set('Site', emp.site); set('IN Time', hm_(now));
    set('IN Lat', loc.lat); set('IN Long', loc.lng); set('IN Accuracy (m)', Math.round(loc.acc)); set('IN Map', mapLink_(loc.lat, loc.lng)); set('Photo', photoUrl);
    set('IN Distance from site (m)', site.dist); set('IN On site?', site.on); set('Status', 'OPEN'); set('IN Server Time', now.toISOString()); set('IN Key', idem); set('Company ID', co.id);
    ap_(co, 'Attendance!A:Z', [row], rec.last);
    return { session: view_(row), warning: site.on === 'No' ? 'You are ' + site.dist + ' m from your assigned site. This was flagged for review.' : accWarn_(loc) };
  } finally { lock.releaseLock(); }
}
function checkout_(req) {
  var x = ctx_(req, ['EMPLOYEE']), co = x.co, emp = x.user; needLicence_(co);
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var idem = String(req.idem || '').slice(0, 80), v = attRecent_(co, true).v;
    if (idem) for (var i = 1; i < v.length; i++) if (v[i][ea_('OUT Key')] === idem && String(v[i][ea_('Employee ID')]) === emp.id) return { duplicate: true, session: view_(v[i]) };
    var auto = autoOutRows_(co, v, emp.id);   // open for 12+ hours: marked out at the 12 hour point, no location needed
    if (auto.length) return { session: view_(auto[auto.length - 1]), auto: true, message: 'Your session was marked out automatically after 12 hours.' };
    var open = findOpen_(v, emp.id); if (!open) throw fail_('NO_OPEN_SESSION', 'You have no open attendance session to log out of.');
    var loc = checkLoc_(req), now = new Date(), site = siteCheck_(emp, loc), r = open.row.slice();
    var set = function (n, val) { r[ea_(n)] = val; };
    set('OUT Time', hm_(now)); set('OUT Lat', loc.lat); set('OUT Long', loc.lng); set('OUT Accuracy (m)', Math.round(loc.acc)); set('OUT Map', mapLink_(loc.lat, loc.lng));
    set('OUT On site?', site.on); set('Duration', duration_(r[ea_('IN Server Time')], now)); set('Status', 'CLOSED'); set('OUT Server Time', now.toISOString()); set('OUT Key', idem);
    wr_(co, 'Attendance!A' + open.rowNum + ':Z' + open.rowNum, [r]);
    return { session: view_(r), warning: accWarn_(loc) };
  } finally { lock.releaseLock(); }
}
function history_(req) {
  var x = ctx_(req, ['EMPLOYEE', 'MANAGER']); autoOutSweep_(x.co, x.user.id); var v = attRecent_(x.co).v, out = [];
  for (var i = v.length - 1; i >= 1 && out.length < 60; i--) if (String(v[i][ea_('Employee ID')]) === x.user.id) out.push(view_(v[i]));
  return { sessions: out };
}

// ---------------- scope + readers for admin / manager ----------------
function scopeEmps_(x) {   // admin: everyone; manager: only employees assigned to that manager
  var all = readEmpsCached_(x.co); if (x.s.role === 'ADMIN') return all;
  return all.filter(function (e) { return e.manager === x.user.id.toUpperCase(); });
}
// v3.6: finds the first row with Date >= fromDate by reading the Date column from the END in chunks (rows are appended in date order), instead of the whole column.
// Cost now grows with the length of the requested period, not with the age of the sheet.
function firstRowFrom_(co, fromDate, last) {
  var CH = 1500, cand = 0, end = last, lo;
  while (end >= 2) {
    lo = Math.max(2, end - CH + 1); var d = rd_(co, 'Attendance!B' + lo + ':B' + end), at = -1;
    for (var j = 0; j < d.length; j++) if (String(d[j][0]) >= fromDate) { at = lo + j; break; }
    if (at < 0) break; cand = at; if (at > lo) break; end = lo - 1;
  }
  return cand;
}
function rowsFrom_(co, fromDate, meta) {   // rows with Date >= fromDate (rows are appended in date order); meta.first = sheet row number of the first one returned
  var last = lastRow_(co, 'Attendance'); if (last < 2) return [];
  var first = firstRowFrom_(co, fromDate, last); if (!first) return [];
  if (meta) meta.first = first;
  return pad_(rd_(co, 'Attendance!A' + first + ':Z' + last), ATT_H.length);
}
// Same rows, but any session open for 12+ hours inside them is first marked out (see autoOutRows_). Only when something needs closing does it take the lock and write.
function rowsFromSwept_(co, fromDate) {
  var m = {}, rows = rowsFrom_(co, fromDate, m); if (!rows.length) return rows;
  var lim = AUTO_OUT_HOURS * 3600000, now = Date.now(), need = false;
  for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r[ea_('Status')] === 'OPEN' && now - new Date(r[ea_('IN Server Time')]).getTime() >= lim) { need = true; break; } }
  if (!need) return rows;
  var lock = LockService.getScriptLock(); try { lock.waitLock(10000); } catch (e) { return rows; }
  try {
    var rs = rowsFrom_(co, fromDate, m), v = [ATT_H.slice()]; for (var k = 2; k < m.first; k++) v.push(EMPTY_ROW_); rs.forEach(function (x) { v.push(x); });
    autoOutRows_(co, v, null); ATT_MEMO_ = null; return rowsFrom_(co, fromDate, m);
  } finally { lock.releaseLock(); }
}
function byId_(emps) { var m = {}; emps.forEach(function (e) { m[e.id] = e; }); return m; }
function sessionHours_(r) {
  var a = r[ea_('IN Server Time')], b = r[ea_('OUT Server Time')];
  if (r[ea_('Status')] !== 'CLOSED' || !a || !b) return 0;
  var h = (new Date(b).getTime() - new Date(a).getTime()) / 3600000; return h > 0 ? h : 0;
}
function rowView_(r, e) {
  var out = r[ea_('Status')] === 'CLOSED', num = function (x) { return x === '' || x === undefined ? null : x; };
  return { ref: r[ea_('Ref')], date: r[ea_('Date')], id: r[ea_('Employee ID')], name: r[ea_('Name')], department: e ? e.department : '', designation: e ? e.designation : '', manager: e ? e.manager : '',
    site: r[ea_('Site')], in_time: r[ea_('IN Time')], in_lat: num(r[ea_('IN Lat')]), in_lng: num(r[ea_('IN Long')]), in_acc: num(r[ea_('IN Accuracy (m)')]), in_map: r[ea_('IN Map')],
    photo_id: photoIdFromUrl_(r[ea_('Photo')]), in_dist: num(r[ea_('IN Distance from site (m)')]), in_on: r[ea_('IN On site?')],
    out_time: out ? r[ea_('OUT Time')] : null, out_lat: out ? num(r[ea_('OUT Lat')]) : null, out_lng: out ? num(r[ea_('OUT Long')]) : null, out_acc: out ? num(r[ea_('OUT Accuracy (m)')]) : null,
    out_map: out ? r[ea_('OUT Map')] : '', hours: out ? round2_(sessionHours_(r)) : null, status: r[ea_('Status')], auto_out: r[ea_('OUT Key')] === AUTO_OUT_KEY };
}
function dashboard_(req) {
  var x = ctx_(req, ['ADMIN', 'MANAGER']), today = ymd_(new Date()), monthStart = today.slice(0, 8) + '01';
  var emps = scopeEmps_(x).filter(function (e) { return e.role.toLowerCase() !== 'manager'; }), ids = byId_(emps);
  var rows = rowsFromSwept_(x.co, monthStart).filter(function (r) { return ids[String(r[ea_('Employee ID')])]; });
  var active = emps.filter(function (e) { return empLicence_(e).valid; }), pres = {}, open = 0, done = 0, missed = 0, monthDays = {};
  rows.forEach(function (r) {
    var d = r[ea_('Date')], id = r[ea_('Employee ID')]; monthDays[id + '|' + d] = 1;
    if (d === today) { pres[id] = 1; if (r[ea_('Status')] === 'OPEN') open++; else done++; } else if (r[ea_('Status')] === 'OPEN') missed++;
  });
  var presentToday = Object.keys(pres).length;
  // v3.4: who is in / done / absent today (names), so the admin can see it live. Extra fields only - older apps ignore them.
  var byE = {}; rows.forEach(function (r) {
    if (r[ea_('Date')] !== today) return; var id = String(r[ea_('Employee ID')]), t = str_(r[ea_('IN Time')]), o = str_(r[ea_('OUT Time')]), isOpen = r[ea_('Status')] === 'OPEN', b = byE[id];
    if (!b) b = byE[id] = { in_time: t, out_time: '', open: false }; if (t && (!b.in_time || t < b.in_time)) b.in_time = t; if (isOpen) b.open = true; else if (o && o > b.out_time) b.out_time = o;
  });
  var presentList = [], absentList = [];
  emps.forEach(function (e) { var b = byE[e.id]; if (b) presentList.push({ id: e.id, name: e.name, in_time: b.in_time, out_time: b.open ? '' : b.out_time, status: b.open ? 'IN' : 'DONE' }); });
  presentList.sort(function (a, b) { return a.in_time < b.in_time ? -1 : a.in_time > b.in_time ? 1 : 0; });
  active.forEach(function (e) { if (!byE[e.id]) absentList.push({ id: e.id, name: e.name, department: e.department }); });
  return { today: today, present_list: presentList, absent_list: absentList, updated_at: new Date().toISOString(), total_employees: emps.length, active_employees: active.length, present_today: presentToday, absent_today: Math.max(0, active.length - presentToday),
    logged_in_now: open, completed_checkouts: done, missed_checkouts: missed, month_attendance_days: Object.keys(monthDays).length, licence: coLicence_(x.co), plan_request: x.s.role === 'ADMIN' ? prGet_(x.co.id) : null };
}
function attList_(req) {
  var x = ctx_(req, ['ADMIN', 'MANAGER']); needLicence_(x.co); var today = ymd_(new Date()), from = str_(req.from) || today, to = str_(req.to) || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw fail_('BAD_REQUEST', 'Dates must be YYYY-MM-DD.');
  var emps = scopeEmps_(x), ids = byId_(emps), f = { emp: str_(req.emp).toUpperCase(), dept: str_(req.dept), des: str_(req.designation), mgr: str_(req.manager).toUpperCase(), site: str_(req.site) };
  var rows = rowsFromSwept_(x.co, from).filter(function (r) {
    var d = String(r[ea_('Date')]), e = ids[String(r[ea_('Employee ID')])]; if (!e || d > to) return false;
    return (!f.emp || e.id.toUpperCase() === f.emp) && (!f.dept || e.department === f.dept) && (!f.des || e.designation === f.des) && (!f.mgr || e.manager === f.mgr) && (!f.site || e.site === f.site);
  });
  var out = rows.slice(-500).reverse().map(function (r) { return rowView_(r, ids[String(r[ea_('Employee ID')])]); });
  return { from: from, to: to, count: out.length, rows: out };
}
// Photos are private in the admin's Drive; the app shows them only through this authorised call.
function photo_(req) {
  var x = ctx_(req, ['ADMIN', 'MANAGER']); needLicence_(x.co); var  id = str_(req.photo_id); if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw fail_('BAD_REQUEST', 'Bad photo.');
  var f, ok = false; try { f = DriveApp.getFileById(id); var ps = f.getParents(); while (ps.hasNext()) if (ps.next().getId() === x.co.photosId) ok = true; } catch (e) { ok = false; }
  if (!ok) throw fail_('FORBIDDEN', 'You do not have access to this photo.');
  var eid = String(f.getName() || '').split('_')[1] || '';
  if (x.s.role === 'MANAGER') { var e = empById_(x.co, eid); if (!e || e.manager !== x.user.id.toUpperCase()) throw fail_('FORBIDDEN', 'This employee is not assigned to you.'); }
  return { image: 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()) };
}

// ---------------- monthly reports (data; the app builds the Excel file) ----------------
var MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function reportMonth_(req) {
  var x = ctx_(req, ['ADMIN', 'MANAGER']); needLicence_(x.co); var m = /^(\d{4})-(\d{2})$/.exec(str_(req.month) || ymd_(new Date()).slice(0, 7)); if (!m || +m[2] < 1 || +m[2] > 12) throw fail_('BAD_REQUEST', 'Month must be YYYY-MM.');
  var year = +m[1], month = +m[2], days = new Date(Date.UTC(year, month, 0)).getUTCDate(), ym = m[0], today = ymd_(new Date());
  var f = { emp: str_(req.emp).toUpperCase(), dept: str_(req.dept), mgr: str_(req.manager).toUpperCase() };
  var emps = scopeEmps_(x).filter(function (e) { return e.role.toLowerCase() !== 'manager' && (!f.emp || e.id.toUpperCase() === f.emp) && (!f.dept || e.department === f.dept) && (!f.mgr || e.manager === f.mgr); });
  var ids = byId_(emps), rows = rowsFromSwept_(x.co, ym + '-01').filter(function (r) { return String(r[ea_('Date')]).indexOf(ym + '-') === 0 && ids[String(r[ea_('Employee ID')])]; });
  var byDay = {}, has = {}; rows.forEach(function (r) { var k = r[ea_('Employee ID')] + '|' + parseInt(String(r[ea_('Date')]).slice(8, 10), 10); (byDay[k] = byDay[k] || []).push(r); has[r[ea_('Employee ID')]] = 1; });
  var dows = []; for (var d = 1; d <= days; d++) dows.push(new Date(Date.UTC(year, month - 1, d)).getUTCDay());
  var include = emps.filter(function (e) { return e.status.toLowerCase() !== 'inactive' || has[e.id]; });
  var pa = [], hours = [];
  include.forEach(function (e) {
    var codes = [], hv = [], cnt = { P: 0, L: 0, WO: 0, MC: 0 }, tot = 0, worked = 0;
    for (var d = 1; d <= days; d++) {
      var date = ym + '-' + ('0' + d).slice(-2), sun = dows[d - 1] === 0, lst = byDay[e.id + '|' + d] || [], closed = lst.filter(function (r) { return r[ea_('Status')] === 'CLOSED'; }), code = '', hr = '';
      if (lst.length) { var h = 0; lst.forEach(function (r) { h += sessionHours_(r); }); tot += h; if (closed.length) { code = 'P'; hr = round2_(h); worked++; } else { code = 'MC'; hr = 'MC'; } }
      else if (date <= today) code = sun ? 'WO' : 'L';
      if (code) cnt[code]++; codes.push(code); hv.push(hr);
    }
    pa.push({ id: e.id, name: e.name, department: e.department, codes: codes, P: cnt.P, L: cnt.L, WO: cnt.WO, MC: cnt.MC, hours: round2_(tot) });
    hours.push({ id: e.id, name: e.name, values: hv, total: round2_(tot), days_worked: worked });
  });
  var loc = rows.slice().sort(function (a, b) { return (String(a[ea_('Date')]) + a[ea_('IN Time')] + a[ea_('Employee ID')]).localeCompare(String(b[ea_('Date')]) + b[ea_('IN Time')] + b[ea_('Employee ID')]); })
    .map(function (r) { return rowView_(r, ids[String(r[ea_('Employee ID')])]); });
  return { company: x.co.name, month: ym, month_name: MONTHS_[month - 1], year: year, days: days, dows: dows, today: today,
    employees: include.map(function (e) { return { id: e.id, name: e.name, department: e.department, designation: e.designation, manager: e.manager, site: e.site }; }), pa: pa, hours: hours, location: loc };
}

// ---------------- employee management (admin) ----------------
function empPublic_(e) { return { id: e.id, name: e.name, role: e.role, status: e.status, expiry: e.expiry, mobile: e.mobile, designation: e.designation, department: e.department, type: e.type, manager: e.manager, site: e.site,
  lat: isFinite(e.lat) ? e.lat : null, lng: isFinite(e.lng) ? e.lng : null, radius: e.radius }; }
function empList_(req) { var x = ctx_(req, ['ADMIN', 'MANAGER']), l = scopeEmps_(x).map(empPublic_); return { employees: l, types: EMP_TYPES, statuses: EMP_STATUS }; }
function nextId_(all, role) {
  var prefix = role === 'Manager' ? 'M' : 'E', max = 0; all.forEach(function (e) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(e.id.toUpperCase()); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefix + ('00' + (max + 1)).slice(-3);
}
function empRow_(e) {
  var r = []; for (var i = 0; i < EMP_H.length; i++) r.push('');
  var set = function (n, v) { r[ee_(n)] = v; };
  set('Employee ID', e.id); set('Name', e.name); set('PIN Hash', e.hash); set('PIN Salt', e.salt); set('Role', e.role); set('Status', e.status); set('Expiry Date', e.expiry); set('Mobile', e.mobile);
  set('Designation', e.designation); set('Department', e.department); set('Employee Type', e.type); set('Manager ID', e.manager); set('Site', e.site);
  set('Site Lat', isFinite(e.lat) ? e.lat : ''); set('Site Long', isFinite(e.lng) ? e.lng : ''); set('Radius (m)', e.radius); set('Created', e.created); set('Updated', e.updated); set('Notes', e.notes);
  return r;
}
function fieldsFrom_(req, e, all) {
  var has = function (k) { return req[k] !== undefined; };
  if (has('name')) { e.name = str_(req.name); if (!e.name) throw fail_('BAD_REQUEST', 'Employee name is required.'); }
  if (has('mobile')) { e.mobile = str_(req.mobile); if (e.mobile && !/^[0-9+ -]{8,15}$/.test(e.mobile)) throw fail_('BAD_REQUEST', 'Enter a valid mobile number.'); }
  ['designation', 'department', 'site', 'notes'].forEach(function (k) { if (has(k)) e[k] = str_(req[k]); });
  if (has('type')) { e.type = str_(req.type); if (e.type && EMP_TYPES.indexOf(e.type) < 0) throw fail_('BAD_REQUEST', 'Unknown employee type.'); }
  if (has('manager')) { e.manager = str_(req.manager).toUpperCase(); if (e.manager) { var m = all.filter(function (z) { return z.id.toUpperCase() === e.manager && z.role.toLowerCase() === 'manager'; })[0]; if (!m) throw fail_('BAD_REQUEST', 'Assigned manager not found.'); } }
  if (has('lat')) e.lat = req.lat === '' || req.lat === null ? NaN : parseFloat(req.lat);
  if (has('lng')) e.lng = req.lng === '' || req.lng === null ? NaN : parseFloat(req.lng);
  if (isFinite(e.lat) && (Math.abs(e.lat) > 90 || !isFinite(e.lng) || Math.abs(e.lng) > 180)) throw fail_('BAD_REQUEST', 'Site latitude/longitude are not valid.');
  if (has('radius')) e.radius = Math.min(50000, Math.max(20, parseFloat(req.radius) || 200));
  if (has('status')) { if (EMP_STATUS.indexOf(req.status) < 0) throw fail_('BAD_REQUEST', 'Unknown status.'); e.status = req.status; }
  if (has('expiry')) { e.expiry = str_(req.expiry); if (e.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(e.expiry)) throw fail_('BAD_REQUEST', 'Expiry must be YYYY-MM-DD.'); }
  return e;
}
function empAdd_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co; needLicence_(co);
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var all = readEmps_(co), role = str_(req.role).toLowerCase() === 'manager' ? 'Manager' : 'Employee';
    var activeCount = all.filter(function (e) { return ['inactive', 'revoked'].indexOf(e.status.toLowerCase()) < 0; }).length;
    if (co.limit && activeCount >= co.limit) throw fail_('LIMIT_REACHED', 'Your plan allows ' + co.limit + ' users. Contact the app owner to increase the limit.');
    var pin = str_(req.pin) || rnd_(6, '0123456789'); if (!validPin_(pin, 4)) throw fail_('BAD_REQUEST', 'PIN must be 4-20 letters/numbers.');
    var now = new Date().toISOString(), salt = rnd_(16, 'abcdef0123456789');
    var e = { id: nextId_(all, role), name: '', hash: hashPin_(salt, pin), salt: salt, role: role, status: 'Active', expiry: ymd_(new Date(Date.now() + 365 * 86400000)), mobile: '', designation: '', department: '', type: '', manager: '', site: '',
      lat: NaN, lng: NaN, radius: 200, created: now, updated: now, notes: '' };
    fieldsFrom_(req, e, all); if (!e.name) throw fail_('BAD_REQUEST', 'Employee name is required.');
    ap_(co, 'Employees!A:S', [empRow_(e)]); C_().remove('er_' + co.id + '_' + e.id.toUpperCase()); audit_(co.id, 'ADMIN', 'EMP_ADD', e.id + ' ' + e.name);
    return { employee: empPublic_(e), pin: pin };
  } finally { lock.releaseLock(); }
}
function empUpdate_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co; needLicence_(co);
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var all = readEmps_(co), id = str_(req.id).toUpperCase(), e = all.filter(function (z) { return z.id.toUpperCase() === id; })[0]; if (!e) throw fail_('NOT_FOUND', 'Employee not found.');
    var wasOff = ['inactive', 'revoked'].indexOf(e.status.toLowerCase()) >= 0;
    fieldsFrom_(req, e, all); e.updated = new Date().toISOString();
    if (wasOff && ['inactive', 'revoked'].indexOf(e.status.toLowerCase()) < 0 && co.limit) {
      var others = all.filter(function (z) { return z.id !== e.id && ['inactive', 'revoked'].indexOf(z.status.toLowerCase()) < 0; }).length;
      if (others >= co.limit) throw fail_('LIMIT_REACHED', 'Your plan allows ' + co.limit + ' users. Switch someone else off first, or choose a bigger plan.');
    }
    wr_(co, 'Employees!A' + e.row + ':S' + e.row, [empRow_(e)]); C_().remove('er_' + co.id + '_' + e.id.toUpperCase()); audit_(co.id, 'ADMIN', 'EMP_UPDATE', e.id + ' ' + (req.status || ''));
    return { employee: empPublic_(e) };
  } finally { lock.releaseLock(); }
}
function empResetPin_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co; needLicence_(co);
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var all = readEmps_(co), id = str_(req.id).toUpperCase(), e = all.filter(function (z) { return z.id.toUpperCase() === id; })[0]; if (!e) throw fail_('NOT_FOUND', 'Employee not found.');
    var pin = str_(req.pin) || rnd_(6, '0123456789'); if (!validPin_(pin, 4)) throw fail_('BAD_REQUEST', 'PIN must be 4-20 letters/numbers.');
    e.salt = rnd_(16, 'abcdef0123456789'); e.hash = hashPin_(e.salt, pin); e.updated = new Date().toISOString();
    wr_(co, 'Employees!A' + e.row + ':S' + e.row, [empRow_(e)]); C_().remove('er_' + co.id + '_' + e.id.toUpperCase()); C_().remove('fail_' + co.id + '_' + e.id.toUpperCase()); audit_(co.id, 'ADMIN', 'EMP_RESET_PIN', e.id);
    return { id: e.id, pin: pin };
  } finally { lock.releaseLock(); }
}
function companyInfo_(req) {
  var x = ctx_(req, ['ADMIN', 'MANAGER']), co = x.co;
  return { id: co.id, name: co.name, admin_name: co.adminName, mobile: co.mobile, email: co.email, business_type: co.btype, address: co.address,
    plan: co.plan, status: co.status, expiry: co.expiry, employee_limit: co.limit, licence: coLicence_(co), plan_request: x.s.role === 'ADMIN' ? prGet_(co.id) : null, plans: x.s.role === 'ADMIN' ? PLANS_ : undefined };
}

// Account / data deletion (Google Play requires that people who create an account in the app can ask for it to be deleted).
// Admin asks (password re-checked) -> company is switched off at once -> owner permanently deletes the sheet + folders (owner_purge).
function companyDeleteRequest_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co, fk = 'fail_' + co.id + '_ADMIN', fails;
  try { fails = lockCheck_(fk); } catch (e) { throw fail_('PASSWORD_LOCKED', e.message); }   // own error codes: the app must not treat a typo here as 'signed out'
  if (!safeEq_(hashPin_(co.salt, str_(req.pin)), co.hash)) { C_().put(fk, String(fails + 1), 900); throw fail_('PASSWORD_BAD', 'Incorrect administrator password.'); }
  C_().remove(fk);
  if (co.status !== 'DeletionRequested') { co.notes = 'DELETE_REQ ' + ymd_(new Date()) + ' prev=' + co.status; co.status = 'DeletionRequested'; saveCo_(co); audit_(co.id, 'ADMIN', 'DELETE_REQUEST', co.name); }
  return { status: co.status };
}
function companyDeleteCancel_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co; if (co.status !== 'DeletionRequested') throw fail_('BAD_REQUEST', 'No deletion request is open.');
  var m = /prev=(\w+)/.exec(co.notes || ''); co.status = m && ['Trial', 'Active', 'Suspended', 'Expired'].indexOf(m[1]) >= 0 ? m[1] : 'Trial'; co.notes = ''; saveCo_(co); audit_(co.id, 'ADMIN', 'DELETE_CANCEL', '');
  return { status: co.status };
}
function ownerPurge_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  if (str_(req.confirm).toUpperCase() !== co.id) throw fail_('BAD_REQUEST', 'Type the Company ID to confirm.');
  [co.rootId, co.sheetId].forEach(function (id) { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { try { DriveApp.getFolderById(id).setTrashed(true); } catch (e2) {} } } });
  var n = co.name; co.mobileKey = mobKeyOf_(co); co.status = 'Deleted'; co.sheetId = co.photosId = co.reportsId = co.rootId = ''; co.salt = co.hash = ''; co.adminName = co.mobile = co.email = co.address = ''; co.notes = 'Data deleted ' + ymd_(new Date());
  saveCo_(co); audit_(co.id, 'OWNER', 'PURGE', n);
  return { company: coPublic_(co) };
}

// ---------------- owner console (separate login; password only in Script Properties) ----------------
function ownerLogin_(req) {
  var fk = 'fail_OWNER', fails = lockCheck_(fk), pw = str_(req.password);
  if (!pw || !safeEq_(pw, cfg_('OWNER_PASSWORD'))) { C_().put(fk, String(fails + 1), 900); throw fail_('AUTH_BAD', 'Incorrect owner password.'); }
  C_().remove(fk); return { role: 'OWNER', token: newSession_({ c: '', id: 'OWNER', role: 'OWNER' }) };
}
function coPublic_(co) {
  var l = coLicence_(co);
  return { id: co.id, name: co.name, admin_name: co.adminName, mobile: co.mobile, email: co.email, business_type: co.btype, status: co.status, plan: co.plan,
    expiry: co.expiry, days_left: l.days_left, valid: l.valid, employee_limit: co.limit, expected_employees: co.expected, created: co.created };
}
function ownerList_(req) {
  ctx_(req, ['OWNER']); var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(), out = [];
  if (n >= 2) { var v = sh.getRange(2, 1, n - 1, CO_H.length).getValues(); for (var i = 0; i < v.length; i++) { if (!str_(v[i][0])) continue; out.push(coPublic_(coFromRow_(v[i], i + 2))); } }
  return { companies: out, plans: PLANS_ };
}
function ownerUpdate_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  if (co.status === 'Deleted') throw fail_('BAD_REQUEST', 'This company has been deleted.');
  if (req.status !== undefined) { if (['Trial', 'Active', 'Suspended', 'Expired'].indexOf(req.status) < 0) throw fail_('BAD_REQUEST', 'Unknown status.'); if (co.status === 'Pending') throw fail_('BAD_REQUEST', 'Registration is not complete.'); co.status = req.status; }
  if (req.plan !== undefined) co.plan = str_(req.plan).slice(0, 40);
  if (req.limit !== undefined) { var l = parseInt(req.limit, 10); if (!(l >= 1 && l <= 100000)) throw fail_('BAD_REQUEST', 'Employee limit must be 1-100000.'); co.limit = l; }
  if (req.expiry !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.expiry))) throw fail_('BAD_REQUEST', 'Expiry must be YYYY-MM-DD.'); co.expiry = req.expiry; }
  if (req.extend_days !== undefined) {
    var d = parseInt(req.extend_days, 10); if (!(d >= 1 && d <= 3650)) throw fail_('BAD_REQUEST', 'Days must be 1-3650.');
    var base = co.expiry && co.expiry > ymd_(new Date()) ? co.expiry : ymd_(new Date()); co.expiry = addDays_(base, d); if (co.status === 'Expired') co.status = 'Active';
  }
  if (req.notes !== undefined) co.notes = str_(req.notes).slice(0, 200);
  saveCo_(co); audit_(co.id, 'OWNER', 'OWNER_UPDATE', JSON.stringify({ s: req.status, p: req.plan, l: req.limit, e: req.expiry, x: req.extend_days }));
  return { company: coPublic_(co) };
}
// One click: plan + months -> Active, plan name, user limit and expiry are all set together. Renewing an active company adds the months after its current expiry.
function ownerActivate_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  if (['Pending', 'Deleted', 'DeletionRequested'].indexOf(co.status) >= 0) throw fail_('BAD_REQUEST', 'This company cannot be activated (status: ' + co.status + ').');
  var name = str_(req.plan), plan = PLANS_.hasOwnProperty(name) ? PLANS_[name] : null, months = parseInt(req.months, 10);
  if (!plan) throw fail_('BAD_REQUEST', 'Unknown plan.'); if (PLAN_MONTHS_.indexOf(months) < 0) throw fail_('BAD_REQUEST', 'Months must be 1, 6 or 12.');
  var lim = plan.limit; if (req.limit !== undefined && req.limit !== '') { lim = parseInt(req.limit, 10); if (!(lim >= 1 && lim <= 100000)) throw fail_('BAD_REQUEST', 'Employee limit must be 1-100000.'); }
  var today = ymd_(new Date()), base = co.status === 'Active' && co.expiry && co.expiry > today ? co.expiry : today;
  co.status = 'Active'; co.plan = name; co.limit = lim; co.expiry = addMonths_(base, months);
  saveCo_(co); audit_(co.id, 'OWNER', 'ACTIVATE', name + ' ' + months + 'm Rs' + plan.price[months] + ' until ' + co.expiry);
  prDelete_(co.id); P_().deleteProperty('ntf_' + co.id);   // the open request (if any) is closed; reminders start again for the new expiry
  mailTo_(co.email, 'Field Attendance - payment confirmed, plan active', 'Hello ' + co.adminName + ',\n\nYour payment was verified and the ' + name + ' plan is now active for ' + co.name + ' (' + co.id + ') until ' + co.expiry + '.\nAccess is restored; no reinstall is needed. Open the app to continue.\n\nSushila Engineering Works');
  return { company: coPublic_(co), price: plan.price[months] };
}
// ---------------- v3.6: plan purchase / renewal requests and notifications ----------------
// Payment itself happens outside the app (UPI / website). A plan becomes active ONLY when the owner has checked the money and taps Activate (owner_activate) - nothing here marks a payment as received.
// The open request per company is kept in a Script property (pr_<id>), so reading it is one cheap call; every step is also written to the registry Audit sheet.
function prGet_(cid) { try { var v = P_().getProperty('pr_' + cid); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function prDelete_(cid) { try { P_().deleteProperty('pr_' + cid); } catch (e) {} }
function mailTo_(to, subject, body) { try { if (!to || !/^[^@\s]+@[^@\s]+$/.test(to)) return false; MailApp.sendEmail(to, subject, body); return true; } catch (e) { return false; } }   // email is a best-effort extra; a mail problem never blocks the request
function ownerMail_(subject, body) { return mailTo_(str_(P_().getProperty('OWNER_EMAIL')), subject, body); }
function planRequest_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co, name = str_(req.plan), plan = PLANS_.hasOwnProperty(name) ? PLANS_[name] : null, months = parseInt(req.months, 10);
  if (!plan) throw fail_('BAD_REQUEST', 'Choose a plan.'); if (PLAN_MONTHS_.indexOf(months) < 0) throw fail_('BAD_REQUEST', 'Months must be 1, 6 or 12.');
  if (['Pending', 'Deleted', 'DeletionRequested'].indexOf(co.status) >= 0) throw fail_('BAD_REQUEST', 'This company cannot buy a plan right now (status: ' + co.status + ').');
  var open = prGet_(co.id); if (open) return { already_pending: true, request: open, message: 'You already have an open request (' + open.ref + '). Pay for it and the developer will activate your plan, or contact the developer.' };
  var rq = { ref: 'PR-' + rnd_(6, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'), plan: name, months: months, amount: plan.price[months], time: new Date().toISOString(), by: 'ADMIN' };
  P_().setProperty('pr_' + co.id, JSON.stringify(rq)); audit_(co.id, 'ADMIN', 'PLAN_REQUEST', rq.ref + ' ' + name + ' ' + months + 'm Rs' + rq.amount + ' Pending');
  ownerMail_('Plan request ' + rq.ref + ' - ' + co.name, co.name + ' (' + co.id + ') asked for the ' + name + ' plan, ' + months + ' month(s), Rs ' + rq.amount + '.\nAdministrator: ' + co.adminName + ', ' + co.mobile + '.\nReference: ' + rq.ref + '\nActivate it in the Owner screen only after you have seen the payment.');
  return { request: rq, message: 'Request ' + rq.ref + ' sent. Pay Rs ' + rq.amount + ' and quote this reference. Your plan is activated after the developer has verified the payment.' };
}
function ownerPlanOverview_(req) {
  ctx_(req, ['OWNER']); var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(), today = ymd_(new Date()), reqs = [], soon = [], all = P_().getProperties();
  if (n >= 2) sh.getRange(2, 1, n - 1, CO_H.length).getValues().forEach(function (row, i) {
    if (!str_(row[0])) return; var c = coFromRow_(row, i + 2); if (c.status === 'Pending' || c.status === 'Deleted') return;
    var left = c.expiry ? dayNum_(c.expiry) - dayNum_(today) : null, rq = null; try { rq = all['pr_' + c.id] ? JSON.parse(all['pr_' + c.id]) : null; } catch (e) {}
    var base = { company_id: c.id, company_name: c.name, admin_name: c.adminName, mobile: c.mobile, email: c.email, status: c.status, plan: c.plan, expiry: c.expiry || null, days_left: left };
    if (rq) reqs.push(Object.assign({ request: rq }, base));
    if ((c.status === 'Trial' || c.status === 'Active' || c.status === 'Expired') && left !== null && left <= 7 && left >= -30) soon.push(base);
  });
  reqs.sort(function (a, b) { return a.request.time < b.request.time ? -1 : 1; }); soon.sort(function (a, b) { return a.days_left - b.days_left; });
  var tail = auditTail_(3000), names = {}; var hist = tail.filter(function (r) { return r[3] === 'PLAN_REQUEST' || r[3] === 'ACTIVATE' || r[3] === 'PLAN_REQUEST_REJECTED'; }).slice(-100).reverse().map(function (r) {
    return { time: r[0], company_id: String(r[1]), actor: String(r[2]), action: String(r[3]), label: r[3] === 'PLAN_REQUEST' ? 'Plan requested' : r[3] === 'ACTIVATE' ? 'Payment verified - plan activated' : 'Payment not received - request closed', detail: String(r[4]) }; });
  return { requests: reqs, expiring: soon, history: hist, pending_count: reqs.length };
}
function ownerPlanReject_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  var rq = prGet_(co.id); prDelete_(co.id); audit_(co.id, 'OWNER', 'PLAN_REQUEST_REJECTED', (rq ? rq.ref : '-') + ' Payment not received');
  mailTo_(co.email, 'Field Attendance - payment not received', 'Hello ' + co.adminName + ',\n\nWe could not find the payment for request ' + (rq ? rq.ref : '') + ' (' + co.name + '). Your plan has not changed. Please pay again or contact us.\n\nSushila Engineering Works');
  return { ok: true };
}
// Daily job (time-driven trigger, set up once with installTriggers): e-mails the administrator 7, 3 and 1 day before expiry, on the last valid day and once after expiry, each only once per expiry date;
// e-mails the owner a summary. Works while the app is closed. Needs the owner to allow "send email" once (Google asks when the function is first run).
var REMIND_DAYS_ = [7, 3, 1, 0, -1];
function notifyExpiryDaily() {
  var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(), today = ymd_(new Date()), p = P_(), sent = [], pend = [];
  if (n >= 2) sh.getRange(2, 1, n - 1, CO_H.length).getValues().forEach(function (row, i) {
    if (!str_(row[0])) return; var c = coFromRow_(row, i + 2); if (c.status !== 'Trial' && c.status !== 'Active' && c.status !== 'Expired') return; if (!c.expiry) return;
    var left = dayNum_(c.expiry) - dayNum_(today); if (REMIND_DAYS_.indexOf(left) < 0) return;
    var key = c.expiry + '|' + left; if (p.getProperty('ntf_' + c.id) === key) return;
    var txt = left > 0 ? 'will expire in ' + left + ' day' + (left === 1 ? '' : 's') + ' (on ' + c.expiry + ')' : left === 0 ? 'expires today (' + c.expiry + ')' : 'has expired (' + c.expiry + ')';
    var ok = mailTo_(c.email, 'Field Attendance - your plan ' + (left > 0 ? 'expires in ' + left + ' day' + (left === 1 ? '' : 's') : left === 0 ? 'expires today' : 'has expired'),
      'Hello ' + c.adminName + ',\n\nThe ' + (c.status === 'Trial' ? 'free trial' : 'plan') + ' of ' + c.name + ' (' + c.id + ') ' + txt + '.\n' + (left >= 0 ? 'Renew in the app (Company tab) so attendance does not stop.' : 'Attendance and reports are switched off until you renew; your records are kept.') + '\n\nSushila Engineering Works');
    if (ok) p.setProperty('ntf_' + c.id, key);
    sent.push(c.name + ' (' + c.id + ') - ' + txt + (ok ? '' : ' [admin email failed or missing]'));
  });
  var all = p.getProperties(); Object.keys(all).forEach(function (k) { if (k.indexOf('pr_') === 0) { try { var r = JSON.parse(all[k]); pend.push(k.slice(3) + ' ' + r.ref + ' ' + r.plan + ' ' + r.months + 'm Rs' + r.amount); } catch (e) {} } });
  if (sent.length || pend.length) ownerMail_('Field Attendance - daily plan summary', (sent.length ? 'Expiry reminders sent today:\n' + sent.join('\n') + '\n\n' : '') + (pend.length ? 'Open plan requests waiting for your payment check:\n' + pend.join('\n') : ''));
  return { reminders: sent.length, open_requests: pend.length };
}
function installTriggers() {   // run once from the Apps Script editor
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'notifyExpiryDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('notifyExpiryDaily').timeBased().everyDays(1).atHour(8).create(); return 'Daily expiry reminders set for about 08:00.';
}
var PW_EVENTS_ = { PW_REQUEST: 'Password reset requested', ADMIN_PASSWORD_RESET: 'Password set by owner', PASSWORD_CHANGE: 'Password changed by administrator', PASSWORD_CHANGE_FAILED: 'Password change failed', PW_REQUEST_REJECTED: 'Request rejected by owner' };
var PW_RESOLVES_ = { ADMIN_PASSWORD_RESET: 1, PASSWORD_CHANGE: 1, PW_REQUEST_REJECTED: 1 };   // events that close an open request
function auditTail_(maxRows) { var sh = reg_().getSheetByName('Audit'), n = sh.getLastRow(); if (n < 2) return []; var st = Math.max(2, n - maxRows + 1); return sh.getRange(st, 1, n - st + 1, 5).getValues(); }
function pwEvents_(tail) {   // password events in time order; also the open request (if any) per company. Never contains a password.
  var ev = [], pending = {};
  tail.forEach(function (r) {
    var a = str_(r[3]); if (!PW_EVENTS_[a]) return; var cid = str_(r[1]), e = { time: str_(r[0]), company_id: cid, actor: str_(r[2]), action: a, label: PW_EVENTS_[a], status: str_(r[4]) };
    ev.push(e); if (a === 'PW_REQUEST') pending[cid] = e.time; else if (PW_RESOLVES_[a]) delete pending[cid];
  });
  return { events: ev, pending: pending };
}
// An administrator who forgot the password asks the owner. Needs no sign-in, so it is checked against the company's registered mobile number and limited.
function adminForgotRequest_(req) {
  var cid = str_(req.company_id).toUpperCase(), co = cid ? loadCo_(cid) : null, mk = mobKey_(req.mobile), cache = C_(), fk = 'pwreq_fail_' + (cid || 'x'), fails = parseInt(cache.get(fk) || '0', 10);
  if (fails >= 5) throw fail_('TOO_MANY', 'Too many attempts. Please try again after one hour.');
  if (!co || !mk || mk !== mobKeyOf_(co) || ['Pending', 'Deleted'].indexOf(co.status) >= 0) { cache.put(fk, String(fails + 1), 3600); throw fail_('AUTH_BAD', 'Company ID and registered mobile number do not match our records.'); }
  var pw = pwEvents_(auditTail_(2000)), mine = pw.events.filter(function (e) { return e.company_id === co.id && e.action === 'PW_REQUEST' && Date.parse(e.time) > Date.now() - 86400000; });
  if (pw.pending[co.id]) return { already_pending: true, message: 'Your request is already with the app owner. Please wait for the owner to contact you.' };
  if (mine.length >= 5) throw fail_('TOO_MANY', 'Too many requests today. Please contact the app owner directly.');
  audit_(co.id, 'ADMIN', 'PW_REQUEST', 'Pending');
  return { sent: true, message: 'Request sent to the app owner. The owner will contact you and set a new password.' };
}
function ownerPwOverview_(req) {
  ctx_(req, ['OWNER']); var sh = reg_().getSheetByName('Companies'), n = sh.getLastRow(), pw = pwEvents_(auditTail_(3000)), admins = [], byCo = {}, names = {};
  pw.events.forEach(function (e) { (byCo[e.company_id] = byCo[e.company_id] || []).push(e); });
  if (n >= 2) sh.getRange(2, 1, n - 1, CO_H.length).getValues().forEach(function (row, i) {
    if (!str_(row[0])) return; var c = coFromRow_(row, i + 2); if (c.status === 'Pending' || c.status === 'Deleted') return;
    var h = byCo[c.id] || []; names[c.id] = c.name + ' / ' + c.adminName;
    admins.push({ company_id: c.id, company_name: c.name, admin_name: c.adminName, mobile: c.mobile, email: c.email, status: c.status, pending_since: pw.pending[c.id] || null, last_event: h.length ? h[h.length - 1] : null, history: h.slice(-30).reverse() });
  });
  admins.sort(function (a, b) { return (b.pending_since ? 1 : 0) - (a.pending_since ? 1 : 0) || (a.company_name < b.company_name ? -1 : 1); });
  var all = pw.events.slice(-200).reverse().map(function (e) { var c = names[e.company_id] || e.company_id + ' / -'; return { time: e.time, company_id: e.company_id, company_name: c.split(' / ')[0], admin_name: c.split(' / ')[1], actor: e.actor, action: e.action, label: e.label, status: e.status }; });
  return { admins: admins, pending_count: admins.filter(function (a) { return a.pending_since; }).length, history: all };
}
function ownerPwReject_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  audit_(co.id, 'OWNER', 'PW_REQUEST_REJECTED', 'Rejected'); return { ok: true };
}
function ownerResetAdmin_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  if (['Pending', 'Deleted'].indexOf(co.status) >= 0) throw fail_('BAD_REQUEST', 'The administrator password cannot be reset (status: ' + co.status + ').');
  var pw = str_(req.password) || rnd_(8, 'abcdefghjkmnpqrstuvwxyz23456789'); if (!validPin_(pw, 6)) throw fail_('BAD_REQUEST', 'Password must be 6-20 letters/numbers.');
  co.salt = rnd_(16, 'abcdef0123456789'); co.hash = hashPin_(co.salt, pw); saveCo_(co);
  C_().remove('fail_' + co.id + '_ADMIN'); audit_(co.id, 'OWNER', 'ADMIN_PASSWORD_RESET', 'Completed');
  return { company_id: co.id, admin_name: co.adminName, password: pw };
}
function adminChangePassword_(req) {
  var x = ctx_(req, ['ADMIN']), co = x.co, fk = 'fail_' + co.id + '_ADMIN', fails;
  try { fails = lockCheck_(fk); } catch (e) { throw fail_('PASSWORD_LOCKED', e.message); }
  if (!safeEq_(hashPin_(co.salt, str_(req.old_pin)), co.hash)) { C_().put(fk, String(fails + 1), 900); audit_(co.id, 'ADMIN', 'PASSWORD_CHANGE_FAILED', 'Failed - wrong current password'); throw fail_('PASSWORD_BAD', 'Incorrect current password.'); }
  var np = str_(req.new_pin); if (!validPin_(np, 6)) throw fail_('BAD_REQUEST', 'New password must be 6-20 letters/numbers.');
  C_().remove(fk); co.salt = rnd_(16, 'abcdef0123456789'); co.hash = hashPin_(co.salt, np); saveCo_(co); audit_(co.id, 'ADMIN', 'PASSWORD_CHANGE', 'Completed');
  return { ok: true };
}
function ownerDetail_(req) {
  ctx_(req, ['OWNER']); var co = loadCo_(req.company_id); if (!co) throw fail_('NO_COMPANY', 'Company not found.');
  var users = 0, last = '', err = '';
  try { users = Math.max(0, lastRow_(co, 'Employees') - 1); var d = rd_(co, 'Attendance!B:B'); last = d.length > 1 ? String(d[d.length - 1][0]) : ''; } catch (e) { err = e.message; }
  return { company: coPublic_(co), users: users, last_attendance_date: last, storage_error: err };
}
