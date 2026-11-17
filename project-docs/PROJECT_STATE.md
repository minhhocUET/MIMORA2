# MIMORA — Project State

**Last updated:** 2026-11-17  
**Current phase:** Phase 2 (Backend Core)  
**Current task:** P2-06 — Student Learning Attempts, Turn Persistence, Support Telemetry & Assignment Progress (+ Controlled Live TiDB Verification)

---

## 1. Product Identity

- **Project Name:** MIMORA
- **Architecture Style:** Modular Monolith (React + Vite frontend và Node.js + Express backend phục vụ cùng origin qua cổng `3000`)
- **Workspace Status:** Đã hoàn tất các PoC kiểm chứng nền tảng Phase 0; đã hoàn tất đặc tả database 22 bảng (`P1-02`/`P1-02R`/`P1-02R-FIX1`), triển khai Drizzle schema, sinh `drizzle/0000_mimora_mvp_init.sql`, **thực thi thành công migration lên TiDB Cloud Serverless database `test` (`P1-03B2B`)** và **xác minh kết nối runtime least-privilege (`P1-03B2C`)**. *(Lưu ý: `metadata.json` và `index.html` hiện vẫn giữ giá trị mặc định template; chưa triển khai auth/service endpoints Phase 1.)*

---

## 2. Product Scope (Phạm vi đã xác nhận)

- Ứng dụng web full-stack chạy trong cùng một tiến trình Node.js (development dùng Express + Vite `middlewareMode`; production dự kiến Express phục vụ static `dist/` + API `/api/v1/*`).
- Hệ quản trị cơ sở dữ liệu bắt buộc: **TiDB Cloud** (MySQL-compatible, kết nối qua `mysql2` pool + `drizzle-orm` với TLS verification bắt buộc).
- Hỗ trợ đa tổ chức (multi-tenant theo từng trường học / `organization`).
- Quản lý tài khoản và phân quyền ở backend tách biệt hoàn toàn với frontend.

---

## 3. Ba nhóm người dùng

1. **Platform Admin** (`platform_role = 'platform_admin'`): Quản trị hệ thống, quản lý tổ chức/tài khoản vận hành, quản lý và phê duyệt/publish thư viện nội dung dùng chung, và chỉ xem **aggregate insights** ẩn danh theo tổ chức (**không có `org_admin` trong MVP**).
2. **Teacher** (`organization_memberships.role = 'teacher'`): Giáo viên giảng dạy, có thể thuộc một hoặc nhiều tổ chức, chỉ truy cập lớp/học sinh được phân công, giao bài, xem bài làm lớp mình và ghi chú quan sát riêng tư (`teacher_observations`).
3. **Student** (`organization_memberships.role = 'student'`): Học sinh, **không bắt buộc có email cá nhân**; đăng nhập bằng `Org Code + Org Username + Password`, làm bài được giao và lưu trữ tiến trình/lượt tương tác của chính mình.

---

## 4. Approved Decisions (Quyết định đã phê duyệt)

