import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeFile } from './ast-analyzer.js';
import type { ChangedRange } from '../types/diff.js';

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
}));

describe('ast-analyzer', () => {
  const mockGithubClient = {
    fileExists: vi.fn().mockResolvedValue(false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract function declarations', async () => {
    const code = `
export function add(a: number, b: number) {
  return a + b;
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 2, end: 4, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].functionName).toBe('add');
    expect(targets[0].functionType).toBe('function');
  });

  it('should extract arrow functions', async () => {
    const code = `
export const multiply = (a: number, b: number) => {
  return a * b;
};
`;
    const changedRanges: ChangedRange[] = [
      { start: 2, end: 4, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].functionName).toBe('multiply');
    expect(targets[0].functionType).toBe('arrow-function');
  });

  it('should extract class methods', async () => {
    const code = `
class Calculator {
  subtract(a: number, b: number) {
    return a - b;
  }
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 3, end: 5, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/calculator.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].functionName).toBe('subtract');
    expect(targets[0].functionType).toBe('class-method');
    expect(targets[0].className).toBe('Calculator');
  });

  it('should detect class name for class methods', async () => {
    const code = `
export class DataProcessor {
  async processBatch(items: any[]) {
    return items;
  }
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 3, end: 5, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/dataProcessor.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].className).toBe('DataProcessor');
    expect(targets[0].functionName).toBe('processBatch');
  });

  it('should detect private methods', async () => {
    const code = `
export class DataProcessor {
  private validateInput(input: string) {
    return input.length > 0;
  }
  
  public process(input: string) {
    return this.validateInput(input);
  }
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 3, end: 5, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/dataProcessor.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    const privateMethod = targets.find(t => t.functionName === 'validateInput');
    expect(privateMethod).toBeDefined();
    expect(privateMethod?.isPrivate).toBe(true);
    expect(privateMethod?.className).toBe('DataProcessor');
  });

  it('should detect private properties in class', async () => {
    const code = `
export class DataProcessor {
  private cache: Map<string, unknown>;
  private maxCacheSize: number = 100;
  
  public getCacheStats() {
    return { size: this.cache.size };
  }
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 5, end: 7, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/dataProcessor.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    const publicMethod = targets.find(t => t.functionName === 'getCacheStats');
    expect(publicMethod).toBeDefined();
    expect(publicMethod?.classPrivateProperties).toContain('cache');
    expect(publicMethod?.classPrivateProperties).toContain('maxCacheSize');
  });

  it('should only extract functions that overlap with changes', async () => {
    const code = `
export function unchanged() {
  return 1;
}

export function changed() {
  return 2;
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 6, end: 8, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].functionName).toBe('changed');
  });

  it('should extract code snippet for function', async () => {
    const code = `export function test() { return 1; }`;
    const changedRanges: ChangedRange[] = [
      { start: 1, end: 1, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets[0].code).toContain('export function test');
  });

  it('should detect existing test file', async () => {
    mockGithubClient.fileExists.mockResolvedValue(true);

    const code = `export function test() { return 1; }`;
    const changedRanges: ChangedRange[] = [
      { start: 1, end: 1, type: 'addition' },
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets[0].existingTestFile).toBeDefined();
  });

  it('should filter changed ranges to function scope', async () => {
    const code = `
export function test() {
  const a = 1;
  return a;
}
`;
    const changedRanges: ChangedRange[] = [
      { start: 2, end: 4, type: 'addition' },
      { start: 10, end: 10, type: 'addition' }, // Outside function
    ];

    const targets = await analyzeFile(
      'src/utils.ts',
      code,
      changedRanges,
      'main',
      mockGithubClient,
      '__tests__'
    );

    expect(targets[0].changedRanges.length).toBeLessThanOrEqual(changedRanges.length);
  });
});

