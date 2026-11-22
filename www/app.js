'use strict';
/* Field Attendance App - ONE app for three roles (employee / manager / company admin) plus the owner console.
   Talks to the central backend (Google Apps Script). All licence / time / duplicate / permission decisions are made on the server.
   Employee check-in keeps the proven v2.5 engine: GPS starts while the front camera is open, 800 px photo, best-of GPS, idempotent submit. */
const $app = document.getElementById('app'), $nav = document.getElementById('nav');
const showFatal = (m) => { if (!$app.innerHTML.trim()) $app.innerHTML = '<div class="card"><div class="banner bad">App error: ' + String(m).replace(/[<>&]/g, '') + '<br>Please install the latest APK or contact support.</div></div>'; };
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason && e.reason.message || e.reason));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
const serverUrl = () => (store.get('server_url') || window.APP_CONFIG.SERVER_URL).trim();
const APP_VERSION = '3.6';
const cfgUrl = (k) => { const v = String((window.APP_CONFIG && window.APP_CONFIG[k]) || '').trim(); return /^https:\/\//.test(v) ? v : ''; };
const cap = window.Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
// Talks to the native Camera / Geolocation / Browser / Filesystem / Share plugins through the Capacitor bridge that Android injects
// into the page (cap.nativePromise / cap.nativeCallback). This needs no bundler and no extra script files.
const plugin = (name) => {
  if (!isNative || !cap.nativePromise || !cap.nativeCallback) return null;
  return new Proxy({}, { get: (_, m) => {
    if (m === 'then') return undefined;
    if (m === 'watchPosition') return (opts, cb) => Promise.resolve(cap.nativeCallback(name, m, opts || {}, cb));   // resolves to a watch id
    return (opts) => cap.nativePromise(name, m, opts || {});
  } });
};


const S = { token: null, role: null, user: null, company: null, me: null, offset: 0, timer: null, poll: null, tab: 'dash' };

class ApiError extends Error { constructor(m, code, data) { super(m); this.code = code; this.data = data; } }
async function rawCall(action, payload = {}) {
  let res;
  try { res = await fetch(serverUrl(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...payload }) }); }
  catch { throw new ApiError('Cannot reach the server. Check your internet connection. Nothing was recorded.', 'NETWORK'); }
  let data; try { data = await res.json(); } catch { throw new ApiError('Unexpected reply from the server. Check the server address in the app build.', 'BAD_REPLY'); }
  if (data.server_time) S.offset = new Date(data.server_time) - Date.now();
  if (data.ok) return data;
  throw new ApiError(data.message || 'Request failed', data.error, data);
}
function applyLogin(r) { S.expShown = null; S.token = r.token; S.role = r.role; S.user = r.user || null; S.company = r.company || null; }
async function relogin() {
  const co = store.get('co'), id = store.get('uid'), pin = store.get('pin');
  if (!co || !id || !pin) throw new ApiError('Please sign in again.', 'SESSION_EXPIRED');
  const r = id === 'OWNER' ? await rawCall('owner_login', { password: pin }) : await rawCall('login', { company_id: co, id, pin }); applyLogin(r); return r;
}
async function call(action, payload = {}) {
  if (!S.token) await relogin().catch((e) => authFailed(e));
  try { return await rawCall(action, { token: S.token, ...payload }); }
  catch (e) {
    if (e.code === 'SESSION_EXPIRED') { try { await relogin(); return await rawCall(action, { token: S.token, ...payload }); } catch (e2) { return authFailed(e2); } }
    if (/^AUTH_/.test(e.code || '') || (/^LICENCE_/.test(e.code || '') && S.role !== 'ADMIN' && S.role !== 'OWNER')) return authFailed(e);
    throw e;
  }
}
function authFailed(e) { if (e.code === 'NETWORK' || e.code === 'BAD_REPLY') throw e; stopTimers(); store.del('pin'); S.token = null; showLogin(e.message); if (isLicence(e)) expiryPopup(e); throw e; }
const serverNow = () => new Date(Date.now() + S.offset);
const fmtDate = (d) => { const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}`; };
const dur = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return String(Math.floor(m / 60)).padStart(2, '0') + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const todayIST = () => new Date(Date.now() + S.offset).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const g = (id) => document.getElementById(id);
const val = (id) => (g(id) ? g(id).value.trim() : '');
function stopTimers() { clearInterval(S.timer); clearInterval(S.poll); }
function openUrl(url) { const B = plugin('Browser'); if (B) return B.open({ url }); window.open(url, '_blank'); }
function legalLinks() { const a = [['Privacy Policy', cfgUrl('PRIVACY_URL')], ['Terms of Use', cfgUrl('TERMS_URL')]].filter(x => x[1]); return a.length ? `<div class="small" style="text-align:center;margin-top:10px">${a.map(x => `<a href="#" data-u="${esc(x[1])}">${x[0]}</a>`).join(' · ')}</div>` : ''; }
function bindLegal() { $app.querySelectorAll('a[data-u]').forEach(a => { a.onclick = (e) => { e.preventDefault(); openUrl(a.dataset.u); }; }); }
// Link to the provider's plans page. Set PAY_URL in config.js (repository variable PAY_URL). Left empty in Play Store builds: no payment link is shown at all.
const payUrl = (cid) => { const b = cfgUrl('PAY_URL'); if (!b) return ''; try { const u = new URL(b); if (cid) u.searchParams.set('cid', cid); u.hash = 'plans'; return u.toString(); } catch { return b; } };
const payButton = (id) => payUrl() ? `<button id="${id || 'pay'}">Choose a plan and pay</button>` : '';
function bindPay(root, id) { const b = (root || $app).querySelector('#' + (id || 'pay')); if (b) b.onclick = () => openUrl(payUrl(S.company && S.company.id)); }
const isLicence = (e) => /^LICENCE_/.test((e && e.code) || '');
function licenceBlock(e) { return `<div class="card"><div class="banner bad">${esc(e.message)}</div>${S.role === 'ADMIN' ? payButton() : '<div class="small">Please ask your company administrator.</div>'}</div>`; }
// ---------------- v3.5: developer contact, site details, expiry popup ----------------
const adminCtx = () => S.role === 'ADMIN' || (!S.role && store.get('uid') === 'ADMIN');
const DEV = () => { const c = window.APP_CONFIG || {}; return { wa: String(c.DEV_WHATSAPP || '919284358304').replace(/\D/g, ''), mail: String(c.DEV_EMAIL || 'sales.sushilaengineering@gmail.com').trim() }; };
const curLicence = () => (S.me && S.me.company && S.me.company.licence) || (S.company && S.company.licence) || null;
function contactDeveloper(topic) {
  const d = DEV(), l = curLicence() || {}, u = S.user || {};
  const text = `Hello, I need help with the Field Attendance App.\nTopic: ${topic || 'Subscription / support'}\nCompany: ${(S.company && S.company.name) || ''} (${(S.company && S.company.id) || store.get('co') || ''})\nUser: ${u.id || store.get('uid') || ''}\nPlan status: ${l.state || ''}${l.expiry ? ' (expiry ' + l.expiry + ')' : ''}`;
  const m = modal(`<h3 style="margin:0 0 6px">Contact app developer</h3><div class="small">For subscription, renewal, payment help or any support. Sushila Engineering Works, Jalgaon.</div>
    <button id="cd_wa">Chat on WhatsApp</button><a href="mailto:${esc(d.mail)}?subject=${encodeURIComponent('Field Attendance App - support')}&body=${encodeURIComponent(text)}" style="display:block;text-align:center;margin-top:10px"><button class="ghost" type="button" style="margin:0">Email ${esc(d.mail)}</button></a>
    <button class="ghost" id="cd_x">Close</button>`);
  m.querySelector('#cd_wa').onclick = () => openUrl('https://wa.me/' + d.wa + '?text=' + encodeURIComponent(text));
  m.querySelector('#cd_x').onclick = () => m.close();
}
async function siteDetails() {
  const m = modal('<h3 style="margin:0 0 6px">Site details</h3><div id="sd" class="small">Loading…</div><button class="ghost" id="sd_x">Close</button>');
  m.querySelector('#sd_x').onclick = () => m.close();
  const row = (a, b) => `<div class="row"><span>${esc(a)}</span><span>${b}</span></div>`;
  let l = curLicence() || {}, c = S.company || {}, extra = '';
  try {
    if (S.role === 'ADMIN') { const ci = await call('company_info'); l = ci.licence; extra = row('User limit', esc(ci.employee_limit)); }
    else { const me = await call('me'); S.me = me; l = me.company.licence; }
    if (S.role === 'EMPLOYEE') extra += row('Assigned site', esc((S.user && S.user.site) || '—'));
    else if (S.role === 'ADMIN' || S.role === 'MANAGER') {
      let emps = S.emps; if (!emps) { try { emps = (await call('emp_list')).employees; S.emps = emps; } catch { emps = []; } }
      const cnt = {}; emps.forEach(e => { if (e.site) cnt[e.site] = (cnt[e.site] || 0) + 1; });
      const names = Object.keys(cnt).sort(); extra += row('Sites in use', names.length ? names.map(n => esc(n) + ' <span class="small">(' + cnt[n] + ')</span>').join('<br>') : '—');
    }
  } catch (e) { if (!isLicence(e)) { const el = m.querySelector('#sd'); if (el) el.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return; } l = (e.data && e.data.licence) || l; }
  const el = m.querySelector('#sd'); if (!el) return;
  const rl = { ADMIN: 'Company administrator', MANAGER: 'Manager', EMPLOYEE: 'Employee' }[S.role] || '';
  el.innerHTML = row('Company', esc(c.name || '—')) + row('Company ID', esc(c.id || '—')) + row('Your role', esc(rl)) + row('Plan', esc(l.plan || '—')) + row('Status', esc(l.state || '—')) + row('Expiry date', esc(l.expiry || '—')) + row('Days left', l.days_left ?? '—') + extra +
    row('Access', l.valid ? '<b style="color:var(--green)">Allowed</b>' : '<b style="color:var(--red)">Restricted - plan not active</b>') + `<div class="banner ${l.valid ? 'ok' : 'bad'}" style="margin-top:10px">${esc(l.message || '')}</div>`;
}
function quickLinks() {
  const pay = S.role === 'ADMIN' && payUrl() ? '<button id="ql_pay">Buy / renew plan</button>' : '';
  return `<div class="card" style="margin-top:12px"><b>Plan & help</b>${pay}<button class="ghost" id="ql_site">Site details</button><button class="ghost" id="ql_dev">Contact app developer</button></div>`;
}
function bindQuick() {
  if (g('ql_pay')) g('ql_pay').onclick = planDialog;
  if (g('ql_site')) g('ql_site').onclick = siteDetails; if (g('ql_dev')) g('ql_dev').onclick = () => contactDeveloper();
}
// Popup shown when the plan has expired (on app open, on sign-in, or while the app is in use). Access stays restricted by the server until the Owner confirms the payment; then "check again" (or the next refresh) restores it - no reinstall.
function expiryPopup(src, opt) {
  opt = opt || {};
  const lic = (src && src.data && src.data.licence) || (src && src.state ? src : null) || { state: String((src && src.code) || '').replace('LICENCE_', '').toLowerCase(), message: (src && src.message) || 'Your plan is not active.' };
  const key = (lic.state || '') + '|' + (lic.message || '');
  if (!adminCtx()) return;   // v3.6: only the administrator gets the renewal popup; staff see a quiet banner / message instead
  if (document.querySelector('.modal[data-exp]')) return;
  if (!opt.force && S.expShown === key) return;
  const cid = (S.company && S.company.id) || store.get('co') || '', dk = 'exp_' + cid; if (!opt.force && store.get(dk) === todayIST()) return;   // at most once a day
  S.expShown = key; store.set(dk, todayIST());
  const trial = /trial/i.test(lic.message || ''), admin = S.role === 'ADMIN';
  const title = lic.state === 'suspended' ? 'Subscription suspended' : lic.state === 'expired' ? (trial ? 'Your free trial has ended' : 'Your plan has expired') : 'Subscription not active';
  const m = modal(`<h3 style="margin:0 0 6px;color:var(--red)">${esc(title)}</h3><div class="banner bad">${esc(lic.message || '')}</div>${lic.expiry ? `<div class="row"><span>Expiry date</span><b>${esc(lic.expiry)}</b></div>` : ''}
    <div class="small" style="margin-top:8px">${admin ? 'Renew your plan to switch attendance and reports back on. Your records are kept.' : 'Please ask your company administrator to renew the plan.'}</div>
    ${admin && payUrl() ? '<button id="ex_pay">Renew plan</button>' : ''}<button class="ghost" id="ex_dev">Contact app developer</button>
    ${S.token ? '<button class="ghost" id="ex_chk">I have renewed - check again</button>' : ''}<div id="ex_msg" class="small" style="margin-top:8px"></div><button class="ghost" id="ex_x">Close</button>`);
  m.setAttribute('data-exp', '1');
  const q = (i) => m.querySelector(i);
  if (q('#ex_pay')) q('#ex_pay').onclick = () => { m.close(); planDialog(); };
  q('#ex_dev').onclick = () => contactDeveloper('Plan expired / renewal');
  q('#ex_x').onclick = () => m.close();
  if (q('#ex_chk')) q('#ex_chk').onclick = (ev) => busy(ev.target, 'Checking…', async () => {
    try {
      const ok = await licenceNowValid();
      if (ok) { S.expShown = null; m.close(); toast('Your plan is active. Access is restored.'); goHome(); } else q('#ex_msg').textContent = 'Still not active. After you pay, the app owner confirms the payment - then tap this button again.';
    } catch (e) { q('#ex_msg').textContent = isLicence(e) ? 'Still not active. After you pay, the app owner confirms the payment - then tap this button again.' : e.message; }
  });
}
async function licenceNowValid() {
  if (S.role === 'ADMIN') return !!(await call('company_info')).licence.valid;
  const me = await call('me'); S.me = me; return !!me.company.licence.valid;
}
// Reminder BEFORE the plan ends: administrator only, at 7 / 3 / 1 days and on the last day, each at most once per day. Staff and managers never get this popup.
function reminderPopup(l) {
  if (!adminCtx() || !l || !l.valid || l.days_left === null || l.days_left > 7 || document.querySelector('.modal')) return;
  const bucket = l.days_left <= 0 ? 0 : l.days_left <= 1 ? 1 : l.days_left <= 3 ? 3 : 7, cid = (S.company && S.company.id) || '', k = 'rem_' + cid, mark = bucket + '|' + todayIST();
  if (store.get(k) === mark) return; store.set(k, mark);
  const m = modal(`<h3 style="margin:0 0 6px">${l.state === 'trial' ? 'Your free trial is ending' : 'Your plan is ending'}</h3><div class="banner warn">${l.days_left <= 0 ? 'Expires today' : 'Expires in ' + l.days_left + ' day' + (l.days_left === 1 ? '' : 's')} (${esc(l.expiry || '')}).</div>
    <div class="small" style="margin-top:8px">Renew now so attendance does not stop. All your records are kept.</div>${payUrl() ? '<button id="rm_pay">Renew plan</button>' : ''}<button class="ghost" id="rm_dev">Contact app developer</button><button class="ghost" id="rm_x">Remind me later</button>`);
  if (m.querySelector('#rm_pay')) m.querySelector('#rm_pay').onclick = () => { m.close(); planDialog(); };
  m.querySelector('#rm_dev').onclick = () => contactDeveloper('Plan renewal'); m.querySelector('#rm_x').onclick = () => m.close();
}
function adminReminders(l) { if (!adminCtx()) return; if (l.valid) { closeExpiryPopup(); reminderPopup(l); } else expiryPopup(l); }
// Buy / renew: the administrator picks a plan, the request is recorded for the developer, then pays outside the app (payment page / UPI). The plan is activated only after the developer has verified the payment.
async function planDialog() {
  const m = modal('<h3 style="margin:0 0 6px">Buy or renew plan</h3><div id="pd" class="small">Loading…</div>');
  const body = (h) => { m.querySelector('#pd').innerHTML = h + '<button class="ghost" id="pd_x">Close</button>'; m.querySelector('#pd_x').onclick = () => m.close(); };
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const show = (rq, note) => {
    body(`${note ? `<div class="banner ok">${esc(note)}</div>` : ''}<div class="card"><div class="row"><span>Reference</span><b>${esc(rq.ref)}</b></div><div class="row"><span>Plan</span><span>${esc(rq.plan)} · ${rq.months} month${rq.months === 1 ? '' : 's'}</span></div><div class="row"><span>Amount to pay</span><b>${inr(rq.amount)}</b></div></div>
      <div class="small">Pay ${inr(rq.amount)} and quote <b>${esc(rq.ref)}</b>. Your plan is activated after the developer has verified the payment - you do not need to do anything else.</div>
      ${payUrl() ? '<button id="pd_pay">Open payment page</button>' : ''}<button class="ghost" id="pd_wa">Send payment details to developer</button><button class="ghost" id="pd_chk">Check status</button><div id="pd_msg" class="small" style="margin-top:8px"></div>`);
    const q = (i) => m.querySelector(i);
    if (q('#pd_pay')) q('#pd_pay').onclick = () => { let u = payUrl(S.company && S.company.id); try { const x = new URL(u); x.searchParams.set('ref', rq.ref); x.searchParams.set('amount', rq.amount); u = x.toString(); } catch {} openUrl(u); };
    q('#pd_wa').onclick = () => contactDeveloper('Payment for request ' + rq.ref + ' - ' + rq.plan + ' ' + rq.months + ' month(s) - Rs ' + rq.amount);
    q('#pd_chk').onclick = (ev) => busy(ev.target, 'Checking…', async () => { try { const ci = await call('company_info'); if (ci.licence.valid && !ci.plan_request) { m.close(); toast('Payment confirmed. Your plan is active until ' + fmtDate(ci.expiry) + '.'); goHome(); } else q('#pd_msg').textContent = ci.plan_request ? 'Waiting for the developer to verify your payment.' : 'No open request.'; } catch (e) { q('#pd_msg').textContent = e.message; } });
  };
  try {
    const ci = await call('company_info'); if (ci.plan_request) return show(ci.plan_request, 'You already have an open request.');
    const plans = ci.plans || {};
    body(`<div class="row"><span>Current plan</span><span>${esc(ci.plan)} · ${esc(ci.licence.state)}</span></div><div class="row"><span>Expiry</span><span>${esc(ci.expiry || '—')}</span></div><div id="pd_err"></div>
      <label>Plan</label><select id="pd_pl">${Object.keys(plans).map(k => `<option value="${esc(k)}">${esc(k)} - up to ${plans[k].limit} users</option>`).join('')}</select><label>Period</label><select id="pd_mo"><option value="1">1 month</option><option value="6">6 months</option><option value="12">12 months</option></select>
      <div id="pd_pr" class="small" style="margin:8px 0"></div><button id="pd_go">Send request</button>`);
    const upd = () => { const p = plans[m.querySelector('#pd_pl').value]; m.querySelector('#pd_pr').textContent = p ? 'Amount: ' + inr(p.price[m.querySelector('#pd_mo').value]) : ''; };
    m.querySelector('#pd_pl').onchange = upd; m.querySelector('#pd_mo').onchange = upd; upd();
    m.querySelector('#pd_go').onclick = (ev) => busy(ev.target, 'Sending…', async () => {
      try { const r = await call('plan_request', { plan: m.querySelector('#pd_pl').value, months: m.querySelector('#pd_mo').value }); show(r.request, r.message); }
      catch (e) { m.querySelector('#pd_err').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
    });
  } catch (e) { body(`<div class="banner bad">${esc(e.message)}</div>`); }
}
function pendingBanner(rq) { return rq ? `<div class="banner warn">Plan request <b>${esc(rq.ref)}</b> (${esc(rq.plan)}, ${rq.months} month${rq.months === 1 ? '' : 's'}, ₹${Number(rq.amount).toLocaleString('en-IN')}) is waiting for payment confirmation.</div>` : ''; }
function closeExpiryPopup() { const x = document.querySelector('.modal[data-exp]'); if (x) x.remove(); S.expShown = null; }
function fmtWhen(t) { const d = new Date(t); return isNaN(d) ? esc(t) : esc(d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })); }
function setHeader(who) { g('who').textContent = who || ''; }
function busy(btn, text, fn) { const old = btn.textContent; btn.disabled = true; btn.textContent = text; return Promise.resolve().then(fn).finally(() => { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; } }); }
function toast(m, bad) { alert((bad ? '' : '') + m); }
function modal(html) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div class="box">' + html + '</div>'; document.body.appendChild(m); m.close = () => m.remove(); m.addEventListener('click', (e) => { if (e.target === m) m.remove(); }); return m; }

// ---------------- sign in / register ----------------
function showLogin(msg) {
  stopTimers(); setHeader(''); $nav.innerHTML = ''; $app.className = '';
  $app.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">Sign in</h2><div class="small">Employees, managers and company administrators</div>
    ${msg ? `<div class="banner bad" style="margin-top:12px">${esc(msg)}</div>` : ''}
    <label>Company ID</label><input id="co" autocapitalize="characters" value="${esc(store.get('co') || '')}">
    <label>User ID <span class="small">(Employee ID, or ADMIN for the company administrator)</span></label><input id="u" autocapitalize="characters" autocomplete="username" value="${esc(store.get('uid') === 'OWNER' ? '' : (store.get('uid') || ''))}">
    <label>PIN / Password</label><input id="p" type="password" autocomplete="current-password">
    <button id="go">Sign in</button><div id="err" class="banner bad hidden" style="margin-top:12px"></div><div style="text-align:center;margin-top:12px"><a href="#" id="fp" class="small">Administrator forgot password?</a></div></div>
    <button class="ghost" id="reg">Register your company</button>
    <div style="text-align:center;margin-top:18px"><a href="#" id="own" class="small">Owner sign-in</a></div>
    ${legalLinks()}<div class="small" style="margin-top:12px;text-align:center">App v${APP_VERSION} · ${isNative ? 'phone app' : 'browser'}</div>`;
  bindLegal(); g('fp').onclick = (e) => { e.preventDefault(); forgotDialog(); }; g('reg').onclick = showRegister; g('own').onclick = (e) => { e.preventDefault(); showOwnerLogin(); };
  g('go').onclick = async () => {
    const b = g('go'), err = g('err'); err.classList.add('hidden');
    const co = val('co').toUpperCase(), id = val('u').toUpperCase(), pin = val('p');
    await busy(b, 'Signing in…', async () => {
      try { const r = await rawCall('login', { company_id: co, id, pin }); applyLogin(r); store.set('co', co); store.set('uid', id); store.set('pin', pin); goHome(); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); if (isLicence(e) && id === 'ADMIN') expiryPopup(e, { force: true }); }
    });
  };
}
function forgotDialog() {
  const m = modal(`<h3 style="margin:0 0 6px">Administrator forgot password</h3><div class="small">Only the company administrator. Enter your Company ID and the mobile number you registered with. The app owner will set a new password and tell you.</div><div id="fp_res"></div>
    <label>Company ID</label><input id="fp_co" autocapitalize="characters" value="${esc(store.get('co') && store.get('co') !== 'OWNER' ? store.get('co') : '')}"><label>Registered mobile number</label><input id="fp_mo" inputmode="tel">
    <button id="fp_go">Send request to owner</button><button class="ghost" id="fp_x">Close</button>`);
  m.querySelector('#fp_x').onclick = () => m.close();
  m.querySelector('#fp_go').onclick = (ev) => busy(ev.target, 'Sending…', async () => {
    const res = m.querySelector('#fp_res');
    try { const r = await rawCall('admin_forgot_request', { company_id: m.querySelector('#fp_co').value.trim().toUpperCase(), mobile: m.querySelector('#fp_mo').value.trim() }); res.innerHTML = `<div class="banner ok">${esc(r.message || 'Request sent.')}</div>`; }
    catch (e) { res.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  });
}
function showRegister(msg) {
  $app.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">Register your company</h2><div class="small">Free 10-day trial for up to 5 staff. No Google account needed. Fill in the details and you can start in a minute.</div>
    ${typeof msg === 'string' && msg ? `<div class="banner bad" style="margin-top:12px">${esc(msg)}</div>` : ''}
    <label>Company name</label><input id="r_co"><label>Administrator name</label><input id="r_nm"><label>Mobile number</label><input id="r_mb" inputmode="tel">
    <label>Email address <span class="small">(optional)</span></label><input id="r_em" type="email"><label>Administrator password (6-20 letters/numbers)</label><input id="r_pw" type="password" autocomplete="new-password">
    <label>Business type</label><select id="r_bt"><option>Service company</option><option>Engineering company</option><option>Field sales</option><option>Solar installation</option><option>Marketing</option><option>Maintenance</option><option>Industrial service</option><option>Other</option></select>
    <label>Number of employees</label><input id="r_n" inputmode="numeric"><label>Address</label><input id="r_ad">
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;color:var(--tx)"><input id="r_ok" type="checkbox" style="width:auto;margin-top:3px"><span>I agree to the Terms of Use and Privacy Policy, and I will tell my employees that their photo and location are recorded when they mark attendance.</span></label>${legalLinks()}
    <button id="r_go">Register company</button><button class="ghost" id="r_bk">Back</button></div>`;
  bindLegal(); g('r_bk').onclick = () => showLogin();
  g('r_go').onclick = () => busy(g('r_go'), 'Creating your company… (about 10 seconds)', async () => {
    const pw = val('r_pw');
    if (!g('r_ok').checked) return showRegister('Please tick the box to agree to the Terms of Use and Privacy Policy.');
    try {
      const r = await rawCall('register_start', { company_name: val('r_co'), admin_name: val('r_nm'), mobile: val('r_mb'), email: val('r_em'), admin_pin: pw, business_type: val('r_bt'), employees: val('r_n'), address: val('r_ad') });
      store.set('co', r.company_id); store.set('uid', 'ADMIN'); registrationDone(r.company_id, pw);
    } catch (e) { showRegister(e.message); }
  });
}
function registrationDone(cid, pw) {
  $app.innerHTML = `<div class="banner ok"><b>✓ Company registered</b></div><div class="card" style="text-align:center"><div class="small">Your Company ID</div><div style="font-size:34px;font-weight:800;color:var(--navy);letter-spacing:2px">${esc(cid)}</div>
    <div class="small" style="margin-top:8px">Write it down and share it with your employees. They need it to sign in. You sign in as User ID <b>ADMIN</b> with the password you chose.</div></div>
    <div id="rerr" class="banner bad hidden"></div><button id="ok">Open my dashboard</button>`;
  g('ok').onclick = () => busy(g('ok'), 'Signing in…', async () => {
    try { const r = await rawCall('login', { company_id: cid, id: 'ADMIN', pin: pw }); applyLogin(r); store.set('co', cid); store.set('uid', 'ADMIN'); store.set('pin', pw); goHome(); }
    catch (e) { showLogin(e.message); }
  });
}

// Collects GPS readings for up to 15 s and keeps the most accurate one. Any accuracy is accepted and recorded.
async function getLocation() {
  const G = plugin('Geolocation');
  if (isNative && !G) throw new Error('GPS component is missing in this app build. Please install the latest APK.');
  const pack = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, loc_age_s: Math.max(0, (Date.now() - p.timestamp) / 1000) });
  const WAIT_MS = 12000, GOOD_M = 25, EARLY_MS = 5000, EARLY_M = 50, t0 = Date.now();
  try {
    if (G) {
      const perm = await G.checkPermissions();
      if (perm.location !== 'granted') { const r = await G.requestPermissions(); if (r.location !== 'granted') throw new Error('Location permission is denied. Enable it in Settings > Apps > Field Attendance > Permissions > Location.'); }
    }
    return await new Promise((resolve, reject) => {
      let best = null, done = false, id = null, timer = null;
      const stop = async () => { try { if (id !== null) { if (G) await G.clearWatch({ id }); else navigator.geolocation.clearWatch(id); } } catch {} };
      const finish = (err) => { if (done) return; done = true; clearTimeout(timer); stop(); best ? resolve(pack(best)) : reject(err || new Error('No GPS fix received')); };
      timer = setTimeout(() => finish(), WAIT_MS); setTimeout(() => { if (!done && best && best.coords.accuracy <= EARLY_M) finish(); }, EARLY_MS);
      const onPos = (pos, err) => {
        if (done) return;
        if (err || !pos) { if (!best) finish(err instanceof Error ? err : new Error((err && err.message) || 'GPS error')); return; }
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (best.coords.accuracy <= GOOD_M || (Date.now() - t0 >= EARLY_MS && best.coords.accuracy <= EARLY_M)) finish();
      };
      const start = G
        ? G.watchPosition({ enableHighAccuracy: true, timeout: WAIT_MS, maximumAge: 0 }, onPos)
        : Promise.resolve(navigator.geolocation.watchPosition((p) => onPos(p), (e) => onPos(null, e), { enableHighAccuracy: true, timeout: WAIT_MS, maximumAge: 0 }));
      start.then((wid) => { id = wid; if (done) stop(); }).catch((e) => finish(e));
    });
  } catch (e) { throw new Error(/denied|permission/i.test(e.message) ? e.message : 'Could not get your location. Turn ON Location (GPS) on your phone and try again. ' + (e.message || '')); }
}
async function takePhoto() {   // returns a data URL (jpeg) or null if cancelled. Live camera only; gallery is never offered.
  const C = plugin('Camera');
  if (isNative && !C) throw new Error('Camera component is missing in this app build. Please install the latest APK.');
  if (C) {
    try {
      const perm = await C.checkPermissions(); if (perm.camera !== 'granted') { const r = await C.requestPermissions({ permissions: ['camera'] }); if (r.camera !== 'granted') throw new Error('Camera permission is denied. Enable it in Settings > Apps > Field Attendance > Permissions.'); }
      const ph = await C.getPhoto({ quality: 60, width: 800, resultType: 'base64', source: 'CAMERA', direction: 'FRONT', correctOrientation: true, saveToGallery: false });
      return 'data:image/' + (ph.format === 'png' ? 'png' : 'jpeg') + ';base64,' + ph.base64String;
    } catch (e) { if (/cancel/i.test(e.message)) return null; throw e; }
  }
  return await new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'user');
    i.onchange = () => { const f = i.files[0]; if (!f) return ok(null); const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); }; i.click(); });
}
// Resize to 800px wide and burn the information band into the picture before upload.
function stamp(dataUrl, lines) {
  return new Promise((ok, no) => {
    const img = new Image(); img.onerror = () => no(new Error('Could not read the photo. Please retake.'));
    img.onload = () => {
      const w = Math.min(800, img.width), h = Math.round(img.height * w / img.width), c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
      const fs = Math.max(Math.round(w / 34), 13), lh = Math.round(fs * 1.35), bh = lh * lines.length + 14;
      x.fillStyle = 'rgba(0,0,0,0.62)'; x.fillRect(0, h - bh, w, bh); x.fillStyle = '#fff'; x.font = fs + 'px sans-serif'; x.textBaseline = 'top';
      lines.forEach((t, i) => x.fillText(t, 10, h - bh + 8 + i * lh));
      ok(c.toDataURL('image/jpeg', 0.6));
    };
    img.src = dataUrl;
  });
}


let flow = null;   // one idempotency key per check-in attempt so retries never create duplicates
// One-time notice before the first check-in (what is recorded and who can see it). Shown before the camera / location permission prompts.
function needNotice(next) {
  if (store.get('notice_ok') === '1') return next();
  const m = modal(`<h3 style="margin:0 0 8px">Before you mark attendance</h3><div style="font-size:15px;line-height:1.5">When you <b>log in</b> for the day the app takes a <b>photo with the front camera</b> and records your <b>GPS location</b>. When you <b>log out</b> it records your <b>location</b> only. This happens only when you tap the button; the app does not track you in the background.<br><br>Your employer (company administrator and your manager) can see the time, place and photo. Your phone will now ask for Camera and Location permission: please choose <b>Allow</b>.</div>
    <button id="nok">I understand</button><button class="ghost" id="nno">Not now</button>`);
  m.querySelector('#nno').onclick = () => m.close(); m.querySelector('#nok').onclick = () => { store.set('notice_ok', '1'); m.close(); next(); };
}
async function startCheckIn() {
  try {
    // Speed: start finding the location NOW, while the person is taking the photo (both happen at the same time).
    const key = flow && flow.key ? flow.key : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const keep = flow && flow.loc && Date.now() - flow.locAt < 120000 ? flow : null;   // retake: reuse a fresh location
    flow = { raw: null, key, loc: keep ? keep.loc : null, locAt: keep ? keep.locAt : 0, busy: null, err: '' };
    const f = flow;
    if (!f.loc) { try { await ensureLocPermission(); acquireLocation(); } catch (e) { f.err = e.message; } }
    const p = await takePhoto();
    if (!p) { if (flow === f) flow = null; return; }
    f.raw = p; renderPreview();
  } catch (e) { alert(e.message); }
}
async function ensureLocPermission() {
  const G = plugin('Geolocation'); if (!G) return;
  const perm = await G.checkPermissions();
  if (perm.location !== 'granted') { const r = await G.requestPermissions(); if (r.location !== 'granted') throw new Error('Location permission is denied. Enable it in Settings > Apps > Field Attendance > Permissions > Location.'); }
}
function acquireLocation() {
  const f = flow; if (!f) return Promise.resolve();
  if (f.busy) return f.busy;
  f.err = ''; f.loc = null; setLocStatus();
  f.busy = getLocation().then((l) => { f.loc = l; f.locAt = Date.now(); }).catch((e) => { f.err = e.message; }).finally(() => { f.busy = null; if (flow === f) setLocStatus(); });
  return f.busy;
}
function setLocStatus() {
  const el = document.getElementById('locst'); if (!el || !flow) return;
  if (flow.busy) el.innerHTML = '📍 Getting your location… (a few seconds)';
  else if (flow.loc) el.innerHTML = `📍 Location ready — accuracy about ${Math.round(flow.loc.accuracy)} m`;
  else el.innerHTML = `<span style="color:#c62828">📍 ${esc(flow.err || 'Location not received.')}</span> <a href="#" id="retryloc">Try again</a>`;
  const r = document.getElementById('retryloc'); if (r) r.onclick = (e) => { e.preventDefault(); acquireLocation(); };
}
function renderPreview(msg) {
  $app.innerHTML = `<div class="card"><h3 style="margin:0">Confirm your photo</h3><img class="thumb" src="${flow.raw}">
    <div id="locst" class="small" style="margin-top:10px;font-size:14px"></div>
    ${msg ? `<div class="banner bad" style="margin-top:12px">${esc(msg)}</div>` : ''}
    <button class="green" id="sub">Submit attendance</button><button class="ghost" id="rt">Retake photo</button><button class="ghost" id="cn">Cancel</button></div>`;
  document.getElementById('cn').onclick = () => { flow = null; goHome(); };
  document.getElementById('rt').onclick = startCheckIn;
  setLocStatus();
  if (!flow.loc && !flow.busy) acquireLocation();
  document.getElementById('sub').onclick = async (ev) => {
    const b = ev.target; b.disabled = true;
    try {
      if (flow.loc && Date.now() - flow.locAt > 180000) flow.loc = null;       // location older than 3 minutes: take a new one
      if (!flow.loc) { b.textContent = 'Getting your location…'; await acquireLocation(); }
      if (!flow.loc) throw new Error(flow.err || 'Location not received. Turn ON Location (GPS) and try again.');
      b.textContent = 'Submitting…'; const loc = flow.loc;
      const e = S.user, now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      const photo = await stamp(flow.raw, [`${e.name} (${e.id})`, `${e.designation || ''}${e.designation && e.site ? ' | ' : ''}${e.site || ''}`, now, `Lat ${loc.lat.toFixed(6)}  Long ${loc.lng.toFixed(6)}  (+/-${Math.round(loc.accuracy)} m)`].filter(Boolean));
      const r = await call('checkin', { ...loc, idem: flow.key, photo: photo.split(',')[1] });
      flow = null; showResult('Attendance recorded', r, photo);
    } catch (er) { const sb = document.getElementById('sub'); if (!sb) return;   // page already replaced (e.g. signed out)
      b.disabled = false; b.textContent = 'Submit attendance'; const m = document.querySelector('#app .banner.bad'); if (m) m.remove(); sb.insertAdjacentHTML('beforebegin', `<div class="banner bad" style="margin-top:12px">${esc(er.message)}</div>`); }
  };
}
async function doCheckOut() {
  if (!confirm('Log out of your attendance session now?')) return;
  const b = document.getElementById('out'); b.disabled = true; b.textContent = 'Getting your location…';
  try {
    const loc = await getLocation(); b.textContent = 'Submitting…';
    const rr = await call('checkout', { ...loc, idem: 'out-' + ((S.me && S.me.open_session && S.me.open_session.ref) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))) });   // one key per session: a retry after a lost reply is recognised, not shown as an error
    if (rr.auto) { alert(rr.message || 'Your session was marked out automatically after 12 hours.'); return goHome(); }
    showResult('Logged out', rr);
  } catch (e) { alert(e.message); b.disabled = false; b.textContent = 'LOG OUT / CHECK OUT'; }
}

function showResult(title, r, img) {
  const s = r.session, out = !!s.out_time, lat = out ? s.out_lat : s.in_lat, lng = out ? s.out_lng : s.in_lng;
  $app.innerHTML = `<div class="banner ok"><b>✓ ${title}</b> — saved to the company attendance sheet.</div>${r.warning ? `<div class="banner warn">${esc(r.warning)}</div>` : ''}
    <div class="card"><div class="row"><span>Reference</span><b>${esc(s.ref)}</b></div><div class="row"><span>Site</span><span>${esc(s.site || '—')}</span></div>
    <div class="row"><span>Check-in</span><span>${fmtDate(s.date)} ${esc(s.in_time)}</span></div>
    ${out ? `<div class="row"><span>Check-out</span><span>${esc(s.out_time)}</span></div><div class="row"><span>Working hours</span><b>${esc(s.duration)}</b></div>` : ''}
    <div class="row"><span>Location</span><a href="${mapLink(lat, lng)}" target="_blank" rel="noopener">${lat.toFixed(5)}, ${lng.toFixed(5)}</a></div>
    <div class="row"><span>GPS accuracy</span><span>about ${Math.round(Number(out ? s.out_acc : s.in_acc) || 0)} m</span></div>${img ? `<img class="thumb" src="${img}">` : ''}</div>
    <button id="ok">Done</button>`;
  g('ok').onclick = goHome;
}
async function showHistory() {
  try {
    const { sessions } = await call('history');
    $app.innerHTML = `<div class="card"><h3 style="margin:0 0 6px">Attendance history</h3>${sessions.map(s => `<div class="hist"><b>${fmtDate(s.date)}</b> &nbsp; IN ${esc(s.in_time)} → ${s.out_time ? 'OUT ' + esc(s.out_time) + ' (' + esc(s.duration) + ')' + (s.auto_out ? ' <span class="chip">Auto mark-out (12 h)</span>' : '') : '<span style="color:#b7791f">not logged out</span>'}<br><span class="small">${esc(s.site || '')} · ${esc(s.ref)}</span></div>`).join('') || '<div class="small">No records yet.</div>'}</div><button class="ghost" id="bk">Back</button>`;
    g('bk').onclick = goHome;
  } catch (e) { toast(e.message); }
}

// ---------------- home routing ----------------
function goHome() {
  stopTimers(); $app.className = '';
  if (S.role === 'EMPLOYEE') return loadEmployee();
  if (S.role === 'OWNER') return showOwner();
  S.tab = 'dash'; showTab('dash');
}
function signOut() { try { if (S.token) rawCall('logout_session', { token: S.token }); } catch {} stopTimers(); store.del('pin'); S.token = null; S.role = null; showLogin(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.role === 'EMPLOYEE' && S.token && !flow) refreshMe(); });

// ---------------- employee home (kept as simple as v2.5) ----------------
async function loadEmployee() {
  try { S.me = await call('me'); } catch (e) { if (e.code === 'NETWORK' || e.code === 'BAD_REPLY') return showOffline(e.message); return; }
  clearInterval(S.poll); S.poll = setInterval(() => { if (!document.hidden) refreshMe(); }, 120000); renderEmployee();   // v3.6: every 2 minutes and never while the app is in the background (fewer calls, less battery / data)
}
async function refreshMe() { try { S.me = await call('me'); if (!flow && S.role === 'EMPLOYEE' && g('hs')) renderEmployee(); } catch {} }
function showOffline(m) { $app.innerHTML = `<div class="card"><div class="banner bad">${esc(m)}</div><button id="rt">Retry</button></div>`; g('rt').onclick = goHome; }
function renderEmployee() {
  const { user: e, company: c, open_session: o, last_session: last } = S.me, l = c.licence; S.user = e;
  setHeader(e.id); $nav.innerHTML = '';
  let action = '', status = '';
  if (o) {
    status = `<div class="banner ok">Checked in at <b>${esc(o.in_time)}</b> — ${esc(o.site || '')}</div><div class="timer" id="tm"></div>`;
    action = `<button class="red big" id="out">LOGOUT</button>`;
  } else if (last && last.out_time) {
    status = `<div class="banner ok">Today: IN ${esc(last.in_time)} → OUT ${esc(last.out_time)}${last.auto_out ? ' (auto mark-out after 12 h)' : ''} · Working hours ${esc(last.duration || '')}</div>`;
    action = `<button class="green big" id="in">LOGIN AGAIN</button>`;
  } else { status = `<div class="banner warn">Attendance not marked today.</div>`; action = `<button class="green big" id="in">LOGIN (MARK ATTENDANCE)</button>`; }
  $app.innerHTML = `<div class="card"><div style="font-size:20px;font-weight:700">${esc(e.name)}</div><div class="small">${esc(c.name)}</div>
    <div class="row"><span>Employee ID</span><b>${esc(e.id)}</b></div><div class="row"><span>Designation</span><span>${esc(e.designation || '—')}</span></div>
    <div class="row"><span>Department</span><span>${esc(e.department || '—')}</span></div><div class="row"><span>Assigned site</span><span>${esc(e.site || '—')}</span></div>
    <div class="row"><span>Today</span><span>${fmtDate(todayIST())}</span></div></div>
    <div class="banner ${l.state === 'trial' ? 'warn' : 'ok'}">${esc(l.message)}</div>${status}${action}
    ${quickLinks()}<button class="ghost" id="hs">Attendance history</button><button class="ghost" id="lo">Sign out</button>
    <div class="small" style="margin-top:12px;text-align:center">Your photo and GPS location are recorded at login, and GPS location at logout, for attendance purposes only.</div>
    <div class="small" style="margin-top:8px;text-align:center">App v${APP_VERSION} · ${isNative ? 'phone app' : 'browser'}</div>`;
  if (o) { const tick = () => { if (g('tm')) g('tm').textContent = dur(serverNow() - new Date(o.in_ts)); }; tick(); clearInterval(S.timer); S.timer = setInterval(tick, 20000); }
  if (g('in')) g('in').onclick = () => needNotice(startCheckIn); if (g('out')) g('out').onclick = doCheckOut;
  g('hs').onclick = showHistory; g('lo').onclick = signOut; bindQuick();
  if (l.valid) closeExpiryPopup();   // staff: the banner above says what is wrong; no popup
  if (o && serverNow() - new Date(o.in_ts) >= 12 * 3600000 && S.autoChk !== o.in_ts) { S.autoChk = o.in_ts; refreshMe(); }   // 12 h passed: the server closes the session when it is read
}

// ---------------- admin / manager shell ----------------
const TABS = [['dash', '📊', 'Dashboard'], ['emps', '👥', 'Employees'], ['loc', '📍', 'Location'], ['rep', '📑', 'Reports'], ['co', '🏢', 'Company']];
function showTab(id) {
  S.tab = id; stopTimers(); $app.className = 'pad'; setHeader((S.role === 'ADMIN' ? 'Admin' : 'Manager') + ' · ' + (S.company ? S.company.id : ''));
  $nav.innerHTML = '<nav>' + TABS.map(([k, ic, nm]) => `<button data-t="${k}" class="${k === id ? 'on' : ''}"><i>${ic}</i>${nm}</button>`).join('') + '</nav>';
  $nav.querySelectorAll('button').forEach(b => { b.onclick = () => showTab(b.dataset.t); });
  $app.innerHTML = '<div class="small" style="text-align:center;padding:30px">Loading…</div>';
  ({ dash: renderDash, emps: renderEmps, loc: renderLoc, rep: renderRep, co: renderCo })[id]().catch((e) => { if (isLicence(e)) { $app.innerHTML = licenceBlock(e) + quickLinks(); bindPay(); bindQuick(); expiryPopup(e); return; } if (e.code !== 'SESSION_EXPIRED') $app.innerHTML = `<div class="banner bad">${esc(e.message)}</div><button id="rt">Retry</button>`; if (g('rt')) g('rt').onclick = () => showTab(id); });
}
function dashList(title, rows, kind) {
  const hm = (t) => esc(String(t || '').slice(0, 5));
  const row = (p) => kind === 'absent'
    ? `<div class="row"><span>${esc(p.name)} <span class="small">${esc(p.id)}${p.department ? ' · ' + esc(p.department) : ''}</span></span></div>`
    : `<div class="row"><span>${esc(p.name)} <span class="small">${esc(p.id)}</span></span><span>${hm(p.in_time)}${p.status === 'DONE' && p.out_time ? ' → ' + hm(p.out_time) : ''} <span class="chip ${p.status === 'IN' ? 'Active' : ''}">${p.status === 'IN' ? 'In' : 'Done'}</span></span></div>`;
  return `<div class="card"><b>${title} (${rows.length})</b>${rows.length ? rows.map(row).join('') : '<div class="small" style="margin-top:6px">Nobody yet.</div>'}</div>`;
}
function drawDash(d) {
  const l = d.licence, st = (n, t) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`, now = new Date();
  const pl = d.present_list || [], al = d.absent_list || [];
  $app.innerHTML = `<div class="small" style="margin-bottom:8px">${esc(S.company.name)} · ${fmtDate(d.today)} · <span style="color:var(--green)">● Live</span> · updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
    ${S.role === 'ADMIN' ? pendingBanner(d.plan_request) : ''}${l.valid ? '' : `<div class="banner bad">${esc(l.message)}</div>`}${l.valid && l.days_left !== null && l.days_left <= 7 ? `<div class="banner warn">${esc(l.message)}</div>` : ''}
    <div class="grid">${st(d.total_employees, 'Total employees')}${st(d.active_employees, 'Active employees')}${st(d.present_today, "Today's present")}${st(d.absent_today, "Today's absent")}
    ${st(d.logged_in_now, 'Currently logged in')}${st(d.completed_checkouts, 'Completed check-outs')}${st(d.missed_checkouts, 'Missed check-outs (earlier days)')}${st(d.month_attendance_days, 'Attendance days this month')}</div>
    <div style="height:14px"></div>${d.present_list ? dashList('Present today', pl, 'present') + dashList('Not marked yet', al, 'absent') : ''}
    ${S.role === 'ADMIN' && (!l.valid || l.state === 'trial' || (l.days_left !== null && l.days_left <= 7)) ? payButton() : ''}${quickLinks()}<button class="ghost" id="rf">Refresh</button>`;
  g('rf').onclick = () => showTab('dash'); bindPay(); bindQuick();
  if (S.role === 'ADMIN') { if (S.hadPending && !d.plan_request && l.valid) toast('Payment confirmed. Your plan is active until ' + fmtDate(l.expiry) + '.'); S.hadPending = !!d.plan_request; }
  adminReminders(l);
}
async function renderDash() {
  drawDash(await call('dashboard'));
  // live: refresh the figures and lists about every 30 seconds while this tab is open and the app is visible
  clearInterval(S.poll);
  S.poll = setInterval(async () => {
    if (document.hidden || S.tab !== 'dash' || document.querySelector('.modal:not([data-exp])')) return;
    try { const d = await call('dashboard'); if (S.tab === 'dash') { const y = window.scrollY; drawDash(d); window.scrollTo(0, y); } } catch (e) { if (e.code === 'SESSION_EXPIRED') clearInterval(S.poll); }
  }, 30000);
}

// ---------- employees ----------
async function renderEmps() {
  const r = await call('emp_list'), admin = S.role === 'ADMIN'; S.emps = r.employees; S.types = r.types; S.statuses = r.statuses;
  const draw = (q) => {
    const list = S.emps.filter(e => !q || (e.name + ' ' + e.id + ' ' + e.department + ' ' + e.designation).toLowerCase().includes(q.toLowerCase()));
    g('el').innerHTML = list.map(e => `<div class="card" data-id="${esc(e.id)}" style="cursor:pointer"><b>${esc(e.name)}</b><span class="chip ${esc(e.status)}">${esc(e.status)}</span>${e.role === 'Manager' ? '<span class="chip">Manager</span>' : ''}
      <div class="small">${esc(e.id)} · ${esc(e.designation || '—')} · ${esc(e.department || '—')}${e.manager ? ' · Mgr ' + esc(e.manager) : ''}${e.site ? ' · ' + esc(e.site) : ''}</div></div>`).join('') || '<div class="small">No employees yet.</div>';
    if (admin) g('el').querySelectorAll('[data-id]').forEach(c => { c.onclick = () => empForm(S.emps.find(e => e.id === c.dataset.id)); });
  };
  $app.innerHTML = `<div class="card"><b>${admin ? 'Employees & managers' : 'My team'}</b> <span class="small">(${S.emps.length})</span>${admin ? '<button id="ae">+ Add employee</button><button class="ghost" id="am">+ Add manager</button>' : ''}<input id="q" placeholder="Search name, ID, department" style="margin-top:12px"></div><div id="el"></div>`;
  g('q').oninput = (e) => draw(e.target.value); draw('');
  if (admin) { g('ae').onclick = () => empForm(null, 'Employee'); g('am').onclick = () => empForm(null, 'Manager'); }
}
function empForm(e, role) {
  const isNew = !e, mgrs = S.emps.filter(x => x.role === 'Manager'), v = (k) => esc(e ? (e[k] ?? '') : '');
  const m = modal(`<h3 style="margin:0 0 4px">${isNew ? 'Add ' + role.toLowerCase() : esc(e.name) + ' <span class="small">' + esc(e.id) + '</span>'}</h3><div id="mres"></div>
    <label>Name</label><input id="f_name" value="${v('name')}"><label>Mobile number</label><input id="f_mobile" inputmode="tel" value="${v('mobile')}">
    <label>Designation</label><input id="f_designation" value="${v('designation')}"><label>Department</label><input id="f_department" value="${v('department')}">
    <label>Employee type</label><select id="f_type"><option value=""></option>${(S.types || []).map(t => `<option ${e && e.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    ${isNew && role === 'Manager' ? '' : `<label>Assigned manager</label><select id="f_manager"><option value="">— none —</option>${mgrs.map(x => `<option value="${esc(x.id)}" ${e && e.manager === x.id ? 'selected' : ''}>${esc(x.name)} (${esc(x.id)})</option>`).join('')}</select>`}
    <label>Assigned site</label><input id="f_site" value="${v('site')}"><div class="grid"><div><label>Site latitude</label><input id="f_lat" inputmode="decimal" value="${v('lat')}"></div><div><label>Site longitude</label><input id="f_lng" inputmode="decimal" value="${v('lng')}"></div></div>
    <label>Geofence radius (m)</label><input id="f_radius" inputmode="numeric" value="${e ? esc(e.radius) : '200'}">
    ${isNew ? '<label>PIN (leave empty to generate)</label><input id="f_pin" inputmode="numeric">' : `<label>Account status</label><select id="f_status">${S.statuses.map(s => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><label>Expiry date</label><input id="f_expiry" type="date" value="${v('expiry')}">`}
    <button id="fs">${isNew ? 'Create' : 'Save changes'}</button>${isNew ? '' : '<button class="ghost" id="fr">Reset PIN</button>'}<button class="ghost" id="fc">Close</button>`);
  const body = () => { const o = {}; ['name', 'mobile', 'designation', 'department', 'type', 'site', 'lat', 'lng', 'radius'].forEach(k => { o[k] = m.querySelector('#f_' + k).value.trim(); }); if (m.querySelector('#f_manager')) o.manager = m.querySelector('#f_manager').value; if (!isNew) { o.status = m.querySelector('#f_status').value; o.expiry = m.querySelector('#f_expiry').value; } else { o.pin = m.querySelector('#f_pin').value.trim(); o.role = role; } return o; };
  const show = (html, cls) => { m.querySelector('#mres').innerHTML = `<div class="banner ${cls}" style="margin-top:10px">${html}</div>`; };
  m.querySelector('#fc').onclick = () => { m.close(); showTab('emps'); };
  m.querySelector('#fs').onclick = (ev) => busy(ev.target, 'Saving…', async () => {
    try {
      if (isNew) { const r = await call('emp_add', body()); show(`Created <b>${esc(r.employee.name)}</b><br>Employee ID: <b>${esc(r.employee.id)}</b><br>PIN: <b>${esc(r.pin)}</b><br><span class="small">Company ID: ${esc(S.company.id)} — share these 3 details with the employee. The PIN is shown only now.</span>`, 'ok'); ev.target.classList.add('hidden'); }
      else { await call('emp_update', { id: e.id, ...body() }); m.close(); showTab('emps'); }
    } catch (er) { show(esc(er.message), 'bad'); }
  });
  if (!isNew) m.querySelector('#fr').onclick = (ev) => { if (!confirm('Reset PIN for ' + e.name + '?')) return; busy(ev.target, 'Resetting…', async () => { try { const r = await call('emp_reset_pin', { id: e.id }); show(`New PIN for <b>${esc(e.id)}</b>: <b>${esc(r.pin)}</b><br><span class="small">Shown only now.</span>`, 'ok'); } catch (er) { show(esc(er.message), 'bad'); } }); };
}

// ---------- location & photos ----------
async function renderLoc() {
  if (!S.emps) { const r = await call('emp_list'); S.emps = r.employees; S.types = r.types; S.statuses = r.statuses; }
  const uniq = (k) => [...new Set(S.emps.map(e => e[k]).filter(Boolean))].sort(), mgrs = S.emps.filter(e => e.role === 'Manager'), t = todayIST();
  const opt = (arr) => '<option value="">All</option>' + arr.map(x => `<option>${esc(x)}</option>`).join('');
  $app.innerHTML = `<div class="card"><b>Location & photos</b><div class="grid"><div><label>From</label><input id="l_from" type="date" value="${t}"></div><div><label>To</label><input id="l_to" type="date" value="${t}"></div></div>
    <label>Employee</label><select id="l_emp"><option value="">All</option>${S.emps.filter(e => e.role !== 'Manager').map(e => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select>
    <div class="grid"><div><label>Department</label><select id="l_dept">${opt(uniq('department'))}</select></div><div><label>Designation</label><select id="l_des">${opt(uniq('designation'))}</select></div>
    <div><label>Manager</label><select id="l_mgr"><option value="">All</option>${mgrs.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></div><div><label>Site</label><select id="l_site">${opt(uniq('site'))}</select></div></div>
    <button id="l_go">Show</button></div><div id="lres"></div>`;
  const run = () => busy(g('l_go'), 'Loading…', async () => {
    try {
      const r = await call('att_list', { from: val('l_from'), to: val('l_to'), emp: val('l_emp'), dept: val('l_dept'), designation: val('l_des'), manager: val('l_mgr'), site: val('l_site') });
      S.locRows = r.rows;
      g('lres').innerHTML = `<div class="small" style="margin:6px 2px">${r.count} record(s)${r.count >= 500 ? ' (latest 500)' : ''}</div>` + r.rows.map((x, i) => `<div class="card"><b>${esc(x.name)}</b> <span class="small">${esc(x.id)} · ${fmtDate(x.date)}</span>
        <div class="row"><span>Login</span><span>${esc(x.in_time)} · ±${Math.round(x.in_acc || 0)} m</span></div>
        <div class="row"><span>Login location</span><a href="${esc(x.in_map)}" target="_blank" rel="noopener">Open map</a></div>
        <div class="row"><span>Logout</span><span>${x.out_time ? esc(x.out_time) + (x.auto_out ? '' : ' · ±' + Math.round(x.out_acc || 0) + ' m') : '<b style="color:#b7791f">NOT LOGGED OUT</b>'}${x.auto_out ? ' <span class="chip">Auto mark-out (12 h)</span>' : ''}</span></div>
        ${x.out_map ? `<div class="row"><span>Logout location</span><a href="${esc(x.out_map)}" target="_blank" rel="noopener">Open map</a></div>` : ''}
        <div class="row"><span>Working hours</span><span>${x.hours === null ? '—' : x.hours + ' h'}</span></div>
        <div class="row"><span>Site</span><span>${esc(x.site || '—')}${x.in_dist !== null && x.in_dist !== '' ? ' · ' + x.in_dist + ' m' : ''} · ${esc(x.in_on || '')}</span></div>
        ${x.photo_id ? `<button class="sm ghost" data-p="${i}">View login photo</button>` : ''}</div>`).join('');
      g('lres').querySelectorAll('[data-p]').forEach(b => { b.onclick = () => showPhoto(S.locRows[+b.dataset.p], b); });
    } catch (e) { g('lres').innerHTML = isLicence(e) ? licenceBlock(e) : `<div class="banner bad">${esc(e.message)}</div>`; bindPay(g('lres')); }
  });
  g('l_go').onclick = run; run();
}
async function showPhoto(row, btn) {
  await busy(btn, 'Loading…', async () => {
    try { const r = await call('photo', { photo_id: row.photo_id }); const m = modal(`<b>${esc(row.name)}</b> <span class="small">${fmtDate(row.date)} ${esc(row.in_time)}</span><img class="thumb" src="${r.image}"><button id="pc">Close</button>`); m.querySelector('#pc').onclick = () => m.close(); }
    catch (e) { if (isLicence(e)) planModal(e); else toast(e.message); }
  });
}
function planModal(e) { const m = modal(licenceBlock(e) + '<button class="ghost" id="pmc">Close</button>'); bindPay(m); m.querySelector('#pmc').onclick = () => m.close(); }

// ---------- reports / Excel ----------
async function saveWorkbook(wb, name) {
  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  const FS = plugin('Filesystem'), SH = plugin('Share');
  if (FS && SH) { const f = await FS.writeFile({ path: name, data: b64, directory: 'CACHE' }); await SH.share({ title: name, url: f.uri, dialogTitle: 'Save or share the Excel report' }); return 'shared'; }
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }   // iPhone / modern browsers: share sheet -> Save to Files, Mail, WhatsApp
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); return 'downloaded';
}
async function makeReport(kind, filter, label, btn) {
  await busy(btn, 'Preparing…', async () => {
    try {
      const rep = await call('report_month', Object.assign({ month: val('m') }, filter || {}));
      rep.generated = new Date(Date.now() + S.offset).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
      if (!rep.employees.length) return toast('No employees match this selection.');
      const wb = FA_Excel.build(XLSX, rep, kind), safe = String(S.company.name).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24);
      await saveWorkbook(wb, `${label}_${rep.month}_${safe}.xlsx`);
    } catch (e) { if (isLicence(e)) planModal(e); else toast(e.message); }
  });
}
async function renderRep() {
  const ci = await call('company_info'); if (!ci.licence.valid) { $app.innerHTML = licenceBlock({ message: ci.licence.message }); bindPay(); return; }   // reports need an active plan: say so up front
  if (!S.emps) { const r = await call('emp_list'); S.emps = r.employees; S.types = r.types; S.statuses = r.statuses; }
  const depts = [...new Set(S.emps.map(e => e.department).filter(Boolean))].sort(), now = todayIST().slice(0, 7);
  $app.innerHTML = `<div class="card"><b>Monthly reports (Excel)</b><div class="small">Sundays are yellow. P = present, L = leave, WO = weekly off, MC = logout missing.</div>
    <label>Month</label><input id="m" type="month" value="${now}">
    <button data-k="pa" data-l="PA">Download Monthly P/L Excel</button><button data-k="hours" data-l="Hours">Download Monthly Hours Excel</button>
    <button data-k="location" data-l="Location">Download Monthly Location Excel</button><button class="green" data-k="all" data-l="Complete_Report">Download Complete Monthly Report</button></div>
    <div class="card"><b>Employee-wise report</b><select id="r_emp" style="margin-top:8px">${S.emps.filter(e => e.role !== 'Manager').map(e => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select><button class="ghost" id="r_e">Download employee report</button></div>
    <div class="card"><b>Department-wise report</b><select id="r_dep" style="margin-top:8px">${depts.map(d => `<option>${esc(d)}</option>`).join('') || '<option value="">(no departments set)</option>'}</select><button class="ghost" id="r_d">Download department report</button></div>`;
  $app.querySelectorAll('button[data-k]').forEach(b => { b.onclick = () => makeReport(b.dataset.k, {}, b.dataset.l, b); });
  g('r_e').onclick = (ev) => makeReport('all', { emp: val('r_emp') }, 'Employee_' + val('r_emp'), ev.target);
  g('r_d').onclick = (ev) => { if (!val('r_dep')) return toast('Set a department on employees first.'); makeReport('all', { dept: val('r_dep') }, 'Department_' + val('r_dep').replace(/\W+/g, '_'), ev.target); };
}

// ---------- company / subscription ----------
function changePasswordDialog() {
  const m = modal(`<h3 style="margin:0">Change my password</h3><div id="mres"></div><label>Current password</label><input id="cp_o" type="password" autocomplete="current-password"><label>New password (6-20 letters/numbers)</label><input id="cp_n" type="password" autocomplete="new-password"><label>Repeat new password</label><input id="cp_r" type="password" autocomplete="new-password"><button id="cp_go">Save new password</button><button class="ghost" id="cp_x">Cancel</button>`);
  m.querySelector('#cp_x').onclick = () => m.close();
  m.querySelector('#cp_go').onclick = (ev) => busy(ev.target, 'Saving…', async () => {
    const o = m.querySelector('#cp_o').value, n = m.querySelector('#cp_n').value, r = m.querySelector('#cp_r').value, bad = (t) => { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(t)}</div>`; };
    if (n !== r) return bad('The two new passwords do not match.');
    try { await call('admin_change_password', { old_pin: o, new_pin: n }); if (store.get('uid') === 'ADMIN') store.set('pin', n); m.close(); toast('Password changed. Use the new password the next time you sign in.'); } catch (e) { bad(e.message); }
  });
}
async function renderCo() {
  const c = await call('company_info'), l = c.licence, admin = S.role === 'ADMIN';
  $app.innerHTML = `<div class="card"><b>${esc(c.name)}</b><div class="row"><span>Company ID</span><b>${esc(c.id)}</b></div><div class="row"><span>Administrator</span><span>${esc(c.admin_name)}</span></div>
    <div class="row"><span>Mobile</span><span>${esc(c.mobile)}</span></div><div class="row"><span>Email</span><span>${esc(c.email)}</span></div><div class="row"><span>Business</span><span>${esc(c.business_type)}</span></div><div class="row"><span>Address</span><span>${esc(c.address)}</span></div>
    </div>
  ${admin ? `<div class="card"><b>Subscription</b><div class="row"><span>Plan</span><span>${esc(c.plan)}</span></div><div class="row"><span>Status</span><span class="chip ${esc(l.state[0].toUpperCase() + l.state.slice(1))}">${esc(l.state)}</span></div>
    <div class="row"><span>Expiry date</span><span>${esc(c.expiry || '—')}</span></div><div class="row"><span>Days left</span><span>${l.days_left ?? '—'}</span></div><div class="row"><span>User limit</span><span>${c.employee_limit}</span></div>
    <div class="banner ${l.valid ? 'ok' : 'bad'}" style="margin-top:10px">${esc(l.message)}</div>${pendingBanner(c.plan_request)}${payUrl() ? '<button id="rq">Buy / renew plan</button>' : ''}</div>
    ` : ''}
  ${admin ? (c.status === 'DeletionRequested' ? `<button class="ghost" id="dc">Cancel deletion request</button>` : `<button class="ghost" id="dr" style="color:var(--red)">Delete company account and data</button>`) : ''}
  ${admin ? '<button class="ghost" id="cp">Change my password</button>' : ''}<button class="ghost" id="so">Sign out</button>${legalLinks()}<div class="small" style="margin-top:12px;text-align:center">App v${APP_VERSION} · ${isNative ? 'phone app' : 'browser'}</div>`;
  g('so').onclick = signOut; bindLegal(); bindPay(); if (admin && g('rq')) g('rq').onclick = planDialog; if (admin && g('cp')) g('cp').onclick = changePasswordDialog;
  if (admin && g('dr')) g('dr').onclick = deleteCompanyDialog;
  if (admin && g('dc')) g('dc').onclick = (ev) => busy(ev.target, 'Please wait…', async () => { try { await call('company_delete_cancel'); renderCo(); } catch (e) { toast(e.message); } });
}

function deleteCompanyDialog() {
  const m = modal(`<h3 style="margin:0;color:var(--red)">Delete company account</h3><div style="font-size:15px;line-height:1.5;margin-top:8px">This switches off attendance for <b>all</b> your employees now. Your company's records and photos are then permanently deleted by the app provider (normally within 30 days). Download the monthly reports you need first. You can cancel until the data is deleted.</div>
    <div id="mres"></div><label>Enter your administrator password to confirm</label><input id="dp" type="password" autocomplete="current-password"><button class="red" id="dgo">Request deletion</button><button class="ghost" id="dno">Cancel</button>`);
  m.querySelector('#dno').onclick = () => m.close();
  m.querySelector('#dgo').onclick = (ev) => busy(ev.target, 'Please wait…', async () => {
    try { await call('company_delete_request', { pin: m.querySelector('#dp').value }); m.close(); toast('Deletion requested. Attendance is now switched off for your company.'); renderCo(); }
    catch (e) { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  });
}

// ---------------- owner console ----------------
function showOwnerLogin(msg) {
  stopTimers(); $nav.innerHTML = ''; setHeader('');
  $app.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">Owner sign-in</h2><div class="small">For the app owner only</div>${msg ? `<div class="banner bad" style="margin-top:12px">${esc(msg)}</div>` : ''}
    <label>Owner password</label><input id="op" type="password"><button id="og">Sign in</button><button class="ghost" id="ob">Back</button></div>`;
  g('ob').onclick = () => showLogin();
  g('og').onclick = (ev) => busy(ev.target, 'Signing in…', async () => { try { const pw = val('op'); const r = await rawCall('owner_login', { password: pw }); applyLogin(r); store.set('co', 'OWNER'); store.set('uid', 'OWNER'); store.set('pin', pw); showOwner(); } catch (e) { showOwnerLogin(e.message); } });
}
async function showOwner() {
  $app.className = ''; setHeader('Owner'); $nav.innerHTML = '';
  try {
    const { companies, plans } = await call('owner_list'); S.cos = companies; S.plans = plans || {};
    const pwn = 0, rqn = 0;   // v3.6.1: the two waiting-counts are loaded AFTER the list is on screen (below), so the Owner screen opens as fast as before
    $app.innerHTML = `<div class="card"><b>Companies</b> <span class="small">(${companies.length})</span><button class="ghost" id="rf">Refresh</button><button id="opl">Plan requests${rqn ? ' (' + rqn + ' waiting)' : ''}</button><button id="opw">Admin password management${pwn ? ' (' + pwn + ' request' + (pwn === 1 ? '' : 's') + ')' : ''}</button></div>` + companies.map(c => `<div class="card" data-c="${esc(c.id)}" style="cursor:pointer"><b>${esc(c.name)}</b><span class="chip ${esc(c.status)}">${esc(c.status)}</span>
      <div class="small">${esc(c.id)} · ${esc(c.plan)} · expires ${esc(c.expiry || '—')} (${c.days_left ?? '—'} d) · limit ${c.employee_limit}</div><div class="small">${esc(c.admin_name)} · ${esc(c.mobile)} · ${esc(c.email)}</div></div>`).join('') + `<button class="ghost" id="ols">Sign out</button>`;
    g('rf').onclick = showOwner; g('ols').onclick = signOut; g('opw').onclick = ownerPasswords; g('opl').onclick = ownerPlans;
    const badge = (id, label, n) => { const el = g(id); if (el && n) el.textContent = label + ' (' + n + (id === 'opl' ? ' waiting' : ' request' + (n === 1 ? '' : 's')) + ')'; };
    call('owner_plan_overview').then(r => badge('opl', 'Plan requests', r.pending_count)).catch(() => {}); call('owner_pw_overview').then(r => badge('opw', 'Admin password management', r.pending_count)).catch(() => {}); $app.querySelectorAll('[data-c]').forEach(d => { d.onclick = () => ownerForm(S.cos.find(c => c.id === d.dataset.c)); });
  } catch (e) { $app.innerHTML = `<div class="banner bad">${esc(e.message)}</div><button class="ghost" id="ols">Sign out</button>`; g('ols').onclick = signOut; }
}
// ---------- owner: plan requests, payment verification, expiring plans (v3.6) ----------
async function ownerPlans() {
  $app.innerHTML = '<div class="small" style="text-align:center;padding:30px">Loading…</div>';
  try {
    const o = await call('owner_plan_overview'), inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
    $app.innerHTML = `<div class="card"><b>Plan requests and expiry</b><div class="small">Activate a plan only after you have seen the money in your bank / UPI. Activation restores the company's access at once.</div><button class="ghost" id="pl_bk">Back</button></div>
      <div class="card"><b>Waiting for payment check (${o.requests.length})</b>${o.requests.map(r => `<div class="hist"><b>${esc(r.company_name)}</b> <span class="small">${esc(r.company_id)}</span><br><span class="small">${esc(r.request.plan)} · ${r.request.months} month(s) · <b>${inr(r.request.amount)}</b> · ref ${esc(r.request.ref)} · asked ${fmtWhen(r.request.time)}<br>${esc(r.admin_name)} · ${esc(r.mobile)}</span>
        <div class="grid"><button class="sm" data-act="${esc(r.company_id)}">Payment received - activate</button><button class="sm ghost" data-rej="${esc(r.company_id)}">Not received - close</button></div></div>`).join('') || '<div class="small" style="margin-top:6px">No open requests.</div>'}</div>
      <div class="card"><b>Expiring in 7 days or expired (${o.expiring.length})</b>${o.expiring.map(r => `<div class="hist"><b>${esc(r.company_name)}</b> <span class="small">${esc(r.company_id)} · ${esc(r.plan)}</span><br><span class="small">${r.days_left < 0 ? 'Expired ' + (-r.days_left) + ' day(s) ago' : r.days_left === 0 ? 'Expires today' : 'Expires in ' + r.days_left + ' day(s)'} (${esc(r.expiry)}) · ${esc(r.admin_name)} · ${esc(r.mobile)}</span></div>`).join('') || '<div class="small" style="margin-top:6px">None.</div>'}</div>
      <div class="card"><b>Recent plan activity</b>${o.history.slice(0, 40).map(h => `<div class="hist"><b>${esc(h.label)}</b><br><span class="small">${fmtWhen(h.time)} · ${esc(h.company_id)} · ${esc(h.detail)}</span></div>`).join('') || '<div class="small">Nothing yet.</div>'}</div>`;
    g('pl_bk').onclick = showOwner;
    $app.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => { const r = o.requests.find(x => x.company_id === b.dataset.act); if (!confirm('Have you seen ' + inr(r.request.amount) + ' from ' + r.company_name + ' in your bank / UPI?\nActivate ' + r.request.plan + ' for ' + r.request.months + ' month(s)?')) return;
      busy(b, 'Activating…', async () => { try { await call('owner_activate', { company_id: r.company_id, plan: r.request.plan, months: r.request.months }); ownerPlans(); } catch (e) { toast(e.message); } }); }; });
    $app.querySelectorAll('[data-rej]').forEach(b => { b.onclick = () => { if (!confirm('Close this request as "payment not received"? The company is told by email.')) return; busy(b, 'Closing…', async () => { try { await call('owner_plan_reject', { company_id: b.dataset.rej }); ownerPlans(); } catch (e) { toast(e.message); } }); }; });
  } catch (e) { $app.innerHTML = `<div class="banner bad">${esc(e.message)}</div><button class="ghost" id="pl_bk">Back</button>`; g('pl_bk').onclick = showOwner; }
}
// ---------- owner: Admin password management (v3.5) ----------
function pwHistoryRows(list) {
  return (list || []).map(h => `<div class="hist"><b>${esc(h.label || h.action)}</b> <span class="chip ${/^Completed/.test(h.status) ? 'Active' : ''}">${esc(h.status || '')}</span><br><span class="small">${fmtWhen(h.time)}${h.company_name ? ' · ' + esc(h.company_name) + (h.admin_name ? ' / ' + esc(h.admin_name) : '') : ''}</span></div>`).join('') || '<div class="small">No password activity yet.</div>';
}
async function ownerPasswords() {
  $app.innerHTML = '<div class="small" style="text-align:center;padding:30px">Loading…</div>';
  try {
    const o = await call('owner_pw_overview'), pend = o.admins.filter(a => a.pending_since);
    $app.innerHTML = `<div class="card"><b>Admin password management</b><div class="small">Set a new password for a company administrator. You never see an existing password - only the new one you set, once.</div><button class="ghost" id="pw_bk">Back</button></div>
      <div class="card"><b>Reset requests (${pend.length})</b>${pend.map(a => `<div class="hist"><b>${esc(a.company_name)}</b> <span class="small">${esc(a.company_id)}</span><br><span class="small">${esc(a.admin_name)} · ${esc(a.mobile)} · asked ${fmtWhen(a.pending_since)}</span>
        <div class="grid"><button class="sm" data-set="${esc(a.company_id)}">Set new password</button><button class="sm ghost" data-rej="${esc(a.company_id)}">Reject</button></div></div>`).join('') || '<div class="small" style="margin-top:6px">No pending requests.</div>'}</div>
      <div class="card"><b>All administrators (${o.admins.length})</b>${o.admins.map(a => `<div class="hist"><b>${esc(a.admin_name)}</b> <span class="small">${esc(a.company_name)} · ${esc(a.company_id)} · ${esc(a.mobile)}</span>${a.pending_since ? ' <span class="chip">Request pending</span>' : ''}<br><span class="small">Last: ${a.last_event ? esc(a.last_event.label) + ' (' + esc(a.last_event.status) + ') ' + fmtWhen(a.last_event.time) : 'no password activity'}</span>
        <div class="grid"><button class="sm" data-set="${esc(a.company_id)}">Set / reset password</button><button class="sm ghost" data-hist="${esc(a.company_id)}">History</button></div></div>`).join('')}</div>
      <div class="card"><b>Recent password activity</b>${pwHistoryRows(o.history.slice(0, 50))}</div>`;
    g('pw_bk').onclick = showOwner;
    const find = (id) => o.admins.find(a => a.company_id === id);
    $app.querySelectorAll('[data-set]').forEach(b => { b.onclick = () => ownerSetPassword(find(b.dataset.set)); });
    $app.querySelectorAll('[data-hist]').forEach(b => { b.onclick = () => { const a = find(b.dataset.hist), m = modal(`<h3 style="margin:0 0 6px">${esc(a.admin_name)} <span class="small">${esc(a.company_name)}</span></h3>${pwHistoryRows(a.history)}<button class="ghost" id="hx">Close</button>`); m.querySelector('#hx').onclick = () => m.close(); }; });
    $app.querySelectorAll('[data-rej]').forEach(b => { b.onclick = () => { if (!confirm('Reject this password reset request?')) return; busy(b, 'Rejecting…', async () => { try { await call('owner_pw_reject', { company_id: b.dataset.rej }); ownerPasswords(); } catch (e) { toast(e.message); } }); }; });
  } catch (e) { $app.innerHTML = `<div class="banner bad">${esc(e.message)}</div><button class="ghost" id="pw_bk">Back</button>`; g('pw_bk').onclick = showOwner; }
}
function ownerSetPassword(a) {
  const m = modal(`<h3 style="margin:0 0 6px">New password for ${esc(a.admin_name)}</h3><div class="small">${esc(a.company_name)} · ${esc(a.company_id)}. The old password stops working. Type a new password (6-20 letters/numbers) or leave empty to generate one.</div><div id="sp_res"></div>
    <label>New password</label><input id="sp_pw" autocomplete="off" placeholder="Leave empty to generate"><button id="sp_go">Set new password</button><button class="ghost" id="sp_x">Close</button>`);
  m.querySelector('#sp_x').onclick = () => { m.close(); ownerPasswords(); };
  m.querySelector('#sp_go').onclick = (ev) => busy(ev.target, 'Saving…', async () => {
    try {
      const pw = m.querySelector('#sp_pw').value.trim(), r = await call('owner_reset_admin', pw ? { company_id: a.company_id, password: pw } : { company_id: a.company_id });
      m.querySelector('#sp_res').innerHTML = `<div class="banner ok"><b>New password for ${esc(r.admin_name)}</b><div style="font-size:26px;font-weight:800;letter-spacing:2px;margin:8px 0;user-select:all">${esc(r.password)}</div><div class="small">Tell the administrator now. It is not stored anywhere and cannot be shown again. They can change it in Company tab → Change my password.</div></div>`;
      m.querySelector('#sp_go').remove(); m.querySelector('#sp_pw').remove();
    } catch (e) { m.querySelector('#sp_res').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  });
}
function ownerForm(c) {
  const plans = S.plans || {}, inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const m = modal(`<h3 style="margin:0">${esc(c.name)} <span class="small">${esc(c.id)}</span></h3><div id="mres"></div><div id="od" class="small" style="margin-top:8px">Loading usage…</div>
    <div class="card" style="margin:12px 0"><b>Activate a paid plan</b><div class="small">After the payment arrives. Sets Active, the plan, the user limit and the expiry in one step. Renewing adds the months after the current expiry.</div>
    <label>Plan</label><select id="a_pl">${Object.keys(plans).map(k => `<option value="${esc(k)}">${esc(k)} - up to ${plans[k].limit} users</option>`).join('')}</select>
    <label>Period</label><select id="a_mo"><option value="1">1 month</option><option value="6">6 months</option><option value="12">12 months</option></select>
    <div id="a_pr" class="small" style="margin:8px 0"></div><button id="a_go">Activate plan</button></div>
    <div class="card" style="margin:12px 0"><b>Administrator password</b><div class="small">If the company's administrator forgot the password, create a new one here and tell them. They can change it later from Company tab → Change my password.</div><button class="ghost" id="o_rp">Reset administrator password</button></div>
    <b>Manual changes</b><label>Status</label><select id="o_st">${['Trial', 'Active', 'Suspended', 'Expired'].concat(['DeletionRequested', 'Deleted'].filter(x => x === c.status)).map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label>Plan</label><input id="o_pl" value="${esc(c.plan)}" placeholder="Trial / Monthly / Annual / Per-employee"><label>Expiry date</label><input id="o_ex" type="date" value="${esc(c.expiry)}">
    <label>Employee limit</label><input id="o_lm" inputmode="numeric" value="${esc(c.employee_limit)}"><label>Extend by (days)</label><input id="o_xd" inputmode="numeric" placeholder="e.g. 30 or 365">
    <button id="os">Save</button>${c.status === 'DeletionRequested' ? '<button class="red" id="opg">Delete data permanently</button>' : ''}<button class="ghost" id="oc">Close</button>`);
  call('owner_detail', { company_id: c.id }).then(d => { m.querySelector('#od').textContent = `Users: ${d.users} · Last attendance: ${d.last_attendance_date || '—'}${d.storage_error ? ' · Storage problem: ' + d.storage_error : ''}`; }).catch(() => {});
  const upd = () => { const p = plans[m.querySelector('#a_pl').value]; m.querySelector('#a_pr').textContent = p ? 'Amount to collect: ' + inr(p.price[m.querySelector('#a_mo').value]) + ' · user limit ' + p.limit : ''; };
  m.querySelector('#a_pl').onchange = upd; m.querySelector('#a_mo').onchange = upd; upd();
  m.querySelector('#a_go').onclick = (ev) => busy(ev.target, 'Activating…', async () => {
    try { const r = await call('owner_activate', { company_id: c.id, plan: m.querySelector('#a_pl').value, months: m.querySelector('#a_mo').value }); m.close(); toast(`${c.name}: ${r.company.plan} plan active until ${fmtDate(r.company.expiry)}. Amount ${inr(r.price)}.`); showOwner(); }
    catch (e) { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  });
  m.querySelector('#o_rp').onclick = (ev) => { if (!confirm('Reset the administrator password of ' + c.name + ' (' + c.id + ')? The old password stops working.')) return; busy(ev.target, 'Resetting…', async () => {
    try { const r = await call('owner_reset_admin', { company_id: c.id }); m.querySelector('#mres').innerHTML = `<div class="banner ok"><b>New administrator password</b><div style="font-size:26px;font-weight:800;letter-spacing:2px;margin:8px 0;user-select:all">${esc(r.password)}</div><div class="small">Company ID ${esc(r.company_id)} · User ID ADMIN · give this to ${esc(r.admin_name || 'the administrator')}. It is shown only now.</div></div>`; }
    catch (e) { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  }); };
  m.querySelector('#oc').onclick = () => m.close();
  if (m.querySelector('#opg')) m.querySelector('#opg').onclick = (ev) => { const t = prompt('This permanently deletes the company sheet, photos and reports. Type the Company ID ' + c.id + ' to confirm:'); if (!t) return; busy(ev.target, 'Deleting…', async () => { try { await call('owner_purge', { company_id: c.id, confirm: t }); m.close(); showOwner(); } catch (e) { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; } }); };
  m.querySelector('#os').onclick = (ev) => busy(ev.target, 'Saving…', async () => {
    const p = { company_id: c.id, plan: m.querySelector('#o_pl').value.trim(), limit: m.querySelector('#o_lm').value.trim() };
    const st = m.querySelector('#o_st').value; if (st !== c.status) p.status = st;
    const ex = m.querySelector('#o_ex').value, xd = m.querySelector('#o_xd').value.trim(); if (xd) p.extend_days = xd; else if (ex) p.expiry = ex;
    try { await call('owner_update', p); m.close(); showOwner(); } catch (e) { m.querySelector('#mres').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  });
}

// ---------------- start ----------------
(async function start() {
  const co = store.get('co'), id = store.get('uid'), pin = store.get('pin');
  if (co && id && pin) { try { const r = await relogin(); applyLogin(r); goHome(); } catch (e) { if (e.code === 'NETWORK' || e.code === 'BAD_REPLY') return showOffline(e.message); showLogin(e.message); if (isLicence(e)) expiryPopup(e); } }
  else showLogin();
})();
