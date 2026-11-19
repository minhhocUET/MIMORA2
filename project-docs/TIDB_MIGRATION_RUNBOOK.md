# MIMORA — Controlled TiDB Migration Execution Runbook (`0000` -> `0001` -> `0002`)

> **STATUS:** `[PREFLIGHT VERIFIED — NOT YET EXECUTED FOR 0001 / 0002]`  
> **AUTHORIZATION GATE:** **DO NOT EXECUTE ANY MIGRATION, SEED, OR LIVE DDL/DML WITHOUT EXPLICIT TECHNICAL LEAD AUTHORIZATION.**  
> **LAST UPDATED:** 2026-11-19 (`P4-02.1`)

---

## 0. Scope & Artifact Provenance

This runbook governs controlled execution of the three SQL migrations in `drizzle/` against a target TiDB Cloud Serverless database:

| Order | Migration File | Tag (`_journal.json`) | SHA-256 Checksum | Tables Added |
|---:|---|---|---|---:|
| 1 | `drizzle/0000_mimora_mvp_init.sql` | `0000_mimora_mvp_init` | `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765` | 22 MVP tables |
| 2 | `drizzle/0001_mimora_p4_01_guardian_family.sql` | `0001_mimora_p4_01_guardian_family` | `72afb616e99de3ee8cb20f211140710cf3547895486febc635acda53edb2e809` | +6 Guardian/Family tables (+ `users.email_verified_at`) |
| 3 | `drizzle/0002_mimora_p4_02_family_learning.sql` | `0002_mimora_p4_02_family_learning` | `27c9a6945932c14fe55fd34ec02150f9a4f87ee9b15806a1b9b562900f75b6b4` | +8 Family Learning tables |

**Total Target Schema:** **36 application tables** (`+1` `__drizzle_migrations` metadata table = **37 base tables**), **94 foreign keys** (34 composite FKs), **49 standalone indexes**, **15 virtual generated columns** backing partial unique guards.

> **Important Drizzle Snapshot Notice:** `drizzle/meta/_journal.json` tracks all 3 entries (`idx: 0, 1, 2`), and `npx drizzle-kit check` passes. However, `drizzle/meta/` only stores `0000_snapshot.json` (`0001`/`0002` were hand-authored to match `src/server/db/schema/*.ts` identically). **Operators must NEVER run `drizzle-kit generate` or `drizzle-kit push`**. Execute only the exact versioned SQL chain (`0000` -> `0001` -> `0002`) via controlled migration tooling or verified SQL client.

---

## 1. Required Environment Variables (Migrator vs Runtime — Placeholders Only)

Never reuse runtime credentials for DDL, and never leave migrator credentials in the AI Studio runtime container after migration completes.

### Migrator Environment (Operator-only workstation / controlled CI job)
```bash
TIDB_HOST="<tidb-cloud-serverless-host>"
TIDB_PORT="4000"
TIDB_DATABASE="<target-database-name>"
TIDB_MIGRATOR_USER="<prefix>.mimora_migrator"
TIDB_MIGRATOR_PASSWORD="<migrator-secret>"
```
Minimum grants for `TIDB_MIGRATOR_USER` on `<target-database-name>.*`:
`SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, ALTER, INDEX` (no `DROP DATABASE`, no `SUPER`).

### Runtime Environment (Application server `server.ts`)
```bash
TIDB_HOST="<tidb-cloud-serverless-host>"
TIDB_PORT="4000"
TIDB_DATABASE="<target-database-name>"
TIDB_USER="<prefix>.mimora_runtime"
TIDB_PASSWORD="<runtime-secret>"
# Optional: leave empty or 'tidb' in real environments; NEVER set 'mock' in production.
MIMORA_DB_MODE="tidb"
```
Minimum grants for `TIDB_USER` on `<target-database-name>.*`:
`SELECT, INSERT, UPDATE, DELETE` only (least-privilege DML).

---

## 2. Pre-Migration Backup & Checkpoint Verification

