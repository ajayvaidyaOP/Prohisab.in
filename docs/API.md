# Simple Ledger ERP: API reference

Base URL: `/api` on the same origin as the web app (for example `http://localhost:4000/api` in production, or `http://localhost:5173/api` through the Vite dev server).

The API is JSON over HTTPS in production. It is used by the bundled React app, but any HTTP client that follows the rules below can call it.

## 1. Conventions

### Authentication

- `POST /api/auth/login` sets an `erp_session` cookie: `HttpOnly`, `SameSite=Strict`, and `Secure` when `COOKIE_SECURE=true`.
- The cookie holds a random token. The database stores only its SHA-256 hash.
- Sessions expire after `SESSION_IDLE_MINUTES` of inactivity, and after `SESSION_MAX_HOURS` in total.
- There is one administrator. No public registration exists, and no roles exist.
- Every endpoint except `GET /api/health` and `POST /api/auth/login` requires a valid session. Unauthenticated calls return `401`.

### Required headers

| Header | Required on | Why |
|---|---|---|
| `X-Requested-With: XMLHttpRequest` | Every request that changes data (`POST`, `PUT`, `PATCH`, `DELETE`) | CSRF protection. Requests without it return `403`. |
| `Origin` (when sent by the browser) | Every write | Must have the same host as the `Host` header. Cross-site writes return `403`. |
| `Idempotency-Key: <8-100 chars, A-Z a-z 0-9 - _>` | `POST /api/accounts`, `POST /api/transactions`, `POST /api/transactions/{id}/reversal` | Makes retries safe. The same key with the same body replays the original response (`replayed: true`) without writing again. The same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`. |
| `Content-Type: application/json` | Requests with a body | Bodies are capped at 100 KB. |

### Money

- Every amount is a **decimal string** with exactly two decimals, for example `"1500.00"`. Clients must not send JavaScript numbers for money.
- Requests accept up to two decimals, with or without commas (`"1,500.50"`). Amounts must be positive for transactions. Opening balances may be `0.00`.
- Balances are never sent by the client. The server calculates them.

### Dates and time zone

- Ledger dates (`entryDate`) are calendar dates, `YYYY-MM-DD`. They have no time component.
- "Today" is computed in the business time zone from settings (default `Asia/Kolkata`).
- Future-dated entries are rejected. Reversal dates cannot be earlier than the original entry.
- Audit and creation timestamps are ISO 8601 UTC strings (`2026-10-15T17:00:03.779Z`).

### Balances and sides

- `RECEIVABLE` and `PAYABLE` are separate categories and are never netted together.
- Customers normally carry a `RECEIVABLE` balance. Suppliers normally carry a `PAYABLE` balance.
- `balance.status` is `DUE` (normal side, money owed), `CREDIT` (advance or overpayment on the normal side, shown as a negative amount), or `SETTLED` (zero).
- A balance on the opposite side of the account type is reported as `crossSideBalance` and must be corrected.

### Errors

Every error uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please correct the highlighted fields.",
    "details": [{ "field": "amount", "message": "Amount must be greater than zero." }],
    "requestId": "9b3a7278-5a95-4b2a-b0ba-7823ff54791e"
  }
}
```

