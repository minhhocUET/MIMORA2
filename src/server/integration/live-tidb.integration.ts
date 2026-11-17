import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { count, eq, inArray, or } from 'drizzle-orm';
import { parseServerConfig } from '../config/env.ts';
import { auditLogs } from '../db/schema/audit.ts';
import {
  classEnrollments,
  classes,
  classTeachers,
  csvImportJobs,
} from '../db/schema/classes.ts';
import {
  organizationMemberships,
  organizations,
  sessions,
  users,
} from '../db/schema/identity.ts';
import { checkTiDbHealth, getDb, validateTiDbEnv } from '../db/tidb.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthRepository } from '../repositories/auth.repository.ts';
import { createClassRepository } from '../repositories/class.repository.ts';
import { createCsvImportRepository } from '../repositories/csv-import.repository.ts';
import { createMembershipRepository } from '../repositories/membership.repository.ts';
import { createOrgRepository } from '../repositories/org.repository.ts';
import { hashPassword } from '../security/password-hash.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { hashSessionToken } from '../security/session.ts';
import { createAuthService } from '../services/auth.service.ts';
import { createClassService } from '../services/class.service.ts';
import { createCsvImportService } from '../services/csv-import.service.ts';
import { createMembershipService } from '../services/membership.service.ts';
import { createOrgService } from '../services/org.service.ts';

export interface TableCountsSnapshot {
  organizations: number;
  users: number;
  organizationMemberships: number;
  classes: number;
  classTeachers: number;
  classEnrollments: number;
  csvImportJobs: number;
  sessions: number;
  auditLogs: number;
}

export interface LiveTiDbVerificationReport {
  ok: boolean;
  runTag: string;
  executedAt: string;
  healthStatus: string;
  preFlightCounts: TableCountsSnapshot;
  postCleanupCounts: TableCountsSnapshot;
  checks: Array<{ name: string; status: 'PASS' | 'FAIL'; detail: string }>;
  residualSyntheticRows: TableCountsSnapshot;
  countsMatchedPreFlight: boolean;
}

async function readTableCounts(): Promise<TableCountsSnapshot> {
  const db = getDb();
  const [
    [orgsRow],
    [usersRow],
    [membershipsRow],
    [classesRow],
    [teachersRow],
    [enrollmentsRow],
    [csvJobsRow],
    [sessionsRow],
    [auditsRow],
  ] = await Promise.all([
    db.select({ n: count() }).from(organizations),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(organizationMemberships),
    db.select({ n: count() }).from(classes),
    db.select({ n: count() }).from(classTeachers),
    db.select({ n: count() }).from(classEnrollments),
    db.select({ n: count() }).from(csvImportJobs),
    db.select({ n: count() }).from(sessions),
    db.select({ n: count() }).from(auditLogs),
  ]);

  return {
    organizations: Number(orgsRow?.n ?? 0),
    users: Number(usersRow?.n ?? 0),
    organizationMemberships: Number(membershipsRow?.n ?? 0),
    classes: Number(classesRow?.n ?? 0),
    classTeachers: Number(teachersRow?.n ?? 0),
    classEnrollments: Number(enrollmentsRow?.n ?? 0),
    csvImportJobs: Number(csvJobsRow?.n ?? 0),
    sessions: Number(sessionsRow?.n ?? 0),
    auditLogs: Number(auditsRow?.n ?? 0),
  };
}

async function invokeRequireAuth(
  requireAuth: ReturnType<typeof createAuthMiddlewareSuite>['requireAuth'],
  cookieHeader: string
): Promise<{ ok: boolean; status?: number; auth?: Request['auth'] }> {
  const req = {
    headers: { cookie: cookieHeader },
    ip: '127.0.0.1',
    method: 'GET',
    path: '/api/v1/auth/me',
  } as unknown as Request;
  const res = {
    locals: {},
  } as unknown as Response;

  return new Promise((resolve) => {
    void requireAuth(req, res, (err?: unknown) => {
      if (err) {
        const httpStatus =
          typeof err === 'object' && err !== null && 'httpStatus' in err
            ? Number((err as { httpStatus: number }).httpStatus)
            : 500;
        resolve({ ok: false, status: httpStatus });
        return;
      }
      resolve({ ok: true, auth: req.auth });
    });
  });
}

