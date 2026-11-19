import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ApiClientError,
  apiRequest,
  authApi,
  clearInMemoryCsrfToken,
  getInMemoryCsrfToken,
  setInMemoryCsrfToken,
} from './api/client.ts';
import { deriveResolvedRole } from './auth/AuthContext.tsx';
import { resolveLocalizedErrorMessage } from './i18n/index.ts';
import type { AuthContextPayload } from './types/auth.ts';
import { mapContentVersionToUiDescriptor } from './types/chapter.ts';

function collectFrontendTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === 'server' || entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...collectFrontendTsFiles(fullPath));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('P3-01 Frontend API client & security hygiene', () => {
  it('stores CSRF token strictly in memory and injects CSRF + X-Requested-With headers on unsafe methods', async () => {
    clearInMemoryCsrfToken();

    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          status: 'ok',
          user: {
            id: 'u1',
            displayName: 'Cô Mai',
            email: 'mai@school.edu.vn',
            platformUsername: null,
            platformRole: null,
          },
          session: {
            id: 's1',
            scope: 'teacher',
            activeOrganizationId: 'org1',
            idleExpiresAt: '2026-11-18T12:00:00Z',
            absoluteExpiresAt: '2026-11-19T12:00:00Z',
          },
          activeOrganization: {
            organizationId: 'org1',
            code: 'MIMORA01',
            name: 'Trường Tiểu học Bình Minh',
            membershipId: 'm1',
            role: 'teacher',
          },
          organizations: [
            {
              organizationId: 'org1',
              code: 'MIMORA01',
              name: 'Trường Tiểu học Bình Minh',
              membershipId: 'm1',
              role: 'teacher',
            },
          ],
          requiresOrganizationSelection: false,
          csrfToken: 'csrf-secret-in-memory',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const loginRes = await authApi.login(
      { mode: 'admin_teacher', identifier: 'mai@school.edu.vn', password: 'secret' },
      mockFetch
    );

    assert.equal(capturedUrl, '/api/v1/auth/login');
    assert.equal(capturedInit?.credentials, 'same-origin');
    const loginHeaders = capturedInit?.headers as Record<string, string>;
    assert.equal(loginHeaders['X-Requested-With'], 'MIMORA-Web');
    assert.equal(loginHeaders['Content-Type'], 'application/json');
    assert.equal(getInMemoryCsrfToken(), 'csrf-secret-in-memory');
    assert.equal(loginRes.user.displayName, 'Cô Mai');

    // Subsequent unsafe POST must carry X-CSRF-Token automatically
    await authApi.switchOrganization('org1', mockFetch);
    const switchHeaders = capturedInit?.headers as Record<string, string>;
    assert.equal(switchHeaders['X-CSRF-Token'], 'csrf-secret-in-memory');
    assert.equal(switchHeaders['X-Requested-With'], 'MIMORA-Web');

    clearInMemoryCsrfToken();
    assert.equal(getInMemoryCsrfToken(), null);
  });

  it('preserves HTTP 403 and safely decodes nginx HTML 403 intercept without throwing JSON SyntaxError', async () => {
    setInMemoryCsrfToken('token-to-keep-on-403');
    const html403Fetch: typeof fetch = async () =>
      new Response('<html><body><h1>403 Forbidden</h1><center>nginx</center></body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    await assert.rejects(
      async () => apiRequest('/auth/me', { method: 'GET', fetchImpl: html403Fetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 403);
        assert.equal(err.info.code, 'FORBIDDEN_PROXY_HTML');
        assert.equal(err.info.isForbiddenProxyHtml, true);
        return true;
      }
    );
    clearInMemoryCsrfToken();
  });

  it('preserves HTTP 503 proxy HTML response as SERVICE_UNAVAILABLE_PROXY', async () => {
    const html503Fetch: typeof fetch = async () =>
      new Response('<!doctype html><html><body>503 Service Unavailable</body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      });

    await assert.rejects(
      async () => apiRequest('/health', { method: 'GET', fetchImpl: html503Fetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 503);
        assert.equal(err.info.code, 'SERVICE_UNAVAILABLE_PROXY');
        return true;
      }
    );
  });

  it('clears in-memory CSRF token on HTTP 401 and preserves backend Vietnamese error details', async () => {
    setInMemoryCsrfToken('stale-csrf');
    const json401Fetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'error',
          code: 'UNAUTHORIZED',
          messageKey: 'error.auth.unauthorized',
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
          locale: 'vi-VN',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );

    await assert.rejects(
      async () => apiRequest('/auth/me', { method: 'GET', fetchImpl: json401Fetch }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.info.httpStatus, 401);
        assert.equal(err.info.code, 'UNAUTHORIZED');
        assert.equal(
          resolveLocalizedErrorMessage(err.info, 'vi-VN'),
          'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
        );
        return true;
      }
    );
    assert.equal(getInMemoryCsrfToken(), null);
  });

  it('contains zero localStorage or sessionStorage usage anywhere in executable client source', () => {
    const files = collectFrontendTsFiles(join(process.cwd(), 'src'));
    assert.ok(files.length > 0);
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      const codeOnly = contents
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(
        /\b(localStorage|sessionStorage)\b/.test(codeOnly),
        false,
        `Unexpected browser storage usage in ${file}`
      );
    }
  });
});

