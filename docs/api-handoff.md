# EALICEA'S LLC app — API handoff

**Audience:** backend developers who will build the REST API for the Flutter app "EALICEA'S LLC" (package `com.ealicea.investmentsdesk`).
**Source of truth:** the field tables in §4 are generated directly from the app's module definitions (`lib/data/modules.dart`), so keys, enum strings and required flags match the client exactly.

---

## 1. What the app is

A shared, login-free business workspace for a real-estate investment / holding company (Florida, USA). ~30 resource types (entities, properties, leases, loans, deals, queue…), a dashboard computed from those records, and read-only company content. UI language: English. Mobile only (Android first).

Today the app runs on a **local stand-in** (`lib/data/repo.dart`, SharedPreferences + seed data) that already mimics the server contract below. Replacing it with HTTP calls requires no UI changes as long as the JSON shapes in this document are honoured.

## 2. Global conventions

| Topic | Rule |
|---|---|
| Transport | REST, JSON, HTTPS only, versioned path: `/v1/...` |
| Auth | **No user accounts.** Every write must carry an installation identity: header `X-Install-Id` (random 16-hex id the app creates on first launch) plus an app-integrity token (Play Integrity) in `X-Attestation`. Reads may require only `X-Install-Id`. |
| Anonymous creator | `createdBy` is a free-text display name; the current app sends `"Anonymous"` (users can no longer set a name). Not verified, not an identity. |
| IDs | Server-assigned, human-readable code per resource: `<PREFIX>-<4+ digit counter>` e.g. `PRO-0003`, `LSE-0012` (prefix listed per resource in §4). Counters are per resource. |
| Timestamps | UTC ISO-8601 (`createdAt`, `updatedAt`). Business dates are plain `YYYY-MM-DD` strings. |
| Money | Decimal USD (e.g. `1234567.50`). Store as integer cents + currency code `USD` server-side. **Money is returned to the app and displayed** (see §10). |
| Percent | Decimal where `6.5` means 6.5 %. |
| Concurrency | Every record has integer `version` (starts at 1, +1 per update). `PATCH` must send the version it read (`If-Match` header or `version` in body); mismatch → `409 Conflict` with the latest record. The app then asks the user to reopen the record. |
| Idempotency | `POST` accepts `Idempotency-Key` (UUID); repeated key within 24 h returns the original response. |
| Delete | `DELETE` is **permanent**: no soft delete, trash or history. Child records are cascade-deleted (listed per resource). Return `204`. |
| Edits | `PATCH` overwrites; no edit history is kept. |
| Rate limits | Per install id and IP. App-side guards for reference: max 12 deletes / 10 min, max 5 exports / day. Return `429` with `Retry-After`. |
| Errors | `{ "error": { "code": "validation_failed", "message": "...", "fields": { "rent": "must be ≥ 0" } } }` — never leak internals. Codes: `validation_failed` 422, `conflict` 409, `not_found` 404, `rate_limited` 429, `forbidden` 403. |
| Offline | The app caches the last successful list/dashboard responses and shows "Updated <time>"; writes require network. |

### 2.1 Standard endpoints (per resource)

```
GET    /v1/<resource>?q=&status=&sort=&order=&limit=&cursor=   list (search, filter by status, sort, cursor pagination)
POST   /v1/<resource>                                          create (201 + record)
GET    /v1/<resource>/{id}                                     read
PATCH  /v1/<resource>/{id}                                     partial update (send version)
DELETE /v1/<resource>/{id}                                     permanent delete (+ cascade)
```

* `q` searches the record's display title + subtitle fields. `status` filters on the resource's status field (marked **status** in §4). Default sort: `createdAt desc`. App page size: 12 (suggest `limit` default 20, max 100).
* Only `/v1/comparisons`, `/v1/scenarios` etc. have no special behaviour beyond the above.

### 2.2 Record JSON shape

Flat object: system fields + the resource fields (§4) + server-computed fields.

```json
{
  "id": "PRO-0003",
  "version": 2,
  "createdAt": "2026-11-05T14:02:11Z",
  "updatedAt": "2026-11-05T15:40:00Z",
  "createdBy": "Anonymous",
  "name": "Orchid Court",
  "type": "Multifamily",
  "entity": "ENT-0002",
  "units": 24,
  "occupied": 22,
  "price": 6200000.00,
  "occupancy": 91.7,
  "noiMargin": 60.5
}
```

---

## 3. Resource index

