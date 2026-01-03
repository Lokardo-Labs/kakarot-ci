import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectCodeStyle, formatGeneratedCode, lintGeneratedCode } from './code-standards.js';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs');

describe('code-standards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  describe('detectCodeStyle', () => {
    it('should detect ESLint config', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('.eslintrc.json');
      });

      const config = await detectCodeStyle('/project');

      expect(config.eslint?.enabled).toBe(true);
      expect(config.eslint?.configPath).toContain('.eslintrc.json');
    });

    it('should detect Prettier config', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('.prettierrc');
      });

      const config = await detectCodeStyle('/project');

      expect(config.prettier?.enabled).toBe(true);
      expect(config.prettier?.configPath).toContain('.prettierrc');
    });

    it('should detect Biome config', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('biome.json');
      });

      const config = await detectCodeStyle('/project');

      expect(config.biome?.enabled).toBe(true);
      expect(config.biome?.configPath).toContain('biome.json');
    });

    it('should detect TypeScript config', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('tsconfig.json');
      });

      const config = await detectCodeStyle('/project');

      expect(config.typescript?.enabled).toBe(true);
      expect(config.typescript?.configPath).toContain('tsconfig.json');
    });

    it('should return empty config when no tools detected', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const config = await detectCodeStyle('/project');

      expect(config.eslint).toBeUndefined();
      expect(config.prettier).toBeUndefined();
      expect(config.biome).toBeUndefined();
      expect(config.typescript).toBeUndefined();
    });

    it('should check package.json for ESLint config', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('package.json');
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        eslintConfig: { rules: {} },
      }));

      const config = await detectCodeStyle('/project');

      expect(config.eslint?.enabled).toBe(true);
    });
  });

  describe('formatGeneratedCode', () => {
    it('should return code unchanged when no formatters detected', async () => {
      const code = 'const x = 1;';
      const formatted = await formatGeneratedCode(code, '/project');

      expect(formatted).toBe(code);
    });

    it('should handle Prettier errors gracefully', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('.prettierrc');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = 'const x = 1;';

      const formatted = await formatGeneratedCode(code, '/project');

      expect(formatted).toBe(code);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('lintGeneratedCode', () => {
    it('should return code unchanged when no linters detected', async () => {
      const code = 'const x = 1;';
      const linted = await lintGeneratedCode(code, '/project');

      expect(linted).toBe(code);
    });

    it('should handle ESLint errors gracefully', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.includes('.eslintrc');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = 'const x = 1;';

      const linted = await lintGeneratedCode(code, '/project');

      expect(linted).toBe(code);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});

