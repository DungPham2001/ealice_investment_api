# EALICEA'S LLC API — integration guide for the Flutter app

Base URL: **`https://ealice-investment-api.vercel.app/v1`** (health check without prefix: `GET https://ealice-investment-api.vercel.app/health`).
Field names, enum strings and required flags of every resource are exactly those of `api-handoff.md` §4. This file lists the endpoints and what the server does on top of them.

## 1. Headers

The API is **open**: no login, no install id, no attestation token. Only the headers below are used, all optional except `If-Match` on PATCH.

| Header | When | Notes |
|---|---|---|
| `Content-Type: application/json` | bodies | |
| `Idempotency-Key` | POST (recommended) | UUID. Same key + same URL within 24 h returns the first response (`Idempotent-Replay: true`) |
| `If-Match: "<version>"` | PATCH (required) | Version you read. `"version": n` in the body also works. Missing → `428 precondition_required` |
| `X-Display-Name` | optional | Stored as `createdBy` on create; default `Anonymous` |

## 2. Conventions

* **Record**: flat JSON — `id`, `version`, `createdAt`, `updatedAt` (UTC ISO), `createdBy`, the resource fields (§3 of handoff), server-computed fields, and `<refField>Label` for every reference (e.g. `propertyLabel`, `entityLabel`, `vendorLabel`, `parentLabel`; `null` when empty). Unset optional fields come back as `null`.
* **References** are ids (`"property": "PRO-0003"`), not display titles. Unknown id → `422`.
* **Money** = decimal USD (2 dp). **Percent** `6.5` = 6.5 %. **Dates** `YYYY-MM-DD` (1990-01-01 … 2100-12-31).
* **Read-only / ignored on write**: `id`, `version`, timestamps, `createdBy` (except on create), all computed fields, `queue-items.auto`. You may safely send the whole record back.
* **Empty string / `null`** clears an optional field; clearing a required field → `422`.
* **Create** → `201` + record + `ETag: "1"` + `Location`. **PATCH** → `200` + record, new `ETag`; a PATCH that changes nothing keeps the version. **DELETE** → `204`, permanent.
* **Pagination**: `GET` list → `{ "items": [...], "nextCursor": "..." | null, "total": n }`. Pass `nextCursor` back as `cursor`.

### Errors

```json
{ "error": { "code": "validation_failed", "message": "rent: must be ≥ 0", "fields": { "rent": "must be ≥ 0" } } }
```

| HTTP | `code` | Meaning / extras |
|---|---|---|
| 400 | `bad_request` | invalid JSON / body not an object |
| 404 | `not_found` | |
| 409 | `conflict` | version mismatch → `error.current` holds the latest record (reopen it); delete blocked → `error.references` |
| 413 | `payload_too_large` | |
| 422 | `validation_failed` | `error.fields` = `{ field: message }`; also used for the sensitive-data filter (SSN, EIN, card, 9+ digit numbers, email, phone) |
| 423 | `locked` | period closed (cash-flows, rent-collections); `error.closedBefore` |
| 428 | `precondition_required` | PATCH without version |

## 3. Standard endpoints (all 30 resources)

```
GET    /v1/<resource>?q=&status=&sort=&order=&limit=&cursor=
POST   /v1/<resource>
GET    /v1/<resource>/{id}
PATCH  /v1/<resource>/{id}          (If-Match)
DELETE /v1/<resource>/{id}
```

* `q` — search in the display title + subtitle fields. `status` — filter on the resource's status field, comma separated (`status=Owned,Managed`).
* Any other field filters by equality: `?property=PRO-0003`, `?entity=ENT-0001`, `?status=…`; several values with commas; `null` = empty.
* `sort` = any field (incl. computed, e.g. `occupancy`), `order` = `asc|desc` (asc when `sort` is given). Default `createdAt desc`. `limit` default 20, max 100.

| Resource | Path | Id prefix | Status field |
|---|---|---|---|
| Entities | `/entities` | ENT | `status` |
| Asset allocation | `/asset-classes` | ACL | `drift` (computed) |
| Investments | `/investments` | INV | `status` |
| Properties | `/properties` | PRO | `status` |
| Rental units | `/units` | UNT | `status` |
| Leases | `/leases` | LSE | `status` |
| Rent collection | `/rent-collections` | RNT | `status` |
| Work orders | `/work-orders` | WO | `status` |
| Contractors | `/vendors` | VND | `status` |
| Renovation projects | `/renovation-projects` | REN | `status` |
| Property inspections | `/inspections` | INS | `result` |
| Capital plan | `/capex-items` | CPX | `bucket` (computed) |
| Reserve fund | `/reserves` | RES | — |
| Cash flow | `/cash-flows` | CF | `dir` |
| Annual budget | `/budgets` | BUD | — |
| Loans | `/loans` | LN | `status` |
| Financial goals | `/goals` | GL | `state` |
| Deals | `/deals` | DL | `stage` |
| Buy boxes | `/buy-boxes` | BB | — |
| Watchlist | `/watchlist` | WL | `status` |
| Decision log | `/decision-notes` | DEC | `status` |
| Analysis scenarios | `/scenarios` | SCN | — |
| Policies & limits | `/policies` | POL | `state` (computed) |
| Risk register | `/risks` | RSK | `status` |
| Portfolio reviews | `/portfolio-reviews` | PRV | `status` |
| Queue | `/queue-items` | Q | `status` |
| To-dos | `/tasks` | TK | `status` |
| Service providers | `/service-providers` | SP | `status` |
| Partners | `/partners` | PT | — |
| Saved comparisons | `/comparisons` | CMP | — |

