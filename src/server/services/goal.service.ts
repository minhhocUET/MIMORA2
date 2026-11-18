import { z } from 'zod';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, type ApiErrorDetail, AppError } from '../http/errors.ts';
import {
  createGoalRepository,
  GOAL_STATUSES,
  type GoalDbOrTx,
  type GoalRepository,
  type GoalStatus,
  type StudentGoalRecord,
  type StudentProfileRecord,
} from '../repositories/goal.repository.ts';
import { scanUnsafeSelText } from '../validators/content-payload.schema.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
  type RecordAuditEventInput,
} from './audit.service.ts';

export interface TeacherGoalActorContext {
  actorUserId: string;
  organizationId: string;
  teacherMembershipId: string;
  ipPrefix: string | null;
}

export interface StudentSelfActorContext {
  actorUserId: string;
  organizationId: string;
  studentMembershipId: string;
  ipPrefix: string | null;
}

export interface SafeStudentProfileView {
  id: string | null;
  organizationId: string;
  studentMembershipId: string;
  preferredName: string | null;
  supportPreferencesJson: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SafeStudentGoalView {
  id: string;
  organizationId: string;
  studentMembershipId: string;
  classId: string | null;
  createdByTeacherMembershipId: string;
  title: string;
  description: string | null;
  focusArea: string | null;
  status: GoalStatus;
  targetDate: string | null;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateStudentProfileInput {
  preferredName?: string | null;
  supportPreferencesJson?: Record<string, unknown> | null;
  hasPreferredName?: boolean;
  hasSupportPreferencesJson?: boolean;
}

export interface CreateStudentGoalInput {
  classId?: string | null;
  title: string;
  description?: string | null;
  focusArea?: string | null;
  targetDate?: string | null;
}

export interface UpdateStudentGoalInput {
  title?: string;
  description?: string | null;
  focusArea?: string | null;
  status?: GoalStatus;
  targetDate?: string | null;
  hasDescription?: boolean;
  hasFocusArea?: boolean;
  hasTargetDate?: boolean;
}

export interface ListStudentGoalsQuery {
  status?: GoalStatus;
  includeArchived?: boolean;
  page: number;
  limit: number;
}

export interface GoalServiceDeps {
  goalRepo?: GoalRepository;
  now?: () => Date;
  auditLogger?: (
    input: RecordAuditEventInput,
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keys banned inside student_profiles.support_preferences_json to preserve
 * MIMORA's non-diagnostic, non-gamified SEL architecture.
 */
const FORBIDDEN_SUPPORT_PREF_KEYS = new Set([
  'diagnosis',
  'clinicaldiagnosis',
  'disorder',
  'autismlevel',
  'adhd',
  'iq',
  'iqscore',
  'score',
  'scores',
  'points',
  'rank',
  'ranking',
  'leaderboard',
  'timer',
  'timelimit',
  'countdown',
  'penalty',
  'punishment',
  'psychologicalprofile',
  'clinicalnotes',
]);

const ADDITIONAL_GOAL_UNSAFE_PATTERNS: ReadonlyArray<{
  code: string;
  pattern: RegExp;
  message: string;
}> = [
  {
    code: 'UNSAFE_DIAGNOSIS_LABEL',
    pattern:
      /\b(rối loạn phổ tự kỷ|chứng tự kỷ nặng|tâm thần phân liệt|chẩn đoán y khoa|icd-10|dsm-5|iq thấp|clinical disorder|mental disorder)\b/i,
    message:
      'Mục tiêu SEL hoặc tùy chọn hỗ trợ không được gắn nhãn chẩn đoán lâm sàng hoặc y khoa.',
  },
  {
    code: 'UNSAFE_RANKING_COMPARISON',
    pattern:
      /\b(đứng nhất lớp|vượt mặt bạn|xếp hạng học sinh|top student|rank #?\d+|beat classmates)\b/i,
    message:
      'Mục tiêu SEL phải mang tính hỗ trợ cá nhân, không so sánh xếp hạng giữa học sinh.',
  },
];

export const STUDENT_SUPPORT_PREFERENCES_SCHEMA = z
  .object({
    preferredCommunicationMode: z
      .enum(['aac', 'read_aloud', 'visual', 'mixed'])
      .optional(),
    aacEnabled: z.boolean().optional(),
    readAloudEnabled: z.boolean().optional(),
    speechRate: z.enum(['slow', 'normal']).optional(),
    visualContrast: z.enum(['standard', 'high_contrast', 'soft']).optional(),
    reducedMotion: z.boolean().optional(),
    preferredVisualCues: z
      .array(z.string().trim().min(1).max(64))
      .max(10)
      .optional(),
    sensoryNotes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

function scanSelGoalOrSupportText(
  text: string,
  field: string
): ApiErrorDetail[] {
  const details = [...scanUnsafeSelText(text, field)];
  for (const rule of ADDITIONAL_GOAL_UNSAFE_PATTERNS) {
    if (rule.pattern.test(text)) {
      details.push({
        field,
        code: rule.code,
        messageKey: 'error.sel.unsafe_text',
        message: rule.message,
      });
    }
  }
  return details;
}

function scanSupportPreferencesSafety(
  value: unknown,
  path: string,
  details: ApiErrorDetail[]
): void {
  if (typeof value === 'string') {
    details.push(...scanSelGoalOrSupportText(value, path));
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      scanSupportPreferencesSafety(value[i], `${path}[${i}]`, details);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_SUPPORT_PREF_KEYS.has(norm)) {
        details.push({
          field: `${path}.${key}`,
          code: 'FORBIDDEN_SUPPORT_PREFERENCE_KEY',
          messageKey: 'error.profile.forbidden_preference_key',
          message: `Trường "${key}" không được phép vì vi phạm nguyên tắc hỗ trợ SEL phi chẩn đoán.`,
        });
        continue;
      }
      scanSupportPreferencesSafety(child, `${path}.${key}`, details);
    }
  }
}

export function validateSupportPreferencesJson(
  raw: unknown
): Record<string, unknown> | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const safetyDetails: ApiErrorDetail[] = [];
  scanSupportPreferencesSafety(raw, 'body.supportPreferencesJson', safetyDetails);
  if (safetyDetails.length > 0) {
    throw ApiErrors.validation(safetyDetails);
  }

  const parsed = STUDENT_SUPPORT_PREFERENCES_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw ApiErrors.validation(
      parsed.error.issues.map((issue) => ({
        field: `body.supportPreferencesJson.${
          issue.path.map(String).join('.') || '_root'
        }`,
        code: `INVALID_${issue.code.toUpperCase()}`,
        messageKey: 'error.profile.invalid_support_preferences',
        message: 'Cấu trúc supportPreferencesJson không hợp lệ.',
      }))
    );
  }

  return parsed.data as Record<string, unknown>;
}

export function validateCalendarDateString(
  dateStr: string,
  field: string
): string {
  const trimmed = dateStr.trim();
  if (!DATE_YYYY_MM_DD_REGEX.test(trimmed)) {
    throw ApiErrors.validation([
      {
        field,
        code: 'INVALID_DATE_FORMAT',
        messageKey: 'error.validation.invalid_date',
        message: 'Ngày phải có định dạng YYYY-MM-DD.',
      },
    ]);
  }
  const [y, m, d] = trimmed.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== m - 1 ||
    utc.getUTCDate() !== d
  ) {
    throw ApiErrors.validation([
      {
        field,
        code: 'INVALID_CALENDAR_DATE',
        messageKey: 'error.validation.invalid_calendar_date',
        message: 'Ngày dương lịch không tồn tại.',
      },
    ]);
  }
  return trimmed;
}

function toSafeStudentProfileView(
  organizationId: string,
  studentMembershipId: string,
  record: StudentProfileRecord | null
): SafeStudentProfileView {
  if (!record) {
    return {
      id: null,
      organizationId,
      studentMembershipId,
      preferredName: null,
      supportPreferencesJson: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    id: record.id,
    organizationId: record.organizationId,
    studentMembershipId: record.studentMembershipId,
    preferredName: record.preferredName,
    supportPreferencesJson: record.supportPreferencesJson ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSafeStudentGoalView(record: StudentGoalRecord): SafeStudentGoalView {
  const status = GOAL_STATUSES.includes(record.status as GoalStatus)
    ? (record.status as GoalStatus)
    : 'active';
  return {
    id: record.id,
    organizationId: record.organizationId,
    studentMembershipId: record.studentMembershipId,
    classId: record.classId,
    createdByTeacherMembershipId: record.createdByTeacherMembershipId,
    title: record.title,
    description: record.description,
    focusArea: record.focusArea,
    status,
    targetDate: record.targetDate,
    achievedAt: record.achievedAt ? record.achievedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createGoalService(deps?: GoalServiceDeps) {
  const repo = deps?.goalRepo ?? createGoalRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const logAudit =
    deps?.auditLogger ??
    ((input: RecordAuditEventInput, executor?: AuditInsertExecutor) =>
      recordAuditEvent(input, executor));

  async function safeEmitSecurityAudit(
    actor: {
      actorUserId: string;
      organizationId: string;
      role: 'teacher' | 'student';
      ipPrefix: string | null;
    },
    eventType:
      | 'security.unauthorized_access_denied'
      | 'security.cross_tenant_attempt_blocked',
    targetType: 'student_profile' | 'student_goal',
    targetId: string | null,
    reason: string
  ): Promise<void> {
    try {
      await logAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.actorUserId,
        actorRole: actor.role,
        eventType,
        targetType,
        targetId,
        ipPrefix: actor.ipPrefix,
        metadata: {
          targetKind: targetType,
          reason,
        },
      });
    } catch {
      // Never suppress primary auth/tenant error
    }
  }

  async function assertActiveTeacherActor(
    actor: TeacherGoalActorContext,
    executor?: GoalDbOrTx
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

  async function assertActiveStudentSelfActor(
    actor: StudentSelfActorContext,
    executor?: GoalDbOrTx
  ): Promise<void> {
    const student = await repo.findMembershipInOrg(
      actor.organizationId,
      actor.studentMembershipId,
      executor
    );
    if (
      !student ||
      student.userId !== actor.actorUserId ||
      student.role !== 'student' ||
      student.status !== 'active' ||
      student.userStatus !== 'active' ||
      student.organizationStatus !== 'active'
    ) {
      throw ApiErrors.forbidden(
        'Tài khoản học sinh hoặc tổ chức hiện tại không ở trạng thái hoạt động.'
      );
    }
  }

  async function ensureTeacherAssignedStudentAccess(
    actor: TeacherGoalActorContext,
    studentMembershipId: string,
    targetType: 'student_profile' | 'student_goal',
    executor?: GoalDbOrTx
  ): Promise<string[]> {
    const student = await repo.findMembershipInOrg(
      actor.organizationId,
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
      await safeEmitSecurityAudit(
        {
          actorUserId: actor.actorUserId,
          organizationId: actor.organizationId,
          role: 'teacher',
          ipPrefix: actor.ipPrefix,
        },
        'security.cross_tenant_attempt_blocked',
        targetType,
        null,
        'student_not_active_in_org'
      );
      throw new AppError({
        httpStatus: 404,
        code: 'STUDENT_NOT_FOUND',
        messageKey: 'error.goal.student_not_found',
        message:
          'Không tìm thấy học sinh đang hoạt động trong tổ chức hiện tại.',
      });
    }

    const sharedClassIds = await repo.findSharedActiveClassIds(
      actor.organizationId,
      actor.teacherMembershipId,
      studentMembershipId,
      executor
    );
    if (sharedClassIds.length === 0) {
      await safeEmitSecurityAudit(
        {
          actorUserId: actor.actorUserId,
          organizationId: actor.organizationId,
          role: 'teacher',
          ipPrefix: actor.ipPrefix,
        },
        'security.unauthorized_access_denied',
        targetType,
        null,
        'teacher_not_assigned_to_student_active_class'
      );
      throw ApiErrors.forbidden(
        'Bạn chỉ có quyền truy cập hồ sơ và mục tiêu của học sinh thuộc lớp mình phụ trách.'
      );
    }

    return sharedClassIds;
  }

  function validateGoalTextFields(fields: {
    title?: string;
    description?: string | null;
    focusArea?: string | null;
  }): void {
    const details: ApiErrorDetail[] = [];

    if (fields.title !== undefined) {
      const trimmedTitle = fields.title.trim();
      if (trimmedTitle.length === 0) {
        details.push({
          field: 'body.title',
          code: 'EMPTY_GOAL_TITLE',
          messageKey: 'error.goal.empty_title',
          message: 'Tiêu đề mục tiêu SEL không được để trống.',
        });
      } else {
        details.push(...scanSelGoalOrSupportText(trimmedTitle, 'body.title'));
      }
    }

    if (fields.description !== undefined && fields.description !== null) {
      details.push(
        ...scanSelGoalOrSupportText(fields.description, 'body.description')
      );
    }

    if (fields.focusArea !== undefined && fields.focusArea !== null) {
      const trimmedFocus = fields.focusArea.trim();
      if (trimmedFocus.length === 0) {
        details.push({
          field: 'body.focusArea',
          code: 'EMPTY_FOCUS_AREA',
          messageKey: 'error.goal.empty_focus_area',
          message: 'Lĩnh vực trọng tâm (focusArea) không được chỉ chứa khoảng trắng.',
        });
      } else {
        details.push(
          ...scanSelGoalOrSupportText(trimmedFocus, 'body.focusArea')
        );
      }
    }

    if (details.length > 0) {
      throw ApiErrors.validation(details);
    }
  }

  return {
    async getStudentProfileForTeacher(
      studentMembershipId: string,
      actor: TeacherGoalActorContext
    ): Promise<SafeStudentProfileView> {
      await assertActiveTeacherActor(actor);
      await ensureTeacherAssignedStudentAccess(
        actor,
        studentMembershipId,
        'student_profile'
      );

      const profile = await repo.findStudentProfile(
        actor.organizationId,
        studentMembershipId
      );
      return toSafeStudentProfileView(
        actor.organizationId,
        studentMembershipId,
        profile
      );
    },

    async updateStudentProfileForTeacher(
      studentMembershipId: string,
      input: UpdateStudentProfileInput,
      actor: TeacherGoalActorContext
    ): Promise<SafeStudentProfileView> {
      let validatedPreferredName: string | null | undefined;
      if (input.hasPreferredName) {
        if (input.preferredName === null || input.preferredName === undefined) {
          validatedPreferredName = null;
        } else {
          const trimmed = input.preferredName.trim();
          if (trimmed.length === 0) {
            validatedPreferredName = null;
          } else {
            const nameIssues = scanSelGoalOrSupportText(
              trimmed,
              'body.preferredName'
            );
            if (nameIssues.length > 0) {
              throw ApiErrors.validation(nameIssues);
            }
            validatedPreferredName = trimmed;
          }
        }
      }

      const validatedPreferences = input.hasSupportPreferencesJson
        ? validateSupportPreferencesJson(input.supportPreferencesJson)
        : undefined;

      await assertActiveTeacherActor(actor);
      await ensureTeacherAssignedStudentAccess(
        actor,
        studentMembershipId,
        'student_profile'
      );

      const saved = await repo.withTransaction(async (tx) => {
        await assertActiveTeacherActor(actor, tx);
        return repo.upsertStudentProfile(
          {
            id: generateUuidV7(),
            organizationId: actor.organizationId,
            studentMembershipId,
            preferredName: validatedPreferredName,
            supportPreferencesJson: validatedPreferences,
            hasPreferredName: Boolean(input.hasPreferredName),
            hasSupportPreferencesJson: Boolean(input.hasSupportPreferencesJson),
            now: nowFn(),
          },
          tx
        );
      });

      return toSafeStudentProfileView(
        actor.organizationId,
        studentMembershipId,
        saved
      );
    },

    async listStudentGoalsForTeacher(
      studentMembershipId: string,
      query: ListStudentGoalsQuery,
      actor: TeacherGoalActorContext
    ) {
      await assertActiveTeacherActor(actor);
      await ensureTeacherAssignedStudentAccess(
        actor,
        studentMembershipId,
        'student_goal'
      );

      const { items, total } = await repo.listStudentGoals({
        organizationId: actor.organizationId,
        studentMembershipId,
        status: query.status,
        includeArchived: query.includeArchived ?? false,
        page: query.page,
        limit: query.limit,
      });

      return {
        items: items.map(toSafeStudentGoalView),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
        },
      };
    },

    async createStudentGoalForTeacher(
      studentMembershipId: string,
      input: CreateStudentGoalInput,
      actor: TeacherGoalActorContext
    ): Promise<SafeStudentGoalView> {
      validateGoalTextFields({
        title: input.title,
        description: input.description,
        focusArea: input.focusArea,
      });

      const validatedTargetDate =
        input.targetDate !== undefined && input.targetDate !== null
          ? validateCalendarDateString(input.targetDate, 'body.targetDate')
          : null;

      await assertActiveTeacherActor(actor);
      const sharedClassIds = await ensureTeacherAssignedStudentAccess(
        actor,
        studentMembershipId,
        'student_goal'
      );

      const requestedClassId = input.classId ?? null;
      if (requestedClassId !== null && !sharedClassIds.includes(requestedClassId)) {
        await safeEmitSecurityAudit(
          {
            actorUserId: actor.actorUserId,
            organizationId: actor.organizationId,
            role: 'teacher',
            ipPrefix: actor.ipPrefix,
          },
          'security.unauthorized_access_denied',
          'student_goal',
          null,
          'teacher_or_student_not_active_in_target_class'
        );
        throw ApiErrors.forbidden(
          'Cả giáo viên và học sinh đều phải thuộc lớp học hoạt động được chỉ định.'
        );
      }

      const now = nowFn();
      const created = await repo.withTransaction(async (tx) => {
        await assertActiveTeacherActor(actor, tx);
        return repo.insertStudentGoal(
          {
            id: generateUuidV7(),
            organizationId: actor.organizationId,
            studentMembershipId,
            classId: requestedClassId,
            createdByTeacherMembershipId: actor.teacherMembershipId,
            title: input.title.trim(),
            description:
              input.description !== undefined && input.description !== null
                ? input.description.trim()
                : null,
            focusArea:
              input.focusArea !== undefined && input.focusArea !== null
                ? input.focusArea.trim()
                : null,
            status: 'active',
            targetDate: validatedTargetDate,
            achievedAt: null,
            createdAt: now,
            updatedAt: now,
          },
          tx
        );
      });

      return toSafeStudentGoalView(created);
    },

    async updateGoalForTeacher(
      goalId: string,
      input: UpdateStudentGoalInput,
      actor: TeacherGoalActorContext
    ): Promise<SafeStudentGoalView> {
      validateGoalTextFields({
        title: input.title,
        description: input.hasDescription ? input.description : undefined,
        focusArea: input.hasFocusArea ? input.focusArea : undefined,
      });

      const validatedTargetDate =
        input.hasTargetDate &&
        input.targetDate !== undefined &&
        input.targetDate !== null
          ? validateCalendarDateString(input.targetDate, 'body.targetDate')
          : input.targetDate ?? null;

      await assertActiveTeacherActor(actor);

      const existing = await repo.findStudentGoalByIdInOrg(
        actor.organizationId,
        goalId
      );
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy mục tiêu SEL.');
      }

      const sharedClassIds = await ensureTeacherAssignedStudentAccess(
        actor,
        existing.studentMembershipId,
        'student_goal'
      );

      if (existing.classId !== null && !sharedClassIds.includes(existing.classId)) {
        const assignedToGoalClass = await repo.isTeacherAssignedToActiveClass(
          actor.organizationId,
          actor.teacherMembershipId,
          existing.classId
        );
        if (!assignedToGoalClass) {
          await safeEmitSecurityAudit(
            {
              actorUserId: actor.actorUserId,
              organizationId: actor.organizationId,
              role: 'teacher',
              ipPrefix: actor.ipPrefix,
            },
            'security.unauthorized_access_denied',
            'student_goal',
            goalId,
            'teacher_not_assigned_to_goal_class'
          );
          throw ApiErrors.forbidden(
            'Bạn không được phân công lớp học gắn với mục tiêu này.'
          );
        }
      }

      const now = nowFn();
      let hasAchievedAt = false;
      let nextAchievedAt: Date | null = existing.achievedAt;

      if (input.status !== undefined) {
        if (input.status === 'achieved') {
          hasAchievedAt = true;
          nextAchievedAt = existing.achievedAt ?? now;
        } else if (input.status === 'active' || input.status === 'paused') {
          hasAchievedAt = true;
          nextAchievedAt = null;
        }
      }

      const updated = await repo.withTransaction(async (tx) => {
        await assertActiveTeacherActor(actor, tx);
        return repo.updateStudentGoalInOrg(
          {
            organizationId: actor.organizationId,
            goalId,
            title: input.title !== undefined ? input.title.trim() : undefined,
            description:
              input.hasDescription &&
              input.description !== undefined &&
              input.description !== null
                ? input.description.trim()
                : null,
            focusArea:
              input.hasFocusArea &&
              input.focusArea !== undefined &&
              input.focusArea !== null
                ? input.focusArea.trim()
                : null,
            status: input.status,
            targetDate: validatedTargetDate,
            achievedAt: nextAchievedAt,
            hasDescription: input.hasDescription,
            hasFocusArea: input.hasFocusArea,
            hasTargetDate: input.hasTargetDate,
            hasAchievedAt,
            now,
          },
          tx
        );
      });

      if (!updated) {
        throw ApiErrors.notFound('Không tìm thấy mục tiêu SEL.');
      }

      return toSafeStudentGoalView(updated);
    },

    async archiveGoalForTeacher(
      goalId: string,
      actor: TeacherGoalActorContext
    ): Promise<SafeStudentGoalView> {
      await assertActiveTeacherActor(actor);

      const existing = await repo.findStudentGoalByIdInOrg(
        actor.organizationId,
        goalId
      );
      if (!existing) {
        throw ApiErrors.notFound('Không tìm thấy mục tiêu SEL.');
      }

      const sharedClassIds = await ensureTeacherAssignedStudentAccess(
        actor,
        existing.studentMembershipId,
        'student_goal'
      );

      if (existing.classId !== null && !sharedClassIds.includes(existing.classId)) {
        const assignedToGoalClass = await repo.isTeacherAssignedToActiveClass(
          actor.organizationId,
          actor.teacherMembershipId,
          existing.classId
        );
        if (!assignedToGoalClass) {
          await safeEmitSecurityAudit(
            {
              actorUserId: actor.actorUserId,
              organizationId: actor.organizationId,
              role: 'teacher',
              ipPrefix: actor.ipPrefix,
            },
            'security.unauthorized_access_denied',
            'student_goal',
            goalId,
            'teacher_not_assigned_to_goal_class'
          );
          throw ApiErrors.forbidden(
            'Bạn không được phân công lớp học gắn với mục tiêu này.'
          );
        }
      }

      const archived = await repo.withTransaction(async (tx) => {
        await assertActiveTeacherActor(actor, tx);
        return repo.updateStudentGoalInOrg(
          {
            organizationId: actor.organizationId,
            goalId,
            status: 'archived',
            now: nowFn(),
          },
          tx
        );
      });

      if (!archived) {
        throw ApiErrors.notFound('Không tìm thấy mục tiêu SEL.');
      }

      return toSafeStudentGoalView(archived);
    },

    async getSelfProfileForStudent(
      actor: StudentSelfActorContext
    ): Promise<SafeStudentProfileView> {
      await assertActiveStudentSelfActor(actor);

      const profile = await repo.findStudentProfile(
        actor.organizationId,
        actor.studentMembershipId
      );
      return toSafeStudentProfileView(
        actor.organizationId,
        actor.studentMembershipId,
        profile
      );
    },

    async listSelfGoalsForStudent(
      query: ListStudentGoalsQuery,
      actor: StudentSelfActorContext
    ) {
      await assertActiveStudentSelfActor(actor);

      const { items, total } = await repo.listStudentGoals({
        organizationId: actor.organizationId,
        studentMembershipId: actor.studentMembershipId,
        status: query.status,
        includeArchived: false,
        page: query.page,
        limit: query.limit,
      });

      return {
        items: items.map(toSafeStudentGoalView),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
        },
      };
    },
  };
}

export type GoalService = ReturnType<typeof createGoalService>;
