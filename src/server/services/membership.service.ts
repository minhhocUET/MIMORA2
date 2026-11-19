import { getServerConfig, type ServerConfig } from '../config/env.ts';
import type { OrgRole } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError, isDatabaseError, translateDatabaseError } from '../http/errors.ts';
import {
  createMembershipRepository,
  type MembershipDbOrTx,
  type MembershipRepository,
  type MembershipStatus,
  type OrganizationMembershipRecord,
  type OrganizationMembershipWithUserRecord,
  type SafeUserRecord,
  type UserStatus,
} from '../repositories/membership.repository.ts';
import { hashPassword, validatePasswordInput } from '../security/password-hash.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import {
  recordAuditEvent,
  type AuditActorRole,
  type AuditInsertExecutor,
} from './audit.service.ts';

export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsernameFormat(
  normalized: string,
  field: string
): void {
  if (normalized.includes('@') || !USERNAME_REGEX.test(normalized)) {
    throw ApiErrors.validation([
      {
        field,
        code: 'INVALID_FORMAT',
        messageKey: 'error.account.invalid_username',
        message:
          'Tên đăng nhập chỉ được gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới (2-64 ký tự) và không chứa @.',
      },
    ]);
  }
}

export interface SafeUserView {
  id: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: 'platform_admin' | null;
  displayName: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeMembershipView {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  orgUsername: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    email: string | null;
    platformUsername: string | null;
    displayName: string;
    status: string;
  };
}

