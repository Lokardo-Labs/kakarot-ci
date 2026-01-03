import type { PullRequestFile } from '../types/github.js';
import type { KakarotConfig } from '../types/config.js';
import type { TestTarget } from '../types/diff.js';
import { GitHubClient } from '../github/client.js';
import { parsePullRequestFiles, getChangedRanges } from './diff-parser.js';
import { analyzeFile } from './ast-analyzer.js';
import { debug, info } from './logger.js';
import { minimatch } from 'minimatch';

/**
 * Extract test targets from pull request files
 */
export async function extractTestTargets(
  files: PullRequestFile[],
  githubClient: GitHubClient,
  prHeadRef: string,
  config: Pick<KakarotConfig, 'testDirectory' | 'testFilePattern' | 'includePatterns' | 'excludePatterns'>
): Promise<TestTarget[]> {
  info(`Analyzing ${files.length} file(s) for test targets`);
  
  // Parse diffs
  const diffs = parsePullRequestFiles(files);
  
  // Filter by include/exclude patterns using minimatch
  const filteredDiffs = diffs.filter(diff => {
    // Check include patterns
    const matchesInclude = config.includePatterns.some(pattern => {
      return minimatch(diff.filename, pattern);
    });
    
    if (!matchesInclude) return false;
    
    // Check exclude patterns
    const matchesExclude = config.excludePatterns.some(pattern => {
      return minimatch(diff.filename, pattern);
    });
    
    return !matchesExclude;
  });
  
  debug(`Filtered to ${filteredDiffs.length} file(s) after pattern matching`);
  
  const targets: TestTarget[] = [];
  
  // Process each file
  for (const diff of filteredDiffs) {
    if (diff.status === 'removed') {
      // Skip removed files
      continue;
    }
    
    try {
      // Fetch file contents from PR head (the branch with changes)
      const fileContents = await githubClient.getFileContents(prHeadRef, diff.filename);
      
      // Get changed ranges (pass fileContent for added files)
      const changedRanges = getChangedRanges(diff, fileContents.content);
      
      if (changedRanges.length === 0) {
        // No changes detected, skip
        continue;
      }
      
      // Use the detected changed ranges (getChangedRanges now handles added files)
      const ranges = changedRanges.map(r => ({
        start: r.start,
        end: r.end,
        type: r.type as 'addition' | 'deletion',
      }));
      
      // Analyze AST and extract test targets (use head ref for test file detection)
      // For PR mode, only test functions that overlap with changes (more targeted)
      const fileTargets = await analyzeFile(
        diff.filename,
        fileContents.content,
        ranges,
        prHeadRef,
        githubClient,
        config.testDirectory,
        false // testAllExports = false for PR mode (only test changed functions)
      );
      
      targets.push(...fileTargets);
      
      if (fileTargets.length > 0) {
        info(`Found ${fileTargets.length} test target(s) in ${diff.filename}`);
      }
    } catch (error) {
      debug(`Failed to analyze ${diff.filename}: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with other files
    }
  }
  
  info(`Extracted ${targets.length} total test target(s)`);
  return targets;
}

