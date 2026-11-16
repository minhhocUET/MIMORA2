import {
  datetime,
  foreignKey,
  index,
  mysqlTable,
  text,
} from 'drizzle-orm/mysql-core';
import { uuidChar36 } from './_shared';
import { activityAttempts, assignments } from './assignments';
import { classes } from './classes';
import { organizationMemberships } from './identity';

/**
 * 3.20 teacher_observations (Strictly author-only private pedagogical notes)
 */
export const teacherObservations = mysqlTable(
  'teacher_observations',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    authorTeacherMembershipId: uuidChar36(
      'author_teacher_membership_id'
    ).notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    classId: uuidChar36('class_id'),
    assignmentId: uuidChar36('assignment_id'),
    attemptId: uuidChar36('attempt_id'),
    noteBody: text('note_body').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    deletedAt: datetime('deleted_at', { fsp: 3 }),
  },
  (t) => [
    foreignKey({
      name: 'fk_obs_author',
      columns: [t.organizationId, t.authorTeacherMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_obs_student',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_obs_class',
      columns: [t.organizationId, t.classId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    foreignKey({
      name: 'fk_obs_assignment',
      columns: [t.organizationId, t.classId, t.assignmentId],
      foreignColumns: [
        assignments.organizationId,
        assignments.classId,
        assignments.id,
      ],
    }),
    foreignKey({
      name: 'fk_obs_attempt_student',
      columns: [t.organizationId, t.studentMembershipId, t.attemptId],
      foreignColumns: [
        activityAttempts.organizationId,
        activityAttempts.studentMembershipId,
        activityAttempts.id,
      ],
    }),
    foreignKey({
      name: 'fk_obs_attempt_assignment',
      columns: [
        t.organizationId,
        t.assignmentId,
        t.studentMembershipId,
        t.attemptId,
      ],
      foreignColumns: [
        activityAttempts.organizationId,
        activityAttempts.assignmentId,
        activityAttempts.studentMembershipId,
        activityAttempts.id,
      ],
    }),
    index('idx_obs_author_student').on(
      t.organizationId,
      t.authorTeacherMembershipId,
      t.studentMembershipId,
      t.deletedAt
    ),
  ]
);
