# MIMORA — Project State

**Last updated:** 2026-11-19  
**Current phase:** Phase 4 — Attempt-Engine Parity Hardening (`KI-12` complete at code/mock level; prior `P4-02.1` persistence readiness preserved)  
**Current task:** KI-12 — Harmonize School and Family Attempt-Engine Behavior (`P4-01`/`P4-02` migrations STILL NOT executed on TiDB; stopped before `P4-03`)

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
4. **`[DEFERRED]` Cơ chế kích hoạt Rollup định kỳ cho `org_insight_daily_snapshots`:** Đã triển khai hàm tính toán rollup tường minh `computeAndUpsertOrgInsightSnapshots` trong `insight.service.ts` (không tự động ghi lúc khởi động hoặc chạy cron trong container). Vẫn **chưa chốt** cơ chế lập lịch kích hoạt bên ngoài container (external scheduler vs incremental trigger).
5. **`[ASSUMPTION]` Ngưỡng Cohort Suppression (`k = 5`):** Đã thực thi tại service layer (`insight.service.ts`) ngưỡng k-anonymity tối thiểu `k = 5` học sinh phân biệt + kiểm tra phần bù `eligible - active` + complementary suppression qua các loại nội dung và giữa các tổ chức cho `org_insight_daily_snapshots`; chờ PO/Legal xác nhận ngưỡng cuối cùng.
6. **`[DML & PARITY VERIFIED — OPERATOR SECRETS OPEN]` Kiểm thử hành vi DML & Parity sau Migration:** Đã hoàn tất kiểm thử DML có kiểm soát bằng tài khoản runtime trên TiDB `test` qua toàn bộ `P2-02`..`P2-07`: `organizations`, `users`, `organization_memberships`, `classes`, `class_teachers`, `class_enrollments`, `csv_import_jobs`, `sessions`, `audit_logs` (`P2-03`), `content_items`, `content_versions`, `content_approvals` (`P2-04`), `assignments`, `assignment_items`, `assignment_targets` (`P2-05`), `activity_attempts`, `activity_attempt_turns`, `assignment_progress` (`P2-06`), và `teacher_observations`, `student_profiles`, `student_goals`, `org_insight_daily_snapshots` (`P2-07` — `runTag = p207test-42cc2722`, xác minh `fk_obs_attempt_assignment` MySQL errno `1452`, author-only 404/403, soft-delete, profile/goal safety, `k = 5` suppression, 0 dòng tồn dư & khớp 100% pre-flight). Đồng thời đã hoàn tất đối chiếu read-only `SHOW CREATE TABLE` parity cho **toàn bộ 22/22 bảng ứng dụng** khớp `drizzle/0000_mimora_mvp_init.sql` (cột, PK, unique keys, FKs, explicit indexes, 5 virtual generated columns). Vẫn mở: dọn thủ công `TIDB_MIGRATOR_*` khỏi AI Studio Secrets và `tidb_enable_check_constraint = OFF` (buộc giữ kiểm tra enum/domain tại service layer).
7. **`[DEFERRED]` Production Deployment Entry & Production HTTPS/Proxy Verification:** Chưa triển khai nhánh phục vụ static `dist/` khi `NODE_ENV=production`, script `"start"`, và chưa xác minh hành vi HTTPS/reverse proxy ở môi trường production thực tế.
8. **`[DEFERRED]` Chính sách Pepper:** Chưa quyết định có bổ sung server-side `pepper` vào quy trình hash mật khẩu hay giữ nguyên `scrypt$v1$` thuần túy.

---

## 7. Kiến trúc kỹ thuật hiện tại (Implemented vs Generated vs Service-Enforced vs Unverified)