describe('P3-01 Role derivation & Chapter UI compatibility adapter', () => {
  it('derives strictly from the 4 supported roles only', () => {
    const baseUser = {
      id: 'u1',
      displayName: 'User',
      email: null,
      platformUsername: null,
      platformRole: null,
    };
    const makeCtx = (
      platformRole: 'platform_admin' | 'guardian' | null,
      scope: 'platform_admin' | 'guardian' | 'teacher' | 'student'
    ): AuthContextPayload => ({
      user: { ...baseUser, platformRole },
      session: {
        id: 's1',
        scope,
        activeOrganizationId:
          scope === 'platform_admin' || scope === 'guardian' ? null : 'org1',
        idleExpiresAt: '2026-11-18T12:00:00Z',
        absoluteExpiresAt: '2026-11-19T12:00:00Z',
      },
      activeOrganization: null,
      organizations: [],
      requiresOrganizationSelection: false,
      csrfToken: 'c',
    });

    assert.equal(deriveResolvedRole(makeCtx('platform_admin', 'platform_admin')), 'platform_admin');
    assert.equal(deriveResolvedRole(makeCtx('guardian', 'guardian')), 'guardian');
    assert.equal(deriveResolvedRole(makeCtx(null, 'teacher')), 'teacher');
    assert.equal(deriveResolvedRole(makeCtx(null, 'student')), 'student');
    // Mismatched privilege/scope yields null
    assert.equal(deriveResolvedRole(makeCtx(null, 'platform_admin')), null);
    assert.equal(deriveResolvedRole(makeCtx(null, 'guardian')), null);
    assert.equal(deriveResolvedRole(makeCtx('guardian', 'teacher')), null);
    assert.equal(deriveResolvedRole(null), null);
  });

  it('maps P2-04 content_versions cleanly into Chapter/Session/Step descriptors', () => {
    const tagged = mapContentVersionToUiDescriptor({
      id: 'cv-1',
      contentItemId: 'ci-1',
      contentType: 'social_story_card',
      title: 'Giờ ra chơi ở sân trường',
      locale: 'vi-VN',
      payloadJson: {
        scenes: [{ sceneNumber: 1 }, { sceneNumber: 2 }, { sceneNumber: 3 }],
        readAloud: { enabled: true },
      },
      metadataJson: {
        ageBand: '6-8',
        selThemes: ['chapter:choi_cung_ban', 'session:1', 'step:1'],
      },
    });

    assert.equal(tagged.chapterKey, 'choi_cung_ban');
    assert.equal(tagged.sessionNumber, 1);
    assert.equal(tagged.stepNumber, 1);
    assert.equal(tagged.storySceneCount, 3);
    assert.equal(tagged.hasReadAloud, true);
    assert.equal(tagged.hasAacSupport, false);
    assert.equal(tagged.groupingSource, 'sel_theme_convention');

    const unscoped = mapContentVersionToUiDescriptor({
      id: 'cv-2',
      contentItemId: 'ci-2',
      contentType: 'emotion_card',
      title: 'Bình yên',
      locale: 'vi',
      payloadJson: {},
      metadataJson: null,
    });
    assert.equal(unscoped.chapterKey, null);
    assert.equal(unscoped.groupingSource, 'unscoped_library_item');
  });
});
