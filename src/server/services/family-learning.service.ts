import { z } from 'zod';
import { generateUuidV7 } from '../db/uuid.ts';
import {
  ApiErrors,
  type ApiErrorDetail,
  AppError,
  isDatabaseError,
  translateDatabaseError,
} from '../http/errors.ts';
import type { familyActivityAttemptTurns } from '../db/schema/family-learning.ts';
import {
  createFamilyLearningRepository,
  FAMILY_PROGRAM_AVAILABILITY_MODES,
  type FamilyActivityAttemptRecord,
  type FamilyActivityAttemptTurnRecord,
  type FamilyLearningRepository,
  type FamilyProgramEnrollmentRecord,
  type FamilyProgramItemJoinedRecord,
  type FamilyProgramRecord,
  type FamilyProgramVersionRecord,
  type StudentFamilyPreferencesRecord,
} from '../repositories/family-learning.repository.ts';
import {
  isCanonicalContentType,
  scanUnsafeSelText,
} from '../validators/content-payload.schema.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
  type RecordAuditEventInput,
} from './audit.service.ts';
import {
  areAttemptTurnPayloadsEquivalent,
  assertAttemptCanAbandon,
  assertAttemptCanComplete,
  assertAttemptCanSaveTurn,
  assertPinnedContentVersionMatches,
  buildAttemptSupportContextView,
  computeAttemptAvailableActions,
  computeAttemptResumePosition,
  computeMonotonicAttemptDuration,
  isDuplicateKeyDbError,
  normalizeAttemptEngineStatus,
  resolveInitialSupportCounts,
  resolveStartOrResumeEligibility,
  resolveSupportTelemetryUpdate,
  runWithTransientLockRetry,
  toSafeAttemptTurnView,
  validateOptionalAttemptShortText,
  validateRequiredAttemptStepKey,
  validateSafeAttemptJsonObject,
} from './attempt-shared.ts';
import { validateSupportPreferencesJson } from './goal.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,127}$/;

export const programItemInputSchema = z
  .object({
    chapterNumber: z.number().int().min(1).max(100).default(1),
    chapterTitle: z.string().trim().min(1).max(255),
    contentVersionId: z.string().trim().regex(UUID_REGEX),
  })
  .strict();

export const createFamilyProgramSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(128)
      .regex(
        SLUG_REGEX,
        'Slug chỉ gồm chữ thường a-z, số 0-9, dấu gạch dưới hoặc gạch ngang.'
      ),
    availabilityMode: z
      .enum(FAMILY_PROGRAM_AVAILABILITY_MODES)
      .default('admin_assigned'),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    locale: z.enum(['vi', 'vi-VN', 'en', 'en-US']).default('vi'),
    ageBand: z.string().trim().max(64).nullable().optional(),
    items: z.array(programItemInputSchema).max(100).default([]),
  })
  .strict();

export const updateDraftProgramVersionSchema = z
  .object({
    availabilityMode: z.enum(FAMILY_PROGRAM_AVAILABILITY_MODES).optional(),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    locale: z.enum(['vi', 'vi-VN', 'en', 'en-US']).default('vi'),
    ageBand: z.string().trim().max(64).nullable().optional(),
    items: z.array(programItemInputSchema).max(100),
  })
  .strict();

export const createProgramVersionSchema = z
  .object({
    availabilityMode: z.enum(FAMILY_PROGRAM_AVAILABILITY_MODES).optional(),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    locale: z.enum(['vi', 'vi-VN', 'en', 'en-US']).default('vi'),
    ageBand: z.string().trim().max(64).nullable().optional(),
    items: z.array(programItemInputSchema).max(100),
  })
  .strict();

export const adminEnrollStudentSchema = z
  .object({
    familyWorkspaceId: z.string().trim().regex(UUID_REGEX),
    studentUserId: z.string().trim().regex(UUID_REGEX),
    programVersionId: z.string().trim().regex(UUID_REGEX).optional(),
  })
  .strict();

export const guardianActivateFreeProgramSchema = z
  .object({
    familyWorkspaceId: z.string().trim().regex(UUID_REGEX),
    familyProgramId: z.string().trim().regex(UUID_REGEX),
  })
  .strict();

export interface AdminActorContext {
  actorUserId: string;
  ipPrefix: string | null;
}

export interface GuardianActorContext {
  userId: string;
  ipPrefix: string | null;
}

export interface FamilyStudentActorContext {
  actorUserId: string;
  ipPrefix: string | null;
}

export type LearningStateCode = 'not_started' | 'in_progress' | 'completed';

export function mapLearningStateLabelVi(
  status: string
): 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành' {
  if (status === 'completed') return 'Đã hoàn thành';
  if (status === 'in_progress') return 'Đang học';
  return 'Chưa bắt đầu';
}

export interface SafeAdminProgramItemView {
  id: string;
  chapterNumber: number;
  chapterTitle: string;
  sortOrder: number;
  contentVersionId: string;
  contentItemId: string;
  contentSlug: string;
  contentType: string;
  contentVersionNumber: number;
  contentStatus: string;
  contentTitle: string;
  contentSummary: string | null;
  contentLocale: string;
  payloadJson: Record<string, unknown>;
}

export interface SafeAdminProgramVersionView {
  id: string;
  familyProgramId: string;
  versionNumber: number;
  status: string;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  availabilityMode: string;
  publishedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: SafeAdminProgramItemView[];
}

export interface SafeAdminProgramSummaryView {
  id: string;
  slug: string;
  availabilityMode: string;
  status: string;
  currentPublishedVersionId: string | null;
  latestVersionNumber: number;
  latestVersionId: string;
  latestVersionStatus: string;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeAdminProgramEnrollmentRow {
  enrollmentId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  studentUserId: string;
  studentDisplayName: string;
  familyUsername: string | null;
  familyProgramVersionId: string;
  versionNumber: number;
  activationSource: string;
  status: string;
  activatedAt: string;
  revokedAt: string | null;
}

export interface SafeGuardianProgressChapterView {
  chapterNumber: number;
  chapterTitle: string;
  status: LearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
}

export interface SafeGuardianProgressItemView {
  id: string;
  sourceContext: 'family' | 'school';
  sourceLabel: string;
  familyWorkspaceId: string | null;
  title: string;
  versionNumber: number | null;
  status: LearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  chapters: SafeGuardianProgressChapterView[];
}

export interface SafeGuardianStudentProgressOverview {
  student: {
    studentUserId: string;
    displayName: string;
  };
  privacyNotice: string;
  items: SafeGuardianProgressItemView[];
}

export interface SafeStudentFamilyProgramSummaryView {
  enrollmentId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  familyProgramId: string;
  familyProgramVersionId: string;
  versionNumber: number;
  programSlug: string;
  title: string;
  description: string | null;
  locale: string;
  ageBand: string | null;
  activationSource: string;
  learningStatus: LearningStateCode;
  statusLabelVi: 'Chưa bắt đầu' | 'Đang học' | 'Đã hoàn thành';
  totalActivities: number;
  completedActivities: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  activatedAt: string;
}

export interface SafeStudentFamilyProgramItemView {
  id: string;
  itemId: string;
  chapterNumber: number;
  chapterTitle: string;
  sortOrder: number;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
    payloadJson: Record<string, unknown>;
    metadataJson: Record<string, unknown> | null;
  };
  progress: {
    hasInProgress: boolean;
    activeAttemptId: string | null;
    completedAttempts: number;
    latestCompletedAttemptId: string | null;
    status: LearningStateCode;
  };
}

export interface SafeFamilyTurnView {
  id: string;
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  responsePayloadJson: Record<string, unknown> | null;
  respondedAt: string;
}

export interface SafeFamilyStudentAttemptView {
  attemptId: string;
  enrollmentId: string;
  familyWorkspaceId: string;
  itemId: string;
  itemSortOrder: number;
  chapterNumber: number;
  chapterTitle: string;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  attemptNumber: number;
  state: 'in_progress' | 'completed' | 'abandoned';
  isReadOnly: boolean;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  supportContext: {
    usedAacSupport: boolean;
    usedReadAloud: boolean;
    aacTapCount: number;
    readAloudCount: number;
    isOptionalContextOnly: true;
  };
  turns: SafeFamilyTurnView[];
  resumePosition: {
    savedTurnCount: number;
    nextTurnIndex: number;
    lastTurnIndex: number | null;
    lastStepKey: string | null;
  };
  availableActions: {
    canResume: boolean;
    canSubmitTurn: boolean;
    canComplete: boolean;
    canAbandon: boolean;
    canRetry: boolean;
  };
  enrollmentProgress: {
    learningStatus: LearningStateCode;
    totalActivities: number;
    completedActivities: number;
    startedAt: string | null;
    lastActivityAt: string | null;
    completedAt: string | null;
  };
}