### Server-computed fields (returned, never sent)

| Resource | Fields |
|---|---|
| asset-classes | `actual`, `drift` |
| investments | `yield` |
| properties | `occupancy`, `noiMargin`, `opexRatio` |
| rent-collections | `rate` |
| capex-items | `dueYear`, `bucket` |
| reserves | `coverage` |
| budgets | `usage` |
| loans | `ltv`, `dscr` |
| policies | `state` |
| risks | `score`, `level` |

Computed values are `null` when the denominator is 0. Others: `deals.dd` always returns all 7 checklist keys (missing = `"To do"`); `queue-items.auto` is `true` for server-generated items.

### Delete behaviour

* Deleting a **property** also deletes its units, leases, work-orders, renovation-projects, inspections and capex-items.
* Deleting an **entity / vendor / loan-property** link target sets optional references on other records to `null`.
* Deleting an **entity** still used by reserves, cash-flows or budgets → `409 conflict`.

### Queue (auto items)

The server creates/reopens/closes `queue-items` with `auto: true` when leases, work orders, units, loans, service providers or deals change (rules in handoff §6). Users can still edit/delete them. "Claim" = PATCH `{ "assignee": "...", "status": "Claimed" }`.

## 4. Reports & calendar (read-only)

| Endpoint | Query | Returns |
|---|---|---|
| `GET /v1/reports/dashboard` | `entity` (optional id) | the dashboard object of handoff §7.1 (always numbers, no nulls) |
| `GET /v1/reports/series` | `metric=occupancy\|noiMargin\|revenue\|lossRate` (default `occupancy`), `period=month\|quarter\|year`, `entity` | `{ metric, period, labels[], values[] }` — 12 / 8 / 5 points, last = current; `null` where no history exists yet |
| `GET /v1/reports/revenue` | `period=month\|quarter\|year` (default `month`), `entity` | revenue chart: `{ metric: "revenue", period, labels[], values[] }` — same as `series?metric=revenue`; values are USD, monthly revenue of non-sold properties, `null` where no history yet |
| `GET /v1/reports/highlights` | `period=month\|quarter\|year` | `{ period, from, to, topProperties[], needAttention[], leases{new,renewed}, avgVacancyDays, workOrdersClosed, dealsCreated, renovations[], goals[], milestones[] }` |
| `GET /v1/reports/properties/metrics` | `ids=PRO-0001,PRO-0002` (omit = all) | `{ items: [{ id, name, occupancy, noiMargin, opexRatio, ltv, dscr, avgVacancyDays, openWorkOrders, capexWithin3y, scores{occupancy,noi,expenses,maintenance,capex,dscr}, score }] }` |
| `GET /v1/reports/map` | — | `{ items: [{ city, properties, units, occupancy, share }] }` (no addresses/coordinates) |
| `GET /v1/calendar` | `from`, `to` (default today … +90 d) | `{ from, to, items: [{ kind, resource, id, title, info, date }] }` sorted by date |

Calendar `kind`: `lease-end`, `loan-maturity`, `work-order-due`, `renovation-end`, `service-provider-end`, `queue-target`, `task-due`, `risk-review`, `decision-review`.

All report endpoints are `GET`, need no headers, and `entity` (an entity id such as `ENT-0001`) is accepted by `dashboard`, `series` and `revenue`. An unknown `entity` → `404`; a bad `metric` / `period` → `422`.

### 4.1 `GET /v1/reports/highlights?period=month|quarter|year`

`from` / `to` = the calendar period that was applied (current month / quarter / year).

```json
{
  "period": "quarter", "from": "2026-10-01", "to": "2026-12-31",
  "topProperties":  [{ "id": "PRO-0003", "name": "Bay House", "occupancy": 100, "noiMargin": 63.5, "score": 163.5 }],
  "needAttention":  [{ "id": "PRO-0002", "name": "Palm Plaza", "occupancy": 66.7, "opexRatio": 59.6, "score": 51.8 }],
  "leases": { "new": 6, "renewed": 1 },
  "avgVacancyDays": 41,
  "workOrdersClosed": 1,
  "dealsCreated": 4,
  "renovations": [{ "id": "REN-0001", "name": "Lobby and corridor refresh", "status": "In construction", "percent": 42 }],
  "goals": [{ "id": "GL-0001", "name": "Reach 90% occupancy", "progress": 88.9 }],
  "milestones": [{ "kind": "task-due", "resource": "tasks", "id": "TK-0001", "title": "Send lease renewal offers", "info": "Orchid Court", "date": "2026-11-10" }]
}
```

