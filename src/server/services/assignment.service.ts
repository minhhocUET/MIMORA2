import type { CanonicalContentType } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import {
  ApiErrors,
  AppError,
  extractDatabaseErrorMeta,
  isDatabaseError,
  translateDatabaseError,
} from '../http/errors.ts';
import {
  ASSIGNMENT_STATUSES,
  createAssignmentRepository,
  type AssignmentDbOrTx,
  type AssignmentListSummaryRecord,
  type AssignmentProgressReadRecord,
  type AssignmentRecord,
  type AssignmentRepository,
  type AssignmentStatus,
  type AssignmentTargetStudentRecord,
  type PinnedAssignmentItemRecord,
  type StudentAssignmentListRow,
} from '../repositories/assignment.repository.ts';
import {
  isCanonicalContentType,
  scanUnsafeSelText,
} from '../validators/content-payload.schema.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
} from './audit.service.ts';

export interface TeacherAssignmentActorContext {
  actorUserId: string;
  organizationId: string;
  teacherMembershipId: string;
  ipPrefix: string | null;
}

export interface StudentAssignmentActorContext {
  actorUserId: string;
  organizationId: string;
  studentMembershipId: string;
  ipPrefix: string | null;
}

export interface HomePracticeView {
  hasInstructions: boolean;
  instructions: string | null;
}

export interface SafePinnedAssignmentItemView {
  assignmentItemId: string;
  sortOrder: number;
  contentItemId: string;
  contentVersionId: string;
  slug: string;
  contentType: CanonicalContentType;
  versionNumber: number;
  versionStatus: string;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: string | null;
}

export interface SafeAssignmentTargetView {
  targetId: string;
  studentMembershipId: string;
  displayName: string;
  orgUsername: string | null;
  membershipStatus: string;
  assignedAt: string;
}

