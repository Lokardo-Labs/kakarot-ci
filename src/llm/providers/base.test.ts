import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse } from '../../types/llm.js';
import { RateLimitError, QuotaError, NonRetryableError } from '../../types/errors.js';

class TestProvider extends BaseLLMProvider {
  async generate(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: 'test response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }

  exposeParse429(errorText: string, baseMessage: string, retryAfterHeader: string | null, providerName: string): never {
    return this.parse429Error(errorText, baseMessage, retryAfterHeader, providerName);
  }

  exposeWithRetry<T>(fn: () => Promise<T>, operation: string, retries?: number): Promise<T> {
    return this.withRetry(fn, operation, retries);
  }
}

vi.mock('../../utils/logger.js', () => ({
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}));

describe('BaseLLMProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestProvider('test-key', 'test-model');
    provider['baseRetryDelay'] = 1;
  });

  it('should initialize with apiKey and model', () => {
    expect(provider).toBeInstanceOf(BaseLLMProvider);
  });

  it('should use default options when not provided', () => {
    const options = provider['mergeOptions']();
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(4000);
    expect(options.stopSequences).toEqual([]);
  });

  it('should use custom default options', () => {
    provider = new TestProvider('test-key', 'test-model', {
      temperature: 0.5,
      maxTokens: 2000,
      stopSequences: ['stop'],
    });
    const options = provider['mergeOptions']();
    expect(options.temperature).toBe(0.5);
    expect(options.maxTokens).toBe(2000);
    expect(options.stopSequences).toEqual(['stop']);
  });

  it('should merge options with defaults', () => {
    provider = new TestProvider('test-key', 'test-model', {
      temperature: 0.3,
    });
    const options = provider['mergeOptions']({ maxTokens: 1000 });
    expect(options.temperature).toBe(0.3);
    expect(options.maxTokens).toBe(1000);
  });

  it('should throw error if apiKey is empty', () => {
    expect(() => {
      provider = new TestProvider('', 'test-model');
      provider['validateApiKey']();
    }).toThrow('LLM API key is required');
  });

  it('should throw error if apiKey is whitespace only', () => {
    expect(() => {
      provider = new TestProvider('   ', 'test-model');
      provider['validateApiKey']();
    }).toThrow('LLM API key is required');
  });

  it('should not throw if apiKey is valid', () => {
    expect(() => provider['validateApiKey']()).not.toThrow();
  });

  describe('parse429Error', () => {
    it('throws QuotaError for quota exceeded JSON response', () => {
      const errorText = JSON.stringify({ error: { message: 'You exceeded your current quota' } });
      expect(() => provider.exposeParse429(errorText, 'API error', null, 'OpenAI'))
        .toThrow(QuotaError);
    });

    it('throws QuotaError for billing-related JSON response', () => {
      const errorText = JSON.stringify({ error: { message: 'billing issue detected' } });
      expect(() => provider.exposeParse429(errorText, 'API error', null, 'OpenAI'))
        .toThrow(QuotaError);
    });

    it('throws QuotaError for non-JSON quota text', () => {
      expect(() => provider.exposeParse429('quota exceeded', 'API error', null, 'Google'))
        .toThrow(QuotaError);
    });

    it('throws RateLimitError for rate limit JSON response', () => {
      const errorText = JSON.stringify({ error: { message: 'Rate limit hit, try again in 2.5s' } });
      try {
        provider.exposeParse429(errorText, 'API error', null, 'OpenAI');
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfter).toBe(2.5);
      }
    });

    it('parses available/requested tokens from error message', () => {
      const errorText = JSON.stringify({
        error: { message: 'Rate limit: Available: 500 tokens, Requested: 2000 tokens. try again in 10s' },
      });
      try {
        provider.exposeParse429(errorText, 'API error', null, 'OpenAI');
      } catch (e) {
        const rl = e as RateLimitError;
        expect(rl.availableTokens).toBe(500);
        expect(rl.requestTokens).toBe(2000);
        expect(rl.retryAfter).toBe(10);
      }
    });

    it('falls back to retry-after header when message has no retry time', () => {
      const errorText = JSON.stringify({ error: { message: 'Too many requests' } });
      try {
        provider.exposeParse429(errorText, 'API error', '3.0', 'OpenAI');
      } catch (e) {
        expect((e as RateLimitError).retryAfter).toBe(3.0);
      }
    });

    it('prefers message retry time over header', () => {
      const errorText = JSON.stringify({ error: { message: 'try again in 7s' } });
      try {
        provider.exposeParse429(errorText, 'API error', '3.0', 'OpenAI');
      } catch (e) {
        expect((e as RateLimitError).retryAfter).toBe(7);
      }
    });

    it('parses retry time from non-JSON error text', () => {
      try {
        provider.exposeParse429('try again in 4.2s', 'API error', null, 'Google');
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfter).toBe(4.2);
      }
    });
  });

  describe('withRetry', () => {
    it('returns result on success', async () => {
      const result = await provider.exposeWithRetry(() => Promise.resolve('ok'), 'test');
      expect(result).toBe('ok');
    });

    it('throws QuotaError immediately without retrying', async () => {
      const fn = vi.fn().mockRejectedValue(new QuotaError('no quota'));
      await expect(provider.exposeWithRetry(fn, 'test')).rejects.toThrow(QuotaError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws NonRetryableError immediately without retrying', async () => {
      const fn = vi.fn().mockRejectedValue(new NonRetryableError('bad config'));
      await expect(provider.exposeWithRetry(fn, 'test')).rejects.toThrow(NonRetryableError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on RateLimitError and succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new RateLimitError('rate limited'))
        .mockResolvedValueOnce('recovered');
      const result = await provider.exposeWithRetry(fn, 'test');
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on server 500 error and succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Server returned 500'))
        .mockResolvedValueOnce('recovered');
      const result = await provider.exposeWithRetry(fn, 'test');
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      const fn = vi.fn().mockRejectedValue(new RateLimitError('rate limited'));
      await expect(provider.exposeWithRetry(fn, 'test', 2)).rejects.toThrow(RateLimitError);
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('throws unknown errors immediately', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('unexpected'));
      await expect(provider.exposeWithRetry(fn, 'test')).rejects.toThrow('unexpected');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('uses retryAfter delay from RateLimitError', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new RateLimitError('limited', { retryAfter: 0.001 }))
        .mockResolvedValueOnce('ok');
      const result = await provider.exposeWithRetry(fn, 'test');
      expect(result).toBe('ok');
    });
  });
});

