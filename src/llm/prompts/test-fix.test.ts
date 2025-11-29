import { describe, it, expect } from 'vitest';
import { buildTestFixPrompt } from './test-fix.js';

describe('test-fix prompt', () => {
  it('should build prompt for Jest', () => {
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => { expect(1).toBe(2); });",
      errorMessage: 'Expected 1 to be 2',
      testOutput: 'Error: Expected 1 to be 2',
      originalCode: 'export function add(a: number, b: number) { return a + b; }',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[0].content).toContain('Jest');
    expect(messages[0].content).toContain('fix attempt 1 of 3');
  });

  it('should build prompt for Vitest', () => {
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => { expect(1).toBe(2); });",
      errorMessage: 'Expected 1 to be 2',
      testOutput: undefined,
      originalCode: 'export function add(a: number, b: number) { return a + b; }',
      framework: 'vitest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages[0].content).toContain('Vitest');
  });

  it('should include original code', () => {
    const originalCode = 'export function add(a: number, b: number) { return a + b; }';
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => {});",
      errorMessage: 'Error',
      testOutput: undefined,
      originalCode,
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages[1].content).toContain('Original function code');
    expect(messages[1].content).toContain(originalCode);
  });

  it('should include test code', () => {
    const testCode = "it('fails', () => { expect(1).toBe(2); });";
    const messages = buildTestFixPrompt({
      testCode,
      errorMessage: 'Error',
      testOutput: undefined,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages[1].content).toContain('Failing test code');
    expect(messages[1].content).toContain(testCode);
  });

  it('should include error message', () => {
    const errorMessage = 'Expected 1 to be 2';
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => {});",
      errorMessage,
      testOutput: undefined,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages[1].content).toContain('Error message');
    expect(messages[1].content).toContain(errorMessage);
  });

  it('should include test output when provided', () => {
    const testOutput = 'Detailed stack trace';
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => {});",
      errorMessage: 'Error',
      testOutput,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(messages[1].content).toContain('Test output');
    expect(messages[1].content).toContain(testOutput);
  });

  it('should note previous attempts when attempt > 1', () => {
    const messages = buildTestFixPrompt({
      testCode: "it('fails', () => {});",
      errorMessage: 'Error',
      testOutput: undefined,
      originalCode: 'export function add() {}',
      framework: 'jest',
      attempt: 2,
      maxAttempts: 3,
    });

    expect(messages[1].content).toContain('fix attempt 2');
    expect(messages[1].content).toContain('Previous attempts failed');
  });
});

