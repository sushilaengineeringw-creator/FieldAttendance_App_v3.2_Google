# Play Console answer sheet (copy and paste)

## Store listing
**App name (max 30):** `Field Attendance: Selfie + GPS`

**Short description (max 80):**
`Employee attendance with selfie and GPS location. Reports in Excel.`

**Full description (max 4000):**
```
Field Attendance helps companies with field and site teams know who started work, where, and when - with a photo and a GPS location as proof.

FOR EMPLOYEES
- Sign in with Company ID, Employee ID and PIN
- Login: take a front-camera photo and record your GPS location
- Logout: record your location only (no photo)
- See your own attendance history
- Works for technicians, service engineers, sales teams, site engineers and contract staff

FOR COMPANY ADMINISTRATORS AND MANAGERS
- Register your company inside the app in a minute
- Add employees and managers; the app creates their IDs and PINs
- Live dashboard: present, absent, currently logged in, completed and missed logouts
- Location and photos: see the map location and the login photo of every attendance, with filters by date, employee, department, designation, manager and site
- Set a work site and radius per employee to see who logged in away from site
- Monthly Excel reports: Present/Leave/Weekly-off register with Sundays highlighted, hours worked, and a full location report
- Employee-wise and department-wise reports
- Managers see only their own team

PRIVACY AND CONTROL
- Photo and location are recorded only when the employee taps Login or Logout. The app does not track location in the background.
- Each company's data is kept separate
- Company administrators can delete the company account and all its data from inside the app

Free trial for new companies; ongoing use is subject to a company subscription (see the Terms of Use).
Note: employees need the Company ID from their employer to sign in.
```
**What's new (first release):** `First release.`

**Category:** Business &nbsp;|&nbsp; **Tags:** Business, Productivity &nbsp;|&nbsp; **Contact email:** (your support email) &nbsp;|&nbsp; **Website:** your GitHub Pages home page

**Graphics** (folder `play-store/graphics/`): `app-icon-512.png`, `feature-graphic-1024x500.png`, screenshots `1-sign-in.png`, `3-dashboard.png`, `4-employees.png`, `5-location-photos.png`, `6-reports.png`, `7-employee-home.png` (all 1080x1920; `2-register.png` has typed test values, use it only if you like it).

## App access (review login)
Play reviewers cannot register for you, so give them a ready demo company. **Before submitting**, in the installed app: register a company `Play Review Demo`, add one employee, and note the credentials. Then in Play Console -> App access -> "All or some functionality is restricted" -> add instructions:
```
Admin: Company ID <ID>, User ID ADMIN, Password <password>
Employee: Company ID <ID>, User ID <E001>, PIN <pin>
Employees mark attendance with a front-camera photo and location (allow Camera and Location). The Company tab -> "Delete company account and data" is the account deletion feature. Please do not use it on the demo account.
```
Keep that demo company active (extend it in the Owner console if the trial ends).

## Content rating (IARC questionnaire)
Category: **Utility / Productivity / Other**. Answer **No** to violence, fear, sexual content, language, controlled substances, gambling, user-generated public content and purchases. Where it asks whether the app **shares the user's location with other users**, answer honestly: an employee's location is visible to their employer inside the company. Expected rating: Everyone/3+ (the app is still declared for adults 18+).

## Target audience and content
Target age: **18 and over**. Not designed for children. No ads. Not a news, government, health or finance app.

## Data safety form
Data is processed on our server and **not shared with third parties** (Google hosts it for us as a service provider).

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Location - **Precise location** | Yes | No | App functionality (attendance proof) | Required for attendance |
| Photos and videos - **Photos** | Yes | No | App functionality (login photo) | Required for login |
| Personal info - **Name** | Yes | No | App functionality, account management | Required |
| Personal info - **Email address** | Yes (administrator, optional) | No | Account management, communications | Optional |
| Personal info - **Phone number** | Yes | No | App functionality, account management | Required |
| Personal info - **User IDs** (employee ID, company ID) | Yes | No | App functionality, account management | Required |
| Personal info - **Address** (company address) | Yes (administrator) | No | Account management | Optional |
| App activity - **Other user-generated content / in-app actions** (login and logout times, status) | Yes | No | App functionality | Required |
| Everything else (financial, health, messages, contacts, files, web history, device IDs, advertising ID) | No | - | - | - |

Security practices: **Data is encrypted in transit: Yes.** **You can request that data be deleted: Yes** (in-app for company administrators + web link `delete-account.html`). Committed to Play Families policy: No. Independent security review: No.

## Permissions declared by the app
`INTERNET`, `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` only. No background location, no storage/media permissions. Camera and location use is explained in the app before the first check-in.

## Declarations
Ads: No &nbsp;|&nbsp; In-app purchases: No (company subscriptions are arranged outside the app - see EARNING_GUIDE.md) &nbsp;|&nbsp; Government app: No &nbsp;|&nbsp; Financial features: None &nbsp;|&nbsp; Health: No &nbsp;|&nbsp; News app: No &nbsp;|&nbsp; COVID-19 app: No.
