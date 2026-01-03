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

