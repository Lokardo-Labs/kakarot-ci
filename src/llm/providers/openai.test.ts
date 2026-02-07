import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai.js';
import type { LLMMessage } from '../../types/llm.js';

vi.mock('./base.js', () => ({
  BaseLLMProvider: class {
    protected validateApiKey = vi.fn();
    protected mergeOptions = vi.fn().mockReturnValue({
      temperature: 0.2,
      maxTokens: 4000,
      stopSequences: [],
    });
    protected logUsage = vi.fn();
    protected parse429Error = vi.fn();
    protected async withRetry<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
  },
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

global.fetch = vi.fn();

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('test-key', 'gpt-4');
  });

  it('should generate response successfully', async () => {
    const mockResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'test response' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    const result = await provider.generate(messages);

    expect(result.content).toBe('test response');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('OpenAI API error');
  });

  it('should handle empty choices', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('no choices');
  });

  it('should include stop sequences when provided', async () => {
    const mockResponse = {
      choices: [{ message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    provider['mergeOptions'] = vi.fn().mockReturnValue({
      temperature: 0.2,
      maxTokens: 4000,
      stopSequences: ['stop'],
    });

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await provider.generate(messages);

    const call = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(call?.body as string);
    expect(body.stop).toEqual(['stop']);
  });
});

