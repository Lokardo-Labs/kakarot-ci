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
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseLLMProvider {
  private baseUrl = 'https://api.anthropic.com/v1';

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
        this.parse429Error(errorText, errorMessage, response.headers.get('retry-after'), 'Anthropic');
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
    const stopReason = data.stop_reason;
    
    // Normalize: Anthropic uses 'end_turn', 'max_tokens', etc.
    const finishReason = stopReason === 'end_turn' ? 'stop' : stopReason;
    const truncated = stopReason === 'max_tokens';
    
    const usage = data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined;

    this.logUsage(usage, 'Anthropic');
    
    if (truncated) {
      warn(`Response truncated (stop_reason: ${stopReason}). Output may be incomplete.`);
    }

    return {
      content,
      finishReason,
      truncated,
      usage,
    };
  }
}
