import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readCoverageReport } from './coverage-reader.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));

describe('coverage-reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read and parse Jest coverage report', () => {
    const coverageData = {
      'src/utils.ts': {
        statements: { '0': 1, '1': 0 },
        branches: { '0': 1 },
        functions: { '0': 1 },
        lines: { '0': 1 },
        statementMap: {},
        fnMap: {},
        branchMap: {},
      },
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(coverageData));

    const report = readCoverageReport('/project', 'jest');

    expect(report).not.toBeNull();
    expect(report?.files).toHaveLength(1);
    expect(report?.files[0].path).toBe('src/utils.ts');
    expect(report?.total.lines.percentage).toBe(100);
  });

  it('should read and parse Vitest coverage report', () => {
    const coverageData = {
      'src/utils.ts': {
        statements: { '0': 1, '1': 0 },
        branches: { '0': 1 },
        functions: { '0': 1 },
        lines: { '0': 1 },
      },
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(coverageData));

    const report = readCoverageReport('/project', 'vitest');

    expect(report).not.toBeNull();
    expect(report?.files).toHaveLength(1);
  });

  it('should return null if coverage file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const report = readCoverageReport('/project', 'jest');

    expect(report).toBeNull();
  });

  it('should return null on parse error', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('invalid json');

    const report = readCoverageReport('/project', 'jest');

    expect(report).toBeNull();
  });

  it('should calculate coverage percentages correctly', () => {
    const coverageData = {
      'src/utils.ts': {
        statements: { '0': 1, '1': 0, '2': 0 },
        branches: { '0': 1, '1': 0 },
        functions: { '0': 1 },
        lines: { '0': 1, '1': 0 },
        statementMap: {},
        fnMap: {},
        branchMap: {},
      },
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(coverageData));

    const report = readCoverageReport('/project', 'jest');

    expect(report?.files[0].metrics.statements.percentage).toBeCloseTo(33.33, 1);
    expect(report?.files[0].metrics.branches.percentage).toBe(50);
    expect(report?.files[0].metrics.functions.percentage).toBe(100);
    expect(report?.files[0].metrics.lines.percentage).toBe(50);
  });

  it('should check correct coverage path', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    readCoverageReport('/project', 'jest');

    expect(existsSync).toHaveBeenCalledWith(join('/project', 'coverage', 'coverage-final.json'));
  });
});

