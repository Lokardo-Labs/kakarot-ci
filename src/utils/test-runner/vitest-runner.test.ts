import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VitestRunner } from './vitest-runner.js';
import { exec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
}));

describe('VitestRunner', () => {
  let runner: VitestRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new VitestRunner();
  });

  it('should run tests successfully', async () => {
    const mockStdout = 'some output\n' + JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTests: 3,
      numFailedTests: 0,
      numTotalTests: 3,
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
    });

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        callback(null, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'vitest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].passed).toBe(3);
    expect(results[0].failed).toBe(0);
  });

  it('should parse JSON from output with surrounding noise', async () => {
    const jsonOutput = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numTotalTests: 1,
      testResults: [],
    });
    const mockStdout = 'line 1\nline 2\n' + jsonOutput + '\n[vitest-pool]: some warning';

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        callback(null, { stdout: mockStdout, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'vitest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results).toHaveLength(1);
  });

  it('should handle test failures with per-file counts', async () => {
    const jsonOutput = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTests: 3,
      numFailedTests: 2,
      numTotalTests: 5,
      testResults: [
        {
          name: '/project/test1.test.ts',
          status: 'failed',
          assertionResults: [
            { title: 'passing test 1', status: 'passed', failureMessages: [] },
            { title: 'passing test 2', status: 'passed', failureMessages: [] },
            { title: 'failing test 1', status: 'failed', failureMessages: ['Error: test failed'] },
            { title: 'failing test 2', status: 'failed', failureMessages: ['Error: another failure'] },
          ],
        },
      ],
    });

    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        const error = new Error('Command failed') as Error & { stdout: string; stderr: string };
        error.stdout = jsonOutput;
        error.stderr = '';
        callback(error, { stdout: jsonOutput, stderr: '' } as never, '');
      }
      return {} as never;
    });

    const results = await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'vitest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: false,
    });

    expect(results[0].success).toBe(false);
    expect(results[0].passed).toBe(2);
    expect(results[0].failed).toBe(2);
    expect(results[0].failures).toHaveLength(2);
  });

  it('should include coverage flag when requested', async () => {
    const jsonOutput = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numTotalTests: 1,
      testResults: [],
    });

    vi.mocked(exec).mockImplementation((command, _options, callback?) => {
      expect(command).toContain('--coverage');
      if (callback) {
        callback(null, { stdout: jsonOutput, stderr: '' } as never, '');
      }
      return {} as never;
    });

    await runner.runTests({
      testFiles: ['test1.test.ts'],
      framework: 'vitest',
      packageManager: 'npm',
      projectRoot: '/project',
      coverage: true,
    });
  });

  it('should throw error if no valid JSON in output', async () => {
    vi.mocked(exec).mockImplementation((_command, _options, callback?) => {
      if (callback) {
        callback(null, { stdout: 'no json here', stderr: '' } as never, '');
      }
      return {} as never;
    });

    await expect(
      runner.runTests({
        testFiles: ['test1.test.ts'],
        framework: 'vitest',
        packageManager: 'npm',
        projectRoot: '/project',
        coverage: false,
      })
    ).rejects.toThrow('No valid JSON output from Vitest');
  });
});

