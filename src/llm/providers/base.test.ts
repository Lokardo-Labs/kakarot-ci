import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseLLMProvider } from './base.js';
import type { LLMMessage, LLMResponse } from '../../types/llm.js';

// Create a concrete implementation for testing
class TestProvider extends BaseLLMProvider {
  async generate(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: 'test response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

vi.mock('../../utils/logger.js', () => ({
  error: vi.fn(),
  debug: vi.fn(),
}));

describe('BaseLLMProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with apiKey and model', () => {
    provider = new TestProvider('test-key', 'test-model');
    expect(provider).toBeInstanceOf(BaseLLMProvider);
  });

  it('should use default options when not provided', () => {
    provider = new TestProvider('test-key', 'test-model');
    const options = provider['mergeOptions']();
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(4000);
    expect(options.stopSequences).toEqual([]);
  });

  it('should use custom default options', () => {
    provider = new TestProvider('test-key', 'test-model', {
      temperature: 0.5,
      maxTokens: 2000,
      stopSequences: ['stop'],
    });
    const options = provider['mergeOptions']();
    expect(options.temperature).toBe(0.5);
    expect(options.maxTokens).toBe(2000);
    expect(options.stopSequences).toEqual(['stop']);
  });

  it('should merge options with defaults', () => {
    provider = new TestProvider('test-key', 'test-model', {
      temperature: 0.3,
    });
    const options = provider['mergeOptions']({ maxTokens: 1000 });
    expect(options.temperature).toBe(0.3);
    expect(options.maxTokens).toBe(1000);
  });

  it('should throw error if apiKey is empty', () => {
    expect(() => {
      provider = new TestProvider('', 'test-model');
      provider['validateApiKey']();
    }).toThrow('LLM API key is required');
  });

  it('should throw error if apiKey is whitespace only', () => {
    expect(() => {
      provider = new TestProvider('   ', 'test-model');
      provider['validateApiKey']();
    }).toThrow('LLM API key is required');
  });

  it('should not throw if apiKey is valid', () => {
    provider = new TestProvider('valid-key', 'test-model');
    expect(() => provider['validateApiKey']()).not.toThrow();
  });
});

