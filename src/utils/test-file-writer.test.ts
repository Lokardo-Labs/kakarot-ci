import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeTestFiles } from './test-file-writer.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { debug } from './logger.js';

// Mock fs and path modules
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
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

  it('should write test files to disk', () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';

    const result = writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledWith(
      '/project/__tests__/utils.test.ts',
      'test code',
      'utf-8'
    );
    expect(result).toEqual(['__tests__/utils.test.ts']);
  });

  it('should create directory if it does not exist', () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValue(false);

    writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).toHaveBeenCalledWith('/project/__tests__', { recursive: true });
    expect(vi.mocked(debug)).toHaveBeenCalledWith('Created directory: /project/__tests__');
  });

  it('should not create directory if it exists', () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValue(true);

    writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('should write multiple test files', () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test 1', targets: ['foo'] }],
      ['__tests__/helper.test.ts', { content: 'test 2', targets: ['bar'] }],
    ]);
    const projectRoot = '/project';

    const result = writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result).toContain('__tests__/utils.test.ts');
    expect(result).toContain('__tests__/helper.test.ts');
  });

  it('should handle nested directories', () => {
    const testFiles = new Map([
      ['src/utils/__tests__/helper.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValue(false);

    writeTestFiles(testFiles, projectRoot);

    expect(mkdirSync).toHaveBeenCalledWith('/project/src/utils/__tests__', { recursive: true });
  });

  it('should log debug messages', () => {
    const testFiles = new Map([
      ['__tests__/utils.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';

    writeTestFiles(testFiles, projectRoot);

    expect(vi.mocked(debug)).toHaveBeenCalledWith('Wrote test file: __tests__/utils.test.ts');
  });

  it('should handle files in root directory', () => {
    const testFiles = new Map([
      ['index.test.ts', { content: 'test code', targets: ['foo'] }],
    ]);
    const projectRoot = '/project';
    vi.mocked(existsSync).mockReturnValue(true);

    writeTestFiles(testFiles, projectRoot);

    expect(writeFileSync).toHaveBeenCalledWith('/project/index.test.ts', 'test code', 'utf-8');
  });
});