| Lĩnh vực | Quyết định đã chốt | Task tham chiếu |
|---|---|---|
| **Runtime & Same-Origin** | React 19 + Vite 8 + TypeScript (frontend) và Node.js 22 + Express 4 + TypeScript (`tsx` trong dev) chạy chung một tiến trình trên `0.0.0.0:3000`, API prefix `/api/v1`. | P0-01A |
| **Database & ORM** | TiDB Cloud Serverless (`8.0.11-TiDB-v8.5.3-serverless`) kết nối qua `mysql2/promise` pool + `drizzle-orm`; bắt buộc `ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }`. | P0-01C |
| **Password Hashing** | Dùng Node.js built-in `node:crypto` `scrypt` bất đồng bộ với định dạng `scrypt$v1$N=65536,r=8,p=2,dkLen=32$<salt>$<hash>`, salt 16 bytes `randomBytes`, `timingSafeEqual`, hỗ trợ `needsRehash`. Không dùng native Argon2id addon do thiếu compiler toolchain. | P0-01D |
| **Authentication Architecture** | **Option B — Custom Authentication** trên nền Express + Drizzle + TiDB + `scrypt` + server-side sessions (`HttpOnly` cookie, SHA-256 `token_hash` lưu trên TiDB). Không dùng Better Auth vì bắt buộc `email` ở lõi và giới hạn username global. | P0-02A |
| **Documentation & Git Policy** | Khởi tạo Git cục bộ (không push khi chưa có remote) và duy trì bộ tài liệu chuẩn trong `project-docs/`. | P1-01 |
| **Database Schema Design** | Đặc tả **22 bảng** trong `project-docs/DATABASE_SCHEMA.md` (`[APPROVED]` mô hình 7 nhóm dữ liệu: `15` tenant-owned `NOT NULL`, `2` mixed-scope `NULL`-able, `5` global/root; `CHAR(36) ascii_bin` UUIDv7 Clustered PK; `DATETIME(3)` UTC; composite FKs liên bảng; `content_items` ownership FK; `sessions` membership FK; race-safe attempts + multi-round `content_approvals`; `teacher_observations` cross-entity `(org, assignment, student, attempt)` FK + author-only; Admin aggregate suppression policy). | P1-02 / P1-02R / P1-02R-FIX1 |
| **Drizzle Schema & Migration DDL** | Triển khai 22 bảng dưới `src/server/db/schema/*` (`customType` chuẩn hóa `CHARACTER SET ascii COLLATE ascii_bin`), `src/server/db/uuid.ts` (RFC 9562 UUIDv7), `drizzle.config.ts`, và thực thi thành công `drizzle/0000_mimora_mvp_init.sql` (SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`) lên TiDB database `test` (23 base tables, 51 FKs, 5 virtual generated columns). | P1-03A / P1-03A-FIX1 / P1-03B2B |
| **Database Least-Privilege & Credential Separation** | Tách 2 tài khoản TiDB scoped trên `test.*`: runtime `3rtMqHg6yoxMH5d.mimora_runtime` (`SELECT, INSERT, UPDATE, DELETE` qua `TIDB_USER`/`TIDB_PASSWORD` cho `server.ts`, đã xác minh live `P1-03B2C`) và migrator `3rtMqHg6yoxMH5d.mimora_migrator` (`SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, ALTER, INDEX` qua `TIDB_MIGRATOR_USER`/`TIDB_MIGRATOR_PASSWORD` cho `drizzle.config.ts`, fail-fast không fallback). | P1-03B2A-REVERIFY / P1-03B2A-CONFIG / P1-03B2C |

---

## 5. Technical Assumptions (Giả định kỹ thuật hiện tại)

- Container Google AI Studio Build Mode là môi trường stateless/ephemeral (`Cloud Run` + `gVisor`, `2 vCPU`, `4096 MB RAM`); mọi dữ liệu bền vững và session state phải lưu tại TiDB Cloud, không lưu bền vững trên local disk hoặc RAM.
- Khi triển khai production độc lập bên ngoài iframe AI Studio, ứng dụng sẽ chạy cùng origin qua HTTPS (phù hợp `SameSite=Lax; HttpOnly; Secure`).

---

## 6. Deferred Decisions, Assumptions & Unverified Items

1. **`[DEFERRED — PO Decision]` Chính sách mật khẩu / PIN học sinh & Lockout:** Chưa chốt độ dài tối thiểu, số lần sai `failed_login_attempts` và thời gian `locked_until` / ngưỡng khóa cứng cho Student login.
2. **`[DEFERRED — PO Decision]` Chính sách chuyển trường của học sinh:** Chưa chốt việc chuyển trường sẽ gắn `membership` mới vào cùng `user_id` cũ hay tạo `user_id` độc lập hoàn toàn để tách lịch sử giữa hai trường.
3. **`[DEFERRED — PO/Legal Decision]` Chính sách Data Retention & Deletion:** Chưa chốt thời hạn lưu giữ `sessions` hết hạn, `audit_logs`, `csv_import_jobs`, `teacher_observations` (`deleted_at`) và quy trình xóa/ẩn danh hóa dữ liệu học sinh.
4. **`[DEFERRED]` Cơ chế tính Rollup cho `org_insight_daily_snapshots`:** Chưa chốt giữa cập nhật gia tăng trong transaction, job định kỳ bên ngoài container, hay truy vấn aggregate trực tiếp kèm cache ngắn hạn.
5. **`[ASSUMPTION]` Ngưỡng Cohort Suppression (`k = 5`):** Đề xuất ngưỡng k-anonymity tối thiểu `k = 5` học sinh phân biệt + ẩn đồng nhất `< 5` + gộp `daily -> weekly -> monthly` / `all` types cho `org_insight_daily_snapshots`; chờ PO/Legal xác nhận ngưỡng cuối cùng.
6. **`[PARTIALLY VERIFIED]` Kiểm thử hành vi DML & Parity sau Migration:** Đã hoàn tất kiểm thử DML có kiểm soát bằng tài khoản runtime trên TiDB `test` cho nhóm bảng `organizations`, `users`, `organization_memberships`, `classes`, `class_teachers`, `class_enrollments`, `csv_import_jobs`, `sessions`, `audit_logs` (`P2-03`), `content_items`, `content_versions`, `content_approvals` (`P2-04`), `assignments`, `assignment_items`, `assignment_targets` (`P2-05`), và `activity_attempts`, `activity_attempt_turns`, `assignment_progress` (`P2-06` — bao gồm `T-CONC-01..03`, `uq_attempts_single_in_progress`, `uq_turns_attempt_idx`, đồng bộ tiến độ không đếm trùng qua retry, bỏ dở có chủ đích, hết hạn/thu hồi phiên và khôi phục lượt, ranh giới bài đóng read-only và phân quyền co-teacher/unassigned/admin với 0 dòng tồn dư trên toàn bộ 17 bảng). Vẫn **chưa kiểm thử thực tế**: DML cho `teacher_observations`, `org_insight_daily_snapshots` và đối chiếu đầy đủ `SHOW CREATE TABLE` parity cho toàn bộ 22 bảng. *(Lưu ý: `tidb_enable_check_constraint` vẫn là `OFF`; toàn bộ enum/domain constraints phải được kiểm tra ở service layer.)*
7. **`[DEFERRED]` Production Deployment Entry & Production HTTPS/Proxy Verification:** Chưa triển khai nhánh phục vụ static `dist/` khi `NODE_ENV=production`, script `"start"`, và chưa xác minh hành vi HTTPS/reverse proxy ở môi trường production thực tế.
8. **`[DEFERRED]` Chính sách Pepper:** Chưa quyết định có bổ sung server-side `pepper` vào quy trình hash mật khẩu hay giữ nguyên `scrypt$v1$` thuần túy.

---

## 7. Kiến trúc kỹ thuật hiện tại (Implemented vs Generated vs Service-Enforced vs Unverified)

- **Implemented (Phase 1 Foundation + Phase 2 Core through P2-05):**
  - `server.ts`, `src/server/config/env.ts`, `src/server/db/tidb.ts`, `src/server/db/uuid.ts`, `src/server/http/{errors,middleware,validation}.ts`: Runtime Express + Vite, `getDb()` / `withTransaction()` schema-typed trên TiDB, Vietnamese-first API error contract, Zod v4 request validation.
  - `src/server/security/{password-hash,scrypt-limiter,session,csrf,rate-limit}.ts` & `src/server/middleware/auth.ts`: Custom Auth (`scrypt$v1$` + `ScryptConcurrencyLimiter` max 4), SHA-256 hashed server-side `sessions` (`HttpOnly` cookie, rotation, revocation), Origin/Referer + custom header + session-bound HMAC CSRF, rate limiting, và `requireAuth` / `requireOrgContext` / `requireRole`.
  - `src/server/services/audit.service.ts`: Append-only audit writer với allowlist `AUDIT_EVENT_TYPES` và kiểm tra đệ quy chặn rò rỉ dữ liệu nhạy cảm.
  - `src/server/repositories/auth.repository.ts`, `src/server/services/auth.service.ts`, `src/server/routes/auth.routes.ts`: Admin/Teacher login, Student email-less login (`orgCode + orgUsername`), multi-org `switchOrganization`, `changePassword`, `logout`, `/me`.
  - `src/server/repositories/{org,membership,class,csv-import}.repository.ts`, `src/server/services/{org,membership,class,csv-import}.service.ts`, `src/server/routes/{organizations,admin-users,classes}.routes.ts`: Organizations CRUD, Teacher/Student provisioning & memberships (chặn chuyển trường học sinh theo PO deferral `409 STUDENT_TRANSFER_POLICY_DEFERRED`), Classes/Teachers/Enrollment roster (bảo toàn lịch sử `transferred_out`/`archived` & re-enrollment), và RFC-4180 memory-only CSV import (preview + partial-row commit, không lưu plaintext password). *(Lưu ý: `org.service.ts` và `class.service.ts` tái sử dụng event allowlist `account.*`/`membership.*` trong `AUDIT_EVENT_TYPES` do chưa được phép sửa `_shared.ts`.)*
  - `src/server/validators/content-payload.schema.ts`, `src/server/repositories/content.repository.ts`, `src/server/services/content.service.ts`, `src/server/routes/{admin-content,library}.routes.ts`: Shared SEL Content Library với Zod payload + safety validation (`scanUnsafeSelText`) cho 5 canonical types (`emotion_card`, `situation_card`, `action_card`, `social_story_card`, `communication_card`), versioning bất biến, multi-round `submit`/`approve`/`reject`/`resubmit`/`publish`/`archive`, `.for('update')` concurrency control, creator/reviewer separation (`>=2` Admin chặn self-approve `403`; `===1` Admin cho phép kèm `content.self_approved`), và Teacher published-only library (`GET /api/v1/library/content*`).
  - `src/server/repositories/assignment.repository.ts`, `src/server/services/assignment.service.ts`, `src/server/routes/assignments.routes.ts`: Class Assignments, Published Content Version Pinning (`assignment_items.content_version_id -> content_versions.id`), Creator-only mutations vs Co-teacher read-only (`403` cho non-creator), Target Student validation & activity-removal lock (`409 TARGET_HAS_ACTIVITY`), Teacher-authored Home Practice & printable guide DTO, Informational Due Dates (không chặn overdue), Read-only progress summary (`GET /api/v1/assignments/:assignmentId/progress`), và Student self-only assignment APIs (`GET /api/v1/student/assignments*`).
  - `src/server/repositories/attempt.repository.ts`, `src/server/services/attempt.service.ts`, `src/server/routes/attempts.routes.ts`: Student Learning Attempts lifecycle (`start-or-resume`, `get`, `turns`, `complete`, `abandon`), khóa `FOR UPDATE` toàn bộ truy vấn trong transaction (`REPEATABLE READ` current read trên TiDB), bảo vệ trùng `in_progress` (`uq_attempts_single_in_progress`), idempotency key & retry chủ động (`intent='retry'`), thứ tự turn & replay/conflict (`uq_turns_attempt_idx`), đồng bộ nguyên tử `assignment_progress` (không đếm trùng khi retry), tùy chọn telemetry AAC/Read-Aloud trung tính (ngữ cảnh hỗ trợ thuần túy, không suy diễn năng lực hay đánh giá đúng/sai), bảo toàn lượt `in_progress` khi hết hạn phiên (tuyệt đối không auto-abandon), giữ bản đọc-only khi bài tập đóng, không sao chép lựa chọn/cảm xúc học sinh vào `audit_logs`, và Teacher assigned-class read-only review (`GET /api/v1/assignments/:assignmentId/attempts*`).
- **Migrated & Verified Runtime Connectivity & DML Subset (TiDB `test`):**
  - `drizzle/0000_mimora_mvp_init.sql` (SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`) thực thi trên TiDB `test`: `23` base tables, `51` FKs, `5` virtual generated columns.
  - Đã xác minh live DML + transaction + composite/unique/virtual-column guards qua tài khoản runtime `3rtMqHg6yoxMH5d.mimora_runtime@%` cho `P2-02` Auth, `P2-03` Orgs/Users/Memberships/Classes/CSV (`src/server/integration/live-tidb.integration.ts`), `P2-04` Content Library & Multi-Round Approvals (`src/server/integration/p2-04-live-tidb.integration.ts`), `P2-05` Assignments & Published Pinning (`src/server/integration/p2-05-live-tidb.integration.ts`), và `P2-06` Learning Attempts & Concurrency (`src/server/integration/p2-06-live-tidb.integration.ts`, `runTag = p206test-97368327`).
