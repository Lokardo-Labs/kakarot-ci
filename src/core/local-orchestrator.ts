/**
 * Local orchestration function for Kakarot CI
 * Processes local git changes and generates tests (scaffold/full modes)
 */

import { loadConfig } from '../utils/config-loader.js';
import { initLogger, info } from '../utils/logger.js';
import { extractLocalTestTargets } from '../utils/local-file-analyzer.js';
import { generateTestsFromTargets } from './test-generation-core.js';

export interface LocalContext {
  mode: 'scaffold' | 'full';
  /** CLI override for includePatterns */
  includePatterns?: string[];
  /** CLI override for excludePatterns */
  excludePatterns?: string[];
}

export interface TestGenerationSummary {
  targetsProcessed: number;
  testsGenerated: number;
  testsFailed: number;
  testFiles: Array<{
    path: string;
    targets: string[];
  }>;
  errors: Array<{
    target: string;
    error: string;
  }>;
  coverageReport?: import('../types/coverage.js').CoverageReport;
  testResults?: import('../types/test-runner.js').TestResult[];
}

/**
 * Main orchestration function to process local changes and generate tests
 */
export async function runLocal(context: LocalContext): Promise<TestGenerationSummary> {
  const config = await loadConfig();
  
  // Apply CLI overrides for include/exclude patterns
  if (context.includePatterns && context.includePatterns.length > 0) {
    config.includePatterns = context.includePatterns;
  }
  if (context.excludePatterns && context.excludePatterns.length > 0) {
    config.excludePatterns = context.excludePatterns;
  }
  
  // Initialize logger
  initLogger(config);
  
  info(`Processing local changes in ${context.mode} mode`);

  // Extract test targets from local git changes
  const targets = await extractLocalTestTargets(config);

  // Use shared test generation logic
  const result = await generateTestsFromTargets({
    targets,
    config,
    mode: context.mode,
  });

  // Convert to summary format
  return {
    targetsProcessed: result.targetsProcessed,
    testsGenerated: result.testsGenerated,
    testsFailed: result.testsFailed,
    testFiles: result.testFiles,
    errors: result.errors,
    coverageReport: result.coverageReport,
    testResults: result.testResults,
  };
}
