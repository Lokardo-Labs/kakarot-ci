import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CoverageReport, FileCoverage } from '../types/coverage.js';
import { debug, warn } from './logger.js';

/**
 * Jest coverage JSON structure
 */
interface JestCoverageData {
  [filePath: string]: {
    statements: { [key: string]: number };
    branches: { [key: string]: number };
    functions: { [key: string]: number };
    lines: { [key: string]: number };
    statementMap: Record<string, unknown>;
    fnMap: Record<string, unknown>;
    branchMap: Record<string, unknown>;
  };
}

/**
 * Vitest coverage JSON structure (similar to Jest)
 */
interface VitestCoverageData {
  [filePath: string]: {
    statements: { [key: string]: number };
    branches: { [key: string]: number };
    functions: { [key: string]: number };
    lines: { [key: string]: number };
  };
}

/**
 * Read and parse Jest coverage report
 */
function parseJestCoverage(data: JestCoverageData): CoverageReport {
  const files: FileCoverage[] = [];
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  let totalLines = 0;
  let coveredLines = 0;

  for (const [filePath, coverage] of Object.entries(data)) {
    // Calculate metrics for this file
    const statementCounts = Object.values(coverage.statements);
    const branchCounts = Object.values(coverage.branches);
    const functionCounts = Object.values(coverage.functions);
    const lineCounts = Object.values(coverage.lines);

    const fileStatements = {
      total: statementCounts.length,
      covered: statementCounts.filter(c => c > 0).length,
      percentage: statementCounts.length > 0
        ? (statementCounts.filter(c => c > 0).length / statementCounts.length) * 100
        : 100,
    };

    const fileBranches = {
      total: branchCounts.length,
      covered: branchCounts.filter(c => c > 0).length,
      percentage: branchCounts.length > 0
        ? (branchCounts.filter(c => c > 0).length / branchCounts.length) * 100
        : 100,
    };

    const fileFunctions = {
      total: functionCounts.length,
      covered: functionCounts.filter(c => c > 0).length,
      percentage: functionCounts.length > 0
        ? (functionCounts.filter(c => c > 0).length / functionCounts.length) * 100
        : 100,
    };

    const fileLines = {
      total: lineCounts.length,
      covered: lineCounts.filter(c => c > 0).length,
      percentage: lineCounts.length > 0
        ? (lineCounts.filter(c => c > 0).length / lineCounts.length) * 100
        : 100,
    };

    files.push({
      path: filePath,
      metrics: {
        statements: fileStatements,
        branches: fileBranches,
        functions: fileFunctions,
        lines: fileLines,
      },
    });

    // Accumulate totals
    totalStatements += fileStatements.total;
    coveredStatements += fileStatements.covered;
    totalBranches += fileBranches.total;
    coveredBranches += fileBranches.covered;
    totalFunctions += fileFunctions.total;
    coveredFunctions += fileFunctions.covered;
    totalLines += fileLines.total;
    coveredLines += fileLines.covered;
  }

  return {
    total: {
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 100,
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 100,
      },
      lines: {
        total: totalLines,
        covered: coveredLines,
        percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 100,
      },
    },
    files,
  };
}

/**
 * Read and parse Vitest coverage report (similar format to Jest)
 */
function parseVitestCoverage(data: VitestCoverageData): CoverageReport {
  // Vitest uses the same structure as Jest
  return parseJestCoverage(data as JestCoverageData);
}

/**
 * Read coverage report from Jest/Vitest JSON output
 */
export function readCoverageReport(
  projectRoot: string,
  framework: 'jest' | 'vitest'
): CoverageReport | null {
  // Jest and Vitest both output to coverage/coverage-final.json
  const coveragePath = join(projectRoot, 'coverage', 'coverage-final.json');

  if (!existsSync(coveragePath)) {
    debug(`Coverage file not found at ${coveragePath}`);
    return null;
  }

  try {
    const content = readFileSync(coveragePath, 'utf-8');
    const data = JSON.parse(content);

    if (framework === 'jest') {
      return parseJestCoverage(data as JestCoverageData);
    } else {
      return parseVitestCoverage(data as VitestCoverageData);
    }
  } catch (err) {
    warn(`Failed to read coverage report: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

