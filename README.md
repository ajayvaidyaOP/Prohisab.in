# Simple Ledger ERP

A single-admin ledger for a small business. It tracks customers (money they owe you) and suppliers (money you owe them), records credit sales, payments, purchases and adjustments, and keeps a full audit trail. Entries are never edited or deleted. Mistakes are fixed with a reversal entry.

- **Frontend:** React, Vite, TypeScript, Tailwind CSS (`frontend/`)
- **Backend:** Node.js, Express 5, TypeScript (`backend/`)
- **Database:** MySQL, accessed only through Prisma ORM and Prisma migrations
- **Docs:** [API reference](docs/API.md)

---

## Part 1: Windows setup (step by step)

This guide assumes Windows 10 or 11. Use **PowerShell** for every command. Open it from the Start menu, type `PowerShell`, and press Enter.

> The commands below were written for Windows, but they were executed in a Linux sandbox. Please report anything that behaves differently on your PC.

### 1.1 Install the tools

| Tool | Version | Download |
|---|---|---|
| Node.js (LTS) | **20.19 or newer** (22 LTS recommended) | https://nodejs.org |
| MySQL Server | **8.0 or newer** (5.7 also works) | https://dev.mysql.com/downloads/installer/ |
| Git (optional, to download the code) | any | https://git-scm.com |

After installing Node.js, check it in PowerShell:

```powershell
node -v
npm -v
```

Both should print a version number.

### 1.2 Install MySQL and create the database

1. Run the **MySQL Installer**. Choose **Server only** (or "Developer Default"). Keep the default port **3306**.
2. Set a **root password** when asked. Write it down somewhere safe. Do not put it in any project file.
3. Open **MySQL Command Line Client** (or run `mysql -u root -p` in PowerShell, if `mysql.exe` is on your PATH) and enter the root password.
4. Paste the commands below. Replace `CHOOSE_A_STRONG_PASSWORD` with your own password for the app user:

```sql
CREATE DATABASE erp_ledger CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE erp_ledger_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'erp_app'@'localhost' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON erp_ledger.* TO 'erp_app'@'localhost';
GRANT ALL PRIVILEGES ON erp_ledger_test.* TO 'erp_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

If your password contains characters such as `@`, `:`, `/`, `#` or `%`, write them as percent codes in the connection string (`@` becomes `%40`).

> **Error 1419 ("you do not have the SUPER privilege… binary logging")?** MySQL 8 with binary logging on blocks trigger creation for non-admin users. The migrations create database safety triggers. Either run the migration step as the MySQL `root` user (point `DATABASE_URL` at `root` for that one step only), or run this once as root and then retry:
>
> ```sql
> SET GLOBAL log_bin_trust_function_creators = 1;
> ```

### 1.3 Download the project

With Git:

```powershell
cd $HOME\Documents
git clone https://github.com/ajayvaidyaOP/erp-system.git
cd erp-system
```

Or download the ZIP from GitHub, extract it, and open PowerShell inside the `erp-system` folder.

### 1.4 Configure the backend

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
```

In Notepad, edit these lines (keep the quotes):

```
DATABASE_URL="mysql://erp_app:CHOOSE_A_STRONG_PASSWORD@localhost:3306/erp_ledger"
APP_TIMEZONE=Asia/Kolkata
COOKIE_SECURE=false
```

- `COOKIE_SECURE=false` is correct for `http://localhost`. Set it to `true` only when you serve the app over HTTPS.
- Leave `ADMIN_USERNAME` and `ADMIN_PASSWORD` blank. You will be asked for them securely in the next step.
- **Never commit `.env`.** Git already ignores it.

### 1.5 Install packages, create tables, and create the admin account

Still inside `backend`:

```powershell
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run seed
```

What each step does:

1. `npm install` downloads the backend packages.
2. `npm run prisma:generate` builds the database client. **Run this again after any change to `prisma/schema.prisma`.**
3. `npx prisma migrate deploy` creates the tables, indexes and safety triggers in `erp_ledger`.
4. `npm run seed` asks for an administrator username (default `admin`) and a password (at least 10 characters). Typing is hidden. There is no sign-up page, so this is the only way to create the account.

To add clearly labelled demo customers and suppliers for a first look, run `npm run seed -- --demo` instead. Demo names start with `[DEMO]`. You can ignore them or delete them later by deactivating the accounts.

To reset the admin password later:

```powershell
npm run seed -- --reset-password
```

### 1.6 Install and build the frontend

```powershell
cd ..\frontend
npm install
npm run build
```

`npm run build` checks the TypeScript code and creates the optimised website in `frontend\dist`.

### 1.7 Start the app (production mode, one window)

```powershell
cd ..\backend
npm run build
npm start
```

Open **http://localhost:4000** in your browser and sign in with the admin account you created.

The backend serves both the API and the website, so you only run one program. Leave the PowerShell window open while you use the app. Press **Ctrl + C** to stop it.

### 1.8 Development mode (optional, for changing the code)

Use two PowerShell windows:

```powershell
# Window 1: API on port 4000
cd backend
npm run dev
```

```powershell
# Window 2: website on port 5173 (it forwards /api to the API)
cd frontend
npm run dev
```

Open **http://localhost:5173**.

