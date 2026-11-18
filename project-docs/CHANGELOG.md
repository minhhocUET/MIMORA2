# MIMORA — Changelog

Mọi thay đổi kỹ thuật và quyết định kiến trúc có bằng chứng được ghi nhận theo thứ tự thời gian. Không xóa lịch sử cũ.

---

## [P2-07] — 2026-11-18
**Mục tiêu:** Triển khai Hệ thống Quan sát Riêng tư của Giáo viên (`teacher_observations`), Hồ sơ & Mục tiêu SEL của Học sinh (`student_profiles`, `student_goals`), Bảng phân tích Tổng hợp Bảo vệ Quyền riêng tư cho Platform Admin (`org_insight_daily_snapshots`, ngưỡng `k = 5`), Kiểm thử Tích hợp Live TiDB, và Đối chiếu `SHOW CREATE TABLE` Parity cho 22 Bảng.

- **Nội dung thay đổi & kiểm tra:**
  - `src/server/repositories/observation.repository.ts`, `src/server/services/observation.service.ts`, `src/server/routes/observations.routes.ts`: Mở 5 Teacher endpoints (`/api/v1/observations*` `GET`/`POST`/`GET :id`/`PATCH :id`/`DELETE :id`). Cô lập tuyệt đối theo tác giả `author_teacher_membership_id === req.auth.organizationMembershipId` + `organizationId` + `deletedAt IS NULL` ở mọi truy vấn DB; trả `404` cho co-teacher khác trên cùng lớp (không lộ sự tồn tại), `403` cho Platform Admin / Student / giáo viên chưa được phân công. Khi có `attemptId`, khóa & kiểm tra `activity_attempts` và `assignments` trong `withTransaction`, suy diễn/ép `assignmentId` & `classId` từ DB và từ chối lệch (`422 ATTEMPT_ASSIGNMENT_MISMATCH` / `ASSIGNMENT_CLASS_MISMATCH` / `ATTEMPT_STUDENT_MISMATCH`), kiểm tra an toàn SEL không lưu nhãn chẩn đoán tâm lý và không sao chép `noteBody` vào `audit_logs` hay logs.
  - `src/server/repositories/goal.repository.ts`, `src/server/services/goal.service.ts`, `src/server/routes/goals.routes.ts`: Mở API Giáo viên được phân công (`/api/v1/students/:membershipId/profile` `GET`/`PATCH`, `/api/v1/students/:membershipId/goals` `GET`/`POST`, `/api/v1/goals/:goalId` `PATCH`/`DELETE` với soft-archive `status = 'archived'`) và API Học sinh tự đọc chính mình (`/api/v1/student/profile`, `/api/v1/student/goals`) chỉ đọc `req.auth`. Xác thực Zod + SEL safety cho `supportPreferencesJson` (chấp nhận cài đặt tiếp cận/AAC/đọc to/giác quan; chặn key chẩn đoán/điểm xếp hạng/gamification) và nội dung mục tiêu.
  - `src/server/repositories/insight.repository.ts`, `src/server/services/insight.service.ts`, `src/server/routes/admin-insights.routes.ts`: Mở `GET /api/v1/admin/insights` (`platform_admin`-only) với allowlist tham số chu kỳ lịch UTC cố định (`periodType = daily|weekly|monthly`, `snapshotDate`, `contentType`, tùy chọn `organizationId`), trả `422 INSIGHT_FILTER_FORBIDDEN` với mọi bộ lọc tùy ý (`studentId`, `teacherId`, `classId`, `assignmentId`, `goalId`, `startDate`, `endDate`, sliding windows) để chống tấn công sai phân. Thực thi ngưỡng `k = 5` (`eligible >= 5`, `active >= 5`, kiểm tra phần bù `eligible - active` không nằm trong `1..4`) và complementary suppression theo `contentType` & liên tổ chức; lan truyền `isSuppressed: true` + `null` (không bao giờ thay bằng `0`) tới mọi số đếm, tỷ lệ và `choiceTrendsSummary`. Xuất hàm rollup tất định `computeAndUpsertOrgInsightSnapshots` (không tự động ghi lúc khởi động hoặc chạy cron ngầm).
  - Kiểm thử fake-repository + HTTP (`src/server/services/p2-07.test.ts`: 4/4 suites PASS) và kiểm thử live TiDB (`src/server/integration/p2-07-live-tidb.integration.ts`, `runTag = p207test-42cc2722`): xác minh `READONLY_22_TABLE_SHOW_CREATE_TABLE_PARITY` (`22/22` bảng khớp cột/PK/unique/FK/explicit index/5 virtual generated columns), `LIVE_OBSERVATIONS_AUTHOR_ONLY_FK_AND_SOFT_DELETE` (gồm cả chặn SQL trực tiếp bởi `fk_obs_attempt_assignment` MySQL errno `1452`), `LIVE_PROFILES_AND_SEL_GOALS`, `LIVE_ADMIN_INSIGHTS_K5_AND_ANTI_DIFFERENCING`, và cleanup đảo ngược FK với `0` dòng tồn dư (`countsMatchedPreFlight = true`).
- **Files / modules affected:**
  - `server.ts`, `src/server/repositories/{observation,goal,insight}.repository.ts`, `src/server/services/{observation,goal,insight}.service.ts`, `src/server/routes/{observations,goals,admin-insights}.routes.ts`, `src/server/services/p2-07.test.ts`, `src/server/integration/p2-07-live-tidb.integration.{ts,test.ts}`, `project-docs/{PROJECT_STATE,CHANGELOG,KNOWN_ISSUES}.md`

---

## [P2-06] — 2026-11-17
**Mục tiêu:** Triển khai Hệ thống Lượt học tập của Học sinh (`activity_attempts`), Lưu trữ từng Bước tương tác (`activity_attempt_turns`), Ngữ cảnh Hỗ trợ AAC/Read-Aloud Trung tính, Đồng bộ Tiến độ Bài tập (`assignment_progress`), Kiểm thử Tương tranh trên TiDB `test`, và Giao diện Đọc-Only cho Giáo viên.

