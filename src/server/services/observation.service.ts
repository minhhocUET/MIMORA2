import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError } from '../http/errors.ts';
import {
  createObservationRepository,
  type ObservationDbOrTx,
  type ObservationRepository,
  type TeacherObservationRecord,
} from '../repositories/observation.repository.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
  type RecordAuditEventInput,
} from './audit.service.ts';

export interface TeacherObservationActorContext {
  actorUserId: string;
  organizationId: string;
  teacherMembershipId: string;
  ipPrefix: string | null;
}

export interface SafeTeacherObservationView {
  id: string;
  organizationId: string;
  authorTeacherMembershipId: string;
  studentMembershipId: string;
  classId: string | null;
  assignmentId: string | null;
  attemptId: string | null;
  noteBody: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListTeacherObservationsInput {
  studentMembershipId?: string;
  classId?: string;
  assignmentId?: string;
  attemptId?: string;
  page: number;
  limit: number;
}

export interface CreateTeacherObservationInput {
  studentMembershipId: string;
  classId?: string | null;
  assignmentId?: string | null;
  attemptId?: string | null;
  noteBody: string;
}

export interface UpdateTeacherObservationInput {
  noteBody?: string;
  classId?: string | null;
  assignmentId?: string | null;
  attemptId?: string | null;
  hasClassId?: boolean;
  hasAssignmentId?: boolean;
  hasAttemptId?: boolean;
}

export interface ObservationServiceDeps {
  observationRepo?: ObservationRepository;
  now?: () => Date;
  auditLogger?: (
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

function toSafeObservationView(
  record: TeacherObservationRecord
): SafeTeacherObservationView {
  return {
    id: record.id,
    organizationId: record.organizationId,
    authorTeacherMembershipId: record.authorTeacherMembershipId,
    studentMembershipId: record.studentMembershipId,
    classId: record.classId,
    assignmentId: record.assignmentId,
    attemptId: record.attemptId,
    noteBody: record.noteBody,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createObservationService(deps?: ObservationServiceDeps) {
  const repo = deps?.observationRepo ?? createObservationRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const logAudit =
    deps?.auditLogger ??
    ((input: RecordAuditEventInput, executor?: AuditInsertExecutor) =>
      recordAuditEvent(input, executor));

  async function safeEmitSecurityAudit(
    actor: TeacherObservationActorContext,
    eventType:
      | 'security.unauthorized_access_denied'
      | 'security.cross_tenant_attempt_blocked',
    targetId: string | null,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await logAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.actorUserId,
        actorRole: 'teacher',
        eventType,
        targetType: 'teacher_observation',
        targetId,
        ipPrefix: actor.ipPrefix,
        metadata,
      });
    } catch {
      // Do not mask primary security/authorization denial if audit transport fails
    }
  }

  async function assertActiveTeacherActor(
    actor: TeacherObservationActorContext,
    executor?: ObservationDbOrTx
  ): Promise<void> {
    const teacher = await repo.findMembershipInOrg(
      actor.organizationId,
      actor.teacherMembershipId,
      executor
    );
    if (
      !teacher ||
      teacher.userId !== actor.actorUserId ||
      teacher.role !== 'teacher' ||
      teacher.status !== 'active' ||
      teacher.userStatus !== 'active' ||
      teacher.organizationStatus !== 'active'
    ) {
      throw ApiErrors.forbidden(
        'Tài khoản giáo viên hoặc tổ chức hiện tại không ở trạng thái hoạt động.'
      );
    }
  }

  async function assertActiveStudentTarget(
    organizationId: string,
    studentMembershipId: string,
    executor?: ObservationDbOrTx
  ) {
    const student = await repo.findMembershipInOrg(
      organizationId,
      studentMembershipId,
      executor
    );
    if (
      !student ||
      student.role !== 'student' ||
      student.status !== 'active' ||
      student.userStatus !== 'active' ||
      student.organizationStatus !== 'active'
    ) {
      return null;
    }
    return student;
  }

  async function resolveAndValidateObservationLinks(
    params: {
      organizationId: string;
      teacherMembershipId: string;
      studentMembershipId: string;
      classId: string | null;
      assignmentId: string | null;
      attemptId: string | null;
    },
    tx: ObservationDbOrTx
  ): Promise<
    | {
        ok: true;
        resolvedClassId: string | null;
        resolvedAssignmentId: string | null;
        resolvedAttemptId: string | null;
      }
    | {
        ok: false;
        auditEvent?:
          | 'security.unauthorized_access_denied'
          | 'security.cross_tenant_attempt_blocked';
        auditReason?: string;
        error: AppError;
      }
  > {
    let resolvedClassId: string | null = params.classId;
    let resolvedAssignmentId: string | null = params.assignmentId;
    const resolvedAttemptId: string | null = params.attemptId;

    if (resolvedAttemptId !== null) {
      const attempt = await repo.findAttemptWithAssignmentInOrg(
        params.organizationId,
        resolvedAttemptId,
        tx
      );
      if (!attempt) {
        return {
          ok: false,
          auditEvent: 'security.cross_tenant_attempt_blocked',
          auditReason: 'attempt_not_found_in_org',
          error: new AppError({
            httpStatus: 422,
            code: 'OBSERVATION_ATTEMPT_NOT_FOUND',
            messageKey: 'error.observation.attempt_not_found',
            message:
              'Lượt thực hành được tham chiếu không tồn tại trong tổ chức hiện tại.',
          }),
        };
      }

      if (attempt.studentMembershipId !== params.studentMembershipId) {
        return {
          ok: false,
          auditEvent: 'security.unauthorized_access_denied',
          auditReason: 'attempt_student_mismatch',
          error: new AppError({
            httpStatus: 422,
            code: 'ATTEMPT_STUDENT_MISMATCH',
            messageKey: 'error.observation.attempt_student_mismatch',
            message:
              'Lượt thực hành không thuộc về học sinh đang được ghi chú.',
          }),
        };
      }

      if (
        resolvedAssignmentId !== null &&
        resolvedAssignmentId !== attempt.assignmentId
      ) {
        return {
          ok: false,
          error: new AppError({
            httpStatus: 422,
            code: 'ATTEMPT_ASSIGNMENT_MISMATCH',
            messageKey: 'error.observation.attempt_assignment_mismatch',
            message:
              'assignmentId không khớp với lượt thực hành (attemptId) được chọn.',
          }),
        };
      }

      if (resolvedClassId !== null && resolvedClassId !== attempt.classId) {
        return {
          ok: false,
          error: new AppError({
            httpStatus: 422,
            code: 'ASSIGNMENT_CLASS_MISMATCH',
            messageKey: 'error.observation.assignment_class_mismatch',
            message:
              'classId không khớp với lớp của bài giao chứa lượt thực hành.',
          }),
        };
      }

      resolvedAssignmentId = attempt.assignmentId;
      resolvedClassId = attempt.classId;
    } else if (resolvedAssignmentId !== null) {
      const assignment = await repo.findAssignmentInOrg(
        params.organizationId,
        resolvedAssignmentId,
        tx
      );
      if (!assignment) {
        return {
          ok: false,
          auditEvent: 'security.cross_tenant_attempt_blocked',
          auditReason: 'assignment_not_found_in_org',
          error: new AppError({
            httpStatus: 422,
            code: 'OBSERVATION_ASSIGNMENT_NOT_FOUND',
            messageKey: 'error.observation.assignment_not_found',
            message: 'Bài giao được tham chiếu không tồn tại trong tổ chức.',
          }),
        };
      }

      if (resolvedClassId !== null && resolvedClassId !== assignment.classId) {
        return {
          ok: false,
          error: new AppError({
            httpStatus: 422,
            code: 'ASSIGNMENT_CLASS_MISMATCH',
            messageKey: 'error.observation.assignment_class_mismatch',
            message: 'classId không khớp với lớp của bài giao đã chọn.',
          }),
        };
      }

      resolvedClassId = assignment.classId;
    } else if (resolvedClassId !== null) {
      const classRow = await repo.findClassInOrg(
        params.organizationId,
        resolvedClassId,
        tx
      );
      if (!classRow) {
        return {
          ok: false,
          auditEvent: 'security.cross_tenant_attempt_blocked',
          auditReason: 'class_not_found_in_org',
          error: new AppError({
            httpStatus: 422,
            code: 'OBSERVATION_CLASS_NOT_FOUND',
            messageKey: 'error.observation.class_not_found',
            message: 'Lớp học được tham chiếu không tồn tại trong tổ chức.',
          }),
        };
      }
    }

    if (resolvedClassId !== null) {
      const teacherAssign = await repo.isTeacherAssignedToClass(
        params.organizationId,
        params.teacherMembershipId,
        resolvedClassId,
        tx
      );
      if (!teacherAssign.assigned) {
        return {
          ok: false,
          auditEvent: 'security.unauthorized_access_denied',
          auditReason: 'teacher_not_assigned_to_class',
          error: ApiErrors.forbidden(
            'Bạn không được phân công giảng dạy lớp học này.'
          ),
        };
      }
      if (teacherAssign.classStatus !== 'active') {
        return {
          ok: false,
          error: new AppError({
            httpStatus: 409,
            code: 'CLASS_NOT_ACTIVE',
            messageKey: 'error.observation.class_not_active',
            message: 'Lớp học không ở trạng thái hoạt động.',
          }),
        };
      }

      const enrolled = await repo.isStudentActivelyEnrolledInClass(
        params.organizationId,
        params.studentMembershipId,
        resolvedClassId,
        tx
      );
      if (!enrolled) {
        return {
          ok: false,
          auditEvent: 'security.unauthorized_access_denied',
          auditReason: 'student_not_enrolled_in_class',
          error: new AppError({
            httpStatus: 422,
            code: 'STUDENT_NOT_ENROLLED_IN_CLASS',
            messageKey: 'error.observation.student_not_enrolled',
            message: 'Học sinh không có ghi danh hoạt động trong lớp học này.',
          }),
        };
      }
    } else {
      const sharedActive = await repo.hasSharedActiveTeacherStudentClass(
        params.organizationId,
        params.teacherMembershipId,
        params.studentMembershipId,
        tx
      );
      if (!sharedActive) {
        return {
          ok: false,
          auditEvent: 'security.unauthorized_access_denied',
          auditReason: 'teacher_student_not_shared_active_class',
          error: ApiErrors.forbidden(
            'Bạn chỉ có thể tạo ghi chú cho học sinh đang học trong lớp bạn phụ trách.'
          ),
        };
      }
    }

    return {
      ok: true,
      resolvedClassId,
      resolvedAssignmentId,
      resolvedAttemptId,
    };
  }

  return {
    async listObservations(
      input: ListTeacherObservationsInput,
      actor: TeacherObservationActorContext
    ) {
      await assertActiveTeacherActor(actor);

      const { items, total } = await repo.listObservationsByAuthor({
        organizationId: actor.organizationId,
        authorTeacherMembershipId: actor.teacherMembershipId,
        studentMembershipId: input.studentMembershipId,
        classId: input.classId,
        assignmentId: input.assignmentId,
        attemptId: input.attemptId,
        page: input.page,
        limit: input.limit,
      });

      return {
        items: items.map(toSafeObservationView),
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / input.limit),
        },
      };
    },

