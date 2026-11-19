import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import {
  createAuthMiddlewareSuite,
  type SessionTimingContext,
} from '../middleware/auth.ts';
import {
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
} from '../security/csrf.ts';
import {
  clearSessionCookie,
  extractSafeIpPrefix,
  hashUserAgent,
  setSessionCookie,
} from '../security/session.ts';
import { createAuthService, type AuthService } from '../services/auth.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loginBodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('admin_teacher'),
    identifier: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(1024),
  }),
  z.object({
    mode: z.literal('student'),
    organizationCode: z.string().trim().min(1).max(64),
    orgUsername: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(1024),
  }),
  z.object({
    mode: z.literal('guardian'),
    email: z.string().trim().email().max(255),
    password: z.string().min(1).max(1024),
  }),
]);

export const guardianRegisterBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(255),
    password: z.string().min(8).max(1024),
  })
  .strict();

export const guardianVerifyEmailBodySchema = z
  .object({
    token: z.string().trim().min(1).max(512),
  })
  .strict();

export const switchOrganizationBodySchema = z.object({
  organizationId: z.string().trim().regex(UUID_REGEX),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

export interface AuthRouterDeps {
  authService?: AuthService;
  getConfig?: () => ServerConfig;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  preAuthCsrf?: ReturnType<typeof createPreAuthCsrfMiddleware>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAuthRouter(deps?: AuthRouterDeps): Router {
  const router = Router();
  const authService = deps?.authService ?? createAuthService();
  const getConfig = deps?.getConfig ?? getServerConfig;
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite({ getConfig });
  const preAuthCsrf =
    deps?.preAuthCsrf ??
    createPreAuthCsrfMiddleware({ config: deps?.getConfig ? deps.getConfig() : undefined });
  const authenticatedCsrf =
    deps?.authenticatedCsrf ??
    createAuthenticatedCsrfMiddleware({
      config: deps?.getConfig ? deps.getConfig() : undefined,
    });

  router
    .route('/guardian/register')
    .post(
      preAuthCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(guardianRegisterBodySchema, req.body, 'body');
        const result = await authService.registerGuardian(body, {
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
          userAgentHash: hashUserAgent(req.get('user-agent')),
        });
        res.status(201).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/guardian/verify-email')
    .post(
      preAuthCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(guardianVerifyEmailBodySchema, req.body, 'body');
        const result = await authService.verifyGuardianEmail(body, {
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
          userAgentHash: hashUserAgent(req.get('user-agent')),
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/guardian/resend-verification')
    .post(
      authMiddlewares.requireAuth,
      authMiddlewares.requireRole('guardian'),
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const result = await authService.resendGuardianVerification(req.auth!, {
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/login')
    .post(
      preAuthCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(loginBodySchema, req.body, 'body');
        const config = getConfig();

        const result = await authService.login(body, {
          ip: req.ip,
          ipPrefix: extractSafeIpPrefix(req.ip),
          userAgentHash: hashUserAgent(req.get('user-agent')),
        });

        setSessionCookie(
          res,
          result.rawSessionToken,
          result.cookieMaxAgeMs,
          config.cookie
        );

        res.status(200).json({
          status: 'ok',
          ...result.payload,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/logout')
    .post(
      authMiddlewares.requireAuth,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const config = getConfig();
        const principal = req.auth!;
        await authService.logout(principal, {
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        clearSessionCookie(res, config.cookie);
        res.status(200).json({
          status: 'ok',
          loggedOut: true,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/me')
    .get(
      authMiddlewares.requireAuth,
      asyncHandler(async (req: Request, res: Response) => {
        const principal = req.auth!;
        const rawToken = res.locals.rawSessionToken as string;
        const timing = res.locals.sessionTiming as SessionTimingContext;
        const payload = await authService.getMe(principal, rawToken, timing);
        res.status(200).json({
          status: 'ok',
          ...payload,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'GET').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/switch-organization')
    .post(
      authMiddlewares.requireAuth,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(switchOrganizationBodySchema, req.body, 'body');
        const config = getConfig();
        const principal = req.auth!;
        const currentRawToken = res.locals.rawSessionToken as string;
        const timing = res.locals.sessionTiming as SessionTimingContext;

        const result = await authService.switchOrganization(
          principal,
          currentRawToken,
          timing.absoluteExpiresAt,
          body.organizationId,
          { ipPrefix: extractSafeIpPrefix(req.ip) }
        );

        setSessionCookie(
          res,
          result.rawSessionToken,
          result.cookieMaxAgeMs,
          config.cookie
        );

        res.status(200).json({
          status: 'ok',
          ...result.payload,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  router
    .route('/change-password')
    .post(
      authMiddlewares.requireAuth,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(changePasswordBodySchema, req.body, 'body');
        const config = getConfig();
        const principal = req.auth!;
        const currentRawToken = res.locals.rawSessionToken as string;
        const timing = res.locals.sessionTiming as SessionTimingContext;

        const result = await authService.changePassword(
          principal,
          currentRawToken,
          timing.absoluteExpiresAt,
          body,
          { ipPrefix: extractSafeIpPrefix(req.ip) }
        );

        setSessionCookie(
          res,
          result.rawSessionToken,
          result.cookieMaxAgeMs,
          config.cookie
        );

        res.status(200).json({
          status: 'ok',
          passwordChanged: true,
          csrfToken: result.csrfToken,
        });
      })
    )
    .all((_req, res) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        code: ApiErrors.methodNotAllowed().code,
        messageKey: ApiErrors.methodNotAllowed().messageKey,
        message: ApiErrors.methodNotAllowed().message,
        locale: 'vi-VN',
      });
    });

  return router;
}