* `topProperties`: up to 5 non-sold properties, best first; `score = occupancy + noiMargin`.
* `needAttention`: up to 5, worst first; `score = occupancy − opexRatio / 4`.
* `leases.new` = leases created in the period; `leases.renewed` = leases now `Renewed` and updated in the period.
* `avgVacancyDays` = mean days since `vacantSince` over `Vacant` units (whole days, 0 if none).
* `workOrdersClosed` = `Completed` work orders whose `done` date falls in the period; `dealsCreated` = deals created in the period.
* `renovations` = projects in `In construction` / `Final inspection`; `goals[].progress` = min(current ÷ target, 1) × 100.
* `milestones` = the next 5 calendar events (same item shape as `/calendar`, starting today).

### 4.2 `GET /v1/reports/properties/metrics?ids=PRO-0001,PRO-0002`

`ids` optional (omit = every property). Used by Compare, Scorecard and Map.

```json
{ "items": [{
  "id": "PRO-0001", "name": "Orchid Court",
  "occupancy": 91.7, "noiMargin": 61.2, "opexRatio": 38.8,
  "ltv": 49.3, "dscr": 2.45,
  "avgVacancyDays": 21, "openWorkOrders": 1, "capexWithin3y": 1,
  "scores": { "occupancy": 91.7, "noi": 87.4, "expenses": 45.7, "maintenance": 75, "capex": 75, "dscr": 100 },
  "score": 79.1
}] }
```

* `ltv` = mean LTV and `dscr` = minimum DSCR of the property's loans that are not `Paid off`; both `null` when it has no such loan.
* `scores` (each 0–100): `occupancy` as is · `noi = min(noiMargin / 70, 1) × 100` · `expenses = 100 − opexRatio × 1.4` · `maintenance = 100 − openWorkOrders × 25` · `capex = 100 − capexWithin3y × 25` · `dscr = min(dscr / 1.6, 1) × 100` (60 when no loan).
* `score` = plain average of the six `scores`. The app may re-weight `scores` locally (weights are a client setting).
* Unknown ids are simply absent from `items`.

### 4.3 `GET /v1/reports/map`

```json
{ "items": [{ "city": "Orlando", "properties": 2, "units": 36, "occupancy": 83.3, "share": 50 }] }
```

One row per city (taken from the property `area` "City, ZIP"), non-sold properties only, biggest first. `share` = this city's share of the property count (%). No addresses or coordinates are ever returned.

### 4.4 Revenue and series with `entity`

`GET /v1/reports/revenue?period=…&entity=ENT-0001` and `GET /v1/reports/series?metric=…&period=…&entity=ENT-0001` return the same shape as without `entity`, computed over that entity's properties only (`entity` is ignored for the rent-collection part of `lossRate`).

## 5. Public company content (read-only)

| Endpoint | Returns |
|---|---|
| `GET /v1/public/company` | `name, address, phone, email, website` (+ any extra fields the admin site filled in). Fields without data are omitted: hide them in the UI |
| `GET /v1/public/team` | `{ "items": [...] }` — always an array, `[]` while empty; each item is whatever the admin site stored (empty fields omitted) |

## 6. Server / admin endpoints (also open)

No keys are needed for these either; the app normally does not call them.

* `GET /v1` — index of every endpoint.
* `GET|PUT /v1/jobs/daily` — daily sync (auto queue items, monthly snapshot). Vercel Cron calls it once a day.
* `PUT /v1/admin/public/{company|team}` — edit the public content. `GET|PUT /v1/admin/closed-before` — read/set the closed period (`{ "closedBefore": "YYYY-MM-DD" | null }`).

## 7. Example

```http
POST https://ealice-investment-api.vercel.app/v1/properties
Idempotency-Key: 6f1c0c1e-6b0e-4f9e-9d57-2f0f9a8d1c11
Content-Type: application/json

{ "name": "Orchid Court", "type": "Multifamily", "area": "Orlando, 32801", "units": 24, "occupied": 22, "status": "Owned", "rev": 100000, "opex": 39500 }
```
```http
201 Created
ETag: "1"

{ "id": "PRO-0001", "version": 1, "name": "Orchid Court", "entity": null, "entityLabel": null, "units": 24, "occupied": 22,
  "occupancy": 91.7, "noiMargin": 60.5, "opexRatio": 39.5, "createdBy": "Anonymous", "...": "..." }
```
```http
PATCH https://ealice-investment-api.vercel.app/v1/properties/PRO-0001
If-Match: "1"

{ "status": "For sale" }
```
