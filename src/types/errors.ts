export class KakarotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KakarotError';
  }
}

export class RateLimitError extends KakarotError {
  readonly isRateLimit = true;
  readonly retryAfter: number | null;
  readonly availableTokens: number | null;
  readonly requestTokens: number | null;
  readonly refillRate: number | null;

  constructor(
    message: string,
    options: {
      retryAfter?: number | null;
      availableTokens?: number | null;
      requestTokens?: number | null;
      refillRate?: number | null;
    } = {}
  ) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = options.retryAfter ?? null;
    this.availableTokens = options.availableTokens ?? null;
    this.requestTokens = options.requestTokens ?? null;
    this.refillRate = options.refillRate ?? null;
  }
}

export class QuotaError extends KakarotError {
  readonly isQuotaError = true;
  readonly isNonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

export class NonRetryableError extends KakarotError {
  readonly isNonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