export interface SafeTeacherAssignmentView {
  id: string;
  organizationId: string;
  classId: string;
  className?: string;
  createdByTeacherMembershipId: string;
  canEdit: boolean;
  title: string;
  homePracticeInstructions: string | null;
  homePractice: HomePracticeView;
  dueAt: string | null;
  isPastDue: boolean;
  status: AssignmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SafeTeacherAssignmentListItemView extends SafeTeacherAssignmentView {
  className: string;
  itemCount: number;
  targetCount: number;
}

export interface SafeAssignmentProgressSummaryView {
  assignmentTargetId: string;
  studentMembershipId: string;
  displayName: string;
  orgUsername: string | null;
  hasProgressRecord: boolean;
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export interface SafeStudentProgressSnapshot {
  hasProgressRecord: boolean;
  status: string;
  totalItems: number;
  completedItems: number;
  attemptCount: number;
  lastActivityAt: string | null;
  completedAt: string | null;
}

export interface SafeStudentAssignmentListItemView {
  id: string;
  organizationId: string;
  classId: string;
  className: string;
  targetId: string;
  title: string;
  status: 'active' | 'closed';
  isReadOnly: boolean;
  dueAt: string | null;
  isPastDue: boolean;
  homePracticeInstructions: string | null;
  homePractice: HomePracticeView;
  itemCount: number;
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
  progress: SafeStudentProgressSnapshot;
}

export interface SafeStudentAssignmentDetailView {
  id: string;
  organizationId: string;
  classId: string;
  className: string;
  targetId: string;
  title: string;
  status: 'active' | 'closed';
  isReadOnly: boolean;
  dueAt: string | null;
  isPastDue: boolean;
  homePracticeInstructions: string | null;
  homePractice: {
    hasInstructions: boolean;
    instructions: string | null;
    printableGuide: {
      assignmentTitle: string;
      className: string;
      dueAt: string | null;
      instructions: string | null;
      activityTitles: string[];
    };
  };
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
  items: Array<
    Omit<SafePinnedAssignmentItemView, 'versionStatus'>
  >;
  progress: SafeStudentProgressSnapshot;
}

function normalizeAssignmentStatus(status: string): AssignmentStatus {
  if ((ASSIGNMENT_STATUSES as readonly string[]).includes(status)) {
    return status as AssignmentStatus;
  }
  return 'active';
}

function computeIsPastDue(dueAt: Date | null, now: Date): boolean {
  if (!dueAt) {
    return false;
  }
  return dueAt.getTime() < now.getTime();
}

function toHomePracticeView(instructions: string | null): HomePracticeView {
  return {
    hasInstructions: instructions !== null && instructions.length > 0,
    instructions,
  };
}

function toSafeTeacherAssignmentView(
  row: AssignmentRecord,
  actorTeacherMembershipId: string,
  now: Date,
  className?: string
): SafeTeacherAssignmentView {
  const view: SafeTeacherAssignmentView = {
    id: row.id,
    organizationId: row.organizationId,
    classId: row.classId,
    createdByTeacherMembershipId: row.createdByTeacherMembershipId,
    canEdit: row.createdByTeacherMembershipId === actorTeacherMembershipId,
    title: row.title,
    homePracticeInstructions: row.homePracticeInstructions,
    homePractice: toHomePracticeView(row.homePracticeInstructions),
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    isPastDue: computeIsPastDue(row.dueAt, now),
    status: normalizeAssignmentStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (className !== undefined) {
    view.className = className;
  }
  return view;
}

function toSafePinnedItemView(
  row: PinnedAssignmentItemRecord
): SafePinnedAssignmentItemView {
  const contentType: CanonicalContentType = isCanonicalContentType(row.contentType)
    ? row.contentType
    : 'emotion_card';
  return {
    assignmentItemId: row.id,
    sortOrder: row.sortOrder,
    contentItemId: row.contentItemId,
    contentVersionId: row.contentVersionId,
    slug: row.slug,
    contentType,
    versionNumber: row.versionNumber,
    versionStatus: row.versionStatus,
    title: row.title,
    summary: row.summary,
    locale: row.locale,
    payloadJson: row.payloadJson,
    metadataJson: row.metadataJson,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function toSafeTargetView(
  row: AssignmentTargetStudentRecord
): SafeAssignmentTargetView {
  return {
    targetId: row.targetId,
    studentMembershipId: row.studentMembershipId,
    displayName: row.displayName,
    orgUsername: row.orgUsername,
    membershipStatus: row.membershipStatus,
    assignedAt: row.assignedAt.toISOString(),
  };
}

function toSafeProgressRow(
  row: AssignmentProgressReadRecord
): SafeAssignmentProgressSummaryView {
  return {
    assignmentTargetId: row.assignmentTargetId,
    studentMembershipId: row.studentMembershipId,
    displayName: row.displayName,
    orgUsername: row.orgUsername,
    hasProgressRecord: row.hasProgressRecord,
    status: row.status,
    totalItems: row.totalItems,
    completedItems: row.completedItems,
    attemptCount: row.attemptCount,
    lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function normalizeHomePracticeInstructions(
  raw: string | null | undefined
): string | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const details = scanUnsafeSelText(trimmed, 'body.homePracticeInstructions');
  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }
  return trimmed;
}

function validateSafeTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    throw ApiErrors.validation([
      {
        field: 'body.title',
        code: 'INVALID_TITLE',
        messageKey: 'error.assignment.invalid_title',
        message: 'Tiêu đề bài tập không được để trống.',
      },
    ]);
  }
  const details = scanUnsafeSelText(trimmed, 'body.title');
  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }
  return trimmed;
}

function parseOptionalDueAt(rawDueAt: string | null | undefined): Date | null | undefined {
  if (rawDueAt === undefined) {
    return undefined;
  }
  if (rawDueAt === null) {
    return null;
  }
  const parsed = new Date(rawDueAt);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiErrors.validation([
      {
        field: 'body.dueAt',
        code: 'INVALID_DUE_AT',
        messageKey: 'error.assignment.invalid_due_at',
        message: 'Ngày hẹn hoàn thành bài tập không đúng định dạng ISO-8601.',
      },
    ]);
  }
  return parsed;
}

export interface AssignmentServiceDeps {
  repo?: AssignmentRepository;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createAssignmentService(deps?: AssignmentServiceDeps) {
  const repo = deps?.repo ?? createAssignmentRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AssignmentDbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  return {
    async createAssignment(
      input: {
        classId: string;
        title: string;
        homePracticeInstructions?: string | null;
        dueAt?: string | null;
        status?: 'draft' | 'active';
        items: Array<{
          contentVersionId: string;
          sortOrder: number;
          expectedContentItemId?: string;
        }>;
        targetStudentMembershipIds: string[];
      },
      actor: TeacherAssignmentActorContext
    ) {
      const normalizedTitle = validateSafeTitle(input.title);
      const normalizedInstructions =
        normalizeHomePracticeInstructions(input.homePracticeInstructions) ?? null;
      const dueAt = parseOptionalDueAt(input.dueAt) ?? null;
      const status: AssignmentStatus = input.status ?? 'active';

      // Reject duplicate targets & duplicate version IDs or sortOrders explicitly
      const seenTargets = new Set<string>();
      for (let i = 0; i < input.targetStudentMembershipIds.length; i += 1) {
        const studentId = input.targetStudentMembershipIds[i];
        if (seenTargets.has(studentId)) {
          throw ApiErrors.validation([
            {
              field: `body.targetStudentMembershipIds[${i}]`,
              code: 'DUPLICATE_TARGET_STUDENT',
              messageKey: 'error.assignment.duplicate_target_student',
              message: 'Danh sách học sinh được giao bài tập chứa giá trị trùng lặp.',
            },
          ]);
        }
        seenTargets.add(studentId);
      }

      const seenVersionIds = new Set<string>();
      const seenSortOrders = new Set<number>();
      for (let i = 0; i < input.items.length; i += 1) {
        const item = input.items[i];
        if (seenVersionIds.has(item.contentVersionId)) {
          throw ApiErrors.validation([
            {
              field: `body.items[${i}].contentVersionId`,
              code: 'DUPLICATE_CONTENT_VERSION',
              messageKey: 'error.assignment.duplicate_content_version',
              message: 'Mỗi phiên bản nội dung chỉ được xuất hiện một lần trong bài tập.',
            },
          ]);
        }
        seenVersionIds.add(item.contentVersionId);

        if (seenSortOrders.has(item.sortOrder)) {
          throw ApiErrors.validation([
            {
              field: `body.items[${i}].sortOrder`,
              code: 'DUPLICATE_SORT_ORDER',
              messageKey: 'error.assignment.duplicate_sort_order',
              message: 'Thứ tự sắp xếp (sortOrder) của các nội dung không được trùng nhau.',
            },
          ]);
        }
        seenSortOrders.add(item.sortOrder);
      }

      const orderedInputItems = [...input.items].sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      const now = nowFn();
      const assignmentId = generateUuidV7();

      let deferredSecurityAudit: Parameters<typeof recordAuditEvent>[0] | null = null;

      try {
        const created = await repo.withTransaction(async (tx) => {
          const cls = await repo.findClassByIdInOrg(
            actor.organizationId,
            input.classId,
            tx
          );
          if (!cls) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.cross_tenant_attempt_blocked',
              targetType: 'class',
              targetId: input.classId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'create_assignment_class_not_in_org',
              },
            };
            throw ApiErrors.forbidden(
              'Lớp học không tồn tại trong trường đang làm việc hoặc không thuộc quyền truy cập của bạn.'
            );
          }

          const isAssigned = await repo.isTeacherAssignedToClassInOrg(
            actor.organizationId,
            cls.id,
            actor.teacherMembershipId,
            tx
          );
          if (!isAssigned) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'class',
              targetId: cls.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'create_assignment_unassigned_teacher',
              },
            };
            throw ApiErrors.forbidden(
              'Bạn không được phân công phụ trách lớp học này.'
            );
          }

