# How to earn money from Field Attendance

This is a **business-to-business subscription**: companies pay you monthly or yearly for each employee who uses the app. You already have the tools for it: a 14-day free trial, an expiry date per company, an employee limit, and an Owner screen to switch companies on/off or extend them.

> All rupee figures below are **examples to show the arithmetic**, not market data. Check what competitors in your area charge before you fix your prices.

## 1. The model (recommended)
| Item | Suggestion |
|---|---|
| Who pays | The company (administrator), never the individual employee |
| Free trial | 14 days (already built; change with the script property `TRIAL_DAYS`) |
| Price | **Per active employee per month**, with a **minimum fee per company** (so tiny companies still cover your effort) |
| Plans | Monthly, and **Annual paid in advance** (give 1-2 months free; you get cash up-front and fewer renewals to chase) |
| Employee limit | Set the limit in the Owner screen to the number of employees the company paid for |
| Extras | One-time onboarding/setup fee, custom report formats, training, white-label app for large clients |

**Example:** 40 rupees x 25 employees = 1,000 rupees per company per month. 50 such companies = 50,000 rupees per month. 200 companies = 2,00,000 rupees per month. Your real numbers depend on the price you set and how many companies you can sign.

## 2. How the money reaches you (outside the app - important)
1. The customer registers and uses the 14-day trial.
2. You (or a WhatsApp/phone conversation) agree the plan. You send a **GST invoice** (ask your CA how to register and invoice for software services).
3. The customer pays by **UPI, bank transfer or a payment link** (for example Razorpay or Cashfree payment links - you don't need to write code for this).
4. You open the app -> **Owner sign-in** -> choose the company -> set **Status = Active**, **Plan**, **Employee limit**, and **Extend by 30 / 365 days** -> Save.
5. Before expiry, remind the customer. If they don't pay, the company switches itself off at the expiry date: nobody can mark attendance, but the data is kept, so they come back to renew.

## 3. Google Play rules you must respect
Google's [payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) requires Play's billing for *digital goods and cloud software sold for use inside a Play app*, and says the app itself must not steer people to other payment methods. It lists no special exception for business customers. So:
- **What this app does to stay safe:** the app has **no prices, no buy/upgrade buttons, no payment links and no "pay us elsewhere" text**. The listing only says a company subscription applies after the trial. You sell and invoice outside the app (website, WhatsApp, e-mail, phone, in person).
- **The risk:** Google may decide that your subscription needs Play Billing. I could not find a definite B2B exception in the policy text I read. If Google asks you to change this you have two choices: (a) add Play Billing (Google keeps a service fee; this needs more development, I can build it), or (b) in India, Google's policy page mentions an alternative-billing programme with a reduced service fee - check Play Console for eligibility. Ask Google's policy support early if you want certainty before you sell hard.
- **Never** put "pay on our website" or your bank/UPI details inside the app.

## 4. What it costs you to run
- Google Play developer registration (one-time fee) + optional domain name.
- **Google storage:** all companies' sheets and photos live in *your* Google account. A free account has 15 GB. A photo is about 60-100 KB and only the login has a photo, so 25 employees x 26 days = 650 photos a month, roughly 40-65 MB per company per month. Plan for a paid Google storage/Workspace plan once you pass a few dozen companies. Delete companies that left (the app has the purge button).
- Your time for onboarding and support - this is the real cost. Price for it.
- GST and income tax: ask your CA.

## 5. Know the technical ceiling (be honest with yourself)
The backend runs on Google Apps Script. It is excellent for starting (no server cost) but has limits: one write at a time, limited daily script run-time, slower than a proper database. **My estimate, not measured:** comfortable up to a few hundred active employees per day on a free Google account; more on a paid Google Workspace account. Before you sell to a customer with hundreds of employees, **test with real numbers**. When you reach about 30-50 paying companies, plan the move of storage to a real database (Firebase / Supabase / your own server). The app's screens and the Excel reports stay the same; only the backend changes. I can do that migration when you are ready.

## 6. A simple 90-day plan
| When | Do |
|---|---|
| Week 1-2 | Publish on Play (see PLAY_STORE_GUIDE.md). Prepare a one-page price list, a 5-minute demo and a WhatsApp message |
| Week 2-6 | Sign **5 friendly companies** you already know (service, solar, security, housekeeping, field sales, contractors). Give them the free trial, sit with them for set-up (add employees, set site and radius), ask what is missing |
| Week 6-10 | Convert trials to paid (annual prepaid discount). Collect 3 short testimonials and a Google review. Fix the top 3 requests |
| Week 10-13 | Ask each customer for 2 referrals. Add a simple website page and Play-listing keywords ("attendance", "selfie attendance", "GPS attendance") |

## 7. Protect yourself
- Have a lawyer read the **Terms of Use** and **Privacy Policy** (templates in `docs/`).
- The company, not you, must tell employees about photo/location recording (the register screen makes the administrator confirm this, and employees see a notice before their first login).
- Keep the Owner password long and private; keep a backup of the release keystore; turn on 2-step verification on the Google account that holds the data.
