# EALICEA'S LLC — Investment API

Node.js (Express 4) + MongoDB (Mongoose 8) cho app Flutter "EALICEA'S LLC" (`com.ealicea.investmentsdesk`).
Hợp đồng API: [docs/api-handoff.md](docs/api-handoff.md). Cùng kiến trúc với `eal_investment_api` / `ealim_metals_api`: một engine CRUD chung cho 30 resource, entry Vercel ở `api/`, test trên MongoDB in-memory.

```bash
cp .env.example .env     # đặt MONGODB_URI (database: ealicea_investment)
npm install
npm run db:init          # tạo database, 36 collection, index, hồ sơ công ty mặc định (chạy lại an toàn)
npm run dev              # http://localhost:4000  -> /health, /v1/...
npm test                 # replica set in-memory (dùng mongod local nếu có)
```

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/resources/index.js` | 30 resource: trường, enum, required, quy tắc xóa (`cascade/unlink/restrict`), trường server tính |
| `src/core/` | Engine: registry, validate, create/update/delete (+ khóa kỳ, cascade, transaction), list/search/cursor, router |
| `src/services/` | `queue.js` (auto queue §6), `reports.js` (dashboard/series/highlights/metrics/map/calendar §7), `content.js` (public §8), `jobs.js` (cron hằng ngày) |
| `src/middleware/` | không cần đăng nhập/mã thiết bị; Idempotency-Key, lỗi `{error:{code,message,fields}}` |
| `src/lib/guard.js` | Lọc dữ liệu nhạy cảm (SSN, EIN, thẻ, số tài khoản, email, điện thoại) |

## Quyết định khi handoff chưa nói rõ

* **Reference** lưu bằng id (`PRO-0003`), response thêm `<field>Label` (vd `propertyLabel`) — phương án khuyến nghị §10.5.
* **Xóa**: cascade chỉ cho `properties` → units, leases, work-orders, renovation-projects, inspections, capex-items. Các ref tùy chọn khác (entity, vendor, loan.property…) bị **unlink** (về null). Ref **bắt buộc** mà không cascade (reserves/cash-flows/budgets → entity) thì xóa bị chặn `409 conflict`.
* **List** trả `{ items, nextCursor, total }`; `limit` mặc định 20, tối đa 100; sort/filter theo trường tính toán (occupancy, bucket, state…) chạy in-memory. Ngoài `q`/`status`, mọi trường đều lọc được bằng `?field=a,b` (vd `?property=PRO-0003`).
* **Tiền** lưu dạng số nguyên cent + `currency: USD`, API trả USD thập phân.
* **Dashboard** không trả `null` (0 khi không có dữ liệu; `renewalRate` mặc định 72, `liquidity.minimum` mặc định 9). `liquidity.months` = tiền mặt tương đương ÷ tổng chi trong các cash-flow (lọc theo `entity` nếu có). `leases.expiringIn60Days` bỏ qua hợp đồng `Renewed/Terminated` (như rule queue).
* **`/reports/series`**: lịch sử lấy từ `metric_snapshots` (cron ghi mỗi ngày, tháng cũ giữ giá trị cuối tháng); tháng chưa có snapshot trả `null`, điểm cuối luôn là giá trị hiện tại. Metric: `occupancy|noiMargin|revenue|lossRate`.
* **Khóa kỳ (423)**: `cash-flows` (theo `date`) và `rent-collections` (theo `month`) khi `closedBefore` được đặt qua `PUT /v1/admin/closed-before`. Admin tối thiểu: `PUT /v1/admin/public/{company|team}`.
* **Không xác thực, không giới hạn**: mọi endpoint (kể cả `/v1/admin/*` và `/v1/jobs/daily`) đều mở, không cần key/header định danh, không rate limit (khác handoff §2/§9). Mọi `GET` đều trả data; `GET /v1` liệt kê toàn bộ endpoint.
* Chưa làm: bộ lọc từ khóa nhạy cảm (chỉ regex), auto queue cho decision/risk review (handoff ghi "chưa implement ở client").

## Deploy (Vercel)

`vercel.json` chuyển mọi request vào `api/index.js` (cache kết nối MongoDB). Chỉ cần đặt `MONGODB_URI` (và `TIMEZONE` nếu muốn), rồi chạy `npm run db:init` một lần với đúng `MONGODB_URI`. Vercel Cron gọi `/v1/jobs/daily` mỗi ngày (đồng bộ auto queue + snapshot tháng).
