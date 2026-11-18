import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { GOAL_STATUSES } from '../repositories/goal.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createGoalService,
  type GoalService,
} from '../services/goal.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const membershipIdParamsSchema = z.object({
  membershipId: z.string().trim().regex(UUID_REGEX),
});

const goalIdParamsSchema = z.object({
  goalId: z.string().trim().regex(UUID_REGEX),
});

const listGoalsQuerySchema = z.object({
  status: z.enum(GOAL_STATUSES).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listStudentSelfGoalsQuerySchema = z.object({
  status: z.enum(['active', 'achieved', 'paused']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updateStudentProfileBodySchema = z
  .object({
    preferredName: z.string().trim().max(255).nullable().optional(),
    supportPreferencesJson: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.preferredName !== undefined ||
      val.supportPreferencesJson !== undefined,
    {
      message: 'Cần cung cấp ít nhất một trường để cập nhật hồ sơ học sinh.',
    }
  );

const createStudentGoalBodySchema = z
  .object({
    classId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    focusArea: z.string().trim().max(64).nullable().optional(),
    targetDate: z.string().trim().max(16).nullable().optional(),
  })
  .strict();

const updateStudentGoalBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    focusArea: z.string().trim().max(64).nullable().optional(),
    status: z.enum(GOAL_STATUSES).optional(),
    targetDate: z.string().trim().max(16).nullable().optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.title !== undefined ||
      val.description !== undefined ||
      val.focusArea !== undefined ||
      val.status !== undefined ||
      val.targetDate !== undefined,
    {
      message: 'Cần cung cấp ít nhất một trường để cập nhật mục tiêu.',
    }
  );

function respondMethodNotAllowed(res: Response, allowed: string): void {
  const err = ApiErrors.methodNotAllowed();
  res.set('Allow', allowed).status(405).json({
    status: 'error',
    code: err.code,
    messageKey: err.messageKey,
    message: err.message,
    locale: 'vi-VN',
  });
}

export interface GoalsRoutersDeps {
  goalService?: GoalService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createGoalsRouters(deps?: GoalsRoutersDeps) {
  const goalService = deps?.goalService ?? createGoalService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireTeacherInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  const requireStudentInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('student'),
  ] as const;

  const teacherStudentGoalsRouter = Router();

  teacherStudentGoalsRouter
    .route('/:membershipId/profile')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          membershipIdParamsSchema,
          req.params,
          'params'
        );
        const profile = await goalService.getStudentProfileForTeacher(
          params.membershipId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          profile,
        });
      })
    )
    .patch(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          membershipIdParamsSchema,
          req.params,
          'params'
        );
        const rawBody =
          req.body && typeof req.body === 'object'
            ? (req.body as Record<string, unknown>)
            : {};
        const body = validateWithSchema(
          updateStudentProfileBodySchema,
          rawBody,
          'body'
        );
        const profile = await goalService.updateStudentProfileForTeacher(
          params.membershipId,
          {
            preferredName: body.preferredName,
            supportPreferencesJson: body.supportPreferencesJson,
            hasPreferredName: Object.prototype.hasOwnProperty.call(
              rawBody,
              'preferredName'
            ),
            hasSupportPreferencesJson: Object.prototype.hasOwnProperty.call(
              rawBody,
              'supportPreferencesJson'
            ),
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          profile,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  teacherStudentGoalsRouter
    .route('/:membershipId/goals')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          membershipIdParamsSchema,
          req.params,
          'params'
        );
        const query = validateWithSchema(
          listGoalsQuerySchema,
          req.query,
          'query'
        );
        const result = await goalService.listStudentGoalsForTeacher(
          params.membershipId,
          {
            status: query.status,
            includeArchived: query.includeArchived === 'true',
            page: query.page,
            limit: query.limit,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .post(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          membershipIdParamsSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          createStudentGoalBodySchema,
          req.body ?? {},
          'body'
        );
        const goal = await goalService.createStudentGoalForTeacher(
          params.membershipId,
          body,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({
          status: 'ok',
          goal,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  const teacherGoalsRouter = Router();

  teacherGoalsRouter
    .route('/:goalId')
    .patch(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          goalIdParamsSchema,
          req.params,
          'params'
        );
        const rawBody =
          req.body && typeof req.body === 'object'
            ? (req.body as Record<string, unknown>)
            : {};
        const body = validateWithSchema(
          updateStudentGoalBodySchema,
          rawBody,
          'body'
        );
        const goal = await goalService.updateGoalForTeacher(
          params.goalId,
          {
            title: body.title,
            description: body.description,
            focusArea: body.focusArea,
            status: body.status,
            targetDate: body.targetDate,
            hasDescription: Object.prototype.hasOwnProperty.call(
              rawBody,
              'description'
            ),
            hasFocusArea: Object.prototype.hasOwnProperty.call(
              rawBody,
              'focusArea'
            ),
            hasTargetDate: Object.prototype.hasOwnProperty.call(
              rawBody,
              'targetDate'
            ),
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          goal,
        });
      })
    )
    .delete(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          goalIdParamsSchema,
          req.params,
          'params'
        );
        const goal = await goalService.archiveGoalForTeacher(params.goalId, {
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          goal,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'PATCH, DELETE'));

  const studentGoalsRouter = Router();

  studentGoalsRouter
    .route('/profile')
    .get(
      ...requireStudentInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const profile = await goalService.getSelfProfileForStudent({
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          studentMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          profile,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentGoalsRouter
    .route('/goals')
    .get(
      ...requireStudentInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listStudentSelfGoalsQuerySchema,
          req.query,
          'query'
        );
        const result = await goalService.listSelfGoalsForStudent(
          {
            status: query.status,
            page: query.page,
            limit: query.limit,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return {
    teacherStudentGoalsRouter,
    teacherGoalsRouter,
    studentGoalsRouter,
  };
}
