// Configuration types and schema
export type { KakarotConfig, PartialKakarotConfig } from './types/config.js';
export { KakarotConfigSchema } from './types/config.js';

// Error types
export { KakarotError, RateLimitError, QuotaError, NonRetryableError } from './types/errors.js';

// Config loader
export { loadConfig } from './utils/config-loader.js';

// Logger utilities
export {
  initLogger,
  info,
  debug,
  warn,
  error,
  success,
  progress,
} from './utils/logger.js';

// GitHub integration
export { GitHubClient } from './github/client.js';
export type {
  PullRequest,
  PullRequestFile,
  FileContents,
  CommitFile,
  BatchCommitOptions,
  GitHubClientOptions,
} from './types/github.js';

// Diff analysis and AST extraction
export { parsePullRequestFiles, getChangedRanges } from './utils/diff-parser.js';
export { analyzeFile } from './utils/ast-analyzer.js';
export { extractTestTargets } from './utils/test-target-extractor.js';
export { getTestFilePath } from './utils/test-file-path.js';
export { findProjectRoot } from './utils/config-loader.js';
export type {
  DiffHunk,
  FileDiff,
  ChangedRange,
  TestTarget,
} from './types/diff.js';

// LLM integration
export { TestGenerator } from './llm/test-generator.js';
export { createLLMProvider } from './llm/factory.js';
export { parseTestCode, validateTestCodeStructure } from './llm/parser.js';
export { buildTestGenerationPrompt } from './llm/prompts/test-generation.js';
export { buildTestFixPrompt } from './llm/prompts/test-fix.js';
export type {
  LLMMessage,
  LLMResponse,
  LLMProvider,
  LLMGenerateOptions,
  TestGenerationContext,
  TestGenerationResult,
  TestFixContext,
} from './types/llm.js';

// Test execution
export { detectPackageManager } from './utils/package-manager-detector.js';
export { createTestRunner } from './utils/test-runner/factory.js';
export { JestRunner } from './utils/test-runner/jest-runner.js';
export { VitestRunner } from './utils/test-runner/vitest-runner.js';
export { writeTestFiles } from './utils/test-file-writer.js';
export type {
  TestRunner,
  TestResult,
  TestFailure,
  TestRunOptions,
} from './types/test-runner.js';
export type { PackageManager } from './utils/package-manager-detector.js';

// Coverage
export { readCoverageReport } from './utils/coverage-reader.js';
export { buildCoverageSummaryPrompt } from './llm/prompts/coverage-summary.js';
export type {
  CoverageReport,
  CoverageMetrics,
  FileCoverage,
  CoverageDelta,
} from './types/coverage.js';

// Main orchestration
export { runPullRequest } from './core/orchestrator.js';
export type { PullRequestContext, TestGenerationSummary } from './core/orchestrator.js';

