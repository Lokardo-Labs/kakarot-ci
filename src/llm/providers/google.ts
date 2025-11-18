/**
 * Google (Gemini) provider implementation
 */

import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse, LLMGenerateOptions } from '../../types/llm.js';
import { error, debug } from '../../utils/logger.js';

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

    try {
      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        error(`Google API error: ${response.status} ${response.statusText} - ${errorText}`);
        throw new Error(`Google API error: ${response.status} ${response.statusText}`);
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
    } catch (err) {
      if (err instanceof Error) {
        error(`Google API request failed: ${err.message}`);
        throw err;
      }
      throw new Error('Unknown error calling Google API');
    }
  }
}

