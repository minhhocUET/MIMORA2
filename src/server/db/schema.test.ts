import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import * as schema from './schema/index';
import { generateUuidV7 } from './uuid';

const EXPECTED_TABLES = [
  'organizations',
  'users',
  'organization_memberships',
  'sessions',
  'classes',
  'class_teachers',
  'class_enrollments',
  'student_profiles',
  'student_goals',
  'csv_import_jobs',
  'content_items',
  'content_versions',
  'content_approvals',
  'assignments',
  'assignment_items',
  'assignment_targets',
  'activity_attempts',
  'activity_attempt_turns',
  'assignment_progress',
  'teacher_observations',
  'org_insight_daily_snapshots',
  'audit_logs',
  'email_verification_tokens',
  'family_workspaces',
  'family_memberships',
  'family_students',
  'student_link_invitations',
  'guardian_student_links',
  'student_link_invitation_students',
  'family_programs',
  'family_program_versions',
  'family_program_items',
  'family_program_enrollments',
  'family_activity_attempts',
  'family_activity_attempt_turns',
  'student_family_preferences',
] as const;

const ALL_TABLES = [
  schema.organizations,
  schema.users,
  schema.organizationMemberships,
  schema.sessions,
  schema.classes,
  schema.classTeachers,
  schema.classEnrollments,
  schema.studentProfiles,
  schema.studentGoals,
  schema.csvImportJobs,
  schema.contentItems,
  schema.contentVersions,
  schema.contentApprovals,
  schema.assignments,
  schema.assignmentItems,
  schema.assignmentTargets,
  schema.activityAttempts,
  schema.activityAttemptTurns,
  schema.assignmentProgress,
  schema.teacherObservations,
  schema.orgInsightDailySnapshots,
  schema.auditLogs,
  schema.emailVerificationTokens,
  schema.familyWorkspaces,
  schema.familyMemberships,
  schema.familyStudents,
  schema.studentLinkInvitations,
  schema.guardianStudentLinks,
  schema.studentLinkInvitationStudents,
  schema.familyPrograms,
  schema.familyProgramVersions,
  schema.familyProgramItems,
  schema.familyProgramEnrollments,
  schema.familyActivityAttempts,
  schema.familyActivityAttemptTurns,
  schema.studentFamilyPreferences,
];

test('generateUuidV7 produces valid RFC 9562 lowercase UUIDv7 values', () => {
  const uuidV7Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const seen = new Set<string>();

  for (let i = 0; i < 200; i += 1) {
    const id = generateUuidV7();
    assert.match(id, uuidV7Regex);
    assert.equal(id.length, 36);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

test('Drizzle schema defines exact 36 tables with standardized ascii_bin UUID PKs', () => {
  const configs = ALL_TABLES.map((t) => getTableConfig(t));
  const actualNames = configs.map((c) => c.name).sort();
  const expectedNames = [...EXPECTED_TABLES].sort();

  assert.deepEqual(actualNames, expectedNames);

  for (const cfg of configs) {
    const idCol = cfg.columns.find((col) => col.name === 'id');
    assert.ok(idCol, `Table ${cfg.name} must have id column`);
    assert.equal(
      idCol.getSQLType(),
      'char(36) CHARACTER SET ascii COLLATE ascii_bin',
      `Table ${cfg.name}.id must use standardized ascii_bin`
    );
    assert.equal(idCol.primary, true, `Table ${cfg.name}.id must be primary key`);
    assert.equal(idCol.notNull, true, `Table ${cfg.name}.id must be NOT NULL`);
  }
});

test('Drizzle schema defines all 34 composite FKs, 94 total FKs, 49 explicit indexes, and virtual unique guards', () => {
  const configs = ALL_TABLES.map((t) => getTableConfig(t));
  const fkMap = new Map<string, { table: string; columns: string[]; foreignColumns: string[] }>();
  const uniqueNames = new Set<string>();
  let explicitIndexCount = 0;
  let compositeFkCount = 0;

  for (const cfg of configs) {
    explicitIndexCount += cfg.indexes.length;
    for (const uq of cfg.uniqueConstraints) {
      assert.ok(uq.name, `Unique constraint on ${cfg.name} must have explicit name`);
      uniqueNames.add(uq.name);
    }
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const fkName = fk.getName();
      const cols = ref.columns.map((c) => c.name);
      const fCols = ref.foreignColumns.map((c) => c.name);
      fkMap.set(fkName, {
        table: cfg.name,
        columns: cols,
        foreignColumns: fCols,
      });
      if (cols.length > 1) {
        compositeFkCount += 1;
      }
    }
  }

  assert.equal(fkMap.size, 94);
  assert.equal(compositeFkCount, 34);
  assert.equal(explicitIndexCount, 49);

  // Key composite FKs required by P1-02R, P1-02R-FIX1, and P4-02
  assert.deepEqual(fkMap.get('fk_sessions_active_org_membership')?.columns, [
    'active_organization_id',
    'user_id',
  ]);
  assert.deepEqual(fkMap.get('fk_content_items_pub_version')?.columns, [
    'id',
    'current_published_version_id',
  ]);
  assert.deepEqual(fkMap.get('fk_family_programs_pub_version')?.columns, [
    'id',
    'current_published_version_id',
  ]);
  assert.deepEqual(fkMap.get('fk_family_enrollments_prog_version')?.columns, [
    'family_program_id',
    'family_program_version_id',
  ]);
  assert.deepEqual(fkMap.get('fk_family_attempts_enrollment')?.columns, [
    'student_user_id',
    'family_program_version_id',
    'enrollment_id',
  ]);
  assert.deepEqual(fkMap.get('fk_family_attempts_item')?.columns, [
    'family_program_version_id',
    'content_version_id',
    'family_program_item_id',
  ]);
  assert.deepEqual(fkMap.get('fk_attempts_target')?.columns, [
    'organization_id',
    'assignment_id',
    'student_membership_id',
    'assignment_target_id',
  ]);
  assert.deepEqual(fkMap.get('fk_attempts_item')?.columns, [
    'organization_id',
    'assignment_id',
    'content_version_id',
    'assignment_item_id',
  ]);
  assert.deepEqual(fkMap.get('fk_progress_active_attempt')?.columns, [
    'organization_id',
    'assignment_target_id',
    'student_membership_id',
    'active_attempt_id',
  ]);
  assert.deepEqual(fkMap.get('fk_progress_completed_attempt')?.columns, [
    'organization_id',
    'assignment_target_id',
    'student_membership_id',
    'latest_completed_attempt_id',
  ]);
  assert.deepEqual(fkMap.get('fk_obs_attempt_student')?.columns, [
    'organization_id',
    'student_membership_id',
    'attempt_id',
  ]);
  assert.deepEqual(fkMap.get('fk_obs_attempt_assignment')?.columns, [
    'organization_id',
    'assignment_id',
    'student_membership_id',
    'attempt_id',
  ]);

  // Virtual generated unique guards
  assert.ok(uniqueNames.has('uq_class_enrollments_active_pair'));
  assert.ok(uniqueNames.has('uq_approvals_single_pending'));
  assert.ok(uniqueNames.has('uq_attempts_single_in_progress'));
  assert.ok(uniqueNames.has('uq_family_memberships_active_pair'));
  assert.ok(uniqueNames.has('uq_gs_links_active_triple'));
  assert.ok(uniqueNames.has('uq_family_enrollments_active_triple'));
  assert.ok(uniqueNames.has('uq_family_attempts_single_in_progress'));
});
