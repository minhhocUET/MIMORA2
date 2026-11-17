import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { count, eq, inArray, or } from 'drizzle-orm';
import { auditLogs } from '../db/schema/audit.ts';
import {
  contentApprovals,
  contentItems,
  contentVersions,
} from '../db/schema/content.ts';
import { users } from '../db/schema/identity.ts';
import { checkTiDbHealth, getDb, validateTiDbEnv } from '../db/tidb.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';
import { createContentRepository } from '../repositories/content.repository.ts';
import { hashPassword } from '../security/password-hash.ts';
import { createContentService } from '../services/content.service.ts';

export interface P204TableCountsSnapshot {
  users: number;
  contentItems: number;
  contentVersions: number;
  contentApprovals: number;
  auditLogs: number;
}

export interface P204LiveTiDbReport {
  ok: boolean;
  runTag: string;
  executedAt: string;
  healthStatus: string;
  preFlightActiveAdmins: number;
  preFlightCounts: P204TableCountsSnapshot;
  postCleanupCounts: P204TableCountsSnapshot;
  residualSyntheticRows: P204TableCountsSnapshot;
  countsMatchedPreFlight: boolean;
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL' | 'NOT RUN';
    detail: string;
  }>;
}

async function readP204TableCounts(): Promise<P204TableCountsSnapshot> {
  const db = getDb();
  const [
    [usersRow],
    [itemsRow],
    [versionsRow],
    [approvalsRow],
    [auditsRow],
  ] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(contentItems),
    db.select({ n: count() }).from(contentVersions),
    db.select({ n: count() }).from(contentApprovals),
    db.select({ n: count() }).from(auditLogs),
  ]);

  return {
    users: Number(usersRow?.n ?? 0),
    contentItems: Number(itemsRow?.n ?? 0),
    contentVersions: Number(versionsRow?.n ?? 0),
    contentApprovals: Number(approvalsRow?.n ?? 0),
    auditLogs: Number(auditsRow?.n ?? 0),
  };
}

