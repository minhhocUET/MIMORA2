import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { CLASS_STATUSES } from '../repositories/class.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createClassService,
  type ClassService,
} from '../services/class.service.ts';
import {
  createCsvImportService,
  type CsvImportService,
} from '../services/csv-import.service.ts';
import {
  createMembershipService,
  type MembershipService,
} from '../services/membership.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const orgParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
});

const orgClassParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
  classId: z.string().trim().regex(UUID_REGEX),
});

const teacherClassParamSchema = z.object({
  classId: z.string().trim().regex(UUID_REGEX),
});

const teacherClassJobParamSchema = z.object({
  classId: z.string().trim().regex(UUID_REGEX),
  jobId: z.string().trim().regex(UUID_REGEX),
});

const listClassesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(CLASS_STATUSES).optional(),
  search: z.string().trim().min(1).max(128).optional(),
});

const createClassBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  academicYear: z.string().trim().min(1).max(32).nullable().optional(),
});

const updateClassBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  academicYear: z.string().trim().min(1).max(32).nullable().optional(),
  status: z.enum(CLASS_STATUSES).optional(),
});

const putClassTeachersBodySchema = z.object({
  teacherMembershipIds: z.array(z.string().trim().regex(UUID_REGEX)).max(50),
});

const putClassStudentsBodySchema = z.union([
  z.object({
    mode: z.literal('set').optional(),
    studentMembershipIds: z.array(z.string().trim().regex(UUID_REGEX)).max(500),
    removedStatus: z.enum(['transferred_out', 'archived']).optional(),
  }),
  z.object({
    mode: z.literal('enroll'),
    studentMembershipIds: z.array(z.string().trim().regex(UUID_REGEX)).min(1).max(500),
  }),
  z.object({
    mode: z.literal('remove'),
    studentMembershipIds: z.array(z.string().trim().regex(UUID_REGEX)).min(1).max(500),
    removedStatus: z.enum(['transferred_out', 'archived']).optional(),
  }),
]);

const teacherProvisionStudentBodySchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  orgUsername: z.string().trim().min(2).max(64),
  password: z.string().min(1).max(1024),
  email: z.string().trim().email().max(255).nullable().optional(),
});

const teacherCsvImportBodySchema = z.object({
  sourceFilename: z.string().trim().min(1).max(255),
  csvContent: z.string().min(1),
  mode: z.enum(['preview', 'commit']).default('preview'),
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

export interface ClassesRoutersDeps {
  classService?: ClassService;
  membershipService?: MembershipService;
  csvImportService?: CsvImportService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createClassesRouters(deps?: ClassesRoutersDeps) {
  const classService = deps?.classService ?? createClassService();
  const membershipService = deps?.membershipService ?? createMembershipService();
  const csvImportService = deps?.csvImportService ?? createCsvImportService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  const requireTeacherInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  const adminClassesRouter = Router({ mergeParams: true });

  adminClassesRouter
    .route('/')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgParamSchema, req.params, 'params');
        const query = validateWithSchema(listClassesQuerySchema, req.query, 'query');
        const result = await classService.listOrgClasses({
          organizationId: params.orgId,
          ...query,
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgParamSchema, req.params, 'params');
        const body = validateWithSchema(createClassBodySchema, req.body, 'body');
        const cls = await classService.createClass(params.orgId, body, {
          actorUserId: req.auth!.userId,
          actorRole: 'platform_admin',
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          class: cls,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  adminClassesRouter
    .route('/:classId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgClassParamSchema, req.params, 'params');
        const detail = await classService.getOrgClassDetail(
          params.orgId,
          params.classId
        );
        res.status(200).json({
          status: 'ok',
          ...detail,
        });
      })
    )
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgClassParamSchema, req.params, 'params');
        const body = validateWithSchema(updateClassBodySchema, req.body, 'body');
        const cls = await classService.updateClass(
          params.orgId,
          params.classId,
          body,
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          class: cls,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  adminClassesRouter
    .route('/:classId/teachers')
    .put(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgClassParamSchema, req.params, 'params');
        const body = validateWithSchema(putClassTeachersBodySchema, req.body, 'body');
        const result = await classService.setClassTeachers(
          params.orgId,
          params.classId,
          body.teacherMembershipIds,
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
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

  adminClassesRouter
    .route('/:classId/students')
    .put(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgClassParamSchema, req.params, 'params');
        const body = validateWithSchema(putClassStudentsBodySchema, req.body, 'body');
        const result = await classService.updateClassStudents(
          params.orgId,
          params.classId,
          body,
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
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

  const teacherClassesRouter = Router();

  teacherClassesRouter
    .route('/')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(listClassesQuerySchema, req.query, 'query');
        const result = await classService.listMyAssignedClasses({
          organizationId: req.auth!.activeOrganizationId!,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          page: query.page,
          limit: query.limit,
          status: query.status,
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  teacherClassesRouter
    .route('/:classId/students')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          teacherClassParamSchema,
          req.params,
          'params'
        );
        const result = await classService.getMyAssignedClassStudents({
          organizationId: req.auth!.activeOrganizationId!,
          classId: params.classId,
          teacherMembershipId: req.auth!.organizationMembershipId!,
          actorUserId: req.auth!.userId,
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
        const params = validateWithSchema(
          teacherClassParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          teacherProvisionStudentBodySchema,
          req.body,
          'body'
        );
        const created = await membershipService.provisionStudentInAssignedClass(
          {
            organizationId: req.auth!.activeOrganizationId!,
            classId: params.classId,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            actorRole: 'teacher',
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({
          status: 'ok',
          ...created,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  teacherClassesRouter
    .route('/:classId/csv-imports')
    .post(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          teacherClassParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(teacherCsvImportBodySchema, req.body, 'body');
        const result = await csvImportService.processStudentCsvImport(
          {
            organizationId: req.auth!.activeOrganizationId!,
            targetClassId: params.classId,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            actorRole: 'teacher',
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
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  teacherClassesRouter
    .route('/:classId/csv-imports/:jobId')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          teacherClassJobParamSchema,
          req.params,
          'params'
        );
        const job = await csvImportService.getImportJob(
          req.auth!.activeOrganizationId!,
          params.jobId,
          {
            actorUserId: req.auth!.userId,
            actorRole: 'teacher',
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        if (job.targetClassId !== params.classId) {
          throw ApiErrors.forbidden('Bạn không có quyền xem tác vụ nhập CSV của lớp khác.');
        }
        res.status(200).json({
          status: 'ok',
          job,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return {
    adminClassesRouter,
    teacherClassesRouter,
  };
}
