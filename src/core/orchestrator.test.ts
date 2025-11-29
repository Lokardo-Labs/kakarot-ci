import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPullRequest, type PullRequestContext } from './orchestrator.js';
import { GitHubClient } from '../github/client.js';
import { loadConfig } from '../utils/config-loader.js';
import { extractTestTargets } from '../utils/test-target-extractor.js';
import { TestGenerator } from '../llm/test-generator.js';
import { getTestFilePath } from '../utils/test-file-path.js';
import { detectPackageManager } from '../utils/package-manager-detector.js';
import { createTestRunner } from '../utils/test-runner/factory.js';
import { writeTestFiles } from '../utils/test-file-writer.js';
import { findProjectRoot } from '../utils/config-loader.js';
import { readCoverageReport } from '../utils/coverage-reader.js';

vi.mock('../utils/config-loader.js');
vi.mock('../github/client.js');
vi.mock('../utils/test-target-extractor.js');
vi.mock('../llm/test-generator.js');
vi.mock('../utils/test-file-path.js');
vi.mock('../utils/package-manager-detector.js');
vi.mock('../utils/test-runner/factory.js');
vi.mock('../utils/test-file-writer.js');
vi.mock('../utils/coverage-reader.js');
vi.mock('../utils/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  progress: vi.fn(),
  debug: vi.fn(),
}));