### 1.9 Run the automated tests (optional)

The integration tests use the separate `erp_ledger_test` database, so your business data is never touched. They refuse to run against any database whose name does not contain `test`.

```powershell
cd backend
$env:TEST_DATABASE_URL="mysql://erp_app:CHOOSE_A_STRONG_PASSWORD@localhost:3306/erp_ledger_test"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npx prisma migrate deploy
npm test
```

`npm test` runs 79 tests (unit tests for money, dates and ledger rules, plus end-to-end API workflows).

---

## Part 2: What you can do in the app

| Screen | Purpose |
|---|---|
| **Login** | Sign in as the administrator. Sessions end after 2 hours of inactivity (set by `SESSION_IDLE_MINUTES`). |
| **Dashboard** | Receivables and payables (shown separately), payments received and paid today, recent transactions, accounts with balances. |
| **Accounts** | Search, filter by type and status, paginated list with current balance. Add or edit customers and suppliers. Deactivate instead of deleting. |
| **Account detail** | Opening balance, current balance, running-balance ledger, date range and search filters, printable statement, CSV export. |
| **Add transaction** | Pick an account, then a transaction type. The form explains the effect before you save. |
| **Transactions** | Every posted entry with server-side pagination and filters. **Reverse** creates a correcting entry. |
| **Settings** | Business name, address, currency symbol, time zone, password change, and the activity log. |

### Transaction types

| You want to record | Choose |
|---|---|
| A customer buys on credit | **Credit sale / amount due** |
| A customer pays you | **Payment received** (choose a payment method) |
| A refund or credit note to a customer | **Customer credit / refund** |
| You buy from a supplier on credit | **Credit purchase / amount owed** |
| You pay a supplier | **Payment made** (choose a payment method) |
| A supplier credit note or return | **Supplier credit / return** |

Opening balances are set when you create the account.

### Correcting a mistake

Posted entries cannot be changed or deleted, which keeps the history trustworthy. Go to **Transactions** (or the account's ledger), click **Reverse**, give a reason, and save. The app adds an opposite entry that cancels the original, links the two, and records the reason in the activity log. The original stays visible and is marked as reversed.

### Overpayments and cross-side balances

If a customer pays more than they owe, the account shows an explicit **Credit** (advance). Nothing is clamped to zero. A balance on the wrong side (for example, a customer with a payable balance) is shown as a warning and should be corrected.

---

## Part 3: Deploying on a server (for later)

1. Serve the app over **HTTPS** (for example with a reverse proxy such as Caddy, Nginx or IIS ARR). Set `COOKIE_SECURE=true` and `TRUST_PROXY=1` in `backend/.env`.
2. Keep MySQL on a private network. Never expose port 3306 to the internet.
3. Use a strong, unique administrator password and a separate database user for the application.
4. Back up the `erp_ledger` database every day (`mysqldump --single-transaction erp_ledger > backup.sql`).
5. Set `NODE_ENV=production`. Deploy with `npm run build` in both folders, then `npm start` in `backend`.
6. For a Windows service, use a tool such as NSSM or PM2 to keep `npm start` running.

---

## Part 4: Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_URL must start with mysql://` | Check `backend\.env`. Only MySQL is supported. |
| `Access denied for user 'erp_app'` | Check the password in `DATABASE_URL`. Encode special characters. |
| `Table ... does not exist` or Prisma client errors | Run `npx prisma migrate deploy` and `npm run prisma:generate` in `backend`. |
| Error 1419 during migrations | See the note in section 1.2. |
| `frontend build was not found` on port 4000 | Run `npm run build` in `frontend` first. |
| "Your session has expired" | Sign in again. Sessions end after inactivity or after `SESSION_MAX_HOURS`. |
| Port 4000 already in use | Stop the other program, or change `PORT` in `backend\.env`. |
| `npm` is not recognized | Reinstall Node.js and reopen PowerShell. |

---

## Project layout

```
erp-system/
├── README.md                 this file
├── docs/API.md               endpoint reference
├── backend/
│   ├── .env.example          copy to .env and fill in (never commit .env)
│   ├── prisma/
│   │   ├── schema.prisma     database models
│   │   └── migrations/       SQL migrations (run with prisma migrate deploy)
│   ├── src/
│   │   ├── modules/          accounts, ledger, transactions, dashboard, settings, audit, auth
│   │   ├── middleware/       sessions, same-origin write checks, error responses
│   │   ├── scripts/seed.ts   creates the administrator (and optional demo data)
│   │   └── server.ts         starts the server
│   └── tests/                unit and integration tests
└── frontend/
    ├── src/pages/            one file per screen
    ├── src/components/       shared UI pieces
    └── src/lib/              API client, formatting, data queries
```

## Security notes

- Passwords are hashed with Argon2id. Sessions are random tokens stored only as hashes. The session cookie is `HttpOnly` and `SameSite=Strict`.
- Database credentials stay on the server. The browser only calls relative `/api` URLs.
- All money is stored as `DECIMAL(15,2)` and calculated as decimals on the server, never as floating-point numbers.
- Requests that change data must send `X-Requested-With` and must come from the same host. Financial writes accept an `Idempotency-Key`, so a double-click or a retry cannot post twice.
- Balances are calculated by the server. The client cannot send them.
