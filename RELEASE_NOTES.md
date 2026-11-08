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