- **Implemented — Phase 1–2 School Core (`P2-01`..`P2-07`), Phase 3 Frontend UI (`P3-01`..`P3-04`), & Phase 4 Guardian/Family Code (`P4-01`..`P4-02.1`):**
  - **Core Runtime & Explicit 3-Mode Database Policy (`P4-02.1`):** `server.ts`, `src/server/config/env.ts`, `src/server/db/tidb.ts`, `src/server/db/uuid.ts`, `src/server/http/{errors,middleware,validation}.ts`:
    - `'tidb'`: yêu cầu đầy đủ 5 biến `TIDB_*` hợp lệ (`MIMORA_DB_MODE` trống / `auto` / `tidb`), dùng `mysql2/promise` + `drizzle-orm` (TLS `>=1.2`, `rejectUnauthorized: true`).
    - `'mock'`: chỉ kích hoạt tường minh khi `MIMORA_DB_MODE=mock` và `NODE_ENV !== 'production'` (bị chặn trong `production` với `DB_CONFIG_INVALID`). `checkTiDbHealth()` luôn trả `{ ok: false, status: 'error', mode: 'mock', database: 'mock_ephemeral', durablePersistence: false, error: { code: 'DB_MOCK_MODE_ACTIVE' } }` — tuyệt đối không mạo nhận kết nối TiDB thật.
    - `'unconfigured'`: thiếu toàn bộ hoặc một phần `TIDB_*` hoặc sai `TIDB_PORT` / `MIMORA_DB_MODE` -> giữ `/api/v1/health` HTTP `200` (Preview boot), nhưng `getDb()` / `withTransaction()` ném `AppError(500, 'DB_CONFIG_MISSING' | 'DB_CONFIG_INVALID')` để chặn silent mock writes, và `/api/v1/db/health` trả HTTP `500` JSON chi tiết (`mode`, `database: 'disconnected'`, `durablePersistence: false`).
  - **Phase 2 School Core (`P2-01`..`P2-07`):** Custom Auth (`scrypt$v1$` + server-side `sessions` + HMAC CSRF + `ScryptConcurrencyLimiter`), Organizations/Memberships/Classes/CSV Import, Shared SEL Content Library & Multi-Round Approvals, Class Assignments & Published Pinning, Student Learning Attempts (`attempt.service.ts`), Private Teacher Observations, Student Profiles/Goals, và k-anonymity (`k = 5`) Admin Insights.
  - **Phase 3 Frontend UI (`P3-01`..`P3-04`):** React 19 + Vite SPA (`src/layouts/*`, `src/components/{auth,admin,teacher,student,guardian,shared,ui}/*`, `src/i18n/{vi,en}.ts`), gồm Admin, Teacher, Student (social story, emotion/body-map/intensity/fact-vs-guess/strategy-deck/communication-board + AAC bar), và Guardian portals.
  - **Phase 4 Guardian & Family Learning Code (`P4-01`..`P4-02`):**
    - `P4-01` (`src/server/db/schema/family.ts`, `src/server/services/guardian.service.ts`, `src/server/routes/guardian.routes.ts`): Self-registration Guardian email/password, email verification token (SHA-256 hashed), school-initiated link invitation (`guardian_link_invitations`), guardian-student linking (`guardian_student_links`), shared consent/telemetry visibility, và `GET /api/v1/guardian/*`.
    - `P4-02` (`src/server/db/schema/family-learning.ts`, `src/server/services/family-learning.service.ts`, `src/server/routes/family-learning.routes.ts`): Guardian personal workspaces (`family_workspaces`), child memberships (`family_child_memberships`), family content library/custom cards (`family_content_items`, `family_content_versions`), family assignments (`family_assignments`, `family_assignment_items`), và family attempts/turns/progress (`family_attempts`, `family_attempt_turns`, `family_progress`).
    - `P4-02.1` (`src/server/db/tidb.ts`, `server.ts`, `project-docs/TIDB_MIGRATION_RUNBOOK.md`): Triển khai chính sách DB 3 chế độ tường minh (`tidb` | `mock` | `unconfigured`), preflight DDL tĩnh 36 bảng, và runbook kiểm soát migration `0001` & `0002`.
    - `KI-12` (`src/server/services/attempt-shared.ts`, `attempt.service.ts`, `family-learning.service.ts`, `family-learning.repository.ts`, `attempts.routes.ts`, `family-learning.routes.ts`, `attempt-parity.test.ts`, `project-docs/ATTEMPT_ENGINE_PARITY.md`): Đồng bộ hóa toàn bộ hợp đồng hành vi giữa School Attempt Engine và Family Attempt Engine qua helper thuần dùng chung (full-tx `.for('update')` + `runWithTransientLockRetry`, retry-after-abandon, `ATTEMPT_ALREADY_IN_PROGRESS`, superset 57 forbidden keys, JSON bounds, telemetry initialization, monotonic duration, HTTP `idempotentReplay` & abandon confirmation), giữ tách biệt hoàn toàn DB tables/authorization/Teacher-free Student independence.
