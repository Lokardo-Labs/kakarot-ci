import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateTestFile, checkSyntaxCompleteness } from './file-validator.js';

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
}));

vi.mock('./logger.js', () => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('checkSyntaxCompleteness', () => {
  it('should validate complete code', () => {
    const code = `describe('test', () => { it('works', () => { expect(1).toBe(1); }); });`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect unclosed braces', () => {
    const code = `describe('test', () => { it('works', () => { expect(1).toBe(1); });`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unclosed braces'))).toBe(true);
  });

  it('should detect extra closing braces', () => {
    const code = `describe('test', () => { it('works', () => { expect(1).toBe(1); }); }); }`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Extra closing braces'))).toBe(true);
  });

  it('should detect unclosed parentheses', () => {
    const code = `describe('test', () => { it('works', () => { expect(1).toBe(1; }); });`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unclosed parentheses'))).toBe(true);
  });

  it('should detect incomplete expression with operator', () => {
    const code = `const result = 1 +`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('incomplete') || e.includes('truncated') || e.includes('operator'))).toBe(true);
  });

  it('should ignore strings when checking braces', () => {
    const code = `const str = "{ }"; expect(str).toBe("{ }");`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(true);
  });

  it('should ignore comments when checking braces', () => {
    const code = `// { comment } /* { block } */ const x = 1;`;
    const result = checkSyntaxCompleteness(code);
    expect(result.valid).toBe(true);
  });
});

describe('validateTestFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate valid test file', async () => {
    const code = `import { describe, it, expect } from 'vitest'; describe('test', () => { it('works', () => { expect(1).toBe(1); }); });`;
    const result = await validateTestFile('__tests__/test.test.ts', code, '/project');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect syntax errors', async () => {
    const code = `describe('test', () => { it('works', () => { expect(1).toBe(1; }); });`;
    const result = await validateTestFile('__tests__/test.test.ts', code, '/project');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Syntax:'))).toBe(true);
  });

  it('should detect private property access', async () => {
    const code = `const processor = new DataProcessor(); processor.cache = new Map(); processor.maxCacheSize = 10;`;
    const result = await validateTestFile('__tests__/test.test.ts', code, '/project', ['cache', 'maxCacheSize']);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Private property access'))).toBe(true);
  });

  it('should not flag valid property access', async () => {
    const code = `const processor = new DataProcessor(); const stats = processor.getCacheStats();`;
    const result = await validateTestFile('__tests__/test.test.ts', code, '/project', ['cache', 'maxCacheSize']);
    expect(result.valid).toBe(true);
  });
});
