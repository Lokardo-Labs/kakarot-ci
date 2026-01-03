/**
 * Extract test targets from local git changes
 * Uses simple-git and reuses existing diff parsing logic
 */

import { readFileSync, existsSync } from 'fs';
import { simpleGit } from 'simple-git';
import { minimatch } from 'minimatch';
import type { KakarotConfig } from '../types/config.js';
import type { ChangedRange } from '../types/diff.js';
import { getChangedRanges } from './diff-parser.js';
import { analyzeFile } from './ast-analyzer.js';
import type { TestTarget } from '../types/diff.js';
import { info, debug } from './logger.js';
import { findProjectRoot } from './config-loader.js';
import { parsePullRequestFiles } from './diff-parser.js';
import type { PullRequestFile } from '../types/github.js';

/**
 * Extract test targets from local git changes
 */
export async function extractLocalTestTargets(
  config: Pick<KakarotConfig, 'testDirectory' | 'testFilePattern' | 'includePatterns' | 'excludePatterns'>
): Promise<TestTarget[]> {
  const projectRoot = await findProjectRoot();
  const git = simpleGit(projectRoot);
  
  // Get all changed files (staged and unstaged) by comparing working directory to HEAD
  // This is more flexible than requiring files to be staged
  const diffSummary = await git.diffSummary(['HEAD']);
  const changedFiles = [
    ...diffSummary.files.map(f => f.file),
  ].filter(file => {
    // Filter by include/exclude patterns
    // Check exclude patterns first
    for (const pattern of config.excludePatterns) {
      if (minimatch(file, pattern)) {
        return false;
      }
    }
    
    // Check include patterns
    for (const pattern of config.includePatterns) {
      if (minimatch(file, pattern)) {
        return true;
      }
    }
    
    return false;
  });

  if (changedFiles.length === 0) {
    info('No changed files found (compared to HEAD)');
    return [];
  }

  info(`Found ${changedFiles.length} changed file(s) in working directory (staged and unstaged)`);

  // Get diff for each file and convert to PullRequestFile format
  const prFiles: PullRequestFile[] = [];
  
  for (const file of changedFiles) {
    try {
      // Get file diff
      const diff = await git.diff(['HEAD', '--', file]);
      
      if (!diff) {
        // New file - no diff available
        const fileContent = existsSync(`${projectRoot}/${file}`) 
          ? readFileSync(`${projectRoot}/${file}`, 'utf-8')
          : '';
        
        prFiles.push({
          filename: file,
          status: 'added',
          additions: fileContent.split('\n').length,
          deletions: 0,
          changes: fileContent.split('\n').length,
          patch: diff || undefined,
        });
        continue;
      }

      // Parse diff to get stats
      const diffLines = diff.split('\n');
      let additions = 0;
      let deletions = 0;
      
      for (const line of diffLines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }

      prFiles.push({
        filename: file,
        status: 'modified',
        additions,
        deletions,
        changes: additions + deletions,
        patch: diff,
      });
    } catch (err) {
      debug(`Failed to get diff for ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reuse existing parsing logic
  const fileDiffs = parsePullRequestFiles(prFiles);
  
  const targets: TestTarget[] = [];

  for (const diff of fileDiffs) {
    if (diff.status === 'removed') {
      continue;
    }

    try {
      const filePath = diff.filename;
      const fullPath = `${projectRoot}/${filePath}`;
      
      if (!existsSync(fullPath)) {
        debug(`File ${filePath} does not exist, skipping`);
        continue;
      }

      const fileContent = readFileSync(fullPath, 'utf-8');
      const changedRanges = getChangedRanges(diff, fileContent);

      if (changedRanges.length === 0) {
        continue;
      }

      const ranges: ChangedRange[] = changedRanges.map(r => ({
        start: r.start,
        end: r.end,
        type: r.type as 'addition' | 'deletion',
      }));

      // Analyze file (no GitHub client needed for local mode)
      const localFileChecker = {
        fileExists: async (_ref: string, path: string): Promise<boolean> => {
          const fullPath = `${projectRoot}/${path}`;
          return existsSync(fullPath);
        },
      };

      const fileTargets = await analyzeFile(
        filePath,
        fileContent,
        ranges,
        'HEAD',
        localFileChecker,
        config.testDirectory
      );

      targets.push(...fileTargets);

      if (fileTargets.length > 0) {
        info(`Found ${fileTargets.length} test target(s) in ${filePath}`);
      }
    } catch (err) {
      debug(`Failed to analyze ${diff.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  info(`Extracted ${targets.length} total test target(s) from local changes`);
  return targets;
}
