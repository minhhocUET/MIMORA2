# MIMORA — Known Issues & Risk Register

Mọi vấn đề kỹ thuật, giới hạn môi trường và hạng mục chưa xác minh đều được theo dõi tại đây. Không đánh dấu `RESOLVED` khi chưa có bằng chứng kiểm chứng thực tế.

---

## KI-01 — P0-01B Browser Cookie Verification
- **Trạng thái:** RESOLVED (2026-11-15)
- **Mức độ:** HIGH *(lịch sử)*
- **Mô tả:** Theo dõi việc xác minh trực tiếp cơ chế `HttpOnly; Secure; SameSite=None` cookie trên trình duyệt thực tế trong môi trường AI Studio Preview.
- **Ảnh hưởng:** Từng là điểm chưa xác minh đối với luồng session cookie trong iframe Preview.
- **Bằng chứng đóng issue:** Người vận hành đã kiểm thử thành công trực tiếp trong AI Studio Preview (2026-11-15):
  - `Set cookie: SUCCESS`
  - `Check cookie: RECEIVED`
  - `Clear cookie: SUCCESS`
  - `Proxy check: req.secure: false, req.protocol: http, X-Forwarded-Proto: http`
  - *Lưu ý:* Việc đóng `KI-01` xác nhận PoC cookie đã hoạt động trong môi trường Preview được kiểm thử; **không** suy diễn rằng HTTPS/proxy production đã được xác minh (xem `KI-02` và `KI-04`), và cần lưu ý trình duyệt chặn third-party cookie nghiêm ngặt vẫn có thể hạn chế iframe cross-site.

---

## KI-02 — Nginx nội bộ ghi đè `X-Forwarded-Proto` thành `http`
- **Trạng thái:** OPEN (Đã xác định nguyên nhân và tái khẳng định qua kết quả Preview; chưa đóng cho production)
- **Mức độ:** HIGH
- **Mô tả:** Theo `/etc/nginx/nginx.conf`, proxy nội bộ container (:8080 -> :3000) đặt `proxy_set_header X-Forwarded-Proto $scheme;`. Do Cloud Run kết thúc TLS ở lớp ngoài, `$scheme` trong container là `http`, khiến Express luôn nhận `req.secure === false` và `req.protocol === 'http'` dù đã bật `app.set('trust proxy', 1)` (đã được xác nhận lại ở trình duyệt Preview: `req.secure: false, req.protocol: http, X-Forwarded-Proto: http`).
- **Ảnh hưởng:** Mọi logic đặt cookie dựa vào `if (req.secure)` sẽ thất bại âm thầm (không gửi cookie `Secure`) trong môi trường preview container. Đồng thời cấu hình HTTPS/proxy ở môi trường production thực tế vẫn chưa được kiểm chứng.
- **Cách xác minh / Điều kiện đóng:** Khi triển khai session module chính thức ở Phase 1, cấu hình cờ `Secure` tường minh theo môi trường (`COOKIE_SECURE=true` cho HTTPS, không tắt `Secure` cho Preview), không phụ thuộc vào `req.secure`, và xác minh thực tế hành vi HTTPS/proxy trên môi trường production trước khi đóng issue.

---

## KI-03 — Nginx nội bộ chặn mã HTTP `403`, `502`, `503`, `504`
- **Trạng thái:** OPEN
- **Mức độ:** MEDIUM
- **Mô tả:** `/etc/nginx/nginx.conf` cấu hình `proxy_intercept_errors on;` kèm `error_page 403 = /forbidden.html;` và `error_page 502 503 504 = /warmup.html;`. Đã quan sát thực tế ở P0-01C rằng mã `503` JSON từ Express bị `nginx` thay thế bằng `warmup.html` (`200 OK`, `text/html`).
- **Ảnh hưởng:** Nếu API backend trả mã `403`, `502`, `503` hoặc `504` cho lỗi phân quyền hoặc lỗi kết nối, frontend `fetch` chạy qua `nginx` preview có thể nhận về HTML thay vì JSON lỗi (gây lỗi parse JSON hoặc hiển thị sai trạng thái).
- **Cách xác minh / Điều kiện đóng:** Kiểm thử thực tế hành vi mã `403` từ Express qua `nginx:8080` khi xây dựng tầng authorization ở Phase 1 và thiết kế cơ chế xử lý/quy ước HTTP status tương thích.

---

## KI-04 — Chưa triển khai và xác minh Production Build & Serving
- **Trạng thái:** OPEN
- **Mức độ:** MEDIUM
- **Mô tả:** `server.ts` hiện chỉ mới có luồng development (`createViteServer` với `middlewareMode: true`). Nhánh production (`NODE_ENV=production` phục vụ `dist/` qua `express.static`), script `"start"`, và kiểm thử `npm run build` + `npm start` thực tế chưa được triển khai và kiểm chứng.
- **Ảnh hưởng:** Chưa chứng minh được ứng dụng chạy đúng ở chế độ production build trên Cloud Run khi không có Vite dev server.
- **Cách xác minh / Điều kiện đóng:** Triển khai nhánh static serving cho production trong `server.ts`, thêm script `"start"` và kiểm thử thực tế trên bản build `dist/`.

