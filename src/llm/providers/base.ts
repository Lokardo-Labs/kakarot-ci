/**
 * Base LLM provider interface and utilities
 */

import type { LLMMessage, LLMResponse, LLMGenerateOptions, LLMProvider } from '../../types/llm.js';
import { error, debug } from '../../utils/logger.js';

export abstract class BaseLLMProvider implements LLMProvider {
  protected apiKey: string;
  protected model: string;
  protected defaultOptions: Required<LLMGenerateOptions>;

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
}

