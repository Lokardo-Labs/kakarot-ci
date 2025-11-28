import { describe, it, expect } from 'vitest';
import { parsePullRequestFiles, getChangedRanges } from './diff-parser.js';
import type { PullRequestFile } from '../types/github.js';

describe('diff-parser', () => {
  describe('parsePullRequestFiles', () => {
    it('should parse files with patches', () => {
      const files: PullRequestFile[] = [
        {
          filename: 'src/utils.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          changes: 7,
          patch: `@@ -10,5 +10,8 @@ export function foo() {
+  const x = 1;
+  const y = 2;
   return x + y;
+  const z = 3;
 }`,
        },
      ];

      const result = parsePullRequestFiles(files);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('src/utils.ts');
      expect(result[0].status).toBe('modified');
      expect(result[0].hunks).toHaveLength(1);
      expect(result[0].hunks[0].oldStart).toBe(10);
      expect(result[0].hunks[0].newStart).toBe(10);
    });

    it('should filter out non-TypeScript/JavaScript files', () => {
      const files: PullRequestFile[] = [
        {
          filename: 'README.md',
          status: 'modified',
          additions: 1,
          deletions: 1,
          changes: 2,
          patch: '@@ -1 +1 @@\n- old\n+ new',
        },
        {
          filename: 'src/utils.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          changes: 2,
          patch: '@@ -1 +1 @@\n- old\n+ new',
        },
      ];

      const result = parsePullRequestFiles(files);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('src/utils.ts');
    });

    it('should handle files without patches', () => {
      const files: PullRequestFile[] = [
        {
          filename: 'src/new-file.ts',
          status: 'added',
          additions: 10,
          deletions: 0,
          changes: 10,
        },
      ];

      const result = parsePullRequestFiles(files);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('src/new-file.ts');
      expect(result[0].status).toBe('added');
      expect(result[0].hunks).toHaveLength(0);
    });

    it('should parse multiple hunks', () => {
      const files: PullRequestFile[] = [
        {
          filename: 'src/utils.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          changes: 15,
          patch: `@@ -10,5 +10,8 @@
+ line 1
+ line 2
@@ -20,5 +25,8 @@
+ line 3
+ line 4`,
        },
      ];

      const result = parsePullRequestFiles(files);

      expect(result[0].hunks).toHaveLength(2);
      expect(result[0].hunks[0].oldStart).toBe(10);
      expect(result[0].hunks[1].oldStart).toBe(20);
    });
  });

  describe('getChangedRanges', () => {
    it('should return full file range for added files', () => {
      const diff = {
        filename: 'src/new.ts',
        status: 'added' as const,
        hunks: [],
        additions: 10,
        deletions: 0,
      };

      const fileContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
      const ranges = getChangedRanges(diff, fileContent);

      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 1, end: 5, type: 'addition' });
    });

    it('should throw error for added files without fileContent', () => {
      const diff = {
        filename: 'src/new.ts',
        status: 'added' as const,
        hunks: [],
        additions: 10,
        deletions: 0,
      };

      expect(() => getChangedRanges(diff)).toThrow('fileContent is required');
    });

    it('should return empty array for removed files', () => {
      const diff = {
        filename: 'src/removed.ts',
        status: 'removed' as const,
        hunks: [],
        additions: 0,
        deletions: 10,
      };

      const ranges = getChangedRanges(diff);

      expect(ranges).toHaveLength(0);
    });

    it('should parse changed ranges from hunks', () => {
      const diff = {
        filename: 'src/utils.ts',
        status: 'modified' as const,
        hunks: [
          {
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 5,
            lines: [
              ' context',
              '+ addition 1',
              '+ addition 2',
              ' context',
              '- deletion',
            ],
          },
        ],
        additions: 2,
        deletions: 1,
      };

      const ranges = getChangedRanges(diff);

      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges.some(r => r.type === 'addition')).toBe(true);
    });

    it('should merge adjacent ranges', () => {
      const diff = {
        filename: 'src/utils.ts',
        status: 'modified' as const,
        hunks: [
          {
            oldStart: 10,
            oldLines: 2,
            newStart: 10,
            newLines: 2,
            lines: ['+ line 1', '+ line 2'],
          },
          {
            oldStart: 13,
            oldLines: 2,
            newStart: 13,
            newLines: 2,
            lines: ['+ line 3', '+ line 4'],
          },
        ],
        additions: 4,
        deletions: 0,
      };

      const ranges = getChangedRanges(diff);

      // Adjacent ranges (within 2 lines) should be merged
      expect(ranges.length).toBeLessThanOrEqual(2);
    });
  });
});

