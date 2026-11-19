import {
  ApiErrors,
  type ApiErrorDetail,
  AppError,
  extractDatabaseErrorMeta,
  isDatabaseError,
} from '../http/errors.ts';
import { scanUnsafeSelText } from '../validators/content-payload.schema.ts';

export const ATTEMPT_ENGINE_STATUSES = [
  'in_progress',
  'completed',
  'abandoned',
] as const;
export type AttemptEngineStatus = (typeof ATTEMPT_ENGINE_STATUSES)[number];

export interface SafeSharedTurnView {
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

export interface SafeSharedSupportContextView {
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  aacTapCount: number;
  readAloudCount: number;
  isOptionalContextOnly: true;
}

/**
 * Superset forbidden-key list enforced symmetrically by both School and Family
 * attempt engines on turn `responsePayloadJson` and completion `responseSummaryJson`.
 * Covers credential/secret leakage, PII fields, coercive timers/scoring/streaks/shaming,
 * and clinical/diagnostic labels.
 */
export const FORBIDDEN_ATTEMPT_PAYLOAD_KEYS = new Set([
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
  'mastery',
]);

function normalizeAttemptPayloadKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Validates free-form JSON objects attached to attempts (`responsePayloadJson` / `responseSummaryJson`),
 * enforcing JSON object root type, maxKeys=40, maxDepth=5, maxArray=25, forbidden keys, and SEL text safety.
 */
export function validateSafeAttemptJsonObject(
  value: Record<string, unknown> | null | undefined,
  fieldPrefix: string
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw ApiErrors.validation([
      {
        field: fieldPrefix,
        code: 'INVALID_JSON_OBJECT',
        messageKey: 'error.validation.invalid_json',
        message: 'Dữ liệu phản hồi phải là JSON object.',
      },
    ]);
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
        if (FORBIDDEN_ATTEMPT_PAYLOAD_KEYS.has(normalizeAttemptPayloadKey(key))) {
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

export function validateRequiredAttemptStepKey(
  rawStepKey: string,
  field = 'body.stepKey'
): string {
  const trimmed = rawStepKey.trim();
  const issues = scanUnsafeSelText(trimmed, field);
  if (issues.length > 0) {
    throw ApiErrors.validation(issues);
  }
  if (trimmed.length === 0) {
    throw ApiErrors.validation([
      {
        field,
        code: 'REQUIRED',
        messageKey: 'error.validation.required',
        message: 'Mã bước hoạt động (stepKey) không được để trống.',
      },
    ]);
  }
  return trimmed;
}

export function validateOptionalAttemptShortText(
  rawText: string | null | undefined,
  field: string
): string | null {
  if (rawText === undefined || rawText === null) {
    return null;
  }
  const trimmed = rawText.trim();
  const issues = scanUnsafeSelText(trimmed, field);
  if (issues.length > 0) {
    throw ApiErrors.validation(issues);
  }
  return trimmed.length > 0 ? trimmed : null;
}

export function canonicalizeAttemptPayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeAttemptPayload);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      normalized[k] = canonicalizeAttemptPayload(v);
    }
    return normalized;
  }
  return value;
}

export interface AttemptTurnComparableFields {
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  responsePayloadJson: Record<string, unknown> | null;
}

export function areAttemptTurnPayloadsEquivalent(
  existing: AttemptTurnComparableFields,
  incoming: AttemptTurnComparableFields
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

  return (
    JSON.stringify(
      canonicalizeAttemptPayload(existing.responsePayloadJson ?? null)
    ) ===
    JSON.stringify(
      canonicalizeAttemptPayload(incoming.responsePayloadJson ?? null)
    )
  );
}

export function normalizeAttemptEngineStatus(
  status: string
): AttemptEngineStatus {
  if ((ATTEMPT_ENGINE_STATUSES as readonly string[]).includes(status)) {
    return status as AttemptEngineStatus;
  }
  return 'in_progress';
}

export function assertPinnedContentVersionMatches(
  expectedContentVersionId: string | undefined,
  pinnedContentVersionId: string
): void {
  if (
    expectedContentVersionId &&
    expectedContentVersionId !== pinnedContentVersionId
  ) {
    throw ApiErrors.conflict(
      'PINNED_CONTENT_VERSION_MISMATCH',
      'error.attempt.pinned_version_mismatch',
      'Phiên bản nội dung được yêu cầu không khớp với phiên bản đã gắn cố định trong hoạt động.'
    );
  }
}

export function resolveStartOrResumeEligibility(params: {
  hasInProgress: boolean;
  priorAttemptCount: number;
  intent: 'start_or_resume' | 'retry';
}): 'resumed' | 'started' | 'retried' {
  if (params.hasInProgress) {
    if (params.intent === 'retry') {
      throw ApiErrors.conflict(
        'ATTEMPT_ALREADY_IN_PROGRESS',
        'error.attempt.already_in_progress',
        'Đang có một lượt thực hành chưa hoàn thành cho hoạt động này. Vui lòng tiếp tục hoặc chủ động kết thúc trước khi bắt đầu lượt mới.'
      );
    }
    return 'resumed';
  }

  if (params.priorAttemptCount > 0 && params.intent !== 'retry') {
    throw ApiErrors.conflict(
      'RETRY_INTENT_REQUIRED',
      'error.attempt.retry_intent_required',
      'Hoạt động này đã có lượt thực hành trước đó. Vui lòng chọn Làm lại (retry) để bắt đầu lượt mới.'
    );
  }

  return params.intent === 'retry' ? 'retried' : 'started';
}