function toSafeUserView(row: SafeUserRecord): SafeUserView {
  return {
    id: row.id,
    email: row.email,
    platformUsername: row.platformUsername,
    platformRole: row.platformRole === 'platform_admin' ? 'platform_admin' : null,
    displayName: row.displayName,
    status: row.status,
    failedLoginAttempts: row.failedLoginAttempts,
    lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSafeMembershipView(
  m: OrganizationMembershipRecord,
  user?: OrganizationMembershipWithUserRecord['user']
): SafeMembershipView {
  return {
    id: m.id,
    organizationId: m.organizationId,
    userId: m.userId,
    role: m.role === 'teacher' ? 'teacher' : 'student',
    orgUsername: m.orgUsername,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    ...(user ? { user } : {}),
  };
}

export interface ProvisionUserInput {
  role: OrgRole;
  organizationId: string;
  displayName: string;
  password: string;
  email?: string | null;
  platformUsername?: string | null;
  orgUsername?: string | null;
  classId?: string;
}

export interface MembershipActorContext {
  actorUserId: string;
  actorRole: AuditActorRole;
  ipPrefix: string | null;
}

export interface MembershipServiceDeps {
  repo?: MembershipRepository;
  scryptLimiter?: ScryptConcurrencyLimiter;
  getConfig?: () => ServerConfig;
  now?: () => Date;
  hashPasswordFn?: typeof hashPassword;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createMembershipService(deps?: MembershipServiceDeps) {
  const repo = deps?.repo ?? createMembershipRepository();
  const getConfig = deps?.getConfig ?? getServerConfig;
  const scryptLimiter =
    deps?.scryptLimiter ??
    new ScryptConcurrencyLimiter({
      maxConcurrent: getConfig().auth.scryptMaxConcurrent,
      maxQueue: getConfig().auth.scryptMaxQueue,
    });
  const nowFn = deps?.now ?? (() => new Date());
  const hashPwd = deps?.hashPasswordFn ?? hashPassword;
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: MembershipDbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  return {
    async listUsers(params: {
      page: number;
      limit: number;
      status?: UserStatus;
      platformRole?: 'platform_admin';
      search?: string;
    }) {
      const result = await repo.listUsers(params);
      return {
        items: result.items.map(toSafeUserView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getUserById(userId: string): Promise<{
      user: SafeUserView;
      memberships: SafeMembershipView[];
    }> {
      const user = await repo.findUserById(userId);
      if (!user) {
        throw ApiErrors.notFound('Không tìm thấy tài khoản người dùng.');
      }
      const memberships = await repo.findMembershipsByUserId(userId);
      return {
        user: toSafeUserView(user),
        memberships: memberships.map((m) => toSafeMembershipView(m)),
      };
    },

    async provisionAccount(
      input: ProvisionUserInput,
      actor: MembershipActorContext
    ): Promise<{
      user: SafeUserView;
      membership: SafeMembershipView;
      enrolledClassId: string | null;
    }> {
      if (actor.actorRole !== 'platform_admin') {
        throw ApiErrors.forbidden('Chỉ quản trị viên nền tảng mới có quyền tạo tài khoản này.');
      }

      const displayName = input.displayName.trim();
      const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
      const normalizedPlatformUsername = input.platformUsername
        ? normalizeUsername(input.platformUsername)
        : null;
      const normalizedOrgUsername = input.orgUsername
        ? normalizeUsername(input.orgUsername)
        : null;

      if (normalizedPlatformUsername !== null) {
        validateUsernameFormat(normalizedPlatformUsername, 'body.platformUsername');
      }
      if (normalizedOrgUsername !== null) {
        validateUsernameFormat(normalizedOrgUsername, 'body.orgUsername');
      }

      if (input.role === 'teacher') {
        if (!normalizedEmail && !normalizedPlatformUsername) {
          throw ApiErrors.validation([
            {
              field: 'body.email',
              code: 'REQUIRED',
              messageKey: 'error.account.teacher_identifier_required',
              message:
                'Tài khoản giáo viên cần có ít nhất email hoặc tên đăng nhập nền tảng.',
            },
          ]);
        }
        if (input.classId) {
          throw ApiErrors.validation([
            {
              field: 'body.classId',
              code: 'UNSUPPORTED_FOR_ROLE',
              messageKey: 'error.account.class_id_student_only',
              message: 'Chỉ tài khoản học sinh mới được ghi danh lớp khi khởi tạo.',
            },
          ]);
        }
      }

      if (input.role === 'student' && !normalizedOrgUsername) {
        throw ApiErrors.validation([
          {
            field: 'body.orgUsername',
            code: 'REQUIRED',
            messageKey: 'error.account.student_org_username_required',
            message: 'Tài khoản học sinh bắt buộc có tên đăng nhập trong trường học.',
          },
        ]);
      }

      try {
        validatePasswordInput(input.password);
      } catch {
        throw ApiErrors.validation([
          {
            field: 'body.password',
            code: 'INVALID_PASSWORD',
            messageKey: 'error.account.invalid_password',
            message: 'Mật khẩu không hợp lệ.',
          },
        ]);
      }

      const passwordHash = await scryptLimiter.run(() => hashPwd(input.password));
      const now = nowFn();
      const userId = generateUuidV7();
      const membershipId = generateUuidV7();
      const enrollmentId = input.classId ? generateUuidV7() : null;

      try {
        const result = await repo.withTransaction(async (tx) => {
          const org = await repo.findOrganizationById(input.organizationId, tx);
          if (!org) {
            throw ApiErrors.notFound('Không tìm thấy tổ chức.');
          }
          if (org.status !== 'active') {
            throw ApiErrors.conflict(
              'ORGANIZATION_NOT_ACTIVE',
              'error.org.not_active',
              'Tổ chức đang tạm ngưng, không thể tạo tài khoản mới.'
            );
          }

          if (normalizedEmail) {
            const existingEmail = await repo.findUserByEmail(normalizedEmail, tx);
            if (existingEmail) {
              throw ApiErrors.conflict(
                'EMAIL_ALREADY_EXISTS',
                'error.account.email_exists',
                'Email đã tồn tại trong hệ thống.'
              );
            }
          }

          if (normalizedPlatformUsername) {
            const existingPlatform = await repo.findUserByPlatformUsername(
              normalizedPlatformUsername,
              tx
            );
            if (existingPlatform) {
              throw ApiErrors.conflict(
                'PLATFORM_USERNAME_EXISTS',
                'error.account.platform_username_exists',
                'Tên đăng nhập nền tảng đã tồn tại.'
              );
            }
          }

          if (normalizedOrgUsername) {
            const existingOrgUser = await repo.findMembershipByOrgAndUsername(
              org.id,
              normalizedOrgUsername,
              tx
            );
            if (existingOrgUser) {
              throw ApiErrors.conflict(
                'ORG_USERNAME_EXISTS',
                'error.account.org_username_exists',
                'Tên đăng nhập đã tồn tại trong trường học này.'
              );
            }
          }

          if (input.classId) {
            const cls = await repo.findClassInOrg(org.id, input.classId, tx);
            if (!cls) {
              throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức này.');
            }
            if (cls.status !== 'active') {
              throw ApiErrors.conflict(
                'CLASS_NOT_ACTIVE',
                'error.class.not_active',
                'Lớp học không ở trạng thái hoạt động.'
              );
            }
          }

          const createdUser = await repo.createUser(
            {
              id: userId,
              email: normalizedEmail,
              platformUsername: normalizedPlatformUsername,
              platformRole: null,
              displayName,
              passwordHash,
              status: 'active',
              now,
            },
            tx
          );

          const createdMembership = await repo.createMembership(
            {
              id: membershipId,
              organizationId: org.id,
              userId: createdUser.id,
              role: input.role,
              orgUsername: normalizedOrgUsername,
              status: 'active',
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          if (input.classId && enrollmentId) {
            await repo.createClassEnrollment(
              {
                id: enrollmentId,
                organizationId: org.id,
                classId: input.classId,
                studentMembershipId: createdMembership.id,
                enrolledAt: now,
                updatedByUserId: actor.actorUserId,
              },
              tx
            );
          }

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'account.created',
              targetType: 'user',
              targetId: createdUser.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                role: input.role,
                hasEmail: normalizedEmail !== null,
              },
            },
            tx
          );

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.created',
              targetType: 'organization_membership',
              targetId: createdMembership.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                role: input.role,
                status: 'active',
              },
            },
            tx
          );

          if (input.classId && enrollmentId) {
            await safeAudit(
              {
                organizationId: org.id,
                actorUserId: actor.actorUserId,
                actorRole: actor.actorRole,
                eventType: 'membership.student_enrolled',
                targetType: 'class_enrollment',
                targetId: enrollmentId,
                ipPrefix: actor.ipPrefix,
                metadata: {
                  classId: input.classId,
                  studentMembershipId: createdMembership.id,
                },
              },
              tx
            );
          }

          return {
            user: toSafeUserView(createdUser),
            membership: toSafeMembershipView(createdMembership),
            enrolledClassId: input.classId ?? null,
          };
        });

        return result;
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

    async provisionStudentInAssignedClass(
      input: {
        organizationId: string;
        classId: string;
        teacherMembershipId: string;
        displayName: string;
        orgUsername: string;
        password: string;
        email?: string | null;
      },
      actor: MembershipActorContext
    ): Promise<{
      user: SafeUserView;
      membership: SafeMembershipView;
      enrolledClassId: string;
    }> {
      const normalizedOrgUsername = normalizeUsername(input.orgUsername);
      validateUsernameFormat(normalizedOrgUsername, 'body.orgUsername');
      const normalizedEmail = input.email ? normalizeEmail(input.email) : null;

      try {
        validatePasswordInput(input.password);
      } catch {
        throw ApiErrors.validation([
          {
            field: 'body.password',
            code: 'INVALID_PASSWORD',
            messageKey: 'error.account.invalid_password',
            message: 'Mật khẩu không hợp lệ.',
          },
        ]);
      }

      const passwordHash = await scryptLimiter.run(() => hashPwd(input.password));
      const now = nowFn();
      const userId = generateUuidV7();
      const membershipId = generateUuidV7();
      const enrollmentId = generateUuidV7();

      try {
        return await repo.withTransaction(async (tx) => {
          const org = await repo.findOrganizationById(input.organizationId, tx);
          if (!org || org.status !== 'active') {
            throw ApiErrors.forbidden('Tổ chức không khả dụng.');
          }

          const cls = await repo.findClassInOrg(org.id, input.classId, tx);
          if (!cls) {
            await safeAudit({
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'security.cross_tenant_attempt_blocked',
              targetType: 'class',
              targetId: input.classId,
              ipPrefix: actor.ipPrefix,
              metadata: { action: 'provision_student_class_not_in_org' },
            }).catch(() => undefined);
            throw ApiErrors.forbidden('Bạn không có quyền truy cập lớp học này.');
          }

          const isAssigned = await repo.isTeacherAssignedToClass(
            org.id,
            cls.id,
            input.teacherMembershipId,
            tx
          );
          if (!isAssigned) {
            await safeAudit({
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'security.unauthorized_access_denied',
              targetType: 'class',
              targetId: cls.id,
              ipPrefix: actor.ipPrefix,
              metadata: { action: 'provision_student_unassigned_class' },
            }).catch(() => undefined);
            throw ApiErrors.forbidden(
              'Bạn chỉ được tạo tài khoản học sinh trong lớp học được phân công.'
            );
          }

          if (cls.status !== 'active') {
            throw ApiErrors.conflict(
              'CLASS_NOT_ACTIVE',
              'error.class.not_active',
              'Lớp học không ở trạng thái hoạt động.'
            );
          }

          if (normalizedEmail) {
            const existingEmail = await repo.findUserByEmail(normalizedEmail, tx);
            if (existingEmail) {
              throw ApiErrors.conflict(
                'EMAIL_ALREADY_EXISTS',
                'error.account.email_exists',
                'Email đã tồn tại trong hệ thống.'
              );
            }
          }

          const existingOrgUsername = await repo.findMembershipByOrgAndUsername(
            org.id,
            normalizedOrgUsername,
            tx
          );
          if (existingOrgUsername) {
            throw ApiErrors.conflict(
              'ORG_USERNAME_EXISTS',
              'error.account.org_username_exists',
              'Tên đăng nhập đã tồn tại trong trường học này.'
            );
          }

          const createdUser = await repo.createUser(
            {
              id: userId,
              email: normalizedEmail,
              platformUsername: null,
              platformRole: null,
              displayName: input.displayName.trim(),
              passwordHash,
              status: 'active',
              now,
            },
            tx
          );

          const createdMembership = await repo.createMembership(
            {
              id: membershipId,
              organizationId: org.id,
              userId: createdUser.id,
              role: 'student',
              orgUsername: normalizedOrgUsername,
              status: 'active',
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          await repo.createClassEnrollment(
            {
              id: enrollmentId,
              organizationId: org.id,
              classId: cls.id,
              studentMembershipId: createdMembership.id,
              enrolledAt: now,
              updatedByUserId: actor.actorUserId,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'account.created',
              targetType: 'user',
              targetId: createdUser.id,
              ipPrefix: actor.ipPrefix,
              metadata: { role: 'student', viaClassId: cls.id },
            },
            tx
          );

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.created',
              targetType: 'organization_membership',
              targetId: createdMembership.id,
              ipPrefix: actor.ipPrefix,
              metadata: { role: 'student', status: 'active' },
            },
            tx
          );

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.student_enrolled',
              targetType: 'class_enrollment',
              targetId: enrollmentId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                classId: cls.id,
                studentMembershipId: createdMembership.id,
              },
            },
            tx
          );

          return {
            user: toSafeUserView(createdUser),
            membership: toSafeMembershipView(createdMembership),
            enrolledClassId: cls.id,
          };
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

    async updateUser(
      userId: string,
      input: { displayName?: string; email?: string | null; status?: UserStatus },
      actor: MembershipActorContext
    ): Promise<SafeUserView> {
      if (
        input.displayName === undefined &&
        input.email === undefined &&
        input.status === undefined
      ) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật.',
          },
        ]);
      }

      const normalizedEmail =
        input.email === undefined
          ? undefined
          : input.email === null
            ? null
            : normalizeEmail(input.email);
      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findUserById(userId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy tài khoản người dùng.');
          }

          if (normalizedEmail && normalizedEmail !== existing.email) {
            const conflict = await repo.findUserByEmail(normalizedEmail, tx);
            if (conflict && conflict.id !== existing.id) {
              throw ApiErrors.conflict(
                'EMAIL_ALREADY_EXISTS',
                'error.account.email_exists',
                'Email đã tồn tại trong hệ thống.'
              );
            }
          }

          const unlocking =
            input.status === 'active' &&
            (existing.status === 'locked' || existing.lockedUntil !== null);
          const next = await repo.updateUser(
            {
              id: userId,
              displayName:
                input.displayName !== undefined ? input.displayName.trim() : undefined,
              email: normalizedEmail,
              status: input.status,
              resetLockout: unlocking,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy tài khoản người dùng.');
          }

          if (input.status === 'disabled' || input.status === 'locked') {
            await repo.revokeSessionsForUser(userId, `account_${input.status}`, now, tx);
          }

          const eventType =
            input.status === 'disabled' && existing.status !== 'disabled'
              ? 'account.disabled'
              : input.status === 'locked' && existing.status !== 'locked'
                ? 'auth.account_locked'
                : unlocking
                  ? 'auth.account_unlocked'
                  : 'account.updated';

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType,
              targetType: 'user',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                previousStatus: existing.status,
                status: next.status,
              },
            },
            tx
          );

          return next;
        });

        return toSafeUserView(updated);
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

    async listOrganizationMemberships(params: {
      organizationId: string;
      page: number;
      limit: number;
      role?: OrgRole;
      status?: MembershipStatus;
      search?: string;
    }) {
      const org = await repo.findOrganizationById(params.organizationId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }

      const result = await repo.listOrganizationMemberships(params);
      return {
        items: result.items.map((row) => toSafeMembershipView(row.membership, row.user)),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async createOrganizationMembership(
      input: {
        organizationId: string;
        userId: string;
        role: OrgRole;
        orgUsername?: string | null;
      },
      actor: MembershipActorContext
    ): Promise<SafeMembershipView> {
      const normalizedOrgUsername = input.orgUsername
        ? normalizeUsername(input.orgUsername)
        : null;
      if (normalizedOrgUsername !== null) {
        validateUsernameFormat(normalizedOrgUsername, 'body.orgUsername');
      }
      if (input.role === 'student' && !normalizedOrgUsername) {
        throw ApiErrors.validation([
          {
            field: 'body.orgUsername',
            code: 'REQUIRED',
            messageKey: 'error.account.student_org_username_required',
            message: 'Thành viên học sinh bắt buộc có tên đăng nhập trong trường học.',
          },
        ]);
      }

      const now = nowFn();
      const membershipId = generateUuidV7();

      try {
        const created = await repo.withTransaction(async (tx) => {
          const org = await repo.findOrganizationById(input.organizationId, tx);
          if (!org) {
            throw ApiErrors.notFound('Không tìm thấy tổ chức.');
          }
          if (org.status !== 'active') {
            throw ApiErrors.conflict(
              'ORGANIZATION_NOT_ACTIVE',
              'error.org.not_active',
              'Tổ chức đang tạm ngưng, không thể thêm thành viên.'
            );
          }

          const user = await repo.findUserById(input.userId, tx);
          if (!user) {
            throw ApiErrors.notFound('Không tìm thấy tài khoản người dùng.');
          }
          if (user.platformRole !== null) {
            throw ApiErrors.conflict(
              'PLATFORM_ADMIN_MEMBERSHIP_DISALLOWED',
              'error.membership.platform_admin_disallowed',
              'Tài khoản quản trị viên nền tảng hoặc người giám hộ không thể gắn làm thành viên trường học.'
            );
          }
          if (user.status !== 'active') {
            throw ApiErrors.conflict(
              'USER_NOT_ACTIVE',
              'error.account.not_active',
              'Tài khoản người dùng không ở trạng thái hoạt động.'
            );
          }

          const sameOrgExisting = await repo.findMembershipByOrgAndUser(
            org.id,
            user.id,
            tx
          );
          if (sameOrgExisting) {
            throw ApiErrors.conflict(
              'MEMBERSHIP_ALREADY_EXISTS',
              'error.membership.already_exists',
              'Người dùng đã có tư cách thành viên trong tổ chức này.'
            );
          }

          const allUserMemberships = await repo.findMembershipsByUserId(user.id, tx);
          // Cross-organization student transfer policy is deferred by PO (Section 4.E).
          if (input.role === 'student' && allUserMemberships.length > 0) {
            throw ApiErrors.conflict(
              'STUDENT_TRANSFER_POLICY_DEFERRED',
              'error.membership.student_transfer_deferred',
              'Chính sách chuyển trường hoặc tái sử dụng tài khoản học sinh giữa các trường chưa được phê duyệt.'
            );
          }
          if (
            input.role === 'teacher' &&
            allUserMemberships.some((m) => m.role === 'student')
          ) {
            throw ApiErrors.conflict(
              'ROLE_CONFLICT',
              'error.membership.role_conflict',
              'Không thể gán vai trò giáo viên cho tài khoản đang là học sinh.'
            );
          }

          if (normalizedOrgUsername) {
            const usernameConflict = await repo.findMembershipByOrgAndUsername(
              org.id,
              normalizedOrgUsername,
              tx
            );
            if (usernameConflict) {
              throw ApiErrors.conflict(
                'ORG_USERNAME_EXISTS',
                'error.account.org_username_exists',
                'Tên đăng nhập đã tồn tại trong trường học này.'
              );
            }
          }

          const membership = await repo.createMembership(
            {
              id: membershipId,
              organizationId: org.id,
              userId: user.id,
              role: input.role,
              orgUsername: normalizedOrgUsername,
              status: 'active',
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: org.id,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.created',
              targetType: 'organization_membership',
              targetId: membership.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                role: input.role,
                status: 'active',
              },
            },
            tx
          );

          return membership;
        });

        return toSafeMembershipView(created);
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

    async updateOrganizationMembership(
      organizationId: string,
      membershipId: string,
      input: { orgUsername?: string | null; status?: MembershipStatus },
      actor: MembershipActorContext
    ): Promise<SafeMembershipView> {
      if (input.orgUsername === undefined && input.status === undefined) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật.',
          },
        ]);
      }

      if (input.status === 'transferred') {
        throw ApiErrors.conflict(
          'STUDENT_TRANSFER_POLICY_DEFERRED',
          'error.membership.student_transfer_deferred',
          'Chính sách chuyển trường đang chờ Product Owner phê duyệt.'
        );
      }

      const nextStatus: 'active' | 'disabled' | undefined = input.status;

      const normalizedOrgUsername =
        input.orgUsername === undefined
          ? undefined
          : input.orgUsername === null
            ? null
            : normalizeUsername(input.orgUsername);

      if (normalizedOrgUsername !== undefined && normalizedOrgUsername !== null) {
        validateUsernameFormat(normalizedOrgUsername, 'body.orgUsername');
      }

      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findMembershipById(
            organizationId,
            membershipId,
            tx
          );
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy tư cách thành viên trong tổ chức.');
          }

          if (
            existing.membership.role === 'student' &&
            normalizedOrgUsername === null
          ) {
            throw ApiErrors.validation([
              {
                field: 'body.orgUsername',
                code: 'REQUIRED',
                messageKey: 'error.account.student_org_username_required',
                message: 'Thành viên học sinh bắt buộc phải có tên đăng nhập trong trường học.',
              },
            ]);
          }

          if (
            normalizedOrgUsername &&
            normalizedOrgUsername !== existing.membership.orgUsername
          ) {
            const usernameConflict = await repo.findMembershipByOrgAndUsername(
              organizationId,
              normalizedOrgUsername,
              tx
            );
            if (usernameConflict && usernameConflict.id !== membershipId) {
              throw ApiErrors.conflict(
                'ORG_USERNAME_EXISTS',
                'error.account.org_username_exists',
                'Tên đăng nhập đã tồn tại trong trường học này.'
              );
            }
          }

          const next = await repo.updateMembership(
            {
              organizationId,
              membershipId,
              orgUsername: normalizedOrgUsername,
              status: nextStatus,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy tư cách thành viên trong tổ chức.');
          }

          if (input.status === 'disabled') {
            await repo.revokeSessionsForUserInOrg(
              organizationId,
              existing.membership.userId,
              'membership_disabled',
              now,
              tx
            );
          }

          await safeAudit(
            {
              organizationId,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.status_changed',
              targetType: 'organization_membership',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                previousStatus: existing.membership.status,
                status: next.status,
                usernameUpdated: normalizedOrgUsername !== undefined,
              },
            },
            tx
          );

          return { next, user: existing.user };
        });

        return toSafeMembershipView(updated.next, updated.user);
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
  };
}

export type MembershipService = ReturnType<typeof createMembershipService>;
