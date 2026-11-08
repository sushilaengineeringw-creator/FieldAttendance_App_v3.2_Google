# Publishing Field Attendance on Google Play - step by step

Follow the steps in order. Every box marked **[ ]** is something you tick off. Time needed: about 1 hour of work, plus waiting for Google (testing period and review).

> Rules checked on 8 Nov 2026 (links at the end). Google changes rules often - re-read the Play Console messages before you submit.

## 0. Decide two things first
| Decision | Advice |
|---|---|
| **Account type** | A **personal** account created after 13 Nov 2023 must run a *closed test with at least 12 testers for 14 days* before it can publish ([Google's rule](https://support.google.com/googleplay/android-developer/answer/14151465)). An **organization** account (needs a company legal name and a D-U-N-S number) - the page above applies this testing rule to personal accounts only. If you have a registered company, use the organization account. |
| **App id** | `com.fieldattendance.app` (in `capacitor.config.json`). **It can never be changed after the first upload.** If you want your own domain style (for example `in.yourcompany.fieldattendance`), change it now, before step 4. |

## 1. Make the backend and legal pages ready
- [ ] Backend deployed as in `SETUP.md` (section A) and the `/exec` URL opens with "backend is running".
- [ ] **Privacy policy, terms and delete-account pages** (Play will not accept the app without a public privacy-policy link and a web page for account deletion):
  1. Fill in your company details, either (a) on your PC with Node, from the project folder:
     `node scripts/fill-legal.js "Your Company Pvt Ltd" "support@yourcompany.com" "Full postal address" "Pune"`
     or (b) on GitHub: open each file in `docs/` (`privacy-policy.html`, `terms.html`, `delete-account.html`, `index.html`), click the pencil icon and replace `{{COMPANY_NAME}}`, `{{CONTACT_EMAIL}}`, `{{COMPANY_ADDRESS}}`, `{{JURISDICTION}}` by hand.
  2. Commit the changed files.
  3. Repo **Settings -> Pages -> Build and deployment -> Source: Deploy from a branch -> Branch `main`, folder `/docs` -> Save.**
  4. After a minute your pages are live at `https://<your-github-name>.github.io/<repo-name>/privacy-policy.html` (also `terms.html`, `delete-account.html`). Open each one and read it.
  5. Repo **Settings -> Secrets and variables -> Actions -> Variables**: add `PRIVACY_URL` (the privacy link) and `TERMS_URL` (the terms link). The app then shows both links on the sign-in, register and company screens.
  6. Have the policy and terms read once by a lawyer or your CA - they are templates written for how this app works.
- [ ] Use a **support email** that you read every day (also shown in Play).

## 2. Create the Play developer account
1. Go to https://play.google.com/console and sign in with the Google account you want to own the app **for ever** (not a personal inbox you may lose).
2. Choose personal or organization, pay the one-time registration fee, and complete identity verification (government ID; for an organization also D-U-N-S and a website).
3. Wait for Google's approval email (can take a few days).

## 3. Build the signed bundle (.aab)
1. Create the **upload key** once on your PC (needs Java):
   `keytool -genkeypair -v -keystore release.keystore -alias fa -keyalg RSA -keysize 2048 -validity 10000`
   Write down the passwords. **Back up `release.keystore` in two places (never put it in GitHub).**
2. Turn it into text: `base64 -w0 release.keystore` (on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore"))`).
3. GitHub repo -> **Settings -> Secrets and variables -> Actions -> Secrets**: add `ANDROID_KEYSTORE_BASE64` (the text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= `fa`), `ANDROID_KEY_PASSWORD`.
4. **Actions -> Build Android APK -> Run workflow**, tick **build_aab**, Run. When green, download **Field-Attendance-Build**; it contains `Field-Attendance-<n>.aab` (for Play) and the `.apk` (for your own phone tests).
5. The app targets **Android 16 (API 36)** as Google requires for new apps since 31 Aug 2026 ([source](https://developer.android.com/google/play/requirements/target-sdk)). Each run gets a higher version code automatically, so every upload is accepted.
6. Test the **.apk** on a real phone first: register, add an employee, check in/out, download a report, delete-request and cancel it.

## 4. Create the app in Play Console
1. **Create app**: name `Field Attendance: Selfie + GPS` (30 characters max), default language English (India), **App**, **Free**, accept the declarations.
2. **Dashboard -> Set up your app**. Fill each task using `play-store/LISTING.md` (copy-paste answers are there):
   - [ ] App access - give Google a working demo login (see "Review login" in LISTING.md). **Create the demo company first.**
   - [ ] Ads - **No ads**.
   - [ ] Content rating - answer the questionnaire (answers in LISTING.md).
   - [ ] Target audience - **18 and over**.
   - [ ] Data safety - copy the table from LISTING.md.
   - [ ] Privacy policy - your `privacy-policy.html` link.
   - [ ] Account deletion - the app has in-app deletion; add your `delete-account.html` link.
   - [ ] Government apps / Financial features / Health - **No / None / No**.
   - [ ] Sensitive permissions - the app uses **foreground location only** (no background location), so no special declaration is expected. Camera and Location are explained by the in-app notice shown before the first check-in.
3. **Store listing**: paste the texts from LISTING.md; upload from `play-store/graphics/`: app icon (512x512), feature graphic (1024x500) and the phone screenshots (1080x1920, upload at least 2, 6 recommended).
4. **Store settings**: category **Business**, support email, website (your GitHub Pages home is fine).
5. **App signing**: accept **Play App Signing** when you upload the first bundle. Your `release.keystore` is then only the *upload key*.

## 5. Testing track and going live
1. **Testing -> Internal testing -> Create release** -> upload the `.aab` -> add yourself and a few colleagues' Gmail addresses -> install from the Play link and repeat the phone test.
2. **Personal account:** **Testing -> Closed testing -> Create track**, upload the same bundle, add **at least 12 testers** (friends, staff, customers - they need Gmail and must opt in), and keep them opted in **for 14 days**. Then **Dashboard -> Apply for production**. Organization accounts can go straight to production.
3. **Production -> Create new release** -> same bundle (or a newer one) -> release notes ("First release") -> **Send for review**. Review usually takes from a few hours to several days. Fix anything Google flags and resubmit.
4. After launch: reply to reviews, watch **Android vitals** (crashes), and ship updates by running the workflow again (version code goes up automatically). Bump `version` in `package.json` when you want a new visible version number.

## 6. Things Google may question - and the answers
| Question | Answer |
|---|---|
| Why Location? | Records where an employee marks attendance. Foreground only, only when the employee taps Login/Logout. |
| Why Camera? | A front-camera photo at Login proves who marked attendance. |
| Do you track people in the background? | No. |
| Where do people pay? | Not in the app. The app has no prices, buttons or links for paying. Company subscriptions are arranged separately (see EARNING_GUIDE.md for the policy risk). |
| Can users delete their data? | Yes: in-app for company administrators and a public web page; employees via their employer. |

## Sources
- [Target API level requirement](https://developer.android.com/google/play/requirements/target-sdk) - API 36 for new apps and updates from 31 Aug 2026.
- [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465) - 12 testers, 14 days.
- [Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) - when Play Billing is required.
- [Location permissions policy](https://support.google.com/googleplay/android-developer/answer/9799150) - foreground vs background location.