`details` is present for validation errors. `requestId` is returned for every error and can be quoted when reporting a problem.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED`, `BAD_REQUEST` | Invalid input or a missing `Idempotency-Key`. |
| 401 | `UNAUTHORIZED` | No session, or the session has expired. |
| 403 | `FORBIDDEN` | Missing `X-Requested-With`, or a cross-site write. |
| 404 | `NOT_FOUND` | Unknown route or record. |
| 409 | `DUPLICATE_RECORD`, `ALREADY_REVERSED`, `REQUEST_IN_PROGRESS`, `RELATED_RECORD_CONFLICT` | Conflicts such as a duplicate code, a second reversal, or a submission still in progress. |
| 422 | `ACCOUNT_INACTIVE`, `ACCOUNT_TYPE_LOCKED`, `OPENING_BALANCE_LOCKED`, `TRANSACTION_TYPE_MISMATCH`, `POSTING_RULE_MISMATCH`, `OPENING_SIDE_MISMATCH`, `FUTURE_DATE`, `REVERSAL_DATE_BEFORE_ORIGINAL`, `CANNOT_REVERSE_REVERSAL`, `IDEMPOTENCY_KEY_REUSED`, `INVALID_CURRENT_PASSWORD`, `LEDGER_RULE_VIOLATION` | Well-formed requests that break a business rule. |
| 429 | `TOO_MANY_REQUESTS` | Rate limit. Login allows 10 failed attempts per 15 minutes. The general API allows 600 requests per minute. |
| 500 | `INTERNAL_ERROR` | Unexpected server or database error. The message is generic. Details go to the server log. |

### Pagination

List endpoints accept `page` (starting at 1) and `pageSize`. Responses include:

```json
"pagination": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 }
```

Limits: accounts 100, transactions 100, ledger 200, audit 100.

---

## 2. Health

### `GET /api/health`

Public. Used by the Windows setup instructions and for monitoring.

```json
{ "status": "ok", "database": "up" }
```

---

## 3. Authentication

### `POST /api/auth/login`

```json
{ "username": "admin", "password": "your-password" }
```

- `200` returns `{ "user": { "id": 1, "username": "admin" } }` and sets the `erp_session` cookie.
- `401 UNAUTHORIZED` for a wrong username or password. The message is the same for both cases.
- `429` after 10 failed attempts in 15 minutes.

### `POST /api/auth/logout`

Ends the current session and clears the cookie. Returns `204`.

### `GET /api/auth/me`

Returns `{ "user": { "id": 1, "username": "admin" } }`, or `401` when signed out. The web app uses this to restore the session on refresh.

---

## 4. Accounts (customers and suppliers)

An account has: `id`, `accountCode` (server-generated, `CUS-000001` or `SUP-000001`, unique), `name`, `type` (`CUSTOMER` or `SUPPLIER`), `typeLabel`, `phone`, `email`, `address`, `notes`, `openingBalance`, `openingBalanceSide`, `normalSide`, `balance` (`{ amount, side, status }`), `balances` (`{ receivable, payable }`), `crossSideBalance`, `isActive`, `entryCount`, `lastEntryDate`, `createdAt`, `updatedAt`.

### `GET /api/accounts`

Query: `search` (name, account code, phone, email), `type` (`CUSTOMER` / `SUPPLIER`), `status` (`all` / `active` / `inactive`), `sort` (`name` / `code` / `newest`), `page`, `pageSize`.

Response: `{ "items": [Account, ...], "pagination": {...} }`.

### `GET /api/accounts/options`

Short list for pickers. Query: `search`, `type`, `limit` (max 50). Returns `{ "items": [{ id, accountCode, name, type, isActive, balance }] }`. Inactive accounts are included so that old references remain readable.

### `POST /api/accounts` (requires `Idempotency-Key`)

```json
{
  "name": "Sharma Traders",
  "type": "CUSTOMER",
  "phone": "+91 98765 43210",
  "email": "accounts@example.com",
  "address": "Pune",
  "openingBalance": "2500.00",
  "openingBalanceSide": "RECEIVABLE",
  "notes": ""
}
```

- `openingBalanceSide` is optional. When sent, it must match the account type (`CUSTOMER` → `RECEIVABLE`, `SUPPLIER` → `PAYABLE`), otherwise `422 OPENING_SIDE_MISMATCH`.
- Unknown fields are rejected (`400`). The client cannot set `accountCode`, balances, or timestamps.
- Response `201`: `{ "account": Account, "replayed": false }`.

### `GET /api/accounts/{id}`

Returns `{ "account": Account }`, or `404`.

### `PATCH /api/accounts/{id}`

Partial update of `name`, `type`, `phone`, `email`, `address`, `openingBalance`, `openingBalanceSide`, `notes`. An empty body returns `400`.

- `type` and `openingBalanceSide` are locked once the account has any posted entry (`422 ACCOUNT_TYPE_LOCKED` / `OPENING_BALANCE_LOCKED`).
- Returns `{ "account": Account }`.

### `PATCH /api/accounts/{id}/status`

```json
{ "isActive": false }
```

Accounts are deactivated, never hard-deleted. Inactive accounts keep their history but cannot receive new transactions (`422 ACCOUNT_INACTIVE`).

---

## 5. Ledger and statements

### `GET /api/accounts/{id}/ledger`

Query: `from`, `to` (inclusive `YYYY-MM-DD`), `search` (matches the transaction type label, reference, notes, payment method, or entry id), `page`, `pageSize` (max 200, default 50).

Filters choose which rows are shown. `runningBalance` and `closingBalance` are always calculated over the full history, so a filtered view still shows true balances. `totals` describe the rows shown.

Response:

```json
{
  "account": Account,
  "filters": { "from": null, "to": null, "search": null },
  "openingBalance": { "amount": "500.00", "side": "RECEIVABLE" },
  "balanceBroughtForward": { "amount": "500.00", "side": "RECEIVABLE", "status": "DUE" },
  "closingBalance": { "amount": "1200.00", "side": "RECEIVABLE", "status": "DUE" },
  "totals": { "increases": "1000.00", "decreases": "300.00", "net": "700.00", "entryCount": 2 },
  "crossSideEntryCount": 0,
  "entries": [
    {
      "id": 11,
      "entryDate": "2026-10-15",
      "type": "CREDIT_SALE",
      "typeLabel": "Credit sale / amount due",
      "description": "Credit sale / amount due",
      "side": "RECEIVABLE",
      "direction": "INCREASE",
      "amount": "1000.00",
      "paymentMethod": null,
      "paymentMethodLabel": null,
      "referenceNumber": "INV-UI-1",
      "notes": null,
      "reversalOfId": null,
      "reversedById": null,
      "isReversal": false,
      "isReversed": false,
      "runningBalance": "1500.00",
      "crossSide": false,
      "createdAt": "2026-10-15T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 2, "totalPages": 1 }
}
```

- `openingBalance` is the account's configured opening amount and side. The `balanceBroughtForward` is the balance before the first entry in the filtered range (it equals the opening balance when no `from` is set).
- `runningBalance` is calculated from the start of the account's history, so it stays correct when a date range or page is applied.
- `closingBalance` is the balance after the last entry in the range, on the account's normal side. Credits are negative.

### `GET /api/accounts/{id}/statement`

Same query as the ledger, without pagination. Returns every entry in the range, for the printable statement page.

### `GET /api/accounts/{id}/ledger.csv`

Same query as the statement. Returns `text/csv` with a header row. Amounts are plain decimals. Free-text cells that begin with `=`, `+`, `-`, `@`, a tab, or a carriage return are prefixed with an apostrophe to prevent spreadsheet formula injection.

---

## 6. Transactions

### `GET /api/transactions`

Query: `search`, `type`, `accountId`, `from`, `to`, `includeReversals` (`true` / `false`), `page`, `pageSize` (max 100, default 20). Newest first.

Each item: `id`, `entryDate`, `type`, `typeLabel`, `side`, `direction`, `amount`, `paymentMethod`, `paymentMethodLabel`, `referenceNumber`, `notes`, `reversalOfId`, `reversedById`, `isReversal`, `isReversed`, `account` (`{ id, accountCode, name, type, typeLabel }`), `createdById`, `createdAt`.

### `POST /api/transactions` (requires `Idempotency-Key`)

```json
{
  "accountId": 4,
  "type": "PAYMENT_RECEIVED",
  "entryDate": "2026-10-15",
  "amount": "300.00",
  "paymentMethod": "UPI",
  "referenceNumber": "UPI-8842",
  "notes": "Part payment"
}
```

Transaction types and what the server posts:

| `type` | Account type | Posted side | Direction | Payment method |
|---|---|---|---|---|
| `CREDIT_SALE` | Customer | RECEIVABLE | INCREASE | optional |
| `PAYMENT_RECEIVED` | Customer | RECEIVABLE | DECREASE | **required** |
| `CUSTOMER_CREDIT_ADJUSTMENT` | Customer | RECEIVABLE | DECREASE | optional |
| `CREDIT_PURCHASE` | Supplier | PAYABLE | INCREASE | optional |
| `PAYMENT_MADE` | Supplier | PAYABLE | DECREASE | **required** |
| `SUPPLIER_CREDIT_ADJUSTMENT` | Supplier | PAYABLE | DECREASE | optional |

- `side` and `direction` may be sent as an echo. They are accepted only when they match the rule for the type, otherwise `422 POSTING_RULE_MISMATCH`. The server always decides them.
- A type that does not fit the account type returns `422 TRANSACTION_TYPE_MISMATCH`.
- An inactive account returns `422 ACCOUNT_INACTIVE`.
- `REVERSAL` cannot be posted directly. Use the reversal endpoint.
- `paymentMethod` is one of `CASH`, `UPI`, `BANK_TRANSFER`, `OTHER`.
- Response `201`: `{ "transaction": Transaction, "account": AccountSummary, "replayed": false }`.

### `GET /api/transactions/{id}`

Returns `{ "transaction": Transaction }`, or `404`.

### `POST /api/transactions/{id}/reversal` (requires `Idempotency-Key`)

```json
{ "reason": "Entered twice", "entryDate": "2026-10-15" }
```

- Posted entries are never edited or deleted. A reversal creates a new `REVERSAL` entry on the opposite direction with the same amount, and links it through `reversalOfId`.
- `entryDate` is optional (defaults to today). It cannot be before the original entry date (`422 REVERSAL_DATE_BEFORE_ORIGINAL`).
- An entry can be reversed once (`409 ALREADY_REVERSED`). A reversal cannot be reversed (`422 CANNOT_REVERSE_REVERSAL`).
- The reason is written to the audit log.
- Response `201`: `{ "reversal": Transaction, "original": { "id", "isReversed", "reversedById" }, "account": AccountSummary, "replayed": false }`.

---

## 7. Dashboard

### `GET /api/dashboard`

```json
{
  "today": "2026-10-15",
  "timezone": "Asia/Kolkata",
  "currencySymbol": "₹",
  "counts": {
    "activeCustomers": 4, "inactiveCustomers": 0,
    "activeSuppliers": 1, "inactiveSuppliers": 0,
    "ledgerEntries": 10, "entriesToday": 7,
    "customersWithBalance": 4, "suppliersWithBalance": 1
  },
  "receivables": { "total": "3800.00", "credits": "0.00", "description": "..." },
  "payables": { "total": "1600.00", "credits": "0.00", "description": "..." },
  "todayPayments": { "received": "600.00", "receivedCount": 2, "paid": "500.00", "paidCount": 1, "date": "2026-10-15" },
  "recentTransactions": [Transaction, ...],
  "outstandingAccounts": [{ "id", "accountCode", "name", "type", "isActive", "balance" }],
  "outstandingCount": 5
}
```

Receivables and payables are reported separately and never combined. "Today" uses the business time zone.

---

## 8. Settings

### `GET /api/settings`

Returns `{ "business": {...}, "today": "2026-10-15", "user": { "username": "admin" }, "session": { "idleTimeoutMinutes": 120, "maxSessionHours": 12 } }`.

### `PUT /api/settings`

```json
{
  "businessName": "Acme Traders",
  "businessAddress": "Pune",
  "businessPhone": "+91 20 0000 0000",
  "businessEmail": "office@example.com",
  "currencySymbol": "₹",
  "timezone": "Asia/Kolkata"
}
```

Returns `{ "business": {...}, "today": "..." }`.

### `POST /api/settings/password`

```json
{ "currentPassword": "old-password", "newPassword": "new-password-of-10-chars-or-more" }
```

- `422 INVALID_CURRENT_PASSWORD` when the current password is wrong.
- Other sessions are signed out. The current session stays signed in.
- Returns `204`.

---

## 9. Audit log

### `GET /api/audit-logs`

Query: `entityType`, `page`, `pageSize` (max 100, default 25). Newest first.

```json
{
  "items": [
    { "id": 7, "action": "LEDGER_ENTRY_REVERSED", "entityType": "LedgerEntry", "entityId": 12, "actor": "admin", "details": { "reason": "Entered twice" }, "createdAt": "..." }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 40, "totalPages": 2 }
}
```

Actions recorded include `ACCOUNT_CREATED`, `ACCOUNT_UPDATED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_REACTIVATED`, `LEDGER_ENTRY_CREATED`, `LEDGER_ENTRY_REVERSED`, `SETTINGS_UPDATED`, `ADMIN_PASSWORD_CHANGED`, `AUTH_LOGIN`, and `AUTH_LOGIN_FAILED`. Audit rows are append-only at the database level (triggers block UPDATE and DELETE).

---

## 10. Example: create a customer, post a sale, read the balance

```bash
# 1. Sign in (cookie jar saved to cj.txt)
curl -c cj.txt -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' http://localhost:4000/api/auth/login

# 2. Create a customer with an opening receivable of 500.00
curl -b cj.txt -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -H "Idempotency-Key: create-cust-0001" \
  -d '{"name":"Sharma Traders","type":"CUSTOMER","openingBalance":"500.00"}' \
  http://localhost:4000/api/accounts

# 3. Post a credit sale of 1000.00 (use the account id from step 2)
curl -b cj.txt -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -H "Idempotency-Key: sale-0001" \
  -d '{"accountId":1,"type":"CREDIT_SALE","entryDate":"2026-10-15","amount":"1000.00"}' \
  http://localhost:4000/api/transactions

# 4. Read the ledger: closing balance is 1500.00
curl -b cj.txt -H "X-Requested-With: XMLHttpRequest" http://localhost:4000/api/accounts/1/ledger
```

Retrying step 3 with the same `Idempotency-Key` and body returns the same transaction with `"replayed": true`, and no second entry is created.
