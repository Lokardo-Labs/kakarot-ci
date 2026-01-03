import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeTestFiles } from './test-file-writer.js';
import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { debug } from './logger.js';
import { validateTestFile } from './file-validator.js';

// Mock fs and path modules
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('./file-validator.js', () => ({
  validateTestFile: vi.fn(),
}));

vi.mock('path', () => ({
  dirname: (path: string) => {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '/';
  },
  join: (...args: string[]) => args.join('/'),
}));

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('writeTestFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write test files to disk', async () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true); // dir doesn't exist, temp file exists

    const result = await writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledWith(
      '/project/__tests__/utils.test.ts.tmp',
      'test code',
      'utf-8'
    );
    expect(renameSync).toHaveBeenCalledWith(
      '/project/__tests__/utils.test.ts.tmp',
      '/project/__tests__/utils.test.ts'
    );
    expect(result.writtenPaths).toEqual(['__tests__/utils.test.ts']);
    expect(result.failedPaths).toEqual([]);
  });

  it('should create directory if it does not exist', async () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true); // dir doesn't exist, temp file exists
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).toHaveBeenCalledWith('/project/__tests__', { recursive: true });
    expect(vi.mocked(debug)).toHaveBeenCalledWith('Created directory: /project/__tests__');
  });

  it('should not create directory if it exists', async () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true); // dir exists, temp file exists
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('should write multiple test files', async () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test 1', targets: ['foo'] }],
      ['__tests__/helper.test.ts', { content: 'test 2', targets: ['bar'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValue(false).mockReturnValue(true).mockReturnValue(false).mockReturnValue(true);
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    const result = await writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(result.writtenPaths).toHaveLength(2);
    expect(result.writtenPaths).toContain('__tests__/utils.test.ts');
    expect(result.writtenPaths).toContain('__tests__/helper.test.ts');
  });

  it('should handle nested directories', async () => {
    const testFiles = new Map([
      ['src/utils/__tests__/helper.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).toHaveBeenCalledWith('/project/src/utils/__tests__', { recursive: true });
  });

  it('should log debug messages', async () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await writeTestFiles(testFiles, projectRoot);

    expect(vi.mocked(debug)).toHaveBeenCalledWith('Wrote test file: __tests__/utils.test.ts');
  });

  it('should handle files in root directory', async () => {
    const testFiles = new Map([
      ['index.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(validateTestFile).mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledWith('/project/index.test.ts.tmp', 'test code', 'utf-8');
    expect(renameSync).toHaveBeenCalledWith('/project/index.test.ts.tmp', '/project/index.test.ts');
  });
  
  it('should skip invalid files', async () => {
    const testFiles = new Map([
      ['__tests__/invalid.test.ts', { content: 'incomplete code {', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(validateTestFile).mockResolvedValue({
      valid: false,
      errors: ['Syntax: Unclosed braces: 1 opening brace(s) without closing'],
      warnings: [],
    });

    const result = await writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(result.writtenPaths).toEqual([]);
    expect(result.failedPaths).toEqual(['__tests__/invalid.test.ts']);
  });
});

