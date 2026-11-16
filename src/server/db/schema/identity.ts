import {
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  asciiChar64,
  asciiVarchar64,
  emailVarchar255,
  uuidChar36,
} from './_shared';

/**
 * 3.1 organizations (Tenant root)
 */
export const organizations = mysqlTable(
  'organizations',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    code: asciiVarchar64('code').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    unique('uq_organizations_code').on(t.code),
    index('idx_organizations_status').on(t.status),
  ]
);

/**
 * 3.2 users (Global core identity; email nullable for students; platform_role only 'platform_admin' | NULL)
 */
export const users = mysqlTable(
  'users',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    email: emailVarchar255('email'),
    platformUsername: asciiVarchar64('platform_username'),
    platformRole: varchar('platform_role', { length: 32 }),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    passwordUpdatedAt: datetime('password_updated_at', { fsp: 3 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    failedLoginAttempts: int('failed_login_attempts').notNull().default(0),
    lockedUntil: datetime('locked_until', { fsp: 3 }),
    lastLoginAt: datetime('last_login_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    unique('uq_users_email').on(t.email),
    unique('uq_users_platform_username').on(t.platformUsername),
    index('idx_users_status').on(t.status),
    index('idx_users_platform_role').on(t.platformRole),
  ]
);

/**
 * 3.3 organization_memberships (Org-level role: 'teacher' | 'student' — NO org_admin in MVP)
 */
export const organizationMemberships = mysqlTable(
  'organization_memberships',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id').notNull(),
    userId: uuidChar36('user_id').notNull(),
    role: varchar('role', { length: 32 }).notNull(),
    orgUsername: asciiVarchar64('org_username'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdByUserId: uuidChar36('created_by_user_id'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_org_memberships_org',
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_org_memberships_user',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_org_memberships_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_org_memberships_org_id').on(t.organizationId, t.id),
    unique('uq_org_memberships_org_user').on(t.organizationId, t.userId),
    unique('uq_org_memberships_org_username').on(t.organizationId, t.orgUsername),
    index('idx_org_memberships_user').on(t.userId, t.status),
    index('idx_org_memberships_org_role').on(t.organizationId, t.role, t.status),
  ]
);

/**
 * 3.4 sessions (Server-side sessions with SHA-256 token_hash and MATCH SIMPLE composite org-membership FK)
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    tokenHash: asciiChar64('token_hash').notNull(),
    userId: uuidChar36('user_id').notNull(),
    sessionScope: varchar('session_scope', { length: 32 }).notNull(),
    activeOrganizationId: uuidChar36('active_organization_id'),
    idleExpiresAt: datetime('idle_expires_at', { fsp: 3 }).notNull(),
    absoluteExpiresAt: datetime('absolute_expires_at', { fsp: 3 }).notNull(),
    lastActivityAt: datetime('last_activity_at', { fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    revokedReason: varchar('revoked_reason', { length: 64 }),
    ipPrefix: varchar('ip_prefix', { length: 64 }),
    userAgentHash: asciiChar64('user_agent_hash'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_sessions_user',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_sessions_active_org_membership',
      columns: [t.activeOrganizationId, t.userId],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.userId,
      ],
    }),
    unique('uq_sessions_token_hash').on(t.tokenHash),
    index('idx_sessions_user_active').on(t.userId, t.revokedAt, t.absoluteExpiresAt),
    index('idx_sessions_cleanup').on(t.absoluteExpiresAt),
  ]
);
