# Field Attendance App v3.6 - test, performance and subscription report

Everything below was produced by running the real `Code.gs` and real `www/` code in this build container. Google services (Sheets, Drive, Cache, Mail) are **simulated** here, and Android devices / real payments / push were **not** available. Items that could not be tested are listed in section 7.

## 1. Test results (all executed, 64 / 64 pass)
| Suite | Pass | Fail | What it covers |
|---|---|---|---|
| backend (real Code.gs) | 36 | 0 | login, roles, check-in/out, GPS rules, photos, duplicates, reports, licence/trial, owner functions, password management, 12 h auto mark-out, plan requests, reminders, isolation, role matrix |
| screens (real app in jsdom) | 12 | 0 | sign-in, check-in/out flow, dashboard, owner screens, forgot-password, expiry popup, renewal, reminders, bad network |
| bridge / excel / scripts | 6 / 4 / 6 | 0 | Android bridge, Excel export, build scripts, website |
Not run: real-device tests (section 7).

## 2. Bugs found and fixed
| # | Issue | Root cause | Fix | Severity |
|---|---|---|---|---|
| 1 | Employee home read the attendance sheet twice per open | auto mark-out check and screen each read it | rows read once per request | Medium |
| 2 | Dashboard / report read ~178,000 cells | whole Date column read every time, plus an extra 600-row sweep | Date column read from the end in chunks; sweep only when something needs closing | High (speed) |
| 3 | Location list read 22,000 cells for one day | same | same (now 1,500) | Medium |
| 4 | Extra `getLastRow` calls on every read, 5 inside the check-in lock | helpers each looked it up again | pass the known last row | Medium |
| 5 | Check-out tapped again after a lost reply could show "no open session" although it was saved | new random key per tap | one key per session (found by code review; the screen test passes with the fix, I did not demonstrate it failing before) | Medium |
| 6 | Renewal popup went to every employee at login | v3.5 design | administrator only, once a day | Requested |
| 7 | Stale "ADMIN" id from an earlier sign-in could trigger the admin popup for a staff login | popup read the stored id | uses the id typed at sign-in | Low (caught by new test) |
No crash, data-loss or cross-company leak was found in this build.

## 3. Performance - before (v3.5) and after (v3.6)
Measured on one company with 6,000 attendance rows and 40 staff; numbers are Google service calls per request (these decide real speed: each Sheets call is a network round trip). The first two numbers are "cold / warm" cache.
| Action | Reads | getLastRow | Cells read |
|---|---|---|---|
| Employee home | 4/2 -> 3/1 | 6/4 -> 3/1 | 31,982/31,200 -> 16,382/15,600 |
| Check-in | 4/2 -> 4/2 | 7/5 -> 4/2 | 31,982 -> 31,982 |
| Check-out | 3/1 -> 3/1 | 4/2 -> 3/1 | 16,382 -> 16,382 |
| Admin dashboard | 5/4 -> 4/2 | 6/5 -> 3/1 | 178,437 -> 39,774 |
| Location list (today) | 5/4 -> 4/2 | 6/5 -> 3/1 | 22,437 -> 2,334 |
| Monthly report | 5/4 -> 4/2 | 6/5 -> 3/1 | 178,437 -> 39,774 |
| Staff list | 2/1 -> 2/0 | 2/1 -> 2/0 | 782 -> 782 / 0 |
Raw files: `tests/bench/ops.js` (re-run with `TABLE=1 node tests/bench/ops.js 6000 40`).
**What this means:** roughly 40-80 % fewer calls and 75-90 % fewer cells on the dashboard, reports and today's list. I did not measure real seconds on Google, so I cannot state the new load time; expect the 2-4 s dashboard to drop noticeably, but verify on your phone. Android battery / memory / CPU were not measured; the only app change is fewer background refreshes (employee screen every 2 min, none in background).

