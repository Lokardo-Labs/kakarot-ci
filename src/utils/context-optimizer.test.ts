import { describe, it, expect } from 'vitest';
import { extractKeyErrorMessage, extractRelevantCode, extractFailingTests, optimizeFixContext } from './context-optimizer.js';

describe('extractKeyErrorMessage', () => {
  it('strips stack traces', () => {
    const msg = `Error: test failed\n    at Object.test (/src/foo.ts:10:5)\n    at node_modules/vitest/runner.js:50:3`;
    const result = extractKeyErrorMessage(msg);
    expect(result).toContain('Error: test failed');
    expect(result).not.toContain('node_modules');
  });

  it('truncates long messages', () => {
    const msg = 'x'.repeat(1000);
    const result = extractKeyErrorMessage(msg, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('returns original if shorter than max', () => {
    const msg = 'simple error';
    expect(extractKeyErrorMessage(msg)).toBe('simple error');
  });

  it('returns substring if all lines are stack traces', () => {
    const msg = '    at Object.run (/src/test.ts:5:10)\n    at node_modules/runner.js:3:1';
    const result = extractKeyErrorMessage(msg, 50);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('extractRelevantCode', () => {
  it('returns full code if under max length', () => {
    const code = 'const x = 1;';
    expect(extractRelevantCode(code, [], 1000)).toBe(code);
  });

  it('extracts named functions from long code', () => {
    const padding = '// filler\n'.repeat(300);
    const code = padding + 'export function targetFunc() {\n  return 42;\n}\n' + padding;
    const result = extractRelevantCode(code, ['targetFunc'], 200);
    expect(result).toContain('targetFunc');
  });

  it('truncates from beginning when no function names match', () => {
    const code = 'a'.repeat(200);
    const result = extractRelevantCode(code, ['nonexistent'], 100);
    expect(result).toContain('truncated');
  });
});

describe('extractFailingTests', () => {
  it('returns full code if under max length', () => {
    const code = `it('should work', () => { expect(1).toBe(1); });`;
    expect(extractFailingTests(code, ['should work'], 1000)).toBe(code);
  });

  it('truncates long test files when no matches found', () => {
    const code = 'x'.repeat(3000);
    const result = extractFailingTests(code, ['nonexistent'], 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain('truncated');
  });
});

describe('optimizeFixContext', () => {
  it('passes through short context unchanged', () => {
    const ctx = {
      originalCode: 'const x = 1;',
      testCode: 'it("test", () => {});',
      errorMessage: 'fail',
    };
    const result = optimizeFixContext(ctx);
    expect(result.originalCode).toBe(ctx.originalCode);
    expect(result.testCode).toBe(ctx.testCode);
    expect(result.errorMessage).toBe('fail');
  });

  it('always preserves full test code (never truncates tests)', () => {
    const longTestCode = 'test'.repeat(5000);
    const result = optimizeFixContext({
      originalCode: 'x',
      testCode: longTestCode,
      errorMessage: 'err',
    }, 100);
    expect(result.testCode).toBe(longTestCode);
  });

  it('strips stack traces from failing test messages', () => {
    const result = optimizeFixContext({
      originalCode: 'x',
      testCode: 'y',
      errorMessage: 'err',
      failingTests: [{ testName: 'test1', message: 'fail', stack: 'at foo.ts:1:1' }],
    });
    expect(result.failingTests![0].stack).toBeUndefined();
    expect(result.failingTests![0].testName).toBe('test1');
  });

  it('includes optimized testOutput when different from errorMessage', () => {
    const result = optimizeFixContext({
      originalCode: 'x',
      testCode: 'y',
      errorMessage: 'error A',
      testOutput: 'different output B',
    });
    expect(result.testOutput).toBeDefined();
  });

  it('excludes testOutput when same as errorMessage', () => {
    const result = optimizeFixContext({
      originalCode: 'x',
      testCode: 'y',
      errorMessage: 'same',
      testOutput: 'same',
    });
    expect(result.testOutput).toBeUndefined();
  });
});
