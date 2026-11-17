import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCALE,
  getCookieConfig,
  getServerConfig,
  parseServerConfig,
  resetServerConfigCache,
} from './env.ts';

test('parseServerConfig provides safe defaults with vi-VN locale and no secret requirements', () => {
  const cfg = parseServerConfig({});
  assert.equal(cfg.nodeEnv, 'development');
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.defaultLocale, DEFAULT_LOCALE);
  assert.equal(cfg.defaultLocale, 'vi-VN');
  assert.equal(cfg.jsonBodyLimit, '1mb');
  assert.deepEqual(cfg.cookie, {
    name: 'mimora_session',
    secure: true,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
  });
});

test('parseServerConfig accepts COOKIE_SAMESITE=none when COOKIE_SECURE=true', () => {
  const cookieCfg = getCookieConfig({
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'NONE',
  });
  assert.deepEqual(cookieCfg, {
    name: 'mimora_session',
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    path: '/',
  });
});

test('parseServerConfig rejects COOKIE_SAMESITE=none when COOKIE_SECURE=false', () => {
  assert.throws(
    () =>
      parseServerConfig({
        COOKIE_SECURE: 'false',
        COOKIE_SAMESITE: 'none',
      }),
    /Invalid server configuration/
  );
});

test('parseServerConfig rejects invalid PORT and APP_URL without leaking raw values', () => {
  const secretLikePort = '99999-secret-token';
  assert.throws(
    () => parseServerConfig({ PORT: secretLikePort }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(secretLikePort), false);
      return true;
    }
  );

  assert.throws(() => parseServerConfig({ APP_URL: 'ftp://invalid.local' }), /APP_URL/);
});

test('getServerConfig caches default env parse and resets cleanly', () => {
  resetServerConfigCache();
  const a = getServerConfig();
  const b = getServerConfig();
  assert.strictEqual(a, b);
  resetServerConfigCache();
});

test('parseServerConfig enforces production COOKIE_SECURE, TRUSTED_ORIGINS, scrypt cap <= 4, and paired lockout config', () => {
  assert.throws(
    () =>
      parseServerConfig({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }),
    /Invalid server configuration/
  );

  assert.throws(
    () =>
      parseServerConfig({
        TRUSTED_ORIGINS: 'https://*.example.com',
      }),
    /Invalid server configuration/
  );

  assert.throws(
    () =>
      parseServerConfig({
        SCRYPT_MAX_CONCURRENT: '5',
      }),
    /Invalid server configuration/
  );

  assert.throws(
    () =>
      parseServerConfig({
        LOCKOUT_MAX_FAILED_ATTEMPTS: '5',
      }),
    /Invalid server configuration/
  );

  const valid = parseServerConfig({
    NODE_ENV: 'production',
    APP_URL: 'https://app.mimora.vn/login',
    TRUSTED_ORIGINS: 'https://admin.mimora.vn',
    SCRYPT_MAX_CONCURRENT: '4',
    LOCKOUT_MAX_FAILED_ATTEMPTS: '5',
    LOCKOUT_DURATION_MINUTES: '15',
  });
  assert.deepEqual(valid.auth.trustedOrigins, [
    'https://app.mimora.vn',
    'https://admin.mimora.vn',
  ]);
  assert.equal(valid.auth.scryptMaxConcurrent, 4);
  assert.equal(valid.auth.lockoutMaxFailedAttempts, 5);
  assert.equal(valid.auth.lockoutDurationMinutes, 15);
  assert.equal(valid.csv.maxBytes, 524_288);
  assert.equal(valid.csv.maxRows, 500);

  assert.throws(
    () => parseServerConfig({ CSV_MAX_ROWS: '5001' }),
    /Invalid server configuration/
  );
  assert.throws(
    () => parseServerConfig({ CSV_MAX_BYTES: '2000000' }),
    /Invalid server configuration/
  );
});
