import { describe, it, expect } from 'vitest';
import { parseTestCode, validateTestCodeStructure } from './parser.js';

describe('parseTestCode', () => {
  it('should extract code from markdown code block', () => {
    const response = '```typescript\ndescribe("test", () => {});\n```';
    const result = parseTestCode(response);
    expect(result).toBe('describe("test", () => {});');
  });

  it('should handle code block without language tag', () => {
    const response = '```\ndescribe("test", () => {});\n```';
    const result = parseTestCode(response);
    expect(result).toBe('describe("test", () => {});');
  });

  it('should handle plain code without markdown', () => {
    const response = 'describe("test", () => {});';
    const result = parseTestCode(response);
    expect(result).toBe('describe("test", () => {});');
  });

  it('should extract from inline code blocks', () => {
    const response = 'Here is the code: ```typescript\ndescribe("test", () => {});\n```';
    const result = parseTestCode(response);
    // The parser extracts the code block content including language tag, then trims
    expect(result).toContain('describe("test", () => {});');
    expect(result).not.toContain('```');
  });

  it('should remove leading explanation text', () => {
    const response = 'Here\'s the test code:\n```typescript\ndescribe("test", () => {});\n```';
    const result = parseTestCode(response);
    // The parser should extract the code block
    expect(result).toContain('describe("test", () => {});');
    expect(result).not.toContain('Here\'s');
  });

  it('should handle multiple code blocks and use the largest', () => {
    const response = '```\nshort\n```\n\n```typescript\ndescribe("test", () => {\n  it("works", () => {});\n});\n```';
    const result = parseTestCode(response);
    expect(result).toContain('describe("test"');
  });

  it('should return original if parsing fails', () => {
    const response = '';
    const result = parseTestCode(response);
    expect(result).toBe('');
  });

  it('should handle JavaScript code blocks', () => {
    const response = '```javascript\ndescribe("test", () => {});\n```';
    const result = parseTestCode(response);
    expect(result).toBe('describe("test", () => {});');
  });

  it('should trim whitespace', () => {
    const response = '```typescript\n  describe("test", () => {});  \n```';
    const result = parseTestCode(response);
    expect(result).toBe('describe("test", () => {});');
  });
});

describe('validateTestCodeStructure', () => {
  it('should validate Jest test code', () => {
    const code = `describe('MyTest', () => {
      it('should work', () => {
        expect(true).toBe(true);
      });
    });`;

    const result = validateTestCodeStructure(code, 'jest');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate Vitest test code', () => {
    const code = `import { describe, it, expect } from 'vitest';

    describe('MyTest', () => {
      it('should work', () => {
        expect(true).toBe(true);
      });
    });`;

    const result = validateTestCodeStructure(code, 'vitest');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject code without test structure', () => {
    const code = 'const x = 1;';
    const result = validateTestCodeStructure(code, 'jest');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject Vitest code without import', () => {
    const code = `describe('test', () => {
      it('works', () => {});
    });`;
    const result = validateTestCodeStructure(code, 'vitest');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Vitest import'))).toBe(true);
  });

  it('should reject code that is too short', () => {
    const code = 'describe';
    const result = validateTestCodeStructure(code, 'jest');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('too short'))).toBe(true);
  });

  it('should accept Jest code with global functions', () => {
    const code = `describe('test', () => {
      it('works', () => {
        expect(true).toBe(true);
      });
    });`;
    const result = validateTestCodeStructure(code, 'jest');
    expect(result.valid).toBe(true);
  });

  it('should require test function calls', () => {
    const code = 'const x = "test";';
    const result = validateTestCodeStructure(code, 'jest');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('test function calls'))).toBe(true);
  });
});

