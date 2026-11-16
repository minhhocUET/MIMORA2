# MIMORA — Architecture Specification

Tài liệu phân tách rõ giữa thành phần **`[IMPLEMENTED]`** (đã có trong mã nguồn PoC hiện tại) và **`[PLANNED]`** (kiến trúc mục tiêu đã thống nhất ở P0-02A nhưng **chưa triển khai**).

---

## 1. Tổng quan kiến trúc (Modular Monolith, Same-Origin)

- **Mô hình:** Modular Monolith chạy trong một tiến trình Node.js duy nhất trên cổng `3000` (`0.0.0.0`).
- **Luồng request hiện tại trong AI Studio container:**
  `Browser -> Cloud Run HTTPS LB -> Container nginx (:8080) -> Express + Vite (:3000)`
- **Same-origin guarantee:** Frontend React và Backend API (`/api/v1/*`) cùng phục vụ qua một origin duy nhất, gọi API bằng đường dẫn tương đối.

---

## 2. React + Vite Frontend `[IMPLEMENTED - PoC]`

- **Stack:** React `19.3.1`, Vite `8.3.8`, TypeScript `7.0.2`, Tailwind CSS `v4` (`@tailwindcss/vite`).
- **Entry points hiện tại:** `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`.
- **Trạng thái hiện tại:** `src/App.tsx` chỉ chứa giao diện PoC kiểm chứng runtime health, cookie verification và TiDB connectivity. Giao diện nghiệp vụ MIMORA chưa được xây dựng (`[PLANNED]`).
- **Ranh giới bảo mật bundle:** Vite chỉ expose biến có tiền tố `VITE_`; tuyệt đối không đặt biến database hay secrets dưới tiền tố `VITE_`. Mã server dưới `src/server/` không được import vào `src/App.tsx` hoặc frontend modules.

---

## 3. Express API & Same-Origin Server `[IMPLEMENTED - PoC]`

- **Entrypoint:** `/server.ts` chạy qua `tsx server.ts` trong development (hỗ trợ parse `--port` và `--host` do `control-plane-api` truyền vào).
- **Middleware ordering đã triển khai:**
  1. `app.set('trust proxy', 1)`
  2. Các route API `/api/v1/*` (`GET /api/v1/health`, `/api/v1/cookie-test/*`, `GET /api/v1/db/health`)
  3. Fallback `404` JSON cho mọi route `/api/*` không khớp (ngăn rơi nhầm xuống Vite SPA HTML fallback)
  4. `vite.middlewares` (`createServer` với `middlewareMode: true`, `appType: 'spa'`)
  5. Error handler tập trung (`vite.ssrFixStacktrace` + JSON `500`)
- **Production static serving `[PLANNED]`:** Chưa triển khai nhánh `NODE_ENV=production` phục vụ static `dist/` và script `"start"` trong `package.json`.

---

## 4. TiDB Cloud & Drizzle ORM / mysql2 `[IMPLEMENTED - PoC]`

- **Driver & ORM:** `mysql2` (`^3.24.6`), `drizzle-orm` (`^0.45.4`) và devDependency `drizzle-kit` (`^0.31.11`).
- **Module quản lý runtime (`/src/server/db/tidb.ts`):**
  - Đọc đúng 5 biến môi trường phía server cho ứng dụng runtime: `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` (đang gắn với tài khoản least-privilege `3rtMqHg6yoxMH5d.mimora_runtime` — chỉ có `SELECT, INSERT, UPDATE, DELETE` trên `test.*`, không có DDL, không `GRANT OPTION`, không đọc `TIDB_MIGRATOR_*`).
  - Quản lý singleton `mysql.Pool` (`connectionLimit: 5` cho PoC, `connectTimeout: 10000`, `enableKeepAlive: true`) và singleton `drizzle(poolInstance)`.
  - **TLS bắt buộc:** `ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }`. Không cho phép tắt xác thực chứng chỉ.
  - **Error sanitization:** `sanitizeDbError` chỉ ghi mã lỗi/errno/sqlState sạch ở server log và trả mã lỗi phân loại qua HTTP `500` (tránh `502`/`503` bị `nginx` thay thế bằng `warmup.html`), không bao giờ trả `err.message` thô hoặc credentials.
  - **Graceful shutdown:** `closeTiDbPool()` được gọi khi tiến trình nhận `SIGINT` / `SIGTERM`.