- **Service-Enforced (Pending Future Phases `P2-07+`):**
  - Ép `assignment_id`/`class_id` + author-only isolation cho `teacher_observations`, và cohort suppression (`k = 5`) cho `org_insight_daily_snapshots`.
- **Pending Operator Secret Cleanup:**
  - `TIDB_MIGRATOR_USER` và `TIDB_MIGRATOR_PASSWORD` nếu còn trong Google AI Studio Secrets cần operator gỡ thủ công qua AI Studio UI.
- **Chưa triển khai (Planned):**
  - P2-07+ Private Teacher Observations & Aggregate Insights, và giao diện Frontend chính thức.

---

## 8. Tiến độ Task

### Đã hoàn thành
- `P0-00`: Workspace Inspection & Environment Audit (`PASS`)
- `P0-01A`: Express + Vite Same-Origin Runtime Proof (`PASS`)
- `P0-01B`: Browser Cookie & SameSite Verification (`PASS` — kiểm thử Preview thành công)
- `P0-01C`: TiDB Connectivity & Drizzle/mysql2 Verification (`PASS` — `8.0.11-TiDB-v8.5.3-serverless`)
- `P0-01D`: Password Hashing Feasibility (`PASS` — 9/9 unit tests; `scrypt`)
- `P0-02A`: Authentication Architecture Feasibility (Option B Custom Auth)
- `P1-01`: Project Foundation & Documentation (`PASS`)
- `P1-01-FIX`: Documentation Consistency Correction (`PASS`)
- `P1-02`: Database Schema Design & Data Integrity Specification (bản thiết kế đầu)
- `P1-02R`: Database Schema Integrity Revision (hiệu chỉnh toàn vẹn lần 1)
- `P1-02R-FIX1`: Teacher Observation Cross-Entity Integrity (hiệu chỉnh `teacher_observations` & chấp nhận làm đầu vào cho P1-03A)

