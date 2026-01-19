import { describe, it, expect } from 'vitest';
import { getTestFilePath } from './test-file-path.js';
import type { TestTarget } from '../types/diff.js';

describe('getTestFilePath', () => {
  const baseTarget: TestTarget = {
    filePath: 'src/utils/helper.ts',
    functionName: 'helper',
    functionType: 'function',
    startLine: 1,
    endLine: 3,
    code: 'export function helper() {}',
    context: '',
    changedRanges: [{ start: 1, end: 3, type: 'addition' }],
  };

  it('should generate co-located test path', () => {
    const config = {
      testLocation: 'co-located' as const,
      testDirectory: '__tests__' as const,
      testFilePattern: '*.test.ts' as const,
    };

    const result = getTestFilePath(baseTarget, config);

    expect(result).toBe('src/utils/helper.test.ts');
  });

  it('should generate separate test path', () => {
    const config = {
      testLocation: 'separate' as const,
      testDirectory: '__tests__' as const,
      testFilePattern: '*.test.ts' as const,
    };

    const result = getTestFilePath(baseTarget, config);

    expect(result).toBe('__tests__/helper.test.ts');
  });

  it('should handle TypeScript files', () => {
    const target: TestTarget = {
      ...baseTarget,
      filePath: 'src/components/Button.tsx',
    };

    const config = {
      testLocation: 'co-located' as const,
      testDirectory: '__tests__' as const,
      testFilePattern: '*.test.ts' as const,
    };

    const result = getTestFilePath(target, config);

    expect(result).toBe('src/components/Button.test.ts');
  });

  it('should handle JavaScript files', () => {
    const target: TestTarget = {
      ...baseTarget,
      filePath: 'src/utils/helper.js',
    };

    const config = {
      testLocation: 'co-located' as const,
      testDirectory: '__tests__' as const,
      testFilePattern: '*.test.ts' as const,
    };

    const result = getTestFilePath(target, config);

    expect(result).toBe('src/utils/helper.test.js');
  });

  it('should use custom test file pattern', () => {
    const config = {
      testLocation: 'separate' as const,
      testDirectory: 'tests' as const,
      testFilePattern: '*.spec.ts' as const,
    };

    const result = getTestFilePath(baseTarget, config);

    expect(result).toBe('tests/helper.spec.ts');
  });

  it('should handle files in root directory', () => {
    const target: TestTarget = {
      ...baseTarget,
      filePath: 'index.ts',
    };

    const config = {
      testLocation: 'co-located' as const,
      testDirectory: '__tests__' as const,
      testFilePattern: '*.test.ts' as const,
    };

    const result = getTestFilePath(target, config);

    expect(result).toBe('index.test.ts');
  });
});

