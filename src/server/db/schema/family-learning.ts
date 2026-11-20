import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  type MySqlTableExtraConfigValue,
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { uuidChar36 } from './_shared.ts';
import { contentVersions } from './content.ts';
import { familyWorkspaces } from './family.ts';
import { users } from './identity.ts';

/**
 * 4.8 family_programs
 * Reusable Family curriculum definitions (non-org-scoped, circular FK to current published version).
 */
export const familyPrograms = mysqlTable(
  'family_programs',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    availabilityMode: varchar('availability_mode', { length: 32 })
      .notNull()
      .default('admin_assigned'),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    currentPublishedVersionId: uuidChar36('current_published_version_id'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    retiredAt: datetime('retired_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: 'fk_family_programs_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_programs_pub_version',
      columns: [t.id, t.currentPublishedVersionId],
      foreignColumns: [
        familyProgramVersions.familyProgramId as AnyMySqlColumn,
        familyProgramVersions.id as AnyMySqlColumn,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    unique('uq_family_programs_slug').on(t.slug),
    index('idx_family_programs_status_mode').on(t.status, t.availabilityMode),
  ]
);

/**
 * 4.9 family_program_versions
 * Immutable once published; draft edits remain isolated from active student enrollments.
 */
export const familyProgramVersions = mysqlTable(
  'family_program_versions',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyProgramId: uuidChar36('family_program_id').notNull(),
    versionNumber: int('version_number').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    locale: varchar('locale', { length: 16 }).notNull().default('vi'),
    ageBand: varchar('age_band', { length: 64 }),
    availabilityMode: varchar('availability_mode', { length: 32 })
      .notNull()
      .default('admin_assigned'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    publishedByUserId: uuidChar36('published_by_user_id'),
    publishedAt: datetime('published_at', { fsp: 3 }),
    retiredAt: datetime('retired_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_prog_versions_program',
      columns: [t.familyProgramId],
      foreignColumns: [familyPrograms.id],
    }),
    foreignKey({
      name: 'fk_family_prog_versions_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_prog_versions_publisher',
      columns: [t.publishedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_family_prog_versions_prog_num').on(
      t.familyProgramId,
      t.versionNumber
    ),
    unique('uq_family_prog_versions_prog_id').on(t.familyProgramId, t.id),
    index('idx_family_prog_versions_status').on(t.familyProgramId, t.status),
  ]
);

/**
 * 4.10 family_program_items
 * Ordered Chapter + published content_version references inside a Family Program version.
 */
export const familyProgramItems = mysqlTable(
  'family_program_items',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyProgramVersionId: uuidChar36('family_program_version_id').notNull(),
    chapterNumber: int('chapter_number').notNull().default(1),
    chapterTitle: varchar('chapter_title', { length: 255 }).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    contentVersionId: uuidChar36('content_version_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_prog_items_version',
      columns: [t.familyProgramVersionId],
      foreignColumns: [familyProgramVersions.id],
    }),
    foreignKey({
      name: 'fk_family_prog_items_content_ver',
      columns: [t.contentVersionId],
      foreignColumns: [contentVersions.id],
    }),
    unique('uq_family_prog_items_ver_id').on(t.familyProgramVersionId, t.id),
    unique('uq_family_prog_items_ver_content_id').on(
      t.familyProgramVersionId,
      t.contentVersionId,
      t.id
    ),
    unique('uq_family_prog_items_order').on(
      t.familyProgramVersionId,
      t.sortOrder
    ),
    index('idx_family_prog_items_ver_chapter').on(
      t.familyProgramVersionId,
      t.chapterNumber,
      t.sortOrder
    ),
  ]
);

/**
 * 4.11 family_program_enrollments
 * Pins a specific published Family Program version for a Student inside a Family Workspace.
 */
export const familyProgramEnrollments = mysqlTable(
  'family_program_enrollments',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyWorkspaceId: uuidChar36('family_workspace_id').notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    familyProgramId: uuidChar36('family_program_id').notNull(),
    familyProgramVersionId: uuidChar36('family_program_version_id').notNull(),
    activationSource: varchar('activation_source', { length: 32 }).notNull(),
    activatedByUserId: uuidChar36('activated_by_user_id').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    learningStatus: varchar('learning_status', { length: 32 })
      .notNull()
      .default('not_started'),
    totalActivities: int('total_activities').notNull().default(0),
    completedActivities: int('completed_activities').notNull().default(0),
    startedAt: datetime('started_at', { fsp: 3 }),
    lastActivityAt: datetime('last_activity_at', { fsp: 3 }),
    completedAt: datetime('completed_at', { fsp: 3 }),
    activatedAt: datetime('activated_at', { fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    revokedByUserId: uuidChar36('revoked_by_user_id'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    activeWsGuard: uuidChar36('active_ws_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN family_workspace_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeStudentGuard: uuidChar36('active_student_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN student_user_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeProgramGuard: uuidChar36('active_program_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN family_program_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_enrollments_workspace',
      columns: [t.familyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_family_enrollments_student',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_enrollments_program',
      columns: [t.familyProgramId],
      foreignColumns: [familyPrograms.id],
    }),
    foreignKey({
      name: 'fk_family_enrollments_prog_version',
      columns: [t.familyProgramId, t.familyProgramVersionId],
      foreignColumns: [
        familyProgramVersions.familyProgramId,
        familyProgramVersions.id,
      ],
    }),
    foreignKey({
      name: 'fk_family_enrollments_activator',
      columns: [t.activatedByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_enrollments_revoker',
      columns: [t.revokedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_family_enrollments_active_triple').on(
      t.activeWsGuard,
      t.activeStudentGuard,
      t.activeProgramGuard
    ),
    unique('uq_family_enrollments_student_ver_id').on(
      t.studentUserId,
      t.familyProgramVersionId,
      t.id
    ),
    index('idx_family_enrollments_student_status').on(
      t.studentUserId,
      t.status,
      t.learningStatus
    ),
    index('idx_family_enrollments_ws_student').on(
      t.familyWorkspaceId,
      t.studentUserId,
      t.status
    ),
    index('idx_family_enrollments_program').on(
      t.familyProgramId,
      t.familyProgramVersionId,
      t.status
    ),
  ]
);

/**
 * 4.12 family_activity_attempts
 * Teacher-free Student attempt tracking scoped directly to enrollment + canonical student users.id.
 */
export const familyActivityAttempts = mysqlTable(
  'family_activity_attempts',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    enrollmentId: uuidChar36('enrollment_id').notNull(),
    familyWorkspaceId: uuidChar36('family_workspace_id').notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    familyProgramVersionId: uuidChar36('family_program_version_id').notNull(),
    familyProgramItemId: uuidChar36('family_program_item_id').notNull(),
    contentVersionId: uuidChar36('content_version_id').notNull(),
    attemptNumber: int('attempt_number').notNull(),
    startIdempotencyKey: varchar('start_idempotency_key', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull().default('in_progress'),
    startedAt: datetime('started_at', { fsp: 3 }).notNull(),
    lastInteractedAt: datetime('last_interacted_at', { fsp: 3 }).notNull(),
    completedAt: datetime('completed_at', { fsp: 3 }),
    durationSeconds: int('duration_seconds').notNull().default(0),
    usedAacSupport: boolean('used_aac_support').notNull().default(false),
    usedReadAloud: boolean('used_read_aloud').notNull().default(false),
    aacTapCount: int('aac_tap_count').notNull().default(0),
    readAloudCount: int('read_aloud_count').notNull().default(0),
    responseSummaryJson: json('response_summary_json').$type<
      Record<string, unknown>
    >(),
    inProgressEnrollmentGuard: uuidChar36(
      'in_progress_enrollment_guard'
    ).generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'in_progress' THEN enrollment_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    inProgressItemGuard: uuidChar36(
      'in_progress_item_guard'
    ).generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'in_progress' THEN family_program_item_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_attempts_workspace',
      columns: [t.familyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_family_attempts_student',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_attempts_enrollment',
      columns: [t.studentUserId, t.familyProgramVersionId, t.enrollmentId],
      foreignColumns: [
        familyProgramEnrollments.studentUserId,
        familyProgramEnrollments.familyProgramVersionId,
        familyProgramEnrollments.id,
      ],
    }),
    foreignKey({
      name: 'fk_family_attempts_item',
      columns: [
        t.familyProgramVersionId,
        t.contentVersionId,
        t.familyProgramItemId,
      ],
      foreignColumns: [
        familyProgramItems.familyProgramVersionId,
        familyProgramItems.contentVersionId,
        familyProgramItems.id,
      ],
    }),
    foreignKey({
      name: 'fk_family_attempts_content_ver',
      columns: [t.contentVersionId],
      foreignColumns: [contentVersions.id],
    }),
    unique('uq_family_attempts_student_id').on(t.studentUserId, t.id),
    unique('uq_family_attempts_number').on(
      t.enrollmentId,
      t.familyProgramItemId,
      t.attemptNumber
    ),
    unique('uq_family_attempts_idempotency').on(
      t.enrollmentId,
      t.familyProgramItemId,
      t.startIdempotencyKey
    ),
    unique('uq_family_attempts_single_in_progress').on(
      t.inProgressEnrollmentGuard,
      t.inProgressItemGuard
    ),
    index('idx_family_attempts_student_status').on(
      t.studentUserId,
      t.status,
      t.startedAt
    ),
    index('idx_family_attempts_enroll_item_status').on(
      t.enrollmentId,
      t.familyProgramItemId,
      t.status
    ),
  ]
);

/**
 * 4.13 family_activity_attempt_turns
 * Turn-level persistence for Family-context attempts (never exposed to Guardians or Admins).
 */
export const familyActivityAttemptTurns = mysqlTable(
  'family_activity_attempt_turns',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    attemptId: uuidChar36('attempt_id').notNull(),
    turnIndex: int('turn_index').notNull(),
    stepKey: varchar('step_key', { length: 64 }).notNull(),
    selectedChoiceKey: varchar('selected_choice_key', { length: 128 }),
    selectedEmotionKey: varchar('selected_emotion_key', { length: 64 }),
    usedAac: boolean('used_aac').notNull().default(false),
    usedReadAloud: boolean('used_read_aloud').notNull().default(false),
    responsePayloadJson: json('response_payload_json').$type<
      Record<string, unknown>
    >(),
    respondedAt: datetime('responded_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_turns_attempt',
      columns: [t.studentUserId, t.attemptId],
      foreignColumns: [
        familyActivityAttempts.studentUserId,
        familyActivityAttempts.id,
      ],
    }),
    unique('uq_family_turns_attempt_idx').on(t.attemptId, t.turnIndex),
    index('idx_family_turns_student_attempt').on(t.studentUserId, t.attemptId),
  ]
);

/**
 * 4.14 student_family_preferences
 * Comfort and accessibility preferences keyed by canonical Student users.id so Family-only Students
 * never require a school organization membership to persist AAC / read-aloud / visual comfort settings.
 */
export const studentFamilyPreferences = mysqlTable(
  'student_family_preferences',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    preferredName: varchar('preferred_name', { length: 120 }),
    supportPreferencesJson: json('support_preferences_json').$type<
      Record<string, unknown>
    >(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_student_family_prefs_user',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_student_family_prefs_user').on(t.studentUserId),
  ]
);
