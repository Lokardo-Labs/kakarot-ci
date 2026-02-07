import type { LLMMessage, LLMResponse, LLMGenerateOptions, LLMProvider } from '../../types/llm.js';
import { RateLimitError, QuotaError, NonRetryableError } from '../../types/errors.js';
import { error, debug, warn } from '../../utils/logger.js';

export abstract class BaseLLMProvider implements LLMProvider {
  protected apiKey: string;
  protected model: string;
  protected defaultOptions: Required<LLMGenerateOptions>;
  protected maxRetries = 3;
  protected baseRetryDelay = 1000;

  constructor(apiKey: string, model: string, defaultOptions?: Partial<LLMGenerateOptions>) {
    this.apiKey = apiKey;
    this.model = model;
    this.defaultOptions = {
      temperature: defaultOptions?.temperature ?? 0.2,
      maxTokens: defaultOptions?.maxTokens ?? 4000,
      stopSequences: defaultOptions?.stopSequences ?? [],
    };
  }

  abstract generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse>;

  protected mergeOptions(options?: LLMGenerateOptions): Required<LLMGenerateOptions> {
    return {
      temperature: options?.temperature ?? this.defaultOptions.temperature,
      maxTokens: options?.maxTokens ?? this.defaultOptions.maxTokens,
      stopSequences: options?.stopSequences ?? this.defaultOptions.stopSequences,
    };
  }

  protected validateApiKey(): void {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      error('LLM API key is required but not provided');
      throw new Error('LLM API key is required');
    }
  }

  protected logUsage(usage: LLMResponse['usage'], operation: string): void {
    if (usage) {
      debug(
        `${operation} usage: ${usage.totalTokens ?? 'unknown'} tokens ` +
          `(prompt: ${usage.promptTokens ?? 'unknown'}, completion: ${usage.completionTokens ?? 'unknown'})`
      );
    }
  }

  protected parse429Error(
    errorText: string,
    baseMessage: string,
    retryAfterHeader: string | null,
    providerName: string
  ): never {
    let isQuota = false;

    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.message) {
        const msg = errorData.error.message.toLowerCase();
        isQuota =
          msg.includes('exceeded your current quota') ||
          msg.includes('quota exceeded') ||
          msg.includes('billing') ||
          (msg.includes('quota') && !msg.includes('rate limit'));
      }
    } catch {
      const lower = errorText.toLowerCase();
      isQuota =
        lower.includes('exceeded your current quota') ||
        lower.includes('quota exceeded') ||
        lower.includes('billing') ||
        (lower.includes('quota') && !lower.includes('rate limit'));
    }

    if (isQuota) {
      throw new QuotaError(
        `${baseMessage}\n\nQuota exceeded. Please check your ${providerName} billing and plan. This error won't resolve by retrying. Stopping.`
      );
    }

    let retryAfterSeconds: number | null = null;
    let retryAfterFromHeader: number | null = null;
    let retryAfterFromMessage: number | null = null;

    if (retryAfterHeader) {
      retryAfterFromHeader = parseFloat(retryAfterHeader);
    }

    let availableTokens: number | null = null;
    let requestTokens: number | null = null;
    let refillRate: number | null = null;

    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.message) {
        const message = errorData.error.message;

        const retryMatch = message.match(/try again in ([\d.]+)\s*s/i);
        if (retryMatch) {
          retryAfterFromMessage = parseFloat(retryMatch[1]);
        }

        const availableMatch = message.match(/Available:\s*(\d+)\s*tokens?/i);
        if (availableMatch) {
          availableTokens = parseInt(availableMatch[1], 10);
        }

        const requestedMatch = message.match(/Requested:\s*(\d+)\s*tokens?/i);
        if (requestedMatch) {
          requestTokens = parseInt(requestedMatch[1], 10);
        }

        const refillMatch = message.match(/(\d+)\s*tokens?\s*per\s*(\d+)\s*(?:s|seconds?|min|minutes?)/i);
        if (refillMatch) {
          const tokens = parseInt(refillMatch[1], 10);
          const timeUnit = refillMatch[2];
          refillRate = timeUnit.includes('60') || timeUnit.includes('min') ? tokens : tokens * 60;
        }
      }
    } catch {
      const retryMatch = errorText.match(/try again in ([\d.]+)\s*s/i);
      if (retryMatch) {
        retryAfterFromMessage = parseFloat(retryMatch[1]);
      }
    }

    retryAfterSeconds = retryAfterFromMessage ?? retryAfterFromHeader;

    throw new RateLimitError(baseMessage, {
      retryAfter: retryAfterSeconds,
      availableTokens,
      requestTokens,
      refillRate,
    });
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof QuotaError || err instanceof NonRetryableError) {
        error(`${operation} failed: ${err.message}`);
        throw err;
      }

      const isRateLimit = err instanceof RateLimitError;
      const isServerError =
        err instanceof Error &&
        (err.message.includes('500') ||
          err.message.includes('502') ||
          err.message.includes('503') ||
          err.message.includes('504'));

      if (isRateLimit || isServerError) {
        if (retries <= 0) {
          error(`${operation} failed after ${this.maxRetries} retries: ${err instanceof Error ? err.message : String(err)}`);
          throw err;
        }

        let delay = this.baseRetryDelay * Math.pow(2, this.maxRetries - retries);

        if (isRateLimit) {
          const rlErr = err as RateLimitError;
          if (rlErr.retryAfter && rlErr.retryAfter > 0) {
            delay = rlErr.retryAfter * 1000;

            if (
              rlErr.availableTokens !== null &&
              rlErr.requestTokens !== null &&
              rlErr.refillRate !== null
            ) {
              const tokensNeeded = rlErr.requestTokens - rlErr.availableTokens;
              if (tokensNeeded > 0) {
                const tokensRefilledInWait = (rlErr.retryAfter / 60) * rlErr.refillRate;
                const tokensAfterWait = rlErr.availableTokens + tokensRefilledInWait;
                if (tokensAfterWait < rlErr.requestTokens) {
                  const tokensStillNeeded = rlErr.requestTokens - tokensAfterWait;
                  const additionalSeconds = (tokensStillNeeded / rlErr.refillRate) * 60;
                  delay = (rlErr.retryAfter + additionalSeconds) * 1000;
                  warn(`Available tokens: ${rlErr.availableTokens}, Request needs: ${rlErr.requestTokens}`);
                  warn(`After ${rlErr.retryAfter.toFixed(3)}s wait, will have ~${Math.floor(tokensAfterWait)} tokens, still need ${tokensStillNeeded.toFixed(0)} more`);
                  warn(`Waiting ${(delay / 1000).toFixed(3)}s total for tokens to refill`);
                } else {
                  debug(`Available tokens: ${rlErr.availableTokens}, Request needs: ${rlErr.requestTokens}`);
                  debug(`After ${rlErr.retryAfter.toFixed(3)}s wait, will have ~${Math.floor(tokensAfterWait)} tokens (sufficient)`);
                }
              }
            }
          }
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        const delaySeconds = delay / 1000;
        const rateLimitMsg = isRateLimit
          ? `Rate limit exceeded. Retrying in ${delaySeconds.toFixed(3)}s... (${retries} retries left)`
          : `Server error. Retrying in ${Math.ceil(delaySeconds)}s... (${retries} retries left)`;

        warn(`${operation} failed: ${errorMsg}`);
        warn(rateLimitMsg);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.withRetry(fn, operation, retries - 1);
      }

      throw err;
    }
  }
}
