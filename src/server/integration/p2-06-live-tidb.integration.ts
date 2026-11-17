import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { and, count, eq, inArray, or } from 'drizzle-orm';
import { parseServerConfig } from '../config/env.ts';
import {
  activityAttempts,
  activityAttemptTurns,
  assignmentItems,
  assignmentProgress,
  assignments,
  assignmentTargets,
} from '../db/schema/assignments.ts';
import { auditLogs } from '../db/schema/audit.ts';
import {
  classEnrollments,
  classes,
  classTeachers,
} from '../db/schema/classes.ts';
import {
  contentApprovals,
  contentItems,
  contentVersions,
} from '../db/schema/content.ts';
import {
  organizationMemberships,
  organizations,
  sessions,
  users,
} from '../db/schema/identity.ts';
import { checkTiDbHealth, getDb, validateTiDbEnv } from '../db/tidb.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError, extractDatabaseErrorMeta } from '../http/errors.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAssignmentRepository } from '../repositories/assignment.repository.ts';
import { createAttemptRepository } from '../repositories/attempt.repository.ts';
import { createAuthRepository } from '../repositories/auth.repository.ts';
import { createContentRepository } from '../repositories/content.repository.ts';
import { createAssignmentsRouters } from '../routes/assignments.routes.ts';
import { createAttemptsRouters } from '../routes/attempts.routes.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { hashPassword } from '../security/password-hash.ts';
import { hashSessionToken } from '../security/session.ts';
import { createAssignmentService } from '../services/assignment.service.ts';
import { createAttemptService } from '../services/attempt.service.ts';
import { createAuthService } from '../services/auth.service.ts';
import { createContentService } from '../services/content.service.ts';

export interface P206TableCountsSnapshot {
  organizations: number;
  users: number;
  organizationMemberships: number;
  sessions: number;
  classes: number;
  classTeachers: number;
  classEnrollments: number;
  contentItems: number;
  contentVersions: number;
  contentApprovals: number;
  assignments: number;
  assignmentItems: number;
  assignmentTargets: number;
  activityAttempts: number;
  activityAttemptTurns: number;
  assignmentProgress: number;
  auditLogs: number;
}

export interface P206LiveTiDbReport {
  ok: boolean;
  runTag: string;
  executedAt: string;
  healthStatus: string;
  preFlightCounts: P206TableCountsSnapshot;
  postCleanupCounts: P206TableCountsSnapshot;
  residualSyntheticRows: P206TableCountsSnapshot;
  countsMatchedPreFlight: boolean;
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL';
    detail: string;
  }>;
}

async function readP206TableCounts(): Promise<P206TableCountsSnapshot> {
  const db = getDb();
  const [
    [orgsRow],
    [usersRow],
    [memRow],
    [sessRow],
    [classesRow],
    [ctRow],
    [ceRow],
    [ciRow],
    [cvRow],
    [caRow],
    [assignRow],
    [aiRow],
    [atRow],
    [aaRow],
    [aatRow],
    [apRow],
    [auditRow],
  ] = await Promise.all([
    db.select({ n: count() }).from(organizations),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(organizationMemberships),
    db.select({ n: count() }).from(sessions),
    db.select({ n: count() }).from(classes),
    db.select({ n: count() }).from(classTeachers),
    db.select({ n: count() }).from(classEnrollments),
    db.select({ n: count() }).from(contentItems),
    db.select({ n: count() }).from(contentVersions),
    db.select({ n: count() }).from(contentApprovals),
    db.select({ n: count() }).from(assignments),
    db.select({ n: count() }).from(assignmentItems),
    db.select({ n: count() }).from(assignmentTargets),
    db.select({ n: count() }).from(activityAttempts),
    db.select({ n: count() }).from(activityAttemptTurns),
    db.select({ n: count() }).from(assignmentProgress),
    db.select({ n: count() }).from(auditLogs),
  ]);

  return {
    organizations: Number(orgsRow?.n ?? 0),
    users: Number(usersRow?.n ?? 0),
    organizationMemberships: Number(memRow?.n ?? 0),
    sessions: Number(sessRow?.n ?? 0),
    classes: Number(classesRow?.n ?? 0),
    classTeachers: Number(ctRow?.n ?? 0),
    classEnrollments: Number(ceRow?.n ?? 0),
    contentItems: Number(ciRow?.n ?? 0),
    contentVersions: Number(cvRow?.n ?? 0),
    contentApprovals: Number(caRow?.n ?? 0),
    assignments: Number(assignRow?.n ?? 0),
    assignmentItems: Number(aiRow?.n ?? 0),
    assignmentTargets: Number(atRow?.n ?? 0),
    activityAttempts: Number(aaRow?.n ?? 0),
    activityAttemptTurns: Number(aatRow?.n ?? 0),
    assignmentProgress: Number(apRow?.n ?? 0),
    auditLogs: Number(auditRow?.n ?? 0),
  };
}

