/**
 * Types for test coverage analysis
 */

export interface CoverageMetrics {
  lines: {
    total: number;
    covered: number;
    percentage: number;
  };
  branches: {
    total: number;
    covered: number;
    percentage: number;
  };
  functions: {
    total: number;
    covered: number;
    percentage: number;
  };
  statements: {
    total: number;
    covered: number;
    percentage: number;
  };
}

export interface FileCoverage {
  path: string;
  metrics: CoverageMetrics;
}

export interface CoverageReport {
  total: CoverageMetrics;
  files: FileCoverage[];
}

export interface CoverageDelta {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

