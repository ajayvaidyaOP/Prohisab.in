# deposit.in — Deposit & Withdrawal Ledger

A staff/admin ledger with **PIN or password login**, book access permissions, one-day back-date grants, approval/rejection, reversals, dashboards, audit history, and PDF/CSV reports. **Approved deposits − approved withdrawals = net balance**; pending/rejected entries do not change it. Amounts are MySQL `DECIMAL(15,2)` and travel over the API as decimal strings.

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

Admin creates staff using a unique **name and four-digit PIN** (or name + password), adds Books and grants staff access, then can authorize a particular back-date. Staff can only see their assigned active books, own ledger and transactions. Staff submissions wait for admin approval; admin entries post immediately. An admin can reset a staff password/PIN and revoke their sessions. The admin can export individual statements, summary PDFs and filtered multi-reports.

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

## Commands and verification

| Command | Purpose |
|---|---|
| `npm run setup` | Reproducible installs (`npm ci`) for backend and frontend |
| `npm run dev` | Persistent MariaDB WASM demo + Vite; does **not** touch MySQL |
| `npm run db:setup` | Safe MySQL schema deploy + non-destructive seed |
| `npm run db:import-legacy -- --i-have-a-backup` | Opt-in, one-time importer for older Express-only databases |
| `npm run migrate:deploy` | Safe MySQL schema deploy only |
| `npm run seed` | Seed only missing admin/settings/options |
| `npm run test` | API integration tests (MariaDB WASM) + frontend typecheck |
| `npm run typecheck` | Backend and frontend TypeScript checks |
| `npm run build` | Compile backend + build frontend into `frontend/dist` |
| `npm start` | Serve API and built frontend with Node (requires MySQL) |

The integration suite covers session/CSRF/RBAC, PIN and legacy password migration, Books/back-date limits, monetary precision, idempotency, approvals/rejections/races, reversals, PDF/CSV, and importing the earlier Express schema without overwriting existing rows. It runs without a MySQL service; **a real MySQL deployment must still be backed up and tested with your own data**.

API contract, routes, error codes and sample requests: [docs/API.md](docs/API.md).