| Resource | Path | Prefix |
|---|---|---|
| Entities | `/v1/entities` | ENT |
| Asset allocation | `/v1/asset-classes` | ACL |
| Investments | `/v1/investments` | INV |
| Properties | `/v1/properties` | PRO |
| Rental units | `/v1/units` | UNT |
| Leases | `/v1/leases` | LSE |
| Rent collection | `/v1/rent-collections` | RNT |
| Work orders | `/v1/work-orders` | WO |
| Contractors | `/v1/vendors` | VND |
| Renovation projects | `/v1/renovation-projects` | REN |
| Property inspections | `/v1/inspections` | INS |
| Capital plan | `/v1/capex-items` | CPX |
| Reserve fund | `/v1/reserves` | RES |
| Cash flow | `/v1/cash-flows` | CF |
| Annual budget | `/v1/budgets` | BUD |
| Loans | `/v1/loans` | LN |
| Financial goals | `/v1/goals` | GL |
| Deals | `/v1/deals` | DL |
| Buy boxes | `/v1/buy-boxes` | BB |
| Watchlist | `/v1/watchlist` | WL |
| Decision log | `/v1/decision-notes` | DEC |
| Analysis scenarios | `/v1/scenarios` | SCN |
| Policies & limits | `/v1/policies` | POL |
| Risk register | `/v1/risks` | RSK |
| Portfolio reviews | `/v1/portfolio-reviews` | PRV |
| Queue | `/v1/queue-items` | Q |
| To-dos | `/v1/tasks` | TK |
| Service providers | `/v1/service-providers` | SP |
| Partners | `/v1/partners` | PT |
| Saved comparisons | `/v1/comparisons` | CMP |

---

## 4. Resources and fields

Type legend: `reference → /x` = foreign key to another resource (see §10 — the client currently stores the *display title*; the API should use ids). `enum` values are exact, case-sensitive strings the client compares against.

### 4.1 Entities — `/entities`

Module id: `ent` · code prefix: `ENT` · group: Structure & portfolio. Ownership structure by code, ratios between entities.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `label` | string (≤120) | yes | **display title** · Example: Entity A |
| `type` | enum | yes | `LLC`, `Inc.`, `Other` |
| `state` | string (≤120) |  | FL |
| `purpose` | enum |  | `Hold real estate`, `Investing`, `Operating`, `Hold other assets` |
| `founded` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Active`, `Suspended`, `Dissolved` |
| `parent` | reference → /entities |  |  |
| `ownPct` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `note` | string (≤600) |  |  |

### 4.2 Asset allocation — `/asset-classes`

Module id: `acl` · code prefix: `ACL` · group: Structure & portfolio. Actual vs. target weight by class.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `group` | enum | yes | **display title** · `Real estate`, `Stocks & funds`, `Bonds`, `Private equity`, `Cash equivalents`, `Owned businesses`, `Other assets` |
| `entity` | reference → /entities |  |  |
| `value` | decimal (USD) | yes |  |
| `valueDate` | date (YYYY-MM-DD) |  |  |
| `target` | decimal (percent, e.g. 6.5 = 6.5%) | yes |  |
| `band` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `drift` | enum |  | **status** · `In range`, `Off target` |

**Server-computed, read-only (never accepted on write):** `actual` = value ÷ Σ(all asset-class values) × 100 (1 dp) · `drift` = `In range` if |actual − target| ≤ band else `Off target`

### 4.3 Investments — `/investments`

Module id: `inv` · code prefix: `INV` · group: Structure & portfolio. Stocks, funds, bonds, private equity.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** · Fund name / general description |
| `type` | enum | yes | `Stock`, `Funds & ETFs`, `Bonds`, `Real estate fund`, `Private equity`, `Secured lending`, `Owned businesses` |
| `entity` | reference → /entities |  |  |
| `invested` | decimal (USD) |  |  |
| `value` | decimal (USD) |  |  |
| `income` | decimal (USD) |  |  |
| `date` | date (YYYY-MM-DD) |  |  |
| `maturity` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Holding`, `Sold`, `Matured` |
| `note` | string (≤600) |  |  |

**Server-computed, read-only (never accepted on write):** `yield` = income ÷ invested × 100 (null if invested = 0)

### 4.4 Properties — `/properties`

Module id: `pro` · code prefix: `PRO` · group: Real estate. Properties, occupancy, NOI margin.

**Cascade delete:** deleting a record also deletes: `/units` (via `property`), `/leases` (via `property`), `/work-orders` (via `property`), `/renovation-projects` (via `property`), `/inspections` (via `property`), `/capex-items` (via `property`).

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** · Example: Orchid Tower |
| `type` | enum | yes | `Multifamily`, `Single-family`, `Commercial`, `Mixed use`, `Land` |
| `entity` | reference → /entities |  |  |
| `area` | string (≤120) | yes | Orlando, 32801 |
| `year` | integer |  |  |
| `sqft` | integer |  |  |
| `units` | integer | yes |  |
| `occupied` | integer |  |  |
| `price` | decimal (USD) |  |  |
| `buyDate` | date (YYYY-MM-DD) |  |  |
| `value` | decimal (USD) |  |  |
| `rev` | decimal (USD) |  |  |
| `opex` | decimal (USD) |  |  |
| `status` | enum | yes | **status** · `Owned`, `Managed`, `For sale`, `Sold` |
| `note` | string (≤600) |  |  |

**Server-computed, read-only (never accepted on write):** `occupancy` = occupied ÷ units × 100 · `noiMargin` = (rev − opex) ÷ rev × 100 · `opexRatio` = opex ÷ rev × 100 (rev/opex are monthly; null when denominator is 0)

