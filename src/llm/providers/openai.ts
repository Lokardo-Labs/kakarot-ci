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
        this.parse429Error(errorText, errorMessage, response.headers.get('retry-after'), 'OpenAI');
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
}
