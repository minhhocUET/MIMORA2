import { sql } from 'drizzle-orm';
import {
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
import { uuidChar36 } from './_shared';
import { classes } from './classes';
import { contentVersions } from './content';
import { organizationMemberships } from './identity';

/**
 * 3.14 assignments
 */
export const assignments = mysqlTable(
  'assignments',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    classId: uuidChar36('class_id').notNull(),
    createdByTeacherMembershipId: uuidChar36(
      'created_by_teacher_membership_id'
    ).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    homePracticeInstructions: text('home_practice_instructions'),
    dueAt: datetime('due_at', { fsp: 3 }),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_assignments_class',
      columns: [t.organizationId, t.classId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    foreignKey({
      name: 'fk_assignments_creator',
      columns: [t.organizationId, t.createdByTeacherMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    unique('uq_assignments_org_id').on(t.organizationId, t.id),
    unique('uq_assignments_org_class_id').on(t.organizationId, t.classId, t.id),
    index('idx_assignments_class_status').on(t.organizationId, t.classId, t.status),
    index('idx_assignments_creator').on(
      t.organizationId,
      t.createdByTeacherMembershipId
    ),
  ]
);

/**
 * 3.15 assignment_items
 */
export const assignmentItems = mysqlTable(
  'assignment_items',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    assignmentId: uuidChar36('assignment_id').notNull(),
    contentVersionId: uuidChar36('content_version_id').notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_assignment_items_assignment',
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: 'fk_assignment_items_version',
      columns: [t.contentVersionId],
      foreignColumns: [contentVersions.id],
    }).onUpdate('restrict'),
    unique('uq_assignment_items_org_id').on(t.organizationId, t.id),
    unique('uq_assignment_items_org_assign_ver_id').on(
      t.organizationId,
      t.assignmentId,
      t.contentVersionId,
      t.id
    ),
    unique('uq_assignment_items_order').on(t.assignmentId, t.sortOrder),
    index('idx_assignment_items_assignment').on(t.organizationId, t.assignmentId),
  ]
);

/**
 * 3.16 assignment_targets
 */
export const assignmentTargets = mysqlTable(
  'assignment_targets',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    assignmentId: uuidChar36('assignment_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    assignedAt: datetime('assigned_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_targets_assignment',
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: 'fk_targets_student',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    unique('uq_targets_org_id').on(t.organizationId, t.id),
    unique('uq_targets_assignment_student').on(
      t.assignmentId,
      t.studentMembershipId
    ),
    unique('uq_targets_org_student_id').on(
      t.organizationId,
      t.studentMembershipId,
      t.id
    ),
    unique('uq_targets_org_assign_student_id').on(
      t.organizationId,
      t.assignmentId,
      t.studentMembershipId,
      t.id
    ),
    index('idx_targets_student').on(t.organizationId, t.studentMembershipId),
  ]
);

/**
 * 3.17 activity_attempts (Source of truth for learning sessions and progress)
 */
export const activityAttempts = mysqlTable(
  'activity_attempts',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    assignmentId: uuidChar36('assignment_id').notNull(),
    assignmentTargetId: uuidChar36('assignment_target_id').notNull(),
    assignmentItemId: uuidChar36('assignment_item_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
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
    inProgressTargetGuard: uuidChar36(
      'in_progress_target_guard'
    ).generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'in_progress' THEN assignment_target_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    inProgressItemGuard: uuidChar36('in_progress_item_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'in_progress' THEN assignment_item_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_attempts_target',
      columns: [
        t.organizationId,
        t.assignmentId,
        t.studentMembershipId,
        t.assignmentTargetId,
      ],
      foreignColumns: [
        assignmentTargets.organizationId,
        assignmentTargets.assignmentId,
        assignmentTargets.studentMembershipId,
        assignmentTargets.id,
      ],
    }),
    foreignKey({
      name: 'fk_attempts_item',
      columns: [
        t.organizationId,
        t.assignmentId,
        t.contentVersionId,
        t.assignmentItemId,
      ],
      foreignColumns: [
        assignmentItems.organizationId,
        assignmentItems.assignmentId,
        assignmentItems.contentVersionId,
        assignmentItems.id,
      ],
    }),
    foreignKey({
      name: 'fk_attempts_student',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_attempts_version',
      columns: [t.contentVersionId],
      foreignColumns: [contentVersions.id],
    }),
    unique('uq_attempts_org_id').on(t.organizationId, t.id),
    unique('uq_attempts_org_student_id').on(
      t.organizationId,
      t.studentMembershipId,
      t.id
    ),
    unique('uq_attempts_org_assign_student_id').on(
      t.organizationId,
      t.assignmentId,
      t.studentMembershipId,
      t.id
    ),
    unique('uq_attempts_org_target_student_id').on(
      t.organizationId,
      t.assignmentTargetId,
      t.studentMembershipId,
      t.id
    ),
    unique('uq_attempts_number').on(
      t.assignmentTargetId,
      t.assignmentItemId,
      t.attemptNumber
    ),
    unique('uq_attempts_idempotency').on(
      t.assignmentTargetId,
      t.assignmentItemId,
      t.startIdempotencyKey
    ),
    unique('uq_attempts_single_in_progress').on(
      t.inProgressTargetGuard,
      t.inProgressItemGuard
    ),
    index('idx_attempts_student_status').on(
      t.organizationId,
      t.studentMembershipId,
      t.status,
      t.startedAt
    ),
    index('idx_attempts_target_item_status').on(
      t.organizationId,
      t.assignmentTargetId,
      t.assignmentItemId,
      t.status
    ),
  ]
);

