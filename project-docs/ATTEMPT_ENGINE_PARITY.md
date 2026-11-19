# MIMORA — School & Family Attempt-Engine Behavioral Parity Contract (`KI-12`)

**Last updated:** 2026-11-19  
**Applies to:**  
- School Attempt Engine: `src/server/services/attempt.service.ts`, `src/server/repositories/attempt.repository.ts`, `src/server/routes/attempts.routes.ts`  
- Family Attempt Engine: `src/server/services/family-learning.service.ts`, `src/server/repositories/family-learning.repository.ts`, `src/server/routes/family-learning.routes.ts`  
- Shared Pure Contract Helpers: `src/server/services/attempt-shared.ts`  
- Parity Test Suite: `src/server/services/attempt-parity.test.ts`

---

## 1. Purpose & Architectural Scope

MIMORA supports learning across **Family** (teacher-free home learning), **Professional** (independent teachers), and **School** (organization-managed classrooms) with **one canonical Student identity (`users.id`)** per child.

By design, School attempts (`activity_attempts`, `activity_attempt_turns`, `assignment_progress`) and Family attempts (`family_activity_attempts`, `family_activity_attempt_turns`, `family_program_enrollments`) remain **structurally separated** in TiDB so a Student never requires an organization, class, or teacher to learn. At the same time, every core learning semantic experienced by the Student must behave identically across both engines.

This document defines the harmonized behavioral contract, intentional domain boundaries, authorization rules, concurrency invariants, and developer guardrails.

---

## 2. Shared Behavioral Contract (Mandatory Across Both Engines)

All invariants below are enforced symmetrically by both School and Family engines using shared pure helpers in `src/server/services/attempt-shared.ts`:

