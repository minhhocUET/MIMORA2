import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { getServerConfig } from './src/server/config/env.ts';
import { checkTiDbHealth, closeTiDbPool } from './src/server/db/tidb.ts';
import { ApiErrors, toApiErrorEnvelope } from './src/server/http/errors.ts';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  attachRequestId,
  baselineSecurityHeaders,
  getRequestId,
} from './src/server/http/middleware.ts';
import { createAdminContentRouter } from './src/server/routes/admin-content.routes.ts';
import { createAdminInsightsRouter } from './src/server/routes/admin-insights.routes.ts';
import { createAdminUsersRouter } from './src/server/routes/admin-users.routes.ts';
import { createAssignmentsRouters } from './src/server/routes/assignments.routes.ts';
import { createAttemptsRouters } from './src/server/routes/attempts.routes.ts';
import { createAuthRouter } from './src/server/routes/auth.routes.ts';
import { createClassesRouters } from './src/server/routes/classes.routes.ts';
import { createDemoRouter } from './src/server/routes/demo.routes.ts';
import { createFamilyLearningRouters } from './src/server/routes/family-learning.routes.ts';
import { createGoalsRouters } from './src/server/routes/goals.routes.ts';
import { createGuardianRouters } from './src/server/routes/guardian.routes.ts';
import { createLibraryRouter } from './src/server/routes/library.routes.ts';
import { createObservationsRouter } from './src/server/routes/observations.routes.ts';
import { createAdminOrganizationsRouter } from './src/server/routes/organizations.routes.ts';

function parseCliArgs(argv: string[]): { port?: number; host?: string } {
  let port: number | undefined;
  let host: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && i + 1 < argv.length) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed;
      }
      i += 1;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed;
      }
    } else if (arg === '--host' && i + 1 < argv.length) {
      host = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
    }
  }

  return { port, host };
}

