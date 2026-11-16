/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  service: string;
}

interface ProxyDiagnostics {
  reqSecure: boolean;
  reqProtocol: string;
  xForwardedProto: string | null;
}

interface SetCookieResponse extends ProxyDiagnostics {
  success: boolean;
}

interface CheckCookieResponse extends ProxyDiagnostics {
  cookieReceived: boolean;
}

interface ClearCookieResponse {
  success: boolean;
}

type SetStatus = 'NOT RUN' | 'SUCCESS' | 'FAIL';
type CheckStatus = 'NOT RUN' | 'RECEIVED' | 'NOT RECEIVED' | 'FAIL';
type ClearStatus = 'NOT RUN' | 'SUCCESS' | 'FAIL';

interface DbHealthSuccess {
  status: 'ok';
  database: 'connected';
  orm: string;
  driver: string;
  tls?: string;
  latencyMs?: number;
  serverVersion?: string | null;
}

interface DbHealthError {
  status: 'error';
  database?: string;
  code?: string;
  message?: string;
}

type DbConnectionStatus = 'NOT RUN' | 'Connected' | 'Failed';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [setStatus, setSetStatus] = useState<SetStatus>('NOT RUN');
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('NOT RUN');
  const [clearStatus, setClearStatus] = useState<ClearStatus>('NOT RUN');
  const [actionError, setActionError] = useState<string | null>(null);
  const [proxyDiag, setProxyDiag] = useState<ProxyDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const [dbStatus, setDbStatus] = useState<DbConnectionStatus>('NOT RUN');
  const [dbBusy, setDbBusy] = useState(false);
  const [dbResponseMs, setDbResponseMs] = useState<number | null>(null);
  const [dbInfo, setDbInfo] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch('/api/v1/health')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as HealthResponse;
      })
      .then((data) => {
        if (active) {
          setHealth(data);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setHealthError(err instanceof Error ? err.message : 'Request failed');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function requestJson<T>(url: string, method: 'GET' | 'POST'): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown network error';
      throw new Error(`Network error: ${msg}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as T;
  }

  const handleSetCookie = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const data = await requestJson<SetCookieResponse>('/api/v1/cookie-test/set', 'POST');
      setSetStatus(data.success ? 'SUCCESS' : 'FAIL');
      setProxyDiag({
        reqSecure: data.reqSecure,
        reqProtocol: data.reqProtocol,
        xForwardedProto: data.xForwardedProto,
      });
    } catch (err: unknown) {
      setSetStatus('FAIL');
      setActionError(err instanceof Error ? err.message : 'Set cookie failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckCookie = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const data = await requestJson<CheckCookieResponse>('/api/v1/cookie-test/check', 'GET');
      setCheckStatus(data.cookieReceived ? 'RECEIVED' : 'NOT RECEIVED');
      setProxyDiag({
        reqSecure: data.reqSecure,
        reqProtocol: data.reqProtocol,
        xForwardedProto: data.xForwardedProto,
      });
    } catch (err: unknown) {
      setCheckStatus('FAIL');
      setActionError(err instanceof Error ? err.message : 'Check cookie failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearCookie = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const data = await requestJson<ClearCookieResponse>('/api/v1/cookie-test/clear', 'POST');
      setClearStatus(data.success ? 'SUCCESS' : 'FAIL');
    } catch (err: unknown) {
      setClearStatus('FAIL');
      setActionError(err instanceof Error ? err.message : 'Clear cookie failed');
    } finally {
      setBusy(false);
    }
  };

  const handleTestDb = async () => {
    setDbBusy(true);
    setDbError(null);
    setDbInfo(null);
    setDbResponseMs(null);

    const startedAt = performance.now();
    try {
      const res = await fetch('/api/v1/db/health', {
        method: 'GET',
        credentials: 'include',
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      setDbResponseMs(elapsedMs);

      let payload: DbHealthSuccess | DbHealthError | null = null;
      try {
        payload = (await res.json()) as DbHealthSuccess | DbHealthError;
      } catch {
        payload = null;
      }

      if (res.ok && payload && payload.status === 'ok') {
        setDbStatus('Connected');
        const versionPart = payload.serverVersion ? `, version: ${payload.serverVersion}` : '';
        const serverLatencyPart =
          typeof payload.latencyMs === 'number' ? `, db query: ${payload.latencyMs}ms` : '';
        setDbInfo(`orm: ${payload.orm}, driver: ${payload.driver}${versionPart}${serverLatencyPart}`);
      } else {
        setDbStatus('Failed');
        const codePart = payload && 'code' in payload && payload.code ? `[${payload.code}] ` : '';
        const msgPart =
          payload && 'message' in payload && payload.message
            ? payload.message
            : `HTTP ${res.status} ${res.statusText}`;
        setDbError(`${codePart}${msgPart}`);
      }
    } catch (err: unknown) {
      setDbResponseMs(Math.round(performance.now() - startedAt));
      setDbStatus('Failed');
      const msg = err instanceof Error ? err.message : 'Unknown network error';
      setDbError(`Network error: ${msg}`);
    } finally {
      setDbBusy(false);
    }
  };

  return (
    <main className="p-6 font-sans text-sm text-neutral-900 space-y-6 max-w-xl">
      <section>
        <p className="font-medium">MIMORA Runtime Proof</p>
        <p className="mt-1 text-neutral-600" data-testid="api-health-status">
          {healthError
            ? `API error: ${healthError}`
            : health
              ? `API: ${health.status} (${health.service})`
              : 'Checking /api/v1/health...'}
        </p>
      </section>

      <section className="border border-neutral-200 rounded p-4 space-y-4">
        <h1 className="font-semibold text-base">P0-01B: Cookie &amp; SameSite Verification</h1>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSetCookie()}
            className="px-3 py-1.5 rounded bg-neutral-900 text-white disabled:opacity-50 cursor-pointer"
          >
            Set Test Cookie
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCheckCookie()}
            className="px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-900 disabled:opacity-50 cursor-pointer"
          >
            Check Test Cookie
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearCookie()}
            className="px-3 py-1.5 rounded border border-neutral-300 bg-white text-neutral-900 disabled:opacity-50 cursor-pointer"
          >
            Clear Test Cookie
          </button>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded p-3 space-y-1 font-mono text-xs">
          <p>Set cookie: {setStatus}</p>
          <p>Check cookie: {checkStatus}</p>
          <p>Clear cookie: {clearStatus}</p>
          {proxyDiag && (
            <p className="pt-2 text-neutral-600">
              Proxy check — req.secure: {String(proxyDiag.reqSecure)}, req.protocol:{' '}
              {proxyDiag.reqProtocol}, X-Forwarded-Proto: {proxyDiag.xForwardedProto ?? 'null'}
            </p>
          )}
          {actionError && <p className="pt-2 text-red-600">{actionError}</p>}
        </div>
      </section>

      <section className="border border-neutral-200 rounded p-4 space-y-4">
        <h2 className="font-semibold text-base">TiDB Connectivity Proof</h2>

        <div>
          <button
            type="button"
            disabled={dbBusy}
            onClick={() => void handleTestDb()}
            className="px-3 py-1.5 rounded bg-neutral-900 text-white disabled:opacity-50 cursor-pointer"
          >
            {dbBusy ? 'Testing...' : 'Test Database Connection'}
          </button>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded p-3 space-y-1 font-mono text-xs">
          <p>Status: {dbStatus}</p>
          {dbResponseMs !== null && <p>Response time: {dbResponseMs} ms</p>}
          {dbInfo && <p className="text-neutral-700">{dbInfo}</p>}
          {dbError && <p className="text-red-600">{dbError}</p>}
        </div>
      </section>
    </main>
  );
}
