import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { checkTiDbHealth, closeTiDbPool } from './src/server/db/tidb.ts';

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
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = cliArgs.port ?? (envPort && Number.isInteger(envPort) ? envPort : 3000);
  const host = cliArgs.host ?? '0.0.0.0';

  const app = express();
  app.set('trust proxy', 1);
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
        database: 'disconnected',
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

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      status: 'error',
      message: 'API endpoint not found',
    });
  });

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
    },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof Error) {
      vite.ssrFixStacktrace(err);
      console.error('[express-vite-error]', err.stack ?? err.message);
    } else {
      console.error('[express-vite-error]', err);
    }

    if (res.headersSent) {
      next(err);
      return;
    }

    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
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
    try {
      await vite.close();
    } catch (closeErr) {
      console.error('[mimora-api] Error closing Vite server:', closeErr);
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
      console.log(
        `[mimora-api] Express + Vite middleware listening on http://${host}:${port} (argv=${JSON.stringify(process.argv.slice(2))})`
      );
      resolve();
    });
  });
}

startServer().catch((err) => {
  console.error('[mimora-api] Fatal startup error:', err);
  process.exit(1);
});
