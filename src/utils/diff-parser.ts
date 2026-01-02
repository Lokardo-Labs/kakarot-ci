import type { PullRequestFile } from '../types/github.js';
import type { FileDiff, DiffHunk } from '../types/diff.js';
import { debug } from './logger.js';

/**
 * Parse unified diff format from GitHub patch
 */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = parseInt(hunkMatch[2] || '1', 10);
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = parseInt(hunkMatch[4] || '1', 10);
      
      const hunkLines: string[] = [];
      i++;
      
      // Collect lines until next hunk or end
      while (i < lines.length && !lines[i].startsWith('@@')) {
        hunkLines.push(lines[i]);
        i++;
      }
      
      hunks.push({
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: hunkLines,
      });
    } else {
      i++;
    }
  }
  
  return hunks;
}

/**
 * Convert diff hunks to changed line ranges
 * 
 * Note: We're additions-first for test generation - we generate tests for new/modified code.
 * Deletions are tracked but primarily used for context. Merged ranges represent "fuzzy zones"
 * of change rather than exact line-by-line mappings, which helps with function-level detection.
 */
function hunksToChangedRanges(hunks: DiffHunk[]): Array<{ start: number; end: number; type: 'addition' | 'deletion' }> {
  const ranges: Array<{ start: number; end: number; type: 'addition' | 'deletion' }> = [];
  
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Addition - these are the lines we care about for test generation
        ranges.push({
          start: newLine,
          end: newLine,
          type: 'addition',
        });
        newLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Deletion - tracked for context, but additions are primary for test targets
        ranges.push({
          start: oldLine,
          end: oldLine,
          type: 'deletion',
        });
        oldLine++;
      } else if (!line.startsWith('\\')) {
        // Context line (unchanged)
        oldLine++;
        newLine++;
      }
    }
  }
  
  // Merge adjacent ranges (creates "fuzzy zones" of change)
  return mergeRanges(ranges);
}

/**
 * Merge adjacent or overlapping ranges
 * 
 * Creates "fuzzy zones" of change - merged ranges represent approximate areas where
 * changes occurred, not exact line-by-line mappings. This helps with function-level
 * detection where we want to catch functions that are near changes.
 */
function mergeRanges(
  ranges: Array<{ start: number; end: number; type: 'addition' | 'deletion' }>
): Array<{ start: number; end: number; type: 'addition' | 'deletion' }> {
  if (ranges.length === 0) return [];
  
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number; type: 'addition' | 'deletion' }> = [];
  
  let current = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // If ranges overlap or are adjacent (within 2 lines), merge them
    if (next.start <= current.end + 2 && next.type === current.type) {
      current = {
        start: current.start,
        end: Math.max(current.end, next.end),
        type: current.type,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Parse PR files into structured diff format
 */
export function parsePullRequestFiles(files: PullRequestFile[]): FileDiff[] {
  const diffs: FileDiff[] = [];
  
  for (const file of files) {
    // Filter TypeScript and JavaScript files
    if (!file.filename.match(/\.(ts|tsx|js|jsx)$/)) {
      continue;
    }
    
    if (!file.patch) {
      // File was added or removed without patch
      diffs.push({
        filename: file.filename,
        status: file.status as FileDiff['status'],
        hunks: [],
        additions: file.additions,
        deletions: file.deletions,
      });
      continue;
    }
    
    const hunks = parseUnifiedDiff(file.patch);
    
    diffs.push({
      filename: file.filename,
      status: file.status as FileDiff['status'],
      hunks,
      additions: file.additions,
      deletions: file.deletions,
    });
    
    debug(`Parsed ${hunks.length} hunk(s) for ${file.filename}`);
  }
  
  return diffs;
}

/**
 * Get changed line ranges for a file diff
 * 
 * For added files: Requires fileContent to determine line count. Returns ranges
 * covering the entire file (all lines are additions in new files).
 * 
 * For removed files: Returns empty (nothing to test in deleted files).
 * 
 * For modified files: Returns merged ranges representing fuzzy zones of change.
 * Note: Deletion ranges use OLD file line numbers and should only be used for
 * metadata/context, not for overlap detection in the new file.
 */
export function getChangedRanges(
  diff: FileDiff,
  fileContent?: string
): Array<{ start: number; end: number; type: 'addition' | 'deletion' }> {
  if (diff.status === 'added') {
    if (!fileContent) {
      throw new Error('fileContent is required for added files to determine line count');
    }
    // For new files, entire file is changed (all lines are additions)
    const lineCount = fileContent.split('\n').length;
    return [{ start: 1, end: lineCount, type: 'addition' }];
  }
  
  if (diff.status === 'removed') {
    // For removed files, return empty (nothing to test)
    return [];
  }
  
  return hunksToChangedRanges(diff.hunks);
}