- **Cấu hình Schema & Migration riêng biệt (`/drizzle.config.ts`):**
  - Chỉ đọc `TIDB_HOST`, `TIDB_PORT`, `TIDB_MIGRATOR_USER`, `TIDB_MIGRATOR_PASSWORD`, `TIDB_DATABASE` (gắn với tài khoản migrator `3rtMqHg6yoxMH5d.mimora_migrator` — có `SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, ALTER, INDEX` trên `test.*`, không `DROP`/`SUPER`/`CREATE USER`/`GRANT OPTION`).
  - Kiểm tra fail-fast với thông báo lỗi đã làm sạch nếu thiếu bất kỳ biến migrator nào; tuyệt đối không fallback sang `TIDB_USER` / `TIDB_PASSWORD`. *(Lưu ý vận hành sau `P1-03B2B`: cần xóa `TIDB_MIGRATOR_*` khỏi AI Studio Secrets của runtime container để tiến trình web không kế thừa biến migrator trong môi trường.)*
- **Database Schema & Migrations (`[MIGRATED TO TiDB test — P1-03B2B PASS / P1-03B2C PASS]`):**
  - Đặc tả đầy đủ **22 bảng** (7 nhóm dữ liệu) tại `project-docs/DATABASE_SCHEMA.md`.
  - Mã nguồn Drizzle schema (`src/server/db/schema/*`), generator UUIDv7 (`src/server/db/uuid.ts`), và cấu hình `drizzle.config.ts` đã được triển khai bằng `customType` chuẩn hóa `char(36) CHARACTER SET ascii COLLATE ascii_bin`, `datetime(3)` UTC, 29 composite FKs (trong tổng 51 FKs), 30 explicit indexes và 3 virtual generated unique guards; các ràng buộc domain/role/enum/author-only và khóa `FOR UPDATE` thuộc trách nhiệm service layer (`[PLANNED]`).
  - Migration `drizzle/0000_mimora_mvp_init.sql` (SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`) đã được thực thi bên ngoài lên database `test` (`P1-03B2B` `PASS`: `23` base tables gồm `22` bảng ứng dụng + `__drizzle_migrations`, `51` FKs, `5` virtual generated columns) và tài khoản runtime `3rtMqHg6yoxMH5d.mimora_runtime@%` đã được xác minh kết nối `TLSv1.3` / `HTTP 200` (`P1-03B2C` `PASS`). Kiểm thử DML, thực thi ràng buộc composite FK, runtime virtual unique guards và đối chiếu đầy đủ `SHOW CREATE TABLE` parity vẫn mở chờ integration tests (`KI-06`, `KI-09`, `KI-10`).

---

## 5. Server-Side Password Hashing `[IMPLEMENTED - Module]`

- **Module:** `/src/server/security/password-hash.ts` (đã kiểm chứng bằng 9 unit tests tại `password-hash.test.ts`).
- **Thuật toán:** Node.js built-in `node:crypto` `scrypt` bất đồng bộ (không dùng `scryptSync`, không dùng native Argon2id addon).
- **Tham số mặc định (`DEFAULT_SCRYPT_PARAMS`):** `N = 65536`, `r = 8`, `p = 2`, `dkLen = 32` (~64 MiB/lần, đạt khuyến nghị OWASP Password Storage Cheat Sheet, tương thích container 4 GiB RAM).
- **Cơ chế an toàn:**
  - Salt ngẫu nhiên 16 bytes (`crypto.randomBytes(16)`) cho mỗi mật khẩu.
  - Định dạng lưu trữ tự mô tả: `scrypt$v1$N=65536,r=8,p=2,dkLen=32$<salt_b64url>$<hash_b64url>`.
  - So sánh bằng `crypto.timingSafeEqual`.
  - Parser kiểm tra chặt ranh giới tham số (`MAX_ALLOWED_SCRYPT_MEM_BYTES = 256 MiB`) và canonical `base64url`.
  - Hỗ trợ phát hiện nâng cấp tham số qua `needsRehash()`.

---

## 6. Authentication Architecture `[PLANNED — Quyết định từ P0-02A & P1-02]`

- **Phương án được chọn:** **Option B — Custom Authentication** trên Express + Drizzle + TiDB + `scrypt` + server-side sessions.
- **Lý do kiến trúc:** Phù hợp yêu cầu Student không có email cá nhân, hỗ trợ username unique theo từng organization và tách biệt luồng provisioning của trường học (Better Auth bị loại vì bắt buộc `email` ở lõi và giới hạn username global).
- **Thành phần dự kiến ở Phase 1:**
  - Auth routes (`/api/v1/auth/login`, `/logout`, `/me`, `/switch-organization`, v.v.) phân tách luồng đăng nhập cho `platform_admin` (không cần Org Code), `teacher` (Email hoặc Platform Username; chọn org nếu có nhiều membership), và `student` (Org Code + Org Username + Password).
  - Account provisioning & CSV import tracking (`csv_import_jobs`) cho Admin/Teacher tạo Student không cần email (tuyệt đối không lưu plaintext password trong bảng job).
  - Validation bằng `zod` (chưa cài).

---

## 7. Session & Cookie Architecture `[PLANNED]`

- **Server-side session trên TiDB (`sessions` table — đã thiết kế ở `DATABASE_SCHEMA.md`, chưa tạo trên DB):**
  - Token sinh bằng `crypto.randomBytes(32).toString('base64url')` (256-bit CSPRNG).
  - Database chỉ lưu **`token_hash = SHA-256(token)`**, tuyệt đối không lưu raw token.
  - Hỗ trợ `session_scope` (`platform_admin | teacher | student`), idle/absolute timeout phân tầng theo vai trò (Admin: 30m / 8h; Teacher: 2h / 12h; Student: 4h / 12h), explicit `revoked_at` và session ID rotation khi login / đổi tổ chức.
- **Cấu hình Cookie & Proxy Trust Boundary:**
  - Không lưu session trong `localStorage`.
  - `HttpOnly: true`, `Path: '/'`.
  - `Secure`: điều khiển tường minh bằng cấu hình môi trường (`COOKIE_SECURE=true` trên HTTPS production và AI Studio preview), **không phụ thuộc `req.secure`** vì `nginx` nội bộ container ghi đè `X-Forwarded-Proto` thành `http` (đã xác nhận qua PoC P0-01B trong trình duyệt Preview: cookie `HttpOnly; Secure; SameSite=None` gửi/nhận/xóa thành công ngay cả khi Express nhận `req.secure: false`, `req.protocol: http`, `X-Forwarded-Proto: http`; hành vi HTTPS/proxy ở production vẫn chưa xác minh).
  - `SameSite`: `'lax'` cho production standalone (first-party), `'none'` (đi kèm `Secure=true`) chỉ dùng cho ngữ cảnh preview trong cross-site iframe.

---

## 8. Multi-Tenant Data Isolation & Authorization Boundaries `[PLANNED]`

- **Mô hình định danh & vai trò MVP (`DATABASE_SCHEMA.md`):**
  - `organizations`: Chứa mã trường `code` (`UNIQUE`), trạng thái hoạt động (`active | suspended`).
  - `users`: Danh tính lõi; `email` **nullable** (không dùng email giả cho Student); `platform_username` nullable unique; `platform_role` chỉ chấp nhận `'platform_admin'` hoặc `NULL`; `password_hash`, `status` (`active | locked | disabled`).
  - `organization_memberships`: Liên kết `(user_id, organization_id)`, `role` chỉ gồm **`teacher` hoặc `student`** (**không có `org_admin` trong MVP**), `org_username` (`UNIQUE(organization_id, org_username)`), `status` (`active | disabled | transferred`).
- **Ngăn truy cập chéo tổ chức (Tenant Isolation — App + DB):**
  - Ở tầng DB: Các bảng nghiệp vụ thuộc tổ chức bắt buộc có `organization_id` và sử dụng Composite Foreign Keys `(organization_id, ...)` trỏ về `(organization_id, id)` của bảng cha để chặn tham chiếu chéo trường ngay ở tầng TiDB.
  - Ở tầng Backend: `activeOrganizationId` và `role` luôn được suy xuất từ `sessions` + kiểm tra trạng thái active hiện hành trong TiDB (`users` + `organization_memberships`). Mọi truy vấn nghiệp vụ bắt buộc lọc theo `req.auth.activeOrganizationId`; tuyệt đối không tin `organizationId` từ request payload.
- **Authorization & Data Privacy Boundaries:**
  - Tách riêng `requireAuth`, `requireOrgContext`, và `requireRole(...)` tại backend; không coi việc ẩn/hiện UI ở React là phân quyền.
  - **Content Library (`content_items`, `content_versions`, `content_approvals`):** Thư viện dùng chung toàn nền tảng với đúng 5 canonical `content_type` (`emotion_card`, `situation_card`, `action_card`, `social_story_card`, `communication_card`); phiên bản đã `published` là bất biến; Teacher chỉ truy cập bản `published`.
  - **Assignments & Attempts (`assignments`, `activity_attempts`, `activity_attempt_turns`, `assignment_progress`):** Chỉ creator sửa assignment; giáo viên cùng lớp được xem; `activity_attempts` là source of truth và `assignment_progress` được đồng bộ trong cùng transaction.
  - **Teacher Observations (`teacher_observations`):** Chỉ `author_teacher_membership_id` được đọc/sửa/xóa; giáo viên khác, `platform_admin` và `student` đều bị chặn ở backend/repository.
  - **Admin Insights Privacy (`org_insight_daily_snapshots`):** `platform_admin` chỉ được truy cập số liệu tổng hợp ẩn danh (5 nhóm chỉ số: `Participation`, `Breadth of experience`, `Choice trends`, `Support use`, `Goals`), bị chặn hoàn toàn khỏi câu trả lời cá nhân, lựa chọn cảm xúc, learning turns và teacher observations. Không thực hiện psychological profiling.

---

## 9. Security Requirements `[PLANNED]`

- **Rate limiting & chống brute-force:** Bắt buộc bảo vệ các endpoint đăng nhập trước khi gọi `verifyPassword` (đặc biệt quan trọng nếu Student dùng PIN/mật khẩu ngắn và vì `scrypt` tiêu tốn ~64 MiB RAM + ~410 ms CPU/lần).
- **CSRF protection:** Kiểm tra `Origin` / `Referer` (và/hoặc CSRF token) cho mọi request thay đổi trạng thái khi dùng cookie auth (đặc biệt quan trọng nếu dùng `SameSite=None` trong preview).
- **Audit Logging (`audit_logs`):** Ghi vết bất biến (append-only) cho sự kiện auth/session, content approval/self-approval, assignment, account/membership và security events; tuyệt đối không ghi password, hash, `token_hash`, câu trả lời học sinh hoặc `note_body` vào `metadata_json`.
- **Quản lý HTTP status qua Nginx preview:** Lưu ý `nginx` nội bộ container intercept mã `403`, `502`, `503`, `504` bằng trang HTML tĩnh; các API error handler ở preview cần lưu ý hành vi này khi tích hợp với frontend.
- **Không lộ secrets/credentials:** Không ghi password, password hash, raw session token, hoặc chuỗi kết nối DB vào logs, API responses, hoặc client bundle.