export interface SafeStudentFamilyPreferencesView {
  studentUserId: string;
  preferredName: string | null;
  supportPreferencesJson: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface FamilyLearningServiceDeps {
  repo?: FamilyLearningRepository;
  now?: () => Date;
  auditFn?: (
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

const GUARDIAN_PROGRESS_PRIVACY_NOTICE =
  'Tóm tắt tiến độ học tập chỉ hiển thị trạng thái hoàn thành và số lượng hoạt động, bảo vệ tuyệt đối câu trả lời, lựa chọn cảm xúc và nhật ký học tập riêng tư của trẻ.';

function assertSafeText(text: string | null | undefined, field: string): void {
  if (!text) return;
  const issues = scanUnsafeSelText(text, field);
  if (issues.length > 0) {
    throw ApiErrors.validation(issues);
  }
}

function toSafeTurnView(turn: FamilyActivityAttemptTurnRecord): SafeFamilyTurnView {
  return toSafeAttemptTurnView(turn);
}

function toSafeAdminVersionView(
  version: FamilyProgramVersionRecord,
  items?: FamilyProgramItemJoinedRecord[]
): SafeAdminProgramVersionView {
  return {
    id: version.id,
    familyProgramId: version.familyProgramId,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    description: version.description,
    locale: version.locale,
    ageBand: version.ageBand,
    availabilityMode: version.availabilityMode,
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    retiredAt: version.retiredAt ? version.retiredAt.toISOString() : null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    ...(items
      ? {
          items: items.map(
            (i): SafeAdminProgramItemView => ({
              id: i.id,
              chapterNumber: i.chapterNumber,
              chapterTitle: i.chapterTitle,
              sortOrder: i.sortOrder,
              contentVersionId: i.contentVersionId,
              contentItemId: i.contentItemId,
              contentSlug: i.contentSlug,
              contentType: i.contentType,
              contentVersionNumber: i.contentVersionNumber,
              contentStatus: i.contentStatus,
              contentTitle: i.contentTitle,
              contentSummary: i.contentSummary,
              contentLocale: i.contentLocale,
              payloadJson: i.payloadJson,
            })
          ),
        }
      : {}),
  };
}

function buildFamilyAttemptView(params: {
  attempt: FamilyActivityAttemptRecord;
  item: FamilyProgramItemJoinedRecord;
  turns: FamilyActivityAttemptTurnRecord[];
  enrollment: FamilyProgramEnrollmentRecord;
}): SafeFamilyStudentAttemptView {
  const { attempt, item, turns, enrollment } = params;
  const state = normalizeAttemptEngineStatus(attempt.status);
  const isInProgress = state === 'in_progress';
  const safeTurns = turns.map(toSafeTurnView);
  const learningStatus = (
    enrollment.learningStatus === 'completed' ||
    enrollment.learningStatus === 'in_progress'
      ? enrollment.learningStatus
      : 'not_started'
  ) as LearningStateCode;

  return {
    attemptId: attempt.id,
    enrollmentId: attempt.enrollmentId,
    familyWorkspaceId: attempt.familyWorkspaceId,
    itemId: item.id,
    itemSortOrder: item.sortOrder,
    chapterNumber: item.chapterNumber,
    chapterTitle: item.chapterTitle,
    pinnedContentVersion: {
      contentItemId: item.contentItemId,
      contentVersionId: item.contentVersionId,
      contentType: isCanonicalContentType(item.contentType)
        ? item.contentType
        : 'emotion_card',
      versionNumber: item.contentVersionNumber,
      title: item.contentTitle,
      summary: item.contentSummary,
      locale: item.contentLocale,
    },
    attemptNumber: attempt.attemptNumber,
    state,
    isReadOnly: !isInProgress,
    startedAt: attempt.startedAt.toISOString(),
    lastInteractedAt: attempt.lastInteractedAt.toISOString(),
    completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
    elapsedSeconds: attempt.durationSeconds,
    supportContext: buildAttemptSupportContextView(attempt),
    turns: safeTurns,
    resumePosition: computeAttemptResumePosition(safeTurns),
    availableActions: computeAttemptAvailableActions({
      isReadOnly: false,
      state,
    }),
    enrollmentProgress: {
      learningStatus,
      totalActivities: enrollment.totalActivities,
      completedActivities: enrollment.completedActivities,
      startedAt: enrollment.startedAt ? enrollment.startedAt.toISOString() : null,
      lastActivityAt: enrollment.lastActivityAt
        ? enrollment.lastActivityAt.toISOString()
        : null,
      completedAt: enrollment.completedAt
        ? enrollment.completedAt.toISOString()
        : null,
    },
  };
}

function toSafePreferencesView(
  studentUserId: string,
  rec: StudentFamilyPreferencesRecord | null
): SafeStudentFamilyPreferencesView {
  return {
    studentUserId,
    preferredName: rec?.preferredName ?? null,
    supportPreferencesJson: rec?.supportPreferencesJson ?? null,
    updatedAt: rec ? rec.updatedAt.toISOString() : null,
  };
}

export function createFamilyLearningService(deps?: FamilyLearningServiceDeps) {
  const repo = deps?.repo ?? createFamilyLearningRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const auditFn = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ): Promise<void> {
    try {
      await auditFn(input, executor);
    } catch {
      // Never abort business operation on optional mocked audit failure
    }
  }

  async function validateAndPrepareProgramItems(
    rawItems: Array<{
      chapterNumber: number;
      chapterTitle: string;
      contentVersionId: string;
    }>,
    versionId: string,
    now: Date
  ) {
    for (let i = 0; i < rawItems.length; i += 1) {
      assertSafeText(rawItems[i].chapterTitle, `body.items[${i}].chapterTitle`);
    }

    const contentVersionIds = Array.from(
      new Set(rawItems.map((i) => i.contentVersionId))
    );
    const foundVersions = await repo.findPublishedContentVersionsByIds(
      contentVersionIds
    );
    const byId = new Map(foundVersions.map((v) => [v.id, v]));

    const details: ApiErrorDetail[] = [];
    for (let i = 0; i < rawItems.length; i += 1) {
      const cv = byId.get(rawItems[i].contentVersionId);
      if (!cv) {
        details.push({
          field: `body.items[${i}].contentVersionId`,
          code: 'CONTENT_VERSION_NOT_FOUND',
          messageKey: 'error.content.version_not_found',
          message: 'Không tìm thấy phiên bản nội dung SEL được chọn.',
        });
      } else if (cv.status !== 'published' || cv.isArchived) {
        details.push({
          field: `body.items[${i}].contentVersionId`,
          code: 'CONTENT_VERSION_NOT_PUBLISHED',
          messageKey: 'error.content.version_not_published',
          message:
            'Chỉ có thể đưa phiên bản nội dung SEL đã được duyệt xuất bản (published) vào chương trình gia đình.',
        });
      }
    }
    if (details.length > 0) {
      throw ApiErrors.validation(details);
    }

    return rawItems.map((item, idx) => ({
      id: generateUuidV7(),
      familyProgramVersionId: versionId,
      chapterNumber: item.chapterNumber,
      chapterTitle: item.chapterTitle.trim(),
      sortOrder: idx,
      contentVersionId: item.contentVersionId,
      createdAt: now,
    }));
  }

  return {
    // =========================================================================
    // ADMIN FAMILY CURRICULUM MANAGEMENT
    // =========================================================================

    async listFamilyProgramsForAdmin(): Promise<SafeAdminProgramSummaryView[]> {
      const programs = await repo.listPrograms();
      if (programs.length === 0) return [];
      const versions = await repo.listAllLatestVersions(
        programs.map((p) => p.id)
      );
      const versionsByProgram = new Map<string, FamilyProgramVersionRecord[]>();
      for (const v of versions) {
        const list = versionsByProgram.get(v.familyProgramId) ?? [];
        list.push(v);
        versionsByProgram.set(v.familyProgramId, list);
      }

      return programs.map((prog) => {
        const progVersions = (versionsByProgram.get(prog.id) ?? []).sort(
          (a, b) => b.versionNumber - a.versionNumber
        );
        const latest = progVersions[0];
        return {
          id: prog.id,
          slug: prog.slug,
          availabilityMode: prog.availabilityMode,
          status: prog.status,
          currentPublishedVersionId: prog.currentPublishedVersionId,
          latestVersionNumber: latest?.versionNumber ?? 1,
          latestVersionId: latest?.id ?? '',
          latestVersionStatus: latest?.status ?? prog.status,
          title: latest?.title ?? prog.slug,
          description: latest?.description ?? null,
          locale: latest?.locale ?? 'vi',
          ageBand: latest?.ageBand ?? null,
          retiredAt: prog.retiredAt ? prog.retiredAt.toISOString() : null,
          createdAt: prog.createdAt.toISOString(),
          updatedAt: prog.updatedAt.toISOString(),
        };
      });
    },

    async getFamilyProgramDetailForAdmin(programId: string) {
      const program = await repo.findProgramById(programId);
      if (!program) {
        throw ApiErrors.notFound('Không tìm thấy chương trình gia đình.');
      }

      const [versions, enrollments] = await Promise.all([
        repo.listProgramVersions(programId),
        repo.listEnrollmentsForProgram(programId),
      ]);

      const versionsWithItems = await Promise.all(
        versions.map(async (v) => {
          const items = await repo.listProgramVersionItemsJoined(v.id);
          return toSafeAdminVersionView(v, items);
        })
      );

      return {
        program: {
          id: program.id,
          slug: program.slug,
          availabilityMode: program.availabilityMode,
          status: program.status,
          currentPublishedVersionId: program.currentPublishedVersionId,
          retiredAt: program.retiredAt ? program.retiredAt.toISOString() : null,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
        },
        versions: versionsWithItems,
        enrollments: enrollments.map(
          (row): SafeAdminProgramEnrollmentRow => ({
            enrollmentId: row.enrollment.id,
            familyWorkspaceId: row.enrollment.familyWorkspaceId,
            workspaceCode: row.workspaceCode,
            workspaceName: row.workspaceName,
            studentUserId: row.enrollment.studentUserId,
            studentDisplayName: row.studentDisplayName,
            familyUsername: row.familyUsername,
            familyProgramVersionId: row.enrollment.familyProgramVersionId,
            versionNumber: row.versionNumber,
            activationSource: row.enrollment.activationSource,
            status: row.enrollment.status,
            activatedAt: row.enrollment.activatedAt.toISOString(),
            revokedAt: row.enrollment.revokedAt
              ? row.enrollment.revokedAt.toISOString()
              : null,
          })
        ),
      };
    },

    async createFamilyProgramForAdmin(
      rawInput: unknown,
      actor: AdminActorContext
    ) {
      const parsed = createFamilyProgramSchema.parse(rawInput);
      assertSafeText(parsed.title, 'body.title');
      assertSafeText(parsed.description, 'body.description');
      assertSafeText(parsed.ageBand, 'body.ageBand');

      const existingSlug = await repo.findProgramBySlug(parsed.slug);
      if (existingSlug) {
        throw ApiErrors.conflict(
          'PROGRAM_SLUG_EXISTS',
          'error.family_program.slug_exists',
          'Mã định danh (slug) chương trình gia đình này đã tồn tại.'
        );
      }

      const now = nowFn();
      const programId = generateUuidV7();
      const versionId = generateUuidV7();
      const preparedItems = await validateAndPrepareProgramItems(
        parsed.items,
        versionId,
        now
      );

      try {
        await repo.withTransaction(async (tx) => {
          await repo.createProgramWithDraftVersion(
            {
              program: {
                id: programId,
                slug: parsed.slug,
                availabilityMode: parsed.availabilityMode,
                status: 'draft',
                currentPublishedVersionId: null,
                createdByUserId: actor.actorUserId,
                retiredAt: null,
                createdAt: now,
                updatedAt: now,
              },
              version: {
                id: versionId,
                familyProgramId: programId,
                versionNumber: 1,
                status: 'draft',
                title: parsed.title.trim(),
                description: parsed.description?.trim() || null,
                locale: parsed.locale,
                ageBand: parsed.ageBand?.trim() || null,
                availabilityMode: parsed.availabilityMode,
                createdByUserId: actor.actorUserId,
                publishedByUserId: null,
                publishedAt: null,
                retiredAt: null,
                createdAt: now,
                updatedAt: now,
              },
              items: preparedItems,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'family.program_created',
              targetType: 'family_program',
              targetId: programId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                slug: parsed.slug,
                versionId,
                availabilityMode: parsed.availabilityMode,
                itemCount: preparedItems.length,
              },
              createdAt: now,
            },
            tx as unknown as AuditInsertExecutor
          );
        });
      } catch (err) {
        if (isDatabaseError(err)) throw translateDatabaseError(err);
        throw err;
      }

      return this.getFamilyProgramDetailForAdmin(programId);
    },

    async createDraftProgramVersionForAdmin(
      programId: string,
      rawInput: unknown,
      actor: AdminActorContext
    ) {
      const parsed = createProgramVersionSchema.parse(rawInput);
      assertSafeText(parsed.title, 'body.title');
      assertSafeText(parsed.description, 'body.description');
      assertSafeText(parsed.ageBand, 'body.ageBand');

      const program = await repo.findProgramById(programId);
      if (!program) {
        throw ApiErrors.notFound('Không tìm thấy chương trình gia đình.');
      }
      if (program.status === 'retired') {
        throw ApiErrors.conflict(
          'PROGRAM_RETIRED',
          'error.family_program.retired',
          'Chương trình đã ngừng phát hành mới, không thể tạo thêm phiên bản nháp.'
        );
      }

      const versions = await repo.listProgramVersions(programId);
      const nextVersionNumber =
        versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

      const now = nowFn();
      const versionId = generateUuidV7();
      const availabilityMode =
        parsed.availabilityMode ??
        (program.availabilityMode as 'admin_assigned' | 'free_family');
      const preparedItems = await validateAndPrepareProgramItems(
        parsed.items,
        versionId,
        now
      );

      await repo.withTransaction(async (tx) => {
        await repo.createDraftProgramVersion(
          {
            version: {
              id: versionId,
              familyProgramId: programId,
              versionNumber: nextVersionNumber,
              status: 'draft',
              title: parsed.title.trim(),
              description: parsed.description?.trim() || null,
              locale: parsed.locale,
              ageBand: parsed.ageBand?.trim() || null,
              availabilityMode,
              createdByUserId: actor.actorUserId,
              publishedByUserId: null,
              publishedAt: null,
              retiredAt: null,
              createdAt: now,
              updatedAt: now,
            },
            items: preparedItems,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'family.program_version_created',
            targetType: 'family_program_version',
            targetId: versionId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              programId,
              versionNumber: nextVersionNumber,
              itemCount: preparedItems.length,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      const detail = await this.getFamilyProgramDetailForAdmin(programId);
      return {
        ...detail,
        createdVersionId: versionId,
      };
    },

    async updateDraftProgramVersionForAdmin(
      programId: string,
      versionId: string,
      rawInput: unknown,
      actor: AdminActorContext
    ) {
      const parsed = updateDraftProgramVersionSchema.parse(rawInput);
      assertSafeText(parsed.title, 'body.title');
      assertSafeText(parsed.description, 'body.description');
      assertSafeText(parsed.ageBand, 'body.ageBand');

      const [program, version] = await Promise.all([
        repo.findProgramById(programId),
        repo.findProgramVersionById(versionId),
      ]);
      if (!program || !version || version.familyProgramId !== programId) {
        throw ApiErrors.notFound('Không tìm thấy phiên bản chương trình gia đình.');
      }

      if (version.status !== 'draft') {
        throw ApiErrors.conflict(
          'IMMUTABLE_PROGRAM_VERSION',
          'error.family_program.immutable_version',
          'Phiên bản đã xuất bản hoặc đã ngừng phát hành là bất biến và không thể chỉnh sửa. Hãy tạo phiên bản nháp mới.'
        );
      }

      const now = nowFn();
      const availabilityMode = parsed.availabilityMode ?? version.availabilityMode;
      const preparedItems = await validateAndPrepareProgramItems(
        parsed.items,
        versionId,
        now
      );

      await repo.withTransaction(async (tx) => {
        await repo.updateDraftProgramVersionAndItems(
          {
            programId,
            versionId,
            availabilityMode,
            title: parsed.title.trim(),
            description: parsed.description?.trim() || null,
            locale: parsed.locale,
            ageBand: parsed.ageBand?.trim() || null,
            items: preparedItems,
            now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'family.program_updated',
            targetType: 'family_program_version',
            targetId: versionId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              programId,
              itemCount: preparedItems.length,
              availabilityMode,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return this.getFamilyProgramDetailForAdmin(programId);
    },

    async publishProgramVersionForAdmin(
      programId: string,
      versionId: string,
      actor: AdminActorContext
    ) {
      const [program, version] = await Promise.all([
        repo.findProgramById(programId),
        repo.findProgramVersionById(versionId),
      ]);
      if (!program || !version || version.familyProgramId !== programId) {
        throw ApiErrors.notFound('Không tìm thấy phiên bản chương trình gia đình.');
      }
      if (program.status === 'retired') {
        throw ApiErrors.conflict(
          'PROGRAM_RETIRED',
          'error.family_program.retired',
          'Chương trình đã ngừng phát hành, không thể xuất bản phiên bản mới.'
        );
      }
      if (version.status === 'published') {
        throw ApiErrors.conflict(
          'VERSION_ALREADY_PUBLISHED',
          'error.family_program.already_published',
          'Phiên bản này đã được xuất bản trước đó.'
        );
      }
      if (version.status === 'retired') {
        throw ApiErrors.conflict(
          'VERSION_RETIRED',
          'error.family_program.version_retired',
          'Phiên bản đã ngừng phát hành không thể xuất bản lại.'
        );
      }

      const items = await repo.listProgramVersionItemsJoined(versionId);
      if (items.length === 0) {
        throw ApiErrors.validation([
          {
            field: 'items',
            code: 'PROGRAM_REQUIRES_ITEMS',
            messageKey: 'error.family_program.requires_items',
            message:
              'Chương trình gia đình cần có ít nhất 1 hoạt động SEL đã xuất bản trước khi phát hành.',
          },
        ]);
      }

      const contentCheck = await repo.findPublishedContentVersionsByIds(
        items.map((i) => i.contentVersionId)
      );
      const invalidContent = contentCheck.find(
        (c) => c.status !== 'published' || c.isArchived
      );
      if (contentCheck.length === 0 || invalidContent) {
        throw ApiErrors.conflict(
          'UNPUBLISHED_CONTENT_INCLUDED',
          'error.family_program.unpublished_content',
          'Một hoặc nhiều nội dung SEL trong chương trình chưa ở trạng thái published hoặc đã lưu trữ.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        await repo.publishProgramVersion(
          {
            programId,
            versionId,
            availabilityMode: version.availabilityMode,
            publishedByUserId: actor.actorUserId,
            now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'family.program_published',
            targetType: 'family_program_version',
            targetId: versionId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              programId,
              versionNumber: version.versionNumber,
              availabilityMode: version.availabilityMode,
              itemCount: items.length,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return this.getFamilyProgramDetailForAdmin(programId);
    },

    async retireFamilyProgramForAdmin(
      programId: string,
      actor: AdminActorContext
    ) {
      const program = await repo.findProgramById(programId);
      if (!program) {
        throw ApiErrors.notFound('Không tìm thấy chương trình gia đình.');
      }
      if (program.status === 'retired') {
        throw ApiErrors.conflict(
          'PROGRAM_ALREADY_RETIRED',
          'error.family_program.already_retired',
          'Chương trình này đã được ngừng phát hành mới trước đó.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        await repo.retireProgram({ programId, now }, tx);
        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'family.program_retired',
            targetType: 'family_program',
            targetId: programId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              previousStatus: program.status,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return this.getFamilyProgramDetailForAdmin(programId);
    },

    async listEligibleFamilyWorkspacesForAdmin(search?: string) {
      return repo.listEligibleFamilyWorkspacesForAdmin(search);
    },

    async enrollStudentInFamilyProgramForAdmin(
      programId: string,
      rawInput: unknown,
      actor: AdminActorContext
    ) {
      const parsed = adminEnrollStudentSchema.parse(rawInput);
      const program = await repo.findProgramById(programId);
      if (!program) {
        throw ApiErrors.notFound('Không tìm thấy chương trình gia đình.');
      }
      if (program.status === 'retired') {
        throw ApiErrors.conflict(
          'PROGRAM_RETIRED',
          'error.family_program.retired',
          'Chương trình đã ngừng phát hành mới, không thể kích hoạt ghi danh mới.'
        );
      }

      const targetVersionId =
        parsed.programVersionId ?? program.currentPublishedVersionId;
      if (!targetVersionId) {
        throw ApiErrors.conflict(
          'PROGRAM_NOT_PUBLISHED',
          'error.family_program.not_published',
          'Chương trình chưa có phiên bản đã xuất bản (published) để kích hoạt cho gia đình.'
        );
      }

      const version = await repo.findProgramVersionById(targetVersionId);
      if (
        !version ||
        version.familyProgramId !== programId ||
        version.status !== 'published'
      ) {
        throw ApiErrors.conflict(
          'PROGRAM_VERSION_NOT_PUBLISHED',
          'error.family_program.version_not_published',
          'Chỉ có thể kích hoạt phiên bản chương trình đang ở trạng thái đã xuất bản.'
        );
      }

      const eligibility = await repo.verifyStudentEligibleForFamilyWorkspace({
        familyWorkspaceId: parsed.familyWorkspaceId,
        studentUserId: parsed.studentUserId,
      });
      if (!eligibility.eligible) {
        throw ApiErrors.validation([
          {
            field: 'body.studentUserId',
            code: 'STUDENT_WORKSPACE_INELIGIBLE',
            messageKey: 'error.family_program.student_ineligible',
            message:
              'Học sinh phải thuộc không gian gia đình đang hoạt động và có liên kết người giám hộ hợp lệ.',
          },
        ]);
      }

      const existing = await repo.findActiveEnrollment({
        familyWorkspaceId: parsed.familyWorkspaceId,
        studentUserId: parsed.studentUserId,
        familyProgramId: programId,
      });
      if (existing) {
        throw ApiErrors.conflict(
          'ENROLLMENT_ALREADY_ACTIVE',
          'error.family_program.enrollment_exists',
          'Học sinh này đã được kích hoạt chương trình gia đình này trước đó.'
        );
      }

      const items = await repo.listProgramVersionItemsJoined(version.id);
      const now = nowFn();
      const enrollmentId = generateUuidV7();

      try {
        await repo.withTransaction(async (tx) => {
          await repo.createEnrollment(
            {
              id: enrollmentId,
              familyWorkspaceId: parsed.familyWorkspaceId,
              studentUserId: parsed.studentUserId,
              familyProgramId: programId,
              familyProgramVersionId: version.id,
              activationSource: 'admin_grant',
              activatedByUserId: actor.actorUserId,
              status: 'active',
              learningStatus: 'not_started',
              totalActivities: items.length,
              completedActivities: 0,
              startedAt: null,
              lastActivityAt: null,
              completedAt: null,
              activatedAt: now,
              revokedAt: null,
              revokedByUserId: null,
              createdAt: now,
              updatedAt: now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'family.program_enrolled',
              targetType: 'family_program_enrollment',
              targetId: enrollmentId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                familyWorkspaceId: parsed.familyWorkspaceId,
                studentUserId: parsed.studentUserId,
                familyProgramId: programId,
                familyProgramVersionId: version.id,
                versionNumber: version.versionNumber,
                activationSource: 'admin_grant',
              },
              createdAt: now,
            },
            tx as unknown as AuditInsertExecutor
          );
        });
      } catch (err) {
        if (isDatabaseError(err)) throw translateDatabaseError(err);
        throw err;
      }

      return {
        enrollmentId,
        familyWorkspaceId: parsed.familyWorkspaceId,
        studentUserId: parsed.studentUserId,
        familyProgramId: programId,
        familyProgramVersionId: version.id,
        versionNumber: version.versionNumber,
        activationSource: 'admin_grant',
        status: 'active',
        activatedAt: now.toISOString(),
      };
    },

    async revokeEnrollmentForAdmin(
      enrollmentId: string,
      actor: AdminActorContext
    ) {
      const existing = await repo.findEnrollmentById(enrollmentId);
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy lượt kích hoạt chương trình.');
      }
      if (existing.status !== 'active') {
        throw ApiErrors.conflict(
          'ENROLLMENT_NOT_ACTIVE',
          'error.family_program.enrollment_not_active',
          'Lượt kích hoạt chương trình này đã được thu hồi trước đó.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        const ok = await repo.revokeEnrollment(
          {
            enrollmentId,
            revokedByUserId: actor.actorUserId,
            now,
          },
          tx
        );
        if (!ok) {
          throw ApiErrors.conflict(
            'ENROLLMENT_NOT_ACTIVE',
            'error.family_program.enrollment_not_active',
            'Lượt kích hoạt chương trình này đã được thu hồi trước đó.'
          );
        }

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'family.program_enrollment_revoked',
            targetType: 'family_program_enrollment',
            targetId: enrollmentId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              familyProgramId: existing.familyProgramId,
              studentUserId: existing.studentUserId,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        enrollmentId,
        status: 'revoked' as const,
        revokedAt: now.toISOString(),
      };
    },

    // =========================================================================
    // GUARDIAN FREE PROGRAM DISCOVERY + OPTION B PROGRESS OVERVIEW
    // =========================================================================

    async listFreeFamilyProgramsForGuardian() {
      const rows = await repo.listPublishedFreePrograms();
      return rows.map((r) => ({
        programId: r.program.id,
        slug: r.program.slug,
        versionId: r.version.id,
        versionNumber: r.version.versionNumber,
        title: r.version.title,
        description: r.version.description,
        locale: r.version.locale,
        ageBand: r.version.ageBand,
        itemCount: r.itemCount,
        publishedAt: r.version.publishedAt
          ? r.version.publishedAt.toISOString()
          : null,
      }));
    },

    async activateFreeProgramForGuardian(
      studentUserId: string,
      rawInput: unknown,
      actor: GuardianActorContext
    ) {
      const parsed = guardianActivateFreeProgramSchema.parse(rawInput);

      const linkedSummary = await repo.getGuardianLinkedStudentOverview(
        actor.userId,
        studentUserId
      );
      if (
        !linkedSummary ||
        !linkedSummary.workspaceIds.includes(parsed.familyWorkspaceId)
      ) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'user',
          targetId: studentUserId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            reason: 'guardian_not_linked_to_student_in_workspace',
            familyWorkspaceId: parsed.familyWorkspaceId,
          },
        });
        throw ApiErrors.forbidden(
          'Bạn không có liên kết giám hộ hợp lệ với học sinh này trong không gian gia đình đã chọn.'
        );
      }

      const program = await repo.findProgramById(parsed.familyProgramId);
      if (!program || program.status !== 'published' || !program.currentPublishedVersionId) {
        throw ApiErrors.notFound('Không tìm thấy chương trình đang phát hành.');
      }

      if (program.availabilityMode !== 'free_family') {
        throw ApiErrors.forbidden(
          'Chương trình này yêu cầu được quản trị viên kích hoạt cho không gian gia đình.'
        );
      }

      const version = await repo.findProgramVersionById(
        program.currentPublishedVersionId
      );
      if (!version || version.status !== 'published') {
        throw ApiErrors.conflict(
          'PROGRAM_VERSION_NOT_PUBLISHED',
          'error.family_program.version_not_published',
          'Phiên bản chương trình chưa sẵn sàng.'
        );
      }

      const existing = await repo.findActiveEnrollment({
        familyWorkspaceId: parsed.familyWorkspaceId,
        studentUserId,
        familyProgramId: program.id,
      });
      if (existing) {
        throw ApiErrors.conflict(
          'ENROLLMENT_ALREADY_ACTIVE',
          'error.family_program.enrollment_exists',
          'Học sinh đã tham gia chương trình này rồi.'
        );
      }

      const items = await repo.listProgramVersionItemsJoined(version.id);
      const now = nowFn();
      const enrollmentId = generateUuidV7();

      await repo.withTransaction(async (tx) => {
        await repo.createEnrollment(
          {
            id: enrollmentId,
            familyWorkspaceId: parsed.familyWorkspaceId,
            studentUserId,
            familyProgramId: program.id,
            familyProgramVersionId: version.id,
            activationSource: 'free_program',
            activatedByUserId: actor.userId,
            status: 'active',
            learningStatus: 'not_started',
            totalActivities: items.length,
            completedActivities: 0,
            startedAt: null,
            lastActivityAt: null,
            completedAt: null,
            activatedAt: now,
            revokedAt: null,
            revokedByUserId: null,
            createdAt: now,
            updatedAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'family.program_enrolled',
            targetType: 'family_program_enrollment',
            targetId: enrollmentId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              familyWorkspaceId: parsed.familyWorkspaceId,
              studentUserId,
              familyProgramId: program.id,
              familyProgramVersionId: version.id,
              activationSource: 'free_program',
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        enrollmentId,
        familyWorkspaceId: parsed.familyWorkspaceId,
        studentUserId,
        familyProgramId: program.id,
        familyProgramVersionId: version.id,
        activationSource: 'free_program',
        status: 'active',
        activatedAt: now.toISOString(),
      };
    },

    async getLinkedStudentProgressOverviewForGuardian(
      studentUserId: string,
      actor: GuardianActorContext
    ): Promise<SafeGuardianStudentProgressOverview> {
      const linked = await repo.getGuardianLinkedStudentOverview(
        actor.userId,
        studentUserId
      );
      if (!linked) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'user',
          targetId: studentUserId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            reason: 'guardian_progress_unlinked_student',
          },
        });
        throw ApiErrors.forbidden(
          'Bạn chỉ có thể xem tóm tắt tiến độ của học sinh đang có liên kết giám hộ hợp lệ.'
        );
      }

      const [familyRows, schoolRows] = await Promise.all([
        repo.listFamilyEnrollmentsForGuardianOverview({
          studentUserId,
          workspaceIds: linked.workspaceIds,
        }),
        repo.listSchoolAssignmentsForGuardianOverview(studentUserId),
      ]);

      const familyItems: SafeGuardianProgressItemView[] = familyRows.map((row) => {
        const completedSet = new Set(row.completedItemIds);
        const chapterMap = new Map<
          number,
          {
            chapterNumber: number;
            chapterTitle: string;
            totalActivities: number;
            completedActivities: number;
          }
        >();

        for (const item of row.items) {
          const existingChapter = chapterMap.get(item.chapterNumber) ?? {
            chapterNumber: item.chapterNumber,
            chapterTitle: item.chapterTitle,
            totalActivities: 0,
            completedActivities: 0,
          };
          existingChapter.totalActivities += 1;
          if (completedSet.has(item.itemId)) {
            existingChapter.completedActivities += 1;
          }
          chapterMap.set(item.chapterNumber, existingChapter);
        }

        const chapters: SafeGuardianProgressChapterView[] = Array.from(
          chapterMap.values()
        )
          .sort((a, b) => a.chapterNumber - b.chapterNumber)
          .map((ch) => {
            let status: LearningStateCode = 'not_started';
            if (
              ch.totalActivities > 0 &&
              ch.completedActivities >= ch.totalActivities
            ) {
              status = 'completed';
            } else if (
              ch.completedActivities > 0 ||
              row.enrollment.learningStatus === 'in_progress'
            ) {
              status = ch.completedActivities > 0 ? 'in_progress' : 'not_started';
            }
            return {
              chapterNumber: ch.chapterNumber,
              chapterTitle: ch.chapterTitle,
              status,
              statusLabelVi: mapLearningStateLabelVi(status),
              totalActivities: ch.totalActivities,
              completedActivities: ch.completedActivities,
            };
          });

        const totalActivities =
          row.items.length > 0
            ? row.items.length
            : row.enrollment.totalActivities;
        const completedActivities =
          row.items.length > 0
            ? Math.min(totalActivities, completedSet.size)
            : row.enrollment.completedActivities;

        const status = (
          row.enrollment.learningStatus === 'completed' ||
          row.enrollment.learningStatus === 'in_progress'
            ? row.enrollment.learningStatus
            : 'not_started'
        ) as LearningStateCode;

        return {
          id: row.enrollment.id,
          sourceContext: 'family',
          sourceLabel: row.workspaceName,
          familyWorkspaceId: row.enrollment.familyWorkspaceId,
          title: row.programTitle,
          versionNumber: row.versionNumber,
          status,
          statusLabelVi: mapLearningStateLabelVi(status),
          totalActivities,
          completedActivities,
          startedAt: row.enrollment.startedAt
            ? row.enrollment.startedAt.toISOString()
            : null,
          lastActivityAt: row.enrollment.lastActivityAt
            ? row.enrollment.lastActivityAt.toISOString()
            : null,
          completedAt: row.enrollment.completedAt
            ? row.enrollment.completedAt.toISOString()
            : null,
          chapters,
        };
      });

      const schoolItems: SafeGuardianProgressItemView[] = schoolRows.map(
        (row) => {
          const status = (
            row.progressStatus === 'completed' ||
            row.progressStatus === 'in_progress'
              ? row.progressStatus
              : 'not_started'
          ) as LearningStateCode;
          return {
            id: row.assignmentTargetId,
            sourceContext: 'school',
            sourceLabel: row.organizationName,
            familyWorkspaceId: null,
            title: row.assignmentTitle,
            versionNumber: null,
            status,
            statusLabelVi: mapLearningStateLabelVi(status),
            totalActivities: row.totalItems,
            completedActivities: row.completedItems,
            startedAt: row.startedAt ? row.startedAt.toISOString() : null,
            lastActivityAt: row.lastActivityAt
              ? row.lastActivityAt.toISOString()
              : null,
            completedAt: row.completedAt
              ? row.completedAt.toISOString()
              : null,
            chapters: [],
          };
        }
      );

      await safeAudit({
        organizationId: null,
        actorUserId: actor.userId,
        actorRole: 'guardian',
        eventType: 'guardian.progress_viewed',
        targetType: 'user',
        targetId: studentUserId,
        ipPrefix: actor.ipPrefix,
        metadata: {
          familyItemCount: familyItems.length,
          schoolItemCount: schoolItems.length,
        },
        createdAt: nowFn(),
      });

      return {
        student: {
          studentUserId: linked.studentUserId,
          displayName: linked.studentDisplayName,
        },
        privacyNotice: GUARDIAN_PROGRESS_PRIVACY_NOTICE,
        items: [...familyItems, ...schoolItems],
      };
    },

    // =========================================================================
    // TEACHER-FREE STUDENT LEARNING & ATTEMPTS
    // =========================================================================

    async listMyFamilyProgramsForStudent(
      studentUserId: string
    ): Promise<SafeStudentFamilyProgramSummaryView[]> {
      const rows = await repo.listActiveStudentEnrollments(studentUserId);
      return rows.map((row) => {
        const learningStatus = (
          row.enrollment.learningStatus === 'completed' ||
          row.enrollment.learningStatus === 'in_progress'
            ? row.enrollment.learningStatus
            : 'not_started'
        ) as LearningStateCode;

        return {
          enrollmentId: row.enrollment.id,
          familyWorkspaceId: row.enrollment.familyWorkspaceId,
          workspaceCode: row.workspaceCode,
          workspaceName: row.workspaceName,
          familyProgramId: row.program.id,
          familyProgramVersionId: row.version.id,
          versionNumber: row.version.versionNumber,
          programSlug: row.program.slug,
          title: row.version.title,
          description: row.version.description,
          locale: row.version.locale,
          ageBand: row.version.ageBand,
          activationSource: row.enrollment.activationSource,
          learningStatus,
          statusLabelVi: mapLearningStateLabelVi(learningStatus),
          totalActivities: row.enrollment.totalActivities,
          completedActivities: row.enrollment.completedActivities,
          startedAt: row.enrollment.startedAt
            ? row.enrollment.startedAt.toISOString()
            : null,
          lastActivityAt: row.enrollment.lastActivityAt
            ? row.enrollment.lastActivityAt.toISOString()
            : null,
          completedAt: row.enrollment.completedAt
            ? row.enrollment.completedAt.toISOString()
            : null,
          activatedAt: row.enrollment.activatedAt.toISOString(),
        };
      });
    },

    async getMyFamilyProgramDetailForStudent(
      studentUserId: string,
      enrollmentId: string
    ) {
      const joined = await repo.findActiveStudentEnrollmentById(
        studentUserId,
        enrollmentId
      );
      if (!joined) {
        throw ApiErrors.notFound(
          'Không tìm thấy chương trình gia đình trong tài khoản của bạn.'
        );
      }

      const [items, attempts] = await Promise.all([
        repo.listProgramVersionItemsJoined(joined.version.id),
        repo.listFamilyAttemptsForEnrollment(studentUserId, enrollmentId),
      ]);

      const learningStatus = (
        joined.enrollment.learningStatus === 'completed' ||
        joined.enrollment.learningStatus === 'in_progress'
          ? joined.enrollment.learningStatus
          : 'not_started'
      ) as LearningStateCode;

      const mappedItems: SafeStudentFamilyProgramItemView[] = items.map((item) => {
        const itemAttempts = attempts.filter(
          (a) => a.familyProgramItemId === item.id
        );
        const activeAttempt =
          itemAttempts.find((a) => a.status === 'in_progress') ?? null;
        const completedAttempts = itemAttempts.filter(
          (a) => a.status === 'completed'
        );
        const status: LearningStateCode =
          completedAttempts.length > 0
            ? 'completed'
            : activeAttempt
              ? 'in_progress'
              : 'not_started';

        return {
          id: item.id,
          itemId: item.id,
          chapterNumber: item.chapterNumber,
          chapterTitle: item.chapterTitle,
          sortOrder: item.sortOrder,
          pinnedContentVersion: {
            contentItemId: item.contentItemId,
            contentVersionId: item.contentVersionId,
            contentType: item.contentType,
            versionNumber: item.contentVersionNumber,
            title: item.contentTitle,
            summary: item.contentSummary,
            locale: item.contentLocale,
            payloadJson: item.payloadJson,
            metadataJson: item.metadataJson,
          },
          progress: {
            hasInProgress: Boolean(activeAttempt),
            activeAttemptId: activeAttempt?.id ?? null,
            completedAttempts: completedAttempts.length,
            latestCompletedAttemptId: completedAttempts[0]?.id ?? null,
            status,
          },
        };
      });

      return {
        program: {
          enrollmentId: joined.enrollment.id,
          familyWorkspaceId: joined.enrollment.familyWorkspaceId,
          workspaceCode: joined.workspaceCode,
          workspaceName: joined.workspaceName,
          familyProgramId: joined.program.id,
          familyProgramVersionId: joined.version.id,
          versionNumber: joined.version.versionNumber,
          programSlug: joined.program.slug,
          title: joined.version.title,
          description: joined.version.description,
          locale: joined.version.locale,
          ageBand: joined.version.ageBand,
          learningStatus,
          statusLabelVi: mapLearningStateLabelVi(learningStatus),
          totalActivities: joined.enrollment.totalActivities,
          completedActivities: joined.enrollment.completedActivities,
          startedAt: joined.enrollment.startedAt
            ? joined.enrollment.startedAt.toISOString()
            : null,
          lastActivityAt: joined.enrollment.lastActivityAt
            ? joined.enrollment.lastActivityAt.toISOString()
            : null,
          completedAt: joined.enrollment.completedAt
            ? joined.enrollment.completedAt.toISOString()
            : null,
        },
        items: mappedItems,
      };
    },

    async startOrResumeFamilyAttempt(
      input: {
        enrollmentId: string;
        itemId: string;
        intent?: 'start_or_resume' | 'retry';
        expectedContentVersionId?: string;
        idempotencyKey?: string;
        usedAacSupport?: boolean;
        usedReadAloud?: boolean;
      },
      actor: FamilyStudentActorContext
    ) {
      const intent = input.intent ?? 'start_or_resume';
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(
          async () =>
            repo.withTransaction(async (tx) => {
              const joined = await repo.findActiveStudentEnrollmentById(
                actor.actorUserId,
                input.enrollmentId,
                tx
              );
              if (!joined) {
                throw ApiErrors.notFound(
                  'Không tìm thấy chương trình gia đình trong tài khoản của bạn.'
                );
              }

              const items = await repo.listProgramVersionItemsJoined(
                joined.version.id,
                tx
              );
              const item = items.find((i) => i.id === input.itemId);
              if (!item) {
                throw ApiErrors.notFound(
                  'Không tìm thấy hoạt động này trong phiên bản chương trình gia đình.'
                );
              }

              assertPinnedContentVersionMatches(
                input.expectedContentVersionId,
                item.contentVersionId
              );

              if (input.idempotencyKey) {
                const existingByKey =
                  await repo.findFamilyAttemptByIdempotencyKey(
                    joined.enrollment.id,
                    item.id,
                    input.idempotencyKey,
                    tx
                  );
                if (existingByKey) {
                  const [turns, refreshedEnroll] = await Promise.all([
                    repo.listTurnsForFamilyAttempt(
                      actor.actorUserId,
                      existingByKey.id,
                      tx
                    ),
                    repo.recomputeAndUpdateEnrollmentProgress(
                      {
                        enrollmentId: joined.enrollment.id,
                        studentUserId: actor.actorUserId,
                        totalActivities: items.length,
                        fallbackActivityAt: existingByKey.lastInteractedAt,
                        now,
                      },
                      tx
                    ),
                  ]);
                  return {
                    httpStatus: 200 as const,
                    action: 'idempotent_replay' as const,
                    attempt: buildFamilyAttemptView({
                      attempt: existingByKey,
                      item,
                      turns,
                      enrollment: refreshedEnroll,
                    }),
                  };
                }
              }

              const inProgress = await repo.findInProgressFamilyAttempt(
                joined.enrollment.id,
                item.id,
                tx
              );
              if (inProgress) {
                resolveStartOrResumeEligibility({
                  hasInProgress: true,
                  priorAttemptCount: 1,
                  intent,
                });

                const [turns, refreshedEnroll] = await Promise.all([
                  repo.listTurnsForFamilyAttempt(
                    actor.actorUserId,
                    inProgress.id,
                    tx
                  ),
                  repo.recomputeAndUpdateEnrollmentProgress(
                    {
                      enrollmentId: joined.enrollment.id,
                      studentUserId: actor.actorUserId,
                      totalActivities: items.length,
                      fallbackActivityAt: inProgress.lastInteractedAt,
                      now,
                    },
                    tx
                  ),
                ]);
                return {
                  httpStatus: 200 as const,
                  action: 'resumed' as const,
                  attempt: buildFamilyAttemptView({
                    attempt: inProgress,
                    item,
                    turns,
                    enrollment: refreshedEnroll,
                  }),
                };
              }

              const counts = await repo.countFamilyAttemptsForItem(
                joined.enrollment.id,
                item.id,
                tx
              );
              const startAction = resolveStartOrResumeEligibility({
                hasInProgress: false,
                priorAttemptCount: counts.total,
                intent,
              });

              const initialSupport = resolveInitialSupportCounts({
                usedAacSupport: input.usedAacSupport,
                usedReadAloud: input.usedReadAloud,
              });
              const attemptId = generateUuidV7();
              const attemptNumber =
                (counts.maxAttemptNumber ?? counts.total) + 1;

              const created = await repo.createFamilyAttempt(
                {
                  id: attemptId,
                  enrollmentId: joined.enrollment.id,
                  familyWorkspaceId: joined.enrollment.familyWorkspaceId,
                  studentUserId: actor.actorUserId,
                  familyProgramVersionId: joined.version.id,
                  familyProgramItemId: item.id,
                  contentVersionId: item.contentVersionId,
                  attemptNumber,
                  startIdempotencyKey: input.idempotencyKey ?? null,
                  status: 'in_progress',
                  startedAt: now,
                  lastInteractedAt: now,
                  completedAt: null,
                  durationSeconds: 0,
                  usedAacSupport: initialSupport.usedAacSupport,
                  usedReadAloud: initialSupport.usedReadAloud,
                  aacTapCount: initialSupport.aacTapCount,
                  readAloudCount: initialSupport.readAloudCount,
                  responseSummaryJson: null,
                },
                tx
              );

              const updatedEnroll =
                await repo.recomputeAndUpdateEnrollmentProgress(
                  {
                    enrollmentId: joined.enrollment.id,
                    studentUserId: actor.actorUserId,
                    totalActivities: items.length,
                    fallbackActivityAt: now,
                    now,
                  },
                  tx
                );

              await safeAudit(
                {
                  organizationId: null,
                  actorUserId: actor.actorUserId,
                  actorRole: 'student',
                  eventType: 'family.attempt_started',
                  targetType: 'family_activity_attempt',
                  targetId: attemptId,
                  ipPrefix: actor.ipPrefix,
                  metadata: {
                    enrollmentId: joined.enrollment.id,
                    familyProgramId: joined.program.id,
                    familyProgramVersionId: joined.version.id,
                    attemptNumber,
                  },
                  createdAt: now,
                },
                tx as unknown as AuditInsertExecutor
              );

              return {
                httpStatus: 201 as const,
                action:
                  startAction === 'retried'
                    ? ('retried' as const)
                    : ('started' as const),
                attempt: buildFamilyAttemptView({
                  attempt: created,
                  item,
                  turns: [],
                  enrollment: updatedEnroll,
                }),
              };
            }),
          {
            maxAttempts: 5,
            retryOnDuplicateOnce: true,
          }
        );
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDuplicateKeyDbError(err)) {
          throw ApiErrors.conflict(
            'ATTEMPT_CONCURRENT_CONFLICT',
            'error.attempt.concurrent_conflict',
            'Lượt thực hành đang được khởi tạo đồng thời, vui lòng tải lại trạng thái hiện tại.'
          );
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async getFamilyAttemptForStudent(
      attemptId: string,
      actor: FamilyStudentActorContext
    ): Promise<SafeFamilyStudentAttemptView> {
      const attempt = await repo.findFamilyAttemptByIdForStudent(
        actor.actorUserId,
        attemptId
      );
      if (!attempt) {
        throw ApiErrors.notFound('Không tìm thấy lượt thực hành gia đình.');
      }

      const joined = await repo.findActiveStudentEnrollmentById(
        actor.actorUserId,
        attempt.enrollmentId
      );
      if (!joined) {
        throw ApiErrors.notFound('Không tìm thấy chương trình gia đình.');
      }

      const [items, turns] = await Promise.all([
        repo.listProgramVersionItemsJoined(joined.version.id),
        repo.listTurnsForFamilyAttempt(actor.actorUserId, attempt.id),
      ]);
      const item = items.find((i) => i.id === attempt.familyProgramItemId);
      if (!item) {
        throw ApiErrors.notFound('Không tìm thấy hoạt động trong chương trình.');
      }

      return buildFamilyAttemptView({
        attempt,
        item,
        turns,
        enrollment: joined.enrollment,
      });
    },

    async saveFamilyTurn(
      input: {
        attemptId: string;
        turnIndex: number;
        stepKey: string;
        selectedChoiceKey?: string | null;
        selectedEmotionKey?: string | null;
        usedAac?: boolean;
        usedReadAloud?: boolean;
        aacTapDelta?: number;
        readAloudDelta?: number;
        durationSeconds?: number;
        responsePayloadJson?: Record<string, unknown> | null;
      },
      actor: FamilyStudentActorContext
    ) {
      const cleanStepKey = validateRequiredAttemptStepKey(
        input.stepKey,
        'body.stepKey'
      );
      const cleanChoiceKey = validateOptionalAttemptShortText(
        input.selectedChoiceKey,
        'body.selectedChoiceKey'
      );
      const cleanEmotionKey = validateOptionalAttemptShortText(
        input.selectedEmotionKey,
        'body.selectedEmotionKey'
      );
      const cleanPayload =
        validateSafeAttemptJsonObject(
          input.responsePayloadJson,
          'body.responsePayloadJson'
        ) ?? null;

      const usedAac = Boolean(input.usedAac);
      const usedReadAloud = Boolean(input.usedReadAloud);
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(
          async () =>
            repo.withTransaction(async (tx) => {
              const attempt = await repo.findFamilyAttemptByIdForStudent(
                actor.actorUserId,
                input.attemptId,
                tx
              );
              if (!attempt) {
                throw ApiErrors.notFound(
                  'Không tìm thấy lượt thực hành gia đình.'
                );
              }

              const joined = await repo.findActiveStudentEnrollmentById(
                actor.actorUserId,
                attempt.enrollmentId,
                tx
              );
              if (!joined) {
                throw ApiErrors.notFound(
                  'Không tìm thấy chương trình gia đình.'
                );
              }

              const items = await repo.listProgramVersionItemsJoined(
                joined.version.id,
                tx
              );
              const item = items.find(
                (i) => i.id === attempt.familyProgramItemId
              );
              if (!item) {
                throw ApiErrors.notFound(
                  'Không tìm thấy hoạt động trong chương trình.'
                );
              }

              assertAttemptCanSaveTurn(attempt.status);

              const existingTurn = await repo.findTurnForFamilyAttempt(
                actor.actorUserId,
                attempt.id,
                input.turnIndex,
                tx
              );
              if (existingTurn) {
                if (
                  areAttemptTurnPayloadsEquivalent(existingTurn, {
                    stepKey: cleanStepKey,
                    selectedChoiceKey: cleanChoiceKey,
                    selectedEmotionKey: cleanEmotionKey,
                    usedAac,
                    usedReadAloud,
                    responsePayloadJson: cleanPayload,
                  })
                ) {
                  const [turns, refreshedEnroll] = await Promise.all([
                    repo.listTurnsForFamilyAttempt(
                      actor.actorUserId,
                      attempt.id,
                      tx
                    ),
                    repo.recomputeAndUpdateEnrollmentProgress(
                      {
                        enrollmentId: joined.enrollment.id,
                        studentUserId: actor.actorUserId,
                        totalActivities: items.length,
                        fallbackActivityAt: attempt.lastInteractedAt,
                        now,
                      },
                      tx
                    ),
                  ]);
                  return {
                    httpStatus: 200 as const,
                    idempotentReplay: true,
                    savedTurn: toSafeTurnView(existingTurn),
                    attempt: buildFamilyAttemptView({
                      attempt,
                      item,
                      turns,
                      enrollment: refreshedEnroll,
                    }),
                  };
                }

                throw ApiErrors.conflict(
                  'TURN_INDEX_CONFLICT',
                  'error.attempt.turn_index_conflict',
                  'Bước tương tác tại chỉ số này đã được lưu trước đó và không thể bị ghi đè.'
                );
              }

              const turnId = generateUuidV7();
              const nextDuration = computeMonotonicAttemptDuration(
                attempt.durationSeconds,
                input.durationSeconds
              );
              const nextTelemetry = resolveSupportTelemetryUpdate({
                prevUsedAac: attempt.usedAacSupport,
                prevUsedReadAloud: attempt.usedReadAloud,
                prevAacTapCount: attempt.aacTapCount,
                prevReadAloudCount: attempt.readAloudCount,
                usedAacFlag: usedAac,
                usedReadAloudFlag: usedReadAloud,
                aacTapDelta: input.aacTapDelta,
                readAloudDelta: input.readAloudDelta,
              });

              const turnRecord: typeof familyActivityAttemptTurns.$inferInsert =
                {
                  id: turnId,
                  studentUserId: actor.actorUserId,
                  attemptId: attempt.id,
                  turnIndex: input.turnIndex,
                  stepKey: cleanStepKey,
                  selectedChoiceKey: cleanChoiceKey,
                  selectedEmotionKey: cleanEmotionKey,
                  usedAac,
                  usedReadAloud,
                  responsePayloadJson: cleanPayload,
                  respondedAt: now,
                };

              const updatedAttempt = await repo.insertFamilyTurnAndUpdateAttempt(
                {
                  turn: turnRecord,
                  attemptUpdate: {
                    studentUserId: actor.actorUserId,
                    attemptId: attempt.id,
                    lastInteractedAt: now,
                    durationSeconds: nextDuration,
                    usedAacSupport: nextTelemetry.usedAacSupport,
                    usedReadAloud: nextTelemetry.usedReadAloud,
                    aacTapCount: nextTelemetry.aacTapCount,
                    readAloudCount: nextTelemetry.readAloudCount,
                  },
                },
                tx
              );

              const [turns, updatedEnrollment] = await Promise.all([
                repo.listTurnsForFamilyAttempt(
                  actor.actorUserId,
                  attempt.id,
                  tx
                ),
                repo.recomputeAndUpdateEnrollmentProgress(
                  {
                    enrollmentId: joined.enrollment.id,
                    studentUserId: actor.actorUserId,
                    totalActivities: items.length,
                    fallbackActivityAt: now,
                    now,
                  },
                  tx
                ),
              ]);

              const savedTurn = turns.find(
                (t) => t.turnIndex === input.turnIndex
              )!;
              return {
                httpStatus: 201 as const,
                idempotentReplay: false,
                savedTurn: toSafeTurnView(savedTurn),
                attempt: buildFamilyAttemptView({
                  attempt: updatedAttempt,
                  item,
                  turns,
                  enrollment: updatedEnrollment,
                }),
              };
            }),
          {
            maxAttempts: 5,
            retryOnDuplicateOnce: true,
          }
        );
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDuplicateKeyDbError(err)) {
          throw ApiErrors.conflict(
            'TURN_INDEX_CONFLICT',
            'error.attempt.turn_index_conflict',
            'Bước tương tác tại chỉ số này đã tồn tại.'
          );
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async completeFamilyAttempt(
      input: {
        attemptId: string;
        durationSeconds?: number;
        usedAacSupport?: boolean;
        usedReadAloud?: boolean;
        aacTapDelta?: number;
        readAloudDelta?: number;
        responseSummaryJson?: Record<string, unknown> | null;
      },
      actor: FamilyStudentActorContext
    ): Promise<{
      idempotentReplay: boolean;
      attempt: SafeFamilyStudentAttemptView;
    }> {
      const cleanSummary = validateSafeAttemptJsonObject(
        input.responseSummaryJson,
        'body.responseSummaryJson'
      );
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(async () =>
          repo.withTransaction(async (tx) => {
            const attempt = await repo.findFamilyAttemptByIdForStudent(
              actor.actorUserId,
              input.attemptId,
              tx
            );
            if (!attempt) {
              throw ApiErrors.notFound(
                'Không tìm thấy lượt thực hành gia đình.'
              );
            }

            const joined = await repo.findActiveStudentEnrollmentById(
              actor.actorUserId,
              attempt.enrollmentId,
              tx
            );
            if (!joined) {
              throw ApiErrors.notFound(
                'Không tìm thấy chương trình gia đình.'
              );
            }

            const items = await repo.listProgramVersionItemsJoined(
              joined.version.id,
              tx
            );
            const item = items.find(
              (i) => i.id === attempt.familyProgramItemId
            );
            if (!item) {
              throw ApiErrors.notFound(
                'Không tìm thấy hoạt động trong chương trình.'
              );
            }

            const completeCheck = assertAttemptCanComplete(attempt.status);
            if (completeCheck === 'replay') {
              const [turns, refreshedEnroll] = await Promise.all([
                repo.listTurnsForFamilyAttempt(
                  actor.actorUserId,
                  attempt.id,
                  tx
                ),
                repo.recomputeAndUpdateEnrollmentProgress(
                  {
                    enrollmentId: joined.enrollment.id,
                    studentUserId: actor.actorUserId,
                    totalActivities: items.length,
                    fallbackActivityAt: attempt.lastInteractedAt,
                    now,
                  },
                  tx
                ),
              ]);
              return {
                idempotentReplay: true,
                attempt: buildFamilyAttemptView({
                  attempt,
                  item,
                  turns,
                  enrollment: refreshedEnroll,
                }),
              };
            }

            const nextDuration = computeMonotonicAttemptDuration(
              attempt.durationSeconds,
              input.durationSeconds
            );
            const nextTelemetry = resolveSupportTelemetryUpdate({
              prevUsedAac: attempt.usedAacSupport,
              prevUsedReadAloud: attempt.usedReadAloud,
              prevAacTapCount: attempt.aacTapCount,
              prevReadAloudCount: attempt.readAloudCount,
              usedAacFlag: input.usedAacSupport,
              usedReadAloudFlag: input.usedReadAloud,
              aacTapDelta: input.aacTapDelta,
              readAloudDelta: input.readAloudDelta,
            });

            const updatedAttempt = await repo.updateFamilyAttemptTerminalState(
              {
                studentUserId: actor.actorUserId,
                attemptId: attempt.id,
                status: 'completed',
                completedAt: now,
                lastInteractedAt: now,
                durationSeconds: nextDuration,
                usedAacSupport: nextTelemetry.usedAacSupport,
                usedReadAloud: nextTelemetry.usedReadAloud,
                aacTapCount: nextTelemetry.aacTapCount,
                readAloudCount: nextTelemetry.readAloudCount,
                responseSummaryJson:
                  cleanSummary !== undefined
                    ? cleanSummary
                    : attempt.responseSummaryJson,
              },
              tx
            );

            const [turns, updatedEnrollment] = await Promise.all([
              repo.listTurnsForFamilyAttempt(
                actor.actorUserId,
                attempt.id,
                tx
              ),
              repo.recomputeAndUpdateEnrollmentProgress(
                {
                  enrollmentId: joined.enrollment.id,
                  studentUserId: actor.actorUserId,
                  totalActivities: items.length,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              ),
            ]);

            await safeAudit(
              {
                organizationId: null,
                actorUserId: actor.actorUserId,
                actorRole: 'student',
                eventType: 'family.attempt_completed',
                targetType: 'family_activity_attempt',
                targetId: attempt.id,
                ipPrefix: actor.ipPrefix,
                metadata: {
                  enrollmentId: joined.enrollment.id,
                  completedActivities: updatedEnrollment.completedActivities,
                  totalActivities: updatedEnrollment.totalActivities,
                  learningStatus: updatedEnrollment.learningStatus,
                },
                createdAt: now,
              },
              tx as unknown as AuditInsertExecutor
            );

            return {
              idempotentReplay: false,
              attempt: buildFamilyAttemptView({
                attempt: updatedAttempt,
                item,
                turns,
                enrollment: updatedEnrollment,
              }),
            };
          })
        );
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async abandonFamilyAttempt(
      input: {
        attemptId: string;
        confirmed?: boolean;
        durationSeconds?: number;
      },
      actor: FamilyStudentActorContext
    ): Promise<{
      idempotentReplay: boolean;
      attempt: SafeFamilyStudentAttemptView;
    }> {
      if (input.confirmed !== true) {
        throw new AppError({
          httpStatus: 400,
          code: 'ABANDON_CONFIRMATION_REQUIRED',
          messageKey: 'error.attempt.abandon_confirmation_required',
          message:
            'Cần xác nhận chủ đích (confirmed=true) khi tạm dừng lượt thực hành.',
        });
      }

      const now = nowFn();

      try {
        return await runWithTransientLockRetry(async () =>
          repo.withTransaction(async (tx) => {
            const attempt = await repo.findFamilyAttemptByIdForStudent(
              actor.actorUserId,
              input.attemptId,
              tx
            );
            if (!attempt) {
              throw ApiErrors.notFound(
                'Không tìm thấy lượt thực hành gia đình.'
              );
            }

            const joined = await repo.findActiveStudentEnrollmentById(
              actor.actorUserId,
              attempt.enrollmentId,
              tx
            );
            if (!joined) {
              throw ApiErrors.notFound(
                'Không tìm thấy chương trình gia đình.'
              );
            }

            const items = await repo.listProgramVersionItemsJoined(
              joined.version.id,
              tx
            );
            const item = items.find(
              (i) => i.id === attempt.familyProgramItemId
            );
            if (!item) {
              throw ApiErrors.notFound(
                'Không tìm thấy hoạt động trong chương trình.'
              );
            }

            const abandonCheck = assertAttemptCanAbandon(attempt.status);
            if (abandonCheck === 'replay') {
              const [turns, refreshedEnroll] = await Promise.all([
                repo.listTurnsForFamilyAttempt(
                  actor.actorUserId,
                  attempt.id,
                  tx
                ),
                repo.recomputeAndUpdateEnrollmentProgress(
                  {
                    enrollmentId: joined.enrollment.id,
                    studentUserId: actor.actorUserId,
                    totalActivities: items.length,
                    fallbackActivityAt: attempt.lastInteractedAt,
                    now,
                  },
                  tx
                ),
              ]);
              return {
                idempotentReplay: true,
                attempt: buildFamilyAttemptView({
                  attempt,
                  item,
                  turns,
                  enrollment: refreshedEnroll,
                }),
              };
            }

            const nextDuration = computeMonotonicAttemptDuration(
              attempt.durationSeconds,
              input.durationSeconds
            );

            const updatedAttempt = await repo.updateFamilyAttemptTerminalState(
              {
                studentUserId: actor.actorUserId,
                attemptId: attempt.id,
                status: 'abandoned',
                completedAt: null,
                lastInteractedAt: now,
                durationSeconds: nextDuration,
                usedAacSupport: Boolean(attempt.usedAacSupport),
                usedReadAloud: Boolean(attempt.usedReadAloud),
                aacTapCount: attempt.aacTapCount,
                readAloudCount: attempt.readAloudCount,
              },
              tx
            );

            const [turns, updatedEnrollment] = await Promise.all([
              repo.listTurnsForFamilyAttempt(
                actor.actorUserId,
                attempt.id,
                tx
              ),
              repo.recomputeAndUpdateEnrollmentProgress(
                {
                  enrollmentId: joined.enrollment.id,
                  studentUserId: actor.actorUserId,
                  totalActivities: items.length,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              ),
            ]);

            await safeAudit(
              {
                organizationId: null,
                actorUserId: actor.actorUserId,
                actorRole: 'student',
                eventType: 'family.attempt_abandoned',
                targetType: 'family_activity_attempt',
                targetId: attempt.id,
                ipPrefix: actor.ipPrefix,
                metadata: {
                  enrollmentId: joined.enrollment.id,
                },
                createdAt: now,
              },
              tx as unknown as AuditInsertExecutor
            );

            return {
              idempotentReplay: false,
              attempt: buildFamilyAttemptView({
                attempt: updatedAttempt,
                item,
                turns,
                enrollment: updatedEnrollment,
              }),
            };
          })
        );
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    // =========================================================================
    // CANONICAL STUDENT FAMILY PREFERENCES (NO SCHOOL ORG REQUIRED)
    // =========================================================================

    async getStudentFamilyPreferences(
      studentUserId: string
    ): Promise<SafeStudentFamilyPreferencesView> {
      const rec = await repo.findStudentFamilyPreferences(studentUserId);
      return toSafePreferencesView(studentUserId, rec);
    },

    async updateStudentFamilyPreferences(
      input: {
        preferredName?: string | null;
        supportPreferencesJson?: Record<string, unknown> | null;
        hasPreferredName?: boolean;
        hasSupportPreferencesJson?: boolean;
      },
      actor: FamilyStudentActorContext
    ): Promise<SafeStudentFamilyPreferencesView> {
      const existing = await repo.findStudentFamilyPreferences(
        actor.actorUserId
      );

      let nextPreferredName = existing?.preferredName ?? null;
      if (input.hasPreferredName) {
        assertSafeText(input.preferredName, 'body.preferredName');
        nextPreferredName = input.preferredName?.trim() || null;
      }

      let nextPrefs = existing?.supportPreferencesJson ?? null;
      if (input.hasSupportPreferencesJson) {
        nextPrefs = validateSupportPreferencesJson(
          input.supportPreferencesJson
        );
      }

      const now = nowFn();
      const saved = await repo.withTransaction(async (tx) => {
        const res = await repo.upsertStudentFamilyPreferences(
          {
            id: existing?.id ?? generateUuidV7(),
            studentUserId: actor.actorUserId,
            preferredName: nextPreferredName,
            supportPreferencesJson: nextPrefs,
            now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'student',
            eventType: 'student.family_preferences_updated',
            targetType: 'student_family_preferences',
            targetId: res.id,
            ipPrefix: actor.ipPrefix,
            metadata: {
              hasPreferredName: Boolean(res.preferredName),
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return res;
      });

      return toSafePreferencesView(actor.actorUserId, saved);
    },
  };
}

export type FamilyLearningService = ReturnType<typeof createFamilyLearningService>;