### 4.5 Rental units — `/units`

Module id: `unt` · code prefix: `UNT` · group: Real estate. Unit code, status, vacancy start.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `label` | string (≤120) | yes | **display title** · A-101 |
| `property` | reference → /properties | yes |  |
| `type` | enum |  | `Studio`, `1 bedroom`, `2 bedrooms`, `3 bedrooms`, `Commercial` |
| `sqft` | integer |  |  |
| `beds` | integer |  |  |
| `baths` | integer |  |  |
| `listRent` | decimal (USD) |  |  |
| `vacantSince` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Occupied`, `Vacant`, `Vacating soon`, `Under repair`, `Off market` |

### 4.6 Leases — `/leases`

Module id: `lse` · code prefix: `LSE` · group: Real estate. By unit code, no tenant names.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `unit` | string (≤120) | yes | **display title** · A-101 |
| `property` | reference → /properties | yes |  |
| `start` | date (YYYY-MM-DD) | yes |  |
| `end` | date (YYYY-MM-DD) | yes |  |
| `rent` | decimal (USD) |  |  |
| `deposit` | decimal (USD) |  |  |
| `renewal` | string (≤600) |  |  |
| `status` | enum | yes | **status** · `Upcoming`, `In force`, `Expiring soon`, `Expired`, `Renewed`, `Terminated` |

### 4.7 Rent collection — `/rent-collections`

Module id: `rnt` · code prefix: `RNT` · group: Real estate. Summary by month and unit code.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `month` | string (≤120) | yes | 2026-11 |
| `unit` | string (≤120) | yes | **display title** ·  |
| `due` | decimal (USD) |  |  |
| `collected` | decimal (USD) |  |  |
| `lastDate` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Paid in full`, `Partial`, `Unpaid`, `Overdue` |
| `note` | string (≤600) |  |  |

**Server-computed, read-only (never accepted on write):** `rate` = collected ÷ due × 100, clamped to 0–100

### 4.8 Maintenance — `/work-orders`

Module id: `wo` · code prefix: `WO` · group: Real estate. Work orders, severity, due dates.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `desc` | string (≤120) | yes | **display title** ·  |
| `property` | reference → /properties | yes |  |
| `unit` | string (≤120) |  | A-101 or Common area |
| `category` | enum | yes | `Plumbing`, `Electrical`, `HVAC`, `Appliances`, `Roof`, `Landscaping`, `Fire safety`, `Other` |
| `severity` | enum | yes | `Urgent`, `High`, `Normal` |
| `vendor` | reference → /vendors |  |  |
| `est` | decimal (USD) |  |  |
| `actual` | decimal (USD) |  |  |
| `due` | date (YYYY-MM-DD) |  |  |
| `done` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `New`, `Assigned`, `In progress`, `Awaiting parts`, `Completed`, `Cancelled` |

### 4.9 Contractor — `/vendors`

Module id: `vnd` · code prefix: `VND` · group: Real estate. Company, license, insurance.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `company` | string (≤120) | yes | **display title** ·  |
| `service` | enum | yes | `Plumbing`, `Electrical`, `HVAC`, `Roof`, `Landscaping`, `Fire safety`, `Construction`, `General` |
| `license` | string (≤120) |  |  |
| `licenseExp` | date (YYYY-MM-DD) |  |  |
| `insExp` | date (YYYY-MM-DD) |  |  |
| `email` | string (≤120) |  | Company contact detail: email/phone allowed |
| `phone` | string (≤120) |  | Company contact detail: email/phone allowed |
| `rating` | integer |  |  |
| `status` | enum | yes | **status** · `Active`, `Suspended` |

### 4.10 Renovation projects — `/renovation-projects`

