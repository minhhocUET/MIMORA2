import { generateUuidV7 } from '../db/uuid.ts';
import {
  ApiErrors,
  type ApiErrorDetail,
  AppError,
  extractDatabaseErrorMeta,
  isDatabaseError,
  translateDatabaseError,
} from '../http/errors.ts';
import {
  ATTEMPT_STATUSES,
  type ActivityAttemptRecord,
  type ActivityAttemptTurnRecord,
  type AssignmentProgressRecord,
  type AttemptRepository,
  type AttemptStatus,
  createAttemptRepository,
  type StudentAttemptContext,
  type TeacherAttemptSummaryRow,
} from '../repositories/attempt.repository.ts';
import {
  isCanonicalContentType,
  scanUnsafeSelText,
} from '../validators/content-payload.schema.ts';
import type { CanonicalContentType } from '../db/schema/_shared.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
} from './audit.service.ts';

export interface StudentAttemptActorContext {
  actorUserId: string;
  organizationId: string;
  studentMembershipId: string;
  ipPrefix: string | null;
}

export interface TeacherAttemptActorContext {
  actorUserId: string;
  organizationId: string;
  teacherMembershipId: string;
  ipPrefix: string | null;
}

export interface SafeTurnView {
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

export interface SafeSupportContextView {
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  aacTapCount: number;
  readAloudCount: number;
  isOptionalContextOnly: true;
}

export interface SafeProgressSnapshotView {
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  activeAttemptId: string | null;
  latestCompletedAttemptId: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export interface SafeStudentAttemptView {
  attemptId: string;
  organizationId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentStatus: 'active' | 'closed';
  isReadOnly: boolean;
  assignmentTargetId: string;
  assignmentItemId: string;
  itemSortOrder: number;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
    summary: string | null;
    locale: string;
  };
  attemptNumber: number;
  state: AttemptStatus;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  supportContext: SafeSupportContextView;
  turns: SafeTurnView[];
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
  progress: SafeProgressSnapshotView;
}

export interface SafeTeacherAttemptSummaryView {
  attemptId: string;
  assignmentId: string;
  assignmentTargetId: string;
  assignmentItemId: string;
  itemSortOrder: number;
  studentMembershipId: string;
  studentDisplayName: string;
  studentOrgUsername: string | null;
  pinnedContentVersion: {
    contentItemId: string;
    contentVersionId: string;
    contentType: CanonicalContentType;
    versionNumber: number;
    title: string;
  };
  attemptNumber: number;
  state: AttemptStatus;
  startedAt: string;
  lastInteractedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  turnCount: number;
  supportContext: SafeSupportContextView & {
    contextNote: string;
  };
}

export interface SafeTeacherAttemptDetailView extends SafeTeacherAttemptSummaryView {
  turns: SafeTurnView[];
}

const SUPPORT_CONTEXT_TEACHER_NOTE =
  'Thông tin AAC và đọc to chỉ là ngữ cảnh hỗ trợ tiếp cận tùy chọn của học sinh, không phải chỉ số đánh giá năng lực hay chẩn đoán.';

const FORBIDDEN_ATTEMPT_PAYLOAD_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'pin',
  'passcode',
  'secret',
  'pepper',
  'token',
  'rawtoken',
  'sessiontoken',
  'tokenhash',
  'refreshtoken',
  'csrftoken',
  'cookie',
  'cookies',
  'setcookie',
  'authorization',
  'email',
  'phone',
  'phonenumber',
  'mobile',
  'homeaddress',
  'ssn',
  'timer',
  'timerseconds',
  'countdown',
  'countdownseconds',
  'timelimit',
  'timelimitseconds',
  'maxseconds',
  'leaderboard',
  'leaderboards',
  'ranking',
  'rankings',
  'rank',
  'score',
  'scores',
  'points',
  'maxscore',
  'passingscore',
  'streak',
  'streaks',
  'streakpenalty',
  'punishment',
  'penalty',
  'penalties',
  'shame',
  'shamingfeedback',
  'wronganswerfeedback',
  'iscorrect',
  'correctanswer',
  'correctoption',
  'correctchoice',
  'correctemotion',
  'correctexpression',
  'correctfacialexpression',
  'mandatoryexpression',
  'diagnosis',
  'clinicaldiagnosis',
  'disorder',
  'personalitylabel',
  'personalitytype',
  'psychologicalprofile',
  'profiling',
  'assessmentscore',
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function validateSafeJsonObject(
  value: Record<string, unknown> | null | undefined,
  fieldPrefix: string
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const details: ApiErrorDetail[] = [];
  let keyCounter = 0;
  const maxKeys = 40;
  const maxDepth = 5;

  const visit = (node: unknown, path: string, depth: number): void => {
    if (details.length >= 10) {
      return;
    }
    if (depth > maxDepth) {
      details.push({
        field: path,
        code: 'JSON_DEPTH_EXCEEDED',
        messageKey: 'error.attempt.payload_too_deep',
        message: 'Dữ liệu phản hồi lồng nhau quá sâu.',
      });
      return;
    }

    if (node === null || node === undefined) {
      return;
    }

    if (typeof node === 'string') {
      details.push(...scanUnsafeSelText(node, path));
      return;
    }

    if (typeof node === 'number' || typeof node === 'boolean') {
      return;
    }

    if (Array.isArray(node)) {
      if (node.length > 25) {
        details.push({
          field: path,
          code: 'JSON_ARRAY_TOO_LARGE',
          messageKey: 'error.attempt.payload_array_too_large',
          message: 'Danh sách phản hồi vượt quá kích thước cho phép.',
        });
        return;
      }
      for (let i = 0; i < node.length; i += 1) {
        visit(node[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (typeof node === 'object') {
      const record = node as Record<string, unknown>;
      for (const [key, nested] of Object.entries(record)) {
        keyCounter += 1;
        if (keyCounter > maxKeys) {
          details.push({
            field: path,
            code: 'JSON_TOO_MANY_KEYS',
            messageKey: 'error.attempt.payload_too_many_keys',
            message: 'Dữ liệu phản hồi chứa quá nhiều trường.',
          });
          return;
        }
        const childPath = `${path}.${key}`;
        if (FORBIDDEN_ATTEMPT_PAYLOAD_KEYS.has(normalizeKey(key))) {
          details.push({
            field: childPath,
            code: 'FORBIDDEN_ATTEMPT_PAYLOAD_KEY',
            messageKey: 'error.attempt.forbidden_payload_key',
            message:
              'Dữ liệu phản hồi chứa trường nhạy cảm hoặc không phù hợp với nguyên tắc SEL.',
          });
        }
        visit(nested, childPath, depth + 1);
      }
    }
  };

  visit(value, fieldPrefix, 0);

  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }

  return value;
}

function validateSafeShortText(
  value: string | null | undefined,
  field: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  const details = scanUnsafeSelText(trimmed, field);
  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }
  return trimmed;
}

function stableCanonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(stableCanonicalize);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      normalized[k] = stableCanonicalize(v);
    }
    return normalized;
  }
  return value;
}

