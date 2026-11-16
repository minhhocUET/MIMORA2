import crypto from 'node:crypto';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

/**
 * OWASP Password Storage Cheat Sheet (scrypt):
 * - N=65536 (2^17 is 128 MiB; 2^16 with r=8, p=2 is 64 MiB)
 * - Balances OWASP memory-hard resistance with 4 GiB container concurrency headroom.
 */
export const DEFAULT_SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({
  N: 65536,
  r: 8,
  p: 2,
  dkLen: 32,
});

const SALT_BYTES = 16;
const ALGORITHM_ID = 'scrypt';
const HASH_VERSION = 'v1';
const MAX_PASSWORD_BYTES = 1024;
const MAX_ALLOWED_SCRYPT_MEM_BYTES = 256 * 1024 * 1024; // 256 MiB hard safety cap

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function encodeBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function decodeStrictBase64Url(input: string, expectedBytes: number): Buffer | null {
  if (!input || !/^[A-Za-z0-9_-]+$/.test(input)) {
    return null;
  }
  const buf = Buffer.from(input, 'base64url');
  if (buf.length !== expectedBytes) {
    return null;
  }
  // Canonical check prevents non-canonical base64url trailing bit variations
  if (buf.toString('base64url') !== input) {
    return null;
  }
  return buf;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function computeRequiredScryptMem(N: number, r: number): number {
  // OpenSSL EVP_PBE_scrypt allocates ~128 * N * r bytes (+ small blockmix scratchpad)
  return 128 * N * r + 32 * 1024 * 1024;
}

function parseParamsSegment(segment: string): ScryptParams | null {
  const match = /^N=(\d+),r=(\d+),p=(\d+),dkLen=(\d+)$/.exec(segment);
  if (!match) {
    return null;
  }

  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  const dkLen = Number(match[4]);

  if (
    !isPowerOfTwo(N) ||
    N < 16384 ||
    N > 1048576 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 32 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 16 ||
    !Number.isInteger(dkLen) ||
    dkLen < 16 ||
    dkLen > 128
  ) {
    return null;
  }

  const estimatedMem = 128 * N * r;
  if (estimatedMem > MAX_ALLOWED_SCRYPT_MEM_BYTES) {
    return null;
  }

  return { N, r, p, dkLen };
}

export interface ParsedScryptHash {
  algorithm: typeof ALGORITHM_ID;
  version: typeof HASH_VERSION;
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

export function parseStoredHash(storedHash: string): ParsedScryptHash | null {
  if (typeof storedHash !== 'string' || storedHash.length === 0 || storedHash.length > 512) {
    return null;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 5) {
    return null;
  }

  const [algorithm, version, paramsPart, saltPart, hashPart] = parts;
  if (algorithm !== ALGORITHM_ID || version !== HASH_VERSION) {
    return null;
  }

  const params = parseParamsSegment(paramsPart);
  if (!params) {
    return null;
  }

  const salt = decodeStrictBase64Url(saltPart, SALT_BYTES);
  if (!salt) {
    return null;
  }

  const hash = decodeStrictBase64Url(hashPart, params.dkLen);
  if (!hash) {
    return null;
  }

  return {
    algorithm: ALGORITHM_ID,
    version: HASH_VERSION,
    params,
    salt,
    hash,
  };
}

export function validatePasswordInput(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new Error(`Password exceeds maximum allowed length of ${MAX_PASSWORD_BYTES} bytes.`);
  }
}

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS
): Promise<string> {
  validatePasswordInput(password);

  if (
    !isPowerOfTwo(params.N) ||
    params.N < 16384 ||
    128 * params.N * params.r > MAX_ALLOWED_SCRYPT_MEM_BYTES
  ) {
    throw new Error('Invalid or unsafe scrypt parameters.');
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const maxmem = computeRequiredScryptMem(params.N, params.r);
  const derivedKey = await scryptAsync(password, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem,
  });

  const paramsSegment = `N=${params.N},r=${params.r},p=${params.p},dkLen=${params.dkLen}`;
  return `${ALGORITHM_ID}$${HASH_VERSION}$${paramsSegment}$${encodeBase64Url(salt)}$${encodeBase64Url(derivedKey)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return false;
  }

  const parsed = parseStoredHash(storedHash);
  if (!parsed) {
    return false;
  }

  try {
    const maxmem = computeRequiredScryptMem(parsed.params.N, parsed.params.r);
    const derivedKey = await scryptAsync(password, parsed.salt, parsed.params.dkLen, {
      N: parsed.params.N,
      r: parsed.params.r,
      p: parsed.params.p,
      maxmem,
    });

    if (derivedKey.length !== parsed.hash.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, parsed.hash);
  } catch {
    return false;
  }
}

export function needsRehash(
  storedHash: string,
  targetParams: ScryptParams = DEFAULT_SCRYPT_PARAMS
): boolean {
  const parsed = parseStoredHash(storedHash);
  if (!parsed) {
    return true;
  }
  return (
    parsed.params.N < targetParams.N ||
    parsed.params.r < targetParams.r ||
    parsed.params.p < targetParams.p ||
    parsed.params.dkLen < targetParams.dkLen
  );
}