- `P1-03A` & `P1-03A-FIX1`: Drizzle Schema Implementation, Email Collation Alignment (`utf8mb4_0900_ai_ci`) & Migration Generation (`PASS` cục bộ)
- `P1-03B1` -> `P1-03B1R-FIX2`: TiDB Read-Only Preflight & Target Schema Verification (`PASS` sau khi chuyển `TIDB_DATABASE` sang `test` trống với `utf8mb4`; xác nhận `tidb_enable_foreign_key=ON`, `tidb_enable_check_constraint=OFF`, `tidb_enable_clustered_index=ON`, hỗ trợ `utf8mb4_0900_ai_ci`)
- `P1-03B2A` -> `P1-03B2A-REVERIFY`: Least-Privilege Account Separation Verification (`PASS` — runtime `3rtMqHg6yoxMH5d.mimora_runtime` và migrator `3rtMqHg6yoxMH5d.mimora_migrator` xác thực thành công qua TLS 1.2+, đúng quyền trên `test.*`, `/api/v1/db/health` HTTP `200`, `test` vẫn có `0` bảng / `0` views)
- `P1-03B2A-CONFIG`: Drizzle Migrator Credential Separation (`PASS` — `drizzle.config.ts` chỉ đọc `TIDB_MIGRATOR_USER` / `TIDB_MIGRATOR_PASSWORD`, fail-fast khi thiếu, cập nhật `.env.example`, không thực thi migration)
- `P1-03B2B-PREFLIGHT` & `P1-03B2B-EXPORT`: Migration Execution Readiness Review & External Migration Package (`PASS` — xác minh artifact SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`, chuẩn bị gói ZIP sạch cho Path A)
- `P1-03B2B`: External Migration Execution on TiDB `test` (`PASS` — `23` base tables = `22` app tables + `__drizzle_migrations`, `51` FKs, `5` virtual generated columns, SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`)
- `P1-03B2C`: Runtime Post-Migration Verification (`PASS` — `GET /api/v1/db/health` HTTP `200`, `TLSv1.3`, `3rtMqHg6yoxMH5d.mimora_runtime@%` chỉ có `SELECT, INSERT, UPDATE, DELETE ON test.*`, `SELECT COUNT(*) FROM users = 0`)
- `P1-03B2D`: Post-Migration Cleanup & Documentation (`PARTIAL` — đã xóa `/mimora-p1-03b2b-external-migration.zip` khỏi workspace và cập nhật `project-docs/`; xóa `TIDB_MIGRATOR_*` khỏi AI Studio Secrets cần operator thực hiện thủ công)