describe('orchestrator', () => {
  let mockGithubClient: GitHubClient;
  let mockTestGenerator: TestGenerator;
  let mockTestRunner: { runTests: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGithubClient = {
      getPullRequest: vi.fn(),
      listPullRequestFiles: vi.fn(),
      fileExists: vi.fn(),
      getFileContents: vi.fn(),
      commitFiles: vi.fn(),
      createBranch: vi.fn(),
      createPullRequest: vi.fn(),
      commentPR: vi.fn(),
    } as unknown as GitHubClient;

    mockTestGenerator = {
      generateTest: vi.fn(),
      fixTest: vi.fn(),
      generateCoverageSummary: vi.fn(),
    } as unknown as TestGenerator;

    mockTestRunner = {
      runTests: vi.fn(),
    };

    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 50,
      enableAutoCommit: false,
      enablePRComments: false,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
      maxFixAttempts: 3,
    } as never);

    vi.mocked(GitHubClient).mockImplementation(() => mockGithubClient);
    vi.mocked(TestGenerator).mockImplementation(() => mockTestGenerator);
    vi.mocked(createTestRunner).mockReturnValue(mockTestRunner as never);
    vi.mocked(findProjectRoot).mockResolvedValue('/project');
    vi.mocked(detectPackageManager).mockReturnValue('npm');
    vi.mocked(writeTestFiles).mockReturnValue(['__tests__/test.test.ts']);
    vi.mocked(readCoverageReport).mockReturnValue(null);
  });

  it('should process PR and generate tests', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([
      {
        filePath: 'src/utils.ts',
        functionName: 'add',
        functionType: 'function',
        startLine: 1,
        endLine: 3,
        code: 'export function add() {}',
        context: '',
        changedRanges: [],
      },
    ]);

    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    mockGithubClient.fileExists = vi.fn().mockResolvedValue(false);
    mockTestGenerator.generateTest = vi.fn().mockResolvedValue({
      testCode: "describe('add', () => { it('works', () => {}); });",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    mockTestRunner.runTests = vi.fn().mockResolvedValue([
      {
        success: true,
        testFile: '__tests__/utils.test.ts',
        passed: 1,
        failed: 0,
        total: 1,
        duration: 100,
        failures: [],
      },
    ]);

    const summary = await runPullRequest(context);

    expect(summary.targetsProcessed).toBe(1);
    expect(summary.testsGenerated).toBe(1);
    expect(summary.testsFailed).toBe(0);
    expect(mockGithubClient.getPullRequest).toHaveBeenCalledWith(1);
    expect(mockTestGenerator.generateTest).toHaveBeenCalled();
  });

  it('should skip closed PRs', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'closed',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    const summary = await runPullRequest(context);

    expect(summary.targetsProcessed).toBe(0);
    expect(summary.testsGenerated).toBe(0);
    expect(mockGithubClient.listPullRequestFiles).not.toHaveBeenCalled();
  });

  it('should handle PRs with no files', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([]);

    const summary = await runPullRequest(context);

    expect(summary.targetsProcessed).toBe(0);
    expect(summary.testsGenerated).toBe(0);
  });

  it('should handle no test targets found', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([]);

    const summary = await runPullRequest(context);

    expect(summary.targetsProcessed).toBe(0);
    expect(summary.testsGenerated).toBe(0);
  });

  it('should limit targets based on maxTestsPerPR', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 2,
      enableAutoCommit: false,
      enablePRComments: false,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
      maxFixAttempts: 3,
    } as never);

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([
      {
        filePath: 'src/utils.ts',
        functionName: 'add',
        functionType: 'function',
        startLine: 1,
        endLine: 3,
        code: 'export function add() {}',
        context: '',
        changedRanges: [],
      },
      {
        filePath: 'src/utils.ts',
        functionName: 'subtract',
        functionType: 'function',
        startLine: 5,
        endLine: 7,
        code: 'export function subtract() {}',
        context: '',
        changedRanges: [],
      },
      {
        filePath: 'src/utils.ts',
        functionName: 'multiply',
        functionType: 'function',
        startLine: 9,
        endLine: 11,
        code: 'export function multiply() {}',
        context: '',
        changedRanges: [],
      },
    ]);

    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    mockGithubClient.fileExists = vi.fn().mockResolvedValue(false);
    mockTestGenerator.generateTest = vi.fn().mockResolvedValue({
      testCode: "describe('test', () => {});",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    mockTestRunner.runTests = vi.fn().mockResolvedValue([
      { success: true, testFile: '__tests__/utils.test.ts', passed: 1, failed: 0, total: 1, duration: 100, failures: [] },
    ]);

    const summary = await runPullRequest(context);

    expect(summary.targetsProcessed).toBe(2);
    expect(mockTestGenerator.generateTest).toHaveBeenCalledTimes(2);
  });

  it('should handle test generation errors', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([
      {
        filePath: 'src/utils.ts',
        functionName: 'add',
        functionType: 'function',
        startLine: 1,
        endLine: 3,
        code: 'export function add() {}',
        context: '',
        changedRanges: [],
      },
    ]);

    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    mockGithubClient.fileExists = vi.fn().mockResolvedValue(false);
    mockTestGenerator.generateTest = vi.fn().mockRejectedValue(new Error('LLM API error'));

    const summary = await runPullRequest(context);

    expect(summary.testsGenerated).toBe(0);
    expect(summary.testsFailed).toBe(1);
    expect(summary.errors).toHaveLength(1);
  });

  it('should commit tests when enableAutoCommit is true', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 50,
      enableAutoCommit: true,
      commitStrategy: 'direct',
      enablePRComments: false,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
      maxFixAttempts: 3,
    } as never);

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([
      {
        filePath: 'src/utils.ts',
        functionName: 'add',
        functionType: 'function',
        startLine: 1,
        endLine: 3,
        code: 'export function add() {}',
        context: '',
        changedRanges: [],
      },
    ]);

    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    mockGithubClient.fileExists = vi.fn().mockResolvedValue(false);
    mockTestGenerator.generateTest = vi.fn().mockResolvedValue({
      testCode: "describe('add', () => { it('works', () => {}); });",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    mockTestRunner.runTests = vi.fn().mockResolvedValue([
      { success: true, testFile: '__tests__/utils.test.ts', passed: 1, failed: 0, total: 1, duration: 100, failures: [] },
    ]);

    mockGithubClient.commitFiles = vi.fn().mockResolvedValue('commit-sha');

    await runPullRequest(context);

    expect(mockGithubClient.commitFiles).toHaveBeenCalled();
  });

  it('should post PR comment when enablePRComments is true', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'token',
    };

    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 50,
      enableAutoCommit: false,
      enablePRComments: true,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
      maxFixAttempts: 3,
    } as never);

    mockGithubClient.getPullRequest = vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test PR',
      state: 'open',
      head: { ref: 'feature', sha: 'head-sha' },
      base: { ref: 'main' },
    });

    mockGithubClient.listPullRequestFiles = vi.fn().mockResolvedValue([
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ]);

    vi.mocked(extractTestTargets).mockResolvedValue([
      {
        filePath: 'src/utils.ts',
        functionName: 'add',
        functionType: 'function',
        startLine: 1,
        endLine: 3,
        code: 'export function add() {}',
        context: '',
        changedRanges: [],
      },
    ]);

    vi.mocked(getTestFilePath).mockReturnValue('__tests__/utils.test.ts');
    mockGithubClient.fileExists = vi.fn().mockResolvedValue(false);
    mockTestGenerator.generateTest = vi.fn().mockResolvedValue({
      testCode: "describe('add', () => { it('works', () => {}); });",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    mockTestRunner.runTests = vi.fn().mockResolvedValue([
      { success: true, testFile: '__tests__/utils.test.ts', passed: 1, failed: 0, total: 1, duration: 100, failures: [] },
    ]);

    mockGithubClient.commentPR = vi.fn().mockResolvedValue(undefined);

    await runPullRequest(context);

    expect(mockGithubClient.commentPR).toHaveBeenCalledWith(1, expect.stringContaining('Kakarot CI'));
  });

  it('should throw error if GitHub token is missing', async () => {
    const context: PullRequestContext = {
      prNumber: 1,
      owner: 'owner',
      repo: 'repo',
      githubToken: '',
    };

    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 50,
      enableAutoCommit: false,
      enablePRComments: false,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
      maxFixAttempts: 3,
    } as never);

    await expect(runPullRequest(context)).rejects.toThrow('GitHub token is required');
  });
});