Before modifying any existing database (`test` or target environment):
1. Verify TiDB Cloud automated snapshot / Point-In-Time Recovery (PITR) or export a schema + data dump (`dumpling` / TiDB Cloud Console backup) taken within the last 15 minutes.
2. Record the backup ID, timestamp (UTC), and source cluster ID in the operator change log.
3. Verify local migration checksums match Section 0 before executing anything:
   ```bash
   sha256sum drizzle/0000_mimora_mvp_init.sql drizzle/0001_mimora_p4_01_guardian_family.sql drizzle/0002_mimora_p4_02_family_learning.sql
   ```

---

## 3. TiDB Compatibility & Cluster Variable Checks

Run the following read-only session/variable inspection as `TIDB_MIGRATOR_USER` (over TLS 1.2+):

```sql
SELECT VERSION() AS server_version, DATABASE() AS active_db, CURRENT_USER() AS active_user;
SHOW VARIABLES WHERE Variable_name IN (
  'sql_mode',
  'character_set_database',
  'collation_database',
  'tidb_enable_foreign_key',
  'foreign_key_checks',
  'tidb_enable_clustered_index',
  'tidb_enable_check_constraint'
);
```

Expected values before proceeding:
- `server_version`: TiDB `8.0.11-TiDB-v8.5.x-serverless` (must support `utf8mb4_0900_ai_ci`, virtual generated columns in `UNIQUE` constraints, and foreign keys).
- `character_set_database`: `utf8mb4`.
- `tidb_enable_foreign_key`: `ON` and `foreign_key_checks`: `ON`.
- `tidb_enable_clustered_index`: `ON`.
- `tidb_enable_check_constraint`: expected `OFF` (architectural constraint `KI-09` — application validates enums/domains via Zod + service layer).

---

## 4. Pre-Migration Schema Inspection Queries

Inspect the current state of the target database to distinguish a **fresh database** (`0` tables) from an **existing P1/P2 `test` database** (`22` MVP tables + `__drizzle_migrations` where `0000` already ran):

```sql
SHOW TABLES;

SELECT COUNT(*) AS base_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';

SELECT table_name, column_name, column_type, character_set_name, collation_name
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email_verified_at';

-- Run ONLY if __drizzle_migrations already exists:
SELECT id, hash, created_at FROM `__drizzle_migrations` ORDER BY id ASC;
```

- **Fresh DB:** `base_table_count = 0` -> execute `0000` -> `0001` -> `0002`.
- **Existing `test` DB (post-P1-03B2B):** `base_table_count = 23`, `__drizzle_migrations` contains hash `eec9f4669bf5f7850eb2cf5ca7f975585609334722e44ee4b5339ada2a16c765`, and `users.email_verified_at` does NOT exist -> execute **only `0001` -> `0002`**.

---

## 5. Exact Ordered Migration Sequence

Always run migrations strictly in ascending index order (`0000` -> `0001` -> `0002`) with `drizzle-kit migrate` or an audited statement runner that splits on `--> statement-breakpoint` and records SHA-256 hashes in `__drizzle_migrations`:

```bash
# Option A (Preferred if drizzle-kit migrate supports current journal + __drizzle_migrations state):
TIDB_HOST="..." TIDB_PORT="4000" TIDB_DATABASE="..." \
TIDB_MIGRATOR_USER="..." TIDB_MIGRATOR_PASSWORD="..." \
npx drizzle-kit migrate
```

If executing via controlled external MySQL/TiDB client (Path A, step-by-step):
1. Apply `drizzle/0000_mimora_mvp_init.sql` (skip ONLY if Section 4 confirmed `eec9f466...` already recorded in `__drizzle_migrations` and all 22 tables present).
2. Run **Step 1 Verification** (Section 6).
3. Apply `drizzle/0001_mimora_p4_01_guardian_family.sql`.
4. Run **Step 2 Verification** (Section 6).
5. Apply `drizzle/0002_mimora_p4_02_family_learning.sql`.
6. Run **Step 3 Verification** (Section 6).

*(Note: Keep `drizzle-kit migrate` hash tracking synchronized with `__drizzle_migrations` if executing manually via SQL client.)*

