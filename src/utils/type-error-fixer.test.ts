import { describe, it, expect } from 'vitest';
import { fixTypeErrors, fixArrayUnionTypeError, fixDeepMergeTypeError, fixFunctionParameterTypeError } from './type-error-fixer.js';

describe('fixTypeErrors', () => {
  it('fixes array union type assignment errors', () => {
    const code = `const items = [1, null, 3];`;
    const errors = ["Type '(number | null)[]' is not assignable to parameter of type 'number[]'"];
    const result = fixTypeErrors(code, errors);
    expect(result.fixedCode).toContain('null');
    expect(result.fixedErrors).toHaveLength(1);
  });

  it('fixes deepMerge type errors', () => {
    const code = `const result = deepMerge(defaults, { extra: true });`;
    const errors = ['has no properties in common with type'];
    const result = fixTypeErrors(code, errors);
    expect(result.fixedCode).toContain('as unknown as Partial');
    expect(result.fixedErrors).toHaveLength(1);
  });

  it('returns remaining errors when no fix applies', () => {
    const code = `const x = 1;`;
    const errors = ['some unknown error pattern'];
    const result = fixTypeErrors(code, errors);
    expect(result.remainingErrors).toEqual(['some unknown error pattern']);
    expect(result.fixedErrors).toHaveLength(0);
    expect(result.fixedCode).toBe(code);
  });

  it('handles empty errors array', () => {
    const code = `const x = 1;`;
    const result = fixTypeErrors(code, []);
    expect(result.fixedCode).toBe(code);
    expect(result.fixedErrors).toHaveLength(0);
    expect(result.remainingErrors).toHaveLength(0);
  });
});

describe('fixArrayUnionTypeError', () => {
  it('adds type annotation to array declaration', () => {
    const code = `const items = [1, 2, 3];`;
    const result = fixArrayUnionTypeError(code, 'items', ['number', 'null']);
    expect(result).toBe(`const items: (number | null)[] = [1, 2, 3];`);
  });

  it('handles multiple types', () => {
    const result = fixArrayUnionTypeError(`const vals = []`, 'vals', ['string', 'number', 'undefined']);
    expect(result).toContain('(string | number | undefined)[]');
  });
});

describe('fixDeepMergeTypeError', () => {
  it('adds type assertion to deepMerge calls', () => {
    const code = `const result = deepMerge(base, { key: 1 });`;
    const result = fixDeepMergeTypeError(code);
    expect(result).toContain('as unknown as Partial<typeof base>');
  });

  it('skips calls that already have type assertions', () => {
    const code = `const result = deepMerge(base, obj as Partial<typeof base>);`;
    const result = fixDeepMergeTypeError(code);
    expect(result).toBe(code);
  });
});

describe('fixFunctionParameterTypeError', () => {
  it('returns original code (not yet implemented)', () => {
    const code = `function test(x: number) { return x; }`;
    const result = fixFunctionParameterTypeError(code, 'test', 'x', 'string', 'number');
    expect(result).toBe(code);
  });
});
