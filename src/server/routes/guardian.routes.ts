import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  claimCoGuardianInvitationSchema,
  claimSchoolInvitationSchema,
  createCoGuardianInvitationSchema,
  createFamilyStudentSchema,
  createFamilyWorkspaceSchema,
  createGuardianService,
  createInvitationBodySchema,
  type GuardianService,
} from '../services/guardian.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const workspaceIdParamSchema = z.object({
  workspaceId: z.string().trim().regex(UUID_REGEX),
});

const workspaceInvitationParamSchema = z.object({
  workspaceId: z.string().trim().regex(UUID_REGEX),
  invitationId: z.string().trim().regex(UUID_REGEX),
});

const linkIdParamSchema = z.object({
  linkId: z.string().trim().regex(UUID_REGEX),
});

const listMyStudentsQuerySchema = z.object({
  includeRevoked: z.enum(['true', 'false']).optional(),
});

const membershipIdParamSchema = z.object({
  membershipId: z.string().trim().regex(UUID_REGEX),
});

const invitationIdParamSchema = z.object({
  invitationId: z.string().trim().regex(UUID_REGEX),
});

const adminStudentParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
  membershipId: z.string().trim().regex(UUID_REGEX),
});

const adminInvitationParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
  invitationId: z.string().trim().regex(UUID_REGEX),
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

export interface GuardianRoutersDeps {
  guardianService?: GuardianService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createGuardianRouters(deps?: GuardianRoutersDeps) {
  const guardianService = deps?.guardianService ?? createGuardianService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireGuardianRole = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('guardian'),
  ] as const;

  const requireVerifiedGuardian = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('guardian'),
    authMiddlewares.requireVerifiedGuardian,
  ] as const;

  const requireTeacherInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  // 1. Guardian Portal Router -> mounted at /api/v1/guardian
  const guardianRouter = Router();

  guardianRouter
    .route('/profile')
    .get(
      ...requireGuardianRole,
      asyncHandler(async (req: Request, res: Response) => {
        const auth = req.auth!;
        res.status(200).json({
          status: 'ok',
          profile: {
            id: auth.userId,
            displayName: auth.displayName,
            email: auth.email,
            platformRole: 'guardian',
            emailVerified: Boolean(auth.emailVerified),
          },
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  guardianRouter
    .route('/workspaces')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (req: Request, res: Response) => {
        const workspaces = await guardianService.listWorkspaces({
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          workspaces,
        });
      })
    )
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(createFamilyWorkspaceSchema, req.body ?? {}, 'body');
        const workspace = await guardianService.createWorkspace(body, {
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          workspace,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  guardianRouter
    .route('/workspaces/:workspaceId')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(workspaceIdParamSchema, req.params, 'params');
        const detail = await guardianService.getWorkspaceDetail(params.workspaceId, {
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          ...detail,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  guardianRouter
    .route('/workspaces/:workspaceId/students')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(workspaceIdParamSchema, req.params, 'params');
        const body = validateWithSchema(createFamilyStudentSchema, req.body ?? {}, 'body');
        const created = await guardianService.createFamilyStudent(
          params.workspaceId,
          body,
          {
            userId: req.auth!.userId,
            ip: req.ip,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({
          status: 'ok',
          ...created,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  guardianRouter
    .route('/workspaces/:workspaceId/co-guardian-invitations')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(workspaceIdParamSchema, req.params, 'params');
        const invitations = await guardianService.listCoGuardianInvitations(
          params.workspaceId,
          {
            userId: req.auth!.userId,
            ip: req.ip,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          invitations,
        });
      })
    )
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(workspaceIdParamSchema, req.params, 'params');
        const body = validateWithSchema(createCoGuardianInvitationSchema, req.body ?? {}, 'body');
        const created = await guardianService.createCoGuardianInvitation(
          params.workspaceId,
          body,
          {
            userId: req.auth!.userId,
            ip: req.ip,
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

  guardianRouter
    .route('/workspaces/:workspaceId/co-guardian-invitations/:invitationId/revoke')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          workspaceInvitationParamSchema,
          req.params,
          'params'
        );
        const result = await guardianService.revokeCoGuardianInvitation(
          params.workspaceId,
          params.invitationId,
          {
            userId: req.auth!.userId,
            ip: req.ip,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          invitation: result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  guardianRouter
    .route('/co-guardian-invitations/claim')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(
          claimCoGuardianInvitationSchema,
          req.body ?? {},
          'body'
        );
        const result = await guardianService.claimCoGuardianInvitation(body, {
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  guardianRouter
    .route('/students')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listMyStudentsQuerySchema,
          req.query ?? {},
          'query'
        );
        const students = await guardianService.listMyStudents(
          {
            userId: req.auth!.userId,
            ip: req.ip,
            ipPrefix: extractSafeIpPrefix(req.ip),
          },
          { includeRevoked: query.includeRevoked === 'true' }
        );
        res.status(200).json({
          status: 'ok',
          students,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  guardianRouter
    .route('/invitations/claim')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(claimSchoolInvitationSchema, req.body ?? {}, 'body');
        const result = await guardianService.claimSchoolStudentInvitation(body, {
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          link: result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  guardianRouter
    .route('/links/:linkId/revoke')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(linkIdParamSchema, req.params, 'params');
        const link = await guardianService.revokeMyLink(params.linkId, {
          userId: req.auth!.userId,
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          link,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  // 2. Teacher Guardian Invitations Router -> mounted at /api/v1/students
  const teacherGuardianInvitationsRouter = Router();

  teacherGuardianInvitationsRouter
    .route('/guardian-invitations/:invitationId/revoke')
    .post(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(invitationIdParamSchema, req.params, 'params');
        const invitation = await guardianService.revokeSchoolStudentInvitationForTeacher(
          params.invitationId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          invitation,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  teacherGuardianInvitationsRouter
    .route('/:membershipId/guardian-invitations')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(membershipIdParamSchema, req.params, 'params');
        const invitations = await guardianService.listSchoolStudentInvitationsForTeacher(
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
          invitations,
        });
      })
    )
    .post(
      ...requireTeacherInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(membershipIdParamSchema, req.params, 'params');
        const body = validateWithSchema(createInvitationBodySchema, req.body ?? {}, 'body');
        const created = await guardianService.createSchoolStudentInvitationForTeacher(
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
          ...created,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  // 3. Admin Guardian Invitations Router -> mounted at /api/v1/admin
  const adminGuardianInvitationsRouter = Router();

  adminGuardianInvitationsRouter
    .route('/organizations/:orgId/students/:membershipId/guardian-invitations')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(adminStudentParamSchema, req.params, 'params');
        const invitations = await guardianService.listSchoolStudentInvitationsForAdmin(
          params.orgId,
          params.membershipId
        );
        res.status(200).json({
          status: 'ok',
          invitations,
        });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(adminStudentParamSchema, req.params, 'params');
        const body = validateWithSchema(createInvitationBodySchema, req.body ?? {}, 'body');
        const created = await guardianService.createSchoolStudentInvitationForAdmin(
          params.orgId,
          params.membershipId,
          body,
          {
            actorUserId: req.auth!.userId,
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

  adminGuardianInvitationsRouter
    .route('/organizations/:orgId/guardian-invitations/:invitationId/revoke')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(adminInvitationParamSchema, req.params, 'params');
        const invitation = await guardianService.revokeSchoolStudentInvitationForAdmin(
          params.orgId,
          params.invitationId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          invitation,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  return {
    guardianRouter,
    teacherGuardianInvitationsRouter,
    adminGuardianInvitationsRouter,
  };
}
