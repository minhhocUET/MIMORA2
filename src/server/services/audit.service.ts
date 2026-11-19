import { z } from 'zod';
import { getDb, type MimoraDatabase } from '../db/tidb.ts';
import { AUDIT_EVENT_TYPES, type AuditEventType } from '../db/schema/_shared.ts';
import { auditLogs } from '../db/schema/audit.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';

export type AuditActorRole = 'platform_admin' | 'teacher' | 'student' | 'guardian';
export type AuditInsertExecutor = Pick<MimoraDatabase, 'insert'>;

const AUDIT_EVENT_SET = new Set<string>(AUDIT_EVENT_TYPES);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys forbidden anywhere inside audit_logs.metadata_json (recursive check)
 * per DATABASE_SCHEMA.md §3.22 and MIMORA privacy boundaries.
 */
const FORBIDDEN_NORMALIZED_KEYS = new Set([
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
  'selectedchoicekey',
  'selectedemotionkey',
  'responsepayload',
  'responsepayloadjson',
  'responsesummary',
  'responsesummaryjson',
  'rawanswer',
  'rawanswers',
  'studentanswer',
  'studentanswers',
  'activityturns',
  'attemptturns',
  'notebody',
  'observationnote',
  'observationbody',
  'goaltitle',
  'goaldescription',
  'supportpreferences',
  'supportpreferencesjson',
  'verificationtoken',
  'claimcode',
  'invitationcode',
  'invitationtoken',
  'plaintexttoken',
]);

const SENSITIVE_KEY_SUFFIXES = ['password', 'passwordhash', 'tokenhash', 'notebody'];

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSensitiveMetadataKey(key: string, targetType?: string | null): boolean {
  const normalized = normalizeKey(key);
  if (FORBIDDEN_NORMALIZED_KEYS.has(normalized)) {
    return true;
  }
  if (SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  if (
    targetType &&
    targetType.toLowerCase().includes('goal') &&
    (normalized === 'title' || normalized === 'description')
  ) {
    return true;
  }
  return false;
}

const MAX_METADATA_DEPTH = 8;

function findUnsafeMetadataPath(
  value: unknown,
  targetType: string | null | undefined,
  currentPath: string,
  depth: number,
  visited: Set<object>
): string | null {
  if (depth > MAX_METADATA_DEPTH) {
    return `${currentPath} (max depth exceeded)`;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  if (visited.has(value)) {
    return `${currentPath} (circular reference)`;
  }
  visited.add(value);

  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const hit = findUnsafeMetadataPath(
          value[i],
          targetType,
          `${currentPath}[${i}]`,
          depth + 1,
          visited
        );
        if (hit) {
          return hit;
        }
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(record)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (isSensitiveMetadataKey(key, targetType)) {
        return nextPath;
      }
      const nestedTargetType =
        normalizeKey(key).includes('goal') ? 'student_goal' : targetType;
      const hit = findUnsafeMetadataPath(
        nestedValue,
        nestedTargetType,
        nextPath,
        depth + 1,
        visited
      );
      if (hit) {
        return hit;
      }
    }
    return null;
  } finally {
    visited.delete(value);
  }
}

export interface RecordAuditEventInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorRole?: AuditActorRole | null;
  eventType: AuditEventType;
  targetType?: string | null;
  targetId?: string | null;
  ipPrefix?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
}

export type AuditLogInsertRow = typeof auditLogs.$inferInsert;

const auditInputSchema = z.object({
  organizationId: z.string().regex(UUID_REGEX).nullable().optional(),
  actorUserId: z.string().regex(UUID_REGEX).nullable().optional(),
  actorRole: z.enum(['platform_admin', 'teacher', 'student', 'guardian']).nullable().optional(),
  eventType: z.string().min(1).max(64),
  targetType: z.string().trim().min(1).max(64).nullable().optional(),
  targetId: z.string().regex(UUID_REGEX).nullable().optional(),
  ipPrefix: z.string().trim().min(1).max(64).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.date().optional(),
});

export function isAllowlistedAuditEventType(value: string): value is AuditEventType {
  return AUDIT_EVENT_SET.has(value);
}

export function assertSafeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
  targetType?: string | null
): void {
  if (!metadata) {
    return;
  }

  const unsafePath = findUnsafeMetadataPath(metadata, targetType, '', 0, new Set());
  if (unsafePath) {
    throw new AppError({
      httpStatus: 422,
      code: 'AUDIT_UNSAFE_METADATA',
      messageKey: 'error.audit.unsafe_metadata',
      message: 'Dữ liệu nhật ký chứa thông tin nhạy cảm không được phép lưu trữ.',
      details: [
        {
          field: `metadata.${unsafePath}`,
          code: 'FORBIDDEN_AUDIT_FIELD',
          messageKey: 'error.audit.forbidden_field',
          message: 'Trường này bị cấm lưu vào audit log.',
        },
      ],
    });
  }
}

export function buildAuditLogRow(input: RecordAuditEventInput): AuditLogInsertRow {
  const parsed = auditInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      httpStatus: 422,
      code: 'AUDIT_INVALID_INPUT',
      messageKey: 'error.audit.invalid_input',
      message: 'Thông tin sự kiện nhật ký không hợp lệ.',
    });
  }

  if (!isAllowlistedAuditEventType(parsed.data.eventType)) {
    throw new AppError({
      httpStatus: 422,
      code: 'AUDIT_DISALLOWED_EVENT_TYPE',
      messageKey: 'error.audit.disallowed_event_type',
      message: 'Loại sự kiện nhật ký không nằm trong danh sách được phép.',
    });
  }

  assertSafeAuditMetadata(parsed.data.metadata ?? null, parsed.data.targetType ?? null);

  return {
    id: generateUuidV7(),
    organizationId: parsed.data.organizationId ?? null,
    actorUserId: parsed.data.actorUserId ?? null,
    actorRole: parsed.data.actorRole ?? null,
    eventType: parsed.data.eventType,
    targetType: parsed.data.targetType ?? null,
    targetId: parsed.data.targetId ?? null,
    ipPrefix: parsed.data.ipPrefix ?? null,
    metadataJson: parsed.data.metadata ?? null,
    createdAt: parsed.data.createdAt ?? new Date(),
  };
}

export async function recordAuditEvent(
  input: RecordAuditEventInput,
  executor?: AuditInsertExecutor
): Promise<AuditLogInsertRow> {
  const row = buildAuditLogRow(input);
  const db = executor ?? getDb();
  await db.insert(auditLogs).values(row);
  return row;
}
