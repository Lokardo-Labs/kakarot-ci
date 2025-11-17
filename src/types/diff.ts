/**
 * Types for diff analysis and test target extraction
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface ChangedRange {
  start: number;
  end: number;
  type: 'addition' | 'deletion';
}

export interface TestTarget {
  filePath: string;
  functionName: string;
  functionType: 'function' | 'method' | 'arrow-function' | 'class-method';
  startLine: number;
  endLine: number;
  code: string;
  context: string;
  existingTestFile?: string;
  changedRanges: ChangedRange[];
}