Module id: `ren` · code prefix: `REN` · group: Real estate. Progress, permits, contractors.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `property` | reference → /properties | yes |  |
| `scope` | string (≤600) |  |  |
| `budget` | decimal (USD) |  |  |
| `actual` | decimal (USD) |  |  |
| `vendor` | reference → /vendors |  |  |
| `start` | date (YYYY-MM-DD) |  |  |
| `end` | date (YYYY-MM-DD) |  |  |
| `percent` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `permit` | string (≤120) |  |  |
| `permitExp` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Planned`, `Permitting`, `In construction`, `Final inspection`, `Finished`, `On hold` |

### 4.11 Property inspections — `/inspections`

Module id: `ins` · code prefix: `INS` · group: Real estate. Periodic inspections by category.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `category` | enum | yes | **display title** · `Roof`, `Structure`, `Electrical`, `Plumbing & drainage`, `HVAC`, `Fire safety`, `Elevator`, `Parking`, `Landscaping` |
| `property` | reference → /properties | yes |  |
| `date` | date (YYYY-MM-DD) | yes |  |
| `inspector` | string (≤120) |  |  |
| `result` | enum | yes | **status** · `Good`, `Watch`, `Urgent repair` |
| `note` | string (≤600) |  |  |

### 4.12 Capital plan — `/capex-items`

Module id: `cpx` · code prefix: `CPX` · group: Real estate. Major items due for replacement in 1 / 3 / 5 years.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `item` | enum | yes | **display title** · `Roof`, `HVAC`, `Elevator`, `Exterior paint`, `Pavement`, `Water system` |
| `property` | reference → /properties | yes |  |
| `lastYear` | integer | yes |  |
| `life` | integer | yes |  |
| `cost` | decimal (USD) |  |  |
| `bucket` | enum |  | **status** · `Within 1 year`, `Within 3 years`, `Within 5 years`, `After 5 years` |

**Server-computed, read-only (never accepted on write):** `dueYear` = lastYear + life · `bucket` by years left (dueYear − current year): ≤1 → `Within 1 year`, ≤3 → `Within 3 years`, ≤5 → `Within 5 years`, else `After 5 years`

### 4.13 Reserve fund — `/reserves`

Module id: `res` · code prefix: `RES` · group: Real estate. Reserve as a share of planned need.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `entity` | reference → /entities | yes | **display title** ·  |
| `fund` | decimal (USD) | yes |  |
| `need` | decimal (USD) | yes |  |

**Server-computed, read-only (never accepted on write):** `coverage` = fund ÷ need × 100

### 4.14 Cash flow — `/cash-flows`

Module id: `cf` · code prefix: `CF` · group: Financials. Income and expenses by entity and type.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `dir` | enum | yes | **status** · `Income`, `Expense` |
| `category` | enum | yes | **display title** · `Rent`, `Dividends`, `Interest`, `Asset sale`, `Other income`, `Property tax`, `Insurance`, `Utilities`, `Repairs & maintenance`, `Professional fees`, `Management fees`, `Loan interest`, `Other business expenses` |
| `entity` | reference → /entities | yes |  |
| `amount` | decimal (USD) | yes |  |
| `date` | date (YYYY-MM-DD) | yes |  |
| `note` | string (≤600) |  |  |

### 4.15 Annual budget — `/budgets`

Module id: `bud` · code prefix: `BUD` · group: Financials. Actual vs. budget.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `category` | enum | yes | **display title** · `Property tax`, `Insurance`, `Utilities`, `Repairs & maintenance`, `Professional fees`, `Management fees`, `Other business expenses` |
| `entity` | reference → /entities | yes |  |
| `year` | integer | yes |  |
| `budget` | decimal (USD) | yes |  |
| `actual` | decimal (USD) |  |  |

**Server-computed, read-only (never accepted on write):** `usage` = actual ÷ budget × 100

### 4.16 Loan — `/loans`

Module id: `ln` · code prefix: `LN` · group: Financials. LTV, DSCR, maturity schedule.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `lender` | string (≤120) | yes | **display title** ·  |
| `property` | reference → /properties |  |  |
| `entity` | reference → /entities |  |  |
| `principal` | decimal (USD) |  |  |
| `balance` | decimal (USD) | yes |  |
| `collateral` | decimal (USD) |  |  |
| `noi` | decimal (USD) |  |  |
| `payment` | decimal (USD) |  |  |
| `rate` | decimal (percent, e.g. 6.5 = 6.5%) | yes |  |
| `rateType` | enum |  | `Fixed`, `Floating` |
| `term` | integer |  |  |
| `start` | date (YYYY-MM-DD) |  |  |
| `maturity` | date (YYYY-MM-DD) | yes |  |
| `refi` | string (≤600) |  |  |
| `status` | enum | yes | **status** · `Active loan`, `Maturing soon`, `Paid off` |

**Server-computed, read-only (never accepted on write):** `ltv` = balance ÷ collateral × 100 · `dscr` = noi ÷ (payment × 12)

### 4.17 Financial goals — `/goals`

Module id: `gl` · code prefix: `GL` · group: Financials. Progress against shared goals.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `metric` | enum | yes | `Months of liquidity`, `Occupancy rate (%)`, `NOI margin (%)`, `LTV (%)`, `Number of properties`, `Target weight (%)` |
| `target` | decimal | yes |  |
| `current` | decimal | yes |  |
| `due` | date (YYYY-MM-DD) |  |  |
| `state` | enum |  | **status** · `Tracking`, `Met`, `Late` |
| `note` | string (≤600) |  |  |

### 4.18 Deals — `/deals`

Module id: `dl` · code prefix: `DL` · group: Investing. Buy/sell pipeline as a drag-and-drop Kanban.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `side` | enum |  | `Buy`, `Sell` |
| `area` | string (≤120) |  |  |
| `type` | enum |  | `Multifamily`, `Single-family`, `Commercial`, `Mixed use`, `Land`, `Investments` |
| `ask` | decimal (USD) |  |  |
| `offer` | decimal (USD) |  |  |
| `noi` | decimal (USD) |  |  |
| `cap` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `source` | string (≤120) |  |  |
| `owner` | string (≤120) |  |  |
| `stage` | enum | yes | **status** · `Screening`, `Analysis`, `Offer`, `Due diligence`, `Closed deal`, `Rejected` |
| `note` | string (≤600) |  |  |

**Extra field `dd`** (due-diligence checklist, object): keys `Legal & title`, `Building inspection`, `Environmental`, `Insurance`, `Existing leases`, `Tax`, `Financials`; each value `To do` | `In progress` | `Done` (missing key = `To do`).

### 4.19 Buy boxes — `/buy-boxes`

Module id: `bb` · code prefix: `BB` · group: Investing. Buy criteria matched against deals automatically.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `type` | enum |  | `Multifamily`, `Single-family`, `Commercial`, `Mixed use`, `Land` |
| `area` | string (≤120) |  |  |
| `unitsMin` | integer |  |  |
| `unitsMax` | integer |  |  |
| `capMin` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `ltvMax` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `dscrMin` | decimal |  |  |
| `other` | string (≤600) |  |  |

### 4.20 Watchlist — `/watchlist`

Module id: `wl` · code prefix: `WL` · group: Investing. Areas / asset types under observation.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `note` | string (≤600) |  |  |
| `added` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Watching`, `Priority`, `Dropped` |

