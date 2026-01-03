import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTestsFromTargets } from './test-generation-core.js';
import { TestGenerator } from '../llm/test-generator.js';
import { getTestFilePath } from '../utils/test-file-path.js';
import { detectPackageManager } from '../utils/package-manager-detector.js';
import { createTestRunner } from '../utils/test-runner/factory.js';
import { writeTestFiles } from '../utils/test-file-writer.js';
import { readCoverageReport } from '../utils/coverage-reader.js';
import { formatGeneratedCode, lintGeneratedCode } from '../utils/code-standards.js';
import { findProjectRoot } from '../utils/config-loader.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

vi.mock('../llm/test-generator.js');
vi.mock('../utils/test-file-path.js');
vi.mock('../utils/package-manager-detector.js');
vi.mock('../utils/test-runner/factory.js');
vi.mock('../utils/test-file-writer.js');
vi.mock('../utils/coverage-reader.js');
vi.mock('../utils/code-standards.js');
vi.mock('../utils/config-loader.js');
vi.mock('fs');
vi.mock('path');
vi.mock('../utils/logger.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  progress: vi.fn(),
}));

describe('test-generation-core', () => {
  const mockTarget = {
    filePath: 'src/utils.ts',
    functionName: 'add',
    functionType: 'function' as const,
    code: 'export function add(a: number, b: number) { return a + b; }',
    context: '',
    startLine: 1,
    endLine: 3,
    changedRanges: [{ start: 1, end: 3, type: 'addition' as const }],
    existingTestFile: undefined,
  };

  const mockConfig = {
    apiKey: 'test-key',
    framework: 'jest' as const,
    maxTestsPerPR: 50,
    maxFixAttempts: 3,
    testDirectory: '__tests__',
    testFilePattern: '*.test.ts',
    includePatterns: ['**/*.ts'],
    excludePatterns: ['**/*.test.ts'],
    codeStyle: {
      formatGeneratedCode: false,
      lintGeneratedCode: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findProjectRoot).mockResolvedValue('/project');
    vi.mocked(detectPackageManager).mockReturnValue('npm');
    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(join).mockImplementation((...args) => args.join('/'));
    vi.mocked(TestGenerator).mockImplementation(() => ({
      generateTest: vi.fn().mockResolvedValue({
        testCode: "describe('add', () => { it('works', () => {}); });",
        usage: {},
      }),
      generateTestScaffold: vi.fn().mockResolvedValue({
        testCode: "describe('add', () => { it('works', () => { // TODO }); });",
        usage: {},
      }),
    }) as never);
    vi.mocked(writeTestFiles).mockReturnValue(['__tests__/utils.test.ts']);
    vi.mocked(createTestRunner).mockReturnValue({
      runTests: vi.fn().mockResolvedValue([{
        testFile: '__tests__/utils.test.ts',
        success: true,
        total: 1,
        passed: 1,
        failed: 0,
        failures: [],
      }]),
    } as never);
  });

  it('should return empty result when no targets', async () => {
    const result = await generateTestsFromTargets({
      targets: [],
      config: mockConfig as never,
      mode: 'pr',
    });

    expect(result.targetsProcessed).toBe(0);
    expect(result.testsGenerated).toBe(0);
    expect(result.testFiles).toEqual([]);
  });

  it('should generate tests for targets', async () => {
    const result = await generateTestsFromTargets({
      targets: [mockTarget],
      config: mockConfig as never,
      mode: 'pr',
    });

    expect(result.targetsProcessed).toBe(1);
    expect(result.testsGenerated).toBe(1);
    expect(result.testFiles).toHaveLength(1);
  });

  it('should limit targets based on maxTestsPerPR', async () => {
    const targets = Array.from({ length: 100 }, () => mockTarget);

    const result = await generateTestsFromTargets({
      targets,
      config: mockConfig as never,
      mode: 'pr',
    });

    expect(result.targetsProcessed).toBe(50);
  });

  it('should generate scaffold in scaffold mode', async () => {
    const mockGenerator = {
      generateTestScaffold: vi.fn().mockResolvedValue({
        testCode: 'scaffold code',
        usage: {},
      }),
    };
    vi.mocked(TestGenerator).mockImplementation(() => mockGenerator as never);

    await generateTestsFromTargets({
      targets: [mockTarget],
      config: mockConfig as never,
      mode: 'scaffold',
    });

    expect(mockGenerator.generateTestScaffold).toHaveBeenCalled();
  });

  it('should apply code formatting when enabled', async () => {
    const configWithFormatting = {
      ...mockConfig,
      codeStyle: {
        formatGeneratedCode: true,
        lintGeneratedCode: false,
      },
    };
    vi.mocked(formatGeneratedCode).mockResolvedValue('formatted code');

    await generateTestsFromTargets({
      targets: [mockTarget],
      config: configWithFormatting as never,
      mode: 'pr',
    });

    expect(formatGeneratedCode).toHaveBeenCalled();
  });

  it('should not run tests in scaffold mode', async () => {
    const mockRunner = {
      runTests: vi.fn(),
    };
    vi.mocked(createTestRunner).mockReturnValue(mockRunner as never);

    await generateTestsFromTargets({
      targets: [mockTarget],
      config: mockConfig as never,
      mode: 'scaffold',
    });

    expect(mockRunner.runTests).not.toHaveBeenCalled();
  });

  it('should run tests in full mode', async () => {
    const mockRunner = {
      runTests: vi.fn().mockResolvedValue([{
        testFile: '__tests__/utils.test.ts',
        success: true,
        total: 1,
        passed: 1,
        failed: 0,
        failures: [],
      }]),
    };
    vi.mocked(createTestRunner).mockReturnValue(mockRunner as never);

    await generateTestsFromTargets({
      targets: [mockTarget],
      config: mockConfig as never,
      mode: 'full',
    });

    expect(mockRunner.runTests).toHaveBeenCalled();
  });

  it('should calculate coverage delta when enabled', async () => {
    const configWithCoverage = {
      ...mockConfig,
      enableCoverage: true,
    };
    const baselineCoverage = {
      total: {
        lines: { total: 100, covered: 50, percentage: 50 },
        branches: { total: 50, covered: 25, percentage: 50 },
        functions: { total: 20, covered: 10, percentage: 50 },
        statements: { total: 100, covered: 50, percentage: 50 },
      },
      files: [],
    };
    const currentCoverage = {
      total: {
        lines: { total: 100, covered: 60, percentage: 60 },
        branches: { total: 50, covered: 30, percentage: 60 },
        functions: { total: 20, covered: 12, percentage: 60 },
        statements: { total: 100, covered: 60, percentage: 60 },
      },
      files: [],
    };
    vi.mocked(readCoverageReport)
      .mockReturnValueOnce(baselineCoverage)
      .mockReturnValueOnce(currentCoverage);

    const result = await generateTestsFromTargets({
      targets: [mockTarget],
      config: configWithCoverage as never,
      mode: 'full',
    });

    expect(result.coverageDelta).toBeDefined();
    expect(result.coverageDelta?.lines).toBe(10);
  });
});

