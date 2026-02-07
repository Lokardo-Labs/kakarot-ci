import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
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

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider('test-key', 'claude-3-5-sonnet-20241022');
  });

  it('should generate response successfully', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'test response' }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
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

  it('should separate system message', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'test' }],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ];
    await provider.generate(messages);

    const call = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(call?.body as string);
    expect(body.system).toBe('system prompt');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('Anthropic API error');
  });

  it('should handle empty content', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('no content');
  });
});

