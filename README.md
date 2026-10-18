# Prohisab.in — Deposit & Withdrawal Ledger

A staff/admin ledger with **PIN or password login**, book access permissions, one-day back-date grants, direct entry posting, Edit/Delete actions, reversals, dashboards, audit history, and PDF/CSV reports. **Deposits − withdrawals = net balance**; both staff and admin entries count immediately. Historical rejected entries remain excluded. Amounts are MySQL `DECIMAL(15,2)` and travel over the API as decimal strings.

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind (`frontend/`) |
| API | Node.js 20.19+, Express 5, TypeScript, Prisma (`backend/`) |
| Production data | MySQL 8; the existing Spring-era `users`, `transactions`, `books`, and related tables are reused, **not dropped** |
| Local demo/tests | MariaDB WASM on the **same SQL schema**, with persistent local demo data (no MySQL/Java/Docker required) |

## Try it locally

```bash
npm run setup       # installs backend + frontend dependencies; Node 20.19+ required
npm run dev         # Express on :4000, Vite on :5173
# Open http://localhost:5173
```

Initial **demo-only** login (unless overridden by `ADMIN_PASSWORD`): `admin` / `Admin@12345`. Change it immediately under Settings. In Arena's embedded HTTPS preview the session uses a secure, partitioned cookie so login works inside the iframe; if your browser still blocks embedded cookies, open the preview in a new tab and sign in there. The demo ledger lives in `backend/.erp-local-db/` (Git-ignored) and survives server restarts; it is **not your MySQL data**. To reset only your demo, stop the server and remove that directory. `npm run dev:backend` starts just the demo API; `npm run dev:frontend` starts just Vite. Vite forwards browser `/api` requests to Express, so cookies remain same-origin. No credentials are stored in browser storage.

Settings intentionally shows only company name/logo and the admin password-change form. Saving company branding preserves the existing currency, time zone, contact details and entry options; the full activity log remains under Audit.

Admin creates staff using a unique **name and four-digit PIN** (or name + password), adds Books and grants staff access, then can authorize a particular back-date. Staff can only see their assigned active books, own ledger and transactions. Both deposits and withdrawals post immediately, with no approval step. An admin can reset a staff password/PIN and revoke their sessions. The admin can export individual statements, summary PDFs and filtered multi-reports.

### Today’s dashboard and navigation

Navigation is available only through the header menu on desktop and mobile; there is no duplicate sidebar or reserved left-hand space. The **business name/logo in the header is a link home** — it opens the Today’s Dashboard for admins and the staff portal for staff — so you can always get back from Entries, Users, Settings or any other screen. The admin dashboard contains one **Today’s Entries** table (with Edit/Delete), four today-only totals, and one PDF export, with a **New Entry** button right in the page header so posting is one tap after login even on phones. On phones and tablets every ledger/report table renders as stacked, labelled entry cards instead of a sideways-scrolling grid; desktop keeps the full table. It uses the server’s business date and refreshes the date/data every minute while open. Book/staff filters apply consistently to the table, full-result totals, pagination and PDF; the dashboard never defaults to all-time balances. Use **View other dates** or the Entries menu for historical reporting, and **Users** for account management. The duplicate date/book summary table, all-user ledger table and separate monthly PDF selector have been removed from the dashboard.

### Staff portal

After login the **New Entry form is the first card** — on phones staff can post a deposit or withdrawal immediately without scrolling past summaries. The all-time summary cards (2×2 on phones) sit below the form, then My History. A single assigned active book is automatically selected for new entries; multiple assigned books remain selectable. My History uses calendar From/To controls with Today and All dates shortcuts. Click Filter to apply a range and see the user's own entries and deposit/withdrawal/net totals for that period. History access does not grant back-date posting permission or access to another user's ledger. Totals cover the full selection; the table shows the latest 500 matching entries, with Time (IST), Book, Staff, Customer ID, Type, Amount, Bank account, Edit status and Edit/Delete actions. Edit status is Original or Edited (persisted separately from the permission window). Entries can be edited/deleted for 1 hour after creation; staff can manage only their own entries. Reversal-linked entries cannot be edited/deleted. Deletion requires confirmation, updates totals immediately and preserves an audit record.

### Individual ledger vs. combined staff report

- **Users → Ledger**: one staff account, closing balance and Edit/Delete corrections.
- **Multi User Report**: compare all staff or a chosen group for the same date range and book. Defaults to today; Today/All dates shortcuts are available. It shows approved collection, withdrawal and period net, staff-wise and book-wise comparisons, then paginated combined history. Pending/rejected counts are separate. Zero-activity and inactive selected staff are included; archived and unassigned books retain their history.
- Click **Show Report** to apply changes. Editing a filter does not silently change the results or PDF. **Download Combined PDF** includes both comparison sections and all matching entries, not just the visible history page. Reports are limited to 10,000 entries; narrow the dates for larger datasets. Period net is not an all-time ledger closing balance.

