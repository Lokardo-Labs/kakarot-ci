import { z } from 'zod';

export const KakarotConfigSchema = z.object({
  apiKey: z.string(),
  githubToken: z.string().optional(),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  provider: z.enum(['openai', 'anthropic', 'google']).optional(),
  model: z.string().optional(),
  fixModel: z.string().optional(), // Optional separate model for fixing (stronger model recommended)
  maxTokens: z.number().int().min(1).max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  fixTemperature: z.number().min(0).max(2).optional(),
  maxFixAttempts: z.number().int().min(-1).default(5), // -1 means infinite attempts
  framework: z.enum(['jest', 'vitest']),
  mode: z.enum(['scaffold', 'full', 'pr']).default('pr'),
  testLocation: z.enum(['separate', 'co-located']).default('separate'),
  testDirectory: z.string().default('__tests__'),
  testFilePattern: z.string().default('*.test.ts'),
  includePatterns: z.array(z.string()).default(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']),
  excludePatterns: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js', '**/node_modules/**']),
  maxTestsPerPR: z.number().int().min(1).default(50),
  requestDelay: z.number().int().min(0).max(60000).default(0).optional(), // Delay between requests in ms
  maxRetries: z.number().int().min(0).max(10).default(3).optional(), // Max retries for rate limits
  enableAutoCommit: z.boolean().default(true),
  commitStrategy: z.enum(['direct', 'branch-pr']).default('direct'),
  commitMessageTemplate: z.string().optional(),
  skipCommitOnFailure: z.boolean().default(false),
  enablePRComments: z.boolean().default(true),
  enableCoverage: z.boolean().default(false),
  codeStyle: z.object({
    autoDetect: z.boolean().default(true),
    formatGeneratedCode: z.boolean().default(true),
    lintGeneratedCode: z.boolean().default(true),
  }).default({}).optional(),
  customPrompts: z.object({
    testGeneration: z.string().optional(),
    testScaffold: z.string().optional(),
    testScaffoldSystem: z.string().optional(),
    testScaffoldUser: z.string().optional(),
    testFix: z.string().optional(),
  }).optional(),
  debug: z.boolean().default(false),
});

export type KakarotConfig = z.infer<typeof KakarotConfigSchema>;

export type PartialKakarotConfig = Partial<KakarotConfig>;