- **Nội dung thay đổi & kiểm tra:**
  - `src/server/repositories/attempt.repository.ts`: Triển khai schema-typed Drizzle repository dùng `withTransaction` và khóa hàng `SELECT ... FOR UPDATE` trên toàn bộ truy vấn đọc trong transaction (`findAndLockTargetAndItemForStudent`, `lockTargetAndLoadStudentAttempt`, `findAttemptByStartIdempotencyKey`, `findInProgressAttemptForItem`, `findAttemptAggregateStatsForItem`, `listTurnsForAttempt`, `findTurnByAttemptAndIndex`, `findAssignmentProgressByTarget`, `recomputeAndUpsertAssignmentProgress`) để đảm bảo current-read an toàn dưới chế độ `REPEATABLE READ` của TiDB Cloud Serverless.
  - `src/server/services/attempt.service.ts`: Triển khai đầy đủ vòng đời lượt học (`startOrResumeAttempt`, `getStudentAttempt`, `saveTurn`, `completeAttempt`, `abandonAttempt`) và chế độ đọc-only cho giáo viên được phân công (`listAttemptsForTeacher`, `getAttemptDetailForTeacher`): giữ nguyên phiên bản nội dung đã pin (`assignment_items.content_version_id`), khôi phục chính xác lượt `in_progress` khi học sinh đăng nhập lại sau khi hết hạn phiên (tuyệt đối không auto-abandon), hỗ trợ `intent = 'retry'` tạo lượt mới tăng dần `attempt_number` mà không đếm trùng `completedItems` trong `assignment_progress`, phân biệt phản hồi trùng hợp lệ (`200`) với xung đột `turnIndex` (`409 TURN_INDEX_CONFLICT`), hỗ trợ retry một lần có kiểm soát cho lock timeout / write conflict / `ER_DUP_ENTRY` cạnh tranh, giữ chế độ đọc-only cho bài tập đã đóng (`200 GET`, `409 POST`), áp dụng bộ lọc an toàn SEL chặn key gamification/score/chẩn đoán tâm lý trong `responsePayloadJson`/`responseSummaryJson`, coi `aacTapCount`/`readAloudCount` là ngữ cảnh hỗ trợ tùy chọn thuần túy, và không bao giờ sao chép cảm xúc/lựa chọn của trẻ vào `audit_logs` (chỉ ghi `security.unauthorized_access_denied` khi có truy cập trái phép).
  - `src/server/routes/attempts.routes.ts` & `server.ts`: Mở 5 Student endpoints dưới `/api/v1/student` (`POST /assignments/:targetId/items/:itemId/start-or-resume`, `GET /attempts/:attemptId`, `POST /attempts/:attemptId/turns`, `POST /attempts/:attemptId/complete`, `POST /attempts/:attemptId/abandon`) và 2 Teacher read-only endpoints dưới `/api/v1/assignments` (`GET /:assignmentId/attempts`, `GET /:assignmentId/attempts/:attemptId`) kèm Zod v4 validation, RBAC (`student` / `teacher` + `requireOrgContext`), authenticated CSRF cho mutations, và `405` + `Allow` headers.
  - Kiểm thử fake-repository + HTTP (`src/server/services/p2-06.attempts.test.ts`: 2/2 suites PASS) và kiểm thử live TiDB (`src/server/integration/p2-06-live-tidb.integration.ts`, `runTag = p206test-97368327`): xác minh `T-CONC-01` (10 request song song hội tụ 1 lượt `in_progress`), virtual generated guard `uq_attempts_single_in_progress` (`ER_DUP_ENTRY 1062`), thứ tự turn + `uq_turns_attempt_idx` replay/conflict + 3 hoàn thành song song, `T-CONC-02` (5 retry song song tạo tối đa 1 lượt mới + 4 `409 ATTEMPT_ALREADY_IN_PROGRESS` + replay `200`), hoàn thành item 2 & bỏ dở có chủ đích không đếm trùng tiến độ, `T-CONC-03` (hết hạn phiên HTTP `401` không mất lượt -> đăng nhập lại resume nguyên 2 turns), ranh giới bài đóng & phân quyền co-teacher/unassigned/admin, và cleanup đảo ngược FK trên 17 bảng (`assignment_progress` trước `activity_attempts`) với `0` dòng tồn dư, khớp 100% pre-flight (`countsMatchedPreFlight = true`).
- **Files / modules affected:**
  - `server.ts`, `src/server/repositories/attempt.repository.ts`, `src/server/services/attempt.service.ts`, `src/server/routes/attempts.routes.ts`, `src/server/services/p2-06.attempts.test.ts`, `src/server/integration/p2-06-live-tidb.integration.{ts,test.ts}`, `project-docs/{PROJECT_STATE,CHANGELOG}.md`

---

## [P2-05] — 2026-11-17
**Mục tiêu:** Triển khai Hệ thống Giao bài tập theo Lớp học, Pinning bất biến phiên bản Nội dung đã Xuất bản, Hướng dẫn Thực hành Tại nhà, API cho Giáo viên và Học sinh, và kiểm thử tích hợp thực tế trên TiDB `test`.

- **Nội dung thay đổi & kiểm tra:**
  - `src/server/validators/content-payload.schema.ts`: Bổ sung `scanUnsafeSelText(text, field)` dùng chung để kiểm tra an toàn nội dung SEL cho `title` và `homePracticeInstructions` của bài tập.
  - `src/server/repositories/assignment.repository.ts` & `src/server/services/assignment.service.ts`: Triển khai tạo bài tập giao dịch nguyên tử (`assignments`, `assignment_items`, `assignment_targets`) bắt nguồn `organizationId`/`teacherMembershipId` từ `req.auth`; chỉ cho phép giáo viên được phân công lớp đang hoạt động giao bài cho học sinh có `class_enrollments.status = 'active'` trong lớp; chỉ cho phép pin phiên bản `content_versions.status = 'published'` của mục nội dung chưa lưu trữ (`fk_assignment_items_version`); giữ nguyên bản v1 đã pin ngay cả khi v2 xuất bản và v1 chuyển sang `'superseded'`; phân tách co-teacher read-only vs creator-only cho chỉnh sửa/thay đổi target/đóng bài (`403` + audit bảo mật); bảo vệ `PUT /:assignmentId/targets` không cho gỡ học sinh đã có `activity_attempts`/`assignment_progress` (`409 TARGET_HAS_ACTIVITY`); trả `homePractice` & `printableGuide` thân thiện phụ huynh mà không cần Parent Portal; coi `dueAt`/`isPastDue` chỉ mang tính tham khảo (không chặn/phạt); mở `GET /api/v1/assignments/:assignmentId/progress` đọc-only và cô lập tuyệt đối phạm vi Student (`active`/`closed`, ẩn `draft`/`archived`, không lộ bạn học khác hay phê duyệt nội bộ, tuyệt đối chưa tạo `activity_attempts`/`assignment_progress`).
  - `src/server/routes/assignments.routes.ts` & `server.ts`: Mở 7 Teacher endpoints (`/api/v1/assignments*`) và 2 Student endpoints (`/api/v1/student/assignments*`) với Zod v4 validation, RBAC (`teacher`/`student` + `requireOrgContext`), authenticated CSRF cho mutations, và `405` + `Allow` headers.
  - Kiểm thử unit/HTTP (`src/server/services/p2-05.assignments.test.ts`: 2/2 suites PASS) và kiểm thử live TiDB (`src/server/integration/p2-05-live-tidb.integration.ts`, `runTag = p205test-18bc4a29`): xác minh toàn bộ ràng buộc trên TiDB thật (cross-tenant/unassigned/transferred-out, v1 pinning qua v2 publish, co-teacher `403`, target sync, past-due & draft filtering, close immutability, audit logs không rò rỉ nội dung hướng dẫn tại nhà, và cleanup đảo ngược FK trên 14 bảng với `0` dòng tồn dư, khớp 100% pre-flight).
- **Files / modules affected:**
  - `server.ts`, `src/server/validators/content-payload.schema.ts`, `src/server/repositories/assignment.repository.ts`, `src/server/services/assignment.service.ts`, `src/server/routes/assignments.routes.ts`, `src/server/services/p2-05.assignments.test.ts`, `src/server/integration/p2-05-live-tidb.integration.{ts,test.ts}`, `project-docs/{PROJECT_STATE,CHANGELOG}.md`

