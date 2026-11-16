import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it, mock } from 'node:test';
import {
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  needsRehash,
  parseStoredHash,
  verifyPassword,
} from './password-hash.ts';

describe('scrypt password-hash module', () => {
  const sampleSecret = 'mimora-sample-credential-01';

  it('T1: hashes a password into versioned scrypt$v1 format', async () => {
    const hashed = await hashPassword(sampleSecret);
    assert.equal(typeof hashed, 'string');
    assert.ok(hashed.startsWith('scrypt$v1$N=65536,r=8,p=2,dkLen=32$'));

    const parsed = parseStoredHash(hashed);
    assert.ok(parsed !== null);
    assert.equal(parsed.algorithm, 'scrypt');
    assert.equal(parsed.version, 'v1');
    assert.equal(parsed.salt.length, 16);
    assert.equal(parsed.hash.length, DEFAULT_SCRYPT_PARAMS.dkLen);
  });

  it('T2: verifies matching password returns true', async () => {
    const hashed = await hashPassword(sampleSecret);
    const valid = await verifyPassword(sampleSecret, hashed);
    assert.equal(valid, true);
  });

  it('T3: verifies wrong password returns false', async () => {
    const hashed = await hashPassword(sampleSecret);
    const valid = await verifyPassword('wrong-credential-99', hashed);
    assert.equal(valid, false);
  });

  it('T4: generates unique random salt per hash call', async () => {
    const h1 = await hashPassword(sampleSecret);
    const h2 = await hashPassword(sampleSecret);
    assert.notEqual(h1, h2);

    const p1 = parseStoredHash(h1);
    const p2 = parseStoredHash(h2);
    assert.ok(p1 && p2);
    assert.equal(p1.salt.equals(p2.salt), false);
    assert.equal(p1.hash.equals(p2.hash), false);
  });

  it('T5: invokes crypto.timingSafeEqual during verification', async () => {
    const hashed = await hashPassword(sampleSecret);
    const spy = mock.method(crypto, 'timingSafeEqual');
    try {
      const ok = await verifyPassword(sampleSecret, hashed);
      assert.equal(ok, true);
      assert.equal(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  });

  it('T6: rejects empty or oversized passwords safely', async () => {
    await assert.rejects(() => hashPassword(''), /non-empty/);

    const validHash = await hashPassword(sampleSecret);
    assert.equal(await verifyPassword('', validHash), false);
    assert.equal(await verifyPassword('a'.repeat(1025), validHash), false);
  });

  it('T7: rejects malformed or unsafe stored hash formats without throwing', async () => {
    const invalidFormats = [
      '',
      'plaintext-value',
      'scrypt$v2$N=65536,r=8,p=2,dkLen=32$abc$def',
      'argon2id$v=19$m=19456,t=2,p=1$abc$def',
      'scrypt$v1$N=65536,r=8,p=2,dkLen=32$short$short',
      'scrypt$v1$N=1024,r=8,p=2,dkLen=32$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'scrypt$v1$N=1048576,r=32,p=1,dkLen=32$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'scrypt$v1$N=65536,r=8,p=2,dkLen=32$bad*chars!$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ];

    for (const candidate of invalidFormats) {
      const ok = await verifyPassword(sampleSecret, candidate);
      assert.equal(ok, false);
    }
  });

  it('T8: fails verification when stored hash digest or salt is modified', async () => {
    const hashed = await hashPassword(sampleSecret);
    const parts = hashed.split('$');
    assert.equal(parts.length, 5);

    // Flip one character in the hash digest
    const digest = parts[4];
    const flippedChar = digest[0] === 'A' ? 'B' : 'A';
    const modifiedDigestHash = `${parts[0]}$${parts[1]}$${parts[2]}$${parts[3]}$${flippedChar}${digest.slice(1)}`;
    assert.equal(await verifyPassword(sampleSecret, modifiedDigestHash), false);

    // Flip one character in the salt
    const salt = parts[3];
    const flippedSaltChar = salt[0] === 'A' ? 'B' : 'A';
    const modifiedSaltHash = `${parts[0]}$${parts[1]}$${parts[2]}$${flippedSaltChar}${salt.slice(1)}$${parts[4]}`;
    assert.equal(await verifyPassword(sampleSecret, modifiedSaltHash), false);
  });

  it('supports upgrade detection via needsRehash', async () => {
    const weakerHash = await hashPassword(sampleSecret, {
      N: 16384,
      r: 8,
      p: 5,
      dkLen: 32,
    });
    assert.equal(needsRehash(weakerHash), true);

    const currentHash = await hashPassword(sampleSecret);
    assert.equal(needsRehash(currentHash), false);
  });
});
