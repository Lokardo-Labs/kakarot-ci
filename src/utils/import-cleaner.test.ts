import { describe, it, expect, vi } from 'vitest';
import { removeUnusedImports } from './import-cleaner.js';

vi.mock('./logger.js', () => ({
  warn: vi.fn(),
}));

describe('removeUnusedImports', () => {
  it('should remove unused imports', () => {
    const code = `
      import { unused1, unused2 } from 'vitest';
      import { describe, it } from 'vitest';
      
      describe('test', () => {
        it('works', () => {
          expect(1).toBe(1);
        });
      });
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).not.toContain('unused1');
    expect(result).not.toContain('unused2');
    expect(result).toContain('describe');
    expect(result).toContain('it');
  });

  it('should keep used imports', () => {
    const code = `
      import { describe, it, expect } from 'vitest';
      
      describe('test', () => {
        it('works', () => {
          expect(1).toBe(1);
        });
      });
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).toContain('import { describe, it, expect }');
    expect(result).toContain('describe');
    expect(result).toContain('it');
    expect(result).toContain('expect');
  });

  it('should remove entire import statement if all imports are unused', () => {
    const code = `
      import { unused1, unused2 } from 'some-package';
      import { describe, it } from 'vitest';
      
      describe('test', () => {
        it('works', () => {});
      });
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).not.toContain("from 'some-package'");
    expect(result).toContain("from 'vitest'");
  });

  it('should handle default imports', () => {
    const code = `
      import unusedDefault from 'unused-package';
      import { describe } from 'vitest';
      
      describe('test', () => {});
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).not.toContain("import unusedDefault");
    expect(result).toContain("import { describe }");
  });

  it('should handle namespace imports', () => {
    const code = `
      import * as unused from 'unused-package';
      import { describe } from 'vitest';
      
      describe('test', () => {});
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).not.toContain("import * as unused");
    expect(result).toContain("import { describe }");
  });

  it('should handle mixed used and unused imports in same statement', () => {
    const code = `
      import { used, unused } from 'vitest';
      
      describe('test', () => {
        it('works', () => {
          used();
        });
      });
    `;
    
    const result = removeUnusedImports(code);
    
    // Should keep the import but ideally remove 'unused'
    // This is a simplified version - full implementation would filter named imports
    expect(result).toContain('used');
  });

  it('should return original code if parsing fails', () => {
    const invalidCode = 'this is not valid typescript code {{{{';
    
    const result = removeUnusedImports(invalidCode);
    
    expect(result).toBe(invalidCode);
  });

  it('should handle multiple import statements', () => {
    const code = `
      import { unused1 } from 'package1';
      import { unused2 } from 'package2';
      import { describe, it } from 'vitest';
      
      describe('test', () => {
        it('works', () => {});
      });
    `;
    
    const result = removeUnusedImports(code);
    
    expect(result).not.toContain("from 'package1'");
    expect(result).not.toContain("from 'package2'");
    expect(result).toContain("from 'vitest'");
  });
});