          if (cls.status !== 'active') {
            throw ApiErrors.conflict(
              'CLASS_NOT_ACTIVE',
              'error.class.not_active',
              'Lớp học đã lưu trữ, không thể tạo bài tập mới.'
            );
          }

          const eligibleStudents = await repo.findEligibleStudentsInClass(
            actor.organizationId,
            cls.id,
            input.targetStudentMembershipIds,
            tx
          );
          const eligibleById = new Map(
            eligibleStudents.map((s) => [s.membershipId, s])
          );

          for (const studentMembershipId of input.targetStudentMembershipIds) {
            const found = eligibleById.get(studentMembershipId);
            if (
              !found ||
              found.organizationId !== actor.organizationId ||
              found.classId !== cls.id ||
              found.role !== 'student' ||
              found.membershipStatus !== 'active' ||
              found.userStatus !== 'active' ||
              found.enrollmentStatus !== 'active'
            ) {
              throw ApiErrors.conflict(
                'TARGET_STUDENT_INELIGIBLE',
                'error.assignment.target_student_ineligible',
                'Học sinh được chọn không còn ghi danh hoạt động trong lớp học này hoặc không thuộc tổ chức.'
              );
            }
          }

          const versionRows = await repo.findContentVersionsForPinning(
            orderedInputItems.map((i) => i.contentVersionId),
            tx
          );
          const versionById = new Map(versionRows.map((v) => [v.versionId, v]));

          for (const item of orderedInputItems) {
            const version = versionById.get(item.contentVersionId);
            if (!version) {
              throw ApiErrors.conflict(
                'CONTENT_VERSION_NOT_FOUND',
                'error.assignment.content_version_not_found',
                'Không tìm thấy phiên bản nội dung được chọn để giao bài.'
              );
            }
            if (
              item.expectedContentItemId &&
              version.contentItemId !== item.expectedContentItemId
            ) {
              throw ApiErrors.conflict(
                'CONTENT_ITEM_MISMATCH',
                'error.assignment.content_item_mismatch',
                'Phiên bản nội dung không khớp với mục nội dung được chỉ định.'
              );
            }
            if (version.isArchived || version.status !== 'published') {
              throw ApiErrors.conflict(
                'CONTENT_VERSION_NOT_PUBLISHED',
                'error.assignment.content_version_not_published',
                'Chỉ được phép gắn phiên bản nội dung đang ở trạng thái đã xuất bản (published) và chưa lưu trữ.'
              );
            }
          }

