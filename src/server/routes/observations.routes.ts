import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createObservationService,
  type ObservationService,
} from '../services/observation.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const observationIdParamsSchema = z.object({
  observationId: z.string().trim().regex(UUID_REGEX),
});

const listObservationsQuerySchema = z.object({
  studentMembershipId: z.string().trim().regex(UUID_REGEX).optional(),
  classId: z.string().trim().regex(UUID_REGEX).optional(),
  assignmentId: z.string().trim().regex(UUID_REGEX).optional(),
  attemptId: z.string().trim().regex(UUID_REGEX).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createObservationBodySchema = z
  .object({
    studentMembershipId: z.string().trim().regex(UUID_REGEX),
    classId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    assignmentId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    attemptId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    noteBody: z.string().trim().min(1).max(10_000),
  })
  .strict();

const updateObservationBodySchema = z
  .object({
    noteBody: z.string().trim().min(1).max(10_000).optional(),
    classId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    assignmentId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
    attemptId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.noteBody !== undefined ||
      val.classId !== undefined ||
      val.assignmentId !== undefined ||
      val.attemptId !== undefined,
    {
      message: 'Cần cung cấp ít nhất một trường hợp lệ để cập nhật.',
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

export interface ObservationsRouterDeps {
  observationService?: ObservationService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createObservationsRouter(deps?: ObservationsRouterDeps) {
  const observationService =
    deps?.observationService ?? createObservationService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireTeacherInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  const router = Router();

  router
    .route('/')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listObservationsQuerySchema,
          req.query,
          'query'
        );
        const result = await observationService.listObservations(query, {
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
          createObservationBodySchema,
          req.body ?? {},
          'body'
        );
        const observation = await observationService.createObservation(body, {
          actorUserId: req.auth!.userId,
          organizationId: req.auth!.activeOrganizationId!,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          observation,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/:observationId')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          observationIdParamsSchema,
          req.params,
          'params'
        );
        const observation = await observationService.getObservation(
          params.observationId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          observation,
        });
      })
    )
    .patch(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          observationIdParamsSchema,
          req.params,
          'params'
        );
        const rawBody =
          req.body && typeof req.body === 'object'
            ? (req.body as Record<string, unknown>)
            : {};
        const body = validateWithSchema(
          updateObservationBodySchema,
          rawBody,
          'body'
        );
        const observation = await observationService.updateObservation(
          params.observationId,
          {
            noteBody: body.noteBody,
            classId: body.classId,
            assignmentId: body.assignmentId,
            attemptId: body.attemptId,
            hasClassId: Object.prototype.hasOwnProperty.call(rawBody, 'classId'),
            hasAssignmentId: Object.prototype.hasOwnProperty.call(
              rawBody,
              'assignmentId'
            ),
            hasAttemptId: Object.prototype.hasOwnProperty.call(
              rawBody,
              'attemptId'
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
          observation,
        });
      })
    )
    .delete(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          observationIdParamsSchema,
          req.params,
          'params'
        );
        const result = await observationService.deleteObservation(
          params.observationId,
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
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH, DELETE'));

  return router;
}