function areTurnPayloadsIdentical(
  existing: ActivityAttemptTurnRecord,
  incoming: {
    stepKey: string;
    selectedChoiceKey: string | null;
    selectedEmotionKey: string | null;
    usedAac: boolean;
    usedReadAloud: boolean;
    responsePayloadJson: Record<string, unknown> | null;
  }
): boolean {
  if (existing.stepKey !== incoming.stepKey) {
    return false;
  }
  if ((existing.selectedChoiceKey ?? null) !== incoming.selectedChoiceKey) {
    return false;
  }
  if ((existing.selectedEmotionKey ?? null) !== incoming.selectedEmotionKey) {
    return false;
  }
  if (Boolean(existing.usedAac) !== incoming.usedAac) {
    return false;
  }
  if (Boolean(existing.usedReadAloud) !== incoming.usedReadAloud) {
    return false;
  }

  const existingJson = JSON.stringify(
    stableCanonicalize(existing.responsePayloadJson ?? null)
  );
  const incomingJson = JSON.stringify(
    stableCanonicalize(incoming.responsePayloadJson ?? null)
  );
  return existingJson === incomingJson;
}

function normalizeAttemptStatus(status: string): AttemptStatus {
  if ((ATTEMPT_STATUSES as readonly string[]).includes(status)) {
    return status as AttemptStatus;
  }
  return 'in_progress';
}

function toSafeTurnView(row: ActivityAttemptTurnRecord): SafeTurnView {
  return {
    id: row.id,
    turnIndex: row.turnIndex,
    stepKey: row.stepKey,
    selectedChoiceKey: row.selectedChoiceKey ?? null,
    selectedEmotionKey: row.selectedEmotionKey ?? null,
    usedAac: Boolean(row.usedAac),
    usedReadAloud: Boolean(row.usedReadAloud),
    responsePayloadJson: row.responsePayloadJson ?? null,
    respondedAt: row.respondedAt.toISOString(),
  };
}

function toSafeProgressSnapshotView(
  progress: AssignmentProgressRecord | null,
  totalItemsFallback: number
): SafeProgressSnapshotView {
  if (!progress) {
    return {
      status: 'not_started',
      totalItems: totalItemsFallback,
      completedItems: 0,
      attemptCount: 0,
      activeAttemptId: null,
      latestCompletedAttemptId: null,
      lastActivityAt: null,
      completedAt: null,
    };
  }

  return {
    status: progress.status,
    totalItems: progress.totalItems,
    completedItems: progress.completedItems,
    attemptCount: progress.attemptCount,
    activeAttemptId: progress.activeAttemptId ?? null,
    latestCompletedAttemptId: progress.latestCompletedAttemptId ?? null,
    lastActivityAt: progress.lastActivityAt
      ? progress.lastActivityAt.toISOString()
      : null,
    completedAt: progress.completedAt
      ? progress.completedAt.toISOString()
      : null,
  };
}