export async function runP204LiveTiDbSuite(): Promise<P204LiveTiDbReport> {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    throw new Error(`TiDB env not available: ${envCheck.error.message}`);
  }

  const health = await checkTiDbHealth();
  if (!health.ok) {
    throw new Error(`TiDB health check failed: ${health.error.message}`);
  }

  const runSuffix = crypto.randomBytes(4).toString('hex').toLowerCase();
  const runTag = `p204test-${runSuffix}`;
  const db = getDb();
  const preFlightCounts = await readP204TableCounts();

  const [activeAdminRow] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.platformRole, 'platform_admin'));
  const preFlightActiveAdmins = Number(activeAdminRow?.n ?? 0);

  // Collision guard before inserting any synthetic fixture
  const [existingCollision] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.slug, `${runTag}-story`))
    .limit(1);
  if (existingCollision) {
    throw new Error(`Synthetic fixture collision for ${runTag}`);
  }

  const contentRepo = createContentRepository();
  const contentService = createContentService({ repo: contentRepo });

  const trackedUserIds: string[] = [];
  const trackedItemIds: string[] = [];
  const trackedVersionIds: string[] = [];
  const checks: P204LiveTiDbReport['checks'] = [];

  const insertSyntheticAdmin = async (label: string): Promise<string> => {
    const id = generateUuidV7();
    trackedUserIds.push(id);
    const now = new Date();
    const passwordHash = await hashPassword(`P204!Adm_${runSuffix}_${label}`);
    await db.insert(users).values({
      id,
      email: `${runTag}-${label}@synthetic.local`,
      platformUsername: `${runTag}_${label}`,
      platformRole: 'platform_admin',
      displayName: `Synthetic Admin ${label} ${runTag}`,
      passwordHash,
      passwordUpdatedAt: now,
      status: 'active',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  try {
    // 1. Insert first synthetic Admin
    const admin1Id = await insertSyntheticAdmin('a1');

    // Check active admin count accurately via status='active'
    const allAdmins = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.platformRole, 'platform_admin'));
    const currentActiveAdmins = allAdmins.filter((u) => u.status === 'active').length;

    if (currentActiveAdmins === 1) {
      const singleCreated = await contentService.createContentItem(
        {
          slug: `${runTag}-single-emotion`,
          contentType: 'emotion_card',
          title: 'Thẻ cảm xúc một quản trị viên',
          locale: 'vi',
          payloadJson: {
            displayTitle: 'Cảm giác bình yên',
            childText: 'Mình cảm thấy thật dễ chịu và an toàn.',
            emotionKey: 'calm',
            emotionLabel: 'Bình yên',
            accessibleDescription: 'Hình minh họa nhẹ nhàng về cảm giác bình yên.',
          },
        },
        { actorUserId: admin1Id, ipPrefix: '127.0.0' }
      );
      trackedItemIds.push(singleCreated.item.id);
      trackedVersionIds.push(singleCreated.version.id);

      await contentService.submitVersionForReview(singleCreated.version.id, {
        actorUserId: admin1Id,
        ipPrefix: '127.0.0',
      });

      const selfApproved = await contentService.approveVersion(
        singleCreated.version.id,
        { decisionNote: 'Live TiDB single-admin review' },
        { actorUserId: admin1Id, ipPrefix: '127.0.0' }
      );
      assert.equal(selfApproved.approval.isSelfApproval, true);
      assert.equal(selfApproved.approval.activeAdminCountAtDecision, 1);

      const selfAudits = await db
        .select({ eventType: auditLogs.eventType })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, singleCreated.version.id));
      assert.ok(selfAudits.some((a) => a.eventType === 'content.self_approved'));

      checks.push({
        name: 'Live TiDB Single-Admin Self-Approval & content.self_approved Audit',
        status: 'PASS',
        detail:
          'Confirmed pre-flight active admins = 0; with 1 synthetic active admin, self-approval succeeded with isSelfApproval=true, activeAdminCountAtDecision=1, and persisted content.self_approved audit row.',
      });
    } else {
      checks.push({
        name: 'Live TiDB Single-Admin Self-Approval & content.self_approved Audit',
        status: 'NOT RUN',
        detail: `Pre-existing active platform_admin accounts detected (preFlight=${currentActiveAdmins - 1}); skipping live single-admin test to avoid altering real Admin accounts (verified via fake-repo tests).`,
      });
    }

    // 2. Insert 2nd and 3rd synthetic Admins to enforce Multi-Admin & test concurrent review
    const admin2Id = await insertSyntheticAdmin('a2');
    const admin3Id = await insertSyntheticAdmin('a3');

    // 3. Create remaining canonical content types (situation_card, action_card, social_story_card, communication_card)
    const draftSituation = await contentService.createContentItem(
      {
        slug: `${runTag}-situation`,
        contentType: 'situation_card',
        title: 'Tình huống giờ ra chơi (Bản nháp)',
        locale: 'vi',
        payloadJson: {
          displayTitle: 'Chờ đến lượt chơi',
          situationText: 'Các bạn đang xếp hàng chờ đến lượt chơi cầu trượt.',
          narrativeContext: 'Sân trường giờ ra chơi.',
          accessibleDescription: 'Tranh minh họa các bạn nhỏ xếp hàng thân thiện.',
        },
      },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    trackedItemIds.push(draftSituation.item.id);
    trackedVersionIds.push(draftSituation.version.id);

    const draftAction = await contentService.createContentItem(
      {
        slug: `${runTag}-action`,
        contentType: 'action_card',
        title: 'Thẻ hành động đếm chậm',
        locale: 'vi',
        payloadJson: {
          displayTitle: 'Đếm chậm từ 1 đến 5',
          actionPhrase: 'Mình có thể đếm chậm từ 1 đến 5 khi thấy hồi hộp.',
          accessibleDescription: 'Minh họa bàn tay nhẹ nhàng đếm nhịp thở.',
        },
      },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    trackedItemIds.push(draftAction.item.id);
    trackedVersionIds.push(draftAction.version.id);

    const draftComm = await contentService.createContentItem(
      {
        slug: `${runTag}-comm`,
        contentType: 'communication_card',
        title: 'Thẻ giao tiếp cần hỗ trợ',
        locale: 'vi-VN',
        payloadJson: {
          displayTitle: 'Con cần giúp đỡ',
          communicationIntent: 'request_help',
          phrase: 'Cô ơi, giúp con phần này với ạ.',
          accessibleDescription: 'Biểu tượng bàn tay giơ nhẹ xin hỗ trợ.',
          aacSupport: {
            symbolLabel: 'Giúp đỡ',
            coreVocabulary: ['con', 'giúp', 'với'],
          },
        },
      },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    trackedItemIds.push(draftComm.item.id);
    trackedVersionIds.push(draftComm.version.id);

    const storyCreated = await contentService.createContentItem(
      {
        slug: `${runTag}-story`,
        contentType: 'social_story_card',
        title: 'Câu chuyện xã hội chuyển tiết',
        summary: 'Hỗ trợ học sinh chuyển hoạt động nhẹ nhàng.',
        locale: 'vi',
        payloadJson: {
          displayTitle: 'Khi chuông báo hiệu reo',
          scenes: [
            {
              sceneNumber: 1,
              text: 'Mình nghe tiếng chuông báo chuẩn bị đổi tiết.',
              accessibleDescription: 'Cảnh 1 minh họa chuông lớp học.',
            },
            {
              sceneNumber: 2,
              text: 'Mình hít thở sâu và cất đồ dùng gọn gàng.',
              accessibleDescription: 'Cảnh 2 minh họa góc bàn học ngăn nắp.',
            },
          ],
        },
      },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    trackedItemIds.push(storyCreated.item.id);
    trackedVersionIds.push(storyCreated.version.id);

    // Duplicate slug blocked at service & SQL layer (uq_content_items_slug)
    await assert.rejects(
      () =>
        contentService.createContentItem(
          {
            slug: `${runTag}-story`,
            contentType: 'social_story_card',
            title: 'Trùng slug',
            payloadJson: storyCreated.version.payloadJson,
          },
          { actorUserId: admin1Id, ipPrefix: '127.0.0' }
        ),
      (err: unknown) => err instanceof AppError && err.code === 'CONTENT_SLUG_EXISTS'
    );
    await assert.rejects(async () => {
      await db.insert(contentItems).values({
        id: generateUuidV7(),
        slug: `${runTag}-story`,
        contentType: 'social_story_card',
        currentPublishedVersionId: null,
        createdByUserId: admin1Id,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    checks.push({
      name: 'Live TiDB 5-Type Authoring & uq_content_items_slug Guard',
      status: 'PASS',
      detail:
        'Created synthetic items across canonical types and verified uq_content_items_slug rejects duplicates at both service and TiDB SQL layers.',
    });

    // 4. Multi-round submit -> uq_approvals_single_pending -> reject -> revise -> resubmit round 2
    const round1Sub = await contentService.submitVersionForReview(
      storyCreated.version.id,
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    assert.equal(round1Sub.approval.submissionRound, 1);

    await assert.rejects(
      () =>
        contentService.submitVersionForReview(storyCreated.version.id, {
          actorUserId: admin1Id,
          ipPrefix: '127.0.0',
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === 'SUBMISSION_ALREADY_PENDING'
    );

    // Direct SQL duplicate pending row MUST be rejected by TiDB virtual generated unique index uq_approvals_single_pending
    await assert.rejects(async () => {
      await db.insert(contentApprovals).values({
        id: generateUuidV7(),
        contentVersionId: storyCreated.version.id,
        submissionRound: 99,
        submittedByUserId: admin1Id,
        submittedAt: new Date(),
        reviewerUserId: null,
        decision: 'pending',
        decisionNote: null,
        isSelfApproval: false,
        activeAdminCountAtDecision: null,
        decidedAt: null,
      });
    });

    // Reject round 1
    const rejectedR1 = await contentService.rejectVersion(
      storyCreated.version.id,
      { decisionNote: 'Cần bổ sung hướng dẫn nhịp thở dịu nhẹ hơn.' },
      { actorUserId: admin2Id, ipPrefix: '127.0.0' }
    );
    assert.equal(rejectedR1.version.status, 'rejected');
    assert.equal(rejectedR1.approval.submissionRound, 1);

    // Rejected version CANNOT be published directly
    await assert.rejects(
      () =>
        contentService.publishVersion(storyCreated.version.id, {
          actorUserId: admin2Id,
          ipPrefix: '127.0.0',
        }),
      (err: unknown) => err instanceof AppError && err.code === 'VERSION_NOT_APPROVED'
    );

    // Revise & resubmit as round 2
    const revisedStoryV1 = await contentService.updateDraftVersion(
      storyCreated.version.id,
      { summary: 'Hướng dẫn chuyển tiết kèm nhịp thở chậm.' },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    assert.equal(revisedStoryV1.status, 'draft');

    const round2Sub = await contentService.submitVersionForReview(
      storyCreated.version.id,
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );
    assert.equal(round2Sub.approval.submissionRound, 2);

    checks.push({
      name: 'Live TiDB Multi-Round Submit/Reject/Resubmit & uq_approvals_single_pending',
      status: 'PASS',
      detail:
        'Verified round 1 submission, TiDB virtual column unique index uq_approvals_single_pending enforcement, rejection blocking publication, draft revision, and round 2 resubmission.',
    });

    // 5. Multi-Admin self-approval block + Concurrent approval race on TiDB
    await assert.rejects(
      () =>
        contentService.approveVersion(
          storyCreated.version.id,
          { decisionNote: 'Attempt self approval' },
          { actorUserId: admin1Id, ipPrefix: '127.0.0' }
        ),
      (err: unknown) => err instanceof AppError && err.httpStatus === 403
    );

    const [raceA, raceB] = await Promise.allSettled([
      contentService.approveVersion(
        storyCreated.version.id,
        { decisionNote: 'Admin 2 approves round 2' },
        { actorUserId: admin2Id, ipPrefix: '127.0.0' }
      ),
      contentService.approveVersion(
        storyCreated.version.id,
        { decisionNote: 'Admin 3 approves round 2' },
        { actorUserId: admin3Id, ipPrefix: '127.0.0' }
      ),
    ]);

    const raceSuccess = [raceA, raceB].filter((r) => r.status === 'fulfilled');
    const raceFail = [raceA, raceB].filter((r) => r.status === 'rejected');
    assert.equal(raceSuccess.length, 1);
    assert.equal(raceFail.length, 1);
    const raceErr = (raceFail[0] as PromiseRejectedResult).reason;
    assert.ok(raceErr instanceof AppError && raceErr.code === 'ALREADY_REVIEWED');

    checks.push({
      name: 'Live TiDB Multi-Admin Separation & Concurrent Approval Race',
      status: 'PASS',
      detail:
        'Creator self-approval rejected (403) with >=2 active admins; concurrent Promise.allSettled approvals yielded exactly 1 winner and 1 deterministic 409 ALREADY_REVIEWED.',
    });

    // 6. Publish v1 -> create v2 (Admin 2 author) -> uq_content_versions_item_num -> approve v2 (Admin 1) -> publish v2 -> v1 superseded & immutable -> Teacher library & archive
    const pubV1 = await contentService.publishVersion(storyCreated.version.id, {
      actorUserId: admin2Id,
      ipPrefix: '127.0.0',
    });
    assert.equal(pubV1.item.currentPublishedVersionId, storyCreated.version.id);

    // Teacher library includes published storyCreated, excludes draftSituation / draftAction
    const libV1List = await contentService.listPublishedLibrary({
      page: 1,
      limit: 50,
      search: runTag,
    });
    assert.ok(libV1List.items.some((i) => i.publishedVersionId === storyCreated.version.id));
    assert.equal(
      libV1List.items.some((i) => i.contentItemId === draftSituation.item.id),
      false
    );
    await assert.rejects(
      () => contentService.getPublishedLibraryItem(draftSituation.item.id),
      (err: unknown) => err instanceof AppError && err.httpStatus === 404
    );

    // Published v1 immutable
    await assert.rejects(
      () =>
        contentService.updateDraftVersion(
          storyCreated.version.id,
          { title: 'Mutate published' },
          { actorUserId: admin1Id, ipPrefix: '127.0.0' }
        ),
      (err: unknown) => err instanceof AppError && err.code === 'VERSION_IMMUTABLE'
    );

    // Admin 2 authors v2
    const storyV2 = await contentService.createDraftVersion(
      storyCreated.item.id,
      {
        title: 'Câu chuyện xã hội chuyển tiết (v2)',
        locale: 'vi-VN',
        payloadJson: {
          ...storyCreated.version.payloadJson,
          closingReflection: 'Mỗi bạn có nhịp chuyển tiết riêng của mình.',
        },
      },
      { actorUserId: admin2Id, ipPrefix: '127.0.0' }
    );
    trackedVersionIds.push(storyV2.id);
    assert.equal(storyV2.versionNumber, 2);

    // uq_content_versions_item_num duplicate version number blocked by TiDB
    await assert.rejects(async () => {
      await db.insert(contentVersions).values({
        id: generateUuidV7(),
        contentItemId: storyCreated.item.id,
        versionNumber: 2,
        status: 'draft',
        title: 'Duplicate v2',
        summary: null,
        locale: 'vi',
        payloadJson: storyV2.payloadJson,
        metadataJson: null,
        createdByUserId: admin2Id,
        publishedByUserId: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    await contentService.submitVersionForReview(storyV2.id, {
      actorUserId: admin2Id,
      ipPrefix: '127.0.0',
    });

    // Admin 1 authored the ITEM, not v2 -> Admin 1 CAN approve v2
    await contentService.approveVersion(
      storyV2.id,
      { decisionNote: 'Admin 1 approves v2' },
      { actorUserId: admin1Id, ipPrefix: '127.0.0' }
    );

    const pubV2 = await contentService.publishVersion(storyV2.id, {
      actorUserId: admin1Id,
      ipPrefix: '127.0.0',
    });
    assert.equal(pubV2.item.currentPublishedVersionId, storyV2.id);

    const versionsAfterV2 = await contentService.listItemVersions(storyCreated.item.id);
    const v1After = versionsAfterV2.versions.find((v) => v.versionNumber === 1)!;
    assert.equal(v1After.status, 'superseded');
    assert.equal(v1After.title, 'Câu chuyện xã hội chuyển tiết');

    // Teacher sees v2 pinned now
    const teacherStoryView = await contentService.getPublishedLibraryItem(
      storyCreated.item.id
    );
    assert.equal(teacherStoryView.publishedVersionId, storyV2.id);
    assert.equal(teacherStoryView.versionNumber, 2);

    // Archive hides it from Teacher library immediately
    await contentService.archiveContentItem(storyCreated.item.id, {
      actorUserId: admin1Id,
      ipPrefix: '127.0.0',
    });
    await assert.rejects(
      () => contentService.getPublishedLibraryItem(storyCreated.item.id),
      (err: unknown) => err instanceof AppError && err.httpStatus === 404
    );

    // Verify audit logs persisted without full payload leakage
    const relatedAudits = await db
      .select()
      .from(auditLogs)
      .where(inArray(auditLogs.actorUserId, trackedUserIds));
    assert.ok(relatedAudits.length >= 10);
    for (const row of relatedAudits) {
      assert.equal(
        JSON.stringify(row.metadataJson ?? {}).includes('chuông báo'),
        false
      );
    }

    checks.push({
      name: 'Live TiDB Publish/Supersede Immutability, uq_content_versions_item_num, Teacher Library & Archive',
      status: 'PASS',
      detail:
        'Verified v1->superseded immutability, v2 publication pointer update, uq_content_versions_item_num enforcement, Teacher published-only library pinning/exclusion, archive hiding, and payload-free audit logs.',
    });
  } finally {
    // Strict reverse-FK cleanup of ONLY tracked synthetic IDs
    // 1. Clear circular fk_content_items_pub_version (ON DELETE RESTRICT) before deleting versions
    if (trackedItemIds.length > 0) {
      await db
        .update(contentItems)
        .set({ currentPublishedVersionId: null })
        .where(inArray(contentItems.id, trackedItemIds));
    }

    // 2. Delete audit logs referencing synthetic actors or targets
    const allTargetIds = [...trackedUserIds, ...trackedItemIds, ...trackedVersionIds];
    const auditDeleteConds = [];
    if (trackedUserIds.length > 0) {
      auditDeleteConds.push(inArray(auditLogs.actorUserId, trackedUserIds));
    }
    if (allTargetIds.length > 0) {
      auditDeleteConds.push(inArray(auditLogs.targetId, allTargetIds));
    }
    if (auditDeleteConds.length > 0) {
      await db.delete(auditLogs).where(or(...auditDeleteConds));
    }

    // 3. Delete content_approvals -> content_versions -> content_items -> users
    if (trackedVersionIds.length > 0) {
      await db
        .delete(contentApprovals)
        .where(inArray(contentApprovals.contentVersionId, trackedVersionIds));
    }
    if (trackedItemIds.length > 0) {
      await db
        .delete(contentVersions)
        .where(inArray(contentVersions.contentItemId, trackedItemIds));
      await db.delete(contentItems).where(inArray(contentItems.id, trackedItemIds));
    }
    if (trackedUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, trackedUserIds));
    }
  }

  // Residual synthetic verification
  const allTargetIds = [...trackedUserIds, ...trackedItemIds, ...trackedVersionIds];
  const [
    [resUsers],
    [resItems],
    [resVersions],
    [resApprovals],
    [resAudits],
  ] = await Promise.all([
    trackedUserIds.length
      ? db.select({ n: count() }).from(users).where(inArray(users.id, trackedUserIds))
      : [{ n: 0 }],
    trackedItemIds.length
      ? db.select({ n: count() }).from(contentItems).where(inArray(contentItems.id, trackedItemIds))
      : [{ n: 0 }],
    trackedVersionIds.length
      ? db.select({ n: count() }).from(contentVersions).where(inArray(contentVersions.contentItemId, trackedItemIds))
      : [{ n: 0 }],
    trackedVersionIds.length
      ? db.select({ n: count() }).from(contentApprovals).where(inArray(contentApprovals.contentVersionId, trackedVersionIds))
      : [{ n: 0 }],
    db
      .select({ n: count() })
      .from(auditLogs)
      .where(
        or(
          inArray(auditLogs.actorUserId, trackedUserIds),
          inArray(auditLogs.targetId, allTargetIds)
        )
      ),
  ]);

  const residualSyntheticRows: P204TableCountsSnapshot = {
    users: Number(resUsers?.n ?? 0),
    contentItems: Number(resItems?.n ?? 0),
    contentVersions: Number(resVersions?.n ?? 0),
    contentApprovals: Number(resApprovals?.n ?? 0),
    auditLogs: Number(resAudits?.n ?? 0),
  };

  const postCleanupCounts = await readP204TableCounts();
  const countsMatchedPreFlight =
    JSON.stringify(preFlightCounts) === JSON.stringify(postCleanupCounts) &&
    Object.values(residualSyntheticRows).every((v) => v === 0);

  if (!countsMatchedPreFlight) {
    throw new Error(
      `P2-04 post-cleanup mismatch! pre=${JSON.stringify(preFlightCounts)} post=${JSON.stringify(postCleanupCounts)} residual=${JSON.stringify(residualSyntheticRows)}`
    );
  }

  checks.push({
    name: 'Live TiDB Post-Cleanup & Pre-Flight Parity Verification',
    status: 'PASS',
    detail:
      'All 5 tracked table counts match pre-flight baseline identically; 0 residual synthetic rows.',
  });

  return {
    ok: checks.every((c) => c.status !== 'FAIL'),
    runTag,
    executedAt: new Date().toISOString(),
    healthStatus: health.data.database,
    preFlightActiveAdmins,
    preFlightCounts,
    postCleanupCounts,
    residualSyntheticRows,
    countsMatchedPreFlight,
    checks,
  };
}
