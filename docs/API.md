# deposit.in API Reference

Base path: `/api`. All request and response bodies are JSON (UTF-8). Money values are
decimal strings with two decimals (`"1500.00"`), never JSON numbers. Dates are
`YYYY-MM-DD`; timestamps are ISO-8601 UTC instants.

## Authentication

Cookie-based sessions only. `POST /api/auth/login` sets an **HttpOnly** session cookie
(`erp_session`); every later request authenticates with that cookie. No token is stored
in JavaScript.

- **CSRF:** every non-`GET` request must send `X-Requested-With: XMLHttpRequest`, and the
  `Origin`/`Referer` host must match the request host. Missing/foreign writes get `403 FORBIDDEN`.
- **Sessions** expire after 120 minutes of inactivity (sliding) or 12 hours absolute.
- `POST /api/auth/logout` revokes the current session.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please correct the highlighted fields.",
    "details": [{ "field": "amount", "message": "Enter an amount." }],
    "requestId": "…uuid…"
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bean validation failed; `details[]` has field errors |
| `BAD_REQUEST` | 400 | Malformed request |
| `UNAUTHORIZED` | 401 | No/invalid session |
| `FORBIDDEN` | 403 | Wrong role or failed CSRF check |
| `NOT_FOUND` | 404 | Resource missing (or hidden for privacy) |
| `DUPLICATE_RECORD` | 409 | Name already taken |
| `ALREADY_APPROVED` | 409 | Entry already approved |
| `ALREADY_REJECTED` | 409 | Entry already rejected |
| `CONFLICT` | 409 | Other state conflict (e.g. already reversed) |
| `ACCOUNT_INACTIVE` | 422 | Target account is inactive |
| `INVALID_ENTRY_OPTION` | 422 | Entry option missing/unknown/inactive |
| `FUTURE_DATE` | 422 | Entry date after today (business timezone) |
| `INVALID_AMOUNT` | 422 | Amount ≤ 0 or malformed |
| `PASSWORD_CHANGE_DISABLED` | 403 | Users cannot change their own password |
| `PASSWORD_TOO_WEAK` | 422 | Password < 6 chars or missing letters/numbers |
| `TOO_MANY_REQUESTS` | 429 | Too many failed logins (10 / 15 min per name+IP) |
| `INTERNAL_ERROR` | 500 | Unexpected error |

Optional header `Idempotency-Key` is accepted on create calls; replayed creates are
flagged in the response (`"replayed": true`).

## Transaction model

Two kinds — **`DEPOSIT`** (money in, increases the balance) and **`WITHDRAWAL`**
(money out, decreases it). Views also report `type: "REVERSAL"` for offsetting entries.

- Balance = Σ approved deposits − Σ approved withdrawals.
- `PENDING` / `REJECTED` entries never affect the balance.
- Users submit entries as `PENDING`; administrators create entries already `APPROVED`.
- Legacy type names are accepted on input and mapped:
  `CREDIT_SALE`, `CREDIT_PURCHASE` → `DEPOSIT`;
  `PAYMENT_RECEIVED`, `PAYMENT_MADE`, `CUSTOMER_CREDIT_ADJUSTMENT`,
  `SUPPLIER_CREDIT_ADJUSTMENT`, `REVERSAL` → `WITHDRAWAL`.

## Endpoints

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | public | `{ "status": "ok", "database": "up" }` |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{ "username", "password" }` (login is case-insensitive) → `{ user }`, sets cookie |
| POST | `/api/auth/logout` | any | Revokes the session, clears the cookie → `204` |
| GET | `/api/auth/me` | any | `{ user: { id, username, role, accountId, name } }` |
| POST | `/api/auth/change-password` | any | Always `403 PASSWORD_CHANGE_DISABLED` — ask the Administrator to reset |

### Accounts (users)

Every user is one ledger account (`accountCode` like `USR-000002`).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/accounts` | ADMIN | List with `search`, `status` (`active`/`inactive`), `sort`, `page`, `pageSize` → `{ items, pagination }` |
| GET | `/api/accounts/options` | ADMIN | Lightweight list for pickers (`search`, `type`) |
| GET | `/api/accounts/{id}` | ADMIN | `{ account }` |
| POST | `/api/accounts` | ADMIN | `{ "name": "2-150 chars", "password": "6-100 chars, letters+numbers" }` → `201 { account }`. Case-insensitive unique name. |
| PATCH | `/api/accounts/{id}` | ADMIN | `{ name?, phone?, email?, address?, notes? }` → `{ account }` |
| PATCH | `/api/accounts/{id}/status` | ADMIN | `{ "isActive": false }` deactivates (blocks new entries; history kept) |
| POST | `/api/accounts/{id}/reset-password` | ADMIN | `{ "newPassword", "confirmPassword" }` → `204`, revokes all of that user's sessions |

