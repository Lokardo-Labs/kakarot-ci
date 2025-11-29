import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTestTargets } from './test-target-extractor.js';
import type { PullRequestFile } from '../types/github.js';
import { GitHubClient } from '../github/client.js';

vi.mock('./diff-parser.js', () => ({
  parsePullRequestFiles: vi.fn((files) =>
    files.map((f: PullRequestFile) => ({
      filename: f.filename,
      status: f.status,
      hunks: [],
    }))
  ),
  getChangedRanges: vi.fn(() => [{ start: 1, end: 5, type: 'addition' }]),
}));

vi.mock('./ast-analyzer.js', () => ({
  analyzeFile: vi.fn().mockResolvedValue([
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
  ]),
}));

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
}));

describe('test-target-extractor', () => {
  let mockGithubClient: GitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGithubClient = {
      getFileContents: vi.fn().mockResolvedValue({
        content: 'export function add() {}',
        encoding: 'utf-8',
        sha: 'abc123',
        size: 100,
      }),
    } as unknown as GitHubClient;
  });

  it('should extract test targets from PR files', async () => {
    const files: PullRequestFile[] = [
      {
        filename: 'src/utils.ts',
        status: 'added',
        additions: 10,
        deletions: 0,
        changes: 10,
      },
    ];

    const targets = await extractTestTargets(
      files,
      mockGithubClient,
      'main',
      {
        testDirectory: '__tests__',
        testFilePattern: '*.test.ts',
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts'],
      }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].functionName).toBe('add');
  });

  it('should filter files by include patterns', async () => {
    const files: PullRequestFile[] = [
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
      { filename: 'docs/readme.md', status: 'added', additions: 5, deletions: 0, changes: 5 },
    ];

    await extractTestTargets(
      files,
      mockGithubClient,
      'main',
      {
        testDirectory: '__tests__',
        testFilePattern: '*.test.ts',
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts'],
      }
    );

    expect(mockGithubClient.getFileContents).toHaveBeenCalledTimes(1);
    expect(mockGithubClient.getFileContents).toHaveBeenCalledWith('main', 'src/utils.ts');
  });

  it('should filter files by exclude patterns', async () => {
    const files: PullRequestFile[] = [
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
      { filename: 'src/utils.test.ts', status: 'added', additions: 5, deletions: 0, changes: 5 },
    ];

    await extractTestTargets(
      files,
      mockGithubClient,
      'main',
      {
        testDirectory: '__tests__',
        testFilePattern: '*.test.ts',
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts'],
      }
    );

    expect(mockGithubClient.getFileContents).toHaveBeenCalledTimes(1);
  });

  it('should skip removed files', async () => {
    const files: PullRequestFile[] = [
      { filename: 'src/utils.ts', status: 'removed', additions: 0, deletions: 10, changes: 10 },
    ];

    const targets = await extractTestTargets(
      files,
      mockGithubClient,
      'main',
      {
        testDirectory: '__tests__',
        testFilePattern: '*.test.ts',
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts'],
      }
    );

    expect(mockGithubClient.getFileContents).not.toHaveBeenCalled();
    expect(targets).toHaveLength(0);
  });

  it('should handle errors gracefully', async () => {
    mockGithubClient.getFileContents = vi.fn().mockRejectedValue(new Error('File not found'));

    const files: PullRequestFile[] = [
      { filename: 'src/utils.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
    ];

    const targets = await extractTestTargets(
      files,
      mockGithubClient,
      'main',
      {
        testDirectory: '__tests__',
        testFilePattern: '*.test.ts',
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts'],
      }
    );

    expect(targets).toHaveLength(0);
  });
});

