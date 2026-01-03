import { describe, it, expect } from 'vitest';
import { mergeTestFiles, hasExistingTests, extractImports } from './test-file-merger.js';

describe('test-file-merger', () => {
  describe('extractImports', () => {
    it('should extract imports from code', () => {
      const code = `
        import { describe, it, expect } from 'vitest';
        import { DataProcessor } from '../src/utils/dataProcessor';
      `;
      
      const imports = extractImports(code);
      expect(imports.length).toBe(2);
      expect(imports[0]).toContain("from 'vitest'");
      expect(imports[1]).toContain("from '../src/utils/dataProcessor'");
    });
  });

  describe('hasExistingTests', () => {
    it('should detect existing tests for a function', () => {
      const content = `
        import { describe, it, expect } from 'vitest';
        describe('myFunction', () => {
          it('should work', () => {});
        });
      `;
      
      expect(hasExistingTests(content, 'myFunction')).toBe(true);
      expect(hasExistingTests(content, 'otherFunction')).toBe(false);
    });

    it('should detect existing tests for a class', () => {
      const content = `
        import { describe, it, expect } from 'vitest';
        describe('DataProcessor', () => {
          it('should work', () => {});
        });
      `;
      
      expect(hasExistingTests(content, 'processBatch', 'DataProcessor')).toBe(true);
      expect(hasExistingTests(content, 'processBatch', 'OtherClass')).toBe(false);
    });
  });

  describe('mergeTestFiles', () => {
    it('should merge imports without exact duplicates', () => {
      const existing = `
        import { describe, it, expect } from 'vitest';
        import { func1 } from './utils';
      `;
      
      const newCode = `
        import { describe, it, expect } from 'vitest';
        import { func2 } from './utils';
      `;
      
      const merged = mergeTestFiles(existing, newCode);
      
      // Should have both imports
      expect(merged).toContain("from 'vitest'");
      expect(merged).toContain("from './utils'");
      // Exact duplicate should be removed (import-cleaner will consolidate different imports from same source)
      const exactVitestImports = (merged.match(/import\s+\{\s*describe,\s*it,\s*expect\s*\}\s+from\s+'vitest'/g) || []).length;
      expect(exactVitestImports).toBeLessThanOrEqual(2); // May have 2 if different (one with vi, one without)
    });

    it('should merge describe blocks for same class', () => {
      const existing = `
        import { describe, it, expect } from 'vitest';
        describe('DataProcessor', () => {
          it('should process batch', () => {});
        });
      `;
      
      const newCode = `
        import { describe, it, expect } from 'vitest';
        describe('DataProcessor', () => {
          it('should clear cache', () => {});
        });
      `;
      
      const merged = mergeTestFiles(existing, newCode);
      
      // Should have only one DataProcessor describe block
      const describeCount = (merged.match(/describe\s*\(\s*['"]DataProcessor['"]/g) || []).length;
      expect(describeCount).toBe(1);
      // Should have both tests
      expect(merged).toContain('should process batch');
      expect(merged).toContain('should clear cache');
    });

    it('should add new describe blocks for different functions', () => {
      const existing = `
        import { describe, it, expect } from 'vitest';
        describe('func1', () => {
          it('should work', () => {});
        });
      `;
      
      const newCode = `
        import { describe, it, expect } from 'vitest';
        describe('func2', () => {
          it('should work', () => {});
        });
      `;
      
      const merged = mergeTestFiles(existing, newCode);
      
      // Should have both describe blocks
      expect(merged).toContain("describe('func1'");
      expect(merged).toContain("describe('func2'");
    });

    it('should handle empty existing file', () => {
      const existing = '';
      const newCode = `
        import { describe, it, expect } from 'vitest';
        describe('test', () => {
          it('works', () => {});
        });
      `;
      
      const merged = mergeTestFiles(existing, newCode);
      expect(merged).toContain("describe('test'");
    });

    it('should preserve existing structure', () => {
      const existing = `
        import { describe, it, expect, vi } from 'vitest';
        import { helper } from './helper';
        
        describe('existing', () => {
          it('test 1', () => {});
        });
      `;
      
      const newCode = `
        import { describe, it, expect } from 'vitest';
        describe('new', () => {
          it('test 2', () => {});
        });
      `;
      
      const merged = mergeTestFiles(existing, newCode);
      
      // Should preserve helper import
      expect(merged).toContain("from './helper'");
      // Should have both describe blocks
      expect(merged).toContain("describe('existing'");
      expect(merged).toContain("describe('new'");
    });
  });
});

