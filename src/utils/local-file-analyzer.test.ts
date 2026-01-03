import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractLocalTestTargets } from './local-file-analyzer.js';
import { simpleGit } from 'simple-git';
import { readFileSync, existsSync } from 'fs';
import { findProjectRoot } from './config-loader.js';
import { parsePullRequestFiles, getChangedRanges } from './diff-parser.js';
import { analyzeFile } from './ast-analyzer.js';

vi.mock('simple-git');
vi.mock('fs');
vi.mock('./config-loader.js');
vi.mock('./diff-parser.js');
vi.mock('./ast-analyzer.js');
vi.mock('./logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('minimatch', () => ({
  minimatch: (path: string, pattern: string) => {
    if (pattern === '**/*.ts') return path.endsWith('.ts');
    if (pattern === '**/*.test.ts') return path.includes('.test.ts');
    return false;
  },
}));

describe('local-file-analyzer', () => {
  const mockGit = {
    status: vi.fn(),
    diff: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findProjectRoot).mockResolvedValue('/project');
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('export function test() {}');
    vi.mocked(mockGit.status).mockResolvedValue({
      modified: [],
      created: [],
      renamed: [],
    } as never);
  });

  it('should return empty array when no files changed', async () => {
    const targets = await extractLocalTestTargets({
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
    });

    expect(targets).toEqual([]);
  });

  it('should filter files by include patterns', async () => {
    vi.mocked(mockGit.status).mockResolvedValue({
      modified: ['src/utils.ts'],
      created: [],
      renamed: [],
    } as never);
    vi.mocked(mockGit.diff).mockResolvedValue('diff content');
    vi.mocked(parsePullRequestFiles).mockReturnValue([{
      filename: 'src/utils.ts',
      status: 'modified',
      hunks: [],
      additions: 5,
      deletions: 2,
    }]);
    vi.mocked(getChangedRanges).mockReturnValue([{ start: 1, end: 5, type: 'addition' }]);
    vi.mocked(analyzeFile).mockResolvedValue([]);

    const targets = await extractLocalTestTargets({
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
    });

    expect(targets).toEqual([]);
    expect(parsePullRequestFiles).toHaveBeenCalled();
  });

  it('should exclude test files', async () => {
    vi.mocked(mockGit.status).mockResolvedValue({
      modified: ['src/utils.test.ts'],
      created: [],
      renamed: [],
    } as never);

    const targets = await extractLocalTestTargets({
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
    });

    expect(targets).toEqual([]);
  });
});

