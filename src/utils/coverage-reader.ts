import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CoverageReport, FileCoverage } from '../types/coverage.js';
import { debug, warn } from './logger.js';

/**
 * Istanbul coverage JSON structure.
 * V8/Istanbul uses shorthand keys: s (statements), b (branches), f (functions).
 * Some reporters also include long-form keys.
 */
interface IstanbulCoverageEntry {
  path?: string;
  // Shorthand keys (V8 / @vitest/coverage-v8)
  s?: { [key: string]: number };
  b?: { [key: string]: number | number[] };
  f?: { [key: string]: number };
  // Long-form keys (some Jest reporters)
  statements?: { [key: string]: number };
  branches?: { [key: string]: number | number[] };
  functions?: { [key: string]: number };
  lines?: { [key: string]: number };
  statementMap?: Record<string, unknown>;
  fnMap?: Record<string, unknown>;
  branchMap?: Record<string, unknown>;
}

type CoverageData = { [filePath: string]: IstanbulCoverageEntry };

/**
 * Flatten branch counts. V8 coverage uses arrays for branch values (one per path),
 * while some reporters use plain numbers.
 */
function flattenBranchCounts(branches: { [key: string]: number | number[] }): number[] {
  const counts: number[] = [];
  for (const val of Object.values(branches)) {
    if (Array.isArray(val)) {
      counts.push(...val);
    } else {
      counts.push(val);
    }
  }
  return counts;
}

/**
 * Read and parse coverage report (handles both short and long-form Istanbul keys)
 */
function parseCoverage(data: CoverageData): CoverageReport {
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
    // Support both shorthand (s/b/f) and long-form (statements/branches/functions) keys
    const statementsObj = coverage.s || coverage.statements || {};
    const branchesObj = coverage.b || coverage.branches || {};
    const functionsObj = coverage.f || coverage.functions || {};
    const linesObj = coverage.lines || coverage.s || {}; // lines falls back to statements

    const statementCounts = Object.values(statementsObj) as number[];
    const branchCounts = flattenBranchCounts(branchesObj);
    const functionCounts = Object.values(functionsObj) as number[];
    const lineCounts = Object.values(linesObj) as number[];

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
 * Read coverage report from Jest/Vitest JSON output
 */
export function readCoverageReport(
  projectRoot: string,
  _framework: 'jest' | 'vitest'
): CoverageReport | null {
  const coveragePath = join(projectRoot, 'coverage', 'coverage-final.json');

  if (!existsSync(coveragePath)) {
    debug(`Coverage file not found at ${coveragePath}`);
    return null;
  }

  try {
    const content = readFileSync(coveragePath, 'utf-8');
    const data = JSON.parse(content) as CoverageData;
    return parseCoverage(data);
  } catch (err) {
    warn(`Failed to read coverage report: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