---

## 6. Post-Migration Verification Queries (Per Step)

### After `0000_mimora_mvp_init.sql`
```sql
SELECT COUNT(*) AS tables_after_0000
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
-- Expect: 22 app tables (+1 __drizzle_migrations if managed by drizzle-kit = 23)
```

### After `0001_mimora_p4_01_guardian_family.sql`
```sql
SELECT COUNT(*) AS tables_after_0001
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
-- Expect: 28 app tables (29 incl. __drizzle_migrations)

SHOW COLUMNS FROM `users` LIKE 'email_verified_at';
-- Expect: 1 row, Type = datetime(3), Null = YES

SELECT table_name FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'email_verification_tokens','family_workspaces','family_memberships',
    'family_students','student_link_invitations','guardian_student_links'
  )
ORDER BY table_name;
-- Expect: 6 rows
```

### After `0002_mimora_p4_02_family_learning.sql`
```sql
SELECT COUNT(*) AS tables_after_0002
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
-- Expect: 36 app tables (37 incl. __drizzle_migrations)

SELECT table_name FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'student_link_invitation_students','family_programs','family_program_versions',
    'family_program_items','family_program_enrollments','family_activity_attempts',
    'family_activity_attempt_turns','student_family_preferences'
  )
ORDER BY table_name;
-- Expect: 8 rows
```

---

## 7. `SHOW CREATE TABLE` Parity Verification (All 36 Tables)

Run `SHOW CREATE TABLE` across all 36 tables and verify columns, `CHARACTER SET ascii COLLATE ascii_bin` on UUID `CHAR(36)` PK/FK columns, `utf8mb4_0900_ai_ci` on `users.email` / `email_verification_tokens.email_snapshot`, `DATETIME(3)` timestamps, constraints, and indexes against `src/server/db/schema/*.ts`:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '__drizzle_migrations'
ORDER BY table_name;
```
Run `SHOW CREATE TABLE `<table_name>`;` for each of the 36 tables (automatable via read-only operator parity script) and verify **0 column/constraint/index/collation diffs**.

---

## 8. Foreign Key, Unique Constraint & Virtual Column Verification

```sql
-- 1. Verify total FK count (= 94 across 36 app tables)
SELECT COUNT(DISTINCT CONSTRAINT_NAME) AS total_foreign_keys
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY';

-- 2. Verify P4-01 + P4-02 circular & composite FKs exist
SELECT TABLE_NAME, CONSTRAINT_NAME
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  AND CONSTRAINT_NAME IN (
    'fk_family_programs_pub_version',
    'fk_family_enrollments_prog_version',
    'fk_family_attempts_enrollment',
    'fk_family_attempts_item',
    'fk_family_turns_attempt'
  )
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- 3. Verify all 15 virtual generated columns across 7 tables
SELECT TABLE_NAME, COLUMN_NAME, GENERATION_EXPRESSION, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND GENERATION_EXPRESSION IS NOT NULL
  AND LENGTH(GENERATION_EXPRESSION) > 0
ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- Expect 15 virtual columns across:
-- class_enrollments (2), content_approvals (1), activity_attempts (2),
-- family_memberships (2), guardian_student_links (3),
-- family_program_enrollments (3), family_activity_attempts (2)
```

---

## 9. Health-Check Verification

After deploying/restarting runtime with `TIDB_*` configured and `MIMORA_DB_MODE` unset (or `tidb`), **and ensuring `TIDB_MIGRATOR_*` is NOT present in runtime env**:

```bash
# 1. Application liveness
curl -sS -w "\nHTTP %{http_code}\n" http://127.0.0.1:3000/api/v1/health
# Expect: HTTP 200 {"status":"ok","service":"mimora-api"}