- `P1-03D`: Local `.git` Restored from GitHub Remote (`f0b0c3333e1faa5e57c8d5231a6f7247d336b676`, `PASS`)
- `P2-00`: Backend Inventory & Implementation Blueprint (`READY WITH RISKS`)
- `P2-01`: Core Backend Foundation (`env`, `withTransaction`, API error contract, Zod validation, `audit.service.ts`)
- `P2-02`: Custom Authentication, Server-Side Sessions & Security (`auth.repository.ts`, `auth.service.ts`, `auth.routes.ts`, `middleware/auth.ts`, `csrf.ts`, `rate-limit.ts`, `scrypt-limiter.ts`, `session.ts`) — đã bổ sung kiểm thử live TiDB `P2-02` Auth Repository thành công trong `P2-03`
- `P2-03`: Organizations, Users, Memberships, Classes & CSV Import + Live TiDB Integration Verification (`PASS` — kiểm thử live TiDB sạch với 0 tồn dư)
- `P2-04`: Shared SEL Content Library, Versioning & Multi-Round Approval + Live TiDB Integration Verification (`PASS` — kiểm thử live TiDB `p204test-2b02bd96` sạch với 0 tồn dư)
- `P2-05`: Class Assignments, Published Content Pinning & Home Practice + Live TiDB Integration Verification (`PASS` — `assignment.{repository,service}.ts`, `assignments.routes.ts`, unit/HTTP tests + live TiDB `p205test-18bc4a29` sạch với 0 tồn dư trên 14 bảng)
- `P2-06`: Student Learning Attempts, Turn Persistence, Support Telemetry & Assignment Progress + Live TiDB Integration Verification (`PASS` — `attempt.{repository,service}.ts`, `attempts.routes.ts`, fake-repo + HTTP tests + live TiDB `p206test-97368327` xác minh `T-CONC-01..03`, `uq_attempts_single_in_progress`, `uq_turns_attempt_idx`, đồng bộ `assignment_progress`, ranh giới bài đóng & phân quyền, sạch với 0 tồn dư trên 17 bảng)