/**
 * 3.18 activity_attempt_turns (Turn-level source of truth)
 */
export const activityAttemptTurns = mysqlTable(
  'activity_attempt_turns',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
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
      name: 'fk_turns_attempt',
      columns: [t.organizationId, t.attemptId],
      foreignColumns: [activityAttempts.organizationId, activityAttempts.id],
    }),
    unique('uq_turns_attempt_idx').on(t.attemptId, t.turnIndex),
    index('idx_turns_org_attempt').on(t.organizationId, t.attemptId),
  ]
);

/**
 * 3.19 assignment_progress (Derived progress synchronized inside attempt transactions)
 */
export const assignmentProgress = mysqlTable(
  'assignment_progress',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    assignmentTargetId: uuidChar36('assignment_target_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    activeAttemptId: uuidChar36('active_attempt_id'),
    latestCompletedAttemptId: uuidChar36('latest_completed_attempt_id'),
    totalItems: int('total_items').notNull(),
    completedItems: int('completed_items').notNull().default(0),
    attemptCount: int('attempt_count').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('not_started'),
    lastActivityAt: datetime('last_activity_at', { fsp: 3 }),
    completedAt: datetime('completed_at', { fsp: 3 }),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_progress_target',
      columns: [t.organizationId, t.studentMembershipId, t.assignmentTargetId],
      foreignColumns: [
        assignmentTargets.organizationId,
        assignmentTargets.studentMembershipId,
        assignmentTargets.id,
      ],
    }),
    foreignKey({
      name: 'fk_progress_active_attempt',
      columns: [
        t.organizationId,
        t.assignmentTargetId,
        t.studentMembershipId,
        t.activeAttemptId,
      ],
      foreignColumns: [
        activityAttempts.organizationId,
        activityAttempts.assignmentTargetId,
        activityAttempts.studentMembershipId,
        activityAttempts.id,
      ],
    }),
    foreignKey({
      name: 'fk_progress_completed_attempt',
      columns: [
        t.organizationId,
        t.assignmentTargetId,
        t.studentMembershipId,
        t.latestCompletedAttemptId,
      ],
      foreignColumns: [
        activityAttempts.organizationId,
        activityAttempts.assignmentTargetId,
        activityAttempts.studentMembershipId,
        activityAttempts.id,
      ],
    }),
    unique('uq_progress_target').on(t.organizationId, t.assignmentTargetId),
    index('idx_progress_student_status').on(
      t.organizationId,
      t.studentMembershipId,
      t.status
    ),
  ]
);
