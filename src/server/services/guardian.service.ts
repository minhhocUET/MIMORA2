import crypto from 'node:crypto';
import { z } from 'zod';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, type ApiErrorDetail, AppError, isDatabaseError, translateDatabaseError } from '../http/errors.ts';
import {
  createGuardianRepository,
  type FamilyWorkspaceMemberRecord,
  type FamilyWorkspaceRecord,
  type FamilyWorkspaceStudentRecord,
  type GuardianRepository,
  type LinkInvitationRecord,
} from '../repositories/guardian.repository.ts';
import { hashPassword, validatePasswordInput } from '../security/password-hash.ts';
import { InMemoryRateLimiter, RateLimitExceededError } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { hashSessionToken } from '../security/session.ts';
import { scanUnsafeSelText } from '../validators/content-payload.schema.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
  type RecordAuditEventInput,
} from './audit.service.ts';
import { normalizeUsername, validateUsernameFormat } from './membership.service.ts';

const WORKSPACE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLAIM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN_STUDENT_PASSWORD_LENGTH = 8;
const DEFAULT_INVITATION_EXPIRY_HOURS = 72;
const MAX_INVITATION_EXPIRY_HOURS = 168;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createFamilyWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export const createFamilyStudentSchema = z
  .object({
    displayName: z.string().trim().min(1).max(255),
    familyUsername: z.string().trim().min(2).max(64),
    password: z.string().min(MIN_STUDENT_PASSWORD_LENGTH).max(1024),
  })
  .strict();

export const createInvitationBodySchema = z
  .object({
    expiresInHours: z
      .number()
      .int()
      .min(1)
      .max(MAX_INVITATION_EXPIRY_HOURS)
      .default(DEFAULT_INVITATION_EXPIRY_HOURS),
  })
  .strict();

export const createCoGuardianInvitationSchema = z
  .object({
    expiresInHours: z
      .number()
      .int()
      .min(1)
      .max(MAX_INVITATION_EXPIRY_HOURS)
      .default(DEFAULT_INVITATION_EXPIRY_HOURS),
    studentUserIds: z.array(z.string().trim().regex(UUID_REGEX)).min(1).max(50),
  })
  .strict();

export const claimSchoolInvitationSchema = z
  .object({
    targetWorkspaceId: z.string().trim().regex(UUID_REGEX),
    claimCode: z.string().trim().min(6).max(64),
    familyUsername: z.string().trim().min(2).max(64).optional(),
  })
  .strict();

export const claimCoGuardianInvitationSchema = z
  .object({
    claimCode: z.string().trim().min(6).max(64),
  })
  .strict();

export interface GuardianActorContext {
  userId: string;
  ip?: string;
  ipPrefix: string | null;
}

export interface TeacherInvitationActorContext {
  actorUserId: string;
  organizationId: string;
  teacherMembershipId: string;
  ipPrefix: string | null;
}

export interface AdminInvitationActorContext {
  actorUserId: string;
  ipPrefix: string | null;
}

export interface SafeFamilyWorkspaceView {
  id: string;
  code: string;
  name: string;
  status: string;
  myRole: string;
  memberCount: number;
  studentCount: number;
  createdAt: string;
}