---

## [P2-04] — 2026-11-17
**Mục tiêu:** Triển khai Thư viện Nội dung SEL dùng chung, Versioning bất biến, Quy trình Phê duyệt Đa vòng, Thư viện Published-Only cho Giáo viên và kiểm thử tích hợp thực tế trên TiDB `test`.

- **Nội dung thay đổi & kiểm tra:**
  - `src/server/validators/content-payload.schema.ts`: Zod schema + bộ lọc an toàn SEL cho cả 5 canonical content types (`emotion_card`, `situation_card`, `action_card`, `social_story_card`, `communication_card`), hỗ trợ metadata địa phương hóa (`vi`, `vi-VN`, `en`, `en-US`), mô tả tiếp cận (`accessibleDescription`), tùy chọn `readAloud` và `aacSupport` (không bắt buộc trên mọi thẻ), đồng thời chặn timers, leaderboards, ranking, điểm cạnh tranh, trừng phạt/shaming, `isCorrect`/`correctAnswer`, và gán nhãn chẩn đoán tâm lý.
  - `src/server/repositories/content.repository.ts` & `src/server/services/content.service.ts`: Quản lý `content_items`, `content_versions` (bất biến khi `'published'` / `'superseded'`, tạo phiên bản mới qua `MAX(version_number)+1`), `content_approvals` đa vòng (`submit` -> `approve`/`reject` -> revise/resubmit tăng `submissionRound`), khóa hàng `.for('update')` xử lý cạnh tranh phê duyệt (`409 ALREADY_REVIEWED`), phân tách tác giả phiên bản `content_versions.created_by_user_id` (`>= 2` Admin active chặn self-approve `403`; `=== 1` Admin active cho phép kèm audit `content.self_approved`), xuất bản & lưu trữ (`archive`), và ghi đầy đủ 8 event `content.*` đã có sẵn trong `AUDIT_EVENT_TYPES` mà không sao chép `payloadJson` vào `metadataJson`.
  - `src/server/routes/admin-content.routes.ts`, `src/server/routes/library.routes.ts` & `server.ts`: Mở API `/api/v1/admin/content-items*`, `/api/v1/admin/content-versions*` (`platform_admin` + authenticated CSRF + Zod) và API đọc cho Teacher `/api/v1/library/content*` (`teacher` only, chỉ trả nội dung `published` + chưa lưu trữ cùng `publishedVersionId` để P2-05 pin phiên bản, ẩn nháp/chờ duyệt/từ chối/ghi chú nội bộ).
  - Kiểm thử unit/HTTP (`src/server/services/p2-04.content.test.ts`: 4/4 PASS) và kiểm thử live TiDB (`src/server/integration/p2-04-live-tidb.integration.ts`, `runTag = p204test-2b02bd96`): xác minh cả single-Admin self-approval, 5 loại nội dung, `uq_content_items_slug`, `uq_approvals_single_pending`, `uq_content_versions_item_num`, multi-Admin block, concurrent race, superseded immutability, Teacher published-only library, archive, và reverse-FK cleanup (`0` dòng tồn dư, khớp 100% pre-flight).
- **Files / modules affected:**
  - `server.ts`, `src/server/validators/content-payload.schema.ts`, `src/server/repositories/content.repository.ts`, `src/server/services/content.service.ts`, `src/server/routes/admin-content.routes.ts`, `src/server/routes/library.routes.ts`, `src/server/services/p2-04.content.test.ts`, `src/server/integration/p2-04-live-tidb.integration.{ts,test.ts}`, `project-docs/{PROJECT_STATE,CHANGELOG}.md`

---

## [P2-01 .. P2-03] — 2026-11-16
**Mục tiêu:** Triển khai lõi backend nền tảng (`P2-01`), hệ thống xác thực & phiên server-side (`P2-02`), quản trị Tổ chức / Tài khoản / Thành viên / Lớp học / Nhập CSV (`P2-03`), và thực thi kiểm thử tích hợp thực tế trên TiDB `test`.

- **Nội dung thay đổi & kiểm tra:**
  - `P2-01`: Hoàn thiện `src/server/config/env.ts` (bổ sung cấu hình `csv.maxBytes` / `csv.maxRows`), `src/server/db/tidb.ts` (`withTransaction`), `src/server/http/{errors,middleware,validation}.ts`, và `src/server/services/audit.service.ts` (allowlist + kiểm tra từ chối dữ liệu nhạy cảm đệ quy).
  - `P2-02`: Triển khai custom authentication (`auth.repository.ts`, `auth.service.ts`, `auth.routes.ts`), `middleware/auth.ts`, `security/{session,csrf,rate-limit,scrypt-limiter}.ts` hỗ trợ Admin/Teacher email hoặc username, Student email-less login (`orgCode + orgUsername`), multi-org `switchOrganization` kèm xoay vòng `token_hash`, `changePassword`, `logout`.
  - `P2-03`: Triển khai `org`, `membership`, `class`, `csv-import` repositories/services và các router `/api/v1/admin/organizations*`, `/api/v1/admin/users*`, `/api/v1/classes*` gắn vào `server.ts`. Đáp ứng quy tắc 3 vai trò MVP, chặn chuyển trường học sinh theo PO deferral (`409 STUDENT_TRANSFER_POLICY_DEFERRED`), bảo toàn lịch sử `class_enrollments`, và parser CSV RFC-4180 thuần bộ nhớ (không lưu plaintext password).
  - Kiểm thử live TiDB (`src/server/integration/live-tidb.integration.ts`, `runTag = P203TEST_72F197A8`): Xác minh DML & transaction thực tế cho cả `P2-02 AuthRepository` (admin, email-less student, multi-org teacher rotation/changePassword) và `P2-03` Repositories + composite FK `fk_class_teachers_member` + `uq_class_enrollments_active_pair`, với cleanup đảo ngược FK và số lượng dòng hậu kiểm khớp 100% trước kiểm thử (`0` tồn dư).
- **Files / modules affected:**
  - `server.ts`, `src/server/config/env.ts`, `src/server/repositories/*`, `src/server/services/*`, `src/server/routes/*`, `src/server/security/*`, `src/server/middleware/auth.ts`, `src/server/http/*`, `src/server/integration/*`, `project-docs/{PROJECT_STATE,CHANGELOG}.md`

---

## [P1-03B2D] — 2026-11-16
**Mục tiêu:** Dọn dẹp hậu migration (`mimora-p1-03b2b-external-migration.zip`), đánh giá khả năng gỡ bỏ `TIDB_MIGRATOR_*` khỏi AI Studio Secrets, và cập nhật tài liệu trạng thái dự án.

