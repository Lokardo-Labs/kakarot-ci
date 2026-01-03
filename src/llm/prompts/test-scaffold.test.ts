import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestScaffoldPrompt } from './test-scaffold.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

vi.mock('fs');
vi.mock('path');
vi.mock('../../utils/config-loader.js', () => ({
  findProjectRoot: vi.fn().mockResolvedValue('/project'),
}));

describe('test-scaffold prompt', () => {
  const baseTarget = {
    filePath: 'src/utils.ts',
    functionName: 'add',
    functionType: 'function' as const,
    code: 'export function add(a: number, b: number) { return a + b; }',
    context: '',
    startLine: 1,
    endLine: 1,
    changedRanges: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('should build prompt for Jest', async () => {
    const messages = await buildTestScaffoldPrompt(baseTarget, 'jest');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[0].content).toContain('Jest');
    expect(messages[0].content).toContain('test scaffolding assistant');
  });

  it('should build prompt for Vitest', async () => {
    const messages = await buildTestScaffoldPrompt(baseTarget, 'vitest');

    expect(messages[0].content).toContain('Vitest');
    expect(messages[0].content).toContain('test scaffolding assistant');
  });

  it('should include function code in user prompt', async () => {
    const messages = await buildTestScaffoldPrompt(baseTarget, 'jest');

    expect(messages[1].content).toContain('add');
    expect(messages[1].content).toContain('export function add');
  });

  it('should include context when provided', async () => {
    const targetWithContext = {
      ...baseTarget,
      context: 'import { something } from "./other";',
    };

    const messages = await buildTestScaffoldPrompt(targetWithContext, 'jest');

    expect(messages[1].content).toContain('Context (surrounding code)');
    expect(messages[1].content).toContain('import { something }');
  });

  it('should include existing test file when provided', async () => {
    const existingTest = "describe('add', () => { it('works', () => {}); });";

    const messages = await buildTestScaffoldPrompt(baseTarget, 'jest', existingTest);

    expect(messages[1].content).toContain('Existing test file structure');
    expect(messages[1].content).toContain(existingTest);
  });

  it('should load custom system prompt from file', async () => {
    const customPrompt = 'Custom system prompt';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(customPrompt);
    vi.mocked(join).mockReturnValue('/project/custom-prompt.txt');

    const messages = await buildTestScaffoldPrompt(
      baseTarget,
      'jest',
      undefined,
      { customSystemPrompt: 'custom-prompt.txt' }
    );

    expect(messages[0].content).toBe(customPrompt);
  });

  it('should use inline prompt if file does not exist', async () => {
    const customPrompt = 'Inline custom prompt';
    vi.mocked(existsSync).mockReturnValue(false);

    const messages = await buildTestScaffoldPrompt(
      baseTarget,
      'jest',
      undefined,
      { customSystemPrompt: customPrompt }
    );

    expect(messages[0].content).toBe(customPrompt);
  });
});