- **Schema & Migration Artifacts (`36` tables trong Drizzle code vs `22` tables trên live TiDB `test`):**
  - `drizzle/0000_mimora_mvp_init.sql` (22 bảng): **ĐÃ MIGRATE & VERIFIED LIVE** trên TiDB `test` từ `P1-03B2B`..`P2-07`.
  - `drizzle/0001_mimora_p4_01_guardian_family.sql` (+6 bảng, 22 `ALTER`, 9 indexes, 5 virtual cols, SHA-256 `72afb616e99de3ee8cb20f211140710cf3547895486febc635acda53edb2e809`): **ĐÃ KIỂM TRA TĨNH (`PASS`), CHƯA MIGRATE LÊN TiDB**.
  - `drizzle/0002_mimora_p4_02_family_learning.sql` (+8 bảng, 22 FKs, 10 indexes, 5 virtual cols, SHA-256 `27c9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`): **ĐÃ KIỂM TRA TĨNH (`PASS`), CHƯA MIGRATE LÊN TiDB**.
  - Lưu ý snapshot metadata (`KI-11`): `drizzle/meta/_journal.json` chứa cả `0000`..`0002` và `drizzle-kit check` pass offline, nhưng `drizzle/meta/` hiện chỉ có `0000_snapshot.json` (chưa có `0001`/`0002` snapshots) — cấm tuyệt đối chạy `drizzle-kit generate` hoặc `drizzle-kit push`.
- **Unverified / Not Yet Run:**
  - Live TiDB integration cho `0001` (`P4-01`), `0002` (`P4-02`), và `src/server/integration/*.integration.test.ts` trong môi trường hiện tại (vì không có `TIDB_*` credentials).
  - Browser visual / authenticated E2E trên UI `P3`/`P4`.

---

## 8. Tiến độ Task

### Đã hoàn thành
- `P0-00`..`P0-02A`, `P1-01`..`P1-03D`: Nền tảng runtime, custom auth, 22-table `0000` migration lên TiDB `test`, runtime/migrator separation (`PASS`).
- `P2-01`..`P2-07`: Toàn bộ Phase 2 School Core backend + live TiDB DML & 22-table `SHOW CREATE TABLE` parity (`PASS`).
- `P3-01`..`P3-04`: Toàn bộ Frontend SPA UI cho Admin, Teacher, Student, Guardian (unit/render checks `PASS`, chưa chạy browser E2E).
- `P4-01`: Guardian account, email verification, school link invitation, & student linking (`unit/mock tests PASS`, migration `0001` chưa chạy trên TiDB).
- `P4-02`: Family workspaces, family content, family assignments, & family attempts (`unit/mock tests PASS`, migration `0002` chưa chạy trên TiDB).
- `P4-02.1`: Persistence Readiness, Runtime Database Safety & Migration Preflight (`PASS` ở mức code/tests/static DDL/runbook; **KHÔNG thực thi migration hay DML lên TiDB**):
  - Xóa silent mock fallback khi thiếu `TIDB_*`; chuẩn hóa 3 mode (`tidb`, explicit `mock`, `unconfigured`) tại `src/server/db/tidb.ts` và `/api/v1/db/health` trong `server.ts`.
  - Sửa và mở rộng `src/server/db/tidb.test.ts` (không hạ chuẩn assertion; thêm test missing/partial/invalid/mock/real-HTTP-no-fake-write).
  - Tạo shared parity contract test `src/server/services/attempt-parity.test.ts` kiểm chứng `[school]` vs `[family]`.
  - Preflight tĩnh chuỗi `0000` -> `0001` -> `0002` (36 bảng, 188 constraints, 49 standalone indexes, 0 destructive DDL, 0 Drizzle-vs-SQL parity mismatches, `drizzle-kit check` pass).
  - Tạo `project-docs/TIDB_MIGRATION_RUNBOOK.md` (13 mục, dùng placeholders, chờ phê duyệt Technical Lead).