---

## KI-05 — Chưa triển khai Authentication & Authorization
- **Trạng thái:** OPEN
- **Mức độ:** HIGH
- **Mô tả:** Mới hoàn thành đánh giá kiến trúc ở P0-02A; chưa triển khai endpoints `/api/v1/auth/*`, bảng `sessions`, CSRF protection, rate limiting và authorization middleware.
- **Ảnh hưởng:** Các endpoint PoC hiện tại chưa có lớp xác thực/phân quyền người dùng thật; chưa có kiểm soát truy cập đa tổ chức.
- **Cách xác minh / Điều kiện đóng:** Hoàn tất các task triển khai Authentication & Authorization ở Phase 1 kèm kiểm thử tích hợp và bảo mật.

---

## KI-06 — Hoàn tất Kiểm thử DML & Parity 22 bảng (`test`), còn mở Dọn `TIDB_MIGRATOR_*` Secrets bởi Operator
- **Trạng thái:** OPEN *(DML, Composite FKs, Virtual Unique Guards & 22-Table Parity `VERIFIED` trong `P2-03`..`P2-07`; giữ OPEN duy nhất cho bước operator xóa `TIDB_MIGRATOR_*` khỏi AI Studio Secrets)*
- **Mức độ:** MEDIUM
- **Mô tả:** Migration `drizzle/0000_mimora_mvp_init.sql` (SHA-256 `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`) đã được thực thi thành công lên TiDB `test` (`P1-03B2B` `PASS`), kết nối runtime least-privilege đã xác minh (`P1-03B2C` `PASS`), và trong các task `P2-03`..`P2-07` các hạng mục kiểm chứng DB runtime đã hoàn tất:
  1. **DML runtime account (`VERIFIED`):** Xác minh `INSERT`/`UPDATE`/`DELETE` sạch (0 tồn dư) trên toàn bộ các bảng nghiệp vụ từ `organizations`/`users`/`sessions`/`classes` tới `content_*`, `assignments`/`activity_attempts`, `teacher_observations`, `student_profiles`, `student_goals`, `org_insight_daily_snapshots`.
  2. **Composite FKs & `T-CONC-01..03`, `T-OBS-01..04` (`VERIFIED`):** Xác minh trên TiDB thật (`p206test-97368327`, `p207test-42cc2722`), bao gồm chặn lỗi SQL trực tiếp `fk_obs_attempt_assignment` (`ER_NO_REFERENCED_ROW_2` / `errno 1452`).
  3. **Virtual Unique Guards & `SHOW CREATE TABLE` 22-table Parity (`VERIFIED`):** Xác minh `uq_attempts_single_in_progress`, `uq_approvals_single_pending`, `uq_class_enrollments_active_pair`, và đối chiếu read-only `SHOW CREATE TABLE` trên cả `22/22` bảng ứng dụng (`p207test-42cc2722`, `all22TablesVerified=true`, `allColumnsMatched=true`, `allConstraintsMatched=true`).
  4. **Còn mở (Operator action):** `TIDB_MIGRATOR_USER` và `TIDB_MIGRATOR_PASSWORD` nếu còn trong Google AI Studio Secrets vẫn cần operator xóa thủ công qua AI Studio UI kèm restart workspace.
- **Ảnh hưởng:** Rủi ro DML/parity DB đã được loại trừ; chỉ còn rủi ro cô lập Secrets phía cấu hình container nếu `TIDB_MIGRATOR_*` chưa được gỡ khỏi Secrets UI.
- **Cách xác minh / Điều kiện đóng:** Operator xác nhận đã xóa `TIDB_MIGRATOR_USER` và `TIDB_MIGRATOR_PASSWORD` khỏi Google AI Studio Secrets và restart toàn workspace.

---

## KI-07 — Chưa kiểm thử hiệu năng & bộ nhớ `scrypt` ở tải đồng thời
- **Trạng thái:** OPEN
- **Mức độ:** MEDIUM
- **Mô tả:** Đã đo hiệu năng tuần tự trên container (`N=65536, r=8, p=2, dkLen=32`: median ~408 ms hash / ~422 ms verify, tiêu tốn ~64 MiB RAM/lần trên môi trường `2 vCPU / 4096 MB RAM`). Chưa chạy load test đồng thời (ví dụ 20–40 học sinh đăng nhập cùng lúc đầu giờ học).
- **Ảnh hưởng:** Nhiều request đăng nhập đồng thời không kiểm soát có thể gây nghẽn `libuv` threadpool hoặc áp lực bộ nhớ trên instance nhỏ.
- **Cách xác minh / Điều kiện đóng:** Thiết kế rate limiting / giới hạn concurrency cho endpoint login ở Phase 1 và thực hiện kiểm thử tải có kiểm soát trước khi vận hành thực tế.

