/**
 * Google (Gemini) provider implementation
 */

import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { error, debug, warn } from '../../utils/logger.js';

interface GoogleContentPart {
  text: string;
}

interface GoogleContent {
  role: 'user' | 'model';
  parts: GoogleContentPart[];
}

interface GoogleGenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  stopSequences?: string[];
}

interface GoogleSystemInstruction {
  parts: GoogleContentPart[];
}

interface GoogleRequest {
  contents: GoogleContent[];
  generationConfig: GoogleGenerationConfig;
  systemInstruction?: GoogleSystemInstruction;
}

interface GoogleResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleProvider extends BaseLLMProvider {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private maxRetries = 3;
  private baseRetryDelay = 1000;

  async generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    return this.withRetry(() => this._generate(messages, options), 'Google API request');
  }

  private async _generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    this.validateApiKey();
    const mergedOptions = this.mergeOptions(options);

    // Google Gemini uses a different message format
    const systemInstruction = messages.find((m) => m.role === 'system')?.content;
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const contents: GoogleContent[] = conversationMessages.map((msg) => ({
      role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: msg.content }],
    }));

    const generationConfig: GoogleGenerationConfig = {
      temperature: mergedOptions.temperature,
      maxOutputTokens: mergedOptions.maxTokens,
      ...(mergedOptions.stopSequences.length > 0 && { stopSequences: mergedOptions.stopSequences }),
    };

    const requestBody: GoogleRequest = {
      contents,
      generationConfig,
      ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
    };

    debug(`Calling Google API with model: ${this.model}`);

      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
      let errorMessage = `Google API error: ${response.status} ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message) {
          errorMessage += ` - ${errorData.error.message}`;
        }
      } catch {
        if (errorText) {
          errorMessage += ` - ${errorText.substring(0, 200)}`;
        }
      }

      if (response.status === 429) {
        // Parse error message to distinguish quota vs rate limit
        let isQuotaError = false;
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            const message = errorData.error.message.toLowerCase();
            // Quota errors: "quota", "billing", "exceeded quota"
            isQuotaError = message.includes('quota') && !message.includes('rate limit') ||
                          message.includes('billing') ||
                          message.includes('exceeded quota');
          }
        } catch {
          // If parsing fails, check raw error text
          const lowerErrorText = errorText.toLowerCase();
          isQuotaError = lowerErrorText.includes('quota') && !lowerErrorText.includes('rate limit') ||
                        lowerErrorText.includes('billing') ||
                        lowerErrorText.includes('exceeded quota');
        }
        
        // Quota errors are non-retryable - fail fast
        if (isQuotaError) {
          const quotaError = new Error(
            `${errorMessage}\n\nQuota exceeded. Please check your Google billing and plan. This error won't resolve by retrying. Stopping.`
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
          if (errorData.error?.message) {
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
              if (timeUnit.includes('60') || timeUnit.includes('min')) {
                refillRate = tokens;
              } else {
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

      const data = (await response.json()) as GoogleResponse;

      if (!data.candidates || data.candidates.length === 0) {
        error('Google API returned no candidates');
        throw new Error('Google API returned no candidates');
      }

      const content = data.candidates[0]?.content?.parts?.map((p) => p.text).join('\n') ?? '';
      const usage = data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          }
        : undefined;

      this.logUsage(usage, 'Google');

      return {
        content,
        usage,
      };
  }

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

