import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, findProjectRoot } from './config-loader.js';
import { cosmiconfig } from 'cosmiconfig';
import { findUp } from 'find-up';

vi.mock('cosmiconfig');
vi.mock('find-up');
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

describe('config-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KAKAROT_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  describe('findProjectRoot', () => {
    it('should return directory containing package.json', async () => {
      vi.mocked(findUp).mockResolvedValue('/project/package.json');
      const result = await findProjectRoot();
      expect(result).toBe('/project');
    });

    it('should return current directory if package.json not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);
      const result = await findProjectRoot();
      expect(result).toBe(process.cwd());
    });

    it('should use startPath when provided', async () => {
      vi.mocked(findUp).mockResolvedValue('/custom/package.json');
      const result = await findProjectRoot('/custom');
      expect(findUp).toHaveBeenCalledWith('package.json', { cwd: '/custom' });
      expect(result).toBe('/custom');
    });
  });

  describe('loadConfig', () => {
    it('should load config from cosmiconfig result', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          config: {
            apiKey: 'test-key',
            framework: 'jest',
          },
          filepath: '/project/kakarot.config.ts',
        }),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);

      const config = await loadConfig();

      expect(config.apiKey).toBe('test-key');
      expect(config.framework).toBe('jest');
    });

    it('should merge package.json kakarotCi field', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ kakarotCi: { maxTestsPerPR: 100 } })
      );

      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          config: { apiKey: 'test-key', framework: 'jest' },
          filepath: '/project/package.json',
        }),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);
      vi.mocked(findUp).mockResolvedValue('/project/package.json');

      const config = await loadConfig();

      expect(config.maxTestsPerPR).toBe(100);
    });

    it('should use KAKAROT_API_KEY from environment', async () => {
      process.env.KAKAROT_API_KEY = 'env-key';

      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          config: { framework: 'jest' },
          filepath: '/project/kakarot.config.ts',
        }),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);

      const config = await loadConfig();

      expect(config.apiKey).toBe('env-key');
    });

    it('should use GITHUB_TOKEN from environment', async () => {
      process.env.GITHUB_TOKEN = 'github-token';

      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          config: { apiKey: 'test-key', framework: 'jest' },
          filepath: '/project/kakarot.config.ts',
        }),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);

      const config = await loadConfig();

      expect(config.githubToken).toBe('github-token');
    });

    it('should throw error if apiKey is missing', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue({
          config: { framework: 'jest' },
          filepath: '/project/kakarot.config.ts',
        }),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);

      await expect(loadConfig()).rejects.toThrow();
    });

    it('should handle missing config file', async () => {
      const mockExplorer = {
        search: vi.fn().mockResolvedValue(null),
      };
      vi.mocked(cosmiconfig).mockReturnValue(mockExplorer as never);

      await expect(loadConfig()).rejects.toThrow();
    });
  });
});

