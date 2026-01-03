import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestGenerator } from './test-generator.js';
import { createLLMProvider } from './factory.js';

vi.mock('./factory.js');
vi.mock('./parser.js');
vi.mock('./prompts/test-generation.js', () => ({
  buildTestGenerationPrompt: vi.fn(() => [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
  ]),
}));
vi.mock('./prompts/test-fix.js', () => ({
  buildTestFixPrompt: vi.fn(() => [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
  ]),
}));
vi.mock('./prompts/test-scaffold.js', () => ({
  buildTestScaffoldPrompt: vi.fn().mockResolvedValue([
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
  ]),
}));
vi.mock('./parser.js', () => ({
  parseTestCode: vi.fn((code) => code),
  validateTestCodeStructure: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

describe('TestGenerator', () => {
  let generator: TestGenerator;
  let mockProvider: { generate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      generate: vi.fn().mockResolvedValue({
        content: 'test code',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    };
    vi.mocked(createLLMProvider).mockReturnValue(mockProvider as never);
  });

  it('should generate test code', async () => {
    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
    });

    const target = {
      filePath: 'src/utils.ts',
      functionName: 'add',
      functionType: 'function' as const,
      code: 'export function add() {}',
      context: '',
      startLine: 1,
      endLine: 1,
      changedRanges: [],
    };

    const result = await generator.generateTest({
      target,
      framework: 'jest',
    });

    expect(result.testCode).toBe('test code');
    expect(mockProvider.generate).toHaveBeenCalled();
  });

  it('should fix test code', async () => {
    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
    });

    const result = await generator.fixTest({
      testCode: 'failing test',
      errorMessage: 'Error',
      testOutput: undefined,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(result.testCode).toBe('test code');
    expect(mockProvider.generate).toHaveBeenCalled();
  });

  it('should use fixTemperature for fix attempts', async () => {
    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
      fixTemperature: 0.05,
    });

    await generator.fixTest({
      testCode: 'failing test',
      errorMessage: 'Error',
      testOutput: undefined,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    const call = mockProvider.generate.mock.calls[0][1];
    expect(call?.temperature).toBe(0.05);
  });

  it('should generate coverage summary', async () => {
    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
    });

    const messages = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: 'user' },
    ];

    const result = await generator.generateCoverageSummary(messages);

    expect(result).toBe('test code');
    expect(mockProvider.generate).toHaveBeenCalledWith(messages, {
      temperature: 0.3,
      maxTokens: 500,
    });
  });

  it('should generate test scaffold', async () => {
    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
    });

    const target = {
      filePath: 'src/utils.ts',
      functionName: 'add',
      functionType: 'function' as const,
      code: 'export function add() {}',
      context: '',
      startLine: 1,
      endLine: 1,
      changedRanges: [],
    };

    const result = await generator.generateTestScaffold(target, undefined, 'jest');

    expect(result.testCode).toBe('test code');
    expect(mockProvider.generate).toHaveBeenCalled();
  });

  it('should handle generation errors', async () => {
    mockProvider.generate.mockRejectedValue(new Error('API error'));

    generator = new TestGenerator({
      apiKey: 'test-key',
      provider: 'openai',
      maxFixAttempts: 3,
    });

    const target = {
      filePath: 'src/utils.ts',
      functionName: 'add',
      functionType: 'function' as const,
      code: 'export function add() {}',
      context: '',
      startLine: 1,
      endLine: 1,
      changedRanges: [],
    };

    await expect(
      generator.generateTest({
        target,
        framework: 'jest',
      })
    ).rejects.toThrow('API error');
  });
});