### PDF downloads use the entry format

Every “download PDF” button — Today’s PDF, Print / Save PDF Report, a user’s Ledger PDF and Download Combined PDF — prints the **same table as the entry list on screen**: Time (IST), Book, Staff, Customer ID, Type, Amount, Bank account, Edit status, in that order, on landscape A4. Amounts keep Indian digit grouping and the configured currency symbol, deposits/withdrawals keep their green/red colour, and a reversed or historically rejected entry is marked inside its Type cell. Above the table each PDF repeats the four on-screen totals (deposit, withdrawal, net, entries) with the applied period and filters, so the download matches exactly what was visible. A single-user statement adds one extra **Balance** column for its running balance, and the combined report still starts with the staff-wise and book-wise comparison pages. The all-users summary PDF stays a per-user totals sheet, as it lists accounts rather than entries.

### Upgrading to direct posting

Run `npm run migrate:deploy` against MySQL before starting this version (back up first). The new migration adds `edited_at`, backfills it from edit audit events, and posts previously pending entries with `TRANSACTION_AUTO_POSTED` audit records. Historical rejected entries stay excluded. Existing deposits, withdrawals and reversal links are retained. The local demo applies this upgrade automatically; legacy imports also post pending entries. The legacy approval fields/endpoints remain for backwards compatibility, not for new-entry workflow.

## Run with an existing or new MySQL database

1. **Back up MySQL before changing stacks.** Stop the old application so two backends cannot write concurrently. Example:
   ```bash
   mkdir -p ~/depositin-backups
   mysqldump --single-transaction -u YOUR_USER -p depositin > ~/depositin-backups/depositin-before-node.sql
   ```
   Keep the backup **outside this repository**. Check that it can be restored before proceeding.
2. `cp backend/.env.example backend/.env`; set `DATABASE_URL` to your **existing** MySQL database and set a stable, private `PIN_PEPPER` of 32+ characters. Never change that pepper after setting staff PINs (doing so requires resetting their PINs). URL-encode special characters in the DB password. For the first new-database setup, optionally set `ADMIN_NAME` / `ADMIN_PASSWORD`; an unset production password is generated once and printed **only at creation time**.
3. Run:
   ```bash
   npm run db:setup     # verify/create schema, apply additive changes, seed missing settings/admin/options
   npm run build        # build API + SPA
   NODE_ENV=production npm start     # API + built frontend, same origin, :4000
   ```
   On a machine without a public HTTPS proxy, set `COOKIE_SECURE=false` for local HTTP testing only. In production use HTTPS with `COOKIE_SECURE=true`; `TRUST_PROXY=true` only behind a trusted reverse proxy. `ALLOWED_ORIGINS` is for a frontend on another domain, not needed for the same-origin build. You may set `DB_SSL=true` / `DB_SSL_REJECT_UNAUTHORIZED=true` for managed MySQL.

`db:setup` creates the baseline **only when no new ledger tables exist**. On an existing complete Spring/Flyway schema it validates the required tables/columns, then only adds `users.pin_digest`, `users.pin_hash`, and the `idempotency_keys` table. It does **not** re-create/drop Spring tables, reset existing users, or clear books/entries. SQL migrations and checksums live in `backend/prisma/migrations/`; `node_schema_migrations` records application. Incomplete/older Spring schemas fail closed with an explanation; take a backup and complete their schema upgrade before retrying. Do not run `prisma migrate dev` against the live Spring schema: use `npm run db:setup` (or `npm run migrate:deploy` for schema only).

Spring BCrypt passwords continue working; earlier Node Argon2 passwords also work. Old plaintext Spring PINs are hashed **on first successful PIN login**. New PINs are BCrypt-hashed with a pepper-keyed lookup digest. Existing sessions remain in the Spring `sessions` table and use the same hashed-cookie format; signing in again is recommended after switching. Startup does not seed production automatically: run `db:setup` first.

### If your database has *only* the old Express/Prisma tables

`db:setup` deliberately stops instead of silently ignoring `AdminUser`, `Account`, and `LedgerEntry`. After verifying your backup, run the **one-time, opt-in** importer:

```bash
npm run db:import-legacy -- --i-have-a-backup
npm run db:setup
```

