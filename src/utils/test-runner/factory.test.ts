import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRunner } from './factory.js';
import { JestRunner } from './jest-runner.js';
import { VitestRunner } from './vitest-runner.js';

vi.mock('./jest-runner.js');
vi.mock('./vitest-runner.js');

describe('test runner factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create Jest runner', () => {
    const mockRunner = {} as never;
    vi.mocked(JestRunner).mockImplementation(() => mockRunner);

    const runner = createTestRunner('jest');

    expect(JestRunner).toHaveBeenCalled();
    expect(runner).toBe(mockRunner);
  });

  it('should create Vitest runner', () => {
    const mockRunner = {} as never;
    vi.mocked(VitestRunner).mockImplementation(() => mockRunner);

    const runner = createTestRunner('vitest');

    expect(VitestRunner).toHaveBeenCalled();
    expect(runner).toBe(mockRunner);
  });

  it('should throw error for unsupported framework', () => {
    expect(() => {
      createTestRunner('mocha' as 'jest');
    }).toThrow('Unsupported test framework: mocha');
  });
});