### 4.21 Decision log — `/decision-notes`

Module id: `dec` · code prefix: `DEC` · group: Investing. Expected vs. actual.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `title` | string (≤120) | yes | **display title** ·  |
| `type` | enum | yes | `Buy`, `Hold`, `Sell`, `Refinance`, `Renovate` |
| `date` | date (YYYY-MM-DD) | yes |  |
| `related` | string (≤120) |  |  |
| `thesis` | string (≤600) |  |  |
| `assumption` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `expected` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `review` | date (YYYY-MM-DD) |  |  |
| `actual` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `lesson` | string (≤600) |  |  |
| `status` | enum | yes | **status** · `Decided`, `Pending review`, `Reviewed` |

### 4.22 Analysis scenarios — `/scenarios`

Module id: `scn` · code prefix: `SCN` · group: Investing. Ratio assumptions saved from the Toolkit.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `tool` | enum |  | `Purchase analysis`, `Loan`, `Renovate`, `Hold or sell`, `Rebalancing`, `NPV / IRR`, `Sensitivity` |
| `rate` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `vacancy` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `growth` | decimal (percent, e.g. 6.5 = 6.5%) |  |  |
| `result` | string (≤120) |  | Cap rate 6.8%, DSCR 1.31x |
| `link` | string (≤120) |  |  |

### 4.23 Policies & limits — `/policies`

Module id: `pol` · code prefix: `POL` · group: Strategy & risk. Usage against limits.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `kind` | enum | yes | `Maximum`, `Minimum` |
| `limit` | decimal | yes |  |
| `unit` | enum |  | `%`, `months`, `x` |
| `scope` | string (≤120) |  |  |
| `usage` | decimal | yes |  |
| `state` | enum |  | **status** · `Within limit`, `Over limit` |
| `note` | string (≤600) |  |  |

**Server-computed, read-only (never accepted on write):** `state` = for kind `Maximum`: `Within limit` if usage ≤ limit; for `Minimum`: `Within limit` if usage ≥ limit; otherwise `Over limit`

### 4.24 Risk register — `/risks`

Module id: `rsk` · code prefix: `RSK` · group: Strategy & risk. Likelihood × impact heat map.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `desc` | string (≤120) | yes | **display title** ·  |
| `category` | enum | yes | `Market`, `Interest rate`, `Liquidity`, `Concentration`, `Counterparty`, `Operating`, `Property condition`, `Natural disaster`, `General legal` |
| `related` | string (≤120) |  |  |
| `likelihood` | integer | yes |  |
| `impact` | integer | yes |  |
| `mitigation` | string (≤600) |  |  |
| `owner` | string (≤120) |  |  |
| `review` | date (YYYY-MM-DD) |  |  |
| `status` | enum | yes | **status** · `Open`, `Mitigating`, `Accepted`, `Closed` |

**Server-computed, read-only (never accepted on write):** `score` = likelihood × impact · `level` = `High` if score ≥ 15, `Medium` if ≥ 8, else `Low`

### 4.25 Portfolio reviews — `/portfolio-reviews`

Module id: `prv` · code prefix: `PRV` · group: Strategy & risk. Quarterly / annual sessions with a checklist.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `period` | enum | yes | `Quarter`, `Year` |
| `date` | date (YYYY-MM-DD) |  |  |
| `ok` | integer |  |  |
| `watch` | integer |  |  |
| `act` | integer |  |  |
| `note` | string (≤600) |  |  |
| `status` | enum | yes | **status** · `In review`, `Completed` |

### 4.26 Queue — `/queue-items`

Module id: `q` · code prefix: `Q` · group: Work. Shared work queue, Kanban by status.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `title` | string (≤120) | yes | **display title** ·  |
| `type` | enum | yes | `Maintenance`, `Due diligence`, `Lease renewal`, `Vacant unit`, `Loan`, `Service provider`, `Manual` |
| `source` | string (≤120) |  |  |
| `priority` | enum | yes | `Urgent`, `High`, `Normal` |
| `target` | date (YYYY-MM-DD) |  |  |
| `assignee` | string (≤120) |  |  |
| `status` | enum | yes | **status** · `Waiting`, `Claimed`, `In progress`, `On hold`, `Done` |
| `note` | string (≤600) |  |  |