function buildStudentAttemptView(params: {
  context: StudentAttemptContext;
  turns: ActivityAttemptTurnRecord[];
  progress: AssignmentProgressRecord | null;
}): SafeStudentAttemptView {
  const { context, turns, progress } = params;
  const attempt = context.attempt;
  const safeAssignmentStatus: 'active' | 'closed' =
    context.assignment.status === 'closed' ? 'closed' : 'active';
  const isReadOnly = safeAssignmentStatus === 'closed';
  const state = normalizeAttemptStatus(attempt.status);
  const safeTurns = turns.map(toSafeTurnView);
  const lastTurn =
    safeTurns.length > 0 ? safeTurns[safeTurns.length - 1] : null;

  const contentType: CanonicalContentType = isCanonicalContentType(
    context.contentVersion.contentType
  )
    ? context.contentVersion.contentType
    : 'emotion_card';

  const canActOnInProgress = !isReadOnly && state === 'in_progress';

  return {
    attemptId: attempt.id,
    organizationId: attempt.organizationId,
    assignmentId: attempt.assignmentId,
    assignmentTitle: context.assignment.title,
    assignmentStatus: safeAssignmentStatus,
    isReadOnly,
    assignmentTargetId: attempt.assignmentTargetId,
    assignmentItemId: attempt.assignmentItemId,
    itemSortOrder: context.item.sortOrder,
    pinnedContentVersion: {
      contentItemId: context.contentVersion.contentItemId,
      contentVersionId: context.contentVersion.id,
      contentType,
      versionNumber: context.contentVersion.versionNumber,
      title: context.contentVersion.title,
      summary: context.contentVersion.summary,
      locale: context.contentVersion.locale,
    },
    attemptNumber: attempt.attemptNumber,
    state,
    startedAt: attempt.startedAt.toISOString(),
    lastInteractedAt: attempt.lastInteractedAt.toISOString(),
    completedAt: attempt.completedAt
      ? attempt.completedAt.toISOString()
      : null,
    elapsedSeconds: attempt.durationSeconds,
    supportContext: {
      usedAacSupport: Boolean(attempt.usedAacSupport),
      usedReadAloud: Boolean(attempt.usedReadAloud),
      aacTapCount: attempt.aacTapCount,
      readAloudCount: attempt.readAloudCount,
      isOptionalContextOnly: true,
    },
    turns: safeTurns,
    resumePosition: {
      savedTurnCount: safeTurns.length,
      nextTurnIndex: lastTurn ? lastTurn.turnIndex + 1 : 0,
      lastTurnIndex: lastTurn ? lastTurn.turnIndex : null,
      lastStepKey: lastTurn ? lastTurn.stepKey : null,
    },
    availableActions: {
      canResume: canActOnInProgress,
      canSubmitTurn: canActOnInProgress,
      canComplete: canActOnInProgress,
      canAbandon: canActOnInProgress,
      canRetry: !isReadOnly && state !== 'in_progress',
    },
    progress: toSafeProgressSnapshotView(
      progress,
      context.totalItemsInAssignment
    ),
  };
}

function toSafeTeacherAttemptSummaryView(
  row: TeacherAttemptSummaryRow
): SafeTeacherAttemptSummaryView {
  const contentType: CanonicalContentType = isCanonicalContentType(row.contentType)
    ? row.contentType
    : 'emotion_card';
  const a = row.attempt;
  return {
    attemptId: a.id,
    assignmentId: a.assignmentId,
    assignmentTargetId: a.assignmentTargetId,
    assignmentItemId: a.assignmentItemId,
    itemSortOrder: row.assignmentItemSortOrder,
    studentMembershipId: a.studentMembershipId,
    studentDisplayName: row.studentDisplayName,
    studentOrgUsername: row.studentOrgUsername,
    pinnedContentVersion: {
      contentItemId: row.contentItemId,
      contentVersionId: a.contentVersionId,
      contentType,
      versionNumber: row.contentVersionNumber,
      title: row.contentTitle,
    },
    attemptNumber: a.attemptNumber,
    state: normalizeAttemptStatus(a.status),
    startedAt: a.startedAt.toISOString(),
    lastInteractedAt: a.lastInteractedAt.toISOString(),
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    elapsedSeconds: a.durationSeconds,
    turnCount: row.turnCount,
    supportContext: {
      usedAacSupport: Boolean(a.usedAacSupport),
      usedReadAloud: Boolean(a.usedReadAloud),
      aacTapCount: a.aacTapCount,
      readAloudCount: a.readAloudCount,
      isOptionalContextOnly: true,
      contextNote: SUPPORT_CONTEXT_TEACHER_NOTE,
    },
  };
}

function isRetryableTransientDbConflict(err: unknown): boolean {
  if (!isDatabaseError(err)) {
    return false;
  }
  const meta = extractDatabaseErrorMeta(err);
  if (!meta) {
    return false;
  }
  return (
    meta.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    meta.code === 'ER_LOCK_DEADLOCK' ||
    meta.errno === 1205 ||
    meta.errno === 1213 ||
    meta.errno === 9007 ||
    meta.errno === 8028
  );
}

function isDuplicateKeyDbError(err: unknown): boolean {
  if (!isDatabaseError(err)) {
    return false;
  }
  const meta = extractDatabaseErrorMeta(err);
  return meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062;
}

async function runWithTransientLockRetry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number; retryOnDuplicateOnce?: boolean }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let dupRetried = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      if (
        options?.retryOnDuplicateOnce &&
        !dupRetried &&
        isDuplicateKeyDbError(err)
      ) {
        dupRetried = true;
        await new Promise((resolve) => setTimeout(resolve, 15));
        continue;
      }
      if (attempt < maxAttempts && isRetryableTransientDbConflict(err)) {
        const jitterMs = 15 + Math.floor(Math.random() * 35);
        await new Promise((resolve) => setTimeout(resolve, jitterMs));
        continue;
      }
      throw err;
    }
  }

  throw ApiErrors.internal();
}