# 2. Database readiness (must report real TiDB + durablePersistence: true)
curl -sS -w "\nHTTP %{http_code}\n" http://127.0.0.1:3000/api/v1/db/health
# Expect: HTTP 200 {"status":"ok","database":"connected","mode":"tidb","durablePersistence":true,"orm":"drizzle","driver":"mysql2","tls":"required-min-v1.2-verified",...}
```

---

## 10. Post-Migration Minimal Read/Write Smoke Test Sequence

Using an isolated test prefix (e.g. `runTag = p402_smoke_<utc>`), executed only with Technical Lead approval:
1. Run read-only `SHOW GRANTS FOR CURRENT_USER()` as `TIDB_USER` -> confirm **only** `USAGE` + `SELECT, INSERT, UPDATE, DELETE ON <db>.*`.
2. Execute a controlled transactional smoke test exercising:
   - Guardian registration + email verification token hash -> `family_workspaces` -> `family_memberships`.
   - Family student creation + `guardian_student_links` -> verify `uq_gs_links_active_triple` virtual guard blocks duplicate active link.
   - `family_programs` + `family_program_versions` publish + circular FK `fk_family_programs_pub_version`.
   - `family_program_enrollments` -> `family_activity_attempts` -> `family_activity_attempt_turns` -> reverse-FK cleanup (`DELETE` with exact `runTag` IDs).
3. Re-run row counts on all 36 tables -> verify **0 leftover test rows**.
4. Remove `TIDB_MIGRATOR_USER` and `TIDB_MIGRATOR_PASSWORD` from any runtime/preview Secrets UI and restart the runtime container.

---

## 11. Failure & Manual Rollback Procedure

- **DO NOT run destructive SQL automatically.**
- **If `0002` fails midway before data is written:**
  1. Halt immediately and inspect exact statement error (`SHOW WARNINGS;`, `SHOW ENGINE INNODB STATUS` / TiDB error code).
  2. Manually execute only the reverse-dependency rollback block from the footer comments of `drizzle/0002_mimora_p4_02_family_learning.sql`:
     ```sql
     ALTER TABLE `family_programs` DROP FOREIGN KEY `fk_family_programs_pub_version`;
     DROP TABLE IF EXISTS `student_family_preferences`;
     DROP TABLE IF EXISTS `family_activity_attempt_turns`;
     DROP TABLE IF EXISTS `family_activity_attempts`;
     DROP TABLE IF EXISTS `family_program_enrollments`;
     DROP TABLE IF EXISTS `family_program_items`;
     DROP TABLE IF EXISTS `family_program_versions`;
     DROP TABLE IF EXISTS `family_programs`;
     DROP TABLE IF EXISTS `student_link_invitation_students`;
     ```
  3. Remove the `0002` entry from `__drizzle_migrations` only if it was recorded.
- **If `0001` fails midway (or `0002` is already rolled back and `0001` must be reversed before any Guardian data exists):**
  ```sql
  DROP TABLE IF EXISTS `guardian_student_links`;
  DROP TABLE IF EXISTS `student_link_invitations`;
  DROP TABLE IF EXISTS `family_students`;
  DROP TABLE IF EXISTS `family_memberships`;
  DROP TABLE IF EXISTS `family_workspaces`;
  DROP TABLE IF EXISTS `email_verification_tokens`;
  ALTER TABLE `users` DROP COLUMN `email_verified_at`;
  ```
- **If live user data already exists:** Restore from the Section 2 pre-migration snapshot/PITR instead of running `DROP TABLE`.

---

## 12. Explicit Stop Conditions

**HALT IMMEDIATELY and escalate to Technical Lead if any of the following occurs:**
1. `tidb_enable_foreign_key` or `foreign_key_checks` is `OFF`, or `character_set_database` is not `utf8mb4`.
2. Pre-migration `users.email_verified_at` or any `P4-01`/`P4-02` table already exists without a matching `__drizzle_migrations` journal entry (untracked drift).
3. Any `sha256sum` of `0000`, `0001`, or `0002` differs from Section 0.
4. Any DDL statement fails with FK collation/type mismatch (`errno 150` / `3780`), duplicate constraint name, or identifier length error.
5. `GET /api/v1/db/health` returns `mode !== 'tidb'` or `durablePersistence !== true` after runtime startup.
6. Pre-migration backup/checkpoint ID cannot be confirmed.
