import crypto from 'node:crypto';
import { AppError } from '../http/errors.ts';

interface BucketEntry {
  count: number;
  resetAtMs: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Single-process bounded in-memory rate limiter for MVP pre-authentication abuse protection.
 * Limitation: counters are local to one Node.js process and must be replaced or fronted by
 * shared Redis/edge rate limiting before scaling out across multiple instances.
 */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly maxEntries: number;
  private readonly hmacSalt: Buffer;

  constructor(options?: { maxEntries?: number; hmacSalt?: Buffer }) {
    this.maxEntries = options?.maxEntries ?? 10_000;
    this.hmacSalt = options?.hmacSalt ?? crypto.randomBytes(32);
  }

  public deriveBucketKey(namespace: string, rawKey: string): string {
    return crypto
      .createHmac('sha256', this.hmacSalt)
      .update(`${namespace}|${rawKey}`, 'utf8')
      .digest('hex');
  }

  private pruneExpired(nowMs: number): void {
    for (const [key, entry] of this.buckets) {
      if (nowMs >= entry.resetAtMs) {
        this.buckets.delete(key);
      }
    }
  }

  public consume(
    namespace: string,
    rawKey: string,
    limit: number,
    windowMs: number,
    nowMs: number = Date.now()
  ): RateLimitCheckResult {
    if (this.buckets.size >= this.maxEntries) {
      this.pruneExpired(nowMs);
    }

    const key = this.deriveBucketKey(namespace, rawKey);
    const existing = this.buckets.get(key);

    if (!existing || nowMs >= existing.resetAtMs) {
      if (!existing && this.buckets.size >= this.maxEntries) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      this.buckets.set(key, {
        count: 1,
        resetAtMs: nowMs + windowMs,
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
    };
  }

  public clear(): void {
    this.buckets.clear();
  }

  public get size(): number {
    return this.buckets.size;
  }
}

export class RateLimitExceededError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super({
      httpStatus: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      messageKey: 'error.security.rate_limit_exceeded',
      message: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.',
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