export interface AttemptServiceDeps {
  repo?: AttemptRepository;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createAttemptService(deps?: AttemptServiceDeps) {
  const repo = deps?.repo ?? createAttemptRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0]
  ): Promise<void> {
    await emitAudit(input);
  }

  return {
    async startOrResumeAttempt(
      input: {
        targetId: string;
        itemId: string;
        intent?: 'start_or_resume' | 'retry';
        expectedContentVersionId?: string;
        idempotencyKey?: string;
        usedAacSupport?: boolean;
        usedReadAloud?: boolean;
      },
      actor: StudentAttemptActorContext
    ): Promise<{
      httpStatus: 200 | 201;
      action: 'started' | 'resumed' | 'retried' | 'idempotent_replay';
      attempt: SafeStudentAttemptView;
    }> {
      const intent = input.intent ?? 'start_or_resume';
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(
          async () =>
            repo.withTransaction(async (tx) => {
              const lockedCtx = await repo.findAndLockTargetAndItemForStudent(
                {
                  organizationId: actor.organizationId,
                  studentMembershipId: actor.studentMembershipId,
                  targetId: input.targetId,
                  itemId: input.itemId,
                },
                tx
              );

              if (!lockedCtx) {
                throw ApiErrors.notFound(
                  'Không tìm thấy bài tập hoặc hoạt động được giao cho tài khoản của bạn.'
                );
              }

              if (
                lockedCtx.assignment.status === 'draft' ||
                lockedCtx.assignment.status === 'archived'
              ) {
                throw ApiErrors.notFound(
                  'Không tìm thấy bài tập được giao cho tài khoản của bạn.'
                );
              }

              if (
                input.expectedContentVersionId &&
                input.expectedContentVersionId !==
                  lockedCtx.item.contentVersionId
              ) {
                throw ApiErrors.conflict(
                  'PINNED_CONTENT_VERSION_MISMATCH',
                  'error.attempt.pinned_version_mismatch',
                  'Phiên bản nội dung được yêu cầu không khớp với phiên bản đã gắn cố định trong bài tập.'
                );
              }

              if (lockedCtx.assignment.status === 'closed') {
                throw ApiErrors.conflict(
                  'ASSIGNMENT_CLOSED',
                  'error.assignment.closed',
                  'Bài tập đã đóng và chỉ ở chế độ xem lại; không thể bắt đầu hoặc tiếp tục ghi mới. Tiến trình đã lưu trước đó vẫn được giữ nguyên.'
                );
              }

              // 1. Check start idempotency key replay first within locked target
              if (input.idempotencyKey) {
                const byIdempotency =
                  await repo.findAttemptByStartIdempotencyKey(
                    {
                      organizationId: actor.organizationId,
                      studentMembershipId: actor.studentMembershipId,
                      assignmentTargetId: lockedCtx.target.id,
                      assignmentItemId: lockedCtx.item.id,
                      startIdempotencyKey: input.idempotencyKey,
                    },
                    tx
                  );
                if (byIdempotency) {
                  const [turns, progress] = await Promise.all([
                    repo.listTurnsForAttempt(
                      {
                        organizationId: actor.organizationId,
                        attemptId: byIdempotency.id,
                      },
                      tx
                    ),
                    repo.recomputeAndUpsertAssignmentProgress(
                      {
                        organizationId: actor.organizationId,
                        assignmentTargetId: lockedCtx.target.id,
                        studentMembershipId: actor.studentMembershipId,
                        totalItems: lockedCtx.totalItemsInAssignment,
                        fallbackActivityAt: byIdempotency.lastInteractedAt,
                        now,
                      },
                      tx
                    ),
                  ]);

                  return {
                    httpStatus: 200 as const,
                    action: 'idempotent_replay' as const,
                    attempt: buildStudentAttemptView({
                      context: {
                        attempt: byIdempotency,
                        assignment: lockedCtx.assignment,
                        item: lockedCtx.item,
                        contentVersion: lockedCtx.contentVersion,
                        totalItemsInAssignment: lockedCtx.totalItemsInAssignment,
                      },
                      turns,
                      progress,
                    }),
                  };
                }
              }

              // 2. Check existing in-progress attempt
              const existingInProgress =
                await repo.findInProgressAttemptForItem(
                  {
                    organizationId: actor.organizationId,
                    studentMembershipId: actor.studentMembershipId,
                    assignmentTargetId: lockedCtx.target.id,
                    assignmentItemId: lockedCtx.item.id,
                  },
                  tx
                );

              if (existingInProgress) {
                if (intent === 'retry') {
                  throw ApiErrors.conflict(
                    'ATTEMPT_ALREADY_IN_PROGRESS',
                    'error.attempt.already_in_progress',
                    'Đang có một lượt thực hành chưa hoàn thành cho hoạt động này. Vui lòng tiếp tục hoặc chủ động kết thúc trước khi bắt đầu lượt mới.'
                  );
                }

                const [turns, progress] = await Promise.all([
                  repo.listTurnsForAttempt(
                    {
                      organizationId: actor.organizationId,
                      attemptId: existingInProgress.id,
                    },
                    tx
                  ),
                  repo.recomputeAndUpsertAssignmentProgress(
                    {
                      organizationId: actor.organizationId,
                      assignmentTargetId: lockedCtx.target.id,
                      studentMembershipId: actor.studentMembershipId,
                      totalItems: lockedCtx.totalItemsInAssignment,
                      fallbackActivityAt: existingInProgress.lastInteractedAt,
                      now,
                    },
                    tx
                  ),
                ]);

                return {
                  httpStatus: 200 as const,
                  action: 'resumed' as const,
                  attempt: buildStudentAttemptView({
                    context: {
                      attempt: existingInProgress,
                      assignment: lockedCtx.assignment,
                      item: lockedCtx.item,
                      contentVersion: lockedCtx.contentVersion,
                      totalItemsInAssignment: lockedCtx.totalItemsInAssignment,
                    },
                    turns,
                    progress,
                  }),
                };
              }

              // 3. No in_progress attempt exists; check prior history
              const stats = await repo.findAttemptAggregateStatsForItem(
                {
                  organizationId: actor.organizationId,
                  studentMembershipId: actor.studentMembershipId,
                  assignmentTargetId: lockedCtx.target.id,
                  assignmentItemId: lockedCtx.item.id,
                },
                tx
              );

              if (stats.totalCount > 0 && intent !== 'retry') {
                throw ApiErrors.conflict(
                  'RETRY_INTENT_REQUIRED',
                  'error.attempt.retry_intent_required',
                  'Hoạt động này đã có lượt thực hành trước đó. Vui lòng chọn Làm lại (retry) để bắt đầu lượt mới.'
                );
              }

              const nextAttemptNumber = stats.maxAttemptNumber + 1;
              const newAttempt = await repo.insertActivityAttempt(
                {
                  id: generateUuidV7(),
                  organizationId: actor.organizationId,
                  assignmentId: lockedCtx.assignment.id,
                  assignmentTargetId: lockedCtx.target.id,
                  assignmentItemId: lockedCtx.item.id,
                  studentMembershipId: actor.studentMembershipId,
                  contentVersionId: lockedCtx.item.contentVersionId,
                  attemptNumber: nextAttemptNumber,
                  startIdempotencyKey: input.idempotencyKey ?? null,
                  status: 'in_progress',
                  startedAt: now,
                  lastInteractedAt: now,
                  completedAt: null,
                  durationSeconds: 0,
                  usedAacSupport: Boolean(input.usedAacSupport),
                  usedReadAloud: Boolean(input.usedReadAloud),
                  aacTapCount: input.usedAacSupport ? 1 : 0,
                  readAloudCount: input.usedReadAloud ? 1 : 0,
                  responseSummaryJson: null,
                },
                tx
              );

              const progress = await repo.recomputeAndUpsertAssignmentProgress(
                {
                  organizationId: actor.organizationId,
                  assignmentTargetId: lockedCtx.target.id,
                  studentMembershipId: actor.studentMembershipId,
                  totalItems: lockedCtx.totalItemsInAssignment,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              );

              return {
                httpStatus: 201 as const,
                action: intent === 'retry' ? ('retried' as const) : ('started' as const),
                attempt: buildStudentAttemptView({
                  context: {
                    attempt: newAttempt,
                    assignment: lockedCtx.assignment,
                    item: lockedCtx.item,
                    contentVersion: lockedCtx.contentVersion,
                    totalItemsInAssignment: lockedCtx.totalItemsInAssignment,
                  },
                  turns: [],
                  progress,
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

    async getStudentAttempt(
      attemptId: string,
      actor: StudentAttemptActorContext
    ): Promise<SafeStudentAttemptView> {
      const ctx = await repo.loadStudentAttemptReadOnly({
        organizationId: actor.organizationId,
        studentMembershipId: actor.studentMembershipId,
        attemptId,
      });

      if (
        !ctx ||
        ctx.assignment.status === 'draft' ||
        ctx.assignment.status === 'archived'
      ) {
        throw ApiErrors.notFound(
          'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
        );
      }

      const [turns, progress] = await Promise.all([
        repo.listTurnsForAttempt({
          organizationId: actor.organizationId,
          attemptId: ctx.attempt.id,
        }),
        repo.findAssignmentProgressByTarget({
          organizationId: actor.organizationId,
          assignmentTargetId: ctx.attempt.assignmentTargetId,
          studentMembershipId: actor.studentMembershipId,
        }),
      ]);

      return buildStudentAttemptView({
        context: ctx,
        turns,
        progress,
      });
    },

    async saveTurn(
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
      actor: StudentAttemptActorContext
    ): Promise<{
      httpStatus: 200 | 201;
      idempotentReplay: boolean;
      savedTurn: SafeTurnView;
      attempt: SafeStudentAttemptView;
    }> {
      const cleanStepKey = validateSafeShortText(
        input.stepKey,
        'body.stepKey'
      )!;
      if (cleanStepKey.length === 0) {
        throw ApiErrors.validation([
          {
            field: 'body.stepKey',
            code: 'REQUIRED',
            messageKey: 'error.validation.required',
            message: 'Mã bước hoạt động (stepKey) không được để trống.',
          },
        ]);
      }

      const cleanChoiceKey =
        validateSafeShortText(
          input.selectedChoiceKey,
          'body.selectedChoiceKey'
        ) ?? null;
      const cleanEmotionKey =
        validateSafeShortText(
          input.selectedEmotionKey,
          'body.selectedEmotionKey'
        ) ?? null;
      const cleanPayload =
        validateSafeJsonObject(
          input.responsePayloadJson,
          'body.responsePayloadJson'
        ) ?? null;

      const normalizedChoice =
        cleanChoiceKey && cleanChoiceKey.length > 0 ? cleanChoiceKey : null;
      const normalizedEmotion =
        cleanEmotionKey && cleanEmotionKey.length > 0 ? cleanEmotionKey : null;
      const usedAac = Boolean(input.usedAac);
      const usedReadAloud = Boolean(input.usedReadAloud);
      const aacTapDelta = input.aacTapDelta ?? (usedAac ? 1 : 0);
      const readAloudDelta = input.readAloudDelta ?? (usedReadAloud ? 1 : 0);
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(async () => {
          const ref = await repo.findAttemptRefForStudent({
            organizationId: actor.organizationId,
            studentMembershipId: actor.studentMembershipId,
            attemptId: input.attemptId,
          });
          if (!ref) {
            throw ApiErrors.notFound(
              'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
            );
          }

          return repo.withTransaction(async (tx) => {
            const locked = await repo.lockTargetAndLoadStudentAttempt(
              {
                organizationId: actor.organizationId,
                studentMembershipId: actor.studentMembershipId,
                targetId: ref.assignmentTargetId,
                attemptId: input.attemptId,
              },
              tx
            );

            if (
              !locked ||
              locked.assignment.status === 'draft' ||
              locked.assignment.status === 'archived'
            ) {
              throw ApiErrors.notFound(
                'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
              );
            }

            if (locked.assignment.status === 'closed') {
              throw ApiErrors.conflict(
                'ASSIGNMENT_CLOSED',
                'error.assignment.closed',
                'Bài tập đã đóng và chỉ ở chế độ xem lại, không thể ghi thêm bước mới.'
              );
            }

            if (locked.attempt.status !== 'in_progress') {
              throw ApiErrors.conflict(
                'ATTEMPT_NOT_IN_PROGRESS',
                'error.attempt.not_in_progress',
                'Lượt thực hành này đã kết thúc, không thể lưu thêm bước tương tác.'
              );
            }

            const existingTurn = await repo.findTurnByAttemptAndIndex(
              {
                organizationId: actor.organizationId,
                attemptId: locked.attempt.id,
                turnIndex: input.turnIndex,
              },
              tx
            );

            if (existingTurn) {
              if (
                areTurnPayloadsIdentical(existingTurn, {
                  stepKey: cleanStepKey,
                  selectedChoiceKey: normalizedChoice,
                  selectedEmotionKey: normalizedEmotion,
                  usedAac,
                  usedReadAloud,
                  responsePayloadJson: cleanPayload,
                })
              ) {
                const [turns, progress] = await Promise.all([
                  repo.listTurnsForAttempt(
                    {
                      organizationId: actor.organizationId,
                      attemptId: locked.attempt.id,
                    },
                    tx
                  ),
                  repo.findAssignmentProgressByTarget(
                    {
                      organizationId: actor.organizationId,
                      assignmentTargetId: locked.attempt.assignmentTargetId,
                      studentMembershipId: actor.studentMembershipId,
                    },
                    tx
                  ),
                ]);

                return {
                  httpStatus: 200 as const,
                  idempotentReplay: true,
                  savedTurn: toSafeTurnView(existingTurn),
                  attempt: buildStudentAttemptView({
                    context: locked,
                    turns,
                    progress,
                  }),
                };
              }

              throw ApiErrors.conflict(
                'TURN_INDEX_CONFLICT',
                'error.attempt.turn_index_conflict',
                'Bước tương tác tại chỉ số này đã được lưu trước đó và không thể bị ghi đè.'
              );
            }

            const nextDurationSeconds =
              input.durationSeconds !== undefined
                ? Math.max(locked.attempt.durationSeconds, input.durationSeconds)
                : locked.attempt.durationSeconds;

            const { turn: savedTurn, attempt: updatedAttempt } =
              await repo.insertTurnAndUpdateAttempt(
                {
                  turn: {
                    id: generateUuidV7(),
                    organizationId: actor.organizationId,
                    attemptId: locked.attempt.id,
                    turnIndex: input.turnIndex,
                    stepKey: cleanStepKey,
                    selectedChoiceKey: normalizedChoice,
                    selectedEmotionKey: normalizedEmotion,
                    usedAac,
                    usedReadAloud,
                    responsePayloadJson: cleanPayload,
                    respondedAt: now,
                  },
                  attemptUpdate: {
                    organizationId: actor.organizationId,
                    studentMembershipId: actor.studentMembershipId,
                    attemptId: locked.attempt.id,
                    lastInteractedAt: now,
                    durationSeconds: nextDurationSeconds,
                    usedAacSupport:
                      Boolean(locked.attempt.usedAacSupport) ||
                      usedAac ||
                      aacTapDelta > 0,
                    usedReadAloud:
                      Boolean(locked.attempt.usedReadAloud) ||
                      usedReadAloud ||
                      readAloudDelta > 0,
                    aacTapCount: locked.attempt.aacTapCount + aacTapDelta,
                    readAloudCount:
                      locked.attempt.readAloudCount + readAloudDelta,
                  },
                },
                tx
              );

            const [turns, progress] = await Promise.all([
              repo.listTurnsForAttempt(
                {
                  organizationId: actor.organizationId,
                  attemptId: updatedAttempt.id,
                },
                tx
              ),
              repo.recomputeAndUpsertAssignmentProgress(
                {
                  organizationId: actor.organizationId,
                  assignmentTargetId: updatedAttempt.assignmentTargetId,
                  studentMembershipId: actor.studentMembershipId,
                  totalItems: locked.totalItemsInAssignment,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              ),
            ]);

            return {
              httpStatus: 201 as const,
              idempotentReplay: false,
              savedTurn: toSafeTurnView(savedTurn),
              attempt: buildStudentAttemptView({
                context: {
                  ...locked,
                  attempt: updatedAttempt,
                },
                turns,
                progress,
              }),
            };
          });
        },
        {
          maxAttempts: 5,
          retryOnDuplicateOnce: true,
        });
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

    async completeAttempt(
      input: {
        attemptId: string;
        durationSeconds?: number;
        usedAacSupport?: boolean;
        usedReadAloud?: boolean;
        aacTapDelta?: number;
        readAloudDelta?: number;
        responseSummaryJson?: Record<string, unknown> | null;
      },
      actor: StudentAttemptActorContext
    ): Promise<{
      idempotentReplay: boolean;
      attempt: SafeStudentAttemptView;
    }> {
      const cleanSummary = validateSafeJsonObject(
        input.responseSummaryJson,
        'body.responseSummaryJson'
      );
      const now = nowFn();

      try {
        return await runWithTransientLockRetry(async () => {
          const ref = await repo.findAttemptRefForStudent({
            organizationId: actor.organizationId,
            studentMembershipId: actor.studentMembershipId,
            attemptId: input.attemptId,
          });
          if (!ref) {
            throw ApiErrors.notFound(
              'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
            );
          }

          return repo.withTransaction(async (tx) => {
            const locked = await repo.lockTargetAndLoadStudentAttempt(
              {
                organizationId: actor.organizationId,
                studentMembershipId: actor.studentMembershipId,
                targetId: ref.assignmentTargetId,
                attemptId: input.attemptId,
              },
              tx
            );

            if (
              !locked ||
              locked.assignment.status === 'draft' ||
              locked.assignment.status === 'archived'
            ) {
              throw ApiErrors.notFound(
                'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
              );
            }

            if (locked.assignment.status === 'closed') {
              throw ApiErrors.conflict(
                'ASSIGNMENT_CLOSED',
                'error.assignment.closed',
                'Bài tập đã đóng và chỉ ở chế độ xem lại, không thể thay đổi trạng thái lượt thực hành.'
              );
            }

            if (locked.attempt.status === 'abandoned') {
              throw ApiErrors.conflict(
                'INVALID_ATTEMPT_STATE',
                'error.attempt.invalid_state_transition',
                'Lượt thực hành này đã được dừng trước đó. Vui lòng bắt đầu lượt mới nếu bạn muốn thực hiện lại.'
              );
            }

            if (locked.attempt.status === 'completed') {
              const [turns, progress] = await Promise.all([
                repo.listTurnsForAttempt(
                  {
                    organizationId: actor.organizationId,
                    attemptId: locked.attempt.id,
                  },
                  tx
                ),
                repo.recomputeAndUpsertAssignmentProgress(
                  {
                    organizationId: actor.organizationId,
                    assignmentTargetId: locked.attempt.assignmentTargetId,
                    studentMembershipId: actor.studentMembershipId,
                    totalItems: locked.totalItemsInAssignment,
                    fallbackActivityAt: locked.attempt.lastInteractedAt,
                    now,
                  },
                  tx
                ),
              ]);

              return {
                idempotentReplay: true,
                attempt: buildStudentAttemptView({
                  context: locked,
                  turns,
                  progress,
                }),
              };
            }

            const aacTapDelta =
              input.aacTapDelta ?? (input.usedAacSupport ? 1 : 0);
            const readAloudDelta =
              input.readAloudDelta ?? (input.usedReadAloud ? 1 : 0);
            const updatedAttempt = await repo.updateAttemptStatus(
              {
                organizationId: actor.organizationId,
                studentMembershipId: actor.studentMembershipId,
                attemptId: locked.attempt.id,
                status: 'completed',
                completedAt: now,
                lastInteractedAt: now,
                durationSeconds:
                  input.durationSeconds !== undefined
                    ? Math.max(
                        locked.attempt.durationSeconds,
                        input.durationSeconds
                      )
                    : locked.attempt.durationSeconds,
                usedAacSupport:
                  Boolean(locked.attempt.usedAacSupport) ||
                  Boolean(input.usedAacSupport) ||
                  aacTapDelta > 0,
                usedReadAloud:
                  Boolean(locked.attempt.usedReadAloud) ||
                  Boolean(input.usedReadAloud) ||
                  readAloudDelta > 0,
                aacTapCount: locked.attempt.aacTapCount + aacTapDelta,
                readAloudCount: locked.attempt.readAloudCount + readAloudDelta,
                responseSummaryJson: cleanSummary,
              },
              tx
            );

            const [turns, progress] = await Promise.all([
              repo.listTurnsForAttempt(
                {
                  organizationId: actor.organizationId,
                  attemptId: updatedAttempt.id,
                },
                tx
              ),
              repo.recomputeAndUpsertAssignmentProgress(
                {
                  organizationId: actor.organizationId,
                  assignmentTargetId: updatedAttempt.assignmentTargetId,
                  studentMembershipId: actor.studentMembershipId,
                  totalItems: locked.totalItemsInAssignment,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              ),
            ]);

            return {
              idempotentReplay: false,
              attempt: buildStudentAttemptView({
                context: {
                  ...locked,
                  attempt: updatedAttempt,
                },
                turns,
                progress,
              }),
            };
          });
        });
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

    async abandonAttempt(
      input: {
        attemptId: string;
        confirmed?: boolean;
        durationSeconds?: number;
      },
      actor: StudentAttemptActorContext
    ): Promise<{
      idempotentReplay: boolean;
      attempt: SafeStudentAttemptView;
    }> {
      if (input.confirmed === false) {
        throw ApiErrors.validation([
          {
            field: 'body.confirmed',
            code: 'ABANDON_CONFIRMATION_REQUIRED',
            messageKey: 'error.attempt.abandon_confirmation_required',
            message: 'Cần xác nhận chủ động để dừng lượt thực hành hiện tại.',
          },
        ]);
      }

      const now = nowFn();

      try {
        return await runWithTransientLockRetry(async () => {
          const ref = await repo.findAttemptRefForStudent({
            organizationId: actor.organizationId,
            studentMembershipId: actor.studentMembershipId,
            attemptId: input.attemptId,
          });
          if (!ref) {
            throw ApiErrors.notFound(
              'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
            );
          }

          return repo.withTransaction(async (tx) => {
            const locked = await repo.lockTargetAndLoadStudentAttempt(
              {
                organizationId: actor.organizationId,
                studentMembershipId: actor.studentMembershipId,
                targetId: ref.assignmentTargetId,
                attemptId: input.attemptId,
              },
              tx
            );

            if (
              !locked ||
              locked.assignment.status === 'draft' ||
              locked.assignment.status === 'archived'
            ) {
              throw ApiErrors.notFound(
                'Không tìm thấy lượt thực hành cho tài khoản của bạn.'
              );
            }

            if (locked.assignment.status === 'closed') {
              throw ApiErrors.conflict(
                'ASSIGNMENT_CLOSED',
                'error.assignment.closed',
                'Bài tập đã đóng và chỉ ở chế độ xem lại, không thể thay đổi trạng thái lượt thực hành.'
              );
            }

            if (locked.attempt.status === 'completed') {
              throw ApiErrors.conflict(
                'INVALID_ATTEMPT_STATE',
                'error.attempt.invalid_state_transition',
                'Lượt thực hành đã hoàn thành trước đó và không thể chuyển sang trạng thái tạm dừng.'
              );
            }

            if (locked.attempt.status === 'abandoned') {
              const [turns, progress] = await Promise.all([
                repo.listTurnsForAttempt(
                  {
                    organizationId: actor.organizationId,
                    attemptId: locked.attempt.id,
                  },
                  tx
                ),
                repo.recomputeAndUpsertAssignmentProgress(
                  {
                    organizationId: actor.organizationId,
                    assignmentTargetId: locked.attempt.assignmentTargetId,
                    studentMembershipId: actor.studentMembershipId,
                    totalItems: locked.totalItemsInAssignment,
                    fallbackActivityAt: locked.attempt.lastInteractedAt,
                    now,
                  },
                  tx
                ),
              ]);

              return {
                idempotentReplay: true,
                attempt: buildStudentAttemptView({
                  context: locked,
                  turns,
                  progress,
                }),
              };
            }

            const updatedAttempt = await repo.updateAttemptStatus(
              {
                organizationId: actor.organizationId,
                studentMembershipId: actor.studentMembershipId,
                attemptId: locked.attempt.id,
                status: 'abandoned',
                completedAt: null,
                lastInteractedAt: now,
                durationSeconds:
                  input.durationSeconds !== undefined
                    ? Math.max(
                        locked.attempt.durationSeconds,
                        input.durationSeconds
                      )
                    : locked.attempt.durationSeconds,
                usedAacSupport: Boolean(locked.attempt.usedAacSupport),
                usedReadAloud: Boolean(locked.attempt.usedReadAloud),
                aacTapCount: locked.attempt.aacTapCount,
                readAloudCount: locked.attempt.readAloudCount,
              },
              tx
            );

            const [turns, progress] = await Promise.all([
              repo.listTurnsForAttempt(
                {
                  organizationId: actor.organizationId,
                  attemptId: updatedAttempt.id,
                },
                tx
              ),
              repo.recomputeAndUpsertAssignmentProgress(
                {
                  organizationId: actor.organizationId,
                  assignmentTargetId: updatedAttempt.assignmentTargetId,
                  studentMembershipId: actor.studentMembershipId,
                  totalItems: locked.totalItemsInAssignment,
                  fallbackActivityAt: now,
                  now,
                },
                tx
              ),
            ]);

            return {
              idempotentReplay: false,
              attempt: buildStudentAttemptView({
                context: {
                  ...locked,
                  attempt: updatedAttempt,
                },
                turns,
                progress,
              }),
            };
          });
        });
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

    async listTeacherAssignmentAttempts(
      input: {
        assignmentId: string;
        studentMembershipId?: string;
        assignmentItemId?: string;
        status?: AttemptStatus;
        page: number;
        limit: number;
      },
      actor: TeacherAttemptActorContext
    ) {
      const access = await repo.findTeacherAssignmentAccess({
        organizationId: actor.organizationId,
        assignmentId: input.assignmentId,
        teacherMembershipId: actor.teacherMembershipId,
      });

      if (!access) {
        throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
      }

      if (!access.isTeacherAssigned) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.unauthorized_access_denied',
          targetType: 'assignment',
          targetId: access.assignment.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            action: 'list_assignment_attempts_unassigned_teacher',
            classId: access.assignment.classId,
          },
        }).catch(() => undefined);

        throw ApiErrors.forbidden(
          'Bạn không được phân công phụ trách lớp của bài tập này.'
        );
      }

      const result = await repo.listAttemptsForTeacherAssignment({
        organizationId: actor.organizationId,
        assignmentId: access.assignment.id,
        studentMembershipId: input.studentMembershipId,
        assignmentItemId: input.assignmentItemId,
        status: input.status,
        page: input.page,
        limit: input.limit,
      });

      return {
        assignment: {
          id: access.assignment.id,
          organizationId: access.assignment.organizationId,
          classId: access.assignment.classId,
          className: access.assignment.className,
          title: access.assignment.title,
          status: access.assignment.status,
          readOnly: true,
        },
        items: result.items.map(toSafeTeacherAttemptSummaryView),
        page: input.page,
        limit: input.limit,
        total: result.total,
      };
    },

    async getTeacherAttemptDetail(
      input: {
        assignmentId: string;
        attemptId: string;
      },
      actor: TeacherAttemptActorContext
    ): Promise<{
      assignment: {
        id: string;
        organizationId: string;
        classId: string;
        className: string;
        title: string;
        status: string;
        readOnly: true;
      };
      attempt: SafeTeacherAttemptDetailView;
    }> {
      const access = await repo.findTeacherAssignmentAccess({
        organizationId: actor.organizationId,
        assignmentId: input.assignmentId,
        teacherMembershipId: actor.teacherMembershipId,
      });

      if (!access) {
        throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
      }

      if (!access.isTeacherAssigned) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.unauthorized_access_denied',
          targetType: 'assignment',
          targetId: access.assignment.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            action: 'view_attempt_detail_unassigned_teacher',
            classId: access.assignment.classId,
          },
        }).catch(() => undefined);

        throw ApiErrors.forbidden(
          'Bạn không được phân công phụ trách lớp của bài tập này.'
        );
      }

      const row = await repo.findAttemptDetailForTeacher({
        organizationId: actor.organizationId,
        assignmentId: access.assignment.id,
        attemptId: input.attemptId,
      });

      if (!row) {
        throw ApiErrors.notFound(
          'Không tìm thấy lượt thực hành thuộc bài tập này.'
        );
      }

      const turns = await repo.listTurnsForAttempt({
        organizationId: actor.organizationId,
        attemptId: row.attempt.id,
      });

      return {
        assignment: {
          id: access.assignment.id,
          organizationId: access.assignment.organizationId,
          classId: access.assignment.classId,
          className: access.assignment.className,
          title: access.assignment.title,
          status: access.assignment.status,
          readOnly: true,
        },
        attempt: {
          ...toSafeTeacherAttemptSummaryView(row),
          turns: turns.map(toSafeTurnView),
        },
      };
    },
  };
}

export type AttemptService = ReturnType<typeof createAttemptService>;