          const assignmentRow: AssignmentRecord = {
            id: assignmentId,
            organizationId: actor.organizationId,
            classId: cls.id,
            createdByTeacherMembershipId: actor.teacherMembershipId,
            title: normalizedTitle,
            homePracticeInstructions: normalizedInstructions,
            dueAt,
            status,
            createdAt: now,
            updatedAt: now,
          };

          const itemRows = orderedInputItems.map((item) => ({
            id: generateUuidV7(),
            organizationId: actor.organizationId,
            assignmentId,
            contentVersionId: item.contentVersionId,
            sortOrder: item.sortOrder,
            createdAt: now,
          }));

          const targetRows = input.targetStudentMembershipIds.map(
            (studentMembershipId) => ({
              id: generateUuidV7(),
              organizationId: actor.organizationId,
              assignmentId,
              studentMembershipId,
              assignedAt: now,
            })
          );

          await repo.createAssignmentWithItemsAndTargets(
            {
              assignment: assignmentRow,
              items: itemRows,
              targets: targetRows,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'assignment.created',
              targetType: 'assignment',
              targetId: assignmentId,
              ipPrefix: actor.ipPrefix,
              metadata: {
                classId: cls.id,
                status,
                itemCount: itemRows.length,
                targetCount: targetRows.length,
                hasHomePractice: normalizedInstructions !== null,
                hasDueAt: dueAt !== null,
              },
            },
            tx
          );

          const [pinnedItems, targetDetails] = await Promise.all([
            repo.listAssignmentItemsWithPinnedContent(
              actor.organizationId,
              assignmentId,
              tx
            ),
            repo.listAssignmentTargetsWithStudents(
              actor.organizationId,
              assignmentId,
              tx
            ),
          ]);

