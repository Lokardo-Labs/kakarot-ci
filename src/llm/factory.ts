/**
 * LLM provider factory
 */

import type { KakarotConfig } from '../types/config.js';
import type { LLMProvider } from '../types/llm.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GoogleProvider } from './providers/google.js';
import { error } from '../utils/logger.js';

/**
 * Create an LLM provider based on configuration
 */
export function createLLMProvider(
  config: Pick<KakarotConfig, 'apiKey' | 'provider' | 'model' | 'maxTokens'>
): LLMProvider {
  const provider = config.provider ?? 'openai';
  const model = config.model ?? getDefaultModel(provider);
  const defaultOptions = config.maxTokens ? { maxTokens: config.maxTokens } : undefined;

  switch (provider) {
    case 'openai':
      return new OpenAIProvider(config.apiKey, model, defaultOptions);
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, model, defaultOptions);
    case 'google':
      return new GoogleProvider(config.apiKey, model, defaultOptions);
    default:
      error(`Unknown LLM provider: ${provider}`);
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Get default model for a provider
 */
function getDefaultModel(provider: 'openai' | 'anthropic' | 'google'): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4-turbo-preview';
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022';
    case 'google':
      return 'gemini-1.5-pro';
    default:
      return 'gpt-4-turbo-preview';
  }
}

