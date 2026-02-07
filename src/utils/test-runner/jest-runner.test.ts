import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JestRunner } from './jest-runner.js';
import { exec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
}));

describe('JestRunner', () => {
  let runner: JestRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new JestRunner();
  });

  it('should run tests successfully with per-file counts', async () => {
    const mockResult = {
      numPassedTests: 5,
      numFailedTests: 0,
      numTotalTests: 5,
      numTotalTestSuites: 1,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'passed',
          assertionResults: [
            { title: 'test 1', status: 'passed', failureMessages: [] },
            { title: 'test 2', status: 'passed', failureMessages: [] },
            { title: 'test 3', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    };
    const mockStdout = JSON.stringify(mockResult);

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        callback(null, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].passed).toBe(3);
    expect(results[0].failed).toBe(0);
    expect(results[0].total).toBe(3);
  });

  it('should handle test failures with per-file counts', async () => {
    const mockResult = {
      numPassedTests: 3,
      numFailedTests: 2,
      numTotalTests: 5,
      numTotalTestSuites: 1,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'failed',
          assertionResults: [
            { title: 'passing test 1', status: 'passed', failureMessages: [] },
            { title: 'passing test 2', status: 'passed', failureMessages: [] },
            { title: 'passing test 3', status: 'passed', failureMessages: [] },
            { title: 'failing test 1', status: 'failed', failureMessages: ['Error: test failed'] },
            { title: 'failing test 2', status: 'failed', failureMessages: ['Error: also failed'] },
          ],
        },
      ],
    };
    const mockStdout = JSON.stringify(mockResult);

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        const error = new Error('Command failed') as Error & { stdout: string; stderr: string };
        error.stdout = mockStdout;
        error.stderr = '';
        callback(error, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results[0].success).toBe(false);
    expect(results[0].passed).toBe(3);
    expect(results[0].failed).toBe(2);
    expect(results[0].total).toBe(5);
    expect(results[0].failures).toHaveLength(2);
    expect(results[0].failures[0].message).toBe('Error: test failed');
    expect(results[0].failures[1].message).toBe('Error: also failed');
  });

  it('should parse JSON when stdout has npm script echo prefix', async () => {
    const mockResult = {
      numPassedTests: 2,
      numFailedTests: 0,
      numTotalTests: 2,
      numTotalTestSuites: 1,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'passed',
          assertionResults: [
            { title: 'test 1', status: 'passed', failureMessages: [] },
            { title: 'test 2', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    };
    // Simulate npm script echo before JSON
    const mockStdout = `\n> test\n> jest --json --no-coverage "test1.test.ts"\n\n${JSON.stringify(mockResult)}`;

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        callback(null, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].passed).toBe(2);
    expect(results[0].failed).toBe(0);
  });

  it('should parse JSON from error path when stdout has npm prefix', async () => {
    const mockResult = {
      numPassedTests: 1,
      numFailedTests: 1,
      numTotalTests: 2,
      numTotalTestSuites: 1,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'failed',
          assertionResults: [
            { title: 'passing', status: 'passed', failureMessages: [] },
            { title: 'failing', status: 'failed', failureMessages: ['Expected true to be false'] },
          ],
        },
      ],
    };
    const mockStdout = `\n> test\n> jest --json --no-coverage "test1.test.ts"\n\n${JSON.stringify(mockResult)}`;

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        const error = new Error('Command failed') as Error & { stdout: string; stderr: string };
        error.stdout = mockStdout;
        error.stderr = '';
        callback(error, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results[0].success).toBe(false);
    expect(results[0].passed).toBe(1);
    expect(results[0].failed).toBe(1);
    expect(results[0].failures).toHaveLength(1);
    expect(results[0].failures[0].testName).toBe('failing');
  });

  it('should include coverage flag when requested', async () => {
    const mockStdout = JSON.stringify({
      numPassedTests: 1,
      numFailedTests: 0,
      numTotalTests: 1,
      numTotalTestSuites: 1,
      testResults: [],
    });

    vi.mocked(exec).mockImplementation((command, _options, callback?) => {
      expect(command).toContain('--coverage');
      if (callback) {
        callback(null, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: true,
    });
  });

  it('should handle multiple test files with per-file counts', async () => {
    const mockResult = {
      numPassedTests: 10,
      numFailedTests: 1,
      numTotalTests: 11,
      numTotalTestSuites: 2,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'passed',
          assertionResults: [
            { title: 'test 1a', status: 'passed', failureMessages: [] },
            { title: 'test 1b', status: 'passed', failureMessages: [] },
          ],
        },
        {
          name: '/project/test2.test.ts',
          status: 'failed',
          assertionResults: [
            { title: 'test 2a', status: 'passed', failureMessages: [] },
            { title: 'test 2b', status: 'failed', failureMessages: ['Error: oops'] },
          ],
        },
      ],
    };
    const mockStdout = JSON.stringify(mockResult);

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        const error = new Error('Command failed') as Error & { stdout: string; stderr: string };
        error.stdout = mockStdout;
        error.stderr = '';
        callback(error, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts', 'test2.test.ts'],
      framework: 'jest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results).toHaveLength(2);
    // File 1: all passing
    expect(results[0].success).toBe(true);
    expect(results[0].passed).toBe(2);
    expect(results[0].failed).toBe(0);
    // File 2: one failure
    expect(results[1].success).toBe(false);
    expect(results[1].passed).toBe(1);
    expect(results[1].failed).toBe(1);
    expect(results[1].failures[0].message).toBe('Error: oops');
  });
});

