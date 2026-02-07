import { describe, it, expect } from 'vitest';
import { KakarotError, RateLimitError, QuotaError, NonRetryableError } from './errors.js';

describe('KakarotError', () => {
  it('sets name and message', () => {
    const err = new KakarotError('boom');
    expect(err.name).toBe('KakarotError');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('RateLimitError', () => {
  it('defaults all fields to null', () => {
    const err = new RateLimitError('rate limited');
    expect(err.name).toBe('RateLimitError');
    expect(err.isRateLimit).toBe(true);
    expect(err.retryAfter).toBeNull();
    expect(err.availableTokens).toBeNull();
    expect(err.requestTokens).toBeNull();
    expect(err.refillRate).toBeNull();
    expect(err).toBeInstanceOf(KakarotError);
  });

  it('stores provided token info', () => {
    const err = new RateLimitError('rate limited', {
      retryAfter: 5,
      availableTokens: 100,
      requestTokens: 500,
      refillRate: 1000,
    });
    expect(err.retryAfter).toBe(5);
    expect(err.availableTokens).toBe(100);
    expect(err.requestTokens).toBe(500);
    expect(err.refillRate).toBe(1000);
  });
});

describe('QuotaError', () => {
  it('is non-retryable and instanceof KakarotError', () => {
    const err = new QuotaError('quota exceeded');
    expect(err.name).toBe('QuotaError');
    expect(err.isQuotaError).toBe(true);
    expect(err.isNonRetryable).toBe(true);
    expect(err).toBeInstanceOf(KakarotError);
  });
});

describe('NonRetryableError', () => {
  it('is non-retryable and instanceof KakarotError', () => {
    const err = new NonRetryableError('bad config');
    expect(err.name).toBe('NonRetryableError');
    expect(err.isNonRetryable).toBe(true);
    expect(err).toBeInstanceOf(KakarotError);
  });
});