- `KI-12`: Harmonize School and Family Attempt-Engine Behavior (`PASS` ở mức code/unit/mock-repo/mock-HTTP/regression; **KHÔNG sửa schema hay chạy migration/DML**):
  - Trích xuất `src/server/services/attempt-shared.ts` với helper thuần dùng chung cho validation JSON/text, canonical comparison, start/retry eligibility, state transitions, duration/telemetry, và `runWithTransientLockRetry()`.
  - Đưa toàn bộ 4 mutation của `family-learning.service.ts` vào `withTransaction` + `.for('update')` trong `family-learning.repository.ts`, xử lý `ER_DUP_ENTRY` và hoàn thiện parity HTTP header/response (`family-learning.routes.ts` & `attempts.routes.ts`).
  - Mở rộng `src/server/services/attempt-parity.test.ts` (Unit + Mock Repo matrix + Lock/Duplicate Concurrency + Mock HTTP Dual-Context & Family-Only Student) và tạo `project-docs/ATTEMPT_ENGINE_PARITY.md`.

### Đang thực hiện
- Chờ Technical Lead nghiệm thu `P4-02.1` + `KI-12` và phê duyệt thực thi controlled migration (`0001` -> `0002`) trên môi trường có cấu hình TiDB credentials tách biệt (`TIDB_MIGRATOR_*`).

### Next Task
- Thực thi controlled migration (`0001` -> `0002`) theo `project-docs/TIDB_MIGRATION_RUNBOOK.md` + xác minh live TiDB & concurrency trước khi chuyển sang `P4-03`.

---

## 9. Blockers & Known Issues

Chi tiết toàn bộ issues được theo dõi tại `project-docs/KNOWN_ISSUES.md` (`KI-01` đã đóng; `KI-02` đến `KI-12` đang mở). Các điểm cần chú ý nhất hiện tại:
- `KI-02` & `KI-03`: Nginx nội bộ ghi đè `X-Forwarded-Proto` thành `http` và chặn `403`/`502`/`503`/`504` bằng HTML tĩnh (`/api/v1/db/health` dùng HTTP `500` JSON để không bị chặn).
- `KI-04`..`KI-05`: Cần hoàn thiện kiểm chứng production static serving & HTTPS/proxy thực tế.
- `KI-06`, `KI-09`, `KI-10`: `TIDB_MIGRATOR_*` cleanup bởi operator, `tidb_enable_check_constraint = OFF` (validate ở Zod/service layer), và `UUIDv7` clustered index hotspot monitoring.
- `KI-11` (`[P4-02.1]`): `0001` và `0002` **chưa chạy** trên TiDB (`P4-01`/`P4-02` chỉ pass trên unit/mock), và `drizzle/meta/` thiếu `0001_snapshot.json` / `0002_snapshot.json` (cấm chạy `drizzle-kit generate`/`push`).
- `KI-12` (`[KI-12]`): Hành vi School vs Family Attempt Engine **đã được đồng bộ ở mức code, unit, mock repo & mock HTTP** (`attempt-shared.ts`, `ATTEMPT_ENGINE_PARITY.md`); chỉ giữ OPEN để xác minh khóa hàng `SELECT ... FOR UPDATE` & unique guard của `family_activity_attempts` trên TiDB thật sau khi chạy `0001`/`0002`.
- **Environment Blocker hiện tại:** Container preview hiện tại không có `TIDB_*` / `TIDB_MIGRATOR_*` secrets, nên `live-tidb` tests và migration thực tế **NOT RUN**.