    async getObservation(
      observationId: string,
      actor: TeacherObservationActorContext
    ): Promise<SafeTeacherObservationView> {
      await assertActiveTeacherActor(actor);

      const found = await repo.findObservationByIdForAuthor(
        actor.organizationId,
        actor.teacherMembershipId,
        observationId
      );

      if (!found) {
        throw ApiErrors.notFound('Không tìm thấy ghi chú quan sát.');
      }

      return toSafeObservationView(found);
    },

    async createObservation(
      input: CreateTeacherObservationInput,
      actor: TeacherObservationActorContext
    ): Promise<SafeTeacherObservationView> {
      const noteBody = input.noteBody.trim();
      if (noteBody.length === 0) {
        throw ApiErrors.validation([
          {
            field: 'body.noteBody',
            code: 'INVALID_NOTE_BODY',
            messageKey: 'error.observation.empty_note',
            message: 'Nội dung ghi chú quan sát không được để trống.',
          },
        ]);
      }

      const txOutcome = await repo.withTransaction<{
        created: TeacherObservationRecord | null;
        pendingAudit: {
          eventType:
            | 'security.unauthorized_access_denied'
            | 'security.cross_tenant_attempt_blocked';
          metadata: Record<string, unknown>;
        } | null;
        pendingError: AppError | null;
      }>(async (tx) => {
        await assertActiveTeacherActor(actor, tx);

        const student = await assertActiveStudentTarget(
          actor.organizationId,
          input.studentMembershipId,
          tx
        );
        if (!student) {
          return {
            created: null,
            pendingAudit: {
              eventType: 'security.cross_tenant_attempt_blocked',
              metadata: {
                targetKind: 'teacher_observation',
                reason: 'student_not_active_in_org',
              },
            },
            pendingError: new AppError({
              httpStatus: 404,
              code: 'STUDENT_NOT_FOUND',
              messageKey: 'error.observation.student_not_found',
              message:
                'Không tìm thấy học sinh đang hoạt động trong tổ chức hiện tại.',
            }),
          };
        }

        const linkOutcome = await resolveAndValidateObservationLinks(
          {
            organizationId: actor.organizationId,
            teacherMembershipId: actor.teacherMembershipId,
            studentMembershipId: input.studentMembershipId,
            classId: input.classId ?? null,
            assignmentId: input.assignmentId ?? null,
            attemptId: input.attemptId ?? null,
          },
          tx
        );

        if (!linkOutcome.ok) {
          return {
            created: null,
            pendingAudit: linkOutcome.auditEvent
              ? {
                  eventType: linkOutcome.auditEvent,
                  metadata: {
                    targetKind: 'teacher_observation',
                    reason: linkOutcome.auditReason ?? 'link_validation_failed',
                  },
                }
              : null,
            pendingError: linkOutcome.error,
          };
        }

        const now = nowFn();
        const inserted = await repo.insertObservation(
          {
            id: generateUuidV7(),
            organizationId: actor.organizationId,
            authorTeacherMembershipId: actor.teacherMembershipId,
            studentMembershipId: input.studentMembershipId,
            classId: linkOutcome.resolvedClassId,
            assignmentId: linkOutcome.resolvedAssignmentId,
            attemptId: linkOutcome.resolvedAttemptId,
            noteBody,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
          tx
        );
        return {
          created: inserted,
          pendingAudit: null,
          pendingError: null,
        };
      });

      if (txOutcome.pendingError || !txOutcome.created) {
        if (txOutcome.pendingAudit) {
          await safeEmitSecurityAudit(
            actor,
            txOutcome.pendingAudit.eventType,
            null,
            txOutcome.pendingAudit.metadata
          );
        }
        throw txOutcome.pendingError ?? ApiErrors.internal();
      }

      return toSafeObservationView(txOutcome.created);
    },

    async updateObservation(
      observationId: string,
      input: UpdateTeacherObservationInput,
      actor: TeacherObservationActorContext
    ): Promise<SafeTeacherObservationView> {
      const txOutcome = await repo.withTransaction<{
        updated: TeacherObservationRecord | null;
        pendingAudit: {
          eventType:
            | 'security.unauthorized_access_denied'
            | 'security.cross_tenant_attempt_blocked';
          metadata: Record<string, unknown>;
        } | null;
        pendingError: AppError | null;
      }>(async (tx) => {
        await assertActiveTeacherActor(actor, tx);

        const existing = await repo.findObservationByIdForAuthor(
          actor.organizationId,
          actor.teacherMembershipId,
          observationId,
          tx
        );
        if (!existing) {
          return {
            updated: null,
            pendingAudit: null,
            pendingError: ApiErrors.notFound('Không tìm thấy ghi chú quan sát.'),
          };
        }

        const nextNoteBody =
          input.noteBody !== undefined ? input.noteBody.trim() : existing.noteBody;
        if (nextNoteBody.length === 0) {
          return {
            updated: null,
            pendingAudit: null,
            pendingError: ApiErrors.validation([
              {
                field: 'body.noteBody',
                code: 'INVALID_NOTE_BODY',
                messageKey: 'error.observation.empty_note',
                message: 'Nội dung ghi chú quan sát không được để trống.',
              },
            ]),
          };
        }

        const anyLinkChanged = Boolean(
          input.hasClassId || input.hasAssignmentId || input.hasAttemptId
        );

        let nextClassId = existing.classId;
        let nextAssignmentId = existing.assignmentId;
        let nextAttemptId = existing.attemptId;

        if (anyLinkChanged) {
          const candidateClassId = input.hasClassId
            ? input.classId ?? null
            : existing.classId;
          const candidateAssignmentId = input.hasAssignmentId
            ? input.assignmentId ?? null
            : existing.assignmentId;
          const candidateAttemptId = input.hasAttemptId
            ? input.attemptId ?? null
            : existing.attemptId;

          const linkOutcome = await resolveAndValidateObservationLinks(
            {
              organizationId: actor.organizationId,
              teacherMembershipId: actor.teacherMembershipId,
              studentMembershipId: existing.studentMembershipId,
              classId: candidateClassId,
              assignmentId: candidateAssignmentId,
              attemptId: candidateAttemptId,
            },
            tx
          );

          if (!linkOutcome.ok) {
            return {
              updated: null,
              pendingAudit: linkOutcome.auditEvent
                ? {
                    eventType: linkOutcome.auditEvent,
                    metadata: {
                      targetKind: 'teacher_observation',
                      reason: linkOutcome.auditReason ?? 'link_validation_failed',
                    },
                  }
                : null,
              pendingError: linkOutcome.error,
            };
          }

          nextClassId = linkOutcome.resolvedClassId;
          nextAssignmentId = linkOutcome.resolvedAssignmentId;
          nextAttemptId = linkOutcome.resolvedAttemptId;
        }

        const saved = await repo.updateObservationForAuthor(
          {
            organizationId: actor.organizationId,
            authorTeacherMembershipId: actor.teacherMembershipId,
            observationId,
            classId: nextClassId,
            assignmentId: nextAssignmentId,
            attemptId: nextAttemptId,
            noteBody: nextNoteBody,
            updatedAt: nowFn(),
          },
          tx
        );

        if (!saved) {
          return {
            updated: null,
            pendingAudit: null,
            pendingError: ApiErrors.notFound('Không tìm thấy ghi chú quan sát.'),
          };
        }

        return {
          updated: saved,
          pendingAudit: null,
          pendingError: null,
        };
      });

      if (txOutcome.pendingError || !txOutcome.updated) {
        if (txOutcome.pendingAudit) {
          await safeEmitSecurityAudit(
            actor,
            txOutcome.pendingAudit.eventType,
            observationId,
            txOutcome.pendingAudit.metadata
          );
        }
        throw txOutcome.pendingError ?? ApiErrors.internal();
      }

      return toSafeObservationView(txOutcome.updated);
    },

    async deleteObservation(
      observationId: string,
      actor: TeacherObservationActorContext
    ): Promise<{ deleted: true; id: string }> {
      const deleted = await repo.withTransaction(async (tx) => {
        await assertActiveTeacherActor(actor, tx);
        const now = nowFn();
        return repo.softDeleteObservationForAuthor(
          {
            organizationId: actor.organizationId,
            authorTeacherMembershipId: actor.teacherMembershipId,
            observationId,
            deletedAt: now,
            updatedAt: now,
          },
          tx
        );
      });

      if (!deleted) {
        throw ApiErrors.notFound('Không tìm thấy ghi chú quan sát.');
      }

      return { deleted: true, id: observationId };
    },
  };
}

export type ObservationService = ReturnType<typeof createObservationService>;
