/**
 * Anthropic (Claude) provider implementation
 */

import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { error, debug, warn } from '../../utils/logger.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature: number;
  messages: AnthropicMessage[];
  system?: string;
  stop_sequences?: string[];
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseLLMProvider {
  private baseUrl = 'https://api.anthropic.com/v1';
  private maxRetries = 3;
  private baseRetryDelay = 1000;

  async generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    return this.withRetry(() => this._generate(messages, options), 'Anthropic API request');
  }

  private async _generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    this.validateApiKey();
    const mergedOptions = this.mergeOptions(options);

    // Anthropic requires system message to be separate
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? '';
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const requestBody: AnthropicRequest = {
      model: this.model,
      max_tokens: mergedOptions.maxTokens,
      temperature: mergedOptions.temperature,
      messages: conversationMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      ...(systemMessage && { system: systemMessage }),
      ...(mergedOptions.stopSequences.length > 0 && { stop_sequences: mergedOptions.stopSequences }),
    };

    debug(`Calling Anthropic API with model: ${this.model}`);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Anthropic API error: ${response.status} ${response.statusText}`;
      
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

    const data = (await response.json()) as AnthropicResponse;

    if (!data.content || data.content.length === 0) {
      error('Anthropic API returned no content');
      throw new Error('Anthropic API returned no content');
    }

    const content = data.content.map((c) => c.text).join('\n');
    const usage = data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined;

    this.logUsage(usage, 'Anthropic');

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
          if (retryAfter && retryAfter > 0) {
            delay = retryAfter * 1000;
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

      throw err;
    }
  }
}

