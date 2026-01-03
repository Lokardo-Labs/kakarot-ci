import { describe, it, expect } from 'vitest';
import { KakarotConfigSchema } from './config.js';

describe('KakarotConfigSchema', () => {
  it('should validate minimal required config', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
    };

    const result = KakarotConfigSchema.parse(config);

    expect(result.apiKey).toBe('test-api-key');
    expect(result.framework).toBe('jest');
    expect(result.maxFixAttempts).toBe(5); // default
    expect(result.testLocation).toBe('separate'); // default
  });

  it('should validate full config', () => {
    const config = {
      apiKey: 'test-api-key',
      githubToken: 'github-token',
      githubOwner: 'owner',
      githubRepo: 'repo',
      provider: 'openai' as const,
      model: 'gpt-4',
      maxTokens: 4000,
      temperature: 0.2,
      fixTemperature: 0.1,
      maxFixAttempts: 5,
      framework: 'vitest' as const,
      mode: 'pr' as const,
      testLocation: 'co-located' as const,
      testDirectory: 'tests',
      testFilePattern: '*.spec.ts',
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.spec.ts'],
      maxTestsPerPR: 100,
      enableAutoCommit: false,
      commitStrategy: 'branch-pr' as const,
      commitMessageTemplate: 'test: {{testsGenerated}} tests',
      skipCommitOnFailure: true,
      enablePRComments: false,
      enableCoverage: false,
      debug: true,
    };

    const result = KakarotConfigSchema.parse(config);

    // Check that all provided fields are present
    expect(result.apiKey).toBe(config.apiKey);
    expect(result.framework).toBe(config.framework);
    expect(result.commitMessageTemplate).toBe(config.commitMessageTemplate);
    expect(result.skipCommitOnFailure).toBe(config.skipCommitOnFailure);
  });

  it('should reject missing apiKey', () => {
    const config = {
      framework: 'jest' as const,
    };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject missing framework', () => {
    const config = {
      apiKey: 'test-api-key',
    };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject invalid framework', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'mocha',
    } as { apiKey: string; framework: string };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject invalid provider', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      provider: 'invalid',
    } as { apiKey: string; framework: 'jest'; provider: string };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject maxTokens out of range', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      maxTokens: 200000, // exceeds max
    };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject temperature out of range', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      temperature: 3, // exceeds max
    };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should reject maxFixAttempts out of range', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      maxFixAttempts: 11, // exceeds max (10)
    };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });

  it('should apply defaults for optional fields', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
    };

    const result = KakarotConfigSchema.parse(config);

    expect(result.maxFixAttempts).toBe(5);
    expect(result.mode).toBe('pr');
    expect(result.testLocation).toBe('separate');
    expect(result.testDirectory).toBe('__tests__');
    expect(result.testFilePattern).toBe('*.test.ts');
    expect(result.includePatterns).toEqual(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']);
    expect(result.maxTestsPerPR).toBe(50);
    expect(result.enableAutoCommit).toBe(true);
    expect(result.commitStrategy).toBe('direct');
    expect(result.enablePRComments).toBe(true);
    expect(result.enableCoverage).toBe(false);
    expect(result.debug).toBe(false);
  });

  it('should validate mode options', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      mode: 'scaffold' as const,
    };

    const result = KakarotConfigSchema.parse(config);
    expect(result.mode).toBe('scaffold');
  });

  it('should reject invalid mode', () => {
    const config = {
      apiKey: 'test-api-key',
      framework: 'jest' as const,
      mode: 'invalid',
    } as { apiKey: string; framework: 'jest'; mode: string };

    expect(() => KakarotConfigSchema.parse(config)).toThrow();
  });
});

