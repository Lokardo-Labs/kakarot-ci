import { describe, it, expect } from 'vitest';
import { buildCoverageSummaryPrompt } from './coverage-summary.js';

describe('coverage-summary prompt', () => {
  const mockCoverageReport = {
    total: {
      lines: { total: 100, covered: 80, percentage: 80 },
      branches: { total: 50, covered: 40, percentage: 80 },
      functions: { total: 30, covered: 25, percentage: 83.33 },
      statements: { total: 100, covered: 80, percentage: 80 },
    },
    files: [],
  };

  const mockTestResults = [
    {
      success: true,
      testFile: 'test1.test.ts',
      passed: 5,
      failed: 0,
      total: 5,
      duration: 100,
      failures: [],
    },
  ];

  it('should build prompt with coverage metrics', () => {
    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      mockTestResults,
      ['add', 'subtract']
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('80.0%');
    expect(messages[1].content).toContain('80/100');
  });

  it('should include test results', () => {
    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      mockTestResults,
      []
    );

    expect(messages[1].content).toContain('Total tests: 5');
    expect(messages[1].content).toContain('Passed: 5');
    expect(messages[1].content).toContain('Failed: 0');
  });

  it('should include functions tested', () => {
    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      mockTestResults,
      ['add', 'subtract', 'multiply']
    );

    expect(messages[1].content).toContain('Functions Tested');
    expect(messages[1].content).toContain('- add');
    expect(messages[1].content).toContain('- subtract');
    expect(messages[1].content).toContain('- multiply');
  });

  it('should include coverage delta when provided', () => {
    const delta = {
      lines: 5.5,
      branches: -2.0,
      functions: 10.0,
      statements: 5.5,
    };

    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      mockTestResults,
      [],
      delta
    );

    expect(messages[1].content).toContain('Coverage Changes');
    expect(messages[1].content).toContain('+5.5%');
    expect(messages[1].content).toContain('-2.0%');
  });

  it('should handle multiple test results', () => {
    const multipleResults = [
      { ...mockTestResults[0], passed: 3, total: 3 },
      { ...mockTestResults[0], passed: 2, total: 2 },
    ];

    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      multipleResults,
      []
    );

    expect(messages[1].content).toContain('Total tests: 5');
  });

  it('should handle failed tests', () => {
    const failedResults = [
      {
        success: false,
        testFile: 'test1.test.ts',
        passed: 3,
        failed: 2,
        total: 5,
        duration: 100,
        failures: [],
      },
    ];

    const messages = buildCoverageSummaryPrompt(
      mockCoverageReport,
      failedResults,
      []
    );

    expect(messages[1].content).toContain('Passed: 3');
    expect(messages[1].content).toContain('Failed: 2');
  });
});

