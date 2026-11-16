import { customType } from 'drizzle-orm/mysql-core';

/**
 * Standardized CHAR(36) UUIDv7 column with consistent CHARACTER SET ascii COLLATE ascii_bin
 * across all 22 tables so every composite FK matches exact charset and collation on TiDB.
 */
export const uuidChar36 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'char(36) CHARACTER SET ascii COLLATE ascii_bin';
  },
});

/**
 * Fixed-length 64-char ASCII hex hash column (SHA-256 token_hash / user_agent_hash).
 */
export const asciiChar64 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'char(64) CHARACTER SET ascii COLLATE ascii_bin';
  },
});

/**
 * Normalized ASCII identifier column (org code, platform_username, org_username).
 */
export const asciiVarchar64 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'varchar(64) CHARACTER SET ascii COLLATE ascii_bin';
  },
});

/**
 * Normalized email address column with explicit utf8mb4_0900_ai_ci collation
 * matching DATABASE_SCHEMA.md.
 */
export const emailVarchar255 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci';
  },
});

export const CANONICAL_CONTENT_TYPES = [
  'emotion_card',
  'situation_card',
  'action_card',
  'social_story_card',
  'communication_card',
] as const;

export type CanonicalContentType = (typeof CANONICAL_CONTENT_TYPES)[number];

export const ORG_ROLES = ['teacher', 'student'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const SESSION_SCOPES = ['platform_admin', 'teacher', 'student'] as const;
export type SessionScope = (typeof SESSION_SCOPES)[number];

export const INSIGHT_PERIOD_TYPES = ['daily', 'weekly', 'monthly'] as const;
export type InsightPeriodType = (typeof INSIGHT_PERIOD_TYPES)[number];

export const AUDIT_EVENT_TYPES = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logout',
  'auth.org_switched',
  'auth.session_revoked',
  'auth.account_locked',
  'auth.account_unlocked',
  'account.created',
  'account.updated',
  'account.disabled',
  'account.password_reset',
  'account.csv_import_started',
  'account.csv_import_completed',
  'account.csv_import_failed',
  'membership.created',
  'membership.status_changed',
  'membership.class_teacher_assigned',
  'membership.class_teacher_removed',
  'membership.student_enrolled',
  'membership.student_transferred',
  'content.item_created',
  'content.version_created',
  'content.submitted_for_review',
  'content.approved',
  'content.rejected',
  'content.self_approved',
  'content.published',
  'content.archived',
  'assignment.created',
  'assignment.updated',
  'assignment.closed',
  'assignment.targets_updated',
  'security.csrf_rejected',
  'security.rate_limit_triggered',
  'security.unauthorized_access_denied',
  'security.cross_tenant_attempt_blocked',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
