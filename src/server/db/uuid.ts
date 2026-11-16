import { randomBytes } from 'node:crypto';

/**
 * Generates an RFC 9562 UUIDv7 string in canonical lowercase 36-char format.
 * Layout: 48-bit Unix epoch ms | 4-bit version (0111) | 12-bit rand_a | 2-bit variant (10) | 62-bit rand_b
 */
export function generateUuidV7(): string {
  const bytes = randomBytes(16);
  const nowMs = BigInt(Date.now());

  // 48-bit big-endian timestamp in bytes[0..5]
  bytes[0] = Number((nowMs >> 40n) & 0xffn);
  bytes[1] = Number((nowMs >> 32n) & 0xffn);
  bytes[2] = Number((nowMs >> 24n) & 0xffn);
  bytes[3] = Number((nowMs >> 16n) & 0xffn);
  bytes[4] = Number((nowMs >> 8n) & 0xffn);
  bytes[5] = Number(nowMs & 0xffn);

  // Version 7 (0111xxxx) in high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC 4122/9562 variant (10xxxxxx) in top two bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
