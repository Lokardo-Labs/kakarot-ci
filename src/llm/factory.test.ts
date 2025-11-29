import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLLMProvider } from './factory.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GoogleProvider } from './providers/google.js';

vi.mock('./providers/openai.js');
vi.mock('./providers/anthropic.js');
vi.mock('./providers/google.js');
vi.mock('../utils/logger.js', () => ({
  error: vi.fn(),
}));

describe('LLM factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create OpenAI provider by default', () => {
    const mockProvider = {} as never;
    vi.mocked(OpenAIProvider).mockImplementation(() => mockProvider);

    const provider = createLLMProvider({
      apiKey: 'test-key',
    });

    expect(OpenAIProvider).toHaveBeenCalledWith('test-key', 'gpt-4-turbo-preview', undefined);
    expect(provider).toBe(mockProvider);
  });

  it('should create OpenAI provider when specified', () => {
    const mockProvider = {} as never;
    vi.mocked(OpenAIProvider).mockImplementation(() => mockProvider);

    const provider = createLLMProvider({
      apiKey: 'test-key',
      provider: 'openai',
    });

    expect(OpenAIProvider).toHaveBeenCalledWith('test-key', 'gpt-4-turbo-preview', undefined);
    expect(provider).toBe(mockProvider);
  });

  it('should create Anthropic provider when specified', () => {
    const mockProvider = {} as never;
    vi.mocked(AnthropicProvider).mockImplementation(() => mockProvider);

    const provider = createLLMProvider({
      apiKey: 'test-key',
      provider: 'anthropic',
    });

    expect(AnthropicProvider).toHaveBeenCalledWith('test-key', 'claude-3-5-sonnet-20241022', undefined);
    expect(provider).toBe(mockProvider);
  });

  it('should create Google provider when specified', () => {
    const mockProvider = {} as never;
    vi.mocked(GoogleProvider).mockImplementation(() => mockProvider);

    const provider = createLLMProvider({
      apiKey: 'test-key',
      provider: 'google',
    });

    expect(GoogleProvider).toHaveBeenCalledWith('test-key', 'gemini-1.5-pro', undefined);
    expect(provider).toBe(mockProvider);
  });

  it('should use custom model when provided', () => {
    const mockProvider = {} as never;
    vi.mocked(OpenAIProvider).mockImplementation(() => mockProvider);

    createLLMProvider({
      apiKey: 'test-key',
      provider: 'openai',
      model: 'gpt-4',
    });

    expect(OpenAIProvider).toHaveBeenCalledWith('test-key', 'gpt-4', undefined);
  });

  it('should pass maxTokens when provided', () => {
    const mockProvider = {} as never;
    vi.mocked(OpenAIProvider).mockImplementation(() => mockProvider);

    createLLMProvider({
      apiKey: 'test-key',
      provider: 'openai',
      maxTokens: 2000,
    });

    expect(OpenAIProvider).toHaveBeenCalledWith('test-key', 'gpt-4-turbo-preview', { maxTokens: 2000 });
  });

  it('should throw error for unknown provider', () => {
    expect(() => {
      createLLMProvider({
        apiKey: 'test-key',
        provider: 'unknown' as 'openai',
      });
    }).toThrow('Unknown LLM provider: unknown');
  });
});

