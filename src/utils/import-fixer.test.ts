import { describe, it, expect } from 'vitest';
import { addMissingImports, fixMissingImports } from './import-fixer.js';

describe('import-fixer', () => {
  describe('addMissingImports', () => {
    it('should add missing imports to existing import statement', () => {
      const content = `import { describe, it, expect } from 'vitest';

describe('test', () => {
  it('works', () => {
    beforeEach(() => {});
    afterEach(() => {});
  });
});`;

      const fixed = addMissingImports(content, ['beforeEach', 'afterEach'], 'vitest');

      expect(fixed).toContain("from 'vitest'");
      expect(fixed).toContain('describe');
      expect(fixed).toContain('it');
      expect(fixed).toContain('expect');
      expect(fixed).toContain('beforeEach');
      expect(fixed).toContain('afterEach');
    });

    it('should add new import statement if none exists', () => {
      const content = `describe('test', () => {
  it('works', () => {
    beforeEach(() => {});
  });
});`;

      const fixed = addMissingImports(content, ['describe', 'it', 'beforeEach'], 'vitest');

      expect(fixed).toContain("import { beforeEach, describe, it } from 'vitest'");
    });

    it('should detect framework from existing imports', () => {
      const content = `import { describe } from 'vitest';

describe('test', () => {
  beforeEach(() => {});
});`;

      const fixed = addMissingImports(content, ['beforeEach']);

      expect(fixed).toContain("from 'vitest'");
      expect(fixed).toContain('beforeEach');
    });

    it('should handle Jest framework', () => {
      const content = `import { describe } from '@jest/globals';

describe('test', () => {
  beforeEach(() => {});
});`;

      const fixed = addMissingImports(content, ['beforeEach'], 'jest');

      expect(fixed).toContain("from '@jest/globals'");
      expect(fixed).toContain('beforeEach');
    });
  });

  describe('fixMissingImports', () => {
    it('should fix missing imports and consolidate', () => {
      const content = `import { describe, it } from 'vitest';
import { expect } from 'vitest';

describe('test', () => {
  beforeEach(() => {});
  afterEach(() => {});
});`;

      const fixed = fixMissingImports(content, ['beforeEach', 'afterEach'], 'vitest');

      // Should have consolidated imports
      const importMatches = fixed.match(/import\s+.*?from\s+['"]vitest['"]/g);
      expect(importMatches?.length).toBeLessThanOrEqual(1);
      
      // Should have all imports
      expect(fixed).toContain('beforeEach');
      expect(fixed).toContain('afterEach');
      expect(fixed).toContain('describe');
      expect(fixed).toContain('it');
      expect(fixed).toContain('expect');
    });

    it('should return original content if no missing imports', () => {
      const content = `import { describe, it, expect } from 'vitest';

describe('test', () => {});`;

      const fixed = fixMissingImports(content, [], 'vitest');

      expect(fixed).toBe(content);
    });
  });
});