**Extra field `auto`** (boolean, server-set): `true` for items generated by the rules in §6. Auto items are system-created; users may still edit/delete them.

### 4.27 To-dos — `/tasks`

Module id: `tk` · code prefix: `TK` · group: Work. Reminders by due date.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `title` | string (≤120) | yes | **display title** ·  |
| `related` | string (≤120) |  |  |
| `owner` | string (≤120) |  |  |
| `due` | date (YYYY-MM-DD) | yes |  |
| `priority` | enum | yes | `Urgent`, `High`, `Normal` |
| `status` | enum | yes | **status** · `To do`, `In progress`, `Done` |

### 4.28 Service provider — `/service-providers`

Module id: `sp` · code prefix: `SP` · group: Reference data. Accounting, legal, tax, insurance, banking.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `company` | string (≤120) | yes | **display title** ·  |
| `type` | enum | yes | `Accounting`, `Attorney`, `Tax advisor`, `Investment advisor`, `Insurance`, `Property management`, `Bank` |
| `scope` | string (≤600) |  |  |
| `start` | date (YYYY-MM-DD) |  |  |
| `end` | date (YYYY-MM-DD) |  |  |
| `fee` | decimal (USD) |  |  |
| `rating` | integer |  |  |
| `status` | enum | yes | **status** · `Active`, `Expiring soon`, `Expired` |

### 4.29 Counterparty — `/partners`

Module id: `pt` · code prefix: `PT` · group: Reference data. Lenders, brokers, insurers, buyers and sellers.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `company` | string (≤120) | yes | **display title** ·  |
| `type` | enum | yes | `Lender`, `Broker`, `Property manager`, `Insurer`, `Title insurer`, `Seller`, `Buyer`, `Investment partner` |
| `city` | string (≤120) |  |  |
| `website` | string (≤120) |  | Company contact detail: email/phone allowed |
| `email` | string (≤120) |  | Company contact detail: email/phone allowed |
| `phone` | string (≤120) |  | Company contact detail: email/phone allowed |
| `note` | string (≤600) |  |  |

### 4.30 Saved comparisons — `/comparisons`

Module id: `cmp` · code prefix: `CMP` · group: Asset analysis. Pick 2 to 4 properties by code.

| Field | Type | Req. | Values / notes |
|---|---|---|---|
| `name` | string (≤120) | yes | **display title** ·  |
| `codes` | string (≤120) | yes |  |


---

## 5. Validation rules (server must enforce; the client also checks)

* **Required** fields per §4. Strings trimmed; `string(≤120)` / `string(≤600)` length limits.
* **Numbers:** integers `0 … 100,000,000`; decimals `≥ 0`; percent `≤ 1000`; money `≤ 1e12`.
* **Ranges:** `rating`, `likelihood`, `impact` → integer 1–5. `year`, `lastYear` → 1800–2200 (0 allowed for “n/a”). Dates 1990-01-01 … 2100-12-31. If both `start` and `end` exist, `end ≥ start`.
* **Enums:** reject values not listed in §4.
* **PII / sensitive-data filter** on every free-text field (`string`): reject with `422` if the text matches:
  * SSN `\b\d{3}-\d{2}-\d{4}\b`; EIN `\b\d{2}-\d{7}\b`
  * card-like `\b(?:\d[ -]?){13,19}\b`; account-like `\b\d{9,}\b`
  * email `[\w.+-]+@[\w-]+\.[\w.-]+` and phone `(\+?\d[\s().-]?){7,}` — **except** fields flagged “Company contact detail” (vendor `email`/`phone`; partner `website`/`email`/`phone`), which still reject card/SSN/EIN/account patterns.
  Also keep a keyword filter and cap record counts per install/day.
* The app must never collect tenant/borrower/family names; there are no such fields.

---

## 6. Server-generated Queue items (`/v1/queue-items`, `auto = true`)

Re-evaluate after every write to the source record (or on a schedule). For each source record: if the condition holds and no auto item exists for (`source` = source id, `type`), create one with status `Waiting`; if one exists with status `Done` and the condition still holds, reopen to `Waiting` (deleted auto items come back); if the condition no longer holds, set matching auto items to `Done`.

| Source | Queue `type` | Condition | Title | Priority | Target date |
|---|---|---|---|---|---|
| Lease | `Lease renewal` | `end` within the next 60 days and status ∉ {`Renewed`,`Terminated`} | `Renew lease <unit>` | Normal | `end − 20 days` |
| Work order | `Maintenance` | status = `New` | `Assign contractor: <desc>` | work order `severity` | work order `due` |
| Unit | `Vacant unit` | status = `Vacant` | `Leasing plan for <label>` | Normal | today + 7 d |
| Loan | `Loan` | maturity ≤ 365 days, status ≠ `Paid off`, and `refi` empty | `Refinancing plan — <lender>` | High | `maturity − 90 days` |
| Service provider | `Service provider` | `end` ≤ 45 days away and status ≠ `Expired` | `Renew service contract — <company>` | Normal | `end` |
| Deal | `Due diligence` | stage ∈ {`Due diligence`, `Analysis`} | `Due diligence on <name>` | High | today + 7 d |

