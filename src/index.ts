// Configuration types and schema
export type { KakarotConfig, PartialKakarotConfig } from './types/config.js';
export { KakarotConfigSchema } from './types/config.js';

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
export type {
  DiffHunk,
  FileDiff,
  ChangedRange,
  TestTarget,
} from './types/diff.js';

