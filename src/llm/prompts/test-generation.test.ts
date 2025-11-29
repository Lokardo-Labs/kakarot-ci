import { describe, it, expect } from 'vitest';
import { buildTestGenerationPrompt } from './test-generation.js';

describe('test-generation prompt', () => {
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

  it('should build prompt for Jest', () => {
    const messages = buildTestGenerationPrompt({
      target: baseTarget,
      framework: 'jest',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[0].content).toContain('Jest');
    expect(messages[0].content).toContain("import { describe, it, expect } from 'jest';");
  });

  it('should build prompt for Vitest', () => {
    const messages = buildTestGenerationPrompt({
      target: baseTarget,
      framework: 'vitest',
    });

    expect(messages[0].content).toContain('Vitest');
    expect(messages[0].content).toContain("import { describe, it, expect } from 'vitest';");
  });

  it('should include function code in user prompt', () => {
    const messages = buildTestGenerationPrompt({
      target: baseTarget,
      framework: 'jest',
    });

    expect(messages[1].content).toContain('add');
    expect(messages[1].content).toContain('export function add');
  });

  it('should include context when provided', () => {
    const targetWithContext = {
      ...baseTarget,
      context: 'import { something } from "./other";',
    };

    const messages = buildTestGenerationPrompt({
      target: targetWithContext,
      framework: 'jest',
    });

    expect(messages[1].content).toContain('Context (surrounding code)');
    expect(messages[1].content).toContain('import { something }');
  });

  it('should include related functions when provided', () => {
    const messages = buildTestGenerationPrompt({
      target: baseTarget,
      framework: 'jest',
      relatedFunctions: [
        { name: 'subtract', code: 'export function subtract(a: number, b: number) { return a - b; }' },
      ],
    });

    expect(messages[1].content).toContain('Related functions');
    expect(messages[1].content).toContain('subtract');
  });

  it('should include existing test file when provided', () => {
    const existingTest = "describe('add', () => { it('works', () => {}); });";

    const messages = buildTestGenerationPrompt({
      target: baseTarget,
      framework: 'jest',
      existingTestFile: existingTest,
    });

    expect(messages[1].content).toContain('Existing test file structure');
    expect(messages[1].content).toContain(existingTest);
  });
});

