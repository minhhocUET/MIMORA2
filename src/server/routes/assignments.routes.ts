import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import {
  ASSIGNMENT_STATUSES,
  STUDENT_VISIBLE_ASSIGNMENT_STATUSES,
} from '../repositories/assignment.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createAssignmentService,
  type AssignmentService,
} from '../services/assignment.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assignmentIdParamSchema = z.object({
  assignmentId: z.string().trim().regex(UUID_REGEX),
});

const listTeacherAssignmentsQuerySchema = z.object({
  classId: z.string().trim().regex(UUID_REGEX).optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listStudentAssignmentsQuerySchema = z.object({
  status: z.enum(STUDENT_VISIBLE_ASSIGNMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const assignmentItemInputSchema = z.object({
  contentVersionId: z.string().trim().regex(UUID_REGEX),
  sortOrder: z.number().int().min(0).max(1000),
  expectedContentItemId: z.string().trim().regex(UUID_REGEX).optional(),
});

const createAssignmentBodySchema = z.object({
  classId: z.string().trim().regex(UUID_REGEX),
  title: z.string().trim().min(1).max(255),
  homePracticeInstructions: z.string().trim().max(4000).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  status: z.enum(['draft', 'active']).optional(),
  items: z.array(assignmentItemInputSchema).min(1).max(50),
  targetStudentMembershipIds: z
    .array(z.string().trim().regex(UUID_REGEX))
    .min(1)
    .max(500),
});

const updateAssignmentBodySchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  homePracticeInstructions: z.string().trim().max(4000).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
});

const updateTargetsBodySchema = z.object({
  targetStudentMembershipIds: z
    .array(z.string().trim().regex(UUID_REGEX))
    .min(1)
    .max(500),
});

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

export interface AssignmentsRoutersDeps {
  assignmentService?: AssignmentService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAssignmentsRouters(deps?: AssignmentsRoutersDeps) {
  const assignmentService =
    deps?.assignmentService ?? createAssignmentService();
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

  const teacherAssignmentsRouter = Router();

  teacherAssignmentsRouter
    .route('/')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listTeacherAssignmentsQuerySchema,
          req.query,
          'query'
        );
        const result = await assignmentService.listTeacherAssignments(query, {
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
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
        const body = validateWithSchema(
          createAssignmentBodySchema,
          req.body,
          'body'
        );
        const created = await assignmentService.createAssignment(body, {
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          ...created,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  teacherAssignmentsRouter
    .route('/:assignmentId')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const detail = await assignmentService.getTeacherAssignmentDetail(
          params.assignmentId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...detail,
        });
      })
    )
    .patch(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          updateAssignmentBodySchema,
          req.body,
          'body'
        );
        const updated = await assignmentService.updateAssignment(
          params.assignmentId,
          body,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...updated,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  teacherAssignmentsRouter
    .route('/:assignmentId/targets')
    .put(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          updateTargetsBodySchema,
          req.body,
          'body'
        );
        const result = await assignmentService.updateAssignmentTargets(
          params.assignmentId,
          body.targetStudentMembershipIds,
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
    .all((_req, res) => respondMethodNotAllowed(res, 'PUT'));

  teacherAssignmentsRouter
    .route('/:assignmentId/close')
    .post(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const closed = await assignmentService.closeAssignment(
          params.assignmentId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...closed,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  teacherAssignmentsRouter
    .route('/:assignmentId/progress')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const progress = await assignmentService.getTeacherAssignmentProgress(
          params.assignmentId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...progress,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  const studentAssignmentsRouter = Router();

  studentAssignmentsRouter
    .route('/')
    .get(
      ...requireStudentInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listStudentAssignmentsQuerySchema,
          req.query,
          'query'
        );
        const result = await assignmentService.listStudentAssignments(query, {
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          studentMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentAssignmentsRouter
    .route('/:assignmentId')
    .get(
      ...requireStudentInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          assignmentIdParamSchema,
          req.params,
          'params'
        );
        const detail = await assignmentService.getStudentAssignmentDetail(
          params.assignmentId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          assignment: detail,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return {
    teacherAssignmentsRouter,
    studentAssignmentsRouter,
  };
}
