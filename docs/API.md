# deposit.in API (Node/Express + Prisma)

All paths are relative to `/api`. JSON is UTF-8; monetary amounts are **decimal strings** (`"1500.50"`), business dates are `YYYY-MM-DD` in the configured time zone, timestamps are ISO-8601 UTC. The browser uses relative `/api` URLs and an HttpOnly `erp_session` cookie; there is no bearer token or local-storage secret.

Every write, including login, needs `X-Requested-With: XMLHttpRequest`; an `Origin` header, when provided, must match the serving host or an explicitly allowed frontend origin. Cookies are SameSite=Lax by default; HTTPS Arena preview hosts (`*.e2b.app`) use `SameSite=None; Secure; Partitioned` for the embedded iframe. Other cross-site origins require explicit server configuration. Login attempts are limited to **10 failed attempts per 15 minutes per IP**. Sessions expire after 120 idle minutes or 12 hours (configurable).

```bash
# Demo (`npm run dev`) from the Vite origin, or point at the API server directly:
curl -c cookie.txt -H 'Content-Type: application/json' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"username":"admin","password":"Admin@12345"}' \
  http://localhost:5173/api/auth/login
curl -b cookie.txt http://localhost:5173/api/auth/me
```

Error envelope: `{ "error": { "code": "…", "message": "…", "details": [{ "field": "…", "message": "…" }], "requestId": "…" } }`. Common statuses: 400 `VALIDATION_ERROR` (malformed/invalid input), 401 `UNAUTHORIZED`, 403 `FORBIDDEN` or `PASSWORD_CHANGE_DISABLED`, 404 `NOT_FOUND`, 409 `DUPLICATE_RECORD`, `ALREADY_APPROVED`, `ALREADY_REJECTED`, `ALREADY_REVERSED`, `IDEMPOTENCY_KEY_REUSED`, 422 `INVALID_ENTRY_OPTION`, `ACCOUNT_INACTIVE`, `FUTURE_DATE`, `BOOK_ARCHIVED`, 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE`. Zod field errors are returned in `details` where available. IDs are JSON numbers within JavaScript's safe-integer range.

## Endpoints

| Method | Path | Access | Request / response |
|---|---|---|---|
| GET | `/health` | public | `{ status: "UP", database: "UP" }`; returns `{ status: "DOWN", database: "DOWN" }` with 503 if DB unavailable |
| POST | `/auth/login` | public | `{ username, password }` → `{ user }` and session cookie; username case-insensitive |
| POST | `/auth/pin-login` | public | `{ pin: "1234" }` → `{ user }` and session cookie; first login hashes old Spring PINs |
| GET | `/auth/me` | signed in | `{ user: { id, name, username, role, accountId } }` |
| POST | `/auth/logout` | any | Revokes cookie; `204` |
| POST | `/auth/change-password` | admin | `{ currentPassword, newPassword, confirmPassword }` → `204`; staff gets `403 PASSWORD_CHANGE_DISABLED` |
| GET | `/accounts` | admin | `search`, `status=active/inactive`, `sort`, `page`, `pageSize` → `{ items, pagination }` |
| GET | `/accounts/options` | admin | Staff picker `{ items }`, optional `search` |
| GET | `/accounts/:id` | owner/admin | `{ account }` |
| POST | `/accounts` | admin | `{ name, pin?: "1234", password?, phone?, email?, address?, notes? }` → `201 { account, replayed }`. PIN-only accounts have a random unusable password until explicitly reset. |
| PATCH | `/accounts/:id` | admin | `{ name?, phone?, email?, address?, notes? }` → `{ account }` |
| PATCH | `/accounts/:id/status` | admin | `{ isActive: false }` → `{ account }`; deactivation revokes sessions, retains history |
| POST | `/accounts/:id/reset-password` | admin | `{ newPassword, confirmPassword }` → `204`; revokes sessions |
| PUT | `/accounts/:id/pin` | admin | `{ pin: "3456" }` or `{ pin: null }` to disable → `{ account }`; revokes sessions |
| PUT | `/accounts/:id/books` | admin | JSON array `[1,2]` of active book IDs → `{ account }` |
| PATCH | `/accounts/:id/back-date` | admin | `{ date: "YYYY-MM-DD" }` (a single permitted date) or `{ date: null }` → `{ account }` |
| GET | `/books` | signed in | Admin: all books; staff: assigned active books → array `{ id, name, status, entryCount }` |
| POST | `/books` | admin | `{ name }` → `201` book |
| POST | `/books/:id/archive` | admin | Archive; historical entries remain |
| POST | `/books/:id/restore` | admin | Restore book |
| GET | `/settings` | signed in | `{ business: { …, userEntryOptions }, today, user, session }` |
| PUT | `/settings` | admin | `{ businessName, businessAddress?, businessPhone?, businessEmail?, currencySymbol, timezone, logoUrl? }` → `{ business, today }` |
| GET | `/settings/entry-options` | signed in | `{ items }`; staff only see active options |
| PUT | `/settings/entry-options` | admin | `{ options: ["Cash Deposit", …] }` replaces active list without removing historical entries |
| POST / PATCH / DELETE | `/settings/entry-options[/:id]` | admin | Create `{ name }`, edit `{ name?, isActive?, sortOrder? }`, delete unused; `POST /:id/deactivate` for used options |
| GET | `/transactions` | admin | Filter `search` (staff/book/customer/bank/reference/notes), `type` (`DEPOSIT`, `WITHDRAWAL`, `REVERSAL`, or legacy aliases), `approvalStatus`, `accountId`, `bookId`, `from`, `to`, `includeReversals=false`, `page`, `pageSize` → `{ items, pagination, summary }`. `summary` contains decimal strings `deposits`, `withdrawals`, `net`, and numeric `approvedEntries`, across all matching pages; only approved amounts count. |
| GET | `/transactions/report.pdf` | admin | Same filters as `/transactions` (ignores pagination) → entries and collection PDF with approved totals; max 10,000 entries (narrow dates if exceeded) |
| GET | `/transactions/:id` | owner/admin | Transaction object |
| POST | `/transactions` | signed in | See create example below → `201 { transaction, account, replayed }` |
| PATCH | `/transactions/:id` | owner/admin | Edit an own entry within 1 hour of creation (admins: any entry). `{ type?, entryDate?, amount?, optionName?, detail?, paymentMethod?, referenceNumber?, bookId?, customerId?, bankDetails? }` → `{ transaction, account, replayed }`. Reversals, reversed, rejected and expired entries are rejected with 422. |
| POST | `/transactions/:id/approve` | admin | `{}` → `{ transaction, account, alreadyApproved, replayed }` |
| POST | `/transactions/:id/reject` | admin | `{ reason }` → `{ transaction, account, alreadyRejected, replayed }` |
| POST | `/transactions/:id/reversal` | admin | `{ reason, entryDate? }` → `{ reversal, original, account, replayed }`; exactly one offsetting entry |
| GET | `/transactions/multi-report` | admin | `userIds=1,2`, `from`, `to`, `bookId` → array of rows (up to 10,000); add `summary=true` for `{ rows, summary, staffSummary, bookSummary }`. Summary totals use approved entries only; pending/rejected counts remain separate. Selected inactive/zero-activity staff and unassigned/archived books are retained. Net is period movement, not closing balance. |
| GET | `/transactions/multi-report.pdf` | admin | Same filters → combined PDF: staff comparison, book comparison, approved totals and all matching history (including pending/rejected rows, excluded from money totals); same 10,000-entry limit |
| GET | `/accounts/:id/ledger` | owner/admin | `from`, `to`, `search`, `page`, `pageSize` → `{ account, entries, totals, openingBalance, balanceBroughtForward, closingBalance, pagination }` |
| GET | `/accounts/:id/statement` | owner/admin | Same as ledger, unpaginated |
| GET | `/accounts/:id/ledger.csv` | admin | Same filters → CSV (formula-safe untrusted text) |
| GET | `/accounts/:id/ledger.pdf` | admin | Same filters, or `period=this-month/last-month` → PDF |
| GET | `/dashboard` | admin | Optional `from`, `to`, `bookId`, `userId` → counts, totals, pending entries, staff overview, `collectionBreakdown` (approved date/book totals: `date`, nullable `bookId`, `bookName`, decimal-string `deposits`, `withdrawals`, `net`, and `entries`; newest date first; unassigned books included) |
| GET | `/dashboard/summary.pdf` | admin | Same filters → all-users summary PDF |
| GET | `/audit-logs` | admin | `entityType?`, `page`, `pageSize` → `{ items, pagination }` |

### Entry creation and approvals

```json
{
  "accountId": 2,
  "type": "DEPOSIT",
  "entryDate": "2026-10-17",
  "amount": "1500.50",
  "optionName": "Cash Deposit",
  "detail": "site advance",
  "bookId": 1
}
```

`type` is `DEPOSIT` (+) or `WITHDRAWAL` (−). The API accepts some legacy names (e.g. `CREDIT_SALE`, `PAYMENT_MADE`), **not** client-created `REVERSAL` entries. `optionName` must be an active admin-configured option. `detail`, `referenceNumber`, `paymentMethod`, `customerId`, `bankDetails` are optional. Staff must use their own `accountId`; if they have assigned active books, they must select one of those. Staff can post today, or the **exact** earlier date granted by an admin. Admins can back-date and post directly. A pending submission changes the approval queue, not the approved balance; rejecting it keeps history. An admin reversal preserves both the original and a new offsetting approved transaction. `AccountSummary` contains `totalUserPaid` (approved deposits), `totalAdminPaid` (approved withdrawals), `pendingBalance` (approved net balance), `pendingSubmissionsCount`, `balance: { amount, side, status }`, `allowedBookIds`, and `backDateAllowedDate`.

Ledger entries additionally carry `bookId`, `bookName`, `staffName` (who recorded the entry), `customerId`, `bankDetails` and `createdAt` for the user portal's history table. Staff can edit their own entries for 1 hour after creation via `PATCH /transactions/:id`; the edit window, ownership and entry state (not a reversal, not reversed, not rejected) are enforced server-side.

Send an optional unique `Idempotency-Key` header on account creation, transaction creation, approval, rejection, and reversal. Reusing the same key with identical input returns the stored status/body with `replayed: true`; different input gets `409 IDEMPOTENCY_KEY_REUSED`. Replay records are per actor and operation, stored atomically alongside the ledger write. Approval/rejection/reversal also use row locks in MySQL to prevent double decisions. Invalid business states return 409/422 without partially posting money.