---

## KI-08 — Các vấn đề nền tảng phụ trong Workspace
- **Trạng thái:** OPEN
- **Mức độ:** LOW
- **Mô tả:**
  1. `metadata.json` (`name: ""`, `description: ""`) và `index.html` (`My Google AI Studio App`) vẫn giữ placeholder mặc định.
  2. `ss -tln` ghi nhận cổng phụ `24678` đang `LISTEN` bên cạnh cổng `3000` (tương tác giữa `hmr: true` trong `vite.config.ts` và `middlewareMode`).
  3. Hệ thống thiếu toolchain biên dịch C/C++/Rust (`gcc`, `g++`, `make` missing), cần tránh cài dependency yêu cầu native compile từ source.
  4. Chưa cấu hình Git remote repository; thư mục `.git/` cục bộ trước đó đã không còn sau lần cold restart container (`2026-11-16`).
- **Ảnh hưởng:** Chưa hoàn thiện metadata định danh ứng dụng; có cổng phụ trong dev; lịch sử Git không được bảo toàn qua container restart nếu chưa cấu hình remote repository.
- **Cách xác minh / Điều kiện đóng:** Cập nhật metadata/title khi bắt đầu xây dựng UI chính thức; kiểm tra lại cấu hình HMR port nếu cần; cấu hình Git remote khi Tech Lead cung cấp URL repository.

---

## KI-09 — TiDB `tidb_enable_check_constraint` xác nhận `OFF` (Runtime Constraints & Parity Đã Xác Minh)
- **Trạng thái:** OPEN *(Structural TiDB Behavior — `CHECK` constraint không được thực thi ở tầng DB; Runtime Unique Guards, Composite FKs & 22-Table Parity đã xác minh `PASS` trong `P2-03`..`P2-07`)*
- **Mức độ:** MEDIUM
- **Mô tả:** Đã xác nhận `tidb_enable_foreign_key = ON`, `foreign_key_checks = ON`, `tidb_enable_check_constraint = OFF`, `tidb_enable_clustered_index = ON`, hỗ trợ `utf8mb4_0900_ai_ci`, và trong `P2-03`..`P2-07` đã xác minh thực tế trên TiDB `test` toàn bộ 3 virtual generated-column unique guards, composite FKs (`T-CONC-01..03`, `T-OBS-01..04`), cùng 22/22 `SHOW CREATE TABLE` parity (`p207test-42cc2722`). Tuy nhiên `tidb_enable_check_constraint` vẫn là `OFF` trên cluster.
- **Ảnh hưởng:** Không thể dựa vào `CHECK` constraint ở tầng DB nếu có thao tác ghi ngoài tầng ứng dụng; toàn bộ enum/domain constraints bắt buộc phải được validate ở tầng `zod` + service layer.
- **Cách xác minh / Điều kiện đóng:** Duy trì kiểm tra enum/domain/an toàn bằng `zod` + service layer trong mọi endpoint mới; issue này giữ OPEN như ràng buộc vận hành trừ khi cluster TiDB bật `tidb_enable_check_constraint = ON`.

---

## KI-10 — Rủi ro TiKV Write Hotspot với `UUIDv7` Clustered Primary Key
- **Trạng thái:** OPEN
- **Mức độ:** LOW
- **Mô tả:** `UUIDv7` (`CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`) có 48-bit đầu tăng đơn điệu theo millisecond. Trên TiDB v8.5 (mặc định dùng **`CLUSTERED` Primary Key** cho PK dạng `CHAR(36)`), các bảng có tần suất `INSERT` liên tục (`activity_attempts`, `activity_attempt_turns`, `audit_logs`, `sessions`) vẫn ghi tuần tự vào TiKV Region cuối cùng. Lưu ý quan trọng: **`SHARD_ROW_ID_BITS` không áp dụng được cho bảng dùng `CLUSTERED` Primary Key** (chỉ áp dụng cho `_tidb_rowid` trên bảng `NONCLUSTERED` PK hoặc bảng không có PK; và ngay cả với `NONCLUSTERED` PK, secondary unique index của UUIDv7 PK vẫn có tính tăng đơn điệu).
- **Ảnh hưởng:** Ở quy mô MVP trường học, tải ghi chấp nhận được; chỉ cần theo dõi nếu số lượt ghi đồng thời tăng rất cao trong các giai đoạn sau.
- **Cách xác minh / Điều kiện đóng:** Giữ nguyên `CHAR(36)` UUIDv7 Clustered PK cho MVP (không chuyển `BINARY(16)` và không sharding sớm khi chưa có bằng chứng bottleneck); theo dõi TiKV write latency khi chạy kiểm thử tải trong các phase sau.

