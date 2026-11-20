## 3.6.0 - faster reads, plan requests, expiry reminders
- Speed (fewer Google calls per request, measured in REPORT_v3.6.md): employee home/history read the sheet once (was twice), dashboard and monthly report read about 39,000 cells (was 178,000), location list 1,500 (was 22,000), staff list is reused for 30 s, no duplicate getLastRow calls, shorter lock time on check-in. Employee screen refreshes every 2 minutes and not while the app is in the background.
- Subscription: the renewal popup now goes to the administrator only (staff and managers see a plain banner). Administrator reminder popup 7 / 3 / 1 days before and on the last day, at most once a day. "Buy / renew plan" lets the administrator choose a plan and sends a request with a reference; payment is made outside the app; the plan is activated only after the owner has verified the money (owner screen "Plan requests"), or the request is closed as "not received". Administrator sees the pending request and a "Payment confirmed" notice.
- E-mail notifications that work with the app closed: administrator at 7/3/1/0 days and after expiry (once each), payment confirmed / not received, owner summary and new-request alerts. Needs one-time setup (see SETUP.md, "v3.6 notifications"). In-app push notifications need a Firebase project and are not included.
- Fix: a check-out whose reply was lost on a bad network, when tapped again, no longer shows a false "no open session" error (one key per session).
- Tests: 64 pass (backend 36, screens 12, bridge 6, excel 4, scripts 6). New: load/isolation test (tests/bench/load.js), per-request cost bench (tests/bench/ops.js), live-load script for the real deployment (tests/bench/live-load.js).

## 3.5.0 - password management, auto mark-out, plan-expiry popup
- Owner-Admin password management. Administrator login screen: "Administrator forgot password?" sends a request (checked with Company ID + registered mobile, 5 wrong tries lock it for an hour, one open request, 5 a day). Owner screen: "Admin password management" lists requests (Set new password / Reject), all administrators, per-administrator history and recent activity. The Owner sets a typed or generated password (shown once, stored only as salt + hash; existing passwords are never visible). Every request, reset, change and failed change is logged with name, date, time and status in the existing registry Audit sheet (no new tables). Admin changing own password and the normal login are unchanged.
- Automatic mark-out after 12 hours: a session still open 12 hours after check-in is closed at the 12-hour point, no GPS or location permission needed, shown as "Auto mark-out (12 h)" (employee home, history, location list, Excel status "CLOSED (AUTO 12h)"). Manual and location check-out are unchanged. It is recorded the next time the data is read (no timer), with the correct 12-hour time. Forgotten sessions in monthly reports now count as 12 h instead of a missed check-out.
- Home buttons (employee, manager, admin): Purchase plan (administrator only, only when PAY_URL is set, so never in the Play build), Site details (company, plan, status, expiry, access, assigned site / sites in use) and Contact app developer (WhatsApp / email with company details filled in; override with DEV_WHATSAPP / DEV_EMAIL in config.js).
- Plan-expired popup on app open, on sign-in and while the app is in use: says the plan/trial ended, Purchase/Renew (administrator, when PAY_URL set), Contact developer, "I have renewed - check again". Access stays restricted by the server; once the Owner activates the plan, access returns without reinstalling (check-again button or next refresh).
- Backward compatible: backend changes only add fields/actions; v3.3/v3.4 apps keep working with the new Code.gs.
- Tests: all pass (backend 30, plus e2e for the new screens).

## 3.4.0 - live dashboard and password recovery
- Dashboard is now live: lists the names of who is In, who is Done (with in/out times) and who has Not marked yet, and refreshes about every 30 seconds while the tab is open. The existing totals are unchanged.
- Owner screen: "Reset administrator password" creates a new password (shown once) and clears a typo lock-out. Old administrator password stops working at once.
- Company tab: administrators can "Change my password" (current password required).
- Permission messages now say Field Attendance (was VATS Attendance).
- Backward compatible: every backend change only adds fields or actions, so staff still on v3.3 keep working with the new Code.gs; the new screens need the v3.4 app.
- Tests: 48 pass.

## 3.3.0 - self-service selling
- Free trial is now 10 days and limited to 5 staff (managers count).
- One free trial per mobile number: a hashed "Mobile Key" is kept in the registry even after a company is deleted. Registering again with the same number is refused.
- Reports (Excel), attendance lists and photos need an active plan; the app shows a clear "choose a plan" message instead.
- Plan catalogue: Starter 25 / Growth 50 / Business 100 / Enterprise (500) staff, for 1, 6 or 12 months. Owner screen: "Activate a paid plan" sets status, limit and expiry in one step (extends from the current expiry if still running).
- Fix: switching an Inactive/Revoked user back on now respects the plan's staff limit.
- Optional in-app "Choose a plan and pay" button, shown only when the repository variable PAY_URL is set and never in the Play (AAB) build.
- Tests: 45 pass.