export interface SafeFamilyMemberView {
  membershipId: string;
  guardianUserId: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface SafeFamilyWorkspaceStudentView {
  familyStudentId: string;
  familyWorkspaceId: string;
  studentUserId: string;
  familyUsername: string;
  status: string;
  displayName: string;
  userStatus: string;
  hasSchoolMembership: boolean;
  linkedByCurrentGuardian: boolean;
  currentGuardianLinkId: string | null;
  createdAt: string;
}

export interface SafeGuardianStudentLinkView {
  linkId: string;
  familyWorkspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  studentUserId: string;
  studentDisplayName: string;
  studentStatus: string;
  familyUsername: string | null;
  relationshipStatus: string;
  verificationSource: string;
  sourceOrganizationName: string | null;
  hasSchoolMembership: boolean;
  verifiedAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export type EffectiveInvitationStatus = 'pending' | 'claimed' | 'revoked' | 'expired';

export interface SafeInvitationSharedStudentView {
  studentUserId: string;
  displayName: string;
}

export interface SafeInvitationStatusView {
  id: string;
  invitationType: string;
  status: EffectiveInvitationStatus;
  rawStatus: string;
  expiresAt: string;
  createdByRole: string;
  claimedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  sharedStudents?: SafeInvitationSharedStudentView[];
}

export interface GuardianServiceDeps {
  repo?: GuardianRepository;
  rateLimiter?: InMemoryRateLimiter;
  scryptLimiter?: ScryptConcurrencyLimiter;
  now?: () => Date;
  auditFn?: (
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
  hashPasswordFn?: (password: string) => Promise<string>;
}

function randomFromAlphabet(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function generateWorkspaceCode(): string {
  return `FAM-${randomFromAlphabet(WORKSPACE_CODE_ALPHABET, 6)}`;
}

function generateClaimCode(prefix: 'MIM' | 'CGU'): string {
  return `${prefix}-${randomFromAlphabet(CLAIM_CODE_ALPHABET, 4)}-${randomFromAlphabet(
    CLAIM_CODE_ALPHABET,
    4
  )}-${randomFromAlphabet(CLAIM_CODE_ALPHABET, 4)}`;
}

export function normalizeClaimCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '');
}

function computeEffectiveInvitationStatus(
  inv: LinkInvitationRecord,
  now: Date
): EffectiveInvitationStatus {
  if (inv.status === 'claimed') {
    return 'claimed';
  }
  if (inv.status === 'revoked') {
    return 'revoked';
  }
  if (inv.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'pending';
}

function toSafeInvitationStatusView(
  inv: LinkInvitationRecord,
  now: Date,
  sharedStudents?: SafeInvitationSharedStudentView[]
): SafeInvitationStatusView {
  return {
    id: inv.id,
    invitationType: inv.invitationType,
    status: computeEffectiveInvitationStatus(inv, now),
    rawStatus: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    createdByRole: inv.createdByRole,
    claimedAt: inv.claimedAt ? inv.claimedAt.toISOString() : null,
    revokedAt: inv.revokedAt ? inv.revokedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    ...(sharedStudents ? { sharedStudents } : {}),
  };
}

function assertSafeText(text: string, field: string): void {
  const issues: ApiErrorDetail[] = scanUnsafeSelText(text, field);
  if (issues.length > 0) {
    throw ApiErrors.validation(issues);
  }
}

function toSafeWorkspaceView(
  workspace: FamilyWorkspaceRecord,
  myRole: string,
  memberCount: number,
  studentCount: number
): SafeFamilyWorkspaceView {
  return {
    id: workspace.id,
    code: workspace.code,
    name: workspace.name,
    status: workspace.status,
    myRole,
    memberCount,
    studentCount,
    createdAt: workspace.createdAt.toISOString(),
  };
}

function toSafeMemberView(row: FamilyWorkspaceMemberRecord): SafeFamilyMemberView {
  return {
    membershipId: row.membershipId,
    guardianUserId: row.guardianUserId,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function toSafeWorkspaceStudentView(
  row: FamilyWorkspaceStudentRecord
): SafeFamilyWorkspaceStudentView {
  return {
    familyStudentId: row.familyStudentId,
    familyWorkspaceId: row.familyWorkspaceId,
    studentUserId: row.studentUserId,
    familyUsername: row.familyUsername,
    status: row.status,
    displayName: row.displayName,
    userStatus: row.userStatus,
    hasSchoolMembership: row.hasSchoolMembership,
    linkedByCurrentGuardian: row.linkedByCurrentGuardian,
    currentGuardianLinkId: row.currentGuardianLinkId,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildFallbackFamilyUsername(studentUserId: string): string {
  const cleanSuffix = studentUserId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-10);
  return `hs.${cleanSuffix || 'student'}`;
}

export function createGuardianService(deps?: GuardianServiceDeps) {
  const repo = deps?.repo ?? createGuardianRepository();
  const rateLimiter = deps?.rateLimiter ?? new InMemoryRateLimiter();
  const scryptLimiter = deps?.scryptLimiter ?? new ScryptConcurrencyLimiter();
  const nowFn = deps?.now ?? (() => new Date());
  const auditFn = deps?.auditFn ?? recordAuditEvent;
  const hashPasswordFn = deps?.hashPasswordFn ?? hashPassword;

  async function safeAudit(
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ): Promise<void> {
    try {
      await auditFn(input, executor);
    } catch {
      // Never break business operation if optional mocked audit throws
    }
  }

  function enforceClaimRateLimit(actor: GuardianActorContext): void {
    const nowMs = nowFn().getTime();
    const userLimit = rateLimiter.consume(
      'guardian_claim_user',
      actor.userId,
      10,
      15 * 60 * 1000,
      nowMs
    );
    if (!userLimit.allowed) {
      throw new RateLimitExceededError(userLimit.retryAfterSeconds);
    }
    const ipLimit = rateLimiter.consume(
      'guardian_claim_ip',
      actor.ip ?? actor.ipPrefix ?? 'unknown',
      20,
      15 * 60 * 1000,
      nowMs
    );
    if (!ipLimit.allowed) {
      throw new RateLimitExceededError(ipLimit.retryAfterSeconds);
    }
  }

  async function requireWorkspaceAccess(
    workspaceId: string,
    actor: GuardianActorContext
  ) {
    const membership = await repo.findWorkspaceMembership(workspaceId, actor.userId);
    if (!membership) {
      await safeAudit({
        organizationId: null,
        actorUserId: actor.userId,
        actorRole: 'guardian',
        eventType: 'security.cross_tenant_attempt_blocked',
        targetType: 'family_workspace',
        targetId: UUID_REGEX.test(workspaceId) ? workspaceId : null,
        ipPrefix: actor.ipPrefix,
        metadata: {
          reason: 'not_family_workspace_member',
        },
      });
      throw ApiErrors.forbidden('Bạn không có quyền truy cập không gian gia đình này.');
    }
    return membership;
  }

  return {
    async listWorkspaces(actor: GuardianActorContext) {
      const rows = await repo.listWorkspacesForGuardian(actor.userId);
      return rows.map((row) =>
        toSafeWorkspaceView(
          row.workspace,
          row.membership.role,
          row.memberCount,
          row.studentCount
        )
      );
    },

    async createWorkspace(
      rawInput: unknown,
      actor: GuardianActorContext
    ): Promise<SafeFamilyWorkspaceView> {
      const parsed = createFamilyWorkspaceSchema.parse(rawInput);
      assertSafeText(parsed.name, 'body.name');

      const now = nowFn();
      const workspaceId = generateUuidV7();
      const membershipId = generateUuidV7();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateWorkspaceCode();
        const existingCode = await repo.findWorkspaceByCode(code);
        if (existingCode) {
          continue;
        }

        try {
          const created = await repo.withTransaction(async (tx) => {
            const result = await repo.createFamilyWorkspaceWithOwner(
              {
                workspaceId,
                membershipId,
                code,
                name: parsed.name,
                guardianUserId: actor.userId,
                now,
              },
              tx
            );

            await safeAudit(
              {
                organizationId: null,
                actorUserId: actor.userId,
                actorRole: 'guardian',
                eventType: 'family.workspace_created',
                targetType: 'family_workspace',
                targetId: workspaceId,
                ipPrefix: actor.ipPrefix,
                metadata: {
                  workspaceCode: code,
                },
                createdAt: now,
              },
              tx as unknown as AuditInsertExecutor
            );

            return result;
          });

          return toSafeWorkspaceView(created.workspace, created.membership.role, 1, 0);
        } catch (err) {
          if (isDatabaseError(err)) {
            const appErr = translateDatabaseError(err);
            if (appErr.code === 'CONFLICT_DUPLICATE' && attempt < 4) {
              continue;
            }
            throw appErr;
          }
          throw err;
        }
      }

      throw ApiErrors.internal();
    },

    async getWorkspaceDetail(workspaceId: string, actor: GuardianActorContext) {
      const access = await requireWorkspaceAccess(workspaceId, actor);
      const now = nowFn();
      const [members, students, coGuardianInvitations] = await Promise.all([
        repo.listWorkspaceMembers(workspaceId),
        repo.listWorkspaceStudentsForGuardian(workspaceId, actor.userId),
        repo.listWorkspaceCoGuardianInvitations(workspaceId),
      ]);

      const scopedStudentMap = await repo.listScopedStudentsForInvitations(
        coGuardianInvitations.map((inv) => inv.id)
      );
      const linkedStudentSet = new Set(students.map((s) => s.studentUserId));
      const visibleInvitations = coGuardianInvitations.filter((inv) => {
        if (inv.createdByUserId === actor.userId) return true;
        const shared = scopedStudentMap.get(inv.id) ?? [];
        return (
          shared.length > 0 &&
          shared.every((entry) => linkedStudentSet.has(entry.studentUserId))
        );
      });

      return {
        workspace: toSafeWorkspaceView(
          access.workspace,
          access.membership.role,
          members.length,
          students.length
        ),
        members: members.map(toSafeMemberView),
        students: students.map(toSafeWorkspaceStudentView),
        coGuardianInvitations: visibleInvitations.map((inv) =>
          toSafeInvitationStatusView(inv, now, scopedStudentMap.get(inv.id) ?? [])
        ),
      };
    },

    async createFamilyStudent(
      workspaceId: string,
      rawInput: unknown,
      actor: GuardianActorContext
    ) {
      const parsed = createFamilyStudentSchema.parse(rawInput);
      assertSafeText(parsed.displayName, 'body.displayName');

      const familyUsername = normalizeUsername(parsed.familyUsername);
      validateUsernameFormat(familyUsername, 'body.familyUsername');
      validatePasswordInput(parsed.password);
      if (parsed.password.length < MIN_STUDENT_PASSWORD_LENGTH) {
        throw ApiErrors.validation([
          {
            field: 'body.password',
            code: 'PASSWORD_TOO_SHORT',
            messageKey: 'error.account.password_too_short',
            message: `Mật khẩu học sinh phải có ít nhất ${MIN_STUDENT_PASSWORD_LENGTH} ký tự.`,
          },
        ]);
      }

      const access = await requireWorkspaceAccess(workspaceId, actor);

      const existingUsername = await repo.findFamilyStudentByUsername(
        workspaceId,
        familyUsername
      );
      if (existingUsername) {
        throw ApiErrors.conflict(
          'FAMILY_USERNAME_TAKEN',
          'error.family.username_taken',
          'Tên đăng nhập này đã được sử dụng trong không gian gia đình.'
        );
      }

      const passwordHash = await scryptLimiter.run(() => hashPasswordFn(parsed.password));
      const now = nowFn();
      const studentUserId = generateUuidV7();
      const familyStudentId = generateUuidV7();
      const linkId = generateUuidV7();

      try {
        await repo.withTransaction(async (tx) => {
          const txMembership = await repo.findWorkspaceMembership(
            workspaceId,
            actor.userId,
            tx
          );
          if (!txMembership) {
            throw ApiErrors.forbidden('Bạn không có quyền truy cập không gian gia đình này.');
          }

          const duplicateInTx = await repo.findFamilyStudentByUsername(
            workspaceId,
            familyUsername,
            tx
          );
          if (duplicateInTx) {
            throw ApiErrors.conflict(
              'FAMILY_USERNAME_TAKEN',
              'error.family.username_taken',
              'Tên đăng nhập này đã được sử dụng trong không gian gia đình.'
            );
          }

          await repo.createFamilyStudentAndLink(
            {
              studentUserId,
              displayName: parsed.displayName,
              passwordHash,
              familyStudentId,
              familyWorkspaceId: workspaceId,
              familyUsername,
              linkId,
              guardianUserId: actor.userId,
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.userId,
              actorRole: 'guardian',
              eventType: 'guardian.student_created',
              targetType: 'user',
              targetId: studentUserId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                familyWorkspaceId: workspaceId,
                linkId,
                familyStudentId,
              },
              createdAt: now,
            },
            tx as unknown as AuditInsertExecutor
          );
        });
      } catch (err) {
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }

      return {
        student: {
          userId: studentUserId,
          displayName: parsed.displayName,
          familyUsername,
          familyWorkspaceId: workspaceId,
          workspaceCode: access.workspace.code,
          linkId,
          relationshipStatus: 'active',
          verificationSource: 'family_created',
          status: 'active',
          createdAt: now.toISOString(),
        },
        loginGuide: {
          workspaceCode: access.workspace.code,
          familyUsername,
        },
      };
    },

    async listMyStudents(
      actor: GuardianActorContext,
      options?: { includeRevoked?: boolean }
    ): Promise<SafeGuardianStudentLinkView[]> {
      const rows = await repo.listGuardianStudentLinks(actor.userId, options);
      return rows.map((row) => ({
        linkId: row.linkId,
        familyWorkspaceId: row.familyWorkspaceId,
        workspaceCode: row.workspaceCode,
        workspaceName: row.workspaceName,
        studentUserId: row.studentUserId,
        studentDisplayName: row.studentDisplayName,
        studentStatus: row.studentStatus,
        familyUsername: row.familyUsername,
        relationshipStatus: row.relationshipStatus,
        verificationSource: row.verificationSource,
        sourceOrganizationName: row.sourceOrganizationName,
        hasSchoolMembership: row.hasSchoolMembership,
        verifiedAt: row.verifiedAt.toISOString(),
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async revokeMyLink(linkId: string, actor: GuardianActorContext) {
      const existing = await repo.findGuardianStudentLinkById(linkId);
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy liên kết người giám hộ - học sinh.');
      }
      if (existing.guardianUserId !== actor.userId) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'guardian_student_link',
          targetId: linkId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            reason: 'cannot_revoke_other_guardian_link',
          },
        });
        throw ApiErrors.forbidden('Bạn không thể thu hồi liên kết của người giám hộ khác.');
      }
      if (existing.relationshipStatus !== 'active') {
        throw ApiErrors.conflict(
          'GUARDIAN_LINK_ALREADY_REVOKED',
          'error.guardian.link_already_revoked',
          'Liên kết này đã được thu hồi trước đó.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        const updated = await repo.revokeGuardianStudentLink(
          {
            linkId,
            guardianUserId: actor.userId,
            now,
          },
          tx
        );
        if (!updated) {
          throw ApiErrors.conflict(
            'GUARDIAN_LINK_ALREADY_REVOKED',
            'error.guardian.link_already_revoked',
            'Liên kết này đã được thu hồi trước đó.'
          );
        }

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'guardian.link_revoked',
            targetType: 'guardian_student_link',
            targetId: linkId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              familyWorkspaceId: existing.familyWorkspaceId,
              studentUserId: existing.studentUserId,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        linkId,
        relationshipStatus: 'revoked' as const,
        revokedAt: now.toISOString(),
      };
    },

    async createCoGuardianInvitation(
      workspaceId: string,
      rawInput: unknown,
      actor: GuardianActorContext
    ) {
      const parsed = createCoGuardianInvitationSchema.parse(rawInput ?? {});
      await requireWorkspaceAccess(workspaceId, actor);

      const requestedStudentIds = Array.from(new Set(parsed.studentUserIds));
      const sharedStudents: SafeInvitationSharedStudentView[] = [];

      for (const studentUserId of requestedStudentIds) {
        const activeLink = await repo.findActiveGuardianStudentLink(
          workspaceId,
          actor.userId,
          studentUserId
        );
        const familyStudent = await repo.findFamilyStudentByUser(
          workspaceId,
          studentUserId
        );
        const studentSummary = await repo.findUserSummaryById(studentUserId);

        if (
          !activeLink ||
          !familyStudent ||
          familyStudent.status !== 'active' ||
          !studentSummary ||
          studentSummary.status !== 'active'
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
              reason: 'co_guardian_invite_unlinked_student',
              familyWorkspaceId: workspaceId,
            },
          });
          throw ApiErrors.forbidden(
            'Bạn chỉ có thể chia sẻ những học sinh mà bạn đang trực tiếp liên kết hợp lệ trong không gian gia đình này.'
          );
        }

        sharedStudents.push({
          studentUserId,
          displayName: studentSummary.displayName,
        });
      }

      const now = nowFn();
      const expiresAt = new Date(
        now.getTime() + parsed.expiresInHours * 60 * 60 * 1000
      );
      const claimCode = generateClaimCode('CGU');
      const tokenHash = hashSessionToken(normalizeClaimCode(claimCode));
      const invitationId = generateUuidV7();

      const created = await repo.withTransaction(async (tx) => {
        const record = await repo.createLinkInvitation(
          {
            id: invitationId,
            invitationType: 'co_guardian_invite',
            studentUserId: null,
            sourceOrganizationId: null,
            sourceFamilyWorkspaceId: workspaceId,
            tokenHash,
            status: 'pending',
            expiresAt,
            createdByUserId: actor.userId,
            createdByRole: 'guardian',
            claimedByUserId: null,
            claimedFamilyWorkspaceId: null,
            claimedAt: null,
            revokedByUserId: null,
            revokedAt: null,
            createdAt: now,
          },
          tx
        );

        await repo.addInvitationScopedStudents(
          requestedStudentIds.map((studentUserId) => ({
            id: generateUuidV7(),
            invitationId,
            studentUserId,
            createdAt: now,
          })),
          tx
        );

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'guardian.invitation_created',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'co_guardian_invite',
              familyWorkspaceId: workspaceId,
              scopedStudentCount: requestedStudentIds.length,
              expiresAt: expiresAt.toISOString(),
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return record;
      });

      return {
        invitation: toSafeInvitationStatusView(created, now, sharedStudents),
        claimCode,
      };
    },

