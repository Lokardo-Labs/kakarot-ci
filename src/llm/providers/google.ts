import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { NonRetryableError } from '../../types/errors.js';
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

  async generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    return this.withRetry(() => this._generate(messages, options), 'Google API request');
  }

  private async _generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    this.validateApiKey();
    const mergedOptions = this.mergeOptions(options);

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

    const response = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
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

      if (response.status === 404) {
        throw new NonRetryableError(
          `${errorMessage}\n\nModel '${this.model}' not found. Please check the model name is correct. Available models: gemini-2.5-flash, gemini-2.5-pro, gemini-1.5-flash, gemini-1.5-pro.`
        );
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new NonRetryableError(errorMessage);
      }

      if (response.status === 429) {
        this.parse429Error(errorText, errorMessage, response.headers.get('retry-after'), 'Google');
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
    const finishReason = data.candidates[0]?.finishReason;
    
    debug(`Gemini finishReason: ${finishReason}, content length: ${content.length} chars`);
    
    // Normalize: Google uses 'STOP', 'MAX_TOKENS', 'SAFETY', etc.
    const normalizedFinishReason = finishReason?.toLowerCase().replace('_', '-');
    const truncated = finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH';
    
    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    this.logUsage(usage, 'Google');
    
    if (truncated) {
      warn(`Response truncated (finishReason: ${finishReason}). Output may be incomplete.`);
    }

    return {
      content,
      finishReason: normalizedFinishReason,
      truncated,
      usage,
    };
  }
}
