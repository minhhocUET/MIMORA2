import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError, isDatabaseError, translateDatabaseError } from '../http/errors.ts';
import {
  createClassRepository,
  type ClassDbOrTx,
  type ClassRecord,
  type ClassRepository,
  type ClassStatus,
  type ClassStudentRosterRecord,
  type ClassTeacherEntryRecord,
  type EnrollmentEndStatus,
} from '../repositories/class.repository.ts';
import { recordAuditEvent, type AuditActorRole, type AuditInsertExecutor } from './audit.service.ts';

export interface SafeClassView {
  id: string;
  organizationId: string;
  name: string;
  academicYear: string | null;
  status: ClassStatus;
  createdAt: string;
  updatedAt: string;
}

function toSafeClassView(row: ClassRecord): SafeClassView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    academicYear: row.academicYear,
    status: row.status === 'archived' ? 'archived' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ClassActorContext {
  actorUserId: string;
  actorRole: AuditActorRole;
  ipPrefix: string | null;
}

export interface ClassServiceDeps {
  repo?: ClassRepository;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createClassService(deps?: ClassServiceDeps) {
  const repo = deps?.repo ?? createClassRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: ClassDbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  return {
    async listOrgClasses(params: {
      organizationId: string;
      page: number;
      limit: number;
      status?: ClassStatus;
      search?: string;
    }) {
      const org = await repo.findOrganizationById(params.organizationId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }

      const result = await repo.listClassesInOrg(params);
      return {
        items: result.items.map(toSafeClassView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getOrgClassDetail(organizationId: string, classId: string) {
      const cls = await repo.findClassByIdInOrg(organizationId, classId);
      if (!cls) {
        throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức.');
      }
      const [teachers, students] = await Promise.all([
        repo.listClassTeachers(organizationId, classId),
        repo.listActiveClassStudents(organizationId, classId),
      ]);

      return {
        class: toSafeClassView(cls),
        teachers: teachers.map((t) => ({
          assignmentId: t.assignmentId,
          teacherMembershipId: t.teacherMembershipId,
          userId: t.userId,
          displayName: t.displayName,
          email: t.email,
          membershipStatus: t.membershipStatus,
          assignedAt: t.assignedAt.toISOString(),
        })),
        students: students.map((s) => ({
          enrollmentId: s.enrollmentId,
          studentMembershipId: s.studentMembershipId,
          userId: s.userId,
          orgUsername: s.orgUsername,
          displayName: s.displayName,
          enrollmentStatus: s.enrollmentStatus,
          membershipStatus: s.membershipStatus,
          enrolledAt: s.enrolledAt.toISOString(),
        })),
      };
    },

    async createClass(
      organizationId: string,
      input: { name: string; academicYear?: string | null },
      actor: ClassActorContext
    ): Promise<SafeClassView> {
      const now = nowFn();
      const classId = generateUuidV7();
      const name = input.name.trim();
      const academicYear = input.academicYear?.trim() || null;

      try {
        const created = await repo.withTransaction(async (tx) => {
          const org = await repo.findOrganizationById(organizationId, tx);
          if (!org) {
            throw ApiErrors.notFound('Không tìm thấy tổ chức.');
          }
          if (org.status !== 'active') {
            throw ApiErrors.conflict(
              'ORGANIZATION_NOT_ACTIVE',
              'error.org.not_active',
              'Tổ chức đang tạm ngưng, không thể tạo lớp học.'
            );
          }

          const cls = await repo.createClass(
            {
              id: classId,
              organizationId: org.id,
              name,
              academicYear,
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
              targetType: 'class',
              targetId: cls.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                entity: 'class',
                action: 'created',
                status: cls.status,
              },
            },
            tx
          );

          return cls;
        });

        return toSafeClassView(created);
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

    async updateClass(
      organizationId: string,
      classId: string,
      input: { name?: string; academicYear?: string | null; status?: ClassStatus },
      actor: ClassActorContext
    ): Promise<SafeClassView> {
      if (
        input.name === undefined &&
        input.academicYear === undefined &&
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

      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findClassByIdInOrg(organizationId, classId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức.');
          }

          const next = await repo.updateClass(
            {
              organizationId,
              classId,
              name: input.name !== undefined ? input.name.trim() : undefined,
              academicYear:
                input.academicYear === undefined
                  ? undefined
                  : input.academicYear === null
                    ? null
                    : input.academicYear.trim() || null,
              status: input.status,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức.');
          }

          await safeAudit(
            {
              organizationId,
              actorUserId: actor.actorUserId,
              actorRole: actor.actorRole,
              eventType: 'membership.status_changed',
              targetType: 'class',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                entity: 'class',
                action:
                  input.status && input.status !== existing.status
                    ? `status_${next.status}`
                    : 'updated',
                previousStatus: existing.status,
                status: next.status,
              },
            },
            tx
          );

          return next;
        });

        return toSafeClassView(updated);
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

    async setClassTeachers(
      organizationId: string,
      classId: string,
      teacherMembershipIds: string[],
      actor: ClassActorContext
    ): Promise<{
      classId: string;
      teachers: Array<{
        assignmentId: string;
        teacherMembershipId: string;
        userId: string;
        displayName: string;
        email: string | null;
        membershipStatus: string;
        assignedAt: string;
      }>;
    }> {
      const uniqueIds = Array.from(new Set(teacherMembershipIds));
      const now = nowFn();

      try {
        const teachers = await repo.withTransaction(async (tx) => {
          const cls = await repo.findClassByIdInOrg(organizationId, classId, tx);
          if (!cls) {
            throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức.');
          }
          if (uniqueIds.length > 0 && cls.status !== 'active') {
            throw ApiErrors.conflict(
              'CLASS_NOT_ACTIVE',
              'error.class.not_active',
              'Không thể phân công giáo viên cho lớp đã lưu trữ.'
            );
          }

          if (uniqueIds.length > 0) {
            const foundMemberships = await repo.findMembershipsInOrgByIds(
              organizationId,
              uniqueIds,
              tx
            );
            const byId = new Map(foundMemberships.map((m) => [m.id, m]));

            for (const reqId of uniqueIds) {
              const m = byId.get(reqId);
              if (!m) {
                throw ApiErrors.conflict(
                  'TEACHER_MEMBERSHIP_NOT_IN_ORG',
                  'error.class.teacher_not_in_org',
                  'Giáo viên được chọn không thuộc tổ chức này.'
                );
              }
              if (m.role !== 'teacher') {
                throw ApiErrors.conflict(
                  'INVALID_TEACHER_ROLE',
                  'error.class.invalid_teacher_role',
                  'Chỉ thành viên có vai trò giáo viên mới được phân công phụ trách lớp.'
                );
              }
              if (m.status !== 'active' || m.userStatus !== 'active') {
                throw ApiErrors.conflict(
                  'TEACHER_MEMBERSHIP_NOT_ACTIVE',
                  'error.class.teacher_not_active',
                  'Tài khoản giáo viên hoặc tư cách thành viên không ở trạng thái hoạt động.'
                );
              }
            }
          }

          const current = await repo.listClassTeachers(organizationId, classId, tx);
          const currentIds = new Set(current.map((t) => t.teacherMembershipId));
          const targetIds = new Set(uniqueIds);

          const toAdd = uniqueIds.filter((id) => !currentIds.has(id));
          const toRemove = current
            .map((t) => t.teacherMembershipId)
            .filter((id) => !targetIds.has(id));

          if (toAdd.length > 0) {
            await repo.insertClassTeachers(
              toAdd.map((teacherMembershipId) => ({
                id: generateUuidV7(),
                organizationId,
                classId,
                teacherMembershipId,
                assignedByUserId: actor.actorUserId,
                createdAt: now,
              })),
              tx
            );

            for (const teacherMembershipId of toAdd) {
              await safeAudit(
                {
                  organizationId,
                  actorUserId: actor.actorUserId,
                  actorRole: actor.actorRole,
                  eventType: 'membership.class_teacher_assigned',
                  targetType: 'class',
                  targetId: classId,
                  ipPrefix: actor.ipPrefix,
                  metadata: { teacherMembershipId },
                },
                tx
              );
            }
          }

          if (toRemove.length > 0) {
            await repo.deleteClassTeachersByMembershipIds(
              organizationId,
              classId,
              toRemove,
              tx
            );

            for (const teacherMembershipId of toRemove) {
              await safeAudit(
                {
                  organizationId,
                  actorUserId: actor.actorUserId,
                  actorRole: actor.actorRole,
                  eventType: 'membership.class_teacher_removed',
                  targetType: 'class',
                  targetId: classId,
                  ipPrefix: actor.ipPrefix,
                  metadata: { teacherMembershipId },
                },
                tx
              );
            }
          }

          return repo.listClassTeachers(organizationId, classId, tx);
        });

        return {
          classId,
          teachers: teachers.map((t: ClassTeacherEntryRecord) => ({
            assignmentId: t.assignmentId,
            teacherMembershipId: t.teacherMembershipId,
            userId: t.userId,
            displayName: t.displayName,
            email: t.email,
            membershipStatus: t.membershipStatus,
            assignedAt: t.assignedAt.toISOString(),
          })),
        };
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

    async updateClassStudents(
      organizationId: string,
      classId: string,
      input:
        | {
            mode?: 'set';
            studentMembershipIds: string[];
            removedStatus?: EnrollmentEndStatus;
          }
        | {
            mode: 'enroll';
            studentMembershipIds: string[];
          }
        | {
            mode: 'remove';
            studentMembershipIds: string[];
            removedStatus?: EnrollmentEndStatus;
          },
      actor: ClassActorContext
    ) {
      const mode = input.mode ?? 'set';
      const uniqueIds = Array.from(new Set(input.studentMembershipIds));
      const now = nowFn();

      try {
        const roster = await repo.withTransaction(async (tx) => {
          const cls = await repo.findClassByIdInOrg(organizationId, classId, tx);
          if (!cls) {
            throw ApiErrors.notFound('Không tìm thấy lớp học trong tổ chức.');
          }

          if (mode !== 'remove' && uniqueIds.length > 0 && cls.status !== 'active') {
            throw ApiErrors.conflict(
              'CLASS_NOT_ACTIVE',
              'error.class.not_active',
              'Không thể ghi danh học sinh vào lớp đã lưu trữ.'
            );
          }

          if (mode !== 'remove' && uniqueIds.length > 0) {
            const foundMemberships = await repo.findMembershipsInOrgByIds(
              organizationId,
              uniqueIds,
              tx
            );
            const byId = new Map(foundMemberships.map((m) => [m.id, m]));

            for (const reqId of uniqueIds) {
              const m = byId.get(reqId);
              if (!m) {
                throw ApiErrors.conflict(
                  'STUDENT_MEMBERSHIP_NOT_IN_ORG',
                  'error.class.student_not_in_org',
                  'Học sinh được chọn không thuộc tổ chức này.'
                );
              }
              if (m.role !== 'student') {
                throw ApiErrors.conflict(
                  'INVALID_STUDENT_ROLE',
                  'error.class.invalid_student_role',
                  'Chỉ thành viên có vai trò học sinh mới được ghi danh vào lớp.'
                );
              }
              if (m.status !== 'active' || m.userStatus !== 'active') {
                throw ApiErrors.conflict(
                  'STUDENT_MEMBERSHIP_NOT_ACTIVE',
                  'error.class.student_not_active',
                  'Tài khoản học sinh hoặc tư cách thành viên không ở trạng thái hoạt động.'
                );
              }
            }
          }

          const currentActive = await repo.listActiveClassStudents(
            organizationId,
            classId,
            tx
          );
          const currentActiveSet = new Set(
            currentActive.map((s) => s.studentMembershipId)
          );

          let toAdd: string[] = [];
          let toEnd: string[] = [];
          const endStatus: EnrollmentEndStatus =
            'removedStatus' in input && input.removedStatus
              ? input.removedStatus
              : 'transferred_out';

          if (mode === 'set') {
            const targetSet = new Set(uniqueIds);
            toAdd = uniqueIds.filter((id) => !currentActiveSet.has(id));
            toEnd = currentActive
              .map((s) => s.studentMembershipId)
              .filter((id) => !targetSet.has(id));
          } else if (mode === 'enroll') {
            const alreadyActive = uniqueIds.filter((id) => currentActiveSet.has(id));
            if (alreadyActive.length > 0) {
              throw ApiErrors.conflict(
                'STUDENT_ALREADY_ENROLLED',
                'error.class.student_already_enrolled',
                'Học sinh đã đang được ghi danh hoạt động trong lớp này.'
              );
            }
            toAdd = uniqueIds;
          } else {
            toEnd = uniqueIds.filter((id) => currentActiveSet.has(id));
          }

          if (toEnd.length > 0) {
            await repo.endActiveEnrollments(
              {
                organizationId,
                classId,
                studentMembershipIds: toEnd,
                endStatus,
                endedAt: now,
                updatedByUserId: actor.actorUserId,
              },
              tx
            );

            for (const studentMembershipId of toEnd) {
              await safeAudit(
                {
                  organizationId,
                  actorUserId: actor.actorUserId,
                  actorRole: actor.actorRole,
                  eventType: 'membership.student_transferred',
                  targetType: 'class',
                  targetId: classId,
                  ipPrefix: actor.ipPrefix,
                  metadata: { studentMembershipId, endStatus },
                },
                tx
              );
            }
          }

          if (toAdd.length > 0) {
            await repo.insertClassEnrollments(
              toAdd.map((studentMembershipId) => ({
                id: generateUuidV7(),
                organizationId,
                classId,
                studentMembershipId,
                enrolledAt: now,
                updatedByUserId: actor.actorUserId,
              })),
              tx
            );

            for (const studentMembershipId of toAdd) {
              await safeAudit(
                {
                  organizationId,
                  actorUserId: actor.actorUserId,
                  actorRole: actor.actorRole,
                  eventType: 'membership.student_enrolled',
                  targetType: 'class',
                  targetId: classId,
                  ipPrefix: actor.ipPrefix,
                  metadata: { studentMembershipId },
                },
                tx
              );
            }
          }

          return repo.listActiveClassStudents(organizationId, classId, tx);
        });

        return {
          classId,
          students: roster.map((s: ClassStudentRosterRecord) => ({
            enrollmentId: s.enrollmentId,
            studentMembershipId: s.studentMembershipId,
            userId: s.userId,
            orgUsername: s.orgUsername,
            displayName: s.displayName,
            enrollmentStatus: s.enrollmentStatus,
            membershipStatus: s.membershipStatus,
            enrolledAt: s.enrolledAt.toISOString(),
          })),
        };
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

    async listMyAssignedClasses(params: {
      organizationId: string;
      teacherMembershipId: string;
      page: number;
      limit: number;
      status?: ClassStatus;
    }) {
      const result = await repo.listAssignedClassesForTeacher(params);
      return {
        items: result.items.map(toSafeClassView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getMyAssignedClassStudents(params: {
      organizationId: string;
      classId: string;
      teacherMembershipId: string;
      actorUserId: string;
      ipPrefix: string | null;
    }) {
      const cls = await repo.findClassByIdInOrg(params.organizationId, params.classId);
      if (!cls) {
        await safeAudit({
          organizationId: params.organizationId,
          actorUserId: params.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.cross_tenant_attempt_blocked',
          targetType: 'class',
          targetId: params.classId,
          ipPrefix: params.ipPrefix,
          metadata: { action: 'teacher_view_class_students_not_in_org' },
        }).catch(() => undefined);
        throw ApiErrors.forbidden('Bạn không có quyền truy cập lớp học này.');
      }

      const assigned = await repo.isTeacherAssignedToClassInOrg(
        params.organizationId,
        params.classId,
        params.teacherMembershipId
      );
      if (!assigned) {
        await safeAudit({
          organizationId: params.organizationId,
          actorUserId: params.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.unauthorized_access_denied',
          targetType: 'class',
          targetId: params.classId,
          ipPrefix: params.ipPrefix,
          metadata: { action: 'teacher_view_unassigned_class_students' },
        }).catch(() => undefined);
        throw ApiErrors.forbidden('Bạn không được phân công phụ trách lớp học này.');
      }

      const roster = await repo.listActiveClassStudents(
        params.organizationId,
        params.classId
      );

      return {
        class: toSafeClassView(cls),
        students: roster
          .filter(
            (s) =>
              s.enrollmentStatus === 'active' &&
              s.membershipStatus === 'active' &&
              s.userStatus === 'active'
          )
          .map((s) => ({
            enrollmentId: s.enrollmentId,
            studentMembershipId: s.studentMembershipId,
            userId: s.userId,
            orgUsername: s.orgUsername,
            displayName: s.displayName,
            enrolledAt: s.enrolledAt.toISOString(),
          })),
      };
    },
  };
}

export type ClassService = ReturnType<typeof createClassService>;