export function assertAttemptCanSaveTurn(status: string): void {
  if (status !== 'in_progress') {
    throw ApiErrors.conflict(
      'ATTEMPT_NOT_IN_PROGRESS',
      'error.attempt.not_in_progress',
      'Lượt thực hành này đã kết thúc, không thể lưu thêm bước tương tác.'
    );
  }
}

export function assertAttemptCanComplete(status: string): 'proceed' | 'replay' {
  if (status === 'completed') {
    return 'replay';
  }
  if (status === 'abandoned') {
    throw ApiErrors.conflict(
      'INVALID_ATTEMPT_STATE',
      'error.attempt.invalid_state_transition',
      'Lượt thực hành này đã được dừng trước đó. Vui lòng bắt đầu lượt mới nếu bạn muốn thực hiện lại.'
    );
  }
  if (status !== 'in_progress') {
    throw ApiErrors.conflict(
      'INVALID_ATTEMPT_STATE',
      'error.attempt.invalid_state_transition',
      'Trạng thái lượt thực hành hiện tại không cho phép hoàn thành.'
    );
  }
  return 'proceed';
}

export function assertAttemptCanAbandon(status: string): 'proceed' | 'replay' {
  if (status === 'abandoned') {
    return 'replay';
  }
  if (status === 'completed') {
    throw ApiErrors.conflict(
      'INVALID_ATTEMPT_STATE',
      'error.attempt.invalid_state_transition',
      'Lượt thực hành đã hoàn thành trước đó và không thể chuyển sang trạng thái tạm dừng.'
    );
  }
  if (status !== 'in_progress') {
    throw ApiErrors.conflict(
      'INVALID_ATTEMPT_STATE',
      'error.attempt.invalid_state_transition',
      'Chỉ có thể tạm dừng lượt thực hành đang diễn ra.'
    );
  }
  return 'proceed';
}

export function computeMonotonicAttemptDuration(
  currentDurationSeconds: number,
  incomingDurationSeconds?: number
): number {
  if (incomingDurationSeconds === undefined) {
    return currentDurationSeconds;
  }
  return Math.max(currentDurationSeconds, incomingDurationSeconds);
}

export function resolveInitialSupportCounts(params: {
  usedAacSupport?: boolean;
  usedReadAloud?: boolean;
}) {
  const usedAacSupport = Boolean(params.usedAacSupport);
  const usedReadAloud = Boolean(params.usedReadAloud);
  return {
    usedAacSupport,
    usedReadAloud,
    aacTapCount: usedAacSupport ? 1 : 0,
    readAloudCount: usedReadAloud ? 1 : 0,
  };
}

export function resolveSupportTelemetryUpdate(params: {
  prevUsedAac: boolean;
  prevUsedReadAloud: boolean;
  prevAacTapCount: number;
  prevReadAloudCount: number;
  usedAacFlag?: boolean;
  usedReadAloudFlag?: boolean;
  aacTapDelta?: number;
  readAloudDelta?: number;
}) {
  const aacDelta = params.aacTapDelta ?? (params.usedAacFlag ? 1 : 0);
  const readAloudDelta =
    params.readAloudDelta ?? (params.usedReadAloudFlag ? 1 : 0);
  return {
    usedAacSupport:
      Boolean(params.prevUsedAac) || Boolean(params.usedAacFlag) || aacDelta > 0,
    usedReadAloud:
      Boolean(params.prevUsedReadAloud) ||
      Boolean(params.usedReadAloudFlag) ||
      readAloudDelta > 0,
    aacTapCount: params.prevAacTapCount + aacDelta,
    readAloudCount: params.prevReadAloudCount + readAloudDelta,
  };
}

export function toSafeAttemptTurnView(row: {
  id: string;
  turnIndex: number;
  stepKey: string;
  selectedChoiceKey: string | null;
  selectedEmotionKey: string | null;
  usedAac: boolean;
  usedReadAloud: boolean;
  responsePayloadJson: Record<string, unknown> | null;
  respondedAt: Date;
}): SafeSharedTurnView {
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

export function computeAttemptResumePosition(turns: SafeSharedTurnView[]) {
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  return {
    savedTurnCount: turns.length,
    nextTurnIndex: lastTurn ? lastTurn.turnIndex + 1 : 0,
    lastTurnIndex: lastTurn ? lastTurn.turnIndex : null,
    lastStepKey: lastTurn ? lastTurn.stepKey : null,
  };
}

export function computeAttemptAvailableActions(params: {
  isReadOnly: boolean;
  state: AttemptEngineStatus;
}) {
  const canActOnInProgress =
    !params.isReadOnly && params.state === 'in_progress';
  return {
    canResume: canActOnInProgress,
    canSubmitTurn: canActOnInProgress,
    canComplete: canActOnInProgress,
    canAbandon: canActOnInProgress,
    canRetry: !params.isReadOnly && params.state !== 'in_progress',
  };
}

export function buildAttemptSupportContextView(attempt: {
  usedAacSupport: boolean;
  usedReadAloud: boolean;
  aacTapCount: number;
  readAloudCount: number;
}): SafeSharedSupportContextView {
  return {
    usedAacSupport: Boolean(attempt.usedAacSupport),
    usedReadAloud: Boolean(attempt.usedReadAloud),
    aacTapCount: attempt.aacTapCount,
    readAloudCount: attempt.readAloudCount,
    isOptionalContextOnly: true,
  };
}

export function isRetryableTransientDbConflict(err: unknown): boolean {
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

export function isDuplicateKeyDbError(err: unknown): boolean {
  if (!isDatabaseError(err)) {
    return false;
  }
  const meta = extractDatabaseErrorMeta(err);
  return meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062;
}

export async function runWithTransientLockRetry<T>(
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