          return {
            assignment: assignmentRow,
            className: cls.name,
            items: pinnedItems,
            targets: targetDetails,
          };
        });

        return {
          assignment: toSafeTeacherAssignmentView(
            created.assignment,
            actor.teacherMembershipId,
            now,
            created.className
          ),
          items: created.items.map(toSafePinnedItemView),
          targets: created.targets.map(toSafeTargetView),
        };
      } catch (err: unknown) {
        if (deferredSecurityAudit) {
          await safeAudit(deferredSecurityAudit).catch(() => undefined);
        }
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          const meta = extractDatabaseErrorMeta(err);
          if (meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062) {
            throw ApiErrors.conflict(
              'ASSIGNMENT_DUPLICATE_CONFLICT',
              'error.assignment.duplicate_conflict',
              'Dữ liệu nội dung hoặc học sinh trong bài tập bị trùng lặp.'
            );
          }
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async listTeacherAssignments(
      query: {
        classId?: string;
        status?: AssignmentStatus;
        page: number;
        limit: number;
      },
      actor: TeacherAssignmentActorContext
    ) {
      if (query.classId) {
        const cls = await repo.findClassByIdInOrg(
          actor.organizationId,
          query.classId
        );
        if (!cls) {
          await safeAudit({
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'security.cross_tenant_attempt_blocked',
            targetType: 'class',
            targetId: query.classId,
            ipPrefix: actor.ipPrefix,
            metadata: { action: 'list_assignments_class_not_in_org' },
          }).catch(() => undefined);
          throw ApiErrors.forbidden('Bạn không có quyền truy cập lớp học này.');
        }

        const isAssigned = await repo.isTeacherAssignedToClassInOrg(
          actor.organizationId,
          cls.id,
          actor.teacherMembershipId
        );
        if (!isAssigned) {
          await safeAudit({
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            actorRole: 'teacher',
            eventType: 'security.unauthorized_access_denied',
            targetType: 'class',
            targetId: cls.id,
            ipPrefix: actor.ipPrefix,
            metadata: { action: 'list_assignments_unassigned_teacher' },
          }).catch(() => undefined);
          throw ApiErrors.forbidden(
            'Bạn không được phân công phụ trách lớp học này.'
          );
        }
      }

      const now = nowFn();
      const result = await repo.listAssignmentsForTeacherClasses({
        organizationId: actor.organizationId,
        teacherMembershipId: actor.teacherMembershipId,
        classId: query.classId,
        status: query.status,
        page: query.page,
        limit: query.limit,
      });

      return {
        items: result.items.map(
          (row: AssignmentListSummaryRecord): SafeTeacherAssignmentListItemView => ({
            ...toSafeTeacherAssignmentView(
              row.assignment,
              actor.teacherMembershipId,
              now,
              row.className
            ),
            className: row.className,
            itemCount: row.itemCount,
            targetCount: row.targetCount,
          })
        ),
        page: query.page,
        limit: query.limit,
        total: result.total,
      };
    },

    async getTeacherAssignmentDetail(
      assignmentId: string,
      actor: TeacherAssignmentActorContext
    ) {
      const existing = await repo.findAssignmentByIdInOrg(
        actor.organizationId,
        assignmentId
      );
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
      }

      const isAssigned = await repo.isTeacherAssignedToClassInOrg(
        actor.organizationId,
        existing.classId,
        actor.teacherMembershipId
      );
      if (!isAssigned) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.unauthorized_access_denied',
          targetType: 'assignment',
          targetId: existing.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            action: 'view_assignment_unassigned_teacher',
            classId: existing.classId,
          },
        }).catch(() => undefined);
        throw ApiErrors.forbidden(
          'Bạn không được phân công phụ trách lớp của bài tập này.'
        );
      }

      const [items, targets] = await Promise.all([
        repo.listAssignmentItemsWithPinnedContent(
          actor.organizationId,
          existing.id
        ),
        repo.listAssignmentTargetsWithStudents(
          actor.organizationId,
          existing.id
        ),
      ]);

      return {
        assignment: toSafeTeacherAssignmentView(
          existing,
          actor.teacherMembershipId,
          nowFn(),
          existing.className
        ),
        items: items.map(toSafePinnedItemView),
        targets: targets.map(toSafeTargetView),
      };
    },

    async updateAssignment(
      assignmentId: string,
      input: {
        title?: string;
        homePracticeInstructions?: string | null;
        dueAt?: string | null;
        status?: AssignmentStatus;
      },
      actor: TeacherAssignmentActorContext
    ) {
      if (
        input.title === undefined &&
        input.homePracticeInstructions === undefined &&
        input.dueAt === undefined &&
        input.status === undefined
      ) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật bài tập.',
          },
        ]);
      }

      const normalizedTitle =
        input.title !== undefined ? validateSafeTitle(input.title) : undefined;
      const normalizedInstructions = normalizeHomePracticeInstructions(
        input.homePracticeInstructions
      );
      const parsedDueAt = parseOptionalDueAt(input.dueAt);
      const now = nowFn();

      let deferredSecurityAudit: Parameters<typeof recordAuditEvent>[0] | null = null;

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findAssignmentByIdInOrgForUpdate(
            actor.organizationId,
            assignmentId,
            tx
          );
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
          }

          const isAssigned = await repo.isTeacherAssignedToClassInOrg(
            actor.organizationId,
            existing.classId,
            actor.teacherMembershipId,
            tx
          );
          if (!isAssigned) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'update_assignment_unassigned_teacher',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Bạn không được phân công phụ trách lớp của bài tập này.'
            );
          }

          if (
            existing.createdByTeacherMembershipId !== actor.teacherMembershipId
          ) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'update_assignment_non_creator_blocked',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Chỉ giáo viên đã tạo bài tập mới có quyền chỉnh sửa bài tập này.'
            );
          }

          if (existing.status === 'closed' || existing.status === 'archived') {
            throw ApiErrors.conflict(
              'ASSIGNMENT_CLOSED',
              'error.assignment.closed',
              'Bài tập đã đóng hoặc đã lưu trữ, không thể chỉnh sửa.'
            );
          }

          if (
            input.status !== undefined &&
            existing.status === 'active' &&
            input.status === 'draft'
          ) {
            throw ApiErrors.conflict(
              'INVALID_ASSIGNMENT_STATUS_TRANSITION',
              'error.assignment.invalid_status_transition',
              'Không thể chuyển bài tập đang hoạt động về trạng thái nháp.'
            );
          }

          const next = await repo.updateAssignmentFields(
            {
              organizationId: actor.organizationId,
              assignmentId: existing.id,
              title: normalizedTitle,
              homePracticeInstructions: normalizedInstructions,
              dueAt: parsedDueAt,
              status: input.status,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
          }

          const eventType =
            next.status === 'closed' && existing.status !== 'closed'
              ? 'assignment.closed'
              : 'assignment.updated';

          await safeAudit(
            {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType,
              targetType: 'assignment',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                previousStatus: existing.status,
                status: next.status,
                titleUpdated: normalizedTitle !== undefined,
                homePracticeUpdated: normalizedInstructions !== undefined,
                hasHomePractice: next.homePracticeInstructions !== null,
                dueAtUpdated: parsedDueAt !== undefined,
              },
            },
            tx
          );

          return next;
        });

        return {
          assignment: toSafeTeacherAssignmentView(
            updated,
            actor.teacherMembershipId,
            now
          ),
        };
      } catch (err: unknown) {
        if (deferredSecurityAudit) {
          await safeAudit(deferredSecurityAudit).catch(() => undefined);
        }
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async updateAssignmentTargets(
      assignmentId: string,
      targetStudentMembershipIds: string[],
      actor: TeacherAssignmentActorContext
    ) {
      const seen = new Set<string>();
      for (let i = 0; i < targetStudentMembershipIds.length; i += 1) {
        const studentId = targetStudentMembershipIds[i];
        if (seen.has(studentId)) {
          throw ApiErrors.validation([
            {
              field: `body.targetStudentMembershipIds[${i}]`,
              code: 'DUPLICATE_TARGET_STUDENT',
              messageKey: 'error.assignment.duplicate_target_student',
              message: 'Danh sách học sinh được giao bài tập chứa giá trị trùng lặp.',
            },
          ]);
        }
        seen.add(studentId);
      }

      const now = nowFn();
      let deferredSecurityAudit: Parameters<typeof recordAuditEvent>[0] | null = null;

      try {
        const updatedTargets = await repo.withTransaction(async (tx) => {
          const existing = await repo.findAssignmentByIdInOrgForUpdate(
            actor.organizationId,
            assignmentId,
            tx
          );
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
          }

          const isAssigned = await repo.isTeacherAssignedToClassInOrg(
            actor.organizationId,
            existing.classId,
            actor.teacherMembershipId,
            tx
          );
          if (!isAssigned) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'update_targets_unassigned_teacher',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Bạn không được phân công phụ trách lớp của bài tập này.'
            );
          }

          if (
            existing.createdByTeacherMembershipId !== actor.teacherMembershipId
          ) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'update_targets_non_creator_blocked',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Chỉ giáo viên đã tạo bài tập mới có quyền thay đổi danh sách học sinh nhận bài tập.'
            );
          }

          if (existing.status === 'closed' || existing.status === 'archived') {
            throw ApiErrors.conflict(
              'ASSIGNMENT_CLOSED',
              'error.assignment.closed',
              'Bài tập đã đóng hoặc đã lưu trữ, không thể thay đổi danh sách học sinh.'
            );
          }

          const cls = await repo.findClassByIdInOrg(
            actor.organizationId,
            existing.classId,
            tx
          );
          if (!cls || cls.status !== 'active') {
            throw ApiErrors.conflict(
              'CLASS_NOT_ACTIVE',
              'error.class.not_active',
              'Lớp học của bài tập không còn ở trạng thái hoạt động.'
            );
          }

          const eligibleStudents = await repo.findEligibleStudentsInClass(
            actor.organizationId,
            existing.classId,
            targetStudentMembershipIds,
            tx
          );
          const eligibleById = new Map(
            eligibleStudents.map((s) => [s.membershipId, s])
          );

          for (const studentMembershipId of targetStudentMembershipIds) {
            const found = eligibleById.get(studentMembershipId);
            if (
              !found ||
              found.organizationId !== actor.organizationId ||
              found.classId !== existing.classId ||
              found.role !== 'student' ||
              found.membershipStatus !== 'active' ||
              found.userStatus !== 'active' ||
              found.enrollmentStatus !== 'active'
            ) {
              throw ApiErrors.conflict(
                'TARGET_STUDENT_INELIGIBLE',
                'error.assignment.target_student_ineligible',
                'Học sinh được chọn không còn ghi danh hoạt động trong lớp học này hoặc không thuộc tổ chức.'
              );
            }
          }

          const currentTargets = await repo.listAssignmentTargetsWithStudents(
            actor.organizationId,
            existing.id,
            tx
          );
          const currentByStudentId = new Map(
            currentTargets.map((t) => [t.studentMembershipId, t])
          );
          const requestedSet = new Set(targetStudentMembershipIds);

          const toRemove = currentTargets.filter(
            (t) => !requestedSet.has(t.studentMembershipId)
          );
          const toAddStudentIds = targetStudentMembershipIds.filter(
            (studentId) => !currentByStudentId.has(studentId)
          );

          if (toRemove.length > 0) {
            const blockedTargetIds = await repo.findTargetIdsWithActivity(
              actor.organizationId,
              existing.id,
              toRemove.map((t) => t.targetId),
              tx
            );
            if (blockedTargetIds.length > 0) {
              throw ApiErrors.conflict(
                'TARGET_HAS_ACTIVITY',
                'error.assignment.target_has_activity',
                'Không thể gỡ học sinh đã phát sinh lượt thực hành hoặc tiến độ trên bài tập này.'
              );
            }
          }

          await repo.syncAssignmentTargets(
            {
              organizationId: actor.organizationId,
              assignmentId: existing.id,
              inserts: toAddStudentIds.map((studentMembershipId) => ({
                id: generateUuidV7(),
                organizationId: actor.organizationId,
                assignmentId: existing.id,
                studentMembershipId,
                assignedAt: now,
              })),
              deleteTargetIds: toRemove.map((t) => t.targetId),
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'assignment.targets_updated',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                classId: existing.classId,
                addedCount: toAddStudentIds.length,
                removedCount: toRemove.length,
                totalTargets: targetStudentMembershipIds.length,
              },
            },
            tx
          );

          return repo.listAssignmentTargetsWithStudents(
            actor.organizationId,
            existing.id,
            tx
          );
        });

        return {
          assignmentId,
          targets: updatedTargets.map(toSafeTargetView),
        };
      } catch (err: unknown) {
        if (deferredSecurityAudit) {
          await safeAudit(deferredSecurityAudit).catch(() => undefined);
        }
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          const meta = extractDatabaseErrorMeta(err);
          if (meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062) {
            throw ApiErrors.conflict(
              'DUPLICATE_TARGET_STUDENT',
              'error.assignment.duplicate_target_student',
              'Học sinh đã có trong danh sách nhận bài tập.'
            );
          }
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async closeAssignment(
      assignmentId: string,
      actor: TeacherAssignmentActorContext
    ) {
      const now = nowFn();
      let deferredSecurityAudit: Parameters<typeof recordAuditEvent>[0] | null = null;

      try {
        const closed = await repo.withTransaction(async (tx) => {
          const existing = await repo.findAssignmentByIdInOrgForUpdate(
            actor.organizationId,
            assignmentId,
            tx
          );
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
          }

          const isAssigned = await repo.isTeacherAssignedToClassInOrg(
            actor.organizationId,
            existing.classId,
            actor.teacherMembershipId,
            tx
          );
          if (!isAssigned) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'close_assignment_unassigned_teacher',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Bạn không được phân công phụ trách lớp của bài tập này.'
            );
          }

          if (
            existing.createdByTeacherMembershipId !== actor.teacherMembershipId
          ) {
            deferredSecurityAudit = {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'security.unauthorized_access_denied',
              targetType: 'assignment',
              targetId: existing.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                action: 'close_assignment_non_creator_blocked',
                classId: existing.classId,
              },
            };
            throw ApiErrors.forbidden(
              'Chỉ giáo viên đã tạo bài tập mới có quyền đóng bài tập này.'
            );
          }

          if (existing.status === 'closed' || existing.status === 'archived') {
            throw ApiErrors.conflict(
              'ASSIGNMENT_CLOSED',
              'error.assignment.closed',
              'Bài tập đã ở trạng thái đóng hoặc lưu trữ.'
            );
          }

          const next = await repo.updateAssignmentFields(
            {
              organizationId: actor.organizationId,
              assignmentId: existing.id,
              status: 'closed',
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
          }

          await safeAudit(
            {
              organizationId: actor.organizationId,
              actorUserId: actor.actorUserId,
              actorRole: 'teacher',
              eventType: 'assignment.closed',
              targetType: 'assignment',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                classId: existing.classId,
                previousStatus: existing.status,
                status: 'closed',
              },
            },
            tx
          );

          return next;
        });

        return {
          assignment: toSafeTeacherAssignmentView(
            closed,
            actor.teacherMembershipId,
            now
          ),
        };
      } catch (err: unknown) {
        if (deferredSecurityAudit) {
          await safeAudit(deferredSecurityAudit).catch(() => undefined);
        }
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async getTeacherAssignmentProgress(
      assignmentId: string,
      actor: TeacherAssignmentActorContext
    ) {
      const existing = await repo.findAssignmentByIdInOrg(
        actor.organizationId,
        assignmentId
      );
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy bài tập trong tổ chức.');
      }

      const isAssigned = await repo.isTeacherAssignedToClassInOrg(
        actor.organizationId,
        existing.classId,
        actor.teacherMembershipId
      );
      if (!isAssigned) {
        await safeAudit({
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          actorRole: 'teacher',
          eventType: 'security.unauthorized_access_denied',
          targetType: 'assignment',
          targetId: existing.id,
          ipPrefix: actor.ipPrefix,
          metadata: {
            action: 'view_assignment_progress_unassigned_teacher',
            classId: existing.classId,
          },
        }).catch(() => undefined);
        throw ApiErrors.forbidden(
          'Bạn không được phân công phụ trách lớp của bài tập này.'
        );
      }

      const items = await repo.listAssignmentItemsWithPinnedContent(
        actor.organizationId,
        existing.id
      );
      const progressRows = await repo.listAssignmentProgressSummary(
        actor.organizationId,
        existing.id,
        items.length
      );

      return {
        assignment: toSafeTeacherAssignmentView(
          existing,
          actor.teacherMembershipId,
          nowFn(),
          existing.className
        ),
        totalItems: items.length,
        targets: progressRows.map(toSafeProgressRow),
      };
    },

    async listStudentAssignments(
      query: {
        status?: 'active' | 'closed';
        page: number;
        limit: number;
      },
      actor: StudentAssignmentActorContext
    ) {
      const now = nowFn();
      const result = await repo.listAssignmentsForStudent({
        organizationId: actor.organizationId,
        studentMembershipId: actor.studentMembershipId,
        status: query.status,
        page: query.page,
        limit: query.limit,
      });

      return {
        items: result.items.map(
          (row: StudentAssignmentListRow): SafeStudentAssignmentListItemView => {
            const safeStatus: 'active' | 'closed' =
              row.assignment.status === 'closed' ? 'closed' : 'active';
            const progress = row.progress ?? {
              hasProgressRecord: false,
              status: 'not_started',
              totalItems: row.itemCount,
              completedItems: 0,
              attemptCount: 0,
              lastActivityAt: null,
              completedAt: null,
            };

            return {
              id: row.assignment.id,
              organizationId: row.assignment.organizationId,
              classId: row.assignment.classId,
              className: row.className,
              targetId: row.targetId,
              title: row.assignment.title,
              status: safeStatus,
              isReadOnly: safeStatus === 'closed',
              dueAt: row.assignment.dueAt
                ? row.assignment.dueAt.toISOString()
                : null,
              isPastDue: computeIsPastDue(row.assignment.dueAt, now),
              homePracticeInstructions: row.assignment.homePracticeInstructions,
              homePractice: toHomePracticeView(
                row.assignment.homePracticeInstructions
              ),
              itemCount: row.itemCount,
              assignedAt: row.assignedAt.toISOString(),
              createdAt: row.assignment.createdAt.toISOString(),
              updatedAt: row.assignment.updatedAt.toISOString(),
              progress: {
                hasProgressRecord: progress.hasProgressRecord,
                status: progress.status,
                totalItems: progress.totalItems,
                completedItems: progress.completedItems,
                attemptCount: progress.attemptCount,
                lastActivityAt: progress.lastActivityAt
                  ? progress.lastActivityAt.toISOString()
                  : null,
                completedAt: progress.completedAt
                  ? progress.completedAt.toISOString()
                  : null,
              },
            };
          }
        ),
        page: query.page,
        limit: query.limit,
        total: result.total,
      };
    },

    async getStudentAssignmentDetail(
      assignmentId: string,
      actor: StudentAssignmentActorContext
    ): Promise<SafeStudentAssignmentDetailView> {
      const detail = await repo.findAssignmentForStudentById({
        organizationId: actor.organizationId,
        assignmentId,
        studentMembershipId: actor.studentMembershipId,
      });
      if (!detail) {
        throw ApiErrors.notFound(
          'Không tìm thấy bài tập được giao cho tài khoản của con.'
        );
      }

      const pinnedItems = await repo.listAssignmentItemsWithPinnedContent(
        actor.organizationId,
        detail.assignment.id
      );

      const now = nowFn();
      const safeStatus: 'active' | 'closed' =
        detail.assignment.status === 'closed' ? 'closed' : 'active';
      const mappedItems = pinnedItems.map((row) => {
        const view = toSafePinnedItemView(row);
        const { versionStatus: _omitted, ...childSafeItem } = view;
        return childSafeItem;
      });

      const progressSnapshot: SafeStudentProgressSnapshot = detail.progress
        ? {
            hasProgressRecord: detail.progress.hasProgressRecord,
            status: detail.progress.status,
            totalItems: detail.progress.totalItems,
            completedItems: detail.progress.completedItems,
            attemptCount: detail.progress.attemptCount,
            lastActivityAt: detail.progress.lastActivityAt
              ? detail.progress.lastActivityAt.toISOString()
              : null,
            completedAt: detail.progress.completedAt
              ? detail.progress.completedAt.toISOString()
              : null,
          }
        : {
            hasProgressRecord: false,
            status: 'not_started',
            totalItems: mappedItems.length,
            completedItems: 0,
            attemptCount: 0,
            lastActivityAt: null,
            completedAt: null,
          };

      const dueAtIso = detail.assignment.dueAt
        ? detail.assignment.dueAt.toISOString()
        : null;

      return {
        id: detail.assignment.id,
        organizationId: detail.assignment.organizationId,
        classId: detail.assignment.classId,
        className: detail.className,
        targetId: detail.targetId,
        title: detail.assignment.title,
        status: safeStatus,
        isReadOnly: safeStatus === 'closed',
        dueAt: dueAtIso,
        isPastDue: computeIsPastDue(detail.assignment.dueAt, now),
        homePracticeInstructions: detail.assignment.homePracticeInstructions,
        homePractice: {
          hasInstructions:
            detail.assignment.homePracticeInstructions !== null &&
            detail.assignment.homePracticeInstructions.length > 0,
          instructions: detail.assignment.homePracticeInstructions,
          printableGuide: {
            assignmentTitle: detail.assignment.title,
            className: detail.className,
            dueAt: dueAtIso,
            instructions: detail.assignment.homePracticeInstructions,
            activityTitles: mappedItems.map((item) => item.title),
          },
        },
        assignedAt: detail.assignedAt.toISOString(),
        createdAt: detail.assignment.createdAt.toISOString(),
        updatedAt: detail.assignment.updatedAt.toISOString(),
        items: mappedItems,
        progress: progressSnapshot,
      };
    },
  };
}

export type AssignmentService = ReturnType<typeof createAssignmentService>;