export async function runLiveTiDbIntegrationSuite(): Promise<LiveTiDbVerificationReport> {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    throw new Error(`TiDB env not available: ${envCheck.error.message}`);
  }

  const health = await checkTiDbHealth();
  if (!health.ok) {
    throw new Error(`TiDB health check failed: ${health.error.message}`);
  }

  const runSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const runTag = `P203TEST_${runSuffix}`;
  const lowerTag = runTag.toLowerCase();

  const db = getDb();
  const preFlightCounts = await readTableCounts();

  // Collision check before creating synthetic fixtures
  const [existingOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(or(eq(organizations.code, `${runTag}_ORG1`), eq(organizations.code, `${runTag}_ORG2`)))
    .limit(1);
  if (existingOrg) {
    throw new Error(`Collision detected for synthetic runTag ${runTag}`);
  }

  const config = parseServerConfig({
    NODE_ENV: 'test',
    AUTH_CSRF_SECRET: `live_tidb_csrf_${runSuffix}_secret_0123456789`,
    CSV_MAX_BYTES: '524288',
    CSV_MAX_ROWS: '500',
  });
  const scryptLimiter = new ScryptConcurrencyLimiter({ maxConcurrent: 4, maxQueue: 20 });
  const rateLimiter = new InMemoryRateLimiter({ maxEntries: 500 });

  const authRepo = createAuthRepository();
  const orgRepo = createOrgRepository();
  const membershipRepo = createMembershipRepository();
  const classRepo = createClassRepository();
  const csvRepo = createCsvImportRepository();

  const authService = createAuthService({
    repo: authRepo,
    rateLimiter,
    scryptLimiter,
    getConfig: () => config,
  });
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => config,
  });
  const orgService = createOrgService({ repo: orgRepo });
  const membershipService = createMembershipService({
    repo: membershipRepo,
    scryptLimiter,
    getConfig: () => config,
  });
  const classService = createClassService({ repo: classRepo });
  const csvService = createCsvImportService({
    repo: csvRepo,
    scryptLimiter,
    getConfig: () => config,
  });

  const trackedOrgIds: string[] = [];
  const trackedUserIds: string[] = [];
  const trackedMembershipIds: string[] = [];
  const trackedClassIds: string[] = [];
  const trackedCsvJobIds: string[] = [];
  const trackedExtraTargetIds: string[] = [];
  const checks: LiveTiDbVerificationReport['checks'] = [];

  const recordCheck = (name: string, detail: string) => {
    checks.push({ name, status: 'PASS', detail });
  };

  try {
    // 1. Bootstrap synthetic platform_admin in users and verify REAL P2-02 admin login
    const adminUserId = generateUuidV7();
    trackedUserIds.push(adminUserId);
    const adminPwd = `Adm!n_${runSuffix}_99`;
    const adminHash = await hashPassword(adminPwd);
    const now = new Date();

    await db.insert(users).values({
      id: adminUserId,
      email: `${lowerTag}_admin@synthetic.local`,
      platformUsername: `${lowerTag}_admin`,
      platformRole: 'platform_admin',
      displayName: `Admin ${runTag}`,
      passwordHash: adminHash,
      passwordUpdatedAt: now,
      status: 'active',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const adminLogin = await authService.login(
      {
        mode: 'admin_teacher',
        identifier: `${lowerTag}_admin`,
        password: adminPwd,
      },
      { ip: '127.0.0.1', ipPrefix: '127.0.0', userAgentHash: null }
    );
    assert.equal(adminLogin.payload.user.id, adminUserId);
    assert.equal(adminLogin.payload.session.scope, 'platform_admin');
    trackedExtraTargetIds.push(adminLogin.payload.session.id);

    const adminMiddlewareOk = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${adminLogin.rawSessionToken}`
    );
    assert.equal(adminMiddlewareOk.ok, true);
    assert.equal(adminMiddlewareOk.auth?.platformRole, 'platform_admin');

    // Verify raw token is NOT stored in sessions; SHA-256 tokenHash IS stored
    const storedSession = await authRepo.findSessionWithContextByTokenHash(
      hashSessionToken(adminLogin.rawSessionToken)
    );
    assert.ok(storedSession);
    assert.notEqual(storedSession.session.tokenHash, adminLogin.rawSessionToken);
    recordCheck(
      'P2-02 Auth Repo + Service + requireAuth (platform_admin)',
      'platformUsername login, SHA-256 session persistence, requireAuth context resolution verified against TiDB'
    );

    // 2. P2-03 OrgService CRUD + duplicate code conflict
    const org1 = await orgService.createOrganization(
      { code: ` ${lowerTag}_org1 `, name: `Synthetic School 1 ${runTag}` },
      { actorUserId: adminUserId, ipPrefix: '127.0.0' }
    );
    trackedOrgIds.push(org1.id);
    assert.equal(org1.code, `${runTag}_ORG1`);

    const org2 = await orgService.createOrganization(
      { code: `${runTag}_ORG2`, name: `Synthetic School 2 ${runTag}` },
      { actorUserId: adminUserId, ipPrefix: '127.0.0' }
    );
    trackedOrgIds.push(org2.id);

    await assert.rejects(
      () =>
        orgService.createOrganization(
          { code: `${runTag}_ORG1`, name: 'Duplicate Code' },
          { actorUserId: adminUserId, ipPrefix: '127.0.0' }
        ),
      (err: { httpStatus?: number; code?: string }) =>
        err.httpStatus === 409 && err.code === 'ORGANIZATION_CODE_EXISTS'
    );
    const updatedOrg1 = await orgService.updateOrganization(
      org1.id,
      { name: `Synthetic School 1 Updated ${runTag}` },
      { actorUserId: adminUserId, ipPrefix: '127.0.0' }
    );
    assert.ok(updatedOrg1.name.includes('Updated'));
    recordCheck(
      'P2-03 OrgRepository + OrgService',
      'Organization create, uppercase code normalization, duplicate 409 guard, update persisted in TiDB'
    );

    // 3. P2-03 MembershipService: multi-org teacher + email-less student + deferred transfer block
    const teacherPwd = `Tchr!_${runSuffix}_11`;
    const teacherCreated = await membershipService.provisionAccount(
      {
        role: 'teacher',
        organizationId: org1.id,
        displayName: `Teacher ${runTag}`,
        email: `${lowerTag}_teacher@synthetic.local`,
        password: teacherPwd,
      },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    trackedUserIds.push(teacherCreated.user.id);
    trackedMembershipIds.push(teacherCreated.membership.id);

    const teacherOrg2Membership =
      await membershipService.createOrganizationMembership(
        {
          organizationId: org2.id,
          userId: teacherCreated.user.id,
          role: 'teacher',
        },
        { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
      );
    trackedMembershipIds.push(teacherOrg2Membership.id);

    const studentPwd = `Stu!_${runSuffix}_22`;
    const studentCreated = await membershipService.provisionAccount(
      {
        role: 'student',
        organizationId: org1.id,
        displayName: `Student ${runTag}`,
        orgUsername: `${lowerTag}_stu1`,
        password: studentPwd,
      },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    trackedUserIds.push(studentCreated.user.id);
    trackedMembershipIds.push(studentCreated.membership.id);
    assert.equal(studentCreated.user.email, null);

    await assert.rejects(
      () =>
        membershipService.createOrganizationMembership(
          {
            organizationId: org2.id,
            userId: studentCreated.user.id,
            role: 'student',
            orgUsername: `${lowerTag}_stu1_moved`,
          },
          { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
        ),
      (err: { httpStatus?: number; code?: string }) =>
        err.httpStatus === 409 && err.code === 'STUDENT_TRANSFER_POLICY_DEFERRED'
    );
    recordCheck(
      'P2-03 MembershipRepository + MembershipService',
      'Multi-org teacher memberships, email-less student provisioning, deferred student transfer block verified in TiDB'
    );

    // 4. P2-03 ClassService + Composite FK & Virtual Generated Column Unique Index Guards in TiDB
    const cls1 = await classService.createClass(
      org1.id,
      { name: `Class 3A ${runTag}`, academicYear: '2026-2027' },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    trackedClassIds.push(cls1.id);

    const clsOrg2 = await classService.createClass(
      org2.id,
      { name: `Class 3B ${runTag}`, academicYear: '2026-2027' },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    trackedClassIds.push(clsOrg2.id);

    await classService.setClassTeachers(
      org1.id,
      cls1.id,
      [teacherCreated.membership.id],
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );

    // Verify TiDB composite FK guard rejects cross-org class_teachers insert directly at SQL layer
    await assert.rejects(async () => {
      await db.insert(classTeachers).values({
        id: generateUuidV7(),
        organizationId: org1.id,
        classId: cls1.id,
        teacherMembershipId: teacherOrg2Membership.id, // belongs to org2!
        assignedByUserId: adminUserId,
        createdAt: new Date(),
      });
    });

    // Enroll -> transferred_out -> re-enroll student and verify uq_class_enrollments_active_pair on TiDB
    await classService.updateClassStudents(
      org1.id,
      cls1.id,
      { mode: 'enroll', studentMembershipIds: [studentCreated.membership.id] },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    await classService.updateClassStudents(
      org1.id,
      cls1.id,
      {
        mode: 'remove',
        studentMembershipIds: [studentCreated.membership.id],
        removedStatus: 'transferred_out',
      },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );
    await classService.updateClassStudents(
      org1.id,
      cls1.id,
      { mode: 'enroll', studentMembershipIds: [studentCreated.membership.id] },
      { actorUserId: adminUserId, actorRole: 'platform_admin', ipPrefix: '127.0.0' }
    );

    // Direct duplicate active insert MUST be rejected by TiDB virtual generated unique constraint
    await assert.rejects(async () => {
      await db.insert(classEnrollments).values({
        id: generateUuidV7(),
        organizationId: org1.id,
        classId: cls1.id,
        studentMembershipId: studentCreated.membership.id,
        status: 'active',
        enrolledAt: new Date(),
        endedAt: null,
        updatedByUserId: adminUserId,
      });
    });

    // Teacher scoped roster check + cross-org probe blocked
    const teacherRoster = await classService.getMyAssignedClassStudents({
      organizationId: org1.id,
      classId: cls1.id,
      teacherMembershipId: teacherCreated.membership.id,
      actorUserId: teacherCreated.user.id,
      ipPrefix: '127.0.0',
    });
    assert.equal(teacherRoster.students.length, 1);

    await assert.rejects(
      () =>
        classService.getMyAssignedClassStudents({
          organizationId: org1.id,
          classId: clsOrg2.id,
          teacherMembershipId: teacherCreated.membership.id,
          actorUserId: teacherCreated.user.id,
          ipPrefix: '127.0.0',
        }),
      (err: { httpStatus?: number }) => err.httpStatus === 403
    );

    recordCheck(
      'P2-03 ClassRepository + TiDB Composite FK & Virtual Active-Pair Unique Guard',
      'Teacher assignment, enrollment history + re-enrollment, composite FK rejection, and uq_class_enrollments_active_pair duplicate active guard verified in TiDB'
    );

    // 5. P2-03 CsvImportService preview + commit against TiDB
    const csvContent = [
      'org_username,display_name,email,initial_password',
      `${lowerTag}_csv1,"Bé CSV 1",,CsvPass!_${runSuffix}_1`,
      `${lowerTag}_csv2,"Bé CSV 2 (No Pass)",,""`,
    ].join('\r\n');

    const previewRes = await csvService.processStudentCsvImport(
      {
        organizationId: org1.id,
        targetClassId: cls1.id,
        sourceFilename: `preview_${runTag}.csv`,
        csvContent,
        mode: 'preview',
      },
      {
        actorUserId: teacherCreated.user.id,
        actorRole: 'teacher',
        teacherMembershipId: teacherCreated.membership.id,
        ipPrefix: '127.0.0',
      }
    );
    trackedCsvJobIds.push(previewRes.job.id);
    assert.equal(previewRes.job.status, 'validated');

    const commitRes = await csvService.processStudentCsvImport(
      {
        organizationId: org1.id,
        targetClassId: cls1.id,
        sourceFilename: `commit_${runTag}.csv`,
        csvContent,
        mode: 'commit',
      },
      {
        actorUserId: teacherCreated.user.id,
        actorRole: 'teacher',
        teacherMembershipId: teacherCreated.membership.id,
        ipPrefix: '127.0.0',
      }
    );
    trackedCsvJobIds.push(commitRes.job.id);
    assert.equal(commitRes.job.status, 'completed');
    assert.ok(commitRes.createdStudents);
    assert.equal(commitRes.createdStudents.length, 1);
    trackedUserIds.push(commitRes.createdStudents[0].userId);
    trackedMembershipIds.push(commitRes.createdStudents[0].membershipId);

    const savedJob = await csvRepo.findImportJobById(org1.id, commitRes.job.id);
    assert.ok(savedJob);
    assert.equal(
      JSON.stringify(savedJob).includes(`CsvPass!_${runSuffix}`),
      false
    );
    recordCheck(
      'P2-03 CsvImportRepository + CsvImportService',
      'Preview (validated) & partial-row commit (completed) persisted in TiDB with zero plaintext password storage'
    );

    // 6. P2-02 Auth Repo + Service + Middleware for email-less Student & multi-org Teacher (rotation + password change)
    const studentLogin = await authService.login(
      {
        mode: 'student',
        organizationCode: org1.code,
        orgUsername: `${lowerTag}_stu1`,
        password: studentPwd,
      },
      { ip: '127.0.0.1', ipPrefix: '127.0.0', userAgentHash: null }
    );
    trackedExtraTargetIds.push(studentLogin.payload.session.id);
    assert.equal(studentLogin.payload.session.scope, 'student');

    const studentAuthCheck = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${studentLogin.rawSessionToken}`
    );
    assert.equal(studentAuthCheck.ok, true);
    assert.equal(studentAuthCheck.auth?.organizationRole, 'student');

    await authService.logout(studentAuthCheck.auth!, { ipPrefix: '127.0.0' });
    const studentAfterLogout = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${studentLogin.rawSessionToken}`
    );
    assert.equal(studentAfterLogout.ok, false);
    assert.equal(studentAfterLogout.status, 401);

    // Multi-org teacher login -> switchOrganization (token rotation) -> changePassword
    const teacherLogin = await authService.login(
      {
        mode: 'admin_teacher',
        identifier: `${lowerTag}_teacher@synthetic.local`,
        password: teacherPwd,
      },
      { ip: '127.0.0.1', ipPrefix: '127.0.0', userAgentHash: null }
    );
    trackedExtraTargetIds.push(teacherLogin.payload.session.id);
    assert.equal(teacherLogin.payload.requiresOrganizationSelection, true);
    assert.equal(teacherLogin.payload.organizations.length, 2);

    const teacherUnscopedCheck = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${teacherLogin.rawSessionToken}`
    );
    assert.equal(teacherUnscopedCheck.ok, true);
    assert.equal(teacherUnscopedCheck.auth?.activeOrganizationId, null);

    const switched = await authService.switchOrganization(
      teacherUnscopedCheck.auth!,
      teacherLogin.rawSessionToken,
      new Date(teacherLogin.payload.session.absoluteExpiresAt),
      org1.id,
      { ipPrefix: '127.0.0' }
    );
    assert.notEqual(switched.rawSessionToken, teacherLogin.rawSessionToken);
    assert.equal(switched.payload.session.activeOrganizationId, org1.id);

    // Old token rejected after rotation
    const oldTokenCheck = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${teacherLogin.rawSessionToken}`
    );
    assert.equal(oldTokenCheck.ok, false);

    // New rotated token accepted
    const rotatedTokenCheck = await invokeRequireAuth(
      authMiddlewares.requireAuth,
      `${config.cookie.name}=${switched.rawSessionToken}`
    );
    assert.equal(rotatedTokenCheck.ok, true);
    assert.equal(rotatedTokenCheck.auth?.activeOrganizationId, org1.id);

    const teacherNewPwd = `TchrNew!_${runSuffix}_77`;
    const pwdChanged = await authService.changePassword(
      rotatedTokenCheck.auth!,
      switched.rawSessionToken,
      new Date(switched.payload.session.absoluteExpiresAt),
      { currentPassword: teacherPwd, newPassword: teacherNewPwd },
      { ipPrefix: '127.0.0' }
    );
    assert.notEqual(pwdChanged.rawSessionToken, switched.rawSessionToken);

    const teacherReLogin = await authService.login(
      {
        mode: 'admin_teacher',
        identifier: `${lowerTag}_teacher@synthetic.local`,
        password: teacherNewPwd,
      },
      { ip: '127.0.0.1', ipPrefix: '127.0.0', userAgentHash: null }
    );
    trackedExtraTargetIds.push(teacherReLogin.payload.session.id);
    assert.equal(teacherReLogin.payload.user.id, teacherCreated.user.id);

    recordCheck(
      'P2-02 Auth Repo + Service + requireAuth (student + multi-org teacher)',
      'Email-less student login & logout revocation, multi-org teacher login, switchOrganization token rotation, changePassword hash update & re-login verified against TiDB'
    );
  } finally {
    // Strict reverse-FK cleanup of ONLY tracked synthetic entities
    if (trackedOrgIds.length > 0 || trackedUserIds.length > 0) {
      const targetFilterIds = [
        ...trackedOrgIds,
        ...trackedUserIds,
        ...trackedMembershipIds,
        ...trackedClassIds,
        ...trackedCsvJobIds,
        ...trackedExtraTargetIds,
      ];
      const auditConds = [];
      if (trackedOrgIds.length > 0) {
        auditConds.push(inArray(auditLogs.organizationId, trackedOrgIds));
      }
      if (trackedUserIds.length > 0) {
        auditConds.push(inArray(auditLogs.actorUserId, trackedUserIds));
      }
      if (targetFilterIds.length > 0) {
        auditConds.push(inArray(auditLogs.targetId, targetFilterIds));
      }
      if (auditConds.length > 0) {
        await db.delete(auditLogs).where(or(...auditConds));
      }

      if (trackedOrgIds.length > 0) {
        await db
          .delete(csvImportJobs)
          .where(inArray(csvImportJobs.organizationId, trackedOrgIds));
        await db
          .delete(classEnrollments)
          .where(inArray(classEnrollments.organizationId, trackedOrgIds));
        await db
          .delete(classTeachers)
          .where(inArray(classTeachers.organizationId, trackedOrgIds));
        await db
          .delete(classes)
          .where(inArray(classes.organizationId, trackedOrgIds));
      }

      if (trackedUserIds.length > 0) {
        await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
      }

      if (trackedOrgIds.length > 0) {
        await db
          .delete(organizationMemberships)
          .where(inArray(organizationMemberships.organizationId, trackedOrgIds));
      }

      if (trackedUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, trackedUserIds));
      }

      if (trackedOrgIds.length > 0) {
        await db
          .delete(organizations)
          .where(inArray(organizations.id, trackedOrgIds));
      }
    }
  }

  // Verify zero residual synthetic rows remain
  const targetFilterIds = [
    ...trackedOrgIds,
    ...trackedUserIds,
    ...trackedMembershipIds,
    ...trackedClassIds,
    ...trackedCsvJobIds,
    ...trackedExtraTargetIds,
  ];
  const [
    [resOrgs],
    [resUsers],
    [resMemberships],
    [resClasses],
    [resTeachers],
    [resEnrollments],
    [resCsvJobs],
    [resSessions],
    [resAudits],
  ] = await Promise.all([
    trackedOrgIds.length
      ? db.select({ n: count() }).from(organizations).where(inArray(organizations.id, trackedOrgIds))
      : [{ n: 0 }],
    trackedUserIds.length
      ? db.select({ n: count() }).from(users).where(inArray(users.id, trackedUserIds))
      : [{ n: 0 }],
    trackedOrgIds.length
      ? db.select({ n: count() }).from(organizationMemberships).where(inArray(organizationMemberships.organizationId, trackedOrgIds))
      : [{ n: 0 }],
    trackedOrgIds.length
      ? db.select({ n: count() }).from(classes).where(inArray(classes.organizationId, trackedOrgIds))
      : [{ n: 0 }],
    trackedOrgIds.length
      ? db.select({ n: count() }).from(classTeachers).where(inArray(classTeachers.organizationId, trackedOrgIds))
      : [{ n: 0 }],
    trackedOrgIds.length
      ? db.select({ n: count() }).from(classEnrollments).where(inArray(classEnrollments.organizationId, trackedOrgIds))
      : [{ n: 0 }],
    trackedOrgIds.length
      ? db.select({ n: count() }).from(csvImportJobs).where(inArray(csvImportJobs.organizationId, trackedOrgIds))
      : [{ n: 0 }],
    trackedUserIds.length
      ? db.select({ n: count() }).from(sessions).where(inArray(sessions.userId, trackedUserIds))
      : [{ n: 0 }],
    db
      .select({ n: count() })
      .from(auditLogs)
      .where(
        or(
          inArray(auditLogs.organizationId, trackedOrgIds),
          inArray(auditLogs.actorUserId, trackedUserIds),
          inArray(auditLogs.targetId, targetFilterIds)
        )
      ),
  ]);

  const residualSyntheticRows: TableCountsSnapshot = {
    organizations: Number(resOrgs?.n ?? 0),
    users: Number(resUsers?.n ?? 0),
    organizationMemberships: Number(resMemberships?.n ?? 0),
    classes: Number(resClasses?.n ?? 0),
    classTeachers: Number(resTeachers?.n ?? 0),
    classEnrollments: Number(resEnrollments?.n ?? 0),
    csvImportJobs: Number(resCsvJobs?.n ?? 0),
    sessions: Number(resSessions?.n ?? 0),
    auditLogs: Number(resAudits?.n ?? 0),
  };

  const postCleanupCounts = await readTableCounts();
  const countsMatchedPreFlight =
    JSON.stringify(preFlightCounts) === JSON.stringify(postCleanupCounts) &&
    Object.values(residualSyntheticRows).every((v) => v === 0);

  if (!countsMatchedPreFlight) {
    throw new Error(
      `Post-cleanup count mismatch! pre=${JSON.stringify(preFlightCounts)} post=${JSON.stringify(postCleanupCounts)} residual=${JSON.stringify(residualSyntheticRows)}`
    );
  }

  checks.push({
    name: 'Post-Cleanup Verification & Pre-Existing Row Integrity',
    status: 'PASS',
    detail: 'All 9 table counts match pre-flight baseline identically; 0 residual synthetic rows',
  });

  return {
    ok: true,
    runTag,
    executedAt: new Date().toISOString(),
    healthStatus: health.data.database,
    preFlightCounts,
    postCleanupCounts,
    checks,
    residualSyntheticRows,
    countsMatchedPreFlight,
  };
}
