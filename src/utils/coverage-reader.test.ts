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

  it('should read and parse Vitest V8 coverage report with shorthand keys', () => {
    const coverageData = {
      '/project/src/utils.ts': {
        path: '/project/src/utils.ts',
        s: { '0': 5, '1': 0, '2': 3 },
        b: { '0': [2, 1], '1': [0, 3] },
        f: { '0': 5, '1': 0 },
        statementMap: {},
        fnMap: {},
        branchMap: {},
      },
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(coverageData));

    const report = readCoverageReport('/project', 'vitest');

    expect(report).not.toBeNull();
    expect(report?.files).toHaveLength(1);
    // s: 2 of 3 covered (5>0, 0=0, 3>0)
    expect(report?.files[0].metrics.statements.total).toBe(3);
    expect(report?.files[0].metrics.statements.covered).toBe(2);
    // b: flattened [2,1,0,3] = 3 of 4 covered
    expect(report?.files[0].metrics.branches.total).toBe(4);
    expect(report?.files[0].metrics.branches.covered).toBe(3);
    // f: 1 of 2 covered
    expect(report?.files[0].metrics.functions.total).toBe(2);
    expect(report?.files[0].metrics.functions.covered).toBe(1);
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

