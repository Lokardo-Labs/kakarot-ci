/**
 * OpenAI provider implementation
 */

import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { error, debug } from '../../utils/logger.js';

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

  async generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
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

    try {
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
        error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
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
    } catch (err) {
      if (err instanceof Error) {
        error(`OpenAI API request failed: ${err.message}`);
        throw err;
      }
      throw new Error('Unknown error calling OpenAI API');
    }
  }
}