## 4. Load test - 100 companies, 1,000 users (`tests/bench/load.js`)
Run: 100 companies x 10 staff, 300 history rows each; 1,000 check-ins, 1,000 home loads, 1,000 check-outs, 200 dashboards, 100 location lists, 100 staff lists, 50 reports = 3,450 operations in shuffled order, executed one after another by one process.
- Errors: 0. Sessions written: 1,000 of 1,000 expected. Memory after: 185 MB.
- **Isolation: 0 cross-company leaks** across dashboards, lists, rows, staff-token-on-admin-call, and a foreign company id in a request.
- Per operation (CPU only, in ms, p50 / p95): check-in 1.1 / 1.8, home 0.5 / 0.8, dashboard 1.4 / 2.0, check-out 0.5 / 0.6, report 4.4 / 6.7. These are our code's CPU time only.
**Not measured and therefore not claimed:** real Google latency, Google's limit of about 30 parallel executions, true simultaneous users, Drive photo-upload speed, or the Sheets daily quotas. Known bottleneck by design: all writes share one script lock, so check-ins from all companies are processed one at a time; each holds the lock for about 4 Google calls. With 1,000 staff checking in within a minute, queueing is likely. To measure it for real, create test companies and run `node tests/bench/live-load.js <your web-app URL> creds.json 20` (script verified against a local stand-in only).

## 5. Subscription, payment, notification tests (executed)
| Scenario | Result |
|---|---|
| Only the administrator can request a plan (employee, manager refused) | pass |
| One open request; owner sees it; asking never changes the plan | pass |
| Payment not received -> owner closes request, administrator e-mailed, plan unchanged | pass |
| Owner activates after checking payment -> access restored with no reinstall, e-mail confirmation | pass |
| Expired plan: staff blocked, admin can sign in to renew, data kept | pass |
| Reminders 7/3/1/0 days and after expiry, once each, not on other days | pass |
| Mail outage: no crash, retried next run; company without e-mail handled | pass |
| Renewal resets reminder memory; trigger installed once | pass |
| Screens: admin gets one reminder per day; staff and managers get none; pending notice; "Payment confirmed" notice | pass |
| Owner screen: activate / close request / expiring list | pass |
| Isolation: other company cannot see or change a request | pass |
| Slow network (no double send), offline message, lost reply on check-in and check-out retried without duplicates | pass |
**Payment is not automatic.** A payment gateway (Razorpay etc.) needs your merchant keys and a server to receive its confirmation; Apps Script cannot verify the gateway's signature header. So the plan is activated only when you verify the money and tap Activate. Nothing marks a payment as paid by itself and no dummy payment exists.

## 6. Files changed and why
- `apps-script/Code.gs` - speed changes (row reuse, chunked date search, staff-list cache, fewer calls), plan request / owner plan overview / reject, e-mails, daily reminder job.
- `www/app.js` - admin-only popups, reminder logic, buy/renew dialog, pending/confirmed notices, Owner "Plan requests" screen, check-out retry key, refresh interval.
- `tests/*` - new tests (28 added since v3.4), mock counters, `tests/bench/{ops,load,live-load,shim}.js`.
- `package.json`, `README.md`, `RELEASE_NOTES.md`, `SETUP.md` - version and setup steps.

## 7. Not done / needs production infrastructure
1. Real Android device tests (GPS, camera, slow mobile data, battery, memory) and a signed build - not possible here; build with GitHub Actions and test on 2-3 phones.
2. Load test against live Google Apps Script (section 4).
3. Automatic payment verification - needs a payment-gateway account.
4. Push notifications while the app is closed - needs a Firebase project and an extra Android permission; e-mail is provided instead.
5. "Authorised manager" - there is no per-manager permission in the data today, so only the administrator can buy/renew; managers see the plain banner.
6. Git: this container has no GitHub login. A local backup branch `backup/v3.5-stable` and work branch `v3.6-dev` exist inside the delivered zip's history only; upload the files and make your own commit/branch on GitHub (see message).