| Invariant | Canonical Behavior | Shared Helper / Source |
|---|---|---|
| **Start / Resume Default** | `intent` defaults to `'start_or_resume'`. Creates attempt #1 (`201`, `action: 'started'`) when no prior attempts exist, or resumes the active `in_progress` attempt (`200`, `action: 'resumed'`) with existing turns intact. | `resolveStartOrResumeEligibility()` |
| **Pinned Content Version** | If `expectedContentVersionId` is supplied on `startOrResume` and differs from the pinned `contentVersionId`, both reject with `409 PINNED_CONTENT_VERSION_MISMATCH`. | `assertPinnedContentVersionMatches()` |
| **Start Idempotency Key** | Both accept `Idempotency-Key` header (validated `/^[A-Za-z0-9._:-]{1,64}$/`) or `body.idempotencyKey`; mismatched header vs body returns `400 VALIDATION_ERROR` (`IDEMPOTENCY_KEY_MISMATCH`). Replaying the same `startIdempotencyKey` returns `200`, `action: 'idempotent_replay'`. | `extractValidatedIdempotencyKeyHeader()`, `resolveStartIdempotencyKey()` |
| **Single Active `in_progress`** | Only one `in_progress` attempt per `(target/enrollment, item)` is allowed. Sending `intent: 'retry'` while an `in_progress` attempt exists returns `409 ATTEMPT_ALREADY_IN_PROGRESS`. | `resolveStartOrResumeEligibility()`, virtual generated unique guards (`uq_attempts_single_in_progress`, `uq_family_attempts_single_in_progress`) |
| **Explicit Retry Policy** | If prior attempts exist (whether `completed` **or `abandoned`**) and none is `in_progress`, calling `startOrResume` without `intent: 'retry'` fails with `409 RETRY_INTENT_REQUIRED`. | `resolveStartOrResumeEligibility()` |
| **Attempt Numbering** | Monotonic `MAX(attempt_number) + 1` (computed safely from aggregate max, not only `COUNT(*)`, avoiding collisions if historical gaps ever exist). | `attempt.repository.ts`, `family-learning.repository.ts` |
| **Append-Only Ordered Turns** | Turns are returned deterministically ordered by `(turnIndex ASC, respondedAt ASC, id ASC)`. `resumePosition` reports `{ savedTurnCount, nextTurnIndex: lastTurn.turnIndex + 1 (or 0), lastTurnIndex, lastStepKey }`. | `computeAttemptResumePosition()`, `toSafeAttemptTurnView()` |
| **Turn Replay vs Conflict** | Saving a turn at an existing `turnIndex` compares `(stepKey, selectedChoiceKey, selectedEmotionKey, usedAac, usedReadAloud, canonical(responsePayloadJson))`. Equivalent payload returns `200` with `idempotentReplay: true`; different payload returns `409 TURN_INDEX_CONFLICT`. Saving turns on non-`in_progress` attempts returns `409 ATTEMPT_NOT_IN_PROGRESS`. | `areAttemptTurnPayloadsEquivalent()`, `assertAttemptCanSaveTurn()`, `canonicalizeAttemptPayload()` |
| **Payload & Text Safety** | Both enforce `stepKey` trimmed non-empty (`REQUIRED`), optional `selectedChoiceKey` / `selectedEmotionKey` SEL text scan, and `validateSafeAttemptJsonObject` (root JSON object, `maxKeys = 40`, `maxDepth = 5`, `maxArray = 25`, 57 normalized forbidden keys including credentials/PII/timers/scores/streaks/punishment/correctness/diagnosis/`mastery`, plus `scanUnsafeSelText`). Rejections throw `422 VALIDATION_ERROR`. | `validateSafeAttemptJsonObject()`, `FORBIDDEN_ATTEMPT_PAYLOAD_KEYS`, `validateRequiredAttemptStepKey()`, `validateOptionalAttemptShortText()` |
| **Completion & Single-Counting** | Completing an `in_progress` attempt transitions it to `completed`, recomputes progress from `COUNT(DISTINCT item_id WHERE status = 'completed')`, and preserves initial `completedAt` on subsequent retries. Completing an already-`completed` attempt is an idempotent replay (`200`, `{ status: 'ok', idempotentReplay: true, attempt }`). | `assertAttemptCanComplete()`, `recomputeAndUpsertAssignmentProgress()` / `recomputeAndUpdateEnrollmentProgress()` |
| **Cross-Terminal State Guard** | Calling `complete` on an `abandoned` attempt or `abandon` on a `completed` attempt throws `409 INVALID_ATTEMPT_STATE`. | `assertAttemptCanComplete()`, `assertAttemptCanAbandon()` |
| **Deliberate Abandonment** | Attempts are **never** auto-abandoned on session expiry or timeout. Abandoning requires explicit confirmation on HTTP (`confirmed: true`) and preserves partial turns without counting toward completion progress. Replaying abandon on `abandoned` returns `200` with `{ status: 'ok', idempotentReplay: true, attempt }`. | `assertAttemptCanAbandon()`, HTTP routes |
| **Monotonic Duration & Neutral Telemetry** | `durationSeconds` updates via `Math.max(current, incoming)`. Initial `startOrResume` with `usedAacSupport: true` / `usedReadAloud: true` initializes tap/read-aloud counts to `1` (`0` otherwise). Subsequent turns/completes apply `delta ?? (flag ? 1 : 0)` and mark `supportContext.isOptionalContextOnly = true`. | `computeMonotonicAttemptDuration()`, `resolveInitialSupportCounts()`, `resolveSupportTelemetryUpdate()`, `buildAttemptSupportContextView()` |
| **HTTP Header Parity** | Both `/start-or-resume`, `/turns`, `/complete`, and `/abandon` validate optional `Idempotency-Key` headers cleanly via `extractValidatedIdempotencyKeyHeader(req)`. | `attempts.routes.ts`, `family-learning.routes.ts` |

---

## 3. Preserved Context-Specific Differences (Intentional Architecture)

The following domain differences are intentional and must **not** be collapsed:

1. **Database Tables & Foreign Keys:**
   - **School:** `activity_attempts`, `activity_attempt_turns`, `assignment_progress` scoped by `(organization_id, assignment_id, assignment_target_id, student_membership_id)`.
   - **Family:** `family_activity_attempts`, `family_activity_attempt_turns`, `family_program_enrollments` scoped by `(family_workspace_id, student_user_id, family_program_version_id)`.