- **Nội dung thay đổi & kiểm tra:**
  - Xóa `/mimora-p1-03b2b-external-migration.zip` khỏi workspace root; kiểm tra toàn workspace xác nhận không còn file `.zip` nào khác và không có bản sao trong `public/`, `static/` hay `dist/`.
  - Kiểm tra mã nguồn (`server.ts`, `src/`, `package.json`, `vite.config.ts`) xác nhận runtime chỉ tham chiếu `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` trong `src/server/db/tidb.ts` và không phụ thuộc `TIDB_MIGRATOR_*`.
  - Ghi nhận giới hạn giao diện: Google AI Studio Secrets không hỗ trợ chỉnh sửa/xóa an toàn từ công cụ agent trong container; đã lập hướng dẫn thủ công cho operator xóa `TIDB_MIGRATOR_USER` và `TIDB_MIGRATOR_PASSWORD` qua AI Studio UI kèm full workspace restart.
  - Cập nhật `project-docs/{PROJECT_STATE,ARCHITECTURE,CHANGELOG,KNOWN_ISSUES}.md` ghi nhận kết quả `P1-03B2B` (`PASS`), `P1-03B2C` (`PASS`) và giữ mở các hạng mục chưa kiểm thử (`DML`, composite FK enforcement, virtual generated-column unique guards, `SHOW CREATE TABLE` parity, và cleanup `TIDB_MIGRATOR_*` Secrets).
- **Files / modules affected:**
  - `/mimora-p1-03b2b-external-migration.zip` (đã xóa khỏi workspace)
  - `project-docs/{PROJECT_STATE,ARCHITECTURE,CHANGELOG,KNOWN_ISSUES}.md` (cập nhật)
- **Phạm vi tuân thủ:** Không chạy migration/seed/DDL/DML, không sửa account/grants TiDB, không sửa code runtime/schema/migration SQL (`drizzle/0000_mimora_mvp_init.sql` giữ nguyên SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`).

---

## [P1-03B2C] — 2026-11-16
**Mục tiêu:** Xác minh ứng dụng runtime kết nối thành công tới database `test` đã migrate bằng tài khoản least-privilege `mimora_runtime`.

- **Bằng chứng xác minh đã ghi nhận (`PASS`):**
  - `GET /api/v1/db/health` qua cả Express (`127.0.0.1:3000`) và container Nginx (`127.0.0.1:8080`) đều trả `HTTP 200 OK` (`{"status":"ok","database":"connected","orm":"drizzle","driver":"mysql2","tls":"required-min-v1.2-verified","serverVersion":"8.0.11-TiDB-v8.5.3-serverless"}`), không lộ secrets.
  - Kết nối read-only độc lập bằng `TIDB_USER` / `TIDB_PASSWORD` xác nhận: `DATABASE() = 'test'`, `CURRENT_USER() = '3rtMqHg6yoxMH5d.mimora_runtime@%'`, `VERSION() = '8.0.11-TiDB-v8.5.3-serverless'`, `Ssl_version = TLSv1.3` (`TLS_AES_128_GCM_SHA256`), `SHOW GRANTS` chỉ gồm `USAGE ON *.*` và `SELECT, INSERT, UPDATE, DELETE ON test.*`, thấy `23` base tables, `51` foreign keys, row `__drizzle_migrations` khớp hash `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`, và `SELECT COUNT(*) FROM users` trả `0`.

---

## [P1-03B2B / P1-03B2B-PREFLIGHT / P1-03B2B-EXPORT] — 2026-11-16
**Mục tiêu:** Đánh giá sẵn sàng migration, đóng gói artifact thực thi bên ngoài (Path A), và thực thi thành công migration ban đầu lên TiDB database `test`.

- **Bằng chứng xác minh đã ghi nhận (`PASS`):**
  - `P1-03B2B-PREFLIGHT` & `P1-03B2B-EXPORT`: Kiểm tra `drizzle/0000_mimora_mvp_init.sql` (SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`, 103 statements, 0 lỗi FK tĩnh) và xuất gói ZIP sạch cho operator thực thi bên ngoài (Path A).
  - `P1-03B2B`: Thực thi migration bên ngoài thành công lên TiDB `test` bằng tài khoản migrator (`3rtMqHg6yoxMH5d.mimora_migrator`), tạo đủ `23` base tables (`22` bảng ứng dụng + `__drizzle_migrations`), `51` foreign keys, `5` virtual generated columns, ghi nhận `__drizzle_migrations` hash `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765` (`created_at = 1794764487312`).

---

## [P1-03B2A-CONFIG] — 2026-11-16
**Mục tiêu:** Tách biệt hoàn toàn credentials của Drizzle Kit (`drizzle.config.ts`) sang tài khoản migrator (`TIDB_MIGRATOR_USER` / `TIDB_MIGRATOR_PASSWORD`), tách khỏi tài khoản runtime của `server.ts` (`TIDB_USER` / `TIDB_PASSWORD`) trước `P1-03B2B`.

- **Nội dung thay đổi:**
  - Cập nhật `drizzle.config.ts` thay `TIDB_USER` / `TIDB_PASSWORD` bằng `TIDB_MIGRATOR_USER` / `TIDB_MIGRATOR_PASSWORD`, bổ sung `getMigratorDbCredentials()` fail-fast với thông báo lỗi đã làm sạch (không fallback sang credentials runtime, không log secret), giữ nguyên `dialect: 'mysql'`, `schema`, `out: './drizzle'`, `breakpoints`, `strict`, `verbose`, `ssl: { rejectUnauthorized: true }`.
  - Kiểm tra `package.json`, `server.ts`, `src/` xác nhận không có script migration nào đi vòng qua `drizzle.config.ts`; `src/server/db/tidb.ts` vẫn chỉ dùng `TIDB_USER` / `TIDB_PASSWORD`.
  - Cập nhật `.env.example` phân tách rõ biến runtime (`TIDB_USER`, `TIDB_PASSWORD`) và biến migrator (`TIDB_MIGRATOR_USER`, `TIDB_MIGRATOR_PASSWORD`) bằng placeholder rỗng.
  - Cập nhật `project-docs/{PROJECT_STATE,ARCHITECTURE,CHANGELOG,KNOWN_ISSUES}.md`.
- **Files / modules affected:**
  - `drizzle.config.ts`, `.env.example`
  - `project-docs/{PROJECT_STATE,ARCHITECTURE,CHANGELOG,KNOWN_ISSUES}.md`
- **Phạm vi tuân thủ:** Không chạy `drizzle-kit migrate` / `push` / `generate`, không chạy DDL/DML/seed, không thay đổi TiDB users/grants, không sửa `src/server/db/schema/*` hay `drizzle/*`.
- **Tests:** `tsc --noEmit`, `vite build`, `npx tsx --test src/server/db/schema.test.ts`, kiểm tra fail-fast không fallback của `drizzle.config.ts`, `npx drizzle-kit check` (với placeholder offline), kiểm tra `dist/` không chứa secrets/migrator vars.
- **Lưu ý Git:** Thư mục `.git/` không còn trong workspace sau lần cold restart container (`2026-11-16`); không tạo commit.
- **Trạng thái chấp nhận:** Hoàn tất cấu hình tách credentials; **dừng trước `P1-03B2B`** chờ Technical Lead phê duyệt.

---

## [P1-03B1 .. P1-03B2A-REVERIFY] — 2026-11-15 .. 2026-11-16
**Mục tiêu:** Kiểm tra read-only môi trường TiDB Cloud Serverless v8.5.3, chuyển target về database `test` trống, và xác minh tách tài khoản least-privilege (`3rtMqHg6yoxMH5d.mimora_runtime` & `3rtMqHg6yoxMH5d.mimora_migrator`).

