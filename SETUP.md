# One-time owner setup (you do this once; customers do nothing)

Customers (company owners, managers, employees) never touch Google. They install the APK, register in the app and use it.
All data is stored centrally in the product owner's Google account, separated per company (own sheet + own folders for each company).
You need: one Google account for the product, a GitHub repo, and about 20 minutes. No Google Cloud project, no OAuth, no "test users".

## A. Backend (Apps Script)
1. Sign in to the owner Google account. https://script.google.com -> open your project (or **New project**, name `Field Attendance Central`).
2. Replace everything in `Code.gs` with `apps-script/Code.gs` from this project. Save.
3. **Project Settings (gear) -> Script properties**:
   - Add `OWNER_PASSWORD` = a long password only you know (your owner sign-in in the app).
   - Optional `TRIAL_DAYS` = 14.
   - If you used the earlier Google-sign-in version: DELETE `CLIENT_ID`, `CLIENT_SECRET`, `ENC_KEY` and every `RT_...` property. They are no longer used. Keep `REGISTRY_ID`.
4. Editor -> choose function `setup` -> **Run** -> approve the permissions (Sheets + Drive of the OWNER account - this is needed once because the script now creates the company sheets/folders). The log says "Setup complete".
5. **Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy** (Execute as **Me**, Who has access **Anyone**). The `/exec` URL stays the same, so the app does not need rebuilding if you already built with it. First time: **Deploy -> New deployment -> Web app**, copy the `/exec` URL.
6. Test: open the `/exec` URL in a private tab. It must say "Field Attendance App backend is running."

## B. Build the app
1. In the GitHub repo upload this project's files (keep the `.github/workflows` folder). Repo **Settings -> Secrets and variables -> Actions -> Variables -> New variable** `SERVER_URL` = the `/exec` URL.
2. Optional repository variables `PRIVACY_URL` and `TERMS_URL` (links to your published privacy policy and terms; see PLAY_STORE_GUIDE.md step 1).
3. **Actions -> Build Android APK -> Run workflow**. Download the APK from Artifacts and install it.

## C. First test (5 minutes)
1. App -> **Register your company** -> fill in the form -> **Register company**. It takes about 10 seconds and shows your **Company ID**.
2. **Open my dashboard**. Employees tab -> add an employee (you get an ID such as E001 and a 6-digit PIN).
3. Sign out. Sign in as the employee with Company ID + E001 + PIN. Check in (camera + GPS), then log out.
4. Sign in as ADMIN again: Location tab shows the position and photo. Reports tab downloads the Excel.
5. In your Google Drive you now have `Field Attendance - <Company> (<Company ID>)` with the sheet, an `Attendance Photos` folder and a `Reports` folder.
6. Owner console: sign-in page -> **Owner sign-in** -> your OWNER_PASSWORD.

## Things to know
- Everything is stored in YOUR Google account. Keep the account secure (2-step verification) and watch its Drive storage (15 GB free). Each photo is roughly 60-100 KB.
- Photos are not public in the app. In the Excel report "View photo" opens the Drive link: the `Attendance Photos` folder is set to "anyone with the link can view" (the file ids cannot be guessed). Other folders and the sheets are private.
- Google Apps Script limits (free account): about 6 minutes per call, about 20,000 URL fetches/day (we use none now), 90 minutes/day of script runtime, and one write at a time. That suits roughly a few hundred employees per day; test with real numbers before selling to larger companies.
- Registration is rate-limited (30 per hour, 150 per 6 hours) so nobody can flood your Drive with fake companies.
- Delete old test companies from the registry sheet and their folders in Drive when you no longer need them.

## D. Google Play
See `PLAY_STORE_GUIDE.md` (step by step), `play-store/LISTING.md` (texts and form answers) and `EARNING_GUIDE.md` (how to charge customers).

## Build notes
The workflow needs Java 21 and Node 22 (already set in `.github/workflows/build-apk.yml`). The app targets Android 16 (API 36).