This copies old logins (Argon2 hashes retained), accounts, opening balances, ledger entries (including pending/rejected entries and reversal links), audit events, business settings and entry options into the new ledger **within a transaction**. Original tables remain untouched as an archive. Duplicate account names gain an account-code suffix because the new login names must be unique. For old account-linked logins, use the imported account name (not the former standalone username) when signing in. Audit references to imported accounts/entries are remapped to their new IDs; the original references remain in the untouched legacy tables. The old supplier/payable side is recorded on its opening entry; the current application presents a unified staff deposit/withdrawal ledger rather than the former customer/supplier split. Existing amounts and direction are retained. Legacy sessions and idempotency tokens intentionally expire; users must log in again. If a value is too long for the new schema, the copy rolls back with an error: correct the source or restore a backup, then retry. **Do not** run this importer on an already migrated Spring database; it refuses a populated new ledger. If Spring already imported the old rows, simply use `npm run db:setup`.

## Security

- **Cookie-only sessions.** The server stores an opaque, hashed session token in an HttpOnly `erp_session` cookie. No token, password or PIN is ever written to `localStorage`, `sessionStorage` or the URL. Cookies are `Secure` + `SameSite=Lax` by default; HTTPS Arena preview hosts get `Partitioned; SameSite=None` because the preview runs inside an iframe, and normal localhost development stays `Lax`.
- **Request forgery protection.** Every write (including login/logout) must carry `X-Requested-With: XMLHttpRequest`; an `Origin`, when present, must match the serving host or an explicitly allowed frontend origin. SameSite cookies, the custom header and the origin check are three independent layers.
- **Brute-force limits.** Sign-in is limited to 10 failed attempts per 15 minutes per IP. Because a 4-digit staff PIN has only 10,000 values, PIN login also shares an app-wide failure window (30 failures / 15 minutes, `429` with `Retry-After`), so rotating IPs cannot enumerate PINs. A correct PIN clears the window. The per-IP limiter is keyed by the real client address only when `TRUST_PROXY=true`; keep the API behind HTTPS.
- **No account discovery through timing.** Unknown and inactive accounts always execute a BCrypt comparison before returning the generic “Invalid name or password” / “Invalid PIN” message.
- **Hashing and authorisation.** Passwords and PINs are BCrypt hashes; PIN lookup uses a pepper-keyed digest (`PIN_PEPPER`, required in production). Roles and ownership are checked server-side on every route: staff can read/edit only their own ledger and entries, only books assigned to them, and only their own account. Admins can manage all accounts. Sessions are revoked on password/PIN reset and on deactivation.
- **Transport and browser hardening.** Helmet sets a strict Content Security Policy (`script-src 'self'`, no objects, same-origin forms/frames, `frame-ancestors` limited to the app and Arena preview), HSTS, `nosniff`, `Referrer-Policy: no-referrer` and a deny-all `Permissions-Policy`. API errors never return stack traces or database details; full errors are logged server-side with a request ID.
- **Auditability.** Logins, failed logins, account changes, entries, edits, deletions, reversals and PIN/password resets are recorded in the audit log.

## Commands and verification

| Command | Purpose |
|---|---|
| `npm run setup` | Reproducible installs (`npm ci`) for backend and frontend |
| `npm run dev` | Persistent MariaDB WASM demo + Vite; does **not** touch MySQL |
| `npm run db:setup` | Safe MySQL schema deploy + non-destructive seed |
| `npm run db:import-legacy -- --i-have-a-backup` | Opt-in, one-time importer for older Express-only databases |
| `npm run migrate:deploy` | Safe MySQL schema deploy only |
| `npm run seed` | Seed only missing admin/settings/options |
| `npm run test` | API integration tests (MariaDB WASM) + frontend interaction tests + typecheck |
| `npm run typecheck` | Backend and frontend TypeScript checks |
| `npm run build` | Compile backend + build frontend into `frontend/dist` |
| `npm start` | Serve API and built frontend with Node (requires MySQL) |

Frontend interaction tests cover the shared PIN/book user-creation form, legacy create-link redirect, edit-page preservation, header navigation, Escape/outside-click dismissal, staff navigation restrictions, and logout. Run them separately with `npm --prefix frontend test`.

The integration suite covers session/CSRF/RBAC, PIN and legacy password migration, Books/back-date limits, monetary precision, idempotency, direct posting, editing/deletion permissions, idempotent retries, reversals, PDF/CSV, and importing the earlier Express schema without overwriting existing rows. It runs without a MySQL service; **a real MySQL deployment must still be backed up and tested with your own data**.

API contract, routes, error codes and sample requests: [docs/API.md](docs/API.md).