- **Bằng chứng xác minh đã ghi nhận:**
  - `P1-03B1`: Xác nhận TiDB `8.0.11-TiDB-v8.5.3-serverless`, `tidb_enable_foreign_key = ON`, `tidb_enable_check_constraint = OFF`, `tidb_enable_clustered_index = ON`, `default_collation_for_utf8mb4 = utf8mb4_bin`, `utf8mb4_0900_ai_ci` (`Compiled: Yes` và biểu thức runtime `ci_eq=1`, `ai_eq=1`); phát hiện target ban đầu trỏ nhầm `sys`.
  - `P1-03B1R-FIX2`: Sau khi operator cập nhật secret `TIDB_DATABASE = test`, xác nhận `SELECT DATABASE() = 'test'`, `utf8mb4` (`utf8mb4_bin`), `0` tables, `0` views.
  - `P1-03B2A-REVERIFY`: Sau khi operator tạo 2 tài khoản và nạp Secrets, xác nhận cả `3rtMqHg6yoxMH5d.mimora_runtime` (`SELECT, INSERT, UPDATE, DELETE ON test.*`) và `3rtMqHg6yoxMH5d.mimora_migrator` (`SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, ALTER, INDEX ON test.*`) đều xác thực thành công qua TLSv1.2+ (`TLS_AES_128_GCM_SHA256`), `GET /api/v1/db/health` trả `HTTP 200`, `test` giữ nguyên `0` bảng / `0` views, không dùng tài khoản `.root` cho runtime.

---

## [P1-03A-FIX1] — 2026-11-15
**Mục tiêu:** Hiệu chỉnh khai báo cột `users.email` trong Drizzle schema để sinh tường minh `VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` khớp với `project-docs/DATABASE_SCHEMA.md`, và sinh lại initial migration (không thực thi lên TiDB).

- **Nội dung thay đổi:**
  - Bổ sung `emailVarchar255` (`customType` trả về `'varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'`) trong `src/server/db/schema/_shared.ts`.
  - Cập nhật `users.email` trong `src/server/db/schema/identity.ts` từ `varchar('email', { length: 255 })` sang `emailVarchar255('email')`, giữ nguyên tính nullable và `uq_users_email`.
  - Sinh lại initial migration `drizzle/0000_mimora_mvp_init.sql` (cùng `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`) bằng `drizzle-kit generate --name=mimora_mvp_init`. Đối chiếu `diff` xác nhận toàn bộ 21 bảng còn lại và tất cả các cột/constraints/indexes/FKs giữ nguyên không đổi.
- **Files / modules affected:**
  - `src/server/db/schema/_shared.ts`, `src/server/db/schema/identity.ts`
  - `drizzle/0000_mimora_mvp_init.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`
  - `project-docs/{CHANGELOG,KNOWN_ISSUES,PROJECT_STATE}.md`
- **Phạm vi tuân thủ:** Không kết nối TiDB, không thực thi SQL/migration/seed, không sửa `DATABASE_SCHEMA.md`.
- **Tests:** `tsc --noEmit`, `npx tsx --test src/server/db/schema.test.ts`, `npx drizzle-kit check`, `vite build`.
- **Trạng thái chấp nhận:** Chờ Technical Lead review trước khi sang `P1-03B`.

---

## [P1-03A] — 2026-11-15
**Mục tiêu:** Triển khai mã nguồn Drizzle ORM schema (`drizzle-orm/mysql-core`) cho toàn bộ 22 bảng theo `project-docs/DATABASE_SCHEMA.md` (`P1-02R-FIX1`), cấu hình `drizzle.config.ts`, và sinh SQL migration để review (**không thực thi lên TiDB**).