2. **Lifecycle Boundaries (`closed` vs `revoked`/`retired`):**
   - **School:** Closed assignments (`assignments.status = 'closed'`) remain readable (`200 GET`) in `isReadOnly: true` mode, while mutations (`start-or-resume`, `turns`, `complete`, `abandon`) return `409 ASSIGNMENT_CLOSED`.
   - **Family:** Active enrollments (`family_program_enrollments.status = 'active'`) remain accessible to the student even if the parent program is later marked `retired` for new enrollments. Revoked enrollments (`status = 'revoked'`) are excluded from active student access (`404`).
3. **Guardian vs Teacher Visibility:**
   - **Teacher:** Assigned teachers can view read-only attempt details and turn responses (`GET /api/v1/assignments/:assignmentId/attempts/:attemptId`) for their assigned class (`isReadOnly: true`, `availableActions.* = false`). Unassigned teachers / co-teachers respect assignment permissions; Platform Admins receive `403`.
   - **Guardian (Option B Privacy):** Guardians can view linked-student aggregate progress summaries (`GET /api/v1/guardian/students/:studentUserId/progress`) across both Family and School contexts (status + activity counts + Family chapter breakdown only). Guardians **never** see per-turn choices, `selectedChoiceKey`, `selectedEmotionKey`, `responsePayloadJson`, or private `teacher_observations`.
4. **Abandon Confirmation Status Code & Legacy School Service Compatibility:**
   - Both HTTP endpoints require `confirmed: true` (omitting `{}` or passing `confirmed: false` rejects).
   - **Family:** `POST /api/v1/student/family-attempts/:attemptId/abandon` returns `400 ABANDON_CONFIRMATION_REQUIRED`.
   - **School:** `POST /api/v1/student/attempts/:attemptId/abandon` converts non-`true` `body.confirmed` to `confirmed: false` in `attempts.routes.ts`, returning `422 VALIDATION_ERROR` with detail code `ABANDON_CONFIRMATION_REQUIRED`. Direct internal calls to `attemptService.abandonAttempt({ attemptId }, actor)` keep `confirmed?: boolean` compatibility (`confirmed === false` -> `422`) for `P2-06` regression contracts.
5. **Audit Events:**
   - Family emits `family.attempt_started`, `family.attempt_completed`, `family.attempt_abandoned` with non-content metadata only (no turn answers/emotions).
   - School records `security.unauthorized_access_denied` / cross-tenant denials without copying turn responses into `audit_logs`.

---

## 4. Authorization & Dual-Context Student Guarantees

1. **Family-Only Student (`activeOrganizationId === null`, zero `organization_memberships`):**
   - Authenticated Student session with `hasFamilyContext: true` accesses `/api/v1/student/family-programs*` and `/api/v1/student/family-attempts*` cleanly without any School organization or teacher.
   - School routes (`/api/v1/student/assignments*`, `/api/v1/student/attempts*`) remain gated by `requireOrgContext`, failing closed (`403 ORG_CONTEXT_REQUIRED`) when `activeOrganizationId === null`.
2. **School-Only Student:**
   - Accesses School assignments and School attempts inside their active organization (`organization_memberships.role = 'student'`). Cross-organization or cross-student attempt IDs return `404` (non-enumeration) / `403` without mutating state.
3. **Dual-Context Student (`School Membership + Family Enrollment`, same `users.id`):**
   - Learning at home writes only to `family_activity_attempts` / `family_activity_attempt_turns` / `family_program_enrollments`.
   - Learning at school writes only to `activity_attempts` / `activity_attempt_turns` / `assignment_progress`.
   - School attempt IDs cannot be mutated or read through Family endpoints (`404`), and Family attempt IDs cannot be mutated or read through School endpoints (`404`).
   - Session expiry (`401`) on either context preserves all `in_progress` attempts and saved turns for seamless resume upon re-login.

---

## 5. Concurrency & Transaction Integrity Rules

1. **Full Transaction Boundary:**
   - All mutating operations (`startOrResume*`, `save*Turn`, `complete*Attempt`, `abandon*Attempt`) execute **100% inside `withTransaction(async (tx) => ...)`** — pre-transaction reads for idempotency keys, `in_progress` rows, or attempt counts are prohibited because TiDB defaults to `REPEATABLE READ` snapshot isolation.
