import { sql } from 'drizzle-orm';
import {
  datetime,
  foreignKey,
  index,
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
import { organizations, users } from './identity';

/**
 * 4.1 email_verification_tokens
 * Stores ONLY SHA-256 hashes of guardian email verification tokens.
 */
export const emailVerificationTokens = mysqlTable(
  'email_verification_tokens',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    userId: uuidChar36('user_id').notNull(),
    purpose: varchar('purpose', { length: 64 }).notNull(),
    emailSnapshot: emailVarchar255('email_snapshot').notNull(),
    tokenHash: asciiChar64('token_hash').notNull(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    consumedAt: datetime('consumed_at', { fsp: 3 }),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_email_verif_tokens_user',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    unique('uq_email_verif_tokens_hash').on(t.tokenHash),
    index('idx_email_verif_tokens_user_active').on(
      t.userId,
      t.purpose,
      t.revokedAt,
      t.consumedAt
    ),
    index('idx_email_verif_tokens_expires').on(t.expiresAt),
  ]
);

/**
 * 4.2 family_workspaces
 * Family-level isolated workspace separate from school organizations.
 */
export const familyWorkspaces = mysqlTable(
  'family_workspaces',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    code: asciiVarchar64('code').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_workspaces_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_family_workspaces_code').on(t.code),
    index('idx_family_workspaces_status').on(t.status),
  ]
);

/**
 * 4.3 family_memberships
 * Verified Guardian memberships within a Family Workspace.
 */
export const familyMemberships = mysqlTable(
  'family_memberships',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyWorkspaceId: uuidChar36('family_workspace_id').notNull(),
    guardianUserId: uuidChar36('guardian_user_id').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('guardian'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    invitedByUserId: uuidChar36('invited_by_user_id'),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    activeWorkspaceGuard: uuidChar36('active_workspace_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN family_workspace_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeGuardianGuard: uuidChar36('active_guardian_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN status = 'active' THEN guardian_user_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_memberships_workspace',
      columns: [t.familyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_family_memberships_guardian',
      columns: [t.guardianUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_memberships_inviter',
      columns: [t.invitedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_family_memberships_ws_id').on(t.familyWorkspaceId, t.id),
    unique('uq_family_memberships_active_pair').on(
      t.activeWorkspaceGuard,
      t.activeGuardianGuard
    ),
    index('idx_family_memberships_guardian').on(t.guardianUserId, t.status),
  ]
);

/**
 * 4.4 family_students
 * Associates a single canonical Student users.id with a Family Workspace for login
 * without duplicating users or polluting school organization_memberships.
 */
export const familyStudents = mysqlTable(
  'family_students',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyWorkspaceId: uuidChar36('family_workspace_id').notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    familyUsername: asciiVarchar64('family_username').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_family_students_workspace',
      columns: [t.familyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_family_students_user',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_family_students_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_family_students_ws_student').on(
      t.familyWorkspaceId,
      t.studentUserId
    ),
    unique('uq_family_students_ws_username').on(
      t.familyWorkspaceId,
      t.familyUsername
    ),
    index('idx_family_students_user_status').on(t.studentUserId, t.status),
  ]
);

/**
 * 4.5 student_link_invitations
 * Single-use, expiring, revocable hashed tokens for linking an existing School Student
 * or inviting a co-Guardian into a Family Workspace.
 */
export const studentLinkInvitations = mysqlTable(
  'student_link_invitations',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    invitationType: varchar('invitation_type', { length: 32 }).notNull(),
    studentUserId: uuidChar36('student_user_id'),
    sourceOrganizationId: uuidChar36('source_organization_id'),
    sourceFamilyWorkspaceId: uuidChar36('source_family_workspace_id'),
    tokenHash: asciiChar64('token_hash').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    createdByRole: varchar('created_by_role', { length: 32 }).notNull(),
    claimedByUserId: uuidChar36('claimed_by_user_id'),
    claimedFamilyWorkspaceId: uuidChar36('claimed_family_workspace_id'),
    claimedAt: datetime('claimed_at', { fsp: 3 }),
    revokedByUserId: uuidChar36('revoked_by_user_id'),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_student_invitations_student',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_source_org',
      columns: [t.sourceOrganizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_source_ws',
      columns: [t.sourceFamilyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_claimer',
      columns: [t.claimedByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_claimed_ws',
      columns: [t.claimedFamilyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_student_invitations_revoker',
      columns: [t.revokedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_student_link_invitations_hash').on(t.tokenHash),
    index('idx_student_invitations_student_status').on(
      t.studentUserId,
      t.status,
      t.expiresAt
    ),
    index('idx_student_invitations_ws_status').on(
      t.sourceFamilyWorkspaceId,
      t.status,
      t.expiresAt
    ),
  ]
);

/**
 * 4.6 guardian_student_links
 * Canonical independently-verified relationship between a Guardian users.id and a Student users.id
 * inside a Family Workspace. Revoking preserves Student identity, other Guardians, and School history.
 */
export const guardianStudentLinks = mysqlTable(
  'guardian_student_links',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    familyWorkspaceId: uuidChar36('family_workspace_id').notNull(),
    guardianUserId: uuidChar36('guardian_user_id').notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    relationshipStatus: varchar('relationship_status', { length: 32 })
      .notNull()
      .default('active'),
    verificationSource: varchar('verification_source', { length: 32 }).notNull(),
    sourceOrganizationId: uuidChar36('source_organization_id'),
    invitationId: uuidChar36('invitation_id'),
    verifiedAt: datetime('verified_at', { fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    revokedByUserId: uuidChar36('revoked_by_user_id'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
    activeWsGuard: uuidChar36('active_ws_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN relationship_status = 'active' THEN family_workspace_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeGuardianGuard: uuidChar36('active_guardian_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN relationship_status = 'active' THEN guardian_user_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
    activeStudentGuard: uuidChar36('active_student_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN relationship_status = 'active' THEN student_user_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_gs_links_workspace',
      columns: [t.familyWorkspaceId],
      foreignColumns: [familyWorkspaces.id],
    }),
    foreignKey({
      name: 'fk_gs_links_guardian',
      columns: [t.guardianUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_gs_links_student',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_gs_links_source_org',
      columns: [t.sourceOrganizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_gs_links_invitation',
      columns: [t.invitationId],
      foreignColumns: [studentLinkInvitations.id],
    }),
    foreignKey({
      name: 'fk_gs_links_revoker',
      columns: [t.revokedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_gs_links_active_triple').on(
      t.activeWsGuard,
      t.activeGuardianGuard,
      t.activeStudentGuard
    ),
    index('idx_gs_links_guardian_status').on(
      t.guardianUserId,
      t.relationshipStatus
    ),
    index('idx_gs_links_student_status').on(
      t.studentUserId,
      t.relationshipStatus
    ),
  ]
);

/**
 * 4.7 student_link_invitation_students
 * Explicit per-student scope for co_guardian_invite tokens so invited co-guardians
 * only link to the exact students selected by the inviting guardian.
 */
export const studentLinkInvitationStudents = mysqlTable(
  'student_link_invitation_students',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    invitationId: uuidChar36('invitation_id').notNull(),
    studentUserId: uuidChar36('student_user_id').notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_inv_students_invitation',
      columns: [t.invitationId],
      foreignColumns: [studentLinkInvitations.id],
    }),
    foreignKey({
      name: 'fk_inv_students_student',
      columns: [t.studentUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_inv_students_pair').on(t.invitationId, t.studentUserId),
    index('idx_inv_students_student').on(t.studentUserId),
  ]
);
