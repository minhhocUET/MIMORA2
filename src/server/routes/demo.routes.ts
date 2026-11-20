import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createPreAuthCsrfMiddleware } from '../security/csrf.ts';
import {
  extractSafeIpPrefix,
  hashUserAgent,
  setSessionCookie,
} from '../security/session.ts';
import {
  createDemoAuthService,
  DEMO_PERSONAS,
  type DemoAuthService,
} from '../services/demo-auth.service.ts';

export const demoLoginBodySchema = z
  .object({
    persona: z.enum(DEMO_PERSONAS),
  })
  .strict();

export interface DemoRouterDeps {
  demoAuthService?: DemoAuthService;
  getConfig?: () => ServerConfig;
  preAuthCsrf?: ReturnType<typeof createPreAuthCsrfMiddleware>;
}

export function createDemoRouter(deps?: DemoRouterDeps): Router {
  const router = Router();
  const demoAuthService = deps?.demoAuthService ?? createDemoAuthService({ getConfig: deps?.getConfig });
  const getConfig = deps?.getConfig ?? getServerConfig;
  const preAuthCsrf =
    deps?.preAuthCsrf ??
    createPreAuthCsrfMiddleware({ config: deps?.getConfig ? deps.getConfig() : undefined });

  // Strict server-side gate: never expose demo endpoints when MIMORA_DEMO_MODE is disabled
  router.use((_req, _res, next) => {
    if (!getConfig().demoMode) {
      next(ApiErrors.notFound('Tính năng trải nghiệm demo hiện không khả dụng.'));
      return;
    }
    next();
  });

  router
    .route('/login')
    .post(
      preAuthCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const config = getConfig();
        const body = validateWithSchema(demoLoginBodySchema, req.body, 'body');

        const result = await demoAuthService.loginDemoPersona(body.persona, {
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

  return router;
}