2. **Current-Read Row Locking (`SELECT ... FOR UPDATE`):**
   - Within `tx`, repositories apply Drizzle `.for('update')` on parent target/enrollment, `in_progress` lookup, idempotency lookup, aggregate attempt stats/max number, attempt lookup, existing turn lookup, and progress row updates.
3. **Transient Conflict & Duplicate Key Handling:**
   - Both services wrap every transactional mutation in `runWithTransientLockRetry()` (`attempt-shared.ts`), retrying transient lock/write conflicts (`ER_LOCK_WAIT_TIMEOUT` / `1205`, `ER_LOCK_DEADLOCK` / `1213`, TiDB write conflicts `9007` / `8028`) with bounded jitter, plus optional single retry on `ER_DUP_ENTRY` (`1062`) during `startOrResume` / `saveTurn` so concurrent idempotent callers converge cleanly.
   - Persistent `ER_DUP_ENTRY` after retry translates deterministically to `409 ATTEMPT_CONCURRENT_CONFLICT` (start) or `409 TURN_INDEX_CONFLICT` (saveTurn) rather than leaking HTTP `500`.
4. **Live Verification Status (`KI-12` vs `KI-11`):**
   - School concurrency (`T-CONC-01..03`) was verified live against TiDB `test` in `P2-06`.
   - Family parity & concurrency (`lock wait retry` + `ER_DUP_ENTRY` conflict + HTTP dual-context) are currently verified in `Mock Repo` and `Mock HTTP` (`attempt-parity.test.ts`); **live TiDB verification for `family_activity_attempts` / `0002` constraints awaits `0001` -> `0002` migration execution when `TIDB_*` secrets are provisioned**.

---

## 6. Telemetry Neutrality & Zero-Scoring Guarantees

- Neither engine stores or computes scores, grades, accuracy percentages, streaks, countdown timers, leaderboards, or psychological/clinical diagnostic labels.
- `usedAacSupport`, `usedReadAloud`, `aacTapCount`, and `readAloudCount` are **accessibility support context only** (`supportContext.isOptionalContextOnly === true`). Using AAC or Read-Aloud **never** penalizes completion status or blocks retries.
- Guardian and Admin surfaces never expose raw student turn payloads or emotional selections.

---

## 7. Developer Guardrail Checklist (Before Modifying Either Attempt Engine)

Before changing `attempt.service.ts`, `attempt.repository.ts`, `attempts.routes.ts`, `family-learning.service.ts`, `family-learning.repository.ts`, `family-learning.routes.ts`, or `attempt-shared.ts`:

- [ ] **Check `attempt-shared.ts` first:** Does the rule belong in shared pure helpers (`FORBIDDEN_ATTEMPT_PAYLOAD_KEYS`, `validateSafeAttemptJsonObject`, `resolveStartOrResumeEligibility`, `assertAttemptCan*`, `runWithTransientLockRetry`, etc.) rather than duplicated in one engine?
- [ ] **Sync both engines:** Verify whether the change affects Start/Resume, Idempotency, Turn replay/conflict, Retry rules, Completion single-counting, Abandon confirmation, Support telemetry, or Error codes in **both** School and Family.
- [ ] **Preserve `REPEATABLE READ` safety:** Ensure no mutating service reads state outside `withTransaction` and that repository reads inside `tx` propagate `tx` and `.for('update')`.
- [ ] **Verify SEL safety & privacy:** Never weaken `FORBIDDEN_ATTEMPT_PAYLOAD_KEYS` / `scanUnsafeSelText`, never copy student turn choices/emotions into `audit_logs`, and never expose turn details to Guardians (Option B).
- [ ] **Preserve Teacher-free Student independence:** Never add `requireOrgContext` or organization membership assumptions to Family routes or `attempt-shared.ts`.
- [ ] **Update parity tests & docs:** Add paired `[Mock Repo][school]` & `[Mock Repo][family]` assertions in `src/server/services/attempt-parity.test.ts`, update the comparison matrix if any invariant changed, and verify `p2-06.attempts.test.ts`, `p4-02.family-learning.test.ts`, and `attempt-parity.test.ts` all pass.
