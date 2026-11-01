# Academy ERP — Trading Academy Management System (MVP)

Installable PWA (desktop + Android/iOS "Add to Home Screen") for running an offline/online stock-market academy:
leads & calling, admissions, fee instalments, collections, batches, certificates, expenses, profit distribution, reports, RBAC.

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN IP for phone testing)
npm test           # business-rule tests (fees, payments, profit split, access control, imports…)
npm run build      # production build → dist/ (serve over HTTPS to install as an app)
```

First run: create the Super Admin → **Settings → Fees** → choose the booking policy → optionally **Settings → Backup & demo → Load demo data**.

## Architecture

```
src/domain/      Pure business logic — no UI, no storage. Moves to Supabase Edge Functions / SQL unchanged.
  types.ts         Entities (money = integer paise, dates = IST 'YYYY-MM-DD')
  fees.ts          Schedule generation (7-day rhythm, booking policy), FIFO allocation, instalment status
  finance.ts       Period figures (one accounting definition for dashboard/reports/distribution), profit split
  leads.ts         Calling-queue priority, Excel/CSV validation & de-duplication
  permissions.ts   Role → module → action matrix
src/store/store.ts  Every write: permission check → validation → atomic transaction → audit log → notification.
                    Idempotency keys on admissions/payments; automation keys on reminders/recurring expenses.
src/pages/       14 modules + receipt.   src/ui/  design system, shell, shared modals.   src/lib/  export, PDF, OCR, demo.
```

## Business assumptions (all configurable)

| Topic | Default |
|---|---|
| Booking amount | **No default.** Admissions blocked until admin picks *additional* or *credited* (credited reduces the last instalments). |
| Instalment start | 7 days after admission date (or batch start), then every 7 days. |
| Accounting basis | Cash: net profit = verified collections − reversals − refunds − GST (if set) − approved expenses. Unverified payments never count. |
| Salaries | Expenses (reduce profit). Profit shares (Teacher 35 / Shekhar 32.5 / Sanjeev 32.5) paid only from approved, closed periods; ≤ 0 profit ⇒ no payout. |
| Corrections | Payments: reversal rows. Expenses: logged adjustments. Instalments: override with reason. Nothing is silently overwritten. |
| Identity docs | Consent required; on-device OCR; only type + last-4 masked number + name stored; image discarded. Aadhaar optional. |

## Before production (Supabase phase)

The MVP stores data on the device (IndexedDB) and permission checks run in the browser. That's fine for evaluation but **not secure for multiple staff**. Next steps:
1. Postgres schema mirroring `domain/types.ts`, with `bigint` paise, FKs and unique indexes (phone, payment key, reference).
2. Supabase Auth (OTP/password) replaces "sign in as"; RLS enforces the permission matrix and caller row filtering.
3. Store actions become RPC / Edge Functions run in DB transactions; a cron job runs `runAutomations` server-side.
4. Private storage buckets with signed URLs for receipts and templates; WhatsApp/SMS via an approved provider.

## Supabase (cloud database)

- Schema: `supabase/migrations/0001_init.sql` (22 tables, row-level security; only signed-in **active employees**, matched by login email, can read or write). `src/store/schema.ts` maps app records to columns; `src/store/schema.test.ts` keeps the two in sync.
- Config: `.env.local` holds only the browser-safe values `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put the secret key or an access token in the app.
- First run: the first person to create an account and sign in sets up the academy (or uploads the data already in that browser). Staff sign up later with the email an admin added for them in Employees.
- Sync: every change is saved to Supabase automatically; a copy is cached on the device for offline use and pending changes retry. Without `.env.local` the app runs fully offline on the device, as before.
