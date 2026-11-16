import { sql } from 'drizzle-orm';
import {
  date,
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
import { organizationMemberships, organizations, users } from './identity';

/**
 * 3.5 classes
 */
export const classes = mysqlTable(
  'classes',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    academicYear: varchar('academic_year', { length: 32 }),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_classes_org',
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_classes_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_classes_org_id').on(t.organizationId, t.id),
    index('idx_classes_org_status').on(t.organizationId, t.status),
  ]
);

/**
 * 3.6 class_teachers
 */
export const classTeachers = mysqlTable(
  'class_teachers',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    classId: uuidChar36('class_id').notNull(),
    teacherMembershipId: uuidChar36('teacher_membership_id').notNull(),
    assignedByUserId: uuidChar36('assigned_by_user_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_class_teachers_class',
      columns: [t.organizationId, t.classId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    foreignKey({
      name: 'fk_class_teachers_member',
      columns: [t.organizationId, t.teacherMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_class_teachers_assigned_by',
      columns: [t.assignedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_class_teachers_pair').on(t.classId, t.teacherMembershipId),
    index('idx_class_teachers_member').on(t.organizationId, t.teacherMembershipId),
  ]
);

/**
 * 3.7 class_enrollments (Preserves transferred_out/archived history and enables re-enrollment)
 */
export const classEnrollments = mysqlTable(
  'class_enrollments',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    classId: uuidChar36('class_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    enrolledAt: datetime('enrolled_at', { fsp: 3 }).notNull(),
    endedAt: datetime('ended_at', { fsp: 3 }),
    updatedByUserId: uuidChar36('updated_by_user_id'),
    activeClassGuard: uuidChar36('active_class_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN class_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeStudentGuard: uuidChar36('active_student_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN student_membership_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_enrollments_class',
      columns: [t.organizationId, t.classId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    foreignKey({
      name: 'fk_enrollments_student',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_enrollments_actor',
      columns: [t.updatedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_class_enrollments_active_pair').on(
      t.activeClassGuard,
      t.activeStudentGuard
    ),
    index('idx_enrollments_student').on(
      t.organizationId,
      t.studentMembershipId,
      t.status
    ),
    index('idx_enrollments_class_status').on(t.organizationId, t.classId, t.status),
  ]
);

/**
 * 3.8 student_profiles
 */
export const studentProfiles = mysqlTable(
  'student_profiles',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    preferredName: varchar('preferred_name', { length: 255 }),
    supportPreferencesJson: json('support_preferences_json').$type<
      Record<string, unknown>
    >(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_student_profiles_member',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    unique('uq_student_profiles_member').on(
      t.organizationId,
      t.studentMembershipId
    ),
  ]
);

/**
 * 3.9 student_goals
 */
export const studentGoals = mysqlTable(
  'student_goals',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    studentMembershipId: uuidChar36('student_membership_id').notNull(),
    classId: uuidChar36('class_id'),
    createdByTeacherMembershipId: uuidChar36(
      'created_by_teacher_membership_id'
    ).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    focusArea: varchar('focus_area', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    targetDate: date('target_date', { mode: 'string' }),
    achievedAt: datetime('achieved_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_goals_student',
      columns: [t.organizationId, t.studentMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_goals_teacher',
      columns: [t.organizationId, t.createdByTeacherMembershipId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.id,
      ],
    }),
    foreignKey({
      name: 'fk_goals_class',
      columns: [t.organizationId, t.classId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    index('idx_goals_student_status').on(
      t.organizationId,
      t.studentMembershipId,
      t.status
    ),
    index('idx_goals_class').on(t.organizationId, t.classId, t.status),
  ]
);

/**
 * 3.10 csv_import_jobs
 */
export const csvImportJobs = mysqlTable(
  'csv_import_jobs',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    uploadedByUserId: uuidChar36('uploaded_by_user_id').notNull(),
    targetClassId: uuidChar36('target_class_id'),
    sourceFilename: varchar('source_filename', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    totalRows: int('total_rows').notNull().default(0),
    succeededRows: int('succeeded_rows').notNull().default(0),
    failedRows: int('failed_rows').notNull().default(0),
    errorSummaryJson: json('error_summary_json').$type<
      Record<string, unknown> | Array<Record<string, unknown>>
    >(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    completedAt: datetime('completed_at', { fsp: 3 }),
  },
  (t) => [
    foreignKey({
      name: 'fk_csv_jobs_org',
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_csv_jobs_uploader',
      columns: [t.uploadedByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_csv_jobs_class',
      columns: [t.organizationId, t.targetClassId],
      foreignColumns: [classes.organizationId, classes.id],
    }),
    index('idx_csv_jobs_org_created').on(t.organizationId, t.createdAt),
  ]
);
