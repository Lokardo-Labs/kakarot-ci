/**
 * OpenAI provider implementation
 */

import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { error, debug, warn } from '../../utils/logger.js';

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseLLMProvider {
  private baseUrl = 'https://api.openai.com/v1';
  private maxRetries = 3;
  private baseRetryDelay = 1000; // 1 second

  async generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    return this.withRetry(() => this._generate(messages, options), 'OpenAI API request');
  }

  private async _generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    this.validateApiKey();
    const mergedOptions = this.mergeOptions(options);

    // GPT-5 and newer models use max_completion_tokens instead of max_tokens
    const isGPT5OrNewer = this.model && (
      this.model.startsWith('gpt-5') || 
      this.model.startsWith('o1') || 
      this.model.startsWith('o3')
    );
    const tokenParam = isGPT5OrNewer ? 'max_completion_tokens' : 'max_tokens';
    
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: mergedOptions.temperature,
      ...(mergedOptions.stopSequences.length > 0 && { stop: mergedOptions.stopSequences }),
    };
    
    // Use the appropriate parameter based on model
    requestBody[tokenParam] = mergedOptions.maxTokens;

    debug(`Calling OpenAI API with model: ${this.model}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
      let errorMessage = `OpenAI API error: ${response.status} ${response.statusText}`;
      
      // Parse error details if available
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message) {
          errorMessage += ` - ${errorData.error.message}`;
        }
      } catch {
        // If parsing fails, use raw text
        if (errorText) {
          errorMessage += ` - ${errorText.substring(0, 200)}`;
        }
      }

      // Check for rate limit vs quota error (both are 429)
      if (response.status === 429) {
        // Parse error message to distinguish quota vs rate limit
        let isQuotaError = false;
        let errorMessageText = '';
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessageText = errorData.error.message.toLowerCase();
            // Quota errors: "exceeded your current quota", "quota", "billing"
            // Rate limit errors: "rate limit", "rate limit reached"
            isQuotaError = errorMessageText.includes('exceeded your current quota') ||
                          errorMessageText.includes('quota exceeded') ||
                          errorMessageText.includes('billing') ||
                          (errorMessageText.includes('quota') && !errorMessageText.includes('rate limit'));
          }
        } catch {
          // If parsing fails, check raw error text
          const lowerErrorText = errorText.toLowerCase();
          isQuotaError = lowerErrorText.includes('exceeded your current quota') ||
                        lowerErrorText.includes('quota exceeded') ||
                        lowerErrorText.includes('billing');
        }
        
        // Quota errors are non-retryable - fail fast
        if (isQuotaError) {
          const quotaError = new Error(
            `${errorMessage}\n\nQuota exceeded. Please check your OpenAI billing and plan. This error won't resolve by retrying. Stopping.`
          );
          (quotaError as any).isQuotaError = true;
          (quotaError as any).isNonRetryable = true;
          throw quotaError;
        }
        
        // Rate limit errors are retryable
        // Parse retry-after from both header and error message, prefer the more precise one
        let retryAfterSeconds: number | null = null;
        let retryAfterFromHeader: number | null = null;
        let retryAfterFromMessage: number | null = null;
        
        const retryAfterHeader = response.headers.get('retry-after');
        if (retryAfterHeader) {
          retryAfterFromHeader = parseFloat(retryAfterHeader);
        }
        
        // Always try to parse from error message for more precision
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            const message = errorData.error.message;
            // Match "Please try again in 1.394s" or "try again in 7.426s"
            const retryMatch = message.match(/try again in ([\d.]+)\s*s/i);
            if (retryMatch) {
              retryAfterFromMessage = parseFloat(retryMatch[1]);
            }
          }
        } catch {
          // If parsing fails, try to parse from raw error text
          const retryMatch = errorText.match(/try again in ([\d.]+)\s*s/i);
          if (retryMatch) {
            retryAfterFromMessage = parseFloat(retryMatch[1]);
          }
        }
        
        // Prefer message value if available (usually more precise), otherwise use header
        retryAfterSeconds = retryAfterFromMessage ?? retryAfterFromHeader;
        
        // Try to extract token information from error message
        let availableTokens: number | null = null;
        let requestTokens: number | null = null;
        let refillRate: number | null = null; // tokens per minute
        
        try {
          const errorData = JSON.parse(errorText);
          // OpenAI rate limit errors may include token information
          if (errorData.error?.message) {
            // Try to parse token information from error message
            // Example: "Rate limit reached for requests. Limit: 30000 requests per 60s. Available: 6301 tokens. Requested: 9123 tokens."
            const message = errorData.error.message;
            const availableMatch = message.match(/Available:\s*(\d+)\s*tokens?/i);
            const requestedMatch = message.match(/Requested:\s*(\d+)\s*tokens?/i);
            const refillMatch = message.match(/(\d+)\s*tokens?\s*per\s*(\d+)\s*(?:s|seconds?|min|minutes?)/i);
            
            if (availableMatch) {
              availableTokens = parseInt(availableMatch[1], 10);
            }
            if (requestedMatch) {
              requestTokens = parseInt(requestedMatch[1], 10);
            }
            if (refillMatch) {
              const tokens = parseInt(refillMatch[1], 10);
              const timeUnit = refillMatch[2];
              // Convert to tokens per minute
              if (timeUnit.includes('60') || timeUnit.includes('min')) {
                refillRate = tokens;
              } else {
                // Assume per second, convert to per minute
                refillRate = tokens * 60;
              }
            }
          }
        } catch {
          // If parsing fails, continue without token info
        }
        
        const rateLimitError = new Error(errorMessage);
        (rateLimitError as any).isRateLimit = true;
        (rateLimitError as any).retryAfter = retryAfterSeconds;
        (rateLimitError as any).availableTokens = availableTokens;
        (rateLimitError as any).requestTokens = requestTokens;
        (rateLimitError as any).refillRate = refillRate;
        throw rateLimitError;
      }

      error(errorMessage);
      throw new Error(errorMessage);
      }

      const data = (await response.json()) as OpenAIResponse;

      if (!data.choices || data.choices.length === 0) {
        error('OpenAI API returned no choices');
        throw new Error('OpenAI API returned no choices');
      }

      const content = data.choices[0]?.message?.content ?? '';
      const finishReason = data.choices[0]?.finish_reason;
      
      // OpenAI uses 'stop', 'length', 'content_filter', 'tool_calls', etc.
      const truncated = finishReason === 'length';
      
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined;

      this.logUsage(usage, 'OpenAI');
      
      if (truncated) {
        warn(`Response truncated (finish_reason: ${finishReason}). Output may be incomplete.`);
      }

      return {
        content,
        finishReason,
        truncated,
        usage,
      };
  }

  /**
   * Retry wrapper with exponential backoff for rate limits and server errors
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Check for non-retryable errors (quota, configuration errors)
      const isQuotaError = err && typeof err === 'object' && 'isQuotaError' in err && (err as any).isQuotaError === true;
      const isNonRetryable = err && typeof err === 'object' && 'isNonRetryable' in err && (err as any).isNonRetryable === true;
      
      // Quota errors and other non-retryable errors should fail immediately
      if (isQuotaError || isNonRetryable) {
        error(`${operation} failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
      
      const isRateLimit = err && typeof err === 'object' && 'isRateLimit' in err && (err as any).isRateLimit === true;
      const isServerError = err instanceof Error && (
        err.message.includes('500') ||
        err.message.includes('502') ||
        err.message.includes('503') ||
        err.message.includes('504')
      );

      if (isRateLimit || isServerError) {
        if (retries <= 0) {
          error(`${operation} failed after ${this.maxRetries} retries: ${err instanceof Error ? err.message : String(err)}`);
          throw err;
        }

        // Use retry-after header if available, otherwise use exponential backoff
        let delay = this.baseRetryDelay * Math.pow(2, this.maxRetries - retries);
        if (isRateLimit && err && typeof err === 'object' && 'retryAfter' in err) {
          const retryAfter = (err as any).retryAfter;
          const availableTokens = (err as any).availableTokens;
          const requestTokens = (err as any).requestTokens;
          const refillRate = (err as any).refillRate;
          
          if (retryAfter && retryAfter > 0) {
            // Use exact retry-after time (preserve decimals, e.g., 5.644s)
            delay = retryAfter * 1000; // Convert seconds to milliseconds
            
            // If we have token information, calculate if request will fit after waiting
            if (availableTokens !== null && requestTokens !== null && refillRate !== null) {
              const tokensNeeded = requestTokens - availableTokens;
              
              if (tokensNeeded > 0) {
                // Calculate how many tokens will be available after retry-after time
                const tokensRefilledInWait = (retryAfter / 60) * refillRate; // tokens refilled during wait
                const tokensAfterWait = availableTokens + tokensRefilledInWait;
                
                if (tokensAfterWait < requestTokens) {
                  // Still won't have enough tokens, calculate additional wait time
                  const tokensStillNeeded = requestTokens - tokensAfterWait;
                  const additionalSeconds = (tokensStillNeeded / refillRate) * 60; // convert to seconds
                  delay = (retryAfter + additionalSeconds) * 1000;
                  
                  warn(`Available tokens: ${availableTokens}, Request needs: ${requestTokens}`);
                  warn(`After ${retryAfter.toFixed(3)}s wait, will have ~${Math.floor(tokensAfterWait)} tokens, still need ${tokensStillNeeded.toFixed(0)} more`);
                  warn(`Waiting ${(delay / 1000).toFixed(3)}s total for tokens to refill`);
                } else {
                  debug(`Available tokens: ${availableTokens}, Request needs: ${requestTokens}`);
                  debug(`After ${retryAfter.toFixed(3)}s wait, will have ~${Math.floor(tokensAfterWait)} tokens (sufficient)`);
                }
              }
            }
          }
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        const delaySeconds = delay / 1000;
        const rateLimitMsg = isRateLimit 
          ? `Rate limit exceeded. Retrying in ${delaySeconds.toFixed(3)}s... (${retries} retries left)`
          : `Server error. Retrying in ${delaySeconds.toFixed(3)}s... (${retries} retries left)`;
        
        warn(`${operation} failed: ${errorMsg}`);
        warn(rateLimitMsg);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.withRetry(fn, operation, retries - 1);
      }

      // Don't retry for other errors
      throw err;
    }
  }
}