(Spec also mentions auto items for decision reviews and risk reviews that are due, and portfolio review sessions — not yet implemented in the client; add if desired.)
Queue statuses: `Waiting`, `Claimed`, `In progress`, `On hold`, `Done`. “Claim” in the app sets `assignee` and status `Claimed`.

---

## 7. Dashboard & report endpoints (computed server-side)

The app currently computes these locally from the records; the API should expose them so the client can stop doing so. All support optional `?entity=<entityId>` (filters records that have an `entity` field: asset classes, properties, budgets, cash flows, loans, reserves).

### 7.1 `GET /v1/reports/dashboard?entity=`

```json
{
  "entities": 4,
  "properties": 5, "units": 54, "vacantUnits": 5,
  "occupancy": 90.7, "noiMargin": 58.3, "opexRatio": 41.7, "budgetUsage": 98.2,
  "allocation": [{ "group": "Real estate", "actual": 57.8, "target": 55.0 }],
  "income": [{ "category": "Rent", "share": 75.0 }],
  "cashFlow": { "positive": true, "netPct": 38.0 },
  "liquidity": { "months": 45.7, "minimum": 9 },
  "debt": { "avgLtv": 49.0, "minDscr": 1.23, "maturingWithin12Months": 1, "ladder": [{ "year": 2027, "count": 1 }] },
  "policies": { "within": 4, "over": 2 },
  "risks": { "high": 2, "medium": 3, "low": 3, "heat": [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]] },
  "workOrders": { "open": 3, "overdue": 1, "avgDaysToClose": 13 },
  "leases": { "expiringIn60Days": 2, "renewalRate": 72.0 },
  "capex": { "within1y": 1, "within3y": 2, "within5y": 3, "reserveCoverage": 64.0 },
  "queue": { "byType": { "Maintenance": 2 }, "overdue": 2, "avgWaitDays": 0, "onTimePct": 87.0 },
  "deals": { "Screening": 2, "Analysis": 2, "Offer": 1, "Due diligence": 1, "Closed deal": 0, "Rejected": 1 },
  "tasks": { "dueWithin7Days": 1, "overdue": 1 },
  "goalsProgress": 83.0,
  "updatedAt": "2026-11-05T15:40:00Z"
}
```

Definitions (all percentages rounded as the client displays them, 1 dp):