    async listCoGuardianInvitations(
      workspaceId: string,
      actor: GuardianActorContext
    ) {
      await requireWorkspaceAccess(workspaceId, actor);
      const now = nowFn();
      const [rows, linkedStudents] = await Promise.all([
        repo.listWorkspaceCoGuardianInvitations(workspaceId),
        repo.listWorkspaceStudentsForGuardian(workspaceId, actor.userId),
      ]);
      const scopedStudentMap = await repo.listScopedStudentsForInvitations(
        rows.map((r) => r.id)
      );
      const linkedSet = new Set(linkedStudents.map((s) => s.studentUserId));

      return rows
        .filter((inv) => {
          if (inv.createdByUserId === actor.userId) return true;
          const shared = scopedStudentMap.get(inv.id) ?? [];
          return (
            shared.length > 0 &&
            shared.every((entry) => linkedSet.has(entry.studentUserId))
          );
        })
        .map((r) =>
          toSafeInvitationStatusView(r, now, scopedStudentMap.get(r.id) ?? [])
        );
    },

    async revokeCoGuardianInvitation(
      workspaceId: string,
      invitationId: string,
      actor: GuardianActorContext
    ) {
      await requireWorkspaceAccess(workspaceId, actor);
      const existing = await repo.findInvitationById(invitationId);
      if (
        !existing ||
        existing.invitationType !== 'co_guardian_invite' ||
        existing.sourceFamilyWorkspaceId !== workspaceId
      ) {
        throw ApiErrors.notFound('Không tìm thấy mã mời đồng giám hộ trong không gian này.');
      }
      if (existing.status !== 'pending') {
        throw ApiErrors.conflict(
          'INVITATION_NOT_PENDING',
          'error.guardian.invitation_not_pending',
          'Mã mời này không còn ở trạng thái chờ xử lý.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        const updated = await repo.revokeLinkInvitation(
          {
            invitationId,
            revokedByUserId: actor.userId,
            now,
          },
          tx
        );
        if (!updated) {
          throw ApiErrors.conflict(
            'INVITATION_NOT_PENDING',
            'error.guardian.invitation_not_pending',
            'Mã mời này không còn ở trạng thái chờ xử lý.'
          );
        }

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'guardian.invitation_revoked',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'co_guardian_invite',
              familyWorkspaceId: workspaceId,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        id: invitationId,
        status: 'revoked' as const,
        revokedAt: now.toISOString(),
      };
    },