- **Nội dung thay đổi:**
  - Cài đặt devDependency `drizzle-kit@^0.31.11` và tạo `drizzle.config.ts` (`dialect: 'mysql'`, `out: './drizzle'`, `ssl: { rejectUnauthorized: true }`, không hardcode credentials).
  - Tạo `src/server/db/uuid.ts` (`generateUuidV7()` chuẩn RFC 9562 lowercase 36-char bằng `node:crypto` `randomBytes`).
  - Tạo bộ module schema 22 bảng dưới `src/server/db/schema/`:
    - `_shared.ts`: `customType` chuẩn hóa `uuidChar36` (`char(36) CHARACTER SET ascii COLLATE ascii_bin`), `asciiChar64`, `asciiVarchar64` và canonical constants.
    - `identity.ts` (4 bảng), `classes.ts` (6 bảng), `content.ts` (3 bảng), `assignments.ts` (6 bảng), `observations.ts` (1 bảng), `insights.ts` (1 bảng), `audit.ts` (1 bảng), `index.ts`.
  - Sinh migration `drizzle/0000_mimora_mvp_init.sql` (cùng `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`) qua `npx drizzle-kit generate --name=mimora_mvp_init`.
  - Kiểm tra chi tiết 438 dòng SQL sinh ra: toàn bộ 22 `CREATE TABLE` xuất hiện trước toàn bộ 51 `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (tự động giải quyết circular FK `content_items <-> content_versions` qua `ALTER TABLE`), giữ đủ 29 composite FKs (kể cả `fk_attempts_target`, `fk_attempts_item`, `fk_progress_active_attempt`, `fk_progress_completed_attempt`, `fk_content_items_pub_version`, `fk_sessions_active_org_membership`, `fk_obs_attempt_student`, `fk_obs_attempt_assignment`), 30 `CREATE INDEX` tường minh và 3 virtual generated column unique guards.
  - Tạo unit tests offline `src/server/db/schema.test.ts` (3/3 tests PASS).
- **Files / modules affected:**
  - `package.json`, `bun.lock` (cài `drizzle-kit`)
  - `drizzle.config.ts` (tạo mới)
  - `src/server/db/uuid.ts`, `src/server/db/schema.test.ts` (tạo mới)
  - `src/server/db/schema/{_shared,identity,classes,content,assignments,observations,insights,audit,index}.ts` (tạo mới)
  - `drizzle/0000_mimora_mvp_init.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json` (sinh tự động, chưa thực thi)
  - `project-docs/{PROJECT_STATE,CHANGELOG,KNOWN_ISSUES,ARCHITECTURE}.md` (cập nhật)
- **Phạm vi tuân thủ:** Tuyệt đối không chạy `drizzle-kit migrate` / `push`, không kết nối TiDB thực thi DDL/DML/seed, không thay đổi thiết kế trong `DATABASE_SCHEMA.md`, không sửa PoC hiện có (`server.ts`, `tidb.ts`, `App.tsx`).
- **Tests:** `tsc --noEmit`, `vite build`, `npx drizzle-kit check`, `npx tsx --test src/server/db/schema.test.ts`, kiểm tra `dist/` không chứa `src/server/db/*` hoặc secrets.
- **Trạng thái chấp nhận:** Đang chờ Technical Lead review trước khi sang `P1-03B`.

---

## [P1-02R-FIX1] — 2026-11-15
**Mục tiêu:** Hoàn thiện tính toàn vẹn dữ liệu chéo giữa `teacher_observations`, `assignments` và `activity_attempts` (chỉ cập nhật tài liệu đặc tả, chưa tạo code Drizzle hay thay đổi TiDB).

- **Nội dung thay đổi:**
  - Chọn **Ưu tiên A kết hợp Transactional Service Validation**:
    - Trên `activity_attempts`: bổ sung `UNIQUE KEY uq_attempts_org_assign_student_id (organization_id, assignment_id, student_membership_id, id)` (giữ nguyên `uq_attempts_org_student_id`).
    - Trên `teacher_observations`: thay `fk_obs_attempt` bằng `fk_obs_attempt_student (organization_id, student_membership_id, attempt_id) -> activity_attempts(organization_id, student_membership_id, id)` và bổ sung `fk_obs_attempt_assignment (organization_id, assignment_id, student_membership_id, attempt_id) -> activity_attempts(organization_id, assignment_id, student_membership_id, id)`.
    - Phân tách trung thực DB-enforced vs Service-enforced dưới ngữ nghĩa TiDB `MATCH SIMPLE`: khi `assignment_id` & `attempt_id` đều non-null, DB chặn hoàn toàn lệch assignment; ở tầng service transaction, khi có `attempt_id` bắt buộc truy vấn `activity_attempts` + `assignments` và ép/xác minh `assignment_id = attempt.assignment_id` và `class_id = assignment.class_id` (không cho phép `attempt_id != NULL` với `assignment_id = NULL` hoặc lệch `class_id`), kiểm tra `class_teachers` + `class_enrollments`, và giữ nguyên author-only isolation.
    - Bổ sung 4 test cases `T-OBS-01..04` vào `DATABASE_SCHEMA.md` (Mục 3.20 & Mục 11).
- **Files / modules affected:**
  - `project-docs/DATABASE_SCHEMA.md` (cập nhật)
  - `project-docs/PROJECT_STATE.md` (cập nhật)
  - `project-docs/CHANGELOG.md` (cập nhật)
  - `project-docs/KNOWN_ISSUES.md` (không phát sinh issue mới, giữ nguyên)
  - `project-docs/ARCHITECTURE.md` (không đổi quyết định kiến trúc, giữ nguyên)
- **Phạm vi tuân thủ:** Không tạo code Drizzle, không cài package, không generate/run migration, không thực thi SQL hay thay đổi TiDB.
- **Tests:** Kiểm tra tính nhất quán tài liệu, `git status` và `git diff`.
- **Trạng thái chấp nhận:** Đang chờ Technical Lead review.

---

## [P1-02R] — 2026-11-15
**Mục tiêu:** Hiệu chỉnh đặc tả thiết kế database schema (`P1-02`) dựa trên kết quả architecture review (chỉ cập nhật tài liệu thiết kế, chưa tạo code Drizzle hay migrate TiDB).

- **Nội dung thay đổi:**
  - **Cross-entity integrity (`2A`):** Bổ sung `assignment_id` vào `activity_attempts`, các composite unique keys trên `assignment_targets` / `assignment_items` / `activity_attempts`, và composite FKs đảm bảo đồng bộ `(organization_id, assignment_id, student_membership_id, content_version_id)` cho `activity_attempts` và `(organization_id, assignment_target_id, student_membership_id, active_attempt_id / latest_completed_attempt_id)` cho `assignment_progress`; phân tách rõ DB-enforced vs transactional service-enforced.
  - **Content version ownership (`2B`):** Bổ sung `uq_content_versions_item_id (content_item_id, id)` trên `content_versions` và composite FK `(id, current_published_version_id) -> content_versions(content_item_id, id)` trên `content_items`, kèm thứ tự DDL migration.
  - **Session membership (`2C`):** Dùng composite FK `(active_organization_id, user_id) -> organization_memberships(organization_id, user_id)` trên `sessions`, bảo toàn `active_organization_id = NULL` (`MATCH SIMPLE`) cho `platform_admin` / `teacher` chọn org, kết hợp service check trạng thái active.
  - **Concurrent learning attempts (`2D`):** Thiết kế khóa giao dịch `SELECT ... FOR UPDATE` trên `assignment_targets` + `start_idempotency_key` + `uq_attempts_number` + `uq_attempts_single_in_progress` (virtual generated guard) và danh sách integration tests `T-CONC-01..03`.
  - **Content approval history (`2E`):** Làm rõ 1 bản ghi `content_approvals` = 1 `submission_round`, bảo toàn lịch sử bị `rejected` khi gửi lại, khóa `FOR UPDATE` chống duyệt đồng thời, so sánh `reviewer_user_id` với `content_versions.created_by_user_id`, và audit `content.self_approved` khi chỉ có 1 Admin active.
  - **Aggregate privacy (`2F`):** Mở rộng `org_insight_daily_snapshots` hỗ trợ `period_type` (`daily | weekly | monthly`) và `content_type = 'all'`, bổ sung chính sách ngưỡng cohort `k = 5` (`[ASSUMPTION]`), ẩn đồng nhất `< 5`, gộp chu kỳ/nhóm và allowlist bộ lọc chống suy diễn sai phân.
  - **Bổ sung hiệu chỉnh (`Mục 3` & `Mục 4`):** Chuẩn hóa UUID `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`; sửa đếm phạm vi bảng (`15` tenant `NOT NULL` + `2` nullable + `5` global/root); tách rõ explicit indexes vs auto-created FK indexes; làm rõ `teacher_observations`, `assignment_progress` retry semantics, `abandoned` chỉ theo thao tác chủ động, `audit_logs` allowlist, `csv_import_jobs` uploader authorization, `class_enrollments` re-enrollment history, chuẩn hóa login identifier (cấm `@` trong `platform_username`), quan hệ `status`/`failed_login_attempts`/`locked_until`, và sửa phân tích TiDB Clustered vs Non-Clustered PK (`SHARD_ROW_ID_BITS` không áp dụng cho Clustered PK).
- **Files / modules affected:**
  - `project-docs/DATABASE_SCHEMA.md` (cập nhật toàn diện)
  - `project-docs/PROJECT_STATE.md` (cập nhật)
  - `project-docs/KNOWN_ISSUES.md` (cập nhật `KI-06`, `KI-09`, `KI-10`)
  - `project-docs/CHANGELOG.md` (cập nhật)
  - `project-docs/ARCHITECTURE.md` (giữ nguyên vì không thay đổi quyết định kiến trúc đã phê duyệt)
- **Phạm vi tuân thủ:** Không tạo code Drizzle, không cài package, không generate/run migration, không thực thi SQL hay thay đổi TiDB.
- **Tests:** Kiểm tra tính nhất quán tài liệu, `git status` và `git diff`.
- **Trạng thái chấp nhận:** Đang chờ Technical Lead review.

---

## [P1-02] — 2026-11-15
**Mục tiêu:** Thiết kế đặc tả database schema hoàn chỉnh và ràng buộc toàn vẹn dữ liệu cho MVP MIMORA (TiDB Cloud Serverless v8.5.3 + Drizzle ORM + UUIDv7, chưa triển khai code/migration).

- **Nội dung thay đổi:**
  - Tạo mới `project-docs/DATABASE_SCHEMA.md` đặc tả **22 bảng** qua 7 nhóm dữ liệu (`Identity & Organization`, `Classes & Student Management`, `Content Management`, `Assignments & Learning Sessions`, `Teacher Observations`, `Progress & Insights`, `Audit & Operational Events`), kèm Mermaid ERD, PK/FK/Unique/Index, chiến lược multi-tenant composite FK, ma trận phân quyền, workflow versioning/approval (không cho tự duyệt nếu >= 2 Admin active), mô hình `activity_attempts` (source of truth) vs `assignment_progress` (dẫn xuất), và kế hoạch migration cho P1-03+.
  - Đối chiếu tài liệu chính thức TiDB v8.5 (`docs.pingcap.com`): phát hiện `tidb_enable_check_constraint` mặc định `OFF` (`KI-09`), xác minh hỗ trợ GA của composite FK, phân tích circular FK giữa `content_items` và `content_versions`, và đánh giá TiKV sequential write hotspot của `UUIDv7` clustered PK (`KI-10`).
  - Đồng bộ hóa `project-docs/ARCHITECTURE.md`, `project-docs/PROJECT_STATE.md`, `project-docs/KNOWN_ISSUES.md` theo các quyết định PO đã phê duyệt (bỏ `org_admin` khỏi mô hình MVP, khóa đúng 5 canonical `content_type`, cô lập `teacher_observations` chỉ cho tác giả, giới hạn Admin chỉ xem aggregate insights).
- **Files / modules affected:**
  - `project-docs/DATABASE_SCHEMA.md` (tạo mới)
  - `project-docs/ARCHITECTURE.md` (cập nhật)
  - `project-docs/PROJECT_STATE.md` (cập nhật)
  - `project-docs/KNOWN_ISSUES.md` (cập nhật)
  - `project-docs/CHANGELOG.md` (cập nhật)
- **Phạm vi tuân thủ:** Không tạo bảng trên TiDB, không chạy migration/seed, không sửa source code (`server.ts`, `src/*`, `package.json`), không cài dependency, không push Git remote.
- **Tests:** Kiểm tra tính nhất quán tài liệu, `git status` và `git diff`.
- **Trạng thái chấp nhận:** Đang chờ Technical Lead review.

---

## [P1-01-FIX] — 2026-11-15 (cập nhật lúc 08:55 PST / 16:55 UTC)
**Mục tiêu:** Đồng bộ trạng thái P0-01B và các tài liệu `project-docs/` theo kết quả kiểm thử trình duyệt mới nhất trong AI Studio Preview.

- **Nội dung thay đổi:**
  - Cập nhật trạng thái `P0-01B` từ trạng thái chờ kiểm thử trình duyệt sang `PASS` trên `PROJECT_STATE.md`, `CHANGELOG.md`, `KNOWN_ISSUES.md` và bổ sung ghi chú xác minh thực tế vào `ARCHITECTURE.md`.
  - Đóng `KI-01` trong `KNOWN_ISSUES.md` kèm bằng chứng kiểm thử trình duyệt Preview.
  - Giữ nguyên `KI-02` ở trạng thái `OPEN`, giữ nguyên cấu hình `Secure` cookie và `trust proxy` trong code, không suy diễn kết quả sang môi trường HTTPS/proxy production.
- **Files / modules affected:**
  - `project-docs/PROJECT_STATE.md` (cập nhật)
  - `project-docs/CHANGELOG.md` (cập nhật)
  - `project-docs/KNOWN_ISSUES.md` (cập nhật)
  - `project-docs/ARCHITECTURE.md` (cập nhật)
- **Bằng chứng kiểm thử mới (trình duyệt AI Studio Preview, ghi nhận 2026-11-15):**
  - `Set cookie: SUCCESS`
  - `Check cookie: RECEIVED`
  - `Clear cookie: SUCCESS`
  - `Proxy check: req.secure: false, req.protocol: http, X-Forwarded-Proto: http`
- **Tests:** Chỉ kiểm tra tính nhất quán tài liệu và `git diff` (không sửa source code).
- **Trạng thái chấp nhận:** Đang chờ Technical Lead đánh giá.

---

## [P1-01] — 2026-11-15
**Mục tiêu:** Thiết lập nền móng Git và bộ tài liệu dự án `project-docs/`.

- **Nội dung thay đổi:**
  - Khởi tạo Git repository cục bộ tại workspace với initial commit `chore: initialize MIMORA project foundation` (không tạo remote, không push).
  - Xác minh `.gitignore` loại trừ `.env*` (giữ `!.env.example`), `node_modules/`, `dist/`, `build/`, `coverage/`, `*.log`.
  - Tạo bộ tài liệu chuẩn hóa: `project-docs/PROJECT_STATE.md`, `project-docs/CHANGELOG.md`, `project-docs/ARCHITECTURE.md`, `project-docs/KNOWN_ISSUES.md`.
- **Files / modules affected:**
  - `.git/` (khởi tạo mới)
  - `project-docs/PROJECT_STATE.md` (tạo mới)
  - `project-docs/CHANGELOG.md` (tạo mới)
  - `project-docs/ARCHITECTURE.md` (tạo mới)
  - `project-docs/KNOWN_ISSUES.md` (tạo mới)
- **Tests:**
  - `git status`, kiểm tra staged files không chứa secret: PASS.
  - `tsc --noEmit` và `vite build`: PASS.
- **Trạng thái chấp nhận:** Đang chờ Technical Lead đánh giá.

---

## [P0-02A] — 2026-11-15
**Mục tiêu:** Đánh giá và lựa chọn kiến trúc authentication cho MIMORA.

- **Nội dung thay đổi:**
  - Kiểm chứng API và metadata gói `better-auth@1.7.25` cùng tài liệu chính thức `better-auth.com`: xác nhận Better Auth yêu cầu `user.email` `NOT NULL UNIQUE` ở lõi và `username` plugin mặc định global unique, không đáp ứng tự nhiên yêu cầu Student không có email và username unique theo organization.
  - Đề xuất **Option B — Custom Authentication** dựa trên Express + Drizzle + TiDB + `scrypt` (`src/server/security/password-hash.ts`) + server-side sessions (`HttpOnly` cookie, SHA-256 `token_hash`).
  - Thiết kế mô hình multi-tenant (`organizations`, `users`, `organization_memberships`) và giải pháp cookie/proxy trust boundary.
- **Files / modules affected:** Không sửa mã nguồn (task nghiên cứu & đánh giá kiến trúc).
- **Tests:** Đối chiếu npm metadata (`npm view better-auth`) và tài liệu chính thức; không chạy migration.
- **Trạng thái chấp nhận:** Đã hoàn thành báo cáo đánh giá và được tiếp nối sang Phase 1.

---

## [P0-01D] — 2026-11-15
**Mục tiêu:** Kiểm chứng tính khả thi thuật toán password hashing (Argon2id vs `scrypt`).

- **Nội dung thay đổi:**
  - Xác minh Node.js `v22.23.2` không có `crypto.argon2` native (`undefined`) và container thiếu toolchain C/C++/Rust (`gcc`, `g++`, `make`, `cmake`, `cargo` đều missing). Không cài addon native bên thứ ba để tránh rủi ro build.
  - Triển khai module hashing bất đồng bộ bằng `node:crypto` `scrypt` với định dạng tự mô tả `scrypt$v1$N=65536,r=8,p=2,dkLen=32$<salt>$<hash>`, salt 16 bytes `randomBytes`, so sánh bằng `crypto.timingSafeEqual`, kiểm tra định dạng chặt chẽ và hàm `needsRehash`.
  - Viết 9 unit tests bằng `node:test` và `node:assert/strict`.
- **Files / modules affected:**
  - `src/server/security/password-hash.ts` (tạo mới)
  - `src/server/security/password-hash.test.ts` (tạo mới)
- **Tests:**
  - `npx tsx --test src/server/security/password-hash.test.ts`: 9/9 tests PASS (T1–T8 + `needsRehash`).
  - Đo hiệu năng tuần tự 7 lượt (`N=65536, r=8, p=2, dkLen=32`): hash median `408.15 ms` (`397.65–439.60 ms`), verify median `422.30 ms` (`396.42–480.69 ms`).
  - `tsc --noEmit` và `vite build`: PASS; `password-hash` không lọt vào `dist/`.
- **Trạng thái chấp nhận:** Đã chấp nhận hướng `scrypt`.

---

## [P0-01C] — 2026-11-15
**Mục tiêu:** Xác minh kết nối TiDB Cloud qua `mysql2` + `drizzle-orm` + TLS.

- **Nội dung thay đổi:**
  - Cài đặt `drizzle-orm` (`^0.45.4`) và `mysql2` (`^3.24.6`).
  - Tạo module kết nối TiDB singleton với `connectionLimit: 5`, bắt buộc `ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }`, kiểm tra biến `TIDB_*` và làm sạch lỗi (`sanitizeDbError`).
  - Thêm endpoint `GET /api/v1/db/health` (chỉ nhận GET, 405 cho method khác) thực thi `SELECT 1 AS ok, VERSION() AS serverVersion`. Phát hiện `nginx` nội bộ chặn `502`/`503`/`504` bằng `warmup.html`, nên trả HTTP `500` cho lỗi DB JSON.
  - Bổ sung khu vực **TiDB Connectivity Proof** với nút `Test Database Connection` trong `src/App.tsx`.
- **Files / modules affected:**
  - `package.json`, `bun.lock` (cập nhật dependencies)
  - `.env.example` (thêm tên biến placeholder `TIDB_*`)
  - `src/server/db/tidb.ts` (tạo mới)
  - `server.ts` (thêm `/api/v1/db/health` và `closeTiDbPool()` khi shutdown)
  - `src/App.tsx` (thêm UI kiểm tra DB)
- **Tests:**
  - `tsc --noEmit` và `vite build`: PASS; không có credentials hay driver DB trong `dist/`.
  - Kiểm thử thiếu credentials (`DB_CONFIG_MISSING` qua `nginx:8080` HTTP `500`) và mô phỏng sai credentials (`DB_CONNECTION_ERROR`, `DB_AUTH_FAILED`): PASS.
  - Kiểm thử kết nối TiDB thật sau khi người vận hành nạp Secrets: `GET /api/v1/db/health` trả `{"status":"ok","database":"connected","orm":"drizzle","driver":"mysql2","tls":"required-min-v1.2-verified","latencyMs":73,"serverVersion":"8.0.11-TiDB-v8.5.3-serverless"}`: PASS.
- **Trạng thái chấp nhận:** Đã kết nối TiDB Cloud thành công.

---

## [P0-01B] — 2026-11-15
**Mục tiêu:** Kiểm chứng cơ chế gửi/nhận `HttpOnly; Secure; SameSite=None` cookie qua reverse proxy và preview iframe.

- **Nội dung thay đổi:**
  - Bật `app.set('trust proxy', 1)` trong `server.ts`.
  - Tạo 3 endpoint `POST /api/v1/cookie-test/set` (`Max-Age=600`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=None`), `GET /api/v1/cookie-test/check`, `POST /api/v1/cookie-test/clear` kèm chặn method sai (`405`).
  - Phát hiện `/etc/nginx/nginx.conf` có `proxy_set_header X-Forwarded-Proto $scheme;`, làm Express luôn nhận `req.secure = false` và `req.protocol = 'http'` dù truy cập qua HTTPS.
  - Thêm giao diện kiểm thử cookie vào `src/App.tsx`.
- **Files / modules affected:**
  - `server.ts` (chỉnh sửa)
  - `src/App.tsx` (chỉnh sửa)
- **Tests:**
  - Kiểm thử HTTP qua `nginx:8080` bằng `curl` (2026-11-15): PASS (`Set-Cookie` đúng thuộc tính `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=600`, `405` đúng method, không lộ giá trị cookie).
  - Kiểm thử trực tiếp trên trình duyệt trong AI Studio Preview (cập nhật 2026-11-15): **PASS** (`Set cookie: SUCCESS`, `Check cookie: RECEIVED`, `Clear cookie: SUCCESS`; `Proxy check: req.secure: false, req.protocol: http, X-Forwarded-Proto: http`).
- **Trạng thái chấp nhận:** **PASS** (đã xác minh cả phía server/proxy lẫn trình duyệt trong môi trường Preview; hành vi HTTPS/proxy ở production vẫn chưa xác minh).

---

## [P0-01A] — 2026-11-15
**Mục tiêu:** Chứng minh Express và Vite chạy trong cùng một tiến trình Node.js, cùng origin trên cổng `3000`.

- **Nội dung thay đổi:**
  - Tạo `/server.ts` lắng nghe `0.0.0.0:3000`, parse tham số `--port`/`--host` do `control-plane-api` truyền vào, đăng ký `GET /api/v1/health` trước Vite `middlewareMode`.
  - Đổi script `"dev"` trong `package.json` sang `"tsx server.ts"`.
  - Cập nhật `src/App.tsx` hiển thị `MIMORA Runtime Proof` và gọi `fetch('/api/v1/health')`.
- **Files / modules affected:**
  - `server.ts` (tạo mới)
  - `package.json` (chỉnh sửa script `dev`)
  - `src/App.tsx` (chỉnh sửa)
- **Tests:**
  - `restart_dev_server`, `ss -tln` trên `0.0.0.0:3000`, `curl` qua `3000` và `nginx:8080` (`/api/v1/health`, `/`, `/src/App.tsx`), kiểm tra ổn định PID, `tsc --noEmit`, `vite build`: PASS.
- **Trạng thái chấp nhận:** Đã chấp nhận.

---

## [P0-00] — 2026-11-15
**Mục tiêu:** Kiểm tra workspace và môi trường thực thi Google AI Studio Build Mode.

- **Nội dung thay đổi:** Chỉ kiểm tra đọc, không chỉnh sửa workspace. Ghi nhận Node `v22.23.2`, `npm 10.9.8`, `bun 1.4.4`, `Debian 12`, `gVisor`, thiếu `gcc`/`g++`/`make`, chưa có Git repo, `control-plane-api` chạy cổng `3000` sau `nginx:8080`.
- **Files / modules affected:** Không có.
- **Tests:** Kiểm kê filesystem, toolchain, npm registry, `tsc --noEmit`: Hoàn tất.
- **Trạng thái chấp nhận:** Đã chấp nhận làm đầu vào cho toàn bộ Phase 0.