* `entities` = count of entities with status `Active`.
* `properties` = properties with status ≠ `Sold`; `units`/`occupied` = Σ over those; `vacantUnits = units − occupied`; `occupancy = Σoccupied ÷ Σunits × 100`.
* `noiMargin = (Σrev − Σopex) ÷ Σrev × 100`; `opexRatio = Σopex ÷ Σrev × 100` (properties' monthly rev/opex).
* `budgetUsage = Σactual ÷ Σbudget × 100` over budget lines.
* `allocation[].actual` = asset-class `value` ÷ Σvalues × 100; `target` from the record.
* `income[]` = share of cash-flow records with `dir = Income`, grouped by category (`Rent`, `Dividends`, `Interest`; any other category → `Other income`).
* `cashFlow.netPct = (Σincome − Σexpense) ÷ Σincome × 100`; `positive = Σincome ≥ Σexpense`.
* `liquidity.months = Σ(asset class "Cash equivalents" value) ÷ Σ(expense cash flows of the period)`; `minimum` = `limit` of the policy whose name contains “liquidity” (default 9).
* `debt`: over loans with status ≠ `Paid off` — `avgLtv` mean of `ltv`, `minDscr` min of `dscr`, `maturingWithin12Months` = maturity within 365 d, `ladder` = count by maturity year.
* `risks` count only status ≠ `Closed`; `heat[impact−1][likelihood−1]` = count.
* `workOrders.open` = status ∉ {`Completed`,`Cancelled`}; `overdue` = open with `due` < now; `avgDaysToClose` = mean(`done` date − created date), each clamped to 1–30 days, over `Completed`.
* `leases.expiringIn60Days` = `end` within next 60 days; `renewalRate = Renewed ÷ (Renewed + Expired + Terminated) × 100` (72 when none).
* `capex.within1y/3y/5y` are **cumulative** (an item due in 1 year counts in all three); `reserveCoverage = Σfund ÷ Σneed × 100`.
* `queue.byType` counts items with status ≠ `Done`; `overdue` = those with `target` < now; `avgWaitDays` = mean days since creation; `onTimePct = (all − overdue) ÷ all × 100`.
* `tasks.dueWithin7Days` = status ≠ `Done`, due in 0–7 days; `overdue` = due before yesterday.
* `goalsProgress` = mean of min(current ÷ target, 1) × 100 over goals.

### 7.2 `GET /v1/reports/series?metric=occupancy|noiMargin&period=month|quarter|year&entity=`

Needs **historical snapshots** (the app has no history today and fakes the curve around the current value). Return `{ "labels": ["Dec","Jan",…], "values": [..] }` with 12 points for `month`, 8 for `quarter`, 5 for `year`; last point = current value. Also used by Revenue and “loss rate” charts (loss ≈ vacancy + under-collection %).

### 7.3 `GET /v1/reports/highlights?period=month|quarter|year`

Top 5 properties by `occupancy + noiMargin`; 3–5 needing attention (lowest `occupancy − opexRatio/4`); counts of new/renewed leases, avg vacancy days (units `Vacant` with `vacantSince`), work orders closed in period, deals created in period, active renovation projects (status `In construction`/`Final inspection`) with `percent`, goals with progress, next 5 milestones. (Period filtering is by `createdAt/updatedAt` / `done` date.)

### 7.4 `GET /v1/reports/properties/metrics?ids=PRO-1,PRO-2`

Per property (used by Compare, Scorecard, Map): `occupancy`, `noiMargin`, `opexRatio`, mean `ltv` and min `dscr` of its loans, mean vacancy days of its `Vacant` units, open work-order count, capex items due within 3 years. Scorecard score (0–100) per metric: occupancy as is; NOI `min(noi/70,1)×100`; expenses `100 − opex×1.4`; maintenance `100 − openWO×25`; capex `100 − capexSoon×25`; DSCR `min(dscr/1.6,1)×100` (60 if no loan) — weights admin-configurable (client lets users re-weight locally).

### 7.5 `GET /v1/reports/map`

Per city (from `area` “City, ZIP”): property count, occupancy, share of portfolio. **Never return addresses or coordinates.**

### 7.6 Calendar — `GET /v1/calendar?from=&to=`

Union of dated events: lease `end` (status ∉ Renewed/Terminated), loan `maturity` (≠ Paid off), work-order `due` (open), renovation `end` (≠ Finished), service-provider `end`, queue `target` (≠ Done), task `due` (≠ Done), risk `review` (≠ Closed), decision `review` (≠ Reviewed). Item: `{ kind, resource, id, title, info, date }` where `title` = record display title and `info` = the record subtitle.

---

## 8. Public company content (read-only, cached)

`GET /v1/public/company` — name `EALICEA'S INVESTMENTS LLC`, address `2385 Home Again Rd, Apopka, FL 32712-6458`, phone `+1 730 283 6523`, email `surveybasic@gmail.com`, website `https://ealiceainvestmentllc.vercel.app/`, industry, hours, founded year, employee count + as-of date, departments, values, timeline milestones, license numbers. Only EALICEA'S edits it (via a separate authenticated admin site, not part of the app). The app currently hard-codes these; when the endpoint exists, fields without data must be omitted so the app hides them.
`GET /v1/public/team` — leadership who consented to be shown.

## 9. Admin site (out of scope for the app, needs its own authenticated API)

Edit company/team content, lock (“close”) a period so its cash-flow / income / rent-collection records become read-only (`423 Locked` on edit/delete from the app), moderate or delete content, block abusive install ids.

---

## 10. Differences from the original spec and open decisions

1. **Money is now displayed.** The original spec made money fields write-only and forbade returning them. At the product owner's request the app now shows all amounts, so the API **must return money fields**. (Amounts: purchase price, value, rent, deposit, balances, fees, costs, budgets, etc. — every `decimal (USD)` field in §4.)
2. **Content reporting was removed** (no report button, no `/content-reports`, no `reports` counter). Moderation is admin-side only.
3. **No display-name setting, units setting or install-id screen** any more. `createdBy` will be `Anonymous` unless the client is changed back.
4. **Record history/version is hidden in the UI** but `version` is still required for concurrency control.
5. **References:** the client currently stores related records by *display title* (e.g. `property: "Orchid Court"`, `entity: "Entity B"`) and cascades deletes by title match. The API should use stable ids (`PRO-0003`) in reference fields and return the referenced record’s display title alongside (e.g. `propertyLabel`) so the UI keeps working. Decide: ids + `*Label` companion fields (recommended) vs. titles.
6. **Enum strings are the contract.** The UI colours and logic compare exact English strings (e.g. `Occupied`, `In construction`, `Done`). Keep them verbatim, or ship a codes↔labels table and tell us to map.
7. **Dates/format** are display-formatted client-side (US `MM/dd/yyyy`); the API only uses ISO.
8. **History for charts** (§7.2) requires periodic snapshots on the server.
9. **Seed/sample data** in the app is demo only and must not be loaded in production.
10. **Not built in the client yet** (specified originally, add API when needed): PDF export, CSV import of properties/units, push notifications, Play Integrity attestation, auto queue items for decision/risk review dates and portfolio-review sessions.
11. **Legal copy** (Privacy Policy / Terms) is in-app static English text; update it if the server stores/logs anything beyond install id, IP and request counts.
