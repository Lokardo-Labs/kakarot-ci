import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleProvider } from './google.js';
import type { LLMMessage } from '../../types/llm.js';

vi.mock('./base.js', () => ({
  BaseLLMProvider: class {
    protected apiKey: string;
    protected model: string;
    protected validateApiKey = vi.fn();
    protected mergeOptions = vi.fn().mockReturnValue({
      temperature: 0.2,
      maxTokens: 4000,
      stopSequences: [],
    });
    protected logUsage = vi.fn();
    constructor(apiKey: string, model: string) {
      this.apiKey = apiKey;
      this.model = model;
    }
  },
}));

vi.mock('../../utils/logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
}));

global.fetch = vi.fn();

describe('GoogleProvider', () => {
  let provider: GoogleProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleProvider('test-key', 'gemini-1.5-pro');
  });

  it('should generate response successfully', async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: 'test response' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
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

  it('should separate system instruction', async () => {
    const mockResponse = {
      candidates: [{ content: { parts: [{ text: 'test' }] }, finishReason: 'STOP' }],
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

    const callUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(callUrl).toContain('generateContent');
    expect(callUrl).toContain('key=test-key');
    const callOptions = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(callOptions?.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('system prompt');
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
  });

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('Google API error');
  });

  it('should handle empty candidates', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    } as Response);

    const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    await expect(provider.generate(messages)).rejects.toThrow('no candidates');
  });
});

