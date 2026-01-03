import { describe, it, expect } from 'vitest';
import { consolidateImports } from './import-consolidator.js';

describe('import-consolidator', () => {
  describe('consolidateImports', () => {
    it('should consolidate imports from the same module', () => {
      const imports = [
        "import { describe, it, expect } from 'vitest';",
        "import { describe, it, expect, vi } from 'vitest';",
        "import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';",
      ];
      
      const consolidated = consolidateImports(imports);
      
      expect(consolidated.length).toBe(1);
      expect(consolidated[0]).toContain("from 'vitest'");
      expect(consolidated[0]).toContain('describe');
      expect(consolidated[0]).toContain('it');
      expect(consolidated[0]).toContain('expect');
      expect(consolidated[0]).toContain('vi');
      expect(consolidated[0]).toContain('beforeEach');
      expect(consolidated[0]).toContain('afterEach');
    });

    it('should keep imports from different modules separate', () => {
      const imports = [
        "import { describe, it } from 'vitest';",
        "import { func1 } from './utils';",
        "import { func2 } from './utils';",
      ];
      
      const consolidated = consolidateImports(imports);
      
      expect(consolidated.length).toBe(2);
      expect(consolidated.some(imp => imp.includes("from 'vitest'"))).toBe(true);
      expect(consolidated.some(imp => imp.includes("from './utils'"))).toBe(true);
      
      // Check utils import is consolidated
      const utilsImport = consolidated.find(imp => imp.includes("from './utils'"));
      expect(utilsImport).toContain('func1');
      expect(utilsImport).toContain('func2');
    });

    it('should handle default imports', () => {
      const imports = [
        "import defaultExport from './module';",
        "import { named } from './module';",
      ];
      
      const consolidated = consolidateImports(imports);
      
      expect(consolidated.length).toBe(1);
      expect(consolidated[0]).toContain('defaultExport');
      expect(consolidated[0]).toContain('named');
    });

    it('should handle namespace imports', () => {
      const imports = [
        "import * as utils from './utils';",
        "import { func } from './utils';",
      ];
      
      const consolidated = consolidateImports(imports);
      
      expect(consolidated.length).toBe(1);
      expect(consolidated[0]).toContain('* as utils');
      expect(consolidated[0]).toContain('func');
    });

    it('should handle empty array', () => {
      const consolidated = consolidateImports([]);
      expect(consolidated.length).toBe(0);
    });
  });
});