`AccountSummary` carries the compatibility fields the UI renders:
`totalUserPaid` (approved deposits), `totalAdminPaid` (approved withdrawals),
`pendingBalance` (net balance), `balance: { amount, side, status }` (side
`RECEIVABLE`/`PAYABLE`, status `DUE`/`CREDIT`/`SETTLED`), `balances:
{ receivable, payable }`, `crossSideBalance` (always `null` in this model),
`pendingSubmissionsCount`, `entryCount`, `lastEntryDate`, `isActive`.

### Transactions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/transactions` | ADMIN | Filters: `search`, `type`, `approvalStatus`, `accountId`, `from`, `to`, `includeReversals` (`false` hides reversal rows), `page`, `pageSize` |
| GET | `/api/transactions/{id}` | owner/ADMIN | One entry |
| POST | `/api/transactions` | any | Create (see below) → `201 { transaction, account, replayed }` |
| POST | `/api/transactions/{id}/approve` | ADMIN | Approve a pending entry exactly once → `{ transaction, account, alreadyApproved, replayed }` |
| POST | `/api/transactions/{id}/reject` | ADMIN | `{ "reason" }` → `{ transaction, account, alreadyRejected, replayed }` |
| POST | `/api/transactions/{id}/reversal` | ADMIN | `{ "reason", "entryDate?" }` → `200 { reversal, original: { id, isReversed, reversedById }, account, replayed }` |

**Create body:**

```json
{
  "accountId": 2,
  "type": "DEPOSIT",
  "entryDate": "2026-10-16",
  "amount": "1500.50",
  "optionName": "Cash Deposit",
  "detail": "site advance",
  "paymentMethod": "CASH",
  "referenceNumber": "UPI ref",
  "notes": "free text"
}
```

- `optionName` (alias `option`) must be an **active** entry option — see Settings.
  Legacy clients may instead send `notes` as `"Option — detail"`; the server splits it.
- `detail` (alias `description`) is free text up to 500 chars.
- Users can only post to their own `accountId`.
- Reversals post an offsetting entry (auto-approved) and can be applied once per
  approved entry; reversal rows cannot be reversed again.

### Ledger & statements

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/accounts/{id}/ledger` | owner/ADMIN | Paginated ledger: `from`, `to`, `search`, `page`, `pageSize`. Entries carry `runningBalance` in entry order. |
| GET | `/api/accounts/{id}/statement` | owner/ADMIN | Same filters; all matching rows, no pagination |
| GET | `/api/accounts/{id}/ledger.csv` | ADMIN | CSV export |
| GET | `/api/accounts/{id}/ledger.pdf` | ADMIN | PDF export (`application/pdf`) |

Responses include `openingBalance`, `balanceBroughtForward`, `closingBalance`,
`totals: { increases, decreases, net, entryCount }`, `crossSideEntryCount` (0).

### Dashboard (ADMIN)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard` | ADMIN | `today`, `timezone`, `currencySymbol`, `counts`, `userLedgerTotals`, `receivables`, `payables`, `todayPayments`, `recentTransactions`, `pendingEntries`, `outstandingAccounts`, `usersOverview`, `outstandingCount` |
| GET | `/api/dashboard/summary.pdf` | ADMIN | All-users summary PDF |

### Settings & entry options

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/settings` | any | `{ business: { businessName, …, currencySymbol, timezone, userEntryOptions, updatedAt }, today, user, session }` |
| PUT | `/api/settings` | ADMIN | Update business profile / currency / timezone |
| PUT | `/api/settings/entry-options` | ADMIN | `{ "options": ["Cash Deposit", "Site Material"] }` replaces the active list → `{ business, userEntryOptions }` |
| GET | `/api/settings/entry-options` | any | Full option list with active flags |
| POST | `/api/settings/entry-options` | ADMIN | Create one option |
| PATCH | `/api/settings/entry-options/{id}` | ADMIN | Rename / activate / reorder |
| POST | `/api/settings/entry-options/{id}/deactivate` | ADMIN | Soft-remove (hidden from new entries) |
| DELETE | `/api/settings/entry-options/{id}` | ADMIN | Hard delete when unused |

### Audit log (ADMIN)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/audit-logs` | ADMIN | `page`, `pageSize`, `entityType` → `{ items, pagination }` |

Recorded actions include account create/update/deactivate/reactivate, password resets,
login success/failure, transaction create/approve/reject/reverse, settings updates and
entry-option changes. Audit rows are append-only.
