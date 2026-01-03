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

    const requestBody = {
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: mergedOptions.temperature,
      max_tokens: mergedOptions.maxTokens,
      ...(mergedOptions.stopSequences.length > 0 && { stop: mergedOptions.stopSequences }),
    };

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

      // Check for rate limit
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
        
        const rateLimitError = new Error(errorMessage);
        (rateLimitError as any).isRateLimit = true;
        (rateLimitError as any).retryAfter = retryAfterSeconds;
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
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    this.logUsage(usage, 'OpenAI');

    return {
      content,
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
          if (retryAfter && retryAfter > 0) {
            delay = retryAfter * 1000; // Convert seconds to milliseconds
          }
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        const rateLimitMsg = isRateLimit 
          ? `Rate limit exceeded. Retrying in ${Math.ceil(delay / 1000)}s... (${retries} retries left)`
          : `Server error. Retrying in ${Math.ceil(delay / 1000)}s... (${retries} retries left)`;
        
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

