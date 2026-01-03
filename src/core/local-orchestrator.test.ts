import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLocal } from './local-orchestrator.js';
import { loadConfig } from '../utils/config-loader.js';
import { extractLocalTestTargets } from '../utils/local-file-analyzer.js';
import { generateTestsFromTargets } from './test-generation-core.js';

vi.mock('../utils/config-loader.js');
vi.mock('../utils/local-file-analyzer.js');
vi.mock('./test-generation-core.js');
vi.mock('../utils/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
}));

describe('local-orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue({
      apiKey: 'test-key',
      framework: 'jest',
      maxTestsPerPR: 50,
      testDirectory: '__tests__',
      testFilePattern: '*.test.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts'],
    } as never);
  });

  it('should return empty result when no targets found', async () => {
    vi.mocked(extractLocalTestTargets).mockResolvedValue([]);
    vi.mocked(generateTestsFromTargets).mockResolvedValue({
      targetsProcessed: 0,
      testsGenerated: 0,
      testsFailed: 0,
      testFiles: [],
      errors: [],
      finalTestFiles: new Map(),
    });

    const result = await runLocal({ mode: 'scaffold' });

    expect(result.targetsProcessed).toBe(0);
    expect(result.testsGenerated).toBe(0);
  });

  it('should process targets in scaffold mode', async () => {
    vi.mocked(extractLocalTestTargets).mockResolvedValue([{
      filePath: 'src/utils.ts',
      functionName: 'add',
      functionType: 'function',
      code: 'export function add() {}',
      context: '',
      startLine: 1,
      endLine: 1,
      changedRanges: [],
    }]);
    vi.mocked(generateTestsFromTargets).mockResolvedValue({
      targetsProcessed: 1,
      testsGenerated: 1,
      testsFailed: 0,
      testFiles: [{ path: '__tests__/utils.test.ts', targets: ['add'] }],
      errors: [],
      finalTestFiles: new Map(),
    });

    const result = await runLocal({ mode: 'scaffold' });

    expect(result.testsGenerated).toBe(1);
    expect(generateTestsFromTargets).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'scaffold' })
    );
  });

  it('should process targets in full mode', async () => {
    vi.mocked(extractLocalTestTargets).mockResolvedValue([{
      filePath: 'src/utils.ts',
      functionName: 'add',
      functionType: 'function',
      code: 'export function add() {}',
      context: '',
      startLine: 1,
      endLine: 1,
      changedRanges: [],
    }]);
    vi.mocked(generateTestsFromTargets).mockResolvedValue({
      targetsProcessed: 1,
      testsGenerated: 1,
      testsFailed: 0,
      testFiles: [{ path: '__tests__/utils.test.ts', targets: ['add'] }],
      errors: [],
      finalTestFiles: new Map(),
    });

    const result = await runLocal({ mode: 'full' });

    expect(result.testsGenerated).toBe(1);
    expect(generateTestsFromTargets).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'full' })
    );
  });
});