export async function runP206LiveTiDbSuite(): Promise<P206LiveTiDbReport> {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    throw new Error(`TiDB env not available: ${envCheck.error.message}`);
  }

  const health = await checkTiDbHealth();
  if (!health.ok) {
    throw new Error(`TiDB health check failed: ${health.error.message}`);
  }

  const runSuffix = crypto.randomBytes(4).toString('hex').toLowerCase();
  const runTag = `p206test-${runSuffix}`;
  const db = getDb();
  const preFlightCounts = await readP206TableCounts();

  // Collision guard before writing any synthetic row
  const [orgCollision] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.code, `${runTag.toUpperCase()}-ORG1`))
    .limit(1);
  const [contentCollision] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.slug, `${runTag}-emotion`))
    .limit(1);
  if (orgCollision || contentCollision) {
    throw new Error(`Synthetic fixture collision detected for ${runTag}`);
  }

  const contentService = createContentService({
    repo: createContentRepository(),
  });
  const assignmentService = createAssignmentService({
    repo: createAssignmentRepository(),
  });
  const attemptService = createAttemptService({
    repo: createAttemptRepository(),
  });

  const trackedOrgIds: string[] = [];
  const trackedUserIds: string[] = [];
  const trackedMembershipIds: string[] = [];
  const trackedClassIds: string[] = [];
  const trackedContentItemIds: string[] = [];
  const trackedVersionIds: string[] = [];
  const trackedAssignmentIds: string[] = [];
  const checks: P206LiveTiDbReport['checks'] = [];

  let httpServer: http.Server | null = null;

  try {
    const now = new Date();
    const rawStudentPassword = `P206!Fx_${runSuffix}`;
    const sharedPassHash = await hashPassword(rawStudentPassword);

    // 1. Seed 2 synthetic orgs, users, memberships, class, teachers, enrollments
    const org1Id = generateUuidV7();
    const org2Id = generateUuidV7();
    trackedOrgIds.push(org1Id, org2Id);
    await db.insert(organizations).values([
      {
        id: org1Id,
        code: `${runTag.toUpperCase()}-ORG1`,
        name: `Synthetic Trường 1 (${runTag})`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: org2Id,
        code: `${runTag.toUpperCase()}-ORG2`,
        name: `Synthetic Trường 2 (${runTag})`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const admin1Id = generateUuidV7();
    const admin2Id = generateUuidV7();
    const t1UserId = generateUuidV7();
    const t2UserId = generateUuidV7();
    const tUnassignedUserId = generateUuidV7();
    const s1UserId = generateUuidV7();
    const s2UserId = generateUuidV7();
    const sOrg2UserId = generateUuidV7();

    trackedUserIds.push(
      admin1Id,
      admin2Id,
      t1UserId,
      t2UserId,
      tUnassignedUserId,
      s1UserId,
      s2UserId,
      sOrg2UserId
    );

    await db.insert(users).values([
      {
        id: admin1Id,
        email: `${runTag}-admin1@synthetic.mimora.local`,
        platformUsername: `${runTag}_admin1`,
        platformRole: 'platform_admin',
        displayName: `Synthetic Admin 1 (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: admin2Id,
        email: `${runTag}-admin2@synthetic.mimora.local`,
        platformUsername: `${runTag}_admin2`,
        platformRole: 'platform_admin',
        displayName: `Synthetic Admin 2 (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: t1UserId,
        email: `${runTag}-t1@synthetic.mimora.local`,
        platformUsername: null,
        platformRole: null,
        displayName: `Cô Lan (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: t2UserId,
        email: `${runTag}-t2@synthetic.mimora.local`,
        platformUsername: null,
        platformRole: null,
        displayName: `Thầy Minh CoTeacher (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: tUnassignedUserId,
        email: `${runTag}-t3@synthetic.mimora.local`,
        platformUsername: null,
        platformRole: null,
        displayName: `Cô Hoa Unassigned (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: s1UserId,
        email: null,
        platformUsername: null,
        platformRole: null,
        displayName: `Bé An (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: s2UserId,
        email: null,
        platformUsername: null,
        platformRole: null,
        displayName: `Bé Bình (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: sOrg2UserId,
        email: null,
        platformUsername: null,
        platformRole: null,
        displayName: `Bé Chi Org2 (${runTag})`,
        passwordHash: sharedPassHash,
        passwordUpdatedAt: now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const t1MemId = generateUuidV7();
    const t2MemId = generateUuidV7();
    const tUnassignedMemId = generateUuidV7();
    const s1MemId = generateUuidV7();
    const s2MemId = generateUuidV7();
    const sOrg2MemId = generateUuidV7();
    trackedMembershipIds.push(
      t1MemId,
      t2MemId,
      tUnassignedMemId,
      s1MemId,
      s2MemId,
      sOrg2MemId
    );

    await db.insert(organizationMemberships).values([
      {
        id: t1MemId,
        organizationId: org1Id,
        userId: t1UserId,
        role: 'teacher',
        orgUsername: `${runTag}_t1`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: t2MemId,
        organizationId: org1Id,
        userId: t2UserId,
        role: 'teacher',
        orgUsername: `${runTag}_t2`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: tUnassignedMemId,
        organizationId: org1Id,
        userId: tUnassignedUserId,
        role: 'teacher',
        orgUsername: `${runTag}_t3`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: s1MemId,
        organizationId: org1Id,
        userId: s1UserId,
        role: 'student',
        orgUsername: `${runTag}_s1`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: s2MemId,
        organizationId: org1Id,
        userId: s2UserId,
        role: 'student',
        orgUsername: `${runTag}_s2`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: sOrg2MemId,
        organizationId: org2Id,
        userId: sOrg2UserId,
        role: 'student',
        orgUsername: `${runTag}_s_org2`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const class1Id = generateUuidV7();
    trackedClassIds.push(class1Id);
    await db.insert(classes).values({
      id: class1Id,
      organizationId: org1Id,
      name: `Lớp SEL P206 (${runTag})`,
      academicYear: '2026-2027',
      status: 'active',
      createdByUserId: admin1Id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(classTeachers).values([
      {
        id: generateUuidV7(),
        organizationId: org1Id,
        classId: class1Id,
        teacherMembershipId: t1MemId,
        assignedByUserId: admin1Id,
        createdAt: now,
      },
      {
        id: generateUuidV7(),
        organizationId: org1Id,
        classId: class1Id,
        teacherMembershipId: t2MemId,
        assignedByUserId: admin1Id,
        createdAt: now,
      },
    ]);
    await db.insert(classEnrollments).values([
      {
        id: generateUuidV7(),
        organizationId: org1Id,
        classId: class1Id,
        studentMembershipId: s1MemId,
        status: 'active',
        enrolledAt: now,
        endedAt: null,
        updatedByUserId: admin1Id,
      },
      {
        id: generateUuidV7(),
        organizationId: org1Id,
        classId: class1Id,
        studentMembershipId: s2MemId,
        status: 'active',
        enrolledAt: now,
        endedAt: null,
        updatedByUserId: admin1Id,
      },
    ]);

    // 2. Publish 2 SEL content items using ContentService (two distinct synthetic admins)
    const adminActor = {
      actorUserId: admin1Id,
      ipPrefix: '127.0.0',
    };
    const admin2Actor = {
      actorUserId: admin2Id,
      ipPrefix: '127.0.0',
    };
    const c1 = await contentService.createContentItem(
      {
        slug: `${runTag}-emotion`,
        contentType: 'emotion_card',
        title: `Nhận diện niềm vui (${runTag})`,
        summary: 'Bài học cảm xúc mẫu',
        locale: 'vi-VN',
        payloadJson: {
          displayTitle: 'Cảm giác vui',
          childText: 'Khi chia sẻ đồ chơi, bạn nhỏ cảm thấy thế nào?',
          emotionKey: 'vui_ve',
          emotionLabel: 'Vui vẻ',
          accessibleDescription: 'Thẻ cảm xúc vui vẻ',
          illustration: {
            assetRef: 'https://cdn.mimora.local/emotion-joy.png',
            altText: 'Minh họa bạn nhỏ đang cười',
          },
          reflectionPrompts: ['Bạn cảm thấy thế nào khi chia sẻ cùng bạn?'],
          readAloud: {
            text: 'Khi chia sẻ đồ chơi, bạn nhỏ cảm thấy thế nào?',
            speechRateHint: 'slow',
          },
          aacSupport: {
            symbolRef: 'aac://emotion/joy',
            symbolLabel: 'Vui',
            coreVocabulary: ['con', 'vui'],
          },
        },
        metadataJson: { ageBand: '6-8' },
      },
      adminActor
    );
    trackedContentItemIds.push(c1.item.id);
    trackedVersionIds.push(c1.version.id);
    await contentService.submitVersionForReview(c1.version.id, adminActor);
    await contentService.approveVersion(
      c1.version.id,
      { decisionNote: 'Duyệt nội dung P2-06' },
      admin2Actor
    );
    await contentService.publishVersion(c1.version.id, adminActor);

    const c2 = await contentService.createContentItem(
      {
        slug: `${runTag}-situation`,
        contentType: 'situation_card',
        title: `Tình huống cùng bạn (${runTag})`,
        summary: 'Bài học tình huống mẫu',
        locale: 'vi-VN',
        payloadJson: {
          displayTitle: 'Tình huống cùng bạn',
          situationText: 'Bạn cùng bàn làm rơi hộp bút màu.',
          narrativeContext: 'Giờ học vẽ trong lớp.',
          accessibleDescription: 'Thẻ tình huống giúp đỡ bạn',
          illustration: {
            assetRef: 'https://cdn.mimora.local/situation-help.png',
            altText: 'Hộp bút màu bị rơi trên sàn lớp học',
          },
          discussionPrompts: ['Mình có thể làm gì để giúp bạn?'],
        },
        metadataJson: { ageBand: '6-8' },
      },
      adminActor
    );
    trackedContentItemIds.push(c2.item.id);
    trackedVersionIds.push(c2.version.id);
    await contentService.submitVersionForReview(c2.version.id, adminActor);
    await contentService.approveVersion(
      c2.version.id,
      { decisionNote: 'Duyệt tình huống P2-06' },
      admin2Actor
    );
    await contentService.publishVersion(c2.version.id, adminActor);

    // 3. Create synthetic assignment via AssignmentService
    const t1Actor = {
      actorUserId: t1UserId,
      organizationId: org1Id,
      teacherMembershipId: t1MemId,
      ipPrefix: '127.0.0.0/24',
    };
    const createdAssignment = await assignmentService.createAssignment(
      {
        classId: class1Id,
        title: `Bài thực hành SEL (${runTag})`,
        homePracticeInstructions: 'Thực hành nhẹ nhàng cùng trẻ.',
        status: 'active',
        items: [
          { contentVersionId: c1.version.id, sortOrder: 0 },
          { contentVersionId: c2.version.id, sortOrder: 1 },
        ],
        targetStudentMembershipIds: [s1MemId, s2MemId],
      },
      t1Actor
    );
    const assignmentId = createdAssignment.assignment.id;
    trackedAssignmentIds.push(assignmentId);
    const item1Id = createdAssignment.items[0].assignmentItemId;
    const item2Id = createdAssignment.items[1].assignmentItemId;
    const targetS1Id = createdAssignment.targets.find(
      (t) => t.studentMembershipId === s1MemId
    )!.targetId;
    const targetS2Id = createdAssignment.targets.find(
      (t) => t.studentMembershipId === s2MemId
    )!.targetId;

    const s1Actor = {
      actorUserId: s1UserId,
      organizationId: org1Id,
      studentMembershipId: s1MemId,
      ipPrefix: '127.0.0.0/24',
    };

    // 4. T-CONC-01: 10 parallel start-or-resume calls against real TiDB
    const conc01Results = await Promise.all(
      Array.from({ length: 10 }, () =>
        attemptService.startOrResumeAttempt(
          {
            targetId: targetS1Id,
            itemId: item1Id,
            usedAacSupport: false,
            usedReadAloud: false,
          },
          s1Actor
        )
      )
    );
    const uniqueAttemptIds01 = new Set(
      conc01Results.map((r) => r.attempt.attemptId)
    );
    assert.equal(uniqueAttemptIds01.size, 1);
    const s1Item1Attempt1Id = conc01Results[0].attempt.attemptId;
    const [conc01DbCount] = await db
      .select({ n: count() })
      .from(activityAttempts)
      .where(
        and(
          eq(activityAttempts.assignmentTargetId, targetS1Id),
          eq(activityAttempts.assignmentItemId, item1Id)
        )
      );
    assert.equal(Number(conc01DbCount?.n ?? 0), 1);

    checks.push({
      name: 'T-CONC-01 (Live TiDB 10 parallel start/resume)',
      status: 'PASS',
      detail: `10/10 parallel calls converged to single attempt ${s1Item1Attempt1Id} (attemptNumber=1, DB rows=1).`,
    });

    // 5. DB virtual generated unique guard check (`uq_attempts_single_in_progress`)
    let dupInProgressRejected = false;
    try {
      await db.insert(activityAttempts).values({
        id: generateUuidV7(),
        organizationId: org1Id,
        assignmentId,
        assignmentTargetId: targetS1Id,
        assignmentItemId: item1Id,
        studentMembershipId: s1MemId,
        contentVersionId: c1.version.id,
        attemptNumber: 99,
        status: 'in_progress',
        startedAt: now,
        lastInteractedAt: now,
        durationSeconds: 0,
        usedAacSupport: false,
        usedReadAloud: false,
        aacTapCount: 0,
        readAloudCount: 0,
      });
    } catch (err: unknown) {
      const meta = extractDatabaseErrorMeta(err);
      if (meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062) {
        dupInProgressRejected = true;
      } else {
        throw err;
      }
    }
    assert.equal(dupInProgressRejected, true);
    checks.push({
      name: 'DB virtual generated guard uq_attempts_single_in_progress',
      status: 'PASS',
      detail:
        'Direct duplicate in_progress insert rejected by TiDB ER_DUP_ENTRY (1062).',
    });

    // 6. Ordered turns, concurrent duplicate turn replay + conflict rejection + idempotent completion
    await attemptService.saveTurn(
      {
        attemptId: s1Item1Attempt1Id,
        turnIndex: 0,
        stepKey: 'intro',
        usedReadAloud: true,
        readAloudDelta: 1,
      },
      s1Actor
    );
    await attemptService.saveTurn(
      {
        attemptId: s1Item1Attempt1Id,
        turnIndex: 1,
        stepKey: 'emotion_pick',
        selectedEmotionKey: 'vui_ve',
        selectedChoiceKey: 'vui_ve',
        usedAac: true,
        aacTapDelta: 2,
      },
      s1Actor
    );

    const parallelSameTurn = await Promise.all([
      attemptService.saveTurn(
        {
          attemptId: s1Item1Attempt1Id,
          turnIndex: 2,
          stepKey: 'reflection',
          selectedChoiceKey: 'chia_se',
        },
        s1Actor
      ),
      attemptService.saveTurn(
        {
          attemptId: s1Item1Attempt1Id,
          turnIndex: 2,
          stepKey: 'reflection',
          selectedChoiceKey: 'chia_se',
        },
        s1Actor
      ),
    ]);
    assert.equal(
      parallelSameTurn[0].savedTurn.id,
      parallelSameTurn[1].savedTurn.id
    );

    await assert.rejects(
      () =>
        attemptService.saveTurn(
          {
            attemptId: s1Item1Attempt1Id,
            turnIndex: 2,
            stepKey: 'reflection_tampered',
          },
          s1Actor
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.httpStatus === 409 &&
        err.code === 'TURN_INDEX_CONFLICT'
    );

    const parallelComplete = await Promise.all([
      attemptService.completeAttempt({ attemptId: s1Item1Attempt1Id }, s1Actor),
      attemptService.completeAttempt({ attemptId: s1Item1Attempt1Id }, s1Actor),
      attemptService.completeAttempt({ attemptId: s1Item1Attempt1Id }, s1Actor),
    ]);
    assert.equal(
      parallelComplete.every((r) => r.attempt.state === 'completed'),
      true
    );
    assert.equal(parallelComplete[0].attempt.progress.completedItems, 1);

    checks.push({
      name: 'Turn ordering, uq_turns_attempt_idx replay/conflict & idempotent completion',
      status: 'PASS',
      detail:
        'Turns [0,1,2] persisted cleanly on TiDB; conflicting turnIndex 2 threw 409; 3 parallel completions converged cleanly.',
    });

    // 7. T-CONC-02: 5 parallel explicit retries after completion
    const retryBatch = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        attemptService.startOrResumeAttempt(
          {
            targetId: targetS1Id,
            itemId: item1Id,
            intent: 'retry',
            idempotencyKey: `conc02-retry-${idx}`,
          },
          s1Actor
        )
      )
    );
    const succeededRetries = retryBatch.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof attemptService.startOrResumeAttempt>>> =>
        r.status === 'fulfilled'
    );
    const conflictRetries = retryBatch.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' &&
        r.reason instanceof AppError &&
        r.reason.httpStatus === 409 &&
        r.reason.code === 'ATTEMPT_ALREADY_IN_PROGRESS'
    );
    assert.equal(succeededRetries.length, 1);
    assert.equal(conflictRetries.length, 4);
    assert.equal(succeededRetries[0].value.attempt.attemptNumber, 2);
    const s1Item1Attempt2Id = succeededRetries[0].value.attempt.attemptId;

    const conc02Rows = await db
      .select({
        id: activityAttempts.id,
        attemptNumber: activityAttempts.attemptNumber,
        status: activityAttempts.status,
      })
      .from(activityAttempts)
      .where(
        and(
          eq(activityAttempts.assignmentTargetId, targetS1Id),
          eq(activityAttempts.assignmentItemId, item1Id)
        )
      );
    assert.equal(conc02Rows.length, 2);
    assert.equal(
      conc02Rows.filter((r) => r.status === 'in_progress').length,
      1
    );
    assert.deepEqual(
      conc02Rows.map((r) => r.attemptNumber).sort((a, b) => a - b),
      [1, 2]
    );

    // Also test same-idempotency-key replay on explicit retry
    const retryIdemKeyReplay = await attemptService.startOrResumeAttempt(
      {
        targetId: targetS1Id,
        itemId: item1Id,
        intent: 'retry',
        idempotencyKey:
          succeededRetries[0].value.attempt.attemptNumber === 2
            ? conc02Rows.find((r) => r.attemptNumber === 2)
              ? (
                  await db
                    .select({ key: activityAttempts.startIdempotencyKey })
                    .from(activityAttempts)
                    .where(eq(activityAttempts.id, s1Item1Attempt2Id))
                )[0]!.key!
              : 'missing'
            : 'missing',
      },
      s1Actor
    );
    assert.equal(retryIdemKeyReplay.httpStatus, 200);
    assert.equal(retryIdemKeyReplay.action, 'idempotent_replay');
    assert.equal(retryIdemKeyReplay.attempt.attemptId, s1Item1Attempt2Id);

    checks.push({
      name: 'T-CONC-02 (Live TiDB 5 parallel explicit retries)',
      status: 'PASS',
      detail: `1/5 retry created attempt #2 (${s1Item1Attempt2Id}), 4/5 returned deterministic 409 ATTEMPT_ALREADY_IN_PROGRESS, same-key replay returned 200.`,
    });

    // 8. Complete item2 and deliberately abandon item1 retry #2 -> verify no double count & neutral abandon
    const s1Item2Start = await attemptService.startOrResumeAttempt(
      { targetId: targetS1Id, itemId: item2Id },
      s1Actor
    );
    await attemptService.completeAttempt(
      { attemptId: s1Item2Start.attempt.attemptId },
      s1Actor
    );
    await attemptService.saveTurn(
      {
        attemptId: s1Item1Attempt2Id,
        turnIndex: 0,
        stepKey: 'retry_pause_step',
        selectedEmotionKey: 'binh_yen',
      },
      s1Actor
    );
    const abandonedRetry = await attemptService.abandonAttempt(
      { attemptId: s1Item1Attempt2Id },
      s1Actor
    );
    assert.equal(abandonedRetry.attempt.state, 'abandoned');
    assert.equal(abandonedRetry.attempt.turns.length, 1);
    assert.equal(abandonedRetry.attempt.progress.completedItems, 2);
    assert.equal(abandonedRetry.attempt.progress.attemptCount, 3);
    assert.equal(abandonedRetry.attempt.progress.status, 'completed');
    assert.equal(abandonedRetry.attempt.progress.activeAttemptId, null);

    checks.push({
      name: 'Progress non-double-count + deliberate abandonment neutrality',
      status: 'PASS',
      detail:
        'completedItems=2/2 (no double-count across item1 retry), attemptCount=3, deliberate abandon preserved turn #0.',
    });

    // 9. T-CONC-03: Real Express HTTP server + Real AuthService sessions + expiry + re-login resume
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    await new Promise<void>((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const baseCfg = parseServerConfig({
      NODE_ENV: 'test',
      SESSION_COOKIE_NAME: 'mimora_session',
      CSRF_SECRET: `p2-06-live-csrf-${runSuffix}-00000000000000000000`,
      TRUSTED_ORIGINS: baseUrl,
    });
    const liveCfg = {
      ...baseCfg,
      auth: { ...baseCfg.auth, trustedOrigins: [baseUrl] },
    };

    const authRepo = createAuthRepository();
    const authService = createAuthService({
      repo: authRepo,
      getConfig: () => liveCfg,
    });
    const authMiddlewares = createAuthMiddlewareSuite({
      repo: authRepo,
      getConfig: () => liveCfg,
    });
    const preAuthCsrf = createPreAuthCsrfMiddleware({
      config: liveCfg,
    });
    const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
      config: liveCfg,
    });
    const { teacherAssignmentsRouter, studentAssignmentsRouter } =
      createAssignmentsRouters({
        assignmentService,
        authMiddlewares,
        authenticatedCsrf,
      });
    const { studentAttemptsRouter, teacherAssignmentAttemptsRouter } =
      createAttemptsRouters({
        attemptService,
        authMiddlewares,
        authenticatedCsrf,
      });

    app.use(
      '/api/v1/auth',
      createAuthRouter({
        authService,
        authMiddlewares,
        preAuthCsrf,
        authenticatedCsrf,
        getConfig: () => liveCfg,
      })
    );
    app.use('/api/v1/assignments', teacherAssignmentsRouter);
    app.use('/api/v1/assignments', teacherAssignmentAttemptsRouter);
    app.use('/api/v1/student/assignments', studentAssignmentsRouter);
    app.use('/api/v1/student', studentAttemptsRouter);
    app.use('/api', apiNotFoundHandler);
    app.use('/api', apiErrorHandler);

    async function httpLogin(payload: Record<string, unknown>) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          [CUSTOM_REQUEST_HEADER]: '1',
        },
        body: JSON.stringify(payload),
      });
      const setCookie = res.headers.get('set-cookie') ?? '';
      const cookieMatch = setCookie.match(/mimora_session=([^;]+)/);
      const rawToken = cookieMatch ? cookieMatch[1] : '';
      const json = (await res.json()) as Record<string, unknown>;
      let sessionId = '';
      if (rawToken) {
        const [sessRow] = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.tokenHash, hashSessionToken(rawToken)))
          .limit(1);
        sessionId = sessRow?.id ?? '';
      }
      return { status: res.status, rawToken, sessionId, json };
    }

    async function httpJson(
      method: string,
      path: string,
      sess: { rawToken: string; sessionId: string },
      body?: unknown
    ) {
      const headers: Record<string, string> = {
        Cookie: `mimora_session=${sess.rawToken}`,
      };
      if (method !== 'GET') {
        headers.Origin = baseUrl;
        headers[CUSTOM_REQUEST_HEADER] = '1';
        headers[CSRF_TOKEN_HEADER] = deriveSessionCsrfToken(
          sess.rawToken,
          sess.sessionId,
          liveCfg.auth.csrfSecret
        );
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return {
        status: res.status,
        json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      };
    }

    // Login Student 2 -> start attempt -> save 2 turns -> expire session in TiDB -> login again -> resume
    const s2Login1 = await httpLogin({
      mode: 'student',
      organizationCode: `${runTag}-org1`,
      orgUsername: `${runTag}_s2`,
      password: rawStudentPassword,
    });
    assert.equal(s2Login1.status, 200);

    const s2StartHttp = await httpJson(
      'POST',
      `/api/v1/student/assignments/${targetS2Id}/items/${item1Id}/start-or-resume`,
      s2Login1,
      {}
    );
    assert.equal(s2StartHttp.status, 201);
    const s2AttemptId = (
      s2StartHttp.json!.attempt as { attemptId: string }
    ).attemptId;

    await httpJson(
      'POST',
      `/api/v1/student/attempts/${s2AttemptId}/turns`,
      s2Login1,
      {
        turnIndex: 0,
        stepKey: 'conc03_step_0',
        selectedEmotionKey: 'vui_ve',
      }
    );
    await httpJson(
      'POST',
      `/api/v1/student/attempts/${s2AttemptId}/turns`,
      s2Login1,
      {
        turnIndex: 1,
        stepKey: 'conc03_step_1',
        selectedChoiceKey: 'cung_choi',
        usedAac: true,
      }
    );

    // Expire & revoke session 1 directly in TiDB sessions table
    await db
      .update(sessions)
      .set({
        idleExpiresAt: new Date(Date.now() - 120_000),
        revokedAt: new Date(),
        revokedReason: 'expired',
      })
      .where(
        and(
          eq(sessions.userId, s2UserId),
          eq(sessions.tokenHash, hashSessionToken(s2Login1.rawToken))
        )
      );

    const afterExpiryGet = await httpJson(
      'GET',
      `/api/v1/student/attempts/${s2AttemptId}`,
      s2Login1
    );
    assert.equal(afterExpiryGet.status, 401);

    // Confirm attempt in TiDB remained in_progress
    const [persistedS2Attempt] = await db
      .select({ status: activityAttempts.status })
      .from(activityAttempts)
      .where(eq(activityAttempts.id, s2AttemptId));
    assert.equal(persistedS2Attempt?.status, 'in_progress');

    // Re-login Student 2
    const s2Login2 = await httpLogin({
      mode: 'student',
      organizationCode: `${runTag}-org1`,
      orgUsername: `${runTag}_s2`,
      password: rawStudentPassword,
    });
    assert.equal(s2Login2.status, 200);

    const s2ResumeHttp = await httpJson(
      'POST',
      `/api/v1/student/assignments/${targetS2Id}/items/${item1Id}/start-or-resume`,
      s2Login2,
      {}
    );
    assert.equal(s2ResumeHttp.status, 200);
    assert.equal(s2ResumeHttp.json!.action, 'resumed');
    const s2Resumed = s2ResumeHttp.json!.attempt as {
      attemptId: string;
      state: string;
      turns: Array<{ turnIndex: number; stepKey: string }>;
    };
    assert.equal(s2Resumed.attemptId, s2AttemptId);
    assert.equal(s2Resumed.state, 'in_progress');
    assert.deepEqual(
      s2Resumed.turns.map((t) => [t.turnIndex, t.stepKey]),
      [
        [0, 'conc03_step_0'],
        [1, 'conc03_step_1'],
      ]
    );

    checks.push({
      name: 'T-CONC-03 (Live TiDB session expiry/revocation & re-login resume)',
      status: 'PASS',
      detail: `Expired session returned 401; TiDB kept attempt ${s2AttemptId} in_progress; re-login resumed exact attempt with 2 ordered turns intact.`,
    });

    // 10. Closed assignment boundary + Co-teacher read-only review + Admin & Cross-org isolation over live TiDB
    await assignmentService.closeAssignment(assignmentId, t1Actor);

    const s2ReadClosed = await httpJson(
      'GET',
      `/api/v1/student/attempts/${s2AttemptId}`,
      s2Login2
    );
    assert.equal(s2ReadClosed.status, 200);
    const closedView = s2ReadClosed.json!.attempt as {
      state: string;
      assignmentStatus: string;
      isReadOnly: boolean;
      turns: unknown[];
    };
    assert.equal(closedView.state, 'in_progress');
    assert.equal(closedView.assignmentStatus, 'closed');
    assert.equal(closedView.isReadOnly, true);
    assert.equal(closedView.turns.length, 2);

    const s2WriteClosed = await httpJson(
      'POST',
      `/api/v1/student/attempts/${s2AttemptId}/turns`,
      s2Login2,
      { turnIndex: 2, stepKey: 'blocked_closed' }
    );
    assert.equal(s2WriteClosed.status, 409);

    const coTeacherLogin = await httpLogin({
      mode: 'admin_teacher',
      identifier: `${runTag}-t2@synthetic.mimora.local`,
      password: rawStudentPassword,
    });
    assert.equal(coTeacherLogin.status, 200);
    const coTeacherAttempts = await httpJson(
      'GET',
      `/api/v1/assignments/${assignmentId}/attempts`,
      coTeacherLogin
    );
    assert.equal(coTeacherAttempts.status, 200);
    assert.equal(coTeacherAttempts.json!.total, 4);

    const unassignedLogin = await httpLogin({
      mode: 'admin_teacher',
      identifier: `${runTag}-t3@synthetic.mimora.local`,
      password: rawStudentPassword,
    });
    assert.equal(
      (
        await httpJson(
          'GET',
          `/api/v1/assignments/${assignmentId}/attempts`,
          unassignedLogin
        )
      ).status,
      403
    );

    const adminLogin = await httpLogin({
      mode: 'admin_teacher',
      identifier: `${runTag}_admin1`,
      password: rawStudentPassword,
    });
    assert.equal(
      (
        await httpJson(
          'GET',
          `/api/v1/assignments/${assignmentId}/attempts`,
          adminLogin
        )
      ).status,
      403
    );

    checks.push({
      name: 'Closed assignment read-only preservation + Co-teacher/Unassigned/Admin boundaries (Live TiDB)',
      status: 'PASS',
      detail:
        'Closed assignment preserved in_progress read-only (200 GET, 409 POST); co-teacher read-only 200; unassigned teacher 403; Platform Admin 403.',
    });
  } finally {
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
      }).catch(() => undefined);
    }

    // Strict reverse-FK cleanup of all tracked synthetic records
    if (trackedOrgIds.length > 0 || trackedUserIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(
          or(
            trackedOrgIds.length > 0
              ? inArray(auditLogs.organizationId, trackedOrgIds)
              : undefined,
            trackedUserIds.length > 0
              ? inArray(auditLogs.actorUserId, trackedUserIds)
              : undefined
          )
        );
    }
    if (trackedUserIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
    }
    if (trackedOrgIds.length > 0) {
      // Must delete assignment_progress BEFORE activity_attempts due to fk_progress_active_attempt & fk_progress_completed_attempt
      await db
        .delete(assignmentProgress)
        .where(inArray(assignmentProgress.organizationId, trackedOrgIds));
      await db
        .delete(activityAttemptTurns)
        .where(inArray(activityAttemptTurns.organizationId, trackedOrgIds));
      await db
        .delete(activityAttempts)
        .where(inArray(activityAttempts.organizationId, trackedOrgIds));
    }
    if (trackedAssignmentIds.length > 0) {
      await db
        .delete(assignmentTargets)
        .where(inArray(assignmentTargets.assignmentId, trackedAssignmentIds));
      await db
        .delete(assignmentItems)
        .where(inArray(assignmentItems.assignmentId, trackedAssignmentIds));
      await db
        .delete(assignments)
        .where(inArray(assignments.id, trackedAssignmentIds));
    }
    if (trackedContentItemIds.length > 0) {
      await db
        .update(contentItems)
        .set({ currentPublishedVersionId: null })
        .where(inArray(contentItems.id, trackedContentItemIds));
    }
    if (trackedVersionIds.length > 0) {
      await db
        .delete(contentApprovals)
        .where(inArray(contentApprovals.contentVersionId, trackedVersionIds));
      await db
        .delete(contentVersions)
        .where(inArray(contentVersions.id, trackedVersionIds));
    }
    if (trackedContentItemIds.length > 0) {
      await db
        .delete(contentItems)
        .where(inArray(contentItems.id, trackedContentItemIds));
    }
    if (trackedClassIds.length > 0) {
      await db
        .delete(classEnrollments)
        .where(inArray(classEnrollments.classId, trackedClassIds));
      await db
        .delete(classTeachers)
        .where(inArray(classTeachers.classId, trackedClassIds));
      await db.delete(classes).where(inArray(classes.id, trackedClassIds));
    }
    if (trackedMembershipIds.length > 0) {
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.id, trackedMembershipIds));
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

  // Verify zero residual rows remain for any tracked IDs
  const [
    [resOrgs],
    [resUsers],
    [resMem],
    [resSess],
    [resClasses],
    [resCt],
    [resCe],
    [resCi],
    [resCv],
    [resCa],
    [resAssign],
    [resAi],
    [resAt],
    [resAa],
    [resAat],
    [resAp],
    [resAudits],
  ] = await Promise.all([
    trackedOrgIds.length > 0
      ? db.select({ n: count() }).from(organizations).where(inArray(organizations.id, trackedOrgIds))
      : Promise.resolve([{ n: 0 }]),
    trackedUserIds.length > 0
      ? db.select({ n: count() }).from(users).where(inArray(users.id, trackedUserIds))
      : Promise.resolve([{ n: 0 }]),
    trackedMembershipIds.length > 0
      ? db.select({ n: count() }).from(organizationMemberships).where(inArray(organizationMemberships.id, trackedMembershipIds))
      : Promise.resolve([{ n: 0 }]),
    trackedUserIds.length > 0
      ? db.select({ n: count() }).from(sessions).where(inArray(sessions.userId, trackedUserIds))
      : Promise.resolve([{ n: 0 }]),
    trackedClassIds.length > 0
      ? db.select({ n: count() }).from(classes).where(inArray(classes.id, trackedClassIds))
      : Promise.resolve([{ n: 0 }]),
    trackedClassIds.length > 0
      ? db.select({ n: count() }).from(classTeachers).where(inArray(classTeachers.classId, trackedClassIds))
      : Promise.resolve([{ n: 0 }]),
    trackedClassIds.length > 0
      ? db.select({ n: count() }).from(classEnrollments).where(inArray(classEnrollments.classId, trackedClassIds))
      : Promise.resolve([{ n: 0 }]),
    trackedContentItemIds.length > 0
      ? db.select({ n: count() }).from(contentItems).where(inArray(contentItems.id, trackedContentItemIds))
      : Promise.resolve([{ n: 0 }]),
    trackedVersionIds.length > 0
      ? db.select({ n: count() }).from(contentVersions).where(inArray(contentVersions.id, trackedVersionIds))
      : Promise.resolve([{ n: 0 }]),
    trackedVersionIds.length > 0
      ? db.select({ n: count() }).from(contentApprovals).where(inArray(contentApprovals.contentVersionId, trackedVersionIds))
      : Promise.resolve([{ n: 0 }]),
    trackedAssignmentIds.length > 0
      ? db.select({ n: count() }).from(assignments).where(inArray(assignments.id, trackedAssignmentIds))
      : Promise.resolve([{ n: 0 }]),
    trackedAssignmentIds.length > 0
      ? db.select({ n: count() }).from(assignmentItems).where(inArray(assignmentItems.assignmentId, trackedAssignmentIds))
      : Promise.resolve([{ n: 0 }]),
    trackedAssignmentIds.length > 0
      ? db.select({ n: count() }).from(assignmentTargets).where(inArray(assignmentTargets.assignmentId, trackedAssignmentIds))
      : Promise.resolve([{ n: 0 }]),
    trackedOrgIds.length > 0
      ? db.select({ n: count() }).from(activityAttempts).where(inArray(activityAttempts.organizationId, trackedOrgIds))
      : Promise.resolve([{ n: 0 }]),
    trackedOrgIds.length > 0
      ? db.select({ n: count() }).from(activityAttemptTurns).where(inArray(activityAttemptTurns.organizationId, trackedOrgIds))
      : Promise.resolve([{ n: 0 }]),
    trackedOrgIds.length > 0
      ? db.select({ n: count() }).from(assignmentProgress).where(inArray(assignmentProgress.organizationId, trackedOrgIds))
      : Promise.resolve([{ n: 0 }]),
    trackedOrgIds.length > 0 || trackedUserIds.length > 0
      ? db
          .select({ n: count() })
          .from(auditLogs)
          .where(
            or(
              trackedOrgIds.length > 0
                ? inArray(auditLogs.organizationId, trackedOrgIds)
                : undefined,
              trackedUserIds.length > 0
                ? inArray(auditLogs.actorUserId, trackedUserIds)
                : undefined
            )
          )
      : Promise.resolve([{ n: 0 }]),
  ]);

  const residualSyntheticRows: P206TableCountsSnapshot = {
    organizations: Number(resOrgs?.n ?? 0),
    users: Number(resUsers?.n ?? 0),
    organizationMemberships: Number(resMem?.n ?? 0),
    sessions: Number(resSess?.n ?? 0),
    classes: Number(resClasses?.n ?? 0),
    classTeachers: Number(resCt?.n ?? 0),
    classEnrollments: Number(resCe?.n ?? 0),
    contentItems: Number(resCi?.n ?? 0),
    contentVersions: Number(resCv?.n ?? 0),
    contentApprovals: Number(resCa?.n ?? 0),
    assignments: Number(resAssign?.n ?? 0),
    assignmentItems: Number(resAi?.n ?? 0),
    assignmentTargets: Number(resAt?.n ?? 0),
    activityAttempts: Number(resAa?.n ?? 0),
    activityAttemptTurns: Number(resAat?.n ?? 0),
    assignmentProgress: Number(resAp?.n ?? 0),
    auditLogs: Number(resAudits?.n ?? 0),
  };

  const postCleanupCounts = await readP206TableCounts();
  const countsMatchedPreFlight =
    JSON.stringify(preFlightCounts) === JSON.stringify(postCleanupCounts);
  const zeroResiduals = Object.values(residualSyntheticRows).every(
    (v) => v === 0
  );

  return {
    ok:
      checks.every((c) => c.status === 'PASS') &&
      countsMatchedPreFlight &&
      zeroResiduals,
    runTag,
    executedAt: new Date().toISOString(),
    healthStatus: health.data.serverVersion ?? 'connected',
    preFlightCounts,
    postCleanupCounts,
    residualSyntheticRows,
    countsMatchedPreFlight,
    checks,
  };
}