    async claimCoGuardianInvitation(
      rawInput: unknown,
      actor: GuardianActorContext
    ) {
      enforceClaimRateLimit(actor);
      const parsed = claimCoGuardianInvitationSchema.parse(rawInput);
      const normalizedCode = normalizeClaimCode(parsed.claimCode);
      const tokenHash = hashSessionToken(normalizedCode);
      const now = nowFn();

      const invitation = await repo.findInvitationByTokenHash(tokenHash);
      if (
        !invitation ||
        invitation.invitationType !== 'co_guardian_invite' ||
        !invitation.sourceFamilyWorkspaceId
      ) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'guardian.invitation_claim_failed',
          targetType: 'student_link_invitation',
          ipPrefix: actor.ipPrefix,
          metadata: {
            invitationType: 'co_guardian_invite',
            reason: 'not_found_or_type_mismatch',
          },
          createdAt: now,
        });
        throw new AppError({
          httpStatus: 400,
          code: 'INVITATION_INVALID_OR_EXPIRED',
          messageKey: 'error.guardian.invitation_invalid_or_expired',
          message: 'Mã mời không hợp lệ, đã được sử dụng hoặc đã hết hạn.',
        });
      }

      if (
        invitation.status !== 'pending' ||
        invitation.expiresAt.getTime() <= now.getTime()
      ) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'guardian.invitation_claim_failed',
          targetType: 'student_link_invitation',
          targetId: invitation.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            invitationType: 'co_guardian_invite',
            reason:
              invitation.status === 'claimed'
                ? 'already_claimed'
                : invitation.status === 'revoked'
                  ? 'revoked'
                  : 'expired',
          },
          createdAt: now,
        });
        throw new AppError({
          httpStatus: 409,
          code: 'INVITATION_INVALID_OR_EXPIRED',
          messageKey: 'error.guardian.invitation_invalid_or_expired',
          message: 'Mã mời không hợp lệ, đã được sử dụng hoặc đã hết hạn.',
        });
      }

      const workspaceId = invitation.sourceFamilyWorkspaceId;
      const existingMember = await repo.findWorkspaceMembership(workspaceId, actor.userId);
      if (existingMember) {
        throw ApiErrors.conflict(
          'ALREADY_WORKSPACE_MEMBER',
          'error.family.already_member',
          'Bạn đã là thành viên của không gian gia đình này.'
        );
      }

      const membershipId = generateUuidV7();
      const linkedStudentCount = await repo.withTransaction(async (tx) => {
        const claimed = await repo.markInvitationClaimed(
          {
            invitationId: invitation.id,
            claimedByUserId: actor.userId,
            claimedFamilyWorkspaceId: workspaceId,
            now,
          },
          tx
        );
        if (!claimed) {
          throw new AppError({
            httpStatus: 409,
            code: 'INVITATION_INVALID_OR_EXPIRED',
            messageKey: 'error.guardian.invitation_invalid_or_expired',
            message: 'Mã mời không hợp lệ, đã được sử dụng hoặc đã hết hạn.',
          });
        }

        await repo.createFamilyMembership(
          {
            id: membershipId,
            familyWorkspaceId: workspaceId,
            guardianUserId: actor.userId,
            role: 'guardian',
            status: 'active',
            invitedByUserId: invitation.createdByUserId,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
          },
          tx
        );

        const scopedStudentIds = await repo.listInvitationScopedStudentIds(
          invitation.id,
          tx
        );
        if (scopedStudentIds.length === 0) {
          throw new AppError({
            httpStatus: 400,
            code: 'INVITATION_INVALID_OR_EXPIRED',
            messageKey: 'error.guardian.invitation_invalid_or_expired',
            message: 'Mã mời đồng giám hộ không có danh sách học sinh được cấp quyền hợp lệ.',
          });
        }

        let newLinks = 0;
        for (const studentUserId of scopedStudentIds) {
          const familyStudent = await repo.findFamilyStudentByUser(
            workspaceId,
            studentUserId,
            tx
          );
          const studentSummary = await repo.findUserSummaryById(studentUserId, tx);
          if (
            !familyStudent ||
            familyStudent.status !== 'active' ||
            !studentSummary ||
            studentSummary.status !== 'active'
          ) {
            continue;
          }

          const existingLink = await repo.findActiveGuardianStudentLink(
            workspaceId,
            actor.userId,
            studentUserId,
            tx
          );
          if (!existingLink) {
            await repo.createGuardianStudentLink(
              {
                id: generateUuidV7(),
                familyWorkspaceId: workspaceId,
                guardianUserId: actor.userId,
                studentUserId,
                relationshipStatus: 'active',
                verificationSource: 'co_guardian_verified',
                sourceOrganizationId: null,
                invitationId: invitation.id,
                verifiedAt: now,
                revokedAt: null,
                revokedByUserId: null,
                createdAt: now,
                updatedAt: now,
              },
              tx
            );
            newLinks += 1;
          }
        }

        await safeAudit(
          {
            organizationId: null,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'family.co_guardian_joined',
            targetType: 'family_workspace',
            targetId: workspaceId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationId: invitation.id,
              membershipId,
              scopedStudentCount: scopedStudentIds.length,
              linkedStudentsAdded: newLinks,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return newLinks;
      });

      return {
        workspaceId,
        membershipId,
        linkedStudentsAdded: linkedStudentCount,
        joinedAt: now.toISOString(),
      };
    },

    async createSchoolStudentInvitationForTeacher(
      studentMembershipId: string,
      rawInput: unknown,
      actor: TeacherInvitationActorContext
    ) {
      const parsed = createInvitationBodySchema.parse(rawInput ?? {});
      const target = await repo.findSchoolStudentByMembershipId(
        actor.organizationId,
        studentMembershipId
      );
      if (!target || target.role !== 'student') {
        throw ApiErrors.notFound('Không tìm thấy hồ sơ học sinh trong trường học này.');
      }

      const sharedClasses = await repo.findSharedActiveClassIds(
        actor.organizationId,
        actor.teacherMembershipId,
        studentMembershipId
      );
      if (sharedClasses.length === 0) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'organization_membership',
          targetId: studentMembershipId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            reason: 'teacher_not_assigned_to_student_class',
          },
        });
        throw ApiErrors.forbidden(
          'Giáo viên chỉ có thể tạo mã liên kết cho học sinh thuộc lớp mình phụ trách.'
        );
      }

      if (target.membershipStatus !== 'active' || target.userStatus !== 'active') {
        throw ApiErrors.conflict(
          'STUDENT_NOT_ACTIVE',
          'error.student.not_active',
          'Tài khoản học sinh hiện không ở trạng thái hoạt động.'
        );
      }

      const now = nowFn();
      const expiresAt = new Date(
        now.getTime() + parsed.expiresInHours * 60 * 60 * 1000
      );
      const claimCode = generateClaimCode('MIM');
      const tokenHash = hashSessionToken(normalizeClaimCode(claimCode));
      const invitationId = generateUuidV7();

      const created = await repo.withTransaction(async (tx) => {
        const record = await repo.createLinkInvitation(
          {
            id: invitationId,
            invitationType: 'school_student_link',
            studentUserId: target.userId,
            sourceOrganizationId: actor.organizationId,
            sourceFamilyWorkspaceId: null,
            tokenHash,
            status: 'pending',
            expiresAt,
            createdByUserId: actor.actorUserId,
            createdByRole: 'teacher',
            claimedByUserId: null,
            claimedFamilyWorkspaceId: null,
            claimedAt: null,
            revokedByUserId: null,
            revokedAt: null,
            createdAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'guardian.invitation_created',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'school_student_link',
              studentUserId: target.userId,
              studentMembershipId,
              expiresAt: expiresAt.toISOString(),
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return record;
      });

      return {
        invitation: toSafeInvitationStatusView(created, now),
        claimCode,
      };
    },

    async listSchoolStudentInvitationsForTeacher(
      studentMembershipId: string,
      actor: TeacherInvitationActorContext
    ): Promise<SafeInvitationStatusView[]> {
      const target = await repo.findSchoolStudentByMembershipId(
        actor.organizationId,
        studentMembershipId
      );
      if (!target || target.role !== 'student') {
        throw ApiErrors.notFound('Không tìm thấy hồ sơ học sinh trong trường học này.');
      }

      const sharedClasses = await repo.findSharedActiveClassIds(
        actor.organizationId,
        actor.teacherMembershipId,
        studentMembershipId
      );
      if (sharedClasses.length === 0) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'organization_membership',
          targetId: studentMembershipId,
          ipPrefix: actor.ipPrefix,
          metadata: {
            reason: 'teacher_not_assigned_to_student_class',
          },
        });
        throw ApiErrors.forbidden(
          'Giáo viên chỉ có thể xem mã liên kết của học sinh thuộc lớp mình phụ trách.'
        );
      }

      const now = nowFn();
      const rows = await repo.listSchoolStudentInvitations({
        studentUserId: target.userId,
        sourceOrganizationId: actor.organizationId,
      });
      return rows.map((r) => toSafeInvitationStatusView(r, now));
    },

    async revokeSchoolStudentInvitationForTeacher(
      invitationId: string,
      actor: TeacherInvitationActorContext
    ) {
      const existing = await repo.findInvitationById(invitationId);
      if (
        !existing ||
        existing.invitationType !== 'school_student_link' ||
        existing.sourceOrganizationId !== actor.organizationId
      ) {
        throw ApiErrors.notFound('Không tìm thấy mã liên kết phụ huynh.');
      }

      if (existing.status !== 'pending') {
        throw ApiErrors.conflict(
          'INVITATION_NOT_PENDING',
          'error.guardian.invitation_not_pending',
          'Mã liên kết không còn ở trạng thái chờ xử lý.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        const updated = await repo.revokeLinkInvitation(
          {
            invitationId,
            revokedByUserId: actor.actorUserId,
            now,
          },
          tx
        );
        if (!updated) {
          throw ApiErrors.conflict(
            'INVITATION_NOT_PENDING',
            'error.guardian.invitation_not_pending',
            'Mã liên kết không còn ở trạng thái chờ xử lý.'
          );
        }

        await safeAudit(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'guardian.invitation_revoked',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'school_student_link',
              studentUserId: existing.studentUserId,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        id: invitationId,
        status: 'revoked' as const,
        revokedAt: now.toISOString(),
      };
    },

    async createSchoolStudentInvitationForAdmin(
      orgId: string,
      studentMembershipId: string,
      rawInput: unknown,
      actor: AdminInvitationActorContext
    ) {
      const parsed = createInvitationBodySchema.parse(rawInput ?? {});
      const target = await repo.findSchoolStudentByMembershipId(
        orgId,
        studentMembershipId
      );
      if (!target || target.role !== 'student') {
        throw ApiErrors.notFound('Không tìm thấy hồ sơ học sinh trong trường học này.');
      }
      if (target.membershipStatus !== 'active' || target.userStatus !== 'active') {
        throw ApiErrors.conflict(
          'STUDENT_NOT_ACTIVE',
          'error.student.not_active',
          'Tài khoản học sinh hiện không ở trạng thái hoạt động.'
        );
      }

      const now = nowFn();
      const expiresAt = new Date(
        now.getTime() + parsed.expiresInHours * 60 * 60 * 1000
      );
      const claimCode = generateClaimCode('MIM');
      const tokenHash = hashSessionToken(normalizeClaimCode(claimCode));
      const invitationId = generateUuidV7();

      const created = await repo.withTransaction(async (tx) => {
        const record = await repo.createLinkInvitation(
          {
            id: invitationId,
            invitationType: 'school_student_link',
            studentUserId: target.userId,
            sourceOrganizationId: orgId,
            sourceFamilyWorkspaceId: null,
            tokenHash,
            status: 'pending',
            expiresAt,
            createdByUserId: actor.actorUserId,
            createdByRole: 'platform_admin',
            claimedByUserId: null,
            claimedFamilyWorkspaceId: null,
            claimedAt: null,
            revokedByUserId: null,
            revokedAt: null,
            createdAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: orgId,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'guardian.invitation_created',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'school_student_link',
              studentUserId: target.userId,
              studentMembershipId,
              expiresAt: expiresAt.toISOString(),
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return record;
      });

      return {
        invitation: toSafeInvitationStatusView(created, now),
        claimCode,
      };
    },

    async listSchoolStudentInvitationsForAdmin(
      orgId: string,
      studentMembershipId: string
    ): Promise<SafeInvitationStatusView[]> {
      const target = await repo.findSchoolStudentByMembershipId(
        orgId,
        studentMembershipId
      );
      if (!target || target.role !== 'student') {
        throw ApiErrors.notFound('Không tìm thấy hồ sơ học sinh trong trường học này.');
      }

      const now = nowFn();
      const rows = await repo.listSchoolStudentInvitations({
        studentUserId: target.userId,
        sourceOrganizationId: orgId,
      });
      return rows.map((r) => toSafeInvitationStatusView(r, now));
    },

    async revokeSchoolStudentInvitationForAdmin(
      orgId: string,
      invitationId: string,
      actor: AdminInvitationActorContext
    ) {
      const existing = await repo.findInvitationById(invitationId);
      if (
        !existing ||
        existing.invitationType !== 'school_student_link' ||
        existing.sourceOrganizationId !== orgId
      ) {
        throw ApiErrors.notFound('Không tìm thấy mã liên kết phụ huynh.');
      }
      if (existing.status !== 'pending') {
        throw ApiErrors.conflict(
          'INVITATION_NOT_PENDING',
          'error.guardian.invitation_not_pending',
          'Mã liên kết không còn ở trạng thái chờ xử lý.'
        );
      }

      const now = nowFn();
      await repo.withTransaction(async (tx) => {
        const updated = await repo.revokeLinkInvitation(
          {
            invitationId,
            revokedByUserId: actor.actorUserId,
            now,
          },
          tx
        );
        if (!updated) {
          throw ApiErrors.conflict(
            'INVITATION_NOT_PENDING',
            'error.guardian.invitation_not_pending',
            'Mã liên kết không còn ở trạng thái chờ xử lý.'
          );
        }

        await safeAudit(
          {
            organizationId: orgId,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'guardian.invitation_revoked',
            targetType: 'student_link_invitation',
            targetId: invitationId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              invitationType: 'school_student_link',
              studentUserId: existing.studentUserId,
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );
      });

      return {
        id: invitationId,
        status: 'revoked' as const,
        revokedAt: now.toISOString(),
      };
    },

    async claimSchoolStudentInvitation(
      rawInput: unknown,
      actor: GuardianActorContext
    ) {
      enforceClaimRateLimit(actor);
      const parsed = claimSchoolInvitationSchema.parse(rawInput);

      let requestedFamilyUsername: string | null = null;
      if (parsed.familyUsername !== undefined) {
        requestedFamilyUsername = normalizeUsername(parsed.familyUsername);
        validateUsernameFormat(requestedFamilyUsername, 'body.familyUsername');
      }

      const access = await requireWorkspaceAccess(parsed.targetWorkspaceId, actor);
      const now = nowFn();
      const tokenHash = hashSessionToken(normalizeClaimCode(parsed.claimCode));
      const invitation = await repo.findInvitationByTokenHash(tokenHash);

      if (
        !invitation ||
        invitation.invitationType !== 'school_student_link' ||
        !invitation.studentUserId
      ) {
        await safeAudit({
          organizationId: null,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'guardian.invitation_claim_failed',
          targetType: 'student_link_invitation',
          ipPrefix: actor.ipPrefix,
          metadata: {
            invitationType: 'school_student_link',
            familyWorkspaceId: parsed.targetWorkspaceId,
            reason: 'not_found_or_type_mismatch',
          },
          createdAt: now,
        });
        throw new AppError({
          httpStatus: 400,
          code: 'INVITATION_INVALID_OR_EXPIRED',
          messageKey: 'error.guardian.invitation_invalid_or_expired',
          message: 'Mã liên kết học sinh không hợp lệ, đã được dùng hoặc đã hết hạn.',
        });
      }

      if (
        invitation.status !== 'pending' ||
        invitation.expiresAt.getTime() <= now.getTime()
      ) {
        await safeAudit({
          organizationId: invitation.sourceOrganizationId,
          actorUserId: actor.userId,
          actorRole: 'guardian',
          eventType: 'guardian.invitation_claim_failed',
          targetType: 'student_link_invitation',
          targetId: invitation.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            invitationType: 'school_student_link',
            familyWorkspaceId: parsed.targetWorkspaceId,
            reason:
              invitation.status === 'claimed'
                ? 'already_claimed'
                : invitation.status === 'revoked'
                  ? 'revoked'
                  : 'expired',
          },
          createdAt: now,
        });
        throw new AppError({
          httpStatus: 409,
          code: 'INVITATION_INVALID_OR_EXPIRED',
          messageKey: 'error.guardian.invitation_invalid_or_expired',
          message: 'Mã liên kết học sinh không hợp lệ, đã được dùng hoặc đã hết hạn.',
        });
      }

      const studentUserId = invitation.studentUserId;
      const linkId = generateUuidV7();
      const familyStudentId = generateUuidV7();

      const result = await repo.withTransaction(async (tx) => {
        const studentUser = await repo.findUserSummaryById(studentUserId, tx);
        if (!studentUser || studentUser.status !== 'active' || studentUser.platformRole !== null) {
          throw ApiErrors.conflict(
            'STUDENT_NOT_ACTIVE',
            'error.student.not_active',
            'Tài khoản học sinh hiện không khả dụng để liên kết.'
          );
        }

        const existingLink = await repo.findActiveGuardianStudentLink(
          parsed.targetWorkspaceId,
          actor.userId,
          studentUserId,
          tx
        );
        if (existingLink) {
          throw ApiErrors.conflict(
            'GUARDIAN_LINK_ALREADY_EXISTS',
            'error.guardian.link_already_exists',
            'Học sinh này đã được liên kết với tài khoản của bạn trong không gian gia đình.'
          );
        }

        const existingFamilyStudent = await repo.findFamilyStudentByUser(
          parsed.targetWorkspaceId,
          studentUserId,
          tx
        );
        const resolvedFamilyUsername =
          existingFamilyStudent?.familyUsername ??
          requestedFamilyUsername ??
          buildFallbackFamilyUsername(studentUserId);

        if (!existingFamilyStudent) {
          const usernameCollision = await repo.findFamilyStudentByUsername(
            parsed.targetWorkspaceId,
            resolvedFamilyUsername,
            tx
          );
          if (usernameCollision && usernameCollision.studentUserId !== studentUserId) {
            throw ApiErrors.conflict(
              'FAMILY_USERNAME_TAKEN',
              'error.family.username_taken',
              'Tên đăng nhập gia đình này đã thuộc về một học sinh khác trong không gian gia đình.'
            );
          }
        }

        const claimed = await repo.markInvitationClaimed(
          {
            invitationId: invitation.id,
            claimedByUserId: actor.userId,
            claimedFamilyWorkspaceId: parsed.targetWorkspaceId,
            now,
          },
          tx
        );
        if (!claimed) {
          throw new AppError({
            httpStatus: 409,
            code: 'INVITATION_INVALID_OR_EXPIRED',
            messageKey: 'error.guardian.invitation_invalid_or_expired',
            message: 'Mã liên kết học sinh không hợp lệ, đã được dùng hoặc đã hết hạn.',
          });
        }

        const familyStudent = await repo.ensureFamilyStudentRecord(
          {
            id: familyStudentId,
            familyWorkspaceId: parsed.targetWorkspaceId,
            studentUserId,
            familyUsername: resolvedFamilyUsername,
            createdByUserId: actor.userId,
            now,
          },
          tx
        );

        await repo.createGuardianStudentLink(
          {
            id: linkId,
            familyWorkspaceId: parsed.targetWorkspaceId,
            guardianUserId: actor.userId,
            studentUserId,
            relationshipStatus: 'active',
            verificationSource: 'school_invitation',
            sourceOrganizationId: invitation.sourceOrganizationId,
            invitationId: invitation.id,
            verifiedAt: now,
            revokedAt: null,
            revokedByUserId: null,
            createdAt: now,
            updatedAt: now,
          },
          tx
        );

        await safeAudit(
          {
            organizationId: invitation.sourceOrganizationId,
            actorUserId: actor.userId,
            actorRole: 'guardian',
            eventType: 'guardian.student_linked',
            targetType: 'guardian_student_link',
            targetId: linkId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              familyWorkspaceId: parsed.targetWorkspaceId,
              studentUserId,
              invitationId: invitation.id,
              verificationSource: 'school_invitation',
            },
            createdAt: now,
          },
          tx as unknown as AuditInsertExecutor
        );

        return {
          linkId,
          studentUserId,
          studentDisplayName: studentUser.displayName,
          familyWorkspaceId: parsed.targetWorkspaceId,
          workspaceCode: access.workspace.code,
          workspaceName: access.workspace.name,
          familyUsername: familyStudent.familyUsername,
          verificationSource: 'school_invitation',
          verifiedAt: now.toISOString(),
        };
      });

      return result;
    },
  };
}

export type GuardianService = ReturnType<typeof createGuardianService>;
