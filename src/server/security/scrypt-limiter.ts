import { MAX_ALLOWED_SCRYPT_CONCURRENT } from '../config/env.ts';
import { AppError } from '../http/errors.ts';

export class ScryptBusyError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 5) {
    super({
      httpStatus: 503,
      code: 'AUTH_CAPACITY_BUSY',
      messageKey: 'error.security.auth_busy',
      message: 'Hệ thống xác thực đang bận xử lý. Vui lòng thử lại sau ít giây.',
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ScryptConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private activeCount = 0;
  private peakConcurrent = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(options?: { maxConcurrent?: number; maxQueue?: number }) {
    const requestedConcurrent = options?.maxConcurrent ?? MAX_ALLOWED_SCRYPT_CONCURRENT;
    if (!Number.isInteger(requestedConcurrent) || requestedConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer.');
    }
    this.maxConcurrent = Math.min(requestedConcurrent, MAX_ALLOWED_SCRYPT_CONCURRENT);
    this.maxQueue = Math.max(0, options?.maxQueue ?? 16);
  }

  public get stats() {
    return {
      activeCount: this.activeCount,
      queuedCount: this.waitQueue.length,
      peakConcurrent: this.peakConcurrent,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
    };
  }

  public async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      if (this.waitQueue.length >= this.maxQueue) {
        throw new ScryptBusyError(5);
      }

      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.activeCount += 1;
    if (this.activeCount > this.peakConcurrent) {
      this.peakConcurrent = this.activeCount;
    }

    try {
      return await task();
    } finally {
      this.activeCount -= 1;
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    }
  }
}
