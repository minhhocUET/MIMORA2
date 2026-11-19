import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  classEnrollments,
  classes,
  classTeachers,
} from '../db/schema/classes.ts';
import {
  familyMemberships,
  familyStudents,
  familyWorkspaces,
  guardianStudentLinks,
  studentLinkInvitations,
  studentLinkInvitationStudents,
} from '../db/schema/family.ts';
import {
  organizationMemberships,
  organizations,
  users,
} from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type GuardianDbOrTx = MimoraDatabase | MimoraTransaction;

export interface FamilyWorkspaceRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyMembershipRecord {
  id: string;
  familyWorkspaceId: string;
  guardianUserId: string;
  role: string;
  status: string;
  invitedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyWorkspaceSummaryRecord {
  workspace: FamilyWorkspaceRecord;
  membership: FamilyMembershipRecord;
  memberCount: number;
  studentCount: number;
}

export interface FamilyWorkspaceMemberRecord {
  membershipId: string;
  guardianUserId: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: Date;
}

export interface FamilyWorkspaceStudentRecord {
  familyStudentId: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyUsername: string;
  status: string;
  displayName: string;
  userStatus: string;
  createdAt: Date;
  hasSchoolMembership: boolean;
  linkedByCurrentGuardian: boolean;
  currentGuardianLinkId: string | null;
}

export interface GuardianStudentLinkRecord {
  linkId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  guardianUserId: string;
  studentUserId: string;
  studentDisplayName: string;
  studentStatus: string;
  familyUsername: string | null;
  relationshipStatus: string;
  verificationSource: string;
  sourceOrganizationId: string | null;
  sourceOrganizationCode: string | null;
  sourceOrganizationName: string | null;
  hasSchoolMembership: boolean;
  verifiedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface LinkInvitationRecord {
  id: string;
  invitationType: string;
  studentUserId: string | null;
  sourceOrganizationId: string | null;
  sourceFamilyWorkspaceId: string | null;
  tokenHash: string;
  status: string;
  expiresAt: Date;
  createdByUserId: string;
  createdByRole: string;
  claimedByUserId: string | null;
  claimedFamilyWorkspaceId: string | null;
  claimedAt: Date | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface SchoolStudentTargetRecord {
  membershipId: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  organizationStatus: string;
  userId: string;
  userDisplayName: string;
  userStatus: string;
  role: string;
  membershipStatus: string;
  orgUsername: string | null;
}

export interface GuardianRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findWorkspaceByCode(
    code: string,
    executor?: GuardianDbOrTx
  ): Promise<FamilyWorkspaceRecord | null>;
  findWorkspaceMembership(
    workspaceId: string,
    guardianUserId: string,
    executor?: GuardianDbOrTx
  ): Promise<{
    workspace: FamilyWorkspaceRecord;
    membership: FamilyMembershipRecord;
  } | null>;
  listWorkspacesForGuardian(
    guardianUserId: string,
    executor?: GuardianDbOrTx
  ): Promise<FamilyWorkspaceSummaryRecord[]>;
  listWorkspaceMembers(
    workspaceId: string,
    executor?: GuardianDbOrTx
  ): Promise<FamilyWorkspaceMemberRecord[]>;
  listWorkspaceStudentsForGuardian(
    workspaceId: string,
    guardianUserId: string,
    executor?: GuardianDbOrTx
  ): Promise<FamilyWorkspaceStudentRecord[]>;
  createFamilyWorkspaceWithOwner(
    params: {
      workspaceId: string;
      membershipId: string;
      code: string;
      name: string;
      guardianUserId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<{
    workspace: FamilyWorkspaceRecord;
    membership: FamilyMembershipRecord;
  }>;
  findFamilyStudentByUsername(
    workspaceId: string,
    familyUsername: string,
    executor?: GuardianDbOrTx
  ): Promise<{ id: string; studentUserId: string; familyUsername: string } | null>;
  findFamilyStudentByUser(
    workspaceId: string,
    studentUserId: string,
    executor?: GuardianDbOrTx
  ): Promise<{ id: string; studentUserId: string; familyUsername: string; status: string } | null>;
  createFamilyStudentAndLink(
    params: {
      studentUserId: string;
      displayName: string;
      passwordHash: string;
      familyStudentId: string;
      familyWorkspaceId: string;
      familyUsername: string;
      linkId: string;
      guardianUserId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<void>;
  listGuardianStudentLinks(
    guardianUserId: string,
    options?: { includeRevoked?: boolean },
    executor?: GuardianDbOrTx
  ): Promise<GuardianStudentLinkRecord[]>;
  findGuardianStudentLinkById(
    linkId: string,
    executor?: GuardianDbOrTx
  ): Promise<{
    id: string;
    familyWorkspaceId: string;
    guardianUserId: string;
    studentUserId: string;
    relationshipStatus: string;
  } | null>;
  findActiveGuardianStudentLink(
    workspaceId: string,
    guardianUserId: string,
    studentUserId: string,
    executor?: GuardianDbOrTx
  ): Promise<{ id: string } | null>;
  revokeGuardianStudentLink(
    params: {
      linkId: string;
      guardianUserId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<boolean>;
  findSchoolStudentByMembershipId(
    organizationId: string,
    membershipId: string,
    executor?: GuardianDbOrTx
  ): Promise<SchoolStudentTargetRecord | null>;
  findSharedActiveClassIds(
    organizationId: string,
    teacherMembershipId: string,
    studentMembershipId: string,
    executor?: GuardianDbOrTx
  ): Promise<string[]>;
  createLinkInvitation(
    params: typeof studentLinkInvitations.$inferInsert,
    executor?: GuardianDbOrTx
  ): Promise<LinkInvitationRecord>;
  listSchoolStudentInvitations(
    params: {
      studentUserId: string;
      sourceOrganizationId: string;
    },
    executor?: GuardianDbOrTx
  ): Promise<LinkInvitationRecord[]>;
  listWorkspaceCoGuardianInvitations(
    workspaceId: string,
    executor?: GuardianDbOrTx
  ): Promise<LinkInvitationRecord[]>;
  findInvitationByTokenHash(
    tokenHash: string,
    executor?: GuardianDbOrTx
  ): Promise<LinkInvitationRecord | null>;
  findInvitationById(
    invitationId: string,
    executor?: GuardianDbOrTx
  ): Promise<LinkInvitationRecord | null>;
  markInvitationClaimed(
    params: {
      invitationId: string;
      claimedByUserId: string;
      claimedFamilyWorkspaceId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<boolean>;
  revokeLinkInvitation(
    params: {
      invitationId: string;
      revokedByUserId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<boolean>;
  ensureFamilyStudentRecord(
    params: {
      id: string;
      familyWorkspaceId: string;
      studentUserId: string;
      familyUsername: string;
      createdByUserId: string;
      now: Date;
    },
    executor?: GuardianDbOrTx
  ): Promise<{ id: string; familyUsername: string }>;
  createGuardianStudentLink(
    params: typeof guardianStudentLinks.$inferInsert,
    executor?: GuardianDbOrTx
  ): Promise<void>;
  createFamilyMembership(
    params: typeof familyMemberships.$inferInsert,
    executor?: GuardianDbOrTx
  ): Promise<void>;
  addInvitationScopedStudents(
    entries: Array<{
      id: string;
      invitationId: string;
      studentUserId: string;
      createdAt: Date;
    }>,
    executor?: GuardianDbOrTx
  ): Promise<void>;
  listInvitationScopedStudentIds(
    invitationId: string,
    executor?: GuardianDbOrTx
  ): Promise<string[]>;
  listScopedStudentsForInvitations(
    invitationIds: string[],
    executor?: GuardianDbOrTx
  ): Promise<Map<string, Array<{ studentUserId: string; displayName: string }>>>;
  findUserSummaryById(
    userId: string,
    executor?: GuardianDbOrTx
  ): Promise<{ id: string; displayName: string; status: string; platformRole: string | null } | null>;
}

export function createGuardianRepository(): GuardianRepository {
  const resolveDb = (executor?: GuardianDbOrTx) => executor ?? getDb();

  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findWorkspaceByCode(code, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(familyWorkspaces)
        .where(eq(familyWorkspaces.code, code))
        .limit(1);
      return rows[0] ?? null;
    },

    async findWorkspaceMembership(workspaceId, guardianUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          workspace: familyWorkspaces,
          membership: familyMemberships,
        })
        .from(familyMemberships)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyMemberships.familyWorkspaceId)
        )
        .where(
          and(
            eq(familyMemberships.familyWorkspaceId, workspaceId),
            eq(familyMemberships.guardianUserId, guardianUserId),
            eq(familyMemberships.status, 'active'),
            eq(familyWorkspaces.status, 'active')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async listWorkspacesForGuardian(guardianUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          workspace: familyWorkspaces,
          membership: familyMemberships,
        })
        .from(familyMemberships)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, familyMemberships.familyWorkspaceId)
        )
        .where(
          and(
            eq(familyMemberships.guardianUserId, guardianUserId),
            eq(familyMemberships.status, 'active'),
            eq(familyWorkspaces.status, 'active')
          )
        )
        .orderBy(desc(familyWorkspaces.createdAt));

      if (rows.length === 0) {
        return [];
      }

      const workspaceIds = rows.map((r) => r.workspace.id);
      const memberCounts = await db
        .select({
          familyWorkspaceId: familyMemberships.familyWorkspaceId,
          cnt: sql<number>`count(*)`,
        })
        .from(familyMemberships)
        .where(
          and(
            inArray(familyMemberships.familyWorkspaceId, workspaceIds),
            eq(familyMemberships.status, 'active')
          )
        )
        .groupBy(familyMemberships.familyWorkspaceId);

      const studentCounts = await db
        .select({
          familyWorkspaceId: guardianStudentLinks.familyWorkspaceId,
          cnt: sql<number>`count(distinct ${guardianStudentLinks.studentUserId})`,
        })
        .from(guardianStudentLinks)
        .where(
          and(
            inArray(guardianStudentLinks.familyWorkspaceId, workspaceIds),
            eq(guardianStudentLinks.guardianUserId, guardianUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .groupBy(guardianStudentLinks.familyWorkspaceId);

      const memberCountMap = new Map(
        memberCounts.map((m) => [m.familyWorkspaceId, Number(m.cnt)])
      );
      const studentCountMap = new Map(
        studentCounts.map((s) => [s.familyWorkspaceId, Number(s.cnt)])
      );

      return rows.map((r) => ({
        workspace: r.workspace,
        membership: r.membership,
        memberCount: memberCountMap.get(r.workspace.id) ?? 1,
        studentCount: studentCountMap.get(r.workspace.id) ?? 0,
      }));
    },

    async listWorkspaceMembers(workspaceId, executor) {
      const db = resolveDb(executor);
      return db
        .select({
          membershipId: familyMemberships.id,
          guardianUserId: familyMemberships.guardianUserId,
          displayName: users.displayName,
          role: familyMemberships.role,
          status: familyMemberships.status,
          joinedAt: familyMemberships.createdAt,
        })
        .from(familyMemberships)
        .innerJoin(users, eq(users.id, familyMemberships.guardianUserId))
        .where(
          and(
            eq(familyMemberships.familyWorkspaceId, workspaceId),
            eq(familyMemberships.status, 'active')
          )
        );
    },

    async listWorkspaceStudentsForGuardian(workspaceId, guardianUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          familyStudentId: familyStudents.id,
          familyWorkspaceId: familyStudents.familyWorkspaceId,
          studentUserId: familyStudents.studentUserId,
          familyUsername: familyStudents.familyUsername,
          status: familyStudents.status,
          displayName: users.displayName,
          userStatus: users.status,
          createdAt: familyStudents.createdAt,
          currentGuardianLinkId: guardianStudentLinks.id,
        })
        .from(familyStudents)
        .innerJoin(
          guardianStudentLinks,
          and(
            eq(
              guardianStudentLinks.familyWorkspaceId,
              familyStudents.familyWorkspaceId
            ),
            eq(guardianStudentLinks.studentUserId, familyStudents.studentUserId),
            eq(guardianStudentLinks.guardianUserId, guardianUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .innerJoin(users, eq(users.id, familyStudents.studentUserId))
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, workspaceId),
            eq(familyStudents.status, 'active')
          )
        )
        .orderBy(desc(familyStudents.createdAt));

      if (rows.length === 0) {
        return [];
      }

      const studentIds = rows.map((r) => r.studentUserId);
      const schoolMemberships = await db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(
          and(
            inArray(organizationMemberships.userId, studentIds),
            eq(organizationMemberships.role, 'student'),
            eq(organizationMemberships.status, 'active')
          )
        );
      const schoolSet = new Set(schoolMemberships.map((m) => m.userId));

      return rows.map((r) => ({
        familyStudentId: r.familyStudentId,
        familyWorkspaceId: r.familyWorkspaceId,
        studentUserId: r.studentUserId,
        familyUsername: r.familyUsername,
        status: r.status,
        displayName: r.displayName,
        userStatus: r.userStatus,
        createdAt: r.createdAt,
        hasSchoolMembership: schoolSet.has(r.studentUserId),
        linkedByCurrentGuardian: true,
        currentGuardianLinkId: r.currentGuardianLinkId,
      }));
    },

    async createFamilyWorkspaceWithOwner(params, executor) {
      const db = resolveDb(executor);
      const workspace: FamilyWorkspaceRecord = {
        id: params.workspaceId,
        code: params.code,
        name: params.name,
        status: 'active',
        createdByUserId: params.guardianUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
      const membership: FamilyMembershipRecord = {
        id: params.membershipId,
        familyWorkspaceId: params.workspaceId,
        guardianUserId: params.guardianUserId,
        role: 'guardian',
        status: 'active',
        invitedByUserId: null,
        revokedAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      };
      await db.insert(familyWorkspaces).values(workspace);
      await db.insert(familyMemberships).values(membership);
      return { workspace, membership };
    },

    async findFamilyStudentByUsername(workspaceId, familyUsername, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: familyStudents.id,
          studentUserId: familyStudents.studentUserId,
          familyUsername: familyStudents.familyUsername,
        })
        .from(familyStudents)
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, workspaceId),
            eq(familyStudents.familyUsername, familyUsername)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findFamilyStudentByUser(workspaceId, studentUserId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: familyStudents.id,
          studentUserId: familyStudents.studentUserId,
          familyUsername: familyStudents.familyUsername,
          status: familyStudents.status,
        })
        .from(familyStudents)
        .where(
          and(
            eq(familyStudents.familyWorkspaceId, workspaceId),
            eq(familyStudents.studentUserId, studentUserId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createFamilyStudentAndLink(params, executor) {
      const db = resolveDb(executor);
      await db.insert(users).values({
        id: params.studentUserId,
        email: null,
        emailVerifiedAt: null,
        platformUsername: null,
        displayName: params.displayName,
        platformRole: null,
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        passwordUpdatedAt: params.now,
        createdAt: params.now,
        updatedAt: params.now,
      });

      await db.insert(familyStudents).values({
        id: params.familyStudentId,
        familyWorkspaceId: params.familyWorkspaceId,
        studentUserId: params.studentUserId,
        familyUsername: params.familyUsername,
        status: 'active',
        createdByUserId: params.guardianUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });

      await db.insert(guardianStudentLinks).values({
        id: params.linkId,
        familyWorkspaceId: params.familyWorkspaceId,
        guardianUserId: params.guardianUserId,
        studentUserId: params.studentUserId,
        relationshipStatus: 'active',
        verificationSource: 'family_created',
        sourceOrganizationId: null,
        invitationId: null,
        verifiedAt: params.now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: params.now,
        updatedAt: params.now,
      });
    },

    async listGuardianStudentLinks(guardianUserId, options, executor) {
      const db = resolveDb(executor);
      const condition = options?.includeRevoked
        ? eq(guardianStudentLinks.guardianUserId, guardianUserId)
        : and(
            eq(guardianStudentLinks.guardianUserId, guardianUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          );

      const rows = await db
        .select({
          linkId: guardianStudentLinks.id,
          familyWorkspaceId: guardianStudentLinks.familyWorkspaceId,
          workspaceCode: familyWorkspaces.code,
          workspaceName: familyWorkspaces.name,
          guardianUserId: guardianStudentLinks.guardianUserId,
          studentUserId: guardianStudentLinks.studentUserId,
          studentDisplayName: users.displayName,
          studentStatus: users.status,
          familyUsername: familyStudents.familyUsername,
          relationshipStatus: guardianStudentLinks.relationshipStatus,
          verificationSource: guardianStudentLinks.verificationSource,
          sourceOrganizationId: guardianStudentLinks.sourceOrganizationId,
          sourceOrganizationCode: organizations.code,
          sourceOrganizationName: organizations.name,
          verifiedAt: guardianStudentLinks.verifiedAt,
          revokedAt: guardianStudentLinks.revokedAt,
          createdAt: guardianStudentLinks.createdAt,
        })
        .from(guardianStudentLinks)
        .innerJoin(
          familyWorkspaces,
          eq(familyWorkspaces.id, guardianStudentLinks.familyWorkspaceId)
        )
        .innerJoin(users, eq(users.id, guardianStudentLinks.studentUserId))
        .leftJoin(
          familyStudents,
          and(
            eq(familyStudents.familyWorkspaceId, guardianStudentLinks.familyWorkspaceId),
            eq(familyStudents.studentUserId, guardianStudentLinks.studentUserId)
          )
        )
        .leftJoin(
          organizations,
          eq(organizations.id, guardianStudentLinks.sourceOrganizationId)
        )
        .where(condition)
        .orderBy(desc(guardianStudentLinks.createdAt));

      if (rows.length === 0) {
        return [];
      }

      const studentIds = rows.map((r) => r.studentUserId);
      const schoolMemberships = await db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(
          and(
            inArray(organizationMemberships.userId, studentIds),
            eq(organizationMemberships.role, 'student'),
            eq(organizationMemberships.status, 'active')
          )
        );
      const schoolSet = new Set(schoolMemberships.map((m) => m.userId));

      return rows.map((r) => ({
        ...r,
        hasSchoolMembership: schoolSet.has(r.studentUserId),
      }));
    },

    async findGuardianStudentLinkById(linkId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: guardianStudentLinks.id,
          familyWorkspaceId: guardianStudentLinks.familyWorkspaceId,
          guardianUserId: guardianStudentLinks.guardianUserId,
          studentUserId: guardianStudentLinks.studentUserId,
          relationshipStatus: guardianStudentLinks.relationshipStatus,
        })
        .from(guardianStudentLinks)
        .where(eq(guardianStudentLinks.id, linkId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findActiveGuardianStudentLink(
      workspaceId,
      guardianUserId,
      studentUserId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ id: guardianStudentLinks.id })
        .from(guardianStudentLinks)
        .where(
          and(
            eq(guardianStudentLinks.familyWorkspaceId, workspaceId),
            eq(guardianStudentLinks.guardianUserId, guardianUserId),
            eq(guardianStudentLinks.studentUserId, studentUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async revokeGuardianStudentLink(params, executor) {
      const db = resolveDb(executor);
      const [result] = await db
        .update(guardianStudentLinks)
        .set({
          relationshipStatus: 'revoked',
          revokedAt: params.now,
          revokedByUserId: params.guardianUserId,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(guardianStudentLinks.id, params.linkId),
            eq(guardianStudentLinks.guardianUserId, params.guardianUserId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        );
      return (result.affectedRows ?? 0) > 0;
    },

    async findSchoolStudentByMembershipId(organizationId, membershipId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          membershipId: organizationMemberships.id,
          organizationId: organizationMemberships.organizationId,
          organizationCode: organizations.code,
          organizationName: organizations.name,
          organizationStatus: organizations.status,
          userId: users.id,
          userDisplayName: users.displayName,
          userStatus: users.status,
          role: organizationMemberships.role,
          membershipStatus: organizationMemberships.status,
          orgUsername: organizationMemberships.orgUsername,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.organizationId)
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.id, membershipId),
            eq(organizationMemberships.organizationId, organizationId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findSharedActiveClassIds(
      organizationId,
      teacherMembershipId,
      studentMembershipId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ classId: classes.id })
        .from(classes)
        .innerJoin(
          classTeachers,
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.classId, classes.id),
            eq(classTeachers.teacherMembershipId, teacherMembershipId)
          )
        )
        .innerJoin(
          classEnrollments,
          and(
            eq(classEnrollments.organizationId, organizationId),
            eq(classEnrollments.classId, classes.id),
            eq(classEnrollments.studentMembershipId, studentMembershipId),
            eq(classEnrollments.status, 'active')
          )
        )
        .where(
          and(
            eq(classes.organizationId, organizationId),
            eq(classes.status, 'active')
          )
        );
      return rows.map((r) => r.classId);
    },

    async createLinkInvitation(params, executor) {
      const db = resolveDb(executor);
      await db.insert(studentLinkInvitations).values(params);
      return {
        id: params.id,
        invitationType: params.invitationType,
        studentUserId: params.studentUserId ?? null,
        sourceOrganizationId: params.sourceOrganizationId ?? null,
        sourceFamilyWorkspaceId: params.sourceFamilyWorkspaceId ?? null,
        tokenHash: params.tokenHash,
        status: params.status ?? 'pending',
        expiresAt: params.expiresAt,
        createdByUserId: params.createdByUserId,
        createdByRole: params.createdByRole,
        claimedByUserId: params.claimedByUserId ?? null,
        claimedFamilyWorkspaceId: params.claimedFamilyWorkspaceId ?? null,
        claimedAt: params.claimedAt ?? null,
        revokedByUserId: params.revokedByUserId ?? null,
        revokedAt: params.revokedAt ?? null,
        createdAt: params.createdAt,
      };
    },

    async listSchoolStudentInvitations(params, executor) {
      const db = resolveDb(executor);
      return db
        .select()
        .from(studentLinkInvitations)
        .where(
          and(
            eq(studentLinkInvitations.invitationType, 'school_student_link'),
            eq(studentLinkInvitations.studentUserId, params.studentUserId),
            eq(studentLinkInvitations.sourceOrganizationId, params.sourceOrganizationId)
          )
        )
        .orderBy(desc(studentLinkInvitations.createdAt));
    },

    async listWorkspaceCoGuardianInvitations(workspaceId, executor) {
      const db = resolveDb(executor);
      return db
        .select()
        .from(studentLinkInvitations)
        .where(
          and(
            eq(studentLinkInvitations.invitationType, 'co_guardian_invite'),
            eq(studentLinkInvitations.sourceFamilyWorkspaceId, workspaceId)
          )
        )
        .orderBy(desc(studentLinkInvitations.createdAt));
    },

    async findInvitationByTokenHash(tokenHash, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(studentLinkInvitations)
        .where(eq(studentLinkInvitations.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async findInvitationById(invitationId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(studentLinkInvitations)
        .where(eq(studentLinkInvitations.id, invitationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async markInvitationClaimed(params, executor) {
      const db = resolveDb(executor);
      const [result] = await db
        .update(studentLinkInvitations)
        .set({
          status: 'claimed',
          claimedByUserId: params.claimedByUserId,
          claimedFamilyWorkspaceId: params.claimedFamilyWorkspaceId,
          claimedAt: params.now,
        })
        .where(
          and(
            eq(studentLinkInvitations.id, params.invitationId),
            eq(studentLinkInvitations.status, 'pending'),
            gt(studentLinkInvitations.expiresAt, params.now)
          )
        );
      return (result.affectedRows ?? 0) > 0;
    },

    async revokeLinkInvitation(params, executor) {
      const db = resolveDb(executor);
      const [result] = await db
        .update(studentLinkInvitations)
        .set({
          status: 'revoked',
          revokedByUserId: params.revokedByUserId,
          revokedAt: params.now,
        })
        .where(
          and(
            eq(studentLinkInvitations.id, params.invitationId),
            eq(studentLinkInvitations.status, 'pending')
          )
        );
      return (result.affectedRows ?? 0) > 0;
    },

    async ensureFamilyStudentRecord(params, executor) {
      const db = resolveDb(executor);
      const existing = await this.findFamilyStudentByUser(
        params.familyWorkspaceId,
        params.studentUserId,
        db
      );
      if (existing) {
        if (existing.status !== 'active') {
          await db
            .update(familyStudents)
            .set({ status: 'active', updatedAt: params.now })
            .where(eq(familyStudents.id, existing.id));
        }
        return { id: existing.id, familyUsername: existing.familyUsername };
      }

      await db.insert(familyStudents).values({
        id: params.id,
        familyWorkspaceId: params.familyWorkspaceId,
        studentUserId: params.studentUserId,
        familyUsername: params.familyUsername,
        status: 'active',
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });
      return { id: params.id, familyUsername: params.familyUsername };
    },

    async createGuardianStudentLink(params, executor) {
      const db = resolveDb(executor);
      await db.insert(guardianStudentLinks).values(params);
    },

    async createFamilyMembership(params, executor) {
      const db = resolveDb(executor);
      await db.insert(familyMemberships).values(params);
    },

    async addInvitationScopedStudents(entries, executor) {
      if (entries.length === 0) {
        return;
      }
      const db = resolveDb(executor);
      await db.insert(studentLinkInvitationStudents).values(entries);
    },

    async listInvitationScopedStudentIds(invitationId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ studentUserId: studentLinkInvitationStudents.studentUserId })
        .from(studentLinkInvitationStudents)
        .where(eq(studentLinkInvitationStudents.invitationId, invitationId));
      return rows.map((r) => r.studentUserId);
    },

    async listScopedStudentsForInvitations(invitationIds, executor) {
      const result = new Map<
        string,
        Array<{ studentUserId: string; displayName: string }>
      >();
      if (invitationIds.length === 0) {
        return result;
      }
      const db = resolveDb(executor);
      const rows = await db
        .select({
          invitationId: studentLinkInvitationStudents.invitationId,
          studentUserId: studentLinkInvitationStudents.studentUserId,
          displayName: users.displayName,
        })
        .from(studentLinkInvitationStudents)
        .innerJoin(users, eq(users.id, studentLinkInvitationStudents.studentUserId))
        .where(inArray(studentLinkInvitationStudents.invitationId, invitationIds));

      for (const row of rows) {
        const list = result.get(row.invitationId) ?? [];
        list.push({
          studentUserId: row.studentUserId,
          displayName: row.displayName,
        });
        result.set(row.invitationId, list);
      }
      return result;
    },

    async findUserSummaryById(userId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          status: users.status,
          platformRole: users.platformRole,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