## 3.2.0 - Google Play ready
- Build upgraded to Capacitor 8: targets Android 16 (API 36), required by Google Play for new apps and updates since 31 Aug 2026. Workflow now uses Java 21. Android cloud backup is switched off (the PIN lives in local storage).
- Account deletion (Play requirement): the company administrator can request deletion in the Company tab (password re-checked); attendance switches off at once, can be cancelled, and the owner permanently deletes the sheet + folders from the Owner screen. Public page `docs/delete-account.html`.
- Privacy policy, terms and delete-account pages (`docs/`, publish with GitHub Pages) with a fill-in script; in-app Privacy / Terms links (repository variables PRIVACY_URL, TERMS_URL); consent tick-box when registering; one-time notice about photo + location before the first employee login.
- Removed the "contact the provider to renew" wording from the app (no payment steering inside the app).
- Fix: the From/To date fields overflowed the card on narrow phones.
- New icon and splash (generic location-pin with check mark; the old icon carried a "V").
- Play Store pack: `PLAY_STORE_GUIDE.md`, `play-store/LISTING.md` (texts, data-safety and content-rating answers, review login), `play-store/graphics/` (icon, feature graphic, 6 screenshots), `EARNING_GUIDE.md`.
- Tests: 36 pass (adds deletion flow, patch/permission checks, config and legal-page checks).

## 3.1.0 - no Google sign-in for customers
- Company registration is now one step inside the app (company details + password). Removed the Google sign-in / OAuth flow that blocked registration ("Access blocked", "unable to open the file").
- Data is stored centrally in the product owner's Google account: one spreadsheet and one set of Drive folders per company, separated by company id. No Google Cloud project is needed any more.
- Backend now uses SpreadsheetApp / DriveApp directly (no UrlFetch). Text that Sheets would auto-convert (ISO times, phone numbers, all-digit salts, "=" text) is stored safely as text.
- Registration rate limit: 30 per hour and 150 per 6 hours. Email is optional.
- Removed: Google account fields, "Reconnect Google account". Tests: 29 pass.
- Upgrade: paste the new Code.gs, run setup() once (approve Drive/Sheets), Deploy > Manage deployments > New version, rebuild the APK. See SETUP.md.

## 3.0.0 - Field Attendance App (multi-company)
- New product built around the v2.5 attendance engine (camera + GPS in parallel, 800 px photo, idempotent check-in/out, duplicate pre-check before photo upload, photo upload outside the lock, recent-rows reads).
- Company self-registration with Google sign-in (scope drive.file + email only). Spreadsheet and private photo folders are created in the company admin's own Google account.
- Roles in one APK: Admin, Manager, Employee, plus Owner console (status, plan, expiry, employee limit).
- Employees/managers created inside the app (automatic IDs E001/M001, PINs stored hashed, reset PIN, suspend/deactivate, geofence per employee).
- Admin dashboard, Location & Photos (filters, photos shown only through an authorised call), monthly Excel (P/L/WO/MC, hours, location) built on the phone with Sundays in yellow, shared via the Android share sheet.
- Server-side company isolation, licence checks on every request, 5-failure PIN lock, audit log in the owner registry.
- Not yet: offline queue, holiday calendar, Excel import.

# Release notes

## 2.5.0 - faster check-in
- App: location is found WHILE the camera is open (was: after the photo), so the Submit button is ready at once.
- App: photo is captured at 800 px / 60% quality (smaller upload, no double resize). Location finishes sooner (<=25 m at once, <=50 m after 5 s, max 12 s). Any accuracy is still accepted and recorded.
- Server: photo upload to Drive now happens outside the lock, so 30 technicians can check in at the same time without queueing.
- Server: duplicate / already-checked-in requests are refused before the photo is uploaded; Drive folder id is cached; daily actions read only the newest 600 rows (reports still read everything).
- Version 2.5 - replace www/app.js on GitHub AND paste the new Code.gs in Apps Script (Deploy > Manage deployments > pencil > New version).

## 2.0.0 - Google Sheet edition
* Backend replaced by Google Apps Script + Google Sheet + Google Drive (no hosting cost).
* Sign-in with Employee ID + PIN; Status / Expiry in the Employees tab enforced on every request.
* Check-in: front-camera photo (information band burned in) + GPS; check-out: GPS only. Duplicate-safe.
* Monthly P/A and Location reports generated inside the Sheet (Sundays yellow), downloadable as Excel.
* Tests: 8 backend-logic tests against a mock of Google services (`npm test`).

## 2.1.0
* Fix: camera and GPS now use the native plugins (registerPlugin). Previously the app fell back to browser camera/GPS, which skipped the permission prompts.

## 2.2.0
* No GPS accuracy restriction: best reading within ~15 s is recorded with its accuracy (warning above 100 m). Location is collected while the photo is being reviewed.
* Reports: PA tab now has Total Hours Worked; new Hours tab; Location tab is one row per session with Open map + View photo links.

## 2.3.0
* Fix: "Camera component is missing". The app now calls the native Camera and Geolocation plugins through the Capacitor Android bridge (nativePromise / nativeCallback). window.Capacitor.registerPlugin and Capacitor.Plugins are not available in an un-bundled page, which broke v2.0-2.2.
* Tests: added bridge tests that run the real Capacitor Android bridge against a fake phone (14 tests in total).

## 2.4.0
* Fix: blank screen after install (v2.3 deleted the app's state variable, so the app crashed before drawing the login page). Any future startup error is now shown on screen.
* Fix: signing out after a suspension no longer throws an error from the old photo screen.
* Reports: days without attendance now show L (Leave) instead of A; totals column is Leave (L).
* Tests: added a full end-to-end test (real app.js + real Android bridge + real Code.gs on a mock sheet): login, photo, GPS, submit, logout.