### Đang thực hiện
- Chờ Technical Lead nghiệm thu `P2-06`.

### Next Task
- `P2-07+`: Private Teacher Observations & Organization Aggregate Insights theo chỉ đạo của Technical Lead.

---

## 9. Blockers & Known Issues

Chi tiết toàn bộ issues được theo dõi tại `project-docs/KNOWN_ISSUES.md` (`KI-01` đã đóng; `KI-02` đến `KI-10` đang mở). Các điểm cần chú ý nhất hiện tại:
- `KI-02`: Nginx nội bộ ghi đè `X-Forwarded-Proto` thành `http` (`req.secure === false`, `req.protocol === 'http'`); hành vi HTTPS/proxy ở môi trường production thực tế chưa được xác minh.
- `KI-03`: Nginx nội bộ chặn mã HTTP `403`, `502`, `503`, `504` bằng trang HTML tĩnh.
- `KI-04`..`KI-05`: Chưa triển khai production static serving và authentication/authorization endpoints.
- `KI-06`: Migration 22 bảng đã thực thi (`P1-03B2B` `PASS`) và runtime `SELECT` đã xác minh (`P1-03B2C` `PASS`), nhưng còn mở kiểm thử DML, composite FKs, virtual unique guards, `SHOW CREATE TABLE` parity và dọn `TIDB_MIGRATOR_*` khỏi AI Studio Secrets.
- `KI-08`: `.git/` cục bộ đã không còn sau lần cold restart container (`2026-11-16`), chưa có remote Git.
- `KI-09`: `tidb_enable_check_constraint` xác nhận `OFF` trên TiDB Serverless; DDL đã chạy trên cluster nhưng kiểm thử thực thi các virtual generated-column unique guards và parity chi tiết vẫn chờ integration tests.
- `KI-10`: Rủi ro TiKV sequential write hotspot với `UUIDv7` Clustered PK (`tidb_enable_clustered_index = ON` đã xác nhận).
- **Account Custody & Cleanup:** Tài khoản operator `.root` và migrator `3rtMqHg6yoxMH5d.mimora_migrator` không được dùng bởi runtime code; cần operator gỡ `TIDB_MIGRATOR_USER` / `TIDB_MIGRATOR_PASSWORD` khỏi AI Studio Secrets và quản lý tách biệt ngoài runtime.