async function startServer() {
  const serverConfig = getServerConfig();
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const port = cliArgs.port ?? serverConfig.port;
  const host = cliArgs.host ?? serverConfig.host;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(attachRequestId);
  app.use(baselineSecurityHeaders);
  app.use('/api', express.json({ limit: serverConfig.jsonBodyLimit }));
  const httpServer = http.createServer(app);

  const TEST_COOKIE_NAME = 'mimora_p0_cookie_test';
  const TEST_COOKIE_MAX_AGE_MS = 600 * 1000; // 10 minutes (600s)

  const hasCookieByName = (cookieHeader: string | undefined, targetName: string): boolean => {
    if (!cookieHeader) {
      return false;
    }
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) {
        continue;
      }
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name === targetName && value.length > 0) {
        return true;
      }
    }
    return false;
  };

  // API routes MUST be registered before Vite middleware
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'mimora-api',
      demoAccessEnabled: serverConfig.demoMode,
    });
  });

  app
    .route('/api/v1/cookie-test/set')
    .post((req: Request, res: Response) => {
      res.cookie(TEST_COOKIE_NAME, 'p0_cookie_verification', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: TEST_COOKIE_MAX_AGE_MS,
      });

      res.status(200).json({
        success: true,
        reqSecure: req.secure,
        reqProtocol: req.protocol,
        xForwardedProto: req.get('x-forwarded-proto') ?? null,
      });
    })
    .all((_req: Request, res: Response) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        message: 'Method not allowed',
      });
    });

  app
    .route('/api/v1/cookie-test/check')
    .get((req: Request, res: Response) => {
      const cookieReceived = hasCookieByName(req.headers.cookie, TEST_COOKIE_NAME);
      res.status(200).json({
        cookieReceived,
        reqSecure: req.secure,
        reqProtocol: req.protocol,
        xForwardedProto: req.get('x-forwarded-proto') ?? null,
      });
    })
    .all((_req: Request, res: Response) => {
      res.set('Allow', 'GET').status(405).json({
        status: 'error',
        message: 'Method not allowed',
      });
    });

  app
    .route('/api/v1/cookie-test/clear')
    .post((_req: Request, res: Response) => {
      res.clearCookie(TEST_COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
      });

      res.status(200).json({
        success: true,
      });
    })
    .all((_req: Request, res: Response) => {
      res.set('Allow', 'POST').status(405).json({
        status: 'error',
        message: 'Method not allowed',
      });
    });

  app
    .route('/api/v1/db/health')
    .get(async (_req: Request, res: Response) => {
      const result = await checkTiDbHealth();
      if (result.ok) {
        res.status(200).json(result.data);
        return;
      }

      res.status(result.error.httpStatus).json({
        status: 'error',
        database: result.database,
        mode: result.mode,
        durablePersistence: result.durablePersistence,
        orm: 'drizzle',
        driver: 'mysql2',
        code: result.error.code,
        message: result.error.message,
      });
    })
    .all((_req: Request, res: Response) => {
      res.set('Allow', 'GET').status(405).json({
        status: 'error',
        message: 'Method not allowed',
      });
    });

  app.use('/api/v1/auth', createAuthRouter());
  if (serverConfig.demoMode) {
    app.use('/api/v1/demo', createDemoRouter());
  }

  const { adminClassesRouter, teacherClassesRouter } = createClassesRouters();
  const { teacherAssignmentsRouter, studentAssignmentsRouter } =
    createAssignmentsRouters();
  const { studentAttemptsRouter, teacherAssignmentAttemptsRouter } =
    createAttemptsRouters();
  const { teacherStudentGoalsRouter, teacherGoalsRouter, studentGoalsRouter } =
    createGoalsRouters();
  const {
    guardianRouter,
    teacherGuardianInvitationsRouter,
    adminGuardianInvitationsRouter,
  } = createGuardianRouters();
  const {
    adminFamilyProgramsRouter,
    guardianLearningRouter,
    studentFamilyLearningRouter,
  } = createFamilyLearningRouters();
  app.use('/api/v1/admin/organizations/:orgId/classes', adminClassesRouter);
  app.use('/api/v1/admin/insights', createAdminInsightsRouter());
  app.use('/api/v1/admin', adminGuardianInvitationsRouter);
  app.use('/api/v1/admin', adminFamilyProgramsRouter);
  app.use('/api/v1/admin', createAdminUsersRouter());
  app.use('/api/v1/admin', createAdminContentRouter());
  app.use('/api/v1/admin/organizations', createAdminOrganizationsRouter());
  app.use('/api/v1/guardian', guardianRouter);
  app.use('/api/v1/guardian', guardianLearningRouter);
  app.use('/api/v1/classes', teacherClassesRouter);
  app.use('/api/v1/library', createLibraryRouter());
  app.use('/api/v1/assignments', teacherAssignmentsRouter);
  app.use('/api/v1/assignments', teacherAssignmentAttemptsRouter);
  app.use('/api/v1/observations', createObservationsRouter());
  app.use('/api/v1/students', teacherGuardianInvitationsRouter);
  app.use('/api/v1/students', teacherStudentGoalsRouter);
  app.use('/api/v1/goals', teacherGoalsRouter);
  app.use('/api/v1/student/assignments', studentAssignmentsRouter);
  app.use('/api/v1/student', studentGoalsRouter);
  app.use('/api/v1/student', studentAttemptsRouter);
  app.use('/api/v1/student', studentFamilyLearningRouter);

  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const isProduction = serverConfig.nodeEnv === 'production';
  let vite: Awaited<ReturnType<(typeof import('vite'))['createServer']>> | null = null;

  if (isProduction) {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      throw new Error(
        `[mimora-api] Missing production client build at ${indexHtmlPath}. Run "npm run build" before starting in production.`
      );
    }

    app.use(express.static(distDir, { index: false }));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/assets/')) {
        next();
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  }

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof Error) {
      vite?.ssrFixStacktrace(err);
      console.error(`[express-vite-error] name=${err.name} requestId=${getRequestId(res) ?? 'none'}`);
    } else {
      console.error(`[express-vite-error] requestId=${getRequestId(res) ?? 'none'}`);
    }

    if (res.headersSent) {
      next(err);
      return;
    }

    const requestId = getRequestId(res);
    const internalError = ApiErrors.internal();
    res.status(internalError.httpStatus).json(toApiErrorEnvelope(internalError, requestId));
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[mimora-api] HTTP server error on ${host}:${port}:`, err.code ?? err.message);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    console.log(`[mimora-api] Received ${signal}, shutting down...`);
    try {
      await closeTiDbPool();
    } catch (dbCloseErr) {
      console.error('[mimora-api] Error closing TiDB pool:', dbCloseErr);
    }
    if (vite) {
      try {
        await vite.close();
      } catch (closeErr) {
        console.error('[mimora-api] Error closing Vite server:', closeErr);
      }
    }
    httpServer.close((serverErr) => {
      if (serverErr) {
        console.error('[mimora-api] Error closing HTTP server:', serverErr);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      const modeLabel = isProduction ? 'production static dist/' : 'Vite middleware';
      console.log(
        `[mimora-api] Express (${modeLabel}) listening on http://${host}:${port} (argv=${JSON.stringify(process.argv.slice(2))})`
      );
      resolve();
    });
  });
}

startServer().catch((err) => {
  console.error('[mimora-api] Fatal startup error:', err);
  process.exit(1);
});
